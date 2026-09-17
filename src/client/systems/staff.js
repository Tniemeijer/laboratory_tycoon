// ==================== STAFF AI ====================
// Hiring, roles, and the per-worker state machine: fetch a sample, carry it through every
// protocol step at the right machine, or mop, or brew a batch of reagent from raw ingredient.

import {
    EVAC_SPEED_MUL,
    BUILD, PROTOCOLS, REAGENTS, REAGENT_BATCH, REAGENT_MIN, REAGENT_PREP_TIME, REAGENT_WATER_COST,
    WATER_BATCH, WATER_MIN, WATER_FILL_TIME, COLD_STORE_THRESHOLD, COLD_STORE_TIME, CAP_LABEL, SURNAMES,
    BATCH_LOAD_TIME, IDLE_GRACE_PERIOD, STOCK_UNLOAD_TIME, DISMISS_REP_PENALTY,
    SKIN_TONES, HAIR_COLORS,
    SKILL_CAP_ALIAS, SKILL_XP_PER_RUN, SKILL_XP_PER_EXTRA_SAMPLE, SKILL_XP_PER_LEVEL, SKILL_MAX_LEVEL,
    SKILL_SPEED_PER_LEVEL, SKILL_QUALITY_PER_LEVEL,
    STAFF_TRAITS, STAFF_PERKS, TRAIT_SECOND_CHANCE, CAREER_XP_PER_RUN, CAREER_XP_PER_EXTRA_SAMPLE, PERK_CHOICES, CAREER_MAX_LEVEL, WEAR_PER_RUN, WEAR_PER_EXTRA_BATCH_SAMPLE, ORDER_DESK_TIME} from '../data.js';
import { G, nid, nav, cleanliness, staffSpeedMul, maxStaff, reagentCount, dirtyUI, cartCapacity, equipCaps, staffMods, careerLevel, perksOwed} from '../core.js';
import { GRID, tileToWorld, worldToTile, footTiles, restTile, stockTile, gateWorld, musterTile } from '../grid.js';
import { aStar, nearestAccess } from '../pathfind.js';
import { addDirt, recomputeGrime, topDirtTile } from './dirt.js';
import { curStep, isInert } from './samples.js';
import { completeContract } from './contracts.js';
import { stageSample, batchReady, startRun, runShortage } from './equipment.js';
import { isBurning, isQuarantined } from './incidents.js';
import { underService } from './visitors.js';
import { addStock, orderPlan, placeOrders} from './economy.js';

const STAFF_SPEED = 2.7;

// Rolls a new hire's innate traits: one for certain, sometimes a second. The second is never
// allowed to pull a lever the first already pulls, so nobody turns up Quick Hands *and* Ponderous
// and reads as having no traits at all. Purely cosmetic pairs (Tidy plus Gentle) are fine.
function rollTraits() {
    const keys = Object.keys(STAFF_TRAITS);
    const first = keys[Math.floor(Math.random() * keys.length)];
    const out = [first];
    if (Math.random() < TRAIT_SECOND_CHANCE) {
        const levers = (k) => Object.keys(STAFF_TRAITS[k]).filter(x => !['name', 'good', 'desc'].includes(x));
        const taken = new Set(levers(first));
        const free = keys.filter(k => k !== first && !levers(k).some(l => taken.has(l)));
        if (free.length) out.push(free[Math.floor(Math.random() * free.length)]);
    }
    return out;
}

export function hireStaff() {
    const s = G.state;
    if (s.staff.length >= maxStaff()) return G.onToast('Staff at capacity. Build Staff Quarters', true);
    if (s.money < s.hireCost) return G.onToast(G.noFunds ? G.noFunds('another scientist') : 'Not enough money', true);
    s.money -= s.hireCost;
    const w = gateWorld();          // walks in the front door, like a new hire should
    s.staff.push({
        id: nid(), name: SURNAMES[Math.floor(Math.random() * SURNAMES.length)],
        caps: { process: true, clean: true, orders: false }, wx: w.x, wz: w.z, state: 'idle',
        job: null, carrying: null, reservedStation: null,
        path: null, pathV: -1, tendTimer: 0,
        skin: SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)],
        hairColor: HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)],
        hairLong: Math.random() < 0.5,
        skillXp: {},
        traits: rollTraits(), xp: 0, perks: [], perkChoices: null
    });
    s.hireCost = Math.round(s.hireCost * 1.55);
    G.onToast('Hired a scientist');
    dirtyUI();
}
// Letting someone go. Whatever they were carrying goes back in the queue and whatever they'd
// claimed is released. ResetWorker already does all of that, so firing is that plus removal.
export function fireStaff(id) {
    const s = G.state;
    const w = s.staff.find(x => x.id === id);
    if (!w) return;
    resetWorker(w);
    s.staff = s.staff.filter(x => x !== w);
    s.reputation = Math.max(0, s.reputation - DISMISS_REP_PENALTY);
    G.onToast(`${w.name} was let go  -${DISMISS_REP_PENALTY} rep`, true);
    dirtyUI();
}

// Each capability toggles independently. A worker can be Process + Mechanic but not Clean, say.
// Unlike the old exclusive role, there's no single "current role" here on purpose: the plan is to
// eventually replace this with specialities set at hiring time (a CV-style hire screen) rather
// than freely reassignable checkboxes, so this stays deliberately simple in the meantime.
export function toggleStaffCap(id, cap) {
    const w = G.state.staff.find(x => x.id === id);
    if (!w) return;
    w.caps[cap] = !w.caps[cap];
    resetWorker(w);
    dirtyUI();
}

function releaseReservation(w) {
    if (w.reservedStation != null) {
        const st = G.state.equipment.find(e => e.id === w.reservedStation);
        if (st && st.reserved > 0) st.reserved--;
        w.reservedStation = null;
    }
}

