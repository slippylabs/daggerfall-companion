// Town map: Daggerfall's own town map (the exterior automap). Every town block carries a 64x64 picture of
// itself (RMB autoMapData, data/rmb/<BLOCK>.bin from build-towns.mjs): 0 is street, 0xfb a ground flat, any
// other byte a building of type byte-1. Blocks go north row first (as DFO exteriorAutomapWindow.js lays them),
// so the image is the town north-up, 64 pixels a block. A building's anchor is
// (bx*64 + x/102.4*64, h*64-1 - (by*64 + z/102.4*64)); its footprint is the patch of its byte around that.
// Only bytes in a group (groupOfByte) are drawn; the rest is scenery, shown as the open ground around it.
import { el, fill } from './ui.js?v=20';

const PX = 64, BLOCK = 102.4;
const blocks = {};
const blockBytes = name => (blocks[name] ||= fetch(`data/rmb/${name}.bin?v=2`)
  .then(r => (r.ok ? r.arrayBuffer() : null)).then(b => (b ? new Uint8Array(b) : null)).catch(() => null));
const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));

export function townMap(box, { colours, groupOfByte, onPick }) {
  const caption = el('div', { class: 'dg-tmap-caption' });
  const canvas = el('canvas', { class: 'dg-tmap-canvas', 'aria-label': 'Town map' });
  const tip = el('div', { class: 'dg-tmap-tip', hidden: true });
  const frame = el('div', { class: 'dg-tmap-frame' }, canvas, tip);
  const legend = el('div', { class: 'dg-legend dg-tmap-legend' },
    ...[['temple', 'Temples & guilds'], ['shop', 'Shops'], ['tavern', 'Taverns'], ['house', 'Houses'], ['grounds', 'Graveyards & gardens'], ['wall', 'City wall'], ['street', 'Streets']]
      .map(([g, label]) => el('span', { class: 'dg-legend-item' }, el('span', { class: 'dg-legend-dot', style: `background:${colours[g]}` }), label)));
  const zoomOut = el('button', { class: 'tool-btn', 'aria-label': 'Zoom out', onclick: () => zoom(1 / 1.5) }, '−');
  const zoomIn = el('button', { class: 'tool-btn', 'aria-label': 'Zoom in', onclick: () => zoom(1.5) }, '+');
  fill(box, el('div', { class: 'dg-tmap-head' }, caption, el('span', { class: 'dg-tmap-zoom' }, zoomOut, zoomIn)), frame, legend);
  const ctx = canvas.getContext('2d');
  const img = document.createElement('canvas');
  let town = null, bytes = null, W = 0, H = 0, named = [], sel = null, lit = null;
  const view = { zoom: 1, ox: 0, oy: 0 };

  const anchor = b => [b.bx * PX + Math.trunc(b.x / BLOCK * PX), H - 1 - (b.by * PX + Math.trunc(b.z / BLOCK * PX))];
  const byteAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : bytes[y * W + x]);

  // the building's footprint: its byte's connected patch around the anchor. The anchor may sit just outside, or
  // in a courtyard, so its own byte (type + 1) is looked for first, nearest out, then any building byte
  function footprint(b) {
    const [ax, ay] = anchor(b);
    let seed = null;
    const look = (ok, reach) => {
      for (let d = 0; d <= reach && !seed; d++)
        for (let dy = -d; dy <= d && !seed; dy++) for (let dx = -d; dx <= d && !seed; dx++) {
          const v = byteAt(ax + dx, ay + dy);
          if (ok(v)) seed = [ax + dx, ay + dy, v];
        }
    };
    if (b.byte) look(v => v === b.byte, 6);
    if (!seed) look(v => !!groupOfByte[v], 3);
    if (!seed) return null;
    const out = new Set(), stack = [[seed[0], seed[1]]], v = seed[2];
    while (stack.length && out.size < 4000) {
      const [x, y] = stack.pop(), k = y * W + x;
      if (out.has(k) || byteAt(x, y) !== v) continue;
      out.add(k);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return out;
  }

  function compose() {
    const id = ctx.createImageData(W, H), p = id.data;
    const rgb = Object.fromEntries(Object.entries({ country: '#6f7244', ...colours }).map(([k, c]) => [k, hex(c)]));
    // walls: the house-coloured bytes inside the city's WALL blocks
    const wallBlock = new Set();
    town.bn.forEach((n, i) => { if (/^WALL/i.test(n)) wallBlock.add(i); });
    // outside the city wall: the open ground of the WALL blocks reachable from the map's edge without crossing
    // the wall is countryside, not street
    const blockOf = (x, y) => (town.h - 1 - Math.floor(y / PX)) * town.w + Math.floor(x / PX);
    // ...and so is every other block beyond the wall ring (the empty corners, farms outside): the blocks reachable
    // from the grid's edge without stepping on a WALL block
    const beyond = new Set();
    if (wallBlock.size) {
      const stack = [];
      const visit = (bx, by) => {
        if (bx < 0 || by < 0 || bx >= town.w || by >= town.h) return;
        const i = by * town.w + bx;
        if (beyond.has(i) || wallBlock.has(i)) return;
        beyond.add(i); stack.push([bx, by]);
      };
      for (let bx = 0; bx < town.w; bx++) { visit(bx, 0); visit(bx, town.h - 1); }
      for (let by = 0; by < town.h; by++) { visit(0, by); visit(town.w - 1, by); }
      while (stack.length) { const [bx, by] = stack.pop(); visit(bx + 1, by); visit(bx - 1, by); visit(bx, by + 1); visit(bx, by - 1); }
    }
    const outside = new Uint8Array(W * H);
    if (wallBlock.size) {
      const stack = [];
      const push = (x, y) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const k = y * W + x;
        const bi = blockOf(x, y);
        if (outside[k] || !(wallBlock.has(bi) || beyond.has(bi)) || groupOfByte[bytes[k]]) return;
        outside[k] = 1; stack.push(k);
      };
      for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
      for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
      while (stack.length) { const k = stack.pop(), x = k % W, y = (k - x) / W; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = bytes[y * W + x], o = (y * W + x) * 4;
      const blockIdx = blockOf(x, y);
      let c = outside[y * W + x] ? rgb.country : rgb.street;
      const g = groupOfByte[v];
      if (g) c = wallBlock.has(blockIdx) && v === 24 ? rgb.wall : rgb[g];
      if (lit?.has(y * W + x)) c = rgb.select;
      p[o] = c[0]; p[o + 1] = c[1]; p[o + 2] = c[2]; p[o + 3] = 255;
    }
    img.width = W; img.height = H;
    img.getContext('2d').putImageData(id, 0, 0);
  }

  function scale() {
    const base = Math.min(canvas.width / W, canvas.height / H);
    return Math.max(base, base * view.zoom);
  }
  function draw() {
    const wrap = frame;
    const w = Math.max(240, wrap.clientWidth), h = Math.round(Math.min(w, 560));
    canvas.width = Math.round(w * devicePixelRatio); canvas.height = Math.round(h * devicePixelRatio);
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    // outside the town: dark countryside, so the town's edge reads
    ctx.fillStyle = '#4a4c2c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!town) return;
    const s = scale();
    clampView(s);
    const ox = (canvas.width - W * s) / 2 + view.ox, oy = (canvas.height - H * s) / 2 + view.oy;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, ox, oy, W * s, H * s);
    if (sel) {
      const [ax, ay] = anchor(sel);
      const cx = ox + (ax + 0.5) * s, cy = oy + (ay + 0.5) * s, r = Math.max(14 * devicePixelRatio, 7 * s);
      ctx.strokeStyle = '#8c1c13'; ctx.lineWidth = 3 * devicePixelRatio;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,245,215,0.9)'; ctx.lineWidth = 1.2 * devicePixelRatio;
      ctx.beginPath(); ctx.arc(cx, cy, r + 2.5 * devicePixelRatio, 0, Math.PI * 2); ctx.stroke();
      ctx.font = `600 ${15 * devicePixelRatio}px 'EB Garamond', Georgia, serif`;
      const tw = ctx.measureText(sel.name).width, pad = 6 * devicePixelRatio, th = 22 * devicePixelRatio;
      // the tag sits above the ring (below it near the top edge), so it never covers the building itself
      const bw = tw + pad * 2;
      const lx = Math.max(4, Math.min(canvas.width - bw - 4, cx - bw / 2));
      const ly = cy - r - 6 * devicePixelRatio - th >= 4 ? cy - r - 6 * devicePixelRatio - th : cy + r + 6 * devicePixelRatio;
      ctx.fillStyle = 'rgba(238,222,190,0.97)'; ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 1.5 * devicePixelRatio;
      ctx.fillRect(lx, ly, bw, th); ctx.strokeRect(lx, ly, bw, th);
      ctx.fillStyle = sel.quest ? '#7a1810' : '#2a1a0b';
      ctx.fillText(sel.name, lx + pad, ly + th / 2 + 5 * devicePixelRatio);
    }
    // compass
    ctx.font = `700 ${13 * devicePixelRatio}px Cinzel, Georgia, serif`;
    ctx.fillStyle = 'rgba(42,26,11,0.85)';
    ctx.fillText('N ↑', canvas.width - 42 * devicePixelRatio, 20 * devicePixelRatio);
  }

  // keep the town filling the frame once zoomed in (no panning off into nothing)
  function clampView(s) {
    const mx = Math.max(0, (W * s - canvas.width) / 2), my = Math.max(0, (H * s - canvas.height) / 2);
    view.ox = Math.max(-mx, Math.min(mx, view.ox));
    view.oy = Math.max(-my, Math.min(my, view.oy));
  }
  function zoom(f, cx = canvas.width / 2, cy = canvas.height / 2) {
    const z = Math.max(1, Math.min(8, view.zoom * f)), k = z / view.zoom;
    view.ox = (view.ox - (cx - canvas.width / 2)) * k + (cx - canvas.width / 2);
    view.oy = (view.oy - (cy - canvas.height / 2)) * k + (cy - canvas.height / 2);
    view.zoom = z;
    draw();
  }
  // the named building nearest an image pixel, within a few pixels of its footprint anchor
  function buildingNear(px, py) {
    const v = byteAt(px, py);
    let best = null, bestD = 7;
    for (const b of named) {
      const [ax, ay] = anchor(b);
      const d = Math.hypot(ax - px, ay - py) - (groupOfByte[v] && byteAt(ax, ay) === v ? 3 : 0);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }
  const toImage = e => {
    const r = canvas.getBoundingClientRect(), s = scale();
    const ox = (canvas.width - W * s) / 2 + view.ox, oy = (canvas.height - H * s) / 2 + view.oy;
    return [Math.floor(((e.clientX - r.left) * devicePixelRatio - ox) / s), Math.floor(((e.clientY - r.top) * devicePixelRatio - oy) / s)];
  };
  const pointers = new Map();
  let moved = false;
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); moved = false; });
  canvas.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId);
    if (p) {
      const dx = e.clientX - p[0], dy = e.clientY - p[1];
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (moved) { view.ox += dx * devicePixelRatio; view.oy += dy * devicePixelRatio; pointers.set(e.pointerId, [e.clientX, e.clientY]); draw(); }
      return;
    }
    if (!town) return;
    const b = buildingNear(...toImage(e));
    tip.hidden = !b;
    if (b) {
      tip.textContent = b.name;
      const r = frame.getBoundingClientRect();
      tip.style.left = `${Math.min(e.clientX - r.left + 14, r.width - 180)}px`;
      tip.style.top = `${e.clientY - r.top + 14}px`;
    }
  });
  canvas.addEventListener('pointerleave', () => { tip.hidden = true; });
  canvas.addEventListener('pointerup', e => {
    pointers.delete(e.pointerId);
    if (!moved && town) { const b = buildingNear(...toImage(e)); if (b) onPick?.(b.name); }
  });
  canvas.addEventListener('pointercancel', e => pointers.delete(e.pointerId));
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoom(e.deltaY < 0 ? 1.25 : 0.8, (e.clientX - r.left) * devicePixelRatio, (e.clientY - r.top) * devicePixelRatio);
  }, { passive: false });
  new ResizeObserver(() => draw()).observe(frame);

  return {
    // town: {w, h, bn}; list: named buildings [{name, bx, by, x, z}]; selected: one of them (or a quest house) or null
    async show(t, list, selected, name) {
      const sameTown = town === t;
      const grids = await Promise.all(t.bn.map(n => (n ? blockBytes(n) : null)));
      town = t; named = list; sel = selected;
      W = t.w * PX; H = t.h * PX;
      bytes = new Uint8Array(W * H);
      t.bn.forEach((n, i) => {
        const g = grids[i];
        if (!g) return;
        const bx = i % t.w, by = Math.floor(i / t.w), ox = bx * PX, oy = (t.h - 1 - by) * PX;
        for (let y = 0; y < PX; y++) bytes.set(g.subarray(y * PX, y * PX + PX), (oy + y) * W + ox);
      });
      lit = sel ? footprint(sel) : null;
      caption.textContent = name;
      if (!sameTown) { view.zoom = 1; view.ox = 0; view.oy = 0; }
      compose();
      draw();   // sizes the canvas, so the zoom below knows the scale
      // a chosen building on a big map: zoom in on it
      if (sel && Math.max(t.w, t.h) > 3 && view.zoom < 2) {
        view.zoom = 2;
        const s = scale(), [ax, ay] = anchor(sel);
        view.ox = -(ax - W / 2) * s; view.oy = -(ay - H / 2) * s;
      }
      draw();
    },
    litCount: () => lit?.size || 0,
  };
}
