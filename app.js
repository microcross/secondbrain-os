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

// Per-column date-sort direction. Default: 'desc' (newest on top). Persisted in localStorage.
const SORT_STORAGE_KEY = 'kanban.columnSorts.v1';
const columnSorts = loadColumnSorts();

function loadColumnSorts() {
  const defaults = Object.fromEntries(COLUMNS.map(c => [c.id, 'desc']));
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) || '{}');
    return { ...defaults, ...saved };
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
    const direction = columnSorts[col.id] || 'desc';

    // Today column: prioritized first (by priority number), then by date within each tier.
    // All other columns: pure date sort.
    if (col.id === 'today') {
      colTasks.sort((a, b) => {
        const aHas = a.priority > 0;
        const bHas = b.priority > 0;
        if (aHas && bHas && a.priority !== b.priority) return a.priority - b.priority;
        if (aHas && !bHas) return -1;
        if (bHas && !aHas) return 1;
        return compareTasksByDate(a, b, direction);
      });
    } else {
      colTasks.sort((a, b) => compareTasksByDate(a, b, direction));
    }

    const colEl = document.createElement('div');
    colEl.className = `kanban-column ${col.cls}`;
    colEl.dataset.column = col.id;

    const arrow = direction === 'desc' ? '▼' : '▲';
    const sortLabel = direction === 'desc' ? 'Newest first — click to flip' : 'Oldest first — click to flip';

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
      columnSorts[col.id] = direction === 'desc' ? 'asc' : 'desc';
      saveColumnSorts();
      renderBoard();
    });

    const cardsEl = colEl.querySelector('.col-cards');

    // Drag & drop
    cardsEl.addEventListener('dragover', e => {
      e.preventDefault();
      colEl.classList.add('drag-over');
    });
    cardsEl.addEventListener('dragleave', () => colEl.classList.remove('drag-over'));
    cardsEl.addEventListener('drop', e => {
      e.preventDefault();
      colEl.classList.remove('drag-over');
      const taskId = parseInt(e.dataTransfer.getData('text/plain'));
      moveTask(taskId, col.id);
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

async function moveTask(taskId, newColumn) {
  await fetch(`/api/tasks/${taskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ column: newColumn })
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
      backlinksEl.style.display = 'block';
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
