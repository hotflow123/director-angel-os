import {
  CONTRACTS_SCHEMA_VERSION,
  type TaskItem,
  type TaskState,
  decodeTaskEvent,
} from "@hotflow/contracts";

import {
  type TaskJournalEntry,
  cloneTaskJournalEntry,
  createTaskJournalEntry,
} from "./task-journal.js";
import type {
  DelegationRecord,
  DelegationRecordInput,
  DelegationStatusUpdate,
  ProposalOutboxEntry,
  ProposalQueueInput,
  ProposalRecord,
  ProposalStatusTransition,
  TaskNotificationRecord,
  TaskOperationsState,
  VerificationCheck,
  VerificationGateInput,
  VerificationGateRecord,
  VerificationVerdict,
} from "./task-operations.js";
import {
  canTransitionProposalStatus,
  cloneTaskOperationsState,
  cloneTaskState,
  createInitialTaskOperationsState,
  materializeTaskOperationsState,
} from "./task-operations.js";

interface TaskBoardOptions {
  readonly now?: () => number;
  readonly outboxEntryIdFactory?: (input: {
    readonly eventType: ProposalOutboxEntry["eventType"];
    readonly proposalId: string;
    readonly status: ProposalOutboxEntry["status"];
    readonly createdAtMs: number;
    readonly existingEntryIds: readonly string[];
  }) => string;
}

export class TaskBoard {
  private readonly now: () => number;
  private readonly outboxEntryIdFactory: NonNullable<TaskBoardOptions["outboxEntryIdFactory"]>;
  private state: TaskOperationsState;
  private readonly taskJournalQueue: TaskJournalEntry[] = [];

  public constructor(
    state: TaskState | TaskOperationsState = { items: [] },
    options: TaskBoardOptions = {},
  ) {
    this.state = createInitialTaskOperationsState(state);
    this.now = options.now ?? (() => Date.now());
    this.outboxEntryIdFactory = options.outboxEntryIdFactory ?? defaultOutboxEntryIdFactory;
  }

  public snapshot(): TaskState {
    return cloneTaskState(this.state.todos);
  }

  public snapshotOperations(): TaskOperationsState {
    return cloneTaskOperationsState(this.state);
  }

  public snapshotJournal(): readonly TaskJournalEntry[] {
    return this.taskJournalQueue.map((entry) => cloneTaskJournalEntry(entry));
  }

  public drainJournal(limit?: number): readonly TaskJournalEntry[] {
    const max = limit ?? this.taskJournalQueue.length;
    if (max <= 0 || this.taskJournalQueue.length === 0) {
      return [];
    }
    const drained = this.taskJournalQueue.slice(0, max);
    this.taskJournalQueue.splice(0, drained.length);
    return drained.map((entry) => cloneTaskJournalEntry(entry));
  }

  public writeTodos(items: readonly TaskItem[]): TaskState {
    const timestamp = this.now();
    const todos: TaskState = {
      items: cloneItems(items),
      updatedAtMs: timestamp,
    };
    this.state = materializeTaskOperationsState({
      ...this.state,
      todos,
      updatedAtMs: timestamp,
    });
    this.recordJournalEntry(
      createTaskJournalEntry({
        eventType: "tasks.todo_write",
        payload: todos,
        createdAtMs: timestamp,
      }),
    );
    return this.snapshot();
  }

  public upsertDelegation(input: DelegationRecordInput): TaskOperationsState {
    const timestamp = this.now();
    const current = this.state.delegation.find((entry) => entry.id === input.id);
    const next = buildDelegationRecord(input, current, timestamp);
    const notificationUpdate = updateDelegationNotifications(
      this.state.notifications ?? [],
      next,
      timestamp,
    );
    this.state = materializeTaskOperationsState({
      ...this.state,
      delegation: replaceRecordById(this.state.delegation, next),
      notifications: notificationUpdate.notifications,
      updatedAtMs: timestamp,
    });
    this.recordJournalEntry(
      createTaskJournalEntry({
        eventType: "tasks.delegation_upserted",
        payload: {
          record: next,
          updatedAtMs: timestamp,
        },
        createdAtMs: timestamp,
      }),
    );
    this.recordNotificationEvents(notificationUpdate.events);
    return this.snapshotOperations();
  }

