#!/usr/bin/env node
// Cut a release: validate, tag, push, and create the GitHub Release with
// notes extracted from CHANGELOG.md. Idempotent — re-running on a tag
// that already exists locally or on origin will skip the create step
// for that side and proceed; re-running after the GitHub Release also
// exists is a hard error (refuses to clobber).
//
// Usage:
//   node scripts/release.mjs              # cut release for whatever package.json says
//   node scripts/release.mjs --dry-run    # show what would happen, change nothing
//
// Preconditions (script enforces):
//   1. Working tree clean on `main`, up to date with origin.
//   2. package.json version not already tagged on origin.
//   3. CHANGELOG.md has a `## [<version>]` section (notes body).
//   4. `npm run build` passes — drift guard validates all 5 version
//      literals match package.json.
//   5. `gh auth status` is authenticated.
//
// What it does:
//   1. Builds + tests (sanity check; same as CI would do).
//   2. Annotated tag `vX.Y.Z` with the CHANGELOG section's first prose
//      line as the message (becomes the GitHub Release title via
//      gh release create --verify-tag).
//   3. Pushes the tag to origin.
//   4. Creates the GitHub Release with --latest, body = CHANGELOG
//      section.
//
// To make a future release: bump version literals (build will fail if
// any is missed), add a CHANGELOG entry, commit/PR/merge to main, then
// run `npm run release`. That's the whole procedure.

import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dryRun = process.argv.includes("--dry-run");

function sh(cmd, opts = {}) {
  if (dryRun && opts.mutating) {
    console.log(`[dry-run] would run: ${cmd}`);
    return "";
  }
  return execSync(cmd, { stdio: opts.silent ? "pipe" : "inherit", encoding: "utf8" });
}

function shCapture(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

// 1. Read package version
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const version = pkg.version;
const tag = `v${version}`;
console.log(`→ release target: ${tag}`);

// 2. Sanity: clean tree on main, synced
const branch = shCapture("git rev-parse --abbrev-ref HEAD");
if (branch !== "main") {
  fail(`must release from main; currently on ${branch}`);
}
const status = shCapture("git status --porcelain");
if (status) {
  fail(`working tree not clean:\n${status}`);
}
sh("git fetch origin main --quiet", { silent: true });
const localHead = shCapture("git rev-parse HEAD");
const remoteHead = shCapture("git rev-parse origin/main");
if (localHead !== remoteHead) {
  fail(`local main (${localHead.slice(0, 8)}) is not in sync with origin/main (${remoteHead.slice(0, 8)})`);
}

// 3. Verify tag doesn't already exist on origin
const remoteTags = shCapture("git ls-remote --tags origin").split("\n");
if (remoteTags.some((line) => line.endsWith(`refs/tags/${tag}`))) {
  fail(`tag ${tag} already exists on origin — refusing to clobber. If you need to redo, delete it first: git push origin :refs/tags/${tag}`);
}

// 4. Verify CHANGELOG has an entry for this version
const changelog = await readFile("CHANGELOG.md", "utf8");
const sectionRe = new RegExp(
  `^## \\[${version.replace(/\./g, "\\.")}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|\\Z)`,
  "m",
);
const match = sectionRe.exec(changelog);
if (!match) {
  fail(`CHANGELOG.md has no entry for [${version}]`);
}
const notesBody = match[1].trim() + "\n";

// 5. Derive a release title. Use the first non-blank, non-heading line
//    from the CHANGELOG section as the summary. Fall back to "vX.Y.Z".
const summaryLine = notesBody
  .split("\n")
  .find((line) => line.trim() && !line.startsWith("#") && !line.startsWith("-") && !line.startsWith(">"));
const titleSuffix = summaryLine
  ? summaryLine.replace(/^\*\*/, "").replace(/\*\*\.?$/, "").replace(/\.$/, "").slice(0, 80)
  : "";
const title = titleSuffix ? `${tag} — ${titleSuffix}` : tag;
console.log(`→ title: ${title}`);

// 6. Run build (drift guard validates version literals match)
console.log("\n→ npm run build (drift guard)");
sh("npm run build");

// 7. Run tests (sanity)
console.log("\n→ npm test");
sh("npm test");

// 8. Verify gh is authenticated
try {
  sh("gh auth status", { silent: true });
} catch {
  fail("gh CLI not authenticated; run `gh auth login`");
}

// 9. Tag locally (annotated, message = title)
console.log(`\n→ git tag -a ${tag}`);
sh(`git tag -a ${tag} -m "${title.replace(/"/g, '\\"')}"`, { mutating: true });

// 10. Push tag
console.log(`→ git push origin ${tag}`);
sh(`git push origin ${tag}`, { mutating: true });

// 11. Create GitHub Release. --verify-tag makes gh use the existing
//     pushed tag; --latest marks this as the latest release on the
//     project page.
const notesPath = join(tmpdir(), `release-notes-${tag}.md`);
writeFileSync(notesPath, notesBody, "utf8");
try {
  console.log(`→ gh release create ${tag}`);
  if (!dryRun) {
    sh(
      `gh release create ${tag} --verify-tag --latest --title "${title.replace(/"/g, '\\"')}" --notes-file "${notesPath}"`,
      { mutating: true },
    );
  } else {
    console.log(`[dry-run] would gh release create ${tag} --notes-file ${notesPath}`);
  }
} finally {
  if (!dryRun) {
    try {
      unlinkSync(notesPath);
    } catch {
      // ignore
    }
  }
}

console.log(`\n✓ released ${tag}`);
console.log(`  https://github.com/wenqingyu/magic-cc-codex-worker/releases/tag/${tag}`);
