// Map tab: the game's own travel-map art. World view = TRAV0I00 (click a region);
// region view = its FMAP page(s) with every location dot placed by the game's own law.
import { data, regionName, typeWord, searchLocations, travelBetween, loadRoads } from './data.js?v=10';
import { el, fill, autocomplete, locationCard } from './ui.js?v=10';
import { state, registerMap, onChange } from './state.js?v=10';

const $ = id => document.getElementById(id);
const canvas = $('map-canvas'), ctx = canvas.getContext('2d');
const tip = $('map-tip');
const images = {};
const img = src => images[src] ||= Object.assign(new Image(), { src: `img/${src}?v=1` });

const view = { mode: 'world', region: -1, page: 0, zoom: 1, ox: 0, oy: 0, selected: -1, pins: [], route: null };
const LEGEND = [
  ['City / town / village', 11], ['Dungeon', 1], ['Temple / shrine', 8], ['Tavern', 10], ['Farm / manor / cottage', 5], ['Graveyard / coven', 3],
];

// Roads, tracks, rivers and streams (Basic Roads by Hazelnut, as in DFO Online), colours as the game's
// travel map draws them; a toggle in the legend, remembered in this browser
const PATHS = [  // [layer, colour, width in map pixels], drawn bottom to top
  [3, 'rgb(48,120,230)', 0.22], [1, 'rgb(160,118,74)', 0.26], [2, 'rgb(48,79,250)', 0.34], [0, 'rgb(60,60,60)', 0.34],
];
const DIRS = [[128, 0, -1], [64, 1, -1], [32, 1, 0], [16, 1, 1], [8, 0, 1], [4, -1, 1], [2, -1, 0], [1, -1, -1]];
let showRoads = true;
try { showRoads = localStorage.getItem('dg-roads') !== '0'; } catch { /* storage blocked: roads on */ }
const roadPaths = new Map();

// A map pixel's place on a region page, by the same law as the dots (bottom-up texture offset x scale)
function pagePos(p, mx, my) {
  const W = data.dots.regionWidth, H = data.dots.regionHeight;
  const x = mx - p.origin[0], y = my - p.origin[1];
  if (x < 0 || y < 0 || x >= W || y >= H) return null;
  if (p.scale === 1) return [x, y];
  if (data.politic[my * 1000 + mx] - 128 !== view.region) return null;
  const offset = Math.trunc((((H - y - 1) * W) + x) * p.scale);
  if (offset >= W * H) return null;
  return [offset % W, H - 1 - Math.floor(offset / W)];
}

// One Path2D per layer for a page, in page pixels: each pixel draws half-way to the neighbours it joins
function pathsFor(p) {
  const key = p.image;
  if (roadPaths.has(key)) return roadPaths.get(key);
  const N = 500000, out = PATHS.map(() => new Path2D());
  const W = data.dots.regionWidth, H = data.dots.regionHeight;
  for (let y = p.origin[1]; y < p.origin[1] + H && y < 500; y++) {
    for (let x = p.origin[0]; x < p.origin[0] + W && x < 1000; x++) {
      const i = y * 1000 + x;
      PATHS.forEach(([layer], k) => {
        const bits = data.roads[layer * N + i];
        if (!bits) return;
        const a = pagePos(p, x, y);
        if (!a) return;
        for (const [bit, dx, dy] of DIRS) {
          if (!(bits & bit)) continue;
          const b = pagePos(p, x + dx, y + dy) || [a[0] + dx, a[1] + dy];
          out[k].moveTo(a[0] + 0.5, a[1] + 0.5);
          out[k].lineTo((a[0] + b[0]) / 2 + 0.5, (a[1] + b[1]) / 2 + 0.5);
        }
      });
    }
  }
  roadPaths.set(key, out);
  return out;
}

function drawRoads(p, s) {
  if (!showRoads || !data.roads) return;
  const paths = pathsFor(p);
  ctx.save();
  ctx.setTransform(s, 0, 0, s, view.ox, view.oy);
  ctx.lineCap = 'round';
  PATHS.forEach(([, colour, w], k) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(w, 1.6 * devicePixelRatio / s);
    ctx.stroke(paths[k]);
  });
  ctx.restore();
}

