// ==================== ECONOMY ====================
// Upgrades, lab expansion (buyable plots), raw ingredient purchasing, the daily utility bill,
// and the startup loan.

import {
    UPGRADES, ZONES, INGREDIENTS, SUPPLIES, LOAN_INTEREST_RATE, LOAN_INTEREST_DAYS, LOAN_MAX, LOAN_BORROW_STEP, LOAN_REPAY_STEP,
    PRICE_DRIFT, PRICE_PULL, PRICE_MIN, PRICE_MAX, ORDER_LEAD_DAYS, STOCK_TIER_CAPACITY,
    CRATE_UNITS, WATER_ITEM, RECEIVERSHIP_DEBT, RECEIVERSHIP_GRACE_DAYS, RECEIVERSHIP_SALE_FACTOR, BUILD} from '../data.js';
import { G, nid, upgradeCost, utilityBreakdown, bumpNav, dirtyUI} from '../core.js';
import { queueTile, tileToWorld, annexLevel } from '../grid.js';

export function buyUpgrade(k) {
    const s = G.state, u = UPGRADES[k];
    if (s.upgrades[k] >= u.max) return;
    const cost = upgradeCost(k);
    if (s.money < cost) return G.onToast(G.noFunds ? G.noFunds(u.name) : 'Not enough money', true);
    s.money -= cost; s.upgrades[k]++;
    if (k === 'staff') bumpNav();     // the break room grows, so its walls and floor move
    G.onToast(`${u.name} → Lv ${s.upgrades[k]}`);
    dirtyUI();
}

export function buyZone(id) {
    const s = G.state;
    const z = ZONES.find(x => x.id === id);
    if (!z) return;
    if (s.ownedZones.includes(id)) return;
    if (s.money < z.cost) return G.onToast(G.noFunds ? G.noFunds(z.name) : 'Not enough money', true);
    s.money -= z.cost;
    s.ownedZones.push(id);
    bumpNav();
    G.onToast(`Expanded into ${z.name}`);
    dirtyUI();
}

// ---------- stock: prices, orders and the stockroom ----------
export function stockItem(key) { return key === 'water' ? WATER_ITEM : (INGREDIENTS[key] || SUPPLIES[key]); }
export function isSupply(key) { return !!SUPPLIES[key]; }
function bin(key) { return isSupply(key) ? G.state.supplies : G.state.ingredients; }
// Water lives in the lab's tank rather than on a shelf. A Sink can fill it endlessly, so counting
// it against stockroom space would be odd.
export function stockCount(key) { return key === 'water' ? G.state.water : (bin(key)[key] || 0); }
export function addStock(key, qty) {
    if (key === 'water') { G.state.water += qty; return; }
    const b = bin(key); b[key] = (b[key] || 0) + qty;
}
export function takeStock(key, qty = 1) {
    const b = bin(key);
    if ((b[key] || 0) < qty) return false;
    b[key] -= qty;
    return true;
}

// Shelf space is whatever the stockroom annex has grown to. See STOCK_TIER_CAPACITY and the
// 'stock' annex in grid.js. There's always one, so an order always has somewhere to go; what
// changes with the upgrade is how much of it you can hold.
export function stockCapacity() { return STOCK_TIER_CAPACITY[annexLevel(G.state, 'stock')]; }
// What's on the shelf plus what's already on its way — an order reserves its space the moment it's
// placed, otherwise you could order round a full stockroom and have nowhere to put the delivery.
export function stockUsed() {
    const s = G.state;
    let n = 0;
    for (const k of Object.keys(INGREDIENTS)) n += s.ingredients[k] || 0;
    for (const k of Object.keys(SUPPLIES)) n += s.supplies[k] || 0;
    for (const o of s.orders || []) if (o.key !== 'water') n += o.qty;   // water goes to the tank, not a shelf
    // Crates sitting at the door are bought and paid for and have nowhere else to go, so their
    // space stays reserved until somebody actually shelves them.
    for (const c of s.deliveries || []) n += c.qty;
    return n;
}
export function stockFree() { return Math.max(0, stockCapacity() - stockUsed()); }

// Today's quote for one unit, list price moved by the supplier's current mood.
export function unitPrice(key) {
    const item = stockItem(key);
    if (!item) return 0;
    return Math.max(1, Math.round(item.cost * (G.state.prices[key] ?? 1)));
}
// Which way it moved overnight, for the arrow in the Stock panel.
export function priceTrend(key) {
    const s = G.state;
    const now = s.prices[key] ?? 1, then = (s.prevPrices || {})[key] ?? now;
    if (now > then * 1.01) return 1;
    if (now < then * 0.99) return -1;
    return 0;
}
export function driftPrices() {
    const s = G.state;
    s.prevPrices = { ...s.prices };
    for (const key of [...Object.keys(INGREDIENTS), ...Object.keys(SUPPLIES), 'water']) {
        const cur = s.prices[key] ?? 1;
        const next = cur + (1 - cur) * PRICE_PULL + (Math.random() - 0.5) * PRICE_DRIFT;
        s.prices[key] = Math.min(PRICE_MAX, Math.max(PRICE_MIN, Math.round(next * 1000) / 1000));
    }
}

