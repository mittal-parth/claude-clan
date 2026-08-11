import type { GameEvent, PermissionMode } from "@sudo-city/protocol";
import type {
  Quest,
  QuestStatus,
  QuestTimelineStep,
} from "@/components/ui/8bit/blocks/quest-log";
import { sessionCrewLabel, permissionModeLabel } from "./app-utils";

export function eventLabel(event: GameEvent): string {
  switch (event.type) {
    case "world.ready":
      return `${event.snapshot.buildings.length} structures surveyed`;
    case "session.started":
      return `${sessionCrewLabel(event.model, event.effort)} · ${permissionModeLabel(event.permissionMode)}`;
    case "session.message":
      return `${event.role}: ${event.text}`;
    case "session.usage":
      return `$${event.costUsd.toFixed(4)} · ${event.outputTokens} tokens out`;
    case "permit.requested":
      return `${event.tool} permit requested`;
    case "file.changed":
      return `${event.change}: ${event.path}`;
    case "tool.started":
      return `${event.tool}: ${event.target ?? "working"}`;
    case "tool.completed":
      return event.outcome === "success"
        ? "Completed"
        : event.outcome === "denied"
          ? "Denied"
          : "Failed";
    case "subagent.changed":
      return event.agentType ?? "Helper agent";
    case "task.changed":
      return (
        event.subject ??
        (event.status === "completed" ? "Task completed" : "Task created")
      );
    case "compact.changed":
      return event.status === "completed"
        ? "Context compacted"
        : "Compacting context";
    case "diagnostics.updated":
      return `${event.path}: ${event.errors} errors`;
    default: {
      const exhaustiveEvent: never = event;
      return exhaustiveEvent;
    }
  }
}

export function timelineContentForEvent(
  event: GameEvent,
): Pick<QuestTimelineStep, "label" | "markdown" | "tool"> {
  switch (event.type) {
    case "tool.started": {
      const command = event.target ?? "working";
      return {
        tool: event.tool,
        markdown: `\`${event.tool}: ${command}\``,
      };
    }
    case "permit.requested":
      return {
        tool: event.tool,
        markdown: `\`${event.tool}\` permit requested`,
      };
    case "file.changed":
      return {
        markdown: `\`${event.path}\` · ${event.change}`,
      };
    case "session.started":
      return {
        label: `${sessionCrewLabel(event.model, event.effort)} · ${permissionModeLabel(event.permissionMode)}`,
      };
    case "subagent.changed":
      return {
        label: event.agentType ?? "Helper agent",
      };
    case "task.changed":
      return {
        label:
          event.subject ??
          (event.status === "completed" ? "Task completed" : "Task created"),
      };
    case "compact.changed":
      return {
        label:
          event.status === "completed"
            ? "Context compacted"
            : "Compacting context",
      };
    case "diagnostics.updated":
      return {
        label: `${event.path}: ${event.errors} errors`,
      };
    default:
      return {
        label: eventLabel(event),
      };
  }
}

export function questStatus(event: GameEvent): QuestStatus {
  switch (event.type) {
    case "file.changed":
    case "diagnostics.updated":
      return "completed";
    case "permit.requested":
    case "tool.started":
    case "session.started":
    case "subagent.changed":
      return event.type === "subagent.changed" && event.status === "stopped"
        ? "completed"
        : "active";
    case "tool.completed":
      return event.outcome === "success" ? "completed" : "failed";
    case "task.changed":
      return event.status === "completed" ? "completed" : "active";
    case "compact.changed":
      return event.status === "completed" ? "completed" : "active";
    default:
      return "pending";
  }
}

