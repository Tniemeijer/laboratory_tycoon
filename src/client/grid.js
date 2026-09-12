// ==================== GRID GEOMETRY ====================
// Pure spatial helpers: no game state lives here, everything takes it as a parameter.

import { BUILD, ZONES } from './data.js';

export const GRID = 16;
const HALF = GRID / 2;
export const CORRIDOR_ROWS = 2;                 // bottom rows: walkable, unbuildable, always owned
export const BUILD_MAX_Z = GRID - CORRIDOR_ROWS - 1;
export const GATE_COLS = [7, 8];

// The break room — a fixed, dedicated room in Main Lab, not something players build over. Real
// labs don't let you eat or drink at the bench (contamination rules), so this is genuinely walled
// off from the work floor rather than just being a machine dropped in the open. Sits in the
// entrance hall near the gate, with one open side (east) as its doorway.
export const BREAK_ROOM = { x0: 5, z0: 10, w: 3, h: 3 };
export const COFFEE_TILE = [5, 10];
export const WATER_COOLER_TILE = [7, 10];
export const VENDING_TILE = [5, 12];
export const TABLE_TILE = [7, 12];
export const BREAK_ROOM_HANGOUT = [6, 11];   // center of the room — idle staff cluster around this
const BREAK_ROOM_FURNITURE = [COFFEE_TILE, WATER_COOLER_TILE, VENDING_TILE, TABLE_TILE];
function inBreakRoom(tx, tz) {
    return tx >= BREAK_ROOM.x0 && tx < BREAK_ROOM.x0 + BREAK_ROOM.w &&
           tz >= BREAK_ROOM.z0 && tz < BREAK_ROOM.z0 + BREAK_ROOM.h;
}
const HANGOUT_OFFSETS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

// The nav grid only tracks per-tile walkability, not per-edge walls (same limitation noted for the
// main building's walls in threeScene.js) — so the break room's rendered partition walls need real
// tile-level blocking on the far side of each wall line, or a worker just paths straight across it.
// North/south/west get one tile of blocked "wall" ring right outside the room; east stays fully open
// on both sides since that edge is the doorway.
const BREAK_ROOM_WALL_RING = [];
for (let x = BREAK_ROOM.x0; x < BREAK_ROOM.x0 + BREAK_ROOM.w; x++) {
    BREAK_ROOM_WALL_RING.push([x, BREAK_ROOM.z0 - 1]);              // north
    BREAK_ROOM_WALL_RING.push([x, BREAK_ROOM.z0 + BREAK_ROOM.h]);   // south
}
for (let z = BREAK_ROOM.z0 - 1; z <= BREAK_ROOM.z0 + BREAK_ROOM.h; z++) {
    BREAK_ROOM_WALL_RING.push([BREAK_ROOM.x0 - 1, z]);              // west (includes NW/SW corners)
}
const _wallRingKeys = new Set(BREAK_ROOM_WALL_RING.map(([x, z]) => `${x},${z}`));
function inBreakRoomWallRing(tx, tz) { return _wallRingKeys.has(`${tx},${tz}`); }

export function tileToWorld(tx, tz) { return { x: tx - HALF + 0.5, z: tz - HALF + 0.5 }; }
export function worldToTile(x, z) { return { tx: Math.floor(x + HALF), tz: Math.floor(z + HALF) }; }

export function footTiles(type, tx, tz, rot) {
    const [fw, fh] = BUILD[type].foot;
    const w = rot % 2 ? fh : fw;
    const h = rot % 2 ? fw : fh;
    const tiles = [];
    for (let dx = 0; dx < w; dx++) for (let dz = 0; dz < h; dz++) tiles.push([tx + dx, tz + dz]);
    return tiles;
}
export function footDims(type, rot) {
    const [fw, fh] = BUILD[type].foot;
    return rot % 2 ? [fh, fw] : [fw, fh];
}

export function zoneAt(tx, tz) {
    for (const z of ZONES) if (tx >= z.x0 && tx < z.x0 + z.w && tz >= z.z0 && tz < z.z0 + z.h) return z;
    return null;
}

// The entrance corridor only runs as wide as the room that actually has the gate in its wall —
// walking past that width would mean stepping through a wall that has no gap there.
let _gateRangeCache = null;
export function gateXRange() {
    if (_gateRangeCache) return _gateRangeCache;
    const z = zoneAt(GATE_COLS[0], BUILD_MAX_Z);
    _gateRangeCache = z ? [z.x0, z.x0 + z.w - 1] : [0, GRID - 1];
    return _gateRangeCache;
}

