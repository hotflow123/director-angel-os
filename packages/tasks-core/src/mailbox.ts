import { projectSubagentRunsFromTaskState } from "./subagent-runtime.js";
import type {
  DelegationRecord,
  DelegationSpecialization,
  DelegationStatus,
  DelegationVerificationRequest,
  ProposalRecord,
  ProposalStatus,
  TaskNotificationRecipientKind,
  TaskNotificationRecord,
  TaskNotificationStatus,
  TaskOperationsState,
  VerificationCheck,
  VerificationGateRecord,
  VerificationStatus,
} from "./task-operations.js";

export interface DelegationMailboxQuery {
  readonly workerId?: string;
  readonly statuses?: readonly DelegationStatus[];
  readonly limit?: number;
}

export interface DelegationClaimInput {
  readonly id: string;
  readonly workerId?: string;
  readonly respectScheduler?: boolean;
}

export interface VerificationMailboxQuery {
  readonly verifierId?: string;
  readonly statuses?: readonly VerificationStatus[];
  readonly limit?: number;
}

export interface ProposalMailboxQuery {
  readonly statuses?: readonly ProposalStatus[];
  readonly limit?: number;
}

export interface NotificationMailboxQuery {
  readonly recipientKind?: TaskNotificationRecipientKind;
  readonly recipientId?: string;
  readonly statuses?: readonly TaskNotificationStatus[];
  readonly limit?: number;
}

export interface WorkerMailboxQuery {
  readonly workerId?: string;
}

export interface VerifierMailboxQuery {
  readonly verifierId?: string;
}

export type WorkerMailboxCoverage =
  | "aligned"
  | "missing-notifications"
  | "orphan-notifications"
  | "mixed";

export type VerifierMailboxCoverage = WorkerMailboxCoverage;

export interface WorkerMailboxItem {
  readonly id: string;
  readonly workerId: string;
  readonly instruction: string;
  readonly status: DelegationStatus;
  readonly taskId?: string;
  readonly specialization?: DelegationSpecialization;
  readonly targetAgent?: string;
  readonly verificationRequest?: DelegationVerificationRequest;
  readonly notificationId?: string;
  readonly notificationStatus?: TaskNotificationStatus;
  readonly notificationSummary?: string;
}

export interface WorkerMailboxSnapshot {
  readonly workerId?: string;
  readonly mailboxSize: number;
  readonly notificationCount: number;
  readonly coverage: WorkerMailboxCoverage;
  readonly delegationIds: readonly string[];
  readonly notificationIds: readonly string[];
  readonly unnotifiedDelegationIds: readonly string[];
  readonly orphanNotificationIds: readonly string[];
  readonly items: readonly WorkerMailboxItem[];
  readonly notifications: readonly TaskNotificationRecord[];
}

export interface VerifierMailboxItem {
  readonly id: string;
  readonly verifierId: string;
  readonly requirement: string;
  readonly status: VerificationStatus;
  readonly taskId?: string;
  readonly notificationId?: string;
  readonly notificationStatus?: TaskNotificationStatus;
  readonly notificationSummary?: string;
}

export interface VerifierMailboxSnapshot {
  readonly verifierId?: string;
  readonly mailboxSize: number;
  readonly notificationCount: number;
  readonly coverage: VerifierMailboxCoverage;
  readonly verificationIds: readonly string[];
  readonly notificationIds: readonly string[];
  readonly unnotifiedVerificationIds: readonly string[];
  readonly orphanNotificationIds: readonly string[];
  readonly items: readonly VerifierMailboxItem[];
  readonly notifications: readonly TaskNotificationRecord[];
}

const DEFAULT_MAILBOX_STATUSES: readonly DelegationStatus[] = ["queued"];
const DEFAULT_VERIFICATION_STATUSES: readonly VerificationStatus[] = ["pending"];
const DEFAULT_PROPOSAL_STATUSES: readonly ProposalStatus[] = ["pending"];
const DEFAULT_NOTIFICATION_STATUSES: readonly TaskNotificationStatus[] = ["pending"];

export function listDelegationMailbox(
  state: TaskOperationsState,
  query: DelegationMailboxQuery = {},
): readonly DelegationRecord[] {
  const statuses = new Set(query.statuses ?? DEFAULT_MAILBOX_STATUSES);
  const limit = query.limit ?? Number.POSITIVE_INFINITY;

  if (limit <= 0) {
    return [];
  }

  return state.delegation
    .filter((record) => {
      if (query.workerId !== undefined && record.workerId !== query.workerId) {
        return false;
      }
      return statuses.has(record.status);
    })
    .sort(compareDelegationMailboxOrder)
    .slice(0, limit)
    .map((record) => cloneDelegationRecord(record));
}

