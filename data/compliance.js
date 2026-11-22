// What we never buy, and which materials go only to a registered recycler.
// Shown on the Terms of Use, Pickup Rules and What We Buy pages.

// Never bought, whoever offers them: unsafe, regulated, or very likely to be
// public property or stolen. The crew refuses them at the site.
const NOT_ACCEPTED = [
  { item: 'Hazardous, toxic or biomedical waste', detail: 'chemicals, used oil, asbestos, paint or solvent drums with residue, hospital and medical waste' },
  { item: 'Gas cylinders, explosives and anything flammable', detail: 'unless the cylinder is empty, cut open and certified safe' },
  { item: 'Manhole covers and drain gratings', detail: 'they are public property' },
  { item: 'Electricity, power and telecom cables and fittings', detail: 'from poles, substations, towers or exchanges, or marked as belonging to a utility' },
  { item: 'Water meters and public water or gas fittings', detail: 'meters, valves and pipes of a utility' },
  { item: 'Metro, railway and road fittings', detail: 'rails, clips, sleepers, signals, crash barriers, signboards and other public property' },
  { item: 'Vehicle parts without proof of ownership', detail: 'engines, chassis and body parts need the owner\'s papers; number plates are never bought' },
  { item: 'Anything stolen, or that you may not sell', detail: 'we report suspected stolen goods to the police' },
];

// Materials we hand only to a recycler registered with the pollution control
// board. A rate is matched by its name; the label shows only when the owner
// has listed a registered recycler of that type (Admin → Team → Legal details).
const RECYCLER_HANDLED = [
  { type: 'Batteries', match: /batter(y|ies)|inverter/i },
  { type: 'E-waste', match: /e-?waste|computer|cpu|laptop|monitor|ups\b|pcb|server|printer|mobile|electronic|motherboard|hard disk/i },
];

// 'E-waste' / 'Batteries' / null for a rate or category name.
function recyclerTypeFor(name) {
  const hit = RECYCLER_HANDLED.find((r) => r.match.test(String(name || '')));
  return hit ? hit.type : null;
}

module.exports = { NOT_ACCEPTED, RECYCLER_HANDLED, recyclerTypeFor };
