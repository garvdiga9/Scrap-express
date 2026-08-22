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

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    enterDashboard(data.username);
  } catch (err) {
    showLoginAlert(err.message);
  } finally {
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

async function loadRequests() {
  requestsBody.innerHTML = '<tr><td colspan="9" class="table-empty">Loading requests…</td></tr>';
  try {
    const res = await fetch('/api/admin/requests');
    if (!res.ok) throw new Error();
    allRequests = await res.json();
    renderRequests();
  } catch (err) {
    requestsBody.innerHTML = '<tr><td colspan="9" class="table-empty">Failed to load requests.</td></tr>';
  }
}

function renderRequests() {
  const filter = statusFilter.value;
  const rows = allRequests.filter((r) => filter === 'all' || r.status === filter);
  if (!rows.length) {
    requestsBody.innerHTML = '<tr><td colspan="9" class="table-empty">No requests found.</td></tr>';
    return;
  }
  requestsBody.innerHTML = '';
  rows.forEach((r) => {
    const tr = document.createElement('tr');

    const cells = [
      new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      r.name,
      r.phone,
      r.area || '-',
      r.scrap_type,
      r.approx_quantity || '-',
      r.preferred_date ? new Date(r.preferred_date).toLocaleDateString('en-IN') : '-',
    ];
    cells.forEach((text) => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    });

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

/* ---------- Demolition requests ---------- */
const demolitionBody = document.getElementById('demolitionBody');
const demolitionStatusFilter = document.getElementById('demolitionStatusFilter');
let allDemolitionRequests = [];

async function loadDemolitionRequests() {
  demolitionBody.innerHTML = '<tr><td colspan="8" class="table-empty">Loading requests…</td></tr>';
  try {
    const res = await fetch('/api/admin/demolition');
    if (!res.ok) throw new Error();
    allDemolitionRequests = await res.json();
    renderDemolitionRequests();
  } catch (err) {
    demolitionBody.innerHTML = '<tr><td colspan="8" class="table-empty">Failed to load requests.</td></tr>';
  }
}

function renderDemolitionRequests() {
  const filter = demolitionStatusFilter.value;
  const rows = allDemolitionRequests.filter((r) => filter === 'all' || r.status === filter);
  if (!rows.length) {
    demolitionBody.innerHTML = '<tr><td colspan="8" class="table-empty">No requests found.</td></tr>';
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
