import { Page } from "playwright";
import { jitter, openBrowser, warmup } from "./session";

function assertLoggedIn(page: Page) {
  const url = page.url();
  if (url.includes("/login") || url.includes("/i/flow/login")) {
    throw new Error("X session expired. Reconnect under Connected accounts.");
  }
}

export interface PostResult {
  url?: string;
}

const COMPOSER_SELECTORS = [
  'div[data-testid="tweetTextarea_0"]',
  'div[data-testid^="tweetTextarea"][role="textbox"]',
  'div[role="textbox"][aria-label*="Post text"]',
  'div[role="textbox"][aria-label*="Tweet text"]',
  'div[contenteditable="true"][role="textbox"]',
];

const SUBMIT_SELECTORS = [
  'button[data-testid="tweetButton"]',
  'button[data-testid="tweetButtonInline"]',
];

export async function postTweetBrowser(
  accountId: string,
  text: string,
): Promise<PostResult> {
  const browser = await openBrowser("twitter", { headless: true, accountId });
  const { page } = browser;
  try {
    try {
      await warmup(page, "https://x.com/home");
    } catch (err) {
      console.warn("[twitter-post] warmup skipped:", err);
    }
    assertLoggedIn(page);

    await page.goto("https://x.com/compose/post", { waitUntil: "domcontentloaded" });
    await jitter(1500, 3000);
    assertLoggedIn(page);

    let composer = null as ReturnType<Page["locator"]> | null;
    for (const sel of COMPOSER_SELECTORS) {
      const loc = page.locator(sel).first();
      try {
        await loc.waitFor({ state: "visible", timeout: 6_000 });
        composer = loc;
        break;
      } catch {
        // try next
      }
    }
    if (!composer) throw new Error("Couldn't find tweet composer");

    await composer.click();
    await jitter(300, 800);
    await page.keyboard.type(text, { delay: 25 });
    await jitter(800, 1500);

    let submitted = false;
    for (const sel of SUBMIT_SELECTORS) {
      const btn = page.locator(sel).first();
      try {
        await btn.waitFor({ state: "visible", timeout: 4_000 });
        if (await btn.isEnabled()) {
          await btn.click();
          submitted = true;
          break;
        }
      } catch {
        // try next
      }
    }
    if (!submitted) {
      // Last-resort: keyboard shortcut.
      const modifier = process.platform === "darwin" ? "Meta" : "Control";
      await page.keyboard.press(`${modifier}+Enter`);
    }

    // Success = the composer detaches OR the URL changes off /compose.
    await Promise.race([
      page.waitForURL((u) => !u.toString().includes("/compose"), { timeout: 12_000 }).catch(() => {}),
      composer.waitFor({ state: "detached", timeout: 12_000 }).catch(() => {}),
    ]);

    await jitter(1500, 2500);
    return { url: page.url() };
  } finally {
    await browser.close();
  }
}
