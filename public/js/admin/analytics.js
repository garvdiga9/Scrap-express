/* ---------- Analytics tab ---------- */
const CONVERSIONS = ['quote_request', 'lead', 'demolition_request', 'callback_request', 'call_click', 'whatsapp_click', 'lot_enquiry'];

function miniTable(id, rows, empty) {
  const table = document.getElementById(id);
  table.innerHTML = '';
  if (!rows.length) {
    table.innerHTML = `<tr><td class="table-empty">${empty}</td></tr>`;
    return;
  }
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const page = document.createElement('td');
    page.textContent = row.path || '/';
    const count = document.createElement('td');
    count.className = 'num';
    count.textContent = row.count.toLocaleString('en-IN');
    tr.append(page, count);
    table.appendChild(tr);
  });
}

async function loadAnalytics() {
  try {
    const days = document.getElementById('analyticsRange').value;
    const res = await fetch(`/api/admin/analytics?days=${days}`);
    if (!res.ok) return;
    const data = await res.json();
    const { totals, labels } = data;
    const conversions = CONVERSIONS.reduce((sum, e) => sum + (totals[e] || 0), 0);
    const rate = totals.page_view ? ((conversions / totals.page_view) * 100).toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '0';

    const tiles = document.getElementById('analyticsTiles');
    tiles.innerHTML = '';
    const tile = (label, value, accent) => {
      const div = document.createElement('div');
      div.className = `stat-tile${accent ? ' stat-tile-accent' : ''}`;
      const v = document.createElement('strong');
      v.textContent = value;
      const l = document.createElement('span');
      l.textContent = label;
      div.append(v, l);
      tiles.appendChild(div);
    };
    tile(labels.page_view, totals.page_view.toLocaleString('en-IN'));
    tile('Requests, calls & chats', conversions.toLocaleString('en-IN'), true);
    tile('Conversion rate', `${rate}%`, true);
    ['quote_request', 'lead', 'call_click', 'whatsapp_click', 'callback_request', 'demolition_request', 'lot_enquiry', 'subscribe']
      .forEach((e) => tile(labels[e], (totals[e] || 0).toLocaleString('en-IN')));

    // Per-day bars: visits (light) with conversions (dark) on top.
    const chart = document.getElementById('analyticsChart');
    chart.innerHTML = '';
    const byDay = new Map();
    for (let i = Number(days) - 1; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      byDay.set(day, { views: 0, conversions: 0 });
    }
    data.daily.forEach((row) => {
      const slot = byDay.get(row.day);
      if (!slot) return;
      if (row.event === 'page_view') slot.views += row.count;
      else if (CONVERSIONS.includes(row.event)) slot.conversions += row.count;
    });
    const max = Math.max(1, ...[...byDay.values()].map((d) => d.views));
    byDay.forEach((d, day) => {
      const bar = document.createElement('div');
      bar.className = 'chart-bar';
      bar.title = `${day}: ${d.views} visits, ${d.conversions} requests/calls`;
      const views = document.createElement('span');
      views.className = 'chart-views';
      views.style.height = `${(d.views / max) * 100}%`;
      const conv = document.createElement('span');
      conv.className = 'chart-conversions';
      conv.style.height = `${Math.min(100, (d.conversions / max) * 100)}%`;
      bar.append(views, conv);
      chart.appendChild(bar);
    });
    chart.setAttribute('aria-label', `Visits and conversions per day over the last ${days} days: ${totals.page_view} visits and ${conversions} requests or calls in total.`);

    miniTable('analyticsPages', data.topPages, 'No visits counted yet.');
    miniTable('analyticsConverting', data.topConvertingPages, 'No requests or calls yet.');
  } catch (err) {
    // Tried again when the tab is opened.
  }
}
document.querySelector('.tab-btn[data-tab="analytics"]').addEventListener('click', loadAnalytics);
document.getElementById('analyticsRange').addEventListener('change', loadAnalytics);
