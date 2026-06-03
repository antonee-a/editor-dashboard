import { db } from './supabase.js';

let trendChart, formatChart, clientChart;
let currentRange = 'week';

async function init() {
  bindRangeButtons();
  await loadAnalytics();
}

// ── Date Range ─────────────────────────────
function rangeStart(range) {
  const d = new Date();
  if (range === 'week')  { d.setDate(d.getDate() - 7); return d.toISOString().slice(0,10); }
  if (range === 'month') { d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0,10); }
  return null;
}

function bindRangeButtons() {
  document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRange = btn.dataset.range;
      await loadAnalytics();
    });
  });
}

// ── Load ───────────────────────────────────
async function loadAnalytics() {
  const start = rangeStart(currentRange);

  let query = db.from('tasks').select('*, editors(name, speed_tier)');
  if (start) query = query.gte('date_assigned', start);

  const [{ data: tasks }, { data: editors }] = await Promise.all([
    query,
    db.from('editors').select('id, name, speed_tier'),
  ]);
  if (!tasks) return;

  renderStats(tasks);
  renderTrendChart(tasks);
  renderFormatChart(tasks);
  renderClientChart(tasks);
  renderVelocityTable(tasks, editors || []);
}

// ── Stats Row ──────────────────────────────
function renderStats(tasks) {
  const completed = tasks.filter(t => t.status === 'Completed');
  const open      = tasks.filter(t => t.status !== 'Completed');
  const ratings   = completed.filter(t => t.quality_rating).map(t => t.quality_rating);
  const avgQ      = ratings.length ? (ratings.reduce((a,b) => a+b, 0) / ratings.length).toFixed(1) : '—';

  document.getElementById('stat-total').textContent     = tasks.length;
  document.getElementById('stat-open').textContent      = open.length;
  document.getElementById('stat-completed').textContent = completed.length;
  document.getElementById('stat-avg-quality').textContent = avgQ;
}

// ── Trend Chart ────────────────────────────
function renderTrendChart(tasks) {
  const completed = tasks.filter(t => t.status === 'Completed' && t.date_assigned);

  // Group by week
  const byDate = {};
  completed.forEach(t => {
    const d = t.date_assigned.slice(0, 10);
    byDate[d] = (byDate[d] || 0) + 1;
  });
  const sorted = Object.keys(byDate).sort();
  const labels = sorted.map(d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  const values = sorted.map(d => byDate[d]);

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(document.getElementById('chart-trend'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Completed',
        data: values,
        backgroundColor: 'rgba(108,99,255,.6)',
        borderColor: '#6c63ff',
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: chartOpts({ legend: false })
  });
}

// ── Format Chart ───────────────────────────
function renderFormatChart(tasks) {
  const counts = {};
  tasks.filter(t => t.format).forEach(t => { counts[t.format] = (counts[t.format] || 0) + 1; });
  const labels = Object.keys(counts);
  const values = labels.map(l => counts[l]);

  if (formatChart) formatChart.destroy();
  formatChart = new Chart(document.getElementById('chart-format'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: PALETTE }] },
    options: doughnutOpts()
  });
}

// ── Client Chart ───────────────────────────
function renderClientChart(tasks) {
  const counts = {};
  tasks.forEach(t => { counts[t.client] = (counts[t.client] || 0) + 1; });
  const labels = Object.keys(counts);
  const values = labels.map(l => counts[l]);

  if (clientChart) clientChart.destroy();
  clientChart = new Chart(document.getElementById('chart-client'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: PALETTE }] },
    options: doughnutOpts()
  });
}

// ── Velocity Helpers ───────────────────────
const TIER_BASELINE = { Onboarding: 8, Standard: 15, Fast: 22, Elite: 30 };

