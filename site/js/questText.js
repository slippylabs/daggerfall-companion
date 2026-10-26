// Writes a quest's templates and steps as text: with the generic roles ("a townsperson"), or, when a
// journal entry was recognised, with the names the game filled in for this player's quest.
// names: { sym: { 1: 'Bedoryan Kingwing', 3: 'Daggerfall' } }, days: { sym: '5' }

// A message as a template: literal text plus typed blanks the game fills in (DFU QuestMacroHelper):
//   {s: sym, n: 1..4}  _x_ name, __x_ building, ___x_ town, ____x_ region (person or place)
//   {c: sym}           =x_  a timer's days        {m: 'g2'}  a %macro (date, pronoun, player...)
// lookup(sym) gives the quest's own spelling of a symbol and its kind ({sym, kind}), or null for no such resource.
// Shared by the build (tools/build-quests.mjs, on the scripts) and the save reader (the journal's own messages).
export function parseTemplate(text, lookup) {
  const parts = [];
  const re = /(?<![\w])(_{1,4})([A-Za-z0-9.]+?_)(?![\w])|=([A-Za-z0-9.]+?_)(?![\w])|%([a-z][a-z0-9]*)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2]) {
      const r = lookup('_' + m[2]);
      parts.push(r ? { s: r.sym, n: m[1].length } : m[0]);
    } else if (m[3]) {
      // =x_ is a timer's days for a Clock; for anything else it names the thing (=monster_)
      const r = lookup('_' + m[3]);
      parts.push(!r ? m[0] : r.kind === 'Clock' ? { c: r.sym } : { s: r.sym, n: 1 });
    }
    else parts.push({ m: m[4] });
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

const role = (q, sym) => q.resources[sym]?.role ?? sym.replace(/_/g, ' ').trim();
const isPerson = (q, sym) => q.resources[sym]?.kind === 'Person';

// The best single name for a person or place the player would recognise
export function nameFor(q, sym, names) {
  const n = names?.[sym];
  if (!n) return null;
  return isPerson(q, sym) ? n[1] || null : n[1] || n[3] || n[2] || null;
}

// One template part as [text, filledIn]
function partText(q, p, names, days) {
  if (typeof p === 'string') return [p, false];
  if (p.c) return days?.[p.c] ? [days[p.c], true] : [q.resources[p.c]?.role ?? 'a few', false];
  if (p.m) {
    const g = { g: 'they', g1: 'they', g2: 'them', g3: 'their', g2self: 'themselves', pcn: 'you', pcf: 'you', qdt: '', qdat: '' };
    return [p.m in g ? g[p.m] : '…', false];
  }
  const got = names?.[p.s]?.[p.n];
  if (got) return [got, true];
  const r = role(q, p.s);
  if (isPerson(q, p.s)) {
    if (q.resources[p.s].questor) return [['', 'the quest giver', "the quest giver's building", "the quest giver's town", "the quest giver's region"][p.n], false];
    return [['', r, `${r.replace(/,.*$/, '')}'s building`, `${r.replace(/,.*$/, '')}'s town`, 'the region'][p.n], false];
  }
  return [p.n === 4 ? 'the region' : r, false];
}

// Template parts -> DOM-ready segments: [{text, kind: 'plain'|'filled'|'blank'}]
export function templateSegments(q, parts, names, days) {
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p && p.m === 'qdt') {   // the date prefix "%qdt:" is dropped
      if (typeof parts[i + 1] === 'string') parts = [...parts.slice(0, i + 1), parts[i + 1].replace(/^\s*:\s*/, ''), ...parts.slice(i + 2)];
      continue;
    }
    const [text, filled] = partText(q, p, names, days);
    if (!text) continue;
    out.push({ text, kind: typeof p === 'string' ? 'plain' : filled ? 'filled' : 'blank' });
  }
  return out;
}

const LIST = (xs, oneOf) => xs.length === 1 ? xs[0] : oneOf
  ? `one of: ${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}` : xs.join(' / ');

export function stepText(q, st, names) {
  const n = sym => nameFor(q, sym, names) || role(q, sym);
  const oneOf = ['at_npc', 'at_item', 'at_foe', 'given'].includes(st.k);
  const A = LIST(st.a.map(n), oneOf), B = st.b ? n(st.b) : '';
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  switch (st.k) {
    case 'at_npc': return `${cap(A)} is at ${B}.`;
    case 'at_item': return `${cap(A)} is hidden at ${B}.`;
    case 'at_foe': return `${cap(A)} waits at ${B}.`;
    case 'map': return `${cap(A)} is marked on your map.`;
    case 'given': return `You are given ${A}.`;
    case 'kill': return `Kill ${A}.`;
    case 'pickup': return `Pick up ${A}.`;
    case 'bring': return `Bring ${A} to ${B}.`;
    case 'talk': return `Talk to ${A}.`;
    case 'go': return `Go to ${A}.`;
    case 'reward': return `Reward: ${A}.`;
    default: return '';
  }
}

// Who pays: [{sym, name, role, questor, town}]
export function rewardGivers(q, names) {
  return q.reward.from.map(f => ({
    ...f,
    name: nameFor(q, f.sym, names),
    town: names?.[f.sym]?.[3] || null,
    building: names?.[f.sym]?.[2] || null,
  }));
}

// Where a player is in a quest's walkthrough: each step of q.steps as 'done' | 'now' | 'next' | 'todo' | 'info',
// from the open objectives a save gave (saveImport.guideFor, first = NOW). A step that does something and is not
// among the open objectives is behind the player (or a branch the quest did not take); facts ("X is at Y") are info.
const ACTS = new Set(['talk', 'bring', 'kill', 'pickup', 'go', 'reward']);
function matches(st, o) {
  const s = o.syms || {}, a = st.a || [];
  switch (o.kind) {
    case 'talk': return st.k === 'talk' && a.includes(s.npc);
    case 'reward': return st.k === 'reward' || (st.k === 'talk' && a.includes(s.npc));
    // a delivery is the click on the recipient too, and the reward when the recipient pays
    case 'bring': return (st.k === 'bring' && (a.includes(s.item) || st.b === s.npc)) || (st.k === 'talk' && a.includes(s.npc)) || (o.payer && st.k === 'reward');
    case 'kill': case 'loot': return st.k === 'kill' && a.includes(s.foe);
    case 'pickup': return st.k === 'pickup' && a.includes(s.item);
    case 'go': return st.k === 'go' && a.includes(s.place);
    default: return false;
  }
}
export function questProgress(q, guide) {
  const status = q.steps.map(st => (ACTS.has(st.k) ? 'done' : 'info'));
  (guide || []).forEach((o, gi) => {
    q.steps.forEach((st, i) => {
      if (status[i] === 'info' || !matches(st, o)) return;
      const want = gi === 0 ? 'now' : gi === 1 ? 'next' : 'todo';
      const rank = { done: 0, todo: 1, next: 2, now: 3 };
      if (rank[want] > rank[status[i]]) status[i] = want;
    });
  });
  // the count: one per thing to do (a delivery and its click and its payment are one), in the walkthrough's order
  const acts = status.map((s, i) => [s, i]).filter(([s]) => s !== 'info');
  const groups = [];
  for (const [s, i] of acts) {
    const st = q.steps[i];
    const prev = groups[groups.length - 1];
    if (prev && prev.s === s && s !== 'done') { prev.n.push(i); continue; }
    groups.push({ s, n: [i], k: st.k });
  }
  const total = groups.length, at = groups.findIndex(g => g.s === 'now');
  return { status, total, step: at >= 0 ? at + 1 : total, finished: !guide || !guide.length };
}
