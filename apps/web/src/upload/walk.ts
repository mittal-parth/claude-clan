import {
  createUploadFilter,
  sanitiseUploadPath,
  UPLOAD_MAX_FILE_BYTES,
  type UploadFilter,
} from "@sudo-city/protocol";

export interface WalkFile {
  path: string;
  file: File;
}

export interface WalkResult {
  rootName: string;
  files: WalkFile[];
  totalBytes: number;
  skippedFiles: number;
  skippedBytes: number;
  skippedCategories: Set<string>;
}

// Minimal types for FileSystemEntry API to run in browser and unit tests
export interface SimpleFileEntry {
  isFile: true;
  isDirectory: false;
  name: string;
  file: (successCallback: (file: File) => void, errorCallback?: (error: unknown) => void) => void;
}

export interface SimpleDirectoryReader {
  readEntries: (
    successCallback: (entries: SimpleEntry[]) => void,
    errorCallback?: (error: unknown) => void,
  ) => void;
}

export interface SimpleDirectoryEntry {
  isFile: false;
  isDirectory: true;
  name: string;
  createReader: () => SimpleDirectoryReader;
}

export type SimpleEntry = SimpleFileEntry | SimpleDirectoryEntry;

function detectCategory(nameOrPath: string): string {
  const parts = nameOrPath.split("/");
  for (const part of parts) {
    if (
      part === "node_modules" ||
      part === "dist" ||
      part === "build" ||
      part === ".venv" ||
      part === "venv" ||
      part === "target" ||
      part === "vendor" ||
      part === ".git" ||
      part === ".next" ||
      part === ".turbo" ||
      part === "coverage"
    ) {
      return part;
    }
  }
  if (nameOrPath.endsWith(".zip") || nameOrPath.endsWith(".tar.gz")) {
    return "archives";
  }
  if (nameOrPath.startsWith(".env")) {
    return ".env";
  }
  return parts[0] || nameOrPath;
}

function readAllEntries(reader: SimpleDirectoryReader): Promise<SimpleEntry[]> {
  return new Promise((resolve, reject) => {
    const all: SimpleEntry[] = [];
    function readBatch() {
      reader.readEntries((entries) => {
        if (!entries || entries.length === 0) {
          resolve(all);
        } else {
          all.push(...entries);
          readBatch();
        }
      }, reject);
    }
    readBatch();
  });
}

function entryToFile(fileEntry: SimpleFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    fileEntry.file(resolve, reject);
  });
}

/**
 * Traverses a FileSystemDirectoryEntry tree with eager directory pruning.
 * If a directory matches ALWAYS_IGNORED (like node_modules), it is never
 * read or enumerated.
 */
