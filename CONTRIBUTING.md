# Contributing

Thanks for your interest in contributing.

## Development setup

```bash
git clone <your-fork>
cd magic-cc-codex-worker
npm install
npm test           # 62 unit tests, runs in ~3s
npm run typecheck  # strict TS
npm run build      # compile + copy role assets into dist/
```

## Ground rules

- **Tests are required.** Every new tool, lifecycle transition, or integration gets a unit test. Integration tests that hit real `codex` are gated behind `RUN_CODEX_INTEGRATION=1`.
- **Strict TypeScript.** No `any` without a comment explaining why.
- **No coupling to private services.** Magic Flow integration stays auto-detected; the plugin must work cleanly outside MF projects.
- **Small PRs.** One concern per PR. If you're adding a feature that touches the orchestrator, types, MCP surface, tests, and docs, that's fine in one PR — but a "fix-everything" PR is not.
- **Commit style:** `<type>(scope): <description>`. Examples: `feat(orchestrator): add X`, `fix(registry): handle Y`, `docs: update roadmap`.

## What's in scope

- New role presets (security-reviewer, perf-reviewer, etc.)
- New MCP tools that extend the lifecycle surface (e.g. `pause`, `snapshot`)
- Additional MF integration points (hooks, dashboards)
- Alternative worker integrations (Codex variants, local models)
- Better tests, especially integration tests

## What's out of scope

- Forks of the underlying Codex protocol — use upstream `codex mcp-server`.
- Hard dependencies on proprietary services beyond Codex itself.
- Features that require modifying Claude Code itself.

## Reporting issues

Open a GitHub issue with:
- What you tried (exact commands / tool inputs)
- What you expected
- What happened (stderr, state.json excerpt if relevant)
- Your `codex --version` and Node version

## Reviewing PRs

Maintainers look for: clear test coverage, strict types, docs updated if behavior visible to users, no secret-bearing files committed.

## Licensing of your contributions

By submitting a pull request you agree that your contribution will be distributed under the project's current license ([PolyForm Noncommercial 1.0.0](./LICENSE)). You retain copyright to your contribution; you grant the project maintainer a license broad enough to redistribute the combined work under the project license and any future dual / commercial license we may offer.

If you want to license your contribution differently, say so in the PR and we'll figure it out before merging.
