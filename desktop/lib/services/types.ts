import { PlatformSlug } from "@/lib/platforms";
import { SocialAccount } from "@/lib/types";

export interface ConnectStartResult {
  ok?: true;
  error?: string;
  chromeMissing?: boolean;
}

export interface ConnectEndResult {
  ok?: true;
  handle?: string;
  error?: string;
}

export interface DisconnectResult {
  ok?: true;
  error?: string;
}

export interface PostInput {
  accountId: string;
  text: string;
  imagePath?: string;
  headless: boolean;
}

export interface PostResult {
  url?: string;
}

export interface WatchInput {
  accountId: string;
  handles: string[];
  includeReplies: boolean;
  limit?: number;
}

export interface WatchedScrapedPost {
  id: string;
  handle: string;
  url: string;
  text: string;
  isReply: boolean;
  postedAt?: string;
}

// Every platform module implements this interface. The scheduler dispatcher,
// the generic /api/connect/[platform] route, and the UI panels are all
// platform-agnostic and talk to platforms through this contract.
export interface PlatformService {
  slug: PlatformSlug;

  // --- Connect lifecycle ---------------------------------------------------
  isConnectActive(): boolean;
  startConnect(): Promise<ConnectStartResult>;
  endConnect(): Promise<ConnectEndResult>;
  cancelConnect(): Promise<{ ok: true }>;
  disconnect(accountId: string): Promise<DisconnectResult>;

  // --- Accounts ------------------------------------------------------------
  listAccounts(): Promise<SocialAccount[]>;
  getDefaultAccountId(): Promise<string | null>;

  // --- Posting -------------------------------------------------------------
  post(input: PostInput): Promise<PostResult>;

  // --- Optional: timeline watching ----------------------------------------
  // Scrape the most recent posts from the given handles using the connected
  // account's session. Only implemented on platforms whose public profile
  // pages are useful to watch (twitter today; threads/linkedin in Phase 2).
  // Platforms without this capability return `null` from getService(...).watch
  // — callers should check before invoking.
  watch?(input: WatchInput): Promise<WatchedScrapedPost[]>;
}
