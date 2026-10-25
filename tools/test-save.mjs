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
  const spot = old?.spots?._mondung_?.[0];
  check(old?.spots?._mondung_?.length === 1 && spot.what[0] === '_werewolf_', `[${kind}] the werewolf's spot inside the dungeon`);
}
let bad = false;
try { await readSaves(new Blob(['hello'])); } catch { bad = true; }
check(bad, 'a file that is not a save is refused');
console.log(`save import: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
