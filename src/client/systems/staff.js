// ==================== STAFF AI ====================
// Hiring, roles, and the per-worker state machine: fetch a sample, carry it through every
// protocol step at the right machine, or mop, or brew a batch of reagent from raw ingredient.

import {
    BUILD, PROTOCOLS, REAGENTS, REAGENT_BATCH, REAGENT_MIN, REAGENT_PREP_TIME, REAGENT_WATER_COST,
    WATER_BATCH, WATER_MIN, WATER_FILL_TIME, COLD_STORE_THRESHOLD, COLD_STORE_TIME, CAP_LABEL, SURNAMES,
    MECH_REPAIR_TIME, MECH_REPAIR_COST, MECH_MAINT_TIME, BATCH_LOAD_TIME, IDLE_GRACE_PERIOD,
    SKIN_TONES, HAIR_COLORS,
    SKILL_XP_PER_RUN, SKILL_XP_PER_EXTRA_SAMPLE, SKILL_XP_PER_LEVEL, SKILL_MAX_LEVEL,
    SKILL_SPEED_PER_LEVEL, SKILL_QUALITY_PER_LEVEL
} from '../data.js';
import { G, nid, nav, cleanliness, staffSpeedMul, maxStaff, reagentCount, dirtyUI, cartCapacity, equipCaps } from '../core.js';
import { GRID, tileToWorld, worldToTile, footTiles, restTile, gateWorld } from '../grid.js';
import { aStar, nearestAccess } from '../pathfind.js';
import { addDirt, recomputeGrime, topDirtTile } from './dirt.js';
import { curStep } from './samples.js';
import { completeContract } from './contracts.js';
import {
    stageSample, batchReady, startRun, findBrokenEquipment, findNeedsMaintenance, finishRepair, finishMaintenance
} from './equipment.js';

const STAFF_SPEED = 2.7;

export function hireStaff() {
    const s = G.state;
    if (s.staff.length >= maxStaff()) return G.onToast('Staff at capacity — build Staff Quarters', true);
    if (s.money < s.hireCost) return G.onToast('Not enough money to hire', true);
    s.money -= s.hireCost;
    const w = gateWorld();          // walks in the front door, like a new hire should
    s.staff.push({
        id: nid(), name: SURNAMES[Math.floor(Math.random() * SURNAMES.length)],
        caps: { process: true, clean: true, mechanic: false }, wx: w.x, wz: w.z, state: 'idle',
        job: null, carrying: null, reservedStation: null,
        path: null, pathV: -1, tendTimer: 0,
        skin: SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)],
        hairColor: HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)],
        hairLong: Math.random() < 0.5,
        skillXp: {}
    });
    s.hireCost = Math.round(s.hireCost * 1.55);
    G.onToast('Hired a scientist');
    dirtyUI();
}
// Each capability toggles independently — a worker can be Process + Mechanic but not Clean, say.
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
    if (w.job && w.job.operateId != null) {
        const e = G.state.equipment.find(x => x.id === w.job.operateId);
        if (e && e.operateClaim === w.id) e.operateClaim = null;
    }
    if (w.job && w.job.fixId != null) {
        const e = G.state.equipment.find(x => x.id === w.job.fixId);
        if (e && e.fixClaim === w.id) e.fixClaim = null;
    }
    releaseReservation(w);
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
    const step = Math.min(d, STAFF_SPEED * staffSpeedMul() * dt);
    w.wx += dx / d * step; w.wz += dz / d * step;
    return 'moving';
}
function setGoalTile(w, tile) { w.goal = tile; w.path = null; }

