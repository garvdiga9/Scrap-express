const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

/* ---------- Conversion tracking ----------
   Forms are counted by the server when they arrive (Admin → Analytics).
   Taps on the phone number and WhatsApp can only be seen here, so they're
   sent to /api/track. Every conversion also goes to Google Analytics when
   it's switched on (GA_MEASUREMENT_ID on Render). Nothing about who. */
const PAGE_TRACKED = new Set(['call_click', 'whatsapp_click']);
window.SETrack = (event) => {
  if (typeof window.gtag === 'function') window.gtag('event', event, { page_path: window.location.pathname });
  if (!PAGE_TRACKED.has(event)) return;
  const body = new Blob([JSON.stringify({ event, page: window.location.pathname })], { type: 'application/json' });
  if (!(navigator.sendBeacon && navigator.sendBeacon('/api/track', body))) {
    fetch('/api/track', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
  }
};
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href]');
  if (!link || link.hasAttribute('data-callback')) return; // "Request a call back" opens a form instead
  const href = link.getAttribute('href');
  if (href.startsWith('tel:')) window.SETrack('call_click');
  else if (/^https:\/\/(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|whatsapp\.com\/channel)/.test(href)) window.SETrack('whatsapp_click');
}, { capture: true });

/* ---------- Back to top ---------- */
const backToTop = document.getElementById('backToTop');
if (backToTop) {
  backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

/* ---------- Installable app ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

const installBanner = document.getElementById('installBanner');
const installBtn = document.getElementById('installBtn');
const footerInstall = document.getElementById('footerInstall');
const isInstalledApp = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
// iPhones/iPads have no install prompt; Safari users add it from the Share menu.
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const INSTALL_DISMISSED_KEY = 'se-install-dismissed';
const INSTALL_QUIET_DAYS = 14;
let installPrompt = null;

function installDismissedRecently() {
  try {
    const at = Number(localStorage.getItem(INSTALL_DISMISSED_KEY) || 0);
    return Date.now() - at < INSTALL_QUIET_DAYS * 24 * 60 * 60 * 1000;
  } catch (err) {
    return false;
  }
}
function setInstallBanner(show) {
  if (!installBanner) return;
  installBanner.hidden = !show;
  document.body.classList.toggle('install-banner-open', show);
  if (show) {
    const gap = 16 + 12; // banner's bottom margin + breathing room
    document.documentElement.style.setProperty('--install-space', `${installBanner.offsetHeight + gap}px`);
  }
}
function showIOSSteps() {
  document.getElementById('installHint').textContent = 'Tap the Share button, then "Add to Home Screen".';
  installBtn.hidden = true;
  setInstallBanner(true);
}

if (installBanner && !isInstalledApp) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // show our own banner instead of the browser's mini bar
    installPrompt = e;
    footerInstall.hidden = false;
    if (!installDismissedRecently()) setInstallBanner(true);
  });
  if (isIOS) {
    footerInstall.hidden = false;
    if (!installDismissedRecently()) setTimeout(showIOSSteps, 4000);
  }

  installBtn.addEventListener('click', async () => {
    if (!installPrompt) return showIOSSteps();
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    setInstallBanner(false);
  });
  footerInstall.addEventListener('click', (e) => {
    e.preventDefault();
    if (installPrompt) installBtn.click();
    else showIOSSteps();
  });
  document.getElementById('installClose').addEventListener('click', () => {
    setInstallBanner(false);
    try { localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now())); } catch (err) { /* private mode */ }
  });
  window.addEventListener('appinstalled', () => {
    setInstallBanner(false);
    footerInstall.hidden = true;
  });
}

// Confirmation after "Delete My Account" (account-delete.js sends people here).
const deletedNotice = document.getElementById('deletedNotice');
if (deletedNotice && new URLSearchParams(window.location.search).get('done') === '1') deletedNotice.hidden = false;

