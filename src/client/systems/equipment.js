// ==================== EQUIPMENT: BATCHING & RELIABILITY ====================
// Batch-capable machines don't start a run the instant one sample shows up — a worker drops it in
// staging (stageSample) and is immediately free to fetch the next one. A run becomes ready to
// launch (batchReady) once staging fills to the machine's `batch` size, or the oldest sample
// waiting there has been stuck too long (BATCH_MAX_WAIT), but it still needs a worker to actually
// walk over and operate it (startRun, called from staff.js's 'toOperate'/'operating' states) — a
// loaded machine doesn't run itself just because enough material piled up.
//
// Every processing machine also wears down a little on each completed run and can break outright
// on completion once condition is low enough. A broken machine refuses new work until a mechanic
// fixes it — findBrokenEquipment()/findNeedsMaintenance() below are what staff.js's assignJob()
// calls for the 'mechanic' role.

import {
    BUILD, PROTOCOLS, REAGENTS,
    BATCH_MAX_WAIT, BATCH_TIME_PER_EXTRA,
    WEAR_PER_RUN, WEAR_PER_EXTRA_BATCH_SAMPLE, COND_SLOW_THRESHOLD, COND_SLOW_MAX,
    COND_BREAKDOWN_THRESHOLD, COND_BREAKDOWN_CHANCE_MAX, MECH_MAINT_THRESHOLD,
    MECH_CALLOUT_FEE, MECH_REPAIR_COST, MECH_SERVICE_COST,
    ROOM_QUALITY_BONUS, SUPPLIES, SUPPLY_FOR_CAP
} from '../data.js';
import { G, cleanliness, speedMul, insideAnyRoom, dirtyUI } from '../core.js';
import { takeStock } from './economy.js';
import { addDirt } from './dirt.js';
import { completeContract } from './contracts.js';
import { fireRoll, outbreakRoll, isBurning, isQuarantined } from './incidents.js';
import { spawnMechanic, underService, mechanicOnSite } from './visitors.js';

function takeReagent(type) {
    const s = G.state;
    let bi = -1, be = Infinity;
    for (let i = 0; i < s.reagents.length; i++)
        if (s.reagents[i].type === type && s.reagents[i].expire < be) { be = s.reagents[i].expire; bi = i; }
    if (bi === -1) return false;
    s.reagents.splice(bi, 1);
    return true;
}

// Called once a worker arrives at a station with a carried sample — the worker's job ends here;
// the sample now waits in staging for a run to launch (or join one already forming).
export function stageSample(st, sm) {
    const step = PROTOCOLS[sm.proto].steps[sm.step];
    st.staged ||= [];
    st.staged.push({ sampleId: sm.id, cap: step.cap, proto: sm.proto, wait: 0 });
    sm.state = 'staged';
}

// Read-only check for whether this station has a group of staged samples ready to launch — full
// to its batch size, or the oldest one there has waited long enough that it's worth running
// anyway. Doesn't start anything itself: a worker has to actually walk over and operate the
// machine first (see staff.js's 'toOperate'/'operating' states) — equipment doesn't run itself
// just because enough material has piled up.
export function batchReady(st) {
    const b = BUILD[st.type];
    if (st.broken || isBurning(st) || isQuarantined(st) || underService(st) || !st.staged || !st.staged.length) return null;
    if ((st.processing ? st.processing.length : 0) >= (b.slots || 1)) return null;

    // Only identical requests (same protocol + same step) can share a run — group in arrival
    // order so picking "the first N" of a group is already oldest-first.
    const groups = new Map();
    for (const g of st.staged) {
        const key = g.cap + ':' + g.proto;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(g);
    }
    const batch = b.batch || 1;
    for (const list of groups.values()) {
        const oldest = Math.max(...list.map(x => x.wait));
        if (list.length >= batch || oldest >= BATCH_MAX_WAIT) return list;
    }
    return null;
}

