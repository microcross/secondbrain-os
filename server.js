const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = 3456;

// SECONDBRAIN_DATA_DIR lets the data live outside the code (the Electron app
// sets it to ~/Documents/SecondBrain, since a packaged .app is read-only).
// Otherwise it's resolved relative to this file so the data directory is found
// regardless of the current working directory or where the project is checked out.
const DATA_DIR = process.env.SECONDBRAIN_DATA_DIR || path.join(__dirname, 'data');
const DAILY_DIR = path.join(DATA_DIR, 'daily');
const ORGANIZED_DIR = path.join(DATA_DIR, 'organized');
const WIKI_DIR = path.join(DATA_DIR, 'wiki');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Helpers ---

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// Ensure every task has an `order` field within its column. Seeded from current
// date-desc sort so existing layouts don't visibly shift on first load.
// Returns true if any task was modified.
function backfillOrders(data) {
  if (data.tasks.every(t => typeof t.order === 'number')) return false;
  const byCol = {};
  for (const t of data.tasks) (byCol[t.column] = byCol[t.column] || []).push(t);
  for (const col of Object.keys(byCol)) {
    byCol[col].sort((a, b) => {
      const ad = a.sourceDate || (a.createdAt ? a.createdAt.slice(0, 10) : '');
      const bd = b.sourceDate || (b.createdAt ? b.createdAt.slice(0, 10) : '');
      if (ad !== bd) return ad < bd ? 1 : -1; // desc
      return b.id - a.id;
    });
    byCol[col].forEach((t, i) => { t.order = i; });
  }
  return true;
}

// Renumber `order` (0..n-1) for the given column based on current order values.
function renumberColumn(data, column) {
  data.tasks
    .filter(t => t.column === column)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .forEach((t, i) => { t.order = i; });
}

function ensureDirs() {
  [DATA_DIR, DAILY_DIR, ORGANIZED_DIR, WIKI_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

ensureDirs();

// --- Daily Canvas API ---

// Get canvas for a specific date (defaults to today). Creates fresh one if today doesn't exist.
app.get('/api/canvas/:date?', (req, res) => {
  const date = req.params.date || todayStr();
  const file = path.join(DAILY_DIR, `${date}.md`);

  if (fs.existsSync(file)) {
    return res.json({ date, content: fs.readFileSync(file, 'utf8'), exists: true });
  }

  if (date === todayStr()) {
    const header = `# Daily Log — ${date}\n\n`;
    fs.writeFileSync(file, header, 'utf8');
    return res.json({ date, content: header, exists: true });
  }

  res.json({ date, content: '', exists: false });
});

// Save canvas content
app.put('/api/canvas/:date?', (req, res) => {
  const date = req.params.date || todayStr();
  const file = path.join(DAILY_DIR, `${date}.md`);
  fs.writeFileSync(file, req.body.content, 'utf8');
  res.json({ ok: true });
});

// List all canvas dates
app.get('/api/canvas-list', (req, res) => {
  const files = fs.readdirSync(DAILY_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''))
    .sort()
    .reverse();
  res.json(files);
});

// Get organized version of a day
app.get('/api/organized/:date', (req, res) => {
  const file = path.join(ORGANIZED_DIR, `${req.params.date}.md`);
  if (fs.existsSync(file)) {
    return res.json({ date: req.params.date, content: fs.readFileSync(file, 'utf8'), exists: true });
  }
  res.json({ date: req.params.date, content: '', exists: false });
});

// Save organized version (used by Claude's scheduled task)
app.put('/api/organized/:date', (req, res) => {
  const file = path.join(ORGANIZED_DIR, `${req.params.date}.md`);
  fs.writeFileSync(file, req.body.content, 'utf8');
  res.json({ ok: true });
});

// --- Wiki API ---

// Derive a display title from a wiki page's content: strip any YAML
// frontmatter block, then use its `title:` field if present, otherwise the
// first non-blank line (typically a `# Heading`).
function extractTitle(content, fallback) {
  let body = content;
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    const titleLine = fm[1].split('\n').find(l => /^title:/i.test(l.trim()));
    if (titleLine) {
      return titleLine.replace(/^title:\s*/i, '').trim().replace(/^["']|["']$/g, '') || fallback;
    }
    body = content.slice(fm[0].length);
  }
  const firstLine = body.split('\n').find(l => l.trim()) || '';
  return firstLine.replace(/^#+\s*/, '') || fallback;
}

// List all wiki pages
app.get('/api/wiki', (req, res) => {
  const pages = [];
  function scan(dir, prefix) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        scan(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.name.endsWith('.md')) {
        const slug = prefix ? `${prefix}/${entry.name.replace('.md', '')}` : entry.name.replace('.md', '');
        const content = fs.readFileSync(path.join(dir, entry.name), 'utf8');
        const title = extractTitle(content, slug);
        pages.push({ slug, title, size: content.length });
      }
    }
  }
  scan(WIKI_DIR, '');
  res.json(pages);
});

// Get a wiki page
app.get('/api/wiki/:slug(*)', (req, res) => {
  const slug = req.params.slug;
  const file = path.join(WIKI_DIR, `${slug}.md`);
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    // Find backlinks: other wiki pages that reference this slug
    const backlinks = [];
    function scanLinks(dir, prefix) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          scanLinks(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
        } else if (entry.name.endsWith('.md')) {
          const otherSlug = prefix ? `${prefix}/${entry.name.replace('.md', '')}` : entry.name.replace('.md', '');
          if (otherSlug === slug) return;
          const otherContent = fs.readFileSync(path.join(dir, entry.name), 'utf8');
          if (otherContent.includes(`[[${slug}]]`) || otherContent.includes(`(${slug})`) || otherContent.includes(`${slug}.md`)) {
            backlinks.push({ slug: otherSlug, title: extractTitle(otherContent, otherSlug) });
          }
        }
      }
    }
    scanLinks(WIKI_DIR, '');
    return res.json({ slug, content, exists: true, backlinks });
  }
  res.json({ slug, content: '', exists: false, backlinks: [] });
});

