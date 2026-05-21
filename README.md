# X Detector

![X Detector — watching 24 X handles with AI-generated @grok reply prompts](./images/screenshot.png)

A local desktop app that watches a list of X handles for new posts, fires a macOS notification when one shows up, and lets you reply with an AI-written `@grok` question in one click.

It's an Electron shell wrapping a Next.js dashboard. All scraping and posting happens through Playwright driving a real Chrome session that you log into once via the in-app **Connect with X** button.

## Why I built this

<img src="./images/buffer-status.png" alt="Buffer status page showing 17-hour ongoing outage and ~97% uptime" width="520" />

I kept hitting Buffer's status page during the work day. Multi-hour outages across web, iOS, Android and API; ~97% uptime over the last quarter. When the scheduling and posting layer is someone else's cloud, it goes down at exactly the moments you need it to be up.

This app runs entirely on your own machine. No backend, no SaaS account, no shared infrastructure. Your X session and AI keys live in a local data directory; the only network calls are to `x.com` and to the AI provider you've chosen. If it breaks, it breaks for you alone and you can fix it.

## Run it

```bash
cp .env.example .env.local
# set ANTHROPIC_API_KEY (required) and optionally OPENAI_API_KEY

npm install
npx playwright install chromium

npm run desktop
```

The desktop window opens on `/detector`. First time, click **Connect with X**, log in to X normally in the Chrome window that pops up, then click **I'm logged in**. Your session is saved to `.data/userdata/twitter/` for future scrapes and replies.

## How it works

- The Next.js server, the worker, and the Electron window all run from one `npm run desktop` invocation.
- The worker hits `/api/cron/watch-grok` every 90 s. The route scrapes each watched handle's timeline (headless), diffs against `.data/grok-state.json`, and surfaces new tweets to the UI + a native notification.
- Clicking **Reply with @grok** generates a contrarian question via Claude (or OpenAI) and posts it through a visible Chrome window so you can watch it type.
- Same Playwright user-data dir is shared by connect / scrape / reply, with an in-process mutex so they never collide on Chrome's profile lock.

## Layout

```
electron/         desktop shell (boots Next + worker, opens window)
app/
  detector/       the only page
  api/
    grok-*        settings / state / run / reply for the detector UI
    twitter-connect    open/close the login Chrome window
    cron/watch-grok    polled by the worker
components/       DetectorPanel (single component, runs the whole UI)
lib/
  grok-watcher    scrape + reply orchestration
  twitter-connect login flow
  browser/        Playwright session + scraping/replying
  ai, storage, types
worker/index.mjs  polling loop
```
