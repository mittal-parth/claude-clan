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
  toolCallId?: string;
  tool?: string;
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
}

const getStatusBadgeVariant = (status: QuestStatus) => {
  switch (status) {
    case "active":
      return "default";
    case "completed":
      return "secondary";
    case "failed":
      return "destructive";
    case "pending":
      return "outline";
    default: {
      const exhaustiveStatus: never = status;
      return exhaustiveStatus;
    }
  }
};

function roleLabel(role: QuestRole | undefined): string {
  switch (role) {
    case "mayor":
      return "Mayor";
    case "agent":
      return "Crew";
    case "system":
      return "System";
    default:
      return "Chat";
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

function QuestItem({
  quest,
  onSelect,
}: {
  quest: Quest;
  onSelect: (quest: Quest) => void;
}) {
  const playClick = useUiClick();
  const timelineCount = quest.timeline?.length ?? 0;

  return (
    <button
      type="button"
      className="w-full border-b-2 border-foreground px-3 py-2.5 text-left transition-colors hover:bg-muted/40 dark:border-ring"
      onClick={() => {
        playClick();
        onSelect(quest);
      }}
    >
      <div className="flex items-start gap-2 w-full">
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-0.5 min-w-0 w-full">
              <span
                className={cn(
                  "retro text-[8px] uppercase tracking-wide",
                  roleColorClass(quest.role),
                )}
              >
                {roleLabel(quest.role)}
              </span>
              <p className="text-[10px] leading-relaxed text-foreground line-clamp-2">
                {getPreviewText(quest)}
              </p>
              {timelineCount > 0 ? (
                <span className="text-[8px] text-muted-foreground">
                  {timelineCount} crew action{timelineCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>

            <Badge
              variant={getStatusBadgeVariant(quest.status)}
              className="text-[8px] shrink-0"
            >
              {quest.status.toUpperCase()}
            </Badge>
          </div>
        </div>
      </div>
    </button>
  );
}

function getStepIcon(step: QuestTimelineStep): LucideIcon {
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
}: QuestLogProps) {
  const [selectedQuest, setSelectedQuest] = React.useState<Quest | null>(null);
  const activeQuests = quests.filter((quest) => quest.status === "active");
  const sortedQuests = [
    ...activeQuests,
    ...quests.filter((quest) => quest.status !== "active"),
  ];

  return (
    <>
      <Card className={cn("flex h-full min-h-0 w-full flex-col", className)}>
        <CardHeader className="shrink-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-xs justify-between">
            Quest Log
            {activeQuests.length > 0 ? (
              <Badge className="text-[8px]">{activeQuests.length} Active</Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          {quests.length === 0 && showEmptyState ? (
            <EmptyState message={emptyStateMessage} />
          ) : (
            <ScrollArea className="h-full min-h-0 w-full flex-1">
              <div className="w-full">
                {sortedQuests.map((quest) => (
                  <QuestItem
                    key={quest.id}
                    quest={quest}
                    onSelect={setSelectedQuest}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

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
                    <span
                      className={cn(
                        "retro text-[8px] uppercase tracking-wide",
                        roleColorClass(selectedQuest.role),
                      )}
                    >
                      {roleLabel(selectedQuest.role)}
                    </span>
                    <DialogTitle className="retro text-xs leading-snug mt-1">
                      {selectedQuest.title}
                    </DialogTitle>
                  </div>
                  <Badge
                    variant={getStatusBadgeVariant(selectedQuest.status)}
                    className="text-[8px] shrink-0"
                  >
                    {selectedQuest.status.toUpperCase()}
                  </Badge>
                </div>
              </DialogHeader>
              <ScrollArea className="max-h-[60vh] pr-4">
                <div className="space-y-4">
                  <div className="font-normal text-sm leading-relaxed">
                    <Markdown>{selectedQuest.description}</Markdown>
                  </div>

                  <div className="border-t-2 border-foreground pt-3 dark:border-ring">
                    <p className="retro mb-3 text-[8px] uppercase text-muted-foreground">
                      Crew timeline
                    </p>
                    {selectedQuest.timeline && selectedQuest.timeline.length > 0 ? (
                      <div className="relative pl-1">
                        <div
                          aria-hidden
                          className="absolute bottom-4 left-[15px] top-4 w-0.5 bg-foreground dark:bg-ring"
                        />
                        {selectedQuest.timeline.map((step) => (
                          <TimelineStep key={step.id} step={step} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground">
                        No crew actions yet.
                      </p>
                    )}
                  </div>
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
