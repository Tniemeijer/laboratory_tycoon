// ==================== GAME ORCHESTRATOR ====================
// Owns the save file, the day/tick loop, and equipment placement. Gameplay systems live in
// ./systems/*; this module wires them together and re-exports the public API the UI/scene use.

import { BUILD, REAGENTS, INGREDIENTS, ZONES, PROTOCOLS, UPGRADES, CAP_LABEL, WATER_BATCH, WATER_MIN, REAGENT_WATER_COST } from './data.js';
import {
    G, nid, resetIdCounter, currentIdCounter, dirtyUI, bumpNav,
    labLevel, repToNext, coldCapacity, coldUsed, maxStaff, upgradeCost, ownedCaps,
    cleanliness, reagentCount, ingredientCount, ownedTileCount, utilityBreakdown
} from './core.js';
import { canPlace as gridCanPlace } from './grid.js';
import { refillOffers, acceptContract as acceptContractSys, failContract } from './systems/contracts.js';
import { spawnSample, abandonSample, updateSamples } from './systems/samples.js';
import { updateStaff, hireStaff, setRole } from './systems/staff.js';
import { buyUpgrade, buyZone, buyIngredient, applyDailyUtilities } from './systems/economy.js';
import { recomputeGrime } from './systems/dirt.js';

const DAY_LENGTH = 60;
const SAVE_KEY = 'labTycoonSave.v4';

// ---------- re-exports (the public API used by ui.js / threeScene.js) ----------
export {
    BUILD, REAGENTS, INGREDIENTS, ZONES, PROTOCOLS, UPGRADES, CAP_LABEL,
    WATER_BATCH, WATER_MIN, REAGENT_WATER_COST,
    G, labLevel, repToNext, coldCapacity, coldUsed, maxStaff, upgradeCost, ownedCaps,
    cleanliness, reagentCount, ingredientCount, ownedTileCount, utilityBreakdown,
    hireStaff, setRole, buyUpgrade, buyZone, buyIngredient
};
export function acceptContract(id) { acceptContractSys(id, spawnSample); }

// ---------- fresh state ----------
function fresh() {
    resetIdCounter(1);
    const st = {
        money: 13000,
        reputation: 0,
        day: 1,
        dayFrac: 0,
        paused: false,
        speed: 1,
        hireCost: 500,
        autoPrep: true,
        coldStore: true,
        equipment: [],
        staff: [],
        samples: [],
        contracts: [],
        offers: [],
        reagents: [],
        prepping: {},
        ingredients: { salineSalt: 6, solventBase: 6, bufferMix: 6 },
        water: 10,
        ownedZones: ZONES.filter(z => z.startOwned).map(z => z.id),
        dirt: {},
        dirtClaims: {},
        grime: 0,
        contaminationCooldown: 0,
        lastBill: 0,
        upgrades: { speed: 0, cold: 0, marketing: 0, staff: 0, clean: 0, radio: 0 },
        stats: { done: 0, failed: 0, processed: 0, spoiled: 0, contam: 0, mopped: 0 },
        navVersion: 0,
        uiRev: 0,
        warns: {}
    };
    for (const [k, r] of Object.entries(REAGENTS))
        for (let i = 0; i < 3; i++) st.reagents.push({ id: nid(), type: k, expire: 1 + r.shelf });
    return st;
}

// ---------- placement ----------
export function canPlace(type, tx, tz, rot, ignoreId) { return gridCanPlace(G.state, type, tx, tz, rot, ignoreId); }
export function canAfford(type) { return G.state.money >= BUILD[type].cost; }
export function isUnlocked(type) { return labLevel() >= BUILD[type].minLevel; }

