import {
  CONTRACTS_SCHEMA_VERSION,
  createExperienceCandidate,
  createExperienceSourceAdapterDeclaration,
  createLearningEvidence,
  createTrajectoryDigest,
} from "@hotflow/contracts";
import { describe, expect, test } from "vitest";

import {
  type SkillUsageRecord,
  generateSkillFailurePatchProposal,
  generateSkillProposalFromDigest,
  generateSkillProposalFromExperienceCandidate,
} from "../src/index.js";

describe("generateSkillProposalFromDigest", () => {
  test("builds a rich proposal shape from a committed digest", () => {
    const digest = createTrajectoryDigest({
      digestId: "digest_repo_turn_1",
      sourceSessionId: "session_repo",
      sourceTurnId: "turn_1",
      trajectoryRef: "journal://session_repo/turn_1",
      createdAtMs: 130,
      checkpointSeq: 0,
      latestCommittedSeq: 4,
      latestUserText: "Summarize the repo",
      toolNames: ["filesystem.read_text"],
      counts: {
        journalEventsInTurn: 4,
        toolCallCount: 1,
        toolResultCount: 1,
        assistantOutputCount: 1,
      },
      evidence: [
        createLearningEvidence({
          evidenceId: "evidence_1",
          eventType: "user.input",
          seq: 1,
          turnId: "turn_1",
          createdAtMs: 100,
          summary: "Summarize the repo",
          attributes: {
            text: "Summarize the repo",
          },
        }),
        createLearningEvidence({
          evidenceId: "evidence_2",
          eventType: "tool.result",
          seq: 3,
          turnId: "turn_1",
          createdAtMs: 120,
          summary: "filesystem.read_text completed with ok=true.",
          attributes: {
            ok: true,
            toolName: "filesystem.read_text",
          },
        }),
      ],
    });

    const result = generateSkillProposalFromDigest({
      digest,
      approvedSkills: [],
      provenance: "worker-jobs/trajectory-summary",
    });

    expect(result.candidate.schemaVersion).toBe(CONTRACTS_SCHEMA_VERSION);
    expect(result.trigger).toBe("Summarize the repo");
    expect(result.evidenceSummary).toContain("Summarize the repo");
    expect(result.riskLevel).toBe("low");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.dedupeKey).toContain("summarize-the-repo");
    expect(result.duplicateMatch).toBeUndefined();
    expect(result.snapshot.toolNames).toEqual(["filesystem.read_text"]);
    expect(result.snapshot.metadata).toMatchObject({
      dedupeKey: result.dedupeKey,
      confidence: result.confidence,
      riskLevel: "low",
      trigger: "Summarize the repo",
    });
  });

  test("marks obvious duplicates against approved skills with a skip recommendation", () => {
    const digest = createTrajectoryDigest({
      digestId: "digest_repo_turn_2",
      sourceSessionId: "session_repo",
      sourceTurnId: "turn_2",
      trajectoryRef: "journal://session_repo/turn_2",
      createdAtMs: 200,
      checkpointSeq: 0,
      latestCommittedSeq: 4,
      latestUserText: "Summarize the repo",
      toolNames: ["filesystem.read_text"],
      counts: {
        journalEventsInTurn: 4,
        toolCallCount: 1,
        toolResultCount: 1,
        assistantOutputCount: 1,
      },
      evidence: [
        createLearningEvidence({
          evidenceId: "evidence_1",
          eventType: "user.input",
          seq: 1,
          turnId: "turn_2",
          createdAtMs: 100,
          summary: "Summarize the repo",
          attributes: {
            text: "Summarize the repo",
          },
        }),
      ],
    });

    const duplicate = generateSkillProposalFromDigest({
      digest,
      approvedSkills: [
        {
          id: "skill.approved.summary",
          version: "1.0.0",
          title: "Repo summary",
          content: "Read the README and summarize the repository.",
          updatedAtMs: 150,
          tags: ["repo", "trajectory-analysis"],
          toolNames: ["filesystem.read_text"],
          metadata: {
            dedupeKey: "summarize-the-repo__filesystem-read-text__repo-trajectory-analysis",
          },
        },
      ],
      provenance: "worker-jobs/trajectory-summary",
    });

    expect(duplicate.duplicateMatch).toMatchObject({
      skillId: "skill.approved.summary",
      recommendation: "skip",
      score: 1,
    });
    expect(duplicate.explanation).toContain("skill.approved.summary");
  });

  test("degrades low-evidence digests to high risk and lower confidence", () => {
    const digest = createTrajectoryDigest({
      digestId: "digest_low_evidence",
      sourceSessionId: "session_low",
      sourceTurnId: "turn_low",
      trajectoryRef: "journal://session_low/turn_low",
      createdAtMs: 100,
      checkpointSeq: 0,
      latestCommittedSeq: 1,
      latestUserText: null,
      toolNames: [],
      counts: {
        journalEventsInTurn: 1,
        toolCallCount: 0,
        toolResultCount: 0,
        assistantOutputCount: 0,
      },
      evidence: [
        createLearningEvidence({
          evidenceId: "evidence_1",
          eventType: "user.input",
          seq: 1,
          turnId: "turn_low",
          createdAtMs: 100,
          summary: "Need help",
          attributes: {
            text: "Need help",
          },
        }),
      ],
    });

    const result = generateSkillProposalFromDigest({
      digest,
      approvedSkills: [],
      provenance: "worker-jobs/trajectory-summary",
    });

    expect(result.riskLevel).toBe("high");
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.evidenceSummary).toContain("Need help");
    expect(result.explanation).toContain("low evidence");
  });
});

