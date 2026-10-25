// Builds site/data/quests.json from the Daggerfall Unity quest scripts DFO Online ships
// (vendor/dfu-quests, MIT). Parses the QRC/QBN text directly: header facts, the guild that hands
// the quest out, journal entries with symbols replaced by plain roles, steps in plain English,
// the time limit and WHO PAYS THE REWARD (the NPC clicked in the task that runs "give pc").
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DFO, writeOut } from './lib/env.mjs';

const QDIR = join(DFO, 'vendor/dfu-quests');

// ---- Plain-English vocabularies (from Tables/Quests-Factions.txt and Quests-Places.txt) ----
const GROUPS = {
  Questor: 'the quest giver', Chemist: 'an alchemist', Armorer: 'an armorer', Banker: 'a banker',
  Bookseller: 'a bookseller', Tailor: 'a tailor', Carpenter: 'a furniture maker', Jeweler: 'a jeweler',
  Shopkeeper: 'a shopkeeper', Librarian: 'a librarian', Spellcaster: 'a spellcaster', Pawnbroker: 'a pawnbroker',
  Smith: 'a smith', Cleric: 'a priest', Innkeeper: 'an innkeeper', Noble: 'a noble',
  Resident1: 'a resident', Resident2: 'a resident', Resident3: 'a resident', Resident4: 'a resident',
  PermanentNPC: 'a well-known person',
};
const GROUP_PREFIX = { Local_3: 'a townsperson', Local_4: 'a townsperson', Group_5: 'a commoner', Group_6: 'a merchant', Group_7: 'a noble' };
const PLACES = {
  apothecary: 'an alchemist', armory: 'an armorer', bank: 'a bank', bookstore: 'a bookstore',
  clothingshop: 'a clothing shop', furnitureshop: 'a furniture shop', jewelryshop: 'a jeweler',
  generalstore: 'a general store', library: 'a library', guildhall: 'a guild hall', magery: 'the Mages Guild',
  fighters: 'the Fighters Guild', pawnshop: 'a pawn shop', weaponstore: 'a weapon smith', temple: 'a temple',
  tavern: 'a tavern', palace: 'the palace', shop: 'a shop', house: 'a house', random: 'a building',
  dungeon: 'a dungeon', dungeon0: 'a crypt', dungeon1: 'an orc stronghold', dungeon2: 'a human stronghold',
  dungeon3: 'a prison', dungeon4: 'a desecrated temple', dungeon5: 'a mine', dungeon6: 'a natural cave',
  dungeon7: 'a coven', dungeon8: 'a vampire haunt', dungeon9: 'a laboratory', dungeon10: 'a harpy nest',
  dungeon11: 'a ruined castle', dungeon12: 'a spider nest', dungeon13: 'a giant stronghold',
  dungeon14: 'a dragon\'s den', dungeon15: 'a barbarian stronghold', dungeon16: 'a volcanic cave',
  dungeon17: 'a scorpion nest', dungeon18: 'a cemetery', town: 'a town',
};
const ITEMS = {
  misc: 'an item', mens_clothing: "a piece of men's clothing", womens_clothing: "a piece of women's clothing",
  large_plant: 'a large plant', magic_item: 'a magic item', trinket: 'a trinket', weapon: 'a weapon',
  armor: 'a piece of armor', book: 'a book', letter: 'a letter', parchment: 'a letter', portrait: 'a painting',
  painting: 'a painting', potion: 'a potion', gem: 'a gem', artifact: 'an artifact', ingredient: 'an ingredient',
  religious: 'a holy relic', jewelry: 'a piece of jewelry', soul_trap: 'a soul gem',
};
const SCOPES = { local: 'in this town', remote: 'elsewhere in this region' };

const words = s => s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
const article = s => (/^[aeiou]/i.test(s) ? 'an ' : 'a ') + s;

function describePerson(line, sym) {
  if (/\bgroup Questor\b/.test(line)) return { role: 'the quest giver', questor: true };
  let role = null;
  let m;
  if ((m = line.match(/\bnamed (\S+)/))) role = words(m[1]);
  else if ((m = line.match(/\bgroup (\S+)/))) {
    const g = m[1];
    role = GROUPS[g] || GROUP_PREFIX[g.replace(/\..*$/, '')] || article(words(g).toLowerCase());
  } else if ((m = line.match(/\bfactiontype (\S+)/))) role = `someone from ${article(words(m[1]).toLowerCase())}`;
  else if ((m = line.match(/\bfaction (\S+)/))) role = `a member of ${words(m[1])}`;
  else role = words(sym);
  if (/\bfemale\b/.test(line)) role += ' (female)';
  else if (/\bmale\b/.test(line)) role += ' (male)';
  if (/\blocal\b/.test(line)) role += ', in this town';
  else if (/\bremote\b/.test(line)) role += ', elsewhere in the region';
  return { role, questor: false };
}

