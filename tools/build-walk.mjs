// Walk grids for dungeon routes: data/rdb/<BLOCK>.walk.bin per RDB block, from the same placed models as the
// floor maps (build-dungeons.mjs). 128x128 pixels a block (0.4 units each), up to L standing layers a pixel:
//   heights: Uint8[L][128*128]  - 0 none, else round(y / 0.2) + 1 (block-local y, 0..51)
//   links:   Uint16[L][128*128] - four nibbles N, E, S, W: 0 no way, k = the neighbour's layer k-1 is walkable
// Walkable = up-facing polygons (normal y > 0.5: floors, ramps, stair treads), with their own height per pixel.
// Walls = near-vertical polygons at least WALL_MIN tall (shorter ones are stair risers and curbs) of every model
// except doors and moving parts (DFU's action doors, any model with
// an action - a secret wall, a lift - is something the player opens or rides). A pixel a wall crosses at body
// height above a layer is no standing place on that layer. Neighbouring layers join when the step is small.
import { dfo, arena2, writeOut } from './lib/env.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE } from './lib/env.mjs';

const { BlocksFile, RDB_RESOURCE_TYPES } = await dfo('src/formats/blocksFile.js');
const { Arch3dFile } = await dfo('src/formats/arch3dFile.js');
const { getModelMatrix, rdbObjects, isActionDoor, rdbModelActs, EXIT_DOOR_MODEL_ID } = await dfo('src/world/rdbLayout.js');

export const GS = 1 / 40, SIDE = 51.2, N = 128, L = 6, HQ = 0.2;
export const WALK_UP = +(process.env.WALK_UP || 0.5);
export const CLIMB = +(process.env.WALK_CLIMB ?? 8);
export const DROP = +(process.env.WALK_DROP || 30);
export const WALL_MIN = +(process.env.WALK_WALLMIN || 1.3);
export const STEP = +(process.env.WALK_STEP || 1.0), BODY_LO = +(process.env.WALK_LO || 0.45), BODY_HI = +(process.env.WALK_HI || 1.7);
const blocks = new BlocksFile();
blocks.load(arena2('BLOCKS.BSA'));
const arch = new Arch3dFile();
arch.load(arena2('ARCH3D.BSA'));
const meshes = new Map();
const meshOf = id => { if (!meshes.has(id)) meshes.set(id, arch.getMesh(arch.getRecordIndex(id))); return meshes.get(id); };

const names = Object.keys(JSON.parse(readFileSync(join(SITE, 'data/rdb/index.json'), 'utf8')));

function triangles(pts, fn) { for (let k = 1; k + 1 < pts.length; k++) fn(pts[0], pts[k], pts[k + 1]); }
// every pixel centre inside the triangle, with the triangle's height there
function fillTri(a, b, c, put) {
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(N - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(N - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-6) return;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
    const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
    const w2 = 1 - w0 - w1;
    if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) put(x, y, w0 * a[2] + w1 * b[2] + w2 * c[2]);
  }
}
// every pixel a segment passes through (supercover, so a 4-neighbour step cannot slip past a diagonal wall)
function line(x0, y0, x1, y1, put) {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) + 1;
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = Math.floor(x0 + (x1 - x0) * t), y = Math.floor(y0 + (y1 - y0) * t);
    if (x >= 0 && y >= 0 && x < N && y < N) put(x, y);
  }
}

