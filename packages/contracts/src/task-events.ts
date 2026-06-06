import type {
  DelegationObservedWriteSetSource,
  DelegationRecord,
  DelegationSpecialization,
  DelegationStatus,
  DelegationVerificationRequest,
  ProposalOutboxEntry,
  ProposalRecord,
  ProposalStatus,
  TaskNotificationRecord,
  TaskNotificationStatus,
  VerificationCheck,
  VerificationGateRecord,
  VerificationVerdict,
} from "./task-operations.js";
import type { TaskItem, TaskPriority, TaskState } from "./task.js";

export const TASK_EVENTS_DOMAIN_VERSION = "tasks/v1" as const;
export type TaskEventsDomainVersion = typeof TASK_EVENTS_DOMAIN_VERSION;

export type TaskEventType =
  | "tasks.todo_write"
  | "tasks.delegation_upserted"
  | "tasks.delegation_status_set"
  | "tasks.verification_upserted"
  | "tasks.notification_emitted"
  | "tasks.notification_status_set"
  | "tasks.proposal_enqueued"
  | "tasks.proposal_transitioned"
  | "tasks.proposal_outbox_drained";

export interface TaskEventActor {
  readonly kind: "engine" | "cli" | "worker";
  readonly id?: string;
}

export type TaskTodoWritePayload = TaskState;

export interface TaskDelegationUpsertedPayload {
  readonly record: DelegationRecord;
  readonly updatedAtMs: number;
  readonly opId?: string;
  readonly actor?: TaskEventActor;
}

export interface TaskDelegationStatusSetPayload extends TaskDelegationUpsertedPayload {
  readonly fromStatus?: DelegationStatus;
  readonly toStatus?: DelegationStatus;
  readonly reason?: string;
}

export interface TaskVerificationUpsertedPayload {
  readonly record: VerificationGateRecord;
  readonly updatedAtMs: number;
  readonly opId?: string;
  readonly actor?: TaskEventActor;
}

export interface TaskNotificationEmittedPayload {
  readonly record: TaskNotificationRecord;
  readonly updatedAtMs: number;
  readonly opId?: string;
  readonly actor?: TaskEventActor;
}

export interface TaskNotificationStatusSetPayload extends TaskNotificationEmittedPayload {
  readonly fromStatus?: TaskNotificationStatus;
  readonly toStatus?: TaskNotificationStatus;
  readonly reason?: string;
}

export interface TaskProposalEnqueuedPayload {
  readonly proposal: ProposalRecord;
  readonly outboxEntry: ProposalOutboxEntry;
  readonly updatedAtMs: number;
  readonly opId?: string;
  readonly actor?: TaskEventActor;
}

export interface TaskProposalTransitionedPayload extends TaskProposalEnqueuedPayload {
  readonly fromStatus?: ProposalStatus;
  readonly toStatus?: ProposalStatus;
}

export interface TaskProposalOutboxDrainedPayload {
  readonly drainedIds: readonly string[];
  readonly drainedAtMs: number;
  readonly drained?: readonly ProposalOutboxEntry[];
  readonly updatedAtMs?: number;
  readonly drainBatchId?: string;
  readonly opId?: string;
  readonly actor?: TaskEventActor;
}

export interface TaskEventPayloadByType {
  readonly "tasks.todo_write": TaskTodoWritePayload;
  readonly "tasks.delegation_upserted": TaskDelegationUpsertedPayload;
  readonly "tasks.delegation_status_set": TaskDelegationStatusSetPayload;
  readonly "tasks.verification_upserted": TaskVerificationUpsertedPayload;
  readonly "tasks.notification_emitted": TaskNotificationEmittedPayload;
  readonly "tasks.notification_status_set": TaskNotificationStatusSetPayload;
  readonly "tasks.proposal_enqueued": TaskProposalEnqueuedPayload;
  readonly "tasks.proposal_transitioned": TaskProposalTransitionedPayload;
  readonly "tasks.proposal_outbox_drained": TaskProposalOutboxDrainedPayload;
}

