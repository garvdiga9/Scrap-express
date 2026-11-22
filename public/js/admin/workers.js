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
      ...p.departments.filter((d) => deptShown(d.name)).map((d) => [d.name, `${inrW(d.net)} · ${d.workers} ${d.workers === 1 ? 'worker' : 'workers'}`]),
      ...(people.some((x) => x.advance || x.deduction) ? [['Advances and deductions taken off', inrW(people.reduce((s, x) => s + x.advance + x.deduction, 0))]] : []),
      ['Total to pay', inrW(people.reduce((s, x) => s + x.net, 0))],
    ].map(([label, value]) => {
      const chip = document.createElement('div');
      chip.className = 'payroll-chip';
      const strong = document.createElement('strong');
      strong.textContent = value;
      chip.append(strong, document.createTextNode(label));
      return chip;
    }));
    if (!people.length) {
      body.innerHTML = '<tr><td colspan="13" class="table-empty">No workers for this month.</td></tr>';
      return;
    }
    body.replaceChildren(...people.flatMap((x) => {
      const tr = document.createElement('tr');
      const c = x.counts;
      const adjText = [
        x.advance ? `− ${inrW(x.advance)} advance` : '',
        x.deduction ? `− ${inrW(x.deduction)} deduction` : '',
        x.bonus ? `+ ${inrW(x.bonus)} bonus` : '',
      ].filter(Boolean).join(', ') || '-';
      [
        `${x.name}${x.designation ? ` · ${x.designation}` : ''} (${x.department})`,
        `${inrW(x.wage)} ${x.wageType === 'monthly' ? '/ month' : '/ day'}`,
        c.present, c.half, c.leave, c.off, c.absent, x.unmarked || '', x.paidDays, inrW(x.amount), adjText,
        x.net < 0 ? `${inrW(x.net)} (to recover)` : inrW(x.net),
      ].forEach((text, i) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (i === 7 && x.unmarked) td.className = 'payroll-unmarked';
        if (i === 11) td.className = `payroll-amount${x.net < 0 ? ' payroll-negative' : ''}`;
        tr.appendChild(td);
      });
      const actionTd = document.createElement('td');
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'view-btn';
      open.textContent = x.adjustments.length ? `Adjust (${x.adjustments.length})` : 'Adjust';
      actionTd.appendChild(open);
      tr.appendChild(actionTd);
      const detail = adjustmentRow(x);
      detail.hidden = !openAdjust.has(x.id);
      open.addEventListener('click', () => {
        detail.hidden = !detail.hidden;
        if (detail.hidden) openAdjust.delete(x.id); else openAdjust.add(x.id);
      });
      return [tr, detail];
    }));
  } catch (err) {
    body.innerHTML = `<tr><td colspan="13" class="table-empty">${err.message}</td></tr>`;
  }
}

// Advances, deductions and bonuses for one worker this month.
const openAdjust = new Set();
const ADJ_LABELS = { advance: 'Advance (already given, taken off)', deduction: 'Deduction (taken off)', bonus: 'Bonus / extra (added)' };
function adjustmentRow(x) {
  const row = document.createElement('tr');
  row.className = 'adjust-row';
  const td = document.createElement('td');
  td.colSpan = 13;
  const list = document.createElement('ul');
  list.className = 'adjust-list';
  x.adjustments.forEach((a) => {
    const li = document.createElement('li');
    li.append(`${fmtDay(a.day)} · ${ADJ_LABELS[a.kind].split(' (')[0]} ${a.kind === 'bonus' ? '+' : '−'}${inrW(a.amount)}${a.note ? ` · ${a.note}` : ''}${a.addedBy ? ` · by ${a.addedBy}` : ''} `);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-btn';
    del.title = 'Remove';
    del.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
    del.addEventListener('click', async () => {
      if (!confirm('Remove this entry?')) return;
      try {
        await getJson(`/api/admin/adjustments/${a.id}`, { method: 'DELETE' });
        loadPayroll();
      } catch (err) {
        alert(err.message);
      }
    });
    li.appendChild(del);
    list.appendChild(li);
  });
  if (!x.adjustments.length) {
    const li = document.createElement('li');
    li.textContent = 'No advances, deductions or bonuses this month.';
    list.appendChild(li);
  }
  const form = document.createElement('form');
  form.className = 'adjust-form';
  form.noValidate = true;
  const kind = document.createElement('select');
  Object.entries(ADJ_LABELS).forEach(([v, l]) => kind.append(new Option(l, v)));
  const amount = Object.assign(document.createElement('input'), { type: 'number', min: '1', step: '1', placeholder: 'Amount (₹)' });
  amount.setAttribute('aria-label', 'Amount in rupees');
  const date = Object.assign(document.createElement('input'), { type: 'date' });
  date.setAttribute('aria-label', 'Date');
  const monthEnd = `${payrollMonth.value}-${String(new Date(Number(payrollMonth.value.slice(0, 4)), Number(payrollMonth.value.slice(5)), 0).getDate()).padStart(2, '0')}`;
  date.min = `${payrollMonth.value}-01`;
  date.max = monthEnd;
  date.value = workerMeta.today.startsWith(payrollMonth.value) ? workerMeta.today : monthEnd;
  const note = Object.assign(document.createElement('input'), { type: 'text', maxLength: 200, placeholder: 'Note (needed for a deduction)' });
  note.setAttribute('aria-label', 'Note');
  const save = Object.assign(document.createElement('button'), { type: 'submit', className: 'btn btn-accent btn-sm', textContent: 'Add' });
  const msg = Object.assign(document.createElement('p'), { className: 'form-alert error', hidden: true });
  form.append(kind, amount, date, note, save);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.hidden = true;
    try {
      await getJson(`/api/admin/workers/${x.id}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: kind.value, amount: amount.value, date: date.value, note: note.value,
        }),
      });
      openAdjust.add(x.id);
      loadPayroll();
    } catch (err) {
      msg.textContent = err.message;
      msg.hidden = false;
    }
  });
  const title = document.createElement('strong');
  title.textContent = `${x.name}: earned ${inrW(x.amount)} → net ${inrW(x.net)}`;
  td.append(title, list, form, msg);
  row.appendChild(td);
  return row;
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
