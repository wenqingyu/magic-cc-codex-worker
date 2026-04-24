import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
export class CodexChild {
    client = null;
    transport = null;
    bin;
    constructor(opts = {}) {
        this.bin = opts.codexBin ?? "codex";
    }
    async start() {
        this.transport = new StdioClientTransport({
            command: this.bin,
            args: ["mcp-server"],
            stderr: "pipe",
        });
        this.client = new Client({ name: "magic-codex", version: "0.3.0" }, { capabilities: {} });
        await this.client.connect(this.transport);
    }
    async call(input) {
        if (!this.client)
            throw new Error("CodexChild.start() not called");
        const toolName = input.thread_id ? "codex-reply" : "codex";
        const args = input.thread_id
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
            };
        const result = await this.client.callTool({ name: toolName, arguments: args });
        return parseCodexResult(result);
    }
    async stop() {
        try {
            await this.client?.close();
        }
        catch {
            // ignore close errors
        }
        this.client = null;
        this.transport = null;
    }
    get pid() {
        return this.transport?.pid ?? null;
    }
}
export function parseCodexResult(result) {
    const r = result;
    const structured = r.structuredContent;
    if (structured &&
        typeof structured.threadId === "string" &&
        typeof structured.content === "string") {
        return {
            threadId: structured.threadId,
            content: structured.content,
            raw: result,
        };
    }
    const blocks = Array.isArray(r.content) ? r.content : [];
    const text = blocks
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("\n");
    return { threadId: "", content: text, raw: result };
}
//# sourceMappingURL=codex-client.js.map