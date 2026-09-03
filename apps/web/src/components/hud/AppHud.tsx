import { useGameState } from "@/hooks/use-game-state";

import { AppHudArrival } from "./AppHudArrival";
import { AppHudTeleport } from "./AppHudTeleport";
import { AppHudScan } from "./AppHudScan";
import { AppHudInspector } from "./AppHudInspector";
import { AppHudOrder } from "./AppHudOrder";
import { AppHudConsole } from "./AppHudConsole";

import type { TargetFps } from "@/lib/fps-preferences";

export interface AppHudProps {
  state: ReturnType<typeof useGameState>;
  onSignIn: () => void;
  onLogout: () => void;
  sfxEnabled: boolean;
  toggleSfx: () => void;
  targetFps?: TargetFps;
  toggleTargetFps?: () => void;
  user?: { login: string; avatarUrl: string };
  /**
   * The gh account, on desktop only. Kept separate from `user` because that is
   * a hosted OAuth session with a server-side id, and inventing one here would
   * leak a fake id into the per-user storage keys.
   */
  localUser?: { login: string; avatarUrl: string; name?: string };
  activeRepoKey: string;
  terminalOpen?: boolean;
  onToggleTerminal?: () => void;
}

export function AppHud(props: AppHudProps) {
  const { state } = props;
  const { shipTransitioning } = state;

  return (
    <>
      <AppHudArrival state={state} />
      <AppHudTeleport state={state} />

      <div className="hud-layer" hidden={shipTransitioning}>
        <div className="hud-column hud-column--main">
          <AppHudScan state={state} />

          <div className="flex-1" />

          <AppHudInspector state={state} />

          <AppHudOrder state={state} />
        </div>

        <AppHudConsole {...props} />
      </div>
    </>
  );
}
