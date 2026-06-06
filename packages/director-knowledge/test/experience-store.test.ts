import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createExperienceCandidate,
  createExperiencePromotionRecord,
  createExperienceQualityAssessment,
  createExperienceQuarantineRecord,
  createExperienceReviewDecision,
  createExperienceRollbackRecord,
  createExperienceSourceAdapterDeclaration,
  createExperienceSourceArtifact,
} from "@hotflow/contracts";
import { describe, expect, it } from "vitest";

import { FileExperienceStore } from "../src/experience-store.js";

describe("FileExperienceStore", () => {
  it("lists candidates and gates promotion on accepted review decisions", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-experience-store-"));
    try {
      const store = new FileExperienceStore({ experienceDir: root });
      const candidate = createExperienceCandidateFixture("experience_1");

      const candidateWrite = await store.writeCandidate(candidate);
      const rejectedReview = await store.writeReviewDecision(
        createExperienceReviewDecision({
          decisionId: "review_reject_1",
          candidateId: candidate.candidateId,
          gate: "human",
          decision: "rejected",
          decidedAtMs: 2_000,
          reviewerId: "operator-a",
          note: "Needs stronger evidence.",
        }),
      );
      const blockedPromotion = await store.writePromotion(
        createExperiencePromotionRecord({
          promotionId: "promotion_blocked_1",
          candidateId: candidate.candidateId,
          promotedTo: "director-knowledge-candidate",
          promotedRef: "knowledge://candidate/blocked",
          promotedAtMs: 2_100,
          actorId: "operator-a",
        }),
      );

      await store.writeReviewDecision(
        createExperienceReviewDecision({
          decisionId: "review_accept_1",
          candidateId: candidate.candidateId,
          gate: "human",
          decision: "accepted",
          decidedAtMs: 2_200,
          reviewerId: "operator-a",
          note: "Approved for knowledge candidate conversion.",
        }),
      );
      const promotion = createExperiencePromotionRecord({
        promotionId: "promotion_1",
        candidateId: candidate.candidateId,
        promotedTo: "director-knowledge-candidate",
        promotedRef: "knowledge://candidate/experience_1",
        promotedAtMs: 2_300,
        actorId: "operator-a",
      });
      const promoted = await store.writePromotion(promotion);
      await store.writeReviewDecision(
        createExperienceReviewDecision({
          decisionId: "review_reject_2",
          candidateId: candidate.candidateId,
          gate: "human",
          decision: "rejected",
          decidedAtMs: 2_400,
          reviewerId: "operator-b",
          note: "Latest review should close the gate again.",
        }),
      );
      const blockedAfterLatestReject = await store.writePromotion(
        createExperiencePromotionRecord({
          promotionId: "promotion_blocked_after_reject",
          candidateId: candidate.candidateId,
          promotedTo: "director-knowledge-candidate",
          promotedRef: "knowledge://candidate/blocked-after-reject",
          promotedAtMs: 2_500,
          actorId: "operator-a",
        }),
      );

      expect(candidateWrite.status).toBe("ok");
      expect(rejectedReview.status).toBe("ok");
      expect(blockedPromotion.status).toBe("degraded");
      expect(blockedPromotion.notes[0]).toContain("latest review to be accepted");
      expect(promoted.status).toBe("ok");
      expect(blockedAfterLatestReject.status).toBe("degraded");
      expect(blockedAfterLatestReject.notes[0]).toContain("latest review to be accepted");
      expect(await store.getCandidate(candidate.candidateId)).toMatchObject({
        candidateId: candidate.candidateId,
        runtimeInjection: "disabled",
      });
      expect((await store.listCandidates()).map((entry) => entry.candidateId)).toEqual([
        candidate.candidateId,
      ]);
      expect(
        (await store.listReviewDecisions(candidate.candidateId)).map((entry) => entry.decision),
      ).toEqual(["rejected", "accepted", "rejected"]);
      expect(
        (await store.listPromotions(candidate.candidateId)).map((entry) => entry.promotionId),
      ).toEqual(["promotion_1"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("records rollback only for known promotions", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-experience-store-"));
    try {
      const store = new FileExperienceStore({ experienceDir: root });
      const candidate = createExperienceCandidateFixture("experience_rollback");
      const promotion = createExperiencePromotionRecord({
        promotionId: "promotion_rollback",
        candidateId: candidate.candidateId,
        promotedTo: "director-knowledge-candidate",
        promotedRef: "knowledge://candidate/experience_rollback",
        promotedAtMs: 3_000,
      });

      await store.writeCandidate(candidate);
      await store.writeReviewDecision(
        createExperienceReviewDecision({
          decisionId: "review_accept_rollback",
          candidateId: candidate.candidateId,
          gate: "verifier",
          decision: "accepted",
          decidedAtMs: 2_900,
        }),
      );

      const unknownRollback = await store.writeRollback(
        createExperienceRollbackRecord({
          rollbackId: "rollback_unknown",
          promotionId: "missing_promotion",
          candidateId: candidate.candidateId,
          rolledBackAtMs: 3_100,
          reason: "missing promotion should not rollback",
        }),
      );
      await store.writePromotion(promotion);
      const rollback = await store.writeRollback(
        createExperienceRollbackRecord({
          rollbackId: "rollback_1",
          promotionId: promotion.promotionId,
          candidateId: candidate.candidateId,
          rolledBackAtMs: 3_200,
          reason: "Superseded by a safer source.",
          actorId: "operator-a",
        }),
      );

      expect(unknownRollback.status).toBe("degraded");
      expect(rollback.status).toBe("ok");
      expect(
        (await store.listRollbacks(candidate.candidateId)).map((entry) => entry.rollbackId),
      ).toEqual(["rollback_1"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks promotion for candidates quarantined by source admission", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-experience-store-"));
    try {
      const store = new FileExperienceStore({ experienceDir: root });
      const candidate = createExperienceCandidate({
        ...createExperienceCandidateFixture("experience_quarantined"),
        quality: createExperienceQualityAssessment({
          score: 5,
          verdict: "quarantine",
          reasons: ["raw source did not contain reusable operating guidance"],
        }),
      });

      await store.writeCandidate(candidate);
      await store.writeReviewDecision(
        createExperienceReviewDecision({
          decisionId: "review_accept_quarantined",
          candidateId: candidate.candidateId,
          gate: "human",
          decision: "accepted",
          decidedAtMs: 2_000,
        }),
      );

      const blockedPromotion = await store.writePromotion(
        createExperiencePromotionRecord({
          promotionId: "promotion_quarantined",
          candidateId: candidate.candidateId,
          promotedTo: "director-knowledge-candidate",
          promotedRef: "knowledge://candidate/quarantined",
          promotedAtMs: 2_100,
        }),
      );

      expect(blockedPromotion.status).toBe("degraded");
      expect(blockedPromotion.notes[0]).toContain("failed source admission");
      expect(await store.listPromotions(candidate.candidateId)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stores quarantined source evidence separately from candidates", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-experience-store-"));
    try {
      const store = new FileExperienceStore({ experienceDir: root });
      const quarantine = createExperienceQuarantineRecord({
        quarantineId: "quarantine_login_wall",
        reason: "authentication page rather than source content",
        artifact: createExperienceSourceArtifact({
          artifactId: "raw_login_wall",
          sourceKind: "web-page",
          sourceRef: "https://example.com/login",
          title: "Login",
          digest: "sha256:login-wall",
          bytes: 42,
          contentType: "text/html",
          textPreview: "Sign in to continue.",
          quality: createExperienceQualityAssessment({
            verdict: "quarantine",
            score: 10,
            reasons: ["authentication page rather than source content"],
          }),
          privacy: "public",
          provenance: "director-knowledge/web-self-learning",
          capturedAtMs: 4_000,
        }),
        notes: [
          "Quality gate quarantine: authentication page rather than source content.",
          "Source evidence metadata is retained for review.",
        ],
        createdAtMs: 4_000,
      });

      const write = await store.writeQuarantine(quarantine);
      const listed = await store.listQuarantines();

      expect(write.status).toBe("ok");
      expect(await store.getQuarantine(quarantine.quarantineId)).toMatchObject({
        quarantineId: "quarantine_login_wall",
        reason: "authentication page rather than source content",
        artifact: {
          sourceRef: "https://example.com/login",
          digest: "sha256:login-wall",
        },
      });
      expect(listed).toHaveLength(1);
      expect(listed[0]?.artifact.quality).toMatchObject({
        verdict: "quarantine",
        reasons: ["authentication page rather than source content"],
      });
      expect(await store.listCandidates()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("appends effectiveness evaluations for experience candidates", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-experience-store-"));
    try {
      const store = new FileExperienceStore({ experienceDir: root });
      const candidate = createExperienceCandidateFixture("experience_effectiveness");
      await store.writeCandidate(candidate);

      const first = await store.writeEvaluation({
        evaluationId: "eval_effectiveness_1",
        candidateId: candidate.candidateId,
        runId: "run-usable-1",
        status: "effective",
        score: 0.86,
        summary: "这条经验进入分镜提示词后，镜头参数更完整。",
        evidenceRefs: ["run://run-usable-1"],
        evaluatedAtMs: 5_000,
        evaluatorId: "runtime",
      });
      const second = await store.writeEvaluation({
        evaluationId: "eval_effectiveness_2",
        candidateId: candidate.candidateId,
        runId: "run-weak-1",
        status: "ineffective",
        score: 0.22,
        summary: "这条经验导致错误模型路由，后续应降权。",
        evidenceRefs: ["run://run-weak-1"],
        evaluatedAtMs: 6_000,
      });

      expect(first.status).toBe("ok");
      expect(second.status).toBe("ok");
      expect(await store.listEvaluations(candidate.candidateId)).toEqual([
        expect.objectContaining({
          evaluationId: "eval_effectiveness_1",
          status: "effective",
          score: 0.86,
        }),
        expect.objectContaining({
          evaluationId: "eval_effectiveness_2",
          status: "ineffective",
          score: 0.22,
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not fail the caller when a state directory cannot be scanned", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-experience-store-"));
    const candidateDir = join(root, "candidate");
    try {
      const store = new FileExperienceStore({ experienceDir: root });
      mkdirSync(candidateDir, { recursive: true });
      chmodSync(candidateDir, 0);

      await expect(store.listCandidates()).resolves.toEqual([]);
    } finally {
      chmodSync(candidateDir, 0o700);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function createExperienceCandidateFixture(candidateId: string) {
  const sourceAdapter = createExperienceSourceAdapterDeclaration({
    adapterId: "adapter_openclaw",
    sourceKind: "local-repository",
    sourceRef: "repo://openclaw",
    privacy: "internal",
    incremental: {
      cursor: "sha256:fixture",
      fingerprint: "sha256:fixture",
    },
    transformations: [
      {
        transformId: "summarize",
        kind: "summarize",
        summary: "Summarize plugin boundary patterns.",
      },
    ],
  });

  return createExperienceCandidate({
    candidateId,
    sourceAdapter,
    title: "Plugin boundary pattern",
    summary: "Keep core isolated from concrete plugins.",
    applicability: "When Director Angel learns platform adapter boundaries.",
    risks: ["External content remains untrusted until reviewed."],
    tags: ["plugin", "boundary"],
    evidence: [
      {
        evidenceId: `evidence_${candidateId}`,
        sourceRef: "repo://openclaw#README.md",
        path: "README.md",
        summary: "README describes plugin boundaries.",
      },
    ],
    privacy: "internal",
    provenance: "director-knowledge/local-reference-repository",
    createdAtMs: 1_000,
  });
}
