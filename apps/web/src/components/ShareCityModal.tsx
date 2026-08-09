import { useState, useEffect } from "react";
import {
  X,
  Copy,
  Download,
  Check,
  Share2,
  Image as ImageIcon,
  ExternalLink,
} from "lucide-react";
import { HudButton } from "@/components/hud/HudButton";
import "@/components/ui/8bit/styles/retro.css";

export interface ShareCityModalProps {
  isOpen: boolean;
  onClose: () => void;
  screenshotUrl: string | null;
  activeRepoKey: string;
}

export function ShareCityModal({
  isOpen,
  onClose,
  screenshotUrl,
  activeRepoKey,
}: ShareCityModalProps) {
  const repoDisplayName =
    activeRepoKey && activeRepoKey !== "demo"
      ? activeRepoKey
      : "my codebase";

  const defaultCaption = `I turned my repo ${repoDisplayName} into a city! \n\nTry yours at https://playclaude.vercel.app`;

  const [caption, setCaption] = useState(defaultCaption);
  const [copiedCaption, setCopiedCaption] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    setCaption(
      `I turned my repo ${repoDisplayName} into a city! \n\nTry yours at https://playclaude.vercel.app`
    );
  }, [repoDisplayName]);

  if (!isOpen) return null;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  const handleCopyCaption = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      setCopiedCaption(true);
      showToast("Caption copied to clipboard");
      setTimeout(() => setCopiedCaption(false), 2000);
    } catch {
      showToast("Failed to copy caption");
    }
  };

  const handleDownloadImage = () => {
    if (!screenshotUrl) return;
    const link = document.createElement("a");
    link.href = screenshotUrl;
    const sanitizedRepoName = repoDisplayName.replace(/[/\\?%*:|"<>]/g, "-");
    link.download = `playclaude-city-${sanitizedRepoName}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("City map image downloaded");
  };

  const handleCopyImage = async () => {
    if (!screenshotUrl) return;
    try {
      const response = await fetch(screenshotUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type || "image/png"]: blob }),
      ]);
      setCopiedImage(true);
      showToast("Map image copied to clipboard");
      setTimeout(() => setCopiedImage(false), 2000);
    } catch {
      handleDownloadImage();
      showToast("Image downloaded");
    }
  };

  const shareToPlatform = async (intentUrl: string | null, platformName: string) => {
    if (!screenshotUrl) return;

    // Directly fallback to copying the image to clipboard and opening the URL,
    // since we cannot pass local blobs directly to Twitter/LinkedIn via URL redirect.
    let imageCopied = false;
    try {
      const response = await fetch(screenshotUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type || "image/png"]: blob }),
      ]);
      imageCopied = true;
    } catch {
      // If clipboard fails, download it
      handleDownloadImage();
    }

    const targetUrl = intentUrl || "https://instagram.com/";
    
    // Open the new tab immediately to bypass popup blockers
    const newWindow = window.open("about:blank", "_blank");
    if (newWindow) {
      newWindow.document.write(`
        <html>
          <body style='background:#040d13;color:#8cc8ff;font-family:monospace;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;'>
            <img src='${screenshotUrl}' style='max-height:40vh;max-width:80vw;border:2px solid #1b3445;margin-bottom:24px;border-radius:4px;' alt='Copied screenshot' />
            <h2 style='color:#fde047;margin:0 0 8px 0;'>Image copied!</h2>
            <p style='margin:0;opacity:0.8;'>Paste (Ctrl+V or Cmd+V) to attach the image to your post.</p>
          </body>
        </html>
      `);
    }

    showToast(
      imageCopied
        ? `Image copied! Paste (Ctrl+V) on ${platformName}`
        : `Image downloaded. Attach it to ${platformName}`
    );

    // Wait 1 second so user reads the toast, then redirect the tab
    setTimeout(() => {
      if (newWindow) {
        newWindow.location.href = targetUrl;
      } else {
        // Fallback if popup blocker prevented the empty tab (very rare)
        window.location.href = targetUrl;
      }
    }, 1000);
  };

  const shareToX = () => {
    const text = encodeURIComponent(caption);
    shareToPlatform(`https://twitter.com/intent/tweet?text=${text}`, "𝕏");
  };

  const shareToInstaPost = () => {
    shareToPlatform(null, "Instagram Post");
  };

  const shareToInstaStory = () => {
    shareToPlatform(null, "Instagram Story");
  };

  const shareToLinkedin = () => {
    const url = encodeURIComponent("https://playclaude.vercel.app");
    shareToPlatform(
      `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
      "LinkedIn"
    );
  };

  const shareToReddit = () => {
    const title = encodeURIComponent(
      `Check out my 3D repo city ${repoDisplayName} on PlayClaude!`
    );
    const url = encodeURIComponent("https://playclaude.vercel.app");
    shareToPlatform(
      `https://www.reddit.com/submit?title=${title}&url=${url}`,
      "Reddit"
    );
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#040d13]/85 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      {/* HUD Window Container */}
      <section className="hud-window relative w-full max-w-2xl overflow-hidden bg-[#081923] text-white shadow-2xl border border-[#243d4d]">
        <span aria-hidden="true" className="hud-window__frame" />

        {/* Toast Alert Banner */}
        {toastMessage ? (
          <div className="absolute top-12 left-1/2 z-50 -translate-x-1/2 rounded border border-amber-400/50 bg-[#081923] px-3 py-1 text-center text-xs text-amber-200 shadow-md">
            <span className="retro text-[10px]">{toastMessage}</span>
          </div>
        ) : null}

        {/* HUD Window Title Bar */}
        <header className="hud-window__bar">
          <span aria-hidden="true" className="hud-window__tick" />
          <h2 className="hud-window__title retro text-amber-200">
            Share city map
          </h2>
          <span aria-hidden="true" className="hud-window__leader" />
          <span className="hud-pill hud-pill--muted retro text-[9px]">
            {repoDisplayName}
          </span>
          <button
            type="button"
            className="hud-icon-button ml-2"
            aria-label="Close share window"
            title="Close"
            onClick={onClose}
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </header>

        {/* Main Content Body */}
        <div className="p-4 space-y-4 max-h-[82vh] overflow-y-auto bg-[#081923]">
          {/* Map Screenshot Frame */}
          <div className="relative overflow-hidden border border-[#1b3445] bg-[#03090d]">
            {screenshotUrl ? (
              <div className="relative flex items-center justify-center p-2 min-h-[200px]">
                <img
                  src={screenshotUrl}
                  alt={`Centered 3D City Map Snapshot for ${repoDisplayName}`}
                  className="max-h-[320px] w-auto max-w-full object-contain"
                />

                {/* Retro Watermark Badge */}
                <div className="absolute bottom-2 right-2 border border-[#243d4d] bg-[#081923]/90 px-2 py-0.5">
                  <span className="retro text-[8px] text-amber-300">
                    playclaude.vercel.app
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex h-48 items-center justify-center retro text-xs text-sky-100/60">
                Framing island & rendering map…
              </div>
            )}
          </div>

          {/* Screenshot Action Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1b3445] pb-3">
            <span className="retro text-[9px] text-sky-100/70">
              ISLAND MAP · FULL VIEW
            </span>

            <div className="flex items-center gap-2">
              <HudButton
                type="button"
                size="sm"
                variant="outline"
                onClick={handleCopyImage}
              >
                {copiedImage ? (
                  <Check className="mr-1 size-3 text-green-400" />
                ) : (
                  <ImageIcon className="mr-1 size-3" />
                )}
                <span className="retro text-[9px]">
                  {copiedImage ? "COPIED IMAGE" : "COPY IMAGE"}
                </span>
              </HudButton>

              <HudButton
                type="button"
                size="sm"
                variant="primary"
                onClick={handleDownloadImage}
              >
                <Download className="mr-1 size-3" />
                <span className="retro text-[9px]">DOWNLOAD PNG</span>
              </HudButton>
            </div>
          </div>

          {/* Caption Text Area */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="retro text-[9px] text-amber-200">
                CAPTION
              </label>
              <button
                type="button"
                onClick={handleCopyCaption}
                className="retro text-[9px] text-sky-300 hover:text-white flex items-center gap-1 transition-colors"
              >
                {copiedCaption ? (
                  <Check className="size-3 text-green-400" />
                ) : (
                  <Copy className="size-3" />
                )}
                {copiedCaption ? "COPIED" : "COPY CAPTION"}
              </button>
            </div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={4}
              className="retro block w-full border border-[#1b3445] bg-[#03090d] p-2 text-[11px] text-sky-100 placeholder-sky-100/30 focus:border-amber-400 focus:outline-none resize-y min-h-[80px]"
            />
          </div>

          {/* Social Platform Buttons */}
          <div className="space-y-1.5 pt-1">
            <span className="retro block text-[9px] text-sky-100/70">
              SHARE TO SOCIAL PLATFORMS
            </span>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {/* X / Twitter */}
              <button
                type="button"
                onClick={shareToX}
                className="retro flex items-center justify-center gap-2 border border-[#1b3445] bg-[#0b1c28] px-3 py-2 text-[10px] text-sky-100 hover:border-amber-400 hover:bg-[#122e40] hover:text-amber-200 transition-colors"
              >
                <svg className="size-3 fill-current" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                Post
              </button>

              {/* Instagram Post */}
              <button
                type="button"
                onClick={shareToInstaPost}
                className="retro flex items-center justify-center gap-2 border border-[#1b3445] bg-[#0b1c28] px-3 py-2 text-[10px] text-sky-100 hover:border-amber-400 hover:bg-[#122e40] hover:text-amber-200 transition-colors"
              >
                <svg className="size-3 fill-current" viewBox="0 0 24 24">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                </svg>
                Insta Post
              </button>

              {/* Instagram Story */}
              <button
                type="button"
                onClick={shareToInstaStory}
                className="retro flex items-center justify-center gap-2 border border-[#1b3445] bg-[#0b1c28] px-3 py-2 text-[10px] text-sky-100 hover:border-amber-400 hover:bg-[#122e40] hover:text-amber-200 transition-colors"
              >
                <Share2 className="size-3 text-sky-300" />
                Insta Story
              </button>

              {/* LinkedIn */}
              <button
                type="button"
                onClick={shareToLinkedin}
                className="retro flex items-center justify-center gap-2 border border-[#1b3445] bg-[#0b1c28] px-3 py-2 text-[10px] text-sky-100 hover:border-amber-400 hover:bg-[#122e40] hover:text-amber-200 transition-colors"
              >
                <svg className="size-3 fill-current" viewBox="0 0 24 24">
                  <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                </svg>
                LinkedIn
              </button>

              {/* Reddit */}
              <button
                type="button"
                onClick={shareToReddit}
                className="retro flex items-center justify-center gap-2 border border-[#1b3445] bg-[#0b1c28] px-3 py-2 text-[10px] text-sky-100 hover:border-amber-400 hover:bg-[#122e40] hover:text-amber-200 transition-colors"
              >
                <svg className="size-3 fill-current" viewBox="0 0 24 24">
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.168 24 1.805 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.188-.491.933 0 1.69.756 1.69 1.689 0 .656-.37 1.221-.92 1.503.024.2.036.404.036.61 0 3.102-3.6 5.617-8.04 5.617-4.44 0-8.04-2.515-8.04-5.617 0-.203.013-.404.035-.604-.556-.282-.93-.85-.93-1.509 0-.933.757-1.689 1.69-1.689.462 0 .886.184 1.196.496 1.19-.85 2.836-1.41 4.65-1.487l.9-4.218 3.2.674a1.23 1.23 0 0 1 1.249-1.249z" />
                </svg>
                Reddit
              </button>

              {/* Copy Link */}
              <button
                type="button"
                onClick={handleCopyCaption}
                className="retro flex items-center justify-center gap-2 border border-[#1b3445] bg-[#0b1c28] px-3 py-2 text-[10px] text-sky-100 hover:border-amber-400 hover:bg-[#122e40] hover:text-amber-200 transition-colors"
              >
                <ExternalLink className="size-3 text-sky-300" />
                Copy Link
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default ShareCityModal;
