import LabScene from './threeScene.js';
import * as GM from './game.js';
import { G, init as initGame, tick, newGame, saveNow } from './game.js';
import { initUI, render as renderUI, sceneHandlers } from './ui/toolbar.js';

function boot() {
    initGame();

    const scene = new LabScene(document.getElementById('canvas-container'));
    G.scene = scene;
    scene.setHandlers(sceneHandlers);

    initUI();

    scene.onFrame = (dt) => {
        tick(dt);
        renderUI(false);
    };

    window.addEventListener('beforeunload', saveNow);
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

    // dev / automation hook
    window.lab = {
        get state() { return G.state; },
        get scene() { return G.scene; },
        G, gm: GM, newGame
    };
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
