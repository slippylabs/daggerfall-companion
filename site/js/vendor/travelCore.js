// Travel time law, copied verbatim from DFO Online src/systems/travel/travel.js
// (https://github.com/Lattymoy/daggerfall-js-source, MIT, Copyright (c) 2026 Lattymoy), itself a
// port of Daggerfall Unity's TravelTimeCalculator.cs (MIT, Copyright (c) 2009-2023 Daggerfall Workshop).
// Only change: CLIMATES.Ocean and MINUTES_PER_DAY inlined, and seaMult defaults to 1 (no Storm Season).
// tools/verify.mjs checks this file against DFO's own module on thousands of trips.

const OCEAN = 223;
const MINUTES_PER_DAY = 1440;

export const CLIMATE_INDICES = Object.freeze([0, 0, 0, 1, 2, 3, 4, 5, 5, 5]);
export const TERRAIN_MOVEMENT_MODIFIERS = Object.freeze([240, 220, 200, 200, 230, 250]);

export function walkTravelPath(start, end) {
  let px = start.x, py = start.y;
  const dx = end.x - px, dy = end.y - py;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  const furthest = adx <= ady ? ady : adx;
  const sx = dx >= 0 ? 1 : -1;
  const sy = dy >= 0 ? 1 : -1;

  const path = [];
  let moves = 0, inc = 0;
  while (moves < furthest) {
    if (furthest === adx) {
      px += sx;
      inc += ady;
      if (inc > adx) { inc -= adx; py += sy; }
    } else {
      py += sy;
      inc += adx;
      if (inc > ady) { inc -= ady; px += sx; }
    }
    path.push({ x: px, y: py });
    ++moves;
  }
  return path;
}

export function travelPixelMinutes(terrain, transportModifier, {
  travelShip = false, sleepModeInn = false,
} = {}) {
  let thisMove;
  if (terrain === OCEAN) {
    thisMove = travelShip ? 51 : 255;
  } else {
    const idx = CLIMATE_INDICES[terrain - OCEAN];
    thisMove = (((102 * transportModifier) >> 8)
      * (256 - TERRAIN_MOVEMENT_MODIFIERS[idx] + 256)) >> 8;
  }
  if (!sleepModeInn) thisMove = (300 * thisMove) >> 8;
  return thisMove;
}

export function calculateTravelTime(start, end, {
  speedCautious = false, sleepModeInn = false, travelShip = false,
  hasHorse = false, hasCart = false, seaMult = 1,
} = {}, getClimateIndex) {
  const transportModifier = hasHorse ? 128 : hasCart ? 192 : 256;

  let minutes = 0, oceanPixels = 0;
  for (const { x, y } of walkTravelPath(start, end)) {
    const terrain = getClimateIndex(x, y);
    if (terrain === OCEAN) ++oceanPixels;
    const m = travelPixelMinutes(terrain, transportModifier, { travelShip, sleepModeInn });
    minutes += terrain === OCEAN && seaMult !== 1 ? Math.floor(m * seaMult) : m;
  }

  if (!speedCautious) minutes = minutes >> 1;
  return { minutes, oceanPixels };
}

export function calculateTripCost(travelTimeMinutes, oceanPixels, {
  sleepModeInn = false, hasShip = false, travelShip = false, freeTavernRooms = false,
} = {}) {
  const hours = Math.trunc((travelTimeMinutes + 59) / 60);
  let piecesCost = 0;
  if (sleepModeInn && !freeTavernRooms) {
    piecesCost = 5 * Math.trunc((hours - oceanPixels) / 24);
    if (piecesCost < 0) piecesCost = 0;
    piecesCost += 5;
  }
  let totalCost = piecesCost;
  if (oceanPixels > 0 && !hasShip && travelShip) totalCost += 25 * (Math.trunc(oceanPixels / 24) + 1);
  return { piecesCost, totalCost };
}

export const travelDays = (minutes) => Math.trunc((minutes + MINUTES_PER_DAY - 1) / MINUTES_PER_DAY);
