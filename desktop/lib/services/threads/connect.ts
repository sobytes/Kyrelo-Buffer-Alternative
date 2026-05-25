import { createBrowserConnect } from "../shared/browser-connect";

// PHASE-2 NOTE: Threads is served from threads.com (formerly threads.net).
// Auth cookies are set by Meta's IG-style session — `sessionid` on
// `.threads.com` is the most reliable signal. If you log in via the IG
// "Continue as @handle" path, the cookie still lands on the threads.com
// domain. If selectors change you'll see "Logged in but couldn't read your
// handle" in the connect modal — that's where to start debugging.
export const threadsConnect = createBrowserConnect({
  platform: "threads",
  loginUrl: "https://www.threads.com/login",
  detectAuthCookie: (cookies) =>
    cookies.find(
      (c) =>
        c.name === "sessionid" &&
        !!c.value &&
        /(?:^|\.)threads\.com$|(?:^|\.)threads\.net$/.test(c.domain),
    ) ?? null,
  captureHandle: async (handle) => {
    try {
      await handle.page.goto("https://www.threads.com/", {
        waitUntil: "domcontentloaded",
        timeout: 8_000,
      });
      // Threads renders a profile avatar/link in the left nav. The link's
      // href is `/@handle`; we strip the leading slash and "@".
      const link = handle.page
        .locator('a[href^="/@"]')
        .first();
      try {
        await link.waitFor({ state: "visible", timeout: 5_000 });
        const href = await link.getAttribute("href");
        if (href) {
          const m = href.match(/^\/@([^/?#]+)/);
          if (m) return m[1];
        }
      } catch {
        // try meta tags
      }
      // Fallback: read the active profile from the page's apollo state.
      // Meta inlines a `<meta name="al:android:url" content="barcelona://user?username=…">`
      // shape on the home feed in some builds.
      const meta = await handle.page
        .locator('meta[name="al:android:url"], meta[property="al:android:url"]')
        .first()
        .getAttribute("content")
        .catch(() => null);
      if (meta) {
        const m = meta.match(/username=([A-Za-z0-9._]+)/);
        if (m) return m[1];
      }
    } catch {
      // give up
    }
    return null;
  },
});
