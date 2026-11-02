const router = require('express').Router();
const pool = require('../db/pool');
const {
  BUSINESS_TYPES, SCRAP_TYPES, PICKUP_FREQUENCIES, MIN_PICKUP_KG, QUANTITY_UNITS, RULES_VERSION,
} = require('../data/business');
const { parseSite } = require('../lib/location');
const {
  GSTIN_RE, GSTIN_ERROR, PHONE_ERROR, EMAIL_ERROR, cleanPhone, cleanEmail,
} = require('../lib/validation');
const customers = require('../lib/customers');
const media = require('../lib/media');
const push = require('../lib/push');
const live = require('../lib/live');

const OTHER = 'Other';
const MAX_OTHER_LENGTH = 100;

// A number plus a unit ("2", "tonnes") → { quantity, unit, kg }, or null.
function parseQuantity(value, unit) {
  const quantity = Number(value);
  if (!(unit in QUANTITY_UNITS) || value === '' || value == null || !Number.isFinite(quantity) || quantity <= 0) return null;
  return { quantity, unit, kg: quantity * QUANTITY_UNITS[unit] };
}

// 650 → "650 kg", 1250 → "1.25 tonnes"
const formatTotal = (kg) => (kg >= 1000 ? `${+(kg / 1000).toFixed(2)} tonnes` : `${+kg.toFixed(2)} kg`);

// POST /api/pickup - public: a business submits a bulk scrap pickup request,
// optionally with photos/videos of the scrap.
router.post('/', media.acceptMedia, async (req, res) => {
  const {
    companyName, businessType, pickupFrequency,
    name, area, notes,
  } = req.body;

  // A business can tick several scrap types. Also accept the older single
  // `scrapType` field so a page cached before this change still submits.
  const submitted = req.body.scrapTypes ?? req.body.scrapType;
  const scrapTypes = [...new Set((Array.isArray(submitted) ? submitted : [submitted]).filter(Boolean))];

  if (!companyName || !name || !req.body.phone || !scrapTypes.length) {
    return res.status(400).json({ error: 'Company, contact person, phone and at least one scrap type are required.' });
  }
  if (!req.body.acceptTerms) {
    return res.status(400).json({ error: 'Please accept the Pickup Rules. If you don\'t see the tick-box, refresh this page.' });
  }
  const site = parseSite(req.body);
  if (site.error) return res.status(400).json({ error: site.error });
  const phone = cleanPhone(req.body.phone);
  if (!phone) return res.status(400).json({ error: PHONE_ERROR });
  // Email is optional, but has to be a real address if given.
  const typedEmail = String(req.body.email ?? '').trim();
  const email = typedEmail ? cleanEmail(typedEmail) : null;
  if (typedEmail && !email) return res.status(400).json({ error: EMAIL_ERROR });
  if (scrapTypes.some((type) => type !== OTHER && !SCRAP_TYPES.includes(type))) {
    return res.status(400).json({ error: 'Please choose scrap types from the list.' });
  }
  // "Other" is only meaningful with a description, which replaces it in the
  // stored list, e.g. "Other: wooden pallets".
  const chosenTypes = [...scrapTypes];
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

  // Quantity: one scrap type → one total; several → a quantity for each,
  // added up. Stored as text such as "2 tonnes", like older entries.
  let totalKg;
  let quantity;
  let itemQuantities = null;
  if (chosenTypes.length > 1) {
    const entries = Array.isArray(req.body.itemQuantities) ? req.body.itemQuantities : [];
    itemQuantities = [];
    for (const [i, type] of chosenTypes.entries()) {
      const entry = entries.find((e) => e && e.type === type);
      const q = entry && parseQuantity(entry.quantity, entry.unit);
      if (!q) {
        return res.status(400).json({ error: `Please enter the quantity for ${type === OTHER ? 'the other scrap' : type}.` });
      }
      itemQuantities.push({ type: scrapTypes[i], quantity: q.quantity, unit: q.unit, kg: q.kg });
    }
    totalKg = itemQuantities.reduce((sum, item) => sum + item.kg, 0);
    quantity = formatTotal(totalKg);
    itemQuantities = itemQuantities.map(({ kg, ...item }) => item);
  } else {
    const q = parseQuantity(req.body.quantity, req.body.quantityUnit);
    if (!q) return res.status(400).json({ error: 'Please enter the approximate total quantity.' });
    totalKg = q.kg;
    quantity = `${q.quantity} ${q.unit}`;
  }
  if (totalKg < MIN_PICKUP_KG) {
    return res.status(400).json({ error: `We handle bulk pickups of ${MIN_PICKUP_KG} kg or more${itemQuantities ? ' in total' : ''}.` });
  }
  if (businessType &&!BUSINESS_TYPES.includes(businessType)) {
    return res.status(400).json({ error: 'Please choose a business type from the list.' });
  }
  if (pickupFrequency && !PICKUP_FREQUENCIES.includes(pickupFrequency)) {
    return res.status(400).json({ error: 'Please choose a pickup frequency from the list.' });
  }
  const gstin = String(req.body.gstin ?? '').trim().toUpperCase() || null;
  if (gstin && !GSTIN_RE.test(gstin)) {
    return res.status(400).json({ error: GSTIN_ERROR });
  }
  const mediaError = media.missingMediaError(req);
  if (mediaError) return res.status(400).json({ error: mediaError });

  // Logged-in customers get the request on their account; everyone else can
  // still book without one.
  const customerId = (req.session && req.session.customerId) || null;

  try {
    const { rows } = await pool.query(
      `INSERT INTO pickup_requests
        (company_name, business_type, pickup_frequency, gstin, customer_id,
         name, phone, email, address, area, pincode, scrap_type, approx_quantity, item_quantities, notes,
         latitude, longitude, terms_accepted_at, terms_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),$18)
       RETURNING id`,
      [
        companyName, businessType || null, pickupFrequency || null, gstin, customerId,
        name, phone, email, site.address, area || null, site.pincode,
        scrapTypes.join(', '), quantity, itemQuantities && JSON.stringify(itemQuantities), notes || null,
        site.latitude, site.longitude, RULES_VERSION,
      ]
    );
    // As with the profile below, the booking is already saved, so a problem
    // recording the attachments is logged rather than reported as a failure.
    const files = await media.saveForRequest(req, 'pickup', rows[0].id)
      .catch((err) => { console.error('saving pickup media failed', err); return 0; });
    live.publish('requests');
    push.quietly(push.notifyAdmins({
      title: `New pickup request #${rows[0].id} 📦`,
      body: [companyName, quantity, area, files && `${files} photo${files === 1 ? '' : 's'}/video${files === 1 ? '' : 's'}`]
        .filter(Boolean).join(' · '),
      url: `/admin.html#pickup-${rows[0].id}`,
      tag: `pickup-${rows[0].id}`,
    }));
    if (customerId) {
      // The booking is already saved; a profile hiccup must not report failure
      // and tempt the customer to submit it twice.
      customers.fillBlankProfile(customerId, {
        name, phone, email, companyName, businessType, gstin, area, ...site,
      }).catch((err) => console.error('fillBlankProfile failed', err))
        .finally(() => live.publishToCustomer(customerId));
    }
    res.status(201).json({
      id: rows[0].id,
      message: customerId
        ? 'Request received! Your quote will appear in My Account, and our team may call you to confirm the details.'
        : 'Request received! Our team will call you shortly to confirm the details and share a quote.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again or call us directly.' });
  }
});

module.exports = router;
