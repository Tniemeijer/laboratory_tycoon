// ==================== PURE DEFINITIONS ====================
// No state, no logic — just the tunable numbers that shape the game.

/** @typedef {{cap:string,t:number,reagent?:string}} ProtocolStep */

export const CAP_LABEL = {
    prep: 'Prep', spin: 'Spin', image: 'Image', incubate: 'Incubate', analyze: 'Analyze',
    chroma: 'Chroma', weigh: 'Weigh', fluoresce: 'Fluoresce', prep_bio: 'Culture Prep', prep_chem: 'Chem Prep',
    prep_contain: 'Contained Prep', incubate_contain: 'Contained Incubate',
    image_contain: 'Contained Image', sequence: 'Sequence', compute: 'Compute'
};

// Steps that handle data and paperwork rather than living material. A sample waiting on one of
// these is a report or a pile of reads — there is nothing left in it to rot, so it's exempt from
// spoilage entirely and staff won't waste a fridge shelf or a trip refrigerating one.
export const INERT_CAPS = ['analyze', 'compute'];

export const BUILD = {
    bench:      { name: 'Lab Bench',     cost: 550,  cat: 'Processing', caps: ['prep', 'analyze'],
                  timeMul: { prep: 1.0, analyze: 2.2 }, slots: 1, batch: 3, attended: true, foot: [1, 1], hold: 4, minLevel: 1,
                  desc: 'Preps samples and runs slow analysis. Holds up to 3 samples per run. Drop several off and they run together. Hands-on work: a scientist has to stay at the bench for the whole run, unlike automated equipment.' },
    preprobot:  { name: 'Prep Robot',    cost: 4200, cat: 'Processing', caps: ['prep', 'prep_chem'],
                  timeMul: { prep: 0.9, prep_chem: 1.0 }, slots: 1, batch: 3, autoStart: true, foot: [2, 1], minLevel: 3,
                  desc: 'Automated prep. Starts itself once enough samples are loaded, no scientist needed to run it. A liquid-handling deck with an XY gantry, sealed in an extracted glass enclosure, so it handles hazardous Chem Prep as well as routine prep. Rating 3.' },
    microscope: { name: 'Microscope',    cost: 1300, cat: 'Processing', caps: ['image'],
                  timeMul: { image: 1.0, fluoresce: 1.2, image_contain: 1.15 }, slots: 1, attended: true, foot: [1, 1], minLevel: 1,
                  desc: 'Imaging step, one sample at a time. Someone has to sit at the eyepiece and actually read the slide, so it ties a scientist up for the whole run. Stand it inside a Dark Room and it can run fluorescence imaging too.' },
    centrifuge: { name: 'Centrifuge',    cost: 1900, cat: 'Processing', caps: ['spin'],
                  timeMul: { spin: 1.0 }, slots: 1, batch: 4, foot: [1, 1], minLevel: 2,
                  desc: 'Spin step. A real rotor, so it holds 4 samples per run. Needs Lab Rating 2.' },
    incubator:  { name: 'Incubator',     cost: 2400, cat: 'Processing', caps: ['incubate'],
                  timeMul: { incubate: 1.0, incubate_contain: 1.1 }, slots: 4, foot: [1, 2], minLevel: 2,
                  desc: 'Incubation step. Multiple shelves, up to 4 techs can load it at once. Rating 2.' },
    sequencer:  { name: 'DNA Sequencer', cost: 9500, cat: 'Processing', caps: ['sequence'],
                  timeMul: { sequence: 1.0 }, slots: 1, batch: 4, foot: [2, 2], minLevel: 4,
                  desc: 'High-throughput sequencing for genomics work. Far and away the priciest thing in the catalogue, and slow per run, but it reads a full flow cell of 4 samples at once, so it earns its keep on volume. Rating 4.' },
    analysisdesk: { name: 'Analysis Desk', cost: 950, cat: 'Processing', caps: ['analyze'],
                  timeMul: { analyze: 0.85 }, slots: 1, batch: 2, attended: true, foot: [1, 1], minLevel: 1,
                  desc: 'A desk and a computer for writing reports up properly. Far quicker than squinting at one on a lab bench, though a scientist has to sit there for the whole run. 2 reports at a time.' },
    serverrack: { name: 'Server Rack',   cost: 3800, cat: 'Processing', caps: ['compute'],
                  timeMul: { compute: 1.0 }, slots: 1, batch: 4, autoStart: true, autoFeed: true, foot: [1, 1], minLevel: 4,
                  desc: 'Crunches raw sequencer output into something a human can read. Reads travel over the network, so nobody carries anything and nobody starts it. Samples land here on their own. 4 at a time. Rating 4.' },
    scale:      { name: 'Scale',         cost: 420,  cat: 'Processing', caps: ['weigh'],
                  timeMul: { weigh: 1.0 }, slots: 1, batch: 3, foot: [1, 1], minLevel: 1,
                  desc: 'Precision balance for dosing and QC mass checks. Works anywhere on the floor, and quick with it. Holds up to 3 samples per run.' },
    chromatograph: { name: 'Chromatograph', cost: 3200, cat: 'Processing', caps: ['analyze'],
                  timeMul: { analyze: 0.8, chroma: 1.0 }, slots: 1, batch: 2, foot: [2, 1], minLevel: 3,
                  desc: 'HPLC/GC separation and detection. A fast dedicated analyser wherever you put it. Stand it in a Cleanroom and it also runs pharma-grade Chroma work. 2 samples per batch. Rating 3.' },
    flowhood:   { name: 'Flow Hood',     cost: 1200, cat: 'Processing', caps: ['prep_bio'],
                  timeMul: { prep_bio: 1.0, prep_contain: 1.2 }, slots: 1, batch: 3, attended: true, foot: [1, 1], minLevel: 2,
                  desc: "Sterile laminar-airflow cabinet for live-culture prep. A regular bench won't do. Standing inside a Containment Lab it also handles contained work with biological and genetically modified agents. Prep only, and a scientist stays for the whole run. Rating 2." },
    fumehood:   { name: 'Fume Hood',     cost: 750,  cat: 'Processing', caps: ['prep_chem'],
                  timeMul: { prep_chem: 1.0 }, slots: 1, batch: 3, attended: true, foot: [1, 1], minLevel: 1,
                  desc: "Ventilated cabinet for prep with toxic, acidic or caustic chemicals. A regular bench won't do. Prep only, and a scientist stays for the whole run." },
    darkroom:   { name: 'Dark Room',     cost: 420,  cat: 'Utility', kind: 'dark', room: true, foot: [1, 1], minLevel: 3,
                  desc: "Light-sealed floor, laid one tile at a time into any shape. Tiles laid flush merge into one room, and it goes down over machines you already own. A Microscope standing on it also runs fluorescence imaging. Finish it with a Door or nobody can get in. Rating 3." },
    fridge:     { name: 'Fridge',        cost: 850,  cat: 'Storage', kind: 'cold', slots: 4, foot: [1, 1], minLevel: 1,
                  desc: 'Cold storage for perishable samples, 4 shelves, several staff can use it at once.' },
    freezer:    { name: 'Freezer',       cost: 2400, cat: 'Storage', kind: 'cold', slots: 6, foot: [1, 2], minLevel: 2,
                  desc: 'Bigger cold storage, 6 shelves. Rating 2.' },
    mopcloset:  { name: 'Mop Closet',    cost: 500,  cat: 'Utility', kind: 'clean', foot: [1, 1], minLevel: 1,
                  desc: 'Cleaners restock here and mop ~40% faster nearby.' },
    sink:       { name: 'Sink',          cost: 700,  cat: 'Utility', kind: 'water', slots: 1, foot: [1, 1], minLevel: 1,
                  desc: 'Distilled/demineralized water for reagent prep, and glassware washing. Mop ~40% faster nearby.' },
    containment: { name: 'Containment Lab', cost: 520, cat: 'Utility', kind: 'contain', room: true, foot: [1, 1], minLevel: 2,
                  desc: "Sealed, negative-pressure floor, laid one tile at a time. A Flow Hood, Incubator and Microscope standing on it gain contained Prep, Incubate and Image, which is the whole Virus and Pathogen chain. Needs an Airlock. Rating 2." },
    cleanroom:  { name: 'Cleanroom',     cost: 650,  cat: 'Utility', kind: 'sterile', room: true, foot: [1, 1], minLevel: 4,
                  desc: "Sealed, filtered floor, laid one tile at a time. A Chromatograph only runs pharma-grade Chroma while standing on it. Needs an Airlock. A plain door would let the filtered air straight out. Rating 4." },
    door:       { name: 'Door',          cost: 180,  cat: 'Utility', door: 'door', foot: [1, 1], minLevel: 3,
                  desc: "A way into a room. Goes on one of the room's own edge tiles and opens whichever way it faces, so rotate it to point outward before placing. Costs no floor space. Enough for a Dark Room." },
    // `mount` means a fitting that hangs rather than stands on the floor: it doesn't block the
    // tile and staff walk under it. `ceiling` narrows that to hanging from above rather than off
    // a wall, which frees it from needing a wall to be next to and from having a facing at all.
    firealarm:  { name: 'Fire Alarm',    cost: 600,  cat: 'Utility', mount: true, ceiling: true, foot: [1, 1], minLevel: 1,
                  desc: "Ceiling sounder. Put it anywhere with floor under it. Evacuates the lab and calls the brigade by itself, provided you keep it serviced." },
    airlock:    { name: 'Airlock',       cost: 520,  cat: 'Utility', door: 'airlock', foot: [1, 1], minLevel: 2,
                  desc: "A double-door vestibule, so the room never loses its air. Placed like a Door, on an edge tile, facing out. Cleanrooms and Containment Labs take nothing less, and staff gown up passing through." }
};

