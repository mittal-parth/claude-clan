import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("server terminal security (zero shell endpoints on hosted server)", () => {
  const serverSrcDir = join(import.meta.dirname, "../src");

  function getAllTsFiles(dir: string): string[] {
    const results: string[] = [];
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...getAllTsFiles(fullPath));
      } else if (fullPath.endsWith(".ts")) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const allFiles = getAllTsFiles(serverSrcDir);

  it("never imports node-pty in apps/server", () => {
    for (const file of allFiles) {
      const content = readFileSync(file, "utf8");
      expect(content).not.toContain("node-pty");
      expect(content).not.toContain("from 'node-pty'");
      expect(content).not.toContain('from "node-pty"');
    }
  });

  it("never registers any /api/terminal or websocket terminal route on apps/server", () => {
    for (const file of allFiles) {
      const content = readFileSync(file, "utf8");
      expect(content).not.toContain("/api/terminal");
      expect(content).not.toContain("claude-city:terminal");
    }
  });
});
