import type { AgentRole } from "../types.js";
import type { PartialRolePreset, RolePreset } from "./types.js";
export interface LoadRoleOptions {
    defaultsDir: string;
    userGlobalPath?: string;
    projectCommittedPath?: string;
    projectPersonalPath?: string;
    overrides?: PartialRolePreset;
}
export declare function loadRole(role: AgentRole, opts: LoadRoleOptions): Promise<RolePreset>;
