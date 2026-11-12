// "Buy from us": the enquiry form that opens from each lot's button.
(() => {
  const dialog = document.getElementById('lotDialog');
  if (!dialog) return;
  const form = document.getElementById('lotForm');
  const alertBox = document.getElementById('lotAlert');
  const submit = document.getElementById('lotSubmit');

  function showMessage(message, type) {
    alertBox.textContent = message;
    alertBox.className = `form-alert ${type}`;
    alertBox.hidden = false;
  }

  // Buttons are inside a live section that can be redrawn, so listen on the page.
  document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-lot-enquiry]');
    if (!button) return;
    document.getElementById('lotId').value = button.dataset.lotEnquiry;
    document.getElementById('lotDialogLot').textContent = button.dataset.lotTitle;
    alertBox.hidden = true;
    form.hidden = false;
    dialog.showModal();
    document.getElementById('lotName').focus();
  });
  document.getElementById('lotDialogClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertBox.hidden = true;
    const payload = Object.fromEntries(new FormData(form).entries());
    if (!payload.name.trim() || !payload.phone.trim()) {
      showMessage('Please fill in your name and phone number.', 'error');
      return;
    }
    if (!window.SEValidate.checkForm(form)) return;
    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      const res = await fetch('/api/lots/enquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please call us on +91 98188 26333.');
      showMessage(data.message, 'success');
      if (window.SETrack) window.SETrack('lot_enquiry');
      const lotId = form.elements.lotId.value;
      form.reset();
      form.elements.lotId.value = lotId;
      form.hidden = true;
    } catch (err) {
      showMessage(err.message, 'error');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Send Enquiry';
    }
  });
})();