/* ---------- Daily rates sign-up (above the footer) ---------- */
const subscribeForm = document.getElementById('subscribeForm');
if (subscribeForm) {
  const contactInput = document.getElementById('subscribeContact');
  const subscribeBtn = document.getElementById('subscribeBtn');
  const subscribeMsg = document.getElementById('subscribeMsg');
  const showSubscribeMsg = (text, ok) => {
    subscribeMsg.textContent = text;
    subscribeMsg.className = `subscribe-msg ${ok ? 'ok' : 'error'}`;
    subscribeMsg.hidden = false;
  };
  subscribeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const contact = contactInput.value.trim();
    if (!contact) {
      showSubscribeMsg('Please enter your email or WhatsApp number.', false);
      contactInput.focus();
      return;
    }
    subscribeBtn.disabled = true;
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not subscribe you right now. Please try again.');
      showSubscribeMsg(data.message, true);
      subscribeForm.reset();
    } catch (err) {
      showSubscribeMsg(err.message, false);
    } finally {
      subscribeBtn.disabled = false;
    }
  });

  if (window.SEPush) {
    window.SEPush.mount(document.getElementById('updatesPush'), '/api/subscribe', {
      on: "App alerts are on for this device.",
      off: '',
      turnOn: '🔔 Get app alerts',
      turnOff: 'Stop app alerts',
      hideUnavailable: true,
    });
  }
}

/* ---------- Sticky header ---------- */
const header = document.getElementById('siteHeader');
function onScroll() {
  if (header) header.classList.toggle('scrolled', window.scrollY > 10);
  if (backToTop) backToTop.classList.toggle('visible', window.scrollY > 500);
}
window.addEventListener('scroll', onScroll);
onScroll();

/* ---------- Mobile nav ---------- */
const navToggle = document.getElementById('navToggle');
const mainNav = document.getElementById('mainNav');
function setMenu(open) {
  mainNav.classList.toggle('open', open);
  navToggle.setAttribute('aria-expanded', String(open));
  navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  navToggle.innerHTML = open
    ? '<svg class="icon" aria-hidden="true"><use href="#icon-close"/></svg>'
    : '<svg class="icon" aria-hidden="true"><use href="#icon-menu"/></svg>';
}
if (navToggle && mainNav) {
  navToggle.addEventListener('click', () => setMenu(!mainNav.classList.contains('open')));
  mainNav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setMenu(false)));
  // Escape closes the menu and puts the keyboard back on its button.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mainNav.classList.contains('open')) {
      setMenu(false);
      navToggle.focus();
    }
  });
}

/* ---------- Light / dark theme ----------
   head.ejs already applied the saved choice (or the device's setting). The
   button switches and remembers it on this device. */
const themeToggle = document.getElementById('themeToggle');
function showThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => button.setAttribute('aria-pressed', String(dark)));
  if (themeToggle) themeToggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0b1220' : '#16a34a');
}
if (themeToggle) {
  // The header button, and on phones the one inside the menu.
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => button.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('se-theme', next); } catch (err) { /* private mode: just for this page */ }
    showThemeButton();
  }));
  // Follow the device's setting until a choice is made here.
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', (e) => {
    let saved = null;
    try { saved = localStorage.getItem('se-theme'); } catch (err) { /* ignore */ }
    if (saved) return;
    document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
    showThemeButton();
  });
  showThemeButton();
}

/* ---------- Reveal-on-scroll animation ---------- */
// Grids bring their cards in one after another; other blocks fade in whole.
// Cards added later (rates and reviews load from the API) are numbered too.
const STAGGER_GRIDS = '.rates-grid, .buy-grid, .impact-grid, .steps-grid, .why-grid, .reviews-grid, .areas-grid';
const MAX_STAGGER = 12;
function numberChildren(grid) {
  [...grid.children].forEach((child, i) => child.style.setProperty('--i', Math.min(i, MAX_STAGGER)));
}
document.querySelectorAll(STAGGER_GRIDS).forEach((grid) => {
  grid.classList.add('reveal-stagger');
  numberChildren(grid);
  new MutationObserver(() => numberChildren(grid)).observe(grid, { childList: true });
});
// Not the long request forms: they'd stay blank until far down the page.
document.querySelectorAll('.book-head').forEach((el) => el.classList.add('reveal'));

const revealObserver = new IntersectionObserver(
  (entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.15 }
);
document.querySelectorAll('.reveal, .reveal-stagger').forEach((el) => revealObserver.observe(el));

