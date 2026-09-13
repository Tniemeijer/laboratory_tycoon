// ==================== ECONOMY ====================
// Upgrades, lab expansion (buyable plots), raw ingredient purchasing, the daily utility bill,
// and the startup loan.

import {
    UPGRADES, ZONES, INGREDIENTS, SUPPLIES, LOAN_INTEREST_RATE, LOAN_INTEREST_DAYS, LOAN_MAX, LOAN_BORROW_STEP, LOAN_REPAY_STEP,
    PRICE_DRIFT, PRICE_PULL, PRICE_MIN, PRICE_MAX, ORDER_LEAD_DAYS, STOCK_BASE_CAPACITY, STOCK_PER_UPGRADE,
    WATER_ITEM
} from '../data.js';
import { G, nid, upgradeCost, utilityBreakdown, bumpNav, dirtyUI } from '../core.js';

export function buyUpgrade(k) {
    const s = G.state, u = UPGRADES[k];
    if (s.upgrades[k] >= u.max) return;
    const cost = upgradeCost(k);
    if (s.money < cost) return G.onToast('Not enough money', true);
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
    if (s.money < z.cost) return G.onToast('Not enough money to expand here', true);
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
// Water lives in the lab's tank rather than on a shelf — a Sink can fill it endlessly, so counting
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

export function stockCapacity() { return STOCK_BASE_CAPACITY + STOCK_PER_UPGRADE * (G.state.upgrades.storage || 0); }
// What's on the shelf plus what's already on its way — an order reserves its space the moment it's
// placed, otherwise you could order round a full stockroom and have nowhere to put the delivery.
export function stockUsed() {
    const s = G.state;
    let n = 0;
    for (const k of Object.keys(INGREDIENTS)) n += s.ingredients[k] || 0;
    for (const k of Object.keys(SUPPLIES)) n += s.supplies[k] || 0;
    for (const o of s.orders || []) if (o.key !== 'water') n += o.qty;   // water goes to the tank, not a shelf
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
    if (key !== 'water' && qty > stockFree()) return G.onToast(`Stockroom is full — ${stockFree()} units of space left`, true);
    const cost = unitPrice(key) * qty;
    if (s.money < cost) return G.onToast('Not enough money', true);
    s.money -= cost;
    s.orders.push({ id: nid(), key, qty, day: s.day + ORDER_LEAD_DAYS });
    G.onToast(`Ordered ${qty}× ${item.name} — $${cost.toLocaleString()}, arrives Day ${s.day + ORDER_LEAD_DAYS}`);
    dirtyUI();
}
// Called on the day rollover: anything due turns up on the shelf.
export function deliverOrders() {
    const s = G.state;
    const due = (s.orders || []).filter(o => o.day <= s.day);
    if (!due.length) return;
    s.orders = s.orders.filter(o => o.day > s.day);
    for (const o of due) addStock(o.key, o.qty);
    const names = due.map(o => `${o.qty}× ${stockItem(o.key).name}`).join(', ');
    G.onToast(`Delivery arrived: ${names}`);
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
        G.onToast('Utility bills have pushed the lab into debt!', true);
    }
}

// Servicing the debt: every few days the lender takes its interest in cash and the principal is
// left exactly where it was. Nothing compounds, so a loan you can afford to service is a steady
// cost rather than a hole that quietly deepens — paying it down is about clearing the drain, not
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
