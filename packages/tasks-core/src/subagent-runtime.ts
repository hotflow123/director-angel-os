import type {
  DelegationObservedWriteSetSource,
  DelegationRecord,
  DelegationSpecialization,
  TaskOperationsState,
  VerificationCheck,
  VerificationGateRecord,
  VerificationStatus,
  VerificationVerdict,
} from "./task-operations.js";

export type TaskBackedSubagentRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface TaskBackedSubagentVerification {
  readonly verificationId: string;
  readonly verifierId: string;
  readonly status: VerificationStatus;
  readonly verdict?: VerificationVerdict;
  readonly verdictSummary?: string;
  readonly requirement: string;
  readonly checks?: readonly VerificationCheck[];
}

export interface TaskBackedParentVisibleSubagentResult {
  readonly status: TaskBackedSubagentRunStatus;
  readonly summary?: string;
  readonly verificationVerdict?: VerificationVerdict;
  readonly observedWriteSet?: readonly string[];
  readonly observedWriteSetSource?: DelegationObservedWriteSetSource;
}

export interface TaskBackedSubagentScheduling {
  readonly parallelGroup?: string;
  readonly writeSet: readonly string[];
  readonly writeSetSource?: "explicit" | "inferred";
  readonly observedWriteSet?: readonly string[];
  readonly observedWriteSetSource?: DelegationObservedWriteSetSource;
  readonly undeclaredObservedWriteSet?: readonly string[];
  readonly observedConflictWith?: readonly string[];
  readonly canRunInParallel: boolean;
  readonly conflictsWith: readonly string[];
  readonly conflictReason?: string;
  readonly parallelBatch: number;
  readonly scheduleOrder: number;
  readonly readyToStart: boolean;
  readonly blockedBy: readonly string[];
}

export interface TaskBackedSubagentRun {
  readonly subagentId: string;
  readonly parentTurnId: string;
  readonly profileId: string;
  readonly workerId: string;
  readonly taskId?: string;
  readonly status: TaskBackedSubagentRunStatus;
  readonly role: DelegationSpecialization | "general";
  readonly targetAgent?: string;
  readonly isolatedContext: boolean;
  readonly instruction: string;
  readonly contextSnapshot?: string;
  readonly resultSummary?: string;
  readonly observedWriteSet?: readonly string[];
  readonly observedWriteSetSource?: DelegationObservedWriteSetSource;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly completedAtMs?: number;
  readonly error?: string;
  readonly verification?: TaskBackedSubagentVerification;
  readonly parentVisibleResult: TaskBackedParentVisibleSubagentResult;
  readonly scheduling?: TaskBackedSubagentScheduling;
}

export type TaskBackedSubagentSchedulerStoppedReason =
  | "ready"
  | "scheduler-blocked"
  | "mailbox-empty";

export interface TaskBackedSubagentSchedulerHeartbeat {
  readonly schemaId: "hotflow.agent-os.subagent-scheduler-heartbeat.v1";
  readonly parentTurnId?: string;
  readonly totalSubagentRuns: number;
  readonly queuedCount: number;
  readonly runningCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly cancelledCount: number;
  readonly schedulerTrackedCount: number;
  readonly readyCount: number;
  readonly blockedCount: number;
  readonly unscheduledQueuedCount: number;
  readonly nextReadySubagentIds: readonly string[];
  readonly blockedSubagentIds: readonly string[];
  readonly runningSubagentIds: readonly string[];
  readonly nextParallelBatch?: number;
  readonly canContinue: boolean;
  readonly stoppedReason: TaskBackedSubagentSchedulerStoppedReason;
  readonly heartbeatOrdinal: number;
  readonly latestUpdatedAtMs?: number;
}

export type TaskBackedSubagentSchedulerDispatchReason =
  | "ready"
  | "scheduler-blocked"
  | "mailbox-empty";

export interface TaskBackedSubagentSchedulerDispatchWriteSet {
  readonly subagentId: string;
  readonly writeSet: readonly string[];
  readonly writeSetSource?: "explicit" | "inferred";
}

export interface TaskBackedSubagentSchedulerDispatchBatch {
  readonly parallelBatch: number;
  readonly subagentIds: readonly string[];
  readonly workerIds: readonly string[];
  readonly writeSets: readonly TaskBackedSubagentSchedulerDispatchWriteSet[];
}

export interface TaskBackedSubagentSchedulerDispatchPlan {
  readonly schemaId: "hotflow.agent-os.subagent-scheduler-dispatch-plan.v1";
  readonly parentTurnId?: string;
  readonly planOrdinal: number;
  readonly heartbeatOrdinal: number;
  readonly canDispatch: boolean;
  readonly dispatchReason: TaskBackedSubagentSchedulerDispatchReason;
  readonly maxDispatchableCount: number;
  readonly dispatchableSubagentIds: readonly string[];
  readonly dispatchBatches: readonly TaskBackedSubagentSchedulerDispatchBatch[];
  readonly blockedSubagentIds: readonly string[];
  readonly runningSubagentIds: readonly string[];
}

export interface TaskBackedSubagentSchedulerTickIntent {
  readonly intentId: string;
  readonly delegationId: string;
  readonly workerId: string;
  readonly command: "run-delegation";
  readonly argv: readonly string[];
  readonly parallelBatch: number;
  readonly writeSet: readonly string[];
  readonly writeSetSource?: "explicit" | "inferred";
}

