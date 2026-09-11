// ==================== ECONOMY ====================
// Upgrades, lab expansion (buyable plots), raw ingredient purchasing, and the daily utility bill.

import { UPGRADES, ZONES, INGREDIENTS } from '../data.js';
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
