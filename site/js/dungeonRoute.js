// Walking routes through a dungeon, on the walk grids of its blocks (tools/build-walk.mjs: per block 128x128
// pixels of 0.4 units, up to L standing layers, each with its height and its links to the four neighbours).
// The blocks join at their edges by the same rule the build uses inside a block: a small enough step.
export const N = 128, L = 6, HQ = 0.2, SIDE = 51.2;
export let STEP = 1.0;
export const setStep = s => { STEP = s; };
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // N E S W, image rows running north to south

// list: the dungeon's blocks [[bx, bz, name, isStart]]; walks: {name: Uint8Array (the .walk.bin bytes)}
export function makeGrid(list, walks) {
  const minX = Math.min(...list.map(b => b[0])), maxX = Math.max(...list.map(b => b[0]));
  const minZ = Math.min(...list.map(b => b[1])), maxZ = Math.max(...list.map(b => b[1]));
  const BW = maxX - minX + 1, BH = maxZ - minZ + 1, W = BW * N, H = BH * N;
  const cell = new Array(BW * BH).fill(null);
  for (const [bx, bz, name] of list) {
    const bytes = walks[name];
    if (!bytes) continue;
    cell[(maxZ - bz) * BW + (bx - minX)] = { h: bytes.subarray(0, L * N * N), m: new Uint16Array(bytes.buffer, bytes.byteOffset + L * N * N, L * N * N) };
  }
  const at = (gx, gy) => (gx < 0 || gy < 0 || gx >= W || gy >= H ? null : cell[Math.floor(gy / N) * BW + Math.floor(gx / N)]);
  const height = (gx, gy, l) => { const c = at(gx, gy); return c ? c.h[l * N * N + (gy % N) * N + (gx % N)] : 0; };
  // the walkable neighbours of a node: [gx, gy, layer]
  function neighbours(gx, gy, l, out) {
    out.length = 0;
    const c = at(gx, gy);
    if (!c) return out;
    const p = (gy % N) * N + (gx % N), hv = c.h[l * N * N + p], m = c.m[l * N * N + p];
    for (let d = 0; d < 4; d++) {
      const nx = gx + DIRS[d][0], ny = gy + DIRS[d][1];
      const k = (m >> (d * 4)) & 15;
      if (k) { out.push(nx, ny, k - 1); continue; }
      // across a block edge: the neighbour block's layer within a step
      if (Math.floor(nx / N) === Math.floor(gx / N) && Math.floor(ny / N) === Math.floor(gy / N)) continue;
      let best = -1, bestD = STEP / HQ + 0.01;
      for (let j = 0; j < L; j++) { const qv = height(nx, ny, j); if (qv && Math.abs(qv - hv) <= bestD) { bestD = Math.abs(qv - hv); best = j; } }
      if (best >= 0) out.push(nx, ny, best);
    }
    return out;
  }
  // a block-local point (x, y, z units) as the node a person standing there is on: the floor just under it
  function nodeAt(bx, bz, x, y, z) {
    const gx0 = (bx - minX) * N + Math.floor(x / SIDE * N), gy0 = (maxZ - bz) * N + Math.floor((1 - z / SIDE) * N);
    for (let r = 0; r <= 4; r++) {
      let best = null, bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        for (let l = 0; l < L; l++) {
          const hv = height(gx0 + dx, gy0 + dy, l);
          if (!hv) continue;
          const h = (hv - 1) * HQ, d = y - h;
          if (d < -1 || d > 3.5) continue;   // a floor below the point, as a standing person or a marker floats
          if (d < bestD) { bestD = d; best = [gx0 + dx, gy0 + dy, l]; }
        }
      }
      if (best) return best;
    }
    return null;
  }
  return { W, H, minX, maxZ, height, neighbours, nodeAt, key: (gx, gy, l) => (gy * W + gx) * L + l };
}

// every node reachable from a start (for the build's oracle); returns a Set of keys
export function reachable(g, start) {
  const seen = new Set([g.key(...start)]), stack = [start], nb = [];
  while (stack.length) {
    const [x, y, l] = stack.pop();
    g.neighbours(x, y, l, nb);
    for (let i = 0; i < nb.length; i += 3) {
      const k = g.key(nb[i], nb[i + 1], nb[i + 2]);
      if (!seen.has(k)) { seen.add(k); stack.push([nb[i], nb[i + 1], nb[i + 2]]); }
    }
  }
  return seen;
}

// A* from a node to a node: [[gx, gy, heightUnits], ...] or null. Cost: distance, a little extra for climbing
export function route(g, from, to) {
  const hOf = (x, y, l) => (g.height(x, y, l) - 1) * HQ;
  const goal = g.key(...to), tx = to[0], ty = to[1], th = hOf(...to);
  const est = (x, y, l) => Math.hypot(x - tx, y - ty) + Math.abs(hOf(x, y, l) - th) / 0.4;
  const cost = new Map([[g.key(...from), 0]]), prev = new Map();
  // binary heap of [f, x, y, l]
  const heap = [[est(...from), ...from]];
  const push = n => { heap.push(n); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
    return top;
  };
  const nb = [];
  let expanded = 0;
  while (heap.length && expanded < 3e6) {
    const [, x, y, l] = pop();
    const k = g.key(x, y, l);
    if (k === goal) {
      const path = [];
      for (let c = k; c !== undefined; c = prev.get(c)) {
        const ll = c % L, cell = (c - ll) / L, cx = cell % g.W, cy = (cell - cx) / g.W;
        path.push([cx, cy, hOf(cx, cy, ll)]);
      }
      return path.reverse();
    }
    expanded++;
    const base = cost.get(k), h0 = hOf(x, y, l);
    g.neighbours(x, y, l, nb);
    for (let i = 0; i < nb.length; i += 3) {
      const nx = nb[i], ny = nb[i + 1], nl = nb[i + 2], nk = g.key(nx, ny, nl);
      // a climb or a drop (a height change past a step) costs a lot, so a route takes stairs where it can
      const dh = hOf(nx, ny, nl) - h0;
      const c = base + 1 + Math.abs(dh) * 0.5 + (dh > STEP ? 12 + dh * 4 : dh < -STEP ? 6 + -dh * 1.5 : 0);
      if (c < (cost.get(nk) ?? Infinity)) { cost.set(nk, c); prev.set(nk, k); push([c + est(nx, ny, nl), nx, ny, nl]); }
    }
  }
  return null;
}

// a route in words: its length, the stairs and ramps taken up and down (height changes of a few units), and the
// places it climbs a wall or drops off a ledge (single steps past a stair's)
export function describe(path) {
  const metres = (path.length - 1) * (SIDE / N);
  let downs = 0, ups = 0, base = path[0][2];
  const climbs = [], drops = [];
  for (let i = 1; i < path.length; i++) {
    const dh = path[i][2] - path[i - 1][2];
    if (dh > STEP) { climbs.push({ at: i, m: dh }); base = path[i][2]; continue; }
    if (dh < -STEP) { drops.push({ at: i, m: -dh }); base = path[i][2]; continue; }
    const h = path[i][2];
    if (h < base - 2.8) { downs++; base = h; } else if (h > base + 2.8) { ups++; base = h; }
  }
  return { metres, downs, ups, climbs, drops };
}
