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
  onOpenChange: (open: boolean) => void;
}

/**
 * Shown when a visitor reaches for something the demo city does not do.
 * Explaining what they were reaching for beats a disabled control: the demo
 * exists to sell the product, so the moment someone tries to use it is the
 * moment to offer an account, not to grey the button out.
 */
export default function SignInDialog({
  action,
  onOpenChange,
}: SignInDialogProps) {
  return (
    <Dialog open={Boolean(action)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-4 border-foreground bg-card p-0 shadow-none sm:rounded-none dark:border-ring">
        <div className="border-b-4 border-foreground bg-primary/10 px-5 py-4 dark:border-ring">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="retro text-sm text-primary">
              Sign in to {action}
            </DialogTitle>
            <DialogDescription className="retro text-[9px] leading-relaxed text-muted-foreground">
              The demo city is a tour: you can walk it, but the crew only takes
              orders in a repository of your own.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex flex-col gap-3 px-5 py-5">
          <a href={githubStartUrl()} className="block">
            <HudButton type="button" className="w-full" size="md">
              LOGIN WITH GITHUB
            </HudButton>
          </a>
          <p className="retro text-center text-[8px] leading-relaxed text-muted-foreground">
            You'll pick exactly which repositories to share on GitHub's own
            screen -- nothing is granted beyond what you tick.
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
