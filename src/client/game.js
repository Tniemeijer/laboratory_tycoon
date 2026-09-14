// ==================== GAME ORCHESTRATOR ====================
// Owns the save file, the day/tick loop, and equipment placement. Gameplay systems live in
// ./systems/*; this module wires them together and re-exports the public API the UI/scene use.

import { BUILD, REAGENTS, INGREDIENTS, SUPPLIES, SUPPLY_FOR_CAP, WATER_ITEM, ZONES, PROTOCOLS, UPGRADES, CAP_LABEL, ROOM_BONUS_CAP, ROOM_DOOR_REQ, SUITED_ROOM_KINDS, WATER_BATCH, WATER_MIN, REAGENT_WATER_COST, MECH_MAINT_THRESHOLD, DISINFECT_FEE, FIRE_BRIGADE_FEE, LAWSUIT_DAYS, START_LOAN, LOAN_INTEREST_RATE, LOAN_INTEREST_DAYS, LOAN_STEP, LOAN_MAX, SKIN_TONES, HAIR_COLORS, SKILL_MAX_LEVEL, SKILL_XP_PER_LEVEL } from './data.js';
import {
    G, nid, resetIdCounter, currentIdCounter, dirtyUI, bumpNav, nav,
    labLevel, repToNext, coldCapacity, coldUsed, maxStaff, upgradeCost, ownedCaps, equipCaps, roomAt,
    cleanliness, reagentCount, ingredientCount, ownedTileCount, utilityBreakdown
} from './core.js';
import { canPlace as gridCanPlace, tileToWorld, sealedRooms, wallFacing, footTiles } from './grid.js';
import { refillOffers, acceptContract as acceptContractSys, failContract, checkContractArrivals } from './systems/contracts.js';
import { spawnSample, abandonSample, updateSamples } from './systems/samples.js';
import { updateStaff, hireStaff, toggleStaffCap } from './systems/staff.js';
import { buyUpgrade, buyZone, orderStock, driftPrices, deliverOrders, unitPrice, priceTrend, interestDue, nextInterestDay,
         stockCapacity, stockUsed, stockFree, stockCount, applyDailyUtilities, applyDailyInterest, borrowLoan, repayLoan } from './systems/economy.js';
import { recomputeGrime } from './systems/dirt.js';
import { updateEquipment, callMechanic, mechanicVisit, mechanicQuote } from './systems/equipment.js';
import { updateVisitors, clearVisitors, mechanicOnSite } from './systems/visitors.js';
import { updateIncidents, dailyIncidents, evacuate, endEvacuation, callFireBrigade, callDisinfection,
         settleLawsuit, fightLawsuit, settlementOf, alarmReliability, isBurning, isQuarantined } from './systems/incidents.js';

const DAY_LENGTH = 60;
const SAVE_KEY = 'labTycoonSave.v4';
// Bumped whenever a change to the save's *meaning* needs a one-off conversion that can't be
// detected by inspecting the data — currently: 5 = rooms are single tiles with a door you place
// yourself, rather than 2×2 blocks that picked their own doorway.
const SAVE_SCHEMA = 5;

// ---------- re-exports (the public API used by ui.js / threeScene.js) ----------
export {
    BUILD, REAGENTS, INGREDIENTS, SUPPLIES, SUPPLY_FOR_CAP, WATER_ITEM, ZONES, PROTOCOLS, UPGRADES, CAP_LABEL,
    WATER_BATCH, WATER_MIN, REAGENT_WATER_COST, MECH_MAINT_THRESHOLD,
    LOAN_INTEREST_RATE, LOAN_INTEREST_DAYS, LOAN_STEP, LOAN_MAX, SKILL_MAX_LEVEL, SKILL_XP_PER_LEVEL, ROOM_BONUS_CAP, SUITED_ROOM_KINDS,
    G, labLevel, repToNext, coldCapacity, coldUsed, maxStaff, upgradeCost, ownedCaps, equipCaps, roomAt, nav,
    cleanliness, reagentCount, ingredientCount, ownedTileCount, utilityBreakdown,
    hireStaff, toggleStaffCap, buyUpgrade, buyZone, borrowLoan, repayLoan,
    orderStock, unitPrice, priceTrend, stockCapacity, stockUsed, stockFree, stockCount,
    interestDue, nextInterestDay, callMechanic, mechanicQuote, mechanicOnSite,
    evacuate, endEvacuation, callFireBrigade, callDisinfection, settleLawsuit, fightLawsuit, settlementOf,
    alarmReliability, isBurning, isQuarantined,
    DISINFECT_FEE, FIRE_BRIGADE_FEE, LAWSUIT_DAYS
};
export function acceptContract(id) { acceptContractSys(id, spawnSample); }

