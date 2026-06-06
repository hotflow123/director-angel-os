import { describe, expect, it } from "vitest";

import { createDirectorConversationRuntimeTools } from "../src/director-tools.js";
import type {
  ConversationRuntimeSkillRuntimePort,
  ConversationRuntimeSkillUsageRecord,
} from "../src/index.js";

describe("conversation runtime skill contracts", () => {
  it("keeps skill hit, view, and use as separate runtime actions", async () => {
    const usage: ConversationRuntimeSkillUsageRecord[] = [];
    const runtime: ConversationRuntimeSkillRuntimePort = {
      listIndex: () => [
        {
          id: "storyboard",
          title: "短剧分镜",
          description: "把故事目标拆成镜头。",
          tags: ["production", "storyboard"],
          modelInvocable: true,
          score: 9,
        },
      ],
      view: ({ skillId }) => ({
        skillId,
        title: "短剧分镜",
        content: "先确认主题，再拆场景、景别、运镜、对白。",
        status: "loaded",
        allowedTools: ["knowledge_search", "session_search"],
      }),
      use: ({ skillId }) => ({
        success: true,
        commandName: skillId,
        status: "inline",
        runtimeDelta: {
          newMessages: [
            {
              role: "system",
              content: "应用短剧分镜 Skill：输出镜头表和审核点。",
            },
          ],
        },
      }),
      recordUsage: (record) => {
        usage.push(record);
      },
    };

    const hits = await runtime.listIndex({ userText: "做一个15秒悬疑短剧分镜" });
    expect(hits[0]?.id).toBe("storyboard");
    await runtime.recordUsage?.({
      skillId: "storyboard",
      action: "hit",
      status: "ok",
      occurredAtMs: 1,
    });

    const viewed = await runtime.view({
      skillId: "storyboard",
      reason: "model requested skill_view",
    });
    expect(viewed.status).toBe("loaded");
    await runtime.recordUsage?.({
      skillId: "storyboard",
      action: "view",
      status: "ok",
      occurredAtMs: 2,
    });

    const used = await runtime.use({ skillId: "storyboard", args: "15秒悬疑" });
    expect(used.status).toBe("inline");
    await runtime.recordUsage?.({
      skillId: "storyboard",
      action: "use",
      status: "ok",
      occurredAtMs: 3,
    });

    expect(usage.map((record) => record.action)).toEqual(["hit", "view", "use"]);
  });

  it("can record disabled or missing skills without pretending they were used", async () => {
    const usage: ConversationRuntimeSkillUsageRecord[] = [];
    const runtime: ConversationRuntimeSkillRuntimePort = {
      listIndex: () => [],
      view: ({ skillId }) => ({
        skillId,
        title: skillId,
        content: "",
        status: "disabled",
      }),
      use: ({ skillId }) => ({
        success: false,
        commandName: skillId,
        status: "inline",
      }),
      recordUsage: (record) => {
        usage.push(record);
      },
    };

    const viewed = await runtime.view({ skillId: "disabled-skill" });
    expect(viewed.status).toBe("disabled");
    await runtime.recordUsage?.({
      skillId: "disabled-skill",
      action: "view",
      status: "disabled",
      occurredAtMs: 1,
    });

    expect(usage).toEqual([
      {
        skillId: "disabled-skill",
        action: "view",
        status: "disabled",
        occurredAtMs: 1,
      },
    ]);
  });

  it("exposes skill enablement as an approval-gated management tool", () => {
    const tools = createDirectorConversationRuntimeTools();
    const enablementTool = tools.find((tool) => tool.name === "director.skills.set_enabled");

    expect(enablementTool).toMatchObject({
      readOnly: false,
      metadata: expect.objectContaining({
        capability: "skill.management",
        reviewGated: true,
      }),
    });
    expect(JSON.stringify(enablementTool?.inputSchema)).toContain("skillId");
    expect(JSON.stringify(enablementTool?.inputSchema)).toContain("enabled");
  });

  it("exposes curator write guard as a read-only contract check, not a write tool", () => {
    const tools = createDirectorConversationRuntimeTools();
    const guardTool = tools.find((tool) => tool.name === "director.skills.curator.guard");

    expect(guardTool).toMatchObject({
      readOnly: true,
      metadata: expect.objectContaining({
        capability: "skill.curator.guard",
        guardOnly: true,
      }),
    });
    expect(JSON.stringify(guardTool?.inputSchema)).toContain("action");
    expect(JSON.stringify(guardTool?.inputSchema)).toContain("skillId");
    expect(guardTool?.description).toContain("不会执行");
  });

  it("lets the model query the compact Skill index before loading a Skill body", () => {
    const tools = createDirectorConversationRuntimeTools();
    const listTool = tools.find((tool) => tool.name === "director.skills.list");

    expect(listTool).toMatchObject({
      readOnly: true,
      metadata: expect.objectContaining({
        capability: "skill.index",
      }),
    });
    expect(JSON.stringify(listTool?.inputSchema)).toContain("query");
    expect(JSON.stringify(listTool?.inputSchema)).toContain("limit");
    expect(JSON.stringify(listTool?.inputSchema)).toContain("includeDisabled");
    expect(listTool?.description).toContain("索引");
    expect(listTool?.description).toContain("director.skills.view");
  });

  it("exposes Skill use as a model-callable read-only application step", () => {
    const tools = createDirectorConversationRuntimeTools();
    const useTool = tools.find((tool) => tool.name === "director.skills.use");

    expect(useTool).toMatchObject({
      readOnly: true,
      metadata: expect.objectContaining({
        capability: "skill.use",
      }),
    });
    expect(JSON.stringify(useTool?.inputSchema)).toContain("skillId");
    expect(JSON.stringify(useTool?.inputSchema)).toContain("objective");
    expect(useTool?.description).toContain("不会替代外部工具执行");
    expect(useTool?.description).toContain("guard blocked");
  });

  it("exposes Moyin project readiness as a first-class read-only model tool", () => {
    const tools = createDirectorConversationRuntimeTools();
    const readinessTool = tools.find((tool) => tool.name === "director.moyin.project_readiness");

    expect(readinessTool).toMatchObject({
      readOnly: true,
      metadata: expect.objectContaining({
        capability: "moyin.project_readiness",
      }),
    });
    expect(JSON.stringify(readinessTool?.inputSchema)).toContain("projectName");
    expect(JSON.stringify(readinessTool?.inputSchema)).toContain("projectId");
    expect(readinessTool?.description).toContain("不会创建项目");
    expect(readinessTool?.description).toContain("workflow-run");
  });

  it("describes Skill runtime contracts as conditional load guards", () => {
    const tools = createDirectorConversationRuntimeTools();
    const listTool = tools.find((tool) => tool.name === "director.skills.list");
    const viewTool = tools.find((tool) => tool.name === "director.skills.view");

    expect(listTool?.description).toContain("runtimeContract");
    expect(viewTool?.description).toContain("setupOnLoad");
    expect(viewTool?.description).toContain("fallback");
    expect(viewTool?.description).toContain("guard");
  });
});
