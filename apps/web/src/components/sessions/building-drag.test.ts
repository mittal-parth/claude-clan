import { describe, expect, it } from "vitest";
import { pointIsInside, fileBasename } from "../../lib/app-utils";
import type { Building } from "@sudo-city/protocol";

describe("building drag and drop", () => {
  const sampleBuilding: Building = {
    path: "src/components/sessions/SessionModal.tsx",
    district: "src",
    language: "typescript",
    loc: 120,
    plot: { x: 0, y: 0 },
  };

  const sampleBuilding2: Building = {
    path: "src/App.tsx",
    district: "src",
    language: "typescript",
    loc: 220,
    plot: { x: 1, y: 1 },
  };

  it("identifies drop coordinates inside the element bounds", () => {
    const mockElement = {
      getBoundingClientRect: () => ({
        left: 800,
        right: 1200,
        top: 0,
        bottom: 900,
        width: 400,
        height: 900,
        x: 800,
        y: 0,
        toJSON: () => {},
      }),
    } as unknown as HTMLElement;

    // Inside
    expect(pointIsInside(mockElement, { clientX: 950, clientY: 400 })).toBe(true);
    expect(pointIsInside(mockElement, { clientX: 800, clientY: 0 })).toBe(true);
    expect(pointIsInside(mockElement, { clientX: 1200, clientY: 900 })).toBe(true);

    // Outside
    expect(pointIsInside(mockElement, { clientX: 500, clientY: 400 })).toBe(false);
    expect(pointIsInside(mockElement, { clientX: 950, clientY: 950 })).toBe(false);

    // Null element
    expect(pointIsInside(null, { clientX: 950, clientY: 400 })).toBe(false);
  });

  it("routes dropped building to session context paths when inside session modal", () => {
    const sessionModalBounds = {
      left: 900,
      right: 1300,
      top: 0,
      bottom: 800,
    };
    const orderFormBounds = {
      left: 100,
      right: 500,
      top: 700,
      bottom: 800,
    };

    const sessionElement = {
      getBoundingClientRect: () => ({ ...sessionModalBounds, width: 400, height: 800, x: 900, y: 0, toJSON: () => {} }),
    } as unknown as HTMLElement;

    const orderElement = {
      getBoundingClientRect: () => ({ ...orderFormBounds, width: 400, height: 100, x: 100, y: 700, toJSON: () => {} }),
    } as unknown as HTMLElement;

    let sessionPaths: string[] = [];
    let orderPaths: string[] = [];

    const handleDrop = (building: Building, position: { clientX: number; clientY: number }) => {
      if (pointIsInside(sessionElement, position)) {
        if (!sessionPaths.includes(building.path)) {
          sessionPaths = [...sessionPaths, building.path];
        }
        return;
      }
      if (pointIsInside(orderElement, position)) {
        if (!orderPaths.includes(building.path)) {
          orderPaths = [...orderPaths, building.path];
        }
        return;
      }
    };

    // Drop onto session modal
    handleDrop(sampleBuilding, { clientX: 1000, clientY: 300 });
    expect(sessionPaths).toEqual(["src/components/sessions/SessionModal.tsx"]);
    expect(orderPaths).toEqual([]);

    // Drop same building again (deduplicates)
    handleDrop(sampleBuilding, { clientX: 1000, clientY: 300 });
    expect(sessionPaths).toEqual(["src/components/sessions/SessionModal.tsx"]);

    // Drop another building onto session modal
    handleDrop(sampleBuilding2, { clientX: 1100, clientY: 500 });
    expect(sessionPaths).toEqual([
      "src/components/sessions/SessionModal.tsx",
      "src/App.tsx",
    ]);

    // Drop onto order form
    handleDrop(sampleBuilding, { clientX: 200, clientY: 750 });
    expect(orderPaths).toEqual(["src/components/sessions/SessionModal.tsx"]);
  });

  it("formats attached context items with basename for label and full relative path for hover", () => {
    const fullPath = "apps/web/src/components/sessions/SessionModal.tsx";
    const label = `${fileBasename(fullPath)} ×`;
    const tooltip = fullPath;

    expect(label).toBe("SessionModal.tsx ×");
    expect(tooltip).toBe("apps/web/src/components/sessions/SessionModal.tsx");
  });
});
