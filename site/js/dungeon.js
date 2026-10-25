// Dungeon maps: the floors of a dungeon's blocks seen from above (tools/build-dungeons.mjs), the entrance, and,
// from a save, the exact spot the quest put its person, foe or item. One level at a time or all at once.
import { data } from './data.js?v=14';
import { el, fill } from './ui.js?v=14';
import { makeGrid, route, describe } from './dungeonRoute.js?v=14';

const SIDE = 51.2, N = 128, BAND = 3.2;
const V = '1';
const cache = { regions: {}, blocks: {}, walks: {}, index: null };
const getJson = p => fetch(`${p}?v=${V}`).then(r => { if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.json(); });

export async function dungeonBlocks(i) {
  const r = data.locs.region[i];
  cache.regions[r] ||= getJson(`data/dungeons/r${String(r).padStart(2, '0')}.json`).catch(() => ({}));
  return (await cache.regions[r])[i] || null;
}
const walkGrid = name => (cache.walks[name] ||= fetch(`data/rdb/${name}.walk.bin?v=1`)
  .then(r => (r.ok ? r.arrayBuffer() : null)).then(b => (b ? new Uint8Array(b) : null)).catch(() => null));
const blockGrid = name => (cache.blocks[name] ||= fetch(`data/rdb/${name}.bin?v=${V}`)
  .then(r => r.arrayBuffer()).then(b => new Uint16Array(b)));
const blockIndex = () => (cache.index ||= getJson('data/rdb/index.json'));

// The floor band a marker stands on: the highest floor at or just under it (markers float a little)
function standingBand(grid, x, y, z) {
  const px = Math.min(N - 1, Math.max(0, Math.floor(x / SIDE * N))), py = Math.min(N - 1, Math.max(0, Math.floor((1 - z / SIDE) * N)));
  const top = Math.max(0, Math.min(15, Math.floor(y / BAND)));
  for (let k = top; k >= Math.max(0, top - 3); k--)
    for (let d = 0; d <= 3; d++)
      for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
        const X = px + dx, Y = py + dy;
        if (X >= 0 && Y >= 0 && X < N && Y < N && (grid[Y * N + X] >> k) & 1) return k;
      }
  return top;
}

const DIRS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
function directions(from, to) {
  // height by the floors both stand on, as the level picker counts it
  const dx = to.wx - from.wx, dz = to.wz - from.wz, dy = (to.band - from.band) * BAND;
  const m = Math.hypot(dx, dz);
  const flat = m < 8 ? 'right by the entrance' : `${DIRS[(Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) + 8) % 8]} of the entrance, about ${Math.round(m / 5) * 5} m as the crow flies`;
  const lvl = Math.abs(dy) < 2.5 ? 'on the same level' : `about ${Math.round(Math.abs(dy))} m ${dy < 0 ? 'lower' : 'higher'}`;
  return `${flat}, ${lvl}`;
}

