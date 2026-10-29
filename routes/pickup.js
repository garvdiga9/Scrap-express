const router = require('express').Router();
const pool = require('../db/pool');
const { BUSINESS_TYPES, SCRAP_TYPES, PICKUP_FREQUENCIES } = require('../data/business');
const { PHONE_RE, GSTIN_RE, GSTIN_ERROR } = require('../lib/validation');
const customers = require('../lib/customers');

const OTHER = 'Other';
const MAX_OTHER_LENGTH = 100;

// POST /api/pickup - public: a business submits a bulk scrap pickup request
router.post('/', async (req, res) => {
  const {
    companyName, businessType, pickupFrequency,
    name, phone, email, address, area, pincode,
    quantity, preferredDate, notes,
  } = req.body;

  // A business can tick several scrap types. Also accept the older single
  // `scrapType` field so a page cached before this change still submits.
  const submitted = req.body.scrapTypes ?? req.body.scrapType;
  const scrapTypes = [...new Set((Array.isArray(submitted) ? submitted : [submitted]).filter(Boolean))];

  if (!companyName || !name || !phone || !address || !scrapTypes.length) {
    return res.status(400).json({ error: 'Company, contact person, phone, site address and at least one scrap type are required.' });
  }
  if (scrapTypes.some((type) => type !== OTHER && !SCRAP_TYPES.includes(type))) {
    return res.status(400).json({ error: 'Please choose scrap types from the list.' });
  }
  // "Other" is only meaningful with a description, which replaces it in the
  // stored list, e.g. "Other: wooden pallets".
  if (scrapTypes.includes(OTHER)) {
    const otherText = String(req.body.otherScrapType ?? '').trim();
    if (!otherText) {
      return res.status(400).json({ error: 'Please describe the other scrap type.' });
    }
    if (otherText.length > MAX_OTHER_LENGTH) {
      return res.status(400).json({ error: `Please keep the other scrap description under ${MAX_OTHER_LENGTH} characters.` });
    }
    scrapTypes[scrapTypes.indexOf(OTHER)] = `${OTHER}: ${otherText}`;
  }
  if (!PHONE_RE.test(phone)) {
    return res.status(400).json({ error: 'Please enter a valid phone number.' });
  }
  if (businessType && !BUSINESS_TYPES.includes(businessType)) {
    return res.status(400).json({ error: 'Please choose a business type from the list.' });
  }
  if (pickupFrequency && !PICKUP_FREQUENCIES.includes(pickupFrequency)) {
    return res.status(400).json({ error: 'Please choose a pickup frequency from the list.' });
  }
  const gstin = String(req.body.gstin ?? '').trim().toUpperCase() || null;
  if (gstin && !GSTIN_RE.test(gstin)) {
    return res.status(400).json({ error: GSTIN_ERROR });
  }

  // Logged-in customers get the request on their account; everyone else can
  // still book without one.
  const customerId = (req.session && req.session.customerId) || null;

  try {
    const { rows } = await pool.query(
      `INSERT INTO pickup_requests
        (company_name, business_type, pickup_frequency, gstin, customer_id,
         name, phone, email, address, area, pincode, scrap_type, approx_quantity, preferred_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        companyName, businessType || null, pickupFrequency || null, gstin, customerId,
        name, phone, email || null, address, area || null, pincode || null,
        scrapTypes.join(', '), quantity || null, preferredDate || null, notes || null,
      ]
    );
    if (customerId) {
      // The booking is already saved; a profile hiccup must not report failure
      // and tempt the customer to submit it twice.
      customers.fillBlankProfile(customerId, {
        name, phone, email, companyName, businessType, gstin, address, area, pincode,
      }).catch((err) => console.error('fillBlankProfile failed', err));
    }
    res.status(201).json({
      id: rows[0].id,
      message: 'Request received! Our team will call you shortly to confirm the details and share a quote.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again or call us directly.' });
  }
});

module.exports = router;
