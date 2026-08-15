import { useEffect } from "react";
import { sendDiscardBeacon } from "./client";

export interface UnloadGuardOptions {
  activeUploadId?: string;
  isUploadCityActive: boolean;
  isUploadInFlight: boolean;
}

/**
 * Warns before tab close/reload and sends a discard beacon if a temporary upload
 * is active or in-flight.
 */
export function useUnloadGuard({
  activeUploadId,
  isUploadCityActive,
  isUploadInFlight,
}: UnloadGuardOptions): {
  confirmExit: (actionName?: string) => boolean;
} {
  const isGuarded = isUploadCityActive || isUploadInFlight;

  useEffect(() => {
    if (!isGuarded) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
      return "";
    };

    const handlePageHide = () => {
      if (activeUploadId) {
        sendDiscardBeacon(activeUploadId);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [isGuarded, activeUploadId]);

  function confirmExit(actionName?: string): boolean {
    if (!isGuarded) {
      return true;
    }
    const message = actionName
      ? `Leaving this temporary city for ${actionName} will delete this upload. Continue?`
      : "Leaving this temporary city will delete this upload. Continue?";
    return window.confirm(message);
  }

  return { confirmExit };
}
