import { NextRequest, NextResponse } from "next/server";
import {
  getWatchSettings,
  saveWatchSettings,
  saveWatchState,
} from "@/lib/storage";
import { WatchSettings } from "@/lib/types";
import { PlatformSlug, getPlatform } from "@/lib/platforms";

function normalizeHandleList(handles: unknown): string[] {
  if (!Array.isArray(handles)) return [];
  return Array.from(
    new Set(
      handles
        .map((h) => (typeof h === "string" ? h.trim().replace(/^@/, "").toLowerCase() : ""))
        .filter(Boolean),
    ),
  );
}

function normalizeHandles(
  input: unknown,
): Partial<Record<PlatformSlug, string[]>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Partial<Record<PlatformSlug, string[]>> = {};
  for (const [slug, list] of Object.entries(input as Record<string, unknown>)) {
    if (!getPlatform(slug)) continue;
    const cleaned = normalizeHandleList(list);
    if (cleaned.length > 0) out[slug as PlatformSlug] = cleaned;
  }
  return out;
}

export async function GET() {
  return NextResponse.json({ settings: await getWatchSettings() });
}

export async function PUT(req: NextRequest) {
  const current = await getWatchSettings();
  const patch = (await req.json()) as Partial<WatchSettings>;
  const next: WatchSettings = {
    ...current,
    ...patch,
    handles: patch.handles ? normalizeHandles(patch.handles) : current.handles,
  };
  await saveWatchSettings(next);

  // For each platform whose handle list changed, drop that platform's
  // seen-post state so stale entries from removed handles don't linger.
  const changedPlatforms: PlatformSlug[] = [];
  for (const slug of Object.keys({ ...current.handles, ...next.handles }) as PlatformSlug[]) {
    const before = current.handles[slug] ?? [];
    const after = next.handles[slug] ?? [];
    const same =
      before.length === after.length &&
      before.every((h, i) => h.toLowerCase() === after[i]?.toLowerCase());
    if (!same) changedPlatforms.push(slug);
  }
  await Promise.all(
    changedPlatforms.map((slug) =>
      saveWatchState(slug, { bootstrapped: false, posts: [] }),
    ),
  );

  return NextResponse.json({ settings: next });
}
