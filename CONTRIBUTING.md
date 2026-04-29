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

## Cutting a release (maintainers)

We use one tag per release, an annotated GitHub Release for each, and the version literal duplicated in 5 files (the build's drift guard catches drift). A small script handles the tag + push + GitHub Release flow so you don't forget any step.

**Procedure:**

1. **On a feature branch:** bump the version in `package.json` and let the build's drift guard tell you the other 4 files to bump in lockstep:
   - `.claude-plugin/marketplace.json` (two version fields — `metadata.version` and `plugins[0].version`)
   - `plugin/.claude-plugin/plugin.json` ← **easy to forget; this is the file Claude Code's loader actually reads**
   - `src/index.ts` MCP banner
   - `src/mcp/codex-client.ts` MCP banner
2. **Add a CHANGELOG entry** with `## [X.Y.Z] — YYYY-MM-DD` heading and the relevant `### Added / ### Fixed / ### Changed / ### Internal` subsections.
3. **PR + merge to `main`** (the release script refuses to run from a feature branch).
4. **From a clean `main` checked out at the merge commit:**

   ```bash
   npm run release:dry-run   # show what would happen
   npm run release           # tag, push, create GitHub Release, mark latest
   ```

The script:
- Verifies you're on `main` and synced with origin
- Verifies the tag doesn't already exist on origin (refuses to clobber)
- Verifies the CHANGELOG has a section for the version in `package.json`
- Runs `npm run build` (drift guard validates all 5 version literals match)
- Runs `npm test`
- Creates an annotated tag, pushes it
- Creates the GitHub Release with the CHANGELOG section as the body, marks it `latest`

If `gh release create` fails because the release already exists for a tag, delete it first (`gh release delete vX.Y.Z`) — the script intentionally won't overwrite.

## Licensing of your contributions

By submitting a pull request you agree that your contribution will be distributed under the project's current license ([PolyForm Noncommercial 1.0.0](./LICENSE)). You retain copyright to your contribution; you grant the project maintainer a license broad enough to redistribute the combined work under the project license and any future dual / commercial license we may offer.

If you want to license your contribution differently, say so in the PR and we'll figure it out before merging.
