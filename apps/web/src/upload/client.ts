import {
  UPLOAD_BATCH_BYTES,
  UPLOAD_MAX_FILE_BYTES,
} from "@sudo-city/protocol";
import type { WalkFile } from "./walk";

export interface UploadProgress {
  sentBytes: number;
  totalBytes: number;
  percent: number;
}

export interface UploadClientOptions {
  rootName: string;
  files: WalkFile[];
  totalBytes: number;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

export interface UploadResult {
  uploadId: string;
  repoKey: string;
  name: string;
}

export function sendDiscardBeacon(uploadId: string): void {
  const url = `/api/uploads/${encodeURIComponent(uploadId)}/discard`;
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      const blob = new Blob([], { type: "text/plain" });
      navigator.sendBeacon(url, blob);
      return;
    } catch {
      // Fall through to fetch
    }
  }

  void fetch(url, {
    method: "POST",
    keepalive: true,
  }).catch(() => {
    // Ignore discard failure on teardown
  });
}

export async function discardUpload(uploadId: string): Promise<void> {
  await fetch(`/api/uploads/${encodeURIComponent(uploadId)}/discard`, {
    method: "POST",
  }).catch(() => {});
}

/**
 * Uploads a walked directory to the server in <= 6 MB batches with up to 3 concurrent requests.
 */
export async function uploadDirectory(options: UploadClientOptions): Promise<UploadResult> {
  const { rootName, files, totalBytes, onProgress, signal } = options;

  // 1. Create upload session
  const initRes = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rootName }),
    signal,
  });

  if (!initRes.ok) {
    const errorText = await initRes.text().catch(() => "Failed to initialize upload");
    throw new Error(errorText || `Failed to initialize upload (${initRes.status})`);
  }

  const { uploadId } = (await initRes.json()) as { uploadId: string; rootName: string };

  // 2. Chunk files into <= 6MB batches
  const batches: WalkFile[][] = [];
  let currentBatch: WalkFile[] = [];
  let currentBatchBytes = 0;

  for (const file of files) {
    if (file.file.size > UPLOAD_MAX_FILE_BYTES) {
      continue;
    }

    if (
      currentBatch.length > 0 &&
      currentBatchBytes + file.file.size > UPLOAD_BATCH_BYTES
    ) {
      batches.push(currentBatch);
      currentBatch = [file];
      currentBatchBytes = file.file.size;
    } else {
      currentBatch.push(file);
      currentBatchBytes += file.file.size;
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  let sentBytes = 0;
  const notifyProgress = () => {
    const safeTotal = Math.max(1, totalBytes);
    const clampedSent = Math.min(sentBytes, safeTotal);
    const percent = Math.round((clampedSent / safeTotal) * 100);
    onProgress?.({ sentBytes: clampedSent, totalBytes: safeTotal, percent });
  };

  notifyProgress();

  // 3. Upload batches with concurrency = 3
  const CONCURRENCY = 3;
  let batchIndex = 0;

  async function uploadBatchWorker(): Promise<void> {
    while (batchIndex < batches.length) {
      if (signal?.aborted) {
        throw new Error("Upload aborted");
      }

      const currentIndex = batchIndex++;
      const batch = batches[currentIndex];
      if (!batch || batch.length === 0) continue;

      const formData = new FormData();
      let batchBytes = 0;
      for (const item of batch) {
        formData.append("files", item.file, item.path);
        batchBytes += item.file.size;
      }

      const batchRes = await fetch(`/api/uploads/${encodeURIComponent(uploadId)}/files`, {
        method: "POST",
        body: formData,
        signal,
      });

      if (!batchRes.ok) {
        const errorMsg = await batchRes.text().catch(() => "Batch upload failed");
        throw new Error(errorMsg || `Batch upload failed (${batchRes.status})`);
      }

      sentBytes += batchBytes;
      notifyProgress();
    }
  }

  try {
    const workers = Array.from(
      { length: Math.min(CONCURRENCY, batches.length || 1) },
      () => uploadBatchWorker(),
    );
    await Promise.all(workers);

    // 4. Finalise upload
    const finalRes = await fetch(`/api/uploads/${encodeURIComponent(uploadId)}/finalise`, {
      method: "POST",
      signal,
    });

    if (!finalRes.ok) {
      const errorMsg = await finalRes.text().catch(() => "Failed to finalise upload");
      throw new Error(errorMsg || `Failed to finalise upload (${finalRes.status})`);
    }

    const { repoKey, name } = (await finalRes.json()) as { repoKey: string; name: string };
    return { uploadId, repoKey, name };
  } catch (error) {
    // If upload fails or is cancelled, clean up server-side upload
    sendDiscardBeacon(uploadId);
    throw error;
  }
}
