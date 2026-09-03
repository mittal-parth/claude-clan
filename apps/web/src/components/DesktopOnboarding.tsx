import { HardHat, Terminal } from "lucide-react";
import { useEffect, useState } from "react";

import HudButton from "@/components/hud/HudButton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { desktop } from "@/lib/desktop";

import "@/components/ui/8bit/styles/retro.css";

export interface DesktopOnboardingProps {
  /** Opens the settings dialog on its credit-source section. */
  onUseApiKey: () => void;
}

/**
 * Shown when no usable `claude` binary was found, so the mayor learns why an
 * order would fail before they try to dispatch one.
 *
 * A real Dialog rather than a hand-rolled fixed overlay: this is the first
 * thing a new user sees, and Radix is what gives it a focus trap, Escape
 * handling and aria-modal. It is deliberately not dismissable by clicking away
 * -- there is nothing behind it that works yet.
 */
export default function DesktopOnboarding({
  onUseApiKey,
}: DesktopOnboardingProps) {
  const bridge = desktop();
  const [visible, setVisible] = useState(false);
  const [checking, setChecking] = useState(false);

  async function check(): Promise<void> {
    if (!bridge) return;
    setChecking(true);
    try {
      const settings = await bridge.readSettings();
      setVisible(!settings.claude && !settings.hasApiKey);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (bridge) void check();
  }, [bridge]);

  if (!bridge || !visible) return null;

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        hideCloseButton
        onEscapeKeyDown={(event) => event.preventDefault()}
        className="max-h-[90dvh] max-w-lg grid grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-4 border-foreground bg-card p-0 shadow-none sm:rounded-none dark:border-ring"
      >
        <div className="border-b-4 border-foreground bg-primary/10 px-5 py-4 dark:border-ring">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="retro text-sm text-primary">
              No crew on site
            </DialogTitle>
            <DialogDescription className="retro text-[9px] text-muted-foreground">
              Claude City runs its crews on your own Claude access.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="grid gap-3 px-5 py-4 overflow-y-auto airport-scrollbar">
          <div className="hud-permit grid gap-2">
            <div className="flex items-center gap-1.5">
              <HardHat
                className="size-3.5 shrink-0 text-amber-400"
                aria-hidden="true"
              />
              <span className="hud-label text-amber-300">
                Claude Code not found
              </span>
            </div>
            <p className="retro text-[9px] leading-relaxed text-foreground">
              Install Claude Code and sign in, and your Pro or Max subscription
              funds every crew you dispatch. Nothing is billed to a key.
            </p>
          </div>

          <ol className="grid gap-1.5">
            <li className="retro text-[8px] leading-relaxed text-muted-foreground">
              1 · Install Claude Code
            </li>
            <li className="retro text-[8px] leading-relaxed text-muted-foreground">
              2 · Run{" "}
              <span className="inline-flex items-center gap-1 text-foreground">
                <Terminal className="size-2.5" aria-hidden="true" />
                claude
              </span>{" "}
              in a terminal and sign in
            </li>
            <li className="retro text-[8px] leading-relaxed text-muted-foreground">
              3 · Come back and check again
            </li>
          </ol>

          <p className="retro text-[8px] leading-relaxed text-muted-foreground">
            No subscription? An API key works too — you set your own spend caps.
          </p>
        </div>

        <DialogFooter className="border-t-4 border-foreground px-5 py-4 dark:border-ring">
          <HudButton type="button" variant="ghost" onClick={onUseApiKey}>
            Use an API key
          </HudButton>
          <HudButton
            type="button"
            variant="outline"
            disabled={checking}
            onClick={() => void check()}
          >
            {checking ? "Checking…" : "Check again"}
          </HudButton>
          <HudButton
            type="button"
            onClick={() =>
              window.open(
                "https://claude.com/code",
                "_blank",
                "noopener,noreferrer",
              )
            }
          >
            Install Claude Code
          </HudButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
