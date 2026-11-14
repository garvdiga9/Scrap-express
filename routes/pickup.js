const crypto = require('crypto');
const router = require('express').Router();
const pool = require('../db/pool');
const {
  BUSINESS_TYPES, SCRAP_TYPES, PICKUP_FREQUENCIES, MIN_PICKUP_KG, QUANTITY_UNITS, RULES_VERSION, parseArea, DELIVERY_MODES, SCRAP_LOCATIONS,
} = require('../data/business');
const { parseSite, outsideServiceArea } = require('../lib/location');
const {
  GSTIN_RE, GSTIN_ERROR, PHONE_ERROR, EMAIL_ERROR, cleanPhone, cleanEmail,
} = require('../lib/validation');
const customers = require('../lib/customers');
const spam = require('../lib/spam');
const media = require('../lib/media');
const push = require('../lib/push');
const live = require('../lib/live');
const analytics = require('../lib/analytics');

const OTHER = 'Other';
const MAX_OTHER_LENGTH = 100;
const MAX_COMPANY = 200;

// A number plus a unit ("2", "tonnes") → { quantity, unit, kg }, or null.
function parseQuantity(value, unit) {
  const quantity = Number(value);
  if (!(unit in QUANTITY_UNITS) || value === '' || value == null || !Number.isFinite(quantity) || quantity <= 0) return null;
  return { quantity, unit, kg: quantity * QUANTITY_UNITS[unit] };
}

// 650 → "650 kg", 1250 → "1.25 tonnes"
const formatTotal = (kg) => (kg >= 1000 ? `${+(kg / 1000).toFixed(2)} tonnes` : `${+kg.toFixed(2)} kg`);

// Step 1 of the form: company, phone, scrap types and quantity. Shared by the
// lead (step 1 on its own) and the full request (both steps).
// Returns { companyName, phone, scrapType, quantity, itemQuantities } or { error }.
function parseStepOne(body) {
  const companyName = String(body.companyName ?? '').trim().slice(0, MAX_COMPANY);
  // A business can tick several scrap types. Also accept the older single
  // `scrapType` field so a page cached before this change still submits.
  const submitted = body.scrapTypes ?? body.scrapType;
  const scrapTypes = [...new Set((Array.isArray(submitted) ? submitted : [submitted]).filter(Boolean))];

  if (!companyName || !body.phone || !scrapTypes.length) {
    return { error: 'Company, phone and at least one scrap type are required.' };
  }
  const phone = cleanPhone(body.phone);
  if (!phone) return { error: PHONE_ERROR };
  if (scrapTypes.some((type) => type !== OTHER && !SCRAP_TYPES.includes(type))) {
    return { error: 'Please choose scrap types from the list.' };
  }
  // "Other" is only meaningful with a description, which replaces it in the
  // stored list, e.g. "Other: wooden pallets".
  const chosenTypes = [...scrapTypes];
  if (scrapTypes.includes(OTHER)) {
    const otherText = String(body.otherScrapType ?? '').trim();
    if (!otherText) return { error: 'Please describe the other scrap type.' };
    if (otherText.length > MAX_OTHER_LENGTH) {
      return { error: `Please keep the other scrap description under ${MAX_OTHER_LENGTH} characters.` };
    }
    scrapTypes[scrapTypes.indexOf(OTHER)] = `${OTHER}: ${otherText}`;
  }

  // Quantity: one scrap type → one total; several → a quantity for each,
  // added up. Stored as text such as "2 tonnes", like older entries.
  let totalKg;
  let quantity;
  let itemQuantities = null;
  if (chosenTypes.length > 1) {
    const entries = Array.isArray(body.itemQuantities) ? body.itemQuantities : [];
    itemQuantities = [];
    for (const [i, type] of chosenTypes.entries()) {
      const entry = entries.find((e) => e && e.type === type);
      const q = entry && parseQuantity(entry.quantity, entry.unit);
      if (!q) return { error: `Please enter the quantity for ${type === OTHER ? 'the other scrap' : type}.` };
      itemQuantities.push({
        type: scrapTypes[i], quantity: q.quantity, unit: q.unit, kg: q.kg,
      });
    }
    totalKg = itemQuantities.reduce((sum, item) => sum + item.kg, 0);
    quantity = formatTotal(totalKg);
    itemQuantities = itemQuantities.map(({ kg, ...item }) => item);
  } else {
    const q = parseQuantity(body.quantity, body.quantityUnit);
    if (!q) return { error: 'Please enter the approximate total quantity.' };
    totalKg = q.kg;
    quantity = `${q.quantity} ${q.unit}`;
  }
  if (totalKg < MIN_PICKUP_KG) {
    return { error: `We handle bulk pickups of ${MIN_PICKUP_KG} kg or more${itemQuantities ? ' in total' : ''}.` };
  }
  return {
    companyName, phone, scrapType: scrapTypes.join(', '), quantity, itemQuantities,
  };
}

