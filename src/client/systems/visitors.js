// ==================== VISITORS ====================
// People who aren't on the payroll but turn up and do something visible on the floor. Everything
// you call in arrives this way rather than resolving as a number on a timer:
//
//   mechanic   — books for the next morning, then walks the repair list machine by machine.
//   fire crew  — two of them, through the front door once the engine arrives, putting fires out
//                one at a time; the fee lands when they leave.
//   cleaners   — two of them, in on the morning the disinfection booking falls due, straight
//                into the sealed containment room to fog it, which is what reopens it.
//
// Making these people rather than timers is the point: "$1,400 and the room reopens tomorrow" is
// a transaction, whereas watching two figures in hazmat suits walk into the room you sealed is
// the thing you paid for.
//
// A visitor is deliberately NOT a member of state.staff: they take no jobs, obey no capability
// toggles, never rest, and shouldn't be counted against staff capacity or shown in the Staff
// panel. They share only the pathfinder, and they're kept in their own list so every existing
// `for (const w of s.staff)` in the codebase stays correct without a single guard being added.

import { BUILD, MECH_REPAIR_TIME, MECH_SERVICE_TIME, MECH_CALLOUT_FEE, MECH_REPAIR_COST,
         MECH_SERVICE_COST, MECH_MAINT_GAIN, STAFF_SPEED,
         FIRE_CREW_SIZE, FIRE_FIGHT_TIME, FIRE_BRIGADE_FEE, FIRE_REP_PENALTY,
         DISINFECT_CREW_SIZE, DISINFECT_TIME, DISINFECT_FEE } from '../data.js';
import { G, nid, nav, bumpNav, dirtyUI } from '../core.js';
import { GRID, tileToWorld, worldToTile, footTiles, gateWorld, GATE_COLS } from '../grid.js';
import { aStar, nearestAccess } from '../pathfind.js';

const VISITOR_SPEED = STAFF_SPEED * 0.85;      // unhurried. They're on the clock, not yours
const GATE_TILE = [GATE_COLS[0], GRID - 1];

// ---------- movement (a cut-down copy of the staff walker) ----------
// Not shared with staff.js on purpose: a visitor has no job, no reservation and no nav-version
// bookkeeping tied to a worker record, and threading all of that through the staff walker to
// support two callers would have made the more important one harder to read.
// A sealed containment room is cut out of the nav grid so nobody on the payroll can wander into
// it — but the whole job of the disinfection crew is to go in there. They get their own view of
// the grid with the seal lifted, and only they do: the room's walls still stand, so they still
// have to come in through its airlock like anyone else.
let _vnav = null, _vnavKey = '';
function visitorNav(ignoreSeal) {
    const g = nav();
    if (!ignoreSeal || !G.state.outbreak) return g;
    const key = G.state.navVersion + '|' + G.state.outbreak.tiles.join(';');
    if (_vnavKey !== key) {
        const v = Uint8Array.from(g);
        v.walls = g.walls;
        for (const k of G.state.outbreak.tiles) {
            const [x, z] = k.split(',').map(Number);
            if (x >= 0 && z >= 0 && x < GRID && z < GRID) v[z * GRID + x] = 0;
        }
        _vnav = v; _vnavKey = key;
    }
    return _vnav;
}

function stepPath(v, dt) {
    if (v.goal && (v.pathV !== G.state.navVersion || !v.path)) {
        const from = worldToTile(v.wx, v.wz);
        v.path = aStar(visitorNav(v.kind === 'cleaner'), GRID, GRID, from.tx, from.tz, v.goal[0], v.goal[1]);
        v.pathV = G.state.navVersion;
        if (v.path === null) return 'blocked';
    }
    if (!v.path || !v.path.length) return 'arrived';
    const [nx, nz] = v.path[0];
    const w = tileToWorld(nx, nz);
    const dx = w.x - v.wx, dz = w.z - v.wz;
    const d = Math.hypot(dx, dz);
    if (d < 0.1) { v.path.shift(); return v.path.length ? 'moving' : 'arrived'; }
    const step = Math.min(d, VISITOR_SPEED * dt);
    v.wx += dx / d * step; v.wz += dz / d * step;
    return 'moving';
}
function goTo(v, tile) { v.goal = tile; v.path = null; }
// Somewhere to stand while working on this machine. Beside it, never on it.
function accessTile(e) {
    return nearestAccess(nav(), GRID, GRID, footTiles(e.type, e.tx, e.tz, e.rot), GATE_TILE[0], GATE_TILE[1]) || null;
}

