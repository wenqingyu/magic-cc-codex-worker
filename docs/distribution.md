# Distribution Submissions — magic-cc-codex-worker

Tracker for promotional-registry submissions (awesome-lists, marketplaces,
crawlers). Update inline when status changes; do not delete entries — the
ledger is the trace.

| Symbol | Meaning |
|---|---|
| 🟢 | merged / live |
| 🟡 | open, no maintainer response |
| 🔵 | open, in review (CodeRabbit / maintainer commented) |
| 🟠 | open, action needed from us |
| 🔴 | closed / rejected |
| ⏳ | scheduled, not yet submitted |
| 📝 | manual web-form submission, no PR to track |

## Active submissions

### 🟡 ComposioHQ/awesome-claude-plugins #194
- **URL:** https://github.com/ComposioHQ/awesome-claude-plugins/pull/194
- **Submitted:** 2026-04-24 12:41 UTC
- **Last activity:** 2026-04-24 (open, untouched)
- **Status:** awaiting maintainer review
- **Notes:** no CI, no auto-bot, no comments

### 🔵 rohitg00/awesome-claude-code-toolkit #339
- **URL:** https://github.com/rohitg00/awesome-claude-code-toolkit/pull/339
- **Submitted:** 2026-04-24 12:41 UTC
- **Last activity:** 2026-04-24 13:03 UTC
- **Status:** CodeRabbit reviewed, partially addressed
- **History:**
  - 2026-04-24 12:42 — CodeRabbit auto-review: suggested adding license note + bumping plugin counter
  - 2026-04-24 13:02 — addressed in commit `3118e83`: license added to entry, header bumped 176+ → 177+
  - 2026-04-24 13:03 — CodeRabbit follow-up: counter still says `176+` at **line 53 (TOC)** and **line 74 (Plugins intro)**; only line 3 was bumped
- **Action open:** decide whether to also bump line 53 + 74. Maintainer not yet weighed in. CodeRabbit is a bot — if maintainer is fine with partial bump, no action needed. Risk of further bot churn if we leave it.

### 🟡 ccplugins/awesome-claude-code-plugins #201
- **URL:** https://github.com/ccplugins/awesome-claude-code-plugins/pull/201
- **Submitted:** 2026-04-24 12:43 UTC
- **Last activity:** 2026-04-24 (open, untouched)
- **Status:** awaiting maintainer review
- **Notes:** no CI, no comments

### 🟡 davepoon/buildwithclaude #134
- **URL:** https://github.com/davepoon/buildwithclaude/pull/134
- **Submitted:** 2026-04-24 13:37 UTC
- **Last activity:** 2026-04-24 (open, untouched)
- **Status:** awaiting maintainer review
- **Notes:** opened later than the other three (rate-limit on the worker agent forced retry after 21:00 KL); no activity since

### ⏳ hesreallyhim/awesome-claude-code (scheduled)
- **Submission method:** web form (template: `recommend-resource.yml`) — bot rejects `gh` CLI submissions
- **Form URL:** https://github.com/hesreallyhim/awesome-claude-code/issues/new?template=recommend-resource.yml
- **Form copy:** `docs/submission-copy.md` § 2 (verbatim paste)
- **Why deferred:** registry requires repo age ≥ 1 week; repo opened 2026-04-24
- **Scheduled fire:** 2026-05-02 01:00 UTC via routine `trig_01L7va95sjCMR5omXeGT4nQh`
  - Routine runs Sonnet remote agent that re-checks all 4 PRs above + presents paste-ready form copy
  - User must manually paste into the web form (agent cannot submit it)
- **View in UI:** https://claude.ai/code/routines/trig_01L7va95sjCMR5omXeGT4nQh

## Completed / passive

### 📝 claudecodemarketplace.net
- **Submitted:** 2026-04-24 (manually by user via web form)
- **Status:** confirmation pending site-owner review (no public PR to track)

### ⏳ claudemarketplaces.com (auto-crawler)
- **Mechanism:** site auto-crawls public Claude Code plugin marketplaces
- **Action:** none needed — passive
- **Verification:** `curl -s https://claudemarketplaces.com | grep -i magic-codex` (re-check periodically)
- **Last checked:** _not yet_

### ⏳ quemsah (popularity-gated)
- **Mechanism:** auto-listing once GitHub stars cross threshold
- **Action:** none needed — passive

## Operational notes

- All four manually-PR'd registries follow the same pattern: open a PR adding one row to a README/list. None have CI; merges are at maintainer discretion. Median wait time per the original research session: 3–7 days.
- For the hesreallyhim submission, the routine is the *reminder + status*, not the submission. The actual paste happens in the user's browser.
- If a PR sits >14 days without movement: post a polite check-in comment, do not bump.
- If a PR is closed without merge: don't reopen — file a fresh entry here under "Rejected" with the reason.

## Re-check command

To re-poll all four open PRs at once:

```bash
for spec in \
  "ComposioHQ/awesome-claude-plugins:194" \
  "rohitg00/awesome-claude-code-toolkit:339" \
  "ccplugins/awesome-claude-code-plugins:201" \
  "davepoon/buildwithclaude:134"; do
  repo="${spec%:*}"; num="${spec#*:}"
  echo "=== $repo #$num ==="
  gh pr view "$num" --repo "$repo" --json state,mergedAt,updatedAt,reviewDecision,latestReviews
done
```