/* ---------- Hero: type out the kind of business ---------- */
const rotator = document.getElementById('heroRotator');
if (rotator && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const words = JSON.parse(rotator.dataset.words);
  let wordIndex = 0;
  let letters = words[0].length;
  let deleting = true;
  const HOLD = 1600;

  const step = () => {
    const word = words[wordIndex];
    rotator.textContent = word.slice(0, letters);
    if (!deleting && letters === word.length) {
      deleting = true;
      return setTimeout(step, HOLD);
    }
    if (deleting && letters === 0) {
      deleting = false;
      wordIndex = (wordIndex + 1) % words.length;
      return setTimeout(step, 250);
    }
    letters += deleting ? -1 : 1;
    setTimeout(step, deleting ? 45 : 90);
  };
  setTimeout(step, HOLD + 600);
}

/* ---------- Stat count-up ----------
   The page already shows the real numbers, and they stay until a visitor
   actually scrolls (search engines and page checkers never do, so they always
   see real figures). Then a block still below the screen drops to 0 and
   counts up when it comes into view. Blocks already on screen are left alone,
   and so is everything for reduced-motion users. */
function animateCount(el, target) {
  const duration = 1400;
  const start = performance.now();
  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(eased * target).toLocaleString('en-IN');
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const statNums = (block) => [...block.querySelectorAll('.stat-num, .impact-num')]
    .filter((el) => Number.isFinite(Number(el.dataset.count)));
  const statObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        statNums(entry.target).forEach((el) => animateCount(el, Number(el.dataset.count)));
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.4 }
  );
  const blocks = ['heroStats', 'impactStats'].map((id) => document.getElementById(id)).filter(Boolean);
  if (blocks.length) {
    window.addEventListener('scroll', () => {
      blocks.forEach((block) => {
        if (block.getBoundingClientRect().top < window.innerHeight) return; // already seen
        statNums(block).forEach((el) => { el.textContent = '0'; });
        statObserver.observe(block);
      });
    }, { once: true, passive: true });
  }
}

/* ---------- Live sections (rates, reviews, home page numbers) ----------
   The server draws these (views/partials/rate-card.ejs, views/index.ejs), so
   they show without JavaScript and to search engines. When the admin changes
   something, re-read this page and swap in the fresh copies of whatever is
   marked data-live-section, so there's only one version of how they look. */
async function refreshLiveSections() {
  const sections = [...document.querySelectorAll('[data-live-section]')];
  if (!sections.length) return;
  try {
    const res = await fetch(window.location.pathname, { headers: { Accept: 'text/html' } });
    if (!res.ok) return;
    const page = new DOMParser().parseFromString(await res.text(), 'text/html');
    sections.forEach((section) => {
      const fresh = page.getElementById(section.id);
      if (!fresh || fresh.innerHTML === section.innerHTML) return;
      section.hidden = fresh.hidden;
      section.innerHTML = fresh.innerHTML;
      section.dispatchEvent(new CustomEvent('live-refreshed', { bubbles: true }));
    });
  } catch (err) {
    // Keep what's showing; the next update will try again.
  }
}

if (document.querySelector('[data-live-section]')) {
  window.SELive.on('rates', refreshLiveSections);
  window.SELive.on('reviews', refreshLiveSections);
  window.SELive.on('lots', refreshLiveSections);
  window.SELive.start();
}

/* ---------- Rates page: search box and group tabs ---------- */
(() => {
  const live = document.getElementById('ratesLive');
  if (!live) return;
  let tab = 'all';
  let query = '';
  // "#plastic" in the address opens that tab (shareable links).
  const fromHash = window.location.hash.slice(1);

  function apply() {
    const filter = document.getElementById('rateFilter');
    const grid = document.getElementById('ratesGrid');
    if (!filter || !grid) return;
    filter.hidden = false;
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const cards = [...grid.querySelectorAll('.rate-card')];
    let shown = 0;
    cards.forEach((card) => {
      const match = (tab === 'all' || card.dataset.category === tab)
        && words.every((word) => card.dataset.search.includes(word));
      card.hidden = !match;
      if (match) shown++;
    });
    filter.querySelectorAll('.rate-tab').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.tab === tab));
    });
    document.getElementById('ratesEmpty').hidden = shown > 0;
    document.getElementById('rateFilterStatus').textContent = shown === cards.length
      ? `${cards.length} rates` : `Showing ${shown} of ${cards.length} rates`;
  }

  live.addEventListener('click', (e) => {
    const button = e.target.closest('.rate-tab');
    if (!button) return;
    tab = button.dataset.tab;
    history.replaceState(null, '', tab === 'all' ? window.location.pathname : `#${tab}`);
    apply();
  });
  live.addEventListener('input', (e) => {
    if (e.target.id !== 'rateSearch') return;
    query = e.target.value;
    apply();
  });
  // A live update redraws the section: put the search text and tab back.
  live.addEventListener('live-refreshed', () => {
    const search = document.getElementById('rateSearch');
    if (search) search.value = query;
    apply();
  });

  if (live.querySelector(`.rate-tab[data-tab="${CSS.escape(fromHash)}"]`)) tab = fromHash;
  apply();
})();

