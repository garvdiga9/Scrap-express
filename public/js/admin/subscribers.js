/* ---------- Subscribers: daily rates & announcements ---------- */
const subscribersBody = document.getElementById('subscribersBody');
const subSettingsForm = document.getElementById('subSettingsForm');
const announceForm = document.getElementById('announceForm');

function showFormAlert(id, message, ok) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.className = `form-alert ${ok ? 'success' : 'error'}`;
  el.hidden = false;
}

// "Sent to 12 devices, 30 emails and 8 WhatsApp numbers."
function describeSend({ devices, emails, whatsapp, failed }) {
  const parts = [
    countLabel(devices, 'device'), countLabel(emails, 'email'), countLabel(whatsapp, 'WhatsApp number'),
  ];
  return `Sent to ${parts.join(', ')}.${failed ? ` ${failed} could not be delivered (see the server log).` : ''}`;
}

let shownSubSettings = '';

async function loadSubscribers(background = false) {
  try {
    const res = await fetch('/api/admin/subscribers');
    if (background && sessionEnded(res)) return;
    if (!res.ok) throw new Error();
    const { counts, subscribers, settings, channels } = await res.json();

    document.getElementById('subStats').innerHTML = '';
    [
      [counts.devices, 'App alerts'], [counts.emails, 'Emails'],
      [counts.phones, 'WhatsApp numbers'], [counts.emails_pending, 'Emails not yet confirmed'],
    ].forEach(([n, label]) => {
      const tile = document.createElement('div');
      tile.className = 'sub-stat';
      tile.innerHTML = '<strong></strong><span></span>';
      tile.querySelector('strong').textContent = n;
      tile.querySelector('span').textContent = label;
      document.getElementById('subStats').appendChild(tile);
    });

    const channelList = document.getElementById('subChannels');
    channelList.innerHTML = '';
    [
      [true, 'App & browser notifications: on'],
      [channels.email, channels.email ? 'Email: on (sent from your Gmail)' : 'Email: off. Add SMTP_USER and SMTP_PASS on Render to switch it on'],
      [channels.whatsappRates, channels.whatsappRates ? 'Automatic WhatsApp: on' : 'Automatic WhatsApp: off. Numbers are being collected until the WhatsApp API is set up'],
    ].forEach(([on, text]) => {
      const li = document.createElement('li');
      li.className = on ? 'on' : 'off';
      li.textContent = text;
      channelList.appendChild(li);
    });

    // Only when they really changed, and never mid-edit.
    if (JSON.stringify(settings) !== shownSubSettings && !subSettingsForm.contains(document.activeElement)) {
      shownSubSettings = JSON.stringify(settings);
      document.getElementById('dailyEnabled').checked = settings.dailyEnabled;
      document.getElementById('dailyTime').value = settings.dailyTime;
      document.getElementById('waChannel').value = settings.whatsappChannelUrl || '';
    }

    subscribersBody.innerHTML = '';
    if (!subscribers.length) {
      subscribersBody.innerHTML = '<tr><td colspan="4" class="table-empty">No subscribers yet. The sign-up box is at the bottom of every page.</td></tr>';
      return;
    }
    subscribers.forEach((s) => {
      const tr = document.createElement('tr');
      let status = 'WhatsApp';
      if (s.email) status = s.email_confirmed_at ? 'Email · confirmed' : 'Email · waiting for confirmation';
      [formatDate(s.created_at), s.email || s.phone, status].forEach((text) => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      const actionTd = document.createElement('td');
      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn';
      delBtn.title = 'Remove subscriber';
      delBtn.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
      delBtn.addEventListener('click', async () => {
        if (!confirm(`Remove ${s.email || s.phone}? They will stop getting updates.`)) return;
        await fetch(`/api/admin/subscribers/${s.id}`, { method: 'DELETE' });
        loadSubscribers();
      });
      actionTd.appendChild(delBtn);
      tr.appendChild(actionTd);
      subscribersBody.appendChild(tr);
    });
  } catch (err) {
    if (background) return;
    subscribersBody.innerHTML = '<tr><td colspan="4" class="table-empty">Failed to load subscribers.</td></tr>';
  }
}

subSettingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await fetch('/api/admin/subscribers/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dailyEnabled: document.getElementById('dailyEnabled').checked,
        dailyTime: document.getElementById('dailyTime').value,
        whatsappChannelUrl: document.getElementById('waChannel').value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save.');
    showFormAlert('subSettingsAlert', data.dailyEnabled
      ? `Saved. Today's rates will go out every day at ${data.dailyTime}.`
      : 'Saved. The daily rates are paused.', true);
  } catch (err) {
    showFormAlert('subSettingsAlert', err.message, false);
  }
});

document.getElementById('sendRatesNow').addEventListener('click', async (e) => {
  if (!confirm("Send today's rates to all subscribers now?")) return;
  e.target.disabled = true;
  try {
    const res = await fetch('/api/admin/subscribers/send-rates', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not send.');
    showFormAlert('subSettingsAlert', describeSend(data), true);
  } catch (err) {
    showFormAlert('subSettingsAlert', err.message, false);
  } finally {
    e.target.disabled = false;
  }
});

announceForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('announceTitle').value.trim();
  const message = document.getElementById('announceMessage').value.trim();
  if (!title || !message) return showFormAlert('announceAlert', 'Please add a title and a message.', false);
  if (!confirm('Send this announcement to all subscribers?')) return;
  const btn = announceForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const res = await fetch('/api/admin/subscribers/announce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, message }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not send.');
    showFormAlert('announceAlert', describeSend(data), true);
    announceForm.reset();
  } catch (err) {
    showFormAlert('announceAlert', err.message, false);
  } finally {
    btn.disabled = false;
  }
});
