<!--
TEMPLATE — do not run this file as-is. It contains placeholders like
{{YOUR_NAME}}. Either:
  (a) run the customize prompt in ../CUSTOMIZE.md with your AI assistant, which
      will interview you and write a filled-in copy, or
  (b) fill in the placeholders yourself and save the result as
      daily-organize.md before pointing your scheduler at it.

This is written as capability descriptions ("search Slack for...") rather
than specific tool-call names, so it works with any assistant that has
roughly-equivalent tools/connectors (Claude, ChatGPT, Gemini, local models
with MCP or plugin access, etc). If your assistant lacks a Slack or Drive
connector, skip those sections — the daily canvas + task board alone still
work.
-->

# Daily Canvas Organize

You are organizing {{YOUR_NAME}}'s daily canvas log. This normally runs end-of-day for today, but on resume after a gap it ALSO backfills any weekday runs that were missed since the last successful organize. See Step 0.

Working directory for this app: `{{APP_DIR}}` (contains `data/daily/`, `data/organized/`, `data/wiki/`, `data/tasks.json`). All paths below are relative to that directory unless stated otherwise.

## Resilience (read first)

This task runs unattended on weekday evenings ({{TIMEZONE}}). External tools (Slack, Google Drive, or whatever connectors you use) sometimes fail on their first call after a cold start, then succeed seconds later. Without retry logic, a single first-call failure can cause the whole run to lose the day.

**Connector retry rule.** For every call to an external tool (Slack, Drive, or equivalent), if it fails with an authentication, connection, timeout, or "server disconnected" error, wait ~15 seconds and retry, up to 3 attempts total. Only treat a call as failed after the third attempt.

**Preflight warm-up.** Before Step 1, make one cheap warming call to each external tool you plan to use (e.g. a tiny file search, a small channel list). If a preflight call fails after the retry rule above, log the failure (see "Failure capture" below) and skip that source for this run rather than aborting — a partial run is more useful than no run.

**Failure capture.** If the run cannot complete normally (a tool is unrecoverable, or any unexpected fatal error), write a short note to `data/organized/YYYY-MM-DD-failed.md` containing: the date, which step failed, the exact error text, and what was completed before the failure. Do NOT silently exit — the next review depends on knowing what broke.

## What to do

### Step 0: Determine target dates (today + missed weekday backfill)

Before anything else, build the ordered list of **target dates** this run will process. Steps 1–9 then execute once **per target date**, oldest first.

