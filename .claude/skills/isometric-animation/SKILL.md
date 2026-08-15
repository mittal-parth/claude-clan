---
name: isometric-animation
description: Animate isometric props — vehicles that turn and travel, working machinery like cranes, and multi-stage cutscenes such as a voyage between cities. Covers why sprite rotation is forbidden and what to do instead, pose-driven rigid assemblies, curved paths and headings, cutscene sequencing across a world swap, object ownership handoff, and teardown. Use when anything in the Phaser world needs to move.
---

# Animating isometric props

Read `isometric-props` first — the projection contract there is assumed here.

## 1. Never rotate an isometric sprite

`setRotation()` on a prop drawn in isometric reads as **a picture spinning**,
not an object turning. The reason is in the projection: grid `+u` and `+v` are
**127° apart on screen**, not 90°, so a quarter turn in the world is not a
quarter turn in the sprite plane. There is no angle you can pass that is right.

**Bake the rotation instead.** Rotating `(u, v)` about the object's pivot while
leaving `z` alone *is* a yaw, so one authored drawing gives you every heading:

```ts
const angle = (frame / FRAMES) * Math.PI * 2;
const cos = Math.cos(angle), sin = Math.sin(angle);
const baker: Baker = frame === 0 ? source : {
  ...source,
  at: (p, ox, oy) => source.at([p[0]*cos - p[1]*sin, p[0]*sin + p[1]*cos, p[2]], ox, oy),
};
```

