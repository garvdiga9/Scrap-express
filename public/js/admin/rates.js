/* ---------- Scrap rates ---------- */
const ratesBody = document.getElementById('ratesBody');
const addRateForm = document.getElementById('addRateForm');
const ratesUpdatedLabel = document.getElementById('ratesUpdatedLabel');
let rateGroups = [];

// The groups (tabs on the public Rates page), loaded once.
async function loadRateGroups() {
  if (rateGroups.length) return;
  const res = await fetch('/api/admin/options');
  if (!res.ok) return;
  rateGroups = (await res.json()).rateCategories;
  const select = document.getElementById('newRateGroup');
  select.innerHTML = '';
  select.append(new Option('Group', ''));
  rateGroups.forEach(({ key, label }) => select.append(new Option(label, key)));
}

function showRatesUpdated(iso) {
  ratesUpdatedLabel.textContent = iso
    ? `Rates page shows "Last updated: ${formatDateTime(iso)}". Saving any price updates it, or press the button if nothing changed today.`
    : 'No rates saved yet.';
}

async function loadRates(background = false) {
  if (!background) ratesBody.innerHTML = '<tr><td colspan="5" class="table-empty">Loading rates…</td></tr>';
  try {
    await loadRateGroups().catch(() => {});
    const res = await fetch('/api/admin/rates');
    if (background && sessionEnded(res)) return;
    if (!res.ok) throw new Error();
    showRatesUpdated(res.headers.get('X-Rates-Updated'));
    const rates = await res.json();
    if (!rates.length) {
      ratesBody.innerHTML = '<tr><td colspan="5" class="table-empty">No categories yet.</td></tr>';
      return;
    }
    renderRates(rates);
  } catch (err) {
    if (background) return;
    ratesBody.innerHTML = '<tr><td colspan="5" class="table-empty">Failed to load rates.</td></tr>';
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
    tr.querySelector('.rate-name').textContent = rate.name;
    tr.querySelector('.rate-unit').textContent = rate.unit;
    const group = tr.querySelector('select');
    if (document.activeElement !== group) group.value = rate.category || 'other';
    const input = tr.querySelector('input');
    if (input.value === input.dataset.saved) input.value = rate.price;
    input.dataset.saved = rate.price;
    if (ratesBody.children[i] !== tr) ratesBody.insertBefore(tr, ratesBody.children[i] || null);
  });
  rows.forEach((tr) => tr.remove());
}

async function saveRate(id, changes) {
  const res = await fetch(`/api/admin/rates/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to save.');
  return data;
}

function buildRateRow(rate) {
  const tr = document.createElement('tr');
  tr.dataset.id = rate.id;

  const nameTd = document.createElement('td');
  nameTd.className = 'rate-name';
  tr.appendChild(nameTd);

  const groupTd = document.createElement('td');
  const group = document.createElement('select');
  group.className = 'rate-group-select';
  group.setAttribute('aria-label', `Group for ${rate.name}`);
  rateGroups.forEach(({ key, label }) => group.append(new Option(label, key)));
  group.addEventListener('change', async () => {
    try {
      await saveRate(rate.id, { category: group.value });
    } catch (err) {
      alert(err.message);
    }
  });
  groupTd.appendChild(group);
  tr.appendChild(groupTd);

  const unitTd = document.createElement('td');
  unitTd.className = 'rate-unit';
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
  input.setAttribute('aria-label', `Price for ${rate.name}`);
  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-price-btn';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    try {
      await saveRate(rate.id, { price: input.value });
      input.dataset.saved = input.value;
      saveBtn.textContent = 'Saved';
      setTimeout(() => (saveBtn.textContent = 'Save'), 1200);
    } catch (err) {
      alert(err.message || 'Failed to update price.');
    }
  });
  wrap.append('₹', input, saveBtn);
  priceTd.appendChild(wrap);
  tr.appendChild(priceTd);

  const actionTd = document.createElement('td');
  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn';
  delBtn.title = 'Delete category';
  delBtn.setAttribute('aria-label', `Delete ${rate.name}`);
  delBtn.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
  delBtn.addEventListener('click', async () => {
    if (!confirm(`Delete "${rate.name}"? Its page and price history go too.`)) return;
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
  const category = document.getElementById('newRateGroup').value;
  const unit = document.getElementById('newRateUnit').value.trim() || 'kg';
  const price = document.getElementById('newRatePrice').value;
  if (!name || price === '' || !category) {
    alert('Please fill in the name, group and price.');
    return;
  }

  try {
    const res = await fetch('/api/admin/rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, category, unit, price,
      }),
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

document.getElementById('ratesCheckedBtn').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  button.disabled = true;
  try {
    const res = await fetch('/api/admin/rates/checked', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save.');
    showRatesUpdated(data.lastUpdated);
    button.textContent = 'Saved ✓';
    setTimeout(() => { button.textContent = 'Rates checked today: no changes'; }, 1500);
  } catch (err) {
    alert(err.message);
  } finally {
    button.disabled = false;
  }
});
