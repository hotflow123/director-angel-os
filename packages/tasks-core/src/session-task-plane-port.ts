import { decodeTaskEvent, isTaskEventType } from "@hotflow/contracts";
import type {
  CheckpointRecord,
  JournalEntry,
  JsonValue,
  SessionRecord,
  SessionStore,
} from "@hotflow/sessions";

import {
  type DelegationClaimInput,
  type DelegationMailboxQuery,
  type NotificationMailboxQuery,
  type ProposalMailboxQuery,
  type VerificationMailboxQuery,
  type VerifierMailboxQuery,
  type VerifierMailboxSnapshot,
  type WorkerMailboxQuery,
  type WorkerMailboxSnapshot,
  listDelegationMailbox,
  listNotificationMailbox,
  listProposalMailbox,
  listVerificationMailbox,
  readVerifierMailbox,
  readWorkerMailbox,
  selectDelegationForClaim,
} from "./mailbox.js";
import { TaskBoard } from "./task-board.js";
import {
  type TaskJournalEntry,
  projectTaskOperationsFromJournal,
  toTaskJournalEntry,
} from "./task-journal.js";
import type {
  DelegationRecord,
  ProposalOutboxEntry,
  ProposalRecord,
  TaskNotificationRecord,
  TaskOperationsState,
  VerificationGateRecord,
} from "./task-operations.js";
import type { TaskPlanePort } from "./task-plane-port.js";

export type SessionTaskStore = Pick<
  SessionStore,
  "appendJournal" | "createSession" | "getLatestTurnId" | "getSession"
> & {
  readonly checkpoints: Pick<SessionStore["checkpoints"], "latest">;
  readonly journal: Pick<SessionStore["journal"], "list">;
};

export interface SessionTaskAccessOptions {
  readonly createIfMissing?: boolean;
}

export interface CommittedSessionTaskSnapshot {
  readonly session: SessionRecord;
  readonly checkpoint: CheckpointRecord | null;
  readonly latestTurnId: string | null;
  readonly journal: readonly JournalEntry[];
  readonly taskJournal: readonly TaskJournalEntry[];
  readonly taskState: TaskOperationsState;
}

export function readSessionTaskJournal(
  sessionStore: SessionTaskStore,
  sessionId: string,
  options: SessionTaskAccessOptions = {},
): readonly TaskJournalEntry[] {
  const session = ensureSession(sessionStore, sessionId, options);
  return sessionStore.journal
    .list(session.sessionId)
    .map((entry) =>
      toTaskJournalEntry({
        eventType: entry.eventType,
        payload: normalizeTaskEventPayload(entry.eventType, entry.payload),
        createdAtMs: entry.createdAtMs,
        schemaVersion: entry.schemaVersion,
      }),
    )
    .filter((entry): entry is TaskJournalEntry => entry !== null);
}

export function projectSessionTaskState(
  sessionStore: SessionTaskStore,
  sessionId: string,
  options: SessionTaskAccessOptions = {},
): TaskOperationsState {
  return projectTaskOperationsFromJournal(readSessionTaskJournal(sessionStore, sessionId, options));
}

export function readSessionDelegationMailbox(
  sessionStore: SessionTaskStore,
  sessionId: string,
  query: DelegationMailboxQuery = {},
  options: SessionTaskAccessOptions = {},
): readonly DelegationRecord[] {
  return listDelegationMailbox(projectSessionTaskState(sessionStore, sessionId, options), query);
}

export function readSessionVerificationMailbox(
  sessionStore: SessionTaskStore,
  sessionId: string,
  query: VerificationMailboxQuery = {},
  options: SessionTaskAccessOptions = {},
): readonly VerificationGateRecord[] {
  return listVerificationMailbox(projectSessionTaskState(sessionStore, sessionId, options), query);
}

export function readSessionProposalMailbox(
  sessionStore: SessionTaskStore,
  sessionId: string,
  query: ProposalMailboxQuery = {},
  options: SessionTaskAccessOptions = {},
): readonly ProposalRecord[] {
  return listProposalMailbox(projectSessionTaskState(sessionStore, sessionId, options), query);
}

