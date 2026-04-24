import type { WorktreeInfo } from "./types.js";
export interface CreateWorktreeInput {
    agent_id: string;
    branch: string;
    base_ref: string;
    parent_dir?: string;
}
export interface CreateDetachedWorktreeInput {
    agent_id: string;
    ref: string;
    parent_dir?: string;
}
export declare class Worktrees {
    private readonly repoRoot;
    constructor(repoRoot: string);
    private defaultParent;
    create(input: CreateWorktreeInput): Promise<WorktreeInfo>;
    createDetached(input: CreateDetachedWorktreeInput): Promise<WorktreeInfo>;
    merge(opts: {
        branch: string;
        base_ref: string;
        strategy?: "squash" | "ff" | "rebase";
        message?: string;
    }): Promise<{
        sha: string;
    }>;
    remove(path: string, opts?: {
        delete_branch?: boolean;
    }): Promise<void>;
}
