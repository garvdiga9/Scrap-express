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
  'Hotel / Restaurant',
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

module.exports = { AREAS, BUSINESS_TYPES, SCRAP_TYPES, PICKUP_FREQUENCIES };
