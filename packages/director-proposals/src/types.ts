import type { DirectorMemoryRecord } from "@hotflow/director-memory-contracts";

export const DIRECTOR_TRACE_PROPOSAL_SCHEMA_VERSION = "director.proposal.v1" as const;
export const DIRECTOR_TRACE_CAPTURE_KIND = "director.trace_capture" as const;

export type DirectorProposalRiskLevel = "low" | "medium" | "high";
export type DirectorProposalStatus = "pending" | "accepted" | "rejected";
export type DirectorProposalDecisionStatus = Extract<
  DirectorProposalStatus,
  "accepted" | "rejected"
>;
export type DirectorProposalReviewRecommendation = "accept" | "caution" | "reject";
export type DirectorProposalAuditAction = "decision" | "previewed" | "replayed";

export interface DirectorTraceProposalDecision {
  readonly decidedAt: string;
  readonly decidedStatus: DirectorProposalDecisionStatus;
  readonly note?: string;
}

export interface DirectorTraceProposal {
  readonly schemaVersion: typeof DIRECTOR_TRACE_PROPOSAL_SCHEMA_VERSION;
  readonly proposalId: string;
  readonly kind: typeof DIRECTOR_TRACE_CAPTURE_KIND;
  readonly status: DirectorProposalStatus;
  readonly provenance: string;
  readonly recordId: string;
  readonly digestId: string;
  readonly runId: string;
  readonly reportId: string;
  readonly projectId: string;
  readonly groupId: string;
  readonly title: string;
  readonly summary: string;
  readonly trigger: string;
  readonly evidenceSummary: string;
  readonly explanation: string;
  readonly confidence: number;
  readonly riskLevel: DirectorProposalRiskLevel;
  readonly dedupeKey: string;
  readonly tags: readonly string[];
  readonly roles: readonly string[];
  readonly selectedAdapters: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly latestDecision?: DirectorTraceProposalDecision;
  readonly sourceRecord: DirectorMemoryRecord;
}

export interface DirectorProposalStoreStatus {
  readonly status: "ok" | "degraded";
  readonly proposalCount: number;
  readonly lastUpdatedAt?: string;
  readonly notes: readonly string[];
}

export interface DirectorProposalWriteResult {
  readonly status: "ok" | "degraded";
  readonly proposalId: string;
  readonly notes: readonly string[];
}

export interface DirectorProposalTransitionResult {
  readonly status: "ok" | "degraded";
  readonly proposalId: string;
  readonly previousStatus?: DirectorProposalStatus;
  readonly nextStatus: DirectorProposalDecisionStatus;
  readonly recordedAt?: string;
  readonly notes: readonly string[];
}

export interface DirectorTraceProposalReview {
  readonly proposalId: string;
  readonly currentStatus: DirectorProposalStatus;
  readonly recommendation: DirectorProposalReviewRecommendation;
  readonly riskLevel: DirectorProposalRiskLevel;
  readonly confidence: number;
  readonly reasons: readonly string[];
}

export interface DirectorProposalAuditEvent {
  readonly schemaVersion: "director.proposal.audit.v1";
  readonly auditId: string;
  readonly proposalId: string;
  readonly action: DirectorProposalAuditAction;
  readonly recordedAt: string;
  readonly previousStatus?: DirectorProposalStatus;
  readonly nextStatus?: DirectorProposalDecisionStatus;
  readonly previewId?: string;
  readonly runId?: string;
  readonly reportId?: string;
  readonly note?: string;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isString);
}

function isDirectorTraceProposalDecision(value: unknown): value is DirectorTraceProposalDecision {
  return (
    isObject(value) &&
    isString(value.decidedAt) &&
    (value.decidedStatus === "accepted" || value.decidedStatus === "rejected") &&
    (value.note === undefined || isString(value.note))
  );
}

export function isDirectorTraceProposal(value: unknown): value is DirectorTraceProposal {
  return (
    isObject(value) &&
    value.schemaVersion === DIRECTOR_TRACE_PROPOSAL_SCHEMA_VERSION &&
    value.kind === DIRECTOR_TRACE_CAPTURE_KIND &&
    (value.status === "pending" || value.status === "accepted" || value.status === "rejected") &&
    isString(value.proposalId) &&
    isString(value.provenance) &&
    isString(value.recordId) &&
    isString(value.digestId) &&
    isString(value.runId) &&
    isString(value.reportId) &&
    isString(value.projectId) &&
    isString(value.groupId) &&
    isString(value.title) &&
    isString(value.summary) &&
    isString(value.trigger) &&
    isString(value.evidenceSummary) &&
    isString(value.explanation) &&
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    (value.riskLevel === "low" || value.riskLevel === "medium" || value.riskLevel === "high") &&
    isString(value.dedupeKey) &&
    isStringArray(value.tags) &&
    isStringArray(value.roles) &&
    isStringArray(value.selectedAdapters) &&
    isString(value.createdAt) &&
    isString(value.updatedAt) &&
    (value.latestDecision === undefined || isDirectorTraceProposalDecision(value.latestDecision)) &&
    isObject(value.sourceRecord)
  );
}
