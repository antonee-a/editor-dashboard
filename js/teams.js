import { db } from './supabase.js';

// Brief text cache keyed by task id — populated when panel opens
const briefCache = {};

async function init() {
  await loadTeam();
  bindEditorModal();
}

async function loadTeam() {
  const { data: editors } = await db
    .from('editors')
    .select('*')
    .order('name');

  if (!editors?.length) {
    document.getElementById('team-grid').innerHTML = '<div class="empty">No editors yet. Add one to get started.</div>';
    return;
  }

  const ACTIVE_STATUSES = ['Assigned', 'In Progress', 'Ready', 'Under Review'];

  const { data: allTasks } = await db
    .from('tasks')
    .select('assigned_to, task_points, status')
    .in('status', [...ACTIVE_STATUSES, 'Completed']);

  const activeMap    = {};  // editorId -> { assigned, inProgress, ready, underReview, total }
  const completedMap = {};  // editorId -> count
  const pointsMap    = {};  // editorId -> total queue points (active only)

  (allTasks || []).forEach(t => {
    if (!t.assigned_to) return;
    if (t.status === 'Completed') {
      completedMap[t.assigned_to] = (completedMap[t.assigned_to] || 0) + 1;
    } else if (ACTIVE_STATUSES.includes(t.status)) {
      if (!activeMap[t.assigned_to]) activeMap[t.assigned_to] = { assigned:0, inProgress:0, ready:0, underReview:0, total:0 };
      const m = activeMap[t.assigned_to];
      m.total++;
      if (t.status === 'Assigned')      m.assigned++;
      if (t.status === 'In Progress')   m.inProgress++;
      if (t.status === 'Ready')         m.ready++;
      if (t.status === 'Under Review')  m.underReview++;
      pointsMap[t.assigned_to] = (pointsMap[t.assigned_to] || 0) + (t.task_points || 0);
    }
  });

  const empty = { assigned:0, inProgress:0, ready:0, underReview:0, total:0 };
  document.getElementById('team-grid').innerHTML = editors.map(e =>
    editorCard(e, activeMap[e.id] || empty, completedMap[e.id] || 0, pointsMap[e.id] || 0)
  ).join('');

  document.querySelectorAll('.editor-card').forEach(card => {
    card.addEventListener('click', () => openPanel(card.dataset.id, editors));
  });
}

