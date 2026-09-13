// ==================== TOP BAR / TOOL STATE ====================
// Bootstraps the HUD: top-bar readouts, menu open/close, build-tool + ghost-preview
// management, hotkeys, and the scene pointer handlers.

import {
    G, BUILD, labLevel, repToNext, cleanliness, roomAt,
    canPlace, canAfford, isUnlocked, placeEquipment, rotateEquipment, moveEquipment, demolish,
    togglePause, cycleSpeed, newGame
} from '../game.js';
import { BUILDERS, wireMenu, setToolHandler } from './menus.js';

const $ = (id) => document.getElementById(id);
let openMenu = null;
// The machine currently picked up by the Move tool, if any. Purely UI state: the game doesn't
// know a move is in progress until it's actually dropped somewhere.
let moveId = null;
let lastRev = -1;
let toastTimer = null;

export function initUI() {
    G.onToast = (msg, warn) => {
        if (!msg) return;
        const el = $('toast');
        el.textContent = msg;
        el.className = warn ? 'warn show' : 'show';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.className = ''; }, 2800);
    };
    G.onUIDirty = () => { render(true); };
    setToolHandler(selectTool);

    document.querySelectorAll('#bar .menu-btn').forEach(b => {
        b.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(b.dataset.menu); });
    });
    $('bar-pause').addEventListener('click', () => togglePause());
    $('bar-speed').addEventListener('click', () => cycleSpeed());
    $('bar-new').addEventListener('click', () => { if (confirm('Start a new game? Progress is lost.')) newGame(); });
    $('rotate-pill').addEventListener('click', () => rotateHotkey());
    $('dropdown-close').addEventListener('click', () => closeMenu());
    $('cam-rotate-left').addEventListener('click', () => G.scene.rotateView(-1));
    $('cam-rotate-right').addEventListener('click', () => G.scene.rotateView(1));

    // Stow away the menu row + pause/speed/new on request — handy on a small screen where the
    // full bar eats a lot of vertical space. Remembered across sessions.
    const BAR_COLLAPSE_KEY = 'labTycoonBarCollapsed';
    const barExtra = $('bar-extra'), barToggle = $('bar-toggle');
    let collapsed = false;
    try { collapsed = localStorage.getItem(BAR_COLLAPSE_KEY) === '1'; } catch (e) { /* private browsing */ }
    barExtra.classList.toggle('collapsed', collapsed);
    barToggle.classList.toggle('open', !collapsed);
    barToggle.addEventListener('click', () => {
        collapsed = !collapsed;
        barExtra.classList.toggle('collapsed', collapsed);
        barToggle.classList.toggle('open', !collapsed);
        if (collapsed) closeMenu();
        try { localStorage.setItem(BAR_COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (e) { /* private browsing */ }
    });

    document.addEventListener('click', (e) => {
        // composedPath() is captured when the event is dispatched, so it still names the dropdown
        // even if the handler that ran first replaced the panel's contents. Walking up from
        // e.target instead looked at a node that had just been detached by the re-render, found no
        // #dropdown above it, and concluded the click was outside — which slammed the menu shut
        // every time a control inside it changed anything (the loan − / + buttons especially).
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        const inUI = path.some(n => n && (n.id === 'dropdown' || n.id === 'bar'));
        if (!inUI && !(e.target.closest && (e.target.closest('#dropdown') || e.target.closest('#bar')))) closeMenu();
    });
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;
        if (e.code === 'Escape') { if (openMenu) closeMenu(); else selectTool(null); }
        else if (e.code === 'KeyP') togglePause();
        else if (e.code === 'KeyR') rotateHotkey();
        else if (e.code === 'KeyQ') G.scene.rotateView(-1);
        else if (e.code === 'KeyE') G.scene.rotateView(1);
        else if (e.code === 'KeyX') selectTool('demolish');
        else if (e.code === 'KeyM') selectTool('move');
        else if (e.code === 'KeyB') toggleMenu('build');
        else if (e.code === 'KeyC') toggleMenu('contracts');
        else if (/^Digit[1-7]$/.test(e.code)) {
            const keys = Object.keys(BUILD);
            const k = keys[+e.code.slice(5) - 1];
            if (k) selectTool(k);
        }
    });

    render(true);
    hint();

    const TUTORIAL_KEY = 'labTycoonSeenTutorial';
    try {
        if (!localStorage.getItem(TUTORIAL_KEY)) {
            localStorage.setItem(TUTORIAL_KEY, '1');
            toggleMenu('help');
        }
    } catch (e) { /* private browsing etc. — just skip the auto-popup */ }
}

