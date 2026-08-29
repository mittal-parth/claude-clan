import { randomUUID } from "node:crypto";
import { isAbsolute, relative, sep } from "node:path";
import {
  query,
  type HookCallback,
  type Options,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SandboxSettings,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  EffortLevel,
  GameEvent,
  PermissionMode,
  SessionStatus,
  TurnOutcome,
} from "@sudo-city/protocol";
import { MessageQueue } from "./queue.js";
import {
  extractTargetPaths,
  isInsideDirectory,
  isRecord,
  isRestrictedBashCommand,
  normalisePath,
  previewInput,
  previewResult,
  promptWithContext,
  toolTarget,
} from "./tools.js";
import { translateMessage, turnOutcomeFor } from "./translate.js";

export type AgentEvent<Event extends GameEvent = GameEvent> =
  Event extends GameEvent
    ? Omit<Event, "id" | "cityId" | "sessionId" | "sequence" | "timestamp">
    : never;

export const SESSION_IDLE_CLOSE_MS = 5 * 60_000;
export const DEFAULT_MAX_TURNS = 50;

export interface SessionRunnerOptions {
  sessionId: string;
  cwd: string;
  emit: (event: AgentEvent) => void;
  model: string;
  effort: EffortLevel;
  permissionMode: PermissionMode;
  safeTools?: readonly string[];
  disallowedTools?: readonly string[];
  systemPromptAppend?: string;
  sandbox?: SandboxSettings;
  /** User-selected Claude Code binary, primarily for desktop Keychain continuity. */
  pathToClaudeCodeExecutable?: string;
  /** Filesystem setting sources to honour; omitted preserves hosted behaviour. */
  settingSources?: readonly ("user" | "project" | "local")[];
  /** Extra environment handed only to the spawned Claude process. */
  agentEnv?: Record<string, string>;
  maxTurns?: number;
  budget: {
    /** Undefined means no dollar ceiling and must omit maxBudgetUsd entirely. */
    reserve: (sessionId: string) => number | undefined;
    settle: (sessionId: string, actualUsd: number) => void;
  };
  idleCloseMs?: number;
  /** True when a new runner is reopening a persisted conversation. */
  resume?: boolean;
  title?: string;
  onContextUsage?: (percentage: number) => void;
  onAuthInfo?: (info: { apiKeySource?: string; apiProvider?: string }) => void;
  onRateLimit?: (info: {
    rateLimitType?: string;
    status?: "allowed" | "allowed_warning" | "rejected";
    resetsAt?: string;
    utilization?: number;
  }) => void;
}

interface PendingPermit {
  tool: string;
  resolve: (result: PermissionResult) => void;
  reject: (error: Error) => void;
}

interface RunningTool {
  tool: string;
  startedAt: number;
}

export class SessionRunner {
  private readonly sessionId: string;
  private readonly cwd: string;
  private readonly emit: (event: AgentEvent) => void;
  private readonly safeTools: Set<string>;
  private readonly disallowedTools?: readonly string[];
  private readonly systemPromptAppend?: string;
  private readonly sandbox?: SandboxSettings;
  private readonly pathToClaudeCodeExecutable?: string;
  private readonly settingSources?: readonly ("user" | "project" | "local")[];
  private readonly agentEnv?: Record<string, string>;
  private readonly maxTurns: number;
  private readonly budget: SessionRunnerOptions["budget"];
  private readonly idleCloseMs: number;
  private readonly title?: string;
  private readonly onContextUsage?: (percentage: number) => void;
  private readonly onAuthInfo?: SessionRunnerOptions["onAuthInfo"];
  private readonly onRateLimit?: SessionRunnerOptions["onRateLimit"];

  private model: string;
  private effort: EffortLevel;
  private permissionMode: PermissionMode;
  private activeQuery?: Query;
  private queue?: MessageQueue<SDKUserMessage>;
  private abortController?: AbortController;
  private pump?: Promise<void>;
  private started: boolean;
  private sdkSessionId?: string;
  private readonly pendingPermits = new Map<string, PendingPermit>();
  private readonly runningTools = new Map<string, RunningTool>();
  private idleTimer?: ReturnType<typeof setTimeout>;
  private status: SessionStatus = "idle";
  private queryCostUsd = 0;
  private currentTurnId?: string;
  private currentMessageId?: string;
  private interruptRequested = false;
  private contextPercent?: number;
  private authInfo?: { apiKeySource?: string; apiProvider?: string };