/* ---------- Pickup form submission ---------- */
const pickupForm = document.getElementById('pickupForm');
const formAlert = document.getElementById('formAlert');
const submitBtn = document.getElementById('submitBtn');

function showAlert(alertEl, message, type) {
  alertEl.textContent = message;
  alertEl.className = `form-alert ${type}`;
  alertEl.hidden = false;
  alertEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------- Photo / video attachments ---------- */
const MB = 1024 * 1024;
// Phone photos are 3–8 MB; a 1600px JPEG is plenty to quote from and
// uploads many times faster, so photos are shrunk before sending.
const PHOTO_MAX_SIDE = 1600;

async function shrinkPhoto(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
  } catch (err) {
    return file; // a format this browser can't draw (e.g. HEIC): send it as it is
  }
}

function setupMediaPicker(form) {
  const box = form && form.querySelector('.media-upload');
  if (!box) return null;
  const limits = { photo: Number(box.dataset.maxPhotos), video: Number(box.dataset.maxVideos) };
  const maxMB = { photo: Number(box.dataset.photoMb), video: Number(box.dataset.videoMb) };
  const previews = box.querySelector('.media-previews');
  const errorEl = box.querySelector('.media-error');
  let items = [];
  let preparing = 0;

  const showError = (message) => { errorEl.textContent = message; errorEl.hidden = !message; };
  const remove = (item) => {
    URL.revokeObjectURL(item.url);
    items = items.filter((x) => x !== item);
    render();
    showError('');
  };
  function render() {
    previews.innerHTML = '';
    items.forEach((item) => {
      const li = document.createElement('li');
      li.className = `media-preview media-${item.kind}`;
      const thumb = document.createElement(item.kind === 'photo' ? 'img' : 'video');
      thumb.src = item.url;
      if (item.kind === 'photo') {
        thumb.alt = item.file.name;
        // Browsers that can't show HEIC still upload it; show a placeholder.
        thumb.addEventListener('error', () => thumb.replaceWith(Object.assign(document.createElement('span'), { className: 'media-placeholder', textContent: 'Photo' })));
      } else {
        thumb.muted = true;
        thumb.preload = 'metadata';
        thumb.playsInline = true;
      }
      const size = document.createElement('span');
      size.className = 'media-size';
      size.textContent = item.file.size < 0.1 * MB
        ? `${Math.max(1, Math.round(item.file.size / 1024))} KB`
        : `${(item.file.size / MB).toFixed(1)} MB`;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'media-remove';
      removeBtn.setAttribute('aria-label', `Remove ${item.file.name}`);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => remove(item));
      li.append(thumb, size, removeBtn);
      previews.appendChild(li);
    });
  }

  box.querySelectorAll('.media-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const { kind } = input.dataset;
      const chosen = [...input.files];
      input.value = ''; // so picking the same file again still fires "change"
      showError('');
      const problems = [];
      preparing += 1;
      try {
        for (const original of chosen) {
          if (items.filter((i) => i.kind === kind).length >= limits[kind]) {
            problems.push(`You can add up to ${limits[kind]} ${kind}s.`);
            break;
          }
          if (!original.type.startsWith(kind === 'photo' ? 'image/' : 'video/')) {
            problems.push(`"${original.name}" isn't a ${kind}.`);
            continue;
          }
          const file = kind === 'photo' ? await shrinkPhoto(original) : original;
          if (file.size > maxMB[kind] * MB) {
            problems.push(kind === 'video'
              ? `"${original.name}" is over ${maxMB.video} MB. Please send a shorter clip, or WhatsApp it to us.`
              : `"${original.name}" is over ${maxMB.photo} MB.`);
            continue;
          }
          items.push({ kind, file, url: URL.createObjectURL(file) });
          render();
        }
      } finally {
        preparing -= 1;
      }
      showError(problems.join(' '));
    });
  });

  form.addEventListener('reset', () => {
    items.forEach((item) => URL.revokeObjectURL(item.url));
    items = [];
    render();
    showError('');
  });

  return {
    files: () => items,
    isPreparing: () => preparing > 0,
    // Every request needs at least one photo or video.
    requireOne() {
      if (items.length) return true;
      showError('Please add at least one photo or video so we can quote accurately.');
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    },
  };
}

