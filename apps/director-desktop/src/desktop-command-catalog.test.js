import { describe, expect, it } from "vitest";

import { getChannelCommandDefinitionsForSurface } from "@hotflow/channels-core";

import {
  buildDirectorDesktopAction,
  buildDirectorDesktopCliArgv,
  findDirectorDesktopCommand,
  listDirectorDesktopCommandCatalog,
} from "./desktop-command-catalog.js";

describe("director desktop command catalog", () => {
  it("returns stable groups with unique command ids", () => {
    const firstCatalog = listDirectorDesktopCommandCatalog();
    const secondCatalog = listDirectorDesktopCommandCatalog();
    const commands = flattenCommands(firstCatalog);
    const ids = commands.map((command) => command.id);

    expect(firstCatalog.map((group) => group.id)).toEqual([
      "workspace",
      "learning",
      "knowledge",
      "director",
      "run",
      "memory",
      "trace-proposal",
      "task",
      "adapters",
    ]);
    expect(ids).toHaveLength(new Set(ids).size);
    expect(secondCatalog).toEqual(firstCatalog);
  });

  it("describes every command with handler type and args schema", () => {
    const commands = flattenCommands(listDirectorDesktopCommandCatalog());

    for (const command of commands) {
      expect(command).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          label: expect.any(String),
          domain: expect.any(String),
          description: expect.any(String),
          args: expect.objectContaining({
            type: "object",
            properties: expect.any(Object),
            required: expect.any(Array),
          }),
          handler: expect.objectContaining({
            type: expect.stringMatching(/^(desktopAction|cliCommand)$/u),
          }),
        }),
      );
    }
  });

  it("covers the desktop console's core Director domains", () => {
    const commands = flattenCommands(listDirectorDesktopCommandCatalog());
    const ids = new Set(commands.map((command) => command.id));
    const domains = new Set(commands.map((command) => command.domain));
    const handlerTypes = new Set(commands.map((command) => command.handler.type));

    expect(domains).toEqual(
      new Set([
        "workspace",
        "settings",
        "learning",
        "experience",
        "knowledge",
        "director",
        "run",
        "memory",
        "task",
        "proposal",
        "adapter",
        "platform",
        "production",
      ]),
    );
    expect(handlerTypes).toEqual(new Set(["desktopAction", "cliCommand"]));
    expect(
      hasEvery(ids, [
        "workspace.bootstrap",
        "workspace.doctor",
        "workspace.status",
        "workspace.acceptance",
        "settings.set",
        "gateway.weixin.status",
        "gateway.weixin.start",
        "gateway.weixin.stop",
        "gateway.weixin.restart",
        "apiProvider.set",
        "apiProvider.syncModels",
        "apiProvider.test",
        "apiProvider.image",
        "desktop.snapshot",
        "desktop.pickDirectory",
        "selfReflection.daily",
        "learning.directory",
        "learning.query",
        "learning.url",
        "learning.mediaUnderstand",
        "learning.text",
        "experience.list",
        "experience.edit",
        "experience.accept",
        "experience.promote",
        "knowledge.candidates",
        "knowledge.accept",
        "knowledge.publish",
        "knowledge.recallPreview",
        "director.plan",
        "director.planAccept",
        "director.planIgnore",
        "director.planRerun",
        "director.intake",
        "director.evaluate",
        "director.blueprint",
        "run.create",
        "run.start",
        "run.audit",
        "run.approve",
        "run.approvePending",
        "run.continue",
        "run.retry",
        "memory.status",
        "memory.publications",
        "memory.publicationDemote",
        "memory.publicationRetract",
        "memory.publicationQuarantine",
        "memory.publicationRestore",
        "memory.recallPreview",
        "evidence.list",
        "evidence.view",
        "evidence.content",
        "maintenance.preview",
        "maintenance.apply",
        "control.memoryInspect",
        "control.memoryClear",
        "task.status",
        "task.mailbox",
        "task.proposalList",
        "task.proposal-apply",
        "task.proposalRollback",
        "traceProposal.list",
        "traceProposal.accept",
        "traceProposal.reject",
        "adapter.list",
        "adapter.register",
        "adapter.enable",
        "platform.capabilities",
      ]),
    ).toBe(true);
  });

  it("links executable desktop commands back to shared channel commands", () => {
    expect(command("production.start").channelCommand).toMatchObject({
      id: "production.start",
      canonicalName: "制作",
      outputPolicy: "result-first",
    });
    expect(command("experience.list").channelCommand).toMatchObject({
      id: "experience.list",
      canonicalName: "经验列表",
    });
    expect(command("knowledge.publish").channelCommand).toMatchObject({
      id: "knowledge.publish",
      canonicalName: "发布知识",
    });
    expect(command("apiProvider.test").channelCommand).toMatchObject({
      id: "settings.provider.test",
      canonicalName: "测试供应方",
    });
    expect(command("apiProvider.syncModels").channelCommand).toMatchObject({
      id: "settings.provider.test",
      canonicalName: "测试供应方",
    });
    expect(command("adapter.register").channelCommand).toMatchObject({
      id: "tools.register",
      canonicalName: "注册工具",
    });
    expect(command("task.proposalList").channelCommand).toMatchObject({
      id: "skills.list",
      canonicalName: "Skill列表",
    });
    expect(command("selfReflection.daily").channelCommand).toMatchObject({
      id: "selfReflection.daily",
      canonicalName: "每日反省",
      memoryPolicy: "never-store",
    });
  });

  it("keeps every shared desktop channel command represented in the desktop catalog", () => {
    const sharedDesktopIds = getChannelCommandDefinitionsForSurface("desktop").map(
      (command) => command.id,
    );
    const catalogChannelIds = new Set(
      flattenCommands(listDirectorDesktopCommandCatalog())
        .map((command) => command.channelCommand?.id)
        .filter((commandId) => typeof commandId === "string"),
    );

    expect(sharedDesktopIds.filter((commandId) => !catalogChannelIds.has(commandId))).toEqual([]);
  });

  it("builds CLI argv for required, flag, positional, array, and boolean args", () => {
    expect(() => buildDirectorDesktopCliArgv(command("director.intake"), {})).toThrow(
      "Command director.intake requires input.",
    );

    expect(
      buildDirectorDesktopCliArgv(command("run.retry"), {
        runId: "run-1",
        assignmentId: "assign-2",
        host: "http://localhost:4317",
      }),
    ).toEqual([
      "director",
      "run",
      "retry",
      "--run-id",
      "run-1",
      "--assignment-id",
      "assign-2",
      "--host",
      "http://localhost:4317",
    ]);

    expect(buildDirectorDesktopCliArgv(command("task.status"), { sessionId: "session-1" })).toEqual(
      ["task", "status", "session-1"],
    );

    expect(
      buildDirectorDesktopCliArgv(command("memory.recallPreview"), {
        projectId: "project-1",
        tags: "agent, memory,, recall ",
        maxHits: "5",
      }),
    ).toEqual([
      "director",
      "memory",
      "recall-preview",
      "--project-id",
      "project-1",
      "--tag",
      "agent",
      "--tag",
      "memory",
      "--tag",
      "recall",
      "--max-hits",
      "5",
    ]);

    expect(
      buildDirectorDesktopCliArgv(command("memory.recallPreview"), {
        tags: ["first", "", "second"],
      }),
    ).toEqual(["director", "memory", "recall-preview", "--tag", "first", "--tag", "second"]);

    expect(
      buildDirectorDesktopCliArgv(command("memory.publicationDemote"), {
        recordId: "memory-1",
        note: "low confidence",
      }),
    ).toEqual([
      "director",
      "memory",
      "publication-demote",
      "--record-id",
      "memory-1",
      "--note",
      "low confidence",
    ]);

    expect(
      buildDirectorDesktopCliArgv(command("evidence.list"), {
        runId: "run-1",
        limit: "10",
      }),
    ).toEqual([
      "director",
      "evidence",
      "list",
      "--run-id",
      "run-1",
      "--limit",
      "10",
    ]);

    expect(
      buildDirectorDesktopCliArgv(command("task.proposal-accept"), {
        sessionId: "session-1",
        proposalId: "proposal-1",
        note: "approved",
      }),
    ).toEqual([
      "task",
      "proposal-accept",
      "session-1",
      "--proposal-id",
      "proposal-1",
      "--decision-note",
      "approved",
    ]);

    const booleanCommand = {
      id: "test.boolean",
      args: {
        type: "object",
        properties: {
          host: { type: "string" },
          json: { type: "boolean" },
        },
        required: [],
      },
      handler: {
        type: "cliCommand",
        argv: ["director", "doctor"],
        argMap: {
          host: { flag: "--host" },
          json: { flag: "--json" },
        },
      },
    };

    expect(
      buildDirectorDesktopCliArgv(booleanCommand, {
        host: "http://localhost:4317",
        json: "on",
      }),
    ).toEqual(["director", "doctor", "--host", "http://localhost:4317", "--json"]);
    expect(buildDirectorDesktopCliArgv(booleanCommand, { json: "false" })).toEqual([
      "director",
      "doctor",
    ]);
  });

  it("normalizes desktop action args", () => {
    expect(
      buildDirectorDesktopAction(command("learning.directory"), {
        directory: "/tmp/project",
        privacy: "internal",
        maxDepth: "3",
        ignored: "not forwarded",
      }),
    ).toEqual({
      type: "experience.learnDirectory",
      directory: "/tmp/project",
      privacy: "internal",
      maxDepth: 3,
    });

    expect(
      buildDirectorDesktopAction(command("learning.text"), {
        text: "AI短剧基础知识\n先确认画面目的，再选择景别。",
        title: "AI短剧基础知识",
        privacy: "internal",
      }),
    ).toEqual({
      type: "experience.learnText",
      text: "AI短剧基础知识\n先确认画面目的，再选择景别。",
      title: "AI短剧基础知识",
      privacy: "internal",
    });

    expect(
      buildDirectorDesktopAction(command("learning.mediaUnderstand"), {
        artifactId: "learning-artifact-1",
        sourceRef: "https://x.com/ponyodong/status/2055150198989746559",
        mode: "low_cost",
        userAuthorized: "true",
        tokenBudget: "7200",
        maxAssets: "2",
        ignored: "not forwarded",
      }),
    ).toEqual({
      type: "learning.mediaUnderstand",
      artifactId: "learning-artifact-1",
      sourceRef: "https://x.com/ponyodong/status/2055150198989746559",
      mode: "low_cost",
      userAuthorized: true,
      tokenBudget: 7200,
      maxAssets: 2,
    });

    expect(
      buildDirectorDesktopAction(command("experience.edit"), {
        candidateId: "experience-1",
        summary: "经验提炼：先按剧情节拍选择景别。",
        applicability: "短剧分镜前使用。",
        risks: "不要机械套用\n保留剧情目的",
        tags: "manual-edit,director-shot",
      }),
    ).toEqual({
      type: "experience.update",
      candidateId: "experience-1",
      summary: "经验提炼：先按剧情节拍选择景别。",
      applicability: "短剧分镜前使用。",
      risks: ["不要机械套用", "保留剧情目的"],
      tags: ["manual-edit", "director-shot"],
    });

    expect(
      buildDirectorDesktopAction(command("knowledge.recallPreview"), {
        projectId: 123,
        groupId: "director-shot",
        anchorId: "anchor-a",
        adapterId: "seedance-preview",
        generationType: "image",
        generationStyle: "cinematic",
        tags: "alpha, beta,,gamma",
        maxHits: "7",
        maxChars: "bad-number",
      }),
    ).toEqual({
      type: "knowledge.recallPreview",
      projectId: "123",
      groupId: "director-shot",
      anchorId: "anchor-a",
      adapterId: "seedance-preview",
      generationType: "image",
      generationStyle: "cinematic",
      tags: ["alpha", "beta", "gamma"],
      maxHits: 7,
    });

    expect(
      buildDirectorDesktopAction(command("apiProvider.set"), {
        providerId: "memefast-api",
        key: "apiKey",
        value: "sk-real-secret",
      }),
    ).toEqual({
      type: "apiProvider.set",
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-real-secret",
    });

    expect(
      buildDirectorDesktopAction(command("settings.textModel"), {
        providerId: "memefast-api",
        value: "gemini-2.5-flash",
      }),
    ).toEqual({
      type: "apiProvider.set",
      providerId: "memefast-api",
      key: "defaultTextModel",
      value: "gemini-2.5-flash",
    });

    expect(
      buildDirectorDesktopAction(command("apiProvider.syncModels"), {
        providerId: "memefast-api",
        baseUrl: "https://proxy.example.test/v1",
      }),
    ).toEqual({
      type: "apiProvider.syncModels",
      providerId: "memefast-api",
      baseUrl: "https://proxy.example.test/v1",
    });

    expect(buildDirectorDesktopAction(command("heartbeat.start"))).toEqual({
      type: "settings.set",
      parameterId: "feature:heartbeat.enabled",
      value: true,
    });
    expect(
      buildDirectorDesktopAction(command("selfReflection.daily"), {
        date: "2026-05-03",
      }),
    ).toEqual({
      type: "selfReflection.daily",
      date: "2026-05-03",
    });
    expect(
      buildDirectorDesktopAction(command("maintenance.preview"), {
        logRetentionDays: "7",
        staleUnreviewedMinimumScore: "50",
      }),
    ).toEqual({
      type: "maintenance.preview",
      logRetentionDays: 7,
      staleUnreviewedMinimumScore: 50,
    });
    expect(
      buildDirectorDesktopAction(command("maintenance.apply"), {
        logRetentionDays: "7",
      }),
    ).toEqual({
      type: "maintenance.apply",
      logRetentionDays: 7,
    });

    expect(
      buildDirectorDesktopAction(command("run.approve"), {
        runId: "run-1",
        assignmentId: "assignment-2",
      }),
    ).toEqual({
      type: "run.approveAssignment",
      runId: "run-1",
      assignmentId: "assignment-2",
    });
    expect(buildDirectorDesktopAction(command("run.approvePending"), { runId: "run-1" })).toEqual({
      type: "run.approvePendingAssignments",
      runId: "run-1",
    });

    expect(() => buildDirectorDesktopAction(command("learning.directory"), {})).toThrow(
      "Command learning.directory requires directory.",
    );
  });
});

function flattenCommands(catalog) {
  return catalog.flatMap((group) => group.commands);
}

function command(id) {
  const found = findDirectorDesktopCommand(id);
  expect(found).not.toBeNull();
  return found;
}

function hasEvery(set, values) {
  return values.every((value) => set.has(value));
}
