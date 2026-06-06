import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const CONVERSATION_RUNTIME_CONTEXT_CHECKPOINT_SCHEMA_VERSION =
  "conversation-runtime.context-checkpoint.v1" as const;

export const CONVERSATION_RUNTIME_CONTEXT_CHECKPOINT_STORE_SCHEMA_VERSION =
  "conversation-runtime.context-checkpoint-store.v1" as const;

export type ConversationRuntimeContextCheckpointStatus =
  | "started"
  | "partial_saved"
  | "completed"
  | "failed";

export interface ConversationRuntimeContextCheckpoint {
  readonly schemaVersion: typeof CONVERSATION_RUNTIME_CONTEXT_CHECKPOINT_SCHEMA_VERSION;
  readonly checkpointId: string;
  readonly sessionKey: string;
  readonly turnId: string;
  readonly status: ConversationRuntimeContextCheckpointStatus;
  readonly summary?: string;
  readonly reason?: string;
  readonly sourceEventIds?: readonly string[];
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface ConversationRuntimeContextPartialSummary {
  readonly checkpointId: string;
  readonly sessionKey: string;
  readonly turnId: string;
  readonly summary: string;
  readonly reason?: string;
  readonly sourceEventIds?: readonly string[];
  readonly updatedAtMs: number;
}

export interface ConversationRuntimeContextCheckpointStore {
  readonly upsert: (
    checkpoint: ConversationRuntimeContextCheckpoint,
  ) => ConversationRuntimeContextCheckpoint;
  readonly read: (checkpointId: string) => ConversationRuntimeContextCheckpoint | undefined;
  readonly list: () => readonly ConversationRuntimeContextCheckpoint[];
  readonly readLatestPartialSummary: (
    sessionKey: string,
  ) => ConversationRuntimeContextPartialSummary | undefined;
}

export interface FileConversationRuntimeContextCheckpointStoreOptions {
  readonly path: string;
}

interface ConversationRuntimeContextCheckpointStoreDocument {
  readonly schemaVersion: typeof CONVERSATION_RUNTIME_CONTEXT_CHECKPOINT_STORE_SCHEMA_VERSION;
  readonly checkpoints: readonly ConversationRuntimeContextCheckpoint[];
}

export function createFileConversationRuntimeContextCheckpointStore(
  options: FileConversationRuntimeContextCheckpointStoreOptions,
): ConversationRuntimeContextCheckpointStore {
  return new FileConversationRuntimeContextCheckpointStore(options.path);
}

export function saveConversationRuntimeContextPartialSummary(input: {
  readonly store: ConversationRuntimeContextCheckpointStore;
  readonly sessionKey: string;
  readonly turnId: string;
  readonly summary: string;
  readonly reason?: string;
  readonly sourceEventIds?: readonly string[];
  readonly observedAtMs?: number;
}): ConversationRuntimeContextCheckpoint {
  const observedAtMs = input.observedAtMs ?? Date.now();
  const checkpoint: ConversationRuntimeContextCheckpoint = {
    schemaVersion: CONVERSATION_RUNTIME_CONTEXT_CHECKPOINT_SCHEMA_VERSION,
    checkpointId: `context-checkpoint-${stableContextCheckpointSlug([
      input.sessionKey,
      input.turnId,
      String(observedAtMs),
    ])}`,
    sessionKey: input.sessionKey,
    turnId: input.turnId,
    status: "partial_saved",
    summary: input.summary.trim(),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    ...(input.sourceEventIds === undefined
      ? {}
      : { sourceEventIds: uniqueStrings(input.sourceEventIds) }),
    createdAtMs: observedAtMs,
    updatedAtMs: observedAtMs,
  };
  return input.store.upsert(checkpoint);
}

class FileConversationRuntimeContextCheckpointStore
  implements ConversationRuntimeContextCheckpointStore
{
  public constructor(private readonly path: string) {}

  public upsert(
    checkpoint: ConversationRuntimeContextCheckpoint,
  ): ConversationRuntimeContextCheckpoint {
    const document = this.readDocument();
    const byId = new Map(document.checkpoints.map((item) => [item.checkpointId, item]));
    byId.set(checkpoint.checkpointId, checkpoint);
    this.writeDocument([...byId.values()]);
    return checkpoint;
  }

  public read(checkpointId: string): ConversationRuntimeContextCheckpoint | undefined {
    return this.readDocument().checkpoints.find((item) => item.checkpointId === checkpointId);
  }

  public list(): readonly ConversationRuntimeContextCheckpoint[] {
    return this.readDocument().checkpoints;
  }

  public readLatestPartialSummary(
    sessionKey: string,
  ): ConversationRuntimeContextPartialSummary | undefined {
    const checkpoint = this.readDocument()
      .checkpoints.filter(
        (item) =>
          item.sessionKey === sessionKey &&
          item.status === "partial_saved" &&
          typeof item.summary === "string" &&
          item.summary.trim().length > 0,
      )
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs)[0];
    if (checkpoint === undefined || checkpoint.summary === undefined) {
      return undefined;
    }
    return {
      checkpointId: checkpoint.checkpointId,
      sessionKey: checkpoint.sessionKey,
      turnId: checkpoint.turnId,
      summary: checkpoint.summary,
      ...(checkpoint.reason === undefined ? {} : { reason: checkpoint.reason }),
      ...(checkpoint.sourceEventIds === undefined
        ? {}
        : { sourceEventIds: checkpoint.sourceEventIds }),
      updatedAtMs: checkpoint.updatedAtMs,
    };
  }