  public setDelegationStatus(input: DelegationStatusUpdate): TaskOperationsState {
    const current = this.state.delegation.find((entry) => entry.id === input.id);
    if (!current) {
      throw new Error(`Unknown delegation record: ${input.id}`);
    }

    const timestamp = this.now();
    const error = input.error;
    const reason = input.reason;
    const resultSummary = input.resultSummary;
    const observedWriteSet =
      input.observedWriteSet === undefined
        ? current.observedWriteSet
        : normalizeWriteSet(input.observedWriteSet);
    const observedWriteSetSource = input.observedWriteSetSource ?? current.observedWriteSetSource;
    const completedAtMs =
      input.status === "completed" || input.status === "failed" || input.status === "cancelled"
        ? timestamp
        : undefined;

    const next: DelegationRecord = {
      ...current,
      status: input.status,
      updatedAtMs: timestamp,
      ...(resultSummary === undefined ? {} : { resultSummary }),
      ...(observedWriteSet === undefined ? {} : { observedWriteSet }),
      ...(observedWriteSetSource === undefined ? {} : { observedWriteSetSource }),
      ...(completedAtMs === undefined ? {} : { completedAtMs }),
      ...(error === undefined ? {} : { error }),
    };

    const notificationUpdate = updateDelegationNotifications(
      this.state.notifications ?? [],
      next,
      timestamp,
      reason,
    );
    this.state = materializeTaskOperationsState({
      ...this.state,
      delegation: replaceRecordById(this.state.delegation, next),
      notifications: notificationUpdate.notifications,
      updatedAtMs: timestamp,
    });
    this.recordJournalEntry(
      createTaskJournalEntry({
        eventType: "tasks.delegation_status_set",
        payload: {
          record: next,
          updatedAtMs: timestamp,
          fromStatus: current.status,
          toStatus: input.status,
          ...(reason === undefined ? {} : { reason }),
        },
        createdAtMs: timestamp,
      }),
    );
    this.recordNotificationEvents(notificationUpdate.events);
    return this.snapshotOperations();
  }

  public upsertVerification(input: VerificationGateInput): TaskOperationsState {
    const timestamp = this.now();
    const current = this.state.verification.find((entry) => entry.id === input.id);
    const status = input.status ?? current?.status ?? "pending";
    const taskId = input.taskId ?? current?.taskId;
    const verifiedBy =
      input.verifiedBy ??
      current?.verifiedBy ??
      (status === "pending" ? undefined : input.verifierId);
    const verdict = input.verdict ?? current?.verdict ?? inferVerificationVerdict(status);
    const verdictSummary = input.verdictSummary ?? current?.verdictSummary;
    const checks =
      input.checks === undefined ? current?.checks : cloneVerificationChecks(input.checks);

    const next: VerificationGateRecord = {
      id: input.id,
      verifierId: input.verifierId,
      requirement: input.requirement,
      status,
      createdAtMs: current?.createdAtMs ?? timestamp,
      updatedAtMs: timestamp,
      ...(taskId === undefined ? {} : { taskId }),
      ...(verifiedBy === undefined ? {} : { verifiedBy }),
      ...(verdict === undefined ? {} : { verdict }),
      ...(verdictSummary === undefined ? {} : { verdictSummary }),
      ...(checks === undefined ? {} : { checks }),
    };

    const notificationUpdate = updateVerificationNotifications(
      this.state.notifications ?? [],
      next,
      timestamp,
    );
    this.state = materializeTaskOperationsState({
      ...this.state,
      verification: replaceRecordById(this.state.verification, next),
      notifications: notificationUpdate.notifications,
      updatedAtMs: timestamp,
    });
    this.recordJournalEntry(
      createTaskJournalEntry({
        eventType: "tasks.verification_upserted",
        payload: {
          record: next,
          updatedAtMs: timestamp,
        },
        createdAtMs: timestamp,
      }),
    );
    this.recordNotificationEvents(notificationUpdate.events);
    return this.snapshotOperations();
  }

