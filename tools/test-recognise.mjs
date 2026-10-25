// Round-trip test for the journal recogniser: for every journal template of every quest, write the
// entry the game would show (made-up names, a date, days), then recognise it and compare.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE } from './lib/env.mjs';

globalThis.fetch = async () => { throw new Error('no fetch in test'); };
const { compileAll, recogniseWith } = await import('../site/js/recognise.js');

const quests = JSON.parse(readFileSync(join(SITE, 'data/quests.json'), 'utf8'));
const list = compileAll(quests);
const FIRST = ['Bedoryan', 'Gondywyr', 'Elyzanna', 'Mordane', 'Tristyctor', 'Alabywyr', 'Ysara', 'Dunyrick'];
const LAST = ['Kingwing', 'Hearthhouse', 'Hawkhart', 'Mastercroft', 'Greenham', 'Gaerham', 'Coppersley'];
const TOWNS = ['Daggerfall', 'Wayrest', 'Sentinel', 'Shornhelm', 'Gothway Garden', 'Ruins of Wickston Manor'];

let tested = 0, right = 0, namesOk = 0, ambiguous = 0;
const wrong = [];
for (const q of quests) {
  for (const t of q.templates.filter(t => t.kind === 'log' || t.kind === 'accept')) {
    // the game's text for this template
    const want = {}, wantDays = {};
    let k = 0;
    const text = t.parts.map(p => {
      if (typeof p === 'string') return p;
      if (p.m === 'qdt') return 'Morndas, 4th of Morning Star, 3E 405';
      if (p.m) return /^g/.test(p.m) ? 'she' : 'Hero';
      if (p.c) return (wantDays[p.c] ||= String(3 + (k++ % 9)));
      const v = want[p.s]?.[p.n] ?? (p.n === 1 && q.resources[p.s]?.kind === 'Person'
        ? `${FIRST[k % FIRST.length]} ${LAST[(k++ * 3) % LAST.length]}` : TOWNS[k++ % TOWNS.length]);
      (want[p.s] ||= {})[p.n] = v;
      return v;
    }).join('');
    const r = recogniseWith(list, text);
    if (!r) continue;   // too little fixed text to be a template we match on
    tested++;
    const ok = r.quest.file === q.file || r.others.some(o => o.file === q.file)
      || r.quest.templates.some(x => JSON.stringify(x.parts) === JSON.stringify(t.parts));   // identical wording in two quests
    if (r.quest.file !== q.file && ok) ambiguous++;
    if (!ok) { wrong.push(`${q.file}#${t.id} -> ${r.quest.file}`); continue; }
    right++;
    if (r.quest.file !== q.file) { namesOk++; continue; }
    const same = Object.entries(want).every(([s, v]) => Object.entries(v).every(([n, x]) => r.names[s]?.[n] === x))
      && Object.entries(wantDays).every(([s, d]) => r.days[s] === d);
    if (same) namesOk++;
    else wrong.push(`${q.file}#${t.id} names: got ${JSON.stringify(r.names)} want ${JSON.stringify(want)}`);
  }
}
console.log(`${tested} journal entries recognised; right quest ${right}/${tested} (${ambiguous} share their wording with another quest); names read back exactly ${namesOk}/${tested}`);
for (const w of wrong.slice(0, 15)) console.log('  ', w);
process.exit(right === tested && namesOk >= tested * 0.98 ? 0 : 1);