// Sends a request form as JSON, or, when files are attached, as multipart
// with the fields in one JSON "data" part, reporting upload progress.
function submitRequest(url, payload, files, onProgress) {
  if (!files.length) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => ({})) }));
  }
  const body = new FormData();
  body.append('data', JSON.stringify(payload));
  files.forEach(({ kind, file }) => body.append(kind === 'photo' ? 'photos' : 'videos', file, file.name));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.responseType = 'json';
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener('load', () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, data: xhr.response || {} }));
    xhr.addEventListener('error', () => reject(new Error('The upload failed. Please check your connection and try again.')));
    xhr.send(body);
  });
}

const pickupMedia = setupMediaPicker(pickupForm);

/* "Other" scrap type: reveal a description box only while it's ticked */
const otherCheckbox = document.getElementById('scrapTypeOther');
const otherWrap = document.getElementById('otherScrapWrap');
if (otherCheckbox && otherWrap) {
  otherCheckbox.addEventListener('change', () => {
    otherWrap.hidden = !otherCheckbox.checked;
    if (otherCheckbox.checked) document.getElementById('otherScrapType').focus();
  });
  // form.reset() unticks the box without firing "change", so hide it here too.
  pickupForm.addEventListener('reset', () => { otherWrap.hidden = true; });
}

/* Pickup or "I'll send it myself": the pickup-only questions (where the
   scrap is kept, taking down) only for a pickup. */
if (pickupForm) {
  const showDelivery = () => {
    const self = Boolean(pickupForm.querySelector('[data-delivery-mode][value="self"]:checked'));
    pickupForm.querySelectorAll('[data-pickup-only]').forEach((el) => { el.hidden = self; });
    pickupForm.querySelectorAll('[data-self-only]').forEach((el) => { el.hidden = !self; });
    const submit = document.getElementById('submitBtn');
    if (submit) submit.textContent = self ? 'Request Quote for Drop-off' : 'Request Bulk Quote';
  };
  pickupForm.addEventListener('change', (e) => { if (e.target.matches('[data-delivery-mode]')) showDelivery(); });
  pickupForm.addEventListener('reset', () => setTimeout(showDelivery));
  showDelivery();
}

/* Quantity per item: with two or more scrap types ticked, ask for the
   quantity of each (added up for the minimum) instead of one total. */
const KG_PER_UNIT = { kg: 1, tonnes: 1000 };
const itemQuantitiesBox = document.getElementById('itemQuantities');
const itemQuantityList = document.getElementById('itemQuantityList');
const itemTotal = document.getElementById('itemTotal');
const totalQuantityGroup = document.getElementById('totalQuantityGroup');
const pickupMinKg = Number(document.getElementById('quantity')?.dataset.minKg || 0);
// Kept across re-draws so ticking another box doesn't wipe what was typed.
const itemQuantityValues = new Map();

const formatKg = (kg) => (kg >= 1000
  ? `${(kg / 1000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} tonnes`
  : `${kg.toLocaleString('en-IN', { maximumFractionDigits: 2 })} kg`);

function checkedScrapTypes() {
  return [...pickupForm.querySelectorAll('input[name="scrapTypes"]:checked')].map((box) => box.value);
}

function readItemQuantities() {
  return [...itemQuantityList.querySelectorAll('.item-quantity')].map((row) => ({
    type: row.dataset.type,
    quantity: row.querySelector('input').value,
    unit: row.querySelector('select').value,
  }));
}

