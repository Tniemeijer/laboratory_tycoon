// ==================== ACCIDENTS: FIRE, OUTBREAK, LAWSUITS ====================
// The downside of skipping maintenance. Every one of these starts from the same place — a machine
// that finished a run in poor condition — and every one of them is *survivable if you react*, so
// the whole module is built around giving the player something to do about it rather than just
// docking them money:
//
//   fire      — spreads to neighbours on a timer, destroys what it burns, and kills staff who
//               stay near it. You evacuate and call the brigade; a Fire Alarm does both for you
//               if it's been serviced.
//   outbreak  — only in a Containment Lab. Seals the room, may infect whoever was inside, and
//               stays sealed until a disinfection crew has been in.
//   lawsuit   — what a death actually costs. Settle, fight it, or ignore it and get judged.
//
// Nothing in here is on the payroll: the brigade and the crew are both called in, like the
// mechanic, which is why staff.js knows nothing about any of it beyond "am I evacuating".

import {
    BUILD,
    FIRE_COND_THRESHOLD, FIRE_CHANCE_MAX, FIRE_SPREAD_RADIUS, FIRE_SPREAD_INTERVAL, FIRE_SPREAD_CHANCE,
    FIRE_DESTROY_TIME, FIRE_BRIGADE_ETA, FIRE_BRIGADE_FEE, FIRE_HURT_RADIUS, FIRE_HURT_TIME,
    FIRE_DEATH_CHANCE, FIRE_REP_PENALTY, ALARM_MIN_RELIABILITY, ALARM_MAX_RELIABILITY,
    OUTBREAK_COND_THRESHOLD, OUTBREAK_CHANCE_MAX, OUTBREAK_INFECT_CHANCE, ILLNESS_DAYS,
    DISINFECT_FEE, OUTBREAK_REP_PENALTY, ALARM_DECAY_PER_DAY,
    LAWSUIT_BASE, LAWSUIT_VAR, LAWSUIT_DAYS, LAWSUIT_SETTLE_FACTOR, LAWSUIT_WIN_CHANCE,
    LAWSUIT_LEGAL_FEE, LAWSUIT_LOSS_MULT, DEATH_REP_PENALTY
} from '../data.js';
import { G, nid, dirtyUI, bumpNav } from '../core.js';
import { GRID, footTiles, tileToWorld, worldToTile, roomAreas, roomGroups, roomDoorways, isWalkableGround } from '../grid.js';
import { clearVisitors, spawnFireCrew, spawnCleanCrew } from './visitors.js';

// ---------- shared helpers ----------
function machines(s) {
    return s.equipment.filter(e => BUILD[e.type] && !BUILD[e.type].room && !BUILD[e.type].door);
}
function tilesOf(e) { return footTiles(e.type, e.tx, e.tz, e.rot); }
function centerOf(e) {
    const t = tilesOf(e);
    let x = 0, z = 0;
    for (const [tx, tz] of t) { const w = tileToWorld(tx, tz); x += w.x; z += w.z; }
    return { x: x / t.length, z: z / t.length };
}
// Chebyshev distance between two footprints, in tiles, "within 2 tiles" means any tile of one is
// within 2 of any tile of the other, not centre-to-centre, so a big machine genuinely is a bigger
// target.
function tileGap(a, b) {
    let best = Infinity;
    for (const [ax, az] of tilesOf(a))
        for (const [bx, bz] of tilesOf(b))
            best = Math.min(best, Math.max(Math.abs(ax - bx), Math.abs(az - bz)));
    return best;
}
function abandonAll(e) {
    if (!G.abandonSample) return;
    for (const p of (e.processing || []).slice())
        for (const sid of (p.sampleIds || [p.sampleId])) G.abandonSample(sid);
    for (const g of (e.staged || []).slice()) G.abandonSample(g.sampleId);
    e.processing = []; e.staged = []; e.reserved = 0;
}

// ---------- fire ----------
export function burningIds() { return new Set((G.state.fires || []).map(f => f.equipId)); }
export function isBurning(e) { return (G.state.fires || []).some(f => f.equipId === e.id); }
export function fireAlarms() {
    return G.state.equipment.filter(e => BUILD[e.type] && BUILD[e.type].mount);
}
// A neglected alarm is close to useless; a freshly-serviced one nearly always goes off. Only the
// best alarm in the building is rolled. A second one doesn't make the first more reliable, it
// just means there's a better one somewhere.
export function alarmReliability() {
    const best = fireAlarms().reduce((m, e) => Math.max(m, (e.condition ?? 100)), -1);
    if (best < 0) return 0;
    return ALARM_MIN_RELIABILITY + (ALARM_MAX_RELIABILITY - ALARM_MIN_RELIABILITY) * (best / 100);
}

