import type { EffortLevel } from "@sudo-city/protocol";
import { useEffect, useState } from "react";

import HudButton from "@/components/hud/HudButton";
import {
  CREW_MEMBERS,
  EFFORT_LEVELS,
  type CrewId,
  crewSpriteUrl,
  effortDescription,
  effortLabel,
  getCrewMember,
} from "@/crew/catalog";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import "@/components/ui/8bit/styles/retro.css";

export interface CrewSelection {
  crewId: CrewId;
  effort: EffortLevel;
}

export interface CrewSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: CrewSelection;
  onConfirm: (selection: CrewSelection) => void;
}

export default function CrewSelectDialog({
  open,
  onOpenChange,
  value,
  onConfirm,
}: CrewSelectDialogProps) {
  const [draftCrewId, setDraftCrewId] = useState(value.crewId);
  const [draftEffort, setDraftEffort] = useState(value.effort);

  useEffect(() => {
    if (open) {
      setDraftCrewId(value.crewId);
      setDraftEffort(value.effort);
    }
  }, [open, value.crewId, value.effort]);

  const selectedCrew = getCrewMember(draftCrewId);

  function handleConfirm(): void {
    onConfirm({ crewId: draftCrewId, effort: draftEffort });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border-4 border-foreground bg-card p-0 shadow-none sm:rounded-none dark:border-ring">
        <div className="border-b-4 border-foreground bg-primary/10 px-5 py-4 dark:border-ring">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="retro text-sm text-primary">
              Choose your crew
            </DialogTitle>
            <DialogDescription className="retro text-[9px] text-muted-foreground">
              Pick a specialist and how hard they should think before dispatch.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="grid gap-4 px-5 py-4 md:grid-cols-[1.1fr_0.9fr]">
          <div className="grid gap-3 sm:grid-cols-2">
            {CREW_MEMBERS.map((crew) => {
              const selected = crew.id === draftCrewId;
              const sprite = crewSpriteUrl(
                crew.id,
                selected ? draftEffort : "high",
              );

              return (
                <button
                  key={crew.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setDraftCrewId(crew.id)}
                  className={cn(
                    "group flex flex-col border-4 bg-background text-left transition-colors",
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-foreground hover:border-primary/60 dark:border-ring",
                  )}
                >
                  <div className="flex items-end justify-center border-b-4 border-foreground bg-muted/40 px-3 py-3 dark:border-ring">
                    <img
                      src={sprite}
                      alt=""
                      className="h-28 w-auto object-contain [image-rendering:pixelated]"
                    />
                  </div>
                  <div className="space-y-1 px-3 py-3">
                    <p className="retro text-[10px] text-primary">{crew.name}</p>
                    <p className="retro text-[8px] text-muted-foreground">
                      {crew.title} · {crew.model}
                    </p>
                    <p className="retro text-[8px] leading-relaxed text-foreground/80">
                      {crew.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col border-4 border-foreground bg-background dark:border-ring">
            <div className="flex flex-1 flex-col items-center justify-center border-b-4 border-foreground bg-muted/30 px-4 py-5 dark:border-ring">
              <img
                key={`${draftCrewId}-${draftEffort}`}
                src={crewSpriteUrl(draftCrewId, draftEffort)}
                alt=""
                className="h-40 w-auto object-contain [image-rendering:pixelated]"
              />
              <p className="retro mt-3 text-[10px] text-primary">
                {selectedCrew.name}
              </p>
              <p className="retro text-[8px] text-muted-foreground">
                {effortLabel(draftEffort)} effort
              </p>
            </div>

            <div className="space-y-3 px-4 py-4">
              <p className="retro text-[9px] text-muted-foreground">
                Thinking level
              </p>
              <div
                className="grid grid-cols-2 gap-1 sm:grid-cols-3"
                role="group"
                aria-label="Thinking effort"
              >
                {EFFORT_LEVELS.map((effort) => (
                  <HudButton
                    key={effort}
                    type="button"
                    size="sm"
                    variant={draftEffort === effort ? "primary" : "outline"}
                    aria-pressed={draftEffort === effort}
                    onClick={() => setDraftEffort(effort)}
                    className="retro text-[8px]"
                  >
                    {effortLabel(effort)}
                  </HudButton>
                ))}
              </div>
              <p className="retro text-[8px] leading-relaxed text-muted-foreground">
                {effortDescription(draftEffort)}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t-4 border-foreground px-5 py-4 dark:border-ring">
          <HudButton
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </HudButton>
          <HudButton type="button" onClick={handleConfirm}>
            Confirm crew
          </HudButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
