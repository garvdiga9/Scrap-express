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