function resetWorker(w) {
    if (w.job && w.job.prepReagent) {
        const t = w.job.prepReagent;
        G.state.prepping[t] = Math.max(0, (G.state.prepping[t] || 0) - 1);
    }
    if (w.job && w.job.mopKey != null && G.state.dirtClaims[w.job.mopKey] === w.id) {
        delete G.state.dirtClaims[w.job.mopKey];
    }
    // Both of these claim a machine the same way, so both have to give it back. A leaked claim
    // is invisible and permanent: the desk (or the machine) is never offered to anybody again.
    for (const key of ['operateId', 'deskId']) {
        if (w.job && w.job[key] != null) {
            const e = G.state.equipment.find(x => x.id === w.job[key]);
            if (e && e.operateClaim === w.id) e.operateClaim = null;
        }
    }
    releaseReservation(w);
    if (w.job && w.job.crateId != null) {
        const c = (G.state.deliveries || []).find(x => x.id === w.job.crateId);
        // A carried crate is put back down where the worker is standing rather than teleporting
        // to the door — it's a physical box and they were holding it.
        if (c && c.claimedBy === w.id) {
            c.claimedBy = null;
            if (w.carryingCrate) { c.wx = w.wx; c.wz = w.wz; }
        }
    }
    w.carryingCrate = null;
    const ids = w.job ? (w.job.sampleIds || (w.job.coldSampleId != null ? [w.job.coldSampleId] : [])) : [];
    for (const id of ids) {
        const sm = G.state.samples.find(x => x.id === id);
        if (sm && sm.state !== 'processing' && sm.state !== 'staged') { sm.state = 'queued'; sm.claimedBy = null; }
    }
    w.job = null; w.carrying = null; w.reservedStation = null;
    w.path = null; w.state = 'idle'; w.tendTimer = 0;
}
G.releaseWorkerJob = resetWorker;    // lets samples.abandonSample() free a worker without importing this module

function refundPrepReservation(w) {
    if (w.job && w.job.ingredient) {
        const k = w.job.ingredient;
        G.state.ingredients[k] = (G.state.ingredients[k] || 0) + REAGENT_BATCH;
    }
    if (w.job && w.job.water) G.state.water += w.job.water;
    // The order itself is put back too. The player asked for this batch and hasn't got it.
    if (w.job && w.job.brewOrder) {
        const k = w.job.brewOrder;
        G.state.brewOrders[k] = (G.state.brewOrders[k] || 0) + 1;
    }
}

function stepPath(w, dt) {
    if (w.goal && (w.pathV !== G.state.navVersion || !w.path)) {
        const from = worldToTile(w.wx, w.wz);
        w.path = aStar(nav(), GRID, GRID, from.tx, from.tz, w.goal[0], w.goal[1]);
        w.pathV = G.state.navVersion;
        if (w.path === null) return 'blocked';
    }
    if (!w.path || w.path.length === 0) return 'arrived';
    const [nx, nz] = w.path[0];
    const wt = tileToWorld(nx, nz);
    const dx = wt.x - w.wx, dz = wt.z - w.wz;
    const d = Math.hypot(dx, dz);
    if (d < 0.1) { w.path.shift(); return w.path.length === 0 ? 'arrived' : 'moving'; }
    const step = Math.min(d, STAFF_SPEED * staffSpeedMul() * staffMods(w).walk * (G.state.evacuating ? EVAC_SPEED_MUL : 1) * dt);
    w.wx += dx / d * step; w.wz += dz / d * step;
    return 'moving';
}
function setGoalTile(w, tile) { w.goal = tile; w.path = null; }

// ---------- giving way ----------
// Someone standing about with nothing to do gets out of the way of someone working. Without this
// the two just overlap: the renderer's separation pass nudges both of them a little every frame
// and neither ever settles, which is the visible "dancing on the spot" when a worker stops to
// operate a machine on a tile somebody was already idling on.
//
// Only the idle one moves, and it moves the *simulated* position rather than the drawn one, so it
// actually stands somewhere else rather than being cosmetically shoved back every frame.
const PERSONAL_SPACE = 0.62;
const GIVE_WAY_SPEED = 1.5;
// Who actually needs the exact square they're stood on.
//   2  attending a machine, or a contractor doing a job: it has to be this tile
//   1  mopping: the tile matters, but they can clean it from half a step over
//   0  idle or resting: no claim at all
// Only a weaker claim moves. Without a tie-break like this, two people who both stopped on the
// same tile get shoved apart by the renderer and pulled back by their own target every frame, and
// neither ever settles. It isn't enough to handle the idle case: a cleaner mopping the tile a
// colleague is attending the bench from is two *busy* people, and they danced just the same.
const NO_CLAIM = new Set(['idle', 'resting', 'evacuatingDone', 'sickDone']);
const LOOSE_CLAIM = new Set(['mopping', 'toMop']);
// Anything not listed is treated as a hard claim, which is what visitors' own states fall into.
function spotClaim(p) {
    if (NO_CLAIM.has(p.state)) return 0;
    if (LOOSE_CLAIM.has(p.state)) return 1;
    return 2;
}
// Only people who have stopped are worth moving. Anyone mid-walk resolves a collision by simply
// carrying on, and nudging them just fights their pathing.
const STATIONARY = new Set(['idle', 'resting', 'mopping', 'atStation', 'prepping', 'filling', 'ordering',
                            'storing', 'operating', 'tending', 'stocking', 'evacuatingDone', 'sickDone']);
// Can this worker stand here? Same rules the pathfinder uses, so giving way can never put someone
// inside a wall or through a partition.
function canStandAt(w, x, z) {
    const from = worldToTile(w.wx, w.wz), to = worldToTile(x, z);
    if (to.tx === from.tx && to.tz === from.tz) return true;
    if (to.tx < 0 || to.tz < 0 || to.tx >= GRID || to.tz >= GRID) return false;
    const g = nav();
    if (g[to.tz * GRID + to.tx]) return false;
    const dx = to.tx - from.tx, dz = to.tz - from.tz;
    if (Math.abs(dx) + Math.abs(dz) !== 1) return false;          // orthogonal steps only
    const bit = dx === 1 ? 8 : dx === -1 ? 4 : dz === 1 ? 2 : 1;  // wall on the edge we'd cross
    if (g.walls && (g.walls[from.tz * GRID + from.tx] & bit)) return false;
    return true;
}
function giveWay(w, dt) {
    const s = G.state;
    if (!STATIONARY.has(w.state)) return;
    const mine = spotClaim(w);
    let ax = 0, az = 0, n = 0;
    // Contractors count as people to get out of the way of, same as colleagues: a mechanic at a
    // machine or a crew fogging a room is there to do a job.
    for (const o of [...s.staff, ...(s.visitors || [])]) {
        if (o === w) continue;
        const theirs = spotClaim(o);
        if (theirs < mine) continue;                       // they have less business here
        // Equal standing — two idle people sharing a rest tile, say. Somebody still has to be the
        // one who moves, or both sit there being nudged by the renderer and circle each other.
        // The higher id yields: arbitrary, but consistent, so they don't both step the same way.
        if (theirs === mine && (w.id <= o.id || !STATIONARY.has(o.state))) continue;
        const dx = w.wx - o.wx, dz = w.wz - o.wz;
        const d = Math.hypot(dx, dz);
        if (d >= PERSONAL_SPACE) continue;
        if (d < 1e-3) {
            // Exactly coincident: pick a direction off this worker's id so the two of them don't
            // choose the same one and shuffle together.
            const a = (w.id % 8) / 8 * Math.PI * 2;
            ax += Math.cos(a); az += Math.sin(a);
        } else { ax += dx / d; az += dz / d; }
        n++;
    }
    if (!n) return;
    const m = Math.hypot(ax, az) || 1;
    const step = GIVE_WAY_SPEED * dt;
    const nx = w.wx + ax / m * step, nz = w.wz + az / m * step;
    if (canStandAt(w, nx, nz)) { w.wx = nx; w.wz = nz; }
}

