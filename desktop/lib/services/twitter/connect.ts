import { createBrowserConnect } from "../shared/browser-connect";

export const twitterConnect = createBrowserConnect({
  platform: "twitter",
  loginUrl: "https://x.com/login",
  detectAuthCookie: (cookies) =>
    cookies.find(
      (c) =>
        c.name === "auth_token" &&
        !!c.value &&
        /(?:^|\.)x\.com$|(?:^|\.)twitter\.com$/.test(c.domain),
    ) ?? null,
  captureHandle: async (handle) => {
    // 1) Try reading the profile link from x.com/home.
    try {
      await handle.page.goto("https://x.com/home", {
        waitUntil: "domcontentloaded",
        timeout: 7_000,
      });
      const link = handle.page.locator('a[data-testid="AppTabBar_Profile_Link"]').first();
      try {
        await link.waitFor({ state: "visible", timeout: 5_000 });
        const href = await link.getAttribute("href");
        if (href) return href.replace(/^\//, "");
      } catch {
        // fall through to the API
      }
    } catch {
      // navigation failed — try the API anyway
    }
    // 2) Fallback: legacy account/settings endpoint returns screen_name.
    try {
      const res = await handle.context.request.get(
        "https://api.x.com/1.1/account/settings.json",
        { timeout: 6_000 },
      );
      if (res.ok()) {
        const json = (await res.json()) as { screen_name?: string };
        if (typeof json.screen_name === "string") return json.screen_name;
      }
    } catch {
      // give up
    }
    return null;
  },
});
