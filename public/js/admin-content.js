// Admin: Photos tab (site photos, client logos) and Buy From Us tab (lots
// for recyclers and enquiries). Loaded after admin.js and uses its helpers
// (formatDateTime, telLink, sessionEnded).

let contentOptions = null;
async function loadContentOptions() {
  if (contentOptions) return contentOptions;
  const res = await fetch('/api/admin/options');
  if (!res.ok) throw new Error('Could not load the lists.');
  contentOptions = await res.json();
  const fill = (id, items, toOption) => {
    const select = document.getElementById(id);
    select.innerHTML = '';
    items.forEach((item) => select.append(toOption(item)));
  };
  fill('galleryCategory', contentOptions.galleryCategories, (c) => new Option(c.label, c.key));
  fill('lotMaterial', contentOptions.lotMaterials, (m) => new Option(m, m));
  fill('lotUnit', contentOptions.lotUnits, (u) => new Option(u, u));
  return contentOptions;
}

function showBoxAlert(id, message, type) {
  const box = document.getElementById(id);
  box.textContent = message;
  box.className = `form-alert ${type}`;
  box.hidden = !message;
}

/* ---------- Turning a photo into WebP before upload ---------- */
// Smaller and the same format for every photo; the server only takes WebP.
async function toWebp(file, maxSide) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Please choose a photo.');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    throw new Error("This browser can't open that photo. Please use a JPG or PNG (iPhone: set Camera → Formats → Most Compatible).");
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
  if (!blob || blob.type !== 'image/webp') {
    throw new Error("This browser can't make WebP images. Please use Chrome, Edge or Firefox to upload photos.");
  }
  return blob;
}

async function uploadImage(fields, file, maxSide) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  form.append('image', await toWebp(file, maxSide), 'photo.webp');
  const res = await fetch('/api/admin/images', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed.');
  return data;
}

function imageTile(image, label) {
  const tile = document.createElement('figure');
  tile.className = 'image-tile';
  const img = document.createElement('img');
  img.src = image.url;
  img.alt = image.alt_text;
  img.loading = 'lazy';
  const caption = document.createElement('figcaption');
  caption.textContent = label;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'icon-btn';
  remove.setAttribute('aria-label', `Delete ${image.alt_text}`);
  remove.title = 'Delete';
  remove.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
  remove.addEventListener('click', async () => {
    if (!confirm('Delete this photo from the site?')) return;
    await fetch(`/api/admin/images/${image.id}`, { method: 'DELETE' });
    tile.remove();
  });
  tile.append(img, caption, remove);
  return tile;
}

/* ---------- Photos tab ---------- */
async function loadPhotos() {
  try {
    const { galleryCategories } = await loadContentOptions();
    const [gallery, logos] = await Promise.all(['gallery', 'logo'].map(async (kind) => {
      const res = await fetch(`/api/admin/images?kind=${kind}`);
      if (!res.ok) throw new Error();
      return res.json();
    }));
    const galleryList = document.getElementById('galleryList');
    galleryList.innerHTML = gallery.length ? '' : '<p class="table-empty">No photos yet. The home page section stays hidden until you add one.</p>';
    gallery.forEach((image) => {
      const category = (galleryCategories.find((c) => c.key === image.category) || {}).label || '';
      galleryList.appendChild(imageTile(image, `${category}: ${image.alt_text}`));
    });
    const logoList = document.getElementById('logoList');
    logoList.innerHTML = logos.length ? '' : '<p class="table-empty">No client logos yet.</p>';
    logos.forEach((image) => logoList.appendChild(imageTile(image, image.company_name)));
  } catch (err) {
    // Tried again when the tab is opened or something changes.
  }
}

document.getElementById('galleryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  showBoxAlert('galleryAlert', '', 'error');
  const file = document.getElementById('galleryFile').files[0];
  const altText = document.getElementById('galleryAlt').value.trim();
  if (!file || altText.length < 5) {
    showBoxAlert('galleryAlert', 'Please choose a photo and describe it in a few words.', 'error');
    return;
  }
  button.disabled = true;
  button.textContent = 'Uploading…';
  try {
    await uploadImage({
      kind: 'gallery',
      category: document.getElementById('galleryCategory').value,
      altText,
      caption: document.getElementById('galleryCaption').value.trim(),
    }, file, 1600);
    form.reset();
    showBoxAlert('galleryAlert', 'Added. It now shows on the home page.', 'success');
    loadPhotos();
  } catch (err) {
    showBoxAlert('galleryAlert', err.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Upload Photo';
  }
});

document.getElementById('logoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  showBoxAlert('logoAlert', '', 'error');
  const file = document.getElementById('logoFile').files[0];
  const companyName = document.getElementById('logoCompany').value.trim();
  if (!file || !companyName) {
    showBoxAlert('logoAlert', 'Please choose the logo and enter the company name.', 'error');
    return;
  }
  if (!document.getElementById('logoPermission').checked) {
    showBoxAlert('logoAlert', "Please tick the box to confirm you have the company's permission.", 'error');
    return;
  }
  button.disabled = true;
  button.textContent = 'Uploading…';
  try {
    await uploadImage({ kind: 'logo', companyName, permission: 'true' }, file, 600);
    form.reset();
    showBoxAlert('logoAlert', 'Added to the home page.', 'success');
    loadPhotos();
  } catch (err) {
    showBoxAlert('logoAlert', err.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Upload Logo';
  }
});

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

