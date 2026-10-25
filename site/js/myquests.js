// My quests tab: the quests the player is on, kept in this browser. Each entry is a quest file plus the
// names, places and days read from the player's journal (recognise.js), so it can say who pays and
// how far everything is from wherever the player stands now.
import { data, loadQuests, locationsNamed, travelBetween, formatDuration, regionName, loadTowns, loadNames, loadIndividuals } from './data.js?v=13';
import { el, fill } from './ui.js?v=13';
import { state, onChange, showOnMap, setHere } from './state.js?v=13';
import { rewardGivers, nameFor, stepText } from './questText.js?v=13';
import { showQuest } from './quests.js?v=13';
import { openTown, buildingAt, whereInTown } from './towns.js?v=13';
import { planRoute } from './route.js?v=13';
import { readSaves, questsInSave, saveLabel, whereSaved } from './saveImport.js?v=13';

const $ = id => document.getElementById(id);
const KEY = 'dg-myquests';
let list = load();
let tabs = null;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode: kept for this visit */ }
  updateCount();
}

export const hasQuests = () => list.length > 0;

export function initMyQuests(tabApi) {
  tabs = tabApi;
  updateCount();
  onChange(() => { if (state.tab === 'mine') render(); });
}

function updateCount() {
  const btn = document.querySelector('.hud-tab[data-tab="mine"]');
  if (btn) btn.textContent = list.length ? `My quests (${list.length})` : 'My quests';
}

// Two readings of the same quest agree when no blank was read as two different names
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
function compatible(a, b) {
  for (const sym of Object.keys(a)) {
    if (!b[sym]) continue;
    for (const n of Object.keys(a[sym])) if (b[sym][n] && !sameName(a[sym][n], b[sym][n])) return false;
  }
  return true;
}
const covers = (have, names) => Object.entries(names).every(([sym, ns]) =>
  Object.entries(ns).every(([n, v]) => have[sym]?.[n] && sameName(have[sym][n], v)));
const findEntry = (q, names) => list.find(e => e.file === q.file && compatible(e.names, names));

// 'saved' when the quest is saved with every one of these names, 'update' when a newer journal entry
// adds names to a saved quest, else 'new'
export function trackState(q, names = {}) {
  const e = findEntry(q, names);
  return !e ? 'new' : covers(e.names, names) ? 'saved' : 'update';
}
export const isTracked = (q, names = {}) => trackState(q, names) === 'saved';

// the journal's days, else a fixed timer from the script ("1 day"); travel-based timers stay unknown
function timerDays(q, days) {
  const fixed = q.timer && q.resources[q.timer]?.role.match(/^(\d+) days?/);
  return q.timer && days[q.timer] ? +days[q.timer] : fixed ? +fixed[1] : null;
}

// Add a quest (names/days from a recognised journal entry, or none when tracked from the Quests tab).
// A later journal entry of a quest already saved fills in its new names instead of saving it twice.
export function trackQuest(q, names = {}, days = {}) {
  const e = findEntry(q, names);
  if (e) {
    if (covers(e.names, names) && !Object.keys(days).some(k => days[k] !== e.days[k])) return false;
    for (const [sym, ns] of Object.entries(names)) e.names[sym] = { ...e.names[sym], ...ns };
    const fresh = Object.keys(days).some(k => days[k] !== e.days[k]);
    Object.assign(e.days, days);
    if (fresh && timerDays(q, days) != null) e.daysLeft = timerDays(q, days);
    e.key = q.file + '|' + JSON.stringify(e.names);
    save();
    return 'updated';
  }
  list.unshift({ key: q.file + '|' + JSON.stringify(names), file: q.file, names, days, daysLeft: timerDays(q, days), done: [], jobDone: false, saved: Date.now() });
  save();
  return 'saved';
}

