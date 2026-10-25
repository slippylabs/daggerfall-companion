// Writes site/data/roads.bin: the roads, dirt tracks, rivers and streams of Basic Roads by Hazelnut
// (github.com/ajrb/dfunity-mods, BasicRoads/), the same files DFO Online draws its roads from.
// Four 1000x500 layers back to back (roads, tracks, rivers, streams), one byte per map pixel, each an
// 8-direction mask of the edges a path leaves through: N=128 NE=64 E=32 SE=16 S=8 SW=4 W=2 NW=1.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DFO, writeOut } from './lib/env.mjs';

const dir = join(DFO, 'vendor/roads-hazelnut');
// sha256 as pinned by DFO (vendor/roads-hazelnut/README.md), checked against the upstream repo
const SHA = {
  roadData: '249ee50c54c564b9f89e3cf0cb28f87e0ab1c5603cdd4f794afc4e96a6b6af8a',
  trackData: 'dce018b03bee20f846bfca0854ae38cf737b8a684e92bf95cd7468df403385a6',
  riverData: '6b867c189be672874334557573d8c40598beb050277dd18f81a2c33b9b9ac8ab',
  streamData: '567ebda53a121435f5c26c12c6141d2d596c54af82fe3a08109f25544cef349f',
};
const N = 1000 * 500;
const layers = Object.entries(SHA).map(([name, sha]) => {
  const b = readFileSync(join(dir, `${name}.bytes`));
  const got = createHash('sha256').update(b).digest('hex');
  if (got !== sha || b.length !== N) throw new Error(`${name}.bytes: not the pinned Basic Roads file (${got})`);
  return new Uint8Array(b);
});
const [roads, tracks, rivers, streams] = layers;
// where a road or track and a river share an edge the edge is the path's (DFO's waterOffPaths)
for (let i = 0; i < N; i++) {
  const path = roads[i] | tracks[i];
  if (path) { rivers[i] &= ~path; streams[i] &= ~path; }
}
const out = new Uint8Array(N * 4);
layers.forEach((l, k) => out.set(l, k * N));
writeOut('data/roads.bin', out);
const count = l => l.reduce((n, v) => n + (v ? 1 : 0), 0);
console.log(`roads ${count(roads)} px, tracks ${count(tracks)}, rivers ${count(rivers)}, streams ${count(streams)}`);
