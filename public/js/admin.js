// The admin dashboard runs inside the same installable app as the website.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

const loginScreen = document.getElementById('loginScreen');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('loginForm');
const loginAlert = document.getElementById('loginAlert');
const loginBtn = document.getElementById('loginBtn');
const welcomeUser = document.getElementById('welcomeUser');

function showLoginAlert(message) {
  loginAlert.textContent = message;
  loginAlert.className = 'form-alert error';
  loginAlert.hidden = false;
}

async function checkSession() {
  try {
    const res = await fetch('/api/admin/me');
    if (res.ok) {
      const data = await res.json();
      enterDashboard(data.username);
    }
  } catch (err) {
    /* not logged in, stay on login screen */
  }
}

function enterDashboard(username) {
  loginScreen.hidden = true;
  dashboard.hidden = false;
  welcomeUser.textContent = `Signed in as ${username}`;
  loadRequests();
  loadDemolitionRequests();
  loadRates();
  loadTestimonials();
}

let loginInFlight = false;

async function submitLogin() {
  if (loginInFlight) return;
  loginInFlight = true;
  loginAlert.hidden = true;
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in…';

  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  // Never leave the button stuck on "Signing in…": give up after 20s and say so.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: controller.signal,
    });
    let data = {};
    try {
      data = await res.json();
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new Error(`The server sent an unexpected response (status ${res.status}). Please try again.`);
    }
    if (!res.ok) throw new Error(data.error || 'Login failed');
    enterDashboard(data.username);
  } catch (err) {
    showLoginAlert(err.name === 'AbortError'
      ? 'The server took too long to respond. Check your connection and try again.'
      : err.message);
  } finally {
    clearTimeout(timer);
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';
    loginInFlight = false;
  }
}

// Bound to both the form's submit (covers pressing Enter) and the button's
// click directly, since some environments don't reliably fire the native
// submit event from a programmatic or synthetic button click.
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitLogin();
});
loginBtn.addEventListener('click', (e) => {
  e.preventDefault();
  submitLogin();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  dashboard.hidden = true;
  loginScreen.hidden = false;
  loginForm.reset();
});

/* ---------- Tabs ---------- */
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

/* ---------- Pickup requests ---------- */
const requestsBody = document.getElementById('requestsBody');
const statusFilter = document.getElementById('statusFilter');
let allRequests = [];

// Same lists as PICKUP_STATUSES / QUOTE_UNITS in data/business.js.
const PICKUP_STATUS_LABELS = {
  pending: 'Pending',
  quoted: 'Quote sent',
  accepted: 'Quote accepted',
  declined: 'Quote declined',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const QUOTE_UNITS = ['per kg', 'per tonne', 'per piece', 'lump sum'];

const formatDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
// Matches formatQuoteRate in server.js: "₹18 per kg", "₹18.50 per kg".
function formatRate({ rate, unit }) {
  const n = Number(rate);
  const digits = Number.isInteger(n) ? 0 : 2;
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`;
}

async function loadRequests() {
  requestsBody.innerHTML = '<tr><td colspan="10" class="table-empty">Loading requests…</td></tr>';
  try {
    const res = await fetch('/api/admin/requests');
    if (!res.ok) throw new Error();
    allRequests = await res.json();
    renderRequests();
  } catch (err) {
    requestsBody.innerHTML = '<tr><td colspan="10" class="table-empty">Failed to load requests.</td></tr>';
  }
}

function renderRequests() {
  const filter = statusFilter.value;
  const rows = allRequests.filter((r) => filter === 'all' || r.status === filter);
  if (!rows.length) {
    requestsBody.innerHTML = '<tr><td colspan="10" class="table-empty">No requests found.</td></tr>';
    return;
  }
  requestsBody.innerHTML = '';
  rows.forEach((r) => {
    const tr = document.createElement('tr');

    const company = r.company_name
      ? (r.business_type ? `${r.company_name} · ${r.business_type}` : r.company_name)
      : '-';
    const cells = [
      formatDate(r.created_at),
      company,
      r.name,
      r.phone,
      r.area || '-',
      r.scrap_type,
      r.approx_quantity || '-',
      r.pickup_frequency || '-',
    ];
    cells.forEach((text) => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    });

    const statusTd = document.createElement('td');
    const select = document.createElement('select');
    select.className = `status-select status-${r.status}`;
    Object.entries(PICKUP_STATUS_LABELS).forEach(([s, label]) => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = label;
      if (s === r.status) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', async () => {
      select.className = `status-select status-${select.value}`;
      try {
        const res = await fetch(`/api/admin/requests/${r.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: select.value }),
        });
        if (!res.ok) throw new Error();
        r.status = select.value;
      } catch (err) {
        alert('Failed to update status.');
      }
    });
    statusTd.appendChild(select);
    tr.appendChild(statusTd);

    const actionTd = document.createElement('td');
    actionTd.className = 'row-actions';
    const viewBtn = document.createElement('button');
    viewBtn.className = 'view-btn';
    viewBtn.textContent = r.quote_items ? 'View Quote' : 'View & Quote';
    viewBtn.addEventListener('click', () => openRequestDialog(r));
    actionTd.appendChild(viewBtn);
    if (r.media && r.media.length) actionTd.appendChild(mediaBadge(r.media));

    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn';
    delBtn.title = 'Delete request';
    delBtn.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
    delBtn.addEventListener('click', async () => {
      if (!confirm('Delete this pickup request?')) return;
      await fetch(`/api/admin/requests/${r.id}`, { method: 'DELETE' });
      allRequests = allRequests.filter((x) => x.id !== r.id);
      renderRequests();
    });
    actionTd.appendChild(delBtn);
    tr.appendChild(actionTd);

    requestsBody.appendChild(tr);
  });
}
statusFilter.addEventListener('change', renderRequests);

