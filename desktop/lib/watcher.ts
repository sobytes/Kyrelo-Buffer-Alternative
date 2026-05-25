import { generateGrokQuestion } from "./ai";
import {
  getWatchSettings,
  getWatchState,
  saveWatchState,
} from "./storage";
import { getService, isAnyConnectActive } from "./services";
import { PlatformSlug } from "./platforms";
import { WatchedPost } from "./types";

function mergeSeen(existing: WatchedPost[], fresh: WatchedPost[]): WatchedPost[] {
  const byId = new Map(existing.map((t) => [t.id, t]));
  for (const f of fresh) {
    const prev = byId.get(f.id);
    if (prev) {
      // Keep existing state but refresh postedAt and handle if newly available.
      if (!prev.postedAt && f.postedAt) prev.postedAt = f.postedAt;
      if (!prev.handle && f.handle) prev.handle = f.handle;
    } else {
      byId.set(f.id, f);
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.seenAt.localeCompare(b.seenAt));
}

export interface NotifyPost {
  id: string;
  handle: string;
  url: string;
  text: string;
  isReply: boolean;
}

export interface WatchResult {
  platform: PlatformSlug;
  skipped?: string;
  error?: string;
  seen?: number;
  newPosts?: NotifyPost[];
}

/**
 * Run the watcher tick for a single platform. The platform service must
 * implement the optional `watch` capability — otherwise the result reports
 * skipped="not-supported".
 */
export async function runWatcher(platform: PlatformSlug): Promise<WatchResult> {
  const settings = await getWatchSettings();
  if (!settings.enabled) return { platform, skipped: "disabled" };
  if (isAnyConnectActive()) return { platform, skipped: "connecting" };

  const service = getService(platform);
  if (!service) return { platform, error: `unknown platform "${platform}"` };
  if (!service.watch) {
    return { platform, skipped: "not-supported" };
  }

  const handles = (settings.handles[platform] ?? []).filter(Boolean);
  if (handles.length === 0) return { platform, skipped: "no-handles" };

  const accountId = await service.getDefaultAccountId();
  if (!accountId) return { platform, skipped: "no-account" };

  const now = new Date();
  const state = await getWatchState(platform);
  const existingIds = new Set(state.posts.map((t) => t.id));

  let scraped;
  try {
    scraped = await service.watch({
      accountId,
      handles,
      includeReplies: settings.includeReplies,
      limit: 12,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { platform, error: `scrape failed: ${message}` };
  }

  const fresh: WatchedPost[] = scraped.map((t) => ({
    id: t.id,
    handle: t.handle,
    text: t.text,
    url: t.url,
    isReply: t.isReply,
    postedAt: t.postedAt,
    seenAt: now.toISOString(),
  }));

  const merged = mergeSeen(state.posts, fresh);

  // "Too old" guard for bootstrap: posts older than (notifyWindowMin) at
  // first-sight shouldn't surface as notifications. Protects against
  // time-traveling when first enabling a handle.
  const notifyWindowMin = 60;
  for (const t of merged) {
    if (t.skipped || t.repliedAt) continue;
    if (!t.postedAt) continue;
    const ageMin = (now.getTime() - new Date(t.postedAt).getTime()) / 60_000;
    if (!existingIds.has(t.id) && ageMin > notifyWindowMin) {
      t.skipped = "too-old";
    }
  }

  const newPosts: NotifyPost[] = merged
    .filter((t) => !existingIds.has(t.id) && !t.skipped)
    .map((t) => ({
      id: t.id,
      handle: t.handle,
      url: t.url,
      text: t.text,
      isReply: t.isReply,
    }));

  await saveWatchState(platform, {
    bootstrapped: true,
    lastCheckedAt: now.toISOString(),
    posts: merged,
  });

  return {
    platform,
    seen: scraped.length,
    newPosts,
  };
}

// --- X-specific reply lifecycle ---------------------------------------------
// The @grok reply flow only makes sense on X. Other platforms will get their
// own reply flows (or none) in later phases.

export interface ReplyOutcome {
  postId: string;
  ok: boolean;
  reply?: string;
  error?: string;
}

export async function generateReplyFor(
  platform: PlatformSlug,
  postId: string,
): Promise<ReplyOutcome> {
  if (platform !== "twitter") {
    return {
      postId,
      ok: false,
      error: `Replies aren't wired up for ${platform} yet.`,
    };
  }
  const settings = await getWatchSettings();
  const state = await getWatchState(platform);
  const post = state.posts.find((t) => t.id === postId);
  if (!post) return { postId, ok: false, error: "post not in state" };
  try {
    const reply = await generateGrokQuestion({
      tweetText: post.text,
      styleHint: settings.styleHint,
      provider: settings.aiProvider,
    });
    return { postId, ok: true, reply };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { postId, ok: false, error: message };
  }
}

export async function markReplied(
  platform: PlatformSlug,
  postId: string,
  replyText: string,
): Promise<{ ok: boolean; error?: string }> {
  const state = await getWatchState(platform);
  const post = state.posts.find((t) => t.id === postId);
  if (!post) return { ok: false, error: "post not in state" };
  post.replyText = replyText;
  post.repliedAt = new Date().toISOString();
  post.replyError = undefined;
  await saveWatchState(platform, state);
  return { ok: true };
}