export function startFire(e, silent) {
    const s = G.state;
    s.fires ||= [];
    if (s.fires.some(f => f.equipId === e.id)) return false;
    s.fires.push({ equipId: e.id, t: 0, spreadT: 0 });
    abandonAll(e);
    for (const w of s.staff) if (w.job && (w.job.stationId === e.id || w.job.operateId === e.id)) G.releaseWorkerJob(w);
    if (!silent) {
        s.stats.fires = (s.stats.fires || 0) + 1;
        G.onToast(`FIRE, ${BUILD[e.type].name} is alight!`, true);
        // The alarm's whole job: doing this for you while you're looking at another screen.
        if (!s.evacuating && Math.random() < alarmReliability()) {
            G.onToast('Fire alarm — evacuating and calling the brigade', true);
            evacuate();
            callFireBrigade(true);
        }
    }
    dirtyUI();
    return true;
}
// Rolled once per completed run, alongside the breakdown check. See equipment.js applyWear().
export function fireRoll(st) {
    const cond = st.condition ?? 100;
    if (cond >= FIRE_COND_THRESHOLD || isBurning(st)) return;
    const chance = (FIRE_COND_THRESHOLD - cond) / FIRE_COND_THRESHOLD * FIRE_CHANCE_MAX;
    if (Math.random() < chance) startFire(st);
}

export function evacuate() {
    const s = G.state;
    if (s.evacuating) return;
    s.evacuating = true;
    // Contractors leave too. Nobody is servicing a centrifuge while the building burns. Whatever
    // they hadn't got to is still broken and still on the mechanic's list, so it costs the
    // call-out fee to have them back, not the work itself.
    clearVisitors((s.visitors || []).length ? 'The mechanic downed tools and left' : null);
    G.onToast('Evacuating — everyone out');
    dirtyUI();
}
// Hook rather than an import: visitors.js needs to call this when the last fire is out, and it
// already imports this module's spawners the other way round — see G.abandonSample for the same
// pattern used to keep the system modules acyclic.
export function endEvacuation() {
    const s = G.state;
    if (!s.evacuating) return;
    s.evacuating = false;
    for (const w of s.staff) if (w.state === 'evacuating' || w.state === 'evacuatingDone') { w.state = 'idle'; w.path = null; }
    dirtyUI();
}
G.endEvacuation = endEvacuation;

export function callFireBrigade(silent) {
    const s = G.state;
    if (s.brigadeEta != null) return;
    if (!(s.fires || []).length) { if (!silent) G.onToast('Nothing is on fire', true); return; }
    s.brigadeEta = FIRE_BRIGADE_ETA;
    if (!silent) G.onToast(`Fire brigade on the way, $${FIRE_BRIGADE_FEE.toLocaleString()} call-out`);
    dirtyUI();
}
function burnOut(f) {
    const s = G.state;
    const e = s.equipment.find(x => x.id === f.equipId);
    s.fires = s.fires.filter(x => x !== f);
    if (!e) return;
    abandonAll(e);
    s.equipment = s.equipment.filter(x => x !== e);
    for (const w of s.staff) if (w.reservedStation === e.id) G.releaseWorkerJob(w);
    bumpNav();
    G.onToast(`${BUILD[e.type].name} burned out. Total loss`, true);
    s.reputation = Math.max(0, s.reputation - FIRE_REP_PENALTY);
}

// ---------- death & lawsuits ----------
function killWorker(w, cause) {
    const s = G.state;
    G.releaseWorkerJob(w);
    s.staff = s.staff.filter(x => x !== w);
    s.stats.deaths = (s.stats.deaths || 0) + 1;
    s.reputation = Math.max(0, s.reputation - DEATH_REP_PENALTY);
    G.onToast(`${w.name} died in the ${cause}.`, true);
    s.lawsuits ||= [];
    s.lawsuits.push({
        id: nid(), name: w.name, cause,
        claim: LAWSUIT_BASE + Math.round(Math.random() * LAWSUIT_VAR),
        filed: s.day, deadline: s.day + LAWSUIT_DAYS
    });
    dirtyUI();
}
export function settlementOf(l) { return Math.round(l.claim * LAWSUIT_SETTLE_FACTOR); }
export function settleLawsuit(id) {
    const s = G.state;
    const l = (s.lawsuits || []).find(x => x.id === id);
    if (!l) return;
    const amount = settlementOf(l);
    s.money -= amount;
    s.lawsuits = s.lawsuits.filter(x => x !== l);
    G.onToast(`Settled with ${l.name}'s family for $${amount.toLocaleString()}`);
    dirtyUI();
}
// Fighting is the gamble: legal fees either way, and losing costs more than settling ever would.
// Going quiet until the deadline runs out fights it anyway, just without the lawyer.
export function fightLawsuit(id, byDefault) {
    const s = G.state;
    const l = (s.lawsuits || []).find(x => x.id === id);
    if (!l) return;
    s.lawsuits = s.lawsuits.filter(x => x !== l);
    const fee = byDefault ? 0 : LAWSUIT_LEGAL_FEE;
    const won = !byDefault && Math.random() < LAWSUIT_WIN_CHANCE;
    if (won) {
        s.money -= fee;
        G.onToast(`Court found for the lab over ${l.name}, $${fee.toLocaleString()} in fees`);
    } else {
        const cost = Math.round(l.claim * LAWSUIT_LOSS_MULT) + fee;
        s.money -= cost;
        s.reputation = Math.max(0, s.reputation - DEATH_REP_PENALTY / 2);
        G.onToast(`Lost the ${l.name} case, $${cost.toLocaleString()} in damages`, true);
    }
    dirtyUI();
}

