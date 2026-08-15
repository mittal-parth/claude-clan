import { cn } from "@/lib/utils";
import "@/components/ui/8bit/styles/retro.css";
import { AlertCircle, Check, Loader2, Plane, X } from "lucide-react";

export type CeremonyStage = "survey" | "manifest" | "airlift" | "groundwork" | "complete" | "error";

export interface UploadCeremonyState {
  stage: CeremonyStage;
  folderName: string;
  surveyFiles: number;
  surveyBytes: number;
  skippedFiles: number;
  skippedCategories: string[];
  uploadPercent: number;
  uploadSentBytes: number;
  uploadTotalBytes: number;
  groundworkPhase?: string;
  groundworkPercent?: number;
  error?: string;
}

export interface UploadCeremonyProps {
  state: UploadCeremonyState;
  onCancel?: () => void;
  className?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderProgressBar(percent: number, length = 20): string {
  const filledCount = Math.round((percent / 100) * length);
  const emptyCount = Math.max(0, length - filledCount);
  return "▓".repeat(filledCount) + "░".repeat(emptyCount);
}

export default function UploadCeremony({ state, onCancel, className }: UploadCeremonyProps) {
  const {
    stage,
    folderName,
    surveyFiles,
    surveyBytes,
    skippedFiles,
    skippedCategories,
    uploadPercent,
    uploadSentBytes,
    uploadTotalBytes,
    groundworkPhase,
    groundworkPercent,
    error,
  } = state;

  const stageOrder: CeremonyStage[] = ["survey", "manifest", "airlift", "groundwork"];
  const currentStageIndex = stageOrder.indexOf(stage);

  function getRowStatus(rowStage: CeremonyStage): "active" | "done" | "pending" {
    if (stage === "complete") return "done";
    if (stage === "error") {
      const idx = stageOrder.indexOf(rowStage);
      return idx <= currentStageIndex ? "active" : "pending";
    }
    const idx = stageOrder.indexOf(rowStage);
    if (idx < currentStageIndex) return "done";
    if (idx === currentStageIndex) return "active";
    return "pending";
  }

  return (
    <div
      className={cn(
        "airport-board relative w-full max-w-xl border border-sky-100/20 bg-[#081923] p-0 text-white shadow-2xl sm:rounded-none",
        className,
      )}
    >
      <div className="hud-scanline pointer-events-none absolute inset-0 z-10" />

      {/* Header */}
      <div className="airport-board-header relative flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="airport-terminal-code retro">CCX</span>
          <span className="retro text-[9px] tracking-[0.2em] text-sky-100/70">
            LOCAL CARGO TERMINAL · {folderName.toUpperCase()}
          </span>
        </div>
        {onCancel && stage !== "complete" && (
          <button
            type="button"
            onClick={onCancel}
            className="retro text-[8px] text-slate-400 hover:text-amber-300"
            title="Cancel upload"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Manifest Content */}
      <div className="flex flex-col gap-3 p-5 sm:p-6 font-mono text-[10px] leading-relaxed">
        {/* SURVEY Stage */}
        {(() => {
          const status = getRowStatus("survey");
          return (
            <div
              className={cn(
                "relative flex items-center justify-between gap-2 border p-2.5 transition-colors",
                status === "active"
                  ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
                  : status === "done"
                    ? "border-emerald-400/20 bg-emerald-950/20 text-slate-300"
                    : "border-white/5 bg-white/[0.02] text-slate-500",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-amber-300 font-bold">
                  {status === "done" ? "✓" : status === "active" ? "▸" : "·"}
                </span>
                <span className="tracking-wider uppercase font-semibold">SURVEY</span>
              </div>
              <div className="text-right">
                {status === "pending" ? (
                  <span className="text-slate-600">awaiting inspection…</span>
                ) : (
                  <span>
                    {surveyFiles.toLocaleString()} files · {formatBytes(surveyBytes)}
                  </span>
                )}
              </div>
              {status === "active" && (
                <div className="hud-scanline absolute inset-0 pointer-events-none opacity-40" />
              )}
            </div>
          );
        })()}

        {/* MANIFEST Stage */}
        {(() => {
          const status = getRowStatus("manifest");
          return (
            <div
              className={cn(
                "relative flex flex-col gap-1.5 border p-2.5 transition-colors",
                status === "active"
                  ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
                  : status === "done"
                    ? "border-emerald-400/20 bg-emerald-950/20 text-slate-300"
                    : "border-white/5 bg-white/[0.02] text-slate-500",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-amber-300 font-bold">
                    {status === "done" ? "✓" : status === "active" ? "▸" : "·"}
                  </span>
                  <span className="tracking-wider uppercase font-semibold">MANIFEST</span>
                </div>
                <div className="text-right">
                  {status === "pending" ? (
                    <span className="text-slate-600">filter standby…</span>
                  ) : (
                    <span>{skippedFiles.toLocaleString()} skipped</span>
                  )}
                </div>
              </div>

              {skippedCategories.length > 0 && status !== "pending" && (
                <div className="mt-1 flex flex-wrap gap-1.5 pt-1 border-t border-white/10 text-[8px]">
                  {skippedCategories.slice(0, 8).map((cat) => (
                    <span
                      key={cat}
                      className="border border-white/15 bg-black/40 px-1.5 py-0.5 text-sky-200/80"
                    >
                      {cat} <span className="text-red-400">✕</span>
                    </span>
                  ))}
                  {skippedCategories.length > 8 && (
                    <span className="text-slate-400">+{skippedCategories.length - 8} more</span>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* AIRLIFT Stage */}
        {(() => {
          const status = getRowStatus("airlift");
          return (
            <div
              className={cn(
                "relative flex flex-col gap-2 border p-2.5 transition-colors",
                status === "active"
                  ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
                  : status === "done"
                    ? "border-emerald-400/20 bg-emerald-950/20 text-slate-300"
                    : "border-white/5 bg-white/[0.02] text-slate-500",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-amber-300 font-bold">
                    {status === "done" ? "✓" : status === "active" ? "▸" : "·"}
                  </span>
                  <span className="tracking-wider uppercase font-semibold">AIRLIFT</span>
                </div>
                <div>
                  {status === "pending" ? (
                    <span className="text-slate-600">standby for takeoff…</span>
                  ) : (
                    <span className="text-amber-300 font-bold">{uploadPercent}%</span>
                  )}
                </div>
              </div>

              {status !== "pending" && (
                <div className="flex items-center justify-between text-[9px] text-slate-400">
                  <span className="tracking-widest font-mono text-amber-300/90">
                    {renderProgressBar(uploadPercent, 18)}
                  </span>
                  <span>
                    {formatBytes(uploadSentBytes)} / {formatBytes(uploadTotalBytes)}
                  </span>
                </div>
              )}
            </div>
          );
        })()}

        {/* GROUNDWORK Stage */}
        {(() => {
          const status = getRowStatus("groundwork");
          return (
            <div
              className={cn(
                "relative flex items-center justify-between gap-2 border p-2.5 transition-colors",
                status === "active"
                  ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
                  : status === "done"
                    ? "border-emerald-400/20 bg-emerald-950/20 text-slate-300"
                    : "border-white/5 bg-white/[0.02] text-slate-500",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-amber-300 font-bold">
                  {status === "done" ? "✓" : status === "active" ? "▸" : "·"}
                </span>
                <span className="tracking-wider uppercase font-semibold">GROUNDWORK</span>
              </div>
              <div className="text-right">
                {status === "pending" ? (
                  <span className="text-slate-600">awaiting clearance…</span>
                ) : status === "done" ? (
                  <span className="text-emerald-300">cleared for city construction</span>
                ) : (
                  <span className="text-amber-200">
                    {groundworkPhase || "laying districts…"}
                    {groundworkPercent !== undefined ? ` ${groundworkPercent}%` : ""}
                  </span>
                )}
              </div>
            </div>
          );
        })()}

        {/* Error notice if failed */}
        {error && (
          <div className="flex items-center gap-2 border border-red-500/40 bg-red-950/30 p-2.5 text-[9px] text-red-200">
            <AlertCircle className="size-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Runway Bar Lights */}
      <div className="airport-runway-bar" aria-hidden="true">
        <span className={cn(currentStageIndex >= 0 && "bg-amber-300")} />
        <span className={cn(currentStageIndex >= 1 && "bg-amber-300")} />
        <span className={cn(currentStageIndex >= 2 && "bg-amber-300")} />
        <span className={cn(uploadPercent >= 50 && "bg-amber-300")} />
        <span className={cn(uploadPercent >= 100 && "bg-amber-300")} />
        <span className={cn(currentStageIndex >= 3 && "bg-amber-300")} />
        <span className={cn(stage === "complete" && "bg-emerald-300")} />
      </div>
    </div>
  );
}
