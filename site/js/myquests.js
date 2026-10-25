// My quests tab: the quests the player is on, kept in this browser. Each entry is a quest file plus the
// names, places and days read from the player's journal (recognise.js), so it can say who pays and
// how far everything is from wherever the player stands now.
import { data, loadQuests, locationsNamed, travelBetween, formatDuration, regionName } from './data.js?v=5';
import { el, fill } from './ui.js?v=5';
import { state, onChange, showOnMap } from './state.js?v=5';
import { rewardGivers, nameFor } from './questText.js?v=5';
import { showQuest } from './quests.js?v=5';
import { planRoute } from './route.js?v=5';

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

// Add a quest (names/days from a recognised journal entry, or none when tracked from the Quests tab)
export function trackQuest(q, names = {}, days = {}) {
  const key = q.file + '|' + JSON.stringify(names);
  if (list.some(e => e.key === key)) return false;
  // the journal's days, else a fixed timer from the script ("1 day"); travel-based timers stay unknown
  const fixed = q.timer && q.resources[q.timer]?.role.match(/^(\d+) days?/);
  const timer = q.timer && days[q.timer] ? +days[q.timer] : fixed ? +fixed[1] : null;
  list.unshift({ key, file: q.file, names, days, daysLeft: timer, saved: Date.now() });
  save();
  return true;
}

export const isTracked = (q, names = {}) => list.some(e => e.key === q.file + '|' + JSON.stringify(names));

// The places of a saved quest the player can travel to: [{label, loc}]
export function destinations(q, entry) {
  const out = [];
  const here = state.here;
  const add = (label, name) => {
    const loc = locationsNamed(name, here, state.opts)[0];
    if (loc !== undefined && !out.some(d => d.loc === loc)) out.push({ label, loc });
  };
  for (const [sym, r] of Object.entries(q.resources)) {
    const n = entry.names[sym];
    if (!n) continue;
    if (r.kind === 'Place') add('Quest place', n[3] || n[2] || n[1]);
  }
  for (const g of rewardGivers(q, entry.names)) {
    if (g.town) add(`Claim reward (${g.name || (g.questor ? 'the quest giver' : g.role)})`, g.town);
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
    fill(box, el('p', { class: 'tool-note', text: 'No quests saved yet. Paste a journal entry in the Journal tab and press "Save to My quests", or press "Track" on any quest in the Quests tab.' }));
    return;
  }
  fill(box, plannerCard(byFile), ...list.map(entry => {
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
    return el('div', { class: 'dg-card dg-mine' },
      el('div', { class: 'dg-card-head' },
        el('span', { class: 'dg-card-name', text: q.title || q.file }),
        el('span', { class: 'dg-tag', text: entry.daysLeft != null ? `${entry.daysLeft} day${entry.daysLeft === 1 ? '' : 's'} left` : 'no time limit noted' })),
      el('div', { class: 'dg-card-meta' }, el('b', { text: 'Claim reward from: ' }), who),
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

// ---- route planner ----
let returnHome = false;
function plannerCard(byFile) {
  const card = el('div', { class: 'dg-card dg-planner' });
  const stops = [];
  for (const entry of list) {
    const q = byFile.get(entry.file);
    if (!q) continue;
    for (const d of destinations(q, entry)) {
      if (d.loc === state.here) continue;
      const deadlineMin = entry.daysLeft != null ? entry.daysLeft * 1440 : null;
      const same = stops.find(s => s.loc === d.loc);
      if (same) {
        same.why.push(`${q.title || q.file}: ${d.label}`);
        if (deadlineMin != null) same.deadlineMin = Math.min(same.deadlineMin ?? Infinity, deadlineMin);
      } else stops.push({ loc: d.loc, deadlineMin, why: [`${q.title || q.file}: ${d.label}`] });
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
  fill(card, head, el('div', { class: 'dg-card-meta', text: `The fastest order from ${data.locs.name[state.here]} with your travel settings, checked against each quest's days left.` }), home, result);
  run();
  return card;
}