// ---------- the mechanic ----------
// `jobs` is the list built by mechanicVisit() at the day rollover: [{ id, repair }].
export function spawnMechanic(jobs) {
    const s = G.state;
    s.visitors ||= [];
    if (s.visitors.some(v => v.kind === 'mechanic')) return;
    const w = gateWorld();
    s.visitors.push({
        id: nid(), kind: 'mechanic', wx: w.x, wz: w.z,
        state: 'toJob', queue: jobs.slice(), target: null, targetId: null, timer: 0, work: 0,
        repaired: 0, serviced: 0, billed: MECH_CALLOUT_FEE,   // the trip is charged the moment they're on site
        goal: null, path: null, pathV: -1
    });
    s.money -= MECH_CALLOUT_FEE;
    G.onToast(jobs.length
        ? `The mechanic's here, ${jobs.length} machine${jobs.length > 1 ? 's' : ''} to get through`
        : `Mechanic called out to nothing, $${MECH_CALLOUT_FEE} for the trip`, !jobs.length);
    dirtyUI();
}

// Is this machine currently being worked on? Read by equipment.js/staff.js so nothing new is
// started on a machine with a mechanic's hands in it.
// Is a mechanic on the premises right now, and how much is left on their list? Drives the Lab
// menu's wording and stops a second call-out being booked on top of a visit in progress.
export function mechanicOnSite() {
    const v = (G.state.visitors || []).find(x => x.kind === 'mechanic');
    return v ? { left: v.queue.length, state: v.state } : null;
}
export function underService(e) {
    return (G.state.visitors || []).some(v => v.state === 'working' && v.targetId === e.id);
}

function finishJob(v, e, job) {
    const s = G.state;
    if (job.repair) {
        e.broken = false; e.condition = 100;
        v.repaired++; v.billed += MECH_REPAIR_COST;
        s.money -= MECH_REPAIR_COST;
    } else {
        e.condition = Math.min(100, (e.condition ?? 100) + MECH_MAINT_GAIN);
        v.serviced++; v.billed += MECH_SERVICE_COST;
        s.money -= MECH_SERVICE_COST;
    }
    dirtyUI();
}

function updateMechanic(v, dt) {
    const s = G.state;
    switch (v.state) {
        case 'toJob': {
            // Take the next job that still exists and can still be walked to — a machine can have
            // been sold, moved, burned down or sealed inside a quarantined room since the list was
            // drawn up this morning, and none of those are worth stalling the whole visit over.
            while (v.queue.length && !v.target) {
                const job = v.queue[0];
                const e = s.equipment.find(x => x.id === job.id);
                const acc = e && accessTile(e);
                if (!e || !acc) { v.queue.shift(); continue; }
                v.target = job; v.targetId = e.id;
                goTo(v, acc);
            }
            if (!v.target) { v.state = 'leaving'; goTo(v, GATE_TILE); break; }
            const r = stepPath(v, dt);
            if (r === 'blocked') { v.queue.shift(); v.target = null; v.targetId = null; }
            else if (r === 'arrived') { v.state = 'working'; v.timer = 0; v.work = v.target.repair ? MECH_REPAIR_TIME : MECH_SERVICE_TIME; }
            break;
        }
        case 'working': {
            v.timer += dt;
            if (v.timer < v.work) break;
            const e = s.equipment.find(x => x.id === v.targetId);
            if (e) finishJob(v, e, v.target);
            v.queue.shift();
            v.target = null; v.targetId = null;
            v.state = 'toJob';
            break;
        }
        case 'leaving': {
            const r = stepPath(v, dt);
            if (r !== 'arrived' && r !== 'blocked') break;
            s.visitors = s.visitors.filter(x => x !== v);
            G.onToast(v.repaired || v.serviced
                ? `Mechanic done: ${v.repaired} repaired, ${v.serviced} serviced, $${v.billed.toLocaleString()}`
                : `Mechanic left without touching anything, $${v.billed.toLocaleString()} for the call-out`,
                !(v.repaired || v.serviced));
            dirtyUI();
            break;
        }
    }
}

