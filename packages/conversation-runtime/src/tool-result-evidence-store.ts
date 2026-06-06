import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type {
  ConversationRuntimeMemoryConfidence,
  ConversationRuntimeMemoryEvidenceRecord,
  ConversationRuntimeMemoryPrivacy,
  ConversationRuntimeSourceAccessStatus,
  ConversationRuntimeSourceKind,
} from "./memory-evidence.js";

export const CONVERSATION_RUNTIME_TOOL_EVIDENCE_STORE_SCHEMA_VERSION =
  "conversation-runtime.tool-evidence-store.v1" as const;

export interface ConversationRuntimeToolEvidenceContentRef {
  readonly relativePath: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface ConversationRuntimeToolEvidenceIndexEntry {
  readonly evidenceId: string;
  readonly turnId?: string;
  readonly turnRunId?: string;
  readonly sessionKey?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly sourceKind: string;
  readonly sourceRef: string;
  readonly sourceAccessStatus: string;
  readonly confidence: string;
  readonly publishable: boolean;
  readonly observedAtMs: number;
  readonly contentSizeBytes: number;
  readonly contentRef: ConversationRuntimeToolEvidenceContentRef;
}

export interface ConversationRuntimeToolEvidenceStoreDocument {
  readonly schemaVersion: typeof CONVERSATION_RUNTIME_TOOL_EVIDENCE_STORE_SCHEMA_VERSION;
  readonly updatedAtMs: number;
  readonly entries: readonly ConversationRuntimeToolEvidenceIndexEntry[];
}

export interface ConversationRuntimeToolEvidenceRecord {
  readonly indexEntry: ConversationRuntimeToolEvidenceIndexEntry;
  readonly evidence: ConversationRuntimeMemoryEvidenceRecord;
}

export interface ConversationRuntimeToolEvidenceContentReadResult {
  readonly evidenceId: string;
  readonly content: string;
  readonly truncated: boolean;
  readonly contentSizeBytes: number;
}

export interface ConversationRuntimeToolEvidenceWriteResult {
  readonly status: "ok" | "degraded";
  readonly evidenceId: string;
  readonly indexEntry?: ConversationRuntimeToolEvidenceIndexEntry;
  readonly notes: readonly string[];
}

export interface ConversationRuntimeToolEvidenceStoreListOptions {
  readonly evidenceId?: string;
  readonly turnId?: string;
  readonly turnRunId?: string;
  readonly sessionKey?: string;
  readonly toolName?: string;
}

export interface ConversationRuntimeToolEvidenceStoreContentOptions {
  readonly maxChars?: number;
}

export interface ConversationRuntimeToolEvidenceRedactionResult {
  readonly content: string;
  readonly notes?: readonly string[];
}

export interface ConversationRuntimeToolEvidenceRetentionPolicy {
  readonly redactContent?: (input: {
    readonly evidence: ConversationRuntimeMemoryEvidenceRecord;
    readonly content: string;
    readonly mimeType: string;
  }) => ConversationRuntimeToolEvidenceRedactionResult;
}

export interface ConversationRuntimeToolEvidencePruneOptions {
  readonly nowMs: number;
  readonly maxAgeMs: number;
}

export interface ConversationRuntimeToolEvidencePruneResult {
  readonly deletedEvidenceIds: readonly string[];
  readonly retainedEvidenceIds: readonly string[];
}

export interface ConversationRuntimeToolEvidenceStoreUpsertInput {
  readonly evidence: ConversationRuntimeMemoryEvidenceRecord;
  readonly content: string;
  readonly mimeType?: string;
}

export interface ConversationRuntimeToolEvidenceStore {
  readonly upsertToolResultEvidence: (
    input: ConversationRuntimeToolEvidenceStoreUpsertInput,
  ) => ConversationRuntimeToolEvidenceWriteResult;
  readonly listToolResultEvidence: (
    options?: ConversationRuntimeToolEvidenceStoreListOptions,
  ) => readonly ConversationRuntimeToolEvidenceIndexEntry[];
  readonly readToolResultEvidence: (
    evidenceId: string,
  ) => ConversationRuntimeToolEvidenceRecord | undefined;
  readonly readToolResultEvidenceContent: (
    evidenceId: string,
    options?: ConversationRuntimeToolEvidenceStoreContentOptions,
  ) => ConversationRuntimeToolEvidenceContentReadResult | undefined;
  readonly pruneExpiredToolResultEvidence: (
    options: ConversationRuntimeToolEvidencePruneOptions,
  ) => ConversationRuntimeToolEvidencePruneResult;
}

export interface FileConversationRuntimeToolEvidenceStoreOptions {
  readonly rootPath: string;
  readonly nowMs?: () => number;
  readonly retentionPolicy?: ConversationRuntimeToolEvidenceRetentionPolicy;
}

export function createFileConversationRuntimeToolEvidenceStore(
  options: FileConversationRuntimeToolEvidenceStoreOptions,
): ConversationRuntimeToolEvidenceStore {
  return new FileConversationRuntimeToolEvidenceStore(
    options.rootPath,
    options.nowMs,
    options.retentionPolicy,
  );
}

class FileConversationRuntimeToolEvidenceStore implements ConversationRuntimeToolEvidenceStore {
  private readonly nowMs;

