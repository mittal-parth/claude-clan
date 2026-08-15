import { describe, expect, it } from "vitest";
import {
  ALWAYS_IGNORED,
  UPLOAD_BATCH_BYTES,
  UPLOAD_MAX_BYTES,
  UPLOAD_MAX_FILE_BYTES,
  UPLOAD_MAX_FILES,
  createUploadFilter,
  sanitiseUploadPath,
} from "../src/upload";

describe("sanitiseUploadPath", () => {
  it("accepts clean relative paths", () => {
    expect(sanitiseUploadPath("src/index.ts")).toBe("src/index.ts");
    expect(sanitiseUploadPath("package.json")).toBe("package.json");
    expect(sanitiseUploadPath("a/b/c/d.txt")).toBe("a/b/c/d.txt");
  });

  it("normalises redundant separators and current directory segments", () => {
    expect(sanitiseUploadPath("./src/index.ts")).toBe("src/index.ts");
    expect(sanitiseUploadPath("src/./utils/helper.ts")).toBe("src/utils/helper.ts");
  });

  it("rejects path traversal escaping root", () => {
    expect(sanitiseUploadPath("../secret.txt")).toBeUndefined();
    expect(sanitiseUploadPath("src/../../secret.txt")).toBeUndefined();
    expect(sanitiseUploadPath("..")).toBeUndefined();
    expect(sanitiseUploadPath("a/..")).toBeUndefined();
  });

  it("rejects absolute paths", () => {
    expect(sanitiseUploadPath("/etc/passwd")).toBeUndefined();
    expect(sanitiseUploadPath("/src/index.ts")).toBeUndefined();
    expect(sanitiseUploadPath("C:/Windows/system32")).toBeUndefined();
    expect(sanitiseUploadPath("D:\\repo\\file.txt")).toBeUndefined();
  });

  it("rejects backslashes, NUL bytes, and control characters", () => {
    expect(sanitiseUploadPath("src\\index.ts")).toBeUndefined();
    expect(sanitiseUploadPath("src/\0evil.js")).toBeUndefined();
    expect(sanitiseUploadPath("src/\x01evil.js")).toBeUndefined();
    expect(sanitiseUploadPath("src/\x7fevil.js")).toBeUndefined();
  });

  it("rejects Windows reserved device names", () => {
    expect(sanitiseUploadPath("CON")).toBeUndefined();
    expect(sanitiseUploadPath("con.txt")).toBeUndefined();
    expect(sanitiseUploadPath("src/AUX")).toBeUndefined();
    expect(sanitiseUploadPath("src/aux.js")).toBeUndefined();
    expect(sanitiseUploadPath("NUL")).toBeUndefined();
    expect(sanitiseUploadPath("COM1")).toBeUndefined();
    expect(sanitiseUploadPath("LPT3.log")).toBeUndefined();
  });

  it("rejects empty or whitespace-only inputs", () => {
    expect(sanitiseUploadPath("")).toBeUndefined();
    expect(sanitiseUploadPath("   ")).toBeUndefined();
  });
});

describe("createUploadFilter", () => {
  it("skips ALWAYS_IGNORED directories and files unconditionally", () => {
    const filter = createUploadFilter();

    expect(filter.shouldSkip("node_modules", true)).toBe(true);
    expect(filter.shouldSkip("node_modules/react/index.js", false)).toBe(true);
    expect(filter.shouldSkip("foo/node_modules/bar.js", false)).toBe(true);
    expect(filter.shouldSkip(".git", true)).toBe(true);
    expect(filter.shouldSkip(".git/config", false)).toBe(true);
    expect(filter.shouldSkip(".env", false)).toBe(true);
    expect(filter.shouldSkip(".env.local", false)).toBe(true);
    expect(filter.shouldSkip("app.log", false)).toBe(true);
    expect(filter.shouldSkip(".DS_Store", false)).toBe(true);
    expect(filter.shouldSkip("dist", true)).toBe(true);
    expect(filter.shouldSkip("dist/bundle.js", false)).toBe(true);
    expect(filter.shouldSkip("archive.zip", false)).toBe(true);
    expect(filter.shouldSkip("db.sqlite", false)).toBe(true);
  });

  it("never allows .gitignore negation to unignore ALWAYS_IGNORED entries", () => {
    const filter = createUploadFilter();
    filter.addGitignore("", "!node_modules\n!node_modules/**\n!dist\n!*.zip\n!.env");

    expect(filter.shouldSkip("node_modules", true)).toBe(true);
    expect(filter.shouldSkip("node_modules/index.js", false)).toBe(true);
    expect(filter.shouldSkip("dist/bundle.js", false)).toBe(true);
    expect(filter.shouldSkip("data.zip", false)).toBe(true);
    expect(filter.shouldSkip(".env", false)).toBe(true);
  });

  it("honours root .gitignore rules for non-ALWAYS_IGNORED files", () => {
    const filter = createUploadFilter();
    filter.addGitignore("", "*.tmp\nsecret_folder/\n!important.tmp");

    expect(filter.shouldSkip("foo.tmp", false)).toBe(true);
    expect(filter.shouldSkip("important.tmp", false)).toBe(false);
    expect(filter.shouldSkip("secret_folder", true)).toBe(true);
    expect(filter.shouldSkip("secret_folder/file.txt", false)).toBe(true);
    expect(filter.shouldSkip("src/index.ts", false)).toBe(false);
  });

  it("scopes nested .gitignore rules strictly to their subtree", () => {
    const filter = createUploadFilter();
    filter.addGitignore("", "*.generated.ts");
    filter.addGitignore("packages/nested", "local-ignore/\n*.local.ts\n!root.generated.ts");

    // Root rule applies to all packages
    expect(filter.shouldSkip("src/app.generated.ts", false)).toBe(true);
    expect(filter.shouldSkip("packages/nested/file.generated.ts", false)).toBe(true);

    // Nested rule applies inside packages/nested
    expect(filter.shouldSkip("packages/nested/local-ignore", true)).toBe(true);
    expect(filter.shouldSkip("packages/nested/local-ignore/file.txt", false)).toBe(true);
    expect(filter.shouldSkip("packages/nested/test.local.ts", false)).toBe(true);

    // Nested rule does NOT leak outside packages/nested
    expect(filter.shouldSkip("packages/other/local-ignore", true)).toBe(false);
    expect(filter.shouldSkip("packages/other/test.local.ts", false)).toBe(false);
    expect(filter.shouldSkip("src/test.local.ts", false)).toBe(false);
  });
});

describe("upload constants", () => {
  it("exports expected cap constants", () => {
    expect(UPLOAD_MAX_BYTES).toBe(150 * 1024 * 1024);
    expect(UPLOAD_MAX_FILES).toBe(20_000);
    expect(UPLOAD_MAX_FILE_BYTES).toBe(8 * 1024 * 1024);
    expect(UPLOAD_BATCH_BYTES).toBe(6 * 1024 * 1024);
  });
});
