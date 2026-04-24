# magic-cc-codex-worker

> A **Magic Stack** plugin that turns [Codex](https://github.com/openai/codex) into a pool of Claude Code agent workers — spawn, track, resume, and specialize Codex sessions from inside Claude Code.

**Status:** walking skeleton (0.0.1). `spawn` → `status` → `result` works end-to-end against real `codex mcp-server`. `resume`, `cancel`, `merge`, slash commands, subagents, and Magic Flow integration ship in follow-up releases — see [design doc](docs/plans/2026-04-24-magic-cc-codex-worker-design.md) for the full roadmap.

## Why

Claude Code is excellent at orchestration, synthesis, and interactive work. Codex is excellent at long-running autonomous implementation and brings a different model stack (GPT) that's valuable for second-opinion reviews. This plugin lets Claude *delegate* work to Codex workers — running in isolated git worktrees, in parallel, with resumable sessions — so the two models complement each other instead of competing for the same context window.

## Prerequisites

- `codex` CLI installed and authenticated (verified with `codex-cli 0.122.0+`)
- Node.js 20+
- Git 2.40+
- Claude Code configured

Verify Codex is ready:

```bash
codex --version
codex mcp-server --help   # the underlying protocol server this plugin talks to
```

## Install

```bash
git clone <repo-url> magic-cc-codex-worker
cd magic-cc-codex-worker
npm install
npm run build
```

Register with Claude Code by pointing at the plugin root (exact registration command depends on your Claude Code version — see [`.claude/mcp-servers.json`](.claude/mcp-servers.json) for the MCP server definitions this plugin ships).

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

Claude discovers the current policy by calling the `get_delegation_policy` MCP tool at session start.

## MCP tools

| Tool | Purpose |
|---|---|
| `spawn` | Launch a Codex agent in the background. Returns immediately with `agent_id`. |
| `status` | Per-agent or all-agents state snapshot + summary counts. |
| `result` | Full `last_output` of a terminal-state agent. |
| `get_delegation_policy` | Returns the current delegation level + guidance for every level. |

### Example: spawn a reviewer

```json
{
  "role": "reviewer",
  "prompt": "Review the diff between HEAD and main for correctness, security, and test coverage.",
  "overrides": { "model": "gpt-5.2", "timeout_seconds": 600 }
}
```

### Example: spawn an implementer in an isolated worktree

```json
{
  "role": "implementer",
  "prompt": "Add rate limiting to /api/upload. Commit when tests pass.",
  "base_ref": "main"
}
```

The plugin creates a worktree at `.codex-team/worktrees/<agent_id>` on a new branch (`codex/<suffix>`), launches Codex there with `sandbox=workspace-write`, and polling returns when the agent finishes.

## Roles

Built-in presets in `src/roles/defaults/*.toml`:

| Role | Model | Sandbox | Worktree | Timeout |
|---|---|---|---|---|
| `implementer` | `gpt-5.2-codex` | `workspace-write` | yes | 30m |
| `reviewer` | `gpt-5.2` | `read-only` | no | 10m |
| `planner` | `gpt-5.2` | `read-only` | no | 15m |
| `generic` | `gpt-5.2` | `read-only` | no | 15m |

Override any field per-spawn via the `overrides` argument, or at project/user scope in `codex-team.toml`:

```toml
[roles.implementer]
model = "gpt-5.2-codex"     # force this model
timeout_seconds = 3600      # allow longer runs

[delegation]
level = "balance"
```

## Polling pattern

`spawn` returns `status: "running"` immediately. Poll via `status(agent_id)` every 15-30 seconds. The `status` response includes `last_output_preview` (first 500 chars) inline. Use `result(agent_id)` only when you need the full output.

Long-running fan-outs (10+ agents): prefer scheduling recheck via Claude Code's built-in `schedule` skill over tight polling loops.

## State

- `.codex-team/state.json` (gitignored) — durable registry of all agents, status, thread IDs, worktree info.
- `.codex-team/worktrees/` — per-agent worktrees. Preserved after completion until you merge or discard them (future release).

## Development

```bash
npm test                    # unit tests
npm run typecheck           # strict TS
npm run build               # compile + copy role defaults
./scripts/smoke-tools-list.sh   # verify MCP server starts and lists its tools
```

Running a real Codex integration test (requires Codex auth):

```bash
RUN_CODEX_INTEGRATION=1 npm test
```

## Roadmap

Full design and follow-up plans live in [`docs/plans/`](docs/plans/):

1. ✅ Walking skeleton (this release): spawn, status, result, delegation policy
2. Resume + cancel + list
3. Merge + discard + slash commands + subagent definitions
4. Magic Flow integration (Linear, branch conventions, workers.json, hooks)
5. Dual-model PR review + epic fan-out (the high-value MF features)

## Design

See [`docs/plans/2026-04-24-magic-cc-codex-worker-design.md`](docs/plans/2026-04-24-magic-cc-codex-worker-design.md) for the full architecture.
