import type { AgentRecord } from "../types.js";
/**
 * Mirrors codex-team agents into ops/workers.json using a schema compatible
 * with Magic Flow's worker registry. MF's dispatcher and /mf-status read this.
 */
export interface WorkerEntry {
    worker_id: string;
    kind: "codex-team";
    agent_id: string;
    role: string;
    status: string;
    issue_id: string | null;
    pr_number: number | null;
    branch: string | null;
    worktree_path: string | null;
    thread_id: string | null;
    created_at: string;
    started_at: string | null;
    ended_at: string | null;
}
export interface WorkersFile {
    version: 1;
    workers: Record<string, WorkerEntry>;
}
export declare class WorkersMirror {
    private readonly repoRoot;
    constructor(repoRoot: string);
    private get file();
    private load;
    private persist;
    upsertFromRecord(rec: AgentRecord): Promise<void>;
    remove(agent_id: string): Promise<void>;
}
