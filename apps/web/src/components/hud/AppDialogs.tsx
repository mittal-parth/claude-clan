import IssueShopDialog from "../IssueShopDialog";
import PrShopDialog from "../PrShopDialog";
import WorktreeShopDialog from "../WorktreeShopDialog";
import CrewSelectDialog from "@/components/CrewSelectDialog";
import { trackCrewChanged } from "@/lib/analytics";
import SignInDialog from "@/components/SignInDialog";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "../ui/command";
import { ShutterFlash } from "../ShutterFlash";
import { ShareCityModal } from "../ShareCityModal";
import { fileBasename, fileDirname, cityLabel, pointIsInside } from "@/lib/app-utils";
import { useGameState } from "@/hooks/use-game-state";
import type { AuthUser } from "@/auth/gate";
import { SessionModal } from "@/components/sessions/SessionModal";
import { ArchivedSessionsModal } from "@/components/sessions/ArchivedSessionsModal";

export interface AppDialogsProps {
  state: ReturnType<typeof useGameState>;
  activeRepoKey: string;
  user?: AuthUser;
  onOpenAirport?: () => void;
}

export function AppDialogs({
  state,
  activeRepoKey,
  user,
  onOpenAirport,
}: AppDialogsProps) {
  const {
    issueShopOpen,
    setIssueShopOpen,
    issues,
    activeCityId,
    takeIssueToFix,

    prShopOpen,
    setPrShopOpen,
    reviewPrCities,
    takePrToDeploy,

    worktreeShopOpen,
    setWorktreeShopOpen,
    ownWorkCities,
    takeOwnWorkToDeploy,

    crewDialogOpen,
    setCrewDialogOpen,
    crewSelection,
    setCrewSelection,

    archivedSessionsOpen,
    setArchivedSessionsOpen,

    commandOpen,
    setCommandOpen,
    world,
    canvasRef,
    selectBuilding,
    send,
    cities,
    travelTo,
    sessions,
    sessionModalRef,
    sessionContextPaths,
    setSessionContextPaths,
    draggingBuilding,
    dragPosition,

    isFlashingShutter,
    setIsFlashingShutter,

    shareModalOpen,
    setShareModalOpen,
    screenshotUrl,
  } = state;

  const focusedView = sessions.focusedSessionId
    ? sessions.sessionsById[sessions.focusedSessionId]
    : undefined;

  const isModalDropTarget = Boolean(
    draggingBuilding &&
    dragPosition &&
    pointIsInside(sessionModalRef.current, dragPosition),
  );

  function copyFocusedTranscript(): void {
    if (!focusedView) return;
    const transcript = focusedView.events
      .filter((event) => event.type === "session.message")
      .map((event) => `${event.role}: ${event.text}`)
      .join("\n\n");
    void navigator.clipboard?.writeText(transcript);
  }

  return (
    <>
      <IssueShopDialog
        open={issueShopOpen}
        onOpenChange={setIssueShopOpen}
        issues={issues}
        activeCityId={activeCityId}
        onTakeIssue={takeIssueToFix}
      />

      <PrShopDialog
        open={prShopOpen}
        onOpenChange={setPrShopOpen}
        prs={reviewPrCities}
        activeCityId={activeCityId}
        onTakePr={takePrToDeploy}
      />

      <WorktreeShopDialog
        open={worktreeShopOpen}
        onOpenChange={setWorktreeShopOpen}
        items={ownWorkCities}
        activeCityId={activeCityId}
        onTakeItem={takeOwnWorkToDeploy}
      />

      <CrewSelectDialog
        open={crewDialogOpen}
        onOpenChange={setCrewDialogOpen}
        value={crewSelection}
        policy={state.crewPolicy}
        onConfirm={(selection) => {
          if (selection.crewId !== crewSelection.crewId) {
            trackCrewChanged({ model: selection.crewId, prevModel: crewSelection.crewId, repoKey: activeRepoKey });
          }
          setCrewSelection(selection);
        }}
      />

      <SignInDialog
        action={state.signInAction}
        isAuthenticated={Boolean(user ?? state.viewerLogin)}
        onPickRepo={() => {
          state.setSignInAction(undefined);
          onOpenAirport?.();
        }}
        onOpenChange={(open) => {
          if (!open) {
            state.setSignInAction(undefined);
          }
        }}
      />

      <ArchivedSessionsModal
        open={archivedSessionsOpen}
        onOpenChange={setArchivedSessionsOpen}
        sessions={sessions.archivedSessions}
        activeCityId={activeCityId}
        unreadFor={sessions.unreadFor}
        onUnarchive={sessions.unarchiveSession}
      />

      <SessionModal
        ref={sessionModalRef}
        open={Boolean(sessions.focusedSessionId)}
        view={focusedView}
        activeCityId={activeCityId}
        connection={state.connection}
        crewPolicy={state.crewPolicy}
        contextPaths={sessionContextPaths}
        onContextPathsChange={setSessionContextPaths}
        draggingBuilding={draggingBuilding}
        isDropTarget={isModalDropTarget}
        onClose={sessions.blurSession}
        onRename={(title) => {
          if (sessions.focusedSessionId) {
            sessions.renameSession(sessions.focusedSessionId, title);
          }
        }}
        onCopyTranscript={copyFocusedTranscript}
        onPermit={(toolCallId, decision) => {
          if (sessions.focusedSessionId) {
            sessions.resolvePermit(sessions.focusedSessionId, toolCallId, decision);
          }
        }}
        onSend={(prompt, contextPaths) => {
          if (sessions.focusedSessionId) {
            sessions.sendToSession(sessions.focusedSessionId, prompt, contextPaths);
            setSessionContextPaths([]);
          }
        }}
        onInterrupt={() => {
          if (sessions.focusedSessionId) {
            sessions.interruptSession(sessions.focusedSessionId);
          }
        }}
        onConfigure={(changes) => {
          if (sessions.focusedSessionId) {
            sessions.configureSession(sessions.focusedSessionId, changes);
          }
        }}
        onOpenFiles={() => setCommandOpen(true)}
        onTravel={state.teleportToCity}
      />

      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder="Search files or mayor commands..." />
        <CommandList>
          <CommandEmpty>No file or command found.</CommandEmpty>
          {world?.buildings.length ? (
            <CommandGroup heading="Files">
              {world.buildings.map((building) => (
                <CommandItem
                  key={building.path}
                  value={building.path}
                  onSelect={() => {
                    if (sessions.focusedSessionId) {
                      setSessionContextPaths((current) =>
                        current.includes(building.path)
                          ? current
                          : [...current, building.path],
                      );
                    } else {
                      canvasRef.current?.focusBuilding(building.path);
                      selectBuilding(building);
                    }
                    setCommandOpen(false);
                  }}
                >
                  <span className="truncate">
                    {fileBasename(building.path)}
                  </span>
                  <span className="text-muted-foreground ml-2 truncate text-xs">
                    {fileDirname(building.path)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          <CommandGroup heading="Mayor">
            <CommandItem
              onSelect={() => {
                send({ type: "world.request", cityId: activeCityId });
                setCommandOpen(false);
              }}
            >
              Rescan district
            </CommandItem>
            <CommandItem
              onSelect={() => {
                if (sessions.focusedSessionId) {
                  sessions.focusSession(sessions.focusedSessionId);
                }
                setCommandOpen(false);
              }}
            >
              Open focused order
            </CommandItem>
            <CommandItem
              onSelect={() => {
                send({ type: "city.refresh" });
                setCommandOpen(false);
              }}
            >
              Refresh open pull requests
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Travel">
            {cities.map((city) => (
              <CommandItem
                key={city.id}
                disabled={city.id === activeCityId}
                onSelect={() => {
                  travelTo(city.id);
                  setCommandOpen(false);
                }}
              >
                {cityLabel(city)}
                {city.id === activeCityId ? " (current)" : ""}
                {city.status === "building" ? " · building…" : ""}
                {city.status === "failed" ? " · failed" : ""}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      <ShutterFlash
        isFlashing={isFlashingShutter}
        onAnimationEnd={() => setIsFlashingShutter(false)}
      />

      <ShareCityModal
        isOpen={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        screenshotUrl={screenshotUrl}
        activeRepoKey={activeRepoKey}
      />
    </>
  );
}
