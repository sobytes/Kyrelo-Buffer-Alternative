#!/usr/bin/env node
// Background poller. Ticks the scheduler dispatcher and the per-platform
// watch crons, popping native macOS notifications for new posts.

import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

function loadEnvFile(file) {
  try {
    const content = readFileSync(path.join(process.cwd(), file), "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // file missing — fine
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
const intervalMs = Number(process.env.WORKER_GROK_INTERVAL_MS ?? 90_000);
const schedulerIntervalMs = Number(process.env.WORKER_SCHEDULER_INTERVAL_MS ?? 30_000);

async function hit(path) {
  const res = await fetch(`${baseUrl}${path}`);
  const body = await res.text();
  console.log(`[${new Date().toISOString()}] ${path} → ${res.status} ${body.slice(0, 200)}`);
  return { status: res.status, body };
}

function macNotify(title, body) {
  if (process.platform !== "darwin") return;
  const esc = (s) =>
    String(s ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
  const script = `display notification "${esc(body)}" with title "${esc(title)}" sound name "Glass"`;
  const child = spawn("osascript", ["-e", script], { stdio: "ignore" });
  child.on("error", () => {});
}

// Platforms the watcher is wired up for. As new ones get their own `watch`
// implementations, add their slug here and they'll start ticking on the same
// cadence. Each platform's tick is independent, so a slow scrape on one
// doesn't block the others.
//
// `label` is what the user sees in notifications — keep it in sync with
// `PlatformMeta.label` in lib/platforms.ts (we duplicate here because the
// worker is a standalone Node script with no easy TS import path).
const WATCH_PLATFORMS = [
  { slug: "twitter", label: "X" },
  { slug: "threads", label: "Threads" },
  { slug: "linkedin", label: "LinkedIn" },
];

async function tickPlatform({ slug, label }) {
  try {
    const { body } = await hit(`/api/cron/watch/${slug}`);
    const json = JSON.parse(body);
    if (json.skipped || json.error) return;
    const posts = Array.isArray(json.newPosts) ? json.newPosts : [];
    for (const t of posts) {
      macNotify(
        `${label} · @${t.handle} ${t.isReply ? "replied" : "posted"}`,
        (t.text ?? "").slice(0, 100),
      );
    }
    if (posts.length > 0) {
      console.log(
        `[${new Date().toISOString()}] ${slug}: notified on ${posts.length} new posts`,
      );
    }
  } catch (err) {
    console.error(`watch ${slug} tick failed`, err);
  }
}

async function tick() {
  await Promise.all(WATCH_PLATFORMS.map(tickPlatform));
}

async function schedulerTick() {
  try {
    const { body } = await hit("/api/cron/scheduler");
    const json = JSON.parse(body);
    if (json.posted > 0) {
      macNotify(
        "Scheduled post sent",
        `${json.posted} post${json.posted === 1 ? "" : "s"} sent.`,
      );
    }
    if (json.failed > 0) {
      macNotify(
        "Scheduled post failed",
        `${json.failed} post${json.failed === 1 ? "" : "s"} failed.`,
      );
    }
  } catch (err) {
    console.error("scheduler tick failed", err);
  }
}

console.log(
  `Worker started. watch (${WATCH_PLATFORMS.map((p) => p.slug).join(",")}) every ${intervalMs / 1000}s, scheduler every ${schedulerIntervalMs / 1000}s.`,
);
// Fire the first ticks in parallel so a slow watch scrape can't block
// the scheduler from picking up due posts.
void tick();
void schedulerTick();
setInterval(tick, intervalMs);
setInterval(schedulerTick, schedulerIntervalMs);
