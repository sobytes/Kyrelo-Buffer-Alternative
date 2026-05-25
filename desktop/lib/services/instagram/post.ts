import { Page } from "playwright";
import { humanType, jitter, openBrowser, warmup } from "@/lib/browser/session";
import { PostInput, PostResult } from "../types";

function assertLoggedIn(page: Page) {
  const url = page.url();
  if (url.includes("/accounts/login")) {
    throw new Error(
      "Instagram session expired. Reconnect under Connected accounts.",
    );
  }
}

// PHASE-2 NOTE: Instagram feed posts REQUIRE an image (or video). Caption-only
// posts aren't a thing on IG. The composer is opened via the "+" / "New post"
// icon in the left nav; we wait for the upload modal, push the file in, click
// through the "Crop" → "Edit" → "Share" steps. Crop/edit steps are skipped by
// hitting "Next" twice. The caption textarea appears on the final screen.
const CREATE_TRIGGERS = [
  'svg[aria-label="New post"]',
  '[role="button"][aria-label*="Create" i]',
  'a[href*="/create"]',
];

const CAPTION_SELECTORS = [
  'div[contenteditable="true"][aria-label*="caption" i]',
  'div[contenteditable="true"][role="textbox"]',
];

export async function postToInstagram(input: PostInput): Promise<PostResult> {
  const { accountId, text, imagePath, headless } = input;
  if (!imagePath) {
    throw new Error(
      "Instagram requires an image — text-only posts aren't supported. " +
        "Attach an image before scheduling.",
    );
  }
  const browser = await openBrowser("instagram", { headless, accountId });
  const { page } = browser;

  try {
    console.log(
      `[instagram-post] starting post for accountId=${accountId} text=${text.slice(0, 60).replace(/\n/g, " ")}…`,
    );
    try {
      await warmup(page, "https://www.instagram.com/");
      console.log(`[instagram-post] warmup done, url=${page.url()}`);
    } catch (err) {
      console.warn("[instagram-post] warmup skipped:", err);
    }
    assertLoggedIn(page);

    // Open the Create modal.
    let opened = false;
    for (const sel of CREATE_TRIGGERS) {
      const btn = page.locator(sel).first();
      try {
        await btn.waitFor({ state: "visible", timeout: 4_000 });
        await btn.click({ timeout: 4_000 });
        opened = true;
        break;
      } catch {
        // try next
      }
    }
    if (!opened) throw new Error("Couldn't find Instagram Create button");
    await jitter(1000, 2000);

    // If a "Post / Story / Reel" submenu appears, pick Post.
    try {
      const post = page.getByRole("menuitem", { name: /^Post$/i }).first();
      if (await post.isVisible({ timeout: 2_000 })) {
        await post.click();
        await jitter(800, 1500);
      }
    } catch {
      // no submenu — modal opened straight to the upload step
    }

    // Push the file in.
    console.log(`[instagram-post] attaching image: ${imagePath}`);
    const fileInput = page.locator('input[type="file"]').first();
    try {
      await fileInput.waitFor({ state: "attached", timeout: 8_000 });
      await fileInput.setInputFiles(imagePath);
      await jitter(2000, 3500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Couldn't attach image: ${msg}`);
    }

    // Step past Crop → Edit by clicking "Next" twice.
    for (let i = 0; i < 2; i++) {
      const next = page.getByRole("button", { name: /^Next$/i }).first();
      try {
        await next.waitFor({ state: "visible", timeout: 6_000 });
        await next.click({ timeout: 4_000 });
        await jitter(1000, 2000);
      } catch {
        // ran out of Next buttons — the caption screen may already be open
        break;
      }
    }

    // Caption screen.
    let caption = null as ReturnType<Page["locator"]> | null;
    for (const sel of CAPTION_SELECTORS) {
      const loc = page.locator(sel).first();
      try {
        await loc.waitFor({ state: "visible", timeout: 6_000 });
        caption = loc;
        break;
      } catch {
        // try next
      }
    }
    if (!caption) throw new Error("Couldn't find Instagram caption textarea");
    await caption.click();
    await jitter(300, 800);
    await humanType(page, text);
    await jitter(800, 1500);

    // Share.
    const share = page.getByRole("button", { name: /^Share$/i }).first();
    try {
      await share.waitFor({ state: "visible", timeout: 4_000 });
      await share.click({ timeout: 4_000 });
      console.log("[instagram-post] clicked Share");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Couldn't click Share on Instagram: ${msg}`);
    }

    // Wait for the "Your post has been shared" confirmation.
    try {
      await page
        .getByText(/your post has been shared|post shared/i)
        .first()
        .waitFor({ state: "visible", timeout: 30_000 });
    } catch {
      console.warn(
        "[instagram-post] didn't see post-shared confirmation — submit may have failed",
      );
    }
    await jitter(1500, 2500);

    return { url: `https://www.instagram.com/${accountId}/` };
  } finally {
    await browser.close();
  }
}
