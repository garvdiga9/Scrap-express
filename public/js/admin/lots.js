/* ---------- Buy From Us tab: lots ---------- */
const lotForm = document.getElementById('lotForm');
const LOT_FIELDS = ['material', 'title', 'grade', 'quantity', 'unit', 'location', 'status', 'description'];
const lotField = (name) => document.getElementById(`lot${name[0].toUpperCase()}${name.slice(1)}`);

function resetLotForm() {
  lotForm.reset();
  document.getElementById('lotEditId').value = '';
  document.getElementById('lotFormTitle').textContent = 'Add a lot for sale';
  document.getElementById('lotSaveBtn').textContent = 'Add Lot';
  document.getElementById('lotCancelEdit').hidden = true;
  showBoxAlert('lotFormAlert', '', 'error');
}

function editLot(lot) {
  LOT_FIELDS.forEach((name) => { lotField(name).value = lot[name] ?? ''; });
  document.getElementById('lotEditId').value = lot.id;
  document.getElementById('lotFormTitle').textContent = `Edit: ${lot.title}`;
  document.getElementById('lotSaveBtn').textContent = 'Save Changes';
  document.getElementById('lotCancelEdit').hidden = false;
  lotForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function lotCard(lot) {
  const card = document.createElement('article');
  card.className = `admin-lot admin-lot-${lot.status}`;
  const head = document.createElement('div');
  head.className = 'admin-lot-head';
  const title = document.createElement('strong');
  title.textContent = lot.title;
  const meta = document.createElement('span');
  meta.className = 'lead-meta';
  meta.textContent = [lot.material, lot.grade, `${Number(lot.quantity).toLocaleString('en-IN')} ${lot.unit}`, lot.status].filter(Boolean).join(' · ');
  head.append(title, meta);

  const photos = document.createElement('div');
  photos.className = 'image-list image-list-small';
  lot.images.forEach((image) => photos.appendChild(imageTile(image, '')));

  const actions = document.createElement('div');
  actions.className = 'admin-lot-actions';
  const addPhoto = document.createElement('label');
  addPhoto.className = 'btn btn-outline btn-sm';
  addPhoto.textContent = 'Add photo';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.hidden = true;
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    addPhoto.firstChild.textContent = 'Uploading…';
    try {
      await uploadImage({ kind: 'lot', lotId: lot.id }, file, 1600);
      loadLots();
    } catch (err) {
      alert(err.message);
      addPhoto.firstChild.textContent = 'Add photo';
    }
  });
  addPhoto.appendChild(fileInput);
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'btn btn-outline btn-sm';
  edit.textContent = 'Edit';
  edit.addEventListener('click', () => editLot(lot));
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'icon-btn';
  remove.title = 'Delete lot';
  remove.setAttribute('aria-label', `Delete ${lot.title}`);
  remove.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
  remove.addEventListener('click', async () => {
    if (!confirm(`Delete "${lot.title}" and its photos? To just hide it, set the status to Sold.`)) return;
    await fetch(`/api/admin/lots/${lot.id}`, { method: 'DELETE' });
    loadLots();
  });
  actions.append(addPhoto, edit, remove);
  card.append(head, photos, actions);
  return card;
}

const ENQUIRY_LABELS = { new: 'New', contacted: 'Contacted', closed: 'Closed' };

