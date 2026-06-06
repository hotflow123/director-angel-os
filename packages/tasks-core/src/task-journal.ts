import {
  type TaskEventEnvelope,
  type TaskEventPayloadByType,
  type TaskEventType,
  type TaskOperationsState,
  type TaskState,
  createTaskEvent,
  decodeTaskEvent,
  isTaskEventType,
} from "@hotflow/contracts";

import type {
  DelegationRecord,
  DelegationVerificationRequest,
  ProposalOutboxEntry,
  ProposalRecord,
  TaskNotificationRecord,
  VerificationGateRecord,
} from "./task-operations.js";
import {
  canTransitionProposalStatus,
  cloneTaskOperationsState,
  cloneTaskState,
  createInitialTaskOperationsState,
  materializeTaskOperationsState,
} from "./task-operations.js";

export type TaskJournalEntry<TEventType extends TaskJournalEventType = TaskJournalEventType> =
  TaskEventEnvelope<TEventType> & {
    readonly createdAtMs: number;
    readonly schemaVersion?: string;
  };

export type TaskJournalEventType = TaskEventType;

export function createTaskJournalEntry<TEventType extends TaskJournalEventType>(input: {
  readonly eventType: TEventType;
  readonly payload: TaskEventPayloadByType[TEventType];
  readonly createdAtMs: number;
  readonly schemaVersion?: string;
  readonly domainVersion?: TaskJournalEntry<TEventType>["domainVersion"];
}): TaskJournalEntry<TEventType> {
  const envelope = createTaskEvent({
    eventType: input.eventType,
    payload: input.payload,
    ...(input.domainVersion === undefined ? {} : { domainVersion: input.domainVersion }),
  });

  return {
    ...envelope,
    createdAtMs: input.createdAtMs,
    ...(input.schemaVersion === undefined ? {} : { schemaVersion: input.schemaVersion }),
  };
}

export function cloneTaskJournalEntry(entry: TaskJournalEntry): TaskJournalEntry {
  return createTaskJournalEntry({
    eventType: entry.eventType,
    payload: entry.payload,
    createdAtMs: entry.createdAtMs,
    ...(entry.schemaVersion === undefined ? {} : { schemaVersion: entry.schemaVersion }),
    domainVersion: entry.domainVersion,
  });
}

export function toTaskJournalEntry(input: {
  readonly eventType: string;
  readonly payload: unknown;
  readonly createdAtMs: number;
  readonly schemaVersion?: string;
  readonly domainVersion?: string;
}): TaskJournalEntry | null {
  const envelope = decodeTaskEvent({
    eventType: input.eventType,
    payload: input.payload,
    ...(input.domainVersion === undefined ? {} : { domainVersion: input.domainVersion }),
  });

  if (!envelope) {
    return null;
  }

  return {
    ...envelope,
    createdAtMs: input.createdAtMs,
    ...(input.schemaVersion === undefined ? {} : { schemaVersion: input.schemaVersion }),
  };
}

export const isTaskJournalEventType = isTaskEventType;

