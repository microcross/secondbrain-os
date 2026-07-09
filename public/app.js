// --- State ---
let currentCanvasDate = todayStr();
let canvasContent = '';
let saveTimer = null;
let editingTaskId = null;
let tasks = [];

const COLUMNS = [
  { id: 'inbox', label: 'Inbox', cls: '' },
  { id: 'backlog', label: 'Backlog', cls: '' },
  { id: 'this-week', label: 'This Week', cls: '' },
  { id: 'today', label: 'Today', cls: 'today-col' },
  { id: 'waiting', label: 'Waiting', cls: 'waiting-col' },
  { id: 'done', label: 'Done', cls: '' },
];

// Per-column sort mode. One of: 'custom' (user drag order), 'desc' (date newest first), 'asc'.
// Default: 'desc'. Dropping a card auto-switches that column to 'custom' so the drop sticks.
const SORT_STORAGE_KEY = 'kanban.columnSorts.v1';
const SORT_CYCLE = { custom: 'desc', desc: 'asc', asc: 'custom' };
const SORT_GLYPH = { custom: '≡', desc: '▼', asc: '▲' };
const SORT_LABEL = {
  custom: 'Custom order — click for newest first',
  desc: 'Newest first — click for oldest first',
  asc: 'Oldest first — click for custom order',
};
const columnSorts = loadColumnSorts();

function loadColumnSorts() {
  const defaults = Object.fromEntries(COLUMNS.map(c => [c.id, 'desc']));
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) || '{}');
    // Coerce any legacy values that aren't in the new mode set.
    const merged = { ...defaults, ...saved };
    for (const k of Object.keys(merged)) {
      if (!(merged[k] in SORT_CYCLE)) merged[k] = 'desc';
    }
    return merged;
  } catch {
    return defaults;
  }
}

function saveColumnSorts() {
  try { localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(columnSorts)); } catch {}
}

// Compare tasks by date (sourceDate first, fallback to createdAt). Direction: 'desc' or 'asc'.
function compareTasksByDate(a, b, direction) {
  const ad = a.sourceDate || (a.createdAt ? a.createdAt.slice(0, 10) : '');
  const bd = b.sourceDate || (b.createdAt ? b.createdAt.slice(0, 10) : '');
  if (ad === bd) return 0;
  if (!ad) return 1;   // missing dates fall to bottom
  if (!bd) return -1;
  const cmp = ad < bd ? -1 : 1;
  return direction === 'desc' ? -cmp : cmp;
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  setupNav();
  loadCanvas(todayStr());
  loadTasks();
  setupSearch();
  setupSearchFilters();
  setupCanvasNav();
  document.getElementById('date-display').textContent = formatDate(todayStr());
  document.getElementById('btn-extract-actions').addEventListener('click', extractActions);
  document.getElementById('btn-add-task').addEventListener('click', () => openTaskModal());
  document.getElementById('btn-new-question').addEventListener('click', () => openQuestionModal());
  document.getElementById('btn-refresh-questions').addEventListener('click', () => loadQuestions());
  setupChat();
});

// --- Helpers ---
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// --- Navigation ---
function setupNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById('view-' + btn.dataset.view).classList.add('active');
      if (btn.dataset.view === 'kanban') loadTasks();
      if (btn.dataset.view === 'wiki') loadWikiIndex();
      if (btn.dataset.view === 'questions') loadQuestions();
      if (btn.dataset.view === 'chat') setTimeout(() => document.getElementById('chat-input')?.focus(), 0);
    });
  });
}

// --- Canvas ---
function setupCanvasNav() {
  document.getElementById('canvas-prev').addEventListener('click', () => {
    loadCanvas(shiftDate(currentCanvasDate, -1));
  });
  document.getElementById('canvas-next').addEventListener('click', () => {
    loadCanvas(shiftDate(currentCanvasDate, 1));
  });
  document.getElementById('canvas-today').addEventListener('click', () => {
    loadCanvas(todayStr());
  });
}

let canvasOrgContent = '';

async function loadCanvas(date) {
  currentCanvasDate = date;
  const isToday = date === todayStr();

  const [canvasRes, orgRes] = await Promise.all([
    fetch(`/api/canvas/${date}`),
    isToday ? Promise.resolve(null) : fetch(`/api/organized/${date}`)
  ]);

  const data = await canvasRes.json();
  const orgData = orgRes ? await orgRes.json() : { exists: false };

  const editor = document.getElementById('canvas-editor');
  const orgViewer = document.getElementById('canvas-org-viewer');
  const tabsEl = document.getElementById('canvas-tabs');

  if (data.exists) {
    editor.value = data.content;
  } else {
    editor.value = `(No log for ${date})`;
  }
  canvasContent = editor.value;
  canvasOrgContent = orgData.exists ? orgData.content : '';

  document.getElementById('canvas-title').textContent = isToday ? "Today's Canvas" : `Canvas — ${date}`;

  // Show/hide organized tab
  if (!isToday && orgData.exists) {
    tabsEl.style.display = 'flex';
  } else {
    tabsEl.style.display = 'none';
    // Always reset to raw view when switching days
    editor.style.display = '';
    orgViewer.style.display = 'none';
    document.getElementById('canvas-tab-raw').classList.add('active');
    document.getElementById('canvas-tab-org').classList.remove('active');
  }

  editor.readOnly = !isToday;

  if (isToday) {
    editor.removeEventListener('input', handleCanvasInput);
    editor.addEventListener('input', handleCanvasInput);
  }

  updateSaveStatus('');
}

