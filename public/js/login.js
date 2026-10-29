import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, RecaptchaVerifier,
  signInWithPopup, signInWithPhoneNumber, signOut,
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';

const app = document.getElementById('loginApp');
const alertBox = document.getElementById('loginAlert');
const googleBtn = document.getElementById('googleBtn');
const phoneForm = document.getElementById('phoneForm');
const otpForm = document.getElementById('otpForm');
const phoneInput = document.getElementById('loginPhone');
const otpInput = document.getElementById('otpCode');
const sendOtpBtn = document.getElementById('sendOtpBtn');
const verifyOtpBtn = document.getElementById('verifyOtpBtn');

const config = JSON.parse(app.dataset.config);
const next = app.dataset.next || '/account';
const auth = getAuth(initializeApp(config));
auth.languageCode = 'en';

let recaptcha = null;
let confirmation = null;

// Firebase error codes, translated into something a customer can act on.
const MESSAGES = {
  'auth/popup-closed-by-user': 'The Google window was closed before signing in.',
  'auth/cancelled-popup-request': 'The Google window was closed before signing in.',
  'auth/popup-blocked': 'Your browser blocked the Google window. Please allow pop-ups for this site and try again.',
  'auth/invalid-phone-number': 'That mobile number doesn\'t look right. Please check it and try again.',
  'auth/too-many-requests': 'Too many attempts from this device. Please wait a few minutes and try again.',
  'auth/quota-exceeded': 'We can\'t send OTPs right now. Please try again later or log in with Google.',
  'auth/invalid-verification-code': 'That OTP is incorrect. Please check the code and try again.',
  'auth/code-expired': 'That OTP has expired. Please request a new one.',
  'auth/missing-verification-code': 'Please enter the 6-digit OTP.',
  'auth/network-request-failed': 'Network problem. Please check your connection and try again.',
  'auth/unauthorized-domain': 'Login isn\'t enabled for this website address yet. Please contact us.',
  'auth/operation-not-allowed': 'This login method isn\'t switched on yet. Please contact us.',
  'auth/billing-not-enabled': 'Phone login isn\'t available yet. Please log in with Google.',
  'auth/invalid-api-key': 'Login isn\'t set up correctly yet. Please contact us.',
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'Login isn\'t set up correctly yet. Please contact us.',
};

function showError(err) {
  const message = (err && MESSAGES[err.code]) || (err && err.message) || 'Something went wrong. Please try again.';
  alertBox.textContent = message;
  alertBox.className = 'form-alert error';
  alertBox.hidden = false;
}

function busy(button, isBusy, label) {
  button.disabled = isBusy;
  if (label) button.textContent = label;
}

// Hand the verified Firebase identity to our server, which starts a normal
// 30-day login session. Firebase's own sign-in is then dropped so there is
// only one place the login lives.
async function finishLogin(user) {
  const idToken = await user.getIdToken();
  const res = await fetch('/api/customer/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  let data = {};
  try { data = await res.json(); } catch (err) { /* non-JSON error page */ }
  await signOut(auth).catch(() => {});
  if (!res.ok) throw new Error(data.error || 'Could not sign you in. Please try again.');
  window.location.href = next;
}

googleBtn.addEventListener('click', async () => {
  alertBox.hidden = true;
  busy(googleBtn, true);
  try {
    const { user } = await signInWithPopup(auth, new GoogleAuthProvider());
    await finishLogin(user);
  } catch (err) {
    showError(err);
    busy(googleBtn, false);
  }
});

phoneForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertBox.hidden = true;
  const digits = phoneInput.value.replace(/\D/g, '');
  if (!/^[6-9][0-9]{9}$/.test(digits)) {
    showError({ code: 'auth/invalid-phone-number' });
    phoneInput.focus();
    return;
  }

  busy(sendOtpBtn, true, 'Sending OTP…');
  try {
    // Invisible reCAPTCHA is Firebase's built-in protection against bots
    // triggering paid SMS; it only shows a challenge if traffic looks suspicious.
    if (!recaptcha) {
      recaptcha = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
    }
    confirmation = await signInWithPhoneNumber(auth, `+91${digits}`, recaptcha);
    document.getElementById('otpPhoneLabel').textContent = `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
    phoneForm.hidden = true;
    otpForm.hidden = false;
    otpInput.focus();
  } catch (err) {
    showError(err);
    // A used or failed reCAPTCHA can't be reused; start fresh next time.
    if (recaptcha) { recaptcha.clear(); recaptcha = null; }
  } finally {
    busy(sendOtpBtn, false, 'Send OTP');
  }
});

otpForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertBox.hidden = true;
  const code = otpInput.value.replace(/\D/g, '');
  if (code.length !== 6) {
    showError({ code: 'auth/missing-verification-code' });
    otpInput.focus();
    return;
  }

  busy(verifyOtpBtn, true, 'Verifying…');
  try {
    const { user } = await confirmation.confirm(code);
    await finishLogin(user);
  } catch (err) {
    showError(err);
    busy(verifyOtpBtn, false, 'Verify & Log In');
  }
});

document.getElementById('changePhoneBtn').addEventListener('click', () => {
  confirmation = null;
  otpInput.value = '';
  otpForm.hidden = true;
  phoneForm.hidden = false;
  alertBox.hidden = true;
  phoneInput.focus();
});
