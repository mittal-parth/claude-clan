import { useAudio } from "@/components/audio-provider";
import { useSound } from "@/hooks/use-sound";
import { click8bitSound } from "@/lib/click-8bit";

export function useUiClick() {
  const { sfxEnabled } = useAudio();
  const [playClick] = useSound(click8bitSound, {
    interrupt: true,
    volume: 0.4,
    soundEnabled: sfxEnabled,
  });

  return playClick;
}
