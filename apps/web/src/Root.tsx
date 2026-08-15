import type { RepoSummary } from "@sudo-city/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import App from "./App";
import { fetchConfig, fetchRepos, fetchSession, importRepo, logout, type ServerConfig } from "@/auth/api";
import {
  clearStoredActiveRepo,
  gateFor,
  readSessionFromHash,
  readStoredActiveRepo,
  writeStoredActiveRepo,
  type AuthSession,
} from "@/auth/gate";
import LoginScreen from "@/components/LoginScreen";
import RepoPicker from "@/components/RepoPicker";
import type { CanvasAirportTravel } from "@/components/GameCanvas";
import DropSurface from "@/upload/DropSurface";
import { useUnloadGuard } from "@/upload/use-unload-guard";

const DEMO_REPO_KEY = "demo";
type DemoTransition = "idle" | "loading" | "revealing";

/** Owns login, repository selection, and the cross-repository airport journey. */
export default function Root() {
  const [session, setSession] = useState<AuthSession>({ authenticated: false });
  const [sessionChecked, setSessionChecked] = useState(false);
  const [config, setConfig] = useState<ServerConfig>({
    mode: "hosted",
    maxUploadBytes: 150 * 1024 * 1024,
  });
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

  const [dropSurfaceOpen, setDropSurfaceOpen] = useState(false);
  const [isWindowDragActive, setIsWindowDragActive] = useState(false);
  const dragCounterRef = useRef(0);

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

  const isUploadCityActive = activeRepoKey?.startsWith("upload:") ?? false;
  const activeUploadId = isUploadCityActive
    ? activeRepoKey!.slice("upload:".length)
    : undefined;

  const { confirmExit } = useUnloadGuard({
    activeUploadId,
    isUploadCityActive,
    isUploadInFlight: false,
  });

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
    const { error } = readSessionFromHash(window.location.hash);
    if (error) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchSession()
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
        }),
      fetchConfig()
        .then((cfg) => {
          if (!cancelled) setConfig(cfg);
        })
        .catch(() => {}),
    ]).finally(() => {
      if (!cancelled) setSessionChecked(true);
    });

    return () => {
      cancelled = true;
    };
    // Session is httpOnly-cookie-backed now -- there's no client-held token
    // to re-key this on, so it runs once on mount. handleLogout updates
    // `session` locally instead of relying on a re-run here.
  }, []);

  const gate = gateFor(session, activeRepoKey);

  // Whole-window drag and drop handler on login stage
  useEffect(() => {
    if (gate !== "login") return;

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current += 1;
      if (dragCounterRef.current === 1) {
        setIsWindowDragActive(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) {
        setIsWindowDragActive(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
    };
  }, [gate]);

  const loadRepos = useCallback(() => {
    if (!session.authenticated || repoLoadInFlightRef.current !== undefined) return;
    const requestId = ++repoLoadRequestRef.current;
    const authEpoch = authEpochRef.current;
    repoLoadInFlightRef.current = requestId;
    const current = (): boolean =>
      requestId === repoLoadRequestRef.current && authEpoch === authEpochRef.current;
    setReposLoading(true);
    setReposError(undefined);
    fetchRepos()
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
  }, [session.authenticated]);

  useEffect(() => {
    if (!activeRepoKey) return;
    if (activeRepoKey === DEMO_REPO_KEY) {
      writeStoredActiveRepo(DEMO_REPO_KEY);
    } else if (session.authenticated && !activeRepoKey.startsWith("upload:")) {
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
    if (!confirmExit("signing in")) return;
    clearStoredActiveRepo();
    setDemoTransition("idle");
    setActiveRepoKey(undefined);
  }

  function beginAirportJourney(destinationKey: string): void {
    const sourceKey = activeRepoRef.current;
    if (sourceKey && destinationKey !== sourceKey && !confirmExit("switching destinations")) {
      return;
    }
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

  function handleDropOrOpenFolder(repoKey: string): void {
    setDropSurfaceOpen(false);
    setIsWindowDragActive(false);
    dragCounterRef.current = 0;

    if (gate === "login" || demoTransition !== "idle") {
      setDemoTransition("loading");
      setActiveRepoKey(repoKey);
    } else {
      beginAirportJourney(repoKey);
    }
  }

  function handleImportOrSelect(repo: RepoSummary): void {
    if (airportTravelRef.current || airportArrivalRef.current || importingRef.current) return;
    if (repo.imported) {
      beginAirportJourney(repo.key);
      return;
    }
    if (!session.authenticated) return;

    const requestId = ++importRequestRef.current;
    const pending = { repoKey: repo.key, startedAt: Date.now() };
    importingRef.current = pending;
    setImporting(pending);
    setReposError(undefined);

    const authEpoch = authEpochRef.current;
    const importIsCurrent = (): boolean =>
      requestId === importRequestRef.current && authEpoch === authEpochRef.current;
    importRepo(repo.fullName)
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
    if (!confirmExit("logging out")) return;
    authEpochRef.current += 1;
    importRequestRef.current += 1;
    repoLoadRequestRef.current += 1;
    repoLoadInFlightRef.current = undefined;
    airportTravelRef.current = undefined;
    airportArrivalRef.current = undefined;
    importingRef.current = undefined;
    void logout();
    clearStoredActiveRepo();
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

  if (gate === "repos") {
    return (
      <>
        <RepoPicker
          repos={repos}
          loading={reposLoading}
          error={reposError}
          importing={importing}
          onImportOrSelect={handleImportOrSelect}
          onSeeDemo={() => setActiveRepoKey(DEMO_REPO_KEY)}
          onRefresh={loadRepos}
          serverMode={config.mode}
          onDropOrOpenFolder={handleDropOrOpenFolder}
        />
        {(dropSurfaceOpen || isWindowDragActive) && (
          <div className="window-drop-overlay">
            <DropSurface
              serverMode={config.mode}
              onSelectRepoKey={handleDropOrOpenFolder}
              onClose={() => {
                setDropSurfaceOpen(false);
                setIsWindowDragActive(false);
                dragCounterRef.current = 0;
              }}
            />
          </div>
        )}
      </>
    );
  }

  const demoIsTransitioning =
    activeRepoKey !== undefined && demoTransition !== "idle";
  const showLogin = gate === "login" || demoIsTransitioning;

  return (
    <div className="root-stage">
      {isUploadCityActive && (
        <div className="temporary-city-banner retro">
          TEMPORARY CITY · CLOSING OR RELOADING DELETES THIS UPLOAD
        </div>
      )}

      {gate === "login" || gate === "city" ? (
        <App
          activeRepoKey={gate === "login" ? DEMO_REPO_KEY : activeRepoKey!}
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
          <LoginScreen
            onSeeDemo={startDemo}
            onDropFolder={() => setDropSurfaceOpen(true)}
          />
        </div>
      ) : null}

      {(dropSurfaceOpen || isWindowDragActive) && (
        <div className="window-drop-overlay">
          <DropSurface
            serverMode={config.mode}
            onSelectRepoKey={handleDropOrOpenFolder}
            onClose={() => {
              setDropSurfaceOpen(false);
              setIsWindowDragActive(false);
              dragCounterRef.current = 0;
            }}
          />
        </div>
      )}

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
            serverMode={config.mode}
            onDropOrOpenFolder={handleDropOrOpenFolder}
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
            serverMode={config.mode}
            onDropOrOpenFolder={handleDropOrOpenFolder}
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