  constructor(options: SessionRunnerOptions) {
    this.sessionId = options.sessionId;
    this.cwd = options.cwd;
    this.emit = options.emit;
    this.model = options.model;
    this.effort = options.effort;
    this.permissionMode = options.permissionMode;
    this.safeTools = new Set(options.safeTools ?? ["Read", "Glob", "Grep"]);
    this.disallowedTools = options.disallowedTools;
    this.systemPromptAppend = options.systemPromptAppend;
    this.sandbox = options.sandbox;
    this.pathToClaudeCodeExecutable = options.pathToClaudeCodeExecutable;
    this.settingSources = options.settingSources;
    this.agentEnv = options.agentEnv;
    this.maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
    this.budget = options.budget;
    this.idleCloseMs = options.idleCloseMs ?? SESSION_IDLE_CLOSE_MS;
    this.started = options.resume ?? false;
    this.title = options.title;
    this.onContextUsage = options.onContextUsage;
    this.onAuthInfo = options.onAuthInfo;
    this.onRateLimit = options.onRateLimit;
  }

  get sessionKey(): string {
    return this.sdkSessionId ?? this.sessionId;
  }

  get currentStatus(): SessionStatus {
    return this.status;
  }

  get contextUsagePercent(): number | undefined {
    return this.contextPercent;
  }

  get credentialInfo(): { apiKeySource?: string; apiProvider?: string } | undefined {
    return this.authInfo;
  }

  get pendingPermitCount(): number {
    return this.pendingPermits.size;
  }

  /** Opens a warm streaming query transparently before feeding a turn to it. */
  async send(
    prompt: string,
    contextPaths: readonly string[] = [],
  ): Promise<string> {
    this.clearIdleTimer();
    this.interruptRequested = false;
    if (!this.activeQuery) {
      await this.open();
    }

    const turnId = `turn_${randomUUID()}`;
    this.currentTurnId = turnId;
    this.currentMessageId = undefined;
    const safeContextPaths = contextPaths.filter((p) =>
      isInsideDirectory(this.cwd, p),
    );
    this.emit({
      type: "turn.started",
      turnId,
      prompt,
      contextPaths: [...safeContextPaths],
    });
    this.setStatus("thinking");
    this.queue?.push({
      type: "user",
      parent_tool_use_id: null,
      uuid: randomUUID(),
      session_id: this.sessionKey,
      message: {
        role: "user",
        content: promptWithContext(prompt, safeContextPaths),
      },
    });
    return turnId;
  }

  private async open(): Promise<void> {
    this.setStatus("starting");
    const abortController = new AbortController();
    const queue = new MessageQueue<SDKUserMessage>();
    this.abortController = abortController;
    this.queue = queue;
    this.queryCostUsd = 0;

    const resumeKey = this.sdkSessionId ?? this.sessionId;
    const reservedUsd = this.budget.reserve(this.sessionId);
    const activeQuery = query({
      prompt: queue,
      options: {
        abortController,
        canUseTool: this.canUseTool,
        cwd: this.cwd,
        disallowedTools: this.disallowedTools
          ? [...this.disallowedTools]
          : undefined,
        effort: this.effort,
        hooks: this.createHooks(),
        includePartialMessages: true,
        maxTurns: this.maxTurns,
        model: this.model,
        permissionMode: this.permissionMode,
        sandbox: this.sandbox,
        ...(reservedUsd === undefined ? {} : { maxBudgetUsd: reservedUsd }),
        ...(this.pathToClaudeCodeExecutable
          ? { pathToClaudeCodeExecutable: this.pathToClaudeCodeExecutable }
          : {}),
        ...(this.settingSources
          ? { settingSources: [...this.settingSources] }
          : {}),
        ...(this.agentEnv
          ? {
              env: Object.fromEntries(
                Object.entries({ ...process.env, ...this.agentEnv }).filter(
                  (entry): entry is [string, string] => typeof entry[1] === "string",
                ),
              ),
            }
          : {}),
        ...(this.started ? { resume: resumeKey } : { sessionId: this.sessionId }),
        systemPrompt: this.systemPromptAppend
          ? {
              type: "preset",
              preset: "claude_code",
              append: this.systemPromptAppend,
            }
          : undefined,
        title: this.title,
      } satisfies Options,
    });

    this.activeQuery = activeQuery;
    this.started = true;
    this.pump = this.consume(activeQuery);
  }

