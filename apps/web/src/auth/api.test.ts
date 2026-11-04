import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloneLocalGithubRepo, fetchLocalGithubRepos } from "./api";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("local GitHub API client", () => {
  it("reads the graceful gh status response", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      available: false,
      authenticated: false,
      repos: [],
      error: "GitHub CLI is not installed",
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(fetchLocalGithubRepos()).resolves.toEqual({
      available: false,
      authenticated: false,
      repos: [],
      error: "GitHub CLI is not installed",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/local/github/repos", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("consumes clone progress and the ready payload", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('{"phase":"cloning","message":"cloning with gh"}\n{"phase":"ready","workspaceKey":"local:/tmp/project","path":"/tmp/project"}\n'));
        controller.close();
      },
    });
    fetchMock.mockResolvedValue(new Response(stream, { status: 200 }));
    const progress: string[] = [];

    await expect(cloneLocalGithubRepo("octocat/project", (message) => progress.push(message))).resolves.toEqual({
      workspaceKey: "local:/tmp/project",
      path: "/tmp/project",
    });
    expect(progress).toEqual(["cloning with gh"]);
    expect(fetchMock).toHaveBeenCalledWith("/api/local/github/clone", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ fullName: "octocat/project" }),
    }));
  });

  it("surfaces streamed clone errors", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"error":"GitHub CLI is not signed in"}\n'));
        controller.close();
      },
    });
    fetchMock.mockResolvedValue(new Response(stream, { status: 200 }));

    await expect(cloneLocalGithubRepo("octocat/project")).rejects.toThrow("not signed in");
  });
});
