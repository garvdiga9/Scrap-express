// Checks phone and email fields as customers fill in a form, so they can fix a
// typo before sending. The server checks again (lib/validation.js, same rules).
window.SEValidate = (() => {
  const EMAIL_RE = /^[a-z0-9_%+'-]+(\.[a-z0-9_%+'-]+)*@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
  const FAKE_NUMBERS = ['9876543210', '9123456789'];

  function phoneOk(value) {
    if (!/^[+\d\s().-]+$/.test(value)) return false;
    const local = value.replace(/\D/g, '').replace(/^(91(?=\d{10}$)|0(?=[6-9]\d{9}$))/, '');
    const lastTen = local.slice(-10);
    if (/^(\d)\1+$/.test(lastTen) || FAKE_NUMBERS.includes(lastTen)) return false;
    return /^[6-9]\d{9}$/.test(local) || /^0[1-8]\d{9}$/.test(local);
  }

  const RULES = {
    tel: { ok: phoneOk, message: 'Please enter a valid 10-digit mobile number, or a landline with its area code.' },
    email: { ok: (value) => value.length <= 200 && EMAIL_RE.test(value), message: 'Please enter a valid email address, e.g. name@company.com.' },
  };

  function setError(field, message) {
    const group = field.closest('.form-group');
    let error = group.querySelector('.field-error');
    if (!message) {
      field.classList.remove('field-invalid');
      field.removeAttribute('aria-invalid');
      if (error) error.remove();
      return;
    }
    if (!error) {
      error = document.createElement('small');
      error.className = 'field-error';
      error.setAttribute('role', 'alert');
      group.appendChild(error);
    }
    error.textContent = message;
    field.classList.add('field-invalid');
    field.setAttribute('aria-invalid', 'true');
  }

  // Blank is fine here: forms already ask for the fields they require.
  function checkField(field) {
    const value = field.value.trim();
    const rule = RULES[field.type];
    const ok = !value || rule.ok(value);
    setError(field, ok ? null : rule.message);
    return ok;
  }

  const fieldsOf = (form) => [...form.querySelectorAll('input[type="tel"], input[type="email"]')];

  // Shows every problem and takes the customer to the first one.
  function checkForm(form) {
    const invalid = fieldsOf(form).filter((field) => !checkField(field));
    if (!invalid.length) return true;
    invalid[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    invalid[0].focus({ preventScroll: true });
    return false;
  }

  document.querySelectorAll('.book-form, #profileForm').forEach((form) => {
    fieldsOf(form).forEach((field) => {
      field.addEventListener('blur', () => checkField(field));
      // Clear the message as soon as the typing fixes it.
      field.addEventListener('input', () => {
        if (field.classList.contains('field-invalid')) checkField(field);
      });
    });
    form.addEventListener('reset', () => fieldsOf(form).forEach((field) => setError(field, null)));
  });

  return { checkForm };
})();