  public enqueueProposal(input: ProposalQueueInput): TaskOperationsState {
    if (this.state.proposalQueue.some((proposal) => proposal.id === input.id)) {
      throw new Error(`Duplicate proposal id: ${input.id}`);
    }

    const timestamp = this.now();
    const expiresAt = input.expiresAtMs;
    const next: ProposalRecord = {
      id: input.id,
      kind: input.kind,
      payload: { ...input.payload },
      status: "pending",
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      sourceSessionId: input.sourceSessionId,
      sourceTurnId: input.sourceTurnId,
      provenance: input.provenance,
      createdAtMs: timestamp,
      updatedAtMs: timestamp,
      ...(expiresAt === undefined ? {} : { expiresAtMs: expiresAt }),
    };
    const outboxEntry = this.createOutboxEntry("proposal.enqueued", input.id, "pending", timestamp);

    this.state = materializeTaskOperationsState({
      ...this.state,
      proposalQueue: [...this.state.proposalQueue, next],
      proposalOutbox: [...this.state.proposalOutbox, outboxEntry],
      updatedAtMs: timestamp,
    });
    this.recordJournalEntry(
      createTaskJournalEntry({
        eventType: "tasks.proposal_enqueued",
        payload: {
          proposal: next,
          outboxEntry,
          updatedAtMs: timestamp,
        },
        createdAtMs: timestamp,
      }),
    );
    return this.snapshotOperations();
  }

  public transitionProposal(input: ProposalStatusTransition): TaskOperationsState {
    const current = this.state.proposalQueue.find((proposal) => proposal.id === input.proposalId);
    if (!current) {
      throw new Error(`Unknown proposal: ${input.proposalId}`);
    }

    if (!canTransitionProposalStatus(current.status, input.status)) {
      throw new Error(`Invalid proposal transition: ${current.status} -> ${input.status}`);
    }

    if (current.status === input.status) {
      return this.snapshotOperations();
    }

    const timestamp = this.now();
    const note = input.decisionNote;
    const next: ProposalRecord = {
      ...current,
      status: input.status,
      updatedAtMs: timestamp,
      ...(note === undefined ? {} : { decisionNote: note }),
    };
    const outboxEntry = this.createOutboxEntry(
      "proposal.status_changed",
      input.proposalId,
      input.status,
      timestamp,
    );

    this.state = materializeTaskOperationsState({
      ...this.state,
      proposalQueue: replaceRecordById(this.state.proposalQueue, next),
      proposalOutbox: [...this.state.proposalOutbox, outboxEntry],
      updatedAtMs: timestamp,
    });
    this.recordJournalEntry(
      createTaskJournalEntry({
        eventType: "tasks.proposal_transitioned",
        payload: {
          proposal: next,
          outboxEntry,
          updatedAtMs: timestamp,
          fromStatus: current.status,
          toStatus: input.status,
        },
        createdAtMs: timestamp,
      }),
    );
    return this.snapshotOperations();
  }

  public getProposal(proposalId: string): ProposalRecord | null {
    return (
      this.snapshotOperations().proposalQueue.find((proposal) => proposal.id === proposalId) ?? null
    );
  }