// Bring My quests in line with a save: its active quests are added or refreshed (names, places and days
// from the game itself; ticked steps are kept), and quests loaded from an earlier save of the same
// character that are no longer active are finished, so they go.
export function applySave(found, character) {
  const seen = new Set();
  let added = 0, refreshed = 0;
  for (const f of found) {
    let e = list.find(x => x.file === f.q.file && x.uid != null && x.uid === f.uid && x.character === character)
      || list.find(x => x.file === f.q.file && x.uid == null && compatible(x.names, f.names));
    if (e) refreshed++;
    else { e = { file: f.q.file, done: [], jobDone: false, saved: Date.now() }; list.unshift(e); added++; }
    Object.assign(e, { names: f.names, days: f.days, daysLeft: f.daysLeft, locs: f.locs, buildings: f.buildings, spots: f.spots, guide: f.guide, uid: f.uid, character, synced: Date.now() });
    e.key = f.q.file + '|' + JSON.stringify(f.names);
    seen.add(e);
  }
  const before = list.length;
  list = list.filter(x => seen.has(x) || x.uid == null || x.character !== character);
  save();
  return { added, refreshed, finished: before - list.length };
}

// Steps the player does (the rest are facts: "X is at Y")
const ACT = new Set(['kill', 'pickup', 'bring', 'talk', 'go']);
const actions = q => q.steps.map((st, i) => [st, i]).filter(([st]) => ACT.has(st.k));

// The places of a saved quest the player can travel to: [{label, loc, claim}]. Once the job is done
// only the reward is left; until then the reward is claimed after the quest's places.
export function destinations(q, entry) {
  const out = [];
  if (entry.guide) {
    // from a save: the open objectives' own places, the reward last
    for (const o of entry.guide) {
      if (o.loc === undefined || o.loc === null || o.later) continue;
      const claim = o.kind === 'reward' || o.payer;
      if (!out.some(d => d.loc === o.loc && d.claim === claim)) out.push({ label: claim ? `Reward (${o.who || 'the quest giver'})` : sayAction(o, q), loc: o.loc, claim });
    }
    return out;
  }
  const here = state.here;
  const add = (label, name, claim, sym) => {
    const loc = entry.locs?.[sym] ?? locationsNamed(name, here, state.opts)[0];
    if (loc !== undefined && !out.some(d => d.loc === loc && d.claim === claim)) out.push({ label, loc, claim });
  };
  if (!entry.jobDone) {
    for (const [sym, r] of Object.entries(q.resources)) {
      const n = entry.names[sym];
      if (!n) continue;
      if (r.kind === 'Place') add('Quest place', n[3] || n[2] || n[1], false, sym);
    }
  }
  if (!q.reward.automatic) {
    for (const g of rewardGivers(q, entry.names)) {
      if (g.town) add(`Claim reward (${g.name || (g.questor ? 'the quest giver' : g.role)})`, g.town, true, g.sym);
    }
  }
  return out;
}

export async function renderMine() {
  await render();
}

async function render() {
  const box = $('mine-list');
  if (!box) return;
  const quests = await loadQuests();
  const byFile = new Map(quests.map(q => [q.file, q]));
  // the towns the directions point into, so "which part of town" can be told
  const regions = new Set(list.flatMap(e => (e.guide || []).map(o => o.loc)).filter(l => l != null).map(l => data.locs.region[l]));
  await Promise.all([...regions].map(r => loadTowns(r).catch(() => null)));
  if (!list.length) {
    fill(box, syncCard(quests), el('p', { class: 'tool-note', text: 'No quests yet. Sync from the game above, or press "Track" on any quest in the Quests tab.' }));
    return;
  }
  fill(box, syncCard(quests), plannerCard(byFile), ...list.map(entry => {
    const q = byFile.get(entry.file);
    if (!q) return null;
    return entry.guide ? nowCard(q, entry) : legacyCard(q, entry);
  }));
}

