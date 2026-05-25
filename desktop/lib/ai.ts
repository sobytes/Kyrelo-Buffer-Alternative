import Anthropic from "@anthropic-ai/sdk";
import { getApiKeys } from "./storage";
import { AiProvider } from "./types";
import { PLATFORMS, PlatformSlug } from "./platforms";

const MODEL = "claude-sonnet-4-6";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

async function resolveAnthropicKey(): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const stored = await getApiKeys();
  if (stored.anthropic) return stored.anthropic;
  throw new Error("ANTHROPIC_API_KEY is not set. Add it under Settings → API keys.");
}

async function resolveOpenAiKey(): Promise<string> {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const stored = await getApiKeys();
  if (stored.openai) return stored.openai;
  throw new Error("OPENAI_API_KEY is not set. Add it under Settings → API keys.");
}

const GROK_SYSTEM = `You write short, provocative reply tweets that tag @grok and ask it a single sharp question about the user's own tweet.

Goal: surface a substantive contrarian angle so Grok writes a thoughtful response and the thread gets engagement.

Hard rules:
- Start the reply with "@grok ".
- One single question. No multi-part questions.
- Total length 220 characters or less, including "@grok ".
- No emojis. No hashtags. No quotation marks around the question.
- Don't insult the original poster, and don't fabricate facts.
- Don't quote the original tweet back.
- Don't begin with filler like "Interesting take" or "Hot take".
- Output ONLY the reply text, no preamble.`;

function clampGrokReply(text: string): string {
  let out = text.trim().replace(/^["']|["']$/g, "").trim();
  if (!/^@grok\b/i.test(out)) out = `@grok ${out}`;
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > 270) out = out.slice(0, 267).trimEnd() + "...";
  return out;
}

export interface GrokQuestionInput {
  tweetText: string;
  styleHint?: string;
  provider: AiProvider;
}

async function generateGrokViaClaude(input: GrokQuestionInput): Promise<string> {
  const apiKey = await resolveAnthropicKey();
  const anthropic = new Anthropic({ apiKey });
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: [
      { type: "text", text: GROK_SYSTEM, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              (input.styleHint ? `Style guidance: ${input.styleHint}\n\n` : "") +
              `The user's tweet:\n"""\n${input.tweetText}\n"""\n\nWrite the @grok reply.`,
          },
        ],
      },
    ],
  });

  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

async function generateGrokViaOpenAI(input: GrokQuestionInput): Promise<string> {
  const apiKey = await resolveOpenAiKey();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.9,
      max_tokens: 200,
      messages: [
        { role: "system", content: GROK_SYSTEM },
        {
          role: "user",
          content:
            (input.styleHint ? `Style guidance: ${input.styleHint}\n\n` : "") +
            `The user's tweet:\n"""\n${input.tweetText}\n"""\n\nWrite the @grok reply.`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? "";
}

export async function generateGrokQuestion(input: GrokQuestionInput): Promise<string> {
  const raw =
    input.provider === "openai"
      ? await generateGrokViaOpenAI(input)
      : await generateGrokViaClaude(input);
  return clampGrokReply(raw);
}

const REWRITE_SYSTEM = `You rewrite social posts while preserving their core message.

Hard rules:
- Keep the same topic and core meaning. Do not change what's being said.
- Reword sentences, vary the structure, swap a couple of word choices.
- Stay within roughly 80–120% of the original length.
- Same tone (casual stays casual, formal stays formal).
- No em dashes. No emojis the original doesn't already use.
- Output ONLY the rewritten post — no preamble, no quotes, no labels.`;

// Per-platform tone overlay appended to the base rewrite prompt. Each network
// has a distinct voice; without these the rewrite reads "samey" across X /
// Threads / LinkedIn even though the audiences are very different.
const PLATFORM_STYLE: Record<PlatformSlug, string> = {
  twitter:
    "Platform: X (Twitter). Voice: punchy, conversational, internet-native. " +
    "Short sentences, one sharp thought per line. Hashtags fine in moderation.",
  threads:
    "Platform: Threads. Voice: casual, riffy, lowercase-friendly. " +
    "Lighter and more meandering than X. Skip hashtags. Personal asides welcome.",
  linkedin:
    "Platform: LinkedIn. Voice: thoughtful and professional. " +
    "Lessons, insights, observations. Full sentences. No slang. " +
    "At most one or two relevant hashtags at the end (or none).",
  facebook:
    "Platform: Facebook. Voice: friendly, conversational, slightly longer-form. " +
    "Talking to friends and family — warm, not corporate. Light on hashtags.",
  instagram:
    "Platform: Instagram (caption). Voice: evocative, emoji-friendly, " +
    "line breaks for rhythm. Hashtags at the end are fine (5–10 relevant ones).",
};

function buildRewriteSystem(platform?: PlatformSlug): string {
  const style = platform ? PLATFORM_STYLE[platform] : null;
  return style ? `${REWRITE_SYSTEM}\n\n${style}` : REWRITE_SYSTEM;
}

// X Premium / verified accounts can post up to 4000 characters. The rewrite
// is allowed to keep that full headroom; the system prompt still asks the
// model to stay within 80–120% of the original length.
function clampPostLength(text: string, max = 4000): string {
  let out = text.trim().replace(/^["']|["']$/g, "").trim();
  // Collapse runs of spaces/tabs but preserve newlines so multi-paragraph
  // posts (bullet lists, line breaks, etc.) survive the rewrite.
  out = out.replace(/[ \t]+/g, " ").replace(/[ \t]*\n[ \t]*/g, "\n");
  if (out.length > max) out = out.slice(0, max - 1).trimEnd() + "…";
  return out;
}

export interface RewriteInput {
  text: string;
  provider: AiProvider;
  // Optional — when provided, the model receives a platform-specific tone
  // overlay so "Re-gig for LinkedIn" reads differently from "Re-gig for X".
  platform?: PlatformSlug;
}

async function rewriteViaClaude(text: string, platform?: PlatformSlug): Promise<string> {
  const apiKey = await resolveAnthropicKey();
  const anthropic = new Anthropic({ apiKey });
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [
      {
        type: "text",
        text: buildRewriteSystem(platform),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Rewrite this post:\n"""\n${text}\n"""`,
          },
        ],
      },
    ],
  });
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

async function rewriteViaOpenAI(text: string, platform?: PlatformSlug): Promise<string> {
  const apiKey = await resolveOpenAiKey();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.9,
      max_tokens: 2000,
      messages: [
        { role: "system", content: buildRewriteSystem(platform) },
        { role: "user", content: `Rewrite this post:\n"""\n${text}\n"""` },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? "";
}

export async function rewritePost(input: RewriteInput): Promise<string> {
  const raw =
    input.provider === "openai"
      ? await rewriteViaOpenAI(input.text, input.platform)
      : await rewriteViaClaude(input.text, input.platform);
  // Clamp to the destination platform's hard limit so a Threads rewrite can't
  // come back at 800 chars (over the 500 ceiling) and get rejected at post
  // time. Falls back to the global 4000 when no platform is specified.
  const meta = input.platform
    ? PLATFORMS.find((p) => p.slug === input.platform)
    : null;
  return clampPostLength(raw, meta?.maxChars);
}