export interface TaskBackedSubagentSchedulerTick {
  readonly schemaId: "hotflow.agent-os.subagent-scheduler-tick.v1";
  readonly sessionId: string;
  readonly latestTurnId: string | null;
  readonly dispatchPlan: TaskBackedSubagentSchedulerDispatchPlan;
  readonly dispatchIntents: readonly TaskBackedSubagentSchedulerTickIntent[];
  readonly claimDryRun: true;
}

export type TaskBackedSubagentSchedulerRecoveryActionType =
  | "wait-for-running-subagent"
  | "review-observed-write-set";

export type TaskBackedSubagentSchedulerRecoverySeverity = "info" | "warning";

export interface TaskBackedSubagentSchedulerRecoveryEvidence {
  readonly blockedBy: readonly string[];
  readonly conflictsWith: readonly string[];
  readonly observedConflictWith?: readonly string[];
}

export interface TaskBackedSubagentSchedulerRecoveryAction {
  readonly actionId: string;
  readonly subagentId: string;
  readonly actionType: TaskBackedSubagentSchedulerRecoveryActionType;
  readonly severity: TaskBackedSubagentSchedulerRecoverySeverity;
  readonly reason: string;
  readonly relatedSubagentIds: readonly string[];
  readonly writeSet: readonly string[];
  readonly observedWriteSet?: readonly string[];
  readonly undeclaredObservedWriteSet?: readonly string[];
  readonly evidence: TaskBackedSubagentSchedulerRecoveryEvidence;
  readonly operatorSummary: string;
}

export type TaskBackedSubagentSchedulerRecoveryGroupType =
  | "write-set-overlap"
  | "observed-write-set-overlap";

export interface TaskBackedSubagentSchedulerRecoveryGroup {
  readonly groupId: string;
  readonly groupType: TaskBackedSubagentSchedulerRecoveryGroupType;
  readonly severity: TaskBackedSubagentSchedulerRecoverySeverity;
  readonly reason: string;
  readonly actionIds: readonly string[];
  readonly subagentIds: readonly string[];
  readonly runningSubagentIds: readonly string[];
  readonly blockedSubagentIds: readonly string[];
  readonly completedSubagentIds: readonly string[];
  readonly writeSet: readonly string[];
  readonly observedWriteSet?: readonly string[];
  readonly undeclaredObservedWriteSet?: readonly string[];
  readonly operatorSummary: string;
}

export interface TaskBackedSubagentSchedulerRecoveryPlan {
  readonly schemaId: "hotflow.agent-os.subagent-scheduler-recovery-plan.v1";
  readonly parentTurnId?: string;
  readonly canRecover: boolean;
  readonly blockedSubagentIds: readonly string[];
  readonly conflictedSubagentIds: readonly string[];
  readonly recoveryActions: readonly TaskBackedSubagentSchedulerRecoveryAction[];
  readonly recoveryGroups: readonly TaskBackedSubagentSchedulerRecoveryGroup[];
  readonly recoveryOrdinal: number;
}

export interface ProjectSubagentRunsOptions {
  readonly parentTurnId?: string;
}

export interface ProjectSubagentSchedulerTickOptions extends ProjectSubagentRunsOptions {
  readonly sessionId: string;
  readonly latestTurnId?: string | null;
}

export function projectSubagentRunsFromTaskState(
  state: TaskOperationsState,
  options: ProjectSubagentRunsOptions = {},
): readonly TaskBackedSubagentRun[] {
  const verificationById = new Map(state.verification.map((record) => [record.id, record]));
  const verificationByTaskId = new Map(
    state.verification.flatMap((record) =>
      record.taskId === undefined ? [] : [[record.taskId, record] as const],
    ),
  );

  const schedulingByDelegationId = createSubagentSchedulingByDelegationId(state.delegation);

  return state.delegation.map((record) => {
    const verification = resolveDelegationVerification(
      record,
      verificationById,
      verificationByTaskId,
    );
    const parentTurnId =
      options.parentTurnId ??
      extractContextField(record.contextSnapshot, "parentTurnId") ??
      "unknown";
    const profileId = record.targetAgent ?? record.specialization ?? record.workerId;
    const summary = record.resultSummary ?? record.error;
    const parentVisibleResult: TaskBackedParentVisibleSubagentResult = {
      status: record.status,
      ...(summary === undefined ? {} : { summary }),
      ...(verification?.verdict === undefined ? {} : { verificationVerdict: verification.verdict }),
      ...(record.observedWriteSet === undefined
        ? {}
        : { observedWriteSet: [...record.observedWriteSet] }),
      ...(record.observedWriteSetSource === undefined
        ? {}
        : { observedWriteSetSource: record.observedWriteSetSource }),
    };

    return {
      subagentId: record.id,
      parentTurnId,
      profileId,
      workerId: record.workerId,
      ...(record.taskId === undefined ? {} : { taskId: record.taskId }),
      status: record.status,
      role: record.specialization ?? "general",
      ...(record.targetAgent === undefined ? {} : { targetAgent: record.targetAgent }),
      isolatedContext: extractContextField(record.contextSnapshot, "isolatedContext") !== "false",
      instruction: record.instruction,
      ...(record.contextSnapshot === undefined ? {} : { contextSnapshot: record.contextSnapshot }),
      ...(record.resultSummary === undefined ? {} : { resultSummary: record.resultSummary }),
      ...(record.observedWriteSet === undefined
        ? {}
        : { observedWriteSet: [...record.observedWriteSet] }),
      ...(record.observedWriteSetSource === undefined
        ? {}
        : { observedWriteSetSource: record.observedWriteSetSource }),
      createdAtMs: record.createdAtMs,
      updatedAtMs: record.updatedAtMs,
      ...(record.completedAtMs === undefined ? {} : { completedAtMs: record.completedAtMs }),
      ...(record.error === undefined ? {} : { error: record.error }),
      ...(verification === undefined ? {} : { verification }),
      parentVisibleResult,
      ...optionalScheduling(schedulingByDelegationId.get(record.id)),
    };
  });
}

