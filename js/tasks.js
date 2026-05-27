import { db } from './supabase.js';

// ── State ──────────────────────────────────
let allTasks = [];
let allEditors = [];

// ── Init ───────────────────────────────────
async function init() {
  populateClientDropdowns();
  await loadEditors();
  await loadTasks();
  bindFilters();
  bindModal();
  bindAddClientButtons();
}

// ── Client Dropdowns ───────────────────────
function populateClientDropdowns() {
  const clients = getClients();

  const filterSel = document.getElementById('filter-client');
  filterSel.innerHTML = '<option value="">All Clients</option>';
  clients.forEach(c => {
    const o = document.createElement('option'); o.value = o.textContent = c;
    filterSel.appendChild(o);
  });

  const formSel = document.getElementById('f-client');
  formSel.innerHTML = '<option value="">—</option>';
  clients.forEach(c => {
    const o = document.createElement('option'); o.value = o.textContent = c;
    formSel.appendChild(o);
  });
}

function bindAddClientButtons() {
  const popover = document.getElementById('add-client-popover');
  const input   = document.getElementById('add-client-input');
  const confirm = document.getElementById('add-client-confirm');
  const cancel  = document.getElementById('add-client-cancel');

  function showPopover(anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    popover.style.top  = (rect.bottom + 6) + 'px';
    popover.style.left = rect.left + 'px';
    popover.classList.remove('hidden');
    input.value = '';
    input.focus();
  }

  function hidePopover() { popover.classList.add('hidden'); }

  ['btn-add-client-filter', 'btn-add-client-modal'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => {
      e.stopPropagation();
      showPopover(e.currentTarget);
    });
  });

  confirm.addEventListener('click', () => {
    const name = input.value.trim();
    if (!name) return;
    addClient(name);
    populateClientDropdowns();
    hidePopover();
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirm.click();
    if (e.key === 'Escape') hidePopover();
  });

  cancel.addEventListener('click', hidePopover);
  document.addEventListener('click', e => {
    if (!popover.contains(e.target)) hidePopover();
  });
}

// ── Data ───────────────────────────────────
async function loadEditors() {
  const { data } = await db.from('editors').select('id, name').order('name');
  allEditors = data || [];
  populateEditorFilter(allEditors);
  populateEditorSelect(allEditors);
}

async function loadTasks() {
  const { data, error } = await db
    .from('tasks')
    .select('*, editors(name)')
    .order('date_assigned', { ascending: false });

  if (error) { console.error(error); return; }
  allTasks = data || [];
  renderTasks(applyFilters(allTasks));
}

// ── Render ─────────────────────────────────
function renderTasks(tasks) {
  const grid = document.getElementById('task-grid');
  if (!tasks.length) {
    grid.innerHTML = '<div class="empty">No tasks found.</div>';
    return;
  }
  grid.innerHTML = tasks.map(taskCard).join('');
  grid.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('click', () => openEditModal(card.dataset.id));
  });
}

