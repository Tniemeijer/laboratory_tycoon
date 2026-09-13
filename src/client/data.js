// ==================== PURE DEFINITIONS ====================
// No state, no logic — just the tunable numbers that shape the game.

/** @typedef {{cap:string,t:number,reagent?:string}} ProtocolStep */

export const CAP_LABEL = {
    prep: 'Prep', spin: 'Spin', image: 'Image', incubate: 'Incubate', analyze: 'Analyze',
    chroma: 'Chroma', weigh: 'Weigh', fluoresce: 'Fluoresce', prep_bio: 'Culture Prep', prep_chem: 'Chem Prep',
    prep_contain: 'Contained Prep', sequence: 'Sequence', compute: 'Compute'
};

// Steps that handle data and paperwork rather than living material. A sample waiting on one of
// these is a report or a pile of reads — there is nothing left in it to rot, so it's exempt from
// spoilage entirely and staff won't waste a fridge shelf or a trip refrigerating one.
export const INERT_CAPS = ['analyze', 'compute'];

export const BUILD = {
    bench:      { name: 'Lab Bench',     cost: 550,  cat: 'Processing', caps: ['prep', 'analyze'],
                  timeMul: { prep: 1.0, analyze: 2.2 }, slots: 1, batch: 3, attended: true, foot: [1, 1], hold: 4, minLevel: 1,
                  desc: 'Preps samples and runs slow analysis. Holds up to 3 samples per run — drop several off and they run together. Hands-on work: a scientist has to stay at the bench for the whole run, unlike automated equipment.' },
    preprobot:  { name: 'Prep Robot',    cost: 4200, cat: 'Processing', caps: ['prep', 'prep_chem'],
                  timeMul: { prep: 0.9, prep_chem: 1.0 }, slots: 1, batch: 3, autoStart: true, foot: [2, 1], minLevel: 3,
                  desc: 'Automated prep — starts itself once enough samples are loaded, no scientist needed to run it. A liquid-handling deck with an XY gantry, sealed in an extracted glass enclosure, so it handles hazardous Chem Prep as well as routine prep. Rating 3.' },
    microscope: { name: 'Microscope',    cost: 1300, cat: 'Processing', caps: ['image'],
                  timeMul: { image: 1.0, fluoresce: 1.2 }, slots: 1, attended: true, foot: [1, 1], minLevel: 1,
                  desc: 'Imaging step, one sample at a time. Someone has to sit at the eyepiece and actually read the slide, so it ties a scientist up for the whole run. Stand it inside a Dark Room and it can run fluorescence imaging too.' },
    centrifuge: { name: 'Centrifuge',    cost: 1900, cat: 'Processing', caps: ['spin'],
                  timeMul: { spin: 1.0 }, slots: 1, batch: 4, foot: [1, 1], minLevel: 2,
                  desc: 'Spin step. A real rotor — holds 4 samples per run. Needs Lab Rating 2.' },
    incubator:  { name: 'Incubator',     cost: 2400, cat: 'Processing', caps: ['incubate'],
                  timeMul: { incubate: 1.0 }, slots: 4, foot: [1, 2], minLevel: 2,
                  desc: 'Incubation step. Multiple shelves — up to 4 techs can load it at once. Rating 2.' },
    sequencer:  { name: 'DNA Sequencer', cost: 9500, cat: 'Processing', caps: ['sequence'],
                  timeMul: { sequence: 1.0 }, slots: 1, batch: 4, foot: [2, 2], minLevel: 4,
                  desc: 'High-throughput sequencing for genomics work. Far and away the priciest thing in the catalogue, and slow per run — but it reads a full flow cell of 4 samples at once, so it earns its keep on volume. Rating 4.' },
    analysisdesk: { name: 'Analysis Desk', cost: 950, cat: 'Processing', caps: ['analyze'],
                  timeMul: { analyze: 0.85 }, slots: 1, batch: 2, attended: true, foot: [1, 1], minLevel: 1,
                  desc: 'A desk and a computer for writing reports up properly — far quicker than squinting at one on a lab bench, though a scientist has to sit there for the whole run. 2 reports at a time.' },
    serverrack: { name: 'Server Rack',   cost: 3800, cat: 'Processing', caps: ['compute'],
                  timeMul: { compute: 1.0 }, slots: 1, batch: 4, autoStart: true, autoFeed: true, foot: [1, 1], minLevel: 4,
                  desc: 'Crunches raw sequencer output into something a human can read. Reads travel over the network, so nobody carries anything and nobody starts it — samples land here on their own. 4 at a time. Rating 4.' },
    analyzer:   { name: 'Auto-Analyzer', cost: 4000, cat: 'Processing', caps: ['analyze'],
                  timeMul: { analyze: 0.7 }, slots: 1, batch: 2, foot: [2, 2], minLevel: 3,
                  desc: 'Fast, dedicated analysis. Runs 2 samples per batch. Rating 3.' },
    scale:      { name: 'Scale',         cost: 420,  cat: 'Processing', caps: ['weigh'],
                  timeMul: { weigh: 1.0 }, slots: 1, batch: 3, foot: [1, 1], minLevel: 1,
                  desc: 'Precision balance for dosing and QC mass checks. Works anywhere on the floor. Quick — holds up to 3 samples per run.' },
    chromatograph: { name: 'Chromatograph', cost: 3200, cat: 'Processing', caps: ['analyze'],
                  timeMul: { analyze: 0.8, chroma: 1.0 }, slots: 1, batch: 2, foot: [2, 1], minLevel: 3,
                  desc: 'HPLC/GC separation and detection — a fast dedicated analyser wherever you put it. Stand it in a Cleanroom and it also runs pharma-grade Chroma work. 2 samples per batch. Rating 3.' },
    flowhood:   { name: 'Flow Hood',     cost: 1200, cat: 'Processing', caps: ['prep_bio'],
                  timeMul: { prep_bio: 1.0, prep_contain: 1.2 }, slots: 1, batch: 3, attended: true, foot: [1, 1], minLevel: 2,
                  desc: "Sterile laminar-airflow cabinet for live-culture prep — a regular bench won't do. Standing inside a Containment Lab it also handles contained work with biological and genetically modified agents. Prep only, and a scientist stays for the whole run. Rating 2." },
    fumehood:   { name: 'Fume Hood',     cost: 750,  cat: 'Processing', caps: ['prep_chem'],
                  timeMul: { prep_chem: 1.0 }, slots: 1, batch: 3, attended: true, foot: [1, 1], minLevel: 1,
                  desc: "Ventilated cabinet for prep with toxic, acidic or caustic chemicals — a regular bench won't do. Prep only, and a scientist stays for the whole run." },
    darkroom:   { name: 'Dark Room',     cost: 1500, cat: 'Utility', kind: 'dark', room: true, foot: [2, 2], minLevel: 3,
                  desc: "A 2×2 light-sealed room — floor you build on, not furniture. A Microscope standing inside also runs fluorescence imaging. Lay another flush alongside to grow the room. Rating 3." },
    fridge:     { name: 'Fridge',        cost: 850,  cat: 'Storage', kind: 'cold', slots: 4, foot: [1, 1], minLevel: 1,
                  desc: 'Cold storage for perishable samples — 4 shelves, several staff can use it at once.' },
    freezer:    { name: 'Freezer',       cost: 2400, cat: 'Storage', kind: 'cold', slots: 6, foot: [1, 2], minLevel: 2,
                  desc: 'Bigger cold storage — 6 shelves. Rating 2.' },
    mopcloset:  { name: 'Mop Closet',    cost: 500,  cat: 'Utility', kind: 'clean', foot: [1, 1], minLevel: 1,
                  desc: 'Cleaners restock here and mop ~40% faster nearby.' },
    sink:       { name: 'Sink',          cost: 700,  cat: 'Utility', kind: 'water', slots: 1, foot: [1, 1], minLevel: 1,
                  desc: 'Distilled/demineralized water for reagent prep, and glassware washing — mop ~40% faster nearby.' },
    containment: { name: 'Containment Lab', cost: 1900, cat: 'Utility', kind: 'contain', room: true, foot: [2, 2], minLevel: 2,
                  desc: "A 2×2 sealed, negative-pressure room for work with biological and genetically modified agents. A Flow Hood standing inside one handles contained work that can't be done on the open floor. Lay another flush alongside to grow it. Rating 2." },
    cleanroom:  { name: 'Cleanroom',     cost: 2400, cat: 'Utility', kind: 'sterile', room: true, foot: [2, 2], minLevel: 4,
                  desc: "A 2×2 sealed, filtered room — floor you build on. A Chromatograph only runs pharma-grade work while standing inside one. Also cuts contamination risk lab-wide. Lay another flush alongside to grow it. Rating 4." }
};