type TaskEventEnvelopeByType = {
  [TEventType in TaskEventType]: {
    readonly eventType: TEventType;
    readonly payload: TaskEventPayloadByType[TEventType];
    readonly domainVersion: TaskEventsDomainVersion;
  };
};

export type TaskEventEnvelope<TEventType extends TaskEventType = TaskEventType> =
  TaskEventEnvelopeByType[TEventType];

const TASK_EVENT_TYPE_SET = new Set<TaskEventType>([
  "tasks.todo_write",
  "tasks.delegation_upserted",
  "tasks.delegation_status_set",
  "tasks.verification_upserted",
  "tasks.notification_emitted",
  "tasks.notification_status_set",
  "tasks.proposal_enqueued",
  "tasks.proposal_transitioned",
  "tasks.proposal_outbox_drained",
]);

const VERSION_PATTERN = /^(?<namespace>.+?)\/v(?<major>\d+)(?:\.(?<minor>\d+))?$/u;

export function isTaskEventType(eventType: string): eventType is TaskEventType {
  return TASK_EVENT_TYPE_SET.has(eventType as TaskEventType);
}

export function isTaskEventsDomainVersionCompatible(
  value: string,
  expected: TaskEventsDomainVersion = TASK_EVENTS_DOMAIN_VERSION,
): boolean {
  if (value === expected) {
    return true;
  }
  const actualParsed = parseVersion(value);
  const expectedParsed = parseVersion(expected);
  if (!actualParsed || !expectedParsed) {
    return false;
  }
  return (
    actualParsed.namespace === expectedParsed.namespace &&
    actualParsed.major === expectedParsed.major
  );
}

export function createTaskEvent<TEventType extends TaskEventType>(input: {
  readonly eventType: TEventType;
  readonly payload: TaskEventPayloadByType[TEventType];
  readonly domainVersion?: string;
}): TaskEventEnvelope<TEventType> {
  const decoded = decodeTaskEvent({
    eventType: input.eventType,
    payload: input.payload,
    ...(input.domainVersion === undefined ? {} : { domainVersion: input.domainVersion }),
  });
  if (!decoded || decoded.eventType !== input.eventType) {
    throw new TypeError(`Invalid payload for task event ${input.eventType}`);
  }
  return decoded as TaskEventEnvelope<TEventType>;
}

