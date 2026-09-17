// ==================== SOUND ====================
// Every sound in the game is synthesised here, at runtime, from oscillators and filtered noise.
// There are no audio files: a lab that beeps, clunks and whirrs in a few KB of arithmetic suits
// the look better than recorded foley would, it costs nothing to load, and there is no licensing
// to think about. The trade is that nothing here can be realistic, so each sound aims to be
// *readable* instead -- you should be able to tell a finished run from a broken machine without
// looking at the screen.
//
// Deliberately absent: footsteps. Six scientists crossing a floor at 3x speed is a stampede, and
// it is the first thing that makes a game you leave running unbearable.

const DEFS = {
    // --- interface ---
    'ui.click':     { voices: [{ type: 'square',   f: 520, to: 460, dur: 0.055, gain: 0.16, a: 0.003, d: 0.05 }] },
    'ui.menu':      { voices: [{ type: 'triangle', f: 360, to: 440, dur: 0.06,  gain: 0.14, a: 0.003, d: 0.05 }] },
    // --- building ---
    'build.place':  { voices: [{ type: 'sine',  f: 150, to: 90,  dur: 0.14, gain: 0.34, a: 0.003, d: 0.13 },
                               { noise: true,  dur: 0.07, gain: 0.22, band: 900, q: 1.2 }] },
    'build.sell':   { voices: [{ type: 'triangle', f: 420, to: 180, dur: 0.18, gain: 0.24, a: 0.004, d: 0.17 }] },
    // --- machines ---
    'machine.start':{ voices: [{ type: 'sawtooth', f: 150, to: 300, dur: 0.22, gain: 0.16, a: 0.02, d: 0.2, lp: 1400 }] },
    'machine.done': { voices: [{ type: 'sine', f: 660,  to: 660,  dur: 0.13, gain: 0.26, a: 0.004, d: 0.12 },
                               { type: 'sine', f: 990,  to: 990,  dur: 0.20, gain: 0.18, a: 0.004, d: 0.19, delay: 0.09 }] },
    'machine.broken':{ voices:[{ type: 'sawtooth', f: 110, to: 62, dur: 0.45, gain: 0.3, a: 0.005, d: 0.44, lp: 700 },
                               { noise: true, dur: 0.3, gain: 0.2, band: 420, q: 0.8 }] },
    'machine.worn': { voices: [{ type: 'triangle', f: 300, to: 250, dur: 0.16, gain: 0.14, a: 0.01, d: 0.15 }] },
    // --- logistics ---
    'delivery':     { voices: [{ noise: true, dur: 0.1, gain: 0.3, band: 260, q: 1.0 },
                               { noise: true, dur: 0.1, gain: 0.3, band: 260, q: 1.0, delay: 0.16 },
                               { type: 'sine', f: 90, to: 70, dur: 0.2, gain: 0.22, a: 0.004, d: 0.19 }] },
    'stock.stow':   { voices: [{ noise: true, dur: 0.12, gain: 0.18, band: 1500, q: 1.4 }] },
    'brew.done':    { voices: [{ type: 'sine', f: 380, to: 620, dur: 0.18, gain: 0.2, a: 0.006, d: 0.17 }] },
    // --- contracts and money ---
    'contract.take':{ voices: [{ type: 'triangle', f: 440, to: 440, dur: 0.1, gain: 0.18, a: 0.004, d: 0.09 },
                               { type: 'triangle', f: 587, to: 587, dur: 0.14, gain: 0.16, a: 0.004, d: 0.13, delay: 0.08 }] },
    'contract.done':{ voices: [{ type: 'sine', f: 523, to: 523, dur: 0.12, gain: 0.24, a: 0.004, d: 0.11 },
                               { type: 'sine', f: 659, to: 659, dur: 0.12, gain: 0.24, a: 0.004, d: 0.11, delay: 0.1 },
                               { type: 'sine', f: 784, to: 784, dur: 0.3,  gain: 0.26, a: 0.004, d: 0.29, delay: 0.2 }] },
    'contract.fail':{ voices: [{ type: 'triangle', f: 330, to: 310, dur: 0.18, gain: 0.22, a: 0.005, d: 0.17 },
                               { type: 'triangle', f: 247, to: 220, dur: 0.4,  gain: 0.22, a: 0.005, d: 0.39, delay: 0.15 }] },
    'money.bad':    { voices: [{ type: 'sawtooth', f: 180, to: 120, dur: 0.3, gain: 0.18, a: 0.006, d: 0.29, lp: 900 }] },
    // --- emergencies. The alarm is one cycle; incidents.js retriggers it while it matters. ---
    'alarm':        { voices: [{ type: 'square', f: 880, to: 880, dur: 0.28, gain: 0.2, a: 0.006, d: 0.02 },
                               { type: 'square', f: 660, to: 660, dur: 0.28, gain: 0.2, a: 0.006, d: 0.02, delay: 0.3 }] },
    'fire':         { voices: [{ noise: true, dur: 0.6, gain: 0.16, band: 700, q: 0.5 }] },
    'outbreak':     { voices: [{ type: 'sine', f: 200, to: 96, dur: 0.9, gain: 0.26, a: 0.05, d: 0.85 },
                               { type: 'sine', f: 203, to: 98, dur: 0.9, gain: 0.2,  a: 0.05, d: 0.85 }] }
};

