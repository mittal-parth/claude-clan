import { AlertTriangle, ExternalLink, X } from "lucide-react";
import "@/components/ui/8bit/styles/retro.css";

export const DEFAULT_WRITE_ACCESS_MESSAGE =
  "GitHub write access is required to push changes or create pull requests. Ensure your GitHub App has 'Contents: Read and write' permissions and you have collaborator write access.";

export function formatWriteAccessMessage(detail?: string): string {
  if (!detail || detail.trim().length === 0) {
    return DEFAULT_WRITE_ACCESS_MESSAGE;
  }
  return detail.trim();
}

export interface WriteAccessBannerProps {
  message?: string;
  onDismiss: () => void;
}

export function WriteAccessBanner({ message, onDismiss }: WriteAccessBannerProps) {
  const displayMessage = formatWriteAccessMessage(message);
  return (
    <div
      role="alert"
      className="pointer-events-auto fixed top-4 left-1/2 z-[99999] flex w-[92%] max-w-xl -translate-x-1/2 items-center gap-3 border-2 border-amber-400/90 bg-[#081923]/95 px-4 py-2.5 shadow-[0_0_24px_rgba(245,158,11,0.3)] backdrop-blur-md text-white"
    >
      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
        <AlertTriangle className="size-3.5" aria-hidden="true" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col text-left">
        <span className="retro text-[10px] font-bold tracking-wider text-amber-300">
          WRITE ACCESS REQUIRED
        </span>
        <span className="retro text-[9px] text-sky-100/80 leading-tight">
          {displayMessage}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-2">
        <a
          href="https://github.com/settings/installations"
          target="_blank"
          rel="noreferrer"
          className="retro inline-flex items-center gap-1 border border-sky-400/50 bg-sky-500/20 px-2.5 py-1 text-[9px] text-sky-200 hover:border-sky-300 hover:bg-sky-500/30 hover:text-white transition-colors"
        >
          <span>MANAGE ACCESS</span>
          <ExternalLink className="size-2.5" aria-hidden="true" />
        </a>
        <button
          type="button"
          onClick={onDismiss}
          className="flex size-5 items-center justify-center text-slate-400 hover:text-white transition-colors"
          aria-label="Dismiss write access notice"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
