import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";
import { Registry } from "../../src/registry.js";
import { Worktrees } from "../../src/worktree.js";
import { Orchestrator } from "../../src/orchestrator.js";
import { detectMf } from "../../src/mf/detect.js";
import { LinearClient } from "../../src/mf/linear.js";
import { WorkersMirror } from "../../src/mf/workers.js";
import type { CodexChild } from "../../src/mcp/codex-client.js";

const rolesDir = resolve(process.cwd(), "src", "roles", "defaults");

describe("Orchestrator — Magic Flow integration", () => {
  let stateDir: string;
  let repo: string;
  let registry: Registry;
  let worktrees: Worktrees;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), "orch-mf-state-"));
    repo = mkdtempSync(join(tmpdir(), "orch-mf-repo-"));
    await execa("git", ["-C", repo, "init", "-q", "-b", "main"]);
    await execa("git", ["-C", repo, "config", "user.email", "t@t"]);
    await execa("git", ["-C", repo, "config", "user.name", "t"]);
    await execa("git", ["-C", repo, "commit", "--allow-empty", "-m", "init"]);
    // Mark as an MF project with ops/workers.json
    mkdirSync(join(repo, "ops"));
    writeFileSync(join(repo, "ops", "workers.json"), JSON.stringify({ version: 1, workers: {} }));
    registry = new Registry(stateDir);
    worktrees = new Worktrees(repo);
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  function okCodexFactory() {
    return () =>
      ({
        start: vi.fn().mockResolvedValue(undefined),
        call: vi.fn().mockResolvedValue({ threadId: "thread-1", content: "done", raw: {} }),
        stop: vi.fn().mockResolvedValue(undefined),
        get pid() {
          return 1;
        },
      }) as unknown as CodexChild;
  }

  it("uses feature/TEAM-NNN-slug branch naming when issue_id is given and MF detected", async () => {
    // Linear returns a title we'll slugify
    const fakeLinear = {
      isConfigured: true,
      getIssue: vi.fn().mockResolvedValue({
        id: "x",
        identifier: "TEAM-42",
        title: "Add rate limiting to upload",
        description: null,
        url: "https://linear.app/x/TEAM-42",
        state: { name: "In Progress" },
      }),
    } as unknown as LinearClient;

    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: okCodexFactory(),
      rolesDir,
      repoRoot: repo,
      mf: detectMf(repo),
      linear: fakeLinear,
      workersMirror: new WorkersMirror(repo),
    });

    const res = await orch.spawn({
      role: "implementer",
      prompt: "impl",
      issue_id: "TEAM-42",
    });
    await orch.waitForAgent(res.agent_id);
    const rec = await registry.get(res.agent_id);
    expect(rec!.worktree?.branch).toBe("feature/TEAM-42-add-rate-limiting-to-upload");
  });

  it("falls back to codex/<suffix> branch naming when MF not detected", async () => {
    // Remove the MF markers
    rmSync(join(repo, "ops"), { recursive: true, force: true });
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: okCodexFactory(),
      rolesDir,
      repoRoot: repo,
      mf: detectMf(repo), // now not-detected
    });
    const res = await orch.spawn({ role: "implementer", prompt: "p", issue_id: "TEAM-42" });
    await orch.waitForAgent(res.agent_id);
    const rec = await registry.get(res.agent_id);
    expect(rec!.worktree?.branch).toMatch(/^codex\/impl-/);
  });

  it("mirrors agent lifecycle to ops/workers.json on running and completed", async () => {
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: okCodexFactory(),
      rolesDir,
      repoRoot: repo,
      mf: detectMf(repo),
      workersMirror: new WorkersMirror(repo),
    });
    const res = await orch.spawn({ role: "reviewer", prompt: "r" });
    await orch.waitForAgent(res.agent_id);
    const workersFile = join(repo, "ops", "workers.json");
    expect(existsSync(workersFile)).toBe(true);
    const parsed = JSON.parse(readFileSync(workersFile, "utf8"));
    const key = `magic-codex:${res.agent_id}`;
    expect(parsed.workers[key]).toBeDefined();
    expect(parsed.workers[key].status).toBe("completed");
    expect(parsed.workers[key].kind).toBe("magic-codex");
  });

  it("injects mfConventions into developer_instructions when present", async () => {
    const seen: { instr?: string } = {};
    const factory = () =>
      ({
        start: vi.fn().mockResolvedValue(undefined),
        call: vi.fn().mockImplementation(async (input: { developer_instructions?: string }) => {
          seen.instr = input.developer_instructions;
          return { threadId: "t", content: "ok", raw: {} };
        }),
        stop: vi.fn().mockResolvedValue(undefined),
        get pid() {
          return 1;
        },
      }) as unknown as CodexChild;
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: factory,
      rolesDir,
      repoRoot: repo,
      mf: detectMf(repo),
      mfConventions:
        "## Magic Flow Workflow Conventions\n\n- Always branch feature/TEAM-xxx\n- Conventional commits",
    });
    const res = await orch.spawn({ role: "implementer", prompt: "do" });
    await orch.waitForAgent(res.agent_id);
    expect(seen.instr).toContain("Magic Flow Workflow Conventions");
    expect(seen.instr).toContain("Conventional commits");
  });
});
