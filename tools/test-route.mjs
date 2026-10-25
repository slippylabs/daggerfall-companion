// Route planner oracle: on random sets of real locations, the planner's total must equal the true
// minimum found by trying every order (both one-way and returning home).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE } from './lib/env.mjs';

globalThis.fetch = async () => { throw new Error('no fetch in test'); };
// import data.js under the same ?v= the planner uses, or it is a second, empty module instance
const ver = readFileSync(join(SITE, 'js/route.js'), 'utf8').match(/data\.js(\?v=\d+)/)[1];
const { data, travelBetween } = await import(`../site/js/data.js${ver}`);
const { planRoute } = await import('../site/js/route.js');
data.locs = JSON.parse(readFileSync(join(SITE, 'data/locations.json'), 'utf8'));
data.climate = new Uint8Array(readFileSync(join(SITE, 'data/climate.bin')));
data.count = data.locs.name.length;

const opts = { transport: 'foot', pace: 'cautious', sleep: 'camp', ship: false };
let seed = 7;
const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
// stay within one region-ish area so trips are realistic: pick around a random town
const near = (c, r) => {
  const out = [];
  for (let i = 0; i < data.count && out.length < 400; i++)
    if (Math.abs(data.locs.px[i] - data.locs.px[c]) < r && Math.abs(data.locs.py[i] - data.locs.py[c]) < r) out.push(i);
  return out;
};
function* perms(a) {
  if (a.length <= 1) { yield a; return; }
  for (let i = 0; i < a.length; i++)
    for (const p of perms([...a.slice(0, i), ...a.slice(i + 1)])) yield [a[i], ...p];
}

let cases = 0, bad = 0;
for (let t = 0; t < 200; t++) {
  const pool = near(rnd(data.count), 40);
  if (pool.length < 9) continue;
  const start = pool[rnd(pool.length)];
  const k = 2 + rnd(6);
  const stops = [];
  while (stops.length < k) { const l = pool[rnd(pool.length)]; if (l !== start && !stops.includes(l)) stops.push(l); }
  // every other trip: some stops must wait for others (a quest's reward after its job)
  const after = stops.map((_, i) => (t % 2 && i > 0 && rnd(2) ? [rnd(i)] : []));
  for (const returnHome of [false, true]) {
    const plan = planRoute(start, stops.map((loc, i) => ({ loc, after: after[i] })), opts, { returnHome });
    const pos = plan.order.map((_, n) => n);
    plan.order.forEach((s, n) => (pos[s] = n));
    if (after.some((a, i) => a.some(j => pos[j] > pos[i]))) { bad++; console.log(`  case ${t}: planner broke an order rule`); }
    let best = Infinity;
    for (const p of perms([...stops.keys()])) {
      if (after.some((a, i) => a.some(j => p.indexOf(j) > p.indexOf(i)))) continue;
      let at = start, total = 0;
      for (const i of p) { total += travelBetween(at, stops[i], opts).minutes; at = stops[i]; }
      if (returnHome) total += travelBetween(at, start, opts).minutes;
      best = Math.min(best, total);
    }
    cases++;
    if (plan.total !== best) { bad++; console.log(`  case ${t}: planner ${plan.total} vs best ${best}`); }
  }
}
console.log(`route planner optimal on ${cases - bad}/${cases} random trips (2-7 stops, one-way and round trip, half with reward-after-job rules)`);
process.exit(bad ? 1 : 0);
