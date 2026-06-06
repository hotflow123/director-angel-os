import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionStore } from "@hotflow/sessions";
import {
  SkillManagementStore,
  SkillSnapshotFileStore,
  resolveApprovedSkillSnapshotPath,
  resolveSkillManagementPath,
} from "@hotflow/skills";
import { afterEach, describe, expect, it } from "vitest";

import {
  type DirectorCapabilitySurface,
  resolveDirectorCapabilityContext,
  resolveDirectorWorkspaceCapabilityContext,
} from "../src/capability-adapter.js";
import { FileKnowledgeStore } from "../src/store.js";
import type { DirectorKnowledgePackDocument } from "../src/types.js";

describe("Director capability adapter", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["desktop-chat", ["chat"], 3, 900, 520, 320],
    ["weixin-chat", ["chat"], 2, 700, 420, 220],
    ["production", ["production", "workflow"], 5, 1_400, 720, 420],
    ["comfyui-workflow", ["comfyui", "script", "image", "video", "workflow"], 4, 1_200, 650, 320],
  ] satisfies readonly [
    DirectorCapabilitySurface,
    readonly string[],
    number,
    number,
    number,
    number,
  ][])(
    "applies bounded recall policy for %s",
    (surface, expectedTags, maxHits, maxChars, maxSkillChars, maxMemoryChars) => {
      const packet = resolveDirectorCapabilityContext({
        surface,
        userText: "创建 ComfyUI 脚本+图片+视频工作流",
        knowledgeEnabled: true,
        knowledgeDocuments: [],
        skillSections: [],
        longTermMemorySignals: [],
      });

      expect(packet.policy).toMatchObject({
        surface,
        knowledgeMaxHits: maxHits,
        knowledgeMaxChars: maxChars,
        skillMaxChars: maxSkillChars,
        memoryMaxChars: maxMemoryChars,
        userVisible: "summary-only",
      });
      expect(packet.policy.defaultTags).toEqual(expect.arrayContaining(expectedTags));
      expect(packet.capabilityPlan.map((item) => item.userVisible)).toEqual([
        "summary-only",
        "summary-only",
        "summary-only",
      ]);
    },
  );

  it("uses hidden prompt context and keeps user-visible output as a compact summary", () => {
    const packet = resolveDirectorCapabilityContext({
      surface: "desktop-chat",
      userText: "帮我写一个 backend teaser",
      knowledgeEnabled: true,
      knowledgeDocuments: [],
      skillSections: [
        {
          id: "skill.backend",
          content: "Skill: Backend Teaser\nKeep continuity visible.",
          metadata: { skillId: "skill.backend", matchScore: 4 },
        },
      ],
      longTermMemorySignals: [
        {
          id: "long-term-memory:memory",
          description: "用户喜欢结果优先。",
        },
      ],
    });

    expect(packet.hiddenPromptBlock).toContain("Director Angel contextual recall");
    expect(packet.visibleSummary).toBe("已参考：Skill 1 个、记忆 1 条。");
    expect(packet.policy.userVisible).toBe("summary-only");
    expect(packet.policy.hiddenContext).toBe(true);
    expect(packet.policy.traceEnabled).toBe(true);
    expect(packet.skillHits).toEqual([{ id: "skill.backend", title: "Backend Teaser" }]);
  });

  it("merges working-memory recall blocks into the shared memory lane", () => {
    const packet = resolveDirectorCapabilityContext({
      surface: "desktop-chat",
      userText: "按小猫旅行记上次风格继续",
      knowledgeEnabled: true,
      knowledgeDocuments: [],
      skillSections: [],
      longTermMemorySignals: [
        {
          id: "long-term-memory:user",
          description: "用户偏好中文、结果优先。",
        },
      ],
      workingMemoryRecall: {
        blockId: "working-memory-recall",
        source: "working-memory",
        scope: {
          sessionId: "weixin:alice",
          namespace: "director-angel",
        },
        query: "小猫旅行记",
        items: [
          {
            id: "mempalace:scene-style",
            layer: "layer1",
            content: "小猫旅行记上次确认使用温暖治愈、三镜头结构。",
            score: 0.91,
            updatedAt: 1_777_000,
            metadata: {
              source: "mempalace",
              providerId: "desktop-working-memory",
              providerKind: "mempalace",
              directStoreAccessAllowed: false,
              matchMode: "drawer+closet",
              vectorSimilarity: 0.91,
              bm25Score: 0.67,
              wing: "story",
              room: "cat-travel",
              sourceFile: "cat-travel.md",
              drawerIndex: 2,
              totalDrawers: 5,
              memoryLayer: "L2",
              layerLabel: "L2 On-Demand",
            },
          },
        ],
      },
    });

    expect(packet.hiddenPromptBlock).toContain("long-term-memory:user");
    expect(packet.hiddenPromptBlock).toContain("working-memory:mempalace:scene-style");
    expect(packet.hiddenPromptBlock).toContain("小猫旅行记上次确认使用温暖治愈");
    expect(packet.visibleSummary).toBe("已参考：记忆 2 条。");
    expect(packet.recallTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "memory",
          status: "hit",
          id: "working-memory:mempalace:scene-style",
          reason: expect.stringContaining("working memory"),
          score: 0.91,
          query: "小猫旅行记",
          matchMode: "drawer+closet",
          retrieval: expect.objectContaining({
            provider: "mempalace",
            providerId: "desktop-working-memory",
            providerKind: "mempalace",
            directStoreAccessAllowed: false,
            wing: "story",
            room: "cat-travel",
            sourceFile: "cat-travel.md",
            memoryLayer: "L2",
            layerLabel: "L2 On-Demand",
            bm25Score: 0.67,
            vectorSimilarity: 0.91,
          }),
        }),
      ]),
    );
    expect(packet.capabilityPlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "memory.recall",
          status: "hit",
          hitCount: 2,
        }),
      ]),
    );
  });

  it("renders MemPalace working memory as verbatim-first context with source pointers", () => {
    const packet = resolveDirectorCapabilityContext({
      surface: "desktop-chat",
      userText: "按小猫旅行记上次风格继续",
      knowledgeEnabled: true,
      knowledgeDocuments: [],
      skillSections: [],
      workingMemoryRecall: {
        blockId: "working-memory-recall",
        source: "working-memory",
        scope: {
          sessionId: "desktop:main",
          namespace: "director-angel",
        },
        query: "小猫旅行记",
        items: [
          {
            id: "mempalace:scene-style",
            layer: "layer1",
            content: "摘要：小猫旅行记是温暖治愈。",
            score: 0.91,
            updatedAt: 1_777_000,
            metadata: {
              source: "mempalace",
              matchMode: "drawer+closet",
              wing: "story",
              room: "cat-travel",
              sourceFile: "cat-travel.md",
              drawerIndex: 2,
              totalDrawers: 5,
              memoryLayer: "L2",
              layerLabel: "L2 On-Demand",
              verbatim:
                "原文：用户上次确认小猫旅行记要使用温暖治愈、三镜头结构。\n第二句要求镜头按场景拆，不要只保留抽象摘要。",
              verbatimExcerpt: "原文：用户上次确认小猫旅行记要使用温暖治愈、三镜头结构。",
            },
          },
        ],
      },
    });

    expect(packet.hiddenPromptBlock).toContain("原文片段");
    expect(packet.hiddenPromptBlock).toContain(
      "原文：用户上次确认小猫旅行记要使用温暖治愈、三镜头结构。",
    );
    expect(packet.hiddenPromptBlock).toContain("来源指针：sourceFile=cat-travel.md");
    expect(packet.hiddenPromptBlock).toContain("wing=story");
    expect(packet.hiddenPromptBlock).toContain("drawer=2/5");
    expect(packet.hiddenPromptBlock).toContain("memoryLayer=L2");
    expect(packet.hiddenPromptBlock).not.toContain("只保留抽象摘要");
    expect(packet.recallTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "working-memory:mempalace:scene-style",
          memoryLayer: "L2",
          retrieval: expect.objectContaining({
            memoryLayer: "L2",
            layerLabel: "L2 On-Demand",
          }),
        }),
      ]),
    );
  });

  it("keeps current working memory when long-term memory fills the surface limit", () => {
    const packet = resolveDirectorCapabilityContext({
      surface: "weixin-chat",
      userText: "按上次那个微信开场风格继续",
      knowledgeEnabled: true,
      knowledgeDocuments: [],
      skillSections: [],
      longTermMemorySignals: [
        {
          id: "long-term-memory:memory",
          description: "微信对话要结果优先。",
        },
        {
          id: "long-term-memory:user",
          description: "用户喜欢中文短回复。",
        },
      ],
      workingMemoryRecall: {
        blockId: "working-memory-recall",
        source: "working-memory",
        scope: {
          sessionId: "weixin:alice",
          namespace: "director-angel",
        },
        query: "微信开场风格",
        items: [
          {
            id: "mempalace:opening-style",
            layer: "layer1",
            content: "上次确认微信开场要短、直接、结果优先。",
            score: 0.94,
            updatedAt: 1_777_000,
          },
        ],
      },
    });

    expect(packet.policy.memoryMaxSignals).toBe(2);
    expect(packet.hiddenPromptBlock).toContain("working-memory:mempalace:opening-style");
    expect(packet.hiddenPromptBlock).toContain("long-term-memory:memory");
    expect(packet.hiddenPromptBlock).not.toContain("long-term-memory:user");
    expect(packet.visibleSummary).toBe("已参考：记忆 2 条。");
  });

  it("surfaces working-memory degradation through the shared memory lane", () => {
    const packet = resolveDirectorCapabilityContext({
      surface: "desktop-chat",
      userText: "记忆状态",
      workingMemoryRecall: {
        blockId: "working-memory-recall",
        source: "working-memory",
        scope: {
          sessionId: "desktop:workbench",
        },
        items: [],
        degraded: {
          reason: "mempalace-timeout",
          message: "MemPalace search timed out",
        },
      },
    });

    expect(packet.recallStatus).toBe("degraded");
    expect(packet.visibleSummary).toBe("已参考：部分召回降级。");
    expect(packet.hiddenPromptBlock).toContain(
      "Long-term memory degraded: mempalace-timeout: MemPalace search timed out",
    );
    expect(packet.recallTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "memory",
          status: "degraded",
          reason: "mempalace-timeout: MemPalace search timed out",
        }),
      ]),
    );
  });

  it("clamps caller knowledge bounds to the active surface policy", () => {
    const documents = [
      createKnowledgeDocument("director-experience-context-adapter-1"),
      createKnowledgeDocument("director-experience-context-adapter-2"),
      createKnowledgeDocument("director-experience-context-adapter-3"),
    ];

    const packet = resolveDirectorCapabilityContext({
      surface: "weixin-chat",
      userText: "backend snapshot continuity teaser",
      knowledgeEnabled: true,
      knowledgeDocuments: documents,
      knowledgeQuery: {
        tags: ["continuity", "teaser"],
        maxHits: 99,
        maxChars: 99_999,
      },
    });

    expect(packet.policy.knowledgeMaxHits).toBe(2);
    expect(packet.knowledgeHits).toHaveLength(2);
    expect(packet.recallTrace.filter((item) => item.source === "knowledge")).toHaveLength(2);
  });

  it("allows callers to reduce knowledge bounds below the active surface policy", () => {
    const documents = [
      createKnowledgeDocument("director-experience-context-adapter-1"),
      createKnowledgeDocument("director-experience-context-adapter-2"),
    ];

    const packet = resolveDirectorCapabilityContext({
      surface: "production",
      userText: "backend snapshot continuity teaser",
      knowledgeEnabled: true,
      knowledgeDocuments: documents,
      knowledgeQuery: {
        tags: ["continuity", "teaser"],
        maxHits: 1,
      },
    });

    expect(packet.policy.knowledgeMaxHits).toBe(5);
    expect(packet.knowledgeHits).toHaveLength(1);
  });

  it("marks shared recall as hit when only Skills match", () => {
    const packet = resolveDirectorCapabilityContext({
      surface: "desktop-chat",
      userText: "backend teaser",
      knowledgeEnabled: true,
      knowledgeDocuments: [],
      skillSections: [
        {
          id: "skill.backend",
          content: "Skill: Backend Teaser\nKeep continuity visible.",
          metadata: { skillId: "skill.backend", matchScore: 4 },
        },
      ],
    });

    expect(packet.recallStatus).toBe("hit");
    expect(packet.skillStatus).toBe("hit");
    expect(packet.visibleSummary).toBe("已参考：Skill 1 个。");
  });

  it("renders the full comfyui Skill limit instead of hardcoding three sections", () => {
    const packet = resolveDirectorCapabilityContext({
      surface: "comfyui-workflow",
      userText: "ComfyUI 脚本+图片+视频",
      skillSections: [1, 2, 3, 4, 5].map((index) => ({
        id: `skill.comfyui-${index}`,
        content: `Skill: ComfyUI ${index}\nMap scene ${index}.`,
        metadata: { skillId: `skill.comfyui-${index}`, matchScore: 10 - index },
      })),
    });

    expect(packet.policy.skillLimit).toBe(4);
    expect(packet.skillHits.map((hit) => hit.id)).toEqual([
      "skill.comfyui-1",
      "skill.comfyui-2",
      "skill.comfyui-3",
      "skill.comfyui-4",
    ]);
    expect(packet.hiddenPromptBlock).toContain("skill.comfyui-4");
    expect(packet.hiddenPromptBlock).not.toContain("skill.comfyui-5");
  });

  it("loads published knowledge, enabled Skills, and compact memory from one workspace path", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-capability-workspace-"));
    tempRoots.push(workspaceRoot);
    writeSwitches(workspaceRoot, {
      "knowledgeRecall.enabled": true,
      "memory.enabled": true,
    });
    await writePublishedKnowledge(workspaceRoot);
    writeMemory(workspaceRoot);
    writeApprovedSkills(workspaceRoot);

    const packet = await resolveDirectorWorkspaceCapabilityContext({
      workspaceRoot,
      dataDir: join(workspaceRoot, ".hotflow"),
      surface: "desktop-chat",
      userText: "帮我写一句 backend snapshot continuity teaser 的开场白",
      intentTags: ["backend", "snapshot"],
      knowledgeQuery: {
        tags: ["continuity", "teaser"],
      },
    });

    expect(packet.hiddenPromptBlock).toContain("Director Angel contextual recall");
    expect(packet.hiddenPromptBlock).toContain("director-experience-context-adapter");
    expect(packet.hiddenPromptBlock).toContain("Backend Context Adapter Skill");
    expect(packet.hiddenPromptBlock).toContain("Keep stable user preference context");
    expect(packet.visibleSummary).toBe("已参考：经验 1 条、Skill 1 个、记忆 2 条。");
    expect(packet.knowledgeHits).toEqual([
      expect.objectContaining({ id: "director-experience-context-adapter" }),
    ]);
    expect(packet.skillHits).toEqual([
      expect.objectContaining({ id: "skill.backend-context-adapter" }),
    ]);
    expect(packet.recallTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "knowledge", status: "hit" }),
        expect.objectContaining({ source: "skill", status: "hit" }),
        expect.objectContaining({ source: "memory", status: "hit" }),
      ]),
    );
  });

  it("filters workspace Skill recall with Hermes tool availability conditions", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-capability-skill-conditions-"));
    tempRoots.push(workspaceRoot);
    writeSwitches(workspaceRoot, {
      "knowledgeRecall.enabled": false,
      "memory.enabled": false,
    });
    writeApprovedSkills(workspaceRoot, {
      hermes: {
        requires_tools: ["browser_snapshot"],
        requires_toolsets: ["browser"],
      },
    });

    const missing = await resolveDirectorWorkspaceCapabilityContext({
      workspaceRoot,
      dataDir: join(workspaceRoot, ".hotflow"),
      surface: "desktop-chat",
      userText: "backend snapshot browser continuity",
      availableTools: ["web_search"],
      availableToolsets: ["web"],
    });
    const available = await resolveDirectorWorkspaceCapabilityContext({
      workspaceRoot,
      dataDir: join(workspaceRoot, ".hotflow"),
      surface: "desktop-chat",
      userText: "backend snapshot browser continuity",
      availableTools: ["browser_snapshot"],
      availableToolsets: ["browser"],
    });

    expect(missing.skillHits).toEqual([]);
    expect(missing.visibleSummary).toBe("未召回额外上下文。");
    expect(available.skillHits).toEqual([
      expect.objectContaining({ id: "skill.backend-context-adapter" }),
    ]);
    expect(available.hiddenPromptBlock).toContain("Backend Context Adapter Skill");
  });

  it("recalls prior session archive context through the shared memory lane", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-capability-session-search-"));
    tempRoots.push(workspaceRoot);
    writeSwitches(workspaceRoot, {
      "memory.enabled": true,
    });
    writeSessionArchive(workspaceRoot);

    const packet = await resolveDirectorWorkspaceCapabilityContext({
      workspaceRoot,
      dataDir: join(workspaceRoot, ".hotflow"),
      surface: "desktop-chat",
      userText: "按上次那个风格继续",
    });

    expect(packet.hiddenPromptBlock).toContain("Session archive:");
    expect(packet.hiddenPromptBlock).toContain("上次小猫旅行短片采用水墨风格");
    expect(packet.visibleSummary).toBe("已参考：记忆 1 条。");
    expect(packet.recallTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "memory",
          status: "hit",
          id: expect.stringContaining("session-search:"),
          reason: expect.stringContaining("session archive"),
        }),
      ]),
    );
  });

  it("respects recall switches and Skill enablement from the shared workspace path", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-capability-switches-"));
    tempRoots.push(workspaceRoot);
    writeSwitches(workspaceRoot, {
      "knowledgeRecall.enabled": false,
      "memory.enabled": false,
    });
    await writePublishedKnowledge(workspaceRoot);
    writeMemory(workspaceRoot);
    writeApprovedSkills(workspaceRoot, { disableSkill: true });

    const packet = await resolveDirectorWorkspaceCapabilityContext({
      workspaceRoot,
      dataDir: join(workspaceRoot, ".hotflow"),
      surface: "desktop-chat",
      userText: "帮我写一句 backend snapshot continuity teaser 的开场白",
      intentTags: ["backend", "snapshot", "continuity", "teaser"],
    });

    expect(packet.hiddenPromptBlock).toBe("");
    expect(packet.visibleSummary).toBe("未召回额外上下文。");
    expect(packet.recallStatus).toBe("miss");
    expect(packet.skillStatus).toBe("miss");
    expect(packet.knowledgeHits).toEqual([]);
    expect(packet.skillHits).toEqual([]);
    expect(packet.recallTrace).toEqual([]);
  });

  it("does not let working-memory recall bypass the workspace memory switch", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-capability-working-memory-off-"));
    tempRoots.push(workspaceRoot);
    writeSwitches(workspaceRoot, {
      "memory.enabled": false,
    });

    const packet = await resolveDirectorWorkspaceCapabilityContext({
      workspaceRoot,
      dataDir: join(workspaceRoot, ".hotflow"),
      surface: "desktop-chat",
      userText: "按小猫旅行记上次风格继续",
      workingMemoryRecall: {
        blockId: "working-memory-recall",
        source: "working-memory",
        scope: {
          sessionId: "desktop:workbench",
        },
        query: "小猫旅行记",
        items: [
          {
            id: "mempalace:scene-style",
            layer: "layer1",
            content: "这条工作记忆不应该绕过开关。",
            score: 0.9,
            updatedAt: 1,
          },
        ],
      },
    });

    expect(packet.hiddenPromptBlock).toBe("");
    expect(packet.visibleSummary).toBe("未召回额外上下文。");
    expect(packet.recallTrace).toEqual([]);
  });

  it.each([
    [
      "knowledge off only",
      { "knowledgeRecall.enabled": false, "memory.enabled": true },
      false,
      { knowledge: 0, skill: 1, memory: 2, recallStatus: "hit", skillStatus: "hit" },
    ],
    [
      "memory off only",
      { "knowledgeRecall.enabled": true, "memory.enabled": false },
      false,
      { knowledge: 1, skill: 1, memory: 0, recallStatus: "hit", skillStatus: "hit" },
    ],
    [
      "skill disabled only",
      { "knowledgeRecall.enabled": true, "memory.enabled": true },
      true,
      { knowledge: 1, skill: 0, memory: 2, recallStatus: "hit", skillStatus: "miss" },
    ],
  ] satisfies readonly [
    string,
    Record<string, boolean>,
    boolean,
    {
      readonly knowledge: number;
      readonly skill: number;
      readonly memory: number;
      readonly recallStatus: string;
      readonly skillStatus: string;
    },
  ][])(
    "handles independent %s policy without cross-disabling other signals",
    async (_name, switches, disableSkill, expected) => {
      const workspaceRoot = mkdtempSync(join(tmpdir(), "director-capability-matrix-"));
      tempRoots.push(workspaceRoot);
      writeSwitches(workspaceRoot, switches);
      await writePublishedKnowledge(workspaceRoot);
      writeMemory(workspaceRoot);
      writeApprovedSkills(workspaceRoot, { disableSkill });

      const packet = await resolveDirectorWorkspaceCapabilityContext({
        workspaceRoot,
        dataDir: join(workspaceRoot, ".hotflow"),
        surface: "desktop-chat",
        userText: "backend snapshot continuity teaser",
        intentTags: ["backend", "snapshot", "continuity", "teaser"],
      });

      expect(packet.knowledgeHits).toHaveLength(expected.knowledge);
      expect(packet.skillHits).toHaveLength(expected.skill);
      expect(packet.recallTrace.filter((item) => item.source === "memory")).toHaveLength(
        expected.memory,
      );
      expect(packet.recallStatus).toBe(expected.recallStatus);
      expect(packet.skillStatus).toBe(expected.skillStatus);
    },
  );

  it("degrades memory recall on unreadable or invalid memory files instead of swallowing it as miss", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-capability-memory-error-"));
    tempRoots.push(workspaceRoot);
    writeSwitches(workspaceRoot, {
      "memory.enabled": true,
    });
    const memoryDir = join(workspaceRoot, ".director-angel", "memory");
    mkdirSync(join(memoryDir, "MEMORY.md"), { recursive: true });

    const packet = await resolveDirectorWorkspaceCapabilityContext({
      workspaceRoot,
      dataDir: join(workspaceRoot, ".hotflow"),
      surface: "desktop-chat",
      userText: "记忆召回",
    });

    expect(packet.recallStatus).toBe("degraded");
    expect(packet.visibleSummary).toContain("部分召回降级");
    expect(packet.hiddenPromptBlock).toContain("Long-term memory degraded");
  });
});