function describePlace(line) {
  const m = line.match(/^Place\s+\S+\s+(local|remote|permanent)\s+(\S+)/);
  if (!m) return { role: 'a place', scope: '' };
  if (m[1] === 'permanent') return { role: words(m[2]), scope: 'permanent' };
  return { role: PLACES[m[2]] || article(words(m[2]).toLowerCase()), scope: m[1], where: SCOPES[m[1]] };
}

function describeItem(line) {
  const m = line.match(/^Item\s+\S+\s+(.*)$/);
  if (!m) return { role: 'an item' };
  const rest = m[1];
  if (/^gold\b/.test(rest)) {
    const r = rest.match(/range (\d+) to (\d+)/);
    return { role: r ? `${r[1]}-${r[2]} gold` : 'gold', gold: true };
  }
  const name = rest.replace(/\b(range|anyInfo|rumors|used)\b.*$/, '').trim().replace(/\d+$/, '').split(/\s+/)[0];
  return { role: ITEMS[name] || article(words(name).toLowerCase()) };
}

function describeFoe(line) {
  const m = line.match(/^Foe\s+\S+\s+is\s+(?:(\d+)\s+)?(\S+)/);
  if (!m) return { role: 'an enemy' };
  const name = words(m[2]).replace(/Grizzley/i, 'grizzly').toLowerCase();
  return { role: m[1] && m[1] !== '1' ? `${m[1]} ${name}s` : article(name), count: m[1] ? +m[1] : 1 };
}

// "1.00:00" = 1 day; "00:00 0 flag 17 range 0 2" = travel time plus 0-2 days
function describeClock(line) {
  const m = line.match(/^Clock\s+\S+\s+(?:(\d+)\.)?(\d+):(\d+)(?:\s+(\d+))?(.*)$/);
  if (!m) return { role: 'a timer' };
  const days = +(m[1] || 0), hours = +m[2], mins = +m[3];
  const range = m[5].match(/range (\d+) (\d+)/);
  if (days === 0 && hours === 0 && mins === 0)
    return { role: range ? `travel time plus ${range[1]}-${range[2]} days` : 'enough time to travel there', travel: true };
  const parts = [];
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (mins && !days) parts.push(`${mins} min`);
  return { role: parts.join(' ') || 'a moment' };
}

// ---- Quest list membership (guild, membership requirement) ----
const membership = {};
for (const file of ['QuestList-Classic.txt', 'QuestList-DFU.txt']) {
  for (const raw of readFileSync(join(QDIR, 'Tables', file), 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('-') || line.startsWith('schema')) continue;
    const [name, group, member, minReq] = line.split(',').map(s => s && s.trim());
    if (name) membership[name.toUpperCase()] = { group, member, minReq: minReq ? +minReq : 0 };
  }
}

