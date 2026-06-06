import type { ProposalRecord } from "@hotflow/contracts";
import { describe, expect, test } from "vitest";

import { SkillReconciler } from "../src/reconcile.js";
import { InMemorySkillRepository } from "../src/repository.js";

describe("SkillReconciler", () => {
  test("upserts approved skill snapshots from accepted proposals", () => {
    const repository = new InMemorySkillRepository();
    const reconciler = new SkillReconciler(repository, undefined, {
      now: () => 500,
    });

    const proposal: ProposalRecord = {
      id: "proposal_1",
      kind: "skills.snapshot_upsert",
      payload: {
        trajectoryRef: "journal://session_1/turn_1",
        snapshot: {
          id: "readme-summary",
          version: "1.0.0",
          title: "Summarize README",
          content: "Read first, then summarize.",
          updatedAtMs: 120,
          tags: ["readme"],
        },
      },
      status: "accepted",
      schemaVersion: "0.1.0",
      sourceSessionId: "session_1",
      sourceTurnId: "turn_1",
      provenance: "worker-jobs/trajectory-analysis",
      createdAtMs: 120,
      updatedAtMs: 130,
    };

    const result = reconciler.applyAcceptedProposal(proposal);

    expect(result.appliedAtMs).toBe(500);
    expect(repository.getApproved("readme-summary")?.title).toBe("Summarize README");
  });
});
