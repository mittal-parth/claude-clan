import { z } from "zod";

export const PlotSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
});

export const BuildingSchema = z.object({
  path: z.string().min(1),
  district: z.string().min(1),
  language: z.string().min(1),
  loc: z.number().int().nonnegative(),
  plot: PlotSchema,
});

// Treemap output: root-level files live in a district whose path is "", and
// squarify divides the field by area so the rectangles are fractional.
export const DistrictRectSchema = z.object({
  path: z.string(),
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  weight: z.number().nonnegative(),
});

export const WorldSizeSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const SourceFileSchema = z.object({
  path: z.string().min(1),
  directory: z.string(),
  language: z.string().min(1),
  loc: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  churn: z.number().int().nonnegative(),
  authors: z.number().int().nonnegative(),
  lastTouchedAt: z.string().datetime().optional(),
});

export const ImportEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  circular: z.boolean(),
});

export const ExternalDependencySchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["runtime", "development"]),
  manifest: z.string().min(1),
});

export const WorldMapSchema = z.object({
  repoPath: z.string().min(1),
  revision: z.string().min(1),
  files: z.array(SourceFileSchema),
  imports: z.array(ImportEdgeSchema),
  externalDependencies: z.array(ExternalDependencySchema),
});

export const WorldSnapshotSchema = z.object({
  id: z.string().min(1),
  repoPath: z.string().min(1),
  revision: z.string().min(1),
  generatedAt: z.string().datetime(),
  size: WorldSizeSchema,
  districts: z.array(DistrictRectSchema),
  buildings: z.array(BuildingSchema),
});

export const PermissionModeSchema = z.enum(["default", "auto"]);

export const EffortLevelSchema = z.enum([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

// "main" is the primary checkout; "pr-<n>" is a replica city built from an
// open PR's worktree.
export const CityIdSchema = z
  .string()
  .regex(/^(main|pr-\d+)$/u, 'cityId must be "main" or "pr-<number>"');

export const CitySummarySchema = z.object({
  id: CityIdSchema,
  kind: z.enum(["main", "pull-request"]),
  title: z.string().min(1),
  ref: z.string().min(1),
  number: z.number().int().positive().optional(),
  author: z.string().optional(),
  url: z.string().url().optional(),
  status: z.enum(["idle", "building", "ready", "failed"]),
  detail: z.string().optional(),
});

export const FileChangeKindSchema = z.enum(["added", "modified", "deleted"]);

// Deleted files are absent from the PR worktree, so they carry main's plot
// so the renderer can drop rubble where the building used to stand.
export const ChangedFileSchema = z.object({
  path: z.string().min(1),
  change: FileChangeKindSchema,
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  plot: PlotSchema.optional(),
});

export const PullRequestOverlaySchema = z.object({
  cityId: CityIdSchema,
  baseRef: z.string().min(1),
  headSha: z.string().min(1),
  files: z.array(ChangedFileSchema),
});

const EventBaseSchema = z.object({
  id: z.string().min(1),
  cityId: CityIdSchema,
  sessionId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
});

export const GameEventSchema = z.discriminatedUnion("type", [
  EventBaseSchema.extend({
    type: z.literal("world.ready"),
    snapshot: WorldSnapshotSchema,
  }),
  EventBaseSchema.extend({
    type: z.literal("session.started"),
    model: z.string().min(1),
    effort: EffortLevelSchema.default("high"),
    permissionMode: PermissionModeSchema.default("default"),
  }),
  EventBaseSchema.extend({
    type: z.literal("session.message"),
    role: z.enum(["agent", "mayor", "system"]),
    text: z.string(),
  }),
  EventBaseSchema.extend({
    type: z.literal("session.usage"),
    costUsd: z.number().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  EventBaseSchema.extend({
    type: z.literal("permit.requested"),
    toolCallId: z.string().min(1),
    tool: z.string().min(1),
    message: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
  }),
  EventBaseSchema.extend({
    type: z.literal("file.changed"),
    path: z.string().min(1),
    change: z.enum(["added", "modified", "deleted"]),
  }),
  EventBaseSchema.extend({
    type: z.literal("tool.started"),
    toolCallId: z.string().min(1),
    tool: z.string().min(1),
    target: z.string().optional(),
  }),
  EventBaseSchema.extend({
    type: z.literal("tool.completed"),
    toolCallId: z.string().min(1),
    outcome: z.enum(["success", "error", "denied"]),
  }),
  EventBaseSchema.extend({
    type: z.literal("subagent.changed"),
    subagentId: z.string().min(1),
    status: z.enum(["started", "stopped"]),
    agentType: z.string().optional(),
  }),
  EventBaseSchema.extend({
    type: z.literal("task.changed"),
    taskId: z.string().min(1),
    status: z.enum(["created", "completed"]),
    subject: z.string().optional(),
  }),
  EventBaseSchema.extend({
    type: z.literal("compact.changed"),
    status: z.enum(["started", "completed"]),
  }),
  EventBaseSchema.extend({
    type: z.literal("diagnostics.updated"),
    path: z.string().min(1),
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
  }),
]);

export const MayorCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.prompt"),
    cityId: CityIdSchema,
    prompt: z.string().trim().min(1).max(20_000),
    permissionMode: PermissionModeSchema.optional(),
    contextPaths: z
      .array(z.string().trim().min(1).max(500))
      .max(20)
      .optional(),
    model: z.string().min(1).optional(),
    effort: EffortLevelSchema.optional(),
  }),
  z.object({
    type: z.literal("session.interrupt"),
    cityId: CityIdSchema,
  }),
  z.object({
    type: z.literal("permit.resolve"),
    toolCallId: z.string().min(1),
    decision: z.enum(["allow", "deny"]),
  }),
  z.object({
    type: z.literal("world.request"),
    cityId: CityIdSchema,
  }),
  z.object({
    type: z.literal("city.travel"),
    cityId: CityIdSchema,
  }),
  z.object({
    type: z.literal("city.refresh"),
  }),
  z.object({
    type: z.literal("diff.request"),
    cityId: CityIdSchema,
    path: z.string().min(1),
  }),
]);

