import type { ChatItem } from "@/sessions/types";
import { Markdown } from "@/components/markdown";
import { colorWithAlpha } from "@/lib/app-utils";
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
      <div className="flex justify-end">
        <div
          className="max-w-[85%] border px-2.5 py-2"
          style={{
            backgroundColor: colorWithAlpha(paletteFor("unknown").accent, 0.1),
            borderColor: colorWithAlpha(paletteFor("unknown").accent, 0.55),
          }}
        >
          <Markdown className="retro text-[9px] leading-relaxed [&_p]:mb-1 [&_p:last-child]:mb-0 [&_code]:text-[9px]">
            {item.text}
          </Markdown>
          {item.contextPaths.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.contextPaths.map((path) => {
                const palette = pathPalette(path);
                return (
                  <span
                    key={path}
                    className="retro inline-flex max-w-full items-center gap-1 border px-1 py-0.5 text-[7px] text-foreground"
                    style={{
                      backgroundColor: colorWithAlpha(palette.accent, 0.12),
                      borderColor: colorWithAlpha(palette.accent, 0.55),
                    }}
                  >
                    <span
                      className="hud-mark size-3 text-[6px]"
                      style={{
                        backgroundColor: `#${palette.accent.toString(16).padStart(6, "0")}`,
                      }}
                    >
                      {palette.mark}
                    </span>
                    <span className="truncate">{path}</span>
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("max-w-[92%]", item.streaming && "session-message--streaming")}>
      <span className="retro mb-1 block text-[7px] uppercase text-muted-foreground">
        Crew
      </span>
      <div className="flex items-end gap-1">
        <Markdown className="text-[10px] leading-relaxed [&_p]:mb-2 [&_p:last-child]:mb-0 [&_code]:text-[9px]">
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