  public applyProposal(proposalId: string): TaskOperationsState {
    const proposal = this.state.proposalQueue.find((entry) => entry.id === proposalId);
    if (!proposal) {
      throw new Error(`Unknown proposal: ${proposalId}`);
    }
    if (proposal.status !== "accepted") {
      throw new Error(`Proposal must be accepted before apply: ${proposalId}`);
    }
    if (proposal.kind !== "tasks.todo_write") {
      throw new Error(`Unsupported proposal kind for safe apply: ${proposal.kind}`);
    }

    const decoded = decodeTaskEvent({
      eventType: "tasks.todo_write",
      payload: proposal.payload,
    });
    if (!decoded || decoded.eventType !== "tasks.todo_write") {
      throw new Error(`Invalid tasks.todo_write proposal payload: ${proposalId}`);
    }

    this.writeTodos(decoded.payload.items);
    return this.transitionProposal({
      proposalId,
      status: "applied",
    });
  }

  public drainProposalOutbox(limit?: number): readonly ProposalOutboxEntry[] {
    const max = limit ?? this.state.proposalOutbox.length;
    if (max <= 0 || this.state.proposalOutbox.length === 0) {
      return [];
    }

    const drained = this.state.proposalOutbox.slice(0, max);
    const timestamp = this.now();
    this.state = materializeTaskOperationsState({
      ...this.state,
      proposalOutbox: this.state.proposalOutbox.slice(drained.length),
      updatedAtMs: timestamp,
    });
    this.recordJournalEntry(
      createTaskJournalEntry({
        eventType: "tasks.proposal_outbox_drained",
        payload: {
          drainedIds: drained.map((entry) => entry.id),
          drainedAtMs: timestamp,
          updatedAtMs: timestamp,
        },
        createdAtMs: timestamp,
      }),
    );
    return drained.map((entry) => ({ ...entry }));
  }

  public answerFirstStep(): string | null {
    return this.state.todos.items[0]?.content ?? null;
  }

  private createOutboxEntry(
    eventType: ProposalOutboxEntry["eventType"],
    proposalId: string,
    status: ProposalOutboxEntry["status"],
    timestamp: number,
  ): ProposalOutboxEntry {
    const id = buildStableOutboxEntryId(
      this.outboxEntryIdFactory({
        eventType,
        proposalId,
        status,
        createdAtMs: timestamp,
        existingEntryIds: this.state.proposalOutbox.map((entry) => entry.id),
      }),
      this.state.proposalOutbox,
    );
    return {
      id,
      eventType,
      proposalId,
      status,
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      createdAtMs: timestamp,
    };
  }

  private recordJournalEntry(entry: TaskJournalEntry): void {
    this.taskJournalQueue.push(cloneTaskJournalEntry(entry));
  }

  private recordNotificationEvents(events: readonly TaskJournalEntry[]): void {
    for (const event of events) {
      this.recordJournalEntry(event);
    }
  }
}

function updateDelegationNotifications(
  notifications: readonly TaskNotificationRecord[],
  next: DelegationRecord,
  timestamp: number,
  reason?: string,
): {
  readonly notifications: readonly TaskNotificationRecord[];
  readonly events: readonly TaskJournalEntry[];
} {
  const notificationId = buildDelegationNotificationId(next.id);
  const existing = notifications.find((entry) => entry.id === notificationId);

  if (next.status === "queued") {
    const record: TaskNotificationRecord = {
      id: notificationId,
      kind: "delegation_assigned",
      recipientKind: "worker",
      recipientId: next.workerId,
      status: "pending",
      summary: `Delegation ${next.id} is queued for worker ${next.workerId}.`,
      createdAtMs: existing?.createdAtMs ?? timestamp,
      updatedAtMs: timestamp,
      ...(next.taskId === undefined ? {} : { taskId: next.taskId }),
      delegationId: next.id,
    };

    const emitted = createTaskJournalEntry({
      eventType: "tasks.notification_emitted",
      payload: {
        record,
        updatedAtMs: timestamp,
      },
      createdAtMs: timestamp,
    });

    return {
      notifications: replaceRecordById(notifications, record),
      events:
        existing &&
        existing.status === "pending" &&
        existing.recipientId === record.recipientId &&
        existing.summary === record.summary
          ? []
          : [emitted],
    };
  }

  if (!existing || existing.status === "acknowledged") {
    return {
      notifications,
      events: [],
    };
  }

  const acknowledged: TaskNotificationRecord = {
    ...existing,
    status: "acknowledged",
    updatedAtMs: timestamp,
    acknowledgedAtMs: timestamp,
  };

  return {
    notifications: replaceRecordById(notifications, acknowledged),
    events: [
      createTaskJournalEntry({
        eventType: "tasks.notification_status_set",
        payload: {
          record: acknowledged,
          updatedAtMs: timestamp,
          fromStatus: existing.status,
          toStatus: "acknowledged",
          reason:
            reason ??
            (next.status === "running" ? "delegation_claimed" : `delegation_status_${next.status}`),
        },
        createdAtMs: timestamp,
      }),
    ],
  };
}

