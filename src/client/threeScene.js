import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BUILD, ZONES } from './data.js';
import {
    GRID, BUILD_MAX_Z, BREAK_ROOM, COFFEE_TILE, WATER_COOLER_TILE, VENDING_TILE, TABLE_TILE,
    tileToWorld, footTiles, zoneAt, gateXRange
} from './grid.js';

const HALF = GRID / 2;
const RES_SCALE = 0.36;
const LERP_K = 9;

// States where the worker is genuinely standing still (never calls stepPath in staff.js) — used
// to gate the wall-safety clamp below without fighting legitimate walking lag at 2x/3x speed.
// Notably excludes 'idle' and 'resting': both can still be mid-walk toward a rest tile.
const STATIONARY_STATES = new Set(['mopping', 'atStation', 'tending', 'prepping', 'filling']);
const PROTO_COLOR = { blood: 0xe0555f, tissue: 0x77c97b, chem: 0x5b8de8, virus: 0xf1d34a, dna: 0xb06cd9 };
// Real lab equipment is mostly steel/white/grey — samples and status lights carry the color instead.
// The mop closet stays warm/wood-toned since it's furniture, not clinical equipment.
const EQUIP_COLOR = {
    bench: 0xc4cdd2, microscope: 0x585e63, centrifuge: 0xe8ebed, incubator: 0xd6dadd,
    analyzer: 0xdfe3e5, fridge: 0xf2f4f5, freezer: 0xd7dee0, mopcloset: 0xd88a5a, sink: 0xc9ced3
};

// Idle chatter around the break room. Coffee/radio lines only fire in their own context
// (by the coffee machine, or once the radio's been bought); lab lines are always fair game.
const COFFEE_QUOTES = ["This coffee is terrible.", "Who finished the pot?!", "Is this even decaf?", "We need a coffee run.", "Cold again...", "Whose mug is this?"];
const RADIO_QUOTES = ["Who changed the station?!", "Not this song again...", "Who turned it up?!", "Put the jazz back on.", "Way too loud!", "Can we agree on ONE station?"];
const LAB_QUOTES = ["Where are my goggles?", "Is it Friday yet?", "I mislabeled a tube...", "Who moved my clipboard?", "Five more minutes...", "This centrifuge is cursed.", "Did I turn off the burner?"];

// Height to float each type's progress bar at, clear of its own model.
const BAR_Y = {
    bench: 0.85, microscope: 1.3, centrifuge: 0.95, incubator: 1.45, analyzer: 1.25,
    fridge: 1.5, freezer: 1.65, sink: 0.8, mopcloset: 1.45
};