// ---------- tool selection ----------
export function selectTool(t) {
    G.tool = (G.tool === t) ? null : t;
    G.ghostRot = 0;
    moveId = null;
    G.scene.setTool(G.tool);
    hint();
    if (G.tool && openMenu === 'build') closeMenu();   // clear the view to place
    else if (openMenu === 'build') renderDropdown();
    highlightTabs();
}
function rotateHotkey() {
    if (G.tool === 'move' && moveId != null) {   // spin the machine you're holding before dropping it
        G.ghostRot = (G.ghostRot + 1) % 4;
        refreshGhost();
    } else if (G.tool && BUILD[G.tool]) {
        G.ghostRot = (G.ghostRot + 1) % 4;
        refreshGhost();
    } else if (G.scene.hoverTile) {
        const e = equipAt(G.scene.hoverTile.tx, G.scene.hoverTile.tz);
        if (e) rotateEquipment(e.id);
    }
}
function pickUpForMove(e) {
    moveId = e.id;
    G.ghostRot = e.rot;          // carry on from however it's currently facing
    G.onToast(`Moving ${BUILD[e.type].name} — click its new spot`);
    hint();
    refreshGhost();
}
function equipAt(tx, tz) {
    return G.state.equipment.find(e => {
        const [fw, fh] = BUILD[e.type].foot;
        const w = e.rot % 2 ? fh : fw, h = e.rot % 2 ? fw : fh;
        return tx >= e.tx && tx < e.tx + w && tz >= e.tz && tz < e.tz + h;
    });
}
function hint() {
    const h = $('hint');
    const pill = $('rotate-pill');
    if (!G.tool) { h.textContent = 'Drag or WASD to move the view · Q/E (or ⟲⟳) to turn · scroll/pinch to zoom'; pill.hidden = true; }
    else if (G.tool === 'demolish') { h.textContent = 'Click a machine or room floor to sell it for half price. (Esc to stop)'; pill.hidden = true; }
    else if (G.tool === 'rotate') { h.textContent = 'Click a machine to rotate it. (Esc to stop)'; pill.hidden = true; }
    else if (G.tool === 'move') {
        h.textContent = moveId != null
            ? 'Click where it should go · R to rotate · Esc to cancel'
            : 'Click a machine or room floor to pick it up and move it. (Esc to stop)';
        pill.hidden = moveId == null;
    }
    else { h.textContent = `Placing ${BUILD[G.tool].name} — click a tile · Esc to cancel`; pill.hidden = false; }
}
function refreshGhost() {
    const ht = G.scene.hoverTile;
    if (G.tool === 'move' && moveId != null) {
        const e = G.state.equipment.find(x => x.id === moveId);
        if (!e || !ht) return G.scene.setGhost(null);
        // ignoreId, or the machine would always read as blocked by the spot it's standing in
        const ok = canPlace(e.type, ht.tx, ht.tz, G.ghostRot, e.id).ok;
        return G.scene.setGhost(e.type, ht.tx, ht.tz, G.ghostRot, ok);
    }
    if (G.tool && BUILD[G.tool] && ht) {
        const ok = isUnlocked(G.tool) && canAfford(G.tool) && canPlace(G.tool, ht.tx, ht.tz, G.ghostRot).ok;
        G.scene.setGhost(G.tool, ht.tx, ht.tz, G.ghostRot, ok);
    } else G.scene.setGhost(null);
}

