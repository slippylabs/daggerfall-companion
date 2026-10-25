// Towns tab: every building of a town, grouped by type, on a north-up sketch of its blocks.
import { data, loadTowns, regionName, typeWord, normalise } from './data.js?v=5';
import { el, fill, autocomplete, travelLine } from './ui.js?v=5';
import { state } from './state.js?v=5';

const $ = id => document.getElementById(id);
const canvas = $('town-canvas'), ctx = canvas.getContext('2d');
const BLOCK = 102.4;   // one RMB block is 4096 Daggerfall units = 102.4 m
let current = null, highlight = null, tabs = null;

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
  $('building-search').addEventListener('input', () => { renderList(); drawMap(); });
  new ResizeObserver(() => drawMap()).observe(canvas.parentElement);
}

// Called by the tab switcher: default to where the player is
export function townsShown() {
  if (!current && loading === null && state.here >= 0) openTown(state.here);
}

let loading = null;
export async function openTown(i, buildingName = null) {
  if (state.tab !== 'towns') tabs?.show('towns');
  loading = i;
  const file = await loadTowns(data.locs.region[i]);
  if (loading !== i) return;   // a later pick won
  loading = null;
  current = { i, file, town: file.towns[i] || null };
  highlight = buildingName;
  $('town-input').value = data.locs.name[i];
  $('building-search').value = buildingName || '';
  fill($('town-head'), 
    el('div', { class: 'dg-card-head' },
      el('span', { class: 'dg-card-name', text: data.locs.name[i] }),
      el('span', { class: 'dg-tag', text: `${typeWord(i)} · ${regionName(data.locs.region[i])}` })),
    el('div', { class: 'dg-card-trip' }, travelLine(i)),
    current.town ? null : el('p', { class: 'tool-note', text: 'This place has no buildings on its map (a dungeon or an empty spot).' }));
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
    el('p', { class: 'tool-note', text: `${town.b.length} named buildings and ${town.houses.length / 4} houses. Houses are named only when a quest picks one.` }),
    ...keys.map(t => el('div', { class: 'dg-bgroup' },
      el('h3', {}, el('span', { class: 'dg-legend-dot', style: `background:${colourFor(t)}` }), FRIENDLY[t] || t),
      el('ul', {}, groups.get(t).sort((a, b) => a[0].localeCompare(b[0])).map(b => el('li', {},
        el('button', {
          class: 'dg-link' + (b[0] === highlight ? ' dg-on' : ''),
          onclick: () => { highlight = b[0]; renderList(); drawMap(); },
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
  for (let k = 0; k < town.houses.length; k += 4)
    ctx.fillRect(X(town.houses[k], town.houses[k + 2]) - r / 2, Y(town.houses[k + 1], town.houses[k + 3]) - r / 2, r, r);
  let hl = null;
  for (const b of town.b) {
    const t = file.buildingTypes[b[1]];
    ctx.fillStyle = colourFor(t);
    const x = X(b[4], b[6]), y = Y(b[5], b[7]);
    ctx.fillRect(x - r * 0.7, y - r * 0.7, r * 1.4, r * 1.4);
    if (b[0] === highlight) hl = { x, y, name: b[0] };
  }
  if (hl) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5 * devicePixelRatio;
    ctx.beginPath(); ctx.arc(hl.x, hl.y, r * 3, 0, Math.PI * 2); ctx.stroke();
    ctx.font = `600 ${14 * devicePixelRatio}px 'EB Garamond', Georgia, serif`;
    const w = ctx.measureText(hl.name).width;
    const lx = Math.min(hl.x + r * 3 + 4, canvas.width - w - 10);
    ctx.fillStyle = 'rgba(231,212,168,0.95)';
    ctx.fillRect(lx - 4, hl.y - 10 * devicePixelRatio, w + 8, 18 * devicePixelRatio);
    ctx.fillStyle = '#2a1a0b';
    ctx.fillText(hl.name, lx, hl.y + 4 * devicePixelRatio);
  }
  ctx.fillStyle = 'rgba(217,251,232,0.8)';
  ctx.font = `bold ${12 * devicePixelRatio}px 'EB Garamond', Georgia, serif`;
  ctx.fillText('N ↑', canvas.width - 40 * devicePixelRatio, 16 * devicePixelRatio);
}

