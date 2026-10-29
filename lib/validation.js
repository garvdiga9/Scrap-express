const PHONE_RE = /^[0-9+\-\s]{7,15}$/;
// 2-digit state code, 10-char PAN, entity number, "Z", checksum character.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PINCODE_RE = /^[0-9]{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GSTIN_ERROR = 'That GSTIN doesn\'t look right — it should be 15 characters, e.g. 07ABCDE1234F1Z5.';

module.exports = { PHONE_RE, GSTIN_RE, PINCODE_RE, EMAIL_RE, GSTIN_ERROR };
