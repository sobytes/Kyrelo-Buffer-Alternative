import { NextRequest, NextResponse } from "next/server";
import { getAiBotRun } from "@/lib/storage";
import { scheduleDrafts } from "@/lib/ai-bot";

export const dynamic = "force-dynamic";

// POST /api/ai-bot/runs/[runId]/schedule
// Body: { draftIds: string[] }
// Promotes the named drafts into real ScheduledPosts with proposedBy="ai-bot".
// Idempotent — drafts already scheduled or discarded are skipped.
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

  const result = await scheduleDrafts(run, body.draftIds);
  return NextResponse.json({
    ok: true,
    scheduled: result.scheduledPostIds.length,
    scheduledPostIds: result.scheduledPostIds,
    skipped: result.skipped,
    run,
  });
}
