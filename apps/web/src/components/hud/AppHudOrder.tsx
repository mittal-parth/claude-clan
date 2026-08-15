import { cn } from "@/lib/utils";

import type { useGameState } from "@/hooks/use-game-state";
import { HudWindow } from "./HudWindow";
import { HudButton } from "./HudButton";
import { paletteFor, colorToCss } from "@/game/math/palette";
import { colorWithAlpha } from "@/lib/app-utils";
import { getCrewMember, effortLabel, crewSpriteUrl } from "@/crew/catalog";

export interface AppHudOrderProps {
  state: ReturnType<typeof useGameState>;
}

export function AppHudOrder({ state }: AppHudOrderProps) {
  const {
    orderFormRef,
    submitPrompt,
    draggingBuilding,
    hud,
    toggleHud,
    contextPaths,
    prompt,
    setPrompt,
    connection,
    send,
    activeCityId,
    removeContextPath,
    world,
    crewSelection,
    setCrewDialogOpen,
    orderPermissionMode,
    setOrderPermissionMode,
  } = state;

  const draggingPalette = paletteFor(draggingBuilding?.language ?? "unknown");

  return (
    <form
      ref={orderFormRef}
      onSubmit={submitPrompt}
      className={cn(
        "hud-form w-[min(34rem,100%)]",
        draggingBuilding && "is-drop-target",
      )}
    >
      <HudWindow
        id="hud-order"
        title="Mayor's order"
        hint={draggingBuilding ? "drop to attach" : undefined}
        expanded={hud.order}
        onToggle={() => toggleHud("order")}
        bodyClassName="grid gap-2 p-2.5"
        meta={
          contextPaths.length > 0 ? (
            <span className="hud-pill">{contextPaths.length} in context</span>
          ) : null
        }
        persistent={
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="hud-field min-w-0 flex-1">
              <span aria-hidden="true" className="hud-field__caret">
                ❯
              </span>
              <input
                id="mayor-prompt"
                className="hud-field__input retro"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="What should the crew build?"
                aria-label="Mayor's order"
                autoComplete="off"
                disabled={connection !== "online"}
              />
            </div>
            <div className="flex shrink-0 gap-2">
              <HudButton
                type="submit"
                size="sm"
                disabled={connection !== "online" || !prompt.trim()}
              >
                Dispatch
              </HudButton>
              <HudButton
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  send({
                    type: "session.interrupt",
                    cityId: activeCityId,
                  })
                }
                disabled={connection !== "online"}
              >
                Halt
              </HudButton>
            </div>
          </div>
        }
      >
        {draggingBuilding ? (
          <div
            className="flex items-center gap-2 border px-2 py-1.5"
            style={{
              backgroundColor: colorWithAlpha(draggingPalette.accent, 0.14),
              borderColor: colorWithAlpha(draggingPalette.accent, 0.7),
            }}
          >
            <span
              className="hud-mark retro size-5 text-[8px]"
              style={{
                backgroundColor: colorToCss(draggingPalette.accent),
                borderColor: colorToCss(draggingPalette.accentDark),
                color: colorToCss(draggingPalette.ink),
              }}
            >
              {draggingPalette.mark}
            </span>
            <code className="retro min-w-0 flex-1 truncate text-[9px] text-foreground">
              {draggingBuilding.path}
            </code>
          </div>
        ) : null}

        {contextPaths.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            {contextPaths.map((path) => {
              const contextBuilding = world?.buildings.find(
                (building) => building.path === path,
              );
              const palette = paletteFor(
                contextBuilding?.language ?? "unknown",
              );
              return (
                <button
                  key={path}
                  type="button"
                  title={`Remove ${path} from context`}
                  onClick={() => removeContextPath(path)}
                  className="retro inline-flex max-w-full items-center gap-1.5 border px-1.5 py-1 text-left text-[8px] transition-colors hover:border-primary"
                  style={{
                    backgroundColor: colorWithAlpha(palette.accent, 0.12),
                    borderColor: colorWithAlpha(palette.accent, 0.6),
                  }}
                >
                  <span
                    className="hud-mark size-3.5 text-[7px]"
                    style={{
                      backgroundColor: colorToCss(palette.accent),
                      borderColor: colorToCss(palette.accentDark),
                      color: colorToCss(palette.ink),
                    }}
                  >
                    {palette.mark}
                  </span>
                  <span className="max-w-[14rem] truncate text-foreground">
                    {path}
                  </span>
                  <span aria-hidden="true" className="text-muted-foreground">
                    ×
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="hud-label">Crew</span>
          <HudButton
            type="button"
            size="auto"
            variant="outline"
            disabled={connection !== "online"}
            onClick={() => setCrewDialogOpen(true)}
            className="justify-start gap-2 text-left"
          >
            <img
              src={crewSpriteUrl(crewSelection.crewId, crewSelection.effort)}
              alt=""
              className="size-6 object-contain [image-rendering:pixelated]"
            />
            <span className="min-w-0">
              <span className="block text-[8px] text-primary">
                {getCrewMember(crewSelection.crewId).name}
              </span>
              <span className="block text-[8px] text-muted-foreground">
                {effortLabel(crewSelection.effort)} effort
              </span>
            </span>
          </HudButton>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="hud-label">Permissions</span>
          <div
            className="flex gap-1.5"
            role="group"
            aria-label="Permission mode for this order"
          >
            <HudButton
              type="button"
              size="sm"
              variant={
                orderPermissionMode === "default" ? "primary" : "outline"
              }
              aria-pressed={orderPermissionMode === "default"}
              onClick={() => setOrderPermissionMode("default")}
              disabled={connection !== "online"}
            >
              Ask Mayor
            </HudButton>
            <HudButton
              type="button"
              size="sm"
              variant={orderPermissionMode === "auto" ? "primary" : "outline"}
              aria-pressed={orderPermissionMode === "auto"}
              onClick={() => setOrderPermissionMode("auto")}
              disabled={connection !== "online"}
            >
              Don&apos;t Disturb
            </HudButton>
          </div>
        </div>

        <p className="retro text-[8px] leading-relaxed text-muted-foreground">
          {orderPermissionMode === "auto"
            ? "Auto mode applies only to this order."
            : "Default mode pauses for your approval."}
        </p>
      </HudWindow>
    </form>
  );
}
