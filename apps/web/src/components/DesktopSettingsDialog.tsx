import {
  AlertTriangle,
  KeyRound,
  Landmark,
  Radio,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import HudButton from "@/components/hud/HudButton";
import RetroBlockProgressBar from "@/components/hud/RetroBlockProgressBar";
import { useFps } from "@/components/fps-provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { useGameState } from "@/hooks/use-game-state";
import { desktop, type DesktopSettings } from "@/lib/desktop";
import type { TargetFps } from "@/lib/fps-preferences";
import { cn } from "@/lib/utils";

import "@/components/ui/8bit/styles/retro.css";

const DEFAULT_SETTINGS: DesktopSettings = {
  creditMode: "subscription",
  hasApiKey: false,
  perOrderCapUsd: 5,
  monthlyCapUsd: 50,
  settingSources: [],
  recentFolders: [],
};

/** The two caps GameCanvas supports; a tuple so the buttons stay exhaustive. */
const FRAME_RATES: readonly TargetFps[] = [30, 60];

const CREDIT_SOURCES = [
  {
    mode: "subscription" as const,
    name: "My Claude subscription",
    detail: "Your local Claude Code login. No dollar ceiling to manage.",
  },
  {
    mode: "api-key" as const,
    name: "My API key",
    detail: "Billed per token against the caps you set below.",
  },
];

const CAP_FIELDS = [
  {
    field: "perOrderCapUsd" as const,
    label: "Per-order cap",
    hint: "Ends a turn that spends past this.",
    step: "0.01",
  },
  {
    field: "monthlyCapUsd" as const,
    label: "Monthly cap",
    hint: "Refuses new orders once reached.",
    step: "1",
  },
];

export interface DesktopSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state?: ReturnType<typeof useGameState>;
}

/** A titled block matching the airport/naval board section layout. */
function Section({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-2.5 border-t border-white/10 px-5 py-4 first:border-t-0 sm:px-6">
      <p className="retro text-[8px] uppercase tracking-[0.2em] text-sky-200/70">
        {label}
      </p>
      {children}
    </section>
  );
}

