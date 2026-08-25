import {
  File,
  FilePen,
  Globe,
  ListTodo,
  MessageSquare,
  Search,
  Shield,
  Terminal,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export function toolIconFor(tool: string): LucideIcon {
  const normalised = tool.toLowerCase();
  if (normalised.includes("bash") || normalised.includes("shell")) {
    return Terminal;
  }
  if (normalised.includes("write") || normalised.includes("edit")) {
    return FilePen;
  }
  if (normalised.includes("read") || normalised.includes("glob")) {
    return File;
  }
  if (normalised.includes("grep") || normalised.includes("search")) {
    return Search;
  }
  if (normalised.includes("web") || normalised.includes("fetch")) {
    return Globe;
  }
  if (normalised.includes("permit") || normalised.includes("permission")) {
    return Shield;
  }
  if (normalised.includes("task") || normalised.includes("todo")) {
    return ListTodo;
  }
  if (normalised.includes("agent") || normalised.includes("team")) {
    return Users;
  }
  if (normalised.includes("message")) {
    return MessageSquare;
  }
  return Wrench;
}