function taskCard(t) {
  const editorName = t.editors?.name || '—';
  const dueLabel   = t.due_date ? formatDate(t.due_date) : '—';
  const isOverdue  = t.due_date && new Date(t.due_date) < new Date() && t.status !== 'Completed';
  const pendingReview = !t.quality_rating && !t.speed_rating;

  const expectedTime = pointsToTime(t.task_points);

  return `
  <div class="task-card" data-id="${t.id}">
    <div class="task-card-top">
      <span class="task-id">${t.task_id}</span>
      <div style="display:flex;gap:6px">
        ${statusBadge(t.status)}
        ${priorityBadge(t.priority)}
      </div>
    </div>
    <div class="task-card-title">${t.title}</div>
    <div class="task-card-meta">
      ${clientBadge(t.client)}
      ${t.format  ? `<span class="badge" style="background:var(--bg-3);color:var(--text-muted)">${t.format}</span>` : ''}
      ${t.duration ? `<span class="badge" style="background:var(--bg-3);color:var(--text-muted)">${t.duration}</span>` : ''}
      ${t.task_points != null ? `<span class="points-badge">${t.task_points}</span>` : ''}
    </div>
    ${pendingReview
      ? `<div class="task-ratings"><span class="badge badge-pending">Pending Review</span></div>`
      : `<div class="task-ratings">
           <span class="rating-block">Quality <span>${t.quality_rating ?? '—'}/5</span></span>
           <span class="rating-block">Speed <span>${t.speed_rating ?? '—'}/5</span></span>
           ${t.revisions ? `<span class="rating-block">Revisions <span>${t.revisions}</span></span>` : ''}
         </div>`
    }
    <div class="task-card-footer">
      <span class="task-card-editor">${editorName}</span>
      <span class="task-card-due ${isOverdue ? 'overdue' : ''}">Due ${dueLabel}</span>
    </div>
  </div>`;
}

// ── Filters ────────────────────────────────
function applyFilters(tasks) {
  const status   = document.getElementById('filter-status').value;
  const priority = document.getElementById('filter-priority').value;
  const client   = document.getElementById('filter-client').value;
  const editor   = document.getElementById('filter-editor').value;
  const format   = document.getElementById('filter-format').value;
  const sort     = document.getElementById('sort-tasks').value;

  let result = tasks.filter(t => {
    if (status   && t.status      !== status)              return false;
    if (priority && t.priority    !== priority)            return false;
    if (client   && t.client      !== client)              return false;
    if (editor   && t.assigned_to !== editor)              return false;
    if (format   && t.format      !== format)              return false;
    return true;
  });

  const priorityOrder = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
  result.sort((a, b) => {
    if (sort === 'priority')     return (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9);
    if (sort === 'task_points')  return (b.task_points ?? 0) - (a.task_points ?? 0);
    if (sort === 'due_date')     return (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1;
    return (b.date_assigned || '') < (a.date_assigned || '') ? -1 : 1;
  });

  return result;
}

function bindFilters() {
  ['filter-status','filter-priority','filter-client','filter-editor','filter-format','sort-tasks']
    .forEach(id => document.getElementById(id).addEventListener('change', () => renderTasks(applyFilters(allTasks))));

  document.getElementById('btn-clear-filters').addEventListener('click', () => {
    document.getElementById('filter-status').value   = '';
    document.getElementById('filter-priority').value = '';
    document.getElementById('filter-client').value   = '';
    document.getElementById('filter-editor').value   = '';
    document.getElementById('filter-format').value   = '';
    document.getElementById('sort-tasks').value      = 'date_assigned';
    renderTasks(applyFilters(allTasks));
  });
}

function populateEditorFilter(editors) {
  const sel = document.getElementById('filter-editor');
  editors.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.id; opt.textContent = e.name;
    sel.appendChild(opt);
  });
}

function populateEditorSelect(editors) {
  const sel = document.getElementById('f-assigned');
  sel.innerHTML = '<option value="">Unassigned</option>';
  editors.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.id; opt.textContent = e.name;
    sel.appendChild(opt);
  });
}

// ── Modal ──────────────────────────────────
function bindModal() {
  document.getElementById('btn-add-task').addEventListener('click', openAddModal);
  document.getElementById('btn-close-task-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-task').addEventListener('click', closeModal);
  document.getElementById('task-modal-overlay').addEventListener('click', closeModal);
  document.getElementById('task-form').addEventListener('submit', handleSubmit);
}

function openAddModal() {
  document.getElementById('modal-task-title').textContent = 'Add Task';
  document.getElementById('task-id-hidden').value = '';
  document.getElementById('task-form').reset();
  document.getElementById('f-date-assigned').value = today();
  showModal();
}

