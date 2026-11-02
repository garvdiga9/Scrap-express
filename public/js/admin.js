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

let pushMounted = false;

function enterDashboard(username) {
  loginScreen.hidden = true;
  dashboard.hidden = false;
  welcomeUser.textContent = `Signed in as ${username}`;
  Promise.all([loadRequests(), loadDemolitionRequests(), loadCallbacks()]).then(openFromLink);
  loadRates();
  loadTestimonials();
  loadSubscribers();
  window.SELive.start();
  if (!pushMounted) {
    pushMounted = true;
    window.SEPush.mount(document.getElementById('adminPushCard'), '/api/admin', {
      on: "On — this device gets an alert for every new request and quote answer.",
      off: 'Get an alert on this phone or computer whenever a new request comes in.',
    });
  }
}

function showTab(name) {
  document.querySelector(`.tab-btn[data-tab="${name}"]`).click();
}

// Notifications link to /admin.html#pickup-12, #demolition-4 or #callback-7: open that one.
function openFromLink() {
  const match = /^#(pickup|demolition|callback)-(\d+)$/.exec(window.location.hash);
  if (!match) return;
  const id = Number(match[2]);
  if (match[1] === 'pickup') {
    const r = allRequests.find((x) => x.id === id);
    showTab('requests');
    if (r) openRequestDialog(r);
  } else {
    const isCallback = match[1] === 'callback';
    showTab(isCallback ? 'callbacks' : 'demolition');
    const row = (isCallback ? callbacksBody : demolitionBody).querySelector(`tr[data-id="${id}"]`);
    if (row) {
      row.classList.add('row-highlight');
      row.scrollIntoView({ block: 'center' });
    }
  }
  history.replaceState(null, '', window.location.pathname);
}
window.addEventListener('hashchange', openFromLink);

let loginInFlight = false;

async function submitLogin() {
  if (loginInFlight) return;
  loginInFlight = true;
  loginAlert.hidden = true;
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in…';

  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const remember = document.getElementById('rememberMe').checked;

  // Never leave the button stuck on "Signing in…": give up after 20s and say so.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, remember }),
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
  showLoginScreen();
  loginForm.reset();
});

function showLoginScreen() {
  window.SELive.stop();
  dashboard.hidden = true;
  loginScreen.hidden = false;
}

/* ---------- Tabs ---------- */
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    document.getElementById('adminPushCard').classList.toggle('off-tab', !['requests', 'demolition', 'callbacks'].includes(btn.dataset.tab));
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
  ready: 'Ready for pickup',
  confirmed: 'Confirmed',
  completed: 'Completed',
  no_scrap: 'No scrap at site',
  cancelled: 'Cancelled',
};
const QUOTE_UNITS = ['per kg', 'per tonne', 'per piece', 'lump sum'];

// A phone number you can tap to call (handy in the app on your phone).
function telLink(phone) {
  const a = document.createElement('a');
  a.href = `tel:${String(phone).replace(/[^\d+]/g, '')}`;
  a.className = 'tel-link';
  a.textContent = phone;
  return a;
}

const formatDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

// The exact pin when the customer gave one, otherwise a search for the address.
function mapsUrl(r, address) {
  return r.latitude && r.longitude
    ? `https://www.google.com/maps?q=${r.latitude},${r.longitude}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
function mapLink(r, address) {
  const a = document.createElement('a');
  a.href = mapsUrl(r, address);
  a.target = '_blank';
  a.rel = 'noopener';
  a.className = 'map-link';
  a.textContent = r.latitude && r.longitude ? '📍 Open exact pin' : '🗺 Search on map';
  return a;
}

const wastedTrips = (n) => `⚠ ${n} wasted trip${n === 1 ? '' : 's'}`;
// Matches formatQuoteRate in data/business.js: "₹18 per kg", "₹18.50 per kg".
function formatRate({ rate, unit }) {
  const n = Number(rate);
  const digits = Number.isInteger(n) ? 0 : 2;
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`;
}

