// My quests tab: the quests the player is on, kept in this browser. Each entry is a quest file plus the
// names, places and days read from the player's journal (recognise.js), so it can say who pays and
// how far everything is from wherever the player stands now.
import { data, loadQuests, locationsNamed, travelBetween, formatDuration, regionName } from './data.js?v=7';
import { el, fill } from './ui.js?v=7';
import { state, onChange, showOnMap, setHere } from './state.js?v=7';
import { rewardGivers, nameFor, stepText } from './questText.js?v=7';
import { showQuest } from './quests.js?v=7';
import { planRoute } from './route.js?v=7';
import { readSaves, questsInSave, saveLabel, whereSaved } from './saveImport.js?v=7';

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
    Object.assign(e, { names: f.names, days: f.days, daysLeft: f.daysLeft, locs: f.locs, uid: f.uid, character });
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
  if (!list.length) {
    fill(box, importCard(quests), el('p', { class: 'tool-note', text: 'No quests yet. Load them from your game save above, or press "Track" on any quest in the Quests tab.' }));
    return;
  }
  fill(box, importCard(quests), plannerCard(byFile), ...list.map(entry => {
    const q = byFile.get(entry.file);
    if (!q) return null;
    const givers = rewardGivers(q, entry.names);
    const dests = destinations(q, entry);
    const who = q.reward.automatic ? 'given when the job is done'
      : givers.map(g => (g.name || (g.questor ? 'the quest giver' : g.role)) + (g.town ? ` in ${g.town}` : '')).join(', or ');
    const left = el('input', {
      class: 'tool-number-input dg-days', type: 'number', min: 0, max: 999, value: entry.daysLeft ?? '',
      placeholder: '–', 'aria-label': 'Game days left',
      onchange: e => { entry.daysLeft = e.target.value === '' ? null : +e.target.value; save(); render(); },
    });
    return el('div', { class: 'dg-card dg-mine' + (entry.jobDone ? ' dg-mine-done' : '') },
      el('div', { class: 'dg-card-head' },
        el('span', { class: 'dg-card-name', text: q.title || q.file }),
        el('span', { class: 'dg-tag', text: entry.daysLeft != null ? `${entry.daysLeft} day${entry.daysLeft === 1 ? '' : 's'} left` : 'no time limit noted' })),
      el('div', { class: 'dg-card-meta' }, el('b', { text: 'Claim reward from: ' }), who),
      progress(q, entry, who),
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
      dests.length ? null : el('div', { class: 'dg-dim', text: 'No places known yet: save it from a pasted journal entry to fill them in.' }),
      el('div', { class: 'dg-card-actions' },
        el('label', { class: 'dg-days-label' }, 'Game days left ', left),
        el('button', { class: 'tool-btn', onclick: () => showQuest(q, entry.names, entry.days) }, 'Walkthrough'),
        el('button', { class: 'tool-btn', onclick: () => { list = list.filter(e => e !== entry); save(); render(); } }, 'Done — remove')));
  }));
}

// ---- load from the game: DFO Online's "Export all saves" zip ----
let importMsg = null, importOpen = null;
function importCard(quests) {
  const msg = el('div', { class: 'dg-import-msg', 'aria-live': 'polite' });
  if (importMsg) fill(msg, ...importMsg);
  const choose = el('div', { class: 'dg-import-choose' });
  const take = async file => {
    importMsg = null;
    fill(msg, el('span', { class: 'dg-dim', text: 'Reading…' }));
    try {
      const saves = await readSaves(file);
      const go = s => {
        const { found, unknown } = questsInSave(s.snap, quests);
        const r = applySave(found, s.info?.characterName ?? null);
        const at = whereSaved(s.snap);
        if (at >= 0) setHere(at);
        importMsg = [el('b', { class: 'dg-good-ink', text: `Loaded ${found.length} quest${found.length === 1 ? '' : 's'} from ${saveLabel(s)}.` }),
          ` ${r.added} new, ${r.refreshed} updated${r.finished ? `, ${r.finished} finished and removed` : ''}.`,
          at >= 0 ? ` "I am in" set to ${data.locs.name[at]}.` : '',
          unknown.length ? el('div', { class: 'dg-dim', text: `Not in the guide's quest list: ${unknown.join(', ')}` }) : ''];
        importOpen = true;   // stays open so the result shows
        render();
      };
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
  return el('details', { class: 'dg-card dg-import', open: importOpen ?? !list.length },
    el('summary', { class: 'dg-card-name', text: 'Load my quests from the game' }),
    el('ol', { class: 'dg-howto' },
      el('li', {}, 'In DFO Online, save your game (Esc → Save Game).'),
      el('li', {}, 'Open ', el('b', { text: 'Load Game' }), ', find the ', el('b', { text: 'Move saves' }), ' box and press ', el('b', { text: 'Export all saves' }), '. Your browser downloads ', el('b', { text: 'DFO-Online-Saves.zip' }), '.'),
      el('li', {}, 'Choose that file here. It is read on your device only, nothing is uploaded.'),
      el('li', { class: 'dg-dim' }, 'Playing an online (realm) character? Copy it to offline first so it shows in the Load list, then export.')),
    input, drop, choose, msg);
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
  const card = el('div', { class: 'dg-card dg-planner' });
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
  const head = el('div', { class: 'dg-card-head' },
    el('span', { class: 'dg-card-name', text: 'Plan my route' }),
    el('span', { class: 'dg-tag', text: `${stops.length} place${stops.length === 1 ? '' : 's'} to visit` }));
  if (state.here < 0) return fill(card, head, el('div', { class: 'dg-card-note', text: 'Set "I am in" above to plan a route from where you are.' })), card;
  if (!stops.length) return fill(card, head, el('div', { class: 'dg-dim', text: 'Nothing to visit: save quests from your journal so their places are known.' })), card;

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
