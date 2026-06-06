import { describe, expect, it } from "vitest";

import {
  createDefaultDirectorAngelRoleProfile,
  createRoleScopedScheduledLearningBackgroundScheduleDefinition,
  createRoleScopedScheduledLearningTaskPolicy,
  createScheduledLearningTaskPolicy,
  renderScheduledLearningConsentPrompt,
  resolveScheduledLearningExecutionPlan,
  summarizeScheduledLearningPolicyForUser,
} from "../src/index.js";

describe("scheduled learning policy", () => {
  it("defaults recurring collection to text-only learning without external upload", () => {
    const policy = createScheduledLearningTaskPolicy({
      taskId: "daily-ai-video-watch",
      title: "AI video daily watch",
      sources: ["https://example.test/feed"],
      cadence: "daily",
    });

    expect(policy.mediaMode).toBe("text_only");
    expect(policy.externalKnowledge.mode).toBe("disabled");
    expect(policy.admissionMode).toBe("confirm_before_publish");
    expect(policy.privacy).toBe("public");
    expect(policy.budget.dailyTokenLimit).toBe(50_000);
    expect(policy.budget.dailyMediaItemLimit).toBe(0);
  });

  it("requires explicit consent before media deep reading or external knowledge upload", () => {
    const policy = createScheduledLearningTaskPolicy({
      taskId: "visual-competitor-watch",
      title: "Visual competitor watch",
      sources: ["https://example.test/visual"],
      cadence: "daily",
      mediaMode: "focused_media",
      externalKnowledge: {
        mode: "sync_clean_text",
        connectors: ["notebooklm", "ima"],
      },
    });

    const prompt = renderScheduledLearningConsentPrompt(policy);

    expect(prompt).toContain("重点媒体理解");
    expect(prompt).toContain("NotebookLM");
    expect(prompt).toContain("ima");
    expect(prompt).toContain("需要你确认");
    expect(prompt).toContain("每日 token 上限");
  });

  it("plans media work progressively within budget", () => {
    const policy = createScheduledLearningTaskPolicy({
      taskId: "short-video-watch",
      title: "Short video watch",
      sources: ["https://example.test/videos"],
      cadence: "daily",
      mediaMode: "focused_media",
      budget: {
        dailyTokenLimit: 120_000,
        dailyMediaItemLimit: 4,
        maxImagesPerRun: 3,
        maxVideosPerRun: 1,
        maxVideoMinutesPerRun: 2,
        maxAudioMinutesPerRun: 0,
      },
    });

    const plan = resolveScheduledLearningExecutionPlan(policy, {
      discoveredMedia: {
        imageCount: 12,
        videoCount: 3,
        audioCount: 1,
      },
      textQuality: "trusted",
    });

    expect(plan.textStrategy).toBe("extract_trusted_text");
    expect(plan.mediaStrategy).toBe("understand_selected_media");
    expect(plan.allowedImages).toBe(3);
    expect(plan.allowedVideos).toBe(1);
    expect(plan.allowedAudioMinutes).toBe(0);
    expect(plan.externalSync).toBe("disabled");
    expect(plan.qualityGates).toContain("media_budget_limited");
  });

  it("blocks external sync for confidential scheduled learning", () => {
    const policy = createScheduledLearningTaskPolicy({
      taskId: "internal-research",
      title: "Internal research",
      sources: ["https://example.test/private"],
      cadence: "daily",
      privacy: "confidential",
      externalKnowledge: {
        mode: "sync_original_files",
        connectors: ["notebooklm"],
      },
    });

    const plan = resolveScheduledLearningExecutionPlan(policy, {
      discoveredMedia: {
        imageCount: 0,
        videoCount: 0,
        audioCount: 0,
      },
      textQuality: "trusted",
    });

    expect(plan.externalSync).toBe("blocked_by_privacy");
    expect(plan.qualityGates).toContain("external_sync_blocked_for_confidential_content");
  });

  it("summarizes the policy in user-facing plain language", () => {
    const policy = createScheduledLearningTaskPolicy({
      taskId: "x-media-watch",
      title: "X media watch",
      sources: ["https://x.com/example"],
      cadence: "daily",
      mediaMode: "media_inventory",
      externalKnowledge: {
        mode: "sync_summary",
        connectors: ["custom"],
      },
    });

    expect(summarizeScheduledLearningPolicyForUser(policy)).toEqual([
      "每天读取 1 个来源，默认先抓可信正文。",
      "媒体处理：只记录图片/视频/音频清单，不调用视觉或音频模型。",
      "外部知识库：只同步摘要到自定义连接器。",
      "入库规则：生成待审经验，用户确认后才发布到长期库。",
    ]);
  });

  it("keeps role-scoped scheduled learning candidate-only and review-gated", () => {
    const roleProfile = createDefaultDirectorAngelRoleProfile({
      learningScope: ["短剧制作", "AI 分镜"],
    });

    const policy = createRoleScopedScheduledLearningTaskPolicy({
      roleProfile,
      taskId: "director-daily-watch",
      title: "导演每日学习",
      sources: ["https://x.com/example"],
      cadence: "daily",
      admissionMode: "auto_stage",
    });

    expect(policy.roleProfile.roleId).toBe("director");
    expect(policy.learningScope).toEqual(["短剧制作", "AI 分镜"]);
    expect(policy.admissionMode).toBe("confirm_before_publish");
    expect(policy.candidateOnly).toBe(true);
    expect(policy.autoPublish).toBe(false);
    expect(policy.sourcePolicy).toMatchObject({
      qualityGate: "high_signal_only",
      candidateOnly: true,
    });
  });

  it("projects role-scoped learning into background schedules without auto-publishing memory", () => {
    const roleProfile = createDefaultDirectorAngelRoleProfile({
      learningScope: ["AI 视频", "角色设定"],
    });
    const policy = createRoleScopedScheduledLearningTaskPolicy({
      roleProfile,
      taskId: "director-weekly-watch",
      title: "导演每周学习",
      sources: ["https://example.test/feed"],
      cadence: "weekly",
    });

    const definition = createRoleScopedScheduledLearningBackgroundScheduleDefinition(policy, {
      schedule: { kind: "cron", expr: "0 9 * * 1", tz: "Asia/Shanghai" },
    });

    expect(definition).toMatchObject({
      scheduleId: "role-learning:director:director-weekly-watch",
      sessionKey: "role:director:learning",
      schedule: { kind: "cron", expr: "0 9 * * 1", tz: "Asia/Shanghai" },
      allowedTools: expect.arrayContaining([
        "web_extract",
        "director.learning.url",
        "director.learning.admit",
      ]),
      sourceRefs: ["https://example.test/feed"],
      metadata: expect.objectContaining({
        scheduledLearning: true,
        roleId: "director",
        roleTitle: "导演 Angel",
        learningScope: ["AI 视频", "角色设定"],
        admissionMode: "confirm_before_publish",
        candidateOnly: true,
        autoPublish: false,
        memorySync: "skip-auto-write",
      }),
    });
    expect(definition.objective).toContain("只生成待审经验候选");
    expect(definition.objective).toContain("不得自动发布");
  });
});