/* ---------- Customer photos & videos ---------- */
const countLabel = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function describeMedia(list) {
  const photos = list.filter((m) => m.kind === 'photo').length;
  const videos = list.length - photos;
  return [photos && countLabel(photos, 'photo'), videos && countLabel(videos, 'video')].filter(Boolean).join(', ');
}

function mediaBadge(list) {
  const badge = document.createElement('span');
  badge.className = 'media-count';
  badge.title = describeMedia(list);
  badge.textContent = `📎 ${list.length}`;
  return badge;
}

// Thumbnails that open the full photo in a new tab, and playable videos.
function renderMediaGallery(container, list) {
  container.innerHTML = '';
  container.hidden = !list.length;
  if (!list.length) return;
  const heading = document.createElement('h3');
  heading.textContent = `Photos & Videos (${describeMedia(list)})`;
  const grid = document.createElement('div');
  grid.className = 'media-grid';
  list.forEach((m) => {
    const url = `/api/admin/media/${m.id}`;
    const item = document.createElement('figure');
    item.className = 'media-item';
    if (m.kind === 'photo') {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      const img = document.createElement('img');
      img.src = url;
      img.alt = m.name || 'Customer photo';
      img.loading = 'lazy';
      link.appendChild(img);
      item.appendChild(link);
    } else {
      const video = document.createElement('video');
      video.src = url;
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      item.appendChild(video);
    }
    const caption = document.createElement('figcaption');
    const download = document.createElement('a');
    download.href = `${url}?download=1`;
    download.textContent = 'Download';
    caption.append(`${(m.size / (1024 * 1024)).toFixed(1)} MB · `, download);
    item.appendChild(caption);
    grid.appendChild(item);
  });
  container.append(heading, grid);
}

const mediaDialog = document.getElementById('mediaDialog');
document.getElementById('mediaDialogClose').addEventListener('click', () => mediaDialog.close());
mediaDialog.addEventListener('click', (e) => { if (e.target === mediaDialog) mediaDialog.close(); });
// Stop any playing video when a dialog closes.
[mediaDialog, document.getElementById('requestDialog')].forEach((d) => {
  d.addEventListener('close', () => d.querySelectorAll('video').forEach((v) => v.pause()));
});

/* ---------- Request details & quote dialog ---------- */
const requestDialog = document.getElementById('requestDialog');
const requestDetails = document.getElementById('requestDetails');
const quoteForm = document.getElementById('quoteForm');
const quoteLines = document.getElementById('quoteLines');
const quoteNote = document.getElementById('quoteNote');
const quoteHint = document.getElementById('quoteHint');
const quoteAlert = document.getElementById('quoteAlert');
const sendQuoteBtn = document.getElementById('sendQuoteBtn');
const whatsappLink = document.getElementById('whatsappLink');
let dialogRequest = null;

document.getElementById('dialogClose').addEventListener('click', () => requestDialog.close());
// Clicking the dimmed backdrop (outside the dialog box) closes it too.
requestDialog.addEventListener('click', (e) => { if (e.target === requestDialog) requestDialog.close(); });
document.getElementById('addQuoteLine').addEventListener('click', () => {
  quoteLines.appendChild(buildQuoteLine({ material: '', rate: '', unit: 'per kg' }));
  quoteLines.lastElementChild.querySelector('input').focus();
});

