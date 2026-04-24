---
description: View or set the Codex delegation level (minimal/balance/max)
---

If `$ARGUMENTS` is empty, call `codex-team` MCP tool `get_delegation_policy` and show the current level, its source (env/project/user/default), and a one-line summary of each level.

If `$ARGUMENTS` is one of `minimal`, `balance`, `max`:
1. Write/update `codex-team.toml` at the repo root with `[delegation]\nlevel = "<value>"`.
2. Confirm the new level to the user.

This setting affects how aggressively you (Claude) should delegate work to Codex in subsequent turns.