export function decodeTaskEvent(input: {
  readonly eventType: string;
  readonly payload: unknown;
  readonly domainVersion?: string;
}): TaskEventEnvelope | null {
  if (!isTaskEventType(input.eventType)) {
    return null;
  }
  if (
    input.domainVersion !== undefined &&
    !isTaskEventsDomainVersionCompatible(input.domainVersion)
  ) {
    return null;
  }

  switch (input.eventType) {
    case "tasks.todo_write": {
      const payload = asTaskTodoWritePayload(input.payload);
      return payload === null
        ? null
        : {
            eventType: input.eventType,
            payload,
            domainVersion: TASK_EVENTS_DOMAIN_VERSION,
          };
    }
    case "tasks.delegation_upserted": {
      const payload = asTaskDelegationUpsertedPayload(input.payload);
      return payload === null
        ? null
        : {
            eventType: input.eventType,
            payload,
            domainVersion: TASK_EVENTS_DOMAIN_VERSION,
          };
    }
    case "tasks.delegation_status_set": {
      const payload = asTaskDelegationStatusSetPayload(input.payload);
      return payload === null
        ? null
        : {
            eventType: input.eventType,
            payload,
            domainVersion: TASK_EVENTS_DOMAIN_VERSION,
          };
    }
    case "tasks.verification_upserted": {
      const payload = asTaskVerificationUpsertedPayload(input.payload);
      return payload === null
        ? null
        : {
            eventType: input.eventType,
            payload,
            domainVersion: TASK_EVENTS_DOMAIN_VERSION,
          };
    }
    case "tasks.notification_emitted": {
      const payload = asTaskNotificationEmittedPayload(input.payload);
      return payload === null
        ? null
        : {
            eventType: input.eventType,
            payload,
            domainVersion: TASK_EVENTS_DOMAIN_VERSION,
          };
    }
    case "tasks.notification_status_set": {
      const payload = asTaskNotificationStatusSetPayload(input.payload);
      return payload === null
        ? null
        : {
            eventType: input.eventType,
            payload,
            domainVersion: TASK_EVENTS_DOMAIN_VERSION,
          };
    }
    case "tasks.proposal_enqueued": {
      const payload = asTaskProposalEnqueuedPayload(input.payload);
      return payload === null
        ? null
        : {
            eventType: input.eventType,
            payload,
            domainVersion: TASK_EVENTS_DOMAIN_VERSION,
          };
    }
    case "tasks.proposal_transitioned": {
      const payload = asTaskProposalTransitionedPayload(input.payload);
      return payload === null
        ? null
        : {
            eventType: input.eventType,
            payload,
            domainVersion: TASK_EVENTS_DOMAIN_VERSION,
          };
    }
    case "tasks.proposal_outbox_drained": {
      const payload = asTaskProposalOutboxDrainedPayload(input.payload);
      return payload === null
        ? null
        : {
            eventType: input.eventType,
            payload,
            domainVersion: TASK_EVENTS_DOMAIN_VERSION,
          };
    }
    default:
      return null;
  }
}

function parseVersion(value: string): { namespace: string; major: number } | null {
  const normalized = value.trim();
  const match = VERSION_PATTERN.exec(normalized);
  if (!match?.groups) {
    return null;
  }
  const namespace = match.groups.namespace;
  const majorText = match.groups.major;
  if (!namespace || !majorText) {
    return null;
  }
  const major = Number(majorText);
  if (!Number.isInteger(major)) {
    return null;
  }
  return { namespace, major };
}

function asTaskTodoWritePayload(value: unknown): TaskTodoWritePayload | null {
  const state = asTaskState(value);
  if (state !== null) {
    return state;
  }

  if (!isRecord(value)) {
    return null;
  }
  const todos = asTaskState(value.todos);
  if (todos === null) {
    return null;
  }
  const updatedAt =
    todos.updatedAtMs ??
    (Number.isFinite(value.updatedAtMs) ? (value.updatedAtMs as number) : undefined);
  return {
    items: todos.items.map((item) => cloneTaskItem(item)),
    ...(updatedAt === undefined ? {} : { updatedAtMs: updatedAt }),
  };
}

function asTaskDelegationUpsertedPayload(value: unknown): TaskDelegationUpsertedPayload | null {
  if (!isRecord(value)) {
    return null;
  }
  const record = asDelegationRecord(value.record);
  if (record === null) {
    return null;
  }
  const updatedAtMs = Number.isFinite(value.updatedAtMs)
    ? (value.updatedAtMs as number)
    : record.updatedAtMs;
  const actor = asTaskEventActor(value.actor);
  const opId = typeof value.opId === "string" ? value.opId : undefined;
  return {
    record,
    updatedAtMs,
    ...(opId === undefined ? {} : { opId }),
    ...(actor === undefined ? {} : { actor }),
  };
}

function asTaskDelegationStatusSetPayload(value: unknown): TaskDelegationStatusSetPayload | null {
  const base = asTaskDelegationUpsertedPayload(value);
  if (base === null || !isRecord(value)) {
    return null;
  }
  const fromStatus = asDelegationStatus(value.fromStatus);
  const toStatus = asDelegationStatus(value.toStatus);
  const reason = typeof value.reason === "string" ? value.reason : undefined;
  return {
    ...base,
    ...(fromStatus === undefined ? {} : { fromStatus }),
    ...(toStatus === undefined ? {} : { toStatus }),
    ...(reason === undefined ? {} : { reason }),
  };
}

