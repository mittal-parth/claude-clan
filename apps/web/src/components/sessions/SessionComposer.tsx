import { Paperclip, Send, Square } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import {
  RUNNING_SESSION_STATUSES,
  type Building,
  type CrewPolicy,
  type EffortLevel,
  type PermissionMode,
} from "@sudo-city/protocol";
import { colorWithAlpha, fileBasename, type ConnectionState } from "@/lib/app-utils";
import type { CrewSelection } from "@/components/CrewSelectDialog";
import type { SessionView } from "@/sessions/types";
import { HudButton } from "@/components/hud/HudButton";
import { crewSpriteUrl, getCrewMember, effortLabel } from "@/crew/catalog";
import { paletteFor, colorToCss } from "@/game/math/palette";
import { cn } from "@/lib/utils";

export interface SessionComposerProps {
  view: SessionView;
  connection: ConnectionState;
  crewPolicy: CrewPolicy;
  crewSelection: CrewSelection;
  contextPaths?: string[];
  onContextPathsChange?: (paths: string[] | ((current: string[]) => string[])) => void;
  draggingBuilding?: Building;
  isDropTarget?: boolean;
  onCrewClick: () => void;
  onConfigure: (changes: { model?: string; effort?: EffortLevel; permissionMode?: PermissionMode }) => void;
  onSend: (prompt: string, contextPaths: string[]) => void;
  onInterrupt: () => void;
  onOpenFiles: () => void;
}

