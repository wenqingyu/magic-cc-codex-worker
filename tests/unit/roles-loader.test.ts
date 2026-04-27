import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadRole } from "../../src/roles/loader.js";

const defaultsDir = resolve(process.cwd(), "src", "roles", "defaults");

describe("loadRole — built-in defaults", () => {
  it("loads implementer role", async () => {
    const role = await loadRole("implementer", { defaultsDir });
    expect(role.model).toBeUndefined(); // inherits codex default unless overridden
    // 0.4.0: switched implementer default from workspace-write to
    // danger-full-access. Empirically workspace-write silently dropped
    // .git/worktrees/*.lock writes for ~15-20% of spawns even with the
    // writable_roots .git workaround. The agent is already isolated
    // to a throwaway worktree branch, so danger-full-access is the
    // smaller blast radius. Override via magic-codex.toml.
    expect(role.sandbox).toBe("danger-full-access");
    expect(role.worktree).toBe(true);
    expect(role.timeout_seconds).toBe(1800);
    expect(role.developer_instructions).toContain("isolated git worktree");
  });

  it("loads reviewer role with read-only sandbox", async () => {
    const role = await loadRole("reviewer", { defaultsDir });
    expect(role.sandbox).toBe("read-only");
    expect(role.worktree).toBe(false);
  });

  it("loads planner and generic roles", async () => {
    const planner = await loadRole("planner", { defaultsDir });
    const generic = await loadRole("generic", { defaultsDir });
    expect(planner.worktree).toBe(false);
    expect(generic.sandbox).toBe("read-only");
  });
});

describe("loadRole — precedence", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "roles-"));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("project committed overrides defaults; per-spawn overrides both", async () => {
    const projectFile = join(tmp, "magic-codex.toml");
    writeFileSync(
      projectFile,
      `
[roles.implementer]
model = "gpt-project-override"
timeout_seconds = 9999
`,
    );
    const role = await loadRole("implementer", {
      defaultsDir,
      projectCommittedPath: projectFile,
      overrides: { model: "gpt-spawn-override" },
    });
    expect(role.model).toBe("gpt-spawn-override");
    expect(role.timeout_seconds).toBe(9999);
    expect(role.sandbox).toBe("danger-full-access");
    expect(role.developer_instructions).toContain("worktree");
  });

  it("ignores missing config files silently", async () => {
    const role = await loadRole("implementer", {
      defaultsDir,
      projectCommittedPath: join(tmp, "nonexistent.toml"),
      userGlobalPath: join(tmp, "also-missing.toml"),
    });
    expect(role.model).toBeUndefined();
  });
});