function updateVerificationNotifications(
  notifications: readonly TaskNotificationRecord[],
  next: VerificationGateRecord,
  timestamp: number,
): {
  readonly notifications: readonly TaskNotificationRecord[];
  readonly events: readonly TaskJournalEntry[];
} {
  const notificationId = buildVerificationNotificationId(next.id);
  const existing = notifications.find((entry) => entry.id === notificationId);

  if (next.status === "pending") {
    const record: TaskNotificationRecord = {
      id: notificationId,
      kind: "verification_requested",
      recipientKind: "verifier",
      recipientId: next.verifierId,
      status: "pending",
      summary: `Verification ${next.id} is pending for verifier ${next.verifierId}.`,
      createdAtMs: existing?.createdAtMs ?? timestamp,
      updatedAtMs: timestamp,
      ...(next.taskId === undefined ? {} : { taskId: next.taskId }),
      verificationId: next.id,
    };

    const emitted = createTaskJournalEntry({
      eventType: "tasks.notification_emitted",
      payload: {
        record,
        updatedAtMs: timestamp,
      },
      createdAtMs: timestamp,
    });

    return {
      notifications: replaceRecordById(notifications, record),
      events:
        existing &&
        existing.status === "pending" &&
        existing.recipientId === record.recipientId &&
        existing.summary === record.summary
          ? []
          : [emitted],
    };
  }

  if (!existing || existing.status === "acknowledged") {
    return {
      notifications,
      events: [],
    };
  }

  const acknowledged: TaskNotificationRecord = {
    ...existing,
    status: "acknowledged",
    updatedAtMs: timestamp,
    acknowledgedAtMs: timestamp,
  };

  return {
    notifications: replaceRecordById(notifications, acknowledged),
    events: [
      createTaskJournalEntry({
        eventType: "tasks.notification_status_set",
        payload: {
          record: acknowledged,
          updatedAtMs: timestamp,
          fromStatus: existing.status,
          toStatus: "acknowledged",
          reason: `verification_status_${next.status}`,
        },
        createdAtMs: timestamp,
      }),
    ],
  };
}

function buildDelegationNotificationId(delegationId: string): string {
  return `notification_delegation_${delegationId}`;
}

function buildVerificationNotificationId(verificationId: string): string {
  return `notification_verification_${verificationId}`;
}

function defaultOutboxEntryIdFactory(input: {
  readonly eventType: ProposalOutboxEntry["eventType"];
  readonly proposalId: string;
  readonly status: ProposalOutboxEntry["status"];
  readonly createdAtMs: number;
}): string {
  const normalizedEventType = input.eventType.replace(/[^a-z0-9_]+/giu, "_");
  const normalizedProposalId = input.proposalId.replace(/[^a-z0-9_]+/giu, "_");
  const normalizedStatus = input.status.replace(/[^a-z0-9_]+/giu, "_");
  return `outbox_${normalizedEventType}_${normalizedProposalId}_${normalizedStatus}_${input.createdAtMs}`;
}