// Raw materials — shelf-stable, bought in bulk, converted into reagents at a bench.
export const INGREDIENTS = {
    salineSalt:  { name: 'Saline Salt',   unit: 'units', cost: 12 },
    solventBase: { name: 'Solvent Base',  unit: 'units', cost: 18 },
    bufferMix:   { name: 'Buffer Mix',    unit: 'units', cost: 25 }
};

// Consumables bought ready-made rather than crafted: no water, no bench time, they're just
// *used up* by the runs that need them. Two shapes, and the difference is the whole point of the
// system, `perSample` items scale with how much work you do, while the expensive `perRun` ones
// are charged once however full the machine was, so a sequencer run with one sample in it burns
// the same £200 flow cell as a run with four. That's what makes filling a batch worth waiting for.
export const SUPPLIES = {
    disposable: { name: 'Disposables',     unit: 'packs', cost: 6,   perSample: true,  caps: null },
    // Slides aren't tied to a cap: they're charged to whichever step mounts the specimen, which is
    // the one before it gets looked at. See suppliesForStep() below.
    slide:      { name: 'Slides',          unit: 'boxes', cost: 15,  perSample: true,  caps: null },
    fluorlabel: { name: 'Fluor. Labels',   unit: 'vials', cost: 48,  perSample: true,  caps: ['fluoresce'] },
    column:     { name: 'HPLC Columns',    unit: 'ea',    cost: 95,  perSample: false, caps: ['chroma'] },
    flowcell:   { name: 'Flow Cells',      unit: 'ea',    cost: 220, perSample: false, caps: ['sequence'] }
};
// Which supply a given protocol step burns, on top of the disposables every run gets through.
export const SUPPLY_FOR_CAP = (() => {
    const m = {};
    for (const [key, s] of Object.entries(SUPPLIES)) for (const c of (s.caps || [])) m[c] = key;
    return m;
})();