// ---- "Do this now": one exact instruction, then the one after it ----
const plural = (n, w) => n > 1 ? `${n} ${w}s` : w;
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
// what to do, in words
function sayAction(o, q) {
  const who = o.who || 'them';
  switch (o.kind) {
    case 'talk': return `Talk to ${who}${o.answer === 'yes' ? ' and answer Yes' : ''}`;
    case 'reward': return o.automatic ? 'Your reward comes the moment the job is done' : `Collect your reward from ${who}`;
    case 'bring': return `Give ${o.item || 'the quest item'} to ${who}${o.payer ? ', who pays your reward' : ''}`;
    case 'kill': return o.injure ? `Wound the ${o.who || 'foe'}, but do not kill it` : `Kill ${o.count > 1 ? plural(o.count, o.who || 'foe') : `the ${o.who || 'foe'}`}`;
    case 'pickup': return `Pick up ${o.item || 'the quest item'}`;
    case 'drop': return `Drop ${o.item || 'the quest item'} here (inventory → drop)`;
    case 'use': return `Use ${o.item || 'the quest item'} from your inventory`;
    case 'cast': return `Cast the spell ${o.spell}`;
    case 'go': return 'Go there';
    default: return '';
  }
}
// where, as a signpost: town, building, and the part of town it stands in
function signpost(o) {
  if (o.loc == null) return null;
  const town = data.locs.name[o.loc];
  if (o.building) {
    const t = data.towns[data.locs.region[o.loc]]?.towns?.[o.loc];
    const p = t && buildingAt(t, o.building.key);
    return { town, place: o.building.name, part: p ? whereInTown(t, p).replace(/^in the /, '').replace(/, about .*$/, '') : null };
  }
  if (o.dungeon || o.spot) return { town, place: o.spot ? 'the marked spot inside' : null, part: o.dungeon ? 'dungeon' : null };
  return { town, place: null, part: null };
}
function nowBlock(o, q) {
  const sp = signpost(o);
  const trip = o.loc != null && state.here >= 0 && o.loc !== state.here ? travelBetween(state.here, o.loc, state.opts) : null;
  const buttons = [];
  if (o.loc != null) {
    if (o.building) buttons.push(el('button', { class: 'dg-chip-btn dg-go-town', onclick: () => openTown(o.loc, o.building.name, { key: o.building.key }) }, 'Town'));
    if (o.spot || o.dungeon) buttons.push(el('button', { class: 'dg-chip-btn dg-go-dungeon', onclick: () => openTown(o.loc, null, { targets: o.spot ? [{ ...o.spot, label: cap(o.who || o.item || 'Here') }] : [] }) }, 'Dungeon'));
    if (o.loc !== state.here) buttons.push(el('button', { class: 'dg-chip-btn dg-go-map', onclick: () => showOnMap(o.loc, null, state.here >= 0 ? [state.here, o.loc] : null) }, 'World'));
  }
  const meta = [sp?.part, o.loc === state.here ? 'you are here' : trip ? `${formatDuration(trip.minutes)} away` : null].filter(Boolean);
  return el('div', { class: 'dg-step-block dg-step-now' },
    sp ? el('div', { class: 'dg-sign' },
      el('span', { class: 'dg-sign-arrow', text: '▶' }),
      el('span', { class: 'dg-sign-town', text: sp.town }),
      sp.place ? el('span', { class: 'dg-sign-sep', text: '›' }) : null,
      sp.place ? el('span', { class: 'dg-sign-place', text: sp.place }) : null) : null,
    meta.length ? el('div', { class: 'dg-sign-meta', text: meta.join(' · ') }) : null,
    el('div', { class: 'dg-step-what', text: sayAction(o, q) + '.' + (o.later ? ' (It appears once the step before is done.)' : '') }),
    buttons.length ? el('div', { class: 'dg-step-buttons' }, ...buttons) : null);
}
function thenLine(o, q) {
  const sp = signpost(o);
  const where = sp ? [sp.town, sp.place].filter(Boolean).join(' › ') : '';
  return el('div', { class: 'dg-then' }, el('span', { class: 'dg-then-label', text: 'then: ' }), sayAction(o, q) + (where ? ` (${where})` : '') + '.');
}
function nowCard(q, entry) {
  const g = entry.guide;
  const remove = () => { list = list.filter(e => e !== entry); save(); render(); };
  const head = el('div', { class: 'dg-card-head dg-now-head' },
    el('span', { class: 'dg-card-name', text: q.title || q.file }),
    el('span', { class: 'dg-now-side' },
      el('span', { class: 'dg-tag' + (entry.daysLeft != null && entry.daysLeft <= 2 ? ' dg-tag-warn' : ''), text: entry.daysLeft != null ? `${entry.daysLeft} day${entry.daysLeft === 1 ? '' : 's'}` : 'no limit' }),
      el('button', { class: 'dg-done', title: 'Done: remove this quest', 'aria-label': 'Done, remove this quest', onclick: remove }, '✓')));
  const body = !g.length
    ? el('div', { class: 'dg-step-block dg-step-now' }, el('div', { class: 'dg-step-what', text: 'Nothing the guide can point to. Check the quest in your journal, or open details.' }))
    : [nowBlock(g[0], q), g[1] ? thenLine(g[1], q) : null];
  return el('div', { class: 'dg-card dg-mine dg-mine-now' }, head, body,
    el('details', { class: 'dg-more' }, el('summary', { text: 'details' }), ...legacyParts(q, entry)));
}

