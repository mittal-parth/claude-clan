import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/play-ui-click", () => ({
  playUiClickSound: vi.fn(),
}));

vi.mock("../../lib/play-ui-click", () => ({
  playUiClickSound: vi.fn(),
}));

function createMockSprite(key = "mock_key") {
  const data = new Map<string, unknown>();
  const sprite = {
    setOrigin: vi.fn().mockReturnThis(),
    setRotation: vi.fn().mockReturnThis(),
    setScale: vi.fn().mockReturnThis(),
    setAlpha: vi.fn().mockReturnThis(),
    setDepth: vi.fn().mockReturnThis(),
    setVisible: vi.fn().mockReturnThis(),
    setPosition: vi.fn().mockReturnThis(),
    setY: vi.fn().mockReturnThis(),
    setScrollFactor: vi.fn().mockReturnThis(),
    setData: vi.fn().mockImplementation((k: string, v: unknown) => {
      data.set(k, v);
      return sprite;
    }),
    getData: vi.fn().mockImplementation((k: string) => data.get(k) ?? 0),
    setTexture: vi.fn().mockReturnThis(),
    setInteractive: vi.fn().mockReturnThis(),
    setBlendMode: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
    texture: { key },
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    depth: 0,
    destroy: vi.fn(),
  };
  return sprite;
}

function createMockGraphics() {
  const data = new Map<string, unknown>();
  const graphics = {
    setOrigin: vi.fn().mockReturnThis(),
    setScrollFactor: vi.fn().mockReturnThis(),
    setDepth: vi.fn().mockReturnThis(),
    setPosition: vi.fn().mockReturnThis(),
    setAlpha: vi.fn().mockReturnThis(),
    fillStyle: vi.fn().mockReturnThis(),
    fillCircle: vi.fn().mockReturnThis(),
    setData: vi.fn().mockImplementation((k: string, v: unknown) => {
      data.set(k, v);
      return graphics;
    }),
    getData: vi.fn().mockImplementation((k: string) => data.get(k) ?? 0),
    destroy: vi.fn(),
  };
  return graphics;
}

vi.mock("phaser", () => {
  class Scene {
    sys = { events: { on: vi.fn(), once: vi.fn() } };
    cameras = {
      main: {
        width: 1000,
        height: 800,
        scrollX: 0,
        scrollY: 0,
        zoom: 1,
        setScroll: vi.fn(),
        setZoom: vi.fn(),
      },
    };
    input = { on: vi.fn(), off: vi.fn() };
    time = { delayedCall: vi.fn(), addEvent: vi.fn().mockReturnValue({ remove: vi.fn() }), timeScale: 1 };
    tweens = { add: vi.fn(), killTweensOf: vi.fn(), timeScale: 1 };
    textures = { exists: vi.fn().mockReturnValue(true), remove: vi.fn() };
    add = {
      sprite: vi.fn().mockImplementation((_x, _y, key) => createMockSprite(key)),
      graphics: vi.fn().mockImplementation(() => createMockGraphics()),
      rectangle: vi.fn().mockReturnValue({
        setOrigin: vi.fn().mockReturnThis(),
        setScrollFactor: vi.fn().mockReturnThis(),
        setDepth: vi.fn().mockReturnThis(),
        setPosition: vi.fn().mockReturnThis(),
        setSize: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
      }),
      circle: vi.fn().mockReturnValue({
        setDepth: vi.fn().mockReturnThis(),
        setBlendMode: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
      }),
      arc: vi.fn().mockReturnValue({
        setDepth: vi.fn().mockReturnThis(),
        setBlendMode: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
      }),
      zone: vi.fn().mockReturnValue({
        setOrigin: vi.fn().mockReturnThis(),
        setDepth: vi.fn().mockReturnThis(),
        setInteractive: vi.fn().mockReturnThis(),
        on: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
      }),
      group: vi.fn().mockReturnValue({
        add: vi.fn(),
        destroy: vi.fn(),
      }),
    };
  }
  class Vector2 {
    constructor(public x: number, public y: number) {}
  }
  class Point {
    constructor(public x: number, public y: number) {}
  }
  class Polygon {
    constructor(public points: unknown) {}
  }
  class Color {
    constructor(public color: number) {}
    lighten() {
      return this;
    }
    darken() {
      return this;
    }
  }
  const BlendModes = {
    ADD: 1,
    NORMAL: 0,
  };
  return {
    default: {
      Scene,
      BlendModes,
      Math: {
        Vector2,
        Between: (min: number, _max: number) => min,
        Clamp: (value: number, min: number, max: number) =>
          Math.min(Math.max(value, min), max),
        FloatBetween: (min: number, _max: number) => min,
        Angle: { Between: () => 0 },
      },
      Geom: { Point, Polygon },
      Display: { Color: { IntegerToColor: (v: number) => new Color(v) } },
    },
    Scene,
    BlendModes,
  };
});