function switchCanvasTab(tab) {
  const editor = document.getElementById('canvas-editor');
  const orgViewer = document.getElementById('canvas-org-viewer');
  const orgEditor = document.getElementById('canvas-org-editor');
  const btnEdit = document.getElementById('btn-org-edit');
  const btnSave = document.getElementById('btn-org-save');
  const orgStatus = document.getElementById('org-save-status');
  document.getElementById('canvas-tab-raw').classList.toggle('active', tab === 'raw');
  document.getElementById('canvas-tab-org').classList.toggle('active', tab === 'org');

  if (tab === 'org') {
    editor.style.display = 'none';
    // Always start in rendered view when switching to org tab
    orgEditor.style.display = 'none';
    orgViewer.style.display = 'block';
    orgViewer.innerHTML = canvasOrgContent
      ? marked.parse(canvasOrgContent)
      : '<em style="color:var(--text-dim)">(No organized notes for this day)</em>';
    btnEdit.style.display = '';
    btnSave.style.display = 'none';
    orgStatus.textContent = '';
  } else {
    editor.style.display = '';
    orgViewer.style.display = 'none';
    orgEditor.style.display = 'none';
    btnEdit.style.display = 'none';
    btnSave.style.display = 'none';
    orgStatus.textContent = '';
  }
}

function toggleOrgEdit() {
  const orgViewer = document.getElementById('canvas-org-viewer');
  const orgEditor = document.getElementById('canvas-org-editor');
  const btnEdit = document.getElementById('btn-org-edit');
  const btnSave = document.getElementById('btn-org-save');
  const isEditing = orgEditor.style.display !== 'none';

  if (isEditing) {
    // Switch back to rendered view without saving
    orgEditor.style.display = 'none';
    orgViewer.style.display = 'block';
    orgViewer.innerHTML = canvasOrgContent
      ? marked.parse(canvasOrgContent)
      : '<em style="color:var(--text-dim)">(No organized notes for this day)</em>';
    btnEdit.textContent = 'Edit';
    btnSave.style.display = 'none';
  } else {
    // Switch to edit mode
    orgViewer.style.display = 'none';
    orgEditor.value = canvasOrgContent;
    orgEditor.style.display = '';
    btnEdit.textContent = 'Cancel';
    btnSave.style.display = '';
  }
}

async function saveOrgNotes() {
  const orgEditor = document.getElementById('canvas-org-editor');
  const orgViewer = document.getElementById('canvas-org-viewer');
  const btnEdit = document.getElementById('btn-org-edit');
  const btnSave = document.getElementById('btn-org-save');
  const orgStatus = document.getElementById('org-save-status');

  const newContent = orgEditor.value;
  orgStatus.textContent = 'Saving…';

  try {
    const res = await fetch(`/api/organized/${currentCanvasDate}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newContent })
    });
    if (!res.ok) throw new Error('Save failed');

    canvasOrgContent = newContent;
    orgEditor.style.display = 'none';
    orgViewer.style.display = 'block';
    orgViewer.innerHTML = marked.parse(canvasOrgContent);
    btnEdit.textContent = 'Edit';
    btnSave.style.display = 'none';
    orgStatus.textContent = 'Saved';
    setTimeout(() => { orgStatus.textContent = ''; }, 2000);
  } catch (e) {
    orgStatus.textContent = 'Save failed';
  }
}

function handleCanvasInput() {
  updateSaveStatus('Unsaved...');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCanvas, 1000);
}

async function saveCanvas() {
  const editor = document.getElementById('canvas-editor');
  await fetch(`/api/canvas/${currentCanvasDate}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: editor.value })
  });
  canvasContent = editor.value;
  updateSaveStatus('Saved');
  setTimeout(() => updateSaveStatus(''), 2000);
}

function updateSaveStatus(text) {
  const el = document.getElementById('save-status');
  el.textContent = text;
  el.className = text === 'Saved' ? 'status saved' : 'status';
}

function insertTemplate(type) {
  const editor = document.getElementById('canvas-editor');
  const templates = {
    action: '\n- [ ] ',
    meeting: '\n## Meeting: \n**Attendees:** \n**Notes:**\n- \n**Action Items:**\n- [ ] ',
    decision: '\nDECISION: ',
    note: '\nNOTE: '
  };
  const pos = editor.selectionStart;
  const text = templates[type] || '\n';
  editor.value = editor.value.slice(0, pos) + text + editor.value.slice(pos);
  editor.selectionStart = editor.selectionEnd = pos + text.length;
  editor.focus();
  handleCanvasInput();
}

// Name variants that all refer to you. Add any nicknames/aliases you use for
// yourself in the canvas or action items (e.g. your first name, initials).
const MY_NAMES = ['me'];

function isMyTask(assignee) {
  if (!assignee) return true; // no name = treat as mine
  return MY_NAMES.includes(assignee.toLowerCase().trim());
}

async function extractActions() {
  const editor = document.getElementById('canvas-editor');
  const res = await fetch('/api/extract-actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: editor.value, date: currentCanvasDate })
  });
  const actions = await res.json();

  if (actions.length === 0) {
    alert('No action items found. Use formats like:\n  - [ ] Task\n  TODO: Task\n  ACTION: Task');
    return;
  }

  let createdInbox = 0;
  let createdWaiting = 0;
  let skipped = 0;

  for (const action of actions) {
    const mine = isMyTask(action.assignee);
    const column = mine ? 'inbox' : 'waiting';

    // Skip if a task with the same title already exists anywhere
    const existing = tasks.find(t => t.title.toLowerCase() === action.title.toLowerCase());
    if (existing) { skipped++; continue; }

    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: action.title,
        column,
        sourceDate: action.sourceDate
      })
    });
    if (mine) createdInbox++; else createdWaiting++;
  }

  const parts = [];
  if (createdInbox) parts.push(`${createdInbox} added to Inbox`);
  if (createdWaiting) parts.push(`${createdWaiting} added to Waiting`);
  if (skipped) parts.push(`${skipped} duplicate${skipped > 1 ? 's' : ''} skipped`);
  alert(parts.length ? parts.join(', ') + '.' : 'No new tasks created.');
  loadTasks();
}

// --- Kanban ---
async function loadTasks() {
  const res = await fetch('/api/tasks');
  tasks = await res.json();
  renderBoard();
}

