import { isArrayOf, isArrayOfStrings, isNumber, isObject, isOptional, isString } from "./guards.js";
import { isDirectorTerminalRunStatus } from "./terminal-run-status.js";

export interface DirectorRecallProvenance {
  readonly runId: string;
  readonly reportId: string;
  readonly observationIds: readonly string[];
}

export interface DirectorRecallEvidenceRef {
  readonly evidenceId: string;
  readonly sourceKind?: string;
  readonly sourceRef: string;
  readonly sourceSnapshotId?: string;
  readonly summary?: string;
}

export interface DirectorRecallPublication {
  readonly candidateId: string;
  readonly publishedAt: string;
  readonly actor?: string;
  readonly note?: string;
}

export type DirectorRecallGovernanceStatus = "published" | "retracted" | "demoted" | "quarantined";

export interface DirectorRecallGovernanceAuditEntry {
  readonly actor?: string;
  readonly note?: string;
  readonly reason?: string;
  readonly decidedAt: string;
  readonly previousStatus: DirectorRecallGovernanceStatus;
  readonly nextStatus: DirectorRecallGovernanceStatus;
}

export interface DirectorRecallGovernance {
  readonly status: DirectorRecallGovernanceStatus;
  readonly audit: readonly DirectorRecallGovernanceAuditEntry[];
}

export interface DirectorRecallHit {
  readonly recordId: string;
  readonly digestId: string;
  readonly projectId: string;
  readonly groupId: string;
  readonly anchorIds: readonly string[];
  readonly selectedAdapters: readonly string[];
  readonly status: import("./terminal-run-status.js").DirectorTerminalRunStatus;
  readonly recordedAt: string;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly summary: string;
  readonly provenance: DirectorRecallProvenance;
  readonly evidenceRefs?: readonly DirectorRecallEvidenceRef[];
  readonly publication?: DirectorRecallPublication;
  readonly governance?: DirectorRecallGovernance;
}

export function isDirectorRecallProvenance(value: unknown): value is DirectorRecallProvenance {
  return (
    isObject(value) &&
    isString(value.runId) &&
    isString(value.reportId) &&
    isArrayOfStrings(value.observationIds)
  );
}

export function isDirectorRecallEvidenceRef(value: unknown): value is DirectorRecallEvidenceRef {
  return (
    isObject(value) &&
    isString(value.evidenceId) &&
    isOptional(value.sourceKind, isString) &&
    isString(value.sourceRef) &&
    isOptional(value.sourceSnapshotId, isString) &&
    isOptional(value.summary, isString)
  );
}

export function isDirectorRecallPublication(value: unknown): value is DirectorRecallPublication {
  return (
    isObject(value) &&
    isString(value.candidateId) &&
    isString(value.publishedAt) &&
    isOptional(value.actor, isString) &&
    isOptional(value.note, isString)
  );
}

export function isDirectorRecallGovernanceStatus(
  value: unknown,
): value is DirectorRecallGovernanceStatus {
  return (
    value === "published" || value === "retracted" || value === "demoted" || value === "quarantined"
  );
}

export function isDirectorRecallGovernanceAuditEntry(
  value: unknown,
): value is DirectorRecallGovernanceAuditEntry {
  return (
    isObject(value) &&
    isOptional(value.actor, isString) &&
    isOptional(value.note, isString) &&
    isOptional(value.reason, isString) &&
    isString(value.decidedAt) &&
    isDirectorRecallGovernanceStatus(value.previousStatus) &&
    isDirectorRecallGovernanceStatus(value.nextStatus)
  );
}

export function isDirectorRecallGovernance(value: unknown): value is DirectorRecallGovernance {
  return (
    isObject(value) &&
    isDirectorRecallGovernanceStatus(value.status) &&
    isArrayOf(value.audit, isDirectorRecallGovernanceAuditEntry)
  );
}

export function isDirectorRecallHit(value: unknown): value is DirectorRecallHit {
  return (
    isObject(value) &&
    isString(value.recordId) &&
    isString(value.digestId) &&
    isString(value.projectId) &&
    isString(value.groupId) &&
    isArrayOfStrings(value.anchorIds) &&
    isArrayOfStrings(value.selectedAdapters) &&
    isDirectorTerminalRunStatus(value.status) &&
    isString(value.recordedAt) &&
    isNumber(value.score) &&
    isArrayOfStrings(value.reasons) &&
    isString(value.summary) &&
    isDirectorRecallProvenance(value.provenance) &&
    isOptional(value.evidenceRefs, (candidate): candidate is readonly DirectorRecallEvidenceRef[] =>
      isArrayOf(candidate, isDirectorRecallEvidenceRef),
    ) &&
    isOptional(value.publication, isDirectorRecallPublication) &&
    isOptional(value.governance, isDirectorRecallGovernance)
  );
}
