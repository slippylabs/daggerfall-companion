// The in-game helper's words, for every quest a player can get, at every step: each quest is compiled by DFO's own
// QuestMachine and played by following the guide (as test-now.mjs does), its people, places, foes and clocks given
// names as a real save would give them, and at each step the panel's text (myquests.js helperFor) is checked:
// a step to do, nothing unfilled ("_x_", "undefined", "them", "the foe"), a where for every errand, the clicks, the
// inventory tile for a drop. -v lists every problem; -p prints every panel.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE } from './lib/env.mjs';
import { compile, start, settle, perform, heldItems, questFiles } from './lib/questSim.mjs';

globalThis.fetch = async () => { throw new Error('no fetch in test'); };
globalThis.localStorage = { getItem: () => null, setItem() {} };
const ver = readFileSync(join(SITE, 'js/saveImport.js'), 'utf8').match(/data\.js(\?v=\d+)/)[1];
const { data } = await import(`../site/js/data.js${ver}`);
const { questsInSave } = await import(`../site/js/saveImport.js${ver}`);
const { questNow } = await import(`../site/js/questNow.js${ver}`);
const { helperFor, deadline } = await import(`../site/js/myquests.js${ver}`);
data.locs = JSON.parse(readFileSync(join(SITE, 'data/locations.json'), 'utf8'));
data.count = data.locs.name.length;
data.climate = new Uint8Array(readFileSync(join(SITE, 'data/climate.bin')));
const quests = JSON.parse(readFileSync(join(SITE, 'data/quests.json'), 'utf8'));
const byFile = new Map(quests.map(q => [q.file, q]));
const extra = { names: JSON.parse(readFileSync(join(SITE, 'data/names.json'), 'utf8')), individuals: JSON.parse(readFileSync(join(SITE, 'data/individuals.json'), 'utf8')) };
const at = name => { const i = data.locs.name.indexOf(name); if (i < 0) throw new Error(`no location ${name}`); return i; };
const TOWN = at('Daggerfall'), REMOTE = at('Penbrugh'), DUNGEON = at('Ruins of Wickston Manor');