// Don't rebuild a table under someone choosing a status; catch up afterwards.
// Only for a while, as a dropdown that was just left selected counts too.
const CHECK_FREE_MS = 500;
const WAIT_FOR_FREE_MS = 10 * 1000;
function renderWhenFree(table, render, waited = 0) {
  const focused = document.activeElement;
  const choosing = focused && focused.tagName === 'SELECT' && table.contains(focused);
  if (choosing && waited < WAIT_FOR_FREE_MS) {
    setTimeout(() => renderWhenFree(table, render, waited + CHECK_FREE_MS), CHECK_FREE_MS);
  } else {
    render();
  }
}

// A request that has just arrived stands out for a few seconds.
const NEW_ROW_SECONDS = 8;
function markNewRow(tr, newIds, id) {
  if (!newIds.has(id)) return;
  tr.classList.add('row-highlight');
  setTimeout(() => tr.classList.remove('row-highlight'), NEW_ROW_SECONDS * 1000);
}

// "background" means a live update, not the first load: no "Loading…", the
// table stays as it is when nothing changed, and a failure keeps what's showing.
const sessionEnded = (res) => {
  if (res.status !== 401) return false;
  showLoginScreen();
  return true;
};

let newRequestIds = new Set();

async function loadRequests(background = false) {
  if (!background) requestsBody.innerHTML = '<tr><td colspan="10" class="table-empty">Loading requests…</td></tr>';
  try {
    const res = await fetch('/api/admin/requests');
    if (background && sessionEnded(res)) return;
    if (!res.ok) throw new Error();
    const fresh = await res.json();
    if (background && JSON.stringify(fresh) === JSON.stringify(allRequests)) return;
    const known = new Set(allRequests.map((r) => r.id));
    newRequestIds = new Set(background ? fresh.map((r) => r.id).filter((id) => !known.has(id)) : []);
    allRequests = fresh;
    setTabCount(document.getElementById('pickupCount'), allRequests);
    renderWhenFree(requestsBody, renderRequests);
    updateOpenDialog();
  } catch (err) {
    if (background) return;
    requestsBody.innerHTML = '<tr><td colspan="10" class="table-empty">Failed to load requests.</td></tr>';
  }
}

