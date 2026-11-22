/* ---------- Workers: daily attendance and month-end pay ---------- */
const workerDept = document.getElementById('workerDept');
const attendanceDate = document.getElementById('attendanceDate');
const attendanceList = document.getElementById('attendanceList');
const payrollMonth = document.getElementById('payrollMonth');
const workerForm = document.getElementById('workerForm');
const WORKER_MARKS = [['present', 'P'], ['half', '½'], ['absent', 'A'], ['leave', 'L'], ['off', 'Off']];
let workerMeta = null; // { departments, wageTypes, statuses, today }
let allWorkers = [];
let attendance = { day: null, workers: [] };
const changedMarks = new Map(); // workerId → status (unsaved)

const inrW = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const isOwner = () => document.body.dataset.role !== 'manager';
const deptShown = (d) => !workerDept.value || workerDept.value === d;
function workerAlert(id, message, ok = false) {
  const box = document.getElementById(id);
  box.textContent = message;
  box.className = `form-alert ${ok ? 'success' : 'error'}`;
  box.hidden = !message;
}
const fmtDay = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

async function getJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

// ---- the worker list and form ----

async function loadWorkers() {
  try {
    const data = await getJson('/api/admin/workers');
    if (!workerMeta) {
      workerMeta = data;
      data.departments.forEach((d) => {
        workerDept.append(new Option(d, d));
        document.getElementById('workerDeptField').append(new Option(d, d));
      });
      attendanceDate.value = data.today;
      attendanceDate.max = data.today;
      payrollMonth.value = data.today.slice(0, 7);
    }
    allWorkers = data.workers;
    renderWorkers();
  } catch (err) {
    document.getElementById('workersBody').innerHTML = '<tr><td colspan="7" class="table-empty">Failed to load workers.</td></tr>';
  }
}

function renderWorkers() {
  const body = document.getElementById('workersBody');
  const shown = allWorkers.filter((w) => deptShown(w.department));
  if (!shown.length) {
    body.innerHTML = `<tr><td colspan="7" class="table-empty">${allWorkers.length ? 'No workers in this department.' : 'No workers yet. Add the first one above.'}</td></tr>`;
    return;
  }
  body.replaceChildren(...shown.map((w) => {
    const tr = document.createElement('tr');
    if (!w.active) tr.className = 'row-muted';
    const cells = [
      `${w.name}${w.active ? '' : ' (left)'}`, w.department, w.designation || '-', w.phone || '-',
      w.wage != null ? `${inrW(w.wage)} ${w.wageType === 'monthly' ? '/ month' : '/ day'}` : '',
      w.joinedOn ? fmtDay(w.joinedOn) : '-',
    ];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (i === 4) td.className = 'owner-only';
      tr.appendChild(td);
    });
    const action = document.createElement('td');
    if (isOwner()) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'view-btn';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => editWorker(w));
      action.appendChild(edit);
    }
    tr.appendChild(action);
    return tr;
  }));
}

