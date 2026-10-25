// Shared build settings: where DFO Online's source and the ARENA2 game data live.
// Build scripts import DFO's own pure readers by path (MIT, https://github.com/Lattymoy/daggerfall-js-source).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SITE = join(ROOT, 'site');
export const DFO = resolve(process.env.DFO_REPO || join(process.env.HOME, 'projects', 'dfo'));
export const ARENA2 = resolve(process.env.ARENA2 || join(process.env.HOME, 'projects', 'daggerfall-data', 'ARENA2'));

// Import a DFO module by repo-relative path; fail loudly if DFO moved it
export async function dfo(rel) {
  try {
    return await import(pathToFileURL(join(DFO, rel)).href);
  } catch (e) {
    throw new Error(`DFO module ${rel} failed to load from ${DFO}: ${e.message}`);
  }
}

export function arena2(name) {
  return new Uint8Array(readFileSync(join(ARENA2, name)));
}

export function dfoCommit() {
  return execSync('git rev-parse --short HEAD', { cwd: DFO }).toString().trim();
}

export function writeOut(rel, data) {
  const path = join(SITE, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  return path;
}

export async function loadMaps() {
  const { MapsFile } = await dfo('src/formats/mapsFile.js');
  const m = new MapsFile();
  if (!m.load(arena2('MAPS.BSA'), arena2('CLIMATE.PAK'), arena2('POLITIC.PAK')))
    throw new Error('MAPS.BSA failed to load');
  return m;
}
