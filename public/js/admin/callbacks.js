/* ---------- Call back requests ---------- */
const callbacksBody = document.getElementById('callbacksBody');
const CALLBACK_STATUS_LABELS = { pending: 'New', called: 'Called', closed: 'Closed' };
let allCallbacks = [];
let newCallbackIds = new Set();

const formatDateTime = (d) => new Date(d).toLocaleString('en-IN', {
  day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
});

async function loadCallbacks(background = false) {
  if (!background) callbacksBody.innerHTML = '<tr><td colspan="6" class="table-empty">Loading call back requests…</td></tr>';
  try {
    const res = await fetch('/api/admin/callbacks');
    if (background && sessionEnded(res)) return;
    if (!res.ok) throw new Error();
    const fresh = await res.json();
    if (background && JSON.stringify(fresh) === JSON.stringify(allCallbacks)) return;
    const known = new Set(allCallbacks.map((c) => c.id));
    newCallbackIds = new Set(background ? fresh.map((c) => c.id).filter((id) => !known.has(id)) : []);
    allCallbacks = fresh;
    setTabCount(document.getElementById('callbackCount'), allCallbacks);
    renderWhenFree(callbacksBody, renderCallbacks);
  } catch (err) {
    if (background) return;
    callbacksBody.innerHTML = '<tr><td colspan="6" class="table-empty">Failed to load call back requests.</td></tr>';
  }
}

function renderCallbacks() {
  if (!allCallbacks.length) {
    callbacksBody.innerHTML = '<tr><td colspan="6" class="table-empty">No call back requests yet.</td></tr>';
    return;
  }
  callbacksBody.innerHTML = '';
  allCallbacks.forEach((c) => {
    const tr = document.createElement('tr');
    tr.dataset.id = c.id;
    [formatDateTime(c.created_at), c.name, c.phone, c.query].forEach((text) => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    });
    tr.children[2].replaceChildren(telLink(c.phone));

    const statusTd = document.createElement('td');
    const select = document.createElement('select');
    select.className = `status-select status-${c.status}`;
    Object.entries(CALLBACK_STATUS_LABELS).forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (value === c.status) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', async () => {
      select.className = `status-select status-${select.value}`;
      try {
        const res = await fetch(`/api/admin/callbacks/${c.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: select.value }),
        });
        if (!res.ok) throw new Error();
        c.status = select.value;
        setTabCount(document.getElementById('callbackCount'), allCallbacks);
        select.blur();
      } catch (err) {
        alert('Failed to update status.');
      }
    });
    statusTd.appendChild(select);
    tr.appendChild(statusTd);

    const actionTd = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn';
    delBtn.title = 'Delete call back request';
    delBtn.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Delete the call back request from ${c.name}?`)) return;
      await fetch(`/api/admin/callbacks/${c.id}`, { method: 'DELETE' });
      allCallbacks = allCallbacks.filter((x) => x.id !== c.id);
      setTabCount(document.getElementById('callbackCount'), allCallbacks);
      renderCallbacks();
    });
    actionTd.appendChild(delBtn);
    tr.appendChild(actionTd);

    markNewRow(tr, newCallbackIds, c.id);
    callbacksBody.appendChild(tr);
  });
  newCallbackIds = new Set();
}