export function projectSubagentSchedulerHeartbeatFromTaskState(
  state: TaskOperationsState,
  options: ProjectSubagentRunsOptions = {},
): TaskBackedSubagentSchedulerHeartbeat {
  return projectSubagentSchedulerHeartbeatFromSubagentRuns(
    projectSubagentRunsFromTaskState(state, options),
    options,
  );
}

export function projectSubagentSchedulerDispatchPlanFromTaskState(
  state: TaskOperationsState,
  options: ProjectSubagentRunsOptions = {},
): TaskBackedSubagentSchedulerDispatchPlan {
  const runs = projectSubagentRunsFromTaskState(state, options);
  return projectSubagentSchedulerDispatchPlanFromSubagentRuns(runs, options);
}

export function projectSubagentSchedulerTickFromTaskState(
  state: TaskOperationsState,
  options: ProjectSubagentSchedulerTickOptions,
): TaskBackedSubagentSchedulerTick {
  return projectSubagentSchedulerTickFromSubagentRuns(
    projectSubagentRunsFromTaskState(state, options),
    options,
  );
}

export function projectSubagentSchedulerTickFromSubagentRuns(
  runs: readonly TaskBackedSubagentRun[],
  options: ProjectSubagentSchedulerTickOptions,
): TaskBackedSubagentSchedulerTick {
  const dispatchPlan = projectSubagentSchedulerDispatchPlanFromSubagentRuns(runs, options);
  return {
    schemaId: "hotflow.agent-os.subagent-scheduler-tick.v1",
    sessionId: options.sessionId,
    latestTurnId: options.latestTurnId ?? null,
    dispatchPlan,
    dispatchIntents: createSubagentSchedulerTickDispatchIntents(
      options.sessionId,
      dispatchPlan,
      runs,
    ),
    claimDryRun: true,
  };
}

export function projectSubagentSchedulerRecoveryPlanFromTaskState(
  state: TaskOperationsState,
  options: ProjectSubagentRunsOptions = {},
): TaskBackedSubagentSchedulerRecoveryPlan {
  return projectSubagentSchedulerRecoveryPlanFromSubagentRuns(
    projectSubagentRunsFromTaskState(state, options),
    options,
  );
}

export function projectSubagentSchedulerRecoveryPlanFromSubagentRuns(
  runs: readonly TaskBackedSubagentRun[],
  options: ProjectSubagentRunsOptions = {},
): TaskBackedSubagentSchedulerRecoveryPlan {
  const recoveryActions = createSubagentSchedulerRecoveryActions(runs);
  const recoveryGroups = createSubagentSchedulerRecoveryGroups(recoveryActions, runs);
  const blockedSubagentIds = uniqueStrings(
    runs
      .filter((run) => run.status === "queued" && (run.scheduling?.blockedBy.length ?? 0) > 0)
      .map((run) => run.subagentId),
  );
  const conflictedSubagentIds = uniqueStrings(recoveryActions.map((action) => action.subagentId));
  const latestUpdatedAtMs = resolveLatestUpdatedAtMs(runs);
  return {
    schemaId: "hotflow.agent-os.subagent-scheduler-recovery-plan.v1",
    ...(options.parentTurnId === undefined ? {} : { parentTurnId: options.parentTurnId }),
    canRecover: recoveryActions.length > 0,
    blockedSubagentIds,
    conflictedSubagentIds,
    recoveryActions,
    recoveryGroups,
    recoveryOrdinal: deriveSchedulerHeartbeatOrdinal(latestUpdatedAtMs),
  };
}

export function projectSubagentSchedulerDispatchPlanFromSubagentRuns(
  runs: readonly TaskBackedSubagentRun[],
  options: ProjectSubagentRunsOptions = {},
): TaskBackedSubagentSchedulerDispatchPlan {
  const heartbeat = projectSubagentSchedulerHeartbeatFromSubagentRuns(runs, options);
  const dispatchableRuns = runs
    .filter((run) => run.status === "queued" && run.scheduling?.readyToStart !== false)
    .sort(compareSubagentDispatchRuns);
  const dispatchBatches = createSubagentDispatchBatches(dispatchableRuns);

  return {
    schemaId: "hotflow.agent-os.subagent-scheduler-dispatch-plan.v1",
    ...(options.parentTurnId === undefined ? {} : { parentTurnId: options.parentTurnId }),
    planOrdinal: heartbeat.heartbeatOrdinal,
    heartbeatOrdinal: heartbeat.heartbeatOrdinal,
    canDispatch: dispatchableRuns.length > 0,
    dispatchReason: heartbeat.stoppedReason,
    maxDispatchableCount: dispatchableRuns.length,
    dispatchableSubagentIds: dispatchableRuns.map((run) => run.subagentId),
    dispatchBatches,
    blockedSubagentIds: [...heartbeat.blockedSubagentIds],
    runningSubagentIds: [...heartbeat.runningSubagentIds],
  };
}

