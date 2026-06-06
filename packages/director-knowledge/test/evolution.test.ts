import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  diffDirectorKnowledgePack,
  materializeDirectorKnowledgeCandidateFromProposal,
} from "../src/evolution.js";
import { FileKnowledgeStore } from "../src/store.js";
import { materializeDirectorKnowledgePackFromProposal } from "../src/types.js";

describe("director knowledge evolution", () => {
  const root = join(tmpdir(), "director-knowledge-evolution-test");

  beforeEach(() => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("materializes a create candidate from an accepted proposal", () => {
    const candidate = materializeDirectorKnowledgeCandidateFromProposal(
      createAcceptedProposalFixture({
        proposalId: "proposal-create",
        dedupeKey: "project-1__group-1__continuity-safe-teaser",
      }),
      {
        author: "operator-a",
        note: "candidate for beta6",
        now: "2026-04-13T10:00:00.000Z",
      },
    );

    expect(candidate.stage).toBe("candidate");
    expect(candidate.metadata.id).toBe("director-method-project-1-group-1-continuity-safe-teaser");
    expect(candidate.metadata.version).toBe(1);
    expect(candidate.evolution.operation).toBe("create");
    expect(candidate.evolution.baseVersion).toBeNull();
    expect(candidate.evolution.nextVersion).toBe(1);
    expect(candidate.diff.baseVersion).toBeNull();
    expect(candidate.diff.nextVersion).toBe(1);
    expect(candidate.diff.changedFields.map((entry) => entry.field)).toEqual(
      expect.arrayContaining([
        "metadata.version",
        "metadata.title",
        "metadata.description",
        "metadata.tags",
        "method.trigger",
        "method.summary",
        "method.explanation",
        "method.roles",
        "method.preferredAdapters",
        "method.anchorIds",
      ]),
    );
    expect(candidate.diff.summary).toContain("create");
  });

  it("materializes an update candidate with deterministic diff and version bump", () => {
    const currentPublished = {
      ...materializeDirectorKnowledgePackFromProposal(
        createAcceptedProposalFixture({
          proposalId: "proposal-base",
          dedupeKey: "project-1__group-1__continuity-safe-teaser",
          explanation: "Use continuity-safe planning, preserve anchors, keep the visual tone.",
          selectedAdapters: ["scripted"],
          tags: ["continuity"],
        }),
        {
          author: "operator-a",
          note: "publish base",
          now: "2026-04-13T09:00:00.000Z",
        },
      ),
      metadata: {
        ...materializeDirectorKnowledgePackFromProposal(
          createAcceptedProposalFixture({
            proposalId: "proposal-base",
            dedupeKey: "project-1__group-1__continuity-safe-teaser",
            explanation: "Use continuity-safe planning, preserve anchors, keep the visual tone.",
            selectedAdapters: ["scripted"],
            tags: ["continuity"],
          }),
          {
            author: "operator-a",
            note: "publish base",
            now: "2026-04-13T09:00:00.000Z",
          },
        ).metadata,
        version: 3,
      },
    };

    const candidate = materializeDirectorKnowledgeCandidateFromProposal(
      createAcceptedProposalFixture({
        proposalId: "proposal-update",
        dedupeKey: "project-1__group-1__continuity-safe-teaser",
        explanation:
          "Use continuity-safe planning, preserve anchors, and prefer seedance when the teaser needs motion polish.",
        selectedAdapters: ["scripted", "seedance"],
        tags: ["continuity", "motion"],
      }),
      {
        currentPublished,
        author: "operator-b",
        note: "upgrade the method",
        now: "2026-04-13T11:00:00.000Z",
      },
    );

    const changedFields = candidate.diff.changedFields.map((entry) => entry.field);

    expect(candidate.evolution.operation).toBe("update");
    expect(candidate.evolution.baseVersion).toBe(3);
    expect(candidate.evolution.nextVersion).toBe(4);
    expect(candidate.metadata.version).toBe(4);
    expect(candidate.diff.baseVersion).toBe(3);
    expect(candidate.diff.nextVersion).toBe(4);
    expect(changedFields).toEqual(
      expect.arrayContaining([
        "metadata.version",
        "metadata.description",
        "metadata.tags",
        "method.explanation",
        "method.preferredAdapters",
      ]),
    );
    expect(changedFields).not.toContain("method.trigger");
    expect(candidate.diff.summary).toContain("v3 -> v4");
  });

  it("rejects current published packs that do not match the proposal pack id", () => {
    const mismatchedPublished = materializeDirectorKnowledgePackFromProposal(
      createAcceptedProposalFixture({
        proposalId: "proposal-mismatch-base",
        dedupeKey: "project-1__group-1__other-method",
      }),
      { now: "2026-04-13T09:30:00.000Z" },
    );

    expect(() =>
      materializeDirectorKnowledgeCandidateFromProposal(
        createAcceptedProposalFixture({
          proposalId: "proposal-mismatch",
          dedupeKey: "project-1__group-1__continuity-safe-teaser",
        }),
        {
          currentPublished: mismatchedPublished,
          now: "2026-04-13T11:10:00.000Z",
        },
      ),
    ).toThrow("does not match proposal pack id");
  });

  it("writes and reads candidate documents through the knowledge store", async () => {
    const store = new FileKnowledgeStore({ knowledgeDir: root });
    const candidate = materializeDirectorKnowledgeCandidateFromProposal(
      createAcceptedProposalFixture({
        proposalId: "proposal-store",
        dedupeKey: "project-1__group-1__continuity-safe-teaser",
      }),
      {
        author: "operator-store",
        note: "queue candidate",
        now: "2026-04-13T12:00:00.000Z",
      },
    );

    const written = await store.writeCandidate(candidate);
    const storedCandidate = await store.getCandidateDocument(candidate.metadata.id);
    const candidates = await store.listCandidateDocuments();
    const candidateRecord = await store.getCandidate();

    expect(written.status).toBe("ok");
    expect(written.packId).toBe(candidate.metadata.id);
    expect(written.version).toBe(1);
    expect(storedCandidate?.stage).toBe("candidate");
    expect(storedCandidate?.diff.summary).toContain("create");
    expect(candidates).toHaveLength(1);
    expect(candidateRecord?.metadata.id).toBe(candidate.metadata.id);
    expect(candidateRecord?.state).toBe("candidate");
  });

  it("diffs a published head against the next candidate payload", () => {
    const current = materializeDirectorKnowledgePackFromProposal(
      createAcceptedProposalFixture({
        proposalId: "proposal-diff-base",
        dedupeKey: "project-2__group-4__hero-cut",
      }),
      {
        now: "2026-04-13T13:00:00.000Z",
      },
    );

    const diff = diffDirectorKnowledgePack(current, {
      metadata: {
        ...current.metadata,
        version: 2,
        title: "Director method: Hero cut with stronger payoff",
      },
      method: {
        ...current.method,
        explanation: `${current.method.explanation} Tighten the final payoff before publish.`,
      },
    });

    expect(diff.operation).toBe("update");
    expect(diff.baseVersion).toBe(1);
    expect(diff.nextVersion).toBe(2);
    expect(diff.changedFields.map((entry) => entry.field)).toEqual(
      expect.arrayContaining(["metadata.version", "metadata.title", "method.explanation"]),
    );
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
      decidedAt: "2026-04-13T09:55:00.000Z",
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
