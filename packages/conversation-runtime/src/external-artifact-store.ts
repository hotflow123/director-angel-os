import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { ExternalToolArtifact } from "./external-tools.js";

export const CONVERSATION_RUNTIME_EXTERNAL_ARTIFACT_RECORD_SCHEMA_VERSION =
  "conversation-runtime.external-artifact-record.v1" as const;

export const CONVERSATION_RUNTIME_EXTERNAL_ARTIFACT_TOMBSTONE_SCHEMA_VERSION =
  "conversation-runtime.external-artifact-tombstone.v1" as const;

export const CONVERSATION_RUNTIME_EXTERNAL_ARTIFACT_STORE_SCHEMA_VERSION =
  "conversation-runtime.external-artifact-store.v1" as const;

export type ConversationRuntimeExternalArtifactRetention =
  | "ephemeral"
  | "persistent"
  | "user_controlled"
  | (string & {});

export type ConversationRuntimeExternalArtifactSensitivity =
  | "confidential"
  | "internal"
  | "public"
  | (string & {});

export interface ConversationRuntimeExternalArtifactStorageRef {
  readonly kind: "external-artifact-store-record";
  readonly relativePath: string;
}

export interface ConversationRuntimeExternalArtifactRecord {
  readonly schemaVersion: typeof CONVERSATION_RUNTIME_EXTERNAL_ARTIFACT_RECORD_SCHEMA_VERSION;
  readonly artifactId: string;
  readonly kind: string;
  readonly providerId: string;
  readonly toolId: string;
  readonly operationId?: string;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly projectId?: string;
  readonly runId?: string;
  readonly stepId?: string;
  readonly localPath?: string;
  readonly url?: string;
  readonly createdAtMs: number;
  readonly expiresAtMs?: number;
  readonly retention: ConversationRuntimeExternalArtifactRetention;
  readonly sensitivity: ConversationRuntimeExternalArtifactSensitivity;
  readonly cleanupPolicyRef: string;
  readonly storageRef: ConversationRuntimeExternalArtifactStorageRef;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeExternalArtifactTombstone {
  readonly schemaVersion: typeof CONVERSATION_RUNTIME_EXTERNAL_ARTIFACT_TOMBSTONE_SCHEMA_VERSION;
  readonly artifactId: string;
  readonly deletedAtMs: number;
  readonly reason: "expired" | "removed" | (string & {});
  readonly previousRecord: ConversationRuntimeExternalArtifactRecord;
}

export interface ConversationRuntimeExternalArtifactStoreDocument {
  readonly schemaVersion: typeof CONVERSATION_RUNTIME_EXTERNAL_ARTIFACT_STORE_SCHEMA_VERSION;
  readonly updatedAtMs: number;
  readonly artifacts: readonly ConversationRuntimeExternalArtifactRecord[];
  readonly tombstones: readonly ConversationRuntimeExternalArtifactTombstone[];
}

export interface ConversationRuntimeExternalArtifactStoreUpsertInput {
  readonly providerId: string;
  readonly toolId: string;
  readonly operationId?: string;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly projectId?: string;
  readonly runId?: string;
  readonly stepId?: string;
  readonly artifacts: readonly ExternalToolArtifact[];
  readonly retention?: ConversationRuntimeExternalArtifactRetention;
  readonly sensitivity?: ConversationRuntimeExternalArtifactSensitivity;
  readonly cleanupPolicyRef?: string;
  readonly ttlMs?: number;
}

export interface ConversationRuntimeExternalArtifactStoreListOptions {
  readonly artifactId?: string;
  readonly providerId?: string;
  readonly toolId?: string;
  readonly operationId?: string;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly projectId?: string;
  readonly runId?: string;
  readonly stepId?: string;
  readonly includeExpired?: boolean;
}

export interface ConversationRuntimeExternalArtifactTombstoneListOptions {
  readonly artifactId?: string;
  readonly providerId?: string;
  readonly projectId?: string;
  readonly runId?: string;
}

export interface ConversationRuntimeExternalArtifactStoreWriteResult {
  readonly status: "ok" | "degraded";
  readonly artifactIds: readonly string[];
  readonly records?: readonly ConversationRuntimeExternalArtifactRecord[];
  readonly notes: readonly string[];
}

export interface ConversationRuntimeExternalArtifactPruneOptions {
  readonly nowMs?: number;
  readonly reason?: "expired" | "removed" | (string & {});
}

export interface ConversationRuntimeExternalArtifactPruneResult {
  readonly expiredArtifactIds: readonly string[];
  readonly retainedArtifactIds: readonly string[];
  readonly tombstoneIds: readonly string[];
}

export interface ConversationRuntimeExternalArtifactStore {
  readonly upsertArtifacts: (
    input: ConversationRuntimeExternalArtifactStoreUpsertInput,
  ) => ConversationRuntimeExternalArtifactStoreWriteResult;
  readonly listArtifacts: (
    options?: ConversationRuntimeExternalArtifactStoreListOptions,
  ) => readonly ConversationRuntimeExternalArtifactRecord[];
  readonly readArtifact: (
    artifactId: string,
  ) => ConversationRuntimeExternalArtifactRecord | undefined;
  readonly listTombstones: (
    options?: ConversationRuntimeExternalArtifactTombstoneListOptions,
  ) => readonly ConversationRuntimeExternalArtifactTombstone[];
  readonly pruneExpiredArtifacts: (
    options?: ConversationRuntimeExternalArtifactPruneOptions,
  ) => ConversationRuntimeExternalArtifactPruneResult;
}

export interface FileConversationRuntimeExternalArtifactStoreOptions {
  readonly rootPath: string;
  readonly nowMs?: () => number;
  readonly defaultTtlMs?: number;
  readonly defaultRetention?: ConversationRuntimeExternalArtifactRetention;
  readonly defaultSensitivity?: ConversationRuntimeExternalArtifactSensitivity;
  readonly defaultCleanupPolicyRef?: string;
}

const EXTERNAL_ARTIFACT_STORE_FILE = "external-artifacts.json";
const DEFAULT_EXTERNAL_ARTIFACT_RETENTION: ConversationRuntimeExternalArtifactRetention =
  "ephemeral";
const DEFAULT_EXTERNAL_ARTIFACT_SENSITIVITY: ConversationRuntimeExternalArtifactSensitivity =
  "internal";
const DEFAULT_EXTERNAL_ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EXTERNAL_ARTIFACT_CLEANUP_POLICY_REF = "artifactPolicy.external.ephemeral";

export function createFileConversationRuntimeExternalArtifactStore(
  options: FileConversationRuntimeExternalArtifactStoreOptions,
): ConversationRuntimeExternalArtifactStore {
  return new FileConversationRuntimeExternalArtifactStore(options);
}

class FileConversationRuntimeExternalArtifactStore
  implements ConversationRuntimeExternalArtifactStore
{
  readonly #rootPath: string;
  readonly #nowMs: () => number;
  readonly #defaultTtlMs: number;
  readonly #defaultRetention: ConversationRuntimeExternalArtifactRetention;
  readonly #defaultSensitivity: ConversationRuntimeExternalArtifactSensitivity;
  readonly #defaultCleanupPolicyRef: string;

  public constructor(options: FileConversationRuntimeExternalArtifactStoreOptions) {
    this.#rootPath = options.rootPath;
    this.#nowMs = options.nowMs ?? (() => Date.now());
    this.#defaultTtlMs =
      typeof options.defaultTtlMs === "number" &&
      Number.isFinite(options.defaultTtlMs) &&
      options.defaultTtlMs > 0
        ? options.defaultTtlMs
        : DEFAULT_EXTERNAL_ARTIFACT_TTL_MS;
    this.#defaultRetention = options.defaultRetention ?? DEFAULT_EXTERNAL_ARTIFACT_RETENTION;
    this.#defaultSensitivity = options.defaultSensitivity ?? DEFAULT_EXTERNAL_ARTIFACT_SENSITIVITY;
    this.#defaultCleanupPolicyRef =
      options.defaultCleanupPolicyRef ?? DEFAULT_EXTERNAL_ARTIFACT_CLEANUP_POLICY_REF;
  }

  public upsertArtifacts(
    input: ConversationRuntimeExternalArtifactStoreUpsertInput,
  ): ConversationRuntimeExternalArtifactStoreWriteResult {
    try {
      const document = this.#readDocument();
      const artifactMap = new Map(
        document.artifacts.map((artifact) => [artifact.artifactId, artifact]),
      );
      const tombstoneMap = new Map(
        document.tombstones.map((tombstone) => [tombstone.artifactId, tombstone]),
      );
      const records = input.artifacts.map((artifact) => this.#createRecord(input, artifact));
      for (const record of records) {
        artifactMap.set(record.artifactId, record);
        tombstoneMap.delete(record.artifactId);
        this.#writeRecord(record);
      }
      this.#writeDocument({
        schemaVersion: CONVERSATION_RUNTIME_EXTERNAL_ARTIFACT_STORE_SCHEMA_VERSION,
        updatedAtMs: this.#nowMs(),
        artifacts: [...artifactMap.values()].sort(compareExternalArtifactRecords),
        tombstones: [...tombstoneMap.values()].sort(compareExternalArtifactTombstones),
      });
      return {
        status: "ok",
        artifactIds: records.map((record) => record.artifactId),
        records,
        notes: [`Stored ${records.length} external artifact record(s).`],
      };
    } catch (error) {
      return {
        status: "degraded",
        artifactIds: input.artifacts.map((artifact) => artifact.id),
        notes: [`External artifact store write degraded: ${toErrorMessage(error)}.`],
      };
    }
  }

