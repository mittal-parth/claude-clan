import type { GameEvent } from "@sudo-city/protocol";
import type { ChatItem, SessionView } from "./types";

export function toChatItems(view: SessionView): ChatItem[] {
  const events = [...view.events].sort((left, right) => left.sequence - right.sequence);
  const items: ChatItem[] = [];
  const toolIndexes = new Map<string, number>();
  const permitIndexes = new Map<string, number>();
  const finalMessageIds = new Set<string>();
  const collapsedIndexes = new Map<string, number>();

  for (const event of events) {
    switch (event.type) {
      case "session.message":
        finalMessageIds.add(event.messageId);
        if (event.role === "mayor") {
          items.push({
            kind: "mayor",
            id: event.id,
            sequence: event.sequence,
            text: event.text,
            contextPaths: event.contextPaths,
          });
        } else if (event.kind === "thinking") {
          items.push({
            kind: "thinking",
            id: event.id,
            sequence: event.sequence,
            text: event.text,
            streaming: false,
          });
        } else if (event.role === "system") {
          items.push({
            kind: "notice",
            id: event.id,
            sequence: event.sequence,
            text: event.text,
            tone: view.summary.status === "failed" ? "error" : "info",
          });
        } else {
          items.push({
            kind: "crew",
            id: event.id,
            sequence: event.sequence,
            text: event.text,
            streaming: false,
          });
        }
        break;
      case "tool.started": {
        const item: ChatItem = {
          kind: "tool",
          id: event.id,
          sequence: event.sequence,
          toolCallId: event.toolCallId,
          tool: event.tool,
          target: event.target,
          title: event.title,
          input: event.input,
          status: "running",
        };
        toolIndexes.set(event.toolCallId, items.length);
        items.push(item);
        break;
      }
      case "tool.completed": {
        const index = toolIndexes.get(event.toolCallId);
        if (index !== undefined && items[index]?.kind === "tool") {
          const existing = items[index];
          if (existing.kind === "tool") {
            items[index] = {
              ...existing,
              status: event.outcome,
              durationMs: event.durationMs,
              resultPreview: event.resultPreview,
            };
          }
        } else {
          items.push({
            kind: "tool",
            id: event.id,
            sequence: event.sequence,
            toolCallId: event.toolCallId,
            tool: "Tool",
            status: event.outcome,
            durationMs: event.durationMs,
            resultPreview: event.resultPreview,
          });
        }
        break;
      }
      case "permit.requested": {
        permitIndexes.set(event.toolCallId, items.length);
        items.push({
          kind: "permit",
          id: event.id,
          sequence: event.sequence,
          toolCallId: event.toolCallId,
          tool: event.tool,
          message: event.message,
          input: event.input,
        });
        break;
      }
      case "permit.resolved": {
        const index = permitIndexes.get(event.toolCallId);
        if (index !== undefined && items[index]?.kind === "permit") {
          const existing = items[index];
          if (existing.kind === "permit") {
            items[index] = { ...existing, decision: event.decision };
          }
        } else {
          items.push({
            kind: "permit",
            id: event.id,
            sequence: event.sequence,
            toolCallId: event.toolCallId,
            tool: "Tool",
            message: "Permission request resolved before its request arrived.",
            input: {},
            decision: event.decision,
          });
        }
        break;
      }
      case "turn.completed":
        items.push({
          kind: "turn",
          id: event.id,
          sequence: event.sequence,
          outcome: event.outcome,
          costUsd: event.costUsd,
          durationMs: event.durationMs,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          detail: event.detail,
        });
        break;
      case "compact.changed":
        items.push({
          kind: "compaction",
          id: event.id,
          sequence: event.sequence,
          preTokens: event.preTokens,
          postTokens: event.postTokens,
        });
        break;
      case "file.changed": {
        const key = `file:${event.path}`;
        const existingIndex = collapsedIndexes.get(key);
        const item: ChatItem = {
          kind: "file",
          id: event.id,
          sequence: event.sequence,
          path: event.path,
          change: event.change,
        };
        if (existingIndex === undefined) {
          collapsedIndexes.set(key, items.length);
          items.push(item);
        } else {
          items[existingIndex] = item;
        }
        break;
      }
      case "subagent.changed": {
        const key = `subagent:${event.subagentId}`;
        const existingIndex = collapsedIndexes.get(key);
        const item: ChatItem = {
          kind: "subagent",
          id: event.id,
          sequence: event.sequence,
          agentType: event.agentType ?? "subagent",
          running: event.status === "started",
        };
        if (existingIndex === undefined) {
          collapsedIndexes.set(key, items.length);
          items.push(item);
        } else {
          items[existingIndex] = item;
        }
        break;
      }
      case "task.changed": {
        const key = `task:${event.taskId}`;
        const existingIndex = collapsedIndexes.get(key);
        const item: ChatItem = {
          kind: "task",
          id: event.id,
          sequence: event.sequence,
          subject: event.subject ?? "Task",
          done: event.status === "completed",
        };
        if (existingIndex === undefined) {
          collapsedIndexes.set(key, items.length);
          items.push(item);
        } else {
          items[existingIndex] = item;
        }
        break;
      }
      case "world.ready":
      case "session.usage":
      case "session.created":
      case "session.status":
      case "session.renamed":
      case "session.configured":
      case "turn.started":
      case "session.delta":
      case "diagnostics.updated":
        break;
    }
  }

  for (const [messageId, text] of Object.entries(view.streaming)) {
    if (!text || finalMessageIds.has(messageId)) {
      continue;
    }
    const thinking = messageId.endsWith(":thinking");
    items.push({
      kind: thinking ? "thinking" : "crew",
      id: `stream:${messageId}`,
      sequence: Number.MAX_SAFE_INTEGER,
      text,
      streaming: true,
    });
  }

  return items.sort((left, right) => left.sequence - right.sequence);
}

export function chatItemForEvent(event: GameEvent, view: SessionView): ChatItem[] {
  return toChatItems({ ...view, events: [event] });
}
