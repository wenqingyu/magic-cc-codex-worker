import { describe, it, expect } from "vitest";
import { classifyError } from "../../src/classify-error.js";

describe("classifyError", () => {
  describe("rate_limited", () => {
    it("matches 'rate limit' in message", () => {
      expect(classifyError("rate limit exceeded", "")).toBe("rate_limited");
    });
    it("matches 'rate-limited' spelling", () => {
      expect(classifyError("", "request was rate-limited")).toBe("rate_limited");
    });
    it("matches 'daily message limit'", () => {
      expect(classifyError("", "You have reached your daily message limit.")).toBe(
        "rate_limited",
      );
    });
    it("matches 'usage limit'", () => {
      expect(classifyError("", "usage limit hit for today")).toBe("rate_limited");
    });
    it("matches 'quota exceeded'", () => {
      expect(classifyError("", "API quota exceeded")).toBe("rate_limited");
    });
    it("matches 'too many requests'", () => {
      expect(classifyError("Too Many Requests", "")).toBe("rate_limited");
    });
    it("matches 429 with context", () => {
      expect(classifyError("", "HTTP 429 too many requests")).toBe("rate_limited");
    });
    it("matches 'you've hit your limit' variants", () => {
      expect(classifyError("", "You've hit your usage limit for today")).toBe(
        "rate_limited",
      );
    });
    it("searches stderr tail, not just message", () => {
      const stderr = "some unrelated chatter\n2026-04-25 ERROR: rate limit exceeded\n";
      expect(classifyError("tool call failed", stderr)).toBe("rate_limited");
    });
  });

  describe("sandbox_denied", () => {
    it("matches 'sandbox denied'", () => {
      expect(classifyError("", "sandbox: write denied at /foo/bar")).toBe(
        "sandbox_denied",
      );
    });
    it("matches 'sandbox blocked'", () => {
      expect(classifyError("", "sandbox blocked write")).toBe("sandbox_denied");
    });
    it("matches 'operation not permitted' on .git paths", () => {
      expect(
        classifyError("", "open: operation not permitted at /repo/.git/HEAD.lock"),
      ).toBe("sandbox_denied");
    });
  });

  describe("timeout", () => {
    it("matches our withTimeout wrapper message", () => {
      expect(classifyError("timeout after 1800s", "")).toBe("timeout");
    });
    it("matches the MCP SDK timeout code", () => {
      expect(classifyError("MCP error -32001: Request timed out", "")).toBe(
        "timeout",
      );
    });
    it("matches plain 'request timed out'", () => {
      expect(classifyError("", "the request timed out after 60s")).toBe("timeout");
    });
  });

  describe("no match", () => {
    it("returns null for generic errors", () => {
      expect(classifyError("unexpected EOF", "")).toBe(null);
    });
    it("returns null for empty inputs", () => {
      expect(classifyError("", "")).toBe(null);
    });
    it("does not false-positive on unrelated 429 mentions", () => {
      // Bare number without context — avoid false positive.
      expect(classifyError("", "saw status code 429")).toBe(null);
    });
    it("does not false-positive on the word 'limit' alone", () => {
      expect(classifyError("hit the array limit", "")).toBe(null);
    });
  });
});
