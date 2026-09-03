import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SessionView } from "@/sessions/types";
import { toChatItems } from "@/sessions/transcript";
import { ChatMessage } from "./ChatMessage";
import { PermitCard } from "./PermitCard";
import { ThinkingStrip } from "./ThinkingStrip";
import { ToolCallCard } from "./ToolCallCard";
import { TurnDivider } from "./TurnDivider";

const PIN_THRESHOLD_PX = 48;

export interface SessionTranscriptProps {
  view: SessionView;
  onPermit: (toolCallId: string, decision: "allow" | "allow-always" | "deny") => void;
  onOpenTerminal?: (command?: string) => void;
}

export function SessionTranscript({
  view,
  onPermit,
  onOpenTerminal,
}: SessionTranscriptProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const items = useMemo(() => toChatItems(view), [view]);

  function viewport(): HTMLElement | undefined {
    return rootRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    ) ?? undefined;
  }

  function updatePinned(): void {
    const element = viewport();
    if (!element) return;
    setPinned(
      element.scrollHeight - element.scrollTop - element.clientHeight <
        PIN_THRESHOLD_PX,
    );
  }

  function jumpToLatest(): void {
    const element = viewport();
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    setPinned(true);
  }

  useEffect(() => {
    const element = viewport();
    if (!element) return;
    element.addEventListener("scroll", updatePinned, { passive: true });
    updatePinned();
    return () => element.removeEventListener("scroll", updatePinned);
  }, []);

  useEffect(() => {
    if (!pinned) return;
    const element = viewport();
    if (element) element.scrollTop = element.scrollHeight;
  }, [items, pinned]);

  return (
    <div ref={rootRef} className="relative min-h-0 min-w-0 overflow-hidden">
      <ScrollArea className="h-full w-full max-w-full">
        <div className="grid gap-3 px-3 py-3 min-w-0 max-w-full overflow-x-hidden" aria-live="polite">
          {items.length === 0 ? (
            <p className="retro py-8 text-center text-[8px] text-muted-foreground">
              No transmissions yet.
            </p>
          ) : null}
          {items.map((item) => {
            switch (item.kind) {
              case "mayor":
              case "crew":
                return (
                  <ChatMessage
                    key={item.id}
                    item={item}
                    onOpenTerminal={onOpenTerminal}
                  />
                );
              case "thinking":
                return <ThinkingStrip key={item.id} item={item} />;
              case "tool":
                return <ToolCallCard key={item.id} item={item} />;
              case "permit":
                return (
                  <PermitCard
                    key={item.id}
                    item={item}
                    onResolve={(decision) => onPermit(item.toolCallId, decision)}
                  />
                );
              case "turn":
                return <TurnDivider key={item.id} item={item} />;
              case "compaction":
                return (
                  <div key={item.id} className="retro border-y border-border/50 py-1.5 text-center text-[8px] text-muted-foreground">
                    Context compacted
                    {item.preTokens !== undefined && item.postTokens !== undefined
                      ? ` · ${item.preTokens} → ${item.postTokens} tokens`
                      : ""}
                  </div>
                );
              case "notice":
                return (
                  <p key={item.id} className={`retro border-l-2 px-2 py-1 text-[8px] ${item.tone === "error" ? "border-destructive text-destructive" : "border-border text-muted-foreground"}`}>
                    {item.text}
                  </p>
                );
              case "file":
                return (
                  <p key={item.id} className="retro text-[8px] text-muted-foreground">
                    {item.change} · {item.path}
                  </p>
                );
              case "subagent":
                return (
                  <p key={item.id} className="retro text-[8px] text-muted-foreground">
                    {item.running ? "Subagent started" : "Subagent stopped"} · {item.agentType}
                  </p>
                );
              case "task":
                return (
                  <p key={item.id} className="retro text-[8px] text-muted-foreground">
                    {item.done ? "✓" : "…"} {item.subject}
                  </p>
                );
            }
          })}
        </div>
      </ScrollArea>
      {!pinned ? (
        <button
          type="button"
          className="retro absolute bottom-3 left-1/2 -translate-x-1/2 border border-primary bg-background px-2 py-1 text-[8px] text-primary shadow-lg"
          onClick={jumpToLatest}
        >
          Jump to latest ▾
        </button>
      ) : null}
    </div>
  );
}
