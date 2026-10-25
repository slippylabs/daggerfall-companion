// DFO Online lays the towns out as the Beautiful Villages and Beautiful Cities mods do: the online lane switches
// both on for everyone (DFO src/systems/online/onlineLane.js), and they rebuild 7,727 places - new block grids, new
// buildings, new names. The guide must show the towns the player walks, so the build opens the same two world-data
// packs DFO ships (vendor/<mod>/WorldDataPack/*.pack.json.gz) on DFO's own world-data door, in DFO's load order
// (src/scenes/modWorldData.js WORLD_DATA_PRIORITY), before any location is read.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dfo, DFO } from './env.mjs';

export const TOWN_PACKS = [['beautiful-villages', 10], ['beautiful-cities', 20]];

export async function openTownPacks(blocks) {
  globalThis.location = { search: '?online=1' };   // the online page: the door is open there
  const W = await dfo('src/formats/worldData/worldDataReplacement.js');
  const P = await dfo('src/formats/worldData/worldDataPack.js');
  const { installTownStandIns } = await dfo('src/world/townStandIns.js');
  W.installWorldDataReplacement();
  W.bindWorldDataBlocks(blocks);
  if (!W.latchWorldDataDoor()) throw new Error('world-data door did not open');
  const log = console.log;
  console.log = (...a) => { if (!/^\[worlddata\] Found/.test(String(a[0]))) log(...a); };   // one line per replaced block
  const opened = {};
  for (const [vendor, priority] of TOWN_PACKS) {
    const text = await P.readPackText(new Uint8Array(readFileSync(join(DFO, `vendor/${vendor}/WorldDataPack/${vendor}.pack.json.gz`))));
    const pack = P.openWorldDataPack(JSON.parse(text), { blocks });
    W.quietLocationOverrides?.(true);
    opened[vendor] = { files: W.registerWorldDataPack(pack, () => true, { priority }), version: pack.mod?.version ?? '' };
  }
  installTownStandIns(() => true);
  return opened;
}
