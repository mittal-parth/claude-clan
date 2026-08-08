"use client";

import * as React from "react";

import { Markdown } from "@/components/markdown";
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

export interface Quest {
  id: string;
  title: string;
  description: string;
  status: QuestStatus;
  shortDescription?: string;
}

export interface QuestLogProps {
  quests: Quest[];
  className?: string;
  maxHeight?: string;
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
  return (
    <button
      type="button"
      className="w-full border-b-2 border-foreground px-4 py-3 text-left transition-colors hover:bg-muted/40 dark:border-ring"
      onClick={() => onSelect(quest)}
    >
      <div className="flex items-center gap-3 w-full">
        <div className="flex-1 min-w-0">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex flex-col gap-1 min-w-0 w-full">
              <h3 className="text-sm font-medium text-center sm:text-left truncate">
                {quest.title}
              </h3>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {getPreviewText(quest)}
              </p>
            </div>

            <Badge
              variant={getStatusBadgeVariant(quest.status)}
              className="text-[9px] shrink-0"
            >
              {quest.status.toUpperCase()}
            </Badge>
          </div>
        </div>
      </div>
    </button>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
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
      <Card className={cn("w-full", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base justify-between">
            Quest Log
            {activeQuests.length > 0 && (
              <Badge className="ml-2">
                {activeQuests.length} Active
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {quests.length === 0 && showEmptyState ? (
            <EmptyState message={emptyStateMessage} />
          ) : (
            <ScrollArea className="w-full h-[400px]">
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
                  <DialogTitle className="retro text-base leading-snug">
                    {selectedQuest.title}
                  </DialogTitle>
                  <Badge
                    variant={getStatusBadgeVariant(selectedQuest.status)}
                    className="text-[9px] shrink-0"
                  >
                    {selectedQuest.status.toUpperCase()}
                  </Badge>
                </div>
              </DialogHeader>
              <ScrollArea className="max-h-[60vh] pr-4">
                <Markdown>{selectedQuest.description}</Markdown>
              </ScrollArea>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default QuestLog;