1. **Today's date** in {{TIMEZONE}}.
2. **Look back up to 7 calendar days** for missed weekdays:
   - For each weekday (Mon–Fri) within the last 7 days that is **before today**, check whether `data/organized/YYYY-MM-DD.md` exists.
   - A weekday is **missed** if that file does NOT exist AND `data/organized/YYYY-MM-DD-failed.md` also does NOT exist. (A failure marker means we already know the day broke; don't retry blindly — surface it in the run log instead.)
   - Skip weekends (Sat/Sun) entirely — no organized output is expected for those.
3. **Cap the backfill at 5 missed weekdays.** If more than 5 missed weekdays appear in the 7-day window, take only the most recent 5 and list the older skipped dates in the run's wiki log entry under a `Skipped (outside backfill window):` line.
4. **Build the ordered list:** `[oldest missed weekday, ..., most-recent missed weekday, today]`.
5. **Surface the plan up front.** Before starting Step 1, print a one-line summary of what will be processed.
6. **Failure isolation per target date.** A fatal failure on one target date must NOT block the others.

**Substitution rule for Steps 1–9.** Wherever Steps 1–9 reference "today" or `YYYY-MM-DD`, substitute the current target date. Date-bounded queries must bound the target date — not today's bounds — on backfill passes:

- **Drive/meeting-notes search:** bound both ends, e.g. "modified after start-of-target-day and before start-of-next-day," so backfill days don't pull in later content.
- **Slack search:** bound both start and end of the target day in {{TIMEZONE}}. An "since X" pattern with no upper bound would over-pull on backfill days.

**Backfill caveats:**

- **Tasks added via backfill** still go into the task store with `sourceDate` set to the **target date**, not today.
- **Carryover** in a backfilled organized doc reflects the state of the task board **at run time**, not at the historical target date. Note this in the Carryover section header: "Carryover (snapshot at backfill time YYYY-MM-DD, not the target date)".
- **Action-item deduplication:** before adding a task from a backfilled day, check the task store for an existing entry with the same title — a later organize run may have already captured the same item from a downstream source.
- **Wiki log entries:** write one log entry per target date, tagging backfill entries: `## [TARGET_DATE] organize [backfill] | ...`.

---

### Step 1: Gather today's meeting transcripts

If you have access to a meeting-notes source (Google Drive, Otter, Fireflies, or similar), search for meeting notes from the target date:

- **Your own notes:** documents matching your meeting-notes naming pattern (e.g. title contains "{{MEETING_NOTES_TITLE_PATTERN}}") modified on the target date.
- **Notes shared with you** (other people's transcripts you were included on): same title pattern, shared-with-you scope.
- Your primary notes folder ID, if your tool needs one (leave blank/remove this line if not applicable): `{{DRIVE_FOLDER_ID}}`

For each document found:
- Fetch its full content
- Extract: meeting name, attendees, summary, decisions, action items
- Deduplicate: if the same meeting appears in both sources, merge and use the more complete version

If you have no meeting-notes connector, skip this step — Steps 3+ still work from the canvas and task board alone.

---

### Step 2: Scan Slack (or your team chat tool) for today's activity

Scan channels for messages from the target date. The goal is to surface decisions (with a one-sentence rationale), action items, important discussions, and anything that should be captured in the daily summary.

**Channels to include:** channels you're a member of matching ANY of:
{{SLACK_CHANNEL_INCLUDE_PATTERNS}}

**Always skip these channels regardless of the above:**
{{SLACK_CHANNEL_SKIP_LIST}}

**How to scan:**
1. Find channels matching the include patterns; filter out anything in the skip list.
2. For each qualifying channel, read the target date's messages.
3. For threads that look substantive (decisions, action items, notable discussions), read the full thread.

**What to extract:**
- Action items directed at you (look for @mentions of your name/aliases: {{YOUR_ALIASES}})
- Decisions made or announced
- Important updates on projects you work on: {{PROJECT_KEYWORDS}}
- Anything time-sensitive or that could fall through the cracks
- Skip routine noise: automated notifications, emoji reactions, one-word replies, standup bot posts

**Record which channel each item came from.**

If you have no chat-tool connector, skip this step.

---

### Step 3: Read today's raw daily log

Read from: `data/daily/YYYY-MM-DD.md` (target date).
- If the file is empty or missing AND no other sources returned content, skip — nothing to organize.

**Treat the canvas as a co-equal source, not a secondary input.** It's the only place your own first-person observations, frustrations, status notes, and meta-reflections show up. These often have no echo in any meeting or chat thread.

For every bullet in the daily log, classify it:
- **Has a meeting/chat echo** — fold into the relevant Meeting or Highlights section, but preserve any specific personal detail the other version doesn't carry (quantities, frustrations, time costs).
- **Canvas-only observation** — preserve verbatim *in your voice* ("I/my", not third person) in the dedicated **From My Daily Log** section in Step 5. Never drop these because they didn't show up elsewhere.

---

### Step 4: Read the current task list, wiki index, and open questions

Read from: `data/tasks.json`
Read from: `data/wiki/index.md`
Read from: `data/wiki/questions.md` — the persistent open-questions log.

---

### Step 5: Produce an organized summary

Combine the raw canvas log, meeting transcripts, and chat findings into one organized daily summary. **The digest is a morning scan, not a transcript — default to concise.** Full detail belongs in the wiki pages (Step 9), not here. The one thing you must never compress away: a key decision needs enough context (who, what, why) to recall it later.

Structure it into these sections (omit any section that has no content):

- **From My Daily Log** — first-person preservation of canvas-only observations. Write in your own voice ("I/my"). Include only when there's genuine first-person content not already captured elsewhere.
- **Meetings** — who was there, key points, outcomes, decisions, and any action items assigned to you, in a few tight bullets.
- **Chat Highlights** — notable discussions, decisions, or updates (grouped by channel). Skip routine noise.
- **Decisions** — what was decided, by whom, and why (one entry per decision, linked to its decision page). Keep who/what/why even while trimming elsewhere.
- **Action Items** — **your still-open items only**, format `- [ ] [{{YOUR_HANDLE}}] Description`. Other people's action items stay inline in the relevant meeting bullet. Exclude anything already completed. For something you delegated and must follow up on: `- [ ] [{{YOUR_HANDLE}}] Follow up: <thing> (waiting on <Person>)`.
- **Open Questions** — only (i) new questions raised today that pass the gate in Step 9, and (ii) existing questions with a real update today. Don't reproduce the standing backlog. End with: `Full open list: wiki/questions.md`.
- **Notes** — genuinely cross-cutting items that aren't a decision or meeting detail. Optional.
- **Carryover** — tasks in the "today" column not yet marked done.
- **Sources** — documents and channels incorporated, with links where available.

Save to: `data/organized/YYYY-MM-DD.md`

---

### Step 6: Append meeting and chat content to today's raw canvas

If meeting transcripts or chat content contained material NOT already in the raw canvas, append it:

```
---
## Auto-imported from meeting transcripts

### [Meeting Name] — [Date/Time]
**Attendees:** ...
**Summary:** ...
**Key Decisions:** ...
**Action Items:**
- [ ] [Name] Description
```

```
---
## Auto-imported from chat

### #[channel-name]
**Notable content:** ...
**Action Items:**
- [ ] [Name] Description
```

---

### Step 7: Extract action items to the task board

Add tasks for **you only** — never for other people. Two kinds of items go to the board:

1. **Your own to-dos** (things you must do) → column `inbox`.
2. **Things you requested or delegated and need to follow up on** → column `waiting`. Title these `Follow up: <thing> (<Person>)`.

Before adding anything:
- **Exclude completed items.** If the source shows the item was already done today, don't add it.
- **Dedupe against `data/tasks.json` across ALL columns (including `done`).**

For each genuinely new task:
- POST to `{{TASK_BOARD_URL}}/api/tasks` with body: `{ "title": "...", "column": "inbox" | "waiting", "sourceDate": "YYYY-MM-DD" }`
- If the server isn't running, write directly to `data/tasks.json`.

---

### Step 8: Flag carryover

Check `data/tasks.json` for tasks in the "today" column not moved to "done". Mention in the organized summary under **Carryover**.

---

### Step 9: Update the wiki

This is the most important step. The wiki lives at `data/wiki/`:

- `wiki/projects/` — one page per project
- `wiki/people/` — one page per person you work with regularly
- `wiki/decisions/` — one page per significant decision
- `wiki/topics/` — one page per recurring topic or concept

**For each entity mentioned in today's content:**

**Projects:** check if `wiki/projects/<slug>.md` exists.
- If it exists: append today's updates under `## YYYY-MM-DD`, update the top summary if anything material changed.
- If not: create it with a summary, team involved, current status, and today's notes.

**People:** check if `wiki/people/<name>.md` exists.
- If it exists: update with new context (role changes, responsibilities, recent interactions).
- If not, AND they appeared in 2+ meetings/threads or had a 1:1 with you: create a page with their role, team, and what you work with them on.

**Decisions:** if a decision was made today, create `wiki/decisions/YYYY-MM-DD-<slug>.md` with the decision, context/rationale, who was involved, status (active/superseded), and `[[wiki-links]]` to related pages.

**Topics:** for recurring themes spanning multiple projects/sources, create or update topic pages.

**Open Questions (`wiki/questions.md`):** maintain every run, but be strict about what earns a slot.

**The gate — track a question ONLY if BOTH are true:**
- **(a) It's yours to resolve** — you or your team can drive it to an answer through a decision or an action.
- **(b) It's material** — leaving it unanswered either blocks work or leaves a decision unmade that affects approach, direction, or strategy.

Quick test: *"If this stays unanswered, does it block work or leave a decision unmade — and is it ours to resolve?"* If not, don't track it.

- **Qualifies:** "blocked until we get X from the customer"; "deciding between approach A and B"; a design/scoping fork; a dependency gating work.
- **Does NOT qualify:** external outcomes you don't control that just resolve with time; passing data-point discrepancies unless they gate a decision; rhetorical questions, curiosity, trivia.

When a question passes the gate:
1. **Dedupe** against the Open section; append an `**Update YYYY-MM-DD:**` line if today adds context.
2. **Append** using:
   ```
   ### Q-YYYYMMDD-NN — short title
   - **Raised:** YYYY-MM-DD
   - **Source:** [meeting name / channel / canvas]
   - **Related:** [[wiki-links]]
   - **Question:** the question text
   - **Status:** Open
   ```
3. **Detect resolutions.** Set status to `Answered (YYYY-MM-DD)` with an **Answer:** field. Don't delete — it's a paper trail. If a question no longer meets the gate, set status to `Dismissed` with a one-line note.
4. **When unsure whether something is resolved,** leave it Open with an `**Update YYYY-MM-DD:**` note.

**Cross-references:** use `[[slug]]` syntax between wiki pages.

**Update the index:** after all wiki writes, update `wiki/index.md` to list every page with a one-line summary, by category.

**Update the log:** append to `wiki/log.md`:

```
## [YYYY-MM-DD] organize | Daily log + N meetings + N chat channels
- Updated: [list of pages updated]
- Created: [list of pages created]
```
```
## [YYYY-MM-DD] organize [backfill] | Daily log + N meetings + N chat channels
- Backfilled on: [actual run date]
- Updated: [...]
- Created: [...]
- Skipped (outside backfill window): [any missed weekdays older than 7 days, if any]
```

---

## Important rules
- Preserve the raw log as-is (only append, never edit existing content).
- Default to concise. The exception is decisions — always keep enough who/what/why to recall them.
- Do not hallucinate — only use content from the log, meeting notes, and chat.
- Wiki pages are persistent reference material, not daily notes — they should read well to someone encountering the page for the first time.
- Action-item format: `- [ ] [{{YOUR_HANDLE}}] Description` for you, `- [ ] [Full Name] Description` for others. The top-level **Action Items** section lists only your open items.
- Only add tasks to the board for you. Never add other people's tasks, and never add an item that's already done or already on the board.
- **Voice convention:** use "{{YOUR_HANDLE}}" in third person in the organized doc and wiki pages. In **From My Daily Log**, write in first person ("I/my").
- **Canvas content is co-equal** with meeting/chat sources — never drop a canvas observation because it doesn't show up elsewhere.
- If anything fails fatally, follow the **Failure capture** rule before exiting. Never exit silently.
