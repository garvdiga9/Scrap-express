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

// Accept / Decline on a quote. The page reloads afterwards so the status
// badge and quote box show the answer.
document.querySelectorAll('.quote-actions').forEach((actions) => {
  const alertBox = actions.nextElementSibling;
  actions.addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-response]');
    if (!button) return;
    const { response } = button.dataset;
    if (response === 'decline' && !confirm('Decline this quote? You can call us any time for a revised one.')) return;

    alertBox.hidden = true;
    actions.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      const res = await fetch(`/api/customer/requests/${actions.dataset.requestId}/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        window.location.href = '/login?next=/account';
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Could not save your answer. Please try again.');
      window.location.reload();
    } catch (err) {
      alertBox.textContent = err.message;
      alertBox.hidden = false;
      actions.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  });
});

// push.js loads with the footer, after this script, so wait for the page.
document.addEventListener('DOMContentLoaded', () => {
  window.SEPush.mount(document.getElementById('pushCard'), '/api/customer', {
    on: "On — we'll alert this phone when your quote is ready and when your pickup is confirmed.",
    off: 'Get an alert on this phone the moment your quote is ready.',
  });
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/customer/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/';
});
