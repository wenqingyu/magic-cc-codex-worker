import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/roles/templater.js";

describe("renderTemplate", () => {
  it("substitutes known placeholders", () => {
    const out = renderTemplate("Branch {{branch}} at {{worktree_path}}", {
      branch: "codex/abc",
      worktree_path: "/tmp/w",
    });
    expect(out).toBe("Branch codex/abc at /tmp/w");
  });

  it("leaves unknown placeholders as literals", () => {
    const out = renderTemplate("Hello {{unknown}}", {});
    expect(out).toBe("Hello {{unknown}}");
  });

  it("substitutes multiple occurrences", () => {
    const out = renderTemplate("{{a}}/{{a}}", { a: "x" });
    expect(out).toBe("x/x");
  });

  it("handles numeric values", () => {
    const out = renderTemplate("pr #{{pr_number}}", { pr_number: 42 });
    expect(out).toBe("pr #42");
  });

  it("tolerates whitespace inside braces", () => {
    const out = renderTemplate("hi {{ name }}", { name: "bob" });
    expect(out).toBe("hi bob");
  });
});
