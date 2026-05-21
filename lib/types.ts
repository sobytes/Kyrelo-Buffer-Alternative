export type AiProvider = "claude" | "openai";

export interface ApiKeys {
  anthropic?: string;
  openai?: string;
}

export interface GrokSettings {
  enabled: boolean;
  handles: string[];
  includeReplies: boolean;
  aiProvider: AiProvider;
  styleHint: string;
  notifyDesktop: boolean;
}

export interface SeenTweet {
  id: string;
  /** Handle this tweet was scraped from. */
  handle: string;
  text: string;
  url: string;
  isReply: boolean;
  seenAt: string;
  /** ISO timestamp pulled from the tweet's <time datetime> element. */
  postedAt?: string;
  repliedAt?: string;
  replyText?: string;
  replyError?: string;
  /** Marked when this tweet was already too old when we first saw it. */
  skipped?: "too-old";
}

export interface GrokState {
  bootstrapped: boolean;
  lastCheckedAt?: string;
  tweets: SeenTweet[];
}