function asTaskVerificationUpsertedPayload(value: unknown): TaskVerificationUpsertedPayload | null {
  if (!isRecord(value)) {
    return null;
  }
  const record = asVerificationGateRecord(value.record);
  if (record === null) {
    return null;
  }
  const updatedAtMs = Number.isFinite(value.updatedAtMs)
    ? (value.updatedAtMs as number)
    : record.updatedAtMs;
  const actor = asTaskEventActor(value.actor);
  const opId = typeof value.opId === "string" ? value.opId : undefined;
  return {
    record,
    updatedAtMs,
    ...(opId === undefined ? {} : { opId }),
    ...(actor === undefined ? {} : { actor }),
  };
}

function asTaskNotificationEmittedPayload(value: unknown): TaskNotificationEmittedPayload | null {
  if (!isRecord(value)) {
    return null;
  }
  const record = asTaskNotificationRecord(value.record);
  if (record === null) {
    return null;
  }
  const updatedAtMs = Number.isFinite(value.updatedAtMs)
    ? (value.updatedAtMs as number)
    : record.updatedAtMs;
  const actor = asTaskEventActor(value.actor);
  const opId = typeof value.opId === "string" ? value.opId : undefined;
  return {
    record,
    updatedAtMs,
    ...(opId === undefined ? {} : { opId }),
    ...(actor === undefined ? {} : { actor }),
  };
}

function asTaskNotificationStatusSetPayload(
  value: unknown,
): TaskNotificationStatusSetPayload | null {
  const base = asTaskNotificationEmittedPayload(value);
  if (base === null || !isRecord(value)) {
    return null;
  }
  const fromStatus = asTaskNotificationStatus(value.fromStatus);
  const toStatus = asTaskNotificationStatus(value.toStatus);
  const reason = typeof value.reason === "string" ? value.reason : undefined;
  return {
    ...base,
    ...(fromStatus === undefined ? {} : { fromStatus }),
    ...(toStatus === undefined ? {} : { toStatus }),
    ...(reason === undefined ? {} : { reason }),
  };
}

function asTaskProposalEnqueuedPayload(value: unknown): TaskProposalEnqueuedPayload | null {
  if (!isRecord(value)) {
    return null;
  }
  const proposal = asProposalRecord(value.proposal);
  const outboxEntry = asProposalOutboxEntry(value.outboxEntry);
  if (proposal === null || outboxEntry === null) {
    return null;
  }
  const updatedAtMs = Number.isFinite(value.updatedAtMs)
    ? (value.updatedAtMs as number)
    : proposal.updatedAtMs;
  const actor = asTaskEventActor(value.actor);
  const opId = typeof value.opId === "string" ? value.opId : undefined;
  return {
    proposal,
    outboxEntry,
    updatedAtMs,
    ...(opId === undefined ? {} : { opId }),
    ...(actor === undefined ? {} : { actor }),
  };
}

function asTaskProposalTransitionedPayload(value: unknown): TaskProposalTransitionedPayload | null {
  const base = asTaskProposalEnqueuedPayload(value);
  if (base === null || !isRecord(value)) {
    return null;
  }
  const fromStatus = asProposalStatus(value.fromStatus);
  const toStatus = asProposalStatus(value.toStatus);
  return {
    ...base,
    ...(fromStatus === undefined ? {} : { fromStatus }),
    ...(toStatus === undefined ? {} : { toStatus }),
  };
}

