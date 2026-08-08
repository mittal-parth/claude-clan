import { relative, sep } from "node:path";
import {
  query,
  type HookCallback,
  type Options,
  type PermissionResult,
  type Query,
  type SDKAssistantMessage,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { GameEvent } from "@sudo-city/protocol";

type AgentEvent<Event extends GameEvent = GameEvent> = Event extends GameEvent
  ? Omit<Event, "id" | "sessionId" | "sequence" | "timestamp">
  : never;

interface PendingPermit {
  resolve: (result: PermissionResult) => void;
  reject: (error: Error) => void;
}

export interface AgentSessionOptions {
  cwd: string;
  emit: (event: AgentEvent) => void;
  maxBudgetUsd?: number;
  maxTurns?: number;
  model?: string;
  safeTools?: readonly string[];
}

export class AgentSessionManager {
  private readonly cwd: string;
  private readonly emit: (event: AgentEvent) => void;
  private readonly maxBudgetUsd: number;
  private readonly maxTurns: number;
  private readonly safeTools: Set<string>;
  private model: string;
  private activeQuery?: Query;
  private abortController?: AbortController;
  private readonly pendingPermits = new Map<string, PendingPermit>();

  constructor(options: AgentSessionOptions) {
    this.cwd = options.cwd;
    this.emit = options.emit;
    this.maxBudgetUsd = options.maxBudgetUsd ?? 1;
    this.maxTurns = options.maxTurns ?? 12;
    this.model = options.model ?? "sonnet";
    this.safeTools = new Set(options.safeTools ?? ["Read", "Glob", "Grep"]);
  }

  async start(prompt: string): Promise<void> {
    await this.interrupt();
    const abortController = new AbortController();
    this.abortController = abortController;
    this.emit({ type: "session.started", model: this.model });

    const activeQuery = query({
      prompt,
      options: {
        abortController,
        canUseTool: this.canUseTool,
        cwd: this.cwd,
        hooks: this.createHooks(),
        maxBudgetUsd: this.maxBudgetUsd,
        maxTurns: this.maxTurns,
        model: this.model,
        permissionMode: "default",
      },
    });
    this.activeQuery = activeQuery;

    try {
      for await (const message of activeQuery) {
        this.translateMessage(message);
      }
    } finally {
      if (this.activeQuery === activeQuery) {
        this.activeQuery = undefined;
        this.abortController = undefined;
      }
    }
  }

  async interrupt(): Promise<void> {
    this.abortController?.abort();
    for (const permit of this.pendingPermits.values()) {
      permit.reject(new Error("Agent session interrupted"));
    }
    this.pendingPermits.clear();
  }

  async setModel(model: string): Promise<void> {
    this.model = model;
    await this.activeQuery?.setModel(model);
  }

  resolvePermit(toolCallId: string, decision: "allow" | "deny"): boolean {
    const permit = this.pendingPermits.get(toolCallId);
    if (!permit) {
      return false;
    }
    this.pendingPermits.delete(toolCallId);
    permit.resolve(
      decision === "allow"
        ? { behavior: "allow", toolUseID: toolCallId }
        : {
            behavior: "deny",
            message: "The mayor denied this building permit.",
            toolUseID: toolCallId,
          },
    );
    return true;
  }

  private readonly canUseTool: NonNullable<Options["canUseTool"]> = async (
    toolName,
    input,
    options,
  ) => {
    if (this.safeTools.has(toolName)) {
      return { behavior: "allow", toolUseID: options.toolUseID };
    }

    this.emit({
      type: "permit.requested",
      toolCallId: options.toolUseID,
      tool: toolName,
      message:
        options.title ??
        options.description ??
        `${toolName} requests permission to proceed.`,
      input,
    });

    return new Promise<PermissionResult>((resolvePermit, rejectPermit) => {
      const reject = (error: Error): void => {
        rejectPermit(error);
      };
      this.pendingPermits.set(options.toolUseID, {
        resolve: resolvePermit,
        reject,
      });
      options.signal.addEventListener(
        "abort",
        () => {
          this.pendingPermits.delete(options.toolUseID);
          reject(new Error("Permission request aborted"));
        },
        { once: true },
      );
    });
  };

  private createHooks(): NonNullable<Options["hooks"]> {
    return {
      PreToolUse: [{ hooks: [this.onPreToolUse] }],
      PostToolUse: [{ hooks: [this.onPostToolUse] }],
      PostToolUseFailure: [{ hooks: [this.onPostToolUseFailure] }],
      FileChanged: [{ hooks: [this.onFileChanged] }],
      SubagentStart: [{ hooks: [this.onSubagentStart] }],
      SubagentStop: [{ hooks: [this.onSubagentStop] }],
      TaskCreated: [{ hooks: [this.onTaskCreated] }],
      TaskCompleted: [{ hooks: [this.onTaskCompleted] }],
      PreCompact: [{ hooks: [this.onPreCompact] }],
      PostCompact: [{ hooks: [this.onPostCompact] }],
    };
  }

  private readonly onPreToolUse: HookCallback = async (input) => {
    if (input.hook_event_name === "PreToolUse") {
      this.emit({
        type: "tool.started",
        toolCallId: input.tool_use_id,
        tool: input.tool_name,
        target: toolTarget(input.tool_input),
      });
    }
    return {};
  };

  private readonly onPostToolUse: HookCallback = async (input) => {
    if (input.hook_event_name === "PostToolUse") {
      this.emit({
        type: "tool.completed",
        toolCallId: input.tool_use_id,
        outcome: "success",
      });
    }
    return {};
  };

  private readonly onPostToolUseFailure: HookCallback = async (input) => {
    if (input.hook_event_name === "PostToolUseFailure") {
      this.emit({
        type: "tool.completed",
        toolCallId: input.tool_use_id,
        outcome: "error",
      });
    }
    return {};
  };

  private readonly onFileChanged: HookCallback = async (input) => {
    if (input.hook_event_name === "FileChanged") {
      this.emit({
        type: "file.changed",
        path: normalizePath(relative(this.cwd, input.file_path)),
        change:
          input.event === "add"
            ? "added"
            : input.event === "unlink"
              ? "deleted"
              : "modified",
      });
    }
    return {};
  };

  private readonly onSubagentStart: HookCallback = async (input) => {
    if (input.hook_event_name === "SubagentStart") {
      this.emit({
        type: "subagent.changed",
        subagentId: input.agent_id,
        status: "started",
        agentType: input.agent_type,
      });
    }
    return {};
  };

  private readonly onSubagentStop: HookCallback = async (input) => {
    if (input.hook_event_name === "SubagentStop") {
      this.emit({
        type: "subagent.changed",
        subagentId: input.agent_id,
        status: "stopped",
        agentType: input.agent_type,
      });
    }
    return {};
  };

  private readonly onTaskCreated: HookCallback = async (input) => {
    if (input.hook_event_name === "TaskCreated") {
      this.emit({
        type: "task.changed",
        taskId: input.task_id,
        status: "created",
        subject: input.task_subject,
      });
    }
    return {};
  };

  private readonly onTaskCompleted: HookCallback = async (input) => {
    if (input.hook_event_name === "TaskCompleted") {
      this.emit({
        type: "task.changed",
        taskId: input.task_id,
        status: "completed",
        subject: input.task_subject,
      });
    }
    return {};
  };

  private readonly onPreCompact: HookCallback = async (input) => {
    if (input.hook_event_name === "PreCompact") {
      this.emit({ type: "compact.changed", status: "started" });
    }
    return {};
  };

  private readonly onPostCompact: HookCallback = async (input) => {
    if (input.hook_event_name === "PostCompact") {
      this.emit({ type: "compact.changed", status: "completed" });
    }
    return {};
  };

  private translateMessage(message: SDKMessage): void {
    if (message.type === "assistant") {
      const text = assistantText(message);
      if (text) {
        this.emit({ type: "session.message", role: "agent", text });
      }
      return;
    }
    if (message.type === "result") {
      this.emit({
        type: "session.usage",
        costUsd: message.total_cost_usd,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      });
    }
  }
}

function assistantText(message: SDKAssistantMessage): string {
  return message.message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function toolTarget(input: unknown): string | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  for (const key of ["file_path", "path", "command", "pattern"]) {
    const value = input[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePath(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

export type { AgentEvent };
