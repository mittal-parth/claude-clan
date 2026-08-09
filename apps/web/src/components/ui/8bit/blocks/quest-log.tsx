"use client";

import * as React from "react";
import {
  AlertTriangle,
  Check,
  Circle,
  File,
  FilePen,
  Globe,
  ListTodo,
  Loader2,
  MessageSquare,
  Minimize2,
  Play,
  Search,
  Shield,
  Terminal,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

import { Markdown } from "@/components/markdown";
import { useUiClick } from "@/hooks/use-ui-click";
import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/8bit/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/8bit/card";
import { ScrollArea } from "@/components/ui/8bit/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import "@/components/ui/8bit/styles/retro.css";

export type QuestStatus = "active" | "completed" | "failed" | "pending";

export type QuestRole = "agent" | "mayor" | "system";

export interface QuestTimelineStep {
  id: string;
  type: string;
  label?: string;
  markdown?: string;
  status: QuestStatus;
  role?: QuestRole;
  toolCallId?: string;
  tool?: string;
  taskId?: string;
  subagentId?: string;
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  status: QuestStatus;
  shortDescription?: string;
  role?: QuestRole;
  timeline?: QuestTimelineStep[];
}

export interface QuestLogProps {
  quests: Quest[];
  className?: string;
  showEmptyState?: boolean;
  emptyStateMessage?: string;
  /**
   * `bare` drops the card chrome and the heading for hosts that already frame
   * the log — the HUD's console window carries both in its title bar.
   */
  variant?: "card" | "bare";
}

function roleLabel(role: QuestRole | undefined): string {
  switch (role) {
    case "mayor":
      return "Mayor";
    case "agent":
      return "Crew";
    case "system":
      return "System";
    default:
      return "Update";
  }
}

function roleColorClass(role: QuestRole | undefined): string {
  switch (role) {
    case "mayor":
      return "text-primary";
    case "agent":
      return "text-foreground";
    case "system":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

function getPreviewText(quest: Quest): string {
  if (quest.shortDescription) {
    return quest.shortDescription;
  }

  if (quest.description.length > 100) {
    return `${quest.description.substring(0, 100)}...`;
  }

  return quest.description;
}

function WorkingIndicator() {
  return (
    <span className="relative flex size-3 shrink-0 items-center justify-center">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60 opacity-75" />
      <Loader2
        aria-label="Working"
        className="relative size-3 animate-spin text-primary"
      />
    </span>
  );
}

function TopLevelStatus({ status }: { status: QuestStatus }) {
  if (status === "active") {
    return <WorkingIndicator />;
  }

  if (status === "failed") {
    return (
      <span className="retro inline-flex h-3 shrink-0 items-center rounded-sm border border-destructive/70 bg-destructive/15 px-0.5 text-[6px] leading-none text-destructive">
        !
      </span>
    );
  }

  return null;
}

function QuestItem({
  quest,
  onSelect,
}: {
  quest: Quest;
  onSelect: (quest: Quest) => void;
}) {
  const playClick = useUiClick();
  const updateCount = quest.timeline?.length ?? 0;

  return (
    <button
      type="button"
      className="w-full border-b border-border/60 px-2.5 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/40"
      onClick={() => {
        playClick();
        onSelect(quest);
      }}
    >
      <div className="flex items-start gap-2 w-full">
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-0.5 min-w-0 w-full">
              <p className="text-[10px] leading-relaxed text-foreground line-clamp-2">
                {getPreviewText(quest)}
              </p>
              {updateCount > 0 ? (
                <span className="text-[8px] text-muted-foreground">
                  {updateCount} update{updateCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>

            <TopLevelStatus status={quest.status} />
          </div>
        </div>
      </div>
    </button>
  );
}

function getStepIcon(step: QuestTimelineStep): LucideIcon {
  if (step.type === "session.message") {
    return step.role === "system" ? AlertTriangle : MessageSquare;
  }

  const tool = step.tool?.toLowerCase() ?? "";

  if (
    step.type === "tool.started" ||
    step.type === "permit.requested" ||
    step.tool
  ) {
    if (step.type === "permit.requested") {
      return Shield;
    }
    if (tool.includes("bash") || tool.includes("shell")) {
      return Terminal;
    }
    if (
      tool.includes("read") ||
      tool.includes("write") ||
      tool.includes("edit")
    ) {
      return FilePen;
    }
    if (tool.includes("grep") || tool.includes("search")) {
      return Search;
    }
    if (tool.includes("web") || tool.includes("fetch")) {
      return Globe;
    }
    return Wrench;
  }

  switch (step.type) {
    case "session.started":
      return Play;
    case "file.changed":
      return File;
    case "task.changed":
      return ListTodo;
    case "subagent.changed":
      return Users;
    case "compact.changed":
      return Minimize2;
    case "diagnostics.updated":
      return AlertTriangle;
    default:
      return Circle;
  }
}

function StepStatusIcon({ status }: { status: QuestStatus }) {
  switch (status) {
    case "active":
      return (
        <Loader2
          aria-label="In progress"
          className="size-3 animate-spin text-primary"
        />
      );
    case "completed":
      return (
        <Check aria-label="Completed" className="size-3 text-emerald-400" />
      );
    case "failed":
      return <X aria-label="Failed" className="size-3 text-destructive" />;
    case "pending":
      return (
        <Circle aria-label="Pending" className="size-3 text-muted-foreground" />
      );
    default: {
      const exhaustiveStatus: never = status;
      return exhaustiveStatus;
    }
  }
}

function TimelineStep({ step }: { step: QuestTimelineStep }) {
  const Icon = getStepIcon(step);
  const isMessage = step.type === "session.message";

  return (
    <div className="relative flex gap-3 pb-4 last:pb-0">
      <div className="relative z-10 flex shrink-0 flex-col items-center">
        <div className="flex size-7 items-center justify-center border-2 border-foreground bg-background dark:border-ring">
          <Icon className="size-3.5" strokeWidth={2.25} />
        </div>
        <div className="absolute -bottom-0.5 -right-0.5 rounded-full bg-background p-0.5">
          <StepStatusIcon status={step.status} />
        </div>
      </div>
      <div className="min-w-0 flex-1 pt-1">
        {isMessage ? (
          <span
            className={cn(
              "retro mb-1 block text-[8px] uppercase tracking-wide",
              roleColorClass(step.role),
            )}
          >
            {roleLabel(step.role)}
          </span>
        ) : null}
        {step.markdown ? (
          <Markdown className="text-[10px] leading-relaxed [&_code]:text-[10px] [&_p]:mb-0">
            {step.markdown}
          </Markdown>
        ) : (
          <p className="text-[10px] leading-relaxed text-foreground">
            {step.label}
          </p>
        )}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
      <p className="text-[10px] text-muted-foreground">{message}</p>
    </div>
  );
}

export function QuestLog({
  quests,
  className,
  showEmptyState = true,
  emptyStateMessage = "No quests available.",
  variant = "card",
}: QuestLogProps) {
  const [selectedQuest, setSelectedQuest] = React.useState<Quest | null>(null);
  const topRef = React.useRef<HTMLDivElement>(null);
  const activeQuests = quests.filter((quest) => quest.status === "active");

  React.useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [quests.length, quests.at(0)?.id]);

  const list =
    quests.length === 0 && showEmptyState ? (
      <EmptyState message={emptyStateMessage} />
    ) : (
      <ScrollArea className="h-full min-h-0 w-full flex-1">
        <div ref={topRef} aria-hidden className="h-px shrink-0" />
        <div className="w-full">
          {quests.map((quest) => (
            <QuestItem
              key={quest.id}
              quest={quest}
              onSelect={setSelectedQuest}
            />
          ))}
        </div>
      </ScrollArea>
    );

  return (
    <>
      {variant === "bare" ? (
        <div className={cn("flex h-full min-h-0 w-full flex-col", className)}>
          {list}
        </div>
      ) : (
        <Card className={cn("flex h-full min-h-0 w-full flex-col", className)}>
          <CardHeader className="shrink-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-xs justify-between">
              Quest Log
              {activeQuests.length > 0 ? (
                <Badge className="text-[8px]">
                  {activeQuests.length} Active
                </Badge>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            {list}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={selectedQuest !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedQuest(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden sm:rounded-lg">
          {selectedQuest ? (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between gap-3 pr-8">
                  <div className="min-w-0">
                    <span className="retro text-[8px] uppercase tracking-wide text-primary">
                      Work order
                    </span>
                    <DialogTitle className="retro mt-1 text-xs leading-snug">
                      {getPreviewText(selectedQuest)}
                    </DialogTitle>
                  </div>
                  <TopLevelStatus status={selectedQuest.status} />
                </div>
              </DialogHeader>
              <ScrollArea className="max-h-[60vh] pr-4">
                <div className="space-y-4">
                  <div className="font-normal text-sm leading-relaxed">
                    <Markdown>{selectedQuest.description}</Markdown>
                  </div>

                  {selectedQuest.timeline && selectedQuest.timeline.length > 0 ? (
                    <div className="border-t-2 border-foreground pt-3 dark:border-ring">
                      <p className="retro mb-3 text-[8px] uppercase text-muted-foreground">
                        Crew activity
                      </p>
                      <div className="relative pl-1">
                        <div
                          aria-hidden
                          className="absolute bottom-4 left-[15px] top-4 w-0.5 bg-foreground dark:bg-ring"
                        />
                        {selectedQuest.timeline.map((step) => (
                          <TimelineStep key={step.id} step={step} />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">
                      No crew activity yet.
                    </p>
                  )}
                </div>
              </ScrollArea>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default QuestLog;