export function isTileOwned(ownedZones, tx, tz) {
    if (tz > BUILD_MAX_Z) {
        const [lo, hi] = gateXRange();
        return tx >= lo && tx <= hi;              // entrance corridor is free, but only this wide
    }
    const z = zoneAt(tx, tz);
    return !!z && ownedZones.includes(z.id);
}
export function zoneOwnedTileCount(ownedZones) {
    let n = 0;
    for (const z of ZONES) if (ownedZones.includes(z.id)) n += z.w * z.h;
    return n;
}

// A "room" (Cleanroom, Dark Room — see BUILD[type].room) is floor, not furniture: normal
// equipment can be placed on its tiles same as bare ground, since that's the whole point (a Scale
// only works once it's wheeled inside one). The reverse isn't true — a room still can't be placed
// on top of existing equipment or another room, so this only waives the collision one direction.
function tileBlocked(equipment, tx, tz, ignoreId, placingRoom) {
    for (const e of equipment) {
        if (e.id === ignoreId) continue;
        if (!footTiles(e.type, e.tx, e.tz, e.rot).some(([x, z]) => x === tx && z === tz)) continue;
        if (!placingRoom && BUILD[e.type].room) continue;   // ok: normal equipment going inside an existing room
        return true;
    }
    return false;
}

export function canPlace(state, type, tx, tz, rot, ignoreId) {
    const b = BUILD[type];
    if (!b) return { ok: false, why: 'unknown' };
    for (const [x, z] of footTiles(type, tx, tz, rot)) {
        if (x < 0 || z < 0 || x >= GRID || z > BUILD_MAX_Z) return { ok: false, why: 'out of bounds' };
        if (!isTileOwned(state.ownedZones, x, z)) return { ok: false, why: 'unowned land' };
        if (inBreakRoom(x, z) || inBreakRoomWallRing(x, z)) return { ok: false, why: 'break room' };
        if (tileBlocked(state.equipment, x, z, ignoreId, !!b.room)) return { ok: false, why: 'blocked' };
    }
    return { ok: true };
}

export function gateWorld() { const w = tileToWorld(GATE_COLS[0], GRID - 1); return { x: w.x + 0.5, z: w.z }; }
export function queueTile(i) {
    // fill corridor row (GRID-2) left→right within the gate room's width, skipping the gate
    // columns themselves, then spill onto row GRID-1
    const [lo, hi] = gateXRange();
    let n = i, row = GRID - 2;
    for (let x = lo; x <= hi; x++) {
        if (GATE_COLS.includes(x)) continue;
        if (n === 0) return [x, row];
        n--;
    }
    row = GRID - 1;
    for (let x = lo; x <= hi; x++) { if (n === 0) return [x, row]; n--; }
    return [lo, GRID - 1];
}
// Idle staff hang out in the middle of the break room instead of loitering by the front door.
export function restTile(i) {
    const [dx, dz] = HANGOUT_OFFSETS[i % HANGOUT_OFFSETS.length];
    return [BREAK_ROOM_HANGOUT[0] + dx, BREAK_ROOM_HANGOUT[1] + dz];
}

export function buildNav(state) {
    const g = new Uint8Array(GRID * GRID);
    for (let tz = 0; tz < GRID; tz++)
        for (let tx = 0; tx < GRID; tx++)
            if (!isTileOwned(state.ownedZones, tx, tz)) g[tz * GRID + tx] = 1;
    // Only the tiles actual furniture sits on block movement — the rest of the break room floor
    // stays walkable so staff can stand around in it.
    for (const [fx, fz] of BREAK_ROOM_FURNITURE) g[fz * GRID + fx] = 1;
    for (const [rx, rz] of BREAK_ROOM_WALL_RING)
        if (rx >= 0 && rz >= 0 && rx < GRID && rz < GRID) g[rz * GRID + rx] = 1;
    for (const e of state.equipment) {
        if (BUILD[e.type].room) continue;   // a room is floor, not an obstacle — equipment placed inside it still blocks normally
        for (const [x, z] of footTiles(e.type, e.tx, e.tz, e.rot))
            if (x >= 0 && z >= 0 && x < GRID && z < GRID) g[z * GRID + x] = 1;
    }
    return g;
}