function renderBoard() {
  const board = document.getElementById('kanban-board');
  board.innerHTML = '';

  for (const col of COLUMNS) {
    const colTasks = tasks.filter(t => t.column === col.id);
    const mode = columnSorts[col.id] || 'desc';

    // Custom: pure user-defined order. Today column under date sort still pins P1/P2/P3.
    if (mode === 'custom') {
      colTasks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    } else if (col.id === 'today') {
      colTasks.sort((a, b) => {
        const aHas = a.priority > 0;
        const bHas = b.priority > 0;
        if (aHas && bHas && a.priority !== b.priority) return a.priority - b.priority;
        if (aHas && !bHas) return -1;
        if (bHas && !aHas) return 1;
        return compareTasksByDate(a, b, mode);
      });
    } else {
      colTasks.sort((a, b) => compareTasksByDate(a, b, mode));
    }

    const colEl = document.createElement('div');
    colEl.className = `kanban-column ${col.cls}`;
    colEl.dataset.column = col.id;

    const arrow = SORT_GLYPH[mode];
    const sortLabel = SORT_LABEL[mode];

    colEl.innerHTML = `
      <div class="col-header">
        <span class="col-title">${col.label}</span>
        <span class="col-count">${colTasks.length}</span>
        <button class="col-sort" data-column="${col.id}" title="${sortLabel}" aria-label="${sortLabel}">${arrow}</button>
      </div>
      <div class="col-cards" data-column="${col.id}"></div>
      <div class="col-add">
        <button onclick="openTaskModal(null, '${col.id}')">+ Add</button>
      </div>
    `;

    colEl.querySelector('.col-sort').addEventListener('click', () => {
      columnSorts[col.id] = SORT_CYCLE[mode];
      saveColumnSorts();
      renderBoard();
    });

    const cardsEl = colEl.querySelector('.col-cards');

    // Drag & drop with positional insertion. We compute the insertion index from the
    // mouse Y vs. each card's midpoint, render a placeholder line, and store the index
    // on the cards container so the drop handler can read it.
    const computeDropIndex = clientY => {
      const cards = [...cardsEl.querySelectorAll('.task-card:not(.dragging)')];
      for (let i = 0; i < cards.length; i++) {
        const r = cards[i].getBoundingClientRect();
        if (clientY < r.top + r.height / 2) return i;
      }
      return cards.length;
    };
    const showPlaceholder = idx => {
      // Remove any existing placeholder, then insert at idx among non-dragging cards.
      const existing = cardsEl.querySelector('.drop-placeholder');
      if (existing) existing.remove();
      const ph = document.createElement('div');
      ph.className = 'drop-placeholder';
      const cards = [...cardsEl.querySelectorAll('.task-card:not(.dragging)')];
      if (idx >= cards.length) cardsEl.appendChild(ph);
      else cardsEl.insertBefore(ph, cards[idx]);
    };
    cardsEl.addEventListener('dragover', e => {
      e.preventDefault();
      colEl.classList.add('drag-over');
      const idx = computeDropIndex(e.clientY);
      cardsEl.dataset.dropIndex = String(idx);
      showPlaceholder(idx);
    });
    cardsEl.addEventListener('dragleave', e => {
      // Only clear when leaving the column entirely (not when crossing into a child).
      if (e.relatedTarget && cardsEl.contains(e.relatedTarget)) return;
      colEl.classList.remove('drag-over');
      const ph = cardsEl.querySelector('.drop-placeholder');
      if (ph) ph.remove();
    });
    cardsEl.addEventListener('drop', e => {
      e.preventDefault();
      colEl.classList.remove('drag-over');
      const ph = cardsEl.querySelector('.drop-placeholder');
      if (ph) ph.remove();
      const taskId = parseInt(e.dataTransfer.getData('text/plain'));
      const index = parseInt(cardsEl.dataset.dropIndex || '0');
      moveTask(taskId, col.id, index);
    });

    for (const task of colTasks) {
      const card = document.createElement('div');
      card.className = 'task-card';
      card.draggable = true;
      card.dataset.id = task.id;

      card.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', task.id);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));

      let priorityBadge = '';
      if (task.priority >= 1 && task.priority <= 3 && task.column === 'today') {
        priorityBadge = `<div class="priority-badge">${task.priority}</div>`;
      }

      let tagsHTML = '';
      if (task.tags && task.tags.length) {
        tagsHTML = task.tags.map(t => `<span class="task-tag">${t}</span>`).join('');
      }

      card.innerHTML = `
        ${priorityBadge}
        <div class="card-actions">
          <button onclick="openTaskModal(${task.id})" title="Edit">✎</button>
          <button onclick="deleteTask(${task.id})" title="Delete">×</button>
        </div>
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-meta">
          <span>${task.sourceDate || ''}</span>
          ${tagsHTML}
        </div>
      `;

      // Double-click to edit
      card.addEventListener('dblclick', () => openTaskModal(task.id));

      cardsEl.appendChild(card);
    }

    board.appendChild(colEl);
  }
}

async function moveTask(taskId, newColumn, index) {
  // Force the target column into custom sort so the dropped position is what the user sees.
  columnSorts[newColumn] = 'custom';
  saveColumnSorts();
  await fetch(`/api/tasks/${taskId}/move`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ column: newColumn, index })
  });
  loadTasks();
}

async function deleteTask(taskId) {
  if (!confirm('Delete this task?')) return;
  await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
  loadTasks();
}

// --- Task Modal ---
function openTaskModal(taskId = null, defaultColumn = 'inbox') {
  editingTaskId = taskId;
  const modal = document.getElementById('task-modal');

  if (taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    document.getElementById('modal-title').textContent = 'Edit Task';
    document.getElementById('modal-task-title').value = task.title;
    document.getElementById('modal-task-desc').value = task.description || '';
    document.getElementById('modal-task-column').value = task.column;
    document.getElementById('modal-task-priority').value = task.priority || 0;
    document.getElementById('modal-task-tags').value = (task.tags || []).join(', ');
  } else {
    document.getElementById('modal-title').textContent = 'New Task';
    document.getElementById('modal-task-title').value = '';
    document.getElementById('modal-task-desc').value = '';
    document.getElementById('modal-task-column').value = defaultColumn;
    document.getElementById('modal-task-priority').value = '0';
    document.getElementById('modal-task-tags').value = '';
  }

  modal.classList.add('active');
  document.getElementById('modal-task-title').focus();
}

