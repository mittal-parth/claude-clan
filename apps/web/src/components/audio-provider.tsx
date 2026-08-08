import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { readSfxEnabled, SFX_STORAGE_KEY } from "@/lib/audio-preferences";

interface AudioContextValue {
  sfxEnabled: boolean;
  setSfxEnabled: (enabled: boolean) => void;
  toggleSfx: () => void;
}

const AudioContext = createContext<AudioContextValue | null>(null);

export function AudioProvider({ children }: { children: ReactNode }) {
  const [sfxEnabled, setSfxEnabledState] = useState(true);

  useEffect(() => {
    setSfxEnabledState(readSfxEnabled());
  }, []);

  const setSfxEnabled = useCallback((enabled: boolean) => {
    setSfxEnabledState(enabled);
    localStorage.setItem(SFX_STORAGE_KEY, String(enabled));
  }, []);

  const toggleSfx = useCallback(() => {
    setSfxEnabled(!sfxEnabled);
  }, [sfxEnabled, setSfxEnabled]);

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