  public listArtifacts(
    options: ConversationRuntimeExternalArtifactStoreListOptions = {},
  ): readonly ConversationRuntimeExternalArtifactRecord[] {
    const nowMs = this.#nowMs();
    return this.#readDocument().artifacts.filter((artifact) =>
      matchesArtifactListOptions(artifact, options, nowMs),
    );
  }

  public readArtifact(artifactId: string): ConversationRuntimeExternalArtifactRecord | undefined {
    return this.#readDocument().artifacts.find((artifact) => artifact.artifactId === artifactId);
  }

  public listTombstones(
    options: ConversationRuntimeExternalArtifactTombstoneListOptions = {},
  ): readonly ConversationRuntimeExternalArtifactTombstone[] {
    return this.#readDocument().tombstones.filter((tombstone) =>
      matchesTombstoneListOptions(tombstone, options),
    );
  }

  public pruneExpiredArtifacts(
    options: ConversationRuntimeExternalArtifactPruneOptions = {},
  ): ConversationRuntimeExternalArtifactPruneResult {
    const nowMs = options.nowMs ?? this.#nowMs();
    const document = this.#readDocument();
    const retained: ConversationRuntimeExternalArtifactRecord[] = [];
    const expired: ConversationRuntimeExternalArtifactRecord[] = [];
    for (const artifact of document.artifacts) {
      if (shouldPruneExternalArtifact(artifact, nowMs)) {
        expired.push(artifact);
      } else {
        retained.push(artifact);
      }
    }
    const tombstoneMap = new Map(
      document.tombstones.map((tombstone) => [tombstone.artifactId, tombstone]),
    );
    for (const artifact of expired) {
      tombstoneMap.set(artifact.artifactId, {
        schemaVersion: CONVERSATION_RUNTIME_EXTERNAL_ARTIFACT_TOMBSTONE_SCHEMA_VERSION,
        artifactId: artifact.artifactId,
        deletedAtMs: nowMs,
        reason: options.reason ?? "expired",
        previousRecord: artifact,
      });
      removeFileIfExists(join(this.#rootPath, artifact.storageRef.relativePath));
    }
    this.#writeDocument({
      schemaVersion: CONVERSATION_RUNTIME_EXTERNAL_ARTIFACT_STORE_SCHEMA_VERSION,
      updatedAtMs: this.#nowMs(),
      artifacts: retained.sort(compareExternalArtifactRecords),
      tombstones: [...tombstoneMap.values()].sort(compareExternalArtifactTombstones),
    });
    return {
      expiredArtifactIds: expired.map((artifact) => artifact.artifactId),
      retainedArtifactIds: retained.map((artifact) => artifact.artifactId),
      tombstoneIds: expired.map((artifact) => artifact.artifactId),
    };
  }

  #createRecord(
    input: ConversationRuntimeExternalArtifactStoreUpsertInput,
    artifact: ExternalToolArtifact,
  ): ConversationRuntimeExternalArtifactRecord {
    const createdAtMs = this.#nowMs();
    const retention =
      readRecordString(artifact.metadata, "retention") ?? input.retention ?? this.#defaultRetention;
    const ttlMs =
      normalizePositiveMs(readRecordNumber(artifact.metadata, "ttlMs") ?? input.ttlMs) ??
      this.#defaultTtlMs;
    const storageRef = createExternalArtifactStorageRef(artifact.id);
    const expiresAtMs = retention === "ephemeral" ? createdAtMs + ttlMs : undefined;
    return {
      schemaVersion: CONVERSATION_RUNTIME_EXTERNAL_ARTIFACT_RECORD_SCHEMA_VERSION,
      artifactId: artifact.id,
      kind: artifact.kind,
      providerId: input.providerId,
      toolId: input.toolId,
      ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
      ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
      ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
      ...optionalStringField(
        "projectId",
        input.projectId ?? readRecordString(artifact.metadata, "projectId"),
      ),
      ...optionalStringField("runId", input.runId ?? readRecordString(artifact.metadata, "runId")),
      ...optionalStringField(
        "stepId",
        input.stepId ?? readRecordString(artifact.metadata, "stepId"),
      ),
      ...optionalStringField("localPath", artifact.path),
      ...optionalStringField("url", artifact.url),
      createdAtMs,
      ...(expiresAtMs === undefined ? {} : { expiresAtMs }),
      retention,
      sensitivity:
        readRecordString(artifact.metadata, "sensitivity") ??
        input.sensitivity ??
        this.#defaultSensitivity,
      cleanupPolicyRef:
        readRecordString(artifact.metadata, "cleanupPolicyRef") ??
        input.cleanupPolicyRef ??
        this.#defaultCleanupPolicyRef,
      storageRef,
      ...(artifact.metadata === undefined ? {} : { metadata: artifact.metadata }),
    };
  }

  #writeRecord(record: ConversationRuntimeExternalArtifactRecord): void {
    writeTextFileAtomic(
      join(this.#rootPath, record.storageRef.relativePath),
      `${JSON.stringify(record, null, 2)}\n`,
    );
  }

  #readDocument(): ConversationRuntimeExternalArtifactStoreDocument {
    const path = this.#indexPath();
    if (!existsSync(path)) {
      return createEmptyExternalArtifactStoreDocument(this.#nowMs());
    }
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      return parseExternalArtifactStoreDocument(parsed, this.#nowMs());
    } catch {
      return createEmptyExternalArtifactStoreDocument(this.#nowMs());
    }
  }

  #writeDocument(document: ConversationRuntimeExternalArtifactStoreDocument): void {
    writeTextFileAtomic(this.#indexPath(), `${JSON.stringify(document, null, 2)}\n`);
  }

  #indexPath(): string {
    return join(this.#rootPath, EXTERNAL_ARTIFACT_STORE_FILE);
  }
}

