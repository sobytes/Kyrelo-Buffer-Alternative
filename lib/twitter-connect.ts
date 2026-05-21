import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { BrowserHandle } from "./browser/session";
import { listXAccounts, saveXAccounts } from "./storage";
import { XAccount } from "./types";

interface ActiveConnect {
  handle: BrowserHandle;
  pendingId: string;
}

let active: ActiveConnect | null = null;

function userdataRoot(): string {
  return path.join(
    process.env.STORAGE_DIR ?? path.join(process.cwd(), ".data"),
    "userdata",
    "twitter",
  );
}

function profileDir(accountId: string): string {
  return path.join(userdataRoot(), accountId);
}

async function captureHandleWithTimeout(
  handle: BrowserHandle,
  timeoutMs: number,
): Promise<string | null> {
  const work = (async (): Promise<string | null> => {
    try {
      // Try the side-nav profile link first — works once /home renders.
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
        // fall through to settings API
      }
      // Fallback: hit X's authenticated settings endpoint.
      const res = await handle.context.request.get(
        "https://api.x.com/1.1/account/settings.json",
        { timeout: 6_000 },
      );
      if (res.ok()) {
        const json = (await res.json()) as { screen_name?: string };
        if (typeof json.screen_name === "string") return json.screen_name;
      }
    } catch (err) {
      console.warn("[twitter-connect] handle capture inner failed:", err);
    }
    return null;
  })();

  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  return Promise.race([work, timeout]);
}

export function isConnectActive(): boolean {
  return active !== null;
}

export async function listXConnectedAccounts(): Promise<XAccount[]> {
  return listXAccounts();
}

export async function startTwitterConnect(): Promise<
  { ok: true } | { error: string }
> {
  if (active) return { error: "Already connecting an account." };
  const { openBrowser } = await import("./browser/session");
  const pendingId = `_pending_${randomUUID()}`;
  let handle: BrowserHandle;
  try {
    handle = await openBrowser("twitter", { headless: false, accountId: pendingId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `failed to open browser: ${message}` };
  }
  try {
    await handle.page.goto("https://x.com/login", { waitUntil: "domcontentloaded" });
  } catch (err) {
    console.warn("[twitter-connect] navigation failed:", err);
  }
  handle.context.on("close", () => {
    if (active?.handle === handle) active = null;
  });
  active = { handle, pendingId };
  return { ok: true };
}

export async function endTwitterConnect(): Promise<
  { ok: true; handle: string } | { error: string }
> {
  if (!active) return { error: "not connecting" };
  const { handle, pendingId } = active;
  active = null;

  let loggedIn = false;
  try {
    const cookies = await handle.context.cookies("https://x.com");
    loggedIn = cookies.some((c) => c.name === "auth_token" && !!c.value);
  } catch (err) {
    console.warn("[twitter-connect] cookie check failed:", err);
  }

  let capturedHandle: string | null = null;
  if (loggedIn) {
    capturedHandle = await captureHandleWithTimeout(handle, 12_000);
  }

  try {
    await handle.close();
  } catch (err) {
    console.warn("[twitter-connect] close failed:", err);
  }

  if (!loggedIn) {
    await fs.rm(profileDir(pendingId), { recursive: true, force: true }).catch(() => {});
    return {
      error:
        "Not signed in to X yet. Finish sign-in (use email/username — Google blocks automated browsers), then click \"I'm logged in\" again.",
    };
  }

  if (!capturedHandle) {
    await fs.rm(profileDir(pendingId), { recursive: true, force: true }).catch(() => {});
    return { error: "Logged in but couldn't read your @handle. Try Connect again." };
  }

  const id = capturedHandle.toLowerCase();
  const finalDir = profileDir(id);
  await fs.rm(finalDir, { recursive: true, force: true }).catch(() => {});
  await fs.rename(profileDir(pendingId), finalDir);

  const accounts = await listXAccounts();
  const acct: XAccount = { id, handle: capturedHandle, addedAt: new Date().toISOString() };
  const existing = accounts.findIndex((a) => a.id === id);
  if (existing >= 0) accounts[existing] = acct;
  else accounts.push(acct);
  await saveXAccounts(accounts);

  return { ok: true, handle: capturedHandle };
}

export async function cancelTwitterConnect(): Promise<{ ok: true }> {
  if (!active) return { ok: true };
  const { handle, pendingId } = active;
  active = null;
  try {
    await handle.close();
  } catch (err) {
    console.warn("[twitter-connect] cancel close failed:", err);
  }
  await fs.rm(profileDir(pendingId), { recursive: true, force: true }).catch(() => {});
  return { ok: true };
}

export async function disconnectXAccount(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  if (active) return { error: "Cancel the connect flow first." };
  await fs.rm(profileDir(id), { recursive: true, force: true }).catch(() => {});
  const accounts = await listXAccounts();
  await saveXAccounts(accounts.filter((a) => a.id !== id));
  return { ok: true };
}

/** Convenience: the account ID to use when something needs to read X (scraping). */
export async function getDefaultAccountId(): Promise<string | null> {
  const accs = await listXAccounts();
  return accs[0]?.id ?? null;
}
