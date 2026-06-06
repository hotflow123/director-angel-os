import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProposalRecord } from "@hotflow/contracts";
import { afterEach, describe, expect, test } from "vitest";

import {
  SKILL_SNAPSHOT_UPSERT_KIND,
  SkillSafeApplyService,
  SkillSnapshotFileStore,
  encodeSkillProposalPayload,
} from "../src/index.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("SkillSafeApplyService", () => {
  test("builds a preview against the current approved head", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-skill-safe-apply-"));
    cleanupPaths.push(workspaceRoot);

    const store = new SkillSnapshotFileStore(
      join(workspaceRoot, "skills", "approved-skills.json"),
      {
        now: () => 200,
      },
    );
    store.writeApproved([
      {
        id: "skill.readme-summary",
        version: "1.0.0",
        title: "README Summary",
        content: "Read the README first, then summarize the repository.",
        updatedAtMs: 100,
      },
    ]);

    const preview = new SkillSafeApplyService(store).previewAcceptedProposal(
      createSkillProposalRecord({
        id: "proposal_2",
        status: "accepted",
        snapshot: {
          id: "skill.readme-summary",
          version: "1.1.0",
          title: "README Summary",
          content: "Read the README carefully, then summarize the repository clearly.",
          updatedAtMs: 150,
        },
      }),
    );

    expect(preview).toMatchObject({
      proposalId: "proposal_2",
      proposalStatus: "accepted",
      skillId: "skill.readme-summary",
      operation: "update",
      currentHeadVersion: 1,
      nextHeadVersion: 2,
    });
    expect(preview.changedFields.map((entry) => entry.field)).toEqual(
      expect.arrayContaining(["version", "content", "updatedAtMs"]),
    );
  });

  test("applies accepted proposals and rolls back to the previous approved version", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-skill-safe-apply-"));
    cleanupPaths.push(workspaceRoot);

    let currentNow = 200;
    const store = new SkillSnapshotFileStore(
      join(workspaceRoot, "skills", "approved-skills.json"),
      {
        now: () => currentNow,
      },
    );
    store.writeApproved([
      {
        id: "skill.readme-summary",
        version: "1.0.0",
        title: "README Summary",
        content: "Read the README first, then summarize the repository.",
        updatedAtMs: 100,
      },
    ]);

    const service = new SkillSafeApplyService(store);
    currentNow = 300;
    const applied = service.applyAcceptedProposal(
      createSkillProposalRecord({
        id: "proposal_2",
        status: "accepted",
        snapshot: {
          id: "skill.readme-summary",
          version: "1.1.0",
          title: "README Summary",
          content: "Read the README carefully, then summarize the repository clearly.",
          updatedAtMs: 150,
        },
      }),
    );

    expect(applied).toMatchObject({
      proposalId: "proposal_2",
      snapshotVersion: 2,
      previousSnapshotVersion: 1,
      approvedSkillCount: 1,
      appliedFromProposalId: "proposal_2",
    });
    expect(store.readHead()).toMatchObject({
      version: 2,
      appliedFromProposalId: "proposal_2",
      changeKind: "apply",
    });

    currentNow = 400;
    const rollback = service.rollbackToVersion();
    expect(rollback).toMatchObject({
      currentVersionBefore: 2,
      restoredFromVersion: 1,
      currentVersionAfter: 3,
      approvedSkillCount: 1,
    });
    expect(store.readApproved()[0]?.content).toBe(
      "Read the README first, then summarize the repository.",
    );
    expect(store.readHead()).toMatchObject({
      version: 3,
      restoredFromVersion: 1,
      changeKind: "rollback",
    });
  });

  test("reverts a failed first apply back to no approved head", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-skill-safe-apply-"));
    cleanupPaths.push(workspaceRoot);

    const store = new SkillSnapshotFileStore(
      join(workspaceRoot, "skills", "approved-skills.json"),
      {
        now: () => 200,
      },
    );
    const service = new SkillSafeApplyService(store);

    const applied = service.applyAcceptedProposal(
      createSkillProposalRecord({
        id: "proposal_first_apply",
        status: "accepted",
        snapshot: {
          id: "skill.readme-summary",
          version: "1.0.0",
          title: "README Summary",
          content: "Read the README first, then summarize the repository.",
          updatedAtMs: 100,
        },
      }),
    );

    service.revertAppliedProposal(applied);

    expect(store.readHead()).toBeNull();
    expect(store.listHistory()).toEqual([]);
  });

  test("blocks failure-to-patch promotion before proposal review acceptance", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-skill-safe-apply-"));
    cleanupPaths.push(workspaceRoot);

    const store = new SkillSnapshotFileStore(
      join(workspaceRoot, "skills", "approved-skills.json"),
      {
        now: () => 200,
      },
    );
    store.writeApproved([
      {
        id: "skill.director.prompt-router",
        version: "1.2.3",
        title: "Prompt router",
        content: "Route the prompt to the best provider.",
        updatedAtMs: 100,
      },
    ]);

    const pendingFailurePatch = createSkillProposalRecord({
      id: "proposal_failure_patch",
      status: "pending",
      snapshot: {
        id: "skill.director.prompt-router",
        version: "1.2.4",
        title: "Prompt router",
        content:
          "Route the prompt to the best provider.\n\nFailure patch: verify setup before retry.",
        updatedAtMs: 150,
      },
    });

    expect(() =>
      new SkillSafeApplyService(store).applyAcceptedProposal(pendingFailurePatch),
    ).toThrow("must be accepted before safe apply");
    expect(store.readApproved()[0]?.version).toBe("1.2.3");
  });
});

function createSkillProposalRecord(input: {
  readonly id: string;
  readonly status: ProposalRecord["status"];
  readonly snapshot: {
    readonly id: string;
    readonly version: string;
    readonly title: string;
    readonly content: string;
    readonly updatedAtMs: number;
  };
}): ProposalRecord {
  return {
    id: input.id,
    kind: SKILL_SNAPSHOT_UPSERT_KIND,
    payload: encodeSkillProposalPayload({
      trajectoryRef: `journal://session_1/${input.id}`,
      snapshot: {
        id: input.snapshot.id,
        version: input.snapshot.version,
        title: input.snapshot.title,
        content: input.snapshot.content,
        updatedAtMs: input.snapshot.updatedAtMs,
      },
    }),
    status: input.status,
    schemaVersion: "0.1.0",
    sourceSessionId: "session_1",
    sourceTurnId: "turn_1",
    provenance: "skills.test",
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}
