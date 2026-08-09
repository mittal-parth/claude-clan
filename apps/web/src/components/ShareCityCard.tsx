import { useState } from "react";
import { Camera, Sparkles } from "lucide-react";
import { HudButton } from "@/components/hud/HudButton";
import { useUiClick } from "@/hooks/use-ui-click";
import "@/components/ui/8bit/styles/retro.css";

export interface ShareCityCardProps {
  onSnapshot: () => void;
  isCapturing?: boolean;
}

export function ShareCityCard({ onSnapshot, isCapturing = false }: ShareCityCardProps) {
  const playClick = useUiClick();
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    playClick();
    onSnapshot();
  };

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="hud-window w-[min(20rem,100%)] mt-2.5 cursor-pointer overflow-hidden transition-all duration-200 hover:border-amber-400/60 group"
      title="Take a snapshot of your city map and share with friends"
    >
      <span aria-hidden="true" className="hud-window__frame" />

      {/* Card Header & Content Grid */}
      <div className="p-3 bg-gradient-to-r from-[#0a1f2d]/90 via-[#081923]/95 to-[#0e2738]/90">
        <div className="flex items-center gap-3">
          {/* Camera Lens Icon Circle */}
          <div className="relative flex size-10 shrink-0 items-center justify-center rounded-lg border border-amber-400/40 bg-amber-400/10 text-amber-300 transition-all duration-300 group-hover:scale-105 group-hover:border-amber-400 group-hover:bg-amber-400/20 group-hover:text-amber-200">
            <Camera aria-hidden="true" className="size-5 transition-transform group-hover:rotate-6" />
            <Sparkles
              aria-hidden="true"
              className="absolute -top-1 -right-1 size-3 text-sky-300 animate-pulse"
            />
          </div>

          {/* Text Content */}
          <div className="min-w-0 flex-1">
            <h3 className="retro text-[11px] font-semibold tracking-wide text-amber-200 group-hover:text-white transition-colors">
              SHARE REPO CITY
            </h3>
            <p className="mt-0.5 text-[10px] leading-tight text-sky-100/70">
              Share your repo city with your friends
            </p>
          </div>

          {/* Camera Button */}
          <HudButton
            type="button"
            size="sm"
            variant="primary"
            disabled={isCapturing}
            sound={false}
            onClick={(e) => {
              e.stopPropagation();
              handleClick();
            }}
            className="shrink-0 transition-transform active:scale-95"
          >
            <Camera className="mr-1 size-3.5" aria-hidden="true" />
            <span className="retro text-[9px]">
              {isCapturing ? "SNAP…" : "SNAP"}
            </span>
          </HudButton>
        </div>
      </div>
    </div>
  );
}

export default ShareCityCard;
