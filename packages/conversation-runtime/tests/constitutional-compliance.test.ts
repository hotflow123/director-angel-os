import { describe, expect, it } from "vitest";

import {
  createConversationRuntimeLearningArtifactProjection,
  createDefaultDirectorAngelRoleProfile,
  createLearningArtifactStore,
  createPendingLearningArtifactFromResult,
  createRoleScopedScheduledLearningBackgroundScheduleDefinition,
  createRoleScopedScheduledLearningTaskPolicy,
  resolveScheduledLearningExecutionPlan,
} from "../src/index.js";

describe("constitutional compliance", () => {
  it("keeps role-scoped scheduled learning candidate-only and review-gated", () => {
    const roleProfile = createDefaultDirectorAngelRoleProfile({
      learningScope: ["短剧制作", "AI 分镜"],
    });
    const policy = createRoleScopedScheduledLearningTaskPolicy({
      roleProfile,
      taskId: "director-daily-learning",
      title: "导演每日学习",
      sources: ["https://x.com/example"],
      cadence: "daily",
      admissionMode: "auto_stage",
    });
    const schedule = createRoleScopedScheduledLearningBackgroundScheduleDefinition(policy);
    const plan = resolveScheduledLearningExecutionPlan(policy, {
      discoveredMedia: { imageCount: 0, videoCount: 0, audioCount: 0 },
      textQuality: "trusted",
    });

    expect(policy).toMatchObject({
      admissionMode: "confirm_before_publish",
      candidateOnly: true,
      autoPublish: false,
      sourcePolicy: {
        qualityGate: "high_signal_only",
        candidateOnly: true,
      },
    });
    expect(plan.requiresUserConfirmation).toBe(true);
    expect(schedule.metadata).toMatchObject({
      scheduledLearning: true,
      admissionMode: "confirm_before_publish",
      candidateOnly: true,
      autoPublish: false,
      memorySync: "skip-auto-write",
    });
    expect(schedule.objective).toContain("只生成待审经验候选");
    expect(schedule.objective).toContain("不得自动发布");
  });

  it("quarantines role-irrelevant learning and does not create pending confirmation", () => {
    const store = createLearningArtifactStore({ nowMs: () => 1_000 });
    const result = createPendingLearningArtifactFromResult({
      store,
      sessionKey: "role:director:learning",
      turnRunId: "turn-run-off-scope",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef: "https://example.test/gardening",
      roleScope: {
        roleName: "导演 Angel",
        domain: "影视制作与 AI 工作流",
        responsibilityTags: ["短剧制作", "AI 分镜", "镜头语言"],
      },
      observedAtMs: 1_000,
      result: {
        result: {
          candidateCount: 1,
          candidateIds: ["gardening-candidate"],
        },
        candidates: [
          {
            candidateId: "gardening-candidate",
            title: "阳台番茄种植经验",
            summary: "浇水、施肥和土壤配比决定番茄产量。",
          },
        ],
      },
    });

    expect(result.reason).toBe("role-scope-mismatch");
    expect(result.confirmation).toBeUndefined();
    expect(result.artifact).toMatchObject({
      status: "quarantined",
      publishable: false,
      classification: expect.objectContaining({
        roleRelevance: "off_scope",
      }),
      qualityGates: expect.arrayContaining(["role_scope_mismatch"]),
    });
    expect(store.listPendingConfirmations("role:director:learning")).toHaveLength(0);
  });

  it("does not leak internal learning templates into user-facing replies", () => {
    const projection = createConversationRuntimeLearningArtifactProjection({
      source: "url",
      query: "https://example.test/seedance",
      candidateCount: 1,
      candidates: [
        {
          candidateId: "candidate-seedance",
          title: "Seedance 分镜经验",
          summary:
            "Use when Director Angel needs reusable operating experience from user-pasted material. Apply only to situations matching the distilled claims and preserved source evidence.",
        },
      ],
    });

    expect(projection.userText).toContain("看完了。核心是：");
    expect(projection.userText).toContain("要收录吗？");
    expect(projection.userText).not.toContain("Use when Director Angel");
    expect(projection.userText).not.toContain("<learning-evidence-context>");
    expect(projection.userText).not.toContain("preserved source evidence");
    expect(projection.userText).not.toContain("user-pasted material");
  });
});
