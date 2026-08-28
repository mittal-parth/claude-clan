import { githubStartUrl } from "@/auth/api";
import HudButton from "@/components/hud/HudButton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import "@/components/ui/8bit/styles/retro.css";

export interface SignInDialogProps {
  /** The action the visitor just tried, e.g. "dispatch a crew". */
  action?: string;
  isAuthenticated?: boolean;
  onPickRepo?: () => void;
  onOpenChange: (open: boolean) => void;
}

export function getSignInDialogContent({
  action,
  isAuthenticated,
}: {
  action?: string;
  isAuthenticated?: boolean;
}) {
  return {
    title: isAuthenticated
      ? "You can only dispatch orders in your repos"
      : `Sign in to ${action ?? "dispatch a crew"}`,
    description:
      "The demo city is a tour: you can walk it, but the crew only takes orders in a repository of your own.",
    buttonLabel: isAuthenticated ? "PICK REPO" : "LOGIN WITH GITHUB",
    helperText: isAuthenticated
      ? "Switch to an imported repository or connect a new one to dispatch a crew."
      : "You'll pick exactly which repositories to share on GitHub's own screen -- nothing is granted beyond what you tick.",
  };
}

/**
 * Shown when a visitor reaches for something the demo city does not do.
 * Explaining what they were reaching for beats a disabled control: the demo
 * exists to sell the product, so the moment someone tries to use it is the
 * moment to offer an account, not to grey the button out.
 */
export default function SignInDialog({
  action,
  isAuthenticated,
  onPickRepo,
  onOpenChange,
}: SignInDialogProps) {
  const content = getSignInDialogContent({ action, isAuthenticated });

  return (
    <Dialog open={Boolean(action)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-4 border-foreground bg-card p-0 shadow-none sm:rounded-none dark:border-ring">
        <div className="border-b-4 border-foreground bg-primary/10 px-5 py-4 dark:border-ring">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="retro text-sm text-primary">
              {content.title}
            </DialogTitle>
            <DialogDescription className="retro text-[9px] leading-relaxed text-muted-foreground">
              {content.description}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex flex-col gap-3 px-5 py-5">
          {isAuthenticated ? (
            <HudButton
              type="button"
              className="w-full"
              size="md"
              onClick={() => {
                onOpenChange(false);
                onPickRepo?.();
              }}
            >
              {content.buttonLabel}
            </HudButton>
          ) : (
            <a href={githubStartUrl()} className="block">
              <HudButton type="button" className="w-full" size="md">
                {content.buttonLabel}
              </HudButton>
            </a>
          )}
          <p className="retro text-center text-[8px] leading-relaxed text-muted-foreground">
            {content.helperText}
          </p>
        </div>

        <DialogFooter className="border-t-4 border-foreground px-5 py-4 dark:border-ring">
          <HudButton
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Keep looking around
          </HudButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

