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

    // Rating a finished pickup.
    container.addEventListener('submit', async (e) => {
      const form = e.target.closest('.rating-form');
      if (!form) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const alertBox = form.querySelector('.form-alert');
      const button = form.querySelector('button[type="submit"]');
      const picked = form.querySelector('input[name="rating"]:checked');
      alertBox.hidden = true;
      if (!picked) {
        alertBox.textContent = 'Please choose 1 to 5 stars.';
        alertBox.hidden = false;
        return;
      }
      button.disabled = true;
      try {
        if (await post(`${form.closest('[data-quote-api]').dataset.quoteApi}/rating`, {
          rating: Number(picked.value), comment: form.elements.comment.value, allowPublic: form.elements.allowPublic.checked,
        })) await refreshOrReload();
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
        button.disabled = false;
      }
    });

    // A drop-off: "I've sent my scrap", with how it's coming.
    container.addEventListener('submit', async (e) => {
      const form = e.target.closest('.sent-form');
      if (!form) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const button = form.querySelector('button[type="submit"]');
      const alertBox = form.querySelector('.form-alert');
      alertBox.hidden = true;
      button.disabled = true;
      try {
        if (await post(`${form.closest('[data-quote-api]').dataset.quoteApi}/sent`, { note: form.elements.note.value })) await refreshOrReload();
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
        button.disabled = false;
      }
    });

    // Changing a booked pickup: another time, new times, or cancelling.
    container.addEventListener('submit', async (e) => {
      const form = e.target.closest('.change-slot-form');
      if (!form) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const button = form.querySelector('button[type="submit"]');
      const alertBox = form.querySelector('.form-alert');
      alertBox.hidden = true;
      button.disabled = true;
      try {
        if (await post(`${form.closest('[data-quote-api]').dataset.quoteApi}/reschedule`, { slotId: form.elements.slotId.value })) await refreshOrReload();
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
        button.disabled = false;
      }
    });
    container.addEventListener('click', async (e) => {
      const button = e.target.closest('[data-pickup-change]');
      if (!button) return;
      const box = button.closest('[data-quote-api]');
      const alertBox = box.querySelector('.change-alert');
      let body;
      let path;
      if (button.dataset.pickupChange === 'cancel') {
        const reason = prompt('Why are you cancelling? This helps us.', '');
        if (reason === null) return;
        if (!reason.trim()) {
          alert('Please tell us why you are cancelling.');
          return;
        }
        path = 'cancel';
        body = { reason };
      } else {
        if (!confirm("Ask us for new pickup times? We'll send you new slots to choose from.")) return;
        path = 'reschedule';
        body = { newSlots: true };
      }
      if (alertBox) alertBox.hidden = true;
      button.disabled = true;
      try {
        if (await post(`${box.dataset.quoteApi}/${path}`, body)) await refreshOrReload();
      } catch (err) {
        if (alertBox) {
          alertBox.textContent = err.message;
          alertBox.hidden = false;
        } else {
          alert(err.message);
        }
        button.disabled = false;
      }
    });

    // Choosing one of the offered pickup slots.
    container.addEventListener('submit', async (e) => {
      const form = e.target.closest('.slot-form:not(.change-slot-form)');
      if (!form) return;
      e.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      const alertBox = form.querySelector('.form-alert');
      alertBox.hidden = true;
      button.disabled = true;
      try {
        if (await post(`${form.closest('[data-quote-api]').dataset.quoteApi}/slot`, { slotId: form.elements.slotId.value })) await refreshOrReload();
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
        button.disabled = false;
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