// A worker's level at a given task (cap), derived from accumulated XP rather than stored
// directly. Keeps the save format simple and means tuning SKILL_XP_PER_LEVEL retroactively
// re-levels everyone instead of leaving old saves stuck at stale numbers.
export function skillCap(cap) { return SKILL_CAP_ALIAS[cap] || cap; }
function skillLevel(w, cap) {
    cap = skillCap(cap);
    const xp = (w.skillXp && w.skillXp[cap]) || 0;
    return Math.min(SKILL_MAX_LEVEL, Math.floor(xp / SKILL_XP_PER_LEVEL));
}
function grantSkillXp(w, cap, n) {
    cap = skillCap(cap);
    w.skillXp ||= {};
    const mul = staffMods(w).xp;
    w.skillXp[cap] = (w.skillXp[cap] || 0) + (SKILL_XP_PER_RUN + SKILL_XP_PER_EXTRA_SAMPLE * (n - 1)) * mul;
    // The same run also counts toward the whole career, which is what earns perk picks. Counted
    // separately from the per-cap skill so a generalist who never specialises still progresses.
    const before = careerLevel(w);
    w.xp = (w.xp || 0) + (CAREER_XP_PER_RUN + CAREER_XP_PER_EXTRA_SAMPLE * (n - 1)) * mul;
    if (careerLevel(w) > before) {
        offerPerks(w);
        G.onToast(`${w.name} reached level ${careerLevel(w)}. Pick a skill in Staff`);
        dirtyUI();
    }
}

// Lays out the choices for a level-up. Generated once and stored, so the options do not reshuffle
// every time the menu re-renders, and perks already taken are never offered twice.
export function offerPerks(w) {
    if (w.perkChoices && w.perkChoices.length) return;
    const taken = new Set(w.perks || []);
    const pool = Object.keys(STAFF_PERKS).filter(k => !taken.has(k));
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    w.perkChoices = pool.slice(0, PERK_CHOICES);
}
// The player's pick. Guarded on actually being owed one so a stale click from an old render
// cannot hand out a free perk.
export function choosePerk(id, perk) {
    const w = G.state.staff.find(x => x.id === id);
    if (!w || !STAFF_PERKS[perk]) return;
    if (perksOwed(w) <= 0) return;
    if (!w.perkChoices || !w.perkChoices.includes(perk)) return;
    w.perks = w.perks || [];
    w.perks.push(perk);
    w.perkChoices = null;
    if (perksOwed(w) > 0) offerPerks(w);      // two levels at once, still one pick each
    G.onToast(`${w.name} learned ${STAFF_PERKS[perk].name}`);
    dirtyUI();
}

// Which way a machine faces. The models are all built facing +z and then turned by
// `rotation.y = -rot * PI/2` (see _applyEquipTransform), so this is that same mapping in tiles.
const FRONT_OFFSET = [[0, 1], [-1, 0], [0, -1], [1, 0]];
function frontTiles(e) {
    const [dx, dz] = FRONT_OFFSET[(e.rot || 0) % 4];
    const foot = footTiles(e.type, e.tx, e.tz, e.rot);
    const own = new Set(foot.map(([x, z]) => `${x},${z}`));
    const out = [];
    for (const [x, z] of foot) {
        const nx = x + dx, nz = z + dz;
        if (!own.has(`${nx},${nz}`)) out.push([nx, nz]);
    }
    return out;
}
// Where a worker should stand to use this machine. Strongly prefers the front. The side the door,
// screen or hatch is actually on, because picking whichever tile merely happened to be nearest
// had staff working fridges through the back panel. Falls back to any reachable side rather than
// refusing the job outright, so a machine shoved against a wall still gets used.
function accessTile(e, from) {
    const nv = nav();
    let best = null, bestLen = Infinity;
    for (const [x, z] of frontTiles(e)) {
        if (x < 0 || z < 0 || x >= GRID || z >= GRID || nv[z * GRID + x]) continue;
        const p = aStar(nv, GRID, GRID, from.tx, from.tz, x, z);
        if (p && p.length < bestLen) { bestLen = p.length; best = [x, z]; }
    }
    if (best) return best;
    return nearestAccess(nv, GRID, GRID, footTiles(e.type, e.tx, e.tz, e.rot), from.tx, from.tz);
}

function freeSlots(e) { return (BUILD[e.type].slots || 0) - (e.processing ? e.processing.length : 0) - (e.reserved || 0); }
// A machine that's on fire, or shut inside a sealed containment room, is off the board: nobody
// is sent to it and nothing is counted as served by it, so work reroutes to whatever's left
// rather than piling up outside a door that won't open.
export function stationUsable(e) { return !isBurning(e) && !isQuarantined(e) && !underService(e); }
function stationsFor(cap) { return G.state.equipment.filter(e => stationUsable(e) && equipCaps(e).includes(cap)); }
// A station's batch capacity is shared across every cap it serves. A bench holding 3 samples
// for prep has no room left for analysis either, they're the same 3 physical slots. Occupancy
// counts what's actually staged there (any cap) plus samples already claimed and walking toward
// ANY of that station's caps but not yet arrived (we don't know which specific station a claimed
// sample will land at until it gets there, so it's attributed to every station that could take
// it — conservative, but necessary: counting only staged.length let every free worker in the
// building claim one in the same tick, none of them visible in `staged` yet, and the station
// ended up staged well past its batch size — worse, prep and analyze claims raced independently
// since each only checked its own cap, so a bench could fill with 3 of each at once.
function stationOccupancy(e) {
    let n = (e.staged ? e.staged.length : 0);
    const caps = equipCaps(e);
    for (const sm of G.state.samples) {
        if (sm.claimedBy == null || sm.state === 'staged' || sm.state === 'processing') continue;
        if (caps.includes(curStep(sm).cap)) n++;
    }
    return n;
}
// Is there any working station for this cap with room left? Once a station's batch capacity is
// already spoken for, fetching yet another sample for it right now doesn't help — better to
// leave the excess for cold storage (see the coldStore branch in assignJob) than have it pile up
// unrefrigerated at a machine that doesn't need it yet.
function anyStationWantsMore(cap) {
    return stationsFor(cap).some(e => !e.broken && stationOccupancy(e) < (BUILD[e.type].batch || 1));
}

