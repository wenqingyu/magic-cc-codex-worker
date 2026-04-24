import { describe, it, expect } from "vitest";
import { parseCodexResult } from "../../src/mcp/codex-client.js";

describe("parseCodexResult", () => {
  it("prefers structuredContent when present", () => {
    const r = parseCodexResult({
      structuredContent: { threadId: "t-1", content: "hello" },
      content: [{ type: "text", text: "fallback" }],
    });
    expect(r.threadId).toBe("t-1");
    expect(r.content).toBe("hello");
  });

  it("falls back to text content when structuredContent missing", () => {
    const r = parseCodexResult({
      content: [
        { type: "text", text: "line one" },
        { type: "text", text: "line two" },
      ],
    });
    expect(r.threadId).toBe("");
    expect(r.content).toBe("line one\nline two");
  });

  it("returns empty strings for completely empty result", () => {
    const r = parseCodexResult({});
    expect(r.threadId).toBe("");
    expect(r.content).toBe("");
  });

  it("ignores non-text content blocks", () => {
    const r = parseCodexResult({
      content: [
        { type: "image", data: "abc", mimeType: "png" },
        { type: "text", text: "hi" },
      ],
    });
    expect(r.content).toBe("hi");
  });
});
