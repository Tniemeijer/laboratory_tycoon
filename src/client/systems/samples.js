// ==================== SAMPLE LIFECYCLE ====================

import { PROTOCOLS, SAMPLE_DECAY_WARM, SPOIL_REP_PENALTY, SPOIL_MONEY_PENALTY } from '../data.js';
import { G, nid, coldDecayRate, cleanliness, dirtyUI } from '../core.js';
import { tileToWorld, gateWorld, queueTile } from '../grid.js';

export function curStep(sm) { return PROTOCOLS[sm.proto].steps[sm.step]; }

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
        const pi = e.processing ? e.processing.findIndex(p => p.sampleId === id) : -1;
        if (pi !== -1) e.processing.splice(pi, 1);
    }
    for (const w of s.staff) {
        if (w.job && (w.job.sampleId === id || w.job.coldSampleId === id)) G.releaseWorkerJob && G.releaseWorkerJob(w);
    }
    s.samples.splice(i, 1);
}

export function updateSamples(dt) {
    const s = G.state;
    // samples parked in a fridge/freezer stay put; everything else queues up at the gate
    const freeQueued = s.samples.filter(x => x.state === 'queued' && !x.storedAt);
    freeQueued.forEach((sm, i) => {
        const [tx, tz] = queueTile(i);
        const wt = tileToWorld(tx, tz);
        sm.wx = wt.x; sm.wz = wt.z;
    });

    const storedRate = coldDecayRate();
    for (const sm of s.samples.slice()) {           // snapshot: abandonSample() below mutates s.samples
        if (sm.state !== 'queued') continue;
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