// ---------- fresh state ----------
function fresh() {
    resetIdCounter(1);
    const st = {
        money: START_LOAN,
        loan: START_LOAN,
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
        supplies: { disposable: 20, slide: 8 },
        prices: {},                 // per-item multiplier on list price, drifts daily
        prevPrices: {},
        orders: [],                 // placed today, delivered on `day`
        water: 10,
        ownedZones: ZONES.filter(z => z.startOwned).map(z => z.id),
        dirt: {},
        dirtClaims: {},
        grime: 0,
        contaminationCooldown: 0,
        lastBill: 0,
        mechanicDay: null,          // day a booked mechanic turns up, or null
        fires: [],                  // [{ equipId, t, spreadT }] — everything currently alight
        evacuating: false,
        brigadeEta: null,           // seconds until the engine arrives, or null if none called
        outbreak: null,             // { tiles, day, crewDay, source } while a containment room is sealed
        lawsuits: [],
        visitors: [],               // people on site who aren't staff — see systems/visitors.js
        upgrades: { speed: 0, cold: 0, marketing: 0, staff: 0, clean: 0, radio: 0, cart: 0, storage: 0 },
        stats: { done: 0, failed: 0, processed: 0, spoiled: 0, contam: 0, mopped: 0, fires: 0, outbreaks: 0, deaths: 0 },
        schema: SAVE_SCHEMA,
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

// A room you lay with no door in it is legal — you're mid-build — but it's also completely inert
// until a door goes in, and nothing else in the game would ever tell you. Checked after every
// change to the floor plan rather than on a timer, so the warning lands on the action that caused
// it and never nags afterwards.
const ROOM_KIND_NAME = { dark: 'Dark Room', sterile: 'Cleanroom', contain: 'Containment Lab' };
function warnSealedRooms() {
    const sealed = sealedRooms(G.state);
    if (!sealed.length) return;
    const kinds = [...new Set(sealed.map(r => ROOM_KIND_NAME[r.kind] || r.kind))].join(' / ');
    G.onToast(`${kinds}: no way in — place a ${ROOM_DOOR_REQ[sealed[0].kind] === 'airlock' ? 'Airlock' : 'Door'} on one of its tiles`, true);
}

export function placeEquipment(type, tx, tz, rot) {
    const s = G.state;
    if (!isUnlocked(type)) { G.onToast(`Needs Lab Rating ${BUILD[type].minLevel}`, true); return false; }
    if (!canAfford(type)) { G.onToast('Not enough money', true); return false; }
    const chk = canPlace(type, tx, tz, rot);
    if (!chk.ok) { G.onToast(`Can't build here (${chk.why === 'unowned land' ? 'buy this plot first' : chk.why})`, true); return false; }
    s.money -= BUILD[type].cost;
    // A wall fitting faces its wall, not whichever way the ghost happened to be pointing.
    if (BUILD[type].mount) rot = wallFacing(s, tx, tz, rot);
    s.equipment.push({
        id: nid(), type, tx, tz, rot: rot || 0,
        slots: BUILD[type].slots || 0, processing: [], reserved: 0,
        staged: [], condition: 100, broken: false, operateClaim: null
    });
    bumpNav();
    G.onToast(`Built ${BUILD[type].name}`);
    warnSealedRooms();
    dirtyUI();
    return true;
}
// Relocate a machine (or a room) that's already built, keeping everything it's holding. Free —
// it's a reshuffle, not a purchase — and it deliberately doesn't care whether the machine is
// mid-run: the run ticks on regardless, it just finishes somewhere else.
export function moveEquipment(id, tx, tz, rot) {
    const s = G.state;
    const e = s.equipment.find(x => x.id === id);
    if (!e) return false;
    const r = rot == null ? e.rot : rot;
    const chk = canPlace(e.type, tx, tz, r, e.id);       // ignoreId: it mustn't collide with itself
    if (!chk.ok) { G.onToast(`Can't move there (${chk.why === 'unowned land' ? 'buy this plot first' : chk.why})`, true); return false; }
    e.tx = tx; e.tz = tz; e.rot = BUILD[e.type].mount ? wallFacing(s, tx, tz, r) : r;
    // Samples parked in its staging (or mid-run) travel with it — otherwise they'd pop back into
    // existence at the machine's old spot the moment their run finished.
    const aboard = new Set([...(e.staged || []).map(x => x.sampleId),
                            ...(e.processing || []).flatMap(pp => pp.sampleIds || [pp.sampleId])]);
    const w = tileToWorld(tx, tz);
    for (const sm of s.samples) if (aboard.has(sm.id)) { sm.wx = w.x; sm.wz = w.z; }
    // Anyone walking to this machine was headed for where it used to be, so hand them back to
    // assignJob rather than letting them arrive at bare floor and wait there.
    for (const wk of s.staff)
        if (wk.job && (wk.job.stationId === id || wk.job.operateId === id || wk.reservedStation === id))
            G.releaseWorkerJob(wk);
    bumpNav();
    G.onToast(`Moved ${BUILD[e.type].name}`);
    warnSealedRooms();
    dirtyUI();
    return true;
}
export function rotateEquipment(id) {
    const s = G.state;
    const e = s.equipment.find(x => x.id === id);
    if (!e) return;
    // Rotating a wall fitting steps it round to the *next wall* on its tile rather than to the
    // next compass point, so on a corner tile you can pick which of the two walls it hangs on and
    // on a single-wall tile it simply doesn't move.
    if (BUILD[e.type].mount) {
        const nw = wallFacing(s, e.tx, e.tz, (e.rot + 1) % 4);
        if (nw === e.rot) return G.onToast('Only one wall on this tile', true);
        e.rot = nw; bumpNav(); dirtyUI();
        return;
    }
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
    for (const p of (e.processing || []).slice())
        for (const sid of (p.sampleIds || [p.sampleId])) abandonSample(sid);
    for (const g of (e.staged || []).slice()) abandonSample(g.sampleId);
    for (const w of s.staff) if (w.job && (w.job.stationId === id || w.job.operateId === id || w.reservedStation === id)) G.releaseWorkerJob(w);
    s.money += Math.round(BUILD[e.type].cost * 0.5);
    s.equipment.splice(i, 1);
    bumpNav();
    G.onToast(`Sold ${BUILD[e.type].name} (+$${Math.round(BUILD[e.type].cost * 0.5)})`);
    warnSealedRooms();
    dirtyUI();
}

// ---------- misc toggles ----------
export function togglePause() { G.state.paused = !G.state.paused; dirtyUI(); }
// Speed is picked directly rather than cycled. A single button that wrapped 1x -> 2x -> 3x -> 1x
// read as broken: pressing "faster" a third time made the game slower, which is indistinguishable
// from the button not registering. See the segmented control in index.html.
export function setSpeed(n) { const s = G.state; if (s.speed === n) return; s.speed = n; dirtyUI(); }
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
        mechanicVisit();            // they work overnight and it's done by morning
        dailyIncidents();           // …and so do the disinfection crew, sick leave and the courts
        applyDailyUtilities();
        applyDailyInterest();
        deliverOrders();
        driftPrices();
        checkContractArrivals(spawnSample);
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
        s.equipment ||= []; s.reagents ||= []; s.dirt ||= {}; s.warns = {};
        // Every worker's job is about to get wiped below, so no dirtClaims entry from the old
        // save can possibly still be backed by a live worker — a hard reset, not just a default
        // for when it's missing, otherwise an orphaned claim makes topDirtTile() skip that tile
        // forever with nobody left who was ever going to mop it.
        s.dirtClaims = {};
        s.prepping ||= {}; s.ingredients ||= { salineSalt: 0, solventBase: 0, bufferMix: 0 };
        s.supplies ||= {}; s.prices ||= {}; s.prevPrices ||= {}; s.orders ||= [];
        s.water ||= 0;
        if (s.loan == null) s.loan = 0;   // pre-existing saves started debt-free under the old economy
        if (s.coldStore == null) s.coldStore = true;
        s.ownedZones ||= ZONES.filter(z => z.startOwned).map(z => z.id);
        s.upgrades ||= { speed: 0, cold: 0, marketing: 0, staff: 0, clean: 0, radio: 0 };
        if (s.upgrades.clean == null) s.upgrades.clean = 0;
        if (s.upgrades.radio == null) s.upgrades.radio = 0;
        if (s.upgrades.cart == null) s.upgrades.cart = 0;
        if (s.upgrades.storage == null) s.upgrades.storage = 0;
        if (s.mechanicDay === undefined) s.mechanicDay = null;
        // Accidents are new: a save from before them has no fires to put out and nobody suing.
        s.fires ||= []; s.lawsuits ||= [];
        // A visit in progress doesn't survive a reload: the mechanic's remaining jobs are still
        // broken/worn and still on the list, so booking them again picks up where they left off
        // — and nothing they'd already finished is undone.
        s.visitors = [];
        if (s.outbreak === undefined) s.outbreak = null;
        s.evacuating = false;       // whatever was burning at save time is out by the time you're back
        s.brigadeEta = null;
        s.fires = [];
        // ML-1 / ML-2 were folded into a single Containment Lab; carry old ones across.
        for (const e of s.equipment) if (e.type === 'ml1lab' || e.type === 'ml2lab') e.type = 'containment';
        // The Auto-Analyzer was dropped; anything still standing becomes an Analysis Desk, which
        // does the same job in a single tile.
        for (const e of s.equipment) if (e.type === 'analyzer') { e.type = 'analysisdesk'; e.rot = 0; }
        // Anything left whose type this build doesn't know about is dropped rather than kept: the
        // tick loop reads BUILD[e.type] every frame and would throw on every single one forever.
        // Rooms used to be 2×2 and picked their own doorway; they're single tiles with a placed
        // door now. Expand each old one into the four tiles it covered and fit a door (an airlock
        // where the room needs one) so a loaded lab isn't suddenly sealed shut.
        //
        // Gated on the save's schema number, and it MUST be: there is no way to tell an old 2×2
        // room from a new 1×1 one by looking at it, because after the change they're the same
        // shape. An earlier version tried to infer it from the BUILD footprint and from a flag
        // that was never actually written, which came out true for every room on every load — so
        // each refresh quadrupled every room tile and added another airlock, compounding every
        // time the page was reloaded. A stored version number is the only honest answer.
        if ((s.schema || 0) < SAVE_SCHEMA) {
            for (const e of s.equipment.filter(x => BUILD[x.type] && BUILD[x.type].room)) {
                for (const [dx, dz] of [[1, 0], [0, 1], [1, 1]]) {
                    s.equipment.push({ id: nid(), type: e.type, tx: e.tx + dx, tz: e.tz + dz, rot: 0,
                        slots: 0, processing: [], reserved: 0, staged: [], condition: 100, broken: false,
                        operateClaim: null });
                }
                const doorType = ROOM_DOOR_REQ[BUILD[e.type].kind] === 'airlock' ? 'airlock' : 'door';
                s.equipment.push({ id: nid(), type: doorType, tx: e.tx, tz: e.tz + 1, rot: 0,
                    slots: 0, processing: [], reserved: 0, staged: [], condition: 100, broken: false,
                    operateClaim: null });
            }
        }
        s.schema = SAVE_SCHEMA;
        const unknown = s.equipment.filter(e => !BUILD[e.type]);
        if (unknown.length) {
            s.equipment = s.equipment.filter(e => BUILD[e.type]);
            console.warn('Dropped unrecognised equipment from save:', unknown.map(e => e.type));
        }
        // Self-heal: drop anything standing on a tile it could never have been placed on in the
        // first place. Placement keeps three independent layers — room floor, wall fittings
        // (doors and mounts), and machines — and within a layer two things can never share a tile,
        // so a duplicate here is corruption rather than a legal lab, whatever produced it. Cheap,
        // and it means a save mangled by the migration bug above tidies itself up on next load
        // instead of needing a fresh game.
        const layerOf = (e) => BUILD[e.type].room ? 'room'
                             : (BUILD[e.type].door || BUILD[e.type].mount) ? 'fixture' : 'machine';
        const claimed = { room: new Set(), fixture: new Set(), machine: new Set() };
        const dupes = [];
        s.equipment = s.equipment.filter(e => {
            const layer = claimed[layerOf(e)];
            const tiles = footTiles(e.type, e.tx, e.tz, e.rot).map(([x, z]) => `${x},${z}`);
            if (tiles.some(k => layer.has(k))) { dupes.push(e.type); return false; }
            for (const k of tiles) layer.add(k);
            return true;
        });
        if (dupes.length) console.warn('Dropped overlapping equipment from save:', dupes);
        for (const e of s.equipment) {
            e.processing = []; e.reserved = 0; e.rot = e.rot || 0; e.staged = [];
            if (e.condition == null) e.condition = 100;
            e.broken = false;
            // Same reasoning as the dirtClaims reset above — every worker's job is about to be
            // wiped, so no equipment claim from the old save can still be backed by a live
            // worker. Left alone, a stale one would make findReadyBatchJob()/assignMechanicJob()
            // skip this equipment forever, since nothing would ever be left to clear it.
            e.operateClaim = null;
        }
        for (const w of s.staff) {
            w.job = null; w.carrying = null; w.reservedStation = null; w.path = null; w.state = 'idle';
            w.burnT = 0;
            if (w.illUntil != null && s.day >= w.illUntil) delete w.illUntil;
            if (!w.caps) {
                // Migrate the old exclusive role string to independent checkboxes.
                const oldRole = w.role || 'any';
                w.caps = {
                    process: oldRole === 'any' || oldRole === 'process',
                    clean: oldRole === 'any' || oldRole === 'clean',
                    mechanic: oldRole === 'mechanic'
                };
            }
            delete w.role;
            // Repairs are a call-out trade now, not something anyone on the payroll does.
            if (w.caps) delete w.caps.mechanic;
            if (w.name && w.name.startsWith('Dr. ')) w.name = w.name.slice(4);
            if (w.skin == null) w.skin = SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)];
            if (w.hairColor == null) w.hairColor = HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)];
            if (w.hairLong == null) w.hairLong = Math.random() < 0.5;
            w.skillXp ||= {};
            // 'spin' is no longer its own skill — fold anything already earned into prep.
            for (const [from, to] of Object.entries({ spin: 'prep', prep_bio: 'prep', prep_chem: 'prep', prep_contain: 'prep', fluoresce: 'image' })) {
                if (w.skillXp[from]) { w.skillXp[to] = (w.skillXp[to] || 0) + w.skillXp[from]; delete w.skillXp[from]; }
            }
        }
        // Every worker's job was just wiped above, and every equipment's staged/processing list
        // was cleared too, so no sample can still legitimately be 'staged'/'processing'/'carried'
        // (those normalize back to 'queued') — and no claimedBy can still be backed by a live
        // worker either. That part used to only run inside the state-normalizing branch, so a
        // sample that already happened to be sitting in 'queued' with a claim at save time (e.g.
        // one a worker had just claimed mid-walk to pick up) kept that stale claim forever,
        // invisible to pickSampleJob and silently occupying capacity in anyStationWantsMore.
        for (const sm of s.samples) { if (sm.state !== 'queued') sm.state = 'queued'; sm.claimedBy = null; }
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
        updateEquipment(g);
        updateVisitors(g);
        updateIncidents(g);
    }
    if (G.scene) G.scene.sync(s, dt);
}

export function init() {
    if (!loadSave()) { G.state = fresh(); refillOffers(); }
}
