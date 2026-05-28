import Anthropic from "@anthropic-ai/sdk";
import { createScheduledPost } from "./scheduler";
import {
  getApiKeys,
  getWatchState,
  listScheduledPosts,
  upsertAiBotRun,
  upsertScheduledPost,
} from "./storage";
import { AiBotDraft, AiBotEvent, AiBotRun } from "./types";
import { PlatformSlug } from "./platforms";

const MODEL = "claude-sonnet-4-6";
const MAX_TOOL_CALLS = 20;
const MAX_PROPOSALS = 8;

// Em dashes (—), en dashes (–), and ASCII hyphens (-) are the clearest tell
// that a post was AI-generated. We forbid them in the system prompt AND
// scrub them here, because models slip even with strong instructions. Also
// covers figure dash (‒), horizontal bar (―), and the lookalike minus (−).
//
// Replacement strategy: dashes become spaces, then we collapse runs of
// whitespace. Compound words like "long-term" come out as "long term", which
// reads naturally. URLs are usually absent from these posts; on the rare
// occasion one shows up, the user can edit the draft before scheduling.
function sanitizeDraftText(text: string): string {
  return text
    .replace(/[\u2012\u2013\u2014\u2015\u2212]/g, " ")
    .replace(/-/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

// --- Website scraper --------------------------------------------------------

const WEBSITE_FETCH_TIMEOUT_MS = 8_000;
const WEBSITE_TEXT_CAP_CHARS = 4_000;

export interface WebsiteSummary {
  url: string;
  /** Cleaned visible text from the page, capped at WEBSITE_TEXT_CAP_CHARS. */
  text: string;
  /** Bytes of HTML before stripping — useful for the "thinking" event preview. */
  htmlBytes: number;
}

/**
 * Fetch a URL and pull its visible text. Returns null on any error (bad URL,
 * timeout, non-200, non-html, etc.) — the caller can choose how to surface
 * that to the user without crashing the whole run.
 */
export async function fetchWebsiteSummary(
  rawUrl: string,
): Promise<{ summary: WebsiteSummary } | { error: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: "URL is not valid (must include https:// or http://)" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { error: "URL must be http or https" };
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), WEBSITE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: ac.signal,
      headers: {
        // A few sites short-circuit on the default Node UA. Pretending to be
        // a recent desktop browser yields the same HTML a regular visitor
        // would see.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) {
      return { error: `Site returned HTTP ${res.status}` };
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("text")) {
      return { error: `Unsupported content-type "${contentType}"` };
    }
    const html = await res.text();
    const text = htmlToVisibleText(html).slice(0, WEBSITE_TEXT_CAP_CHARS);
    if (!text) {
      return { error: "Site returned no readable text (JS-only app?)" };
    }
    return {
      summary: {
        url: url.toString(),
        text,
        htmlBytes: html.length,
      },
    };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return { error: `Timed out after ${WEBSITE_FETCH_TIMEOUT_MS / 1000}s` };
    }
    return { error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

function htmlToVisibleText(html: string): string {
  return (
    html
      // Drop entire <script>/<style>/<noscript> blocks (with content), so the
      // remaining tag-strip doesn't pull JS/CSS into the "visible text."
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
      // HTML comments
      .replace(/<!--[\s\S]*?-->/g, " ")
      // Strip every remaining tag
      .replace(/<[^>]+>/g, " ")
      // Common entity decodes (keeps things readable without pulling in a lib)
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      // Numeric entities (very rough — fine for the marketing copy we care about)
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      // Collapse runs of whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}

async function resolveAnthropicKey(): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const stored = await getApiKeys();
  if (stored.anthropic) return stored.anthropic;
  throw new Error("ANTHROPIC_API_KEY is not set. Add it under Settings → API keys.");
}

const SYSTEM_PROMPT = `You are a senior social-media growth strategist embedded in the user's own scheduling tool. Your job: draft a batch of posts that would grow this account's followers, treating the request like a paid engagement, not a chatbot Q&A.

You work for ONE specific account on ONE platform per run. The user has connected this account and is paying for your judgement.

How to operate:
1. Start by reading the account's recent watched posts (read_watched_posts) and existing queue (read_my_queue) and history (read_my_history). Skim, don't paste back. Look for: voice, topics, what's already pending, what's been said recently — so you don't repeat or contradict.
2. Form a brief mental plan (you don't need to narrate it). Then draft 3–${MAX_PROPOSALS} posts that:
   - Match the account's voice (don't suddenly write like a marketing template).
   - Spread across the next 24–72 hours at sensible times for that platform's audience.
   - Mix formats: a hook/opinion, a useful tidbit, a question to the audience, a reply-bait observation, etc.
   - DON'T duplicate anything already in the queue or recent history.
3. Call propose_post for each one. Use clean, future ISO datetimes — never the past, never "now". Space them out (e.g. 4–12 hours apart, not all in one minute). Include a one-sentence rationale per draft.
4. When you're done, call finish with a one-paragraph summary of your strategy.

Important: propose_post creates a DRAFT only. Drafts do NOT enter the scheduler queue automatically — the user will pick which drafts to schedule after the run. Your job is to give them a curated, opinionated batch worth choosing from.

If the user has provided one or more "Knowledge sources" (scraped product/site pages), they appear in the user message labelled KNOWLEDGE SOURCE 1, KNOWLEDGE SOURCE 2, etc. Different pages give different context — homepage carries the voice and positioning, /features lists what to actually talk about, /pricing reveals the audience, /about/blog give tone samples. Read them all, then:
- Ground posts in what the product actually does (don't invent features).
- Echo the brand's voice if a clear one comes through.
- Across ALL provided URLs combined, mention a URL in AT MOST 2 of your drafts — never every post. X penalises link-heavy accounts; the rest must be pure-value posts with no link. When you do link, pick the URL that best matches the post's claim (a feature post links to /features; a pricing tease links to /pricing) and weave it naturally rather than "check out X".

Hard rules:
- NEVER use em dashes (—), en dashes (–), or hyphens (-). These are the clearest "this is AI" tells. Rephrase compound words: "long-term" → "long term" or "lasting"; "AI-generated" → "from an AI"; "real-time" → "live". Use commas, periods, or shorter sentences instead of dashes.
- Don't open posts with filler like "Hot take" or "Interesting take".
- Never propose more than ${MAX_PROPOSALS} posts in one run. Quality over quantity.
- Each propose_post counts toward a tool budget. Be decisive.
- If you have nothing useful to say (e.g. zero context, no watched posts, account too new), call finish and explain what the user should do to give you more to work with — don't fabricate.

Output ONLY tool calls — the user does not see your free-form text between tool calls. Save commentary for the finish call.`;

// --- Tool definitions --------------------------------------------------------

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "read_watched_posts",
    description:
      "Read the most recent posts scraped by the Monitor for the active account's handle, plus any other handles the user is watching on this platform. Returns up to 30 posts: handle, text, postedAt, isReply. Use this to understand voice and topics.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "read_my_queue",
    description:
      "Read every PENDING scheduled post for this account on this platform. Returns scheduledFor + text. Use this so you don't double-book a timeslot or repeat content already queued.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "read_my_history",
    description:
      "Read the last 30 POSTED scheduled posts for this account on this platform. Returns postedAt + text. Use this to avoid repeating yourself.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "propose_post",
    description:
      "Record a DRAFT post for the user to review. Drafts do not enter the scheduler queue automatically — the user explicitly chooses which drafts to schedule after the run. Use ISO 8601 for scheduledFor (e.g. 2026-05-28T14:00:00Z). Must be at least 5 minutes in the future.",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The post body. Match the account's voice.",
        },
        scheduledFor: {
          type: "string",
          description:
            "ISO 8601 datetime at least 5 minutes in the future, e.g. 2026-05-28T14:00:00Z",
        },
        rationale: {
          type: "string",
          description:
            "One sentence: why this post, why this time. Shown to the user when reviewing the draft.",
        },
      },
      required: ["text", "scheduledFor"],
      additionalProperties: false,
    },
  },
  {
    name: "finish",
    description:
      "End the run with a one-paragraph summary of your strategy. Call this when you've proposed all the posts you want to propose.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description:
            "One short paragraph (2–4 sentences) explaining the strategy you used and what the user should look for in the proposed posts.",
        },
      },
      required: ["summary"],
      additionalProperties: false,
    },
  },
];