// Draws dungeon `i` into `box`. targets: [{bx, bz, x, y, z, label}] block coordinates and block-local units
export async function showDungeon(box, i, targets = []) {
  const list = await dungeonBlocks(i);
  if (!list) { fill(box, el('p', { class: 'tool-note', text: 'No dungeon map for this place.' })); return false; }
  const [grids, index] = await Promise.all([Promise.all(list.map(b => blockGrid(b[2]))), blockIndex()]);
  const minX = Math.min(...list.map(b => b[0])), maxX = Math.max(...list.map(b => b[0]));
  const minZ = Math.min(...list.map(b => b[1])), maxZ = Math.max(...list.map(b => b[1]));
  const W = (maxX - minX + 1) * N, H = (maxZ - minZ + 1) * N;
  const gridAt = (bx, bz) => grids[list.findIndex(b => b[0] === bx && b[1] === bz)];

  // world units (x east, z north) of a block-local point, and its place on the composed image
  const world = (bx, bz, x, y, z) => ({ wx: bx * SIDE + x, wy: y, wz: bz * SIDE + z,
    ix: (bx - minX) * N + x / SIDE * N, iy: (maxZ - bz) * N + (1 - z / SIDE) * N });
  const startBlock = list.find(b => b[3]);
  const s0 = startBlock && index[startBlock[2]]?.start?.[0];
  const entrance = s0 ? { ...world(startBlock[0], startBlock[1], ...s0), band: standingBand(gridAt(startBlock[0], startBlock[1]), ...s0) } : null;
  const marks = targets.map(t => {
    const g = gridAt(t.bx, t.bz);
    return g ? { ...world(t.bx, t.bz, t.x, t.y, t.z), band: standingBand(g, t.x, t.y, t.z), label: t.label } : null;
  }).filter(Boolean);

  // the walking route from the entrance to the (first) quest target, found once the walk grids are in
  let path = null, trip = null, routeDone = !marks.length || !entrance;
  let used = 0;
  for (const g of grids) for (const v of g) used |= v;
  const bands = [...Array(16).keys()].filter(k => (used >> k) & 1);
  let level = marks[0]?.band ?? -1;   // -1: every level, lighter = higher

  // the composed floor image, redrawn when the level changes
  const img = document.createElement('canvas');
  img.width = W; img.height = H;
  const ictx = img.getContext('2d');
  function compose() {
    const out = ictx.createImageData(W, H), px = out.data;
    for (let k = 0; k < px.length; k += 4) { px[k] = 18; px[k + 1] = 18; px[k + 2] = 24; px[k + 3] = 255; }
    list.forEach(([bx, bz, , start], n) => {
      const g = grids[n], ox = (bx - minX) * N, oy = (maxZ - bz) * N;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const v = g[y * N + x];
        if (!v) continue;
        const o = ((oy + y) * W + ox + x) * 4;
        let c;
        if (level < 0) { const t = (31 - Math.clz32(v)) / 15; c = [70 + t * 150, 80 + t * 140, 95 + t * 130]; }
        else if ((v >> level) & 1 || (level > 0 && (v >> (level - 1)) & 1)) c = [222, 196, 140];
        else c = [58, 60, 70];
        if (start && level < 0) c = [c[0], c[1] * 0.9, c[2] * 0.6];
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2];
      }
    });
    ictx.putImageData(out, 0, 0);
  }

  const canvas = el('canvas', { class: 'dg-dungeon-map' });
  const ctx = canvas.getContext('2d');
  const view = { zoom: 1, ox: 0, oy: 0 };
  function draw() {
    const wrap = canvas.parentElement;
    if (!wrap) return;
    const w = Math.max(240, wrap.clientWidth - 6), h = Math.round(Math.min(w * 0.8, 600));
    canvas.width = Math.round(w * devicePixelRatio); canvas.height = Math.round(h * devicePixelRatio);
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    const base = Math.min(canvas.width / W, canvas.height / H) * 0.94, s = base * view.zoom;
    const ox = (canvas.width - W * s) / 2 + view.ox, oy = (canvas.height - H * s) / 2 + view.oy;
    ctx.fillStyle = '#0d0d10'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, ox, oy, W * s, H * s);
    const pin = (p, colour, label) => {
      const x = ox + p.ix * s, y = oy + p.iy * s, r = Math.max(6 * devicePixelRatio, 4 * s);
      ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5 * devicePixelRatio; ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, Math.PI * 2); ctx.stroke();
      ctx.font = `600 ${14 * devicePixelRatio}px 'EB Garamond', Georgia, serif`;
      const tw = ctx.measureText(label).width, ring = r * 1.6;
      const lx = x + ring + 6 + tw + 4 <= canvas.width ? x + ring + 6 : Math.max(4, x - ring - 6 - tw);
      ctx.fillStyle = 'rgba(231,212,168,0.95)'; ctx.fillRect(lx - 4, y - 10 * devicePixelRatio, tw + 8, 18 * devicePixelRatio);
      ctx.fillStyle = '#2a1a0b'; ctx.fillText(label, lx, y + 4 * devicePixelRatio);
    };
    if (path) drawRoute(ox, oy, s);
    if (entrance) pin(entrance, '#5ab8ff', 'Entrance');
    marks.forEach(m => pin(m, '#ff4655', m.label));
    ctx.fillStyle = 'rgba(217,251,232,0.8)';
    ctx.font = `bold ${12 * devicePixelRatio}px 'EB Garamond', Georgia, serif`;
    ctx.fillText('N ↑', canvas.width - 40 * devicePixelRatio, 16 * devicePixelRatio);
  }
  // the route: a gold line with a dark casing, solid on the shown level, dashed where it runs above or below it;
  // a climb is marked ▲ and a drop ▼
  function drawRoute(ox, oy, s) {
    const onLevel = h => level < 0 || Math.abs(Math.floor(h / BAND) - level) <= 1;
    const pt = p => [ox + (p[0] + 0.5) * s, oy + (p[1] + 0.5) * s];
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const pass of [0, 1]) {
      for (let i = 1; i < path.length; i++) {
        const on = onLevel(path[i][2]);
        ctx.setLineDash(on ? [] : [4 * devicePixelRatio, 4 * devicePixelRatio]);
        ctx.strokeStyle = pass ? (on ? '#f2cd52' : 'rgba(242,205,82,0.55)') : 'rgba(20,10,0,0.85)';
        ctx.lineWidth = (pass ? 3.4 : 6.4) * devicePixelRatio;
        ctx.beginPath(); ctx.moveTo(...pt(path[i - 1])); ctx.lineTo(...pt(path[i])); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.font = `700 ${13 * devicePixelRatio}px Georgia, serif`;
    for (const c of trip.climbs) mark(pt(path[c.at]), '▲', '#3a8f3a');
    for (const d of trip.drops) mark(pt(path[d.at]), '▼', '#b03020');
    function mark([x, y], ch, colour) {
      ctx.fillStyle = 'rgba(238,222,190,0.95)'; ctx.beginPath(); ctx.arc(x, y, 8 * devicePixelRatio, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = colour; ctx.textAlign = 'center'; ctx.fillText(ch, x, y + 5 * devicePixelRatio); ctx.textAlign = 'start';
    }
  }
  // drag to pan, wheel or buttons to zoom
  const pointers = new Map();
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); });
  canvas.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    view.ox += (e.clientX - p[0]) * devicePixelRatio; view.oy += (e.clientY - p[1]) * devicePixelRatio;
    pointers.set(e.pointerId, [e.clientX, e.clientY]); draw();
  });
  const up = e => pointers.delete(e.pointerId);
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
  function zoom(f) { const z = Math.max(1, Math.min(8, view.zoom * f)); view.ox *= z / view.zoom; view.oy *= z / view.zoom; view.zoom = z; draw(); }

  const levelSel = el('select', { class: 'tool-select dg-level', 'aria-label': 'Level',
    onchange: e => { level = +e.target.value; compose(); draw(); } },
  el('option', { value: -1 }, 'All levels (lighter = higher)'),
  ...[...bands].reverse().map(k => el('option', { value: k }, heightWord(k)
    + (marks.some(m => m.band === k) ? ' — quest target' : ''))));
  levelSel.value = String(level);
  // a height band named by where it is against the entrance (bands are 3.2 m slices, not the game's own floors)
  function heightWord(k) {
    if (!entrance) return `Height ${Math.round(k * BAND)} m`;
    const d = Math.round((k - entrance.band) * BAND);
    return d === 0 ? 'Entrance level' : `${Math.abs(d)} m ${d > 0 ? 'above' : 'below'} the entrance`;
  }

  const routeLine = el('div', { class: 'dg-route-line', text: routeDone ? '' : 'Finding the way through the corridors…' });
  compose();
  fill(box,
    marks.length && entrance ? el('div', { class: 'dg-reward dg-town-mark' },
      el('div', { class: 'dg-reward-label', text: 'Your quest target' }),
      ...marks.map(m => el('div', {}, el('b', { text: m.label }), ` is ${directions(entrance, m)}.`)),
      routeLine,
      el('div', { class: 'dg-dim', text: 'Follow the gold line from the blue entrance to the red pin; it is solid on the level shown and dashed above or below it.' })) : null,
    !marks.length && targets.length ? el('p', { class: 'tool-note', text: 'The quest spot is not on this map.' }) : null,
    el('div', { class: 'tool-controls dg-dungeon-controls' },
      levelSel,
      el('button', { class: 'tool-btn', 'aria-label': 'Zoom out', onclick: () => zoom(1 / 1.5) }, '−'),
      el('button', { class: 'tool-btn', 'aria-label': 'Zoom in', onclick: () => zoom(1.5) }, '+')),
    el('div', { class: 'dg-dungeon-wrap' }, canvas),
    el('p', { class: 'tool-note', text: `${list.length} blocks, ${Math.round((bands[bands.length - 1] - bands[0] + 1) * BAND)} m from top to bottom, drawn from the game's own dungeon models. Blue: where you come in. Drag to move, wheel or +/− to zoom.` }));
  new ResizeObserver(draw).observe(canvas.parentElement);
  draw();
  if (!routeDone) findRoute();
  return true;

  async function findRoute() {
    const walks = {};
    await Promise.all(list.map(async b => { walks[b[2]] = await walkGrid(b[2]); }));
    const g = makeGrid(list, walks);
    const s0b = list.find(b => b[3]), t = targets[0];
    const from = g.nodeAt(s0b[0], s0b[1], ...index[s0b[2]].start[0]), to = g.nodeAt(t.bx, t.bz, t.x, t.y, t.z);
    path = from && to ? route(g, from, to) : null;
    routeDone = true;
    if (!path) {
      fill(routeLine, el('b', { text: 'No walking route found. ' }), 'The way there needs a hidden door, swimming or levitation; head for the red pin by the directions above.');
      return;
    }
    trip = describe(path);
    const bits = [`about ${Math.round(trip.metres / 5) * 5} m of corridor`];
    if (trip.downs || trip.ups) bits.push(`stairs or ramps ${[trip.downs ? `down ${trip.downs}×` : '', trip.ups ? `up ${trip.ups}×` : ''].filter(Boolean).join(', ')}`);
    if (trip.climbs.length) bits.push(`climb ${trip.climbs.length === 1 ? 'one wall' : `${trip.climbs.length} walls`} (▲)`);
    if (trip.drops.length) bits.push(`drop off ${trip.drops.length === 1 ? 'one ledge' : `${trip.drops.length} ledges`} (▼${trip.drops.some(d => d.m > 6) ? ', a long fall: fall damage' : ''})`);
    fill(routeLine, el('b', { text: 'Route: ' }), bits.join(' · ') + '.');
    // the levels the route uses, marked in the picker
    const usedBands = new Set(path.map(p => Math.floor(p[2] / BAND)));
    for (const o of levelSel.options) if (+o.value >= 0 && (usedBands.has(+o.value) || usedBands.has(+o.value + 1)) && !/route/.test(o.text)) o.text += ' · route';
    draw();
  }
}
