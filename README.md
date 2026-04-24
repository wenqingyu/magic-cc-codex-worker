# magic-cc-codex-worker

> A **Magic Stack** plugin that turns [Codex](https://github.com/openai/codex) into a pool of Claude Code agent workers — spawn, track, resume, review, merge, and specialize Codex sessions directly from inside Claude Code.

**Version 0.2.0** — feature-complete walking plugin. All 10 MCP tools plus 8 slash commands, 3 subagents, Magic Flow integration, PR worktree mode, and epic fan-out are shipped and unit-tested.

## Why

Claude Code is excellent at orchestration, synthesis, and interactive work. Codex is excellent at long-running autonomous implementation and brings a different model stack (GPT) that's valuable for second-opinion reviews. This plugin lets Claude *delegate* work to Codex workers — running in isolated git worktrees, in parallel, with resumable sessions — so the two models complement each other instead of competing for the same context window.

## Prerequisites

- `codex` CLI installed and authenticated (verified with `codex-cli 0.122.0+`)
- Node.js 20+
- Git 2.40+
- Claude Code configured
- Optional (for PR review mode): `gh` CLI authenticated
- Optional (for Magic Flow Linear enrichment): `LINEAR_API_KEY` env var

Verify Codex is ready:

```bash
codex --version
codex mcp-server --help
```

## Install

```bash
git clone <repo-url> magic-cc-codex-worker
cd magic-cc-codex-worker
npm install
npm run build
```

Register with Claude Code by pointing at the plugin root — `.claude/mcp-servers.json` declares the MCP servers this plugin ships; `plugin.json` is the plugin manifest; `commands/` and `agents/` are picked up automatically by the plugin loader.

## Delegation level — tell Claude how much to offload

The core knob: how aggressively should Claude delegate work to Codex vs. doing it itself?

| Level | Intent |
|---|---|
| `minimal` | Codex only for things Codex does notably better (second-opinion GPT review, very long runs). Preserves Codex quota. |
| `balance` (default) | Balanced split; Claude handles quick/interactive work, Codex handles big/parallelizable chunks. |
| `max` | Codex handles everything it can; Claude stays in orchestrator mode. Preserves Claude tokens. |

Set via any of (highest precedence first):

- **Env**: `CODEX_TEAM_DELEGATION_LEVEL=max`
- **Project** (committed): `codex-team.toml` at repo root with `[delegation] level = "max"`
- **User-global**: `~/.codex-team/config.toml`

Claude discovers the current policy by calling `get_delegation_policy` at session start.

## MCP tools (10)

| Tool | Purpose |
|---|---|
| `spawn` | Launch a Codex agent in the background. Returns immediately with `agent_id`. |
| `status` | Per-agent or all-agents state snapshot + summary counts. |
| `result` | Full `last_output` of a terminal-state agent. |
| `resume` | Continue a terminal agent's session via Codex `codex-reply` on stored `thread_id`. |
| `cancel` | Kill a running agent's subprocess; mark `cancelled`. `force: true` also removes the worktree. |
| `merge` | Merge a completed implementer's worktree branch back into base_ref (squash/ff/rebase). |
| `discard` | Remove a terminal agent's worktree + delete its branch. |
| `list` | Filter agents by role / status / issue_id / has_pr / stale age. |
| `get_delegation_policy` | Returns the current delegation level + guidance for every level. |
| (`codex mcp-server` raw tools also exposed — `codex` and `codex-reply` — for the sub-60s synchronous fast path.) |

## Slash commands (8)

- `/codex-spawn <role> <prompt>` — launch an agent
- `/codex-status [agent_id]` — compact table of progress
- `/codex-resume <agent_id> <prompt>` — continue a terminal agent
- `/codex-cancel <agent_id> [--force]` — kill + optional worktree cleanup
- `/codex-merge <agent_id> [--strategy squash|ff|rebase]` — merge back
- `/codex-discard <agent_id>` — irreversible cleanup
- `/codex-review-pr <pr_number>` — spawn a dedicated reviewer against a PR
- `/codex-fan-out <EPIC-NNN>` — parallel implementer-per-child for a Linear epic (MF mode) or inline prompt list
- `/codex-mode [minimal|balance|max]` — view/set delegation level

## Subagents (3)

Native `Agent({subagent_type: "codex-implementer", ...})` dispatch:

- `codex-implementer` — autonomous worktree work, returns for diff review
- `codex-reviewer` — read-only dual-model review, returns raw Codex report
- `codex-planner` — plan-only output for comparison against Claude's planning

## Roles

Built-in TOML presets in `src/roles/defaults/`:

| Role | Model | Sandbox | Worktree | Timeout |
|---|---|---|---|---|
| `implementer` | `gpt-5.2-codex` | `workspace-write` | branch-per-agent | 30m |
| `reviewer` | `gpt-5.2` | `read-only` | PR-detached when `pr_number` given | 10m |
| `planner` | `gpt-5.2` | `read-only` | none | 15m |
| `generic` | `gpt-5.2` | `read-only` | none | 15m |

Override any field per-spawn via `overrides`, or at project/user scope in `codex-team.toml`.

## Magic Flow integration (auto-detected)

Auto-activated when the plugin finds `.magic-flow/` directory or `ops/workers.json` at repo root. When active:

- **Linear issue fetch** — if `LINEAR_API_KEY` is set and `issue_id` passed, the issue title + description + URL populate templater placeholders for richer Codex context.
- **MF branch naming** — `feature/TEAM-NNN-<slugified-title>` instead of the plain `codex/<suffix>` fallback.
- **Conventions injection** — plugin reads `~/.claude/CLAUDE.md`, extracts the "Magic Flow Workflow Conventions" section, and injects it into every Codex spawn's `developer_instructions` so the agent follows the same branch/commit/Linear rules Claude does.
- **workers.json mirror** — every status transition updates `ops/workers.json` with an MF-compatible worker entry, coexisting with other worker kinds (e.g. Cyrus). Picked up by `/mf-status` for free.

To opt out: simply remove `.magic-flow/` and `ops/workers.json`, or explicitly set `[mf] auto_detect = false` in `codex-team.toml` (future work — auto-detection is always on in 0.2.0).

## PR review flow (the killer feature)

```
/codex-review-pr 456
```

This spawns a Codex reviewer that:
1. Calls `gh pr view 456 --json headRefOid,headRefName,baseRefName,title,url`.
2. Creates a **detached** git worktree at the PR's head SHA under `.codex-team/worktrees/<agent_id>`.
3. Runs Codex with `sandbox: "read-only"` and `cwd` set to the detached worktree.
4. Injects PR context into `developer_instructions`: PR number, title, head SHA, base ref, URL.

The reviewer now has a real filesystem checkout of the PR — can grep, read tests, inspect context — not just a diff blob. Pair with Claude's own PR review (either the built-in review skill or `/mf-pr-reviewer` in MF projects) for a genuine two-model consensus.

## Polling pattern

`spawn` returns `status: "running"` immediately. Poll `status(agent_id)` every 15–30 seconds. The response includes `last_output_preview` (first 500 chars) inline; use `result(agent_id)` only when you need the full output.

For long-running fan-outs (10+ agents), prefer Claude Code's `schedule` skill to time-defer rechecks over tight polling loops.

## State

- `.codex-team/state.json` (gitignored) — durable registry of all agents, status, thread IDs, worktree info.
- `.codex-team/worktrees/` — per-agent worktrees. Preserved after completion until `/codex-merge` or `/codex-discard`.
- `ops/workers.json` (MF mode) — worker registry mirror using MF schema.

## Development

```bash
npm test                    # unit tests (62 passing)
npm run typecheck           # strict TS
npm run build               # compile + copy role defaults + plugin assets
./scripts/smoke-tools-list.sh   # verify MCP server starts and lists all 9 tools
```

## Architecture

Full design lives in [`docs/plans/2026-04-24-magic-cc-codex-worker-design.md`](docs/plans/2026-04-24-magic-cc-codex-worker-design.md).

Key design commitments:
- **Plugin bundles two MCP servers side-by-side**: raw `codex mcp-server` (sync fast path) + custom `codex-team` (async orchestration).
- **One `codex mcp-server` child per in-flight agent** — surgical cancel, failure isolation.
- **Async-by-default tools**: spawn/resume return <2s; background task drives Codex to completion; Claude polls via status.
- **Session continuity** via Codex's native `threadId` + `codex-reply`. No custom session protocol.
- **Magic Flow integration is loose-coupled** — detected, not depended-on. Plugin ships useful standalone.

## Roadmap

See [`CHANGELOG.md`](CHANGELOG.md) for the release history. 0.2.0 is the feature-complete walking plugin. Future releases (0.3+) may add:

- Progress streaming if `codex mcp-server` gains progress notifications.
- Worker merge-back to `ops/workers.json` lifecycle hooks (mf-on-pr-created, etc.).
- Dual-review auto-spawn (spawn Codex reviewer automatically on PR open via MF hooks).
- Additional role presets (`security-reviewer`, `perf-reviewer`, etc.).
- Web dashboard for agent observation.
