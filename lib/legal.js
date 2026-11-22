// The business's legal details, set by the owner in Admin → Team → Legal
// details and shown on the Legal Info, Grievance and Recycling Partners pages:
// legal entity name, GSTIN, Udyam / DPIIT numbers, the Grievance Officer, the
// registered recyclers we hand e-waste, batteries and plastic to, and the
// weighing scale's Legal Metrology stamping certificate.
// Nothing here is ever made up: a detail that hasn't been filled in is simply
// not shown, and the owner's to-do list asks for it.
const fsp = require('fs/promises');
const path = require('path');
const settings = require('./settings');
const { cleanPhone } = require('./validation');

const KEY = 'legal';
const RECYCLER_TYPES = ['E-waste', 'Batteries', 'Plastic', 'Paper', 'Metal', 'Other'];
const MAX_RECYCLERS = 20;

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const UDYAM_RE = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Always the same shape, whatever is stored.
function normalize(v = {}) {
  const o = v.officer || {};
  return {
    entityName: str(v.entityName, 150),
    gstin: str(v.gstin, 15).toUpperCase(),
    udyam: str(v.udyam, 30).toUpperCase(),
    dpiit: str(v.dpiit, 30).toUpperCase(),
    // Working days in which bank transfers to customers are made (Terms of Use).
    bankDays: Number.isInteger(Number(v.bankDays)) && Number(v.bankDays) >= 1 && Number(v.bankDays) <= 30 ? Number(v.bankDays) : null,
    officer: {
      name: str(o.name, 100), designation: str(o.designation, 100), email: str(o.email, 200), phone: str(o.phone, 20),
    },
    recyclers: (Array.isArray(v.recyclers) ? v.recyclers : []).slice(0, MAX_RECYCLERS).map((r) => ({
      name: str(r.name, 150),
      type: RECYCLER_TYPES.includes(r.type) ? r.type : 'Other',
      regNo: str(r.regNo, 80),
      validTill: DATE_RE.test(r.validTill || '') ? r.validTill : '',
    })).filter((r) => r.name),
    certificate: v.certificate && v.certificate.fileName ? {
      fileName: path.basename(v.certificate.fileName),
      mime: str(v.certificate.mime, 40),
      number: str(v.certificate.number, 60),
      validTill: DATE_RE.test(v.certificate.validTill || '') ? v.certificate.validTill : '',
      uploadedAt: v.certificate.uploadedAt || null,
    } : null,
  };
}

async function get() {
  const stored = await settings.get(KEY, null).catch(() => null);
  return normalize(stored || {});
}

// Checks the owner's form; returns { error } or { value } (certificate kept as is).
function validate(input, current) {
  const v = normalize({ ...input, certificate: current.certificate });
  if (v.gstin && !GSTIN_RE.test(v.gstin)) return { error: 'The GSTIN should be 15 characters, like 07ABCDE1234F1Z5.' };
  if (v.udyam && !UDYAM_RE.test(v.udyam)) return { error: 'The Udyam number should look like UDYAM-DL-01-0000000.' };
  if (v.officer.email && !EMAIL_RE.test(v.officer.email)) return { error: "The Grievance Officer's email doesn't look right." };
  if (v.officer.phone) {
    const phone = cleanPhone(v.officer.phone);
    if (!phone) return { error: "The Grievance Officer's phone should be a 10-digit mobile or a landline with its STD code." };
    v.officer.phone = phone;
  }
  const noReg = v.recyclers.find((r) => !r.regNo);
  if (noReg) return { error: `Please add the registration number for ${noReg.name}.` };
  return { value: v };
}

async function save(input) {
  const current = await get();
  const checked = validate(input, current);
  if (checked.error) return checked;
  await settings.set(KEY, checked.value);
  return checked;
}

async function setCertificate(doc, { number, validTill }) {
  const current = await get();
  const old = current.certificate;
  current.certificate = {
    fileName: doc.fileName, mime: doc.mime, number: str(number, 60), validTill: DATE_RE.test(validTill || '') ? validTill : '', uploadedAt: new Date().toISOString(),
  };
  await settings.set(KEY, current);
  return old;
}

async function removeCertificate() {
  const current = await get();
  const old = current.certificate;
  current.certificate = null;
  await settings.set(KEY, current);
  return old;
}

// What the owner still has to fill in (for the to-do list).
function missing(v) {
  const out = [];
  if (!v.entityName) out.push('legal entity name');
  if (!v.gstin) out.push('GSTIN');
  if (!v.officer.name || !v.officer.email || !v.officer.phone) out.push('Grievance Officer');
  if (!v.recyclers.length) out.push('recycling partners');
  if (!v.certificate) out.push('scale stamping certificate');
  if (!v.bankDays) out.push('bank transfer days');
  return out;
}

const DOCS_DIR = () => require('./documents').DOCS_DIR;
async function deleteFile(fileName) {
  if (fileName) await fsp.unlink(path.join(DOCS_DIR(), path.basename(fileName))).catch(() => {});
}

module.exports = {
  RECYCLER_TYPES, get, save, setCertificate, removeCertificate, missing, deleteFile, DOCS_DIR,
};
