import { createBrowserConnect } from "../shared/browser-connect";

// PHASE-2 NOTE: Facebook sets `c_user` (numeric user ID) and `xs` (session
// token) on `.facebook.com`. `c_user` is the most reliable "is signed in"
// signal — its existence implies a valid session, even if other cookies
// rotate. We use the numeric user ID as the account handle because FB doesn't
// expose vanity usernames cleanly from the post-login redirect.
export const facebookConnect = createBrowserConnect({
  platform: "facebook",
  loginUrl: "https://www.facebook.com/login",
  detectAuthCookie: (cookies) =>
    cookies.find(
      (c) =>
        c.name === "c_user" &&
        !!c.value &&
        /(?:^|\.)facebook\.com$/.test(c.domain),
    ) ?? null,
  captureHandle: async (handle) => {
    try {
      await handle.page.goto("https://www.facebook.com/", {
        waitUntil: "domcontentloaded",
        timeout: 8_000,
      });
      // The profile link in the left nav exposes the vanity URL when set.
      // Format: <a href="/<vanity>?..."> for vanity-set users, or
      // <a href="/profile.php?id=<numeric>"> for users without a vanity.
      const link = handle.page
        .locator(
          'a[href^="/profile.php"], a[aria-label*="Your profile" i], div[role="navigation"] a[href^="/"][role="link"]',
        )
        .first();
      try {
        await link.waitFor({ state: "visible", timeout: 5_000 });
        const href = await link.getAttribute("href");
        if (href) {
          const vanity = href.match(/^\/([A-Za-z0-9.]+)(?:\?|$)/);
          if (vanity && vanity[1] !== "home" && vanity[1] !== "watch") {
            return vanity[1];
          }
          const numeric = href.match(/profile\.php\?id=(\d+)/);
          if (numeric) return numeric[1];
        }
      } catch {
        // fall through to cookie fallback
      }
    } catch {
      // navigation failed — fall through to cookie fallback
    }
    // Fallback: c_user numeric ID directly from the cookie jar.
    try {
      const cookies = await handle.context.cookies();
      const cUser = cookies.find(
        (c) =>
          c.name === "c_user" &&
          /(?:^|\.)facebook\.com$/.test(c.domain),
      );
      if (cUser?.value) return cUser.value;
    } catch {
      // give up
    }
    return null;
  },
});