// ---- Parse one quest file ----
function parseQuest(text, file) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const header = {};
  for (const l of lines.slice(0, 15)) {
    let m;
    if ((m = l.match(/^--\s*(StartsBy|Questee|Questor|Repute):\s*(.*)$/))) header[m[1].toLowerCase()] = m[2].trim();
    if ((m = l.match(/^DisplayName:\s*(.*)$/))) header.displayName = m[1].trim();
    if ((m = l.match(/^Quest:\s*(\S+)/))) header.quest = m[1];
  }
  const qrcAt = lines.findIndex(l => /^QRC:/.test(l));
  const qbnAt = lines.findIndex(l => /^QBN:/.test(l));

  // Messages: "QuestLogEntry:  [1010]" or "Message:  1011"
  const messages = {};
  let cur = null;
  for (const l of lines.slice(qrcAt + 1, qbnAt)) {
    const m = l.match(/^(\w+):\s*\[?(\d+)\]?\s*$/);
    if (m) { cur = { kind: m[1], id: +m[2], lines: [] }; messages[cur.id] = cur; continue; }
    if (cur && l.trim() !== '<--->') cur.lines.push(l.replace(/<ce>/g, '').trim());
  }
  const msgText = id => {
    const m = messages[id];
    if (!m) return null;
    // the first variant only (variants are split by <--->)
    return m.lines.join(' ').replace(/\s+/g, ' ').trim();
  };

  // QBN: resources and tasks
  const resources = {};
  const tasks = [];
  let task = { name: '(start)', lines: [] };
  tasks.push(task);
  for (const raw of lines.slice(qbnAt + 1)) {
    const l = raw.trim();
    if (!l || l.startsWith('--')) continue;
    let m;
    if ((m = l.match(/^(Item|Person|Place|Clock|Foe)\s+(_\S+_)\b/))) { resources[m[2]] = { kind: m[1], line: l }; continue; }
    if ((m = l.match(/^(_\S+_)\s+task:/))) { task = { name: m[1], lines: [] }; tasks.push(task); continue; }
    if ((m = l.match(/^variable\s+(_\S+_)/))) { task = { name: m[1], lines: [], variable: true }; tasks.push(task); continue; }
    task.lines.push(l);
  }

  const res = {};
  for (const [sym, r] of Object.entries(resources)) {
    const d = r.kind === 'Person' ? describePerson(r.line, sym) : r.kind === 'Place' ? describePlace(r.line)
      : r.kind === 'Item' ? describeItem(r.line) : r.kind === 'Foe' ? describeFoe(r.line) : describeClock(r.line);
    res[sym] = { kind: r.kind, ...d };
  }
  const role = sym => (res[sym] ? res[sym].role : words(sym));

  // Journal text with the script's placeholders turned into {braced} phrases the page highlights:
  // _x_ a thing or person, __x_ / ___x_ where it is, =x_ a timer's days, %qdt the date, %g pronouns
  const readable = text => {
    if (!text) return text;
    return text
      .replace(/%qdt:?\s*/g, '')
      .replace(/(^|[^_\w])___(\w+?_)(?!\w)/g, (_, a, sym) => `${a}{${where('_' + sym)}}`)
      .replace(/(^|[^_\w])__(\w+?_)(?!\w)/g, (_, a, sym) => `${a}{${where('_' + sym)}}`)
      .replace(/(^|[^_\w])(_\w+?_)(?!\w)/g, (_, a, sym) => `${a}{${res[sym] ? res[sym].role : words(sym)}}`)
      .replace(/=(\w+?_)(?!\w)/g, (_, sym) => `{${res['_' + sym] ? res['_' + sym].role : 'a few'}}`)
      .replace(/%g3\b/g, 'their').replace(/%g2\b/g, 'them').replace(/%g1?\b/g, 'they')
      .replace(/%\w+/g, '…')
      .replace(/\s*-moved line.*$/, '');
  };
  const where = sym => {
    const r = res[sym];
    if (!r) return 'somewhere';
    if (r.kind === 'Place') return r.role + (r.where ? ' ' + r.where : '');
    if (r.questor) return "the quest giver's town";
    return `where ${r.role.replace(/,.*$/, '')} lives`;
  };

  // ---- Reward giver: the NPC clicked in (or waited on by) the task that runs "give pc" ----
  const byName = Object.fromEntries(tasks.map(t => [t.name, t]));
  const clicks = t => {
    const out = [];
    for (const l of t.lines) {
      let m;
      if ((m = l.match(/clicked npc (_\S+_)/))) out.push(m[1]);
      else if ((m = l.match(/toting \S+ and (_\S+_) clicked/))) out.push(m[1]);
    }
    return out;
  };
  const givers = new Set();
  for (const t of tasks) {
    // "give pc nothing" still ends the quest at that NPC: who to see to finish, with no item
    if (!t.lines.some(l => /^give pc /.test(l))) continue;
    const seen = new Set();
    const visit = (tk, depth) => {
      if (!tk || seen.has(tk.name) || depth > 5) return;
      seen.add(tk.name);
      for (const s of clicks(tk)) givers.add(s);
      for (const l of tk.lines) {
        for (const m of l.matchAll(/\b(?:when|and|or)\s+(?!not\b)(_\S+_)/g)) visit(byName[m[1]], depth + 1);
      }
    };
    visit(t, 0);
  }
  let rewardFrom = [...givers].filter(s => res[s] && res[s].kind === 'Person');
  if (rewardFrom.some(s => res[s].questor)) rewardFrom = rewardFrom.filter(s => res[s].questor);

  // ---- Steps in plain English: where things are, what to do, then the reward ----
  // Each step is a template with one variable part; random alternatives ("pick one of") merge
  const order = { at: 0, map: 1, given: 2, do: 3, reward: 4 };
  const stepMap = new Map();
  const add = (cat, pre, obj, post = '') => {
    const key = cat + '|' + pre + '|' + post;
    if (!stepMap.has(key)) stepMap.set(key, { cat, pre, post, objs: [] });
    const st = stepMap.get(key);
    if (!st.objs.includes(obj)) st.objs.push(obj);
  };
  let timeLimit = null;
  for (const t of tasks) {
    for (const l of t.lines) {
      let m;
      if ((m = l.match(/^start timer (_\S+_)/)) && res[m[1]]) timeLimit = timeLimit || res[m[1]].role;
      else if ((m = l.match(/^place npc (_\S+_) at (_\S+_)/))) add('at', '', role(m[1]), ` is at ${role(m[2])}`);
      else if ((m = l.match(/^place item (_\S+_) at (_\S+_)/))) add('at', '', role(m[1]), ` is hidden at ${role(m[2])}`);
      else if ((m = l.match(/^place foe (_\S+_) at (_\S+_)/))) add('at', '', role(m[1]), ` waits at ${role(m[2])}`);
      else if ((m = l.match(/^reveal (_\S+_)/))) add('map', '', role(m[1]), ' is marked on your map');
      else if ((m = l.match(/^get item (_\S+_)/))) add('given', 'You are given ', role(m[1]));
      else if ((m = l.match(/^killed (\d+ )?(_\S+_)/))) add('do', 'Kill ', role(m[2]));
      else if ((m = l.match(/^clicked item (_\S+_)/))) add('do', 'Pick up ', role(m[1]));
      else if ((m = l.match(/^toting (_\S+_) and (_\S+_) clicked/))) add('do', 'Bring ', role(m[1]), ` to ${role(m[2])}`);
      else if ((m = l.match(/^clicked npc (_\S+_)/)) && !res[m[1]]?.questor) add('do', 'Talk to ', role(m[1]));
      else if ((m = l.match(/^pc at (_\S+_)/))) add('do', 'Go to ', role(m[1]));
      else if ((m = l.match(/^give pc (_\S+_)/)) && res[m[1]]) add('reward', 'Reward: ', role(m[1]));
    }
  }
  const list = objs => objs.length === 1 ? objs[0] : objs.slice(0, -1).join(', ') + ' or ' + objs[objs.length - 1];
  const steps = [...stepMap.values()].sort((a, b) => order[a.cat] - order[b.cat]).map(st => {
    // placements and gifts come from "pick one of"; several kill/talk targets may all be needed
    const obj = st.objs.length < 2 ? st.objs[0] : (st.cat === 'at' || st.cat === 'given') ? `one of: ${list(st.objs)}` : st.objs.join(' / ');
    const text = st.pre ? st.pre + obj + st.post : cap(obj) + st.post;
    return text + '.';
  });

  // Journal entries: QuestLogEntry plus every message the script logs
  const logIds = new Set();
  for (const t of tasks) for (const l of t.lines) { const m = l.match(/^log (\d+)/); if (m) logIds.add(+m[1]); }
  for (const [id, m] of Object.entries(messages)) if (m.kind === 'QuestLogEntry') logIds.add(+id);
  const journal = [...logIds].sort((a, b) => a - b).map(id => readable(msgText(id))).filter(Boolean);

  const name = header.quest || file.replace(/\.txt$/i, '');
  return {
    file: name,
    title: header.displayName || null,
    startsBy: header.startsby || null,
    questor: header.questor || null,
    questee: header.questee || null,
    list: membership[name.toUpperCase()] || null,
    timeLimit,
    offer: readable(msgText(1000)),
    complete: readable(msgText(1004)),
    journal,
    steps,
    reward: {
      automatic: rewardFrom.length === 0,
      from: rewardFrom.map(s => ({ sym: s, role: res[s].role, questor: !!res[s].questor })),
      items: tasks.flatMap(t => t.lines).map(l => l.match(/^give pc (_\S+_)/)).filter(Boolean).map(m => role(m[1]))
        .filter((v, i, a) => a.indexOf(v) === i),
    },
    resources: res,
  };
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

const files = readdirSync(join(QDIR, 'Quests')).filter(f => f.toLowerCase().endsWith('.txt')).sort();
const quests = [];
const failed = [];
for (const f of files) {
  try {
    quests.push(parseQuest(readFileSync(join(QDIR, 'Quests', f), 'utf8'), f));
  } catch (e) {
    failed.push(`${f}: ${e.message}`);
  }
}
writeOut('data/quests.json', JSON.stringify(quests));
const paid = quests.filter(q => q.reward.from.length);
const other = paid.filter(q => !q.reward.from.some(r => r.questor));
console.log(`${quests.length} quests (${quests.filter(q => q.title).length} with a journal title), ${failed.length} failed; ` +
  `reward giver found for ${paid.length}, ${other.length} pay from someone other than the quest giver`);
for (const f of failed) console.log('  FAILED', f);
