/* ---------- Customers' ratings (Reviews tab) ---------- */
async function loadRatings() {
  try {
    const res = await fetch('/api/admin/ratings');
    if (!res.ok) return;
    const data = await res.json();
    document.getElementById('ratingsAverage').textContent = data.count ? `Average ${data.average} ★ from ${data.count}` : '';
    const body = document.getElementById('ratingsBody');
    body.innerHTML = data.ratings.length ? '' : '<tr><td colspan="5" class="table-empty">No ratings yet. Customers can rate each pickup once it is finished.</td></tr>';
    data.ratings.forEach((r) => {
      const tr = document.createElement('tr');
      [formatDateTime(r.rated_at), `#${r.id} ${r.company_name}`, `${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}`, r.rating_comment || '-'].forEach((value, i) => {
        const td = document.createElement('td');
        td.textContent = value;
        if (i === 2) td.className = r.rating <= 2 ? 'cash-negative' : 'rating-cell';
        tr.appendChild(td);
      });
      const action = document.createElement('td');
      if (r.review_id) {
        action.textContent = 'On the website';
      } else if (r.rating_public && r.rating_comment) {
        const publish = document.createElement('button');
        publish.className = 'view-btn';
        publish.textContent = 'Show on website';
        publish.addEventListener('click', async () => {
          if (!confirm('Show this comment on the home page as a review?')) return;
          const res2 = await fetch(`/api/admin/ratings/${r.id}/publish`, { method: 'POST' });
          if (!res2.ok) alert((await res2.json().catch(() => ({}))).error || 'Could not publish it.');
          loadRatings();
          loadTestimonials(true);
        });
        action.appendChild(publish);
      } else {
        action.textContent = r.rating_comment ? 'Private' : '-';
      }
      tr.appendChild(action);
      body.appendChild(tr);
    });
  } catch (err) {
    // Tried again when the tab is opened.
  }
}
document.querySelector('.tab-btn[data-tab="testimonials"]').addEventListener('click', loadRatings);
window.SELive.on('requests', () => { if (!dashboard.hidden) loadRatings(); });
new MutationObserver(() => { if (!dashboard.hidden) loadRatings(); }).observe(dashboard, { attributes: true, attributeFilter: ['hidden'] });
