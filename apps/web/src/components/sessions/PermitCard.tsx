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
      className={cn("hud-permit grid gap-2", resolved && "opacity-75")}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="hud-label text-primary">Permit · {item.tool}</span>
        {resolved ? <span className="hud-label">{decisionLabel}</span> : null}
      </div>
      <p className="retro text-[9px] leading-relaxed text-foreground">
        {item.message}
      </p>
      <pre className="max-h-32 overflow-auto border border-border/40 bg-background/50 p-1.5 text-[8px] leading-relaxed text-foreground">
        {inputText(item.input)}
      </pre>
      {!resolved ? (
        <div className="grid grid-cols-3 gap-1.5">
          <HudButton type="button" size="sm" onClick={() => onResolve("allow")}>
            Stamp
          </HudButton>
          <HudButton
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onResolve("allow-always")}
          >
            Always allow {item.tool}
          </HudButton>
          <HudButton
            type="button"
            size="sm"
            variant="danger"
            onClick={() => onResolve("deny")}
          >
            Deny
          </HudButton>
        </div>
      ) : null}
    </div>
  );
}
