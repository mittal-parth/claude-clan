import { useState, useEffect } from "react";
import {
  X,
  Copy,
  Download,
  Check,
  Sparkles,
  Share2,
  Image as ImageIcon,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
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

  const defaultCaption = `Check out my repo city ${repoDisplayName} on playclaude 🏙️! Try yours at https://playclaude.vercel.app/`;

  const [caption, setCaption] = useState(defaultCaption);
  const [copiedCaption, setCopiedCaption] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    setCaption(
      `Check out my repo city ${repoDisplayName} on playclaude 🏙️! Try yours at https://playclaude.vercel.app/`
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
      showToast("Caption copied to clipboard!");
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
    showToast("City map image downloaded!");
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
      showToast("Map image copied to clipboard!");
      setTimeout(() => setCopiedImage(false), 2000);
    } catch {
      handleDownloadImage();
      showToast("Image downloaded! (Direct copy unsupported by browser)");
    }
  };

  // Social sharing handlers
  const shareToX = () => {
    const text = encodeURIComponent(caption);
    window.open(`https://twitter.com/intent/tweet?text=${text}`, "_blank");
    showToast("Opened X (Twitter) post prompt!");
  };

  const shareToInstaPost = async () => {
    await handleCopyImage();
    await navigator.clipboard.writeText(caption);
    handleDownloadImage();
    showToast("Image downloaded & caption copied! Ready for Instagram Post 📸");
  };

  const shareToInstaStory = async () => {
    await handleCopyImage();
    await navigator.clipboard.writeText(caption);
    handleDownloadImage();
    showToast("Story image downloaded & caption copied! Ready for Instagram Story 📱");
  };

  const shareToLinkedin = async () => {
    await navigator.clipboard.writeText(caption);
    window.open(
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
        "https://playclaude.vercel.app/"
      )}`,
      "_blank"
    );
    showToast("Caption copied & LinkedIn opened!");
  };

  const shareToReddit = () => {
    const title = encodeURIComponent(
      `Check out my 3D repo city ${repoDisplayName} on PlayClaude!`
    );
    const url = encodeURIComponent("https://playclaude.vercel.app/");
    window.open(
      `https://www.reddit.com/submit?title=${title}&url=${url}`,
      "_blank"
    );
    showToast("Opened Reddit post prompt!");
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-200">
      {/* Modal Dialog Container */}
      <div className="relative w-full max-w-2xl overflow-hidden rounded-xl border border-sky-400/30 bg-[#081923]/95 text-white shadow-2xl transition-all">
        {/* Decorative Top Accent Line */}
        <div className="h-1 w-full bg-gradient-to-r from-amber-400 via-sky-400 to-indigo-500" />

        {/* Toast Alert Banner */}
        {toastMessage ? (
          <div className="absolute top-3 left-1/2 z-50 -translate-x-1/2 rounded-full border border-sky-400/40 bg-sky-950/90 px-4 py-1.5 text-center text-xs text-sky-200 shadow-lg backdrop-blur-sm animate-in fade-in slide-in-from-top-2">
            <span className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-amber-300 animate-spin" />
              {toastMessage}
            </span>
          </div>
        ) : null}

        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg border border-amber-400/40 bg-amber-400/10 text-amber-300">
              <Share2 className="size-4" />
            </div>
            <div>
              <h3 className="retro text-sm text-amber-200">
                SHARE REPO CITY
              </h3>
              <p className="text-[11px] text-sky-100/60">
                Showcase your 3D codebase world to your friends & community
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:border-white/30 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Close modal"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Main Content Body */}
        <div className="p-5 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Screenshot Preview Card */}
          <div className="relative group overflow-hidden rounded-lg border border-sky-400/30 bg-black/60 shadow-inner">
            {screenshotUrl ? (
              <div className="relative flex items-center justify-center bg-black/40 min-h-[220px]">
                <img
                  src={screenshotUrl}
                  alt={`3D City Map Screenshot for ${repoDisplayName}`}
                  className="max-h-[340px] w-auto max-w-full object-contain rounded"
                />

                {/* Subtle Watermark Tag */}
                <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 rounded border border-white/20 bg-black/75 px-2 py-1 backdrop-blur-sm">
                  <span className="retro text-[9px] text-amber-300">
                    🏙️ playclaude.vercel.app
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex h-48 items-center justify-center text-sm text-gray-400">
                Capturing city map snapshot…
              </div>
            )}
          </div>

          {/* Quick Actions Bar (Download & Copy Image) */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-4">
            <span className="retro text-[10px] text-sky-200/70">
              REPO: <span className="text-white font-mono">{repoDisplayName}</span>
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyImage}
                className="retro inline-flex items-center gap-1.5 rounded border border-sky-400/40 bg-sky-950/40 px-3 py-1.5 text-[10px] text-sky-200 hover:bg-sky-900/60 hover:text-white transition-all"
              >
                {copiedImage ? (
                  <Check className="size-3 text-green-400" />
                ) : (
                  <ImageIcon className="size-3 text-sky-400" />
                )}
                {copiedImage ? "Copied Image!" : "Copy Image"}
              </button>

              <button
                type="button"
                onClick={handleDownloadImage}
                className="retro inline-flex items-center gap-1.5 rounded border border-amber-400/40 bg-amber-950/40 px-3 py-1.5 text-[10px] text-amber-200 hover:bg-amber-900/60 hover:text-white transition-all"
              >
                <Download className="size-3 text-amber-400" />
                Download PNG
              </button>
            </div>
          </div>

          {/* Caption Box */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="retro text-[10px] text-amber-200/90">
                CAPTION / MESSAGE
              </label>
              <button
                type="button"
                onClick={handleCopyCaption}
                className="flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-200 transition-colors"
              >
                {copiedCaption ? (
                  <Check className="size-3 text-green-400" />
                ) : (
                  <Copy className="size-3" />
                )}
                {copiedCaption ? "Copied!" : "Copy Caption"}
              </button>
            </div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-white/15 bg-black/50 p-3 text-xs text-sky-100 placeholder-white/30 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400/50 transition-all"
            />
          </div>

          {/* Social Platform Post Buttons */}
          <div className="space-y-2 pt-1">
            <span className="retro block text-[10px] text-sky-200/80">
              POST DIRECTLY TO SOCIAL MEDIA
            </span>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {/* X / Twitter */}
              <button
                type="button"
                onClick={shareToX}
                className="flex items-center justify-center gap-2 rounded-lg border border-white/20 bg-black/60 px-3 py-2 text-xs font-medium text-white hover:border-sky-400 hover:bg-black/90 transition-all hover:scale-[1.02]"
              >
                <svg className="size-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                𝕏 Post
              </button>

              {/* Instagram Post */}
              <button
                type="button"
                onClick={shareToInstaPost}
                className="flex items-center justify-center gap-2 rounded-lg border border-pink-500/40 bg-gradient-to-r from-purple-900/40 via-pink-900/40 to-amber-900/40 px-3 py-2 text-xs font-medium text-pink-200 hover:border-pink-400 hover:text-white transition-all hover:scale-[1.02]"
              >
                <svg className="size-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                </svg>
                Insta Post
              </button>

              {/* Instagram Story */}
              <button
                type="button"
                onClick={shareToInstaStory}
                className="flex items-center justify-center gap-2 rounded-lg border border-purple-500/40 bg-gradient-to-r from-pink-900/40 via-purple-900/40 to-indigo-900/40 px-3 py-2 text-xs font-medium text-purple-200 hover:border-purple-400 hover:text-white transition-all hover:scale-[1.02]"
              >
                <Sparkles className="size-3.5 text-pink-400" />
                Insta Story
              </button>

              {/* LinkedIn */}
              <button
                type="button"
                onClick={shareToLinkedin}
                className="flex items-center justify-center gap-2 rounded-lg border border-blue-500/40 bg-blue-950/50 px-3 py-2 text-xs font-medium text-blue-200 hover:border-blue-400 hover:bg-blue-900/80 hover:text-white transition-all hover:scale-[1.02]"
              >
                <svg className="size-3.5 fill-current text-blue-400" viewBox="0 0 24 24">
                  <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                </svg>
                LinkedIn
              </button>

              {/* Reddit */}
              <button
                type="button"
                onClick={shareToReddit}
                className="flex items-center justify-center gap-2 rounded-lg border border-orange-500/40 bg-orange-950/50 px-3 py-2 text-xs font-medium text-orange-200 hover:border-orange-400 hover:bg-orange-900/80 hover:text-white transition-all hover:scale-[1.02]"
              >
                <svg className="size-3.5 fill-current text-orange-500" viewBox="0 0 24 24">
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.168 24 1.805 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.188-.491.933 0 1.69.756 1.69 1.689 0 .656-.37 1.221-.92 1.503.024.2.036.404.036.61 0 3.102-3.6 5.617-8.04 5.617-4.44 0-8.04-2.515-8.04-5.617 0-.203.013-.404.035-.604-.556-.282-.93-.85-.93-1.509 0-.933.757-1.689 1.69-1.689.462 0 .886.184 1.196.496 1.19-.85 2.836-1.41 4.65-1.487l.9-4.218 3.2.674a1.23 1.23 0 0 1 1.249-1.249z" />
                </svg>
                Reddit
              </button>

              {/* Direct Link Share */}
              <button
                type="button"
                onClick={handleCopyCaption}
                className="flex items-center justify-center gap-2 rounded-lg border border-sky-500/40 bg-sky-950/50 px-3 py-2 text-xs font-medium text-sky-200 hover:border-sky-400 hover:bg-sky-900/80 hover:text-white transition-all hover:scale-[1.02]"
              >
                <ExternalLink className="size-3.5 text-sky-400" />
                Copy Link
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ShareCityModal;
