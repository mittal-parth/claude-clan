import type { ChatItem } from "@/sessions/types";
import { formatDuration } from "./format";

export interface ThinkingStripProps {
  item: Extract<ChatItem, { kind: "thinking" }>;
  durationMs?: number;
}

export function ThinkingStrip({ item, durationMs }: ThinkingStripProps) {
  const duration = durationMs === undefined ? "" : ` for ${formatDuration(durationMs)}`;
  return (
    <details
      className="group border border-border/40 bg-muted/10 px-2 py-1.5"
      open={item.streaming ? true : undefined}
    >
      <summary className="retro cursor-pointer list-none text-[8px] text-muted-foreground">
        <span className="inline group-open:hidden">▸</span>
        <span className="hidden group-open:inline">▾</span>
        {" "}Thought{duration}
        {item.streaming ? " · live" : ""}
      </summary>
      <p className="mt-1 whitespace-pre-wrap text-[9px] italic leading-relaxed text-muted-foreground">
        {item.text}
        {item.streaming ? <span className="text-primary">▌</span> : null}
      </p>
    </details>
  );
}
