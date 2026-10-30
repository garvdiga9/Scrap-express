const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

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
if (navToggle && mainNav) {
  navToggle.addEventListener('click', () => {
    const isOpen = mainNav.classList.toggle('open');
    navToggle.innerHTML = isOpen
      ? '<svg class="icon"><use href="#icon-close"/></svg>'
      : '<svg class="icon"><use href="#icon-menu"/></svg>';
  });
  mainNav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      mainNav.classList.remove('open');
      navToggle.innerHTML = '<svg class="icon"><use href="#icon-menu"/></svg>';
    });
  });
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
document.querySelectorAll('.book-form, .book-head').forEach((el) => el.classList.add('reveal'));

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

/* ---------- Hero stat count-up ---------- */
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
const statObserver = new IntersectionObserver(
  (entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.querySelectorAll('.stat-num, .impact-num').forEach((el) => {
          animateCount(el, Number(el.dataset.count));
        });
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.4 }
);
const heroStats = document.getElementById('heroStats');
if (heroStats) statObserver.observe(heroStats);
const impactStats = document.getElementById('impactStats');
if (impactStats) statObserver.observe(impactStats);

/* ---------- Icon + material-family colour lookup for rate categories ---------- */
const RATE_ICON_FAMILY = {
  newspaper: 'paper',
  book: 'paper',
  box: 'paper',
  hardboard: 'paper',
  pipe: 'plastic',
  granules: 'plastic',
  'plastic-roll': 'plastic',
  bottle: 'plastic',
  'plastic-chunks': 'plastic',
  rebar: 'metal',
  corrugated: 'metal',
  'pipe-fitting': 'metal',
  'steel-plate': 'metal',
  'copper-pipe': 'copper',
  'brass-pot': 'brass',
  'aluminium-pot': 'aluminium',
  beam: 'aluminium',
  gear: 'aluminium',
  wire: 'wire',
  'wire-appliance': 'wire',
  mesh: 'wire',
  'thick-cable': 'wire',
  'glass-bottle': 'glass',
  battery: 'battery',
  // legacy broad keys, kept for backward compatibility
  paper: 'paper',
  plastic: 'plastic',
  metal: 'metal',
  glass: 'glass',
  ewaste: 'metal',
};

const FAMILY_COLORS = {
  paper: { bg: '#fef3c7', fg: '#b45309' },
  plastic: { bg: '#dbeafe', fg: '#1d4ed8' },
  metal: { bg: '#e2e8f0', fg: '#334155' },
  copper: { bg: '#ffedd5', fg: '#c2410c' },
  brass: { bg: '#fef9c3', fg: '#a16207' },
  aluminium: { bg: '#f1f5f9', fg: '#475569' },
  wire: { bg: '#e0e7ff', fg: '#4338ca' },
  glass: { bg: '#ccfbf1', fg: '#0f766e' },
  battery: { bg: '#fee2e2', fg: '#b91c1c' },
};

function iconForCategory(icon) {
  return `icon-${icon}`;
}

function familyColors(icon) {
  const family = RATE_ICON_FAMILY[icon] || 'metal';
  return FAMILY_COLORS[family] || FAMILY_COLORS.metal;
}

/* ---------- Load live rates ---------- */
async function loadRates() {
  const grid = document.getElementById('ratesGrid');
  if (!grid) return;
  try {
    const res = await fetch('/api/rates');
    if (!res.ok) throw new Error('Failed to load rates');
    const rates = await res.json();
    if (!rates.length) {
      grid.innerHTML = '<p class="rates-loading">Rates coming soon. Please call us for current pricing.</p>';
      return;
    }
    grid.innerHTML = '';
    // Home shows a short teaser; the rates page lists everything.
    const limit = Number(grid.dataset.limit) || rates.length;
    rates.slice(0, limit).forEach((rate) => {
      const card = document.createElement('div');
      card.className = 'rate-card';
      const iconId = iconForCategory(rate.icon);
      const colors = familyColors(rate.icon);
      // Photo when one has been added for this item, tinted icon otherwise.
      const iconMedia = `<div class="rate-media rate-media-icon" style="background:${colors.bg};color:${colors.fg}"><svg class="icon"><use href="#${iconId}"/></svg></div>`;
      card.innerHTML = `
        ${iconMedia}
        <h3></h3>
        <div class="rate-price">₹<span class="price-val"></span> <span>/ ${escapeHtml(rate.unit)}</span></div>
      `;
      if (rate.image) {
        const img = document.createElement('img');
        img.className = 'rate-media rate-photo';
        img.src = rate.image;
        img.alt = rate.name;
        img.loading = 'lazy';
        // If the file is missing or corrupt, drop back to the icon tile.
        img.addEventListener('error', () => img.remove(), { once: true });
        img.addEventListener('load', () => {
          const placeholder = card.querySelector('.rate-media-icon');
          if (placeholder) placeholder.remove();
        }, { once: true });
        card.insertBefore(img, card.firstChild);
      }
      card.querySelector('h3').textContent = rate.name;
      card.querySelector('.price-val').textContent = Number(rate.price).toLocaleString('en-IN');
      grid.appendChild(card);
    });
  } catch (err) {
    grid.innerHTML = '<p class="rates-loading">Could not load live rates right now. Please call us for current pricing.</p>';
  }
}
loadRates();

/* ---------- Load testimonials ---------- */
function starRow(rating) {
  const wrap = document.createElement('div');
  wrap.className = 'review-stars';
  for (let i = 0; i < 5; i++) {
    wrap.innerHTML += `<svg class="icon" style="opacity:${i < rating ? 1 : 0.25}"><use href="#icon-star"/></svg>`;
  }
  return wrap;
}

