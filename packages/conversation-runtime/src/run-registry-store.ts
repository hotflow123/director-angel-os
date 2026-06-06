import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type {
  ConversationRunRegistryStore,
  ConversationRunTimelineEvent,
  ConversationTurnRunRecord,
  ConversationTurnRunStatus,
} from "./run-registry.js";

export const CONVERSATION_RUN_REGISTRY_STORE_SCHEMA_VERSION =
  "conversation-run-registry.v1" as const;

export interface ConversationRunRegistryStoreDocument {
  readonly schemaVersion: typeof CONVERSATION_RUN_REGISTRY_STORE_SCHEMA_VERSION;
  readonly runs: readonly ConversationTurnRunRecord[];
}

export interface FileConversationRunRegistryStoreOptions {
  readonly path: string;
}

export function createFileConversationRunRegistryStore(
  options: FileConversationRunRegistryStoreOptions,
): ConversationRunRegistryStore {
  return new FileConversationRunRegistryStore(options.path);
}

class FileConversationRunRegistryStore implements ConversationRunRegistryStore {
  public constructor(private readonly filePath: string) {}

  public load(): readonly ConversationTurnRunRecord[] {
    return readConversationRunRegistryStoreDocument(this.filePath).runs;
  }

  public upsert(record: ConversationTurnRunRecord): void {
    const document = readConversationRunRegistryStoreDocument(this.filePath);
    const runsById = new Map<string, ConversationTurnRunRecord>();
    for (const run of document.runs) {
      runsById.set(run.turnRunId, run);
    }
    runsById.set(record.turnRunId, cloneConversationTurnRunRecord(record));
    const runs = [...runsById.values()].sort(compareConversationTurnRunRecords);
    writeConversationRunRegistryStoreDocument(this.filePath, {
      schemaVersion: CONVERSATION_RUN_REGISTRY_STORE_SCHEMA_VERSION,
      runs,
    });
  }
}

function readConversationRunRegistryStoreDocument(
  filePath: string,
): ConversationRunRegistryStoreDocument {
  if (!existsSync(filePath)) {
    return createEmptyConversationRunRegistryStoreDocument();
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return parseConversationRunRegistryStoreDocument(parsed);
  } catch {
    return createEmptyConversationRunRegistryStoreDocument();
  }
}

function writeConversationRunRegistryStoreDocument(
  filePath: string,
  document: ConversationRunRegistryStoreDocument,
): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

function parseConversationRunRegistryStoreDocument(
  value: unknown,
): ConversationRunRegistryStoreDocument {
  if (!isRecord(value)) {
    return createEmptyConversationRunRegistryStoreDocument();
  }
  if (value.schemaVersion !== CONVERSATION_RUN_REGISTRY_STORE_SCHEMA_VERSION) {
    return createEmptyConversationRunRegistryStoreDocument();
  }
  if (!Array.isArray(value.runs)) {
    return createEmptyConversationRunRegistryStoreDocument();
  }
  return {
    schemaVersion: CONVERSATION_RUN_REGISTRY_STORE_SCHEMA_VERSION,
    runs: value.runs.flatMap((run) => {
      const parsed = parseConversationTurnRunRecord(run);
      return parsed === undefined ? [] : [parsed];
    }),
  };
}

