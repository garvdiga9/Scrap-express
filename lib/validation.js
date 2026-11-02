// 2-digit state code, 10-char PAN, entity number, "Z", checksum character.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PINCODE_RE = /^[0-9]{6}$/;
// Same rules as public/js/validate.js, which checks forms in the browser.
const EMAIL_RE = /^[a-z0-9_%+'-]+(\.[a-z0-9_%+'-]+)*@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
const MAX_EMAIL_LENGTH = 200;
// The form's own example, and the classic made-up number.
const FAKE_NUMBERS = new Set(['9876543210', '9123456789']);

const GSTIN_ERROR = 'That GSTIN doesn\'t look right — it should be 15 characters, e.g. 07ABCDE1234F1Z5.';
const PHONE_ERROR = 'Please enter a valid 10-digit mobile number, or a landline with its area code.';
const EMAIL_ERROR = 'Please enter a valid email address, e.g. name@company.com.';

// A 10-digit Indian mobile, however it was typed ("+91 98188 26333"), or a
// landline with its area code ("011 2345 6789"). Returns just the digits, or
// null if it isn't a real-looking number.
function cleanPhone(value) {
  const text = String(value ?? '').trim();
  if (!/^[+\d\s().-]+$/.test(text)) return null;
  const digits = text.replace(/\D/g, '');
  const local = digits.replace(/^(91(?=\d{10}$)|0(?=[6-9]\d{9}$))/, '');
  const lastTen = local.slice(-10);
  if (/^(\d)\1+$/.test(lastTen) || FAKE_NUMBERS.has(lastTen)) return null;
  return /^[6-9]\d{9}$/.test(local) || /^0[1-8]\d{9}$/.test(local) ? local : null;
}

// As above, but only numbers that can get a WhatsApp message.
function cleanMobile(value) {
  const phone = cleanPhone(value);
  return phone && !phone.startsWith('0') ? phone : null;
}

function cleanEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(email) ? email : null;
}

module.exports = {
  GSTIN_RE, PINCODE_RE, GSTIN_ERROR, PHONE_ERROR, EMAIL_ERROR, cleanPhone, cleanMobile, cleanEmail,
};