// Actually launches a run for a group batchReady() returned — called once a worker has arrived
// to operate the machine. Consumes reagents, applies quality/condition effects and starts the
// timer. For most equipment that's the end of the worker's involvement — updateEquipment() ticks
// it to completion unattended. Attended equipment (the bench: hands-on prep/analysis) is
// different — staff.js keeps the worker there until the returned entry finishes, matching it
// against e.processing each tick.
export function startRun(st, group) {
    const s = G.state;
    const b = BUILD[st.type];
    const batch = b.batch || 1;
    const picked = group.slice(0, Math.min(batch, group.length));
    const ids = new Set(picked.map(x => x.sampleId));
    st.staged = st.staged.filter(x => !ids.has(x.sampleId));

    const { proto, cap } = picked[0];
    const step = PROTOCOLS[proto].steps.find(x => x.cap === cap);
    const samples = picked.map(x => s.samples.find(y => y.id === x.sampleId)).filter(Boolean);
    const n = samples.length;
    if (!n) return null;

    // Consumables for this run. Per-sample items scale with the batch; the expensive per-run ones
    // (a flow cell, a column) are charged once no matter how full the machine is, which is exactly
    // why it's worth waiting for a fuller batch. Running short doesn't stop the work — it's
    // improvised, slower and messier, same as running out of reagent.
    const needed = ['disposable'];
    if (SUPPLY_FOR_CAP[cap]) needed.push(SUPPLY_FOR_CAP[cap]);
    let short = null;
    for (const key of needed) {
        const want = SUPPLIES[key].perSample ? n : 1;
        if (!takeStock(key, want)) short = short || key;
    }
    if (short && !s.warns['nosup_' + short]) {
        s.warns['nosup_' + short] = 1;
        G.onToast(`Out of ${SUPPLIES[short].name} — improvising, slower and messier`, true);
    }

    const clFactor = cleanliness() / 100;
    let dur = step.t * (b.timeMul[cap] || 1) * speedMul();
    dur *= 1 + 0.45 * (1 - clFactor);
    dur *= 1 + BATCH_TIME_PER_EXTRA * (n - 1);
    const condition = st.condition ?? 100;
    if (short) dur *= 1.4;
    const inRoom = insideAnyRoom(st);
    if (condition < COND_SLOW_THRESHOLD) dur *= 1 + (COND_SLOW_THRESHOLD - condition) / COND_SLOW_THRESHOLD * COND_SLOW_MAX;

    for (const sm of samples) {
        if (step.reagent && !takeReagent(step.reagent)) {
            dur *= 1.5; sm.quality *= 0.8;
            if (!s.warns['noreg_' + step.reagent]) {
                s.warns['noreg_' + step.reagent] = 1;
                G.onToast(`Out of ${REAGENTS[step.reagent].name} — quality will suffer`, true);
            }
        }
        if (short) sm.quality *= 0.82;
        if (cleanliness() < 55) sm.quality *= 0.92;
        // Anything run on a machine standing inside a room — any room — is controlled-environment
        // work and comes out that bit cleaner. Checked once per run rather than per sample.
        if (inRoom) sm.quality = Math.min(1, sm.quality * ROOM_QUALITY_BONUS);
        sm.state = 'processing';
    }

    st.processing ||= [];
    const entry = { sampleIds: samples.map(x => x.id), cap, proto, t: 0, dur };
    st.processing.push(entry);
    dirtyUI();
    return entry;
}

function applyWear(st, n) {
    const wear = WEAR_PER_RUN + WEAR_PER_EXTRA_BATCH_SAMPLE * (n - 1);
    st.condition = Math.max(0, (st.condition ?? 100) - wear);
    if (!st.broken && st.condition < COND_BREAKDOWN_THRESHOLD) {
        const chance = (COND_BREAKDOWN_THRESHOLD - st.condition) / COND_BREAKDOWN_THRESHOLD * COND_BREAKDOWN_CHANCE_MAX;
        if (Math.random() < chance) {
            st.broken = true;
            G.onToast(`${BUILD[st.type].name} broke down! Needs a mechanic.`, true);
        }
    }
    // A breakdown is the *good* outcome of neglect. Both of these ride on the same completed-run
    // event, so condition only ever matters on machines that are actually being worked.
    fireRoll(st);
    outbreakRoll(st);
}

function finishRun(st, p) {
    const s = G.state;
    st.processing = st.processing.filter(x => x !== p);
    const n = p.sampleIds.length;
    addDirt(st, Math.max(2, 6 - 1.1 * s.upgrades.clean) * (1 + 0.25 * (n - 1)));

    for (const id of p.sampleIds) {
        const sm = s.samples.find(x => x.id === id);
        if (!sm) continue;
        if (sm.step + 1 < PROTOCOLS[sm.proto].steps.length) {
            sm.step++;
            sm.state = 'queued'; sm.claimedBy = null;
        } else {
            s.stats.processed++;
            const c = s.contracts.find(x => x.id === sm.contractId);
            s.samples = s.samples.filter(x => x !== sm);
            if (c) {
                c.done++; c.qsum += Math.max(0.35, sm.quality);
                if (c.done >= c.required) completeContract(c);
            }
        }
    }
    applyWear(st, n);
    dirtyUI();
}

