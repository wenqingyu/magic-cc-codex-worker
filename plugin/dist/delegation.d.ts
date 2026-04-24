import type { DelegationLevel } from "./types.js";
export declare const DELEGATION_LEVELS: DelegationLevel[];
export declare const DELEGATION_GUIDANCE: Record<DelegationLevel, string>;
export interface DelegationPolicy {
    level: DelegationLevel;
    guidance: string;
    all_levels: Array<{
        level: DelegationLevel;
        guidance: string;
    }>;
    source: "env" | "project" | "user" | "default";
}
export interface ResolvePolicyOptions {
    projectConfigPath?: string;
    userConfigPath?: string;
    envOverride?: string;
}
export declare function resolveDelegationPolicy(opts: ResolvePolicyOptions): Promise<DelegationPolicy>;
