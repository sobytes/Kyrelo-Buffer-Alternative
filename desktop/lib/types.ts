import { PlatformSlug } from "./platforms";

export type AiProvider = "claude" | "openai";

export interface ApiKeys {
  anthropic?: string;
  openai?: string;
}

export interface WatchSettings {
  enabled: boolean;
  // Per-platform list of handles to watch. The original X-only build stored
  // these as a flat `handles: string[]`; on first read the storage layer
  // migrates that into `handles.twitter` so existing watch lists survive.
  handles: Partial<Record<PlatformSlug, string[]>>;
  includeReplies: boolean;
  aiProvider: AiProvider;
  styleHint: string;
  notifyDesktop: boolean;
  /** When true, scheduled posts run with the browser hidden. Default: false (visible). */
  headlessPosting?: boolean;
}

export interface WatchedPost {
  id: string;
  /** Handle this post was scraped from. */
  handle: string;
  text: string;
  url: string;
  isReply: boolean;
  seenAt: string;
  /** ISO timestamp pulled from the post's <time datetime> element where available. */
  postedAt?: string;
  // --- Reply lifecycle (currently X-only; @grok flow) -----------------------
  repliedAt?: string;
  replyText?: string;
  replyError?: string;
  /** Marked when this post was already too old when we first saw it. */
  skipped?: "too-old";
}

export interface WatchState {
  bootstrapped: boolean;
  lastCheckedAt?: string;
  posts: WatchedPost[];
}

export type ScheduledPlatform = PlatformSlug;
export type ScheduledStatus = "pending" | "posting" | "posted" | "failed";

export interface ScheduledPost {
  id: string;
  platform: ScheduledPlatform;
  /** Account ID this post is sent from (SocialAccount.id). Optional for legacy posts. */
  accountId?: string;
  text: string;
  /** Filename inside .data/uploads/ — set when the user attached an image. */
  imagePath?: string;
  scheduledFor: string;
  createdAt: string;
  status: ScheduledStatus;
  postedAt?: string;
  postedUrl?: string;
  error?: string;
}

export interface SocialAccount {
  /** Lowercased handle. Also the name of the Chrome profile dir on disk. Unique per platform. */
  id: string;
  /** Handle as captured from the platform, preserving case. */
  handle: string;
  platform: PlatformSlug;
  addedAt: string;
}
