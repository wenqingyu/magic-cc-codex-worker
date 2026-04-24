# Changelog

All notable changes documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

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
