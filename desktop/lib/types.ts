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
  /** Set when an AI agent proposed this post. Currently "ai-bot" for growth-coach drafts. */
  proposedBy?: "ai-bot";
}

// --- AI Bot ------------------------------------------------------------------

export type AiBotRunStatus = "running" | "completed" | "failed" | "cancelled";

/**
 * pending  — drafted by the agent; not yet on the scheduler queue.
 * scheduled — user approved; a ScheduledPost was created and linked via scheduledPostId.
 * discarded — user threw it away.
 */
export type AiBotDraftStatus = "pending" | "scheduled" | "discarded";

export interface AiBotDraft {
  id: string;
  text: string;
  /** ISO 8601 — when the draft would fire if scheduled as-is. The user can edit this when approving. */
  scheduledFor: string;
  /** Agent's one-line reason for this post. Not posted, just shown in the UI. */
  rationale?: string;
  status: AiBotDraftStatus;
  /** Set once status === "scheduled" — points at the ScheduledPost.id created on approval. */
  scheduledPostId?: string;
  createdAt: string;
}

export interface AiBotEvent {
  /** Monotonically increasing within a run; first event is 0. */
  seq: number;
  at: string;
  /**
   * thinking: short status line.
   * tool_call: model invoked a tool.
   * tool_result: result that came back.
   * draft: a new proposal was recorded (NOT yet on the queue — user must approve).
   * final: closing summary.
   * error: terminal failure.
   */
  kind: "thinking" | "tool_call" | "tool_result" | "draft" | "final" | "error";
  text?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResultPreview?: string;
  /** Set when kind === "draft" — the AiBotDraft.id that was just added to the run. */
  draftId?: string;
}

export interface AiBotRun {
  id: string;
  platform: ScheduledPlatform;
  accountId: string;
  startedAt: string;
  finishedAt?: string;
  status: AiBotRunStatus;
  events: AiBotEvent[];
  drafts: AiBotDraft[];
  errorMessage?: string;
  /** URLs scraped as knowledge context for this run. */
  websiteUrls?: string[];
}

export interface AiBotAccountConfig {
  /** URLs the agent scrapes for product/voice context before drafting. Hard cap of 5. */
  websiteUrls?: string[];
}

export interface AiBotConfig {
  /** Keyed by `${platform}:${accountId}` so configs are scoped per account. */
  accounts: Record<string, AiBotAccountConfig>;
}

export interface SocialAccount {
  /** Lowercased handle. Also the name of the Chrome profile dir on disk. Unique per platform. */
  id: string;
  /** Handle as captured from the platform, preserving case. */
  handle: string;
  platform: PlatformSlug;
  addedAt: string;
}
