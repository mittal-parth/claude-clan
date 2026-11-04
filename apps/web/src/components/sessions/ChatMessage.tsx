import { Terminal } from "lucide-react";
import type { ChatItem } from "@/sessions/types";
import { Markdown } from "@/components/markdown";
import { colorWithAlpha, fileBasename } from "@/lib/app-utils";
import { isDesktop } from "@/lib/desktop";
import { paletteFor } from "@/game/math/palette";
import { cn } from "@/lib/utils";

export interface ChatMessageProps {
  item: Extract<ChatItem, { kind: "mayor" | "crew" }>;
  onOpenTerminal?: (command?: string) => void;
}

function pathPalette(path: string) {
  const extension = path.split(".").at(-1) ?? "unknown";
  return paletteFor(extension);
}

export function ChatMessage({ item, onOpenTerminal }: ChatMessageProps) {
  if (item.kind === "mayor") {
    return (
      <div className="flex justify-end min-w-0 max-w-full">
        <div
          className="max-w-[88%] min-w-0 border px-2 py-1.5 break-words relative z-10 overflow-visible"
          style={{
            backgroundColor: colorWithAlpha(paletteFor("unknown").accent, 0.1),
            borderColor: colorWithAlpha(paletteFor("unknown").accent, 0.55),
          }}
        >
          <Markdown className="retro break-words text-[9px] leading-relaxed [&_code]:text-[8px] [&_p]:mb-1 [&_p:last-child]:mb-0 [&_pre]:p-1.5 [&_pre_code]:text-[8px]">
            {item.text}
          </Markdown>
          {item.contextPaths.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {item.contextPaths.map((path) => {
                const palette = pathPalette(path);
                return (
                  <div key={path} className="group relative z-30 inline-flex max-w-full">
                    <span
                      className="retro inline-flex max-w-full items-center gap-1 border px-1 py-0.5 text-[7px] text-foreground"
                      style={{
                        backgroundColor: colorWithAlpha(palette.accent, 0.12),
                        borderColor: colorWithAlpha(palette.accent, 0.55),
                      }}
                    >
                      <span
                        className="hud-mark size-2.5 text-[6px]"
                        style={{
                          backgroundColor: `#${palette.accent.toString(16).padStart(6, "0")}`,
                        }}
                      >
                        {palette.mark}
                      </span>
                      <span className="truncate">{fileBasename(path)}</span>
                    </span>
                    <div
                      role="tooltip"
                      className="pointer-events-none absolute bottom-full left-0 z-[100] mb-1.5 hidden h-4 items-center justify-center whitespace-nowrap border border-white/20 bg-[#081923]/95 px-1.5 shadow-xl backdrop-blur-sm group-hover:inline-flex"
                    >
                      <span className="retro text-[8px] leading-none text-amber-200">{path}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const isAuthNotice =
    item.text.includes("Not logged in") ||
    item.text.includes("/login isn't available") ||
    item.text.includes("Please run /login");

  return (
    <div className={cn("max-w-full min-w-0 overflow-hidden", item.streaming && "session-message--streaming")}>
      <span className="retro mb-0.5 block text-[7px] uppercase text-muted-foreground">
        Crew
      </span>
      <div className="flex min-w-0 max-w-full items-end gap-1 overflow-hidden">
        <Markdown className="min-w-0 max-w-full flex-1 break-words overflow-x-hidden text-[9px] leading-relaxed [&_code]:text-[8px] [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:p-1.5 [&_pre_code]:text-[8px]">
          {item.text}
        </Markdown>
        {item.streaming ? (
          <span aria-label="Streaming" className="retro shrink-0 text-primary">
            ▌
          </span>
        ) : null}
      </div>
      {isAuthNotice && isDesktop() ? (
        <div className="mt-2 flex items-center justify-between gap-2 border border-amber-400/40 bg-amber-500/10 p-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Terminal className="size-3.5 text-amber-300 shrink-0" aria-hidden="true" />
            <span className="retro text-[8px] text-amber-200 truncate">
              Authenticate Claude Code via terminal
            </span>
          </div>
          {onOpenTerminal ? (
            <button
              type="button"
              onClick={() => onOpenTerminal("claude login")}
              className="retro border border-amber-300/80 bg-amber-400/20 px-2 py-1 text-[8px] font-semibold text-amber-200 hover:bg-amber-400/30 transition-colors shrink-0"
            >
              Run claude login
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
