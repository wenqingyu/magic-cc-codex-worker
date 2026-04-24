import { describe, it, expect } from "vitest";
import { extractConventionsSection } from "../../src/mf/conventions.js";

describe("extractConventionsSection", () => {
  it("returns the MF conventions section up to the next ## header", () => {
    const md = `# CLAUDE.md

Some preamble.

## Magic Flow Workflow Conventions

### Linear Conventions
- Every task traces to a Linear issue ID

### GitHub Conventions
- Never push to main

## Next Section

not included
`;
    const out = extractConventionsSection(md);
    expect(out).toContain("Magic Flow Workflow Conventions");
    expect(out).toContain("Linear Conventions");
    expect(out).not.toContain("Next Section");
    expect(out).not.toContain("not included");
  });

  it("returns empty when section absent", () => {
    expect(extractConventionsSection("# CLAUDE\n\nno section here")).toBe("");
  });

  it("returns all remaining lines when no trailing ## section", () => {
    const md = `# CLAUDE

## Magic Flow Workflow Conventions

content through EOF
`;
    expect(extractConventionsSection(md)).toContain("content through EOF");
  });
});
