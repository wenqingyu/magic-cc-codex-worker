# Changelog

All notable changes documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.3.3] — 2026-04-24

### Fixed
- **Critical:** The `magic-codex` MCP server was never starting when Claude Code launched it. Root cause: `.mcp.json` used a relative path `./dist/index.js`, and Claude Code doesn't spawn MCP servers with the plugin directory as cwd — so the path wouldn't resolve. Fixed by using `${CLAUDE_PLUGIN_ROOT}/dist/index.js` (the absolute-path env var Claude Code exports to MCP subprocesses). Both MCP servers (`magic-codex` + `codex-raw`) now start correctly, and the 9 custom tools (spawn/status/result/...) are actually callable.

### Changed
- **`/magic-codex:mode` now writes to user-global config by default** (`~/.magic-codex/config.toml`), matching user expectations of "set the delegation level for my Claude Code globally." The previous project-scoped behavior is still available with the explicit `--project` flag, which requires being in a git repo (error if not). This prevents accidental config writes to the current working directory when the cwd isn't a real project.

## [0.3.2] — 2026-04-24

### Fixed
- **Critical:** MCP server couldn't start once installed. `plugin/dist/index.js` imported `@modelcontextprotocol/sdk`, `execa`, `zod`, etc. at runtime, but Claude Code's plugin install copies the plugin directory verbatim — no `npm install` step — so `node_modules` was never shipped. Node threw `ERR_MODULE_NOT_FOUND` at startup, Claude Code silently fell back, and only the `codex-raw` server's tools were exposed. `/magic-codex:status` and the other 8 slash commands appeared registered but calling them failed because the backing MCP tools weren't there.
- Fix: bundle all runtime dependencies into a single `plugin/dist/index.js` using esbuild. The bundled file runs standalone with no `node_modules` required. Includes a `createRequire` shim in the banner to handle transitive CJS-only deps (execa → cross-spawn). `plugin/dist/roles/defaults/*.toml` is still copied as data files alongside the bundle.

### Changed
- New build pipeline: `scripts/build.mjs` orchestrates esbuild + TOML copy. Build output is now a single-file 947 KB bundle instead of a directory tree of compiled `.js` files. Much simpler to ship, same speed at startup.
- Source now omits the shebang line (esbuild injects it via `--banner`).
- README install section adds **Step 3 — `/reload-plugins`** so users don't have to fully restart Claude Code after install.

## [0.3.1] — 2026-04-24

### Changed (breaking)
- **Plugin + marketplace renamed** from `magic-cc-codex-worker` to `magic-codex`. The GitHub repo (and `/plugin marketplace add` URL) is still `wenqingyu/magic-cc-codex-worker`, but the plugin's declared name inside `plugin.json` and `marketplace.json` is now `magic-codex`. This shortens the auto-prefixed command surface from `/magic-cc-codex-worker:magic-codex-<verb>` (40 chars, double-prefixed) to `/magic-codex:<verb>` (~16 chars, clean).
- **Command filenames shortened** from `magic-codex-<verb>.md` to `<verb>.md`. Commands now invoke as:
  - `/magic-codex:spawn` · `/magic-codex:status` · `/magic-codex:resume`
  - `/magic-codex:cancel` · `/magic-codex:merge` · `/magic-codex:discard`
  - `/magic-codex:review-pr` · `/magic-codex:fan-out` · `/magic-codex:mode`
- **Subagent names shortened** — `magic-codex-implementer` → `implementer`, `magic-codex-reviewer` → `reviewer`, `magic-codex-planner` → `planner` (they remain auto-namespaced by Claude Code as `magic-codex:implementer` etc. when invoked).
- **Install command** is now `/plugin install magic-codex@magic-codex` (was `/plugin install magic-cc-codex-worker@magic-cc-codex-worker`).

### Upgrade
Users on 0.3.0 must clear the cache and reinstall:

```
/plugin marketplace remove magic-codex
/plugin marketplace add wenqingyu/magic-cc-codex-worker
/plugin install magic-codex@magic-codex
```

## [0.3.0] — 2026-04-24

