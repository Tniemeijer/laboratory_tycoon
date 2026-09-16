// ==================== INTERACTIVE TUTORIAL ====================
// A short guided run through the actual game rather than a wall of text in the Help menu. Each
// step names one thing to do, points at the button that does it, and — crucially — watches the
// real game state for the thing actually happening. Nothing is faked or scripted: the player
// accepts a real contract, builds a real bench, and the step ticks over because the state says so.
//
// Steps with a `done` predicate advance themselves; steps without one are read-and-continue and
// get a Next button. Every step can be skipped and the whole thing dismissed outright — it's the
// first thing a returning player will want gone, so it's never more than one click away.

import { G, BUILD, equipCaps } from '../game.js';

const $ = (id) => document.getElementById(id);

const STEPS = [
    {
        title: 'Welcome to the lab',
        body: `Let's walk one job from the front door to the invoice, so you can see how the place fits together. About a minute, and you can skip it whenever you like.`
    },
    {
        title: 'Take a job',
        body: `Open <b>Contracts</b> and accept one. Each card shows the chain of steps it needs, and a checklist of anything your lab is still missing.`,
        highlight: '[data-menu="contracts"]',
        done: (s) => s.contracts.length > 0
    },
    {
        title: 'Build what it needs',
        body: `Every step in that chain needs a machine. Open <b>Build</b> and place a <b>Lab Bench</b>. It preps and analyses, which covers most early work.`,
        highlight: '[data-menu="build"]',
        done: (s) => s.equipment.some(e => (BUILD[e.type].caps || []).includes('prep'))
    },
    {
        title: 'Hire someone to run it',
        body: `Machines don't operate themselves. Open <b>Staff</b> and hire a scientist. They'll fetch samples and work the bench on their own.`,
        highlight: '[data-menu="staff"]',
        done: (s) => s.staff.length > 0
    },
    {
        title: 'Now watch',
        body: `Samples arrive at the front door. Your scientist will carry one to the bench and run it. Use <b>2×</b> or <b>3×</b> if you're impatient, and <b>⏸</b> to stop and think.`,
        highlight: '#bar-speed',
        done: (s) => s.stats.processed > 0
    },
    {
        title: 'Keep the shelf stocked',
        body: `Every run burns disposables, and <b>a run won't start without them</b>. Order more in <b>Stock</b>. Deliveries land next morning as crates by the door that somebody has to carry to the stockroom.`,
        highlight: '[data-menu="stock"]',
        done: (s) => (s.orders && s.orders.length > 0) || (s.deliveries && s.deliveries.length > 0)
    },
    {
        title: `That's the loop`,
        body: `Take jobs you can nearly serve, build the gap, keep people and stock moving. Machines wear out and eventually catch fire, so book a mechanic from <b>Lab</b> before that happens. <b>? Help</b> has the rest.`
    }
];

let lastKey = '';
let lastHighlight = null;

function setHighlight(sel) {
    if (lastHighlight) { lastHighlight.classList.remove('tut-target'); lastHighlight = null; }
    if (!sel) return;
    const el = document.querySelector(sel);
    if (el) { el.classList.add('tut-target'); lastHighlight = el; }
}

export function tutorialActive() {
    const t = G.state && G.state.tutorial;
    return !!t && !t.done;
}
export function advanceTutorial(by = 1) {
    const t = G.state.tutorial;
    if (!t || t.done) return;
    t.step += by;
    if (t.step >= STEPS.length) endTutorial();
    else G.onUIDirty();
}
export function endTutorial() {
    const t = G.state.tutorial;
    if (!t) return;
    t.done = true;
    setHighlight(null);
    G.onUIDirty();
}
export function restartTutorial() {
    G.state.tutorial = { step: 0, done: false };
    G.onUIDirty();
}

// Called every frame from the HUD render. Cheap: it only rebuilds the panel when the visible text
// actually changes, and the completion predicates are all simple property reads.
export function renderTutorial() {
    const el = $('tutorial');
    if (!el) return;
    const s = G.state;
    if (!tutorialActive()) {
        if (lastKey !== '') {
            lastKey = ''; el.hidden = true; el.innerHTML = '';
            setHighlight(null); document.body.classList.remove('tut-on');
        }
        return;
    }
    document.body.classList.add('tut-on');
    const t = s.tutorial;
    const step = STEPS[Math.min(t.step, STEPS.length - 1)];

    // Auto-advance the moment the player actually does the thing.
    if (step.done && step.done(s)) { advanceTutorial(); return; }

    const key = `${t.step}`;
    if (key !== lastKey) {
        lastKey = key;
        el.hidden = false;
        el.innerHTML = `
            <div class="tut-top">
                <span class="tut-step">${t.step + 1}/${STEPS.length}</span>
                <span class="tut-title">${step.title}</span>
                <button class="tut-x" data-tut-skip aria-label="Skip the tutorial">×</button>
            </div>
            <div class="tut-body">${step.body}</div>
            <div class="tut-row">
                <button class="mini" data-tut-next>${step.done ? 'Skip this step' : 'Next'}</button>
                <button class="mini" data-tut-skip>Skip tutorial</button>
            </div>`;
        el.querySelectorAll('[data-tut-next]').forEach(b => b.onclick = () => advanceTutorial());
        el.querySelectorAll('[data-tut-skip]').forEach(b => b.onclick = () => endTutorial());
        setHighlight(step.highlight);
    } else if (step.highlight && !lastHighlight) {
        // The bar can be re-rendered (or un-collapsed) under us — re-attach if the ring was lost.
        setHighlight(step.highlight);
    }
}
