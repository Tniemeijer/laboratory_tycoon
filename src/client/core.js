// ==================== SHARED RUNTIME CORE ====================
// The G singleton, id allocation, derived stats and the cached nav grid.
// Every system module reads/writes through this — it has no game logic of its own.

import {
    BUILD, UPGRADES, REP_LEVELS, ZONES, UTIL_ELECTRICITY_PER_MACHINE, UTIL_HEATING_PER_TILE, UTIL_LIGHTING_PER_TILE,
    SAMPLE_DECAY_STORED, ROOM_BONUS_CAP
} from './data.js';
import { GRID, buildNav, zoneOwnedTileCount, footTiles } from './grid.js';

export const G = {
    state: null,
    scene: null,
    tool: null,          // null | build-type | 'demolish' | 'rotate'
    ghostRot: 0,
    _nav: null,
    _navVersion: -1,
    onToast: () => {},
    onUIDirty: () => {},
    releaseWorkerJob: null       // wired by systems/staff.js at import time — avoids a staff<->samples import cycle
};

let idc = 1;
export function nid() { return idc++; }
export function resetIdCounter(v) { idc = v || 1; }
export function currentIdCounter() { return idc; }

export function dirtyUI() { if (G.state) G.state.uiRev++; G.onUIDirty(); }

export function nav() {
    if (G._navVersion !== G.state.navVersion) { G._nav = buildNav(G.state); G._navVersion = G.state.navVersion; }
    return G._nav;
}
export function bumpNav() { G.state.navVersion++; }

// ---------- derived stats ----------
export function labLevel() {
    const s = G.state; let lv = 1;
    for (let i = 0; i < REP_LEVELS.length; i++) if (s.reputation >= REP_LEVELS[i]) lv = i + 1;
    return lv;
}
export function repToNext() {
    const lv = labLevel();
    return REP_LEVELS[lv] != null ? REP_LEVELS[lv] : null;
}
export function repMult() { return 1 + 0.2 * G.state.upgrades.marketing; }
export function speedMul() { return Math.pow(0.88, G.state.upgrades.speed); }
export function staffSpeedMul() { return 1 + 0.08 * G.state.upgrades.radio; }
export function cartCapacity() { return 1 + G.state.upgrades.cart; }
// Total fridge/freezer shelf slots across the lab, and how many are currently occupied.
export function coldCapacity() {
    let c = 0;
    for (const e of G.state.equipment) if (BUILD[e.type].kind === 'cold') c += BUILD[e.type].slots || 0;
    return c;
}
export function coldUsed() {
    let n = 0;
    for (const e of G.state.equipment) if (BUILD[e.type].kind === 'cold') n += (e.processing ? e.processing.length : 0);
    return n;
}
export function coldDecayRate() { return SAMPLE_DECAY_STORED * Math.pow(0.85, G.state.upgrades.cold); }
export function maxStaff() { return 3 + G.state.upgrades.staff * 2; }
export function upgradeCost(k) {
    const u = UPGRADES[k];
    return Math.round(u.base * Math.pow(u.mult, G.state.upgrades[k]));
}
function tilesOverlap(a, b) {
    const at = footTiles(a.type, a.tx, a.tz, a.rot), bt = footTiles(b.type, b.tx, b.tz, b.rot);
    return at.some(([x, z]) => bt.some(([bx, bz]) => bx === x && bz === z));
}
// Is `e` standing on at least one tile of a room of this `kind`? Real tile overlap, not mere
// proximity — "inside" means inside.
function insideRoomKind(e, kind) {
    return G.state.equipment.some(room => {
        const def = BUILD[room.type];
        return def.room && def.kind === kind && tilesOverlap(e, room);
    });
}
// Rooms render as floor rather than as a pickable model, so a click lands on the tile, not on the
// room — this is how the UI gets from that tile back to the room covering it (to sell it, or to
// describe it).
export function roomAt(tx, tz) {
    return G.state.equipment.find(e => BUILD[e.type].room &&
        footTiles(e.type, e.tx, e.tz, e.rot).some(([x, z]) => x === tx && z === tz)) || null;
}
// A machine always keeps the caps its BUILD entry lists — it works fine on the open floor, wherever
// you put it. Standing inside a room only ever ADDS to that (ROOM_BONUS_CAP): a Microscope images
// anywhere, and picks up fluorescence while it's in a Dark Room; a Chromatograph analyses anywhere,
// and picks up pharma-grade chromatography while it's in a Cleanroom. Every cap-lookup in the game
// (which stations can serve a step, what the lab owns for the Contracts chain display, …) goes
// through this rather than reading BUILD[e.type].caps directly, so the bonuses show up everywhere.
export function equipCaps(e) {
    let caps = BUILD[e.type].caps || [];
    for (const [kind, grants] of Object.entries(ROOM_BONUS_CAP)) {
        const cap = grants[e.type];
        if (cap && !caps.includes(cap) && insideRoomKind(e, kind)) caps = [...caps, cap];
    }
    return caps;
}
// Work done inside any room is better-controlled work — see ROOM_QUALITY_BONUS in data.js.
export function insideAnyRoom(e) {
    return G.state.equipment.some(room => BUILD[room.type].room && tilesOverlap(e, room));
}
export function ownedCaps() {
    const set = new Set();
    for (const e of G.state.equipment) for (const c of equipCaps(e)) set.add(c);
    return set;
}
export function cleanliness() { return Math.max(0, 100 - Math.min(100, G.state.grime / 6)); }
export function reagentCount(type) { return G.state.reagents.filter(r => r.type === type).length; }
export function ingredientCount(key) { return G.state.ingredients[key] || 0; }
export function ownedTileCount() { return zoneOwnedTileCount(G.state.ownedZones); }

export function utilityBreakdown() {
    const s = G.state;
    const tiles = ownedTileCount();
    const electricity = Math.round(s.equipment.length * UTIL_ELECTRICITY_PER_MACHINE * 10) / 10;
    const heating = Math.round(tiles * UTIL_HEATING_PER_TILE * 10) / 10;
    const lighting = Math.round(tiles * UTIL_LIGHTING_PER_TILE * 10) / 10;
    const total = Math.round((electricity + heating + lighting) * 10) / 10;
    return { electricity, heating, lighting, total };
}

export { GRID };