export const ServerMessageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("event"),
    event: GameEventSchema,
  }),
  z.object({
    kind: z.literal("cities"),
    cities: z.array(CitySummarySchema),
  }),
  z.object({
    kind: z.literal("overlay"),
    overlay: PullRequestOverlaySchema,
  }),
  z.object({
    kind: z.literal("diff"),
    cityId: CityIdSchema,
    path: z.string().min(1),
    patch: z.string(),
  }),
  z.object({
    kind: z.literal("error"),
    code: z.string().min(1),
    message: z.string().min(1),
    toolCallId: z.string().min(1).optional(),
  }),
]);

export type EffortLevel = z.infer<typeof EffortLevelSchema>;
export type Building = z.infer<typeof BuildingSchema>;
export type ChangedFile = z.infer<typeof ChangedFileSchema>;
export type CityId = z.infer<typeof CityIdSchema>;
export type CitySummary = z.infer<typeof CitySummarySchema>;
export type DistrictRect = z.infer<typeof DistrictRectSchema>;
export type ExternalDependency = z.infer<typeof ExternalDependencySchema>;
export type FileChangeKind = z.infer<typeof FileChangeKindSchema>;
export type GameEvent = z.infer<typeof GameEventSchema>;
export type ImportEdge = z.infer<typeof ImportEdgeSchema>;
export type MayorCommand = z.infer<typeof MayorCommandSchema>;
export type PermissionMode = z.infer<typeof PermissionModeSchema>;
export type Plot = z.infer<typeof PlotSchema>;
export type PullRequestOverlay = z.infer<typeof PullRequestOverlaySchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type SourceFile = z.infer<typeof SourceFileSchema>;
export type WorldMap = z.infer<typeof WorldMapSchema>;
export type WorldSize = z.infer<typeof WorldSizeSchema>;
export type WorldSnapshot = z.infer<typeof WorldSnapshotSchema>;
