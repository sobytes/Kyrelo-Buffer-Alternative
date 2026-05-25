import { NextRequest, NextResponse } from "next/server";
import { rewritePost } from "@/lib/ai";
import { getWatchSettings } from "@/lib/storage";
import { getPlatform } from "@/lib/platforms";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    text?: string;
    platform?: string;
  };
  if (!body.text || !body.text.trim()) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  // Optional platform tone overlay. Unknown slug → no overlay (generic
  // rewrite); we don't 400 here because the field is optional.
  const platformMeta = body.platform ? getPlatform(body.platform) : null;
  const settings = await getWatchSettings();
  try {
    const text = await rewritePost({
      text: body.text,
      provider: settings.aiProvider,
      platform: platformMeta?.slug,
    });
    return NextResponse.json({
      ok: true,
      text,
      provider: settings.aiProvider,
      platform: platformMeta?.slug ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
