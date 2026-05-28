import { NextRequest } from "next/server";
import {
  WebsiteSummary,
  fetchWebsiteSummary,
  runGrowthAgent,
} from "@/lib/ai-bot";
import {
  getAiBotAccountConfig,
  listAccounts,
  setAiBotAccountConfig,
  upsertAiBotRun,
} from "@/lib/storage";
import { getPlatform } from "@/lib/platforms";
import { AiBotEvent, AiBotRun } from "@/lib/types";

const MAX_WEBSITE_URLS = 5;

export const dynamic = "force-dynamic";
// The agent loop can take a while (multiple Claude calls + tool dispatches),
// so opt out of any default time-shaving on the platform.
export const maxDuration = 300;

// POST /api/ai-bot/run
// Body: { platform: string, accountId: string }
// Streams server-sent events: each event is a single JSON line prefixed with
// "data: ". The final event has kind=final or kind=error and closes the stream.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    platform?: string;
    accountId?: string;
    websiteUrls?: string[] | null;
  };

  const platform = body.platform ? getPlatform(body.platform) : null;
  if (!platform) {
    return jsonError("unknown platform", 400);
  }
  if (!body.accountId) {
    return jsonError("accountId is required", 400);
  }

  // Verify the account exists for that platform — otherwise the agent would
  // happily queue posts for a handle that can't send them.
  const accounts = await listAccounts(platform.slug);
  if (!accounts.some((a) => a.id === body.accountId)) {
    return jsonError(
      `No connected ${platform.label} account "@${body.accountId}".`,
      400,
    );
  }

  // Resolve the websiteUrls list: explicit body value wins (including an
  // explicit empty array to clear), otherwise fall back to the saved config.
  // Whatever we resolve is also persisted so a fresh value sticks for next
  // time without the user re-typing it.
  const saved = await getAiBotAccountConfig(platform.slug, body.accountId);
  let websiteUrls: string[];
  if (Array.isArray(body.websiteUrls)) {
    const cleaned: string[] = [];
    for (const raw of body.websiteUrls) {
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      try {
        const u = new URL(trimmed);
        if (u.protocol !== "http:" && u.protocol !== "https:") continue;
        if (!cleaned.includes(u.toString())) cleaned.push(u.toString());
      } catch {
        // skip malformed entries silently — UI also validates
      }
      if (cleaned.length >= MAX_WEBSITE_URLS) break;
    }
    websiteUrls = cleaned;
    const before = saved.websiteUrls ?? [];
    const changed =
      before.length !== cleaned.length ||
      before.some((u, i) => u !== cleaned[i]);
    if (changed) {
      await setAiBotAccountConfig(platform.slug, body.accountId, {
        websiteUrls: cleaned,
      }).catch(() => {});
    }
  } else {
    websiteUrls = saved.websiteUrls ?? [];
  }

  const run: AiBotRun = {
    id: crypto.randomUUID(),
    platform: platform.slug,
    accountId: body.accountId,
    startedAt: new Date().toISOString(),
    status: "running",
    events: [],
    drafts: [],
    websiteUrls,
  };
  await upsertAiBotRun(run);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let seq = 0;
      let closed = false;
      const send = (event: AiBotEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // Immediate "run started" handshake so the UI can show the run id even
      // before the model has produced its first event.
      const startEvent: AiBotEvent = {
        seq: seq++,
        at: new Date().toISOString(),
        kind: "thinking",
        text: `Starting growth run for @${body.accountId} on ${platform.label}…`,
      };
      run.events.push(startEvent);
      send(startEvent);

      const emit = async (partial: Omit<AiBotEvent, "seq" | "at">) => {
        const ev: AiBotEvent = {
          seq: seq++,
          at: new Date().toISOString(),
          ...partial,
        };
        run.events.push(ev);
        // Persist every event so a crashed window doesn't lose context. The
        // file overwrite is cheap (single small JSON), and runs are bounded
        // by AI_BOT_RUNS_LIMIT in storage. The draft list itself is mutated
        // in place by the agent via the run reference.
        await upsertAiBotRun(run).catch(() => {});
        send(ev);
      };

      try {
        // Scrape every configured knowledge URL up-front and in parallel so
        // total wait stays close to the slowest page, not the sum. Failures
        // on any single URL are non-fatal — we just emit a thinking note and
        // continue with whichever pages did come back.
        const websiteContexts: WebsiteSummary[] = [];
        if (websiteUrls.length > 0) {
          await emit({
            kind: "thinking",
            text:
              websiteUrls.length === 1
                ? `Reading ${websiteUrls[0]} for product context…`
                : `Reading ${websiteUrls.length} knowledge sources in parallel…`,
          });
          const results = await Promise.all(
            websiteUrls.map(async (url) => ({
              url,
              outcome: await fetchWebsiteSummary(url),
            })),
          );
          for (const { url, outcome } of results) {
            if ("summary" in outcome) {
              websiteContexts.push(outcome.summary);
              await emit({
                kind: "thinking",
                text: `Got ${outcome.summary.text.length.toLocaleString()} chars from ${url}.`,
              });
            } else {
              await emit({
                kind: "thinking",
                text: `Couldn't read ${url}: ${outcome.error}. Continuing without it.`,
              });
            }
          }
        }

        const result = await runGrowthAgent({ run, emit, websiteContexts });
        const finalEvent: AiBotEvent = {
          seq: seq++,
          at: new Date().toISOString(),
          kind: "final",
          text: result.finalSummary,
        };
        run.events.push(finalEvent);
        run.status = "completed";
        run.finishedAt = new Date().toISOString();
        // result.drafts is the same array reference as run.drafts (the agent
        // mutates it in place). Persist the final state.
        await upsertAiBotRun(run);
        send(finalEvent);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const errEvent: AiBotEvent = {
          seq: seq++,
          at: new Date().toISOString(),
          kind: "error",
          text: msg,
        };
        run.events.push(errEvent);
        run.status = "failed";
        run.errorMessage = msg;
        run.finishedAt = new Date().toISOString();
        await upsertAiBotRun(run).catch(() => {});
        send(errEvent);
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