function createEmptyExternalArtifactStoreDocument(
  updatedAtMs: number,
): ConversationRuntimeExternalArtifactStoreDocument {
  return {
    schemaVersion: CONVERSATION_RUNTIME_EXTERNAL_ARTIFACT_STORE_SCHEMA_VERSION,
    updatedAtMs,
    artifacts: [],
    tombstones: [],
  };
}

function parseExternalArtifactStoreDocument(
  value: unknown,
  nowMs: number,
): ConversationRuntimeExternalArtifactStoreDocument {
  if (!isRecord(value)) {
    return createEmptyExternalArtifactStoreDocument(nowMs);
  }
  if (value.schemaVersion !== CONVERSATION_RUNTIME_EXTERNAL_ARTIFACT_STORE_SCHEMA_VERSION) {
    return createEmptyExternalArtifactStoreDocument(nowMs);
  }
  const updatedAtMs = readFiniteNumber(value.updatedAtMs) ?? nowMs;
  return {
    schemaVersion: CONVERSATION_RUNTIME_EXTERNAL_ARTIFACT_STORE_SCHEMA_VERSION,
    updatedAtMs,
    artifacts: Array.isArray(value.artifacts)
      ? value.artifacts.flatMap((artifact) => {
          const parsed = parseExternalArtifactRecord(artifact);
          return parsed === undefined ? [] : [parsed];
        })
      : [],
    tombstones: Array.isArray(value.tombstones)
      ? value.tombstones.flatMap((tombstone) => {
          const parsed = parseExternalArtifactTombstone(tombstone);
          return parsed === undefined ? [] : [parsed];
        })
      : [],
  };
}

