// Load the quests the player is on straight from a DFO Online save: the Load menu's "Export all saves"
// zip (Saves/SAVE<n>/SaveData.txt + SaveInfo.txt), or one SaveData.txt. Read in this browser only; nothing
// is uploaded. The save holds DFU's QuestMachine data: each quest's file name, the people's names and the
// places the game picked (with their map ids), and the clocks' remaining seconds (DFO save.js snapshotPlayer
// -> questBridge.snapshot -> QuestMachine/Quest/Person/Place/Clock getSaveData).
import { data } from './data.js?v=7';

// ---- zip (stored, as DFO writes it, or deflated by any other zipper) ----
export async function readZip(buf) {
  const v = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('damaged zip file');
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extra + comment;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = u8.subarray(start, start + size);
    out.push({ name, read: async () => method === 0 ? raw
      : method === 8 ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())
        : Promise.reject(new Error(`${name}: unsupported zip compression`)) });
  }
  return out;
}

// A file (zip or SaveData.txt) -> [{n, info, snap}] newest first
export async function readSaves(file) {
  const buf = await file.arrayBuffer();
  const text = b => new TextDecoder().decode(b);
  const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const slots = new Map();
    for (const e of await readZip(buf)) {
      const m = /(?:^|\/)SAVE(\d+)\/(SaveData|SaveInfo)\.txt$/i.exec(e.name);
      if (!m) continue;
      const s = slots.get(m[1]) ?? { n: +m[1] };
      try { s[m[2].toLowerCase() === 'savedata' ? 'snap' : 'info'] = JSON.parse(text(await e.read())); } catch { /* not this slot */ }
      slots.set(m[1], s);
    }
    const out = [...slots.values()].filter(s => s.snap?.quest);
    if (!out.length) throw new Error('no saves with quests in this zip');
    return out.sort((a, b) => (b.info?.dateAndTime?.gameTime ?? 0) - (a.info?.dateAndTime?.gameTime ?? 0));
  }
  let snap;
  try { snap = JSON.parse(text(buf)); } catch { throw new Error('not a save: choose the zip from "Export all saves", or a SaveData.txt'); }
  if (!snap?.quest) throw new Error('this file has no quests in it');
  return [{ n: 0, info: null, snap }];
}

// Daggerfall's calendar: 12 months of 30 days; classic minutes count from 3E 404 (DFO gameDate.js
// CLASSIC_EPOCH_IN_SECONDS = 404 years), so the game's start, minute 523530, is 4 Morning Star 3E 405
const MONTHS = ['Morning Star', 'Sun\'s Dawn', 'First Seed', 'Rain\'s Hand', 'Second Seed', 'Midyear', 'Sun\'s Height', 'Last Seed', 'Hearthfire', 'Frostfall', 'Sun\'s Dusk', 'Evening Star'];
export function gameDate(minutes) {
  if (!Number.isFinite(minutes)) return '';
  const day = Math.floor(minutes / 1440) + 404 * 360;
  return `${day % 30 + 1} ${MONTHS[Math.floor(day / 30) % 12]}, 3E ${Math.floor(day / 360)}`;
}
export const saveLabel = s => [s.info?.characterName, s.info?.saveName, gameDate(s.info?.dateAndTime?.gameTime)].filter(Boolean).join(' · ') || `Save ${s.n}`;

// Where the player stood: the map pixel of a save made outdoors, as a location index (or -1)
export function whereSaved(snap) {
  const px = snap.world?.pixel;
  if (!px) return -1;
  let best = -1, bestD = 3;
  for (let i = 0; i < data.count; i++) {
    const d = Math.max(Math.abs(data.locs.px[i] - px.x), Math.abs(data.locs.py[i] - px.y));
    if (d < bestD || (d === bestD && best >= 0 && data.locs.type[i] < data.locs.type[best])) { bestD = d; best = i; }
  }
  return best;
}

// The active quests of a save, each as {q, names, days, daysLeft, locs} in the shape the journal reader gives
export function questsInSave(snap, quests) {
  const byFile = new Map(quests.map(q => [q.file.toUpperCase(), q]));
  const byMapId = new Map();
  data.locs.mapId.forEach((id, i) => { if (!byMapId.has(id)) byMapId.set(id, i); });
  const out = [], unknown = [];
  for (const sq of snap.quest?.machine?.quests || []) {
    if (sq.questComplete || sq.questTombstoned) continue;
    const q = byFile.get(String(sq.questName).toUpperCase());
    if (!q) { unknown.push(sq.displayName || sq.questName); continue; }
    // our resources are keyed "_name_"; a save's symbols keep the script's original spelling
    const key = sym => sym && (q.resources[sym] ? sym : q.resources[`_${String(sym).replace(/^_+|_+$/g, '')}_`] ? `_${String(sym).replace(/^_+|_+$/g, '')}_` : null);
    const res = new Map((sq.resources || []).map(r => [r.symbol?.original, r]));
    const site = sym => res.get(sym)?.resourceSpecific?.siteDetails || null;
    const names = {}, days = {}, locs = {};
    // the blanks as the game fills them: a person _name_ __building_ ___town_ ____region_ (Person.expandMacro);
    // a place _building_ __town_ ___town_ ____region_ (Place.expandMacro)
    const put = (k, sd, n) => {
      if (sd?.locationName) n[3] = sd.locationName;
      if (sd?.regionName) n[4] = sd.regionName;
      for (const i of Object.keys(n)) if (!n[i]) delete n[i];
      if (Object.keys(n).length) names[k] = n;
      const loc = sd ? byMapId.get(sd.mapId) : undefined;
      if (loc !== undefined) locs[k] = loc;
    };
    const clocks = {};
    for (const [orig, r] of res) {
      const k = key(orig), rs = r.resourceSpecific || {};
      if (!k) continue;
      if (r.type === 'Place') { const sd = rs.siteDetails; put(k, sd, { 1: sd?.buildingName, 2: sd?.locationName }); }
      else if (r.type === 'Person') {
        const sd = site(rs.lastAssignedPlaceSymbol?.original) || site(rs.homePlaceSymbol?.original);
        put(k, sd, { 1: rs.displayName, 2: sd?.buildingName });
      } else if (r.type === 'Clock' && rs.clockEnabled && !rs.clockFinished && rs.remainingTimeInSeconds > 0) {
        clocks[k] = Math.max(1, Math.ceil(rs.remainingTimeInSeconds / 86400));
        days[k] = String(clocks[k]);
      }
    }
    // days left: the quest's own timer, else the tightest running clock
    const daysLeft = clocks[q.timer] ?? (Object.keys(clocks).length ? Math.min(...Object.values(clocks)) : null);
    out.push({ q, names, days, daysLeft, locs, uid: sq.uid });
  }
  return { found: out, unknown };
}
