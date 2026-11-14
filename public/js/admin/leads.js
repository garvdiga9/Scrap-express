/* ---------- Leads: step 1 of the pickup form, not finished ---------- */
async function loadLeads() {
  try {
    const res = await fetch('/api/admin/leads');
    if (!res.ok) return;
    const leads = await res.json();
    const card = document.getElementById('leadsCard');
    const list = document.getElementById('leadsList');
    card.hidden = !leads.length;
    document.getElementById('leadsCount').textContent = leads.length || '';
    list.innerHTML = '';
    leads.forEach((lead) => {
      const li = document.createElement('li');
      li.className = 'lead-item';
      const main = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = lead.company_name;
      const meta = document.createElement('span');
      meta.className = 'lead-meta';
      meta.textContent = `${lead.scrap_type} · ${lead.approx_quantity} · ${formatDateTime(lead.created_at)}`;
      main.append(title, meta);
      const actions = document.createElement('div');
      actions.className = 'lead-actions';
      const digits = String(lead.phone).replace(/D/g, '').slice(-10);
      const wa = document.createElement('a');
      wa.className = 'btn btn-outline btn-sm';
      wa.href = `https://wa.me/91${digits}?text=${encodeURIComponent(`Hello from Scrap Express. You started a pickup request for ${lead.scrap_type} (${lead.approx_quantity}). Can we help you finish it?`)}`;
      wa.target = '_blank';
      wa.rel = 'noopener';
      wa.textContent = 'WhatsApp';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-btn';
      remove.title = 'Remove this lead';
      remove.setAttribute('aria-label', `Remove the lead from ${lead.company_name}`);
      remove.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
      remove.addEventListener('click', async () => {
        if (!confirm(`Remove the unfinished request from ${lead.company_name}?`)) return;
        await fetch(`/api/admin/leads/${lead.id}`, { method: 'DELETE' });
        loadLeads();
      });
      actions.append(telLink(lead.phone), wa, remove);
      li.append(main, actions);
      list.appendChild(li);
    });
  } catch (err) {
    // Shown again on the next refresh.
  }
}

function refreshRequests() {
  if (dashboard.hidden) return Promise.resolve();
  return Promise.all([loadRequests(true), loadLeads(), loadDemolitionRequests(true), loadCallbacks(true), loadCustomers(true)]);
}
window.SELive.on('requests', refreshRequests);
window.SELive.on('callbacks', () => loadCallbacks(true));
window.SELive.on('customers', () => loadCustomers(true));
window.SELive.on('rates', () => loadRates(true));
window.SELive.on('reviews', () => loadTestimonials(true));
window.SELive.on('subscribers', () => loadSubscribers(true));
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'push') refreshRequests();
  });
}

checkSession();
