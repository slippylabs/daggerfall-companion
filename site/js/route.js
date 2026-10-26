// Route planner: the order to visit a set of places from where the player stands, using the game's own
// travel times. Exact (Held-Karp) up to 12 stops; nearest neighbour + 2-opt beyond that.
// A stop can name stops that must come before it (a quest's reward after its job is done).
import { travelBetween } from './data.js?v=23';

// stops: [{loc, deadlineMin?, after?: [stop index...]}]; returns {order: [index...], legs: [minutes...], total, late: [index...]}
export function planRoute(start, stops, opts, { returnHome = false } = {}) {
  const pts = [start, ...stops.map(s => s.loc)];
  const n = pts.length;
  const cost = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let a = 0; a < n; a++)
    for (let b = 0; b < n; b++)
      if (a !== b) cost[a][b] = pts[a] === pts[b] ? 0 : travelBetween(pts[a], pts[b], opts).minutes;
  // pre[k]: bitmask (over stops) of the stops that must be visited before stop k; 31 bits, so
  // beyond 30 stops the order is not constrained
  const pre = stops.map(s => stops.length > 30 ? 0 : (s.after || []).reduce((m, i) => m | (1 << i), 0));

  const fastest = stops.length <= 12 ? heldKarp(cost, pre, returnHome) : twoOpt(cost, pre, nearest(cost, pre), returnHome);
  let best = evaluate(fastest, cost, stops, returnHome);
  if (best.late.length) {
    // Deadline-first: the most urgent stops first, nearest-first among stops without a deadline
    const byDeadline = [...stops.keys()].sort((a, b) =>
      (stops[a].deadlineMin ?? Infinity) - (stops[b].deadlineMin ?? Infinity)).map(i => i + 1);
    const alt = evaluate(respectOrder(byDeadline, pre), cost, stops, returnHome);
    if (alt.late.length < best.late.length || (alt.late.length === best.late.length && alt.total < best.total)) best = alt;
  }
  return best;
}

const ready = (pre, p, mask) => (pre[p - 1] & mask) === pre[p - 1];

// order: point indices (1-based into pts, i.e. stop i+1)
function evaluate(order, cost, stops, returnHome) {
  const legs = [];
  const late = [];
  let at = 0, clock = 0;
  for (const p of order) {
    const m = cost[at][p];
    legs.push(m);
    clock += m;
    const dl = stops[p - 1].deadlineMin;
    if (dl != null && clock > dl) late.push(p - 1);
    at = p;
  }
  if (returnHome) { legs.push(cost[at][0]); clock += cost[at][0]; }
  return { order: order.map(p => p - 1), legs, total: clock, late };
}

// Keep a preferred order, but hold each stop back until the stops it needs have come first
function respectOrder(order, pre) {
  const left = [...order], out = [];
  let mask = 0;
  while (left.length) {
    const i = Math.max(0, left.findIndex(p => ready(pre, p, mask)));
    const [p] = left.splice(i, 1);
    out.push(p);
    mask |= 1 << (p - 1);
  }
  return out;
}

function heldKarp(cost, pre, returnHome) {
  const n = cost.length, m = n - 1;
  if (m === 0) return [];
  const FULL = 1 << m;
  const dp = new Float64Array(FULL * m).fill(Infinity);
  const parent = new Int8Array(FULL * m).fill(-1);
  for (let j = 0; j < m; j++) if (!pre[j]) dp[(1 << j) * m + j] = cost[0][j + 1];
  for (let mask = 1; mask < FULL; mask++) {
    for (let j = 0; j < m; j++) {
      if (!(mask & (1 << j))) continue;
      const cur = dp[mask * m + j];
      if (cur === Infinity) continue;
      for (let k = 0; k < m; k++) {
        if (mask & (1 << k) || (pre[k] & mask) !== pre[k]) continue;
        const nm = mask | (1 << k), v = cur + cost[j + 1][k + 1];
        if (v < dp[nm * m + k]) { dp[nm * m + k] = v; parent[nm * m + k] = j; }
      }
    }
  }
  let bestJ = 0, bestV = Infinity;
  for (let j = 0; j < m; j++) {
    const v = dp[(FULL - 1) * m + j] + (returnHome ? cost[j + 1][0] : 0);
    if (v < bestV) { bestV = v; bestJ = j; }
  }
  const order = [];
  let mask = FULL - 1, j = bestJ;
  while (j >= 0) {
    order.push(j + 1);
    const pj = parent[mask * m + j];
    mask &= ~(1 << j);
    j = pj;
  }
  return order.reverse();
}

function nearest(cost, pre) {
  const n = cost.length, left = new Set([...Array(n).keys()].slice(1)), order = [];
  let at = 0, mask = 0;
  while (left.size) {
    let best = -1;
    for (const p of left) {
      if (!ready(pre, p, mask)) continue;
      if (best < 0 || cost[at][p] < cost[at][best]) best = p;
    }
    if (best < 0) best = left.values().next().value;
    order.push(best); left.delete(best); at = best; mask |= 1 << (best - 1);
  }
  return order;
}

function twoOpt(cost, pre, order, returnHome) {
  const len = o => {
    let t = 0, at = 0, mask = 0;
    for (const p of o) {
      if (!ready(pre, p, mask)) return Infinity;
      t += cost[at][p]; at = p; mask |= 1 << (p - 1);
    }
    return t + (returnHome ? cost[at][0] : 0);
  };
  let best = order, bestLen = len(order), improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        const l = len(cand);
        if (l < bestLen) { best = cand; bestLen = l; improved = true; }
      }
    }
  }
  return best;
}
