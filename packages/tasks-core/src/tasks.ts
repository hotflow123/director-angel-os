import type {
  DelegationRecord,
  TaskItem,
  TaskLifecycleRecord,
  TaskLifecycleStatus,
  TaskOperationsState,
  VerificationGateRecord,
} from "@hotflow/contracts";

const TASK_LIFECYCLE_STATUS_ORDER: readonly TaskLifecycleStatus[] = [
  "pending",
  "delegated",
  "running",
  "blocked",
  "done",
  "failed",
  "verified",
];

export interface TaskLifecycleSummary {
  readonly total: number;
  readonly byStatus: Readonly<Record<TaskLifecycleStatus, number>>;
}

export function deriveTaskLifecycle(
  state: Pick<TaskOperationsState, "todos" | "delegation" | "verification">,
): readonly TaskLifecycleRecord[] {
  const taskIds = collectTaskIds(state);

  return taskIds.map((taskId) => {
    const todo = state.todos.items.find((item) => item.id === taskId);
    const latestDelegation = findLatestRecord(
      state.delegation.filter((entry) => entry.taskId === taskId),
    );
    const latestVerification = findLatestRecord(
      state.verification.filter((entry) => entry.taskId === taskId),
    );
    const verificationOwnsStatus =
      latestVerification !== undefined &&
      latestVerification.status !== "pending" &&
      (latestDelegation === undefined ||
        compareRecordRecency(latestVerification, latestDelegation) >= 0);

    return {
      taskId,
      title: deriveTaskTitle(taskId, todo, latestDelegation, latestVerification),
      status: deriveTaskLifecycleStatus({
        todo,
        latestDelegation,
        latestVerification,
        verificationOwnsStatus,
      }),
      ...(todo === undefined ? {} : { todoStatus: todo.status }),
      ...(latestDelegation === undefined
        ? {}
        : {
            assignedAgent: resolveDelegationAssignedAgent(latestDelegation),
            latestDelegationId: latestDelegation.id,
          }),
      ...(latestVerification === undefined
        ? {}
        : {
            latestVerificationId: latestVerification.id,
          }),
      ...(latestVerification?.verdict === undefined
        ? {}
        : {
            verificationVerdict: latestVerification.verdict,
          }),
    };
  });
}

export function summarizeTaskLifecycle(
  lifecycle: readonly TaskLifecycleRecord[],
): TaskLifecycleSummary {
  const byStatus = TASK_LIFECYCLE_STATUS_ORDER.reduce<Record<TaskLifecycleStatus, number>>(
    (counts, status) => {
      counts[status] = 0;
      return counts;
    },
    {
      pending: 0,
      delegated: 0,
      running: 0,
      blocked: 0,
      done: 0,
      failed: 0,
      verified: 0,
    },
  );

  for (const entry of lifecycle) {
    byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;
  }

  return {
    total: lifecycle.length,
    byStatus,
  };
}

function collectTaskIds(
  state: Pick<TaskOperationsState, "todos" | "delegation" | "verification">,
): string[] {
  const orderedTaskIds: string[] = [];
  const seen = new Set<string>();

  const addTaskId = (taskId: string | undefined) => {
    if (!taskId || seen.has(taskId)) {
      return;
    }
    seen.add(taskId);
    orderedTaskIds.push(taskId);
  };

  for (const item of state.todos.items) {
    addTaskId(item.id);
  }
  for (const entry of state.delegation) {
    addTaskId(entry.taskId);
  }
  for (const entry of state.verification) {
    addTaskId(entry.taskId);
  }

  return orderedTaskIds;
}

function findLatestRecord<
  TRecord extends {
    readonly id: string;
    readonly createdAtMs: number;
    readonly updatedAtMs: number;
  },
>(records: readonly TRecord[]): TRecord | undefined {
  return records.reduce<TRecord | undefined>((latest, record) => {
    if (!latest) {
      return record;
    }
    return compareRecordRecency(record, latest) > 0 ? record : latest;
  }, undefined);
}

function compareRecordRecency(
  left: { readonly id: string; readonly createdAtMs: number; readonly updatedAtMs: number },
  right: { readonly id: string; readonly createdAtMs: number; readonly updatedAtMs: number },
): number {
  if (left.updatedAtMs !== right.updatedAtMs) {
    return left.updatedAtMs - right.updatedAtMs;
  }
  if (left.createdAtMs !== right.createdAtMs) {
    return left.createdAtMs - right.createdAtMs;
  }
  return left.id.localeCompare(right.id);
}

function resolveDelegationAssignedAgent(delegation: DelegationRecord): string {
  return delegation.targetAgent ?? delegation.specialization ?? delegation.workerId;
}

function deriveTaskTitle(
  taskId: string,
  todo: TaskItem | undefined,
  latestDelegation: DelegationRecord | undefined,
  latestVerification: VerificationGateRecord | undefined,
): string {
  const todoTitle = todo?.content.trim();
  if (todoTitle) {
    return todoTitle;
  }

  const delegationTitle = latestDelegation?.instruction.trim();
  if (delegationTitle) {
    return delegationTitle;
  }

  const verificationTitle = latestVerification?.requirement.trim();
  if (verificationTitle) {
    return verificationTitle;
  }

  return taskId;
}

function deriveTaskLifecycleStatus(input: {
  readonly todo: TaskItem | undefined;
  readonly latestDelegation: DelegationRecord | undefined;
  readonly latestVerification: VerificationGateRecord | undefined;
  readonly verificationOwnsStatus: boolean;
}): TaskLifecycleStatus {
  if (input.verificationOwnsStatus && input.latestVerification) {
    return mapVerificationStatus(input.latestVerification.status);
  }

  if (input.latestDelegation) {
    return mapDelegationStatus(input.latestDelegation.status);
  }

  return mapTodoStatus(input.todo?.status);
}

function mapVerificationStatus(status: VerificationGateRecord["status"]): TaskLifecycleStatus {
  if (status === "passed") {
    return "verified";
  }
  if (status === "partial") {
    return "blocked";
  }
  return "failed";
}

function mapDelegationStatus(status: DelegationRecord["status"]): TaskLifecycleStatus {
  if (status === "queued") {
    return "delegated";
  }
  if (status === "running") {
    return "running";
  }
  if (status === "completed") {
    return "done";
  }
  return "failed";
}

function mapTodoStatus(status: TaskItem["status"] | undefined): TaskLifecycleStatus {
  if (status === "doing") {
    return "running";
  }
  if (status === "done") {
    return "done";
  }
  return "pending";
}