// Create or update a wiki page
app.put('/api/wiki/:slug(*)', (req, res) => {
  const slug = req.params.slug;
  const file = path.join(WIKI_DIR, `${slug}.md`);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, req.body.content, 'utf8');
  res.json({ ok: true });
});

// Delete a wiki page
app.delete('/api/wiki/:slug(*)', (req, res) => {
  const file = path.join(WIKI_DIR, `${req.params.slug}.md`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ ok: true });
});

// --- Questions API ---
//
// Backed by `wiki/questions.md`. Each question is an H3 block with bullet-list
// fields (Raised, Source, Related, Question, Status, Answer). The per-question
// `**Status:**` field is the source of truth for grouping; the parser ignores
// section headers (`## Open`, `## Answered`, etc.) and the serializer regenerates
// them from the status values. This auto-corrects any drift on first save.

const QUESTIONS_FILE = path.join(WIKI_DIR, 'questions.md');
const QUESTION_STATUSES = ['Open', 'Answered', 'Dismissed'];
const DEFAULT_QUESTIONS_PREFIX =
  '# Open Questions\n\n' +
  '> Persistent, deduped list of unresolved questions surfaced from daily canvas, meetings, and Slack. The Questions view in the app manages section placement automatically based on Status — edit there rather than this file directly.\n\n' +
  '---\n\n';

// Pull a single bullet field like `- **Raised:** 2026-04-20`. Multi-line values
// (Question, Answer) may span until the next `- **` bullet or end of block.
function extractField(text, name) {
  const re = new RegExp(`^[-*]\\s+\\*\\*${name}(?:\\s*\\(([^)]+)\\))?:\\*\\*\\s*([\\s\\S]*?)(?=\\n[-*]\\s+\\*\\*|$)`, 'm');
  const m = text.match(re);
  if (!m) return null;
  return { paren: (m[1] || '').trim() || null, value: m[2].trim() };
}

