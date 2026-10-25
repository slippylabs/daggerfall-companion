// Entry point: load the data, wire the shared "I am in" header and the tabs.
import { data, loadCore, regionName, typeWord } from './data.js?v=13';
import { state, setHere, setOpts, onChange, registerTabs } from './state.js?v=13';
import { autocomplete } from './ui.js?v=13';
import { initMap } from './map.js?v=13';
import { initJournal } from './journal.js?v=13';
import { initQuests, setQuestTabs } from './quests.js?v=13';
import { initTowns, townsShown } from './towns.js?v=13';
import { initMyQuests, renderMine, loadSnapshot, hasQuests } from './myquests.js?v=13';

const $ = id => document.getElementById(id);
const TABS = ['journal', 'map', 'quests', 'towns', 'mine'];
const started = new Set();

function show(tab) {
  if (!TABS.includes(tab)) tab = 'journal';
  state.tab = tab;
  for (const t of TABS) {
    $(`tab-${t}`).hidden = t !== tab;
    const btn = document.querySelector(`.hud-tab[data-tab="${t}"]`);
    btn.classList.toggle('active', t === tab);
    btn.setAttribute('aria-selected', t === tab ? 'true' : 'false');
  }
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  if (!started.has(tab)) {
    started.add(tab);
    if (tab === 'map') initMap();
    if (tab === 'quests') initQuests();
  }
  if (tab === 'towns') townsShown();
  if (tab === 'mine') renderMine();
}

// The Sync bookmark (js/bookmarklet.js) opens this page at #sync from DFO Online and posts the quests; only
// DFO Online's own origin is listened to (a local test page may stand in for it on a local address)
const DFO_ORIGIN = 'https://daggerfalljs.dev';
function startSync() {
  const local = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
  const allowed = new Set([DFO_ORIGIN, ...(local ? [new URLSearchParams(location.search).get('dfo')].filter(Boolean) : [])]);
  const status = $('sync-status');
  const say = (text, cls = '') => { status.hidden = false; status.className = `tool-note dg-sync-status ${cls}`; status.textContent = text; };
  if (!window.opener) { say('Open DFO Online and click your ⚔ Sync quests bookmark there.'); return; }
  say('Waiting for DFO Online to send your quests…');
  let done = false;
  addEventListener('message', async e => {
    if (!allowed.has(e.origin) || e.data?.type !== 'dg-sync' || done) return;
    done = true;
    const p = e.data.payload || {};
    if (p.error || !p.snap?.quest) { say(p.error || 'DFO Online sent no quests.', 'dg-bad'); return; }
    try {
      const n = await loadSnapshot(p.snap, p.info || null, 'sync');
      say(`Synced ${n} quest${n === 1 ? '' : 's'} from DFO Online.`, 'dg-good');
      setTimeout(() => { status.hidden = true; }, 6000);
    } catch (err) { say(`Could not read the quests: ${err.message}`, 'dg-bad'); }
  });
  // say "ready" until the quests arrive (the bookmark may still be fetching the online save)
  const ping = () => { if (done) return; for (const o of allowed) { try { window.opener.postMessage('dg-ready', o); } catch { /* closed */ } } };
  ping();
  const timer = setInterval(() => { ping(); if (done) clearInterval(timer); }, 400);
  setTimeout(() => { clearInterval(timer); if (!done) say('DFO Online did not answer. Click the bookmark again on the DFO Online tab.', 'dg-bad'); }, 45000);
}

function renderHere() {
  const i = state.here;
  $('here-input').value = i >= 0 ? data.locs.name[i] : '';
  $('here-region').textContent = i >= 0 ? `${typeWord(i)} · ${regionName(data.locs.region[i])}` : '';
}

async function main() {
  try {
    await loadCore();
  } catch (e) {
    document.querySelector('.dg-tabs').after(Object.assign(document.createElement('p'), { className: 'tool-note', textContent: `Could not load the game data: ${e.message}` }));
    return;
  }
  const api = { show };
  registerTabs(api);
  setQuestTabs(api);
  initJournal();
  initTowns(api);
  initMyQuests(api);

  autocomplete($('here-input'), $('here-list'), { onPick: i => setHere(i) });
  for (const [id, key] of [['opt-transport', 'transport'], ['opt-pace', 'pace'], ['opt-sleep', 'sleep']]) {
    $(id).value = state.opts[key];
    $(id).addEventListener('change', e => setOpts({ [key]: e.target.value }));
  }
  $('opt-ship').checked = state.opts.ship;
  $('opt-ship').addEventListener('change', e => setOpts({ ship: e.target.checked }));
  onChange(what => { if (what === 'here') renderHere(); });
  renderHere();

  for (const btn of document.querySelectorAll('.hud-tab[data-tab]')) btn.addEventListener('click', () => show(btn.dataset.tab));
  addEventListener('hashchange', () => { if (location.hash !== '#sync') show(location.hash.slice(1)); });
  if (location.hash === '#sync') { show('mine'); startSync(); }
  // with quests saved, the page opens on them
  else show(location.hash.slice(1) || (hasQuests() ? 'mine' : 'journal'));
}

main();
