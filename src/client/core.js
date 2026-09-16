// ==================== SHARED RUNTIME CORE ====================
// The G singleton, id allocation, derived stats and the cached nav grid.
// Every system module reads/writes through this — it has no game logic of its own.

import {
    BUILD, UPGRADES, REP_LEVELS, ZONES, UTIL_ELECTRICITY_PER_MACHINE, UTIL_HEATING_PER_TILE, UTIL_LIGHTING_PER_TILE,
    SAMPLE_DECAY_STORED, ROOM_BONUS_CAP,
    STAFF_TRAITS, STAFF_PERKS, CAREER_XP_PER_LEVEL, CAREER_MAX_LEVEL, WAGE_BASE, WAGE_PER_LEVEL} from './data.js';
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

// ---------- who a scientist is ----------
// One place that folds a worker's traits and chosen perks into the numbers the rest of the game
// asks for. Everything is multiplicative and defaults to 1, so a plain scientist with no traits
// and no perks comes out exactly as they did before any of this existed.
//
// Sense of each: speed and wear multiply a duration and a wear figure, so LOWER is better. walk,
// quality, mop and xp multiply a rate or a result, so HIGHER is better. carry is a flat bonus in
// samples. wage multiplies the daily cost.
export function staffMods(w) {
    const m = { speed: 1, quality: 1, walk: 1, mop: 1, wear: 1, xp: 1, carry: 0, wage: 1 };
    if (!w) return m;
    const apply = (def) => {
        if (!def) return;
        for (const k of ['speed', 'quality', 'walk', 'mop', 'wear', 'xp', 'wage']) if (def[k] != null) m[k] *= def[k];
        if (def.carry) m.carry += def.carry;
    };
    for (const t of w.traits || []) apply(STAFF_TRAITS[t]);
    for (const k of w.perks || []) apply(STAFF_PERKS[k]);
    return m;
}
// Career level is derived from total XP rather than stored, so retuning CAREER_XP_PER_LEVEL
// re-levels existing saves instead of leaving them on stale numbers.
export function careerLevel(w) {
    return Math.min(CAREER_MAX_LEVEL, Math.floor((w.xp || 0) / CAREER_XP_PER_LEVEL));
}
// How many perk picks a worker has earned but not yet spent. Derived the same way, so a save that
// predates all of this simply owes nothing and a level gained while the menu was shut is not lost.
export function perksOwed(w) {
    return Math.max(0, careerLevel(w) - (w.perks ? w.perks.length : 0));
}
export function dailyWage(w) {
    return Math.round((WAGE_BASE + WAGE_PER_LEVEL * careerLevel(w)) * staffMods(w).wage);
}
export function payrollTotal() {
    return G.state.staff.reduce((n, w) => n + dailyWage(w), 0);
}

// ---------- where the day actually goes ----------
// Which states count as walking rather than working. A scientist carrying a tube across the lab
// is busy, but they are not *producing*: separating the two is the whole point of the readout,
// because a lab whose staff spend half the day in transit needs a rearranged floor, not another
// machine.
const WALK_STATES = new Set(['toPickup', 'toStation', 'toPrep', 'toSink', 'toColdPickup',
                             'toFridge', 'toOperate', 'toCrate', 'toStock', 'toMop', 'evacuating']);
const SPARE_STATES = new Set(['idle', 'resting', 'evacuatingDone', 'sickDone', 'sick']);