/* ---------- Papers on a request: weighbridge slip, GST invoice ---------- */
window.SEDocs = (() => {
  const LABELS = { weight_slip: 'Weighbridge slip', invoice: 'GST invoice', other: 'Other document' };

  async function render(box, requestType, requestId) {
    box.innerHTML = '';
    const title = document.createElement('h3');
    title.textContent = 'Papers for the customer';
    const hint = document.createElement('p');
    hint.className = 'quote-hint';
    hint.textContent = 'Upload the weighbridge slip and GST invoice (PDF or photo). The customer can download them from My Account or their quote link, and gets an alert.';
    const list = document.createElement('ul');
    list.className = 'docs-list';
    list.innerHTML = '<li class="table-empty">Loading…</li>';

    const form = document.createElement('form');
    form.className = 'docs-form';
    const kind = document.createElement('select');
    kind.setAttribute('aria-label', 'Kind of document');
    Object.entries(LABELS).forEach(([value, label]) => kind.append(new Option(label, value)));
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'application/pdf,image/jpeg,image/png,image/webp';
    file.setAttribute('aria-label', 'Document file');
    const button = document.createElement('button');
    button.type = 'submit';
    button.className = 'btn btn-accent btn-sm';
    button.textContent = 'Upload';
    const alertBox = document.createElement('p');
    alertBox.className = 'form-alert error';
    alertBox.hidden = true;
    form.append(kind, file, button);
    box.append(title, hint, list, form, alertBox);

    async function refresh() {
      const res = await fetch(`/api/admin/documents?requestType=${requestType}&requestId=${requestId}`);
      const docs = res.ok ? await res.json() : [];
      list.innerHTML = docs.length ? '' : '<li class="table-empty">None yet.</li>';
      docs.forEach((doc) => {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = `/api/admin/documents/${doc.id}/file`;
        link.textContent = `${LABELS[doc.kind]} (${doc.original_name || 'file'})`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'icon-btn';
        remove.setAttribute('aria-label', `Delete ${LABELS[doc.kind]}`);
        remove.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
        remove.addEventListener('click', async () => {
          if (!confirm('Delete this document? The customer will no longer see it.')) return;
          await fetch(`/api/admin/documents/${doc.id}`, { method: 'DELETE' });
          refresh();
        });
        li.append(link, remove);
        list.appendChild(li);
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.hidden = true;
      if (!file.files[0]) {
        alertBox.textContent = 'Please choose the file.';
        alertBox.hidden = false;
        return;
      }
      const body = new FormData();
      body.append('requestType', requestType);
      body.append('requestId', requestId);
      body.append('kind', kind.value);
      body.append('file', file.files[0]);
      button.disabled = true;
      button.textContent = 'Uploading…';
      try {
        const res = await fetch('/api/admin/documents', { method: 'POST', body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Upload failed.');
        form.reset();
        refresh();
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
      } finally {
        button.disabled = false;
        button.textContent = 'Upload';
      }
    });
    refresh();
  }

  const docsDialog = document.getElementById('docsDialog');
  document.getElementById('docsDialogClose').addEventListener('click', () => docsDialog.close());
  docsDialog.addEventListener('click', (e) => { if (e.target === docsDialog) docsDialog.close(); });

  return {
    mount: render,
    openDialog(requestType, requestId, title) {
      document.getElementById('docsDialogTitle').textContent = title;
      render(document.getElementById('docsDialogBody'), requestType, requestId);
      docsDialog.showModal();
    },
  };
})();

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

/* ---------- Install the admin as its own app ----------
   Chrome and Edge (phone and laptop) offer an install prompt; the button
   shows it. On iPhone/iPad there is no prompt, so the button explains the
   Share → Add to Home Screen steps. Hidden once it's running as an app. */
(() => {
  const button = document.getElementById('installAdminBtn');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) return;
  let promptEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    promptEvent = e;
    button.hidden = false;
  });
  window.addEventListener('appinstalled', () => { button.hidden = true; });
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIos) button.hidden = false;
  button.addEventListener('click', async () => {
    if (promptEvent) {
      promptEvent.prompt();
      await promptEvent.userChoice.catch(() => {});
      promptEvent = null;
      button.hidden = true;
    } else if (isIos) {
      alert('To install: tap the Share button in Safari, then "Add to Home Screen".');
    }
  });
})();

/* ---------- Staff tab ---------- */
const staffForm = document.getElementById('staffForm');
let staffList = [];
document.getElementById('staffAppAddress').textContent = `${window.location.origin}/staff.html`;

function resetStaffForm() {
  staffForm.reset();
  document.getElementById('staffEditId').value = '';
  document.getElementById('staffFormTitle').textContent = 'Add a staff member';
  document.getElementById('staffSaveBtn').textContent = 'Add Staff Member';
  document.getElementById('staffPassLabel').textContent = 'Password (6+ characters)';
  document.getElementById('staffCancelEdit').hidden = true;
}