// ---- quests added from the journal or the Quests tab (no save): the full card ----
function legacyParts(q, entry) {
  const givers = rewardGivers(q, entry.names);
  const dests = destinations(q, entry);
  const who = q.reward.automatic ? 'given when the job is done'
    : givers.map(g => (g.name || (g.questor ? 'the quest giver' : g.role)) + (g.town ? ` in ${g.town}` : '')).join(', or ');
  const left = el('input', {
    class: 'tool-number-input dg-days', type: 'number', min: 0, max: 999, value: entry.daysLeft ?? '',
    placeholder: '–', 'aria-label': 'Game days left',
    onchange: e => { entry.daysLeft = e.target.value === '' ? null : +e.target.value; save(); render(); },
  });
  return [
    el('div', { class: 'dg-card-meta' }, el('b', { text: 'Claim reward from: ' }), who),
    entry.guide ? null : progress(q, entry, who),
    el('ul', { class: 'dg-trips' }, dests.map(d => {
      const trip = state.here >= 0 && d.loc !== state.here ? travelBetween(state.here, d.loc, state.opts) : null;
      const late = trip && entry.daysLeft != null && trip.minutes > entry.daysLeft * 1440;
      return el('li', {},
        `${d.label}: ${data.locs.name[d.loc]}, ${regionName(data.locs.region[d.loc])} — `,
        d.loc === state.here ? el('b', { class: 'dg-good', text: 'you are here' })
          : trip ? el('b', { class: late ? 'dg-bad' : 'dg-num', text: formatDuration(trip.minutes) + (late ? ' (longer than the time left)' : '') })
            : el('span', { class: 'dg-dim', text: 'set "I am in" for the trip' }),
        ' ', el('button', { class: 'dg-link', onclick: () => showOnMap(d.loc) }, 'map'));
    })),
    dests.length ? null : el('div', { class: 'dg-dim', text: 'No places known yet: sync from the game to fill them in.' }),
    inTown(q, entry),
    el('div', { class: 'dg-card-actions' },
      el('label', { class: 'dg-days-label' }, 'Game days left ', left),
      el('button', { class: 'tool-btn', onclick: () => showQuest(q, entry.names, entry.days) }, 'Walkthrough')),
  ];
}
function legacyCard(q, entry) {
  return el('div', { class: 'dg-card dg-mine' + (entry.jobDone ? ' dg-mine-done' : '') },
    el('div', { class: 'dg-card-head' },
      el('span', { class: 'dg-card-name', text: q.title || q.file }),
      el('span', { class: 'dg-tag', text: entry.daysLeft != null ? `${entry.daysLeft} day${entry.daysLeft === 1 ? '' : 's'} left` : 'no time limit noted' })),
    ...legacyParts(q, entry),
    el('div', { class: 'dg-card-actions' },
      el('button', { class: 'tool-btn', onclick: () => { list = list.filter(e => e !== entry); save(); render(); } }, 'Done — remove')));
}

