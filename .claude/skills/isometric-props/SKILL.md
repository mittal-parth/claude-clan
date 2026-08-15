---
name: isometric-props
description: Design and bake isometric props for the city — landmarks (harbour, airport, capitol), vehicles (ships, aircraft, cranes), buildings and quayside furniture. Covers the projection contract, texture anchoring and canvas sizing, which faces to plate, depth-ordering the masses of one prop, curved surfaces (cylinders, domes, colonnades), roofs, world-fixed lighting, silhouette legibility, palettes, colour variants, reserving map ground for a landmark, and the pure layout modules that place them. Use when adding or reworking anything drawn into the Phaser world.
---

# Designing isometric props

Everything in the world is **drawn once into a Graphics object, baked to a GPU
texture, and instantiated as sprites** (`apps/web/src/game/textures.ts`). A live
Graphics per object is a draw call per object; sprites from a baked texture
batch. So the unit of work is a `bake*` function, not a render loop.

## 1. The projection contract

One formula governs everything. From `createBaker().at()`:

```
screenX = originX + (u - v) * HALF_W      // HALF_W = 48
screenY = originY + (u + v) * HALF_H - z  // HALF_H = 24
```

A `Point3` is `[u, v, z]`: **u and v are tile units on the ground plane, z is
pixels straight up.** Never mix them.

Four consequences you will use constantly:

| You want | Do this | Because |
|---|---|---|
| Move **right** on screen | `+u` and `−v` equally | screenX is `(u − v)` |
| Move **up** on screen | `−u` and `−v` equally | screenY is `(u + v)` |
| Move **down-right** | `+u` alone | +u is `(+48, +24)` |
| Move **down-left** | `+v` alone | +v is `(−48, +24)` |

> When someone says "move it left" or "further inland", they mean *screen*
> space. Convert with the pairs above and express the result as two named
> constants (one per screen axis), not as fiddled u/v literals. See
> `LIGHTHOUSE_GAP` / `LIGHTHOUSE_INSET` and `SIGN_LEFT` / `SIGN_INSET` in
> `harbour.ts` — each is a single number the user can nudge.

**Grid `+u` and `+v` are 127° apart on screen, not 90°.** This is the single
most important fact in this file. It is why you cannot rotate sprites (§6 of
`isometric-animation`).

### Zero width is a real failure mode

`screenX` depends only on `(u − v)`, so **any quad whose corners share the same
`u − v` projects to a line and disappears.** The capitol's peristyle was built
this way — each column a quad from `(cu−h, cv−h)` to `(cu+h, cv+h)` — and thirty
columns rendered as nothing at all, leaving a bare grey drum that read as
unfinished concrete.

A vertical element with width in *both* ground axes is a **box**, not a quad:

```ts
drawBox(baker, { u0: cu - h, u1: cu + h, v0: cv - h, v1: cv + h, z0, z1 }, ...);
```

A quad is only right when it lies in a plane of constant `u` or constant `v` —
a window on a wall, a balustrade run along one elevation. Whenever you write a
quad, check that two of its corners differ in `u − v`.

## 2. Anchoring: the tile point

A sprite is placed so that **`at([0,0,0])` lands on the projected grid point**:

```ts
const p = projection.project(gx, gy);
scene.add.sprite(p.x, p.y + PROP_ANCHOR_Y, KEY).setOrigin(0.5, 1);
// and in the bake:  const originY = height - PROP_ANCHOR_Y;
```

`ANCHOR_Y` is **how many pixels the texture reserves below its tile point** —
enough for the near half of the footprint plus any shadow. Export one constant
per prop (`HARBOUR_SHIP_ANCHOR_Y`, `AIRPORT_TERMINAL_ANCHOR_Y`) and use it in
both places; a mismatch slides the prop off its own tile.

Anything standing on a raised surface takes an extra lift:

```ts
.sprite(p.x, p.y + anchorY - HARBOUR_QUAY_DECK, key)  // deck height in px
```

**Never centre a wide prop with `setOrigin(0.5, 1)` on a canvas whose drawing
origin is not the horizontal centre.** The crane originally used
`originX = 76` on a 208px canvas, which silently drew it 28px left of its own
grid point. Either keep the drawing origin at `width / 2`, or export a
normalised origin alongside the key.

## 3. Size the canvas from the geometry

Hardcoded canvas sizes rot the moment the prop is resized. Derive them:

