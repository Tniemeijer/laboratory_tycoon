// ==================== DROPDOWN CONTENT ====================
// Pure(ish) HTML builders for each top-bar menu, plus the click wiring for whatever the
// last-rendered menu was. Tool selection is injected from toolbar.js to avoid a cyclic import.

import {
    G, BUILD, PROTOCOLS, UPGRADES, REAGENTS, INGREDIENTS, SUPPLIES, SUPPLY_FOR_CAP, WATER_ITEM, ZONES, CAP_LABEL,
    orderStock, unitPrice, priceTrend, stockCapacity, stockUsed, stockFree, stockCount,
    WATER_MIN, REAGENT_WATER_COST, MECH_MAINT_THRESHOLD, LOAN_INTEREST_RATE, LOAN_MAX,
    SKILL_MAX_LEVEL, SKILL_XP_PER_LEVEL, ROOM_BONUS_CAP, LOAN_INTEREST_DAYS, LOAN_STEP,
    interestDue, nextInterestDay,
    labLevel, repToNext, coldCapacity, coldUsed, maxStaff, upgradeCost, ownedCaps,
    cleanliness, ownedTileCount, utilityBreakdown, reagentCount,
    acceptContract, hireStaff, toggleStaffCap, buyUpgrade, buyZone, toggleAutoPrep, toggleColdStore,
    borrowLoan, repayLoan
} from '../game.js';

