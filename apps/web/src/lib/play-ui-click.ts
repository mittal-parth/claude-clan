import { readSfxEnabled } from "@/lib/audio-preferences";
import { click8bitSound } from "@/lib/click-8bit";
import { playSound, type SoundPlayback } from "@/lib/sound-engine";

const UI_CLICK_VOLUME = 0.4;

let activePlayback: SoundPlayback | null = null;

export function playUiClickSound(): void {
  if (!readSfxEnabled()) {
    return;
  }

  activePlayback?.stop();
  void playSound(click8bitSound.dataUri, { volume: UI_CLICK_VOLUME }).then(
    (playback) => {
      activePlayback = playback;
    },
  );
}
