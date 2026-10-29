const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

/* ---------- Back to top ---------- */
const backToTop = document.getElementById('backToTop');
if (backToTop) {
  backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
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
document.querySelectorAll(
  '.rates-grid, .buy-grid, .impact-grid, .steps-grid, .why-grid, .reviews-grid, .areas-grid, .book-form, .book-head, .hero-copy'
).forEach((el) => el.classList.add('reveal'));

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
document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));

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

  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting…';

  try {
    const res = await fetch('/api/pickup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
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

if (demolitionForm) demolitionForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  demolitionAlert.hidden = true;

  const formData = new FormData(demolitionForm);
  const payload = Object.fromEntries(formData.entries());

  if (!payload.name || !payload.phone || !payload.buildingType || !payload.location) {
    showAlert(demolitionAlert, 'Please fill in all required fields marked with *.', 'error');
    return;
  }

  demoSubmitBtn.disabled = true;
  demoSubmitBtn.textContent = 'Submitting…';

  try {
    const res = await fetch('/api/demolition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    showAlert(demolitionAlert, data.message || 'Request received! We will call you shortly.', 'success');
    demolitionForm.reset();
  } catch (err) {
    showAlert(demolitionAlert, err.message || 'Something went wrong. Please call us directly.', 'error');
  } finally {
    demoSubmitBtn.disabled = false;
    demoSubmitBtn.textContent = 'Request Site Visit & Quote';
  }
});
