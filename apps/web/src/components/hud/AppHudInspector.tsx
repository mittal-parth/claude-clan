import { X } from "lucide-react";

import type { useGameState } from "@/hooks/use-game-state";
import { HudWindow } from "./HudWindow";
import { paletteFor, colorToCss } from "@/game/math/palette";
import { fileBasename, fileDirname } from "@/lib/app-utils";
import { Markdown } from "@/components/markdown";

export interface AppHudInspectorProps {
  state: ReturnType<typeof useGameState>;
}

export function AppHudInspector({ state }: AppHudInspectorProps) {
  const {
    selected,
    overlay,
    activeCityId,
    diff,
    hud,
    toggleHud,
    selectBuilding,
  } = state;

  if (!selected) {
    return (
      <p className="hud-caption retro">
        Drag to pan · Scroll to zoom · Click a building
      </p>
    );
  }

  const selectedChange = overlay?.files.find(
    (file) => file.path === selected.path,
  );
  const selectedPalette = paletteFor(selected.language ?? "unknown");

  return (
    <HudWindow
      id="hud-inspector"
      title={fileBasename(selected.path)}
      hint={selected.language}
      accent={colorToCss(selectedPalette.accent)}
      expanded={hud.inspector}
      onToggle={() => toggleHud("inspector")}
      className="w-[min(22rem,100%)]"
      icon={
        <span
          className="hud-mark retro size-[18px] text-[8px]"
          style={{
            backgroundColor: colorToCss(selectedPalette.accent),
            borderColor: colorToCss(selectedPalette.accentDark),
            color: colorToCss(selectedPalette.ink),
          }}
        >
          {selectedPalette.mark}
        </span>
      }
      actions={
        <button
          type="button"
          className="hud-icon-button"
          aria-label="Close structure details"
          title="Close"
          onClick={() => selectBuilding(undefined)}
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      }
    >
      <div className="grid gap-2 p-2.5">
        <code className="retro block truncate text-[9px] text-muted-foreground">
          {fileDirname(selected.path)}
        </code>
        <dl className="retro flex flex-wrap gap-1.5 text-[9px]">
          <div className="border border-border/60 bg-background/30 px-1.5 py-1">
            <dt className="inline text-[7px] text-muted-foreground">LINES </dt>
            <dd className="inline text-foreground">
              {selected.loc.toLocaleString()}
            </dd>
          </div>
          <div className="border border-border/60 bg-background/30 px-1.5 py-1">
            <dt className="inline text-[7px] text-muted-foreground">TYPE </dt>
            <dd
              className="inline"
              style={{ color: colorToCss(selectedPalette.accent) }}
            >
              {selected.language}
            </dd>
          </div>
          {selectedChange ? (
            <div className="border border-border/60 bg-background/30 px-1.5 py-1">
              <dt className="inline text-[7px] text-muted-foreground">
                IN THIS PR{" "}
              </dt>
              <dd className="inline text-foreground">
                {selectedChange.change}
              </dd>
            </div>
          ) : null}
        </dl>
        {selectedChange && selectedChange.change !== "deleted" ? (
          <div className="max-h-64 overflow-auto border-t border-border/50 pt-2">
            {diff &&
            diff.cityId === activeCityId &&
            diff.path === selected.path ? (
              <Markdown className="retro text-[9px]">
                {`\`\`\`diff\n${diff.patch}\n\`\`\``}
              </Markdown>
            ) : (
              <p className="retro text-[9px] text-muted-foreground">
                Loading diff…
              </p>
            )}
          </div>
        ) : null}
      </div>
    </HudWindow>
  );
}