function parseQuestions(raw) {
  if (!raw) return { prefix: DEFAULT_QUESTIONS_PREFIX, questions: [], unparsed: [] };

  // Split prefix (everything before the first `### `) from question blocks.
  const firstH3 = raw.search(/^### /m);
  const prefix = firstH3 === -1 ? raw : raw.slice(0, firstH3);
  const body = firstH3 === -1 ? '' : raw.slice(firstH3);

  // Each block starts with `### `. Use lookahead split so we keep the headers.
  const blocks = body.split(/\n(?=### )/g).filter(b => b.trim().startsWith('### '));

  const questions = [];
  const unparsed = [];

  for (const block of blocks) {
    const headerMatch = block.match(/^### (Q-\d{8}-\d{2,})\s*[—\-–]\s*(.+?)$/m);
    if (!headerMatch) { unparsed.push(block); continue; }

    const id = headerMatch[1].trim();
    const title = headerMatch[2].trim();

    const raised  = extractField(block, 'Raised');
    const source  = extractField(block, 'Source');
    const related = extractField(block, 'Related');
    const question = extractField(block, 'Question');
    const status   = extractField(block, 'Status');
    const answer   = extractField(block, 'Answer');

    let statusValue = (status?.value || 'Open').trim();
    // Some entries spelled it as `Answered (2026-04-28)` with the date inside the value
    // (rather than in `**Status (2026-04-28):**`). Normalize either form.
    let statusDate = status?.paren || null;
    const inlineDate = statusValue.match(/^(Open|Answered|Dismissed)\s*(?:\(([^)]+)\))?\s*$/i);
    if (inlineDate) {
      statusValue = inlineDate[1];
      if (!statusDate && inlineDate[2]) statusDate = inlineDate[2].trim();
    }
    // Capitalize properly + fall back to Open if unrecognized.
    const normStatus = QUESTION_STATUSES.find(s => s.toLowerCase() === statusValue.toLowerCase()) || 'Open';

    questions.push({
      id,
      title,
      raised: raised?.value || '',
      source: source?.value || '',
      related: related?.value || '',
      question: question?.value || '',
      status: normStatus,
      statusDate,
      answer: answer?.value || null,
    });
  }

  return { prefix: prefix || DEFAULT_QUESTIONS_PREFIX, questions, unparsed };
}

function serializeQuestion(q) {
  const lines = [`### ${q.id} — ${q.title}`];
  if (q.raised)  lines.push(`- **Raised:** ${q.raised}`);
  if (q.source)  lines.push(`- **Source:** ${q.source}`);
  if (q.related) lines.push(`- **Related:** ${q.related}`);
  if (q.question) lines.push(`- **Question:** ${q.question}`);
  const statusLabel = q.statusDate ? `**Status (${q.statusDate}):**` : `**Status:**`;
  lines.push(`- ${statusLabel} ${q.status}`);
  if (q.answer)  lines.push(`- **Answer:** ${q.answer}`);
  return lines.join('\n');
}

function serializeQuestions(prefix, questions) {
  // Group by status, then sort each group by `raised` desc (newest first).
  const groups = { Open: [], Answered: [], Dismissed: [] };
  for (const q of questions) {
    (groups[q.status] || groups.Open).push(q);
  }
  for (const k of Object.keys(groups)) {
    groups[k].sort((a, b) => (b.raised || '').localeCompare(a.raised || ''));
  }

  const sections = [];
  const sectionMap = [
    ['Open', '## Open'],
    ['Answered', '## Answered'],
    ['Dismissed', '## Dismissed'],
  ];
  for (const [key, header] of sectionMap) {
    if (groups[key].length === 0) continue;
    sections.push(header + '\n\n' + groups[key].map(serializeQuestion).join('\n\n') + '\n');
  }

  // Ensure prefix ends with a blank line + separator. If user's existing prefix already
  // ends with content (no trailing newline), add one.
  let p = prefix;
  if (!p.endsWith('\n')) p += '\n';
  if (!p.endsWith('\n\n')) p += '\n';

  return p + sections.join('\n');
}

function nextQuestionId(today, existingQuestions) {
  // today is YYYY-MM-DD; convert to YYYYMMDD.
  const datePart = today.replace(/-/g, '');
  const prefix = `Q-${datePart}-`;
  let max = 0;
  for (const q of existingQuestions) {
    if (q.id && q.id.startsWith(prefix)) {
      const n = parseInt(q.id.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  const next = String(max + 1).padStart(2, '0');
  return prefix + next;
}

function readQuestionsFile() {
  if (!fs.existsSync(QUESTIONS_FILE)) {
    return { prefix: DEFAULT_QUESTIONS_PREFIX, questions: [], unparsed: [] };
  }
  const raw = fs.readFileSync(QUESTIONS_FILE, 'utf8');
  return parseQuestions(raw);
}

function writeQuestionsFile(prefix, questions) {
  const out = serializeQuestions(prefix, questions);
  fs.writeFileSync(QUESTIONS_FILE, out, 'utf8');
}

// GET /api/questions — return all parsed questions plus prefix + any unparseable raw blocks.
app.get('/api/questions', (req, res) => {
  res.json(readQuestionsFile());
});

// POST /api/questions — create a new Open question.
// Body: { title, question, source?, related? }
app.post('/api/questions', (req, res) => {
  const { title, question, source, related } = req.body || {};
  if (!title || !question) {
    return res.status(400).json({ error: 'title and question are required' });
  }
  const today = todayStr();
  const { prefix, questions } = readQuestionsFile();
  const newQ = {
    id: nextQuestionId(today, questions),
    title: title.trim(),
    raised: today,
    source: (source || '').trim(),
    related: (related || '').trim(),
    question: question.trim(),
    status: 'Open',
    statusDate: null,
    answer: null,
  };
  questions.push(newQ);
  writeQuestionsFile(prefix, questions);
  res.json(newQ);
});

// PUT /api/questions/:id — partial update.
// Body: subset of { title, question, source, related, status, answer, statusDate }
app.put('/api/questions/:id', (req, res) => {
  const { id } = req.params;
  const { prefix, questions } = readQuestionsFile();
  const idx = questions.findIndex(q => q.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });

  const allowed = ['title', 'question', 'source', 'related', 'status', 'answer', 'statusDate'];
  const patch = {};
  for (const k of allowed) {
    if (k in (req.body || {})) patch[k] = req.body[k];
  }

  // Validate status if present.
  if ('status' in patch && !QUESTION_STATUSES.includes(patch.status)) {
    return res.status(400).json({ error: `status must be one of ${QUESTION_STATUSES.join(', ')}` });
  }

  // If client clears the answer, normalize empty string → null so the field is omitted.
  if ('answer' in patch && (patch.answer == null || patch.answer === '')) patch.answer = null;

  questions[idx] = { ...questions[idx], ...patch };
  writeQuestionsFile(prefix, questions);
  res.json(questions[idx]);
});

// --- Search API ---
// Supports ?source= filter: wiki (default), organized, daily, task, all

app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json([]);
  const source = (req.query.source || 'wiki').toLowerCase();

  const terms = q.split(/\s+/);
  const results = [];

  // Search wiki pages
  if (source === 'wiki' || source === 'all') {
    function searchWiki(dir, prefix) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          searchWiki(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
        } else if (entry.name.endsWith('.md')) {
          const slug = prefix ? `${prefix}/${entry.name.replace('.md', '')}` : entry.name.replace('.md', '');
          const content = fs.readFileSync(path.join(dir, entry.name), 'utf8');
          const lower = content.toLowerCase();
          if (terms.every(t => lower.includes(t))) {
            const lines = content.split('\n');
            const title = extractTitle(content, slug);
            const matches = lines.filter(l => terms.some(t => l.toLowerCase().includes(t)));
            results.push({
              type: 'wiki',
              slug,
              title,
              snippets: matches.slice(0, 5),
              relevance: terms.reduce((acc, t) => acc + (lower.split(t).length - 1), 0)
            });
          }
        }
      }
    }
    searchWiki(WIKI_DIR, '');
  }

  // Search organized logs
  if (source === 'organized' || source === 'all') {
    const orgFiles = fs.readdirSync(ORGANIZED_DIR).filter(f => f.endsWith('.md'));
    for (const file of orgFiles) {
      const date = file.replace('.md', '');
      const content = fs.readFileSync(path.join(ORGANIZED_DIR, file), 'utf8');
      const lower = content.toLowerCase();
      if (terms.every(t => lower.includes(t))) {
        const lines = content.split('\n');
        const matches = lines.filter(l => terms.some(t => l.toLowerCase().includes(t)));
        results.push({
          type: 'organized',
          date,
          snippets: matches.slice(0, 5),
          relevance: terms.reduce((acc, t) => acc + (lower.split(t).length - 1), 0)
        });
      }
    }
  }

  // Search daily logs
  if (source === 'daily' || source === 'all') {
    const dailyFiles = fs.readdirSync(DAILY_DIR).filter(f => f.endsWith('.md'));
    for (const file of dailyFiles) {
      const date = file.replace('.md', '');
      const content = fs.readFileSync(path.join(DAILY_DIR, file), 'utf8');
      const lower = content.toLowerCase();
      if (terms.every(t => lower.includes(t))) {
        const lines = content.split('\n');
        const matches = lines.filter(l => terms.some(t => l.toLowerCase().includes(t)));
        results.push({
          type: 'daily',
          date,
          snippets: matches.slice(0, 5),
          relevance: terms.reduce((acc, t) => acc + (lower.split(t).length - 1), 0)
        });
      }
    }
  }

  // Search tasks
  if (source === 'task' || source === 'all') {
    const tasksData = readJSON(TASKS_FILE, { tasks: [] });
    for (const task of tasksData.tasks) {
      const text = `${task.title} ${task.description || ''} ${(task.tags || []).join(' ')}`.toLowerCase();
      if (terms.every(t => text.includes(t))) {
        results.push({
          type: 'task',
          task,
          relevance: terms.reduce((acc, t) => acc + (text.split(t).length - 1), 0)
        });
      }
    }
  }

  results.sort((a, b) => b.relevance - a.relevance);
  res.json(results);
});

// --- Tasks / Kanban API ---

app.get('/api/tasks', (req, res) => {
  const data = readJSON(TASKS_FILE, { tasks: [], nextId: 1 });
  if (backfillOrders(data)) writeJSON(TASKS_FILE, data);
  res.json(data.tasks);
});

app.post('/api/tasks', (req, res) => {
  const data = readJSON(TASKS_FILE, { tasks: [], nextId: 1 });
  // Guard against stale/duplicated nextId: take max(nextId, maxExistingId+1).
  const maxExisting = data.tasks.reduce((m, t) => t.id > m ? t.id : m, 0);
  if (data.nextId <= maxExisting) data.nextId = maxExisting + 1;
  const column = req.body.column || 'inbox';
  const maxOrder = data.tasks
    .filter(t => t.column === column)
    .reduce((m, t) => (t.order ?? -1) > m ? (t.order ?? -1) : m, -1);
  const task = {
    id: data.nextId++,
    title: req.body.title || 'Untitled',
    description: req.body.description || '',
    column,
    priority: req.body.priority || 0,  // 1-3 for top-3 today, 0 for unprioritized
    tags: req.body.tags || [],
    sourceDate: req.body.sourceDate || todayStr(),
    order: maxOrder + 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  data.tasks.push(task);
  writeJSON(TASKS_FILE, data);
  res.json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const data = readJSON(TASKS_FILE, { tasks: [], nextId: 1 });
  backfillOrders(data);
  const id = parseInt(req.params.id);
  const idx = data.tasks.findIndex(t => t.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });

  const updates = req.body;
  // If setting a priority 1-3, clear that priority from other tasks first
  if (updates.priority && updates.priority >= 1 && updates.priority <= 3) {
    data.tasks.forEach(t => {
      if (t.priority === updates.priority && t.id !== id) {
        t.priority = 0;
      }
    });
  }

  const oldColumn = data.tasks[idx].column;
  Object.assign(data.tasks[idx], updates, { updatedAt: new Date().toISOString() });
  // If column changed via this endpoint (e.g. modal dropdown), place at end of new column
  // and renumber the old one.
  if (updates.column && updates.column !== oldColumn) {
    const maxOrder = data.tasks
      .filter(t => t.column === updates.column && t.id !== id)
      .reduce((m, t) => (t.order ?? -1) > m ? (t.order ?? -1) : m, -1);
    data.tasks[idx].order = maxOrder + 1;
    renumberColumn(data, oldColumn);
  }
  writeJSON(TASKS_FILE, data);
  res.json(data.tasks[idx]);
});

// Move a task to a specific position within a (possibly different) column.
// Body: { column, index } — index is 0-based insertion position.
app.put('/api/tasks/:id/move', (req, res) => {
  const data = readJSON(TASKS_FILE, { tasks: [], nextId: 1 });
  backfillOrders(data);
  const id = parseInt(req.params.id);
  const task = data.tasks.find(t => t.id === id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { column, index } = req.body;
  if (typeof column !== 'string' || typeof index !== 'number') {
    return res.status(400).json({ error: 'column (string) and index (number) required' });
  }
  const sourceColumn = task.column;
  const target = data.tasks
    .filter(t => t.column === column && t.id !== id)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const insertAt = Math.max(0, Math.min(index, target.length));
  target.splice(insertAt, 0, task);
  task.column = column;
  task.updatedAt = new Date().toISOString();
  target.forEach((t, i) => { t.order = i; });
  if (sourceColumn !== column) renumberColumn(data, sourceColumn);
  writeJSON(TASKS_FILE, data);
  res.json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  const data = readJSON(TASKS_FILE, { tasks: [], nextId: 1 });
  data.tasks = data.tasks.filter(t => t.id !== parseInt(req.params.id));
  writeJSON(TASKS_FILE, data);
  res.json({ ok: true });
});

// --- Action item extraction endpoint (used by canvas) ---

app.post('/api/extract-actions', (req, res) => {
  const { content, date } = req.body;
  const lines = content.split('\n');
  const actions = [];

  // Match lines that look like action items
  const patterns = [
    /^\s*[-*]\s*\[[ ]\]\s*(.+)/,          // - [ ] task
    /^\s*(?:TODO|ACTION|TASK|AI):\s*(.+)/i, // TODO: task / ACTION: task / AI: action item
    /^\s*[-*]\s*(?:TODO|ACTION|TASK|AI):\s*(.+)/i, // - TODO: task
    /^\s*>\s*(?:TODO|ACTION|TASK|AI):\s*(.+)/i,     // > TODO: task
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        const rawText = match[1].trim();
        // Parse optional [Name] prefix: - [ ] [Jane Doe] Do the thing
        const nameMatch = rawText.match(/^\[([^\]]+)\]\s*(.+)/);
        if (nameMatch) {
          actions.push({
            title: nameMatch[2].trim(),
            assignee: nameMatch[1].trim(),
            sourceDate: date || todayStr()
          });
        } else {
          actions.push({
            title: rawText,
            assignee: null,
            sourceDate: date || todayStr()
          });
        }
        break;
      }
    }
  }

  res.json(actions);
});