  public constructor(
    private readonly rootPath: string,
    nowMs?: () => number,
    private readonly retentionPolicy?: ConversationRuntimeToolEvidenceRetentionPolicy,
  ) {
    this.nowMs = nowMs ?? (() => Date.now());
  }

  public upsertToolResultEvidence(
    input: ConversationRuntimeToolEvidenceStoreUpsertInput,
  ): ConversationRuntimeToolEvidenceWriteResult {
    try {
      const contentRef = this.writeContent(input.evidence, input.content, input.mimeType);
      const evidence = attachToolEvidenceContentRef(input.evidence, contentRef);
      const record = this.createIndexEntry(evidence, contentRef);
      this.writeEvidence(evidence);
      const document = this.readIndexDocument();
      const nextEntriesById = new Map<string, ConversationRuntimeToolEvidenceIndexEntry>();
      for (const entry of document.entries) {
        nextEntriesById.set(entry.evidenceId, entry);
      }
      nextEntriesById.set(record.evidenceId, record);
      this.writeIndexDocument({
        schemaVersion: CONVERSATION_RUNTIME_TOOL_EVIDENCE_STORE_SCHEMA_VERSION,
        updatedAtMs: this.nowMs(),
        entries: [...nextEntriesById.values()].sort(compareToolEvidenceIndexEntries),
      });
      return {
        status: "ok",
        evidenceId: input.evidence.id,
        indexEntry: record,
        notes: [`Stored tool result evidence ${input.evidence.id}.`],
      };
    } catch (error) {
      return {
        status: "degraded",
        evidenceId: input.evidence.id,
        notes: [`Tool result evidence write degraded: ${toErrorMessage(error)}.`],
      };
    }
  }

  public listToolResultEvidence(
    options: ConversationRuntimeToolEvidenceStoreListOptions = {},
  ): readonly ConversationRuntimeToolEvidenceIndexEntry[] {
    return this.readIndexDocument().entries.filter((entry) => matchesListOptions(entry, options));
  }

  public readToolResultEvidence(
    evidenceId: string,
  ): ConversationRuntimeToolEvidenceRecord | undefined {
    const indexEntry = this.readIndexDocument().entries.find(
      (entry) => entry.evidenceId === evidenceId,
    );
    if (indexEntry === undefined) {
      return undefined;
    }
    const evidence = this.readEvidence(evidenceId);
    if (evidence === undefined) {
      return undefined;
    }
    return { indexEntry, evidence };
  }

  public readToolResultEvidenceContent(
    evidenceId: string,
    options: ConversationRuntimeToolEvidenceStoreContentOptions = {},
  ): ConversationRuntimeToolEvidenceContentReadResult | undefined {
    const indexEntry = this.readIndexDocument().entries.find(
      (entry) => entry.evidenceId === evidenceId,
    );
    if (indexEntry === undefined) {
      return undefined;
    }
    const content = readFileSync(join(this.rootPath, indexEntry.contentRef.relativePath), "utf8");
    const maxChars = options.maxChars;
    const truncated = maxChars !== undefined && content.length > maxChars;
    return {
      evidenceId,
      content: truncated ? content.slice(0, maxChars) : content,
      truncated,
      contentSizeBytes: indexEntry.contentSizeBytes,
    };
  }

