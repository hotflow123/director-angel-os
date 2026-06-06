import { CONTRACTS_SCHEMA_VERSION, type ContractsSchemaVersion } from "./schema-version.js";

export type CanonicalJsonPrimitive = string | number | boolean | null;
export type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue | undefined };

export interface LearningEvidence {
  readonly schemaVersion: ContractsSchemaVersion;
  readonly evidenceId: string;
  readonly eventType: string;
  readonly seq: number;
  readonly turnId: string;
  readonly createdAtMs: number;
  readonly summary: string;
  readonly attributes?: { readonly [key: string]: CanonicalJsonValue | undefined };
}

export interface TrajectoryDigestCounts {
  readonly journalEventsInTurn: number;
  readonly toolCallCount: number;
  readonly toolResultCount: number;
  readonly assistantOutputCount: number;
}

export interface TrajectoryDigest {
  readonly schemaVersion: ContractsSchemaVersion;
  readonly digestId: string;
  readonly sourceSessionId: string;
  readonly sourceTurnId: string;
  readonly trajectoryRef: string;
  readonly createdAtMs: number;
  readonly checkpointSeq: number;
  readonly latestCommittedSeq: number;
  readonly latestUserText: string | null;
  readonly toolNames: readonly string[];
  readonly counts: TrajectoryDigestCounts;
  readonly evidence: readonly LearningEvidence[];
}

export interface ProposalCandidate {
  readonly schemaVersion: ContractsSchemaVersion;
  readonly candidateId: string;
  readonly digestId: string;
  readonly sourceSessionId: string;
  readonly sourceTurnId: string;
  readonly trajectoryRef: string;
  readonly title: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly provenance: string;
}

export type ExperienceSourceKind =
  | "local-repository"
  | "local-directory"
  | "web-page"
  | "web-search"
  | "pasted-text"
  | "session-trajectory"
  | "document"
  | "manual";
export type ExperiencePrivacyClassification = "public" | "internal" | "confidential" | "restricted";
export type ExperienceTransformationKind =
  | "summarize"
  | "redact"
  | "classify"
  | "normalize"
  | "extract-pattern";
export type ExperienceCandidateStatus = "candidate";
export type ExperienceRuntimeInjection = "disabled";
export type ExperienceReviewGate = "human" | "verifier";
export type ExperienceReviewDecisionStatus = "accepted" | "rejected";
export type ExperiencePromotionTarget =
  | "director-knowledge-candidate"
  | "skill-proposal"
  | "memory-record";

export interface ExperienceIncrementalState {
  readonly cursor?: string;
  readonly fingerprint?: string;
}

export interface ExperienceTransformationDeclaration {
  readonly transformId: string;
  readonly kind: ExperienceTransformationKind;
  readonly summary: string;
  readonly privacyImpact?: ExperiencePrivacyClassification;
}

export interface ExperienceSourceAdapterDeclaration {
  readonly schemaVersion: ContractsSchemaVersion;
  readonly adapterId: string;
  readonly sourceKind: ExperienceSourceKind;
  readonly sourceRef: string;
  readonly privacy: ExperiencePrivacyClassification;
  readonly incremental?: ExperienceIncrementalState;
  readonly transformations: readonly ExperienceTransformationDeclaration[];
}

export interface ExperienceQualityAssessment {
  readonly score: number;
  readonly verdict: "usable" | "quarantine";
  readonly reasons: readonly string[];
  readonly metrics?: { readonly [key: string]: CanonicalJsonValue | undefined };
}

export interface ExperienceExtractionReport {
  readonly status: "ok" | "partial" | "failed";
  readonly readableChars: number;
  readonly rawChars: number;
  readonly transformations: readonly string[];
  readonly notes: readonly string[];
  readonly unavailable?: readonly string[];
}

export interface ExperienceSourceArtifact {
  readonly schemaVersion: ContractsSchemaVersion;
  readonly artifactId: string;
  readonly sourceKind: ExperienceSourceKind;
  readonly sourceRef: string;
  readonly title?: string;
  readonly path?: string;
  readonly contentType?: string;
  readonly digest: string;
  readonly bytes: number;
  readonly textPreview: string;
  readonly rawContent?: string;
  readonly readableContent?: string;
  readonly structuredContent?: CanonicalJsonValue;
  readonly extractionReport?: ExperienceExtractionReport;
  readonly quality: ExperienceQualityAssessment;
  readonly privacy: ExperiencePrivacyClassification;
  readonly provenance: string;
  readonly capturedAtMs: number;
}