// ---------- the fire brigade ----------
// Spawned by incidents.js when the engine's ETA runs out. They work the fires down one at a time,
// two at once, and the fires can still be spreading while they do, so the list is re-read every
// time someone finishes rather than fixed when they arrived.
export function spawnFireCrew() {
    const s = G.state;
    s.visitors ||= [];
    if (s.visitors.some(v => v.kind === 'firefighter')) return;
    const w = gateWorld();
    for (let i = 0; i < FIRE_CREW_SIZE; i++) {
        s.visitors.push({
            id: nid(), kind: 'firefighter', wx: w.x + (i - (FIRE_CREW_SIZE - 1) / 2) * 0.5, wz: w.z,
            state: 'toFire', target: null, targetId: null, timer: 0,
            goal: null, path: null, pathV: -1
        });
    }
    G.onToast('Fire brigade is in — stand clear');
    dirtyUI();
}
// The nearest fire nobody's already dealing with.
function claimFire(v) {
    const s = G.state;
    let best = null, bestD = Infinity;
    for (const f of s.fires || []) {
        if (f.crew != null && f.crew !== v.id) continue;
        const e = s.equipment.find(x => x.id === f.equipId);
        if (!e) continue;
        const c = footTiles(e.type, e.tx, e.tz, e.rot)[0];
        const d = Math.abs(c[0] - (v.wx + GRID / 2)) + Math.abs(c[1] - (v.wz + GRID / 2));
        if (d < bestD) { bestD = d; best = f; }
    }
    return best;
}
function updateFirefighter(v, dt) {
    const s = G.state;
    switch (v.state) {
        case 'toFire': {
            if (!v.target) {
                const f = claimFire(v);
                if (!f) { v.state = 'leaving'; goTo(v, GATE_TILE); break; }
                const e = s.equipment.find(x => x.id === f.equipId);
                const acc = accessTile(e);
                if (!acc) { f.crew = -1; break; }             // can't be reached at all. Leave it burning
                f.crew = v.id; v.target = f; v.targetId = f.equipId;
                goTo(v, acc);
            }
            // The machine can burn out from under them before they arrive.
            if (!(s.fires || []).includes(v.target)) { v.target = null; v.targetId = null; break; }
            const r = stepPath(v, dt);
            if (r === 'blocked') { v.target.crew = -1; v.target = null; v.targetId = null; }
            else if (r === 'arrived') { v.state = 'fighting'; v.timer = 0; }
            break;
        }
        case 'fighting': {
            if (!(s.fires || []).includes(v.target)) { v.target = null; v.targetId = null; v.state = 'toFire'; break; }
            v.timer += dt;
            if (v.timer < FIRE_FIGHT_TIME) break;
            s.fires = s.fires.filter(f => f !== v.target);
            G.onToast(`${BUILD[s.equipment.find(x => x.id === v.targetId)?.type]?.name || 'Machine'}. Fire out`);
            v.target = null; v.targetId = null; v.state = 'toFire';
            dirtyUI();
            break;
        }
        case 'leaving': {
            const r = stepPath(v, dt);
            if (r !== 'arrived' && r !== 'blocked') break;
            s.visitors = s.visitors.filter(x => x !== v);
            // Billed once, by whoever is last out, so a two-person crew isn't a double call-out.
            if (!s.visitors.some(x => x.kind === 'firefighter')) {
                s.brigadeEta = null;
                s.money -= FIRE_BRIGADE_FEE;
                G.onToast(`Brigade away. Call-out: $${FIRE_BRIGADE_FEE.toLocaleString()}`);
                if (G.endEvacuation) G.endEvacuation();
            }
            dirtyUI();
            break;
        }
    }
}

