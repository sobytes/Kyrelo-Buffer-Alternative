import { NextResponse } from "next/server";
import { getWatchState, saveWatchState } from "@/lib/storage";
import { getPlatform } from "@/lib/platforms";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ platform: string }>;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { platform: slug } = await ctx.params;
  const platform = getPlatform(slug);
  if (!platform) {
    return NextResponse.json({ error: "unknown platform" }, { status: 404 });
  }
  return NextResponse.json({ state: await getWatchState(platform.slug) });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { platform: slug } = await ctx.params;
  const platform = getPlatform(slug);
  if (!platform) {
    return NextResponse.json({ error: "unknown platform" }, { status: 404 });
  }
  await saveWatchState(platform.slug, { bootstrapped: false, posts: [] });
  return NextResponse.json({ ok: true });
}
