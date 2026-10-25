// Loads the built game data and answers lookups: locations, regions, travel between two places.
import { calculateTravelTime, calculateTripCost, travelDays, walkTravelPath } from './vendor/travelCore.js?v=17';

export const V = '5';
const get = (path, kind = 'json') => fetch(`${path}?v=${V}`).then(r => {
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return kind === 'json' ? r.json() : r.arrayBuffer();
});

export const data = { meta: null, locs: null, climate: null, politic: null, picker: null, dots: null, quests: null, towns: {} };

export async function loadCore() {
  const [meta, locs, climate, politic, picker, dots] = await Promise.all([
    get('data/meta.json'), get('data/locations.json'), get('data/climate.bin', 'bin'),
    get('data/politic.bin', 'bin'), get('data/picker.bin', 'bin'), get('data/mapdots.json'),
  ]);
  Object.assign(data, { meta, locs, climate: new Uint8Array(climate), politic: new Uint8Array(politic), picker: new Uint8Array(picker), dots });
  data.count = locs.name.length;
  data.norm = locs.name.map(normalise);
  return data;
}

let questsPromise = null;
export const loadQuests = () => (questsPromise ||= get('data/quests.json').then(q => (data.quests = q)));

// Basic Roads layers (roads, tracks, rivers, streams; 1000x500 bytes each), loaded with the map
let roadsPromise = null;
export const loadRoads = () => (roadsPromise ||= get('data/roads.bin', 'bin').then(b => (data.roads = new Uint8Array(b))));

// Book titles and spell names (data/names.json), and where the fixed NPCs stand (data/individuals.json)
let namesPromise = null, individualsPromise = null;
export const loadNames = () => (namesPromise ||= get('data/names.json').catch(() => ({ books: {}, spells: {} })));
export const loadIndividuals = () => (individualsPromise ||= get('data/individuals.json').catch(() => ({})));

export async function loadTowns(region) {
  if (!data.towns[region]) data.towns[region] = await get(`data/towns/r${String(region).padStart(2, '0')}.json`);
  return data.towns[region];
}

// ---- names ----

export function normalise(s) {
  return s.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const stripThe = s => s.replace(/^the /, '');

export const regionName = r => data.meta.regions[r]?.name ?? `Region ${r}`;

const TYPE_WORDS = {
  TownCity: 'City', TownHamlet: 'Town', TownVillage: 'Village', HomeFarms: 'Farm', DungeonLabyrinth: 'Dungeon (large)',
  ReligionTemple: 'Temple', Tavern: 'Tavern', DungeonKeep: 'Dungeon', HomeWealthy: 'Manor', ReligionCult: 'Shrine',
  DungeonRuin: 'Dungeon (small)', HomePoor: 'Cottage', Graveyard: 'Graveyard', Coven: 'Coven', HomeYourShips: 'Your ship',
};
const DUNGEON_WORDS = {
  Crypt: 'crypt', OrcStronghold: 'orc stronghold', HumanStronghold: 'human stronghold', Prison: 'prison',
  DesecratedTemple: 'desecrated temple', Mine: 'mine', NaturalCave: 'natural cave', Coven: 'coven',
  VampireHaunt: 'vampire haunt', Laboratory: 'laboratory', HarpyNest: 'harpy nest', RuinedCastle: 'ruined castle',
  SpiderNest: 'spider nest', GiantStronghold: 'giant stronghold', DragonsDen: "dragon's den",
  BarbarianStronghold: 'barbarian stronghold', VolcanicCaves: 'volcanic caves', ScorpionNest: 'scorpion nest',
  Cemetery: 'cemetery',
};
export function typeWord(i) {
  const t = data.meta.locationTypes[data.locs.type[i]];
  return TYPE_WORDS[t] || t || 'Place';
}
export function dungeonWord(i) {
  const d = data.meta.dungeonTypes[data.locs.dungeon[i]];
  return d && d !== 'NoDungeon' ? DUNGEON_WORDS[d] || d : null;
}
export const isTown = i => data.locs.type[i] <= 2;
export const isDungeon = i => [4, 7, 10].includes(data.locs.type[i]);

// Fuzzy search over location names: exact > prefix > word prefix > substring > subsequence
export function searchLocations(query, { region = -1, limit = 12, filter = null } = {}) {
  const q = normalise(query);
  if (!q) return [];
  const qs = stripThe(q);
  const out = [];
  for (let i = 0; i < data.count; i++) {
    if (region >= 0 && data.locs.region[i] !== region) continue;
    if (filter && !filter(i)) continue;
    const n = data.norm[i], ns = stripThe(n);
    let score;
    if (n === q || ns === qs) score = 0;
    else if (ns.startsWith(qs)) score = 1;
    else if ((' ' + ns).includes(' ' + qs)) score = 2;
    else if (ns.includes(qs)) score = 3;
    else if (subsequence(qs, ns)) score = 5;
    else continue;
    out.push([score + (isTown(i) ? 0 : 0.5), ns.length, i]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out.slice(0, limit).map(r => r[2]);
}
function subsequence(q, s) {
  let j = 0;
  for (let i = 0; i < s.length && j < q.length; i++) if (s[i] === q[j]) j++;
  return j === q.length;
}

// ---- travel ----

export const climateAt = (x, y) => data.climate[y * 1000 + x];

export function travelBetween(a, b, opts) {
  const s = { x: data.locs.px[a], y: data.locs.py[a] }, e = { x: data.locs.px[b], y: data.locs.py[b] };
  const o = {
    speedCautious: opts.pace !== 'reckless', sleepModeInn: opts.sleep === 'inn', travelShip: !!opts.ship,
    hasHorse: opts.transport === 'horse', hasCart: opts.transport === 'cart', seaMult: 1,
  };
  const t = calculateTravelTime(s, e, o, climateAt);
  const cost = calculateTripCost(t.minutes, t.oceanPixels, { sleepModeInn: o.sleepModeInn, travelShip: o.travelShip });
  return { ...t, days: travelDays(t.minutes), cost: cost.totalCost, path: walkTravelPath(s, e) };
}

// Compass direction and straight-line distance (a map pixel is 32768 Daggerfall units = 819.2 m)
const DIRS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
export function bearing(a, b) {
  const dx = data.locs.px[b] - data.locs.px[a], dy = data.locs.py[a] - data.locs.py[b];
  if (!dx && !dy) return { dir: 'here', km: 0 };
  const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return { dir: DIRS[(sector + 8) % 8], km: Math.hypot(dx, dy) * 0.8192 };
}

export function formatDuration(minutes) {
  const d = Math.floor(minutes / 1440), h = Math.round((minutes % 1440) / 60);
  if (d && h) return `${d} day${d === 1 ? '' : 's'} ${h} h`;
  if (d) return `${d} day${d === 1 ? '' : 's'}`;
  return `${Math.max(1, h)} h`;
}

// Locations called exactly this (ignoring case and a leading "The"), nearest first:
// the player's region, then the shortest trip from where they are
let byName = null;
export function locationsNamed(name, here = -1, opts = null) {
  if (!byName) {
    byName = new Map();
    for (let i = 0; i < data.count; i++) {
      const k = data.norm[i].replace(/^the /, '');
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(i);
    }
  }
  const hits = byName.get(normalise(name || '').replace(/^the /, '')) || [];
  if (here < 0) return hits;
  const region = data.locs.region[here];
  return [...hits].sort((a, b) =>
    ((data.locs.region[b] === region) - (data.locs.region[a] === region)) ||
    (opts ? travelBetween(here, a, opts).minutes - travelBetween(here, b, opts).minutes : 0));
}
