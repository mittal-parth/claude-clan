import type { TurnOutcome } from "@sudo-city/protocol";

export type TranslatedAgentEvent =
  | {
      type: "session.message";
      messageId: string;
      turnId?: string;
      role: "agent";
      kind: "text" | "thinking";
      text: string;
      contextPaths: string[];
    }
  | {
      type: "session.delta";
      messageId: string;
      turnId?: string;
      kind: "text" | "thinking";
      text: string;
    }
  | {
      type: "compact.changed";
      status: "completed";
      trigger: "manual" | "auto";
      preTokens: number;
      postTokens?: number;
    };

interface ContentBlock {
  type?: unknown;
  text?: unknown;
  thinking?: unknown;
}

interface StructuralMessage {
  type?: unknown;
  uuid?: unknown;
  message?: { id?: unknown; content?: unknown };
  event?: {
    type?: unknown;
    message?: { id?: unknown };
    delta?: { type?: unknown; text?: unknown; thinking?: unknown };
  };
  compact_metadata?: {
    trigger?: unknown;
    pre_tokens?: unknown;
    post_tokens?: unknown;
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Translates only durable or human-readable SDK frames. The module deliberately
 * accepts structural data instead of importing the SDK, so these rules can be
 * tested in plain Node without mocking a subprocess package.
 */
export function translateMessage(
  input: unknown,
  turnId?: string,
  currentMessageId?: string,
): TranslatedAgentEvent[] {
  if (typeof input !== "object" || input === null) {
    return [];
  }
  const message = input as StructuralMessage;

  if (message.type === "assistant") {
    if (!Array.isArray(message.message?.content)) {
      return [];
    }
    const messageId =
      stringValue(message.message?.id) ??
      currentMessageId ??
      stringValue(message.uuid);
    if (!messageId) {
      return [];
    }
    const events: TranslatedAgentEvent[] = [];
    for (const block of message.message.content as ContentBlock[]) {
      if (block.type === "text") {
        const text = stringValue(block.text);
        if (text) {
          events.push({
            type: "session.message",
            messageId,
            turnId,
            role: "agent",
            kind: "text",
            text,
            contextPaths: [],
          });
        }
      } else if (block.type === "thinking") {
        const text = stringValue(block.thinking);
        if (text) {
          events.push({
            type: "session.message",
            messageId: `${messageId}:thinking`,
            turnId,
            role: "agent",
            kind: "thinking",
            text,
            contextPaths: [],
          });
        }
      } else if (block.type === "redacted_thinking") {
        events.push({
          type: "session.message",
          messageId: `${messageId}:redacted`,
          turnId,
          role: "agent",
          kind: "thinking",
          text: "(the crew's reasoning for this step is redacted)",
          contextPaths: [],
        });
      }
    }
    return events;
  }

  if (message.type === "stream_event") {
    const event = message.event;
    if (event?.type !== "content_block_delta") {
      return [];
    }
    const messageId =
      currentMessageId ??
      stringValue(event.message?.id) ??
      stringValue(message.uuid);
    if (!messageId) {
      return [];
    }
    if (event.delta?.type === "text_delta") {
      const text = stringValue(event.delta.text);
      return text
        ? [{ type: "session.delta", messageId, turnId, kind: "text", text }]
        : [];
    }
    if (event.delta?.type === "thinking_delta") {
      const text = stringValue(event.delta.thinking);
      return text
        ? [{
            type: "session.delta",
            messageId: `${messageId}:thinking`,
            turnId,
            kind: "thinking",
            text,
          }]
        : [];
    }
    return [];
  }

  if (message.type === "system" && message.compact_metadata) {
    const trigger = message.compact_metadata.trigger;
    const preTokens = message.compact_metadata.pre_tokens;
    if (
      (trigger === "manual" || trigger === "auto") &&
      typeof preTokens === "number"
    ) {
      return [{
        type: "compact.changed",
        status: "completed",
        trigger,
        preTokens,
        postTokens:
          typeof message.compact_metadata.post_tokens === "number"
            ? message.compact_metadata.post_tokens
            : undefined,
      }];
    }
  }

  return [];
}

/**
 * The SDK states the terminal reason outright. Inferring this from assistant
 * prose made a normal sentence containing "maximum number of turns" look like
 * a benign turn limit and could not distinguish budget exhaustion from a crash.
 */
export function turnOutcomeFor(result: {
  subtype: string;
  is_error?: boolean;
}): TurnOutcome {
  switch (result.subtype) {
    case "success":
      return "success";
    case "error_max_turns":
      return "max-turns";
    case "error_max_budget_usd":
      return "budget-exhausted";
    case "interrupted":
      return "interrupted";
    default:
      return "error";
  }
}
