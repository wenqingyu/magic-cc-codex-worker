import type { Registry } from "./registry.js";
import type { Worktrees } from "./worktree.js";
import type { AgentRecord, AgentRole, ApprovalPolicy, SandboxMode } from "./types.js";
import type { CodexChild } from "./mcp/codex-client.js";
import type { MfContext } from "./mf/detect.js";
import type { LinearClient } from "./mf/linear.js";
import type { WorkersMirror } from "./mf/workers.js";
import type { GhClient } from "./mf/github.js";
export interface SpawnOverrides {
    model?: string;
    sandbox?: SandboxMode;
    approval_policy?: ApprovalPolicy;
    timeout_seconds?: number;
    developer_instructions_append?: string;
    developer_instructions_replace?: string;
}
export interface SpawnInput {
    role: AgentRole;
    prompt: string;
    issue_id?: string | null;
    pr_number?: number | null;
    base_ref?: string;
    overrides?: SpawnOverrides;
}
export interface SpawnResult {
    agent_id: string;
    status: AgentRecord["status"];
    worktree_path: string | null;
    role: AgentRole;
}
export interface ResumeInput {
    agent_id: string;
    prompt: string;
    overrides?: Pick<SpawnOverrides, "timeout_seconds">;
}
export interface ResumeResult {
    agent_id: string;
    status: AgentRecord["status"];
    role: AgentRole;
}
export interface CancelInput {
    agent_id: string;
    force?: boolean;
}
export interface CancelResult {
    agent_id: string;
    status: AgentRecord["status"];
    worktree_removed: boolean;
}
export interface MergeInput {
    agent_id: string;
    strategy?: "squash" | "ff" | "rebase";
    message?: string;
    keep_worktree?: boolean;
}
export interface MergeResult {
    agent_id: string;
    merged_into: string;
    sha: string;
    worktree_removed: boolean;
}
export interface DiscardInput {
    agent_id: string;
}
export interface DiscardResult {
    agent_id: string;
    worktree_removed: boolean;
    branch_deleted: boolean;
}
export interface OrchestratorOptions {
    registry: Registry;
    worktrees: Worktrees;
    codexFactory: () => CodexChild;
    rolesDir: string;
    repoRoot: string;
    projectCommittedRolesPath?: string;
    userGlobalRolesPath?: string;
    mf?: MfContext;
    linear?: LinearClient;
    workersMirror?: WorkersMirror;
    gh?: GhClient;
    /** Magic Flow conventions text to inject into developer_instructions. */
    mfConventions?: string;
}
export declare class Orchestrator {
    private readonly opts;
    private readonly tasks;
    private readonly active;
    constructor(opts: OrchestratorOptions);
    spawn(input: SpawnInput): Promise<SpawnResult>;
    private makeBranchName;
    private mirrorWorker;
    resume(input: ResumeInput): Promise<ResumeResult>;
    cancel(input: CancelInput): Promise<CancelResult>;
    merge(input: MergeInput): Promise<MergeResult>;
    discard(input: DiscardInput): Promise<DiscardResult>;
    waitForAgent(agent_id: string): Promise<void>;
    private buildInstructions;
    private launchBackground;
}
