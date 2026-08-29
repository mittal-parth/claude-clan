import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  Terminal as TerminalIcon,
  Plus,
  X,
  Maximize2,
  Minimize2,
  Trash2,
  Folder,
  ChevronDown,
} from "lucide-react";
import { desktop, isDesktop } from "@/lib/desktop";
import { cn } from "@/lib/utils";

export interface IntegratedTerminalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cwd?: string;
  repoName?: string;
  command?: string;
  onCommandExecuted?: () => void;
}

interface TerminalTab {
  id: string;
  title: string;
  cwd?: string;
}

const TERMINAL_THEME = {
  background: "#091721",
  foreground: "#e2e8f0",
  cursor: "#f59e0b",
  cursorAccent: "#091721",
  selectionBackground: "rgba(245, 158, 11, 0.35)",
  black: "#091721",
  red: "#ef4444",
  green: "#10b981",
  yellow: "#f59e0b",
  blue: "#38bdf8",
  magenta: "#c084fc",
  cyan: "#06b6d4",
  white: "#f8fafc",
  brightBlack: "#475569",
  brightRed: "#f87171",
  brightGreen: "#34d399",
  brightYellow: "#fbbf24",
  brightBlue: "#60a5fa",
  brightMagenta: "#e879f9",
  brightCyan: "#22d3ee",
  brightWhite: "#ffffff",
};

const DEFAULT_HEIGHT = 260;
const MIN_HEIGHT = 140;

