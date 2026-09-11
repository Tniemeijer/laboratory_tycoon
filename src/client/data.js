// ==================== PURE DEFINITIONS ====================
// No state, no logic — just the tunable numbers that shape the game.

/** @typedef {{cap:string,t:number,reagent?:string}} ProtocolStep */

export const CAP_LABEL = { prep: 'Prep', spin: 'Spin', image: 'Image', incubate: 'Incubate', analyze: 'Analyze' };

export const BUILD = {
    bench:      { name: 'Lab Bench',     cost: 550,  cat: 'Processing', caps: ['prep', 'analyze'],
                  timeMul: { prep: 1.0, analyze: 2.2 }, slots: 1, foot: [1, 1], hold: 4, minLevel: 1,
                  desc: 'Preps samples and runs slow analysis. One tech at a time — build more to parallelize.' },
    microscope: { name: 'Microscope',    cost: 1300, cat: 'Processing', caps: ['image'],
                  timeMul: { image: 1.0 }, slots: 1, foot: [1, 1], minLevel: 1,
                  desc: 'Imaging step.' },
    centrifuge: { name: 'Centrifuge',    cost: 1900, cat: 'Processing', caps: ['spin'],
                  timeMul: { spin: 1.0 }, slots: 1, foot: [1, 1], minLevel: 2,
                  desc: 'Spin step. Needs Lab Rating 2.' },
    incubator:  { name: 'Incubator',     cost: 2400, cat: 'Processing', caps: ['incubate'],
                  timeMul: { incubate: 1.0 }, slots: 4, foot: [1, 2], minLevel: 2,
                  desc: 'Incubation step. Multiple shelves — up to 4 techs can load it at once. Rating 2.' },
    analyzer:   { name: 'Auto-Analyzer', cost: 4000, cat: 'Processing', caps: ['analyze'],
                  timeMul: { analyze: 0.7 }, slots: 1, foot: [2, 2], minLevel: 3,
                  desc: 'Fast, dedicated analysis. Rating 3.' },
    fridge:     { name: 'Fridge',        cost: 850,  cat: 'Storage', kind: 'cold', slots: 4, foot: [1, 1], minLevel: 1,
                  desc: 'Cold storage for perishable samples — 4 shelves, several staff can use it at once.' },
    freezer:    { name: 'Freezer',       cost: 2400, cat: 'Storage', kind: 'cold', slots: 6, foot: [1, 2], minLevel: 2,
                  desc: 'Bigger cold storage — 6 shelves. Rating 2.' },
    mopcloset:  { name: 'Mop Closet',    cost: 500,  cat: 'Utility', kind: 'clean', foot: [1, 1], minLevel: 1,
                  desc: 'Cleaners restock here and mop ~40% faster nearby.' },
    sink:       { name: 'Sink',          cost: 700,  cat: 'Utility', kind: 'water', slots: 1, foot: [1, 1], minLevel: 1,
                  desc: 'Distilled/demineralized water for reagent prep, and glassware washing — mop ~40% faster nearby.' }
};

// Raw materials — shelf-stable, bought in bulk, converted into reagents at a bench.
export const INGREDIENTS = {
    salineSalt:  { name: 'Saline Salt',   unit: 'units', cost: 12 },
    solventBase: { name: 'Solvent Base',  unit: 'units', cost: 18 },
    bufferMix:   { name: 'Buffer Mix',    unit: 'units', cost: 25 }
};

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
// Losing a sample to spoilage is meant to sting enough that building cold storage actually pays
// for itself — a client whose sample rotted in your lobby isn't placated by a quiet replacement.
export const SPOIL_REP_PENALTY = 4;
export const SPOIL_MONEY_PENALTY = 60;
export const SPOIL_PAYOUT_CUT = 0.08;     // extra contract payout % lost per spoiled sample under it, capped below

/** @type {Record<string, {name:string, minLevel:number, steps:ProtocolStep[]}>} */
export const PROTOCOLS = {
    chem:   { name: 'Chemical', minLevel: 1, steps: [
                { cap: 'prep', t: 5, reagent: 'solvent' }, { cap: 'analyze', t: 6 } ] },
    tissue: { name: 'Tissue',   minLevel: 1, steps: [
                { cap: 'prep', t: 6 }, { cap: 'image', t: 7 }, { cap: 'analyze', t: 6 } ] },
    blood:  { name: 'Blood',    minLevel: 2, steps: [
                { cap: 'prep', t: 5, reagent: 'saline' }, { cap: 'spin', t: 6 }, { cap: 'analyze', t: 5 } ] },
    virus:  { name: 'Virus',    minLevel: 2, steps: [
                { cap: 'prep', t: 6 }, { cap: 'incubate', t: 12 }, { cap: 'analyze', t: 6 } ] },
    dna:    { name: 'DNA',      minLevel: 3, steps: [
                { cap: 'prep', t: 7, reagent: 'buffer' }, { cap: 'spin', t: 5 },
                { cap: 'image', t: 6 }, { cap: 'analyze', t: 5 } ] }
};

export const UPGRADES = {
    speed:     { name: 'Faster Processing', base: 1300, mult: 1.8, max: 5, desc: '-12% step time per level' },
    cold:      { name: 'Cold Storage',      base: 800,  mult: 1.7, max: 5, desc: 'Slows spoilage further for stored samples' },
    marketing: { name: 'Marketing',         base: 1600, mult: 1.9, max: 5, desc: '+20% reputation, richer contracts' },
    staff:     { name: 'Staff Quarters',    base: 2200, mult: 2.0, max: 3, desc: '+2 scientist capacity per level' },
    clean:     { name: 'Cleaning Supplies', base: 1000, mult: 1.8, max: 4, desc: 'Slower grime buildup, faster mopping' },
    radio:     { name: 'Break Room Radio',  base: 1200, mult: 1.9, max: 3, desc: '+8% staff walking speed per level — expect complaints' }
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

export const REP_LEVELS = [0, 150, 380, 720, 1150];
export const DAY_LENGTH = 60;
export const MAX_ACTIVE = 5;
export const OFFER_COUNT = 5;
export const STAFF_SPEED = 2.7;
export const SAVE_KEY = 'labTycoonSave.v4';

export const ORGS = ['City Hospital', 'BioCorp', 'State University', 'CDC Field Unit', 'AgriTech', 'PharmaOne', 'Forensics Bureau', 'GeneWorks'];
export const ADJ = ['Urgent', 'Routine', 'Priority', 'Confidential', 'Bulk', 'Rush', 'Standard'];
export const SURNAMES = ['Vale', 'Okafor', 'Lindqvist', 'Reyes', 'Cho', 'Bauer', 'Ndiaye', 'Ito', 'Moreau', 'Patel', 'Koval', 'Sorensen', 'Haddad', 'Fischer'];
