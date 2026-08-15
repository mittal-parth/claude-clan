import { Plane } from "lucide-react";

import type { useGameState } from "@/hooks/use-game-state";
import { cityNameFromRepo } from "@/lib/app-utils";

export interface AppHudArrivalProps {
  state: ReturnType<typeof useGameState>;
}

export function AppHudArrival({ state }: AppHudArrivalProps) {
  const { airportArrival, world, airportArrivalDelayed } = state;

  if (!airportArrival || world) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-8 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-md items-center gap-3 border border-sky-100/20 bg-[#081923]/92 px-4 py-3 text-white shadow-2xl backdrop-blur-md">
        <span className="airport-icon-grid shrink-0">
          <Plane className="size-4 animate-pulse" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="retro truncate text-[8px] text-amber-200">
            ARRIVING · {airportArrival.destinationKey}
          </p>
          <p className="mt-1 text-[10px] text-sky-100/60">
            {airportArrivalDelayed
              ? "The destination survey is taking longer than expected."
              : `Please wait, we're about to land at ${cityNameFromRepo(airportArrival.destinationKey)}…`}
          </p>
        </div>
      </div>
    </div>
  );
}
