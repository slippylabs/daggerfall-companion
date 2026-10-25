// Towns tab: every building of a town, grouped by type, on a north-up sketch of its blocks.
import { data, loadTowns, regionName, typeWord, normalise } from './data.js?v=10';
import { el, fill, autocomplete, travelLine } from './ui.js?v=10';
import { state } from './state.js?v=10';
import { showDungeon, dungeonBlocks } from './dungeon.js?v=10';

const $ = id => document.getElementById(id);
const canvas = $('town-canvas'), ctx = canvas.getContext('2d');
const BLOCK = 102.4;   // one RMB block is 4096 Daggerfall units = 102.4 m
let current = null, highlight = null, mark = null, tabs = null;
const HOUSE = 5;   // houses: [blockX, blockY, x, z, buildingKey] per house

const COLOURS = {
  GuildHall: '#ff9130', Temple: '#ffe066', Tavern: '#b07cff', Palace: '#ff4655', Bank: '#5ab8ff', Library: '#7fe0ff',
  default: '#39ff8f',
};
const colourFor = t => COLOURS[t] || COLOURS.default;
const ORDER = ['GuildHall', 'Temple', 'Palace', 'Tavern', 'Bank', 'Library', 'Alchemist', 'Armorer', 'WeaponSmith', 'GeneralStore',
  'PawnShop', 'Bookseller', 'ClothingStore', 'FurnitureStore', 'GemStore'];
const FRIENDLY = {
  GuildHall: 'Guild halls', Temple: 'Temples', Palace: 'Palace', Tavern: 'Taverns', Bank: 'Banks', Library: 'Libraries',
  Alchemist: 'Alchemists', Armorer: 'Armorers', WeaponSmith: 'Weapon smiths', GeneralStore: 'General stores',
  PawnShop: 'Pawn shops', Bookseller: 'Booksellers', ClothingStore: 'Clothing stores', FurnitureStore: 'Furniture stores',
  GemStore: 'Jewelers',
};

export function initTowns(tabApi) {
  tabs = tabApi;
  autocomplete($('town-input'), $('town-suggest'), { onPick: i => openTown(i), filter: i => data.locs.type[i] !== 14 });
  $('building-search').addEventListener('input', () => { mark = null; renderList(); drawMap(); });
  new ResizeObserver(() => drawMap()).observe(canvas.parentElement);
}

// Called by the tab switcher: default to where the player is
export function townsShown() {
  if (!current && loading === null && state.here >= 0) openTown(state.here);
}

let loading = null;
// A building by its key (the key a quest site in a save names): {bx, by, x, z} or null
export function buildingAt(town, key) {
  const b = town.b.find(r => r[8] === key);
  if (b) return { bx: b[4], by: b[5], x: b[6], z: b[7] };
  for (let k = 0; k < town.houses.length; k += HOUSE)
    if (town.houses[k + 4] === key) return { bx: town.houses[k], by: town.houses[k + 1], x: town.houses[k + 2], z: town.houses[k + 3] };
  return null;
}

