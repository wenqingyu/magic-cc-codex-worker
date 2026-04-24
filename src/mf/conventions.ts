import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Extracts the "Magic Flow Workflow Conventions" section from the user's
 * ~/.claude/CLAUDE.md (if present) to inject into Codex developer_instructions
 * when running inside an MF project.
 */
export async function readMfConventions(customPath?: string): Promise<string> {
  const path = customPath ?? join(homedir(), ".claude", "CLAUDE.md");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return "";
  }
  return extractConventionsSection(raw);
}

export function extractConventionsSection(markdown: string): string {
  // Find the section header "## Magic Flow Workflow Conventions" (case-insensitive,
  // tolerant to extra whitespace) and return text up to the next ## heading.
  const lines = markdown.split("\n");
  const headerRe = /^##\s+Magic Flow Workflow Conventions\s*$/i;
  const sectionRe = /^##\s+/;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && headerRe.test(line)) {
      start = i;
      break;
    }
  }
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && sectionRe.test(line)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}
