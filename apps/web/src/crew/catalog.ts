import type { EffortLevel } from "@sudo-city/protocol";

export type CrewId = "opus" | "sonnet";

export interface CrewMember {
  id: CrewId;
  model: string;
  name: string;
  title: string;
  description: string;
  spriteFolder: "architect" | "worker";
}

export const EFFORT_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly EffortLevel[];

export const DEFAULT_CREW_ID: CrewId = "sonnet";
export const DEFAULT_EFFORT: EffortLevel = "high";

export const CREW_MEMBERS: readonly CrewMember[] = [
  {
    id: "opus",
    model: "opus",
    name: "Architect",
    title: "Master planner",
    description:
      "Deep reasoning for complex refactors, architecture, and long-horizon builds.",
    spriteFolder: "architect",
  },
  {
    id: "sonnet",
    model: "sonnet",
    name: "Worker",
    title: "Site foreman",
    description:
      "Balanced crew for everyday edits, fixes, and steady construction.",
    spriteFolder: "worker",
  },
] as const;

export function getCrewMember(id: CrewId): CrewMember {
  const member = CREW_MEMBERS.find((crew) => crew.id === id);
  if (!member) {
    throw new Error(`Unknown crew id: ${id}`);
  }
  return member;
}

export function crewSpriteUrl(
  crewId: CrewId,
  effort: EffortLevel = DEFAULT_EFFORT,
): string {
  const member = getCrewMember(crewId);
  return `/crew/${member.spriteFolder}/${effort}.png`;
}

export function effortLabel(effort: EffortLevel): string {
  switch (effort) {
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    case "xhigh":
      return "Extra high";
    case "max":
      return "Max";
    default: {
      const exhaustiveEffort: never = effort;
      return exhaustiveEffort;
    }
  }
}

export function effortDescription(effort: EffortLevel): string {
  switch (effort) {
    case "low":
      return "Quick passes — clipboard only, minimal planning.";
    case "medium":
      return "Steady pace — pocket notes, moderate thinking.";
    case "high":
      return "Full tool belt — blueprints out, deep reasoning.";
    case "xhigh":
      return "Survey crew — calculators, tape, extended exploration.";
    case "max":
      return "Everything on site — tripod, level, no constraints.";
    default: {
      const exhaustiveEffort: never = effort;
      return exhaustiveEffort;
    }
  }
}

export function findCrewByModel(model: string): CrewMember | undefined {
  return CREW_MEMBERS.find(
    (crew) => crew.model === model || crew.id === model,
  );
}
