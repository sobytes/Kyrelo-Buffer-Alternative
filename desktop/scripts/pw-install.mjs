// Cross-platform Playwright Chromium install. Installs into
// build/pw-browsers/ (so electron-builder can ship it via extraResources)
// and prunes the headless-shell + ffmpeg subdirs we never use.
//
// Works the same on macOS, Windows, and Linux — no shell-specific syntax.

import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const target = path.join(root, "build", "pw-browsers");

console.log(`Installing Playwright Chromium → ${target}`);

execSync("npx playwright install chromium", {
  stdio: "inherit",
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: target },
});

try {
  const entries = await fs.readdir(target);
  for (const e of entries) {
    if (e.startsWith("chromium_headless_shell-") || e.startsWith("ffmpeg-")) {
      await fs.rm(path.join(target, e), { recursive: true, force: true });
      console.log(`  removed ${e}`);
    }
  }
} catch {
  // dir missing — install failed silently
}
console.log("Done.");
