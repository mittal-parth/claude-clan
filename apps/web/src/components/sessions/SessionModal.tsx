import { useMemo, useState } from "react";
import type { CrewPolicy } from "@sudo-city/protocol";
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
import { SessionComposer } from "./SessionComposer";
import { SessionHeader } from "./SessionHeader";
import { SessionTranscript } from "./SessionTranscript";

export interface SessionModalProps {
  open: boolean;
  view?: SessionView;
  connection: ConnectionState;
  crewPolicy: CrewPolicy;
  onClose: () => void;
  onRename: (title: string) => void;
  onCopyTranscript: () => void;
  onPermit: (toolCallId: string, decision: "allow" | "allow-always" | "deny") => void;
  onSend: (prompt: string, contextPaths: string[]) => void;
  onInterrupt: () => void;
  onConfigure: (changes: { model?: string; effort?: "low" | "medium" | "high" | "xhigh" | "max"; permissionMode?: "default" | "auto" }) => void;
  onOpenFiles: () => void;
}

export function SessionModal({
  open,
  view,
  connection,
  crewPolicy,
  onClose,
  onRename,
  onCopyTranscript,
  onPermit,
  onSend,
  onInterrupt,
  onConfigure,
  onOpenFiles,
}: SessionModalProps) {
  const [crewPickerOpen, setCrewPickerOpen] = useState(false);
  const crewSelection = useMemo<CrewSelection>(() => {
    const crew = findCrewByModel(view?.summary.model ?? "") ?? findCrewByModel(DEFAULT_CREW_ID)!;
    return { crewId: crew.id, effort: view?.summary.effort ?? "high" };
  }, [view?.summary.effort, view?.summary.model]);

  return (
    <>
      <Dialog open={open && Boolean(view)} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
        <DialogContent className="grid h-[min(85vh,900px)] max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 border-2 border-foreground bg-background p-0 shadow-2xl sm:rounded-none dark:border-ring">
          {view ? (
            <>
              <span aria-hidden="true" className="hud-window__frame" />
              <DialogTitle className="sr-only">{view.summary.title}</DialogTitle>
              <DialogDescription className="sr-only">Session transcript and composer</DialogDescription>
              <SessionHeader
                summary={view.summary}
                onRename={onRename}
                onClose={() => { onClose(); }}
                onCopyTranscript={onCopyTranscript}
              />
              <SessionTranscript view={view} onPermit={onPermit} />
              <SessionComposer
                view={view}
                connection={connection}
                crewPolicy={crewPolicy}
                crewSelection={crewSelection}
                onCrewClick={() => setCrewPickerOpen(true)}
                onConfigure={onConfigure}
                onSend={onSend}
                onInterrupt={onInterrupt}
                onOpenFiles={onOpenFiles}
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
}
