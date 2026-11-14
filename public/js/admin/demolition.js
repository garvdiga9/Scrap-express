/* ---------- Demolition requests ---------- */
const demolitionBody = document.getElementById('demolitionBody');
const demolitionStatusFilter = document.getElementById('demolitionStatusFilter');
let allDemolitionRequests = [];
let newDemolitionIds = new Set();

async function loadDemolitionRequests(background = false) {
  if (!background) demolitionBody.innerHTML = '<tr><td colspan="9" class="table-empty">Loading requests…</td></tr>';
  try {
    const res = await fetch('/api/admin/demolition');
    if (background && sessionEnded(res)) return;
    if (!res.ok) throw new Error();
    const fresh = await res.json();
    if (background && JSON.stringify(fresh) === JSON.stringify(allDemolitionRequests)) return;
    const known = new Set(allDemolitionRequests.map((r) => r.id));
    newDemolitionIds = new Set(background ? fresh.map((r) => r.id).filter((id) => !known.has(id)) : []);
    allDemolitionRequests = fresh;
    renderWhenFree(demolitionBody, renderDemolitionRequests);
    setTabCount(document.getElementById('demolitionCount'), allDemolitionRequests);
  } catch (err) {
    if (background) return;
    demolitionBody.innerHTML = '<tr><td colspan="9" class="table-empty">Failed to load requests.</td></tr>';
  }
}

function renderDemolitionRequests() {
  const filter = demolitionStatusFilter.value;
  const rows = allDemolitionRequests.filter((r) => filter === 'all' || r.status === filter);
  if (!rows.length) {
    demolitionBody.innerHTML = '<tr><td colspan="9" class="table-empty">No requests found.</td></tr>';
    return;
  }
  demolitionBody.innerHTML = '';
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.dataset.id = r.id;

    const cells = [
      new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      r.name,
      r.phone,
      r.building_type,
      [r.area, r.location].filter(Boolean).join(' · '),
      r.approx_area || '-',
    ];
    cells.forEach((text) => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    });
    tr.children[2].replaceChildren(telLink(r.phone));
    tr.children[4].append(document.createElement('br'), mapLink(r, r.location));

    const mediaTd = document.createElement('td');
    if (r.media && r.media.length) {
      const mediaBtn = document.createElement('button');
      mediaBtn.className = 'view-btn';
      mediaBtn.textContent = `View ${r.media.length}`;
      mediaBtn.title = describeMedia(r.media);
      mediaBtn.addEventListener('click', () => {
        document.getElementById('mediaDialogTitle').textContent = `Demolition Request #${r.id} · ${r.name}`;
        renderMediaGallery(document.getElementById('mediaDialogBody'), r.media);
        mediaDialog.showModal();
      });
      mediaTd.appendChild(mediaBtn);
    } else {
      mediaTd.textContent = '-';
    }
    tr.appendChild(mediaTd);

    const statusTd = document.createElement('td');
    const select = document.createElement('select');
    select.className = `status-select status-${r.status}`;
    ['pending', 'confirmed', 'completed', 'cancelled'].forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s.charAt(0).toUpperCase() + s.slice(1);
      if (s === r.status) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', async () => {
      select.className = `status-select status-${select.value}`;
      try {
        const res = await fetch(`/api/admin/demolition/${r.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: select.value }),
        });
        if (!res.ok) throw new Error();
        r.status = select.value;
        setTabCount(document.getElementById('demolitionCount'), allDemolitionRequests);
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
    delBtn.title = 'Delete request';
    delBtn.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
    delBtn.addEventListener('click', async () => {
      if (!confirm('Delete this demolition request?')) return;
      await fetch(`/api/admin/demolition/${r.id}`, { method: 'DELETE' });
      allDemolitionRequests = allDemolitionRequests.filter((x) => x.id !== r.id);
      renderDemolitionRequests();
    });
    const docsBtn = document.createElement('button');
    docsBtn.className = 'view-btn';
    docsBtn.textContent = 'Papers';
    docsBtn.title = 'Weighbridge slip, GST invoice';
    docsBtn.addEventListener('click', () => window.SEDocs.openDialog('demolition', r.id, `Demolition Request #${r.id} · ${r.name}`));
    actionTd.append(docsBtn, ' ');
    actionTd.appendChild(delBtn);
    tr.appendChild(actionTd);

    markNewRow(tr, newDemolitionIds, r.id);
    demolitionBody.appendChild(tr);
  });
  newDemolitionIds = new Set();
}
demolitionStatusFilter.addEventListener('change', renderDemolitionRequests);