function updateItemTotal() {
  const items = readItemQuantities();
  const kg = items.reduce((sum, i) => sum + (Number(i.quantity) > 0 ? Number(i.quantity) * KG_PER_UNIT[i.unit] : 0), 0);
  itemTotal.textContent = kg ? `Total: ${formatKg(kg)}${kg < pickupMinKg ? ` (minimum is ${pickupMinKg} kg)` : ' ✓'}` : '';
  itemTotal.classList.toggle('under-min', kg > 0 && kg < pickupMinKg);
  return kg;
}

function renderItemQuantities() {
  if (!itemQuantitiesBox) return;
  const types = checkedScrapTypes();
  const several = types.length > 1;
  itemQuantitiesBox.hidden = !several;
  totalQuantityGroup.hidden = several;
  if (!several) return;

  const otherText = document.getElementById('otherScrapType').value.trim();
  itemQuantityList.innerHTML = '';
  types.forEach((type) => {
    const saved = itemQuantityValues.get(type) || { quantity: '', unit: 'kg' };
    const row = document.createElement('div');
    row.className = 'item-quantity';
    row.dataset.type = type;

    const label = document.createElement('label');
    const inputId = `itemQty-${type.replace(/\W+/g, '-')}`;
    label.htmlFor = inputId;
    label.textContent = type === 'Other' ? (otherText || 'Other') : type;

    const wrap = document.createElement('div');
    wrap.className = 'quantity-input';
    const input = document.createElement('input');
    input.type = 'number';
    input.id = inputId;
    input.min = '0';
    input.step = 'any';
    input.inputMode = 'decimal';
    input.placeholder = 'Qty';
    input.value = saved.quantity;
    const unit = document.createElement('select');
    unit.setAttribute('aria-label', `Unit for ${label.textContent}`);
    Object.keys(KG_PER_UNIT).forEach((u) => unit.append(new Option(u, u, false, u === saved.unit)));

    const remember = () => {
      itemQuantityValues.set(type, { quantity: input.value, unit: unit.value });
      updateItemTotal();
    };
    input.addEventListener('input', remember);
    unit.addEventListener('change', remember);

    wrap.append(input, unit);
    row.append(label, wrap);
    itemQuantityList.appendChild(row);
  });
  updateItemTotal();
}

if (pickupForm && itemQuantitiesBox) {
  pickupForm.querySelectorAll('input[name="scrapTypes"]').forEach((box) => box.addEventListener('change', renderItemQuantities));
  // Keep the "Other" row's label in step with its description.
  document.getElementById('otherScrapType').addEventListener('input', () => {
    const otherLabel = itemQuantityList.querySelector('.item-quantity[data-type="Other"] label');
    if (otherLabel) otherLabel.textContent = document.getElementById('otherScrapType').value.trim() || 'Other';
  });
  pickupForm.addEventListener('reset', () => {
    itemQuantityValues.clear();
    setTimeout(renderItemQuantities); // after the browser has unticked the boxes
  });
  renderItemQuantities(); // boxes the browser kept ticked after "back"
}

/* ---------- Pickup form: two steps ----------
   Step 1 (company, phone, scrap, quantity) is saved as a lead the moment the
   customer presses Continue, so the team can call even if step 2 is never
   finished. Step 2 (site, photos, contact) completes the request. */

