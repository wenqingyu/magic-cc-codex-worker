import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDelegationPolicy } from "../../src/delegation.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "deleg-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("resolveDelegationPolicy", () => {
  it("defaults to balance when nothing set", async () => {
    const p = await resolveDelegationPolicy({});
    expect(p.level).toBe("balance");
    expect(p.source).toBe("default");
    expect(p.guidance.toLowerCase()).toContain("balanc");
    expect(p.all_levels).toHaveLength(3);
  });

  it("env override wins over everything", async () => {
    const projectFile = join(tmp, "magic-codex.toml");
    writeFileSync(projectFile, `[delegation]\nlevel = "minimal"\n`);
    const p = await resolveDelegationPolicy({
      projectConfigPath: projectFile,
      envOverride: "max",
    });
    expect(p.level).toBe("max");
    expect(p.source).toBe("env");
  });

  it("project config wins over user config", async () => {
    const project = join(tmp, "project.toml");
    const user = join(tmp, "user.toml");
    writeFileSync(project, `[delegation]\nlevel = "max"\n`);
    writeFileSync(user, `[delegation]\nlevel = "minimal"\n`);
    const p = await resolveDelegationPolicy({
      projectConfigPath: project,
      userConfigPath: user,
    });
    expect(p.level).toBe("max");
    expect(p.source).toBe("project");
  });

  it("user config used when project missing", async () => {
    const user = join(tmp, "user.toml");
    writeFileSync(user, `[delegation]\nlevel = "minimal"\n`);
    const p = await resolveDelegationPolicy({
      projectConfigPath: join(tmp, "nope.toml"),
      userConfigPath: user,
    });
    expect(p.level).toBe("minimal");
    expect(p.source).toBe("user");
  });

  it("invalid env value falls through to default", async () => {
    const p = await resolveDelegationPolicy({ envOverride: "bogus" });
    expect(p.level).toBe("balance");
    expect(p.source).toBe("default");
  });

  it("guidance differs meaningfully per level", async () => {
    const minP = await resolveDelegationPolicy({ envOverride: "minimal" });
    const balP = await resolveDelegationPolicy({ envOverride: "balance" });
    const maxP = await resolveDelegationPolicy({ envOverride: "max" });
    expect(minP.guidance).not.toEqual(balP.guidance);
    expect(balP.guidance).not.toEqual(maxP.guidance);
    expect(maxP.guidance).toMatch(/orchestrator/);
  });
});
