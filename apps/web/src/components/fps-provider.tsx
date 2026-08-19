import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  readTargetFps,
  writeTargetFps,
  type TargetFps,
} from "@/lib/fps-preferences";

interface FpsContextValue {
  targetFps: TargetFps;
  setTargetFps: (fps: TargetFps) => void;
  toggleTargetFps: () => void;
}

const FpsContext = createContext<FpsContextValue | null>(null);

export function FpsProvider({ children }: { children: ReactNode }) {
  const [targetFps, setTargetFpsState] = useState<TargetFps>(() =>
    readTargetFps(),
  );

  const setTargetFps = useCallback((fps: TargetFps) => {
    setTargetFpsState(fps);
    writeTargetFps(fps);
  }, []);

  const toggleTargetFps = useCallback(() => {
    setTargetFpsState((current) => {
      const next: TargetFps = current === 30 ? 60 : 30;
      writeTargetFps(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ targetFps, setTargetFps, toggleTargetFps }),
    [targetFps, setTargetFps, toggleTargetFps],
  );

  return <FpsContext.Provider value={value}>{children}</FpsContext.Provider>;
}

export function useFps(): FpsContextValue {
  const context = useContext(FpsContext);
  if (!context) {
    return {
      targetFps: 30,
      setTargetFps: () => undefined,
      toggleTargetFps: () => undefined,
    };
  }
  return context;
}