export function initMap() {
  loadRoads().then(draw, () => { /* the map works without roads */ });
  img('overworld.png').onload = draw;
  const regionSel = $('map-region');
  regionSel.append(el('option', { value: -1 }, 'All regions'),
    ...data.meta.regions.filter(r => r.locations && data.dots.pages[r.i]).sort((a, b) => a.name.localeCompare(b.name))
      .map(r => el('option', { value: r.i }, r.name)));
  regionSel.addEventListener('change', () => { if (+regionSel.value >= 0) openRegion(+regionSel.value); });

  autocomplete($('map-search'), $('map-suggest'), { onPick: i => select(i), region: () => +regionSel.value });
  $('map-search').addEventListener('keydown', e => {
    if (e.key === 'Enter') { const r = searchLocations(e.target.value, { region: +regionSel.value, limit: 1 }); if (r.length) select(r[0]); }
  });
  $('map-world').addEventListener('click', () => { view.mode = 'world'; view.region = -1; resetView(); renderPages(); draw(); });
  $('map-zoom-in').addEventListener('click', () => zoomBy(1.5));
  $('map-zoom-out').addEventListener('click', () => zoomBy(1 / 1.5));

  // pointer: drag to pan, tap/click to pick, hover for names, wheel/pinch to zoom
  const pointers = new Map();
  let dragged = false, pinch = 0;
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.offsetX, e.offsetY]); dragged = false; });
  canvas.addEventListener('pointermove', e => {
    const prev = pointers.get(e.pointerId);
    if (prev && pointers.size === 1) {
      const dx = e.offsetX - prev[0], dy = e.offsetY - prev[1];
      if (Math.abs(dx) + Math.abs(dy) > 2) dragged = true;
      if (dragged && view.mode === 'region') { view.ox += dx; view.oy += dy; clampView(); draw(); }
      pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
    } else if (prev && pointers.size === 2) {
      pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) zoomBy(d / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      pinch = d;
      dragged = true;
    } else hover(e.offsetX, e.offsetY);
  });
  canvas.addEventListener('pointerup', e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (!dragged) click(e.offsetX, e.offsetY);
  });
  canvas.addEventListener('pointerleave', () => { tip.hidden = true; });
  canvas.addEventListener('wheel', e => { if (view.mode !== 'region') return; e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.25 : 0.8, e.offsetX, e.offsetY); }, { passive: false });
  new ResizeObserver(() => { fit(); draw(); }).observe(canvas.parentElement);

  fill($('map-legend'), ...LEGEND.map(([label, c]) =>
    el('span', { class: 'dg-legend-item' }, el('span', { class: 'dg-legend-dot', style: `background:${data.dots.dotColors[c]}` }), label)),
  el('span', { class: 'dg-legend-item' }, el('span', { class: 'dg-legend-line', style: 'background:rgb(60,60,60)' }), 'Road'),
  el('span', { class: 'dg-legend-item' }, el('span', { class: 'dg-legend-line', style: 'background:rgb(160,118,74)' }), 'Dirt track'),
  el('span', { class: 'dg-legend-item' }, el('span', { class: 'dg-legend-line', style: 'background:rgb(48,79,250)' }), 'River'),
  el('label', { class: 'tool-check dg-legend-item dg-roads-toggle' },
    el('input', { type: 'checkbox', id: 'map-roads', checked: showRoads, onchange: e => {
      showRoads = e.target.checked;
      try { localStorage.setItem('dg-roads', showRoads ? '1' : '0'); } catch { /* kept for this visit */ }
      draw();
    } }), ' Show roads'));

  onChange(() => { if (view.selected >= 0) renderDetail(); draw(); });
  registerMap({ select });
  fit();
}

function fit() {
  const w = Math.max(280, canvas.parentElement.clientWidth);
  canvas.width = Math.round(w * devicePixelRatio);
  canvas.height = Math.round(w * 0.5 * devicePixelRatio);
  canvas.style.height = `${Math.round(w * 0.5)}px`;
  if (view.mode === 'region') clampView();
}