function asTaskProposalOutboxDrainedPayload(
  value: unknown,
): TaskProposalOutboxDrainedPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  const actor = asTaskEventActor(value.actor);
  const opId = typeof value.opId === "string" ? value.opId : undefined;
  const drainBatchId = typeof value.drainBatchId === "string" ? value.drainBatchId : undefined;

  const drained = asProposalOutboxEntryArray(value.drained);
  if (drained !== null && Number.isFinite(value.updatedAtMs)) {
    const updatedAtMs = value.updatedAtMs as number;
    return {
      drainedIds: drained.map((entry) => entry.id),
      drainedAtMs: updatedAtMs,
      drained,
      updatedAtMs,
      ...(drainBatchId === undefined ? {} : { drainBatchId }),
      ...(opId === undefined ? {} : { opId }),
      ...(actor === undefined ? {} : { actor }),
    };
  }

  if (!Array.isArray(value.drainedIds) || !Number.isFinite(value.drainedAtMs)) {
    return null;
  }
  const drainedIds = value.drainedIds.filter((entry): entry is string => typeof entry === "string");
  if (drainedIds.length !== value.drainedIds.length) {
    return null;
  }
  const updatedAtMs = Number.isFinite(value.updatedAtMs)
    ? (value.updatedAtMs as number)
    : undefined;
  return {
    drainedIds: [...drainedIds],
    drainedAtMs: value.drainedAtMs as number,
    ...(drained === null ? {} : { drained }),
    ...(updatedAtMs === undefined ? {} : { updatedAtMs }),
    ...(drainBatchId === undefined ? {} : { drainBatchId }),
    ...(opId === undefined ? {} : { opId }),
    ...(actor === undefined ? {} : { actor }),
  };
}

function asTaskState(value: unknown): TaskState | null {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return null;
  }
  const items = value.items.map((item) => asTaskItem(item));
  if (items.some((item) => item === null)) {
    return null;
  }
  const updatedAtMs = Number.isFinite(value.updatedAtMs)
    ? (value.updatedAtMs as number)
    : undefined;
  return {
    items: items.map((item) => cloneTaskItem(item as TaskItem)),
    ...(updatedAtMs === undefined ? {} : { updatedAtMs }),
  };
}

function asTaskItem(value: unknown): TaskItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const status = asTaskItemStatus(value.status);
  if (typeof value.id !== "string" || typeof value.content !== "string" || status === undefined) {
    return null;
  }
  const priority = asTaskPriority(value.priority);
  return {
    id: value.id,
    content: value.content,
    status,
    ...(priority === undefined ? {} : { priority }),
  };
}

function asTaskItemStatus(value: unknown): TaskItem["status"] | undefined {
  if (value === "todo" || value === "doing" || value === "done") {
    return value;
  }
  return undefined;
}

function asTaskPriority(value: unknown): TaskPriority | undefined {
  if (value === "low" || value === "normal" || value === "high" || value === "urgent") {
    return value;
  }
  return undefined;
}

function asTaskEventActor(value: unknown): TaskEventActor | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.kind !== "engine" && value.kind !== "cli" && value.kind !== "worker") {
    return undefined;
  }
  const id = typeof value.id === "string" ? value.id : undefined;
  return {
    kind: value.kind,
    ...(id === undefined ? {} : { id }),
  };
}