import type { WorldSnapshot } from "@sudo-city/protocol";
import { WorldAirportManager } from "./entities/facilities/WorldAirportManager";
import { WorldHarbourManager } from "./entities/facilities/WorldHarbourManager";
import { WorldNavyManager } from "./entities/facilities/WorldNavyManager";
import { WorldScene } from "../WorldScene";
import type { WorldTransitionManager } from "./effects/WorldTransitionManager";

function createMockSnapshot(width = 30, height = 30): WorldSnapshot {
  return {
    id: "world:test",
    repoPath: "/fixture",
    revision: "test",
    generatedAt: "2026-08-10T00:00:00.000Z",
    size: { width, height },
    districts: [
      { path: "src", x: 0, y: 0, width, height, weight: 100 },
    ],
    buildings: [],
  };
}

function createMockPhaserScene() {
  return {
    add: {
      sprite: vi.fn().mockImplementation((_x, _y, key) => createMockSprite(key)),
      graphics: vi.fn().mockImplementation(() => createMockGraphics()),
      rectangle: vi.fn().mockReturnValue({
        setOrigin: vi.fn().mockReturnThis(),
        setScrollFactor: vi.fn().mockReturnThis(),
        setDepth: vi.fn().mockReturnThis(),
        setPosition: vi.fn().mockReturnThis(),
        setSize: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
      }),
      circle: vi.fn().mockReturnValue({
        setDepth: vi.fn().mockReturnThis(),
        setBlendMode: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
      }),
      arc: vi.fn().mockReturnValue({
        setDepth: vi.fn().mockReturnThis(),
        setBlendMode: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
      }),
      zone: vi.fn().mockReturnValue({
        setOrigin: vi.fn().mockReturnThis(),
        setDepth: vi.fn().mockReturnThis(),
        setInteractive: vi.fn().mockReturnThis(),
        on: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
      }),
      group: vi.fn().mockReturnValue({
        add: vi.fn(),
        destroy: vi.fn(),
      }),
    },
    tweens: {
      add: vi.fn(),
      killTweensOf: vi.fn(),
    },
    time: {
      delayedCall: vi.fn(),
      addEvent: vi.fn().mockReturnValue({ remove: vi.fn() }),
    },
    textures: {
      exists: vi.fn().mockReturnValue(true),
    },
  } as unknown as Phaser.Scene;
}

describe("WorldAirportManager transition skip", () => {
  it("parks airplane before parting clouds when isSkipRequested is true", async () => {
    const skipRequested = true;
    const mockScene = createMockPhaserScene();

    const airportManager = new WorldAirportManager(
      mockScene,
      () => true,
      () => skipRequested,
    );

    const snapshot = createMockSnapshot();
    // Layout the airport so parkedAirplane and shadow are created
    airportManager.layoutAirport(snapshot);

    let airplaneParkedBeforeClouds = false;
    const mockTransitionManager = {
      partCloudCover: vi.fn().mockImplementation(async () => {
        // At the moment clouds part, parked airplane should already be set visible
        const parkedPlane = (airportManager as unknown as { parkedAirplane?: { setVisible: ReturnType<typeof vi.fn> } }).parkedAirplane;
        airplaneParkedBeforeClouds = !!parkedPlane?.setVisible.mock.calls.length;
      }),
    } as unknown as WorldTransitionManager;

    await airportManager.revealAfterAirportTravel(snapshot, mockTransitionManager);

    expect(airplaneParkedBeforeClouds).toBe(true);
    expect(mockTransitionManager.partCloudCover).toHaveBeenCalledTimes(1);
  });
});

