// Journal tab: paste quest text, find every town/dungeon and building it names.
import { data, normalise, regionName, loadTowns, travelBetween } from './data.js?v=19';
import { el, fill, locationCard } from './ui.js?v=19';
import { state, showOnMap } from './state.js?v=19';
import { openTown } from './towns.js?v=19';
import { recognise } from './recognise.js?v=19';
import { showQuest } from './quests.js?v=19';
import { trackQuest, trackState } from './myquests.js?v=19';
import { stepText, rewardGivers, nameFor } from './questText.js?v=19';
import { formatDuration } from './data.js?v=19';

const $ = id => document.getElementById(id);
let nameIndex = null, regionIndex = null;
const MAX_WORDS = 7;

function buildIndex() {
  nameIndex = new Map();
  for (let i = 0; i < data.count; i++) {
    const key = data.norm[i].replace(/^the /, '');
    if (!nameIndex.has(key)) nameIndex.set(key, []);
    nameIndex.get(key).push(i);
  }
  regionIndex = new Map(data.meta.regions.filter(r => r.locations).map(r => [normalise(r.name), r.i]));
}

export function initJournal() {
  $('journal-find').addEventListener('click', run);
  $('journal-clear').addEventListener('click', () => { $('journal-input').value = ''; fill($('journal-out'), ); });
  $('journal-input').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run(); });
}

