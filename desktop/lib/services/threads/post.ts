import { Page } from "playwright";
import { humanType, jitter, openBrowser, warmup } from "@/lib/browser/session";
import { PostInput, PostResult } from "../types";

function assertLoggedIn(page: Page) {
  const url = page.url();
  if (url.includes("/login") || url.includes("/accounts/login")) {
    throw new Error("Threads session expired. Reconnect under Connected accounts.");
  }
}

// PHASE-2 NOTE: Threads composes through a modal triggered by either:
//   1. Clicking the "Create" icon in the left nav (svg[aria-label="Create"])
//   2. Navigating to https://www.threads.com/?compose=1 on desktop
//   3. Programmatically: clicking the floating action button on mobile widths
// We try (2) first since it's the most direct. The textarea inside the modal
// is a contenteditable div with role="textbox" and aria-label containing
// "What's new" or "Start a thread" depending on the build.
const COMPOSE_TRIGGER_SELECTORS = [
  'svg[aria-label="Create"]',
  'a[href="/compose"]',
  '[role="button"][aria-label*="Create" i]',
];

const COMPOSER_SELECTORS = [
  'div[contenteditable="true"][role="textbox"][aria-label*="new" i]',
  'div[contenteditable="true"][role="textbox"][aria-label*="thread" i]',
  'div[contenteditable="true"][role="textbox"]',
];

const SUBMIT_SELECTORS = [
  'div[role="button"]:has-text("Post")',
  'button:has-text("Post")',
  '[aria-label="Post"]',
];

async function openComposer(page: Page): Promise<void> {
  // Strategy A: deep-link.
  try {
    await page.goto("https://www.threads.com/?compose=1", {
      waitUntil: "domcontentloaded",
    });
    await jitter(1500, 2500);
    const exists = await page
      .locator(COMPOSER_SELECTORS.join(", "))
      .first()
      .isVisible()
      .catch(() => false);
    if (exists) return;
  } catch {
    // fall through
  }
  // Strategy B: click the create button in the left nav.
  for (const sel of COMPOSE_TRIGGER_SELECTORS) {
    const btn = page.locator(sel).first();
    try {
      await btn.waitFor({ state: "visible", timeout: 4_000 });
      await btn.click({ timeout: 4_000 });
      await jitter(800, 1500);
      const exists = await page
        .locator(COMPOSER_SELECTORS.join(", "))
        .first()
        .isVisible()
        .catch(() => false);
      if (exists) return;
    } catch {
      // try next
    }
  }
  throw new Error("Couldn't open Threads composer");
}

export async function postToThreads(input: PostInput): Promise<PostResult> {
  const { accountId, text, imagePath, headless } = input;
  const browser = await openBrowser("threads", { headless, accountId });
  const { page } = browser;

  try {
    console.log(
      `[threads-post] starting post for accountId=${accountId} text=${text.slice(0, 60).replace(/\n/g, " ")}…`,
    );
    try {
      await warmup(page, "https://www.threads.com/");
      console.log(`[threads-post] warmup done, url=${page.url()}`);
    } catch (err) {
      console.warn("[threads-post] warmup skipped:", err);
    }
    assertLoggedIn(page);

    await openComposer(page);
    console.log("[threads-post] composer open");
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
    if (!composer) throw new Error("Couldn't find Threads composer textarea");

    await composer.click();
    await jitter(300, 800);

    if (imagePath) {
      console.log(`[threads-post] attaching image: ${imagePath}`);
      // PHASE-2 NOTE: Threads exposes a hidden <input type="file"> tied to
      // the camera/media button. Selector may need adjustment.
      const fileInput = page.locator('input[type="file"]').first();
      try {
        await fileInput.waitFor({ state: "attached", timeout: 5_000 });
        await fileInput.setInputFiles(imagePath);
        await jitter(1500, 2500);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Couldn't attach image: ${msg}`);
      }
    }

    await humanType(page, text);
    await jitter(800, 1500);
    console.log("[threads-post] text typed, submitting");

    let clicked = false;
    // Prefer the accessible "Post" button.
    const named = page.getByRole("button", { name: /^Post$/i }).first();
    try {
      await named.waitFor({ state: "visible", timeout: 4_000 });
      if (await named.isEnabled()) {
        await named.click({ timeout: 4_000 });
        clicked = true;
        console.log("[threads-post] clicked Post (by role)");
      }
    } catch {
      // fall through
    }
    if (!clicked) {
      for (const sel of SUBMIT_SELECTORS) {
        const btn = page.locator(sel).first();
        try {
          await btn.waitFor({ state: "visible", timeout: 3_000 });
          await btn.click({ timeout: 4_000 });
          clicked = true;
          console.log(`[threads-post] clicked Post (${sel})`);
          break;
        } catch {
          // try next
        }
      }
    }
    if (!clicked) {
      throw new Error("Couldn't click the Post button on Threads");
    }

    // Wait for the composer to close — that's the visible "submitted" signal.
    try {
      await page
        .locator(COMPOSER_SELECTORS.join(", "))
        .first()
        .waitFor({ state: "hidden", timeout: 15_000 });
    } catch {
      console.warn("[threads-post] composer didn't close — submit may have failed");
    }
    await jitter(1500, 2500);

    return { url: `https://www.threads.com/@${accountId}` };
  } finally {
    await browser.close();
  }
}
