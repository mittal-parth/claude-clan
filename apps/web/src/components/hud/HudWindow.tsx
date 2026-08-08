import { ChevronDown } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { useUiClick } from "@/hooks/use-ui-click";
import { cn } from "@/lib/utils";

import "@/components/ui/8bit/styles/retro.css";

export interface HudWindowProps {
  /** Stable id; the collapsible body is labelled from it. */
  id: string;
  title: string;
  /** Dim trailing text in the title bar, e.g. a live/linking state. */
  hint?: string;
  /** Replaces the accent tick — used for the console's city mark. */
  icon?: ReactNode;
  /** Sits after the leader, before the actions. */
  meta?: ReactNode;
  /** Buttons in the title bar, left of the collapse control. */
  actions?: ReactNode;
  /** Overrides the amber default, e.g. a language colour on the inspector. */
  accent?: string;
  expanded: boolean;
  onToggle: () => void;
  /** Grows to fill its flex column while expanded. */
  fill?: boolean;
  className?: string;
  bodyClassName?: string;
  /** Stays visible while the window is compact — the order bar needs this. */
  persistent?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}

/**
 * A floating window over the full-screen world.
 *
 * The body collapses through a `0fr`/`1fr` grid row rather than a height, so a
 * window whose content is a scrolling list animates as cleanly as one that is
 * two lines tall, and `fill` lets a window claim the rest of its column while
 * still folding down to just its title bar.
 */
export function HudWindow({
  id,
  title,
  hint,
  icon,
  meta,
  actions,
  accent,
  expanded,
  onToggle,
  fill = false,
  className,
  bodyClassName,
  persistent,
  footer,
  children,
}: HudWindowProps) {
  const playClick = useUiClick();
  const bodyId = `${id}-body`;

  return (
    <section
      data-expanded={expanded}
      className={cn("hud-window", fill && "hud-window--fill", className)}
      style={
        accent ? ({ "--hud-accent": accent } as CSSProperties) : undefined
      }
    >
      <span aria-hidden="true" className="hud-window__frame" />

      <header className="hud-window__bar">
        {icon ?? <span aria-hidden="true" className="hud-window__tick" />}
        <h2 className="hud-window__title retro">{title}</h2>
        {hint ? <span className="hud-window__hint retro">{hint}</span> : null}
        <span aria-hidden="true" className="hud-window__leader" />
        {meta}
        {actions}
        <button
          type="button"
          className="hud-window__toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={
            expanded ? `Make ${title} compact` : `Expand ${title}`
          }
          title={expanded ? "Make compact" : "Expand"}
          onClick={() => {
            playClick();
            onToggle();
          }}
        >
          <ChevronDown className="size-3" aria-hidden="true" />
        </button>
      </header>

      {children ? (
        <div id={bodyId} className="hud-window__reveal" inert={!expanded}>
          <div className={cn("hud-window__body", bodyClassName)}>
            {children}
          </div>
        </div>
      ) : null}

      {persistent ? (
        <div className="hud-window__persistent">{persistent}</div>
      ) : null}

      {footer ? <footer className="hud-window__footer">{footer}</footer> : null}
    </section>
  );
}

export default HudWindow;
