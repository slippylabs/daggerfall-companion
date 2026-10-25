// Small DOM helpers shared by the tabs: element builder, autocomplete box, location cards.
import { data, regionName, typeWord, dungeonWord, bearing, travelBetween, formatDuration, searchLocations } from './data.js?v=2';
import { state, setHere, showOnMap } from './state.js?v=2';

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
}

// replaceChildren that skips null/false children (replaceChildren would print them as text)
export function fill(node, ...kids) {
  node.replaceChildren(...kids.flat().filter(k => k != null && k !== false && k !== ''));
}

// Autocomplete over locations: input + listbox; onPick(index)
export function autocomplete(input, list, { onPick, filter = null, region = () => -1 }) {
  let items = [], active = -1;
  const close = () => { list.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); };
  const render = () => {
    fill(list, items.map((i, k) => el('li', {
      role: 'option', class: k === active ? 'active' : null, 'aria-selected': k === active ? 'true' : 'false',
      onmousedown: e => { e.preventDefault(); pick(i); },
    }, el('span', { class: 'dg-suggest-name', text: data.locs.name[i] }),
      el('span', { class: 'dg-suggest-meta', text: `${typeWord(i)} · ${regionName(data.locs.region[i])}` }))));
    list.hidden = items.length === 0;
    input.setAttribute('aria-expanded', items.length ? 'true' : 'false');
  };
  const pick = i => { close(); onPick(i); };
  input.addEventListener('input', () => {
    items = searchLocations(input.value, { region: region(), filter, limit: 10 });
    active = items.length ? 0 : -1;
    render();
  });
  input.addEventListener('keydown', e => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && active >= 0) { pick(items[active]); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 100));
}

// "3 days 4 h on foot, north-east, 85 km" from where the player is
export function travelLine(i) {
  if (state.here < 0) return el('span', { class: 'dg-dim', text: 'Set "I am in" above to see the trip from where you are.' });
  if (state.here === i) return el('span', { class: 'dg-good', text: 'You are here.' });
  const t = travelBetween(state.here, i, state.opts);
  const b = bearing(state.here, i);
  const how = { foot: 'on foot', horse: 'by horse', cart: 'with a cart' }[state.opts.transport] + (state.opts.ship ? ', by ship over water' : '');
  return el('span', {},
    el('b', { class: 'dg-num', text: formatDuration(t.minutes) }), ` ${how} · `,
    el('b', { text: b.dir }), ` · `, el('span', { class: 'dg-num', text: `${Math.round(b.km)} km` }),
    t.cost ? ` · ` : '', t.cost ? el('span', { class: 'dg-num', text: `${t.cost} gold` }) : '',
    t.oceanPixels && !state.opts.ship ? el('span', { class: 'dg-warn', text: ' · crosses water: tick "By ship"' }) : '');
}

export function locationCard(i, { note = null, alternatives = null } = {}) {
  const dw = dungeonWord(i);
  return el('div', { class: 'dg-card' },
    el('div', { class: 'dg-card-head' },
      el('span', { class: 'dg-card-name', text: data.locs.name[i] }),
      el('span', { class: 'dg-tag', text: typeWord(i) + (dw ? ` · ${dw}` : '') })),
    el('div', { class: 'dg-card-meta', text: `Region: ${regionName(data.locs.region[i])}` }),
    note ? el('div', { class: 'dg-card-note', text: note }) : null,
    el('div', { class: 'dg-card-trip' }, travelLine(i)),
    alternatives,
    el('div', { class: 'dg-card-actions' },
      el('button', { class: 'tool-btn', onclick: () => showOnMap(i) }, 'Show on map'),
      el('button', { class: 'tool-btn', onclick: () => setHere(i) }, 'I am here')));
}
