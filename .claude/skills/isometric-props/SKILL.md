---
name: isometric-props
description: Design and bake isometric props for the city — landmarks (harbour, airport), vehicles (ships, aircraft, cranes), buildings and quayside furniture. Covers the projection contract, texture anchoring and canvas sizing, which faces to plate, world-fixed lighting, silhouette legibility, palettes, colour variants, and the pure layout modules that place them. Use when adding or reworking anything drawn into the Phaser world.
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

## 7. Making it legible

The world is usually viewed zoomed out. In order of importance:

- **Silhouette.** If it is not recognisable as a black shape, no amount of
  detail saves it. Give landmarks a distinct roofline — the lighthouse's
  tapered tower and dome, the crane's lattice jib, the terminal's deep roof.
- **Two or three accent colours, used sparingly.** The airport's gold fascia
  and the harbour's amber quay line are the same accent — that shared note is
  what makes two very different landmarks read as one city.
- **Detail last**, and only where it survives the projection. Corrugation lines
  at 0.06-tile spacing read as texture; at 0.02 they read as noise.

Author a **palette object per landmark** (`AIRPORT`, `HARBOUR`), never inline
hex. Give the sibling landmark a deliberately different temperature — the
airport is cool concrete and glass, the harbour is warm stone, tar and timber —
but keep the shared accent.

## 8. Non-box shapes

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

## 9. Variants

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

## 10. Placement lives in a pure module

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

## Checklist

- [ ] `ANCHOR_Y` exported and used in both the bake and the placement
- [ ] Canvas sized from extents; far-top and near-bottom corners checked
- [ ] Drawing origin at `width / 2`, or a normalised origin exported
- [ ] Contact shadow before anything else
- [ ] If baked at rotations: plated all round, details face-guarded, shading
      computed from the rotated normal
- [ ] Palette object, shared accent with its sibling landmark
- [ ] Silhouette legible at fit zoom
- [ ] Layout in a pure module with property-based tests
