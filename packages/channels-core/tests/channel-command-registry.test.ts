import { describe, expect, it } from "vitest";

import {
  getChannelCommandDefinitions,
  getChannelCommandDefinitionsForSurface,
  parseChannelSlashCommand,
  resolveChannelCommandDefinition,
  shouldBypassActiveSession,
} from "../src/index.js";

describe("channel command registry", () => {
  it("keeps command metadata in one registry for every user-facing surface", () => {
    const production = resolveChannelCommandDefinition("制作");
    const learning = resolveChannelCommandDefinition("learn");

    expect(production).toMatchObject({
      id: "production.start",
      outputPolicy: "result-first",
      memoryPolicy: "store-result-only",
      activeSessionPolicy: "execute-now",
    });
    expect(production?.surfaces).toEqual(["desktop", "weixin", "cli"]);
    expect(learning).toMatchObject({
      id: "learning.admit",
      outputPolicy: "review-gated",
      memoryPolicy: "review-gated-source",
    });
    expect(getChannelCommandDefinitions().map((command) => command.id)).toContain("run.confirm");
  });

  it("parses slash commands into a stable command envelope", () => {
    expect(parseChannelSlashCommand("/制作 生成一个15秒短剧分镜蓝图")).toMatchObject({
      commandId: "production.start",
      canonicalName: "制作",
      args: "生成一个15秒短剧分镜蓝图",
      outputPolicy: "result-first",
      memoryPolicy: "store-result-only",
    });
    expect(parseChannelSlashCommand("/脚本 写一个小猫旅行记")).toMatchObject({
      commandId: "production.start",
      canonicalName: "制作",
      matchedName: "脚本",
      args: "写一个小猫旅行记",
      outputPolicy: "result-first",
    });
    expect(parseChannelSlashCommand("/文案 给公园咖啡车写短视频口播")).toMatchObject({
      commandId: "production.start",
      canonicalName: "制作",
      matchedName: "文案",
      args: "给公园咖啡车写短视频口播",
      outputPolicy: "result-first",
    });
    expect(parseChannelSlashCommand("/learn https://example.com/director-guide")).toMatchObject({
      commandId: "learning.admit",
      canonicalName: "学习",
      args: "https://example.com/director-guide",
      outputPolicy: "review-gated",
    });
    expect(parseChannelSlashCommand("/经验 列表")).toMatchObject({
      commandId: "experience.list",
      canonicalName: "经验列表",
      args: "",
      outputPolicy: "status-first",
      memoryPolicy: "never-store",
    });
    expect(parseChannelSlashCommand("/知识 发布 candidate-1")).toMatchObject({
      commandId: "knowledge.publish",
      canonicalName: "发布知识",
      args: "candidate-1",
      outputPolicy: "control-reply",
      memoryPolicy: "never-store",
    });
    expect(parseChannelSlashCommand("/记忆 召回 project=project-1")).toMatchObject({
      commandId: "memory.recallPreview",
      canonicalName: "记忆召回预览",
      args: "project=project-1",
      outputPolicy: "status-first",
      memoryPolicy: "never-store",
    });
    expect(parseChannelSlashCommand("/维护 日志保留 7")).toMatchObject({
      commandId: "maintenance.preview",
      canonicalName: "维护预览",
      args: "日志保留 7",
      outputPolicy: "status-first",
      memoryPolicy: "never-store",
    });
    expect(parseChannelSlashCommand("/维护 执行 日志保留 7")).toMatchObject({
      commandId: "maintenance.apply",
      canonicalName: "执行维护",
      args: "日志保留 7",
      outputPolicy: "control-reply",
      memoryPolicy: "never-store",
    });
    expect(parseChannelSlashCommand("/运行 状态 run-1")).toMatchObject({
      commandId: "run.status",
      canonicalName: "运行状态",
      args: "run-1",
      activeSessionPolicy: "status-only",
    });
    expect(parseChannelSlashCommand("/comfyui 一只小猫在公园旅行")).toMatchObject({
      commandId: "media.comfyui.run",
      canonicalName: "ComfyUI",
      args: "一只小猫在公园旅行",
      outputPolicy: "result-first",
      memoryPolicy: "never-store",
    });
    expect(parseChannelSlashCommand("/工具 列表")).toMatchObject({
      commandId: "tools.list",
      canonicalName: "工具列表",
      outputPolicy: "status-first",
    });
    expect(parseChannelSlashCommand("/技能 列表")).toMatchObject({
      commandId: "skills.list",
      canonicalName: "Skill列表",
      outputPolicy: "status-first",
    });
    expect(parseChannelSlashCommand("/运行 继续 run-1")).toMatchObject({
      commandId: "run.continue",
      canonicalName: "继续运行",
      args: "run-1",
      activeSessionPolicy: "execute-now",
    });
  });

  it("marks control commands as active-session bypass and leaves unknown slash text alone", () => {
    expect(shouldBypassActiveSession("run.confirm")).toBe(true);
    expect(shouldBypassActiveSession("production.start")).toBe(true);
    expect(parseChannelSlashCommand("/不存在 参数")).toBeNull();
    expect(parseChannelSlashCommand("制作一个小猫旅游记")).toBeNull();
  });

  it("covers the main Director Angel capability families without alias collisions", () => {
    const definitions = getChannelCommandDefinitions();
    const commandIds = definitions.map((command) => command.id);

    expect(commandIds).toEqual(
      expect.arrayContaining([
        "experience.list",
        "experience.accept",
        "experience.reject",
        "experience.promote",
        "experience.fromRunReport",
        "knowledge.candidates",
        "knowledge.accept",
        "knowledge.publish",
        "knowledge.recallPreview",
        "memory.status",
        "memory.recallPreview",
        "maintenance.preview",
        "maintenance.apply",
        "skills.list",
        "skills.accept",
        "skills.apply",
        "tools.list",
        "tools.register",
        "settings.providers",
        "settings.provider.test",
        "media.comfyui.run",
        "heartbeat.status",
        "soul.status",
      ]),
    );

    const aliases = definitions.flatMap((command) => [command.canonicalName, ...command.aliases]);
    const normalizedAliases = aliases.map((alias) =>
      alias.trim().replace(/\s+/gu, " ").toLowerCase(),
    );
    expect(new Set(normalizedAliases).size).toBe(normalizedAliases.length);
  });

  it("projects commands by channel surface", () => {
    const cliCommands = getChannelCommandDefinitionsForSurface("cli");
    const cliIds = cliCommands.map((command) => command.id);

    expect(cliIds).toContain("production.start");
    expect(cliIds).toContain("experience.list");
    expect(cliIds).toContain("settings.provider.test");
    expect(cliCommands.every((command) => command.surfaces.includes("cli"))).toBe(true);

    const weixinIds = getChannelCommandDefinitionsForSurface("weixin").map((command) => command.id);
    expect(weixinIds).toContain("production.start");
    expect(weixinIds).toContain("media.comfyui.run");
    expect(weixinIds).toContain("experience.accept");
    expect(weixinIds).toContain("memory.status");
    expect(weixinIds).toContain("memory.recallPreview");
    expect(weixinIds).toContain("maintenance.preview");
    expect(weixinIds).toContain("maintenance.apply");
    expect(weixinIds).not.toContain("settings.provider.test");
  });
});