// --- Chat API ---
//
// Streams a reply from the local `claude` CLI. Context is retrieved by keyword
// match against the wiki, then any YYYY-MM-DD dates found inside those matched
// pages also pull in the corresponding `organized/<date>.md` log.

const CHAT_STOP_WORDS = new Set([
  'the','a','an','and','or','but','if','of','to','in','on','for','with','at',
  'by','from','as','is','are','was','were','be','been','being','do','does',
  'did','have','has','had','i','you','it','that','this','what','which','who',
  'how','why','when','where','about','my','me','we','our'
]);

function chatExtractTerms(message) {
  return [...new Set(
    (message || '')
      .toLowerCase()
      .split(/[^a-z0-9_\-]+/)
      .filter(t => t.length >= 3 && !CHAT_STOP_WORDS.has(t))
  )];
}

function chatScoreWiki(terms, limit = 5, perPageCap = 4000) {
  const scored = [];
  function walk(dir, prefix) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.name.endsWith('.md')) {
        const slug = prefix ? `${prefix}/${entry.name.replace('.md', '')}` : entry.name.replace('.md', '');
        const content = fs.readFileSync(path.join(dir, entry.name), 'utf8');
        const lower = content.toLowerCase();
        let score = 0;
        for (const t of terms) score += (lower.split(t).length - 1);
        // Slug match gets a boost so e.g. asking about "live-adjudication" surfaces that page even if its body never repeats the term.
        for (const t of terms) if (slug.toLowerCase().includes(t)) score += 5;
        if (score > 0) {
          scored.push({
            slug,
            score,
            content: content.length > perPageCap ? content.slice(0, perPageCap) + '\n…[truncated]' : content,
          });
        }
      }
    }
  }
  walk(WIKI_DIR, '');
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function chatCollectDates(pages) {
  const dates = new Set();
  const re = /\b(20\d{2}-\d{2}-\d{2})\b/g;
  for (const p of pages) {
    let m;
    while ((m = re.exec(p.content)) !== null) dates.add(m[1]);
  }
  return [...dates];
}

