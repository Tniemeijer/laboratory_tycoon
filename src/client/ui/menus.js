// ==================== DROPDOWN CONTENT ====================
// Pure(ish) HTML builders for each top-bar menu, plus the click wiring for whatever the
// last-rendered menu was. Tool selection is injected from toolbar.js to avoid a cyclic import.

import {
    G, BUILD, PROTOCOLS, UPGRADES, REAGENTS, INGREDIENTS, ZONES, CAP_LABEL,
    WATER_MIN, REAGENT_WATER_COST,
    labLevel, repToNext, coldCapacity, coldUsed, maxStaff, upgradeCost, ownedCaps,
    cleanliness, ownedTileCount, utilityBreakdown,
    acceptContract, hireStaff, setRole, buyUpgrade, buyZone, buyIngredient, toggleAutoPrep, toggleColdStore
} from '../game.js';

const CAT_ORDER = ['Processing', 'Storage', 'Utility'];
let _onToolSelect = () => {};
export function setToolHandler(fn) { _onToolSelect = fn; }

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
              <button class="t ${G.tool === 'rotate' ? 'on' : ''}" data-tool="rotate">Rotate (R)</button>
              <button class="t ${G.tool === 'demolish' ? 'on' : ''}" data-tool="demolish">Demolish (X)</button>
            </span></div>`;

        for (const cat of CAT_ORDER) {
            h += `<div class="dd-sub">${cat}</div><div class="grid">`;
            for (const [key, b] of Object.entries(BUILD)) {
                if (b.cat !== cat) continue;
                const locked = lv < b.minLevel;
                const poor = !locked && G.state.money < b.cost;
                const caps = (b.caps || []).map(c => CAP_LABEL[c]).join(' + ') ||
                    (b.kind === 'cold' ? `${b.slots} cold shelves` : b.kind === 'clean' ? 'cleaning' : b.kind === 'water' ? 'water' : '');
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
                <button class="mini" data-accept="${o.id}">Accept</button>
            </div>`;
        }
        h += `</div><div class="dd-sub">Active</div><div class="col">`;
        if (!s.contracts.length) h += `<div class="empty">Nothing active</div>`;
        for (const c of s.contracts) {
            const left = c.deadline - s.day;
            h += `<div class="card ${left <= 1 ? 'urgent' : 'active'}">
                <div class="c-top"><span class="c-name">${c.name}</span><span class="pay">+$${c.reward}</span></div>
                <div class="pbar"><i style="width:${(c.done / c.required * 100).toFixed(0)}%"></i></div>
                <div class="c-org">${c.done}/${c.required} done · ${left} day${left === 1 ? '' : 's'} left${c.spoiledCount ? ` · <span class="warnline">${c.spoiledCount} spoiled (cuts payout)</span>` : ''}</div>
                <div class="chain">${capChain(c.proto)}</div>
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
        h += `<div class="dd-sub">Scientists</div><div class="col">`;
        for (const w of s.staff) {
            h += `<div class="staff">
                <div class="s-top"><span>${w.name}</span><span class="dim">${labelState(w.state)}</span></div>
                <div class="roles">
                  ${['any', 'process', 'clean'].map(r =>
                    `<button class="r ${w.role === r ? 'on' : ''}" data-role="${w.id}:${r}">${r === 'any' ? 'Any' : r === 'process' ? 'Process' : 'Clean'}</button>`).join('')}
                </div>
            </div>`;
        }
        if (!s.staff.length) h += `<div class="empty">No scientists yet</div>`;
        h += `</div>`;
        return h;
    },

    stock() {
        const s = G.state;
        const hasSink = s.equipment.some(e => BUILD[e.type].kind === 'water');
        let h = `<div class="dd-head">Stock <button class="tgl ${s.autoPrep ? 'on' : ''}" data-autoprep>auto-prep ${s.autoPrep ? 'ON' : 'OFF'}</button></div>`;

        h += `<div class="dd-sub">Distilled Water</div><div class="col">`;
        h += `<div class="reg"><span>Water <span class="dim">(from a Sink, free — just takes time)</span></span><span class="dim ${s.water < WATER_MIN ? 'bad' : ''}">${s.water} units</span></div>`;
        if (!hasSink) h += `<div class="c-org warnline">No Sink built — reagents need distilled water. Build one under Utility.</div>`;
        else if (s.water < WATER_MIN) h += `<div class="c-org">Running low — a free scientist will top it up at the sink.</div>`;
        h += `</div>`;

        h += `<div class="dd-sub">Raw Ingredients</div><div class="col">`;
        for (const [k, ing] of Object.entries(INGREDIENTS)) {
            const n = s.ingredients[k] || 0;
            h += `<div class="reg buy">
                <span>${ing.name}<span class="dim"> · ${n} ${ing.unit}</span></span>
                <button class="mini buyb" data-buy="${k}">Buy ×10 — $${ing.cost * 10}</button>
            </div>`;
        }
        h += `</div><div class="dd-sub">Stock Solutions (perishable)</div><div class="col">`;
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
            <div class="c-org">Every contract runs a chain like Prep › Spin › Analyze. Each link needs a specific machine — the chain shown on a contract turns green for steps you already own, red for ones you don't.</div>`;
        h += `<div class="dd-sub">Stock & Reagents</div>
            <div class="c-org">Some prep steps consume a stock solution (Saline, Solvent, Buffer). Buy the raw ingredient in <b>Stock</b>, build a Sink for distilled water, and auto-prep turns both into reagent automatically.</div>`;
        h += `<div class="dd-sub">Cold Storage</div>
            <div class="c-org">Queued samples decay. A Fridge or Freezer lets a free scientist shelve a fading one to buy time — toggle it in <b>Staff</b>. Letting one spoil instead costs reputation and money immediately, <i>and</i> cuts that contract's final payout.</div>`;
        h += `<div class="dd-sub">Cleanliness</div>
            <div class="c-org">Machines leave grime behind as they're used. A filthy lab slows work and risks contamination — set a scientist's role to Clean, or leave everyone on Any and they'll mop when nothing more urgent needs doing.</div>`;
        h += `<div class="dd-sub">Building</div>
            <div class="c-org">Pick a machine in <b>Build</b>, click a tile to place it. <b>R</b> rotates while placing, or hover a placed machine and press R. <b>X</b> (or the Demolish tool) sells one back for half price. Buy more land under Build → Expand Lab.</div>
            <div class="c-org">Most machines run one scientist at a time — build more to parallelize. Incubators and fridges are the exception: several staff can use those at once.</div>`;
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
        dd.querySelectorAll('[data-role]').forEach(el =>
            el.addEventListener('click', () => {
                const [id, r] = el.dataset.role.split(':');
                setRole(+id, r);
            }));
    } else if (menu === 'stock') {
        const ap = dd.querySelector('[data-autoprep]');
        if (ap) ap.addEventListener('click', () => toggleAutoPrep());
        dd.querySelectorAll('[data-buy]').forEach(el =>
            el.addEventListener('click', () => buyIngredient(el.dataset.buy, 10)));
    } else if (menu === 'upgrades') {
        dd.querySelectorAll('[data-up]').forEach(el =>
            el.addEventListener('click', () => buyUpgrade(el.dataset.up)));
    }
}

function labelState(st) {
    return ({
        idle: 'idle', resting: 'idle', toMop: 'to mop', mopping: 'mopping',
        toPickup: 'fetching sample', toStation: 'carrying sample', atStation: 'waiting for machine',
        tending: 'running step', toPrep: 'to bench', prepping: 'making reagent',
        toSink: 'to sink', filling: 'drawing water',
        toColdPickup: 'fetching sample', toFridge: 'to fridge', storing: 'shelving sample'
    })[st] || st;
}
