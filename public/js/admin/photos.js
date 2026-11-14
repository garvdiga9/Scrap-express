/* ---------- Photos tab ---------- */
async function loadPhotos() {
  try {
    const { galleryCategories } = await loadContentOptions();
    const [gallery, logos] = await Promise.all(['gallery', 'logo'].map(async (kind) => {
      const res = await fetch(`/api/admin/images?kind=${kind}`);
      if (!res.ok) throw new Error();
      return res.json();
    }));
    const galleryList = document.getElementById('galleryList');
    galleryList.innerHTML = gallery.length ? '' : '<p class="table-empty">No photos yet. The home page section stays hidden until you add one.</p>';
    gallery.forEach((image) => {
      const category = (galleryCategories.find((c) => c.key === image.category) || {}).label || '';
      galleryList.appendChild(imageTile(image, `${category}: ${image.alt_text}`));
    });
    const logoList = document.getElementById('logoList');
    logoList.innerHTML = logos.length ? '' : '<p class="table-empty">No client logos yet.</p>';
    logos.forEach((image) => logoList.appendChild(imageTile(image, image.company_name)));
  } catch (err) {
    // Tried again when the tab is opened or something changes.
  }
}

document.getElementById('galleryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  showBoxAlert('galleryAlert', '', 'error');
  const file = document.getElementById('galleryFile').files[0];
  const altText = document.getElementById('galleryAlt').value.trim();
  if (!file || altText.length < 5) {
    showBoxAlert('galleryAlert', 'Please choose a photo and describe it in a few words.', 'error');
    return;
  }
  button.disabled = true;
  button.textContent = 'Uploading…';
  try {
    await uploadImage({
      kind: 'gallery',
      category: document.getElementById('galleryCategory').value,
      altText,
      caption: document.getElementById('galleryCaption').value.trim(),
    }, file, 1600);
    form.reset();
    showBoxAlert('galleryAlert', 'Added. It now shows on the home page.', 'success');
    loadPhotos();
  } catch (err) {
    showBoxAlert('galleryAlert', err.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Upload Photo';
  }
});

document.getElementById('logoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  showBoxAlert('logoAlert', '', 'error');
  const file = document.getElementById('logoFile').files[0];
  const companyName = document.getElementById('logoCompany').value.trim();
  if (!file || !companyName) {
    showBoxAlert('logoAlert', 'Please choose the logo and enter the company name.', 'error');
    return;
  }
  if (!document.getElementById('logoPermission').checked) {
    showBoxAlert('logoAlert', "Please tick the box to confirm you have the company's permission.", 'error');
    return;
  }
  button.disabled = true;
  button.textContent = 'Uploading…';
  try {
    await uploadImage({ kind: 'logo', companyName, permission: 'true' }, file, 600);
    form.reset();
    showBoxAlert('logoAlert', 'Added to the home page.', 'success');
    loadPhotos();
  } catch (err) {
    showBoxAlert('logoAlert', err.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Upload Logo';
  }
});
