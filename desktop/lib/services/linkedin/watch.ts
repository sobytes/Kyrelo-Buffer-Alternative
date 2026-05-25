import { promises as fs } from "node:fs";
import path from "node:path";
import { Page } from "playwright";
import { jitter, openBrowser, warmup } from "@/lib/browser/session";
import { WatchInput, WatchedScrapedPost } from "../types";

// PHASE-3 NOTE: LinkedIn shows a person's recent activity at
//   https://www.linkedin.com/in/<vanity>/recent-activity/all/
// Posts there appear as `[data-urn^="urn:li:activity:..."]` blocks, mixed
// with comments-on-others and reposts. We filter for the user's own posts
// (the activity block contains `<vanity>` in its actor link).
//
// LinkedIn does not expose an absolute timestamp by default — only a
// relative one like "2h" / "1d". We try `<time datetime>` first and fall
// back to leaving `postedAt` undefined; the watcher's "too-old" cutoff
// will simply notify on every first sight.

async function dumpDebug(page: Page, label: string) {
  const dir = path.join(
    process.env.STORAGE_DIR ?? path.join(process.cwd(), ".data"),
    "debug",
  );
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const png = path.join(dir, `linkedin-watch-${label}-${stamp}.png`);
  await page.screenshot({ path: png, fullPage: true }).catch(() => {});
  console.log(`[linkedin-watch] saved debug → ${png}`);
}

function assertLoggedIn(page: Page) {
  const url = page.url();
  if (url.includes("/login") || url.includes("/checkpoint/")) {
    throw new Error(
      "LinkedIn session expired. Reconnect under Connected accounts.",
    );
  }
}

async function scrapeOnPage(
  page: Page,
  handle: string,
  limit: number,
): Promise<WatchedScrapedPost[]> {
  // LinkedIn vanity URLs are case-preserving in the path but lookups
  // are case-insensitive. We pass through whatever the user typed.
  const url = `https://www.linkedin.com/in/${handle}/recent-activity/all/`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await jitter(2500, 4500);
  assertLoggedIn(page);

  try {
    await page
      .locator('[data-urn^="urn:li:activity:"]')
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    await dumpDebug(page, `no-posts-${handle}`);
    return [];
  }

  // LinkedIn is heavy on lazy load — scroll a few times to surface more
  // activity blocks.
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 900);
    await jitter(900, 1700);
  }

  const handleLower = handle.toLowerCase();

  const posts = await page.evaluate(
    ({ handleLower, limit }) => {
      const out: {
        id: string;
        url: string;
        text: string;
        isReply: boolean;
        postedAt?: string;
      }[] = [];
      const seen = new Set<string>();

      const blocks = document.querySelectorAll(
        '[data-urn^="urn:li:activity:"]',
      ) as NodeListOf<HTMLElement>;
      for (const block of Array.from(blocks)) {
        if (out.length >= limit) break;
        const urn = block.getAttribute("data-urn") ?? "";
        const m = urn.match(/^urn:li:activity:(\d+)/);
        if (!m) continue;
        const id = m[1];
        if (seen.has(id)) continue;

        // Skip "<user> commented on <other>'s post" rows — LinkedIn renders
        // those as the same activity block shape but the actor row points
        // to a different vanity. We require an actor link that matches the
        // watched handle.
        const actorLink = block.querySelector(
          'a[href*="/in/"][data-test-app-aware-link], a[href*="/in/"]',
        ) as HTMLAnchorElement | null;
        const actorHref = actorLink?.getAttribute("href") ?? "";
        const actorMatch = actorHref.match(/\/in\/([^/?#]+)/);
        if (!actorMatch) continue;
        if (actorMatch[1].toLowerCase() !== handleLower) continue;

        // Detect repost markers — "<user> reposted this" header above the
        // original post. We treat those as `isReply = true` so the user
        // can tell originals from reshares in the feed.
        const headerText = (
          block.querySelector(".update-components-header__text-view") ??
          block.querySelector(".update-components-header") ??
          block.querySelector('[data-test-id="actor-name"]')
        )?.textContent?.toLowerCase() ?? "";
        const isReply = /reposted|commented/.test(headerText);

        // Post body — LinkedIn rotates class names but the description
        // container is consistently identified by its content children.
        const textEl =
          block.querySelector(".feed-shared-update-v2__description") ??
          block.querySelector(".update-components-text") ??
          block.querySelector('[data-test-id="main-feed-activity-card__commentary"]');
        const text = (textEl?.textContent ?? "").trim().replace(/\s+/g, " ");
        if (!text) continue;

        seen.add(id);

        // Absolute time — present sometimes via <time datetime>, fall back
        // to undefined.
        const timeEl = block.querySelector("time");
        const dt = timeEl?.getAttribute("datetime") ?? undefined;
        const postedAt =
          dt && !Number.isNaN(Date.parse(dt)) ? dt : undefined;

        const statusUrl = `https://www.linkedin.com/feed/update/urn:li:activity:${id}/`;
        out.push({ id, url: statusUrl, text, isReply, postedAt });
      }
      return out;
    },
    { handleLower, limit },
  );

  return posts.map((p) => ({ ...p, handle }));
}

export async function scrapeManyLinkedInTimelines(
  opts: WatchInput,
): Promise<WatchedScrapedPost[]> {
  if (opts.handles.length === 0) return [];
  const limit = opts.limit ?? 12;
  const handles = opts.handles.map((h) => h.replace(/^@/, "")).filter(Boolean);

  const browser = await openBrowser("linkedin", {
    headless: true,
    accountId: opts.accountId,
  });
  const { page } = browser;
  const out: WatchedScrapedPost[] = [];
  try {
    try {
      await warmup(page, "https://www.linkedin.com/feed/");
    } catch (err) {
      console.warn("[linkedin-watch] warmup skipped:", err);
    }
    assertLoggedIn(page);

    for (const handle of handles) {
      if (page.isClosed()) {
        console.warn("[linkedin-watch] page closed — aborting remaining scrapes");
        break;
      }
      try {
        const posts = await scrapeOnPage(page, handle, limit);
        out.push(...posts);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/closed|disconnect|crashed/i.test(msg)) {
          console.warn("[linkedin-watch] browser closed mid-scrape — aborting");
          break;
        }
        console.warn(`[linkedin-watch] scrape failed for ${handle}: ${msg}`);
      }
      await jitter(1000, 2200);
    }
    return out;
  } finally {
    await browser.close();
  }
}