// The steps where a specimen is actually looked at down a lens.
export const IMAGING_CAPS = new Set(['image', 'image_contain', 'fluoresce']);

// Steps where nobody handles the specimen: writing up a result is desk work, so it burns no
// gloves, tubes or tips the way bench work does. Every other step gets disposables.
export const DRY_CAPS = new Set(['analyze']);

// Everything a given step of a given protocol burns: disposables for any step where somebody
// handles the sample, whatever its own cap calls for, and a slide for the step that mounts the
// specimen.
//
// That last one is the point of this function. The slide is charged to the step *before* the
// imaging one rather than to the imaging itself, because that is where the sample physically
// becomes a slide. The renderer has always drawn it that way -- a sample whose next step is
// imaging is drawn as a slide -- so charging at the microscope meant it turned into a slide a
// whole step before anybody paid for one. Mounting is the prep's job; the scope only reads what
// it is handed. For a Tissue panel that means the prep costs disposables and a slide, and for DNA
// it is the spin that does, being the step that comes before the imaging there.
export function suppliesForStep(proto, index) {
    const steps = PROTOCOLS[proto].steps;
    const st = steps[index];
    if (!st) return ['disposable'];
    const out = DRY_CAPS.has(st.cap) ? [] : ['disposable'];
    if (SUPPLY_FOR_CAP[st.cap]) out.push(SUPPLY_FOR_CAP[st.cap]);
    const next = steps[index + 1];
    if (next && IMAGING_CAPS.has(next.cap)) out.push('slide');
    return out;
}
// Same thing, found by cap. No protocol uses a cap twice, so the first match is the step.
export function suppliesForCap(proto, cap) {
    return suppliesForStep(proto, PROTOCOLS[proto].steps.findIndex(x => x.cap === cap));
}

// Suppliers quote a fresh price every morning: a random walk that's pulled gently back towards the
// list price, so it wanders without ever running away. Buying the week's solvent while it's cheap
// is the point, and the reason orders aren't instant (see ORDER_LEAD_DAYS) is so you have to call
// it before you know what work is coming.
export const PRICE_DRIFT = 0.11;      // how far a day's move can swing
export const PRICE_PULL = 0.08;       // how strongly it's tugged back to 1.0
export const PRICE_MIN = 0.68, PRICE_MAX = 1.45;
export const ORDER_LEAD_DAYS = 1;     // ordered today, on the shelf tomorrow morning
// Stockroom space. Everything you're holding. Ingredients and supplies alike. Takes a slot, and
// anything already on order has its slot reserved, so you can't paper over a full stockroom by
// ordering more. Hoarding cheap stock therefore costs you the room to hoard anything else.
// Shelf space is a building, not a number. A small allowance covers the shelf by the door every
// lab starts with (and the stock a new game opens holding); everything beyond that means putting
// up actual racking, which takes floor space and has to be walked to. The upgrade is racking *out*
// each Stockroom rather than a free capacity bump, so it's worth nothing until you've built one.
// Sized against what a new lab actually opens holding (see fresh() in game.js): the door shelf
// takes the starting stock with a little headroom and nothing more, so the first real order is
// the moment you find out you need a Stockroom. Get this below the starting stock and a new game
// opens over capacity, which just reads as broken.
// Shelf space is the Stockroom annex, which grows with the Stockroom upgrade exactly like the
// break room grows with Staff Quarters — one entry per upgrade level. Level 0 is the single rack
// by the door every lab starts with: it holds the stock a new game opens with and little else, so
// the first real order is the moment you find out you need more racking.
// Level 0 has to leave real room on top of the stock a new game opens holding (23 units), or the
// player's very first order bounces off a "no space" button before they've learned what the
// stockroom even is. 45 leaves room for two orders — enough to get going, tight enough that the
// first upgrade is obvious.
export const STOCK_TIER_CAPACITY = [45, 75, 110, 150, 195];
// A delivery doesn't teleport onto the shelf: it's dropped at the gate as crates and someone has
// to carry each one in. Until then it's bought and paid for but unusable.
export const CRATE_UNITS = 10;             // units per crate. An order is split into this many
export const STOCK_UNLOAD_TIME = 3;        // seconds spent putting one crate away