  public pruneExpiredToolResultEvidence(
    options: ConversationRuntimeToolEvidencePruneOptions,
  ): ConversationRuntimeToolEvidencePruneResult {
    const cutoffMs = options.nowMs - Math.max(0, options.maxAgeMs);
    const document = this.readIndexDocument();
    const deleted: ConversationRuntimeToolEvidenceIndexEntry[] = [];
    const retained: ConversationRuntimeToolEvidenceIndexEntry[] = [];
    for (const entry of document.entries) {
      if (entry.observedAtMs < cutoffMs) {
        deleted.push(entry);
      } else {
        retained.push(entry);
      }
    }
    for (const entry of deleted) {
      removeFileIfExists(join(this.rootPath, entry.contentRef.relativePath));
      removeFileIfExists(join(this.rootPath, "records", `${safeFileToken(entry.evidenceId)}.json`));
    }
    this.writeIndexDocument({
      schemaVersion: CONVERSATION_RUNTIME_TOOL_EVIDENCE_STORE_SCHEMA_VERSION,
      updatedAtMs: this.nowMs(),
      entries: retained,
    });
    return {
      deletedEvidenceIds: deleted.map((entry) => entry.evidenceId),
      retainedEvidenceIds: retained.map((entry) => entry.evidenceId),
    };
  }

  private createIndexEntry(
    evidence: ConversationRuntimeMemoryEvidenceRecord,
    contentRef: ConversationRuntimeToolEvidenceContentRef,
  ): ConversationRuntimeToolEvidenceIndexEntry {
    const turnId = readMetadataString(evidence.metadata, "turnId");
    const turnRunId = readMetadataString(evidence.metadata, "turnRunId");
    const sessionKey = readMetadataString(evidence.metadata, "sessionKey");
    const toolCallId = readMetadataString(evidence.metadata, "toolCallId");
    const toolName = readMetadataString(evidence.metadata, "toolName");
    return {
      evidenceId: evidence.id,
      ...(turnId === undefined ? {} : { turnId }),
      ...(turnRunId === undefined ? {} : { turnRunId }),
      ...(sessionKey === undefined ? {} : { sessionKey }),
      ...(toolCallId === undefined ? {} : { toolCallId }),
      ...(toolName === undefined ? {} : { toolName }),
      sourceKind: evidence.sourceKind,
      sourceRef: evidence.sourceRef,
      sourceAccessStatus: evidence.sourceAccessStatus,
      confidence: evidence.confidence,
      publishable: evidence.publishable,
      observedAtMs: evidence.observedAtMs,
      contentSizeBytes: contentRef.sizeBytes,
      contentRef,
    };
  }

  private writeContent(
    evidence: ConversationRuntimeMemoryEvidenceRecord,
    content: string,
    mimeType = "text/plain; charset=utf-8",
  ): ConversationRuntimeToolEvidenceContentRef {
    const redacted =
      this.retentionPolicy?.redactContent?.({
        evidence,
        content,
        mimeType,
      })?.content ?? content;
    const relativePath = join("contents", `${safeFileToken(evidence.id)}.txt`);
    const absolutePath = join(this.rootPath, relativePath);
    writeTextFileAtomic(absolutePath, redacted);
    return {
      relativePath,
      mimeType,
      sizeBytes: Buffer.byteLength(redacted, "utf8"),
    };
  }

  private writeEvidence(evidence: ConversationRuntimeMemoryEvidenceRecord): void {
    writeTextFileAtomic(
      join(this.rootPath, "records", `${safeFileToken(evidence.id)}.json`),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  }

  private readEvidence(evidenceId: string): ConversationRuntimeMemoryEvidenceRecord | undefined {
    const path = join(this.rootPath, "records", `${safeFileToken(evidenceId)}.json`);
    if (!existsSync(path)) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      return parseMemoryEvidenceRecord(parsed);
    } catch {
      return undefined;
    }
  }

