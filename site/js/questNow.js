// What to do NOW in a quest, read from the quest's own compiled script in a DFO save (DFU's Task/Action
// save data: task.js getSaveData, actions.js saveShape). The quest's goal is the task that pays (`give pc`),
// or, when the reward came up front, the task that ends it in success. The goal waits on other tasks through
// `when / and / or`, and those on player actions: click an NPC, bring an item to an NPC, kill a foe, click an
// item, stand at a place (`pc at ... set _task_`). A target that is not in the world yet is first put there by
// another task, whose own conditions come first. Following that chain back gives the open objectives in
// order; the first is NOW, the next THEN.
//
// questNow(sq, items) -> { objectives: [{kind, npc, item, foe, place, payer, later, alternatives}], complete }
//   kind: 'go' | 'pickup' | 'drop' | 'use' | 'cast' | 'kill' | 'talk' | 'bring' | 'wait' | 'reward';
//   hours: [from, to] seconds of the game day when a 'go' counts (the script watches only then);
//   clock: for 'wait', the timer whose running out goes on with the quest;
//   npc/item/foe/place are resource symbols, spell a SPELLS.STD index; injure: wound it, do not kill it;
//   answer: 'yes' when the target asks a question;
//   later: its target is not in the world yet (an earlier objective puts it there).
//   fromJournal: the place is the one the journal's latest entry names (the script gives none);
//   journal: that place (journalPlace), for a guide to show beside NOW;
//   avoid: player actions that would spoil the quest ([{kind, item|foe|npc}]: don't pick up the wand).
//   items: the player's quest items, [{questUID, symbol}] (from the save's inventories)

import { parseTemplate } from './questText.js?v=22';

const sym = s => (s && typeof s === 'object' ? s.original : s) || null;

// The journal's latest entry (Quest.activeLogMessages, by the time written) and the last Place resource it names:
// DFU's GetLastPlaceMentionedInMessage, where the game's own journal, town map ring and compass send the player
export function journalPlace(sq) {
  const e = [...(sq.activeLogMessages || [])].sort((a, b) => (b.time ?? 0) - (a.time ?? 0))[0];
  const m = e && (sq.messages || []).find(x => x.id === e.messageID);
  if (!m) return null;
  const kind = new Map((sq.resources || []).map(r => [sym(r.symbol), r.type]));
  const lines = m.lines || [], cut = lines.findIndex(l => l.trim() === '<--->');
  const parts = parseTemplate((cut < 0 ? lines : lines.slice(0, cut)).join(' '), s => (kind.has(s) ? { sym: s, kind: kind.get(s) } : null));
  return [...parts].reverse().find(p => p?.s && kind.get(p.s) === 'Place')?.s ?? null;
}
const PLAYER = new Set(['ClickedNpc', 'TotingItemAndClickedNpc', 'KilledFoe', 'InjuredFoe', 'ClickedItem', 'DroppedItemAtPlace']);