// Raw materials — shelf-stable, bought in bulk, converted into reagents at a bench.
export const INGREDIENTS = {
    salineSalt:  { name: 'Saline Salt',   unit: 'units', cost: 12 },
    solventBase: { name: 'Solvent Base',  unit: 'units', cost: 18 },
    bufferMix:   { name: 'Buffer Mix',    unit: 'units', cost: 25 }
};

// Consumables bought ready-made rather than crafted: no water, no bench time, they're just
// *used up* by the runs that need them. Two shapes, and the difference is the whole point of the
// system — `perSample` items scale with how much work you do, while the expensive `perRun` ones
// are charged once however full the machine was, so a sequencer run with one sample in it burns
// the same £200 flow cell as a run with four. That's what makes filling a batch worth waiting for.
export const SUPPLIES = {
    disposable: { name: 'Disposables',     unit: 'packs', cost: 6,   perSample: true,  caps: null },
    slide:      { name: 'Slides',          unit: 'boxes', cost: 15,  perSample: true,  caps: ['image'] },
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

// Suppliers quote a fresh price every morning: a random walk that's pulled gently back towards the
// list price, so it wanders without ever running away. Buying the week's solvent while it's cheap
// is the point — and the reason orders aren't instant (see ORDER_LEAD_DAYS) is so you have to call
// it before you know what work is coming.
export const PRICE_DRIFT = 0.11;      // how far a day's move can swing
export const PRICE_PULL = 0.08;       // how strongly it's tugged back to 1.0
export const PRICE_MIN = 0.68, PRICE_MAX = 1.45;
export const ORDER_LEAD_DAYS = 1;     // ordered today, on the shelf tomorrow morning
// Stockroom space. Everything you're holding — ingredients and supplies alike — takes a slot, and
// anything already on order has its slot reserved, so you can't paper over a full stockroom by
// ordering more. Hoarding cheap stock therefore costs you the room to hoard anything else.
export const STOCK_BASE_CAPACITY = 70;
export const STOCK_PER_UPGRADE = 45;

// Stock solutions — crafted from an ingredient plus distilled water, perish after `shelf` days.
export const REAGENTS = {
    saline:  { name: 'Saline',  shelf: 5, ingredient: 'salineSalt' },
    solvent: { name: 'Solvent', shelf: 3, ingredient: 'solventBase' },
    buffer:  { name: 'Buffer',  shelf: 4, ingredient: 'bufferMix' }
};
export const REAGENT_BATCH = 3;       // units made & consumed per prep run
export const REAGENT_MIN = 3;
export const REAGENT_PREP_TIME = 8;
export const REAGENT_WATER_COST = 2;  // units of distilled water a prep run consumes

// Distilled water can also just be bought in, delivered like any other stock. A Sink makes it
// free forever, so buying it is the expensive way out — but without that escape hatch a lab with
// no Sink has no water, so no reagents, and every prep step limps along on the missing-reagent
// penalty with no way for the player to dig themselves out.
export const WATER_ITEM = { name: 'Distilled Water', unit: 'units', cost: 5 };

// Distilled water — free to make (just tap + a Sink + time), but still a real bottleneck:
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
// for itself — a client whose sample rotted in your lobby isn't placated by a quiet replacement.
export const SPOIL_REP_PENALTY = 4;
export const SPOIL_MONEY_PENALTY = 60;
export const SPOIL_PAYOUT_CUT = 0.08;     // extra contract payout % lost per spoiled sample under it, capped below

// Batching: a sample dropped off at a batch-capable machine waits in staging rather than starting
// alone. A run launches once staging fills to the machine's `batch` size, or — so a lone sample
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
export const MECH_MAINT_THRESHOLD = 80;    // a mechanic proactively services anything below this
export const MECH_MAINT_TIME = 6;
export const MECH_MAINT_GAIN = 35;
export const MECH_REPAIR_TIME = 10;
export const MECH_REPAIR_COST = 45;

// Rooms only ever ADD to a machine, never gate it: every machine does its own job perfectly well
// standing on the open floor, and a room grants whatever extra a controlled environment buys you
// — fluorescence imaging in a light-sealed Dark Room, pharma-grade chromatography in a Cleanroom,
// contained culture work in a Containment Lab. Keyed by the room's `kind`, then by the
// machine `type` it applies to, to the cap it grants. equipCaps() in core.js resolves it against
// actual tile overlap with the room's footprint, not mere proximity.
export const ROOM_BONUS_CAP = {
    dark:    { microscope: 'fluoresce' },
    sterile: { chromatograph: 'chroma' },
    contain: { flowhood: 'prep_contain' }
};
// On top of any cap it grants, working inside a room is simply better-controlled work: every run
// on a machine standing in one comes out a little cleaner. This is the "compliance" half of what
// a room buys you, and it applies to every kind.
export const ROOM_QUALITY_BONUS = 1.05;

// Per-scientist skill growth: whoever actually walks up and starts a run gets credit for it —
// each completed run raises that worker's skill at that specific task (cap), a little faster with
// bigger batches, cutting run time and nudging quality up the more experience they build there.
// Automated equipment (autoStart, e.g. the Prep Robot) never grants XP — nobody actually did the
// work — and only the operating worker is credited, not everyone idle nearby.
export const SKILL_XP_PER_RUN = 10;
export const SKILL_XP_PER_EXTRA_SAMPLE = 2;
export const SKILL_XP_PER_LEVEL = 60;
export const SKILL_MAX_LEVEL = 5;
export const SKILL_SPEED_PER_LEVEL = 0.035;      // -3.5% run time per level at that cap, up to -17.5% at max
export const SKILL_QUALITY_PER_LEVEL = 0.015;    // +1.5% quality per level at that cap, up to +7.5% at max

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
                { cap: 'prep_contain', t: 6 }, { cap: 'incubate', t: 12 }, { cap: 'analyze', t: 6 } ] },
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
                { cap: 'prep_contain', t: 7 }, { cap: 'incubate', t: 12 },
                { cap: 'image', t: 6 }, { cap: 'analyze', t: 7 } ] }
};