export function selectDelegationForClaim(
  state: TaskOperationsState,
  input: DelegationClaimInput,
): DelegationRecord {
  const record = state.delegation.find((entry) => entry.id === input.id);
  if (!record) {
    throw new Error(`Unknown delegation record: ${input.id}`);
  }

  if (input.workerId !== undefined && record.workerId !== input.workerId) {
    throw new Error(
      `Delegation ${input.id} belongs to worker ${record.workerId}, not ${input.workerId}.`,
    );
  }

  if (record.status !== "queued") {
    throw new Error(`Delegation ${input.id} is not claimable from status ${record.status}.`);
  }

  if (input.respectScheduler === true) {
    const subagentRun = projectSubagentRunsFromTaskState(state).find(
      (run) => run.subagentId === input.id,
    );
    const scheduling = subagentRun?.scheduling;
    if (scheduling?.readyToStart === false) {
      const blockedBy =
        scheduling.blockedBy.length > 0 ? ` blockedBy=${scheduling.blockedBy.join(",")}` : "";
      throw new Error(
        `Delegation ${input.id} is blocked by subagent scheduler: parallelBatch=${scheduling.parallelBatch}${blockedBy}`,
      );
    }
  }

  return cloneDelegationRecord(record);
}

export function listVerificationMailbox(
  state: TaskOperationsState,
  query: VerificationMailboxQuery = {},
): readonly VerificationGateRecord[] {
  const statuses = new Set(query.statuses ?? DEFAULT_VERIFICATION_STATUSES);
  const limit = query.limit ?? Number.POSITIVE_INFINITY;

  if (limit <= 0) {
    return [];
  }

  return state.verification
    .filter((record) => {
      if (query.verifierId !== undefined && record.verifierId !== query.verifierId) {
        return false;
      }
      return statuses.has(record.status);
    })
    .sort(compareVerificationMailboxOrder)
    .slice(0, limit)
    .map((record) => cloneVerificationGateRecord(record));
}

export function listProposalMailbox(
  state: TaskOperationsState,
  query: ProposalMailboxQuery = {},
): readonly ProposalRecord[] {
  const statuses = new Set(query.statuses ?? DEFAULT_PROPOSAL_STATUSES);
  const limit = query.limit ?? Number.POSITIVE_INFINITY;

  if (limit <= 0) {
    return [];
  }

  return state.proposalQueue
    .filter((record) => statuses.has(record.status))
    .sort(compareProposalMailboxOrder)
    .slice(0, limit)
    .map((record) => cloneProposalRecord(record));
}

export function listNotificationMailbox(
  state: TaskOperationsState,
  query: NotificationMailboxQuery = {},
): readonly TaskNotificationRecord[] {
  const statuses = new Set(query.statuses ?? DEFAULT_NOTIFICATION_STATUSES);
  const limit = query.limit ?? Number.POSITIVE_INFINITY;

  if (limit <= 0) {
    return [];
  }

  return (state.notifications ?? [])
    .filter((record) => {
      if (query.recipientKind !== undefined && record.recipientKind !== query.recipientKind) {
        return false;
      }
      if (query.recipientId !== undefined && record.recipientId !== query.recipientId) {
        return false;
      }
      return statuses.has(record.status);
    })
    .sort(compareNotificationMailboxOrder)
    .slice(0, limit)
    .map((record) => cloneTaskNotificationRecord(record));
}

