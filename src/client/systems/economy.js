// ==================== ECONOMY ====================
// Upgrades, lab expansion (buyable plots), raw ingredient purchasing, the daily utility bill,
// and the startup loan.

import { UPGRADES, ZONES, INGREDIENTS, LOAN_INTEREST_RATE, LOAN_MAX, LOAN_BORROW_STEP, LOAN_REPAY_STEP } from '../data.js';
import { G, upgradeCost, utilityBreakdown, bumpNav, dirtyUI } from '../core.js';

export function buyUpgrade(k) {
    const s = G.state, u = UPGRADES[k];
    if (s.upgrades[k] >= u.max) return;
    const cost = upgradeCost(k);
    if (s.money < cost) return G.onToast('Not enough money', true);
    s.money -= cost; s.upgrades[k]++;
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

export function buyIngredient(key, qty = 10) {
    const s = G.state, ing = INGREDIENTS[key];
    if (!ing) return;
    const cost = Math.round(ing.cost * qty);
    if (s.money < cost) return G.onToast('Not enough money', true);
    s.money -= cost;
    s.ingredients[key] = (s.ingredients[key] || 0) + qty;
    G.onToast(`Bought ${qty}× ${ing.name}`);
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

// Interest compounds onto the loan balance itself rather than being auto-deducted from cash —
// nothing forces a payment, but ignoring it means next month's interest is charged on a bigger
// number. Also charged once per day rollover.
export function applyDailyInterest() {
    const s = G.state;
    if (!s.loan) return;
    const interest = Math.round(s.loan * LOAN_INTEREST_RATE * 100) / 100;
    s.loan = Math.round((s.loan + interest) * 100) / 100;
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
