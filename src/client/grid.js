// ==================== GRID GEOMETRY ====================
// Pure spatial helpers: no game state lives here, everything takes it as a parameter.

import { BUILD, ZONES, ROOM_DOOR_REQ } from './data.js';

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
// nothing else can ever use, not a bite out of the work floor. Growing pushes its far wall
// further out into that dead ground, so an upgrade never overwrites anything you've built.
// ---------- annexes ----------
// Two rooms in the lab aren't built by the player and can't be built over: the break room and the
// stockroom. Both work the same way and share every bit of machinery below — a tiered rectangle
// bolted onto the *outside* of the building, on dead ground beside the entrance that no plot will
// ever use, walled off with one automatic doorway onto the work floor, growing outward with an
// upgrade so levelling up never overwrites anything you've built.
//
//   break  — Staff Quarters. Starts as a nook with a coffee machine, gains floor and furniture.
//   stock  — Stockroom. Starts as a small rack by the door, gains racking and shelf space.
//
// They sit either side of the entrance corridor: break room west, stockroom east.
const ANNEXES = {
    break: {
        upgrade: 'staff',
        max: { x0: 0, z0: 12, w: 4, h: 3 },
        tiers: [
            { x0: 2, z0: 12, w: 2, h: 2 },   // no upgrade. A coffee machine and standing room
            { x0: 1, z0: 12, w: 3, h: 2 },
            { x0: 0, z0: 12, w: 4, h: 2 },
            { x0: 0, z0: 12, w: 4, h: 3 }
        ],
        // Fixed tiles, each with the level it turns up at, so nothing ever shuffles once it's
        // installed — the room grows away around them. All clear of the column nearest the
        // corridor, which is where the doorway onto the lab floor is. The appliances line the back
        // wall in unlock order, each facing into the room (`rot` 0 faces south), leaving the middle
        // row as a walkway from the door and the south row free for the table.
        props: [
            { key: 'coffee',  level: 0, tile: [2, 12], rot: 0 },
            { key: 'cooler',  level: 1, tile: [1, 12], rot: 0 },
            { key: 'vending', level: 2, tile: [0, 12], rot: 0 },
            { key: 'table',   level: 3, tile: [1, 14], rot: 0 }
        ]
    },
    stock: {
        upgrade: 'storage',
        // The whole side facing the work floor is open, not a single door. Every delivery is
        // carried in by hand, so one doorway tile becomes a bottleneck the moment two people are
        // stocking at once: they pile into the same square, shove each other about and crawl.
        // A loading bay with a wide mouth is also what a stockroom actually looks like, whereas
        // the break room keeps its single door (you don't want the lab open onto the coffee).
        wideOpening: true,
        max: { x0: 12, z0: 12, w: 4, h: 3 },
        tiers: [
            { x0: 12, z0: 12, w: 2, h: 2 },   // no upgrade — one rack by the door
            { x0: 12, z0: 12, w: 3, h: 2 },
            { x0: 12, z0: 12, w: 4, h: 2 },
            { x0: 12, z0: 12, w: 4, h: 3 },
            { x0: 12, z0: 12, w: 4, h: 3 }    // top level racks the same floor out further
        ],
        // Racking along the back (north) wall, then the far end. The x=12 column is left entirely
        // clear on purpose: it's the only side of this annex that borders the work floor, so it's
        // where the doorway has to go, and a rack standing on it would wall the room off from the
        // lab completely. Same reasoning as the break room keeping its own door column free.
        props: [
            { key: 'rack', level: 0, tile: [13, 12], rot: 0 },
            { key: 'rack', level: 1, tile: [14, 12], rot: 0 },
            { key: 'rack', level: 2, tile: [15, 12], rot: 0 },
            { key: 'rack', level: 3, tile: [15, 14], rot: 0 },
            { key: 'rack', level: 4, tile: [14, 14], rot: 0 }
        ]
    }
};
export const ANNEX_KINDS = Object.keys(ANNEXES);
// The largest each can ever get — the renderer lays floor for the whole patch up front and only
// shows the part currently walled in.
export function annexMax(kind) { return ANNEXES[kind].max; }
export function annexLevel(state, kind) {
    const a = ANNEXES[kind];
    const lv = (state && state.upgrades ? state.upgrades[a.upgrade] : 0) || 0;
    return Math.min(lv, a.tiers.length - 1);
}
export function annexRect(state, kind) {
    const lv = annexLevel(state, kind);
    return { ...ANNEXES[kind].tiers[lv], level: lv };
}
export function annexProps(state, kind) {
    const lv = annexLevel(state, kind);
    return ANNEXES[kind].props.filter(p => p.level <= lv).map(p => ({ key: p.key, tile: p.tile, rot: p.rot || 0 }));
}
function inRect(r, tx, tz) { return tx >= r.x0 && tx < r.x0 + r.w && tz >= r.z0 && tz < r.z0 + r.h; }
export function inAnnex(state, kind, tx, tz) { return inRect(annexRect(state, kind), tx, tz); }
export function inAnyAnnex(state, tx, tz) { return ANNEX_KINDS.some(k => inAnnex(state, k, tx, tz)); }
// Is this tile inside the *maximum* extent of any annex? Used by the building shell and the floor,
// both of which have to account for ground the room hasn't grown into yet.
export function inAnnexFootprint(tx, tz) { return ANNEX_KINDS.some(k => inRect(ANNEXES[k].max, tx, tz)); }