```ts
const spanX = (halfU + halfV) * HALF_W;   // widest screen half-width
const spanY = (halfU + halfV) * HALF_H;   // near/far half-height
const width  = Math.ceil(spanX * 2) + 16;              // + margin
const height = Math.ceil(spanY * 2) + deck + 24;
const originY = height - ANCHOR_Y;
```

Then check the extremes by hand before moving on — the far-top corner
(`min(u+v)`, max z) and the near-bottom corner (`max(u+v)`, min z, plus the
shadow offset). Content that clips is invisible at exactly the zoom level where
someone notices.

**If a prop will be baked at several rotations, size for the widest sweep, not
for one pose.** A hull that lies across the view trades width for height as it
yaws; the largest extent is at the intermediate angles. One square canvas sized
to that worst case keeps a single anchor valid for every frame.

**For anything large, assert the fit instead of trusting the arithmetic.**
Clipping is silent — the capitol shipped with its frontage sliced off along a
hard horizontal line, and nothing failed. Drive the real bake through a
recording Graphics and check where the points actually landed (§14):

```ts
expect(minX).toBeGreaterThanOrEqual(0);
expect(maxY).toBeLessThanOrEqual(baked.height);
expect(lowest - (baked.height - ANCHOR_Y)).toBeLessThanOrEqual(ANCHOR_Y);
```

## 4. Which faces to plate

For a box, the viewer sees the **top**, the **+u face** and the **+v face**.
Those three tile the silhouette hexagon exactly — draw them and nothing is
missing; the −u and −v faces project *inside* the silhouette and are covered.

That is what `harbourBox()` and `drawBox()` do, and it is correct **only while
the prop has one fixed orientation.**

> **The trap.** The moment you bake the prop at rotations past 90°, the faces
> that were "always hidden" come round to the front — and they were never
> drawn. The ship went hollow from the side exactly like this, because she sits
> at 180° from berthing until her turnaround.

So: **a prop baked at multiple headings must be plated all the way round.** See
`solidBox()` inside `bakeHarbourContainerShip` — four sides, sorted
**furthest-first** so whichever plate has come round to the front wins, then the
top. Back plates land inside the silhouette and are covered by the top face, so
drawing them always costs nothing but a fill.

The same applies to **face-painted details** — window bands, glazing, funnel
stripes, an anchor pocket. Guard each with a visibility test, or it gets stamped
onto the near side while belonging to the far one:

```ts
const showsFace = (nu: number, nv: number): boolean => {
  const n = turned(nu, nv);        // normal, rotated with the prop
  return n.u + n.v > 0.02;         // larger (u+v) is nearer the viewer
};
```

## 5. Lighting is fixed to the world, not to the object

Sun sits **upper-left**: the grid **+v** face is lit, the **+u** face is in
shade, the top is lightest. `drawBox()` encodes this with `palette.wall` /
`palette.wallShadow`.

When a prop rotates, the shading must **not** rotate with it. Shade each plate
by where its normal ends up *after* the yaw:

```ts
const facing = (nu: number, nv: number, color: number): number => {
  const n = turned(nu, nv);
  return shade(color, Math.round(9 * n.v - 28 * n.u));
};
```

Otherwise the highlight spins with the hull and the prop reads as a rotating
picture rather than a solid object under a fixed sun.

## 6. Draw order

