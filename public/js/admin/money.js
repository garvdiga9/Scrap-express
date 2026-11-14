/* ---------- Money tab: cash with staff, bank transfers to make ---------- */
const inrAdmin = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function cashCard(s) {
  const card = document.createElement('article');
  card.className = 'cash-card';
  const head = document.createElement('div');
  head.className = 'cash-card-head';
  const name = document.createElement('strong');
  name.textContent = s.name;
  const since = document.createElement('span');
  since.className = 'lead-meta';
  since.textContent = s.since ? `Since the last settle-up on ${formatDateTime(s.since)}` : 'Since the start';
  head.append(name, since);

  const figures = document.createElement('dl');
  figures.className = 'cash-figures';
  [['Cash given', s.givenTotal], ['Paid to customers', s.paidTotal], ['Should have now', s.shouldHave]].forEach(([label, value]) => {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = inrAdmin(value);
    if (label === 'Should have now' && value < 0) dd.className = 'cash-negative';
    div.append(dt, dd);
    figures.appendChild(div);
  });

  const details = document.createElement('details');
  details.className = 'cash-details';
  const summary = document.createElement('summary');
  summary.textContent = `${s.given.length} cash given · ${s.paid.length} cash payment${s.paid.length === 1 ? '' : 's'}`;
  const list = document.createElement('ul');
  s.given.forEach((g) => {
    const li = document.createElement('li');
    li.textContent = `+ ${inrAdmin(g.amount)} given ${formatDateTime(g.created_at)}${g.note ? ` (${g.note})` : ''}`;
    list.appendChild(li);
  });
  s.paid.forEach((p) => {
    const li = document.createElement('li');
    li.textContent = `− ${inrAdmin(p.amount_paid)} to ${p.company_name} (#${p.id}) ${formatDateTime(p.paid_at)}`;
    list.appendChild(li);
  });
  details.append(summary, list);

  const actions = document.createElement('div');
  actions.className = 'cash-actions';
  const amountInput = (placeholder) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = 'any';
    input.inputMode = 'decimal';
    input.placeholder = placeholder;
    input.setAttribute('aria-label', placeholder);
    return input;
  };
  const giveAmount = amountInput('Cash to give (₹)');
  const giveBtn = document.createElement('button');
  giveBtn.type = 'button';
  giveBtn.className = 'btn btn-outline btn-sm';
  giveBtn.textContent = 'Give Cash';
  giveBtn.addEventListener('click', async () => {
    if (!(Number(giveAmount.value) > 0)) {
      alert('Please enter the amount of cash you gave.');
      return;
    }
    const res = await fetch('/api/admin/cash/give', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId: s.id, amount: giveAmount.value }),
    });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error || 'Could not save that.');
    loadMoney();
  });
  const settleAmount = amountInput('Cash handed back (₹)');
  const settleBtn = document.createElement('button');
  settleBtn.type = 'button';
  settleBtn.className = 'btn btn-accent btn-sm';
  settleBtn.textContent = 'Settle Up';
  settleBtn.addEventListener('click', async () => {
    if (settleAmount.value === '') {
      alert('Please enter the cash they handed back (0 if none).');
      return;
    }
    const back = Number(settleAmount.value);
    const diff = Math.round((back - s.shouldHave) * 100) / 100;
    let note = '';
    if (diff === 0) {
      if (!confirm(`Settle up ${s.name}: ${inrAdmin(back)} handed back, matches exactly?`)) return;
    } else {
      note = prompt(`They should have ${inrAdmin(s.shouldHave)} and handed back ${inrAdmin(back)}: ${diff > 0 ? 'extra' : 'short'} by ${inrAdmin(Math.abs(diff))}. Add a note (optional):`, '');
      if (note === null) return;
    }
    const res = await fetch('/api/admin/cash/settle', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId: s.id, returned: back, note }),
    });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error || 'Could not save that.');
    loadMoney();
  });
  actions.append(giveAmount, giveBtn, settleAmount, settleBtn);
  card.append(head, figures, details, actions);
  return card;
}