export function freshUtil() {
    return { elapsed: 0, machines: {}, staff: { work: 0, walk: 0, spare: 0 }, prev: null };
}
// Sampled every tick rather than instrumented into each system. The question the readout answers
// is "what share of the day was this machine actually running", and a machine either has a run on
// it or it does not, so polling is both cheaper and impossible to get out of step with the
// simulation the way a set of hand-maintained counters would be.
export function sampleUtilisation(g) {
    const s = G.state;
    s.util ||= freshUtil();
    const u = s.util;
    u.elapsed += g;
    for (const e of s.equipment) {
        if (BUILD[e.type].cat !== 'Processing') continue;
        if (e.processing && e.processing.length) u.machines[e.id] = (u.machines[e.id] || 0) + g;
    }
    for (const w of s.staff) {
        const k = WALK_STATES.has(w.state) ? 'walk' : (SPARE_STATES.has(w.state) ? 'spare' : 'work');
        u.staff[k] += g;
    }
}
// Called at the day rollover: the finished day becomes what the Lab menu reports, and collection
// starts over. Keeping a whole finished day (rather than a rolling window) means the number stops
// moving while the player is reading it.
export function rollUtilisation() {
    const s = G.state;
    if (!s.util || s.util.elapsed <= 0) { s.util = freshUtil(); return; }
    const u = s.util;
    s.util = freshUtil();
    s.util.prev = { elapsed: u.elapsed, machines: u.machines, staff: u.staff };
}

// Busy share per machine over the last full day, highest first. Falls back to the day in progress
// when there is no finished one yet, so a new lab shows something rather than an empty panel.
export function machineLoad() {
    const s = G.state;
    const u = (s.util && s.util.prev) || s.util;
    if (!u || u.elapsed <= 0) return [];
    return s.equipment
        .filter(e => BUILD[e.type].cat === 'Processing')
        .map(e => ({
            e, name: BUILD[e.type].name,
            busy: Math.min(1, (u.machines[e.id] || 0) / u.elapsed),
            waiting: e.staged ? e.staged.length : 0
        }))
        .sort((a, b) => b.busy - a.busy);
}
// How the staff's day split three ways. Shares, not seconds, so it reads the same at any speed.
export function staffLoad() {
    const s = G.state;
    const u = (s.util && s.util.prev) || s.util;
    if (!u) return null;
    const t = u.staff.work + u.staff.walk + u.staff.spare;
    if (t <= 0) return null;
    return { work: u.staff.work / t, walk: u.staff.walk / t, spare: u.staff.spare / t };
}

// The one-line diagnosis. Deliberately returns a single verdict rather than a wall of numbers:
// the player's actual question is "what do I buy next", and a list of percentages does not answer
// it. Order matters here -- a machine everyone is queueing for outranks a staffing problem,
// because buying the machine is what unblocks the staff.
export function bottleneck() {
    const loads = machineLoad(), sl = staffLoad();
    if (!loads.length || !sl) return null;
    const top = loads[0];
    const queued = loads.reduce((n, m) => n + m.waiting, 0);
    if (top.busy > 0.85 && top.waiting > 0)
        return { kind: 'machine', subject: top.name, busy: top.busy, waiting: top.waiting,
                 text: `${top.name} is the constraint. Running ${Math.round(top.busy * 100)}% of the day with ${top.waiting} sample${top.waiting === 1 ? '' : 's'} queued behind it. Another one would pay for itself.` };
    if (sl.spare < 0.08 && top.busy < 0.6)
        return { kind: 'staff', busy: sl.work, text: `Your scientists are the constraint. Barely a spare moment between them and the machines still sat idle ${Math.round((1 - top.busy) * 100)}% of the day. Hire someone.` };
    if (sl.walk > 0.35)
        return { kind: 'layout', walk: sl.walk, text: `Your floor plan is the constraint. Staff spend ${Math.round(sl.walk * 100)}% of the day walking. Move the machines that hand off to each other closer together.` };
    if (queued > 0 && sl.spare > 0.25)
        return { kind: 'idle', text: `${queued} sample${queued === 1 ? '' : 's'} waiting with staff stood spare. Usually means nobody is allowed to do that step: check who is ticked for Process.` };
    return { kind: 'ok', text: `Nothing is jammed. Busiest machine is ${top.name} at ${Math.round(top.busy * 100)}%, and the staff have ${Math.round(sl.spare * 100)}% of the day spare.` };
}
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
    // Wages are billed with the utilities: one daily hit, so the player sees the whole cost of
    // running the place in one line rather than two unrelated ones.
    const wages = payrollTotal();
    const total = Math.round((electricity + heating + lighting + wages) * 10) / 10;
    return { electricity, heating, lighting, wages, total };
}

export { GRID };