function editorCard(e, activeCounts, completedCount, totalPoints) {
  const initials  = e.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const tierClass = `badge-tier-${e.speed_tier.toLowerCase()}`;
  const { assigned=0, inProgress=0, ready=0, underReview=0, total=0 } = activeCounts;

  const statusRows = [
    { label:'Assigned',     count:assigned,    cls:'status-dot-assigned' },
    { label:'In Progress',  count:inProgress,  cls:'status-dot-progress' },
    { label:'Ready',        count:ready,       cls:'status-dot-ready' },
    { label:'Under Review', count:underReview, cls:'status-dot-review' },
  ].filter(s => s.count > 0);

  return `
  <div class="editor-card" data-id="${e.id}">
    <div class="editor-card-top">
      <div class="editor-avatar">${initials}</div>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="badge ${tierClass}">${e.speed_tier}</span>
        <span class="editor-status-dot ${e.status === 'Unavailable' ? 'unavailable' : ''}" title="${e.status}"></span>
      </div>
    </div>
    <div class="editor-name">${e.name}</div>
    <div class="editor-role">${e.role}</div>
    ${e.strongest_formats?.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">${e.strongest_formats.map(f => `<span class="badge" style="background:var(--bg-3);color:var(--text-muted);font-size:10px">${f}</span>`).join('')}</div>` : ''}

    <div class="card-subsection">
      <div class="card-subsection-label">Active Tasks <span class="card-subsection-count">${total}</span></div>
      ${statusRows.length ? `<div class="status-breakdown">${statusRows.map(s => `
        <div class="status-row">
          <span class="status-row-dot ${s.cls}"></span>
          <span class="status-row-label">${s.label}</span>
          <span class="status-row-count">${s.count}</span>
        </div>`).join('')}</div>` : '<div class="card-empty-sub">No active tasks</div>'}
    </div>

    <div class="card-subsection">
      <div class="card-subsection-label">Velocity</div>
      <div class="card-velocity-pending">Grading system coming soon</div>
    </div>

    <div class="card-subsection">
      <div class="card-subsection-label">Completed <span class="card-subsection-count">${completedCount}</span></div>
      ${completedCount > 0
        ? `<div class="card-completed-count">${completedCount} task${completedCount !== 1 ? 's' : ''} completed</div>`
        : '<div class="card-empty-sub">None yet</div>'}
    </div>
  </div>`;
}

async function openPanel(editorId, editors) {
  const editor = editors.find(e => e.id === editorId);
  if (!editor) return;

  document.getElementById('panel-editor-name').textContent = editor.name;

  const ACTIVE_STATUSES = ['Assigned', 'In Progress', 'Ready', 'Under Review'];

  const [{ data: tools }, { data: history }, { data: tasks }] = await Promise.all([
    db.from('editor_tools').select('*').eq('editor_id', editorId).order('tool_name'),
    db.from('speed_tier_history').select('*').eq('editor_id', editorId).order('changed_at', { ascending: false }),
    db.from('tasks').select('id, title, status, client, date_assigned, due_date, brief_url, task_points')
      .eq('assigned_to', editorId).order('date_assigned', { ascending: false }),
  ]);

  const activeTasks    = (tasks || []).filter(t => ACTIVE_STATUSES.includes(t.status));
  const completedTasks = (tasks || []).filter(t => t.status === 'Completed');

  // Cache briefs for copy buttons
  (tasks || []).forEach(t => { if (t.brief_url) briefCache[t.id] = t.brief_url; });

  const queuePoints = activeTasks.reduce((sum, t) => sum + (t.task_points || 0), 0);

  document.getElementById('panel-content').innerHTML = `
    <div class="panel-summary-stats">
      <div class="panel-summary-stat">
        <span class="panel-summary-num">${activeTasks.length}</span>
        <span class="panel-summary-label">Active</span>
      </div>
      <div class="panel-summary-stat">
        <span class="panel-summary-num">${completedTasks.length}</span>
        <span class="panel-summary-label">Completed</span>
      </div>
      <div class="panel-summary-stat">
        <span class="panel-summary-num">${queuePoints}</span>
        <span class="panel-summary-label">Queue Pts</span>
      </div>
    </div>

    <div class="panel-section">
      <h4>Active Tasks (${activeTasks.length})</h4>
      ${activeTasks.length ? activeTasks.map(t => `
      <div class="panel-task-row">
        <div class="panel-task-row-head">
          <span class="panel-task-row-title">${escapeHtml(t.title)}</span>
          <span class="badge ${statusBadgeClass(t.status)}">${t.status}</span>
        </div>
        <div class="panel-task-row-meta">${escapeHtml(t.client || '')}${t.date_assigned ? ' &middot; ' + formatDate(t.date_assigned) : ''}</div>
        ${t.brief_url ? `<button class="btn-brief btn-copy-brief" data-task-id="${t.id}">Copy Brief</button>` : ''}
      </div>`).join('') : '<p style="font-size:12px;color:var(--text-muted);font-style:italic;padding:4px 0">No active tasks.</p>'}
    </div>

    <div class="panel-section">
      <h4>Velocity</h4>
      <div class="panel-velocity-tbd">Grading system coming soon</div>
    </div>

    <div class="panel-section">
      <h4>Completed (${completedTasks.length})</h4>
      ${completedTasks.length ? completedTasks.map(t => `
      <div class="panel-task-row panel-task-row--completed">
        <div class="panel-task-row-head">
          <span class="panel-task-row-title">${escapeHtml(t.title)}</span>
          <span class="badge badge-status-completed">Completed</span>
        </div>
        <div class="panel-task-row-meta">${escapeHtml(t.client || '')}</div>
      </div>`).join('') : '<p style="font-size:12px;color:var(--text-muted);font-style:italic;padding:4px 0">No completed tasks yet.</p>'}
    </div>

    <div style="height:1px;background:var(--border);margin:4px 0 20px"></div>

    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      <span class="badge badge-tier-${editor.speed_tier.toLowerCase()}">${editor.speed_tier}</span>
      <span class="badge" style="background:${editor.status === 'Active' ? 'rgba(34,197,94,.15)' : 'rgba(122,127,154,.15)'};color:${editor.status === 'Active' ? 'var(--success)' : 'var(--text-muted)'}">${editor.status}</span>
    </div>

    ${editor.availability_schedule ? `
    <div class="panel-section">
      <h4>Schedule</h4>
      <p style="font-size:13px">${editor.availability_schedule}</p>
    </div>` : ''}

    ${tools?.length ? `
    <div class="panel-section">
      <h4>Tools & Proficiency</h4>
      <div class="tools-list">
        ${tools.map(t => `
        <div class="tool-row">
          <span>${t.tool_name}</span>
          <span class="badge badge-proficiency-${t.proficiency.toLowerCase()}">${t.proficiency}</span>
        </div>`).join('')}
      </div>
    </div>` : ''}

    ${editor.strongest_formats?.length ? `
    <div class="panel-section">
      <h4>Strongest Formats</h4>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${editor.strongest_formats.map(f => `<span class="badge" style="background:var(--bg-3);color:var(--text-muted)">${f}</span>`).join('')}</div>
    </div>` : ''}

    ${editor.skills_in_development?.length ? `
    <div class="panel-section">
      <h4>Skills in Development</h4>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${editor.skills_in_development.map(s => `<span class="badge" style="background:var(--bg-3);color:var(--text-muted)">${s}</span>`).join('')}</div>
    </div>` : ''}

    ${(editor.assignment_preferences_best || editor.assignment_preferences_avoid) ? `
    <div class="panel-section">
      <h4>Assignment Preferences</h4>
      ${editor.assignment_preferences_best  ? `<p style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Best fit: <span style="color:var(--text)">${editor.assignment_preferences_best}</span></p>`  : ''}
      ${editor.assignment_preferences_avoid ? `<p style="font-size:12px;color:var(--text-muted)">Avoid: <span style="color:var(--text)">${editor.assignment_preferences_avoid}</span></p>` : ''}
    </div>` : ''}

    ${history?.length ? `
    <div class="panel-section">
      <h4>Speed Tier History</h4>
      <div class="tier-history">
        ${history.map(h => `
        <div class="tier-row">
          <span class="tier-date">${formatDate(h.changed_at)}</span>
          <span class="badge badge-tier-${h.tier.toLowerCase()}">${h.tier}</span>
          ${h.notes ? `<span style="font-size:12px;color:var(--text-muted)">${h.notes}</span>` : ''}
        </div>`).join('')}
      </div>
    </div>` : ''}

    <div style="margin-top:20px">
      <button class="btn-ghost" style="width:100%" onclick="openEditEditorModal('${editor.id}')">Edit Profile</button>
    </div>
  `;

  // Wire up Copy Brief buttons
  document.getElementById('panel-content').querySelectorAll('.btn-copy-brief').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const brief = briefCache[btn.dataset.taskId];
      if (!brief) return;
      navigator.clipboard.writeText(brief).then(() => {
        btn.textContent = 'Copied!';
        btn.style.color = 'var(--success)';
        setTimeout(() => { btn.textContent = 'Copy Brief'; btn.style.color = ''; }, 1500);
      });
    });
  });

  document.getElementById('editor-panel').classList.remove('hidden');
  document.getElementById('panel-overlay').classList.remove('hidden');
}

document.getElementById('btn-close-panel').addEventListener('click', closePanel);
document.getElementById('panel-overlay').addEventListener('click', closePanel);

function closePanel() {
  document.getElementById('editor-panel').classList.add('hidden');
  document.getElementById('panel-overlay').classList.add('hidden');
}

// ── Editor Modal ───────────────────────────
function bindEditorModal() {
  document.getElementById('btn-add-editor').addEventListener('click', () => openAddEditorModal());
  document.getElementById('btn-close-editor-modal').addEventListener('click', closeEditorModal);
  document.getElementById('btn-cancel-editor').addEventListener('click', closeEditorModal);
  document.getElementById('editor-modal-overlay').addEventListener('click', closeEditorModal);
  document.getElementById('editor-form').addEventListener('submit', handleEditorSubmit);
}

function openAddEditorModal() {
  document.getElementById('modal-editor-title').textContent = 'Add Editor';
  document.getElementById('editor-id-hidden').value = '';
  document.getElementById('editor-form').reset();
  showEditorModal();
}

window.openEditEditorModal = async function(id) {
  const { data: e } = await db.from('editors').select('*').eq('id', id).single();
  if (!e) return;
  document.getElementById('modal-editor-title').textContent  = 'Edit Editor';
  document.getElementById('editor-id-hidden').value          = e.id;
  document.getElementById('ef-name').value                   = e.name || '';
  document.getElementById('ef-role').value                   = e.role || '';
  document.getElementById('ef-tier').value                   = e.speed_tier || 'Onboarding';
  document.getElementById('ef-status').value                 = e.status || 'Active';
  document.getElementById('ef-availability').value           = e.availability_schedule || '';
  document.getElementById('ef-formats').value                = (e.strongest_formats || []).join(', ');
  document.getElementById('ef-skills').value                 = (e.skills_in_development || []).join(', ');
  document.getElementById('ef-pref-best').value              = e.assignment_preferences_best || '';
  document.getElementById('ef-pref-avoid').value             = e.assignment_preferences_avoid || '';
  closePanel();
  showEditorModal();
};

async function handleEditorSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('editor-id-hidden').value;

  const payload = {
    name:                        document.getElementById('ef-name').value,
    role:                        document.getElementById('ef-role').value,
    speed_tier:                  document.getElementById('ef-tier').value,
    status:                      document.getElementById('ef-status').value,
    availability_schedule:       document.getElementById('ef-availability').value || null,
    strongest_formats:           csvToArray('ef-formats'),
    skills_in_development:       csvToArray('ef-skills'),
    assignment_preferences_best: document.getElementById('ef-pref-best').value  || null,
    assignment_preferences_avoid:document.getElementById('ef-pref-avoid').value || null,
  };

  const { error } = id
    ? await db.from('editors').update(payload).eq('id', id)
    : await db.from('editors').insert(payload);

  if (error) { alert('Error saving editor: ' + error.message); return; }
  closeEditorModal();
  await loadTeam();
}

function showEditorModal() {
  document.getElementById('editor-modal').classList.remove('hidden');
  document.getElementById('editor-modal-overlay').classList.remove('hidden');
}
function closeEditorModal() {
  document.getElementById('editor-modal').classList.add('hidden');
  document.getElementById('editor-modal-overlay').classList.add('hidden');
}

function csvToArray(id) {
  return document.getElementById(id).value
    .split(',').map(s => s.trim()).filter(Boolean);
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function statusBadgeClass(status) {
  const map = {
    'Assigned':     'badge-status-assigned',
    'In Progress':  'badge-status-progress',
    'Ready':        'badge-status-ready',
    'Under Review': 'badge-status-review',
    'Completed':    'badge-status-completed',
  };
  return map[status] || '';
}

init();
