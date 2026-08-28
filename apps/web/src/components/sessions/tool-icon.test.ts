import { describe, expect, it } from "vitest";
import { toolIconFor } from "./tool-icon";
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
} from "lucide-react";

describe("toolIconFor construction theme", () => {
  it("maps write, edit, and file modification tools to Hammer", () => {
    expect(toolIconFor("write_to_file")).toBe(Hammer);
    expect(toolIconFor("replace_file_content")).toBe(Hammer);
    expect(toolIconFor("edit")).toBe(Hammer);
    expect(toolIconFor("Write")).toBe(Hammer);
    expect(toolIconFor("patch")).toBe(Hammer);
  });

  it("maps read and view tools to ScrollText", () => {
    expect(toolIconFor("read_file")).toBe(ScrollText);
    expect(toolIconFor("view_file")).toBe(ScrollText);
    expect(toolIconFor("Read")).toBe(ScrollText);
    expect(toolIconFor("cat")).toBe(ScrollText);
  });

  it("maps web, url, and fetch tools to Forklift", () => {
    expect(toolIconFor("web_search")).toBe(Forklift);
    expect(toolIconFor("read_url_content")).toBe(Forklift);
    expect(toolIconFor("fetch")).toBe(Forklift);
  });

  it("maps search, grep, and glob tools to Pickaxe", () => {
    expect(toolIconFor("grep_search")).toBe(Pickaxe);
    expect(toolIconFor("find_by_name")).toBe(Pickaxe);
    expect(toolIconFor("Glob")).toBe(Pickaxe);
    expect(toolIconFor("search_code")).toBe(Pickaxe);
  });

  it("maps bash and command execution tools to Drill", () => {
    expect(toolIconFor("bash")).toBe(Drill);
    expect(toolIconFor("run_command")).toBe(Drill);
    expect(toolIconFor("shell")).toBe(Drill);
    expect(toolIconFor("exec")).toBe(Drill);
  });

  it("maps permit and permission tools to HardHat", () => {
    expect(toolIconFor("permit")).toBe(HardHat);
    expect(toolIconFor("permission")).toBe(HardHat);
  });

  it("maps task and planning tools to ClipboardCheck", () => {
    expect(toolIconFor("task")).toBe(ClipboardCheck);
    expect(toolIconFor("manage_task")).toBe(ClipboardCheck);
    expect(toolIconFor("todo")).toBe(ClipboardCheck);
  });

  it("maps web, url, and fetch tools to Forklift", () => {
    expect(toolIconFor("web_search")).toBe(Forklift);
    expect(toolIconFor("read_url_content")).toBe(Forklift);
    expect(toolIconFor("fetch")).toBe(Forklift);
  });

  it("maps messaging and questions to Radio", () => {
    expect(toolIconFor("send_message")).toBe(Radio);
    expect(toolIconFor("ask_question")).toBe(Radio);
  });

  it("maps image generation to Paintbrush", () => {
    expect(toolIconFor("generate_image")).toBe(Paintbrush);
  });

  it("falls back to Wrench for unknown tools", () => {
    expect(toolIconFor("unknown_special_tool")).toBe(Wrench);
  });
});
