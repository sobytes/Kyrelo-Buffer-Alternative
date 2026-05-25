import { NextRequest, NextResponse } from "next/server";
import { getService } from "@/lib/services";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ platform: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { platform } = await ctx.params;
  const service = getService(platform);
  if (!service) {
    return NextResponse.json({ error: "unknown platform" }, { status: 404 });
  }
  try {
    const accounts = await service.listAccounts();
    return NextResponse.json({
      platform: service.slug,
      accounts,
      connecting: service.isConnectActive(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[connect/${platform}] GET error:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { platform } = await ctx.params;
  const service = getService(platform);
  if (!service) {
    return NextResponse.json({ error: "unknown platform" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    action?: "start" | "done" | "cancel" | "disconnect";
    accountId?: string;
  };
  try {
    switch (body.action) {
      case "start":
        return NextResponse.json(await service.startConnect());
      case "done":
        return NextResponse.json(await service.endConnect());
      case "cancel":
        return NextResponse.json(await service.cancelConnect());
      case "disconnect":
        if (!body.accountId) {
          return NextResponse.json(
            { error: "accountId required" },
            { status: 400 },
          );
        }
        return NextResponse.json(await service.disconnect(body.accountId));
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[connect/${platform}] route error:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
