// Builds site/data/towns/rNN.json: every building of every location in a region, named the way
// DFO Online names them (townTalk.js nameOpts + buildingSummaries.js + buildingNames.js).
// Online pages call every bank "The Bank of the Empire"; the offline name is kept as an alias.
globalThis.location = { search: '?online=1' };

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dfo, arena2, loadMaps, writeOut, SITE } from './lib/env.mjs';

const { BlocksFile } = await dfo('src/formats/blocksFile.js');
const { layoutLocation } = await dfo('src/world/locationLayout.js');
const { buildingSummaries } = await dfo('src/world/buildingSummaries.js');
const { generateBuildingName, BUILDING_TYPES } = await dfo('src/world/buildingNames.js');
const { FactionFile, FACTION_TYPES } = await dfo('src/formats/factionFile.js');
const { findFactions } = await dfo('src/systems/talk/talk.js');
const { getNameBankOfRegion } = await dfo('src/characters/nameHelper.js');

const maps = await loadMaps();
const blocks = new BlocksFile();
blocks.load(arena2('BLOCKS.BSA'));
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
    // Houses have no name until a quest names one, so they are kept as bare positions for the map
    const houses = [];
    for (const b of list) {
      if (b.isResidence && !b.name)
        houses.push(b.blockX, b.blockY, Math.round(b.position[0]), Math.round(b.position[2]));
    }
    const rows = list.filter(b => !(b.isResidence && !b.name)).map(b => {
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
    out[id] = { name: loc.name, w: layout.width, h: layout.height, b: rows, houses };
    towns++;
    buildings += rows.length + houses.length / 4;
  }
  const json = JSON.stringify({ region: r, buildingTypes: typeNames, towns: out });
  biggest = Math.max(biggest, json.length);
  writeOut(`data/towns/r${String(r).padStart(2, '0')}.json`, json);
}
console.log(`${towns} locations with buildings, ${buildings} buildings, largest region file ${(biggest / 1024).toFixed(0)} KB`);