export function readSessionNotificationMailbox(
  sessionStore: SessionTaskStore,
  sessionId: string,
  query: NotificationMailboxQuery = {},
  options: SessionTaskAccessOptions = {},
): readonly TaskNotificationRecord[] {
  return listNotificationMailbox(projectSessionTaskState(sessionStore, sessionId, options), query);
}

export function readSessionWorkerMailbox(
  sessionStore: SessionTaskStore,
  sessionId: string,
  query: WorkerMailboxQuery = {},
  options: SessionTaskAccessOptions = {},
): WorkerMailboxSnapshot {
  return readWorkerMailbox(projectSessionTaskState(sessionStore, sessionId, options), query);
}

export function readSessionVerifierMailbox(
  sessionStore: SessionTaskStore,
  sessionId: string,
  query: VerifierMailboxQuery = {},
  options: SessionTaskAccessOptions = {},
): VerifierMailboxSnapshot {
  return readVerifierMailbox(projectSessionTaskState(sessionStore, sessionId, options), query);
}

export function mutateSessionTaskState(
  sessionStore: SessionTaskStore,
  sessionId: string,
  mutate: (board: TaskBoard) => void,
  options: SessionTaskAccessOptions = {},
): TaskOperationsState {
  const session = ensureSession(sessionStore, sessionId, options);
  const current = projectSessionTaskState(sessionStore, session.sessionId, {
    createIfMissing: false,
  });
  const board = new TaskBoard(current);
  mutate(board);

  for (const entry of board.drainJournal()) {
    sessionStore.appendJournal(session.sessionId, {
      eventType: entry.eventType,
      payload: normalizeTaskEventPayload(entry.eventType, entry.payload) as never,
      createdAtMs: entry.createdAtMs,
    });
  }

  return board.snapshotOperations();
}

export function readCommittedSessionTaskSnapshot(
  sessionStore: SessionTaskStore,
  sessionId: string,
): CommittedSessionTaskSnapshot {
  const session = ensureSession(sessionStore, sessionId, {
    createIfMissing: false,
  });
  const journal = sessionStore.journal.list(session.sessionId);
  const taskJournal = journal
    .map((entry) =>
      toTaskJournalEntry({
        eventType: entry.eventType,
        payload: normalizeTaskEventPayload(entry.eventType, entry.payload),
        createdAtMs: entry.createdAtMs,
        schemaVersion: entry.schemaVersion,
      }),
    )
    .filter((entry): entry is TaskJournalEntry => entry !== null);

  return {
    session: cloneSessionRecord(session),
    checkpoint: cloneCheckpointRecord(sessionStore.checkpoints.latest(session.sessionId)),
    latestTurnId: sessionStore.getLatestTurnId(session.sessionId),
    journal: journal.map((entry) => cloneJournalEntry(entry)),
    taskJournal,
    taskState: projectTaskOperationsFromJournal(taskJournal),
  };
}

export class SessionStoreTaskPlanePort implements TaskPlanePort {
  public constructor(
    private readonly sessionStore: SessionTaskStore,
    private readonly sessionId: string,
    private readonly options: SessionTaskAccessOptions = {},
  ) {}

  public async status(): Promise<TaskOperationsState> {
    return projectSessionTaskState(this.sessionStore, this.sessionId, this.options);
  }

  public async enqueueDelegation(
    input: import("./task-operations.js").DelegationRecordInput,
  ): Promise<TaskOperationsState> {
    return mutateSessionTaskState(
      this.sessionStore,
      this.sessionId,
      (board) => {
        board.upsertDelegation(input);
      },
      this.options,
    );
  }

  public async setDelegationStatus(
    input: import("./task-operations.js").DelegationStatusUpdate,
  ): Promise<TaskOperationsState> {
    return mutateSessionTaskState(
      this.sessionStore,
      this.sessionId,
      (board) => {
        board.setDelegationStatus(input);
      },
      this.options,
    );
  }

  public async listDelegationMailbox(
    query: DelegationMailboxQuery = {},
  ): Promise<readonly DelegationRecord[]> {
    return readSessionDelegationMailbox(this.sessionStore, this.sessionId, query, this.options);
  }

