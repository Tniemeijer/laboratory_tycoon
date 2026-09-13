// ==================== SAMPLE LIFECYCLE ====================

import { BUILD, PROTOCOLS, SAMPLE_DECAY_WARM, SPOIL_REP_PENALTY, SPOIL_MONEY_PENALTY, INERT_CAPS } from '../data.js';
import { G, nid, nav, coldDecayRate, cleanliness, equipCaps, dirtyUI } from '../core.js';
import { GRID, tileToWorld, worldToTile, gateWorld, queueTile } from '../grid.js';
import { nearestAccess } from '../pathfind.js';
import { removeFromStaging, stageSample } from './equipment.js';

export function curStep(sm) { return PROTOCOLS[sm.proto].steps[sm.step]; }
// A sample that's become a written report (or raw sequencing data) has nothing left in it to
// spoil — see INERT_CAPS. Used both to exempt it from decay and to keep staff from shelving it.
export function isInert(sm) { const st = curStep(sm); return !!st && INERT_CAPS.includes(st.cap); }

export function spawnSample(proto, contractId) {
    const g = gateWorld();
    G.state.samples.push({
        id: nid(), proto, contractId, step: 0,
        state: 'queued', wx: g.x, wz: g.z, fresh: 100, quality: 1, claimedBy: null, storedAt: null
    });
}

export function abandonSample(id) {
    const s = G.state;
    const i = s.samples.findIndex(x => x.id === id);
    if (i === -1) return;
    for (const e of s.equipment) {
        if (!e.processing) continue;
        for (const p of e.processing) {
            // cold-storage entries still carry a lone sampleId; the batched protocol-step
            // pipeline carries a sampleIds array — either shape can hold the abandoned sample.
            if (p.sampleId === id) { e.processing = e.processing.filter(x => x !== p); break; }
            if (p.sampleIds && p.sampleIds.includes(id)) {
                p.sampleIds = p.sampleIds.filter(x => x !== id);
                if (!p.sampleIds.length) e.processing = e.processing.filter(x => x !== p);
                break;
            }
        }
    }
    removeFromStaging(id);
    for (const w of s.staff) {
        if (w.job && (w.job.coldSampleId === id || (w.job.sampleIds && w.job.sampleIds.includes(id)))) G.releaseWorkerJob && G.releaseWorkerJob(w);
    }
    s.samples.splice(i, 1);
}

export function updateSamples(dt) {
    const s = G.state;
    // Fresh arrivals queue up at the gate. A sample that's already been through a step and is
    // now waiting for its next one stays wherever it last was (by the machine it just left) —
    // it no longer has an escort walking it there, so snapping it back to the lobby line would
    // read as it teleporting backwards every time a run finishes.
    const freeQueued = s.samples.filter(x => x.state === 'queued' && !x.storedAt && x.step === 0);
    freeQueued.forEach((sm, i) => {
        const [tx, tz] = queueTile(i);
        const wt = tileToWorld(tx, tz);
        sm.wx = wt.x; sm.wz = wt.z;
    });

    // A sample resting between steps (or staged, waiting on its batch) sits at a fixed floor
    // tile until a worker comes back for it — canPlace() never checks for that, so building new
    // equipment right on top of it trapped it there, unreachable, forever. Nudge it to the
    // nearest still-walkable tile instead. Only 'queued'/'staged' need this: 'carried' samples
    // follow a worker who won't walk into a blocked tile anyway, 'processing' ones are handled
    // via the machine's own access point, and stored ones live inside the fridge, not the floor.
    const nv = nav();
    for (const sm of s.samples) {
        if ((sm.state !== 'queued' && sm.state !== 'staged') || sm.storedAt) continue;
        const { tx, tz } = worldToTile(sm.wx, sm.wz);
        if (!nv[tz * GRID + tx]) continue;   // still walkable — nothing to do
        const spot = nearestAccess(nv, GRID, GRID, [[tx, tz]], tx, tz);
        const w = spot ? tileToWorld(spot[0], spot[1]) : gateWorld();   // boxed in on all sides — fall back to the lobby
        sm.wx = w.x; sm.wz = w.z;
    }

    // Automatic hand-off: some stations take their input over the network rather than by hand (a
    // Server Rack picking reads straight off the sequencer). A sample waiting on one of those
    // doesn't need a scientist to walk it over — it lands in staging on its own, as long as the
    // station has room left in its next run. Nothing claimed by a worker gets pulled out from
    // under them.
    for (const sm of s.samples) {
        if (sm.state !== 'queued' || sm.claimedBy || sm.storedAt) continue;
        const step = curStep(sm);
        if (!step) continue;
        for (const e of s.equipment) {
            const b = BUILD[e.type];
            if (!b.autoFeed || e.broken || !equipCaps(e).includes(step.cap)) continue;
            if ((e.staged ? e.staged.length : 0) >= (b.batch || 1)) continue;
            const w = tileToWorld(e.tx, e.tz);
            sm.wx = w.x; sm.wz = w.z;
            stageSample(e, sm);
            break;
        }
    }

    const storedRate = coldDecayRate();
    for (const sm of s.samples.slice()) {           // snapshot: abandonSample() below mutates s.samples
        // Decay only bites before a sample is ever picked up (or while genuinely cold-stored,
        // which decays slowly on its own schedule regardless of step) — once a scientist has it
        // for a step, waiting for the *next* one is exempt, same as it always was. Letting every
        // later wait decay too turned batching's staging delays into a spoilage death spiral in
        // testing: a few samples stacked up mid-pipeline, a batch missed its window, replacements
        // spawned from the spoilage piled up right behind them, and so on.
        if (sm.state !== 'queued' || (sm.step > 0 && !sm.storedAt)) continue;
        if (isInert(sm)) continue;   // a report doesn't rot, in the fridge or out of it
        sm.fresh -= (sm.storedAt ? storedRate : SAMPLE_DECAY_WARM) * dt;
        if (sm.fresh <= 0) {
            const c = s.contracts.find(x => x.id === sm.contractId);
            abandonSample(sm.id);
            s.stats.spoiled++;
            s.reputation = Math.max(0, s.reputation - SPOIL_REP_PENALTY);
            s.money = Math.max(0, s.money - SPOIL_MONEY_PENALTY);
            if (c) c.spoiledCount = (c.spoiledCount || 0) + 1;
            G.onToast(`A sample spoiled! -${SPOIL_REP_PENALTY} rep, -$${SPOIL_MONEY_PENALTY} wasted. Replacement inbound.`, true);
            if (c) spawnSample(c.proto, c.id);
        }
    }

    // contamination when filthy
    if (s.contaminationCooldown > 0) s.contaminationCooldown -= dt;
    const cl = cleanliness();
    if (cl < 25 && s.contaminationCooldown <= 0) {
        const chance = ((25 - cl) / 25) * 0.12 * dt * 60;   // scaled per second
        if (Math.random() < chance) {
            const victims = s.samples.filter(x => x.state === 'processing');
            if (victims.length) {
                const v = victims[Math.floor(Math.random() * victims.length)];
                const c = s.contracts.find(x => x.id === v.contractId);
                abandonSample(v.id);
                s.stats.contam++;
                s.reputation = Math.max(0, s.reputation - 3);
                s.contaminationCooldown = 6;
                G.onToast('Contamination! A sample was lost. Clean the lab.', true);
                if (c) spawnSample(c.proto, c.id);
            }
        }
    }
}
