// ==================== DROPDOWN CONTENT ====================
// Pure(ish) HTML builders for each top-bar menu, plus the click wiring for whatever the
// last-rendered menu was. Tool selection is injected from toolbar.js to avoid a cyclic import.

import {
    G, BUILD, PROTOCOLS, UPGRADES, REAGENTS, INGREDIENTS, SUPPLIES, WATER_ITEM, ZONES, CAP_LABEL,
    orderStock, unitPrice, priceTrend, stockCapacity, stockUsed, stockFree, stockCount,
    orderBrew, BREW_QUEUE_MAX, REAGENT_BATCH, ROOM_DOOR_REQ,
    WATER_MIN, REAGENT_WATER_COST, MECH_MAINT_THRESHOLD, LOAN_INTEREST_RATE, LOAN_MAX,
    SKILL_MAX_LEVEL, SKILL_XP_PER_LEVEL, ROOM_BONUS_CAP, LOAN_INTEREST_DAYS, LOAN_STEP,
    STAFF_TRAITS, STAFF_PERKS, CAREER_XP_PER_LEVEL, CAREER_MAX_LEVEL,
    interestDue, nextInterestDay, mechanicQuote, mechanicOnSite, alarmReliability,
    labLevel, repToNext, coldCapacity, coldUsed, maxStaff, upgradeCost, ownedCaps,
    cleanliness, ownedTileCount, utilityBreakdown, reagentCount,
    bottleneck, machineLoad, staffLoad,
    careerLevel, perksOwed, dailyWage, choosePerk,
    acceptContract, cancelContract, cancelCost, hireStaff, toggleStaffCap, fireStaff, buyUpgrade, buyZone, toggleColdStore, callMechanic,
    borrowLoan, repayLoan, suppliesForStep, ORDER_COVER_DAYS, ORDER_CASH_RESERVE} from '../game.js';
import { sealedRooms } from '../grid.js';
import { restartTutorial } from './tutorial.js';

const CAT_ORDER = ['Processing', 'Storage', 'Utility'];
// Rooms have no caps of their own to list — what they're worth is whatever they add to a machine
// standing inside, so both sides of that are read straight off ROOM_BONUS_CAP rather than being
// spelled out twice and left to drift.
const roomGrantLabel = (kind) => {
    const grants = ROOM_BONUS_CAP[kind] || {};
    const parts = Object.entries(grants).map(([type, cap]) => `+${CAP_LABEL[cap]} for a ${BUILD[type].name}`);
    return `room floor, 1 tile · ${parts.join(', ') || 'better-quality runs'}`;
};
const roomBonusFor = (type) => Object.entries(ROOM_BONUS_CAP)
    .filter(([, grants]) => grants[type])
    .map(([kind, grants]) => `+${CAP_LABEL[grants[type]]} in ${ROOM_NAME[kind]}`);
const ROOM_NAME = { sterile: 'a Cleanroom', dark: 'a Dark Room', contain: 'a Containment Lab' };
// How much the Borrow/Repay buttons will move. Lives here rather than in game state because it's
// a control position, not something worth saving.
let loanAmount = 2000;
export function adjustLoanAmount(dir) {
    loanAmount = Math.max(LOAN_STEP, Math.min(LOAN_MAX, loanAmount + dir * LOAN_STEP));
}
// Orders only appears once the lab can actually do it: the Procurement upgrade bought, and an
// Workstation to sit at. A tickbox for a job the lab cannot perform is just a question the
// player can't answer.
const STAFF_CAPS_BASE = ['process', 'clean'];
const staffCaps = () => (G.state.upgrades.orders > 0
    && G.state.equipment.some(e => (BUILD[e.type].caps || []).includes('analyze')))
    ? [...STAFF_CAPS_BASE, 'orders'] : STAFF_CAPS_BASE;
const STAFF_CAP_LABEL = { process: 'Process', clean: 'Clean', orders: 'Orders' };
let _onToolSelect = () => {};
export function setToolHandler(fn) { _onToolSelect = fn; }

// Skill badges only show up once a scientist has actually leveled a cap — an untouched skill
// list would otherwise print eight "Lv0" badges per hire and drown out the ones that matter.
const skillBadges = (w) => {
    const xp = w.skillXp || {};
    const learned = Object.keys(xp).filter(c => xp[c] >= SKILL_XP_PER_LEVEL);
    if (!learned.length) return '';
    return `<div class="skills">${learned.map(c => {
        const lvl = Math.min(SKILL_MAX_LEVEL, Math.floor(xp[c] / SKILL_XP_PER_LEVEL));
        return `<span class="skill">${CAP_LABEL[c] || c} <b>Lv${lvl}</b></span>`;
    }).join('')}</div>`;
};

// What a job will actually eat on its way through the lab: the stock solutions its steps call
// for, and the consumables the machines burn. Shown on the contract so you can see you're short
// *before* taking the work on, instead of finding out when runs start coming out badly.
const needsChain = (protoKey) => {
    // Seeded from suppliesForStep() rather than assuming disposables: a step that handles no
    // sample needs none, and hard-coding them here would list what a run never buys.
    const reag = [], sup = new Set();
    PROTOCOLS[protoKey].steps.forEach((st, i) => {
        if (st.reagent && !reag.includes(st.reagent)) reag.push(st.reagent);
        // Asks the same function the simulation charges from, so the list can't drift out of step
        // with what a run actually burns.
        for (const k of suppliesForStep(protoKey, i)) sup.add(k);
    });
    const bits = [];
    for (const k of reag) {
        const have = reagentCount(k) > 0;
        bits.push(`<span class="cap ${have ? 'have' : 'miss'}">${REAGENTS[k].name}</span>`);
    }
    for (const k of sup) {
        const have = stockCount(k) > 0;
        bits.push(`<span class="cap ${have ? 'have' : 'miss'}">${SUPPLIES[k].name}</span>`);
    }
    return `<div class="chain"><span class="dim">needs</span>${bits.join('')}</div>`;
};