function closeTaskModal() {
  document.getElementById('task-modal').classList.remove('active');
  editingTaskId = null;
}

async function saveTask() {
  const title = document.getElementById('modal-task-title').value.trim();
  if (!title) return;

  const data = {
    title,
    description: document.getElementById('modal-task-desc').value.trim(),
    column: document.getElementById('modal-task-column').value,
    priority: parseInt(document.getElementById('modal-task-priority').value),
    tags: document.getElementById('modal-task-tags').value.split(',').map(t => t.trim()).filter(Boolean)
  };

  if (editingTaskId) {
    await fetch(`/api/tasks/${editingTaskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } else {
    data.sourceDate = todayStr();
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  }

  closeTaskModal();
  loadTasks();
}

// Close modal on overlay click
document.getElementById('task-modal').addEventListener('click', e => {
  if (e.target.id === 'task-modal') closeTaskModal();
});

// Close modal on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeTaskModal();
});

// --- Search ---
let searchSource = 'wiki';

function setupSearch() {
  const input = document.getElementById('search-input');
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => doSearch(input.value), 300);
  });
}

function setupSearchFilters() {
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      searchSource = chip.dataset.source;
      const input = document.getElementById('search-input');
      if (input.value.trim()) doSearch(input.value);
    });
  });
}

async function doSearch(query) {
  if (!query.trim()) {
    document.getElementById('search-results').innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--text-dim);">
        <p style="font-size:15px;">Search across your wiki, daily logs, and tasks</p>
        <p style="font-size:13px;margin-top:8px;">Wiki is the default — synthesized knowledge across all your days</p>
      </div>`;
    document.getElementById('day-viewer').style.display = 'none';
    document.getElementById('search-results').style.display = 'block';
    return;
  }

  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&source=${searchSource}`);
  const results = await res.json();
  const container = document.getElementById('search-results');
  container.style.display = 'block';
  document.getElementById('day-viewer').style.display = 'none';

  if (results.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-dim);">No results found in ${searchSource === 'all' ? 'any source' : searchSource}</div>`;
    return;
  }

  const terms = query.toLowerCase().split(/\s+/);

  container.innerHTML = results.map(r => {
    if (r.type === 'task') {
      return `
        <div class="search-result" onclick="switchToTask(${r.task.id})">
          <div class="result-header">
            <span class="result-type task">Task</span>
            <span class="result-date">${r.task.column} · ${r.task.sourceDate || ''}</span>
          </div>
          <div class="task-title" style="font-size:14px;font-weight:500;">${highlightTerms(escapeHtml(r.task.title), terms)}</div>
          ${r.task.description ? `<div class="result-snippet">${highlightTerms(escapeHtml(r.task.description), terms)}</div>` : ''}
        </div>`;
    }

    if (r.type === 'wiki') {
      return `
        <div class="search-result" onclick="navigateToWikiPage('${r.slug}')">
          <div class="result-header">
            <span class="result-type wiki">Wiki</span>
            <span class="result-date">${r.slug}</span>
          </div>
          <div class="task-title" style="font-size:14px;font-weight:500;">${highlightTerms(escapeHtml(r.title), terms)}</div>
          <div class="result-snippet">${r.snippets.map(s => highlightTerms(escapeHtml(s), terms)).join('<br>')}</div>
        </div>`;
    }

    const typeLabel = r.type === 'organized' ? 'Organized' : 'Daily Log';
    return `
      <div class="search-result" onclick="viewDay('${r.date}')">
        <div class="result-header">
          <span class="result-type ${r.type}">${typeLabel}</span>
          <span class="result-date">${r.date}</span>
        </div>
        <div class="result-snippet">${r.snippets.map(s => highlightTerms(escapeHtml(s), terms)).join('<br>')}</div>
      </div>`;
  }).join('');
}

function navigateToWikiPage(slug) {
  // Switch to wiki tab and load the page
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-view="wiki"]').classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-wiki').classList.add('active');
  loadWikiPage(slug);
}

function highlightTerms(text, terms) {
  let result = text;
  for (const term of terms) {
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    result = result.replace(regex, '<mark>$1</mark>');
  }
  return result;
}

async function viewDay(date) {
  document.getElementById('search-results').style.display = 'none';
  const viewer = document.getElementById('day-viewer');
  viewer.style.display = 'block';

  // Load both raw and organized
  const [rawRes, orgRes] = await Promise.all([
    fetch(`/api/canvas/${date}`),
    fetch(`/api/organized/${date}`)
  ]);
  const raw = await rawRes.json();
  const org = await orgRes.json();

  const tabs = document.getElementById('viewer-tabs');
  const content = document.getElementById('viewer-content');

  let tabsHTML = `<button class="active" onclick="showViewerTab(this, 'raw')">Raw Log</button>`;
  if (org.exists) {
    tabsHTML += `<button onclick="showViewerTab(this, 'org')">Organized</button>`;
  }
  tabs.innerHTML = tabsHTML;

  // Store data on the viewer
  viewer.dataset.raw = raw.content || '(empty)';
  viewer.dataset.org = org.content || '';

  content.textContent = raw.content || '(empty)';
}

