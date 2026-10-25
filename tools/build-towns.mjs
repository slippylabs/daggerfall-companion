// Builds site/data/towns/rNN.json: every building of every location in a region, named the way
// DFO Online names them (townTalk.js nameOpts + buildingSummaries.js + buildingNames.js).
// Online pages call every bank "The Bank of the Empire"; the offline name is kept as an alias.
globalThis.location = { search: '?online=1' };

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dfo, arena2, loadMaps, writeOut, SITE, ROOT } from './lib/env.mjs';
import { openTownPacks } from './lib/townPacks.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const { BlocksFile } = await dfo('src/formats/blocksFile.js');
const { layoutLocation } = await dfo('src/world/locationLayout.js');
const { buildingSummaries } = await dfo('src/world/buildingSummaries.js');
const { generateBuildingName, BUILDING_TYPES } = await dfo('src/world/buildingNames.js');
const { FactionFile, FACTION_TYPES } = await dfo('src/formats/factionFile.js');
const { findFactions } = await dfo('src/systems/talk/talk.js');
const { getNameBankOfRegion } = await dfo('src/characters/nameHelper.js');

const blocks = new BlocksFile();
blocks.load(arena2('BLOCKS.BSA'));
// the towns as DFO Online lays them out (Beautiful Villages + Beautiful Cities), before any location is read
const packs = await openTownPacks(blocks);
console.log('town packs:', Object.entries(packs).map(([v, p]) => `${v} ${p.version} (${p.files} files)`).join(', '));
const maps = await loadMaps();
const factions = new FactionFile();
factions.load(arena2('FACTION.TXT'));

const PALACES = { Daggerfall: 'Castle Daggerfall', Wayrest: 'Castle Wayrest', Sentinel: 'Castle Sentinel' };

// townTalk.js nameOpts(), without the UI's localisation layer
function nameOpts(region, loc) {
  const province = findFactions(factions.factionDict, { type: FACTION_TYPES.Province, region })[0];
  return {
    locationName: loc.name, regionName: loc.regionName, locationIndex: loc.locationIndex,
    nameBank: getNameBankOfRegion(region),
    regentRuler: province?.ruler ?? 0,
    factionName: id => factions.getFaction(id)?.name ?? '',
    templeName: id => {
      const f = factions.getFaction(id);
      return (f?.children?.length ? factions.getFaction(f.children[0])?.name : f?.name) ?? '';
    },
    palaceName: name => PALACES[name] ?? null,
  };
}

const locs = JSON.parse(readFileSync(join(SITE, 'data/locations.json'), 'utf8'));
const indexOf = new Map();
for (let i = 0; i < locs.name.length; i++) indexOf.set(`${locs.region[i]}:${locs.name[i]}`, i);

const typeNames = Object.fromEntries(Object.entries(BUILDING_TYPES).map(([k, v]) => [v, k]));
let towns = 0, buildings = 0, biggest = 0;
// Fixed NPCs (factions of type Individual: Lord Kain, guild masters...) stand in a building's interior as a
// people record carrying their faction id; a quest naming one has no Place for them in the save
const individuals = {};
// Each town block's own 64x64 automap (RMB fldHeader.autoMapData: 0 street, 0xfb ground flat, else
// buildingType + 1), the picture Daggerfall's town map draws; one file per distinct block
const automaps = new Map();
for (let r = 0; r < maps.regionCount; r++) {
  const region = maps.getRegion(r);
  if (!region) continue;
  const out = {};
  for (let l = 0; l < region.locationCount; l++) {
    const loc = maps.getLocation(r, l);
    if (!loc?.loaded || !loc.exterior?.buildingCount) continue;
    const layout = layoutLocation(loc, maps, blocks, { enhanced: false, windmills: false });
    const opts = nameOpts(r, loc);
    const list = buildingSummaries(loc.exterior.buildings, layout.blocks, opts);
    const keyOf = new Map(list.map(b => [`${b.blockX},${b.blockY},${b.recordIndex}`, b]));
    // block names on the town grid, index y*w + x (x west to east, y south to north)
    const grid = new Array(layout.width * layout.height).fill('');
    for (const blk of layout.blocks) {
      const name = String(blk.blockName || '').replace(/\.RMB$/i, '');
      grid[(blk.y ?? 0) * layout.width + (blk.x ?? 0)] = name;
      const am = blk.dfBlock?.rmbBlock?.fldHeader?.autoMapData;
      if (name && am && !automaps.has(name)) automaps.set(name, Uint8Array.from(am));
    }
    for (const blk of layout.blocks) {
      (blk.dfBlock?.rmbBlock?.subRecords ?? []).forEach((sub, i) => {
        for (const p of sub?.interior?.blockPeopleRecords ?? []) {
          const fac = factions.getFaction(p.factionID);
          // shared shop and house templates carry stray individual ids; a person is real in their own region
          if (fac?.type !== FACTION_TYPES.Individual || fac.region !== r) continue;
          const b = keyOf.get(`${blk.x ?? 0},${blk.y ?? 0},${i}`);
          if (!b) continue;
          (individuals[p.factionID] ||= []).push([indexOf.get(`${r}:${loc.name}`), b.buildingKey, b.name || '']);
        }
      });
    }
    // Houses have no name until a quest names one, so they are kept as positions + building key (the key a
    // quest site in a save names: DFO place.js makeBuildingKey(blockX, blockY, record))
    const houses = [];
    for (const b of list) {
      // (an unnamed record that is no residence - Beautiful Villages' farm fields - is no named building either)
      if (!b.name)
        houses.push(b.blockX, b.blockY, Math.round(b.position[0]), Math.round(b.position[2]), b.buildingKey);
    }
    const rows = list.filter(b => b.name).map(b => {
      const row = [b.name, b.buildingType, b.factionId, b.quality, b.blockX, b.blockY,
        Math.round(b.position[0] * 10) / 10, Math.round(b.position[2] * 10) / 10, b.buildingKey];
      if (b.buildingType === BUILDING_TYPES.Bank) {
        globalThis.location = { search: '' };
        row.push(generateBuildingName(b.nameSeed, b.buildingType, { ...opts, factionId: b.factionId }));
        globalThis.location = { search: '?online=1' };
      }
      return row;
    });
    const id = indexOf.get(`${r}:${loc.name}`);
    out[id] = { name: loc.name, w: layout.width, h: layout.height, bn: grid, b: rows, houses };
    towns++;
    buildings += rows.length + houses.length / 5;
  }
  const json = JSON.stringify({ region: r, buildingTypes: typeNames, towns: out });
  biggest = Math.max(biggest, json.length);
  writeOut(`data/towns/r${String(r).padStart(2, '0')}.json`, json);
}
// an intermediate for build-dungeons, which merges in the castles' people and publishes data/individuals.json
mkdirSync(join(ROOT, 'tools/.cache'), { recursive: true });
writeFileSync(join(ROOT, 'tools/.cache/individuals-towns.json'), JSON.stringify(Object.fromEntries(Object.entries(individuals)
  .map(([id, list]) => [id, { name: factions.getFaction(+id)?.name ?? '', at: list }]))));
console.log(`${Object.keys(individuals).length} fixed NPCs placed in buildings`);
for (const [name, bytes] of automaps) writeOut(`data/rmb/${name}.bin`, bytes);
console.log(`${automaps.size} town blocks' automaps written`);
console.log(`${towns} locations with buildings, ${buildings} buildings, largest region file ${(biggest / 1024).toFixed(0)} KB`);