// A worker's level at a given task (cap), derived from accumulated XP rather than stored
// directly — keeps the save format simple and means tuning SKILL_XP_PER_LEVEL retroactively
// re-levels everyone instead of leaving old saves stuck at stale numbers.
function skillLevel(w, cap) {
    const xp = (w.skillXp && w.skillXp[cap]) || 0;
    return Math.min(SKILL_MAX_LEVEL, Math.floor(xp / SKILL_XP_PER_LEVEL));
}
function grantSkillXp(w, cap, n) {
    w.skillXp ||= {};
    w.skillXp[cap] = (w.skillXp[cap] || 0) + SKILL_XP_PER_RUN + SKILL_XP_PER_EXTRA_SAMPLE * (n - 1);
}

function freeSlots(e) { return (BUILD[e.type].slots || 0) - (e.processing ? e.processing.length : 0) - (e.reserved || 0); }
function stationsFor(cap) { return G.state.equipment.filter(e => equipCaps(e).includes(cap)); }
// A station's batch capacity is shared across every cap it serves — a bench holding 3 samples
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
        const acc = nearestAccess(nav(), GRID, GRID, footTiles(e.type, e.tx, e.tz, e.rot), from.tx, from.tz);
        if (!acc) continue;
        const p = aStar(nav(), GRID, GRID, from.tx, from.tz, acc[0], acc[1]);
        const len = p ? p.length : 999;
        const load = ((e.processing ? e.processing.length : 0) + (e.reserved || 0)) * 6;
        const sc = len + load - freeSlots(e) * 2;
        if (sc < score) { score = sc; best = { e, acc }; }
    }
    return best;
}

// Mop Closets and Sinks both count as "clean supply" for a mopping speed bonus — restocking
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

// which reagents does an active contract still need, cheapest-to-restock first
function reagentToPrep() {
    const s = G.state;
    if (!s.autoPrep) return null;
    if (s.water < REAGENT_WATER_COST) return null;               // no distilled water, no prep
    const needed = new Set();
    for (const c of s.contracts)
        for (const st of PROTOCOLS[c.proto].steps) if (st.reagent) needed.add(st.reagent);
    let want = null, worst = REAGENT_MIN;
    for (const k of needed) {
        const ing = REAGENTS[k].ingredient;
        if ((s.ingredients[ing] || 0) < REAGENT_BATCH) continue;     // out of raw material
        const eff = reagentCount(k) + (s.prepping[k] || 0) * REAGENT_BATCH;
        if (eff < worst) { worst = eff; want = k; }
    }
    return want;
}

// Claims the spill for this worker so topDirtTile() won't hand it to anyone else — a later
// responder to the same mess simply never sees it as a candidate.
function claimMop(w, dirtiest) {
    w.job = { mopKey: dirtiest.key };
    G.state.dirtClaims[dirtiest.key] = w.id;
    setGoalTile(w, dirtiest.tile);
    w.state = 'toMop';
}

