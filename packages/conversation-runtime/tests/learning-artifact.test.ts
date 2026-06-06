import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createFileLearningArtifactStore,
  createLearningArtifact,
  createLearningArtifactStore,
  createLearningConfirmation,
  createMediaAuthorizationRequest,
  createMediaEvidenceRef,
  createPendingLearningArtifactFromResult,
  resolveLearningConfirmationDecision,
} from "../src/index.js";

describe("learning artifacts and confirmations", () => {
  it("keeps trusted text candidates confirmable when memory evidence is not yet publishable", () => {
    const store = createLearningArtifactStore({ nowMs: () => 1_000 });
    const result = createPendingLearningArtifactFromResult({
      store,
      sessionKey: "weixin:bot:friend",
      turnRunId: "turn-weixin-learning",
      sourceSurface: "weixin",
      sourceKind: "url",
      sourceRef: "https://x.com/mrlarus/status/2058431541655572649?s=46",
      observedAtMs: 1_000,
      result: {
        result: {
          candidateCount: 1,
          candidateIds: ["experience-weixin-x-1"],
        },
        candidates: [
          {
            candidateId: "experience-weixin-x-1",
            title: "餐饮异形展架经验",
            summary: "用 ChatGPT-Image2 生成餐饮异形展架/立牌。",
          },
        ],
        sourceEvidenceRefs: [
          {
            id: "source-evidence-x",
            sourceAccessStatus: "available",
            publishable: true,
          },
        ],
        memoryEvidenceRecords: [
          {
            id: "memory-evidence-x",
            sourceAccessStatus: "available",
            publishable: false,
          },
        ],
      },
    });

    expect(result.artifact).toMatchObject({
      status: "pending_confirmation",
      publishable: true,
      metadata: expect.objectContaining({
        textCandidateConfirmable: true,
      }),
    });
    expect(result.confirmation).toMatchObject({
      status: "pending",
      candidateIds: ["experience-weixin-x-1"],
    });
  });

  it("auto-accepts only low-risk learning candidates when an assisted policy matched", () => {
    const store = createLearningArtifactStore({ nowMs: () => 1_000 });
    const result = createPendingLearningArtifactFromResult({
      store,
      sessionKey: "desktop:workbench",
      turnRunId: "turn-run-assisted-learning",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef: "https://learn.example.com/prompting",
      observedAtMs: 1_000,
      automationAction: {
        kind: "experience.accept",
        riskLevel: "low",
      },
      automationDecision: {
        status: "allowed",
        reason: "automation-policy-matched",
        policyId: "policy-assisted-learning",
        mode: "assisted",
        requiresAudit: true,
        riskLevelAllowed: "low",
      },
      result: {
        result: {
          candidateCount: 1,
          candidateIds: ["exp-assisted-1"],
        },
        candidates: [
          {
            candidateId: "exp-assisted-1",
            title: "AI 分镜提示词经验",
            summary: "导演在 AI 分镜里先明确镜头意图，再约束构图和主体动作。",
            tags: ["AI 分镜", "prompting"],
          },
        ],
      },
    });

    expect(result.artifact).toMatchObject({
      status: "accepted",
      publishable: true,
      metadata: expect.objectContaining({
        autoPublish: false,
        automationAcceptance: expect.objectContaining({
          automationPolicyId: "policy-assisted-learning",
          actionKind: "experience.accept",
          riskLevel: "low",
          rollback: expect.objectContaining({
            kind: "learning-artifact-status",
            restoreStatus: "pending_confirmation",
          }),
        }),
      }),
    });
    expect(result.confirmation).toMatchObject({
      status: "accepted",
      metadata: expect.objectContaining({
        automationPolicyId: "policy-assisted-learning",
        autoResolvedReason: "automation-policy-matched",
      }),
    });
    expect(store.listPendingConfirmations("desktop:workbench", 1_000)).toHaveLength(0);
  });

  it("keeps non-low-risk learning candidates pending even when automation is configured", () => {
    const store = createLearningArtifactStore({ nowMs: () => 1_000 });
    const result = createPendingLearningArtifactFromResult({
      store,
      sessionKey: "desktop:workbench",
      turnRunId: "turn-run-strong-principle",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef: "https://learn.example.com/principle",
      observedAtMs: 1_000,
      automationAction: {
        kind: "experience.accept",
        riskLevel: "medium",
      },
      automationDecision: {
        status: "allowed",
        reason: "automation-policy-matched",
        policyId: "policy-assisted-learning",
        mode: "assisted",
        requiresAudit: true,
        riskLevelAllowed: "medium",
      },
      result: {
        result: {
          candidateCount: 1,
          candidateIds: ["exp-principle-1"],
        },
        candidates: [
          {
            candidateId: "exp-principle-1",
            title: "岗位原则经验",
            summary: "导演岗位原则调整需要人工确认，不能由自动化直接通过。",
            tags: ["岗位原则"],
          },
        ],
      },
    });

    expect(result.artifact).toMatchObject({
      status: "pending_confirmation",
      metadata: expect.not.objectContaining({
        automationAcceptance: expect.anything(),
      }),
    });
    expect(result.confirmation).toMatchObject({ status: "pending" });
    expect(store.listPendingConfirmations("desktop:workbench", 1_000)).toHaveLength(1);
  });

  it("keeps listed-only browser images from becoming publishable visual learning", () => {
    const media = createMediaEvidenceRef({
      id: "media-1",
      sourceRef: "https://pbs.twimg.com/media/example.jpg",
      status: "listed_only",
      observedAtMs: 100,
      metadata: { width: 1200, height: 480 },
    });

    const artifact = createLearningArtifact({
      artifactId: "artifact-1",
      sessionKey: "desktop:workbench",
      turnRunId: "run-1",
      sourceSurface: "desktop",
      sourceKind: "browser-page",
      sourceRef: "https://x.com/example/status/1",
      roleScope: {
        roleName: "导演 Angel",
        domain: "影视制作",
        responsibilityTags: ["短剧", "AI 视频"],
      },
      evidenceRefs: ["text-evidence-1"],
      mediaEvidenceRefs: [media],
      classification: {
        domain: "影视制作",
        topic: "Seedance 过审",
        tags: ["Seedance", "过审"],
        useCases: ["风险避坑"],
        roleRelevance: "high",
      },
      observedAtMs: 100,
    });

    expect(media.status).toBe("listed_only");
    expect(media.realVisualUnderstanding).toBe(false);
    expect(artifact.publishable).toBe(false);
    expect(artifact.qualityGates).toContain("media_not_visually_analyzed");
    expect(artifact.qualityGates).toContain("media_authorization_required");
    expect(artifact.metadata).toMatchObject({
      mediaAuthorizationRequest: expect.objectContaining({
        required: true,
        assetCount: 1,
        imageCount: 1,
        videoCount: 0,
        audioCount: 0,
        defaultMode: "media_inventory",
        recommendedMode: "low_cost",
        estimatedCostTier: "low",
        privacy: "pii_potential",
      }),
    });
    expect(artifact.status).toBe("candidate");
  });

  it("builds a media authorization and budget request before visual media can be learned", () => {
    const request = createMediaAuthorizationRequest([
      createMediaEvidenceRef({
        id: "media-image",
        sourceRef: "https://pbs.twimg.com/media/frame.jpg",
        status: "listed_only",
        observedAtMs: 100,
        metadata: { width: 1024, height: 768 },
      }),
      createMediaEvidenceRef({
        id: "media-video",
        sourceRef: "https://video.twimg.com/ext_tw_video/clip.mp4",
        status: "browser_visible",
        observedAtMs: 100,
        metadata: { mediaType: "video", durationSeconds: 42 },
      }),
    ]);

    expect(request).toMatchObject({
      required: true,
      reason: "media_requires_user_authorization_and_budget_before_understanding",
      assetCount: 2,
      imageCount: 1,
      videoCount: 1,
      audioCount: 0,
      defaultMode: "media_inventory",
      recommendedMode: "low_cost",
      estimatedCostTier: "medium",
      privacy: "pii_potential",
      estimatedTokenBudget: expect.objectContaining({
        mediaInventory: 0,
        lowCost: expect.any(Number),
        deepMultimodal: expect.any(Number),
      }),
      budget: expect.objectContaining({
        tokenLimit: expect.any(Number),
        fileCountLimit: 2,
        videoMinuteLimit: 1,
        audioMinuteLimit: 0,
        estimatedCostTier: "medium",
      }),
    });
    expect(request.estimatedTokenBudget.lowCost).toBeGreaterThan(0);
    expect(request.estimatedTokenBudget.deepMultimodal).toBeGreaterThan(
      request.estimatedTokenBudget.lowCost,
    );
    expect(request.options.map((option) => option.mode)).toEqual([
      "text_only",
      "media_inventory",
      "low_cost",
      "deep_multimodal",
    ]);
    expect(request.options.find((option) => option.mode === "low_cost")).toMatchObject({
      label: "低成本精读重点媒体",
      requiresUserAuthorization: true,
    });
  });

  it("quarantines off-scope learning so Angel does not become a noisy scrapbook", () => {
    const artifact = createLearningArtifact({
      artifactId: "artifact-off-scope",
      sessionKey: "weixin:user-1",
      turnRunId: "run-2",
      sourceSurface: "weixin",
      sourceKind: "url",
      sourceRef: "https://example.test/random-food-coupon",
      roleScope: {
        roleName: "导演 Angel",
        domain: "影视制作",
        responsibilityTags: ["短剧", "分镜", "AI 制作"],
      },
      classification: {
        domain: "生活优惠",
        topic: "餐饮折扣",
        tags: ["优惠券"],
        useCases: ["临时参考"],
        roleRelevance: "off_scope",
      },
      confidence: "high",
      observedAtMs: 100,
    });

    expect(artifact.status).toBe("quarantined");
    expect(artifact.publishable).toBe(false);
    expect(artifact.qualityGates).toContain("role_scope_mismatch");
  });

  it("accepts natural confirmation only when it matches the active session pending artifact", () => {
    const pending = createLearningConfirmation({
      confirmationId: "confirm-1",
      sessionKey: "weixin:user-1",
      artifactId: "artifact-1",
      candidateIds: ["candidate-1"],
      createdAtMs: 100,
      expiresAtMs: 1_000,
    });

    expect(
      resolveLearningConfirmationDecision({
        text: "嗯，就这个，以后做短剧分镜时用",
        sessionKey: "weixin:user-1",
        pending: [pending],
        nowMs: 200,
        messageId: "msg-accept",
      }),
    ).toMatchObject({
      kind: "accept",
      confirmationId: "confirm-1",
      artifactId: "artifact-1",
      candidateIds: ["candidate-1"],
      acceptedByMessageId: "msg-accept",
    });

    expect(
      resolveLearningConfirmationDecision({
        text: "可以，保存",
        sessionKey: "desktop:workbench",
        pending: [pending],
        nowMs: 200,
      }),
    ).toMatchObject({ kind: "none" });

    expect(
      resolveLearningConfirmationDecision({
        text: "可以，保存",
        sessionKey: "weixin:user-1",
        pending: [pending],
        nowMs: 1_200,
      }),
    ).toMatchObject({ kind: "expired", confirmationId: "confirm-1" });
  });

  it("rejects natural negative confirmation for the matching pending artifact", () => {
    const pending = createLearningConfirmation({
      confirmationId: "confirm-2",
      sessionKey: "desktop:workbench",
      artifactId: "artifact-2",
      candidateIds: ["candidate-2"],
      createdAtMs: 100,
      expiresAtMs: 1_000,
    });

    expect(
      resolveLearningConfirmationDecision({
        text: "别存，这个图片没真正看懂",
        sessionKey: "desktop:workbench",
        pending: [pending],
        nowMs: 200,
      }),
    ).toMatchObject({
      kind: "reject",
      confirmationId: "confirm-2",
      artifactId: "artifact-2",
    });
  });

  it("keeps capability questions with modal words from accepting pending learning", () => {
    const pending = createLearningConfirmation({
      confirmationId: "confirm-capability-question",
      sessionKey: "desktop:workbench",
      artifactId: "artifact-capability-question",
      candidateIds: ["candidate-capability-question"],
      createdAtMs: 100,
      expiresAtMs: 1_000,
    });

    for (const text of [
      "如果我给你你接入HyperFrames的cli，你可以操作吗",
      "如果我给你接入 HyperFrames 的 CLI，你可以操作吗？",
      "好像接入以后就可以操作吗？",
    ]) {
      expect(
        resolveLearningConfirmationDecision({
          text,
          sessionKey: "desktop:workbench",
          pending: [pending],
          nowMs: 200,
        }),
      ).toMatchObject({ kind: "none" });
    }
  });

  it("keeps unrelated save tasks from accepting pending learning", () => {
    const pending = createLearningConfirmation({
      confirmationId: "confirm-unrelated-save-task",
      sessionKey: "desktop:workbench",
      artifactId: "artifact-unrelated-save-task",
      candidateIds: ["candidate-unrelated-save-task"],
      createdAtMs: 100,
      expiresAtMs: 1_000,
    });

    for (const text of [
      "帮我把这个文件保存到本地",
      "先保存 HyperFrames CLI 的配置文件",
      "把运行日志保存到桌面",
      "保存这张截图到项目里",
    ]) {
      expect(
        resolveLearningConfirmationDecision({
          text,
          sessionKey: "desktop:workbench",
          pending: [pending],
          nowMs: 200,
        }),
      ).toMatchObject({ kind: "none" });
    }
  });

  it("keeps collection advice questions read-only instead of rejecting learning", () => {
    const pending = createLearningConfirmation({
      confirmationId: "confirm-advice",
      sessionKey: "desktop:workbench",
      artifactId: "artifact-advice",
      candidateIds: ["candidate-advice"],
      createdAtMs: 100,
      expiresAtMs: 1_000,
    });

    expect(
      resolveLearningConfirmationDecision({
        text: "这条要不要收录？哪些地方最有用？如果要收录，帮我提炼成一句可以进经验库的话。",
        sessionKey: "desktop:workbench",
        pending: [pending],
        nowMs: 200,
      }),
    ).toMatchObject({ kind: "none" });
  });

  it("keeps evidence and detail follow-ups as read-only instead of accepting or rejecting learning", () => {
    const pending = createLearningConfirmation({
      confirmationId: "confirm-evidence",
      sessionKey: "desktop:workbench",
      artifactId: "artifact-evidence",
      candidateIds: ["candidate-evidence"],
      createdAtMs: 100,
      expiresAtMs: 1_000,
    });

    for (const text of [
      "看详情。请只基于刚才 https://x.com/rionaifantasy/status/2055649954698551446 的学习结果，列出证据字段：URL、正文字符数、是否二次提取、图片/视频/音频/poster/blob 数量、是否已入库、媒体是否理解。",
      "不要入库，只列证据字段：URL、正文字符数、是否二次提取、媒体数量、是否已入库。",
      "请只基于刚才这个链接的学习结果回答，不要执行任何保存、收录、晋升或入库动作。",
    ]) {
      expect(
        resolveLearningConfirmationDecision({
          text,
          sessionKey: "desktop:workbench",
          pending: [pending],
          nowMs: 200,
        }),
      ).toMatchObject({ kind: "none" });
    }
  });

  it("persists per-session learning artifacts and applies natural confirmation decisions", () => {
    const store = createLearningArtifactStore({
      nowMs: () => 200,
    });
    const artifact = createLearningArtifact({
      artifactId: "artifact-session-confirm",
      sessionKey: "desktop:workbench",
      turnRunId: "run-confirm",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef: "https://example.test/seedance",
      roleScope: {
        roleName: "导演 Angel",
        domain: "影视制作",
        responsibilityTags: ["短剧", "分镜", "AI 制作"],
      },
      pendingConfirmationId: "confirm-session",
      confidence: "high",
      observedAtMs: 100,
    });
    const confirmation = createLearningConfirmation({
      confirmationId: "confirm-session",
      sessionKey: "desktop:workbench",
      artifactId: artifact.artifactId,
      candidateIds: ["candidate-seedance"],
      createdAtMs: 100,
      expiresAtMs: 1_000,
      conversationTurnId: "turn-learn-url",
    });

    store.upsertArtifact(artifact);
    store.upsertConfirmation(confirmation);

    expect(store.listPendingConfirmations("desktop:workbench")).toHaveLength(1);
    expect(store.listPendingConfirmations("weixin:user-1")).toHaveLength(0);

    const resolved = store.resolvePendingConfirmation({
      text: "嗯，就这个，保存成经验",
      sessionKey: "desktop:workbench",
      messageId: "message-accept",
      nowMs: 200,
    });

    expect(resolved.decision).toMatchObject({
      kind: "accept",
      confirmationId: "confirm-session",
      artifactId: "artifact-session-confirm",
    });
    expect(resolved.confirmation).toMatchObject({
      status: "accepted",
      acceptedByMessageId: "message-accept",
      decisionText: "嗯，就这个，保存成经验",
      conversationTurnId: "turn-learn-url",
    });
    expect(resolved.artifact).toMatchObject({
      status: "accepted",
      pendingConfirmationId: "confirm-session",
    });
    expect(store.listPendingConfirmations("desktop:workbench")).toHaveLength(0);
  });

  it("keeps suffixed workbench session keys isolated for pending learning confirmation lookup", () => {
    const store = createLearningArtifactStore({ nowMs: () => 200 });
    const sessionKey = "desktop:workbench:aff1d23f-7ac8-4c93-a405-cf8d105e61b9";
    const artifact = createLearningArtifact({
      artifactId: "artifact-session-suffix",
      sessionKey,
      turnRunId: "run-suffix-confirm",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef: "https://example.test/suffix",
      roleScope: {
        roleName: "导演 Angel",
        domain: "影视制作",
        responsibilityTags: ["短剧", "分镜", "AI 制作"],
      },
      pendingConfirmationId: "confirm-suffix",
      confidence: "high",
      observedAtMs: 100,
    });
    const confirmation = createLearningConfirmation({
      confirmationId: "confirm-suffix",
      sessionKey,
      artifactId: artifact.artifactId,
      candidateIds: ["candidate-suffix"],
      createdAtMs: 100,
      expiresAtMs: 1_000,
      conversationTurnId: "turn-learn-suffix",
    });

    store.upsertArtifact(artifact);
    store.upsertConfirmation(confirmation);

    expect(store.listPendingConfirmations("desktop:workbench")).toHaveLength(0);
    expect(store.listPendingConfirmations(sessionKey)).toHaveLength(1);

    const defaultSessionResolution = store.resolvePendingConfirmation({
      text: "可以保存为经验库",
      sessionKey: "desktop:workbench",
      messageId: "message-confirm-default-workbench",
      nowMs: 200,
    });

    expect(defaultSessionResolution.decision).toMatchObject({
      kind: "none",
    });

    const resolved = store.resolvePendingConfirmation({
      text: "可以保存为经验库",
      sessionKey,
      messageId: "message-confirm-suffix",
      nowMs: 200,
    });

    expect(resolved.decision).toMatchObject({
      kind: "accept",
      confirmationId: "confirm-suffix",
      artifactId: "artifact-session-suffix",
    });
    expect(resolved.confirmation).toMatchObject({
      status: "accepted",
      acceptedByMessageId: "message-confirm-suffix",
      decisionText: "可以保存为经验库",
    });
  });

  it("prefers the newest pending confirmation when a session has multiple candidates", () => {
    const store = createLearningArtifactStore({ nowMs: () => 300 });
    const roleScope = {
      roleName: "导演 Angel",
      domain: "影视制作",
      responsibilityTags: ["短剧", "分镜", "AI 制作"],
    } as const;

    const olderArtifact = createLearningArtifact({
      artifactId: "artifact-older",
      sessionKey: "desktop:workbench",
      turnRunId: "turn-older",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef: "https://example.test/older",
      roleScope,
      pendingConfirmationId: "confirm-older",
      confidence: "high",
      observedAtMs: 100,
    });
    const newerArtifact = createLearningArtifact({
      artifactId: "artifact-newer",
      sessionKey: "desktop:workbench",
      turnRunId: "turn-newer",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef: "https://example.test/newer",
      roleScope,
      pendingConfirmationId: "confirm-newer",
      confidence: "high",
      observedAtMs: 200,
    });

    store.upsertArtifact(olderArtifact);
    store.upsertConfirmation(
      createLearningConfirmation({
        confirmationId: "confirm-older",
        sessionKey: "desktop:workbench",
        artifactId: "artifact-older",
        candidateIds: ["candidate-older"],
        createdAtMs: 100,
        expiresAtMs: 1_000,
      }),
    );
    store.upsertArtifact(newerArtifact);
    store.upsertConfirmation(
      createLearningConfirmation({
        confirmationId: "confirm-newer",
        sessionKey: "desktop:workbench",
        artifactId: "artifact-newer",
        candidateIds: ["candidate-newer"],
        createdAtMs: 200,
        expiresAtMs: 1_100,
      }),
    );

    const resolved = store.resolvePendingConfirmation({
      text: "可以保存为经验库",
      sessionKey: "desktop:workbench",
      messageId: "message-newest",
      nowMs: 250,
    });

    expect(resolved.decision).toMatchObject({
      kind: "accept",
      confirmationId: "confirm-newer",
      artifactId: "artifact-newer",
      candidateIds: ["candidate-newer"],
      acceptedByMessageId: "message-newest",
    });
    expect(resolved.confirmation).toMatchObject({
      confirmationId: "confirm-newer",
      status: "accepted",
    });
  });

  it("selects an ordinal candidate inside the shared runtime store", () => {
    const store = createLearningArtifactStore({ nowMs: () => 300 });
    const artifact = createLearningArtifact({
      artifactId: "artifact-ordinal",
      sessionKey: "desktop:workbench",
      turnRunId: "turn-ordinal",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef: "https://example.test/ordinal",
      roleScope: {
        roleName: "导演 Angel",
        domain: "影视制作",
        responsibilityTags: ["短剧", "分镜", "AI 制作"],
      },
      pendingConfirmationId: "confirm-ordinal",
      confidence: "high",
      observedAtMs: 100,
    });
    store.upsertArtifact(artifact);
    store.upsertConfirmation(
      createLearningConfirmation({
        confirmationId: "confirm-ordinal",
        sessionKey: "desktop:workbench",
        artifactId: "artifact-ordinal",
        candidateIds: ["candidate-first", "candidate-second"],
        createdAtMs: 100,
        expiresAtMs: 1_000,
      }),
    );

    const resolved = store.resolvePendingConfirmation({
      text: "收录第 2 条",
      sessionKey: "desktop:workbench",
      messageId: "message-ordinal",
      nowMs: 300,
    });

    expect(resolved.decision).toMatchObject({
      kind: "accept",
      confirmationId: "confirm-ordinal",
      artifactId: "artifact-ordinal",
      candidateIds: ["candidate-second"],
      acceptedByMessageId: "message-ordinal",
    });
  });

  it("fails closed on out-of-range ordinal confirmation in the shared runtime store", () => {
    const pending = createLearningConfirmation({
      confirmationId: "confirm-ordinal-missing",
      sessionKey: "desktop:workbench",
      artifactId: "artifact-ordinal-missing",
      candidateIds: ["candidate-only"],
      createdAtMs: 100,
      expiresAtMs: 1_000,
    });

    expect(
      resolveLearningConfirmationDecision({
        text: "收录第 2 条",
        sessionKey: "desktop:workbench",
        pending: [pending],
        nowMs: 300,
      }),
    ).toMatchObject({
      kind: "none",
      reason: "ordinal-out-of-range",
    });
  });

  it("binds pending confirmations to their learning turn while accepting later confirmation messages", () => {
    const store = createLearningArtifactStore({ nowMs: () => 500 });
    const created = createPendingLearningArtifactFromResult({
      store,
      sessionKey: "desktop:workbench",
      turnRunId: "turn-run-learn-url",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef: "https://example.test/seedance-storyboard",
      observedAtMs: 500,
      result: {
        result: {
          candidateCount: 1,
          candidateIds: ["exp-seedance-1"],
        },
        candidates: [
          {
            candidateId: "exp-seedance-1",
            title: "Seedance 分镜经验",
            summary: "先拆脚本，再按镜头目的生成画面提示词。",
          },
        ],
      },
    });

    const confirmation = created.confirmation;
    expect(confirmation).toMatchObject({
      status: "pending",
      conversationTurnId: "turn-run-learn-url",
    });
    expect(confirmation?.expiresAtMs).toBe(500 + 30 * 60 * 1000);

    const resolved = store.resolvePendingConfirmation({
      text: "可以保存为经验库",
      sessionKey: "desktop:workbench",
      messageId: "message-confirm-after-followup",
      nowMs: 900,
    });

    expect(resolved.decision).toMatchObject({
      kind: "accept",
      confirmationId: confirmation?.confirmationId,
      acceptedByMessageId: "message-confirm-after-followup",
    });
    expect(resolved.confirmation).toMatchObject({
      status: "accepted",
      conversationTurnId: "turn-run-learn-url",
      acceptedByMessageId: "message-confirm-after-followup",
    });
  });

  it("reloads learning artifacts and confirmations from a file store", () => {
    const dir = mkdtempSync(join(tmpdir(), "director-learning-artifacts-"));
    try {
      const filePath = join(dir, "learning-artifacts.json");
      const first = createFileLearningArtifactStore({ path: filePath, nowMs: () => 200 });
      first.upsertArtifact(
        createLearningArtifact({
          artifactId: "artifact-file",
          sessionKey: "weixin:user-1",
          turnRunId: "run-file",
          sourceSurface: "weixin",
          sourceKind: "url",
          sourceRef: "https://example.test/article",
          roleScope: {
            roleName: "导演 Angel",
            domain: "影视制作",
            responsibilityTags: ["短剧", "分镜"],
          },
          pendingConfirmationId: "confirm-file",
          confidence: "high",
          observedAtMs: 100,
        }),
      );
      first.upsertConfirmation(
        createLearningConfirmation({
          confirmationId: "confirm-file",
          sessionKey: "weixin:user-1",
          artifactId: "artifact-file",
          createdAtMs: 100,
          expiresAtMs: 1_000,
        }),
      );

      const second = createFileLearningArtifactStore({ path: filePath, nowMs: () => 200 });

      expect(second.readArtifact("artifact-file")).toMatchObject({
        artifactId: "artifact-file",
        sessionKey: "weixin:user-1",
      });
      expect(second.listPendingConfirmations("weixin:user-1")).toEqual([
        expect.objectContaining({ confirmationId: "confirm-file" }),
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates an idempotent pending confirmation only for publishable learning candidates", () => {
    const store = createLearningArtifactStore({ nowMs: () => 500 });

    const first = createPendingLearningArtifactFromResult({
      store,
      sessionKey: "desktop:workbench",
      turnRunId: "turn-run-learn-url",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef: "https://example.test/seedance-storyboard",
      observedAtMs: 500,
      result: {
        result: {
          candidateCount: 1,
          candidateIds: ["exp-seedance-1"],
        },
        candidates: [
          {
            candidateId: "exp-seedance-1",
            title: "Seedance 分镜经验",
            summary: "先拆脚本，再按镜头目的生成画面提示词。",
          },
        ],
        sourceEvidenceRefs: [
          {
            id: "source-evidence-1",
            sourceKind: "url",
            sourceRef: "https://example.test/seedance-storyboard",
            sourceAccessStatus: "available",
            publishable: true,
          },
        ],
        memoryEvidenceRecords: [
          {
            id: "memory-evidence-1",
            sourceAccessStatus: "available",
            publishable: true,
          },
        ],
      },
    });
    const second = createPendingLearningArtifactFromResult({
      store,
      sessionKey: "desktop:workbench",
      turnRunId: "turn-run-learn-url-replay",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef: "https://example.test/seedance-storyboard",
      observedAtMs: 600,
      result: {
        result: {
          candidateCount: 1,
          candidateIds: ["exp-seedance-1"],
        },
        candidates: [{ candidateId: "exp-seedance-1" }],
        sourceEvidenceRefs: [
          {
            id: "source-evidence-1",
            sourceAccessStatus: "available",
            publishable: true,
          },
        ],
      },
    });

    expect(first.created).toBe(true);
    expect(first.artifact).toMatchObject({
      status: "pending_confirmation",
      publishable: true,
      evidenceRefs: expect.arrayContaining(["source-evidence-1", "memory-evidence-1"]),
    });
    expect(first.confirmation).toMatchObject({
      status: "pending",
      candidateIds: ["exp-seedance-1"],
    });
    expect(second.artifact?.artifactId).toBe(first.artifact?.artifactId);
    expect(second.confirmation?.confirmationId).toBe(first.confirmation?.confirmationId);
    expect(store.listPendingConfirmations("desktop:workbench")).toHaveLength(1);
  });

  it("snapshots candidate evidence disclosure from tool ledger records", () => {
    const store = createLearningArtifactStore({ nowMs: () => 500 });

    const result = createPendingLearningArtifactFromResult({
      store,
      sessionKey: "desktop:workbench",
      turnRunId: "turn-run-ledger-backed-learning",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef: "https://example.test/ledger-backed",
      observedAtMs: 500,
      result: {
        result: {
          candidateCount: 1,
          candidateIds: ["exp-ledger-backed"],
        },
        candidates: [
          {
            candidateId: "exp-ledger-backed",
            title: "账本证据经验",
            summary: "保存候选时应绑定生成候选时的证据快照。",
          },
        ],
        memoryEvidenceRecords: [
          {
            id: "tool-evidence-run-ledger-backed-call-web",
            sourceAccessStatus: "available",
            publishable: true,
            metadata: {
              evidenceDisclosureSnapshot: {
                url: "https://example.test/ledger-backed",
                title: "Ledger Backed",
                full_body_chars: 6076,
                read_status: "read",
                media_count: 0,
              },
              externalContentSnapshot: {
                final_url: "https://example.test/ledger-backed",
                trust_boundary: "external-web",
              },
              contentRef: {
                kind: "tool-ledger",
                evidenceId: "tool-evidence-run-ledger-backed-call-web",
              },
            },
          },
        ],
      },
    });

    expect(result.artifact?.metadata).toMatchObject({
      evidenceSnapshots: [
        expect.objectContaining({
          evidenceId: "tool-evidence-run-ledger-backed-call-web",
          evidenceDisclosureSnapshot: expect.objectContaining({
            url: "https://example.test/ledger-backed",
            full_body_chars: 6076,
            read_status: "read",
          }),
          contentRef: expect.objectContaining({
            kind: "tool-ledger",
            evidenceId: "tool-evidence-run-ledger-backed-call-web",
          }),
        }),
      ],
      candidates: [
        expect.objectContaining({
          candidateId: "exp-ledger-backed",
          evidenceIds: ["tool-evidence-run-ledger-backed-call-web"],
          evidenceSnapshots: [
            expect.objectContaining({
              evidenceId: "tool-evidence-run-ledger-backed-call-web",
            }),
          ],
        }),
      ],
    });
  });

  it("classifies pending learning artifacts by role scope relevance", () => {
    const directorStore = createLearningArtifactStore({ nowMs: () => 500 });
    const director = createPendingLearningArtifactFromResult({
      store: directorStore,
      sessionKey: "role:director:learning",
      turnRunId: "turn-run-director-role-learning",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef: "https://example.test/director-role-learning",
      roleScope: {
        roleName: "导演 Angel",
        domain: "影视制作与 AI 工作流",
        responsibilityTags: ["短剧制作", "AI 分镜", "镜头语言"],
      },
      observedAtMs: 500,
      result: {
        result: {
          candidateCount: 1,
          candidateIds: ["director-role-candidate"],
        },
        candidates: [
          {
            candidateId: "director-role-candidate",
            title: "AI 短剧分镜经验",
            summary: "先拆脚本，再根据镜头语言和人物调度生成分镜。",
          },
        ],
      },
    });

    expect(director.artifact).toMatchObject({
      status: "pending_confirmation",
      publishable: true,
      classification: expect.objectContaining({
        roleRelevance: "high",
        tags: expect.arrayContaining(["AI 分镜"]),
      }),
    });

    const offScopeStore = createLearningArtifactStore({ nowMs: () => 500 });
    const offScope = createPendingLearningArtifactFromResult({
      store: offScopeStore,
      sessionKey: "role:director:learning",
      turnRunId: "turn-run-off-scope-role-learning",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef: "https://example.test/gardening",
      roleScope: {
        roleName: "导演 Angel",
        domain: "影视制作与 AI 工作流",
        responsibilityTags: ["短剧制作", "AI 分镜", "镜头语言"],
      },
      observedAtMs: 500,
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

    expect(offScope.confirmation).toBeUndefined();
    expect(offScope.artifact).toMatchObject({
      status: "quarantined",
      publishable: false,
      classification: expect.objectContaining({
        roleRelevance: "off_scope",
      }),
      qualityGates: expect.arrayContaining(["role_scope_mismatch"]),
    });
  });

  it("merges newly discovered media into an existing pending learning artifact", () => {
    const store = createLearningArtifactStore({ nowMs: () => 500 });
    const sourceRef = "https://x.com/TanLuAI/status/2056949172629381407";
    const first = createPendingLearningArtifactFromResult({
      store,
      sessionKey: "desktop:workbench",
      turnRunId: "turn-run-opencli-text-only",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef,
      observedAtMs: 500,
      result: {
        result: {
          candidateCount: 1,
          candidateIds: ["exp-tanluai-1"],
        },
        candidates: [{ candidateId: "exp-tanluai-1" }],
      },
    });

    const second = createPendingLearningArtifactFromResult({
      store,
      sessionKey: "desktop:workbench",
      turnRunId: "turn-run-opencli-with-media",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef,
      observedAtMs: 600,
      result: {
        result: {
          candidateCount: 1,
          candidateIds: ["exp-tanluai-1"],
        },
        candidates: [{ candidateId: "exp-tanluai-1" }],
        mediaEvidenceRefs: [
          {
            id: "media-tanluai-image",
            sourceRef: "https://pbs.twimg.com/media/tanluai.jpg",
            status: "listed_only",
            publishable: false,
            metadata: { mediaType: "image" },
          },
          {
            id: "media-tanluai-video",
            sourceRef: "blob:https://x.com/tanluai-video",
            status: "listed_only",
            publishable: false,
            metadata: { mediaType: "video" },
          },
        ],
      },
    });

    expect(first.artifact?.mediaEvidenceRefs).toHaveLength(0);
    expect(second.reason).toBe("existing-pending-updated");
    expect(second.artifact?.artifactId).toBe(first.artifact?.artifactId);
    expect(second.artifact?.mediaEvidenceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceRef: "https://pbs.twimg.com/media/tanluai.jpg" }),
        expect.objectContaining({ sourceRef: "blob:https://x.com/tanluai-video" }),
      ]),
    );
    expect(second.artifact?.metadata).toMatchObject({
      mediaEvidenceCount: 2,
      mediaAuthorizationRequest: expect.objectContaining({
        required: true,
        assetCount: 2,
        imageCount: 1,
        videoCount: 1,
      }),
    });
    expect(store.readArtifact(first.artifact?.artifactId ?? "")?.mediaEvidenceRefs).toHaveLength(2);
  });

  it("does not create a pending confirmation for blocked or listed-only learning residue", () => {
    const blockedStore = createLearningArtifactStore({ nowMs: () => 500 });
    const blocked = createPendingLearningArtifactFromResult({
      store: blockedStore,
      sessionKey: "weixin:user-1",
      turnRunId: "turn-run-blocked",
      sourceSurface: "weixin",
      sourceKind: "url",
      sourceRef: "https://mp.weixin.qq.com/s/blocked",
      observedAtMs: 500,
      result: {
        result: {
          candidateCount: 1,
          candidateIds: ["stale-candidate"],
        },
        candidates: [{ candidateId: "stale-candidate", title: "Web lesson: mp.weixin.qq.com" }],
        sourceEvidenceRefs: [
          {
            id: "source-blocked",
            sourceKind: "url",
            sourceRef: "https://mp.weixin.qq.com/s/blocked",
            sourceAccessStatus: "source_access_limited",
            sourceAccessError: "环境异常，完成验证后即可继续访问。",
            publishable: false,
          },
        ],
      },
    });

    expect(blocked.confirmation).toBeUndefined();
    expect(blocked.artifact).toMatchObject({
      status: "quarantined",
      publishable: false,
    });
    expect(blockedStore.listPendingConfirmations("weixin:user-1")).toHaveLength(0);

    const mediaStore = createLearningArtifactStore({ nowMs: () => 500 });
    const listedOnly = createPendingLearningArtifactFromResult({
      store: mediaStore,
      sessionKey: "desktop:workbench",
      turnRunId: "turn-run-listed-media",
      sourceSurface: "desktop",
      sourceKind: "browser-page",
      sourceRef: "https://x.com/example/status/1",
      observedAtMs: 500,
      result: {
        result: {
          candidateCount: 1,
          candidateIds: ["image-shell-candidate"],
        },
        candidates: [{ candidateId: "image-shell-candidate" }],
        mediaEvidenceRefs: [
          {
            id: "media-listed",
            sourceRef: "https://pbs.twimg.com/media/example.jpg",
            status: "listed_only",
            publishable: false,
          },
          {
            id: "media-video-listed",
            sourceRef: "https://video.twimg.com/ext_tw_video/example.mp4",
            status: "browser_visible",
            publishable: false,
            metadata: { mediaType: "video", durationSeconds: 30 },
          },
        ],
      },
    });

    expect(listedOnly.confirmation).toMatchObject({
      status: "pending",
      candidateIds: ["image-shell-candidate"],
    });
    expect(listedOnly.artifact).toMatchObject({
      publishable: false,
      status: "pending_confirmation",
      qualityGates: expect.arrayContaining([
        "media_not_visually_analyzed",
        "media_authorization_required",
      ]),
      metadata: expect.objectContaining({
        mediaAuthorizationRequest: expect.objectContaining({
          required: true,
          assetCount: 2,
          imageCount: 1,
          videoCount: 1,
          defaultMode: "media_inventory",
          recommendedMode: "low_cost",
          estimatedCostTier: "medium",
          privacy: "pii_potential",
        }),
      }),
    });
    expect(listedOnly.artifact?.metadata).toMatchObject({
      textCandidateConfirmable: true,
      mediaContentConfirmable: false,
    });
    expect(mediaStore.listPendingConfirmations("desktop:workbench")).toHaveLength(1);
  });
});
