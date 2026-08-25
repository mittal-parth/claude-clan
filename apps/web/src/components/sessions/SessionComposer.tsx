import { Paperclip, Send, Square } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import {
  RUNNING_SESSION_STATUSES,
  type CrewPolicy,
  type EffortLevel,
  type PermissionMode,
} from "@sudo-city/protocol";
import type { ConnectionState } from "@/lib/app-utils";
import type { CrewSelection } from "@/components/CrewSelectDialog";
import type { SessionView } from "@/sessions/types";
import { HudButton } from "@/components/hud/HudButton";
import { crewSpriteUrl, getCrewMember, effortLabel } from "@/crew/catalog";

export interface SessionComposerProps {
  view: SessionView;
  connection: ConnectionState;
  crewPolicy: CrewPolicy;
  crewSelection: CrewSelection;
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
  onCrewClick,
  onConfigure,
  onSend,
  onInterrupt,
  onOpenFiles,
}: SessionComposerProps) {
  const [prompt, setPrompt] = useState("");
  const [contextPaths, setContextPaths] = useState<string[]>([]);
  const [queuedDrafts, setQueuedDrafts] = useState<string[]>([]);
  const running = RUNNING_SESSION_STATUSES.includes(view.summary.status as (typeof RUNNING_SESSION_STATUSES)[number]);
  const disabled = connection !== "online" || view.summary.status === "closed";
  const crew = getCrewMember(crewSelection.crewId);

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
    <div className="grid gap-2 border-t-2 border-border/60 bg-background/80 p-2.5">
      {queuedDrafts.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {queuedDrafts.map((queued, index) => (
            <span key={`${queued}-${index}`} className="hud-pill max-w-full truncate">
              QUEUED · {queued.slice(0, 40)}{queued.length > 40 ? "…" : ""}
            </span>
          ))}
        </div>
      ) : null}
      {contextPaths.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {contextPaths.map((path) => (
            <button
              key={path}
              type="button"
              className="hud-pill max-w-full truncate hover:border-primary"
              onClick={() => setContextPaths((current) => current.filter((item) => item !== path))}
            >
              {path} ×
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        rows={2}
        value={prompt}
        disabled={disabled}
        className="retro min-h-16 max-h-40 w-full resize-y border border-border bg-background/70 px-2 py-1.5 text-[9px] leading-relaxed outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
        placeholder={view.summary.status === "closed" ? "Session closed" : "Continue the conversation…"}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <HudButton type="button" size="sm" variant="outline" disabled={disabled} onClick={onCrewClick}>
          <img src={crewSpriteUrl(crewSelection.crewId, crewSelection.effort)} alt="" className="size-4 object-contain [image-rendering:pixelated]" />
          {crew.name} · {effortLabel(crewSelection.effort)}
        </HudButton>
        <HudButton
          type="button"
          size="sm"
          variant={view.summary.permissionMode === "auto" ? "primary" : "outline"}
          disabled={disabled}
          onClick={() => onConfigure({ permissionMode: view.summary.permissionMode === "auto" ? "default" : "auto" })}
        >
          {view.summary.permissionMode === "auto" ? "Don’t disturb" : "Ask mayor"}
        </HudButton>
        <HudButton type="button" size="sm" variant="outline" disabled={disabled} onClick={onOpenFiles}>
          <Paperclip className="size-3" aria-hidden="true" /> Attach
        </HudButton>
        <span className="flex-1" />
        <HudButton
          type="button"
          size="sm"
          variant={running ? "danger" : "primary"}
          disabled={disabled || (!running && !prompt.trim())}
          title={running && view.summary.queuedCount > 0 ? `Stop the current work and discard ${view.summary.queuedCount} queued orders` : "Send order"}
          onClick={running ? () => { setQueuedDrafts([]); onInterrupt(); } : sendPrompt}
        >
          {running ? <Square className="size-3" aria-hidden="true" /> : <Send className="size-3" aria-hidden="true" />}
          {running ? "Halt" : "Send"}
        </HudButton>
      </div>
      {view.summary.effort !== crewSelection.effort ? (
        <p className="retro text-[8px] text-muted-foreground">
          Thinking level applies from the next order.
        </p>
      ) : null}
    </div>
  );
}