// ---- a compiled quest dressed as the game would have it: every blank given a name and a place ----
const FIRST = ['Aldric', 'Brenna', 'Cassius', 'Delphine', 'Edric', 'Fenella', 'Gareth', 'Hilde', 'Ivo', 'Jorunn', 'Kester', 'Lysa'];
const LAST = ['Venn', 'Marrow', 'Ashdown', 'Coldbrook', 'Hale', 'Thorne'];
const cap = s => s.replace(/^(a|an|the)\s+/i, '').replace(/\s*\(.*$/, '').replace(/,.*$/, '').replace(/^\w/, c => c.toUpperCase());
function dress(sd, q) {
  const site = (loc, siteType, buildingName = null, buildingKey = 0) => ({ questUID: sd.uid, siteType, mapId: data.locs.mapId[loc], locationId: 0,
    regionIndex: data.locs.region[loc], regionName: 'Daggerfall', locationName: data.locs.name[loc], buildingKey, buildingName,
    questSpawnMarkers: null, questItemMarkers: null, selectedMarker: { targetResources: null } });
  let n = 0, key = 400000;
  const building = (loc, what) => site(loc, 3, `The ${cap(what)} of ${LAST[n % LAST.length]}`, key++);
  for (const r of [...sd.resources]) {
    const p = r.resourceSpecific || {}, s = r.symbol.original, info = q.resources[s] || {};
    if (r.type === 'Place' && !p.siteDetails) {
      const remote = /remote/.test(p.scope) || /elsewhere/.test(info.where || '');
      p.siteDetails = /dungeon|crypt|cave|ruin|mine|keep|tower/i.test(p.name || info.role || '') && !/house|shop|guild|temple/i.test(info.role || '')
        ? site(DUNGEON, 2) : building(remote ? REMOTE : TOWN, info.role || p.name || 'house');
    }
    if (r.type === 'Person' && !p.isIndividualNPC) {
      p.displayName ||= `${FIRST[n % FIRST.length]} ${LAST[Math.floor(n / FIRST.length) % LAST.length]}`;
      n++;
      const home = p.homePlaceSymbol?.original;
      if (home && !sd.resources.some(x => x.symbol.original === home))
        sd.resources.push({ type: 'Place', symbol: { original: home }, resourceSpecific: { scope: 'local', name: 'house', siteDetails: building(/elsewhere/.test(info.role || '') ? REMOTE : TOWN, 'residence') } });
    }
    // (the game names a foe by its kind, one of it: "Thief", not the script's "2 thieves")
    if (r.type === 'Foe') p.typeName ||= cap((info.role || 'monster').replace(/^\d+\s+/, '').replace(/(ves)$/, 'f').replace(/(ies)$/, 'y').replace(/([^s])s$/, '$1'));
    if (r.type === 'Clock') Object.assign(p, { clockEnabled: true, clockFinished: false, startingTimeInSeconds: 6 * 86400, remainingTimeInSeconds: 5 * 86400 });
  }
  return sd;
}
// the save the Sync bookmark would send: the quest, the player's quest items in the pack, saved outdoors in Daggerfall
const snapOf = sd => ({ v: 1, world: { pixel: { x: data.locs.px[TOWN], y: data.locs.py[TOWN] } },
  items: heldItems(sd).map(h => sd.resources.find(r => r.symbol.original === h.symbol)?.resourceSpecific?.item).filter(Boolean),
  quest: { machine: { quests: [sd] } } });

// ---- what a panel must not say ----
const ERRAND = new Set(['talk', 'bring', 'kill', 'pickup', 'drop', 'go']);
function audit(p, o) {
  const bad = [];
  const text = [p.now, p.where, ...p.steps, p.avoid, p.then].filter(Boolean).join(' | ');
  if (!o) bad.push('no step');
  if (/_[a-z0-9.]+_|%[a-z]{2,3}\b|undefined|null|NaN|\[object/i.test(text)) bad.push('unfilled');
  if (/\bthem\b|\bthe foe\b|\bthe quest item\b|\bthe place\b|\bspell \d+/.test(text)) bad.push('no name');
  if (o && ERRAND.has(o.kind) && !p.where && !o.later && !o.comes) bad.push('no where');
  if (o && !p.steps.length) bad.push('no clicks');
  if (o && ['drop', 'use'].includes(o.kind) && o.inv?.where && !(p.tiles.length && p.page)) bad.push('no glow');
  // a delivery or a use with the item nowhere in the pack: the guide skipped how to get it
  if (o && ['drop', 'use', 'bring'].includes(o.kind) && o.inv && !o.inv.where) bad.push('no item');
  return bad;
}

// ---- every listed quest, every step ----
const listed = new Set(quests.filter(q => !/^_|^S000/.test(q.file) || q.title).map(q => q.file));
const verbose = process.argv.includes('-v'), print = process.argv.includes('-p');
const problems = new Map(), seenPanels = [];
let panels = 0, clean = 0, questsSeen = 0;
for (const f of questFiles().filter(x => listed.has(x) && (!process.env.ONLY || x === process.env.ONLY))) {
  const q = byFile.get(f), sd0 = compile(f);
  if (!q || !sd0) continue;
  questsSeen++;
  const sd = dress(start(sd0), q);
  settle(sd);
  // the quest is over once its goal task has run (a finished quest leaves the save: no panel)
  const goal = questNow(sd, heldItems(sd)).goal;
  const over = () => goal && sd.tasks.find(t => t.symbol.original === goal)?.triggered;
  for (let step = 0; step < 25 && !over(); step++) {
    const found = questsInSave(snapOf(sd), quests, extra).found[0];
    if (!found) break;
    const entry = { ...found, file: f };
    const o = entry.guide?.[0];
    const p = helperFor(q, entry, TOWN);
    panels++;
    const bad = audit(p, o);
    if (!bad.length) clean++;
    for (const b of bad) {
      if (!problems.has(b)) problems.set(b, []);
      problems.get(b).push(`${f} ${q.title || ''} step ${step}: ${p.now}${p.where ? ` @ ${p.where}` : ''}${p.steps.length ? ` [${p.steps.join('; ')}]` : ''}`);
    }
    if (print) seenPanels.push(`${f} ${step}: ${p.now} @ ${p.where} [${p.steps.join('; ')}]${p.then ? ` THEN ${p.then}` : ''}`);
    const next = questNow(sd, heldItems(sd)).objectives[0];
    if (!next || next.automatic) break;
    perform(sd, next);
  }
}
if (print) seenPanels.forEach(l => console.log(l));
let fail = 0;
const check = (ok, what) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); };
// each kind of problem has a ceiling, ratcheted down as the guide gets better (set from the first full run)
// (v2.8.0: the 5 with no step are the main story's scripts, the tutorial and Lady Brisienna)
const CEILING = { 'no step': 5, unfilled: 0, 'no name': 0, 'no where': 0, 'no clicks': 0, 'no glow': 0, 'no item': 2 };
for (const [kind, max] of Object.entries(CEILING)) {
  const list = problems.get(kind) || [];
  check(list.length <= max, `${kind}: ${list.length} panel${list.length === 1 ? '' : 's'} (at most ${max})`);
  if (verbose) list.forEach(l => console.log('   ', l));
}
// ---- the deadline warning ----
check(deadline(5, 2) === null && deadline(null, 9) === null, 'time enough, or no time limit: no warning');
check(/^Only 2 days left/.test(deadline(2, null)) && /^Only 1 day left/.test(deadline(1, null)), `few days left: "${deadline(2, null)}"`);
check(/^Go now: 3 days left/.test(deadline(3, 3)), `the trip takes all the time left: "${deadline(3, 3)}"`);
check(/^Hurry: 2 days left, but the trip there takes about 3 days\. Pick Reckless/.test(deadline(2, 3)) && !/Reckless/.test(deadline(2, 3, true)), `the trip takes longer than the time left: "${deadline(2, 3)}"`);
check(/^Probably too late: 2 days left/.test(deadline(2, 5)), `far longer: "${deadline(2, 5)}"`);
{
  // the Hunt from far away: the panel works out the trip from where the player saved, against the days left
  const f = 'M0B00Y00', q = byFile.get(f), sd = dress(start(compile(f), 2), q);
  const entry = { ...questsInSave(snapOf(sd), quests, extra).found[0], file: f };
  const far = at('Sentinel'), p = helperFor(q, { ...entry, daysLeft: 1 }, far), easy = helperFor(q, { ...entry, daysLeft: 60 }, far), here = helperFor(q, { ...entry, daysLeft: 1 }, DUNGEON);
  check(p.travelDays > 2 && /^Probably too late: 1 day left/.test(p.warn || ''), `1 day left, saved in Sentinel: the trip takes ${p.travelDays} days -> "${p.warn}"`);
  check(easy.warn === null && here.travelDays === null && /^Only 1 day left/.test(here.warn || ''), `60 days left: no warning; at the dungeon already: "${here.warn}"`);
}
console.log(`helper: ${questsSeen} quests, ${panels} panels, ${clean} with nothing missing`);
process.exit(fail ? 1 : 0);
