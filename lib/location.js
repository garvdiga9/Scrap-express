// Site addresses: reading the separate form fields, and the free lookups behind
// the pincode auto-fill (India Post data) and the "Use my current location"
// button (OpenStreetMap). Both lookups are optional helpers: when they're down,
// customers simply type the address.
const { PINCODE_RE } = require('./validation');
const { SERVICE_KM } = require('../data/business');

const LOOKUP_TIMEOUT_MS = 5000;
const MAX_CACHED = 2000;
// OpenStreetMap's free service allows one request a second and asks to be told who's calling.
const NOMINATIM_GAP_MS = 1100;
const { BRAND } = require('./brand');

const USER_AGENT = `${BRAND.name.replace(/\s+/g, '')}/1.0 (${BRAND.email})`;
// A rough box around India, to ignore nonsense coordinates.
const INDIA = { minLat: 6, maxLat: 38, minLng: 68, maxLng: 98 };
// The box around Delhi, standing in for its boundary when measuring distance.
const DELHI = { minLat: 28.40, maxLat: 28.88, minLng: 76.84, maxLng: 77.35 };
// A pincode covers a whole area, and its map position is approximate, so give
// places near the limit the benefit of the doubt.
const SERVICE_MARGIN_KM = 5;

const clean = (value, max) => String(value ?? '').trim().slice(0, max);

function parseCoordinates(body) {
  const lat = Number(body.latitude);
  const lng = Number(body.longitude);
  if (!body.latitude || !body.longitude || !Number.isFinite(lat) || !Number.isFinite(lng)) return { latitude: null, longitude: null };
  if (lat < INDIA.minLat || lat > INDIA.maxLat || lng < INDIA.minLng || lng > INDIA.maxLng) return { latitude: null, longitude: null };
  return { latitude: lat, longitude: lng };
}

// The separate address fields → those fields plus `address`, one line for the
// driver and the admin. Returns { error } if something's missing or wrong.
function parseSite(body, { required = true } = {}) {
  const site = {
    building: clean(body.building, 150),
    street: clean(body.street, 300),
    landmark: clean(body.landmark, 150),
    pincode: clean(body.pincode, 10),
    city: clean(body.city, 100),
    state: clean(body.state, 100),
    ...parseCoordinates(body),
  };
  if (required && !(site.building && site.street && site.pincode && site.city && site.state)) {
    return { error: 'Please fill in the building, street, pincode, city and state of the site.' };
  }
  if (site.pincode && !PINCODE_RE.test(site.pincode)) {
    return { error: 'Please enter a valid 6-digit pincode.' };
  }
  const place = [site.city, [site.state, site.pincode].filter(Boolean).join(' ')].filter(Boolean);
  site.address = [site.building, site.street, site.landmark && `Landmark: ${site.landmark}`, ...place].filter(Boolean).join(', ');
  return site;
}

function remember(cache, key, value) {
  if (cache.size >= MAX_CACHED) cache.clear();
  cache.set(key, value);
}

// '110020' → { found: true, city, state } or { found: false }. Throws if the
// lookup service can't be reached.
const pincodes = new Map();
async function lookupPincode(pincode) {
  if (pincodes.has(pincode)) return pincodes.get(pincode);
  const res = await fetch(`https://api.postalpincode.in/pincode/${pincode}`, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`pincode lookup ${res.status}`);
  const [answer] = await res.json();
  const office = answer && answer.Status === 'Success' && answer.PostOffice && answer.PostOffice[0];
  const result = office ? { found: true, city: office.District, state: office.State } : { found: false };
  remember(pincodes, pincode, result);
  return result;
}

let nextNominatimAt = 0;
async function askNominatim(path) {
  const now = Date.now();
  const wait = Math.max(0, nextNominatimAt - now);
  nextNominatimAt = Math.max(now, nextNominatimAt) + NOMINATIM_GAP_MS;
  if (wait) await new Promise((resolve) => { setTimeout(resolve, wait); });
  const res = await fetch(`https://nominatim.openstreetmap.org/${path}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OpenStreetMap ${res.status}`);
  return res.json();
}

// Straight-line kilometres between two points.
function distanceKm(lat1, lng1, lat2, lng2) {
  const rad = (degrees) => (degrees * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

const pincodeDistances = new Map();
// Roughly how far a pincode is from Delhi's boundary, or null if the map
// doesn't know it. Throws if the map can't be reached.
async function kmFromDelhi(pincode) {
  if (pincodeDistances.has(pincode)) return pincodeDistances.get(pincode);
  const [place] = await askNominatim(`search?format=jsonv2&limit=1&country=in&postalcode=${pincode}`);
  let km = null;
  if (place) {
    const lat = Number(place.lat);
    const lng = Number(place.lon);
    const nearestLat = Math.min(Math.max(lat, DELHI.minLat), DELHI.maxLat);
    const nearestLng = Math.min(Math.max(lng, DELHI.minLng), DELHI.maxLng);
    km = Math.round(distanceKm(lat, lng, nearestLat, nearestLng));
  }
  remember(pincodeDistances, pincode, km);
  return km;
}

// The reason a site's pincode is too far away, or null. Customers aren't
// turned away because a lookup failed or doesn't know their pincode.
async function outsideServiceArea(pincode) {
  try {
    const km = await kmFromDelhi(pincode);
    if (km === null || km <= SERVICE_KM + SERVICE_MARGIN_KM) return null;
    return `We work within ${SERVICE_KM} km of Delhi's boundary, and this pincode looks about ${km} km away. If you think that's wrong, please call us on +91 98188 26333.`;
  } catch (err) {
    console.error('service area check failed:', err.message);
    return null;
  }
}

const places = new Map();
// Coordinates → the parts of an address that a map can know. The customer
// still adds the building, and can correct the rest.
async function reverseGeocode(lat, lng) {
  // About 10 metres, so nearby customers share a cached answer.
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (places.has(key)) return places.get(key);
  const { address: a = {} } = await askNominatim(`reverse?format=jsonv2&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`);
  const locality = a.industrial || a.neighbourhood || a.quarter || a.suburb || a.city_district;
  // Some roads are only mapped in Hindi; keep the suggested address in one script.
  const inEnglish = (text) => /^[\x20-\x7e]+$/.test(text || '');
  const result = {
    street: [a.road, locality].filter(inEnglish).join(', '),
    city: a.city || a.town || a.state_district || a.county || a.village || '',
    state: a.state || '',
    pincode: PINCODE_RE.test(a.postcode || '') ? a.postcode : '',
  };
  remember(places, key, result);
  return result;
}

module.exports = {
  parseSite, parseCoordinates, lookupPincode, reverseGeocode, outsideServiceArea,
};
