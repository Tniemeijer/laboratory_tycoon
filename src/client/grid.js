// ==================== GRID GEOMETRY ====================
// Pure spatial helpers: no game state lives here, everything takes it as a parameter.

import { BUILD, ZONES } from './data.js';

export const GRID = 16;
const HALF = GRID / 2;
export const CORRIDOR_ROWS = 2;                 // bottom rows: walkable, unbuildable, always owned
export const BUILD_MAX_Z = GRID - CORRIDOR_ROWS - 1;
export const GATE_COLS = [7, 8];

// The break room — a dedicated, walled room in Main Lab, not something players build over. Real
// labs don't let you eat or drink at the bench (contamination rules), so it's genuinely walled off
// from the work floor. It sits in the south-west corner, tucked against the entrance corridor and
// out of the middle of the work floor, and grows as Staff Quarters is upgraded: it starts as a
// two-tile nook with nothing but a coffee machine and gains a row, then furniture, with each level.
// It's an annex bolted onto the *outside* of the building, west of the entrance, on ground
// nothing else can ever use — not a bite out of the work floor. Growing pushes its far wall
// further out into that dead ground, so an upgrade never overwrites anything you've built.
const BREAK_ROOM_TIERS = [
    { x0: 2, z0: 12, w: 2, h: 2 },   // no upgrade — a coffee machine and standing room
    { x0: 1, z0: 12, w: 3, h: 2 },
    { x0: 0, z0: 12, w: 4, h: 2 },
    { x0: 0, z0: 12, w: 4, h: 3 }
];
// The largest it can ever get — the renderer lays floor for this whole patch up front and only
// shows the part currently walled in.
export const BREAK_ROOM_MAX = { x0: 0, z0: 12, w: 4, h: 3 };
export function breakRoom(state) {
    const lv = Math.min((state && state.upgrades ? state.upgrades.staff : 0) || 0, BREAK_ROOM_TIERS.length - 1);
    return { ...BREAK_ROOM_TIERS[lv], level: lv };
}
// Fixed tiles, each with the Staff Quarters level it turns up at, so nothing ever shuffles once
// it's installed — the room grows away westward around them. All clear of the east column, which
// is where the doorway onto the lab floor is.
// The appliances line up along the back (north) wall, in the order they're unlocked, each facing
// out into the room — `rot` is quarter-turns the same way equipment uses them, and 0 faces south,
// which is into the room for anything standing against that wall. That leaves the middle row as a
// clear walkway from the door and the south row free for the table, instead of the whole lot
// sitting in one line across the middle of the floor with the table wedged in a corner.
const BREAK_ROOM_PROPS = [
    { key: 'coffee',  level: 0, tile: [2, 12], rot: 0 },
    { key: 'cooler',  level: 1, tile: [1, 12], rot: 0 },
    { key: 'vending', level: 2, tile: [0, 12], rot: 0 },
    { key: 'table',   level: 3, tile: [1, 14], rot: 0 }
];
export function breakRoomProps(state) {
    const lv = breakRoom(state).level;
    return BREAK_ROOM_PROPS.filter(p => p.level <= lv).map(p => ({ key: p.key, tile: p.tile, rot: p.rot || 0 }));
}
export function inBreakRoom(state, tx, tz) {
    const br = breakRoom(state);
    return tx >= br.x0 && tx < br.x0 + br.w && tz >= br.z0 && tz < br.z0 + br.h;
}
const HANGOUT_OFFSETS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

// ---------- rooms, walls and doorways ----------
// Every walled area in the lab — the break room and each kind of player-built room — is described
// the same way: a set of tiles, walled along every edge that doesn't face more of the same room,
// with exactly one of those edges left open as a doorway. buildNav() turns that into per-edge
// blocking so staff have to walk round to the door instead of straight through a wall, and
// threeScene draws its partitions from the very same data, so what you see is what they path.
const WALL_N = 1, WALL_S = 2, WALL_W = 4, WALL_E = 8;
export const WALL_BITS = { WALL_N, WALL_S, WALL_W, WALL_E };
// dx, dz, the bit on this tile, and the matching bit on the neighbour
export const EDGE_DIRS = [[0, -1, WALL_N, WALL_S], [0, 1, WALL_S, WALL_N], [-1, 0, WALL_W, WALL_E], [1, 0, WALL_E, WALL_W]];
const DOOR_PREF = [[0, 1], [1, 0], [-1, 0], [0, -1]];   // south first — that's where the floor traffic is

