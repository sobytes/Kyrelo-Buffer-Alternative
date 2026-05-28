import { promises as fs } from "node:fs";
import path from "node:path";
import {
  AiBotAccountConfig,
  AiBotConfig,
  AiBotRun,
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
const AI_BOT_RUNS_KEY = "ai-bot-runs";
const AI_BOT_CONFIG_KEY = "ai-bot-config";

function aiBotConfigKey(platform: PlatformSlug, accountId: string): string {
  return `${platform}:${accountId}`;
}

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

// --- AI Bot runs -------------------------------------------------------------

// Bounded history: keep the last 50 runs on disk. A growth-coach run can carry
// a few KB of event log, so unbounded growth would balloon over time.
const AI_BOT_RUNS_LIMIT = 50;

export async function listAiBotRuns(): Promise<AiBotRun[]> {
  const raw = (await read<unknown[]>(AI_BOT_RUNS_KEY)) ?? [];
  // Two migrations applied on the way out:
  //  1. drafts: [] — earlier runs persisted before the proposedPostIds→drafts flip
  //  2. websiteUrl → websiteUrls — earlier runs stored a single URL string
  return raw.map((r) => normalizeStoredRun(r));
}

function normalizeStoredRun(raw: unknown): AiBotRun {
  const r = raw as Record<string, unknown>;
  const out = { ...r } as Record<string, unknown>;
  if (!Array.isArray(out.drafts)) out.drafts = [];
  if (!Array.isArray(out.websiteUrls)) {
    if (typeof out.websiteUrl === "string" && out.websiteUrl) {
      out.websiteUrls = [out.websiteUrl];
    }
    delete out.websiteUrl;
  }
  return out as unknown as AiBotRun;
}

export async function getAiBotRun(id: string): Promise<AiBotRun | null> {
  const all = await listAiBotRuns();
  return all.find((r) => r.id === id) ?? null;
}

// --- AI Bot per-account config ----------------------------------------------

export async function getAiBotConfig(): Promise<AiBotConfig> {
  const raw = await read<unknown>(AI_BOT_CONFIG_KEY);
  if (!raw || typeof raw !== "object") return { accounts: {} };
  const obj = raw as { accounts?: Record<string, unknown> };
  const accounts: Record<string, AiBotAccountConfig> = {};
  for (const [k, v] of Object.entries(obj.accounts ?? {})) {
    accounts[k] = normalizeStoredAccountConfig(v);
  }
  return { accounts };
}

function normalizeStoredAccountConfig(raw: unknown): AiBotAccountConfig {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const urls: string[] = Array.isArray(r.websiteUrls)
    ? (r.websiteUrls.filter(
        (u) => typeof u === "string" && u.trim(),
      ) as string[])
    : [];
  // Legacy single-URL field — promote to the array form on read so callers
  // never have to think about both shapes.
  if (
    typeof r.websiteUrl === "string" &&
    r.websiteUrl.trim() &&
    !urls.includes(r.websiteUrl)
  ) {
    urls.unshift(r.websiteUrl);
  }
  return urls.length > 0 ? { websiteUrls: urls.slice(0, 5) } : {};
}

export async function getAiBotAccountConfig(
  platform: PlatformSlug,
  accountId: string,
): Promise<AiBotAccountConfig> {
  const cfg = await getAiBotConfig();
  return cfg.accounts[aiBotConfigKey(platform, accountId)] ?? {};
}

export async function setAiBotAccountConfig(
  platform: PlatformSlug,
  accountId: string,
  patch: AiBotAccountConfig,
): Promise<void> {
  const cfg = await getAiBotConfig();
  const key = aiBotConfigKey(platform, accountId);
  cfg.accounts[key] = { ...cfg.accounts[key], ...patch };
  await write(AI_BOT_CONFIG_KEY, cfg);
}

export async function upsertAiBotRun(run: AiBotRun): Promise<void> {
  const all = await listAiBotRuns();
  const idx = all.findIndex((r) => r.id === run.id);
  if (idx >= 0) all[idx] = run;
  else all.push(run);
  const trimmed = all
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .slice(-AI_BOT_RUNS_LIMIT);
  await write(AI_BOT_RUNS_KEY, trimmed);
}