export function updateEquipment(dt) {
    for (const st of G.state.equipment) {
        const b = BUILD[st.type];
        // Only actual "machines" wear/batch/break — checked by category rather than by caps, so
        // that a run already under way still ticks to completion (and still wears the machine
        // down) even if the room granting its cap gets sold out from under it mid-run.
        if (b.cat !== 'Processing') continue;
        // A machine that's alight, or shut inside a sealed containment room, isn't running
        // anything — its contents were written off when the incident started.
        if (isBurning(st) || isQuarantined(st)) continue;
        if (st.staged && st.staged.length) {
            for (const g of st.staged) g.wait += dt;
            // Automation (e.g. the Prep Robot) skips the "worker walks over to operate it" step
            // entirely — that's the whole point of paying a premium for one.
            if (b.autoStart) { const group = batchReady(st); if (group) startRun(st, group); }
        }
        if (st.processing && st.processing.length)
            for (const p of st.processing.slice()) { p.t += dt; if (p.t >= p.dur) finishRun(st, p); }
    }
}

// ---------- mechanic support (consumed by staff.js's assignJob) ----------
export function findBrokenEquipment() {
    return G.state.equipment.filter(e => e.broken && !isBurning(e) && BUILD[e.type].cat === 'Processing');
}
// Fire alarms are on the list too — an alarm nobody ever services is an alarm that doesn't go
// off (see incidents.js alarmReliability()), which is exactly the trap this system is built on.
export function findNeedsMaintenance() {
    return G.state.equipment.filter(e => !e.broken && !isBurning(e) &&
        (BUILD[e.type].cat === 'Processing' || BUILD[e.type].mount) && (e.condition ?? 100) < MECH_MAINT_THRESHOLD);
}
// ---------- the mechanic ----------
// What a visit would cost and cover if they turned up right now.
export function mechanicQuote() {
    const broken = findBrokenEquipment(), worn = findNeedsMaintenance();
    return {
        broken: broken.length, worn: worn.length,
        cost: (broken.length || worn.length)
            ? MECH_CALLOUT_FEE + broken.length * MECH_REPAIR_COST + worn.length * MECH_SERVICE_COST : 0
    };
}
export function callMechanic() {
    const s = G.state;
    if (s.mechanicDay != null) return G.onToast(`A mechanic is already booked for Day ${s.mechanicDay}`, true);
    if (mechanicOnSite()) return G.onToast(`There's a mechanic on the floor right now — let them finish`, true);
    const q = mechanicQuote();
    if (!q.broken && !q.worn) return G.onToast('Nothing needs fixing or servicing', true);
    s.mechanicDay = s.day + 1;
    G.onToast(`Mechanic booked for Day ${s.mechanicDay} — ${q.broken} to repair, ${q.worn} to service, about $${q.cost.toLocaleString()}`);
    dirtyUI();
}
// Called on the day rollover: the mechanic turns up at the front door that morning with the list
// of everything outstanding — which may be more than was on it when you rang, and is billed
// accordingly. The work itself happens on the floor over the following minute or so, machine by
// machine, as they walk the list; see systems/visitors.js. Nothing is repaired here.
export function mechanicVisit() {
    const s = G.state;
    if (s.mechanicDay == null || s.day < s.mechanicDay) return;
    s.mechanicDay = null;
    const jobs = [
        ...findBrokenEquipment().map(e => ({ id: e.id, repair: true })),
        ...findNeedsMaintenance().map(e => ({ id: e.id, repair: false }))
    ];
    spawnMechanic(jobs);
}

// Cleanup hook for samples.js's abandonSample() — a sample can be sitting in staging rather than
// in `processing` when it's abandoned (contamination, demolition, deadline).
export function removeFromStaging(sampleId) {
    for (const e of G.state.equipment) {
        if (!e.staged) continue;
        const i = e.staged.findIndex(x => x.sampleId === sampleId);
        if (i !== -1) e.staged.splice(i, 1);
    }
}