describe("generateSkillProposalFromExperienceCandidate", () => {
  test("builds the shared Director experience Skill proposal shape for every entry surface", () => {
    const candidate = createExperienceCandidate({
      candidateId: "experience_desktop_lessons",
      sourceAdapter: createExperienceSourceAdapterDeclaration({
        adapterId: "adapter_desktop_lessons",
        sourceKind: "local-directory",
        sourceRef: "file:///Desktop/AngelLessons",
        privacy: "confidential",
        transformations: [
          {
            transformId: "extract-pattern",
            kind: "extract-pattern",
            summary: "Extract reusable production lessons.",
          },
        ],
      }),
      title: "Ask for constraints before production",
      summary: "Ask for missing constraints before generating production assets.",
      applicability: "Use when Director Angel is preparing production work from desktop lessons.",
      risks: ["Local files may contain private details."],
      tags: ["constraint-clarity", "operator-learning"],
      evidence: [
        {
          evidenceId: "evidence_desktop_lessons",
          sourceRef: "file:///Desktop/AngelLessons/lesson.md",
          path: "lesson.md",
          summary: "Lesson says to ask for missing constraints first.",
        },
      ],
      sourceDigest: "sha256:desktop-lessons",
      evidencePreview: "Lesson says to ask for missing constraints first.",
      privacy: "confidential",
      provenance: "director-knowledge/local-directory",
      createdAtMs: Date.parse("2026-04-25T07:59:00.000Z"),
    });

    const result = generateSkillProposalFromExperienceCandidate({
      candidate,
      sourceSessionId: "director-angel-desktop",
      author: "operator-a",
      nowMs: Date.parse("2026-04-25T08:00:00.000Z"),
    });

    expect(result.skillId).toBe("skill.director.ask-for-constraints-before-production");
    expect(result.proposal).toMatchObject({
      id: "skill-proposal-experience-desktop-lessons-1777104000000",
      sourceSessionId: "director-angel-desktop",
      provenance: "skills/director-experience",
    });
    expect(result.proposal.payload).toMatchObject({
      riskLevel: "medium",
      confidence: 0.72,
      trigger: "Ask for constraints before production",
      evidenceSummary: "Lesson says to ask for missing constraints first.",
    });
    expect(result.proposal.payload.snapshot).toMatchObject({
      id: "skill.director.ask-for-constraints-before-production",
      title: "Skill：Ask for constraints before production",
      tags: [
        "director-skill",
        "self-evolved",
        "experience-derived",
        "constraint-clarity",
        "operator-learning",
        "privacy:confidential",
      ],
      metadata: {
        sourceExperienceId: "experience_desktop_lessons",
        sourceExperienceRef: "experience://experience_desktop_lessons",
        sourceRef: "file:///Desktop/AngelLessons",
        skillLifecycle: "proposed",
        auditStatus: "accepted",
        proposalAuthor: "operator-a",
        evidenceCount: 1,
        privacy: "confidential",
        disableModelInvocation: true,
        modelInvocationGate: "operator-review-required",
        dedupeKey: "skill.director.ask-for-constraints-before-production:sha256:desktop-lessons",
      },
    });
  });

  test("keeps restricted experience model-invocation disabled and operator-review gated", () => {
    const restricted = createExperienceCandidate({
      candidateId: "experience_secret_lessons",
      sourceAdapter: createExperienceSourceAdapterDeclaration({
        adapterId: "adapter_secret_lessons",
        sourceKind: "manual",
        sourceRef: "manual://restricted",
        privacy: "restricted",
        transformations: [],
      }),
      title: "Handle launch secrets",
      summary: "Never expose launch secrets.",
      applicability: "Use when lessons contain restricted launch information.",
      risks: ["Restricted content must remain operator gated."],
      tags: ["secrets"],
      evidence: [],
      privacy: "restricted",
      provenance: "director-knowledge/manual",
      createdAtMs: 10,
    });

    const result = generateSkillProposalFromExperienceCandidate({
      candidate: restricted,
      sourceSessionId: "director-angel-desktop",
      nowMs: 20,
    });

    expect(result.proposal.payload).toMatchObject({
      riskLevel: "high",
      confidence: 0.42,
    });
    expect(result.proposal.payload.snapshot).toMatchObject({
      disableModelInvocation: true,
      metadata: {
        privacy: "restricted",
        riskLevel: "high",
        modelInvocationGate: "restricted-experience",
        evidenceCount: 0,
      },
    });
  });
});

