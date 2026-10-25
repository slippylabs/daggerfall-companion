// What to do NOW in a quest, read from the quest's own compiled script in a DFO save (DFU's Task/Action
// save data: task.js getSaveData, actions.js saveShape). The quest's goal is the task that pays (`give pc`),
// or, when the reward came up front, the task that ends it in success. The goal waits on other tasks through
// `when / and / or`, and those on player actions: click an NPC, bring an item to an NPC, kill a foe, click an
// item, stand at a place (`pc at ... set _task_`). A target that is not in the world yet is first put there by
// another task, whose own conditions come first. Following that chain back gives the open objectives in
// order; the first is NOW, the next THEN.
//
// questNow(sq, items) -> { objectives: [{kind, npc, item, foe, place, payer, later, alternatives}], complete }
//   kind: 'go' | 'pickup' | 'drop' | 'use' | 'cast' | 'kill' | 'talk' | 'bring' | 'reward';
//   npc/item/foe/place are resource symbols, spell a SPELLS.STD index; injure: wound it, do not kill it;
//   answer: 'yes' when the target asks a question;
//   later: its target is not in the world yet (an earlier objective puts it there).
//   items: the player's quest items, [{questUID, symbol}] (from the save's inventories)

const sym = s => (s && typeof s === 'object' ? s.original : s) || null;
const PLAYER = new Set(['ClickedNpc', 'TotingItemAndClickedNpc', 'KilledFoe', 'InjuredFoe', 'ClickedItem', 'DroppedItemAtPlace']);

export function questNow(sq, items = []) {
  if (sq.questComplete) return { objectives: [], complete: true };
  const tasks = new Map((sq.tasks || []).map(t => [sym(t.symbol), t]));
  const res = new Map((sq.resources || []).map(r => [sym(r.symbol), r]));
  const all = [...tasks.values()].flatMap(t => (t.actions || []).map(a => ({ task: t, a })));
  const spec = a => a.actionSpecific || {};
  const ran = ({ task, a }) => a.isComplete || task.triggered;
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
        : o.kind === 'bring' && !gotItem(o.item) ? placing(['GetItem', 'GiveItem', 'PlaceItem'], 'itemSymbol', o.item)
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
      case 'DroppedItemAtPlace': return gotItem(sym(x.itemSymbol)) ? { kind: 'drop', item: sym(x.itemSymbol), place: sym(x.placeSymbol) } : null;
      default: return null;
    }
  };
  const unrevealed = pl => {
    const reveals = all.filter(x => x.a.type === 'RevealLocation' && sym(spec(x.a).placeSymbol) === pl);
    return reveals.length && !reveals.some(ran) ? reveals[0].task : null;
  };
  const where = o => o.place || (o.foe && foePlace(o.foe)) || (o.item && o.kind === 'pickup' && itemPlace(o.item)) || (o.npc && npcPlace(o.npc)) || null;

  // A task's open objectives, in the order to do them: a list of groups (each needed); a group lists
  // alternatives (any one will do)
  const seen = new Set();
  function need(s, depth = 0) {
    if (!s || seen.has(s) || depth > 14) return [];
    const t = tasks.get(s);
    if (!t || t.triggered) return [];
    seen.add(s);
    const out = [];
    const cs = conds(t);
    if (cs.length) {
      const alts = [];
      for (const a of cs) {
        if (a.type === 'WhenTask') {
          for (const e of spec(a).evaluations || []) {
            if (/Not$/.test(e.op)) continue;
            const sub = need(e.task, depth + 1);
            if (/^or/.test(e.op) && out.length && sub.length) out[out.length - 1] = [...out[out.length - 1], ...sub.flat()];
            else out.push(...sub);
          }
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
        else if (alts.some(o => o.kind === 'bring' && itemPlace(o.item))) {
          // the item to deliver lies somewhere the quest put it: pick it up first, then deliver
          const o = alts.find(b => b.kind === 'bring' && itemPlace(b.item));
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
      // no condition of its own: set by `pc at <place> set <task>`, or by an action of another task
      for (const { task, a } of all) {
        const x = spec(a);
        // watchers that start a task when the player does something: be at a place, use an item, cast a spell;
        // each only watches once its own task has started
        const watch = a.type === 'PcAt' ? { kind: 'go', place: sym(x.placeSymbol) }
          : a.type === 'ItemUsedDo' ? { kind: 'use', item: sym(x.itemSymbol) }
            : a.type === 'CastSpellDo' ? { kind: 'cast', spell: x.spellID } : null;
        if (watch && sym(x.taskSymbol) === s) {
          if (!task.triggered) out.push(...need(sym(task.symbol), depth + 1));
          out.push([watch]);
          continue;
        }
        if (task === t || task.triggered || /^(Clear|Unset)Task$/.test(a.type)) continue;
        if (a.type === 'Prompt' && sym(x.noTaskSymbol) === s) continue;
        const refs = Object.values(x).flatMap(v => (Array.isArray(v) ? v : [v])).map(sym);
        if (!refs.includes(s)) continue;
        const sub = need(sym(task.symbol), depth + 1);
        // a yes/no question: the quest goes on with Yes
        if (a.type === 'Prompt' && sub.length) sub[sub.length - 1] = sub[sub.length - 1].map(o => ({ ...o, answer: 'yes' }));
        out.push(...sub);
      }
    }
    return out;
  }

  // the goal: the task that pays; else the success ending (not a timer's ending, not a failure branch)
  const timers = new Set(all.filter(x => x.a.type === 'StartStopTimer').map(x => sym(spec(x.a).targetSymbol)));
  const open = [...tasks.values()].filter(t => !t.triggered && !timers.has(sym(t.symbol)));
  const has = (t, type) => (t.actions || []).some(a => a.type === type);
  const goal = open.find(t => has(t, 'GivePc') && conds(t).length) || open.find(t => has(t, 'GivePc'))
    || open.find(t => has(t, 'EndQuest') && conds(t).some(a => PLAYER.has(a.type) || a.type === 'WhenTask'));
  if (!goal) return { objectives: [], complete: false, goal: null };
  const pays = has(goal, 'GivePc');

  const groups = need(sym(goal.symbol));
  // the person the paying task waits on is where the reward is collected: that talk becomes "reward" and
  // goes last; a delivery to them carries "they pay"
  const direct = [...conds(goal), ...conds(goal).filter(a => a.type === 'WhenTask')
    .flatMap(a => (spec(a).evaluations || []).filter(e => !/Not$/.test(e.op)).flatMap(e => conds(tasks.get(e.task) || {})))];
  const payerNpcs = new Set(pays ? direct.filter(a => a.type === 'ClickedNpc' || a.type === 'TotingItemAndClickedNpc').map(a => sym(spec(a).npcSymbol)) : []);
  const objectives = [];
  let rewardObj = null;
  for (const g of groups) {
    const o = { ...g[0], alternatives: g.slice(1) };
    if (o.kind === 'talk' && payerNpcs.has(o.npc)) { rewardObj = { ...o, kind: 'reward', payer: true }; continue; }
    if (o.kind === 'bring' && payerNpcs.has(o.npc)) o.payer = true;
    objectives.push(o);
  }
  if (rewardObj) objectives.push(rewardObj);
  if (!objectives.length && pays) objectives.push({ kind: 'reward', automatic: true });
  return { objectives, complete: false, goal: sym(goal.symbol), pays };
}
