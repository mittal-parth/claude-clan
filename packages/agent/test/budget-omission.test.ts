import { describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: queryMock }));

const { SessionRunner } = await import("../src/runner.js");

function installQueryMock(): void {
  queryMock.mockImplementation(({ options }) => ({
    ...options,
    interrupt: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    getContextUsage: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    async *[Symbol.asyncIterator]() {},
  }));
}

function runnerWith(
  reserve: () => number | undefined,
  onAuthInfo?: (info: { apiKeySource?: string; apiProvider?: string }) => void,
): InstanceType<typeof SessionRunner> {
  return new SessionRunner({
    sessionId: "s1",
    cwd: process.cwd(),
    emit: () => undefined,
    model: "haiku",
    effort: "low",
    permissionMode: "default",
    onAuthInfo,
    budget: { reserve, settle: () => undefined },
  });
}

describe("maxBudgetUsd", () => {
  it("is omitted entirely when the reservation is undefined", async () => {
    queryMock.mockReset();
    installQueryMock();

    const runner = runnerWith(() => undefined);
    await runner.send("hello");
    const options = queryMock.mock.calls[0]![0].options;
    expect("maxBudgetUsd" in options).toBe(false);
    await runner.goCold();
  });

  it("is sent when a ceiling is reserved", async () => {
    queryMock.mockReset();
    installQueryMock();

    const runner = runnerWith(() => 0.5);
    await runner.send("hello");
    expect(queryMock.mock.calls[0]![0].options.maxBudgetUsd).toBe(0.5);
    await runner.goCold();
  });

  it("surfaces credential metadata from the SDK init message", async () => {
    queryMock.mockReset();
    const onAuthInfo = vi.fn();
    queryMock.mockImplementation(({ options }) => ({
      ...options,
      interrupt: vi.fn().mockResolvedValue(undefined),
      setPermissionMode: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(undefined),
      getContextUsage: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      async *[Symbol.asyncIterator]() {
        yield {
          type: "system",
          subtype: "init",
          session_id: "sdk-session",
          apiKeySource: "/login managed key",
          apiProvider: undefined,
        };
      },
    }));

    const runner = runnerWith(() => undefined, onAuthInfo);
    await runner.send("hello");
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(runner.credentialInfo).toEqual({
      apiKeySource: "/login managed key",
      apiProvider: undefined,
    });
    expect(onAuthInfo).toHaveBeenCalledWith({
      apiKeySource: "/login managed key",
      apiProvider: undefined,
    });
    await runner.goCold();
  });

});