### Changed (breaking)
- **All user-facing identifiers renamed to `magic-codex-*`** to avoid conflict with any current or future third-party `codex-*` plugins (notably OpenAI's official Codex plugin, if and when it ships). Concrete renames:
  - **Slash commands:** `/codex-spawn` → `/magic-codex-spawn`, `/codex-status` → `/magic-codex-status`, `/codex-resume` → `/magic-codex-resume`, `/codex-cancel` → `/magic-codex-cancel`, `/codex-merge` → `/magic-codex-merge`, `/codex-discard` → `/magic-codex-discard`, `/codex-review-pr` → `/magic-codex-review-pr`, `/codex-fan-out` → `/magic-codex-fan-out`, `/codex-mode` → `/magic-codex-mode`.
  - **Subagents:** `codex-implementer` → `magic-codex-implementer`, `codex-reviewer` → `magic-codex-reviewer`, `codex-planner` → `magic-codex-planner`.
  - **MCP server:** `codex-team` → `magic-codex`. Exposed tool names (`spawn`, `status`, `result`, `resume`, `cancel`, `list`, `merge`, `discard`, `get_delegation_policy`) unchanged; their fully-qualified form is now `mcp__magic-codex__<tool>`.
  - **Env vars:** `CODEX_TEAM_DELEGATION_LEVEL` → `MAGIC_CODEX_DELEGATION_LEVEL`, `CODEX_TEAM_STATE_DIR` → `MAGIC_CODEX_STATE_DIR`.
  - **Config files:** `codex-team.toml` → `magic-codex.toml` (project-level config).
  - **State directory:** `.codex-team/` → `.magic-codex/` (persistent agent registry + worktree parent). Fresh installs land at the new path; existing `.codex-team/` state does not migrate automatically.
  - **Workers.json worker kind:** `kind: "codex-team"` → `kind: "magic-codex"` (MF integration).

The raw Codex MCP server (`codex-raw`, exposing `codex` / `codex-reply`) is unchanged — that's the upstream server name.

### Upgrade notes
Users on 0.2.6 should `/plugin marketplace remove magic-cc-codex-worker` + re-add + re-install to pick up the new command surface. Any `codex-team.toml` project config should be renamed to `magic-codex.toml`. Any scripts referencing `/codex-*` slash commands or `CODEX_TEAM_*` env vars need updating.

## [0.2.6] — 2026-04-24

### Fixed
- **Critical:** Slash commands (`/magic-codex-spawn`, `/magic-codex-status`, etc.) were registered but never exposed as user-invokable because command files were missing the `disable-model-invocation: true` frontmatter flag. Without it, Claude Code loads each `.md` as a model-invoked skill instead of a user-facing slash command — so the install appeared successful but typing `/magic-codex-status` did nothing. Added the flag to all 9 command files.

## [0.2.5] — 2026-04-24

### Changed
- **License changed from MIT → PolyForm Noncommercial 1.0.0.** Free for independent developers, hobbyists, researchers, and nonprofits (with attribution preserved). Commercial use — by for-profit companies, as part of SaaS offerings, or public redistribution of derivative products — now requires a separate commercial license. See [`COMMERCIAL.md`](./COMMERCIAL.md) for how to request one. Prior versions (0.2.0 – 0.2.4) remain MIT-licensed; anyone who already used them under MIT retains those rights for those versions.
- [`COMMERCIAL.md`](./COMMERCIAL.md) added — explains who needs a commercial license, what attribution looks like, and how to request one (GitHub issue with `commercial-license` label).
- README license sections (EN + zh-CN) rewritten to describe the new terms plainly.

## [0.2.4] — 2026-04-24

### Fixed
- **Critical (root-cause fix):** Claude Code's plugin installer auto-rewrites any `github.com` URL in a plugin `source` to the SSH form `git@github.com:owner/repo.git`, regardless of whether we specified HTTPS. This broke 0.2.3's `{ source: "url", url: "https://..." }` install for users without GitHub SSH keys. Fixed by restructuring the repo so the plugin sits in a `./plugin` subdirectory and the marketplace references it via `"source": "./plugin"`. Claude Code then uses the already-cloned marketplace copy — no second clone, no SSH, no auth issue.

### Changed
- **Repo layout.** Plugin assets live under `plugin/`: `plugin/.claude-plugin/plugin.json`, `plugin/.mcp.json`, `plugin/commands/`, `plugin/agents/`, `plugin/dist/`. Source/tests/docs stay at repo root for developers. `.claude-plugin/marketplace.json` at repo root points at `./plugin`.
- TypeScript `outDir` and build script output into `plugin/dist/` instead of root `dist/`.
- CI drift check, smoke script, and `.gitignore` updated for the new path.

## [0.2.3] — 2026-04-24

### Fixed
- **Critical:** Plugin install failed with `git@github.com: Permission denied (publickey)` on any user without GitHub SSH keys configured. Root cause: the `github` source type in `marketplace.json` clones via SSH (`git@github.com:owner/repo.git`). Switched to the `url` source type with an explicit HTTPS URL (`https://github.com/wenqingyu/magic-cc-codex-worker.git`), which works for everyone regardless of SSH setup.

## [0.2.2] — 2026-04-24

### Fixed
- **Critical:** `marketplace.json` schema was invalid — was missing the required `owner` object and used `source: "."` (which Claude Code's parser rejects). Plugin install errored with `Failed to parse marketplace file: owner: Invalid input, plugins.0.source: Invalid input`. Fixed by adding `owner: { name: "Wenqing Yu" }` and using the canonical `{ source: "github", repo: "wenqingyu/magic-cc-codex-worker" }` source form. 0.2.0 and 0.2.1 both shipped with this broken marketplace — upgrade to 0.2.2 and re-install.
- Top-level `description` moved into `metadata.description` per the marketplace schema.

## [0.2.1] — 2026-04-24

### Fixed
- **Critical:** `plugin.json` relocated from repo root to `.claude-plugin/plugin.json` (the canonical location Claude Code scans for plugin discovery). Without this, `/plugin install` would appear to succeed but the plugin's commands, agents, and MCP servers were never exposed to the session. This affected every 0.2.0 install.
- Build script made idempotent — `dist/roles/defaults` is cleaned before the TOML copy, preventing a nested `dist/roles/defaults/defaults/` on repeat builds.
- CI drift check added to `.github/workflows/ci.yml` — fails the build if committed `dist/` doesn't match a fresh `npm run build`, preventing stale artifacts.

### Changed
- Install flow simplified to two slash commands (`/plugin marketplace add wenqingyu/magic-cc-codex-worker` + `/plugin install magic-cc-codex-worker@magic-cc-codex-worker`) after Claude Code's marketplace mechanism clarified. No clone / build step required by the user.
- `dist/` is now committed so remote install works without a Node toolchain on the user's machine.

## [0.2.0] — 2026-04-24

### Added
- **PR worktree mode** for the reviewer role: when spawned with `pr_number`, the plugin runs `gh pr view`, materializes a detached git worktree at the PR's head SHA, and runs the reviewer read-only against real filesystem contents. Enables the dual-model review flow (GPT reviewer + Claude reviewer) with qualitatively better results than diff-only review.
- `GhClient` wrapper around `gh pr view --json`, graceful null on any failure.
- `Worktrees.createDetached` — worktree at an arbitrary ref without branch creation.
- `/codex fan-out` slash command — parallel spawn for Linear epic children (MF mode) or inline prompt lists.
- Templater placeholders: `{{pr_title}}`, `{{pr_head_ref}}`, `{{pr_diff_url}}`, `{{pr_context}}`.

### Changed
- Reviewer role tests expand to cover PR materialization + fallback path when gh returns null.

## [0.1.0] — 2026-04-24

### Added
- **Magic Flow integration**, auto-detected via `.magic-flow/` dir or `ops/workers.json`. All MF behaviors are opt-out-by-absence — the plugin remains fully functional outside MF projects.
- `src/mf/detect.ts` — MF marker detection.
- `src/mf/conventions.ts` — parses "Magic Flow Workflow Conventions" section from `~/.claude/CLAUDE.md`; injected into Codex `developer_instructions` so MF-aware agents follow branch / commit / Linear conventions.
- `src/mf/linear.ts` — minimal Linear GraphQL client for issue enrichment (`LINEAR_API_KEY` optional, graceful null on failure).
- `src/mf/workers.ts` — mirrors agent lifecycle to `ops/workers.json` using MF-compatible schema; coexists with other worker kinds (e.g. Cyrus).
- MF-aware branch naming: `feature/TEAM-NNN-<slugified-title>` when Linear issue resolvable, `feature/TEAM-NNN-<issue-id>` fallback, `codex/<suffix>` for non-MF.
- Templater placeholders populated from Linear: `{{issue_title}}`, `{{issue_description}}`, `{{issue_url}}`, `{{mf_conventions}}`.
- 11 new unit tests covering MF detection, conventions parsing, workers.json mirror, branch naming, conventions injection.

## [0.0.3] — 2026-04-24

### Added
- `merge` tool: merges completed agent's worktree branch back into base_ref (squash/ff/rebase). Removes worktree after unless `keep_worktree: true`.
- `discard` tool: removes a terminal agent's worktree + deletes its branch. Requires cancel first if still running.
- Slash commands (8): `/magic-codex-spawn`, `/magic-codex-status`, `/magic-codex-resume`, `/magic-codex-cancel`, `/magic-codex-merge`, `/magic-codex-discard`, `/magic-codex-review-pr`, `/magic-codex-mode`.
- Subagent definitions (3): `magic-codex-implementer`, `magic-codex-reviewer`, `magic-codex-planner`.

## [0.0.2] — 2026-04-24

### Added
- `resume` tool: continues a terminal agent's session via Codex's native `codex-reply` on the stored `thread_id`. Rejects on unknown, still-running, or no-thread_id.
- `cancel` tool: surgical kill via `cancelRequested` flag + child process stop. Distinguishes cancelled (no error) from failed. Idempotent on terminal agents. `force: true` also removes worktree + branch.
- `list` tool: filter by role / status / issue_id / has_pr / stale_after_seconds.
- Shared `launchBackground` helper unifying spawn and resume lifecycle (pid tracking, per-role timeout, cancel semantics, active-map bookkeeping).

## [0.0.1] — 2026-04-24

### Added
- Walking skeleton: `spawn`, `status`, `result`, `get_delegation_policy`.
- Async spawn with background task; registry persists to `.magic-codex/state.json`.
- Git worktree lifecycle for implementer role.
- TOML role presets (implementer / reviewer / planner / generic) with precedence merge.
- Delegation policy (minimal / balance / max) exposed so Claude reads it at session start.
- Codex MCP client speaks `codex mcp-server` over stdio JSON-RPC.
- TypeScript strict; 35 unit tests; smoke script for JSON-RPC tool enumeration.
- Initial design + implementation plan docs in `docs/plans/`.
