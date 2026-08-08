import { type VariantProps, cva } from "class-variance-authority";
import type { ButtonHTMLAttributes, MouseEvent } from "react";

import { useUiClick } from "@/hooks/use-ui-click";
import { cn } from "@/lib/utils";

import "@/components/ui/8bit/styles/retro.css";

/**
 * The HUD's one button.
 *
 * The 8-bit kit's button draws its border out of a dozen absolutely positioned
 * spans, which needs margin around every instance and swamps a panel this
 * dense. This keeps the same square, hard-shadowed pixel read using a real
 * border, so it sits flush in a compact row and still presses down when
 * clicked.
 */
export const hudButtonVariants = cva(
  "hud-button retro inline-flex items-center justify-center gap-1.5 whitespace-nowrap select-none",
  {
    variants: {
      variant: {
        primary: "hud-button--primary",
        outline: "hud-button--outline",
        danger: "hud-button--danger",
        ghost: "hud-button--ghost",
      },
      size: {
        sm: "hud-button--sm",
        md: "hud-button--md",
        /** Height comes from the content — used by the crew picker. */
        auto: "hud-button--auto",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface HudButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof hudButtonVariants> {
  /** Set false for controls that already make their own noise. */
  sound?: boolean;
}

export function HudButton({
  className,
  disabled,
  onClick,
  size,
  sound = true,
  type = "button",
  variant,
  ...props
}: HudButtonProps) {
  const playClick = useUiClick();

  function handleClick(event: MouseEvent<HTMLButtonElement>): void {
    if (!disabled && sound) {
      playClick();
    }
    onClick?.(event);
  }

  return (
    <button
      {...props}
      type={type}
      disabled={disabled}
      onClick={handleClick}
      className={cn(hudButtonVariants({ variant, size }), className)}
    />
  );
}

export default HudButton;