// A vertical polygon, slice by slice along its length: at each point the height range the wall really fills
// there. A wall with a doorway is one polygon with a notch, so across the opening only the lintel remains, high
// over a walker's head - the polygon's whole range would have shut every doorway.
function wallSlices(w, put) {
  let a = 0, b = 1, far = -1;
  for (let i = 0; i < w.length; i++) for (let j = i + 1; j < w.length; j++) {
    const d = Math.hypot(w[i][0] - w[j][0], w[i][1] - w[j][1]);
    if (d > far) { far = d; a = i; b = j; }
  }
  if (far < 1e-6) {   // seen edge-on from above: a post; it fills its own height at its one pixel
    const x = Math.floor(w[0][0]), y = Math.floor(w[0][1]);
    if (x >= 0 && y >= 0 && x < N && y < N) put(x, y, Math.min(...w.map(p => p[2])), Math.max(...w.map(p => p[2])));
    return;
  }
  const ox = w[a][0], oy = w[a][1], dx = (w[b][0] - ox) / far, dy = (w[b][1] - oy) / far;
  const t = w.map(p => (p[0] - ox) * dx + (p[1] - oy) * dy);
  const steps = Math.ceil(far * 2) + 1;
  for (let s = 0; s <= steps; s++) {
    const ts = (s / steps) * far;
    let ylo = Infinity, yhi = -Infinity;
    for (let k = 0; k < w.length; k++) {
      const k2 = (k + 1) % w.length, t0 = t[k], t1 = t[k2];
      if ((ts < Math.min(t0, t1) - 1e-6) || (ts > Math.max(t0, t1) + 1e-6)) continue;
      const y = Math.abs(t1 - t0) < 1e-6 ? null : w[k][2] + (w[k2][2] - w[k][2]) * (ts - t0) / (t1 - t0);
      for (const v of y === null ? [w[k][2], w[k2][2]] : [y]) { ylo = Math.min(ylo, v); yhi = Math.max(yhi, v); }
    }
    if (ylo > yhi) continue;
    const px = ox + dx * ts, py = oy + dy * ts;
    // the slice's pixel, and the ones a 4-neighbour step could slip through diagonally
    for (const [qx, qy] of [[px, py], [px + 0.5 * dy, py - 0.5 * dx], [px - 0.5 * dy, py + 0.5 * dx]]) {
      const x = Math.floor(qx), y = Math.floor(qy);
      if (x >= 0 && y >= 0 && x < N && y < N) put(x, y, ylo, yhi);
    }
  }
}