function editWorker(w) {
  const el = workerForm.elements;
  document.getElementById('workerId').value = w ? w.id : '';
  el.name.value = w ? w.name : '';
  el.phone.value = w ? w.phone || '' : '';
  el.department.value = w ? w.department : workerMeta.departments[0];
  el.designation.value = w ? w.designation || '' : '';
  el.wageType.value = w ? w.wageType : 'daily';
  el.wage.value = w ? w.wage : '';
  el.joinedOn.value = w ? w.joinedOn || '' : '';
  el.notes.value = w ? w.notes || '' : '';
  el.active.checked = w ? w.active : true;
  document.getElementById('workerFormTitle').textContent = w ? `Edit ${w.name}` : 'Add a worker';
  document.getElementById('workerSaveBtn').textContent = w ? 'Save Changes' : 'Add Worker';
  document.getElementById('workerCancel').hidden = !w;
  workerAlert('workerAlert', '');
  if (w) workerForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

workerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const el = workerForm.elements;
  const id = document.getElementById('workerId').value;
  const body = {
    name: el.name.value, phone: el.phone.value, department: el.department.value, designation: el.designation.value,
    wageType: el.wageType.value, wage: el.wage.value, joinedOn: el.joinedOn.value, notes: el.notes.value, active: el.active.checked,
  };
  try {
    await getJson(id ? `/api/admin/workers/${id}` : '/api/admin/workers', {
      method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    editWorker(null);
    workerAlert('workerAlert', id ? 'Saved.' : 'Worker added.', true);
    await Promise.all([loadWorkers(), loadAttendance(), loadPayroll()]);
  } catch (err) {
    workerAlert('workerAlert', err.message);
  }
});
document.getElementById('workerCancel').addEventListener('click', () => editWorker(null));

// ---- daily attendance ----

async function loadAttendance() {
  if (!attendanceDate.value) return;
  changedMarks.clear();
  workerAlert('attendanceAlert', '');
  try {
    attendance = await getJson(`/api/admin/attendance?date=${attendanceDate.value}`);
    renderAttendance();
  } catch (err) {
    attendanceList.innerHTML = '<p class="table-empty">Failed to load attendance.</p>';
  }
}

function renderAttendance() {
  const shown = attendance.workers.filter((w) => deptShown(w.department));
  if (!shown.length) {
    attendanceList.innerHTML = '<p class="table-empty">No workers to mark for this day.</p>';
    return;
  }
  const groups = [];
  shown.forEach((w) => {
    let g = groups.find((x) => x.name === w.department);
    if (!g) groups.push(g = { name: w.department, workers: [] });
    g.workers.push(w);
  });
  attendanceList.replaceChildren(...groups.map((g) => {
    const box = document.createElement('div');
    box.className = 'attendance-group';
    const marked = g.workers.filter((w) => (changedMarks.get(w.id) ?? w.status)).length;
    const title = document.createElement('h4');
    title.textContent = `${g.name} · ${marked}/${g.workers.length} marked`;
    box.appendChild(title);
    g.workers.forEach((w) => {
      const row = document.createElement('div');
      row.className = 'attendance-row';
      const who = document.createElement('div');
      who.className = 'attendance-who';
      const name = document.createElement('strong');
      name.textContent = w.name;
      who.append(name, document.createTextNode(w.designation ? ` · ${w.designation}` : ''));
      const marks = document.createElement('div');
      marks.className = 'attendance-marks';
      marks.setAttribute('role', 'group');
      marks.setAttribute('aria-label', `Attendance for ${w.name}`);
      const current = changedMarks.has(w.id) ? changedMarks.get(w.id) : w.status;
      WORKER_MARKS.forEach(([status, short]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `mark-btn mark-${status}${current === status ? ' on' : ''}`;
        b.textContent = short;
        b.title = workerMeta.statuses[status];
        b.setAttribute('aria-pressed', String(current === status));
        b.addEventListener('click', () => {
          // Tapping the chosen mark again clears it.
          changedMarks.set(w.id, current === status ? null : status);
          renderAttendance();
        });
        marks.appendChild(b);
      });
      row.append(who, marks);
      box.appendChild(row);
    });
    return box;
  }));
}

document.getElementById('markAllPresent').addEventListener('click', () => {
  attendance.workers.filter((w) => deptShown(w.department)).forEach((w) => {
    if (!(changedMarks.get(w.id) ?? w.status)) changedMarks.set(w.id, 'present');
  });
  renderAttendance();
});

document.getElementById('saveAttendance').addEventListener('click', async () => {
  if (!changedMarks.size) {
    workerAlert('attendanceAlert', 'No changes to save.');
    return;
  }
  try {
    attendance = await getJson('/api/admin/attendance', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: attendanceDate.value, entries: [...changedMarks].map(([workerId, status]) => ({ workerId, status })) }),
    });
    changedMarks.clear();
    renderAttendance();
    workerAlert('attendanceAlert', `Attendance saved for ${fmtDay(attendanceDate.value)}.`, true);
    if (typeof loadTodo === 'function') loadTodo();
    if (isOwner()) loadPayroll();
  } catch (err) {
    workerAlert('attendanceAlert', err.message);
  }
});
attendanceDate.addEventListener('change', () => {
  if (changedMarks.size && !confirm('You have unsaved attendance. Change the date anyway?')) return;
  loadAttendance();
});

// ---- month-end pay (owner) ----

async function loadPayroll() {
  if (!isOwner() || !payrollMonth.value) return;
  document.getElementById('payrollCsv').href = `/api/admin/payroll.csv?month=${payrollMonth.value}`;
  const body = document.getElementById('payrollBody');
  try {
    const p = await getJson(`/api/admin/payroll?month=${payrollMonth.value}`);
    const people = p.people.filter((x) => deptShown(x.department));
    const summary = document.getElementById('payrollSummary');
    summary.replaceChildren(...[
      ...p.departments.filter((d) => deptShown(d.name)).map((d) => [d.name, `${inrW(d.amount)} · ${d.workers} ${d.workers === 1 ? 'worker' : 'workers'}`]),
      ['Total to pay', inrW(people.reduce((s, x) => s + x.amount, 0))],
    ].map(([label, value]) => {
      const chip = document.createElement('div');
      chip.className = 'payroll-chip';
      const strong = document.createElement('strong');
      strong.textContent = value;
      chip.append(strong, document.createTextNode(label));
      return chip;
    }));
    if (!people.length) {
      body.innerHTML = '<tr><td colspan="10" class="table-empty">No workers for this month.</td></tr>';
      return;
    }
    body.replaceChildren(...people.map((x) => {
      const tr = document.createElement('tr');
      const c = x.counts;
      [
        `${x.name}${x.designation ? ` · ${x.designation}` : ''} (${x.department})`,
        `${inrW(x.wage)} ${x.wageType === 'monthly' ? '/ month' : '/ day'}`,
        c.present, c.half, c.leave, c.off, c.absent, x.unmarked || '', x.paidDays, inrW(x.amount),
      ].forEach((text, i) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (i === 7 && x.unmarked) td.className = 'payroll-unmarked';
        if (i === 9) td.className = 'payroll-amount';
        tr.appendChild(td);
      });
      return tr;
    }));
  } catch (err) {
    body.innerHTML = `<tr><td colspan="10" class="table-empty">${err.message}</td></tr>`;
  }
}
payrollMonth.addEventListener('change', loadPayroll);

workerDept.addEventListener('change', () => {
  renderWorkers();
  renderAttendance();
  loadPayroll();
});

document.querySelector('.tab-btn[data-tab="workers"]').addEventListener('click', async () => {
  await loadWorkers();
  if (!document.getElementById('workerId').value) editWorker(null);
  loadAttendance();
  loadPayroll();
});
