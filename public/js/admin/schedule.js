/* ---------- A pickup's slots, staff member and weighing (request details) ---------- */
window.SESchedule = (() => {
  const CAN_OFFER = ['accepted', 'ready', 'confirmed', 'slots_sent', 'scheduled'];
  const ASSIGNABLE = ['scheduled', 'on_way', 'arrived'];
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const plusDays = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  function slotRow(date, from, to) {
    const row = document.createElement('div');
    row.className = 'slot-row';
    const d = document.createElement('input');
    d.type = 'date';
    d.min = today();
    d.value = date;
    d.setAttribute('aria-label', 'Slot date');
    const f = document.createElement('input');
    f.type = 'time';
    f.value = from;
    f.setAttribute('aria-label', 'From');
    const t = document.createElement('input');
    t.type = 'time';
    t.value = to;
    t.setAttribute('aria-label', 'To');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-btn';
    remove.setAttribute('aria-label', 'Remove this slot');
    remove.innerHTML = '&times;';
    remove.addEventListener('click', () => row.remove());
    const busy = document.createElement('span');
    busy.className = 'slot-busy';
    row.append(d, f, document.createTextNode('to'), t, remove, busy);
    return row;
  }

  // Ask the server how many pickups are already booked or offered at each
  // proposed time, and show it next to the slot.
  async function checkBusy(rows) {
    const list = [...rows.children];
    const slots = list.map((row) => {
      const [d, f, t] = row.querySelectorAll('input');
      return { date: d.value, from: f.value, to: t.value };
    });
    try {
      const res = await fetch('/api/admin/slots/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slots }),
      });
      if (!res.ok) return;
      const result = await res.json();
      list.forEach((row, i) => {
        const busy = row.querySelector('.slot-busy');
        const info = result.find((x) => x.date === slots[i].date && x.from === slots[i].from && x.to === slots[i].to);
        if (!info) { busy.textContent = ''; return; }
        busy.textContent = info.full
          ? `Full: ${info.booked} of ${info.perSlot} booked`
          : `${info.booked} of ${info.perSlot} booked${info.offered ? `, offered to ${info.offered} more` : ''}`;
        busy.classList.toggle('slot-full', info.full);
      });
    } catch (err) {
      // Just no hint.
    }
  }

  // After an action: reload the requests and redraw this panel.
  async function refresh() {
    if (document.activeElement) document.activeElement.blur();
    delete document.getElementById('requestSchedule').dataset.dirty;
    try {
      await loadRequests();
      updateOpenDialog();
    } catch (err) {
      // The live update will catch up.
    }
  }

  async function send(url, body, method = 'POST') {
    const isForm = body instanceof FormData;
    const res = await fetch(url, {
      method, headers: isForm ? undefined : { 'Content-Type': 'application/json' }, body: isForm ? body : JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save that.');
    return data;
  }

  const outsideLabel = (r) => [
    `${r.outside_provider || 'Outside'} truck`,
    r.outside_vehicle,
    r.outside_driver && `driver ${r.outside_driver}`,
    r.outside_phone,
    r.outside_fare != null && `fare ₹${Number(r.outside_fare).toLocaleString('en-IN')}`,
  ].filter(Boolean).join(' · ');

  const field = (labelText, input) => {
    const label = document.createElement('label');
    label.textContent = `${labelText} `;
    label.appendChild(input);
    return label;
  };
  const textInput = (value, max, placeholder, type = 'text') => {
    const input = document.createElement('input');
    input.type = type;
    input.value = value ?? '';
    if (max) input.maxLength = max;
    if (placeholder) input.placeholder = placeholder;
    return input;
  };
  const alertLine = () => {
    const p = document.createElement('p');
    p.className = 'form-alert error';
    p.hidden = true;
    return p;
  };
  const showError = (box, err) => { box.textContent = err.message; box.hidden = false; };

  // The truck's details. Saving takes the pickup off the staff's list.
  function outsideTruckForm(r) {
    const form = document.createElement('form');
    form.className = 'outside-form';
    form.noValidate = true;
    const heading = document.createElement('strong');
    heading.textContent = r.office_handled ? 'Outside truck details' : 'Book an outside truck, then fill this in';
    const provider = document.createElement('select');
    const known = ['Porter', 'Delhivery'];
    [...known, 'Other'].forEach((p) => provider.append(new Option(p, p)));
    const other = textInput(known.includes(r.outside_provider) ? '' : r.outside_provider, 40, 'Company name');
    provider.value = !r.outside_provider || known.includes(r.outside_provider) ? (r.outside_provider || 'Porter') : 'Other';
    const otherLabel = field('Company', other);
    otherLabel.hidden = provider.value !== 'Other';
    provider.addEventListener('change', () => { otherLabel.hidden = provider.value !== 'Other'; });
    const driver = textInput(r.outside_driver, 100, 'Optional');
    const phone = textInput(r.outside_phone, 15, 'Optional', 'tel');
    const vehicle = textInput(r.outside_vehicle, 20, 'e.g. DL1LA1234');
    const fare = textInput(r.outside_fare, 9, 'What you pay them', 'number');
    fare.min = '0';
    const grid = document.createElement('div');
    grid.className = 'outside-grid';
    grid.append(field('Truck from', provider), otherLabel, field('Driver name', driver), field('Driver phone', phone), field('Vehicle number', vehicle), field('Fare (₹)', fare));
    const hint = document.createElement('p');
    hint.className = 'quote-hint';
    hint.textContent = 'The customer is told the driver name and vehicle number (not the phone or fare). You then mark each step below yourself.';
    const alertBox = alertLine();
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'btn btn-accent btn-sm';
    save.textContent = r.office_handled ? 'Save Truck Details' : 'Use Outside Truck';
    form.append(heading, grid, hint, alertBox, save);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.hidden = true;
      save.disabled = true;
      try {
        await send(`/api/admin/requests/${r.id}/outside`, {
          provider: provider.value === 'Other' ? other.value : provider.value,
          driver: driver.value, phone: phone.value, vehicle: vehicle.value, fare: fare.value,
        }, 'PUT');
        await refresh();
      } catch (err) {
        showError(alertBox, err);
        save.disabled = false;
      }
    });
    return form;
  }

  const lineAmount = (line, qty) => {
    const q = Number(qty) || 0;
    if (line.unit === 'per kg' || line.unit === 'per piece') return q * line.rate;
    if (line.unit === 'per tonne') return (q / 1000) * line.rate;
    if (line.unit === 'lump sum') return Number(line.rate) || 0;
    return 0;
  };

  // The weights for each quoted material, and the photo if the driver sent one.
  function weighForm(r) {
    const form = document.createElement('form');
    form.className = 'office-weigh';
    form.noValidate = true;
    const lines = Array.isArray(r.quote_items) ? r.quote_items : [];
    const before = Array.isArray(r.weighed_items) ? r.weighed_items : [];
    const inputs = lines.map((line, i) => {
      const input = textInput(before[i] && before[i].qty != null ? before[i].qty : '', 10, '', 'number');
      input.min = '0';
      input.step = 'any';
      const unit = line.unit === 'per piece' ? 'pieces' : 'kg';
      if (line.unit === 'lump sum') {
        input.hidden = true;
        form.appendChild(field(`${line.material}: fixed ₹${Number(line.rate).toLocaleString('en-IN')}`, input));
      } else {
        form.appendChild(field(`${line.material} (${unit}) at ₹${line.rate} ${line.unit}`, input));
      }
      return input;
    });
    const total = document.createElement('p');
    total.className = 'schedule-chosen';
    const update = () => {
      const amount = lines.reduce((sum, line, i) => sum + lineAmount(line, inputs[i].value), 0);
      total.textContent = `Amount: ₹${(Math.round(amount * 100) / 100).toLocaleString('en-IN')}`;
    };
    form.addEventListener('input', update);
    update();
    const photo = document.createElement('input');
    photo.type = 'file';
    photo.accept = 'image/*';
    const alertBox = alertLine();
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'btn btn-accent btn-sm';
    save.textContent = r.status === 'weighed' ? 'Save Corrected Weights' : 'Save Weighing';
    form.append(total, field('Weighing photo from the driver (optional)', photo), alertBox, save);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.hidden = true;
      const quantities = lines.map((line, i) => (line.unit === 'lump sum' ? null : inputs[i].value === '' ? null : Number(inputs[i].value)));
      if (!lines.length) return showError(alertBox, new Error('This pickup has no quote to work the amount out from.'));
      save.disabled = true;
      try {
        let body = { quantities };
        if (photo.files[0]) {
          body = new FormData();
          body.append('quantities', JSON.stringify(quantities));
          body.append('file', photo.files[0]);
        }
        await send(`/api/admin/requests/${r.id}/office/weigh`, body);
        await refresh();
      } catch (err) {
        showError(alertBox, err);
        save.disabled = false;
      }
    });
    return form;
  }

  function payForm(r) {
    const form = document.createElement('form');
    form.className = 'office-pay';
    form.noValidate = true;
    const due = r.amount_due == null ? null : Number(r.amount_due);
    const method = document.createElement('select');
    method.append(new Option('Cash', 'cash'), new Option('Bank transfer', 'bank'));
    const amount = textInput(due ?? '', 12, '', 'number');
    amount.min = '0';
    const note = textInput('', 300, 'Only if the amount is different');
    const alertBox = alertLine();
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'btn btn-accent btn-sm';
    save.textContent = 'Mark Paid and Finish';
    form.append(field('Paid by', method), field('Amount paid (₹)', amount), field('Reason', note), alertBox, save);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.hidden = true;
      const words = method.value === 'cash' ? 'paid in cash' : 'to be sent by bank transfer';
      if (!confirm(`₹${Number(amount.value || 0).toLocaleString('en-IN')} ${words}, and finish pickup #${r.id}?`)) return;
      save.disabled = true;
      try {
        await send(`/api/admin/requests/${r.id}/office/paid`, { method: method.value, amount: amount.value, note: note.value });
        await refresh();
      } catch (err) {
        showError(alertBox, err);
        save.disabled = false;
      }
    });
    return form;
  }

  // The steps the office marks for an outside truck, one at a time.
  function officeSteps(r) {
    const wrap = document.createElement('div');
    wrap.className = 'office-steps';
    const heading = document.createElement('strong');
    const selfDrop = r.delivery_mode === 'self';
    heading.textContent = selfDrop ? 'Drop-off steps' : 'You run this pickup';
    wrap.appendChild(heading);
    const alertBox = alertLine();
    const stepButton = (text, url, body, ask) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = ask ? 'btn btn-outline btn-sm office-noscrap' : 'btn btn-accent btn-sm';
      b.textContent = text;
      b.addEventListener('click', async () => {
        if (ask && !confirm(ask)) return;
        b.disabled = true;
        alertBox.hidden = true;
        try {
          await send(url, body);
          await refresh();
        } catch (err) {
          showError(alertBox, err);
          b.disabled = false;
        }
      });
      return b;
    };
    const base = `/api/admin/requests/${r.id}/office`;
    if (r.status === 'scheduled') {
      wrap.appendChild(stepButton(selfDrop ? 'Customer Has Sent It' : 'Truck Is On the Way', `${base}/step`, { step: 'on_way' }));
      if (selfDrop) wrap.appendChild(stepButton('Reached Our Yard', `${base}/step-yard`, {}));
    } else if (r.status === 'on_way') {
      wrap.appendChild(stepButton(selfDrop ? 'Reached Our Yard' : 'Truck Has Arrived', `${base}/step`, { step: 'arrived' }));
    } else if (r.status === 'arrived') {
      wrap.appendChild(weighForm(r));
      wrap.appendChild(stepButton(selfDrop ? 'Not Accepted' : 'No Scrap at Site', `${base}/no-scrap`, {}, selfDrop ? 'Mark this drop-off as not accepted? The customer will be told.' : 'Mark this pickup as "no scrap at site"? The customer will be told.'));
    } else if (r.status === 'weighed') {
      wrap.appendChild(payForm(r));
      const fix = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Correct the weights';
      fix.append(summary, weighForm(r));
      wrap.appendChild(fix);
    } else {
      const done = document.createElement('p');
      done.className = 'quote-hint';
      done.textContent = 'Nothing left to do on this pickup.';
      wrap.appendChild(done);
    }
    wrap.appendChild(alertBox);
    return wrap;
  }

  // Book one of the offered times for the customer (they called, or a time is
  // full for our own trucks): the office's choice, no limits.
  function bookControl(r) {
    const choices = (r.slots || []).filter((s) => s.id !== r.slot_id);
    if (!choices.length) return null;
    const wrap = document.createElement('div');
    wrap.className = 'schedule-staff book-slot';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Time to book');
    choices.forEach((s) => select.append(new Option(s.label, s.id)));
    const alertBox = alertLine();
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-outline btn-sm';
    b.textContent = r.status === 'scheduled' ? 'Move to This Time' : 'Book This Time for the Customer';
    b.addEventListener('click', async () => {
      if (!confirm(`Book ${select.selectedOptions[0].text} for pickup #${r.id}? The customer is told.`)) return;
      b.disabled = true;
      alertBox.hidden = true;
      try {
        await send(`/api/admin/requests/${r.id}/book-slot`, { slotId: Number(select.value) });
        await refresh();
      } catch (err) {
        showError(alertBox, err);
        b.disabled = false;
      }
    });
    wrap.append(select, ' ', b, alertBox);
    return wrap;
  }

  function mount(box, r) {
    box.innerHTML = '';
    // Half-filled forms here survive live updates (admin.js updateOpenDialog).
    delete box.dataset.dirty;
    box.oninput = () => { box.dataset.dirty = '1'; };
    const title = document.createElement('h3');
    const selfDrop = r.delivery_mode === 'self';
    title.textContent = selfDrop ? 'Drop-off time (customer brings it)' : 'Pickup slot and staff';
    box.appendChild(title);
    const note = (text, className = 'quote-hint') => {
      const p = document.createElement('p');
      p.className = className;
      p.textContent = text;
      box.appendChild(p);
      return p;
    };

    if (!r.quote_response && !CAN_OFFER.includes(r.status)) {
      note('After the customer accepts your quote, you send 2–3 free pickup slots here and they choose one.');
      return;
    }

    // A ready-written WhatsApp message for where the pickup is now.
    if (['slots_sent', 'scheduled', 'on_way', 'weighed', 'completed', 'no_scrap', 'cancelled'].includes(r.status)
      || (r.delivery_mode === 'self' && ['accepted', 'arrived'].includes(r.status))) {
      const update = document.createElement('a');
      update.className = 'btn btn-outline btn-sm wa-update';
      update.target = '_blank';
      update.rel = 'noopener';
      update.textContent = 'WhatsApp update';
      update.title = 'Opens WhatsApp with a message about the current step';
      update.hidden = true;
      fetch(`/api/admin/requests/${r.id}/update-text`).then((res) => res.json()).then((data) => {
        if (!data.text) return;
        const digits = String(r.phone).replace(/\D/g, '').slice(-10);
        update.href = `https://wa.me/91${digits}?text=${encodeURIComponent(data.text)}`;
        update.hidden = false;
        const sent = [data.channels.email && r.email ? 'email' : null, data.channels.whatsapp ? 'automatic WhatsApp' : null].filter(Boolean);
        update.title = sent.length
          ? `Already sent by ${sent.join(' and ')}; this opens WhatsApp to send it yourself too`
          : 'Email and automatic WhatsApp are not switched on, so send this yourself';
      }).catch(() => {});
      box.appendChild(update);
    }

    // What's been offered or chosen so far.
    if (r.chosen_slot) {
      note(`Slot chosen: ${r.chosen_slot.label}`, 'schedule-chosen');
    } else if (r.slots && r.slots.length) {
      const deadline = formatDateTime(r.slots_deadline);
      note(r.slots_expired
        ? `The customer did not choose by ${deadline}. Call them, or send new slots below.`
        : `Waiting for the customer to choose by ${deadline}: ${r.slots.map((s) => s.label).join('  |  ')}`,
      r.slots_expired ? 'schedule-expired' : 'quote-hint');
      if (r.quote_token) {
        const share = document.createElement('a');
        share.className = 'btn btn-outline btn-sm';
        share.target = '_blank';
        share.rel = 'noopener';
        const digits = String(r.phone).replace(/\D/g, '').slice(-10);
        const text = `Hello ${r.name}, Scrap Express here. Please choose your pickup slot for request #${r.id}: ${window.location.origin}/quote/${r.quote_token}`;
        share.href = `https://wa.me/91${digits}?text=${encodeURIComponent(text)}`;
        share.textContent = 'Send the link on WhatsApp';
        box.appendChild(share);
      }
    }

    if (['slots_sent', 'scheduled'].includes(r.status)) {
      const book = bookControl(r);
      if (book) box.appendChild(book);
    }

    // Who is doing it: a staff member, or an outside truck the office runs.
    // A drop-off has neither: the customer brings it and you mark the steps.
    if (selfDrop) {
      if (ASSIGNABLE.includes(r.status) || r.status === 'weighed') note('The customer brings the scrap to your yard. Mark each step below when it happens.');
    } else if (ASSIGNABLE.includes(r.status)) {
      const label = document.createElement('label');
      label.className = 'schedule-staff';
      label.textContent = 'Who is doing it ';
      const select = document.createElement('select');
      select.append(new Option('Anyone on staff (not taken yet)', ''));
      staffList.filter((s) => s.active || s.id === r.staff_id).forEach((s) => select.append(new Option(s.name, s.id, false, s.id === r.staff_id)));
      select.append(new Option('Outside truck (Porter, Delhivery…): I run it', 'outside', false, Boolean(r.office_handled)));
      const outsideForm = outsideTruckForm(r);
      outsideForm.hidden = !r.office_handled;
      select.addEventListener('change', async () => {
        if (select.value === 'outside') {
          outsideForm.hidden = false;
          outsideForm.querySelector('select, input').focus();
          return;
        }
        outsideForm.hidden = true;
        const res = await fetch(`/api/admin/requests/${r.id}/staff`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId: select.value || null }),
        });
        if (!res.ok) alert((await res.json().catch(() => ({}))).error || 'Could not assign the pickup.');
        refresh();
      });
      label.appendChild(select);
      box.appendChild(label);
      if (!staffList.length) note('No staff yet. Add them in the Staff tab, or use an outside truck.');
      box.appendChild(outsideForm);
    } else if (r.office_handled) {
      note(`Outside truck: ${outsideLabel(r)}`);
    } else if (r.staff_name) {
      note(`Staff member: ${r.staff_name}`);
    }

    // The office does the steps itself for an outside truck.
    if (r.office_handled) box.appendChild(officeSteps(r));

    // The weighing.
    if (r.weighed_kg != null) {
      const weighed = document.createElement('p');
      weighed.className = 'schedule-chosen';
      weighed.textContent = `Weighed: ${Number(r.weighed_kg).toLocaleString('en-IN')} kg `;
      if (r.weigh_photo_id) {
        const photo = document.createElement('a');
        photo.href = `/api/admin/documents/${r.weigh_photo_id}/file?view=1`;
        photo.target = '_blank';
        photo.rel = 'noopener';
        photo.textContent = 'See the weighing machine photo';
        weighed.appendChild(photo);
      }
      box.appendChild(weighed);
    }

    // Send (or re-send) slots.
    if (!CAN_OFFER.includes(r.status)) return;
    const form = document.createElement('form');
    form.className = 'slot-offer';
    form.noValidate = true;
    const heading = document.createElement('strong');
    heading.textContent = r.slots && r.slots.length
      ? (selfDrop ? 'Send new drop-off times (replaces the ones above)' : 'Send new slots (replaces the ones above)')
      : (selfDrop ? 'Send 2–3 times the customer can bring the scrap' : 'Send 2–3 free pickup slots');
    const rows = document.createElement('div');
    rows.className = 'slot-rows';
    rows.append(slotRow(plusDays(1), '10:00', '13:00'), slotRow(plusDays(1), '14:00', '17:00'), slotRow(plusDays(2), '10:00', '13:00'));
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'add-line-btn';
    add.textContent = '+ Add a slot';
    add.addEventListener('click', () => {
      if (rows.children.length < 4) rows.appendChild(slotRow(plusDays(2), '14:00', '17:00'));
      checkBusy(rows);
    });
    rows.addEventListener('change', () => checkBusy(rows));
    rows.addEventListener('click', (e) => { if (e.target.closest('.icon-btn')) setTimeout(() => checkBusy(rows)); });
    setTimeout(() => checkBusy(rows));
    const deadlineLabel = document.createElement('label');
    deadlineLabel.className = 'schedule-staff';
    deadlineLabel.textContent = 'Customer must choose within ';
    const hours = document.createElement('select');
    [[6, '6 hours'], [12, '12 hours'], [24, '24 hours'], [48, '2 days'], [72, '3 days']].forEach(([value, text]) => hours.append(new Option(text, value, false, value === 24)));
    deadlineLabel.appendChild(hours);
    const alertBox = document.createElement('p');
    alertBox.className = 'form-alert error';
    alertBox.hidden = true;
    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'btn btn-accent';
    send.textContent = 'Send Slots to Customer';
    form.append(heading, rows, add, deadlineLabel, alertBox, send);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.hidden = true;
      const slots = [...rows.children].map((row) => {
        const [d, f, t] = row.querySelectorAll('input');
        return { date: d.value, from: f.value, to: t.value };
      });
      send.disabled = true;
      try {
        const res = await fetch(`/api/admin/requests/${r.id}/slots`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slots, deadlineHours: Number(hours.value) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not send the slots.');
        send.textContent = 'Sent ✓';
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
        send.disabled = false;
      }
    });
    box.appendChild(form);
  }

  return { mount };
})();
