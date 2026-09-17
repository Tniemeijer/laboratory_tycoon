import LabScene from './threeScene.js';
import * as GM from './game.js';
import { G, init as initGame, tick, newGame, saveNow, hasSave } from './game.js';
import { initUI, render as renderUI, sceneHandlers } from './ui/toolbar.js';
import { initTitle, showTitle, showSummary, syncEndScreen } from './ui/title.js';
import * as Inspector from './ui/inspector.js';
import * as Menus from './ui/menus.js';
import * as Audio from './audio.js';
const { initAudio, play: playSfx } = Audio;

function boot() {
    initAudio();
    G.sfx = playSfx;              // systems call G.sfx('name'); silent until the first gesture
    // Whether there was something to come back to decides what the title screen offers. Read
    // before init(), which replaces a missing save with a fresh state and would hide the answer.
    const hadSave = hasSave();
    initGame();

    const scene = new LabScene(document.getElementById('canvas-container'));
    G.scene = scene;
    scene.setHandlers(sceneHandlers);

    initUI();

    // Nothing runs until the player has chosen. The lab renders behind the overlay either way, so
    // the title sits over the actual save rather than a backdrop.
    G.state.paused = true;
    initTitle({ hadSave, onStart: () => { G.state.paused = false; } });
    showTitle();

    scene.onFrame = (dt) => {
        tick(dt);
        renderUI(false);
        syncEndScreen();
    };

    window.addEventListener('beforeunload', saveNow);
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

    // dev / automation hook
    window.lab = {
        get state() { return G.state; },
        get scene() { return G.scene; },
        G, gm: GM, newGame, title: { showTitle, showSummary }, inspector: Inspector, menus: Menus, audio: Audio
    };
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
