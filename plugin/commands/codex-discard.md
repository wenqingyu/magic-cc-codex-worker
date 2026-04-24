---
description: Discard a terminal Codex agent's worktree and delete its branch
disable-model-invocation: true
---

Parse `$ARGUMENTS` as `<agent_id>`. Call `codex-team` MCP tool `discard`.

If the agent is still running, explain the user must `/codex-cancel` first. This action is irreversible; warn before proceeding on any agent whose work has not been reviewed.