function TerminalView({
  tab,
  active,
  onExit,
}: {
  tab: TerminalTab;
  active: boolean;
  onExit: (tabId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    const bridge = desktop()?.terminal;
    if (!bridge || !containerRef.current || initializedRef.current) return;

    initializedRef.current = true;

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 12,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, "Courier New", monospace',
      letterSpacing: 0,
      lineHeight: 1.25,
      theme: TERMINAL_THEME,
      allowTransparency: true,
      convertEol: true,
      scrollback: 5000,
      macOptionIsMeta: true,
    });

    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      // Pass through terminal toggle shortcut
      if (
        (event.ctrlKey || event.metaKey) &&
        (event.key === "`" || event.key === "~")
      ) {
        return false;
      }
      return true;
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    if (active) {
      term.focus();
    }

    try {
      fitAddon.fit();
    } catch {
      // Ignored if container not rendered yet
    }

    const cols = term.cols || 80;
    const rows = term.rows || 24;

    void bridge.create({
      id: tab.id,
      cwd: tab.cwd,
      cols,
      rows,
    });

    const dataDisposable = term.onData((data) => {
      bridge.write(tab.id, data);
    });

    const removeDataListener = bridge.onData(({ id, data }) => {
      if (id === tab.id) {
        term.write(data);
      }
    });

    const removeExitListener = bridge.onExit(({ id }) => {
      if (id === tab.id) {
        term.writeln("\r\n\x1b[90m[Process completed]\x1b[0m");
        onExitRef.current(tab.id);
      }
    });

    return () => {
      dataDisposable.dispose();
      removeDataListener();
      removeExitListener();
      bridge.destroy(tab.id);
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      initializedRef.current = false;
    };
  }, [tab.id, tab.cwd]);

  // Fit and focus when tab becomes active or container resizes
  useEffect(() => {
    if (!active || !fitAddonRef.current || !termRef.current) return;

    termRef.current.focus();

    const bridge = desktop()?.terminal;
    const fit = (): void => {
      try {
        if (!containerRef.current || !fitAddonRef.current || !termRef.current)
          return;
        const { clientWidth, clientHeight } = containerRef.current;
        if (clientWidth <= 0 || clientHeight <= 0) return;

        fitAddonRef.current.fit();
        const { cols, rows } = termRef.current;
        if (cols > 0 && rows > 0 && bridge) {
          bridge.resize(tab.id, cols, rows);
        }
      } catch {
        // Ignored
      }
    };

    // Small delay to ensure container is laid out
    const timer = setTimeout(fit, 30);
    const observer = new ResizeObserver(() => {
      fit();
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [active, tab.id]);

  return (
    <div
      ref={containerRef}
      onClick={() => termRef.current?.focus()}
      className={cn(
        "h-full w-full overflow-hidden p-2 text-left cursor-text",
        !active && "hidden",
      )}
    />
  );
}

export function IntegratedTerminal({
  open,
  onOpenChange,
  cwd,
  repoName,
  command,
  onCommandExecuted,
}: IntegratedTerminalProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [maximized, setMaximized] = useState(false);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(DEFAULT_HEIGHT);

  // Global toggle shortcut: Ctrl+` or Cmd+`
  useEffect(() => {
    if (!isDesktop() || !desktop()?.terminal) return;

    function handleKeyDown(event: KeyboardEvent): void {
      if (
        (event.ctrlKey || event.metaKey) &&
        (event.key === "`" || event.key === "~")
      ) {
        event.preventDefault();
        onOpenChange(!open);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  const addTab = useCallback(
    (customCwd?: string) => {
      const id = `term-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setTabs((prev) => {
        const index = prev.length + 1;
        const newTab: TerminalTab = {
          id,
          title: `${index}: zsh`,
          cwd: customCwd ?? cwd,
        };
        return [...prev, newTab];
      });
      setActiveTabId(id);
    },
    [cwd],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const remaining = prev.filter((tab) => tab.id !== tabId);
        setActiveTabId((currentActive) => {
          if (currentActive === tabId) {
            if (remaining.length === 0) {
              onOpenChange(false);
              return "";
            }
            const index = prev.findIndex((t) => t.id === tabId);
            const nextTab = remaining[Math.min(index, remaining.length - 1)];
            return nextTab ? nextTab.id : remaining[0]!.id;
          }
          return currentActive;
        });
        return remaining;
      });
    },
    [onOpenChange],
  );

  // Create first tab if opening and no tabs exist
  useEffect(() => {
    if (open && tabs.length === 0) {
      addTab();
    }
  }, [open, tabs.length, addTab]);

  // Execute command when active tab is ready
  useEffect(() => {
    if (!open || !command || !activeTabId) return;
    const bridge = desktop()?.terminal;
    if (!bridge) return;

    const timer = setTimeout(() => {
      bridge.write(
        activeTabId,
        command.endsWith("\r") || command.endsWith("\n") ? command : `${command}\r`,
      );
      onCommandExecuted?.();
    }, 350);

    return () => clearTimeout(timer);
  }, [open, command, activeTabId, onCommandExecuted]);

  // Drag-to-resize handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      startYRef.current = e.clientY;
      startHeightRef.current = height;

      const handleMouseMove = (event: MouseEvent): void => {
        if (!isDraggingRef.current) return;
        const deltaY = startYRef.current - event.clientY;
        const maxHeight = window.innerHeight * 0.85;
        const nextHeight = Math.min(
          maxHeight,
          Math.max(MIN_HEIGHT, startHeightRef.current + deltaY),
        );
        setHeight(nextHeight);
      };

      const handleMouseUp = (): void => {
        isDraggingRef.current = false;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [height],
  );

  const clearActiveTerminal = (): void => {
    const bridge = desktop()?.terminal;
    if (bridge && activeTabId) {
      bridge.write(activeTabId, "clear\r");
    }
  };

  if (!isDesktop() || !desktop()?.terminal || !open) {
    return null;
  }

  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex flex-col border-t-2 border-border bg-[#081923]/98 shadow-2xl backdrop-blur-xl transition-[height] duration-75 select-none",
        maximized ? "h-[calc(100dvh-2.5rem)]" : "",
      )}
      style={maximized ? undefined : { height }}
    >
      {/* Top resize handle */}
      {!maximized && (
        <div
          onMouseDown={handleMouseDown}
          className="group absolute -top-1.5 inset-x-0 h-3 cursor-row-resize z-50 flex items-center justify-center"
        >
          <div className="h-0.5 w-16 rounded-full bg-border/50 group-hover:bg-primary/80 transition-colors" />
        </div>
      )}

      {/* Terminal Titlebar / Tabs Header */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/70 bg-[#06121a] px-2 text-xs">
        {/* Left: Tabs List */}
        <div className="flex items-center gap-1 overflow-x-auto min-w-0">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mr-1">
            <TerminalIcon className="size-3 text-primary" aria-hidden="true" />
            <span className="retro uppercase tracking-wider font-bold text-primary">
              Terminal
            </span>
          </div>

          <div className="flex items-center gap-0.5 overflow-x-auto">
            {tabs.map((tab) => {
              const isSelected = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  className={cn(
                    "group flex h-6 items-center gap-1.5 border border-transparent px-2 text-[9px] retro cursor-pointer transition-colors",
                    isSelected
                      ? "border-primary/50 bg-[#0c2231] text-amber-200 font-semibold"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                  )}
                >
                  <span className="truncate max-w-[80px]">{tab.title}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="opacity-40 group-hover:opacity-100 hover:text-red-400"
                    title="Close tab"
                  >
                    <X className="size-2.5" />
                  </button>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => addTab()}
            className="flex h-5 w-5 items-center justify-center text-muted-foreground hover:text-primary hover:bg-white/5 rounded transition-colors"
            title="New Terminal"
          >
            <Plus className="size-3" />
          </button>
        </div>

        {/* Center: Current Working Directory */}
        <div className="hidden sm:flex items-center gap-1.5 text-[9px] text-muted-foreground truncate px-2 min-w-0 max-w-[360px]">
          <Folder className="size-2.5 shrink-0 text-sky-400" />
          <span className="truncate retro text-[8px] text-slate-400">
            {activeTab?.cwd ?? cwd ?? (repoName ? `${repoName}` : "~")}
          </span>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={clearActiveTerminal}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-white/5 rounded transition-colors"
            title="Clear terminal"
          >
            <Trash2 className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => setMaximized((m) => !m)}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-white/5 rounded transition-colors"
            title={maximized ? "Restore size" : "Maximize terminal"}
          >
            {maximized ? (
              <Minimize2 className="size-3" />
            ) : (
              <Maximize2 className="size-3" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="p-1 text-muted-foreground hover:text-red-400 hover:bg-white/5 rounded transition-colors"
            title="Close terminal (Ctrl+`)"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal View Container */}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#091721]">
        {tabs.map((tab) => (
          <TerminalView
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            onExit={closeTab}
          />
        ))}
      </div>
    </div>
  );
}
