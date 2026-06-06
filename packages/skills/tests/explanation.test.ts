import { describe, expect, test } from "vitest";

import {
  createSkillCuratorExplanationSurface,
  createSkillExplanationSurface,
  formatSkillExplanationSurfaceForToolObservation,
} from "../src/index.js";

describe("Skill explanation surface", () => {
  test("explains needs-setup Skills with dependency evidence and next actions", () => {
    const surface = createSkillExplanationSurface({
      skill: {
        id: "skill.twitter-research",
        title: "Twitter Research Skill",
        runtimeStatus: "needs-setup",
        doctorStatus: "needs-setup",
        doctorSummary:
          "Skill 声明的工具尚不可用：x_search。x_search: needs-auth；X provider needs an API key.",
        missingToolNames: ["x_search"],
        nextActions: ["x_search: 配置 X/Twitter API provider。"],
      },
    });

    expect(surface).toMatchObject({
      schemaId: "skills.explanation-surface.v1",
      kind: "skill-runtime",
      status: "needs-setup",
      operatorReviewRequired: false,
      statusExplanation: expect.stringContaining("x_search"),
      nextActions: expect.arrayContaining(["x_search: 配置 X/Twitter API provider。"]),
    });
    expect(surface.summary).toContain("依赖未就绪");
  });

  test("explains missing Skills as stale context that must not be executed", () => {
    const surface = createSkillExplanationSurface({
      requestedSkillId: "skill.removed-twitter",
      skill: {
        id: "skill.removed-twitter",
        runtimeStatus: "missing-skill",
        doctorStatus: "missing-skill",
        doctorSummary: "Skill 不存在或已从当前已批准快照移除。",
      },
    });

    expect(surface).toMatchObject({
      kind: "skill-runtime",
      status: "missing-skill",
      summary: expect.stringContaining("已从当前已批准快照移除"),
      statusExplanation: expect.stringContaining("旧上下文"),
      nextActions: expect.arrayContaining([
        expect.stringContaining("刷新 Skill 索引"),
        expect.stringContaining("不要假装"),
      ]),
    });
  });

  test("explains operator-review model gates without making them model-visible", () => {
    const surface = createSkillExplanationSurface({
      skill: {
        id: "skill.restricted-lesson",
        title: "Restricted Lesson",
        runtimeStatus: "model-invocation-disabled",
        doctorStatus: "model-invocation-disabled",
        modelInvocable: false,
        metadata: {
          privacy: "restricted",
          modelInvocationGate: "restricted-experience",
        },
      },
    });

    expect(surface).toMatchObject({
      status: "model-invocation-disabled",
      operatorReviewRequired: true,
      operatorReviewGate: "restricted-experience",
      operatorReviewExplanation: expect.stringContaining("人工审核"),
    });
    expect(surface.nextActions).toEqual(
      expect.arrayContaining([expect.stringContaining("操作员")]),
    );
  });

  test("explains curator actions as operator-gated local maintenance", () => {
    const surface = createSkillCuratorExplanationSurface({
      kind: "patch",
      skillId: "skill.failed-curator",
      title: "Failed Curator Skill",
      severity: "risky",
      reason: "Skill has 2 recorded failure(s); patch before relying on it again.",
      evidence: {
        useCount: 3,
        failureCount: 2,
        patchCount: 0,
        lastActivityAtMs: 1_777_299_950_000,
        lastUsedAtMs: 1_777_299_900_000,
        lastFailedAtMs: 1_777_299_950_000,
      },
    });

    expect(surface).toMatchObject({
      kind: "skill-curator",
      status: "curator-patch",
      operatorReviewRequired: true,
      curatorExplanation: expect.stringContaining("不会让模型自动改写"),
      evidenceRefs: expect.arrayContaining(["skill-curator://patch/skill.failed-curator"]),
    });
    expect(formatSkillExplanationSurfaceForToolObservation(surface)).toEqual(
      expect.arrayContaining([
        "explanation_status: curator-patch",
        expect.stringContaining("operator_review: yes"),
      ]),
    );
  });
});