async function saveStaffMember(id, body) {
  const res = await fetch(id ? `/api/admin/staff/${id}` : '/api/admin/staff', {
    method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not save the staff member.');
  return data;
}

function staffRow(s) {
  const tr = document.createElement('tr');
  tr.className = s.active ? '' : 'row-muted';
  [s.name, s.username, '', s.open_pickups, s.done_pickups, s.last_login_at ? formatDateTime(s.last_login_at) : 'Never'].forEach((value) => {
    const td = document.createElement('td');
    td.textContent = value;
    tr.appendChild(td);
  });
  if (s.phone) tr.children[2].appendChild(telLink(s.phone));
  else tr.children[2].textContent = '-';

  const statusTd = document.createElement('td');
  const toggle = document.createElement('button');
  toggle.className = 'view-btn owner-only';
  toggle.textContent = s.active ? 'Active: switch off' : 'Off: switch on';
  toggle.title = s.active ? 'Stops this person signing in' : 'Lets this person sign in again';
  toggle.addEventListener('click', async () => {
    try {
      await saveStaffMember(s.id, { name: s.name, username: s.username, phone: s.phone, active: !s.active });
      loadStaff();
    } catch (err) {
      alert(err.message);
    }
  });
  statusTd.appendChild(toggle);

  const actionTd = document.createElement('td');
  const edit = document.createElement('button');
  edit.className = 'view-btn owner-only';
  edit.textContent = 'Edit / new password';
  edit.addEventListener('click', () => {
    document.getElementById('staffEditId').value = s.id;
    document.getElementById('staffName').value = s.name;
    document.getElementById('staffPhone').value = s.phone || '';
    document.getElementById('staffUser').value = s.username;
    document.getElementById('staffPass').value = '';
    document.getElementById('staffFormTitle').textContent = `Edit: ${s.name}`;
    document.getElementById('staffSaveBtn').textContent = 'Save Changes';
    document.getElementById('staffPassLabel').textContent = 'New password (leave empty to keep)';
    document.getElementById('staffCancelEdit').hidden = false;
    staffForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const remove = document.createElement('button');
  remove.className = 'icon-btn';
  remove.title = 'Delete staff member';
  remove.setAttribute('aria-label', `Delete ${s.name}`);
  remove.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
  remove.addEventListener('click', async () => {
    if (!confirm(`Delete ${s.name}? Their pickups stay, without a name. To only stop them signing in, switch them off instead.`)) return;
    await fetch(`/api/admin/staff/${s.id}`, { method: 'DELETE' });
    loadStaff();
  });
  actionTd.append(edit, ' ', remove);
  tr.append(statusTd, actionTd);
  return tr;
}

async function loadStaff() {
  try {
    const res = await fetch('/api/admin/staff');
    if (!res.ok) return;
    staffList = await res.json();
    const body = document.getElementById('staffBody');
    body.innerHTML = staffList.length ? '' : '<tr><td colspan="8" class="table-empty">No staff yet. Add the first one above.</td></tr>';
    staffList.forEach((s) => body.appendChild(staffRow(s)));
  } catch (err) {
    // Tried again when the tab is opened.
  }
}

staffForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showBoxAlert('staffFormAlert', '', 'error');
  const id = document.getElementById('staffEditId').value;
  try {
    await saveStaffMember(id, {
      name: document.getElementById('staffName').value,
      phone: document.getElementById('staffPhone').value.trim(),
      username: document.getElementById('staffUser').value,
      password: document.getElementById('staffPass').value,
    });
    resetStaffForm();
    showBoxAlert('staffFormAlert', id ? 'Saved.' : 'Added. Give them the username and password, and the Staff app address above.', 'success');
    loadStaff();
  } catch (err) {
    showBoxAlert('staffFormAlert', err.message, 'error');
  }
});
document.getElementById('staffCancelEdit').addEventListener('click', resetStaffForm);
document.querySelector('.tab-btn[data-tab="staff"]').addEventListener('click', loadStaff);
window.SELive.on('requests', () => { if (!dashboard.hidden) loadStaff(); });
new MutationObserver(() => { if (!dashboard.hidden) loadStaff(); }).observe(dashboard, { attributes: true, attributeFilter: ['hidden'] });

/* ---------- A pickup's slots, staff member and weighing (request details) ---------- */
window.SESchedule = (() => {
  const CAN_OFFER = ['accepted', 'ready', 'confirmed', 'slots_sent', 'scheduled'];
  const ASSIGNABLE = ['scheduled', 'on_way', 'arrived'];
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const plusDays = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  function slotRow(date, from, to) {
    const row = document.createElement('div');
    row.className = 'slot-row';
    const d = document.createElement('input');
    d.type = 'date';
    d.min = today();
    d.value = date;
    d.setAttribute('aria-label', 'Slot date');
    const f = document.createElement('input');
    f.type = 'time';
    f.value = from;
    f.setAttribute('aria-label', 'From');
    const t = document.createElement('input');
    t.type = 'time';
    t.value = to;
    t.setAttribute('aria-label', 'To');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-btn';
    remove.setAttribute('aria-label', 'Remove this slot');
    remove.innerHTML = '&times;';
    remove.addEventListener('click', () => row.remove());
    const busy = document.createElement('span');
    busy.className = 'slot-busy';
    row.append(d, f, document.createTextNode('to'), t, remove, busy);
    return row;
  }

  // Ask the server how many pickups are already booked or offered at each
  // proposed time, and show it next to the slot.
  async function checkBusy(rows) {
    const list = [...rows.children];
    const slots = list.map((row) => {
      const [d, f, t] = row.querySelectorAll('input');
      return { date: d.value, from: f.value, to: t.value };
    });
    try {
      const res = await fetch('/api/admin/slots/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slots }),
      });
      if (!res.ok) return;
      const result = await res.json();
      list.forEach((row, i) => {
        const busy = row.querySelector('.slot-busy');
        const info = result.find((x) => x.date === slots[i].date && x.from === slots[i].from && x.to === slots[i].to);
        if (!info) { busy.textContent = ''; return; }
        busy.textContent = info.full
          ? `Full: ${info.booked} of ${info.perSlot} booked`
          : `${info.booked} of ${info.perSlot} booked${info.offered ? `, offered to ${info.offered} more` : ''}`;
        busy.classList.toggle('slot-full', info.full);
      });
    } catch (err) {
      // Just no hint.
    }
  }

  // After an action: reload the requests and redraw this panel.
  async function refresh() {
    if (document.activeElement) document.activeElement.blur();
    delete document.getElementById('requestSchedule').dataset.dirty;
    try {
      await loadRequests();
      updateOpenDialog();
    } catch (err) {
      // The live update will catch up.
    }
  }

  async function send(url, body, method = 'POST') {
    const isForm = body instanceof FormData;
    const res = await fetch(url, {
      method, headers: isForm ? undefined : { 'Content-Type': 'application/json' }, body: isForm ? body : JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save that.');
    return data;
  }

  const outsideLabel = (r) => [
    `${r.outside_provider || 'Outside'} truck`,
    r.outside_vehicle,
    r.outside_driver && `driver ${r.outside_driver}`,
    r.outside_phone,
    r.outside_fare != null && `fare ₹${Number(r.outside_fare).toLocaleString('en-IN')}`,
  ].filter(Boolean).join(' · ');

  const field = (labelText, input) => {
    const label = document.createElement('label');
    label.textContent = `${labelText} `;
    label.appendChild(input);
    return label;
  };
  const textInput = (value, max, placeholder, type = 'text') => {
    const input = document.createElement('input');
    input.type = type;
    input.value = value ?? '';
    if (max) input.maxLength = max;
    if (placeholder) input.placeholder = placeholder;
    return input;
  };
  const alertLine = () => {
    const p = document.createElement('p');
    p.className = 'form-alert error';
    p.hidden = true;
    return p;
  };
  const showError = (box, err) => { box.textContent = err.message; box.hidden = false; };

  // The truck's details. Saving takes the pickup off the staff's list.
  function outsideTruckForm(r) {
    const form = document.createElement('form');
    form.className = 'outside-form';
    form.noValidate = true;
    const heading = document.createElement('strong');
    heading.textContent = r.office_handled ? 'Outside truck details' : 'Book an outside truck, then fill this in';
    const provider = document.createElement('select');
    const known = ['Porter', 'Delhivery'];
    [...known, 'Other'].forEach((p) => provider.append(new Option(p, p)));
    const other = textInput(known.includes(r.outside_provider) ? '' : r.outside_provider, 40, 'Company name');
    provider.value = !r.outside_provider || known.includes(r.outside_provider) ? (r.outside_provider || 'Porter') : 'Other';
    const otherLabel = field('Company', other);
    otherLabel.hidden = provider.value !== 'Other';
    provider.addEventListener('change', () => { otherLabel.hidden = provider.value !== 'Other'; });
    const driver = textInput(r.outside_driver, 100, 'Optional');
    const phone = textInput(r.outside_phone, 15, 'Optional', 'tel');
    const vehicle = textInput(r.outside_vehicle, 20, 'e.g. DL1LA1234');
    const fare = textInput(r.outside_fare, 9, 'What you pay them', 'number');
    fare.min = '0';
    const grid = document.createElement('div');
    grid.className = 'outside-grid';
    grid.append(field('Truck from', provider), otherLabel, field('Driver name', driver), field('Driver phone', phone), field('Vehicle number', vehicle), field('Fare (₹)', fare));
    const hint = document.createElement('p');
    hint.className = 'quote-hint';
    hint.textContent = 'The customer is told the driver name and vehicle number (not the phone or fare). You then mark each step below yourself.';
    const alertBox = alertLine();
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'btn btn-accent btn-sm';
    save.textContent = r.office_handled ? 'Save Truck Details' : 'Use Outside Truck';
    form.append(heading, grid, hint, alertBox, save);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.hidden = true;
      save.disabled = true;
      try {
        await send(`/api/admin/requests/${r.id}/outside`, {
          provider: provider.value === 'Other' ? other.value : provider.value,
          driver: driver.value, phone: phone.value, vehicle: vehicle.value, fare: fare.value,
        }, 'PUT');
        await refresh();
      } catch (err) {
        showError(alertBox, err);
        save.disabled = false;
      }
    });
    return form;
  }

  const lineAmount = (line, qty) => {
    const q = Number(qty) || 0;
    if (line.unit === 'per kg' || line.unit === 'per piece') return q * line.rate;
    if (line.unit === 'per tonne') return (q / 1000) * line.rate;
    if (line.unit === 'lump sum') return Number(line.rate) || 0;
    return 0;
  };

  // The weights for each quoted material, and the photo if the driver sent one.
  function weighForm(r) {
    const form = document.createElement('form');
    form.className = 'office-weigh';
    form.noValidate = true;
    const lines = Array.isArray(r.quote_items) ? r.quote_items : [];
    const before = Array.isArray(r.weighed_items) ? r.weighed_items : [];
    const inputs = lines.map((line, i) => {
      const input = textInput(before[i] && before[i].qty != null ? before[i].qty : '', 10, '', 'number');
      input.min = '0';
      input.step = 'any';
      const unit = line.unit === 'per piece' ? 'pieces' : 'kg';
      if (line.unit === 'lump sum') {
        input.hidden = true;
        form.appendChild(field(`${line.material}: fixed ₹${Number(line.rate).toLocaleString('en-IN')}`, input));
      } else {
        form.appendChild(field(`${line.material} (${unit}) at ₹${line.rate} ${line.unit}`, input));
      }
      return input;
    });
    const total = document.createElement('p');
    total.className = 'schedule-chosen';
    const update = () => {
      const amount = lines.reduce((sum, line, i) => sum + lineAmount(line, inputs[i].value), 0);
      total.textContent = `Amount: ₹${(Math.round(amount * 100) / 100).toLocaleString('en-IN')}`;
    };
    form.addEventListener('input', update);
    update();
    const photo = document.createElement('input');
    photo.type = 'file';
    photo.accept = 'image/*';
    const alertBox = alertLine();
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'btn btn-accent btn-sm';
    save.textContent = r.status === 'weighed' ? 'Save Corrected Weights' : 'Save Weighing';
    form.append(total, field('Weighing photo from the driver (optional)', photo), alertBox, save);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.hidden = true;
      const quantities = lines.map((line, i) => (line.unit === 'lump sum' ? null : inputs[i].value === '' ? null : Number(inputs[i].value)));
      if (!lines.length) return showError(alertBox, new Error('This pickup has no quote to work the amount out from.'));
      save.disabled = true;
      try {
        let body = { quantities };
        if (photo.files[0]) {
          body = new FormData();
          body.append('quantities', JSON.stringify(quantities));
          body.append('file', photo.files[0]);
        }
        await send(`/api/admin/requests/${r.id}/office/weigh`, body);
        await refresh();
      } catch (err) {
        showError(alertBox, err);
        save.disabled = false;
      }
    });
    return form;
  }

  function payForm(r) {
    const form = document.createElement('form');
    form.className = 'office-pay';
    form.noValidate = true;
    const due = r.amount_due == null ? null : Number(r.amount_due);
    const method = document.createElement('select');
    method.append(new Option('Cash', 'cash'), new Option('Bank transfer', 'bank'));
    const amount = textInput(due ?? '', 12, '', 'number');
    amount.min = '0';
    const note = textInput('', 300, 'Only if the amount is different');
    const alertBox = alertLine();
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'btn btn-accent btn-sm';
    save.textContent = 'Mark Paid and Finish';
    form.append(field('Paid by', method), field('Amount paid (₹)', amount), field('Reason', note), alertBox, save);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.hidden = true;
      const words = method.value === 'cash' ? 'paid in cash' : 'to be sent by bank transfer';
      if (!confirm(`₹${Number(amount.value || 0).toLocaleString('en-IN')} ${words}, and finish pickup #${r.id}?`)) return;
      save.disabled = true;
      try {
        await send(`/api/admin/requests/${r.id}/office/paid`, { method: method.value, amount: amount.value, note: note.value });
        await refresh();
      } catch (err) {
        showError(alertBox, err);
        save.disabled = false;
      }
    });
    return form;
  }

  // The steps the office marks for an outside truck, one at a time.
  function officeSteps(r) {
    const wrap = document.createElement('div');
    wrap.className = 'office-steps';
    const heading = document.createElement('strong');
    heading.textContent = 'You run this pickup';
    wrap.appendChild(heading);
    const alertBox = alertLine();
    const stepButton = (text, url, body, ask) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = ask ? 'btn btn-outline btn-sm office-noscrap' : 'btn btn-accent btn-sm';
      b.textContent = text;
      b.addEventListener('click', async () => {
        if (ask && !confirm(ask)) return;
        b.disabled = true;
        alertBox.hidden = true;
        try {
          await send(url, body);
          await refresh();
        } catch (err) {
          showError(alertBox, err);
          b.disabled = false;
        }
      });
      return b;
    };
    const base = `/api/admin/requests/${r.id}/office`;
    if (r.status === 'scheduled') {
      wrap.appendChild(stepButton('Truck Is On the Way', `${base}/step`, { step: 'on_way' }));
    } else if (r.status === 'on_way') {
      wrap.appendChild(stepButton('Truck Has Arrived', `${base}/step`, { step: 'arrived' }));
    } else if (r.status === 'arrived') {
      wrap.appendChild(weighForm(r));
      wrap.appendChild(stepButton('No Scrap at Site', `${base}/no-scrap`, {}, 'Mark this pickup as "no scrap at site"? The customer will be told.'));
    } else if (r.status === 'weighed') {
      wrap.appendChild(payForm(r));
      const fix = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Correct the weights';
      fix.append(summary, weighForm(r));
      wrap.appendChild(fix);
    } else {
      const done = document.createElement('p');
      done.className = 'quote-hint';
      done.textContent = 'Nothing left to do on this pickup.';
      wrap.appendChild(done);
    }
    wrap.appendChild(alertBox);
    return wrap;
  }

  // Book one of the offered times for the customer (they called, or a time is
  // full for our own trucks): the office's choice, no limits.
  function bookControl(r) {
    const choices = (r.slots || []).filter((s) => s.id !== r.slot_id);
    if (!choices.length) return null;
    const wrap = document.createElement('div');
    wrap.className = 'schedule-staff book-slot';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Time to book');
    choices.forEach((s) => select.append(new Option(s.label, s.id)));
    const alertBox = alertLine();
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-outline btn-sm';
    b.textContent = r.status === 'scheduled' ? 'Move to This Time' : 'Book This Time for the Customer';
    b.addEventListener('click', async () => {
      if (!confirm(`Book ${select.selectedOptions[0].text} for pickup #${r.id}? The customer is told.`)) return;
      b.disabled = true;
      alertBox.hidden = true;
      try {
        await send(`/api/admin/requests/${r.id}/book-slot`, { slotId: Number(select.value) });
        await refresh();
      } catch (err) {
        showError(alertBox, err);
        b.disabled = false;
      }
    });
    wrap.append(select, ' ', b, alertBox);
    return wrap;
  }

  function mount(box, r) {
    box.innerHTML = '';
    // Half-filled forms here survive live updates (admin.js updateOpenDialog).
    delete box.dataset.dirty;
    box.oninput = () => { box.dataset.dirty = '1'; };
    const title = document.createElement('h3');
    title.textContent = 'Pickup slot and staff';
    box.appendChild(title);
    const note = (text, className = 'quote-hint') => {
      const p = document.createElement('p');
      p.className = className;
      p.textContent = text;
      box.appendChild(p);
      return p;
    };

    if (!r.quote_response && !CAN_OFFER.includes(r.status)) {
      note('After the customer accepts your quote, you send 2–3 free pickup slots here and they choose one.');
      return;
    }

    // A ready-written WhatsApp message for where the pickup is now.
    if (['slots_sent', 'scheduled', 'on_way', 'weighed', 'completed', 'no_scrap', 'cancelled'].includes(r.status)) {
      const update = document.createElement('a');
      update.className = 'btn btn-outline btn-sm wa-update';
      update.target = '_blank';
      update.rel = 'noopener';
      update.textContent = 'WhatsApp update';
      update.title = 'Opens WhatsApp with a message about the current step';
      update.hidden = true;
      fetch(`/api/admin/requests/${r.id}/update-text`).then((res) => res.json()).then((data) => {
        if (!data.text) return;
        const digits = String(r.phone).replace(/\D/g, '').slice(-10);
        update.href = `https://wa.me/91${digits}?text=${encodeURIComponent(data.text)}`;
        update.hidden = false;
        const sent = [data.channels.email && r.email ? 'email' : null, data.channels.whatsapp ? 'automatic WhatsApp' : null].filter(Boolean);
        update.title = sent.length
          ? `Already sent by ${sent.join(' and ')}; this opens WhatsApp to send it yourself too`
          : 'Email and automatic WhatsApp are not switched on, so send this yourself';
      }).catch(() => {});
      box.appendChild(update);
    }

    // What's been offered or chosen so far.
    if (r.chosen_slot) {
      note(`Slot chosen: ${r.chosen_slot.label}`, 'schedule-chosen');
    } else if (r.slots && r.slots.length) {
      const deadline = formatDateTime(r.slots_deadline);
      note(r.slots_expired
        ? `The customer did not choose by ${deadline}. Call them, or send new slots below.`
        : `Waiting for the customer to choose by ${deadline}: ${r.slots.map((s) => s.label).join('  |  ')}`,
      r.slots_expired ? 'schedule-expired' : 'quote-hint');
      if (r.quote_token) {
        const share = document.createElement('a');
        share.className = 'btn btn-outline btn-sm';
        share.target = '_blank';
        share.rel = 'noopener';
        const digits = String(r.phone).replace(/\D/g, '').slice(-10);
        const text = `Hello ${r.name}, Scrap Express here. Please choose your pickup slot for request #${r.id}: ${window.location.origin}/quote/${r.quote_token}`;
        share.href = `https://wa.me/91${digits}?text=${encodeURIComponent(text)}`;
        share.textContent = 'Send the link on WhatsApp';
        box.appendChild(share);
      }
    }

    if (['slots_sent', 'scheduled'].includes(r.status)) {
      const book = bookControl(r);
      if (book) box.appendChild(book);
    }

    // Who is doing it: a staff member, or an outside truck the office runs.
    if (ASSIGNABLE.includes(r.status)) {
      const label = document.createElement('label');
      label.className = 'schedule-staff';
      label.textContent = 'Who is doing it ';
      const select = document.createElement('select');
      select.append(new Option('Anyone on staff (not taken yet)', ''));
      staffList.filter((s) => s.active || s.id === r.staff_id).forEach((s) => select.append(new Option(s.name, s.id, false, s.id === r.staff_id)));
      select.append(new Option('Outside truck (Porter, Delhivery…): I run it', 'outside', false, Boolean(r.office_handled)));
      const outsideForm = outsideTruckForm(r);
      outsideForm.hidden = !r.office_handled;
      select.addEventListener('change', async () => {
        if (select.value === 'outside') {
          outsideForm.hidden = false;
          outsideForm.querySelector('select, input').focus();
          return;
        }
        outsideForm.hidden = true;
        const res = await fetch(`/api/admin/requests/${r.id}/staff`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId: select.value || null }),
        });
        if (!res.ok) alert((await res.json().catch(() => ({}))).error || 'Could not assign the pickup.');
        refresh();
      });
      label.appendChild(select);
      box.appendChild(label);
      if (!staffList.length) note('No staff yet. Add them in the Staff tab, or use an outside truck.');
      box.appendChild(outsideForm);
    } else if (r.office_handled) {
      note(`Outside truck: ${outsideLabel(r)}`);
    } else if (r.staff_name) {
      note(`Staff member: ${r.staff_name}`);
    }

    // The office does the steps itself for an outside truck.
    if (r.office_handled) box.appendChild(officeSteps(r));

    // The weighing.
    if (r.weighed_kg != null) {
      const weighed = document.createElement('p');
      weighed.className = 'schedule-chosen';
      weighed.textContent = `Weighed: ${Number(r.weighed_kg).toLocaleString('en-IN')} kg `;
      if (r.weigh_photo_id) {
        const photo = document.createElement('a');
        photo.href = `/api/admin/documents/${r.weigh_photo_id}/file?view=1`;
        photo.target = '_blank';
        photo.rel = 'noopener';
        photo.textContent = 'See the weighing machine photo';
        weighed.appendChild(photo);
      }
      box.appendChild(weighed);
    }

    // Send (or re-send) slots.
    if (!CAN_OFFER.includes(r.status)) return;
    const form = document.createElement('form');
    form.className = 'slot-offer';
    form.noValidate = true;
    const heading = document.createElement('strong');
    heading.textContent = r.slots && r.slots.length ? 'Send new slots (replaces the ones above)' : 'Send 2–3 free pickup slots';
    const rows = document.createElement('div');
    rows.className = 'slot-rows';
    rows.append(slotRow(plusDays(1), '10:00', '13:00'), slotRow(plusDays(1), '14:00', '17:00'), slotRow(plusDays(2), '10:00', '13:00'));
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'add-line-btn';
    add.textContent = '+ Add a slot';
    add.addEventListener('click', () => {
      if (rows.children.length < 4) rows.appendChild(slotRow(plusDays(2), '14:00', '17:00'));
      checkBusy(rows);
    });
    rows.addEventListener('change', () => checkBusy(rows));
    rows.addEventListener('click', (e) => { if (e.target.closest('.icon-btn')) setTimeout(() => checkBusy(rows)); });
    setTimeout(() => checkBusy(rows));
    const deadlineLabel = document.createElement('label');
    deadlineLabel.className = 'schedule-staff';
    deadlineLabel.textContent = 'Customer must choose within ';
    const hours = document.createElement('select');
    [[6, '6 hours'], [12, '12 hours'], [24, '24 hours'], [48, '2 days'], [72, '3 days']].forEach(([value, text]) => hours.append(new Option(text, value, false, value === 24)));
    deadlineLabel.appendChild(hours);
    const alertBox = document.createElement('p');
    alertBox.className = 'form-alert error';
    alertBox.hidden = true;
    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'btn btn-accent';
    send.textContent = 'Send Slots to Customer';
    form.append(heading, rows, add, deadlineLabel, alertBox, send);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.hidden = true;
      const slots = [...rows.children].map((row) => {
        const [d, f, t] = row.querySelectorAll('input');
        return { date: d.value, from: f.value, to: t.value };
      });
      send.disabled = true;
      try {
        const res = await fetch(`/api/admin/requests/${r.id}/slots`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slots, deadlineHours: Number(hours.value) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not send the slots.');
        send.textContent = 'Sent ✓';
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
        send.disabled = false;
      }
    });
    box.appendChild(form);
  }

  return { mount };
})();

