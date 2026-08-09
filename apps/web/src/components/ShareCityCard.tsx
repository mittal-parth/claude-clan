import { Camera } from "lucide-react";
import { HudButton } from "@/components/hud/HudButton";
import { useUiClick } from "@/hooks/use-ui-click";
import "@/components/ui/8bit/styles/retro.css";

export interface ShareCityCardProps {
  onSnapshot: () => void;
  isCapturing?: boolean;
}

export function ShareCityCard({ onSnapshot, isCapturing = false }: ShareCityCardProps) {
  const playClick = useUiClick();

  const handleClick = () => {
    playClick();
    onSnapshot();
  };

  return (
    <section
      onClick={handleClick}
      className="hud-window w-[min(20rem,100%)] mt-2.5 cursor-pointer transition-colors duration-150 hover:border-amber-400/80 group"
      title="Take a snapshot of your city map and share with friends"
    >
      <span aria-hidden="true" className="hud-window__frame" />

      <header className="hud-window__bar">
        <span aria-hidden="true" className="hud-window__tick" />
        <h2 className="hud-window__title retro text-amber-200">Share city map</h2>
        <span aria-hidden="true" className="hud-window__leader" />
      </header>

      <div className="p-2.5 flex items-center justify-between gap-2.5 bg-[#081923]">
        <div className="min-w-0 flex-1">
          <p className="retro text-[10px] text-sky-100/90 leading-tight">
            Share your repo city with your friends
          </p>
        </div>

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
          className="shrink-0"
        >
          <Camera className="mr-1 size-3" aria-hidden="true" />
          <span className="retro text-[9px]">
            {isCapturing ? "SNAP…" : "SNAP"}
          </span>
        </HudButton>
      </div>
    </section>
  );
}

export default ShareCityCard;
