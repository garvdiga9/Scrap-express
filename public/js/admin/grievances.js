/* ---------- Complaints to the Grievance Officer ---------- */
// Each complaint is acknowledged automatically with a ticket number; the team
// replies here and marks it resolved within 7 days. The customer sees the
// status and the reply on /grievance/status.
const grievanceList = document.getElementById('grievanceList');
const grievanceCount = document.getElementById('grievanceCount');
const GRIEVANCE_STATUSES = { open: 'Received', in_progress: 'Being looked into', resolved: 'Resolved', closed: 'Closed' };
let allGrievances = [];

function setGrievanceCount() {
  const open = allGrievances.filter((g) => ['open', 'in_progress'].includes(g.status)).length;
  grievanceCount.textContent = open ? `${open} open` : '';
  grievanceCount.hidden = !open;
}

async function loadGrievances(background = false) {
  if (!background) grievanceList.innerHTML = '<p class="table-empty">Loading complaints…</p>';
  try {
    const res = await fetch('/api/admin/grievances');
    if (background && sessionEnded(res)) return;
    if (!res.ok) throw new Error();
    const fresh = await res.json();
    if (background && JSON.stringify(fresh) === JSON.stringify(allGrievances)) return;
    allGrievances = fresh;
    setGrievanceCount();
    // Don't redraw while someone is typing a reply.
    if (background && grievanceList.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
    renderGrievances();
  } catch (err) {
    if (!background) grievanceList.innerHTML = '<p class="table-empty">Failed to load complaints.</p>';
  }
}

function grievanceCard(g) {
  const card = document.createElement('article');
  card.className = `admin-card grievance-card${g.overdue ? ' grievance-overdue' : ''}`;
  card.dataset.id = g.id;
  const head = document.createElement('div');
  head.className = 'grievance-head';
  const title = document.createElement('strong');
  title.textContent = `${g.ticket} · ${g.category}`;
  const when = document.createElement('span');
  when.textContent = `${formatDateTime(g.created_at)}${g.overdue ? ' · past 7 days' : ''}`;
  head.append(title, when);

  const who = document.createElement('p');
  who.className = 'grievance-who';
  who.append(`${g.name} · `, telLink(g.phone));
  if (g.email) who.append(` · ${g.email}`);
  if (g.request_ref) who.append(` · ${g.request_ref}`);

  const message = document.createElement('p');
  message.className = 'grievance-message';
  message.textContent = g.message;

  const form = document.createElement('form');
  form.className = 'grievance-reply-form';
  const status = document.createElement('select');
  status.className = 'status-select';
  status.setAttribute('aria-label', 'Status');
  Object.entries(GRIEVANCE_STATUSES).forEach(([value, label]) => status.append(new Option(label, value, false, value === g.status)));
  const reply = document.createElement('textarea');
  reply.rows = 3;
  reply.maxLength = 2000;
  reply.placeholder = 'Reply to the customer: what was checked and what was done. They see this on the status page.';
  reply.value = g.response || '';
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn btn-accent';
  save.textContent = 'Save';
  const alertBox = document.createElement('p');
  alertBox.className = 'form-alert error';
  alertBox.hidden = true;
  form.append(status, reply, alertBox, save);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertBox.hidden = true;
    save.disabled = true;
    try {
      const res = await fetch(`/api/admin/grievances/${g.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: status.value, response: reply.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      Object.assign(g, data, { overdue: false });
      setGrievanceCount();
      renderGrievances();
    } catch (err) {
      alertBox.textContent = err.message;
      alertBox.hidden = false;
    } finally {
      save.disabled = false;
    }
  });
  card.append(head, who, message, form);
  return card;
}

function renderGrievances() {
  if (!allGrievances.length) {
    grievanceList.innerHTML = '<p class="table-empty">No complaints yet.</p>';
    return;
  }
  grievanceList.replaceChildren(...allGrievances.map(grievanceCard));
}

document.querySelector('.tab-btn[data-tab="grievances"]').addEventListener('click', () => loadGrievances());
window.SELive.on('grievances', () => loadGrievances(true));