/* ---------- Money tab: cash with staff, bank transfers to make ---------- */
const inrAdmin = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function cashCard(s) {
  const card = document.createElement('article');
  card.className = 'cash-card';
  const head = document.createElement('div');
  head.className = 'cash-card-head';
  const name = document.createElement('strong');
  name.textContent = s.name;
  const since = document.createElement('span');
  since.className = 'lead-meta';
  since.textContent = s.since ? `Since the last settle-up on ${formatDateTime(s.since)}` : 'Since the start';
  head.append(name, since);

  const figures = document.createElement('dl');
  figures.className = 'cash-figures';
  [['Cash given', s.givenTotal], ['Paid to customers', s.paidTotal], ['Should have now', s.shouldHave]].forEach(([label, value]) => {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = inrAdmin(value);
    if (label === 'Should have now' && value < 0) dd.className = 'cash-negative';
    div.append(dt, dd);
    figures.appendChild(div);
  });

  const details = document.createElement('details');
  details.className = 'cash-details';
  const summary = document.createElement('summary');
  summary.textContent = `${s.given.length} cash given · ${s.paid.length} cash payment${s.paid.length === 1 ? '' : 's'}`;
  const list = document.createElement('ul');
  s.given.forEach((g) => {
    const li = document.createElement('li');
    li.textContent = `+ ${inrAdmin(g.amount)} given ${formatDateTime(g.created_at)}${g.note ? ` (${g.note})` : ''}`;
    list.appendChild(li);
  });
  s.paid.forEach((p) => {
    const li = document.createElement('li');
    li.textContent = `− ${inrAdmin(p.amount_paid)} to ${p.company_name} (#${p.id}) ${formatDateTime(p.paid_at)}`;
    list.appendChild(li);
  });
  details.append(summary, list);

  const actions = document.createElement('div');
  actions.className = 'cash-actions';
  const amountInput = (placeholder) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = 'any';
    input.inputMode = 'decimal';
    input.placeholder = placeholder;
    input.setAttribute('aria-label', placeholder);
    return input;
  };
  const giveAmount = amountInput('Cash to give (₹)');
  const giveBtn = document.createElement('button');
  giveBtn.type = 'button';
  giveBtn.className = 'btn btn-outline btn-sm';
  giveBtn.textContent = 'Give Cash';
  giveBtn.addEventListener('click', async () => {
    if (!(Number(giveAmount.value) > 0)) {
      alert('Please enter the amount of cash you gave.');
      return;
    }
    const res = await fetch('/api/admin/cash/give', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId: s.id, amount: giveAmount.value }),
    });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error || 'Could not save that.');
    loadMoney();
  });
  const settleAmount = amountInput('Cash handed back (₹)');
  const settleBtn = document.createElement('button');
  settleBtn.type = 'button';
  settleBtn.className = 'btn btn-accent btn-sm';
  settleBtn.textContent = 'Settle Up';
  settleBtn.addEventListener('click', async () => {
    if (settleAmount.value === '') {
      alert('Please enter the cash they handed back (0 if none).');
      return;
    }
    const back = Number(settleAmount.value);
    const diff = Math.round((back - s.shouldHave) * 100) / 100;
    let note = '';
    if (diff === 0) {
      if (!confirm(`Settle up ${s.name}: ${inrAdmin(back)} handed back, matches exactly?`)) return;
    } else {
      note = prompt(`They should have ${inrAdmin(s.shouldHave)} and handed back ${inrAdmin(back)}: ${diff > 0 ? 'extra' : 'short'} by ${inrAdmin(Math.abs(diff))}. Add a note (optional):`, '');
      if (note === null) return;
    }
    const res = await fetch('/api/admin/cash/settle', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId: s.id, returned: back, note }),
    });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error || 'Could not save that.');
    loadMoney();
  });
  actions.append(giveAmount, giveBtn, settleAmount, settleBtn);
  card.append(head, figures, details, actions);
  return card;
}

