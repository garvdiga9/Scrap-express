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
  if (!window.SEValidate.checkForm(profileForm)) return;
  if (window.SEArea.missingOther(profileForm)) {
    showProfileAlert('Please type the name of your area.', 'error');
    return;
  }
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
    if (field.value === fresh.value) return;
    field.value = fresh.value;
    field.dataset.saved = fresh.value;
    // Lets the Area list show or hide its "type your area" box.
    if (field.tagName === 'SELECT') field.dispatchEvent(new Event('input'));
  });
}

// The footer's scripts load after this one, so wait for the page.
document.addEventListener('DOMContentLoaded', () => {
  window.SEQuote.wire(document.getElementById('accountRequests'), refreshAccount);
  window.SEPush.mount(document.getElementById('pushCard'), '/api/customer', {
    on: "On. We'll alert this phone when your quote is ready, when to choose a time, and when our team is on the way.",
    off: "Don't miss your quote or pickup time: get an alert on this phone when your quote is ready, when to choose a time, and when our team is on the way.",
  });
  window.SELive.on('account', refreshAccount);
  window.SELive.start();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/customer/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/';
});

/* ---------- Repeat pickups ---------- */
// Listens on the page: the request list is redrawn by live updates.
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('.repeat-form');
  if (!form) return;
  e.preventDefault();
  const alertBox = form.querySelector('.form-alert');
  const button = form.querySelector('button[type="submit"]');
  alertBox.hidden = true;
  if (!form.elements.acceptTerms.checked) {
    alertBox.textContent = 'Please tick the box to accept the Pickup Rules.';
    alertBox.hidden = false;
    return;
  }
  button.disabled = true;
  try {
    const res = await fetch('/api/customer/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceRequestId: form.dataset.source,
        frequency: form.elements.frequency.value,
        startDate: form.elements.startDate.value,
        acceptTerms: true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      window.location.href = '/login?next=/account';
      return;
    }
    if (!res.ok) throw new Error(data.error || 'Could not set up the repeat pickup.');
    window.location.reload(); // shows it under Repeat Pickups
  } catch (err) {
    alertBox.textContent = err.message;
    alertBox.hidden = false;
    button.disabled = false;
  }
});

document.addEventListener('click', async (e) => {
  const toggle = e.target.closest('[data-schedule-toggle]');
  const remove = e.target.closest('[data-schedule-delete]');
  if (!toggle && !remove) return;
  const item = e.target.closest('[data-schedule]');
  const id = item.dataset.schedule;
  if (remove && !confirm('Delete this repeat pickup? Requests already created stay as they are.')) return;
  const res = await fetch(`/api/customer/schedules/${id}`, remove ? { method: 'DELETE' } : {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: toggle.dataset.scheduleToggle === 'resume' }),
  });
  if (res.ok) window.location.reload();
  else alert('Something went wrong. Please try again.');
});
