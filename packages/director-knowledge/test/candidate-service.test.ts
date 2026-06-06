import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DirectorKnowledgeCandidateSyncService } from "../src/candidate-service.js";
import { FileKnowledgeStore } from "../src/store.js";
import { materializeDirectorKnowledgePackFromProposal } from "../src/types.js";

describe("DirectorKnowledgeCandidateSyncService", () => {
  const root = join(tmpdir(), "director-knowledge-candidate-service-test");

  beforeEach(() => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates a candidate for an accepted proposal when no published head exists", async () => {
    const store = new FileKnowledgeStore({ knowledgeDir: root });
    const service = new DirectorKnowledgeCandidateSyncService(store);

    const result = await service.syncAcceptedProposal({
      proposal: createAcceptedProposalFixture({
        proposalId: "proposal-sync-create",
        dedupeKey: "project-1__group-1__continuity-safe-teaser",
      }),
      author: "operator-a",
      note: "sync create candidate",
      now: "2026-04-13T14:00:00.000Z",
    });

    expect(result.status).toBe("ok");
    expect(result.currentPublishedVersion).toBeNull();
    expect(result.candidate.evolution.operation).toBe("create");
    expect(result.candidate.metadata.version).toBe(1);

    const stored = await store.getCandidateDocument(result.packId);
    expect(stored?.metadata.id).toBe(result.packId);
    expect(stored?.diff.summary).toContain("create");
  });

  it("upserts an update candidate when a published head already exists", async () => {
    const store = new FileKnowledgeStore({ knowledgeDir: root });
    const published = materializeDirectorKnowledgePackFromProposal(
      createAcceptedProposalFixture({
        proposalId: "proposal-sync-base",
        dedupeKey: "project-1__group-1__continuity-safe-teaser",
      }),
      {
        author: "operator-base",
        note: "publish base",
        now: "2026-04-13T14:10:00.000Z",
      },
    );
    await store.publish(published);

    const service = new DirectorKnowledgeCandidateSyncService(store);
    const result = await service.syncAcceptedProposal({
      proposal: createAcceptedProposalFixture({
        proposalId: "proposal-sync-update",
        dedupeKey: "project-1__group-1__continuity-safe-teaser",
        explanation:
          "Use continuity-safe planning, preserve anchors, and prefer seedance when motion polish matters.",
        selectedAdapters: ["scripted", "seedance"],
        tags: ["director-trace", "continuity", "motion"],
      }),
      author: "operator-b",
      note: "sync update candidate",
      now: "2026-04-13T14:20:00.000Z",
    });

    expect(result.status).toBe("ok");
    expect(result.currentPublishedVersion).toBe(1);
    expect(result.candidate.evolution.operation).toBe("update");
    expect(result.candidate.metadata.version).toBe(2);
    expect(result.candidate.diff.changedFields.map((entry) => entry.field)).toEqual(
      expect.arrayContaining([
        "metadata.version",
        "metadata.description",
        "metadata.tags",
        "method.explanation",
        "method.preferredAdapters",
      ]),
    );
  });

  it("skips an accepted proposal when the published head already has the same effective content", async () => {
    const store = new FileKnowledgeStore({ knowledgeDir: root });
    const proposal = createAcceptedProposalFixture({
      proposalId: "proposal-sync-published-base",
      dedupeKey: "project-1__group-1__continuity-safe-teaser",
    });
    const published = materializeDirectorKnowledgePackFromProposal(proposal, {
      author: "operator-base",
      note: "publish base",
      now: "2026-04-13T14:30:00.000Z",
    });
    await store.publish(published);

    const service = new DirectorKnowledgeCandidateSyncService(store);
    const result = await service.syncAcceptedProposal({
      proposal: {
        ...proposal,
        proposalId: "proposal-sync-published-duplicate",
        recordId: "record-proposal-sync-published-duplicate",
        digestId: "digest-proposal-sync-published-duplicate",
      },
      author: "operator-b",
      note: "duplicate should not become a version-only update",
      now: "2026-04-13T14:40:00.000Z",
    });

    expect(result.status).toBe("ok");
    expect(result.outcome).toBe("skipped");
    expect(result.skipReason).toBe("duplicate-equivalent-published");
    expect(result.currentPublishedVersion).toBe(1);
    expect(result.notes.join(" ")).toContain("duplicate-equivalent-published");
    expect(await store.getCandidateDocument(result.packId)).toBeNull();
  });

  it("skips writing when an equivalent pending candidate already exists", async () => {
    const store = new FileKnowledgeStore({ knowledgeDir: root });
    const service = new DirectorKnowledgeCandidateSyncService(store);
    const proposal = createAcceptedProposalFixture({
      proposalId: "proposal-sync-pending-base",
      dedupeKey: "project-1__group-1__continuity-safe-teaser",
    });

    const first = await service.syncAcceptedProposal({
      proposal,
      author: "operator-a",
      note: "first candidate",
      now: "2026-04-13T15:00:00.000Z",
    });
    const second = await service.syncAcceptedProposal({
      proposal: {
        ...proposal,
        proposalId: "proposal-sync-pending-duplicate",
        recordId: "record-proposal-sync-pending-duplicate",
        digestId: "digest-proposal-sync-pending-duplicate",
      },
      author: "operator-b",
      note: "second candidate should be skipped",
      now: "2026-04-13T15:10:00.000Z",
    });

    const stored = await store.getCandidateDocument(first.packId);
    expect(second.status).toBe("ok");
    expect(second.outcome).toBe("skipped");
    expect(second.skipReason).toBe("duplicate-equivalent-candidate");
    expect(second.notes.join(" ")).toContain("duplicate-equivalent-candidate");
    expect(stored?.audit.candidateAt).toBe("2026-04-13T15:00:00.000Z");
    expect(stored?.audit.note).toBe("first candidate");
  });

  it("keeps changed same-key content as a review-gated merge candidate", async () => {
    const store = new FileKnowledgeStore({ knowledgeDir: root });
    const service = new DirectorKnowledgeCandidateSyncService(store);

    const first = await service.syncAcceptedProposal({
      proposal: createAcceptedProposalFixture({
        proposalId: "proposal-sync-merge-base",
        dedupeKey: "project-1__group-1__continuity-safe-teaser",
      }),
      author: "operator-a",
      note: "first candidate",
      now: "2026-04-13T16:00:00.000Z",
    });
    const second = await service.syncAcceptedProposal({
      proposal: createAcceptedProposalFixture({
        proposalId: "proposal-sync-merge-change",
        dedupeKey: "project-1__group-1__continuity-safe-teaser",
        explanation:
          "Use continuity-safe planning, preserve anchors, and add an explicit approval checkpoint before execution.",
        tags: ["director-trace", "continuity", "approval-gate"],
      }),
      author: "operator-b",
      note: "changed candidate",
      now: "2026-04-13T16:10:00.000Z",
    });

    const stored = await store.getCandidateDocument(first.packId);
    expect(second.status).toBe("ok");
    expect(second.outcome).toBe("written");
    expect(second.notes.join(" ")).toContain("review-gated merge/update candidate");
    expect(stored?.metadata.tags).toContain("approval-gate");
    expect(await store.getPublished(first.packId)).toBeNull();
  });
});

function createAcceptedProposalFixture(overrides: {
  proposalId: string;
  dedupeKey: string;
  explanation?: string;
  selectedAdapters?: readonly string[];
  tags?: readonly string[];
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
      overrides.explanation ??
      "Use continuity-safe planning, preserve anchors, and keep the approved visual tone.",
    dedupeKey: overrides.dedupeKey,
    tags: [...(overrides.tags ?? ["director-trace", "continuity"])],
    roles: ["researcher", "script-planner"],
    selectedAdapters: [...(overrides.selectedAdapters ?? ["scripted"])],
    latestDecision: {
      decidedAt: "2026-04-13T13:55:00.000Z",
      note: "approved_for_publish",
    },
    sourceRecord: {
      anchorIds: ["anchor-a", "anchor-b"],
      tags: [...(overrides.tags ?? ["director-trace", "continuity"])],
      digest: {
        goal: "Create a continuity-safe teaser.",
        generationType: "new",
        generationStyle: "immersive",
        knowledgeSignalTags: [...(overrides.tags ?? ["continuity"])],
      },
    },
  };
}