function bestStation(cap, w) {
    const list = stationsFor(cap);
    if (!list.length) return null;
    const from = worldToTile(w.wx, w.wz);
    let best = null, score = Infinity;
    for (const e of list) {
        const acc = accessTile(e, from);
        if (!acc) continue;
        const p = aStar(nav(), GRID, GRID, from.tx, from.tz, acc[0], acc[1]);
        const len = p ? p.length : 999;
        const load = ((e.processing ? e.processing.length : 0) + (e.reserved || 0)) * 6;
        const sc = len + load - freeSlots(e) * 2;
        if (sc < score) { score = sc; best = { e, acc }; }
    }
    return best;
}

// Mop Closets and Sinks both count as "clean supply" for a mopping speed bonus. Restocking
// mops or rinsing them out, either way it's faster to mop near a water source.
function nearCleanSupply(w) {
    for (const e of G.state.equipment) {
        const kind = BUILD[e.type].kind;
        if (kind !== 'clean' && kind !== 'water') continue;
        const c = tileToWorld(e.tx, e.tz);
        if (Math.hypot(w.wx - c.x, w.wz - c.z) < 4) return true;
    }
    return false;
}

// Which reagent to brew next. Strictly what the player has ordered — the lab no longer tops
// itself up. Reagents perish, so deciding *when* to brew is the whole point of the ingredient
// economy; a lab that brewed automatically the moment a stock solution dipped made that decision
// for you and then quietly binned the surplus.
function reagentToPrep() {
    const s = G.state;
    if (s.water < REAGENT_WATER_COST) return null;               // no distilled water, no prep
    let want = null, mostWanted = 0;
    for (const [k, r] of Object.entries(REAGENTS)) {
        const queued = (s.brewOrders && s.brewOrders[k]) || 0;
        if (queued <= 0) continue;
        if ((s.ingredients[r.ingredient] || 0) < REAGENT_BATCH) continue;     // out of raw material
        if (queued > mostWanted) { mostWanted = queued; want = k; }
    }
    return want;
}

// A crate waiting at the door. The stockroom is an annex that always exists, so unlike the old
// buildable version there's always somewhere to take it. What varies is how much it holds.
let _stockSpot = 0;
function pickCrateJob(w) {
    const s = G.state;
    if (!s.deliveries || !s.deliveries.length) return false;
    // A claim is only real while a live worker is actually on that job. Anything else is a stale
    // claim, and a stale claim strands the crate permanently, so it's treated as free rather than
    // trusted. Belt and braces on top of the reset in loadSave: this is the kind of bookkeeping
    // that quietly rots the moment a new code path forgets to release something.
    const held = new Set();
    for (const o of s.staff) if (o.job && o.job.crateId != null) held.add(o.job.crateId);
    const from = worldToTile(w.wx, w.wz);
    let crate = null, bestD = Infinity;
    for (const c of s.deliveries) {
        if (c.claimedBy != null && !held.has(c.id)) c.claimedBy = null;   // stale, reclaim it
        if (c.claimedBy) continue;
        const t = worldToTile(c.wx, c.wz);
        const d = Math.abs(t.tx - from.tx) + Math.abs(t.tz - from.tz);
        if (d < bestD) { bestD = d; crate = c; }
    }
    if (!crate) return false;
    crate.claimedBy = w.id;
    // Spread arrivals across the annex's free tiles so two people unloading don't stand in each
    // other's models on the same square.
    w.job = { crateId: crate.id, stockTile: stockTile(s, _stockSpot++) };
    const t = worldToTile(crate.wx, crate.wz);
    setGoalTile(w, [t.tx, t.tz]);
    w.state = 'toCrate';
    return true;
}

// Claims the spill for this worker so topDirtTile() won't hand it to anyone else. A later
// responder to the same mess simply never sees it as a candidate.
function claimMop(w, dirtiest) {
    w.job = { mopKey: dirtiest.key };
    G.state.dirtClaims[dirtiest.key] = w.id;
    setGoalTile(w, dirtiest.tile);
    w.state = 'toMop';
}

// A full (or timed-out) batch sitting staged doesn't run itself — someone has to walk over and
// start it. Checked before fetching more raw samples so a loaded machine gets attended to
// promptly instead of sitting untouched while everyone's off doing something else.
//
// e.operateClaim marks a station as already being walked to by someone, same reasoning as
// assignMechanicJob's fixClaim above — without it, every free worker in the building would head
// for the same ready batch at once (the visible "grouping up"), and all but the one who actually
// got there and started it would get reset() the next tick once batchReady() saw the batch was
// gone (the visible "back to the break room a second later").
function findReadyBatchJob(w) {
    const s = G.state;
    const from = worldToTile(w.wx, w.wz);
    for (const e of s.equipment) {
        if (BUILD[e.type].autoStart || e.operateClaim != null) continue;   // starts itself — see updateEquipment()
        if (!stationUsable(e)) continue;
        const group = batchReady(e);
        if (!group) continue;
        const acc = accessTile(e, from);
        if (!acc) continue;
        e.operateClaim = w.id;
        w.job = { operateId: e.id };
        setGoalTile(w, acc); w.state = 'toOperate';
        return true;
    }
    return false;
}

