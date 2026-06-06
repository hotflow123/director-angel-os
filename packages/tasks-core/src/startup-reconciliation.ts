import {
  type SessionTaskAccessOptions,
  type SessionTaskStore,
  mutateSessionTaskState,
} from "./session-task-plane-port.js";
import type { TaskBoard } from "./task-board.js";
import type { DelegationStatus, TaskOperationsState } from "./task-operations.js";

export const STARTUP_RECONCILIATION_REASON = "startup_reconciliation" as const;

type StartupReconciliationDelegationStatus = Extract<DelegationStatus, "queued" | "failed">;

export interface StartupReconciliationOptions {
  readonly runningDelegationTargetStatus?: StartupReconciliationDelegationStatus;
  readonly failureReason?: string;
}

export interface StartupReconciliationResult {
  readonly state: TaskOperationsState;
  readonly reconciledDelegationIds: readonly string[];
}

const DEFAULT_RUNNING_DELEGATION_TARGET_STATUS: StartupReconciliationDelegationStatus = "queued";
const DEFAULT_FAILURE_REASON =
  "Recovered orphaned running delegation during startup reconciliation.";

export function reconcileTaskBoardStartup(
  board: TaskBoard,
  options: StartupReconciliationOptions = {},
): StartupReconciliationResult {
  const runningDelegations = board
    .snapshotOperations()
    .delegation.filter((record) => record.status === "running");

  if (runningDelegations.length === 0) {
    return {
      state: board.snapshotOperations(),
      reconciledDelegationIds: [],
    };
  }

  const targetStatus =
    options.runningDelegationTargetStatus ?? DEFAULT_RUNNING_DELEGATION_TARGET_STATUS;

  for (const record of runningDelegations) {
    board.setDelegationStatus({
      id: record.id,
      status: targetStatus,
      reason: STARTUP_RECONCILIATION_REASON,
      ...(targetStatus === "failed"
        ? {
            error: options.failureReason ?? DEFAULT_FAILURE_REASON,
          }
        : {}),
    });
  }

  return {
    state: board.snapshotOperations(),
    reconciledDelegationIds: runningDelegations.map((record) => record.id),
  };
}

export function reconcileSessionTaskStartup(
  sessionStore: SessionTaskStore,
  sessionId: string,
  options: SessionTaskAccessOptions & StartupReconciliationOptions = {},
): StartupReconciliationResult {
  let reconciledDelegationIds: readonly string[] = [];

  const state = mutateSessionTaskState(
    sessionStore,
    sessionId,
    (board) => {
      reconciledDelegationIds = reconcileTaskBoardStartup(board, options).reconciledDelegationIds;
    },
    options,
  );

  return {
    state,
    reconciledDelegationIds,
  };
}
