import { createBrowserConnect } from "../shared/browser-connect";

// PHASE-2 NOTE: Instagram uses the same `sessionid` cookie name as Threads
// (both Meta) but on `.instagram.com`. Handle capture pulls the signed-in
// username from the homepage's profile link.
export const instagramConnect = createBrowserConnect({
  platform: "instagram",
  loginUrl: "https://www.instagram.com/accounts/login/",
  detectAuthCookie: (cookies) =>
    cookies.find(
      (c) =>
        c.name === "sessionid" &&
        !!c.value &&
        /(?:^|\.)instagram\.com$/.test(c.domain),
    ) ?? null,
  captureHandle: async (handle) => {
    try {
      await handle.page.goto("https://www.instagram.com/", {
        waitUntil: "domcontentloaded",
        timeout: 8_000,
      });
      // The profile avatar links to /<username>/ in the left nav.
      const link = handle.page
        .locator(
          'a[href$="/"][role="link"]:has(img[data-testid="user-avatar"]), a[role="link"][href^="/"]:has(span:has-text("Profile"))',
        )
        .first();
      try {
        await link.waitFor({ state: "visible", timeout: 5_000 });
        const href = await link.getAttribute("href");
        if (href) {
          const m = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
          if (m && m[1] !== "explore" && m[1] !== "direct") return m[1];
        }
      } catch {
        // fall through
      }
      // Fallback: shared inline JSON exposes `viewerId` and `viewer.username`.
      const username = await handle.page.evaluate(() => {
        const scripts = Array.from(
          document.querySelectorAll('script[type="application/json"]'),
        ) as HTMLScriptElement[];
        for (const s of scripts) {
          const txt = s.textContent ?? "";
          const m = txt.match(/"username":\s*"([A-Za-z0-9._]+)"/);
          if (m) return m[1];
        }
        return null;
      });
      if (username) return username;
    } catch {
      // give up
    }
    return null;
  },
});
