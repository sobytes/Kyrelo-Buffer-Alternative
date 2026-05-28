import { NextRequest, NextResponse } from "next/server";
import { createScheduledPost } from "@/lib/scheduler";
import { listScheduledPosts } from "@/lib/storage";
import { getPlatform } from "@/lib/platforms";

export const dynamic = "force-dynamic";

// imagePath must match what /api/scheduler/upload wrote — basename only,
// random suffix + image extension. Anything else (path separators, dotfiles,
// arbitrary disk paths) is rejected so the scheduler can't be tricked into
// attaching a file from outside the uploads/ dir.
const SAFE_IMAGE_PATH = /^[A-Za-z0-9_\-]{6,}\.(png|jpg|jpeg|gif|webp)$/i;

export async function GET() {
  const posts = await listScheduledPosts();
  return NextResponse.json({ posts });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    platform?: string;
    accountId?: string;
    text?: string;
    imagePath?: string;
    scheduledFor?: string;
  };
  if (!body.text || !body.scheduledFor || !body.platform || !body.accountId) {
    return NextResponse.json(
      { error: "platform, accountId, text, and scheduledFor are required" },
      { status: 400 },
    );
  }
  // Reject unknown platforms server-side — defends against typo'd UI bugs
  // and ensures every stored post has a slug the dispatcher knows how to
  // route. Honours the platform registry as the single source of truth.
  const platform = getPlatform(body.platform);
  if (!platform) {
    return NextResponse.json(
      { error: `unknown platform "${body.platform}"` },
      { status: 400 },
    );
  }
  if (body.imagePath && !SAFE_IMAGE_PATH.test(body.imagePath)) {
    return NextResponse.json({ error: "invalid imagePath" }, { status: 400 });
  }
  // Instagram requires media; reject text-only posts up-front so they never
  // reach the dispatcher and fail half-an-hour later.
  if (platform.requiresMedia && !body.imagePath) {
    return NextResponse.json(
      {
        error: `${platform.label} requires an image — attach one before scheduling.`,
      },
      { status: 400 },
    );
  }
  const when = new Date(body.scheduledFor);
  if (Number.isNaN(when.getTime())) {
    return NextResponse.json({ error: "invalid scheduledFor date" }, { status: 400 });
  }
  // Never accept a past time — the worker would fire it on the next tick, and
  // a buggy bulk-reschedule could otherwise queue dozens of posts to send
  // back-to-back. 30s grace covers clock skew between the UI and this process.
  if (when.getTime() < Date.now() - 30_000) {
    return NextResponse.json(
      { error: "scheduledFor is in the past — pick a future time." },
      { status: 400 },
    );
  }
  const post = await createScheduledPost({
    platform: platform.slug,
    accountId: body.accountId,
    text: body.text.trim(),
    imagePath: body.imagePath || undefined,
    scheduledFor: when.toISOString(),
  });
  return NextResponse.json({ post });
}
