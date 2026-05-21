import { promises as fs } from "node:fs";
import path from "node:path";
import { BrowserContext, chromium, Page } from "playwright";

const USERDATA_ROOT = path.join(
  process.env.STORAGE_DIR ?? path.join(process.cwd(), ".data"),
  "userdata",
);

export function userDataDir(platform: string, accountId: string): string {
  return path.join(USERDATA_ROOT, platform, accountId);
}

export interface BrowserHandle {
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

export interface OpenOptions {
  headless?: boolean;
  /** Per-account profile directory under .data/userdata/<platform>/<accountId>/. */
  accountId: string;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Init script that patches the most common headless-detection tells. This is the
// minimum surface; sophisticated detectors (Akamai, Cloudflare Bot Management)
// look at TLS fingerprint and behavior over time, which scripts can't fix.
const STEALTH_INIT = `
  // navigator.webdriver — the obvious one
  Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => undefined });

  // navigator.languages — headless reports [] sometimes
  Object.defineProperty(Navigator.prototype, 'languages', {
    get: () => ['en-US', 'en'],
  });

  // navigator.plugins — empty in headless. Spoof a non-empty PluginArray.
  Object.defineProperty(Navigator.prototype, 'plugins', {
    get: () => {
      const arr = [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
        { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
        { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: '' },
      ];
      arr.item = (i) => arr[i];
      arr.namedItem = (n) => arr.find((p) => p.name === n) ?? null;
      arr.refresh = () => {};
      Object.setPrototypeOf(arr, PluginArray.prototype);
      return arr;
    },
  });

  // window.chrome — present in real Chrome, absent in vanilla Chromium / headless.
  if (!window.chrome) {
    window.chrome = { runtime: {}, app: { isInstalled: false } };
  }

  // Permissions API — real Chrome returns "default" for notifications when no
  // user choice; headless returns "denied" inconsistently. Normalise.
  if (navigator.permissions && navigator.permissions.query) {
    const orig = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (params) => {
      if (params && params.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission, onchange: null });
      }
      return orig(params);
    };
  }

  // WebGL vendor/renderer — common fingerprint check. Spoof to look like a
  // typical Mac/Intel Iris combo (real users have plenty of variety so this
  // doesn't have to match anything specific).
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function (p) {
    if (p === 37445) return 'Intel Inc.';                           // UNMASKED_VENDOR_WEBGL
    if (p === 37446) return 'Intel Iris OpenGL Engine';             // UNMASKED_RENDERER_WEBGL
    return getParameter.call(this, p);
  };
`;

// Per-platform mutex. launchPersistentContext locks the profile dir, so two
// concurrent open calls against the same platform will collide on Chrome's
// SingletonLock. This chain queues all consumers (worker crons + UI-triggered
// API routes) inside a single Node process.
const browserLocks: Record<string, Promise<void>> = {};

async function acquireBrowserLock(platform: string): Promise<() => void> {
  const prev = browserLocks[platform] ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((r) => (release = r));
  browserLocks[platform] = prev.then(() => current);
  await prev;
  return release;
}

// Stale SingletonLock files survive crashes (Ctrl+C, exceptions, OS-killed
// processes). Without removing them, the next launch fails with "Failed to
// create a ProcessSingleton". Safe to delete because the mutex above ensures
// we never have two of OUR processes touching the dir at once.
async function clearStaleProfileLocks(dir: string) {
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    await fs.rm(path.join(dir, name), { force: true }).catch(() => {});
  }
}

export async function openBrowser(
  platform: string,
  opts: OpenOptions,
): Promise<BrowserHandle> {
  const headless = opts.headless ?? process.env.BROWSER_HEADLESS !== "false";
  const channel = process.env.BROWSER_CHANNEL ?? "chrome";
  const dir = userDataDir(platform, opts.accountId);
  const lockKey = `${platform}:${opts.accountId}`;

  const release = await acquireBrowserLock(lockKey);
  try {
    await fs.mkdir(dir, { recursive: true });
    await clearStaleProfileLocks(dir);

    // launchPersistentContext = the browser thinks it's "your normal Chrome with
    // the same profile dir each time." History, GPU caches, fonts, even cookies
    // all persist exactly as a real user accumulates them. Strongest free win
    // against fingerprint-based detection.
    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(dir, {
        headless,
        channel,
        userAgent: UA,
        viewport: { width: 1366, height: 820 },
        locale: "en-US",
        timezoneId: "America/New_York",
        args: ["--disable-blink-features=AutomationControlled"],
        ignoreDefaultArgs: ["--enable-automation"],
      });
    } catch (err) {
      if (
        channel === "chrome" &&
        err instanceof Error &&
        /chrome|channel/i.test(err.message)
      ) {
        console.warn(
          "[browser] Real Chrome not installed — falling back to bundled Chromium. " +
            "Install Google Chrome for stronger fingerprint match.",
        );
        context = await chromium.launchPersistentContext(dir, {
          headless,
          userAgent: UA,
          viewport: { width: 1366, height: 820 },
          locale: "en-US",
          timezoneId: "America/New_York",
          args: ["--disable-blink-features=AutomationControlled"],
          ignoreDefaultArgs: ["--enable-automation"],
        });
      } else {
        throw err;
      }
    }

    await context.addInitScript({ content: STEALTH_INIT });

    const page = context.pages()[0] ?? (await context.newPage());

    return {
      context,
      page,
      async close() {
        try {
          await context.close();
        } finally {
          release();
        }
      },
    };
  } catch (err) {
    release();
    throw err;
  }
}

export function jitter(min: number, max: number): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return new Promise((r) => setTimeout(r, ms));
}

// Browse the platform like a person about to scrape: scroll the feed, dwell,
// hover a couple of items. Wrapped in try/catch by callers — warmup failure
// must never block the actual scrape.
export async function warmup(page: Page, feedUrl: string): Promise<void> {
  await page.goto(feedUrl, { waitUntil: "domcontentloaded" });
  await jitter(2000, 4000);

  // Scroll down 3-6 times with realistic pauses
  const scrolls = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < scrolls; i++) {
    await page.mouse.wheel(0, 250 + Math.random() * 400);
    await jitter(800, 2200);
  }

  // Hover on a few articles/tweets if any are present
  const articles = page.locator("article").first();
  try {
    if (await articles.isVisible({ timeout: 1500 })) {
      await articles.hover();
      await jitter(900, 1800);
    }
  } catch {
    // no articles in DOM — skip
  }

  // Small scroll-up so we're not at the bottom
  await page.mouse.wheel(0, -(200 + Math.random() * 400));
  await jitter(600, 1200);
}
