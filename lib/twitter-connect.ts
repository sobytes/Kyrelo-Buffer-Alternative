import { promises as fs } from "node:fs";
import path from "node:path";
import type { BrowserHandle } from "./browser/session";

let active: BrowserHandle | null = null;

function markerPath(): string {
  const root = process.env.STORAGE_DIR ?? path.join(process.cwd(), ".data");
  return path.join(root, "userdata", "twitter", ".connected");
}

export async function isLoggedIn(): Promise<boolean> {
  try {
    await fs.access(markerPath());
    return true;
  } catch {
    return false;
  }
}

export async function clearLoggedIn(): Promise<void> {
  await fs.rm(markerPath(), { force: true }).catch(() => {});
}

export function isConnectActive(): boolean {
  return active !== null;
}

export async function startTwitterConnect(): Promise<
  { ok: true } | { error: string }
> {
  if (active) return { error: "already connecting" };
  const { openBrowser } = await import("./browser/session");
  let handle: BrowserHandle;
  try {
    handle = await openBrowser("twitter", { headless: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `failed to open browser: ${message}` };
  }
  try {
    await handle.page.goto("https://x.com/login", { waitUntil: "domcontentloaded" });
  } catch (err) {
    console.warn("[twitter-connect] navigation failed:", err);
  }
  // If the user closes the Chrome window manually (red traffic-light), reset
  // active so the next Connect click doesn't think a session is in progress.
  handle.context.on("close", () => {
    if (active === handle) active = null;
  });
  active = handle;
  return { ok: true };
}

export async function endTwitterConnect(): Promise<
  { ok: true } | { error: string }
> {
  if (!active) return { error: "not connecting" };
  const handle = active;
  active = null;

  let loggedIn = false;
  try {
    const cookies = await handle.context.cookies("https://x.com");
    loggedIn = cookies.some((c) => c.name === "auth_token" && !!c.value);
  } catch (err) {
    console.warn("[twitter-connect] cookie check failed:", err);
  }

  try {
    await handle.close();
  } catch (err) {
    console.warn("[twitter-connect] close failed:", err);
  }

  if (!loggedIn) {
    return {
      error:
        "Not signed in to X yet. Finish the sign-in flow (use email/username — Google blocks automated browsers), then click \"I'm logged in\" again.",
    };
  }

  const marker = markerPath();
  await fs.mkdir(path.dirname(marker), { recursive: true });
  await fs.writeFile(marker, new Date().toISOString());
  return { ok: true };
}

export async function cancelTwitterConnect(): Promise<{ ok: true }> {
  if (!active) return { ok: true };
  const handle = active;
  active = null;
  try {
    await handle.close();
  } catch (err) {
    console.warn("[twitter-connect] cancel close failed:", err);
  }
  return { ok: true };
}

export async function disconnectTwitter(): Promise<{ ok: true } | { error: string }> {
  if (active) return { error: "Cancel the connect flow first." };
  const root = process.env.STORAGE_DIR ?? path.join(process.cwd(), ".data");
  const dir = path.join(root, "userdata", "twitter");
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  return { ok: true };
}