export function projectSubagentSchedulerHeartbeatFromSubagentRuns(
  runs: readonly TaskBackedSubagentRun[],
  options: ProjectSubagentRunsOptions = {},
): TaskBackedSubagentSchedulerHeartbeat {
  const queuedRuns = runs.filter((run) => run.status === "queued");
  const runningRuns = runs.filter((run) => run.status === "running");
  const completedRuns = runs.filter((run) => run.status === "completed");
  const failedRuns = runs.filter((run) => run.status === "failed");
  const cancelledRuns = runs.filter((run) => run.status === "cancelled");
  const scheduledRuns = runs.filter((run) => run.scheduling !== undefined);
  const readyQueuedRuns = queuedRuns.filter((run) => run.scheduling?.readyToStart !== false);
  const blockedQueuedRuns = queuedRuns.filter((run) => run.scheduling?.readyToStart === false);
  const unscheduledQueuedRuns = queuedRuns.filter((run) => run.scheduling === undefined);
  const nextParallelBatch = resolveNextParallelBatch(readyQueuedRuns);
  const latestUpdatedAtMs = resolveLatestUpdatedAtMs(runs);
  const canContinue = readyQueuedRuns.length > 0;

  return {
    schemaId: "hotflow.agent-os.subagent-scheduler-heartbeat.v1",
    ...(options.parentTurnId === undefined ? {} : { parentTurnId: options.parentTurnId }),
    totalSubagentRuns: runs.length,
    queuedCount: queuedRuns.length,
    runningCount: runningRuns.length,
    completedCount: completedRuns.length,
    failedCount: failedRuns.length,
    cancelledCount: cancelledRuns.length,
    schedulerTrackedCount: scheduledRuns.length,
    readyCount: readyQueuedRuns.length,
    blockedCount: blockedQueuedRuns.length,
    unscheduledQueuedCount: unscheduledQueuedRuns.length,
    nextReadySubagentIds: readyQueuedRuns.map((run) => run.subagentId),
    blockedSubagentIds: blockedQueuedRuns.map((run) => run.subagentId),
    runningSubagentIds: runningRuns.map((run) => run.subagentId),
    ...(nextParallelBatch === undefined ? {} : { nextParallelBatch }),
    canContinue,
    stoppedReason: canContinue
      ? "ready"
      : blockedQueuedRuns.length > 0
        ? "scheduler-blocked"
        : "mailbox-empty",
    heartbeatOrdinal: deriveSchedulerHeartbeatOrdinal(latestUpdatedAtMs),
    ...(latestUpdatedAtMs === undefined ? {} : { latestUpdatedAtMs }),
  };
}

export function createSubagentSchedulingByDelegationId(
  delegations: readonly DelegationRecord[],
): ReadonlyMap<string, TaskBackedSubagentScheduling> {
  const writeSetByDelegationId = new Map(
    delegations.map((record) => [record.id, resolveSchedulingWriteSet(record.contextSnapshot)]),
  );
  const observedDiagnosticsByDelegationId = createObservedWriteSetDiagnosticsByDelegationId(
    delegations,
    writeSetByDelegationId,
  );
  const candidates = delegations
    .filter((record) => record.status === "queued" || record.status === "running")
    .map((record) => ({
      record,
      parallelGroup: extractContextField(record.contextSnapshot, "parallelGroup"),
      ...(writeSetByDelegationId.get(record.id) ?? { writeSet: [] }),
    }))
    .filter((entry) => entry.parallelGroup !== undefined || entry.writeSet.length > 0)
    .sort(compareSubagentSchedulingCandidates)
    .map((entry, scheduleOrder) => ({
      ...entry,
      scheduleOrder,
    }));
  const scheduling = new Map<string, TaskBackedSubagentScheduling>();
  const assigned: {
    readonly id: string;
    readonly writeSet: readonly string[];
    readonly batch: number;
  }[] = [];

  for (const candidate of candidates) {
    const conflicts = candidates
      .filter((entry) => entry.record.id !== candidate.record.id)
      .map((entry) => ({
        id: entry.record.id,
        overlap: intersect(candidate.writeSet, entry.writeSet),
      }))
      .filter((entry) => entry.overlap.length > 0);
    const blockedBy = assigned
      .filter((entry) => intersect(candidate.writeSet, entry.writeSet).length > 0)
      .map((entry) => entry.id);
    const blockedBatches = new Set(
      assigned
        .filter((entry) => intersect(candidate.writeSet, entry.writeSet).length > 0)
        .map((entry) => entry.batch),
    );
    const parallelBatch = selectFirstAvailableParallelBatch(blockedBatches);
    const observedDiagnostics = observedDiagnosticsByDelegationId.get(candidate.record.id);
    const conflictReason = resolveConflictReason({
      declaredConflicts: conflicts,
      observedDiagnostics,
    });
    scheduling.set(candidate.record.id, {
      ...(candidate.parallelGroup === undefined ? {} : { parallelGroup: candidate.parallelGroup }),
      writeSet: candidate.writeSet,
      ...(candidate.writeSetSource === undefined
        ? {}
        : { writeSetSource: candidate.writeSetSource }),
      ...optionalObservedSchedulingDiagnostics(observedDiagnostics),
      canRunInParallel: conflicts.length === 0,
      conflictsWith: conflicts.map((entry) => entry.id),
      ...(conflictReason === undefined ? {} : { conflictReason }),
      parallelBatch,
      scheduleOrder: candidate.scheduleOrder,
      readyToStart: parallelBatch === 0,
      blockedBy,
    });
    assigned.push({
      id: candidate.record.id,
      writeSet: candidate.writeSet,
      batch: parallelBatch,
    });
  }

  for (const [delegationId, diagnostics] of observedDiagnosticsByDelegationId) {
    if (scheduling.has(delegationId)) {
      continue;
    }
    const record = delegations.find((entry) => entry.id === delegationId);
    if (record === undefined) {
      continue;
    }
    const resolvedWriteSet = writeSetByDelegationId.get(delegationId) ?? { writeSet: [] };
    const parallelGroup = extractContextField(record.contextSnapshot, "parallelGroup");
    const conflictReason = resolveConflictReason({
      declaredConflicts: [],
      observedDiagnostics: diagnostics,
    });
    scheduling.set(delegationId, {
      ...(parallelGroup === undefined ? {} : { parallelGroup }),
      writeSet: resolvedWriteSet.writeSet,
      ...(resolvedWriteSet.writeSetSource === undefined
        ? {}
        : { writeSetSource: resolvedWriteSet.writeSetSource }),
      ...optionalObservedSchedulingDiagnostics(diagnostics),
      canRunInParallel: diagnostics.observedConflictWith.length === 0,
      conflictsWith: [],
      ...(conflictReason === undefined ? {} : { conflictReason }),
      parallelBatch: 0,
      scheduleOrder: -1,
      readyToStart: true,
      blockedBy: [],
    });
  }

  return scheduling;
}

