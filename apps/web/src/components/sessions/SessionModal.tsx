import { forwardRef, useMemo, useState } from "react";
import type { Building, CrewPolicy } from "@sudo-city/protocol";
import type { ConnectionState } from "@/lib/app-utils";
import type { CrewSelection } from "@/components/CrewSelectDialog";
import CrewSelectDialog from "@/components/CrewSelectDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SessionView } from "@/sessions/types";
import { findCrewByModel, DEFAULT_CREW_ID } from "@/crew/catalog";
import { cn } from "@/lib/utils";
import { SessionComposer } from "./SessionComposer";
import { SessionHeader } from "./SessionHeader";
import { SessionTranscript } from "./SessionTranscript";

export interface SessionModalProps {
  open: boolean;
  view?: SessionView;
  activeCityId?: string;
  connection: ConnectionState;
  crewPolicy: CrewPolicy;
  contextPaths?: string[];
  onContextPathsChange?: (paths: string[] | ((current: string[]) => string[])) => void;
  draggingBuilding?: Building;
  isDropTarget?: boolean;
  onClose: () => void;
  onRename: (title: string) => void;
  onCopyTranscript: () => void;
  onPermit: (toolCallId: string, decision: "allow" | "allow-always" | "deny") => void;
  onSend: (prompt: string, contextPaths: string[]) => void;
  onInterrupt: () => void;
  onConfigure: (changes: { model?: string; effort?: "low" | "medium" | "high" | "xhigh" | "max"; permissionMode?: "default" | "auto" }) => void;
  onOpenFiles: () => void;
  onTravel?: (cityId: string) => void;
  onOpenTerminal?: (command?: string) => void;
}

export const SessionModal = forwardRef<HTMLDivElement, SessionModalProps>(
  function SessionModal(
    {
      open,
      view,
      activeCityId,
      connection,
      crewPolicy,
      contextPaths,
      onContextPathsChange,
      draggingBuilding,
      isDropTarget,
      onClose,
      onRename,
      onCopyTranscript,
      onPermit,
      onSend,
      onInterrupt,
      onConfigure,
      onOpenFiles,
      onTravel,
      onOpenTerminal,
    },
    ref,
  ) {
    const [crewPickerOpen, setCrewPickerOpen] = useState(false);
    const crewSelection = useMemo<CrewSelection>(() => {
      const crew = findCrewByModel(view?.summary.model ?? "") ?? findCrewByModel(DEFAULT_CREW_ID)!;
      return { crewId: crew.id, effort: view?.summary.effort ?? "high" };
    }, [view?.summary.effort, view?.summary.model]);

    return (
      <>
        <Dialog modal={false} open={open && Boolean(view)} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
          <DialogContent
            ref={ref}
            position="right"
            hideCloseButton
            hideOverlay
            className={cn(
              "grid-rows-[auto_minmax(0,1fr)_auto] grid-cols-[minmax(0,1fr)] max-w-full overflow-hidden gap-0 transition-colors",
              draggingBuilding && "border-dashed",
              isDropTarget && "is-drop-target ring-1 ring-primary",
            )}
          >
          {view ? (
            <>
              <span aria-hidden="true" className="hud-window__frame !top-[7px]" />
              <DialogTitle className="sr-only">{view.summary.title}</DialogTitle>
              <DialogDescription className="sr-only">Order transcript and composer</DialogDescription>
              <SessionHeader
                summary={view.summary}
                activeCityId={activeCityId}
                onRename={onRename}
                onClose={() => { onClose(); }}
                onCopyTranscript={onCopyTranscript}
                onTravel={onTravel}
              />
              <SessionTranscript
                view={view}
                onPermit={onPermit}
                onOpenTerminal={onOpenTerminal}
              />
              <SessionComposer
                view={view}
                connection={connection}
                crewPolicy={crewPolicy}
                crewSelection={crewSelection}
                contextPaths={contextPaths}
                onContextPathsChange={onContextPathsChange}
                draggingBuilding={draggingBuilding}
                isDropTarget={isDropTarget}
                onCrewClick={() => setCrewPickerOpen(true)}
                onConfigure={onConfigure}
                onSend={onSend}
                onInterrupt={onInterrupt}
                onOpenFiles={onOpenFiles}
                onOpenTerminal={onOpenTerminal}
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      {view ? (
        <CrewSelectDialog
          open={crewPickerOpen}
          onOpenChange={setCrewPickerOpen}
          value={crewSelection}
          policy={crewPolicy}
          onConfirm={(selection) => {
            const crew = findCrewByModel(selection.crewId) ?? findCrewByModel(DEFAULT_CREW_ID)!;
            onConfigure({ model: crew.model, effort: selection.effort });
          }}
        />
      ) : null}
    </>
  );
});
