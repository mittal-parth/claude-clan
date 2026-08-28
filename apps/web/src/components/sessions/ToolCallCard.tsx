import { Check, Circle, Loader2, X } from "lucide-react";
import type { ChatItem } from "@/sessions/types";
import { cn } from "@/lib/utils";
import { formatDuration } from "./format";
import { toolIconFor } from "./tool-icon";

export interface ToolCallCardProps {
  item: Extract<ChatItem, { kind: "tool" }>;
}

function inputText(item: Extract<ChatItem, { kind: "tool" }>): string | undefined {
  if (!item.input) return undefined;
  if (item.tool.toLowerCase() === "bash" && typeof item.input.command === "string") {
    return item.input.command;
  }
  return JSON.stringify(item.input, null, 2);
}

export function ToolCallCard({ item }: ToolCallCardProps) {
  const Icon = toolIconFor(item.tool);
  const statusIcon = item.status === "running"
    ? <Loader2 className="size-3 animate-spin text-amber-400" aria-hidden="true" />
    : item.status === "success"
      ? <Check className="size-3 text-[var(--color-signal)]" aria-hidden="true" />
      : item.status === "interrupted"
        ? <Circle className="size-3 text-muted-foreground" aria-hidden="true" />
        : <X className="size-3 text-destructive" aria-hidden="true" />;
  const input = inputText(item);
  const result = item.status === "interrupted"
    ? "Stopped by the mayor."
    : item.resultPreview;

  return (
    <details
      className={cn(
        "border-l-2 border-border/70 bg-muted/10 px-2 py-1.5 transition-colors min-w-0 max-w-full overflow-hidden",
        item.status === "running"
          ? "border-l-amber-400 bg-amber-500/[0.08]"
          : item.status === "error" || item.status === "denied"
            ? "border-l-destructive bg-destructive/5"
            : item.status === "interrupted"
              ? "border-l-muted-foreground"
              : "border-l-amber-500/50 hover:border-l-amber-400",
      )}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 min-w-0 w-full">
        <Icon className="size-3 shrink-0 text-amber-400" aria-hidden="true" />
        <span className="retro min-w-0 flex-1 truncate text-[8px] text-foreground">
          {item.tool}
          {item.target ? ` · ${item.target}` : ""}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground">
          {item.durationMs !== undefined ? (
            <span className="retro text-[7px]">{formatDuration(item.durationMs)}</span>
          ) : null}
          {statusIcon}
        </span>
      </summary>
      {input || result ? (
        <div className="mt-2 grid gap-1.5 min-w-0 max-w-full">
          {input ? (
            <pre className="max-h-40 overflow-x-auto max-w-full border border-border/40 bg-background/60 p-1.5 text-[8px] leading-relaxed text-foreground whitespace-pre-wrap break-all">
              {input}
            </pre>
          ) : null}
          {result ? (
            <pre className="max-h-48 overflow-x-auto max-w-full border border-border/40 bg-background/60 p-1.5 text-[8px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
              {result}
            </pre>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