async function openEditModal(id) {
  const task = allTasks.find(t => t.id === id);
  if (!task) return;

  document.getElementById('modal-task-title').textContent = `Edit ${task.task_id}`;
  document.getElementById('task-id-hidden').value = task.id;
  document.getElementById('f-title').value         = task.title || '';
  document.getElementById('f-client').value        = task.client || '';
  document.getElementById('f-duration').value      = task.duration || '';
  document.getElementById('f-format').value        = task.format || '';
  document.getElementById('f-priority').value      = task.priority || 'Medium';
  document.getElementById('f-status').value        = task.status || 'In Progress';
  document.getElementById('f-assigned').value      = task.assigned_to || '';
  document.getElementById('f-points').value        = task.task_points ?? '';
  document.getElementById('f-date-assigned').value = task.date_assigned || '';
  document.getElementById('f-due-date').value      = task.due_date || '';
  document.getElementById('f-quality').value       = task.quality_rating ?? '';
  document.getElementById('f-speed').value         = task.speed_rating ?? '';
  document.getElementById('f-revisions').value     = task.revisions ?? 0;
  document.getElementById('f-brief-url').value     = task.brief_url || '';
  document.getElementById('f-finished-url').value  = task.finished_product_url || '';
  showModal();
}

async function handleSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('task-id-hidden').value;

  const payload = {
    title:                 document.getElementById('f-title').value,
    client:                document.getElementById('f-client').value,
    duration:              document.getElementById('f-duration').value || null,
    format:                document.getElementById('f-format').value   || null,
    priority:              document.getElementById('f-priority').value,
    status:                document.getElementById('f-status').value,
    assigned_to:           document.getElementById('f-assigned').value || null,
    task_points:           numOrNull('f-points'),
    date_assigned:         document.getElementById('f-date-assigned').value || null,
    due_date:              document.getElementById('f-due-date').value  || null,
    quality_rating:        numOrNull('f-quality'),
    speed_rating:          numOrNull('f-speed'),
    revisions:             numOrNull('f-revisions') ?? 0,
    brief_url:             document.getElementById('f-brief-url').value  || null,
    finished_product_url:  document.getElementById('f-finished-url').value || null,
  };

  const { error } = id
    ? await db.from('tasks').update(payload).eq('id', id)
    : await db.from('tasks').insert(payload);

  if (error) { alert('Error saving task: ' + error.message); return; }
  closeModal();
  await loadTasks();
}

function showModal() {
  document.getElementById('task-modal').classList.remove('hidden');
  document.getElementById('task-modal-overlay').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('task-modal').classList.add('hidden');
  document.getElementById('task-modal-overlay').classList.add('hidden');
}

// ── Helpers ────────────────────────────────
function numOrNull(id) {
  const v = document.getElementById(id).value;
  return v === '' ? null : Number(v);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function pointsToTime(p) {
  const map = { 0: '<1h', 1: '1–2h', 2: '2–4h', 3: '4–6h', 4: '6–10h', 5: '10h+' };
  return map[p] ?? '—';
}

function statusBadge(s) {
  const cls = { 'In Progress': 'badge-status-progress', 'Under Review': 'badge-status-review', 'Completed': 'badge-status-completed' };
  return `<span class="badge ${cls[s] || ''}">${s}</span>`;
}

function priorityBadge(p) {
  const cls = { Urgent: 'badge-priority-urgent', High: 'badge-priority-high', Medium: 'badge-priority-medium', Low: 'badge-priority-low' };
  return `<span class="badge ${cls[p] || ''}">${p}</span>`;
}

function clientBadge(c) {
  const cls = { S2L: 'badge-client-s2l', 'Land Shark': 'badge-client-ls', GGG: 'badge-client-ggg', Internal: 'badge-client-internal' };
  return `<span class="badge ${cls[c] || ''}">${c}</span>`;
}

// ── Nav wiring ─────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    item.classList.add('active');
    document.getElementById('section-' + item.dataset.section).classList.add('active');
  });
});

init();
