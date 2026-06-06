import type {
  DirectorMemoryRecord,
  DirectorRecallPacket,
  DirectorRecallQuery,
} from "@hotflow/director-memory-contracts";

export type DirectorMemoryPortStatus = "ok" | "degraded" | "disabled";

export interface DirectorMemoryStatus {
  readonly status: DirectorMemoryPortStatus;
  readonly rootPath?: string;
  readonly recordCount: number;
  readonly lastRecordedAt?: string;
  readonly notes: readonly string[];
}

export interface DirectorMemoryWriteResult {
  readonly status: DirectorMemoryPortStatus;
  readonly recordId?: string;
  readonly notes: readonly string[];
}

export type DirectorMemoryCandidateStatus = "candidate" | "published" | "rejected";

export type DirectorMemoryPublicationGovernanceStatus =
  | "published"
  | "retracted"
  | "demoted"
  | "quarantined";

export interface DirectorMemoryGovernanceInput {
  readonly actor?: string;
  readonly note?: string;
  readonly reason?: string;
  readonly decidedAt?: string;
}

export interface DirectorMemoryGovernanceAuditEntry {
  readonly actor?: string;
  readonly note?: string;
  readonly reason?: string;
  readonly decidedAt: string;
  readonly previousStatus: DirectorMemoryPublicationGovernanceStatus;
  readonly nextStatus: DirectorMemoryPublicationGovernanceStatus;
}

export interface DirectorMemoryGovernanceResult {
  readonly status: DirectorMemoryPortStatus;
  readonly recordId: string;
  readonly governanceStatus?: DirectorMemoryPublicationGovernanceStatus;
  readonly notes: readonly string[];
}

export interface DirectorMemoryEvidenceRef {
  readonly evidenceId: string;
  readonly sourceKind?: string;
  readonly sourceRef: string;
  readonly sourceSnapshotId?: string;
  readonly summary?: string;
}

export interface DirectorMemoryCandidate {
  readonly candidateId: string;
  readonly record: DirectorMemoryRecord;
  readonly evidenceRefs: readonly DirectorMemoryEvidenceRef[];
  readonly summary?: string;
  readonly createdAt: string;
}

export interface DirectorMemoryCandidatePublishInput {
  readonly actor?: string;
  readonly note?: string;
  readonly publishedAt?: string;
}

export interface DirectorMemoryCandidatePublishResult {
  readonly status: DirectorMemoryPortStatus;
  readonly candidateId: string;
  readonly recordId?: string;
  readonly notes: readonly string[];
}

export interface DirectorMemoryPort {
  writeRecord(record: DirectorMemoryRecord): Promise<DirectorMemoryWriteResult>;
  writeCandidate(candidate: DirectorMemoryCandidate): Promise<DirectorMemoryCandidatePublishResult>;
  publishCandidate(
    candidateId: string,
    input?: DirectorMemoryCandidatePublishInput,
  ): Promise<DirectorMemoryCandidatePublishResult>;
  retractPublication(
    recordId: string,
    input?: DirectorMemoryGovernanceInput,
  ): Promise<DirectorMemoryGovernanceResult>;
  demotePublication(
    recordId: string,
    input?: DirectorMemoryGovernanceInput,
  ): Promise<DirectorMemoryGovernanceResult>;
  quarantinePublication(
    recordId: string,
    input?: DirectorMemoryGovernanceInput,
  ): Promise<DirectorMemoryGovernanceResult>;
  restorePublication(
    recordId: string,
    input?: DirectorMemoryGovernanceInput,
  ): Promise<DirectorMemoryGovernanceResult>;
  recall(query: DirectorRecallQuery): Promise<DirectorRecallPacket>;
  getStatus(): Promise<DirectorMemoryStatus>;
}