function bankRow(p) {
  const tr = document.createElement('tr');
  [`#${p.id} · ${formatDateTime(p.paid_at)}`, `${p.company_name} (${p.name})`, inrAdmin(p.amount_paid), p.staff_name || '-'].forEach((value) => {
    const td = document.createElement('td');
    td.textContent = value;
    tr.appendChild(td);
  });
  tr.children[1].append(document.createElement('br'), telLink(p.phone));
  const status = document.createElement('td');
  if (p.bank_paid_at) {
    status.textContent = `Paid ${formatDateTime(p.bank_paid_at)} · ref. ${p.bank_reference}`;
  } else {
    const ref = document.createElement('input');
    ref.type = 'text';
    ref.placeholder = 'UTR / cheque no.';
    ref.setAttribute('aria-label', `Payment reference for pickup ${p.id}`);
    ref.className = 'bank-ref';
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'btn btn-accent btn-sm';
    done.textContent = 'Mark Paid';
    done.addEventListener('click', async () => {
      if (!ref.value.trim()) {
        alert('Please enter the payment reference (UTR or cheque number).');
        return;
      }
      const res = await fetch(`/api/admin/requests/${p.id}/bank-paid`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: ref.value }),
      });
      if (!res.ok) alert((await res.json().catch(() => ({}))).error || 'Could not save that.');
      loadMoney();
    });
    status.append(ref, ' ', done);
  }
  tr.appendChild(status);
  return tr;
}