function asDelegationRecord(value: unknown): DelegationRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const status = asDelegationStatus(value.status);
  if (
    typeof value.id !== "string" ||
    typeof value.workerId !== "string" ||
    typeof value.instruction !== "string" ||
    status === undefined ||
    !Number.isFinite(value.createdAtMs) ||
    !Number.isFinite(value.updatedAtMs)
  ) {
    return null;
  }
  const taskId = typeof value.taskId === "string" ? value.taskId : undefined;
  const fromAgent = typeof value.fromAgent === "string" ? value.fromAgent : undefined;
  const contextSnapshot =
    typeof value.contextSnapshot === "string" ? value.contextSnapshot : undefined;
  let specialization: DelegationSpecialization | undefined;
  if (value.specialization !== undefined) {
    const parsedSpecialization = asDelegationSpecialization(value.specialization);
    if (parsedSpecialization === undefined) {
      return null;
    }
    specialization = parsedSpecialization;
  }
  let targetAgent: string | undefined;
  if (value.targetAgent !== undefined) {
    if (typeof value.targetAgent !== "string" || specialization === undefined) {
      return null;
    }
    targetAgent = value.targetAgent;
  }
  let verificationRequest: DelegationVerificationRequest | undefined;
  if (value.verificationRequest !== undefined) {
    const parsedVerificationRequest = asDelegationVerificationRequest(value.verificationRequest);
    if (parsedVerificationRequest === null) {
      return null;
    }
    verificationRequest = parsedVerificationRequest;
  }
  const resultSummary = typeof value.resultSummary === "string" ? value.resultSummary : undefined;
  const observedWriteSet = asStringArray(value.observedWriteSet);
  if (value.observedWriteSet !== undefined && observedWriteSet === undefined) {
    return null;
  }
  const observedWriteSetSource = asDelegationObservedWriteSetSource(value.observedWriteSetSource);
  if (value.observedWriteSetSource !== undefined && observedWriteSetSource === undefined) {
    return null;
  }
  const completedAtMs = Number.isFinite(value.completedAtMs)
    ? (value.completedAtMs as number)
    : undefined;
  const error = typeof value.error === "string" ? value.error : undefined;
  return {
    id: value.id,
    workerId: value.workerId,
    instruction: value.instruction,
    status,
    createdAtMs: value.createdAtMs as number,
    updatedAtMs: value.updatedAtMs as number,
    ...(taskId === undefined ? {} : { taskId }),
    ...(fromAgent === undefined ? {} : { fromAgent }),
    ...(contextSnapshot === undefined ? {} : { contextSnapshot }),
    ...(specialization === undefined ? {} : { specialization }),
    ...(targetAgent === undefined ? {} : { targetAgent }),
    ...(verificationRequest === undefined ? {} : { verificationRequest }),
    ...(resultSummary === undefined ? {} : { resultSummary }),
    ...(observedWriteSet === undefined ? {} : { observedWriteSet }),
    ...(observedWriteSetSource === undefined ? {} : { observedWriteSetSource }),
    ...(completedAtMs === undefined ? {} : { completedAtMs }),
    ...(error === undefined ? {} : { error }),
  };
}

function asDelegationObservedWriteSetSource(
  value: unknown,
): DelegationObservedWriteSetSource | undefined {
  if (value === "patch" || value === "diff" || value === "artifact") {
    return value;
  }
  return undefined;
}

function asStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (value.some((entry) => typeof entry !== "string")) {
    return undefined;
  }
  return value as readonly string[];
}

function asDelegationSpecialization(value: unknown): DelegationSpecialization | undefined {
  if (value === "explore" || value === "plan" || value === "verify" || value === "general") {
    return value;
  }
  return undefined;
}

function asDelegationVerificationRequest(value: unknown): DelegationVerificationRequest | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.verifierId !== "string" || typeof value.requirement !== "string") {
    return null;
  }
  const verificationId =
    typeof value.verificationId === "string" ? value.verificationId : undefined;
  return {
    verifierId: value.verifierId,
    requirement: value.requirement,
    ...(verificationId === undefined ? {} : { verificationId }),
  };
}

