import { type LoadConfigOptions, loadConfig } from "@hotflow/config";
import type { SessionStore } from "@hotflow/sessions";
import {
  SkillSafeApplyService,
  SkillSnapshotFileStore,
  resolveApprovedSkillSnapshotPath,
} from "@hotflow/skills";
import { SessionStoreTaskPlanePort, readCommittedSessionTaskSnapshot } from "@hotflow/tasks-core";

import { bootstrapWorkerJobs } from "./bootstrap.js";
import { resolveWorkerJobSessionStore } from "./session-store.js";

export interface ReconcileSkillProposalInput extends LoadConfigOptions {
  readonly sessionId: string;
  readonly proposalId: string;
  readonly approvedSkillSnapshotPath?: string;
  readonly now?: () => number;
  readonly sessionStore?: SessionStore;
}

export interface ReconcileSkillProposalReport {
  readonly status: "ok";
  readonly sessionId: string;
  readonly proposalId: string;
  readonly proposalStatusBefore: "accepted" | "applied";
  readonly proposalStatusAfter: "applied";
  readonly appliedSkillId: string;
  readonly applyOperation: "create" | "update";
  readonly changedFields: readonly string[];
  readonly approvedSkillCountBefore: number;
  readonly approvedSkillCountAfter: number;
  readonly snapshotVersion: number;
  readonly previousSnapshotVersion: number | null;
  readonly approvedSkillSnapshotPath: string;
  readonly journalDelta: number;
  readonly latestTurnId: string | null;
}

export async function runSkillProposalReconcileJob(
  input: ReconcileSkillProposalInput,
): Promise<ReconcileSkillProposalReport> {
  const ownRuntime = input.sessionStore === undefined;
  const runtime = ownRuntime ? bootstrapWorkerJobs(input) : null;
  const sessionStore = resolveWorkerJobSessionStore(input.sessionStore, runtime);
  const config = loadConfig({
    ...(input.env ? { env: input.env } : {}),
  });
  const snapshotPath =
    input.approvedSkillSnapshotPath ?? resolveApprovedSkillSnapshotPath(config, input.env);
  const now = input.now ?? Date.now;

  try {
    const before = readCommittedSessionTaskSnapshot(sessionStore, input.sessionId);
    const taskPlane = new SessionStoreTaskPlanePort(sessionStore, input.sessionId, {
      createIfMissing: false,
    });
    const proposal = await taskPlane.getProposal(input.proposalId);
    if (!proposal) {
      throw new Error(`Unknown proposal: ${input.proposalId}`);
    }
    if (proposal.status !== "accepted" && proposal.status !== "applied") {
      throw new Error(`Skill proposal ${input.proposalId} must be accepted before reconciliation.`);
    }

    const snapshotStore = new SkillSnapshotFileStore(snapshotPath, { now });
    const approvedSkillCountBefore = snapshotStore.readApproved().length;
    const reconcileResult = new SkillSafeApplyService(snapshotStore).applyAcceptedProposal(
      proposal,
    );
    await taskPlane.transitionProposal({
      proposalId: input.proposalId,
      status: "applied",
      decisionNote: `Applied to approved skill snapshot at ${snapshotPath}`,
    });

    const after = readCommittedSessionTaskSnapshot(sessionStore, input.sessionId);

    return {
      status: "ok",
      sessionId: input.sessionId,
      proposalId: input.proposalId,
      proposalStatusBefore: proposal.status,
      proposalStatusAfter: "applied",
      appliedSkillId: reconcileResult.skillId,
      applyOperation: reconcileResult.operation,
      changedFields: reconcileResult.changedFields.map((entry) => entry.field),
      approvedSkillCountBefore,
      approvedSkillCountAfter: reconcileResult.approvedSkillCount,
      snapshotVersion: reconcileResult.snapshotVersion,
      previousSnapshotVersion: reconcileResult.previousSnapshotVersion,
      approvedSkillSnapshotPath: snapshotPath,
      journalDelta: after.journal.length - before.journal.length,
      latestTurnId: after.latestTurnId,
    };
  } finally {
    if (ownRuntime) {
      runtime?.close();
    }
  }
}
