import type { AgentErrorKind } from "./types.js";

export interface ClassifiedError {
  kind: AgentErrorKind | null;
  /** ISO 8601 UTC timestamp at which a `rate_limited` failure can be
   *  retried, when extractable from codex's "try again at HH:MM" message.
   *  Codex prints the time in the user's local timezone — we resolve it
   *  to absolute UTC so callers can sleep the right amount. */
  retry_at?: string;
  /** Seconds from now until the `retry_at` time. */
  retry_after_seconds?: number;
}

/**
 * Classify a failed codex call into a coarse category supervisors can
 * branch on. Matches on the thrown error message *and* the tail of the
 * codex child's stderr — rate-limit errors in particular surface as
 * plain text in stderr with varying MCP-layer wrappings, so looking at
 * both sources widens the match without making patterns fragile.
 *
 * Returns `null` kind when nothing matches. The caller attaches the
 * result to `error.kind`; nothing downstream treats `null` differently
 * from an unset field.
 */
export function classifyError(
  message: string,
  stderrTail: string,
): AgentErrorKind | null {
  return classifyErrorDetailed(message, stderrTail).kind;
}

/** Like `classifyError` but also returns retry-time hints for
 *  `rate_limited` failures. Use this when you need to schedule a wake-up.
 *  The simpler `classifyError` form is preserved for legacy callers. */
export function classifyErrorDetailed(
  message: string,
  stderrTail: string,
  now: Date = new Date(),
): ClassifiedError {
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
    const retry = parseRetryHint(hay, now);
    return { kind: "rate_limited", ...retry };
  }

  // Seatbelt / landlock denial messages. Codex prints these to stderr
  // with the offending path; exact phrasing has varied across codex
  // versions, so we match the two stable tokens.
  if (
    /\bsandbox\b[^\n]{0,120}\b(deny|denied|blocked|rejected)\b/.test(hay) ||
    /\boperation not permitted\b[^\n]{0,120}\.git\b/.test(hay)
  ) {
    return { kind: "sandbox_denied" };
  }

  // Timeout — our own wrapper emits "timeout after Ns"; the MCP SDK
  // emits "-32001: Request timed out".
  if (
    /\btimeout after \d+s\b/.test(hay) ||
    /-32001\b[^\n]*\btimed out\b/.test(hay) ||
    /\brequest timed out\b/.test(hay)
  ) {
    return { kind: "timeout" };
  }

  return { kind: null };
}

/** Parse codex's "try again at HH:MM" / "retry after N seconds" hints
 *  from a rate-limit error and resolve to an absolute UTC timestamp.
 *  The "HH:MM" form is in the user's *local* timezone (codex prints
 *  whatever the host clock says); we interpret it that way and convert
 *  to UTC. If the parsed time is in the past (e.g. "8:30" appearing
 *  after 8:30 today), it's interpreted as tomorrow. */
function parseRetryHint(
  hay: string,
  now: Date,
): { retry_at?: string; retry_after_seconds?: number } {
  // "retry after 1234 seconds" / "try again in 1234s"
  const secondsMatch =
    /\b(?:retry|try again)\b[^\n]{0,40}\b(?:in|after)\s+(\d{1,5})\s*(?:s\b|second)/i.exec(
      hay,
    );
  if (secondsMatch) {
    const sec = Number(secondsMatch[1]);
    if (Number.isFinite(sec) && sec >= 0) {
      return {
        retry_at: new Date(now.getTime() + sec * 1000).toISOString(),
        retry_after_seconds: sec,
      };
    }
  }

  // "try again at 14:30" / "available again at 9:05 am" — local time.
  const clockMatch =
    /\b(?:try again|available(?: again)?|retry)\b[^\n]{0,40}\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(
      hay,
    );
  if (clockMatch) {
    let hh = Number(clockMatch[1]);
    const mm = Number(clockMatch[2] ?? "0");
    const ampm = clockMatch[3]?.toLowerCase();
    if (ampm === "pm" && hh < 12) hh += 12;
    if (ampm === "am" && hh === 12) hh = 0;
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      const target = new Date(now);
      target.setHours(hh, mm, 0, 0);
      if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
      }
      const sec = Math.round((target.getTime() - now.getTime()) / 1000);
      return {
        retry_at: target.toISOString(),
        retry_after_seconds: sec,
      };
    }
  }

  return {};
}
