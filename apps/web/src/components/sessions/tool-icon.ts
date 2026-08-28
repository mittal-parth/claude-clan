import {
  ClipboardCheck,
  Drill,
  Forklift,
  Hammer,
  HardHat,
  Paintbrush,
  Pickaxe,
  Radio,
  ScrollText,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export function toolIconFor(tool: string): LucideIcon {
  const normalised = tool.toLowerCase();
  if (
    normalised.includes("bash") ||
    normalised.includes("shell") ||
    normalised.includes("command") ||
    normalised.includes("exec") ||
    normalised.includes("run")
  ) {
    return Drill;
  }
  if (
    normalised.includes("write") ||
    normalised.includes("edit") ||
    normalised.includes("replace") ||
    normalised.includes("patch") ||
    normalised.includes("create")
  ) {
    return Hammer;
  }
  if (
    normalised.includes("web") ||
    normalised.includes("fetch") ||
    normalised.includes("download") ||
    normalised.includes("curl") ||
    normalised.includes("http") ||
    normalised.includes("url")
  ) {
    return Forklift;
  }
  if (
    normalised.includes("read") ||
    normalised.includes("view") ||
    normalised.includes("cat")
  ) {
    return ScrollText;
  }
  if (
    normalised.includes("grep") ||
    normalised.includes("search") ||
    normalised.includes("find") ||
    normalised.includes("glob") ||
    normalised.includes("locate")
  ) {
    return Pickaxe;
  }
  if (
    normalised.includes("permit") ||
    normalised.includes("permission")
  ) {
    return HardHat;
  }
  if (
    normalised.includes("task") ||
    normalised.includes("todo") ||
    normalised.includes("plan")
  ) {
    return ClipboardCheck;
  }
  if (
    normalised.includes("agent") ||
    normalised.includes("team") ||
    normalised.includes("crew") ||
    normalised.includes("worker")
  ) {
    return HardHat;
  }
  if (
    normalised.includes("message") ||
    normalised.includes("ask") ||
    normalised.includes("question") ||
    normalised.includes("chat")
  ) {
    return Radio;
  }
  if (
    normalised.includes("image") ||
    normalised.includes("draw") ||
    normalised.includes("paint")
  ) {
    return Paintbrush;
  }
  return Wrench;
}