// Step 1's fields in the shape the API wants, or null after showing what's
// missing. Used by Continue and again by the final submit.
function readStepOne(payload, formData) {
  // fromEntries keeps only the last ticked checkbox, so collect them all.
  payload.scrapTypes = formData.getAll('scrapTypes');
  if (!payload.companyName.trim() || !payload.phone.trim()) {
    showAlert(formAlert, 'Please fill in your company name and phone number.', 'error');
    document.getElementById(payload.companyName.trim() ? 'phone' : 'companyName').focus();
    return null;
  }
  if (!window.SEValidate.checkField(document.getElementById('phone'))) {
    document.getElementById('phone').focus();
    return null;
  }
  if (!payload.scrapTypes.length) {
    showAlert(formAlert, 'Please tick at least one scrap type.', 'error');
    pickupForm.querySelector('input[name="scrapTypes"]').focus();
    return null;
  }
  if (payload.scrapTypes.includes('Other')) {
    payload.otherScrapType = (payload.otherScrapType || '').trim();
    if (!payload.otherScrapType) {
      showAlert(formAlert, 'Please describe the other scrap type.', 'error');
      document.getElementById('otherScrapType').focus();
      return null;
    }
  } else {
    delete payload.otherScrapType;
  }
  if (payload.scrapTypes.length > 1) {
    // A quantity for each ticked item; the minimum applies to their total.
    payload.itemQuantities = readItemQuantities();
    delete payload.quantity;
    delete payload.quantityUnit;
    const missing = payload.itemQuantities.find((i) => !(Number(i.quantity) > 0));
    if (missing) {
      const name = missing.type === 'Other' ? 'the other scrap' : missing.type;
      showAlert(formAlert, `Please enter the quantity for ${name}.`, 'error');
      itemQuantityList.querySelector(`.item-quantity[data-type="${CSS.escape(missing.type)}"] input`).focus();
      return null;
    }
    if (updateItemTotal() < pickupMinKg) {
      showAlert(formAlert, `We handle bulk pickups of ${pickupMinKg} kg or more in total. Please check the quantities.`, 'error');
      itemQuantityList.querySelector('input').focus();
      return null;
    }
  } else {
    const quantityInput = document.getElementById('quantity');
    const quantityKg = Number(payload.quantity) * (payload.quantityUnit === 'tonnes' ? 1000 : 1);
    if (!payload.quantity || !(quantityKg > 0)) {
      showAlert(formAlert, 'Please enter the approximate total quantity.', 'error');
      quantityInput.focus();
      return null;
    }
    if (quantityKg < pickupMinKg) {
      showAlert(formAlert, `We handle bulk pickups of ${pickupMinKg} kg or more. Please check the quantity.`, 'error');
      quantityInput.focus();
      return null;
    }
  }
  return payload;
}

const LEAD_KEY = 'se-pickup-lead';
const leadTokenInput = document.getElementById('leadToken');
const stepNextBtn = document.getElementById('stepNextBtn');
const stepBackBtn = document.getElementById('stepBackBtn');

function showStep(n, { focus = true } = {}) {
  pickupForm.dataset.step = n;
  pickupForm.querySelectorAll('.form-step').forEach((step) => { step.hidden = step.dataset.step !== String(n); });
  document.querySelectorAll('[data-step-dot]').forEach((dot) => {
    dot.classList.toggle('is-current', dot.dataset.stepDot === String(n));
    dot.classList.toggle('is-done', Number(dot.dataset.stepDot) < n);
  });
  if (focus) {
    const legend = pickupForm.querySelector(`.form-step[data-step="${n}"] legend`);
    pickupForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    legend.focus({ preventScroll: true });
  }
}

if (pickupForm && stepNextBtn) {
  // With JavaScript: one step at a time.
  document.getElementById('formSteps').hidden = false;
  stepNextBtn.hidden = false;
  stepBackBtn.hidden = false;
  document.getElementById('stepOneNote').hidden = false;
  try { leadTokenInput.value = sessionStorage.getItem(LEAD_KEY) || ''; } catch (err) { /* private mode */ }
  showStep(1, { focus: false });

  stepNextBtn.addEventListener('click', async () => {
    formAlert.hidden = true;
    const formData = new FormData(pickupForm);
    const payload = readStepOne(Object.fromEntries(formData.entries()), formData);
    if (!payload) return;
    stepNextBtn.disabled = true;
    stepNextBtn.textContent = 'Saving…';
    try {
      const res = await fetch('/api/pickup/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: payload.companyName,
          phone: payload.phone,
          scrapTypes: payload.scrapTypes,
          otherScrapType: payload.otherScrapType,
          quantity: payload.quantity,
          quantityUnit: payload.quantityUnit,
          itemQuantities: payload.itemQuantities,
          leadToken: leadTokenInput.value,
        }),
      });
      const data = await res.json().catch(() => ({}));
      // A problem the customer can fix stops here; a network hiccup doesn't
      // (step 2 sends everything anyway).
      if (res.status === 400) throw new Error(data.error);
      if (data.leadToken) {
        if (!leadTokenInput.value) window.SETrack('pickup_lead');
        leadTokenInput.value = data.leadToken;
        try { sessionStorage.setItem(LEAD_KEY, data.leadToken); } catch (err) { /* private mode */ }
      }
      showStep(2);
    } catch (err) {
      if (err.message) showAlert(formAlert, err.message, 'error');
      else showStep(2);
    } finally {
      stepNextBtn.disabled = false;
      stepNextBtn.innerHTML = 'Continue <span aria-hidden="true">→</span>';
    }
  });
  stepBackBtn.addEventListener('click', () => {
    formAlert.hidden = true;
    showStep(1);
  });
}

