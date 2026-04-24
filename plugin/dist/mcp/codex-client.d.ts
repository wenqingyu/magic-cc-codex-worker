import type { ApprovalPolicy, SandboxMode } from "../types.js";
export interface CodexCallInput {
    prompt: string;
    cwd: string;
    model?: string;
    sandbox?: SandboxMode;
    approval_policy?: ApprovalPolicy;
    developer_instructions?: string;
    thread_id?: string;
}
export interface CodexCallResult {
    threadId: string;
    content: string;
    raw: unknown;
}
export interface CodexChildOptions {
    codexBin?: string;
}
export declare class CodexChild {
    private client;
    private transport;
    private readonly bin;
    constructor(opts?: CodexChildOptions);
    start(): Promise<void>;
    call(input: CodexCallInput): Promise<CodexCallResult>;
    stop(): Promise<void>;
    get pid(): number | null;
}
export declare function parseCodexResult(result: unknown): CodexCallResult;