function asDelegationStatus(value: unknown): DelegationStatus | undefined {
  if (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return undefined;
}

function asTaskNotificationRecord(value: unknown): TaskNotificationRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind = asTaskNotificationKind(value.kind);
  const recipientKind = asTaskNotificationRecipientKind(value.recipientKind);
  const status = asTaskNotificationStatus(value.status);
  if (
    typeof value.id !== "string" ||
    kind === undefined ||
    recipientKind === undefined ||
    typeof value.recipientId !== "string" ||
    status === undefined ||
    typeof value.summary !== "string" ||
    !Number.isFinite(value.createdAtMs) ||
    !Number.isFinite(value.updatedAtMs)
  ) {
    return null;
  }
  const taskId = typeof value.taskId === "string" ? value.taskId : undefined;
  const delegationId = typeof value.delegationId === "string" ? value.delegationId : undefined;
  const verificationId =
    typeof value.verificationId === "string" ? value.verificationId : undefined;
  const acknowledgedAtMs = Number.isFinite(value.acknowledgedAtMs)
    ? (value.acknowledgedAtMs as number)
    : undefined;
  return {
    id: value.id,
    kind,
    recipientKind,
    recipientId: value.recipientId,
    status,
    summary: value.summary,
    createdAtMs: value.createdAtMs as number,
    updatedAtMs: value.updatedAtMs as number,
    ...(taskId === undefined ? {} : { taskId }),
    ...(delegationId === undefined ? {} : { delegationId }),
    ...(verificationId === undefined ? {} : { verificationId }),
    ...(acknowledgedAtMs === undefined ? {} : { acknowledgedAtMs }),
  };
}

function asTaskNotificationKind(value: unknown): TaskNotificationRecord["kind"] | undefined {
  if (value === "delegation_assigned" || value === "verification_requested") {
    return value;
  }
  return undefined;
}

function asTaskNotificationRecipientKind(
  value: unknown,
): TaskNotificationRecord["recipientKind"] | undefined {
  if (value === "worker" || value === "verifier") {
    return value;
  }
  return undefined;
}

function asTaskNotificationStatus(value: unknown): TaskNotificationStatus | undefined {
  if (value === "pending" || value === "acknowledged") {
    return value;
  }
  return undefined;
}

function asVerificationGateRecord(value: unknown): VerificationGateRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const status = asVerificationStatus(value.status);
  if (
    typeof value.id !== "string" ||
    typeof value.verifierId !== "string" ||
    typeof value.requirement !== "string" ||
    status === undefined ||
    !Number.isFinite(value.createdAtMs) ||
    !Number.isFinite(value.updatedAtMs)
  ) {
    return null;
  }
  const taskId = typeof value.taskId === "string" ? value.taskId : undefined;
  const verifiedBy = typeof value.verifiedBy === "string" ? value.verifiedBy : undefined;
  const verdict = asVerificationVerdict(value.verdict);
  const verdictSummary =
    typeof value.verdictSummary === "string" ? value.verdictSummary : undefined;
  let checks: readonly VerificationCheck[] | undefined;
  if (value.checks !== undefined) {
    const parsedChecks = asVerificationCheckArray(value.checks);
    if (parsedChecks === null) {
      return null;
    }
    checks = parsedChecks;
  }
  return {
    id: value.id,
    verifierId: value.verifierId,
    requirement: value.requirement,
    status,
    createdAtMs: value.createdAtMs as number,
    updatedAtMs: value.updatedAtMs as number,
    ...(taskId === undefined ? {} : { taskId }),
    ...(verifiedBy === undefined ? {} : { verifiedBy }),
    ...(verdict === undefined ? {} : { verdict }),
    ...(verdictSummary === undefined ? {} : { verdictSummary }),
    ...(checks === undefined ? {} : { checks }),
  };
}

function asVerificationStatus(value: unknown): VerificationGateRecord["status"] | undefined {
  if (value === "pending" || value === "passed" || value === "failed" || value === "partial") {
    return value;
  }
  return undefined;
}

function asVerificationVerdict(value: unknown): VerificationVerdict | undefined {
  if (value === "pass" || value === "fail" || value === "partial") {
    return value;
  }
  return undefined;
}

function asVerificationCheckArray(value: unknown): readonly VerificationCheck[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const checks = value.map((entry) => asVerificationCheck(entry));
  if (checks.some((entry) => entry === null)) {
    return null;
  }
  return checks.map((entry) => entry as VerificationCheck);
}

