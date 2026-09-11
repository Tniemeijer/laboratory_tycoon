// ==================== CONTRACTS ====================

import { PROTOCOLS, MAX_ACTIVE, OFFER_COUNT, ORGS, ADJ, SPOIL_PAYOUT_CUT } from '../data.js';
import { G, nid, labLevel, repMult, dirtyUI } from '../core.js';

function makeOffer() {
    const s = G.state, lv = labLevel();
    const pool = Object.keys(PROTOCOLS).filter(k => PROTOCOLS[k].minLevel <= lv);
    const key = pool[Math.floor(Math.random() * pool.length)];
    const proto = PROTOCOLS[key];
    const steps = proto.steps.length;
    const required = 2 + Math.floor(Math.random() * (lv + 1));
    const per = 120 + steps * 70 + Math.floor(Math.random() * 130) + lv * 20;
    const reward = Math.round(required * per * (1 + 0.1 * lv) * (0.9 + Math.random() * 0.3));
    const repReward = Math.round((6 + required * 2 + steps * 3 + lv * 2) * repMult());
    const deadline = s.day + 4 + steps + Math.floor(Math.random() * 4);
    return {
        id: nid(), org: ORGS[Math.floor(Math.random() * ORGS.length)],
        name: `${ADJ[Math.floor(Math.random() * ADJ.length)]} ${proto.name} panel`,
        proto: key, required, done: 0, qsum: 0, reward, repReward, deadline, state: 'offer'
    };
}
export function refillOffers() { while (G.state.offers.length < OFFER_COUNT) G.state.offers.push(makeOffer()); }

export function acceptContract(id, spawnSample) {
    const s = G.state;
    if (s.contracts.length >= MAX_ACTIVE) return G.onToast('Too many active contracts', true);
    const i = s.offers.findIndex(o => o.id === id);
    if (i === -1) return;
    const c = s.offers.splice(i, 1)[0];
    c.state = 'active';
    s.contracts.push(c);
    for (let k = 0; k < c.required; k++) spawnSample(c.proto, c.id);
    refillOffers();
    G.onToast(`Accepted: ${c.name}`);
    dirtyUI();
}
export function completeContract(c) {
    const s = G.state;
    const qAvg = c.required ? c.qsum / c.required : 1;
    // A client whose order included samples that rotted before delivery doesn't pay full price
    // just because the replacements came out clean — spoilage eats into the payout directly, on
    // top of the immediate rep/money hit taken when each one was lost.
    const spoilCut = Math.min(0.3, (c.spoiledCount || 0) * SPOIL_PAYOUT_CUT);
    const mul = Math.max(0.25, 0.55 + 0.45 * qAvg - spoilCut);
    const cash = Math.round(c.reward * mul);
    const rep = Math.round(c.repReward * mul);
    s.money += cash; s.reputation += rep; s.stats.done++;
    c.state = 'done';
    s.contracts = s.contracts.filter(x => x !== c);
    const spoilNote = c.spoiledCount ? `, ${c.spoiledCount} spoiled` : '';
    G.onToast(`Contract complete! +$${cash}  +${rep} rep  (${Math.round(qAvg * 100)}% quality${spoilNote})`);
    dirtyUI();
}
export function failContract(c, abandonSample) {
    const s = G.state;
    const pen = Math.round(12 + c.required * 4 + PROTOCOLS[c.proto].steps.length * 2);
    s.reputation = Math.max(0, s.reputation - pen);
    s.stats.failed++;
    c.state = 'failed';
    for (const sm of s.samples.slice()) if (sm.contractId === c.id) abandonSample(sm.id);
    s.contracts = s.contracts.filter(x => x !== c);
    G.onToast(`Contract failed: ${c.name}  -${pen} rep`, true);
    dirtyUI();
}
