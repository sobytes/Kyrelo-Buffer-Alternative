/**
 * Local-only macOS release script for Kyrelo.
 *
 * What it does:
 *   1. Validates Apple notarization + gh CLI credentials.
 *   2. Bumps the patch version in package.json (commits + tags locally).
 *   3. Builds the Next app, installs Playwright Chromium, packages with
 *      electron-builder (signs + notarizes).
 *   4. Pushes the version commit and tag to origin.
 *   5. Creates a GitHub release at that tag with the .dmg attached.
 *
 * Usage:
 *   npm run release:mac           → full release (signed, notarized, uploaded)
 *   npm run release:mac:test      → build only (no notarize, no push, no upload)
 *
 * Credentials (in .env.local — gitignored, NEVER commit):
 *   APPLE_ID=you@example.com
 *   APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
 *   APPLE_TEAM_ID=FT97GD7996
 *
 * gh CLI must be authenticated as a user with push access to the repo.
 * Check with: gh auth status
 */

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, "../.env.local") });

const TEST_MODE = process.argv.slice(2).some((a) => a === "--test" || a === "test");

const APPLE_ID = process.env.APPLE_ID;
const APPLE_APP_SPECIFIC_PASSWORD = process.env.APPLE_APP_SPECIFIC_PASSWORD;
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID;

function fail(msg) {
  console.error(`\nERROR: ${msg}\n`);
  process.exit(1);
}

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", cwd: path.join(__dirname, ".."), ...opts });
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function validate() {
  console.log("\nValidating credentials…");
  if (!APPLE_ID) fail("APPLE_ID missing in .env.local");
  if (!APPLE_APP_SPECIFIC_PASSWORD) fail("APPLE_APP_SPECIFIC_PASSWORD missing in .env.local");
  if (!APPLE_TEAM_ID) fail("APPLE_TEAM_ID missing in .env.local");
  console.log(`  APPLE_ID: ${APPLE_ID}`);
  console.log(`  APPLE_TEAM_ID: ${APPLE_TEAM_ID}`);
  console.log(`  APPLE_APP_SPECIFIC_PASSWORD: [set]`);

  try {
    execSync("gh auth status", { stdio: "pipe" });
  } catch {
    fail("gh CLI is not authenticated. Run `gh auth login` first.");
  }
  console.log("  gh CLI: authenticated");

  // Confirm signing identity is installed locally.
  try {
    const out = execSync('security find-identity -v -p codesigning', {
      encoding: "utf8",
    });
    if (!out.includes("SOBYTES LTD (FT97GD7996)")) {
      fail(
        'Signing identity "SOBYTES LTD (FT97GD7996)" not found in keychain. ' +
        'Install the Developer ID Application cert from Apple Developer.',
      );
    }
  } catch (err) {
    fail(`security find-identity failed: ${err.message}`);
  }
  console.log("  signing identity: SOBYTES LTD (FT97GD7996)");
  console.log("");
}

function bumpVersion() {
  const pkgPath = path.join(__dirname, "../package.json");
  const before = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
  console.log(`Bumping version (current: ${before})…`);
  run('npm version patch -m "Release v%s"');
  const after = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
  console.log(`  new version: ${after}\n`);
  return after;
}

function build() {
  console.log("Building Next + downloading Playwright Chromium…");
  run("npm run build");
  run("npm run pw:install");
  console.log("");

  if (TEST_MODE) {
    console.log("Packaging (test — no notarize)…");
    run("SKIP_NOTARIZE=true npx electron-builder --mac --arm64 --dir");
  } else {
    console.log("Packaging + notarizing (this can take 5–15 min)…");
    const env = {
      ...process.env,
      APPLE_ID,
      APPLE_APP_SPECIFIC_PASSWORD,
      APPLE_TEAM_ID,
    };
    run("npx electron-builder --mac --arm64", { env });
  }
}

function uploadRelease(version) {
  const distDir = path.join(__dirname, "../dist");
  const files = fs
    .readdirSync(distDir)
    .filter((f) => f.endsWith(".dmg") || f.endsWith(".dmg.blockmap") || f === "latest-mac.yml")
    .map((f) => path.join(distDir, f));

  if (files.length === 0) fail("No .dmg files in dist/. Build failed?");

  console.log("\nPushing version commit and tag…");
  run("git push origin HEAD --follow-tags");

  console.log(`\nCreating GitHub release v${version}…`);
  const fileArgs = files.map((f) => `"${f}"`).join(" ");
  run(
    `gh release create v${version} ${fileArgs} ` +
      `--title "v${version}" ` +
      `--generate-notes`,
  );
  console.log("");
}

async function main() {
  const start = Date.now();
  console.log("========================================");
  console.log(TEST_MODE ? "  Kyrelo — TEST BUILD" : "  Kyrelo — RELEASE");
  console.log("========================================");

  if (!TEST_MODE) validate();

  const version = TEST_MODE
    ? require("../package.json").version
    : bumpVersion();

  build();

  if (!TEST_MODE) uploadRelease(version);

  console.log("========================================");
  console.log(`  Done in ${fmt(Date.now() - start)}`);
  if (TEST_MODE) {
    console.log("  App: dist/mac-arm64/Kyrelo.app");
    console.log("  (Not notarized — Gatekeeper will warn.)");
  } else {
    console.log(`  Release: https://github.com/samueleastdev/Kyrelo-Buffer-Alternative-Desktop-App-VybeCoding-and-Contribute/releases/tag/v${version}`);
  }
  console.log("========================================\n");
}

main().catch((err) => {
  console.error("\nRelease failed:", err.message);
  process.exit(1);
});
