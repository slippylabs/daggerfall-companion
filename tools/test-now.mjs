// "Do this now" oracle: every quest compiled by DFO's own QuestMachine, its startup played (questSim.mjs),
// must give questNow() a first objective with a real target; and two quests played stage by stage must
// give the objectives a player sees in the game.
import { compile, start, run, setTriggered, kill, questFiles, perform, settle, heldItems } from './lib/questSim.mjs';
import { questNow, journalPlace } from '../site/js/questNow.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE } from './lib/env.mjs';

let pass = 0, fail = 0;
const JOURNAL_AGREE = 0.88;   // 180/200 in v2.5.0; the rest are multi-stop quests (bricks in three places) where NOW is the right stop
const check = (ok, what) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); };
const now = sd => questNow(sd, heldItems(sd)).objectives;
const show = o => o ? `${o.kind} ${o.npc || o.foe || o.item || o.place || o.clock || (o.automatic ? '(automatic)' : '')}` : 'nothing';

// Sweep: the quests a player can get (the guide's own list: no demo scripts, no untitled story helpers)
const listed = new Set(JSON.parse(readFileSync(join(SITE, 'data/quests.json'), 'utf8'))
  .filter(q => !/^_|^S000/.test(q.file) || q.title).map(q => q.file));
const bad = [], files = questFiles().filter(f => listed.has(f));
let compiled = 0;
for (const f of files) {
  const sd = compile(f);
  if (!sd) continue;
  compiled++;
  start(sd);
  const o = now(sd)[0];
  if (!o || !(o.npc || o.foe || o.item || o.place || o.clock || o.automatic)) bad.push(`${f} ${sd.displayName || ''}: ${show(o)}`);
}
if (process.argv.includes('-v')) bad.forEach(b => console.log('   ', b));
check((compiled - bad.length) / compiled >= 0.975, `startup NOW with a target for ${compiled - bad.length}/${compiled} quests`);

// Play-through: doing NOW, again and again, must reach the quest's goal (the guide never leads nowhere)
{
  const stuck = [];
  let ok = 0, n = 0;
  var jt = { named: 0, agree: 0, list: [] };
  for (const f of files) {
    const sd = compile(f);
    if (!sd) continue;
    start(sd); settle(sd);
    const first = questNow(sd, heldItems(sd));
    if (!first.goal) continue;
    n++;
    let steps = 0, last = '';
    for (; steps < 25; steps++) {
      const r = questNow(sd, heldItems(sd));
      if (!r.goal || sd.tasks.find(t => t.symbol.original === first.goal)?.triggered) break;
      const o = r.objectives[0];
      if (!o || o.automatic) break;
      last = show(o);
      // NOW against the journal: does the guide send the player where the journal does?
      // (a person met at home, or the quest giver to report back to, has no place; the journal may still name the
      // job's dungeon then, which is no disagreement)
      const j = journalPlace(sd), personal = ['talk', 'reward', 'bring'].includes(o.kind) && !o.place;
      if (j && !personal) {
        jt.named++;
        if (o.place === j) jt.agree++;
        else jt.list.push(`${f} step ${steps}: NOW ${show(o)} at ${o.place || '(no place)'}, journal names ${j}`);
      }
      perform(sd, o);
    }
    if (sd.tasks.find(t => t.symbol.original === first.goal)?.triggered) ok++;
    else stuck.push(`${f} ${sd.displayName || ''}: stuck after ${steps} steps at ${last}`);
  }
  if (process.argv.includes('-v')) stuck.forEach(b => console.log('   ', b));
  check(ok / n >= 0.985, `following NOW finishes ${ok}/${n} quests`);
  if (process.argv.includes('-j')) jt.list.forEach(b => console.log('   ', b));
  check(jt.agree / jt.named >= JOURNAL_AGREE, `NOW goes where the journal's latest entry points: ${jt.agree}/${jt.named} steps`);
}

// The Postman, as a player's save had it (2026-10-25): the true letter delivered, the forged one still to leave in
// the inn. NOW the drop, THEN the reward that comes by itself; and never the wand, which calls the guard
{
  const sd = start(compile('A0C00Y00'), 1);   // pick 1: _letter2_ (the forged letter _falseletter2_)
  settle(sd); setTriggered(sd, '_S.02_'); setTriggered(sd, '_qgclicked_');
  const r = questNow(sd, heldItems(sd)), [a, b] = r.objectives;
  check(a?.kind === 'drop' && a.item === '_falseletter2_' && a.place === '_inn_' && b?.kind === 'reward' && b.automatic
    && r.avoid?.length === 1 && r.avoid[0].kind === 'pickup' && r.avoid[0].item === '_treasure_',
    `Postman, letter delivered: ${show(a)} at ${a?.place}, then ${b?.automatic ? 'the reward by itself' : show(b)}; don't ${r.avoid?.map(show).join(', ')}`);
}
// The Delivery Boy: the package is handed over at the start; deliver it, the recipient pays
{
  const sd = start(compile('A0C00Y14'));
  const o = now(sd);
  check(o[0]?.kind === 'bring' && o[0].npc === '_pickuplocal_' && o[0].payer, `Delivery Boy, start: ${show(o[0])} (bring the package to the recipient, who pays)`);
}
// Hunt for a Lycanthrope: kill the beast in the dungeon, then go back to the quest giver
{
  const sd = start(compile('M0B00Y00'), 2);   // pick 2: the werewolf
  let o = now(sd);
  check(o[0]?.kind === 'kill' && o[0].foe === '_werewolf_' && o[0].place === '_mondung_', `Hunt, start: ${show(o[0])} at ${o[0]?.place}`);
  check(o[1]?.kind === 'reward' && o[1].npc === '_questgiver_', `Hunt, then: ${show(o[1])}`);
  kill(sd, '_werewolf_'); run(sd, '_mondead_');
  o = now(sd);
  check(o.length === 1 && o[0].kind === 'reward' && o[0].npc === '_questgiver_', `Hunt, beast dead: ${show(o[0])}`);
}
// An Unexpected Journey: the traitor is a person until you talk to him, then a foe to kill
{
  const sd = start(compile('A0C00Y06'));
  const o = now(sd);
  check(o[0]?.kind === 'talk' && o[0].npc === '_traitor_' && o[1]?.kind === 'kill' && o[1].foe === '_mtraitor_' && o[1].later,
    `Unexpected Journey: ${show(o[0])}, then ${show(o[1])} (not in the world yet)`);
}
// The Mummy's Finger: the mummy's tomb is revealed by the sage, so show the sage the finger first
{
  const sd = start(compile('A0C41Y18'));
  const o = now(sd);
  check(o[0]?.npc === '_sage_' && o[1]?.kind === 'kill' && o[1].foe === '_realmummy_', `Mummy's Finger: ${o.map(show).join(' -> ')}`);
}
console.log(`questNow: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
