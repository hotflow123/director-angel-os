import { describe, expect, test } from "vitest";

import {
  SKILL_SNAPSHOT_UPSERT_KIND,
  SkillProposalPolicy,
  SkillProposalReviewer,
} from "../src/index.js";

function createRecord(
  overrides: {
    provenance?: string;
    trajectoryRef?: string;
    content?: string;
    toolNames?: readonly string[];
    riskLevel?: "low" | "medium" | "high";
    confidence?: number;
    duplicateMatch?: {
      skillId: string;
      recommendation: "merge" | "skip";
      reason: string;
      score: number;
    };
  } = {},
) {
  return {
    id: "proposal_review_1",
    kind: SKILL_SNAPSHOT_UPSERT_KIND,
    payload: {
      trajectoryRef: overrides.trajectoryRef ?? "journal://session_1/turn_1",
      ...(overrides.riskLevel === undefined ? {} : { riskLevel: overrides.riskLevel }),
      ...(overrides.confidence === undefined ? {} : { confidence: overrides.confidence }),
      ...(overrides.duplicateMatch === undefined
        ? {}
        : { duplicateMatch: overrides.duplicateMatch }),
      snapshot: {
        id: "skill.readme.summary",
        version: "1.0.0",
        title: "README Summary",
        content:
          overrides.content ?? "Read the README first, then summarize the repository clearly.",
        updatedAtMs: 100,
        ...(overrides.toolNames === undefined ? {} : { toolNames: [...overrides.toolNames] }),
      },
    },
    status: "pending" as const,
    schemaVersion: "0.1.0",
    sourceSessionId: "session_1",
    sourceTurnId: "turn_1",
    provenance: overrides.provenance ?? "worker-jobs/trajectory-summary",
    createdAtMs: 100,
    updatedAtMs: 100,
  };
}

describe("SkillProposalReviewer", () => {
  test("accepts a valid worker-generated skill proposal", () => {
    const result = new SkillProposalReviewer().reviewProposal(createRecord());

    expect(result.verdict).toBe("accepted");
    expect(result.issues).toEqual([]);
    expect(result.proposal?.snapshot.id).toBe("skill.readme.summary");
  });

  test("rejects proposals with risky content or untrusted provenance", () => {
    const result = new SkillProposalReviewer().reviewProposal(
      createRecord({
        provenance: "random-sidecar/run",
        content: "Use sudo rm -rf / to clean the workspace.",
      }),
    );

    expect(result.verdict).toBe("rejected");
    expect(result.issues.map((issue) => issue.code)).toContain("untrusted_provenance");
    expect(result.issues.map((issue) => issue.code)).toContain("dangerous_content");
    expect(result.issues.filter((issue) => issue.code === "dangerous_content")).toHaveLength(1);
    expect(result.issues.every((issue) => issue.severity === "fatal")).toBe(true);
  });

  test("rejects failure-to-patch proposals with dangerous generated content", () => {
    const result = new SkillProposalReviewer().reviewProposal(
      createRecord({
        provenance: "random-sidecar/run",
        content:
          "Failure patch generated this unsafe recovery step: use sudo rm -rf / before retrying.",
        riskLevel: "high",
        confidence: 0.58,
      }),
    );

    expect(result.verdict).toBe("rejected");
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["dangerous_content", "untrusted_provenance"]),
    );
  });

  test("requires operator review for high-risk proposals instead of auto-accepting them", () => {
    const result = new SkillProposalReviewer().reviewProposal(
      createRecord({
        riskLevel: "high",
        confidence: 0.35,
        duplicateMatch: {
          skillId: "skill.readme.summary",
          recommendation: "merge",
          reason: "Matches existing summary workflow.",
          score: 0.82,
        },
      }),
    );

    expect(result.verdict).toBe("operator_review");
    expect(result.decisionNote).toContain("operator review");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "high_risk_level",
          severity: "risky",
        }),
        expect.objectContaining({
          code: "low_confidence",
          severity: "warning",
        }),
        expect.objectContaining({
          code: "duplicate_candidate",
          severity: "info",
        }),
      ]),
    );
  });

  test("requires operator review for proposals below the auto-accept confidence threshold", () => {
    const result = new SkillProposalReviewer().reviewProposal(
      createRecord({
        riskLevel: "low",
        confidence: 0.2,
      }),
    );

    expect(result.verdict).toBe("operator_review");
    expect(result.decisionNote).toContain("operator review");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "low_confidence",
          severity: "warning",
        }),
      ]),
    );
  });
});

describe("SkillProposalPolicy", () => {
  test("rejects non-journal trajectory refs", () => {
    const reviewer = new SkillProposalReviewer(undefined, new SkillProposalPolicy());
    const result = reviewer.reviewProposal(
      createRecord({
        trajectoryRef: "file://session_1/turn_1",
      }),
    );

    expect(result.verdict).toBe("rejected");
    expect(result.issues).toEqual([
      {
        code: "invalid_trajectory_ref",
        field: "trajectoryRef",
        message: "Skill proposals must point to a committed journal trajectory.",
        severity: "fatal",
      },
    ]);
  });
});