function createObservedWriteSetDiagnosticsByDelegationId(
  delegations: readonly DelegationRecord[],
  writeSetByDelegationId: ReadonlyMap<
    string,
    {
      readonly writeSet: readonly string[];
      readonly writeSetSource?: "explicit" | "inferred";
    }
  >,
): ReadonlyMap<
  string,
  {
    readonly observedWriteSet: readonly string[];
    readonly observedWriteSetSource?: DelegationObservedWriteSetSource;
    readonly undeclaredObservedWriteSet: readonly string[];
    readonly observedConflictWith: readonly string[];
    readonly observedConflictPaths: readonly string[];
  }
> {
  const observedRecords = delegations
    .filter((record) => record.observedWriteSet !== undefined && record.observedWriteSet.length > 0)
    .map((record) => ({
      record,
      observedWriteSet: record.observedWriteSet ?? [],
      declaredWriteSet: writeSetByDelegationId.get(record.id)?.writeSet ?? [],
    }));
  const activeConflictRecords = delegations.filter(
    (record) => record.status === "queued" || record.status === "running",
  );
  const diagnostics = new Map<
    string,
    {
      readonly observedWriteSet: readonly string[];
      readonly observedWriteSetSource?: DelegationObservedWriteSetSource;
      readonly undeclaredObservedWriteSet: readonly string[];
      readonly observedConflictWith: readonly string[];
      readonly observedConflictPaths: readonly string[];
    }
  >();

  for (const record of delegations.filter((entry) => entry.status !== "cancelled")) {
    const declaredWriteSet = writeSetByDelegationId.get(record.id)?.writeSet ?? [];
    const ownObservedWriteSet = record.observedWriteSet ?? [];
    const relevantObservedRecords = observedRecords.filter(
      (entry) =>
        entry.record.id === record.id ||
        intersect(entry.observedWriteSet, declaredWriteSet).length > 0,
    );
    if (ownObservedWriteSet.length === 0 && relevantObservedRecords.length === 0) {
      continue;
    }

    const observedConflicts = relevantObservedRecords
      .filter((entry) => entry.record.id !== record.id)
      .map((entry) => ({
        id: entry.record.id,
        overlap: intersect(entry.observedWriteSet, declaredWriteSet),
      }))
      .filter((entry) => entry.overlap.length > 0);
    const ownDeclaredWriteSet = writeSetByDelegationId.get(record.id)?.writeSet ?? [];
    const undeclaredObservedWriteSet = uniqueStrings(
      ownObservedWriteSet.filter((entry) => !ownDeclaredWriteSet.includes(entry)),
    );
    const ownObservedConflicts = activeConflictRecords
      .filter((entry) => entry.id !== record.id)
      .map((entry) => ({
        id: entry.id,
        overlap: intersect(
          ownObservedWriteSet,
          writeSetByDelegationId.get(entry.id)?.writeSet ?? [],
        ),
      }))
      .filter((entry) => entry.overlap.length > 0);
    const observedConflictWith = uniqueStrings([
      ...observedConflicts.map((entry) => entry.id),
      ...ownObservedConflicts.map((entry) => entry.id),
    ]);
    const observedConflictPaths = uniqueStrings([
      ...observedConflicts.flatMap((entry) => entry.overlap),
      ...ownObservedConflicts.flatMap((entry) => entry.overlap),
    ]);

    diagnostics.set(record.id, {
      observedWriteSet: ownObservedWriteSet,
      ...(record.observedWriteSetSource === undefined
        ? {}
        : { observedWriteSetSource: record.observedWriteSetSource }),
      undeclaredObservedWriteSet,
      observedConflictWith,
      observedConflictPaths,
    });
  }

  return diagnostics;
}