function buildStableOutboxEntryId(
  preferredId: string,
  existing: readonly ProposalOutboxEntry[],
): string {
  if (!existing.some((entry) => entry.id === preferredId)) {
    return preferredId;
  }

  const duplicates = existing.filter(
    (entry) => entry.id === preferredId || entry.id.startsWith(`${preferredId}_dup_`),
  );
  const nextSuffix = duplicates.length + 1;
  return `${preferredId}_dup_${nextSuffix}`;
}

function cloneItems(items: readonly TaskItem[]): TaskItem[] {
  return items.map((item) => ({ ...item }));
}

function inferVerificationVerdict(
  status: VerificationGateRecord["status"],
): VerificationVerdict | undefined {
  if (status === "passed") {
    return "pass";
  }
  if (status === "failed") {
    return "fail";
  }
  if (status === "partial") {
    return "partial";
  }
  return undefined;
}

function cloneVerificationChecks(checks: readonly VerificationCheck[]): VerificationCheck[] {
  return checks.map((check) => ({
    id: check.id,
    status: check.status,
    summary: check.summary,
    ...(check.detail === undefined ? {} : { detail: check.detail }),
  }));
}

function buildDelegationRecord(
  input: DelegationRecordInput,
  current: DelegationRecord | undefined,
  timestamp: number,
): DelegationRecord {
  const status = input.status ?? current?.status ?? "queued";
  const taskId = input.taskId;
  const fromAgent = input.fromAgent ?? current?.fromAgent;
  const contextSnapshot = input.contextSnapshot ?? current?.contextSnapshot;
  const specialization = input.specialization ?? current?.specialization;
  const targetAgent = input.targetAgent ?? current?.targetAgent;
  const verificationRequest = input.verificationRequest ?? current?.verificationRequest;
  const resultSummary = input.resultSummary ?? current?.resultSummary;
  const observedWriteSet =
    input.observedWriteSet === undefined
      ? current?.observedWriteSet
      : normalizeWriteSet(input.observedWriteSet);
  const observedWriteSetSource = input.observedWriteSetSource ?? current?.observedWriteSetSource;
  const error = input.error;
  const completedAtMs =
    status === "completed" || status === "failed" || status === "cancelled" ? timestamp : undefined;

  if (targetAgent !== undefined && specialization === undefined) {
    throw new Error("Delegation targetAgent requires specialization.");
  }

  return {
    id: input.id,
    workerId: input.workerId,
    instruction: input.instruction,
    status,
    createdAtMs: current?.createdAtMs ?? timestamp,
    updatedAtMs: timestamp,
    ...(taskId === undefined ? {} : { taskId }),
    ...(fromAgent === undefined ? {} : { fromAgent }),
    ...(contextSnapshot === undefined ? {} : { contextSnapshot }),
    ...(specialization === undefined ? {} : { specialization }),
    ...(targetAgent === undefined ? {} : { targetAgent }),
    ...(verificationRequest === undefined
      ? {}
      : { verificationRequest: cloneDelegationVerificationRequest(verificationRequest) }),
    ...(resultSummary === undefined ? {} : { resultSummary }),
    ...(observedWriteSet === undefined ? {} : { observedWriteSet }),
    ...(observedWriteSetSource === undefined ? {} : { observedWriteSetSource }),
    ...(completedAtMs === undefined ? {} : { completedAtMs }),
    ...(error === undefined ? {} : { error }),
  };
}

function cloneDelegationVerificationRequest(
  request: NonNullable<DelegationRecord["verificationRequest"]>,
): NonNullable<DelegationRecord["verificationRequest"]> {
  return {
    verifierId: request.verifierId,
    requirement: request.requirement,
    ...(request.verificationId === undefined ? {} : { verificationId: request.verificationId }),
  };
}

function normalizeWriteSet(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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
