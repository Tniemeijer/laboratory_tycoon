// ==================== THE TO-DO PANEL ====================
// One list, always on screen, answering "is anything stopping my active contracts?" without
// opening a menu and reading five cards. Each contract card still carries its own checklist —
// that one is for deciding whether to *accept* a job. This one is for running the ones you took.
//
// Everything here is derived, never stored: the tasks are recomputed from live state each time
// the text would change, so a job ticks itself off the moment you build the machine.

import { G, PROTOCOLS } from '../game.js';
import { contractTasks } from './menus.js';

const $ = (id) => document.getElementById(id);
const COLLAPSE_KEY = 'labTycoonTasksCollapsed';

let collapsed = null;          // resolved on first render so window width is known
let lastKey = '';

function initCollapsed() {
    if (collapsed !== null) return;
    try {
        const saved = localStorage.getItem(COLLAPSE_KEY);
        if (saved !== null) { collapsed = saved === '1'; return; }
    } catch (e) { /* private browsing */ }
    // No preference yet: open on a desktop where there's room, shut on a phone where the panel
    // would cover a third of the screen before the player has asked for it.
    collapsed = window.innerWidth < 560;
}
function setCollapsed(v) {
    collapsed = v;
    try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch (e) { /* private browsing */ }
    lastKey = '';                 // force a rebuild
    G.onUIDirty();
}

// The union of what every active contract still needs, deduplicated, two jobs both waiting on a
// Microscope is one thing to do, not two, and tagged with which of them are blocked on it.
export function activeTasks() {
    const s = G.state;
    const byText = new Map();
    for (const c of s.contracts) {
        for (const t of contractTasks(c.proto)) {
            if (!byText.has(t.text)) byText.set(t.text, { waiting: t.waiting, protos: [] });
            const rec = byText.get(t.text);
            const label = PROTOCOLS[c.proto].name;
            if (!rec.protos.includes(label)) rec.protos.push(label);
        }
    }
    // Things you can act on first; things already in hand below them.
    return [...byText]
        .map(([text, rec]) => ({ text, waiting: rec.waiting, protos: rec.protos }))
        .sort((a, b) => (a.waiting ? 1 : 0) - (b.waiting ? 1 : 0));
}

export function renderTasks() {
    const el = $('tasks');
    if (!el || !G.state) return;
    initCollapsed();
    const tasks = activeTasks();
    const active = G.state.contracts.length;
    const todos = tasks.filter(t => !t.waiting).length;

    // Nothing accepted yet, or genuinely nothing outstanding: no panel rather than an empty box.
    // "Nothing blocking" has to mean nothing at all, including nothing in transit, or it's a lie
    // the moment a run stalls waiting for slides that are still on the van.
    if (!active || !tasks.length) {
        const key = active ? 'clear' : 'none';
        if (lastKey !== key) {
            lastKey = key;
            el.hidden = !active;
            if (active) el.innerHTML = `<div class="todo-head done"><span class="todo-n ok">✓</span>
                <span>Nothing blocking your ${active} job${active > 1 ? 's' : ''}</span></div>`;
            else el.innerHTML = '';
        }
        return;
    }

    const key = `${collapsed}|${tasks.map(t => t.text + t.waiting + t.protos.join()).join('|')}`;
    if (key === lastKey) return;
    lastKey = key;
    el.hidden = false;
    // The badge counts only what you can act on. When everything outstanding is already on its
    // way the header says so instead, so a waiting lab never reads as an idle one.
    const label = todos
        ? `<span class="todo-n">${todos}</span><span>${todos === 1 ? 'thing' : 'things'} to do</span>`
        : `<span class="todo-n wait">⏳</span><span>Waiting on ${tasks.length} thing${tasks.length === 1 ? '' : 's'}</span>`;
    const head = `<button class="todo-head" data-todo-toggle>
            ${label}<span class="todo-caret">${collapsed ? '▸' : '▾'}</span>
        </button>`;
    const body = collapsed ? '' : `<div class="todo-list">` + tasks.map(t =>
        `<div class="todo-item${t.waiting ? ' wait' : ''}">${t.waiting ? '⏳' : '☐'} ${t.text}
            ${active > 1 ? `<span class="todo-for">${t.protos.join(', ')}</span>` : ''}</div>`).join('') + `</div>`;
    el.innerHTML = head + body;
    const btn = el.querySelector('[data-todo-toggle]');
    if (btn) btn.onclick = () => setCollapsed(!collapsed);
}