function optionalObservedSchedulingDiagnostics(
  diagnostics:
    | {
        readonly observedWriteSet: readonly string[];
        readonly observedWriteSetSource?: DelegationObservedWriteSetSource;
        readonly undeclaredObservedWriteSet: readonly string[];
        readonly observedConflictWith: readonly string[];
      }
    | undefined,
): Partial<TaskBackedSubagentScheduling> {
  if (diagnostics === undefined) {
    return {};
  }
  return {
    ...(diagnostics.observedWriteSet.length === 0
      ? {}
      : { observedWriteSet: diagnostics.observedWriteSet }),
    ...(diagnostics.observedWriteSetSource === undefined
      ? {}
      : { observedWriteSetSource: diagnostics.observedWriteSetSource }),
    ...(diagnostics.undeclaredObservedWriteSet.length === 0
      ? {}
      : { undeclaredObservedWriteSet: diagnostics.undeclaredObservedWriteSet }),
    ...(diagnostics.observedConflictWith.length === 0
      ? {}
      : { observedConflictWith: diagnostics.observedConflictWith }),
  };
}

function resolveConflictReason(input: {
  readonly declaredConflicts: readonly {
    readonly overlap: readonly string[];
  }[];
  readonly observedDiagnostics:
    | {
        readonly observedConflictPaths: readonly string[];
      }
    | undefined;
}): string | undefined {
  if (
    input.observedDiagnostics !== undefined &&
    input.observedDiagnostics.observedConflictPaths.length > 0
  ) {
    return `observed-write-set-overlap: ${input.observedDiagnostics.observedConflictPaths.join(", ")}`;
  }
  if (input.declaredConflicts.length > 0) {
    return `write-set-overlap: ${uniqueStrings(input.declaredConflicts.flatMap((entry) => entry.overlap)).join(", ")}`;
  }
  return undefined;
}

function resolveSchedulingWriteSet(snapshot: string | undefined): {
  readonly writeSet: readonly string[];
  readonly writeSetSource?: "explicit" | "inferred";
} {
  const explicitWriteSet = normalizeWriteSet(extractContextField(snapshot, "writeSet"));
  if (explicitWriteSet.length > 0) {
    return {
      writeSet: explicitWriteSet,
      writeSetSource: "explicit",
    };
  }
  const inferredWriteSet = normalizeWriteSet(extractContextField(snapshot, "writableRoots"));
  if (inferredWriteSet.length > 0) {
    return {
      writeSet: inferredWriteSet,
      writeSetSource: "inferred",
    };
  }
  return { writeSet: [] };
}

function compareSubagentSchedulingCandidates(
  left: {
    readonly record: DelegationRecord;
    readonly parallelGroup: string | undefined;
    readonly writeSet: readonly string[];
  },
  right: {
    readonly record: DelegationRecord;
    readonly parallelGroup: string | undefined;
    readonly writeSet: readonly string[];
  },
): number {
  const leftRunningRank = left.record.status === "running" ? 0 : 1;
  const rightRunningRank = right.record.status === "running" ? 0 : 1;
  if (leftRunningRank !== rightRunningRank) {
    return leftRunningRank - rightRunningRank;
  }
  if (left.record.createdAtMs !== right.record.createdAtMs) {
    return left.record.createdAtMs - right.record.createdAtMs;
  }
  return left.record.id.localeCompare(right.record.id);
}

function compareSubagentDispatchRuns(
  left: TaskBackedSubagentRun,
  right: TaskBackedSubagentRun,
): number {
  const leftBatch = left.scheduling?.parallelBatch ?? 0;
  const rightBatch = right.scheduling?.parallelBatch ?? 0;
  if (leftBatch !== rightBatch) {
    return leftBatch - rightBatch;
  }

  const leftOrder = left.scheduling?.scheduleOrder ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.scheduling?.scheduleOrder ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  if (left.createdAtMs !== right.createdAtMs) {
    return left.createdAtMs - right.createdAtMs;
  }

  return left.subagentId.localeCompare(right.subagentId);
}

function createSubagentDispatchBatches(
  runs: readonly TaskBackedSubagentRun[],
): readonly TaskBackedSubagentSchedulerDispatchBatch[] {
  const batchIds = uniqueNumbers(runs.map((run) => run.scheduling?.parallelBatch ?? 0));
  return batchIds.map((parallelBatch) => {
    const batchRuns = runs.filter((run) => (run.scheduling?.parallelBatch ?? 0) === parallelBatch);
    return {
      parallelBatch,
      subagentIds: batchRuns.map((run) => run.subagentId),
      workerIds: uniqueStrings(batchRuns.map((run) => run.workerId)),
      writeSets: batchRuns.map((run) => ({
        subagentId: run.subagentId,
        writeSet: run.scheduling?.writeSet ?? [],
        ...(run.scheduling?.writeSetSource === undefined
          ? {}
          : { writeSetSource: run.scheduling.writeSetSource }),
      })),
    };
  });
}

function createSubagentSchedulerTickDispatchIntents(
  sessionId: string,
  dispatchPlan: TaskBackedSubagentSchedulerDispatchPlan,
  runs: readonly TaskBackedSubagentRun[],
): readonly TaskBackedSubagentSchedulerTickIntent[] {
  return dispatchPlan.dispatchBatches.flatMap((batch) =>
    batch.subagentIds.map((subagentId) => {
      const run = runs.find((entry) => entry.subagentId === subagentId);
      const writeSet = batch.writeSets.find((entry) => entry.subagentId === subagentId);
      const workerId = run?.workerId ?? "unknown-worker";
      return {
        intentId: `dispatch_${subagentId}`,
        delegationId: subagentId,
        workerId,
        command: "run-delegation",
        argv: [
          "run-delegation",
          "--session-id",
          sessionId,
          "--worker-id",
          workerId,
          "--delegation-id",
          subagentId,
        ],
        parallelBatch: batch.parallelBatch,
        writeSet: writeSet?.writeSet ?? run?.scheduling?.writeSet ?? [],
        ...optionalWriteSetSource(writeSet?.writeSetSource ?? run?.scheduling?.writeSetSource),
      };
    }),
  );
}