// Stock solutions. Crafted from an ingredient plus distilled water, perish after `shelf` days.
export const REAGENTS = {
    saline:  { name: 'Saline',  shelf: 5, ingredient: 'salineSalt' },
    solvent: { name: 'Solvent', shelf: 3, ingredient: 'solventBase' },
    buffer:  { name: 'Buffer',  shelf: 4, ingredient: 'bufferMix' }
};
export const REAGENT_BATCH = 3;       // units made & consumed per prep run
export const REAGENT_MIN = 3;
export const REAGENT_PREP_TIME = 8;
// Reagents are brewed to order. The lab used to top itself up whenever a stock solution ran low,
// which quietly removed the only decision the ingredient economy had in it: reagents perish, so
// brewing early wastes them and brewing late stalls the line. Now you place the order and a free
// scientist takes it to a bench.
export const BREW_QUEUE_MAX = 9;      // per reagent, enough to plan a day, not enough to hoard
export const REAGENT_WATER_COST = 2;  // units of distilled water a prep run consumes

// Distilled water can also just be bought in, delivered like any other stock. A Sink makes it
// free forever, so buying it is the expensive way out, but without that escape hatch a lab with
// no Sink has no water, so no reagents, and every prep step limps along on the missing-reagent
// penalty with no way for the player to dig themselves out.
export const WATER_ITEM = { name: 'Distilled Water', unit: 'units', cost: 5 };

// Distilled water, free to make (just tap + a Sink + time), but still a real bottleneck:
// no sink, no water, no reagents.
export const WATER_BATCH = 8;         // units produced per sink run
export const WATER_MIN = 6;           // auto-refill kicks in below this
export const WATER_FILL_TIME = 6;

// Sample freshness. Queued samples rot fast in the open; a fridge/freezer slows that way down,
// but a scientist actually has to carry the sample over and shelve it first.
export const SAMPLE_DECAY_WARM = 2.3;
export const SAMPLE_DECAY_STORED = 0.15;
export const COLD_STORE_THRESHOLD = 90;   // staff won't bother shelving a sample fresher than this —
                                           // raised from 85 so shelving is attempted earlier, while
                                           // more staff are still likely to be free to do it
export const COLD_STORE_TIME = 4;
// A worker with nothing to do waits here a moment before actually setting off for the break
// room — long enough that "just staged the sample that completes a batch" doesn't read as
// walking all the way to the break room only to immediately turn around and come back. Kept
// close to BATCH_MAX_WAIT so a worker idling next to a partial batch is still likely to be
// there (or just barely off) once that batch times out and starts.
export const IDLE_GRACE_PERIOD = 4;
// Losing a sample to spoilage is meant to sting enough that building cold storage actually pays
// for itself. A client whose sample rotted in your lobby isn't placated by a quiet replacement.
export const SPOIL_REP_PENALTY = 4;
export const SPOIL_MONEY_PENALTY = 60;
export const SPOIL_PAYOUT_CUT = 0.08;     // extra contract payout % lost per spoiled sample under it, capped below

// Batching: a sample dropped off at a batch-capable machine waits in staging rather than starting
// alone. A run launches once staging fills to the machine's `batch` size, or, so a lone sample
// on a quiet day doesn't wait forever — once the oldest one there has waited BATCH_MAX_WAIT.
export const BATCH_MAX_WAIT = 6;
export const BATCH_TIME_PER_EXTRA = 0.15;  // each extra sample in a run adds this fraction of base time
export const BATCH_LOAD_TIME = 3;          // a worker has to actually walk over and start a ready run

// Equipment reliability. Every completed run wears a machine down a bit; wear compounds slightly
// with batch size (more material handled = more strain). Below COND_SLOW_THRESHOLD, runs on it
// start taking longer; below COND_BREAKDOWN_THRESHOLD, it risks breaking outright on completion
// (checked once per finished run, not continuously) and needs a mechanic to fix before it'll
// accept new work again.
export const WEAR_PER_RUN = 3;
export const WEAR_PER_EXTRA_BATCH_SAMPLE = 1.2;
export const COND_SLOW_THRESHOLD = 70;
export const COND_SLOW_MAX = 0.6;          // up to +60% run time at 0 condition
export const COND_BREAKDOWN_THRESHOLD = 40;
export const COND_BREAKDOWN_CHANCE_MAX = 0.25;
// Nobody on the payroll touches a wrench: maintenance is a trade you call in. Book a mechanic and
// they turn up the following morning and work through everything outstanding in one visit. The
// call-out fee is charged per visit and the rest per machine, so there's a real pull between
// calling them the moment something breaks and holding off to get the whole list done in one go
// — while every machine still on that list sits idle or limping.
export const MECH_MAINT_THRESHOLD = 80;    // anything below this is worth servicing while they're in
export const MECH_MAINT_GAIN = 35;
export const MECH_CALLOUT_FEE = 200;       // per visit, whatever they end up doing
export const MECH_REPAIR_COST = 120;       // per machine actually broken
export const MECH_SERVICE_COST = 40;       // per worn machine serviced
// They don't teleport: the mechanic lets themselves in at the front door on the morning of the
// visit and works down the list machine by machine, in view, before leaving again.
export const MECH_REPAIR_TIME = 7;         // seconds spent at a machine that's actually broken
export const MECH_SERVICE_TIME = 4;        // …and at one that only needs servicing