// Kept as named wrappers: the break room is referenced by name all over the renderer and the
// staff AI, and reading `breakRoom(state)` there says more than `annexRect(state, 'break')`.
export function breakRoom(state) { return annexRect(state, 'break'); }
export function breakRoomProps(state) { return annexProps(state, 'break'); }
export function inBreakRoom(state, tx, tz) { return inAnnex(state, 'break', tx, tz); }
export function stockRoom(state) { return annexRect(state, 'stock'); }
export function inStockRoom(state, tx, tz) { return inAnnex(state, 'stock', tx, tz); }
export const BREAK_ROOM_MAX = ANNEXES.break.max;

const HANGOUT_OFFSETS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

// ---------- rooms, walls and doorways ----------
// Every walled area in the lab. The break room and each kind of player-built room. Is described
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
    for (const kind of ANNEX_KINDS) {
        const r = annexRect(state, kind);
        for (let x = r.x0; x < r.x0 + r.w; x++)
            for (let z = r.z0; z < r.z0 + r.h; z++) add(kind, x, z);
    }
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
// "is this plot owned". Its own floor counts too.
export function isWalkableGround(state, tx, tz) {
    return isTileOwned(state.ownedZones, tx, tz) || inAnyAnnex(state, tx, tz);
}
// Can a scientist actually stand on this tile to come and go through a door here?
function doorwayUsable(state, x, z, roomTiles) {
    if (x < 0 || z < 0 || x >= GRID || z >= GRID) return false;
    if (!isWalkableGround(state, x, z)) return false;
    if (roomTiles.has(`${x},${z}`)) return false;
    for (const e of state.equipment || []) {
        if (BUILD[e.type].room || BUILD[e.type].door || BUILD[e.type].mount) continue;   // floor, doorways and wall fittings are fine to stand on
        if (footTiles(e.type, e.tx, e.tz, e.rot).some(([ex, ez]) => ex === x && ez === z)) return false;
    }
    return true;
}
// Which way a door faces, by rotation. The same mapping the models and staff approach code use,
// where 0 is south.
export const DOOR_FACING = [[0, 1], [-1, 0], [0, -1], [1, 0]];
export function doorPieces(state) {
    return (state.equipment || []).filter(e => BUILD[e.type] && BUILD[e.type].door);
}
// Where a given door actually opens: the tile it stands on, and the edge it faces.
export function doorOpening(e) {
    const [dx, dz] = DOOR_FACING[(e.rot || 0) % 4];
    return { x: e.tx, z: e.tz, dx, dz, kind: BUILD[e.type].door };
}
// Is this door good enough for this kind of room? An airlock satisfies everything; a plain door
// only satisfies rooms that don't have to hold an atmosphere.
export function doorSatisfies(doorKind, roomKind) {
    const need = ROOM_DOOR_REQ[roomKind] || 'door';
    return doorKind === 'airlock' || need === 'door';
}
// The openings in a given room's walls: every placed door standing on one of its tiles and facing
// out of it. Unlike the old auto-picked doorway, a room with nothing placed simply has no way in —
// which is the player's problem to notice, and why sealedRooms() exists to tell them.
export function roomDoorways(state, tiles, kind) {
    const doors = new Set();
    for (const e of doorPieces(state)) {
        const o = doorOpening(e);
        if (!tiles.has(`${o.x},${o.z}`)) continue;                       // not in this room
        if (tiles.has(`${o.x + o.dx},${o.z + o.dz}`)) continue;          // faces further into it
        if (kind && !doorSatisfies(o.kind, kind)) continue;              // not a good enough door
        doors.add(`${o.x},${o.z}|${o.dx},${o.dz}`);
    }
    return doors;
}
// The break room is the one area the player doesn't build, so it keeps an automatic doorway rather
// than needing a door placed in it: whichever edge opens onto usable floor, preferring the side the
// traffic comes from.
export function annexDoorways(state, kind, tiles) {
    const doors = new Set();
    // A doorway is no use in a tile you can't stand in. The annex props are nav obstacles, so a
    // door picked on a tile with a rack (or a vending machine) on it seals the room off entirely,
    // which is exactly what happened when the stockroom's racking reached its door column.
    const blocked = new Set(ANNEX_KINDS.flatMap(k => annexProps(state, k).map(p => p.tile.join(','))));
    const wide = !!(ANNEXES[kind] && ANNEXES[kind].wideOpening);
    for (const group of roomGroups(tiles)) {
        let best = null, bestRank = Infinity;
        for (const key of [...group].sort()) {
            if (blocked.has(key)) continue;
            const [x, z] = key.split(',').map(Number);
            DOOR_PREF.forEach(([dx, dz], i) => {
                if (tiles.has(`${x + dx},${z + dz}`)) return;
                if (!doorwayUsable(state, x + dx, z + dz, tiles)) return;
                // A wide-mouthed annex opens every edge that faces usable floor, so a queue of
                // people carrying crates can spread out instead of funnelling through one square.
                if (wide) { doors.add(`${key}|${dx},${dz}`); return; }
                if (i < bestRank) { bestRank = i; best = `${key}|${dx},${dz}`; }
            });
        }
        if (!wide && best) doors.add(best);
    }
    return doors;
}
// Kept for the renderer and nav, which both ask about the break room by name.
export function breakRoomDoorway(state, tiles) { return annexDoorways(state, 'break', tiles); }