export function SessionComposer({
  view,
  connection,
  crewSelection,
  contextPaths: propsContextPaths,
  onContextPathsChange,
  draggingBuilding,
  isDropTarget,
  onCrewClick,
  onConfigure,
  onSend,
  onInterrupt,
  onOpenFiles,
}: SessionComposerProps) {
  const [prompt, setPrompt] = useState("");
  const [localContextPaths, setLocalContextPaths] = useState<string[]>([]);
  const contextPaths = propsContextPaths ?? localContextPaths;
  const setContextPaths = onContextPathsChange ?? setLocalContextPaths;
  const [queuedDrafts, setQueuedDrafts] = useState<string[]>([]);
  const running = RUNNING_SESSION_STATUSES.includes(view.summary.status as (typeof RUNNING_SESSION_STATUSES)[number]);
  const disabled = connection !== "online" || view.summary.status === "closed";
  const crew = getCrewMember(crewSelection.crewId);
  const draggingPalette = draggingBuilding ? paletteFor(draggingBuilding.language ?? "unknown") : undefined;

  useEffect(() => {
    if (view.summary.queuedCount === 0) {
      setQueuedDrafts([]);
    } else {
      setQueuedDrafts((current) => current.slice(0, view.summary.queuedCount));
    }
  }, [view.summary.queuedCount]);

  function sendPrompt(): void {
    const value = prompt.trim();
    if (!value || disabled) return;
    onSend(value, contextPaths);
    if (running) setQueuedDrafts((current) => [...current, value]);
    setPrompt("");
    setContextPaths([]);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendPrompt();
    }
    if (event.key === "Escape") {
      event.currentTarget.blur();
    }
  }

  return (
    <div
      className={cn(
        "relative z-20 grid gap-1.5 border-t-2 border-border/50 bg-background/40 p-2 transition-colors min-w-0 max-w-full overflow-visible",
        draggingBuilding && "is-drop-target",
        isDropTarget && "border-primary bg-primary/5",
      )}
    >
      {draggingBuilding && draggingPalette ? (
        <div
          className={cn(
            "flex items-center gap-2 border px-2 py-1.5 transition-colors",
            isDropTarget
              ? "border-primary bg-primary/20 shadow-sm"
              : "border-border/60 bg-muted/20",
          )}
          style={
            isDropTarget
              ? undefined
              : {
                  backgroundColor: colorWithAlpha(draggingPalette.accent, 0.14),
                  borderColor: colorWithAlpha(draggingPalette.accent, 0.7),
                }
          }
        >
          <span
            className="hud-mark retro size-4 text-[7px]"
            style={{
              backgroundColor: colorToCss(draggingPalette.accent),
              borderColor: colorToCss(draggingPalette.accentDark),
              color: colorToCss(draggingPalette.ink),
            }}
          >
            {draggingPalette.mark}
          </span>
          <span className="retro text-[8px] text-muted-foreground">
            {isDropTarget ? "Release to attach:" : "Drop building to attach:"}
          </span>
          <code className="retro min-w-0 flex-1 truncate text-[8px] text-foreground">
            {draggingBuilding.path}
          </code>
        </div>
      ) : null}
      {queuedDrafts.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {queuedDrafts.map((queued, index) => (
            <span key={`${queued}-${index}`} className="hud-pill max-w-full truncate px-1 py-0 text-[7px]">
              QUEUED · {queued.slice(0, 30)}{queued.length > 30 ? "…" : ""}
            </span>
          ))}
        </div>
      ) : null}
      {contextPaths.length > 0 ? (
        <div className="relative z-30 flex flex-wrap gap-1">
          {contextPaths.map((path) => (
            <div key={path} className="group relative z-30 inline-flex max-w-full">
              <button
                type="button"
                aria-label={`Remove ${fileBasename(path)} (${path})`}
                className="hud-pill max-w-full truncate px-1 py-0 text-[7px] hover:border-primary"
                onClick={() => setContextPaths((current) => current.filter((item) => item !== path))}
              >
                {fileBasename(path)} ×
              </button>
              <div
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-0 z-[100] mb-1.5 hidden h-4 items-center justify-center whitespace-nowrap border border-white/20 bg-[#081923]/95 px-1.5 shadow-xl backdrop-blur-sm group-hover:inline-flex"
              >
                <span className="retro text-[8px] leading-none text-amber-200">{path}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <textarea
        rows={2}
        value={prompt}
        disabled={disabled}
        className="retro min-h-12 max-h-32 w-full resize-y border border-border bg-background/70 px-2 py-1 text-[9px] leading-relaxed outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
        placeholder={view.summary.status === "closed" ? "Order closed" : "Ask or command crew…"}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="flex flex-wrap items-center gap-1 min-w-0 max-w-full">
        <HudButton
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={onCrewClick}
          className="retro px-1.5 py-1 text-[8px]"
        >
          <img src={crewSpriteUrl(crewSelection.crewId, crewSelection.effort)} alt="" className="size-3.5 object-contain [image-rendering:pixelated]" />
          {crew.name} · {effortLabel(crewSelection.effort)}
        </HudButton>
        <HudButton
          type="button"
          size="sm"
          variant={view.summary.permissionMode === "auto" ? "primary" : "outline"}
          disabled={disabled}
          onClick={() => onConfigure({ permissionMode: view.summary.permissionMode === "auto" ? "default" : "auto" })}
          className="retro px-1.5 py-1 text-[8px]"
        >
          {view.summary.permissionMode === "auto" ? "Don’t disturb" : "Ask mayor"}
        </HudButton>
        <HudButton
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={onOpenFiles}
          aria-label="Attach files"
          title="Attach files"
          className="retro px-1.5 py-1 text-[8px]"
        >
          <Paperclip className="size-3" aria-hidden="true" />
        </HudButton>
        <span className="flex-1" />
        <HudButton
          type="button"
          size="sm"
          variant={running ? "danger" : "primary"}
          disabled={disabled || (!running && !prompt.trim())}
          title={running && view.summary.queuedCount > 0 ? `Stop the current work and discard ${view.summary.queuedCount} queued orders` : "Send order"}
          onClick={running ? () => { setQueuedDrafts([]); onInterrupt(); } : sendPrompt}
          className="retro px-2 py-1 text-[8px]"
        >
          {running ? <Square className="size-3" aria-hidden="true" /> : <Send className="size-3" aria-hidden="true" />}
          {running ? "Halt" : "Send"}
        </HudButton>
      </div>
      {view.summary.effort !== crewSelection.effort ? (
        <p className="retro text-[7px] text-muted-foreground">
          Thinking level applies from the next order.
        </p>
      ) : null}
    </div>
  );
}
