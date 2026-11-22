/* ---------- Approvals: a manager's important changes wait for the owner ---------- */
// When a manager saves a rate, staff login, sale lot, the home page numbers or
// the yard address, the server keeps it for the owner (202 "pending"). Every
// screen then shows that message instead of treating it as saved.
(() => {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await nativeFetch(...args);
    if (res.status !== 202) return res;
    const data = await res.clone().json().catch(() => null);
    if (!data || !data.pending) return res;
    setTimeout(() => { if (typeof loadApprovals === 'function') loadApprovals(true); }, 300);
    const message = `${data.message} No need to send it again; see the Approvals tab.`;
    return new Response(JSON.stringify({ error: message, pending: true }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  };
})();

const approvalList = document.getElementById('approvalList');
const approvalCount = document.getElementById('approvalCount');
const APPROVAL_STATUS = {
  pending: 'Waiting for the owner', approved: 'Approved, live', rejected: 'Rejected', failed: 'Could not be applied',
};
let approvalData = { owner: false, items: [] };

async function loadApprovals(background = false) {
  if (!background) approvalList.innerHTML = '<p class="table-empty">Loading…</p>';
  try {
    const res = await fetch('/api/admin/approvals');
    if (background && typeof sessionEnded === 'function' && sessionEnded(res)) return;
    if (!res.ok) throw new Error();
    approvalData = await res.json();
    const waiting = approvalData.items.filter((a) => a.status === 'pending').length;
    approvalCount.textContent = waiting ? `${waiting} waiting` : '';
    approvalCount.hidden = !waiting;
    renderApprovals();
  } catch (err) {
    if (!background) approvalList.innerHTML = '<p class="table-empty">Failed to load approvals.</p>';
  }
}

function approvalCard(a) {
  const card = document.createElement('article');
  card.className = `admin-card approval-card approval-${a.status}`;
  const head = document.createElement('div');
  head.className = 'grievance-head';
  const title = document.createElement('strong');
  title.textContent = a.summary;
  const badge = document.createElement('span');
  badge.className = `approval-badge approval-badge-${a.status}`;
  badge.textContent = APPROVAL_STATUS[a.status] || a.status;
  head.append(title, badge);
  const who = document.createElement('p');
  who.className = 'grievance-who';
  who.textContent = `Asked by ${a.requested_by_name || 'a manager'} · ${formatDateTime(a.created_at)}${a.decided_at ? ` · ${a.status === 'pending' ? '' : `decided by ${a.decided_by_name}, ${formatDateTime(a.decided_at)}`}` : ''}`;
  const list = document.createElement('ul');
  list.className = 'approval-details';
  (a.details || []).forEach((line) => {
    const li = document.createElement('li');
    li.textContent = line;
    list.appendChild(li);
  });
  card.append(head, who, list);
  if (a.decision_note) {
    const note = document.createElement('p');
    note.className = 'approval-note';
    note.textContent = `Note: ${a.decision_note}`;
    card.appendChild(note);
  }
  if (approvalData.owner && a.status === 'pending') {
    const actions = document.createElement('div');
    actions.className = 'approval-actions';
    const note = document.createElement('input');
    note.type = 'text';
    note.maxLength = 300;
    note.placeholder = 'Note for the manager (optional)';
    note.setAttribute('aria-label', 'Note for the manager');
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.className = 'btn btn-accent btn-sm';
    approve.textContent = 'Approve and Make Live';
    const reject = document.createElement('button');
    reject.type = 'button';
    reject.className = 'btn btn-outline btn-sm';
    reject.textContent = 'Reject';
    const decide = async (verb) => {
      if (verb === 'approve' && !confirm(`Approve and make this live?\n\n${a.summary}\n${(a.details || []).join('\n')}`)) return;
      approve.disabled = true;
      reject.disabled = true;
      try {
        const res = await fetch(`/api/admin/approvals/${a.id}/${verb}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: note.value }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not save the decision.');
        if (data.status === 'failed') alert(`It could not be applied: ${data.note}`);
        await loadApprovals(true);
        if (typeof loadTodo === 'function') loadTodo();
      } catch (err) {
        alert(err.message);
        approve.disabled = false;
        reject.disabled = false;
      }
    };
    approve.addEventListener('click', () => decide('approve'));
    reject.addEventListener('click', () => decide('reject'));
    actions.append(note, approve, reject);
    card.appendChild(actions);
  }
  return card;
}

function renderApprovals() {
  if (!approvalData.items.length) {
    approvalList.innerHTML = `<p class="table-empty">${approvalData.owner ? 'Nothing waiting. When a manager changes rates, staff logins, lots for sale, the home page numbers or the yard address, it waits here for you.' : 'You have not asked for any changes yet.'}</p>`;
    return;
  }
  approvalList.replaceChildren(...approvalData.items.map(approvalCard));
}

document.querySelector('.tab-btn[data-tab="approvals"]').addEventListener('click', () => loadApprovals());
window.SELive.on('approvals', () => loadApprovals(true));
