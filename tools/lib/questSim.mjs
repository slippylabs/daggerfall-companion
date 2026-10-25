// Compiles a quest with DFO Online's own QuestMachine (headless: no world) and plays it forward by hand, so
// tests get save data in the exact shape a real DFO save holds (Quest.getSaveData). start() runs the startup
// task as the game does: its actions complete, `pick one of` starts one of its tasks, started tasks run theirs.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dfo, DFO } from './env.mjs';

const { loadQuestTables } = await dfo('src/systems/quest/tables.js');
const { QuestMachine } = await dfo('src/systems/quest/machine.js');
const V = join(DFO, 'vendor/dfu-quests');
const sources = {};
for (const f of readdirSync(join(V, 'Tables'))) if (f.endsWith('.txt')) sources[f.replace('.txt', '')] = readFileSync(join(V, 'Tables', f), 'utf8').replace(/^﻿/, '');
loadQuestTables(sources);
const machine = new QuestMachine({ nowSeconds: () => 0 });
export const questFiles = () => readdirSync(join(V, 'Quests')).filter(f => f.endsWith('.txt')).map(f => f.replace('.txt', ''));

const sym = s => (s && typeof s === 'object' ? s.original : s) || null;

export function compile(file, uid = 1) {
  const warn = console.warn; console.warn = () => {};
  try {
    const q = machine.parseQuestForLists(readFileSync(join(V, 'Quests', file + '.txt'), 'utf8').split(/\r?\n/), 0, { rolls: () => 0, headless: true });
    if (!q) return null;
    const sd = q.getSaveData();
    sd.uid = uid;
    // headless parsing sets up no homes: a real save gives every non-fixed person one (`_name_home_`)
    for (const r of sd.resources) {
      const p = r.resourceSpecific;
      if (r.type === 'Person' && p && !p.isIndividualNPC && !p.homePlaceSymbol) p.homePlaceSymbol = { original: `${sym(r.symbol).replace(/_$/, '')}_home_` };
    }
    return sd;
  } finally { console.warn = warn; }
}

const task = (sd, s) => sd.tasks.find(t => sym(t.symbol) === s);
// Start a task: it triggers and its non-condition actions run (pick = which `pick one of` branch, by index)
export function run(sd, s, pick = 0, force = false) {
  const t = task(sd, s);
  if (!t || t.dropped || (t.triggered && !force)) return sd;
  t.triggered = true;
  for (const a of t.actions || []) {
    if (a.isTriggerCondition) continue;
    a.isComplete = true;
    const x = a.actionSpecific || {};
    if (a.type === 'PickOneOf' && x.taskSymbols?.length) run(sd, sym(x.taskSymbols[pick % x.taskSymbols.length]), pick);
    if (a.type === 'StartTask') for (const ts of x.taskSymbols || [x.taskSymbol]) run(sd, sym(ts), pick);
    // the player's quest items (sd._held), as the game's inventory would hold them
    sd._held ||= new Set();
    if (a.type === 'GetItem') { sd._held.add(sym(x.itemSymbol)); haveWatchers(sd, sym(x.itemSymbol), pick); }
    if (a.type === 'TakeItem' || a.type === 'DropAsQuestItem') sd._held.delete(sym(x.itemSymbol));
    if (a.type === 'HaveItem' && sd._held.has(sym(x.targetItem))) run(sd, sym(x.targetTask), pick);
    if (a.type === 'Prompt') run(sd, sym(x.yesTaskSymbol), pick);   // the player answers Yes
    // the journal, as Quest.addLogStep / removeLogStep keep it: one entry per step, a step logged again replaced in place
    sd.activeLogMessages ||= [];
    if (a.type === 'LogMessage') {
      const e = { stepID: x.stepID, messageID: x.messageID, time: (sd._logClock = (sd._logClock || 0) + 1) }, i = sd.activeLogMessages.findIndex(l => l.stepID === x.stepID);
      if (i >= 0) sd.activeLogMessages[i] = e; else sd.activeLogMessages.push(e);
    }
    // `clear` sets a task back (Task.clear: untriggered, its actions rearmed) so it can happen again; `unset` drops it
    if (a.type === 'ClearTask' || a.type === 'UnsetTask') for (const ts of x.taskSymbols || []) {
      const c = task(sd, sym(ts));
      if (!c) continue;
      c.triggered = false;
      for (const ca of c.actions || []) ca.isComplete = false;
      if (a.type === 'UnsetTask') c.dropped = true;
    }
    if (a.type === 'RemoveLogMessage') sd.activeLogMessages = sd.activeLogMessages.filter(l => l.stepID !== x.stepID);
  }
  return sd;
}
// `have _item_ set _task_` watches while its task runs: the item in hand starts the task
function haveWatchers(sd, item, pick = 0) {
  for (const t of sd.tasks) if (t.triggered) for (const a of t.actions || [])
    if (a.type === 'HaveItem' && sym(a.actionSpecific?.targetItem) === item) run(sd, sym(a.actionSpecific.targetTask), pick);
}
// the player's quest items, in the shape questNow takes from a real save's inventories
export const heldItems = sd => [...(sd._held || [])].map(s => ({ questUID: sd.uid, symbol: s }));
// the startup task is already marked triggered in a freshly compiled quest; its actions have not run yet
export const start = (sd, pick = 0) => run(sd, sym(sd.tasks.find(t => t.type === 'headless')?.symbol), pick, true);
export const setTriggered = (sd, s) => { const t = task(sd, s); if (t) t.triggered = true; return sd; };
export const kill = (sd, foe, n = 1) => { const r = sd.resources.find(x => sym(x.symbol) === foe); if (r) r.resourceSpecific.killCount = n; return sd; };