async function loadMoney() {
  try {
    const res = await fetch('/api/admin/cash');
    if (!res.ok) return;
    const data = await res.json();
    const t = data.totals;
    const tiles = document.getElementById('moneyTiles');
    tiles.innerHTML = '';
    [['Cash paid today', inrAdmin(t.cash_today)], ['Bank transfers today', inrAdmin(t.bank_today)], ['Weighed today', `${t.kg_today.toLocaleString('en-IN')} kg`],
      ['Paid this month', inrAdmin(t.paid_month)], ['Weighed this month', `${t.kg_month.toLocaleString('en-IN')} kg`], ['Bank transfers still to pay', inrAdmin(t.bank_to_pay)]]
      .forEach(([label, value], i) => {
        const div = document.createElement('div');
        div.className = `stat-tile${i === 5 && t.bank_to_pay > 0 ? ' stat-tile-warn' : ''}`;
        const v = document.createElement('strong');
        v.textContent = value;
        const l = document.createElement('span');
        l.textContent = label;
        div.append(v, l);
        tiles.appendChild(div);
      });
    // Don't redraw a card while an amount is being typed in it.
    const cards = document.getElementById('cashCards');
    if (!cards.contains(document.activeElement)) {
      cards.innerHTML = data.staff.length ? '' : '<p class="table-empty">No staff yet. Add them in the Staff tab.</p>';
      data.staff.forEach((s) => cards.appendChild(cashCard(s)));
    }
    const bank = document.getElementById('bankBody');
    if (!bank.contains(document.activeElement)) {
      bank.innerHTML = data.bank.length ? '' : '<tr><td colspan="5" class="table-empty">No bank transfers to make.</td></tr>';
      data.bank.forEach((p) => bank.appendChild(bankRow(p)));
    }
    const toPay = data.bank.filter((p) => !p.bank_paid_at).length;
    const count = document.getElementById('bankToPayCount');
    count.textContent = toPay;
    count.hidden = !toPay;
    const settled = document.getElementById('settleBody');
    settled.innerHTML = data.settled.length ? '' : '<tr><td colspan="6" class="table-empty">No settle-ups yet.</td></tr>';
    data.settled.forEach((x) => {
      const tr = document.createElement('tr');
      const diff = x.difference === 0 ? 'Matches' : `${x.difference > 0 ? '+' : '−'}${inrAdmin(Math.abs(x.difference))}`;
      [formatDateTime(x.created_at), x.name, inrAdmin(x.expected), inrAdmin(x.amount), diff, x.note || '-'].forEach((value, i) => {
        const td = document.createElement('td');
        td.textContent = value;
        if (i === 4 && x.difference < 0) td.className = 'cash-negative';
        tr.appendChild(td);
      });
      settled.appendChild(tr);
    });
  } catch (err) {
    // Tried again when the tab is opened.
  }
}
document.querySelector('.tab-btn[data-tab="money"]').addEventListener('click', loadMoney);
window.SELive.on('requests', () => { if (!dashboard.hidden) loadMoney(); });
new MutationObserver(() => { if (!dashboard.hidden) loadMoney(); }).observe(dashboard, { attributes: true, attributeFilter: ['hidden'] });