function showViewerTab(btn, type) {
  const viewer = document.getElementById('day-viewer');
  const content = document.getElementById('viewer-content');
  document.querySelectorAll('.viewer-tabs button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  content.textContent = type === 'org' ? viewer.dataset.org : viewer.dataset.raw;
}

function closeDayViewer() {
  document.getElementById('day-viewer').style.display = 'none';
  document.getElementById('search-results').style.display = 'block';
}

function switchToTask(taskId) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-view="kanban"]').classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-kanban').classList.add('active');
  loadTasks().then(() => {
    const card = document.querySelector(`.task-card[data-id="${taskId}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.style.outline = '2px solid var(--accent)';
      setTimeout(() => card.style.outline = '', 2000);
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Wiki ---
let currentWikiSlug = null;
let wikiPages = [];

async function loadWikiIndex() {
  const res = await fetch('/api/wiki');
  wikiPages = await res.json();
  renderWikiSidebar();

  // Show index in main area
  if (!currentWikiSlug) {
    showWikiIndex();
  }
}

function renderWikiSidebar() {
  const list = document.getElementById('wiki-page-list');

  // Group pages by directory prefix
  const groups = {};
  for (const page of wikiPages) {
    const parts = page.slug.split('/');
    const category = parts.length > 1 ? parts[0] : 'pages';
    if (!groups[category]) groups[category] = [];
    groups[category].push(page);
  }

  let html = '';
  const categoryOrder = ['projects', 'people', 'decisions', 'topics', 'pages'];
  const sortedCategories = Object.keys(groups).sort((a, b) => {
    const ai = categoryOrder.indexOf(a);
    const bi = categoryOrder.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  for (const cat of sortedCategories) {
    const pages = groups[cat];
    if (cat !== 'pages') {
      html += `<div class="wiki-page-category">${cat}</div>`;
    }
    for (const page of pages) {
      const displayName = page.slug.includes('/') ? page.slug.split('/').pop() : page.slug;
      const isActive = page.slug === currentWikiSlug;
      html += `<div class="wiki-page-item${isActive ? ' active' : ''}" onclick="loadWikiPage('${page.slug}')" title="${page.title}">${page.title !== page.slug ? page.title : displayName}</div>`;
    }
  }

  if (wikiPages.length === 0) {
    html = '<div style="padding:12px;color:var(--text-dim);font-size:12px;">No wiki pages yet. They will be created by the daily organizer.</div>';
  }

  list.innerHTML = html;
}

function showWikiIndex() {
  currentWikiSlug = null;
  renderWikiSidebar();
  document.getElementById('wiki-page-header').style.display = 'none';
  document.getElementById('wiki-editor').style.display = 'none';
  document.getElementById('wiki-backlinks').style.display = 'none';

  const rendered = document.getElementById('wiki-rendered');
  rendered.style.display = 'block';

  if (wikiPages.length === 0) {
    rendered.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--text-dim);">
        <h2 style="font-size:18px;color:var(--text);margin-bottom:12px;">Wiki</h2>
        <p>Your wiki is empty. Pages will be created automatically when the daily organizer runs.</p>
        <p style="margin-top:8px;font-size:13px;">It extracts projects, people, decisions, and topics from your daily logs and meeting transcripts, then builds persistent pages that accumulate context over time.</p>
      </div>`;
    return;
  }

  let html = '<h2 style="font-size:18px;margin-bottom:16px;">Wiki Index</h2>';

  const groups = {};
  for (const page of wikiPages) {
    const parts = page.slug.split('/');
    const category = parts.length > 1 ? parts[0] : 'pages';
    if (!groups[category]) groups[category] = [];
    groups[category].push(page);
  }

  for (const [cat, pages] of Object.entries(groups)) {
    html += `<h3 style="font-size:14px;color:var(--text-dim);text-transform:capitalize;margin:16px 0 8px;">${cat}</h3>`;
    for (const page of pages) {
      html += `
        <div class="wiki-index-card" onclick="loadWikiPage('${page.slug}')">
          <div class="wiki-card-title">${escapeHtml(page.title)}</div>
          <div class="wiki-card-slug">${page.slug}</div>
        </div>`;
    }
  }

  rendered.innerHTML = html;
}

async function loadWikiPage(slug) {
  currentWikiSlug = slug;
  const res = await fetch(`/api/wiki/${slug}`);
  const data = await res.json();

  renderWikiSidebar();

  const header = document.getElementById('wiki-page-header');
  const rendered = document.getElementById('wiki-rendered');
  const editor = document.getElementById('wiki-editor');
  const backlinksEl = document.getElementById('wiki-backlinks');

  header.style.display = 'flex';
  editor.style.display = 'none';
  rendered.style.display = 'block';
  document.getElementById('btn-wiki-edit').textContent = 'Edit';
  document.getElementById('btn-wiki-edit').style.display = '';
  document.getElementById('btn-wiki-save').style.display = 'none';

  if (data.exists) {
    const firstLine = data.content.split('\n').find(l => l.trim()) || slug;
    document.getElementById('wiki-page-title').textContent = firstLine.replace(/^#+\s*/, '');

    // Render markdown, converting [[wiki-links]] to clickable links
    let md = data.content.replace(/\[\[([^\]]+)\]\]/g, (match, link) => {
      return `[${link}](javascript:void(0))`;
    });
    rendered.innerHTML = marked.parse(md);

    // Make wiki-links clickable
    rendered.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href');
      if (href === 'javascript:void(0)') {
        const linkText = a.textContent;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          // Try to find matching page
          const target = wikiPages.find(p => p.slug === linkText || p.slug.endsWith('/' + linkText) || p.title === linkText);
          if (target) loadWikiPage(target.slug);
        });
      }
    });

    // Store content for editing
    editor.value = data.content;

    // Show backlinks
    if (data.backlinks && data.backlinks.length > 0) {
      // 'flex' (not 'block') so the column layout in .wiki-backlinks applies,
      // letting the inner list scroll inside the max-height cap.
      backlinksEl.style.display = 'flex';
      document.getElementById('wiki-backlinks-list').innerHTML = data.backlinks
        .map(bl => `<div class="wiki-backlink-item" onclick="loadWikiPage('${bl.slug}')">${escapeHtml(bl.title || bl.slug)}</div>`)
        .join('');
    } else {
      backlinksEl.style.display = 'none';
    }
  } else {
    document.getElementById('wiki-page-title').textContent = slug;
    rendered.innerHTML = '<p style="color:var(--text-dim)">This page doesn\'t exist yet.</p>';
    editor.value = `# ${slug}\n\n`;
    backlinksEl.style.display = 'none';
  }
}

