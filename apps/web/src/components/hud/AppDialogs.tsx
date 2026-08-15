import IssueShopDialog from "../IssueShopDialog";
import PrShopDialog from "../PrShopDialog";
import WorktreeShopDialog from "../WorktreeShopDialog";
import CrewSelectDialog from "@/components/CrewSelectDialog";
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
import { fileBasename, fileDirname, cityLabel } from "@/lib/app-utils";
import { useGameState } from "@/hooks/use-game-state";

export interface AppDialogsProps {
  state: ReturnType<typeof useGameState>;
  activeRepoKey: string;
}

export function AppDialogs({ state, activeRepoKey }: AppDialogsProps) {
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

    commandOpen,
    setCommandOpen,
    world,
    canvasRef,
    selectBuilding,
    send,
    cities,
    travelTo,

    isFlashingShutter,
    setIsFlashingShutter,

    shareModalOpen,
    setShareModalOpen,
    screenshotUrl,
  } = state;

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
        onConfirm={setCrewSelection}
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
                    canvasRef.current?.focusBuilding(building.path);
                    selectBuilding(building);
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
                send({ type: "session.interrupt", cityId: activeCityId });
                setCommandOpen(false);
              }}
            >
              Halt construction
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