export function applyTaskJournalEntry(
  state: TaskState | TaskOperationsState | undefined,
  entry: TaskJournalEntry,
): TaskOperationsState {
  const current = createInitialTaskOperationsState(state);

  switch (entry.eventType) {
    case "tasks.todo_write":
      return materializeTaskOperationsState({
        ...cloneTaskOperationsState(current),
        todos: cloneTaskState(entry.payload),
        updatedAtMs: entry.payload.updatedAtMs ?? entry.createdAtMs,
      });
    case "tasks.delegation_upserted":
    case "tasks.delegation_status_set":
      return materializeTaskOperationsState({
        ...cloneTaskOperationsState(current),
        delegation: replaceRecordById(
          current.delegation,
          cloneDelegationRecord(entry.payload.record),
        ),
        updatedAtMs: entry.payload.updatedAtMs,
      });
    case "tasks.verification_upserted":
      return materializeTaskOperationsState({
        ...cloneTaskOperationsState(current),
        verification: replaceRecordById(
          current.verification,
          cloneVerificationGateRecord(entry.payload.record),
        ),
        updatedAtMs: entry.payload.updatedAtMs,
      });
    case "tasks.notification_emitted":
    case "tasks.notification_status_set":
      return materializeTaskOperationsState({
        ...cloneTaskOperationsState(current),
        notifications: replaceRecordById(
          current.notifications ?? [],
          cloneTaskNotificationRecord(entry.payload.record),
        ),
        updatedAtMs: entry.payload.updatedAtMs,
      });
    case "tasks.proposal_enqueued":
      if (current.proposalQueue.some((proposal) => proposal.id === entry.payload.proposal.id)) {
        throw new Error(`Duplicate proposal id: ${entry.payload.proposal.id}`);
      }
      return materializeTaskOperationsState({
        ...cloneTaskOperationsState(current),
        proposalQueue: [...current.proposalQueue, cloneProposalRecord(entry.payload.proposal)],
        proposalOutbox: [
          ...current.proposalOutbox,
          cloneProposalOutboxEntry(entry.payload.outboxEntry),
        ],
        updatedAtMs: entry.payload.updatedAtMs,
      });
    case "tasks.proposal_transitioned": {
      const currentProposal = current.proposalQueue.find(
        (proposal) => proposal.id === entry.payload.proposal.id,
      );
      if (!currentProposal) {
        throw new Error(`Unknown proposal: ${entry.payload.proposal.id}`);
      }
      if (!canTransitionProposalStatus(currentProposal.status, entry.payload.proposal.status)) {
        throw new Error(
          `Invalid proposal transition: ${currentProposal.status} -> ${entry.payload.proposal.status}`,
        );
      }
      return materializeTaskOperationsState({
        ...cloneTaskOperationsState(current),
        proposalQueue: replaceRecordById(
          current.proposalQueue,
          cloneProposalRecord(entry.payload.proposal),
        ),
        proposalOutbox: [
          ...current.proposalOutbox,
          cloneProposalOutboxEntry(entry.payload.outboxEntry),
        ],
        updatedAtMs: entry.payload.updatedAtMs,
      });
    }
    case "tasks.proposal_outbox_drained": {
      const drainedIds = new Set(entry.payload.drainedIds);
      const updatedAtMs = entry.payload.updatedAtMs ?? entry.payload.drainedAtMs;
      return materializeTaskOperationsState({
        ...cloneTaskOperationsState(current),
        proposalOutbox: current.proposalOutbox
          .filter((item) => !drainedIds.has(item.id))
          .map((item) => cloneProposalOutboxEntry(item)),
        ...(updatedAtMs === undefined ? {} : { updatedAtMs }),
      });
    }
    default:
      return current;
  }
}

export function projectTaskOperationsFromJournal(
  entries: readonly TaskJournalEntry[],
  initialState?: TaskState | TaskOperationsState,
): TaskOperationsState {
  return entries.reduce<TaskOperationsState>(
    (state, entry) => applyTaskJournalEntry(state, entry),
    createInitialTaskOperationsState(initialState),
  );
}

function cloneDelegationRecord(record: DelegationRecord): DelegationRecord {
  return {
    ...record,
    ...(record.verificationRequest === undefined
      ? {}
      : { verificationRequest: cloneDelegationVerificationRequest(record.verificationRequest) }),
    ...(record.observedWriteSet === undefined
      ? {}
      : { observedWriteSet: [...record.observedWriteSet] }),
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

function cloneVerificationGateRecord(record: VerificationGateRecord): VerificationGateRecord {
  return {
    ...record,
  };
}

function cloneProposalRecord(record: ProposalRecord): ProposalRecord {
  return {
    ...record,
    payload: { ...record.payload },
  };
}

function cloneProposalOutboxEntry(entry: ProposalOutboxEntry): ProposalOutboxEntry {
  return {
    ...entry,
  };
}

function cloneTaskNotificationRecord(record: TaskNotificationRecord): TaskNotificationRecord {
  return {
    ...record,
  };
}

function replaceRecordById<T extends { readonly id: string }>(
  records: readonly T[],
  nextRecord: T,
): readonly T[] {
  const existingIndex = records.findIndex((entry) => entry.id === nextRecord.id);
  if (existingIndex < 0) {
    return [...records, nextRecord];
  }

  return records.map((entry) => (entry.id === nextRecord.id ? nextRecord : entry));
}