// Words with their character spans, so a match can check the original capitalisation
function tokenise(text) {
  const out = [];
  const re = /[A-Za-z0-9'’]+/g;
  let m;
  while ((m = re.exec(text))) out.push({ w: normalise(m[0]), start: m.index, raw: m[0] });
  return out;
}

const capitalised = t => /^[A-Z0-9]/.test(t.raw);

async function run() {
  if (!nameIndex) buildIndex();
  const text = $('journal-input').value;
  const out = $('journal-out');
  if (!text.trim()) { fill(out, el('p', { class: 'tool-note', text: 'Paste a journal entry first.' })); return; }
  const tokens = tokenise(text);

  // Regions the text names ("...in Daggerfall"), to settle names found in several regions
  const regionsNamed = new Set();
  for (let i = 0; i < tokens.length; i++) {
    for (let L = 3; L >= 1; L--) {
      const r = regionIndex.get(tokens.slice(i, i + L).map(t => t.w).join(' '));
      if (r !== undefined && capitalised(tokens[i])) regionsNamed.add(r);
    }
  }

  // Buildings: the towns of the player's region and of every region the text names
  const townRegions = new Set(regionsNamed);
  if (state.here >= 0) townRegions.add(data.locs.region[state.here]);
  const buildingIndex = new Map();
  for (const r of townRegions) {
    const file = await loadTowns(r);
    for (const [id, town] of Object.entries(file.towns)) {
      for (const b of town.b) {
        for (const name of [b[0], b[9]].filter(Boolean)) {
          const key = normalise(name).replace(/^the /, '');
          if (key.split(' ').length < 2) continue;
          if (!buildingIndex.has(key)) buildingIndex.set(key, []);
          buildingIndex.get(key).push({ town: +id, name, type: file.buildingTypes[b[1]], region: r });
        }
      }
    }
  }

  // Greedy longest match over the words; a one-word place must be capitalised in the text
  const found = [];
  const seen = new Set();
  for (let i = 0; i < tokens.length; i++) {
    let hit = null;
    for (let L = Math.min(MAX_WORDS, tokens.length - i); L >= 1 && !hit; L--) {
      const words = tokens.slice(i, i + L);
      if (!capitalised(words[0]) && !(words[0].w === 'the' && words[1] && capitalised(words[1]))) continue;
      const key = words.map(t => t.w).join(' ').replace(/^the /, '');
      if (!key || (L === 1 && key.length < 4)) continue;
      if (/^[a-z]+ residence$/.test(key)) { hit = { kind: 'house', key, phrase: words.map(t => t.raw).join(' '), L }; break; }
      if (buildingIndex.has(key)) hit = { kind: 'building', key, hits: buildingIndex.get(key), L };
      else if (nameIndex.has(key)) hit = { kind: 'place', key, hits: nameIndex.get(key), L };
    }
    if (hit) {
      if (!seen.has(hit.kind + hit.key)) { seen.add(hit.kind + hit.key); found.push(hit); }
      i += hit.L - 1;
    }
  }

  const cards = [];
  const pins = [];
  for (const f of found) {
    if (f.kind === 'place') {
      const ranked = rank(f.hits, regionsNamed);
      const best = ranked[0];
      pins.push(best);
      const alts = ranked.length > 1 ? el('details', { class: 'dg-alts' },
        el('summary', { text: `Also a place called this in ${ranked.length - 1} other region${ranked.length > 2 ? 's' : ''}` }),
        el('ul', {}, ranked.slice(1, 12).map(i => el('li', {},
          el('button', { class: 'dg-link', onclick: () => showOnMap(i) }, `${regionName(data.locs.region[i])}`))))) : null;
      cards.push(locationCard(best, { alternatives: alts }));
    } else if (f.kind === 'building') {
      cards.push(buildingCard(f));
    } else {
      cards.push(houseCard(f.phrase));
    }
  }

  const match = await recognise(text);
  const questPanel = match ? questCard(match) : null;

  fill(out,
    questPanel,
    el('p', { class: 'tool-note' }, found.length
      ? `Found ${found.length} place${found.length === 1 ? '' : 's'}${regionsNamed.size ? ` (region named: ${[...regionsNamed].map(regionName).join(', ')})` : ''}.`
      : match ? 'No town, dungeon or building names in it.' : 'No town, dungeon or building names found, and the text did not match a quest. Try the Quests tab with the quest\'s title.'),
    pins.length > 1 ? el('button', { class: 'tool-btn', onclick: () => showOnMap(pins[0], pins) }, 'Show all on the map') : null,
    ...cards);
}

// Region named in the text first, then the player's region, then the shortest trip
function rank(hits, regionsNamed) {
  const hereRegion = state.here >= 0 ? data.locs.region[state.here] : -1;
  const trip = i => (state.here >= 0 ? travelBetween(state.here, i, state.opts).minutes : 0);
  return [...hits].sort((a, b) =>
    (regionsNamed.has(data.locs.region[b]) - regionsNamed.has(data.locs.region[a])) ||
    ((data.locs.region[b] === hereRegion) - (data.locs.region[a] === hereRegion)) ||
    trip(a) - trip(b));
}

function buildingCard(f) {
  // Prefer the player's own town, then the nearest town that has one
  const here = state.here;
  const towns = [...new Map(f.hits.map(h => [h.town, h])).values()];
  towns.sort((a, b) => (b.town === here) - (a.town === here) ||
    (here >= 0 ? travelBetween(here, a.town, state.opts).minutes - travelBetween(here, b.town, state.opts).minutes : 0));
  const best = towns[0];
  const where = best.town === here ? 'in your town' : `in ${data.locs.name[best.town]}`;
  return el('div', { class: 'dg-card' },
    el('div', { class: 'dg-card-head' },
      el('span', { class: 'dg-card-name', text: best.name }),
      el('span', { class: 'dg-tag', text: friendlyType(best.type) })),
    el('div', { class: 'dg-card-meta', text: `A building ${where}, ${regionName(best.region)}` +
      (towns.length > 1 ? ` · ${towns.length} towns have one; nearest shown` : '') }),
    el('div', { class: 'dg-card-actions' },
      el('button', { class: 'tool-btn', onclick: () => openTown(best.town, best.name) }, 'Show in town'),
      best.town !== here ? el('button', { class: 'tool-btn', onclick: () => showOnMap(best.town) }, 'Show town on map') : null));
}

function houseCard(phrase) {
  return el('div', { class: 'dg-card dg-card-house' },
    el('div', { class: 'dg-card-head' },
      el('span', { class: 'dg-card-name', text: phrase }),
      el('span', { class: 'dg-tag', text: 'House' })),
    el('div', { class: 'dg-card-note', text: 'Houses get a quest name like this only when the quest starts, so it is not on any map ahead of time. ' +
      'Ask townspeople about it ("Where is…" in the talk window), or in DFO Online turn on Settings → Interface → Quest help → Quest guidance: Town, which circles the house on your town map.' }));
}

const FRIENDLY = {
  Alchemist: 'Alchemist', Armorer: 'Armorer', Bank: 'Bank', Bookseller: 'Bookseller', ClothingStore: 'Clothing store',
  FurnitureStore: 'Furniture store', GemStore: 'Jeweler', GeneralStore: 'General store', Library: 'Library',
  GuildHall: 'Guild hall', PawnShop: 'Pawn shop', WeaponSmith: 'Weapon smith', Temple: 'Temple', Tavern: 'Tavern', Palace: 'Palace',
};
export const friendlyType = t => FRIENDLY[t] || (t ? t.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\d+$/, '') : 'Building');


// ---- the recognised quest ----

// The location a recognised place blank names, if it is a known town or dungeon
function locationFor(q, sym, names) {
  const n = names[sym];
  if (!n) return -1;
  for (const v of [n[3], n[2], n[1]]) {
    if (!v) continue;
    const hits = nameIndex.get(normalise(v).replace(/^the /, ''));
    if (hits?.length) return rank(hits, new Set())[0];
  }
  return -1;
}