// --- Tool implementations ----------------------------------------------------

interface ToolContext {
  platform: PlatformSlug;
  accountId: string;
  /** Lowercased handle = accountId, but the type makes intent clear. */
  handle: string;
  /** Drafts produced by this run. Mutated as propose_post is called. */
  drafts: AiBotDraft[];
}

interface ToolOutcome {
  // Stringified payload returned to the model.
  text: string;
  // Optional: a draft that the loop should announce via the SSE stream.
  proposedDraft?: AiBotDraft;
  // Optional: signal that the agent has chosen to finish.
  finishSummary?: string;
}

async function runTool(
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  switch (name) {
    case "read_watched_posts":
      return readWatchedPosts(ctx);
    case "read_my_queue":
      return readMyQueue(ctx);
    case "read_my_history":
      return readMyHistory(ctx);
    case "propose_post":
      return proposePost(input, ctx);
    case "finish":
      return {
        text: "ok",
        finishSummary:
          (input as { summary?: string })?.summary?.trim() ||
          "Run complete — no summary provided.",
      };
    default:
      return { text: JSON.stringify({ error: `unknown tool: ${name}` }) };
  }
}

async function readWatchedPosts(ctx: ToolContext): Promise<ToolOutcome> {
  const state = await getWatchState(ctx.platform);
  const posts = state.posts
    .slice(-30)
    .reverse()
    .map((p) => ({
      handle: p.handle,
      text: p.text.length > 280 ? p.text.slice(0, 280) + "…" : p.text,
      postedAt: p.postedAt ?? p.seenAt,
      isReply: p.isReply,
    }));
  return {
    text: JSON.stringify({
      activeHandle: ctx.handle,
      count: posts.length,
      posts,
    }),
  };
}

