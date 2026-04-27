export type AgentStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type AgentRole = "implementer" | "reviewer" | "planner" | "generic";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";
export type DelegationLevel = "minimal" | "balance" | "max";

export interface WorktreeInfo {
  path: string;
  branch: string;
  base_ref: string;
  created_at: string;
}

/** Coarse classification of a failed agent. Used by supervisors to
 *  decide whether to retry, fall back to a different backend, or give
 *  up. `null`/unset means the failure didn't match any known pattern.
 *  `zombie` is set by the registry on startup for agents that were
 *  marked `running` in a previous server process and are now orphaned. */
export type AgentErrorKind =
  | "rate_limited"
  | "timeout"
  | "sandbox_denied"
  | "zombie";

export interface AgentError {
  message: string;
  stderr_tail?: string;
  kind?: AgentErrorKind | null;
  /** When `kind === "rate_limited"` and codex/ChatGPT supplied a refill
   *  time, the absolute clock at which it's safe to retry. ISO 8601 in
   *  UTC. Callers should add a small buffer (~5 min) to absorb clock
   *  skew and quota grace. Unset when no time was extractable. */
  retry_at?: string;
  /** When `kind === "rate_limited"`, seconds from `ended_at` until it's
   *  safe to retry. Unset when no time was extractable. */
  retry_after_seconds?: number;
}

/** Captured post-completion for `implementer` and other worktree-bearing
 *  agents. Surfaces the structured result of the run separately from
 *  `last_output` (prose), which is truncated to 500 chars in summaries. */
export interface AgentDelta {
  /** SHA at HEAD of the worktree branch when the agent finished. */
  commit_sha: string | null;
  /** Branch name (mirrors `worktree.branch`; duplicated for ergonomic
   *  access from `result()` callers). */
  branch: string | null;
  /** Output of `git diff --stat <base_ref>..HEAD` from inside the
   *  worktree. Trimmed to 4KB. */
  diff_stat: string | null;
  /** Number of commits ahead of base_ref. */
  commits_ahead: number | null;
}

export interface AgentRecord {
  agent_id: string;
  role: AgentRole;
  thread_id: string | null;
  status: AgentStatus;
  cwd: string;
  worktree: WorktreeInfo | null;
  model: string;
  sandbox: SandboxMode;
  approval_policy: ApprovalPolicy;
  issue_id: string | null;
  pr_number: number | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  last_prompt: string;
  last_output: string | null;
  error: AgentError | null;
  pid: number | null;
  /** Absolute path to the per-agent codex stderr log (sandbox denials,
   *  startup errors, rate-limit messages). Populated on spawn; absent
   *  on older records. */
  stderr_log?: string | null;
  /** Absolute path to the git repo root the agent operates against. Set
   *  at spawn time from `input.repo_root` (or the orchestrator's default).
   *  Persisted so downstream ops (`merge`, `discard`, `cancel --force`)
   *  can target the correct repo in multi-repo workspaces — without
   *  this, those ops ran git in the orchestrator's launch cwd. Absent
   *  on records created before 0.4.0. */
  repo_root?: string | null;
  /** Structured run output captured after completion — branch, commit
   *  SHA, diff stat. Populated for worktree-bearing roles whose runs
   *  finish in `completed`. Absent on older records, on roles without
   *  worktrees, and on failed/cancelled runs. */
  delta?: AgentDelta | null;
}

export interface RegistrySnapshot {
  version: 1;
  agents: Record<string, AgentRecord>;
}