export async function walkDirectoryEntry(
  rootEntry: SimpleDirectoryEntry,
  onProgress?: (scannedFiles: number, scannedBytes: number) => void,
): Promise<WalkResult> {
  const filter: UploadFilter = createUploadFilter();
  const files: WalkFile[] = [];
  let totalBytes = 0;
  let skippedFiles = 0;
  let skippedBytes = 0;
  const skippedCategories = new Set<string>();

  const rootName = rootEntry.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "repository";

  async function walkDir(dirEntry: SimpleDirectoryEntry, relPath: string): Promise<void> {
    // Eager pruning: before calling createReader, check if this directory is skipped
    if (relPath !== "" && filter.shouldSkip(relPath, true)) {
      skippedFiles += 1;
      skippedCategories.add(detectCategory(relPath));
      return;
    }

    const reader = dirEntry.createReader();
    const entries = await readAllEntries(reader);

    // Pass 1: look for .gitignore in this directory and feed to filter
    const gitignoreEntry = entries.find((e) => e.isFile && e.name === ".gitignore");
    if (gitignoreEntry && gitignoreEntry.isFile) {
      try {
        const gitignoreFile = await entryToFile(gitignoreEntry as SimpleFileEntry);
        const text = await gitignoreFile.text();
        filter.addGitignore(relPath, text);
      } catch {
        // Continue without this .gitignore if unreadable
      }
    }

    // Pass 2: process files and subdirectories
    for (const entry of entries) {
      const childRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;
      const cleanPath = sanitiseUploadPath(childRelPath);
      if (!cleanPath) {
        skippedFiles++;
        skippedCategories.add(detectCategory(entry.name));
        continue;
      }

      if (entry.isDirectory) {
        if (filter.shouldSkip(cleanPath, true)) {
          skippedFiles++;
          skippedCategories.add(detectCategory(entry.name));
          continue;
        }
        await walkDir(entry as SimpleDirectoryEntry, cleanPath);
      } else if (entry.isFile) {
        if (filter.shouldSkip(cleanPath, false)) {
          skippedFiles++;
          skippedCategories.add(detectCategory(entry.name));
          continue;
        }

        try {
          const file = await entryToFile(entry as SimpleFileEntry);
          if (file.size > UPLOAD_MAX_FILE_BYTES) {
            // Stray huge file: skip and count
            skippedFiles++;
            skippedBytes += file.size;
            skippedCategories.add("large_files");
            continue;
          }

          files.push({ path: cleanPath, file });
          totalBytes += file.size;
          onProgress?.(files.length, totalBytes);
        } catch {
          skippedFiles++;
        }
      }
    }
  }

  await walkDir(rootEntry, "");

  return {
    rootName,
    files,
    totalBytes,
    skippedFiles,
    skippedBytes,
    skippedCategories,
  };
}

/**
 * Fallback for <input type="file" webkitdirectory>
 */
export async function walkFileList(
  fileList: FileList | File[],
  onProgress?: (scannedFiles: number, scannedBytes: number) => void,
): Promise<WalkResult> {
  const filter = createUploadFilter();
  const files: WalkFile[] = [];
  let totalBytes = 0;
  let skippedFiles = 0;
  let skippedBytes = 0;
  const skippedCategories = new Set<string>();

  const rawFiles = Array.from(fileList);
  if (rawFiles.length === 0) {
    return {
      rootName: "upload",
      files: [],
      totalBytes: 0,
      skippedFiles: 0,
      skippedBytes: 0,
      skippedCategories,
    };
  }

  // Derive root name from the first path segment of webkitRelativePath
  const samplePath = rawFiles[0]?.webkitRelativePath || rawFiles[0]?.name || "upload";
  const firstSlash = samplePath.indexOf("/");
  const rootName = (firstSlash >= 0 ? samplePath.slice(0, firstSlash) : "upload")
    .replace(/[^a-zA-Z0-9._-]/g, "_");

  // Pass 1: read all .gitignore files
  for (const file of rawFiles) {
    const rawRel = file.webkitRelativePath
      ? file.webkitRelativePath.slice(firstSlash + 1)
      : file.name;
    if (rawRel.endsWith(".gitignore")) {
      const dir = rawRel.slice(0, -".gitignore".length).replace(/\/+$/, "");
      try {
        const text = await file.text();
        filter.addGitignore(dir, text);
      } catch {
        // ignore
      }
    }
  }

  // Pass 2: filter files
  for (const file of rawFiles) {
    const rawRel = file.webkitRelativePath
      ? file.webkitRelativePath.slice(firstSlash + 1)
      : file.name;
    const cleanPath = sanitiseUploadPath(rawRel);
    if (!cleanPath || filter.shouldSkip(cleanPath, false)) {
      skippedFiles++;
      skippedBytes += file.size;
      skippedCategories.add(detectCategory(rawRel));
      continue;
    }

    if (file.size > UPLOAD_MAX_FILE_BYTES) {
      skippedFiles++;
      skippedBytes += file.size;
      skippedCategories.add("large_files");
      continue;
    }

    files.push({ path: cleanPath, file });
    totalBytes += file.size;
    onProgress?.(files.length, totalBytes);
  }

  return {
    rootName,
    files,
    totalBytes,
    skippedFiles,
    skippedBytes,
    skippedCategories,
  };
}
