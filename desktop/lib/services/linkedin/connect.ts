import { createBrowserConnect } from "../shared/browser-connect";

// PHASE-2 NOTE: LinkedIn uses the `li_at` cookie on `.linkedin.com` as the
// primary session token (also `JSESSIONID`, but `li_at` is the long-lived one).
// Handle capture pulls from the /me redirect — once signed in, /in/me/ resolves
// to /in/<vanity>/ and we read the slug from the URL.
export const linkedinConnect = createBrowserConnect({
  platform: "linkedin",
  loginUrl: "https://www.linkedin.com/login",
  detectAuthCookie: (cookies) =>
    cookies.find(
      (c) =>
        c.name === "li_at" &&
        !!c.value &&
        /(?:^|\.)linkedin\.com$/.test(c.domain),
    ) ?? null,
  captureHandle: async (handle) => {
    try {
      // /in/me/ redirects to /in/<vanity>/ when signed in.
      await handle.page.goto("https://www.linkedin.com/in/me/", {
        waitUntil: "domcontentloaded",
        timeout: 8_000,
      });
      const url = handle.page.url();
      const m = url.match(/\/in\/([^/?#]+)/);
      if (m && m[1] !== "me") return m[1];
    } catch {
      // try voyager API as fallback
    }
    try {
      const res = await handle.context.request.get(
        "https://www.linkedin.com/voyager/api/me",
        {
          timeout: 6_000,
          headers: {
            accept: "application/vnd.linkedin.normalized+json+2.1",
            "csrf-token": "ajax:0", // voyager checks presence not value for GETs
          },
        },
      );
      if (res.ok()) {
        const json = (await res.json()) as {
          miniProfile?: { publicIdentifier?: string };
        };
        if (json.miniProfile?.publicIdentifier) {
          return json.miniProfile.publicIdentifier;
        }
      }
    } catch {
      // give up
    }
    return null;
  },
});