function velocityGrade(ptsPerDay, baseline) {
  if (!baseline || !ptsPerDay) return { label: '—', color: 'var(--text-muted)' };
  const ratio = ptsPerDay / baseline;
  if (ratio >= 1.2) return { label: 'Excellent',      color: '#22c55e' };
  if (ratio >= 1.0) return { label: 'Fast',           color: '#3b82f6' };
  if (ratio >= 0.8) return { label: 'On Track',       color: '#a5a0ff' };
  if (ratio >= 0.6) return { label: 'Slow',           color: '#f59e0b' };
  return                  { label: 'Not Performing',  color: '#ef4444' };
}

// ── Velocity Table ─────────────────────────
function renderVelocityTable(tasks, editors) {
  const completed = tasks.filter(t => t.status === 'Completed');
  const tbody = document.getElementById('velocity-tbody');

  if (!completed.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="loading">No completed tasks in this range.</td></tr>';
    return;
  }

  // Group by editor name
  const editorMap = {};
  completed.forEach(t => {
    const name = t.editors?.name || 'Unassigned';
    if (!editorMap[name]) editorMap[name] = [];
    editorMap[name].push(t);
  });

  const start = rangeStart(currentRange);
  const days  = start ? Math.max(1, Math.round((Date.now() - new Date(start)) / 86400000)) : 30;

  const rows = Object.entries(editorMap).map(([name, items]) => {
    const totalPts     = items.reduce((sum, t) => sum + (t.task_points || 0), 0);
    const ptsPerDay    = totalPts / days;
    const avgRevisions = avg(items.map(t => t.revisions ?? 0));
    const avgQuality   = avg(items.filter(t => t.quality_rating).map(t => t.quality_rating));
    const avgSpeed     = avg(items.filter(t => t.speed_rating).map(t => t.speed_rating));
    const reliability  = reliabilityPct(items);

    const editorRecord = editors.find(e => e.name === name);
    const tier         = editorRecord?.speed_tier || '—';
    const baseline     = TIER_BASELINE[tier] || null;
    const grade        = velocityGrade(ptsPerDay, baseline);

    return `<tr>
      <td style="font-weight:600">${name}</td>
      <td>${items.length}</td>
      <td style="font-weight:700">${totalPts}</td>
      <td style="font-weight:700;color:${grade.color}">${ptsPerDay.toFixed(1)}</td>
      <td>${avgRevisions.toFixed(1)}</td>
      <td>${avgQuality ? avgQuality.toFixed(1) : '—'}</td>
      <td>${avgSpeed   ? avgSpeed.toFixed(1)   : '—'}</td>
      <td>${reliability}%</td>
      <td><span style="font-weight:700;color:${grade.color}">${grade.label}</span></td>
      <td>${tier !== '—' ? `<span class="badge badge-tier-${tier.toLowerCase()}">${tier}</span>` : '—'}</td>
    </tr>`;
  });

  tbody.innerHTML = rows.join('');
}

// ── Helpers ────────────────────────────────
function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function reliabilityPct(tasks) {
  const withDue = tasks.filter(t => t.due_date);
  if (!withDue.length) return '—';
  const onTime = withDue.filter(t => t.created_at?.slice(0,10) <= t.due_date).length;
  return Math.round((onTime / withDue.length) * 100);
}

const PALETTE = ['#6c63ff','#22c55e','#f59e0b','#3b82f6','#ef4444','#a855f7'];

function chartOpts({ legend = true } = {}) {
  return {
    responsive: true,
    plugins: {
      legend: { display: legend, labels: { color: '#7a7f9a', font: { size: 12 } } },
    },
    scales: {
      x: { ticks: { color: '#7a7f9a', font: { size: 11 } }, grid: { color: '#2e3148' } },
      y: { ticks: { color: '#7a7f9a', font: { size: 11 } }, grid: { color: '#2e3148' } },
    }
  };
}

function doughnutOpts() {
  return {
    responsive: true,
    plugins: {
      legend: { position: 'bottom', labels: { color: '#7a7f9a', font: { size: 11 }, padding: 10 } }
    }
  };
}

init();
