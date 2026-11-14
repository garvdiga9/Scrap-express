/* ---------- Request details & quote dialog ---------- */
const requestDialog = document.getElementById('requestDialog');
const requestDetails = document.getElementById('requestDetails');
const quoteForm = document.getElementById('quoteForm');
const quoteLines = document.getElementById('quoteLines');
const quoteNote = document.getElementById('quoteNote');
const quoteHint = document.getElementById('quoteHint');
const quoteAlert = document.getElementById('quoteAlert');
const sendQuoteBtn = document.getElementById('sendQuoteBtn');
const whatsappLink = document.getElementById('whatsappLink');
const copyQuoteLink = document.getElementById('copyQuoteLink');
let dialogRequest = null;

copyQuoteLink.addEventListener('click', async () => {
  const link = quoteLinkOf(dialogRequest);
  try {
    await navigator.clipboard.writeText(link);
    copyQuoteLink.textContent = 'Copied!';
    setTimeout(() => { copyQuoteLink.textContent = 'Copy Quote Link'; }, 1500);
  } catch (err) {
    window.prompt('Copy this link:', link);
  }
});
document.getElementById('dialogClose').addEventListener('click', () => requestDialog.close());
// Clicking the dimmed backdrop (outside the dialog box) closes it too.
requestDialog.addEventListener('click', (e) => { if (e.target === requestDialog) requestDialog.close(); });
document.getElementById('addQuoteLine').addEventListener('click', () => {
  quoteLines.appendChild(buildQuoteLine({ material: '', rate: '', unit: 'per kg' }));
  quoteLines.lastElementChild.querySelector('input').focus();
});

// "Paper & Cardboard, Plastic, Other: wooden pallets, rubber" → one entry per
// type. "Other: …" is always last and may itself contain commas.
function splitScrapTypes(text) {
  const at = text.indexOf('Other: ');
  const known = (at === -1 ? text : text.slice(0, at)).split(', ').filter(Boolean);
  return at === -1 ? known : [...known, text.slice(at + 'Other: '.length)];
}

