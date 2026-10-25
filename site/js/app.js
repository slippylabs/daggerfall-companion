// Entry point: load the data, wire the shared "I am in" header and the tabs.
import { data, loadCore, regionName, typeWord } from './data.js?v=8';
import { state, setHere, setOpts, onChange, registerTabs } from './state.js?v=8';
import { autocomplete } from './ui.js?v=8';
import { initMap } from './map.js?v=8';
import { initJournal } from './journal.js?v=8';
import { initQuests, setQuestTabs } from './quests.js?v=8';
import { initTowns, townsShown } from './towns.js?v=8';
import { initMyQuests, renderMine } from './myquests.js?v=8';

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
  addEventListener('hashchange', () => show(location.hash.slice(1)));
  show(location.hash.slice(1) || 'journal');
}

main();
