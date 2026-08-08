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
  /** Fill colour; defaults to the HUD accent. */
  tone?: string;
  className?: string;
}

export function HudMeter({
  label,
  readout,
  value,
  tone,
  className,
}: HudMeterProps) {
  const filled = filledSegments(value);

  return (
    <div className={cn("grid gap-1", className)}>
      <div className="hud-label flex justify-between gap-2">
        <span>{label}</span>
        <span>{readout}</span>
      </div>
      <div
        className="hud-meter"
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={readout}
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