function createSubagentSchedulerRecoveryActions(
  runs: readonly TaskBackedSubagentRun[],
): readonly TaskBackedSubagentSchedulerRecoveryAction[] {
  return runs.flatMap((run) => {
    const scheduling = run.scheduling;
    if (scheduling === undefined) {
      return [];
    }

    const actions: TaskBackedSubagentSchedulerRecoveryAction[] = [];
    if (scheduling.conflictReason?.startsWith("write-set-overlap:")) {
      actions.push({
        actionId: `recover_${run.subagentId}_write_set_overlap`,
        subagentId: run.subagentId,
        actionType: "wait-for-running-subagent",
        severity: "info",
        reason: scheduling.conflictReason,
        relatedSubagentIds: scheduling.conflictsWith,
        writeSet: scheduling.writeSet,
        evidence: {
          blockedBy: scheduling.blockedBy,
          conflictsWith: scheduling.conflictsWith,
        },
        operatorSummary:
          scheduling.blockedBy.length > 0
            ? `Wait for running subagent ${scheduling.blockedBy[0]} before unblocking ${run.subagentId}.`
            : `Wait for running subagent ${run.subagentId} before unblocking conflicting queued work.`,
      });
    }

    if (scheduling.conflictReason?.startsWith("observed-write-set-overlap:")) {
      actions.push({
        actionId: `recover_${run.subagentId}_observed_write_set_overlap`,
        subagentId: run.subagentId,
        actionType: "review-observed-write-set",
        severity: "warning",
        reason: scheduling.conflictReason,
        relatedSubagentIds: scheduling.observedConflictWith ?? [],
        writeSet: scheduling.writeSet,
        ...(scheduling.observedWriteSet === undefined
          ? {}
          : { observedWriteSet: scheduling.observedWriteSet }),
        ...(scheduling.undeclaredObservedWriteSet === undefined
          ? {}
          : { undeclaredObservedWriteSet: scheduling.undeclaredObservedWriteSet }),
        evidence: {
          blockedBy: scheduling.blockedBy,
          conflictsWith: scheduling.conflictsWith,
          ...(scheduling.observedConflictWith === undefined
            ? {}
            : { observedConflictWith: scheduling.observedConflictWith }),
        },
        operatorSummary: `Review observed write-set drift for ${run.subagentId} before dispatching related subagents.`,
      });
    }

    return actions;
  });
}

