// What a town block's automap byte is drawn as (no DOM, so the build's verify can check it against the models).
export const TOWN_COLOURS = { temple: '#c37d45', shop: '#1855be', tavern: '#307555', house: '#283c45', grounds: '#8a8f78', wall: '#1b1d22', street: '#cfb07a', select: '#f2cd52' };
// the game's own groups (DFO ui/town/townQuarters.js). Bytes outside them - ships, wagons, wells, yards (25, 117,
// 224, 250) and ground flats (251) - are scenery the game's town map leaves off, so they draw as open ground.
// Byte 22 (House5) is a graveyard's or a palace garden's walled grounds with crypts in it, not a row of houses.
export const GROUP_OF_BYTE = (() => {
  const g = new Array(256).fill(null);
  for (const v of [2, 5, 17, 18, 19, 20, 21, 23, 24]) g[v] = 'house';
  g[22] = 'grounds';
  for (const v of [1, 3, 4, 6, 7, 8, 9, 10, 11, 13, 14]) g[v] = 'shop';
  for (const v of [12, 15]) g[v] = 'temple';
  g[16] = 'tavern';
  return g;
})();
