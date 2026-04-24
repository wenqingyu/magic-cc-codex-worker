import type { AgentErrorKind } from "./types.js";

/**
 * Classify a failed codex call into a coarse category supervisors can
 * branch on. Matches on the thrown error message *and* the tail of the
 * codex child's stderr — rate-limit errors in particular surface as
 * plain text in stderr with varying MCP-layer wrappings, so looking at
 * both sources widens the match without making patterns fragile.
 *
 * Returns `null` when nothing matches. The caller attaches the result
 * to `error.kind`; nothing downstream treats `null` differently from an
 * unset field.
 */
export function classifyError(
  message: string,
  stderrTail: string,
): AgentErrorKind | null {
  const hay = `${message}\n${stderrTail}`.toLowerCase();

  // Rate-limit phrases from codex / the underlying ChatGPT API. Kept
  // conservative to avoid false positives on routine error output.
  if (
    /\brate[ -]?limit(ed|ing)?\b/.test(hay) ||
    /\bdaily (message )?limit\b/.test(hay) ||
    /\busage limit\b/.test(hay) ||
    /\bquota exceeded\b/.test(hay) ||
    /\btoo many requests\b/.test(hay) ||
    /\byou['']?ve (hit|reached) (your|the)\b.*\b(limit|quota)\b/.test(hay) ||
    /\b429\b[^\n]{0,80}\b(too many|rate)\b/.test(hay)
  ) {
    return "rate_limited";
  }

  // Seatbelt / landlock denial messages. Codex prints these to stderr
  // with the offending path; exact phrasing has varied across codex
  // versions, so we match the two stable tokens.
  if (
    /\bsandbox\b[^\n]{0,120}\b(deny|denied|blocked|rejected)\b/.test(hay) ||
    /\boperation not permitted\b[^\n]{0,120}\.git\b/.test(hay)
  ) {
    return "sandbox_denied";
  }

  // Timeout — our own wrapper emits "timeout after Ns"; the MCP SDK
  // emits "-32001: Request timed out".
  if (
    /\btimeout after \d+s\b/.test(hay) ||
    /-32001\b[^\n]*\btimed out\b/.test(hay) ||
    /\brequest timed out\b/.test(hay)
  ) {
    return "timeout";
  }

  return null;
}