// Mechanics do only repair/maintenance work — never processing or cleaning, and no other role
// ever picks up a wrench. That's deliberate: a broken machine genuinely needs a mechanic hired,
// not just any free scientist wandering over to fix it.
//
// e.fixClaim marks a machine as already being headed to by someone — without it, every free
// mechanic would independently pick the same broken/worn machine in the same tick (nothing here
// stopped them), all converge on it together, and then every one but whoever actually arrived
// first would get reset() the instant the winner fixed it and the 'toRepair'/'toMaintain' guard
// re-checked and found it no longer broken/worn — read as a group forming up, then scattering
// back to idle a moment later, then re-forming on the next thing that needed attention.
function assignMechanicJob(w) {
    const from = worldToTile(w.wx, w.wz);
    if (G.state.money >= MECH_REPAIR_COST) {
        for (const e of findBrokenEquipment()) {
            if (e.fixClaim != null) continue;
            const acc = nearestAccess(nav(), GRID, GRID, footTiles(e.type, e.tx, e.tz, e.rot), from.tx, from.tz);
            if (!acc) continue;
            e.fixClaim = w.id;
            w.job = { fixId: e.id };
            setGoalTile(w, acc); w.state = 'toRepair';
            return true;
        }
    }
    for (const e of findNeedsMaintenance()) {
        if (e.fixClaim != null) continue;
        const acc = nearestAccess(nav(), GRID, GRID, footTiles(e.type, e.tx, e.tz, e.rot), from.tx, from.tz);
        if (!acc) continue;
        e.fixClaim = w.id;
        w.job = { fixId: e.id };
        setGoalTile(w, acc); w.state = 'toMaintain';
        return true;
    }
    return false;
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
        const group = batchReady(e);
        if (!group) continue;
        const acc = nearestAccess(nav(), GRID, GRID, footTiles(e.type, e.tx, e.tz, e.rot), from.tx, from.tz);
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
    if (caps.mechanic && assignMechanicJob(w)) return true;
    const dirtiest = caps.clean ? topDirtTile() : null;

    if (dirtiest && (!caps.process || cleanliness() < 65)) {
        claimMop(w, dirtiest); return true;
    }
    if (caps.process && findReadyBatchJob(w)) return true;
    if (caps.process && pickSampleJob(w)) return true;
    if (caps.process && s.coldStore) {
        // A sample also becomes fridge-worthy once its next station already has enough staged
        // for its next run — no benefit rushing more over right now, so chill the surplus
        // instead of letting it pile up unrefrigerated at a machine that doesn't need it yet.
        // Of everything eligible, shelve the most urgent one first — same priority used to pick
        // what to process next, so a sample about to blow its deadline doesn't sit around behind
        // one that just happens to be a hair fresher.
        let candidate = null, bestCandScore = -Infinity;
        for (const x of s.samples) {
            if (x.state !== 'queued' || x.claimedBy || x.storedAt) continue;
            if (!(x.fresh < COLD_STORE_THRESHOLD || !anyStationWantsMore(curStep(x).cap))) continue;
            const score = samplePriority(x);
            if (score > bestCandScore) { bestCandScore = score; candidate = x; }
        }
        if (candidate) {
            const from = worldToTile(w.wx, w.wz);
            for (const e of s.equipment) {
                if (BUILD[e.type].kind !== 'cold' || freeSlots(e) <= 0) continue;
                const acc = nearestAccess(nav(), GRID, GRID, footTiles(e.type, e.tx, e.tz, e.rot), from.tx, from.tz);
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
    if (caps.process && s.water < WATER_MIN) {
        const from = worldToTile(w.wx, w.wz);
        for (const e of s.equipment) {
            if (BUILD[e.type].kind !== 'water' || freeSlots(e) <= 0) continue;
            const acc = nearestAccess(nav(), GRID, GRID, footTiles(e.type, e.tx, e.tz, e.rot), from.tx, from.tz);
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
                const acc = nearestAccess(nav(), GRID, GRID, footTiles(e.type, e.tx, e.tz, e.rot), from.tx, from.tz);
                if (!acc) continue;
                const ing = REAGENTS[rk].ingredient;
                if ((s.ingredients[ing] || 0) < REAGENT_BATCH || s.water < REAGENT_WATER_COST) break;   // depleted since reagentToPrep() checked
                s.ingredients[ing] -= REAGENT_BATCH;
                s.water -= REAGENT_WATER_COST;
                e.reserved = (e.reserved || 0) + 1;
                w.reservedStation = e.id;
                w.job = { prepReagent: rk, stationId: e.id, ingredient: ing, water: REAGENT_WATER_COST };
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

export function updateStaff(dt) {
    const s = G.state;
    let restIdx = 0;

    for (const sm of s.samples) {
        if (sm.state !== 'queued') continue;
        const cap = curStep(sm).cap;
        if (!stationsFor(cap).length && !s.warns['notool_' + cap]) {
            s.warns['notool_' + cap] = 1;
            G.onToast(`No machine for the "${CAP_LABEL[cap]}" step — build one`, true);
        }
    }

    for (const w of s.staff) {
        if (w.state === 'idle' || w.state === 'resting') {
            if (!assignJob(w)) {
                if (w.state === 'resting') {
                    restIdx++;
                    stepPath(w, dt);
                } else {
                    // A newly-idle worker waits here a moment before actually setting off for
                    // the break room — "nothing to do" is often momentary (they just staged the
                    // sample that'll complete a batch, say), and committing to the walk straight
                    // away meant they'd often be turned right back around a second later.
                    w.idleTimer = (w.idleTimer || 0) + dt;
                    if (w.idleTimer > IDLE_GRACE_PERIOD) {
                        const [rx, rz] = restTile(restIdx++); setGoalTile(w, [rx, rz]); w.state = 'resting';
                        w.idleTimer = 0;
                    }
                }
                continue;
            }
            w.idleTimer = 0;
        }

        switch (w.state) {
            case 'toMop': {
                const r = stepPath(w, dt);
                if (r === 'blocked') resetWorker(w);
                else if (r === 'arrived') { w.state = 'mopping'; w.tendTimer = 0; }
                break;
            }
            case 'mopping': {
                const rate = (nearCleanSupply(w) ? 1.4 : 1) * (1 + 0.22 * s.upgrades.clean);
                w.tendTimer += dt * rate;
                if (w.tendTimer >= 4) {
                    delete s.dirt[w.job.mopKey];
                    recomputeGrime();
                    s.stats.mopped++;
                    resetWorker(w);
                }
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
                // The worker's job ends at drop-off — no more standing around tending a whole
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
                // The worker who actually started the run gets skill credit for it — a leveled-up
                // specialist runs this cap faster and a touch cleaner than a first-timer would.
                if (entry) {
                    const lvl = skillLevel(w, entry.cap);
                    if (lvl > 0) {
                        entry.dur *= Math.max(0.3, 1 - SKILL_SPEED_PER_LEVEL * lvl);
                        const qBonus = 1 + SKILL_QUALITY_PER_LEVEL * lvl;
                        for (const id of entry.sampleIds) {
                            const sm = s.samples.find(x => x.id === id);
                            if (sm) sm.quality = Math.min(1, sm.quality * qBonus);
                        }
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
                if (!stillRunning) resetWorker(w);   // run finished (or the machine's gone) — free up
                break;
            }
            case 'toRepair': {
                const e = s.equipment.find(x => x.id === w.job.fixId);
                if (!e || !e.broken) { resetWorker(w); break; }
                const r = stepPath(w, dt);
                if (r === 'blocked') resetWorker(w);
                else if (r === 'arrived') {
                    if (s.money < MECH_REPAIR_COST) { resetWorker(w); break; }
                    s.money -= MECH_REPAIR_COST;
                    w.state = 'repairing'; w.tendTimer = 0;
                    dirtyUI();
                }
                break;
            }
            case 'repairing': {
                const e = s.equipment.find(x => x.id === w.job.fixId);
                if (!e) { resetWorker(w); break; }
                w.tendTimer += dt;
                if (w.tendTimer < MECH_REPAIR_TIME) break;
                finishRepair(e);
                G.onToast(`${BUILD[e.type].name} repaired`);
                resetWorker(w);
                break;
            }
            case 'toMaintain': {
                const e = s.equipment.find(x => x.id === w.job.fixId);
                if (!e || e.broken) { resetWorker(w); break; }
                const r = stepPath(w, dt);
                if (r === 'blocked') resetWorker(w);
                else if (r === 'arrived') { w.state = 'maintaining'; w.tendTimer = 0; }
                break;
            }
            case 'maintaining': {
                const e = s.equipment.find(x => x.id === w.job.fixId);
                if (!e) { resetWorker(w); break; }
                w.tendTimer += dt;
                if (w.tendTimer < MECH_MAINT_TIME) break;
                finishMaintenance(e);
                resetWorker(w);
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
    const capacity = cartCapacity();
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