function assignJob(w) {
    const s = G.state;
    const caps = w.caps;
    // Mechanic work is checked first for anyone who can do it — a broken or worn machine sitting
    // idle is worse than a delayed sample fetch — but it's no longer exclusive: a worker with
    // Process + Mechanic both checked falls through to normal work once nothing needs fixing.
    const dirtiest = caps.clean ? topDirtTile() : null;

    if (dirtiest && (!caps.process || cleanliness() < 65)) {
        claimMop(w, dirtiest); return true;
    }
    if (caps.process && findReadyBatchJob(w)) return true;
    if (caps.process && pickSampleJob(w)) return true;
    if (caps.process && s.coldStore) {
        // A sample also becomes fridge-worthy once its next station already has enough staged
        // for its next run, no benefit rushing more over right now, so chill the surplus
        // instead of letting it pile up unrefrigerated at a machine that doesn't need it yet.
        // Of everything eligible, shelve the most urgent one first — same priority used to pick
        // what to process next, so a sample about to blow its deadline doesn't sit around behind
        // one that just happens to be a hair fresher.
        let candidate = null, bestCandScore = -Infinity;
        for (const x of s.samples) {
            if (x.state !== 'queued' || x.claimedBy || x.storedAt) continue;
            if (isInert(x)) continue;   // a report can't spoil — shelving one wastes a trip and a shelf
            if (!(x.fresh < COLD_STORE_THRESHOLD || !anyStationWantsMore(curStep(x).cap))) continue;
            const score = samplePriority(x);
            if (score > bestCandScore) { bestCandScore = score; candidate = x; }
        }
        if (candidate) {
            const from = worldToTile(w.wx, w.wz);
            for (const e of s.equipment) {
                if (BUILD[e.type].kind !== 'cold' || !stationUsable(e) || freeSlots(e) <= 0) continue;
                const acc = accessTile(e, from);
                if (!acc) continue;
                candidate.claimedBy = w.id;
                e.reserved = (e.reserved || 0) + 1;
                w.reservedStation = e.id;
                w.job = { coldSampleId: candidate.id, stationId: e.id, fridgeAcc: acc };
                const t = worldToTile(candidate.wx, candidate.wz);
                setGoalTile(w, [t.tx, t.tz]);
                w.state = 'toColdPickup';
                return true;
            }
        }
    }
    // Putting a delivery away comes before fetching more samples: crates block the doorway, their
    // contents can't be used until they're on a shelf, and a run that needs them is stalled in the
    // meantime. Cheap to check — usually there's nothing waiting.
    if (caps.process && pickCrateJob(w)) return true;
    // Ordering. Checked after the hands-on work: a shelf that needs topping up in three days'
    // time is never more urgent than a sample rotting now, and the desk will still be there.
    if (caps.orders && pickOrderJob(w)) return true;
    if (caps.process && s.water < WATER_MIN) {
        const from = worldToTile(w.wx, w.wz);
        for (const e of s.equipment) {
            if (BUILD[e.type].kind !== 'water' || !stationUsable(e) || freeSlots(e) <= 0) continue;
            const acc = accessTile(e, from);
            if (!acc) continue;
            e.reserved = (e.reserved || 0) + 1;
            w.reservedStation = e.id;
            w.job = { fillWater: true, stationId: e.id };
            setGoalTile(w, acc); w.state = 'toSink';
            return true;
        }
    }
    if (caps.process) {
        const rk = reagentToPrep();
        if (rk) {
            const from = worldToTile(w.wx, w.wz);
            for (const e of s.equipment) {
                if (!equipCaps(e).includes('prep') || freeSlots(e) <= 0) continue;
                const acc = accessTile(e, from);
                if (!acc) continue;
                const ing = REAGENTS[rk].ingredient;
                if ((s.ingredients[ing] || 0) < REAGENT_BATCH || s.water < REAGENT_WATER_COST) break;   // depleted since reagentToPrep() checked
                s.ingredients[ing] -= REAGENT_BATCH;
                s.water -= REAGENT_WATER_COST;
                s.brewOrders[rk] = Math.max(0, (s.brewOrders[rk] || 0) - 1);   // claimed off the order book
                e.reserved = (e.reserved || 0) + 1;
                w.reservedStation = e.id;
                w.job = { prepReagent: rk, stationId: e.id, ingredient: ing, water: REAGENT_WATER_COST, brewOrder: rk };
                s.prepping[rk] = (s.prepping[rk] || 0) + 1;
                setGoalTile(w, acc); w.state = 'toPrep';
                return true;
            }
        }
    }
    if (dirtiest) {
        claimMop(w, dirtiest); return true;
    }
    return false;
}

// Is there genuinely nothing coming? Anything staged is sitting on a batch timer and will want
// somebody shortly; anything queued or waiting at the door wants somebody now. Cheap enough to
// run per idle worker per tick. These lists are short, and it short-circuits on the first hit.
function labIsQuiet() {
    const s = G.state;
    if (s.deliveries && s.deliveries.length) return false;            // crates to shelve, right now
    // A queued sample is only pending work if somebody could actually pick it up right now, which
    // is the same test pickSampleJob() applies: a station for its step that still has room in its
    // batch. Checking merely that such a machine *exists* counted samples nobody could touch --
    // the case being a lab blocked on an order, where every bench is already loaded with a batch
    // that cannot run for want of stock and the rest of the samples sit queued behind it. That
    // read as pending work, so everyone stood to attention beside a machine that was not going to
    // start until the delivery arrived the next morning, instead of waiting it out in the break
    // room. A batch that is merely part-full, and so still wants more, keeps the lab busy exactly
    // as it did before.
    if (s.samples.some(sm => sm.state === 'queued' && !sm.storedAt
        && stationsFor(curStep(sm).cap).length && anyStationWantsMore(curStep(sm).cap))) return false;
    // And a staged batch only counts if it could actually run. One that's stopped for want of
    // consumables will not become available until a delivery lands — and a delivery brings crates,
    // which makes the lab busy again on its own. Counting it kept everyone stood to attention
    // beside a machine that was never going to start, instead of going back to the break room.
    for (const e of s.equipment) {
        if (!e.staged || !e.staged.length) continue;
        if (!runShortage(e.staged[0].cap, e.staged[0].proto, 1)) return false;
    }
    return true;
}

