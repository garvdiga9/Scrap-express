/* ---------- Install the admin as its own app ----------
   Chrome and Edge (phone and laptop) offer an install prompt; the button
   shows it. On iPhone/iPad there is no prompt, so the button explains the
   Share → Add to Home Screen steps. Hidden once it's running as an app. */
(() => {
  const button = document.getElementById('installAdminBtn');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) return;
  let promptEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    promptEvent = e;
    button.hidden = false;
  });
  window.addEventListener('appinstalled', () => { button.hidden = true; });
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIos) button.hidden = false;
  button.addEventListener('click', async () => {
    if (promptEvent) {
      promptEvent.prompt();
      await promptEvent.userChoice.catch(() => {});
      promptEvent = null;
      button.hidden = true;
    } else if (isIos) {
      alert('To install: tap the Share button in Safari, then "Add to Home Screen".');
    }
  });
})();
