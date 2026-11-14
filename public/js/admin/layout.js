/* ---------- Phone layout & staying up to date ---------- */
// On phones each table row is shown as a card (admin.css); every cell gets
// its column name as a label. Rows are rebuilt often, so label on change.
document.querySelectorAll('.admin-table').forEach((table) => {
  const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  const body = table.querySelector('tbody');
  const label = () => body.querySelectorAll('tr').forEach((tr) => {
    [...tr.children].forEach((td, i) => { if (!td.colSpan || td.colSpan === 1) td.dataset.label = headers[i] || ''; });
  });
  new MutationObserver(label).observe(body, { childList: true });
  label();
});

// "3 new" on the request tabs.
function setTabCount(el, list) {
  const pending = list.filter((r) => r.status === 'pending').length;
  el.textContent = pending ? `${pending} new` : '';
  el.hidden = !pending;
}

// Everything updates by itself while the dashboard is open (see live.js). A
// notification arriving is one more reason to check the request lists.