export function updateStaff(dt) {
    const s = G.state;
    let restIdx = 0;

    for (const sm of s.samples) {
        if (sm.state !== 'queued') continue;
        const cap = curStep(sm).cap;
        if (!stationsFor(cap).length && !s.warns['notool_' + cap]) {
            s.warns['notool_' + cap] = 1;
            // Distinguish "you never built one" from "the one you have is shut inside a sealed
            // room". The advice is completely different, and telling someone mid-outbreak to go
            // and build another Flow Hood is the wrong one.
            const shutAway = s.equipment.some(e => !stationUsable(e) && equipCaps(e).includes(cap));
            G.onToast(shutAway
                ? `The only machine for the "${CAP_LABEL[cap]}" step is out of reach. Work is on hold`
                : `No machine for the "${CAP_LABEL[cap]}" step. Build one`, true);
        }
    }

    let musterIdx = 0, homeIdx = 0;
    for (const w of s.staff) {
        // Two reasons someone isn't working: the building is being evacuated, or they're off
        // sick after an exposure. Both send them to the pavement outside and keep them there —
        // checked before anything else so no job can be assigned or continued in the meantime.
        const out = s.evacuating ? 'evacuating' : (w.illUntil != null && s.day < w.illUntil ? 'sick' : null);
        if (out) {
            if (w.state !== out && w.state !== out + 'Done') {
                resetWorker(w);
                w.state = out;
                setGoalTile(w, musterTile(out === 'evacuating' ? musterIdx++ : 8 + homeIdx++));
            } else if (out === 'evacuating') musterIdx++; else homeIdx++;
            if (w.state === out) {
                const r = stepPath(w, dt);
                if (r === 'arrived' || r === 'blocked') w.state = out + 'Done';
            }
            continue;
        }
        if (w.state === 'sickDone') { w.state = 'idle'; w.path = null; }

        // Anyone owed a perk always has something to pick from. Levels earned inside grantSkillXp
        // generate their own choices, but a save migrated from before careers existed arrives
        // owed picks with none generated, which would show the player an empty chooser.
        if (perksOwed(w) > 0 && !(w.perkChoices && w.perkChoices.length)) offerPerks(w);

        giveWay(w, dt);              // whoever needs this square least steps off it

        if (w.state === 'idle' || w.state === 'resting') {
            if (!assignJob(w)) {
                if (w.state === 'resting') {
                    restIdx++;
                    stepPath(w, dt);
                } else {
                    // A worker with nothing to do right now stays exactly where they are. They
                    // only set off for the break room when the lab itself is quiet. Nothing
                    // staged and waiting on a batch timer, nothing queued, no crates to put away.
                    //
                    // Standing still is the important half. "Nothing to do" is usually momentary:
                    // someone stages the sample that completes a batch, has a few seconds spare
                    // while BATCH_MAX_WAIT runs down, and the old code sent them off to the break
                    // room for a coffee quote, only to turn them round before they arrived. The
                    // round trip was pure noise, and it read as the staff being scatterbrained.
                    w.idleTimer = (w.idleTimer || 0) + dt;
                    if (w.idleTimer > IDLE_GRACE_PERIOD && labIsQuiet()) {
                        const [rx, rz] = restTile(s, restIdx++); setGoalTile(w, [rx, rz]); w.state = 'resting';
                        w.idleTimer = 0;
                    }
                }
                continue;
            }
            w.idleTimer = 0;
        }

        // Every state below reads w.job. They're always set together — resetWorker() clears the
        // job and drops the worker to 'idle' in the same breath — but if that ever came apart,
        // the dereference below would throw out of updateStaff and take the whole tick loop with
        // it: no staff, no samples, no clock. Cheap to make that a recoverable hiccup instead.
        if (!w.job && w.state !== 'idle' && w.state !== 'resting' &&
            w.state !== 'evacuating' && w.state !== 'evacuatingDone' &&
            w.state !== 'sick' && w.state !== 'sickDone') {
            console.warn('worker in state', w.state, 'with no job — resetting');
            resetWorker(w);
            continue;
        }

        switch (w.state) {
            case 'toCrate': {
                const c = (s.deliveries || []).find(x => x.id === w.job.crateId);
                if (!c) { resetWorker(w); break; }
                const r = stepPath(w, dt);
                if (r === 'blocked') resetWorker(w);
                else if (r === 'arrived') {
                    w.carryingCrate = c.id;
                    setGoalTile(w, w.job.stockTile); w.state = 'toStock';
                }
                break;
            }
            case 'toStock': {
                const c = (s.deliveries || []).find(x => x.id === w.job.crateId);
                if (!c) { resetWorker(w); break; }
                c.wx = w.wx; c.wz = w.wz;                     // the crate travels with them
                const r = stepPath(w, dt);
                if (r === 'blocked') resetWorker(w);
                else if (r === 'arrived') { w.state = 'stocking'; w.tendTimer = 0; }
                break;
            }
            case 'stocking': {
                w.tendTimer += dt;
                if (w.tendTimer < STOCK_UNLOAD_TIME) break;
                const c = (s.deliveries || []).find(x => x.id === w.job.crateId);
                if (c) {
                    addStock(c.key, c.qty);
                    s.deliveries = s.deliveries.filter(x => x !== c);
                    s.stats.shelved = (s.stats.shelved || 0) + 1;
                }
                w.carryingCrate = null;
                resetWorker(w);
                dirtyUI();
                break;
            }
            case 'toMop': {
                const r = stepPath(w, dt);
                if (r === 'blocked') resetWorker(w);
                else if (r === 'arrived') { w.state = 'mopping'; w.tendTimer = 0; }
                break;
            }
            case 'mopping': {
                const rate = (nearCleanSupply(w) ? 1.4 : 1) * (1 + 0.22 * s.upgrades.clean) * staffMods(w).mop;
                w.tendTimer += dt * rate;
                if (w.tendTimer >= 4) {
                    delete s.dirt[w.job.mopKey];
                    recomputeGrime();
                    s.stats.mopped++;
                    resetWorker(w);
                }
                break;
            }
            case 'toDesk': {
                const e = s.equipment.find(x => x.id === w.job.deskId);
                if (!e || !stationUsable(e)) { resetWorker(w); break; }
                const r = stepPath(w, dt);
                if (r === 'blocked') resetWorker(w);
                else if (r === 'arrived') { w.state = 'ordering'; w.tendTimer = 0; }
                break;
            }
            case 'ordering': {
                const e = s.equipment.find(x => x.id === w.job.deskId);
                if (!e || !stationUsable(e)) { resetWorker(w); break; }
                w.tendTimer += dt;
                if (w.tendTimer < ORDER_DESK_TIME) break;
                // Re-planned on arrival rather than reusing what was true when they set off: a
                // few seconds of walking is long enough for a run to eat the stock, or for the
                // player to have ordered the same thing themselves.
                placeOrders(orderPlan());
                resetWorker(w);
                break;
            }
            case 'toPickup': {
                // w.job.sampleIds is a cart's worth — 1 by default, more with the Sample Cart
                // upgrade. They were all claimed together from the same queue and share a
                // destination, so one trip serves all of them.
                const ids = w.job.sampleIds;
                const first = s.samples.find(x => x.id === ids[0]);
                if (!first || first.state !== 'queued') { resetWorker(w); break; }
                const r = stepPath(w, dt);
                if (r === 'blocked') resetWorker(w);
                else if (r === 'arrived') {
                    if (!routeToStation(w)) { resetWorker(w); break; }
                    for (const id of ids) {
                        const sm = s.samples.find(x => x.id === id);
                        if (!sm) continue;
                        if (sm.storedAt) {
                            const fr = s.equipment.find(e => e.id === sm.storedAt);
                            if (fr) fr.processing = fr.processing.filter(p => p.sampleId !== sm.id);
                            sm.storedAt = null;
                        }
                        sm.state = 'carried';
                    }
                    w.carrying = ids.slice(); w.state = 'toStation';
                }
                break;
            }
            case 'toStation': {
                const ids = w.job.sampleIds;
                let any = false;
                for (const id of ids) {
                    const sm = s.samples.find(x => x.id === id);
                    if (sm) { sm.wx = w.wx; sm.wz = w.wz; any = true; }
                }
                if (!any) { resetWorker(w); break; }
                const r = stepPath(w, dt);
                if (r === 'blocked') { if (!routeToStation(w)) resetWorker(w); }
                else if (r === 'arrived') { w.state = 'atStation'; w.tendTimer = 0; }
                break;
            }
            case 'atStation': {
                // The worker's job ends at drop-off, no more standing around tending a whole
                // run. Each sample waits in the station's staging area until a worker (maybe this
                // one, maybe another — see findReadyBatchJob/'toOperate' below) comes back to
                // actually start a run once enough of the same request pile up, or the oldest
                // one's waited too long. See systems/equipment.js.
                const st = s.equipment.find(e => e.id === w.job.stationId);
                if (!st) { resetWorker(w); break; }
                if (w.reservedStation === st.id) { st.reserved = Math.max(0, st.reserved - 1); w.reservedStation = null; }
                for (const id of w.job.sampleIds) {
                    const sm = s.samples.find(x => x.id === id);
                    if (sm) stageSample(st, sm);
                }
                resetWorker(w);
                break;
            }
            case 'toOperate': {
                const e = s.equipment.find(x => x.id === w.job.operateId);
                if (!e || !batchReady(e)) { resetWorker(w); break; }
                const r = stepPath(w, dt);
                if (r === 'blocked') resetWorker(w);
                else if (r === 'arrived') { w.state = 'operating'; w.tendTimer = 0; }
                break;
            }
            case 'operating': {
                const e = s.equipment.find(x => x.id === w.job.operateId);
                const group = e && batchReady(e);
                if (!e || !group) { resetWorker(w); break; }
                w.tendTimer += dt;
                if (w.tendTimer < BATCH_LOAD_TIME) break;
                const entry = startRun(e, group);
                // The worker who actually started the run gets skill credit for it. A leveled-up
                // specialist runs this cap faster and a touch cleaner than a first-timer would.
                if (entry) {
                    // Learned skill at this cap, then who the person is on top of it: traits and
                    // chosen perks multiply the same duration and quality the skill level does,
                    // so the two stack rather than one overriding the other.
                    const lvl = skillLevel(w, entry.cap);
                    const mods = staffMods(w);
                    const skillSpeed = lvl > 0 ? Math.max(0.3, 1 - SKILL_SPEED_PER_LEVEL * lvl) : 1;
                    entry.dur *= skillSpeed * mods.speed;
                    const qBonus = (lvl > 0 ? 1 + SKILL_QUALITY_PER_LEVEL * lvl : 1) * mods.quality;
                    if (qBonus !== 1) {
                        for (const id of entry.sampleIds) {
                            const sm = s.samples.find(x => x.id === id);
                            if (sm) sm.quality = Math.max(0, Math.min(1, sm.quality * qBonus));
                        }
                    }
                    // A gentle operator is easier on the machine than a heavy-handed one. startRun
                    // has already charged the standard wear, so this refunds or adds the balance.
                    if (mods.wear !== 1 && e.condition != null) {
                        const charged = WEAR_PER_RUN + WEAR_PER_EXTRA_BATCH_SAMPLE * (entry.sampleIds.length - 1);
                        e.condition = Math.max(0, Math.min(100, e.condition + charged * (1 - mods.wear)));
                    }
                    grantSkillXp(w, entry.cap, entry.sampleIds.length);
                }
                // Automated/spinning/incubating equipment finishes on its own from here. Hands-on
                // bench work doesn't — a scientist stays put until the run they just started
                // actually completes, instead of wandering off the moment it begins.
                if (entry && BUILD[e.type].attended) {
                    w.job.tendEntry = entry;
                    w.state = 'tending'; w.tendTimer = 0;
                } else {
                    resetWorker(w);
                }
                break;
            }
            case 'tending': {
                const e = s.equipment.find(x => x.id === w.job.operateId);
                const stillRunning = e && e.processing && e.processing.includes(w.job.tendEntry);
                if (!stillRunning) resetWorker(w);   // run finished (or the machine's gone), free up
                break;
            }
            case 'toPrep': {
                const st = s.equipment.find(e => e.id === w.job.stationId);
                if (!st) { refundPrepReservation(w); resetWorker(w); break; }
                const r = stepPath(w, dt);
                if (r === 'blocked') { refundPrepReservation(w); resetWorker(w); }
                else if (r === 'arrived') { w.state = 'prepping'; w.tendTimer = 0; }
                break;
            }
            case 'prepping': {
                w.tendTimer += dt;
                if (w.tendTimer < REAGENT_PREP_TIME) break;
                const rk = w.job.prepReagent;
                for (let i = 0; i < REAGENT_BATCH; i++)
                    s.reagents.push({ id: nid(), type: rk, expire: s.day + REAGENTS[rk].shelf });
                const st = s.equipment.find(e => e.id === w.job.stationId);
                if (st) addDirt(st, 4);
                delete s.warns['noreg_' + rk];
                G.onToast(`Prepared ${REAGENT_BATCH}× ${REAGENTS[rk].name}`);
                resetWorker(w);
                break;
            }
            case 'toSink': {
                const st = s.equipment.find(e => e.id === w.job.stationId);
                if (!st) { resetWorker(w); break; }
                const r = stepPath(w, dt);
                if (r === 'blocked') resetWorker(w);
                else if (r === 'arrived') { w.state = 'filling'; w.tendTimer = 0; }
                break;
            }
            case 'filling': {
                w.tendTimer += dt;
                if (w.tendTimer < WATER_FILL_TIME) break;
                s.water += WATER_BATCH;
                dirtyUI();
                resetWorker(w);
                break;
            }
            case 'toColdPickup': {
                const sm = s.samples.find(x => x.id === w.job.coldSampleId);
                if (!sm || sm.state !== 'queued' || sm.storedAt) { resetWorker(w); break; }
                const r = stepPath(w, dt);
                if (r === 'blocked') resetWorker(w);
                else if (r === 'arrived') {
                    // Used to leave the sample's state as 'queued' for this whole carry — which
                    // meant updateSamples()'s "snap every free-queued sample back to its lobby
                    // slot" loop (it runs before staff each tick) kept fighting this state's own
                    // wx/wz update for who's "really" driving the sample's position, and lost
                    // exactly one tick right at this transition (this case runs, not 'toFridge',
                    // the tick the state changes) — a visible snap back to the lobby before
                    // catching up again. Marking it 'carried', same as a normal pickup, removes
                    // it from that loop entirely instead of trying to out-order it.
                    sm.state = 'carried'; w.carrying = [sm.id];
                    setGoalTile(w, w.job.fridgeAcc); w.state = 'toFridge';
                }
                break;
            }
            case 'toFridge': {
                const sm = s.samples.find(x => x.id === w.job.coldSampleId);
                const st = s.equipment.find(e => e.id === w.job.stationId);
                if (!sm || !st) { resetWorker(w); break; }
                sm.wx = w.wx; sm.wz = w.wz;
                const r = stepPath(w, dt);
                if (r === 'blocked') resetWorker(w);
                else if (r === 'arrived') { w.state = 'storing'; w.tendTimer = 0; }
                break;
            }
            case 'storing': {
                const sm = s.samples.find(x => x.id === w.job.coldSampleId);
                const st = s.equipment.find(e => e.id === w.job.stationId);
                if (!sm || !st) { resetWorker(w); break; }
                w.tendTimer += dt;
                if (w.tendTimer < COLD_STORE_TIME) break;
                if (w.reservedStation === st.id) { st.reserved = Math.max(0, st.reserved - 1); w.reservedStation = null; }
                st.processing.push({ sampleId: sm.id, cap: 'store', proto: sm.proto, t: 0, dur: Infinity });
                const wt = tileToWorld(w.job.fridgeAcc[0], w.job.fridgeAcc[1]);
                sm.wx = wt.x; sm.wz = wt.z;
                sm.state = 'queued';   // back to the representation the rest of the game expects
                sm.storedAt = st.id;   // for a stored sample: 'queued' + storedAt set
                sm.claimedBy = null;
                G.onToast(`Stored a sample in the ${BUILD[st.type].name}`);
                resetWorker(w);
                break;
            }
        }
    }
}

