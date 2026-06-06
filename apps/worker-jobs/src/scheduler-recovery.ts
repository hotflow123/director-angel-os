import type { SessionStore } from "@hotflow/sessions";
import {
  type DelegationStatus,
  SessionStoreTaskPlanePort,
  type StartupReconciliationResult,
  type TaskBackedSubagentSchedulerRecoveryAction,
  type TaskBackedSubagentSchedulerRecoveryActionType,
  type TaskBackedSubagentSchedulerRecoveryPlan,
  projectSubagentSchedulerRecoveryPlanFromTaskState,
  readCommittedSessionTaskSnapshot,
  reconcileSessionTaskStartup,
} from "@hotflow/tasks-core";

import { type BootstrapWorkerJobsOptions, bootstrapWorkerJobs } from "./bootstrap.js";
import { resolveWorkerJobSessionStore } from "./session-store.js";

export interface SchedulerRecoveryInput extends BootstrapWorkerJobsOptions {
  readonly sessionId: string;
  readonly actionId?: string;
  readonly confirmCancelObservedDrift?: boolean;
  readonly sessionStore?: SessionStore;
}

export type SchedulerRecoveryActionResultStatus =
  | "blocked"
  | "requires-confirmation"
  | "cancelled-queued-subagents"
  | "skipped-no-queued-subagents";

export type SchedulerRecoveryActionMutation = "none" | "cancelled-queued-subagents";

export interface SchedulerRecoveryActionResult {
  readonly actionId: string;
  readonly subagentId: string;
  readonly actionType: TaskBackedSubagentSchedulerRecoveryActionType;
  readonly result: SchedulerRecoveryActionResultStatus;
  readonly mutation: SchedulerRecoveryActionMutation;
  readonly confirmationRequired: boolean;
  readonly relatedSubagentIds: readonly string[];
  readonly queuedDelegationIds: readonly string[];
  readonly blockedBy: readonly string[];
  readonly cancelledDelegationIds: readonly string[];
  readonly operatorSummary: string;
}

export interface SchedulerRecoveryReport {
  readonly status: "ok";
  readonly sessionId: string;
  readonly workflowMode: "bounded-local-recovery";
  readonly startupReconciliation: SchedulerRecoveryStartupReconciliationReport;
  readonly dryRun: boolean;
  readonly selectedActionIds: readonly string[];
  readonly cancelledDelegationIds: readonly string[];
  readonly actionResults: readonly SchedulerRecoveryActionResult[];
  readonly initialRecoveryPlan: TaskBackedSubagentSchedulerRecoveryPlan;
  readonly finalRecoveryPlan: TaskBackedSubagentSchedulerRecoveryPlan;
  readonly journalDelta: number;
  readonly latestTurnId: string | null;
  readonly safety: {
    readonly remoteWriteExecutionAllowed: false;
    readonly destructiveActionsRequireConfirmation: true;
    readonly processRunnerAllowed: false;
  };
}

export interface SchedulerRecoveryStartupReconciliationReport {
  readonly reconciledDelegationIds: readonly string[];
  readonly runningDelegationTargetStatus: Extract<DelegationStatus, "failed">;
}

const ORPHANED_RUNNING_DELEGATION_TARGET_STATUS = "failed" as const;
const ORPHANED_RUNNING_DELEGATION_FAILURE_REASON =
  "Recovered orphaned running subagent delegation before scheduler recovery.";