function writeSwitches(workspaceRoot: string, features: Record<string, boolean>): void {
  const runtimeDir = join(workspaceRoot, ".director-angel", "runtime");
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, "switches.json"),
    `${JSON.stringify({ schemaId: "director.switches.v1", features }, null, 2)}\n`,
    "utf8",
  );
}

async function writePublishedKnowledge(workspaceRoot: string): Promise<void> {
  await new FileKnowledgeStore({
    knowledgeDir: join(workspaceRoot, ".director-angel", "knowledge"),
  }).publish(createKnowledgeDocument());
}

function createKnowledgeDocument(
  id = "director-experience-context-adapter",
): DirectorKnowledgePackDocument {
  return {
    schemaVersion: "director.knowledge.pack.v1",
    metadata: {
      id,
      title: "Use shared context adapter continuity",
      description: "Published lesson for shared runtime context recall.",
      tags: ["experience", "self-learning", "continuity", "teaser"],
      createdAt: "2026-05-03T00:00:00.000Z",
      version: 1,
    },
    stage: "published",
    method: {
      sourceProposalId: "experience:context-adapter",
      sourceRecordId: "record-context-adapter",
      sourceDigestId: "sha256:context-adapter",
      projectId: "experience-learning",
      groupId: "context-adapter",
      goal: "Recall shared context for ordinary chat.",
      trigger: "When continuity teaser planning needs published knowledge.",
      summary: "Keep shared context loading in director-knowledge instead of duplicating surfaces.",
      explanation: "Ordinary chat and tool drafts should use the same bounded recall adapter.",
      evidenceSummary: "shared adapter test fixture",
      roles: ["script-planner"],
      preferredAdapters: [],
      anchorIds: ["context-adapter-anchor"],
      generationType: "self-learning",
      generationStyle: "context-adapter",
    },
    audit: {
      publishedAt: "2026-05-03T00:01:00.000Z",
      author: "director-test",
      note: "published for capability adapter test",
    },
  };
}

