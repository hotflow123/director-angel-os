import { describe, expect, test } from "vitest";

import { SkillProposalStore } from "./proposal.js";
import { SkillReconciler } from "./reconcile.js";
import { SkillRepository } from "./repository.js";
import { SkillProposalValidator } from "./validator.js";

describe("SkillReconciler", () => {
  test("applies only accepted skill proposals and updates approved snapshot", () => {
    const repository = new SkillRepository();
    const proposals = new SkillProposalStore();
    const validator = new SkillProposalValidator();
    const reconciler = new SkillReconciler(repository, proposals, validator);

    proposals.enqueue({
      id: "proposal-1",
      sourceSessionId: "session-1",
      sourceTurnId: "turn-1",
      trajectoryRef: "traj://session-1/turn-1",
      provenance: "worker-jobs/trajectory-analysis",
      candidate: {
        id: "skill.react-file-summary",
        title: "React file summary skill",
        body: "Read file, summarize, persist todos.",
        version: "1.0.0",
        updatedAtMs: 100,
      },
    });

    expect(() => reconciler.applyAcceptedProposal("proposal-1")).toThrow(
      "must be accepted before apply",
    );

    proposals.transition({
      proposalId: "proposal-1",
      status: "accepted",
    });

    const result = reconciler.applyAcceptedProposal("proposal-1");
    const appliedSkill = repository.getApprovedSkill("skill.react-file-summary");

    expect(result.proposal.status).toBe("applied");
    expect(result.snapshot.skills).toHaveLength(1);
    expect(appliedSkill?.title).toBe("React file summary skill");
  });
});
