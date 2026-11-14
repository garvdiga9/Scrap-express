/* ---------- To do (top of the dashboard) ---------- */
async function loadTodo() {
  const box = document.getElementById('adminTodo');
  try {
    const res = await fetch('/api/admin/todo');
    if (!res.ok) return;
    const tasks = await res.json();
    const list = document.getElementById('adminTodoList');
    list.innerHTML = '';
    tasks.forEach((t) => {
      const li = document.createElement('li');
      if (t.level === 'urgent') li.className = 'is-urgent';
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'todo-item';
      go.textContent = t.text;
      go.addEventListener('click', () => {
        const tab = document.querySelector(`.tab-btn[data-tab="${t.tab}"]`);
        if (tab) tab.click();
        document.querySelector('.admin-tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      li.appendChild(go);
      list.appendChild(li);
    });
    const urgent = tasks.filter((t) => t.level === 'urgent').length;
    document.getElementById('adminTodoCount').textContent = tasks.length
      ? `${tasks.length} waiting${urgent ? `, ${urgent} urgent` : ''}`
      : '';
    if (!tasks.length) {
      const li = document.createElement('li');
      li.className = 'todo-done';
      li.textContent = 'Nothing waiting. All caught up ✓';
      list.appendChild(li);
    }
    box.hidden = false;
  } catch (err) {
    // Tried again on the next update.
  }
}
window.SELive.on('requests', () => { if (!dashboard.hidden) loadTodo(); });
new MutationObserver(() => { if (!dashboard.hidden) loadTodo(); }).observe(dashboard, { attributes: true, attributeFilter: ['hidden'] });
setInterval(() => { if (!dashboard.hidden && !document.hidden) loadTodo(); }, 5 * 60 * 1000);
if (!dashboard.hidden) loadTodo();
