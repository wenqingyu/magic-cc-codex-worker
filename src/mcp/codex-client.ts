import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ApprovalPolicy, SandboxMode } from "../types.js";

export interface CodexCallInput {
  prompt: string;
  cwd: string;
  model?: string;
  sandbox?: SandboxMode;
  approval_policy?: ApprovalPolicy;
  developer_instructions?: string;
  thread_id?: string;
  /** Extra absolute paths writable under a `workspace-write` sandbox.
   *  Mapped to `config.sandbox_workspace_write.writable_roots` on the
   *  codex MCP `codex` tool. The default spawn wires this to the main
   *  repo's `.git` directory so git commands inside a worktree can
   *  write to the shared object DB / refs / per-worktree metadata. */
  writable_roots?: string[];
}

export interface CodexCallResult {
  threadId: string;
  content: string;
  raw: unknown;
}

export interface CodexChildOptions {
  codexBin?: string;
}

export class CodexChild {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private readonly bin: string;

  constructor(opts: CodexChildOptions = {}) {
    this.bin = opts.codexBin ?? "codex";
  }

  async start(): Promise<void> {
    this.transport = new StdioClientTransport({
      command: this.bin,
      args: ["mcp-server"],
      stderr: "pipe",
    });
    this.client = new Client(
      { name: "magic-codex", version: "0.3.7" },
      { capabilities: {} },
    );
    await this.client.connect(this.transport);
  }

  /**
   * Dispatch a codex tool call.
   *
   * @param input  The arguments for the codex / codex-reply tool.
   * @param timeoutMs  Per-call timeout in milliseconds. Passed to the MCP
   *   SDK's `options.timeout`. Required for any call expected to exceed
   *   the SDK's built-in 60s default (which fires as `-32001: Request
   *   timed out` — independent of any caller-side wrapper).
   *   `resetTimeoutOnProgress` is enabled so long-running codex runs
   *   that emit progress notifications don't expire mid-stream.
   */
  async call(input: CodexCallInput, timeoutMs?: number): Promise<CodexCallResult> {
    if (!this.client) throw new Error("CodexChild.start() not called");
    const toolName = input.thread_id ? "codex-reply" : "codex";
    const args: Record<string, unknown> = input.thread_id
      ? { threadId: input.thread_id, prompt: input.prompt }
      : {
          prompt: input.prompt,
          cwd: input.cwd,
          ...(input.model ? { model: input.model } : {}),
          ...(input.sandbox ? { sandbox: input.sandbox } : {}),
          ...(input.approval_policy ? { "approval-policy": input.approval_policy } : {}),
          ...(input.developer_instructions
            ? { "developer-instructions": input.developer_instructions }
            : {}),
          ...(input.writable_roots && input.writable_roots.length > 0
            ? {
                config: {
                  sandbox_workspace_write: {
                    writable_roots: input.writable_roots,
                  },
                },
              }
            : {}),
        };
    const result = await this.client.callTool(
      { name: toolName, arguments: args },
      undefined,
      timeoutMs && timeoutMs > 0
        ? { timeout: timeoutMs, resetTimeoutOnProgress: true }
        : undefined,
    );
    return parseCodexResult(result);
  }

  async stop(): Promise<void> {
    try {
      await this.client?.close();
    } catch {
      // ignore close errors
    }
    this.client = null;
    this.transport = null;
  }

  get pid(): number | null {
    return this.transport?.pid ?? null;
  }
}

export function parseCodexResult(result: unknown): CodexCallResult {
  const r = result as {
    structuredContent?: { threadId?: unknown; content?: unknown };
    content?: Array<{ type: string; text?: string }>;
  };
  const structured = r.structuredContent;
  if (
    structured &&
    typeof structured.threadId === "string" &&
    typeof structured.content === "string"
  ) {
    return {
      threadId: structured.threadId,
      content: structured.content,
      raw: result,
    };
  }
  const blocks = Array.isArray(r.content) ? r.content : [];
  const text = blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
  return { threadId: "", content: text, raw: result };
}