export async function runSchedulerRecoveryJob(
  input: SchedulerRecoveryInput,
): Promise<SchedulerRecoveryReport> {
  const ownRuntime = input.sessionStore === undefined;
  const runtime = ownRuntime ? bootstrapWorkerJobs(input) : null;
  const sessionStore = resolveWorkerJobSessionStore(input.sessionStore, runtime);
  const dryRun = input.confirmCancelObservedDrift !== true;

  try {
    const startupBefore = readCommittedSessionTaskSnapshot(sessionStore, input.sessionId);
    const startupReconciliation = reconcileOrphanedRunningDelegations(
      sessionStore,
      input.sessionId,
    );
    const before = readCommittedSessionTaskSnapshot(sessionStore, input.sessionId);
    const initialRecoveryPlan = projectSubagentSchedulerRecoveryPlanFromTaskState(
      before.taskState,
      before.latestTurnId === null ? {} : { parentTurnId: before.latestTurnId },
    );
    const selectedActions = selectRecoveryActions(initialRecoveryPlan, input.actionId);
    const taskPlane = new SessionStoreTaskPlanePort(sessionStore, input.sessionId, {
      createIfMissing: false,
    });
    const actionResults: SchedulerRecoveryActionResult[] = [];
    const cancelledDelegationIds = new Set<string>();

    for (const action of selectedActions) {
      const queuedDelegationIds = resolveQueuedRecoveryDelegationIds(before.taskState, action);

      if (action.actionType === "wait-for-running-subagent") {
        actionResults.push({
          actionId: action.actionId,
          subagentId: action.subagentId,
          actionType: action.actionType,
          result: "blocked",
          mutation: "none",
          confirmationRequired: false,
          relatedSubagentIds: action.relatedSubagentIds,
          queuedDelegationIds,
          blockedBy: action.evidence.blockedBy,
          cancelledDelegationIds: [],
          operatorSummary: action.operatorSummary,
        });
        continue;
      }

      if (queuedDelegationIds.length === 0) {
        actionResults.push({
          actionId: action.actionId,
          subagentId: action.subagentId,
          actionType: action.actionType,
          result: "skipped-no-queued-subagents",
          mutation: "none",
          confirmationRequired: false,
          relatedSubagentIds: action.relatedSubagentIds,
          queuedDelegationIds,
          blockedBy: action.evidence.blockedBy,
          cancelledDelegationIds: [],
          operatorSummary: action.operatorSummary,
        });
        continue;
      }

      if (dryRun) {
        actionResults.push({
          actionId: action.actionId,
          subagentId: action.subagentId,
          actionType: action.actionType,
          result: "requires-confirmation",
          mutation: "none",
          confirmationRequired: true,
          relatedSubagentIds: action.relatedSubagentIds,
          queuedDelegationIds,
          blockedBy: action.evidence.blockedBy,
          cancelledDelegationIds: [],
          operatorSummary: action.operatorSummary,
        });
        continue;
      }

      const newlyCancelled = queuedDelegationIds.filter(
        (delegationId) => !cancelledDelegationIds.has(delegationId),
      );
      for (const delegationId of newlyCancelled) {
        await taskPlane.setDelegationStatus({
          id: delegationId,
          status: "cancelled",
          reason: "scheduler_recovery_observed_write_set_drift_confirmed",
          resultSummary: `Scheduler recovery cancelled ${delegationId} after confirmed observed write-set drift review.`,
        });
        cancelledDelegationIds.add(delegationId);
      }

      actionResults.push({
        actionId: action.actionId,
        subagentId: action.subagentId,
        actionType: action.actionType,
        result:
          newlyCancelled.length === 0
            ? "skipped-no-queued-subagents"
            : "cancelled-queued-subagents",
        mutation: newlyCancelled.length === 0 ? "none" : "cancelled-queued-subagents",
        confirmationRequired: false,
        relatedSubagentIds: action.relatedSubagentIds,
        queuedDelegationIds,
        blockedBy: action.evidence.blockedBy,
        cancelledDelegationIds: newlyCancelled,
        operatorSummary: action.operatorSummary,
      });
    }

    const after = readCommittedSessionTaskSnapshot(sessionStore, input.sessionId);
    const finalRecoveryPlan = projectSubagentSchedulerRecoveryPlanFromTaskState(
      after.taskState,
      after.latestTurnId === null ? {} : { parentTurnId: after.latestTurnId },
    );

    return {
      status: "ok",
      sessionId: input.sessionId,
      workflowMode: "bounded-local-recovery",
      startupReconciliation,
      dryRun,
      selectedActionIds: selectedActions.map((action) => action.actionId),
      cancelledDelegationIds: [...cancelledDelegationIds],
      actionResults,
      initialRecoveryPlan,
      finalRecoveryPlan,
      journalDelta: after.journal.length - startupBefore.journal.length,
      latestTurnId: after.latestTurnId,
      safety: {
        remoteWriteExecutionAllowed: false,
        destructiveActionsRequireConfirmation: true,
        processRunnerAllowed: false,
      },
    };
  } finally {
    if (ownRuntime) {
      runtime?.close();
    }
  }
}

function reconcileOrphanedRunningDelegations(
  sessionStore: SessionStore,
  sessionId: string,
): SchedulerRecoveryStartupReconciliationReport {
  const result: StartupReconciliationResult = reconcileSessionTaskStartup(sessionStore, sessionId, {
    createIfMissing: false,
    runningDelegationTargetStatus: ORPHANED_RUNNING_DELEGATION_TARGET_STATUS,
    failureReason: ORPHANED_RUNNING_DELEGATION_FAILURE_REASON,
  });

  return {
    reconciledDelegationIds: result.reconciledDelegationIds,
    runningDelegationTargetStatus: ORPHANED_RUNNING_DELEGATION_TARGET_STATUS,
  };
}

function selectRecoveryActions(
  plan: TaskBackedSubagentSchedulerRecoveryPlan,
  actionId: string | undefined,
): readonly TaskBackedSubagentSchedulerRecoveryAction[] {
  if (actionId === undefined) {
    return plan.recoveryActions;
  }
  const selected = plan.recoveryActions.find((action) => action.actionId === actionId);
  if (selected === undefined) {
    throw new Error(`Unknown scheduler recovery action: ${actionId}`);
  }
  return [selected];
}

function resolveQueuedRecoveryDelegationIds(
  state: Parameters<typeof projectSubagentSchedulerRecoveryPlanFromTaskState>[0],
  action: TaskBackedSubagentSchedulerRecoveryAction,
): readonly string[] {
  const candidateIds = [action.subagentId, ...action.relatedSubagentIds];
  return [
    ...new Set(
      candidateIds.filter(
        (delegationId) =>
          state.delegation.find((record) => record.id === delegationId)?.status === "queued",
      ),
    ),
  ];
}