export function placeEquipment(type, tx, tz, rot) {
    const s = G.state;
    if (!isUnlocked(type)) { G.onToast(`Needs Lab Rating ${BUILD[type].minLevel}`, true); return false; }
    if (!canAfford(type)) { G.onToast('Not enough money', true); return false; }
    const chk = canPlace(type, tx, tz, rot);
    if (!chk.ok) { G.onToast(`Can't build here (${chk.why === 'unowned land' ? 'buy this plot first' : chk.why})`, true); return false; }
    s.money -= BUILD[type].cost;
    s.equipment.push({
        id: nid(), type, tx, tz, rot: rot || 0,
        slots: BUILD[type].slots || 0, processing: [], reserved: 0
    });
    bumpNav();
    G.onToast(`Built ${BUILD[type].name}`);
    dirtyUI();
    return true;
}
export function rotateEquipment(id) {
    const s = G.state;
    const e = s.equipment.find(x => x.id === id);
    if (!e) return;
    const nr = (e.rot + 1) % 4;
    const chk = canPlace(e.type, e.tx, e.tz, nr, e.id);
    if (!chk.ok) return G.onToast(`Rotation won't fit (${chk.why})`, true);
    e.rot = nr;
    bumpNav();
    for (const w of s.staff) if (w.job) w.path = null;
    dirtyUI();
}
export function demolish(id) {
    const s = G.state;
    const i = s.equipment.findIndex(e => e.id === id);
    if (i === -1) return;
    const e = s.equipment[i];
    for (const p of (e.processing || []).slice()) abandonSample(p.sampleId);
    for (const w of s.staff) if (w.job && (w.job.stationId === id || w.reservedStation === id)) G.releaseWorkerJob(w);
    s.money += Math.round(BUILD[e.type].cost * 0.5);
    s.equipment.splice(i, 1);
    bumpNav();
    G.onToast(`Sold ${BUILD[e.type].name} (+$${Math.round(BUILD[e.type].cost * 0.5)})`);
    dirtyUI();
}

// ---------- misc toggles ----------
export function togglePause() { G.state.paused = !G.state.paused; dirtyUI(); }
export function cycleSpeed() { const s = G.state; s.speed = s.speed === 1 ? 2 : s.speed === 2 ? 3 : 1; dirtyUI(); }
export function toggleAutoPrep() { G.state.autoPrep = !G.state.autoPrep; dirtyUI(); }
export function toggleColdStore() { G.state.coldStore = !G.state.coldStore; dirtyUI(); }

// ---------- time ----------
function expireReagents() {
    const s = G.state;
    const before = s.reagents.length;
    s.reagents = s.reagents.filter(r => r.expire > s.day);
    if (s.reagents.length !== before) {
        G.onToast(`${before - s.reagents.length} reagent(s) expired`, true);
        dirtyUI();
    }
}
function advanceTime(dt) {
    const s = G.state;
    s.dayFrac += dt / DAY_LENGTH;
    while (s.dayFrac >= 1) {
        s.dayFrac -= 1; s.day++;
        applyDailyUtilities();
        for (const c of s.contracts.slice()) if (s.day > c.deadline) failContract(c, abandonSample);
        s.offers = s.offers.filter(o => o.deadline > s.day + 1);
        refillOffers();
        expireReagents();
        s.warns = {};                            // let warnings fire again each day
        autoSave();
        dirtyUI();
    }
}

// ---------- save / load ----------
function autoSave() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ state: G.state, idc: currentIdCounter() })); } catch (e) {}
}
export function saveNow() { autoSave(); }
function loadSave() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return false;
        const p = JSON.parse(raw);
        if (!p || !p.state) return false;
        G.state = p.state; resetIdCounter(p.idc);
        const s = G.state;
        s.offers ||= []; s.contracts ||= []; s.samples ||= []; s.staff ||= [];
        s.equipment ||= []; s.reagents ||= []; s.dirt ||= {}; s.dirtClaims ||= {}; s.warns = {};
        s.prepping ||= {}; s.ingredients ||= { salineSalt: 0, solventBase: 0, bufferMix: 0 };
        s.water ||= 0;
        if (s.coldStore == null) s.coldStore = true;
        s.ownedZones ||= ZONES.filter(z => z.startOwned).map(z => z.id);
        s.upgrades ||= { speed: 0, cold: 0, marketing: 0, staff: 0, clean: 0, radio: 0 };
        if (s.upgrades.clean == null) s.upgrades.clean = 0;
        if (s.upgrades.radio == null) s.upgrades.radio = 0;
        for (const e of s.equipment) { e.processing = []; e.reserved = 0; e.rot = e.rot || 0; }
        for (const w of s.staff) { w.job = null; w.carrying = null; w.reservedStation = null; w.path = null; w.state = 'idle'; w.role = w.role || 'any'; }
        for (const sm of s.samples) { if (sm.state !== 'queued') { sm.state = 'queued'; sm.claimedBy = null; } }
        recomputeGrime();
        s.navVersion = (s.navVersion || 0) + 1;
        return true;
    } catch (e) { return false; }
}
export function newGame() {
    G.state = fresh();
    refillOffers();
    dirtyUI();
    G.onToast('New game started');
}

// ---------- loop ----------
export function tick(dt) {
    dt = Math.min(dt, 0.1);
    const s = G.state;
    if (!s.paused) {
        const g = dt * s.speed;
        advanceTime(g);
        updateSamples(g);
        updateStaff(g);
    }
    if (G.scene) G.scene.sync(s, dt);
}

export function init() {
    if (!loadSave()) { G.state = fresh(); refillOffers(); }
}
