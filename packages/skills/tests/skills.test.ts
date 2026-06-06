import type { ProposalRecord } from "@hotflow/contracts";
import { describe, expect, test } from "vitest";

import {
  InMemorySkillRepository,
  SKILL_SNAPSHOT_UPSERT_KIND,
  SkillPromptIndex,
  SkillProposalStore,
  SkillReconciler,
} from "../src/index.js";

function createProposalRecord(
  status: ProposalRecord["status"],
  updatedAtMs: number,
): ProposalRecord {
  return {
    id: "proposal_1",
    kind: SKILL_SNAPSHOT_UPSERT_KIND,
    payload: {
      trajectoryRef: "journal://session_1/turn_1",
      snapshot: {
        id: "readme-summary",
        version: "1.0.0",
        title: "README Summary",
        description: "Summarize repository purpose after reading a top-level README.",
        content: "Read the README first, then return a short repository summary.",
        tags: ["readme", "summary"],
        updatedAtMs: 1,
      },
    },
    status,
    schemaVersion: "0.1.0",
    sourceSessionId: "session_1",
    sourceTurnId: "turn_1",
    provenance: "skills.test",
    createdAtMs: 1,
    updatedAtMs,
  };
}

describe("skills package", () => {
  test("does not expose pending proposals in the approved prompt index", () => {
    const repository = new InMemorySkillRepository();
    const proposals = new SkillProposalStore();
    proposals.upsert(createProposalRecord("pending", 1));

    const promptIndex = new SkillPromptIndex(repository);
    const sections = promptIndex.buildSections({
      limit: 1,
      userText: "Summarize the repository README.",
    });

    expect(proposals.list()).toHaveLength(1);
    expect(sections).toEqual([]);
  });

  test("applies accepted proposals into the approved repository", () => {
    const repository = new InMemorySkillRepository();
    const proposals = new SkillProposalStore();
    proposals.upsert(createProposalRecord("accepted", 2));

    const reconciler = new SkillReconciler(repository, undefined, {
      now: () => 3,
    });
    const acceptedProposal = proposals.get("proposal_1");
    expect(acceptedProposal).toBeDefined();
    if (acceptedProposal === undefined) {
      throw new Error("Expected accepted proposal to exist.");
    }
    const result = reconciler.applyAcceptedProposal(acceptedProposal);
    const promptSections = new SkillPromptIndex(repository).buildSections({
      limit: 1,
      userText: "readme summary",
      toolResults: [{ toolName: "filesystem.read_text", ok: true }],
    });

    expect(result.appliedAtMs).toBe(3);
    expect(result.snapshot.title).toBe("README Summary");
    expect(repository.getApproved("readme-summary")?.title).toBe("README Summary");
    expect(promptSections).toHaveLength(1);
    expect(promptSections[0]?.owner).toBe("skill");
    expect(promptSections[0]?.content).toContain("README Summary");
  });
});