export function readWorkerMailbox(
  state: TaskOperationsState,
  query: WorkerMailboxQuery = {},
): WorkerMailboxSnapshot {
  const delegation = listDelegationMailbox(state, {
    ...(query.workerId === undefined ? {} : { workerId: query.workerId }),
    statuses: ["queued"],
  });
  const notifications = listNotificationMailbox(state, {
    recipientKind: "worker",
    ...(query.workerId === undefined ? {} : { recipientId: query.workerId }),
    statuses: ["pending"],
  });
  const mailboxDelegationIds = new Set(delegation.map((record) => record.id));
  const notificationsByDelegationId = new Map<string, TaskNotificationRecord>();
  const orphanNotificationIds: string[] = [];

  for (const notification of notifications) {
    const delegationId = notification.delegationId;
    if (delegationId === undefined || !mailboxDelegationIds.has(delegationId)) {
      orphanNotificationIds.push(notification.id);
      continue;
    }
    notificationsByDelegationId.set(delegationId, notification);
  }

  const items = delegation.map<WorkerMailboxItem>((record) => {
    const notification = notificationsByDelegationId.get(record.id);
    return {
      id: record.id,
      workerId: record.workerId,
      instruction: record.instruction,
      status: record.status,
      ...(record.taskId === undefined ? {} : { taskId: record.taskId }),
      ...(record.specialization === undefined ? {} : { specialization: record.specialization }),
      ...(record.targetAgent === undefined ? {} : { targetAgent: record.targetAgent }),
      ...(record.verificationRequest === undefined
        ? {}
        : { verificationRequest: cloneDelegationVerificationRequest(record.verificationRequest) }),
      ...(notification === undefined
        ? {}
        : {
            notificationId: notification.id,
            notificationStatus: notification.status,
            notificationSummary: notification.summary,
          }),
    };
  });
  const unnotifiedDelegationIds = delegation
    .filter((record) => !notificationsByDelegationId.has(record.id))
    .map((record) => record.id);

  return {
    ...(query.workerId === undefined ? {} : { workerId: query.workerId }),
    mailboxSize: delegation.length,
    notificationCount: notifications.length,
    coverage: resolveWorkerMailboxCoverage(unnotifiedDelegationIds, orphanNotificationIds),
    delegationIds: delegation.map((record) => record.id),
    notificationIds: notifications.map((record) => record.id),
    unnotifiedDelegationIds,
    orphanNotificationIds,
    items,
    notifications,
  };
}

export function readVerifierMailbox(
  state: TaskOperationsState,
  query: VerifierMailboxQuery = {},
): VerifierMailboxSnapshot {
  const verification = listVerificationMailbox(state, {
    ...(query.verifierId === undefined ? {} : { verifierId: query.verifierId }),
    statuses: ["pending"],
  });
  const notifications = listNotificationMailbox(state, {
    recipientKind: "verifier",
    ...(query.verifierId === undefined ? {} : { recipientId: query.verifierId }),
    statuses: ["pending"],
  });
  const mailboxVerificationIds = new Set(verification.map((record) => record.id));
  const notificationsByVerificationId = new Map<string, TaskNotificationRecord>();
  const orphanNotificationIds: string[] = [];

  for (const notification of notifications) {
    const verificationId = notification.verificationId;
    if (verificationId === undefined || !mailboxVerificationIds.has(verificationId)) {
      orphanNotificationIds.push(notification.id);
      continue;
    }
    notificationsByVerificationId.set(verificationId, notification);
  }

  const items = verification.map<VerifierMailboxItem>((record) => {
    const notification = notificationsByVerificationId.get(record.id);
    return {
      id: record.id,
      verifierId: record.verifierId,
      requirement: record.requirement,
      status: record.status,
      ...(record.taskId === undefined ? {} : { taskId: record.taskId }),
      ...(notification === undefined
        ? {}
        : {
            notificationId: notification.id,
            notificationStatus: notification.status,
            notificationSummary: notification.summary,
          }),
    };
  });
  const unnotifiedVerificationIds = verification
    .filter((record) => !notificationsByVerificationId.has(record.id))
    .map((record) => record.id);

  return {
    ...(query.verifierId === undefined ? {} : { verifierId: query.verifierId }),
    mailboxSize: verification.length,
    notificationCount: notifications.length,
    coverage: resolveWorkerMailboxCoverage(
      unnotifiedVerificationIds,
      orphanNotificationIds,
    ) as VerifierMailboxCoverage,
    verificationIds: verification.map((record) => record.id),
    notificationIds: notifications.map((record) => record.id),
    unnotifiedVerificationIds,
    orphanNotificationIds,
    items,
    notifications,
  };
}

function compareProposalMailboxOrder(left: ProposalRecord, right: ProposalRecord): number {
  if (left.createdAtMs !== right.createdAtMs) {
    return left.createdAtMs - right.createdAtMs;
  }
  if (left.updatedAtMs !== right.updatedAtMs) {
    return left.updatedAtMs - right.updatedAtMs;
  }
  return left.id.localeCompare(right.id);
}

function cloneProposalRecord(record: ProposalRecord): ProposalRecord {
  return {
    id: record.id,
    kind: record.kind,
    payload: { ...record.payload },
    status: record.status,
    schemaVersion: record.schemaVersion,
    sourceSessionId: record.sourceSessionId,
    sourceTurnId: record.sourceTurnId,
    provenance: record.provenance,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
    ...(record.expiresAtMs === undefined ? {} : { expiresAtMs: record.expiresAtMs }),
    ...(record.decisionNote === undefined ? {} : { decisionNote: record.decisionNote }),
  };
}