export default function DesktopSettingsDialog({
  open,
  onOpenChange,
  state,
}: DesktopSettingsDialogProps) {
  const bridge = desktop();
  const { targetFps, setTargetFps } = useFps();
  const [settings, setSettings] = useState<DesktopSettings>(DEFAULT_SETTINGS);
  const [apiKey, setApiKeyValue] = useState("");
  const [status, setStatus] = useState<string>();
  const [isReloading, setIsReloading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [perOrderText, setPerOrderText] = useState("5");
  const [monthlyText, setMonthlyText] = useState("50");
  const [pendingMode, setPendingMode] = useState<DesktopSettings["creditMode"]>();
  const [pendingClear, setPendingClear] = useState<
    "perOrderCapUsd" | "monthlyCapUsd"
  >();

  async function reload(): Promise<void> {
    if (!bridge) return;
    const next = await bridge.readSettings();
    setSettings(next);
    setPerOrderText(
      next.perOrderCapUsd === undefined ? "" : String(next.perOrderCapUsd),
    );
    setMonthlyText(
      next.monthlyCapUsd === undefined ? "" : String(next.monthlyCapUsd),
    );
  }

  useEffect(() => {
    if (!bridge || !open) return;
    setPendingMode(undefined);
    setPendingClear(undefined);
    void reload().catch(() => setStatus("Could not read desktop settings."));
  }, [bridge, open]);

  const verificationSession = useMemo(
    () =>
      state?.sessions.sessions.find(
        (session) => session.title === "Credential check",
      ),
    [state?.sessions.sessions],
  );

  useEffect(() => {
    const source = verificationSession?.apiKeySource;
    if (!source) return;
    setVerifying(false);
    setStatus(
      source.toLowerCase().includes("login managed") || source === "oauth"
        ? "Verified — orders are paid by your Claude subscription."
        : `Verified — Claude reported apiKeySource=${source}.`,
    );
  }, [verificationSession?.apiKeySource]);

  if (!bridge) {
    return null;
  }
  const desktopBridge = bridge;
  const runningCount = state?.sessions.runningCount ?? 0;

  async function restartAfter(
    patch: Parameters<typeof desktopBridge.writeSettings>[0],
  ): Promise<void> {
    setIsReloading(true);
    setStatus("Saved. Reloading the crew depot…");
    try {
      await desktopBridge.writeSettings(patch);
      await desktopBridge.restartServer();
      await reload();
      setStatus("Saved. New orders will use these settings.");
    } catch {
      setStatus("Failed to reload server settings.");
    } finally {
      setIsReloading(false);
    }
  }

  function requestCreditMode(mode: DesktopSettings["creditMode"]): void {
    if (isReloading || mode === settings.creditMode) return;
    if (runningCount > 0) {
      setPendingMode(mode);
      return;
    }
    void restartAfter({ creditMode: mode });
  }

  async function saveApiKey(): Promise<void> {
    if (apiKey.trim().length < 10) {
      setStatus("That does not look like an API key.");
      return;
    }
    setIsReloading(true);
    setStatus("Saving API key and reloading server…");
    try {
      await desktopBridge.setApiKey(apiKey.trim());
      await desktopBridge.writeSettings({ creditMode: "api-key" });
      setApiKeyValue("");
      await desktopBridge.restartServer();
      await reload();
      setStatus("Key saved and active. Verify it with one turn.");
    } catch {
      setStatus("Failed to save API key.");
    } finally {
      setIsReloading(false);
    }
  }

  async function clearApiKey(): Promise<void> {
    setIsReloading(true);
    setStatus("Removing API key and reloading server…");
    try {
      await desktopBridge.clearApiKey();
      await desktopBridge.restartServer();
      await reload();
      setStatus("API key removed.");
    } catch {
      setStatus("Failed to remove API key.");
    } finally {
      setIsReloading(false);
    }
  }

  async function saveCaps(): Promise<void> {
    const perOrder = perOrderText.trim() ? Number(perOrderText) : null;
    const monthly = monthlyText.trim() ? Number(monthlyText) : null;
    if (
      (perOrder !== null && (!Number.isFinite(perOrder) || perOrder <= 0)) ||
      (monthly !== null && (!Number.isFinite(monthly) || monthly <= 0))
    ) {
      setStatus("Caps must be positive dollar amounts.");
      return;
    }
    await restartAfter({ perOrderCapUsd: perOrder, monthlyCapUsd: monthly });
  }

  async function confirmClear(): Promise<void> {
    const field = pendingClear;
    if (!field) return;
    setPendingClear(undefined);
    if (field === "perOrderCapUsd") setPerOrderText("");
    if (field === "monthlyCapUsd") setMonthlyText("");
    await restartAfter({ [field]: null });
  }

  function verify(): void {
    if (!state) {
      setStatus("Open a folder before verifying a credential.");
      return;
    }
    setVerifying(true);
    setStatus("Dispatching a one-turn check…");
    state.sessions.openSession("main", "Reply with exactly: verified", {
      title: "Credential check",
      model: "haiku",
      effort: "low",
      permissionMode: "auto",
    });
  }

  async function toggleSource(source: "user" | "project"): Promise<void> {
    if (isReloading) return;
    const next = settings.settingSources.includes(source)
      ? settings.settingSources.filter((entry) => entry !== source)
      : [...settings.settingSources, source];
    await restartAfter({ settingSources: next });
  }

  const byok = settings.creditMode === "api-key";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="airport-board flex max-h-[92dvh] max-w-2xl flex-col overflow-hidden border border-sky-100/20 bg-[#081923] p-0 text-white shadow-2xl sm:rounded-none">
        <div className="airport-board-header shrink-0 relative overflow-hidden border-b border-white/10 px-5 pb-4 pt-5 sm:px-6">
          <div className="relative z-10 flex items-start justify-between gap-5 pr-8">
            <DialogHeader className="space-y-2 text-left">
              <div className="flex items-center gap-2">
                <span className="airport-terminal-code retro text-amber-300 border-amber-300">
                  CITY-HALL
                </span>
                <span className="retro text-[8px] tracking-[0.24em] text-sky-100/55">
                  DESKTOP CONTROL · DISPATCH & LIMITS
                </span>
              </div>
              <DialogTitle className="flex items-center gap-2.5 text-left">
                <span className="airport-icon-grid">
                  <Landmark className="size-5 text-amber-300" aria-hidden="true" />
                </span>
                <span className="retro text-sm text-amber-200 sm:text-base">
                  City Hall Settings
                </span>
              </DialogTitle>
              <DialogDescription className="max-w-xl text-xs leading-5 text-sky-100/55">
                Who pays for your crews, and what they are allowed to spend. Changes will apply to new orders.
              </DialogDescription>
            </DialogHeader>
            <span className="hidden items-center gap-2 border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-2 sm:flex">
              <Radio className="size-3.5 text-emerald-300" aria-hidden="true" />
              <span className="retro text-[7px] leading-3 text-emerald-200">
                DEPOT<br />ONLINE
              </span>
            </span>
          </div>
        </div>

        {isReloading ? (
          <div className="shrink-0 border-b border-amber-300/30 bg-amber-400/[0.06] px-5 py-3 sm:px-6">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <RefreshCw
                  className="size-3 animate-spin text-amber-300"
                  aria-hidden="true"
                />
                <span className="retro text-[9px] font-bold text-amber-300">
                  RESTARTING SERVER & CREW DEPOT…
                </span>
              </div>
              <span className="retro text-[7px] tracking-wider text-amber-200/80">
                PLEASE WAIT
              </span>
            </div>
            <RetroBlockProgressBar segments={24} />
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto airport-scrollbar">
          <Section label="Credit source">
            <div className="grid gap-2 sm:grid-cols-2">
              {CREDIT_SOURCES.map((source) => {
                const selected = settings.creditMode === source.mode;
                return (
                  <button
                    key={source.mode}
                    type="button"
                    aria-pressed={selected}
                    disabled={isReloading}
                    onClick={() => requestCreditMode(source.mode)}
                    className={cn(
                      "group relative grid gap-1 border bg-white/[0.035] p-3 text-left transition-colors cursor-pointer",
                      selected
                        ? "border-amber-300/60 bg-amber-400/[0.08]"
                        : "border-white/10 hover:border-amber-300/40 hover:bg-white/[0.06]",
                      isReloading && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "retro text-[9px]",
                          selected ? "text-amber-200" : "text-white",
                        )}
                      >
                        {source.name}
                      </span>
                      {selected ? (
                        <span className="retro border border-amber-300/40 bg-amber-400/20 px-1.5 py-0.5 text-[7px] text-amber-300">
                          ACTIVE
                        </span>
                      ) : null}
                    </div>
                    <span className="retro text-[8px] leading-relaxed text-sky-100/60">
                      {source.detail}
                    </span>
                  </button>
                );
              })}
            </div>

            {pendingMode ? (
              <div className="grid gap-2 border border-amber-300/30 bg-amber-300/[0.06] p-3">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle
                    className="size-3.5 shrink-0 text-amber-300"
                    aria-hidden="true"
                  />
                  <span className="retro text-[9px] font-bold text-amber-200">
                    {runningCount} crew{runningCount === 1 ? "" : "s"} still working
                  </span>
                </div>
                <p className="retro text-[8px] leading-relaxed text-amber-100/70">
                  Running crews keep the credential they started with, and their current turn is cut short. New orders use the new source.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <HudButton
                    type="button"
                    size="sm"
                    className="retro text-[8px]"
                    disabled={isReloading}
                    onClick={() => {
                      const mode = pendingMode;
                      setPendingMode(undefined);
                      void restartAfter({ creditMode: mode });
                    }}
                  >
                    Switch anyway
                  </HudButton>
                  <HudButton
                    type="button"
                    size="sm"
                    variant="outline"
                    className="retro text-[8px]"
                    disabled={isReloading}
                    onClick={() => setPendingMode(undefined)}
                  >
                    Keep current
                  </HudButton>
                </div>
              </div>
            ) : null}
          </Section>

          {byok ? (
            <Section label="API key">
              <label className="grid gap-1">
                <span className="sr-only">Anthropic API key</span>
                <div className="flex items-center gap-2 border border-white/10 bg-black/20 px-3 py-2">
                  <KeyRound
                    className="size-3.5 shrink-0 text-sky-200/55"
                    aria-hidden="true"
                  />
                  <input
                    type="password"
                    value={apiKey}
                    disabled={isReloading}
                    onChange={(event) => setApiKeyValue(event.target.value)}
                    placeholder={
                      settings.hasApiKey
                        ? "Key saved — type a replacement"
                        : "sk-ant-…"
                    }
                    autoComplete="off"
                    spellCheck={false}
                    className="retro w-full bg-transparent text-[9px] text-white outline-none placeholder:text-slate-500 focus:border-amber-300/60"
                  />
                </div>
              </label>
              <div className="flex flex-wrap gap-1.5">
                <HudButton
                  type="button"
                  size="sm"
                  disabled={isReloading}
                  className="retro text-[8px]"
                  onClick={() => void saveApiKey()}
                >
                  Save key
                </HudButton>
                {settings.hasApiKey ? (
                  <HudButton
                    type="button"
                    size="sm"
                    variant="danger"
                    disabled={isReloading}
                    className="retro text-[8px]"
                    onClick={() => void clearApiKey()}
                  >
                    Remove
                  </HudButton>
                ) : null}
                <HudButton
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={verifying || isReloading}
                  className="retro text-[8px]"
                  onClick={verify}
                >
                  {verifying ? "Verifying…" : "Verify with one turn"}
                </HudButton>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {CAP_FIELDS.map((cap) => (
                  <div
                    key={cap.field}
                    className="grid gap-1.5 border border-white/10 bg-white/[0.025] p-3"
                  >
                    <label className="grid gap-1">
                      <span className="retro text-[8px] text-sky-200/70">
                        {cap.label} ($)
                      </span>
                      <div className="flex items-center gap-1.5 border border-white/10 bg-black/30 px-3 py-1.5">
                        <span className="retro text-[9px] text-amber-300">$</span>
                        <input
                          type="number"
                          min="0.01"
                          step={cap.step}
                          disabled={isReloading}
                          value={
                            cap.field === "perOrderCapUsd"
                              ? perOrderText
                              : monthlyText
                          }
                          onChange={(event) =>
                            cap.field === "perOrderCapUsd"
                              ? setPerOrderText(event.target.value)
                              : setMonthlyText(event.target.value)
                          }
                          placeholder="none"
                          className="retro w-full bg-transparent text-[9px] text-white outline-none placeholder:text-slate-500"
                        />
                      </div>
                    </label>
                    <div className="flex items-center justify-between gap-2">
                      <span className="retro text-[8px] text-sky-100/55">
                        {cap.hint}
                      </span>
                      <button
                        type="button"
                        disabled={isReloading}
                        className="retro text-[8px] text-amber-300/80 hover:text-amber-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => setPendingClear(cap.field)}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {pendingClear ? (
                <div className="grid gap-2 border border-amber-300/30 bg-amber-300/[0.06] p-3">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle
                      className="size-3.5 shrink-0 text-amber-300"
                      aria-hidden="true"
                    />
                    <span className="retro text-[9px] font-bold text-amber-200">
                      Remove this ceiling
                    </span>
                  </div>
                  <p className="retro text-[8px] leading-relaxed text-amber-100/70">
                    With no cap, an Opus crew at max thinking can run up a real
                    bill before you notice. Nothing will stop it.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <HudButton
                      type="button"
                      size="sm"
                      variant="danger"
                      disabled={isReloading}
                      className="retro text-[8px]"
                      onClick={() => void confirmClear()}
                    >
                      Remove cap
                    </HudButton>
                    <HudButton
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isReloading}
                      className="retro text-[8px]"
                      onClick={() => setPendingClear(undefined)}
                    >
                      Keep it
                    </HudButton>
                  </div>
                </div>
              ) : null}

              <HudButton
                type="button"
                size="sm"
                variant="outline"
                disabled={isReloading}
                className="retro text-[8px]"
                onClick={() => void saveCaps()}
              >
                Save caps
              </HudButton>
            </Section>
          ) : null}

          <Section label="Claude Code">
            {settings.claude ? (
              <div className="grid gap-1.5 border border-white/10 bg-white/[0.025] p-3">
                <div className="flex items-center gap-2">
                  <span className="retro border border-sky-300/30 bg-sky-300/10 px-2 py-0.5 text-[8px] text-sky-200">
                    {settings.claude.source} install
                  </span>
                  <span className="retro text-[9px] text-white">
                    v{settings.claude.version}
                  </span>
                </div>
                <p className="retro truncate text-[8px] text-sky-100/55">
                  {settings.claude.path}
                </p>
              </div>
            ) : (
              <p className="retro border border-white/10 bg-white/[0.025] p-3 text-[8px] leading-relaxed text-sky-100/55">
                Not found. Install Claude Code, or use an API key above.
              </p>
            )}
          </Section>

          <Section label="Crew settings">
            <p className="retro text-[8px] leading-relaxed text-sky-100/60">
              Load your own Claude Code configuration into city crews. Turning
              these on means your hooks and permission rules apply here too.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(["user", "project"] as const).map((source) => {
                const on = settings.settingSources.includes(source);
                return (
                  <button
                    key={source}
                    type="button"
                    disabled={isReloading}
                    onClick={() => void toggleSource(source)}
                    className={cn(
                      "retro flex items-center justify-between border px-3 py-2 text-[8px] transition-colors cursor-pointer",
                      on
                        ? "border-amber-300/60 bg-amber-400/[0.08] text-amber-200"
                        : "border-white/10 bg-white/[0.025] text-sky-100/70 hover:border-white/25 hover:bg-white/[0.05]",
                      isReloading && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <span className="uppercase">{source} settings</span>
                    <span
                      className={cn(
                        "border px-1.5 py-0.5 text-[7px]",
                        on
                          ? "border-amber-300/40 bg-amber-400/20 text-amber-300"
                          : "border-white/10 text-white/40",
                      )}
                    >
                      {on ? "ENABLED" : "DISABLED"}
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section label="Display">
            <p className="retro text-[8px] leading-relaxed text-sky-100/60">
              A lower cap keeps the city calm on battery and integrated
              graphics; 60 is smoother when the machine can afford it.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {FRAME_RATES.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => setTargetFps(rate)}
                  className={cn(
                    "retro flex items-center justify-center border py-2 text-[8px] transition-colors cursor-pointer",
                    targetFps === rate
                      ? "border-amber-300/60 bg-amber-400/[0.08] text-amber-200"
                      : "border-white/10 bg-white/[0.025] text-sky-100/70 hover:border-white/25 hover:bg-white/[0.05]",
                  )}
                >
                  {rate} FPS
                </button>
              ))}
            </div>
          </Section>

          {status ? (
            <div className="border-t border-white/10 bg-black/20 px-5 py-3 sm:px-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="retro text-[9px] leading-relaxed text-amber-300">
                  {status}
                </p>
                {isReloading ? (
                  <div className="w-28 shrink-0">
                    <RetroBlockProgressBar segments={12} className="h-2.5" />
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="shrink-0 flex items-center justify-between border-t border-white/10 px-5 py-4 sm:px-6">
          <span className="retro flex items-center gap-1.5 text-[8px] text-sky-100/55">
            <ShieldCheck className="size-3.5 text-emerald-300" aria-hidden="true" />
            Key never shown after saving
          </span>
          <HudButton
            type="button"
            variant="outline"
            size="sm"
            className="retro text-[8px]"
            onClick={() => onOpenChange(false)}
          >
            Close
          </HudButton>
        </div>
        <div className="airport-runway-bar shrink-0" aria-hidden="true">
          <span /><span /><span /><span /><span /><span /><span />
        </div>
      </DialogContent>
    </Dialog>
  );
}
