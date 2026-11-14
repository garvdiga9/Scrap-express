/* ---------- Pickups tab: the dispatch board ---------- */
const BOARD_STATUS = {
  scheduled: 'Booked', on_way: 'On the way', arrived: 'At the site', weighed: 'Weighed', completed: 'Done', no_scrap: 'No scrap',
};

function boardWindow(w, perSlot) {
  const box = document.createElement('div');
  box.className = `board-window${w.full ? ' board-full' : ''}`;
  const head = document.createElement('div');
  head.className = 'board-window-head';
  const time = document.createElement('strong');
  time.textContent = `${clockLabel(w.from)} – ${clockLabel(w.to)}`;
  const load = document.createElement('span');
  load.textContent = `${w.active} of ${perSlot} trucks${w.full ? ' · full' : ''}`;
  head.append(time, load);
  box.appendChild(head);
  w.booked.forEach((p) => {
    const row = document.createElement('a');
    row.className = `board-pickup board-${p.status}`;
    row.href = `#pickup-${p.id}`;
    const main = document.createElement('span');
    main.textContent = `#${p.id} ${p.company_name}${p.area ? ` · ${p.area}` : ''}`;
    const side = document.createElement('span');
    side.className = 'board-side';
    const who = p.delivery_mode === 'self' ? 'Drop-off (customer brings it)' : p.office_handled ? `${p.outside_provider || 'Outside'} truck (you)` : p.staff_name || 'No staff yet';
    side.textContent = `${who} · ${BOARD_STATUS[p.status] || p.status}`;
    if (!p.staff_name && !p.office_handled && p.status === 'scheduled') side.classList.add('board-warn');
    row.append(main, side);
    box.appendChild(row);
  });
  w.offered.forEach((p) => {
    const row = document.createElement('a');
    row.className = 'board-pickup board-offered';
    row.href = `#pickup-${p.id}`;
    row.textContent = `Offered to #${p.id} ${p.company_name} (waiting for their answer)`;
    box.appendChild(row);
  });
  return box;
}

// "14:00" → "2 PM"
function clockLabel(time) {
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

async function loadBoard() {
  try {
    const res = await fetch(`/api/admin/board?days=${document.getElementById('boardDays').value}`);
    if (!res.ok) return;
    const data = await res.json();
    const perSlot = document.getElementById('perSlot');
    if (document.activeElement !== perSlot) perSlot.value = data.perSlot;
    const alertBox = document.getElementById('boardAlert');
    alertBox.hidden = !data.unassigned;
    alertBox.textContent = `${data.unassigned} booked pickup${data.unassigned === 1 ? ' has' : 's have'} no staff member yet. Open ${data.unassigned === 1 ? 'it' : 'them'} to assign someone, or wait for staff to take ${data.unassigned === 1 ? 'it' : 'them'}.`;
    const count = document.getElementById('unassignedCount');
    count.textContent = data.unassigned;
    count.hidden = !data.unassigned;
    const list = document.getElementById('boardDaysList');
    list.innerHTML = '';
    data.days.forEach((day) => {
      const section = document.createElement('section');
      section.className = 'board-day';
      const h = document.createElement('h3');
      h.textContent = day.label;
      section.appendChild(h);
      if (!day.windows.length) {
        const empty = document.createElement('p');
        empty.className = 'board-empty';
        empty.textContent = 'Nothing booked.';
        section.appendChild(empty);
      }
      day.windows.forEach((w) => section.appendChild(boardWindow(w, data.perSlot)));
      list.appendChild(section);
    });
  } catch (err) {
    // Tried again when the tab is opened.
  }
}
document.getElementById('boardDays').addEventListener('change', loadBoard);

// Yard address for drop-offs (customers who bring the scrap themselves).
const yardForm = document.getElementById('yardForm');
async function loadYard() {
  try {
    const res = await fetch('/api/admin/board/yard');
    if (!res.ok) return;
    const y = await res.json();
    if (!yardForm.contains(document.activeElement)) {
      yardForm.elements.address.value = y.address;
      yardForm.elements.hours.value = y.hours;
      yardForm.elements.map.value = y.map;
      yardForm.elements.pocName.value = y.pocName;
      yardForm.elements.pocPhone.value = y.pocPhone;
    }
  } catch (err) {
    // Tried again when the tab is opened.
  }
}
yardForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const note = document.getElementById('yardSaved');
  const res = await fetch('/api/admin/board/yard', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: yardForm.elements.address.value, hours: yardForm.elements.hours.value, map: yardForm.elements.map.value, pocName: yardForm.elements.pocName.value, pocPhone: yardForm.elements.pocPhone.value,
    }),
  });
  const data = await res.json().catch(() => ({}));
  note.textContent = res.ok ? 'Saved ✓' : (data.error || 'Could not save.');
});
document.querySelector('.tab-btn[data-tab="board"]').addEventListener('click', loadYard);
document.getElementById('boardSettings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch('/api/admin/board/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ perSlot: Number(document.getElementById('perSlot').value) }),
  });
  if (!res.ok) alert((await res.json().catch(() => ({}))).error || 'Could not save.');
  loadBoard();
});
document.querySelector('.tab-btn[data-tab="board"]').addEventListener('click', loadBoard);
window.SELive.on('requests', () => { if (!dashboard.hidden) loadBoard(); });
new MutationObserver(() => { if (!dashboard.hidden) loadBoard(); }).observe(dashboard, { attributes: true, attributeFilter: ['hidden'] });
// The board links to "#pickup-12", which opens that request (admin.js).
