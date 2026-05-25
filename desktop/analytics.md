# Analytics / Engagement Plan

Goal: surface like / reply / repost / view counts for every scheduled post that
went out, so the user can see which posts performed best — without polling so
aggressively that we look like a bot.

## Strategy: milestone polling + on-demand refresh

After a post lands, fetch its metrics **3 times** during the engagement window:

| Tick | Offset from `postedAt` | Why                                      |
| ---- | ---------------------- | ---------------------------------------- |
| T1   | 1h ± 12 min            | Catches the initial-burst window         |
| T2   | 6h ± 30 min            | Catches mid-cycle algorithmic boosts     |
| T3   | 24h ± 60 min           | Final-ish numbers; engagement plateaus   |

Plus a manual **Refresh metrics** button in the UI.

Math: 3 fetches × N posts/day across 5 platforms. At 10 posts/day = 30
fetches/day total, spread over 24h with jitter. Indistinguishable from a real
user opening their own posts a few times.

### Why not a global poll loop

A naive "tick every X minutes and refresh everything" pattern
(a) wastes fetches on dead posts and
(b) gives platforms a recognisable cadence to fingerprint.

Per-post milestone scheduling is bounded by post count, naturally tapers, and
mirrors how a real human checks engagement.

## Data model

Extend `ScheduledPost` in `lib/types.ts`:

```ts
export interface EngagementSnapshot {
  fetchedAt: string;        // ISO
  views?: number;
  likes?: number;
  replies?: number;
  reposts?: number;         // RTs / shares / quotes
  bookmarks?: number;       // X-specific
}

export interface ScheduledPost {
  // ...existing...
  engagement?: EngagementSnapshot;        // latest snapshot
  engagementHistory?: EngagementSnapshot[]; // all snapshots for delta charts
  nextEngagementFetchAt?: string;         // ISO of next scheduled milestone
}
```

Keep the full history so we can show growth deltas
("+47 likes since last fetch") and tiny sparklines.

## Storage

No new file. Snapshots live inside the existing `scheduled-posts.json` next to
the post they describe. Keeps post + metrics atomic — cancel/delete the post,
the metrics go with it.

## Scheduling the fetches

Two options:

**Option A — inline in the scheduler tick (simplest).**
The existing `runDueScheduledPosts()` loop already wakes every 30s. Extend it
to also pick up posts where `nextEngagementFetchAt <= now` and fire the
appropriate platform service's `fetchEngagement(post)` method. Same dispatch
shape, same Chrome session reuse.

**Option B — separate cron `/api/cron/engagement` (cleaner).**
A second worker loop on a slower cadence (every 5 min) that only handles
metric fetches. Keeps post-send code decoupled from metric-fetch code.

Recommend **A** for v1 — it's one less moving part. Move to B if the queue
gets large.

## Per-service `fetchEngagement` method

Add to `PlatformService` interface:

```ts
fetchEngagement(post: ScheduledPost): Promise<EngagementSnapshot>;
```

Each platform implements it by:
1. Opening the existing logged-in Playwright session
2. Navigating to the post's `postedUrl`
3. Reading the visible metric counters via `page.evaluate()`
4. Returning the snapshot

### Per-platform notes

- **Twitter / X.** Scrape `[data-testid="like"]`, `[data-testid="reply"]`,
  `[data-testid="retweet"]`, and the view-count anchor. Numbers are
  human-formatted ("1.2K"); parser must handle that.
- **Threads.** Counters next to the post — likes, replies, reposts. Quotes
  are nested deeper. No views shown for personal posts.
- **LinkedIn.** "Reactions" (combined like-types), "comments", "reposts" on
  the post's permalink. Impressions shown only on author-view, which is
  what we are if logged in as the poster.
- **Facebook.** "Reactions" + "Comments" + "Shares" on the post's permalink.
  Reach/views only on Pages (Business), not personal profiles.
- **Instagram.** Likes + comments visible on the post permalink. Reach /
  impressions only via the Insights view (Business account only).
  Personal-account fallback: just likes + comments.

## Bot-detection guardrails

- Single in-flight fetch per platform at a time (reuse the existing
  per-platform browser mutex in `session.ts`).
- Use the same warmup-then-navigate pattern as the post + scrape flows so
  request fingerprints stay consistent.
- Cap retries: if a fetch errors twice in a row for the same post, abandon
  the milestone — don't keep hammering.
- Skip the fetch entirely if `postedUrl` is missing or doesn't match the
  expected `/status/`, `/p/`, `/feed/update/` shape — guards against
  half-broken posts.

## UI

Top-level **Analytics** section in the sidebar, with the same per-platform
sub-menu pattern as Scheduler / Connected / Monitor:

```
Analytics
  · Overview          /analytics            (best-of, sortable)
  · X                 /analytics/twitter
  · Threads           /analytics/threads
  · ...
```

### Overview page

Three rows of cards at the top:

- **Top post this week** (highest combined engagement)
- **Most-liked**
- **Most-replied**

Then a table:

| Posted at | Platform | Excerpt | Views | Likes | Replies | Reposts | Δ since last fetch |

Sortable by any column. Click a row → opens the original post in a new tab.

### Per-platform page

Same table filtered to one platform, plus a small sparkline of total
engagement over the last 30 days at the top.

### "Refresh metrics" button

On every row + a global one in the page header. Triggers an immediate
out-of-band fetch (same `fetchEngagement` method, ignores
`nextEngagementFetchAt`).

## Phasing

**Phase 1 — plumbing**
- Extend `ScheduledPost` type
- Add `fetchEngagement` to `PlatformService` interface
- Wire milestone scheduling into `runDueScheduledPosts()`
- Implement `fetchEngagement` for X only (everything else throws "not yet")

**Phase 2 — Threads + LinkedIn fetchers**

**Phase 3 — FB + IG fetchers**

**Phase 4 — UI: Analytics overview + per-platform pages**

**Phase 5 — Refresh-metrics button + delta display**

**Optional Phase 6 — Meta Graph API path** for FB / IG / Threads users with
Business accounts. Drop scraping for those three when the user opts in; keep
the scraping fallback for personal accounts. X / LinkedIn stay on scraping.

## Out of scope (for now)

- Tracking engagement on posts that were posted **outside** Kyrelo. Would
  need a "discover my recent posts" scraper per platform, plus a way to
  decide what counts as "ours". Possible later; not v1.
- Cross-platform engagement comparison ("same post did 4× on LinkedIn vs X")
  — needs cross-post linking in the data model. Mentioned in
  CrossPostPanel.tsx as "Posts created from the cross-poster are not
  linked"; relax that constraint if/when this becomes a priority.
- Audience analytics (follower growth, demographics) — different shape of
  fetch, different cadence.
