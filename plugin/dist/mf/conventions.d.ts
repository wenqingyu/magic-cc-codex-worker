/**
 * Extracts the "Magic Flow Workflow Conventions" section from the user's
 * ~/.claude/CLAUDE.md (if present) to inject into Codex developer_instructions
 * when running inside an MF project.
 */
export declare function readMfConventions(customPath?: string): Promise<string>;
export declare function extractConventionsSection(markdown: string): string;