export function orderStock(key, qty = 10) {
    const s = G.state, item = stockItem(key);
    if (!item) return;
    if (key !== 'water' && qty > stockFree()) return G.onToast(`Stockroom is full, ${stockFree()} units of space left`, true);
    const cost = unitPrice(key) * qty;
    if (s.money < cost) return G.onToast(G.noFunds ? G.noFunds(item.name) : 'Not enough money', true);
    s.money -= cost;
    s.orders.push({ id: nid(), key, qty, day: s.day + ORDER_LEAD_DAYS });
    G.onToast(`Ordered ${qty}× ${item.name}, $${cost.toLocaleString()}, arrives Day ${s.day + ORDER_LEAD_DAYS}`);
    dirtyUI();
}
// Called on the day rollover: anything due is dropped at the front door as crates. It does NOT
// land on the shelf. A scientist has to carry each crate to a Stockroom first (see staff.js's
// crate job), and until they do none of it can be used by a run.
export function deliverOrders() {
    const s = G.state;
    const due = (s.orders || []).filter(o => o.day <= s.day);
    if (!due.length) return;
    s.orders = s.orders.filter(o => o.day > s.day);
    s.deliveries ||= [];
    let crates = 0;
    for (const o of due) {
        // Water is pumped straight into the tank — there's nothing to shelve.
        if (o.key === 'water') { addStock(o.key, o.qty); continue; }
        for (let left = o.qty; left > 0; left -= CRATE_UNITS) {
            const qty = Math.min(CRATE_UNITS, left);
            const [tx, tz] = queueTile(s.deliveries.length + crates);
            const w = tileToWorld(tx, tz);
            s.deliveries.push({ id: nid(), key: o.key, qty, wx: w.x, wz: w.z, claimedBy: null });
            crates++;
        }
    }
    const names = due.map(o => `${o.qty}× ${stockItem(o.key).name}`).join(', ');
    if (crates) {
        G.onToast(`Delivery at the door: ${names}, ${crates} crate${crates > 1 ? 's' : ''} to be put away`);
    } else {
        G.onToast(`Delivery arrived: ${names}`);
    }
    dirtyUI();
}

// Charged once per day rollover.
export function applyDailyUtilities() {
    const s = G.state;
    const bill = utilityBreakdown();
    s.money -= bill.total;
    s.lastBill = bill.total;
    if (s.money < 0 && !s.warns['debt']) {
        s.warns['debt'] = 1;
        G.onToast('Bills and wages have pushed the lab into debt!', true);
    }
    // Peaks are recorded as the run goes rather than reconstructed at the end, which would only
    // ever be able to report where you finished, not how well it once went.
    s.stats.peakRep = Math.max(s.stats.peakRep || 0, s.reputation);
    s.stats.peakMoney = Math.max(s.stats.peakMoney || 0, Math.round(s.money));
}