  public async claimDelegation(input: DelegationClaimInput): Promise<TaskOperationsState> {
    return mutateSessionTaskState(
      this.sessionStore,
      this.sessionId,
      (board) => {
        selectDelegationForClaim(board.snapshotOperations(), input);
        board.setDelegationStatus({
          id: input.id,
          status: "running",
        });
      },
      this.options,
    );
  }

  public async readWorkerMailbox(query: WorkerMailboxQuery = {}): Promise<WorkerMailboxSnapshot> {
    return readSessionWorkerMailbox(this.sessionStore, this.sessionId, query, this.options);
  }

  public async readVerifierMailbox(
    query: VerifierMailboxQuery = {},
  ): Promise<VerifierMailboxSnapshot> {
    return readSessionVerifierMailbox(this.sessionStore, this.sessionId, query, this.options);
  }

  public async listNotifications(
    query: NotificationMailboxQuery = {},
  ): Promise<readonly TaskNotificationRecord[]> {
    return readSessionNotificationMailbox(this.sessionStore, this.sessionId, query, this.options);
  }

  public async upsertVerification(
    input: import("./task-operations.js").VerificationGateInput,
  ): Promise<TaskOperationsState> {
    return mutateSessionTaskState(
      this.sessionStore,
      this.sessionId,
      (board) => {
        board.upsertVerification(input);
      },
      this.options,
    );
  }

  public async enqueueProposal(
    input: import("./task-operations.js").ProposalQueueInput,
  ): Promise<TaskOperationsState> {
    return mutateSessionTaskState(
      this.sessionStore,
      this.sessionId,
      (board) => {
        board.enqueueProposal(input);
      },
      this.options,
    );
  }

  public async transitionProposal(
    input: import("./task-operations.js").ProposalStatusTransition,
  ): Promise<TaskOperationsState> {
    return mutateSessionTaskState(
      this.sessionStore,
      this.sessionId,
      (board) => {
        board.transitionProposal({
          proposalId: input.proposalId,
          status: input.status,
          ...(input.decisionNote === undefined ? {} : { decisionNote: input.decisionNote }),
        });
      },
      this.options,
    );
  }

  public async getProposal(proposalId: string): Promise<ProposalRecord | null> {
    return (
      projectSessionTaskState(this.sessionStore, this.sessionId, this.options).proposalQueue.find(
        (proposal) => proposal.id === proposalId,
      ) ?? null
    );
  }

  public async applyProposal(proposalId: string): Promise<TaskOperationsState> {
    return mutateSessionTaskState(
      this.sessionStore,
      this.sessionId,
      (board) => {
        board.applyProposal(proposalId);
      },
      this.options,
    );
  }

  public async drainProposalOutbox(limit?: number): Promise<readonly ProposalOutboxEntry[]> {
    let drained: readonly ProposalOutboxEntry[] = [];
    mutateSessionTaskState(
      this.sessionStore,
      this.sessionId,
      (board) => {
        drained = board.drainProposalOutbox(limit);
      },
      this.options,
    );
    return drained;
  }

  public async listProposals(query: ProposalMailboxQuery = {}): Promise<readonly ProposalRecord[]> {
    return readSessionProposalMailbox(this.sessionStore, this.sessionId, query, this.options);
  }
}

function ensureSession(
  sessionStore: SessionTaskStore,
  sessionId: string,
  options: SessionTaskAccessOptions,
): SessionRecord {
  const session = sessionStore.getSession(sessionId);
  if (session) {
    return session;
  }
  if (options.createIfMissing ?? true) {
    return sessionStore.createSession({ sessionId });
  }
  throw new Error(`Unknown session: ${sessionId}`);
}

function normalizeTaskEventPayload(eventType: string, payload: unknown): unknown {
  if (!isTaskEventType(eventType)) {
    return payload;
  }
  return decodeTaskEvent({ eventType, payload })?.payload ?? payload;
}

function cloneSessionRecord(session: SessionRecord): SessionRecord {
  return {
    ...session,
    metadata: structuredClone(session.metadata),
  };
}

function cloneCheckpointRecord(checkpoint: CheckpointRecord | null): CheckpointRecord | null {
  if (!checkpoint) {
    return null;
  }
  return structuredClone(checkpoint);
}

function cloneJournalEntry(entry: JournalEntry): JournalEntry {
  return structuredClone(entry as JournalEntry<JsonValue>);
}
