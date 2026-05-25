import { Page } from "playwright";
import { humanType, jitter, openBrowser, warmup } from "@/lib/browser/session";
import { PostInput, PostResult } from "../types";

function assertLoggedIn(page: Page) {
  const url = page.url();
  if (url.includes("/login") || url.includes("/checkpoint/")) {
    throw new Error("LinkedIn session expired. Reconnect under Connected accounts.");
  }
}

// PHASE-2 NOTE: LinkedIn's share modal opens from the "Start a post" button on
// the feed (or from the standalone /feed/?shareActive=true link). The modal
// renders a contenteditable Quill/Lexical editor. Text goes into a div with
// role="textbox" inside a wrapper labeled "Text editor for creating content".
const COMPOSE_TRIGGER_SELECTORS = [
  'button:has-text("Start a post")',
  'button[aria-label*="Start a post" i]',
  'button[aria-label*="Create a post" i]',
];

const COMPOSER_SELECTORS = [
  'div[role="textbox"][aria-label*="text editor" i]',
  'div[role="textbox"][contenteditable="true"][aria-label*="post" i]',
  'div.ql-editor[contenteditable="true"]',
  'div[contenteditable="true"][role="textbox"]',
];

const SUBMIT_SELECTORS = [
  'button.share-actions__primary-action',
  'button:has-text("Post")[aria-label*="Post" i]',
  'button[aria-label="Post"]',
];

async function openComposer(page: Page): Promise<void> {
  // Strategy A: deep-link.
  try {
    await page.goto("https://www.linkedin.com/feed/?shareActive=true", {
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
  // Strategy B: click the Start-a-post button.
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
  throw new Error("Couldn't open LinkedIn composer");
}

export async function postToLinkedIn(input: PostInput): Promise<PostResult> {
  const { accountId, text, imagePath, headless } = input;
  const browser = await openBrowser("linkedin", { headless, accountId });
  const { page } = browser;

  try {
    console.log(
      `[linkedin-post] starting post for accountId=${accountId} text=${text.slice(0, 60).replace(/\n/g, " ")}…`,
    );
    try {
      await warmup(page, "https://www.linkedin.com/feed/");
      console.log(`[linkedin-post] warmup done, url=${page.url()}`);
    } catch (err) {
      console.warn("[linkedin-post] warmup skipped:", err);
    }
    assertLoggedIn(page);

    await openComposer(page);
    console.log("[linkedin-post] composer open");
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
    if (!composer) throw new Error("Couldn't find LinkedIn composer textarea");

    await composer.click();
    await jitter(300, 800);

    if (imagePath) {
      console.log(`[linkedin-post] attaching image: ${imagePath}`);
      // PHASE-2 NOTE: LinkedIn nests a hidden file input under the
      // "Add a photo" toolbar button. The button must be clicked first to
      // mount the input.
      try {
        const photoButton = page
          .locator('button[aria-label*="Add a photo" i], button[aria-label*="photo" i]')
          .first();
        await photoButton.click({ timeout: 4_000 }).catch(() => {});
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.waitFor({ state: "attached", timeout: 5_000 });
        await fileInput.setInputFiles(imagePath);
        // Wait for the "Next" button in the photo dialog, then click it.
        await page
          .getByRole("button", { name: /^Next$/i })
          .first()
          .click({ timeout: 10_000 })
          .catch(() => {});
        await jitter(1500, 2500);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Couldn't attach image: ${msg}`);
      }
    }

    await humanType(page, text);
    await jitter(800, 1500);
    console.log("[linkedin-post] text typed, submitting");

    let clicked = false;
    for (const sel of SUBMIT_SELECTORS) {
      const btn = page.locator(sel).first();
      try {
        await btn.waitFor({ state: "visible", timeout: 4_000 });
        if (await btn.isEnabled()) {
          await btn.click({ timeout: 4_000 });
          clicked = true;
          console.log(`[linkedin-post] clicked Post (${sel})`);
          break;
        }
      } catch {
        // try next
      }
    }
    if (!clicked) {
      throw new Error("Couldn't click the Post button on LinkedIn");
    }

    try {
      await page
        .locator(COMPOSER_SELECTORS.join(", "))
        .first()
        .waitFor({ state: "hidden", timeout: 15_000 });
    } catch {
      console.warn("[linkedin-post] composer didn't close — submit may have failed");
    }
    await jitter(1500, 2500);

    return { url: `https://www.linkedin.com/in/${accountId}/recent-activity/all/` };
  } finally {
    await browser.close();
  }
}
