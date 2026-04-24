import type { AgentRecord, AgentRole, ApprovalPolicy, SandboxMode } from "./types.js";
export interface CreateInput {
    role: AgentRole;
    cwd: string;
    model: string;
    sandbox: SandboxMode;
    approval_policy: ApprovalPolicy;
    last_prompt: string;
    issue_id?: string | null;
    pr_number?: number | null;
}
export declare class Registry {
    private readonly stateDir;
    private state;
    private loaded;
    private writeLock;
    constructor(stateDir: string);
    private get stateFile();
    private load;
    private persist;
    private serialize;
    create(input: CreateInput): Promise<AgentRecord>;
    get(agent_id: string): Promise<AgentRecord | null>;
    update(agent_id: string, patch: Partial<AgentRecord>): Promise<AgentRecord>;
    list(): Promise<AgentRecord[]>;
}