// ---------- accidents ----------
// Wear doesn't just slow a machine down and eventually stop it: a badly-neglected one can go up.
// The check rides on the same completed-run event as the breakdown roll, so a machine you never
// service but never use is never a hazard — it's work on knackered equipment that starts fires.
export const FIRE_COND_THRESHOLD = 45;     // below this, a finished run can set the machine alight
export const FIRE_CHANCE_MAX = 0.10;       // at 0 condition
export const FIRE_SPREAD_RADIUS = 2;       // tiles. A fire reaches anything within this of it
export const FIRE_SPREAD_INTERVAL = 5;     // seconds between spread rolls
export const FIRE_SPREAD_CHANCE = 0.3;
export const FIRE_DESTROY_TIME = 45;       // seconds alight before the machine is a write-off
export const FIRE_BRIGADE_ETA = 20;        // seconds from the call to the engine pulling up outside
export const FIRE_CREW_SIZE = 2;           // …and how many come through the door when it does
export const FIRE_FIGHT_TIME = 4;          // seconds on one machine before it's out
export const FIRE_BRIGADE_FEE = 900;
export const FIRE_HURT_RADIUS = 1.5;       // world units from the flames that counts as "too close"
export const FIRE_HURT_TIME = 7;           // seconds in them before it turns lethal
export const FIRE_DEATH_CHANCE = 0.55;     // rolled once when that timer runs out
export const FIRE_REP_PENALTY = 25;
// How likely an alarm is to actually go off, by condition: useless when it's never been looked at,
// near-certain when it's freshly serviced. Same maintenance loop as everything else.
// An alarm never "runs", so run-wear can't touch it. It just quietly rots up there instead,
// which is what makes forgetting about it the trap rather than a one-off purchase decision.
export const ALARM_DECAY_PER_DAY = 4;
export const ALARM_MIN_RELIABILITY = 0.25;
export const ALARM_MAX_RELIABILITY = 0.98;
export const EVAC_SPEED_MUL = 1.7;         // people move rather faster on the way out

// ---------- outbreak ----------
// The containment equivalent of a fire: neglected kit inside a Containment Lab can let something
// out. The room is then sealed until a disinfection crew has been through, and anyone who was in
// there when it happened may well have picked it up.
export const OUTBREAK_COND_THRESHOLD = 55;
export const OUTBREAK_CHANCE_MAX = 0.09;
export const OUTBREAK_INFECT_CHANCE = 0.45;
export const ILLNESS_DAYS = 3;             // days off sick before they're back on the floor
export const DISINFECT_FEE = 1400;
export const DISINFECT_CREW_SIZE = 2;
export const DISINFECT_TIME = 14;          // seconds of fogging before the room reopens
export const OUTBREAK_REP_PENALTY = 45;

// ---------- lawsuits ----------
// Killing someone is not a fine, it's a claim: it lands the next morning and sits there until you
// deal with it. Settling is the cheap, certain option; fighting is a coin-flip that's either much
// cheaper or much worse, and doing nothing at all means it goes to court without you.
export const LAWSUIT_BASE = 6000;
export const LAWSUIT_VAR = 5000;
export const LAWSUIT_DAYS = 4;             // days to respond before it goes to court by default
export const LAWSUIT_SETTLE_FACTOR = 0.6;
export const LAWSUIT_WIN_CHANCE = 0.35;
export const LAWSUIT_LEGAL_FEE = 800;      // what fighting costs win or lose
export const LAWSUIT_LOSS_MULT = 1.35;     // and what it costs on top of the claim if you lose
export const DEATH_REP_PENALTY = 130;

// Rooms only ever ADD to a machine, never gate it: every machine does its own job perfectly well
// standing on the open floor, and a room grants whatever extra a controlled environment buys you
// — fluorescence imaging in a light-sealed Dark Room, pharma-grade chromatography in a Cleanroom,
// contained culture work in a Containment Lab. Keyed by the room's `kind`, then by the
// machine `type` it applies to, to the cap it grants. equipCaps() in core.js resolves it against
// actual tile overlap with the room's footprint, not mere proximity.
export const ROOM_BONUS_CAP = {
    dark:    { microscope: 'fluoresce' },
    sterile: { chromatograph: 'chroma' },
    // Contained work never leaves the room once it's started: the agent goes from the hood into
    // the incubator and under the scope without crossing the open floor, so the incubator and
    // microscope each need their own contained capability too. Only taking the sample in and
    // writing the result up happen outside.
    contain: { flowhood: 'prep_contain', incubator: 'incubate_contain', microscope: 'image_contain' }
};
// On top of any cap it grants, working inside a room is simply better-controlled work: every run
// on a machine standing in one comes out a little cleaner. This is the "compliance" half of what
// a room buys you, and it applies to every kind.
export const ROOM_QUALITY_BONUS = 1.05;
// What each kind of room will accept as a way in. A Dark Room just needs a doorway; anything that
// has to hold an atmosphere. Sterile air in, contained air off the corridor. Needs the double
// doors of an airlock, which is also where staff gown up.
export const ROOM_DOOR_REQ = { dark: 'door', sterile: 'airlock', contain: 'airlock' };
// Rooms whose air is worth gowning up for: staff show up in protective kit while inside one.
export const SUITED_ROOM_KINDS = ['sterile', 'contain'];