/* ---------- Pickups tab: the dispatch board ---------- */
const BOARD_STATUS = {
  scheduled: 'Booked', on_way: 'On the way', arrived: 'At the site', weighed: 'Weighed', completed: 'Done', no_scrap: 'No scrap',
};

function boardWindow(w, perSlot) {
  const box = document.createElement('div');
  box.className = `board-window${w.full ? ' board-full' : ''}`;
  const head = document.createElement('div');
  head.className = 'board-window-head';
  const time = document.createElement('strong');
  time.textContent = `${clockLabel(w.from)} – ${clockLabel(w.to)}`;
  const load = document.createElement('span');
  load.textContent = `${w.active} of ${perSlot} trucks${w.full ? ' · full' : ''}`;
  head.append(time, load);
  box.appendChild(head);
  w.booked.forEach((p) => {
    const row = document.createElement('a');
    row.className = `board-pickup board-${p.status}`;
    row.href = `#pickup-${p.id}`;
    const main = document.createElement('span');
    main.textContent = `#${p.id} ${p.company_name}${p.area ? ` · ${p.area}` : ''}`;
    const side = document.createElement('span');
    side.className = 'board-side';
    const who = p.office_handled ? `${p.outside_provider || 'Outside'} truck (you)` : p.staff_name || 'No staff yet';
    side.textContent = `${who} · ${BOARD_STATUS[p.status] || p.status}`;
    if (!p.staff_name && !p.office_handled && p.status === 'scheduled') side.classList.add('board-warn');
    row.append(main, side);
    box.appendChild(row);
  });
  w.offered.forEach((p) => {
    const row = document.createElement('a');
    row.className = 'board-pickup board-offered';
    row.href = `#pickup-${p.id}`;
    row.textContent = `Offered to #${p.id} ${p.company_name} (waiting for their answer)`;
    box.appendChild(row);
  });
  return box;
}

// "14:00" → "2 PM"
function clockLabel(time) {
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

async function loadBoard() {
  try {
    const res = await fetch(`/api/admin/board?days=${document.getElementById('boardDays').value}`);
    if (!res.ok) return;
    const data = await res.json();
    const perSlot = document.getElementById('perSlot');
    if (document.activeElement !== perSlot) perSlot.value = data.perSlot;
    const alertBox = document.getElementById('boardAlert');
    alertBox.hidden = !data.unassigned;
    alertBox.textContent = `${data.unassigned} booked pickup${data.unassigned === 1 ? ' has' : 's have'} no staff member yet. Open ${data.unassigned === 1 ? 'it' : 'them'} to assign someone, or wait for staff to take ${data.unassigned === 1 ? 'it' : 'them'}.`;
    const count = document.getElementById('unassignedCount');
    count.textContent = data.unassigned;
    count.hidden = !data.unassigned;
    const list = document.getElementById('boardDaysList');
    list.innerHTML = '';
    data.days.forEach((day) => {
      const section = document.createElement('section');
      section.className = 'board-day';
      const h = document.createElement('h3');
      h.textContent = day.label;
      section.appendChild(h);
      if (!day.windows.length) {
        const empty = document.createElement('p');
        empty.className = 'board-empty';
        empty.textContent = 'Nothing booked.';
        section.appendChild(empty);
      }
      day.windows.forEach((w) => section.appendChild(boardWindow(w, data.perSlot)));
      list.appendChild(section);
    });
  } catch (err) {
    // Tried again when the tab is opened.
  }
}
document.getElementById('boardDays').addEventListener('change', loadBoard);
document.getElementById('boardSettings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch('/api/admin/board/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ perSlot: Number(document.getElementById('perSlot').value) }),
  });
  if (!res.ok) alert((await res.json().catch(() => ({}))).error || 'Could not save.');
  loadBoard();
});
document.querySelector('.tab-btn[data-tab="board"]').addEventListener('click', loadBoard);
window.SELive.on('requests', () => { if (!dashboard.hidden) loadBoard(); });
new MutationObserver(() => { if (!dashboard.hidden) loadBoard(); }).observe(dashboard, { attributes: true, attributeFilter: ['hidden'] });
// The board links to "#pickup-12", which opens that request (admin.js).