function asVerificationCheck(value: unknown): VerificationCheck | null {
  if (!isRecord(value)) {
    return null;
  }
  const status = asVerificationVerdict(value.status);
  const detail = typeof value.detail === "string" ? value.detail : undefined;
  if (typeof value.id !== "string" || typeof value.summary !== "string" || status === undefined) {
    return null;
  }
  return {
    id: value.id,
    status,
    summary: value.summary,
    ...(detail === undefined ? {} : { detail }),
  };
}

function asProposalRecord(value: unknown): ProposalRecord | null {
  if (!isRecord(value) || !isRecord(value.payload)) {
    return null;
  }
  const status = asProposalStatus(value.status);
  const schemaVersion = typeof value.schemaVersion === "string" ? value.schemaVersion : undefined;
  if (
    typeof value.id !== "string" ||
    typeof value.kind !== "string" ||
    status === undefined ||
    schemaVersion === undefined ||
    typeof value.sourceSessionId !== "string" ||
    typeof value.sourceTurnId !== "string" ||
    typeof value.provenance !== "string" ||
    !Number.isFinite(value.createdAtMs) ||
    !Number.isFinite(value.updatedAtMs)
  ) {
    return null;
  }
  const expiresAtMs = Number.isFinite(value.expiresAtMs)
    ? (value.expiresAtMs as number)
    : undefined;
  const decisionNote = typeof value.decisionNote === "string" ? value.decisionNote : undefined;
  return {
    id: value.id,
    kind: value.kind,
    payload: { ...value.payload },
    status,
    schemaVersion: schemaVersion as ProposalRecord["schemaVersion"],
    sourceSessionId: value.sourceSessionId,
    sourceTurnId: value.sourceTurnId,
    provenance: value.provenance,
    createdAtMs: value.createdAtMs as number,
    updatedAtMs: value.updatedAtMs as number,
    ...(expiresAtMs === undefined ? {} : { expiresAtMs }),
    ...(decisionNote === undefined ? {} : { decisionNote }),
  };
}

function asProposalStatus(value: unknown): ProposalStatus | undefined {
  if (
    value === "pending" ||
    value === "accepted" ||
    value === "rejected" ||
    value === "applied" ||
    value === "expired"
  ) {
    return value;
  }
  return undefined;
}

function asProposalOutboxEntry(value: unknown): ProposalOutboxEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const status = asProposalStatus(value.status);
  const eventType = asProposalOutboxEventType(value.eventType);
  const schemaVersion = typeof value.schemaVersion === "string" ? value.schemaVersion : undefined;
  if (
    typeof value.id !== "string" ||
    eventType === undefined ||
    typeof value.proposalId !== "string" ||
    status === undefined ||
    schemaVersion === undefined ||
    !Number.isFinite(value.createdAtMs)
  ) {
    return null;
  }
  return {
    id: value.id,
    eventType,
    proposalId: value.proposalId,
    status,
    schemaVersion: schemaVersion as ProposalOutboxEntry["schemaVersion"],
    createdAtMs: value.createdAtMs as number,
  };
}

function asProposalOutboxEntryArray(value: unknown): ProposalOutboxEntry[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const mapped = value.map((entry) => asProposalOutboxEntry(entry));
  if (mapped.some((entry) => entry === null)) {
    return null;
  }
  return mapped.map((entry) => cloneProposalOutboxEntry(entry as ProposalOutboxEntry));
}

function asProposalOutboxEventType(value: unknown): ProposalOutboxEntry["eventType"] | undefined {
  if (value === "proposal.enqueued" || value === "proposal.status_changed") {
    return value;
  }
  return undefined;
}

function cloneTaskItem(item: TaskItem): TaskItem {
  const priority = item.priority;
  return {
    id: item.id,
    content: item.content,
    status: item.status,
    ...(priority === undefined ? {} : { priority }),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