// Parse dates the user mentioned in their message. Handles ISO (2026-05-14),
// relative words (today/yesterday/tomorrow), and "Month D [YYYY]" forms.
const MONTHS = {
  january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,
  september:9,october:10,november:11,december:12,
  jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12,
};
function pad2(n) { return n < 10 ? `0${n}` : `${n}`; }
function fmtDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }

function chatExtractDatesFromMessage(message, now = new Date()) {
  const out = new Set();
  const m = (message || '').toLowerCase();

  for (const iso of m.match(/\b20\d{2}-\d{2}-\d{2}\b/g) || []) out.add(iso);

  if (/\btoday\b/.test(m)) out.add(fmtDate(now));
  if (/\byesterday\b/.test(m)) {
    const d = new Date(now); d.setDate(d.getDate() - 1); out.add(fmtDate(d));
  }
  if (/\btomorrow\b/.test(m)) {
    const d = new Date(now); d.setDate(d.getDate() + 1); out.add(fmtDate(d));
  }

  const monthRe = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:(?:st|nd|rd|th))?(?:,?\s+(\d{4}))?\b/g;
  let mm;
  while ((mm = monthRe.exec(m)) !== null) {
    const month = MONTHS[mm[1]];
    const day = parseInt(mm[2], 10);
    let year = mm[3] ? parseInt(mm[3], 10) : now.getFullYear();
    if (!month || day < 1 || day > 31) continue;
    // If the inferred date is far in the future, assume they meant last year.
    let candidate = new Date(year, month - 1, day);
    if (!mm[3] && candidate.getTime() - now.getTime() > 1000 * 60 * 60 * 24 * 60) {
      candidate = new Date(year - 1, month - 1, day);
    }
    out.add(fmtDate(candidate));
  }

  return [...out];
}

