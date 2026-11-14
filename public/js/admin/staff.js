/* ---------- Staff tab ---------- */
const staffForm = document.getElementById('staffForm');
let staffList = [];
document.getElementById('staffAppAddress').textContent = `${window.location.origin}/staff.html`;

function resetStaffForm() {
  staffForm.reset();
  document.getElementById('staffEditId').value = '';
  document.getElementById('staffFormTitle').textContent = 'Add a staff member';
  document.getElementById('staffSaveBtn').textContent = 'Add Staff Member';
  document.getElementById('staffPassLabel').textContent = 'Password (6+ characters)';
  document.getElementById('staffCancelEdit').hidden = true;
}

async function saveStaffMember(id, body) {
  const res = await fetch(id ? `/api/admin/staff/${id}` : '/api/admin/staff', {
    method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not save the staff member.');
  return data;
}

function staffRow(s) {
  const tr = document.createElement('tr');
  tr.className = s.active ? '' : 'row-muted';
  [s.name, s.username, '', s.open_pickups, s.done_pickups, s.last_login_at ? formatDateTime(s.last_login_at) : 'Never'].forEach((value) => {
    const td = document.createElement('td');
    td.textContent = value;
    tr.appendChild(td);
  });
  if (s.phone) tr.children[2].appendChild(telLink(s.phone));
  else tr.children[2].textContent = '-';

  const statusTd = document.createElement('td');
  const toggle = document.createElement('button');
  toggle.className = 'view-btn owner-only';
  toggle.textContent = s.active ? 'Active: switch off' : 'Off: switch on';
  toggle.title = s.active ? 'Stops this person signing in' : 'Lets this person sign in again';
  toggle.addEventListener('click', async () => {
    try {
      await saveStaffMember(s.id, { name: s.name, username: s.username, phone: s.phone, active: !s.active });
      loadStaff();
    } catch (err) {
      alert(err.message);
    }
  });
  statusTd.appendChild(toggle);

  const actionTd = document.createElement('td');
  const edit = document.createElement('button');
  edit.className = 'view-btn owner-only';
  edit.textContent = 'Edit / new password';
  edit.addEventListener('click', () => {
    document.getElementById('staffEditId').value = s.id;
    document.getElementById('staffName').value = s.name;
    document.getElementById('staffPhone').value = s.phone || '';
    document.getElementById('staffUser').value = s.username;
    document.getElementById('staffPass').value = '';
    document.getElementById('staffFormTitle').textContent = `Edit: ${s.name}`;
    document.getElementById('staffSaveBtn').textContent = 'Save Changes';
    document.getElementById('staffPassLabel').textContent = 'New password (leave empty to keep)';
    document.getElementById('staffCancelEdit').hidden = false;
    staffForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const remove = document.createElement('button');
  remove.className = 'icon-btn';
  remove.title = 'Delete staff member';
  remove.setAttribute('aria-label', `Delete ${s.name}`);
  remove.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
  remove.addEventListener('click', async () => {
    if (!confirm(`Delete ${s.name}? Their pickups stay, without a name. To only stop them signing in, switch them off instead.`)) return;
    await fetch(`/api/admin/staff/${s.id}`, { method: 'DELETE' });
    loadStaff();
  });
  actionTd.append(edit, ' ', remove);
  tr.append(statusTd, actionTd);
  return tr;
}

async function loadStaff() {
  try {
    const res = await fetch('/api/admin/staff');
    if (!res.ok) return;
    staffList = await res.json();
    const body = document.getElementById('staffBody');
    body.innerHTML = staffList.length ? '' : '<tr><td colspan="8" class="table-empty">No staff yet. Add the first one above.</td></tr>';
    staffList.forEach((s) => body.appendChild(staffRow(s)));
  } catch (err) {
    // Tried again when the tab is opened.
  }
}

staffForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showBoxAlert('staffFormAlert', '', 'error');
  const id = document.getElementById('staffEditId').value;
  try {
    await saveStaffMember(id, {
      name: document.getElementById('staffName').value,
      phone: document.getElementById('staffPhone').value.trim(),
      username: document.getElementById('staffUser').value,
      password: document.getElementById('staffPass').value,
    });
    resetStaffForm();
    showBoxAlert('staffFormAlert', id ? 'Saved.' : 'Added. Give them the username and password, and the Staff app address above.', 'success');
    loadStaff();
  } catch (err) {
    showBoxAlert('staffFormAlert', err.message, 'error');
  }
});
document.getElementById('staffCancelEdit').addEventListener('click', resetStaffForm);
document.querySelector('.tab-btn[data-tab="staff"]').addEventListener('click', loadStaff);
window.SELive.on('requests', () => { if (!dashboard.hidden) loadStaff(); });
new MutationObserver(() => { if (!dashboard.hidden) loadStaff(); }).observe(dashboard, { attributes: true, attributeFilter: ['hidden'] });