// Connected runs of room that have no usable way in, for warning the player about.
export function sealedRooms(state) {
    const out = [];
    for (const [kind, tiles] of roomAreas(state)) {
        if (ANNEX_KINDS.includes(kind)) continue;                        // annexes have their own fixed doorway
        const doors = roomDoorways(state, tiles, kind);
        for (const group of roomGroups(tiles)) {
            const hasDoor = [...doors].some(d => {
                const [key, dir] = d.split('|');
                const [dx, dz] = dir.split(',').map(Number);
                const [x, z] = key.split(',').map(Number);
                return group.includes(key) && doorwayUsable(state, x + dx, z + dz, tiles);
            });
            if (!hasDoor) out.push({ kind, tiles: group });
        }
    }
    return out;
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

// A "room" (Cleanroom, Dark Room. See BUILD[type].room) is floor, not furniture: it never
// collides with machines in either direction. Equipment drops onto its tiles like bare ground
// (that's the whole point — a Scale only works once it's standing inside one), and a room can
// equally be laid down over machines already sitting there, so you can wall off the microscope
// you've had since day one instead of demolishing and rebuilding it inside. Rooms do collide with
// each other, though: one tile can't be both light-sealed and sterile.
function tileBlocked(equipment, tx, tz, ignoreId, placingRoom) {
    for (const e of equipment) {
        if (e.id === ignoreId) continue;
        if (BUILD[e.type].mount) continue;                   // hangs above the tile. See mountBlocked()
        if (!footTiles(e.type, e.tx, e.tz, e.rot).some(([x, z]) => x === tx && z === tz)) continue;
        if (!!BUILD[e.type].room !== placingRoom) continue;   // floor vs. furniture. Different layers
        return true;
    }
    return false;
}
// A door stands in a room's wall, so it shares that tile with the room floor by design; what it
// can't share is that tile with another door or a machine.
function doorBlocked(equipment, tx, tz, ignoreId) {
    return equipment.some(e => e.id !== ignoreId && !BUILD[e.type].room &&
        footTiles(e.type, e.tx, e.tz, e.rot).some(([x, z]) => x === tx && z === tz));
}
// A wall fitting hangs well above head height on the wall of its tile and takes up no floor at
// all, so unlike a door it happily shares a tile with whatever is standing there, that's the
// point of mounting it rather than parking it on the floor. The only things it can't share with
// are another fitting and a doorway, which both want the same piece of wall.
function mountBlocked(equipment, tx, tz, ignoreId) {
    return equipment.some(e => e.id !== ignoreId && (BUILD[e.type].mount || BUILD[e.type].door) &&
        footTiles(e.type, e.tx, e.tz, e.rot).some(([x, z]) => x === tx && z === tz));
}

// Anything wall-mounted (a fire alarm) has to actually have a wall to hang on: either the
// building's own shell — the edge of the buildable area, or a boundary with ground you don't own —
// or the partition of a room it's standing against. Checked as "is at least one of my four edges
// a wall", which is exactly what the renderer draws.
// Where the building's outer shell actually stands. This is the single source of truth for it:
// threeScene draws its wall segments from this and placement reads it, so a fitting can never be
// hung on a stretch of wall that isn't drawn. Note what is NOT a wall here — a plot you haven't
// bought yet is still *inside* the shell, just unbought land, so the boundary with one is open
// floor with nothing to hang anything on.
export function isShellWall(tx, tz) {
    if (tx < 0 || tx >= GRID || tz < 0) return true;
    // The annexes are bolted onto the side, so the shell doesn't close across where they meet the
    // building — each one's own partition wall, with the doorway in it, is the boundary there.
    if (inAnnexFootprint(tx, tz)) return false;
    if (tz === BUILD_MAX_Z + 1) {                                   // entrance row
        const [lo, hi] = gateXRange();
        return tx < lo || tx > hi;                                  // open for the gate room's width
    }
    if (tz > BUILD_MAX_Z + 1) return false;
    return !zoneAt(tx, tz);
}
// Wall fittings hang on the outer shell only. Room partitions are half-height (0.85 against the
// shell's 1.60) and a fitting mounted high enough to clear the machines would hang in the air
// above one, so they don't count — which is also why this doesn't look at rooms at all.
function isWallEdge(tx, tz, dx, dz) { return isShellWall(tx + dx, tz + dz); }
export function wallAdjacent(state, tx, tz) {
    return EDGE_DIRS.some(([dx, dz]) => isWallEdge(tx, tz, dx, dz));
}
// Which way a wall fitting on this tile should face. A fitting hangs on a wall, so its rotation
// isn't the player's to get wrong: it's decided by where the wall actually is. Snapped at
// placement (and again on a move) rather than only at render time, so the saved rotation always
// matches what's drawn. Otherwise a fitting whose wall later disappeared would go on facing a
// direction with nothing behind it, which is exactly what "floating in mid-air" looks like.
// Keeps the requested rotation when that side happens to be a wall, so a player who deliberately
// picked one of two walls on a corner tile gets the one they picked.
export function wallFacing(state, tx, tz, preferRot) {
    const order = [((preferRot || 0) % 4 + 4) % 4, 0, 1, 2, 3];
    for (const rot of order) {
        const [dx, dz] = DOOR_FACING[rot];
        if (isWallEdge(tx, tz, dx, dz)) return rot;
    }
    return preferRot || 0;
}
// Where staff line up when the building is evacuated: out on the pavement past the front door,
// well clear of anything that's alight inside.
export function musterTile(i) {
    const [lo, hi] = gateXRange();
    const n = Math.max(1, hi - lo + 1);
    return [lo + (i % n), GRID - 1];
}

export function canPlace(state, type, tx, tz, rot, ignoreId) {
    const b = BUILD[type];
    if (!b) return { ok: false, why: 'unknown' };
    const foot = footTiles(type, tx, tz, rot);
    for (const [x, z] of foot) {
        if (x < 0 || z < 0 || x >= GRID || z > BUILD_MAX_Z) return { ok: false, why: 'out of bounds' };
        // Annexes are checked before ownership: they sit outside every purchasable plot, so the
        // ownership test would otherwise answer "unowned land" for the break room and the
        // stockroom — technically true, but it reads as "buy this plot" for ground that is never
        // for sale.
        if (inBreakRoom(state, x, z)) return { ok: false, why: 'the break room' };
        if (inStockRoom(state, x, z)) return { ok: false, why: 'the stockroom' };
        if (!isTileOwned(state.ownedZones, x, z)) return { ok: false, why: 'unowned land' };
        const clash = b.mount ? mountBlocked(state.equipment, x, z, ignoreId)
                    : b.door  ? doorBlocked(state.equipment, x, z, ignoreId)
                              : tileBlocked(state.equipment, x, z, ignoreId, !!b.room);
        if (clash) return { ok: false, why: 'blocked' };
    }
    // A ceiling fitting only needs floor beneath it; a wall fitting needs a wall to hang on.
    if (b.mount && !b.ceiling && !wallAdjacent(state, tx, tz)) return { ok: false, why: 'needs an outside wall to hang on' };
    // A doorway has to actually be in a wall: it goes on one of the room's own tiles and opens
    // outward, and it has to be good enough for what that room is holding in.
    if (b.door) {
        const [tx0, tz0] = foot[0];
        const areas = roomAreas(state);
        let kind = null, tiles = null;
        for (const [k, set] of areas) if (set.has(`${tx0},${tz0}`)) { kind = k; tiles = set; }
        if (!kind || kind === 'break') return { ok: false, why: 'must go on a room tile' };
        const [dx, dz] = DOOR_FACING[(rot || 0) % 4];
        if (tiles.has(`${tx0 + dx},${tz0 + dz}`)) return { ok: false, why: 'faces into the room — rotate it' };
        if (!doorSatisfies(b.door, kind)) return { ok: false, why: 'this room needs an airlock' };
        if (!doorwayUsable(state, tx0 + dx, tz0 + dz, tiles)) return { ok: false, why: 'opens onto nothing' };
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
// middle, and never on a tile something's standing on. The room is small at first, so a worker
// parked on the coffee machine's tile would be very obvious.
// Somewhere inside the stockroom to set a crate down: any floor tile the racking isn't on.
// Spread across them so two people unloading don't stand in each other's models.
export function stockTile(state, i) {
    const r = annexRect(state, 'stock');
    const taken = new Set(annexProps(state, 'stock').map(p => p.tile.join(',')));
    const spots = [];
    for (let z = r.z0; z < r.z0 + r.h; z++)
        for (let x = r.x0; x < r.x0 + r.w; x++)
            if (!taken.has(`${x},${z}`)) spots.push([x, z]);
    if (!spots.length) return [r.x0, r.z0];
    return spots[i % spots.length];
}
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
    for (const kind of ANNEX_KINDS)
        for (const p of annexProps(state, kind)) g[p.tile[1] * GRID + p.tile[0]] = 1;
    for (const e of state.equipment) {
        // Floor, doorways and wall-mounted kit are all things you walk through or past, not round.
        if (BUILD[e.type].room || BUILD[e.type].door || BUILD[e.type].mount) continue;
        for (const [x, z] of footTiles(e.type, e.tx, e.tz, e.rot))
            if (x >= 0 && z >= 0 && x < GRID && z < GRID) g[z * GRID + x] = 1;
    }
    // Partition walls block the edge between two tiles rather than a tile itself, so a room costs
    // no floor space to wall off and staff simply have to come in through the door. Carried on the
    // nav array itself so it can't be passed around half-applied. See aStar().
    const walls = new Uint8Array(GRID * GRID);
    for (const [kind, tiles] of roomAreas(state)) {
        const doors = ANNEX_KINDS.includes(kind) ? annexDoorways(state, kind, tiles) : roomDoorways(state, tiles, kind);
        for (const key of tiles) {
            const [x, z] = key.split(',').map(Number);
            for (const [dx, dz, bit, opp] of EDGE_DIRS) {
                if (tiles.has(`${x + dx},${z + dz}`)) continue;          // interior, no wall here
                if (doors.has(`${key}|${dx},${dz}`)) continue;           // left open as the way in
                if (x >= 0 && z >= 0 && x < GRID && z < GRID) walls[z * GRID + x] |= bit;
                const nx = x + dx, nz = z + dz;
                if (nx >= 0 && nz >= 0 && nx < GRID && nz < GRID) walls[nz * GRID + nx] |= opp;
            }
        }
    }
    // A containment breach seals the room: nobody walks in there again until the disinfection
    // crew has been through, so its tiles come out of the nav grid entirely rather than just
    // being discouraged.
    for (const key of (state.outbreak ? state.outbreak.tiles : [])) {
        const [x, z] = key.split(',').map(Number);
        if (x >= 0 && z >= 0 && x < GRID && z < GRID) g[z * GRID + x] = 1;
    }
    g.walls = walls;
    return g;
}
