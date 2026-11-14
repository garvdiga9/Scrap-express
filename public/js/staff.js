// The staff app (staff.html): sign in, see pickups, take one, and mark each
// step: on the way → arrived → weighed (photo + weight) → paid.
// The API is routes/staff.js; the rules are in lib/dispatch.js.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

const loginScreen = document.getElementById('staffLogin');
const app = document.getElementById('staffApp');
const alertBox = document.getElementById('staffAlert');

function showAlert(message) {
  alertBox.textContent = message;
  alertBox.hidden = !message;
  if (message) alertBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function api(url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    showLogin();
    throw new Error(data.error || 'Please sign in.');
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong. Please try again.');
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---------- Language: Hindi or English, remembered on this phone ---------- */
const isHindi = document.documentElement.lang === 'hi-IN';
document.querySelectorAll('[data-staff-lang]').forEach((button) => {
  button.textContent = isHindi ? 'English' : 'हिंदी';
  button.setAttribute('data-no-translate', '');
  button.addEventListener('click', () => {
    try { localStorage.setItem('se-staff-lang', isHindi ? 'en' : 'hi'); } catch (err) { /* private mode */ }
    window.location.reload();
  });
});

/* ---------- Sign in ---------- */
function showLogin() {
  app.hidden = true;
  loginScreen.hidden = false;
}

let pushMounted = false;
function showApp(name) {
  loginScreen.hidden = true;
  app.hidden = false;
  sendSaved();
  document.getElementById('staffHello').textContent = name;
  load();
  window.SELive.on('requests', () => load(true));
  window.SELive.start();
  if (!pushMounted) {
    pushMounted = true;
    window.SEPush.mount(document.getElementById('staffPushCard'), '/api/staff', {
      on: 'On — this phone gets an alert for every new pickup.',
      off: 'Get an alert on this phone whenever a pickup is ready to take.',
    });
  }
}

document.getElementById('staffLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const loginAlert = document.getElementById('staffLoginAlert');
  const button = document.getElementById('staffLoginBtn');
  loginAlert.hidden = true;
  button.disabled = true;
  button.textContent = 'Signing in…';
  try {
    const res = await fetch('/api/staff/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('staffUsername').value.trim(),
        password: document.getElementById('staffPassword').value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not sign you in. Please try again.');
    document.getElementById('staffPassword').value = '';
    showApp(data.name);
  } catch (err) {
    loginAlert.textContent = err.message;
    loginAlert.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Sign In';
  }
});

document.getElementById('staffLogout').addEventListener('click', async () => {
  await fetch('/api/staff/logout', { method: 'POST' }).catch(() => {});
  window.location.reload();
});

/* ---------- Pickups ---------- */
const STATUS_LABELS = {
  scheduled: 'Scheduled', on_way: 'On the way', arrived: 'At the site', weighed: 'Weighed', completed: 'Paid & done', no_scrap: 'No scrap at site',
};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
function button(label, className, onClick) {
  const b = el('button', `btn ${className}`, label);
  b.type = 'button';
  b.addEventListener('click', () => onClick(b));
  return b;
}
function link(label, href, className) {
  const a = el('a', `btn ${className}`, label);
  a.href = href;
  if (href.startsWith('http')) {
    a.target = '_blank';
    a.rel = 'noopener';
  }
  return a;
}
const row = (label, value) => {
  const p = el('p', 'staff-row');
  p.append(el('span', 'staff-row-label', label), el('span', 'staff-row-value', value));
  return p;
};

// Phone photos are several MB; a 1600px JPEG is plenty to read the display.
async function shrinkPhoto(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob || file;
  } catch (err) {
    return file;
  }
}

// This phone's position, or null if it's off or takes too long.
function herePosition() {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude.toFixed(6), longitude: coords.longitude.toFixed(6) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

// One action on a pickup: do it, then redraw the lists either way. With no
// signal, `offline` (when given) keeps it on the phone to send later.
async function act(pressed, run, offline) {
  showAlert('');
  pressed.disabled = true;
  try {
    await run();
  } catch (err) {
    if (offline && window.SEOutbox.isOffline(err)) {
      await offline();
      await showOutbox();
      drawCached();
      return;
    }
    showAlert(err.message);
  }
  await load(true);
}

/* ---------- No signal: the outbox and the last list ---------- */
const LIST_KEY = 'se-staff-pickups';
let cached = null;
try { cached = JSON.parse(localStorage.getItem(LIST_KEY) || 'null'); } catch (err) { cached = null; }

const outboxNote = document.createElement('p');
outboxNote.className = 'staff-outbox';
outboxNote.hidden = true;
document.querySelector('.staff-main').prepend(outboxNote);

async function showOutbox() {
  const waiting = await window.SEOutbox.count();
  outboxNote.hidden = !waiting && navigator.onLine;
  if (!navigator.onLine) {
    outboxNote.textContent = waiting
      ? `No signal. ${waiting} update${waiting === 1 ? '' : 's'} saved on this phone, and will be sent when the signal comes back.`
      : `No signal. Showing the list from ${cached ? new Date(cached.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : 'earlier'}.`;
  } else if (waiting) {
    outboxNote.textContent = `Sending ${waiting} saved update${waiting === 1 ? '' : 's'}…`;
  }
}

// What a step does to a pickup, so the saved list shows it straight away.
function applyLocally(pickupId, change) {
  if (!cached) return;
  ['mine', 'available', 'done'].forEach((key) => {
    cached.data[key].forEach((p) => { if (p.id === pickupId) Object.assign(p, change); });
  });
  const done = cached.data.mine.filter((p) => ['completed', 'no_scrap'].includes(p.status));
  cached.data.mine = cached.data.mine.filter((p) => !['completed', 'no_scrap'].includes(p.status));
  cached.data.done = [...done, ...cached.data.done];
  try { localStorage.setItem(LIST_KEY, JSON.stringify(cached)); } catch (err) { /* full */ }
}

function drawCached() {
  if (!cached) return;
  draw('mineList', cached.data.mine, 'You have no pickups right now.');
  draw('availableList', cached.data.available, 'No pickups waiting right now.');
  draw('doneList', cached.data.done, 'Nothing finished in the last 7 days.');
}

async function sendSaved() {
  const { sent, dropped } = await window.SEOutbox.flush();
  if (dropped.length) showAlert(dropped.join(' '));
  if (sent || dropped.length) await load(true);
  await showOutbox();
}
window.addEventListener('online', sendSaved);
window.addEventListener('offline', showOutbox);
setInterval(sendSaved, 30000);

const rupees = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// The same sums as the server (lib/dispatch.js priceWeighing), to show the
// amount while typing; the server works it out again from the quote.
function lineAmount(line, qty) {
  const q = Number(qty) || 0;
  if (line.unit === 'per kg') return q * line.rate;
  if (line.unit === 'per tonne') return (q / 1000) * line.rate;
  if (line.unit === 'per piece') return q * line.rate;
  return Number(line.rate);
}

// A weight (or count) for each quoted material, and a photo of the machine.
function weighForm(pickup) {
  const form = el('form', 'staff-weigh');
  form.noValidate = true;
  const lines = (pickup.quote || []).map((q) => ({ ...q, rate: Number(q.rate) }));
  const earlier = pickup.weighedItems || [];
  const inputs = [];
  const total = el('p', 'staff-total');
  const update = () => {
    const kg = lines.reduce((sum, line, i) => sum + (['per kg', 'per tonne'].includes(line.unit) ? Number(inputs[i].value) || 0 : 0), 0);
    const amount = lines.reduce((sum, line, i) => sum + lineAmount(line, inputs[i] ? inputs[i].value : 0), 0);
    total.textContent = `Total: ${kg.toLocaleString('en-IN')} kg · ${rupees(Math.round(amount * 100) / 100)}`;
  };
  form.appendChild(el('p', 'staff-weigh-title', 'Weight for each material'));
  lines.forEach((line, i) => {
    const label = el('label', 'staff-weigh-line');
    const name = el('span', null, `${line.material} (${rupees(line.rate)} ${line.unit})`);
    const input = el('input');
    if (line.unit === 'lump sum') {
      input.type = 'hidden';
      label.append(name, el('span', 'staff-fixed', `Fixed: ${rupees(line.rate)}`));
    } else {
      input.type = 'number';
      input.inputMode = 'decimal';
      input.min = '0';
      input.step = 'any';
      input.placeholder = line.unit === 'per piece' ? 'Pieces' : 'kg';
      input.setAttribute('aria-label', `${line.material}: ${line.unit === 'per piece' ? 'pieces' : 'kg'}`);
      if (earlier[i] && earlier[i].qty != null) input.value = earlier[i].qty;
      input.addEventListener('input', update);
      label.append(name, input);
    }
    inputs.push(input);
    form.appendChild(label);
  });
  form.appendChild(total);
  update();

  const photoLabel = el('label', null, 'Photo of the weighing machine (take it now, at the site)');
  const photo = el('input');
  photo.type = 'file';
  photo.accept = 'image/*';
  photo.setAttribute('capture', 'environment'); // opens the camera on a phone
  photoLabel.appendChild(photo);
  const save = el('button', 'btn btn-accent btn-block', pickup.status === 'weighed' ? 'Change Weight & Photo' : 'Save Weight & Photo');
  save.type = 'submit';
  form.append(photoLabel, save);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const quantities = lines.map((line, i) => (line.unit === 'lump sum' ? null : inputs[i].value));
    if (!lines.some((line, i) => line.unit === 'lump sum' || Number(inputs[i].value) > 0)) {
      showAlert('Please enter the weight for at least one material.');
      return;
    }
    if (!photo.files[0]) {
      showAlert('Please take a photo of the weighing machine.');
      return;
    }
    const parts = {};
    act(save, async () => {
      save.textContent = 'Uploading…';
      const body = new FormData();
      body.append('quantities', JSON.stringify(quantities));
      parts.quantities = JSON.stringify(quantities);
      // When the photo was taken, and where this phone is now: the owner is
      // warned about an old photo or one far from the site.
      body.append('takenAt', String(photo.files[0].lastModified || ''));
      parts.takenAt = String(photo.files[0].lastModified || '');
      const place = await herePosition();
      if (place) {
        body.append('latitude', place.latitude);
        body.append('longitude', place.longitude);
        Object.assign(parts, place);
      }
      parts.file = await shrinkPhoto(photo.files[0]);
      body.append('file', parts.file, 'weighing.jpg');
      const res = await fetch(`/api/staff/pickups/${pickup.id}/weigh`, { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save the weight. Please try again.');
    }, async () => {
      if (!parts.file) parts.file = await shrinkPhoto(photo.files[0]);
      await window.SEOutbox.add({
        url: `/api/staff/pickups/${pickup.id}/weigh`, form: parts, label: 'Weighing', pickupId: pickup.id,
      });
      // Show the amount on the phone as the server will work it out.
      const items = lines.map((line, i) => ({ ...line, qty: line.unit === 'lump sum' ? null : Number(inputs[i].value) || 0, amount: Math.round(lineAmount(line, inputs[i].value) * 100) / 100 }));
      const kg = lines.reduce((sum, line, i) => sum + (['per kg', 'per tonne'].includes(line.unit) ? Number(inputs[i].value) || 0 : 0), 0);
      applyLocally(pickup.id, {
        status: 'weighed', weighedKg: kg, weighedItems: items, amountDue: Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100,
      });
    });
  });
  return form;
}

// After weighing: the amount, confirmed or changed (with a reason), and how.
function payForm(pickup, post, later) {
  const form = el('form', 'staff-weigh staff-pay');
  form.noValidate = true;
  form.appendChild(el('p', 'staff-weigh-title', `Amount to pay: ${rupees(pickup.amountDue)}`));
  const amountLabel = el('label', null, 'Amount actually paid (₹)');
  const amount = el('input');
  amount.type = 'number';
  amount.inputMode = 'decimal';
  amount.min = '0';
  amount.step = 'any';
  amount.value = pickup.amountDue;
  amountLabel.appendChild(amount);
  const noteLabel = el('label', null, 'Reason, if the amount is different');
  noteLabel.hidden = true;
  const note = el('input');
  note.type = 'text';
  note.maxLength = 300;
  note.placeholder = 'e.g. some scrap was wet and refused';
  noteLabel.appendChild(note);
  amount.addEventListener('input', () => {
    noteLabel.hidden = Math.abs((Number(amount.value) || 0) - pickup.amountDue) < 1;
  });
  const pay = (method, label) => button(label, 'btn-accent btn-block', (b) => {
    const value = Number(amount.value);
    if (!(value >= 0) || amount.value === '') {
      showAlert('Please enter the amount paid.');
      return;
    }
    if (!noteLabel.hidden && !note.value.trim()) {
      showAlert('The amount is different from the one worked out. Please write the reason.');
      note.focus();
      return;
    }
    const question = method === 'cash'
      ? `Confirm: ${rupees(value)} paid in cash, pickup finished?`
      : `Confirm: the office will transfer ${rupees(value)} to the customer's bank, pickup finished?`;
    if (confirm(question)) {
      const body = { method, amount: value, note: note.value.trim() };
      act(b, () => post('paid', body), later('paid', body, 'Payment', { status: 'completed', amountPaid: value, payment: method }));
    }
  });
  form.append(amountLabel, noteLabel, pay('cash', 'Paid in Cash'), pay('bank', 'Bank Transfer (office pays)'));
  return form;
}

function card(pickup) {
  const box = el('article', `staff-card staff-${pickup.status}`);
  const head = el('div', 'staff-card-head');
  head.append(el('strong', null, pickup.company), el('span', `status-badge status-${pickup.status}`, STATUS_LABELS[pickup.status] || pickup.status));
  box.appendChild(head);
  if (pickup.slot) box.appendChild(el('p', 'staff-slot', pickup.slot.label));
  box.appendChild(row('Area', [pickup.area, pickup.pincode].filter(Boolean).join(' · ')));
  box.appendChild(row('Scrap type', `${pickup.scrap} · ${pickup.quantity}`));

  const post = (path, body) => api(`/api/staff/pickups/${pickup.id}/${path}`, 'POST', body || {});
  // The same step, saved on the phone when there's no signal.
  const later = (path, body, label, change) => async () => {
    await window.SEOutbox.add({
      url: `/api/staff/pickups/${pickup.id}/${path}`, json: body || {}, label, pickupId: pickup.id,
    });
    applyLocally(pickup.id, change);
  };
  const actions = el('div', 'staff-actions');

  if (!pickup.mine) {
    actions.appendChild(button("I'll Take It", 'btn-accent btn-block', (b) => act(b, () => post('claim'))));
    box.appendChild(actions);
    return box;
  }

  // Mine: the contact, address and what to do next.
  box.appendChild(row('Contact', pickup.contact));
  box.appendChild(row('Address', pickup.address));
  if (pickup.notes) box.appendChild(row('Notes', pickup.notes));
  if (pickup.quote && pickup.quote.length) {
    box.appendChild(row('Quoted rates', pickup.quote.map((q) => `${q.material}: ₹${q.rate} ${q.unit}`).join(', ')));
  }
  if (pickup.weighedKg != null) {
    box.appendChild(row('Weighed', `${pickup.weighedKg.toLocaleString('en-IN')} kg${pickup.amountDue != null ? ` · ${rupees(pickup.amountDue)}` : ''}`));
  }
  if (pickup.amountPaid != null) box.appendChild(row('Paid', `${rupees(pickup.amountPaid)} ${pickup.payment === 'cash' ? 'in cash' : 'by bank transfer'}`));

  const contact = el('div', 'staff-contact');
  contact.append(link('Call', `tel:${String(pickup.phone).replace(/[^\d+]/g, '')}`, 'btn-outline'), link('Open Map', pickup.map, 'btn-outline'));
  if (!['completed', 'no_scrap'].includes(pickup.status)) box.appendChild(contact);

  if (pickup.status === 'scheduled') {
    actions.append(
      button("Start: I'm On the Way", 'btn-accent btn-block', (b) => act(b, () => post('step', { step: 'on_way' }), later('step', { step: 'on_way' }, 'On the way', { status: 'on_way' }))),
      button('Give Back', 'btn-outline btn-block', (b) => {
        if (confirm('Give this pickup back so someone else can take it?')) act(b, () => post('release'));
      })
    );
  } else if (pickup.status === 'on_way') {
    actions.appendChild(button("I've Arrived", 'btn-accent btn-block', (b) => act(b, () => post('step', { step: 'arrived' }), later('step', { step: 'arrived' }, 'Arrived', { status: 'arrived' }))));
  } else if (pickup.status === 'arrived') {
    box.appendChild(weighForm(pickup));
    actions.appendChild(button('No Scrap at Site', 'btn-danger btn-block', (b) => {
      if (confirm('Mark this pickup as "no scrap at site"? The owner and the customer will be told.')) act(b, () => post('no-scrap'), later('no-scrap', {}, 'No scrap at site', { status: 'no_scrap' }));
    }));
  } else if (pickup.status === 'weighed') {
    box.appendChild(payForm(pickup, post, later));
    const fix = el('details', 'staff-fix');
    fix.append(el('summary', null, 'Wrong weight or photo?'), weighForm(pickup));
    box.appendChild(fix);
  }
  if (actions.children.length) box.appendChild(actions);
  return box;
}

function draw(listId, pickups, empty) {
  const list = document.getElementById(listId);
  // Don't wipe a weight being typed or a photo being chosen.
  if (list.contains(document.activeElement) && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  list.innerHTML = '';
  if (!pickups.length) {
    list.appendChild(el('p', 'staff-empty', empty));
    return;
  }
  pickups.forEach((p) => list.appendChild(card(p)));
}

async function load(background = false) {
  try {
    // Saved updates go first, so the list comes back with them applied.
    if (navigator.onLine) await window.SEOutbox.flush().then(({ dropped }) => { if (dropped.length) showAlert(dropped.join(' ')); });
    const data = await api('/api/staff/pickups');
    cached = { at: Date.now(), data };
    try { localStorage.setItem(LIST_KEY, JSON.stringify(cached)); } catch (err) { /* full */ }
    showOutbox();
    draw('mineList', data.mine, 'You have no pickups right now. Take one from the list below.');
    draw('availableList', data.available, 'No pickups waiting right now.');
    draw('doneList', data.done, 'Nothing finished in the last 7 days.');
    document.getElementById('mineCount').textContent = data.mine.length || '';
    document.getElementById('availableCount').textContent = data.available.length || '';
  } catch (err) {
    if (window.SEOutbox.isOffline(err) && cached) {
      drawCached();
      showOutbox();
      return;
    }
    if (!background) showAlert(err.message);
  }
}

/* ---------- Install as an app ---------- */
(() => {
  const install = document.getElementById('staffInstall');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) return;
  let promptEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    promptEvent = e;
    install.hidden = false;
  });
  window.addEventListener('appinstalled', () => { install.hidden = true; });
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIos) install.hidden = false;
  install.addEventListener('click', async () => {
    if (promptEvent) {
      promptEvent.prompt();
      await promptEvent.userChoice.catch(() => {});
      promptEvent = null;
      install.hidden = true;
    } else if (isIos) {
      alert('To install: tap the Share button in Safari, then "Add to Home Screen".');
    }
  });
})();

/* ---------- Start ---------- */
(async () => {
  try {
    const res = await fetch('/api/staff/me');
    if (res.ok) showApp((await res.json()).name);
    else showLogin();
  } catch (err) {
    // No signal: if this phone was signed in before, show the saved list.
    if (cached) {
      loginScreen.hidden = true;
      app.hidden = false;
      drawCached();
      showOutbox();
    } else {
      showLogin();
    }
  }
})();