// ---- bring a save in: from the Sync bookmark (postMessage, app.js) or a saves file ----
let importMsg = null;
export async function loadSnapshot(snap, info, via) {
  const [quests, names, individuals] = await Promise.all([loadQuests(), loadNames(), loadIndividuals()]);
  const { found, unknown } = questsInSave(snap, quests, { names, individuals });
  const r = applySave(found, info?.characterName ?? null);
  const at = whereSaved(snap);
  if (at >= 0) setHere(at);
  importMsg = [el('b', { class: 'dg-good-ink', text: `${via === 'sync' ? 'Synced' : 'Loaded'} ${found.length} quest${found.length === 1 ? '' : 's'}${info ? ` from ${saveLabel({ info, n: 0 })}` : ''}.` }),
    ` ${r.added} new, ${r.refreshed} updated${r.finished ? `, ${r.finished} finished and removed` : ''}.`,
    at >= 0 ? ` "I am in" set to ${data.locs.name[at]}.` : '',
    unknown.length ? el('div', { class: 'dg-dim', text: `Not in the guide's quest list: ${unknown.join(', ')}` }) : ''];
  if (state.tab !== 'mine') tabs?.show('mine');
  await render();
  return found.length;
}
// ---- the top card: Sync from the game (one click), or a saves file ----
let fileOpen = false;
function syncCard(quests) {
  const msg = el('div', { class: 'dg-import-msg', 'aria-live': 'polite' });
  if (importMsg) fill(msg, ...importMsg);
  const choose = el('div', { class: 'dg-import-choose' });
  const take = async file => {
    importMsg = null;
    fileOpen = true;
    drop.closest('details').open = true;
    fill(msg, el('span', { class: 'dg-dim', text: 'Reading…' }));
    try {
      const saves = await readSaves(file);
      const go = s => { fileOpen = true; loadSnapshot(s.snap, s.info, 'file'); };
      if (saves.length === 1) return go(saves[0]);
      fill(msg, el('span', { text: `${saves.length} saves in this file. Pick one (newest first):` }));
      fill(choose, ...saves.slice(0, 12).map(s => el('button', { class: 'tool-btn dg-save-pick', onclick: () => go(s) }, saveLabel(s))));
    } catch (e) {
      fill(msg, el('span', { class: 'dg-bad-ink', text: `Could not read that file: ${e.message}.` }));
    }
  };
  const input = el('input', { type: 'file', accept: '.zip,.txt,.json', class: 'dg-file', id: 'save-file', onchange: e => e.target.files[0] && take(e.target.files[0]) });
  const drop = el('label', { class: 'dg-drop', for: 'save-file' },
    el('b', { text: 'Choose your saves file' }), el('span', { class: 'dg-dim', text: ' or drop it here (DFO-Online-Saves.zip)' }));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dg-drop-on'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dg-drop-on'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('dg-drop-on'); if (e.dataTransfer.files[0]) take(e.dataTransfer.files[0]); });
  const last = Math.max(0, ...list.map(e => e.synced || 0));
  if (list.length) {
    return el('div', { class: 'dg-bar dg-import' },
      el('div', { class: 'dg-bar-row' },
        el('span', { class: 'dg-bar-title', text: '⚔ ' + (last ? `Synced ${ago(last)}` : 'Sync from the game') }),
        el('a', { class: 'dg-bar-link', href: 'sync.html' }, 'how to sync')),
      msg,
      el('details', { class: 'dg-import-file', open: fileOpen }, el('summary', { text: 'load a saves file' }), input, drop, choose));
  }
  return el('div', { class: 'dg-card dg-import' },
    el('div', { class: 'dg-sync-row' },
      el('div', {},
        el('div', { class: 'dg-card-name', text: 'Sync from the game' }),
        el('div', { class: 'dg-dim', text: 'In DFO Online, click your ⚔ Sync quests bookmark: this page opens with every quest you are on.' })),
      el('a', { class: 'tool-btn dg-sync-setup', href: 'sync.html' }, list.length ? 'Set up the button' : 'Set it up (once)')),
    msg,
    el('details', { class: 'dg-import-file', open: fileOpen },
      el('summary', { text: 'Or load a saves file' }),
      el('p', { class: 'dg-dim', text: 'DFO Online: Load Game → Move saves → Export all saves, then choose the zip here. Read on your device only.' }),
      input, drop, choose));
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// ---- where in town: the quest's people and places that are inside a building ----
function inTown(q, entry) {
  const rows = [];
  for (const [sym, r] of Object.entries(q.resources)) {
    if (r.kind !== 'Person' && r.kind !== 'Place') continue;
    const exact = entry.buildings?.[sym];
    const n = entry.names?.[sym] || {};
    const name = exact?.name || n[2];
    if (!name) continue;
    const loc = exact?.loc ?? entry.locs?.[sym] ?? locationsNamed(n[3], state.here, state.opts)[0];
    if (loc === undefined) continue;
    if (rows.some(x => x.loc === loc && x.name === name)) continue;
    const who = r.kind === 'Person' ? (n[1] || r.role) : r.role;
    rows.push({ loc, name, key: exact?.key, who, pays: q.reward.from.some(f => f.sym === sym) });
  }
  // dungeon spots from a save: who or what stands where inside the quest's dungeon
  const lines = [];
  for (const [sym, list] of Object.entries(entry.spots || {})) {
    const loc = entry.locs?.[sym];
    if (loc === undefined) continue;
    const label = what => what.map(w => nameFor(q, w, entry.names) || q.resources[w]?.role || w.replace(/_/g, ' ').trim()).join(', ');
    const targets = list.map(t => ({ ...t, label: cap(label(t.what)) }));
    lines.push(el('li', {},
      el('b', { text: targets.map(t => t.label).join('; ') }), ` — inside ${data.locs.name[loc]} `,
      el('button', { class: 'dg-link dg-find-dungeon', onclick: () => openTown(loc, null, { targets }) }, 'dungeon map')));
  }
  if (!rows.length && !lines.length) return null;
  return el('div', { class: 'dg-intown' },
    el('b', { text: 'Where to look' }),
    lines.length ? el('ul', { class: 'dg-trips' }, lines) : null,
    rows.length ? el('ul', { class: 'dg-trips' }, rows.map(x => el('li', {},
      el('b', { text: x.who }), x.pays ? el('span', { class: 'dg-tag dg-tag-good', text: 'pays' }) : '',
      ` — ${x.name}, ${data.locs.name[x.loc]} `,
      el('button', { class: 'dg-link', onclick: () => openTown(x.loc, x.name, { key: x.key }) }, 'find it')))) : null);
}