const pageInfo = () => data.dots.pages[view.region]?.[view.page];
// Base scale: the 320x160 page fills the canvas width at zoom 1
const base = () => canvas.width / 320;
const scale = () => base() * view.zoom;
function resetView() { view.zoom = 1; view.ox = 0; view.oy = 0; }
function clampView() {
  const s = scale(), w = 320 * s, h = 160 * s;
  view.ox = Math.min(0, Math.max(canvas.width - w, view.ox));
  view.oy = Math.min(0, Math.max(canvas.height - h, view.oy));
}
function zoomBy(f, cx = canvas.width / 2 / devicePixelRatio, cy = canvas.height / 2 / devicePixelRatio) {
  if (view.mode !== 'region') return;
  const px = cx * devicePixelRatio, py = cy * devicePixelRatio;
  const old = scale();
  view.zoom = Math.min(8, Math.max(1, view.zoom * f));
  const k = scale() / old;
  view.ox = px - (px - view.ox) * k;
  view.oy = py - (py - view.oy) * k;
  clampView();
  draw();
}

function openRegion(region, page = 0) {
  view.mode = 'region';
  view.region = region;
  view.page = page;
  resetView();
  renderPages();
  draw();
}

function renderPages() {
  const title = $('map-title'), pages = $('map-pages');
  if (view.mode === 'world') {
    title.textContent = 'The Iliac Bay — tap a region';
    fill(pages, );
    return;
  }
  title.textContent = regionName(view.region);
  const list = data.dots.pages[view.region];
  fill(pages, ...(list.length > 1 ? list.map((p, k) =>
    el('button', { class: 'tool-btn' + (k === view.page ? ' dg-on' : ''), onclick: () => { view.page = k; resetView(); renderPages(); draw(); } }, `Part ${k + 1}`)) : []));
}

// The page (and part) that shows a location's dot
function pageFor(i) {
  const pages = data.dots.pages[data.locs.region[i]];
  if (!pages) return null;
  for (let k = 0; k < pages.length; k++) {
    const d = pages[k].dots.find(x => x[0] === i);
    if (d) return { page: k, dot: d };
  }
  return null;
}

// route: a planned trip [from, stop, stop, ...] drawn leg by leg instead of the single line from "I am in"
function select(i, pins = null, route = null) {
  view.selected = i;
  view.pins = pins || [];
  view.route = route;
  const p = pageFor(i);
  if (p) {
    openRegion(data.locs.region[i], p.page);
    // centre on the dot at a useful zoom
    view.zoom = 3;
    const s = scale();
    view.ox = canvas.width / 2 - (p.dot[1] + 0.5) * s;
    view.oy = canvas.height / 2 - (p.dot[2] + 0.5) * s;
    clampView();
  }
  renderDetail();
  draw();
}

function renderDetail() {
  const i = view.selected;
  fill($('map-detail'), i >= 0 ? locationCard(i, {
    note: pageFor(i) ? null : 'This place has no dot on the travel map (it is reached another way).',
  }) : '');
}

function dotAt(x, y) {
  const p = pageInfo();
  if (!p) return -1;
  const s = scale(), r = Math.max(6 * devicePixelRatio, s * 0.8);
  let best = -1, bestD = r * r;
  for (const [loc, dx, dy] of p.dots) {
    const cx = view.ox + (dx + 0.5) * s, cy = view.oy + (dy + 0.5) * s;
    const d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < bestD) { bestD = d; best = loc; }
  }
  return best;
}

function hover(x, y) {
  x *= devicePixelRatio; y *= devicePixelRatio;
  let text = '';
  if (view.mode === 'world') {
    const r = regionAtWorld(x, y);
    text = r >= 0 ? regionName(r) : '';
  } else {
    const i = dotAt(x, y);
    if (i >= 0) text = `${data.locs.name[i]} — ${typeWord(i)}`;
  }
  tip.hidden = !text;
  if (text) { tip.textContent = text; tip.style.left = `${x / devicePixelRatio + 12}px`; tip.style.top = `${y / devicePixelRatio + 12}px`; }
}

