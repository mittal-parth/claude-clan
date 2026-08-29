import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export interface RetroBlockProgressBarProps {
  /** Number of discrete rectangular blocks in the progress bar. Default 20. */
  segments?: number;
  /** Speed of step progression in milliseconds. Default 65ms. */
  intervalMs?: number;
  /** Custom wrapper class name. */
  className?: string;
  /** Optional custom fill color class for lit blocks. Defaults to glowing amber/yellow. */
  activeColorClass?: string;
}

/**
 * 8-bit segmented loading bar where individual small rectangles
 * light up in yellow one after another in sequence.
 */
export function RetroBlockProgressBar({
  segments = 20,
  intervalMs = 65,
  className,
  activeColorClass = "bg-amber-300 shadow-[0_0_6px_#fcd34d,inset_0_0_1px_#ffffff]",
}: RetroBlockProgressBarProps) {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      // Loop from 0 to segments + 3 (brief hold when fully lit)
      setActiveStep((prev) => (prev + 1) % (segments + 4));
    }, intervalMs);
    return () => clearInterval(timer);
  }, [segments, intervalMs]);

  return (
    <div
      className={cn(
        "flex h-3 w-full items-center gap-1 border border-foreground/30 bg-black/60 p-0.5 dark:border-ring",
        className,
      )}
      role="progressbar"
      aria-label="Loading"
    >
      {Array.from({ length: segments }, (_, index) => {
        const isLit = index < activeStep && activeStep <= segments;
        return (
          <span
            key={index}
            aria-hidden="true"
            data-lit={isLit}
            className={cn(
              "h-full flex-1 rounded-[1px] transition-all duration-75",
              isLit
                ? activeColorClass
                : "border border-white/5 bg-white/10 dark:bg-white/15",
            )}
          />
        );
      })}
    </div>
  );
}

export default RetroBlockProgressBar;
