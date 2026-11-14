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
  slots_sent: 'Slots sent',
  scheduled: 'Slot chosen',
  on_way: 'On the way',
  arrived: 'At the site',
  weighed: 'Weighed',
  ready: 'Ready for pickup (old)',
  confirmed: 'Confirmed (old)',
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