  private readIndexDocument(): ConversationRuntimeToolEvidenceStoreDocument {
    const path = this.indexPath();
    if (!existsSync(path)) {
      return createEmptyToolEvidenceStoreDocument(this.nowMs());
    }
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      return parseToolEvidenceStoreDocument(parsed, this.nowMs());
    } catch {
      return createEmptyToolEvidenceStoreDocument(this.nowMs());
    }
  }

  private writeIndexDocument(document: ConversationRuntimeToolEvidenceStoreDocument): void {
    writeTextFileAtomic(this.indexPath(), `${JSON.stringify(document, null, 2)}\n`);
  }

  private indexPath(): string {
    return join(this.rootPath, "index.json");
  }
}

function parseToolEvidenceStoreDocument(
  value: unknown,
  nowMs: number,
): ConversationRuntimeToolEvidenceStoreDocument {
  if (!isRecord(value)) {
    return createEmptyToolEvidenceStoreDocument(nowMs);
  }
  if (value.schemaVersion !== CONVERSATION_RUNTIME_TOOL_EVIDENCE_STORE_SCHEMA_VERSION) {
    return createEmptyToolEvidenceStoreDocument(nowMs);
  }
  if (!Array.isArray(value.entries)) {
    return createEmptyToolEvidenceStoreDocument(nowMs);
  }
  return {
    schemaVersion: CONVERSATION_RUNTIME_TOOL_EVIDENCE_STORE_SCHEMA_VERSION,
    updatedAtMs: readFiniteNumber(value.updatedAtMs) ?? nowMs,
    entries: value.entries.flatMap((entry) => {
      const parsed = parseToolEvidenceIndexEntry(entry);
      return parsed === undefined ? [] : [parsed];
    }),
  };
}

function attachToolEvidenceContentRef(
  evidence: ConversationRuntimeMemoryEvidenceRecord,
  contentRef: ConversationRuntimeToolEvidenceContentRef,
): ConversationRuntimeMemoryEvidenceRecord {
  return {
    ...evidence,
    metadata: {
      ...(evidence.metadata ?? {}),
      contentRef: {
        kind: "tool-ledger",
        evidenceId: evidence.id,
        relativePath: contentRef.relativePath,
        mimeType: contentRef.mimeType,
        sizeBytes: contentRef.sizeBytes,
      },
    },
  };
}

function parseToolEvidenceIndexEntry(
  value: unknown,
): ConversationRuntimeToolEvidenceIndexEntry | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const contentRef = parseToolEvidenceContentRef(value.contentRef);
  const observedAtMs = readFiniteNumber(value.observedAtMs);
  const contentSizeBytes = readFiniteNumber(value.contentSizeBytes);
  if (
    !isNonEmptyString(value.evidenceId) ||
    !isNonEmptyString(value.sourceKind) ||
    !isNonEmptyString(value.sourceRef) ||
    !isNonEmptyString(value.sourceAccessStatus) ||
    !isNonEmptyString(value.confidence) ||
    typeof value.publishable !== "boolean" ||
    observedAtMs === undefined ||
    contentSizeBytes === undefined ||
    contentRef === undefined
  ) {
    return undefined;
  }
  return {
    evidenceId: value.evidenceId,
    ...(isNonEmptyString(value.turnId) ? { turnId: value.turnId } : {}),
    ...(isNonEmptyString(value.turnRunId) ? { turnRunId: value.turnRunId } : {}),
    ...(isNonEmptyString(value.sessionKey) ? { sessionKey: value.sessionKey } : {}),
    ...(isNonEmptyString(value.toolCallId) ? { toolCallId: value.toolCallId } : {}),
    ...(isNonEmptyString(value.toolName) ? { toolName: value.toolName } : {}),
    sourceKind: value.sourceKind,
    sourceRef: value.sourceRef,
    sourceAccessStatus: value.sourceAccessStatus,
    confidence: value.confidence,
    publishable: value.publishable,
    observedAtMs,
    contentSizeBytes,
    contentRef,
  };
}

function parseToolEvidenceContentRef(
  value: unknown,
): ConversationRuntimeToolEvidenceContentRef | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const sizeBytes = readFiniteNumber(value.sizeBytes);
  if (
    !isSafeRelativeStorePath(value.relativePath) ||
    !isNonEmptyString(value.mimeType) ||
    sizeBytes === undefined
  ) {
    return undefined;
  }
  return {
    relativePath: value.relativePath,
    mimeType: value.mimeType,
    sizeBytes,
  };
}

