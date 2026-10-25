// Decodes the travel map art (TRAV0I00 overworld, FMAP region pages) to PNG, writes the
// overworld region-picker grid, and computes every location dot's page pixel with the same
// law DFU/DFO use (DaggerfallTravelMapWindow.UpdateMapLocationDotsTexture, travelMapWindow.js).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dfo, arena2, loadMaps, writeOut, SITE } from './lib/env.mjs';
import { encodePng } from './lib/png.mjs';

const { ImgFile } = await dfo('src/formats/imgFile.js');
const { DFPalette } = await dfo('src/formats/dfPalette.js');
const { bitmapToColor32 } = await dfo('src/formats/color32Order.js');
const tm = await dfo('src/ui/travel/travelMapWindow.js');
const { OFFSET_LOOKUP, LOCATION_PIXEL_COLOR_INDICES, getRegionMapNames, getRegionMapScale, getPixelColorIndex,
  hasRegionPage, REGION_W, REGION_H } = tm;

const palettes = {};
function palette(name) {
  if (!palettes[name]) {
    const p = new DFPalette();
    p.load(arena2(name), name);
    palettes[name] = p;
  }
  return palettes[name];
}

function decode(name) {
  const img = new ImgFile();
  img.load(arena2(name), name, null);
  const bmp = img.getDFBitmap();
  return { bmp, pal: palette(img.paletteName || 'ART_PAL.COL') };
}

function toRgba(bmp, pal) {
  const c = bitmapToColor32(bmp, pal, -1);
  return new Uint8Array(c.colors.buffer);
}

// Overworld art and the picker grid (each pixel = 128 + region index, else not a region)
const over = decode('TRAV0I00.IMG');
writeOut('img/overworld.png', encodePng(over.bmp.width, over.bmp.height, toRgba(over.bmp, over.pal)));
const picker = decode('TRAV0I01.IMG');
const pick = new Uint8Array(picker.bmp.data.length);
for (let i = 0; i < pick.length; i++) pick[i] = picker.bmp.data[i] >= 128 ? picker.bmp.data[i] - 128 : 255;
writeOut('data/picker.bin', pick);

// Location lookup by map pixel, from the locations build
const locs = JSON.parse(readFileSync(join(SITE, 'data/locations.json'), 'utf8'));
const atPixel = new Map();
for (let i = 0; i < locs.name.length; i++) atPixel.set(locs.py[i] * 1000 + locs.px[i], i);

const maps = await loadMaps();
const fmapPal = palette('FMAP_PAL.COL');
const dotColors = LOCATION_PIXEL_COLOR_INDICES.map(i => {
  const c = fmapPal.get(i);
  return `#${[c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
});

const pages = {};
let dotCount = 0;
for (let region = 0; region < maps.regionCount; region++) {
  if (!maps.getRegion(region) || !hasRegionPage(region)) continue;
  const scale = getRegionMapScale(region);
  pages[region] = getRegionMapNames(region).map(name => {
    const { bmp, pal } = decode(name);
    writeOut(`img/regions/${name.replace('.IMG', '.png')}`, encodePng(bmp.width, bmp.height, toRgba(bmp, pal)));
    const [originX, originY] = OFFSET_LOOKUP[name];
    const dots = [];
    // The same loop as the game: every page texel, offset into a bottom-up texture, times scale
    for (let y = 0; y < REGION_H; y++) {
      for (let x = 0; x < REGION_W; x++) {
        const offset = Math.trunc((((REGION_H - y - 1) * REGION_W) + x) * scale);
        if (offset >= REGION_W * REGION_H) continue;
        if (maps.getPoliticIndex(originX + x, originY + y) - 128 !== region) continue;
        const loc = atPixel.get((originY + y) * 1000 + originX + x);
        if (loc === undefined) continue;
        const colour = getPixelColorIndex(locs.type[loc]);
        if (colour === -1) continue;
        // back from texture offset to a top-down image pixel
        const row = Math.floor(offset / REGION_W), col = offset % REGION_W;
        dots.push([loc, col, REGION_H - 1 - row, colour]);
      }
    }
    dotCount += dots.length;
    return { image: name.replace('.IMG', '.png'), origin: [originX, originY], scale, width: bmp.width, height: bmp.height, dots };
  });
}

writeOut('data/mapdots.json', JSON.stringify({ dotColors, regionWidth: REGION_W, regionHeight: REGION_H, pages }));
console.log(`overworld ${over.bmp.width}x${over.bmp.height}; ${Object.keys(pages).length} regions with pages; ${dotCount} dots`);
