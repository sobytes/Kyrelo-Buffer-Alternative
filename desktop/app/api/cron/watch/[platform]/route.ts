import { NextResponse } from "next/server";
import { runWatcher } from "@/lib/watcher";
import { getPlatform } from "@/lib/platforms";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface Ctx {
  params: Promise<{ platform: string }>;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { platform: slug } = await ctx.params;
  const platform = getPlatform(slug);
  if (!platform) {
    return NextResponse.json({ error: "unknown platform" }, { status: 404 });
  }
  const result = await runWatcher(platform.slug);
  return NextResponse.json(result);
}
