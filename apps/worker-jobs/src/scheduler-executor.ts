import type { SessionStore } from "@hotflow/sessions";
import type {
  DelegationStatus,
  StartupReconciliationResult,
  TaskBackedSubagentSchedulerTick,
  TaskBackedSubagentSchedulerTickIntent,
} from "@hotflow/tasks-core";
import { reconcileSessionTaskStartup } from "@hotflow/tasks-core";

import { type BootstrapWorkerJobsOptions, bootstrapWorkerJobs } from "./bootstrap.js";
import { type RunDelegationReport, runDelegationJob } from "./run-delegation.js";
import { runSchedulerTickJob } from "./scheduler-tick.js";
import { resolveWorkerJobSessionStore } from "./session-store.js";

export interface SchedulerExecutorInput extends BootstrapWorkerJobsOptions {
  readonly sessionId: string;
  readonly maxDispatches?: number;
  readonly sessionStore?: SessionStore;
}

export type SchedulerExecutorStoppedReason =
  | "max-dispatches"
  | "scheduler-blocked"
  | "mailbox-empty";

export interface SchedulerExecutorReport {
  readonly status: "ok";
  readonly sessionId: string;
  readonly executorMode: "bounded-local";
  readonly startupReconciliation: SchedulerExecutorStartupReconciliationReport;
  readonly maxDispatches: number;
  readonly executedCount: number;
  readonly stoppedReason: SchedulerExecutorStoppedReason;
  readonly initialSchedulerTick: TaskBackedSubagentSchedulerTick;
  readonly finalSchedulerTick: TaskBackedSubagentSchedulerTick;
  readonly executedDispatchIntents: readonly TaskBackedSubagentSchedulerTickIntent[];
  readonly skippedDispatchIntentIds: readonly string[];
  readonly dispatchReports: readonly RunDelegationReport[];
}

export interface SchedulerExecutorStartupReconciliationReport {
  readonly reconciledDelegationIds: readonly string[];
  readonly runningDelegationTargetStatus: Extract<DelegationStatus, "failed">;
}

const DEFAULT_MAX_DISPATCHES = 1;
const MAX_SCHEDULER_EXECUTOR_DISPATCHES = 10;
const ORPHANED_RUNNING_DELEGATION_TARGET_STATUS = "failed" as const;
const ORPHANED_RUNNING_DELEGATION_FAILURE_REASON =
  "Recovered orphaned running subagent delegation before scheduler execution.";

export async function runSchedulerExecutorJob(
  input: SchedulerExecutorInput,
): Promise<SchedulerExecutorReport> {
  const ownRuntime = input.sessionStore === undefined;
  const runtime = ownRuntime ? bootstrapWorkerJobs(input) : null;
  const sessionStore = resolveWorkerJobSessionStore(input.sessionStore, runtime);
  const maxDispatches = normalizeMaxDispatches(input.maxDispatches);

  try {
    const startupReconciliation = reconcileOrphanedRunningDelegations(
      sessionStore,
      input.sessionId,
    );
    const initialSchedulerTick = await runSchedulerTickJob({
      sessionId: input.sessionId,
      sessionStore,
      ...(input.env === undefined ? {} : { env: input.env }),
    });
    const selectedIntents = initialSchedulerTick.dispatchIntents.slice(0, maxDispatches);
    const skippedDispatchIntentIds = initialSchedulerTick.dispatchIntents
      .slice(maxDispatches)
      .map((intent) => intent.intentId);
    const dispatchReports: RunDelegationReport[] = [];

    for (const intent of selectedIntents) {
      dispatchReports.push(
        await runDelegationJob({
          sessionId: input.sessionId,
          workerId: intent.workerId,
          delegationId: intent.delegationId,
          maxClaims: 1,
          sessionStore,
          ...(input.env === undefined ? {} : { env: input.env }),
        }),
      );
    }

    const finalSchedulerTick = await runSchedulerTickJob({
      sessionId: input.sessionId,
      sessionStore,
      ...(input.env === undefined ? {} : { env: input.env }),
    });

    return {
      status: "ok",
      sessionId: input.sessionId,
      executorMode: "bounded-local",
      startupReconciliation,
      maxDispatches,
      executedCount: dispatchReports.length,
      stoppedReason: resolveStoppedReason(
        dispatchReports.length,
        maxDispatches,
        finalSchedulerTick,
      ),
      initialSchedulerTick,
      finalSchedulerTick,
      executedDispatchIntents: selectedIntents,
      skippedDispatchIntentIds,
      dispatchReports,
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
): SchedulerExecutorStartupReconciliationReport {
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

function normalizeMaxDispatches(value: number | undefined): number {
  const maxDispatches = value ?? DEFAULT_MAX_DISPATCHES;
  if (
    !Number.isInteger(maxDispatches) ||
    maxDispatches < 1 ||
    maxDispatches > MAX_SCHEDULER_EXECUTOR_DISPATCHES
  ) {
    throw new Error(
      `maxDispatches must be an integer between 1 and ${MAX_SCHEDULER_EXECUTOR_DISPATCHES}.`,
    );
  }
  return maxDispatches;
}

function resolveStoppedReason(
  executedCount: number,
  maxDispatches: number,
  finalSchedulerTick: TaskBackedSubagentSchedulerTick,
): SchedulerExecutorStoppedReason {
  if (executedCount >= maxDispatches) {
    return "max-dispatches";
  }
  return finalSchedulerTick.dispatchPlan.dispatchReason === "scheduler-blocked"
    ? "scheduler-blocked"
    : "mailbox-empty";
}
