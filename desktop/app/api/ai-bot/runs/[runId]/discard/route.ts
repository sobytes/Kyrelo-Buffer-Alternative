import { NextRequest, NextResponse } from "next/server";
import { getAiBotRun } from "@/lib/storage";
import { discardDrafts } from "@/lib/ai-bot";

export const dynamic = "force-dynamic";

// POST /api/ai-bot/runs/[runId]/discard
// Body: { draftIds: string[] }
// Marks the named drafts as discarded. Doesn't touch any ScheduledPosts —
// drafts that were already scheduled stay where they are (use the scheduler
// queue's Cancel to remove those).
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
) {
  const { runId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { draftIds?: string[] };
  if (!Array.isArray(body.draftIds) || body.draftIds.length === 0) {
    return NextResponse.json(
      { error: "draftIds must be a non-empty string array" },
      { status: 400 },
    );
  }

  const run = await getAiBotRun(runId);
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  const result = await discardDrafts(run, body.draftIds);
  return NextResponse.json({ ok: true, discarded: result.discarded, run });
}
