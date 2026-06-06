import type { SessionStore } from "@hotflow/sessions";
import {
  SessionStoreTaskPlanePort,
  type VerificationCheck,
  type VerificationStatus,
  type VerificationVerdict,
  readCommittedSessionTaskSnapshot,
  readSessionVerificationMailbox,
} from "@hotflow/tasks-core";

import { type BootstrapWorkerJobsOptions, bootstrapWorkerJobs } from "./bootstrap.js";
import { resolveWorkerJobSessionStore } from "./session-store.js";

export interface RunVerificationInput extends BootstrapWorkerJobsOptions {
  readonly sessionId: string;
  readonly verifierId: string;
  readonly verificationId?: string;
  readonly status?: Exclude<VerificationStatus, "pending">;
  readonly verdictSummary?: string;
  readonly verifiedBy?: string;
  readonly checks?: readonly VerificationCheck[];
  readonly sessionStore?: SessionStore;
}

export interface RunVerificationReport {
  readonly status: "ok";
  readonly sessionId: string;
  readonly verifierId: string;
  readonly verificationId: string;
  readonly initialVerificationMailboxSize: number;
  readonly remainingVerificationMailboxSize: number;
  readonly finalVerificationStatus: Exclude<VerificationStatus, "pending">;
  readonly verifiedBy: string;
  readonly verdict: VerificationVerdict;
  readonly verdictSummary: string;
  readonly checks: readonly VerificationCheck[];
  readonly snapshotVerificationCount: number;
  readonly resultVerificationCount: number;
  readonly journalDelta: number;
  readonly latestTurnId: string | null;
}

export async function runVerificationJob(
  input: RunVerificationInput,
): Promise<RunVerificationReport> {
  const ownRuntime = input.sessionStore === undefined;
  const runtime = ownRuntime ? bootstrapWorkerJobs(input) : null;
  const sessionStore = resolveWorkerJobSessionStore(input.sessionStore, runtime);

  try {
    const before = readCommittedSessionTaskSnapshot(sessionStore, input.sessionId);
    const initialMailbox = readSessionVerificationMailbox(
      sessionStore,
      input.sessionId,
      {
        verifierId: input.verifierId,
        statuses: ["pending"],
      },
      { createIfMissing: false },
    );
    const verification = selectVerificationRecord(
      initialMailbox,
      input.verificationId,
      input.verifierId,
    );
    const finalVerificationStatus = input.status ?? "passed";
    const verdict = verificationStatusToVerdict(finalVerificationStatus);
    const verifiedBy = input.verifiedBy ?? input.verifierId;
    const verdictSummary =
      input.verdictSummary ?? buildDefaultVerdictSummary(finalVerificationStatus, verifiedBy);
    const checks = cloneVerificationChecks(
      input.checks ?? [
        {
          id: "requirement",
          status: verdict,
          summary: verification.requirement,
          detail: verdictSummary,
        },
      ],
    );

    const taskPlane = new SessionStoreTaskPlanePort(sessionStore, input.sessionId, {
      createIfMissing: false,
    });
    await taskPlane.upsertVerification({
      id: verification.id,
      verifierId: verification.verifierId,
      requirement: verification.requirement,
      status: finalVerificationStatus,
      verifiedBy,
      verdict,
      verdictSummary,
      checks,
      ...(verification.taskId === undefined ? {} : { taskId: verification.taskId }),
    });

    const after = readCommittedSessionTaskSnapshot(sessionStore, input.sessionId);
    const remainingVerificationMailboxSize = readSessionVerificationMailbox(
      sessionStore,
      input.sessionId,
      {
        verifierId: input.verifierId,
        statuses: ["pending"],
      },
      { createIfMissing: false },
    ).length;

    return {
      status: "ok",
      sessionId: input.sessionId,
      verifierId: input.verifierId,
      verificationId: verification.id,
      initialVerificationMailboxSize: initialMailbox.length,
      remainingVerificationMailboxSize,
      finalVerificationStatus,
      verifiedBy,
      verdict,
      verdictSummary,
      checks,
      snapshotVerificationCount: before.taskState.verification.length,
      resultVerificationCount: after.taskState.verification.length,
      journalDelta: after.journal.length - before.journal.length,
      latestTurnId: after.latestTurnId,
    };
  } finally {
    if (ownRuntime) {
      runtime?.close();
    }
  }
}

function selectVerificationRecord<TRecord extends { readonly id: string }>(
  records: readonly TRecord[],
  requestedId: string | undefined,
  verifierId: string,
): TRecord {
  if (records.length === 0) {
    throw new Error(`No pending verification found for verifier: ${verifierId}`);
  }
  if (requestedId === undefined) {
    const firstRecord = records[0];
    if (firstRecord === undefined) {
      throw new Error(`No pending verification found for verifier: ${verifierId}`);
    }
    return firstRecord;
  }
  const selected = records.find((record) => record.id === requestedId);
  if (!selected) {
    throw new Error(`Unknown verification in mailbox: ${requestedId}`);
  }
  return selected;
}

function verificationStatusToVerdict(
  status: Exclude<VerificationStatus, "pending">,
): VerificationVerdict {
  if (status === "passed") {
    return "pass";
  }
  if (status === "failed") {
    return "fail";
  }
  return "partial";
}

function buildDefaultVerdictSummary(
  status: Exclude<VerificationStatus, "pending">,
  verifiedBy: string,
): string {
  if (status === "passed") {
    return `Verification passed by ${verifiedBy}.`;
  }
  if (status === "failed") {
    return `Verification failed by ${verifiedBy}.`;
  }
  return `Verification marked partial by ${verifiedBy}.`;
}

function cloneVerificationChecks(checks: readonly VerificationCheck[]): VerificationCheck[] {
  return checks.map((check) => ({
    id: check.id,
    status: check.status,
    summary: check.summary,
    ...(check.detail === undefined ? {} : { detail: check.detail }),
  }));
}
