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
    rememberSavedDetails();
    showProfileAlert('Details saved. They\'ll fill in your next booking automatically.', 'success');
  } catch (err) {
    showProfileAlert(err.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Details';
  }
});

// Details as last saved, to tell them apart from something being typed.
function rememberSavedDetails() {
  [...profileForm.elements].forEach((field) => { field.dataset.saved = field.value; });
}
rememberSavedDetails();

// Re-read this page and swap in what changed: the request list, and details
// saved on another device (never over something being typed here).
async function refreshAccount() {
  const res = await fetch('/account');
  if (res.redirected) {
    window.location.href = '/login?next=/account';
    return;
  }
  if (!res.ok) throw new Error('Could not refresh your account.');
  const page = new DOMParser().parseFromString(await res.text(), 'text/html');

  document.querySelectorAll('[data-live-block]').forEach((block) => {
    const fresh = page.getElementById(block.id);
    if (fresh && fresh.innerHTML !== block.innerHTML) block.innerHTML = fresh.innerHTML;
  });

  const freshForm = page.getElementById('profileForm');
  [...profileForm.elements].forEach((field) => {
    const fresh = field.name && freshForm.elements[field.name];
    if (!fresh || field === document.activeElement || field.value !== field.dataset.saved) return;
    field.value = fresh.value;
    field.dataset.saved = fresh.value;
  });
}

// Accept / Decline on a quote. Listens on the list because its contents get
// replaced by refreshAccount.
document.getElementById('accountRequests').addEventListener('click', async (e) => {
  const button = e.target.closest('.quote-actions button[data-response]');
  if (!button) return;
  const actions = button.parentElement;
  const alertBox = actions.nextElementSibling;
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
    await refreshAccount().catch(() => window.location.reload());
  } catch (err) {
    alertBox.textContent = err.message;
    alertBox.hidden = false;
    actions.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  }
});

// push.js and live.js load with the footer, after this script, so wait for the page.
document.addEventListener('DOMContentLoaded', () => {
  window.SEPush.mount(document.getElementById('pushCard'), '/api/customer', {
    on: "On — we'll alert this phone when your quote is ready and when your pickup is confirmed.",
    off: 'Get an alert on this phone the moment your quote is ready.',
  });
  window.SELive.on('account', refreshAccount);
  window.SELive.start();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/customer/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/';
});
