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

// One action on a pickup: do it, then redraw the lists either way.
async function act(pressed, run) {
  showAlert('');
  pressed.disabled = true;
  try {
    await run();
  } catch (err) {
    showAlert(err.message);
  }
  await load(true);
}

function weighForm(pickup) {
  const form = el('form', 'staff-weigh');
  form.noValidate = true;
  const kgLabel = el('label', null, 'Weight on the machine (kg)');
  const kg = el('input');
  kg.type = 'number';
  kg.inputMode = 'decimal';
  kg.min = '0';
  kg.step = 'any';
  kg.required = true;
  if (pickup.weighedKg) kg.value = pickup.weighedKg;
  kgLabel.appendChild(kg);
  const photoLabel = el('label', null, 'Photo of the weighing machine');
  const photo = el('input');
  photo.type = 'file';
  photo.accept = 'image/*';
  photo.setAttribute('capture', 'environment'); // opens the camera on a phone
  photoLabel.appendChild(photo);
  const save = el('button', 'btn btn-accent btn-block', pickup.status === 'weighed' ? 'Change Weight & Photo' : 'Save Weight & Photo');
  save.type = 'submit';
  form.append(kgLabel, photoLabel, save);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!(Number(kg.value) > 0)) {
      showAlert('Please enter the weight in kg.');
      return;
    }
    if (!photo.files[0]) {
      showAlert('Please take a photo of the weighing machine.');
      return;
    }
    act(save, async () => {
      save.textContent = 'Uploading…';
      const body = new FormData();
      body.append('kg', kg.value);
      body.append('file', await shrinkPhoto(photo.files[0]), 'weighing.jpg');
      const res = await fetch(`/api/staff/pickups/${pickup.id}/weigh`, { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save the weight. Please try again.');
    });
  });
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
  if (pickup.weighedKg != null) box.appendChild(row('Weighed', `${pickup.weighedKg.toLocaleString('en-IN')} kg`));

  const contact = el('div', 'staff-contact');
  contact.append(link('Call', `tel:${String(pickup.phone).replace(/[^\d+]/g, '')}`, 'btn-outline'), link('Open Map', pickup.map, 'btn-outline'));
  if (!['completed', 'no_scrap'].includes(pickup.status)) box.appendChild(contact);

  if (pickup.status === 'scheduled') {
    actions.append(
      button("Start: I'm On the Way", 'btn-accent btn-block', (b) => act(b, () => post('step', { step: 'on_way' }))),
      button('Give Back', 'btn-outline btn-block', (b) => {
        if (confirm('Give this pickup back so someone else can take it?')) act(b, () => post('release'));
      })
    );
  } else if (pickup.status === 'on_way') {
    actions.appendChild(button("I've Arrived", 'btn-accent btn-block', (b) => act(b, () => post('step', { step: 'arrived' }))));
  } else if (pickup.status === 'arrived') {
    box.appendChild(weighForm(pickup));
    actions.appendChild(button('No Scrap at Site', 'btn-danger btn-block', (b) => {
      if (confirm('Mark this pickup as "no scrap at site"? The owner and the customer will be told.')) act(b, () => post('no-scrap'));
    }));
  } else if (pickup.status === 'weighed') {
    actions.append(
      button('Paid in Cash', 'btn-accent btn-block', (b) => {
        if (confirm('Confirm: paid in cash, pickup finished?')) act(b, () => post('paid', { method: 'cash' }));
      }),
      button('Paid by Bank Transfer', 'btn-accent btn-block', (b) => {
        if (confirm('Confirm: paid by bank transfer, pickup finished?')) act(b, () => post('paid', { method: 'bank' }));
      })
    );
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
    const data = await api('/api/staff/pickups');
    draw('mineList', data.mine, 'You have no pickups right now. Take one from the list below.');
    draw('availableList', data.available, 'No pickups waiting right now.');
    draw('doneList', data.done, 'Nothing finished in the last 7 days.');
    document.getElementById('mineCount').textContent = data.mine.length || '';
    document.getElementById('availableCount').textContent = data.available.length || '';
  } catch (err) {
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
    showLogin();
  }
})();