// "Paper & Cardboard, Plastic, Other: wooden pallets, rubber" → one entry per
// type. "Other: …" is always last and may itself contain commas.
function splitScrapTypes(text) {
  const at = text.indexOf('Other: ');
  const known = (at === -1 ? text : text.slice(0, at)).split(', ').filter(Boolean);
  return at === -1 ? known : [...known, text.slice(at + 'Other: '.length)];
}

function buildQuoteLine({ material, rate, unit }) {
  const line = document.createElement('div');
  line.className = 'quote-line';

  const materialInput = document.createElement('input');
  materialInput.type = 'text';
  materialInput.maxLength = 100;
  materialInput.placeholder = 'Material';
  materialInput.value = material;
  materialInput.setAttribute('aria-label', 'Material');

  const rateWrap = document.createElement('div');
  rateWrap.className = 'rate-input';
  const rateInput = document.createElement('input');
  rateInput.type = 'number';
  rateInput.min = '0';
  rateInput.step = '0.01';
  rateInput.placeholder = 'Rate';
  rateInput.value = rate;
  rateInput.setAttribute('aria-label', 'Rate in rupees');
  rateWrap.append('₹', rateInput);

  const unitSelect = document.createElement('select');
  unitSelect.setAttribute('aria-label', 'Unit');
  QUOTE_UNITS.forEach((u) => {
    const opt = document.createElement('option');
    opt.value = u;
    opt.textContent = u;
    if (u === unit) opt.selected = true;
    unitSelect.appendChild(opt);
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'icon-btn';
  removeBtn.title = 'Remove line';
  removeBtn.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
  removeBtn.addEventListener('click', () => line.remove());

  line.append(materialInput, rateWrap, unitSelect, removeBtn);
  return line;
}

function addDetail(label, value, href) {
  if (!value) return;
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  if (href) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = value;
    dd.appendChild(a);
  } else {
    dd.textContent = value;
  }
  requestDetails.append(dt, dd);
}

// A ready-to-send WhatsApp message with the quote, opened from your own
// WhatsApp. Customers without an account only get the quote this way or by call.
function updateWhatsappLink(r) {
  const digits = String(r.phone || '').replace(/\D/g, '').slice(-10);
  if (!r.quote_items || digits.length !== 10) {
    whatsappLink.hidden = true;
    return;
  }
  const lines = [
    `Hello ${r.name}, here is the Scrap Express quote for your pickup request #${r.id}${r.company_name ? ` (${r.company_name})` : ''}:`,
    '',
    ...r.quote_items.map((item) => `• ${item.material}: ${formatRate(item)}`),
  ];
  if (r.quote_note) lines.push('', r.quote_note);
  lines.push('', 'The final amount is worked out from the weighbridge weight at pickup.');
  lines.push(r.customer_id
    ? `You can accept or decline it here: ${window.location.origin}/account`
    : 'Reply here to confirm and we will schedule the pickup.');
  whatsappLink.href = `https://wa.me/91${digits}?text=${encodeURIComponent(lines.join('\n'))}`;
  whatsappLink.hidden = false;
}

function openRequestDialog(r) {
  dialogRequest = r;
  document.getElementById('dialogTitle').textContent = `Pickup Request #${r.id}`;

  requestDetails.innerHTML = '';
  addDetail('Received', formatDate(r.created_at));
  addDetail('Status', PICKUP_STATUS_LABELS[r.status] || r.status);
  addDetail('Company', r.company_name);
  addDetail('Business type', r.business_type);
  addDetail('GSTIN', r.gstin);
  addDetail('Contact person', r.name);
  addDetail('Phone', r.phone, `tel:${r.phone}`);
  addDetail('Email', r.email, r.email ? `mailto:${r.email}` : null);
  addDetail('Site address', r.address);
  addDetail('Area', r.area);
  addDetail('Pincode', r.pincode);
  addDetail('Scrap types', r.scrap_type);
  addDetail('Quantity', r.approx_quantity);
  addDetail('Frequency', r.pickup_frequency);
  addDetail('Notes', r.notes);
  addDetail('Customer account', r.customer_id ? 'Yes — sees the quote in My Account' : 'No — share the quote by call or WhatsApp');
  if (r.quote_response) {
    addDetail('Customer answer', `${r.quote_response === 'accepted' ? 'Accepted' : 'Declined'} on ${formatDate(r.quote_responded_at)}`);
  }
  renderMediaGallery(document.getElementById('requestMedia'), r.media || []);

  quoteHint.textContent = r.quoted_at
    ? `Quote sent on ${formatDate(r.quoted_at)}. Sending again replaces it and asks the customer to answer again.`
    : 'Enter your rate for each material. Sending marks the request as "Quote sent".';
  quoteLines.innerHTML = '';
  const items = r.quote_items && r.quote_items.length
    ? r.quote_items
    : splitScrapTypes(r.scrap_type || '').map((material) => ({ material, rate: '', unit: 'per kg' }));
  (items.length ? items : [{ material: '', rate: '', unit: 'per kg' }])
    .forEach((item) => quoteLines.appendChild(buildQuoteLine(item)));
  quoteNote.value = r.quote_note || '';
  quoteAlert.hidden = true;
  sendQuoteBtn.textContent = r.quoted_at ? 'Send Revised Quote' : 'Send Quote';
  updateWhatsappLink(r);

  requestDialog.showModal();
}

quoteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = dialogRequest;
  const items = [...quoteLines.querySelectorAll('.quote-line')].map((line) => {
    const [material, rate] = line.querySelectorAll('input');
    return { material: material.value.trim(), rate: rate.value, unit: line.querySelector('select').value };
  });

  quoteAlert.hidden = true;
  const showQuoteError = (message) => {
    quoteAlert.textContent = message;
    quoteAlert.className = 'form-alert error';
    quoteAlert.hidden = false;
  };
  if (!items.length) return showQuoteError('Add at least one line to the quote.');
  if (items.some((item) => !item.material || item.rate === '')) {
    return showQuoteError('Each line needs a material and a rate.');
  }

  sendQuoteBtn.disabled = true;
  try {
    const res = await fetch(`/api/admin/requests/${r.id}/quote`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, note: quoteNote.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to save the quote.');
    Object.assign(r, data);
    renderRequests();
    openRequestDialog(r);
    quoteAlert.textContent = r.customer_id
      ? 'Quote sent. The customer can now see it in My Account. You can also send it on WhatsApp.'
      : 'Quote saved. This customer has no account, so share it on WhatsApp or by phone.';
    quoteAlert.className = 'form-alert success';
    quoteAlert.hidden = false;
  } catch (err) {
    showQuoteError(err.message);
  } finally {
    sendQuoteBtn.disabled = false;
  }
});

