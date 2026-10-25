// Checks the built data against DFO Online's own modules and against names seen in the real game.
// Exit code 1 on any failure.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dfo, loadMaps, SITE } from './lib/env.mjs';
import * as core from '../site/js/vendor/travelCore.js';

let pass = 0, fail = 0;
const check = (ok, what) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); };
const load = rel => JSON.parse(readFileSync(join(SITE, rel), 'utf8'));

const maps = await loadMaps();
const travel = await dfo('src/systems/travel/travel.js');
const locs = load('data/locations.json');
const climate = new Uint8Array(readFileSync(join(SITE, 'data/climate.bin')));
const climateAt = (x, y) => climate[y * 1000 + x];

// 1. Travel parity: the shipped travel core on climate.bin == DFO's calculateTravelTime on CLIMATE.PAK
{
  let seed = 12345;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const optionSets = [];
  for (let i = 0; i < 16; i++)
    optionSets.push({ speedCautious: !!(i & 1), sleepModeInn: !!(i & 2), travelShip: !!(i & 4), hasHorse: !!(i & 8), seaMult: 1 });
  let trips = 0, mismatches = 0;
  for (let t = 0; t < 2000; t++) {
    const a = rnd(locs.name.length), b = rnd(locs.name.length);
    const s = { x: locs.px[a], y: locs.py[a] }, e = { x: locs.px[b], y: locs.py[b] };
    for (const o of optionSets) {
      const want = travel.calculateTravelTime(s, e, o, (x, y) => maps.getClimateIndex(x, y));
      const got = core.calculateTravelTime(s, e, o, climateAt);
      trips++;
      if (want.minutes !== got.minutes || want.oceanPixels !== got.oceanPixels) mismatches++;
      const wc = travel.calculateTripCost(want.minutes, want.oceanPixels, o);
      const gc = core.calculateTripCost(got.minutes, got.oceanPixels, o);
      if (wc.totalCost !== gc.totalCost) mismatches++;
    }
  }
  check(mismatches === 0, `travel time and cost match DFO on ${trips} trips (${mismatches} mismatches)`);
}

// 2. Known locations from the in-game test, all in region Daggerfall (17)
for (const name of ['Daggerfall', 'Ruins of Wickston Manor', 'The Fortress of Mastersmith', 'The Convocation of Elona']) {
  const i = locs.name.findIndex((n, k) => n === name && locs.region[k] === 17);
  check(i >= 0, `location "${name}" is in region Daggerfall`);
}
{
  const i = locs.name.findIndex((n, k) => n === 'Daggerfall' && locs.region[k] === 17);
  check(locs.px[i] === 207 && locs.py[i] === 213, 'Daggerfall city is at map pixel (207, 213), as in the game');
}

// 3. Location count matches MAPS.BSA
{
  let total = 0;
  for (let r = 0; r < maps.regionCount; r++) total += maps.getRegion(r)?.locationCount ?? 0;
  check(total === locs.name.length, `location count ${locs.name.length} == MAPS.BSA total ${total}`);
}

// 4. Building names and keys seen in the real game (Daggerfall Unity test run)
{
  const towns = load('data/towns/r17.json');
  const id = locs.name.findIndex((n, k) => n === 'Daggerfall' && locs.region[k] === 17);
  const city = towns.towns[id];
  const all = city.b.length + city.houses.length / 5;
  check(all === 647, `Daggerfall city has 647 buildings (${all})`);
  const byKey = k => city.b.find(r => r[8] === k);
  check(byKey(197899)?.[0] === 'The Fighters Guild', 'building 197899 is The Fighters Guild');
  check(byKey(66048)?.[0] === 'The Mages Guild', 'building 66048 is The Mages Guild');
  // the quest houses of the in-game test (The Yeoming / The Wickford Residence) are houses here, by key
  const houseKeys = new Set(city.houses.filter((_, k) => k % 5 === 4));
  check(houseKeys.has(328197) && houseKeys.has(328965), 'quest houses 328197 and 328965 are Daggerfall houses');
  check(city.b.some(r => r[0] === 'The Bank of the Empire' && r[9] === 'The Bank of Daggerfall'), 'banks use DFO Online naming (Bank of the Empire)');
}

// 5. Map dots: every dot sits on its location's pixel by the game's own law
{
  const dots = load('data/mapdots.json');
  let bad = 0, n = 0;
  for (const [region, pages] of Object.entries(dots.pages)) {
    for (const p of pages) {
      if (p.scale !== 1) continue;
      for (const [loc, x, y] of p.dots) {
        n++;
        if (locs.px[loc] - p.origin[0] !== x || locs.py[loc] - p.origin[1] !== y || locs.region[loc] !== +region) bad++;
      }
    }
  }
  check(bad === 0 && n > 15000, `${n} map dots line up with their locations (${bad} off)`);
}

// 6. Quests: all parse; reward givers include the delivery-recipient case seen in game
{
  const quests = load('data/quests.json');
  check(quests.length === 265, `265 quests built (${quests.length})`);
  const q = quests.find(x => x.file === 'A0C00Y14');
  check(q && q.reward.from.length === 1 && q.reward.from[0].sym === '_pickuplocal_' && !q.reward.from[0].questor,
    'The Delivery Boy pays from the recipient, not the quest giver (as in game)');
  const other = quests.filter(x => x.reward.from.length && !x.reward.from.some(r => r.questor)).length;
  check(other >= 73, `${other} quests pay from someone other than the quest giver (prototype found 73)`);
  const m = quests.find(x => x.file === 'M0B00Y00');
  check(m && m.reward.from.some(r => r.questor), 'Hunt for a Lycanthrope pays from the quest giver (as in game)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
