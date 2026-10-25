// Writes tools/fixtures/DFO-Online-Saves.zip with DFO Online's own exporter (saveTransfer.js exportSavesZip),
// holding two saves of one character shaped by DFO's serializers (Quest/Person/Place/Clock getSaveData):
//   SAVE0 (older): The Delivery Boy + Hunt for a Lycanthrope
// with the building keys of the in-game Daggerfall Unity test (328197 The Yeoming, 328965 The Wickford Residence)
//   SAVE1 (newer): The Delivery Boy only (the hunt is finished), saved outdoors at Penbrugh
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dfo, SITE, ROOT } from './lib/env.mjs';

const { exportSavesZip } = await dfo('src/systems/save/saveTransfer.js');
const L = JSON.parse(readFileSync(join(SITE, 'data/locations.json'), 'utf8'));
const at = name => { const i = L.name.indexOf(name); if (i < 0) throw new Error(`no location ${name}`); return { mapId: L.mapId[i], px: L.px[i], py: L.py[i] }; };
const DAGGERFALL = at('Daggerfall'), WICKSTON = at('Ruins of Wickston Manor'), PENBRUGH = at('Penbrugh');

const site = (loc, locationName, buildingName = null, siteType = 0, buildingKey = 0) => ({
  questUID: 0, siteType, mapId: loc.mapId, locationId: 0, regionIndex: 17, regionName: 'Daggerfall', locationName,
  buildingKey, buildingName, magicNumberIndex: 0, questSpawnMarkers: null, questItemMarkers: null,
  selectedMarker: { targetResources: null },
});
const res = (type, original, resourceSpecific) => ({ type, symbol: { original }, infoMessageID: -1, usedMessageID: -1, rumorsMessageID: 0, hasPlayerClicked: false, isHidden: false, resourceSpecific });
const place = (original, sd) => res('Place', original, { scope: 1, name: original, p1: 0, p2: 0, p3: 0, siteDetails: sd });
const person = (original, displayName, home, assigned = null) => res('Person', original, {
  race: -1, nameBank: 0, npcGender: 0, faceIndex: 0, nameSeed: 1, isQuestor: false, isIndividualNPC: false, isIndividualAtHome: false,
  displayName, homePlaceSymbol: home ? { original: home } : null, lastAssignedPlaceSymbol: assigned ? { original: assigned } : null,
  assignedToHome: false, factionID: 0, factionTableKey: 0, questorData: {}, discoveredThroughTalkManager: false,
});
const clock = (original, days) => res('Clock', original, {
  lastWorldTimeSample: 0, startingTimeInSeconds: days * 86400, remainingTimeInSeconds: days * 86400 - 3600, flag: 0, minRange: 0, maxRange: 0,
  clockEnabled: true, clockFinished: false, startedAfterSuccess: false, declaredAtOnce: false,
});
const quest = (uid, questName, displayName, resources) => ({
  uid, questComplete: false, questSuccess: false, questName, displayName, factionId: 0, questStartTime: 0, questTombstoned: false,
  questTombstoneTime: 0, smallerDungeonsState: 0, compiledByVersion: '', activeLogMessages: [{ stepID: 0, messageID: 1010, time: 0 }],
  messages: [], resources, questors: [], tasks: [], oneTimeDisplayedMessages: [],
});

const delivery = quest(101, 'A0C00Y14', 'The Delivery Boy', [
  person('_questgiver_', 'Gondywyr Hearthhouse', '_questgiver_home_'),
  place('_questgiver_home_', site(DAGGERFALL, 'Daggerfall', 'The Yeoming Residence', 2, 328197)),
  person('_pickuplocal_', 'Bedoryan Kingwing', '_pickuplocal_home_'),
  place('_pickuplocal_home_', site(DAGGERFALL, 'Daggerfall', 'The Wickford Residence', 2, 328965)),
  clock('_oneday_', 1),
]);
const hunt = quest(102, 'M0B00Y00', 'Hunt for a Lycanthrope', [
  person('_questgiver_', 'Lord Kain Mastercroft', '_questgiver_home_'),
  place('_questgiver_home_', site(DAGGERFALL, 'Daggerfall', 'The Fighters Guild', 2, 197899)),
  place('_mondung_', site(WICKSTON, 'Ruins of Wickston Manor', null, 1)),
  clock('_1stparton_', 5),
]);
const snap = (quests, pixel, minutes) => JSON.stringify({ v: 1, classicMinutes: minutes, locationKey: pixel ? 'world' : null,
  world: pixel ? { pixel } : null, quest: { machine: { siteLinks: [], quests, globalVars: [], storyStarted: false, storyEnded: false }, notebook: {} } });
const info = (saveName, minutes) => JSON.stringify({ saveVersion: 1, saveName, characterName: 'Slippy', characterId: 'fixture', dateAndTime: { gameTime: minutes } });

const T0 = 523530, T1 = T0 + 2 * 1440;   // the game's start (4 Morning Star 3E 405), then two days on
const store = new Map([
  ['dagger.save.0', snap([delivery, hunt], null, T0)], ['dagger.saveinfo.0', info('Before the hunt', T0)],
  ['dagger.save.1', snap([delivery], { x: PENBRUGH.px, y: PENBRUGH.py }, T1)], ['dagger.saveinfo.1', info('Hunt done', T1)],
]);
const keys = [...store.keys()];
const storage = { get length() { return keys.length; }, key: i => keys[i], getItem: k => store.get(k) ?? null };
const zip = exportSavesZip(storage);
writeFileSync(join(ROOT, 'tools/fixtures/DFO-Online-Saves.zip'), zip);
console.log(`fixture zip ${zip.length} bytes`);
