import type { DirectorMemoryRecord } from "@hotflow/director-memory-contracts";

import {
  DIRECTOR_TRACE_CAPTURE_KIND,
  DIRECTOR_TRACE_PROPOSAL_SCHEMA_VERSION,
  type DirectorProposalRiskLevel,
  type DirectorTraceProposal,
} from "./types.js";

export interface GenerateDirectorProposalFromRecordInput {
  readonly record: DirectorMemoryRecord;
  readonly provenance: string;
  readonly now?: string;
  readonly proposalId?: string;
}

export function generateDirectorProposalFromRecord(
  input: GenerateDirectorProposalFromRecordInput,
): DirectorTraceProposal {
  const createdAt = input.now ?? input.record.recordedAt;
  const riskLevel = resolveRiskLevel(input.record);
  const confidence = scoreConfidence(input.record, riskLevel);
  const tags = deriveTags(input.record);
  const trigger = buildTrigger(input.record);
  const evidenceSummary = buildEvidenceSummary(input.record);
  const explanation = buildExplanation(input.record, { riskLevel, confidence });

  return {
    schemaVersion: DIRECTOR_TRACE_PROPOSAL_SCHEMA_VERSION,
    proposalId: input.proposalId ?? `proposal-${input.record.recordId}`,
    kind: DIRECTOR_TRACE_CAPTURE_KIND,
    status: "pending",
    provenance: input.provenance,
    recordId: input.record.recordId,
    digestId: input.record.digestId,
    runId: input.record.digest.runId,
    reportId: input.record.digest.reportId,
    projectId: input.record.projectId,
    groupId: input.record.groupId,
    title: buildTitle(input.record),
    summary: buildSummary(input.record),
    trigger,
    evidenceSummary,
    explanation,
    confidence,
    riskLevel,
    dedupeKey: buildDedupeKey(input.record),
    tags,
    roles: sortUniqueStrings(input.record.digest.roles),
    selectedAdapters: sortUniqueStrings(input.record.selectedAdapters),
    createdAt,
    updatedAt: createdAt,
    sourceRecord: cloneRecord(input.record),
  };
}

function buildTitle(record: DirectorMemoryRecord): string {
  const goal = record.digest.goal.trim();
  return goal.length > 0
    ? `Director method: ${truncate(goal, 72)}`
    : `Director method ${record.recordId}`;
}

function buildSummary(record: DirectorMemoryRecord): string {
  const type = record.digest.generationType ?? "unknown";
  const style = record.digest.generationStyle ?? "standard";
  return `${record.status} ${style} ${type} run for ${record.projectId}/${record.groupId}`;
}

function buildTrigger(record: DirectorMemoryRecord): string {
  const type = record.digest.generationType ?? "new";
  const style = record.digest.generationStyle ?? "standard";
  return `When planning a ${style} ${type} run for project ${record.projectId}.`;
}

function buildEvidenceSummary(record: DirectorMemoryRecord): string {
  const parts = [
    `status=${record.status}`,
    `roles=${record.digest.roles.join(", ") || "none"}`,
    `adapters=${record.selectedAdapters.join(", ") || "none"}`,
    `anchors=${record.anchorIds.length}`,
    `events=${record.digest.eventTypes.length}`,
  ];
  return parts.join(" | ");
}

function buildExplanation(
  record: DirectorMemoryRecord,
  input: {
    readonly riskLevel: DirectorProposalRiskLevel;
    readonly confidence: number;
  },
): string {
  const reasons: string[] = [];
  if (record.status === "completed") {
    reasons.push("Completed runs are eligible for reusable director method proposals.");
  } else {
    reasons.push("Non-completed runs stay eligible, but should be reviewed as cautionary methods.");
  }
  if (record.selectedAdapters.length === 0) {
    reasons.push("No adapter was selected, so proposal confidence is reduced.");
  }
  if (record.digest.flags.length > 0) {
    reasons.push(`Observed run flags: ${record.digest.flags.join(", ")}.`);
  }
  reasons.push(`confidence=${input.confidence.toFixed(2)} risk=${input.riskLevel}`);
  return reasons.join(" ");
}

function resolveRiskLevel(record: DirectorMemoryRecord): DirectorProposalRiskLevel {
  if (record.status === "failed" || record.status === "aborted") {
    return "high";
  }
  if (record.selectedAdapters.length === 0 || record.digest.flags.length > 0) {
    return "medium";
  }
  return "low";
}

function scoreConfidence(
  record: DirectorMemoryRecord,
  riskLevel: DirectorProposalRiskLevel,
): number {
  let confidence = record.status === "completed" ? 0.88 : 0.52;
  if (record.selectedAdapters.length === 0) {
    confidence -= 0.18;
  }
  if (record.digest.observationRefs.length < 2) {
    confidence -= 0.12;
  }
  if (riskLevel === "medium") {
    confidence -= 0.08;
  }
  if (riskLevel === "high") {
    confidence -= 0.16;
  }
  return Number(Math.max(0.2, Math.min(0.95, confidence)).toFixed(2));
}

function deriveTags(record: DirectorMemoryRecord): readonly string[] {
  return sortUniqueStrings([
    "director-trace",
    `status:${record.status}`,
    ...(record.digest.generationType === undefined ? [] : [`type:${record.digest.generationType}`]),
    ...(record.digest.generationStyle === undefined
      ? []
      : [`style:${record.digest.generationStyle}`]),
    ...record.selectedAdapters.map((adapterId) => `adapter:${adapterId}`),
    ...(record.tags ?? []),
    ...(record.digest.knowledgeSignalTags ?? []),
  ]);
}

function buildDedupeKey(record: DirectorMemoryRecord): string {
  return [
    normalizeToken(record.projectId),
    normalizeToken(record.groupId),
    normalizeToken(record.digest.goal),
    normalizeToken(record.digest.generationType ?? ""),
    normalizeToken(record.digest.generationStyle ?? ""),
    sortUniqueStrings(record.selectedAdapters)
      .map((adapterId) => normalizeToken(adapterId))
      .join("-"),
  ]
    .filter((segment) => segment.length > 0)
    .join("__");
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-+|-+$/gu, "");
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function sortUniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function cloneRecord(record: DirectorMemoryRecord): DirectorMemoryRecord {
  return JSON.parse(JSON.stringify(record)) as DirectorMemoryRecord;
}