export function buildBlock(name) {
  const rdb = blocks.getBlockByName(name + '.RDB')?.rdbBlock;
  if (!rdb) throw new Error(`block ${name} missing`);
  const floors = Array.from({ length: N * N }, () => []);   // heights per pixel
  const walls = Array.from({ length: N * N }, () => []);    // [ymin, ymax] spans per pixel
  for (const obj of rdbObjects(rdb)) {
    if (obj.type !== RDB_RESOURCE_TYPES.Model) continue;
    const ref = obj.resources.modelResource.modelIndex;
    const id = rdb.modelReferenceList[ref].modelIdNum;
    const opens = isActionDoor(rdb, ref) || rdbModelActs(obj) || id === EXIT_DOOR_MODEL_ID;
    const m = getModelMatrix(obj);
    const tf = p => {
      const x = p.x * GS, y = -p.y * GS, z = p.z * GS;
      const wx = m[0] * x + m[4] * y + m[8] * z + m[12], wy = m[1] * x + m[5] * y + m[9] * z + m[13], wz = m[2] * x + m[6] * y + m[10] * z + m[14];
      return [wx / SIDE * N, (1 - wz / SIDE) * N, wy];
    };
    for (const sm of meshOf(id).subMeshes) for (const pl of sm.planes) {
      const pts = pl.points;
      if (pts.length < 3) continue;
      // the slope from the polygon's own corners (the models' stored normals are unreliable for it); the stored
      // normal only says which way the face looks: up (a floor, a ramp) or down (a ceiling)
      const n0 = pts[0], nx = n0.nx, ny = -n0.ny, nz = n0.nz;
      const ry = m[1] * nx + m[5] * ny + m[9] * nz;
      const w = pts.map(tf);
      const toU = p => [p[0] * SIDE / N, p[2], (N - p[1]) * SIDE / N];   // back to units: x, y up, z
      let gx = 0, gy = 0, gz = 0;
      for (let k = 0; k < w.length; k++) {   // Newell's normal, robust for any polygon
        const a = toU(w[k]), b = toU(w[(k + 1) % w.length]);
        gx += (a[1] - b[1]) * (a[2] + b[2]); gy += (a[2] - b[2]) * (a[0] + b[0]); gz += (a[0] - b[0]) * (a[1] + b[1]);
      }
      const glen = Math.hypot(gx, gy, gz);
      if (!glen) continue;
      const up = (Math.abs(gy) / glen) * (ry >= 0 ? 1 : -1);
      if (up > WALK_UP) triangles(w, (a, b, c) => fillTri(a, b, c, (x, y, h) => floors[y * N + x].push(h)));
      else if (Math.abs(up) < 0.35 && !opens) {
        const lo = Math.min(...w.map(p => p[2])), hi = Math.max(...w.map(p => p[2]));
        if (hi - lo < WALL_MIN) continue;   // a stair riser or a curb: something to step up, not a wall
        wallSlices(w, (x, y, ylo, yhi) => walls[y * N + x].push([ylo, yhi]));
      }
    }
  }
  // standing layers: distinct floor heights (closer than a step merge, the higher kept), minus wall-blocked ones
  const heights = new Uint8Array(L * N * N), links = new Uint16Array(L * N * N);
  let dropped = 0;
  for (let p = 0; p < N * N; p++) {
    const hs = floors[p].sort((a, b) => a - b), layers = [];
    for (const h of hs) { if (layers.length && h - layers[layers.length - 1] < 0.3) layers[layers.length - 1] = h; else layers.push(h); }
    const free = layers.filter(h => !walls[p].some(([lo, hi]) => lo < h + BODY_HI && hi > h + BODY_LO));
    if (free.length > L) dropped += free.length - L;
    free.slice(-L).forEach((h, i) => { heights[i * N * N + p] = Math.max(1, Math.min(255, Math.round(h / HQ) + 1)); });
  }
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // N E S W (image rows run north to south)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const p = y * N + x;
    for (let i = 0; i < L; i++) {
      const hv = heights[i * N * N + p];
      if (!hv) continue;
      let mask = 0;
      DIRS.forEach(([dx, dy], d) => {
        const qx = x + dx, qy = y + dy;
        if (qx < 0 || qy < 0 || qx >= N || qy >= N) return;
        const q = qy * N + qx;
        let best = -1, bestD = STEP / HQ + 0.01;
        for (let j = 0; j < L; j++) {
          const qv = heights[j * N * N + q];
          if (qv && Math.abs(qv - hv) <= bestD) { bestD = Math.abs(qv - hv); best = j; }
        }
        // nothing level next door: a drop to the floor below (Daggerfall's ledges and holes - one way, down), else
        // a climb up a short wall (Daggerfall's Climbing; the route marks it)
        if (best < 0) {
          let top = 0;
          for (let j = 0; j < L; j++) { const qv = heights[j * N * N + q]; if (qv && qv < hv && hv - qv <= DROP / HQ && qv > top) { top = qv; best = j; } }
        }
        if (best < 0 && CLIMB > 0) {
          let low = 999;
          for (let j = 0; j < L; j++) { const qv = heights[j * N * N + q]; if (qv && qv > hv && qv - hv <= CLIMB / HQ && qv < low) { low = qv; best = j; } }
        }
        if (best >= 0) mask |= (best + 1) << (d * 4);
      });
      links[i * N * N + p] = mask;
    }
  }
  return { heights, links, dropped, walls, floors };
}

if (process.argv[1]?.endsWith('build-walk.mjs')) {
  let total = 0, dropped = 0;
  for (const name of names) {
    const { heights, links, dropped: d } = buildBlock(name);
    const out = new Uint8Array(heights.length + links.byteLength);
    out.set(heights, 0);
    out.set(new Uint8Array(links.buffer), heights.length);
    writeOut(`data/rdb/${name}.walk.bin`, out);
    total += out.length; dropped += d;
  }
  console.log(`${names.length} walk grids, ${(total / 1e6).toFixed(1)} MB raw; layers beyond ${L} dropped at ${dropped} pixels`);
}