function renderRequests() {
  setTabCount(document.getElementById('pickupCount'), allRequests);
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
    tr.children[3].replaceChildren(telLink(r.phone));
    if (r.past_no_scrap) {
      const flag = document.createElement('span');
      flag.className = 'no-scrap-flag';
      flag.textContent = wastedTrips(r.past_no_scrap);
      tr.children[3].appendChild(flag);
    }

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
      // A truck leaves only after a call, so no one is sent to an empty site.
      if (select.value === 'confirmed' && r.status !== 'confirmed') {
        const warning = r.past_no_scrap ? `\n\n${wastedTrips(r.past_no_scrap)} on this number before.` : '';
        if (!confirm(`Have you called ${r.name} and confirmed the scrap is ready?${warning}`)) {
          select.value = r.status;
          return;
        }
      }
      select.className = `status-select status-${select.value}`;
      try {
        const res = await fetch(`/api/admin/requests/${r.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: select.value }),
        });
        if (!res.ok) throw new Error();
        r.status = select.value;
        renderRequests();
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

    markNewRow(tr, newRequestIds, r.id);
    requestsBody.appendChild(tr);
  });
  newRequestIds = new Set();
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
    const size = m.size < 1024 * 1024 ? `${Math.max(1, Math.round(m.size / 1024))} KB` : `${(m.size / (1024 * 1024)).toFixed(1)} MB`;
    caption.append(`${size} · `, download);
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
const copyQuoteLink = document.getElementById('copyQuoteLink');
let dialogRequest = null;

copyQuoteLink.addEventListener('click', async () => {
  const link = quoteLinkOf(dialogRequest);
  try {
    await navigator.clipboard.writeText(link);
    copyQuoteLink.textContent = 'Copied!';
    setTimeout(() => { copyQuoteLink.textContent = 'Copy Quote Link'; }, 1500);
  } catch (err) {
    window.prompt('Copy this link:', link);
  }
});
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
  return dd;
}

// A ready-to-send WhatsApp message with the quote, opened from your own
// WhatsApp, with the private link to accept or decline it.
const quoteLinkOf = (r) => `${window.location.origin}/quote/${r.quote_token}`;

function updateWhatsappLink(r) {
  copyQuoteLink.hidden = !r.quote_token;
  const digits = String(r.phone || '').replace(/\D/g, '').slice(-10);
  // Landlines can't get WhatsApp messages.
  if (!r.quote_items || !/^[6-9]\d{9}$/.test(digits) || String(r.phone).startsWith('0')) {
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
  lines.push(r.quote_token
    ? `You can accept or decline it here, no login needed: ${quoteLinkOf(r)}`
    : 'Reply here to confirm and we will schedule the pickup.');
  whatsappLink.href = `https://wa.me/91${digits}?text=${encodeURIComponent(lines.join('\n'))}`;
  whatsappLink.hidden = false;
}

function renderRequestSummary(r) {
  requestDetails.innerHTML = '';
  if (r.past_no_scrap) addDetail('Warning', `${wastedTrips(r.past_no_scrap)} on this number or account before.`);
  addDetail('Received', formatDate(r.created_at));
  addDetail('Status', PICKUP_STATUS_LABELS[r.status] || r.status);
  if (r.status === 'ready') addDetail('Before dispatch', 'Call the customer to confirm the scrap is ready, then set the status to Confirmed.');
  if (r.ready_date) addDetail('Scrap ready from', formatDate(r.ready_date));
  if (r.dispatch_checked_at) addDetail('Confirmed by call', formatDate(r.dispatch_checked_at));
  addDetail('Company', r.company_name);
  addDetail('Business type', r.business_type);
  addDetail('GSTIN', r.gstin);
  addDetail('Contact person', r.name);
  addDetail('Phone', r.phone, `tel:${r.phone}`);
  addDetail('Email', r.email, r.email ? `mailto:${r.email}` : null);
  addDetail('Site address', r.address).append(document.createElement('br'), mapLink(r, r.address));
  addDetail('Area', r.area);
  addDetail('Pincode', r.pincode);
  addDetail('Scrap types', r.scrap_type);
  addDetail('Quantity', r.item_quantities && r.item_quantities.length
    ? `${r.approx_quantity} in total\n${r.item_quantities.map((i) => `• ${i.type}: ${i.quantity} ${i.unit}`).join('\n')}`
    : r.approx_quantity);
  addDetail('Frequency', r.pickup_frequency);
  addDetail('Notes', r.notes);
  addDetail('Rules accepted', r.terms_accepted_at ? formatDate(r.terms_accepted_at) : 'Before the rules were added');
  addDetail('Customer account', r.customer_id ? 'Yes — sees the quote in My Account too' : 'No — they answer from the quote link');
  if (r.quote_response) {
    addDetail('Customer answer', `${r.quote_response === 'accepted' ? 'Accepted' : 'Declined'} on ${formatDate(r.quote_responded_at)}`);
  }
  quoteHint.textContent = r.quoted_at
    ? `Quote sent on ${formatDate(r.quoted_at)}. Sending again replaces it and asks the customer to answer again.`
    : 'Enter your rate for each material. Sending marks the request as "Quote sent".';
  sendQuoteBtn.textContent = r.quoted_at ? 'Send Revised Quote' : 'Send Quote';
  updateWhatsappLink(r);
}

// A live update while the dialog is open refreshes the details (such as the
// customer's answer) but leaves the quote being typed alone.
function updateOpenDialog() {
  if (!requestDialog.open || !dialogRequest) return;
  const fresh = allRequests.find((r) => r.id === dialogRequest.id);
  if (!fresh) return;
  dialogRequest = fresh;
  renderRequestSummary(fresh);
}

function openRequestDialog(r) {
  dialogRequest = r;
  document.getElementById('dialogTitle').textContent = `Pickup Request #${r.id}`;
  renderRequestSummary(r);
  renderMediaGallery(document.getElementById('requestMedia'), r.media || []);

  quoteLines.innerHTML = '';
  const items = r.quote_items && r.quote_items.length
    ? r.quote_items
    : splitScrapTypes(r.scrap_type || '').map((material) => ({ material, rate: '', unit: 'per kg' }));
  (items.length ? items : [{ material: '', rate: '', unit: 'per kg' }])
    .forEach((item) => quoteLines.appendChild(buildQuoteLine(item)));
  quoteNote.value = r.quote_note || '';
  quoteAlert.hidden = true;

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
    const emailNote = {
      sent: `Emailed to ${r.email}.`,
      failed: `The email to ${r.email} could not be sent, so please send it on WhatsApp.`,
      off: 'Email isn\'t set up yet, so please send it on WhatsApp.',
      none: 'They didn\'t give an email, so please send it on WhatsApp.',
    }[data.email_status];
    const accountNote = r.customer_id ? ' They can also see it in My Account.' : '';
    quoteAlert.textContent = `Quote saved. ${emailNote}${accountNote}`;
    quoteAlert.className = data.email_status === 'failed' ? 'form-alert error' : 'form-alert success';
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
      r.location,
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
    actionTd.appendChild(delBtn);
    tr.appendChild(actionTd);

    markNewRow(tr, newDemolitionIds, r.id);
    demolitionBody.appendChild(tr);
  });
  newDemolitionIds = new Set();
}
demolitionStatusFilter.addEventListener('change', renderDemolitionRequests);

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