export function roomAreas(state) {
    const areas = new Map();
    const add = (kind, x, z) => {
        if (!areas.has(kind)) areas.set(kind, new Set());
        areas.get(kind).add(`${x},${z}`);
    };
    const br = breakRoom(state);
    for (let x = br.x0; x < br.x0 + br.w; x++)
        for (let z = br.z0; z < br.z0 + br.h; z++) add('break', x, z);
    for (const e of state.equipment || []) {
        const b = BUILD[e.type];
        if (!b || !b.room) continue;
        for (const [x, z] of footTiles(e.type, e.tx, e.tz, e.rot)) add(b.kind, x, z);
    }
    return areas;
}
// Flood-fill a tile set into connected runs, so two rooms laid flush read as one bigger room
// with a single way in rather than two boxes with a wall down the middle.
export function roomGroups(tiles) {
    const groups = [];
    const seen = new Set();
    for (const start of [...tiles].sort()) {
        if (seen.has(start)) continue;
        const group = [start];
        seen.add(start);
        for (let i = 0; i < group.length; i++) {
            const [x, z] = group[i].split(',').map(Number);
            for (const [dx, dz] of EDGE_DIRS) {
                const nk = `${x + dx},${z + dz}`;
                if (tiles.has(nk) && !seen.has(nk)) { seen.add(nk); group.push(nk); }
            }
        }
        groups.push(group);
    }
    return groups;
}
// The annex sits outside every purchasable plot, so "is this walkable ground" is broader than
// "is this plot owned" — its own floor counts too.
export function isWalkableGround(state, tx, tz) {
    return isTileOwned(state.ownedZones, tx, tz) || inBreakRoom(state, tx, tz);
}
// Can a scientist actually stand on this tile to come and go through a door here?
function doorwayUsable(state, x, z, roomTiles) {
    if (x < 0 || z < 0 || x >= GRID || z >= GRID) return false;
    if (!isWalkableGround(state, x, z)) return false;
    if (roomTiles.has(`${x},${z}`)) return false;
    for (const e of state.equipment || []) {
        if (BUILD[e.type].room) continue;                    // room floor is fine to stand on
        if (footTiles(e.type, e.tx, e.tz, e.rot).some(([ex, ez]) => ex === x && ez === z)) return false;
    }
    return true;
}
// One doorway per connected run, on the edge that actually opens onto usable floor. Returns null
// for a run that has no such edge at all — a sealed room, which canPlace() refuses to create.
export function pickDoorway(state, tiles, group) {
    let best = null, bestRank = Infinity;
    for (const key of [...group].sort()) {
        const [x, z] = key.split(',').map(Number);
        DOOR_PREF.forEach(([dx, dz], i) => {
            if (tiles.has(`${x + dx},${z + dz}`)) return;               // interior edge
            if (!doorwayUsable(state, x + dx, z + dz, tiles)) return;
            if (i < bestRank) { bestRank = i; best = `${key}|${dx},${dz}`; }
        });
    }
    return best;
}
export function roomDoorways(state, tiles) {
    const doors = new Set();
    for (const group of roomGroups(tiles)) {
        const d = pickDoorway(state, tiles, group);
        if (d) doors.add(d);
    }
    return doors;
}

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

// A "room" (Cleanroom, Dark Room — see BUILD[type].room) is floor, not furniture: it never
// collides with machines in either direction. Equipment drops onto its tiles like bare ground
// (that's the whole point — a Scale only works once it's standing inside one), and a room can
// equally be laid down over machines already sitting there, so you can wall off the microscope
// you've had since day one instead of demolishing and rebuilding it inside. Rooms do collide with
// each other, though: one tile can't be both light-sealed and sterile.
function tileBlocked(equipment, tx, tz, ignoreId, placingRoom) {
    for (const e of equipment) {
        if (e.id === ignoreId) continue;
        if (!footTiles(e.type, e.tx, e.tz, e.rot).some(([x, z]) => x === tx && z === tz)) continue;
        if (!!BUILD[e.type].room !== placingRoom) continue;   // floor vs. furniture — different layers
        return true;
    }
    return false;
}