// Higher = more urgent = picked first. Freshness dominates — a spoiled sample is lost outright,
// not just late — with a deadline bonus that ramps up once a contract is genuinely close to
// failing, so staff work through what's about to expire or about to blow a deadline before
// whatever merely happens to sit first in the list.
function samplePriority(sm) {
    const c = G.state.contracts.find(x => x.id === sm.contractId);
    const daysLeft = c ? c.deadline - G.state.day : 99;
    const deadlinePressure = Math.max(0, 10 - daysLeft) * 8;
    return (100 - sm.fresh) + deadlinePressure;
}

// A trip to the Procurement Desk, taken only when there is actually something to order and a
// free desk to do it at. orderPlan() is asked first so nobody walks across the lab to sit down and
// find there was nothing to buy.
function pickOrderJob(w) {
    const s = G.state;
    if (!(s.upgrades.orders > 0)) return false;
    // Any Workstation that nobody is sat at. One mid-run has an analyst in the chair, and
    // ordering is never urgent enough to interrupt one: the shelf is short in days, the run
    // finishes in seconds.
    const desks = s.equipment.filter(e => equipCaps(e).includes('analyze') && stationUsable(e)
        && e.operateClaim == null && !(e.processing && e.processing.length));
    if (!desks.length) return false;
    if (!orderPlan().length) return false;
    const from = worldToTile(w.wx, w.wz);
    for (const e of desks) {
        const acc = accessTile(e, from);
        if (!acc) continue;
        e.operateClaim = w.id;
        w.job = { deskId: e.id };
        setGoalTile(w, acc); w.state = 'toDesk';
        return true;
    }
    return false;
}