export function questNow(sq, items = []) {
  if (sq.questComplete) return { objectives: [], complete: true };
  const tasks = new Map((sq.tasks || []).map(t => [sym(t.symbol), t]));
  const res = new Map((sq.resources || []).map(r => [sym(r.symbol), r]));
  const all = [...tasks.values()].flatMap(t => (t.actions || []).map(a => ({ task: t, a })));
  const spec = a => a.actionSpecific || {};
  // a task the script dropped (`unset`) has done its part: DFO re-arms a dropped or cleared task's actions, so its
  // reveal or placement no longer shows as complete
  const ran = ({ task, a }) => a.isComplete || task.triggered || task.dropped;
  const conds = t => (t.actions || []).filter(a => a.isTriggerCondition);

  // what the quest has put into the world so far, and where
  const placing = (types, field, s) => all.filter(x => types.includes(x.a.type) && sym(spec(x.a)[field]) === s);
  const placedAt = (types, field, s) => { const p = placing(types, field, s).find(ran); return p ? sym(spec(p.a).placeSymbol) : null; };
  const foePlace = s => placedAt(['PlaceFoe'], 'foeSymbol', s);
  const npcPlace = s => placedAt(['PlaceNpc'], 'npcSymbol', s);
  const itemPlace = s => placedAt(['PlaceItem'], 'itemSymbol', s);
  const gotItem = s => items.some(i => i.questUID === sq.uid && (i.symbol === s || `_${i.symbol}_` === s))
    || (placing(['GetItem', 'GiveItem'], 'itemSymbol', s).some(ran)
      && !placing(['TakeItem', 'DropAsQuestItem'], 'itemSymbol', s).some(ran));
  const live = o => {
    if (o.kind === 'kill') {
      // (a Foe's spawnCount is how many the script asks for, not how many stand in the world)
      return !!(foePlace(o.foe) || placing(['CreateFoe'], 'foeSymbol', o.foe).some(ran));
    }
    if (o.kind === 'pickup') return !!itemPlace(o.item);
    if (o.kind === 'drop') return gotItem(o.item);
    if (o.kind === 'bring' && !gotItem(o.item)) return false;
    if (o.npc) {
      const r = res.get(o.npc), p = r?.resourceSpecific || {};
      if (!r || r.isHidden || p.isDestroyed) return false;
      return !!(p.isQuestor || p.isIndividualNPC || p.homePlaceSymbol || p.lastAssignedPlaceSymbol || npcPlace(o.npc)
        || placing(['CreateNpc'], 'npcSymbol', o.npc).some(ran));
    }
    return true;
  };
  // the not-yet-run task that would put an objective's target into the world
  const placer = o => {
    const list = o.kind === 'kill' ? placing(['PlaceFoe', 'CreateFoe'], 'foeSymbol', o.foe)
      : o.kind === 'pickup' ? placing(['PlaceItem'], 'itemSymbol', o.item)
        : (o.kind === 'bring' || o.kind === 'drop') && !gotItem(o.item) ? placing(['GetItem', 'GiveItem', 'PlaceItem'], 'itemSymbol', o.item)
          : o.npc ? placing(['PlaceNpc', 'CreateNpc'], 'npcSymbol', o.npc) : [];
    return list.find(x => !ran(x))?.task || null;
  };
  const objective = a => {
    const x = spec(a);
    switch (a.type) {
      case 'ClickedNpc': return { kind: 'talk', npc: sym(x.npcSymbol) };
      case 'TotingItemAndClickedNpc': return { kind: 'bring', item: sym(x.itemSymbol), npc: sym(x.npcSymbol) };
      case 'KilledFoe': {
        const f = sym(x.foeSymbol);
        if ((res.get(f)?.resourceSpecific?.killCount || 0) >= (x.killsRequired || 1)) return null;
        return { kind: 'kill', foe: f, count: x.killsRequired || 1 };
      }
      case 'InjuredFoe': return { kind: 'kill', foe: sym(x.foeSymbol), count: 1, injure: true };
      case 'ClickedItem': return { kind: 'pickup', item: sym(x.itemSymbol) };
      case 'DroppedItemAtPlace': return { kind: 'drop', item: sym(x.itemSymbol), place: sym(x.placeSymbol) };
      default: return null;
    }
  };
  const unrevealed = pl => {
    const reveals = all.filter(x => x.a.type === 'RevealLocation' && sym(spec(x.a).placeSymbol) === pl);
    return reveals.length && !reveals.some(ran) ? reveals[0].task : null;
  };
  const where = o => o.place || (o.foe && foePlace(o.foe)) || (o.item && o.kind === 'pickup' && itemPlace(o.item)) || (o.npc && npcPlace(o.npc)) || null;

  // A task no one can start any more: a `variable` only a `pick one of` that already chose another sets, or a task
  // whose every `when` line needs such a one (The Possessed Child's _real_ once the pick fell on _sham_)
  const deadMemo = new Map(), forbid = new Set();
  function deadTask(s, depth = 0) {
    if (deadMemo.has(s)) return deadMemo.get(s);
    const t = tasks.get(s);
    let dead = false;
    if (t && !t.triggered && depth < 10) {
      deadMemo.set(s, false);   // a loop through itself is not proof
      const whens = conds(t).filter(a => a.type === 'WhenTask');
      if (!conds(t).length) {
        const setters = all.filter(({ task, a }) => task !== t && !/^(Clear|Unset)Task$/.test(a.type)
          && Object.values(spec(a)).flatMap(v => (Array.isArray(v) ? v : [v])).map(sym).includes(s));
        dead = setters.length > 0 && setters.every(x => x.a.type === 'PickOneOf' && ran(x));
      } else if (whens.length && whens.length === conds(t).length) dead = whens.every(a => lineDead(a, depth + 1));
    }
    deadMemo.set(s, dead);
    return dead;
  }
  // a `when` line that can no longer hold: one of its `and` terms is dead
  const lineDead = (a, depth = 0) => (spec(a).evaluations || []).some(e => !/Not$/.test(e.op) && !/^or/.test(e.op) && deadTask(e.task, depth));
  // the open objectives one `when` line waits on, added to out
  function whenNeed(a, depth, out) {
    for (const e of spec(a).evaluations || []) {
      if (/Not$/.test(e.op)) continue;
      const sub = need(e.task, depth + 1);
      if (/^or/.test(e.op) && out.length && sub.length) out[out.length - 1] = [...out[out.length - 1], ...sub.flat()];
      else out.push(...sub);
    }
  }

  // A task's open objectives, in the order to do them: a list of groups (each needed); a group lists
  // alternatives (any one will do)
  const seen = new Set();
  function need(s, depth = 0) {
    if (!s || seen.has(s) || depth > 14) return [];
    const t = tasks.get(s);
    if (!t || t.triggered || t.dropped) return [];
    seen.add(s);
    const out = [];
    const cs = conds(t);
    if (cs.length) {
      const alts = [];
      // a guard that undoes this task too early (`when _click_ and not _done_` ... `clear _click_`: talking to the quest
      // giver before the job counts for nothing): what it waits on comes first
      for (const g of tasks.values()) {
        if (g === t || g.dropped) continue;
        const clears = (g.actions || []).some(a => a.type === 'ClearTask' && (spec(a).taskSymbols || []).map(sym).includes(s));
        if (!clears) continue;
        for (const w of conds(g).filter(a => a.type === 'WhenTask')) {
          const ev = spec(w).evaluations || [];
          if (!ev.some(e => e.task === s && !/Not$/.test(e.op))) continue;
          const ys = ev.filter(e => /Not$/.test(e.op) && !tasks.get(e.task)?.triggered && !deadTask(e.task) && !forbid.has(e.task)).map(e => e.task);
          if (!ys.length || ys.some(y => tasks.get(y)?.triggered)) continue;
          let best = null;
          for (const y of ys) {
            const before = new Set(seen), sub = need(y, depth + 1);
            seen.clear(); before.forEach(x => seen.add(x));
            if (sub.length && (!best || sub.length < best.n)) best = { y, n: sub.length };
          }
          if (best) out.push(...need(best.y, depth + 1));
        }
      }
      // separate `when` lines are alternatives (Task.update: any trigger condition starts the task): take the one
      // still possible with the least left to do
      const whens = cs.filter(a => a.type === 'WhenTask');
      let when = whens[0];
      if (whens.length > 1) {
        const pool = whens.filter(a => !lineDead(a));
        let best = Infinity;
        for (const a of pool.length ? pool : whens) {
          const before = new Set(seen), trial = [];
          whenNeed(a, depth, trial);
          seen.clear(); before.forEach(x => seen.add(x));
          if (trial.length < best) { best = trial.length; when = a; }
        }
      }
      for (const a of cs) {
        if (a.type === 'WhenTask') {
          if (a === when) whenNeed(a, depth, out);
        } else if (PLAYER.has(a.type)) {
          const o = objective(a);
          if (o) alts.push(o);
        }
      }
      if (alts.length) {
        const ready = alts.filter(live);
        // a place the script has yet to reveal is not on the travel map (fast travel only goes to known
        // places): whatever reveals it comes first
        const hidden = ready.map(where).find(pl => pl && unrevealed(pl));
        if (hidden) out.push(...need(sym(unrevealed(hidden).symbol), depth + 1));
        if (ready.length) out.push(ready.map(o => ({ ...o, place: where(o) })));
        else if (alts.some(o => (o.kind === 'bring' || o.kind === 'drop') && itemPlace(o.item))) {
          // the item to deliver (or to leave somewhere) lies where the quest put it: pick it up first
          const o = alts.find(b => (b.kind === 'bring' || b.kind === 'drop') && itemPlace(b.item));
          const pl = itemPlace(o.item);
          if (unrevealed(pl)) out.push(...need(sym(unrevealed(pl).symbol), depth + 1));
          out.push([{ kind: 'pickup', item: o.item, place: pl }]);
          out.push([{ ...o, place: where(o) }]);
        } else {
          // nothing to act on yet: first whatever puts the target into the world
          const first = alts.find(o => placer(o)) || alts[0];
          const p = placer(first);
          if (p) out.push(...need(sym(p.symbol), depth + 1));
          out.push([{ ...first, place: where(first), later: true }]);
        }
      }
    } else {
      // a clock the quest has started: its task happens when the time runs out, so the player waits it out
      if (timers.has(s) && all.some(x => x.a.type === 'StartStopTimer' && spec(x.a).isStartTimer !== false && sym(spec(x.a).targetSymbol) === s && ran(x))) {
        out.push([{ kind: 'wait', clock: s }]);
        return out;
      }
      // no condition of its own: set by `pc at <place> set <task>`, or by an action of another task
      const starters = [];
      for (const { task, a } of all) {
        const x = spec(a);
        // watchers that start a task when the player does something: be at a place, use an item, cast a spell;
        // each only watches once its own task has started
        const watch = a.type === 'PcAt' ? { kind: 'go', place: sym(x.placeSymbol) }
          : a.type === 'ItemUsedDo' ? { kind: 'use', item: sym(x.itemSymbol) }
            : a.type === 'CastSpellDo' ? { kind: 'cast', spell: x.spellID } : null;
        if (watch && sym(x.taskSymbol) === s) {
          // a watcher kept to certain hours (`daily from 00:00 to 03:00`) only sees the player then
          const daily = conds(task).find(c => c.type === 'DailyFrom');
          if (daily && !task.triggered) watch.hours = [spec(daily).minDailySeconds || 0, spec(daily).maxDailySeconds ?? 86400];
          if (!task.triggered) out.push(...need(sym(task.symbol), depth + 1));
          out.push([watch]);
          continue;
        }
        // `have _item_ set _task_`: the task waits on the player holding the item, so getting it comes first
        if (a.type === 'HaveItem' && sym(x.targetTask) === s) {
          const it = sym(x.targetItem);
          // (it only watches once its own task has started: Open a Chest's `cast Open spell do` first)
          if (!task.triggered) out.push(...need(sym(task.symbol), depth + 1));
          if (gotItem(it)) continue;
          if (itemPlace(it)) out.push([{ kind: 'pickup', item: it, place: itemPlace(it) }]);
          else starters.push(...all.filter(y => y.a.type === 'GetItem' && sym(spec(y.a).itemSymbol) === it && !ran(y)));
          continue;
        }
        if (task === t || task.triggered || /^(Clear|Unset)Task$/.test(a.type)) continue;
        if (a.type === 'Prompt' && sym(x.noTaskSymbol) === s) continue;
        const refs = Object.values(x).flatMap(v => (Array.isArray(v) ? v : [v])).map(sym);
        if (!refs.includes(s)) continue;
        starters.push({ task, a });
      }
      // several tasks that start this one are several ways to it: the one still possible with the least to do
      let best = null;
      // (a starter already on the way here is a loop, not a free way: The Possessed Child's relic is had from the
      // priest, not from the rescue that needs it)
      const open = starters.filter(st => !seen.has(sym(st.task.symbol)));
      for (const st of open.filter(st => !deadTask(sym(st.task.symbol))).concat(open.every(st => deadTask(sym(st.task.symbol))) ? open : [])) {
        const before = new Set(seen);
        const sub = need(sym(st.task.symbol), depth + 1);
        seen.clear(); before.forEach(x => seen.add(x));
        if (!best || sub.length < best.n) best = { st, n: sub.length };
      }
      if (best) {
        const sub = need(sym(best.st.task.symbol), depth + 1);
        // a yes/no question: the quest goes on with Yes
        if (best.st.a.type === 'Prompt' && sub.length) sub[sub.length - 1] = sub[sub.length - 1].map(o => ({ ...o, answer: 'yes' }));
        out.push(...sub);
      }
    }
    return out;
  }

  // the goal: the task that pays; else the success ending (not a timer's ending, not a failure branch)
  const timers = new Set(all.filter(x => x.a.type === 'StartStopTimer').map(x => sym(spec(x.a).targetSymbol)));
  const open = [...tasks.values()].filter(t => !t.triggered && !timers.has(sym(t.symbol)));
  const has = (t, type) => (t.actions || []).some(a => a.type === type);
  // (a paying task only a `pick one of` that went the other way could start is no goal: Domestic Squabble pays in
  // one of two tasks, by whether the map was picked)
  const live2 = open.filter(t => !deadTask(sym(t.symbol)));
  const goal = live2.find(t => has(t, 'GivePc') && conds(t).length) || live2.find(t => has(t, 'GivePc'))
    || live2.find(t => has(t, 'EndQuest') && conds(t).some(a => PLAYER.has(a.type) || a.type === 'WhenTask'));
  const journal = journalPlace(sq);
  if (!goal) return { objectives: [], complete: false, goal: null, journal };
  const pays = has(goal, 'GivePc');

  // what the goal says must NOT have happened (wound the vampire, do not kill it) is never a way forward
  for (const t of [goal, ...all.filter(({ a }) => a.type === 'StartTask' && (spec(a).taskSymbols || [spec(a).taskSymbol]).map(sym).includes(sym(goal.symbol))).map(x => x.task)])
    for (const w of conds(t).filter(a => a.type === 'WhenTask')) for (const e of spec(w).evaluations || []) if (/Not$/.test(e.op)) forbid.add(e.task);
  const groups = need(sym(goal.symbol));
  // the person the paying task waits on is where the reward is collected: that talk becomes "reward" and
  // goes last; a delivery to them carries "they pay"
  const starting = conds(goal).length ? [goal] : all.filter(({ task, a }) => !task.triggered && a.type === 'StartTask'
    && (spec(a).taskSymbols || [spec(a).taskSymbol]).map(sym).includes(sym(goal.symbol))).map(x => x.task);
  const own = starting.flatMap(conds);
  const direct = [...own, ...own.filter(a => a.type === 'WhenTask')
    .flatMap(a => (spec(a).evaluations || []).filter(e => !/Not$/.test(e.op)).flatMap(e => conds(tasks.get(e.task) || {})))];
  const payerNpcs = new Set(pays ? direct.filter(a => a.type === 'ClickedNpc' || a.type === 'TotingItemAndClickedNpc').map(a => sym(spec(a).npcSymbol)) : []);
  const objectives = [];
  // of several people the paying task waits on (the lady to rescue, then the quest giver), the last talk is the reward
  const lastTalk = groups.map(g => g[0]).findLastIndex(o => o.kind === 'talk' && payerNpcs.has(o.npc));
  let rewardObj = null;
  groups.forEach((g, i) => {
    const o = { ...g[0], alternatives: g.slice(1) };
    if (i === lastTalk) { rewardObj = { ...o, kind: 'reward', payer: true }; return; }
    if (o.kind === 'bring' && payerNpcs.has(o.npc)) o.payer = true;
    objectives.push(o);
  });
  if (rewardObj) objectives.push(rewardObj);
  // nobody to collect from: the reward comes by itself the moment the last step is done (said, as the step after)
  if (pays && !objectives.some(o => o.kind === 'reward' || o.payer)) objectives.push({ kind: 'reward', automatic: true });
  // what the player must NOT do: the player actions behind what the goal waits on NOT having happened (The Postman's
  // wand calls the guard; the vampire must be wounded, not killed)
  const avoid = [];
  for (const f of forbid) {
    const t = tasks.get(f);
    if (!t || t.triggered || timers.has(f)) continue;
    for (const a of conds(t)) if (PLAYER.has(a.type)) { const o = objective(a); if (o && !avoid.some(v => v.kind === o.kind && (v.item || v.foe || v.npc) === (o.item || o.foe || o.npc))) avoid.push(o); }
  }
  // a foe that spawns, an item to use or a spell to cast where the script never says: the journal's latest entry
  // names the place (the bats are in the house, the zombies in the graveyard)
  const o0 = objectives[0];
  if (o0 && !o0.place && journal && ['kill', 'use', 'cast', 'pickup', 'drop'].includes(o0.kind)) Object.assign(o0, { place: journal, fromJournal: true });
  return { objectives, complete: false, goal: sym(goal.symbol), pays, journal, avoid };
}
