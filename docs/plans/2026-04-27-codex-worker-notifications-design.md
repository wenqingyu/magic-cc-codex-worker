# Codex worker push-notifications design

**Date:** 2026-04-27
**Status:** Approved, ready for implementation
**Target release:** 0.5.0

## Problem

Today, Claude Code dispatches codex workers via `magic-codex spawn` and then must repeatedly check progress. The actual usage pattern that emerged in the wild:

1. Spawn N agents
2. `ScheduleWakeup` for ~5 min later
3. Wake → call `status` → most agents still running → sleep again
4. Repeat 3-10 times until all agents reach a terminal state

Costs of the current pattern:

- **Cache misses on every wake.** The Anthropic prompt cache has a 5-minute TTL. Every wake re-reads the full conversation context.
- **Wake latency ≠ event latency.** An agent that finishes at minute 2 isn't reacted to until minute 5+ (the next wake).
- **No back-pressure on rate-limit failures.** When codex hits its 5h quota, the dispatcher discovers it on the next poll, then has to either give up or schedule a wake at the refill time.

Goal: replace the poll loop with a push notification driven by the codex side, so Claude only wakes when there's actually something to react to.

## Constraints

- **Same-session scenario only.** Out of scope: notifying a fresh Claude session that wasn't running when the agent terminated. The dispatcher pattern keeps a long-lived session alive between checks.
- **No new IPC mechanisms.** Use the existing MCP stdio transport. No daemons, no file watchers, no OS signals.
- **No breaking changes** to `spawn` / `status` / `result` / `resume` / `cancel` / `list` / `merge` / `discard`.
- **Replay-safe.** Transient disconnects must not lose events.

## Design

### New tool: `wait`

Add one new MCP tool. It blocks until any agent terminates, then returns a batch of all terminations within a small coalescing window. Replay-safe via a `since` cursor.

```typescript
wait({
  timeout_seconds?: number,        // default 1500 (25 min)
  since?: string,                  // ISO 8601 cursor for replay
  agent_ids?: string[],            // optional fan-out filter
  terminal_only?: boolean,         // default true
  batch_window_ms?: number,        // default 100
}) → {
  events: AgentSummary[],          // same shape as `status` returns
  observed_at: string,             // pass as `since` on next call
  agents_still_running: number,
  agents_running_ids: string[],
  timed_out: boolean,
}
```

### Event source

Add an `EventEmitter` on `Registry`. After every successful `update()`, emit `change` with `{ before_status, record }`. The orchestrator's existing `mirrorWorker(rec)` runs *after* `update`, so this slot is already invoked at every state transition without changing call sites.

### Handler logic

```
on wait(input):
  matching = []

  # Replay path: any post-`since` events already in the registry
  if input.since:
    for rec in registry.list():
      if rec.ended_at > input.since
         and matches_filter(rec, input):
        matching.push(rec)

  if matching.length > 0:
    return build_response(matching, observed_at=now)

  # Live path: subscribe to emitter
  return new Promise((resolve, reject):
    timer = setTimeout(timeout_seconds * 1000, () =>
      unsubscribe()
      resolve({ events: [], timed_out: true, ... })
    )

    on_change = (rec) =>
      if not matches_filter(rec, input): return
      matching.push(rec)
      # Coalesce: wait batch_window_ms for additional events
      if matching.length === 1:
        setTimeout(batch_window_ms, () =>
          unsubscribe()
          clearTimeout(timer)
          resolve(build_response(matching))
        )

    registry.on("change", on_change))
```

### Filter semantics

- `terminal_only: true` (default): `record.status ∈ {completed, failed, cancelled}`. Matches the user's "completed or blocked" intent — sandbox-denial, rate-limit, and zombie all surface as `failed` with `error.kind` already on the record.
- `agent_ids`: optional whitelist. If set, only events for these IDs match. Unknown IDs are silently skipped (idempotent if a worker was discarded between calls).
- `since`: ISO 8601, matched against `record.ended_at` for terminal records. Eliminates the "event happened during the gap between two `wait` calls" race.

### Response self-description

Every response includes `agents_still_running` and `agents_running_ids` (for the requested `agent_ids` filter, or all agents if no filter). The dispatcher never needs a separate `list` or `status` call to decide whether to call `wait` again — the answer is in the response.

### SDK timeout coordination

The MCP SDK caps how long a server can hold a request. Default `timeout_seconds=1500` (25 min) leaves slack under the SDK's typical 30-min cap. On our timeout: return `{ events: [], timed_out: true }`. On SDK timeout (rare): client sees a transport error; next `wait({ since: ... })` replays anything that fired during the gap.

### Loop on the caller side

```
spawn batch of N agents → ids
loop:
  resp = wait({
    agent_ids: ids,
    since: previous_observed_at,
  })
  for event in resp.events:
    react(event)  # in parallel tool-use turn
  if resp.agents_still_running === 0:
    break
  previous_observed_at = resp.observed_at
```

No `ScheduleWakeup`. Each Claude wake is exactly an event. Cache stays warm across the loop because successive `wait` calls are within the 5-min TTL when events are common.

## Tradeoffs accepted

- **The session has to call `wait`.** If Claude exits between operations, events accumulate in `state.json` but no live push fires. The replay path on next session covers it. Out-of-session push is explicitly out of scope (see Constraints).
- **One Claude wake per batch_window_ms boundary.** Setting the window to 100ms means 5 simultaneous completions become one wake; 5 completions spread over 30s become 5 wakes. That's correct — we don't want to wait 30s for a coalesced batch.
- **No mid-flight progress events.** `terminal_only: true` is the default. Callers who want every transition can opt out, but the typical dispatcher wants terminals.

## Test strategy

Five new unit tests against `Registry` and `Orchestrator + wait`:

1. `Registry.update` emits `change` with `{ before_status, record }` shape.
2. `wait` resolves immediately with replay events when `since` is in the past.
3. `wait` blocks, then resolves when an agent transitions to terminal — within `batch_window_ms` + a small slack.
4. `wait({ batch_window_ms: 50 })` returns multiple events together when 3 agents complete within the window.
5. `wait({ timeout_seconds: 0.05 })` returns `{ events: [], timed_out: true }` cleanly with no leaked timer/listener.

End-to-end: spawn 3 agents with mocked codex completing at t=50/100/150ms, call `wait` once at t=0, assert all 3 returned in one response (because the third lands within the batch window of the second).

## Implementation order

1. `Registry` extends `EventEmitter`, emits `change` after every `update`. (5 LOC)
2. `wait` handler in `index.ts`, zod schema, replay path. (~70 LOC)
3. Live-subscribe path with batch window + timeout. (~30 LOC)
4. Response builder including `agents_still_running` etc. (~20 LOC)
5. Tests (~150 LOC).
6. CHANGELOG entry, version bump 0.4.2 → 0.5.0.
7. Build-guard already in place catches version drift.

Estimated delta: ~300 LOC added, no removals, no breaking changes.

## Out of scope (explicit)

- Cross-session notification (Approach C — file-watch / OS notify). Useful but adds a moving part.
- Synchronous `spawn_and_wait` mode (Approach B — progress notifications during spawn). Breaks the fan-out pattern that's the whole point of magic-codex.
- A non-terminal `blocked` status for "agent needs decision". All current "blocked" cases manifest as `failed` with a kind. Adding a non-terminal blocked status would require codex protocol additions.
- Detecting "I need a decision from you" prose patterns. Out of band; the dispatcher can branch on `last_output` content after the wake.