function toggleWikiEdit() {
  const rendered = document.getElementById('wiki-rendered');
  const editor = document.getElementById('wiki-editor');
  const btnEdit = document.getElementById('btn-wiki-edit');
  const btnSave = document.getElementById('btn-wiki-save');

  if (editor.style.display !== 'none') {
    // Cancel edit
    editor.style.display = 'none';
    rendered.style.display = 'block';
    btnEdit.textContent = 'Edit';
    btnSave.style.display = 'none';
  } else {
    rendered.style.display = 'none';
    editor.style.display = 'block';
    editor.focus();
    btnEdit.textContent = 'Cancel';
    btnSave.style.display = '';
  }
}

async function saveWikiPage() {
  if (!currentWikiSlug) return;
  const editor = document.getElementById('wiki-editor');

  await fetch(`/api/wiki/${currentWikiSlug}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: editor.value })
  });

  // Reload page and index
  await loadWikiIndex();
  loadWikiPage(currentWikiSlug);
}

// --- Questions ---
//
// Backed by the server-parsed `wiki/questions.md`. The GUI groups questions
// into Open / Answered / Dismissed sections; user actions PUT a partial update
// and the server re-emits the file with proper section placement.

let questionsData = { prefix: '', questions: [], unparsed: [] };

const QUESTION_SECTIONS_KEY = 'questions.sections.v1';
// Default: Open expanded, Answered + Dismissed collapsed.
function loadSectionStates() {
  try {
    const saved = JSON.parse(localStorage.getItem(QUESTION_SECTIONS_KEY) || '{}');
    return { Open: true, Answered: false, Dismissed: false, ...saved };
  } catch {
    return { Open: true, Answered: false, Dismissed: false };
  }
}
function saveSectionStates(states) {
  try { localStorage.setItem(QUESTION_SECTIONS_KEY, JSON.stringify(states)); } catch {}
}

async function loadQuestions() {
  const res = await fetch('/api/questions');
  questionsData = await res.json();
  renderQuestions();
}

function renderQuestions() {
  const container = document.getElementById('questions-sections');
  const summary = document.getElementById('questions-summary');
  const unparsedEl = document.getElementById('questions-unparsed');
  const states = loadSectionStates();

  const groups = { Open: [], Answered: [], Dismissed: [] };
  for (const q of questionsData.questions) {
    (groups[q.status] || groups.Open).push(q);
  }
  for (const k of Object.keys(groups)) {
    groups[k].sort((a, b) => (b.raised || '').localeCompare(a.raised || ''));
  }

  summary.textContent =
    `${groups.Open.length} open · ${groups.Answered.length} answered · ${groups.Dismissed.length} dismissed`;

  container.innerHTML = '';
  const sectionMeta = [
    { key: 'Open',      label: 'Open',      cls: 'open' },
    { key: 'Answered',  label: 'Answered',  cls: 'answered' },
    { key: 'Dismissed', label: 'Dismissed', cls: 'dismissed' },
  ];

  for (const meta of sectionMeta) {
    const list = groups[meta.key];
    const section = document.createElement('details');
    section.className = `question-section section-${meta.cls}`;
    section.open = !!states[meta.key];
    section.dataset.section = meta.key;

    const summaryEl = document.createElement('summary');
    summaryEl.innerHTML = `
      <span class="section-arrow"></span>
      <span class="section-label">${meta.label}</span>
      <span class="section-count">${list.length}</span>
    `;
    section.appendChild(summaryEl);

    const cards = document.createElement('div');
    cards.className = 'question-cards';
    if (list.length === 0) {
      cards.innerHTML = `<div class="question-empty">No ${meta.label.toLowerCase()} questions</div>`;
    } else {
      for (const q of list) cards.appendChild(renderQuestionCard(q));
    }
    section.appendChild(cards);

    section.addEventListener('toggle', () => {
      const s = loadSectionStates();
      s[meta.key] = section.open;
      saveSectionStates(s);
    });

    container.appendChild(section);
  }

  // Unparsed blocks footer (rare; only if questions.md has malformed entries)
  if (questionsData.unparsed && questionsData.unparsed.length > 0) {
    unparsedEl.style.display = 'block';
    unparsedEl.innerHTML = `
      <div class="unparsed-warning">
        ${questionsData.unparsed.length} question block${questionsData.unparsed.length === 1 ? '' : 's'} couldn't be parsed.
        <a href="javascript:void(0)" onclick="document.querySelector('[data-view=\\'wiki\\']').click(); setTimeout(() => loadWikiPage('questions'), 50);">Open in wiki editor</a> to inspect.
      </div>
    `;
  } else {
    unparsedEl.style.display = 'none';
  }
}

// Render a single question card. Behavior depends on status.
function renderQuestionCard(q) {
  const card = document.createElement('div');
  card.className = `question-card status-${q.status.toLowerCase()}`;
  card.dataset.id = q.id;

  const metaParts = [];
  if (q.raised) metaParts.push(`<span class="qm-raised">${escapeHtml(q.raised)}</span>`);
  if (q.source) metaParts.push(`<span class="qm-source">${escapeHtml(q.source)}</span>`);
  if (q.statusDate && q.status !== 'Open') {
    metaParts.push(`<span class="qm-status-date">${q.status.toLowerCase()} ${escapeHtml(q.statusDate)}</span>`);
  }

  // Render question and related text through marked so [[wiki-links]] and links render.
  const questionHTML = q.question ? marked.parseInline(escapeMd(q.question)) : '<em>(no question text)</em>';
  const relatedHTML  = q.related  ? marked.parseInline(escapeMd(q.related))  : '';

  card.innerHTML = `
    <div class="qcard-head">
      <span class="qcard-id">${escapeHtml(q.id)}</span>
      <span class="qcard-title">${escapeHtml(q.title)}</span>
      <span class="qcard-spacer"></span>
      <button class="qcard-edit" title="Edit question">✎</button>
    </div>
    <div class="qcard-meta">${metaParts.join(' · ')}</div>
    ${relatedHTML ? `<div class="qcard-related">${relatedHTML}</div>` : ''}
    <div class="qcard-body" data-role="question-body">${questionHTML}</div>
  `;

  // Inline edit form (hidden by default)
  const editForm = document.createElement('div');
  editForm.className = 'qcard-edit-form';
  editForm.style.display = 'none';
  editForm.innerHTML = `
    <label>Title</label>
    <input class="edit-title" type="text" value="${escapeHtml(q.title)}">
    <label>Question</label>
    <textarea class="edit-question">${escapeHtml(q.question || '')}</textarea>
    <label>Source</label>
    <input class="edit-source" type="text" value="${escapeHtml(q.source || '')}">
    <label>Related</label>
    <input class="edit-related" type="text" value="${escapeHtml(q.related || '')}">
    <div class="qcard-edit-actions">
      <button class="cancel-btn">Cancel</button>
      <button class="save-btn primary-btn">Save</button>
    </div>
  `;
  card.appendChild(editForm);

  card.querySelector('.qcard-edit').addEventListener('click', () => {
    const isEditing = editForm.style.display !== 'none';
    editForm.style.display = isEditing ? 'none' : 'block';
    card.querySelector('.qcard-body').style.display = isEditing ? '' : 'none';
  });
  editForm.querySelector('.cancel-btn').addEventListener('click', () => {
    editForm.style.display = 'none';
    card.querySelector('.qcard-body').style.display = '';
  });
  editForm.querySelector('.save-btn').addEventListener('click', async () => {
    const patch = {
      title: editForm.querySelector('.edit-title').value.trim(),
      question: editForm.querySelector('.edit-question').value.trim(),
      source: editForm.querySelector('.edit-source').value.trim(),
      related: editForm.querySelector('.edit-related').value.trim(),
    };
    if (!patch.title || !patch.question) {
      alert('Title and Question are required.');
      return;
    }
    await updateQuestion(q.id, patch);
  });

  // Status-specific actions
  if (q.status === 'Open') {
    const actions = document.createElement('div');
    actions.className = 'qcard-actions';
    actions.innerHTML = `
      <label class="answer-label">Answer</label>
      <textarea class="answer-input" placeholder="Type the answer here. Save will mark it Answered."></textarea>
      <div class="qcard-action-row">
        <button class="dismiss-btn ghost-btn" title="Move to Dismissed without an answer">Dismiss</button>
        <span style="flex:1"></span>
        <button class="save-answer-btn primary-btn">Save Answer</button>
      </div>
    `;
    card.appendChild(actions);

    actions.querySelector('.save-answer-btn').addEventListener('click', async () => {
      const answer = actions.querySelector('.answer-input').value.trim();
      if (!answer) {
        alert('Type an answer first, or use Dismiss to close without one.');
        return;
      }
      await updateQuestion(q.id, {
        status: 'Answered',
        answer,
        statusDate: todayStr(),
      });
    });
    actions.querySelector('.dismiss-btn').addEventListener('click', async () => {
      if (!confirm(`Dismiss "${q.title}"? It will move to the Dismissed section and can be reopened later.`)) return;
      await updateQuestion(q.id, { status: 'Dismissed', statusDate: todayStr() });
    });
  } else if (q.status === 'Answered') {
    // Answer display + edit + reopen
    const ansBlock = document.createElement('div');
    ansBlock.className = 'qcard-answer';
    const answerHTML = q.answer ? marked.parse(q.answer) : '<em>(no answer recorded)</em>';
    ansBlock.innerHTML = `
      <div class="answer-label">Answer</div>
      <div class="answer-display">${answerHTML}</div>
      <textarea class="answer-edit" style="display:none;">${escapeHtml(q.answer || '')}</textarea>
      <div class="qcard-action-row">
        <button class="reopen-btn ghost-btn" title="Move back to Open (answer is preserved)">Reopen</button>
        <span style="flex:1"></span>
        <button class="edit-answer-btn ghost-btn">Edit answer</button>
        <button class="save-answer-edit-btn primary-btn" style="display:none;">Save</button>
        <button class="cancel-answer-edit-btn ghost-btn" style="display:none;">Cancel</button>
      </div>
    `;
    card.appendChild(ansBlock);

    const display = ansBlock.querySelector('.answer-display');
    const editArea = ansBlock.querySelector('.answer-edit');
    const editBtn = ansBlock.querySelector('.edit-answer-btn');
    const saveBtn = ansBlock.querySelector('.save-answer-edit-btn');
    const cancelBtn = ansBlock.querySelector('.cancel-answer-edit-btn');

    editBtn.addEventListener('click', () => {
      display.style.display = 'none';
      editArea.style.display = 'block';
      editBtn.style.display = 'none';
      saveBtn.style.display = '';
      cancelBtn.style.display = '';
      editArea.focus();
    });
    cancelBtn.addEventListener('click', () => {
      editArea.value = q.answer || '';
      display.style.display = '';
      editArea.style.display = 'none';
      editBtn.style.display = '';
      saveBtn.style.display = 'none';
      cancelBtn.style.display = 'none';
    });
    saveBtn.addEventListener('click', async () => {
      const answer = editArea.value.trim();
      await updateQuestion(q.id, {
        answer: answer || null,
        statusDate: todayStr(),
      });
    });
    ansBlock.querySelector('.reopen-btn').addEventListener('click', async () => {
      // Preserve the answer text on reopen — user might be revisiting, not invalidating.
      await updateQuestion(q.id, { status: 'Open', statusDate: null });
    });
  } else if (q.status === 'Dismissed') {
    const actions = document.createElement('div');
    actions.className = 'qcard-action-row qcard-actions';
    actions.innerHTML = `
      <button class="reopen-btn ghost-btn">Reopen</button>
    `;
    card.appendChild(actions);
    actions.querySelector('.reopen-btn').addEventListener('click', async () => {
      await updateQuestion(q.id, { status: 'Open', statusDate: null });
    });
  }

  return card;
}

async function updateQuestion(id, patch) {
  const res = await fetch(`/api/questions/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(`Update failed: ${err.error || res.statusText}`);
    return;
  }
  await loadQuestions();
}

