/* ---------- Legal details and the scale certificate (Team tab, owner only) ---------- */
const legalForm = document.getElementById('legalForm');
const recyclerRows = document.getElementById('recyclerRows');
const certificateForm = document.getElementById('certificateForm');
let recyclerTypes = ['E-waste', 'Batteries', 'Plastic', 'Paper', 'Metal', 'Other'];

function showLegalAlert(box, text, ok = false) {
  box.textContent = text;
  box.className = `form-alert ${ok ? 'success' : 'error'}`;
  box.hidden = !text;
}

function recyclerRow(r = {}) {
  const row = document.createElement('div');
  row.className = 'recycler-row';
  const field = (name, attrs) => {
    const input = document.createElement('input');
    Object.assign(input, attrs);
    input.name = name;
    return input;
  };
  const type = document.createElement('select');
  type.name = 'type';
  type.setAttribute('aria-label', 'Material');
  recyclerTypes.forEach((t) => type.append(new Option(t, t, false, t === r.type)));
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'icon-btn';
  remove.title = 'Remove recycler';
  remove.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
  remove.addEventListener('click', () => row.remove());
  row.append(
    field('name', { type: 'text', maxLength: 150, placeholder: 'Recycler name', value: r.name || '' }),
    type,
    field('regNo', { type: 'text', maxLength: 80, placeholder: 'Registration no.', value: r.regNo || '' }),
    field('validTill', { type: 'date', value: r.validTill || '', title: 'Valid until' }),
    remove,
  );
  return row;
}

function fillLegal(v) {
  recyclerTypes = v.recyclerTypes || recyclerTypes;
  const el = legalForm.elements;
  el.entityName.value = v.entityName;
  el.gstin.value = v.gstin;
  el.udyam.value = v.udyam;
  el.dpiit.value = v.dpiit;
  el.bankDays.value = v.bankDays || '';
  el.officerName.value = v.officer.name;
  el.officerDesignation.value = v.officer.designation;
  el.officerEmail.value = v.officer.email;
  el.officerPhone.value = v.officer.phone;
  recyclerRows.replaceChildren(...v.recyclers.map(recyclerRow));
  const missing = document.getElementById('legalMissing');
  missing.textContent = v.missing.length ? `Still missing: ${v.missing.join(', ')}.` : '';
  missing.hidden = !v.missing.length;

  const current = document.getElementById('certificateCurrent');
  const c = v.certificate;
  document.getElementById('certificateRemove').hidden = !c;
  if (c) {
    current.innerHTML = '';
    const link = document.createElement('a');
    link.href = '/legal/stamping-certificate';
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'View current certificate';
    current.append(link, `${c.number ? ` · No. ${c.number}` : ''}${c.validTill ? ` · valid until ${c.validTill}` : ''}`);
    certificateForm.elements.number.value = c.number;
    certificateForm.elements.validTill.value = c.validTill;
  } else {
    current.textContent = 'No certificate uploaded yet.';
  }
}

async function loadLegal() {
  if (document.body.dataset.role !== 'owner') return;
  try {
    const res = await fetch('/api/admin/legal');
    if (!res.ok) throw new Error();
    fillLegal(await res.json());
  } catch (err) {
    showLegalAlert(document.getElementById('legalAlert'), 'Failed to load legal details.');
  }
}

document.getElementById('addRecycler').addEventListener('click', () => recyclerRows.append(recyclerRow()));

legalForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const el = legalForm.elements;
  const alertBox = document.getElementById('legalAlert');
  const body = {
    entityName: el.entityName.value,
    gstin: el.gstin.value,
    udyam: el.udyam.value,
    dpiit: el.dpiit.value,
    bankDays: el.bankDays.value,
    officer: {
      name: el.officerName.value, designation: el.officerDesignation.value, email: el.officerEmail.value, phone: el.officerPhone.value,
    },
    recyclers: [...recyclerRows.children].map((row) => ({
      name: row.querySelector('[name="name"]').value,
      type: row.querySelector('[name="type"]').value,
      regNo: row.querySelector('[name="regNo"]').value,
      validTill: row.querySelector('[name="validTill"]').value,
    })),
  };
  try {
    const res = await fetch('/api/admin/legal', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save.');
    fillLegal(data);
    showLegalAlert(alertBox, 'Saved. The public pages show these details now.', true);
    if (typeof loadTodo === 'function') loadTodo();
  } catch (err) {
    showLegalAlert(alertBox, err.message);
  }
});

certificateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const alertBox = document.getElementById('certificateAlert');
  if (!certificateForm.elements.file.files[0]) {
    showLegalAlert(alertBox, 'Please choose the certificate file (PDF or photo).');
    return;
  }
  try {
    const res = await fetch('/api/admin/legal/certificate', { method: 'POST', body: new FormData(certificateForm) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not upload.');
    certificateForm.elements.file.value = '';
    fillLegal(data);
    showLegalAlert(alertBox, 'Certificate uploaded.', true);
  } catch (err) {
    showLegalAlert(alertBox, err.message);
  }
});

document.getElementById('certificateRemove').addEventListener('click', async () => {
  if (!confirm('Remove the stamping certificate from the website?')) return;
  const res = await fetch('/api/admin/legal/certificate', { method: 'DELETE' });
  if (res.ok) fillLegal(await res.json());
});

document.querySelector('.tab-btn[data-tab="team"]').addEventListener('click', loadLegal);
