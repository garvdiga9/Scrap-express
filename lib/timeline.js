// A request's progress as steps for the customer: done (with the date),
// current, or still to come. Built from request_events (db/schema.sql).
const pool = require('../db/pool');

const PICKUP_STEPS = [
  { status: 'pending', label: 'Request received' },
  { status: 'quoted', label: 'Quote sent' },
  { status: 'accepted', label: 'Quote accepted' },
  { status: 'scheduled', label: 'Pickup slot chosen' },
  { status: 'on_way', label: 'Team on the way' },
  { status: 'arrived', label: 'Team arrived' },
  { status: 'weighed', label: 'Scrap weighed' },
  { status: 'completed', label: 'Picked up & paid' },
];
// Statuses that sit at another step: waiting for the customer to choose a
// slot is still "quote accepted"; the two from before slots existed map on.
const SAME_STEP = { slots_sent: 'accepted', ready: 'accepted', confirmed: 'scheduled' };
const DEMOLITION_STEPS = [
  { status: 'pending', label: 'Request received' },
  { status: 'confirmed', label: 'Site visit confirmed' },
  { status: 'completed', label: 'Work completed' },
];
// Where a request can stop early.
const END_LABELS = {
  declined: 'Quote declined',
  no_scrap: 'No scrap at site',
  cancelled: 'Cancelled',
};

async function eventsFor(requestType, requestIds) {
  if (!requestIds.length) return new Map();
  const { rows } = await pool.query(
    `SELECT request_id, status, at FROM request_events
     WHERE request_type = $1 AND request_id = ANY($2) ORDER BY at`,
    [requestType, requestIds]
  );
  const byRequest = new Map();
  rows.forEach((row) => {
    if (!byRequest.has(row.request_id)) byRequest.set(row.request_id, []);
    byRequest.get(row.request_id).push(row);
  });
  return byRequest;
}

// [{ label, state: 'done' | 'current' | 'todo' | 'stopped', at }]
function buildTimeline(kind, request, events = []) {
  const steps = kind === 'pickup' ? PICKUP_STEPS : DEMOLITION_STEPS;
  const lastAt = (status) => {
    const hits = events.filter((e) => e.status === status || SAME_STEP[e.status] === status);
    return hits.length ? hits[hits.length - 1].at : null;
  };
  const stopped = END_LABELS[request.status];
  // How far along the normal path the request got.
  let reached = steps.findIndex((s) => s.status === (SAME_STEP[request.status] || request.status));
  if (stopped) {
    reached = -1;
    steps.forEach((s, i) => { if (lastAt(s.status)) reached = i; });
  }
  const timeline = steps.map((step, i) => {
    let state = 'todo';
    if (i < reached || (i === reached && step.status === 'completed')) state = 'done';
    else if (i === reached) state = stopped ? 'done' : 'current';
    return { label: step.label, state, at: state === 'todo' ? null : lastAt(step.status) };
  });
  if (stopped) {
    // Show the path up to where it stopped, then the stop.
    const shown = timeline.slice(0, Math.max(reached + 1, 1));
    shown.push({ label: stopped, state: 'stopped', at: lastAt(request.status) });
    return shown;
  }
  return timeline;
}

module.exports = { eventsFor, buildTimeline };
