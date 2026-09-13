import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BUILD, ZONES, PROTOCOLS, COND_BREAKDOWN_THRESHOLD } from './data.js';
import {
    GRID, BUILD_MAX_Z, BREAK_ROOM_MAX, breakRoom, breakRoomProps, roomAreas, roomDoorways,
    tileToWorld, footTiles, zoneAt, gateXRange
} from './grid.js';

const HALF = GRID / 2;
const RES_SCALE = 0.36;
const LERP_K = 9;
const ROTATE_COOLDOWN = 0.3;   // seconds between accepted camera-rotate inputs — see rotateView()

// States where the worker is genuinely standing still (never calls stepPath in staff.js) — used
// to gate the wall-safety clamp below without fighting legitimate walking lag at 2x/3x speed.
// Notably excludes 'idle' and 'resting': both can still be mid-walk toward a rest tile.
const STATIONARY_STATES = new Set(['mopping', 'atStation', 'prepping', 'filling', 'repairing', 'maintaining', 'operating', 'tending']);
const PROTO_COLOR = {
    blood: 0xe0555f, tissue: 0x77c97b, chem: 0x5b8de8, virus: 0xf1d34a, dna: 0xb06cd9,
    immuno: 0x35d0ff, pharma: 0xf07a3c, culture: 0x9fd36a, pathogen: 0xd94f7a, genome: 0x7a6cf0
};
// A sample's physical form follows whatever step it's headed into next, not just a tube the whole
// way through — mounted on a slide once it's on its way to be imaged, turned into a written-up
// report once it's on its way to be analyzed. Everything else (prep, spin, incubate) is still the
// raw tube. Used both for the loose sample mesh (via sampleAppearance) and for staged/processing
// tray items sitting on the equipment itself (via appearanceForCap directly, since those already
// carry their cap and don't need a sample lookup).
function appearanceForCap(cap) {
    if (cap === 'image' || cap === 'fluoresce') return 'slide';
    if (cap === 'analyze') return 'report';
    return 'tube';
}
function sampleAppearance(sm) {
    const step = PROTOCOLS[sm.proto].steps[sm.step];
    return appearanceForCap(step ? step.cap : null);
}
// Real lab equipment is mostly steel/white/grey — samples and status lights carry the color instead.
// The mop closet stays warm/wood-toned since it's furniture, not clinical equipment.
const EQUIP_COLOR = {
    bench: 0xc4cdd2, preprobot: 0x4a5560, microscope: 0x585e63, centrifuge: 0xe8ebed, incubator: 0xd6dadd,
    analyzer: 0xdfe3e5, fridge: 0xf2f4f5, freezer: 0xd7dee0, mopcloset: 0xd88a5a, sink: 0xc9ced3,
    scale: 0xe8ebed, chromatograph: 0xdfe3e5, sequencer: 0xe4e9ec, serverrack: 0x3a4046, analysisdesk: 0xd8dde1, darkroom: 0x2a2e33, cleanroom: 0xeef3f4,
    flowhood: 0xe8ebed, fumehood: 0xc9ced3
};

// Idle chatter around the break room. Coffee/radio lines only fire in their own context
// (by the coffee machine, or once the radio's been bought); lab lines are always fair game.
const COFFEE_QUOTES = ["This coffee is terrible.", "Who finished the pot?!", "Is this even decaf?", "We need a coffee run.", "Cold again...", "Whose mug is this?"];
const RADIO_QUOTES = ["Who changed the station?!", "Not this song again...", "Who turned it up?!", "Put the jazz back on.", "Way too loud!", "Can we agree on ONE station?"];
const LAB_QUOTES = ["Where are my goggles?", "Is it Friday yet?", "I mislabeled a tube...", "Who moved my clipboard?", "Five more minutes...", "This centrifuge is cursed.", "Did I turn off the burner?"];

// Rooms (Cleanroom, Dark Room, the ML containment labs) are floor rather than furniture — they
// render as a tinted patch of tiles ringed by partition walls, in the same style as the break
// room, instead of as a model standing on the ground. That's not just cosmetic: a model would sit
// between the cursor and the tile under it, and picking would hand back the room instead of the
// tile, making it impossible to place anything inside one. `light`/`dark` keep the floor's
// checkerboard going; `wall`/`trim` dress the partitions.
const ROOM_STYLE = {
    dark:    { light: 0x3c434a, dark: 0x31383e, wall: 0x23282d, trim: 0x5b4a78 },
    sterile: { light: 0xfdfefe, dark: 0xeaf2f5, wall: 0xe8eef1, trim: 0xb8c2c6 },
    contain: { light: 0xdff0d8, dark: 0xcde4c4, wall: 0xcfe0c4, trim: 0x5f8f4a },
    break:   { light: 0xe8d3ab, dark: 0xdcc294, wall: 0xc9ced3, trim: 0x97a1aa }
};
// Height of the sample tray per machine — the default sits just above a benchtop, but a
// centrifuge carries its samples down in the rotor well instead.
const TRAY_Y = { centrifuge: 0.68 };
// How far each moving part swings when open, in radians. Both ease toward their target in
// sync(); zero always means shut.
const HINGE_OPEN = { centrifuge: -Math.PI / 2, cold: -1.15 };   // the lid stops bolt upright, never past it
const HINGE_SPEED = 6;
const DIR4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const DOOR_PREF = [[0, 1], [1, 0], [-1, 0], [0, -1]];   // south first — that's where the floor traffic is

// Height to float each type's progress bar at, clear of its own model.
const BAR_Y = {
    bench: 0.85, preprobot: 1.62, microscope: 1.3, centrifuge: 0.95, incubator: 1.45, analyzer: 1.25,
    fridge: 1.5, freezer: 1.65, sink: 0.8, mopcloset: 1.45,
    scale: 0.75, chromatograph: 1.35, sequencer: 1.95, serverrack: 1.6, analysisdesk: 1.15, flowhood: 1.35, fumehood: 1.55
};

function lmat(c, e = {}) { return new THREE.MeshLambertMaterial({ color: c, ...e }); }
function box(w, h, d, c, e) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lmat(c, e)); }
// Takes the same optional material extras as box() — without them every cyl() asking for
// transparency (the centrifuge's clear lid, the chromatograph's column, the water cooler bottle)
// silently came out solid, since the argument was just dropped on the floor.
function cyl(rt, rb, h, s, c, e) { return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, s), lmat(c, e)); }
// Every scientist wears a plain white labcoat — with capabilities now independently toggleable
// (Process/Clean/Mechanic checkboxes) rather than one exclusive role, coloring the coat by
// whichever capability happened to be checked/unchecked most recently read as arbitrary and kept
// changing underfoot. The mop swing already shows who's actually cleaning right now.
const COAT_COLOR = 0xf2f4f7;

// dims of a footprint after rotation
function footDims(type, rot) {
    const [fw, fh] = BUILD[type].foot;
    return rot % 2 ? [fh, fw] : [fw, fh];
}
function equipCenterWorld(type, tx, tz, rot) {
    const [w, h] = footDims(type, rot);
    return tileToWorld(tx + (w - 1) / 2, tz + (h - 1) / 2);
}


class LabScene {
    constructor(container) {
        this.container = container;
        this.handlers = {};
        this.tool = null;
        this.equipMeshes = new Map();
        this.sampleMeshes = new Map();
        this.staffMeshes = new Map();
        this.dirtMeshes = new Map();
        this.zoneFences = new Map();
        this._zonesKey = null;
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.hoverTile = null;
        this.clock = new THREE.Clock();
        this.elapsed = 0;

        this._initRenderer();
        this._initScene();
        this._buildStaticWorld();
        this._buildZoneFences();
        this._initGhost();
        this._bindEvents();
        this._animate();
    }
    setHandlers(h) { this.handlers = h; }

