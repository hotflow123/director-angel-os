import { describe, expect, test } from "vitest";

import {
  SKILL_SNAPSHOT_UPSERT_KIND,
  createSkillProposalQueueInput,
  decodeSkillProposal,
} from "../src/index.js";

describe("createSkillProposalQueueInput", () => {
  test("builds a stable proposal queue payload for worker-generated skill proposals", () => {
    const proposal = createSkillProposalQueueInput({
      id: "proposal_skill_1",
      snapshot: {
        id: "skill.readme-summary",
        version: "1.0.0",
        title: "README Summary",
        content: "Read README, then summarize it.",
        updatedAtMs: 100,
      },
      sourceSessionId: "session_1",
      sourceTurnId: "turn_1",
      trajectoryRef: "journal://session_1/turn_1",
      provenance: "worker-jobs/trajectory-summary",
      expiresAtMs: 500,
    });

    expect(proposal).toEqual({
      id: "proposal_skill_1",
      kind: SKILL_SNAPSHOT_UPSERT_KIND,
      payload: {
        trajectoryRef: "journal://session_1/turn_1",
        snapshot: {
          id: "skill.readme-summary",
          version: "1.0.0",
          title: "README Summary",
          content: "Read README, then summarize it.",
          updatedAtMs: 100,
        },
      },
      sourceSessionId: "session_1",
      sourceTurnId: "turn_1",
      provenance: "worker-jobs/trajectory-summary",
      expiresAtMs: 500,
    });
  });

  test("preserves rich proposal evidence fields when encoding and decoding payloads", () => {
    const proposal = createSkillProposalQueueInput({
      id: "proposal_skill_2",
      snapshot: {
        id: "skill.repo-summary",
        version: "1.0.0",
        title: "Repo Summary",
        content: "Summarize the repository from committed evidence.",
        updatedAtMs: 200,
        toolNames: ["filesystem.read_text"],
      },
      sourceSessionId: "session_2",
      sourceTurnId: "turn_2",
      trajectoryRef: "journal://session_2/turn_2",
      provenance: "worker-jobs/trajectory-summary",
      trigger: "Summarize the repo",
      evidenceSummary: "user.input -> tool.result",
      riskLevel: "low",
      confidence: 0.88,
      dedupeKey: "summarize-the-repo__filesystem-read-text__repo",
      explanation: "Evidence is sufficient and no approved duplicate was found.",
      duplicateMatch: {
        skillId: "skill.old.summary",
        recommendation: "merge",
        reason: "Similar repo-summary workflow already exists.",
        score: 0.74,
      },
    });

    expect(proposal.payload).toMatchObject({
      trajectoryRef: "journal://session_2/turn_2",
      trigger: "Summarize the repo",
      evidenceSummary: "user.input -> tool.result",
      riskLevel: "low",
      confidence: 0.88,
      dedupeKey: "summarize-the-repo__filesystem-read-text__repo",
      explanation: "Evidence is sufficient and no approved duplicate was found.",
      duplicateMatch: {
        skillId: "skill.old.summary",
        recommendation: "merge",
        score: 0.74,
      },
    });

    expect(
      decodeSkillProposal({
        ...proposal,
        status: "pending",
        schemaVersion: "0.1.0",
        createdAtMs: 100,
        updatedAtMs: 100,
      }),
    ).toMatchObject({
      id: "proposal_skill_2",
      trigger: "Summarize the repo",
      evidenceSummary: "user.input -> tool.result",
      riskLevel: "low",
      confidence: 0.88,
      dedupeKey: "summarize-the-repo__filesystem-read-text__repo",
      duplicateMatch: {
        skillId: "skill.old.summary",
        recommendation: "merge",
        score: 0.74,
      },
    });
  });
});