function parseExternalArtifactRecord(
  value: unknown,
): ConversationRuntimeExternalArtifactRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const createdAtMs = readFiniteNumber(value.createdAtMs);
  const expiresAtMs = readFiniteNumber(value.expiresAtMs);
  const storageRef = parseExternalArtifactStorageRef(value.storageRef);
  if (
    value.schemaVersion !== CONVERSATION_RUNTIME_EXTERNAL_ARTIFACT_RECORD_SCHEMA_VERSION ||
    !isNonEmptyString(value.artifactId) ||
    !isNonEmptyString(value.kind) ||
    !isNonEmptyString(value.providerId) ||
    !isNonEmptyString(value.toolId) ||
    createdAtMs === undefined ||
    !isNonEmptyString(value.retention) ||
    !isNonEmptyString(value.sensitivity) ||
    !isNonEmptyString(value.cleanupPolicyRef) ||
    storageRef === undefined
  ) {
    return undefined;
  }
  return {
    schemaVersion: CONVERSATION_RUNTIME_EXTERNAL_ARTIFACT_RECORD_SCHEMA_VERSION,
    artifactId: value.artifactId,
    kind: value.kind,
    providerId: value.providerId,
    toolId: value.toolId,
    ...optionalStringField("operationId", value.operationId),
    ...optionalStringField("turnId", value.turnId),
    ...optionalStringField("sessionKey", value.sessionKey),
    ...optionalStringField("projectId", value.projectId),
    ...optionalStringField("runId", value.runId),
    ...optionalStringField("stepId", value.stepId),
    ...optionalStringField("localPath", value.localPath),
    ...optionalStringField("url", value.url),
    createdAtMs,
    ...(expiresAtMs === undefined ? {} : { expiresAtMs }),
    retention: value.retention,
    sensitivity: value.sensitivity,
    cleanupPolicyRef: value.cleanupPolicyRef,
    storageRef,
    ...(isRecord(value.metadata) ? { metadata: value.metadata } : {}),
  };
}