/* ---------- Demolition requests ---------- */
const demolitionBody = document.getElementById('demolitionBody');
const demolitionStatusFilter = document.getElementById('demolitionStatusFilter');
let allDemolitionRequests = [];

async function loadDemolitionRequests() {
  demolitionBody.innerHTML = '<tr><td colspan="9" class="table-empty">Loading requests…</td></tr>';
  try {
    const res = await fetch('/api/admin/demolition');
    if (!res.ok) throw new Error();
    allDemolitionRequests = await res.json();
    renderDemolitionRequests();
  } catch (err) {
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

    const cells = [
      new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      r.name,
      r.phone,
      r.building_type,
      r.location,
      r.approx_area || '-',
    ];
    cells.forEach((text) => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    });

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
    actionTd.appendChild(delBtn);
    tr.appendChild(actionTd);

    demolitionBody.appendChild(tr);
  });
}
demolitionStatusFilter.addEventListener('change', renderDemolitionRequests);

/* ---------- Scrap rates ---------- */
const ratesBody = document.getElementById('ratesBody');
const addRateForm = document.getElementById('addRateForm');

async function loadRates() {
  ratesBody.innerHTML = '<tr><td colspan="4" class="table-empty">Loading rates…</td></tr>';
  try {
    const res = await fetch('/api/admin/rates');
    if (!res.ok) throw new Error();
    const rates = await res.json();
    if (!rates.length) {
      ratesBody.innerHTML = '<tr><td colspan="4" class="table-empty">No categories yet.</td></tr>';
      return;
    }
    ratesBody.innerHTML = '';
    rates.forEach((rate) => ratesBody.appendChild(buildRateRow(rate)));
  } catch (err) {
    ratesBody.innerHTML = '<tr><td colspan="4" class="table-empty">Failed to load rates.</td></tr>';
  }
}

