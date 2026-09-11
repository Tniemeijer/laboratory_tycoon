// ==================== STAFF AI ====================
// Hiring, roles, and the per-worker state machine: fetch a sample, carry it through every
// protocol step at the right machine, or mop, or brew a batch of reagent from raw ingredient.

import {
    BUILD, PROTOCOLS, REAGENTS, REAGENT_BATCH, REAGENT_MIN, REAGENT_PREP_TIME, REAGENT_WATER_COST,
    WATER_BATCH, WATER_MIN, WATER_FILL_TIME, COLD_STORE_THRESHOLD, COLD_STORE_TIME, CAP_LABEL, SURNAMES
} from '../data.js';
import { G, nid, nav, cleanliness, speedMul, staffSpeedMul, maxStaff, reagentCount, dirtyUI } from '../core.js';
import { GRID, tileToWorld, worldToTile, footTiles, restTile, gateWorld } from '../grid.js';
import { aStar, nearestAccess } from '../pathfind.js';
import { addDirt, recomputeGrime, topDirtTile } from './dirt.js';
import { curStep } from './samples.js';
import { completeContract } from './contracts.js';

const STAFF_SPEED = 2.7;

export function hireStaff() {
    const s = G.state;
    if (s.staff.length >= maxStaff()) return G.onToast('Staff at capacity — build Staff Quarters', true);
    if (s.money < s.hireCost) return G.onToast('Not enough money to hire', true);
    s.money -= s.hireCost;
    const w = gateWorld();          // walks in the front door, like a new hire should
    s.staff.push({
        id: nid(), name: `Dr. ${SURNAMES[Math.floor(Math.random() * SURNAMES.length)]}`,
        role: 'any', wx: w.x, wz: w.z, state: 'idle',
        job: null, carrying: null, reservedStation: null,
        path: null, pathV: -1, tendTimer: 0
    });
    s.hireCost = Math.round(s.hireCost * 1.55);
    G.onToast('Hired a scientist');
    dirtyUI();
}
export function setRole(id, role) {
    const w = G.state.staff.find(x => x.id === id);
    if (w) { w.role = role; resetWorker(w); dirtyUI(); }
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
    releaseReservation(w);
    const sampleId = w.job && (w.job.sampleId != null ? w.job.sampleId : w.job.coldSampleId);
    const sm = sampleId != null && G.state.samples.find(x => x.id === sampleId);
    if (sm && sm.state !== 'processing') { sm.state = 'queued'; sm.claimedBy = null; }
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

function freeSlots(e) { return (BUILD[e.type].slots || 0) - (e.processing ? e.processing.length : 0) - (e.reserved || 0); }
function stationsFor(cap) { return G.state.equipment.filter(e => (BUILD[e.type].caps || []).includes(cap)); }

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

function assignJob(w) {
    const s = G.state;
    const canProcess = w.role !== 'clean';
    const canClean = w.role !== 'process';
    const dirtiest = canClean ? topDirtTile() : null;

    if (dirtiest && (w.role === 'clean' || cleanliness() < 65)) {
        claimMop(w, dirtiest); return true;
    }
    if (canProcess && pickSampleJob(w)) return true;
    if (canProcess && s.coldStore) {
        const candidate = s.samples.find(x => x.state === 'queued' && !x.claimedBy && !x.storedAt && x.fresh < COLD_STORE_THRESHOLD);
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
    if (canProcess && s.water < WATER_MIN) {
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
    if (canProcess) {
        const rk = reagentToPrep();
        if (rk) {
            const from = worldToTile(w.wx, w.wz);
            for (const e of s.equipment) {
                if (!(BUILD[e.type].caps || []).includes('prep') || freeSlots(e) <= 0) continue;
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
    const clnFactor = cleanliness() / 100;
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
                if (w.state !== 'resting') { const [rx, rz] = restTile(restIdx++); setGoalTile(w, [rx, rz]); w.state = 'resting'; }
                else restIdx++;
                stepPath(w, dt);
                continue;
            }
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
                const sm = s.samples.find(x => x.id === w.job.sampleId);
                if (!sm || sm.state !== 'queued') { resetWorker(w); break; }
                const r = stepPath(w, dt);
                if (r === 'blocked') resetWorker(w);
                else if (r === 'arrived') {
                    if (sm.storedAt) {
                        const fr = s.equipment.find(e => e.id === sm.storedAt);
                        if (fr) fr.processing = fr.processing.filter(p => p.sampleId !== sm.id);
                        sm.storedAt = null;
                    }
                    if (!routeToStation(w)) { resetWorker(w); break; }
                    sm.state = 'carried'; w.carrying = sm.id; w.state = 'toStation';
                }
                break;
            }
            case 'toStation': {
                const sm = s.samples.find(x => x.id === w.job.sampleId);
                if (!sm) { resetWorker(w); break; }
                sm.wx = w.wx; sm.wz = w.wz;
                const r = stepPath(w, dt);
                if (r === 'blocked') { if (!routeToStation(w)) resetWorker(w); }
                else if (r === 'arrived') { w.state = 'atStation'; w.tendTimer = 0; }
                break;
            }
            case 'atStation': {
                const sm = s.samples.find(x => x.id === w.job.sampleId);
                const st = s.equipment.find(e => e.id === w.job.stationId);
                if (!sm || !st) { resetWorker(w); break; }
                sm.wx = w.wx; sm.wz = w.wz;
                const reserved = st.reserved > 0 && w.reservedStation === st.id;
                if (freeSlots(st) > 0 || reserved) {
                    const step = curStep(sm);
                    let dur = step.t * (BUILD[st.type].timeMul[step.cap] || 1) * speedMul();
                    dur *= 1 + 0.45 * (1 - clnFactor);
                    if (step.reagent) {
                        if (!takeReagent(step.reagent)) {
                            dur *= 1.5; sm.quality *= 0.8;
                            if (!s.warns['noreg_' + step.reagent]) {
                                s.warns['noreg_' + step.reagent] = 1;
                                G.onToast(`Out of ${REAGENTS[step.reagent].name} — quality will suffer`, true);
                            }
                        }
                    }
                    if (cleanliness() < 55) sm.quality *= 0.92;
                    if (w.reservedStation === st.id) { st.reserved = Math.max(0, st.reserved - 1); w.reservedStation = null; }
                    st.processing.push({ sampleId: sm.id, cap: step.cap, proto: sm.proto, t: 0, dur });
                    sm.state = 'processing';
                    w.state = 'tending';
                } else {
                    w.tendTimer += dt;
                    if (w.tendTimer > 4) { w.tendTimer = 0; routeToStation(w); w.state = 'toStation'; }
                }
                break;
            }
            case 'tending': {
                const st = s.equipment.find(e => e.id === w.job.stationId);
                const p = st && st.processing.find(x => x.sampleId === w.job.sampleId);
                if (!st || !p) { resetWorker(w); break; }
                p.t += dt;
                if (p.t < p.dur) break;
                st.processing = st.processing.filter(x => x !== p);
                addDirt(st, Math.max(2, 6 - 1.1 * s.upgrades.clean));
                const sm = s.samples.find(x => x.id === w.job.sampleId);
                if (!sm) { resetWorker(w); break; }
                if (sm.step + 1 < PROTOCOLS[sm.proto].steps.length) {
                    sm.step++;
                    if (routeToStation(w)) w.state = 'toStation';
                    else { sm.state = 'queued'; sm.claimedBy = null; resetWorker(w); }
                } else {
                    s.stats.processed++;
                    const c = s.contracts.find(x => x.id === sm.contractId);
                    s.samples = s.samples.filter(x => x !== sm);
                    if (c) {
                        c.done++; c.qsum += Math.max(0.35, sm.quality);
                        if (c.done >= c.required) completeContract(c); else dirtyUI();
                    }
                    resetWorker(w);
                }
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
                else if (r === 'arrived') { setGoalTile(w, w.job.fridgeAcc); w.state = 'toFridge'; }
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
                sm.storedAt = st.id;
                sm.claimedBy = null;
                G.onToast(`Stored a sample in the ${BUILD[st.type].name}`);
                resetWorker(w);
                break;
            }
        }
    }
}

function pickSampleJob(w) {
    const s = G.state;
    const sm = s.samples.find(x => x.state === 'queued' && !x.claimedBy && stationsFor(curStep(x).cap).length);
    if (!sm) return false;
    sm.claimedBy = w.id;
    w.job = { sampleId: sm.id, stationId: null };
    const t = worldToTile(sm.wx, sm.wz);
    setGoalTile(w, [t.tx, t.tz]);
    w.state = 'toPickup';
    return true;
}
function routeToStation(w) {
    const s = G.state;
    const sm = s.samples.find(x => x.id === w.job.sampleId);
    if (!sm) return false;
    releaseReservation(w);           // don't hold a claim on the station we're leaving behind
    const pick = bestStation(curStep(sm).cap, w);
    if (!pick) {
        if (!s.warns['unreach_' + curStep(sm).cap]) {
            s.warns['unreach_' + curStep(sm).cap] = 1;
            G.onToast(`Can't reach a "${CAP_LABEL[curStep(sm).cap]}" machine`, true);
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
