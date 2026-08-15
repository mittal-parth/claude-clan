import { useRef, useState } from "react";
import { localOpenFolder, localPickFolder } from "@/auth/api";
import HudButton from "@/components/hud/HudButton";
import "@/components/ui/8bit/styles/retro.css";
import { cn } from "@/lib/utils";
import { UPLOAD_MAX_BYTES } from "@sudo-city/protocol";
import { FolderUp, FolderSearch, HardDrive, AlertCircle, X } from "lucide-react";
import { uploadDirectory } from "./client";
import UploadCeremony, {
  type CeremonyStage,
  type UploadCeremonyState,
} from "./UploadCeremony";
import {
  walkDirectoryEntry,
  walkFileList,
  type SimpleDirectoryEntry,
} from "./walk";

export interface DropSurfaceProps {
  serverMode: "local" | "hosted";
  onSelectRepoKey: (repoKey: string) => void;
  onClose?: () => void;
  embedded?: boolean;
  className?: string;
}

export default function DropSurface({
  serverMode,
  onSelectRepoKey,
  onClose,
  embedded = false,
  className,
}: DropSurfaceProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [localPath, setLocalPath] = useState("");
  const [localError, setLocalError] = useState<string>();
  const [localLoading, setLocalLoading] = useState(false);

  const [ceremonyState, setCeremonyState] = useState<UploadCeremonyState | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleLocalPick() {
    setLocalError(undefined);
    setLocalLoading(true);
    try {
      const result = await localPickFolder();
      if ("unavailable" in result) {
        setLocalError("Folder picker unavailable. Enter path manually below.");
        return;
      }
      const openResult = await localOpenFolder(result.path);
      onSelectRepoKey(openResult.repoKey);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to open folder");
    } finally {
      setLocalLoading(false);
    }
  }

  async function handleLocalOpen(path: string) {
    if (!path.trim()) return;
    setLocalError(undefined);
    setLocalLoading(true);
    try {
      const result = await localOpenFolder(path.trim());
      onSelectRepoKey(result.repoKey);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to open directory");
    } finally {
      setLocalLoading(false);
    }
  }

  async function processDroppedItems(dataTransfer: DataTransfer) {
    const items = dataTransfer.items;
    if (!items || items.length === 0) return;

    let dirEntry: SimpleDirectoryEntry | null = null;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item?.kind === "file") {
        const entry = item.webkitGetAsEntry?.();
        if (entry && entry.isDirectory) {
          dirEntry = entry as unknown as SimpleDirectoryEntry;
          break;
        }
      }
    }

    if (dirEntry) {
      await startHostedUpload((onProgress) => walkDirectoryEntry(dirEntry!, onProgress));
    } else if (dataTransfer.files.length > 0) {
      await startHostedUpload((onProgress) => walkFileList(dataTransfer.files, onProgress));
    }
  }

  async function startHostedUpload(
    walker: (onProgress: (scannedFiles: number, scannedBytes: number) => void) => Promise<any>,
  ) {
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const initialState: UploadCeremonyState = {
      stage: "survey",
      folderName: "scanning…",
      surveyFiles: 0,
      surveyBytes: 0,
      skippedFiles: 0,
      skippedCategories: [],
      uploadPercent: 0,
      uploadSentBytes: 0,
      uploadTotalBytes: 0,
    };
    setCeremonyState(initialState);

    try {
      // 1. SURVEY
      const walkResult = await walker((scannedFiles, scannedBytes) => {
        setCeremonyState((prev) =>
          prev
            ? {
                ...prev,
                surveyFiles: scannedFiles,
                surveyBytes: scannedBytes,
              }
            : null,
        );
      });

      if (walkResult.totalBytes > UPLOAD_MAX_BYTES) {
        throw new Error(
          `Folder exceeds 150 MB limit (${(walkResult.totalBytes / (1024 * 1024)).toFixed(1)} MB after filtering).`,
        );
      }

      // 2. MANIFEST
      setCeremonyState((prev) =>
        prev
          ? {
              ...prev,
              stage: "manifest",
              folderName: walkResult.rootName,
              surveyFiles: walkResult.files.length,
              surveyBytes: walkResult.totalBytes,
              skippedFiles: walkResult.skippedFiles,
              skippedCategories: Array.from(walkResult.skippedCategories as Set<string>),
              uploadTotalBytes: walkResult.totalBytes,
            }
          : null,
      );

      // Brief delay so the manifest screen is visible
      await new Promise((r) => setTimeout(r, 450));

      // 3. AIRLIFT
      setCeremonyState((prev) => (prev ? { ...prev, stage: "airlift" } : null));

      const uploadResult = await uploadDirectory({
        rootName: walkResult.rootName,
        files: walkResult.files,
        totalBytes: walkResult.totalBytes,
        signal: abortController.signal,
        onProgress: (progress) => {
          setCeremonyState((prev) =>
            prev
              ? {
                  ...prev,
                  uploadPercent: progress.percent,
                  uploadSentBytes: progress.sentBytes,
                }
              : null,
          );
        },
      });

      // 4. GROUNDWORK
      setCeremonyState((prev) =>
        prev
          ? {
              ...prev,
              stage: "groundwork",
              groundworkPhase: "laying districts…",
            }
          : null,
      );

      // Complete and hand off to city transition
      onSelectRepoKey(uploadResult.repoKey);
    } catch (err) {
      if (abortController.signal.aborted) {
        setCeremonyState(null);
        return;
      }
      setCeremonyState((prev) =>
        prev
          ? {
              ...prev,
              stage: "error",
              error: err instanceof Error ? err.message : "Upload failed",
            }
          : null,
      );
    }
  }

  function handleCancelUpload() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setCeremonyState(null);
  }

  // If in-flight ceremony is active, render the ceremony
  if (ceremonyState) {
    return (
      <div className={cn("flex flex-col items-center justify-center", className)}>
        <UploadCeremony state={ceremonyState} onCancel={handleCancelUpload} />
      </div>
    );
  }

  // Local mode UI
  if (serverMode === "local") {
    return (
      <div
        className={cn(
          "airport-board relative flex flex-col gap-4 border border-sky-100/20 bg-[#081923] p-5 text-white shadow-2xl sm:rounded-none",
          className,
        )}
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <span className="airport-terminal-code retro">CCX</span>
            <span className="retro text-[9px] tracking-[0.2em] text-sky-100/70">
              LOCAL REPOSITORY DIRECTORY
            </span>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="retro text-slate-400 hover:text-white"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <p className="retro text-[9px] text-sky-100/60 leading-relaxed">
          Open a project directory directly on this machine. Sudo City will build the city
          and Claude Agent will edit your real files.
        </p>

        {localError && (
          <div className="flex items-center gap-2 border border-red-500/30 bg-red-950/20 p-2.5 text-[9px] text-red-200">
            <AlertCircle className="size-3.5 shrink-0 text-red-400" />
            <span>{localError}</span>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <HudButton
            type="button"
            onClick={handleLocalPick}
            disabled={localLoading}
            className="w-full flex items-center justify-center gap-2"
          >
            <FolderSearch className="size-4" />
            {localLoading ? "OPENING DIALOG…" : "BROWSE FOLDER…"}
          </HudButton>

          <div className="flex items-center gap-2 text-slate-500 text-[8px] retro">
            <div className="h-px flex-1 bg-white/10" />
            <span>OR ENTER ABSOLUTE PATH</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleLocalOpen(localPath);
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              placeholder="/Users/username/projects/my-repo"
              className="retro flex-1 border border-white/15 bg-black/40 px-3 py-2 text-[9px] text-white outline-none focus:border-amber-300"
            />
            <HudButton type="submit" disabled={!localPath.trim() || localLoading} size="sm">
              OPEN
            </HudButton>
          </form>
        </div>
      </div>
    );
  }

  // Hosted mode drop surface
  return (
    <div
      className={cn(
        "airport-board relative flex flex-col gap-3 border border-sky-100/20 bg-[#081923] p-5 text-white shadow-2xl sm:rounded-none",
        isDragOver && "border-amber-300 bg-[#0c2433]",
        className,
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        void processDroppedItems(e.dataTransfer);
      }}
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <span className="airport-terminal-code retro">CCX</span>
          <span className="retro text-[9px] tracking-[0.2em] text-sky-100/70">
            LOCAL CARGO · DROP A FOLDER
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="retro text-slate-400 hover:text-white"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "group flex flex-col items-center justify-center gap-3 border-2 border-dashed border-white/20 bg-white/[0.02] p-8 text-center cursor-pointer transition-colors hover:border-amber-300/60 hover:bg-white/[0.04]",
          isDragOver && "border-amber-300 bg-amber-400/5",
        )}
      >
        <FolderUp className="size-8 text-amber-300 transition-transform group-hover:-translate-y-1" />
        <div className="space-y-1">
          <p className="retro text-[10px] text-amber-200">
            DRAG & DROP A CODE FOLDER HERE
          </p>
          <p className="retro text-[8px] text-sky-100/50">
            or click to browse your filesystem
          </p>
        </div>
        <p className="retro text-[7px] text-slate-400 max-w-xs mt-2 border-t border-white/10 pt-2">
          up to 150 MB after we strip dependencies (node_modules, build outputs, caches)
        </p>
      </div>

      {/* Hidden webkitdirectory file input */}
      <input
        ref={fileInputRef}
        type="file"
        // @ts-expect-error webkitdirectory attribute is standard in browsers
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void startHostedUpload((onProgress) =>
              walkFileList(e.target.files!, onProgress),
            );
          }
        }}
      />
    </div>
  );
}