// Per-scientist skill growth: whoever actually walks up and starts a run gets credit for it —
// each completed run raises that worker's skill at that specific task (cap), a little faster with
// bigger batches, cutting run time and nudging quality up the more experience they build there.
// Automated equipment (autoStart, e.g. the Prep Robot) never grants XP — nobody actually did the
// work — and only the operating worker is credited, not everyone idle nearby.
// Some caps aren't a craft of their own. Running a centrifuge is the same hands-and-labels work
// as prep, so it trains and draws on that skill rather than a separate one nobody would ever
// specialise in. Anything not listed here trains its own cap.
export const SKILL_CAP_ALIAS = { spin: 'prep', prep_contain: 'prep', prep_bio: 'prep', prep_chem: 'prep',
                                 incubate_contain: 'incubate', image_contain: 'image', fluoresce: 'image' };
export const SKILL_XP_PER_RUN = 10;
export const SKILL_XP_PER_EXTRA_SAMPLE = 2;
export const SKILL_XP_PER_LEVEL = 60;
export const SKILL_MAX_LEVEL = 5;
export const SKILL_SPEED_PER_LEVEL = 0.035;      // -3.5% run time per level at that cap, up to -17.5% at max
export const SKILL_QUALITY_PER_LEVEL = 0.015;    // +1.5% quality per level at that cap, up to +7.5% at max

// ---------- the people ----------
// Two separate systems, deliberately. TRAITS are innate: rolled when somebody is hired, never
// change, and are as often a drawback as a benefit. They exist so a roster is a set of characters
// rather than interchangeable tokens, and so "who do I let go" is a real question. PERKS are
// earned: the player picks one each time a scientist gains a career level, and they are always
// good. Traits are who someone is, perks are what you have trained them into.
//
// Every effect below is a multiplier applied on top of the existing per-cap skill numbers, so the
// two stack rather than one replacing the other. wage is the one that costs you: a brilliant
// scientist is dearer every single day, which is the whole trade.
export const STAFF_TRAITS = {
    meticulous:  { name: 'Meticulous',   good: true,  wage: 1.15, quality: 1.05, speed: 1.08,
                   desc: 'Takes the extra minute. Cleaner results, slower runs.' },
    quick:       { name: 'Quick Hands',  good: true,  wage: 1.15, speed: 0.90, quality: 0.98,
                   desc: 'Fast on the bench, and it shows a little in the numbers.' },
    brisk:       { name: 'Brisk',        good: true,  wage: 1.08, walk: 1.25,
                   desc: 'Moves through the lab at a clip. Less of the day spent in transit.' },
    tidy:        { name: 'Tidy',         good: true,  wage: 1.05, mop: 1.4,
                   desc: 'Cleans up fast and without being asked twice.' },
    gentle:      { name: 'Gentle',       good: true,  wage: 1.1,  wear: 0.75,
                   desc: 'Easy on the equipment. Machines they run last noticeably longer.' },
    studious:    { name: 'Studious',     good: true,  wage: 1.12, xp: 1.5,
                   desc: 'Picks things up quickly. Levels a skill in about two thirds the runs.' },
    strong:      { name: 'Strong',       good: true,  wage: 1.06, carry: 1,
                   desc: 'Carries one more sample per trip than anybody else.' },
    dawdler:     { name: 'Dawdler',      good: false, wage: 0.82, walk: 0.78,
                   desc: 'In no particular hurry to get anywhere. Cheap, though.' },
    heavyHanded: { name: 'Heavy-Handed', good: false, wage: 0.85, wear: 1.5,
                   desc: 'Rough with the kit. Expect the mechanic more often.' },
    sloppy:      { name: 'Sloppy',       good: false, wage: 0.8,  quality: 0.94,
                   desc: 'Results come out a touch worse than they should.' },
    slow:        { name: 'Ponderous',    good: false, wage: 0.8,  speed: 1.15,
                   desc: 'Every run takes them longer than it takes anyone else.' },
    grubby:      { name: 'Grubby',       good: false, wage: 0.88, mop: 0.6,
                   desc: 'Will mop, eventually, badly.' }
};
// Rolled at hire: one trait, and sometimes a second. A scientist is never given two traits that
// pull the same lever in opposite directions -- see rollTraits() in systems/staff.js.
export const TRAIT_SECOND_CHANCE = 0.45;

export const STAFF_PERKS = {
    specialist:  { name: 'Specialist',   speed: 0.9,   desc: 'Ten percent off every run they start.' },
    steadyHands: { name: 'Steady Hands', quality: 1.04, desc: 'Everything they touch comes out a little cleaner.' },
    nimble:      { name: 'Nimble',       walk: 1.2,    desc: 'Crosses the floor faster.' },
    porter:      { name: 'Porter',       carry: 1,     desc: 'Carries one more sample per trip.' },
    caretaker:   { name: 'Caretaker',    wear: 0.7,    desc: 'Machines they run wear far more slowly.' },
    quickLearn:  { name: 'Quick Study',  xp: 1.4,      desc: 'Gains skill faster from here on.' },
    janitor:     { name: 'Janitor',      mop: 1.5,     desc: 'Mops in a fraction of the time.' },
    efficient:   { name: 'Efficient',    wage: 0.85,   desc: 'Knows their worth, and takes a little less of it.' }
};

// Career XP is separate from per-cap skill: every run grants both, but career XP counts the whole
// body of work rather than one task, so a generalist levels as readily as a specialist. Levels are
// derived from XP rather than stored, same as skills, so retuning re-levels old saves correctly.
export const CAREER_XP_PER_RUN = 10;
export const CAREER_XP_PER_EXTRA_SAMPLE = 2;
export const CAREER_XP_PER_LEVEL = 140;
export const CAREER_MAX_LEVEL = 6;
export const PERK_CHOICES = 3;            // how many perks are offered at each level-up

