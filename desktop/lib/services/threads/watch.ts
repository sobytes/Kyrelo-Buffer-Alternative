import { promises as fs } from "node:fs";
import path from "node:path";
import { Page } from "playwright";
import { jitter, openBrowser, warmup } from "@/lib/browser/session";
import { WatchInput, WatchedScrapedPost } from "../types";

// PHASE-2 NOTE: Threads doesn't expose a clean "tweets/with_replies" split
// the way X does — the profile page mixes original posts and replies, with
// a "Replies" tab a click away. For now we scrape the default profile feed
// and rely on the "Replying to @x" header inside each post for the
// isReply flag.
//
// Selector strategy mirrors the Twitter scraper: prefer role-based queries
// that survive className changes, fall back to data-attrs where Threads
// exposes them.

async function dumpDebug(page: Page, label: string) {
  const dir = path.join(
    process.env.STORAGE_DIR ?? path.join(process.cwd(), ".data"),
    "debug",
  );
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const png = path.join(dir, `threads-watch-${label}-${stamp}.png`);
  await page.screenshot({ path: png, fullPage: true }).catch(() => {});
  console.log(`[threads-watch] saved debug → ${png}`);
}

function assertLoggedIn(page: Page) {
  const url = page.url();
  if (url.includes("/login") || url.includes("/accounts/login")) {
    throw new Error("Threads session expired. Reconnect under Connected accounts.");
  }
}

async function scrapeOnPage(
  page: Page,
  handle: string,
  limit: number,
): Promise<WatchedScrapedPost[]> {
  const url = `https://www.threads.com/@${handle}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await jitter(2000, 4000);
  assertLoggedIn(page);

  // Wait for at least one post to render. Threads marks each post container
  // with role="article" or wraps the timestamp anchor in a way we can match.
  try {
    await page
      .locator(
        'div[role="article"], a[href*="/post/"][role="link"]',
      )
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    await dumpDebug(page, `no-posts-${handle}`);
    return [];
  }

  // Lazy-load — scroll a couple of times to surface more posts.
  for (let i = 0; i < 2; i++) {
    await page.mouse.wheel(0, 700);
    await jitter(700, 1400);
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

      // Strategy: collect every link that points at a /post/<shortcode> on
      // the same handle, then walk up to the nearest container element to
      // pick out the post body text. This is more robust than guessing the
      // current `role="article"` wrapper class.
      const links = document.querySelectorAll(
        `a[href*="/post/"][role="link"]`,
      ) as NodeListOf<HTMLAnchorElement>;
      for (const a of Array.from(links)) {
        if (out.length >= limit) break;
        const href = a.getAttribute("href") ?? "";
        // Expected shape: /@handle/post/shortcode (with optional query).
        const m = href.match(/^\/@([^/]+)\/post\/([^/?#]+)/);
        if (!m) continue;
        if (m[1].toLowerCase() !== handleLower) continue;
        const id = m[2];
        if (seen.has(id)) continue;
        seen.add(id);

        // Find the enclosing post container — the closest <article> or the
        // anchor's grandparent if articles aren't used in the current build.
        const container =
          a.closest('[role="article"]') ??
          a.closest("article") ??
          a.parentElement?.parentElement ??
          a;

        const timeEl = container.querySelector("time");
        const postedAt = timeEl?.getAttribute("datetime") ?? undefined;

        // Body text — Threads renders the post body in nested spans. Grabbing
        // the container's text and stripping the leading "@handle · 2h" line
        // tends to work; we trim runs of whitespace down to single spaces.
        let text = (container.textContent ?? "").trim();
        // Strip the leading "@handle" (Threads prefixes each post with the
        // author handle as a link).
        text = text.replace(
          new RegExp(`^@?${handleLower}\\s*`, "i"),
          "",
        );
        // Strip a leading relative-time stamp like "2h" / "12m" / "1d".
        text = text.replace(/^\s*\d+[smhdw]\b\s*/i, "");
        text = text.replace(/\s+\n\s*/g, "\n").replace(/[ \t]+/g, " ").trim();
        if (!text) continue;

        // "Replying to" marker — Threads renders this as a separate row at
        // the top of the post.
        const isReply = Array.from(container.querySelectorAll("div, span"))
          .some((el) => /^Replying to /i.test(el.textContent ?? ""));

        const statusUrl = `https://www.threads.com/@${handleLower}/post/${id}`;
        out.push({ id, url: statusUrl, text, isReply, postedAt });
      }
      return out;
    },
    { handleLower, limit },
  );

  return posts.map((p) => ({ ...p, handle }));
}

export async function scrapeManyThreadsTimelines(
  opts: WatchInput,
): Promise<WatchedScrapedPost[]> {
  if (opts.handles.length === 0) return [];
  const limit = opts.limit ?? 12;
  const handles = opts.handles.map((h) => h.replace(/^@/, "")).filter(Boolean);

  const browser = await openBrowser("threads", {
    headless: true,
    accountId: opts.accountId,
  });
  const { page } = browser;
  const out: WatchedScrapedPost[] = [];
  try {
    try {
      await warmup(page, "https://www.threads.com/");
    } catch (err) {
      console.warn("[threads-watch] warmup skipped:", err);
    }
    assertLoggedIn(page);

    for (const handle of handles) {
      if (page.isClosed()) {
        console.warn("[threads-watch] page closed — aborting remaining scrapes");
        break;
      }
      try {
        const posts = await scrapeOnPage(page, handle, limit);
        out.push(...posts);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/closed|disconnect|crashed/i.test(msg)) {
          console.warn("[threads-watch] browser closed mid-scrape — aborting");
          break;
        }
        console.warn(`[threads-watch] scrape failed for @${handle}: ${msg}`);
      }
      await jitter(800, 1800);
    }
    return out;
  } finally {
    await browser.close();
  }
}