// ---- progress: tick the steps off; the next one is spelled out ----
function progress(q, entry, who) {
  entry.done ||= [];
  const acts = actions(q);
  const set = (fn) => { fn(); save(); render(); };
  const next = entry.jobDone
    ? (q.reward.automatic ? 'Job done: the reward was given. Press "Done — remove".' : `Go and claim your reward from ${who}.`)
    : acts.find(([, i]) => !entry.done.includes(i))?.[0];
  const box = (checked, label, onchange) => el('label', { class: 'tool-check dg-ink dg-step' + (checked ? ' dg-step-done' : '') },
    el('input', { type: 'checkbox', checked, onchange }), ' ', label);
  return el('div', { class: 'dg-progress' },
    el('div', { class: 'dg-next' }, el('b', { text: 'Next: ' }),
      typeof next === 'string' ? next : next ? stepText(q, next, entry.names) : 'Do the job, then tick "Job done".'),
    el('details', { class: 'dg-checklist', open: !entry.jobDone && acts.length > 0 },
      el('summary', { text: `Steps (${acts.filter(([, i]) => entry.done.includes(i)).length + (entry.jobDone ? 1 : 0)}/${acts.length + 1} done)` }),
      ...acts.map(([st, i]) => box(entry.done.includes(i), stepText(q, st, entry.names), e => set(() => {
        entry.done = e.target.checked ? [...entry.done, i] : entry.done.filter(x => x !== i);
        // the last step ticked finishes the job; unticking one reopens it
        entry.jobDone = acts.every(([, j]) => entry.done.includes(j));
      }))),
      box(entry.jobDone, q.reward.automatic ? 'Job done' : 'Job done — only the reward is left', e => set(() => {
        entry.jobDone = e.target.checked;
        entry.done = entry.jobDone ? acts.map(([, i]) => i) : [];
      }))));
}