export function truncatePreview(text: string, maxLength = 100): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.substring(0, maxLength)}...`;
}

export function timelineStepFromEvent(event: GameEvent): QuestTimelineStep {
  const content = timelineContentForEvent(event);

  const step: QuestTimelineStep = {
    id: event.id,
    type: event.type,
    label: content.label,
    markdown: content.markdown,
    tool: content.tool,
    status: questStatus(event),
  };

  if (
    event.type === "permit.requested" ||
    event.type === "tool.started" ||
    event.type === "tool.completed"
  ) {
    step.toolCallId = event.toolCallId;
  }

  if (event.type === "task.changed") {
    step.taskId = event.taskId;
  }

  if (event.type === "subagent.changed") {
    step.subagentId = event.subagentId;
  }

  return step;
}

export function collapseTimelineSteps(
  steps: QuestTimelineStep[],
): QuestTimelineStep[] {
  const result: QuestTimelineStep[] = [];
  const toolSteps = new Map<string, QuestTimelineStep>();
  const taskSteps = new Map<string, QuestTimelineStep>();
  const subagentSteps = new Map<string, QuestTimelineStep>();
  let compactStep: QuestTimelineStep | undefined;

  for (const step of steps) {
    if (step.type === "tool.completed") {
      if (step.toolCallId) {
        const existing = toolSteps.get(step.toolCallId);
        if (existing) {
          existing.status = step.status;
        }
      }
      continue;
    }

    if (
      (step.type === "tool.started" || step.type === "permit.requested") &&
      step.toolCallId
    ) {
      const existing = toolSteps.get(step.toolCallId);
      if (existing) {
        if (step.type === "tool.started") {
          existing.type = "tool.started";
          existing.markdown = step.markdown ?? existing.markdown;
          existing.tool = step.tool ?? existing.tool;
        } else if (step.type === "permit.requested") {
          existing.markdown = step.markdown ?? existing.markdown;
        }
        continue;
      }

      toolSteps.set(step.toolCallId, step);
      result.push(step);
      continue;
    }

    if (step.type === "task.changed" && step.taskId) {
      if (step.status === "completed") {
        const existing = taskSteps.get(step.taskId);
        if (existing) {
          existing.status = "completed";
          existing.label = step.label ?? existing.label;
        }
        continue;
      }

      const existing = taskSteps.get(step.taskId);
      if (existing) {
        continue;
      }

      taskSteps.set(step.taskId, step);
      result.push(step);
      continue;
    }

    if (step.type === "subagent.changed" && step.subagentId) {
      if (step.status === "completed") {
        const existing = subagentSteps.get(step.subagentId);
        if (existing) {
          existing.status = "completed";
          existing.label = step.label ?? existing.label;
        }
        continue;
      }

      const existing = subagentSteps.get(step.subagentId);
      if (existing) {
        continue;
      }

      subagentSteps.set(step.subagentId, step);
      result.push(step);
      continue;
    }

    if (step.type === "compact.changed") {
      if (step.status === "completed" && compactStep) {
        compactStep.status = "completed";
        continue;
      }

      compactStep = step;
      result.push(step);
      continue;
    }

    if (step.type === "session.started") {
      result.push({ ...step, status: "completed" });
      continue;
    }

    result.push(step);
  }

  return finalizeStalePermitSteps(result);
}

export function finalizeStalePermitSteps(
  steps: QuestTimelineStep[],
): QuestTimelineStep[] {
  let sawLaterActivity = false;

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]!;

    if (
      step.type === "permit.requested" &&
      step.status === "active" &&
      sawLaterActivity
    ) {
      step.status = "completed";
    }

    if (countsAsStalePermitResolution(step)) {
      sawLaterActivity = true;
    }
  }

  return steps;
}

export function countsAsStalePermitResolution(
  step: QuestTimelineStep,
): boolean {
  if (step.type === "session.message") {
    return true;
  }

  if (step.type === "session.started" || step.type === "permit.requested") {
    return false;
  }

  return step.status === "completed" || step.status === "failed";
}

export function isMaxTurnsStopMessage(text: string): boolean {
  return /maximum number of turns/i.test(text);
}

export function systemMessageStatus(text: string): QuestStatus {
  if (isMaxTurnsStopMessage(text)) {
    return "completed";
  }

  if (/error|stopped|failed/i.test(text)) {
    return "failed";
  }

  return "completed";
}

export function isIgnorableFailureStep(step: QuestTimelineStep): boolean {
  return (
    step.type === "session.message" &&
    step.role === "system" &&
    step.markdown !== undefined &&
    isMaxTurnsStopMessage(step.markdown)
  );
}

export function workUnitStatus(timeline: QuestTimelineStep[]): QuestStatus {
  const hasOpenTools = timeline.some(
    (step) =>
      (step.type === "permit.requested" || step.type === "tool.started") &&
      step.status === "active",
  );

  if (hasOpenTools) {
    return "active";
  }

  const hasMeaningfulFailure = timeline.some(
    (step) => step.status === "failed" && !isIgnorableFailureStep(step),
  );

  if (hasMeaningfulFailure) {
    return "failed";
  }

  return "completed";
}

export function messageToTimelineStep(
  event: Extract<GameEvent, { type: "session.message" }>,
): QuestTimelineStep {
  return {
    id: event.id,
    type: "session.message",
    role: event.role,
    markdown: event.text,
    status:
      event.role === "system" ? systemMessageStatus(event.text) : "completed",
  };
}

export function eventsToQuests(events: GameEvent[]): Quest[] {
  const ordered = events.slice().sort((a, b) => a.sequence - b.sequence);
  const mayorMessages = ordered.filter(
    (
      event,
    ): event is Extract<GameEvent, { type: "session.message" }> & {
      role: "mayor";
    } => event.type === "session.message" && event.role === "mayor",
  );

  if (mayorMessages.length === 0) {
    return [];
  }

  return mayorMessages
    .map((mayorMessage, index) => {
      const endSequence =
        index < mayorMessages.length - 1
          ? mayorMessages[index + 1]!.sequence
          : Number.POSITIVE_INFINITY;

      const unitEvents = ordered.filter((event) => {
        if (event.sequence <= mayorMessage.sequence) {
          return false;
        }

        if (event.sequence >= endSequence) {
          return false;
        }

        if (event.type === "world.ready" || event.type === "session.usage") {
          return false;
        }

        if (event.type === "session.message" && event.role === "mayor") {
          return false;
        }

        return true;
      });

      const timeline = collapseTimelineSteps(
        unitEvents.map((event) =>
          event.type === "session.message"
            ? messageToTimelineStep(event)
            : timelineStepFromEvent(event),
        ),
      );
      const description = mayorMessage.text;

      return {
        id: mayorMessage.id,
        title: "Work order",
        description,
        status: workUnitStatus(timeline),
        shortDescription: truncatePreview(description),
        role: "mayor" as const,
        timeline,
      };
    })
    .reverse();
}

export function findPendingPermit(
  events: GameEvent[],
): Extract<GameEvent, { type: "permit.requested" }> | undefined {
  const latestSessionIndex = events.findLastIndex(
    (event) => event.type === "session.started",
  );
  const relevantEvents =
    latestSessionIndex >= 0 ? events.slice(latestSessionIndex) : events;
  const completed = new Set<string>();
  for (const event of relevantEvents.slice().reverse()) {
    if (event.type === "tool.completed") {
      completed.add(event.toolCallId);
    }
    if (event.type === "permit.requested" && !completed.has(event.toolCallId)) {
      return event;
    }
  }
  return undefined;
}

export function createLocalPermitDismissal(
  cityId: string,
  toolCallId: string,
  events: GameEvent[],
): Extract<GameEvent, { type: "tool.completed" }> {
  const lastSequence = events.at(-1)?.sequence ?? 0;
  return {
    id: crypto.randomUUID(),
    cityId: cityId as GameEvent["cityId"],
    sessionId: "local",
    sequence: lastSequence + 1,
    timestamp: new Date().toISOString(),
    type: "tool.completed",
    toolCallId,
    outcome: "denied",
  };
}
