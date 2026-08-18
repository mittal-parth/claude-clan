import { Zap } from "lucide-react";
import type { useGameState } from "@/hooks/use-game-state";
import { HudButton } from "./HudButton";

export interface AppHudTeleportProps {
  state: ReturnType<typeof useGameState>;
}

export function AppHudTeleport({ state }: AppHudTeleportProps) {
  const { shipTransitioning, canvasRef } = state;

  if (!shipTransitioning) {
    return null;
  }

  return (
    <div className="absolute bottom-6 right-6 z-50">
      <HudButton
        type="button"
        variant="primary"
        size="auto"
        onClick={() => {
          canvasRef.current?.skipTransition();
        }}
        className="flex items-center gap-2 px-6 py-3.5 shadow-xl"
      >
        <span className="retro text-[11px] tracking-wider uppercase">
          Teleport instantly
        </span>
        <Zap
          className="size-3 shrink-0 fill-current"
          strokeLinejoin="miter"
          strokeLinecap="square"
          strokeWidth={1}
          aria-hidden="true"
        />
      </HudButton>
    </div>
  );
}
