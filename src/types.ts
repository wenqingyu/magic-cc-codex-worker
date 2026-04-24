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

export interface AgentError {
  message: string;
  stderr_tail?: string;
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
}

export interface RegistrySnapshot {
  version: 1;
  agents: Record<string, AgentRecord>;
}