// Two sounds of the same name inside this window collapse into one. A lab at 3x speed can finish
// four runs in the same frame, and four identical dings landing together is a click, not a chord.
const THROTTLE = 0.06;
const MAX_VOICES = 12;             // hard cap on simultaneous voices, so nothing can stack into mush

let ctx = null, master = null, muted = false, volume = 0.7;
let lastPlayed = new Map();
let active = 0;

export function isMuted() { return muted; }
export function getVolume() { return volume; }
export function setMuted(v) {
    muted = !!v;
    if (master) master.gain.value = muted ? 0 : volume;
    try { localStorage.setItem('labTycoonMute', muted ? '1' : '0'); } catch (e) {}
}
export function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (master && !muted) master.gain.value = volume;
    try { localStorage.setItem('labTycoonVol', String(volume)); } catch (e) {}
}

// Browsers refuse to start audio until the page has been interacted with, so the context is built
// on the first gesture rather than at load. Everything before that is silently dropped, which is
// correct: there is nothing to hear on a page nobody has touched yet.
export function initAudio() {
    try {
        muted = localStorage.getItem('labTycoonMute') === '1';
        const v = parseFloat(localStorage.getItem('labTycoonVol'));
        if (Number.isFinite(v)) volume = v;
    } catch (e) {}
    const start = () => {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!ctx) {
            ctx = new AC();
            master = ctx.createGain();
            master.gain.value = muted ? 0 : volume;
            master.connect(ctx.destination);
        }
        // A context can be *created* and still be suspended -- that is what happens when it is
        // built before the browser considers the page interacted with. Without this it stays
        // suspended for the rest of the session and every sound is silently dropped, which looks
        // exactly like having no audio at all. Resuming is harmless when already running.
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart'])
        window.addEventListener(ev, start, { once: false, passive: true });
}

// One voice. Exported so the same code can be rendered into an OfflineAudioContext and measured,
// rather than the sounds only ever existing as something nobody can check.
export function renderVoice(audio, out, v, at) {
    const t = at + (v.delay || 0);
    const g = audio.createGain();
    const peak = v.gain ?? 0.2;
    const atk = v.a ?? 0.005, dec = v.d ?? Math.max(0.01, v.dur - atk);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dec);
    let node;
    if (v.noise) {
        // White noise through a bandpass: the basis of every thump, clunk and hiss here.
        const len = Math.max(1, Math.ceil(audio.sampleRate * v.dur));
        const buf = audio.createBuffer(1, len, audio.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        const src = audio.createBufferSource();
        src.buffer = buf;
        const bp = audio.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = v.band ?? 800; bp.Q.value = v.q ?? 1;
        src.connect(bp); bp.connect(g);
        node = src;
    } else {
        const osc = audio.createOscillator();
        osc.type = v.type || 'sine';
        osc.frequency.setValueAtTime(v.f, t);
        if (v.to && v.to !== v.f) osc.frequency.exponentialRampToValueAtTime(Math.max(1, v.to), t + v.dur);
        if (v.lp) {
            const lp = audio.createBiquadFilter();
            lp.type = 'lowpass'; lp.frequency.value = v.lp;
            osc.connect(lp); lp.connect(g);
        } else osc.connect(g);
        node = osc;
    }
    g.connect(out);
    node.start(t);
    node.stop(t + v.dur + 0.02);
    return node;
}

export function play(name) {
    const def = DEFS[name];
    if (!def || !ctx || muted || ctx.state === 'suspended') return false;
    const now = ctx.currentTime;
    if (now - (lastPlayed.get(name) || -1) < THROTTLE) return false;
    lastPlayed.set(name, now);
    if (active + def.voices.length > MAX_VOICES) return false;
    for (const v of def.voices) {
        const node = renderVoice(ctx, master, v, now);
        active++;
        node.onended = () => { active--; };
    }
    return true;
}

export const soundNames = () => Object.keys(DEFS);
export const soundDef = (n) => DEFS[n];
export const audioReady = () => !!ctx;