function compareNotificationMailboxOrder(
  left: TaskNotificationRecord,
  right: TaskNotificationRecord,
): number {
  if (left.createdAtMs !== right.createdAtMs) {
    return left.createdAtMs - right.createdAtMs;
  }
  if (left.updatedAtMs !== right.updatedAtMs) {
    return left.updatedAtMs - right.updatedAtMs;
  }
  return left.id.localeCompare(right.id);
}

function cloneTaskNotificationRecord(record: TaskNotificationRecord): TaskNotificationRecord {
  return {
    id: record.id,
    kind: record.kind,
    recipientKind: record.recipientKind,
    recipientId: record.recipientId,
    status: record.status,
    summary: record.summary,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
    ...(record.taskId === undefined ? {} : { taskId: record.taskId }),
    ...(record.delegationId === undefined ? {} : { delegationId: record.delegationId }),
    ...(record.verificationId === undefined ? {} : { verificationId: record.verificationId }),
    ...(record.acknowledgedAtMs === undefined ? {} : { acknowledgedAtMs: record.acknowledgedAtMs }),
  };
}

function resolveWorkerMailboxCoverage(
  unnotifiedDelegationIds: readonly string[],
  orphanNotificationIds: readonly string[],
): WorkerMailboxCoverage {
  if (unnotifiedDelegationIds.length > 0 && orphanNotificationIds.length > 0) {
    return "mixed";
  }
  if (unnotifiedDelegationIds.length > 0) {
    return "missing-notifications";
  }
  if (orphanNotificationIds.length > 0) {
    return "orphan-notifications";
  }
  return "aligned";
}

function compareDelegationMailboxOrder(left: DelegationRecord, right: DelegationRecord): number {
  if (left.createdAtMs !== right.createdAtMs) {
    return left.createdAtMs - right.createdAtMs;
  }
  if (left.updatedAtMs !== right.updatedAtMs) {
    return left.updatedAtMs - right.updatedAtMs;
  }
  return left.id.localeCompare(right.id);
}

function cloneDelegationRecord(record: DelegationRecord): DelegationRecord {
  return {
    id: record.id,
    workerId: record.workerId,
    instruction: record.instruction,
    status: record.status,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
    ...(record.taskId === undefined ? {} : { taskId: record.taskId }),
    ...(record.fromAgent === undefined ? {} : { fromAgent: record.fromAgent }),
    ...(record.contextSnapshot === undefined ? {} : { contextSnapshot: record.contextSnapshot }),
    ...(record.specialization === undefined ? {} : { specialization: record.specialization }),
    ...(record.targetAgent === undefined ? {} : { targetAgent: record.targetAgent }),
    ...(record.verificationRequest === undefined
      ? {}
      : { verificationRequest: cloneDelegationVerificationRequest(record.verificationRequest) }),
    ...(record.resultSummary === undefined ? {} : { resultSummary: record.resultSummary }),
    ...(record.completedAtMs === undefined ? {} : { completedAtMs: record.completedAtMs }),
    ...(record.error === undefined ? {} : { error: record.error }),
  };
}

function cloneDelegationVerificationRequest(
  request: DelegationVerificationRequest,
): DelegationVerificationRequest {
  return {
    verifierId: request.verifierId,
    requirement: request.requirement,
    ...(request.verificationId === undefined ? {} : { verificationId: request.verificationId }),
  };
}

function compareVerificationMailboxOrder(
  left: VerificationGateRecord,
  right: VerificationGateRecord,
): number {
  if (left.createdAtMs !== right.createdAtMs) {
    return left.createdAtMs - right.createdAtMs;
  }
  if (left.updatedAtMs !== right.updatedAtMs) {
    return left.updatedAtMs - right.updatedAtMs;
  }
  return left.id.localeCompare(right.id);
}

function cloneVerificationGateRecord(record: VerificationGateRecord): VerificationGateRecord {
  return {
    id: record.id,
    verifierId: record.verifierId,
    requirement: record.requirement,
    status: record.status,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
    ...(record.taskId === undefined ? {} : { taskId: record.taskId }),
    ...(record.verifiedBy === undefined ? {} : { verifiedBy: record.verifiedBy }),
    ...(record.verdict === undefined ? {} : { verdict: record.verdict }),
    ...(record.verdictSummary === undefined ? {} : { verdictSummary: record.verdictSummary }),
    ...(record.checks === undefined ? {} : { checks: cloneVerificationChecks(record.checks) }),
  };
}

function cloneVerificationChecks(checks: readonly VerificationCheck[]): VerificationCheck[] {
  return checks.map((check) => ({
    id: check.id,
    status: check.status,
    summary: check.summary,
    ...(check.detail === undefined ? {} : { detail: check.detail }),
  }));
}