function lmat(c, e = {}) { return new THREE.MeshLambertMaterial({ color: c, ...e }); }
function box(w, h, d, c, e) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lmat(c, e)); }
function cyl(rt, rb, h, s, c) { return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, s), lmat(c)); }

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
        this._buildBreakRoom();
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
                if (!corridor && !zone) continue;
                const light = (tx + tz) % 2 === 0;
                const inBreakRoom = tx >= BREAK_ROOM.x0 && tx < BREAK_ROOM.x0 + BREAK_ROOM.w &&
                    tz >= BREAK_ROOM.z0 && tz < BREAK_ROOM.z0 + BREAK_ROOM.h;
                const col = inBreakRoom ? (light ? 0xe8d3ab : 0xdcc294)               // warm break-room floor
                    : corridor ? (light ? 0xdfe6d8 : 0xd2d9c9) : (light ? 0xf3efe3 : 0xe3ddcc);
                const t = box(0.98, 0.12, 0.98, col);
                const w = tileToWorld(tx, tz);
                t.position.set(w.x, -0.06, w.z);
                t.userData = { kind: 'tile', tx, tz, zoneId: zone ? zone.id : null, light, isBreakRoom: inBreakRoom };
                fg.add(t);
                this.floorTiles.push(t);
            }
        }
        this.scene.add(fg);

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
        const isWall = (nx, nz) => {
            if (nx < 0 || nx >= GRID || nz < 0) return true;
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
                const tx = edge === 'west' ? xMin : edge === 'east' ? xMax : cx;
                const tz = edge === 'north' ? zMin : edge === 'south' ? zMax : cz;
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
    _updateZones(state) {
        const key = state.ownedZones.slice().sort().join(',');
        if (key === this._zonesKey) return;
        this._zonesKey = key;
        for (const zone of ZONES) {
            const owned = state.ownedZones.includes(zone.id);
            const rec = this.zoneFences.get(zone.id);
            if (rec) rec.group.visible = !owned;
            for (const t of this.floorTiles) {
                if (t.userData.zoneId !== zone.id || t.userData.isBreakRoom) continue;
                const light = t.userData.light;
                t.material.color.setHex(owned ? (light ? 0xf3efe3 : 0xe3ddcc) : (light ? 0x9fae86 : 0x8fa078));
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
    _buildBreakRoom() {
        const cW = tileToWorld(COFFEE_TILE[0], COFFEE_TILE[1]);
        const g = new THREE.Group();
        const counter = box(0.8, 0.55, 0.6, 0x8a6a4a); counter.position.y = 0.275; g.add(counter);
        const top = box(0.84, 0.06, 0.64, 0x6b4a2a); top.position.y = 0.58; g.add(top);
        const machine = box(0.3, 0.38, 0.22, 0x33383c); machine.position.set(-0.16, 0.8, 0); g.add(machine);
        const pot = cyl(0.09, 0.1, 0.2, 10, 0x1c1f22); pot.position.set(-0.16, 0.66, 0.16); g.add(pot);
        const potHandle = box(0.03, 0.1, 0.03, 0x1c1f22); potHandle.position.set(-0.02, 0.66, 0.16); g.add(potHandle);
        const warmLight = box(0.04, 0.02, 0.04, 0xff6a3c); warmLight.position.set(-0.16, 0.94, -0.06); g.add(warmLight);
        const mug1 = cyl(0.05, 0.05, 0.09, 8, 0xe4dfd2); mug1.position.set(0.16, 0.63, 0.12); g.add(mug1);
        const mug2 = cyl(0.05, 0.05, 0.09, 8, 0xc0564a); mug2.position.set(0.27, 0.63, -0.05); g.add(mug2);
        g.position.set(cW.x, 0, cW.z);
        this.scene.add(g);
        this.coffeeMachine = g;

        const r = new THREE.Group();
        const body = box(0.22, 0.14, 0.12, 0xc23b2e); body.position.y = 0.07; r.add(body);
        const speakerL = cyl(0.045, 0.045, 0.02, 10, 0x2a2a2a); speakerL.rotation.x = Math.PI / 2; speakerL.position.set(-0.06, 0.07, 0.061); r.add(speakerL);
        const speakerR = cyl(0.045, 0.045, 0.02, 10, 0x2a2a2a); speakerR.rotation.x = Math.PI / 2; speakerR.position.set(0.06, 0.07, 0.061); r.add(speakerR);
        const antenna = box(0.015, 0.22, 0.015, 0x8a9196); antenna.position.set(0.08, 0.22, 0); antenna.rotation.z = 0.3; r.add(antenna);
        r.position.set(cW.x + 0.28, 0.58, cW.z - 0.16);
        r.visible = false;
        this.scene.add(r);
        this.radioProp = r;

        // Water cooler
        const wcW = tileToWorld(WATER_COOLER_TILE[0], WATER_COOLER_TILE[1]);
        const wc = new THREE.Group();
        const wcStand = box(0.28, 0.48, 0.28, 0xe8ebed); wcStand.position.y = 0.24; wc.add(wcStand);
        const wcBottle = cyl(0.15, 0.17, 0.42, 10, 0x8ecbe8, { transparent: true, opacity: 0.7 });
        wcBottle.position.y = 0.69; wc.add(wcBottle);
        const wcCap = cyl(0.06, 0.06, 0.05, 8, 0x33383c); wcCap.position.y = 0.91; wc.add(wcCap);
        const wcSpout = box(0.05, 0.05, 0.06, 0x33383c); wcSpout.position.set(0.1, 0.44, 0.12); wc.add(wcSpout);
        wc.position.set(wcW.x, 0, wcW.z);
        this.scene.add(wc);

        // Vending machine — a few "snack" blocks glimpsed behind the glass front
        const vW = tileToWorld(VENDING_TILE[0], VENDING_TILE[1]);
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
        vm.position.set(vW.x, 0, vW.z);
        vm.rotation.y = Math.PI;   // sits against the south wall — front needs to face into the room
        this.scene.add(vm);

        // Small round table with two stools
        const tW = tileToWorld(TABLE_TILE[0], TABLE_TILE[1]);
        const tbl = new THREE.Group();
        const tableTop = cyl(0.3, 0.3, 0.05, 12, 0x8a6a4a); tableTop.position.y = 0.5; tbl.add(tableTop);
        const tableLeg = cyl(0.05, 0.05, 0.48, 8, 0x6b4a2a); tableLeg.position.y = 0.26; tbl.add(tableLeg);
        for (const [dx, dz] of [[0.42, 0], [-0.42, 0]]) {
            const stoolSeat = cyl(0.14, 0.14, 0.06, 10, 0xd88a5a);
            stoolSeat.position.set(dx, 0.32, dz); tbl.add(stoolSeat);
            const stoolLeg = cyl(0.035, 0.035, 0.3, 8, 0x6b4a2a);
            stoolLeg.position.set(dx, 0.16, dz); tbl.add(stoolLeg);
        }
        tbl.position.set(tW.x, 0, tW.z);
        this.scene.add(tbl);

        this._buildBreakRoomWalls();
    }
    // Low partition walls (shorter than the main building's) on three sides of the break room,
    // leaving the east side open as its doorway onto the main floor.
    _buildBreakRoomWalls() {
        const w0 = tileToWorld(BREAK_ROOM.x0, BREAK_ROOM.z0);
        const w1 = tileToWorld(BREAK_ROOM.x0 + BREAK_ROOM.w - 1, BREAK_ROOM.z0 + BREAK_ROOM.h - 1);
        const xMin = w0.x - 0.5, xMax = w1.x + 0.5, zMin = w0.z - 0.5, zMax = w1.z + 0.5;
        const cx = (xMin + xMax) / 2, cz = (zMin + zMax) / 2;
        const wallMat = lmat(0xc9ced3), trimMat = lmat(0x97a1aa);
        const H = 0.85;
        const seg = (len, x, z, horizontal) => {
            const w = horizontal ? len : 0.16, d = horizontal ? 0.16 : len;
            const g = new THREE.Group();
            const b = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), wallMat); b.position.y = H / 2;
            const tr = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, 0.1, d + 0.05), trimMat); tr.position.y = H + 0.04;
            g.add(b, tr); g.position.set(x, 0, z); this.scene.add(g);
        };
        seg(xMax - xMin, cx, zMin, true);    // north
        seg(xMax - xMin, cx, zMax, true);    // south
        seg(zMax - zMin, xMin, cz, false);   // west
        // east intentionally open — the doorway into the main floor
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
        const base = box(fw - 0.12, 0.14, fh - 0.12, 0x40474d); base.position.y = 0.07;
        g.add(base);
        const tray = new THREE.Group(); tray.position.y = 0.62; g.userData.tray = tray; g.add(tray);

        // Progress bar, floating above the machine while it's actively running a timed step
        // (hidden otherwise, and not shown at all for cold-storage "slots" — see sync()).
        const BAR_W = 0.56;
        const barBg = box(BAR_W + 0.06, 0.09, 0.03, 0x2a2f33);
        const fgGeo = new THREE.BoxGeometry(BAR_W, 0.055, 0.035);
        fgGeo.translate(BAR_W / 2, 0, 0);                    // pivot at the left edge so it fills left-to-right
        const barFg = new THREE.Mesh(fgGeo, lmat(0x54d67a));
        barFg.position.set(-BAR_W / 2, 0, 0.005);
        const barGroup = new THREE.Group();
        barGroup.add(barBg, barFg);
        barGroup.position.set(0, BAR_Y[e.type] || 1.4, 0);
        barGroup.visible = false;
        g.add(barGroup);
        g.userData.progressFg = barFg;
        g.userData.progressGroup = barGroup;

        if (e.type === 'bench') {
            const top = box(0.85, 0.16, 0.85, col); top.position.y = 0.52; g.add(top);
            for (const [x, z] of [[.32, .32], [-.32, .32], [.32, -.32], [-.32, -.32]]) {
                const l = box(0.08, 0.46, 0.08, 0x6b7075); l.position.set(x, 0.25, z); g.add(l);
            }
            const shelf = box(0.7, 0.1, 0.16, 0xdedede); shelf.position.set(0, 0.72, -0.32); g.add(shelf);
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
            const body = cyl(0.4, 0.44, 0.5, 12, col); body.position.y = 0.38; g.add(body);
            const lid = cyl(0.32, 0.4, 0.14, 12, 0x33383c); lid.position.y = 0.66; g.add(lid);
            // A rotationally-symmetric cylinder spinning wouldn't actually look like it's moving —
            // this bar (and the two tube stubs on it) gives the spin something visibly asymmetric
            // to show, only rotating while a slot is actually running.
            const rotor = new THREE.Group(); rotor.position.y = 0.735; rotor.userData.spinAnim = true; g.add(rotor);
            const bar = box(0.3, 0.025, 0.055, 0x8a9196); rotor.add(bar);
            const stub1 = cyl(0.035, 0.035, 0.05, 8, 0xe8ebed); stub1.position.set(0.13, 0.03, 0); rotor.add(stub1);
            const stub2 = cyl(0.035, 0.035, 0.05, 8, 0xe8ebed); stub2.position.set(-0.13, 0.03, 0); rotor.add(stub2);
            const lt = box(0.08, 0.08, 0.08, 0x37ff8a); lt.position.set(0.28, 0.52, 0.3); lt.userData.spin = true; g.add(lt);
        } else if (e.type === 'incubator') {
            // Door and window used to sit almost exactly coplanar with the body's front face and
            // with each other, which z-fights (flickers) at most camera angles — each layer now
            // gets a clear, deliberate gap so nothing shares a depth.
            const bodyFace = fh / 2 - 0.075;                 // body spans to fh/2; stop comfortably short
            const body = box(fw - 0.15, 1.2, fh - 0.15, col); body.position.y = 0.66; g.add(body);
            const door = box(fw - 0.3, 0.85, 0.05, 0xeef1f2); door.position.set(0, 0.6, bodyFace); g.add(door);
            const win = box(0.36, 0.34, 0.03, 0x8be0c0, { transparent: true, opacity: 0.8 });
            win.position.set(0, 0.78, bodyFace + 0.07); g.add(win);
            const handle = box(0.05, 0.34, 0.05, 0x6b7075);
            handle.position.set(fw / 2 - 0.3, 0.5, bodyFace + 0.03); g.add(handle);
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
            const body = box(fw - 0.2, 1.3 + (fh - 1) * 0.15, fh - 0.2, col);
            body.position.y = body.geometry.parameters.height / 2; g.add(body);
            const door = box(fw - 0.34, body.geometry.parameters.height - 0.4, 0.06, 0xffffff);
            door.position.set(0, body.position.y, fh / 2 - 0.14); g.add(door);
            const h2 = box(0.06, 0.34, 0.06, 0x8a9196); h2.position.set(fw / 2 - 0.24, body.position.y, fh / 2 - 0.1); g.add(h2);
            const fr = box(0.5, 0.12, 0.05, e.type === 'freezer' ? 0x2fa8d8 : 0x9fd6e6);
            fr.position.set(0, body.geometry.parameters.height - 0.2, fh / 2 - 0.14); g.add(fr);
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
    }
    _syncTray(g, e) {
        const tray = g.userData.tray;
        const items = (e.processing || []);
        while (tray.children.length < items.length) {
            const t = box(0.12, 0.28, 0.12, 0xffffff);
            tray.add(t);
        }
        while (tray.children.length > items.length) tray.remove(tray.children[tray.children.length - 1]);
        tray.children.forEach((t, i) => {
            const p = items[i];
            t.material.color.setHex(PROTO_COLOR[p.proto] || 0xffffff);
            t.position.set(-0.24 + (i % 3) * 0.24, 0, -0.1 + Math.floor(i / 3) * 0.24);
        });
    }

    _buildSample(s) {
        const g = new THREE.Group();
        g.userData = { kind: 'sample', id: s.id };
        const c = PROTO_COLOR[s.proto] || 0xffffff;
        const tube = box(0.22, 0.34, 0.22, c); tube.position.y = 0.17;
        const cap = box(0.26, 0.08, 0.26, 0xffffff); cap.position.y = 0.37;
        g.add(tube, cap);
        return g;
    }

    _buildStaff(s) {
        const g = new THREE.Group();
        g.userData = { kind: 'staff', id: s.id, facing: 0, mopping: false };
        const body = new THREE.Group();
        const legs = box(0.26, 0.3, 0.2, 0x394a63); legs.position.y = 0.15;
        const coatCol = s.role === 'clean' ? 0x3fb6a8 : 0xf2f4f7;
        const coat = box(0.34, 0.42, 0.24, coatCol); coat.position.y = 0.52;
        const head = box(0.22, 0.22, 0.22, 0xf0c9a4); head.position.y = 0.85;
        const hair = box(0.24, 0.08, 0.24, 0x3b2a1d); hair.position.y = 0.97;
        body.add(legs, coat, head, hair);

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

        this._updateZones(state);

        this._reconcile(this.equipMeshes, state.equipment, e => this._buildEquip(e), (mesh, e) => {
            if (mesh.userData.rot !== e.rot) this._applyEquipTransform(mesh, e);
            this._syncTray(mesh, e);
            const all = e.processing || [];
            const busy = all.length > 0;
            mesh.traverse(o => { if (o.userData.spin) o.visible = busy; });
            // Cold-storage "slots" (dur: Infinity — a sample just parked in a fridge) don't
            // represent an actual running step, so they're excluded here: no progress bar, no
            // centrifuge spin for a machine that isn't really doing anything timed.
            const timed = all.filter(p => Number.isFinite(p.dur));
            mesh.userData.timedBusy = timed.length > 0;
            if (timed.length) {
                const avg = timed.reduce((sum, p) => sum + Math.min(1, p.t / p.dur), 0) / timed.length;
                mesh.userData.progressFg.scale.x = Math.max(0.001, avg);
            }
            mesh.userData.progressGroup.visible = timed.length > 0;
        });

        const vis = state.samples.filter(s => s.state === 'queued' || s.state === 'carried');
        this._reconcile(this.sampleMeshes, vis, s => this._buildSample(s), (mesh, s) => {
            mesh.userData.carried = s.state === 'carried';
            if (s.state === 'carried') {
                // Used to sit at head height dead-center on the worker (y=0.7, x/z matching
                // theirs exactly) — looked like it was floating inside their skull. Now offset
                // to the carrier's side at roughly hand height, using their current facing so it
                // stays on the same side of their body as they turn.
                const carrier = state.staff.find(w => w.carrying === s.id);
                const carrierMesh = carrier && this.staffMeshes.get(carrier.id);
                const facing = carrierMesh ? carrierMesh.userData.facing : 0;
                mesh.userData.facing = facing;
                const hx = Math.cos(facing) * 0.21, hz = -Math.sin(facing) * 0.21;
                mesh.userData.target = { x: s.wx + hx, y: 0.56, z: s.wz + hz };
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
            // Coat color is a stable identity marker (dedicated cleaner vs. anyone else), not a
            // moment-to-moment activity indicator — the mop swinging (below) shows that instead.
            mesh.userData.coat.material.color.setHex(s.role === 'clean' ? 0x3fb6a8 : 0xf2f4f7);
            mesh.userData.mopping = s.state === 'mopping';
            const idling = s.state === 'idle' || s.state === 'resting';
            const cm = this.coffeeMachine.position;
            mesh.userData.chatterEligible = idling && Math.hypot(s.wx - cm.x, s.wz - cm.z) < 2.0;
            mesh.userData.radioEligible = idling && state.upgrades.radio > 0;
        });
        this.radioProp.visible = state.upgrades.radio > 0;

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
            if (mesh.userData.timedBusy) {
                mesh.traverse(o => { if (o.userData.spinAnim) o.rotation.y += dt * 9; });
            }
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
        // Belt and braces: whatever cosmetic nudging happened above (or the queue fan-out before
        // it), a worker's rendered spot can never end up outside their own tile — a wall sits
        // exactly half a tile from its centre, so this makes stepping through one impossible.
        const MAX_DRIFT = 0.46;
        for (const mesh of meshes) {
            const anchor = mesh.userData.truePos; if (!anchor) continue;
            const dx = mesh.position.x - anchor.x, dz = mesh.position.z - anchor.z;
            const d = Math.hypot(dx, dz);
            if (d > MAX_DRIFT) {
                const k = MAX_DRIFT / d;
                mesh.position.x = anchor.x + dx * k;
                mesh.position.z = anchor.z + dz * k;
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