function parseExternalArtifactTombstone(
  value: unknown,
): ConversationRuntimeExternalArtifactTombstone | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const deletedAtMs = readFiniteNumber(value.deletedAtMs);
  const previousRecord = parseExternalArtifactRecord(value.previousRecord);
  if (
    value.schemaVersion !== CONVERSATION_RUNTIME_EXTERNAL_ARTIFACT_TOMBSTONE_SCHEMA_VERSION ||
    !isNonEmptyString(value.artifactId) ||
    deletedAtMs === undefined ||
    !isNonEmptyString(value.reason) ||
    previousRecord === undefined
  ) {
    return undefined;
  }
  return {
    schemaVersion: CONVERSATION_RUNTIME_EXTERNAL_ARTIFACT_TOMBSTONE_SCHEMA_VERSION,
    artifactId: value.artifactId,
    deletedAtMs,
    reason: value.reason,
    previousRecord,
  };
}

function parseExternalArtifactStorageRef(
  value: unknown,
): ConversationRuntimeExternalArtifactStorageRef | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    value.kind !== "external-artifact-store-record" ||
    !isSafeRelativeStorePath(value.relativePath)
  ) {
    return undefined;
  }
  return {
    kind: "external-artifact-store-record",
    relativePath: value.relativePath,
  };
}