describe("WorldHarbourManager transition skip", () => {
  it("parks container ship before parting clouds when isSkipRequested is true", async () => {
    const skipRequested = true;
    const mockScene = createMockPhaserScene();

    const harbourManager = new WorldHarbourManager(
      mockScene,
      () => true,
      () => skipRequested,
    );

    const snapshot = createMockSnapshot();
    harbourManager.layoutHarbour(snapshot);

    let shipParkedBeforeClouds = false;
    const mockTransitionManager = {
      partCloudCover: vi.fn().mockImplementation(async () => {
        const ship = (harbourManager as unknown as { harbourShip?: { setData: ReturnType<typeof vi.fn> } }).harbourShip;
        shipParkedBeforeClouds = !!ship?.setData.mock.calls.length;
      }),
    } as unknown as WorldTransitionManager;

    harbourManager.prepareContainerArrival(true);
    await harbourManager.revealAfterContainerVoyage(true, mockTransitionManager);

    expect(shipParkedBeforeClouds).toBe(true);
    expect(mockTransitionManager.partCloudCover).toHaveBeenCalledTimes(1);
  });
});

describe("WorldNavyManager transition skip", () => {
  it("parks battleship before parting clouds when isSkipRequested is true", async () => {
    const skipRequested = true;
    const mockScene = createMockPhaserScene();

    const navyManager = new WorldNavyManager(
      mockScene,
      () => true,
      () => skipRequested,
    );

    const snapshot = createMockSnapshot();
    navyManager.layoutNavyHarbour(snapshot, "main");

    let shipParkedBeforeClouds = false;
    const mockTransitionManager = {
      partCloudCover: vi.fn().mockImplementation(async () => {
        const ship = (navyManager as unknown as { navyBattleship?: { setData: ReturnType<typeof vi.fn> } }).navyBattleship;
        shipParkedBeforeClouds = !!ship?.setData.mock.calls.length;
      }),
    } as unknown as WorldTransitionManager;

    navyManager.prepareArrivalForTravel();
    await navyManager.revealAfterTravel(mockTransitionManager);

    expect(shipParkedBeforeClouds).toBe(true);
    expect(mockTransitionManager.partCloudCover).toHaveBeenCalledTimes(1);
  });
});

describe("WorldScene transition skip controls", () => {
  it("updates timescale and skip state properly", () => {
    const scene = new WorldScene();
    scene.time = { timeScale: 1 } as Phaser.Time.Clock;
    scene.tweens = { timeScale: 1 } as Phaser.Tweens.TweenManager;

    // Initially 1
    expect(scene.time.timeScale).toBe(1);
    expect(scene.tweens.timeScale).toBe(1);

    // Skip sets to 100
    scene.skipTransition();
    expect(scene.time.timeScale).toBe(100);
    expect(scene.tweens.timeScale).toBe(100);

    // Reset sets back to 1
    scene.resetTimeScale();
    expect(scene.time.timeScale).toBe(1);
    expect(scene.tweens.timeScale).toBe(1);

    // Starting new travel transition resets skip state
    scene.skipTransition();
    expect(scene.time.timeScale).toBe(100);
    scene.setTravelTransitionActive(true);
    // Harbour manager's isSkipRequested should now return false
    expect((scene.harbourManager as unknown as { isSkipRequested: () => boolean }).isSkipRequested()).toBe(false);
  });

  it("keeps cloud cover animation at normal timescale (1x)", async () => {
    const scene = new WorldScene();
    scene.time = { timeScale: 1 } as Phaser.Time.Clock;
    scene.tweens = { add: vi.fn(), killTweensOf: vi.fn(), timeScale: 1 } as unknown as Phaser.Tweens.TweenManager;

    // Fast-forward departure
    scene.skipTransition();
    expect(scene.time.timeScale).toBe(100);

    // When cloud cover starts, it resets timeScale to 1
    void scene.transitionManager.playCoverTransition();
    expect(scene.time.timeScale).toBe(1);
    expect(scene.tweens.timeScale).toBe(1);
    expect(scene.transitionManager.isCovering).toBe(true);

    // If skipTransition is clicked during cloud cover, timescale remains 1
    scene.skipTransition();
    expect(scene.time.timeScale).toBe(1);

    scene.transitionManager.clearTransitionClouds();
    expect(scene.transitionManager.isCovering).toBe(false);
  });
});
