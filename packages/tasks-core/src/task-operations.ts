import {
  CONTRACTS_SCHEMA_VERSION,
  type DelegationObservedWriteSetSource,
  type DelegationRecord,
  type DelegationRecordInput,
  type DelegationSpecialization,
  type DelegationStatus,
  type DelegationStatusUpdate,
  type DelegationVerificationRequest,
  type ProposalOutboxEntry,
  type ProposalQueueInput,
  type ProposalRecord,
  type ProposalStatus,
  type ProposalStatusTransition,
  type TaskItem,
  type TaskLifecycleRecord,
  type TaskLifecycleStatus,
  type TaskNotificationRecord,
  type TaskNotificationStatus,
  type TaskOperationsState,
  type TaskState,
  type VerificationCheck,
  type VerificationGateInput,
  type VerificationGateRecord,
  type VerificationStatus,
} from "@hotflow/contracts";
import { deriveTaskLifecycle } from "./tasks.js";

export type {
  DelegationRecord,
  DelegationRecordInput,
  DelegationObservedWriteSetSource,
  DelegationSpecialization,
  DelegationVerificationRequest,
  DelegationStatus,
  DelegationStatusUpdate,
  ProposalOutboxEntry,
  ProposalOutboxEventType,
  ProposalQueueInput,
  ProposalRecord,
  ProposalStatus,
  ProposalStatusTransition,
  TaskOperationsState,
  VerificationCheck,
  VerificationCheckStatus,
  VerificationGateInput,
  VerificationGateRecord,
  VerificationStatus,
  VerificationVerdict,
  TaskLifecycleRecord,
  TaskLifecycleStatus,
  TaskNotificationKind,
  TaskNotificationRecipientKind,
  TaskNotificationRecord,
  TaskNotificationStatus,
} from "@hotflow/contracts";

const ALLOWED_PROPOSAL_TRANSITIONS: Readonly<Record<ProposalStatus, readonly ProposalStatus[]>> = {
  pending: ["accepted", "rejected", "expired"],
  accepted: ["applied", "expired"],
  rejected: [],
  applied: [],
  expired: [],
};

export function cloneTaskState(state: TaskState): TaskState {
  const updatedAt = state.updatedAtMs;
  return {
    items: cloneTaskItems(state.items),
    ...(updatedAt === undefined ? {} : { updatedAtMs: updatedAt }),
  };
}

export function cloneTaskOperationsState(state: TaskOperationsState): TaskOperationsState {
  return materializeTaskOperationsState(state);
}

export function createInitialTaskOperationsState(
  state?: TaskState | TaskOperationsState,
): TaskOperationsState {
  if (!state) {
    return materializeTaskOperationsState({
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      todos: { items: [] },
      delegation: [],
      verification: [],
      proposalQueue: [],
      proposalOutbox: [],
      notifications: [],
    });
  }

  if (isTaskOperationsState(state)) {
    return cloneTaskOperationsState(state);
  }

  return materializeTaskOperationsState({
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    todos: cloneTaskState(state),
    delegation: [],
    verification: [],
    proposalQueue: [],
    proposalOutbox: [],
    notifications: [],
    ...(state.updatedAtMs === undefined ? {} : { updatedAtMs: state.updatedAtMs }),
  });
}

export function materializeTaskOperationsState(input: {
  readonly schemaVersion: TaskOperationsState["schemaVersion"];
  readonly todos: TaskState;
  readonly delegation: readonly DelegationRecord[];
  readonly verification: readonly VerificationGateRecord[];
  readonly proposalQueue: readonly ProposalRecord[];
  readonly proposalOutbox: readonly ProposalOutboxEntry[];
  readonly notifications?: readonly TaskNotificationRecord[];
  readonly lifecycle?: readonly TaskLifecycleRecord[];
  readonly updatedAtMs?: number;
}): TaskOperationsState {
  const updatedAt = input.updatedAtMs;
  const next: TaskOperationsState = {
    schemaVersion: input.schemaVersion,
    todos: cloneTaskState(input.todos),
    delegation: input.delegation.map((entry) => cloneDelegationRecord(entry)),
    verification: input.verification.map((entry) => cloneVerificationGateRecord(entry)),
    proposalQueue: input.proposalQueue.map((entry) => cloneProposalRecord(entry)),
    proposalOutbox: input.proposalOutbox.map((entry) => cloneProposalOutboxEntry(entry)),
    notifications: (input.notifications ?? []).map((entry) => cloneTaskNotificationRecord(entry)),
    lifecycle: [],
    ...(updatedAt === undefined ? {} : { updatedAtMs: updatedAt }),
  };

  return {
    ...next,
    lifecycle: deriveTaskLifecycle(next),
  };
}

