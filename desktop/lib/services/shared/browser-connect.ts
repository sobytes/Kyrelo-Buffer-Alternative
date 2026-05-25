import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Cookie } from "playwright";
import {
  ChromeNotFoundError,
  launchSystemChrome,
  SystemChromeHandle,
} from "@/lib/browser/system-chrome";
import { listAccounts, saveAccounts } from "@/lib/storage";
import { PlatformSlug } from "@/lib/platforms";
import { SocialAccount } from "@/lib/types";
import {
  ConnectEndResult,
  ConnectStartResult,
  DisconnectResult,
} from "../types";

export interface BrowserConnectConfig {
  platform: PlatformSlug;
  // URL Chrome opens for the user to sign in.
  loginUrl: string;
  // Inspect cookies after sign-in to decide whether the user is actually
  // logged in. Return the matching auth cookie (so we can log its domain)
  // or `null` if none found.
  detectAuthCookie: (cookies: Cookie[]) => Cookie | null;
  // Read the signed-in user's handle from the page/context. Returns null
  // if it can't be determined (we treat that as a connect failure so we
  // don't end up with anonymous accounts in the list).
  captureHandle: (handle: SystemChromeHandle) => Promise<string | null>;
  // Optional human label for log messages; defaults to the platform slug.
  label?: string;
}

interface ActiveConnect {
  handle: SystemChromeHandle;
  pendingId: string;
}

// Browser profile dirs live under `.data/userdata/<platform>/<accountId>/`.
function userdataRoot(platform: PlatformSlug): string {
  return path.join(
    process.env.STORAGE_DIR ?? path.join(process.cwd(), ".data"),
    "userdata",
    platform,
  );
}

export function profileDir(platform: PlatformSlug, accountId: string): string {
  return path.join(userdataRoot(platform), accountId);
}

// Windows keeps file handles on a Chrome profile dir open briefly after the
// browser exits, so renaming the dir can fail with EPERM/EBUSY for a short
// window. Retry with backoff to give the OS time to release the locks.
async function renameWithRetry(from: string, to: string): Promise<void> {
  const transient = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"]);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (!transient.has(code)) throw err;
      await new Promise((r) => setTimeout(r, 200 + attempt * 200));
    }
  }
  throw lastErr;
}

export interface BrowserConnect {
  platform: PlatformSlug;
  isConnectActive(): boolean;
  startConnect(): Promise<ConnectStartResult>;
  endConnect(): Promise<ConnectEndResult>;
  cancelConnect(): Promise<{ ok: true }>;
  disconnect(accountId: string): Promise<DisconnectResult>;
}

