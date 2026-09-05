import { githubStartUrl } from "@/auth/api";
import { trackLoginStarted, trackDemoStarted } from "@/lib/analytics";
import "@/components/ui/8bit/styles/retro.css";
import { crewSpriteUrl, getCrewMember } from "@/crew/catalog";

export interface LoginScreenProps {
  onSeeDemo: () => void;
}

const GREETER = getCrewMember("opus");

/**
 * The floating login gate shown over the already-mounted demo city.
 *
 * Framed as an NPC dialogue box -- the Architect (the same "opus" crew
 * portrait used inside the game, via `crewSpriteUrl`) greets the mayor and
 * offers the two ways in as dialogue choices, rather than a generic form
 * card dropped on top of the skyline.
 */
export default function LoginScreen({ onSeeDemo }: LoginScreenProps) {
  return (
    <div className="login-screen">
      <div className="login-city-overlay" aria-hidden="true" />
      <div className="hud-scanline pointer-events-none absolute inset-0 z-[1]" />

      <div className="login-screen__stage relative z-10 flex w-full max-w-2xl items-end gap-3">
        <img
          src={crewSpriteUrl("opus", "medium")}
          alt=""
          aria-hidden="true"
          className="login-screen__speaker"
        />

        <div className="login-screen__dialogue">
          <span className="login-screen__nameplate retro">
            {GREETER.name.toUpperCase()}
          </span>

          <div className="login-screen__dialogue-frame">
            <div className="login-screen__dialogue-corners" aria-hidden="true" />
            <p className="login-screen__dialogue-title retro">
              Welcome, Mayor!
            </p>
            <p className="login-screen__dialogue-text retro">
              Claude City turns your repository into a place an agent can
              build in. Want to walk the demo, or connect your own repo?
            </p>

            <div className="login-screen__choices">
              <a
                href={githubStartUrl()}
                className="login-screen__choice login-screen__choice--primary"
                onClick={() => trackLoginStarted()}
              >
                <span className="login-screen__choice-cursor" aria-hidden="true">
                  &gt;
                </span>
                Connect my GitHub
              </a>

              <button
                type="button"
                className="login-screen__choice"
                onClick={() => {
                  trackDemoStarted();
                  onSeeDemo();
                }}
              >
                <span className="login-screen__choice-cursor" aria-hidden="true">
                  &gt;
                </span>
                See the demo city
              </button>
            </div>

            <p className="login-screen__dialogue-footnote retro">
              GitHub sign-in only shares exactly what you tick -- nothing
              more.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
