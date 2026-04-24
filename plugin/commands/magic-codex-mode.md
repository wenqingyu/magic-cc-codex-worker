---
description: View or set the Codex delegation level (minimal/balance/max)
disable-model-invocation: true
---

If `$ARGUMENTS` is empty, call `magic-codex` MCP tool `get_delegation_policy` and show the current level, its source (env/project/user/default), and a one-line summary of each level.

If `$ARGUMENTS` is one of `minimal`, `balance`, `max`:
1. Write/update `magic-codex.toml` at the repo root with `[delegation]\nlevel = "<value>"`.
2. Confirm the new level to the user.

This setting affects how aggressively you (Claude) should delegate work to Codex in subsequent turns.
