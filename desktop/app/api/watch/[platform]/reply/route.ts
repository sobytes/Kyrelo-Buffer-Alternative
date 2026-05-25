import { NextRequest, NextResponse } from "next/server";
import { generateReplyFor, markReplied } from "@/lib/watcher";
import { getPlatform } from "@/lib/platforms";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface Ctx {
  params: Promise<{ platform: string }>;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { platform: slug } = await ctx.params;
  const platform = getPlatform(slug);
  if (!platform) {
    return NextResponse.json({ error: "unknown platform" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    action?: "generate" | "mark";
    postId?: string;
    // Accepts `tweetId` too so legacy callers don't 400. Same field.
    tweetId?: string;
    replyText?: string;
  };
  const postId = body.postId ?? body.tweetId;
  if (!postId) {
    return NextResponse.json({ error: "postId required" }, { status: 400 });
  }
  if (body.action === "generate") {
    const result = await generateReplyFor(platform.slug, postId);
    // Legacy field name for the existing DetectorPanel that reads `tweetId`.
    return NextResponse.json({ ...result, tweetId: postId });
  }
  if (body.action === "mark") {
    return NextResponse.json(
      await markReplied(platform.slug, postId, body.replyText ?? ""),
    );
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
