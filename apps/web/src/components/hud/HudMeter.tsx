import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

import { METER_SEGMENTS, filledSegments } from "./meter";

import "@/components/ui/8bit/styles/retro.css";

export interface HudMeterProps {
  label: string;
  /** Right-aligned exact figure — the cells only ever give a rough read. */
  readout: string;
  /** Percentage, 0–100. */
  value: number;
  /**
   * No ceiling exists, so the cells show an idle track instead of a fill.
   *
   * A subscription-funded city has nothing to meter. Rendering `value={0}`
   * instead would draw an empty bar, which reads as "nothing spent yet" and
   * starts looking wrong the moment it stays empty after a costly order;
   * dropping the bar entirely makes the panel jump when the mode changes.
   */
  unmetered?: boolean;
  /** Fill colour; defaults to the HUD accent. */
  tone?: string;
  className?: string;
}

export function HudMeter({
  label,
  readout,
  value,
  unmetered = false,
  tone,
  className,
}: HudMeterProps) {
  const filled = unmetered ? 0 : filledSegments(value);

  return (
    <div className={cn("grid gap-1", className)}>
      <div className="hud-label flex justify-between gap-2">
        <span>{label}</span>
        <span>{readout}</span>
      </div>
      <div
        className={cn("hud-meter", unmetered && "hud-meter--unmetered")}
        role={unmetered ? "presentation" : "progressbar"}
        aria-label={unmetered ? undefined : label}
        aria-valuenow={unmetered ? undefined : Math.round(value)}
        aria-valuemin={unmetered ? undefined : 0}
        aria-valuemax={unmetered ? undefined : 100}
        aria-valuetext={unmetered ? undefined : readout}
        style={
          tone ? ({ "--hud-meter-fill": tone } as CSSProperties) : undefined
        }
      >
        {Array.from({ length: METER_SEGMENTS }, (_, index) => (
          <span
            key={index}
            aria-hidden="true"
            className="hud-meter__cell"
            data-on={index < filled}
          />
        ))}
      </div>
    </div>
  );
}

export default HudMeter;