if (pickupForm) pickupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formAlert.hidden = true;

  const formData = new FormData(pickupForm);
  const payload = readStepOne(Object.fromEntries(formData.entries()), formData);
  if (!payload) {
    if (stepNextBtn) showStep(1, { focus: false });
    return;
  }

  if (!payload.businessType || !payload.name.trim()
    || !payload.building || !payload.street || !payload.pincode || !payload.city || !payload.state || !payload.area) {
    showAlert(formAlert, 'Please fill in all required fields marked with *.', 'error');
    return;
  }
  if (window.SEArea.missingOther(pickupForm)) {
    showAlert(formAlert, 'Please type the name of your area.', 'error');
    return;
  }
  if (!window.SEValidate.checkForm(pickupForm)) return;

  if (pickupMedia && pickupMedia.isPreparing()) {
    showAlert(formAlert, 'Your photos are still being prepared. Please try again in a moment.', 'error');
    return;
  }
  if (!window.SEValidate.rulesAccepted(pickupForm)) return;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting…';

  try {
    const files = pickupMedia ? pickupMedia.files() : [];
    const { ok, data } = await submitRequest('/api/pickup', payload, files, (pct) => {
      submitBtn.textContent = pct < 100 ? `Uploading… ${pct}%` : 'Submitting…';
    });
    if (!ok) throw new Error(data.error || 'Something went wrong');
    pickupForm.reset();
    leadTokenInput.value = '';
    try { sessionStorage.removeItem(LEAD_KEY); } catch (err) { /* private mode */ }
    if (stepNextBtn) showStep(1, { focus: false });
    showAlert(formAlert, data.message || 'Pickup request received! We will call you shortly.', 'success');
    window.SETrack('quote_request');
  } catch (err) {
    showAlert(formAlert, err.message || 'Something went wrong. Please call us directly.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Request Bulk Quote';
  }
});

/* ---------- Demolition quote form submission ---------- */
const demolitionForm = document.getElementById('demolitionForm');
const demolitionAlert = document.getElementById('demolitionAlert');
const demoSubmitBtn = document.getElementById('demoSubmitBtn');
const demolitionMedia = setupMediaPicker(demolitionForm);

if (demolitionForm) demolitionForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  demolitionAlert.hidden = true;

  const formData = new FormData(demolitionForm);
  const payload = Object.fromEntries(formData.entries());

  if (!payload.name || !payload.phone || !payload.buildingType
    || !payload.building || !payload.street || !payload.pincode || !payload.city || !payload.state || !payload.area) {
    showAlert(demolitionAlert, 'Please fill in all required fields marked with *.', 'error');
    return;
  }
  if (window.SEArea.missingOther(demolitionForm)) {
    showAlert(demolitionAlert, 'Please type the name of your area.', 'error');
    return;
  }
  if (!window.SEValidate.checkForm(demolitionForm)) return;

  if (demolitionMedia && demolitionMedia.isPreparing()) {
    showAlert(demolitionAlert, 'Your photos are still being prepared. Please try again in a moment.', 'error');
    return;
  }
  if (demolitionMedia && !demolitionMedia.requireOne()) return;
  if (!window.SEValidate.rulesAccepted(demolitionForm)) return;

  demoSubmitBtn.disabled = true;
  demoSubmitBtn.textContent = 'Submitting…';

  try {
    const files = demolitionMedia ? demolitionMedia.files() : [];
    const { ok, data } = await submitRequest('/api/demolition', payload, files, (pct) => {
      demoSubmitBtn.textContent = pct < 100 ? `Uploading… ${pct}%` : 'Submitting…';
    });
    if (!ok) throw new Error(data.error || 'Something went wrong');
    showAlert(demolitionAlert, data.message || 'Request received! We will call you shortly.', 'success');
    window.SETrack('demolition_request');
    demolitionForm.reset();
  } catch (err) {
    showAlert(demolitionAlert, err.message || 'Something went wrong. Please call us directly.', 'error');
  } finally {
    demoSubmitBtn.disabled = false;
    demoSubmitBtn.textContent = 'Request Site Visit & Quote';
  }
});