function enquiryRow(enquiry) {
  const tr = document.createElement('tr');
  const cells = [
    formatDateTime(enquiry.created_at),
    enquiry.lot_title || '-',
    [enquiry.name, enquiry.company].filter(Boolean).join(', '),
    '',
    enquiry.message || '-',
  ];
  cells.forEach((value) => {
    const td = document.createElement('td');
    td.textContent = value;
    tr.appendChild(td);
  });
  tr.children[3].appendChild(telLink(enquiry.phone));
  if (enquiry.email) {
    const mail = document.createElement('a');
    mail.href = `mailto:${enquiry.email}`;
    mail.textContent = enquiry.email;
    tr.children[3].append(document.createElement('br'), mail);
  }
  const statusTd = document.createElement('td');
  const select = document.createElement('select');
  select.className = `status-select status-${enquiry.status === 'new' ? 'pending' : enquiry.status === 'contacted' ? 'confirmed' : 'completed'}`;
  select.setAttribute('aria-label', 'Enquiry status');
  Object.entries(ENQUIRY_LABELS).forEach(([value, label]) => select.append(new Option(label, value, false, value === enquiry.status)));
  select.addEventListener('change', async () => {
    await fetch(`/api/admin/lot-enquiries/${enquiry.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: select.value }),
    });
  });
  statusTd.appendChild(select);
  const actionTd = document.createElement('td');
  const remove = document.createElement('button');
  remove.className = 'icon-btn';
  remove.title = 'Delete enquiry';
  remove.setAttribute('aria-label', 'Delete enquiry');
  remove.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
  remove.addEventListener('click', async () => {
    if (!confirm('Delete this enquiry?')) return;
    await fetch(`/api/admin/lot-enquiries/${enquiry.id}`, { method: 'DELETE' });
    tr.remove();
  });
  actionTd.appendChild(remove);
  tr.append(statusTd, actionTd);
  return tr;
}

async function loadLots() {
  try {
    await loadContentOptions();
    const [lotsRes, enquiriesRes] = await Promise.all([fetch('/api/admin/lots'), fetch('/api/admin/lot-enquiries')]);
    if (!lotsRes.ok || !enquiriesRes.ok) return;
    const [allLots, enquiries] = await Promise.all([lotsRes.json(), enquiriesRes.json()]);
    const list = document.getElementById('adminLots');
    list.innerHTML = allLots.length ? '' : '<p class="table-empty">No lots yet. Add one above; the public page shows a "no lots right now" message until then.</p>';
    allLots.forEach((lot) => list.appendChild(lotCard(lot)));
    const body = document.getElementById('lotEnquiriesBody');
    body.innerHTML = enquiries.length ? '' : '<tr><td colspan="7" class="table-empty">No enquiries yet.</td></tr>';
    enquiries.forEach((enquiry) => body.appendChild(enquiryRow(enquiry)));
    const fresh = enquiries.filter((x) => x.status === 'new').length;
    const count = document.getElementById('lotEnquiryCount');
    count.textContent = fresh;
    count.hidden = !fresh;
  } catch (err) {
    // Tried again when something changes.
  }
}

lotForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showBoxAlert('lotFormAlert', '', 'error');
  const body = Object.fromEntries(LOT_FIELDS.map((name) => [name, lotField(name).value]));
  const id = document.getElementById('lotEditId').value;
  try {
    const res = await fetch(id ? `/api/admin/lots/${id}` : '/api/admin/lots', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save the lot.');
    resetLotForm();
    showBoxAlert('lotFormAlert', id ? 'Saved.' : 'Lot added. Use "Add photo" on it below.', 'success');
    loadLots();
  } catch (err) {
    showBoxAlert('lotFormAlert', err.message, 'error');
  }
});
document.getElementById('lotCancelEdit').addEventListener('click', resetLotForm);

// Load when the dashboard opens, and again on any change.
document.querySelectorAll('.tab-btn[data-tab="photos"], .tab-btn[data-tab="lots"]').forEach((btn) => {
  btn.addEventListener('click', () => (btn.dataset.tab === 'photos' ? loadPhotos() : loadLots()));
});
window.SELive.on('lots', () => { if (!dashboard.hidden) loadLots(); });
window.SELive.on('reviews', () => { if (!dashboard.hidden) loadPhotos(); });
new MutationObserver(() => {
  if (!dashboard.hidden) {
    loadPhotos();
    loadLots();
  }
}).observe(dashboard, { attributes: true, attributeFilter: ['hidden'] });
