// ==================== CONTRACTS ====================

import { PROTOCOLS, MAX_ACTIVE, OFFER_COUNT, ORGS, ADJ, SPOIL_PAYOUT_CUT, CANCEL_PENALTY_FACTOR, CANCEL_FEE_FACTOR } from '../data.js';
import { G, nid, labLevel, repMult, dirtyUI} from '../core.js';

function makeOffer() {
    const s = G.state, lv = labLevel();
    // No equipment-ownership gate here — a protocol needing a Cleanroom/Dark Room-contained
    // machine (Pharma, Immunofluorescence) is still offered purely by Lab Rating, same as any
    // other; if the right setup isn't built yet, staff.js's usual "no machine for X" warning
    // covers it once a sample actually needs that step.
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

// Samples don't all show up on day one. They trickle in as a few shipments spread across the
// first ~60% of the contract's deadline (leaving the back end free to actually process the last
// one before it's due). That's what makes storage a real decision: you can't just grab every
// sample you'll ever need for the job in one trip, so holding a partial batch in staging or the
// fridge until the rest of a shipment arrives actually pays off.
function makeArrivals(required, day, deadline) {
    const span = Math.max(1, deadline - day);
    const shipments = required <= 3 ? 1 : required <= 6 ? 2 : 3;
    const arrivals = [];
    let remaining = required;
    for (let i = 0; i < shipments; i++) {
        const last = i === shipments - 1;
        const count = last ? remaining : Math.max(1, Math.round(required / shipments));
        remaining -= count;
        const arrivalDay = shipments === 1 ? day : day + Math.round(span * 0.6 * i / (shipments - 1));
        arrivals.push({ day: arrivalDay, count });
    }
    return arrivals;
}
function deliverDue(c, spawnSample) {
    if (!c.arrivals || !c.arrivals.length) return;
    const s = G.state;
    const due = c.arrivals.filter(a => a.day <= s.day);
    if (!due.length) return;
    for (const a of due) for (let i = 0; i < a.count; i++) spawnSample(c.proto, c.id);
    c.arrivals = c.arrivals.filter(a => a.day > s.day);
    dirtyUI();
}
// Called once per day tick (see game.js's advanceTime) so scheduled shipments actually land.
export function checkContractArrivals(spawnSample) {
    for (const c of G.state.contracts) deliverDue(c, spawnSample);
}

export function acceptContract(id, spawnSample) {
    const s = G.state;
    if (s.contracts.length >= MAX_ACTIVE) return G.onToast('Too many active contracts', true);
    const i = s.offers.findIndex(o => o.id === id);
    if (i === -1) return;
    const c = s.offers.splice(i, 1)[0];
    c.state = 'active';
    G.sfx('contract.take');
    c.arrivals = makeArrivals(c.required, s.day, c.deadline);
    s.contracts.push(c);
    deliverDue(c, spawnSample);
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
    G.sfx('contract.done');
    G.onToast(`Contract complete! +$${cash}  +${rep} rep  (${Math.round(qAvg * 100)}% quality${spoilNote})`);
    dirtyUI();
}
// Handing a job back before the deadline. It still costs reputation — you took it on and you're
// walking away, but materially less than being found out at the deadline, because the client
// gets the chance to place it elsewhere. That gap is the whole point: a contract you can't serve
// is worth cancelling early rather than sitting on and hoping.
// What backing out of this job costs, in cash and in reputation. Exported so the button and the
// confirmation can quote the real number rather than a vague warning.
export function cancelCost(c) {
    return {
        fee: Math.max(50, Math.round(c.reward * CANCEL_FEE_FACTOR)),
        rep: Math.max(3, Math.round(failPenalty(c) * CANCEL_PENALTY_FACTOR))
    };
}
export function cancelContract(id, abandonSample) {
    const s = G.state;
    const c = s.contracts.find(x => x.id === id);
    if (!c) return;
    const { fee, rep } = cancelCost(c);
    s.money -= fee;
    s.reputation = Math.max(0, s.reputation - rep);
    s.stats.cancelled = (s.stats.cancelled || 0) + 1;
    for (const sm of s.samples.slice()) if (sm.contractId === c.id) abandonSample(sm.id);
    s.contracts = s.contracts.filter(x => x !== c);
    G.onToast(`Cancelled: ${c.name}. Break fee $${fee.toLocaleString()}, -${rep} rep.`, true);
    dirtyUI();
}
function failPenalty(c) {
    return Math.round(12 + c.required * 4 + PROTOCOLS[c.proto].steps.length * 2);
}
export function failContract(c, abandonSample) {
    const s = G.state;
    const pen = failPenalty(c);
    s.reputation = Math.max(0, s.reputation - pen);
    s.stats.failed++;
    c.state = 'failed';
    for (const sm of s.samples.slice()) if (sm.contractId === c.id) abandonSample(sm.id);
    s.contracts = s.contracts.filter(x => x !== c);
    G.sfx('contract.fail');
    G.onToast(`Contract failed: ${c.name}  -${pen} rep`, true);
    dirtyUI();
}
