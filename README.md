# Kyrelo — Community Driven Buffer Alternative

A local desktop app and marketing site for **Kyrelo** — the open-source, community-driven Buffer alternative for scheduling and monitoring social posts across **X, Threads, LinkedIn, Facebook and Instagram**.

**Website:** [kyrelo.com](https://kyrelo.com/)
**Download the app here:** [GitHub Releases](https://github.com/sobytes/Kyrelo-Buffer-Alternative/releases/)

![Kyrelo desktop app](./website/public/screenshot.png)

## Why?

<img src="./website/public/buffer-status.png" alt="Buffer status page showing 17h ongoing outage and ~97% uptime" width="520" />

Buffer's status page is a working-day fixture. Multi-hour outages, ~97% uptime over the last quarter. When the scheduling layer is someone else's cloud, it breaks at exactly the moments you need it up.

Kyrelo runs entirely on your machine. No backend, no SaaS account, no shared infrastructure.

## Features

### Multi-platform scheduler

- Connect accounts and schedule posts on **X (Twitter), Threads, LinkedIn, Facebook and Instagram** from one app.
- **Cross-post composer** — write once, queue the same post across every connected platform in one shot.
- **Per-platform schedulers** (`/scheduler/twitter`, `/scheduler/threads`, …) with platform-aware character limits, media requirements and tone overlays.
- **Queue** view (`/scheduler/queue`) showing the whole upcoming timeline across networks, with a filter pill per platform.
- Image attachments stored locally in `.data/uploads/` and attached straight to the scheduled post.

### Safety rails

The scheduler has been hardened so a bad click can't blow up your account.

- Server-side **past-time guard**: any attempt to schedule for a moment that has already passed is rejected (30s grace). A buggy bulk reschedule can no longer fire 20 backlogged posts in a row.
- The **Re-gig & reschedule all** bulk action clamps its start time to "now + 1 minute" so negative jitter on the first post can't underflow into the past.
- **Cancel all pending** buttons on both the global Queue (respects the active platform filter) and each per-platform scheduler (scoped to the active account). Posts already mid-send (`posting`) are never touched.
- Posts left at `posting` because the app closed mid-send auto-recover to `failed` after 10 minutes so they don't sit forever.

### AI Bot — growth coach

A new sidebar panel that drafts a batch of posts for one of your accounts, grounded in your own product.

- Click **Plan a growth run** on any connected X account.
- Per account, save up to **5 knowledge URLs** (homepage, /features, /pricing, /about, /blog) — the agent scrapes them in parallel and reads them as grounding context.
- A Claude Sonnet 4.6 tool-use loop reads your watched posts, current queue and recent history, then drafts 3–8 posts spread over the next 24–72 hours, mixing opinion, tips, story and reply-bait formats.
- **Drafts stay off the scheduler queue until you approve them.** Per-draft Schedule / Discard buttons + batch "Schedule selected (N)" / "Discard selected" actions.
- AI-scheduled posts get a distinctive **AI PROPOSED** badge and accent left stripe everywhere they appear in the queue and scheduler.
- Em dashes, en dashes and ASCII hyphens are stripped from drafts to kill the most obvious "this was AI" tells.
- Across all drafts in a run, the agent is permitted to mention a URL in at most 2 posts (X penalises link-heavy accounts); the rest are pure-value posts.
- Past runs are persisted to disk — open any past run from the history list to act on its remaining drafts later.

### AI rewrites ("Re-gig")

- Re-word any post in the destination platform's native voice using Claude or OpenAI.
- **Bulk Re-gig & reschedule** on each platform's history: reword every history post and queue them out at a fixed interval with organic ±20% jitter (capped at half-interval so order is preserved).
- Platform-aware tone overlays — a LinkedIn rewrite reads professional, an X rewrite reads punchy, a Threads rewrite reads riffy and lowercase-friendly.

### Monitor — handle watcher

- Scrapes a list of handles per platform on a 90-second cycle and surfaces new posts in the Monitor view with optional desktop notifications.
- X-specific **@grok reply flow**: pick a watched tweet, have Claude generate a sharp @grok question, queue or fire the reply.
- Per-handle skip-on-bootstrap so you don't get flooded with 200 backfilled notifications the first time you add a watch.
- Headless / visible posting toggle so you can watch the browser if a flow is misbehaving.

### Local-first

- All data lives in `.data/` JSON files on your machine — no SaaS account, no shared backend, no telemetry.
- API keys (Anthropic + OpenAI) stored locally; settable via env or the Settings page.
- Cookies and sessions live in per-account Chrome profile directories on disk.
- macOS first-class; Windows + Linux builds in the release pipeline.

## Repo layout

| Folder | What it is |
|---|---|
| [`desktop/`](./desktop) | The Electron + Next.js + Playwright app. Scheduler, monitor, AI rewrites, growth coach. Built for macOS first. |
| [`website/`](./website) | The marketing site at [kyrelo.com](https://kyrelo.com). Plain Next.js + Tailwind, deploys to Vercel with **Root Directory = `website`**. |

## Quick start

### Desktop app

```bash
cd desktop
cp .env.example .env.local      # set ANTHROPIC_API_KEY (and OPENAI_API_KEY if you prefer OpenAI as the AI provider)
npm install
npx playwright install chromium
npm run desktop                 # boots Electron + Next dev server + worker
```

The app starts on port 3000, opens an Electron window, and runs a background worker that polls watched handles every 90s and dispatches due scheduled posts every 30s.

### Website

```bash
cd website
npm install
npm run dev                     # http://localhost:3001
```

## Data on disk

Everything is JSON files under your platform's user data directory (e.g. `~/Library/Application Support/kyrelo/data/` on macOS):

| File | Holds |
|---|---|
| `scheduled-posts.json` | Every scheduled post across all platforms (status: pending / posting / posted / failed). |
| `accounts-{platform}.json` | Connected accounts per platform. |
| `watch-state-{platform}.json` | The last ~200 posts scraped from monitored handles for that platform. |
| `watch-settings.json` | Handles per platform, AI provider choice, style hint, headless toggle. |
| `api-keys.json` | Anthropic + OpenAI keys (when set via Settings rather than env vars). |
| `ai-bot-config.json` | Per-account knowledge URLs for the AI Bot. |
| `ai-bot-runs.json` | Last 50 AI Bot runs — drafts, event logs, summaries. |
| `uploads/` | Image attachments referenced by scheduled posts. |

Delete any of these to reset that surface; nothing else gets touched.
