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

// Fill the review form's "type of business" list and area suggestions once.
let reviewOptionsLoaded = false;
async function loadReviewOptions() {
  if (reviewOptionsLoaded) return;
  try {
    const res = await fetch('/api/admin/options');
    if (!res.ok) return;
    const { businessTypes, areas } = await res.json();
    const typeSelect = document.getElementById('newTestType');
    businessTypes.forEach((type) => typeSelect.append(new Option(type, type)));
    const areaList = document.getElementById('areaOptions');
    areas.forEach((area) => areaList.append(new Option(area)));
    reviewOptionsLoaded = true;
  } catch (err) {
    // Tried again the next time reviews load.
  }
}

async function loadTestimonials(background = false) {
  loadReviewOptions();
  loadStats();
  if (!background) testimonialList.innerHTML = '<p class="table-empty">Loading reviews…</p>';
  try {
    const res = await fetch('/api/testimonials');
    if (!res.ok) throw new Error();
    const items = await res.json();
    if (!items.length) {
      testimonialList.innerHTML = '<p class="table-empty">No reviews yet.</p>';
      return;
    }
    testimonialList.innerHTML = '';
    items.forEach((t) => testimonialList.appendChild(buildTestimonialCard(t)));
  } catch (err) {
    if (background) return;
    testimonialList.innerHTML = '<p class="table-empty">Failed to load reviews.</p>';
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
  area.textContent = [t.company_type || 'Type of business not set', t.area].filter(Boolean).join(' · ');
  card.appendChild(area);

  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn';
  delBtn.title = 'Delete review';
  delBtn.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
  delBtn.addEventListener('click', async () => {
    if (!confirm('Delete this review?')) return;
    await fetch(`/api/admin/testimonials/${t.id}`, { method: 'DELETE' });
    card.remove();
  });
  card.appendChild(delBtn);

  return card;
}

addTestimonialForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const customerName = document.getElementById('newTestName').value.trim();
  const companyType = document.getElementById('newTestType').value;
  const area = document.getElementById('newTestArea').value.trim();
  const rating = document.getElementById('newTestRating').value;
  const message = document.getElementById('newTestMessage').value.trim();
  if (!customerName || !companyType || !message) {
    alert('Please fill in the name, type of business and review.');
    return;
  }

  try {
    const res = await fetch('/api/admin/testimonials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName, companyType, area, rating, message,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add review');
    await loadTestimonials(true);
    addTestimonialForm.reset();
  } catch (err) {
    alert(err.message);
  }
});

/* ---------- Home page numbers ---------- */
const statsForm = document.getElementById('statsForm');
const statsAlert = document.getElementById('statsAlert');

function showStatsUpdated(stats) {
  document.getElementById('statsUpdated').textContent = stats.updatedAt
    ? `Last saved ${formatDate(stats.updatedAt)}` : 'Not saved yet: the site shows the starting figures.';
}

async function loadStats() {
  try {
    const res = await fetch('/api/admin/stats');
    if (!res.ok) return;
    const { stats, fields } = await res.json();
    const box = document.getElementById('statsFields');
    // Don't overwrite something being typed.
    if (box.contains(document.activeElement)) return;
    box.innerHTML = '';
    Object.entries(fields).forEach(([key, { label }]) => {
      const group = document.createElement('label');
      group.className = 'stats-field';
      const text = document.createElement('span');
      text.textContent = label;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.name = key;
      input.required = true;
      input.value = stats[key];
      group.append(text, input);
      box.appendChild(group);
    });
    showStatsUpdated(stats);
  } catch (err) {
    // Shown again on the next refresh.
  }
}

statsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  statsAlert.hidden = true;
  const body = Object.fromEntries([...new FormData(statsForm).entries()].map(([k, v]) => [k, Number(v)]));
  try {
    const res = await fetch('/api/admin/stats', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save the numbers.');
    showStatsUpdated(data.stats);
    statsAlert.textContent = `Saved. The home page now shows ${data.stats.co2Tonnes.toLocaleString('en-IN')} tonnes CO₂ avoided and ${data.stats.treesSaved.toLocaleString('en-IN')} trees saved.`;
    statsAlert.className = 'form-alert success';
    statsAlert.hidden = false;
  } catch (err) {
    statsAlert.textContent = err.message;
    statsAlert.className = 'form-alert error';
    statsAlert.hidden = false;
  }
});
