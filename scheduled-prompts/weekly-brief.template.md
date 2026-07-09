<!--
TEMPLATE — do not run this file as-is. It contains placeholders like
{{YOUR_NAME}}. Either run the customize prompt in ../CUSTOMIZE.md with your
AI assistant (it will interview you and write a filled-in copy), or fill in
the placeholders yourself and save the result as weekly-brief.md.
-->

# Weekly Brief

Look over the past week of organized notes and distill it into a Monday-morning brief for {{YOUR_NAME}} to read, to recall everything important from the week before, kick off this week with the right focus and momentum, and follow up with people.

The summary should take no more than 2 minutes to read.

Working directory for this app: `{{APP_DIR}}`.

## Pre-flight: backfill any missing organize runs

Before writing the brief, make sure last week is fully organized.

1. **Compute the date range.** Last week = the prior Mon–Fri relative to today. If today is Monday, that's the immediately preceding Mon–Fri. Use those dates inclusive.

2. **For each date in the range**, check two things in `data/`:
   - Does `organized/<YYYY-MM-DD>.md` exist?
   - Does `daily/<YYYY-MM-DD>.md` exist AND contain non-trivial content (more than a header / whitespace)?

3. **Trigger a backfill for the date if EITHER:**
   - `organized/<date>.md` is missing or is materially smaller / clearly stale relative to its daily log, OR
   - `daily/<date>.md` is missing or only trivially populated.

   Rationale: the daily-organize job fetches external sources (chat, meeting transcripts) and writes them to `daily/` before producing `organized/`. So an empty or trivial daily log usually means the job itself failed — not that the day had no activity. Re-running the full daily-organize prompt (see `daily-organize.md` in this folder) will repopulate both files.

   To backfill, run the daily-organize prompt targeted at the specific date instead of today. At the top of the resulting organized file, note that it was a backfill (e.g., `> Backfill run on YYYY-MM-DD — original scheduled run did not execute`).

4. **If after backfill there is still genuinely no captured material for a day** (no transcripts, no chat activity), do not fabricate. Note in the brief that the day had no captured material.

5. Only after the pre-flight is complete, proceed to generate the brief.

## Writing the brief

- Read every organized file in the date range top-to-bottom before writing.
- Open with the hardest dates / deadlines in the upcoming week (a "This week's hard dates" block), if any are surfaced in last week's notes.
- **Headlines:** 4–8 bulleted items capturing the consequential decisions, contracts, releases, priority shifts, and major direction changes from the week.
- **Strategic context:** 3–6 items that aren't actions but shape how you think this week (competitive dynamics, constraints actively shaping approach, mental-model shifts, learnings worth carrying forward).
- **Top follow-ups:** numbered list of the 5–9 things you personally need to drive this week. Reference task IDs (e.g., `#82`) where they exist in `data/tasks.json`.
- **People to ping:** bulleted list with the specific topic for each person.
- **Stale flag:** surface anything carried multiple weeks; recommend close / backlog / fold-in.
- **Open strategic questions:** 5–10 unresolved items worth holding in mind (pull from `data/wiki/questions.md`).
- **Closed / progressed:** brief contrast against the prior Monday's brief, if one exists in `data/organized/`.

## Style

- Total read time ~2 minutes (roughly 600–900 words, prose-level density; trim ruthlessly).
- Direct, factual tone. No contrastive negation. Em dashes used sparingly.
- Flag when something is uncertain or source coverage was thin (backfilled day, chat-only day, missing transcripts).
- Do not placate — if last week's plan has holes or two threads contradict, flag it.

## Output location

Save to `data/organized/<today>-monday-brief.md` and surface the link at the end of the response.
