import type { RepoSummary } from "@sudo-city/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import App from "./App";
import { fetchRepos, fetchSession, importRepo, logout } from "@/auth/api";
import {
  clearStoredActiveRepo,
  gateFor,
  readSessionFromHash,
  readStoredActiveRepo,
  readStoredToken,
  writeStoredActiveRepo,
  writeStoredToken,
  type AuthSession,
} from "@/auth/gate";
import LoginScreen from "@/components/LoginScreen";
import RepoPicker from "@/components/RepoPicker";
import type { CanvasAirportTravel } from "@/components/GameCanvas";

const DEMO_REPO_KEY = "demo";
type DemoTransition = "idle" | "loading" | "revealing";

/** Owns login, repository selection, and the cross-repository airport journey. */
export default function Root() {
  const [token, setToken] = useState<string | undefined>(() => readStoredToken());
  const [session, setSession] = useState<AuthSession>({ authenticated: false });
  const [sessionChecked, setSessionChecked] = useState(false);
  const [activeRepoKey, setActiveRepoKey] = useState<string>();
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string>();
  const [importing, setImporting] = useState<{ repoKey: string; startedAt: number }>();
  const [airportOpen, setAirportOpen] = useState(false);
  const [airportTravel, setAirportTravel] = useState<CanvasAirportTravel>();
  const [airportArrival, setAirportArrival] = useState<CanvasAirportTravel>();
  const [repoConnectionGeneration, setRepoConnectionGeneration] = useState(0);
  const [demoTransition, setDemoTransition] = useState<DemoTransition>("idle");

  const activeRepoRef = useRef(activeRepoKey);
  const airportTravelRef = useRef(airportTravel);
  const airportArrivalRef = useRef(airportArrival);
  const importingRef = useRef(importing);
  const importRequestRef = useRef(0);
  const authEpochRef = useRef(1);
  const repoLoadRequestRef = useRef(0);
  const repoLoadInFlightRef = useRef<number | undefined>(undefined);
  activeRepoRef.current = activeRepoKey;
  airportTravelRef.current = airportTravel;
  airportArrivalRef.current = airportArrival;
  importingRef.current = importing;

  function restoreActiveRepoForSession(
    nextSession: AuthSession,
    clearInvalid = true,
  ): void {
    const stored = readStoredActiveRepo();
    const restoredRepoKey =
      stored?.repoKey === DEMO_REPO_KEY
        ? DEMO_REPO_KEY
        : nextSession.authenticated &&
            stored?.userId === nextSession.user.id
          ? stored.repoKey
          : undefined;

    if (stored && !restoredRepoKey && clearInvalid) {
      clearStoredActiveRepo();
    }
    setActiveRepoKey(restoredRepoKey);
  }

  useEffect(() => {
    const { token: hashToken, error } = readSessionFromHash(window.location.hash);
    if (hashToken) {
      writeStoredToken(hashToken);
      setToken(hashToken);
    }
    if (hashToken || error) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchSession(token)
      .then((result) => {
        if (!cancelled) {
          const nextSession: AuthSession =
            result.authenticated && result.user
              ? { authenticated: true, user: result.user }
              : { authenticated: false };
          setSession(nextSession);
          restoreActiveRepoForSession(nextSession);
        }
      })
      .catch(() => {
        if (!cancelled) {
          const nextSession: AuthSession = { authenticated: false };
          setSession(nextSession);
          restoreActiveRepoForSession(nextSession, false);
        }
      })
      .finally(() => {
        if (!cancelled) setSessionChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const loadRepos = useCallback(() => {
    if (!token || repoLoadInFlightRef.current !== undefined) return;
    const requestId = ++repoLoadRequestRef.current;
    const authEpoch = authEpochRef.current;
    repoLoadInFlightRef.current = requestId;
    const current = (): boolean =>
      requestId === repoLoadRequestRef.current && authEpoch === authEpochRef.current;
    setReposLoading(true);
    setReposError(undefined);
    fetchRepos(token)
      .then((nextRepos) => {
        if (current()) setRepos(nextRepos);
      })
      .catch((error: unknown) => {
        if (current()) {
          setReposError(error instanceof Error ? error.message : "Failed to load repositories");
        }
      })
      .finally(() => {
        if (repoLoadInFlightRef.current === requestId) {
          repoLoadInFlightRef.current = undefined;
        }
        if (current()) setReposLoading(false);
      });
  }, [token]);

  useEffect(() => {
    if (!activeRepoKey) return;
    if (activeRepoKey === DEMO_REPO_KEY) {
      writeStoredActiveRepo(DEMO_REPO_KEY);
    } else if (session.authenticated) {
      writeStoredActiveRepo(activeRepoKey, session.user.id);
    }
  }, [activeRepoKey, session]);

  useEffect(() => {
    if (session.authenticated) loadRepos();
  }, [session.authenticated, loadRepos]);

  function startDemo(): void {
    setDemoTransition("loading");
    setActiveRepoKey(DEMO_REPO_KEY);
  }

  function handleInitialRevealReady(): void {
    setDemoTransition((current) =>
      current === "loading" ? "revealing" : current,
    );
  }

  function handleInitialRevealComplete(): void {
    setDemoTransition("idle");
  }

  function handleSignIn(): void {
    clearStoredActiveRepo();
    setDemoTransition("idle");
    setActiveRepoKey(undefined);
  }

  function beginAirportJourney(destinationKey: string): void {
    const sourceKey = activeRepoRef.current;
    if (!sourceKey) {
      activeRepoRef.current = destinationKey;
      setActiveRepoKey(destinationKey);
      return;
    }
    if (
      destinationKey === sourceKey ||
      airportTravelRef.current ||
      airportArrivalRef.current
    ) {
      setAirportOpen(false);
      return;
    }

    const travel: CanvasAirportTravel = {
      id: `${sourceKey}:${destinationKey}:${Date.now()}`,
      sourceKey,
      destinationKey,
    };
    airportTravelRef.current = travel;
    setAirportOpen(false);
    setAirportTravel(travel);
  }

  function handleImportOrSelect(repo: RepoSummary): void {
    if (airportTravelRef.current || airportArrivalRef.current || importingRef.current) return;
    if (repo.imported) {
      beginAirportJourney(repo.key);
      return;
    }
    if (!token) return;

    const requestId = ++importRequestRef.current;
    const pending = { repoKey: repo.key, startedAt: Date.now() };
    importingRef.current = pending;
    setImporting(pending);
    setReposError(undefined);

    const authEpoch = authEpochRef.current;
    const importIsCurrent = (): boolean =>
      requestId === importRequestRef.current && authEpoch === authEpochRef.current;
    importRepo(token, repo.fullName)
      .then(() => {
        if (!importIsCurrent()) return;
        repoLoadRequestRef.current += 1;
        repoLoadInFlightRef.current = undefined;
        importingRef.current = undefined;
        setImporting(undefined);
        setRepos((current) =>
          current.map((entry) =>
            entry.key === repo.key ? { ...entry, imported: true } : entry,
          ),
        );
        beginAirportJourney(repo.key);
      })
      .catch((error: unknown) => {
        if (!importIsCurrent()) return;
        importingRef.current = undefined;
        setImporting(undefined);
        setReposError(error instanceof Error ? error.message : "Import failed");
      });
  }

  function handleLogout(): void {
    authEpochRef.current += 1;
    importRequestRef.current += 1;
    repoLoadRequestRef.current += 1;
    repoLoadInFlightRef.current = undefined;
    airportTravelRef.current = undefined;
    airportArrivalRef.current = undefined;
    importingRef.current = undefined;
    void logout(token);
    writeStoredToken(undefined);
    clearStoredActiveRepo();
    setToken(undefined);
    setSession({ authenticated: false });
    setDemoTransition("idle");
    setActiveRepoKey(undefined);
    setRepos([]);
    setImporting(undefined);
    setAirportOpen(false);
    setAirportTravel(undefined);
    setAirportArrival(undefined);
  }

  if (!sessionChecked) return null;

  const gate = gateFor(session, activeRepoKey);
  if (gate === "repos") {
    return (
      <RepoPicker
        repos={repos}
        loading={reposLoading}
        error={reposError}
        importing={importing}
        onImportOrSelect={handleImportOrSelect}
        onSeeDemo={() => setActiveRepoKey(DEMO_REPO_KEY)}
        onRefresh={loadRepos}
      />
    );
  }

  const demoIsTransitioning =
    activeRepoKey === DEMO_REPO_KEY && demoTransition !== "idle";
  const showLogin = gate === "login" || demoIsTransitioning;

  return (
    <div className="root-stage">
      {gate === "login" || gate === "city" ? (
        <App
          activeRepoKey={gate === "login" ? DEMO_REPO_KEY : activeRepoKey!}
          sessionToken={session.authenticated ? token : undefined}
          user={session.authenticated ? session.user : undefined}
          repoConnectionGeneration={repoConnectionGeneration}
          loginBackground={gate === "login"}
          initialReveal={demoIsTransitioning}
          onInitialRevealReady={handleInitialRevealReady}
          onInitialRevealComplete={handleInitialRevealComplete}
          airportTravel={airportTravel}
          airportArrival={airportArrival}
          onOpenAirport={() => {
            if (airportTravelRef.current || airportArrivalRef.current) return;
            loadRepos();
            setAirportOpen(true);
          }}
          onAirportTravelCovered={(travel) => {
            if (airportTravelRef.current?.id !== travel.id) return;
            airportTravelRef.current = undefined;
            airportArrivalRef.current = travel;
            activeRepoRef.current = travel.destinationKey;
            setAirportTravel(undefined);
            setAirportArrival(travel);
            setActiveRepoKey(travel.destinationKey);
          }}
          onAirportArrivalComplete={(travel) => {
            if (airportArrivalRef.current?.id !== travel.id) return;
            airportArrivalRef.current = undefined;
            setAirportArrival(undefined);
          }}
          onRetryAirportArrival={(travel) => {
            if (airportArrivalRef.current?.id !== travel.id) return;
            setRepoConnectionGeneration((generation) => generation + 1);
          }}
          onLogout={handleLogout}
          onSignIn={handleSignIn}
        />
      ) : null}

      {showLogin ? (
        <div
          className={`login-transition-cover${
            demoTransition === "revealing"
              ? " login-transition-cover--exiting"
              : ""
          }`}
        >
          <LoginScreen onSeeDemo={startDemo} />
        </div>
      ) : null}

      {gate === "city" ? (
        session.authenticated ? (
          <RepoPicker
            repos={repos}
            loading={reposLoading}
            error={reposError}
            importing={importing}
            onImportOrSelect={handleImportOrSelect}
            onSeeDemo={() => beginAirportJourney(DEMO_REPO_KEY)}
            onRefresh={loadRepos}
            activeRepoKey={activeRepoKey}
            dialog={{ open: airportOpen, onOpenChange: setAirportOpen }}
          />
        ) : (
          <RepoPicker
            repos={[]}
            loading={false}
            onImportOrSelect={() => undefined}
            onSeeDemo={() => setAirportOpen(false)}
            onRefresh={() => undefined}
            activeRepoKey={activeRepoKey}
            authenticationRequired
            onSignIn={() => {
              setAirportOpen(false);
              handleSignIn();
            }}
            dialog={{ open: airportOpen, onOpenChange: setAirportOpen }}
          />
        )
      ) : null}
    </div>
  );
}