function parseMemoryEvidenceRecord(
  value: unknown,
): ConversationRuntimeMemoryEvidenceRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const observedAtMs = readFiniteNumber(value.observedAtMs);
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.sourceKind) ||
    !isNonEmptyString(value.sourceRef) ||
    !isNonEmptyString(value.sourceAccessStatus) ||
    !isNonEmptyString(value.confidence) ||
    typeof value.publishable !== "boolean" ||
    !isNonEmptyString(value.privacy) ||
    !Array.isArray(value.provenance) ||
    !Array.isArray(value.evidenceRefs) ||
    !Array.isArray(value.policyEnvelopeRefs) ||
    !Array.isArray(value.failureTaxonomy) ||
    typeof value.userConfirmed !== "boolean" ||
    observedAtMs === undefined
  ) {
    return undefined;
  }
  return {
    id: value.id,
    sourceKind: value.sourceKind as ConversationRuntimeSourceKind,
    sourceRef: value.sourceRef,
    ...(isNonEmptyString(value.sourceSnapshotId)
      ? { sourceSnapshotId: value.sourceSnapshotId }
      : {}),
    sourceAccessStatus: value.sourceAccessStatus as ConversationRuntimeSourceAccessStatus,
    ...(isNonEmptyString(value.sourceAccessError)
      ? { sourceAccessError: value.sourceAccessError }
      : {}),
    confidence: value.confidence as ConversationRuntimeMemoryConfidence,
    publishable: value.publishable,
    privacy: value.privacy as ConversationRuntimeMemoryPrivacy,
    provenance: value.provenance.filter(isNonEmptyString),
    evidenceRefs: value.evidenceRefs.filter(isNonEmptyString),
    policyEnvelopeRefs: value.policyEnvelopeRefs.filter(isNonEmptyString),
    failureTaxonomy: value.failureTaxonomy.filter(isNonEmptyString),
    userConfirmed: value.userConfirmed,
    observedAtMs,
    ...(isRecord(value.metadata) ? { metadata: value.metadata } : {}),
  };
}

function createEmptyToolEvidenceStoreDocument(
  updatedAtMs: number,
): ConversationRuntimeToolEvidenceStoreDocument {
  return {
    schemaVersion: CONVERSATION_RUNTIME_TOOL_EVIDENCE_STORE_SCHEMA_VERSION,
    updatedAtMs,
    entries: [],
  };
}

function matchesListOptions(
  entry: ConversationRuntimeToolEvidenceIndexEntry,
  options: ConversationRuntimeToolEvidenceStoreListOptions,
): boolean {
  return (
    (options.evidenceId === undefined || entry.evidenceId === options.evidenceId) &&
    (options.turnId === undefined || entry.turnId === options.turnId) &&
    (options.turnRunId === undefined || entry.turnRunId === options.turnRunId) &&
    (options.sessionKey === undefined || entry.sessionKey === options.sessionKey) &&
    (options.toolName === undefined || entry.toolName === options.toolName)
  );
}

function compareToolEvidenceIndexEntries(
  first: ConversationRuntimeToolEvidenceIndexEntry,
  second: ConversationRuntimeToolEvidenceIndexEntry,
): number {
  return (
    first.observedAtMs - second.observedAtMs || first.evidenceId.localeCompare(second.evidenceId)
  );
}

function writeTextFileAtomic(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, content, "utf8");
  renameSync(tempPath, path);
}

function removeFileIfExists(path: string): void {
  try {
    unlinkSync(path);
  } catch {}
}

function safeFileToken(value: string): string {
  const token = value
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/gu, "-")
    .replace(/\.+/gu, ".")
    .replace(/^-+|-+$/gu, "");
  const withoutTraversal = token.replace(/\.\./gu, ".").replace(/^\.+/u, "");
  return withoutTraversal.length > 0 ? withoutTraversal : "evidence";
}

function isSafeRelativeStorePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !value.startsWith("/") &&
    !value.split(/[\\/]+/u).includes("..")
  );
}

function readMetadataString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return isNonEmptyString(value) ? value : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