// What would it actually take to run this protocol? Turns the red links in the chain above into
// instructions, "Build a Flow Hood", "Stand a Microscope in a Dark Room", "Order Slides". Rather
// than leaving the player to work out which machine grants "Contained Prep" from the Build menu.
//
// Three shapes of answer, in the order they're worth telling someone about:
//   · no machine grants the cap at all                 -> build one
//   · a machine grants it, but only inside a room      -> build the machine, or lay the room
//   · the machine exists, the consumable doesn't       -> order it / brew it
export function contractTasks(protoKey) {
    const s = G.state;
    const owned = ownedCaps();
    // Two kinds of entry. A `todo` is something the player has to act on. A `waiting` is something
    // already in hand that simply hasn't landed yet: stock on order, a batch on the bench. Both
    // block the job, so both have to be visible — suppressing the second made the panel claim
    // "nothing blocking" while a run sat stalled waiting for slides to arrive.
    const tasks = [];
    const todo = (text) => tasks.push({ text, waiting: false });
    const waiting = (text) => tasks.push({ text, waiting: true });
    const machinesFor = (cap) => Object.entries(BUILD).filter(([, b]) => (b.caps || []).includes(cap));
    const roomGrantsFor = (cap) => {
        const out = [];
        for (const [kind, grants] of Object.entries(ROOM_BONUS_CAP))
            for (const [type, granted] of Object.entries(grants)) if (granted === cap) out.push({ kind, type });
        return out;
    };
    const roomName = (kind) => Object.entries(BUILD).find(([, b]) => b.room && b.kind === kind)?.[1].name || kind;

    for (const st of PROTOCOLS[protoKey].steps) {
        if (owned.has(st.cap)) continue;
        const direct = machinesFor(st.cap);
        if (direct.length) {
            todo(`Build a <b>${direct.map(([, b]) => b.name).join('</b> or <b>')}</b>, for the ${CAP_LABEL[st.cap]} step.`);
            continue;
        }
        // Only a machine standing inside a room can do it.
        for (const { kind, type } of roomGrantsFor(st.cap)) {
            const hasMachine = s.equipment.some(e => e.type === type);
            const hasRoom = s.equipment.some(e => BUILD[e.type].room && BUILD[e.type].kind === kind);
            const rn = roomName(kind);
            if (!hasMachine && !hasRoom) todo(`Build a <b>${BUILD[type].name}</b> and lay a <b>${rn}</b> around it, for the ${CAP_LABEL[st.cap]} step.`);
            else if (!hasMachine) todo(`Build a <b>${BUILD[type].name}</b> inside your <b>${rn}</b>, for the ${CAP_LABEL[st.cap]} step.`);
            else if (!hasRoom) todo(`Lay a <b>${rn}</b> around your <b>${BUILD[type].name}</b>, for the ${CAP_LABEL[st.cap]} step.`);
            else todo(`Move your <b>${BUILD[type].name}</b> onto the <b>${rn}</b> floor. It only does ${CAP_LABEL[st.cap]} while standing on it.`);
        }
    }
    // A sealed room grants nothing and is easy to miss, so call it out here too.
    for (const r of sealedRooms(s)) {
        const rn = roomName(r.kind);
        const need = ROOM_DOOR_REQ[r.kind] === 'airlock' ? 'Airlock' : 'Door';
        todo(`Put ${need === 'Airlock' ? 'an' : 'a'} <b>${need}</b> in your <b>${rn}</b>. A sealed room grants nothing.`);
    }
    // Consumables and reagents: a run won't start without them at all.
    const sup = new Set();
    const reag = [];
    // Read from the same function the simulation charges from. Building this list off the cap
    // table instead missed slides entirely once they moved to the step that mounts the specimen,
    // so a lab could run out of slides mid-prep and the task list would swear nothing was wrong.
    PROTOCOLS[protoKey].steps.forEach((st, i) => {
        for (const k of suppliesForStep(protoKey, i)) sup.add(k);
        if (st.reagent && !reag.includes(st.reagent)) reag.push(st.reagent);
    });
    // Anything already bought is already handled: still on order, or sitting in a crate by the
    // door waiting to be shelved. Judging by shelf contents alone tells the player to re-order
    // what's already on its way.
    const incoming = (key) => {
        let n = 0;
        for (const o of s.orders || []) if (o.key === key) n += o.qty;
        for (const c of s.deliveries || []) if (c.key === key) n += c.qty;
        return n;
    };
    // Says where it actually is, so "waiting" means something concrete rather than "trust me".
    // Returns the tail only: supply names are plural ("Slides are …") and ingredient names are
    // singular ("Its Solvent Base is …"), so the verb belongs to the caller.
    const arrivalOf = (key) => {
        const crates = (s.deliveries || []).filter(c => c.key === key).length;
        if (crates) return `in ${crates > 1 ? `${crates} crates` : 'a crate'} by the door, waiting to be put away`;
        const days = (s.orders || []).filter(o => o.key === key).map(o => o.day);
        if (days.length) return `on order, arriving Day ${Math.min(...days)}`;
        return null;
    };
    for (const k of sup) {
        if (stockCount(k) > 0) continue;
        const due = arrivalOf(k);
        if (due) waiting(`<b>${SUPPLIES[k].name}</b> are ${due}.`);
        else todo(`Order <b>${SUPPLIES[k].name}</b> in <b>Stock</b>. Runs won't start without them.`);
    }

    let needsWater = false;
    for (const k of reag) {
        // A batch already on the bench counts as done. Its ingredient was consumed the moment a
        // scientist picked the job up (see staff.js), so going by the shelf would report the raw
        // material as missing and send the player off to re-order it — while the reagent they
        // asked for is being made three tiles away.
        if (reagentCount(k) > 0) continue;
        const ing = REAGENTS[k].ingredient;
        const brewing = (s.prepping && s.prepping[k]) || 0;
        const queued = (s.brewOrders && s.brewOrders[k]) || 0;
        const ingReady = stockCount(ing) >= REAGENT_BATCH;
        const ingDue = arrivalOf(ing);
        needsWater = true;
        // On the bench right now. Its ingredient was consumed when a scientist picked the job up,
        // so going by shelf contents alone would report the raw material as missing.
        if (brewing > 0) { waiting(`<b>${REAGENTS[k].name}</b> is being brewed now.`); continue; }
        if (queued > 0) {
            if (ingReady) waiting(`<b>${REAGENTS[k].name}</b> is on the order book, waiting for a free scientist.`);
            else if (ingDue) waiting(`<b>${REAGENTS[k].name}</b> is on the order book. Its <b>${INGREDIENTS[ing].name}</b> is ${ingDue}.`);
            else todo(`Order <b>${INGREDIENTS[ing].name}</b> in <b>Stock</b>. Your <b>${REAGENTS[k].name}</b> order is waiting on it.`);
            continue;
        }
        if (ingReady) todo(`Order a batch of <b>${REAGENTS[k].name}</b> in <b>Stock</b>. Nothing is brewed unless you ask.`);
        else if (ingDue) todo(`Order a batch of <b>${REAGENTS[k].name}</b> in <b>Stock</b>. Its <b>${INGREDIENTS[ing].name}</b> is ${ingDue}.`);
        else todo(`Order <b>${INGREDIENTS[ing].name}</b> in <b>Stock</b>, then brew <b>${REAGENTS[k].name}</b>.`);
    }
    // Brewing anything takes distilled water, and a lab with no Sink and an empty tank stalls
    // silently — the brew order just never gets picked up.
    if (needsWater && s.water < REAGENT_WATER_COST && !s.equipment.some(e => BUILD[e.type].kind === 'water'))
        todo(`Build a <b>Sink</b>, or order <b>Distilled Water</b>. Brewing needs it and the tank is empty.`);
    if (!s.staff.length) todo(`Hire a scientist in <b>Staff</b>. Nothing moves without one.`);
    return tasks;
}
// Renders the list, or nothing at all when the lab is ready for this job.
const taskList = (protoKey) => {
    const tasks = contractTasks(protoKey);
    if (!tasks.length) return `<div class="tasks ready">✓ Your lab can run this</div>`;
    const todos = tasks.filter(t => !t.waiting), waits = tasks.filter(t => t.waiting);
    let h = `<div class="tasks">`;
    if (todos.length) h += `<div class="t-head">To run this you still need:</div>` +
        todos.map(t => `<div class="t-item">☐ ${t.text}</div>`).join('');
    if (waits.length) h += `<div class="t-head wait">On its way:</div>` +
        waits.map(t => `<div class="t-item wait">⏳ ${t.text}</div>`).join('');
    return h + `</div>`;
};

