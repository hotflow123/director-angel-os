import {
  type DelegationClaimInput,
  type DelegationMailboxQuery,
  type NotificationMailboxQuery,
  type ProposalMailboxQuery,
  type VerifierMailboxQuery,
  type VerifierMailboxSnapshot,
  type WorkerMailboxQuery,
  type WorkerMailboxSnapshot,
  listDelegationMailbox,
  listNotificationMailbox,
  listProposalMailbox,
  readVerifierMailbox,
  readWorkerMailbox,
  selectDelegationForClaim,
} from "./mailbox.js";
import type { TaskBoard } from "./task-board.js";
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
  VerificationGateInput,
} from "./task-operations.js";

export interface TaskPlanePort {
  status(): Promise<TaskOperationsState>;
  enqueueDelegation(input: DelegationRecordInput): Promise<TaskOperationsState>;
  setDelegationStatus(input: DelegationStatusUpdate): Promise<TaskOperationsState>;
  listDelegationMailbox(query?: DelegationMailboxQuery): Promise<readonly DelegationRecord[]>;
  claimDelegation(input: DelegationClaimInput): Promise<TaskOperationsState>;
  readWorkerMailbox(query?: WorkerMailboxQuery): Promise<WorkerMailboxSnapshot>;
  readVerifierMailbox(query?: VerifierMailboxQuery): Promise<VerifierMailboxSnapshot>;
  listNotifications(query?: NotificationMailboxQuery): Promise<readonly TaskNotificationRecord[]>;
  upsertVerification(input: VerificationGateInput): Promise<TaskOperationsState>;
  enqueueProposal(input: ProposalQueueInput): Promise<TaskOperationsState>;
  transitionProposal(input: ProposalStatusTransition): Promise<TaskOperationsState>;
  getProposal(proposalId: string): Promise<ProposalRecord | null>;
  applyProposal(proposalId: string): Promise<TaskOperationsState>;
  drainProposalOutbox(limit?: number): Promise<readonly ProposalOutboxEntry[]>;
  listProposals(query?: ProposalMailboxQuery): Promise<readonly ProposalRecord[]>;
}

export class TaskBoardTaskPlanePort implements TaskPlanePort {
  public constructor(private readonly board: TaskBoard) {}

  public async status(): Promise<TaskOperationsState> {
    return this.board.snapshotOperations();
  }

  public async enqueueDelegation(input: DelegationRecordInput): Promise<TaskOperationsState> {
    return this.board.upsertDelegation(input);
  }

  public async setDelegationStatus(input: DelegationStatusUpdate): Promise<TaskOperationsState> {
    return this.board.setDelegationStatus(input);
  }

  public async listDelegationMailbox(
    query: DelegationMailboxQuery = {},
  ): Promise<readonly DelegationRecord[]> {
    return listDelegationMailbox(this.board.snapshotOperations(), query);
  }

  public async claimDelegation(input: DelegationClaimInput): Promise<TaskOperationsState> {
    selectDelegationForClaim(this.board.snapshotOperations(), input);
    return this.board.setDelegationStatus({
      id: input.id,
      status: "running",
    });
  }

  public async readWorkerMailbox(query: WorkerMailboxQuery = {}): Promise<WorkerMailboxSnapshot> {
    return readWorkerMailbox(this.board.snapshotOperations(), query);
  }

  public async readVerifierMailbox(
    query: VerifierMailboxQuery = {},
  ): Promise<VerifierMailboxSnapshot> {
    return readVerifierMailbox(this.board.snapshotOperations(), query);
  }

  public async listNotifications(
    query: NotificationMailboxQuery = {},
  ): Promise<readonly TaskNotificationRecord[]> {
    return listNotificationMailbox(this.board.snapshotOperations(), query);
  }

  public async upsertVerification(input: VerificationGateInput): Promise<TaskOperationsState> {
    return this.board.upsertVerification(input);
  }

  public async enqueueProposal(input: ProposalQueueInput): Promise<TaskOperationsState> {
    return this.board.enqueueProposal(input);
  }

  public async transitionProposal(input: ProposalStatusTransition): Promise<TaskOperationsState> {
    return this.board.transitionProposal(input);
  }

  public async getProposal(proposalId: string): Promise<ProposalRecord | null> {
    return this.board.getProposal(proposalId);
  }

  public async applyProposal(proposalId: string): Promise<TaskOperationsState> {
    return this.board.applyProposal(proposalId);
  }

  public async drainProposalOutbox(limit?: number): Promise<readonly ProposalOutboxEntry[]> {
    return this.board.drainProposalOutbox(limit);
  }

  public async listProposals(query: ProposalMailboxQuery = {}): Promise<readonly ProposalRecord[]> {
    return listProposalMailbox(this.board.snapshotOperations(), query);
  }
}
