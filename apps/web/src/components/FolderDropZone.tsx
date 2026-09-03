import { FolderPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { desktop } from "@/lib/desktop";

import "@/components/ui/8bit/styles/retro.css";

export interface FolderDropZoneProps {
  onOpenFolder: (path: string) => void;
}

export default function FolderDropZone({ onOpenFolder }: FolderDropZoneProps) {
  const bridge = desktop();
  const [depth, setDepth] = useState(0);

  useEffect(() => {
    if (!bridge) return;
    bridge.onOpenFolder(onOpenFolder);
  }, [bridge, onOpenFolder]);

  useEffect(() => {
    if (!bridge) return;
    const onDragEnter = (event: DragEvent) => {
      event.preventDefault();
      setDepth((current) => current + 1);
    };
    const onDragLeave = (event: DragEvent) => {
      event.preventDefault();
      setDepth((current) => Math.max(0, current - 1));
    };
    const onDragOver = (event: DragEvent) => event.preventDefault();
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      setDepth(0);
      const file = event.dataTransfer?.files[0];
      if (!file) return;
      const path = bridge.pathForFile(file);
      if (path) {
        void bridge.rememberFolder(path);
        onOpenFolder(path);
      }
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [bridge, onOpenFolder]);

  if (!bridge || depth === 0) return null;
  return (
    <div className="folder-drop-overlay" role="presentation">
      <span aria-hidden="true" className="folder-drop-overlay__frame" />
      <div className="folder-drop-overlay__plate">
        <FolderPlus
          className="folder-drop-overlay__icon size-6"
          aria-hidden="true"
        />
        <p className="retro folder-drop-overlay__title">Found a city here</p>
        <p className="hud-label">Drop a folder to scan it</p>
      </div>
    </div>
  );
}
