// Cuts the page's textures from Daggerfall's own interface art (ARENA2):
//   stone.png        - the chiseled grey stone of the spellbook panel (SPBK00I0)
//   parchment.png    - the plain middle of the logbook page (LGBK00I0)
//   scroll-top.png / scroll-bottom.png - the logbook's wooden rollers
import { dfo, arena2, writeOut } from './lib/env.mjs';
import { encodePng } from './lib/png.mjs';

const { ImgFile } = await dfo('src/formats/imgFile.js');
const { DFPalette } = await dfo('src/formats/dfPalette.js');
const { bitmapToColor32 } = await dfo('src/formats/color32Order.js');

const palette = new DFPalette();
palette.load(arena2('ART_PAL.COL'), 'ART_PAL.COL');

function decode(name) {
  const img = new ImgFile();
  img.load(arena2(name), name, null);
  const bmp = img.getDFBitmap();
  return { w: bmp.width, h: bmp.height, rgba: new Uint8Array(bitmapToColor32(bmp, palette, -1).colors.buffer) };
}

function crop(src, x, y, w, h, { flip = false } = {}) {
  const out = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    const sy = y + (flip ? h - 1 - row : row);
    out.set(src.rgba.subarray((sy * src.w + x) * 4, (sy * src.w + x + w) * 4), row * w * 4);
  }
  return encodePng(w, h, out);
}

const spellbook = decode('SPBK00I0.IMG');
const logbook = decode('LGBK00I0.IMG');
writeOut('img/ui/stone.png', crop(spellbook, 8, 16, 104, 120));
writeOut('img/ui/parchment.png', crop(logbook, 30, 28, 260, 144));
writeOut('img/ui/scroll-top.png', crop(logbook, 0, 0, 320, 14));
writeOut('img/ui/scroll-bottom.png', crop(logbook, 0, 0, 320, 14, { flip: true }));
console.log('ui textures written');