function buildQuoteLine({ material, rate, unit }) {
  const line = document.createElement('div');
  line.className = 'quote-line';

  const materialInput = document.createElement('input');
  materialInput.type = 'text';
  materialInput.maxLength = 100;
  materialInput.placeholder = 'Material';
  materialInput.value = material;
  materialInput.setAttribute('aria-label', 'Material');

  const rateWrap = document.createElement('div');
  rateWrap.className = 'rate-input';
  const rateInput = document.createElement('input');
  rateInput.type = 'number';
  rateInput.min = '0';
  rateInput.step = '0.01';
  rateInput.placeholder = 'Rate';
  rateInput.value = rate;
  rateInput.setAttribute('aria-label', 'Rate in rupees');
  rateWrap.append('₹', rateInput);

  const unitSelect = document.createElement('select');
  unitSelect.setAttribute('aria-label', 'Unit');
  QUOTE_UNITS.forEach((u) => {
    const opt = document.createElement('option');
    opt.value = u;
    opt.textContent = u;
    if (u === unit) opt.selected = true;
    unitSelect.appendChild(opt);
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'icon-btn';
  removeBtn.title = 'Remove line';
  removeBtn.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
  removeBtn.addEventListener('click', () => line.remove());

  line.append(materialInput, rateWrap, unitSelect, removeBtn);
  return line;
}

function addDetail(label, value, href) {
  if (!value) return;
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  if (href) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = value;
    dd.appendChild(a);
  } else {
    dd.textContent = value;
  }
  requestDetails.append(dt, dd);
  return dd;
}

// A ready-to-send WhatsApp message with the quote, opened from your own
// WhatsApp, with the private link to accept or decline it.
const quoteLinkOf = (r) => `${window.location.origin}/quote/${r.quote_token}`;

function updateWhatsappLink(r) {
  copyQuoteLink.hidden = !r.quote_token;
  const digits = String(r.phone || '').replace(/\D/g, '').slice(-10);
  // Landlines can't get WhatsApp messages.
  if (!r.quote_items || !/^[6-9]\d{9}$/.test(digits) || String(r.phone).startsWith('0')) {
    whatsappLink.hidden = true;
    return;
  }
  const lines = [
    `Hello ${r.name}, here is the Scrap Express quote for your pickup request #${r.id}${r.company_name ? ` (${r.company_name})` : ''}:`,
    '',
    ...r.quote_items.map((item) => `• ${item.material}: ${formatRate(item)}`),
  ];
  if (r.quote_note) lines.push('', r.quote_note);
  lines.push('', 'The final amount is worked out from the weighbridge weight at pickup.');
  lines.push(r.quote_token
    ? `You can accept or decline it here, no login needed: ${quoteLinkOf(r)}`
    : 'Reply here to confirm and we will schedule the pickup.');
  whatsappLink.href = `https://wa.me/91${digits}?text=${encodeURIComponent(lines.join('\n'))}`;
  whatsappLink.hidden = false;
}

function renderRequestSummary(r) {
  requestDetails.innerHTML = '';
  if (r.past_no_scrap) addDetail('Warning', `${wastedTrips(r.past_no_scrap)} on this number or account before.`);
  addDetail('Received', formatDate(r.created_at));
  addDetail('Status', PICKUP_STATUS_LABELS[r.status] || r.status);
  // How the scrap reaches us, and what the pickup involves (affects the quote).
  if (r.delivery_mode === 'self') {
    addDetail('Delivery', 'Customer sends it to our yard (own vehicle or a delivery app). You run the steps.').classList.add('detail-note');
    if (r.sent_note) addDetail('How it is coming', r.sent_note);
  } else {
    addDetail('Delivery', 'We pick it up');
    if (r.scrap_location) addDetail('Scrap kept', r.scrap_location);
    if (r.needs_dismantling) addDetail('Taking down', 'Some items must be taken down or dismantled first').classList.add('detail-note');
  }
  if (r.status === 'ready') addDetail('Before dispatch', 'Call the customer to confirm the scrap is ready, then set the status to Confirmed.');
  if (r.ready_date) addDetail('Scrap ready from', formatDate(r.ready_date));
  if (r.dispatch_checked_at) addDetail('Confirmed by call', formatDate(r.dispatch_checked_at));
  if (r.rated_at) addDetail('Customer rating', `${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}${r.rating_comment ? ` “${r.rating_comment}”` : ''}`);
  if (r.chosen_slot) addDetail(r.delivery_mode === 'self' ? 'Drop-off time' : 'Pickup slot', r.chosen_slot.label);
  if (r.status === 'cancelled' && r.cancelled_by === 'customer') addDetail('Cancelled by customer', r.cancel_reason || 'No reason given').classList.add('detail-warn');
  if (r.staff_name) addDetail('Staff', r.staff_name);
  if (r.weighed_kg != null) {
    const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    const lines = (r.weighed_items || []).map((i) => `• ${i.material}: ${i.unit === 'lump sum' ? 'fixed' : `${Number(i.qty).toLocaleString('en-IN')} ${i.unit === 'per piece' ? 'pcs' : 'kg'}`} × ${inr(i.rate)} ${i.unit} = ${inr(i.amount)}`);
    addDetail('Weighed', [`${Number(r.weighed_kg).toLocaleString('en-IN')} kg${r.amount_due != null ? ` · due ${inr(r.amount_due)}` : ''}`, ...lines].join(String.fromCharCode(10)));
  }
  if (r.weigh_warnings && r.weigh_warnings.length) {
    addDetail('Photo check', `⚠️ ${r.weigh_warnings.join(' ')}`).classList.add('detail-warn');
  } else if (r.weighed_kg != null && r.weigh_photo_taken_at) {
    addDetail('Photo check', `Taken ${formatDateTime(r.weigh_photo_taken_at)}${r.weigh_distance_m != null ? `, ${r.weigh_distance_m < 1000 ? `${r.weigh_distance_m} m` : `${(r.weigh_distance_m / 1000).toFixed(1)} km`} from the site pin` : ''}`);
  }
  if (r.weigh_latitude != null) addDetail('Uploaded from', 'See on the map', `https://www.google.com/maps?q=${r.weigh_latitude},${r.weigh_longitude}`);
  if (r.amount_paid != null) {
    addDetail('Paid', `₹${Number(r.amount_paid).toLocaleString('en-IN')} by ${r.payment_method === 'cash' ? 'cash' : 'bank transfer'}${r.payment_note ? ` · reason: ${r.payment_note}` : ''}`);
  }
  if (r.weighed_items && r.quote_token) addDetail('Receipt', 'Open the printable receipt', `/quote/${r.quote_token}/receipt`);
  addDetail('Company', r.company_name);
  addDetail('Business type', r.business_type);
  addDetail('GSTIN', r.gstin);
  addDetail('Contact person', r.name);
  addDetail('Phone', r.phone, `tel:${r.phone}`);
  addDetail('Email', r.email, r.email ? `mailto:${r.email}` : null);
  addDetail('Site address', r.address).append(document.createElement('br'), mapLink(r, r.address));
  addDetail('Area', r.area);
  addDetail('Pincode', r.pincode);
  addDetail('Scrap types', r.scrap_type);
  addDetail('Quantity', r.item_quantities && r.item_quantities.length
    ? `${r.approx_quantity} in total\n${r.item_quantities.map((i) => `• ${i.type}: ${i.quantity} ${i.unit}`).join('\n')}`
    : r.approx_quantity);
  addDetail('Frequency', r.pickup_frequency);
  addDetail('Notes', r.notes);
  addDetail('Rules accepted', r.terms_accepted_at ? formatDate(r.terms_accepted_at) : 'Before the rules were added');
  addDetail('Customer account', r.customer_id ? 'Yes — sees the quote in My Account too' : 'No — they answer from the quote link');
  if (r.quote_response) {
    addDetail('Customer answer', `${r.quote_response === 'accepted' ? 'Accepted' : 'Declined'} on ${formatDate(r.quote_responded_at)}`);
  }
  quoteHint.textContent = r.quoted_at
    ? `Quote sent on ${formatDate(r.quoted_at)}. Sending again replaces it and asks the customer to answer again.`
    : 'Enter your rate for each material. Sending marks the request as "Quote sent".';
  sendQuoteBtn.textContent = r.quoted_at ? 'Send Revised Quote' : 'Send Quote';
  updateWhatsappLink(r);
}

// A live update while the dialog is open refreshes the details (such as the
// customer's answer) but leaves the quote being typed alone.
function updateOpenDialog() {
  if (!requestDialog.open || !dialogRequest) return;
  const fresh = allRequests.find((r) => r.id === dialogRequest.id);
  if (!fresh) return;
  dialogRequest = fresh;
  renderRequestSummary(fresh);
  // The slots panel too, unless something is being typed or filled in it.
  const schedule = document.getElementById('requestSchedule');
  if (!schedule.contains(document.activeElement) && !schedule.dataset.dirty) window.SESchedule.mount(schedule, fresh);
}

function openRequestDialog(r) {
  dialogRequest = r;
  document.getElementById('dialogTitle').textContent = `Pickup Request #${r.id}`;
  renderRequestSummary(r);
  renderMediaGallery(document.getElementById('requestMedia'), r.media || []);
  window.SESchedule.mount(document.getElementById('requestSchedule'), r);
  window.SEDocs.mount(document.getElementById('requestDocs'), 'pickup', r.id);

  quoteLines.innerHTML = '';
  const items = r.quote_items && r.quote_items.length
    ? r.quote_items
    : splitScrapTypes(r.scrap_type || '').map((material) => ({ material, rate: '', unit: 'per kg' }));
  (items.length ? items : [{ material: '', rate: '', unit: 'per kg' }])
    .forEach((item) => quoteLines.appendChild(buildQuoteLine(item)));
  quoteNote.value = r.quote_note || '';
  quoteAlert.hidden = true;

  requestDialog.showModal();
}

quoteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = dialogRequest;
  const items = [...quoteLines.querySelectorAll('.quote-line')].map((line) => {
    const [material, rate] = line.querySelectorAll('input');
    return { material: material.value.trim(), rate: rate.value, unit: line.querySelector('select').value };
  });

  quoteAlert.hidden = true;
  const showQuoteError = (message) => {
    quoteAlert.textContent = message;
    quoteAlert.className = 'form-alert error';
    quoteAlert.hidden = false;
  };
  if (!items.length) return showQuoteError('Add at least one line to the quote.');
  if (items.some((item) => !item.material || item.rate === '')) {
    return showQuoteError('Each line needs a material and a rate.');
  }

  sendQuoteBtn.disabled = true;
  try {
    const res = await fetch(`/api/admin/requests/${r.id}/quote`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, note: quoteNote.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to save the quote.');
    Object.assign(r, data);
    renderRequests();
    openRequestDialog(r);
    const emailNote = {
      sent: `Emailed to ${r.email}.`,
      failed: `The email to ${r.email} could not be sent, so please send it on WhatsApp.`,
      off: 'Email isn\'t set up yet, so please send it on WhatsApp.',
      none: 'They didn\'t give an email, so please send it on WhatsApp.',
    }[data.email_status];
    const accountNote = r.customer_id ? ' They can also see it in My Account.' : '';
    quoteAlert.textContent = `Quote saved. ${emailNote}${accountNote}`;
    quoteAlert.className = data.email_status === 'failed' ? 'form-alert error' : 'form-alert success';
    quoteAlert.hidden = false;
  } catch (err) {
    showQuoteError(err.message);
  } finally {
    sendQuoteBtn.disabled = false;
  }
});