async function readMyQueue(ctx: ToolContext): Promise<ToolOutcome> {
  const all = await listScheduledPosts();
  const mine = all
    .filter(
      (p) =>
        p.platform === ctx.platform &&
        p.accountId === ctx.accountId &&
        (p.status === "pending" || p.status === "posting"),
    )
    .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
    .map((p) => ({
      scheduledFor: p.scheduledFor,
      text: p.text,
      proposedBy: p.proposedBy,
    }));
  return { text: JSON.stringify({ count: mine.length, queue: mine }) };
}

async function readMyHistory(ctx: ToolContext): Promise<ToolOutcome> {
  const all = await listScheduledPosts();
  const mine = all
    .filter(
      (p) =>
        p.platform === ctx.platform &&
        p.accountId === ctx.accountId &&
        p.status === "posted",
    )
    .sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor))
    .slice(0, 30)
    .map((p) => ({ postedAt: p.postedAt, text: p.text }));
  return { text: JSON.stringify({ count: mine.length, history: mine }) };
}

async function proposePost(
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const input = (rawInput ?? {}) as {
    text?: string;
    scheduledFor?: string;
    rationale?: string;
  };
  if (!input.text?.trim()) {
    return { text: JSON.stringify({ ok: false, error: "text is required" }) };
  }
  if (!input.scheduledFor) {
    return {
      text: JSON.stringify({ ok: false, error: "scheduledFor is required" }),
    };
  }
  const when = new Date(input.scheduledFor);
  if (Number.isNaN(when.getTime())) {
    return {
      text: JSON.stringify({ ok: false, error: "scheduledFor is not a valid date" }),
    };
  }
  // 5-minute floor so we never queue something that fires immediately. The user
  // is supposed to review proposals before they send.
  const earliest = Date.now() + 5 * 60_000;
  if (when.getTime() < earliest) {
    return {
      text: JSON.stringify({
        ok: false,
        error:
          "scheduledFor must be at least 5 minutes in the future. Pick a later time.",
      }),
    };
  }
  if (ctx.drafts.length >= MAX_PROPOSALS) {
    return {
      text: JSON.stringify({
        ok: false,
        error: `Proposal limit reached (${MAX_PROPOSALS}). Call finish.`,
      }),
    };
  }

  const draft: AiBotDraft = {
    id: crypto.randomUUID(),
    text: sanitizeDraftText(input.text),
    scheduledFor: when.toISOString(),
    rationale: input.rationale?.trim() || undefined,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  ctx.drafts.push(draft);
  return {
    text: JSON.stringify({
      ok: true,
      draftId: draft.id,
      scheduledFor: draft.scheduledFor,
      draftsRemaining: MAX_PROPOSALS - ctx.drafts.length,
      note: "Draft recorded. The user will choose whether to schedule it after the run.",
    }),
    proposedDraft: draft,
  };
}

// --- Agent loop --------------------------------------------------------------

export interface RunGrowthAgentArgs {
  run: AiBotRun;
  emit: (event: Omit<AiBotEvent, "seq" | "at">) => Promise<void>;
  /** Pre-scraped page texts the agent should use as grounding context. */
  websiteContexts?: WebsiteSummary[];
}

export async function runGrowthAgent(args: RunGrowthAgentArgs): Promise<{
  finalSummary: string;
  drafts: AiBotDraft[];
}> {
  const apiKey = await resolveAnthropicKey();
  const anthropic = new Anthropic({ apiKey });

  const ctx: ToolContext = {
    platform: args.run.platform,
    accountId: args.run.accountId,
    handle: args.run.accountId,
    drafts: args.run.drafts,
  };

  const contexts = args.websiteContexts ?? [];
  const knowledgeBlock = contexts.length === 0
    ? ""
    : "\n\n" +
      contexts
        .map(
          (c, i) =>
            `KNOWLEDGE SOURCE ${i + 1} (scraped from ${c.url}):\n"""\n${c.text}\n"""`,
        )
        .join("\n\n");

  const messages: Anthropic.Messages.MessageParam[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Active platform: ${args.run.platform}
Active account: @${args.run.accountId}
Current time: ${new Date().toISOString()}${knowledgeBlock}

Run a growth strategy for this account. Read the context, then propose 3–${MAX_PROPOSALS} scheduled posts spread across the next 24–72 hours. Call finish when you're done.`,
        },
      ],
    },
  ];

  let finalSummary = "Run ended without a final summary.";

  for (let step = 0; step < MAX_TOOL_CALLS; step++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      tools: TOOLS,
      messages,
    });

    // Capture any free-text "thinking" the model emitted alongside tool calls
    // so the UI can show a sense of what it's doing.
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        await args.emit({ kind: "thinking", text: block.text.trim() });
      }
    }

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      // No tool call — model ended without calling finish. Treat its last text
      // as the summary so we don't lose the work it already proposed.
      const tail = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (tail) finalSummary = tail;
      break;
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    let shouldStop = false;
    for (const tu of toolUses) {
      await args.emit({
        kind: "tool_call",
        toolName: tu.name,
        toolInput: tu.input,
      });
      const outcome = await runTool(tu.name, tu.input, ctx);
      await args.emit({
        kind: "tool_result",
        toolName: tu.name,
        toolResultPreview: outcome.text.slice(0, 400),
      });
      if (outcome.proposedDraft) {
        await args.emit({
          kind: "draft",
          draftId: outcome.proposedDraft.id,
          text: outcome.proposedDraft.text,
        });
      }
      if (outcome.finishSummary) {
        finalSummary = outcome.finishSummary;
        shouldStop = true;
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: outcome.text,
      });
    }

    messages.push({ role: "user", content: toolResults });

    if (shouldStop) break;
  }

  return { finalSummary, drafts: ctx.drafts };
}

