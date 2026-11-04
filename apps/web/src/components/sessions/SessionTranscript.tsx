import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SessionView } from "@/sessions/types";
import { toChatItems } from "@/sessions/transcript";
import { ChatMessage } from "./ChatMessage";
import { nextPinned } from "./pinning";
import { PermitCard } from "./PermitCard";
import { ThinkingStrip } from "./ThinkingStrip";
import { ToolCallCard } from "./ToolCallCard";
import { TurnDivider } from "./TurnDivider";

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
  const contentRef = useRef<HTMLDivElement>(null);
  // The ref is the source of truth for following; state exists only to show
  // the "Jump to latest" button. Reading state inside a scroll handler or
  // observer would see the value from the last render, one delta behind.
  const pinnedRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const [pinned, setPinned] = useState(true);
  const items = useMemo(() => toChatItems(view), [view]);

  function viewport(): HTMLElement | undefined {
    return rootRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    ) ?? undefined;
  }

  function setPin(value: boolean): void {
    pinnedRef.current = value;
    setPinned(value);
  }

  function scrollToBottom(): void {
    const element = viewport();
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    // Record what we wrote, so the scroll event it causes is not mistaken for
    // the user moving.
    lastScrollTopRef.current = element.scrollTop;
  }

  function jumpToLatest(): void {
    scrollToBottom();
    setPin(true);
  }

  useEffect(() => {
    const element = viewport();
    if (!element) return;
    function onScroll(): void {
      if (!element) return;
      const next = nextPinned(pinnedRef.current, element, lastScrollTopRef.current);
      lastScrollTopRef.current = element.scrollTop;
      if (next !== pinnedRef.current) setPin(next);
    }
    lastScrollTopRef.current = element.scrollTop;
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, []);

  // Layout effect, not a passive one: a passive effect runs after paint, so
  // each delta painted the grown text clipped below the fold for a frame and
  // then jumped to it -- the stutter while streaming.
  useLayoutEffect(() => {
    if (pinnedRef.current) scrollToBottom();
  }, [items]);

  // Height also changes without `items` changing: markdown re-parses on every
  // delta, so an opened code fence or a "1." turning into a list reflows
  // text that is already on screen. Follow the content's size, not the data.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) scrollToBottom();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      // Chromium/Electron scroll anchoring moves scrollTop by itself when text
      // above the anchor reflows, fighting the manual pin to the bottom.
      className="relative min-h-0 min-w-0 overflow-hidden [&_[data-radix-scroll-area-viewport]]:[overflow-anchor:none]"
    >
      <ScrollArea className="h-full w-full max-w-full">
        <div
          ref={contentRef}
          className="grid gap-3 px-3 py-3 min-w-0 max-w-full overflow-x-hidden"
          aria-live="polite"
        >
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
