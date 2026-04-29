# Changelog

All notable changes documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.5.2] — 2026-04-29

Tooling-only release.

### Added
- **`npm run release` script** (`scripts/release.mjs`) automates the full release procedure: validates clean `main`, refuses to clobber existing tags, verifies the CHANGELOG has an entry for the version in `package.json`, runs build (with the version-drift guard) + tests, creates the annotated tag, pushes it, and creates the GitHub Release with the CHANGELOG section as the body and `--latest` flag. Closes the gap from 0.5.0/0.5.1 where tags got pushed but GitHub Releases didn't, leaving the project's release page stuck at 0.3.9.
- **`npm run release:dry-run`** prints what would happen without mutating anything.
- **CONTRIBUTING.md** documents the maintainer release procedure end to end, calling out the five duplicated version literals (and that `plugin/.claude-plugin/plugin.json` is the one Claude Code's plugin loader actually reads).

### Internal
- Backfilled GitHub Releases for v0.4.0 / v0.4.1 / v0.4.2 / v0.5.0 / v0.5.1 with their CHANGELOG bodies.

## [0.5.1] — 2026-04-29

Docs-only release.

### Changed
- **Model recommendations refreshed for the mid-2026 codex lineup.** The 2025-era per-role split (`gpt-5.2-codex` for code, `gpt-5` for review, `o3` for planning) collapsed: `gpt-5.5` now handles all three workloads and the dial that matters is reasoning effort, configured via codex CLI profiles (`[profiles.coding]`, `[profiles.deep]`, `[profiles.fast]`). The README "Choosing models" section and `magic-codex.toml.example` now both lead with "leave model unset, configure your `~/.codex/config.toml`" and only show in-magic-codex pinning for the budget-capping case (e.g., `[roles.generic] model = "gpt-5-codex-mini"`).
- **`magic-codex.toml.example` filename bug fixed.** Header comments referenced the wrong file (`codex-team.toml`); the actual loader reads `magic-codex.toml`. Corrected.
- **README role table** corrected to show implementer's `danger-full-access` default (was still showing `workspace-write` from before the 0.4.0 switch).

## [0.5.0] — 2026-04-28

### Added
- **`wait` MCP tool — push notifications instead of polling.** Block until any tracked agent reaches a terminal state (`completed` / `failed` / `cancelled`), then return the batch of agents that just transitioned. Replaces the dispatcher's `ScheduleWakeup` poll loop with a single blocking call: spawn agents → call `wait` once → react to events → optionally call `wait` again with the returned `observed_at` cursor. The connection stays open while waiting, so the prompt cache never goes cold between checks. Eliminates the 5-min poll cadence and its cache-miss costs.
  - **Replay-safe via `since` cursor.** Pass the previous response's `observed_at` to guarantee gap-free delivery across reconnects. Historical events are returned synchronously without blocking.
  - **Batch coalescing.** When several agents finish within milliseconds of each other (common at the tail of a fan-out batch), `wait` holds the response open for `batch_window_ms` (default 100) and returns them all together. Set to 0 to disable.
  - **Self-describing response.** `agents_still_running` and `agents_running_ids` tell the caller whether and how to call again — no separate `list` or `status` round-trip needed.
  - **Filtering.** `agent_ids: ["..."]` scopes the wait to a known fan-out batch; `terminal_only: false` widens to every status transition. Defaults match the common dispatcher case.
- **`Registry` extends `EventEmitter`** and emits `change` (`{ before_status, record }`) on every successful update. Internal API; the zombie sweep on load explicitly does not emit (it's a maintenance pass, not a real-time transition).

### Internal
- New module `src/wait.ts` houses the handler logic (replay + live subscribe + batch + timeout). Independent of the MCP transport so it's straightforward to unit-test.
- 9 new tests across `Registry` (event emission + zombie-sweep silence) and `wait` (replay, agent_ids filter, since cursor, live subscribe, batch coalescing, timeout/listener-leak guard, scoped agents_still_running). Total: 117 (was 108).
- Build-time version-drift guard from 0.4.2 caught two missed bumps during release prep — working as intended.

## [0.4.2] — 2026-04-27

Metadata-only release that fixes a release-process bug from 0.4.0 / 0.4.1.

### Fixed
- **`plugin/.claude-plugin/plugin.json` was never bumped past `0.3.9`**, so Claude Code's plugin loader kept labeling the cache directory `0.3.9` even though the code on disk was the new release. Functionally invisible upgrades — `mtime` and code fingerprints (`demote` / `sandbox_denied` / `rate_limited`) confirmed the new behavior was active, but every diagnostic that read the plugin label reported the old version. Bumped to 0.4.2.
- **`src/mcp/codex-client.ts` MCP banner version** was also missed in the 0.4.1 commit (still said `0.4.0`). Bumped.

### Added
- **Build-time version-drift guard** in `scripts/build.mjs`. The build now fails hard when `package.json`, `plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (both the metadata and plugins[0] versions), or the two MCP banner literals disagree. Prevents this class of silent-mislabel bug from recurring.

## [0.4.1] — 2026-04-27

This release closes the dispatcher-trust gap and adds a visibility surface for the workspace-write sandbox limitation that 0.4.0 only partially worked around.

### Fixed
- **`status: "completed"` no longer hides sandbox/quota failures.** Codex sometimes returns a "successful" tool call even when its underlying actions were blocked — typically `Operation not permitted` on `.git/worktrees/<id>/index.lock`, or a rate-limit hit mid-call. The agent describes the failure in prose, but the dispatcher trusted `completed` and moved on. Fix: post-completion, the orchestrator now classifies the captured stderr (and watches for high-confidence `.git/worktrees/*.lock` markers in prose paired with `commits_ahead === 0`) and demotes `completed` → `failed` with the right `kind` (`sandbox_denied` or `rate_limited`). `last_output` is preserved on the failure record. Five new regression tests cover stderr-detected denials, mid-call rate limits, prose-only signal, the no-demote success path, and the false-positive guard for "agent recovered and committed despite mentioning the error".
- **Rate-limit retry hints are now also captured on the success path.** `error.retry_at` and `error.retry_after_seconds` (added in 0.4.0 for thrown failures) now also populate when a "successful" call is demoted because stderr showed a rate-limit message.

### Added
- **Loud warning when the effective implementer sandbox is `workspace-write`.** Empirical follow-up to 0.4.0: even with the canonicalized `writable_roots` workaround, `.git/worktrees/<id>/index.lock` writes are still rejected on macOS for ~33-67% of spawns. The 0.4.0 default switch to `danger-full-access` avoids this entirely, but the gap commonly surprises users who: (a) have a project `magic-codex.toml` pinning `workspace-write`, (b) pass `overrides.sandbox = "workspace-write"` per spawn, or (c) are loading a cached older version of the plugin. Each implementer spawn whose effective sandbox is `workspace-write` now logs a one-line `[magic-codex] WARNING: ...` to stderr explaining what's happening and pointing at the recommended remediation.

### Notes
- The `workspace-write` sandbox limitation isn't fully closeable from the plugin side — codex's seatbelt policy doesn't expose a knob to add `*/.git/worktrees/<own-worktree-id>/*` to the writable scope dynamically. If you must use `workspace-write` (e.g., for stricter network egress isolation), expect `index.lock` denials to still happen; rely on the new silent-failure detection above to surface them as `failed`/`kind=sandbox_denied` instead of silent `completed`.

## [0.4.0] — 2026-04-27

This release closes a batch of operational potholes surfaced by ~50 real spawns across multi-repo workspaces. Most of the changes are defaults that empirical evidence has already validated; a few are bug fixes for things the test suite never caught because they only manifest across process restarts or in repos with non-`main` defaults.

### Fixed
- **`discard` failed in multi-repo workspaces.** It ran `git -C <orchestrator-default-repo>` even when the agent had been spawned with a per-call `repo_root` override. In HQ-style workspaces where the orchestrator's launch cwd isn't itself a git repo, this exited with `fatal: not a git repository` and the only workaround was a manual `git -C <repo> worktree remove --force`. Fix: persist `repo_root` on the agent record at spawn time and recreate a per-record `Worktrees` instance for `discard`, `merge`, and `cancel --force`. Regression test exercises the multi-repo path.
- **Stale "running" zombies after process crashes.** When the MCP server died mid-spawn, agents marked `running` in `state.json` lingered there indefinitely (some lasted days in the wild). The orchestrator's in-memory `tasks`/`active` maps don't survive a restart, so any such record is by definition orphaned. Fix: `Registry.load()` now sweeps `running`/`queued` records into `failed` with `error.kind = "zombie"`, eagerly persisted. Two regression tests cover the sweep + the no-op for terminal records.
- **Stale baseline against `origin/<base_ref>`.** Long-lived MCP servers branched off whatever the local ref pointed at when the worktree was created — sometimes hours/days behind origin. Fix: `Worktrees.create` now does a best-effort `git fetch origin <base_ref> --quiet` before `worktree add`. Failure (no remote, offline) is silent and falls back to the local ref.
- **`base_ref` defaulted to `main` even in `master`-default repos.** ~40% of real-world repos still use `master` as their default branch; spawns into them died with `fatal: invalid reference: main`. Fix: when `base_ref` is omitted, probe `origin/HEAD` → local `main` → `master` → `develop` and pick the first that exists. Regression test creates a `master`-init repo and confirms the auto-detected base.

### Added
- **Implementer default sandbox is now `danger-full-access`.** `workspace-write` silently dropped `.git/worktrees/*.lock` writes for ~15-20% of spawns even with the 0.3.7 canonicalized `writable_roots` workaround. Empirically, danger-full-access on a per-spawn worktree is the smaller blast radius — the agent is already isolated to a throwaway branch and can't touch the main worktree. Override via `[roles.implementer] sandbox = "workspace-write"` in `magic-codex.toml`. The 0.3.7 writable_roots safety net is preserved for that opt-in path.
- **Rust no-fmt guardrail.** When the agent's worktree contains a `Cargo.toml`, the orchestrator now prepends a "DO NOT run `cargo fmt`" rule to `developer_instructions`. Codex agents reflexively run `cargo fmt` (often as a side effect of `cargo build` checks) and rewrite ~20-30 unrelated files, producing massive churn diffs that mask the actual change. Empirical: zero churn on Rust spawns since this landed.
- **`error.retry_at` and `error.retry_after_seconds` for rate-limited failures.** When codex prints "try again at HH:MM" or "retry after N seconds" on a rate-limit error, we now parse the time (interpreted as host-local for clock-style hints, with a tomorrow-rollover when the parsed time is already past) and resolve to absolute UTC. Surfaced on `status` and `result` so callers can sleep precisely instead of polling. Five new tests cover the seconds form, am/pm, rollover, and the no-hint path.
- **`AgentRecord.delta` (branch / commit_sha / diff_stat / commits_ahead).** After a successful worktree-bearing run, the orchestrator captures the structured commit output via `git rev-parse HEAD`, `git diff --stat <base_ref>..HEAD`, and `git rev-list --count`. Surfaced as separate fields on both `status` and `result` so callers don't need to parse the (possibly truncated) prose `last_output`. Best-effort: failures here never fail the agent.
- **`AgentRecord.repo_root`.** Persisted at spawn time so downstream ops (`merge`, `discard`, `cancel --force`) can target the correct repo in multi-repo workspaces. Absent on records created before 0.4.0 — those fall back to the orchestrator's default `repoRoot`.
- **`.magic-codex/` auto-added to repo `.gitignore`.** First worktree-bearing spawn now writes the entry idempotently. Without this, agents' first `git status` showed the worktree directory as untracked, and a careless `git add -A` could pull worktree submodules into the parent commit.

### Internal
- `classifyError(message, stderrTail)` is preserved for legacy callers; `classifyErrorDetailed(message, stderrTail, now?)` is the new entry point that returns `{ kind, retry_at?, retry_after_seconds? }`. The orchestrator failure-handler uses the detailed form.
- `AgentErrorKind` gains `"zombie"` for the registry sweep path.
- `Worktrees` gains `ensureGitignore()` and `detectDefaultBranch()` helpers (both best-effort, never throw).
- 15 new tests across `classify-error`, `registry`, and `orchestrator` suites; total now 103 (was 88) and all passing.

## [0.3.9] — 2026-04-25

### Added
- **Failure classification on `error.kind`.** When an agent fails, the orchestrator now attaches a coarse category to the error record: `rate_limited`, `sandbox_denied`, `timeout`, or `null`. The classifier reads the thrown error message and the tail of the captured codex stderr (0.3.8 wiring), matching a small set of conservative phrase regexes for each category. Rate-limit detection drives the ops pattern "codex quota → auto-fall back to Sonnet subagents" without per-run supervisor heuristics. Surfaced on the `status` tool as `error_kind` and on `result`'s `error.kind`. 15 classifier tests + 1 orchestrator end-to-end test cover positive matches, negatives that avoid false positives, and the failure-path wiring.
- **`AgentError.stderr_tail`** — the last 2 KB of stderr is now stashed on the failure record for supervisors who want to eyeball the cause without reading the full log file. Full history still lives at `<stateDir>/logs/<agent_id>.codex.stderr`.

### Notes
- HEAD.lock intermittency remains open; still waiting on a captured stderr log from a failing batch to pinpoint the real cause. The new `sandbox_denied` classifier will flag those automatically once they surface.
- No fix yet for: status-reporting lag vs actual commit time (shape TBD), Claude Code's own Agent-with-isolation-worktree race (upstream).

## [0.3.8] — 2026-04-25

### Added
- **Per-agent codex stderr capture.** Every spawn now tees the codex child's stderr to `<stateDir>/logs/<agent_id>.codex.stderr` (always on, best-effort) and records the path on the agent as `stderr_log`, surfaced by both `status` and `result`. When `MAGIC_CODEX_TRACE=1` is set, chunks are also forwarded to the plugin's own stderr prefixed with `[<agent_id>]`, so interleaved parallel output stays attributable.

### Why
- 0.3.7 canonicalized `writable_roots` via `realpathSync`, but batch-50 still reported 50% HEAD.lock denials. That rules out the canonical-path hypothesis. The next step needs ground truth rather than another guess: codex logs sandbox denials to stderr with the exact rejected path, which will pinpoint whether the block is seatbelt (and which path mismatched) or something else entirely — codex's own escalation-policy gating, git concurrency on shared `.git/objects` and `packed-refs`, or a kernel-level file lock contention between workers. After the next batch, read `<stateDir>/logs/*.codex.stderr` on the failing agents and we'll know.

### Changed
- `CodexChildOptions` grows an optional `onStderr(chunk: Buffer) => void`. `codexFactory` in `OrchestratorOptions` now accepts (still optional) options, so custom factories can opt in. Backwards-compatible — existing factories that ignore the arg keep working.
- `Registry` exposes a `rootDir` getter (read-only) so callers can derive sibling paths like the logs directory.
- `AgentRecord` gains `stderr_log?: string | null`. Old records without the field continue to load.

## [0.3.7] — 2026-04-25

### Fixed
- **`.git/worktrees/<worker>/HEAD.lock` denied intermittently (~40% of parallel spawns).** 0.3.6 added `<repo>/.git` as a writable root, but the path was passed verbatim from `git rev-parse --show-toplevel` — a logical path. macOS seatbelt evaluates `open()` against the canonical target (`/private/var/...`, APFS firmlinks, etc.), and some workers' paths resolved differently, missing the policy. Fix: canonicalize with `fs.realpathSync` before passing to codex. Flaky HEAD.lock denials should now be fully deterministic.
- Version literals in `src/index.ts` and `src/mcp/codex-client.ts` were frozen at 0.3.5 / 0.3.0. Bumped to match release.

### Added
- **`MAGIC_CODEX_TRACE=1` diagnostic.** When enabled, each `spawn` logs one JSON line to stderr with `{t, pid, event, role, prompt_head, prompt_len, agent_id}` at both `spawn.received` (args parsed) and `spawn.created` (agent registered). Lets you tell whether batched multi-call spawns are misrouting prompts upstream of the plugin (Claude Code's MCP client / stdio transport) or inside it. The handler code itself has no cross-request shared state, so misrouting likely originates upstream — this flag gives you the evidence.

## [0.3.6] — 2026-04-24

### Fixed
- **Codex workers couldn't run git from their own worktree.** Under `sandbox: workspace-write`, seatbelt/landlock scopes writes to the primary workspace — but `git worktree add` creates a linked worktree whose `.git` is a pointer file to `<main-repo>/.git/worktrees/<name>/`. Every `git add`/`commit`/`branch` inside a worker worktree writes to the shared object DB and per-worktree metadata in the main repo's `.git`, which sat outside the sandbox and was blocked. Workers appeared to "refuse git" and all finalization had to be redundantly handed back to a supervisor. Fix: the orchestrator now passes `config.sandbox_workspace_write.writable_roots = ["<repo>/.git"]` to the codex MCP `codex` tool on any workspace-write worktree spawn. Network stays blocked, the main working tree stays read-only, only `.git` is newly writable. Implementer preset instructions updated to reflect that local git now works. Two new unit tests cover the pass-through for implementer (writable_roots set) and read-only reviewer (writable_roots omitted).

### Note (network still blocked)
This only fixes local git. `git push` and `gh pr create` still hit the network, which workspace-write blocks by design. Opening PRs from workers requires either enabling `sandbox_workspace_write.network_access = true` per spawn or continuing to delegate push/PR to a supervisor. A future release may expose `network_access` as a role preset knob.

## [0.3.5] — 2026-04-24

### Fixed
- **Every codex call > 60 s silently died with `MCP error -32001: Request timed out`.** Root cause: `CodexChild.call` never passed a `timeout` option to `client.callTool`, so the `@modelcontextprotocol/sdk` default 60-second `RequestTimeout` fired long before the orchestrator's per-role `withTimeout` wrapper. Every `implementer` run terminated at `ended_at − started_at ≈ 60s`, with the outer node-level wrapper never getting a chance. Fix: thread `timeoutMs` from the role preset (implementer = 1800s, reviewer = 600s, planner/generic = 900s — or per-spawn override) into `client.callTool`'s `options.timeout`. Also set `resetTimeoutOnProgress: true` so long-running codex sessions that emit progress notifications don't expire mid-stream. New unit test locks in the pass-through.

### Note (user config, not a plugin bug)
If your codex runs still fail fast with `The model "gpt-5.5" does not exist or you do not have access to it`, that's `~/.codex/config.toml` — `gpt-5.5` isn't a real model. Pick a real one (`gpt-5`, `gpt-5-codex`, etc.) or override per-role via `magic-codex.toml`.

## [0.3.4] — 2026-04-24

### Fixed
- **Subagents were no-ops in practice.** The three shipped subagents (`implementer`, `reviewer`, `planner`) had a `tools:` frontmatter allowlist using the old pre-plugin tool-name form (`mcp__magic-codex__spawn`). Claude Code actually exposes plugin MCP tools under `mcp__plugin_magic-codex_magic-codex__<tool>`, so the allowlist matched zero tools and every subagent invocation returned without doing work. Removed the `tools:` restriction entirely — subagents now inherit the full parent-session tool surface. Protocol body updated to explicitly reference `mcp__plugin_magic-codex_magic-codex__spawn` so callers understand the fully-qualified form.
- **`spawn` ran git from the wrong directory in multi-repo workspaces.** When Claude Code was launched from a workspace parent (e.g. `/workspace` containing `repo-a/`, `repo-b/`), the MCP server's auto-detected `repoRoot` was that non-repo parent. All `git worktree` ops then failed silently. Added a new `repo_root` parameter to the `spawn` MCP tool — when provided, the Orchestrator constructs a per-spawn `Worktrees` instance at that absolute path, bypassing auto-detect. Backwards-compatible: omitted = old behavior.

### Changed
- Subagent protocol bodies now instruct callers to always pass `repo_root` (absolute path) in multi-repo workspaces, with examples. Prevents the silent-failure mode reported in 0.3.3.

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
