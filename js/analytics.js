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

  let query = db.from('tasks').select('*, editors(name)');
  if (start) query = query.gte('date_assigned', start);
  const { data: tasks } = await query;
  if (!tasks) return;

  renderStats(tasks);
  renderTrendChart(tasks);
  renderFormatChart(tasks);
  renderClientChart(tasks);
  renderVelocityTable(tasks);
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

// ── Velocity Table ─────────────────────────
function renderVelocityTable(tasks) {
  const completed = tasks.filter(t => t.status === 'Completed');

  // Group by editor
  const editorMap = {};
  completed.forEach(t => {
    const name = t.editors?.name || 'Unassigned';
    if (!editorMap[name]) editorMap[name] = [];
    editorMap[name].push(t);
  });

  // Get current speed tiers
  const tbody = document.getElementById('velocity-tbody');

  if (!Object.keys(editorMap).length) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading">No completed tasks in this range.</td></tr>';
    return;
  }

  const rows = Object.entries(editorMap).map(([name, items]) => {
    const avgRevisions = avg(items.map(t => t.revisions ?? 0));
    const avgQuality   = avg(items.filter(t => t.quality_rating).map(t => t.quality_rating));
    const avgSpeed     = avg(items.filter(t => t.speed_rating).map(t => t.speed_rating));
    const reliability  = reliabilityPct(items);

    // Days in range
    const start = rangeStart(currentRange);
    const days  = start ? Math.max(1, Math.round((Date.now() - new Date(start)) / 86400000)) : 30;
    const perDay = (items.length / days).toFixed(2);

    // Get speed tier from last task's editor data (approximate — real source is editors table)
    const tier = '—';

    return `<tr>
      <td style="font-weight:600">${name}</td>
      <td>${items.length}</td>
      <td>${avgRevisions.toFixed(1)}</td>
      <td>${avgQuality ? avgQuality.toFixed(1) : '—'}</td>
      <td>${avgSpeed   ? avgSpeed.toFixed(1)   : '—'}</td>
      <td>${perDay}</td>
      <td>${reliability}%</td>
      <td>—</td>
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
