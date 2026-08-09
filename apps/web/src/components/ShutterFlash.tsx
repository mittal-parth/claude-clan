import { useEffect, useState } from "react";

/**
 * Synthesizes a mechanical camera shutter sound using Web Audio API.
 */
export function playCameraShutterSound() {
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // First mechanical click pulse
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(900, now);
    osc1.frequency.exponentialRampToValueAtTime(100, now + 0.04);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.04);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.04);

    // Mechanical shutter noise snap
    const bufferSize = ctx.sampleRate * 0.07;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.35, now + 0.02);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    noise.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now + 0.02);
  } catch {
    // Audio Context blocked or unavailable
  }
}

export interface ShutterFlashProps {
  isFlashing: boolean;
  onAnimationEnd?: () => void;
}

export function ShutterFlash({ isFlashing, onAnimationEnd }: ShutterFlashProps) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (isFlashing) {
      setActive(true);
      playCameraShutterSound();
      const timer = setTimeout(() => {
        setActive(false);
        onAnimationEnd?.();
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [isFlashing, onAnimationEnd]);

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-[10000] pointer-events-none flex items-center justify-center overflow-hidden">
      {/* Full screen bright white flash layer */}
      <div className="absolute inset-0 bg-white animate-shutter-flash" />

      {/* Camera Lens Aperture Ring Graphic */}
      <div className="relative size-72 rounded-full border-8 border-black/40 bg-transparent opacity-30 animate-ping" />
    </div>
  );
}

export default ShutterFlash;