// Anyone can start a request, so cap new leads per connection.
const LEADS_PER_HOUR = 20;
const recentLeads = new Map();
function tooManyLeads(ip) {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const times = (recentLeads.get(ip) || []).filter((t) => t > hourAgo);
  if (times.length >= LEADS_PER_HOUR) return true;
  times.push(Date.now());
  recentLeads.set(ip, times);
  if (recentLeads.size > 5000) recentLeads.clear();
  return false;
}

const TOKEN_RE = /^[a-f0-9]{48}$/;

// POST /api/pickup/lead - step 1, saved straight away. Sending step 1 again
// with the same token (the customer went back and changed it) updates it.
router.post('/lead', spam.limit('pickup-lead', { max: 40 }), spam.honeypot((req, res) => res.status(201).json({ leadToken: require('crypto').randomBytes(24).toString('hex') })), async (req, res) => {
  const step = parseStepOne(req.body);
  if (step.error) return res.status(400).json({ error: step.error });
  const customerId = (req.session && req.session.customerId) || null;
  const values = [step.companyName, step.phone, step.scrapType, step.quantity,
    step.itemQuantities && JSON.stringify(step.itemQuantities), customerId];
  try {
    const token = String(req.body.leadToken || '');
    if (TOKEN_RE.test(token)) {
      const { rowCount } = await pool.query(
        `UPDATE pickup_leads SET company_name = $1, phone = $2, scrap_type = $3, approx_quantity = $4,
                item_quantities = $5, customer_id = COALESCE($6, customer_id), updated_at = NOW()
         WHERE token = $7 AND completed_at IS NULL`,
        [...values, token]
      );
      if (rowCount) {
        live.publish('requests');
        return res.json({ leadToken: token });
      }
    }
    if (tooManyLeads(req.ip)) {
      return res.status(429).json({ error: 'Too many requests from your connection. Please call us on +91 98188 26333.' });
    }
    const newToken = crypto.randomBytes(24).toString('hex');
    await pool.query(
      `INSERT INTO pickup_leads (company_name, phone, scrap_type, approx_quantity, item_quantities, customer_id, token)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [...values, newToken]
    );
    live.publish('requests');
    analytics.record('lead', analytics.pageFrom(req));
    res.status(201).json({ leadToken: newToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again or call us directly.' });
  }
});

// POST /api/pickup - public: a business sends its bulk scrap pickup request
// (both steps), optionally with photos/videos of the scrap.
router.post('/', spam.limit('pickup', { max: 10 }), media.acceptMedia, spam.honeypot((req, res) => res.status(201).json({ id: 0, message: 'Request received! Our team will call you to confirm the details.' })), async (req, res) => {
  const { businessType, pickupFrequency, notes } = req.body;
  const name = String(req.body.name ?? '').trim().slice(0, 150);

  const step = parseStepOne(req.body);
  if (step.error) return res.status(400).json({ error: step.error });
  const {
    companyName, phone, scrapType, quantity, itemQuantities,
  } = step;
  if (!name) return res.status(400).json({ error: 'Please enter the contact person\'s name.' });
  if (!req.body.acceptTerms) {
    return res.status(400).json({ error: 'Please accept the Pickup Rules. If you don\'t see the tick-box, refresh this page.' });
  }
  const site = parseSite(req.body);
  if (site.error) return res.status(400).json({ error: site.error });
  const { area, error: areaError } = parseArea(req.body.area, req.body.otherArea);
  if (areaError) return res.status(400).json({ error: areaError });
  // Email is optional, but has to be a real address if given.
  const typedEmail = String(req.body.email ?? '').trim();
  const email = typedEmail ? cleanEmail(typedEmail) : null;
  if (typedEmail && !email) return res.status(400).json({ error: EMAIL_ERROR });
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
  // How the scrap reaches us, and (for a pickup) where it's kept.
  const deliveryMode = DELIVERY_MODES.includes(req.body.deliveryMode) ? req.body.deliveryMode : 'pickup';
  const scrapLocation = deliveryMode === 'pickup' && req.body.scrapLocation ? String(req.body.scrapLocation) : null;
  if (scrapLocation && !SCRAP_LOCATIONS.includes(scrapLocation)) {
    return res.status(400).json({ error: 'Please choose where the scrap is kept from the list.' });
  }
  const needsDismantling = deliveryMode === 'pickup' && ['on', 'true', '1', 'yes'].includes(String(req.body.needsDismantling || '').toLowerCase());
  // Photos and videos are recommended (they speed up the quote) but optional.
  const tooFar = await outsideServiceArea(site.pincode);
  if (tooFar) return res.status(400).json({ error: tooFar });

  // Logged-in customers get the request on their account; everyone else can
  // still book without one.
  const customerId = (req.session && req.session.customerId) || null;

  try {
    const { rows } = await pool.query(
      `INSERT INTO pickup_requests
        (company_name, business_type, pickup_frequency, gstin, customer_id,
         name, phone, email, address, area, pincode, scrap_type, approx_quantity, item_quantities, notes,
         latitude, longitude, terms_accepted_at, terms_version,
         delivery_mode, scrap_location, needs_dismantling, office_handled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),$18,$19,$20,$21,$22)
       RETURNING id`,
      [
        companyName, businessType || null, pickupFrequency || null, gstin, customerId,
        name, phone, email, site.address, area || null, site.pincode,
        scrapType, quantity, itemQuantities && JSON.stringify(itemQuantities), notes || null,
        site.latitude, site.longitude, RULES_VERSION,
        // A self drop-off is run by the office: staff never see it.
        deliveryMode, scrapLocation, needsDismantling, deliveryMode === 'self',
      ]
    );
    const requestId = rows[0].id;
    // Step 1's lead is now a full request.
    if (TOKEN_RE.test(String(req.body.leadToken || ''))) {
      await pool.query(
        'UPDATE pickup_leads SET request_id = $1, completed_at = NOW() WHERE token = $2 AND completed_at IS NULL',
        [requestId, req.body.leadToken]
      ).catch((err) => console.error('closing pickup lead failed', err));
    }
    // As with the profile below, the booking is already saved, so a problem
    // recording the attachments is logged rather than reported as a failure.
    const files = await media.saveForRequest(req, 'pickup', requestId)
      .catch((err) => { console.error('saving pickup media failed', err); return 0; });
    live.publish('requests');
    analytics.record('quote_request', analytics.pageFrom(req));
    push.quietly(push.notifyAdmins({
      title: `New ${deliveryMode === 'self' ? 'drop-off' : 'pickup'} request #${requestId} 📦`,
      body: [companyName, quantity, area, deliveryMode === 'self' ? 'customer sends it' : null, needsDismantling ? 'needs taking down' : null, files ? `${files} photo${files === 1 ? '' : 's'}/video${files === 1 ? '' : 's'}` : 'no photos']
        .filter(Boolean).join(' · '),
      url: `/admin.html#pickup-${requestId}`,
      tag: `pickup-${requestId}`,
    }));
    if (customerId) {
      // The booking is already saved; a profile hiccup must not report failure
      // and tempt the customer to submit it twice.
      customers.fillBlankProfile(customerId, {
        name, phone, email, companyName, businessType, gstin, area, ...site,
      }).catch((err) => console.error('fillBlankProfile failed', err))
        .finally(() => {
          live.publishToCustomer(customerId);
          live.publish('customers');
        });
    }
    res.status(201).json({
      id: requestId,
      message: customerId
        ? 'Request received! Your quote will appear in My Account, and our team may call you to confirm the details.'
        : 'Request received! Our team will call you to confirm the details, and send your quote on WhatsApp or email with a link to accept it. No login needed.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again or call us directly.' });
  }
});

module.exports = router;
