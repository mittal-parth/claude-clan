import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CREW_MEMBERS,
  EFFORT_LEVELS,
  crewSpriteUrl,
  findCrewByModel,
  getCrewMember,
} from "./catalog";

describe("crew catalog", () => {
  it("names a portrait for the crew member and effort", () => {
    expect(crewSpriteUrl("opus", "max")).toBe("/crew/opus-max.png");
    expect(crewSpriteUrl("sonnet", "low")).toBe("/crew/sonnet-low.png");
    expect(crewSpriteUrl("haiku", "xhigh")).toBe("/crew/haiku-xhigh.png");
  });

  it("defaults the effort when one is not given", () => {
    expect(crewSpriteUrl("sonnet")).toBe("/crew/sonnet-high.png");
  });

  it("finds a crew member by model id or alias", () => {
    expect(findCrewByModel("opus")?.name).toBe("Architect");
    expect(findCrewByModel("haiku")?.name).toBe("Runner");
    expect(findCrewByModel("nobody")).toBeUndefined();
  });

  it("throws on a crew id that does not exist", () => {
    // @ts-expect-error deliberately outside CrewId
    expect(() => getCrewMember("mayor")).toThrow(/Unknown crew id/);
  });

  // A wrong url is a blank avatar and a missing figure on site, neither of
  // which fails loudly in the browser — so it fails here instead.
  it("has a portrait on disk for every crew member and effort", () => {
    const publicDir = fileURLToPath(new URL("../../public", import.meta.url));

    const missing: string[] = [];
    for (const crew of CREW_MEMBERS) {
      for (const effort of EFFORT_LEVELS) {
        const url = crewSpriteUrl(crew.id, effort);
        if (!existsSync(`${publicDir}${url}`)) {
          missing.push(url);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
