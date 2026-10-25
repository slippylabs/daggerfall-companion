// Shared state: where the player is, travel options, the active tab. Persisted per browser.
const KEY = 'dg-guide';
const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();

export const state = {
  here: saved.here ?? -1,
  opts: { transport: 'foot', pace: 'cautious', sleep: 'camp', ship: false, ...saved.opts },
  tab: 'journal',
};

const listeners = new Set();
export const onChange = fn => listeners.add(fn);
const emit = what => { save(); for (const fn of listeners) fn(what); };

function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ here: state.here, opts: state.opts })); } catch { /* private mode */ }
}

export function setHere(i) { state.here = i; emit('here'); }
export function setOpts(o) { Object.assign(state.opts, o); emit('opts'); }

// Tabs register handlers; showOnMap switches to the map tab and selects a location
let mapApi = null, tabApi = null;
export const registerMap = api => { mapApi = api; };
export const registerTabs = api => { tabApi = api; };
export function showOnMap(i, pins = null, route = null) {
  tabApi?.show('map');
  mapApi?.select(i, pins, route);
}