export function canTransitionProposalStatus(from: ProposalStatus, to: ProposalStatus): boolean {
  if (from === to) {
    return true;
  }
  return ALLOWED_PROPOSAL_TRANSITIONS[from].includes(to);
}

function isTaskOperationsState(
  value: TaskState | TaskOperationsState,
): value is TaskOperationsState {
  return "todos" in value;
}

function cloneTaskItems(items: readonly TaskItem[]): TaskItem[] {
  return items.map((item) => ({ ...item }));
}

function cloneDelegationRecord(record: DelegationRecord): DelegationRecord {
  const taskId = record.taskId;
  const fromAgent = record.fromAgent;
  const contextSnapshot = record.contextSnapshot;
  const specialization = record.specialization;
  const targetAgent = record.targetAgent;
  const verificationRequest = record.verificationRequest;
  const resultSummary = record.resultSummary;
  const observedWriteSet = record.observedWriteSet;
  const observedWriteSetSource = record.observedWriteSetSource;
  const completedAt = record.completedAtMs;
  const error = record.error;

  return {
    id: record.id,
    workerId: record.workerId,
    instruction: record.instruction,
    status: record.status,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
    ...(taskId === undefined ? {} : { taskId }),
    ...(fromAgent === undefined ? {} : { fromAgent }),
    ...(contextSnapshot === undefined ? {} : { contextSnapshot }),
    ...(specialization === undefined ? {} : { specialization }),
    ...(targetAgent === undefined ? {} : { targetAgent }),
    ...(verificationRequest === undefined
      ? {}
      : { verificationRequest: cloneDelegationVerificationRequest(verificationRequest) }),
    ...(resultSummary === undefined ? {} : { resultSummary }),
    ...(observedWriteSet === undefined ? {} : { observedWriteSet: [...observedWriteSet] }),
    ...(observedWriteSetSource === undefined ? {} : { observedWriteSetSource }),
    ...(completedAt === undefined ? {} : { completedAtMs: completedAt }),
    ...(error === undefined ? {} : { error }),
  };
}

function cloneVerificationGateRecord(record: VerificationGateRecord): VerificationGateRecord {
  const taskId = record.taskId;
  const verifiedBy = record.verifiedBy;
  const verdict = record.verdict;
  const verdictSummary = record.verdictSummary;
  const checks = record.checks;

  return {
    id: record.id,
    verifierId: record.verifierId,
    requirement: record.requirement,
    status: record.status,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
    ...(taskId === undefined ? {} : { taskId }),
    ...(verifiedBy === undefined ? {} : { verifiedBy }),
    ...(verdict === undefined ? {} : { verdict }),
    ...(verdictSummary === undefined ? {} : { verdictSummary }),
    ...(checks === undefined ? {} : { checks: cloneVerificationChecks(checks) }),
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

function cloneProposalRecord(record: ProposalRecord): ProposalRecord {
  const expiresAt = record.expiresAtMs;
  const decisionNote = record.decisionNote;

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
    ...(expiresAt === undefined ? {} : { expiresAtMs: expiresAt }),
    ...(decisionNote === undefined ? {} : { decisionNote }),
  };
}

function cloneProposalOutboxEntry(entry: ProposalOutboxEntry): ProposalOutboxEntry {
  return {
    id: entry.id,
    eventType: entry.eventType,
    proposalId: entry.proposalId,
    status: entry.status,
    schemaVersion: entry.schemaVersion,
    createdAtMs: entry.createdAtMs,
  };
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

function cloneDelegationVerificationRequest(
  request: DelegationVerificationRequest,
): DelegationVerificationRequest {
  return {
    verifierId: request.verifierId,
    requirement: request.requirement,
    ...(request.verificationId === undefined ? {} : { verificationId: request.verificationId }),
  };
}