// ---------- outbreak ----------
// Which connected run of containment floor this machine is standing in — the breach seals that
// whole room, not just the tile the machine happens to occupy.
function containGroupFor(e) {
    const tiles = roomAreas(G.state).get('contain');
    if (!tiles) return null;
    const mine = new Set(tilesOf(e).map(([x, z]) => `${x},${z}`));
    for (const group of roomGroups(tiles)) if (group.some(k => mine.has(k))) return group;
    return null;
}
// Where the people inside end up when it seals: out through one of the room's own doorways if it
// has one, otherwise the nearest walkable tile that isn't part of the room — a room can be sealed
// with no door at all (the player never placed one), and being sealed in it is not a fair death.
function roomExit(group) {
    const s = G.state;
    const tiles = new Set(group);
    for (const d of roomDoorways(s, tiles, 'contain')) {
        const [key, dir] = d.split('|');
        const [x, z] = key.split(',').map(Number);
        const [dx, dz] = dir.split(',').map(Number);
        if (isWalkableGround(s, x + dx, z + dz)) return [x + dx, z + dz];
    }
    for (let r = 1; r < GRID; r++) {
        for (const key of group) {
            const [x, z] = key.split(',').map(Number);
            for (const [dx, dz] of [[0, r], [0, -r], [r, 0], [-r, 0]]) {
                const nx = x + dx, nz = z + dz;
                if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
                if (!tiles.has(`${nx},${nz}`) && isWalkableGround(s, nx, nz)) return [nx, nz];
            }
        }
    }
    return null;
}
export function startOutbreak(e) {
    const s = G.state;
    if (s.outbreak) return false;
    const group = containGroupFor(e);
    if (!group) return false;
    s.outbreak = { tiles: group, day: s.day, crewDay: null, source: BUILD[e.type].name };
    s.stats.outbreaks = (s.stats.outbreaks || 0) + 1;
    s.reputation = Math.max(0, s.reputation - OUTBREAK_REP_PENALTY);
    G.onToast(`CONTAINMENT BREACH. The ${BUILD[e.type].name} let something out. Room sealed.`, true);

    // Anyone standing in there when it went has been exposed. Anyone else is simply shut out.
    // The room seals *behind* them, not around them: the tiles come out of the nav grid the
    // moment this returns, and a worker still standing on one would have no legal move left in
    // any direction — trapped in a room nobody can enter to get them out. So they come out
    // through the door first, and the door locks after.
    const inside = new Set(group);
    const exit = roomExit(group);
    for (const w of s.staff.slice()) {
        const t = worldToTile(w.wx, w.wz);
        if (!inside.has(`${t.tx},${t.tz}`)) continue;
        if (Math.random() < OUTBREAK_INFECT_CHANCE) {
            w.illUntil = s.day + ILLNESS_DAYS;
            G.onToast(`${w.name} has been exposed. Off sick until Day ${w.illUntil}`, true);
        }
        G.releaseWorkerJob(w);
        if (exit) { const wp = tileToWorld(exit[0], exit[1]); w.wx = wp.x; w.wz = wp.z; }
    }
    // Everything inside the sealed room stops where it is; the samples in it are written off.
    for (const eq of machines(s)) {
        if (tilesOf(eq).some(([x, z]) => inside.has(`${x},${z}`))) abandonAll(eq);
    }
    bumpNav();
    dirtyUI();
    return true;
}
export function outbreakRoll(st) {
    const s = G.state;
    if (s.outbreak) return;
    const cond = st.condition ?? 100;
    if (cond >= OUTBREAK_COND_THRESHOLD) return;
    if (!containGroupFor(st)) return;
    const chance = (OUTBREAK_COND_THRESHOLD - cond) / OUTBREAK_COND_THRESHOLD * OUTBREAK_CHANCE_MAX;
    if (Math.random() < chance) startOutbreak(st);
}
export function callDisinfection() {
    const s = G.state;
    if (!s.outbreak) return G.onToast('Nothing to disinfect', true);
    if (s.outbreak.crewDay != null) return G.onToast(`Crew already booked for Day ${s.outbreak.crewDay}`, true);
    s.outbreak.crewDay = s.day + 1;
    G.onToast(`Disinfection crew booked for Day ${s.outbreak.crewDay}, $${DISINFECT_FEE.toLocaleString()}`);
    dirtyUI();
}
// Day rollover: the crew turns up that morning. They then have to walk in and actually fog the
// room — reopening it is their doing, not this function's (see visitors.js updateCleaner).
export function disinfectVisit() {
    const s = G.state;
    if (!s.outbreak || s.outbreak.crewDay == null || s.day < s.outbreak.crewDay) return;
    s.outbreak.crewDay = null;
    s.outbreak.crewOnSite = true;
    spawnCleanCrew();
}
// Is this tile inside a sealed-off room? Used by staff.js so nobody is handed a job they can't
// physically reach, and by the renderer to mark the floor.
export function isQuarantined(e) {
    const s = G.state;
    if (!s.outbreak) return false;
    const inside = new Set(s.outbreak.tiles);
    return tilesOf(e).some(([x, z]) => inside.has(`${x},${z}`));
}