/* ---------- Scrap rates ---------- */
const ratesBody = document.getElementById('ratesBody');
const addRateForm = document.getElementById('addRateForm');

async function loadRates(background = false) {
  if (!background) ratesBody.innerHTML = '<tr><td colspan="4" class="table-empty">Loading rates…</td></tr>';
  try {
    const res = await fetch('/api/admin/rates');
    if (background && sessionEnded(res)) return;
    if (!res.ok) throw new Error();
    const rates = await res.json();
    if (!rates.length) {
      ratesBody.innerHTML = '<tr><td colspan="4" class="table-empty">No categories yet.</td></tr>';
      return;
    }
    renderRates(rates);
  } catch (err) {
    if (background) return;
    ratesBody.innerHTML = '<tr><td colspan="4" class="table-empty">Failed to load rates.</td></tr>';
  }
}

// Rows are kept and updated rather than rebuilt, so a price being typed
// (not saved yet) survives a live update.
function renderRates(rates) {
  const empty = ratesBody.querySelector('.table-empty');
  if (empty) empty.closest('tr').remove();
  const rows = new Map([...ratesBody.children].map((tr) => [tr.dataset.id, tr]));
  rates.forEach((rate, i) => {
    const tr = rows.get(String(rate.id)) || buildRateRow(rate);
    rows.delete(String(rate.id));
    tr.children[0].textContent = rate.name;
    tr.children[1].textContent = rate.unit;
    const input = tr.querySelector('input');
    if (input.value === input.dataset.saved) input.value = rate.price;
    input.dataset.saved = rate.price;
    if (ratesBody.children[i] !== tr) ratesBody.insertBefore(tr, ratesBody.children[i] || null);
  });
  rows.forEach((tr) => tr.remove());
}

