// Towns tab: every building of a town, grouped by type, on a north-up sketch of its blocks.
import { data, loadTowns, regionName, typeWord, normalise } from './data.js?v=21';
import { el, fill, autocomplete, travelLine } from './ui.js?v=21';
import { state } from './state.js?v=21';
import { showDungeon, dungeonBlocks } from './dungeon.js?v=21';
import { townMap } from './townmap.js?v=21';
import { TOWN_COLOURS, GROUP_OF_BYTE } from './townBytes.js?v=21';

const $ = id => document.getElementById(id);
const BLOCK = 102.4;   // one RMB block is 4096 Daggerfall units = 102.4 m
let current = null, highlight = null, mark = null, tabs = null;
const HOUSE = 5;   // houses: [blockX, blockY, x, z, buildingKey] per house

// the list's group dots use the town map's colours (townBytes.js), so a colour on the map is the colour in the list
// a building type's colour: its automap byte is the type's number + 1
const colourFor = (file, t) => {
  const v = Object.entries(file.buildingTypes).find(([, n]) => n === t)?.[0];
  return TOWN_COLOURS[GROUP_OF_BYTE[(+v || 0) + 1] || 'house'];
};
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
  // a dungeon: its map, right here; a town with a castle or dungeon under it: folded below the town map,
  // unless a quest spot inside was asked for
  const dv = $('dungeon-view'), fold = $('dungeon-fold');
  const hasDungeon = !!(await dungeonBlocks(i));
  const folded = hasDungeon && current.town && !opts.targets?.length;
  fold.hidden = !folded;
  fold.open = false;
  if (folded) fold.append(dv); else fold.after(dv);
  dv.hidden = !hasDungeon;
  if (hasDungeon) {
    if (folded) fold.ontoggle = () => { if (fold.open && !dv.dataset.drawn) { dv.dataset.drawn = '1'; showDungeon(dv, i, []); } };
    else await showDungeon(dv, i, opts.targets || []);
    dv.dataset.drawn = folded ? '' : '1';
  } else fill(dv);
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
      el('h3', {}, el('span', { class: 'dg-legend-dot', style: `background:${colourFor(file, t)}` }), FRIENDLY[t] || t),
      el('ul', {}, groups.get(t).sort((a, b) => a[0].localeCompare(b[0])).map(b => el('li', {},
        el('button', {
          class: 'dg-link' + (b[0] === highlight ? ' dg-on' : ''),
          onclick: () => { highlight = b[0]; mark = null; renderList(); drawMap(); },
        }, b[0] || '(unnamed)', b[9] ? el('span', { class: 'dg-dim', text: ` (offline: ${b[9]})` }) : null)))))),
    rows.length ? null : el('p', { class: 'tool-note', text: 'No building with that name here. If it is a house ("The … Residence"), the quest named it — ask townspeople where it is.' }));
}

// The town map (townmap.js): Daggerfall's own automap picture of the town, the chosen building lit up
let map = null;
async function drawMap() {
  if (!current?.town) return;
  const { town, file } = current;
  map ||= townMap($('town-map'), { colours: TOWN_COLOURS, groupOfByte: GROUP_OF_BYTE,
    onPick: name => { highlight = name; mark = null; renderList(); drawMap(); } });
  const named = town.b.map(b => ({ name: b[0], bx: b[4], by: b[5], x: b[6], z: b[7], type: file.buildingTypes[b[1]], byte: b[1] + 1 }));
  const sel = mark || (highlight && named.find(b => b.name === highlight)) || null;
  await map.show(town, named, sel ? { ...sel, name: sel.name, quest: !!mark } : null, data.locs.name[current.i]);
}
