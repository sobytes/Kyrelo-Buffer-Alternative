import { NextRequest, NextResponse } from "next/server";
import { listScheduledPosts, saveScheduledPosts } from "@/lib/storage";

export const dynamic = "force-dynamic";

// Bulk-cancel pending scheduled posts. Optional filters narrow the scope so
// the per-platform Scheduler page can clear just its own queue without
// touching other platforms' pending posts. Posts already in "posting" are
// left alone — they're mid-send, and the worker will resolve them shortly.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    platform?: string;
    accountId?: string;
    proposedBy?: "ai-bot";
  };

  const all = await listScheduledPosts();
  const shouldCancel = (p: (typeof all)[number]) => {
    if (p.status !== "pending") return false;
    if (body.platform && p.platform !== body.platform) return false;
    if (body.accountId && p.accountId !== body.accountId) return false;
    if (body.proposedBy && p.proposedBy !== body.proposedBy) return false;
    return true;
  };

  const remaining = all.filter((p) => !shouldCancel(p));
  const cancelled = all.length - remaining.length;
  await saveScheduledPosts(remaining);
  return NextResponse.json({ ok: true, cancelled });
}
