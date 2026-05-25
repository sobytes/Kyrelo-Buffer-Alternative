// Single source of truth for the social platforms Kyrelo can work with.
// Sidebar, dynamic routes, placeholders, and (eventually) the scheduler
// dispatcher all read from this list.

export type PlatformSlug =
  | "twitter"
  | "threads"
  | "linkedin"
  | "facebook"
  | "instagram";

export type PlatformStatus = "live" | "coming-soon";

export interface PlatformMeta {
  slug: PlatformSlug;
  // Sidebar/header label. "X" not "Twitter" — internal slug stays `twitter`
  // so we don't migrate any existing scheduled-post records.
  label: string;
  status: PlatformStatus;
  // One-line teaser shown on the placeholder page until the platform ships.
  teaser: string;
  // Per-platform composer character limit. Used by the Scheduler textarea
  // so a 500-char Threads post doesn't show a (wrong) 4000-char counter.
  maxChars: number;
  // True when the platform won't accept a text-only post — Instagram feed
  // posts and Reels both require media. The composer disables the submit
  // button until an image is attached.
  requiresMedia?: boolean;
}

export const PLATFORMS: PlatformMeta[] = [
  {
    slug: "twitter",
    label: "X",
    status: "live",
    teaser: "Post to X.",
    maxChars: 4000, // X Premium / verified limit; free accounts cap at 280
  },
  {
    slug: "threads",
    label: "Threads",
    status: "live",
    teaser: "Cross-post to Threads from the same composer.",
    maxChars: 500,
  },
  {
    slug: "linkedin",
    label: "LinkedIn",
    status: "live",
    teaser: "Schedule professional updates to your LinkedIn profile.",
    maxChars: 3000,
  },
  {
    slug: "facebook",
    label: "Facebook",
    status: "live",
    teaser: "Push posts to a Facebook profile.",
    maxChars: 5000, // Facebook's hard ceiling is 63,206; 5k is a sane composer cap
  },
  {
    slug: "instagram",
    label: "Instagram",
    status: "live",
    teaser: "Queue feed posts with an attached image. Caption-only posts aren't supported by IG.",
    maxChars: 2200,
    requiresMedia: true,
  },
];

export const DEFAULT_PLATFORM: PlatformSlug = "twitter";

export function getPlatform(slug: string): PlatformMeta | null {
  return PLATFORMS.find((p) => p.slug === slug) ?? null;
}
