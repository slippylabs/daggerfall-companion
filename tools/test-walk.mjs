// Dungeon route oracle: in a whole dungeon the game's quest markers (where it stands quest people, foes and items)
// can be walked to from the entrance. On the walk grids (build-walk.mjs), the share reached must be high; and the
// A* route to the fixture's werewolf must exist and be a sensible length. Walking, climbing short walls and
// dropping off ledges reach ~79%; the rest need a hidden door, swimming or levitation. `-v` lists the worst blocks; `--all`
// runs every dungeon (default: a fixed sample of 300).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SITE } from './lib/env.mjs';
import { makeGrid, reachable, route, describe, setStep } from '../site/js/dungeonRoute.js';
if (process.env.WALK_STEP) setStep(+process.env.WALK_STEP);

const idx = JSON.parse(readFileSync(join(SITE, 'data/rdb/index.json'), 'utf8'));
const walks = {};
const walk = n => (walks[n] ||= new Uint8Array(readFileSync(join(SITE, `data/rdb/${n}.walk.bin`))));
const dungeons = [];
for (const f of readdirSync(join(SITE, 'data/dungeons')).filter(f => f.endsWith('.json')))
  for (const [loc, list] of Object.entries(JSON.parse(readFileSync(join(SITE, 'data/dungeons', f), 'utf8')))) dungeons.push([+loc, list]);
const sample = process.argv.includes('--all') ? dungeons : dungeons.filter((_, i) => i % Math.ceil(dungeons.length / 300) === 0);

let n = 0, ok = 0, noStart = 0;
const missBy = {};
for (const [, list] of sample) {
  const w = {}; for (const b of list) w[b[2]] = walk(b[2]);
  const g = makeGrid(list, w);
  const sb = list.find(b => b[3]);
  const s0 = sb && idx[sb[2]].start[0];
  const start = s0 && g.nodeAt(sb[0], sb[1], ...s0);
  if (!start) { noStart++; continue; }
  const seen = reachable(g, start);
  for (const [bx, bz, name] of list) for (const m of idx[name].quest) {
    n++;
    const node = g.nodeAt(bx, bz, ...m);
    if (node && seen.has(g.key(...node))) ok++;
    else missBy[name] = (missBy[name] || 0) + 1;
  }
}
let pass = 0, fail = 0;
const check = (c, what) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${what}`); };
if (process.argv.includes('-v')) console.log('  worst blocks:', Object.entries(missBy).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', '));
check(ok / n >= 0.75 && noStart === 0, `quest markers reachable from the entrance in ${sample.length} dungeons: ${ok}/${n} (${(100 * ok / n).toFixed(1)}%), no entrance found in ${noStart}`);

// the fixture's werewolf in Ruins of Wickston Manor (make-save-fixture.mjs): a route there, and a sensible one
{
  const L = JSON.parse(readFileSync(join(SITE, 'data/locations.json'), 'utf8'));
  const wi = L.name.indexOf('Ruins of Wickston Manor');
  const list = JSON.parse(readFileSync(join(SITE, `data/dungeons/r${String(L.region[wi]).padStart(2, '0')}.json`), 'utf8'))[wi];
  const w = {}; for (const b of list) w[b[2]] = walk(b[2]);
  const g = makeGrid(list, w);
  const sb = list.find(b => b[3]), lair = list.find(b => !b[3] && idx[b[2]].quest.length);
  const from = g.nodeAt(sb[0], sb[1], ...idx[sb[2]].start[0]), to = g.nodeAt(lair[0], lair[1], ...idx[lair[2]].quest[0]);
  const t0 = Date.now(), path = from && to && route(g, from, to), ms = Date.now() - t0;
  const straight = from && to ? Math.hypot(from[0] - to[0], from[1] - to[1]) * 0.4 : 0;
  const d = path && describe(path);
  check(!!path && d.metres >= straight && d.metres < straight * 6,
    `route to the Wickston Manor werewolf: ${d ? `${Math.round(d.metres)} m, stairs ${d.downs} down ${d.ups} up, ${d.climbs.length} climbs, ${d.drops.length} drops (straight line ${Math.round(straight)} m), ${ms} ms` : 'none'}`);
}
console.log(`dungeon routes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
