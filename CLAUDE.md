# Claude City — working notes

A repository rendered as an isometric city, driven live by Claude Agent SDK
sessions. `README.md` is the product and setup documentation; **this file is
how to work in the codebase.** Read it before touching the game layer.

---

## Commands

```bash
pnpm dev         # server + web against this repo
pnpm test        # vitest in every package that has tests
pnpm typecheck   # tsc --noEmit everywhere
pnpm build       # build all workspaces

pnpm --filter @sudo-city/web test          # one workspace
pnpm --filter @sudo-city/cli start -- ../other-repo
```

Node >= 22.5, pnpm 11.10. **Always run `pnpm typecheck` and `pnpm test` before
calling a change done** — there is no linter, so the compiler and the suite are
the only gates.

Web app: `http://127.0.0.1:5173`. Server WebSocket: `ws://127.0.0.1:4100/ws`.

---

## The pipeline

Everything downstream of a repo scan is a pure transform until it reaches
Phaser. Know where you are in this chain before changing anything:

```
repo ──worldgen──> WorldMap ──layout──> WorldSnapshot ──buildTerrain──> TerrainGrid ──WorldScene──> sprites
       (files,                (districts,              (per-tile kind,      (baked textures,
        imports,               plots, size)              road masks,          depth-sorted)
        churn)                                           props)
```

| Workspace | Responsibility |
| --- | --- |
| `packages/worldgen` | Scans a repo into a `WorldMap`. |
| `packages/layout` | `WorldMap` → `WorldSnapshot`: treemap districts, plot allocation. |
| `packages/protocol` | Shared zod schemas **and shared geometry constants**. |
| `packages/world` | SQLite persistence (`.sudocity/world.db` in the target repo). |
| `packages/agent` | Agent SDK sessions → `GameEvent`s. |
| `packages/cities` | PR worktrees and diff overlays. |
| `apps/server` | Fastify + WS: scan, snapshot per city, relay commands. |
| `apps/web` | Vite + React + Phaser client. |
| `apps/cli` | Boots server + web against a target repo. |

### Facts that bite

- **Plots are persisted.** `layoutWorld` takes `previousPlots` and keeps a
  file's plot across revisions so buildings don't shuffle. If you change what
  makes a plot invalid, handle the persisted-but-now-invalid case explicitly —
  otherwise stale worlds render wrong until someone regenerates them.
- **A PR city must be geometrically identical to `main`.** `squarify` reweights
  every rectangle when a single file's line count changes, so PR cities pass
  `main`'s own `snapshot.districts` and size. Never recompute districts for a PR.
- **Plots sit on odd lanes, streets on even ones.** `findPlotInDistrict` insets
  by 1 and steps 2; `BLOCK_STRIDE` is 6. That invariant is what guarantees a
  building is never planted on a street. Don't break it from either side.
- **Snapshots can be served from cache.** A change to layout rules doesn't
  retroactively fix worlds already generated. Renderer-side backstops are
  sometimes warranted (see the capitol reserve).

---

## The isometric world

This is where most of the work — and nearly all of the subtle breakage — lives.

### The one formula

`apps/web/src/game/iso.ts` places tiles; `createBaker().at()` in
`textures.ts` draws inside a texture. Same projection:

```
screenX = originX + (u - v) * HALF_W      // HALF_W = 48
screenY = originY + (u + v) * HALF_H - z  // HALF_H = 24
```

A `Point3` is `[u, v, z]` — **u and v are tile units on the ground plane, z is
pixels straight up.** Never mix them.

| You want | Do this |
| --- | --- |
| Move right on screen | `+u` and `−v` equally |
| Move up on screen | `−u` and `−v` equally |
| Move down-right | `+u` alone |
| Move down-left | `+v` alone |

Consequences worth memorising:

- **`u + v` is depth.** Larger is nearer the camera. It is the sort key for
  `setDepth`, for face order inside a bake, and for the order in which the
  masses of one prop are drawn.
- **`u − v` is the whole of screen x.** A quad whose corners share the same
  `u − v` has *zero width* and renders as nothing. Vertical elements with
  extent in both ground axes must be boxes.
- **`+u` and `+v` are 127° apart on screen, not 90°.** This is why sprites can
  never be rotated — see `isometric-animation`.

