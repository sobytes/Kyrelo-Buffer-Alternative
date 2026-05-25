import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ApiKeys,
  ScheduledPost,
  SocialAccount,
  WatchedPost,
  WatchSettings,
  WatchState,
} from "./types";
import { PlatformSlug } from "./platforms";

const WATCH_SETTINGS_KEY = "watch-settings";
const LEGACY_WATCH_SETTINGS_KEY = "grok-settings";
const LEGACY_WATCH_STATE_KEY = "grok-state";
const API_KEYS_KEY = "api-keys";
const SCHEDULED_POSTS_KEY = "scheduled-posts";
const LEGACY_X_ACCOUNTS_KEY = "x-accounts";

function accountsKey(platform: PlatformSlug): string {
  return `accounts-${platform}`;
}

function watchStateKey(platform: PlatformSlug): string {
  return `watch-state-${platform}`;
}

const dataDir = process.env.STORAGE_DIR ?? path.join(process.cwd(), ".data");

async function read<T>(key: string): Promise<T | null> {
  try {
    const buf = await fs.readFile(path.join(dataDir, `${key}.json`), "utf8");
    return JSON.parse(buf) as T;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function write<T>(key: string, value: T): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, `${key}.json`), JSON.stringify(value, null, 2));
}

const DEFAULT_WATCH_SETTINGS: WatchSettings = {
  enabled: false,
  handles: {},
  includeReplies: true,
  aiProvider: "claude",
  styleHint:
    "Take a sharp devil's-advocate angle. Question an assumption, surface a downside, or argue the opposite is true.",
  notifyDesktop: true,
  headlessPosting: false,
};

export async function getWatchSettings(): Promise<WatchSettings> {
  // Read the current file first; fall back to the legacy `grok-settings.json`
  // and migrate it across if present. Settings are shared (the AI provider /
  // style hint / headless flag are also used by the scheduler).
  let stored = await read<Record<string, unknown>>(WATCH_SETTINGS_KEY);
  if (!stored) {
    const legacy = await read<Record<string, unknown>>(LEGACY_WATCH_SETTINGS_KEY);
    if (legacy) {
      stored = legacy;
      await write(WATCH_SETTINGS_KEY, legacy);
    }
  }
  if (!stored) return DEFAULT_WATCH_SETTINGS;
  const legacyHandle = typeof stored.handle === "string" ? stored.handle : null;

  // Handles can live on disk in three shapes:
  //   1. The current per-platform object: { twitter: ["foo"], threads: [...] }
  //   2. A flat array of X handles: ["foo", "bar"]            (Phase-1 shape)
  //   3. A single legacy `handle: "..."` string field         (pre-Phase-1)
  // Normalise all three into shape #1 on read.
  let handles: Partial<Record<PlatformSlug, string[]>>;
  if (
    stored.handles &&
    typeof stored.handles === "object" &&
    !Array.isArray(stored.handles)
  ) {
    handles = stored.handles as Partial<Record<PlatformSlug, string[]>>;
  } else if (Array.isArray(stored.handles)) {
    handles = { twitter: stored.handles as string[] };
  } else if (legacyHandle) {
    handles = { twitter: [legacyHandle] };
  } else {
    handles = {};
  }
  return {
    ...DEFAULT_WATCH_SETTINGS,
    ...(stored as Partial<WatchSettings>),
    handles,
  };
}

export async function saveWatchSettings(settings: WatchSettings): Promise<void> {
  await write(WATCH_SETTINGS_KEY, settings);
}

const DEFAULT_WATCH_STATE: WatchState = { bootstrapped: false, posts: [] };

export async function getWatchState(platform: PlatformSlug): Promise<WatchState> {
  let stored = await read<WatchState | LegacyGrokState>(watchStateKey(platform));

  // One-shot migration: legacy `grok-state.json` was X-only and stored its
  // entries under `tweets`. Move to `watch-state-twitter.json` and rename
  // the field on first read.
  if (!stored && platform === "twitter") {
    const legacy = await read<LegacyGrokState>(LEGACY_WATCH_STATE_KEY);
    if (legacy) {
      stored = legacy;
    }
  }
  if (!stored) return DEFAULT_WATCH_STATE;

  const maybeLegacy = stored as LegacyGrokState & WatchState;
  const posts: WatchedPost[] = Array.isArray(maybeLegacy.posts)
    ? maybeLegacy.posts
    : Array.isArray(maybeLegacy.tweets)
      ? maybeLegacy.tweets
      : [];
  for (const p of posts) {
    if (!p.handle) {
      const m = p.url?.match(/^https?:\/\/[^/]+\/([^/]+)\/status\//);
      if (m) p.handle = m[1].toLowerCase();
    }
  }
  const normalized: WatchState = {
    bootstrapped: !!maybeLegacy.bootstrapped,
    lastCheckedAt: maybeLegacy.lastCheckedAt,
    posts,
  };
  // If we just migrated from the legacy `tweets` shape, persist the new
  // shape so future reads don't have to redo this work.
  if ("tweets" in maybeLegacy && !("posts" in maybeLegacy)) {
    await write(watchStateKey(platform), normalized).catch(() => {});
  }
  return normalized;
}

export async function saveWatchState(
  platform: PlatformSlug,
  state: WatchState,
): Promise<void> {
  const trimmed: WatchState = { ...state, posts: state.posts.slice(-200) };
  await write(watchStateKey(platform), trimmed);
}

// Shape on disk before the rename. Kept here, not exported.
interface LegacyGrokState {
  bootstrapped?: boolean;
  lastCheckedAt?: string;
  tweets?: WatchedPost[];
}

export async function getApiKeys(): Promise<ApiKeys> {
  return (await read<ApiKeys>(API_KEYS_KEY)) ?? {};
}

export async function saveApiKeys(keys: ApiKeys): Promise<void> {
  await write(API_KEYS_KEY, keys);
}

export async function listScheduledPosts(): Promise<ScheduledPost[]> {
  return (await read<ScheduledPost[]>(SCHEDULED_POSTS_KEY)) ?? [];
}

export async function saveScheduledPosts(posts: ScheduledPost[]): Promise<void> {
  await write(SCHEDULED_POSTS_KEY, posts);
}

export async function upsertScheduledPost(post: ScheduledPost): Promise<void> {
  const all = await listScheduledPosts();
  const idx = all.findIndex((p) => p.id === post.id);
  if (idx >= 0) all[idx] = post;
  else all.push(post);
  await saveScheduledPosts(all);
}

export async function deleteScheduledPost(id: string): Promise<void> {
  const all = await listScheduledPosts();
  await saveScheduledPosts(all.filter((p) => p.id !== id));
}

// --- Per-platform account storage --------------------------------------------

export async function listAccounts(platform: PlatformSlug): Promise<SocialAccount[]> {
  const list = await read<SocialAccount[]>(accountsKey(platform));
  if (list) return list;

  // One-shot migration: the original X-only build stored accounts under
  // `x-accounts.json` with no `platform` field. Migrate them into the
  // platform-keyed store the first time we read twitter accounts.
  if (platform === "twitter") {
    const legacy = await read<Array<Omit<SocialAccount, "platform">>>(
      LEGACY_X_ACCOUNTS_KEY,
    );
    if (legacy && legacy.length > 0) {
      const migrated: SocialAccount[] = legacy.map((a) => ({
        ...a,
        platform: "twitter",
      }));
      await write(accountsKey(platform), migrated);
      return migrated;
    }
  }
  return [];
}

export async function saveAccounts(
  platform: PlatformSlug,
  accounts: SocialAccount[],
): Promise<void> {
  await write(accountsKey(platform), accounts);
}

