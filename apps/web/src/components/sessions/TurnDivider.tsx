import type { ChatItem } from "@/sessions/types";
import { cn } from "@/lib/utils";
import { formatDuration, formatTokens, formatUsd } from "./format";

export interface TurnDividerProps {
  item: Extract<ChatItem, { kind: "turn" }>;
}

export function TurnDivider({ item }: TurnDividerProps) {
  const special = item.outcome === "max-turns"
    ? "PAUSED · turn limit reached — send another order to continue"
    : item.outcome === "budget-exhausted"
      ? "TREASURY EMPTY"
      : undefined;

  return (
    <div
      className={cn(
        "flex items-center gap-2 py-1.5 text-muted-foreground",
        special && "text-primary",
      )}
    >
      <span aria-hidden="true" className="h-px flex-1 bg-border/60" />
      <span className="retro text-center text-[7px]">
        {special ?? `${formatUsd(item.costUsd)} · ${formatDuration(item.durationMs)} · ${formatTokens(item.inputTokens)} in · ${formatTokens(item.outputTokens)} out`}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-border/60" />
    </div>
  );
}
