import type { ContractsSchemaVersion } from "./schema-version.js";
import type { TaskItemStatus, TaskState } from "./task.js";

export type DelegationStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type DelegationSpecialization = "explore" | "plan" | "verify" | "general";
export type DelegationObservedWriteSetSource = "patch" | "diff" | "artifact";
export type VerificationStatus = "pending" | "passed" | "failed" | "partial";
export type VerificationVerdict = "pass" | "fail" | "partial";
export type VerificationCheckStatus = VerificationVerdict;
export type ProposalStatus = "pending" | "accepted" | "rejected" | "applied" | "expired";
export type ProposalOutboxEventType = "proposal.enqueued" | "proposal.status_changed";
export type TaskNotificationKind = "delegation_assigned" | "verification_requested";
export type TaskNotificationRecipientKind = "worker" | "verifier";
export type TaskNotificationStatus = "pending" | "acknowledged";
export type TaskLifecycleStatus =
  | "pending"
  | "delegated"
  | "running"
  | "blocked"
  | "done"
  | "failed"
  | "verified";

export interface VerificationCheck {
  readonly id: string;
  readonly status: VerificationCheckStatus;
  readonly summary: string;
  readonly detail?: string;
}

export interface DelegationVerificationRequest {
  readonly verifierId: string;
  readonly requirement: string;
  readonly verificationId?: string;
}

export interface DelegationRecord {
  readonly id: string;
  readonly taskId?: string;
  readonly workerId: string;
  readonly instruction: string;
  readonly fromAgent?: string;
  readonly contextSnapshot?: string;
  readonly specialization?: DelegationSpecialization;
  readonly targetAgent?: string;
  readonly verificationRequest?: DelegationVerificationRequest;
  readonly resultSummary?: string;
  readonly observedWriteSet?: readonly string[];
  readonly observedWriteSetSource?: DelegationObservedWriteSetSource;
  readonly status: DelegationStatus;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly completedAtMs?: number;
  readonly error?: string;
}

export interface DelegationRecordInput {
  readonly id: string;
  readonly taskId?: string;
  readonly workerId: string;
  readonly instruction: string;
  readonly fromAgent?: string;
  readonly contextSnapshot?: string;
  readonly specialization?: DelegationSpecialization;
  readonly targetAgent?: string;
  readonly verificationRequest?: DelegationVerificationRequest;
  readonly resultSummary?: string;
  readonly observedWriteSet?: readonly string[];
  readonly observedWriteSetSource?: DelegationObservedWriteSetSource;
  readonly status?: DelegationStatus;
  readonly error?: string;
}

export interface DelegationStatusUpdate {
  readonly id: string;
  readonly status: DelegationStatus;
  readonly error?: string;
  readonly reason?: string;
  readonly resultSummary?: string;
  readonly observedWriteSet?: readonly string[];
  readonly observedWriteSetSource?: DelegationObservedWriteSetSource;
}

export interface VerificationGateRecord {
  readonly id: string;
  readonly taskId?: string;
  readonly verifierId: string;
  readonly verifiedBy?: string;
  readonly requirement: string;
  readonly status: VerificationStatus;
  readonly verdict?: VerificationVerdict;
  readonly verdictSummary?: string;
  readonly checks?: readonly VerificationCheck[];
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface VerificationGateInput {
  readonly id: string;
  readonly taskId?: string;
  readonly verifierId: string;
  readonly verifiedBy?: string;
  readonly requirement: string;
  readonly status?: VerificationStatus;
  readonly verdict?: VerificationVerdict;
  readonly verdictSummary?: string;
  readonly checks?: readonly VerificationCheck[];
}

export interface ProposalRecord {
  readonly id: string;
  readonly kind: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: ProposalStatus;
  readonly schemaVersion: ContractsSchemaVersion;
  readonly sourceSessionId: string;
  readonly sourceTurnId: string;
  readonly provenance: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly expiresAtMs?: number;
  readonly decisionNote?: string;
}

export interface ProposalQueueInput {
  readonly id: string;
  readonly kind: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly sourceSessionId: string;
  readonly sourceTurnId: string;
  readonly provenance: string;
  readonly expiresAtMs?: number;
}

export interface ProposalStatusTransition {
  readonly proposalId: string;
  readonly status: ProposalStatus;
  readonly decisionNote?: string;
}

export interface ProposalOutboxEntry {
  readonly id: string;
  readonly eventType: ProposalOutboxEventType;
  readonly proposalId: string;
  readonly status: ProposalStatus;
  readonly schemaVersion: ContractsSchemaVersion;
  readonly createdAtMs: number;
}

export interface TaskNotificationRecord {
  readonly id: string;
  readonly kind: TaskNotificationKind;
  readonly recipientKind: TaskNotificationRecipientKind;
  readonly recipientId: string;
  readonly status: TaskNotificationStatus;
  readonly summary: string;
  readonly taskId?: string;
  readonly delegationId?: string;
  readonly verificationId?: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly acknowledgedAtMs?: number;
}

export interface TaskLifecycleRecord {
  readonly taskId: string;
  readonly title: string;
  readonly status: TaskLifecycleStatus;
  readonly todoStatus?: TaskItemStatus;
  readonly assignedAgent?: string;
  readonly verificationVerdict?: VerificationVerdict;
  readonly latestDelegationId?: string;
  readonly latestVerificationId?: string;
}

export interface TaskOperationsState {
  readonly schemaVersion: ContractsSchemaVersion;
  readonly todos: TaskState;
  readonly delegation: readonly DelegationRecord[];
  readonly verification: readonly VerificationGateRecord[];
  readonly proposalQueue: readonly ProposalRecord[];
  readonly proposalOutbox: readonly ProposalOutboxEntry[];
  readonly notifications?: readonly TaskNotificationRecord[];
  readonly lifecycle?: readonly TaskLifecycleRecord[];
  readonly updatedAtMs?: number;
}