    _initRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(1);
        this.renderer.domElement.id = 'lab-canvas';
        this.container.appendChild(this.renderer.domElement);
        this._resize();
    }

    _initScene() {
        this.scene = new THREE.Scene();
        // Dark void instead of a light sky — also, background and fog MUST share the same color:
        // fog fades everything beyond ~44-82 units to its own color, and at the zoomed-out/flat
        // extremes the camera can see well past that range. A mismatched fog/background color is
        // what actually read as "the edge of the world" before, not the ground plane running out.
        this.scene.background = new THREE.Color(0x0c0d0f);
        this.scene.fog = new THREE.Fog(0x0c0d0f, 44, 82);

        this.frustum = 12;
        const aspect = this._w / this._h;
        this.camera = new THREE.OrthographicCamera(-this.frustum * aspect, this.frustum * aspect, this.frustum, -this.frustum, 0.1, 200);
        this.camera.position.set(GRID, GRID * 0.95, GRID);
        this.camera.lookAt(0, 0, 0);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.target.set(0, 0, 0);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        // RCT-style controls: dragging moves the camera across the map (not around it) — turning
        // the view is a deliberate, discrete action via rotateView()/the rotate buttons below, not
        // something you can end up doing by accident mid-drag. Disabling rotate this way also
        // fixes the camera's pitch (RCT's isometric camera never tilts either), which is fine here
        // since free tilt combined with free rotate was the actual source of the bad/degenerate
        // viewing angles this whole feature exists to prevent.
        this.controls.enableRotate = false;
        this.controls.enablePan = true;
        this.controls.screenSpacePanning = true;
        this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
        this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
        // Zoomed all the way out, the 16-tile lab used to shrink to a speck in a sea of empty
        // lawn, showing the raw void past the ground plane. This keeps the map always reasonably
        // framed and legible; panBounds (applied per-frame below) does the same for panning.
        this.controls.minZoom = 0.95;
        this.controls.maxZoom = 2.6;
        this.panBounds = 11;
        this.camera.zoom = 1.15;
        this.camera.updateProjectionMatrix();
        this.controls.update();

        // RCT-style fixed compass rotation: free-dragging still feels responsive while it's
        // happening, but the instant you let go, the view snaps onto the nearest of the 4
        // "corner" viewing angles (45°/135°/225°/315° — offset from the grid axes on purpose,
        // since looking straight down a row of tiles is exactly the degenerate, bad-looking
        // angle this is meant to prevent). Tilt is untouched — only compass heading snaps.
        this._azTween = null;
        // Anchors the snap grid to wherever the camera actually starts (a 45°-off-axis corner),
        // rather than to 0 — rounding cur/STEP*STEP directly would snap to 0°/90°/180°/270°,
        // which are exactly the axis-aligned angles this whole feature exists to avoid.
        this._azBase = this.controls.getAzimuthalAngle();
        this.controls.addEventListener('start', () => { this._azTween = null; });
        this.controls.addEventListener('end', () => this._snapAzimuth());

        this.scene.add(new THREE.AmbientLight(0xffffff, 1.05));
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x5b6b55, 0.45));
        const sun = new THREE.DirectionalLight(0xfff1d6, 1.4);
        sun.position.set(6, 12, 4);
        this.scene.add(sun);
    }

    _buildStaticWorld() {
        // Generously oversized on purpose — at the zoomed-out/flat-tilt extremes a small ground
        // plane runs out before the view does, showing the raw background color as a visible
        // "edge of the world" past the lawn.
        const ground = box(600, 0.4, 600, 0x232629);
        ground.position.y = -0.35;
        this.scene.add(ground);

        // Floor only exists where a room does — the unclaimed corners of the square stay bare
        // lawn (the ground plane shows through), which is what gives the building its cross shape.
        this.floorTiles = [];
        const fg = new THREE.Group();
        const [gateLo, gateHi] = gateXRange();
        for (let tz = 0; tz < GRID; tz++) {
            for (let tx = 0; tx < GRID; tx++) {
                const corridor = tz > BUILD_MAX_Z && tx >= gateLo && tx <= gateHi;
                const zone = corridor ? null : zoneAt(tx, tz);
                // The break room is an annex outside every zone, so its ground gets floor laid for
                // the biggest it could ever grow to; _updateFloor shows only the part in use.
                const annex = tx >= BREAK_ROOM_MAX.x0 && tx < BREAK_ROOM_MAX.x0 + BREAK_ROOM_MAX.w &&
                              tz >= BREAK_ROOM_MAX.z0 && tz < BREAK_ROOM_MAX.z0 + BREAK_ROOM_MAX.h;
                if (!corridor && !zone && !annex) continue;
                const light = (tx + tz) % 2 === 0;
                const col = corridor ? (light ? 0xdfe6d8 : 0xd2d9c9) : (light ? 0xf3efe3 : 0xe3ddcc);
                const t = box(0.98, 0.12, 0.98, col);
                const w = tileToWorld(tx, tz);
                t.position.set(w.x, -0.06, w.z);
                // baseCol is what this tile looks like with nothing painted over it — repainting
                // (unowned land, a room laid on top) starts from here rather than re-deriving the
                // corridor/break-room/checker rules a second time.
                t.userData = { kind: 'tile', tx, tz, zoneId: zone ? zone.id : null, light, baseCol: col, annex };
                if (annex) t.visible = false;
                fg.add(t);
                this.floorTiles.push(t);
            }
        }
        this.scene.add(fg);
        this._floorKeys = new Set(this.floorTiles.map(t => `${t.userData.tx},${t.userData.tz}`));

        this._buildWalls();
    }

    // Traces the true outline of the room layout (ZONES) rather than one big rectangle, so the
    // building silhouette actually reads as a cross/plus shape. A wall segment goes up wherever
    // a room tile borders open lawn; rooms that border each other get an open doorway instead.
    _buildWalls() {
        const wallMat = lmat(0xe4e8ec), trimMat = lmat(0x97a1aa);
        const H = 1.6;
        const seg = (cx, cz, horizontal) => {
            const w = horizontal ? 1.04 : 0.32, d = horizontal ? 0.32 : 1.04;
            const g = new THREE.Group();
            const b = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), wallMat); b.position.y = H / 2;
            const tr = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.18, d + 0.06), trimMat); tr.position.y = H + 0.05;
            g.add(b, tr); g.position.set(cx, 0, cz); this.scene.add(g);
        };
        // The nav grid only tracks per-tile walkability, not per-edge walls — there's no way to
        // mark "these two adjacent tiles are both walkable but you can't cross between them". So
        // the entrance opening here MUST match grid.js's corridor width exactly (gateXRange), not
        // just the two literal gate-post columns — otherwise a nav-walkable corridor tile ends up
        // sitting right behind a rendered wall with nothing stopping a worker from walking through it.
        const [gateLo, gateHi] = gateXRange();
        const inAnnex = (nx, nz) => nx >= BREAK_ROOM_MAX.x0 && nx < BREAK_ROOM_MAX.x0 + BREAK_ROOM_MAX.w &&
                                    nz >= BREAK_ROOM_MAX.z0 && nz < BREAK_ROOM_MAX.z0 + BREAK_ROOM_MAX.h;
        const isWall = (nx, nz) => {
            if (nx < 0 || nx >= GRID || nz < 0) return true;
            // The break room is an annex built onto the side of the building, so the shell doesn't
            // close across where the two meet — its own partition wall (with the doorway in it)
            // is the boundary there. Without this the shell sealed the annex off completely and
            // staff appeared to walk through solid wall to get to the coffee, since the shell is
            // decoration that the nav grid knows nothing about.
            if (inAnnex(nx, nz)) return false;
            if (nz === BUILD_MAX_Z + 1) return nx < gateLo || nx > gateHi;   // entrance row: open for the gate room's width
            if (nz > BUILD_MAX_Z + 1) return false;
            return !zoneAt(nx, nz);
        };
        for (let tz = 0; tz <= BUILD_MAX_Z; tz++) {
            for (let tx = 0; tx < GRID; tx++) {
                if (!zoneAt(tx, tz)) continue;
                const w = tileToWorld(tx, tz);
                if (isWall(tx, tz - 1)) seg(w.x, w.z - 0.5, true);
                if (isWall(tx, tz + 1)) seg(w.x, w.z + 0.5, true);
                if (isWall(tx - 1, tz)) seg(w.x - 0.5, w.z, false);
                if (isWall(tx + 1, tz)) seg(w.x + 0.5, w.z, false);
            }
        }
    }
    // Small tileable diagonal-stripe canvas texture for the caution tape — cached once, cloned
    // per tape segment so each can set its own repeat count for its own length.
    _stripeTexture() {
        if (this._stripeTexBase) return this._stripeTexBase;
        const cnv = document.createElement('canvas');
        cnv.width = 32; cnv.height = 32;
        const ctx = cnv.getContext('2d');
        ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, 32, 32);
        ctx.fillStyle = '#f0c020';
        ctx.save();
        ctx.translate(16, 16); ctx.rotate(Math.PI / 4); ctx.translate(-16, -16);
        for (let x = -32; x < 64; x += 16) ctx.fillRect(x, -16, 8, 64);
        ctx.restore();
        const tex = new THREE.CanvasTexture(cnv);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
        this._stripeTexBase = tex;
        return tex;
    }
    // Which edge of `zone` actually borders owned-from-the-start territory — that's the one edge
    // that's an open doorway right now (walls only ever go up against true exterior), so it's the
    // one that needs a physical "you can't go here yet" barrier across it.
    _entranceEdge(zone) {
        const midX = zone.x0 + Math.floor(zone.w / 2), midZ = zone.z0 + Math.floor(zone.h / 2);
        const checks = [
            ['north', midX, zone.z0 - 1], ['south', midX, zone.z0 + zone.h],
            ['west', zone.x0 - 1, midZ], ['east', zone.x0 + zone.w, midZ]
        ];
        for (const [edge, tx, tz] of checks) {
            const z = zoneAt(tx, tz);
            if (z && z.startOwned) return edge;
        }
        return null;
    }
    // Locked wings get corner posts, a muted floor tint, and — strung across the one edge that
    // actually opens onto owned territory — a strip of black-and-yellow caution tape. The name
    // and price live in the Build menu's Expand Lab list, so there's no in-world text to go blurry.
    _buildZoneFences() {
        for (const zone of ZONES) {
            if (zone.startOwned) continue;
            const w0 = tileToWorld(zone.x0, zone.z0), w1 = tileToWorld(zone.x0 + zone.w - 1, zone.z0 + zone.h - 1);
            const cx = (w0.x + w1.x) / 2, cz = (w0.z + w1.z) / 2;
            const xMin = w0.x - 0.5, xMax = w1.x + 0.5, zMin = w0.z - 0.5, zMax = w1.z + 0.5;
            const group = new THREE.Group();
            for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
                const post = box(0.14, 0.7, 0.14, 0xb5763f);
                post.position.set(cx + dx * (zone.w / 2 - 0.3), 0.35, cz + dz * (zone.h / 2 - 0.3));
                group.add(post);
            }
            const edge = this._entranceEdge(zone);
            if (edge) {
                const horizontal = edge === 'north' || edge === 'south';
                const len = (horizontal ? xMax - xMin : zMax - zMin) - 0.6;
                // Pulled in off the boundary line: sitting exactly on it, the tape overlapped the
                // wall of any room built flush against the edge on the owned side.
                const IN = 0.35;
                const tx = edge === 'west' ? xMin + IN : edge === 'east' ? xMax - IN : cx;
                const tz = edge === 'north' ? zMin + IN : edge === 'south' ? zMax - IN : cz;
                const tex = this._stripeTexture().clone();
                tex.needsUpdate = true;
                tex.repeat.set(len / 0.45, 1);
                const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
                const tape = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.16), mat);
                if (!horizontal) tape.rotation.y = Math.PI / 2;
                tape.position.set(tx, 0.46, tz);
                group.add(tape);
            }
            this.scene.add(group);
            this.zoneFences.set(zone.id, { group });
        }
    }
    // Zone ownership and player-built rooms both repaint the same floor tiles, so they share one
    // pass: work out every tile's colour from scratch whenever either changes, instead of two
    // painters fighting over who wrote last.
    _updateFloor(state) {
        const zonesKey = state.ownedZones.slice().sort().join(',');
        const roomsKey = state.equipment.filter(e => BUILD[e.type].room)
            .map(e => `${e.type}@${e.tx},${e.tz}`).sort().join('|') + '#' + breakRoom(state).level;
        if (zonesKey === this._zonesKey && roomsKey === this._roomsKey) return;
        this._zonesKey = zonesKey; this._roomsKey = roomsKey;

        for (const zone of ZONES) {
            const rec = this.zoneFences.get(zone.id);
            if (rec) rec.group.visible = !state.ownedZones.includes(zone.id);
        }
        // roomAreas() is the same description buildNav() walls off, so the partitions drawn here
        // stand exactly where staff are actually stopped — including the break room, which is just
        // another walled area as far as this is concerned.
        const areas = roomAreas(state);
        const roomKind = new Map();
        for (const [kind, tiles] of areas) for (const key of tiles) roomKind.set(key, kind);
        for (const t of this.floorTiles) {
            const u = t.userData;
            const style = ROOM_STYLE[roomKind.get(`${u.tx},${u.tz}`)];
            if (u.annex) t.visible = !!style;        // annex ground only exists once it's walled in

            const unowned = u.zoneId && !state.ownedZones.includes(u.zoneId);
            const col = style ? (u.light ? style.light : style.dark)
                : unowned ? (u.light ? 0x9fae86 : 0x8fa078)
                : u.baseCol;
            t.material.color.setHex(col);
        }
        this._rebuildRoomWalls(state, areas);
        this._rebuildBreakRoom(state);
    }

    // Partition walls around the outside of each room, in the same style as the break room's.
    // Only edges facing something that isn't the same kind of room get a wall, so laying a second
    // Dark Room flush against the first reads as one larger room rather than two boxes with a
    // wall between them — that's what makes rooms extendable.
    _rebuildRoomWalls(state, areas) {
        if (this.roomWalls) {
            this.scene.remove(this.roomWalls);
            this.roomWalls.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
        }
        this.roomWalls = new THREE.Group();
        this.scene.add(this.roomWalls);
        const H = 0.85;
        for (const [kind, tiles] of areas) {
            const style = ROOM_STYLE[kind] || ROOM_STYLE.sterile;
            const doors = roomDoorways(state, tiles);
            for (const key of tiles) {
                const [tx, tz] = key.split(',').map(Number);
                const w = tileToWorld(tx, tz);
                for (const [dx, dz] of DIR4) {
                    if (tiles.has(`${tx + dx},${tz + dz}`)) continue;        // shared with the room next door
                    if (doors.has(`${key}|${dx},${dz}`)) continue;           // left open as the way in
                    const horizontal = dz !== 0;
                    const len = 1.04;                                        // overlap slightly so corners meet
                    const sw = horizontal ? len : 0.16, sd = horizontal ? 0.16 : len;
                    const g = new THREE.Group();
                    const body = new THREE.Mesh(new THREE.BoxGeometry(sw, H, sd), lmat(style.wall));
                    body.position.y = H / 2;
                    const trim = new THREE.Mesh(new THREE.BoxGeometry(sw + 0.05, 0.1, sd + 0.05), lmat(style.trim));
                    trim.position.y = H + 0.04;
                    g.add(body, trim);
                    // Sat a touch inside its own tile rather than dead on the tile boundary: flush
                    // against the building's outer wall the two were coincident, and the room's
                    // colour was lost inside the grey shell.
                    const INSET = 0.1;
                    g.position.set(w.x + dx * (0.5 - INSET), 0, w.z + dz * (0.5 - INSET));
                    this.roomWalls.add(g);
                }
            }
        }
    }


    // A dedicated, genuinely walled-off break room (not player-built) — real labs don't allow
    // food or drink on the work floor, so this needed to be its own little room rather than a
    // machine just standing in the open. Coffee machine, water cooler, vending machine and a
    // table are each on their own tile (blocking movement, like any piece of equipment); the
    // rest of the room's floor stays open for staff to stand around in. Partition walls go up on
    // three sides, with the fourth (east) left open as the doorway. The radio prop only appears
    // once that upgrade is bought.
    // The break room is rebuilt whenever Staff Quarters is upgraded: it starts as a two-tile nook
    // with just a coffee machine and gains floor and furnishings with each level (see breakRoom()
    // and breakRoomProps() in grid.js, which the nav grid reads from too). Its partition walls are
    // drawn by _rebuildRoomWalls like any other walled area.
    _rebuildBreakRoom(state) {
        if (this.breakRoomGroup) {
            this.scene.remove(this.breakRoomGroup);
            this.breakRoomGroup.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
        }
        this.breakRoomGroup = new THREE.Group();
        this.scene.add(this.breakRoomGroup);
        this.coffeeMachine = null; this.radioProp = null;
        for (const prop of breakRoomProps(state)) {
            const w = tileToWorld(prop.tile[0], prop.tile[1]);
            const g = this[`_prop_${prop.key}`]();
            g.position.set(w.x, 0, w.z);
            g.rotation.y = -(prop.rot || 0) * Math.PI / 2;   // same convention as equipment
            this.breakRoomGroup.add(g);
            if (prop.key === 'coffee') {
                this.coffeeMachine = g;
                // the radio sits on the end of the coffee counter, once that upgrade is bought
                const r = this._prop_radio();
                r.position.set(w.x + 0.28, 0.58, w.z - 0.16);
                r.visible = (state.upgrades.radio || 0) > 0;
                this.breakRoomGroup.add(r);
                this.radioProp = r;
            }
        }
    }
    _prop_coffee() {
        const g = new THREE.Group();
        const counter = box(0.8, 0.55, 0.6, 0x8a6a4a); counter.position.y = 0.275; g.add(counter);
        const top = box(0.84, 0.06, 0.64, 0x6b4a2a); top.position.y = 0.58; g.add(top);
        const machine = box(0.3, 0.38, 0.22, 0x33383c); machine.position.set(-0.16, 0.8, 0); g.add(machine);
        const pot = cyl(0.09, 0.1, 0.2, 10, 0x1c1f22); pot.position.set(-0.16, 0.66, 0.16); g.add(pot);
        const potHandle = box(0.03, 0.1, 0.03, 0x1c1f22); potHandle.position.set(-0.02, 0.66, 0.16); g.add(potHandle);
        const warmLight = box(0.04, 0.02, 0.04, 0xff6a3c); warmLight.position.set(-0.16, 0.94, -0.06); g.add(warmLight);
        const mug1 = cyl(0.05, 0.05, 0.09, 8, 0xe4dfd2); mug1.position.set(0.16, 0.63, 0.12); g.add(mug1);
        const mug2 = cyl(0.05, 0.05, 0.09, 8, 0xc0564a); mug2.position.set(0.27, 0.63, -0.05); g.add(mug2);
        return g;
    }
    _prop_radio() {
        const r = new THREE.Group();
        const body = box(0.22, 0.14, 0.12, 0xc23b2e); body.position.y = 0.07; r.add(body);
        const speakerL = cyl(0.045, 0.045, 0.02, 10, 0x2a2a2a); speakerL.rotation.x = Math.PI / 2; speakerL.position.set(-0.06, 0.07, 0.061); r.add(speakerL);
        const speakerR = cyl(0.045, 0.045, 0.02, 10, 0x2a2a2a); speakerR.rotation.x = Math.PI / 2; speakerR.position.set(0.06, 0.07, 0.061); r.add(speakerR);
        const antenna = box(0.015, 0.22, 0.015, 0x8a9196); antenna.position.set(0.08, 0.22, 0); antenna.rotation.z = 0.3; r.add(antenna);
        return r;
    }
    _prop_cooler() {
        const wc = new THREE.Group();
        const wcStand = box(0.28, 0.48, 0.28, 0xe8ebed); wcStand.position.y = 0.24; wc.add(wcStand);
        const wcBottle = cyl(0.15, 0.17, 0.42, 10, 0x8ecbe8, { transparent: true, opacity: 0.7 });
        wcBottle.position.y = 0.69; wc.add(wcBottle);
        const wcCap = cyl(0.06, 0.06, 0.05, 8, 0x33383c); wcCap.position.y = 0.91; wc.add(wcCap);
        const wcSpout = box(0.05, 0.05, 0.06, 0x33383c); wcSpout.position.set(0.1, 0.44, 0.12); wc.add(wcSpout);
        return wc;
    }
    _prop_vending() {
        const vm = new THREE.Group();
        const vmBody = box(0.6, 1.2, 0.42, 0xc23b2e); vmBody.position.y = 0.6; vm.add(vmBody);
        const vmGlass = box(0.44, 0.78, 0.03, 0x1c2b33, { transparent: true, opacity: 0.6 });
        vmGlass.position.set(0, 0.68, 0.215); vm.add(vmGlass);
        const snackCols = [0xf0c020, 0x5fb85f, 0xe07a3f, 0xd6555f];
        for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
            const snack = box(0.1, 0.14, 0.02, snackCols[(row * 3 + col) % snackCols.length]);
            snack.position.set(-0.14 + col * 0.14, 0.88 - row * 0.28, 0.22);
            vm.add(snack);
        }
        const vmButtons = box(0.1, 0.3, 0.03, 0x2a2f33); vmButtons.position.set(0, 0.36, 0.215); vm.add(vmButtons);
        return vm;
    }
    _prop_table() {
        const tbl = new THREE.Group();
        const tableTop = cyl(0.3, 0.3, 0.05, 12, 0x8a6a4a); tableTop.position.y = 0.5; tbl.add(tableTop);
        const tableLeg = cyl(0.05, 0.05, 0.48, 8, 0x6b4a2a); tableLeg.position.y = 0.26; tbl.add(tableLeg);
        for (const [dx, dz] of [[0.42, 0], [-0.42, 0]]) {
            const stoolSeat = cyl(0.14, 0.14, 0.06, 10, 0xd88a5a);
            stoolSeat.position.set(dx, 0.32, dz); tbl.add(stoolSeat);
            const stoolLeg = cyl(0.035, 0.035, 0.3, 8, 0x6b4a2a);
            stoolLeg.position.set(dx, 0.16, dz); tbl.add(stoolLeg);
        }
        return tbl;
    }

    _initGhost() {
        this.ghost = new THREE.Group();
        this.ghostBox = box(1, 0.5, 1, 0x54d67a, { transparent: true, opacity: 0.22 });
        this.ghost.add(this.ghostBox);
        this.ghostModelHolder = new THREE.Group();
        this.ghost.add(this.ghostModelHolder);
        this.ghostModel = null;
        this.ghostType = null;
        this.ghost.visible = false;
        this.scene.add(this.ghost);

        this.hoverRing = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 1),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 }));
        this.hoverRing.visible = false;
        this.scene.add(this.hoverRing);
    }

    _bindEvents() {
        const el = this.renderer.domElement;
        el.addEventListener('pointermove', e => this._onMove(e));
        // Acting on pointerdown directly used to fire a click/placement the instant a finger (or
        // mouse) touched the canvas, even when the gesture turned into an OrbitControls drag —
        // barely noticeable with a mouse (people rarely click-and-drag), but on touch, where
        // dragging IS how you move the view around, every attempt to pan the camera also
        // placed/selected/demolished whatever was under the first-touched pixel. Track the down
        // point and only treat it as a tap if release lands within a few pixels of it.
        el.addEventListener('pointerdown', e => { this._downPt = { x: e.clientX, y: e.clientY, button: e.button }; });
        el.addEventListener('pointerup', e => {
            const d = this._downPt; this._downPt = null;
            if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
            this._onDown(e, d.button);
        });
        el.addEventListener('pointercancel', () => { this._downPt = null; });
        el.addEventListener('contextmenu', e => e.preventDefault());
        window.addEventListener('resize', () => this._resize());

        // WASD pans the camera continuously while held, same destination as a mouse drag — held
        // state only, the actual per-frame movement happens in _updatePanKeys() from _animate().
        this._panKeys = new Set();
        const PAN_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
        window.addEventListener('keydown', e => {
            if (e.target.tagName === 'INPUT' || !PAN_CODES.has(e.code)) return;
            this._panKeys.add(e.code);
        });
        window.addEventListener('keyup', e => { this._panKeys.delete(e.code); });
        window.addEventListener('blur', () => this._panKeys.clear());
    }
    // Moves controls.target at a fixed world-space speed in whichever direction the currently
    // held WASD keys imply, relative to the camera's own facing (so W always scrolls "away from
    // camera" on screen no matter which of the 4 snapped compass angles you're looking from) —
    // the same target OrbitControls' own drag-to-pan already moves, so this rides along with the
    // existing panBounds clamp in _animate() for free.
    _updatePanKeys(dt) {
        if (!this._panKeys.size) return;
        const theta = this.controls.getAzimuthalAngle();
        // Flat (XZ) "camera → target" direction at this azimuth — see _updateAzTween's use of
        // the same Spherical convention for "target → camera" (the position offset); this is
        // just that direction reversed, since panning "forward" scrolls the ground toward camera.
        const fx = -Math.sin(theta), fz = -Math.cos(theta);
        const rx = -fz, rz = fx;   // rotate 90° for the strafe (A/D) axis
        let mx = 0, mz = 0;
        if (this._panKeys.has('KeyW')) { mx += fx; mz += fz; }
        if (this._panKeys.has('KeyS')) { mx -= fx; mz -= fz; }
        if (this._panKeys.has('KeyD')) { mx += rx; mz += rz; }
        if (this._panKeys.has('KeyA')) { mx -= rx; mz -= rz; }
        const len = Math.hypot(mx, mz);
        if (len < 1e-6) return;
        const PAN_SPEED = 8;   // world units/sec
        const step = PAN_SPEED * dt / len;
        const dx = mx * step, dz = mz * step;
        // A real pan has to move the camera itself, not just where it's looking — moving only
        // the target leaves the camera behind, so controls.update() (which re-derives azimuth
        // and polar from the camera→target offset every frame) sees a different offset and
        // reads it as the view having tilted, not panned. Translating both by the same delta
        // keeps that offset — and so the tilt — exactly as it was, same as OrbitControls' own
        // drag-to-pan already does under the hood.
        this.controls.target.x += dx; this.controls.target.z += dz;
        this.camera.position.x += dx; this.camera.position.z += dz;
    }
    _setPointer(e) {
        const r = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
        this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    }
    _pick() {
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const eq = [];
        this.equipMeshes.forEach(m => eq.push(m));
        const he = this.raycaster.intersectObjects(eq, true);
        if (he.length) {
            let o = he[0].object;
            while (o && !o.userData.kind) o = o.parent;
            if (o && o.userData.kind === 'equip') return { type: 'equip', id: o.userData.id };
        }
        const hf = this.raycaster.intersectObjects(this.floorTiles, false);
        if (hf.length) { const u = hf[0].object.userData; return { type: 'tile', tx: u.tx, tz: u.tz }; }
        return null;
    }
    _onMove(e) {
        this._setPointer(e);
        const hit = this._pick();
        if (hit && hit.type === 'tile') {
            this.hoverTile = { tx: hit.tx, tz: hit.tz };
            this.handlers.onTileHover && this.handlers.onTileHover(hit.tx, hit.tz);
        } else {
            this.hoverTile = null;
            this.handlers.onTileHover && this.handlers.onTileHover(null, null);
        }
    }
    _onDown(e, button = e.button) {
        this._setPointer(e);
        const hit = this._pick();
        if (!hit) return;
        if (button === 2) {
            if (hit.type === 'equip') this.handlers.onEquipmentRightClick && this.handlers.onEquipmentRightClick(hit.id);
            return;
        }
        if (hit.type === 'equip') this.handlers.onEquipmentClick && this.handlers.onEquipmentClick(hit.id);
        else this.handlers.onTileClick && this.handlers.onTileClick(hit.tx, hit.tz);
    }

    setTool(t) { this.tool = t; if (!t || t === 'demolish' || t === 'rotate') this.ghost.visible = false; }

    // real, semi-transparent preview of the machine you're about to place
    setGhost(type, tx, tz, rot, valid) {
        if (!type || tx == null) { this.ghost.visible = false; return; }
        if (type !== this.ghostType) {
            this.ghostModelHolder.clear();
            const model = this._buildEquip({ type, rot: 0, tx: 0, tz: 0, processing: [] });
            model.traverse(o => {
                if (o.isMesh) {
                    o.material = o.material.clone();
                    o.material.transparent = true;
                    o.material.depthWrite = false;
                    o.userData.baseColor = o.material.color.clone();
                }
                if (o.userData.spin) o.visible = false;
            });
            this.ghostModelHolder.add(model);
            this.ghostModel = model;
            this.ghostType = type;
        }
        const [w, h] = footDims(type, rot);
        const c = tileToWorld(tx + (w - 1) / 2, tz + (h - 1) / 2);
        this.ghostBox.scale.set(w, 1, h);
        this.ghost.position.set(c.x, 0, c.z);
        this.ghostModel.rotation.y = -rot * Math.PI / 2;
        this.ghostModel.position.set(0, 0, 0);
        const tint = new THREE.Color(valid ? 0x54d67a : 0xe0555f);
        this.ghostModel.traverse(o => {
            if (o.isMesh && o.userData.baseColor) { o.material.color.copy(o.userData.baseColor).lerp(tint, 0.5); o.material.opacity = 0.68; }
        });
        this.ghostBox.material.color.setHex(valid ? 0x54d67a : 0xe0555f);
        this.ghost.visible = true;
    }

    // ---------- models ----------
    _buildEquip(e) {
        const g = new THREE.Group();
        g.userData = { kind: 'equip', id: e.id, type: e.type, rot: e.rot };
        const col = EQUIP_COLOR[e.type] || 0xcccccc;
        const [fw, fh] = BUILD[e.type].foot;                 // model built in base orientation
        // Where the loaded samples sit on this machine. Most hold them on a flat tray; the
        // centrifuge holds them in its rotor, higher up and — since that's the whole point of a
        // centrifuge — spinning along with it whenever a run is actually under way.
        const tray = new THREE.Group(); tray.position.y = TRAY_Y[e.type] ?? 0.62;
        if (e.type === 'centrifuge') { tray.userData.spinAnim = true; tray.userData.spinRate = 16; }
        g.userData.tray = tray; g.add(tray);

        // The progress bar isn't modelled here at all — it's a DOM element positioned in
        // _syncProgressBars(), for the same reason the speech bubbles are: the 3D pass renders at
        // a fraction of screen resolution for the pixel-art look, which left a thin bar chunky and
        // hard to read. A flat panel in the scene also had to face *somewhere*, so it went nearly
        // edge-on at two of the four camera angles; an overlay always faces you. This just records
        // the height to anchor it at.
        g.userData.barY = BAR_Y[e.type] || 1.4;

        // Reliability light — hidden while a machine's in good shape, amber once it's worn
        // enough to risk breaking, blinking red once it actually has (see sync() below). Sits
        // just above the progress bar rather than replacing it, since a machine can be both
        // mid-run and showing amber at the same time.
        const warnLight = box(0.16, 0.16, 0.16, 0xf0a03c);
        warnLight.position.set(0, (BAR_Y[e.type] || 1.4) + 0.22, 0);
        warnLight.visible = false;
        g.add(warnLight);
        g.userData.warnLight = warnLight;

        if (e.type === 'bench') {
            const top = box(0.85, 0.16, 0.85, col); top.position.y = 0.52; g.add(top);
            for (const [x, z] of [[.32, .32], [-.32, .32], [.32, -.32], [-.32, -.32]]) {
                const l = box(0.08, 0.46, 0.08, 0x6b7075); l.position.set(x, 0.25, z); g.add(l);
            }
            const shelf = box(0.7, 0.1, 0.16, 0xdedede); shelf.position.set(0, 0.72, -0.32); g.add(shelf);
            // Bunsen burner, lit only while the bench is actually running a prep (see sync()).
            // The flame's geometry is shifted so it sits on the barrel — scaling it then makes it
            // lick upward from the burner rather than growing out of both ends.
            const burnerBase = cyl(0.075, 0.095, 0.045, 8, 0x6b7075); burnerBase.position.set(0.27, 0.62, 0.22); g.add(burnerBase);
            const burnerTube = cyl(0.028, 0.032, 0.17, 8, 0x8a9196); burnerTube.position.set(0.27, 0.73, 0.22); g.add(burnerTube);
            const flameGeo = new THREE.CylinderGeometry(0.016, 0.05, 0.14, 8);
            flameGeo.translate(0, 0.07, 0);
            const flame = new THREE.Mesh(flameGeo, lmat(0x5b8de8, { transparent: true, opacity: 0.8 }));
            flame.position.set(0.27, 0.81, 0.22); flame.visible = false;
            flame.userData.flame = true; g.add(flame);
            const coreGeo = new THREE.CylinderGeometry(0.008, 0.026, 0.075, 8);
            coreGeo.translate(0, 0.037, 0);
            const flameCore = new THREE.Mesh(coreGeo, lmat(0xf5d76e, { transparent: true, opacity: 0.9 }));
            flameCore.position.set(0.27, 0.81, 0.22); flameCore.visible = false;
            flameCore.userData.flame = true; g.add(flameCore);
        } else if (e.type === 'preprobot') {
            // A benchtop liquid-handling deck spanning its full 2×1 footprint — classic Tecan-style
            // rig: a bench with a small well grid, an XY gantry (two side rails + a crossing
            // bridge) suspended over it, and a pipetting head hanging off the bridge.
            const benchTop = box(fw - 0.15, 0.14, fh - 0.15, 0xc4cdd2); benchTop.position.y = 0.52; g.add(benchTop);
            const legX = fw / 2 - 0.12, legZ = fh / 2 - 0.12;
            for (const [x, z] of [[legX, legZ], [-legX, legZ], [legX, -legZ], [-legX, -legZ]]) {
                const l = box(0.08, 0.46, 0.08, 0x6b7075); l.position.set(x, 0.25, z); g.add(l);
            }
            for (const xs of [-1, 1]) for (const zs of [-1, 1]) {
                const well = box(0.1, 0.04, 0.1, 0x8a9196); well.position.set(xs * fw * 0.18, 0.61, zs * fh * 0.2); g.add(well);
            }
            const railZ = fh / 2 - 0.08, railY = 0.95;
            const railL = box(fw - 0.24, 0.045, 0.045, col); railL.position.set(0, railY, railZ); g.add(railL);
            const railR = box(fw - 0.24, 0.045, 0.045, col); railR.position.set(0, railY, -railZ); g.add(railR);
            for (const xs of [-1, 1]) for (const zs of [-1, 1]) {
                const post = box(0.045, railY - 0.6, 0.045, 0x6b7075);
                post.position.set(xs * (fw / 2 - 0.12), 0.6 + (railY - 0.6) / 2, zs * railZ);
                g.add(post);
            }
            // The bridge (+head +tip) rides as one carriage that actually slides along the rails
            // while a run is active (see sync()'s timedBusy handling) — a static gantry read as
            // just a shelf with a bar over it, not a robot at work.
            const carriage = new THREE.Group(); carriage.position.set(0, railY, 0);
            carriage.userData.gantrySlide = true; carriage.userData.gantryRange = fw / 2 - 0.3;
            g.add(carriage);
            const bridge = box(0.06, 0.06, fh - 0.1, 0x2f3438); carriage.add(bridge);
            const head = box(0.09, 0.16, 0.06, 0x8a9196); head.position.set(0, -0.14, 0); carriage.add(head);
            const tip = box(0.05, 0.03, 0.03, 0x37ff8a, { transparent: true, opacity: 0.9 });
            tip.position.set(0, -0.23, 0); tip.userData.spin = true; carriage.add(tip);
            // Sealed, extracted glass enclosure over the whole deck. Nothing reaches in — it's
            // automated — so unlike the hoods there's no access gap, and being contained is what
            // lets it run hazardous Chem Prep as well as routine prep (see BUILD.preprobot).
            const GH = 0.78, deckY = 0.58;
            const gy = deckY + GH / 2, gx = fw / 2 - 0.07, gz = fh / 2 - 0.07;
            const glass = { transparent: true, opacity: 0.22, depthWrite: false };
            const pane = (w, hgt, d, x, y, z) => { const m = box(w, hgt, d, 0xcfe8f2, glass); m.position.set(x, y, z); g.add(m); };
            pane(fw - 0.14, GH, 0.03, 0, gy, -gz);
            pane(fw - 0.14, GH, 0.03, 0, gy, gz);
            pane(0.03, GH, fh - 0.14, -gx, gy, 0);
            pane(0.03, GH, fh - 0.14, gx, gy, 0);
            pane(fw - 0.14, 0.03, fh - 0.14, 0, deckY + GH, 0);
            for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
                const post = box(0.05, GH, 0.05, 0x8a9196); post.position.set(sx * gx, gy, sz * gz); g.add(post);
            }
            const exDuct = cyl(0.1, 0.1, 0.28, 10, 0x8a9196); exDuct.position.set(fw * 0.28, deckY + GH + 0.14, 0); g.add(exDuct);
            const exCap = cyl(0.13, 0.13, 0.04, 10, 0x6b7075); exCap.position.set(fw * 0.28, deckY + GH + 0.3, 0); g.add(exCap);
        } else if (e.type === 'microscope') {
            // Used to float knee-high on a squat pedestal — now sits properly on a bench, like
            // the actual Lab Bench model, with the scope mounted on top.
            const benchTop = box(0.85, 0.14, 0.85, 0xc4cdd2); benchTop.position.y = 0.51; g.add(benchTop);
            for (const [x, z] of [[.32, .32], [-.32, .32], [.32, -.32], [-.32, -.32]]) {
                const leg = box(0.07, 0.44, 0.07, 0x6b7075); leg.position.set(x, 0.24, z); g.add(leg);
            }
            const mBase = box(0.22, 0.08, 0.26, col); mBase.position.set(0, 0.62, -0.05); g.add(mBase);
            const arm = box(0.09, 0.34, 0.09, col); arm.position.set(0, 0.83, -0.16); g.add(arm);
            const stage = box(0.2, 0.03, 0.16, 0x9aa2a8); stage.position.set(0, 0.72, -0.02); g.add(stage);
            const tube = cyl(0.055, 0.055, 0.3, 8, 0x2f3438); tube.position.set(0, 0.95, 0.08); tube.rotation.x = 0.55; g.add(tube);
        } else if (e.type === 'centrifuge') {
            // The tubes in the rotor well are the real staged/running samples (_syncTray lays this
            // type out radially) and they whirl round with the rotor spider on a run. The lid is
            // clear polycarbonate and hinged at the back: it drops shut while the rotor is up to
            // speed — you can't spin one open — and stands open again the moment the run ends, so
            // you can still watch the samples through it either way.
            const drum = cyl(0.43, 0.46, 0.5, 14, col); drum.position.y = 0.25; g.add(drum);
            const rim = cyl(0.47, 0.45, 0.07, 14, 0xb8c2c6); rim.position.y = 0.53; g.add(rim);
            const well = cyl(0.38, 0.36, 0.2, 14, 0x23282d); well.position.y = 0.5; g.add(well);
            const rotor = new THREE.Group(); rotor.position.y = 0.62;
            rotor.userData.spinAnim = true; rotor.userData.spinRate = 16; g.add(rotor);
            const hub = cyl(0.08, 0.1, 0.1, 8, 0x8a9196); rotor.add(hub);
            for (const rot of [0, Math.PI / 2]) {           // two crossed bars = a four-arm spider
                const arm = box(0.6, 0.025, 0.06, 0x9aa2a8); arm.rotation.y = rot; rotor.add(arm);
            }
            // A clear collar closes the drum in around the rotor, and the lid is a flat disc
            // hinged at the back that swings to exactly vertical — no further. Stopping at 90°
            // is what keeps it inside the machine's own tile: standing straight up, only the
            // disc's 5cm thickness sits behind the hinge, where tipping it past vertical would
            // swing its whole radius out over the tile behind (and into the wall).
            const collar = cyl(0.40, 0.40, 0.27, 14, 0xdff2fa, { transparent: true, opacity: 0.16, depthWrite: false });
            collar.position.y = 0.70; g.add(collar);
            const barrel = cyl(0.04, 0.04, 0.3, 8, 0x6b7075);
            barrel.rotation.z = Math.PI / 2; barrel.position.set(0, 0.86, -0.34); g.add(barrel);
            const lidHinge = new THREE.Group();
            lidHinge.position.set(0, 0.86, -0.34);
            lidHinge.rotation.x = HINGE_OPEN.centrifuge;
            lidHinge.userData.hingeAxis = 'x';
            lidHinge.userData.hingeOpen = HINGE_OPEN.centrifuge;
            lidHinge.userData.hingeTarget = HINGE_OPEN.centrifuge;
            lidHinge.userData.hingeInterlock = true;      // stays down until the rotor has stopped
            g.add(lidHinge); g.userData.hinge = lidHinge;
            for (const sx of [-1, 1]) {
                const strap = box(0.06, 0.05, 0.14, 0x8a9196);
                strap.position.set(sx * 0.13, 0, 0.07); lidHinge.add(strap);
            }
            const lid = cyl(0.41, 0.41, 0.05, 14, 0xdff2fa, { transparent: true, opacity: 0.25, depthWrite: false });
            lid.position.set(0, 0, 0.34); lidHinge.add(lid);
            const lidRim = cyl(0.42, 0.42, 0.02, 14, 0xb8c2c6); lidRim.position.set(0, -0.035, 0.34); lidHinge.add(lidRim);
            const knob = box(0.14, 0.05, 0.06, 0x6b7075); knob.position.set(0, 0.04, 0.62); lidHinge.add(knob);
            const panel = box(0.24, 0.12, 0.04, 0x1b2b33); panel.position.set(0, 0.3, 0.45); g.add(panel);
            const lt = box(0.08, 0.05, 0.02, 0x37ff8a, { transparent: true, opacity: 0.9 });
            lt.position.set(0, 0.3, 0.48); lt.userData.spin = true; g.add(lt);
        } else if (e.type === 'incubator') {
            // Same idea as the cold stores: the cabinet stops short of the door so there's a warm,
            // shelved recess to see when it swings open, and the door is hinged rather than painted
            // on. Layers are kept at deliberately different depths — they used to be near-coplanar
            // and z-fought at most camera angles.
            const bodyFace = fh / 2 - 0.075;
            const RECESS = 0.2, back = -(fh / 2 - 0.075), front = bodyFace - RECESS;
            const body = box(fw - 0.15, 1.2, front - back, col);
            body.position.set(0, 0.66, (front + back) / 2); g.add(body);
            // Kept within the footprint of the shut door, same as the cold stores — and framed the
            // same way, so nothing shows through around the door when it's closed.
            const dwI = fw - 0.3, inWI = dwI - 0.08, doorHI = 0.85;
            const inTopI = 0.6 + 0.425 - 0.05, inBotI = 0.6 - 0.425 + 0.05;
            const zMidI = (front + bodyFace) / 2, frameWI = (fw - 0.15 - dwI) / 2;
            const lintelHI = 1.26 - (0.6 + doorHI / 2);
            if (lintelHI > 0.01) { const m = box(fw - 0.15, lintelHI, RECESS, col); m.position.set(0, 1.26 - lintelHI / 2, zMidI); g.add(m); }
            const sillHI = 0.6 - doorHI / 2;
            if (sillHI > 0.01) { const m = box(fw - 0.15, sillHI, RECESS, col); m.position.set(0, sillHI / 2, zMidI); g.add(m); }
            if (frameWI > 0.01) for (const sx of [-1, 1]) {
                const m = box(frameWI, doorHI, RECESS, col);
                m.position.set(sx * (dwI + frameWI) / 2, 0.6, zMidI); g.add(m);
            }
            const inner = box(inWI, inTopI - inBotI, 0.03, 0x7a6a52); inner.position.set(0, (inTopI + inBotI) / 2, front + 0.02); g.add(inner);
            const warm = box(inWI - 0.05, inTopI - inBotI - 0.05, 0.02, 0xf0a03c, { transparent: true, opacity: 0.35 });
            warm.position.set(0, (inTopI + inBotI) / 2, front + 0.05); g.add(warm);
            for (let i = 0; i < 3; i++) {
                const y = inBotI + 0.07 + i * (inTopI - inBotI - 0.18) / 2;
                const shelf = box(inWI - 0.04, 0.03, RECESS - 0.06, 0x9aa2a8);
                shelf.position.set(0, y, front + RECESS / 2); g.add(shelf);
                for (let k = 0; k < 2; k++) {
                    const dish = cyl(0.07, 0.07, 0.035, 10, [0x9fd36a, 0xd9c98a][(i + k) % 2]);
                    dish.position.set(-0.13 + k * 0.26, y + 0.035, front + RECESS / 2); g.add(dish);
                }
            }
            const dw = fw - 0.3;
            const hinge = new THREE.Group();
            hinge.position.set(-dw / 2, 0.6, bodyFace);
            hinge.userData.hingeAxis = 'y';
            hinge.userData.hingeOpen = HINGE_OPEN.cold;
            hinge.userData.hingeTarget = 0;
            g.add(hinge); g.userData.hinge = hinge;
            const door = box(dw, 0.85, 0.05, 0xeef1f2); door.position.set(dw / 2, 0, 0); hinge.add(door);
            const win = box(0.36, 0.34, 0.03, 0x8be0c0, { transparent: true, opacity: 0.8 });
            win.position.set(dw / 2, 0.18, 0.04); hinge.add(win);
            const handle = box(0.05, 0.34, 0.05, 0x6b7075);
            handle.position.set(dw - 0.06, -0.1, 0.04); hinge.add(handle);
        } else if (e.type === 'sequencer') {
            // A big benchtop instrument: heavy chassis, a lit flow-cell bay on the front face, and
            // a monitor on a stalk showing the read as it comes off — both lights only on while
            // it's actually running (userData.spin), like every other machine's activity tell.
            const cabFace = (fh - 0.2) / 2;
            const body = box(fw - 0.2, 1.0, fh - 0.2, col); body.position.y = 0.52; g.add(body);
            const plinth = box(fw - 0.1, 0.08, fh - 0.1, 0x9aa2a8); plinth.position.y = 0.04; g.add(plinth);
            const bay = box(fw * 0.42, 0.28, 0.05, 0x11333a); bay.position.set(-fw * 0.17, 0.6, cabFace + 0.03); g.add(bay);
            const bayGlow = box(fw * 0.36, 0.2, 0.02, 0x54d67a, { transparent: true, opacity: 0.85 });
            bayGlow.position.set(-fw * 0.17, 0.6, cabFace + 0.07); bayGlow.userData.spin = true; g.add(bayGlow);
            const handle = box(fw * 0.3, 0.05, 0.06, 0x6b7075); handle.position.set(-fw * 0.17, 0.42, cabFace + 0.04); g.add(handle);
            const vent = box(fw - 0.45, 0.07, 0.12, 0x9aa2a8); vent.position.set(0, 1.0, -cabFace + 0.06); g.add(vent);
            const post = box(0.07, 0.34, 0.07, 0x6b7075); post.position.set(fw * 0.2, 1.19, 0); g.add(post);
            const screen = box(0.52, 0.36, 0.05, 0x1b2b33); screen.position.set(fw * 0.2, 1.52, 0.05); g.add(screen);
            const trace = box(0.42, 0.24, 0.02, 0x35d0ff, { transparent: true, opacity: 0.85 });
            trace.position.set(fw * 0.2, 1.52, 0.09); trace.userData.spin = true; g.add(trace);
        } else if (e.type === 'serverrack') {
            // A single cabinet of blades. The LED columns are the only activity tell it needs —
            // nothing moves in or out by hand, samples arrive over the network (autoFeed).
            const cab = box(0.62, 1.25, 0.72, col); cab.position.y = 0.63; g.add(cab);
            const foot = box(0.68, 0.06, 0.78, 0x23282d); foot.position.y = 0.03; g.add(foot);
            for (let i = 0; i < 4; i++) {
                const shelf = box(0.54, 0.035, 0.03, 0x6b7075);
                shelf.position.set(0, 0.26 + i * 0.27, 0.365); g.add(shelf);
                const led = box(0.3, 0.045, 0.02, 0x37ff8a, { transparent: true, opacity: 0.9 });
                led.position.set(-0.1, 0.34 + i * 0.27, 0.37); led.userData.spin = true; g.add(led);
            }
            const grille = box(0.5, 0.5, 0.02, 0x23282d); grille.position.set(0, 1.05, 0.365); g.add(grille);
        } else if (e.type === 'analysisdesk') {
            const top = box(0.92, 0.08, 0.62, col); top.position.y = 0.5; g.add(top);
            for (const [x, z] of [[.38, .24], [-.38, .24], [.38, -.24], [-.38, -.24]]) {
                const l = box(0.06, 0.46, 0.06, 0x8a9196); l.position.set(x, 0.23, z); g.add(l);
            }
            const stand = box(0.08, 0.12, 0.08, 0x6b7075); stand.position.set(-0.08, 0.6, -0.18); g.add(stand);
            const monitor = box(0.46, 0.32, 0.05, 0x1b2b33); monitor.position.set(-0.08, 0.81, -0.18); g.add(monitor);
            const screen = box(0.38, 0.24, 0.02, 0x35d0ff, { transparent: true, opacity: 0.85 });
            screen.position.set(-0.08, 0.81, -0.14); screen.userData.spin = true; g.add(screen);
            const keys = box(0.34, 0.03, 0.14, 0xdfe3e5); keys.position.set(-0.08, 0.55, 0.06); g.add(keys);
            const paper = box(0.18, 0.012, 0.22, 0xf4ede0); paper.position.set(0.3, 0.55, 0.02); g.add(paper);
            const mug = cyl(0.05, 0.05, 0.1, 8, 0xd88a5a); mug.position.set(0.34, 0.59, -0.2); g.add(mug);
        } else if (e.type === 'analyzer') {
            // cabFace used to be computed from fh/2 (half the whole footprint) instead of the
            // cabinet box's own half-depth (fh-0.2)/2 — it landed the screen and its status glow
            // *inside* the solid cabinet, fully hidden behind its own front face rather than on it.
            const cab = box(fw - 0.2, 1.0, fh - 0.2, col); cab.position.y = 0.57; g.add(cab);
            const cabFace = (fh - 0.2) / 2;
            const scr = box(fw * 0.5, 0.42, 0.06, 0x11333a); scr.position.set(0, 0.7, cabFace + 0.04); g.add(scr);
            const glow = box(fw * 0.42, 0.3, 0.02, 0x35d0ff, { transparent: true, opacity: 0.85 });
            glow.position.set(0, 0.7, cabFace + 0.11); glow.userData.spin = true; g.add(glow);
        } else if (e.type === 'fridge' || e.type === 'freezer') {
            // The cabinet stops short of the door, leaving a shallow recess with lit shelves and
            // vials in it. A solid block would have shown a blank wall behind the open door —
            // there has to be somewhere for the door to reveal.
            const bodyH = 1.3 + (fh - 1) * 0.15;
            const zDoor = fh / 2 - 0.14, RECESS = 0.18;
            const back = -(fh / 2 - 0.1), front = zDoor - RECESS;
            const body = box(fw - 0.2, bodyH, front - back, col);
            body.position.set(0, bodyH / 2, (front + back) / 2); g.add(body);
            // Everything in the recess is kept inside the area the shut door covers, or you'd see
            // shelves poking out around its edges with the fridge closed.
            const dwF = fw - 0.34, doorH = bodyH - 0.4;
            const inW = dwF - 0.08, inTop = bodyH / 2 + doorH / 2 - 0.05, inBot = bodyH / 2 - doorH / 2 + 0.05;
            const inner = box(inW, inTop - inBot, 0.03, e.type === 'freezer' ? 0xbfe0ef : 0xe8f1f5);
            inner.position.set(0, (inTop + inBot) / 2, front + 0.02); g.add(inner);
            const chill = box(inW - 0.05, inTop - inBot - 0.05, 0.02, e.type === 'freezer' ? 0x8fd3f0 : 0xcfe8f2, { transparent: true, opacity: 0.45 });
            chill.position.set(0, (inTop + inBot) / 2, front + 0.05); g.add(chill);
            // Frame around the opening. The recess is a full-width gap in the front of the
            // cabinet, so with the door shut you could still see into it over the door's top edge
            // from this camera angle — these panels close everything except the doorway itself.
            const frameW = (fw - 0.2 - dwF) / 2, zMid = (front + zDoor) / 2;
            const lintelH = bodyH - (bodyH / 2 + doorH / 2);
            if (lintelH > 0.01) { const m = box(fw - 0.2, lintelH, RECESS, col); m.position.set(0, bodyH - lintelH / 2, zMid); g.add(m); }
            const sillH = bodyH / 2 - doorH / 2;
            if (sillH > 0.01) { const m = box(fw - 0.2, sillH, RECESS, col); m.position.set(0, sillH / 2, zMid); g.add(m); }
            if (frameW > 0.01) for (const sx of [-1, 1]) {
                const m = box(frameW, doorH, RECESS, col);
                m.position.set(sx * (dwF + frameW) / 2, bodyH / 2, zMid); g.add(m);
            }
            const VIAL = [0xe0555f, 0x77c97b, 0x5b8de8, 0xf1d34a];
            for (let i = 0; i < 3; i++) {
                const y = inBot + 0.08 + i * (inTop - inBot - 0.2) / 2;
                const shelf = box(inW - 0.04, 0.03, RECESS - 0.06, 0x9aa2a8);
                shelf.position.set(0, y, front + RECESS / 2); g.add(shelf);
                for (let k = 0; k < 3; k++) {
                    const vial = box(0.06, 0.12, 0.06, VIAL[(i * 3 + k) % VIAL.length]);
                    vial.position.set(-(inW - 0.16) / 2 + k * (inW - 0.16) / 2, y + 0.075, front + RECESS / 2); g.add(vial);
                }
            }
            // The door hangs off a hinge post down its left edge so it swings out of the way while
            // a scientist is actually shelving something, instead of being a painted-on panel.
            const dw = fw - 0.34;
            const hinge = new THREE.Group();
            hinge.position.set(-dw / 2, body.position.y, fh / 2 - 0.14);
            hinge.userData.hingeAxis = 'y';
            hinge.userData.hingeOpen = HINGE_OPEN.cold;
            hinge.userData.hingeTarget = 0;                  // starts shut
            g.add(hinge); g.userData.hinge = hinge;
            const door = box(dw, bodyH - 0.4, 0.06, 0xffffff); door.position.set(dw / 2, 0, 0); hinge.add(door);
            const h2 = box(0.06, 0.34, 0.06, 0x8a9196); h2.position.set(dw - 0.07, 0, 0.04); hinge.add(h2);
            const fr = box(0.5, 0.12, 0.05, e.type === 'freezer' ? 0x2fa8d8 : 0x9fd6e6);
            fr.position.set(dw / 2, bodyH - 0.2 - body.position.y, 0); hinge.add(fr);
        } else if (e.type === 'mopcloset') {
            // Broom and bucket used to sit far enough forward (and the tilted broom's swing far
            // enough) that both poked out through the closet's own front face instead of reading
            // as "propped in front of it". Body is a touch shallower and both props sit clearly
            // forward of its face now, with an unambiguous gap instead of a clipped seam.
            const body = box(0.68, 1.2, 0.58, col); body.position.y = 0.66; g.add(body);   // half-depth 0.29
            const handle = box(0.045, 0.82, 0.045, 0x6b4a2a); handle.position.set(0.2, 0.85, 0.42); handle.rotation.x = -0.12; g.add(handle);
            const bucket = cyl(0.15, 0.13, 0.19, 8, 0xf0c040); bucket.position.set(-0.2, 0.235, 0.46); g.add(bucket);
        } else if (e.type === 'sink') {
            // The basin used to sit at the same height as the counter (top faces exactly
            // coincident, overlapping footprints) — a textbook top-down z-fight. It's now
            // properly recessed below the counter surface, like a real inset basin, with a
            // visible rim gap instead of a shared plane.
            const counterTop = 0.55;
            const counter = box(0.85, 0.1, 0.6, 0xd8dde1); counter.position.y = counterTop - 0.05; g.add(counter);
            for (const [x, z] of [[.36, .24], [-.36, .24], [.36, -.24], [-.36, -.24]]) {
                const l = box(0.07, 0.46, 0.07, 0x8a9196); l.position.set(x, 0.24, z); g.add(l);
            }
            const basinTop = counterTop - 0.09;
            const basin = box(0.55, 0.12, 0.36, col); basin.position.y = basinTop - 0.06; g.add(basin);
            const faucet = box(0.06, 0.32, 0.06, 0x9aa2a8); faucet.position.set(0, 0.7, -0.22); g.add(faucet);
            const spout = box(0.06, 0.06, 0.2, 0x9aa2a8); spout.position.set(0, 0.85, -0.13); g.add(spout);
            const drip = box(0.05, 0.05, 0.05, 0x8be0f0, { transparent: true, opacity: 0.85 });
            drip.position.set(0, basinTop + 0.02, -0.05); g.add(drip);
        } else if (e.type === 'scale') {
            const base = box(0.6, 0.1, 0.5, col); base.position.y = 0.35; g.add(base);
            for (const [x, z] of [[.22, .18], [-.22, .18], [.22, -.18], [-.22, -.18]]) {
                const l = box(0.05, 0.32, 0.05, 0x8a9196); l.position.set(x, 0.19, z); g.add(l);
            }
            const pan = cyl(0.18, 0.18, 0.02, 12, 0xdfe3e5); pan.position.y = 0.41; g.add(pan);
            const disp = box(0.22, 0.1, 0.04, 0x11333a); disp.position.set(0, 0.55, 0.24); g.add(disp);
            const num = box(0.16, 0.05, 0.01, 0x37ff8a, { transparent: true, opacity: 0.85 });
            num.position.set(0, 0.55, 0.265); num.userData.spin = true; g.add(num);
        } else if (e.type === 'flowhood' || e.type === 'fumehood') {
            // Enclosed on all four sides — the whole point of either cabinet is containment, so a
            // hood open on the sides would defeat it. The front panel stops short of the counter,
            // leaving a gap to reach through instead of a full wall, same as a real sash/glovebox.
            const isFume = e.type === 'fumehood';
            const glassCol = isFume ? 0x9aa2a8 : 0xcfe8f2, glassOp = isFume ? 0.45 : 0.35;
            const base = box(0.85, 0.5, 0.85, col); base.position.y = 0.28; g.add(base);
            const counterTop = 0.53, hoodY = 1.03, gap = 0.16;
            const frontBottom = counterTop + gap;
            const midEnclosure = (counterTop + hoodY) / 2, enclosureH = hoodY - counterTop;
            const front = box(0.68, hoodY - frontBottom, 0.03, glassCol, { transparent: true, opacity: glassOp });
            front.position.set(0, (frontBottom + hoodY) / 2, 0.34); g.add(front);
            const back = box(0.68, enclosureH, 0.03, glassCol, { transparent: true, opacity: glassOp });
            back.position.set(0, midEnclosure, -0.34); g.add(back);
            const left = box(0.03, enclosureH, 0.7, glassCol, { transparent: true, opacity: glassOp });
            left.position.set(0.34, midEnclosure, 0); g.add(left);
            const right = box(0.03, enclosureH, 0.7, glassCol, { transparent: true, opacity: glassOp });
            right.position.set(-0.34, midEnclosure, 0); g.add(right);
            for (const [x, z] of [[0.34, 0.34], [-0.34, 0.34], [0.34, -0.34], [-0.34, -0.34]]) {
                const post = box(0.035, enclosureH, 0.035, 0x6b7075); post.position.set(x, midEnclosure, z); g.add(post);
            }
            if (isFume) {
                const stripe = box(0.87, 0.05, 0.03, 0xf0c040); stripe.position.set(0, counterTop - 0.03, 0.435); g.add(stripe);
                // Capped off on top, same as the Flow Hood — an extraction cabinet open to the
                // room above the sash wouldn't contain anything. The duct rises out of the lid.
                const lid = box(0.8, 0.12, 0.8, 0xb8c2c6); lid.position.y = hoodY + 0.06; g.add(lid);
                const glassTop = box(0.66, 0.02, 0.66, glassCol, { transparent: true, opacity: glassOp });
                glassTop.position.y = hoodY - 0.01; g.add(glassTop);
                const duct = cyl(0.13, 0.13, 0.45, 10, 0x8a9196); duct.position.y = 1.32; g.add(duct);
                const cap = cyl(0.16, 0.16, 0.05, 10, 0x6b7075); cap.position.y = 1.56; g.add(cap);
            } else {
                const hood = box(0.8, 0.2, 0.8, 0xe8ebed); hood.position.y = 1.08; g.add(hood);
                const filterGlow = box(0.6, 0.03, 0.6, 0x8be0c0, { transparent: true, opacity: 0.8 });
                filterGlow.position.y = 1.19; g.add(filterGlow);
            }
        } else if (e.type === 'chromatograph') {
            const cabFace = (fh - 0.2) / 2;
            const cab = box(fw - 0.2, 0.9, fh - 0.2, col); cab.position.y = 0.5; g.add(cab);
            // A glass separation column with a colored band standing in for the mobile phase —
            // the one part of the machine that's visibly "chemistry" rather than just a cabinet.
            const column = cyl(0.06, 0.06, 0.55, 10, 0xd8dde1, { transparent: true, opacity: 0.55 });
            column.position.set(fw * 0.18, 1.05, 0); g.add(column);
            const liquid = cyl(0.05, 0.05, 0.4, 10, 0x5b8de8); liquid.position.set(fw * 0.18, 0.95, 0); g.add(liquid);
            const scr = box(fw * 0.36, 0.3, 0.05, 0x11333a); scr.position.set(-fw * 0.15, 0.75, cabFace + 0.03); g.add(scr);
            const trace = box(fw * 0.3, 0.2, 0.02, 0x37ff8a, { transparent: true, opacity: 0.85 });
            trace.position.set(-fw * 0.15, 0.75, cabFace + 0.08); trace.userData.spin = true; g.add(trace);
        }

        if (e.id != null) this._applyEquipTransform(g, e);
        return g;
    }
    _applyEquipTransform(g, e) {
        const c = equipCenterWorld(e.type, e.tx, e.tz, e.rot);
        g.userData.target = { x: c.x, y: 0, z: c.z };
        g.position.set(c.x, 0, c.z);
        g.rotation.y = -e.rot * Math.PI / 2;
        g.userData.rot = e.rot;
        g.userData.tx = e.tx; g.userData.tz = e.tz;
    }
    _syncTray(g, e) {
        const tray = g.userData.tray;
        // Staged samples (dimmed — waiting on a fuller batch or their turn) render alongside
        // actively running ones (full color), one item per sample either way — a solo run is
        // just a processing entry with one id in it, same as a batch with several. Each item's
        // shape follows the same tube/slide/report logic as the loose sample mesh (see
        // appearanceForCap) — samples used to always render as a plain tube dot here regardless
        // of stage, so a report waiting to be analyzed on the bench looked like it had reverted
        // to a fresh sample the moment it got staged there.
        const items = [];
        for (const st of (e.staged || [])) items.push({ proto: st.proto, cap: st.cap, dim: true });
        for (const p of (e.processing || [])) {
            const ids = p.sampleIds || (p.sampleId != null ? [p.sampleId] : []);
            for (let i = 0; i < ids.length; i++) items.push({ proto: p.proto, cap: p.cap, dim: false });
        }
        const sig = items.map(it => `${it.proto}:${it.cap}:${it.dim}`).join('|');
        if (tray.userData.sig === sig) return;   // nothing about the contents actually changed
        tray.userData.sig = sig;
        while (tray.children.length) tray.remove(tray.children[0]);
        // A centrifuge loads its tubes around a rotor, not in rows: space them evenly around the
        // circle (always over at least 4 positions, so a half-empty rotor still reads as balanced)
        // and lean each one outwards the way a fixed-angle rotor holds them. The holder carries
        // the position and facing, the cell inside it carries the lean, so the two can't fight
        // over Euler order.
        const radial = e.type === 'centrifuge';
        items.forEach((it, i) => {
            const cell = new THREE.Group();
            if (radial) {
                const a = (i / Math.max(items.length, 4)) * Math.PI * 2;
                const holder = new THREE.Group();
                holder.position.set(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2);
                holder.rotation.y = -a;              // local +X now points outward
                cell.rotation.z = -0.3;              // tip the tube out over the rotor's edge
                holder.add(cell);
                tray.add(holder);
            } else {
                cell.position.set(-0.24 + (i % 3) * 0.24, 0, -0.1 + Math.floor(i / 3) * 0.24);
                tray.add(cell);
            }
            this._fillTrayItem(cell, it);
        });
    }
    _fillTrayItem(cell, it) {
        const base = new THREE.Color(PROTO_COLOR[it.proto] || 0xffffff);
        const tint = hex => (it.dim ? new THREE.Color(hex).lerp(new THREE.Color(0x888888), 0.55) : new THREE.Color(hex)).getHex();
        const protoCol = (it.dim ? base.clone().lerp(new THREE.Color(0x888888), 0.55) : base).getHex();
        const appearance = appearanceForCap(it.cap);
        if (appearance === 'slide') {
            const glass = box(0.16, 0.014, 0.07, tint(0xcfe3ea), { transparent: true, opacity: 0.8 });
            glass.position.y = 0.05; cell.add(glass);
            const smear = box(0.06, 0.015, 0.04, protoCol); smear.position.y = 0.058; cell.add(smear);
        } else if (appearance === 'report') {
            const paper = box(0.14, 0.012, 0.18, tint(0xf4ede0)); paper.position.y = 0.05; cell.add(paper);
            const stamp = box(0.04, 0.013, 0.04, protoCol); stamp.position.set(0.04, 0.057, 0.05); cell.add(stamp);
        } else {
            const t = box(0.12, 0.28, 0.12, protoCol); cell.add(t);
        }
    }

    _buildSample(s) {
        const g = new THREE.Group();
        g.userData = { kind: 'sample', id: s.id };
        this._fillSample(g, s);
        return g;
    }
    // (Re)builds a sample's visible form for whatever it's currently headed toward. Called once
    // at creation and again whenever its step (and so its appearance category) changes — most
    // samples never trigger the second case at all, only ones on a chain that passes through
    // image or analyze.
    _fillSample(g, s) {
        while (g.children.length) g.remove(g.children[0]);
        const appearance = sampleAppearance(s);
        g.userData.appearance = appearance;
        const c = PROTO_COLOR[s.proto] || 0xffffff;
        if (appearance === 'slide') {
            // A microscope slide: thin glass with the mounted specimen showing through, plus a
            // little paper label stuck on one end.
            const glass = box(0.34, 0.02, 0.14, 0xcfe3ea, { transparent: true, opacity: 0.8 });
            glass.position.y = 0.09; g.add(glass);
            const smear = box(0.12, 0.022, 0.08, c); smear.position.set(-0.05, 0.101, 0); g.add(smear);
            const label = box(0.09, 0.021, 0.13, 0xf4ede0); label.position.set(0.12, 0.1, 0); g.add(label);
        } else if (appearance === 'report') {
            // A written-up report on a clipboard, on its way to be analyzed at a desk — flat
            // paper with a couple of ruled lines and a proto-colored result stamp.
            const board = box(0.28, 0.02, 0.36, 0x8a6a4a); board.position.y = 0.08; g.add(board);
            const paper = box(0.24, 0.015, 0.3, 0xf4ede0); paper.position.y = 0.095; g.add(paper);
            const line1 = box(0.16, 0.016, 0.018, 0x9a9184); line1.position.set(0, 0.1, -0.08); g.add(line1);
            const line2 = box(0.16, 0.016, 0.018, 0x9a9184); line2.position.set(0, 0.1, -0.03); g.add(line2);
            const stamp = box(0.07, 0.017, 0.07, c); stamp.position.set(0.07, 0.1, 0.09); g.add(stamp);
        } else {
            const tube = box(0.22, 0.34, 0.22, c); tube.position.y = 0.17; g.add(tube);
            const cap = box(0.26, 0.08, 0.26, 0xffffff); cap.position.y = 0.37; g.add(cap);
        }
    }

    _buildStaff(s) {
        const g = new THREE.Group();
        g.userData = { kind: 'staff', id: s.id, facing: 0, mopping: false };
        const body = new THREE.Group();
        const skinCol = s.skin ?? 0xf0c9a4, hairCol = s.hairColor ?? 0x3b2a1d;
        const legs = box(0.26, 0.3, 0.2, 0x394a63); legs.position.y = 0.15;
        const coat = box(0.34, 0.42, 0.24, COAT_COLOR); coat.position.y = 0.52;
        const head = box(0.22, 0.22, 0.22, skinCol); head.position.y = 0.85;
        const hair = box(0.24, 0.08, 0.24, hairCol); hair.position.y = 0.97;
        body.add(legs, coat, head, hair);
        if (s.hairLong) {
            // Hangs down the back of the head rather than just capping it — same hair color,
            // assigned once at hiring alongside the short/long choice so it doesn't change look
            // from one render to the next.
            const hairBack = box(0.2, 0.26, 0.1, hairCol); hairBack.position.set(0, 0.78, -0.15);
            body.add(hairBack);
        }

        // Held mop, hidden except while actively mopping (animated in the render loop below) —
        // this is how "currently cleaning" reads now, instead of tinting the whole coat.
        const mop = new THREE.Group();
        const handle = box(0.045, 0.72, 0.045, 0x8a6339); handle.position.y = 0.36; mop.add(handle);
        const head2 = box(0.16, 0.12, 0.1, 0xe4dfd2); head2.position.y = -0.02; mop.add(head2);
        mop.position.set(0.2, 0.42, 0.14);
        mop.rotation.z = 0.4;
        mop.visible = false;
        body.add(mop);

        g.userData.body = body; g.userData.coat = coat; g.userData.mop = mop;
        g.add(body);

        // Chatter state — the bubble itself is a DOM element (see _syncSpeechBubbles), not a 3D
        // sprite: the whole scene renders at low internal resolution for the pixel-art look,
        // which makes any text baked into a texture come out blurry/illegible.
        g.userData.chatterText = null;
        g.userData.chatterEligible = false;
        g.userData.radioEligible = false;
        g.userData.chatterUntil = 0;
        g.userData.nextChatterRoll = 0;
        return g;
    }

    // ---------- reconcile ----------
    sync(state, dt) {
        // Simulated movement is scaled by game speed (tick() feeds staff/samples dt*speed), but this
        // lerp factor was only ever based on real wall-clock dt — so at 2x/3x speed the true position
        // raced ahead each frame while the render crept after it in a straight line, cutting corners
        // through walls on longer walks (rather than tracking the tile-by-tile legal path). Scaling
        // the catch-up rate by speed too keeps the render's lag roughly constant at any speed.
        const a = 1 - Math.exp(-LERP_K * Math.min(dt, 0.1) * (state.speed || 1));

        this._updateFloor(state);

        // Rooms live in state.equipment (they're bought, sold and saved like anything else) but
        // they're drawn by _updateFloor as floor, so they get no mesh here — which also keeps them
        // out of _pick()'s raycast, so clicking inside one lands on the tile and you can actually
        // build there.
        this._reconcile(this.equipMeshes, state.equipment.filter(e => !BUILD[e.type].room), e => this._buildEquip(e), (mesh, e) => {
            // Position as well as rotation: the Move tool changes tx/tz without touching rot, and
            // checking rot alone left the mesh sitting at its old spot until the page reloaded.
            if (mesh.userData.rot !== e.rot || mesh.userData.tx !== e.tx || mesh.userData.tz !== e.tz)
                this._applyEquipTransform(mesh, e);
            this._syncTray(mesh, e);
            const all = e.processing || [];
            const busy = all.length > 0;
            mesh.traverse(o => { if (o.userData.spin) o.visible = busy; });
            // The burner is only alight for prep work — not for an analysis run on the same bench.
            const prepping = all.some(pp => typeof pp.cap === 'string' && pp.cap.startsWith('prep'));
            mesh.userData.prepping = prepping;
            mesh.traverse(o => { if (o.userData.flame) o.visible = prepping; });
            // Cold-storage "slots" (dur: Infinity — a sample just parked in a fridge) don't
            // represent an actual running step, so they're excluded here: no progress bar, no
            // centrifuge spin for a machine that isn't really doing anything timed.
            const timed = all.filter(p => Number.isFinite(p.dur));
            mesh.userData.timedBusy = timed.length > 0;
            // Hinged parts: a centrifuge lid is shut exactly while the rotor is turning, a cold
            // store's door is open exactly while somebody is stood at it shelving something.
            const hinge = mesh.userData.hinge;
            if (hinge) {
                let open;
                if (hinge.userData.hingeAxis === 'y') {
                    // Watch for something actually landing in the machine rather than for a worker
                    // standing at it: a drop-off is over inside one tick, so the worker's state has
                    // already been cleared by the time this runs. Shelving into a cold store is the
                    // one case with a real dwell, so that's caught by state as well. Either way the
                    // door is then held open a beat so the swing is visible.
                    const load = (e.staged ? e.staged.length : 0) + (e.processing ? e.processing.length : 0);
                    const arrived = load > (mesh.userData.lastLoad ?? load);
                    mesh.userData.lastLoad = load;
                    const atIt = state.staff.some(w => w.job && w.job.stationId === e.id && w.state === 'storing');
                    if (arrived || atIt) mesh.userData.doorHold = this.elapsed + 1.4;
                    open = atIt || this.elapsed < (mesh.userData.doorHold || 0);
                } else {
                    open = !mesh.userData.timedBusy;        // centrifuge lid: shut while it spins
                }
                hinge.userData.hingeTarget = open ? hinge.userData.hingeOpen : 0;
            }
            mesh.userData.progress = timed.length
                ? timed.reduce((sum, p) => sum + Math.min(1, p.t / p.dur), 0) / timed.length
                : null;

            // Reliability light: red and blinking once broken (can't accept new work until a
            // mechanic fixes it), steady amber once worn enough that a breakdown becomes a real
            // risk, otherwise hidden — most machines spend most of their life not showing this.
            const wl = mesh.userData.warnLight;
            if (e.broken) {
                wl.visible = Math.sin(this.elapsed * 9) > -0.2;
                wl.material.color.setHex(0xe0454a);
            } else if ((e.condition ?? 100) < COND_BREAKDOWN_THRESHOLD) {
                wl.visible = true;
                wl.material.color.setHex(0xf0a03c);
            } else {
                wl.visible = false;
            }
        });

        // A sample sitting in cold storage keeps state 'queued' (so decay/retrieval logic treats
        // it the same as one waiting in the lobby) but shouldn't render as one — the fridge/
        // freezer already shows its contents via the same tray-dot system every other machine
        // uses (see _syncTray), positioned correctly on the unit itself. Rendering this too used
        // to also place a full loose sample mesh out at the access tile the worker stood on to
        // reach the fridge — nowhere near the fridge, and redundant with the tray dot besides.
        const vis = state.samples.filter(s => (s.state === 'queued' && !s.storedAt) || s.state === 'carried');
        this._reconcile(this.sampleMeshes, vis, s => this._buildSample(s), (mesh, s) => {
            const appearance = sampleAppearance(s);
            if (mesh.userData.appearance !== appearance) this._fillSample(mesh, s);
            mesh.userData.carried = s.state === 'carried';
            if (s.state === 'carried') {
                // Used to sit at head height dead-center on the worker (y=0.7, x/z matching
                // theirs exactly) — looked like it was floating inside their skull. Now offset
                // to the carrier's side at roughly hand height, using their current facing so it
                // stays on the same side of their body as they turn. A Sample Cart trip carries
                // several at once — stacking them by height alone put a second tube's midpoint
                // below the first tube's top, so they clipped straight through each other; spread
                // them along a row perpendicular to the carry direction instead, all level, so a
                // full cart reads as several distinct tubes rather than one glowing blob.
                const carrier = state.staff.find(w => Array.isArray(w.carrying) && w.carrying.includes(s.id));
                const carrierMesh = carrier && this.staffMeshes.get(carrier.id);
                const facing = carrierMesh ? carrierMesh.userData.facing : 0;
                const idx = carrier ? carrier.carrying.indexOf(s.id) : 0;
                const n = carrier ? carrier.carrying.length : 1;
                mesh.userData.facing = facing;
                const hx = Math.cos(facing) * 0.21, hz = -Math.sin(facing) * 0.21;
                // Each tube is 0.22 wide — spacing needs to clear that even in the worst-case
                // orientation (the row axis running diagonally across a tube's square footprint,
                // ~0.31 corner-to-corner), not just the straight-on 0.22.
                const rowAngle = facing + Math.PI / 2;
                const rx = Math.cos(rowAngle) * 0.32, rz = -Math.sin(rowAngle) * 0.32;
                const spread = idx - (n - 1) / 2;
                mesh.userData.target = { x: s.wx + hx + rx * spread, y: 0.56, z: s.wz + hz + rz * spread };
            } else {
                mesh.userData.target = { x: s.wx, y: 0.14, z: s.wz };
            }
        });

        // Pathfinding only reasons about tiles, so every worker waiting on a busy machine walks to
        // the same access tile. Fan them out into a little queue extending away from the machine
        // instead of letting them render stacked on top of each other.
        const waitGroups = new Map();   // stationId -> worker ids waiting there, stable order
        for (const w of state.staff) {
            if (w.state !== 'atStation' || !w.job || w.job.stationId == null) continue;
            if (!waitGroups.has(w.job.stationId)) waitGroups.set(w.job.stationId, []);
            waitGroups.get(w.job.stationId).push(w.id);
        }
        for (const arr of waitGroups.values()) arr.sort((x, y) => x - y);

        this._reconcile(this.staffMeshes, state.staff, s => this._buildStaff(s), (mesh, s) => {
            let tx = s.wx, tz = s.wz;
            const group = s.state === 'atStation' && s.job ? waitGroups.get(s.job.stationId) : null;
            const idx = group ? group.indexOf(s.id) : -1;
            if (idx > 0) {
                const st = state.equipment.find(e => e.id === s.job.stationId);
                if (st) {
                    // Fan out at a fixed radius small enough to stay inside the worker's own tile —
                    // a wall sits exactly at the tile edge (0.5 away), so this can never cross one.
                    // Growing the radius with queue length (as an earlier version did) could push a
                    // waiting worker straight through a nearby wall.
                    const QUEUE_R = 0.4;
                    const c = equipCenterWorld(st.type, st.tx, st.tz, st.rot);
                    const baseAng = Math.atan2(s.wz - c.z, s.wx - c.x);
                    const side = idx % 2 === 0 ? -1 : 1;
                    const ang = baseAng + side * Math.ceil(idx / 2) * 0.85;
                    tx = s.wx + Math.cos(ang) * QUEUE_R;
                    tz = s.wz + Math.sin(ang) * QUEUE_R;
                }
            }
            mesh.userData.target = { x: tx, y: 0, z: tz };
            // Anchor for the wall-safety clamp below — only while genuinely stationary. A worker
            // walking at 2x/3x game speed can legitimately lag its render-lerped position by more
            // than half a tile (the lerp has no notion of game speed), so clamping movers too would
            // make fast-forward staff visibly snap around instead of walking smoothly.
            mesh.userData.truePos = STATIONARY_STATES.has(s.state) ? { x: s.wx, z: s.wz } : null;
            mesh.userData.mopping = s.state === 'mopping';
            const idling = s.state === 'idle' || s.state === 'resting';
            const cm = this.coffeeMachine.position;
            mesh.userData.chatterEligible = idling && Math.hypot(s.wx - cm.x, s.wz - cm.z) < 2.0;
            mesh.userData.radioEligible = idling && state.upgrades.radio > 0;
        });
        if (this.radioProp) this.radioProp.visible = state.upgrades.radio > 0;

        // dirt overlays
        const seen = new Set();
        for (const k in state.dirt) {
            seen.add(k);
            const v = state.dirt[k];
            let m = this.dirtMeshes.get(k);
            if (!m) {
                m = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.92),
                    new THREE.MeshBasicMaterial({ color: 0x3a2f1e, transparent: true, opacity: 0.3 }));
                m.rotation.x = -Math.PI / 2;
                const [x, z] = k.split(',').map(Number);
                const w = tileToWorld(x, z);
                m.position.set(w.x, 0.02, w.z);
                this.scene.add(m);
                this.dirtMeshes.set(k, m);
            }
            m.material.opacity = Math.min(0.6, 0.12 + v / 60 * 0.5);
        }
        for (const [k, m] of this.dirtMeshes) if (!seen.has(k)) { this.scene.remove(m); this.dirtMeshes.delete(k); }

        const step = (mesh) => {
            const t = mesh.userData.target; if (!t) return null;
            const dx = t.x - mesh.position.x, dz = t.z - mesh.position.z;
            mesh.position.x += dx * a; mesh.position.y += (t.y - mesh.position.y) * a; mesh.position.z += dz * a;
            return { dx, dz };
        };
        this.equipMeshes.forEach((mesh) => {
            step(mesh);
            // A centrifuge runs through the whole sequence rather than doing everything at once:
            // the lid comes down first, the rotor only winds up once it's actually shut, and when
            // the run ends the rotor coasts to a stop before the lid is allowed back open —
            // hingeInterlock is what holds it down in the meantime, the way a real one locks.
            const hinge = mesh.userData.hinge;
            let spinning = false;
            mesh.traverse(o => { if (o.userData.spinAnim && (o.userData.spinVel || 0) > 0) spinning = true; });
            let lidShut = true;
            if (hinge) {
                const ud = hinge.userData;
                const target = (ud.hingeInterlock && spinning) ? 0 : ud.hingeTarget;
                const k = Math.min(1, dt * HINGE_SPEED);
                hinge.rotation[ud.hingeAxis] += (target - hinge.rotation[ud.hingeAxis]) * k;
                lidShut = Math.abs(hinge.rotation[ud.hingeAxis]) < 0.05;
            }
            const wantSpin = mesh.userData.timedBusy && lidShut;
            mesh.traverse(o => {
                if (o.userData.spinAnim) {
                    // Ease toward full speed instead of snapping to it, so it visibly spins up
                    // after the lid lands and spins down afterwards.
                    const goal = wantSpin ? (o.userData.spinRate || 9) : 0;
                    const v = o.userData.spinVel || 0;
                    let next = v + (goal - v) * Math.min(1, dt * 3);
                    // Easing alone only ever approaches zero, leaving the rotor creeping forever
                    // and the lid interlock never satisfied — call it stopped once it's slower
                    // than the eye can follow.
                    if (!goal && next < 0.3) next = 0;
                    o.userData.spinVel = next;
                    o.rotation.y += dt * next;
                }
                // Prep Robot gantry: slides back and forth along its rail while a run is
                // active, instead of just sitting there with a blinking light.
                if (o.userData.flame && o.visible) {
                    const f = 1 + Math.sin(this.elapsed * 13 + o.position.y * 40) * 0.22;
                    o.scale.set(1 + (f - 1) * 0.35, f, 1 + (f - 1) * 0.35);
                }
                if (o.userData.gantrySlide && mesh.userData.timedBusy)
                    o.position.x = Math.sin(this.elapsed * 2.6) * o.userData.gantryRange;
            });
        });
        this.sampleMeshes.forEach((mesh, id) => {
            step(mesh);
            if (mesh.userData.carried) {
                // Held rigidly rather than idly spinning/bobbing — it's in a hand, not sitting
                // on a rack.
                mesh.rotation.y = mesh.userData.facing || 0;
                mesh.children[0].position.y = 0.17;
            } else {
                mesh.rotation.y += dt * 1.5;
                mesh.children[0].position.y = 0.17 + Math.sin(this.elapsed * 4 + id) * 0.03;
            }
        });
        this.staffMeshes.forEach((mesh) => {
            const d = step(mesh);
            const moving = d && (Math.abs(d.dx) + Math.abs(d.dz)) > 0.003;
            if (moving) {
                const want = Math.atan2(d.dx, d.dz);
                let diff = want - mesh.userData.facing;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                mesh.userData.facing += diff * 0.25;
                mesh.rotation.y = mesh.userData.facing;
            }
            mesh.userData.body.position.y = moving ? Math.abs(Math.sin(this.elapsed * 10)) * 0.06 : 0;
            const mop = mesh.userData.mop;
            mop.visible = mesh.userData.mopping;
            if (mesh.userData.mopping) mop.rotation.z = 0.15 + Math.abs(Math.sin(this.elapsed * 6.5)) * 0.75;
            this._updateChatter(mesh);
        });
        this._separateStaff();
        this._syncSpeechBubbles();
        this._syncProgressBars();

        if (this.hoverTile && (!this.tool || this.tool === 'demolish' || this.tool === 'rotate')) {
            const w = tileToWorld(this.hoverTile.tx, this.hoverTile.tz);
            this.hoverRing.position.set(w.x, 0.05, w.z);
            this.hoverRing.visible = true;
        } else this.hoverRing.visible = false;
    }

    // Idle chatter: rolls a small chance per tick to pop up a speech bubble while a worker is
    // eligible (near the coffee machine, or anywhere once the radio's been bought), and clears
    // it again once its time is up. Purely cosmetic — none of this touches game state. The bubble
    // itself is a DOM element positioned in _syncSpeechBubbles(), not rendered here.
    _updateChatter(mesh) {
        const ud = mesh.userData;
        if (ud.chatterText && this.elapsed > ud.chatterUntil) ud.chatterText = null;
        if (ud.chatterText || this.elapsed < ud.nextChatterRoll) return;
        ud.nextChatterRoll = this.elapsed + 0.4;
        if (!ud.chatterEligible && !ud.radioEligible) return;
        if (Math.random() >= 0.05) return;
        let pool;
        if (ud.chatterEligible && ud.radioEligible) pool = [COFFEE_QUOTES, RADIO_QUOTES, LAB_QUOTES][Math.floor(Math.random() * 3)];
        else if (ud.chatterEligible) pool = Math.random() < 0.65 ? COFFEE_QUOTES : LAB_QUOTES;
        else pool = Math.random() < 0.65 ? RADIO_QUOTES : LAB_QUOTES;
        ud.chatterText = pool[Math.floor(Math.random() * pool.length)];
        ud.chatterUntil = this.elapsed + 3 + Math.random() * 1.5;
    }

    // Projects every currently-chattering worker's head position to screen space and positions a
    // real DOM element there — crisp at any zoom, unlike a texture baked into the low-res 3D pass.
    // Same trick as the speech bubbles: project the anchor point above each busy machine to screen
    // space and park a real DOM bar there. Crisp at any zoom, and readable from every camera angle
    // rather than turning edge-on when the view swings round.
    _syncProgressBars() {
        if (!this._barEls) this._barEls = new Map();
        const rect = this.container.getBoundingClientRect();
        const seen = new Set();
        const v = new THREE.Vector3();
        this.equipMeshes.forEach((mesh, id) => {
            const pct = mesh.userData.progress;
            if (pct == null) return;
            v.set(mesh.position.x, mesh.userData.barY, mesh.position.z);
            v.project(this.camera);
            if (v.z > 1) return;                     // behind the camera
            seen.add(id);
            let el = this._barEls.get(id);
            if (!el) {
                el = document.createElement('div');
                el.className = 'task-bar';
                el.appendChild(document.createElement('i'));
                this.container.appendChild(el);
                this._barEls.set(id, el);
            }
            el.style.left = ((v.x * 0.5 + 0.5) * rect.width) + 'px';
            el.style.top = ((1 - (v.y * 0.5 + 0.5)) * rect.height) + 'px';
            el.firstChild.style.width = Math.round(Math.max(0, Math.min(1, pct)) * 100) + '%';
        });
        for (const [id, el] of this._barEls) {
            if (!seen.has(id)) { el.remove(); this._barEls.delete(id); }
        }
    }

    _syncSpeechBubbles() {
        if (!this._bubbleEls) this._bubbleEls = new Map();
        const rect = this.container.getBoundingClientRect();
        const seen = new Set();
        const v = new THREE.Vector3();
        this.staffMeshes.forEach((mesh, id) => {
            const ud = mesh.userData;
            if (!ud.chatterText) return;
            v.set(mesh.position.x, 1.35, mesh.position.z);
            v.project(this.camera);
            if (v.z > 1) return;                     // behind the camera
            seen.add(id);
            const x = (v.x * 0.5 + 0.5) * rect.width;
            const y = (1 - (v.y * 0.5 + 0.5)) * rect.height;
            let el = this._bubbleEls.get(id);
            if (!el) {
                el = document.createElement('div');
                el.className = 'speech-bubble';
                this.container.appendChild(el);
                this._bubbleEls.set(id, el);
            }
            if (el.textContent !== ud.chatterText) el.textContent = ud.chatterText;
            el.style.left = x + 'px';
            el.style.top = y + 'px';
        });
        for (const [id, el] of this._bubbleEls) {
            if (!seen.has(id)) { el.remove(); this._bubbleEls.delete(id); }
        }
    }

    // Pathfinding only reasons about tiles, so two workers queued at the same machine both walk
    // to the same access tile and would render stacked on each other. This nudges any staff that
    // end up too close apart each frame — a lightweight crowd-separation pass, purely cosmetic,
    // so waiting staff visibly stand aside instead of overlapping.
    _separateStaff() {
        const meshes = Array.from(this.staffMeshes.values());
        const MIN_DIST = 0.46, PUSH = 0.5;
        // Remember where everyone was before any nudging, so the clamp below can limit what this
        // pass moved without also fighting the render's legitimate lag behind a walking worker.
        for (const mesh of meshes) mesh.userData._preSep = { x: mesh.position.x, z: mesh.position.z };
        for (let i = 0; i < meshes.length; i++) {
            for (let j = i + 1; j < meshes.length; j++) {
                const a = meshes[i], b = meshes[j];
                let dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
                let d = Math.hypot(dx, dz);
                if (d >= MIN_DIST) continue;
                if (d < 1e-4) {
                    // exactly coincident — pick a deterministic direction so they don't jitter randomly
                    const ang = ((a.userData.id * 2654435761) % 360) * Math.PI / 180;
                    dx = Math.cos(ang); dz = Math.sin(ang); d = 1;
                }
                const push = (MIN_DIST - d) * PUSH;
                const nx = dx / d, nz = dz / d;
                a.position.x -= nx * push; a.position.z -= nz * push;
                b.position.x += nx * push; b.position.z += nz * push;
            }
        }
        // Cap how far the nudging above is allowed to shift anyone. This used to only apply to
        // workers in a stationary state, which left idle and resting ones unclamped — exactly the
        // ones that pile up together in the break room, where being shoved a whole tile sideways
        // pushed them straight out through its walls. Clamping the nudge itself (rather than the
        // distance to their simulated position) keeps them inside while still letting the render
        // trail a worker who's genuinely mid-walk at 3x speed.
        const MAX_NUDGE = 0.22;
        for (const mesh of meshes) {
            const p = mesh.userData._preSep; if (!p) continue;
            const dx = mesh.position.x - p.x, dz = mesh.position.z - p.z;
            const d = Math.hypot(dx, dz);
            if (d > MAX_NUDGE) {
                const k = MAX_NUDGE / d;
                mesh.position.x = p.x + dx * k;
                mesh.position.z = p.z + dz * k;
            }
        }
    }

    _reconcile(map, list, create, update) {
        const seen = new Set();
        for (const item of list) {
            seen.add(item.id);
            let mesh = map.get(item.id);
            const isNew = !mesh;
            if (isNew) { mesh = create(item); this.scene.add(mesh); map.set(item.id, mesh); }
            update && update(mesh, item);
            if (isNew && mesh.userData.target) {
                // Snap straight to the real spot instead of lerping in from three.js's (0,0,0)
                // default — a fresh mesh "flying in" from the map's origin would cut through
                // whatever walls sit between there and its actual tile.
                const t = mesh.userData.target;
                mesh.position.set(t.x, t.y, t.z);
            }
        }
        for (const [id, mesh] of map) if (!seen.has(id)) { this.scene.remove(mesh); map.delete(id); }
    }

    _resize() {
        this._w = this.container.clientWidth || window.innerWidth;
        this._h = this.container.clientHeight || window.innerHeight;
        this.renderer.setSize(this._w * RES_SCALE, this._h * RES_SCALE, false);
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        if (this.camera) {
            const aspect = this._w / this._h;
            this.camera.left = -this.frustum * aspect;
            this.camera.right = this.frustum * aspect;
            this.camera.top = this.frustum;
            this.camera.bottom = -this.frustum;
            this.camera.updateProjectionMatrix();
        }
    }

    // Snaps the camera's compass heading to the nearest 90°-step "corner" view. Called
    // automatically once a drag ends; also reachable directly via rotateView() for the
    // explicit rotate-left/rotate-right controls.
    _nearestStep(angle) {
        const STEP = Math.PI / 2;
        return this._azBase + Math.round((angle - this._azBase) / STEP) * STEP;
    }
    _snapAzimuth() {
        this._startAzTween(this._nearestStep(this.controls.getAzimuthalAngle()));
    }
    rotateView(dir) {
        // Chaining off the queued destination (below) tracks where the view is *headed*
        // correctly across a rapid double-tap, but "from" is read fresh as the camera's actual
        // current angle each call — and between two presses close enough together that no
        // render frame has landed in between, the camera hasn't physically moved at all yet.
        // The result: "to" keeps marching forward a full step per press while "from" stays put,
        // so the tween span grows with every extra press but its duration doesn't — a handful of
        // fast presses could queue up a many-hundred-degree sweep to cover in the same ~0.28s,
        // reading as the view spinning wildly rather than stepping. A short cooldown sidesteps
        // the whole problem by simply not letting a new step start that fast to begin with.
        const now = this.elapsed;
        if (this._lastRotateInput != null && now - this._lastRotateInput < ROTATE_COOLDOWN) return;
        this._lastRotateInput = now;
        const STEP = Math.PI / 2;
        // Chain off the queued destination if a snap/step is already mid-flight, so a quick
        // double-tap of the rotate button always lands two full steps away rather than
        // fighting the tween in progress.
        const base = this._azTween ? this._azTween.to : this._nearestStep(this.controls.getAzimuthalAngle());
        this._startAzTween(base + dir * STEP);
    }
    // A fast drag-release leaves damped rotational momentum (OrbitControls' internal
    // sphericalDelta) decaying across several future update() calls — left alone, that
    // leftover keeps nudging the camera on top of our tween every frame, since update() always
    // re-applies it regardless of who else is driving the camera. Toggling damping off for one
    // update() call applies 100% of whatever's left and then clears it, instead of trickling it
    // out — so the tween starts from the camera's true resting angle and nothing fights it after.
    _drainMomentum() {
        const wasDamping = this.controls.enableDamping;
        this.controls.enableDamping = false;
        this.controls.update();
        this.controls.enableDamping = wasDamping;
    }
    _startAzTween(to) {
        this._drainMomentum();
        const from = this.controls.getAzimuthalAngle();
        if (Math.abs(to - from) < 0.001) return;
        this._azTween = {
            from, to,
            polar: this.controls.getPolarAngle(),
            radius: this.camera.position.distanceTo(this.controls.target),
            t: 0, dur: 0.28
        };
    }
    _updateAzTween(dt) {
        const tw = this._azTween;
        if (!tw) return;
        tw.t = Math.min(1, tw.t + dt / tw.dur);
        const e = 1 - Math.pow(1 - tw.t, 3);   // ease-out cubic
        const az = tw.from + (tw.to - tw.from) * e;
        const offset = new THREE.Vector3().setFromSphericalCoords(tw.radius, tw.polar, az);
        this.camera.position.copy(this.controls.target).add(offset);
        if (tw.t >= 1) this._azTween = null;
    }

    _animate() {
        requestAnimationFrame(() => this._animate());
        const dt = Math.min(this.clock.getDelta(), 0.1);
        this.elapsed += dt;
        if (this.onFrame) this.onFrame(dt);
        this._updateAzTween(dt);
        this._updatePanKeys(dt);
        // Panning has no built-in limit in OrbitControls, so a long drag could otherwise pan the
        // target straight out into the dark void past the lab. Clamped before update() so the
        // camera position it computes this frame already reflects the corrected target.
        this.controls.target.x = Math.max(-this.panBounds, Math.min(this.panBounds, this.controls.target.x));
        this.controls.target.z = Math.max(-this.panBounds, Math.min(this.panBounds, this.controls.target.z));
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}

export default LabScene;