export interface ExperienceQuarantineRecord {
  readonly schemaVersion: ContractsSchemaVersion;
  readonly quarantineId: string;
  readonly artifact: ExperienceSourceArtifact;
  readonly reason: string;
  readonly notes: readonly string[];
  readonly createdAtMs: number;
}

export interface ExperienceEvidenceRef {
  readonly evidenceId: string;
  readonly sourceRef: string;
  readonly path?: string;
  readonly span?: string;
  readonly summary: string;
  readonly attributes?: { readonly [key: string]: CanonicalJsonValue | undefined };
}

export interface ExperienceCandidate {
  readonly schemaVersion: ContractsSchemaVersion;
  readonly candidateId: string;
  readonly sourceAdapter: ExperienceSourceAdapterDeclaration;
  readonly title: string;
  readonly summary: string;
  readonly applicability: string;
  readonly risks: readonly string[];
  readonly tags: readonly string[];
  readonly evidence: readonly ExperienceEvidenceRef[];
  readonly sourceArtifactId?: string;
  readonly sourceDigest?: string;
  readonly evidencePreview?: string;
  readonly quality?: ExperienceQualityAssessment;
  readonly status: ExperienceCandidateStatus;
  readonly privacy: ExperiencePrivacyClassification;
  readonly runtimeInjection: ExperienceRuntimeInjection;
  readonly provenance: string;
  readonly createdAtMs: number;
}

export interface ExperienceReviewDecision {
  readonly schemaVersion: ContractsSchemaVersion;
  readonly decisionId: string;
  readonly candidateId: string;
  readonly gate: ExperienceReviewGate;
  readonly decision: ExperienceReviewDecisionStatus;
  readonly decidedAtMs: number;
  readonly reviewerId?: string;
  readonly note?: string;
}

export interface ExperiencePromotionRecord {
  readonly schemaVersion: ContractsSchemaVersion;
  readonly promotionId: string;
  readonly candidateId: string;
  readonly promotedTo: ExperiencePromotionTarget;
  readonly promotedRef: string;
  readonly promotedAtMs: number;
  readonly actorId?: string;
}

export interface ExperienceRollbackRecord {
  readonly schemaVersion: ContractsSchemaVersion;
  readonly rollbackId: string;
  readonly promotionId: string;
  readonly candidateId: string;
  readonly rolledBackAtMs: number;
  readonly reason: string;
  readonly actorId?: string;
}

export function createLearningEvidence(
  input: Omit<LearningEvidence, "schemaVersion">,
): LearningEvidence {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    evidenceId: input.evidenceId,
    eventType: input.eventType,
    seq: input.seq,
    turnId: input.turnId,
    createdAtMs: input.createdAtMs,
    summary: input.summary,
    ...(input.attributes === undefined
      ? {}
      : {
          attributes: normalizeCanonicalObject(input.attributes),
        }),
  };
}

export function createTrajectoryDigest(
  input: Omit<TrajectoryDigest, "schemaVersion" | "toolNames" | "evidence"> & {
    readonly toolNames: readonly string[];
    readonly evidence: readonly LearningEvidence[];
  },
): TrajectoryDigest {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    digestId: input.digestId,
    sourceSessionId: input.sourceSessionId,
    sourceTurnId: input.sourceTurnId,
    trajectoryRef: input.trajectoryRef,
    createdAtMs: input.createdAtMs,
    checkpointSeq: input.checkpointSeq,
    latestCommittedSeq: input.latestCommittedSeq,
    latestUserText: input.latestUserText,
    toolNames: sortUniqueStrings(input.toolNames),
    counts: {
      journalEventsInTurn: input.counts.journalEventsInTurn,
      toolCallCount: input.counts.toolCallCount,
      toolResultCount: input.counts.toolResultCount,
      assistantOutputCount: input.counts.assistantOutputCount,
    },
    evidence: [...input.evidence]
      .map((entry) => createLearningEvidence(entry))
      .sort(
        (left, right) => left.seq - right.seq || left.evidenceId.localeCompare(right.evidenceId),
      ),
  };
}