function createSubagentSchedulerRecoveryGroups(
  actions: readonly TaskBackedSubagentSchedulerRecoveryAction[],
  runs: readonly TaskBackedSubagentRun[],
): readonly TaskBackedSubagentSchedulerRecoveryGroup[] {
  const runsById = new Map(runs.map((run) => [run.subagentId, run]));
  const groups = new Map<
    string,
    {
      readonly groupType: TaskBackedSubagentSchedulerRecoveryGroupType;
      readonly severity: TaskBackedSubagentSchedulerRecoverySeverity;
      readonly reason: string;
      readonly writeSet: readonly string[];
      readonly actions: TaskBackedSubagentSchedulerRecoveryAction[];
    }
  >();

  for (const action of actions) {
    const groupType = resolveRecoveryGroupType(action.reason);
    if (groupType === undefined) {
      continue;
    }
    const writeSet = resolveRecoveryGroupWriteSet(action);
    const key = `${groupType}:${action.reason}:${writeSet.join("|")}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        groupType,
        severity: action.severity,
        reason: action.reason,
        writeSet,
        actions: [action],
      });
    } else {
      existing.actions.push(action);
    }
  }

  return [...groups.values()].map((group) => {
    const subagentIds = uniqueStrings(
      group.actions.flatMap((action) => [action.subagentId, ...action.relatedSubagentIds]),
    );
    const runningSubagentIds = subagentIds.filter((subagentId) => {
      const run = runsById.get(subagentId);
      return run?.status === "running";
    });
    const blockedSubagentIds = subagentIds.filter((subagentId) => {
      const run = runsById.get(subagentId);
      return run?.status === "queued" && (run.scheduling?.blockedBy.length ?? 0) > 0;
    });
    const completedSubagentIds = subagentIds.filter((subagentId) => {
      const run = runsById.get(subagentId);
      return run?.status === "completed";
    });
    const observedWriteSet = uniqueStrings(
      group.actions.flatMap((action) => action.observedWriteSet ?? []),
    );
    const undeclaredObservedWriteSet = uniqueStrings(
      group.actions.flatMap((action) => action.undeclaredObservedWriteSet ?? []),
    );
    const operatorSummary = formatRecoveryGroupOperatorSummary(
      group.groupType,
      group.writeSet,
      runningSubagentIds.length,
      blockedSubagentIds.length,
      completedSubagentIds.length,
    );
    return {
      groupId: `recovery_group_${group.groupType.replaceAll("-", "_")}_${slugifyRecoveryGroupWriteSet(group.writeSet)}`,
      groupType: group.groupType,
      severity: group.severity,
      reason: group.reason,
      actionIds: group.actions.map((action) => action.actionId),
      subagentIds,
      runningSubagentIds,
      blockedSubagentIds,
      completedSubagentIds,
      writeSet: group.writeSet,
      ...(observedWriteSet.length === 0 ? {} : { observedWriteSet }),
      ...(undeclaredObservedWriteSet.length === 0 ? {} : { undeclaredObservedWriteSet }),
      operatorSummary,
    };
  });
}

function formatRecoveryGroupOperatorSummary(
  groupType: TaskBackedSubagentSchedulerRecoveryGroupType,
  writeSet: readonly string[],
  runningCount: number,
  blockedCount: number,
  completedCount: number,
): string {
  const targetWriteSet = writeSet.join(", ") || "unknown";
  if (groupType === "observed-write-set-overlap") {
    return `Review observed-write-set-overlap recovery group for ${targetWriteSet}: ${runningCount} running, ${blockedCount} blocked, ${completedCount} completed.`;
  }
  return `Review write-set-overlap recovery group for ${targetWriteSet}: ${runningCount} running, ${blockedCount} blocked, ${completedCount} completed.`;
}

function resolveRecoveryGroupType(
  reason: string,
): TaskBackedSubagentSchedulerRecoveryGroupType | undefined {
  if (reason.startsWith("write-set-overlap:")) {
    return "write-set-overlap";
  }
  if (reason.startsWith("observed-write-set-overlap:")) {
    return "observed-write-set-overlap";
  }
  return undefined;
}

function resolveRecoveryGroupWriteSet(
  action: TaskBackedSubagentSchedulerRecoveryAction,
): readonly string[] {
  const reasonWriteSet = normalizeWriteSet(action.reason.split(":").slice(1).join(":"));
  if (reasonWriteSet.length > 0) {
    return reasonWriteSet;
  }
  return action.writeSet;
}

function slugifyRecoveryGroupWriteSet(writeSet: readonly string[]): string {
  const normalized = writeSet
    .join("_")
    .replaceAll(/[^a-zA-Z0-9]+/gu, "_")
    .replaceAll(/^_+|_+$/gu, "")
    .toLowerCase();
  return normalized.length === 0 ? "unknown" : normalized;
}

function optionalWriteSetSource(
  writeSetSource: "explicit" | "inferred" | undefined,
): { readonly writeSetSource: "explicit" | "inferred" } | Record<string, never> {
  return writeSetSource === undefined ? {} : { writeSetSource };
}

function selectFirstAvailableParallelBatch(blockedBatches: ReadonlySet<number>): number {
  let batch = 0;
  while (blockedBatches.has(batch)) {
    batch += 1;
  }
  return batch;
}

function resolveNextParallelBatch(runs: readonly TaskBackedSubagentRun[]): number | undefined {
  const batches = runs
    .map((run) => run.scheduling?.parallelBatch)
    .filter((batch): batch is number => batch !== undefined);
  if (batches.length === 0) {
    return undefined;
  }
  return Math.min(...batches);
}

function resolveLatestUpdatedAtMs(runs: readonly TaskBackedSubagentRun[]): number | undefined {
  const timestamps = runs.map((run) => run.updatedAtMs).filter((value) => Number.isFinite(value));
  if (timestamps.length === 0) {
    return undefined;
  }
  return Math.max(...timestamps);
}

function deriveSchedulerHeartbeatOrdinal(latestUpdatedAtMs: number | undefined): number {
  return latestUpdatedAtMs ?? 0;
}

function resolveDelegationVerification(
  record: DelegationRecord,
  verificationById: ReadonlyMap<string, VerificationGateRecord>,
  verificationByTaskId: ReadonlyMap<string, VerificationGateRecord>,
): TaskBackedSubagentVerification | undefined {
  const verification =
    (record.verificationRequest?.verificationId === undefined
      ? undefined
      : verificationById.get(record.verificationRequest.verificationId)) ??
    (record.taskId === undefined ? undefined : verificationByTaskId.get(record.taskId));

  if (verification === undefined) {
    return undefined;
  }

  return {
    verificationId: verification.id,
    verifierId: verification.verifierId,
    status: verification.status,
    ...(verification.verdict === undefined ? {} : { verdict: verification.verdict }),
    ...(verification.verdictSummary === undefined
      ? {}
      : { verdictSummary: verification.verdictSummary }),
    requirement: verification.requirement,
    ...(verification.checks === undefined ? {} : { checks: verification.checks }),
  };
}

function extractContextField(snapshot: string | undefined, key: string): string | undefined {
  if (snapshot === undefined) {
    return undefined;
  }

  for (const part of snapshot.split(";")) {
    const [rawKey, ...rawValue] = part.split("=");
    if (rawKey?.trim() === key) {
      const value = rawValue.join("=").trim();
      return value.length === 0 ? undefined : value;
    }
  }

  return undefined;
}

function normalizeWriteSet(value: string | undefined): readonly string[] {
  if (value === undefined) {
    return [];
  }
  return uniqueStrings(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

function intersect(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightSet = new Set(right);
  return left.filter((entry) => rightSet.has(entry));
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function uniqueNumbers(values: readonly number[]): readonly number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function optionalScheduling(
  scheduling: TaskBackedSubagentScheduling | undefined,
): { readonly scheduling: TaskBackedSubagentScheduling } | Record<string, never> {
  return scheduling === undefined ? {} : { scheduling };
}
