import { describe, expect, it } from "vitest";
import { createAirportLayout } from "./airport";
import {
  AD_BILLBOARD_COUNT,
  BILLBOARD_FACINGS,
  BILLBOARD_FRAME_INSET,
  BILLBOARD_SIZES,
  BILLBOARD_SPECS,
  ISOMETRIC_FACINGS,
  SPONSORS,
  adBillboardSlots,
  assignSponsors,
  billboardPanelTransform,
  halfSpanOf,
  repoBillboardSlot,
  type BillboardFacing,
  type BillboardSize,
} from "./billboards";
import { COUNTRYSIDE_RING } from "./rings";

const SIZES: BillboardSize[] = BILLBOARD_SIZES;
/** Only these two carry a shear; "screen" is deliberately upright. */
const FACINGS: BillboardFacing[] = [...ISOMETRIC_FACINGS];

/** fieldSizeFor never goes below 12, and real repositories run far larger. */
const CITY_SIZES = [12, 16, 24, 40, 64, 96];

describe("SPONSORS", () => {
  it("gives every advertiser bundled artwork and a backing colour", () => {
    for (const sponsor of SPONSORS) {
      expect(sponsor.name.length).toBeGreaterThan(0);
      expect(sponsor.artwork).toMatch(/^\/ads\/.+\.(png|webp|svg|jpg)$/);
      expect(sponsor.background).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("only ever carries an absolute https link, when it carries one at all", () => {
    for (const sponsor of SPONSORS) {
      if (sponsor.url !== undefined) {
        expect(sponsor.url).toMatch(/^https:\/\//);
      }
    }
  });

  it("has enough advertisers to fill every board without repeating", () => {
    expect(SPONSORS.length).toBeGreaterThanOrEqual(AD_BILLBOARD_COUNT);
    const ids = SPONSORS.map((sponsor) => sponsor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("repoBillboardSlot", () => {
  it("stands behind the airport terminal, turned 90 deg anticlockwise to face right", () => {
    for (const size of CITY_SIZES) {
      const slot = repoBillboardSlot(size);
      const airport = createAirportLayout(size, size);

      // Sits behind the terminal along the constant-x plane, facing right.
      expect(slot.facing).toBe("right");
      expect(slot.size).toBe("large");
      expect(slot.y).toBeLessThan(airport.runwayStart.y);
    }
  });

  it("tracks the terminal rather than the field centre when the city grows", () => {
    const small = repoBillboardSlot(16);
    const large = repoBillboardSlot(64);
    expect(large.y - 64).toBeCloseTo(small.y - 16);
    expect(large.x).toBe(small.x);
  });

  it("clears the access road and the runway so nothing overlaps", () => {
    for (const size of CITY_SIZES) {
      const slot = repoBillboardSlot(size);
      const airport = createAirportLayout(size, size);

      // Sits west of access road and north of runway.
      expect(slot.x).toBeLessThan(airport.accessRoadStart.x);
      expect(slot.y).toBeLessThan(airport.runwayStart.y);
    }
  });
});

describe("adBillboardSlots", () => {
  it("places the requested count of perimeter boards", () => {
    for (const size of CITY_SIZES) {
      const slots = adBillboardSlots(size, size);
      expect(slots).toHaveLength(AD_BILLBOARD_COUNT);
    }
  });

  it("sits outside the city grid, inside the countryside ring", () => {
    for (const size of CITY_SIZES) {
      const slots = adBillboardSlots(size, size);
      for (const slot of slots) {
        const outsideCity = slot.x < 0 || slot.x >= size || slot.y < 0 || slot.y >= size;
        expect(outsideCity).toBe(true);

        const insideRing =
          slot.x >= -COUNTRYSIDE_RING &&
          slot.x < size + COUNTRYSIDE_RING &&
          slot.y >= -COUNTRYSIDE_RING &&
          slot.y < size + COUNTRYSIDE_RING;
        expect(insideRing).toBe(true);
      }
    }
  });

  it("places one slot on the north edge and one near the naval base road", () => {
    for (const size of CITY_SIZES) {
      const slots = adBillboardSlots(size, size);
      const north = slots.find((s) => s.y < 0);
      const naval = slots.find((s) => s.x >= size);
      expect(north).toBeDefined();
      expect(naval).toBeDefined();
      expect(naval?.size).toBe("square");
    }
  });

  it("faces every perimeter board square to the screen so posters stay upright", () => {
    const slots = adBillboardSlots(40, 40);
    expect(slots.every((slot) => slot.facing === "screen")).toBe(true);
  });
});

describe("assignSponsors", () => {
  const slots = adBillboardSlots(40, 40);

  it("pairs every slot with a sponsor, placing Basecamp near the naval base road", () => {
    const placements = assignSponsors(slots, "mittal-parth/claude-clan");
    expect(placements).toHaveLength(slots.length);
    const basecamp = placements.find((p) => p.sponsor.id === "basecamp");
    expect(basecamp).toBeDefined();
    expect(basecamp?.slot.x).toBeGreaterThanOrEqual(40);
  });

  it("is deterministic for a repo key", () => {
    const first = assignSponsors(slots, "mittal-parth/claude-clan");
    const second = assignSponsors(slots, "mittal-parth/claude-clan");
    expect(first.map((placement) => placement.sponsor.id)).toEqual(
      second.map((placement) => placement.sponsor.id),
    );
  });

  it("never shows the same advertiser twice in one city", () => {
    for (const key of ["demo", "a/b", "mittal-parth/claude-clan", "x/y-z"]) {
      const ids = assignSponsors(slots, key).map(
        (placement) => placement.sponsor.id,
      );
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("refills the roster rather than running dry when boards outnumber sponsors", () => {
    const many = Array.from({ length: SPONSORS.length + 3 }, () => slots[0]!);
    const placements = assignSponsors(many, "demo");
    expect(placements).toHaveLength(many.length);
    for (const placement of placements) {
      expect(placement.sponsor).toBeDefined();
    }
  });

  it("returns nothing for no slots", () => {
    expect(assignSponsors([], "demo")).toEqual([]);
  });
});

describe("billboardPanelTransform", () => {
  /** Applies the canvas matrix the same way ctx.setTransform would. */
  function place(
    transform: ReturnType<typeof billboardPanelTransform>,
    x: number,
    y: number,
  ): { x: number; y: number } {
    return {
      x: transform.offsetX + x,
      y: transform.offsetY + x * transform.shear + y,
    };
  }

  it("shears rather than rotates, one way per grid-aligned facing", () => {
    for (const size of SIZES) {
      expect(billboardPanelTransform(size, "left").shear).toBe(0.5);
      expect(billboardPanelTransform(size, "right").shear).toBe(-0.5);
    }
  });

  it("leaves a screen-facing board upright, with no shear at all", () => {
    for (const size of SIZES) {
      const transform = billboardPanelTransform(size, "screen");
      expect(transform.shear).toBe(0);
      // Square to the camera means the canvas is just the slab plus its legs.
      const spec = BILLBOARD_SPECS[size];
      expect(transform.canvasHeight).toBeLessThan(
        billboardPanelTransform(size, "left").canvasHeight,
      );
      expect(transform.canvasHeight).toBeGreaterThanOrEqual(
        spec.legHeight + spec.panelHeight,
      );
    }
  });

  it("sizes the artwork area to the panel less its frame on both edges", () => {
    for (const size of SIZES) {
      const spec = BILLBOARD_SPECS[size];
      for (const facing of FACINGS) {
        const transform = billboardPanelTransform(size, facing);
        expect(transform.contentWidth).toBe(
          spec.panelWidth - BILLBOARD_FRAME_INSET * 2,
        );
        expect(transform.contentHeight).toBe(
          spec.panelHeight - BILLBOARD_FRAME_INSET * 2,
        );
      }
    }
  });

  it("reserves canvas height for the sheared face plus the legs", () => {
    for (const size of SIZES) {
      const spec = BILLBOARD_SPECS[size];
      for (const facing of FACINGS) {
        const transform = billboardPanelTransform(size, facing);
        // The shear spreads the face over panelWidth / 2 of extra height.
        const overhang = spec.panelWidth / 2;
        expect(transform.canvasHeight).toBeGreaterThanOrEqual(
          overhang + spec.legHeight + spec.panelHeight,
        );
        expect(transform.canvasWidth).toBeGreaterThanOrEqual(spec.panelWidth);
      }
    }
  });

  it("keeps every artwork corner inside the canvas, so nothing is clipped", () => {
    for (const size of SIZES) {
      for (const facing of BILLBOARD_FACINGS) {
        const transform = billboardPanelTransform(size, facing);
        const corners = [
          [0, 0],
          [transform.contentWidth, 0],
          [0, transform.contentHeight],
          [transform.contentWidth, transform.contentHeight],
        ] as const;
        for (const [x, y] of corners) {
          const point = place(transform, x, y);
          expect(point.x).toBeGreaterThanOrEqual(0);
          expect(point.y).toBeGreaterThanOrEqual(0);
          expect(point.x).toBeLessThanOrEqual(transform.canvasWidth);
          expect(point.y).toBeLessThanOrEqual(transform.canvasHeight);
        }
      }
    }
  });

  it("mirrors the two facings about the canvas centre", () => {
    for (const size of SIZES) {
      const left = billboardPanelTransform(size, "left");
      const right = billboardPanelTransform(size, "right");
      expect(right.canvasWidth).toBe(left.canvasWidth);
      expect(right.canvasHeight).toBe(left.canvasHeight);
      expect(right.anchorY).toBe(left.anchorY);

      // A left board's top-left corner and a right board's top-right corner
      // are the same point reflected across the vertical axis.
      const leftCorner = place(left, 0, 0);
      const rightCorner = place(right, right.contentWidth, 0);
      expect(leftCorner.x + rightCorner.x).toBeCloseTo(left.canvasWidth, 5);
      expect(rightCorner.y).toBeCloseTo(leftCorner.y, 5);
    }
  });

  it("anchors the sprite so the projected tile centre lands at the posts' feet", () => {
    for (const size of SIZES) {
      const transform = billboardPanelTransform(size, "left");
      // origin (0.5, 1) means the sprite foot sits anchorY below the tile
      // centre; the canvas must extend exactly that far past it.
      expect(transform.anchorY).toBeGreaterThan(0);
      expect(transform.anchorY).toBeLessThan(transform.canvasHeight);
    }
  });

  it("gives the large board a bigger face than the small one", () => {
    const small = billboardPanelTransform("small", "left");
    const large = billboardPanelTransform("large", "left");
    expect(large.contentWidth).toBeGreaterThan(small.contentWidth);
    expect(large.contentHeight).toBeGreaterThan(small.contentHeight);
  });

  it("keeps the square board square", () => {
    const square = billboardPanelTransform("square", "left");
    expect(square.contentWidth).toBe(square.contentHeight);
  });

  it("handles every declared size, so the spec table is the only definition", () => {
    expect(BILLBOARD_SIZES.length).toBe(Object.keys(BILLBOARD_SPECS).length);
    for (const size of BILLBOARD_SIZES) {
      for (const facing of BILLBOARD_FACINGS) {
        const transform = billboardPanelTransform(size, facing);
        expect(transform.contentWidth).toBeGreaterThan(0);
        expect(transform.contentHeight).toBeGreaterThan(0);
        expect(transform.canvasWidth).toBeGreaterThan(0);
        expect(transform.canvasHeight).toBeGreaterThan(0);
      }
    }
  });

  it("only lets a sponsor ask for a shape that exists", () => {
    for (const sponsor of SPONSORS) {
      if (sponsor.size !== undefined) {
        expect(BILLBOARD_SIZES).toContain(sponsor.size);
      }
    }
  });
});
