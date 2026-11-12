// "Request a call back": a short form that opens from anything marked
// data-callback, on any page.
(() => {
  const dialog = document.getElementById('callbackDialog');
  const form = document.getElementById('callbackForm');
  const alertBox = document.getElementById('callbackAlert');
  const submit = document.getElementById('callbackSubmit');

  function showMessage(message, type) {
    alertBox.textContent = message;
    alertBox.className = `form-alert ${type}`;
    alertBox.hidden = false;
  }

  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-callback]');
    if (!opener) return;
    e.preventDefault();
    alertBox.hidden = true;
    form.hidden = false;
    dialog.showModal();
    const firstEmpty = [...form.querySelectorAll('[required]')].find((field) => !field.value.trim());
    if (firstEmpty) firstEmpty.focus();
  });

  document.getElementById('callbackClose').addEventListener('click', () => dialog.close());
  // Clicking the dimmed background closes it too.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertBox.hidden = true;
    const payload = Object.fromEntries(new FormData(form).entries());
    if (!payload.name.trim() || !payload.phone.trim() || !payload.query.trim()) {
      showMessage('Please fill in your name, phone number and query.', 'error');
      return;
    }
    if (!window.SEValidate.checkForm(form)) return;

    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      const res = await fetch('/api/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please call us on +91 98188 26333.');
      showMessage(data.message, 'success');
      if (window.SETrack) window.SETrack('callback_request');
      form.reset();
      form.hidden = true;
    } catch (err) {
      showMessage(err.message, 'error');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Request a Call Back';
    }
  });
})();
