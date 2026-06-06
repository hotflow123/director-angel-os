import { describe, expect, it } from "vitest";

import {
  CONTRACTS_SCHEMA_VERSION,
  createExperienceCandidate,
  createExperiencePromotionRecord,
  createExperienceQualityAssessment,
  createExperienceQuarantineRecord,
  createExperienceReviewDecision,
  createExperienceRollbackRecord,
  createExperienceSourceAdapterDeclaration,
  createExperienceSourceArtifact,
  createLearningEvidence,
  createProposalCandidate,
  createTrajectoryDigest,
  stringifyCanonicalJson,
} from "../src/index.js";

describe("learning contracts", () => {
  it("creates versioned learning contracts with normalized arrays", () => {
    const digest = createTrajectoryDigest({
      digestId: "digest_sess_1_turn_1",
      sourceSessionId: "sess_1",
      sourceTurnId: "turn_1",
      trajectoryRef: "journal://sess_1/turn_1",
      createdAtMs: 120,
      checkpointSeq: 4,
      latestCommittedSeq: 7,
      latestUserText: "Summarize the repo",
      toolNames: ["shell.exec", "filesystem.read_text", "shell.exec"],
      counts: {
        journalEventsInTurn: 4,
        toolCallCount: 1,
        toolResultCount: 1,
        assistantOutputCount: 1,
      },
      evidence: [
        createLearningEvidence({
          evidenceId: "evidence_2",
          eventType: "tool.result",
          seq: 3,
          turnId: "turn_1",
          createdAtMs: 115,
          summary: "filesystem.read_text completed successfully.",
          attributes: {
            ok: true,
            toolName: "filesystem.read_text",
          },
        }),
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
      ],
    });

    const candidate = createProposalCandidate({
      candidateId: "candidate_1",
      digestId: digest.digestId,
      sourceSessionId: digest.sourceSessionId,
      sourceTurnId: digest.sourceTurnId,
      trajectoryRef: digest.trajectoryRef,
      title: "Repo summary routine",
      summary: "Summarize repository state from committed evidence.",
      tags: ["repo", "worker-generated", "repo"],
      evidenceIds: ["evidence_2", "evidence_1", "evidence_2"],
      provenance: "worker-jobs/trajectory-summary",
    });

    expect(digest.schemaVersion).toBe(CONTRACTS_SCHEMA_VERSION);
    expect(digest.toolNames).toEqual(["filesystem.read_text", "shell.exec"]);
    expect(digest.evidence.map((entry) => entry.evidenceId)).toEqual(["evidence_1", "evidence_2"]);
    expect(candidate.schemaVersion).toBe(CONTRACTS_SCHEMA_VERSION);
    expect(candidate.tags).toEqual(["repo", "worker-generated"]);
    expect(candidate.evidenceIds).toEqual(["evidence_1", "evidence_2"]);
  });

  it("serializes nested learning payloads canonically", () => {
    const first = {
      z: [{ b: 2, a: 1 }],
      a: { d: 4, c: 3 },
      b: "stable",
    };
    const second = {
      b: "stable",
      a: { c: 3, d: 4 },
      z: [{ a: 1, b: 2 }],
    };

    expect(stringifyCanonicalJson(first)).toBe(stringifyCanonicalJson(second));
  });

  it("creates review-gated experience candidates from declared external source adapters", () => {
    const sourceAdapter = createExperienceSourceAdapterDeclaration({
      adapterId: "adapter_mempalace",
      sourceKind: "local-repository",
      sourceRef: "repo://mempalace",
      privacy: "internal",
      incremental: {
        cursor: "sha256:abc123",
        fingerprint: "sha256:abc123",
      },
      transformations: [
        {
          transformId: "summarize",
          kind: "summarize",
          summary: "Summarize reusable patterns before review.",
        },
        {
          transformId: "redact",
          kind: "redact",
          summary: "Remove private paths and secrets before candidate creation.",
          privacyImpact: "internal",
        },
      ],
    });

    const candidate = createExperienceCandidate({
      candidateId: "experience_mempalace_adapter_contract",
      sourceAdapter,
      title: "Adapter contract pattern",
      summary: "Use explicit source adapters with incremental cursors.",
      applicability: "When Director Angel learns from external repositories.",
      risks: ["External content remains untrusted until review."],
      tags: ["adapter", "learning", "adapter"],
      evidence: [
        {
          evidenceId: "evidence_contract",
          sourceRef: "repo://mempalace#README.md",
          path: "README.md",
          summary: "README describes source adapter boundaries.",
        },
      ],
      privacy: "internal",
      provenance: "director-knowledge/local-reference-repository",
      createdAtMs: 1_000,
    });

    expect(sourceAdapter.schemaVersion).toBe(CONTRACTS_SCHEMA_VERSION);
    expect(sourceAdapter.transformations.map((entry) => entry.transformId)).toEqual([
      "redact",
      "summarize",
    ]);
    expect(candidate.schemaVersion).toBe(CONTRACTS_SCHEMA_VERSION);
    expect(candidate.status).toBe("candidate");
    expect(candidate.runtimeInjection).toBe("disabled");
    expect(candidate.tags).toEqual(["adapter", "learning"]);
    expect(candidate.evidence.map((entry) => entry.evidenceId)).toEqual(["evidence_contract"]);
  });

  it("declares desktop directory, web page, and web search sources as review-gated experience inputs", () => {
    const directoryAdapter = createExperienceSourceAdapterDeclaration({
      adapterId: "desktop_directory_briefs",
      sourceKind: "local-directory",
      sourceRef: "file:///Users/example/Desktop/briefs",
      privacy: "confidential",
      transformations: [
        {
          transformId: "extract-pattern",
          kind: "extract-pattern",
          summary: "Extract reusable direction patterns from user-provided desktop files.",
          privacyImpact: "confidential",
        },
      ],
    });
    const webAdapter = createExperienceSourceAdapterDeclaration({
      adapterId: "web_page_reference",
      sourceKind: "web-page",
      sourceRef: "https://example.com/directing-guide",
      privacy: "public",
      transformations: [
        {
          transformId: "summarize",
          kind: "summarize",
          summary: "Summarize public web guidance into a reviewable experience candidate.",
        },
      ],
    });
    const searchAdapter = createExperienceSourceAdapterDeclaration({
      adapterId: "web_search_directing",
      sourceKind: "web-search",
      sourceRef: "search://director-agent-experience?q=directing%20workflow",
      privacy: "public",
      transformations: [
        {
          transformId: "extract-pattern",
          kind: "extract-pattern",
          summary: "Extract reusable operating patterns from searched web references.",
        },
      ],
    });

    expect(directoryAdapter.sourceKind).toBe("local-directory");
    expect(directoryAdapter.privacy).toBe("confidential");
    expect(webAdapter.sourceKind).toBe("web-page");
    expect(webAdapter.privacy).toBe("public");
    expect(searchAdapter.sourceKind).toBe("web-search");
    expect(searchAdapter.privacy).toBe("public");
  });

  it("creates explicit review, promotion, and rollback records for experience candidates", () => {
    const review = createExperienceReviewDecision({
      decisionId: "review_1",
      candidateId: "experience_1",
      gate: "human",
      decision: "accepted",
      decidedAtMs: 2_000,
      reviewerId: "operator-a",
      note: "Approved for knowledge candidate conversion.",
    });
    const promotion = createExperiencePromotionRecord({
      promotionId: "promotion_1",
      candidateId: "experience_1",
      promotedTo: "director-knowledge-candidate",
      promotedRef: "knowledge://candidate/director-method-1",
      promotedAtMs: 2_100,
      actorId: "operator-a",
    });
    const rollback = createExperienceRollbackRecord({
      rollbackId: "rollback_1",
      promotionId: "promotion_1",
      candidateId: "experience_1",
      rolledBackAtMs: 2_200,
      reason: "Candidate was superseded by a safer source.",
      actorId: "operator-a",
    });

    expect(review.schemaVersion).toBe(CONTRACTS_SCHEMA_VERSION);
    expect(review.decision).toBe("accepted");
    expect(promotion.promotedTo).toBe("director-knowledge-candidate");
    expect(rollback.promotionId).toBe("promotion_1");
  });

  it("keeps source artifact raw content and quarantine quality metadata reviewable", () => {
    const artifact = createExperienceSourceArtifact({
      artifactId: "artifact_web_login",
      sourceKind: "web-page",
      sourceRef: "https://example.com/login",
      title: "Login",
      contentType: "text/html",
      digest: "sha256:login",
      bytes: 24,
      textPreview: "Sign in to continue.",
      rawContent: "Sign in to continue.",
      quality: createExperienceQualityAssessment({
        score: 8,
        verdict: "quarantine",
        reasons: ["authentication page rather than source content"],
      }),
      privacy: "public",
      provenance: "director-knowledge/web-self-learning",
      capturedAtMs: 1_000,
    });
    const quarantine = createExperienceQuarantineRecord({
      quarantineId: "quarantine_web_login",
      artifact,
      reason: "authentication page rather than source content",
      notes: ["Source evidence retained for review."],
      createdAtMs: 1_000,
    });

    expect(artifact.rawContent).toBe("Sign in to continue.");
    expect(quarantine.artifact.rawContent).toBe("Sign in to continue.");
    expect(quarantine.artifact.quality).toMatchObject({
      verdict: "quarantine",
      reasons: ["authentication page rather than source content"],
    });
  });

  it("keeps structured source snapshots with blocks, tables, and media", () => {
    const artifact = createExperienceSourceArtifact({
      artifactId: "artifact_rich_source",
      sourceKind: "web-page",
      sourceRef: "https://example.com/rich-source",
      title: "Rich source",
      contentType: "text/plain; charset=utf-8",
      digest: "sha256:rich",
      bytes: 120,
      textPreview: "AI短剧基础知识",
      rawContent: "AI短剧基础知识\n## 页面内容",
      structuredContent: {
        schemaVersion: "director.source.snapshot.v1",
        kind: "browser-capture",
        blocks: [
          { kind: "text", text: "先确认画面目的。" },
          {
            kind: "media",
            media: {
              kind: "image",
              src: "https://cdn.example.com/shot.png",
              alt: "景别示意图",
            },
          },
        ],
        tables: [
          {
            caption: "角度",
            rows: [
              ["角度", "作用"],
              ["仰视", "增强力量感"],
            ],
          },
        ],
        media: [
          {
            kind: "image",
            src: "https://cdn.example.com/shot.png",
            alt: "景别示意图",
          },
        ],
      },
      quality: createExperienceQualityAssessment({
        score: 88,
        verdict: "usable",
        reasons: ["structured source content captured"],
      }),
      privacy: "public",
      provenance: "director-knowledge/web-self-learning",
      capturedAtMs: 1_500,
    });

    expect(artifact.structuredContent).toMatchObject({
      schemaVersion: "director.source.snapshot.v1",
      kind: "browser-capture",
    });
    expect(stringifyCanonicalJson(artifact.structuredContent ?? null)).toContain("景别示意图");
  });
});
