// Writes site/data/names.json: names the save only holds as numbers.
//   books:  book id (an Item's `message`, low byte: DFU BookFile.messageToBookFilename) -> title (ARENA2/BOOKS)
//   spells: SPELLS.STD index (a quest's `cast ... spell` / CastSpellDo spellID) -> spell name
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dfo, arena2, ARENA2, writeOut } from './lib/env.mjs';

const { BookFile } = await dfo('src/formats/bookFile.js');
const { readSpellsStd } = await dfo('src/formats/spellsStd.js');

const books = {};
for (const f of readdirSync(join(ARENA2, 'BOOKS')).filter(f => /^BOK\d{5}\.TXT$/i.test(f)).sort()) {
  const b = new BookFile();
  b.load(new Uint8Array(readFileSync(join(ARENA2, 'BOOKS', f))), f);
  if (b.title) books[+f.slice(3, 8)] = b.title.trim();
}
const spells = {};
for (const sp of readSpellsStd(arena2('SPELLS.STD'))) if (!(sp.index in spells) && sp.name) spells[sp.index] = sp.name.trim();
writeOut('data/names.json', JSON.stringify({ books, spells }));
console.log(`${Object.keys(books).length} book titles, ${Object.keys(spells).length} spells; spell 18 = ${spells[18]}, 57 = ${spells[57]}`);