export function createBrowserConnect(config: BrowserConnectConfig): BrowserConnect {
  const { platform, loginUrl, detectAuthCookie, captureHandle } = config;
  const label = config.label ?? platform;
  const log = (msg: string) => console.log(`[${label}-connect] ${msg}`);
  const warn = (msg: string, err?: unknown) =>
    console.warn(`[${label}-connect] ${msg}`, err ?? "");

  // Each platform gets its own slot on globalThis so concurrent connects
  // (e.g. user clicks Connect on Twitter and Threads back-to-back) don't
  // stomp each other. Survives Next dev HMR.
  const GLOBAL_KEY = `__kyreloConnectActive_${platform}` as const;
  function getActive(): ActiveConnect | null {
    return (globalThis as unknown as Record<string, ActiveConnect | null | undefined>)[
      GLOBAL_KEY
    ] ?? null;
  }
  function setActive(v: ActiveConnect | null): void {
    (globalThis as unknown as Record<string, ActiveConnect | null>)[GLOBAL_KEY] = v;
  }

  async function startConnect(): Promise<ConnectStartResult> {
    if (getActive()) {
      log("start: already connecting");
      return { error: "Already connecting an account." };
    }
    const pendingId = `_pending_${randomUUID()}`;
    const dir = profileDir(platform, pendingId);
    log(`start: pendingId=${pendingId}`);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `Couldn't create profile dir: ${message}` };
    }
    let handle: SystemChromeHandle;
    try {
      handle = await launchSystemChrome(dir, loginUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${label}-connect] start: launch failed:`, message);
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      if (err instanceof ChromeNotFoundError) {
        return { error: message, chromeMissing: true };
      }
      return { error: message };
    }
    setActive({ handle, pendingId });
    log("start: ok, active set");
    return { ok: true };
  }

  async function endConnect(): Promise<ConnectEndResult> {
    const current = getActive();
    if (!current) {
      log("end: no active session");
      return { error: "not connecting" };
    }
    const { handle, pendingId } = current;
    setActive(null);
    log(`end: pendingId=${pendingId}`);

    let cookies: Cookie[] = [];
    let authCookie: Cookie | null = null;
    try {
      cookies = await handle.context.cookies();
      authCookie = detectAuthCookie(cookies);
      log(
        `end: cookies=${cookies.length}, auth=${authCookie ? `found (${authCookie.name}@${authCookie.domain})` : "MISSING"}`,
      );
    } catch (err) {
      warn("cookie check failed:", err);
    }
    const loggedIn = !!authCookie;

    let capturedHandle: string | null = null;
    if (loggedIn) {
      capturedHandle = await captureHandleWithTimeout(handle, captureHandle, 12_000);
      log(`end: captured handle=${capturedHandle ?? "null"}`);
    }

    try {
      await handle.close();
    } catch (err) {
      warn("close failed:", err);
    }

    if (!loggedIn) {
      await fs
        .rm(profileDir(platform, pendingId), { recursive: true, force: true })
        .catch(() => {});
      return {
        error: `Not signed in yet. Finish sign-in in the Chrome window, then click "I'm logged in" again.`,
      };
    }

    if (!capturedHandle) {
      await fs
        .rm(profileDir(platform, pendingId), { recursive: true, force: true })
        .catch(() => {});
      return { error: "Logged in but couldn't read your handle. Try Connect again." };
    }

    const id = capturedHandle.toLowerCase();
    const finalDir = profileDir(platform, id);
    log(`end: renaming ${pendingId} → ${id} at ${finalDir}`);
    await fs.rm(finalDir, { recursive: true, force: true }).catch(() => {});
    try {
      await renameWithRetry(profileDir(platform, pendingId), finalDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${label}-connect] end: profile rename failed:`, message);
      await fs
        .rm(profileDir(platform, pendingId), { recursive: true, force: true })
        .catch(() => {});
      return {
        error:
          "Signed in, but couldn't save the session — Chrome still had the profile files locked. Close any open Chrome windows, then click Connect again.",
      };
    }

    const sidecarPath = path.join(finalDir, "kyrelo-cookies.json");
    try {
      await fs.writeFile(
        sidecarPath,
        JSON.stringify({ savedAt: new Date().toISOString(), cookies }, null, 2),
      );
      log(`end: wrote ${cookies.length} cookies → ${sidecarPath}`);
    } catch (err) {
      warn("cookie sidecar write failed:", err);
    }

    const accounts = await listAccounts(platform);
    const acct: SocialAccount = {
      id,
      handle: capturedHandle,
      platform,
      addedAt: new Date().toISOString(),
    };
    const existing = accounts.findIndex((a) => a.id === id);
    if (existing >= 0) accounts[existing] = acct;
    else accounts.push(acct);
    await saveAccounts(platform, accounts);

    return { ok: true, handle: capturedHandle };
  }

  async function cancelConnect(): Promise<{ ok: true }> {
    const current = getActive();
    if (!current) return { ok: true };
    const { handle, pendingId } = current;
    setActive(null);
    try {
      await handle.close();
    } catch (err) {
      warn("cancel close failed:", err);
    }
    await fs
      .rm(profileDir(platform, pendingId), { recursive: true, force: true })
      .catch(() => {});
    return { ok: true };
  }

  async function disconnect(accountId: string): Promise<DisconnectResult> {
    if (getActive()) return { error: "Cancel the connect flow first." };
    await fs
      .rm(profileDir(platform, accountId), { recursive: true, force: true })
      .catch(() => {});
    const accounts = await listAccounts(platform);
    await saveAccounts(platform, accounts.filter((a) => a.id !== accountId));
    return { ok: true };
  }

  return {
    platform,
    isConnectActive: () => getActive() !== null,
    startConnect,
    endConnect,
    cancelConnect,
    disconnect,
  };
}

async function captureHandleWithTimeout(
  handle: SystemChromeHandle,
  capture: (h: SystemChromeHandle) => Promise<string | null>,
  timeoutMs: number,
): Promise<string | null> {
  const work = (async () => {
    try {
      return await capture(handle);
    } catch (err) {
      console.warn("[connect] handle capture inner failed:", err);
      return null;
    }
  })();
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  return Promise.race([work, timeout]);
}