// Where a building stands in its town, in words: "in the north-east part of town, about 180 m from the middle"
const PARTS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
export function whereInTown(town, p) {
  const dx = p.bx * BLOCK + p.x - town.w * BLOCK / 2, dy = p.by * BLOCK + p.z - town.h * BLOCK / 2;
  const m = Math.hypot(dx, dy);
  if (m < 40) return 'right in the middle of town';
  const part = PARTS[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
  return `in the ${part} part of town, about ${Math.round(m / 10) * 10} m from the middle`;
}

// opts.key: a quest building's key from a save (a house has no name on any map until the quest names it);
// opts.targets: quest spots inside a dungeon from a save, [{bx, bz, x, y, z, label}]
export async function openTown(i, buildingName = null, opts = {}) {
  if (state.tab !== 'towns') tabs?.show('towns');
  loading = i;
  const file = await loadTowns(data.locs.region[i]);
  if (loading !== i) return;   // a later pick won
  loading = null;
  current = { i, file, town: file.towns[i] || null };
  const at = opts.key && current.town ? buildingAt(current.town, opts.key) : null;
  mark = at ? { ...at, name: buildingName } : null;
  highlight = mark ? null : buildingName;
  $('town-input').value = data.locs.name[i];
  $('building-search').value = mark ? '' : buildingName || '';
  fill($('town-head'), 
    el('div', { class: 'dg-card-head' },
      el('span', { class: 'dg-card-name', text: data.locs.name[i] }),
      el('span', { class: 'dg-tag', text: `${typeWord(i)} · ${regionName(data.locs.region[i])}` })),
    el('div', { class: 'dg-card-trip' }, travelLine(i)),
    mark ? el('div', { class: 'dg-reward dg-town-mark' },
      el('div', { class: 'dg-reward-label', text: 'Your quest building' }),
      el('div', { class: 'dg-reward-who', text: buildingName }),
      el('div', {}, `It stands ${whereInTown(current.town, mark)} (circled on the map, north is up).`)) : null,
    opts.key && !mark && current.town ? el('p', { class: 'tool-note', text: `${buildingName}: this building is not on the guide's map of ${data.locs.name[i]}. Ask townspeople "Where is…" in the talk window.` }) : null,
    current.town || (await dungeonBlocks(i)) ? null : el('p', { class: 'tool-note', text: 'This place has no buildings and no dungeon on its map.' }));
  if (current.i !== i) return;   // a later pick won while the dungeon list loaded
  $('town-cols').hidden = !current.town;
  const dv = $('dungeon-view');
  dv.hidden = !(await dungeonBlocks(i));
  if (!dv.hidden) await showDungeon(dv, i, opts.targets || []);
  else fill(dv);
  renderList();
  drawMap();
}

function renderList() {
  const box = $('town-buildings');
  if (!current?.town) { fill(box, ); return; }
  const { town, file } = current;
  const q = normalise($('building-search').value);
  const rows = town.b.filter(b => !q || normalise(b[0]).includes(q) || (b[9] && normalise(b[9]).includes(q)));
  highlight = q ? (rows[0]?.[0] ?? null) : highlight;
  const groups = new Map();
  for (const b of rows) {
    const t = file.buildingTypes[b[1]];
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(b);
  }
  const keys = [...groups.keys()].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  fill(box, 
    el('p', { class: 'tool-note', text: `${town.b.length} named buildings and ${town.houses.length / HOUSE} houses. Houses are named only when a quest picks one.` }),
    ...keys.map(t => el('div', { class: 'dg-bgroup' },
      el('h3', {}, el('span', { class: 'dg-legend-dot', style: `background:${colourFor(t)}` }), FRIENDLY[t] || t),
      el('ul', {}, groups.get(t).sort((a, b) => a[0].localeCompare(b[0])).map(b => el('li', {},
        el('button', {
          class: 'dg-link' + (b[0] === highlight ? ' dg-on' : ''),
          onclick: () => { highlight = b[0]; mark = null; renderList(); drawMap(); },
        }, b[0] || '(unnamed)', b[9] ? el('span', { class: 'dg-dim', text: ` (offline: ${b[9]})` }) : null)))))),
    rows.length ? null : el('p', { class: 'tool-note', text: 'No building with that name here. If it is a house ("The … Residence"), the quest named it — ask townspeople where it is.' }));
}

function drawMap() {
  const wrap = canvas.parentElement;
  const size = Math.max(240, Math.min(wrap.clientWidth, 520));
  canvas.width = canvas.height = Math.round(size * devicePixelRatio);
  canvas.style.width = canvas.style.height = `${size}px`;
  ctx.fillStyle = '#0d0d10';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!current?.town) return;
  const { town, file } = current;
  const span = Math.max(town.w, town.h) * BLOCK;
  const pad = 14 * devicePixelRatio;
  const s = (canvas.width - pad * 2) / span;
  const ox = pad + (span - town.w * BLOCK) * s / 2, oy = pad + (span - town.h * BLOCK) * s / 2;
  // north up: block y and z grow north, so flip
  const X = (bx, x) => ox + (bx * BLOCK + x) * s;
  const Y = (by, z) => oy + (town.h * BLOCK - (by * BLOCK + z)) * s;

  ctx.strokeStyle = 'rgba(57,255,143,0.25)';
  ctx.lineWidth = 1;
  for (let bx = 0; bx < town.w; bx++)
    for (let by = 0; by < town.h; by++)
      ctx.strokeRect(X(bx, 0), Y(by, BLOCK), BLOCK * s, BLOCK * s);

  const r = Math.max(2.5 * devicePixelRatio, s * 3);
  ctx.fillStyle = 'rgba(127,166,149,0.55)';
  for (let k = 0; k < town.houses.length; k += HOUSE)
    ctx.fillRect(X(town.houses[k], town.houses[k + 2]) - r / 2, Y(town.houses[k + 1], town.houses[k + 3]) - r / 2, r, r);
  let hl = null;
  for (const b of town.b) {
    const t = file.buildingTypes[b[1]];
    ctx.fillStyle = colourFor(t);
    const x = X(b[4], b[6]), y = Y(b[5], b[7]);
    ctx.fillRect(x - r * 0.7, y - r * 0.7, r * 1.4, r * 1.4);
    if (b[0] === highlight) hl = { x, y, name: b[0] };
  }
  if (mark) hl = { x: X(mark.bx, mark.x), y: Y(mark.by, mark.z), name: mark.name };
  if (hl) {
    // a quest house: a red dot inside the ring, so it stands out among the grey houses
    if (mark) {
      ctx.fillStyle = '#ff4655';
      ctx.beginPath(); ctx.arc(hl.x, hl.y, r * 1.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5 * devicePixelRatio;
    const ring = r * 3;
    ctx.beginPath(); ctx.arc(hl.x, hl.y, ring, 0, Math.PI * 2); ctx.stroke();
    ctx.font = `600 ${14 * devicePixelRatio}px 'EB Garamond', Georgia, serif`;
    const w = ctx.measureText(hl.name).width;
    // label to the right of the ring, or to its left when it would run off the canvas
    const lx = hl.x + ring + 6 + w + 4 <= canvas.width ? hl.x + ring + 6 : Math.max(4, hl.x - ring - 6 - w);
    ctx.fillStyle = 'rgba(231,212,168,0.95)';
    ctx.fillRect(lx - 4, hl.y - 10 * devicePixelRatio, w + 8, 18 * devicePixelRatio);
    ctx.fillStyle = '#2a1a0b';
    ctx.fillText(hl.name, lx, hl.y + 4 * devicePixelRatio);
  }
  ctx.fillStyle = 'rgba(217,251,232,0.8)';
  ctx.font = `bold ${12 * devicePixelRatio}px 'EB Garamond', Georgia, serif`;
  ctx.fillText('N ↑', canvas.width - 40 * devicePixelRatio, 16 * devicePixelRatio);
}

