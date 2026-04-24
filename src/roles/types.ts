import type { ApprovalPolicy, SandboxMode } from "../types.js";

export interface RolePreset {
  model?: string;
  sandbox: SandboxMode;
  approval_policy: ApprovalPolicy;
  worktree: boolean;
  timeout_seconds: number;
  developer_instructions: string;
}

export type PartialRolePreset = Partial<RolePreset>;
