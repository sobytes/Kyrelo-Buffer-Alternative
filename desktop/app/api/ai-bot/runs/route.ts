import { NextResponse } from "next/server";
import { listAiBotRuns } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const runs = await listAiBotRuns();
  // Most-recent-first so the page can render without re-sorting.
  runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return NextResponse.json({ runs });
}