// ---- playing a quest by following the guide ----
// Do one objective as the player would: the tasks whose condition it meets trigger and run.
export function perform(sd, o) {
  const hit = a => {
    const x = a.actionSpecific || {};
    switch (o.kind) {
      case 'talk': case 'reward': return a.type === 'ClickedNpc' && sym(x.npcSymbol) === o.npc;
      case 'bring': return (a.type === 'TotingItemAndClickedNpc' && sym(x.npcSymbol) === o.npc && sym(x.itemSymbol) === o.item) || (a.type === 'ClickedNpc' && sym(x.npcSymbol) === o.npc);
      case 'kill': return (o.injure ? a.type === 'InjuredFoe' : (a.type === 'KilledFoe' || a.type === 'InjuredFoe')) && sym(x.foeSymbol) === o.foe;
      case 'pickup': return a.type === 'ClickedItem' && sym(x.itemSymbol) === o.item;
      case 'drop': return a.type === 'DroppedItemAtPlace' && sym(x.itemSymbol) === o.item;
      default: return false;
    }
  };
  if (o.kind === 'wait') run(sd, o.clock);   // the time runs out
  if (o.kind === 'kill' && !o.injure) kill(sd, o.foe, o.count || 1);
  sd._held ||= new Set();
  if (o.kind === 'pickup') { sd._held.add(o.item); haveWatchers(sd, o.item); }
  if (o.kind === 'drop') sd._held.delete(o.item);
  // time passes between errands: a `daily from` task is on only in its hours (an always-on trigger, so it switches off
  // again), and an errand not tied to the hours is done outside them
  if (!o.hours) for (const t of sd.tasks) if (t.triggered && (t.actions || []).some(a => a.type === 'DailyFrom' && a.isTriggerCondition)) t.triggered = false;
  // the player comes in the hours a `daily from` watcher keeps
  if (o.hours) for (const t of sd.tasks) if (!t.triggered && (t.actions || []).some(a => a.type === 'DailyFrom')
    && (t.actions || []).some(a => a.type === 'PcAt' && sym(a.actionSpecific?.placeSymbol) === o.place)) run(sd, sym(t.symbol));
  const watcher = { go: ['PcAt', 'placeSymbol', o.place], use: ['ItemUsedDo', 'itemSymbol', o.item], cast: ['CastSpellDo', 'spellID', o.spell] }[o.kind];
  if (watcher) for (const t of sd.tasks) for (const a of t.actions || [])
    if (a.type === watcher[0] && sym(a.actionSpecific?.[watcher[1]]) === watcher[2] && t.triggered) run(sd, sym(a.actionSpecific.taskSymbol));
  for (const t of sd.tasks) if (!t.triggered && (t.actions || []).some(a => a.isTriggerCondition && hit(a))) run(sd, sym(t.symbol));
  settle(sd);
  return sd;
}
// `when A and B or C` tasks whose expression now holds trigger and run, until nothing changes
export function settle(sd) {
  for (let changed = true, n = 0; changed && n < 50; n++) {
    changed = false;
    for (const t of sd.tasks) {
      if (t.triggered) continue;
      // each `when` line is a trigger of its own: any one that holds starts the task
      const holds = w => {
        let v = null;
        for (const e of w.actionSpecific?.evaluations || []) {
          const x = !!sd.tasks.find(k => sym(k.symbol) === e.task)?.triggered;
          const term = /Not$/.test(e.op) ? !x : x;
          v = v === null ? term : /^and/.test(e.op) ? v && term : /^or/.test(e.op) ? v || term : term;
        }
        return !!v;
      };
      if (!t.dropped && (t.actions || []).some(a => a.isTriggerCondition && a.type === 'WhenTask' && holds(a))) { run(sd, sym(t.symbol)); changed = true; }
    }
  }
  return sd;
}