describe("generateSkillFailurePatchProposal", () => {
  test("turns repeated Skill failures into a review-gated patch proposal", () => {
    const usage: SkillUsageRecord = {
      skillId: "skill.director.prompt-router",
      viewCount: 0,
      useCount: 2,
      failureCount: 2,
      patchCount: 0,
      createdAtMs: 1777100000000,
      lastViewedAtMs: null,
      lastUsedAtMs: 1777103900000,
      lastFailedAtMs: 1777104060000,
      lastPatchedAtMs: null,
      lastActivityAtMs: 1777104060000,
      state: "active",
      pinned: false,
      archivedAtMs: null,
      events: [
        {
          action: "failure",
          actor: "desktop-review-ops",
          reason: "Skipped the provider setup check before routing.",
          occurredAtMs: 1777104000000,
        },
        {
          action: "failure",
          actor: "desktop-review-ops",
          reason: "Retried without verifying missing auth state.",
          occurredAtMs: 1777104060000,
        },
      ],
    };

    const result = generateSkillFailurePatchProposal({
      sourceSkill: {
        id: "skill.director.prompt-router",
        version: "1.2.3",
        title: "Prompt router",
        content: "Route the prompt to the best provider.",
        updatedAtMs: 1777100000000,
        tags: ["director-skill"],
        toolNames: ["provider.inspect"],
        metadata: {
          dedupeKey: "prompt-router",
        },
      },
      usage,
      sourceSessionId: "director-angel-desktop",
      sourceTurnId: "turn_failure_patch_eval",
      author: "operator-a",
      nowMs: 1777104120000,
    });

    expect(result.proposal.id).toBe(
      "skill-failure-patch-skill-director-prompt-router-1777104120000",
    );
    expect(result.proposalRecord.status).toBe("pending");
    expect(result.patchProposal).toMatchObject({
      id: "skill.director.prompt-router",
      version: "1.2.4",
      metadata: {
        schemaId: "skills.failure-to-patch-eval.v1",
        failurePatchPayload: {
          failureCount: 2,
          lastFailedAtMs: 1777104060000,
        },
        reviewRequirement: "operator-review-required",
        noPromotionWithoutReview: true,
        riskLevel: "high",
      },
    });
    expect(result.patchProposal.content).toContain("Failure patch:");
    expect(result.failureEvidence.failureReasons).toEqual([
      "Skipped the provider setup check before routing.",
      "Retried without verifying missing auth state.",
    ]);
    expect(result.failurePatchPayload).toMatchObject({
      schemaId: "skills.failure-to-patch-eval.v1",
      sourceSkillId: "skill.director.prompt-router",
      reviewRequirement: "operator-review-required",
      noPromotionWithoutReview: true,
    });
    expect(result.reviewRequirement).toBe("operator-review-required");
    expect(result.noPromotionWithoutReview).toBe(true);
    expect(result.riskLevel).toBe("high");
  });
});
