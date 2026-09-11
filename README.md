# Lab Tycoon

A browser lab-management game built with Three.js, in the spirit of Rollercoaster
Tycoon: isometric, chunky pixel-art rendering, and a money-and-reputation
progression loop.

## Run it

```bash
npm install
npm run dev
# open http://localhost:3000
```

Build a static bundle with `npm run build` (output in `dist/`), preview it with
`npm run preview`.

## How to play

You run a diagnostics lab. Accept contracts, build equipment, hire scientists,
and process the samples that arrive at the gate before they spoil or the
deadline passes.

- **Contracts** (right panel): each offer asks for a number of samples of one
  type by a given day, and pays money plus reputation. Accept up to four at
  once. Accepting one sends its samples to the gate.
- **Build** (bottom toolbar): pick a tool, then click a floor tile. Right-click
  a machine, or use the Demolish tool, to sell it back for half price.
  - *Lab Bench / Microscope / Centrifuge / Auto-Analyzer* process samples, from
    slow and cheap to fast and expensive. The Auto-Analyzer handles two at once.
  - *Fridge / Freezer* add cold storage. Waiting samples inside cold-storage
    capacity spoil slowly; samples beyond capacity spoil fast.
- **Staff**: hire scientists (cost rises each hire). They automatically fetch
  queued samples, carry them to a free processing machine, run them, and return.
- **Upgrades**: spend money on faster processing, more cold storage, better
  reputation gains, and higher staff capacity.
- **Lab Rating** (the stars by your reputation): rises as reputation grows and
  unlocks higher-tier equipment and richer contracts.

### Controls

- Drag to rotate, scroll to zoom.
- `1`–`6` select build tools, `X` selects Demolish, `Esc` clears the tool.
- `P` or the Pause button pauses; the speed button cycles 1x / 2x / 3x.

The game auto-saves to `localStorage` on every in-game day and on exit. "New
Game" wipes the save and starts over.

## Project layout

```
index.html               entry page and HUD markup
src/client/main.js        game state, rules, staff AI, UI wiring
src/client/threeScene.js  isometric renderer, models, input, pixelation
src/client/styles.css     HUD styling
```

`src/server/` and `src/shared/` hold an earlier, unused client/server prototype
of a different game design. Nothing in the current game imports them; they can be
deleted.
