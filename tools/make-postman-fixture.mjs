// Writes tools/fixtures/postman-save.json: The Postman (A0C00Y00) as the player's online save had it (2026-10-25),
// the true letter delivered and the forged one still in the pack, to drop in the inn. For the in-game helper's test
// (smoke.py run_sync): its step is a drop, so the helper lights up the letter's tile.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE, ROOT } from './lib/env.mjs';
import { compile, start, settle, setTriggered } from './lib/questSim.mjs';

const L = JSON.parse(readFileSync(join(SITE, 'data/locations.json'), 'utf8'));
const di = L.name.indexOf('Daggerfall');
const sd = start(compile('A0C00Y00'), 1);   // pick 1: _letter2_, the forged letter _falseletter2_
settle(sd); setTriggered(sd, '_S.02_'); setTriggered(sd, '_qgclicked_');
const r = s => sd.resources.find(x => x.symbol?.original === s);
r('_npc3_').resourceSpecific.displayName = 'Lysausa Greenhouse';
r('_inn_').resourceSpecific.siteDetails = { questUID: sd.uid, siteType: 3, mapId: L.mapId[di], regionIndex: 17, regionName: 'Daggerfall', locationName: 'Daggerfall',
  buildingKey: 328965, buildingName: 'The Queen\'s Helm', selectedMarker: { targetResources: null } };
const letter = { name: 'Parchment', group: 'UselessItems2', templateIndex: 279, questItem: true, questUID: sd.uid, questSymbol: { original: '_falseletter2_', name: 'falseletter2' } };
r('_falseletter2_').resourceSpecific.item = letter;
writeFileSync(join(ROOT, 'tools/fixtures/postman-save.json'), JSON.stringify({ v: 1, classicMinutes: 523530, items: [letter],
  quest: { machine: { siteLinks: [], quests: [sd], globalVars: [], storyStarted: false, storyEnded: false }, notebook: {} } }));
console.log('postman fixture written');