function buildRateRow(rate) {
  const tr = document.createElement('tr');
  tr.dataset.id = rate.id;

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
  input.dataset.saved = input.value;
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
      input.dataset.saved = input.value;
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
    await loadRates(true);
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

async function loadTestimonials(background = false) {
  if (!background) testimonialList.innerHTML = '<p class="table-empty">Loading reviews…</p>';
  try {
    const res = await fetch('/api/testimonials');
    if (!res.ok) throw new Error();
    const items = await res.json();
    if (!items.length) {
      testimonialList.innerHTML = '<p class="table-empty">No reviews yet.</p>';
      return;
    }
    testimonialList.innerHTML = '';
    items.forEach((t) => testimonialList.appendChild(buildTestimonialCard(t)));
  } catch (err) {
    if (background) return;
    testimonialList.innerHTML = '<p class="table-empty">Failed to load reviews.</p>';
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
  delBtn.title = 'Delete review';
  delBtn.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
  delBtn.addEventListener('click', async () => {
    if (!confirm('Delete this review?')) return;
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
    if (!res.ok) throw new Error(data.error || 'Failed to add review');
    await loadTestimonials(true);
    addTestimonialForm.reset();
  } catch (err) {
    alert(err.message);
  }
});

/* ---------- Subscribers: daily rates & announcements ---------- */
const subscribersBody = document.getElementById('subscribersBody');
const subSettingsForm = document.getElementById('subSettingsForm');
const announceForm = document.getElementById('announceForm');

function showFormAlert(id, message, ok) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.className = `form-alert ${ok ? 'success' : 'error'}`;
  el.hidden = false;
}

// "Sent to 12 devices, 30 emails and 8 WhatsApp numbers."
function describeSend({ devices, emails, whatsapp, failed }) {
  const parts = [
    countLabel(devices, 'device'), countLabel(emails, 'email'), countLabel(whatsapp, 'WhatsApp number'),
  ];
  return `Sent to ${parts.join(', ')}.${failed ? ` ${failed} could not be delivered (see the server log).` : ''}`;
}

let shownSubSettings = '';

async function loadSubscribers(background = false) {
  try {
    const res = await fetch('/api/admin/subscribers');
    if (background && sessionEnded(res)) return;
    if (!res.ok) throw new Error();
    const { counts, subscribers, settings, channels } = await res.json();

    document.getElementById('subStats').innerHTML = '';
    [
      [counts.devices, 'App alerts'], [counts.emails, 'Emails'],
      [counts.phones, 'WhatsApp numbers'], [counts.emails_pending, 'Emails not yet confirmed'],
    ].forEach(([n, label]) => {
      const tile = document.createElement('div');
      tile.className = 'sub-stat';
      tile.innerHTML = '<strong></strong><span></span>';
      tile.querySelector('strong').textContent = n;
      tile.querySelector('span').textContent = label;
      document.getElementById('subStats').appendChild(tile);
    });

    const channelList = document.getElementById('subChannels');
    channelList.innerHTML = '';
    [
      [true, 'App & browser notifications: on'],
      [channels.email, channels.email ? 'Email: on (sent from your Gmail)' : 'Email: off. Add SMTP_USER and SMTP_PASS on Render to switch it on'],
      [channels.whatsappRates, channels.whatsappRates ? 'Automatic WhatsApp: on' : 'Automatic WhatsApp: off. Numbers are being collected until the WhatsApp API is set up'],
    ].forEach(([on, text]) => {
      const li = document.createElement('li');
      li.className = on ? 'on' : 'off';
      li.textContent = text;
      channelList.appendChild(li);
    });

    // Only when they really changed, and never mid-edit.
    if (JSON.stringify(settings) !== shownSubSettings && !subSettingsForm.contains(document.activeElement)) {
      shownSubSettings = JSON.stringify(settings);
      document.getElementById('dailyEnabled').checked = settings.dailyEnabled;
      document.getElementById('dailyTime').value = settings.dailyTime;
      document.getElementById('waChannel').value = settings.whatsappChannelUrl || '';
    }

    subscribersBody.innerHTML = '';
    if (!subscribers.length) {
      subscribersBody.innerHTML = '<tr><td colspan="4" class="table-empty">No subscribers yet. The sign-up box is at the bottom of every page.</td></tr>';
      return;
    }
    subscribers.forEach((s) => {
      const tr = document.createElement('tr');
      let status = 'WhatsApp';
      if (s.email) status = s.email_confirmed_at ? 'Email · confirmed' : 'Email · waiting for confirmation';
      [formatDate(s.created_at), s.email || s.phone, status].forEach((text) => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      const actionTd = document.createElement('td');
      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn';
      delBtn.title = 'Remove subscriber';
      delBtn.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
      delBtn.addEventListener('click', async () => {
        if (!confirm(`Remove ${s.email || s.phone}? They will stop getting updates.`)) return;
        await fetch(`/api/admin/subscribers/${s.id}`, { method: 'DELETE' });
        loadSubscribers();
      });
      actionTd.appendChild(delBtn);
      tr.appendChild(actionTd);
      subscribersBody.appendChild(tr);
    });
  } catch (err) {
    if (background) return;
    subscribersBody.innerHTML = '<tr><td colspan="4" class="table-empty">Failed to load subscribers.</td></tr>';
  }
}

subSettingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await fetch('/api/admin/subscribers/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dailyEnabled: document.getElementById('dailyEnabled').checked,
        dailyTime: document.getElementById('dailyTime').value,
        whatsappChannelUrl: document.getElementById('waChannel').value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save.');
    showFormAlert('subSettingsAlert', data.dailyEnabled
      ? `Saved. Today's rates will go out every day at ${data.dailyTime}.`
      : 'Saved. The daily rates are paused.', true);
  } catch (err) {
    showFormAlert('subSettingsAlert', err.message, false);
  }
});

