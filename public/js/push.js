// Turning push notifications on and off from the browser. Used by the
// customer account page and the admin dashboard; each passes its own API
// base (/api/customer or /api/admin).
window.SEPush = (() => {
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isInstalledApp = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  function base64UrlToBytes(value) {
    const padded = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  }

  async function registration() {
    await navigator.serviceWorker.register('/sw.js');
    return navigator.serviceWorker.ready;
  }

  async function post(url, method, body) {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  // 'unsupported' | 'ios-install' | 'blocked' | 'off' | 'on'
  async function status(apiBase) {
    if (!supported()) return isIOS && !isInstalledApp ? 'ios-install' : 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    if (Notification.permission !== 'granted') return 'off';
    const sub = await (await registration()).pushManager.getSubscription();
    if (!sub) return 'off';
    const { on } = await post(`${apiBase}/push/status`, 'POST', { endpoint: sub.endpoint });
    return on ? 'on' : 'off';
  }

  async function enable(apiBase) {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error(permission === 'denied'
        ? 'Notifications are blocked for this site. Allow them in your browser or phone settings, then try again.'
        : 'Notifications were not turned on.');
    }
    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const res = await fetch('/api/push/key');
      const { publicKey, error } = await res.json();
      if (!res.ok) throw new Error(error || 'Notifications are not available right now.');
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
    }
    await post(`${apiBase}/push`, 'POST', { subscription: sub.toJSON() });
  }

  // Only this role is switched off; the browser subscription stays, since the
  // same phone may also get notifications for the other role.
  async function disable(apiBase) {
    const sub = await (await registration()).pushManager.getSubscription();
    if (sub) await post(`${apiBase}/push`, 'DELETE', { endpoint: sub.endpoint });
  }

  // Wires a container holding [data-push-status], [data-push-toggle] and an
  // optional [data-push-test] button to one role's notifications.
  async function mount(container, apiBase, texts) {
    if (!container) return;
    const statusEl = container.querySelector('[data-push-status]');
    const toggle = container.querySelector('[data-push-toggle]');
    const testBtn = container.querySelector('[data-push-test]');
    const MESSAGES = {
      on: texts.on,
      off: texts.off,
      blocked: 'Notifications are blocked for this site. Allow them in your browser or phone settings.',
      'ios-install': 'On iPhone, first add this app to your Home Screen (Share → Add to Home Screen), then open it from there to turn on notifications.',
      unsupported: "This browser can't show notifications. Try Chrome on Android, or the installed app.",
    };
    let current = 'off';
    const render = (state, error) => {
      current = state;
      container.dataset.state = state;
      statusEl.textContent = error || MESSAGES[state];
      statusEl.classList.toggle('push-error', Boolean(error));
      toggle.hidden = !['on', 'off'].includes(state);
      toggle.textContent = state === 'on' ? 'Turn Off' : 'Turn On Notifications';
      if (testBtn) testBtn.hidden = state !== 'on';
    };

    try {
      render(await status(apiBase));
    } catch (err) {
      render('off');
    }
    container.hidden = false;

    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      try {
        if (current === 'on') {
          await disable(apiBase);
          render('off');
        } else {
          await enable(apiBase);
          render('on');
        }
      } catch (err) {
        render(Notification.permission === 'denied' ? 'blocked' : current, err.message);
      } finally {
        toggle.disabled = false;
      }
    });

    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        testBtn.disabled = true;
        try {
          const { sent } = await post(`${apiBase}/push/test`, 'POST', {});
          statusEl.textContent = sent ? 'Test sent. It should appear in a few seconds.' : 'No devices are signed up yet.';
        } catch (err) {
          statusEl.textContent = err.message;
        } finally {
          testBtn.disabled = false;
        }
      });
    }
  }

  return { supported, status, enable, disable, mount };
})();