function bankRow(p) {
  const tr = document.createElement('tr');
  [`#${p.id} · ${formatDateTime(p.paid_at)}`, `${p.company_name} (${p.name})`, inrAdmin(p.amount_paid), p.staff_name || '-'].forEach((value) => {
    const td = document.createElement('td');
    td.textContent = value;
    tr.appendChild(td);
  });
  tr.children[1].append(document.createElement('br'), telLink(p.phone));
  const status = document.createElement('td');
  if (p.bank_paid_at) {
    status.textContent = `Paid ${formatDateTime(p.bank_paid_at)} · ref. ${p.bank_reference}`;
  } else {
    const ref = document.createElement('input');
    ref.type = 'text';
    ref.placeholder = 'UTR / cheque no.';
    ref.setAttribute('aria-label', `Payment reference for pickup ${p.id}`);
    ref.className = 'bank-ref';
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'btn btn-accent btn-sm';
    done.textContent = 'Mark Paid';
    done.addEventListener('click', async () => {
      if (!ref.value.trim()) {
        alert('Please enter the payment reference (UTR or cheque number).');
        return;
      }
      const res = await fetch(`/api/admin/requests/${p.id}/bank-paid`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: ref.value }),
      });
      if (!res.ok) alert((await res.json().catch(() => ({}))).error || 'Could not save that.');
      loadMoney();
    });
    status.append(ref, ' ', done);
  }
  tr.appendChild(status);
  return tr;
}

async function loadMoney() {
  try {
    const res = await fetch('/api/admin/cash');
    if (!res.ok) return;
    const data = await res.json();
    const t = data.totals;
    const tiles = document.getElementById('moneyTiles');
    tiles.innerHTML = '';
    [['Cash paid today', inrAdmin(t.cash_today)], ['Bank transfers today', inrAdmin(t.bank_today)], ['Weighed today', `${t.kg_today.toLocaleString('en-IN')} kg`],
      ['Paid this month', inrAdmin(t.paid_month)], ['Weighed this month', `${t.kg_month.toLocaleString('en-IN')} kg`], ['Bank transfers still to pay', inrAdmin(t.bank_to_pay)]]
      .forEach(([label, value], i) => {
        const div = document.createElement('div');
        div.className = `stat-tile${i === 5 && t.bank_to_pay > 0 ? ' stat-tile-warn' : ''}`;
        const v = document.createElement('strong');
        v.textContent = value;
        const l = document.createElement('span');
        l.textContent = label;
        div.append(v, l);
        tiles.appendChild(div);
      });
    // Don't redraw a card while an amount is being typed in it.
    const cards = document.getElementById('cashCards');
    if (!cards.contains(document.activeElement)) {
      cards.innerHTML = data.staff.length ? '' : '<p class="table-empty">No staff yet. Add them in the Staff tab.</p>';
      data.staff.forEach((s) => cards.appendChild(cashCard(s)));
    }
    const bank = document.getElementById('bankBody');
    if (!bank.contains(document.activeElement)) {
      bank.innerHTML = data.bank.length ? '' : '<tr><td colspan="5" class="table-empty">No bank transfers to make.</td></tr>';
      data.bank.forEach((p) => bank.appendChild(bankRow(p)));
    }
    const toPay = data.bank.filter((p) => !p.bank_paid_at).length;
    const count = document.getElementById('bankToPayCount');
    count.textContent = toPay;
    count.hidden = !toPay;
    const settled = document.getElementById('settleBody');
    settled.innerHTML = data.settled.length ? '' : '<tr><td colspan="6" class="table-empty">No settle-ups yet.</td></tr>';
    data.settled.forEach((x) => {
      const tr = document.createElement('tr');
      const diff = x.difference === 0 ? 'Matches' : `${x.difference > 0 ? '+' : '−'}${inrAdmin(Math.abs(x.difference))}`;
      [formatDateTime(x.created_at), x.name, inrAdmin(x.expected), inrAdmin(x.amount), diff, x.note || '-'].forEach((value, i) => {
        const td = document.createElement('td');
        td.textContent = value;
        if (i === 4 && x.difference < 0) td.className = 'cash-negative';
        tr.appendChild(td);
      });
      settled.appendChild(tr);
    });
  } catch (err) {
    // Tried again when the tab is opened.
  }
}
document.querySelector('.tab-btn[data-tab="money"]').addEventListener('click', loadMoney);
window.SELive.on('requests', () => { if (!dashboard.hidden) loadMoney(); });
new MutationObserver(() => { if (!dashboard.hidden) loadMoney(); }).observe(dashboard, { attributes: true, attributeFilter: ['hidden'] });
