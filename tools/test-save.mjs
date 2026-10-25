// Save import: reads the fixture zip DFO's own exporter wrote (tools/make-save-fixture.mjs), stored and
// recompressed with deflate, and checks the quests, names, places, days and where the player stood.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SITE, ROOT } from './lib/env.mjs';

globalThis.fetch = async () => { throw new Error('no fetch in test'); };
const ver = readFileSync(join(SITE, 'js/saveImport.js'), 'utf8').match(/data\.js(\?v=\d+)/)[1];
const { data } = await import(`../site/js/data.js${ver}`);
const { readSaves, questsInSave, whereSaved, saveLabel } = await import('../site/js/saveImport.js');
const { questProgress } = await import('../site/js/questText.js');
data.locs = JSON.parse(readFileSync(join(SITE, 'data/locations.json'), 'utf8'));
data.count = data.locs.name.length;
const quests = JSON.parse(readFileSync(join(SITE, 'data/quests.json'), 'utf8'));
const idx = n => { const i = data.locs.name.indexOf(n); if (i < 0) throw new Error(`no location ${n}`); return i; };

const stored = join(ROOT, 'tools/fixtures/DFO-Online-Saves.zip');
const dir = mkdtempSync(join(tmpdir(), 'dg-save-'));
execSync(`cd ${dir} && unzip -q ${stored} && zip -q -r -9 deflated.zip Saves`);
const files = { stored: readFileSync(stored), deflated: readFileSync(join(dir, 'deflated.zip')) };
rmSync(dir, { recursive: true });