const capChain = (protoKey) => {
    const owned = ownedCaps();
    return PROTOCOLS[protoKey].steps.map(s =>
        `<span class="cap ${owned.has(s.cap) ? 'have' : 'miss'}">${CAP_LABEL[s.cap]}</span>`
    ).join('<span class="arr">›</span>');
};

export const BUILDERS = {
    build() {
        const lv = labLevel();
        let h = `<div class="dd-head">Build
            <span class="tool-row">
              <button class="t ${G.tool === 'move' ? 'on' : ''}" data-tool="move">Move (M)</button>
              <button class="t ${G.tool === 'rotate' ? 'on' : ''}" data-tool="rotate">Rotate (R)</button>
              <button class="t ${G.tool === 'demolish' ? 'on' : ''}" data-tool="demolish">Demolish (X)</button>
            </span></div>`;

        for (const cat of CAT_ORDER) {
            h += `<div class="dd-sub">${cat}</div><div class="grid">`;
            for (const [key, b] of Object.entries(BUILD)) {
                if (b.cat !== cat) continue;
                const locked = lv < b.minLevel;
                const poor = !locked && G.state.money < b.cost;
                const caps = ((b.caps || []).map(c => CAP_LABEL[c]).join(' + ') || (b.room ? roomGrantLabel(b.kind) : '') ||
                    (b.kind === 'cold' ? `${b.slots} cold shelves` : b.kind === 'clean' ? 'cleaning' : b.kind === 'water' ? 'water' : '')) +
                    (b.batch > 1 ? ` · ×${b.batch} batch` : '') +
                    roomBonusFor(key).map(x => ` · ${x}`).join('');
                h += `<button class="item ${G.tool === key ? 'on' : ''} ${locked ? 'locked' : ''} ${poor ? 'poor' : ''}" data-tool="${key}">
                    <span class="i-name">${b.name}</span>
                    <span class="i-meta">${locked ? 'Rating ' + b.minLevel : '$' + b.cost}</span>
                    <span class="i-cap">${caps}</span>
                    <span class="i-desc">${b.desc}</span>
                </button>`;
            }
            h += `</div>`;
        }

        h += `<div class="dd-sub">Expand Lab <span class="dim">${ownedTileCount()} tiles owned</span></div><div class="grid">`;
        for (const z of ZONES) {
            const owned = G.state.ownedZones.includes(z.id);
            const poor = !owned && G.state.money < z.cost;
            h += `<button class="item zone ${owned ? 'owned' : ''} ${poor ? 'poor' : ''}" ${owned ? 'disabled' : `data-zone="${z.id}"`}>
                <span class="i-name">${z.name}</span>
                <span class="i-meta">${owned ? 'Owned' : '$' + z.cost.toLocaleString()}</span>
                <span class="i-cap">${z.w * z.h} tiles</span>
            </button>`;
        }
        h += `</div>`;
        return h;
    },

    contracts() {
        const s = G.state;
        let h = `<div class="dd-head">Contracts <span class="dim">${s.contracts.length}/5 active</span></div>`;
        h += `<div class="dd-sub">Offers</div><div class="col">`;
        for (const o of s.offers) {
            h += `<div class="card">
                <div class="c-top"><span class="c-name">${o.name}</span><span class="pay">+$${o.reward}</span></div>
                <div class="c-org">${o.org} · ${o.required}× · +${o.repReward} rep · Day ${o.deadline}</div>
                <div class="chain">${capChain(o.proto)}</div>
                ${taskList(o.proto)}
                <button class="mini" data-accept="${o.id}">Accept</button>
            </div>`;
        }
        h += `</div><div class="dd-sub">Active</div><div class="col">`;
        if (!s.contracts.length) h += `<div class="empty">Nothing active</div>`;
        for (const c of s.contracts) {
            const left = c.deadline - s.day;
            const arrivals = c.arrivals || [];
            const pending = arrivals.reduce((sum, a) => sum + a.count, 0);
            const nextDay = arrivals.length ? Math.min(...arrivals.map(a => a.day)) : null;
            const arrivalNote = pending ? ` · ${pending} more arriving${nextDay != null ? ' Day ' + nextDay : ''}` : '';
            h += `<div class="card ${left <= 1 ? 'urgent' : 'active'}">
                <div class="c-top"><span class="c-name">${c.name}</span><span class="pay">+$${c.reward}</span></div>
                <div class="pbar"><i style="width:${(c.done / c.required * 100).toFixed(0)}%"></i></div>
                <div class="c-org">${c.done}/${c.required} done · ${left} day${left === 1 ? '' : 's'} left${arrivalNote}${c.spoiledCount ? ` · <span class="warnline">${c.spoiledCount} spoiled (cuts payout)</span>` : ''}</div>
                <div class="chain">${capChain(c.proto)}</div>
                ${taskList(c.proto)}
                <button class="mini danger" data-cancel="${c.id}">Cancel contract (-$${cancelCost(c).fee.toLocaleString()})</button>
            </div>`;
        }
        h += `</div>`;
        return h;
    },

    staff() {
        const s = G.state;
        let h = `<div class="dd-head">Staff <span class="dim">${s.staff.length}/${maxStaff()}</span></div>`;
        h += `<button class="wide" data-hire ${s.staff.length >= maxStaff() || s.money < s.hireCost ? 'disabled' : ''}>Hire Scientist, $${s.hireCost}</button>`;
        h += `<div class="dd-sub">Cold storage <button class="tgl ${s.coldStore ? 'on' : ''}" data-coldstore>store perishables ${s.coldStore ? 'ON' : 'OFF'}</button></div>
              <div class="c-org">${coldUsed()}/${coldCapacity()} fridge/freezer shelves in use. When on, a free scientist will shelve a fading sample before it's needed, instead of leaving it to rot in the queue.</div>`;
        const owed = s.staff.reduce((n, w) => n + perksOwed(w), 0);
        if (owed) h += `<div class="c-org warnline">${owed} scientist${owed === 1 ? ' has' : 's have'} a new skill to pick.</div>`;
        h += `<div class="dd-sub">Scientists <span class="dim">tick what each one is allowed to do</span></div><div class="col">`;
        for (const w of s.staff) {
            const lvl = careerLevel(w), pick = perksOwed(w) > 0;
            const intoLevel = (w.xp || 0) % CAREER_XP_PER_LEVEL;
            const pct = lvl >= CAREER_MAX_LEVEL ? 100 : Math.round(intoLevel / CAREER_XP_PER_LEVEL * 100);
            h += `<div class="staff${pick ? ' pick' : ''}">
                <div class="s-top"><span>${w.name} <b class="lvl">Lv${lvl}</b>${w.illUntil != null ? ' 🤒' : ''}</span><span class="dim">${w.illUntil != null ? `off sick until Day ${w.illUntil}` : labelState(w.state)}</span></div>
                <div class="s-sub dim">$${dailyWage(w)}/day${lvl >= CAREER_MAX_LEVEL ? ' · fully qualified' : ` · ${pct}% to Lv${lvl + 1}`}</div>
                ${lvl < CAREER_MAX_LEVEL ? `<span class="meter sm xp"><i class="good" style="width:${pct}%"></i></span>` : ''}
                <div class="traits">${(w.traits || []).map(t => {
                    const d = STAFF_TRAITS[t]; if (!d) return '';
                    return `<span class="trait ${d.good ? 'tg' : 'tb'}" title="${d.desc}">${d.name}</span>`;
                }).join('')}${(w.perks || []).map(k => {
                    const d = STAFF_PERKS[k]; if (!d) return '';
                    return `<span class="trait tp" title="${d.desc}">${d.name}</span>`;
                }).join('')}</div>
                <div class="roles">
                  ${staffCaps().map(c =>
                    `<button class="r cb ${w.caps[c] ? 'on' : ''}" data-cap="${w.id}:${c}">${w.caps[c] ? '☑' : '☐'} ${STAFF_CAP_LABEL[c]}</button>`).join('')}
                </div>
                ${skillBadges(w)}
                ${pick ? `<div class="perkpick"><div class="pp-head">${w.name} has earned a skill. Choose one:</div>
                    ${(w.perkChoices || []).map(k => {
                        const d = STAFF_PERKS[k]; if (!d) return '';
                        return `<button class="mini perk" data-perk="${w.id}:${k}"><b>${d.name}</b> ${d.desc}</button>`;
                    }).join('')}</div>` : ''}
                <button class="mini danger" data-fire="${w.id}">Fire</button>
            </div>`;
        }
        if (!s.staff.length) h += `<div class="empty">No scientists yet</div>`;
        h += `</div>`;
        return h;
    },

    stock() {
        const s = G.state;
        const hasSink = s.equipment.some(e => BUILD[e.type].kind === 'water');
        const used = stockUsed(), cap = stockCapacity(), pct = Math.min(100, Math.round(used / cap * 100));
        const lv = s.upgrades.storage || 0, maxLv = UPGRADES.storage.max;
        const crates = (s.deliveries || []).length;
        let h = `<div class="dd-head">Stock</div>`;

        h += `<div class="meter-lbl">Shelf space <b class="${pct > 90 ? 'bad' : pct > 70 ? 'mid' : 'good'}">${used}/${cap}</b></div>
              <div class="meter"><i style="width:${pct}%" class="${pct > 90 ? 'bad' : pct > 70 ? 'mid' : 'good'}"></i></div>`;
        h += `<div class="c-org">The stockroom is the annex east of the entrance${lv ? ` — racked out to level ${lv}` : ', currently one rack by the door'}. ${lv < maxLv ? 'Extend it under <b>Upgrades → Stockroom</b>. ' : ''}Prices move every morning and orders land the next day, so it pays to buy ahead while something's cheap, but anything on order, or still sitting in a crate by the door, reserves its shelf space now.</div>`;

        if (crates) {
            h += `<div class="dd-sub">At the door <span class="dim">waiting to be put away</span></div><div class="col">`;
            const byKey = {};
            for (const c of s.deliveries) byKey[c.key] = (byKey[c.key] || 0) + c.qty;
            for (const [k, qty] of Object.entries(byKey))
                h += `<div class="reg"><span>${qty}× ${(INGREDIENTS[k] || SUPPLIES[k]).name}</span><span class="dim">in crates</span></div>`;
            h += `<div class="c-org">${crates} crate${crates > 1 ? 's' : ''} stacked in the doorway. A free scientist will carry them through to the stockroom. None of it can be used until they do.</div></div>`;
        }

        if (s.orders && s.orders.length) {
            h += `<div class="dd-sub">On order</div><div class="col">`;
            for (const o of s.orders) {
                const item = INGREDIENTS[o.key] || SUPPLIES[o.key];
                h += `<div class="reg"><span>${o.qty}× ${item.name}</span><span class="dim">arrives Day ${o.day}</span></div>`;
            }
            h += `</div>`;
        }

        const row = (key, item) => {
            const price = unitPrice(key), tr = priceTrend(key), have = stockCount(key);
            const arrow = tr > 0 ? '<span class="up">▲</span>' : tr < 0 ? '<span class="down">▼</span>' : '<span class="dim">–</span>';
            // Water goes to the tank, not the shelf, so it's never space-limited. For everything
            // else, offer what will actually fit rather than a dead "No space" button. A partial
            // order is nearly always what the player wanted anyway, and a disabled button with no
            // explanation is a worse answer than a smaller one.
            const free = key === 'water' ? 10 : stockFree();
            const qty = Math.min(10, Math.max(0, free));
            const cost = price * qty;
            const full = qty <= 0, poor = s.money < cost;
            return `<div class="reg buy">
                <span>${item.name}<span class="dim"> · ${have} ${item.unit}</span><br>
                    <span class="dim">$${price}/unit ${arrow}</span></span>
                <button class="mini buyb ${poor || full ? 'poor' : ''}" data-order="${key}" data-qty="${qty}" ${full ? 'disabled' : ''}>
                    ${full ? 'Shelf full' : `Order ×${qty}, $${cost.toLocaleString()}`}
                </button>
            </div>`;
        };

        h += `<div class="dd-sub">Consumables <span class="dim">used up by runs</span></div><div class="col">`;
        for (const [k, item] of Object.entries(SUPPLIES)) {
            const usedBy = item.caps ? item.caps.map(c => CAP_LABEL[c]).join(', ') : 'every run';
            h += row(k, item);
            h += `<div class="c-org">${usedBy} · ${item.perSample ? 'one per sample' : 'one per run, however full the batch'}</div>`;
        }
        h += `</div>`;

        h += `<div class="dd-sub">Raw Ingredients <span class="dim">brewed into reagents</span></div><div class="col">`;
        for (const [k, item] of Object.entries(INGREDIENTS)) h += row(k, item);
        h += `</div>`;

        h += `<div class="dd-sub">Distilled Water</div><div class="col">`;
        h += row('water', WATER_ITEM);
        if (!hasSink) h += `<div class="c-org warnline">No Sink built, so none of this is being made in-house. Buy it in, or build a Sink under Utility and a scientist will draw it for free.</div>`;
        else if (s.water < WATER_MIN) h += `<div class="c-org">Running low. A free scientist will top it up at the sink, or buy a batch in to bridge the gap.</div>`;
        h += `</div>`;

        h += `<div class="dd-sub">Stock Solutions <span class="dim">brewed to order, then they perish</span></div><div class="col">`;
        for (const [k, r] of Object.entries(REAGENTS)) {
            const list = s.reagents.filter(x => x.type === k).sort((a, b) => a.expire - b.expire);
            const next = list[0] ? ` · next expires Day ${list[0].expire}` : '';
            const queued = (s.brewOrders && s.brewOrders[k]) || 0;
            const inFlight = (s.prepping && s.prepping[k]) || 0;
            const ing = INGREDIENTS[r.ingredient];
            const haveIng = stockCount(r.ingredient);
            const canBrew = haveIng >= REAGENT_BATCH;
            h += `<div class="reg"><span>${r.name}<span class="dim"> · ${list.length} in stock${next}</span><br>
                    <span class="dim">${REAGENT_BATCH} per batch from ${REAGENT_BATCH}× ${ing.name} + ${REAGENT_WATER_COST} water</span></span>
                  <span class="brew">
                    <button class="mini adj" data-brew="${k}:-1" ${queued <= 0 ? 'disabled' : ''}>−</button>
                    <span class="brew-n ${queued ? 'on' : ''}">${queued}</span>
                    <button class="mini adj" data-brew="${k}:1" ${queued >= BREW_QUEUE_MAX ? 'disabled' : ''}>+</button>
                  </span></div>`;
            if (queued || inFlight)
                h += `<div class="c-org">${queued ? `${queued} batch${queued > 1 ? 'es' : ''} ordered` : 'Order filled'}${inFlight ? `, ${inFlight} being brewed now` : ''}.${!canBrew && queued ? ` <b class="bad">Waiting on ${ing.name}</b>, only ${haveIng} in stock.` : ''}</div>`;
        }
        h += `<div class="c-org">Nothing is brewed unless you ask for it. Order a batch and a free scientist takes the ingredients to a bench. They go off after a few days, so brewing early is as wasteful as brewing late is slow.</div>`;
        h += `</div>`;
        return h;
    },

    upgrades() {
        const s = G.state;
        let h = `<div class="dd-head">Upgrades</div><div class="col">`;
        for (const [k, u] of Object.entries(UPGRADES)) {
            const lvl = s.upgrades[k], maxed = lvl >= u.max, cost = upgradeCost(k);
            h += `<div class="card">
                <div class="c-top"><span class="c-name">${u.name}</span><span class="dim">Lv ${lvl}/${u.max}</span></div>
                <div class="c-org">${u.desc}</div>
                <button class="mini" data-up="${k}" ${maxed || s.money < cost ? 'disabled' : ''}>${maxed ? 'Maxed' : '$' + cost}</button>
            </div>`;
        }
        h += `</div>`;
        return h;
    },

    lab() {
        const s = G.state, cl = Math.round(cleanliness());
        const st = s.stats, bill = utilityBreakdown();
        let h = `<div class="dd-head">Lab Status</div>`;
        h += `<div class="meter-lbl">Cleanliness <b class="${cl < 40 ? 'bad' : cl < 70 ? 'mid' : 'good'}">${cl}%</b></div>
              <div class="meter"><i style="width:${cl}%" class="${cl < 40 ? 'bad' : cl < 70 ? 'mid' : 'good'}"></i></div>
              <div class="c-org">Cold storage: ${coldUsed()}/${coldCapacity()} shelves used · Lab Rating ${labLevel()}${repToNext() ? ` (next at ${repToNext()} rep)` : ' (max)'}</div>`;
        if (cl < 40) h += `<div class="c-org warnline">Filthy: slower steps, lower quality, contamination risk. Assign a cleaner.</div>`;

        // Includes the fire alarm: it's on the mechanic's list too, so leaving it out here made
        // the call-out quote below count a machine the player couldn't see anywhere.
        // Where the day went. Sits above the equipment list because it answers the question the
        // player actually has -- what to buy next -- and the wear list only answers what to fix.
        const bn = bottleneck(), loads = machineLoad(), sl = staffLoad();
        if (bn) {
            const tone = bn.kind === 'ok' ? '' : ' warnline';
            h += `<div class="dd-sub">Where the day went ${s.util && s.util.prev ? '<span class="dim">yesterday</span>' : '<span class="dim">so far today</span>'}</div>`;
            h += `<div class="c-org${tone}">${bn.text}</div>`;
            if (sl) {
                const pc = (v) => Math.round(v * 100);
                h += `<div class="loadbar" title="How the scientists' day divided up">
                        <i class="l-work" style="width:${pc(sl.work)}%"></i><i class="l-walk" style="width:${pc(sl.walk)}%"></i><i class="l-spare" style="width:${pc(sl.spare)}%"></i>
                      </div>
                      <div class="c-org dim">Staff: ${pc(sl.work)}% working · ${pc(sl.walk)}% walking · ${pc(sl.spare)}% spare</div>`;
            }
            for (const m of loads.slice(0, 6)) {
                const p = Math.round(m.busy * 100);
                const cls = p > 85 ? 'bad' : p > 60 ? 'mid' : 'good';
                h += `<div class="loadrow"><span class="ln">${m.name}</span>
                        <span class="meter sm"><i class="${cls}" style="width:${p}%"></i></span>
                        <span class="lp ${cls}">${p}%</span>${m.waiting ? `<span class="lq">${m.waiting} queued</span>` : ''}</div>`;
            }
        }

        const machines = s.equipment.filter(e => BUILD[e.type].cat === 'Processing' || BUILD[e.type].mount);
        const broken = machines.filter(e => e.broken);
        const worn = machines.filter(e => !e.broken && (e.condition ?? 100) < MECH_MAINT_THRESHOLD);
        if (machines.length) {
            h += `<div class="dd-sub">Equipment</div>`;
            if (broken.length)
                h += `<div class="c-org warnline">Broken down: ${broken.map(e => BUILD[e.type].name).join(', ')}. Dead until a mechanic's been in.</div>`;
            if (worn.length)
                h += `<div class="c-org">Showing wear: ${worn.map(e => `${BUILD[e.type].name} (${Math.round(e.condition)}%)`).join(', ')}.</div>`;
            if (!broken.length && !worn.length) h += `<div class="c-org">All ${machines.length} machines in good condition.</div>`;
            const q = mechanicQuote(), onSite = mechanicOnSite();
            if (onSite) {
                h += `<div class="c-org">The mechanic is on the floor now, ${onSite.left} machine${onSite.left === 1 ? '' : 's'} still to get to. Each one is billed as they finish it.</div>`;
                h += `<button class="mini" disabled>Mechanic on site</button>`;
            } else if (s.mechanicDay != null) {
                h += `<div class="c-org">Mechanic booked for <b>Day ${s.mechanicDay}</b>. They'll let themselves in that morning and work down the list on the floor, machine by machine.</div>`;
                h += `<button class="mini" disabled>Mechanic booked</button>`;
            } else if (q.broken || q.worn) {
                h += `<div class="c-org">A call-out covers the lot in one visit: ${q.broken} to repair, ${q.worn} to service. The fee is charged per visit, so there's a saving in letting a couple pile up. As long as you can spare the machines. They work in the open, one machine at a time, and whatever they're stood at can't be used until they've moved on.</div>`;
                h += `<button class="mini" data-mech>Call a mechanic. About $${q.cost.toLocaleString()}, arrives Day ${s.day + 1}</button>`;
            }
        }

        // Safety — the alarm is the only thing in the lab whose *condition* decides whether it
        // works when it matters, so it gets its own line rather than sitting in the wear list.
        h += `<div class="dd-sub">Safety</div>`;
        const alarms = s.equipment.filter(e => BUILD[e.type].mount);
        if (!alarms.length) {
            h += `<div class="c-org warnline">No fire alarm. Worn equipment can catch fire, and without one nobody evacuates until you notice and press the button yourself. Build one from Build → Utility.</div>`;
        } else {
            const rel = Math.round(alarmReliability() * 100);
            h += `<div class="c-org">${alarms.length} fire alarm${alarms.length > 1 ? 's' : ''}. About <b class="${rel < 50 ? 'bad' : rel < 80 ? 'mid' : 'good'}">${rel}%</b> likely to trip and call the brigade for you. Servicing them raises that.</div>`;
        }
        const sealed = sealedRooms(s);
        if (sealed.length)
            h += `<div class="c-org warnline">${sealed.length} room${sealed.length > 1 ? 's have' : ' has'} no way in. Place a Door (or an Airlock, for a Cleanroom or Containment Lab) on one of its tiles or nothing inside will ever be used.</div>`;
        const contain = s.equipment.filter(e => BUILD[e.type].kind === 'contain');
        if (contain.length && !s.outbreak)
            h += `<div class="c-org">Containment floor is clear. Neglected equipment standing on it can breach and seal the room.</div>`;
        if (st.fires || st.outbreaks || st.deaths)
            h += `<div class="c-org">Incident record: ${st.fires || 0} fire(s), ${st.outbreaks || 0} breach(es), <b class="${st.deaths ? 'bad' : ''}">${st.deaths || 0} death(s)</b>.</div>`;

        h += `<div class="dd-sub">Finance</div>`;
        if (s.loan > 0) {
            h += `<div class="c-org">Loan: <b class="${s.loan > 20000 ? 'bad' : 'mid'}">$${Math.round(s.loan).toLocaleString()}</b> owed. Interest of <b>$${interestDue().toLocaleString()}</b> is taken in cash every ${LOAN_INTEREST_DAYS} days. Next on Day ${nextInterestDay()}. The balance itself doesn't grow; paying it down is what shrinks the bill.</div>`;
        } else {
            h += `<div class="c-org">No outstanding loan.</div>`;
        }
        const canRepay = Math.min(loanAmount, s.loan, Math.max(0, s.money));
        h += `<div class="loan-row">
                <button class="mini adj" data-loanadj="-1" ${loanAmount <= LOAN_STEP ? 'disabled' : ''}>−</button>
                <span class="loan-amt">$${loanAmount.toLocaleString()}</span>
                <button class="mini adj" data-loanadj="1" ${loanAmount >= LOAN_MAX ? 'disabled' : ''}>+</button>
              </div>`;
        h += `<button class="mini" data-borrow ${s.loan >= LOAN_MAX ? 'disabled' : ''}>Borrow $${loanAmount.toLocaleString()}</button>`;
        h += `<button class="mini" data-repay ${canRepay <= 0 ? 'disabled' : ''}>Repay $${canRepay.toLocaleString()}</button>`;

        h += `<div class="dd-sub">Running costs</div>
              <div class="stats">
                <span>⚡ Electricity<b>$${bill.electricity}/day</b></span>
                <span>🔥 Heating<b>$${bill.heating}/day</b></span>
                <span>💡 Lighting<b>$${bill.lighting}/day</b></span>
                <span>👩‍🔬 Wages<b>$${bill.wages}/day</b></span>
                <span>Owned tiles<b>${ownedTileCount()}</b></span>
                <span>Scientists<b>${s.staff.length}</b></span>
              </div>
              <div class="c-org">Total bill: $${bill.total}/day. Charged at midnight. Bigger labs, more machines and more experienced staff all cost more to run.</div>`;

        h += `<div class="dd-sub">Records</div><div class="stats">
            <span>Contracts done<b>${st.done}</b></span>
            <span>Contracts failed<b>${st.failed}</b></span>
            <span>Samples processed<b>${st.processed}</b></span>
            <span>Spoiled<b>${st.spoiled}</b></span>
            <span>Contaminations<b>${st.contam}</b></span>
            <span>Tiles mopped<b>${st.mopped}</b></span>
        </div>`;
        return h;
    },

    help() {
        // Deliberately a reference card, not a manual. Teaching the loop is the interactive
        // tutorial's job now (ui/tutorial.js). What's left here is the stuff you come back to
        // look up, in one screen, plus a way to run the tutorial again.
        let h = `<div class="dd-head">Help</div>`;
        h += `<button class="wide" data-replay>▶ Replay the tutorial</button>`;

        const rows = [
            ['Chains', `Every contract is a sequence of steps and each needs its own machine. The contract card lists exactly what you're missing.`],
            ['Batching', `A sample dropped at a machine waits there for company. Runs go faster per sample when the batch is full. Let work pile up instead of chasing each tube.`],
            ['Attended kit', `A Bench, Microscope, Workstation or hood ties a scientist up for the whole run. Automated kit doesn't.`],
            ['Rooms', `Dark Room, Cleanroom and Containment Lab are floor you lay a tile at a time, over machines you already own. They upgrade whatever stands inside. Each needs a Door. An Airlock for the sealed ones, or it's inert.`],
            ['Stock', `Orders arrive next morning as crates at the door and must be carried to the stockroom. <b>A run will not start without the consumables it needs.</b> Extend the stockroom under Upgrades.`],
            ['Reagents', `Saline, Solvent and Buffer are brewed only when you order a batch in Stock, and they perish after a few days.`],
            ['Ordering for you', `Buy <b>Procurement</b> under Upgrades and an <b>Orders</b> tickbox appears on any scientist, so long as you have a <b>Workstation</b> for them to sit at. Anyone ticked will sit at it and restock the shelf from what the lab actually got through, keeping about ${ORDER_COVER_DAYS} days' worth. They won't spend you below $${ORDER_CASH_RESERVE.toLocaleString()}, won't reorder what's already on its way, and won't overfill the stockroom.`],
            ['Your staff', `Every scientist is hired with innate traits, good and bad, that are theirs for good. Work earns them career levels, and each level lets you pick a skill for them in Staff. They draw a wage every day that rises with their level, so a veteran is better and dearer both.`],
            ['Wear', `Machines wear down, run slow, then break. Nobody on the payroll fixes them. Book a mechanic in Lab and they come the next morning.`],
            ['Accidents', `Neglected kit catches fire and spreads; a Fire Alarm evacuates and calls the brigade for you, if it's been serviced. Neglected kit in Containment breaches instead, sealing the room until a disinfection crew has been in.`],
            ['Money', `You open on a loan. Interest is billed every ${LOAN_INTEREST_DAYS} days, and wages and utilities daily, whether you've earned anything or not.`],
            ['Bottlenecks', `The Lab menu shows where the day actually went: how much of it each machine spent running, and how much of it your staff spent working, walking or spare. It names whatever is holding the lab up, so you know whether to buy a machine, hire someone, or move things closer together.`]
        ];
        h += `<div class="col">`;
        for (const [k, v] of rows) h += `<div class="reg"><span><b>${k}</b><br><span class="dim">${v}</span></span></div>`;
        h += `</div>`;

        h += `<div class="dd-sub">Controls</div><div class="col">`;
        for (const [k, v] of [
            ['Drag / WASD', 'move the view'], ['Q / E', 'turn the view'], ['Scroll / pinch', 'zoom'],
            ['B', 'Build'], ['C', 'Contracts'], ['R', 'rotate what you\'re placing'],
            ['M', 'move something built'], ['X', 'sell something'], ['P', 'pause'], ['Esc', 'cancel']
        ]) h += `<div class="reg"><span>${k}</span><span class="dim">${v}</span></div>`;
        h += `</div>`;
        h += `<div class="c-org">Laying room floor keeps the tool in your hand. Keep clicking tiles, Esc when the shape is right. The game saves itself every in-game day.</div>`;
        return h;
    }
};

