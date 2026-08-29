import { describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: queryMock }));

const { SessionRunner } = await import("../src/runner.js");

describe("rate_limit_event handling in SessionRunner", () => {
  it("parses five_hour rate_limit_event and notifies onRateLimit", async () => {
    queryMock.mockReset();
    const onRateLimit = vi.fn();

    queryMock.mockImplementation(({ options }) => ({
      ...options,
      interrupt: vi.fn().mockResolvedValue(undefined),
      setPermissionMode: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(undefined),
      getContextUsage: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      async *[Symbol.asyncIterator]() {
        yield {
          type: "rate_limit_event",
          rate_limit_info: {
            rateLimitType: "five_hour",
            status: "allowed",
            utilization: 35,
            resetsAt: 1724968800000,
          },
        };
      },
    }));

    const runner = new SessionRunner({
      sessionId: "s1",
      cwd: process.cwd(),
      emit: () => undefined,
      model: "sonnet",
      effort: "low",
      permissionMode: "default",
      onRateLimit,
      budget: { reserve: () => undefined, settle: () => undefined },
    });

    await runner.send("hello");
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onRateLimit).toHaveBeenCalledWith({
      rateLimitType: "five_hour",
      status: "allowed",
      utilization: 35,
      resetsAt: new Date(1724968800000).toISOString(),
    });
    await runner.goCold();
  });

  it("normalizes fraction utilization and epoch seconds resetsAt", async () => {
    queryMock.mockReset();
    const onRateLimit = vi.fn();

    queryMock.mockImplementation(({ options }) => ({
      ...options,
      interrupt: vi.fn().mockResolvedValue(undefined),
      setPermissionMode: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(undefined),
      getContextUsage: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      async *[Symbol.asyncIterator]() {
        yield {
          type: "rate_limit_event",
          rate_limit_info: {
            rateLimitType: "seven_day_sonnet",
            status: "allowed_warning",
            utilization: 0.85,
            resetsAt: 1725000000, // seconds epoch
          },
        };
      },
    }));

    const runner = new SessionRunner({
      sessionId: "s2",
      cwd: process.cwd(),
      emit: () => undefined,
      model: "sonnet",
      effort: "low",
      permissionMode: "default",
      onRateLimit,
      budget: { reserve: () => undefined, settle: () => undefined },
    });

    await runner.send("hello");
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onRateLimit).toHaveBeenCalledWith({
      rateLimitType: "seven_day_sonnet",
      status: "allowed_warning",
      utilization: 85,
      resetsAt: new Date(1725000000 * 1000).toISOString(),
    });
    await runner.goCold();
  });
});
