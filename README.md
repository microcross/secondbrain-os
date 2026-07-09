# Knowledge Base

A local-first daily notes + task board + personal wiki, kept up to date automatically by a scheduled AI task instead of by hand.

You write freeform notes into a daily canvas throughout the day. Once a day (and once a week), an AI assistant reads that canvas — plus, optionally, your team chat and meeting-transcript tools — and turns it into:

- a concise **daily digest** (meetings, decisions, action items, open questions)
- a growing **wiki** of projects, people, decisions, and topics that compounds over time instead of resetting every day
- a **kanban task board** it files your action items onto
- a **Monday brief** summarizing the week you can read in ~2 minutes

Everything lives as plain Markdown/JSON files on your disk — no external database, no cloud sync. The app itself is a small Electron shell around a local Express server; you can also run just the server and use it from a browser.

This repo is a **blank-slate template**: no sample notes, no pre-filled wiki, nothing personalized. You bring your own data (it accumulates as you use it) and fill in a couple of placeholders to point the scheduled tasks at your own name, tools, and team-chat channels.

## How it works

```
app.js / public/          Electron renderer + browser UI (canvas editor, kanban board, wiki viewer, chat)
main.js                   Electron main process (tray icon, window, login item)
server.js                 Express server — all file I/O and the /api/* routes live here
data/
  daily/YYYY-MM-DD.md     Your raw daily notes (freeform Markdown canvas)
  organized/YYYY-MM-DD.md Generated daily digest
  organized/YYYY-MM-DD-monday-brief.md  Generated weekly brief
  wiki/                   Generated, persistent knowledge base (projects/people/decisions/topics)
  tasks.json              Kanban board data
scheduled-prompts/        Templates for the two recurring AI tasks (see below)
```

The app itself never calls out to an AI model — it's just the notes/board/wiki editor and a small local chat endpoint that shells out to a CLI (see `server.js`, "Chat API") if one is installed. The actual organizing intelligence lives in the two prompts under `scheduled-prompts/`, which you run on a schedule with whatever AI assistant you use.

## Setup

Requires Node.js 18+.

```
npm install
npm run server     # plain server, open http://localhost:3456 in a browser
# or
npm start           # Electron app (tray icon + window) — currently packaged for macOS
```

The `data/` directory is created for you with an empty task board and an empty wiki skeleton. Nothing needs to be pre-populated — write your first daily note and go.

### Make it yours

Open `app.js` and `public/app.js` and find:

```js
const MY_NAMES = ['me'];
```

Add whatever names/aliases you use to refer to yourself in action items (e.g. `'jane'`, `'jd'`) — this is how the board decides whether an extracted action item is yours.

## Scheduling

The two prompts that do the actual organizing are in `scheduled-prompts/`:

- **`daily-organize.template.md`** — end-of-day: reads today's canvas (and, optionally, your team chat + meeting transcripts), writes the digest, updates the wiki, files action items to the board. Also backfills any missed weekday runs.
- **`weekly-brief.template.md`** — Monday morning: reads the past week's digests and writes a 2-minute brief.

They're written as **capability descriptions** ("search your chat tool for channels matching...") rather than calls to any specific vendor's tools, so they work with any AI assistant that has file read/write access to this project and, optionally, chat/meeting-notes connectors — Claude, ChatGPT, Gemini, a local model with MCP or plugin access, etc.

### Step 1 — fill in the placeholders

The templates have placeholders like `{{YOUR_NAME}}` and `{{APP_DIR}}`. Don't fill these in by hand — open [CUSTOMIZE.md](CUSTOMIZE.md), copy the prompt there into your AI assistant, and let it interview you for what it needs (your name/alias, timezone, project path, chat-channel patterns, meeting-notes tool, etc.). It will write out `scheduled-prompts/daily-organize.md` and `scheduled-prompts/weekly-brief.md` with everything filled in — the `.template.md` files are left untouched so you can re-run the interview later if your setup changes.

### Step 2 — point a scheduler at the filled-in prompts

Pick whatever mechanism fits the AI tool you use. A few options:

- **Claude Code:** use its built-in `/schedule` (cron-backed scheduled agents) or the `schedule` skill to run `scheduled-prompts/daily-organize.md` on weekday evenings and `scheduled-prompts/weekly-brief.md` on Monday mornings, each pointed at this project directory.
- **Any CLI-based agent (Claude Code, other agent CLIs) + cron/launchd/Task Scheduler:** create a cron job (macOS/Linux) or Scheduled Task (Windows) that invokes your agent's CLI non-interactively with the contents of the relevant prompt file, e.g. `claude -p "$(cat scheduled-prompts/daily-organize.md)"` on a weekday-evening cron schedule, and the weekly-brief prompt on a Monday-morning schedule.
- **A hosted agent platform with its own scheduler** (e.g. a scheduled workflow/automation feature): paste the filled-in prompt content in as the task body and point it at this repo/directory.

Whatever you use, the task needs:
- File read/write access to this project's `data/` directory (required)
- Network access to `http://localhost:3456` if you want it to file tasks through the running app's API (optional — it falls back to writing `data/tasks.json` directly)
- Chat and/or meeting-notes connector access (optional — the daily prompt skips those sections gracefully if unavailable)

## Notes on `.gitignore`

Your actual notes, digests, and wiki pages are personal — the `.gitignore` keeps the folder structure (via `.gitkeep`) but excludes real content, so cloning this repo always starts blank. Your personalized `scheduled-prompts/*.md` (the filled-in versions, as opposed to the `.template.md` files) are also excluded, since they'll contain your real name and channel names.

## License

MIT — see [LICENSE](LICENSE).