function writeMemory(workspaceRoot: string): void {
  const memoryDir = join(workspaceRoot, ".director-angel", "memory");
  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(
    join(memoryDir, "MEMORY.md"),
    "# MEMORY\n\n- Keep stable user preference context in runtime prompts.",
    "utf8",
  );
  writeFileSync(join(memoryDir, "USER.md"), "# USER\n\n- Prefers concise Chinese output.", "utf8");
}

function writeSessionArchive(workspaceRoot: string): void {
  const sessionDir = join(workspaceRoot, ".hotflow", "sessions");
  mkdirSync(sessionDir, { recursive: true });
  const store = new SessionStore({
    dbPath: join(sessionDir, "sessions.sqlite"),
  });
  try {
    const session = store.createSession({
      metadata: {
        title: "小猫旅行短片",
        surface: "desktop-chat",
      },
    });
    store.appendJournal(session.sessionId, {
      eventType: "assistant.output",
      turnId: "turn-watercolor-style",
      payload: {
        summary: "上次小猫旅行短片采用水墨风格，三镜头结构，温暖治愈。",
      },
      createdAtMs: 1_000,
    });
  } finally {
    store.close();
  }
}

function writeApprovedSkills(
  workspaceRoot: string,
  options: {
    readonly disableSkill?: boolean;
    readonly hermes?: Readonly<Record<string, unknown>>;
  } = {},
): void {
  const dataDir = join(workspaceRoot, ".hotflow");
  new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir })).writeApproved([
    {
      id: "skill.backend-context-adapter",
      version: "1.0.0",
      title: "Backend Context Adapter Skill",
      description: "Use shared recall context for backend continuity requests.",
      content: "Route ordinary chat through shared context before answering.",
      tags: ["backend", "snapshot", "continuity"],
      ...(options.hermes === undefined ? {} : { metadata: { hermes: options.hermes } }),
      updatedAtMs: 1,
    },
  ]);
  if (options.disableSkill === true) {
    new SkillManagementStore(resolveSkillManagementPath({ dataDir })).setSkillEnabled(
      "skill.backend-context-adapter",
      false,
      { actor: "test" },
    );
  }
}