function regionAtWorld(x, y) {
  // the overworld is 320x200, drawn to fit inside the canvas
  const s = Math.min(canvas.width / 320, canvas.height / 200), ox = (canvas.width - 320 * s) / 2;
  const ix = Math.floor((x - ox) / s), iy = Math.floor(y / s);
  if (ix < 0 || iy < 0 || ix >= 320 || iy >= 200) return -1;
  const r = data.picker[iy * 320 + ix];
  return r !== 255 && data.dots.pages[r] ? r : -1;
}

function click(x, y) {
  x *= devicePixelRatio; y *= devicePixelRatio;
  if (view.mode === 'world') {
    const r = regionAtWorld(x, y);
    if (r >= 0) { $('map-region').value = r; openRegion(r); }
    return;
  }
  const i = dotAt(x, y);
  if (i >= 0) { view.selected = i; renderDetail(); draw(); }
}

function draw() {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0d0d10';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (view.mode === 'world') return drawWorld();
  const p = pageInfo();
  if (!p) return;
  const image = img(`regions/${p.image}`);
  if (!image.complete) { image.onload = draw; return; }
  const s = scale();
  ctx.drawImage(image, view.ox, view.oy, 320 * s, 160 * s);
  drawRoads(p, s);

  // routes follow the pixels the travel law charges (scale-1 pages only): a planned trip leg by leg,
  // or the single trip from where the player is to the selection
  if (p.scale === 1) {
    const legs = view.route ? view.route.slice(1).map((to, k) => [view.route[k], to])
      : state.here >= 0 && view.selected >= 0 && view.selected !== state.here ? [[state.here, view.selected]] : [];
    ctx.strokeStyle = 'rgba(255,145,48,0.9)';
    ctx.lineWidth = Math.max(2, s * 0.35);
    for (const [from, to] of legs) {
      const path = travelBetween(from, to, state.opts).path;
      ctx.beginPath();
      ctx.moveTo(view.ox + (data.locs.px[from] - p.origin[0] + 0.5) * s, view.oy + (data.locs.py[from] - p.origin[1] + 0.5) * s);
      for (const q of path) ctx.lineTo(view.ox + (q.x - p.origin[0] + 0.5) * s, view.oy + (q.y - p.origin[1] + 0.5) * s);
      ctx.stroke();
    }
  }

  const size = Math.max(2 * devicePixelRatio, s * 0.9);
  for (const [, dx, dy, c] of p.dots) {
    ctx.fillStyle = data.dots.dotColors[c];
    ctx.fillRect(view.ox + (dx + 0.5) * s - size / 2, view.oy + (dy + 0.5) * s - size / 2, size, size);
  }
  // markers: where I am (blue), pins (orange), selection (white ring + label)
  const mark = (i, colour, label) => {
    const d = p.dots.find(x => x[0] === i);
    if (!d) return;
    const cx = view.ox + (d[1] + 0.5) * s, cy = view.oy + (d[2] + 0.5) * s, r = Math.max(7 * devicePixelRatio, s * 1.6);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2.5 * devicePixelRatio;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    if (label) {
      ctx.font = `600 ${14 * devicePixelRatio}px 'EB Garamond', Georgia, serif`;
      const w = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(231,212,168,0.95)';
      ctx.fillRect(cx + r + 3, cy - 9 * devicePixelRatio, w + 8, 18 * devicePixelRatio);
      ctx.fillStyle = '#2a1a0b';
      ctx.fillText(label, cx + r + 7, cy + 4 * devicePixelRatio);
    }
  };
  view.pins.forEach((i, k) => mark(i, '#ff9130', view.route ? `${k + 1}. ${data.locs.name[i]}` : data.locs.name[i]));
  if (state.here >= 0) mark(state.here, '#5ab8ff', 'You');
  if (view.selected >= 0) mark(view.selected, '#ffffff', data.locs.name[view.selected]);
}

function drawWorld() {
  const image = img('overworld.png');
  if (!image.complete) return;
  const s = Math.min(canvas.width / 320, canvas.height / 200), ox = (canvas.width - 320 * s) / 2;
  ctx.drawImage(image, ox, 0, 320 * s, 200 * s);
}
