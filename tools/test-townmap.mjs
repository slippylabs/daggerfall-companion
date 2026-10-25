// The town map draws only what stands in the town: every patch the map draws as a building (townBytes.js
// GROUP_OF_BYTE: house, shop, temple, tavern) must have the game's own 3D models under it. The models are laid
// out by DFO's rmbLayout with the online town packs open, flattened top-down onto the block's 64x64 automap
// grid. Blocks with a pack's own models (not in ARCH3D.BSA) are left out: their shapes can't be drawn here.
globalThis.location = { search: '?online=1' };
import { dfo, arena2, loadMaps } from './lib/env.mjs';
import { openTownPacks } from './lib/townPacks.mjs';
import { GROUP_OF_BYTE } from '../site/js/townBytes.js';

const { BlocksFile } = await dfo('src/formats/blocksFile.js');
const { Arch3dFile } = await dfo('src/formats/arch3dFile.js');
const { layoutLocation } = await dfo('src/world/locationLayout.js');
const blocks = new BlocksFile();
blocks.load(arena2('BLOCKS.BSA'));
const log = console.log;
console.log = () => {};
await openTownPacks(blocks);
console.log = log;
const maps = await loadMaps();
const arch = new Arch3dFile();
arch.load(arena2('ARCH3D.BSA'));
const meshes = new Map();
const meshOf = id => { if (!meshes.has(id)) { const i = arch.getRecordIndex(id); meshes.set(id, i < 0 ? null : arch.getMesh(i)); } return meshes.get(id); };
const GS = 1 / 40, SIDE = 102.4, PX = 64;
let pass = 0, fail = 0;
const check = (ok, what) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); };

// the block's models seen from above, a pixel's slack around each polygon
function footprint(models) {
  const out = new Uint8Array(PX * PX);
  for (const m of models) {
    const M = m.matrix;
    for (const sm of meshOf(m.modelIdNum).subMeshes) for (const pl of sm.planes) {
      const w = pl.points.map(p => {
        const x = p.x * GS, y = -p.y * GS, z = p.z * GS;
        return [(M[0] * x + M[4] * y + M[8] * z + M[12]) / SIDE * PX, (1 - (M[2] * x + M[6] * y + M[10] * z + M[14]) / SIDE) * PX];
      });
      for (let k = 1; k + 1 < w.length; k++) {
        const A = w[0], B = w[k], C = w[k + 1];
        const ar = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
        if (Math.abs(ar) < 1e-6) continue;
        for (let y = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]) - 1)); y <= Math.min(PX - 1, Math.ceil(Math.max(A[1], B[1], C[1]) + 1)); y++)
          for (let x = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]) - 1)); x <= Math.min(PX - 1, Math.ceil(Math.max(A[0], B[0], C[0]) + 1)); x++) {
            const px = x + 0.5, py = y + 0.5;
            const w0 = ((B[0] - px) * (C[1] - py) - (B[1] - py) * (C[0] - px)) / ar, w1 = ((C[0] - px) * (A[1] - py) - (C[1] - py) * (A[0] - px)) / ar;
            if (w0 >= -0.3 && w1 >= -0.3 && 1 - w0 - w1 >= -0.3) out[y * PX + x] = 1;
          }
      }
    }
  }
  return out;
}

// patches of one byte (4-connected) the given rule draws as a building, and how many have nothing under them
function ghosts(am, under, drawn) {
  const seen = new Uint8Array(PX * PX);
  let patches = 0, empty = 0;
  for (let i = 0; i < PX * PX; i++) {
    const v = am[i];
    if (!drawn(v) || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    let n = 0, covered = 0;
    while (stack.length) {
      const k = stack.pop();
      n++;
      if (under[k]) covered++;
      for (const j of [k + 1, k - 1, k + PX, k - PX])
        if (j >= 0 && j < PX * PX && !seen[j] && am[j] === v && Math.abs((j % PX) - (k % PX)) <= 1) { seen[j] = 1; stack.push(j); }
    }
    if (n < 6) continue;
    patches++;
    if (covered < 0.2 * n) empty++;
  }
  return { patches, empty };
}

const BUILT = new Set(['house', 'shop', 'temple', 'tavern']);
const now = v => BUILT.has(GROUP_OF_BYTE[v]);
const before = v => v !== 0 && v !== 0xfb;   // v2.4.0: every byte but street and ground flats was a building
const done = new Set(), tally = { now: { patches: 0, empty: 0 }, before: { patches: 0, empty: 0 } };
let checked = 0, skipped = 0;
for (let r = 0; r < maps.regionCount; r++) {
  const region = maps.getRegion(r);
  if (!region) continue;
  for (let l = 0; l < region.locationCount; l++) {
    const loc = maps.getLocation(r, l);
    if (!loc?.loaded || !loc.exterior?.buildingCount) continue;
    for (const blk of layoutLocation(loc, maps, blocks, { enhanced: true, windmills: true }).blocks) {
      if (done.has(blk.blockName)) continue;
      done.add(blk.blockName);
      if (blk.layout.models.some(m => !meshOf(m.modelIdNum))) { skipped++; continue; }
      checked++;
      const am = blk.dfBlock.rmbBlock.fldHeader.autoMapData, under = footprint(blk.layout.models);
      for (const [k, rule] of [['now', now], ['before', before]]) {
        const g = ghosts(am, under, rule);
        tally[k].patches += g.patches; tally[k].empty += g.empty;
      }
    }
  }
}
const { now: a, before: b } = tally;
check(checked > 300, `town blocks checked against their models: ${checked} (${skipped} hold a pack's own models)`);
check(a.patches > 1500 && a.empty / a.patches <= 0.01,
  `buildings drawn on the town map stand on real models: ${a.patches - a.empty}/${a.patches} (the v2.4.0 rule: ${b.patches - b.empty}/${b.patches})`);
check([25, 117, 224, 250, 251].every(v => !GROUP_OF_BYTE[v]), 'scenery bytes (ships, wagons, yards, ground flats) are not drawn as buildings');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
