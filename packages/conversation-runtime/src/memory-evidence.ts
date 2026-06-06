export type ConversationRuntimeSourceKind =
  | "url"
  | "weixin-article"
  | "file"
  | "chat"
  | "tool-result"
  | (string & {});

export type ConversationRuntimeSourceAccessStatus =
  | "available"
  | "source_access_limited"
  | "auth_required"
  | "not_found"
  | "failed"
  | "unknown"
  | (string & {});

export type ConversationRuntimeMemoryConfidence = "high" | "medium" | "low" | "unknown";

export type ConversationRuntimeMemoryPrivacy =
  | "public"
  | "pii_potential"
  | "private"
  | (string & {});

export type ConversationRuntimeToolResultEvidenceStatus =
  | "success"
  | "failed"
  | "permission_denied"
  | "aborted"
  | "timeout"
  | "truncated"
  | (string & {});

export interface ConversationRuntimeSourceEvidenceRef {
  readonly id: string;
  readonly sourceKind: ConversationRuntimeSourceKind;
  readonly sourceRef: string;
  readonly sourceSnapshotId?: string;
  readonly sourceAccessStatus: ConversationRuntimeSourceAccessStatus;
  readonly sourceAccessError?: string;
  readonly publishable: boolean;
  readonly privacy: ConversationRuntimeMemoryPrivacy;
  readonly observedAtMs: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CreateConversationRuntimeSourceEvidenceRefInput {
  readonly id: string;
  readonly sourceKind: ConversationRuntimeSourceKind;
  readonly sourceRef: string;
  readonly sourceSnapshotId?: string;
  readonly sourceAccessStatus?: ConversationRuntimeSourceAccessStatus;
  readonly sourceAccessError?: string;
  readonly publishable?: boolean;
  readonly privacy?: ConversationRuntimeMemoryPrivacy;
  readonly observedAtMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeMemoryEvidenceRecord {
  readonly id: string;
  readonly sourceKind: ConversationRuntimeSourceKind;
  readonly sourceRef: string;
  readonly sourceSnapshotId?: string;
  readonly sourceAccessStatus: ConversationRuntimeSourceAccessStatus;
  readonly sourceAccessError?: string;
  readonly confidence: ConversationRuntimeMemoryConfidence;
  readonly publishable: boolean;
  readonly privacy: ConversationRuntimeMemoryPrivacy;
  readonly provenance: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly policyEnvelopeRefs: readonly string[];
  readonly failureTaxonomy: readonly string[];
  readonly userConfirmed: boolean;
  readonly observedAtMs: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CreateConversationRuntimeMemoryEvidenceRecordInput {
  readonly id: string;
  readonly sourceKind: ConversationRuntimeSourceKind;
  readonly sourceRef: string;
  readonly sourceSnapshotId?: string;
  readonly sourceAccessStatus?: ConversationRuntimeSourceAccessStatus;
  readonly sourceAccessError?: string;
  readonly confidence?: ConversationRuntimeMemoryConfidence;
  readonly publishable?: boolean;
  readonly privacy?: ConversationRuntimeMemoryPrivacy;
  readonly provenance?: readonly string[];
  readonly evidenceRefs?: readonly string[];
  readonly policyEnvelopeRefs?: readonly string[];
  readonly failureTaxonomy?: readonly string[];
  readonly userConfirmed?: boolean;
  readonly observedAtMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CreateUrlAccessLimitedMemoryEvidenceInput {
  readonly id: string;
  readonly sourceRef: string;
  readonly sourceSnapshotId?: string;
  readonly sourceAccessError?: string;
  readonly observedAtMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CreateToolResultEvidenceRecordInput {
  readonly id?: string;
  readonly turnId: string;
  readonly turnRunId?: string | undefined;
  readonly sessionKey: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly ok: boolean;
  readonly content: string;
  readonly output?: unknown;
  readonly error?: string;
  readonly sourceRef?: string;
  readonly sourceSnapshotId?: string;
  readonly status?: ConversationRuntimeToolResultEvidenceStatus;
  readonly privacy?: ConversationRuntimeMemoryPrivacy;
  readonly confidence?: ConversationRuntimeMemoryConfidence;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly observedAtMs?: number;
  readonly previewMaxChars?: number;
}

export type ConversationRuntimeEvolutionSignalKind =
  | "turn"
  | "tool-result"
  | "execution-result"
  | "learning-result"
  | (string & {});

export interface ConversationRuntimeEvolutionSignal {
  readonly id: string;
  readonly kind: ConversationRuntimeEvolutionSignalKind;
  readonly publishable: false;
  readonly observedAtMs: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface CreateConversationRuntimeEvolutionSignalsInput {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly result: {
    readonly turnId?: string;
    readonly turnRunId?: string;
    readonly sessionKey?: string;
    readonly surface?: string;
    readonly channel?: string;
    readonly messageId?: string;
    readonly intentKind?: string;
    readonly responsePolicy?: string;
    readonly memoryAction?: string;
    readonly finalText?: string;
    readonly angelRoleProfile?: Readonly<Record<string, unknown>>;
    readonly toolEvidenceRecords?: readonly ConversationRuntimeMemoryEvidenceRecord[];
    readonly traceRefs?: readonly string[];
    readonly observedAtMs?: number;
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
}

export function createSourceEvidenceRef(
  input: CreateConversationRuntimeSourceEvidenceRefInput,
): ConversationRuntimeSourceEvidenceRef {
  const sourceAccessStatus = input.sourceAccessStatus ?? "available";
  return {
    id: input.id,
    sourceKind: input.sourceKind,
    sourceRef: input.sourceRef,
    ...(input.sourceSnapshotId === undefined ? {} : { sourceSnapshotId: input.sourceSnapshotId }),
    sourceAccessStatus,
    ...(input.sourceAccessError === undefined
      ? {}
      : { sourceAccessError: input.sourceAccessError }),
    publishable: input.publishable ?? sourceAccessStatus === "available",
    privacy: input.privacy ?? "pii_potential",
    observedAtMs: input.observedAtMs ?? Date.now(),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

export function createMemoryEvidenceRecord(
  input: CreateConversationRuntimeMemoryEvidenceRecordInput,
): ConversationRuntimeMemoryEvidenceRecord {
  const sourceAccessStatus = input.sourceAccessStatus ?? "available";
  return {
    id: input.id,
    sourceKind: input.sourceKind,
    sourceRef: input.sourceRef,
    ...(input.sourceSnapshotId === undefined ? {} : { sourceSnapshotId: input.sourceSnapshotId }),
    sourceAccessStatus,
    ...(input.sourceAccessError === undefined
      ? {}
      : { sourceAccessError: input.sourceAccessError }),
    confidence: input.confidence ?? (sourceAccessStatus === "available" ? "medium" : "low"),
    publishable: input.publishable ?? sourceAccessStatus === "available",
    privacy: input.privacy ?? "pii_potential",
    provenance: [...(input.provenance ?? [])],
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    policyEnvelopeRefs: [...(input.policyEnvelopeRefs ?? [])],
    failureTaxonomy: [...(input.failureTaxonomy ?? [])],
    userConfirmed: input.userConfirmed ?? false,
    observedAtMs: input.observedAtMs ?? Date.now(),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

export function createUrlAccessLimitedMemoryEvidence(
  input: CreateUrlAccessLimitedMemoryEvidenceInput,
): ConversationRuntimeMemoryEvidenceRecord {
  return createMemoryEvidenceRecord({
    id: input.id,
    sourceKind: "url",
    sourceRef: input.sourceRef,
    ...(input.sourceSnapshotId === undefined ? {} : { sourceSnapshotId: input.sourceSnapshotId }),
    sourceAccessStatus: "source_access_limited",
    ...(input.sourceAccessError === undefined
      ? {}
      : { sourceAccessError: input.sourceAccessError }),
    confidence: "low",
    publishable: false,
    privacy: "pii_potential",
    provenance: ["source-adapter"],
    evidenceRefs: input.sourceSnapshotId === undefined ? [] : [input.sourceSnapshotId],
    failureTaxonomy: ["url_access_limited"],
    userConfirmed: false,
    ...(input.observedAtMs === undefined ? {} : { observedAtMs: input.observedAtMs }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  });
}

export function createToolResultEvidenceRecord(
  input: CreateToolResultEvidenceRecordInput,
): ConversationRuntimeMemoryEvidenceRecord {
  const status = input.status ?? inferToolResultEvidenceStatus(input);
  const outputRecord = isRecord(input.output) ? input.output : undefined;
  const outputQuality = readNestedRecord(outputRecord, "quality");
  const outputSourceSnapshot = readNestedRecord(outputRecord, "source_snapshot");
  const outputEvidenceDisclosure =
    readNestedRecord(outputRecord, "evidence_disclosure") ??
    readNestedRecord(outputRecord, "evidenceDisclosure");
  const outputExternalContent =
    readNestedRecord(outputRecord, "external_content") ??
    readNestedRecord(outputRecord, "externalContent");
  const qualityStatus = readRecordString(outputQuality, "status");
  const qualityReason = readRecordString(outputQuality, "reason");
  const qualityScore = readRecordNumber(outputQuality, "score");
  const sourceSnapshotAccessStatus = readRecordSourceAccessStatus(
    outputSourceSnapshot,
    "access_status",
  );
  const sourceSnapshotId =
    input.sourceSnapshotId ??
    readRecordString(input.metadata, "sourceSnapshotId") ??
    readRecordString(input.metadata, "snapshotId") ??
    readRecordString(input.metadata, "artifactId") ??
    readRecordString(outputSourceSnapshot, "id");
  const preview = createToolResultEvidencePreview(input.content, input.previewMaxChars);
  const declaredTransformations = preview.truncated ? ["tool_result_truncate"] : [];
  const sourceAccessStatus: ConversationRuntimeSourceAccessStatus =
    readRecordSourceAccessStatus(input.metadata, "sourceAccessStatus") ??
    sourceSnapshotAccessStatus ??
    (qualityStatus === "blocked"
      ? "source_access_limited"
      : status === "success" || status === "truncated"
        ? "available"
        : "failed");
  const evidenceId =
    input.id ??
    `tool-evidence-${slugifyEvidenceId(input.turnRunId ?? input.turnId)}-${slugifyEvidenceId(
      input.toolCallId,
    )}`;
  const privacy =
    input.privacy ??
    readRecordMemoryPrivacy(input.metadata, "privacy") ??
    readRecordMemoryPrivacy(input.metadata, "privacyClass") ??
    "pii_potential";
  const failureTaxonomy = createToolResultFailureTaxonomy({
    status,
    ok: input.ok,
    ...(input.error === undefined ? {} : { error: input.error }),
    ...(qualityStatus === undefined ? {} : { qualityStatus }),
    ...(qualityReason === undefined ? {} : { qualityReason }),
  });
  const sourceKind =
    readRecordString(input.metadata, "sourceKind") ??
    ("tool-result" as ConversationRuntimeSourceKind);
  const sourceRef =
    input.sourceRef ??
    readRecordString(input.metadata, "sourceRef") ??
    `tool://${input.toolName}/${input.toolCallId}`;
  const sourceUrl = readToolResultEvidenceSourceUrl(
    input.metadata,
    outputRecord,
    outputExternalContent,
  );
  const declaredEvidenceRefs = readRecordStringArray(input.metadata, "evidenceRefIds") ?? [];
  const policyEnvelopeRefs = readRecordStringArray(input.metadata, "policyEnvelopeRefs") ?? [];
  const metadata = compactRecord({
    ...(input.metadata ?? {}),
    turnId: input.turnId,
    ...(input.turnRunId === undefined ? {} : { turnRunId: input.turnRunId }),
    sessionKey: input.sessionKey,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    status,
    ok: input.ok,
    truncated: preview.truncated,
    declaredTransformations,
    preview: preview.text,
    contentLength: input.content.length,
    outputKind: describeToolResultOutputKind(input.output),
    ...(qualityStatus === undefined ? {} : { qualityStatus }),
    ...(qualityReason === undefined ? {} : { qualityReason }),
    ...(qualityScore === undefined ? {} : { qualityScore }),
    ...(sourceSnapshotId === undefined ? {} : { sourceSnapshotId }),
    ...(outputEvidenceDisclosure === undefined
      ? {}
      : { evidenceDisclosureSnapshot: outputEvidenceDisclosure }),
    ...(outputExternalContent === undefined
      ? {}
      : { externalContentSnapshot: outputExternalContent }),
    ...(input.error === undefined ? {} : { error: input.error }),
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
  });
  const evidenceRefs = [
    ...new Set([
      ...(sourceSnapshotId === undefined ? [] : [sourceSnapshotId]),
      ...declaredEvidenceRefs,
    ]),
  ];

  return createMemoryEvidenceRecord({
    id: evidenceId,
    sourceKind,
    sourceRef,
    ...(sourceSnapshotId === undefined ? {} : { sourceSnapshotId }),
    sourceAccessStatus,
    ...(input.error === undefined ? {} : { sourceAccessError: input.error }),
    confidence:
      input.confidence ??
      (qualityStatus === "blocked"
        ? "low"
        : status === "success" || status === "truncated"
          ? "medium"
          : "low"),
    publishable: false,
    privacy,
    provenance: ["tool-result", "conversation-runtime"],
    evidenceRefs,
    policyEnvelopeRefs,
    failureTaxonomy,
    userConfirmed: false,
    ...(input.observedAtMs === undefined ? {} : { observedAtMs: input.observedAtMs }),
    metadata,
  });
}

export function createConversationRuntimeEvolutionSignals(
  input: CreateConversationRuntimeEvolutionSignalsInput,
): readonly ConversationRuntimeEvolutionSignal[] {
  const observedAtMs = input.result.observedAtMs ?? Date.now();
  const roleProfile = input.result.angelRoleProfile;
  const roleMetadata = createAngelRoleEvolutionMetadata(roleProfile);
  const turnId = input.result.turnId ?? input.turnId;
  const sessionKey = input.result.sessionKey ?? input.sessionKey;
  const signals: ConversationRuntimeEvolutionSignal[] = [
    {
      id: `evolution-turn-${slugifyEvidenceId(turnId)}`,
      kind: "turn",
      publishable: false,
      observedAtMs,
      metadata: compactRecord({
        ...(input.result.metadata ?? {}),
        turnId,
        ...(input.result.turnRunId === undefined ? {} : { turnRunId: input.result.turnRunId }),
        sessionKey,
        ...(input.result.surface === undefined ? {} : { surface: input.result.surface }),
        ...(input.result.channel === undefined ? {} : { channel: input.result.channel }),
        ...(input.result.messageId === undefined ? {} : { messageId: input.result.messageId }),
        ...(input.result.intentKind === undefined ? {} : { intentKind: input.result.intentKind }),
        ...(input.result.responsePolicy === undefined
          ? {}
          : { responsePolicy: input.result.responsePolicy }),
        ...(input.result.memoryAction === undefined
          ? {}
          : { memoryAction: input.result.memoryAction }),
        ...(input.result.finalText === undefined
          ? {}
          : { userVisibleSummary: truncateEvolutionSummary(input.result.finalText, 500) }),
        ...(input.result.traceRefs === undefined ? {} : { traceRefs: [...input.result.traceRefs] }),
        ...roleMetadata,
      }),
    },
  ];

  for (const evidence of input.result.toolEvidenceRecords ?? []) {
    const evidenceMetadata = evidence.metadata ?? {};
    signals.push({
      id: `evolution-tool-${slugifyEvidenceId(evidence.id)}`,
      kind: "tool-result",
      publishable: false,
      observedAtMs: evidence.observedAtMs,
      metadata: compactRecord({
        evidenceId: evidence.id,
        turnId,
        sessionKey,
        sourceKind: evidence.sourceKind,
        sourceRef: evidence.sourceRef,
        sourceAccessStatus: evidence.sourceAccessStatus,
        confidence: evidence.confidence,
        failureTaxonomy: [...evidence.failureTaxonomy],
        toolName: readRecordString(evidenceMetadata, "toolName"),
        toolCallId: readRecordString(evidenceMetadata, "toolCallId"),
        status: readRecordString(evidenceMetadata, "status"),
        ok: evidenceMetadata.ok,
        ...roleMetadata,
      }),
    });
  }

  return signals;
}

function inferToolResultEvidenceStatus(
  input: Pick<CreateToolResultEvidenceRecordInput, "ok" | "error" | "metadata">,
): ConversationRuntimeToolResultEvidenceStatus {
  const explicitStatus = readRecordString(input.metadata, "status");
  if (explicitStatus !== undefined) {
    return explicitStatus;
  }
  if (readRecordBoolean(input.metadata, "aborted") || input.error === "AbortError") {
    return "aborted";
  }
  if (input.error === "timeout" || input.error === "ETIMEDOUT") {
    return "timeout";
  }
  if (
    input.error === "permission-denied" ||
    input.error === "permission_denied" ||
    input.error === "tool-permission-denied"
  ) {
    return "permission_denied";
  }
  return input.ok ? "success" : "failed";
}

function readToolResultEvidenceSourceUrl(
  metadata: Readonly<Record<string, unknown>> | undefined,
  output: Readonly<Record<string, unknown>> | undefined,
  externalContent: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  return (
    readRecordString(metadata, "sourceUrl") ??
    readRecordString(externalContent, "final_url") ??
    readRecordString(externalContent, "finalUrl") ??
    readRecordString(externalContent, "source_url") ??
    readRecordString(externalContent, "sourceUrl") ??
    readRecordString(output, "url") ??
    readRecordString(output, "sourceUrl") ??
    readRecordString(output, "source_url")
  );
}

function createToolResultEvidencePreview(
  content: string,
  maxChars: number | undefined,
): { readonly text: string; readonly truncated: boolean } {
  const limit = maxChars ?? 2000;
  if (content.length <= limit) {
    return { text: content, truncated: false };
  }
  const headLength = Math.max(0, Math.floor(limit / 2));
  const tailLength = Math.max(0, limit - headLength);
  const omitted = content.length - headLength - tailLength;
  return {
    text: `${content.slice(0, headLength)}\n[truncated ${omitted} chars]\n${content.slice(
      content.length - tailLength,
    )}`,
    truncated: true,
  };
}

function createToolResultFailureTaxonomy(input: {
  readonly status: ConversationRuntimeToolResultEvidenceStatus;
  readonly ok: boolean;
  readonly error?: string;
  readonly qualityStatus?: string;
  readonly qualityReason?: string;
}): readonly string[] {
  if (
    input.ok &&
    input.status !== "aborted" &&
    input.status !== "permission_denied" &&
    input.qualityStatus !== "blocked"
  ) {
    return [];
  }
  const values = [
    input.qualityStatus === "blocked" ? "blocked" : input.status,
    input.qualityStatus === "blocked" ? "low_quality_source" : undefined,
    input.qualityReason,
    input.error,
  ].filter((value): value is string => value !== undefined && value.trim().length > 0);
  return [...new Set(values)];
}

function createAngelRoleEvolutionMetadata(
  roleProfile: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
  if (roleProfile === undefined) {
    return {};
  }
  return compactRecord({
    roleId: readRecordString(roleProfile, "roleId"),
    title: readRecordString(roleProfile, "title"),
    domain: readRecordString(roleProfile, "domain"),
    responsibilities: readRecordStringArray(roleProfile, "responsibilities"),
    learningScope: readRecordStringArray(roleProfile, "learningScope"),
    controllableSystems: readRecordStringArray(roleProfile, "controllableSystems"),
  });
}

function truncateEvolutionSummary(value: string, maxChars: number): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 3)}...`;
}

function describeToolResultOutputKind(output: unknown): string {
  if (output === null) {
    return "null";
  }
  if (Array.isArray(output)) {
    return "array";
  }
  return typeof output;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function slugifyEvidenceId(value: string): string {
  const slug = value
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug.length === 0 ? "unknown" : slug;
}

function compactRecord(
  record: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) {
      continue;
    }
    compacted[key] = value;
  }
  return compacted;
}

function readRecordString(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readRecordBoolean(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): boolean {
  return record?.[key] === true;
}

function readRecordNumber(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNestedRecord(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

function readRecordSourceAccessStatus(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): ConversationRuntimeSourceAccessStatus | undefined {
  const value = readRecordString(record, key);
  return value === undefined ? undefined : value;
}

function readRecordStringArray(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): readonly string[] | undefined {
  const value = record?.[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length === 0 ? undefined : items;
}

function readRecordMemoryPrivacy(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): ConversationRuntimeMemoryPrivacy | undefined {
  const value = readRecordString(record, key);
  return value === undefined ? undefined : value;
}