// Payroll. Scientists used to cost a one-off hiring fee and then nothing at all, which made an
// experienced roster strictly free to keep and firing anybody irrational. Now they draw a wage
// every day, it scales with the career levels you have invested in them, and their traits bend it
// either way. That is the cost side of the perk system: a veteran is genuinely better and
// genuinely expensive, and a cheap dawdler has a place on the payroll.
export const WAGE_BASE = 42;
export const WAGE_PER_LEVEL = 16;

/** @type {Record<string, {name:string, minLevel:number, steps:ProtocolStep[]}>} */
// A protocol's prep step uses the generic 'prep' cap (any Bench or Prep Robot) unless the work
// itself demands a specialized cabinet — live-culture work needs 'prep_bio' (Flow Hood only),
// hazardous chemistry needs 'prep_chem' (Fume Hood only), and work with agents that have to be
// contained needs 'prep_contain' — the same Flow Hood, but only while it stands in a Containment Lab.
// Neither hood can substitute for the other, and neither is a Bench replacement for anything else
// — see BUILD.flowhood/fumehood.
export const PROTOCOLS = {
    chem:   { name: 'Chemical', minLevel: 1, steps: [
                { cap: 'prep_chem', t: 5, reagent: 'solvent' }, { cap: 'analyze', t: 6 } ] },
    tissue: { name: 'Tissue',   minLevel: 1, steps: [
                { cap: 'prep', t: 6 }, { cap: 'image', t: 7 }, { cap: 'analyze', t: 6 } ] },
    blood:  { name: 'Blood',    minLevel: 2, steps: [
                { cap: 'prep', t: 5, reagent: 'saline' }, { cap: 'spin', t: 6 }, { cap: 'analyze', t: 5 } ] },
    culture: { name: 'Cell Culture', minLevel: 2, steps: [
                { cap: 'prep_bio', t: 6 }, { cap: 'incubate', t: 10 }, { cap: 'analyze', t: 6 } ] },
    // Live viral agents are containment work: a Flow Hood on the open floor handles plain culture
    // fine, but this asks for one standing inside a Containment Lab.
    virus:  { name: 'Virus',    minLevel: 3, steps: [
                { cap: 'prep_contain', t: 6 }, { cap: 'incubate_contain', t: 12 }, { cap: 'analyze', t: 6 } ] },
    dna:    { name: 'DNA',      minLevel: 3, steps: [
                { cap: 'prep', t: 7, reagent: 'buffer' }, { cap: 'spin', t: 5 },
                { cap: 'image', t: 6 }, { cap: 'analyze', t: 5 } ] },
    // The DNA panel above stays gel-and-scope work any mid-size lab can take on. This is the
    // premium version of the same job: it wants a real sequencer, and the run is long enough that
    // filling the flow cell (batch 4) is the whole point of owning one.
    genome: { name: 'Genome',   minLevel: 4, steps: [
                { cap: 'prep', t: 7, reagent: 'buffer' }, { cap: 'spin', t: 5 },
                { cap: 'sequence', t: 14 }, { cap: 'compute', t: 8 }, { cap: 'analyze', t: 7 } ] },
    immuno: { name: 'Immunofluorescence', minLevel: 3, steps: [
                { cap: 'prep', t: 6, reagent: 'buffer' }, { cap: 'incubate', t: 10 },
                { cap: 'fluoresce', t: 9 }, { cap: 'analyze', t: 6 } ] },
    // 'chroma' only exists in a lab where a Chromatograph is standing inside a Cleanroom (see
    // ROOM_BONUS_CAP), so this can't be worked until that's set up — same "missing machine"
    // handling as any other protocol, no special gate needed.
    pharma: { name: 'Pharma',   minLevel: 4, steps: [
                { cap: 'weigh', t: 3 }, { cap: 'prep_chem', t: 6, reagent: 'solvent' },
                { cap: 'chroma', t: 9 }, { cap: 'analyze', t: 6 } ] },
    // Same gate-by-capability story as Pharma: 'prep_contain' simply doesn't exist in a lab until
    // a Flow Hood is standing in a Containment Lab, so this can't be worked before one is up.
    pathogen: { name: 'Pathogen', minLevel: 4, steps: [
                { cap: 'prep_contain', t: 7 }, { cap: 'incubate_contain', t: 12 },
                { cap: 'image_contain', t: 6 }, { cap: 'analyze', t: 7 } ] }
};

export const UPGRADES = {
    speed:     { name: 'Faster Processing', base: 1300, mult: 1.8, max: 5, desc: '-12% step time per level' },
    cold:      { name: 'Cold Storage',      base: 800,  mult: 1.7, max: 5, desc: 'Slows spoilage further for stored samples' },
    marketing: { name: 'Marketing',         base: 1600, mult: 1.9, max: 5, desc: '+20% reputation, richer contracts' },
    staff:     { name: 'Staff Quarters',    base: 2200, mult: 2.0, max: 3, desc: '+2 scientist capacity per level' },
    clean:     { name: 'Cleaning Supplies', base: 1000, mult: 1.8, max: 4, desc: 'Slower grime buildup, faster mopping' },
    radio:     { name: 'Break Room Radio',  base: 1200, mult: 1.9, max: 3, desc: '+8% staff walking speed per level. Expect complaints' },
    cart:      { name: 'Sample Cart',       base: 1800, mult: 2.0, max: 3, desc: '+1 sample carried per trip per level' },
    storage:   { name: 'Stockroom',         base: 900,  mult: 1.8, max: 4, desc: 'Extends the stockroom annex. More racking and more shelf space each level' }
};

