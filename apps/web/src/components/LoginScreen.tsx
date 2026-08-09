import { githubStartUrl } from "@/auth/api";
import HudButton from "@/components/hud/HudButton";
import "@/components/ui/8bit/styles/retro.css";

export interface LoginScreenProps {
  onSeeDemo: () => void;
}

/** The floating login card shown over the already-mounted demo city. */
export default function LoginScreen({ onSeeDemo }: LoginScreenProps) {
  return (
    <div className="login-screen">
      <div className="login-city-overlay" aria-hidden="true" />
      <div className="hud-scanline pointer-events-none absolute inset-0 z-[1]" />

      <div className="login-screen__card relative z-10 w-full max-w-md border-4 border-foreground bg-card/90 p-0 shadow-2xl backdrop-blur-md sm:rounded-none dark:border-ring">
        <div className="border-b-4 border-foreground bg-primary/10 px-6 py-6 text-center dark:border-ring">
          <p className="retro text-lg text-primary">CLAUDE CITY</p>
          <p className="retro mt-2 text-[9px] text-muted-foreground">
            Your repository, rendered as a city an agent can build in.
          </p>
        </div>

        <div className="flex flex-col gap-4 px-6 py-6">
          <a href={githubStartUrl()} className="block">
            <HudButton type="button" className="w-full" size="md">
              LOGIN WITH GITHUB
            </HudButton>
          </a>
          <p className="retro text-center text-[8px] leading-relaxed text-muted-foreground">
            You'll pick exactly which repositories to share on GitHub's own
            screen -- nothing is granted beyond what you tick.
          </p>

          <div className="my-1 flex items-center gap-3">
            <span className="h-px flex-1 bg-foreground/30" />
            <span className="retro text-[8px] text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-foreground/30" />
          </div>

          <HudButton
            type="button"
            variant="ghost"
            className="w-full"
            onClick={onSeeDemo}
          >
            SEE THE DEMO CITY
          </HudButton>
          <p className="retro text-center text-[8px] text-muted-foreground">
            No sign-in needed -- explore Claude City's own repository.
          </p>
        </div>
      </div>
    </div>
  );
}
