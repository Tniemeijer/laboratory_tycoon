// ==================== SHARED RUNTIME CORE ====================
// The G singleton, id allocation, derived stats and the cached nav grid.
// Every system module reads/writes through this — it has no game logic of its own.

import {
    BUILD, UPGRADES, REP_LEVELS, ZONES, UTIL_ELECTRICITY_PER_MACHINE, UTIL_HEATING_PER_TILE, UTIL_LIGHTING_PER_TILE,
    SAMPLE_DECAY_STORED
} from './data.js';
import { GRID, buildNav, zoneOwnedTileCount } from './grid.js';

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
export function ownedCaps() {
    const set = new Set();
    for (const e of G.state.equipment) for (const c of (BUILD[e.type].caps || [])) set.add(c);
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
