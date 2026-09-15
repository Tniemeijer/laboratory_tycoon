// ==================== CLEANLINESS ====================

import { G, nav } from '../core.js';
import { GRID, footTiles } from '../grid.js';

export function addDirt(e, amt) {
    const s = G.state;
    const nv = nav();
    const tiles = footTiles(e.type, e.tx, e.tz, e.rot);
    // grime lands on a walkable tile next to the machine, so a cleaner can reach it
    let key = null;
    outer:
    for (const [x, z] of tiles)
        for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
            const nx = x + dx, nz = z + dz;
            if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
            if (nv[nz * GRID + nx]) continue;
            key = nx + ',' + nz; break outer;
        }
    if (!key) { const c = tiles[0]; key = c[0] + ',' + c[1]; }
    s.dirt[key] = Math.min(60, (s.dirt[key] || 0) + Math.max(1, amt));
    recomputeGrime();
}
export function recomputeGrime() {
    const s = G.state;
    const nv = nav();
    let t = 0;
    for (const k in s.dirt) {
        // A dirty tile that's since had a machine built on it has no floor left to mop. Leaving
        // the entry in place meant topDirtTile() (which already skips unreachable tiles) would
        // skip it forever, and that grime would sit there dragging cleanliness down permanently
        // with nothing anyone could ever do about it.
        const [x, z] = k.split(',').map(Number);
        if (nv[z * GRID + x]) { delete s.dirt[k]; delete s.dirtClaims[k]; continue; }
        t += s.dirt[k];
    }
    s.grime = t;
}
// Picks the dirtiest tile nobody is already headed to, so two cleaners never converge on the
// same spill. A later responder simply doesn't see it as a candidate at all.
export function topDirtTile() {
    const nv = nav();
    // Ignore only truly trivial dirt. This used to sit at 12, tuned for when multi-slot
    // machines piled several completions onto the same tile quickly. Now every machine is
    // single-operator, so a tile typically only gets one ~6-point addDirt() at a time and
    // grime spreads thin across many tiles — a 12-point floor meant no single tile ever
    // crossed it, so cleanliness quietly stalled with nothing ever picked to mop.
    let bk = null, bv = 4;
    for (const k in G.state.dirt) {
        if (G.state.dirtClaims[k] != null) continue;    // someone's already on their way
        const [x, z] = k.split(',').map(Number);
        if (nv[z * GRID + x]) continue;         // a machine now covers it. Unreachable
        if (G.state.dirt[k] > bv) { bv = G.state.dirt[k]; bk = k; }
    }
    if (!bk) return null;
    const [x, z] = bk.split(',').map(Number);
    return { key: bk, tile: [x, z], v: bv };
}
