# Customize the scheduled-task prompts

The two files in `scheduled-prompts/` (`daily-organize.template.md` and `weekly-brief.template.md`) are generic templates for the two scheduled tasks this app is built around. They need a handful of details about you and your setup filled in before you schedule them.

Rather than fill in the placeholders by hand, paste the prompt below into your AI assistant (Claude, ChatGPT, Gemini, or any capable model with file read/write access to this project). It will interview you for what it needs and write out personalized copies.

---

## Prompt to paste into your assistant

```
Read scheduled-prompts/daily-organize.template.md and scheduled-prompts/weekly-brief.template.md
in this project. They're templates for two recurring tasks (a daily notes-organizer and a Monday
weekly-brief generator) with placeholders like {{YOUR_NAME}}, {{APP_DIR}}, etc.

Ask me, one question at a time, for whatever you need to fill in every placeholder. At minimum
you'll need:
- My name, and any short handle/alias I want used to refer to me in third person in generated notes
- My timezone
- The absolute path to this project directory on disk (so the scheduled task can find it
  regardless of what directory it's invoked from)
- The URL the task-board server runs on (default http://localhost:3456 — ask if I've changed it)
- Whether I use Slack (or another team chat tool) for work discussion, and if so:
  - which channel name patterns should be scanned (e.g. "starts with customer-")
  - any channels that should always be skipped
  - what project names/keywords I want you watching for
- Whether I use Google Drive (or another meeting-notes tool) for meeting transcripts, and if so:
  - the title pattern my transcripts use (e.g. "Gemini", "Otter", "Fireflies")
  - a specific folder ID to search, if applicable

If I say I don't use Slack or Drive, remove those sections from the templates entirely rather than
leaving placeholders — don't leave dead instructions for a tool I don't have.

Once you have everything, write two new files:
- scheduled-prompts/daily-organize.md
- scheduled-prompts/weekly-brief.md
with every placeholder replaced and any inapplicable sections removed. Leave the two
.template.md files untouched so I can re-run this later if my setup changes.
```

---

Once you have `daily-organize.md` and `weekly-brief.md`, see [README.md](README.md#scheduling) for how to point a scheduler at them.