// Purchasable lab plots. The building is a tall central hall (free, start owned, runs the full
// depth of the lot so the entrance opens straight into it) with a wing on each side. Both wings
// directly border the hall, so however you buy them the lab always stays one connected building —
// no disconnected plots. The four unclaimed corners are just lawn.
// You start owning only the south half of the main hall, the end the front door opens onto. The
// north half is the same building -- it draws inside the shell like any unbought plot does, as
// bare ground you can see but not build on -- and is the natural first thing to buy. Opening on
// the whole hall meant a new lab had more floor than it could ever fill, so the first real
// decision (spend on space, or on a machine) never came up.
export const ZONES = [
    { id: 'main',  name: 'Main Hall',  x0: 4,  z0: 6, w: 8, h: 8,  cost: 0,    startOwned: true },
    { id: 'north', name: 'North Hall', x0: 4,  z0: 0, w: 8, h: 6,  cost: 3200, startOwned: false },
    { id: 'west',  name: 'West Wing',  x0: 0,  z0: 5, w: 4, h: 7,  cost: 2400, startOwned: false },
    { id: 'east',  name: 'East Wing',  x0: 12, z0: 5, w: 4, h: 7,  cost: 2400, startOwned: false }
];

// Utility bill: what it costs per day to run the lab.
export const UTIL_ELECTRICITY_PER_MACHINE = 3;
export const UTIL_HEATING_PER_TILE = 0.18;
export const UTIL_LIGHTING_PER_TILE = 0.1;

// Finance: the lab opens on borrowed money rather than free starting cash. Interest compounds
// daily on whatever's still owed. Worth paying down before it snowballs, though you can also
// borrow more (at the same rate) if you need the runway to get going.
export const START_LOAN = 5000;
// Interest is billed in cash every LOAN_INTEREST_DAYS, and the principal never moves. What you
// borrowed is what you owe, and servicing it is a recurring drain rather than a balance quietly
// snowballing while you're not looking. The rate is per billing period, not per day.
export const LOAN_INTEREST_RATE = 0.05;
export const LOAN_INTEREST_DAYS = 5;
export const LOAN_MAX = 60000;
export const LOAN_STEP = 500;              // the − / + step on the borrow/repay amount
export const LOAN_BORROW_STEP = 2000;
export const LOAN_REPAY_STEP = 1000;

// Cancelling costs this share of the reputation that failing the same contract would. Cheap
// enough that owning up early is the right call, dear enough that it isn't free to hoover up
// every offer on the board.
export const CANCEL_PENALTY_FACTOR = 0.4;
// Plus a cash break fee, as a share of what the job would have paid. Reputation alone made
// cancelling nearly free for a lab that had plenty of it, so a contract you could never serve
// was worth taking on the off chance. Money bites immediately and at every reputation level.
export const CANCEL_FEE_FACTOR = 0.2;
// Letting someone go costs a few days' goodwill — and their replacement still costs full price,
// so churning staff to dodge wages doesn't pay. (Distinct from FIRE_REP_PENALTY above, which is
// about the building being on fire.)
export const DISMISS_REP_PENALTY = 6;

// Receivership. A lab could previously run arbitrarily deep into the red forever: the warning
// fired once and the interest simply kept coming, which is a slow fade rather than a defeat. Past
// this much debt the bank steps in, sells the most valuable thing on the floor each morning
// against what is owed, and gives you this many days to climb back above the line. Failing that,
// the run is over, which is what makes the good runs mean anything.
export const RECEIVERSHIP_DEBT = -4000;
export const RECEIVERSHIP_GRACE_DAYS = 4;
export const RECEIVERSHIP_SALE_FACTOR = 0.45;    // what the bank gets for your kit, being a forced sale

export const REP_LEVELS = [0, 150, 380, 720, 1150];
export const DAY_LENGTH = 60;
export const MAX_ACTIVE = 5;
export const OFFER_COUNT = 5;
export const STAFF_SPEED = 2.7;
export const SAVE_KEY = 'labTycoonSave.v4';

export const ORGS = ['City Hospital', 'BioCorp', 'State University', 'CDC Field Unit', 'AgriTech', 'PharmaOne', 'Forensics Bureau', 'GeneWorks'];
export const ADJ = ['Urgent', 'Routine', 'Priority', 'Confidential', 'Bulk', 'Rush', 'Standard'];
export const SURNAMES = ['Vale', 'Okafor', 'Lindqvist', 'Reyes', 'Cho', 'Bauer', 'Ndiaye', 'Ito', 'Moreau', 'Patel', 'Koval', 'Sorensen', 'Haddad', 'Fischer'];
// A little visual variety per hire. Assigned once at hiring time and kept for that scientist's
// whole career, not re-rolled on every render.
export const SKIN_TONES = [0xf0c9a4, 0xe8b48c, 0xd39d6e, 0xc98f5e, 0xa66f42, 0x8a5a35, 0x5c3d24];
export const HAIR_COLORS = [0x2b1e14, 0x3b2a1d, 0x5c4030, 0x8a6239, 0xc99a4a, 0xe8d9a0, 0x7a4a2e, 0x3a3a3a, 0xb8b8b8];
