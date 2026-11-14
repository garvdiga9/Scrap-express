/* ---------- Team tab (owner only): manager logins and the activity log ---------- */
const teamForm = document.getElementById('teamForm');

function resetTeamForm() {
  teamForm.reset();
  document.getElementById('teamEditId').value = '';
  document.getElementById('teamFormTitle').textContent = 'Add a manager';
  document.getElementById('teamSaveBtn').textContent = 'Add Manager';
  document.getElementById('teamPassLabel').textContent = 'Password (8+ characters)';
  document.getElementById('teamCancelEdit').hidden = true;
}

async function teamRequest(url, method, body) {
  const res = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not save.');
  return data;
}

function teamRow(u) {
  const tr = document.createElement('tr');
  tr.className = u.active ? '' : 'row-muted';
  const cells = [u.name, u.username, '', u.last_login_at ? formatDateTime(u.last_login_at) : 'Never'].map((value) => {
    const td = document.createElement('td');
    td.textContent = value;
    tr.appendChild(td);
    return td;
  });
  const badge = document.createElement('span');
  badge.className = `role-badge ${u.role}`;
  badge.textContent = u.role === 'owner' ? 'Owner' : 'Manager';
  cells[2].appendChild(badge);

  const statusTd = document.createElement('td');
  const actionTd = document.createElement('td');
  if (u.role === 'owner') {
    statusTd.textContent = 'Always on';
    actionTd.textContent = 'Set on the server';
  } else {
    const toggle = document.createElement('button');
    toggle.className = 'view-btn';
    toggle.textContent = u.active ? 'Active: switch off' : 'Off: switch on';
    toggle.title = u.active ? 'Signs them out and stops them signing in' : 'Lets them sign in again';
    toggle.addEventListener('click', async () => {
      try {
        await teamRequest(`/api/admin/team/${u.id}`, 'PUT', { name: u.name, username: u.username, active: !u.active });
        loadTeam();
      } catch (err) {
        alert(err.message);
      }
    });
    statusTd.appendChild(toggle);

    const edit = document.createElement('button');
    edit.className = 'view-btn';
    edit.textContent = 'Edit / new password';
    edit.addEventListener('click', () => {
      document.getElementById('teamEditId').value = u.id;
      document.getElementById('teamName').value = u.name;
      document.getElementById('teamUser').value = u.username;
      document.getElementById('teamPass').value = '';
      document.getElementById('teamFormTitle').textContent = `Edit: ${u.name}`;
      document.getElementById('teamSaveBtn').textContent = 'Save Changes';
      document.getElementById('teamPassLabel').textContent = 'New password (leave empty to keep)';
      document.getElementById('teamCancelEdit').hidden = false;
      teamForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const remove = document.createElement('button');
    remove.className = 'icon-btn';
    remove.title = 'Delete login';
    remove.setAttribute('aria-label', `Delete ${u.name}`);
    remove.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
    remove.addEventListener('click', async () => {
      if (!confirm(`Delete the login for ${u.name}? They are signed out at once. What they did stays in the activity log.`)) return;
      try {
        await teamRequest(`/api/admin/team/${u.id}`, 'DELETE');
      } catch (err) {
        alert(err.message);
      }
      loadTeam();
    });
    actionTd.append(edit, ' ', remove);
  }
  tr.append(statusTd, actionTd);
  return tr;
}

const activityWho = document.getElementById('activityWho');
const activityArea = document.getElementById('activityArea');

async function loadActivity() {
  const body = document.getElementById('activityBody');
  try {
    const query = new URLSearchParams();
    if (activityWho.value) query.set('adminId', activityWho.value);
    if (activityArea.value) query.set('area', activityArea.value);
    const res = await fetch(`/api/admin/activity?${query}`);
    if (!res.ok) return;
    const list = await res.json();
    body.innerHTML = list.length ? '' : '<tr><td colspan="4" class="table-empty">Nothing yet.</td></tr>';
    list.forEach((a) => {
      const tr = document.createElement('tr');
      [formatDateTime(a.created_at), a.admin_name, a.action, a.detail || ''].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  } catch (err) {
    // Tried again when the tab is opened.
  }
}

async function loadTeam() {
  if (document.body.dataset.role !== 'owner') return;
  try {
    const res = await fetch('/api/admin/team');
    if (!res.ok) return;
    const list = await res.json();
    const body = document.getElementById('teamBody');
    body.innerHTML = '';
    list.forEach((u) => body.appendChild(teamRow(u)));
    // The "Who" filter lists everyone, keeping the current choice.
    const chosen = activityWho.value;
    activityWho.innerHTML = '<option value="">Everyone</option>';
    list.forEach((u) => activityWho.add(new Option(u.name, u.id)));
    activityWho.value = chosen;
  } catch (err) {
    // Tried again when the tab is opened.
  }
  loadActivity();
}

teamForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showBoxAlert('teamFormAlert', '', 'error');
  const id = document.getElementById('teamEditId').value;
  try {
    await teamRequest(id ? `/api/admin/team/${id}` : '/api/admin/team', id ? 'PUT' : 'POST', {
      name: document.getElementById('teamName').value,
      username: document.getElementById('teamUser').value,
      password: document.getElementById('teamPass').value,
      active: true,
    });
    resetTeamForm();
    showBoxAlert('teamFormAlert', id ? 'Saved. A new password signs them out of their devices.' : `Added. They sign in at ${window.location.origin}/admin.html with this username and password.`, 'success');
    loadTeam();
  } catch (err) {
    showBoxAlert('teamFormAlert', err.message, 'error');
  }
});
document.getElementById('teamCancelEdit').addEventListener('click', resetTeamForm);
activityWho.addEventListener('change', loadActivity);
activityArea.addEventListener('change', loadActivity);
document.querySelector('.tab-btn[data-tab="team"]').addEventListener('click', loadTeam);

// Backups: when the last one was downloaded.
async function loadBackupStatus() {
  const line = document.getElementById('backupLast');
  try {
    const res = await fetch('/api/admin/backup/status');
    if (!res.ok) return;
    const { last } = await res.json();
    line.textContent = last
      ? `Last backup: ${formatDateTime(last.at)}${last.withFiles ? ` (with ${last.files} files)` : ' (data only)'}`
      : 'No backup downloaded yet.';
  } catch (err) {
    // Shown next time the tab opens.
  }
}
document.querySelector('.tab-btn[data-tab="team"]').addEventListener('click', loadBackupStatus);
['backupData', 'backupFiles'].forEach((id) => document.getElementById(id).addEventListener('click', () => {
  // The download takes a moment to start; refresh the line afterwards.
  setTimeout(loadBackupStatus, 4000);
  setTimeout(loadTodo, 4000);
}));