// ---------- day rollover ----------
export function dailyIncidents() {
    const s = G.state;
    disinfectVisit();
    // Dust, flat batteries, a painted-over sounder — an alarm degrades whether or not the lab is
    // busy, so it needs putting on the mechanic's list like everything else.
    for (const e of fireAlarms()) e.condition = Math.max(0, (e.condition ?? 100) - ALARM_DECAY_PER_DAY);
    for (const w of s.staff) if (w.illUntil != null && s.day >= w.illUntil) {
        delete w.illUntil;
        G.onToast(`${w.name} is back from sick leave`);
    }
    for (const l of (s.lawsuits || []).slice())
        if (s.day > l.deadline) {
            G.onToast(`The ${l.name} case went to court without you`, true);
            fightLawsuit(l.id, true);
        }
}

// ---------- per-frame ----------
export function updateIncidents(dt) {
    const s = G.state;
    s.fires ||= [];
    if (s.brigadeEta != null && s.brigadeEta > 0) {
        s.brigadeEta -= dt;
        // The ETA is the engine's drive time, not the fire's remaining life: when it expires a
        // crew walks in through the front door and puts the fires out one at a time, in view.
        // They clear brigadeEta themselves once the last of them leaves.
        if (s.brigadeEta <= 0) { s.brigadeEta = 0; spawnFireCrew(); dirtyUI(); }
    }
    if (!s.fires.length) {
        // Once the last fire is out. Burned out on its own, say, with no engine ever called —
        // there's nothing left to run from. A crew still on the premises ends it themselves on
        // the way out, so don't pre-empt them.
        const crewHere = (s.visitors || []).some(v => v.kind === 'firefighter');
        if (s.evacuating && s.brigadeEta == null && !crewHere) endEvacuation();
        return;
    }

    const byId = new Map(s.equipment.map(e => [e.id, e]));
    for (const f of s.fires.slice()) {
        const e = byId.get(f.equipId);
        if (!e) { s.fires = s.fires.filter(x => x !== f); continue; }
        f.t += dt;
        f.spreadT += dt;
        if (f.spreadT >= FIRE_SPREAD_INTERVAL) {
            f.spreadT = 0;
            for (const other of machines(s)) {
                if (other.id === e.id || isBurning(other)) continue;
                if (tileGap(e, other) > FIRE_SPREAD_RADIUS) continue;
                if (Math.random() < FIRE_SPREAD_CHANCE) startFire(other, true);
            }
        }
        if (f.t >= FIRE_DESTROY_TIME) burnOut(f);
    }

    // Anyone who stays in the flames. The timer drains when they get clear, so running past a
    // fire on the way out is survivable. Standing next to one isn't.
    for (const w of s.staff.slice()) {
        let near = false;
        for (const f of s.fires) {
            const e = byId.get(f.equipId);
            if (!e) continue;
            const c = centerOf(e);
            if (Math.hypot(w.wx - c.x, w.wz - c.z) < FIRE_HURT_RADIUS) { near = true; break; }
        }
        if (!near) { w.burnT = Math.max(0, (w.burnT || 0) - dt * 0.6); continue; }
        w.burnT = (w.burnT || 0) + dt;
        if (w.burnT >= FIRE_HURT_TIME) {
            w.burnT = 0;
            if (Math.random() < FIRE_DEATH_CHANCE) killWorker(w, 'fire');
            else G.onToast(`${w.name} was burned getting clear`, true);
        }
    }
}
