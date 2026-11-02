// Site address helpers: fills the city and state from the pincode, and offers
// "Use my current location" for customers standing at the site. Everything
// stays editable, and typing the address by hand always works.
document.querySelectorAll('[data-location]').forEach((box) => {
  const form = box.closest('form');
  const find = (selector) => box.querySelector(selector);
  const pincode = find('[data-pincode]');
  const pincodeNote = find('[data-pincode-note]');
  const city = find('[data-city]');
  const state = find('[data-state]');
  const street = find('[data-street]');

  async function getJson(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Please type the address.');
    return data;
  }

  // Values filled in for the customer can be replaced by a later lookup, but
  // never anything they typed themselves.
  const fill = (field, value) => {
    if (value && (!field.value.trim() || field.dataset.autoFilled === field.value)) {
      field.value = value;
      field.dataset.autoFilled = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  // Shows straight away that this pincode is too far away, and stops the
  // form sending (validate.js) before any photos are uploaded.
  function setOutside(message) {
    const was = pincode.dataset.outside;
    if (message) pincode.dataset.outside = message;
    else delete pincode.dataset.outside;
    if (message || was) window.SEValidate.checkField(pincode);
  }

  let lookupFor = '';
  async function lookUpPincode() {
    const value = pincode.value.trim();
    pincodeNote.hidden = true;
    if (!/^[1-9]\d{5}$/.test(value)) {
      lookupFor = '';
      setOutside(null);
      return;
    }
    if (value === lookupFor) return;
    lookupFor = value;
    setOutside(null);
    try {
      const data = await getJson(`/api/location/pincode/${value}`);
      if (lookupFor !== value) return;
      if ('serviceArea' in box.dataset) setOutside(data.outside);
      if (data.found) {
        fill(city, data.city);
        fill(state, data.state);
      } else {
        pincodeNote.textContent = "We couldn't find this pincode. Please double-check it.";
        pincodeNote.hidden = false;
      }
    } catch (err) {
      /* the lookup is only a helper: the customer can type the city and state */
    }
  }
  pincode.addEventListener('input', () => {
    pincode.value = pincode.value.replace(/\D/g, '');
    lookUpPincode();
  });
  if (pincode.value && (!city.value || 'serviceArea' in box.dataset)) lookUpPincode();

  /* ---------- Use my current location ---------- */
  const gps = find('[data-gps]');
  if (!gps) return;
  if (!navigator.geolocation) return;
  gps.hidden = false;

  const button = find('[data-gps-button]');
  const label = find('[data-gps-label]');
  const status = find('[data-gps-status]');
  const pin = find('[data-pin]');
  const pinLink = find('[data-pin-link]');
  const credit = find('[data-gps-credit]');
  const latitude = find('[data-latitude]');
  const longitude = find('[data-longitude]');
  // Beyond this, the pin is more likely a nearby tower or Wi-Fi than the site.
  const ROUGH_METRES = 200;

  function setStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle('error', Boolean(isError));
    status.hidden = !message;
  }

  function removePin() {
    latitude.value = '';
    longitude.value = '';
    pin.hidden = true;
    credit.hidden = true;
    label.textContent = 'Use my current location';
    setStatus('');
  }
  find('[data-pin-remove]').addEventListener('click', removePin);
  form.addEventListener('reset', () => {
    removePin();
    lookupFor = '';
    delete pincode.dataset.outside;
    pincodeNote.hidden = true;
    [street, city, state, pincode].forEach((field) => { delete field.dataset.autoFilled; });
  });

  const GPS_ERRORS = {
    1: 'Location is turned off for this site. Allow it in your browser, or type the address below.',
    2: "We couldn't find your location. Please type the address below.",
    3: 'Finding your location took too long. Please try again, or type the address below.',
  };

  button.addEventListener('click', () => {
    button.disabled = true;
    setStatus('Finding your location…');
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      latitude.value = coords.latitude.toFixed(6);
      longitude.value = coords.longitude.toFixed(6);
      pinLink.href = `https://www.google.com/maps?q=${latitude.value},${longitude.value}`;
      pin.hidden = false;
      label.textContent = 'Update my location';
      const rough = coords.accuracy > ROUGH_METRES;
      let filled = true;
      try {
        const place = await getJson(`/api/location/reverse?latitude=${latitude.value}&longitude=${longitude.value}`);
        fill(street, place.street);
        fill(pincode, place.pincode);
        fill(city, place.city);
        fill(state, place.state);
        credit.hidden = false;
      } catch (err) {
        filled = false;
      }
      setStatus([
        filled ? 'Location pinned. Please add your building, and check the address and pincode.' : 'Location pinned. Please type the address below.',
        rough && `This pin may be off by about ${Math.round(coords.accuracy)} m, so please check it on the map.`,
      ].filter(Boolean).join(' '));
      button.disabled = false;
    }, (err) => {
      setStatus(GPS_ERRORS[err.code] || GPS_ERRORS[2], true);
      button.disabled = false;
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });
});