/* ---------- Customers' ratings (Reviews tab) ---------- */
async function loadRatings() {
  try {
    const res = await fetch('/api/admin/ratings');
    if (!res.ok) return;
    const data = await res.json();
    document.getElementById('ratingsAverage').textContent = data.count ? `Average ${data.average} ★ from ${data.count}` : '';
    const body = document.getElementById('ratingsBody');
    body.innerHTML = data.ratings.length ? '' : '<tr><td colspan="5" class="table-empty">No ratings yet. Customers can rate each pickup once it is finished.</td></tr>';
    data.ratings.forEach((r) => {
      const tr = document.createElement('tr');
      [formatDateTime(r.rated_at), `#${r.id} ${r.company_name}`, `${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}`, r.rating_comment || '-'].forEach((value, i) => {
        const td = document.createElement('td');
        td.textContent = value;
        if (i === 2) td.className = r.rating <= 2 ? 'cash-negative' : 'rating-cell';
        tr.appendChild(td);
      });
      const action = document.createElement('td');
      if (r.review_id) {
        action.textContent = 'On the website';
      } else if (r.rating_public && r.rating_comment) {
        const publish = document.createElement('button');
        publish.className = 'view-btn';
        publish.textContent = 'Show on website';
        publish.addEventListener('click', async () => {
          if (!confirm('Show this comment on the home page as a review?')) return;
          const res2 = await fetch(`/api/admin/ratings/${r.id}/publish`, { method: 'POST' });
          if (!res2.ok) alert((await res2.json().catch(() => ({}))).error || 'Could not publish it.');
          loadRatings();
          loadTestimonials(true);
        });
        action.appendChild(publish);
      } else {
        action.textContent = r.rating_comment ? 'Private' : '-';
      }
      tr.appendChild(action);
      body.appendChild(tr);
    });
  } catch (err) {
    // Tried again when the tab is opened.
  }
}
document.querySelector('.tab-btn[data-tab="testimonials"]').addEventListener('click', loadRatings);
window.SELive.on('requests', () => { if (!dashboard.hidden) loadRatings(); });
new MutationObserver(() => { if (!dashboard.hidden) loadRatings(); }).observe(dashboard, { attributes: true, attributeFilter: ['hidden'] });

/* ---------- Team tab (owner only): manager logins and the activity log ---------- */
const teamForm = document.getElementById('teamForm');

function resetTeamForm() {
  teamForm.reset();
  document.getElementById('teamEditId').value = '';
  document.getElementById('teamFormTitle').textContent = 'Add a manager';
  document.getElementById('teamSaveBtn').textContent = 'Add Manager';
  document.getElementById('teamPassLabel').textContent = 'Password (8+ characters)';
  document.getElementById('teamCancelEdit').hidden = true;
}

async function teamRequest(url, method, body) {
  const res = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not save.');
  return data;
}

function teamRow(u) {
  const tr = document.createElement('tr');
  tr.className = u.active ? '' : 'row-muted';
  const cells = [u.name, u.username, '', u.last_login_at ? formatDateTime(u.last_login_at) : 'Never'].map((value) => {
    const td = document.createElement('td');
    td.textContent = value;
    tr.appendChild(td);
    return td;
  });
  const badge = document.createElement('span');
  badge.className = `role-badge ${u.role}`;
  badge.textContent = u.role === 'owner' ? 'Owner' : 'Manager';
  cells[2].appendChild(badge);

  const statusTd = document.createElement('td');
  const actionTd = document.createElement('td');
  if (u.role === 'owner') {
    statusTd.textContent = 'Always on';
    actionTd.textContent = 'Set on the server';
  } else {
    const toggle = document.createElement('button');
    toggle.className = 'view-btn';
    toggle.textContent = u.active ? 'Active: switch off' : 'Off: switch on';
    toggle.title = u.active ? 'Signs them out and stops them signing in' : 'Lets them sign in again';
    toggle.addEventListener('click', async () => {
      try {
        await teamRequest(`/api/admin/team/${u.id}`, 'PUT', { name: u.name, username: u.username, active: !u.active });
        loadTeam();
      } catch (err) {
        alert(err.message);
      }
    });
    statusTd.appendChild(toggle);

    const edit = document.createElement('button');
    edit.className = 'view-btn';
    edit.textContent = 'Edit / new password';
    edit.addEventListener('click', () => {
      document.getElementById('teamEditId').value = u.id;
      document.getElementById('teamName').value = u.name;
      document.getElementById('teamUser').value = u.username;
      document.getElementById('teamPass').value = '';
      document.getElementById('teamFormTitle').textContent = `Edit: ${u.name}`;
      document.getElementById('teamSaveBtn').textContent = 'Save Changes';
      document.getElementById('teamPassLabel').textContent = 'New password (leave empty to keep)';
      document.getElementById('teamCancelEdit').hidden = false;
      teamForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const remove = document.createElement('button');
    remove.className = 'icon-btn';
    remove.title = 'Delete login';
    remove.setAttribute('aria-label', `Delete ${u.name}`);
    remove.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
    remove.addEventListener('click', async () => {
      if (!confirm(`Delete the login for ${u.name}? They are signed out at once. What they did stays in the activity log.`)) return;
      try {
        await teamRequest(`/api/admin/team/${u.id}`, 'DELETE');
      } catch (err) {
        alert(err.message);
      }
      loadTeam();
    });
    actionTd.append(edit, ' ', remove);
  }
  tr.append(statusTd, actionTd);
  return tr;
}

const activityWho = document.getElementById('activityWho');
const activityArea = document.getElementById('activityArea');

async function loadActivity() {
  const body = document.getElementById('activityBody');
  try {
    const query = new URLSearchParams();
    if (activityWho.value) query.set('adminId', activityWho.value);
    if (activityArea.value) query.set('area', activityArea.value);
    const res = await fetch(`/api/admin/activity?${query}`);
    if (!res.ok) return;
    const list = await res.json();
    body.innerHTML = list.length ? '' : '<tr><td colspan="4" class="table-empty">Nothing yet.</td></tr>';
    list.forEach((a) => {
      const tr = document.createElement('tr');
      [formatDateTime(a.created_at), a.admin_name, a.action, a.detail || ''].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  } catch (err) {
    // Tried again when the tab is opened.
  }
}

async function loadTeam() {
  if (document.body.dataset.role !== 'owner') return;
  try {
    const res = await fetch('/api/admin/team');
    if (!res.ok) return;
    const list = await res.json();
    const body = document.getElementById('teamBody');
    body.innerHTML = '';
    list.forEach((u) => body.appendChild(teamRow(u)));
    // The "Who" filter lists everyone, keeping the current choice.
    const chosen = activityWho.value;
    activityWho.innerHTML = '<option value="">Everyone</option>';
    list.forEach((u) => activityWho.add(new Option(u.name, u.id)));
    activityWho.value = chosen;
  } catch (err) {
    // Tried again when the tab is opened.
  }
  loadActivity();
}

teamForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showBoxAlert('teamFormAlert', '', 'error');
  const id = document.getElementById('teamEditId').value;
  try {
    await teamRequest(id ? `/api/admin/team/${id}` : '/api/admin/team', id ? 'PUT' : 'POST', {
      name: document.getElementById('teamName').value,
      username: document.getElementById('teamUser').value,
      password: document.getElementById('teamPass').value,
      active: true,
    });
    resetTeamForm();
    showBoxAlert('teamFormAlert', id ? 'Saved. A new password signs them out of their devices.' : `Added. They sign in at ${window.location.origin}/admin.html with this username and password.`, 'success');
    loadTeam();
  } catch (err) {
    showBoxAlert('teamFormAlert', err.message, 'error');
  }
});
document.getElementById('teamCancelEdit').addEventListener('click', resetTeamForm);
activityWho.addEventListener('change', loadActivity);
activityArea.addEventListener('change', loadActivity);
document.querySelector('.tab-btn[data-tab="team"]').addEventListener('click', loadTeam);
