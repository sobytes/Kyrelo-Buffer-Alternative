import { NextResponse } from "next/server";
import { getAiBotRun } from "@/lib/storage";

export const dynamic = "force-dynamic";

// GET a single run — used by the panel to re-open a run from history and act
// on its remaining "pending" drafts (e.g. user closed the window then came
// back later to decide).
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ runId: string }> },
) {
  const { runId } = await ctx.params;
  const run = await getAiBotRun(runId);
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  return NextResponse.json({ run });
}