// Find wiki slugs the user explicitly named: [[slug]] links, or any token that
// matches an actual wiki file path. Returns slugs that exist on disk.
function chatExtractSlugsFromMessage(message) {
  const found = new Set();
  if (!message) return [];

  for (const m of message.matchAll(/\[\[([^\]]+)\]\]/g)) {
    found.add(m[1].trim().replace(/^\/+|\/+$/g, ''));
  }
  for (const m of message.matchAll(/\b([a-z0-9_-]+(?:\/[a-z0-9_-]+)+)\b/gi)) {
    found.add(m[1]);
  }

  const valid = [];
  for (const slug of found) {
    const file = path.join(WIKI_DIR, `${slug}.md`);
    if (fs.existsSync(file) && file.startsWith(WIKI_DIR)) valid.push(slug);
  }
  return valid;
}

function chatLoadOrganized(dates, perFileCap = 4000, limit = 5) {
  const logs = [];
  for (const date of dates) {
    if (logs.length >= limit) break;
    const file = path.join(ORGANIZED_DIR, `${date}.md`);
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    logs.push({
      date,
      content: content.length > perFileCap ? content.slice(0, perFileCap) + '\n…[truncated]' : content,
    });
  }
  return logs;
}

// Load files the user explicitly named. Tries both organized/ and daily/ for
// each date, and loads each requested wiki slug. Higher per-file cap since
// these are the files the user actually asked about.
function chatLoadRequested(dates, slugs, perFileCap = 12000) {
  const items = [];
  for (const date of dates) {
    for (const [label, dir] of [[`organized log ${date}`, ORGANIZED_DIR], [`daily canvas ${date}`, DAILY_DIR]]) {
      const file = path.join(dir, `${date}.md`);
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, 'utf8');
      items.push({
        label,
        kind: dir === ORGANIZED_DIR ? 'organized' : 'daily',
        date,
        content: content.length > perFileCap ? content.slice(0, perFileCap) + '\n…[truncated]' : content,
      });
    }
  }
  for (const slug of slugs) {
    const file = path.join(WIKI_DIR, `${slug}.md`);
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    items.push({
      label: `wiki ${slug}`,
      kind: 'wiki',
      slug,
      content: content.length > perFileCap ? content.slice(0, perFileCap) + '\n…[truncated]' : content,
    });
  }
  return items;
}

