// ==================== WASTE ====================
// Every run that handles a sample leaves used disposables behind. They go in the nearest Waste Bin
// within reach of the machine. Clinical bins are single-use, so what the player builds is the
// *spot*: when the bin standing on it fills up, a scientist carries the whole sealed bin out to
// the waste store (the annex by the street) and brings a fresh one up from the stockroom to stand
// in the same place. A contractor empties the store every few days, for a fee per bin.
//
// Each link can jam, and each jam lands somewhere you can see it:
//   · no bin in reach, or every bin in reach full   -> the waste goes on the floor as grime
//   · no Waste Bins in stock                        -> spots stand empty until a delivery
//   · the store full                                -> full bins stay put until collection day
// The walking is staff.js's business (pickBinJob/pickRefillJob and the states they lead to).
// This file only does the bookkeeping.

import {
    BUILD, WASTE_BIN_CAP, WASTE_BIN_REACH, WASTE_SPILL_DIRT, WASTE_TIER_CAPACITY,
    WASTE_PICKUP_DAYS, WASTE_FEE_PER_BIN
} from '../data.js';
import { G, dirtyUI } from '../core.js';
import { annexLevel } from '../grid.js';
import { addDirt } from './dirt.js';
import { stockCount } from './economy.js';

export function isBin(e) { return BUILD[e.type] && BUILD[e.type].kind === 'bin'; }
// A spot with a bin actually standing on it. A new spot, or one whose bin has just gone out, is
// empty until somebody brings a fresh one from stock.
export function hasBin(e) { return !!e.hasBin; }
export function binFill(e) { return hasBin(e) ? (e.waste || 0) : 0; }
export function wasteCapacity() { return WASTE_TIER_CAPACITY[annexLevel(G.state, 'waste')]; }
// Sealed bins in the store plus any already on their way there. A bin being carried out has its
// place spoken for, same as an order reserving shelf space, or two people could each set off with
// a full bin for the last free spot.
export function wasteCommitted() {
    const s = G.state;
    let n = s.waste || 0;
    for (const w of s.staff) if (w.job && w.job.binOut) n++;
    return n;
}
export function wasteRoomFree() { return Math.max(0, wasteCapacity() - wasteCommitted()); }

// Distance from a machine's footprint to a bin, in tiles. Chebyshev, so a bin diagonally next to a
// machine counts as one away rather than two.
function reach(st, bin) {
    const [fw, fh] = BUILD[st.type].foot;
    const w = (st.rot || 0) % 2 ? fh : fw, h = (st.rot || 0) % 2 ? fw : fh;
    const dx = Math.max(0, st.tx - bin.tx, bin.tx - (st.tx + w - 1));
    const dz = Math.max(0, st.tz - bin.tz, bin.tz - (st.tz + h - 1));
    return Math.max(dx, dz);
}
export function binsNear(st) {
    return G.state.equipment.filter(e => isBin(e) && reach(st, e) <= WASTE_BIN_REACH)
        .sort((a, b) => reach(st, a) - reach(st, b));
}

// A finished run's waste goes into the closest bins with room, spilling over into the next one.
// Whatever is left over has nowhere to go and ends up on the floor beside the machine.
export function depositWaste(st, units) {
    if (!(units > 0)) return;
    let left = units;
    const near = binsNear(st);
    for (const bin of near) {
        if (!hasBin(bin)) continue;
        const room = WASTE_BIN_CAP - binFill(bin);
        if (room <= 0) continue;
        const put = Math.min(room, left);
        bin.waste = binFill(bin) + put;
        left -= put;
        if (!left) break;
    }
    if (!left) return;
    addDirt(st, left * WASTE_SPILL_DIRT);
    const s = G.state;
    const key = 'waste_floor_' + st.id;
    if (s.warns[key]) return;
    s.warns[key] = 1;
    const name = BUILD[st.type].name;
    G.onToast(!near.length ? `No Waste Bin near the ${name}. Its waste is going on the floor`
        : near.some(hasBin) ? `The bins by the ${name} are full. Its waste is going on the floor`
        : stockCount('wastebin') > 0 ? `The bin spot by the ${name} is waiting for a new bin. Its waste is going on the floor`
        : `The bin spot by the ${name} has no bin in it. Order Waste Bins in Stock`, true);
}

export function nextCollectionDay() {
    return (Math.floor(G.state.day / WASTE_PICKUP_DAYS) + 1) * WASTE_PICKUP_DAYS;
}
// Called on the day rollover. The contractor empties the store on their round, billed per bin.
export function collectWaste() {
    const s = G.state;
    if (s.day % WASTE_PICKUP_DAYS !== 0) return;
    const n = s.waste || 0;
    if (!n) return;
    const fee = n * WASTE_FEE_PER_BIN;
    s.waste = 0;
    s.money -= fee;
    G.onToast(`Waste collected: ${n} sealed bin${n > 1 ? 's' : ''} taken away  -$${fee}`);
    dirtyUI();
}
