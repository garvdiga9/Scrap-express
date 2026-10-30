// Shared by the page templates (form dropdowns, Areas page) and the API's
// validation, so the two can never drift apart.

const AREAS = [
  'Okhla Industrial Area',
  'Naraina Industrial Area',
  'Mayapuri Industrial Area',
  'Wazirpur Industrial Area',
  'Bawana Industrial Area',
  'Narela Industrial Area',
  'Mundka',
  'Patparganj Industrial Area',
  'Badli Industrial Area',
  'Kirti Nagar',
  'Jhilmil Industrial Area',
  'Mohan Cooperative Industrial Estate',
  'Nehru Place',
  'Connaught Place',
  'Jasola',
  'Noida',
  'Greater Noida',
  'Gurugram - Udyog Vihar',
  'Manesar',
  'Faridabad',
  'Ghaziabad - Sahibabad',
];

const BUSINESS_TYPES = [
  'Factory / Manufacturing Unit',
  'Office / IT Park',
  'Hospital / Clinic',
  'School / College / Institution',
  'Mall / Retail Store',
  'Hotel / Banquet Hall',
  'Restaurant / Café / Food Chain',
  'Warehouse',
  'Construction / Renovation Site',
  'Other',
];

const SCRAP_TYPES = [
  'Paper & Cardboard',
  'Plastic',
  'Iron & Steel',
  'Copper / Brass / Aluminium',
  'E-Waste & IT Equipment',
  'AC, Fridge & Cooling Equipment',
  'Generators & Motors',
  'Furniture & Fixtures',
  'Mixed Industrial / Office Scrap',
];

const PICKUP_FREQUENCIES = [
  'One-time clearance',
  'Weekly',
  'Fortnightly',
  'Monthly',
  'Not sure yet',
];

// Bulk pickups only: smaller lots aren't worth a truck trip.
const MIN_PICKUP_KG = 300;
const QUANTITY_UNITS = { kg: 1, tonnes: 1000 };

// A pickup request's life: received → quote sent → customer accepts or
// declines → pickup confirmed → completed (or cancelled at any point).
// public/js/admin.js keeps the same lists for the dashboard.
const PICKUP_STATUSES = ['pending', 'quoted', 'accepted', 'declined', 'confirmed', 'completed', 'cancelled'];
const QUOTE_UNITS = ['per kg', 'per tonne', 'per piece', 'lump sum'];

// "₹18 per kg", "₹18.50 per kg", "₹1,50,000 lump sum"
function formatQuoteRate({ rate, unit }) {
  const n = Number(rate);
  const digits = Number.isInteger(n) ? 0 : 2;
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`;
}

module.exports = {
  AREAS, BUSINESS_TYPES, SCRAP_TYPES, PICKUP_FREQUENCIES, MIN_PICKUP_KG, QUANTITY_UNITS,
  PICKUP_STATUSES, QUOTE_UNITS, formatQuoteRate,
};
