// Builds site/data/locations.json, climate.bin, politic.bin and the region part of meta.json
// from MAPS.BSA / CLIMATE.PAK / POLITIC.PAK via DFO Online's MapsFile.
import { dfo, loadMaps, writeOut, dfoCommit } from './lib/env.mjs';

const { LOCATION_TYPES, DUNGEON_TYPES, REGION_NAMES, longitudeLatitudeToMapPixel } = await dfo('src/formats/mapsFile.js');
const maps = await loadMaps();

const cols = { name: [], region: [], type: [], dungeon: [], px: [], py: [], mapId: [] };
const regions = [];
for (let r = 0; r < maps.regionCount; r++) {
  const region = maps.getRegion(r);
  const count = region ? region.locationCount : 0;
  regions.push({ i: r, name: REGION_NAMES[r] || maps.getRegionName(r), locations: count });
  if (!region) continue;
  for (let l = 0; l < region.locationCount; l++) {
    const t = region.mapTable[l];
    const p = longitudeLatitudeToMapPixel(t.longitude, t.latitude);
    cols.name.push(region.mapNames[l]);
    cols.region.push(r);
    cols.type.push(t.locationType);
    cols.dungeon.push(t.dungeonType);
    cols.px.push(p.x);
    cols.py.push(p.y);
    cols.mapId.push(t.mapId);
  }
}

// Per-pixel grids: climate drives travel time, politic says which region a pixel belongs to
const W = 1000, H = 500;
const climate = new Uint8Array(W * H);
const politic = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    climate[y * W + x] = maps.getClimateIndex(x, y);
    politic[y * W + x] = maps.getPoliticIndex(x, y);
  }
}

const invert = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => typeof v === 'number').map(([k, v]) => [v, k]));
const meta = {
  dfoCommit: dfoCommit(),
  built: new Date().toISOString(),
  world: { width: W, height: H },
  regions,
  locationTypes: invert(LOCATION_TYPES),
  dungeonTypes: invert(DUNGEON_TYPES),
};

writeOut('data/locations.json', JSON.stringify(cols));
writeOut('data/climate.bin', climate);
writeOut('data/politic.bin', politic);
writeOut('data/meta.json', JSON.stringify(meta, null, 1));
console.log(`locations: ${cols.name.length} in ${regions.filter(r => r.locations).length} regions; dfo ${meta.dfoCommit}`);
