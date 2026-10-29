const profileForm = document.getElementById('profileForm');
const profileAlert = document.getElementById('profileAlert');
const saveBtn = document.getElementById('saveProfileBtn');

function showProfileAlert(message, type) {
  profileAlert.textContent = message;
  profileAlert.className = `form-alert ${type}`;
  profileAlert.hidden = false;
}

profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  profileAlert.hidden = true;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  try {
    const res = await fetch('/api/customer/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(profileForm).entries())),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      window.location.href = '/login?next=/account';
      return;
    }
    if (!res.ok) throw new Error(data.error || 'Could not save your details.');
    document.getElementById('pGstin').value = data.gstin || '';
    showProfileAlert('Details saved. They\'ll fill in your next booking automatically.', 'success');
  } catch (err) {
    showProfileAlert(err.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Details';
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/customer/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/';
});