// ---------- the disinfection crew ----------
// They go *into* the sealed room — that's the whole point, and why visitorNav() lifts the seal
// for them alone. The room reopens when the last of them finishes fogging, not on a clock.
export function spawnCleanCrew() {
    const s = G.state;
    s.visitors ||= [];
    if (!s.outbreak || s.visitors.some(v => v.kind === 'cleaner')) return;
    const w = gateWorld();
    const tiles = s.outbreak.tiles;
    for (let i = 0; i < DISINFECT_CREW_SIZE; i++) {
        const key = tiles[i % tiles.length].split(',').map(Number);
        s.visitors.push({
            id: nid(), kind: 'cleaner', wx: w.x + (i - (DISINFECT_CREW_SIZE - 1) / 2) * 0.5, wz: w.z,
            state: 'toRoom', spot: key, timer: 0, done: false,
            goal: null, path: null, pathV: -1
        });
    }
    G.onToast('Disinfection crew is here');
    dirtyUI();
}
function updateCleaner(v, dt) {
    const s = G.state;
    switch (v.state) {
        case 'toRoom': {
            // The booking can be overtaken by events. The player might have demolished the room.
            if (!s.outbreak) { v.state = 'leaving'; goTo(v, GATE_TILE); break; }
            if (!v.goal) goTo(v, v.spot);
            const r = stepPath(v, dt);
            if (r === 'blocked') { v.state = 'leaving'; goTo(v, GATE_TILE); }
            else if (r === 'arrived') { v.state = 'fogging'; v.timer = 0; }
            break;
        }
        case 'fogging': {
            v.timer += dt;
            if (v.timer < DISINFECT_TIME) break;
            v.done = true;
            // Whoever finishes last reopens the room and settles the bill.
            if (s.outbreak && s.visitors.every(x => x.kind !== 'cleaner' || x.done)) {
                s.outbreak = null;
                s.money -= DISINFECT_FEE;
                bumpNav();
                G.onToast(`Containment Lab sterilized and reopened, $${DISINFECT_FEE.toLocaleString()}`);
            }
            v.state = 'leaving'; goTo(v, GATE_TILE);
            dirtyUI();
            break;
        }
        case 'leaving': {
            const r = stepPath(v, dt);
            if (r !== 'arrived' && r !== 'blocked') break;
            s.visitors = s.visitors.filter(x => x !== v);
            dirtyUI();
            break;
        }
    }
}

export function updateVisitors(dt) {
    const s = G.state;
    if (!s.visitors || !s.visitors.length) return;
    for (const v of s.visitors.slice()) {
        if (v.kind === 'mechanic') updateMechanic(v, dt);
        else if (v.kind === 'firefighter') updateFirefighter(v, dt);
        else if (v.kind === 'cleaner') updateCleaner(v, dt);
    }
}

// Routine contractors go home when the building is evacuated. Nobody is servicing a centrifuge
// while the place burns. The emergency services obviously stay: they arrive *because* of it.
const EMERGENCY = new Set(['firefighter', 'cleaner']);
export function clearVisitors(reason) {
    const s = G.state;
    if (!s.visitors || !s.visitors.length) return;
    const before = s.visitors.length;
    s.visitors = s.visitors.filter(v => EMERGENCY.has(v.kind));
    if (reason && s.visitors.length !== before) G.onToast(reason);
    dirtyUI();
}