// Report dates/slugs the user named but for which no file was found, so the
// model can confidently say "that date/file doesn't exist" instead of "I don't
// have it in my context."
function chatFindMissing(dates, slugs) {
  const missing = [];
  for (const date of dates) {
    const org = fs.existsSync(path.join(ORGANIZED_DIR, `${date}.md`));
    const dly = fs.existsSync(path.join(DAILY_DIR, `${date}.md`));
    if (!org && !dly) missing.push(`no notes exist for ${date}`);
  }
  for (const slug of slugs) {
    if (!fs.existsSync(path.join(WIKI_DIR, `${slug}.md`))) {
      missing.push(`wiki page ${slug} does not exist`);
    }
  }
  return missing;
}

function chatBuildPrompt(message, history, pages, logs, requested, missing) {
  const parts = [];
  parts.push(
    "You are a personal knowledge assistant for the user's notes. Answer the question using ONLY the wiki pages and daily logs provided below as context. If the context does not contain the answer, say so plainly rather than guessing. When you reference a fact, cite the wiki slug or log date in parentheses, e.g. (projects/some-project) or (log 2026-05-14). If the user named a specific date or file and the USER-REQUESTED CONTEXT section below either contains it or notes it as missing, trust that — do not say you lack context for it."
  );

  if (requested && requested.length) {
    parts.push('\n=== USER-REQUESTED CONTEXT ===');
    parts.push('(The user explicitly named these dates/files in their message. These were loaded directly from disk.)');
    for (const r of requested) parts.push(`\n## ${r.label}\n${r.content}`);
  }

  if (missing && missing.length) {
    parts.push('\n=== USER-REQUESTED ITEMS NOT FOUND ON DISK ===');
    for (const m of missing) parts.push(`- ${m}`);
  }

  if (pages.length) {
    parts.push('\n=== WIKI CONTEXT (keyword-matched) ===');
    for (const p of pages) parts.push(`\n## ${p.slug}\n${p.content}`);
  } else if (!requested || !requested.length) {
    parts.push('\n=== WIKI CONTEXT ===\n(no wiki pages matched this query)');
  }

  if (logs.length) {
    parts.push('\n=== ORGANIZED DAILY LOGS (from wiki cross-references) ===');
    for (const l of logs) parts.push(`\n## ${l.date}\n${l.content}`);
  }

  if (Array.isArray(history) && history.length) {
    parts.push('\n=== PRIOR CONVERSATION ===');
    for (const turn of history) {
      const role = turn.role === 'assistant' ? 'Assistant' : 'User';
      parts.push(`\n${role}: ${turn.content}`);
    }
  }

  parts.push(`\n=== QUESTION ===\n${message}`);
  return parts.join('\n');
}

