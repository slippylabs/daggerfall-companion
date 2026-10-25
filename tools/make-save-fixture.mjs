// Writes tools/fixtures/DFO-Online-Saves.zip with DFO Online's own exporter (saveTransfer.js exportSavesZip).
// The quests are compiled by DFO's own QuestMachine and played forward (lib/questSim.mjs), so their tasks and
// actions are exactly what a real save holds; only the world the headless compile skips is filled in by hand:
// the people's names and homes, the dungeon, the item, the inventory. Building keys are those of the in-game
// Daggerfall Unity test (328197 The Yeoming Residence, 328965 The Wickford Residence, 197899 The Fighters Guild).
//   SAVE0 (older, "Before the hunt"): The Delivery Boy (package in the pack) + Hunt for a Lycanthrope (werewolf alive)
//   SAVE1 (newer, "Beast slain"):     the same two, the werewolf dead; saved outdoors at Penbrugh
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dfo, SITE, ROOT } from './lib/env.mjs';
import { compile, start, run, kill } from './lib/questSim.mjs';

const { exportSavesZip } = await dfo('src/systems/save/saveTransfer.js');
const L = JSON.parse(readFileSync(join(SITE, 'data/locations.json'), 'utf8'));
const at = name => { const i = L.name.indexOf(name); if (i < 0) throw new Error(`no location ${name}`); return { mapId: L.mapId[i], px: L.px[i], py: L.py[i] }; };
const DAGGERFALL = at('Daggerfall'), WICKSTON = at('Ruins of Wickston Manor'), PENBRUGH = at('Penbrugh');

// DFO place.js SITE_TYPES: 1 Town, 2 Dungeon, 3 Building
const site = (loc, locationName, buildingName = null, siteType = 1, buildingKey = 0) => ({
  questUID: 0, siteType, mapId: loc.mapId, locationId: 0, regionIndex: 17, regionName: 'Daggerfall', locationName,
  buildingKey, buildingName, magicNumberIndex: 0, questSpawnMarkers: null, questItemMarkers: null,
  selectedMarker: { targetResources: null },
});
const placeRes = (original, sd) => ({ type: 'Place', symbol: { original }, infoMessageID: -1, usedMessageID: -1, rumorsMessageID: 0,
  hasPlayerClicked: false, isHidden: false, resourceSpecific: { scope: 1, name: original, p1: 0, p2: 0, p3: 0, siteDetails: sd } });
const res = (sd, s) => sd.resources.find(r => r.symbol.original === s);
const person = (sd, s, displayName, home) => {
  const p = res(sd, s).resourceSpecific;
  p.displayName = displayName;
  sd.resources.push(placeRes(p.homePlaceSymbol.original, home));
};
const clock = (sd, s, days) => Object.assign(res(sd, s).resourceSpecific, { clockEnabled: true, clockFinished: false, startingTimeInSeconds: days * 86400, remainingTimeInSeconds: days * 86400 - 3600 });

// Hunt for a Lycanthrope's beast stands on a real quest-spawn marker of Ruins of Wickston Manor
const wIdx = L.name.indexOf('Ruins of Wickston Manor');
const wBlocks = JSON.parse(readFileSync(join(SITE, `data/dungeons/r${String(L.region[wIdx]).padStart(2, '0')}.json`), 'utf8'))[wIdx];
const rdbIndex = JSON.parse(readFileSync(join(SITE, 'data/rdb/index.json'), 'utf8'));
const lair = wBlocks.find(b => !b[3] && rdbIndex[b[2]].quest.length);
const [mx, my, mz] = rdbIndex[lair[2]].quest[0];
const marker = targets => ({ questUID: 102, placeSymbol: { original: '_mondung_' }, targetResources: targets,
  markerType: 0, flatPosition: { x: mx, y: my, z: mz }, dungeonX: lair[0], dungeonZ: lair[1], buildingKey: 0, markerID: 1 });

function delivery() {
  const sd = start(compile('A0C00Y14', 101), 0);   // pick 0: the package is the book (_book_)
  person(sd, '_questgiver_', 'Gondywyr Hearthhouse', site(DAGGERFALL, 'Daggerfall', 'The Yeoming Residence', 3, 328197));
  person(sd, '_pickuplocal_', 'Bedoryan Kingwing', site(DAGGERFALL, 'Daggerfall', 'The Wickford Residence', 3, 328965));
  res(sd, '_book_').resourceSpecific.item = { name: 'Book', message: 4, questItem: true, questUID: 101, questSymbol: { original: '_book_', name: 'book' } };
  clock(sd, '_oneday_', 1);
  return sd;
}
function hunt(dead) {
  const sd = start(compile('M0B00Y00', 102), 2);   // pick 2: the werewolf
  person(sd, '_questgiver_', 'Lord Kain Mastercroft', site(DAGGERFALL, 'Daggerfall', 'The Fighters Guild', 3, 197899));
  res(sd, '_mondung_').resourceSpecific.siteDetails = { ...site(WICKSTON, 'Ruins of Wickston Manor', null, 2),
    selectedMarker: marker([{ original: '_werewolf_', name: 'werewolf' }]), questSpawnMarkers: [marker(null)] };
  Object.assign(res(sd, '_werewolf_').resourceSpecific, { typeName: 'Werewolf' });
  clock(sd, '_1stparton_', 5);
  if (dead) { kill(sd, '_werewolf_'); run(sd, '_mondead_'); }
  return sd;
}
export const FIXTURE_LAIR = { bx: lair[0], bz: lair[1], x: mx, y: my, z: mz };

const pack = [{ name: 'Book', questItem: true, questUID: 101, questSymbol: { original: '_book_', name: 'book' } }];
const snap = (quests, pixel, minutes) => JSON.stringify({ v: 1, classicMinutes: minutes, locationKey: pixel ? 'world' : null,
  world: pixel ? { pixel } : null, items: pack,
  quest: { machine: { siteLinks: [], quests, globalVars: [], storyStarted: false, storyEnded: false }, notebook: {} } });
const info = (saveName, minutes) => JSON.stringify({ saveVersion: 1, saveName, characterName: 'Slippy', characterId: 'fixture', dateAndTime: { gameTime: minutes, realTime: minutes } });

const T0 = 523530, T1 = T0 + 2 * 1440;   // the game's start (4 Morning Star 3E 405), then two days on
const store = new Map([
  ['dagger.save.0', snap([delivery(), hunt(false)], null, T0)], ['dagger.saveinfo.0', info('Before the hunt', T0)],
  ['dagger.save.1', snap([delivery(), hunt(true)], { x: PENBRUGH.px, y: PENBRUGH.py }, T1)], ['dagger.saveinfo.1', info('Beast slain', T1)],
]);
// the newest save's snapshot also stands alone, for the sync tests (a realm save is this same JSON)
writeFileSync(join(ROOT, 'tools/fixtures/realm-save.json'), store.get('dagger.save.1'));
const keys = [...store.keys()];
const storage = { get length() { return keys.length; }, key: i => keys[i], getItem: k => store.get(k) ?? null };
const zip = exportSavesZip(storage);
writeFileSync(join(ROOT, 'tools/fixtures/DFO-Online-Saves.zip'), zip);
console.log(`fixture zip ${zip.length} bytes; the werewolf at block ${lair[0]},${lair[1]} (${lair[2]}) ${mx},${my},${mz}`);
