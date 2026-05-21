// Launches the user's real installed Google Chrome with our isolated profile
// dir and attaches via the remote-debugging port over CDP. Used for the X
// Connect flow only — Google's OAuth bot-detection rejects Playwright's
// auto-flagged Chromium even with stealth scripts, but lets a normally-spawned
// Chrome through.
//
// Once the user finishes signing in, the session cookies are saved into the
// userdata dir, and the regular Playwright launchPersistentContext flow used
// for scraping/posting can reuse them.

import { spawn, ChildProcess } from "node:child_process";
import net from "node:net";
import http from "node:http";
import { chromium, Browser, BrowserContext, Page } from "playwright";

function findChromeBinary(): string {
  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  if (process.platform === "win32") {
    const pf = process.env["ProgramFiles"] ?? "C:\\Program Files";
    return `${pf}\\Google\\Chrome\\Application\\chrome.exe`;
  }
  return "google-chrome";
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

function waitForCdp(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const req = http
        .get(`http://127.0.0.1:${port}/json/version`, (res) => {
          res.destroy();
          if (res.statusCode === 200) resolve();
          else if (Date.now() - start > timeoutMs)
            reject(new Error("CDP did not come up in time"));
          else setTimeout(tick, 300);
        })
        .on("error", () => {
          if (Date.now() - start > timeoutMs) reject(new Error("CDP did not come up in time"));
          else setTimeout(tick, 300);
        });
      req.setTimeout(1500, () => req.destroy());
    };
    tick();
  });
}

export interface SystemChromeHandle {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  proc: ChildProcess;
  close(): Promise<void>;
}

export async function launchSystemChrome(
  userDataDir: string,
  startUrl: string,
): Promise<SystemChromeHandle> {
  const port = await findFreePort();
  const chromePath = findChromeBinary();
  console.log(`[system-chrome] spawning Chrome → port=${port} dir=${userDataDir}`);

  const proc = spawn(
    chromePath,
    [
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=ChromeWhatsNewUI,InterestFeedContentSuggestions",
      "--password-store=basic",
      startUrl,
    ],
    { detached: false, stdio: "ignore" },
  );

  proc.on("error", (err) => {
    console.error("[system-chrome] spawn error:", err);
  });
  proc.on("exit", (code, signal) => {
    console.log(`[system-chrome] chrome exited code=${code} signal=${signal}`);
  });

  try {
    await waitForCdp(port, 15_000);
    console.log(`[system-chrome] CDP ready on :${port}`);
  } catch (err) {
    try {
      proc.kill("SIGTERM");
    } catch {}
    throw new Error(
      `Couldn't connect to Chrome's debug port. Is Google Chrome installed at ` +
        `${chromePath}? (${err instanceof Error ? err.message : err})`,
    );
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  console.log(`[system-chrome] attached: contexts=${browser.contexts().length} pages=${context.pages().length}`);

  return {
    browser,
    context,
    page,
    proc,
    async close() {
      console.log("[system-chrome] close() — disconnecting CDP");
      try {
        await browser.close();
      } catch (err) {
        console.warn("[system-chrome] CDP close errored:", err);
      }

      if (proc.exitCode === null) {
        console.log("[system-chrome] sending SIGTERM, waiting for exit (up to 6s)");
        const start = Date.now();
        await new Promise<void>((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            console.log(`[system-chrome] chrome closed in ${Date.now() - start}ms`);
            resolve();
          };
          proc.once("exit", finish);
          try {
            proc.kill("SIGTERM");
          } catch {
            return finish();
          }
          setTimeout(() => {
            if (done) return;
            console.warn("[system-chrome] chrome didn't exit in 6s, SIGKILL");
            try {
              proc.kill("SIGKILL");
            } catch {}
            finish();
          }, 6000);
        });
      } else {
        console.log(`[system-chrome] chrome already exited (code=${proc.exitCode})`);
      }
    },
  };
}