// ---------- receivership, and the end of a run ----------
// Debt used to be survivable indefinitely: one warning, then interest arriving forever against a
// balance nobody could pay. That is a fade, not a defeat. Past RECEIVERSHIP_DEBT the bank steps
// in and starts selling the floor out from under you, one machine each morning, and you have
// RECEIVERSHIP_GRACE_DAYS to get back above the line. Recovery is always possible right up to the
// last day -- finish a contract, sell something yourself, borrow again -- which is what makes the
// clock worth watching rather than a formality.
export function checkSolvency() {
    const s = G.state;
    if (s.over) return;
    if (s.receivership) {
        if (s.money >= 0) {
            s.receivership = null;
            G.onToast('Out of receivership. The bank has withdrawn.');
            dirtyUI();
            return;
        }
        seizeAsset();
        const daysIn = s.day - s.receivership.since;
        if (daysIn >= RECEIVERSHIP_GRACE_DAYS) endRun('bankrupt');
        else G.onToast(`In receivership: ${RECEIVERSHIP_GRACE_DAYS - daysIn} day${RECEIVERSHIP_GRACE_DAYS - daysIn === 1 ? '' : 's'} to clear the red`, true);
        return;
    }
    if (s.money < RECEIVERSHIP_DEBT) {
        s.receivership = { since: s.day };
        // Anything outstanding is written off at once: a lab under administration is not taking on
        // new work, and leaving live contracts to fail one by one would only bury the player
        // deeper while they are trying to climb out.
        for (const c of s.contracts.slice()) cancelContractSilently(c);
        G.onToast('The bank has called in the loan. The lab is in receivership.', true);
        dirtyUI();
    }
}
// The bank takes the most valuable thing on the floor each morning, at forced-sale prices.
function seizeAsset() {
    const s = G.state;
    const sellable = s.equipment.filter(e => BUILD[e.type].cost > 0);
    if (!sellable.length) return;
    sellable.sort((a, b) => BUILD[b.type].cost - BUILD[a.type].cost);
    const e = sellable[0];
    const got = Math.round(BUILD[e.type].cost * RECEIVERSHIP_SALE_FACTOR);
    // Same tidy-up the player's own sale does: anything mid-run on it is abandoned and anybody
    // walking to it is released, or they would head for a machine that no longer exists.
    for (const p of (e.processing || []).slice())
        for (const sid of (p.sampleIds || [p.sampleId])) { if (G.abandonSample) G.abandonSample(sid); }
    for (const g of (e.staged || []).slice()) { if (G.abandonSample) G.abandonSample(g.sampleId); }
    for (const w of s.staff)
        if (w.job && (w.job.stationId === e.id || w.job.operateId === e.id || w.reservedStation === e.id))
            G.releaseWorkerJob(w);
    s.equipment = s.equipment.filter(x => x !== e);
    s.money += got;
    bumpNav();
    G.onToast(`The bank sold your ${BUILD[e.type].name} (+$${got.toLocaleString()})`, true);
    dirtyUI();
}
// Contracts are dropped without the usual reputation hit and break fee. The player is not walking
// away here, the administrator is.
function cancelContractSilently(c) {
    const s = G.state;
    c.state = 'cancelled';
    s.contracts = s.contracts.filter(x => x !== c);
    s.stats.cancelled++;
    // filter() snapshots first: abandonSample splices the live array as it goes.
    if (G.abandonSample) for (const sm of s.samples.filter(x => x.contractId === c.id)) G.abandonSample(sm.id);
}

// The run is over. The simulation stops dead and the summary is built from what was recorded
// along the way, so nothing has to be recomputed from a state that is about to stop changing.
export function endRun(reason) {
    const s = G.state;
    if (s.over) return;
    s.paused = true;
    try { localStorage.removeItem('labTycoonSave.v4'); } catch (e) {}
    s.over = {
        day: s.day, reason,
        summary: {
            days: s.day,
            contractsDone: s.stats.done,
            contractsFailed: s.stats.failed,
            samples: s.stats.processed,
            peakRep: Math.max(s.stats.peakRep || 0, s.reputation),
            peakMoney: Math.max(s.stats.peakMoney || 0, Math.round(s.money)),
            finalMoney: Math.round(s.money),
            loan: s.loan,
            staff: s.staff.length,
            machines: s.equipment.length,
            fires: s.stats.fires, outbreaks: s.stats.outbreaks, deaths: s.stats.deaths
        }
    };
    dirtyUI();
}

// Servicing the debt: every few days the lender takes its interest in cash and the principal is
// left exactly where it was. Nothing compounds, so a loan you can afford to service is a steady
// cost rather than a hole that quietly deepens. Paying it down is about clearing the drain, not
// outrunning it. Checked on each day rollover; only actually bills on the due days.
export function interestDue() {
    const s = G.state;
    return s.loan > 0 ? Math.round(s.loan * LOAN_INTEREST_RATE) : 0;
}
export function nextInterestDay() {
    const s = G.state;
    return s.day + (LOAN_INTEREST_DAYS - (s.day % LOAN_INTEREST_DAYS || LOAN_INTEREST_DAYS));
}
export function applyDailyInterest() {
    const s = G.state;
    if (!s.loan || s.day % LOAN_INTEREST_DAYS !== 0) return;
    const interest = interestDue();
    s.money -= interest;
    G.onToast(`Loan interest: -$${interest.toLocaleString()}`, s.money < 0);
    if (s.money < 0 && !s.warns['debt']) {
        s.warns['debt'] = 1;
        G.onToast('The lab is in the red — interest is still due whether you can pay it or not.', true);
    }
    dirtyUI();
}

export function borrowLoan(amount = LOAN_BORROW_STEP) {
    const s = G.state;
    if (s.loan >= LOAN_MAX) return G.onToast('Lender won’t extend any further credit', true);
    const room = LOAN_MAX - s.loan;
    const take = Math.min(amount, room);
    s.loan += take; s.money += take;
    G.onToast(`Borrowed $${take.toLocaleString()}`);
    dirtyUI();
}
export function repayLoan(amount = LOAN_REPAY_STEP) {
    const s = G.state;
    const pay = Math.min(amount, s.loan, Math.max(0, s.money));
    if (pay <= 0) return G.onToast(s.loan <= 0 ? 'Loan already paid off' : 'Not enough cash on hand', true);
    s.loan -= pay; s.money -= pay;
    G.onToast(`Repaid $${pay.toLocaleString()}`);
    dirtyUI();
}
