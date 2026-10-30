// "Delete My Account" on the My Account page. The customer confirms with a
// fresh Google sign-in; the server checks that token before deleting, and
// the same fresh sign-in lets us remove their Firebase sign-in record too.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, deleteUser, signOut,
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';

const btn = document.getElementById('deleteAccountBtn');
const alertBox = document.getElementById('deleteAlert');
const LABEL = 'Delete My Account';

const POPUP_MESSAGES = {
  'auth/popup-closed-by-user': 'The Google window was closed, so nothing was deleted.',
  'auth/cancelled-popup-request': 'The Google window was closed, so nothing was deleted.',
  'auth/popup-blocked': 'Your browser blocked the Google window. Please allow pop-ups for this site and try again.',
  'auth/network-request-failed': 'Network problem. Please check your connection and try again.',
};

if (btn) {
  btn.addEventListener('click', async () => {
    if (!window.confirm('Delete your Scrap Express account permanently? This cannot be undone.')) return;
    alertBox.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Confirm with Google…';

    const auth = getAuth(initializeApp(JSON.parse(btn.dataset.config), 'account-delete'));
    try {
      const { user } = await signInWithPopup(auth, new GoogleAuthProvider());
      btn.textContent = 'Deleting…';
      const res = await fetch('/api/customer/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: await user.getIdToken(true) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        await signOut(auth).catch(() => {});
        throw new Error(data.error || 'Could not delete your account. Please try again or contact us.');
      }
      // Our records are gone; now remove the sign-in record at Firebase.
      await deleteUser(user).catch(() => signOut(auth).catch(() => {}));
      window.location.href = '/delete-account?done=1';
    } catch (err) {
      alertBox.textContent = POPUP_MESSAGES[err.code] || err.message;
      alertBox.hidden = false;
      btn.disabled = false;
      btn.textContent = LABEL;
    }
  });
}
