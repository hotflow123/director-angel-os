import {
  type DirectorKnowledgePackDocument,
  type DirectorKnowledgePackMethod,
  type DirectorKnowledgeSourceProposal,
  type KnowledgePackMetadata,
  isDirectorKnowledgePackDocument,
  isKnowledgePackMetadata,
  materializeDirectorKnowledgePackFromProposal,
} from "./types.js";

export const DIRECTOR_KNOWLEDGE_DIFF_SCHEMA_VERSION = "director.knowledge.diff.v1" as const;
export const DIRECTOR_KNOWLEDGE_CANDIDATE_SCHEMA_VERSION =
  "director.knowledge.candidate.v1" as const;
export const DIRECTOR_KNOWLEDGE_REVIEW_DECISION_SCHEMA_VERSION =
  "director.knowledge.review.decision.v1" as const;
export const DIRECTOR_KNOWLEDGE_PUBLISH_AUDIT_SCHEMA_VERSION =
  "director.knowledge.publish.audit.v1" as const;
export const DIRECTOR_KNOWLEDGE_ROLLBACK_RECORD_SCHEMA_VERSION =
  "director.knowledge.rollback.record.v1" as const;

export type DirectorKnowledgeEvolutionOperation = "create" | "update";
export type DirectorKnowledgeReviewDecisionStatus = "accepted" | "rejected";
export type DirectorKnowledgePublishChangeKind = DirectorKnowledgeEvolutionOperation | "rollback";