export const UPGRADES = {
    speed:     { name: 'Faster Processing', base: 1300, mult: 1.8, max: 5, desc: '-12% step time per level' },
    cold:      { name: 'Cold Storage',      base: 800,  mult: 1.7, max: 5, desc: 'Slows spoilage further for stored samples' },
    marketing: { name: 'Marketing',         base: 1600, mult: 1.9, max: 5, desc: '+20% reputation, richer contracts' },
    staff:     { name: 'Staff Quarters',    base: 2200, mult: 2.0, max: 3, desc: '+2 scientist capacity per level' },
    clean:     { name: 'Cleaning Supplies', base: 1000, mult: 1.8, max: 4, desc: 'Slower grime buildup, faster mopping' },
    radio:     { name: 'Break Room Radio',  base: 1200, mult: 1.9, max: 3, desc: '+8% staff walking speed per level — expect complaints' },
    cart:      { name: 'Sample Cart',       base: 1800, mult: 2.0, max: 3, desc: '+1 sample carried per trip per level' },
    storage:   { name: 'Stockroom',         base: 900,  mult: 1.8, max: 4, desc: `+${STOCK_PER_UPGRADE} units of stock space per level` }
};

// Purchasable lab plots. The building is a tall central hall (free, start owned, runs the full
// depth of the lot so the entrance opens straight into it) with a wing on each side. Both wings
// directly border the hall, so however you buy them the lab always stays one connected building —
// no disconnected plots. The four unclaimed corners are just lawn.
export const ZONES = [
    { id: 'main', name: 'Main Lab',  x0: 4,  z0: 0, w: 8, h: 14, cost: 0,    startOwned: true },
    { id: 'west', name: 'West Wing', x0: 0,  z0: 5, w: 4, h: 7,  cost: 2400, startOwned: false },
    { id: 'east', name: 'East Wing', x0: 12, z0: 5, w: 4, h: 7,  cost: 2400, startOwned: false }
];

