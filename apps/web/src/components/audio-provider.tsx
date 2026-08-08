import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { readSfxEnabled, SFX_STORAGE_KEY } from "@/lib/audio-preferences";

const THEME_TRACK_URL = "/audio/theme.mp3";
const THEME_VOLUME = 0.25;

interface AudioContextValue {
  sfxEnabled: boolean;
  setSfxEnabled: (enabled: boolean) => void;
  toggleSfx: () => void;
}

const AudioContext = createContext<AudioContextValue | null>(null);

export function AudioProvider({ children }: { children: ReactNode }) {
  // Read synchronously: an effect-based read would leave the first commit at
  // the default `true`, which is long enough to start the theme for someone
  // who had muted it.
  const [sfxEnabled, setSfxEnabledState] = useState(() => readSfxEnabled());

  const setSfxEnabled = useCallback((enabled: boolean) => {
    setSfxEnabledState(enabled);
    localStorage.setItem(SFX_STORAGE_KEY, String(enabled));
  }, []);

  const toggleSfx = useCallback(() => {
    setSfxEnabled(!sfxEnabled);
  }, [sfxEnabled, setSfxEnabled]);

  const themeRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const theme = new Audio(THEME_TRACK_URL);
    theme.loop = true;
    theme.volume = THEME_VOLUME;
    theme.preload = "auto";
    themeRef.current = theme;

    return () => {
      theme.pause();
      // Clearing via `src = ""` would resolve to the document URL and fire a
      // stray request; removing the attribute and reloading releases it.
      theme.removeAttribute("src");
      theme.load();
      themeRef.current = null;
    };
  }, []);

  // Browsers block autoplay until the page has been interacted with, so keep
  // retrying on the first gesture until the track actually starts.
  useEffect(() => {
    const theme = themeRef.current;
    if (!theme) return;

    if (!sfxEnabled) {
      theme.pause();
      return;
    }

    let cancelled = false;
    const gestures = ["pointerdown", "keydown", "touchstart"] as const;

    const stopWaiting = () => {
      for (const gesture of gestures) {
        window.removeEventListener(gesture, play);
      }
    };

    function play() {
      const current = themeRef.current;
      if (cancelled || !current) return;
      current.play().then(stopWaiting, () => {
        // Still blocked; the gesture listeners stay armed for the next try.
      });
    }

    play();
    for (const gesture of gestures) {
      window.addEventListener(gesture, play);
    }

    return () => {
      cancelled = true;
      stopWaiting();
    };
  }, [sfxEnabled]);

  const value = useMemo(
    () => ({ sfxEnabled, setSfxEnabled, toggleSfx }),
    [sfxEnabled, setSfxEnabled, toggleSfx],
  );

  return (
    <AudioContext.Provider value={value}>{children}</AudioContext.Provider>
  );
}

export function useAudio(): AudioContextValue {
  const context = useContext(AudioContext);
  if (!context) {
    throw new Error("useAudio must be used within AudioProvider");
  }
  return context;
}
