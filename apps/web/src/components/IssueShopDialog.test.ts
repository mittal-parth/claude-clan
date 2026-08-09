import type { Issue } from "@sudo-city/protocol";
import { describe, expect, it } from "vitest";

const sampleIssues: Issue[] = [
  {
    number: 42,
    title: "Fix broken construction crane animation",
    body: "The crane stays raised after tool completion.",
    author: "octocat",
    url: "https://github.com/example/repo/issues/42",
  },
  {
    number: 108,
    title: "Add WebSocket reconnect backoff",
    body: "Server disconnects should retry automatically.",
    author: "dev-person",
    url: "https://github.com/example/repo/issues/108",
  },
];

function filterIssues(issues: readonly Issue[], query: string): Issue[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...issues];
  return issues.filter((issue) => {
    return (
      issue.title.toLowerCase().includes(needle) ||
      `#${issue.number}`.includes(needle) ||
      issue.author.toLowerCase().includes(needle) ||
      (issue.body && issue.body.toLowerCase().includes(needle))
    );
  });
}

describe("IssueShopDialog issue filtering", () => {
  it("returns all issues when search query is empty", () => {
    expect(filterIssues(sampleIssues, "")).toHaveLength(2);
  });

  it("filters by issue number", () => {
    const results = filterIssues(sampleIssues, "#42");
    expect(results).toHaveLength(1);
    expect(results[0]?.number).toBe(42);
  });

  it("filters by title substring", () => {
    const results = filterIssues(sampleIssues, "websocket");
    expect(results).toHaveLength(1);
    expect(results[0]?.number).toBe(108);
  });

  it("filters by author handle", () => {
    const results = filterIssues(sampleIssues, "octocat");
    expect(results).toHaveLength(1);
    expect(results[0]?.author).toBe("octocat");
  });
});