export interface DirectorKnowledgeDiffEntry {
  readonly field: string;
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface DirectorKnowledgeDiff {
  readonly schemaVersion: typeof DIRECTOR_KNOWLEDGE_DIFF_SCHEMA_VERSION;
  readonly operation: DirectorKnowledgeEvolutionOperation;
  readonly baseVersion: number | null;
  readonly nextVersion: number;
  readonly changedFields: readonly DirectorKnowledgeDiffEntry[];
  readonly summary: string;
}

export interface DirectorKnowledgeCandidateAudit {
  readonly candidateAt: string;
  readonly author?: string;
  readonly note?: string;
  readonly sourceDecisionAt?: string;
  readonly sourceDecisionNote?: string;
}

export interface DirectorKnowledgeCandidateEvolution {
  readonly operation: DirectorKnowledgeEvolutionOperation;
  readonly basePackId: string | null;
  readonly baseVersion: number | null;
  readonly nextVersion: number;
  readonly dedupeKey: string;
}

export interface DirectorKnowledgeCandidateDocument {
  readonly schemaVersion: typeof DIRECTOR_KNOWLEDGE_CANDIDATE_SCHEMA_VERSION;
  readonly metadata: KnowledgePackMetadata;
  readonly stage: "candidate";
  readonly method: DirectorKnowledgePackMethod;
  readonly audit: DirectorKnowledgeCandidateAudit;
  readonly evolution: DirectorKnowledgeCandidateEvolution;
  readonly diff: DirectorKnowledgeDiff;
}

export interface DirectorKnowledgeReviewDecision {
  readonly schemaVersion: typeof DIRECTOR_KNOWLEDGE_REVIEW_DECISION_SCHEMA_VERSION;
  readonly packId: string;
  readonly candidateVersion: number;
  readonly decision: DirectorKnowledgeReviewDecisionStatus;
  readonly decidedAt: string;
  readonly actor?: string;
  readonly note?: string;
  readonly baseVersion: number | null;
  readonly nextVersion: number;
}

export interface DirectorKnowledgePublishAuditRecord {
  readonly schemaVersion: typeof DIRECTOR_KNOWLEDGE_PUBLISH_AUDIT_SCHEMA_VERSION;
  readonly packId: string;
  readonly publishedVersion: number;
  readonly previousVersion: number | null;
  readonly publishedAt: string;
  readonly actor?: string;
  readonly note?: string;
  readonly changeKind: DirectorKnowledgePublishChangeKind;
  readonly sourceCandidateVersion: number;
}

export interface DirectorKnowledgeRollbackRecord {
  readonly schemaVersion: typeof DIRECTOR_KNOWLEDGE_ROLLBACK_RECORD_SCHEMA_VERSION;
  readonly packId: string;
  readonly currentVersionBefore: number;
  readonly restoredFromVersion: number;
  readonly currentVersionAfter: number;
  readonly rolledBackAt: string;
  readonly actor?: string;
  readonly note?: string;
}

export interface MaterializeDirectorKnowledgeCandidateOptions {
  readonly currentPublished?: DirectorKnowledgePackDocument | null;
  readonly author?: string;
  readonly note?: string;
  readonly now?: string;
}

interface DirectorKnowledgeComparableDocument {
  readonly metadata: Pick<
    KnowledgePackMetadata,
    "id" | "title" | "description" | "tags" | "version"
  >;
  readonly method: Pick<
    DirectorKnowledgePackMethod,
    | "trigger"
    | "summary"
    | "explanation"
    | "evidenceSummary"
    | "roles"
    | "preferredAdapters"
    | "anchorIds"
    | "generationType"
    | "generationStyle"
  >;
}

export function materializeDirectorKnowledgeCandidateFromProposal(
  proposal: DirectorKnowledgeSourceProposal,
  options: MaterializeDirectorKnowledgeCandidateOptions = {},
): DirectorKnowledgeCandidateDocument {
  if (proposal.status !== "accepted") {
    throw new Error(
      "Director knowledge candidate materialization requires an accepted trace proposal.",
    );
  }

  const publishedTemplate = materializeDirectorKnowledgePackFromProposal(proposal, {
    ...(options.author === undefined ? {} : { author: options.author }),
    ...(options.note === undefined ? {} : { note: options.note }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const currentPublished = options.currentPublished ?? null;

  if (currentPublished !== null && currentPublished.metadata.id !== publishedTemplate.metadata.id) {
    throw new Error(
      `Current published Director knowledge pack does not match proposal pack id: expected ${publishedTemplate.metadata.id}, received ${currentPublished.metadata.id}.`,
    );
  }

  const operation: DirectorKnowledgeEvolutionOperation =
    currentPublished === null ? "create" : "update";
  const nextVersion = (currentPublished?.metadata.version ?? 0) + 1;
  const metadata: KnowledgePackMetadata = {
    ...publishedTemplate.metadata,
    id: currentPublished?.metadata.id ?? publishedTemplate.metadata.id,
    version: nextVersion,
  };
  const diff = diffDirectorKnowledgePack(currentPublished, {
    metadata,
    method: publishedTemplate.method,
  });

  return {
    schemaVersion: DIRECTOR_KNOWLEDGE_CANDIDATE_SCHEMA_VERSION,
    metadata,
    stage: "candidate",
    method: cloneMethod(publishedTemplate.method),
    audit: {
      candidateAt: publishedTemplate.audit.publishedAt,
      ...(options.author === undefined ? {} : { author: options.author }),
      ...(options.note === undefined ? {} : { note: options.note }),
      ...(proposal.latestDecision?.decidedAt === undefined
        ? {}
        : { sourceDecisionAt: proposal.latestDecision.decidedAt }),
      ...(proposal.latestDecision?.note === undefined
        ? {}
        : { sourceDecisionNote: proposal.latestDecision.note }),
    },
    evolution: {
      operation,
      basePackId: currentPublished?.metadata.id ?? null,
      baseVersion: currentPublished?.metadata.version ?? null,
      nextVersion,
      dedupeKey: proposal.dedupeKey,
    },
    diff,
  };
}

export function diffDirectorKnowledgePack(
  currentPublished: DirectorKnowledgePackDocument | null,
  next: DirectorKnowledgeComparableDocument,
): DirectorKnowledgeDiff {
  const operation: DirectorKnowledgeEvolutionOperation =
    currentPublished === null ? "create" : "update";
  const baseVersion = currentPublished?.metadata.version ?? null;
  const nextVersion = next.metadata.version;
  const changedFields: DirectorKnowledgeDiffEntry[] = [];

  const fields: readonly {
    readonly field: string;
    readonly before: () => unknown;
    readonly after: () => unknown;
  }[] = [
    {
      field: "metadata.version",
      before: () => currentPublished?.metadata.version,
      after: () => next.metadata.version,
    },
    {
      field: "metadata.title",
      before: () => currentPublished?.metadata.title,
      after: () => next.metadata.title,
    },
    {
      field: "metadata.description",
      before: () => currentPublished?.metadata.description,
      after: () => next.metadata.description,
    },
    {
      field: "metadata.tags",
      before: () => currentPublished?.metadata.tags,
      after: () => next.metadata.tags,
    },
    {
      field: "method.trigger",
      before: () => currentPublished?.method.trigger,
      after: () => next.method.trigger,
    },
    {
      field: "method.summary",
      before: () => currentPublished?.method.summary,
      after: () => next.method.summary,
    },
    {
      field: "method.explanation",
      before: () => currentPublished?.method.explanation,
      after: () => next.method.explanation,
    },
    {
      field: "method.evidenceSummary",
      before: () => currentPublished?.method.evidenceSummary,
      after: () => next.method.evidenceSummary,
    },
    {
      field: "method.roles",
      before: () => currentPublished?.method.roles,
      after: () => next.method.roles,
    },
    {
      field: "method.preferredAdapters",
      before: () => currentPublished?.method.preferredAdapters,
      after: () => next.method.preferredAdapters,
    },
    {
      field: "method.anchorIds",
      before: () => currentPublished?.method.anchorIds,
      after: () => next.method.anchorIds,
    },
    {
      field: "method.generationType",
      before: () => currentPublished?.method.generationType,
      after: () => next.method.generationType,
    },
    {
      field: "method.generationStyle",
      before: () => currentPublished?.method.generationStyle,
      after: () => next.method.generationStyle,
    },
  ];

  for (const descriptor of fields) {
    const before = descriptor.before();
    const after = descriptor.after();
    if (areValuesEqual(before, after)) {
      continue;
    }
    changedFields.push({
      field: descriptor.field,
      ...(before === undefined ? {} : { before: cloneUnknown(before) }),
      ...(after === undefined ? {} : { after: cloneUnknown(after) }),
    });
  }

  return {
    schemaVersion: DIRECTOR_KNOWLEDGE_DIFF_SCHEMA_VERSION,
    operation,
    baseVersion,
    nextVersion,
    changedFields,
    summary: buildDiffSummary(next.metadata.id, operation, baseVersion, nextVersion, changedFields),
  };
}

export function isDirectorKnowledgeCandidateDocument(
  value: unknown,
): value is DirectorKnowledgeCandidateDocument {
  return (
    isRecord(value) &&
    value.schemaVersion === DIRECTOR_KNOWLEDGE_CANDIDATE_SCHEMA_VERSION &&
    value.stage === "candidate" &&
    isKnowledgePackMetadata(value.metadata) &&
    isDirectorKnowledgePackMethod(value.method) &&
    isDirectorKnowledgeCandidateAudit(value.audit) &&
    isDirectorKnowledgeCandidateEvolution(value.evolution) &&
    isDirectorKnowledgeDiff(value.diff)
  );
}

export function isDirectorKnowledgeReviewDecision(
  value: unknown,
): value is DirectorKnowledgeReviewDecision {
  return (
    isRecord(value) &&
    value.schemaVersion === DIRECTOR_KNOWLEDGE_REVIEW_DECISION_SCHEMA_VERSION &&
    isString(value.packId) &&
    isPositiveInteger(value.candidateVersion) &&
    (value.decision === "accepted" || value.decision === "rejected") &&
    isString(value.decidedAt) &&
    (value.actor === undefined || isString(value.actor)) &&
    (value.note === undefined || isString(value.note)) &&
    isNullablePositiveInteger(value.baseVersion) &&
    isPositiveInteger(value.nextVersion)
  );
}

export function isDirectorKnowledgePublishAuditRecord(
  value: unknown,
): value is DirectorKnowledgePublishAuditRecord {
  return (
    isRecord(value) &&
    value.schemaVersion === DIRECTOR_KNOWLEDGE_PUBLISH_AUDIT_SCHEMA_VERSION &&
    isString(value.packId) &&
    isPositiveInteger(value.publishedVersion) &&
    isNullablePositiveInteger(value.previousVersion) &&
    isString(value.publishedAt) &&
    (value.actor === undefined || isString(value.actor)) &&
    (value.note === undefined || isString(value.note)) &&
    (value.changeKind === "create" ||
      value.changeKind === "update" ||
      value.changeKind === "rollback") &&
    isPositiveInteger(value.sourceCandidateVersion)
  );
}

export function isDirectorKnowledgeRollbackRecord(
  value: unknown,
): value is DirectorKnowledgeRollbackRecord {
  return (
    isRecord(value) &&
    value.schemaVersion === DIRECTOR_KNOWLEDGE_ROLLBACK_RECORD_SCHEMA_VERSION &&
    isString(value.packId) &&
    isPositiveInteger(value.currentVersionBefore) &&
    isPositiveInteger(value.restoredFromVersion) &&
    isPositiveInteger(value.currentVersionAfter) &&
    isString(value.rolledBackAt) &&
    (value.actor === undefined || isString(value.actor)) &&
    (value.note === undefined || isString(value.note))
  );
}

function buildDiffSummary(
  packId: string,
  operation: DirectorKnowledgeEvolutionOperation,
  baseVersion: number | null,
  nextVersion: number,
  changedFields: readonly DirectorKnowledgeDiffEntry[],
): string {
  const transition =
    baseVersion === null ? `v${nextVersion}` : `v${baseVersion} -> v${nextVersion}`;
  if (changedFields.length === 0) {
    return `${operation} ${packId} ${transition} with no changed fields`;
  }
  return `${operation} ${packId} ${transition} with ${changedFields.length} changed field(s): ${changedFields
    .map((entry) => entry.field)
    .join(", ")}`;
}

function cloneMethod(method: DirectorKnowledgePackMethod): DirectorKnowledgePackMethod {
  return {
    ...method,
    roles: [...method.roles],
    preferredAdapters: [...method.preferredAdapters],
    anchorIds: [...method.anchorIds],
  };
}

function isDirectorKnowledgeDiff(value: unknown): value is DirectorKnowledgeDiff {
  return (
    isRecord(value) &&
    value.schemaVersion === DIRECTOR_KNOWLEDGE_DIFF_SCHEMA_VERSION &&
    (value.operation === "create" || value.operation === "update") &&
    isNullablePositiveInteger(value.baseVersion) &&
    isPositiveInteger(value.nextVersion) &&
    Array.isArray(value.changedFields) &&
    value.changedFields.every(isDirectorKnowledgeDiffEntry) &&
    isString(value.summary)
  );
}

function isDirectorKnowledgeDiffEntry(value: unknown): value is DirectorKnowledgeDiffEntry {
  return isRecord(value) && isString(value.field) && ("before" in value || "after" in value);
}

function isDirectorKnowledgeCandidateAudit(
  value: unknown,
): value is DirectorKnowledgeCandidateAudit {
  return (
    isRecord(value) &&
    isString(value.candidateAt) &&
    (value.author === undefined || isString(value.author)) &&
    (value.note === undefined || isString(value.note)) &&
    (value.sourceDecisionAt === undefined || isString(value.sourceDecisionAt)) &&
    (value.sourceDecisionNote === undefined || isString(value.sourceDecisionNote))
  );
}

function isDirectorKnowledgeCandidateEvolution(
  value: unknown,
): value is DirectorKnowledgeCandidateEvolution {
  return (
    isRecord(value) &&
    (value.operation === "create" || value.operation === "update") &&
    isNullableString(value.basePackId) &&
    isNullablePositiveInteger(value.baseVersion) &&
    isPositiveInteger(value.nextVersion) &&
    isString(value.dedupeKey)
  );
}

function isDirectorKnowledgePackMethod(value: unknown): value is DirectorKnowledgePackMethod {
  return (
    isRecord(value) &&
    isString(value.sourceProposalId) &&
    isString(value.sourceRecordId) &&
    isString(value.sourceDigestId) &&
    isString(value.projectId) &&
    isString(value.groupId) &&
    isString(value.goal) &&
    isString(value.trigger) &&
    isString(value.summary) &&
    isString(value.explanation) &&
    isString(value.evidenceSummary) &&
    isStringArray(value.roles) &&
    isStringArray(value.preferredAdapters) &&
    isStringArray(value.anchorIds) &&
    (value.generationType === undefined || isString(value.generationType)) &&
    (value.generationStyle === undefined || isString(value.generationStyle))
  );
}

function areValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(cloneUnknown(left)) === JSON.stringify(cloneUnknown(right));
}

function cloneUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneUnknown(entry));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneUnknown(entry)]),
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isString);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isNullablePositiveInteger(value: unknown): value is number | null {
  return value === null || isPositiveInteger(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

export function isDirectorKnowledgeHeadDocument(
  value: unknown,
): value is DirectorKnowledgePackDocument | DirectorKnowledgeCandidateDocument {
  return isDirectorKnowledgePackDocument(value) || isDirectorKnowledgeCandidateDocument(value);
}