const AVATAR_COLORS = ['#f59e0b', '#16a34a', '#2563eb', '#db2777', '#7c3aed', '#0d9488', '#dc2626', '#ca8a04'];

function initialsFor(name) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ? parts[0][0] : '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function colorForName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

async function loadTestimonials() {
  const grid = document.getElementById('reviewsGrid');
  if (!grid) return;
  try {
    const res = await fetch('/api/testimonials');
    if (!res.ok) throw new Error('Failed to load reviews');
    const reviews = await res.json();
    if (!reviews.length) {
      // No client reviews yet: hide the whole section rather than show an empty one.
      const section = document.getElementById('reviews');
      if (section) section.hidden = true;
      return;
    }
    grid.innerHTML = '';
    reviews.forEach((review) => {
      const card = document.createElement('div');
      card.className = 'review-card';

      const quoteMark = document.createElement('svg');
      quoteMark.className = 'icon quote-mark';
      quoteMark.innerHTML = '<use href="#icon-quote"/>';

      const stars = starRow(review.rating);

      const msg = document.createElement('p');
      msg.className = 'review-msg';
      msg.textContent = review.message;

      const footer = document.createElement('div');
      footer.className = 'review-footer';

      const avatar = document.createElement('div');
      avatar.className = 'review-avatar';
      avatar.style.background = colorForName(review.customer_name);
      avatar.textContent = initialsFor(review.customer_name);

      const who = document.createElement('div');
      const author = document.createElement('p');
      author.className = 'review-author';
      author.textContent = review.customer_name;
      const area = document.createElement('p');
      area.className = 'review-area';
      area.textContent = review.area || '';
      who.append(author, area);

      footer.append(avatar, who);
      card.append(quoteMark, stars, msg, footer);
      grid.appendChild(card);
    });
  } catch (err) {
    grid.innerHTML = '<p class="rates-loading">Could not load reviews right now.</p>';
  }
}
loadTestimonials();

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

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

if (pickupForm) pickupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formAlert.hidden = true;

  const formData = new FormData(pickupForm);
  const payload = Object.fromEntries(formData.entries());
  // fromEntries keeps only the last ticked checkbox, so collect them all.
  payload.scrapTypes = formData.getAll('scrapTypes');

  if (!payload.companyName || !payload.businessType || !payload.name || !payload.phone
    || !payload.address) {
    showAlert(formAlert, 'Please fill in all required fields marked with *.', 'error');
    return;
  }
  if (!payload.scrapTypes.length) {
    showAlert(formAlert, 'Please tick at least one scrap type.', 'error');
    return;
  }
  if (payload.scrapTypes.includes('Other')) {
    payload.otherScrapType = (payload.otherScrapType || '').trim();
    if (!payload.otherScrapType) {
      showAlert(formAlert, 'Please describe the other scrap type.', 'error');
      document.getElementById('otherScrapType').focus();
      return;
    }
  } else {
    delete payload.otherScrapType;
  }
  const quantityInput = document.getElementById('quantity');
  const minKg = Number(quantityInput.dataset.minKg);
  const quantityKg = Number(payload.quantity) * (payload.quantityUnit === 'tonnes' ? 1000 : 1);
  if (!payload.quantity || !(quantityKg > 0)) {
    showAlert(formAlert, 'Please enter the approximate total quantity.', 'error');
    quantityInput.focus();
    return;
  }
  if (quantityKg < minKg) {
    showAlert(formAlert, `We handle bulk pickups of ${minKg} kg or more. Please check the quantity.`, 'error');
    quantityInput.focus();
    return;
  }

  if (pickupMedia && pickupMedia.isPreparing()) {
    showAlert(formAlert, 'Your photos are still being prepared. Please try again in a moment.', 'error');
    return;
  }
  if (pickupMedia && !pickupMedia.requireOne()) return;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting…';

  try {
    const files = pickupMedia ? pickupMedia.files() : [];
    const { ok, data } = await submitRequest('/api/pickup', payload, files, (pct) => {
      submitBtn.textContent = pct < 100 ? `Uploading… ${pct}%` : 'Submitting…';
    });
    if (!ok) throw new Error(data.error || 'Something went wrong');
    showAlert(formAlert, data.message || 'Pickup request received! We will call you shortly.', 'success');
    pickupForm.reset();
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

  if (!payload.name || !payload.phone || !payload.buildingType || !payload.location) {
    showAlert(demolitionAlert, 'Please fill in all required fields marked with *.', 'error');
    return;
  }

  if (demolitionMedia && demolitionMedia.isPreparing()) {
    showAlert(demolitionAlert, 'Your photos are still being prepared. Please try again in a moment.', 'error');
    return;
  }
  if (demolitionMedia && !demolitionMedia.requireOne()) return;

  demoSubmitBtn.disabled = true;
  demoSubmitBtn.textContent = 'Submitting…';

  try {
    const files = demolitionMedia ? demolitionMedia.files() : [];
    const { ok, data } = await submitRequest('/api/demolition', payload, files, (pct) => {
      demoSubmitBtn.textContent = pct < 100 ? `Uploading… ${pct}%` : 'Submitting…';
    });
    if (!ok) throw new Error(data.error || 'Something went wrong');
    showAlert(demolitionAlert, data.message || 'Request received! We will call you shortly.', 'success');
    demolitionForm.reset();
  } catch (err) {
    showAlert(demolitionAlert, err.message || 'Something went wrong. Please call us directly.', 'error');
  } finally {
    demoSubmitBtn.disabled = false;
    demoSubmitBtn.textContent = 'Request Site Visit & Quote';
  }
});
