# Lab Tycoon

You have a room, a loan, and no idea what you're doing. Congratulations — you run
a laboratory now.

Lab Tycoon is a browser management game about keeping a diagnostics lab alive.
Samples arrive at the front door with a deadline and a shelf life. Your
scientists carry them from machine to machine, one step at a time, while you try
to buy the right equipment before the wrong contract arrives. It's rendered as a
chunky isometric pixel-art lab, which is where the visual style is borrowed from
— the game underneath is its own thing.

It runs entirely in the browser. Nothing to install, nothing to sign up for, and
it saves to your own machine.

**[Play it](https://tniemeijer.github.io/laboratory_tycoon/)**

---

## The short version

1. Take a contract you can *nearly* handle.
2. Panic-buy the machine it needs.
3. Watch a scientist walk very slowly toward a sample that is slowly rotting.
4. Repeat until you own a Cleanroom.

## The longer version

**Every job is a chain.** A Blood panel is Prep → Spin → Analyze. A Genome is
Prep → Spin → Sequence → Compute → Analyze. Each link needs a specific machine,
and a contract's chain lights up green for steps you can already do and red for
the ones you can't. That red is the game telling you what to buy next.

| Protocol | Needs | Chain |
|---|---|---|
| Chemical | Rating 1 | Chem Prep → Analyze |
| Tissue | Rating 1 | Prep → Image → Analyze |
| Blood | Rating 2 | Prep → Spin → Analyze |
| Cell Culture | Rating 2 | Culture Prep → Incubate → Analyze |
| DNA | Rating 3 | Prep → Spin → Image → Analyze |
| Immunofluorescence | Rating 3 | Prep → Incubate → Fluoresce → Analyze |
| Virus | Rating 3 | *Contained* Prep → Incubate → Analyze |
| Genome | Rating 4 | Prep → Spin → Sequence → Compute → Analyze |
| Pharma | Rating 4 | Weigh → Chem Prep → Chroma → Analyze |
| Pathogen | Rating 4 | *Contained* Prep → Incubate → Image → Analyze |

**Batching is the whole trick.** A scientist drops a sample at a machine and
walks away free — it waits there for company. Once enough matching samples pile
up (or one has waited too long), somebody comes over and runs them together. Four
samples through a centrifuge takes barely longer than one. Learning to let work
*accumulate* instead of chasing every tube individually is the difference between
a lab and a very expensive hallway.

**Rooms are floor, not furniture.** Lay a Dark Room, Cleanroom or Containment Lab
one tile at a time, in whatever shape you like, straight over machines you
already own. They don't replace equipment — they *upgrade* whatever stands
inside. A Microscope in a Dark Room also does fluorescence. A Chromatograph in a
Cleanroom unlocks the entire Pharma chain. A room walls itself in, so you decide
where the way in goes: a Door for a Dark Room, an Airlock for anything holding an
atmosphere — and you'll watch your staff gown up as they walk through it.

**Somebody has to actually be there.** A Lab Bench, Microscope, Analysis Desk or
hood keeps a scientist standing at it for the whole run. Automated kit doesn't.
That trade — cheap machines that eat your staff's time versus expensive ones that
don't — is most of the mid-game.

**Your scientists get better.** Whoever starts a run gets the credit, and their
skill at that specific task grows: faster runs, better quality. Nobody trains at
a machine you never let them touch.

**Money is a leash.** You open on a loan, not a grant. Interest is billed in cash
every five days whether you've earned anything or not. There's a utility bill
every single day. Suppliers re-quote every morning, so the week's solvent is
cheap on Tuesday and isn't on Thursday — and stock takes a day to arrive, so you
have to order before you know what's coming.

**And then it catches fire.** Equipment wears out. A worn machine runs slow, then
breaks, and nobody on your payroll owns a wrench — maintenance is a trade you
ring up, and the mechanic walks in the next morning and works down the list in
front of you. Skip that for long enough and a machine goes up. Fire spreads. You
get a button to evacuate and a button to call the brigade, or you buy a Fire
Alarm to do both for you — assuming you've been servicing *that*, which you
haven't. Neglect something in the Containment Lab instead and it breaches: the
room seals, whoever was inside goes off sick, and a crew in hazmat suits has to
come and fog the place before you can use any of it again.

If a scientist dies, their family will sue. You can settle, or you can take your
chances in court.

---

## Controls

| | |
|---|---|
| Move the view | Drag, or `WASD` |
| Turn the view | `Q` / `E`, or the ⟲ ⟳ buttons |
| Zoom | Scroll or pinch |
| Build menu | `B` |
| Contracts | `C` |
| Rotate what you're placing | `R` |
| Move something already built | `M` |
| Sell something | `X` |
| Pause | `P` |
| Cancel / close | `Esc` |

Laying room floor keeps the tool in your hand, so you can click tile after tile
and press `Esc` when the room is the shape you want.

The game auto-saves to `localStorage` every in-game day. **New** wipes it and
starts you over with a fresh loan and fresh optimism.

---

## Running it yourself

```bash
npm install
npm run dev      # http://localhost:3000
```

```bash
npm run build    # static bundle in dist/
npm run preview
```

No backend and no build step beyond Vite — the shipped bundle is Three.js and
the game. (`package.json` still lists express, socket.io and uuid; those belong
to the abandoned prototype below and nothing in the game imports them.)

Pushing to `main` deploys to GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

## Code layout

```
index.html                    entry page + HUD markup
src/client/main.js            boot and the requestAnimationFrame loop
src/client/game.js            orchestrator: save/load, the day clock, placement
src/client/data.js            every tunable number and definition, no logic
src/client/core.js            shared runtime state and derived stats
src/client/grid.js            tiles, rooms, walls, doorways, nav building
src/client/pathfind.js        A* that honours per-edge walls
src/client/threeScene.js      isometric renderer, models, input, pixelation
src/client/systems/           contracts, samples, staff AI, equipment, economy,
                              dirt, incidents (fire/outbreak/lawsuits), visitors
src/client/ui/                top bar, menus, build tools
```

`src/server/` and `src/shared/` are left over from an abandoned client/server
prototype of a different design. Nothing in the game imports them.

## Licence

See [LICENSE](LICENSE).
