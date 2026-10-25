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
for (const [kind, bytes] of Object.entries(files)) {
  const saves = await readSaves(new Blob([bytes]));
  check(saves.length === 2 && saveLabel(saves[0]).startsWith('Slippy · Hunt done'), `[${kind}] two saves, newest first: ${saveLabel(saves[0])}`);
  const now = questsInSave(saves[0].snap, quests).found;
  const dv = now.find(f => f.q.file === 'A0C00Y14');
  check(now.length === 1 && dv, `[${kind}] newest save: only The Delivery Boy is active`);
  check(dv?.names._pickuplocal_?.[1] === 'Bedoryan Kingwing' && dv?.names._pickuplocal_?.[2] === 'The Wickford Residence' && dv?.names._pickuplocal_?.[3] === 'Daggerfall',
    `[${kind}] the recipient's name, house and town come from the save`);
  check(dv?.locs._pickuplocal_ === idx('Daggerfall') && dv?.daysLeft === 1, `[${kind}] the town by map id, 1 day left`);
  check(dv?.buildings._pickuplocal_?.key === 328965 && dv?.buildings._questgiver_?.name === 'The Yeoming Residence', `[${kind}] the exact houses by building key`);
  check(whereSaved(saves[0].snap) === idx('Penbrugh'), `[${kind}] saved outdoors at Penbrugh`);
  const old = questsInSave(saves[1].snap, quests).found.find(f => f.q.file === 'M0B00Y00');
  check(old?.locs._mondung_ === idx('Ruins of Wickston Manor') && old?.daysLeft === 5 && old?.names._questgiver_?.[1] === 'Lord Kain Mastercroft',
    `[${kind}] older save: the hunt's dungeon by map id, 5 days, the quest giver's name`);
  const spot = old?.spots?._mondung_?.[0];
  check(old?.spots?._mondung_?.length === 1 && spot.what[0] === '_werewolf_' && Number.isInteger(spot.bx) && spot.y !== undefined,
    `[${kind}] the werewolf's spot inside the dungeon: block ${spot?.bx},${spot?.bz} at ${spot?.x},${spot?.y},${spot?.z}`);
}
let bad = false;
try { await readSaves(new Blob(['hello'])); } catch { bad = true; }
check(bad, 'a file that is not a save is refused');
console.log(`save import: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