  /** Drains one query for its whole lifetime; results can represent many turns. */
  private async consume(activeQuery: Query): Promise<void> {
    try {
      for await (const message of activeQuery) {
        this.handleMessage(message);
      }
    } catch (error) {
      if (this.activeQuery === activeQuery) {
        this.setStatus(
          "failed",
          undefined,
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      if (this.activeQuery === activeQuery) {
        this.activeQuery = undefined;
        this.queue = undefined;
        this.abortController = undefined;
      }
    }
  }

  private handleMessage(message: SDKMessage): void {
    if (message.type === "rate_limit_event") {
      const event = message as unknown as {
        rate_limit_info?: {
          status?: "allowed" | "allowed_warning" | "rejected";
          resetsAt?: number | string;
          rateLimitType?: string;
          utilization?: number;
        };
      };
      const info = event.rate_limit_info;
      if (info) {
        let resetsAtIso: string | undefined;
        if (typeof info.resetsAt === "number") {
          resetsAtIso = new Date(
            info.resetsAt > 1e11 ? info.resetsAt : info.resetsAt * 1000,
          ).toISOString();
        } else if (typeof info.resetsAt === "string") {
          resetsAtIso = info.resetsAt;
        }

        const rawUtil = info.utilization;
        const normalizedUtil =
          typeof rawUtil === "number"
            ? rawUtil <= 1 && rawUtil > 0
              ? Math.round(rawUtil * 100)
              : Math.round(rawUtil)
            : undefined;

        this.onRateLimit?.({
          rateLimitType: info.rateLimitType,
          status: info.status,
          utilization: normalizedUtil,
          resetsAt: resetsAtIso,
        });
      }
      return;
    }

    if (message.type === "system" && message.subtype === "init") {
      const initMessage = message as unknown as {
        session_id: string;
        apiKeySource?: unknown;
        apiProvider?: unknown;
      };
      this.authInfo = {
        apiKeySource:
          typeof initMessage.apiKeySource === "string"
            ? initMessage.apiKeySource
            : undefined,
        apiProvider:
          typeof initMessage.apiProvider === "string"
            ? initMessage.apiProvider
            : undefined,
      };
      this.onAuthInfo?.(this.authInfo);
      if (message.session_id !== this.sessionId) {
        // The local row is already keyed by our UUID, but resuming with the
        // SDK's actual id is the only way to avoid a convincing amnesiac chat.
        this.sdkSessionId = message.session_id;
        console.warn(
          `Session ${this.sessionId} adopted SDK session id ${message.session_id}`,
        );
      }
      return;
    }

    if (message.type === "stream_event") {
      const streamEvent = (
        message as {
          event?: {
            type?: string;
            message?: { id?: string };
          };
        }
      ).event;
      if (
        streamEvent?.type === "message_start" &&
        typeof streamEvent.message?.id === "string"
      ) {
        this.currentMessageId = streamEvent.message.id;
      }
    }

    for (const event of translateMessage(
      message,
      this.currentTurnId,
      this.currentMessageId,
    )) {
      this.emit(event as AgentEvent);
    }

    if (message.type === "assistant") {
      this.currentMessageId = undefined;
    }

    if (message.type === "result") {
      this.currentMessageId = undefined;
      this.completeTurn(message);
    }
  }

  private completeTurn(message: SDKResultMessage): void {
    const outcome: TurnOutcome = this.interruptRequested
      ? "interrupted"
      : turnOutcomeFor(message);
    const turnCostUsd = Math.max(
      0,
      message.total_cost_usd - this.queryCostUsd,
    );
    this.queryCostUsd = message.total_cost_usd;
    this.budget.settle(this.sessionId, turnCostUsd);

    const usage = message.usage as {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
    };
    this.emit({
      type: "turn.completed",
      turnId: this.currentTurnId ?? `turn_${message.uuid}`,
      outcome,
      costUsd: turnCostUsd,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      durationMs: message.duration_ms,
      numTurns: message.num_turns,
      detail: message.subtype === "success" ? undefined : message.subtype,
    });
    this.emit({
      type: "session.usage",
      costUsd: turnCostUsd,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
    });

    this.currentTurnId = undefined;
    this.currentMessageId = undefined;
    this.interruptRequested = false;
    this.setStatus(
      outcome === "success" || outcome === "max-turns"
        ? "idle"
        : outcome === "interrupted"
          ? "interrupted"
          : "failed",
      outcome,
    );
    void this.refreshContextUsage();
    this.scheduleIdleClose();
  }

  private setStatus(
    status: SessionStatus,
    outcome?: TurnOutcome,
    detail?: string,
  ): void {
    if (this.status === status && outcome === undefined && detail === undefined) {
      return;
    }
    this.status = status;
    this.emit({ type: "session.status", status, outcome, detail });
  }

  private syncBusyStatus(): void {
    if (this.pendingPermits.size > 0) {
      this.setStatus("awaiting-permit");
    } else if (this.runningTools.size > 0) {
      this.setStatus("working");
    } else if (this.currentTurnId) {
      this.setStatus("thinking");
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  private scheduleIdleClose(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (
        this.runningTools.size > 0 ||
        this.pendingPermits.size > 0 ||
        (this.queue?.size ?? 0) > 0
      ) {
        return;
      }
      void this.goCold();
    }, this.idleCloseMs);
  }

  async goCold(): Promise<void> {
    this.clearIdleTimer();
    const queue = this.queue;
    const activeQuery = this.activeQuery;
    queue?.close();
    await this.pump?.catch(() => undefined);
    activeQuery?.close();
    if (this.activeQuery === activeQuery) {
      this.activeQuery = undefined;
      this.queue = undefined;
      this.abortController = undefined;
    }
  }

  private readonly canUseTool: NonNullable<Options["canUseTool"]> = async (
    toolName,
    input,
    options,
  ) => {
    const targetPaths = extractTargetPaths(input);
    for (const p of targetPaths) {
      if (!isInsideDirectory(this.cwd, p)) {
        return {
          behavior: "deny",
          message: `Access denied: "${p}" is outside the workspace repository.`,
          toolUseID: options.toolUseID,
        };
      }
    }

    if (
      toolName === "Bash" &&
      isRecord(input) &&
      typeof input.command === "string" &&
      isRestrictedBashCommand(input.command)
    ) {
      return {
        behavior: "deny",
        message: "Access denied: command references restricted system paths or out-of-workspace secrets.",
        toolUseID: options.toolUseID,
      };
    }

    if (this.safeTools.has(toolName)) {
      return { behavior: "allow", toolUseID: options.toolUseID };
    }

    this.emit({
      type: "permit.requested",
      toolCallId: options.toolUseID,
      turnId: this.currentTurnId,
      tool: toolName,
      message:
        options.title ??
        options.description ??
        `${toolName} requests permission to proceed.`,
      input: previewInput(input) ?? {},
    });
    this.syncBusyStatus();

    return new Promise<PermissionResult>((resolvePermit, rejectPermit) => {
      this.pendingPermits.set(options.toolUseID, {
        tool: toolName,
        resolve: resolvePermit,
        reject: rejectPermit,
      });
      options.signal.addEventListener(
        "abort",
        () => {
          if (this.pendingPermits.delete(options.toolUseID)) {
            this.emit({
              type: "permit.resolved",
              toolCallId: options.toolUseID,
              decision: "expired",
            });
            this.syncBusyStatus();
          }
          rejectPermit(new Error("Permission request aborted"));
        },
        { once: true },
      );
    });
  };

  resolvePermit(
    toolCallId: string,
    decision: "allow" | "allow-always" | "deny",
  ): boolean {
    const permit = this.pendingPermits.get(toolCallId);
    if (!permit) {
      return false;
    }
    this.pendingPermits.delete(toolCallId);
    this.emit({ type: "permit.resolved", toolCallId, decision });
    if (decision === "deny") {
      this.emit({
        type: "tool.completed",
        toolCallId,
        turnId: this.currentTurnId,
        outcome: "denied",
      });
      permit.resolve({
        behavior: "deny",
        message: "The mayor denied this building permit.",
        toolUseID: toolCallId,
      });
    } else {
      const updatedPermissions =
        decision === "allow-always"
          ? ([
              {
                type: "addRules",
                rules: [{ toolName: permit.tool }],
                behavior: "allow",
                destination: "session",
              },
            ] satisfies PermissionUpdate[])
          : undefined;
      permit.resolve({
        behavior: "allow",
        toolUseID: toolCallId,
        updatedPermissions,
      });
    }
    this.syncBusyStatus();
    return true;
  }

  /** Stops only the current turn; the SDK conversation and resume key survive. */
  async interrupt(): Promise<void> {
    this.interruptRequested = true;
    for (const [toolCallId, permit] of this.pendingPermits) {
      this.emit({
        type: "permit.resolved",
        toolCallId,
        decision: "expired",
      });
      permit.reject(new Error("Session interrupted"));
    }
    this.pendingPermits.clear();
    this.runningTools.clear();
    await this.activeQuery?.interrupt().catch(() => undefined);
    this.currentTurnId = undefined;
    this.currentMessageId = undefined;
    this.setStatus("interrupted", "interrupted");
    this.scheduleIdleClose();
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.permissionMode = mode;
    await this.activeQuery?.setPermissionMode(mode).catch(() => undefined);
  }

  async setModel(model: string): Promise<void> {
    this.model = model;
    await this.activeQuery?.setModel(model).catch(() => undefined);
  }

  setEffort(effort: EffortLevel): void {
    this.effort = effort;
  }

  private async refreshContextUsage(): Promise<void> {
    const usage = await this.activeQuery?.getContextUsage().catch(() => undefined);
    if (usage) {
      this.contextPercent = usage.percentage;
      this.onContextUsage?.(usage.percentage);
    }
  }

  isRunning(): boolean {
    return (
      this.currentTurnId !== undefined ||
      this.runningTools.size > 0 ||
      this.pendingPermits.size > 0
    );
  }

  isLive(): boolean {
    return this.activeQuery !== undefined;
  }

  async dispose(): Promise<void> {
    this.clearIdleTimer();
    await this.interrupt();
    await this.goCold();
    this.setStatus("closed");
  }

  private createHooks(): NonNullable<Options["hooks"]> {
    return {
      PreToolUse: [{ hooks: [this.onPreToolUse] }],
      PostToolUse: [{ hooks: [this.onPostToolUse] }],
      PostToolUseFailure: [{ hooks: [this.onPostToolUseFailure] }],
      SessionStart: [{ hooks: [this.onSessionStart] }],
      Stop: [{ hooks: [this.onStop] }],
      StopFailure: [{ hooks: [this.onStopFailure] }],
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
      this.runningTools.set(input.tool_use_id, {
        tool: input.tool_name,
        startedAt: Date.now(),
      });
      this.emit({
        type: "tool.started",
        toolCallId: input.tool_use_id,
        turnId: this.currentTurnId,
        tool: input.tool_name,
        target: toolTarget(input.tool_input, this.cwd),
        input: previewInput(input.tool_input),
      });
      this.syncBusyStatus();
    }
    return {};
  };

  private readonly onPostToolUse: HookCallback = async (input) => {
    if (input.hook_event_name === "PostToolUse") {
      const running = this.runningTools.get(input.tool_use_id);
      this.runningTools.delete(input.tool_use_id);
      this.emit({
        type: "tool.completed",
        toolCallId: input.tool_use_id,
        turnId: this.currentTurnId,
        outcome: "success",
        durationMs:
          input.duration_ms ??
          (running ? Math.max(0, Date.now() - running.startedAt) : undefined),
        resultPreview: previewResult(input.tool_response),
      });
      this.syncBusyStatus();
    }
    return {};
  };

  private readonly onPostToolUseFailure: HookCallback = async (input) => {
    if (input.hook_event_name === "PostToolUseFailure") {
      const running = this.runningTools.get(input.tool_use_id);
      this.runningTools.delete(input.tool_use_id);
      this.emit({
        type: "tool.completed",
        toolCallId: input.tool_use_id,
        turnId: this.currentTurnId,
        outcome: input.is_interrupt ? "interrupted" : "error",
        durationMs:
          input.duration_ms ??
          (running ? Math.max(0, Date.now() - running.startedAt) : undefined),
        resultPreview: input.is_interrupt ? undefined : input.error,
      });
      this.syncBusyStatus();
    }
    return {};
  };

  private readonly onSessionStart: HookCallback = async (input) => {
    if (input.hook_event_name === "SessionStart") {
      console.debug(`Session ${this.sessionId} started from ${input.source}`);
    }
    return {};
  };

  private readonly onStop: HookCallback = async (input) => {
    if (input.hook_event_name === "Stop") {
      this.syncBusyStatus();
    }
    return {};
  };

  private readonly onStopFailure: HookCallback = async (input) => {
    if (input.hook_event_name === "StopFailure") {
      const value = input as unknown as { error_details?: string; error?: unknown };
      this.setStatus(
        "failed",
        "error",
        value.error_details ?? String(value.error ?? "Stop hook failed"),
      );
    }
    return {};
  };

  private readonly onFileChanged: HookCallback = async (input) => {
    if (input.hook_event_name === "FileChanged") {
      this.emit({
        type: "file.changed",
        path: normalisePath(relative(this.cwd, input.file_path)),
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
      this.emit({
        type: "compact.changed",
        status: "started",
        trigger: input.trigger,
      });
      this.setStatus("compacting");
    }
    return {};
  };

  private readonly onPostCompact: HookCallback = async (_input) => ({});
}
