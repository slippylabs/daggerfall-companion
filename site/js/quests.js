// Quests tab: every quest script as a walkthrough - what it asks, the time limit, and who pays.
import { loadQuests, normalise } from './data.js?v=1';
import { el, fill } from './ui.js?v=1';

const $ = id => document.getElementById(id);
let quests = null, selected = null;

const GUILDS = {
  FightersGuild: 'Fighters Guild', MagesGuild: 'Mages Guild', ThievesGuild: 'Thieves Guild', DarkBrotherHood: 'Dark Brotherhood',
  Merchants: 'Merchants', Commoners: 'Commoners', Nobility: 'Nobles', Temple: 'Temples', KnightlyOrder: 'Knightly orders',
  Witches: 'Witch covens', Vampires: 'Vampire clans', GeneralPopulace: 'Townsfolk', Necromancers: 'Necromancers', Akatosh: 'Temple of Akatosh',
  Arkay: 'Temple of Arkay', Dibella: 'Temple of Dibella', Julianos: 'Temple of Julianos', Kynareth: 'Temple of Kynareth',
  Mara: 'Temple of Mara', Stendarr: 'Temple of Stendarr', Zenithar: 'Temple of Zenithar', HolyOrder: 'Holy orders',
};
const guildName = g => GUILDS[g] || (g ? g.replace(/([a-z])([A-Z])/g, '$1 $2') : 'Other');
// QuestList membership codes (QuestList-Classic.txt header)
const MEMBER = {
  M: 'members only', N: 'non-members', P: 'prospects',
  T: 'Akatosh', A: 'Arkay', D: 'Dibella', J: 'Julianos', K: 'Kynareth', R: 'Mara', S: 'Stendarr', Z: 'Zenithar',
};
const SOCIAL = new Set(['Commoners', 'Merchants', 'Nobility', 'GeneralPopulace', 'Scholars', 'Underworld', 'Supernatural']);
function memberWord(l) {
  if (SOCIAL.has(l.group)) return { N: 'anyone', M: 'male characters', F: 'female characters' }[l.member] || l.member;
  if (l.group === 'HolyOrder' && 'TADJKRSZ'.includes(l.member)) return `Temple of ${MEMBER[l.member]}`;
  return MEMBER[l.member] || l.member;
}

export async function initQuests() {
  quests = (await loadQuests()).filter(q => !/^_|^S000/.test(q.file) || q.title);
  quests.sort((a, b) => (a.title || '~' + a.file).localeCompare(b.title || '~' + b.file));
  const groups = [...new Set(quests.map(q => q.list?.group).filter(Boolean))].sort((a, b) => guildName(a).localeCompare(guildName(b)));
  fill($('quest-guild'), el('option', { value: '' }, 'Anyone who gives quests'),
    ...groups.map(g => el('option', { value: g }, guildName(g))), el('option', { value: '~' }, 'Main story & others'));
  $('quest-search').addEventListener('input', renderList);
  $('quest-guild').addEventListener('change', renderList);
  renderList();
}

function renderList() {
  const q = normalise($('quest-search').value);
  const g = $('quest-guild').value;
  const list = quests.filter(x =>
    (!g || (g === '~' ? !x.list : x.list?.group === g)) &&
    (!q || normalise(x.title || '').includes(q) || normalise(x.file).includes(q)));
  fill($('quest-list'), ...list.slice(0, 300).map(x => el('li', {},
    el('button', { class: 'dg-list-item' + (x === selected ? ' dg-on' : ''), onclick: () => show(x) },
      el('span', { class: 'dg-list-title', text: x.title || `(no journal title) ${x.file}` }),
      el('span', { class: 'dg-list-meta', text: x.list ? guildName(x.list.group) : 'Story / other' })))),
  ...(list.length ? [] : [el('li', { class: 'tool-note', text: 'No quest matches.' })]));
  if (list.length === 1 && list[0] !== selected) show(list[0]);
}

// Journal text marks the parts the game fills in per quest as {braces}: show them as chips
function journalText(text) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(/\{([^}]*)\}/g)) {
    parts.push(text.slice(last, m.index), el('span', { class: 'dg-chip', text: m[1] }));
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return el('p', { class: 'dg-journal' }, ...parts);
}

function show(x) {
  selected = x;
  renderList();
  const r = x.reward;
  const who = r.automatic
    ? 'Nobody to visit: it is given the moment the job is done.'
    : r.from.map(f => f.questor ? 'the quest giver (go back to whoever gave you the quest)' : f.role).join(', or ');
  fill($('quest-detail'), 
    el('h2', { class: 'dg-quest-title', text: x.title || x.file }),
    el('div', { class: 'dg-quest-facts' },
      x.list ? el('span', { class: 'dg-tag', text: `${guildName(x.list.group)} · ${memberWord(x.list)}` }) : null,
      x.list?.minReq ? el('span', { class: 'dg-tag', text: x.list.minReq < 10 ? `rank ${x.list.minReq}+` : `reputation ${x.list.minReq}+` }) : null,
      x.timeLimit ? el('span', { class: 'dg-tag dg-tag-warn', text: `Time limit: ${x.timeLimit}` }) : null,
      el('span', { class: 'dg-tag dg-dim', text: x.file })),

    el('div', { class: 'dg-reward' + (r.from.some(f => !f.questor) ? ' dg-reward-other' : '') },
      el('div', { class: 'dg-reward-label', text: r.automatic ? 'Reward' : 'Claim reward from' }),
      el('div', { class: 'dg-reward-who', text: who }),
      r.items.length ? el('div', { class: 'dg-reward-items', text: `You get: ${r.items.join(', ')}` }) : null,
      r.from.some(f => !f.questor) ? el('div', { class: 'dg-card-note', text: 'Not the person who gave you the quest — find this one.' }) : null),

    x.steps.length ? el('h3', { text: 'What to do' }) : null,
    x.steps.length ? el('ol', { class: 'dg-steps' }, x.steps.map(s => el('li', { text: s }))) : null,

    x.journal.length ? el('h3', { text: 'Your journal will say' }) : null,
    ...x.journal.map(journalText),
    x.journal.length ? el('p', { class: 'tool-note', text: 'Highlighted parts are filled in by the game for your quest: paste the real entry into the Journal tab to find those places.' }) : null,

    x.offer ? el('details', {}, el('summary', { text: 'What the quest giver says' }), journalText(x.offer)) : null,
    x.complete ? el('details', {}, el('summary', { text: 'When you finish' }), journalText(x.complete)) : null);
  if (matchMedia('(max-width: 760px)').matches) $('quest-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
