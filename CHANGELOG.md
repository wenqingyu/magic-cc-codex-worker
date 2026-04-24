# Changelog

All notable changes documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

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
- Slash commands (8): `/codex-spawn`, `/codex-status`, `/codex-resume`, `/codex-cancel`, `/codex-merge`, `/codex-discard`, `/codex-review-pr`, `/codex-mode`.
- Subagent definitions (3): `codex-implementer`, `codex-reviewer`, `codex-planner`.

## [0.0.2] — 2026-04-24

### Added
- `resume` tool: continues a terminal agent's session via Codex's native `codex-reply` on the stored `thread_id`. Rejects on unknown, still-running, or no-thread_id.
- `cancel` tool: surgical kill via `cancelRequested` flag + child process stop. Distinguishes cancelled (no error) from failed. Idempotent on terminal agents. `force: true` also removes worktree + branch.
- `list` tool: filter by role / status / issue_id / has_pr / stale_after_seconds.
- Shared `launchBackground` helper unifying spawn and resume lifecycle (pid tracking, per-role timeout, cancel semantics, active-map bookkeeping).

## [0.0.1] — 2026-04-24

### Added
- Walking skeleton: `spawn`, `status`, `result`, `get_delegation_policy`.
- Async spawn with background task; registry persists to `.codex-team/state.json`.
- Git worktree lifecycle for implementer role.
- TOML role presets (implementer / reviewer / planner / generic) with precedence merge.
- Delegation policy (minimal / balance / max) exposed so Claude reads it at session start.
- Codex MCP client speaks `codex mcp-server` over stdio JSON-RPC.
- TypeScript strict; 35 unit tests; smoke script for JSON-RPC tool enumeration.
- Initial design + implementation plan docs in `docs/plans/`.