  private readDocument(): ConversationRuntimeContextCheckpointStoreDocument {
    if (!existsSync(this.path)) {
      return this.emptyDocument();
    }
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
      if (!isRecord(raw) || !Array.isArray(raw.checkpoints)) {
        return this.emptyDocument();
      }
      return {
        schemaVersion: CONVERSATION_RUNTIME_CONTEXT_CHECKPOINT_STORE_SCHEMA_VERSION,
        checkpoints: raw.checkpoints.flatMap(parseContextCheckpoint),
      };
    } catch {
      return this.emptyDocument();
    }
  }

  private writeDocument(checkpoints: readonly ConversationRuntimeContextCheckpoint[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const document: ConversationRuntimeContextCheckpointStoreDocument = {
      schemaVersion: CONVERSATION_RUNTIME_CONTEXT_CHECKPOINT_STORE_SCHEMA_VERSION,
      checkpoints: [...checkpoints].sort((left, right) =>
        left.checkpointId.localeCompare(right.checkpointId),
      ),
    };
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    renameSync(tmp, this.path);
  }

  private emptyDocument(): ConversationRuntimeContextCheckpointStoreDocument {
    return {
      schemaVersion: CONVERSATION_RUNTIME_CONTEXT_CHECKPOINT_STORE_SCHEMA_VERSION,
      checkpoints: [],
    };
  }
}

function parseContextCheckpoint(value: unknown): ConversationRuntimeContextCheckpoint[] {
  if (!isRecord(value)) {
    return [];
  }
  const checkpointId = readString(value.checkpointId);
  const sessionKey = readString(value.sessionKey);
  const turnId = readString(value.turnId);
  const status = parseContextCheckpointStatus(value.status);
  const createdAtMs = readFiniteNumber(value.createdAtMs);
  const updatedAtMs = readFiniteNumber(value.updatedAtMs);
  const summary = readString(value.summary);
  const reason = readString(value.reason);
  const sourceEventIds = readStringArray(value.sourceEventIds);
  if (
    checkpointId === undefined ||
    sessionKey === undefined ||
    turnId === undefined ||
    status === undefined ||
    createdAtMs === undefined ||
    updatedAtMs === undefined
  ) {
    return [];
  }
  return [
    {
      schemaVersion: CONVERSATION_RUNTIME_CONTEXT_CHECKPOINT_SCHEMA_VERSION,
      checkpointId,
      sessionKey,
      turnId,
      status,
      ...(summary === undefined ? {} : { summary }),
      ...(reason === undefined ? {} : { reason }),
      ...(sourceEventIds === undefined ? {} : { sourceEventIds }),
      createdAtMs,
      updatedAtMs,
    },
  ];
}

function parseContextCheckpointStatus(
  value: unknown,
): ConversationRuntimeContextCheckpointStatus | undefined {
  return value === "started" ||
    value === "partial_saved" ||
    value === "completed" ||
    value === "failed"
    ? value
    : undefined;
}

function stableContextCheckpointSlug(parts: readonly string[]): string {
  const source = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function readStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = uniqueStrings(value.filter((item): item is string => typeof item === "string"));
  return values.length === 0 ? undefined : values;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
