// Accept / Decline and "My Scrap Is Ready" on a quote, in My Account and on the
// private quote link. Listens on the container because its contents get
// replaced by live updates. Each quote box says where its answers go.
window.SEQuote = (() => {
  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      window.location.href = '/login?next=/account';
      return false;
    }
    if (!res.ok) throw new Error(data.error || 'Could not save that. Please try again.');
    return true;
  }

  function wire(container, refresh) {
    const refreshOrReload = () => refresh().catch(() => window.location.reload());

    container.addEventListener('click', async (e) => {
      const button = e.target.closest('.quote-actions button[data-response]');
      if (!button) return;
      const actions = button.parentElement;
      const alertBox = actions.nextElementSibling;
      const { response } = button.dataset;
      if (response === 'decline' && !confirm('Decline this quote? You can call us any time for a revised one.')) return;

      alertBox.hidden = true;
      actions.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try {
        if (await post(`${button.closest('[data-quote-api]').dataset.quoteApi}/quote`, { response })) await refreshOrReload();
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
        actions.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      }
    });

    container.addEventListener('submit', async (e) => {
      const form = e.target.closest('.ready-form');
      if (!form) return;
      e.preventDefault();
      const button = form.querySelector('button');
      const alertBox = form.querySelector('.form-alert');
      alertBox.hidden = true;
      button.disabled = true;
      try {
        if (await post(`${form.closest('[data-quote-api]').dataset.quoteApi}/ready`, { readyDate: form.elements.readyDate.value })) await refreshOrReload();
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
        button.disabled = false;
      }
    });
  }

  return { wire };
})();
