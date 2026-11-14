// The admin dashboard runs inside the same installable app as the website.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

const loginScreen = document.getElementById('loginScreen');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('loginForm');
const loginAlert = document.getElementById('loginAlert');
const loginBtn = document.getElementById('loginBtn');
const welcomeUser = document.getElementById('welcomeUser');

function showLoginAlert(message) {
  loginAlert.textContent = message;
  loginAlert.className = 'form-alert error';
  loginAlert.hidden = false;
}

async function checkSession() {
  try {
    const res = await fetch('/api/admin/me');
    if (res.ok) {
      const data = await res.json();
      enterDashboard(data);
    }
  } catch (err) {
    /* not logged in, stay on login screen */
  }
}

let pushMounted = false;

// who: { username, name, role }. Managers don't see the owner's controls
// (Team tab, delete buttons, staff logins); the server refuses those anyway.
function enterDashboard(who) {
  loginScreen.hidden = true;
  const role = who.role || 'owner';
  document.body.dataset.role = role;
  dashboard.hidden = false;
  welcomeUser.textContent = `Signed in as ${who.name || who.username}${role === 'manager' ? ' (manager)' : ''}`;
  Promise.all([loadRequests(), loadDemolitionRequests(), loadCallbacks()]).then(openFromLink);
  loadLeads();
  loadCustomers();
  loadRates();
  loadTestimonials();
  loadSubscribers();
  window.SELive.start();
  if (!pushMounted) {
    pushMounted = true;
    window.SEPush.mount(document.getElementById('adminPushCard'), '/api/admin', {
      on: "On — this device gets an alert for every new request and quote answer.",
      off: 'Get an alert on this phone or computer whenever a new request comes in.',
    });
  }
}

function showTab(name) {
  document.querySelector(`.tab-btn[data-tab="${name}"]`).click();
}

// Notifications link to /admin.html#pickup-12, #demolition-4 or #callback-7: open that one.
function openFromLink() {
  // Enquiries about lots for sale (Buy From Us tab, public/js/admin-content.js).
  if (/^#lots-\d+$/.test(window.location.hash)) {
    showTab('lots');
    history.replaceState(null, '', window.location.pathname);
    return;
  }
  const match = /^#(pickup|demolition|callback)-(\d+)$/.exec(window.location.hash);
  if (!match) return;
  const id = Number(match[2]);
  if (match[1] === 'pickup') {
    const r = allRequests.find((x) => x.id === id);
    showTab('requests');
    if (r) openRequestDialog(r);
  } else {
    const isCallback = match[1] === 'callback';
    showTab(isCallback ? 'callbacks' : 'demolition');
    const row = (isCallback ? callbacksBody : demolitionBody).querySelector(`tr[data-id="${id}"]`);
    if (row) {
      row.classList.add('row-highlight');
      row.scrollIntoView({ block: 'center' });
    }
  }
  history.replaceState(null, '', window.location.pathname);
}
window.addEventListener('hashchange', openFromLink);

let loginInFlight = false;

async function submitLogin() {
  if (loginInFlight) return;
  loginInFlight = true;
  loginAlert.hidden = true;
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in…';

  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const remember = document.getElementById('rememberMe').checked;

  // Never leave the button stuck on "Signing in…": give up after 20s and say so.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, remember }),
      signal: controller.signal,
    });
    let data = {};
    try {
      data = await res.json();
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new Error(`The server sent an unexpected response (status ${res.status}). Please try again.`);
    }
    if (!res.ok) throw new Error(data.error || 'Login failed');
    enterDashboard(data);
  } catch (err) {
    showLoginAlert(err.name === 'AbortError'
      ? 'The server took too long to respond. Check your connection and try again.'
      : err.message);
  } finally {
    clearTimeout(timer);
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';
    loginInFlight = false;
  }
}

// Bound to both the form's submit (covers pressing Enter) and the button's
// click directly, since some environments don't reliably fire the native
// submit event from a programmatic or synthetic button click.
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitLogin();
});
loginBtn.addEventListener('click', (e) => {
  e.preventDefault();
  submitLogin();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  showLoginScreen();
  loginForm.reset();
});

function showLoginScreen() {
  window.SELive.stop();
  dashboard.hidden = true;
  loginScreen.hidden = false;
}

/* ---------- Tabs ---------- */
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    document.getElementById('adminPushCard').classList.toggle('off-tab', !['requests', 'demolition', 'callbacks'].includes(btn.dataset.tab));
  });
});
