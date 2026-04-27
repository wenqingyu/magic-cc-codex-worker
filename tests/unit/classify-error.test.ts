import { describe, it, expect } from "vitest";
import { classifyError, classifyErrorDetailed } from "../../src/classify-error.js";

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

describe("classifyErrorDetailed — retry hint extraction", () => {
  // Fixed clock so the "tomorrow rollover" test is deterministic.
  const now = new Date("2026-04-27T15:00:00.000Z"); // 15:00 UTC

  it("parses 'try again in 600 seconds'", () => {
    const c = classifyErrorDetailed(
      "rate limit exceeded, try again in 600 seconds",
      "",
      now,
    );
    expect(c.kind).toBe("rate_limited");
    expect(c.retry_after_seconds).toBe(600);
    expect(c.retry_at).toBe("2026-04-27T15:10:00.000Z");
  });

  it("parses 'try again at HH:MM' as local time, future today", () => {
    // System TZ-dependent: target hour interpreted as host local.
    // We don't assert exact UTC; we assert that retry_after_seconds
    // is positive and < 24h.
    const c = classifyErrorDetailed(
      "you've hit your usage limit. try again at 23:30.",
      "",
      now,
    );
    expect(c.kind).toBe("rate_limited");
    expect(c.retry_after_seconds).toBeGreaterThan(0);
    expect(c.retry_after_seconds).toBeLessThanOrEqual(24 * 3600);
    expect(c.retry_at).toMatch(/^2026-04-(27|28)T/);
  });

  it("parses 'available again at 9:05 am' (12-hour with am/pm)", () => {
    const c = classifyErrorDetailed(
      "rate-limited; available again at 9:05 am",
      "",
      now,
    );
    expect(c.kind).toBe("rate_limited");
    expect(c.retry_after_seconds).toBeGreaterThan(0);
  });

  it("rolls clock-time hint to tomorrow when target is in the past", () => {
    // Pick a time that is definitely already past in any TZ.
    const c = classifyErrorDetailed(
      "rate limit. try again at 0:01",
      "",
      new Date("2026-04-27T23:59:00.000Z"),
    );
    expect(c.kind).toBe("rate_limited");
    expect(c.retry_after_seconds).toBeGreaterThan(0);
  });

  it("returns rate_limited without retry hint when no time text present", () => {
    const c = classifyErrorDetailed("HTTP 429 too many requests", "", now);
    expect(c.kind).toBe("rate_limited");
    expect(c.retry_at).toBeUndefined();
    expect(c.retry_after_seconds).toBeUndefined();
  });

  it("returns null kind unaffected", () => {
    const c = classifyErrorDetailed("unexpected EOF", "", now);
    expect(c.kind).toBeNull();
    expect(c.retry_at).toBeUndefined();
  });
});