// --- Promote drafts to scheduled posts --------------------------------------

export interface ScheduleDraftsResult {
  scheduledPostIds: string[];
  skipped: { draftId: string; reason: string }[];
}

/**
 * Promote the named drafts on a run into real ScheduledPosts. Drafts that
 * were already scheduled or discarded are skipped (idempotent). Past-time
 * drafts have their scheduledFor bumped to "now + 1 minute" before insertion
 * — the agent's original slot may have lapsed while the user was deciding.
 */
export async function scheduleDrafts(
  run: AiBotRun,
  draftIds: string[],
): Promise<ScheduleDraftsResult> {
  const idSet = new Set(draftIds);
  const result: ScheduleDraftsResult = { scheduledPostIds: [], skipped: [] };

  for (const draft of run.drafts) {
    if (!idSet.has(draft.id)) continue;
    if (draft.status !== "pending") {
      result.skipped.push({ draftId: draft.id, reason: `already ${draft.status}` });
      continue;
    }
    const slotMs = new Date(draft.scheduledFor).getTime();
    const earliest = Date.now() + 60_000;
    const whenMs = Number.isFinite(slotMs) ? Math.max(slotMs, earliest) : earliest;

    const post = await createScheduledPost({
      platform: run.platform,
      accountId: run.accountId,
      text: draft.text,
      scheduledFor: new Date(whenMs).toISOString(),
    });
    post.proposedBy = "ai-bot";
    await upsertScheduledPost(post);

    draft.status = "scheduled";
    draft.scheduledPostId = post.id;
    // Reflect the (possibly clamped) firing time on the draft, so the run
    // record matches what's actually in the queue.
    draft.scheduledFor = post.scheduledFor;
    result.scheduledPostIds.push(post.id);
  }

  await upsertAiBotRun(run);
  return result;
}

/** Mark the named drafts as discarded. Doesn't touch any ScheduledPosts. */
export async function discardDrafts(
  run: AiBotRun,
  draftIds: string[],
): Promise<{ discarded: number }> {
  const idSet = new Set(draftIds);
  let discarded = 0;
  for (const draft of run.drafts) {
    if (!idSet.has(draft.id)) continue;
    if (draft.status !== "pending") continue;
    draft.status = "discarded";
    discarded++;
  }
  await upsertAiBotRun(run);
  return { discarded };
}