1. **Ground contact** — shadow diamond/ellipse, offset down-right, alpha ~0.22.
2. **Far faces**, then **near faces** (sort by the rotated normal's `u + v`).
3. **Top faces.**
4. **Surface detail** — panel lines, corrugation, joints, paint.
5. **Face-specific detail** — windows, signage, badges (guarded, §4).
6. **Lights and glows** last.

Contact shadow first is what stops a prop looking like a sticker.

### Between the masses of one prop

A prop with several volumes needs the same discipline *between* them, and this
is where source order quietly betrays you. There is no depth buffer: whatever is
filled last wins. **Larger `(u + v)` is nearer the camera, so ascending `u + v`
is exactly painter's order.**

The capitol's connectors were written after its wings and were therefore painted
*over* them — the user reported it as "the right wing has an extra building on
top". The wing was fine; the connector behind it was simply drawn later.

Do not rely on where a call happens to sit in the function. State the order:

```ts
const masses = [
  { depth: -WING_INNER + BLOCK_FRONT, draw: () => drawWing(-WING_OUTER, -WING_INNER) },
  { depth: CENTER_HALF + CENTER_FRONT, draw: () => drawCenterBlock() },
  { depth: WING_OUTER + BLOCK_FRONT, draw: () => drawWing(WING_INNER, WING_OUTER) },
];
masses.sort((a, b) => a.depth - b.depth);
for (const mass of masses) mass.draw();
```

`depth` is the mass's **near corner** — the largest `u + v` it reaches. A sorted
list survives someone inserting a new volume in the middle; a hand-ordered run
of calls does not.

Two things legitimately ignore the sort:

- **Anything that stands above every mass** (a dome, a mast, a roof aerial) is
  drawn after all of them regardless of its footprint's depth.
- **Anything that projects nearer than every mass** (a portico, a stair, a
  gangway) is drawn last of all.

## 7. Curves: cylinders, domes and colonnades

A cylinder is a ring of quads plus a top face. Two rules, both learned the hard
way on the capitol's dome.

**Shade from a unit normal, never from the edge vector.** The outward normal of
an edge is `(dv, −du)`, but its *length* is proportional to the radius, so
feeding it straight into `shade()` scales the lighting by how big the cylinder
is. The lantern (r = 0.15) came out charcoal and the dome banded into a visible
wireframe as its tiers shrank toward the crown. Take the normal from the
segment's mid-angle instead:

```ts
const mid = (Math.PI * 2 * (i + 0.5)) / segments;
const color = shade(base, Math.round(9 * Math.sin(mid) - 28 * Math.cos(mid)));
```

**Sort the wall quads by depth and fill near-last**, or the far wall shows
through the near one. Return the sorted slices from a helper and reuse it for
every curved thing — drum, dome tier, saucer roof, fountain basin.

A **dome** is stacked cylinder bands: radius by `cos`, height by `sin`. A true
hemisphere looks squat, so ease the height with a power curve (`sin(t) ** 0.78`)
to pull the crown up — the silhouette is the whole landmark at fit zoom.
Meridian ribs go on afterwards, sampled from the same profile so they sit on the
surface, and only on the near half (`cos + sin > −0.25`).

A **colonnade** is the detail that turns a drum into architecture rather than a
silo. Draw a slightly smaller, darker cylinder as the recessed wall behind, then
the columns as boxes (§1 — quads vanish), depth-sorted, skipping the far side.
Keep the recess only a little darker than the shafts; near-black between widely
spaced columns reads as raw concrete.

**Size columns from their own radius.** A `columnHalf` tuned for a 30-column
peristyle at r = 0.94 merges into a solid post on a 10-column tholos at r = 0.2.
Pass it as a parameter.

## 8. Roofs, and why pediments lie

**A plane that gains both `u` and `v` covers an enormous amount of screen.**
This is the projection's most counter-intuitive consequence and it wrecks roofs.

A geometrically honest pedimented portico — two slopes meeting at a ridge
running back into the building — rendered the far slope as a dark grey mass
twice the width of the colonnade beneath it. The entire front of the capitol
read as a lean-to shed. The geometry was correct; the *reading* was wrong.

Use a **flat deck with a triangular gable standing on its front edge** instead:

```ts
fillFace(baker, roof, 1, [[-half, back, eave], [half, back, eave],
                          [half, vp, eave], [-half, vp, eave]], ...);   // deck
fillFace(baker, stoneLit, 1, [[-half, vp, eave], [half, vp, eave],
                              [0, vp, peak]], ...);                      // gable
strokeFace(baker, stoneShade, 0.9, 2, gable, ...);                       // raking cornice
```

At this scale that is what a viewer sees anyway, and the silhouette is crisper.
The stroke along the gable is doing real work — it is the line that makes the
triangle legible at all.

If you do draw true slopes, **draw them before the gable**, not after: the
slopes swallowed the tympanum when they came second.

## 9. Making it legible

The world is usually viewed zoomed out. In order of importance:

- **Silhouette.** If it is not recognisable as a black shape, no amount of
  detail saves it. Give landmarks a distinct roofline — the lighthouse's
  tapered tower and dome, the crane's lattice jib, the terminal's deep roof.
- **Two or three accent colours, used sparingly.** The airport's gold fascia
  and the harbour's amber quay line are the same accent — that shared note is
  what makes two very different landmarks read as one city.
- **Detail last**, and only where it survives the projection. Corrugation lines
  at 0.06-tile spacing read as texture; at 0.02 they read as noise.

Author a **palette object per landmark** (`AIRPORT`, `HARBOUR`, `CAPITOL`),
never inline hex. Give the sibling landmark a deliberately different temperature
— the airport is cool concrete and glass, the harbour is warm stone, tar and
timber — but keep the shared accent.

**Do not use pure white.** `#ffffff` against the field's saturated green reads
as a hole punched in the map. The capitol's marble is `#f4f2ea` with its shaded
faces going properly grey; that difference is what gives it mass.

### Detail that makes a big building read

A large blank mass is the hardest thing to make interesting. In rough order of
value per fill:

- **Horizontal lines.** A cornice, a string course, a plinth cap — a projecting
  band right around the box, drawn as a slightly oversized box at the top. This
  is most of what separates "civic building" from "warehouse".
- **Pilasters** between the window bays: two fills each, and the single biggest
  step from office block toward architecture.
- **Sills** under windows. Without them a window band is a row of stickers.
- **An attic set back** behind the cornice, and a **balustrade** along the roof
  line. Run the balustrade the block's own length — following the cornice's
  overhang left a rail and a post projecting past the far corner into open air.
- **Contrast on stairs.** Risers must be distinctly darker than treads, or the
  flight vanishes into whatever it stands on.

Keep accent metal small. A whole lamp standard in gold became an orange lump on
the part of the building the eye lands on first; a stone column with a gold lamp
head reads as a lamp.

## 10. Non-box shapes

A hull is not a box. `bakeHarbourContainerShip` builds the deck as a **sheer
line** — a run of `[u, v]` points down the starboard side — mirrored to give a
closed outline. That is what produces a real bow taper and a rounded transom
instead of a shoebox.

The hull plating then falls out of the outline for free: **drop every edge to
the waterline.**

```ts
for (let i = 0; i < outline.length; i += 1) {
  const [u0, v0] = outline[i]!;
  const [u1, v1] = outline[(i + 1) % outline.length]!;
  fillFace(baker, facing(v1 - v0, -(u1 - u0), hull.navy), 1,
    [[u0,v0,deck], [u1,v1,deck], [u1,v1,0], [u0,v0,0]], originX, originY);
}
```

The outward normal of edge `A→B` on a counter-clockwise outline is `(dv, −du)`.

## 11. Variants

Parameterise the bake function and cycle keys by index — same authored
arrangement, different paint. This is what makes six container stacks read as
one operation rather than a jumble.

```ts
export const HARBOUR_CARGO_KEYS = ["fx:harbour-cargo:0", ...] as const;
const VARIANTS = [{ crate: 0xb5834f, barrel: 0xc75434 }, ...];
function bakeHarbourCargo(baker: Baker, key: string, variant: number) { ... }
HARBOUR_CARGO_KEYS.forEach((k, i) => bakeHarbourCargo(baker, k, i));
```

**But when one object is meant to be *the same* object over time, pin a single
key** (`HARBOUR_CARGO_CONTAINER_KEY`). A per-city hash picked a different
livery at each end of the voyage and the shipped box changed colour in transit.

## 12. The ground under a landmark is terrain, not part of the prop

A big prop tempts you to bake its own grounds — lawn, forecourt, the road that
rings it — into the texture. **Don't.** The capitol did, and every consequence
was visible in a single screenshot:

- The plate was a grey rectangle **laid on top of the city**, hiding the
  buildings and streets underneath it.
- It **clipped at the canvas edge**, so the "rectangle" was cut off along one
  side by a hard horizontal line.
- Its baked grass **never matched** the grass it sat in — different green,
  different tile texture.
- Its baked road **could not connect** to the city's road grid. It just stopped.

Lay the grounds as ordinary terrain cells instead. Then the lawn *is* the map's
grass atlas, the paving *is* its pavement, and — the part that matters most —
the ring road is classified as `road` like any other street, so `roadMaskAt`
solves its connectivity along with everything else and a city lane running into
the landmark forms a proper T-junction for free.

**Need a material terrain doesn't have? Add a `TerrainKind`.** Adding `"plaza"`
(pavement, one variant, baked into the same atlas) was a handful of lines and
kept the walk batching with every other tile — far cheaper than a bespoke
texture that has to stay aligned with the road it meets.

**What still belongs in the sprite:** anything smaller than a tile. The grid has
no half tiles, so the capitol's half-tile apron is baked, and it simply overhangs
the terrain ring beneath it. Follow the building's silhouette in a few pieces
rather than boxing the whole footprint — a bounding-box apron puts dead stone in
the corners the wings never reach.

Keep the **contact shadow** either way. It is what stops the prop looking pasted
onto the grass.

### Designed planting beats scatter

Terrain thins decoration to a budget (`propOdds`). A landmark's planting must
opt out, or half its avenue of trees is deleted at random and the symmetry that
makes it read as designed is gone. Mark those cells (`keepProp`) and place them
deliberately — an unbroken row against the boulevard, mirrored on all four
sides, broken only where the approach crosses it.

## 13. Placement lives in a pure module

Geometry goes in its own file with **no Phaser import** — `airport.ts`,
`harbour.ts` — so it is unit-testable. The scene consumes a layout object and
only does sprite work.

- Anchor every measurement to something real (`COUNTRYSIDE_RING`, the mooring
  lane, the city edge), not to magic numbers.
- Derive dependent geometry rather than repeating it: the pier lays tiles until
  it runs out of clear water, so deepening the wharf cannot plank a deck under
  a ship's hull.
- Export a `*LayoutKey()` so the scene can skip rebuilding unchanged layouts.
- Test the *properties* ("the board is the right-most prop on the quay", "no
  stack is within 0.9 tiles of the set-down"), not the tuned numbers — the
  numbers are knobs and will move.

### Reserving ground the allocator must not use

A landmark standing inside the city field needs plots kept off it, and **two
independent consumers have to agree on the same rectangle**: the layout
allocator, which hands files their plots, and the renderer's terrain pass.
Disagreement plants an office block through the rotunda.

Put the extents in the package both already share (`@sudo-city/protocol`), never
a copy on each side, and enforce them where plots are actually assigned:

```ts
reserveCapitol({ width, height }, occupied);   // before a single file is placed
```

Pre-seeding `occupied` is enough — both the district search and the overflow
search step over it for nothing. It also handles plots **persisted from before
the landmark existed**: the same check that rejects an out-of-field plot now
reallocates a stranded one.

Three things that are easy to miss:

- **Guard small fields.** A twelve-tile city is smaller than the reserve.
  Export a `capitolFits(size)` both sides call, so a field that cannot host the
  landmark simply has none rather than a monument covering the whole town.
- **A multi-tile sprite needs one sort key, taken from its front.** Sorting by
  the centre tile lets a building standing in front of the facade vanish behind
  it. Use the near edge of the footprint.
- **Keep a renderer-side backstop.** A snapshot generated before the reserve
  existed and served from cache still carries old plots; skipping those
  buildings costs one sprite until the world is next laid out, and beats drawing
  through the landmark.

Size the reserve **outward from the building, one layer at a time**, and say so
in a comment — `building | apron | lawn | boulevard`. Then a change to the
building's extents has an obvious consequence for the reserve, instead of
silently eating the gap.

## 14. Verifying the bake

You cannot see a baked texture, and the failures are silent. Two cheap tools:

**A recording Graphics.** `bake*` only needs `fillStyle`, `fillPoints`,
`lineStyle`, `strokePoints`, `fillRect`, `lineBetween`, `generateTexture`. Stub
those (with `vi.mock("phaser")` for `Vector2` and `Display.Color`) and you can
drive the real bake in a plain node test — no DOM, no WebGL. Assert extents
(§3), and assert the shape of the thing: *"the highest point is on the centre
line"* catches a wing out-topping the dome.

**Render it to SVG.** The same recording emits `<polygon>` per `fillPoints`, and
`qlmanage -t` turns the SVG into a PNG you can actually look at. Every real
defect in the capitol — the zero-width columns, the lean-to pediment, the
stairs invisible against their own slab, the balustrade hanging off the far
corner — was found by looking at one render, not by reading the code.

Keep the assertions; delete the SVG harness once the prop is right.

## Checklist

- [ ] `ANCHOR_Y` exported and used in both the bake and the placement
- [ ] Canvas sized from extents; far-top and near-bottom corners checked, and
      asserted in a test for anything large
- [ ] Drawing origin at `width / 2`, or a normalised origin exported
- [ ] No quad whose corners share the same `u − v` (it renders as nothing)
- [ ] Contact shadow before anything else
- [ ] Multiple masses drawn from a list sorted by near-corner `u + v`, not in
      source order
- [ ] Curved surfaces shaded from a unit normal, wall quads depth-sorted
- [ ] If baked at rotations: plated all round, details face-guarded, shading
      computed from the rotated normal
- [ ] Palette object, no pure white, shared accent with its sibling landmark
- [ ] Silhouette legible at fit zoom; horizontal lines on any large mass
- [ ] Grounds are terrain cells, not a baked plate; only sub-tile detail baked
- [ ] If it stands in the field: extents shared via protocol, plots reserved in
      the allocator, small fields guarded, sprite depth taken from its front
- [ ] Layout in a pure module with property-based tests
- [ ] Looked at a render of it, not just the code