export function createProposalCandidate(
  input: Omit<ProposalCandidate, "schemaVersion" | "tags" | "evidenceIds"> & {
    readonly tags: readonly string[];
    readonly evidenceIds: readonly string[];
  },
): ProposalCandidate {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    candidateId: input.candidateId,
    digestId: input.digestId,
    sourceSessionId: input.sourceSessionId,
    sourceTurnId: input.sourceTurnId,
    trajectoryRef: input.trajectoryRef,
    title: input.title,
    summary: input.summary,
    tags: sortUniqueStrings(input.tags),
    evidenceIds: sortUniqueStrings(input.evidenceIds),
    provenance: input.provenance,
  };
}

export function createExperienceSourceAdapterDeclaration(
  input: Omit<ExperienceSourceAdapterDeclaration, "schemaVersion" | "transformations"> & {
    readonly transformations: readonly ExperienceTransformationDeclaration[];
  },
): ExperienceSourceAdapterDeclaration {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    adapterId: input.adapterId,
    sourceKind: input.sourceKind,
    sourceRef: input.sourceRef,
    privacy: input.privacy,
    ...(input.incremental === undefined
      ? {}
      : {
          incremental: {
            ...(input.incremental.cursor === undefined ? {} : { cursor: input.incremental.cursor }),
            ...(input.incremental.fingerprint === undefined
              ? {}
              : { fingerprint: input.incremental.fingerprint }),
          },
        }),
    transformations: [...input.transformations]
      .map((entry) => cloneExperienceTransformation(entry))
      .sort((left, right) => left.transformId.localeCompare(right.transformId)),
  };
}

export function createExperienceQualityAssessment(
  input: ExperienceQualityAssessment,
): ExperienceQualityAssessment {
  return cloneExperienceQuality(input);
}

export function createExperienceCandidate(
  input: Omit<
    ExperienceCandidate,
    "schemaVersion" | "status" | "runtimeInjection" | "tags" | "evidence" | "sourceAdapter"
  > & {
    readonly sourceAdapter: ExperienceSourceAdapterDeclaration;
    readonly tags: readonly string[];
    readonly evidence: readonly ExperienceEvidenceRef[];
  },
): ExperienceCandidate {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    candidateId: input.candidateId,
    sourceAdapter: createExperienceSourceAdapterDeclaration(input.sourceAdapter),
    title: input.title,
    summary: input.summary,
    applicability: input.applicability,
    risks: sortUniqueStrings(input.risks),
    tags: sortUniqueStrings(input.tags),
    evidence: [...input.evidence]
      .map((entry) => cloneExperienceEvidenceRef(entry))
      .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
    ...(input.sourceArtifactId === undefined ? {} : { sourceArtifactId: input.sourceArtifactId }),
    ...(input.sourceDigest === undefined ? {} : { sourceDigest: input.sourceDigest }),
    ...(input.evidencePreview === undefined ? {} : { evidencePreview: input.evidencePreview }),
    ...(input.quality === undefined ? {} : { quality: cloneExperienceQuality(input.quality) }),
    status: "candidate",
    privacy: input.privacy,
    runtimeInjection: "disabled",
    provenance: input.provenance,
    createdAtMs: input.createdAtMs,
  };
}

export function createExperienceSourceArtifact(
  input: Omit<ExperienceSourceArtifact, "schemaVersion" | "quality"> & {
    readonly quality: ExperienceQualityAssessment;
  },
): ExperienceSourceArtifact {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    artifactId: input.artifactId,
    sourceKind: input.sourceKind,
    sourceRef: input.sourceRef,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.path === undefined ? {} : { path: input.path }),
    ...(input.contentType === undefined ? {} : { contentType: input.contentType }),
    digest: input.digest,
    bytes: input.bytes,
    textPreview: input.textPreview,
    ...(input.rawContent === undefined ? {} : { rawContent: input.rawContent }),
    ...(input.readableContent === undefined ? {} : { readableContent: input.readableContent }),
    ...(input.structuredContent === undefined
      ? {}
      : { structuredContent: toCanonicalJsonValue(input.structuredContent) }),
    ...(input.extractionReport === undefined
      ? {}
      : { extractionReport: cloneExperienceExtractionReport(input.extractionReport) }),
    quality: cloneExperienceQuality(input.quality),
    privacy: input.privacy,
    provenance: input.provenance,
    capturedAtMs: input.capturedAtMs,
  };
}