// New Question modal
function openQuestionModal() {
  document.getElementById('modal-question-title').value = '';
  document.getElementById('modal-question-text').value = '';
  document.getElementById('modal-question-source').value = '';
  document.getElementById('modal-question-related').value = '';
  document.getElementById('question-modal').classList.add('active');
  setTimeout(() => document.getElementById('modal-question-title').focus(), 50);
}

function closeQuestionModal() {
  document.getElementById('question-modal').classList.remove('active');
}

async function saveNewQuestion() {
  const title = document.getElementById('modal-question-title').value.trim();
  const question = document.getElementById('modal-question-text').value.trim();
  const source = document.getElementById('modal-question-source').value.trim();
  const related = document.getElementById('modal-question-related').value.trim();
  if (!title || !question) {
    alert('Title and Question are required.');
    return;
  }
  const res = await fetch('/api/questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, question, source, related }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(`Create failed: ${err.error || res.statusText}`);
    return;
  }
  closeQuestionModal();
  // Make sure Open is expanded so the new card is visible
  const states = loadSectionStates();
  states.Open = true;
  saveSectionStates(states);
  await loadQuestions();
}

// Wire up modal close behaviors (parallel to the task modal handlers above).
document.getElementById('question-modal').addEventListener('click', e => {
  if (e.target.id === 'question-modal') closeQuestionModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeQuestionModal();
});