function matchesArtifactListOptions(
  artifact: ConversationRuntimeExternalArtifactRecord,
  options: ConversationRuntimeExternalArtifactStoreListOptions,
  nowMs: number,
): boolean {
  return (
    (options.includeExpired === true ||
      artifact.expiresAtMs === undefined ||
      artifact.expiresAtMs > nowMs) &&
    (options.artifactId === undefined || artifact.artifactId === options.artifactId) &&
    (options.providerId === undefined || artifact.providerId === options.providerId) &&
    (options.toolId === undefined || artifact.toolId === options.toolId) &&
    (options.operationId === undefined || artifact.operationId === options.operationId) &&
    (options.turnId === undefined || artifact.turnId === options.turnId) &&
    (options.sessionKey === undefined || artifact.sessionKey === options.sessionKey) &&
    (options.projectId === undefined || artifact.projectId === options.projectId) &&
    (options.runId === undefined || artifact.runId === options.runId) &&
    (options.stepId === undefined || artifact.stepId === options.stepId)
  );
}

function matchesTombstoneListOptions(
  tombstone: ConversationRuntimeExternalArtifactTombstone,
  options: ConversationRuntimeExternalArtifactTombstoneListOptions,
): boolean {
  return (
    (options.artifactId === undefined || tombstone.artifactId === options.artifactId) &&
    (options.providerId === undefined ||
      tombstone.previousRecord.providerId === options.providerId) &&
    (options.projectId === undefined || tombstone.previousRecord.projectId === options.projectId) &&
    (options.runId === undefined || tombstone.previousRecord.runId === options.runId)
  );
}

function shouldPruneExternalArtifact(
  artifact: ConversationRuntimeExternalArtifactRecord,
  nowMs: number,
): boolean {
  return (
    artifact.retention === "ephemeral" &&
    artifact.expiresAtMs !== undefined &&
    artifact.expiresAtMs <= nowMs
  );
}

function createExternalArtifactStorageRef(
  artifactId: string,
): ConversationRuntimeExternalArtifactStorageRef {
  return {
    kind: "external-artifact-store-record",
    relativePath: join("records", `${safeFileToken(artifactId)}.json`),
  };
}

function compareExternalArtifactRecords(
  first: ConversationRuntimeExternalArtifactRecord,
  second: ConversationRuntimeExternalArtifactRecord,
): number {
  return (
    first.createdAtMs - second.createdAtMs || first.artifactId.localeCompare(second.artifactId)
  );
}

function compareExternalArtifactTombstones(
  first: ConversationRuntimeExternalArtifactTombstone,
  second: ConversationRuntimeExternalArtifactTombstone,
): number {
  return (
    first.deletedAtMs - second.deletedAtMs || first.artifactId.localeCompare(second.artifactId)
  );
}

function optionalStringField(key: string, value: unknown): Readonly<Record<string, string>> {
  return isNonEmptyString(value) ? { [key]: value } : {};
}

function normalizePositiveMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function readRecordString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return isNonEmptyString(value[key]) ? value[key] : undefined;
}

function readRecordNumber(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return readFiniteNumber(value[key]);
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
  return withoutTraversal.length > 0 ? withoutTraversal : "artifact";
}

function isSafeRelativeStorePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !value.startsWith("/") &&
    !value.split(/[\\/]+/u).includes("..")
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
