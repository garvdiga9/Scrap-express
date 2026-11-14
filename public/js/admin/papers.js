/* ---------- Papers on a request: weighbridge slip, GST invoice ---------- */
window.SEDocs = (() => {
  const LABELS = { weight_slip: 'Weighbridge slip', invoice: 'GST invoice', other: 'Other document' };

  async function render(box, requestType, requestId) {
    box.innerHTML = '';
    const title = document.createElement('h3');
    title.textContent = 'Papers for the customer';
    const hint = document.createElement('p');
    hint.className = 'quote-hint';
    hint.textContent = 'Upload the weighbridge slip and GST invoice (PDF or photo). The customer can download them from My Account or their quote link, and gets an alert.';
    const list = document.createElement('ul');
    list.className = 'docs-list';
    list.innerHTML = '<li class="table-empty">Loading…</li>';

    const form = document.createElement('form');
    form.className = 'docs-form';
    const kind = document.createElement('select');
    kind.setAttribute('aria-label', 'Kind of document');
    Object.entries(LABELS).forEach(([value, label]) => kind.append(new Option(label, value)));
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'application/pdf,image/jpeg,image/png,image/webp';
    file.setAttribute('aria-label', 'Document file');
    const button = document.createElement('button');
    button.type = 'submit';
    button.className = 'btn btn-accent btn-sm';
    button.textContent = 'Upload';
    const alertBox = document.createElement('p');
    alertBox.className = 'form-alert error';
    alertBox.hidden = true;
    form.append(kind, file, button);
    box.append(title, hint, list, form, alertBox);

    async function refresh() {
      const res = await fetch(`/api/admin/documents?requestType=${requestType}&requestId=${requestId}`);
      const docs = res.ok ? await res.json() : [];
      list.innerHTML = docs.length ? '' : '<li class="table-empty">None yet.</li>';
      docs.forEach((doc) => {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = `/api/admin/documents/${doc.id}/file`;
        link.textContent = `${LABELS[doc.kind]} (${doc.original_name || 'file'})`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'icon-btn';
        remove.setAttribute('aria-label', `Delete ${LABELS[doc.kind]}`);
        remove.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
        remove.addEventListener('click', async () => {
          if (!confirm('Delete this document? The customer will no longer see it.')) return;
          await fetch(`/api/admin/documents/${doc.id}`, { method: 'DELETE' });
          refresh();
        });
        li.append(link, remove);
        list.appendChild(li);
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.hidden = true;
      if (!file.files[0]) {
        alertBox.textContent = 'Please choose the file.';
        alertBox.hidden = false;
        return;
      }
      const body = new FormData();
      body.append('requestType', requestType);
      body.append('requestId', requestId);
      body.append('kind', kind.value);
      body.append('file', file.files[0]);
      button.disabled = true;
      button.textContent = 'Uploading…';
      try {
        const res = await fetch('/api/admin/documents', { method: 'POST', body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Upload failed.');
        form.reset();
        refresh();
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
      } finally {
        button.disabled = false;
        button.textContent = 'Upload';
      }
    });
    refresh();
  }

  const docsDialog = document.getElementById('docsDialog');
  document.getElementById('docsDialogClose').addEventListener('click', () => docsDialog.close());
  docsDialog.addEventListener('click', (e) => { if (e.target === docsDialog) docsDialog.close(); });

  return {
    mount: render,
    openDialog(requestType, requestId, title) {
      document.getElementById('docsDialogTitle').textContent = title;
      render(document.getElementById('docsDialogBody'), requestType, requestId);
      docsDialog.showModal();
    },
  };
})();