### Everything is baked, nothing is live

Props are drawn once into a Graphics, baked to a GPU texture, and instantiated
as sprites. A live Graphics per object is a draw call per object. **The unit of
work is a `bake*` function, not a render loop.**

Terrain goes further: every ground tile is a frame of one atlas
(`TERRAIN_ATLAS_KEY`), so the whole plane batches. Adding a `TerrainKind` means
adding a variant count and a bake, and it stays batched — that is cheap and
usually the right move.

> `WorldScene.ts` uses individual Sprites for ground tiles on purpose. A
> Blitter batches them into one object but silently stops drawing partway
> through a field this size, and a renderer that quietly loses terrain is worse
> than one that costs frames. Don't "optimise" it back.

### Ground belongs to terrain, not to a prop

The single most expensive lesson from building the capitol. Baking a landmark's
grounds — lawn, forecourt, the road ringing it — into its texture produces, all
at once: a grey plate laid over the city hiding real buildings; a hard clipped
edge where the canvas ran out; grass that doesn't match the field's grass; and
a road that cannot connect to the street grid.

Lay grounds as terrain cells. Then the ring road is classified `road` like any
other street, `roadMaskAt` solves its connectivity for free, and a city lane
running into the landmark forms a proper T-junction.

**Only sub-tile detail is baked** — the grid has no half tiles, so a half-tile
apron is part of the sprite and simply overhangs the terrain beneath it.

### Reserving ground for a landmark

Two independent consumers must agree on the same rectangle: the layout
allocator, which hands files their plots, and the renderer's terrain pass.
Disagreement plants an office block through the rotunda.

- Extents live in `packages/protocol` — the package both already import. Never
  a copy on each side.
- Enforce in `layoutWorld` by pre-seeding `occupied`; both the district search
  and the overflow search then step over the reserve for free, and stale
  persisted plots get reallocated by the check that already exists.
- Export a `*Fits(size)` guard. A 12-tile city is smaller than the reserve, and
  a field that can't host the landmark should have none rather than a monument
  covering the whole town.
- A multi-tile sprite gets **one** depth key, taken from the **front** of its
  footprint. Sorting by the centre tile lets a building standing in front of
  the facade vanish behind it.
- Size the reserve outward from the building, one layer at a time, and say so
  in a comment: `building | apron | lawn | boulevard`.

### Anchoring

```ts
const p = projection.project(gx, gy);
scene.add.sprite(p.x, p.y + PROP_ANCHOR_Y, KEY).setOrigin(0.5, 1);
// in the bake:  const originY = height - PROP_ANCHOR_Y;
```

`ANCHOR_Y` is how many pixels the texture reserves **below** its tile point.
Export one constant per prop and use it in both places — a mismatch slides the
prop off its own tile. Keep the drawing origin at `width / 2` unless you export
a normalised origin too.

Canvas sizes are **derived from the geometry**, never hardcoded; hardcoded ones
rot the moment the prop is resized. For anything large, assert the fit in a test
— clipping is silent.

### Lighting is fixed to the world

Sun upper-left: **`+v` face lit, `+u` face shaded, top lightest.** When a prop
is baked at several headings the shading must *not* rotate with it — shade from
where the normal ends up after the yaw, or the highlight spins and the object
reads as a turning picture.

For curved surfaces take the normal from the segment's **mid-angle as a unit
vector**. Deriving it from the edge makes its length scale with the radius,
which blows the shading out on anything small.

---

## Skills

Two skills carry the detail. **Load them — they exist because this stuff is not
guessable from the code.**

| Skill | When |
| --- | --- |
| `isometric-props` | Adding or reworking anything *drawn* into the world: landmarks, buildings, vehicles, terrain kinds, textures, placement modules. |
| `isometric-animation` | Anything that *moves*: vehicles, machinery, cutscenes, camera work. |

`isometric-props` covers the projection contract, canvas sizing, which faces to
plate, depth-ordering the masses of one prop, curves and domes, roofs, palettes,
grounds-as-terrain, reserving map space, and how to verify a bake.
`isometric-animation` covers why rotation is forbidden and what to do instead,
pose-driven assemblies, paths and headings, and cutscene sequencing.

Both end in a checklist. Use it.

---

## Conventions