export function canPlace(state, type, tx, tz, rot, ignoreId) {
    const b = BUILD[type];
    if (!b) return { ok: false, why: 'unknown' };
    const foot = footTiles(type, tx, tz, rot);
    for (const [x, z] of foot) {
        if (x < 0 || z < 0 || x >= GRID || z > BUILD_MAX_Z) return { ok: false, why: 'out of bounds' };
        if (!isTileOwned(state.ownedZones, x, z)) return { ok: false, why: 'unowned land' };
        if (inBreakRoom(state, x, z)) return { ok: false, why: 'break room' };
        if (tileBlocked(state.equipment, x, z, ignoreId, !!b.room)) return { ok: false, why: 'blocked' };
    }
    // A room's walls really do block movement, so one with nowhere to put a door would seal
    // whatever ends up inside it away from the rest of the lab. Check the run it would belong to
    // (itself plus any same-kind rooms it merges with) still has an edge opening onto usable floor.
    if (b.room) {
        const tiles = new Set(foot.map(([x, z]) => `${x},${z}`));
        for (const e of state.equipment) {
            if (e.id === ignoreId || !BUILD[e.type].room || BUILD[e.type].kind !== b.kind) continue;
            for (const [x, z] of footTiles(e.type, e.tx, e.tz, e.rot)) tiles.add(`${x},${z}`);
        }
        const mine = `${foot[0][0]},${foot[0][1]}`;
        const group = roomGroups(tiles).find(gp => gp.includes(mine));
        if (group && !pickDoorway(state, tiles, group)) return { ok: false, why: 'no room for a doorway' };
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
// Idle staff hang out in the break room instead of loitering by the front door. Spread around its
// middle, and never on a tile something's standing on — the room is small at first, so a worker
// parked on the coffee machine's tile would be very obvious.
export function restTile(state, i) {
    const br = breakRoom(state);
    const taken = new Set(breakRoomProps(state).map(p => p.tile.join(',')));
    const cx = br.x0 + Math.floor((br.w - 1) / 2), cz = br.z0 + Math.floor((br.h - 1) / 2);
    const spots = [[cx, cz], ...HANGOUT_OFFSETS.map(([dx, dz]) => [cx + dx, cz + dz])]
        .filter(([x, z]) => x >= br.x0 && x < br.x0 + br.w && z >= br.z0 && z < br.z0 + br.h
                         && !taken.has(`${x},${z}`));
    if (!spots.length) return [cx, cz];
    return spots[i % spots.length];
}

export function buildNav(state) {
    const g = new Uint8Array(GRID * GRID);
    for (let tz = 0; tz < GRID; tz++)
        for (let tx = 0; tx < GRID; tx++)
            if (!isWalkableGround(state, tx, tz)) g[tz * GRID + tx] = 1;
    // Only the tiles the break room's furniture actually stands on block movement — the rest of
    // its floor stays walkable so staff can mill about in there.
    for (const p of breakRoomProps(state)) g[p.tile[1] * GRID + p.tile[0]] = 1;
    for (const e of state.equipment) {
        if (BUILD[e.type].room) continue;   // a room is floor, not an obstacle — equipment placed inside it still blocks normally
        for (const [x, z] of footTiles(e.type, e.tx, e.tz, e.rot))
            if (x >= 0 && z >= 0 && x < GRID && z < GRID) g[z * GRID + x] = 1;
    }
    // Partition walls block the edge between two tiles rather than a tile itself, so a room costs
    // no floor space to wall off and staff simply have to come in through the door. Carried on the
    // nav array itself so it can't be passed around half-applied — see aStar().
    const walls = new Uint8Array(GRID * GRID);
    for (const [, tiles] of roomAreas(state)) {
        const doors = roomDoorways(state, tiles);
        for (const key of tiles) {
            const [x, z] = key.split(',').map(Number);
            for (const [dx, dz, bit, opp] of EDGE_DIRS) {
                if (tiles.has(`${x + dx},${z + dz}`)) continue;          // interior — no wall here
                if (doors.has(`${key}|${dx},${dz}`)) continue;           // left open as the way in
                if (x >= 0 && z >= 0 && x < GRID && z < GRID) walls[z * GRID + x] |= bit;
                const nx = x + dx, nz = z + dz;
                if (nx >= 0 && nz >= 0 && nx < GRID && nz < GRID) walls[nz * GRID + nx] |= opp;
            }
        }
    }
    g.walls = walls;
    return g;
}
