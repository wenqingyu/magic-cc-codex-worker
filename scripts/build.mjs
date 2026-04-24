// Bundle src/index.ts into a single self-contained plugin/dist/index.js
// that can run without node_modules at the install location.
import { build } from "esbuild";
import { rm, mkdir, cp, chmod } from "node:fs/promises";

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
