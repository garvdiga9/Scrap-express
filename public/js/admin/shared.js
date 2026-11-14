// Admin: Photos tab (site photos, client logos) and Buy From Us tab (lots
// for recyclers and enquiries). Loaded after admin.js and uses its helpers
// (formatDateTime, telLink, sessionEnded).

let contentOptions = null;
async function loadContentOptions() {
  if (contentOptions) return contentOptions;
  const res = await fetch('/api/admin/options');
  if (!res.ok) throw new Error('Could not load the lists.');
  contentOptions = await res.json();
  const fill = (id, items, toOption) => {
    const select = document.getElementById(id);
    select.innerHTML = '';
    items.forEach((item) => select.append(toOption(item)));
  };
  fill('galleryCategory', contentOptions.galleryCategories, (c) => new Option(c.label, c.key));
  fill('lotMaterial', contentOptions.lotMaterials, (m) => new Option(m, m));
  fill('lotUnit', contentOptions.lotUnits, (u) => new Option(u, u));
  return contentOptions;
}

function showBoxAlert(id, message, type) {
  const box = document.getElementById(id);
  box.textContent = message;
  box.className = `form-alert ${type}`;
  box.hidden = !message;
}

/* ---------- Turning a photo into WebP before upload ---------- */
// Smaller and the same format for every photo; the server only takes WebP.
async function toWebp(file, maxSide) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Please choose a photo.');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    throw new Error("This browser can't open that photo. Please use a JPG or PNG (iPhone: set Camera → Formats → Most Compatible).");
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
  if (!blob || blob.type !== 'image/webp') {
    throw new Error("This browser can't make WebP images. Please use Chrome, Edge or Firefox to upload photos.");
  }
  return blob;
}

async function uploadImage(fields, file, maxSide) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  form.append('image', await toWebp(file, maxSide), 'photo.webp');
  const res = await fetch('/api/admin/images', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed.');
  return data;
}

function imageTile(image, label) {
  const tile = document.createElement('figure');
  tile.className = 'image-tile';
  const img = document.createElement('img');
  img.src = image.url;
  img.alt = image.alt_text;
  img.loading = 'lazy';
  const caption = document.createElement('figcaption');
  caption.textContent = label;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'icon-btn';
  remove.setAttribute('aria-label', `Delete ${image.alt_text}`);
  remove.title = 'Delete';
  remove.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
  remove.addEventListener('click', async () => {
    if (!confirm('Delete this photo from the site?')) return;
    await fetch(`/api/admin/images/${image.id}`, { method: 'DELETE' });
    tile.remove();
  });
  tile.append(img, caption, remove);
  return tile;
}
