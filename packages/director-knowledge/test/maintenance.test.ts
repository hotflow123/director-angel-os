import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createExperienceCandidate,
  createExperiencePromotionRecord,
  createExperienceQualityAssessment,
  createExperienceQuarantineRecord,
  createExperienceReviewDecision,
  createExperienceSourceAdapterDeclaration,
  createExperienceSourceArtifact,
} from "@hotflow/contracts";
import { describe, expect, it } from "vitest";

import { materializeDirectorKnowledgeCandidateFromProposal } from "../src/evolution.js";
import { FileExperienceStore } from "../src/experience-store.js";
import { materializeDirectorKnowledgeReviewDecision } from "../src/lifecycle-service.js";
import { applyDirectorMaintenance, inspectDirectorMaintenance } from "../src/maintenance.js";
import { FileKnowledgeStore } from "../src/store.js";
import { materializeDirectorKnowledgePackFromProposal } from "../src/types.js";

describe("Director maintenance", () => {
  it("previews and archives old runtime logs without deleting them", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-maintenance-logs-"));
    try {
      const runtimeRoot = join(root, "runtime");
      const logsDir = join(runtimeRoot, "logs");
      const oldLog = join(logsDir, "weixin-gateway.out.log");
      const recentLog = join(logsDir, "host-api.out.log");
      mkdirSync(logsDir, { recursive: true });
      writeFileSync(oldLog, "old gateway log\n", "utf8");
      writeFileSync(recentLog, "recent host log\n", "utf8");
      const oldDate = new Date("2026-04-01T00:00:00.000Z");
      utimesSync(oldLog, oldDate, oldDate);

      const preview = await inspectDirectorMaintenance({
        runtimeRoot,
        nowMs: Date.parse("2026-05-03T00:00:00.000Z"),
        policy: {
          logRetentionDays: 7,
        },
      });

      expect(preview.logMaintenance.actions).toEqual([
        expect.objectContaining({
          action: "archive",
          reason: "older-than-retention",
          sourcePath: oldLog,
        }),
      ]);
      expect(existsSync(oldLog)).toBe(true);

      const applied = await applyDirectorMaintenance({
        runtimeRoot,
        nowMs: Date.parse("2026-05-03T00:00:00.000Z"),
        policy: {
          logRetentionDays: 7,
        },
      });

      expect(applied.logMaintenance.actions[0]).toMatchObject({
        action: "archive",
        status: "applied",
      });
      expect(existsSync(oldLog)).toBe(false);
      expect(existsSync(recentLog)).toBe(true);
      expect(applied.logMaintenance.actions[0]?.targetPath).toContain(
        join(runtimeRoot, "archive", "logs"),
      );
      expect(readFileSync(applied.logMaintenance.actions[0]?.targetPath ?? "", "utf8")).toContain(
        "old gateway log",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps active experience small by archiving promoted, rejected, stale, and duplicate candidates", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-maintenance-experience-"));
    try {
      const experienceDir = join(root, "experience");
      const store = new FileExperienceStore({ experienceDir });
      const keep = createExperienceCandidateFixture("keep_recent", {
        createdAtMs: Date.parse("2026-05-02T00:00:00.000Z"),
        sourceDigest: "digest:keep",
        score: 90,
      });
      const promoted = createExperienceCandidateFixture("archive_promoted", {
        createdAtMs: Date.parse("2026-04-01T00:00:00.000Z"),
        sourceDigest: "digest:promoted",
        score: 88,
      });
      const rejected = createExperienceCandidateFixture("archive_rejected", {
        createdAtMs: Date.parse("2026-04-02T00:00:00.000Z"),
        sourceDigest: "digest:rejected",
        score: 75,
      });
      const stale = createExperienceCandidateFixture("archive_stale_low_signal", {
        createdAtMs: Date.parse("2026-03-01T00:00:00.000Z"),
        sourceDigest: "digest:stale",
        score: 42,
      });
      const duplicate = createExperienceCandidateFixture("archive_duplicate", {
        createdAtMs: Date.parse("2026-04-30T00:00:00.000Z"),
        sourceDigest: "digest:keep",
        score: 70,
      });
      const oldArtifact = createExperienceSourceArtifact({
        artifactId: "artifact_old_unreferenced",
        sourceKind: "web-page",
        sourceRef: "https://example.test/old",
        digest: "sha256:old-artifact",
        bytes: 100,
        textPreview: "old evidence",
        quality: createExperienceQualityAssessment({
          verdict: "usable",
          score: 75,
          reasons: ["old readable artifact"],
        }),
        privacy: "public",
        provenance: "director-knowledge/maintenance-test",
        capturedAtMs: Date.parse("2026-03-01T00:00:00.000Z"),
      });
      const oldQuarantine = createExperienceQuarantineRecord({
        quarantineId: "quarantine_old_noise",
        artifact: createExperienceSourceArtifact({
          artifactId: "artifact_old_noise",
          sourceKind: "web-page",
          sourceRef: "https://example.test/login",
          digest: "sha256:old-noise",
          bytes: 20,
          textPreview: "sign in",
          quality: createExperienceQualityAssessment({
            verdict: "quarantine",
            score: 5,
            reasons: ["authentication page rather than source content"],
          }),
          privacy: "public",
          provenance: "director-knowledge/maintenance-test",
          capturedAtMs: Date.parse("2026-03-01T00:00:00.000Z"),
        }),
        reason: "authentication page rather than source content",
        notes: ["old quarantine should leave active review lane"],
        createdAtMs: Date.parse("2026-03-01T00:00:00.000Z"),
      });

      await Promise.all(
        [keep, promoted, rejected, stale, duplicate].map((candidate) =>
          store.writeCandidate(candidate),
        ),
      );
      await store.writeSourceArtifact(oldArtifact);
      await store.writeQuarantine(oldQuarantine);
      await store.writeReviewDecision(
        createExperienceReviewDecision({
          decisionId: "review_promoted_accept",
          candidateId: promoted.candidateId,
          gate: "human",
          decision: "accepted",
          decidedAtMs: Date.parse("2026-04-03T00:00:00.000Z"),
        }),
      );
      await store.writePromotion(
        createExperiencePromotionRecord({
          promotionId: "promotion_promoted",
          candidateId: promoted.candidateId,
          promotedTo: "director-knowledge-candidate",
          promotedRef: "knowledge://candidate/archive_promoted",
          promotedAtMs: Date.parse("2026-04-04T00:00:00.000Z"),
        }),
      );
      await store.writeReviewDecision(
        createExperienceReviewDecision({
          decisionId: "review_rejected",
          candidateId: rejected.candidateId,
          gate: "human",
          decision: "rejected",
          decidedAtMs: Date.parse("2026-04-03T00:00:00.000Z"),
        }),
      );

      const preview = await inspectDirectorMaintenance({
        experienceDir,
        nowMs: Date.parse("2026-05-03T00:00:00.000Z"),
        policy: {
          archivePromotedExperienceAfterDays: 7,
          archiveRejectedExperienceAfterDays: 7,
          archiveQuarantineAfterDays: 30,
          archiveUnreferencedArtifactsAfterDays: 30,
          staleUnreviewedExperienceDays: 30,
          staleUnreviewedMinimumScore: 55,
        },
      });

      expect(preview.experienceMaintenance.actions.map((action) => action.recordId)).toEqual([
        promoted.candidateId,
        rejected.candidateId,
        stale.candidateId,
        duplicate.candidateId,
        oldQuarantine.quarantineId,
        oldArtifact.artifactId,
      ]);
      expect(preview.experienceMaintenance.summary).toMatchObject({
        activeCandidates: 5,
        archiveCandidates: 4,
        archiveQuarantines: 1,
        archiveArtifacts: 1,
        duplicateGroups: 1,
      });
      expect((await store.listCandidates()).map((candidate) => candidate.candidateId)).toHaveLength(
        5,
      );

      const applied = await applyDirectorMaintenance({
        experienceDir,
        nowMs: Date.parse("2026-05-03T00:00:00.000Z"),
        policy: {
          archivePromotedExperienceAfterDays: 7,
          archiveRejectedExperienceAfterDays: 7,
          archiveQuarantineAfterDays: 30,
          archiveUnreferencedArtifactsAfterDays: 30,
          staleUnreviewedExperienceDays: 30,
          staleUnreviewedMinimumScore: 55,
        },
      });

      expect(applied.experienceMaintenance.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            candidateId: promoted.candidateId,
            reason: "already-promoted",
            status: "applied",
          }),
          expect.objectContaining({
            candidateId: duplicate.candidateId,
            reason: "duplicate-lower-signal",
            status: "applied",
          }),
          expect.objectContaining({
            recordId: oldQuarantine.quarantineId,
            reason: "stale-quarantine",
            status: "applied",
          }),
          expect.objectContaining({
            recordId: oldArtifact.artifactId,
            reason: "unreferenced-source-artifact",
            status: "applied",
          }),
        ]),
      );
      expect((await store.listCandidates()).map((candidate) => candidate.candidateId)).toEqual([
        keep.candidateId,
      ]);
      expect(await store.listQuarantineRecords()).toEqual([]);
      expect(await store.listSourceArtifacts()).toEqual([]);
      expect(applied.auditPath).toContain(join(root, "maintenance", "audits"));
      expect(existsSync(applied.auditPath)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps active knowledge small by archiving stale candidates, orphan reviews, and old history", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-maintenance-knowledge-"));
    try {
      const knowledgeDir = join(root, "knowledge");
      const store = new FileKnowledgeStore({ knowledgeDir });
      const baseProposal = createAcceptedProposalFixture("proposal-knowledge-base", {
        dedupeKey: "project__group__knowledge-base",
        now: "2026-03-01T00:00:00.000Z",
      });
      const base = materializeDirectorKnowledgePackFromProposal(baseProposal, {
        now: "2026-03-01T00:00:00.000Z",
      });
      await store.publish(base);
      for (let index = 2; index <= 5; index += 1) {
        await store.publish({
          ...base,
          metadata: {
            ...base.metadata,
            description: `Published version ${index}`,
          },
          method: {
            ...base.method,
            explanation: `Published explanation ${index}`,
          },
          audit: {
            ...base.audit,
            publishedAt: `2026-03-0${index}T00:00:00.000Z`,
          },
        });
      }

      const rejectedCandidate = materializeDirectorKnowledgeCandidateFromProposal(
        createAcceptedProposalFixture("proposal-knowledge-rejected", {
          dedupeKey: "project__group__knowledge-rejected",
          now: "2026-03-01T00:00:00.000Z",
        }),
        { now: "2026-03-01T00:00:00.000Z" },
      );
      const staleCandidate = materializeDirectorKnowledgeCandidateFromProposal(
        createAcceptedProposalFixture("proposal-knowledge-stale", {
          dedupeKey: "project__group__knowledge-stale",
          now: "2026-03-01T00:00:00.000Z",
        }),
        { now: "2026-03-01T00:00:00.000Z" },
      );
      await store.writeCandidate(rejectedCandidate);
      await store.writeCandidate(staleCandidate);
      await store.writeReviewDecision(
        materializeDirectorKnowledgeReviewDecision(rejectedCandidate, {
          decision: "rejected",
          now: "2026-03-05T00:00:00.000Z",
        }),
      );
      await store.writeRollbackRecord({
        schemaVersion: "director.knowledge.rollback.record.v1",
        packId: base.metadata.id,
        currentVersionBefore: 4,
        restoredFromVersion: 1,
        currentVersionAfter: 5,
        rolledBackAt: "2026-03-05T00:00:00.000Z",
      });

      const preview = await inspectDirectorMaintenance({
        knowledgeDir,
        nowMs: Date.parse("2026-05-03T00:00:00.000Z"),
        policy: {
          archiveRejectedKnowledgeAfterDays: 7,
          staleUnreviewedKnowledgeDays: 30,
          archiveOrphanKnowledgeReviewsAfterDays: 7,
          knowledgeHistoryRetentionVersions: 2,
          archiveKnowledgeRollbackAfterDays: 30,
        },
      });

      expect(preview.knowledgeMaintenance.summary).toMatchObject({
        activeCandidates: 2,
        archiveCandidates: 2,
        archiveReviews: 1,
        archiveHistory: 3,
        archiveRollback: 1,
      });
      expect(preview.knowledgeMaintenance.actions.map((action) => action.reason)).toEqual([
        "latest-review-rejected",
        "stale-unreviewed",
        "orphan-review",
        "superseded-history",
        "superseded-history",
        "superseded-history",
        "stale-rollback",
      ]);
      expect(await store.getPublished(base.metadata.id)).not.toBeNull();
      expect(
        existsSync(join(knowledgeDir, "candidate", `${rejectedCandidate.metadata.id}.json`)),
      ).toBe(true);

      const applied = await applyDirectorMaintenance({
        knowledgeDir,
        nowMs: Date.parse("2026-05-03T00:00:00.000Z"),
        policy: {
          archiveRejectedKnowledgeAfterDays: 7,
          staleUnreviewedKnowledgeDays: 30,
          archiveOrphanKnowledgeReviewsAfterDays: 7,
          knowledgeHistoryRetentionVersions: 2,
          archiveKnowledgeRollbackAfterDays: 30,
        },
      });

      expect(
        applied.knowledgeMaintenance.actions.every((action) => action.status === "applied"),
      ).toBe(true);
      expect(await store.getPublished(base.metadata.id)).not.toBeNull();
      expect(existsSync(join(knowledgeDir, "published", `${base.metadata.id}.json`))).toBe(true);
      expect(
        existsSync(join(knowledgeDir, "candidate", `${rejectedCandidate.metadata.id}.json`)),
      ).toBe(false);
      expect(
        existsSync(join(knowledgeDir, "candidate", `${staleCandidate.metadata.id}.json`)),
      ).toBe(false);
      expect(applied.auditPath).toContain(join(knowledgeDir, "maintenance", "audits"));
      expect(existsSync(applied.auditPath)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("surfaces learning governance diagnostics before daily learning becomes bloated", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-maintenance-governance-"));
    try {
      const experienceDir = join(root, "experience");
      const knowledgeDir = join(root, "knowledge");
      const store = new FileExperienceStore({ experienceDir });
      const knowledgeStore = new FileKnowledgeStore({ knowledgeDir });

      for (let index = 1; index <= 4; index += 1) {
        await store.writeCandidate(
          createExperienceCandidateFixture(`accepted_not_promoted_${index}`, {
            createdAtMs: Date.parse(`2026-05-0${index}T00:00:00.000Z`),
            sourceDigest: `digest:accepted:${index}`,
            score: 82,
          }),
        );
        await store.writeReviewDecision(
          createExperienceReviewDecision({
            decisionId: `review_accepted_${index}`,
            candidateId: `accepted_not_promoted_${index}`,
            gate: "human",
            decision: "accepted",
            decidedAtMs: Date.parse(`2026-05-0${index}T01:00:00.000Z`),
          }),
        );
      }

      await store.writeCandidate(
        createExperienceCandidateFixture("pending_compress_seedance", {
          createdAtMs: Date.parse("2026-05-03T00:00:00.000Z"),
          sourceDigest: "digest:pending:seedance",
          score: 79,
        }),
      );
      await store.writeCandidate(
        createExperienceCandidateFixture("pending_compress_comfyui", {
          createdAtMs: Date.parse("2026-05-03T00:10:00.000Z"),
          sourceDigest: "digest:pending:comfyui",
          score: 81,
        }),
      );

      await knowledgeStore.publish(
        materializeDirectorKnowledgePackFromProposal(
          createAcceptedProposalFixture("proposal-knowledge-unevaluated", {
            dedupeKey: "project__group__unevaluated",
            now: "2026-05-02T00:00:00.000Z",
          }),
          { now: "2026-05-02T00:00:00.000Z" },
        ),
      );

      const preview = await inspectDirectorMaintenance({
        experienceDir,
        knowledgeDir,
        nowMs: Date.parse("2026-05-08T00:00:00.000Z"),
        policy: {
          governanceAcceptedExperienceBacklogLimit: 2,
          governancePendingExperienceBacklogLimit: 1,
        },
      });

      expect(preview.learningGovernance.summary).toMatchObject({
        acceptedExperienceBacklog: 4,
        pendingExperienceBacklog: 2,
        publishedKnowledgeWithoutRecallEval: 1,
        recommendedActions: 3,
      });
      expect(preview.learningGovernance.actions).toEqual([
        expect.objectContaining({
          action: "promote-or-reject-accepted-experience",
          severity: "warn",
          reason: "accepted-experience-backlog",
          count: 4,
          sampleIds: [
            "accepted_not_promoted_1",
            "accepted_not_promoted_2",
            "accepted_not_promoted_3",
            "accepted_not_promoted_4",
          ],
        }),
        expect.objectContaining({
          action: "distill-pending-experience",
          severity: "info",
          reason: "pending-experience-backlog",
          count: 2,
          sampleIds: ["pending_compress_comfyui", "pending_compress_seedance"],
        }),
        expect.objectContaining({
          action: "evaluate-published-knowledge-recall",
          severity: "warn",
          reason: "published-knowledge-missing-recall-eval",
          count: 1,
          sampleIds: ["director-method-project-group-unevaluated"],
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function createExperienceCandidateFixture(
  candidateId: string,
  input: {
    readonly createdAtMs: number;
    readonly sourceDigest: string;
    readonly score: number;
  },
) {
  const sourceAdapter = createExperienceSourceAdapterDeclaration({
    adapterId: "adapter_reference_learning",
    sourceKind: "local-repository",
    sourceRef: "repo://reference",
    privacy: "internal",
    transformations: [
      {
        transformId: "extract-pattern",
        kind: "extract-pattern",
        summary: "Extract reusable learning patterns.",
      },
    ],
  });

  return createExperienceCandidate({
    candidateId,
    sourceAdapter,
    title: `Experience ${candidateId}`,
    summary: `Reusable summary for ${candidateId}.`,
    applicability: "Use when Director Angel manages learned experience candidates.",
    risks: ["Fixture evidence is review-gated."],
    tags: ["maintenance", "learning"],
    evidence: [
      {
        evidenceId: `evidence_${candidateId}`,
        sourceRef: "repo://reference#docs.md",
        summary: `Evidence for ${candidateId}.`,
      },
    ],
    sourceDigest: input.sourceDigest,
    quality: createExperienceQualityAssessment({
      verdict: input.score >= 55 ? "usable" : "quarantine",
      score: input.score,
      reasons: [`quality score ${input.score}`],
    }),
    privacy: "internal",
    provenance: "director-knowledge/maintenance-test",
    createdAtMs: input.createdAtMs,
  });
}

function createAcceptedProposalFixture(
  proposalId: string,
  input: {
    readonly dedupeKey: string;
    readonly now: string;
  },
) {
  return {
    proposalId,
    status: "accepted" as const,
    recordId: `record-${proposalId}`,
    digestId: `digest-${proposalId}`,
    projectId: "project-1",
    groupId: "group-1",
    title: `Director method ${proposalId}`,
    summary: "Reusable method summary.",
    trigger: "When planning a repeatable production workflow.",
    evidenceSummary: "reviewed source material",
    explanation: "Keep knowledge compact, reviewed, and recallable.",
    dedupeKey: input.dedupeKey,
    tags: ["maintenance", "knowledge"],
    roles: ["script-planner"],
    selectedAdapters: ["scripted"],
    latestDecision: {
      decidedAt: input.now,
      note: "accepted",
    },
    sourceRecord: {
      anchorIds: ["anchor-maintenance"],
      tags: ["maintenance"],
      digest: {
        goal: "Keep Director knowledge maintainable.",
        generationType: "self-learning",
        generationStyle: "maintenance",
        knowledgeSignalTags: ["knowledge"],
      },
    },
  };
}