// Markdown safety helper: escape characters that would break inline markdown rendering
// when the source text isn't intended as markdown (e.g. backticks in a question body).
// We still let `marked.parseInline` handle [[wiki-links]] and basic emphasis.
function escapeMd(s) {
  // Minimal: escape backslashes only. The text typically contains intentional inline
  // markdown (links, emphasis), so we don't aggressively escape.
  return s.replace(/\\/g, '\\\\');
}

// --- Chat ---
// Streams replies from POST /api/chat. The server prefixes its response with a
// JSON header (between __CONTEXT__ and __REPLY__ markers) describing which
// wiki pages / organized logs were used as context, then streams the model
// output verbatim.
const chatHistory = [];
let chatAbort = null;

function setupChat() {
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const newBtn = document.getElementById('btn-chat-new');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    // The single send button doubles as a stop button while streaming.
    if (chatAbort) { chatAbort.abort(); return; }
    sendChatMessage();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (chatAbort) { chatAbort.abort(); return; }
      sendChatMessage();
    }
  });
  newBtn.addEventListener('click', clearChat);
}

function clearChat() {
  chatHistory.length = 0;
  const messages = document.getElementById('chat-messages');
  messages.innerHTML = `
    <div class="chat-empty">
      <p style="font-size:15px;">Ask a question about your wiki.</p>
      <p style="font-size:13px;margin-top:8px;color:var(--text-dim);">Claude will answer using matched wiki pages plus any organized daily logs they reference.</p>
    </div>`;
}

function appendChatMessage(role, text) {
  const messages = document.getElementById('chat-messages');
  const empty = messages.querySelector('.chat-empty');
  if (empty) empty.remove();

  const msg = document.createElement('div');
  msg.className = `chat-msg ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'chat-msg-bubble';
  bubble.textContent = text;
  msg.appendChild(bubble);
  messages.appendChild(msg);
  messages.scrollTop = messages.scrollHeight;
  return msg;
}

function renderContextChips(msgEl, context) {
  if (!context) return;
  const pages = context.pages || [];
  const logs = context.logs || [];
  if (!pages.length && !logs.length) return;

  const row = document.createElement('div');
  row.className = 'chat-context';
  const label = document.createElement('span');
  label.textContent = 'Context:';
  row.appendChild(label);
  for (const p of pages) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = p.slug;
    chip.title = `wiki page (score ${p.score})`;
    row.appendChild(chip);
  }
  for (const l of logs) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = `log ${l.date}`;
    chip.title = 'organized daily log';
    row.appendChild(chip);
  }
  msgEl.appendChild(row);
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  chatAbort = new AbortController();
  sendBtn.classList.add('stopping');
  sendBtn.title = 'Stop';
  sendBtn.setAttribute('aria-label', 'Stop');
  appendChatMessage('user', message);

  const assistantEl = appendChatMessage('assistant', '');
  assistantEl.classList.add('searching');
  const bubble = assistantEl.querySelector('.chat-msg-bubble');
  bubble.innerHTML = '<span class="chat-searching">Searching<span class="chat-dots"><span>.</span><span>.</span><span>.</span></span></span>';

  let reply = '';
  let context = null;
  let firstToken = true;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: chatHistory.slice(-10) }),
      signal: chatAbort.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'unknown error' }));
      bubble.textContent = `Error: ${err.error || res.statusText}`;
      assistantEl.classList.remove('streaming');
      sendBtn.disabled = false;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let inReply = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      if (!inReply) {
        const marker = buffer.indexOf('\n__REPLY__\n');
        if (marker !== -1) {
          const header = buffer.slice(0, marker);
          if (header.startsWith('__CONTEXT__')) {
            try { context = JSON.parse(header.slice('__CONTEXT__'.length)); } catch {}
            renderContextChips(assistantEl, context);
          }
          buffer = buffer.slice(marker + '\n__REPLY__\n'.length);
          inReply = true;
        }
      }
      if (inReply && buffer) {
        if (firstToken) {
          assistantEl.classList.remove('searching');
          assistantEl.classList.add('streaming');
          bubble.textContent = '';
          firstToken = false;
        }
        reply += buffer;
        bubble.textContent = reply;
        buffer = '';
        const messages = document.getElementById('chat-messages');
        messages.scrollTop = messages.scrollHeight;
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      // User clicked Stop. Keep any partial reply that already streamed in.
      if (!reply) bubble.textContent = '(stopped)';
    } else {
      bubble.textContent = `Error: ${err.message}`;
    }
  } finally {
    assistantEl.classList.remove('streaming');
    assistantEl.classList.remove('searching');
    sendBtn.classList.remove('stopping');
    sendBtn.title = 'Send';
    sendBtn.setAttribute('aria-label', 'Send');
    chatAbort = null;
    if (reply) {
      chatHistory.push({ role: 'user', content: message });
      chatHistory.push({ role: 'assistant', content: reply });
    }
  }
}