export function wireMenu(menu, dd) {
    if (menu === 'build') {
        dd.querySelectorAll('[data-tool]').forEach(el =>
            el.addEventListener('click', () => _onToolSelect(el.dataset.tool)));
        dd.querySelectorAll('[data-zone]').forEach(el =>
            el.addEventListener('click', () => buyZone(el.dataset.zone)));
    } else if (menu === 'contracts') {
        dd.querySelectorAll('[data-accept]').forEach(el =>
            el.addEventListener('click', () => acceptContract(+el.dataset.accept)));
        dd.querySelectorAll('[data-cancel]').forEach(el =>
            el.addEventListener('click', () => {
                const c = G.state.contracts.find(x => x.id === +el.dataset.cancel);
                if (!c) return;
                const { fee, rep } = cancelCost(c);
                if (confirm(`Cancel "${c.name}"?\n\nBreak fee: $${fee.toLocaleString()}\nReputation: -${rep}\n\nStill far cheaper than failing it at the deadline.`))
                    cancelContract(c.id);
            }));
    } else if (menu === 'staff') {
        const hb = dd.querySelector('[data-hire]');
        if (hb) hb.addEventListener('click', () => hireStaff());
        const cs = dd.querySelector('[data-coldstore]');
        if (cs) cs.addEventListener('click', () => toggleColdStore());
        dd.querySelectorAll('[data-fire]').forEach(el =>
            el.addEventListener('click', () => {
                const w = G.state.staff.find(x => x.id === +el.dataset.fire);
                if (w && confirm(`Fire ${w.name}?\n\nAnything they're carrying goes back in the queue, and hiring a replacement costs full price.`))
                    fireStaff(w.id);
            }));
        dd.querySelectorAll('[data-perk]').forEach(el =>
            el.addEventListener('click', () => {
                const [id, perk] = el.dataset.perk.split(':');
                choosePerk(+id, perk);
            }));
        dd.querySelectorAll('[data-cap]').forEach(el =>
            el.addEventListener('click', () => {
                const [id, cap] = el.dataset.cap.split(':');
                toggleStaffCap(+id, cap);
            }));
    } else if (menu === 'stock') {
        dd.querySelectorAll('[data-order]').forEach(el =>
            el.addEventListener('click', () => orderStock(el.dataset.order, +el.dataset.qty || 10)));
        dd.querySelectorAll('[data-brew]').forEach(el =>
            el.addEventListener('click', () => {
                const [type, d] = el.dataset.brew.split(':');
                orderBrew(type, +d);
            }));
    } else if (menu === 'upgrades') {
        dd.querySelectorAll('[data-up]').forEach(el =>
            el.addEventListener('click', () => buyUpgrade(el.dataset.up)));
    } else if (menu === 'help') {
        const rp = dd.querySelector('[data-replay]');
        if (rp) rp.addEventListener('click', () => restartTutorial());
    } else if (menu === 'lab') {
        const mech = dd.querySelector('[data-mech]');
        if (mech) mech.addEventListener('click', () => callMechanic());
        const rp = dd.querySelector('[data-repay]');
        if (rp) rp.addEventListener('click', () => repayLoan(loanAmount));
        const br = dd.querySelector('[data-borrow]');
        if (br) br.addEventListener('click', () => borrowLoan(loanAmount));
        dd.querySelectorAll('[data-loanadj]').forEach(el =>
            el.addEventListener('click', () => { adjustLoanAmount(+el.dataset.loanadj); G.onUIDirty(); }));
    }
}

function labelState(st) {
    return ({
        idle: 'idle', resting: 'idle', toMop: 'to mop', mopping: 'mopping',
        toPickup: 'fetching sample', toStation: 'carrying sample', atStation: 'dropping off sample',
        toPrep: 'to bench', prepping: 'making reagent',
        toSink: 'to sink', filling: 'drawing water',
        toColdPickup: 'fetching sample', toFridge: 'to fridge', storing: 'shelving sample',
        toOperate: 'to machine', operating: 'starting a run', tending: 'working the bench',
        toDesk: 'to the desk', ordering: 'ordering stock',
        toCrate: 'to the delivery', toStock: 'carrying a crate', stocking: 'putting stock away',
        evacuating: 'evacuating!', evacuatingDone: 'outside', sick: 'going home sick', sickDone: 'off sick'
    })[st] || st;
}
