// ==================== WHO IS THIS, AND WHAT ARE THEY DOING ====================
// Click a scientist and this says who they are and what is going on with them. The roster in the
// Staff menu answers "who do I employ"; this answers "why is that one stood there", which is the
// question you actually have while watching the floor.
//
// The "why" line matters more than the stats. A scientist doing nothing is either genuinely spare,
// waiting on stock that is on order, or not ticked for the work that needs doing, and those three
// look identical from the outside. The Lab menu names the lab's constraint in aggregate; this
// names one person's.

import {
    G, BUILD, CAP_LABEL, STAFF_TRAITS, STAFF_PERKS, SKILL_MAX_LEVEL, SKILL_XP_PER_LEVEL,
    CAREER_XP_PER_LEVEL, CAREER_MAX_LEVEL, careerLevel, perksOwed, dailyWage, runShortage
} from '../game.js';

const $ = (id) => document.getElementById(id);
let selected = null;           // worker id, or null

export function selectStaff(id) { selected = id; render(); }
export function clearSelection() { if (selected != null) { selected = null; render(); } }
export function selectedStaff() { return selected; }

// Plain-English version of the state machine, matching the wording the Staff menu uses.
const DOING = {
    idle: 'nothing in particular', resting: 'on a break', toMop: 'off to clean up a spill',
    mopping: 'mopping', toPickup: 'off to fetch a sample', toStation: 'carrying a sample',
    atStation: 'dropping a sample off', toPrep: 'off to brew a reagent', prepping: 'brewing a reagent',
    toSink: 'off to the sink', filling: 'drawing water', toColdPickup: 'off to fetch a sample',
    toFridge: 'off to cold storage', storing: 'shelving a sample', toOperate: 'off to start a run',
    toDesk: 'off to the procurement desk', ordering: 'ordering stock',
    operating: 'starting a run', tending: 'working a machine', toCrate: 'off to a delivery',
    toStock: 'carrying a crate to the stockroom', stocking: 'putting stock away',
    evacuating: 'evacuating', evacuatingDone: 'outside', sick: 'going home sick', sickDone: 'off sick'
};

// Why somebody has nothing to do. Ordered so the most actionable answer wins: a person who is not
// allowed to do the only work available is a tick-box away from being useful, and that is worth
// saying before "the lab is quiet".
function whyIdle(w) {
    const s = G.state;
    if (w.illUntil != null) return `Off sick until day ${w.illUntil}.`;
    const queued = s.samples.filter(sm => sm.state === 'queued' && !sm.storedAt);
    const blocked = new Set();
    for (const e of s.equipment) {
        if (!e.staged || !e.staged.length) continue;
        const missing = runShortage(e.staged[0].cap, e.staged[0].proto, 1);
        if (missing) blocked.add(missing);
    }
    if (blocked.size) {
        const onOrder = (s.orders || []).length ? ' It is on order.' : ' Nothing is on order for it.';
        return `Waiting on ${[...blocked].join(' and ')}. A batch is loaded and cannot run until it arrives.${onOrder}`;
    }
    if (queued.length && !w.caps.process)
        return `${queued.length} sample${queued.length === 1 ? '' : 's'} waiting, but this one isn't ticked for Process.`;
    if (Object.keys(s.dirt || {}).length && !w.caps.clean)
        return `There's a spill to mop, but this one isn't ticked for Clean.`;
    if (queued.length) return `${queued.length} sample${queued.length === 1 ? '' : 's'} queued, but every machine that could take one is full.`;
    return `Nothing needs doing. That's a good sign, or an empty order book.`;
}

export function render() {
    const el = $('inspector');
    if (!el) return;
    const s = G.state;
    const w = selected != null && s ? s.staff.find(x => x.id === selected) : null;
    if (!w) { el.hidden = true; el.innerHTML = ''; selected = null; return; }

    const lvl = careerLevel(w);
    const pct = lvl >= CAREER_MAX_LEVEL ? 100 : Math.round(((w.xp || 0) % CAREER_XP_PER_LEVEL) / CAREER_XP_PER_LEVEL * 100);
    const xp = w.skillXp || {};
    const learned = Object.keys(xp).filter(c => xp[c] >= SKILL_XP_PER_LEVEL);
    const doing = DOING[w.state] || w.state;
    const spare = w.state === 'idle' || w.state === 'resting';

    // What they're actually stood at, when they're stood at something.
    let atWhat = '';
    const sid = w.job && (w.job.operateId ?? w.job.stationId);
    if (sid != null) {
        const e = s.equipment.find(x => x.id === sid);
        if (e) atWhat = ` at the ${BUILD[e.type].name}`;
    }

    el.hidden = false;
    el.innerHTML = `
        <div class="ins-top">
            <span class="ins-name">${w.name} <b class="lvl">Lv${lvl}</b>${w.illUntil != null ? ' 🤒' : ''}</span>
            <button class="ins-x" data-close aria-label="Close">×</button>
        </div>
        <div class="ins-doing">${doing}${atWhat}</div>
        ${spare ? `<div class="ins-why">${whyIdle(w)}</div>` : ''}
        <div class="ins-line dim">$${dailyWage(w)}/day${lvl >= CAREER_MAX_LEVEL ? ' · fully qualified' : ` · ${pct}% to Lv${lvl + 1}`}</div>
        ${lvl < CAREER_MAX_LEVEL ? `<span class="meter sm xp"><i style="width:${pct}%"></i></span>` : ''}
        ${perksOwed(w) > 0 ? `<div class="ins-why">Has a skill to pick. Choose it in the Staff menu.</div>` : ''}
        <div class="traits">
            ${(w.traits || []).map(t => { const d = STAFF_TRAITS[t]; return d
                ? `<span class="trait ${d.good ? 'tg' : 'tb'}" title="${d.desc}">${d.name}</span>` : ''; }).join('')}
            ${(w.perks || []).map(k => { const d = STAFF_PERKS[k]; return d
                ? `<span class="trait tp" title="${d.desc}">${d.name}</span>` : ''; }).join('')}
        </div>
        ${learned.length ? `<div class="skills">${learned.map(c => {
            const l = Math.min(SKILL_MAX_LEVEL, Math.floor(xp[c] / SKILL_XP_PER_LEVEL));
            return `<span class="skill">${CAP_LABEL[c] || c} <b>Lv${l}</b></span>`;
        }).join('')}</div>` : ''}
        <div class="ins-caps">${w.caps.process ? '☑' : '☐'} Process &nbsp; ${w.caps.clean ? '☑' : '☐'} Clean${
            w.caps.orders ? ' &nbsp; ☑ Orders' : ''}</div>`;
    const x = el.querySelector('[data-close]');
    if (x) x.addEventListener('click', () => clearSelection());
}