### Comments explain why, with the failure that motivated them

This codebase's comments are unusually load-bearing and that is deliberate.
The pattern is: state the rule, then name the concrete thing that broke.

```ts
// Jitter the shoreline so the island is not a rounded rectangle. Only ever
// applied outside the city, so it can never erode buildable ground -- and
// damped to nothing along the port frontage, where it would otherwise leave
// sand standing through a quay and under a moored hull.
```

A comment that only restates the code is noise. A comment that records *the bug
this prevents* stops someone undoing the fix. Match the surrounding density —
which, in `game/` and the pure modules, is high.

### British spelling

`colour`, `neighbours`, `manoeuvre`, `normalised`, `centre`. The codebase is
consistent; match it.

### Pure modules have no Phaser import

Geometry and layout live in their own files — `terrain.ts`, `harbour.ts`,
`airport.ts`, `capitol.ts`, `coast.ts` — with **no Phaser import**, so they are
unit-testable in plain node. The scene consumes a layout object and does sprite
work only. Keep that line clean; it is why the game layer has real tests at all.

### No magic numbers

Anchor every measurement to something real (`COUNTRYSIDE_RING`, the mooring
lane, the building's own extents), and derive dependent geometry rather than
repeating it. Name screen-space nudges as one constant per axis
(`LIGHTHOUSE_GAP` / `LIGHTHOUSE_INSET`) so they can be tuned without hunting
through u/v literals.

### Test properties, not tuned numbers

The numbers are knobs and will move. Assert the invariant:

- "the board is the right-most prop on the quay"
- "no stack is within 0.9 tiles of the set-down"
- "no file's plot lands inside the reserve"
- "every drawn point is inside the canvas"
- "the highest point is on the building's centre line"

A test that pins a tuned constant fails on every visual adjustment and teaches
nothing.

---

## Verifying visual work

You cannot see a baked texture, and its failures are silent. Two cheap tools,
both proven:

**A recording Graphics.** A `bake*` only needs `fillStyle`, `fillPoints`,
`lineStyle`, `strokePoints`, `fillRect`, `lineBetween`, `generateTexture`. Stub
those, `vi.mock("phaser")` for `Vector2` and `Display.Color`, and the real bake
runs in a plain node test — no DOM, no WebGL. See
`apps/web/src/game/capitolTextures.test.ts`.

**Render it to SVG and look at it.** The same recording emits one `<polygon>`
per `fillPoints`; `qlmanage -t -s 1500 -o <dir> file.svg` turns it into a PNG.
Every real defect in the capitol — columns that projected to zero width, a
pediment reading as a lean-to shed, stairs invisible against their own slab, a
balustrade hanging off the far corner — was found by looking at one render.
Reading the code found none of them.

Keep the assertions in the suite; delete the SVG harness once the prop is right.

To see it in the actual app, use the `run` skill rather than inventing a launch
sequence.

---

## Things that will bite you

- **Source order is not depth order.** With no depth buffer, whatever fills
  last wins. A prop's masses must be drawn from a list sorted by near-corner
  `u + v`. The capitol's connectors were written after its wings and were
  painted over them; it read as a spare building parked on the roof.
- **Zero-width quads.** See the projection notes above. Thirty peristyle
  columns rendered as nothing at all.
- **Sloped planes are enormous.** A plane gaining both `u` and `v` covers a
  huge amount of screen. Honest pitched roofs read as lean-to sheds; use a flat
  deck with a gable parapet instead.
- **Pure white is a hole in the map.** `#ffffff` against saturated green reads
  as a gap. Warm the stone slightly and let shaded faces go properly grey.
- **The decoration budget deletes designed planting.** Terrain thins props to a
  quota; a landmark's avenue of trees must opt out (`keepProp`) or half of it
  vanishes at random and the symmetry goes with it.
- **Faces you "never see" come round when a prop rotates.** A prop baked at
  multiple headings must be plated all the way round, with face-painted detail
  guarded by a visibility test.
- **Sprites in `propSprites` / `groundSprites` are destroyed on redraw.**
  Anything you add to the scene needs an owner and a teardown path, or it
  survives a city change as a ghost.

---

## Scope discipline

The game layer is easy to wander in — one visual fix suggests three more. Do
what was asked, note what else you saw, and let the user decide.
