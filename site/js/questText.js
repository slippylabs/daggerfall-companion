// Writes a quest's templates and steps as text: with the generic roles ("a townsperson"), or, when a
// journal entry was recognised, with the names the game filled in for this player's quest.
// names: { sym: { 1: 'Bedoryan Kingwing', 3: 'Daggerfall' } }, days: { sym: '5' }

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
