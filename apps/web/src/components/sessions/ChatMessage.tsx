import type { ChatItem } from "@/sessions/types";
import { Markdown } from "@/components/markdown";
import { colorWithAlpha, fileBasename } from "@/lib/app-utils";
import { paletteFor } from "@/game/math/palette";
import { cn } from "@/lib/utils";

export interface ChatMessageProps {
  item: Extract<ChatItem, { kind: "mayor" | "crew" }>;
}

function pathPalette(path: string) {
  const extension = path.split(".").at(-1) ?? "unknown";
  return paletteFor(extension);
}

export function ChatMessage({ item }: ChatMessageProps) {
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
    </div>
  );
}
