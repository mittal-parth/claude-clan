import { cn } from "@/lib/utils";

import type { useGameState } from "@/hooks/use-game-state";
import { HudWindow } from "./HudWindow";
import { paletteFor, colorToCss } from "@/game/math/palette";
import { summarizeLanguages, colorWithAlpha } from "@/lib/app-utils";

export interface AppHudScanProps {
  state: ReturnType<typeof useGameState>;
}

export function AppHudScan({ state }: AppHudScanProps) {
  const { world, connection, hud, toggleHud } = state;
  const surveying = !world && connection !== "offline";
  const languageSummary = world ? summarizeLanguages(world.buildings) : [];

  return (
    <HudWindow
      id="hud-scan"
      title="City scan"
      hint={surveying ? "surveying" : world ? "live" : "offline"}
      expanded={hud.scan}
      onToggle={() => toggleHud("scan")}
      className="w-[min(20rem,100%)]"
      meta={
        <span className={cn("hud-pill", !world && "hud-pill--muted")}>
          <span
            aria-hidden="true"
            className={cn("hud-dot", world && "hud-dot--live")}
          />
          {world ? "synced" : surveying ? "linking" : "no link"}
        </span>
      }
    >
      <div className="grid gap-2 p-2.5">
        <div className="flex items-baseline gap-2">
          <span className="hud-figure retro">
            {world ? world.buildings.length : "—"}
          </span>
          <span className="hud-label flex-1">structures mapped</span>
          <span className="hud-label">{languageSummary.length} types</span>
        </div>

        {surveying ? (
          <div className="hud-scanline" aria-label="Surveying district" />
        ) : null}

        {languageSummary.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {languageSummary.slice(0, 8).map(({ language, count }) => {
              const palette = paletteFor(language);
              return (
                <span
                  key={language}
                  title={`${count} ${language} structures`}
                  className="retro inline-flex items-center gap-1 border px-1 py-0.5 text-[8px]"
                  style={{
                    backgroundColor: colorWithAlpha(palette.accent, 0.14),
                    borderColor: colorWithAlpha(palette.accent, 0.6),
                    color: colorToCss(palette.accent),
                  }}
                >
                  <span>{palette.mark}</span>
                  <span className="text-foreground/75">{count}</span>
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
    </HudWindow>
  );
}