// Utility bill: what it costs per day to run the lab.
export const UTIL_ELECTRICITY_PER_MACHINE = 3;
export const UTIL_HEATING_PER_TILE = 0.18;
export const UTIL_LIGHTING_PER_TILE = 0.1;

// Finance: the lab opens on borrowed money rather than free starting cash. Interest compounds
// daily on whatever's still owed — worth paying down before it snowballs, though you can also
// borrow more (at the same rate) if you need the runway to get going.
export const START_LOAN = 5000;
// Interest is billed in cash every LOAN_INTEREST_DAYS, and the principal never moves — what you
// borrowed is what you owe, and servicing it is a recurring drain rather than a balance quietly
// snowballing while you're not looking. The rate is per billing period, not per day.
export const LOAN_INTEREST_RATE = 0.05;
export const LOAN_INTEREST_DAYS = 5;
export const LOAN_MAX = 60000;
export const LOAN_STEP = 500;              // the − / + step on the borrow/repay amount
export const LOAN_BORROW_STEP = 2000;
export const LOAN_REPAY_STEP = 1000;

export const REP_LEVELS = [0, 150, 380, 720, 1150];
export const DAY_LENGTH = 60;
export const MAX_ACTIVE = 5;
export const OFFER_COUNT = 5;
export const STAFF_SPEED = 2.7;
export const SAVE_KEY = 'labTycoonSave.v4';

export const ORGS = ['City Hospital', 'BioCorp', 'State University', 'CDC Field Unit', 'AgriTech', 'PharmaOne', 'Forensics Bureau', 'GeneWorks'];
export const ADJ = ['Urgent', 'Routine', 'Priority', 'Confidential', 'Bulk', 'Rush', 'Standard'];
export const SURNAMES = ['Vale', 'Okafor', 'Lindqvist', 'Reyes', 'Cho', 'Bauer', 'Ndiaye', 'Ito', 'Moreau', 'Patel', 'Koval', 'Sorensen', 'Haddad', 'Fischer'];
// A little visual variety per hire — assigned once at hiring time and kept for that scientist's
// whole career, not re-rolled on every render.
export const SKIN_TONES = [0xf0c9a4, 0xe8b48c, 0xd39d6e, 0xc98f5e, 0xa66f42, 0x8a5a35, 0x5c3d24];
export const HAIR_COLORS = [0x2b1e14, 0x3b2a1d, 0x5c4030, 0x8a6239, 0xc99a4a, 0xe8d9a0, 0x7a4a2e, 0x3a3a3a, 0xb8b8b8];
