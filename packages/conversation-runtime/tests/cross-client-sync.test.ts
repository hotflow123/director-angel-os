import { describe, expect, it } from "vitest";

import {
  createLearningArtifactStore,
  createPendingLearningArtifactFromResult,
  createSourceAccessLimitedLearningArtifactFromRuntimeResult,
} from "../src/index.js";

describe("cross-client shared learning consistency", () => {
  it("keeps desktop and Weixin on one shared candidate lifecycle when they use the same session", () => {
    const store = createLearningArtifactStore({ nowMs: () => 2_000 });
    const sessionKey = "operator:director-angel:user-1";
    const sourceRef = "https://x.com/example/status/205";

    const desktopLearning = createPendingLearningArtifactFromResult({
      store,
      sessionKey,
      turnRunId: "desktop-turn-1",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef,
      observedAtMs: 1_000,
      result: {
        result: {
          candidateCount: 1,
          candidateIds: ["candidate-shared-1"],
        },
        candidates: [
          {
            candidateId: "candidate-shared-1",
            title: "共享候选",
            summary: "桌面学习到的候选必须被微信端看到并确认。",
          },
        ],
        sourceEvidenceRefs: [
          {
            id: "source-shared-1",
            sourceKind: "url",
            sourceRef,
            sourceAccessStatus: "available",
            publishable: true,
          },
        ],
      },
    });

    expect(desktopLearning.confirmation).toMatchObject({
      sessionKey,
      conversationTurnId: "desktop-turn-1",
      status: "pending",
    });
    expect(store.listPendingConfirmations(sessionKey)).toHaveLength(1);

    const weixinConfirmation = store.resolvePendingConfirmation({
      text: "可以，保存为经验库",
      sessionKey,
      messageId: "weixin-message-accept",
      nowMs: 1_500,
    });

    expect(weixinConfirmation.decision).toMatchObject({
      kind: "accept",
      confirmationId: desktopLearning.confirmation?.confirmationId,
      artifactId: desktopLearning.artifact?.artifactId,
      acceptedByMessageId: "weixin-message-accept",
    });
    expect(store.readArtifact(desktopLearning.artifact?.artifactId ?? "")).toMatchObject({
      status: "accepted",
      sessionKey,
    });
    expect(store.listPendingConfirmations(sessionKey)).toHaveLength(0);
  });

  it("fails closed when another client tries to confirm a different session", () => {
    const store = createLearningArtifactStore({ nowMs: () => 2_000 });
    const desktopSession = "desktop:workbench";

    createPendingLearningArtifactFromResult({
      store,
      sessionKey: desktopSession,
      turnRunId: "desktop-turn-2",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef: "https://x.com/example/status/206",
      observedAtMs: 1_000,
      result: {
        result: {
          candidateCount: 1,
          candidateIds: ["candidate-desktop-only"],
        },
        candidates: [{ candidateId: "candidate-desktop-only" }],
      },
    });

    const wrongSession = store.resolvePendingConfirmation({
      text: "可以，保存为经验库",
      sessionKey: "weixin:account:user-1",
      messageId: "weixin-wrong-session",
      nowMs: 1_500,
    });

    expect(wrongSession.decision).toMatchObject({ kind: "none" });
    expect(store.listPendingConfirmations(desktopSession)).toHaveLength(1);
  });

  it("records blocked runtime URL reads as shared non-publishable learning traces", () => {
    const store = createLearningArtifactStore({ nowMs: () => 2_000 });
    const sourceRef = "https://mp.weixin.qq.com/s/blocked";

    const recorded = createSourceAccessLimitedLearningArtifactFromRuntimeResult({
      store,
      sessionKey: "weixin:account:user-1",
      sourceSurface: "weixin",
      sourceKind: "url",
      sourceRef,
      observedAtMs: 1_000,
      result: {
        turnId: "weixin-turn-1",
        sessionKey: "weixin:account:user-1",
        replySource: "tool-loop",
        events: [],
        memoryDecision: { action: "candidate-review", reason: "direct read failed closed" },
        memoryEvidenceRecords: [
          {
            id: "memory-evidence-blocked",
            sourceKind: "url",
            sourceRef: "tool://web_extract/required-grounding",
            sourceAccessStatus: "source_access_limited",
            sourceAccessError: "verification page",
            confidence: "low",
            publishable: false,
            privacy: "pii_potential",
            provenance: ["tool-result"],
            evidenceRefs: [],
            policyEnvelopeRefs: [],
            failureTaxonomy: ["source_access_limited"],
            userConfirmed: false,
            observedAtMs: 1_000,
            metadata: { sourceUrl: sourceRef },
          },
        ],
        operatorTrace: { items: [] },
      },
    });

    expect(recorded?.artifact).toMatchObject({
      sessionKey: "weixin:account:user-1",
      sourceSurface: "weixin",
      sourceKind: "url",
      sourceRef,
      publishable: false,
    });
    expect(recorded?.confirmation).toBeUndefined();
    expect(store.listPendingConfirmations("weixin:account:user-1")).toHaveLength(0);
  });
});
