import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createExperienceCandidate,
  createExperienceQualityAssessment,
  createExperienceReviewDecision,
  createExperienceSourceAdapterDeclaration,
} from "@hotflow/contracts";
import { describe, expect, it } from "vitest";

import {
  ExperiencePromotionService,
  materializeDirectorKnowledgeCandidateFromExperience,
} from "../src/experience-promotion.js";
import { FileExperienceStore } from "../src/experience-store.js";
import { FileExperienceTaxonomyStore } from "../src/experience-taxonomy.js";
import { DirectorKnowledgeLifecycleService } from "../src/lifecycle-service.js";
import { recallPublishedKnowledge } from "../src/recall.js";
import { FileKnowledgeStore } from "../src/store.js";

describe("ExperiencePromotionService", () => {
  it("promotes accepted experience into the existing knowledge lifecycle and recall lane", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-experience-promotion-"));
    try {
      const experienceStore = new FileExperienceStore({
        experienceDir: join(root, "experience"),
      });
      const taxonomyStore = new FileExperienceTaxonomyStore({
        experienceDir: join(root, "experience"),
      });
      const knowledgeStore = new FileKnowledgeStore({
        knowledgeDir: join(root, "knowledge"),
      });
      const candidate = createExperienceCandidateFixture("experience_desktop_lessons");

      const category = await taxonomyStore.upsertCategory({
        name: "导演镜头",
        description: "镜头语言经验。",
        nowMs: Date.parse("2026-04-25T07:59:30.000Z"),
      });
      const tag = await taxonomyStore.upsertTag({
        name: "景别",
        nowMs: Date.parse("2026-04-25T07:59:31.000Z"),
      });

      await experienceStore.writeCandidate(candidate);
      await taxonomyStore.updateCandidateTaxonomy({
        candidateId: candidate.candidateId,
        categoryId: category.categoryId,
        tagIds: [tag.tagId],
        updatedBy: "operator-a",
        nowMs: Date.parse("2026-04-25T07:59:32.000Z"),
      });
      await expect(
        new ExperiencePromotionService({
          experienceStore,
          knowledgeStore,
          taxonomyStore,
        }).promoteAcceptedExperienceCandidate({
          candidateId: candidate.candidateId,
          actor: "operator-a",
          now: "2026-04-25T08:00:00.000Z",
        }),
      ).rejects.toThrow("latest experience review to be accepted");

      await experienceStore.writeReviewDecision(
        createExperienceReviewDecision({
          decisionId: "experience_review_accept_1",
          candidateId: candidate.candidateId,
          gate: "human",
          decision: "accepted",
          decidedAtMs: Date.parse("2026-04-25T08:01:00.000Z"),
          reviewerId: "operator-a",
          note: "safe to formalize",
        }),
      );

      const promoted = await new ExperiencePromotionService({
        experienceStore,
        knowledgeStore,
        taxonomyStore,
      }).promoteAcceptedExperienceCandidate({
        candidateId: candidate.candidateId,
        actor: "operator-a",
        note: "queue as reusable Director knowledge",
        now: "2026-04-25T08:02:00.000Z",
      });
      const storedKnowledgeCandidate = await knowledgeStore.getCandidateDocument(
        promoted.knowledgeCandidate.metadata.id,
      );

      expect(promoted.status).toBe("ok");
      expect(promoted.knowledgeCandidate.evolution.operation).toBe("create");
      expect(promoted.knowledgeCandidate.method.projectId).toBe("experience-learning");
      expect(promoted.knowledgeCandidate.method.groupId).toBe("director-shot");
      expect(promoted.knowledgeCandidate.method.anchorIds).toEqual(["evidence_desktop_lessons"]);
      expect(promoted.knowledgeCandidate.metadata.tags).toEqual(
        expect.arrayContaining([
          "experience",
          "self-learning",
          "category:director-shot",
          "user-tag:shot-size",
          "source:local-directory",
          "privacy:confidential",
          "constraint-clarity",
        ]),
      );
      expect(storedKnowledgeCandidate?.metadata.id).toBe(promoted.knowledgeCandidate.metadata.id);
      expect((await experienceStore.listPromotions(candidate.candidateId))[0]).toMatchObject({
        promotedTo: "director-knowledge-candidate",
        promotedRef: `knowledge://candidate/${promoted.knowledgeCandidate.metadata.id}`,
      });

      const lifecycle = new DirectorKnowledgeLifecycleService(knowledgeStore);
      await lifecycle.reviewCandidate({
        packId: promoted.knowledgeCandidate.metadata.id,
        decision: "accepted",
        actor: "operator-a",
        note: "publish learned lesson",
        now: "2026-04-25T08:03:00.000Z",
      });
      await lifecycle.publishReviewedCandidate({
        packId: promoted.knowledgeCandidate.metadata.id,
        actor: "operator-a",
        note: "make available for recall",
        now: "2026-04-25T08:04:00.000Z",
      });

      const packet = recallPublishedKnowledge(await knowledgeStore.listPublishedDocuments(), {
        projectId: "experience-learning",
        groupId: "director-shot",
        anchorIds: ["evidence_desktop_lessons"],
        tags: ["category:director-shot", "user-tag:shot-size", "constraint-clarity"],
      });

      expect(packet.status).toBe("hit");
      expect(packet.hits[0]?.knowledgePackId).toBe(promoted.knowledgeCandidate.metadata.id);
      expect(packet.hits[0]?.provenance.sourceProposalId).toBe(
        `experience:${candidate.candidateId}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("materializes updates against the current published experience knowledge pack", () => {
    const candidate = createExperienceCandidateFixture("experience_desktop_lessons");
    const initial = materializeDirectorKnowledgeCandidateFromExperience(candidate, {
      now: "2026-04-25T08:10:00.000Z",
    });
    const updatedCandidate = createExperienceCandidate({
      ...candidate,
      summary: "Ask for missing constraints and capture approval evidence before production.",
      evidence: [
        ...candidate.evidence,
        {
          evidenceId: "evidence_approval_gate",
          sourceRef: "file:///Desktop/AngelLessons/approval.md",
          path: "approval.md",
          summary: "Approval evidence must be preserved before production work.",
        },
      ],
    });

    const update = materializeDirectorKnowledgeCandidateFromExperience(updatedCandidate, {
      currentPublished: {
        schemaVersion: "director.knowledge.pack.v1",
        metadata: {
          ...initial.metadata,
          version: 1,
        },
        stage: "published",
        method: initial.method,
        audit: {
          publishedAt: "2026-04-25T08:11:00.000Z",
        },
      },
      now: "2026-04-25T08:12:00.000Z",
    });

    expect(update.evolution.operation).toBe("update");
    expect(update.evolution.baseVersion).toBe(1);
    expect(update.evolution.nextVersion).toBe(2);
    expect(update.diff.changedFields.map((entry) => entry.field)).toEqual(
      expect.arrayContaining(["metadata.version", "method.summary", "method.anchorIds"]),
    );
  });

  it("blocks promotion when a rejected review is newer than an accepted review", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-experience-promotion-review-gate-"));
    try {
      const experienceStore = new FileExperienceStore({
        experienceDir: join(root, "experience"),
      });
      const knowledgeStore = new FileKnowledgeStore({
        knowledgeDir: join(root, "knowledge"),
      });
      const candidate = createExperienceCandidateFixture("experience_review_regression");

      await experienceStore.writeCandidate(candidate);
      await experienceStore.writeReviewDecision(
        createExperienceReviewDecision({
          decisionId: "experience_review_accept_old",
          candidateId: candidate.candidateId,
          gate: "human",
          decision: "accepted",
          decidedAtMs: Date.parse("2026-04-25T08:01:00.000Z"),
          reviewerId: "operator-a",
        }),
      );
      await experienceStore.writeReviewDecision(
        createExperienceReviewDecision({
          decisionId: "experience_review_reject_new",
          candidateId: candidate.candidateId,
          gate: "human",
          decision: "rejected",
          decidedAtMs: Date.parse("2026-04-25T08:02:00.000Z"),
          reviewerId: "operator-b",
          note: "latest decision blocks promotion",
        }),
      );

      await expect(
        new ExperiencePromotionService({
          experienceStore,
          knowledgeStore,
        }).promoteAcceptedExperienceCandidate({
          candidateId: candidate.candidateId,
          actor: "operator-a",
          now: "2026-04-25T08:03:00.000Z",
        }),
      ).rejects.toThrow("latest experience review to be accepted");

      expect(await knowledgeStore.listCandidateDocuments()).toEqual([]);
      expect(await experienceStore.listPromotions(candidate.candidateId)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks promotion for legacy candidates marked quarantined even if they were accepted", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-experience-promotion-quality-gate-"));
    try {
      const experienceStore = new FileExperienceStore({
        experienceDir: join(root, "experience"),
      });
      const knowledgeStore = new FileKnowledgeStore({
        knowledgeDir: join(root, "knowledge"),
      });
      const candidate = createExperienceCandidate({
        ...createExperienceCandidateFixture("experience_quality_regression"),
        quality: createExperienceQualityAssessment({
          score: 10,
          verdict: "quarantine",
          reasons: ["script or CSS noise rather than reusable guidance"],
        }),
      });

      await experienceStore.writeCandidate(candidate);
      await experienceStore.writeReviewDecision(
        createExperienceReviewDecision({
          decisionId: "experience_review_accept_bad_quality",
          candidateId: candidate.candidateId,
          gate: "human",
          decision: "accepted",
          decidedAtMs: Date.parse("2026-04-25T08:01:00.000Z"),
          reviewerId: "operator-a",
        }),
      );

      await expect(
        new ExperiencePromotionService({
          experienceStore,
          knowledgeStore,
        }).promoteAcceptedExperienceCandidate({
          candidateId: candidate.candidateId,
          actor: "operator-a",
          now: "2026-04-25T08:03:00.000Z",
        }),
      ).rejects.toThrow("failed the experience quality gate");

      expect(await knowledgeStore.listCandidateDocuments()).toEqual([]);
      expect(await experienceStore.listPromotions(candidate.candidateId)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function createExperienceCandidateFixture(candidateId: string) {
  const sourceAdapter = createExperienceSourceAdapterDeclaration({
    adapterId: "adapter_desktop_lessons",
    sourceKind: "local-directory",
    sourceRef: "file:///Desktop/AngelLessons",
    privacy: "confidential",
    incremental: {
      cursor: "mtime:2026-04-25T07:59:00.000Z",
      fingerprint: "sha256:desktop-lessons",
    },
    transformations: [
      {
        transformId: "extract-pattern",
        kind: "extract-pattern",
        summary: "Extract reusable Director Angel learning patterns.",
      },
    ],
  });

  return createExperienceCandidate({
    candidateId,
    sourceAdapter,
    title: "Ask for constraints before production",
    summary: "Ask for missing constraints before generating production assets.",
    applicability:
      "Use when Director Angel is preparing production work from user-provided desktop lessons.",
    risks: ["Local files may contain private details and must remain review-gated."],
    tags: ["constraint-clarity", "operator-learning"],
    evidence: [
      {
        evidenceId: "evidence_desktop_lessons",
        sourceRef: "file:///Desktop/AngelLessons/lesson.md",
        path: "lesson.md",
        summary: "Lesson says to ask for missing constraints first.",
      },
    ],
    privacy: "confidential",
    provenance: "director-knowledge/local-directory",
    createdAtMs: Date.parse("2026-04-25T07:59:00.000Z"),
  });
}
