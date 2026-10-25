// Dungeon maps, from the game's own blocks and models (DFO's readers, DFU's RDBLayout placement):
//   data/dungeons/rNN.json - every dungeon of a region: {locIdx: [[blockX, blockZ, blockName, isStart], ...]}
//   data/rdb/<BLOCK>.bin   - one RDB block's floors seen from above: 128x128 Uint16, north row first; bit k set
//                            where a floor stands in height band k (3.2 units each, block-local y 0..51.2)
//   data/individuals.json  - fixed NPCs (Individual factions) of castles and dungeons, where they stand, merged
//                            with build-towns' town ones: {factionId: {name, at: [[locIdx, buildingKey, building]
//                            | [locIdx, 'd', blockX, blockZ, x, y, z]]}}
//   data/rdb/index.json    - per block: entrance markers [[x, y, z]] (editor flats 199/10) and quest spawn/item
//                            markers (199/11, 199/18, used only by verify.mjs) in block-local units
// A block is 2048 classic units = 51.2 units square; dungeon block (x, z) sits at (x, z) * 51.2, north = +z.
import { dfo, arena2, loadMaps, writeOut } from './lib/env.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE, ROOT } from './lib/env.mjs';

const { BlocksFile, RDB_RESOURCE_TYPES } = await dfo('src/formats/blocksFile.js');
const { Arch3dFile } = await dfo('src/formats/arch3dFile.js');
const { getModelMatrix, rdbObjects } = await dfo('src/world/rdbLayout.js');
const { FactionFile, FACTION_TYPES } = await dfo('src/formats/factionFile.js');
const factions = new FactionFile();
factions.load(arena2('FACTION.TXT'));

const GS = 1 / 40, SIDE = 51.2, N = 128, BAND = 3.2;
const maps = await loadMaps();
const blocks = new BlocksFile();
blocks.load(arena2('BLOCKS.BSA'));
const arch = new Arch3dFile();
arch.load(arena2('ARCH3D.BSA'));

const locs = JSON.parse(readFileSync(join(SITE, 'data/locations.json'), 'utf8'));
const indexOf = new Map();
for (let i = 0; i < locs.name.length; i++) indexOf.set(`${locs.region[i]}:${locs.name[i]}`, i);

// 1. every dungeon's block list, per region
const used = new Set();
let dungeons = 0;
for (let r = 0; r < maps.regionCount; r++) {
  const region = maps.getRegion(r);
  if (!region) continue;
  const out = {};
  for (let l = 0; l < region.locationCount; l++) {
    const loc = maps.getLocation(r, l);
    const list = loc?.dungeon?.blocks;
    if (!list?.length) continue;
    const id = indexOf.get(`${r}:${loc.name}`);
    if (id === undefined) continue;
    out[id] = list.map(b => [b.x, b.z, b.blockName.replace('.RDB', ''), b.isStartingBlock ? 1 : 0]);
    list.forEach(b => used.add(b.blockName));
    dungeons++;
  }
  if (Object.keys(out).length) writeOut(`data/dungeons/r${String(r).padStart(2, '0')}.json`, JSON.stringify(out));
}

// 2. each block's floors: every upward-facing polygon of every placed model, rasterised into height bands
const meshes = new Map();
const meshOf = id => {
  if (!meshes.has(id)) meshes.set(id, arch.getMesh(arch.getRecordIndex(id)));
  return meshes.get(id);
};
function fillTriangle(grid, a, b, c, bit) {
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(N - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(N - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-6) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
      const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) grid[y * N + x] |= bit;
    }
  }
}
const index = {};
const peopleIn = new Map();
let floorPixels = 0;
for (const name of [...used].sort()) {
  const blk = blocks.getBlockByName(name);
  const rdb = blk?.rdbBlock;
  if (!rdb) throw new Error(`block ${name} missing`);
  const grid = new Uint16Array(N * N);
  const start = [], quest = [], people = [];
  for (const obj of rdbObjects(rdb)) {
    if (obj.type === RDB_RESOURCE_TYPES.Flat) {
      const fr = obj.resources.flatResource;
      const at = () => [obj.xPos * GS, -obj.yPos * GS, obj.zPos * GS].map(v => Math.round(v * 10) / 10);
      if (fr?.textureArchive === 199 && fr.textureRecord === 10) start.push(at());
      if (fr?.textureArchive === 199 && (fr.textureRecord === 11 || fr.textureRecord === 18)) quest.push(at());
      if (fr && factions.getFaction(fr.factionOrMobileId)?.type === FACTION_TYPES.Individual) people.push([fr.factionOrMobileId, ...at()]);
      continue;
    }
    if (obj.type !== RDB_RESOURCE_TYPES.Model) continue;
    const m = getModelMatrix(obj);
    const mesh = meshOf(rdb.modelReferenceList[obj.resources.modelResource.modelIndex].modelIdNum);
    const tf = p => {
      const x = p.x * GS, y = -p.y * GS, z = p.z * GS;
      return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
    };
    for (const sm of mesh.subMeshes) {
      for (const pl of sm.planes) {
        const pts = pl.points;
        if (pts.length < 3) continue;
        // the plane's normal through the model's rotation; floors face up (+y)
        const n0 = pts[0], nx = n0.nx, ny = -n0.ny, nz = n0.nz;
        const ry = m[1] * nx + m[5] * ny + m[9] * nz;
        const len = Math.hypot(m[0] * nx + m[4] * ny + m[8] * nz, ry, m[2] * nx + m[6] * ny + m[10] * nz) || 1;
        if (ry / len < 0.6) continue;
        const w = pts.map(tf);
        const h = w.reduce((s, p) => s + p[1], 0) / w.length;
        const band = Math.max(0, Math.min(15, Math.floor(h / BAND)));
        const g = w.map(p => [p[0] / SIDE * N, (1 - p[2] / SIDE) * N]);
        for (let k = 1; k + 1 < g.length; k++) fillTriangle(grid, g[0], g[k], g[k + 1], 1 << band);
      }
    }
  }
  for (const v of grid) if (v) floorPixels++;
  writeOut(`data/rdb/${name.replace('.RDB', '')}.bin`, new Uint8Array(grid.buffer));
  index[name.replace('.RDB', '')] = { start, quest };
  if (people.length) peopleIn.set(name.replace('.RDB', ''), people);
}
writeOut('data/rdb/index.json', JSON.stringify(index));

// 3. fixed NPCs: town buildings (build-towns) + castle and dungeon spots (every dungeon using the block)
// a person found in more than one town is a stray id in a shared template, not a real placement
const individuals = Object.fromEntries(Object.entries(JSON.parse(readFileSync(join(ROOT, 'tools/.cache/individuals-towns.json'), 'utf8')))
  .filter(([, v]) => new Set(v.at.map(a => a[0])).size === 1));
for (let r = 0; r < maps.regionCount; r++) {
  let file;
  try { file = JSON.parse(readFileSync(join(SITE, `data/dungeons/r${String(r).padStart(2, '0')}.json`), 'utf8')); } catch { continue; }
  for (const [loc, list] of Object.entries(file))
    for (const [bx, bz, name] of list)
      for (const [id, x, y, z] of peopleIn.get(name) || [])
        (individuals[id] ||= { name: factions.getFaction(id)?.name ?? '', at: [] }).at.push([+loc, 'd', bx, bz, x, y, z]);
}
writeOut('data/individuals.json', JSON.stringify(individuals));
console.log(`${dungeons} dungeons, ${used.size} blocks, ${floorPixels} floor pixels; ${Object.keys(individuals).length} fixed NPCs placed`);
