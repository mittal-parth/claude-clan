import { useGameState } from "@/hooks/use-game-state";

import { AppHudArrival } from "./AppHudArrival";
import { AppHudScan } from "./AppHudScan";
import { AppHudInspector } from "./AppHudInspector";
import { AppHudOrder } from "./AppHudOrder";
import { AppHudConsole } from "./AppHudConsole";
import { ShareCityCard } from "../ShareCityCard";

export interface AppHudProps {
  state: ReturnType<typeof useGameState>;
  onSignIn: () => void;
  onLogout: () => void;
  sfxEnabled: boolean;
  toggleSfx: () => void;
  user?: { login: string; avatarUrl: string };
  activeRepoKey: string;
}

export function AppHud(props: AppHudProps) {
  const { state } = props;
  const { shipTransitioning, isCapturingSnapshot, handleTakeSnapshot } = state;

  return (
    <>
      <AppHudArrival state={state} />

      <div className="hud-layer" hidden={shipTransitioning}>
        <div className="hud-column hud-column--main">
          <AppHudScan state={state} />

          <ShareCityCard
            onSnapshot={handleTakeSnapshot}
            isCapturing={isCapturingSnapshot}
          />

          <div className="flex-1" />

          <AppHudInspector state={state} />

          <AppHudOrder state={state} />
        </div>

        <AppHudConsole {...props} />
      </div>
    </>
  );
}