const CAT_ORDER = ['Processing', 'Storage', 'Utility'];
// Rooms have no caps of their own to list — what they're worth is whatever they add to a machine
// standing inside, so both sides of that are read straight off ROOM_BONUS_CAP rather than being
// spelled out twice and left to drift.
const roomGrantLabel = (kind) => {
    const grants = ROOM_BONUS_CAP[kind] || {};
    const parts = Object.entries(grants).map(([type, cap]) => `+${CAP_LABEL[cap]} for a ${BUILD[type].name}`);
    return `2×2 room · ${parts.join(', ') || 'better-quality runs'}`;
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
const STAFF_CAPS = ['process', 'clean', 'mechanic'];
const STAFF_CAP_LABEL = { process: 'Process', clean: 'Clean', mechanic: 'Mechanic' };
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
    const reag = [], sup = new Set(['disposable']);
    for (const st of PROTOCOLS[protoKey].steps) {
        if (st.reagent && !reag.includes(st.reagent)) reag.push(st.reagent);
        if (SUPPLY_FOR_CAP[st.cap]) sup.add(SUPPLY_FOR_CAP[st.cap]);
    }
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
                ${needsChain(o.proto)}
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
                ${needsChain(c.proto)}
            </div>`;
        }
        h += `</div>`;
        return h;
    },

    staff() {
        const s = G.state;
        let h = `<div class="dd-head">Staff <span class="dim">${s.staff.length}/${maxStaff()}</span></div>`;
        h += `<button class="wide" data-hire ${s.staff.length >= maxStaff() || s.money < s.hireCost ? 'disabled' : ''}>Hire Scientist — $${s.hireCost}</button>`;
        h += `<div class="dd-sub">Cold storage <button class="tgl ${s.coldStore ? 'on' : ''}" data-coldstore>store perishables ${s.coldStore ? 'ON' : 'OFF'}</button></div>
              <div class="c-org">${coldUsed()}/${coldCapacity()} fridge/freezer shelves in use. When on, a free scientist will shelve a fading sample before it's needed, instead of leaving it to rot in the queue.</div>`;
        h += `<div class="dd-sub">Scientists <span class="dim">tick what each one is allowed to do</span></div><div class="col">`;
        for (const w of s.staff) {
            h += `<div class="staff">
                <div class="s-top"><span>${w.name}</span><span class="dim">${labelState(w.state)}</span></div>
                <div class="roles">
                  ${STAFF_CAPS.map(c =>
                    `<button class="r cb ${w.caps[c] ? 'on' : ''}" data-cap="${w.id}:${c}">${w.caps[c] ? '☑' : '☐'} ${STAFF_CAP_LABEL[c]}</button>`).join('')}
                </div>
                ${skillBadges(w)}
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
        let h = `<div class="dd-head">Stock <button class="tgl ${s.autoPrep ? 'on' : ''}" data-autoprep>auto-prep ${s.autoPrep ? 'ON' : 'OFF'}</button></div>`;

        h += `<div class="meter-lbl">Stockroom <b class="${pct > 90 ? 'bad' : pct > 70 ? 'mid' : 'good'}">${used}/${cap}</b></div>
              <div class="meter"><i style="width:${pct}%" class="${pct > 90 ? 'bad' : pct > 70 ? 'mid' : 'good'}"></i></div>
              <div class="c-org">Prices move every morning and orders land the next day, so it pays to buy ahead while something's cheap — but anything on order reserves its shelf space now. More room under <b>Upgrades → Stockroom</b>.</div>`;

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
            const qty = 10;
            const cost = price * qty;
            const tooBig = qty > stockFree(), poor = s.money < cost;
            return `<div class="reg buy">
                <span>${item.name}<span class="dim"> · ${have} ${item.unit}</span><br>
                    <span class="dim">$${price}/unit ${arrow}</span></span>
                <button class="mini buyb ${poor || tooBig ? 'poor' : ''}" data-order="${key}" ${tooBig ? 'disabled' : ''}>
                    ${tooBig ? 'No space' : `Order ×${qty} — $${cost.toLocaleString()}`}
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
        if (!hasSink) h += `<div class="c-org warnline">No Sink built, so none of this is being made in-house — buy it in, or build a Sink under Utility and a scientist will draw it for free.</div>`;
        else if (s.water < WATER_MIN) h += `<div class="c-org">Running low — a free scientist will top it up at the sink, or buy a batch in to bridge the gap.</div>`;
        h += `</div>`;

        h += `<div class="dd-sub">Stock Solutions (perishable)</div><div class="col">`;
        for (const [k, r] of Object.entries(REAGENTS)) {
            const list = s.reagents.filter(x => x.type === k).sort((a, b) => a.expire - b.expire);
            const next = list[0] ? ` · next expires Day ${list[0].expire}` : '';
            h += `<div class="reg"><span>${r.name} <span class="dim">(${INGREDIENTS[r.ingredient].name} + ${REAGENT_WATER_COST} water)</span></span><span class="dim">${list.length} in stock${next}</span></div>`;
        }
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

        const machines = s.equipment.filter(e => BUILD[e.type].cat === 'Processing');
        const broken = machines.filter(e => e.broken);
        const worn = machines.filter(e => !e.broken && (e.condition ?? 100) < MECH_MAINT_THRESHOLD);
        if (machines.length) {
            h += `<div class="dd-sub">Equipment</div>`;
            if (broken.length)
                h += `<div class="c-org warnline">Broken down: ${broken.map(e => BUILD[e.type].name).join(', ')} — needs a Mechanic.</div>`;
            if (worn.length)
                h += `<div class="c-org">Showing wear: ${worn.map(e => `${BUILD[e.type].name} (${Math.round(e.condition)}%)`).join(', ')}.</div>`;
            if (!broken.length && !worn.length) h += `<div class="c-org">All ${machines.length} machines in good condition.</div>`;
        }

        h += `<div class="dd-sub">Finance</div>`;
        if (s.loan > 0) {
            h += `<div class="c-org">Loan: <b class="${s.loan > 20000 ? 'bad' : 'mid'}">$${Math.round(s.loan).toLocaleString()}</b> owed. Interest of <b>$${interestDue().toLocaleString()}</b> is taken in cash every ${LOAN_INTEREST_DAYS} days — next on Day ${nextInterestDay()}. The balance itself doesn't grow; paying it down is what shrinks the bill.</div>`;
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

        h += `<div class="dd-sub">Utilities</div>
              <div class="stats">
                <span>⚡ Electricity<b>$${bill.electricity}/day</b></span>
                <span>🔥 Heating<b>$${bill.heating}/day</b></span>
                <span>💡 Lighting<b>$${bill.lighting}/day</b></span>
                <span>Owned tiles<b>${ownedTileCount()}</b></span>
              </div>
              <div class="c-org">Total bill: $${bill.total}/day — charged at midnight. Bigger labs and more machines cost more to run.</div>`;

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
        let h = `<div class="dd-head">How To Play</div>`;
        h += `<div class="dd-sub">The Loop</div>
            <div class="c-org">Accept a job in <b>Contracts</b>, build whatever machines its protocol chain needs, hire scientists in <b>Staff</b>, and they carry each sample through every step on their own.</div>`;
        h += `<div class="dd-sub">Protocols</div>
            <div class="c-org">Every contract runs a chain like Prep › Spin › Analyze. Each link needs a specific machine — the chain shown on a contract turns green for steps you already own, red for ones you don't. Samples don't all show up the day you accept — a big order ships in a few batches over the deadline, shown on the contract card.</div>`;
        h += `<div class="dd-sub">Batching</div>
            <div class="c-org">A scientist drops a sample off at a machine and is immediately free again — the sample waits there instead of tying anyone up. Centrifuges, benches and analyzers hold several samples per run (see the batch size in <b>Build</b>). Once enough matching samples pile up — or after a while even with just one waiting — a free scientist walks over and starts the run. Automated equipment then finishes on its own. Hands-on kit doesn't: a Lab Bench, Microscope, Analysis Desk, Flow Hood or Fume Hood keeps whoever started the run there until it's done, so those tie up a scientist as well as a machine. Big contracts move through equipment far faster if you let samples stack up rather than chasing each one solo. A <b>Prep Robot</b> skips the "walk over and start it" step entirely for prep runs, and doesn't need anyone to stay — pricier, but fully automated. A <b>Sample Cart</b> upgrade lets one trip carry several matching samples at once instead of one at a time.</div>`;
        h += `<div class="dd-sub">Equipment Wear</div>
            <div class="c-org">Every run wears a machine down a little, and a worn one runs slower and risks breaking outright. A broken machine sits dead until fixed — tick <b>Mechanic</b> for a scientist in <b>Staff</b>: they'll service worn machines before they fail, and repair (for a fee) any that already have. Nobody without it checked will touch a wrench.</div>`;
        h += `<div class="dd-sub">Rooms</div>
            <div class="c-org">Cleanrooms, Dark Rooms and the ML containment labs are <i>floor</i>, not machines: they lay a 2×2 patch of tinted, walled-off floor that you then build equipment on top of, and you can lay one over machines you already own. Put two of the same kind flush against each other and they merge into one bigger room. Nothing <i>needs</i> a room to work — every machine does its own job standing on the open floor. What a room adds is extra capability for whatever's inside it: a Microscope in a <b>Dark Room</b> also does fluorescence, a Chromatograph in a <b>Cleanroom</b> also does pharma-grade Chroma, and a Flow Hood in a <b>Containment Lab</b> handles work with biological and genetically modified agents. On top of that, any run on a machine inside any room comes out slightly higher quality. Sell a room by clicking its bare floor with <b>Demolish</b>.</div>`;
        h += `<div class="dd-sub">Stock & Reagents</div>
            <div class="c-org">Some prep steps consume a stock solution (Saline, Solvent, Buffer). Buy the raw ingredient in <b>Stock</b>, build a Sink for distilled water, and auto-prep turns both into reagent automatically.</div>`;
        h += `<div class="dd-sub">Cold Storage</div>
            <div class="c-org">Queued samples decay before they're ever picked up. A Fridge or Freezer lets a free scientist shelve a fading one to buy time — toggle it in <b>Staff</b>. Letting one spoil instead costs reputation and money immediately, <i>and</i> cuts that contract's final payout. Scientists also chill surplus samples that would otherwise pile up at a machine whose next run is already full — handy on a big contract where samples arrive faster than one batch can absorb them.</div>`;
        h += `<div class="dd-sub">Cleanliness</div>
            <div class="c-org">Machines leave grime behind as they're used. A filthy lab slows work and risks contamination — tick Clean for a scientist in <b>Staff</b> (uncheck Process if you want them mopping only), or leave both checked and they'll mop whenever nothing more urgent needs doing.</div>`;
        h += `<div class="dd-sub">Finance</div>
            <div class="c-org">The lab opens on a startup loan, not free cash — see <b>Lab</b> for the balance. Interest compounds daily on whatever's still owed, so it's worth paying down; you can also borrow more there if you need the runway, at the same rate.</div>`;
        h += `<div class="dd-sub">Building</div>
            <div class="c-org">Pick a machine in <b>Build</b>, tap a tile to place it — the <b>Rotate</b> button (or R) spins it while placing or afterward. <b>Demolish</b> (or X) sells one back for half price. Buy more land under Build → Expand Lab.</div>
            <div class="c-org">Most machines run one batch at a time — build more to parallelize. Incubators and fridges are the exception: several staff can load those at once regardless.</div>`;
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
    } else if (menu === 'staff') {
        const hb = dd.querySelector('[data-hire]');
        if (hb) hb.addEventListener('click', () => hireStaff());
        const cs = dd.querySelector('[data-coldstore]');
        if (cs) cs.addEventListener('click', () => toggleColdStore());
        dd.querySelectorAll('[data-cap]').forEach(el =>
            el.addEventListener('click', () => {
                const [id, cap] = el.dataset.cap.split(':');
                toggleStaffCap(+id, cap);
            }));
    } else if (menu === 'stock') {
        const ap = dd.querySelector('[data-autoprep]');
        if (ap) ap.addEventListener('click', () => toggleAutoPrep());
        dd.querySelectorAll('[data-order]').forEach(el =>
            el.addEventListener('click', () => orderStock(el.dataset.order, 10)));
    } else if (menu === 'upgrades') {
        dd.querySelectorAll('[data-up]').forEach(el =>
            el.addEventListener('click', () => buyUpgrade(el.dataset.up)));
    } else if (menu === 'lab') {
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
        toRepair: 'to repair job', repairing: 'repairing', toMaintain: 'to service job', maintaining: 'servicing'
    })[st] || st;
}
