import { db } from './supabase.js';

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

  // Get active task counts and total points per editor
  const { data: taskCounts } = await db
    .from('tasks')
    .select('assigned_to, task_points, status')
    .in('status', ['In Progress', 'Under Review']);

  const countMap = {};
  const pointsMap = {};
  (taskCounts || []).forEach(t => {
    if (!t.assigned_to) return;
    countMap[t.assigned_to]  = (countMap[t.assigned_to]  || 0) + 1;
    pointsMap[t.assigned_to] = (pointsMap[t.assigned_to] || 0) + (t.task_points || 0);
  });

  document.getElementById('team-grid').innerHTML = editors.map(e => editorCard(e, countMap[e.id] || 0, pointsMap[e.id] || 0)).join('');

  document.querySelectorAll('.editor-card').forEach(card => {
    card.addEventListener('click', () => openPanel(card.dataset.id, editors, taskCounts));
  });
}

function editorCard(e, activeTasks, totalPoints) {
  const initials = e.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const tierClass = `badge-tier-${e.speed_tier.toLowerCase()}`;
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
    <div class="editor-stats">
      <div class="editor-stat"><span class="editor-stat-val">${activeTasks}</span><span class="editor-stat-label">Active Tasks</span></div>
      <div class="editor-stat"><span class="editor-stat-val">${totalPoints}</span><span class="editor-stat-label">Queue Points</span></div>
    </div>
  </div>`;
}

async function openPanel(editorId, editors, taskCounts) {
  const editor = editors.find(e => e.id === editorId);
  if (!editor) return;

  document.getElementById('panel-editor-name').textContent = editor.name;

  const [{ data: tools }, { data: history }] = await Promise.all([
    db.from('editor_tools').select('*').eq('editor_id', editorId).order('tool_name'),
    db.from('speed_tier_history').select('*').eq('editor_id', editorId).order('changed_at', { ascending: false }),
  ]);

  document.getElementById('panel-content').innerHTML = `
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

init();
