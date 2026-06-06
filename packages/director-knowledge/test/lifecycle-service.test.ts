import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DirectorKnowledgeCandidateSyncService } from "../src/candidate-service.js";
import {
  DirectorKnowledgeLifecycleService,
  materializeDirectorKnowledgePackFromCandidate,
} from "../src/lifecycle-service.js";
import { FileKnowledgeStore } from "../src/store.js";
import { materializeDirectorKnowledgePackFromProposal } from "../src/types.js";

describe("DirectorKnowledgeLifecycleService", () => {
  const root = join(tmpdir(), "director-knowledge-lifecycle-service-test");

  beforeEach(() => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("records an accept decision for a candidate", async () => {
    const store = new FileKnowledgeStore({ knowledgeDir: root });
    const sync = new DirectorKnowledgeCandidateSyncService(store);
    const lifecycle = new DirectorKnowledgeLifecycleService(store);
    const candidate = await sync.syncAcceptedProposal({
      proposal: createAcceptedProposalFixture({
        proposalId: "proposal-review-1",
        dedupeKey: "project-1__group-1__continuity-safe-teaser",
      }),
      now: "2026-04-13T15:00:00.000Z",
    });

    const review = await lifecycle.reviewCandidate({
      packId: candidate.packId,
      decision: "accepted",
      actor: "operator-review",
      note: "looks reusable",
      now: "2026-04-13T15:05:00.000Z",
    });

    const stored = await store.getReviewDecision(candidate.packId);
    expect(review.status).toBe("ok");
    expect(review.review.decision).toBe("accepted");
    expect(stored?.candidateVersion).toBe(candidate.candidate.metadata.version);
    expect(stored?.note).toBe("looks reusable");
  });

  it("publishes an accepted candidate and clears the candidate head", async () => {
    const store = new FileKnowledgeStore({ knowledgeDir: root });
    const sync = new DirectorKnowledgeCandidateSyncService(store);
    const lifecycle = new DirectorKnowledgeLifecycleService(store);
    const candidate = await sync.syncAcceptedProposal({
      proposal: createAcceptedProposalFixture({
        proposalId: "proposal-publish-1",
        dedupeKey: "project-1__group-1__continuity-safe-teaser",
      }),
      now: "2026-04-13T15:10:00.000Z",
    });
    await lifecycle.reviewCandidate({
      packId: candidate.packId,
      decision: "accepted",
      actor: "operator-accept",
      note: "publish it",
      now: "2026-04-13T15:11:00.000Z",
    });

    const published = await lifecycle.publishReviewedCandidate({
      packId: candidate.packId,
      actor: "operator-publish",
      note: "publish head v1",
      now: "2026-04-13T15:12:00.000Z",
    });

    const current = await store.getPublished(candidate.packId);
    const candidateHead = await store.getCandidateDocument(candidate.packId);
    const history = await store.listHistory(candidate.packId);

    expect(published.status).toBe("ok");
    expect(current?.metadata.version).toBe(1);
    expect(current?.audit.author).toBe("operator-publish");
    expect(current?.audit.sourceDecisionNote).toBe("publish it");
    expect(candidateHead).toBeNull();
    expect(history).toHaveLength(1);
  });

  it("keeps a rejected candidate in place and blocks publish", async () => {
    const store = new FileKnowledgeStore({ knowledgeDir: root });
    const sync = new DirectorKnowledgeCandidateSyncService(store);
    const lifecycle = new DirectorKnowledgeLifecycleService(store);
    const candidate = await sync.syncAcceptedProposal({
      proposal: createAcceptedProposalFixture({
        proposalId: "proposal-reject-1",
        dedupeKey: "project-1__group-1__continuity-safe-teaser",
      }),
      now: "2026-04-13T15:13:00.000Z",
    });

    const rejected = await lifecycle.reviewCandidate({
      packId: candidate.packId,
      decision: "rejected",
      actor: "operator-reject",
      note: "not reusable yet",
      now: "2026-04-13T15:14:00.000Z",
    });

    await expect(
      lifecycle.publishReviewedCandidate({
        packId: candidate.packId,
        actor: "operator-publish",
        note: "should not publish",
        now: "2026-04-13T15:15:00.000Z",
      }),
    ).rejects.toThrow(
      `Director knowledge candidate ${candidate.packId} must be accepted before publish.`,
    );

    const candidateHead = await store.getCandidateDocument(candidate.packId);
    const review = await store.getReviewDecision(candidate.packId);
    const published = await store.getPublished(candidate.packId);

    expect(rejected.review.decision).toBe("rejected");
    expect(candidateHead?.metadata.version).toBe(candidate.candidate.metadata.version);
    expect(review?.decision).toBe("rejected");
    expect(review?.note).toBe("not reusable yet");
    expect(published).toBeNull();
  });

  it("rolls back to a previous history version by creating a new head version", async () => {
    const store = new FileKnowledgeStore({ knowledgeDir: root });

    const base = materializeDirectorKnowledgePackFromProposal(
      createAcceptedProposalFixture({
        proposalId: "proposal-history-1",
        dedupeKey: "project-1__group-1__continuity-safe-teaser",
      }),
      { now: "2026-04-13T15:20:00.000Z" },
    );
    await store.publish(base);

    const v2 = materializeDirectorKnowledgePackFromCandidate(
      {
        schemaVersion: "director.knowledge.candidate.v1",
        stage: "candidate",
        metadata: {
          ...base.metadata,
          version: 2,
          description: "Version 2 candidate",
        },
        method: {
          ...base.method,
          explanation: "Version 2 explanation",
          roles: [...base.method.roles],
          preferredAdapters: [...base.method.preferredAdapters],
          anchorIds: [...base.method.anchorIds],
        },
        audit: {
          candidateAt: "2026-04-13T15:21:00.000Z",
        },
        evolution: {
          operation: "update",
          basePackId: base.metadata.id,
          baseVersion: 1,
          nextVersion: 2,
          dedupeKey: "project-1__group-1__continuity-safe-teaser",
        },
        diff: {
          schemaVersion: "director.knowledge.diff.v1",
          operation: "update",
          baseVersion: 1,
          nextVersion: 2,
          changedFields: [
            {
              field: "metadata.version",
              before: 1,
              after: 2,
            },
          ],
          summary: "update candidate",
        },
      },
      {
        schemaVersion: "director.knowledge.review.decision.v1",
        packId: base.metadata.id,
        candidateVersion: 2,
        decision: "accepted",
        decidedAt: "2026-04-13T15:22:00.000Z",
        baseVersion: 1,
        nextVersion: 2,
      },
      {
        actor: "operator-v2",
        note: "publish v2",
        now: "2026-04-13T15:23:00.000Z",
      },
    );
    await store.publish(v2);

    const lifecycle = new DirectorKnowledgeLifecycleService(store);
    const rollback = await lifecycle.rollbackPublishedKnowledge({
      packId: base.metadata.id,
      restoredFromVersion: 1,
      actor: "operator-rollback",
      note: "restore v1",
      now: "2026-04-13T15:24:00.000Z",
    });

    const current = await store.getPublished(base.metadata.id);
    const rollbackRecords = await store.listRollbackRecords(base.metadata.id);

    expect(rollback.status).toBe("ok");
    expect(current?.metadata.version).toBe(3);
    expect(current?.audit.note).toBe("restore v1");
    expect(current?.method.explanation).toBe(base.method.explanation);
    expect(rollback.rollback.currentVersionBefore).toBe(2);
    expect(rollback.rollback.restoredFromVersion).toBe(1);
    expect(rollback.rollback.currentVersionAfter).toBe(3);
    expect(rollbackRecords).toHaveLength(1);
  });
});

function createAcceptedProposalFixture(overrides: {
  proposalId: string;
  dedupeKey: string;
}) {
  return {
    proposalId: overrides.proposalId,
    status: "accepted" as const,
    recordId: `record-${overrides.proposalId}`,
    digestId: `digest-${overrides.proposalId}`,
    projectId: "project-1",
    groupId: "group-1",
    title: "Director method: Continuity-safe teaser",
    summary: "completed immersive new run",
    trigger: "When planning a continuity-safe teaser.",
    evidenceSummary: "status=completed | roles=researcher, script-planner",
    explanation:
      "Use continuity-safe planning, preserve anchors, and keep the approved visual tone.",
    dedupeKey: overrides.dedupeKey,
    tags: ["director-trace", "continuity"],
    roles: ["researcher", "script-planner"],
    selectedAdapters: ["scripted"],
    latestDecision: {
      decidedAt: "2026-04-13T14:55:00.000Z",
      note: "approved_for_publish",
    },
    sourceRecord: {
      anchorIds: ["anchor-a", "anchor-b"],
      tags: ["director-trace", "continuity"],
      digest: {
        goal: "Create a continuity-safe teaser.",
        generationType: "new",
        generationStyle: "immersive",
        knowledgeSignalTags: ["continuity"],
      },
    },
  };
}
