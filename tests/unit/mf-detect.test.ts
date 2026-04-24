import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectMf } from "../../src/mf/detect.js";

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "mf-"));
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("detectMf", () => {
  it("not detected in bare repo", () => {
    const ctx = detectMf(repo);
    expect(ctx.detected).toBe(false);
  });

  it("detected when .magic-flow dir exists", () => {
    mkdirSync(join(repo, ".magic-flow"));
    const ctx = detectMf(repo);
    expect(ctx.detected).toBe(true);
    expect(ctx.has_magic_flow_dir).toBe(true);
  });

  it("detected when ops/workers.json exists", () => {
    mkdirSync(join(repo, "ops"));
    writeFileSync(join(repo, "ops", "workers.json"), "{}");
    const ctx = detectMf(repo);
    expect(ctx.detected).toBe(true);
    expect(ctx.has_workers_json).toBe(true);
  });
});
