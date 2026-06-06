import { describe, expect, it } from "vitest";

import {
  createDefaultDirectorAngelRoleProfile,
  normalizeConversationRuntimeAngelRoleProfile,
  renderConversationRuntimeAngelRoleSystemContext,
} from "../src/index.js";

describe("angel role profile", () => {
  it("creates a Director Angel default profile without inventing a parallel role type", () => {
    const profile = createDefaultDirectorAngelRoleProfile();

    expect(profile).toMatchObject({
      roleId: "director",
      title: "导演 Angel",
      domain: "影视制作与 AI 工作流",
    });
    expect(profile.responsibilities).toContain("持续学习影视短剧和 AI 制作经验");
    expect(profile.learningScope).toContain("影视短剧");
    expect(profile.controllableSystems).toContain("learning");
  });

  it("normalizes product config aliases into the existing runtime role profile", () => {
    const profile = normalizeConversationRuntimeAngelRoleProfile({
      roleId: " producer ",
      roleName: " 制片 Angel ",
      domain: " AI 制片 ",
      responsibilities: ["排期", "", " 成本控制 "],
      learningFocus: ["短剧投放", " AI 视频 "],
      toolAccess: ["comfyui", "learning", ""],
      metadata: {
        owner: "desktop",
      },
    });

    expect(profile).toEqual({
      roleId: "producer",
      title: "制片 Angel",
      domain: "AI 制片",
      responsibilities: ["排期", "成本控制"],
      learningScope: ["短剧投放", "AI 视频"],
      controllableSystems: ["comfyui", "learning"],
      metadata: {
        owner: "desktop",
      },
    });
  });

  it("renders concise system context instead of raw JSON", () => {
    const profile = createDefaultDirectorAngelRoleProfile({
      responsibilities: ["持续学习影视短剧", "沉淀待审经验"],
      learningScope: ["短剧制作", "AI 分镜"],
    });

    const context = renderConversationRuntimeAngelRoleSystemContext(profile);

    expect(context).toContain("当前岗位：导演 Angel");
    expect(context).toContain("职责：持续学习影视短剧；沉淀待审经验");
    expect(context).toContain("学习范围：短剧制作；AI 分镜");
    expect(context).not.toContain("{");
    expect(context).not.toContain('"roleId"');
  });
});
