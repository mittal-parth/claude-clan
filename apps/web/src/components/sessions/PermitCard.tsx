import { HardHat } from "lucide-react";
import type { ChatItem } from "@/sessions/types";
import { HudButton } from "@/components/hud/HudButton";
import { cn } from "@/lib/utils";

export interface PermitCardProps {
  item: Extract<ChatItem, { kind: "permit" }>;
  onResolve: (decision: "allow" | "allow-always" | "deny") => void;
}

function inputText(input: Record<string, unknown>): string {
  if (typeof input.command === "string") return input.command;
  if (typeof input.file_path === "string") return input.file_path;
  return JSON.stringify(input, null, 2);
}

export function PermitCard({ item, onResolve }: PermitCardProps) {
  const resolved = item.decision !== undefined;
  const decisionLabel = item.decision === "allow"
    ? "STAMPED"
    : item.decision === "allow-always"
      ? "ALWAYS ALLOWED"
      : item.decision === "deny"
        ? "DENIED"
        : "EXPIRED · the turn ended before this was answered";

  return (
    <div
      role="group"
      aria-label={`Permit request for ${item.tool}`}
      className={cn("hud-permit grid gap-2 min-w-0 max-w-full overflow-hidden", resolved && "opacity-75")}
    >
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <HardHat className="size-3.5 text-amber-400 shrink-0" aria-hidden="true" />
          <span className="hud-label text-amber-300 truncate">BUILDING PERMIT · {item.tool}</span>
        </div>
        {resolved ? <span className="hud-label shrink-0">{decisionLabel}</span> : null}
      </div>
      <p className="retro text-[9px] leading-relaxed text-foreground break-words">
        {item.message}
      </p>
      <pre className="max-h-32 overflow-x-auto max-w-full border border-border/40 bg-background/50 p-1.5 text-[8px] leading-relaxed text-foreground whitespace-pre-wrap break-all">
        {inputText(item.input)}
      </pre>
      {!resolved ? (
        <div className="grid grid-cols-3 gap-1 min-w-0 w-full">
          <HudButton
            type="button"
            size="sm"
            className="retro px-1 py-1 text-[8px] truncate min-w-0 w-full"
            onClick={() => onResolve("allow")}
          >
            Stamp
          </HudButton>
          <HudButton
            type="button"
            size="sm"
            variant="outline"
            className="retro truncate px-1 py-1 text-[8px] min-w-0 w-full"
            title={`Always allow ${item.tool}`}
            onClick={() => onResolve("allow-always")}
          >
            Always
          </HudButton>
          <HudButton
            type="button"
            size="sm"
            variant="danger"
            className="retro px-1 py-1 text-[8px] truncate min-w-0 w-full"
            onClick={() => onResolve("deny")}
          >
            Deny
          </HudButton>
        </div>
      ) : null}
    </div>
  );
}
