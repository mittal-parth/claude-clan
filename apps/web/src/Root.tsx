import type { RepoSummary } from "@sudo-city/protocol";
import { useCallback, useEffect, useState } from "react";
import App from "./App";
import { fetchRepos, fetchSession, importRepo, logout } from "@/auth/api";
import {
  gateFor,
  readSessionFromHash,
  readStoredToken,
  writeStoredToken,
  type AuthSession,
} from "@/auth/gate";
import LoginScreen from "@/components/LoginScreen";
import RepoPicker from "@/components/RepoPicker";

const DEMO_REPO_KEY = "demo";

/**
 * Owns the login/repo-picker/city gate that App itself has no notion of --
 * App only ever knows "which repo is active right now", never how the
 * visitor got there.
 */
export default function Root() {
  const [token, setToken] = useState<string | undefined>(() => readStoredToken());
  const [session, setSession] = useState<AuthSession>({ authenticated: false });
  const [sessionChecked, setSessionChecked] = useState(false);
  const [activeRepoKey, setActiveRepoKey] = useState<string>();
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string>();
  const [importing, setImporting] = useState<{ repoKey: string; startedAt: number }>();
  const [switchOpen, setSwitchOpen] = useState(false);

  // The GitHub callback hands the session id back in the URL fragment,
  // never a query string, so it never reaches Render's access logs on that
  // hop -- read it once, persist it to sessionStorage, then strip the hash
  // so a reload or a copied URL doesn't re-carry it.
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
        if (cancelled) {
          return;
        }
        setSession(
          result.authenticated && result.user
            ? { authenticated: true, user: result.user }
            : { authenticated: false },
        );
      })
      .catch(() => {
        if (!cancelled) {
          setSession({ authenticated: false });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSessionChecked(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const loadRepos = useCallback(() => {
    if (!token) {
      return;
    }
    setReposLoading(true);
    setReposError(undefined);
    fetchRepos(token)
      .then(setRepos)
      .catch((error: unknown) => {
        setReposError(error instanceof Error ? error.message : "Failed to load repositories");
      })
      .finally(() => setReposLoading(false));
  }, [token]);

  useEffect(() => {
    if (session.authenticated) {
      loadRepos();
    }
  }, [session.authenticated, loadRepos]);

  function handleImportOrSelect(repo: RepoSummary): void {
    if (repo.imported) {
      setActiveRepoKey(repo.key);
      setSwitchOpen(false);
      return;
    }
    if (!token) {
      return;
    }
    setImporting({ repoKey: repo.key, startedAt: Date.now() });
    importRepo(token, repo.fullName)
      .then(() => {
        setRepos((current) =>
          current.map((entry) => (entry.key === repo.key ? { ...entry, imported: true } : entry)),
        );
        setActiveRepoKey(repo.key);
        setSwitchOpen(false);
      })
      .catch((error: unknown) => {
        setReposError(error instanceof Error ? error.message : "Import failed");
      })
      .finally(() => setImporting(undefined));
  }

  function handleLogout(): void {
    void logout(token);
    writeStoredToken(undefined);
    setToken(undefined);
    setSession({ authenticated: false });
    setActiveRepoKey(undefined);
    setRepos([]);
  }

  if (!sessionChecked) {
    return null;
  }

  const gate = gateFor(session, activeRepoKey);

  if (gate === "login") {
    return <LoginScreen onSeeDemo={() => setActiveRepoKey(DEMO_REPO_KEY)} />;
  }

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

  return (
    <>
      <App
        activeRepoKey={activeRepoKey!}
        sessionToken={session.authenticated ? token : undefined}
        user={session.authenticated ? session.user : undefined}
        onSwitchRepo={() => {
          loadRepos();
          setSwitchOpen(true);
        }}
        onLogout={handleLogout}
        onSignIn={() => setActiveRepoKey(undefined)}
      />
      {session.authenticated ? (
        <RepoPicker
          repos={repos}
          loading={reposLoading}
          error={reposError}
          importing={importing}
          onImportOrSelect={handleImportOrSelect}
          onSeeDemo={() => {
            setActiveRepoKey(DEMO_REPO_KEY);
            setSwitchOpen(false);
          }}
          onRefresh={loadRepos}
          dialog={{ open: switchOpen, onOpenChange: setSwitchOpen }}
        />
      ) : null}
    </>
  );
}