function parseConversationTurnRunRecord(value: unknown): ConversationTurnRunRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    !isNonEmptyString(value.turnRunId) ||
    !isNonEmptyString(value.turnId) ||
    !isNonEmptyString(value.sessionKey) ||
    !isNonEmptyString(value.sourceSurface) ||
    !isNonEmptyString(value.channel) ||
    !isNonEmptyString(value.messageId) ||
    !isNonEmptyString(value.deliveryTarget) ||
    !isConversationTurnRunStatus(value.status) ||
    !isFiniteNumber(value.startedAtMs) ||
    !isFiniteNumber(value.updatedAtMs) ||
    !isStringArray(value.activeToolCalls) ||
    !isStringArray(value.activeSubagentRunIds) ||
    !isStringArray(value.memoryEvidenceRefs) ||
    !isStringArray(value.sourceRefs) ||
    !isStringArray(value.failureTaxonomy) ||
    !Array.isArray(value.events)
  ) {
    return undefined;
  }
  const events = value.events.flatMap((event) => {
    const parsed = parseConversationRunTimelineEvent(event);
    return parsed === undefined ? [] : [parsed];
  });
  const record: ConversationTurnRunRecord = {
    turnRunId: value.turnRunId,
    turnId: value.turnId,
    sessionKey: value.sessionKey,
    sourceSurface: value.sourceSurface,
    channel: value.channel,
    messageId: value.messageId,
    deliveryTarget: value.deliveryTarget,
    status: value.status,
    startedAtMs: value.startedAtMs,
    updatedAtMs: value.updatedAtMs,
    activeToolCalls: [...value.activeToolCalls],
    activeSubagentRunIds: [...value.activeSubagentRunIds],
    memoryEvidenceRefs: [...value.memoryEvidenceRefs],
    sourceRefs: [...value.sourceRefs],
    policyEnvelopeRefs: isStringArray(value.policyEnvelopeRefs)
      ? [...value.policyEnvelopeRefs]
      : [],
    failureTaxonomy: [...value.failureTaxonomy],
    events,
  };
  return appendOptionalConversationTurnRunFields(
    isFiniteNumber(value.endedAtMs) ? { ...record, endedAtMs: value.endedAtMs } : record,
    value,
  );
}

function appendOptionalConversationTurnRunFields(
  record: ConversationTurnRunRecord,
  value: Readonly<Record<string, unknown>>,
): ConversationTurnRunRecord {
  return {
    ...record,
    ...(isNonEmptyString(value.activeModelCall) ? { activeModelCall: value.activeModelCall } : {}),
    ...(isNonEmptyString(value.userVisibleSummary)
      ? { userVisibleSummary: value.userVisibleSummary }
      : {}),
    ...(isNonEmptyString(value.internalFailure) ? { internalFailure: value.internalFailure } : {}),
    ...(isNonEmptyString(value.stopRequestedBy) ? { stopRequestedBy: value.stopRequestedBy } : {}),
    ...(isNonEmptyString(value.stopReason) ? { stopReason: value.stopReason } : {}),
    ...(isFiniteNumber(value.stopRequestedAtMs)
      ? { stopRequestedAtMs: value.stopRequestedAtMs }
      : {}),
    ...(isNonEmptyString(value.runId) ? { runId: value.runId } : {}),
    ...(isRecord(value.metadata) ? { metadata: value.metadata } : {}),
  };
}

function parseConversationRunTimelineEvent(
  value: unknown,
): ConversationRunTimelineEvent | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.kind) ||
    !isFiniteNumber(value.occurredAtMs)
  ) {
    return undefined;
  }
  return {
    id: value.id,
    kind: value.kind,
    occurredAtMs: value.occurredAtMs,
    ...(isNonEmptyString(value.summary) ? { summary: value.summary } : {}),
    ...(isStringArray(value.policyEnvelopeRefs)
      ? { policyEnvelopeRefs: [...value.policyEnvelopeRefs] }
      : {}),
    ...(isRecord(value.metadata) ? { metadata: value.metadata } : {}),
  };
}

function createEmptyConversationRunRegistryStoreDocument(): ConversationRunRegistryStoreDocument {
  return {
    schemaVersion: CONVERSATION_RUN_REGISTRY_STORE_SCHEMA_VERSION,
    runs: [],
  };
}

function compareConversationTurnRunRecords(
  first: ConversationTurnRunRecord,
  second: ConversationTurnRunRecord,
): number {
  return first.startedAtMs - second.startedAtMs || first.turnRunId.localeCompare(second.turnRunId);
}

function cloneConversationTurnRunRecord(
  record: ConversationTurnRunRecord,
): ConversationTurnRunRecord {
  return JSON.parse(JSON.stringify(record)) as ConversationTurnRunRecord;
}

function isConversationTurnRunStatus(value: unknown): value is ConversationTurnRunStatus {
  return (
    value === "received" ||
    value === "queued" ||
    value === "preflight" ||
    value === "running" ||
    value === "awaiting_approval" ||
    value === "delegating" ||
    value === "tool_calling" ||
    value === "finalizing" ||
    value === "completed" ||
    value === "stopping" ||
    value === "cancelled" ||
    value === "failed"
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
