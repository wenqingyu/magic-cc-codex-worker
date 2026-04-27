// Bundle src/index.ts into a single self-contained plugin/dist/index.js
// that can run without node_modules at the install location.
import { build } from "esbuild";
import { rm, mkdir, cp, chmod, readFile } from "node:fs/promises";

// Version-drift guard. We have five places where the version is
// duplicated, and missing one (most fatally `plugin/.claude-plugin/
// plugin.json`, which is what Claude Code's plugin loader actually
// reads to decide what version to label the cache directory) makes a
// release functionally invisible — the runtime keeps loading the old
// label even though the code on disk is fresh. Fail the build hard
// when any literal disagrees with package.json's authoritative one.
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const expected = pkg.version;
const versionedFiles = [
  { path: "plugin/.claude-plugin/plugin.json", get: (j) => j.version },
  { path: ".claude-plugin/marketplace.json", get: (j) => j.metadata.version },
  {
    path: ".claude-plugin/marketplace.json",
    get: (j) => j.plugins[0].version,
    label: "marketplace.json plugins[0].version",
  },
];
for (const v of versionedFiles) {
  const json = JSON.parse(await readFile(v.path, "utf8"));
  const actual = v.get(json);
  if (actual !== expected) {
    throw new Error(
      `version drift: ${v.label ?? v.path} is "${actual}" but package.json says "${expected}". ` +
        `Bump it before releasing — Claude Code's plugin loader reads ${v.path} to label the cache dir.`,
    );
  }
}
// String-literal version refs in two MCP banners. cheap regex check.
for (const src of ["src/index.ts", "src/mcp/codex-client.ts"]) {
  const text = await readFile(src, "utf8");
  const m = text.match(/name:\s*"magic-codex",\s*version:\s*"([^"]+)"/);
  if (!m) continue;
  if (m[1] !== expected) {
    throw new Error(
      `version drift: ${src} has "${m[1]}" but package.json says "${expected}".`,
    );
  }
}

await rm("plugin/dist", { recursive: true, force: true });
await mkdir("plugin/dist/roles", { recursive: true });

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "plugin/dist/index.js",
  banner: {
    js: [
      "#!/usr/bin/env node",
      // Some transitive deps (execa → cross-spawn, etc.) use CJS require().
      // ESM output needs an import.meta-rooted createRequire shim.
      "import { createRequire as __magicCodexCreateRequire } from 'module';",
      "const require = __magicCodexCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  logLevel: "info",
});

await chmod("plugin/dist/index.js", 0o755);
await cp("src/roles/defaults", "plugin/dist/roles/defaults", { recursive: true });

console.log("✓ plugin/dist/index.js ready");