Wrapping `at` turns every polygon, box, post and rail the drawing puts down, so
nothing below has to know which way the object is facing. For a pivot that is
not the origin (a crane's mast), subtract it, rotate, add it back — that point
is then the one the rotation leaves alone, which is exactly the point you
anchor the sprite on.

At runtime, pick the nearest baked frame:

```ts
const frame = ((Math.round(yaw / (Math.PI * 2) * count) % count) + count) % count;
if (sprite.texture.key !== KEYS[frame]) sprite.setTexture(KEYS[frame]!);
```

Keep yaw in **radians that wrap**, so a manoeuvre is one continuous sweep past
the compass rather than a special case at the seam.

**Frame budget.** Cost is `frames × w × h × 4` bytes.

| Sweep | Frames | Step | Feel |
|---|---|---|---|
| 90° (crane jib) | 7 | 15° | smooth for a ~0.6s slew |
| 360° (ship) | 24 | 15° | smooth for a ~1.6s turn |
| 360° | 12 | 30° | visibly stepped — too few |

Two frames can only ever snap. If a turn looks instant, the fix is more frames,
not more easing.

## 2. Pose objects for rigid assemblies

A crane is a portal, a jib, a trolley, a cable and a spreader that must stay
welded together through a slew. Do **not** tween each one.

Tween a single plain object and re-derive everything from it:

```ts
private harbourHoist = { du: 0.5, angle: 0, hoist: 10 };

this.tweens.add({
  targets: this.harbourHoist, du: 1.55, angle: 0, duration: 620,
  onUpdate: () => this.applyHoistPose(),
  onComplete: () => { this.applyHoistPose(); resolve(); },
});
```

`applyHoistPose()` is the single place that knows the geometry. Derive positions
in **world terms, then project** — never compose screen-space rotations:

```ts
const outU = du * Math.cos(angle);          // du tiles out along a yawed arm
const outV = du * Math.sin(angle);
const trolleyX = axis.x + (outU - outV) * HALF_W;
const trolleyY = axis.y + (outU + outV) * HALF_H - (TROLLEY_Y - SLEW_Y);
```

Getting this wrong is subtle: rotating the *screen* offset by the slew angle
looks almost right at small angles and falls apart at large ones.

## 3. Paths: put the turn in the path

- **A corner** (leave the berth, turn, run out) — a **quadratic** through the
  corner point. It rounds the turn into an arc, so the object carries its way
  through instead of hinging on the spot. Make both legs long enough to read
  straight.
- **A U-turn back to where you started** — a **cubic returning to its own
  start**. The two control points set how far it runs ahead before the swing
  and how wide it carries it.

```ts
const w = { a: (1-t)**2, b: 2*(1-t)*t, c: t*t };            // quadratic
sprite.setPosition(w.a*from.x + w.b*through.x + w.c*to.x, ...);
```

Build the control points from **named tile counts in the two screen headings**
(`ahead`, `seaward`), not pixel literals — then the shape survives a change to
the berth.

## 4. Heading must follow travel

**A reversed path needs reciprocal headings.** Reusing the outbound frames on
the inbound run sails the ship stern-first the whole way — it looks fine in
code and obviously broken on screen. If departure is `0 → 90°`, arrival is
`270° → 180°`, not `90° → 0°`.

Drive the yaw over a **sub-range** of the path so the straight legs stay on a
steady heading, and smoothstep it so the helm eases over:

```ts
const helm = Phaser.Math.Clamp((t - 0.28) / (0.72 - 0.28), 0, 1);
const eased = helm * helm * (3 - 2 * helm);
this.setYaw(from + (to - from) * eased);
```

If a vehicle ends a journey facing the wrong way to start the next one, **give
it a manoeuvre** rather than snapping it round: the ship works herself
end-for-end in the basin after unloading, which is both correct and the most
characterful beat in the sequence.

## 5. Carried objects

Anything riding on a moving prop needs its offset **re-derived every frame**,
and that offset changes with heading — a cargo bay swings around the hull as it
yaws. Bake one offset per frame and index it alongside the texture:

```ts
export const HARBOUR_SHIP_BAY_OFFSETS = KEYS.map((_, i) => { /* rotate the bay */ });
```

Sync from the carrier's current position, including during its idle bob, and
keep depth relative to the carrier.

## 6. Ownership handoff, not spawn and destroy

A container moves quay → spreader → hold → spreader → quay. Model that as
**one sprite changing hands**, with a field naming its current owner:

```ts
private liftQuayCargo(): void {
  const cargo = this.harbourQuayCargo;
  if (!cargo) return;
  this.harbourQuayCargo = undefined;
  this.harbourSpreaderCargo = cargo;   // same sprite, new owner
  this.applyHoistPose();
}
```

Two rules that came from bugs:

- **Objects must pre-exist.** The box waits on the quay from the moment the
  harbour is built. Spawning it at the hook made it appear out of nowhere.
- **Pin the appearance.** Picking a variant per city made the same box change
  colour between ports. If it is meant to be the same object, it is one key.

## 7. Cutscene sequencing

The voyage runs **cover → swap the world → reveal**, with the network fetch
racing the animation rather than following it:

```
coverForContainerVoyage()   load the box, sail out, close the clouds
  ↓  (destination snapshot arrives whenever it arrives)
scene.setWorld(destination)  swapped only once the clouds fully cover
prepareContainerArrival()    park the arriving prop off-frame
revealAfterContainerVoyage() part clouds, sail in, unload, turn round
```

Compose beats as awaited promises — each returns when its tween completes — so
the sequence reads as prose:

```ts
async revealAfterContainerVoyage(carries: boolean): Promise<void> {
  await this.partCloudCover();
  await this.playContainerShipArrival();
  if (carries) await this.playContainerUnload();
  await this.playContainerShipTurnaround();
}
```

`prepareContainerArrival` runs **after** `setWorld`, because `setWorld` tears
the harbour down and rebuilds it; anything you position before that is
discarded. It is also where cross-city state is reconciled — arriving loaded
clears the destination quay, so the box the crane lands is the one that
travelled, not a second copy.

## 8. Idle loops fight manoeuvres

A looping bob tween owns `y` forever. Before any manoeuvre, `killTweensOf` the
target; restart the idle **only when the whole sequence is done** — not when the
first leg lands, or the swell will drag the prop off its own path mid-turnaround.

Cache the rest position in sprite data (`restY`) and restore it explicitly; a
bob interrupted mid-cycle leaves the sprite a few pixels off.

## 9. Non-negotiables

- **`prefersReducedMotion()`** — every animation needs a branch that jumps to
  the end state and resolves. It must leave *exactly* the same state as the
  animated path.
- **Teardown** — `killTweensOf` every sprite, shape and pose object, then clear
  the named references. A tween holding a destroyed sprite is a crash on the
  next frame.
- **Guard on `travelTransitionActive`** — every pointer handler returns early
  during a transition; the clouds already hide the world, so a click cannot
  mean anything yet.
- **Ambient motion is not interaction.** Beacons, lamp glows and swell are
  decorative loops with `repeat: -1`; keep them out of the sequencing logic.

## Checklist

- [ ] No `setRotation` on an isometric prop — baked frames instead
- [ ] Enough frames that the turn does not step (≥15° resolution)
- [ ] One pose object per rigid assembly; positions derived in world terms
- [ ] Headings are reciprocal on a reversed path
- [ ] Yaw driven over a sub-range, smoothstepped
- [ ] Carried objects re-synced every frame, offsets per heading
- [ ] Moving objects pre-exist and change owner rather than spawning
- [ ] Reduced-motion branch reaches the identical end state
- [ ] Idle tweens killed before, restarted after, the full sequence
