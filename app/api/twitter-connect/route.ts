import { NextRequest, NextResponse } from "next/server";
import {
  cancelTwitterConnect,
  disconnectTwitter,
  endTwitterConnect,
  isConnectActive,
  isLoggedIn,
  startTwitterConnect,
} from "@/lib/twitter-connect";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({
    connected: await isLoggedIn(),
    connecting: isConnectActive(),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action === "start") {
    return NextResponse.json(await startTwitterConnect());
  }
  if (body.action === "done") {
    return NextResponse.json(await endTwitterConnect());
  }
  if (body.action === "cancel") {
    return NextResponse.json(await cancelTwitterConnect());
  }
  if (body.action === "disconnect") {
    return NextResponse.json(await disconnectTwitter());
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