function pickSampleJob(w) {
    const s = G.state;
    let first = null, bestScore = -Infinity;
    for (const sm of s.samples) {
        if (sm.state !== 'queued' || sm.claimedBy) continue;
        const cap = curStep(sm).cap;
        if (!stationsFor(cap).length || !anyStationWantsMore(cap)) continue;
        const score = samplePriority(sm);
        if (score > bestScore) { bestScore = score; first = sm; }
    }
    if (!first) return false;
    first.claimedBy = w.id;
    const ids = [first.id];
    // With a Sample Cart upgrade, grab more matching samples from the same queue while there's
    // still room at their destination — one trip instead of several. Cold-stored samples are
    // left out: they'd be a separate detour to the fridge, not something to bundle in here.
    // Among equally-eligible cart-mates (same proto + step, so the same run either way), the
    // most urgent ones still get first claim on the limited seats.
    const capacity = cartCapacity() + staffMods(w).carry;
    if (capacity > 1) {
        const cap = curStep(first).cap;
        const mates = s.samples.filter(sm => sm !== first && sm.state === 'queued' && !sm.claimedBy && !sm.storedAt
            && sm.proto === first.proto && sm.step === first.step);
        mates.sort((a, b) => samplePriority(b) - samplePriority(a));
        for (const sm of mates) {
            if (ids.length >= capacity) break;
            if (!anyStationWantsMore(cap)) break;
            sm.claimedBy = w.id;
            ids.push(sm.id);
        }
    }
    w.job = { sampleIds: ids, stationId: null };
    const t = worldToTile(first.wx, first.wz);
    setGoalTile(w, [t.tx, t.tz]);
    w.state = 'toPickup';
    return true;
}
function routeToStation(w) {
    const s = G.state;
    const first = s.samples.find(x => x.id === w.job.sampleIds[0]);
    if (!first) return false;
    releaseReservation(w);           // don't hold a claim on the station we're leaving behind
    const pick = bestStation(curStep(first).cap, w);
    if (!pick) {
        if (!s.warns['unreach_' + curStep(first).cap]) {
            s.warns['unreach_' + curStep(first).cap] = 1;
            G.onToast(`Can't reach a "${CAP_LABEL[curStep(first).cap]}" machine`, true);
        }
        return false;
    }
    w.job.stationId = pick.e.id;
    pick.e.reserved = (pick.e.reserved || 0) + 1;    // claim it now so other workers route elsewhere
    w.reservedStation = pick.e.id;
    setGoalTile(w, pick.acc);
    return true;
}

function takeReagent(type) {
    const s = G.state;
    let bi = -1, be = Infinity;
    for (let i = 0; i < s.reagents.length; i++)
        if (s.reagents[i].type === type && s.reagents[i].expire < be) { be = s.reagents[i].expire; bi = i; }
    if (bi === -1) return false;
    s.reagents.splice(bi, 1);
    dirtyUI();
    return true;
}