// ---- route planner ----
let returnHome = false;
function plannerCard(byFile) {
  const card = el('details', { class: 'dg-card dg-planner' });
  // a stop per place (quest places and reward towns kept apart, so a reward waits for its own job only)
  const stops = [];
  for (const entry of list) {
    const q = byFile.get(entry.file);
    if (!q) continue;
    const dests = destinations(q, entry).filter(d => d.loc !== state.here);
    const deadlineMin = entry.daysLeft != null ? entry.daysLeft * 1440 : null;
    const jobStops = [];
    for (const d of dests.sort((a, b) => a.claim - b.claim)) {
      let k = stops.findIndex(s => s.loc === d.loc && s.claim === d.claim);
      if (k < 0) { k = stops.push({ loc: d.loc, claim: d.claim, deadlineMin: null, after: [], why: [] }) - 1; }
      const st = stops[k];
      st.why.push(`${q.title || q.file}: ${d.label}`);
      if (deadlineMin != null) st.deadlineMin = Math.min(st.deadlineMin ?? Infinity, deadlineMin);
      if (d.claim) st.after.push(...jobStops.filter(j => !st.after.includes(j)));
      else jobStops.push(k);
    }
  }
  const head = el('summary', { class: 'dg-card-head dg-planner-head' },
    el('span', { class: 'dg-card-name', text: 'Best order for all my quests' }),
    el('span', { class: 'dg-tag', text: `${stops.length} place${stops.length === 1 ? '' : 's'} to visit` }));
  if (state.here < 0) return fill(card, head, el('div', { class: 'dg-card-note', text: 'Set "I am in" above to plan a route from where you are.' })), card;
  if (!stops.length) return fill(card, head, el('div', { class: 'dg-dim', text: 'Nothing to visit: sync from the game so the quests\' places are known.' })), card;

  const result = el('div', { class: 'dg-route' });
  const run = () => {
    const plan = planRoute(state.here, stops, state.opts, { returnHome });
    let clock = 0;
    const route = [state.here, ...plan.order.map(k => stops[k].loc)];
    if (returnHome) route.push(state.here);
    fill(result,
      el('ol', { class: 'dg-steps' }, plan.order.map((k, n) => {
        clock += plan.legs[n];
        const st = stops[k], late = plan.late.includes(k);
        return el('li', {},
          el('b', { text: data.locs.name[st.loc] }), `, ${regionName(data.locs.region[st.loc])} — `,
          el('span', { class: 'dg-num', text: `${formatDuration(plan.legs[n])} (arrive day ${Math.ceil(clock / 1440) || 1})` }),
          late ? el('span', { class: 'dg-bad', text: ' · after its days run out' }) : '',
          el('div', { class: 'dg-dim', text: st.why.join(' · ') }));
      }), returnHome ? el('li', {}, el('b', { text: `Back to ${data.locs.name[state.here]}` }), ` — ${formatDuration(plan.legs[plan.legs.length - 1])}`) : null),
      el('div', { class: 'dg-route-total' }, el('b', { text: 'Total: ' }), el('span', { class: 'dg-num', text: formatDuration(plan.total) }),
        plan.late.length ? el('span', { class: 'dg-bad', text: ` · ${plan.late.length} quest place${plan.late.length > 1 ? 's' : ''} reached late: travel faster (horse, recklessly) or drop one` } ) : el('span', { class: 'dg-good', text: ' · every deadline met' })),
      el('button', { class: 'tool-btn', onclick: () => showOnMap(route[1], route.slice(1).filter(l => l !== state.here), route) }, 'Show route on map'));
  };
  const home = el('label', { class: 'tool-check dg-ink' },
    el('input', { type: 'checkbox', checked: returnHome, onchange: e => { returnHome = e.target.checked; run(); } }), ` Come back to ${data.locs.name[state.here]} at the end`);
  fill(card, head, el('div', { class: 'dg-card-meta', text: `The fastest order from ${data.locs.name[state.here]} with your travel settings, checked against each quest's days left. Rewards come after their quest's job; tick "Job done" and the job's place drops off.` }), home, result);
  run();
  return card;
}
