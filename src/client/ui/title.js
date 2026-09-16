// ==================== TITLE SCREEN AND RUN SUMMARY ====================
// The frame around a run. A game that you drop straight into, can never lose and are never scored
// on is a sandbox; this is what makes it a run with a beginning and an end.
//
// Both screens are the same full-page overlay in two states. The lab itself keeps rendering
// behind them, paused: on the title that is the scenario you are about to leave or take on, and
// on the summary it is the wreckage, which says more than a number can.

import { G, RECEIVERSHIP_GRACE_DAYS, newGame } from '../game.js';

const $ = (id) => document.getElementById(id);
let onStart = () => {};
let hadSave = false;

export function initTitle(opts) {
    onStart = opts.onStart || (() => {});
    hadSave = !!opts.hadSave;
}

// Why the run ended, in the game's own voice rather than "GAME OVER".
const ENDINGS = {
    bankrupt: {
        head: 'Wound up',
        line: `The administrators have been through the building. What was left of the equipment went to auction, the staff were paid what could be scraped together, and the lease is back on the market.`
    }
};

// `canContinue` is whether there is a run to go back to. At boot that means a save on disk; from
// the New button mid-run it is simply true, since the run you would be abandoning is right there.
export function showTitle(opts = {}) {
    const el = $('title-screen');
    if (!el) return;
    const canContinue = opts.canContinue != null ? opts.canContinue : hadSave;
    el.hidden = false;
    el.innerHTML = `
        <div class="ts-inner">
            <div class="ts-head">
                <h1>Lab Tycoon</h1>
                <p class="ts-tag">You have a room, a loan, and no idea what you're doing.<br>Congratulations, you run a laboratory now.</p>
            </div>
            ${canContinue ? `<button class="ts-primary" data-continue>Continue your lab</button>` : ''}
            <button class="${canContinue ? 'ts-secondary' : 'ts-primary'}" data-new>New game</button>
            ${canContinue ? `<div class="ts-warn">Starting a new game replaces the lab you have.</div>` : ''}
            <div class="ts-foot">Runs save themselves every in-game day. Go far enough into the red and the bank takes the lab.</div>
        </div>`;
    const cont = el.querySelector('[data-continue]');
    if (cont) cont.addEventListener('click', () => { hide(el); onStart(); });
    el.querySelector('[data-new]').addEventListener('click', () => {
        if (canContinue && !confirm('Start a new game? The lab you have will be replaced.')) return;
        newGame(); hide(el); onStart();
    });
}

// Shown once the run is over. Same overlay, different content: what the lab did while it lasted,
// then back to the title to take another go at it.
export function showSummary() {
    const el = $('title-screen');
    const s = G.state;
    if (!el || !s.over) return;
    const o = s.over, m = o.summary;
    const end = ENDINGS[o.reason] || ENDINGS.bankrupt;
    const row = (k, v) => `<span><i>${k}</i><b>${v}</b></span>`;
    el.hidden = false;
    el.innerHTML = `
        <div class="ts-inner">
            <div class="ts-head">
                <h1>${end.head}</h1>
                <p class="ts-tag">${end.line}</p>
            </div>
            <div class="ts-scoreline">${m.days} day${m.days === 1 ? '' : 's'}</div>
            <div class="ts-score">
                ${row('Contracts delivered', m.contractsDone)}
                ${row('Contracts failed', m.contractsFailed)}
                ${row('Samples processed', m.samples)}
                ${row('Best reputation', m.peakRep)}
                ${row('Most money held', '$' + m.peakMoney.toLocaleString())}
                ${row('Ended owing', '$' + Math.max(0, m.loan - m.finalMoney).toLocaleString())}
                ${row('Scientists', m.staff)}
                ${row('Machines left', m.machines)}
                ${m.fires ? row('Fires', m.fires) : ''}
                ${m.outbreaks ? row('Outbreaks', m.outbreaks) : ''}
                ${m.deaths ? row('Lives lost', m.deaths) : ''}
            </div>
            <button class="ts-primary" data-again>Take another lab</button>
        </div>`;
    // A finished run is not one to continue, so the title comes back without the option.
    el.querySelector('[data-again]').addEventListener('click', () => showTitle({ canContinue: false }));
}

function hide(el) { el.hidden = true; el.innerHTML = ''; }

// Called every frame from the UI render. The summary raises itself the moment the run ends,
// wherever the player happened to be looking.
let shown = false;
export function syncEndScreen() {
    const s = G.state;
    if (s && s.over && !shown) { shown = true; showSummary(); }
    if (s && !s.over) shown = false;
}
export const receivershipDays = () => RECEIVERSHIP_GRACE_DAYS;