document.getElementById('sendRatesNow').addEventListener('click', async (e) => {
  if (!confirm("Send today's rates to all subscribers now?")) return;
  e.target.disabled = true;
  try {
    const res = await fetch('/api/admin/subscribers/send-rates', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not send.');
    showFormAlert('subSettingsAlert', describeSend(data), true);
  } catch (err) {
    showFormAlert('subSettingsAlert', err.message, false);
  } finally {
    e.target.disabled = false;
  }
});

announceForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('announceTitle').value.trim();
  const message = document.getElementById('announceMessage').value.trim();
  if (!title || !message) return showFormAlert('announceAlert', 'Please add a title and a message.', false);
  if (!confirm('Send this announcement to all subscribers?')) return;
  const btn = announceForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const res = await fetch('/api/admin/subscribers/announce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, message }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not send.');
    showFormAlert('announceAlert', describeSend(data), true);
    announceForm.reset();
  } catch (err) {
    showFormAlert('announceAlert', err.message, false);
  } finally {
    btn.disabled = false;
  }
});

/* ---------- Phone layout & staying up to date ---------- */
// On phones each table row is shown as a card (admin.css); every cell gets
// its column name as a label. Rows are rebuilt often, so label on change.
document.querySelectorAll('.admin-table').forEach((table) => {
  const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  const body = table.querySelector('tbody');
  const label = () => body.querySelectorAll('tr').forEach((tr) => {
    [...tr.children].forEach((td, i) => { if (!td.colSpan || td.colSpan === 1) td.dataset.label = headers[i] || ''; });
  });
  new MutationObserver(label).observe(body, { childList: true });
  label();
});

// "3 new" on the request tabs.
function setTabCount(el, list) {
  const pending = list.filter((r) => r.status === 'pending').length;
  el.textContent = pending ? `${pending} new` : '';
  el.hidden = !pending;
}

// Everything updates by itself while the dashboard is open (see live.js). A
// notification arriving is one more reason to check the request lists.
function refreshRequests() {
  if (dashboard.hidden) return Promise.resolve();
  return Promise.all([loadRequests(true), loadDemolitionRequests(true), loadCallbacks(true)]);
}
window.SELive.on('requests', refreshRequests);
window.SELive.on('callbacks', () => loadCallbacks(true));
window.SELive.on('rates', () => loadRates(true));
window.SELive.on('reviews', () => loadTestimonials(true));
window.SELive.on('subscribers', () => loadSubscribers(true));
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'push') refreshRequests();
  });
}

checkSession();
