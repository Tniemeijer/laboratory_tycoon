// 4-directional A* over a flat tile grid. Grid is small (<=256), so a linear-scan
// open set is fine. `blocked` is a Uint8Array of length W*H (1 = impassable).
//
// Partition walls sit on the edge *between* two walkable tiles rather than on a tile, so they
// travel as an optional `blocked.walls` bitmask (see buildNav) rather than as a separate argument
// — carrying them on the grid itself means they can't be forgotten at one call site and honoured
// at another, which would have staff pathing through walls only sometimes.

export function aStar(blocked, W, H, sx, sy, gx, gy) {
    const id = (x, y) => y * W + x;
    const inB = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    if (!inB(sx, sy) || !inB(gx, gy)) return null;
    if (blocked[id(gx, gy)]) return null;
    if (sx === gx && sy === gy) return [];

    const N = W * H;
    const g = new Float64Array(N).fill(Infinity);
    const f = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const inOpen = new Uint8Array(N);
    const h = (x, y) => Math.abs(x - gx) + Math.abs(y - gy);

    const start = id(sx, sy);
    g[start] = 0; f[start] = h(sx, sy);
    const open = [start]; inOpen[start] = 1;
    const DIRS = [[1, 0, 8], [-1, 0, 4], [0, 1, 2], [0, -1, 1]];   // dx, dz, wall bit on the tile we're leaving
    const walls = blocked.walls;

    while (open.length) {
        let bi = 0;
        for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
        const cur = open.splice(bi, 1)[0];
        inOpen[cur] = 0;
        const cx = cur % W, cy = (cur - cx) / W;

        if (cx === gx && cy === gy) {
            const path = [];
            let n = cur;
            while (n !== start) { const x = n % W, y = (n - x) / W; path.push([x, y]); n = prev[n]; }
            return path.reverse();
        }
        for (const [dx, dy, bit] of DIRS) {
            const nx = cx + dx, ny = cy + dy;
            if (!inB(nx, ny)) continue;
            const nid = id(nx, ny);
            if (blocked[nid]) continue;
            if (walls && (walls[cur] & bit)) continue;      // a wall runs along this edge
            const t = g[cur] + 1;
            if (t < g[nid]) {
                prev[nid] = cur;
                g[nid] = t;
                f[nid] = t + h(nx, ny);
                if (!inOpen[nid]) { open.push(nid); inOpen[nid] = 1; }
            }
        }
    }
    return null;
}

// Nearest walkable tile orthogonally adjacent to any tile in `footprint`
// (list of [x,y]). Returns [x,y] closest to (fromX,fromY) by A* path length,
// or null if none reachable.
export function nearestAccess(blocked, W, H, footprint, fromX, fromY) {
    const id = (x, y) => y * W + x;
    const inB = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    const footSet = new Set(footprint.map(([x, y]) => id(x, y)));
    const walls = blocked.walls;
    const cands = new Set();
    for (const [x, y] of footprint) {
        for (const [dx, dy, bit] of [[1, 0, 8], [-1, 0, 4], [0, 1, 2], [0, -1, 1]]) {
            const nx = x + dx, ny = y + dy;
            if (walls && (walls[id(x, y)] & bit)) continue;   // can't reach it across a partition
            if (inB(nx, ny) && !blocked[id(nx, ny)] && !footSet.has(id(nx, ny))) cands.add(id(nx, ny));
        }
    }
    let best = null, bestLen = Infinity;
    for (const c of cands) {
        const cx = c % W, cy = (c - cx) / W;
        const p = aStar(blocked, W, H, fromX, fromY, cx, cy);
        if (p && p.length < bestLen) { bestLen = p.length; best = [cx, cy]; }
    }
    return best;
}