// Save, or for a quest already saved from an earlier entry, add this entry's new names to it
function saveButton(q, names, days) {
  const st = trackState(q, names);
  const label = { new: 'Save to My quests', update: 'Update my saved quest', saved: 'Saved ✓' }[st];
  return el('button', {
    class: 'tool-btn dg-save', disabled: st === 'saved',
    onclick: e => { const r = trackQuest(q, names, days); e.target.textContent = r === 'updated' ? 'Updated ✓' : 'Saved ✓'; e.target.disabled = true; },
  }, label);
}

function questCard(m) {
  const { quest: q, names, days, partial } = m;
  const givers = rewardGivers(q, names);
  const people = Object.keys(q.resources).filter(sym => q.resources[sym].kind === 'Person' && names[sym]?.[1]);
  const payers = new Set(q.reward.from.map(f => f.sym));

  // Deadline: the quest timer's days against the trip to the quest's main place
  const timerDays = +(days[q.timer] || Object.entries(days).find(([s]) => q.resources[s]?.kind === 'Clock')?.[1] || 0);
  const places = Object.keys(q.resources).filter(sym => q.resources[sym].kind === 'Place');
  const target = places.map(sym => ({ sym, loc: locationFor(q, sym, names) })).filter(p => p.loc >= 0)
    .sort((a, b) => (q.resources[b.sym].scope === 'remote') - (q.resources[a.sym].scope === 'remote'))[0];
  let deadline = null;
  if (timerDays && target && state.here >= 0 && target.loc !== state.here) {
    const trip = t => travelBetween(state.here, target.loc, { ...state.opts, transport: t }).minutes;
    const foot = trip('foot'), horse = trip('horse'), limit = timerDays * 1440;
    const verdict = mins => mins * 2 <= limit ? 'dg-good' : mins <= limit ? 'dg-warn' : 'dg-bad';
    deadline = el('div', { class: 'dg-deadline' },
      el('div', {}, el('b', { class: 'dg-num', text: `${timerDays} days` }), ` to finish (counted from when you took the quest). To ${data.locs.name[target.loc]}:`),
      el('ul', {},
        el('li', { class: verdict(foot) }, `On foot: ${formatDuration(foot)} each way`),
        el('li', { class: verdict(horse) }, `On horseback: ${formatDuration(horse)} each way`)),
      el('div', { class: 'dg-dim', text: 'Green: there and back in time. Orange: you can get there, not back. Red: too slow.' }));
  }

  return el('div', { class: 'dg-card dg-quest-match' },
    el('div', { class: 'dg-reward-label', text: partial ? 'Probably this quest' : 'Quest recognised' }),
    el('div', { class: 'dg-card-head' },
      el('span', { class: 'dg-card-name', text: q.title || q.file }),
      el('span', { class: 'dg-card-actions' },
        el('button', { class: 'tool-btn', onclick: () => showQuest(q, names, days) }, 'Full walkthrough'),
        partial ? null : saveButton(q, names, days))),
    partial ? el('div', { class: 'dg-card-note', text: 'The wording is close but not exact, so names could not be read. Paste the whole entry to fill them in.' }) : null,
    m.others.length ? el('div', { class: 'dg-dim', text: `Same wording also used by: ${m.others.map(o => o.title || o.file).join(', ')}` }) : null,

    el('div', { class: 'dg-reward' + (q.reward.from.some(f => !f.questor) ? ' dg-reward-other' : '') },
      el('div', { class: 'dg-reward-label', text: q.reward.automatic ? 'Reward' : 'Claim reward from' }),
      el('div', { class: 'dg-reward-who', text: q.reward.automatic ? 'Given the moment the job is done — nobody to visit.'
        : givers.map(g => (g.name || (g.questor ? 'the quest giver' : g.role)) + (g.town ? ` in ${g.town}` : '')).join(', or ') }),
      q.reward.from.some(f => !f.questor) ? el('div', { class: 'dg-card-note', text: 'Not the person who gave you the quest.' }) : null,
      ...givers.filter(g => g.name && g.town).map(g => {
        const loc = locationFor(q, g.sym, names);
        return loc >= 0 && loc !== state.here
          ? el('button', { class: 'tool-btn', onclick: () => showOnMap(loc) }, `Show ${data.locs.name[loc]} on map`) : null;
      })),

    people.length ? el('h3', { text: "Who's who" }) : null,
    people.length ? el('ul', { class: 'dg-cast' }, people.map(sym => el('li', {},
      el('b', { text: names[sym][1] }), ` — ${q.resources[sym].role}`,
      names[sym][3] ? ` · in ${names[sym][3]}` : '',
      payers.has(sym) ? el('span', { class: 'dg-tag dg-tag-good', text: 'pays your reward' }) : null))) : null,

    deadline,

    q.steps.length ? el('h3', { text: 'What to do' }) : null,
    q.steps.length ? el('ol', { class: 'dg-steps' }, q.steps.map(st => el('li', { text: stepText(q, st, names) }))) : null);
}