// scene hooks used by main.js
export const sceneHandlers = {
    onTileHover() { refreshGhost(); },
    onTileClick(tx, tz) {
        if (G.tool === 'move') {
            if (moveId != null) {
                // keep the tool live after a drop, so several machines can be shuffled in a row
                if (moveEquipment(moveId, tx, tz, G.ghostRot)) { moveId = null; G.ghostRot = 0; hint(); refreshGhost(); }
                return;
            }
            const room = roomAt(tx, tz);       // rooms are floor, so they're picked up by their tile
            if (room) pickUpForMove(room);
            return;
        }
        if (G.tool && BUILD[G.tool]) {
            // one placement per selection, so a stray click right after can't buy a second one
            if (placeEquipment(G.tool, tx, tz, G.ghostRot)) selectTool(null);
            return;
        }
        // Rooms render as floor and have no model to click, so selling or inspecting one comes
        // through the tile under it. Anything standing inside the room is a real mesh and gets
        // picked first, so this only ever fires on the room's own bare floor.
        const room = roomAt(tx, tz);
        if (!room) return;
        if (G.tool === 'demolish') demolish(room.id);
        else G.onToast(`${BUILD[room.type].name} — ${BUILD[room.type].desc.split('.')[0]}.`);
    },
    onEquipmentClick(id) {
        if (G.tool === 'move') {
            if (moveId == null) { const e = G.state.equipment.find(x => x.id === id); if (e) pickUpForMove(e); }
            else G.onToast('There\'s already something there — drop it on clear floor', true);
        }
        else if (G.tool === 'demolish') demolish(id);
        else if (G.tool === 'rotate') rotateEquipment(id);
        else {
            const e = G.state.equipment.find(x => x.id === id);
            if (e) {
                const b = BUILD[e.type];
                let use;
                if (e.broken) use = 'BROKEN — needs a mechanic';
                else if (!(b.caps || []).length) use = b.slots ? ((e.processing || []).length || e.reserved ? 'in use' : 'free') : b.desc;
                else {
                    const staged = (e.staged || []).length, running = (e.processing || []).length;
                    use = `${running ? `running (${running})` : 'idle'}${staged ? `, ${staged} staged` : ''} · ${Math.round(e.condition ?? 100)}% condition`;
                }
                G.onToast(`${b.name} — ${use}`);
            }
        }
    },
    onEquipmentRightClick(id) { demolish(id); }
};

// ---------- menus ----------
function toggleMenu(name) { openMenu = (openMenu === name) ? null : name; renderDropdown(); highlightTabs(); }
function closeMenu() { openMenu = null; renderDropdown(); highlightTabs(); }
function highlightTabs() {
    document.querySelectorAll('#bar .menu-btn').forEach(b =>
        b.classList.toggle('open', b.dataset.menu === openMenu));
    const chip = $('tool-chip');
    if (G.tool) { chip.hidden = false; chip.textContent = BUILD[G.tool] ? BUILD[G.tool].name : G.tool; }
    else chip.hidden = true;
}
function renderDropdown() {
    const dd = $('dropdown');
    const content = $('dropdown-content');
    if (!openMenu) { dd.hidden = true; content.innerHTML = ''; delete dd.dataset.menu; return; }
    dd.hidden = false;
    // Set before measuring below — Build styles itself wider, and offsetWidth has to see that
    // width to clamp the panel's left edge against the window correctly.
    dd.dataset.menu = openMenu;
    content.innerHTML = BUILDERS[openMenu] ? BUILDERS[openMenu]() : '';
    wireMenu(openMenu, content);
    const btn = document.querySelector(`#bar .menu-btn[data-menu="${openMenu}"]`);
    if (btn) {
        const r = btn.getBoundingClientRect();
        dd.style.left = Math.min(r.left, window.innerWidth - dd.offsetWidth - 10) + 'px';
    }
}

// ---------- per-frame ----------
export function render(force) {
    const s = G.state;
    if (!s) return;
    // In the red: turn the balance red and put the minus in front of the currency symbol rather
    // than after it ("-$1,200", not "$-1,200"). `.stat.bad` is defined after `.stat.money` in the
    // stylesheet, so it wins without needing extra specificity.
    const money = $('bar-money');
    money.textContent = (s.money < 0 ? '-$' : '$') + Math.abs(s.money).toLocaleString();
    money.classList.toggle('bad', s.money < 0);
    const lv = labLevel(), next = repToNext();
    $('bar-rep').innerHTML = `${'★'.repeat(lv)}<span class="dim">${'★'.repeat(5 - lv)}</span> ${s.reputation}${next ? `<span class="dim">/${next}</span>` : ''}`;
    $('bar-day').textContent = 'Day ' + s.day;
    $('bar-dayfill').style.width = (s.dayFrac * 100).toFixed(1) + '%';
    $('bar-pause').textContent = s.paused ? '▶' : '⏸';
    $('bar-speed').textContent = s.speed + '×';
    const cl = Math.round(cleanliness());
    const clean = $('bar-clean');
    clean.textContent = '🧹 ' + cl + '%';
    clean.className = 'stat ' + (cl < 40 ? 'bad' : cl < 70 ? 'mid' : 'good');

    if (force || s.uiRev !== lastRev) {
        lastRev = s.uiRev;
        if (openMenu) renderDropdown();
    }
}
