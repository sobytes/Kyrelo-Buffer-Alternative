import { Page } from "playwright";
import { humanType, jitter, openBrowser, warmup } from "@/lib/browser/session";
import { PostInput, PostResult } from "../types";

function assertLoggedIn(page: Page) {
  const url = page.url();
  if (url.includes("/login") || url.includes("/checkpoint/")) {
    throw new Error(
      "Facebook session expired. Reconnect under Connected accounts.",
    );
  }
}

// PHASE-2 NOTE: Facebook's web composer is the "What's on your mind?"
// card at the top of the feed. Clicking it opens the "Create post" modal.
// The composer textarea inside the modal is a Lexical/contenteditable div
// with role="textbox" and aria-label "What's on your mind".
//
// Submit button: a Post button at the bottom of the modal. FB rotates its
// internal classnames constantly so we lean on accessible names and roles
// rather than class selectors.
const COMPOSE_TRIGGER_SELECTORS = [
  '[role="button"][aria-label*="What" i]',
  'div[role="button"]:has-text("What\'s on your mind")',
  'div[role="button"]:has-text("Create post")',
];

const COMPOSER_SELECTORS = [
  'div[contenteditable="true"][role="textbox"][aria-label*="What" i]',
  'div[contenteditable="true"][role="textbox"][aria-label*="mind" i]',
  'div[contenteditable="true"][role="textbox"]',
];

async function openComposer(page: Page): Promise<void> {
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
  throw new Error("Couldn't open Facebook composer");
}

export async function postToFacebook(input: PostInput): Promise<PostResult> {
  const { accountId, text, imagePath, headless } = input;
  const browser = await openBrowser("facebook", { headless, accountId });
  const { page } = browser;

  try {
    console.log(
      `[facebook-post] starting post for accountId=${accountId} text=${text.slice(0, 60).replace(/\n/g, " ")}…`,
    );
    try {
      await warmup(page, "https://www.facebook.com/");
      console.log(`[facebook-post] warmup done, url=${page.url()}`);
    } catch (err) {
      console.warn("[facebook-post] warmup skipped:", err);
    }
    assertLoggedIn(page);

    await openComposer(page);
    console.log("[facebook-post] composer open");
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
    if (!composer) throw new Error("Couldn't find Facebook composer textarea");

    await composer.click();
    await jitter(300, 800);

    if (imagePath) {
      console.log(`[facebook-post] attaching image: ${imagePath}`);
      try {
        // The "Photo/Video" button mounts a hidden file input inside the modal.
        const photoButton = page
          .locator(
            '[role="button"][aria-label*="Photo" i], [role="button"][aria-label*="Photo/video" i]',
          )
          .first();
        await photoButton.click({ timeout: 4_000 }).catch(() => {});
        const fileInput = page.locator('input[type="file"]').first();
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
    console.log("[facebook-post] text typed, submitting");

    let clicked = false;
    const named = page.getByRole("button", { name: /^Post$/i }).first();
    try {
      await named.waitFor({ state: "visible", timeout: 4_000 });
      if (await named.isEnabled()) {
        await named.click({ timeout: 4_000 });
        clicked = true;
        console.log("[facebook-post] clicked Post (by role)");
      }
    } catch {
      // fall through
    }
    if (!clicked) {
      throw new Error("Couldn't click the Post button on Facebook");
    }

    try {
      await page
        .locator(COMPOSER_SELECTORS.join(", "))
        .first()
        .waitFor({ state: "hidden", timeout: 20_000 });
    } catch {
      console.warn("[facebook-post] composer didn't close — submit may have failed");
    }
    await jitter(1500, 2500);

    return { url: `https://www.facebook.com/${accountId}` };
  } finally {
    await browser.close();
  }
}
