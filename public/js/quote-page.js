// The private quote link: stays up to date by itself, like My Account.
const { token } = document.currentScript.dataset;

async function refreshQuote() {
  const res = await fetch(window.location.pathname);
  // The request was deleted, or the link stopped working: the page says so.
  if (!res.ok) {
    window.location.reload();
    return;
  }
  const page = new DOMParser().parseFromString(await res.text(), 'text/html');
  const block = document.getElementById('quoteDetails');
  const fresh = page.getElementById('quoteDetails');
  if (fresh && fresh.innerHTML !== block.innerHTML) block.innerHTML = fresh.innerHTML;
}

// These load with the footer, after this script, so wait for the page.
document.addEventListener('DOMContentLoaded', () => {
  window.SEQuote.wire(document.getElementById('quoteDetails'), refreshQuote);
  window.SELive.on('quote', refreshQuote);
  window.SELive.start(`?quote=${token}`);
});