function buildRateRow(rate) {
  const tr = document.createElement('tr');

  const nameTd = document.createElement('td');
  nameTd.textContent = rate.name;
  tr.appendChild(nameTd);

  const unitTd = document.createElement('td');
  unitTd.textContent = rate.unit;
  tr.appendChild(unitTd);

  const priceTd = document.createElement('td');
  const wrap = document.createElement('div');
  wrap.className = 'price-edit';
  const input = document.createElement('input');
  input.type = 'number';
  input.step = '0.01';
  input.min = '0';
  input.value = rate.price;
  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-price-btn';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    try {
      const res = await fetch(`/api/admin/rates/${rate.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: input.value }),
      });
      if (!res.ok) throw new Error();
      saveBtn.textContent = 'Saved';
      setTimeout(() => (saveBtn.textContent = 'Save'), 1200);
    } catch (err) {
      alert('Failed to update price.');
    }
  });
  wrap.append('₹', input, saveBtn);
  priceTd.appendChild(wrap);
  tr.appendChild(priceTd);

  const actionTd = document.createElement('td');
  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn';
  delBtn.title = 'Delete category';
  delBtn.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
  delBtn.addEventListener('click', async () => {
    if (!confirm(`Delete "${rate.name}"?`)) return;
    await fetch(`/api/admin/rates/${rate.id}`, { method: 'DELETE' });
    tr.remove();
  });
  actionTd.appendChild(delBtn);
  tr.appendChild(actionTd);

  return tr;
}

addRateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('newRateName').value.trim();
  const unit = document.getElementById('newRateUnit').value.trim() || 'kg';
  const price = document.getElementById('newRatePrice').value;
  if (!name || price === '') return;

  try {
    const res = await fetch('/api/admin/rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, unit, price }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add category');
    const emptyRow = ratesBody.querySelector('.table-empty');
    if (emptyRow) emptyRow.closest('tr').remove();
    ratesBody.appendChild(buildRateRow(data));
    addRateForm.reset();
    document.getElementById('newRateUnit').value = 'kg';
  } catch (err) {
    alert(err.message);
  }
});

/* ---------- Testimonials ---------- */
const testimonialList = document.getElementById('testimonialList');
const addTestimonialForm = document.getElementById('addTestimonialForm');

function starRow(rating) {
  const wrap = document.createElement('div');
  wrap.className = 'review-stars';
  for (let i = 0; i < 5; i++) {
    wrap.innerHTML += `<svg class="icon" style="opacity:${i < rating ? 1 : 0.25}"><use href="#icon-star"/></svg>`;
  }
  return wrap;
}

async function loadTestimonials() {
  testimonialList.innerHTML = '<p class="table-empty">Loading testimonials…</p>';
  try {
    const res = await fetch('/api/testimonials');
    if (!res.ok) throw new Error();
    const items = await res.json();
    if (!items.length) {
      testimonialList.innerHTML = '<p class="table-empty">No testimonials yet.</p>';
      return;
    }
    testimonialList.innerHTML = '';
    items.forEach((t) => testimonialList.appendChild(buildTestimonialCard(t)));
  } catch (err) {
    testimonialList.innerHTML = '<p class="table-empty">Failed to load testimonials.</p>';
  }
}

function buildTestimonialCard(t) {
  const card = document.createElement('div');
  card.className = 'testimonial-item';

  card.appendChild(starRow(t.rating));

  const msg = document.createElement('p');
  msg.className = 'review-msg';
  msg.textContent = `"${t.message}"`;
  card.appendChild(msg);

  const author = document.createElement('p');
  author.className = 'review-author';
  author.textContent = t.customer_name;
  card.appendChild(author);

  const area = document.createElement('p');
  area.className = 'review-area';
  area.textContent = t.area || '';
  card.appendChild(area);

  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn';
  delBtn.title = 'Delete testimonial';
  delBtn.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
  delBtn.addEventListener('click', async () => {
    if (!confirm('Delete this testimonial?')) return;
    await fetch(`/api/admin/testimonials/${t.id}`, { method: 'DELETE' });
    card.remove();
  });
  card.appendChild(delBtn);

  return card;
}

addTestimonialForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const customerName = document.getElementById('newTestName').value.trim();
  const area = document.getElementById('newTestArea').value.trim();
  const rating = document.getElementById('newTestRating').value;
  const message = document.getElementById('newTestMessage').value.trim();
  if (!customerName || !message) return;

  try {
    const res = await fetch('/api/admin/testimonials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerName, area, rating, message }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add testimonial');
    const emptyMsg = testimonialList.querySelector('.table-empty');
    if (emptyMsg) emptyMsg.remove();
    testimonialList.appendChild(buildTestimonialCard(data));
    addTestimonialForm.reset();
  } catch (err) {
    alert(err.message);
  }
});

checkSession();