function chatFindClaudeBin() {
  const home = require('os').homedir();
  const candidates = [
    process.env.CLAUDE_BIN,
    path.join(home, '.local/bin/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return 'claude';
}

app.post('/api/chat', (req, res) => {
  const { message, history } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  const terms = chatExtractTerms(message);
  const pages = terms.length ? chatScoreWiki(terms) : [];
  const dates = chatCollectDates(pages);
  const logs = chatLoadOrganized(dates);

  const requestedDates = chatExtractDatesFromMessage(message);
  const requestedSlugs = chatExtractSlugsFromMessage(message);
  const requested = chatLoadRequested(requestedDates, requestedSlugs);
  const missing = chatFindMissing(requestedDates, requestedSlugs);

  const prompt = chatBuildPrompt(message, history, pages, logs, requested, missing);

  const bin = chatFindClaudeBin();
  // --bare would skip hooks/plugins/auto-memory but requires ANTHROPIC_API_KEY
  // (OAuth/keychain auth is not honored in --bare mode). The user runs claude
  // via OAuth login, so we use plain -p and just disable tools — the answer
  // must come from the embedded wiki context, not from filesystem/web tools.
  const args = ['-p', '--allowedTools', ''];

  let child;
  try {
    console.log('[chat] spawning', bin, args.join(' '));
    child = spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Electron strips PATH; the CLI needs a normal env to find its own files.
      env: { ...process.env, PATH: process.env.PATH || '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin' },
    });
  } catch (err) {
    console.error('[chat] spawn failed:', err);
    return res.status(500).json({ error: `failed to spawn claude CLI: ${err.message}` });
  }

  // Send context list first as a JSON header line so the frontend can render
  // which pages/logs were used, then stream model text after the marker.
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Accel-Buffering', 'no');
  res.write('__CONTEXT__' + JSON.stringify({
    pages: pages.map(p => ({ slug: p.slug, score: p.score })),
    logs: logs.map(l => ({ date: l.date })),
    requested: requested.map(r => ({ label: r.label, kind: r.kind })),
    missing,
  }) + '\n__REPLY__\n');

  let stdoutBytes = 0;
  child.stdout.on('data', chunk => { stdoutBytes += chunk.length; res.write(chunk); });
  let stderrBuf = '';
  child.stderr.on('data', chunk => {
    const s = chunk.toString();
    stderrBuf += s;
    console.error('[chat stderr]', s);
  });
  child.on('error', err => {
    console.error('[chat] child error:', err);
    res.write(`\n\n[error spawning claude: ${err.message}]`);
    res.end();
  });
  child.on('close', code => {
    console.log(`[chat] child exited code=${code} stdout=${stdoutBytes}B stderr=${stderrBuf.length}B`);
    if (stdoutBytes === 0) {
      const msg = stderrBuf.trim() || `claude produced no output (exit ${code})`;
      res.write(`\n\n[claude error: ${msg.slice(-500)}]`);
    } else if (code !== 0 && stderrBuf) {
      res.write(`\n\n[claude exited ${code}: ${stderrBuf.trim().slice(-500)}]`);
    }
    res.end();
  });
  // `req.on('close')` is unreliable under Express — it fires as soon as the
  // body is consumed even though the socket is still open. Use 'aborted' so we
  // only kill the child if the client really disconnected mid-stream.
  req.on('aborted', () => {
    if (!child.killed) child.kill();
  });

  child.stdin.write(prompt);
  child.stdin.end();
});

// --- Start ---

module.exports = app.listen(PORT, () => {
  console.log(`\n  Daily Productivity running at http://localhost:${PORT}\n`);
});