let pass = 0, fail = 0;
const check = (ok, what) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); };
const extra = { names: JSON.parse(readFileSync(join(SITE, 'data/names.json'), 'utf8')), individuals: JSON.parse(readFileSync(join(SITE, 'data/individuals.json'), 'utf8')) };
const { FIXTURE_LAIR } = await import('./make-save-fixture.mjs');
for (const [kind, bytes] of Object.entries(files)) {
  const saves = await readSaves(new Blob([bytes]));
  check(saves.length === 2 && saveLabel(saves[0]).startsWith('Slippy · Beast slain'), `[${kind}] two saves, newest first: ${saveLabel(saves[0])}`);
  const now = questsInSave(saves[0].snap, quests, extra).found;
  const dv = now.find(f => f.q.file === 'A0C00Y14'), hn = now.find(f => f.q.file === 'M0B00Y00');
  check(now.length === 2 && dv && hn, `[${kind}] newest save: The Delivery Boy and Hunt for a Lycanthrope`);
  check(dv?.names._pickuplocal_?.[1] === 'Bedoryan Kingwing' && dv?.names._pickuplocal_?.[2] === 'The Wickford Residence' && dv?.names._pickuplocal_?.[3] === 'Daggerfall',
    `[${kind}] the recipient's name, house and town come from the save`);
  check(dv?.locs._pickuplocal_ === idx('Daggerfall') && dv?.daysLeft === 1, `[${kind}] the town by map id, 1 day left`);
  check(whereSaved(saves[0].snap) === idx('Penbrugh'), `[${kind}] saved outdoors at Penbrugh`);
  // Do this now
  const g = dv?.guide?.[0];
  check(g?.kind === 'bring' && g.who === 'Bedoryan Kingwing' && g.building?.key === 328965 && g.loc === idx('Daggerfall') && g.payer && /^the book "/.test(g.item || ''),
    `[${kind}] Delivery Boy NOW: bring ${g?.item} to ${g?.who}, ${g?.building?.name} (he pays)`);
  const h = hn?.guide?.[0];
  check(hn?.guide?.length === 1 && h?.kind === 'reward' && h.who === 'Lord Kain Mastercroft' && h.building?.key === 197899,
    `[${kind}] Hunt, beast slain, NOW: ${h?.kind} at ${h?.who}, ${h?.building?.name}`);
  const old = questsInSave(saves[1].snap, quests, extra).found.find(f => f.q.file === 'M0B00Y00');
  const k = old?.guide?.[0];
  check(k?.kind === 'kill' && k.who === 'Werewolf' && k.loc === idx('Ruins of Wickston Manor') && k.spot?.bx === FIXTURE_LAIR.bx && k.spot?.z === FIXTURE_LAIR.z && old.guide[1]?.kind === 'reward',
    `[${kind}] Hunt, beast alive, NOW: kill the ${k?.who} at block ${k?.spot?.bx},${k?.spot?.bz}; THEN ${old?.guide?.[1]?.kind}`);
  // the walkthrough knows the step: the hunt is on its kill (step 1 of 2), then on the reward (2 of 2)
  const pOld = questProgress(old.q, old.guide), pNow = questProgress(hn.q, hn.guide), pDv = questProgress(dv.q, dv.guide);
  const kOld = old.q.steps.findIndex(st => st.k === 'kill'), kRew = old.q.steps.findIndex(st => st.k === 'reward');
  check(pOld.status[kOld] === 'now' && pOld.status[kRew] === 'next' && pOld.step === 1 && pOld.total === 2,
    `[${kind}] walkthrough, beast alive: kill = now, reward = next, step ${pOld.step} of ${pOld.total}`);
  check(pNow.status[kOld] === 'done' && pNow.status[kRew] === 'now' && pNow.step === 2, `[${kind}] walkthrough, beast slain: kill done, reward now, step ${pNow.step} of ${pNow.total}`);
  check(pDv.status[dv.q.steps.findIndex(st => st.k === 'bring')] === 'now' && pDv.total === 1, `[${kind}] Delivery Boy: the delivery (with its click and payment) is the one step, now`);
  // the journal, as the game writes it: the save's own entries with the blanks filled in from the save
  const jd = dv?.journal?.[0], jh = hn?.journal?.[0];
  check(dv?.journal?.length === 1 && /Gondywyr Hearthhouse of Daggerfall/.test(jd?.text) && /delivering a package to Bedoryan Kingwing, also of Daggerfall\./.test(jd?.text) && !/[_%]/.test(jd?.text),
    `[${kind}] Delivery Boy journal: "${jd?.text?.slice(0, 70)}…"`);
  check(jd?.lastPlace === null && jh?.lastPlace?.sym === '_mondung_' && jh.lastPlace.loc === idx('Ruins of Wickston Manor') && /lair, Ruins of Wickston Manor/.test(jh.text),
    `[${kind}] the place the journal names (DFU's last Place in the entry): none for the delivery, the lair for the hunt`);
  const spot = old?.spots?._mondung_?.[0];
  check(old?.spots?._mondung_?.length === 1 && spot.what[0] === '_werewolf_', `[${kind}] the werewolf's spot inside the dungeon`);
}
// one parser for the build and the save reader: every journal message in every quest, parsed from the game's own
// compiled message lines, gives the build's own template (quests.json)
{
  const { compile, questFiles } = await import('./lib/questSim.mjs');
  const { parseTemplate } = await import('../site/js/questText.js');
  const byFile = new Map(quests.map(q => [q.file, q]));
  let n = 0, same = 0;
  const differ = [];
  for (const f of questFiles()) {
    const q = byFile.get(f), sd = q && compile(f);
    if (!sd) continue;
    const kind = new Map(sd.resources.map(r => [r.symbol.original, r.type]));
    for (const t of q.templates.filter(t => t.kind === 'log' && t.v === 0)) {
      const m = sd.messages.find(x => x.id === t.id);
      if (!m) continue;
      n++;
      const cut = m.lines.findIndex(l => l.trim() === '<--->');
      const text = (cut < 0 ? m.lines : m.lines.slice(0, cut)).map(l => l.replace(/<[a-z]{2}>/gi, '').trim()).join(' ').replace(/\s+/g, ' ').trim();
      const got = parseTemplate(text, s => (q.resources[s] ? { sym: s, kind: kind.get(s) || q.resources[s].kind } : null));
      const blanks = ps => JSON.stringify(ps.filter(p => typeof p !== 'string'));
      if (blanks(got) === blanks(t.parts)) same++; else if (differ.length < 3) differ.push(`${f} ${t.id}`);
    }
  }
  check(n > 350 && same / n >= 0.99, `journal messages read from a save fill the same blanks as the build's: ${same}/${n}${differ.length ? ` (differ: ${differ.join(', ')})` : ''}`);
}
let bad = false;
try { await readSaves(new Blob(['hello'])); } catch { bad = true; }
check(bad, 'a file that is not a save is refused');
console.log(`save import: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
