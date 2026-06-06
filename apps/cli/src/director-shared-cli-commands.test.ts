import { getChannelCommandDefinitionsForSurface } from "@hotflow/channels-core";
import { describe, expect, test } from "vitest";

import {
  getDirectorCliSharedCommandMappings,
  resolveDirectorCliSharedCommandArgs,
} from "./director-shared-cli-commands.js";

describe("director shared CLI command mappings", () => {
  test("covers every shared command that declares the CLI surface", () => {
    const sharedCliCommandIds = getChannelCommandDefinitionsForSurface("cli").map(
      (command) => command.id,
    );
    const mappedCommandIds = getDirectorCliSharedCommandMappings().map(
      (mapping) => mapping.commandId,
    );

    expect(mappedCommandIds).toHaveLength(new Set(mappedCommandIds).size);
    expect(
      mappedCommandIds.filter((commandId) => !sharedCliCommandIds.includes(commandId)),
    ).toEqual([]);
    expect(
      sharedCliCommandIds.filter((commandId) => !mappedCommandIds.includes(commandId)),
    ).toEqual([]);
  });

  test("resolves slash learning commands onto existing Director CLI actions", () => {
    expect(resolveDirectorCliSharedCommandArgs("/从URL学习 https://example.test/doc")).toEqual([
      "knowledge",
      "learn",
      "--url",
      "https://example.test/doc",
    ]);
    expect(resolveDirectorCliSharedCommandArgs("/从目录学习 /tmp/materials")).toEqual([
      "knowledge",
      "learn",
      "--directory",
      "/tmp/materials",
    ]);
    expect(resolveDirectorCliSharedCommandArgs("/从主题学习 AI短剧镜头语言")).toEqual([
      "knowledge",
      "learn",
      "--query",
      "AI短剧镜头语言",
    ]);
  });

  test("resolves slash review commands onto existing Director CLI actions", () => {
    expect(resolveDirectorCliSharedCommandArgs("/经验列表")).toEqual([
      "knowledge",
      "experience-list",
    ]);
    expect(resolveDirectorCliSharedCommandArgs("/接受经验 exp-1")).toEqual([
      "knowledge",
      "experience-accept",
      "--candidate-id",
      "exp-1",
    ]);
    expect(resolveDirectorCliSharedCommandArgs("/运行状态 run-1")).toEqual([
      "run",
      "status",
      "--run-id",
      "run-1",
    ]);
    expect(resolveDirectorCliSharedCommandArgs("/记忆 召回 project-1")).toEqual([
      "memory",
      "recall-preview",
      "--project-id",
      "project-1",
    ]);
  });

  test("resolves host entry slash commands onto the concrete CLI message action", () => {
    expect(resolveDirectorCliSharedCommandArgs("/制作 生成一个15秒短剧分镜蓝图")).toEqual([
      "message",
      "--text",
      "/制作 生成一个15秒短剧分镜蓝图",
    ]);
    expect(resolveDirectorCliSharedCommandArgs("/comfyui 一只小猫在公园旅行")).toEqual([
      "message",
      "--text",
      "/ComfyUI 一只小猫在公园旅行",
    ]);
    expect(resolveDirectorCliSharedCommandArgs("/确认")).toEqual(["message", "--text", "确认执行"]);
    expect(resolveDirectorCliSharedCommandArgs("/确认 加入小猫从家到公园")).toEqual([
      "message",
      "--text",
      "确认执行 加入小猫从家到公园",
    ]);
    expect(resolveDirectorCliSharedCommandArgs("/继续运行 run-1")).toEqual([
      "message",
      "--text",
      "继续运行 run-1",
    ]);
    expect(resolveDirectorCliSharedCommandArgs("/批准待审项")).toEqual([
      "message",
      "--text",
      "批准待审项",
    ]);
  });

  test("resolves slash taxonomy commands onto concrete CLI actions", () => {
    expect(resolveDirectorCliSharedCommandArgs("/经验分类 exp-1 director-shot shot-size")).toEqual([
      "knowledge",
      "experience-classify",
      "--candidate-id",
      "exp-1",
      "--category-id",
      "director-shot",
      "--tag-id",
      "shot-size",
    ]);
    expect(resolveDirectorCliSharedCommandArgs("/经验打标 exp-1 shot-size lighting")).toEqual([
      "knowledge",
      "experience-tag",
      "--candidate-id",
      "exp-1",
      "--tag-id",
      "shot-size",
      "--tag-id",
      "lighting",
    ]);
    expect(resolveDirectorCliSharedCommandArgs("/轨迹沉淀经验 proposal-1")).toEqual([
      "knowledge",
      "experience-from-trace-proposal",
      "--proposal-id",
      "proposal-1",
    ]);
    expect(resolveDirectorCliSharedCommandArgs("/Skill分类 skill-1 workflow reusable")).toEqual([
      "skills",
      "classify",
      "--skill-id",
      "skill-1",
      "--category-id",
      "workflow",
      "--tag-id",
      "reusable",
    ]);
  });

  test("resolves slash skill lifecycle commands onto concrete CLI actions", () => {
    expect(resolveDirectorCliSharedCommandArgs("/Skill列表")).toEqual(["skills", "list"]);
    expect(resolveDirectorCliSharedCommandArgs("/从经验生成Skill exp-1")).toEqual([
      "skills",
      "propose-from-experience",
      "--candidate-id",
      "exp-1",
    ]);
    expect(resolveDirectorCliSharedCommandArgs("/接受Skill proposal-1")).toEqual([
      "skills",
      "accept",
      "--proposal-id",
      "proposal-1",
    ]);
    expect(resolveDirectorCliSharedCommandArgs("/拒绝Skill proposal-1 太泛化")).toEqual([
      "skills",
      "reject",
      "--proposal-id",
      "proposal-1",
      "--note",
      "太泛化",
    ]);
    expect(resolveDirectorCliSharedCommandArgs("/调用Skill proposal-1")).toEqual([
      "skills",
      "apply",
      "--proposal-id",
      "proposal-1",
    ]);
  });

  test("resolves local settings slash commands onto concrete CLI actions", () => {
    expect(resolveDirectorCliSharedCommandArgs("/启动心跳")).toEqual([
      "switches",
      "set",
      "--feature",
      "heartbeat.enabled",
      "--enabled",
      "true",
    ]);
    expect(resolveDirectorCliSharedCommandArgs("/设置供应方 memefast-api apiKey key-1")).toEqual([
      "api-providers",
      "set",
      "--provider-id",
      "memefast-api",
      "--key",
      "apiKey",
      "--value",
      "key-1",
    ]);
    expect(
      resolveDirectorCliSharedCommandArgs("/文本模型设置 memefast-api gemini-2.5-flash"),
    ).toEqual([
      "api-providers",
      "set",
      "--key",
      "defaultTextModel",
      "--provider-id",
      "memefast-api",
      "--value",
      "gemini-2.5-flash",
    ]);
    expect(resolveDirectorCliSharedCommandArgs("/维护")).toEqual(["message", "--text", "/维护"]);
    expect(resolveDirectorCliSharedCommandArgs("/维护 执行 日志保留7")).toEqual([
      "message",
      "--text",
      "/维护 执行 日志保留7",
    ]);
  });
});