export function createExperienceQuarantineRecord(
  input: Omit<ExperienceQuarantineRecord, "schemaVersion" | "artifact" | "notes"> & {
    readonly artifact: ExperienceSourceArtifact;
    readonly notes: readonly string[];
  },
): ExperienceQuarantineRecord {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    quarantineId: input.quarantineId,
    artifact: createExperienceSourceArtifact(input.artifact),
    reason: input.reason,
    notes: sortUniqueStrings(input.notes),
    createdAtMs: input.createdAtMs,
  };
}

export function createExperienceReviewDecision(
  input: Omit<ExperienceReviewDecision, "schemaVersion">,
): ExperienceReviewDecision {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    decisionId: input.decisionId,
    candidateId: input.candidateId,
    gate: input.gate,
    decision: input.decision,
    decidedAtMs: input.decidedAtMs,
    ...(input.reviewerId === undefined ? {} : { reviewerId: input.reviewerId }),
    ...(input.note === undefined ? {} : { note: input.note }),
  };
}

export function createExperiencePromotionRecord(
  input: Omit<ExperiencePromotionRecord, "schemaVersion">,
): ExperiencePromotionRecord {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    promotionId: input.promotionId,
    candidateId: input.candidateId,
    promotedTo: input.promotedTo,
    promotedRef: input.promotedRef,
    promotedAtMs: input.promotedAtMs,
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
  };
}

export function createExperienceRollbackRecord(
  input: Omit<ExperienceRollbackRecord, "schemaVersion">,
): ExperienceRollbackRecord {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    rollbackId: input.rollbackId,
    promotionId: input.promotionId,
    candidateId: input.candidateId,
    rolledBackAtMs: input.rolledBackAtMs,
    reason: input.reason,
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
  };
}

export function stringifyCanonicalJson(value: CanonicalJsonValue): string {
  return JSON.stringify(toCanonicalJsonValue(value));
}

function toCanonicalJsonValue(value: CanonicalJsonValue): CanonicalJsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => toCanonicalJsonValue(entry));
  }
  if (value !== null && typeof value === "object") {
    return normalizeCanonicalObject(
      value as Readonly<Record<string, CanonicalJsonValue | undefined>>,
    );
  }
  return value;
}

function normalizeCanonicalObject(
  value: Readonly<Record<string, CanonicalJsonValue | undefined>>,
): { readonly [key: string]: CanonicalJsonValue } {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, toCanonicalJsonValue(entry as CanonicalJsonValue)]),
  );
}

function sortUniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function cloneExperienceTransformation(
  transformation: ExperienceTransformationDeclaration,
): ExperienceTransformationDeclaration {
  return {
    transformId: transformation.transformId,
    kind: transformation.kind,
    summary: transformation.summary,
    ...(transformation.privacyImpact === undefined
      ? {}
      : { privacyImpact: transformation.privacyImpact }),
  };
}

function cloneExperienceEvidenceRef(evidence: ExperienceEvidenceRef): ExperienceEvidenceRef {
  return {
    evidenceId: evidence.evidenceId,
    sourceRef: evidence.sourceRef,
    ...(evidence.path === undefined ? {} : { path: evidence.path }),
    ...(evidence.span === undefined ? {} : { span: evidence.span }),
    summary: evidence.summary,
    ...(evidence.attributes === undefined
      ? {}
      : { attributes: normalizeCanonicalObject(evidence.attributes) }),
  };
}

function cloneExperienceQuality(quality: ExperienceQualityAssessment): ExperienceQualityAssessment {
  return {
    score: normalizeQualityScore(quality.score),
    verdict: quality.verdict,
    reasons: sortUniqueStrings(quality.reasons),
    ...(quality.metrics === undefined
      ? {}
      : { metrics: normalizeCanonicalObject(quality.metrics) }),
  };
}

function cloneExperienceExtractionReport(
  report: ExperienceExtractionReport,
): ExperienceExtractionReport {
  return {
    status: report.status,
    readableChars: normalizeNonNegativeInteger(report.readableChars),
    rawChars: normalizeNonNegativeInteger(report.rawChars),
    transformations: sortUniqueStrings(report.transformations),
    notes: [...report.notes],
    ...(report.unavailable === undefined
      ? {}
      : { unavailable: sortUniqueStrings(report.unavailable) }),
  };
}

function normalizeQualityScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function normalizeNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}
