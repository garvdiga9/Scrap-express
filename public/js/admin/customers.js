/* ---------- Customers ---------- */
const accountsBody = document.getElementById('accountsBody');
const guestsBody = document.getElementById('guestsBody');
const customerSearch = document.getElementById('customerSearch');
let customers = { accounts: [], guests: [] };

async function loadCustomers(background = false) {
  try {
    const res = await fetch('/api/admin/customers');
    if (background && sessionEnded(res)) return;
    if (!res.ok) throw new Error();
    const fresh = await res.json();
    if (background && JSON.stringify(fresh) === JSON.stringify(customers)) return;
    customers = fresh;
    renderCustomers();
  } catch (err) {
    if (background) return;
    [accountsBody, guestsBody].forEach((body) => {
      body.innerHTML = '<tr><td colspan="7" class="table-empty">Failed to load customers.</td></tr>';
    });
  }
}

function describeRequests(c) {
  const parts = [
    c.pickups && countLabel(c.pickups, 'pickup'),
    c.demolitions && countLabel(c.demolitions, 'demolition'),
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'None yet';
}

function matchesSearch(c, words) {
  const text = [c.name, c.company_name, c.phone, c.email, c.area, c.address].join(' ').toLowerCase();
  return words.every((word) => text.includes(word));
}

function customerRow(c, firstDate, lastDate) {
  const tr = document.createElement('tr');
  ['', '', c.email || '-', c.area || c.address || '-', '', firstDate, lastDate].forEach((text) => {
    const td = document.createElement('td');
    td.textContent = text;
    tr.appendChild(td);
  });

  const who = tr.children[0];
  const name = document.createElement('span');
  name.className = 'customer-name';
  name.textContent = c.name || 'Name not given';
  who.appendChild(name);
  const details = [c.company_name, c.business_type, c.gstin && `GSTIN ${c.gstin}`].filter(Boolean).join(' · ');
  if (details) {
    const sub = document.createElement('span');
    sub.className = 'customer-sub';
    sub.textContent = details;
    who.appendChild(sub);
  }
  if (c.has_account) {
    const sub = document.createElement('span');
    sub.className = 'customer-sub';
    sub.textContent = 'Same phone or email as an account';
    who.appendChild(sub);
  }

  if (c.phone) tr.children[1].replaceChildren(telLink(c.phone));
  else tr.children[1].textContent = '-';

  const requests = tr.children[4];
  requests.textContent = describeRequests(c);
  if (c.wasted_trips) {
    const flag = document.createElement('span');
    flag.className = 'no-scrap-flag';
    flag.textContent = wastedTrips(c.wasted_trips);
    requests.appendChild(flag);
  }
  return tr;
}

function renderCustomerList(body, list, total, emptyText, toRow) {
  const words = customerSearch.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = list.filter((c) => matchesSearch(c, words));
  if (!rows.length) {
    const message = total ? 'No one matches your search.' : emptyText;
    body.innerHTML = '<tr><td colspan="7" class="table-empty"></td></tr>';
    body.querySelector('td').textContent = message;
    return;
  }
  body.replaceChildren(...rows.map(toRow));
}

function renderCustomers() {
  const { accounts, guests } = customers;
  document.getElementById('accountsCount').textContent = `(${accounts.length})`;
  document.getElementById('guestsCount').textContent = `(${guests.length})`;
  renderCustomerList(accountsBody, accounts, accounts.length, 'No one has logged in yet.', (c) => customerRow(
    c, formatDate(c.created_at), c.last_login_at ? formatDateTime(c.last_login_at) : '-'
  ));
  renderCustomerList(guestsBody, guests, guests.length, 'No one has booked without logging in.', (c) => customerRow(
    c, formatDate(c.first_request_at), formatDate(c.last_request_at)
  ));
}
customerSearch.addEventListener('input', renderCustomers);

document.querySelectorAll('.customer-switch-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.customer-switch-btn').forEach((b) => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-pressed', String(b === btn));
    });
    document.getElementById('accountsList').hidden = btn.dataset.list !== 'accounts';
    document.getElementById('guestsList').hidden = btn.dataset.list !== 'guests';
  });
});
