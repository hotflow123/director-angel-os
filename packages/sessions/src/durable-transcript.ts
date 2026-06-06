import {
  AUDIT_JOURNAL_EVENT_TYPE,
  STREAM_JOURNAL_EVENT_TYPE,
  isStepJournalEventType,
} from "./journal.js";
import type {
  DurableTranscript,
  DurableTranscriptEntry,
  DurableTranscriptOptions,
  JournalEntry,
  JournalEventEnvelope,
  JsonObject,
  JsonValue,
  SessionRecord,
  StepJournalPayload,
} from "./types.js";

export const DURABLE_TRANSCRIPT_SCHEMA_VERSION = "sessions.durable-transcript/v1" as const;

export interface BuildDurableTranscriptInput {
  readonly session: SessionRecord;
  readonly journal: readonly JournalEntry[];
  readonly latestTurnId: string | null;
  readonly options?: DurableTranscriptOptions;
}

export function buildDurableTranscript(input: BuildDurableTranscriptInput): DurableTranscript {
  const afterSeq = normalizeAfterSeq(input.options?.afterSeq);
  const limit = normalizeLimit(input.options?.limit);
  const turnId = normalizeOptionalNonEmptyText(input.options?.turnId, "turnId");
  const eventTypes = normalizeEventTypes(input.options?.eventTypes);

  const entries: DurableTranscriptEntry[] = [];
  for (const entry of input.journal) {
    if (entry.seq <= afterSeq) {
      continue;
    }
    if (turnId !== undefined && entry.turnId !== turnId) {
      continue;
    }
    if (eventTypes.size > 0 && !eventTypes.has(entry.eventType)) {
      continue;
    }
    entries.push(toDurableTranscriptEntry(entry));
    if (limit !== undefined && entries.length >= limit) {
      break;
    }
  }

  const firstEntry = entries[0] ?? null;
  const lastEntry = entries.at(-1) ?? null;

  return {
    schemaVersion: DURABLE_TRANSCRIPT_SCHEMA_VERSION,
    sessionId: input.session.sessionId,
    session: input.session,
    latestTurnId: input.latestTurnId,
    fromSeq: firstEntry?.seq ?? afterSeq,
    toSeq: lastEntry?.seq ?? afterSeq,
    entryCount: entries.length,
    entries,
    resumeAnchor: {
      sessionId: input.session.sessionId,
      latestTurnId: input.latestTurnId,
      lastSeq: lastEntry?.seq ?? afterSeq,
      lastEventType: lastEntry?.eventType ?? null,
      lastCreatedAtMs: lastEntry?.createdAtMs ?? null,
    },
  };
}

function toDurableTranscriptEntry(entry: JournalEntry): DurableTranscriptEntry {
  const base = {
    seq: entry.seq,
    rowId: entry.rowId,
    sessionId: entry.sessionId,
    turnId: entry.turnId,
    eventType: entry.eventType,
    schemaVersion: entry.schemaVersion,
    createdAtMs: entry.createdAtMs,
    rawPayload: entry.payload,
  };

  if (isStepJournalEventType(entry.eventType)) {
    const stepPayload = asStepJournalPayload(entry.payload);
    if (stepPayload) {
      return {
        ...base,
        kind: "step",
        channel: "step",
        payload: stepPayload.data,
        stepIndex: stepPayload.stepIndex,
        eventId: null,
        envelopeKind: null,
        occurredAtMs: null,
      };
    }
  }

  if (
    entry.eventType === STREAM_JOURNAL_EVENT_TYPE ||
    entry.eventType === AUDIT_JOURNAL_EVENT_TYPE
  ) {
    const envelope = asJournalEventEnvelope(entry.payload);
    if (envelope) {
      const channel = entry.eventType === STREAM_JOURNAL_EVENT_TYPE ? "stream" : "audit";
      return {
        ...base,
        kind: channel,
        channel,
        payload: envelope.payload,
        stepIndex: null,
        eventId: envelope.id,
        envelopeKind: envelope.kind,
        occurredAtMs: envelope.occurredAtMs,
      };
    }
  }

  return {
    ...base,
    kind: "journal",
    channel: "journal",
    payload: entry.payload,
    stepIndex: null,
    eventId: null,
    envelopeKind: null,
    occurredAtMs: null,
  };
}

function asStepJournalPayload(payload: JsonValue): StepJournalPayload | null {
  if (!isJsonObject(payload)) {
    return null;
  }
  if (!Number.isInteger(payload.stepIndex) || typeof payload.stepIndex !== "number") {
    return null;
  }
  if (payload.stepIndex < 0 || !Object.hasOwn(payload, "data")) {
    return null;
  }
  return {
    stepIndex: payload.stepIndex,
    data: payload.data as JsonValue,
  };
}

function asJournalEventEnvelope(payload: JsonValue): JournalEventEnvelope | null {
  if (!isJsonObject(payload)) {
    return null;
  }
  if (
    typeof payload.id !== "string" ||
    typeof payload.kind !== "string" ||
    typeof payload.schemaVersion !== "string" ||
    typeof payload.occurredAtMs !== "number" ||
    !Number.isFinite(payload.occurredAtMs) ||
    !Object.hasOwn(payload, "payload")
  ) {
    return null;
  }
  return {
    id: payload.id,
    kind: payload.kind,
    schemaVersion: payload.schemaVersion,
    occurredAtMs: payload.occurredAtMs,
    payload: payload.payload as JsonValue,
  };
}

function normalizeAfterSeq(value: number | undefined): number {
  const afterSeq = value ?? 0;
  if (!Number.isInteger(afterSeq) || afterSeq < 0) {
    throw new RangeError(`afterSeq must be a non-negative integer; received ${afterSeq}`);
  }
  return afterSeq;
}

function normalizeLimit(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`limit must be a positive integer; received ${value}`);
  }
  return value;
}

function normalizeOptionalNonEmptyText(
  value: string | undefined,
  fieldName: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string when provided`);
  }
  return trimmed;
}

function normalizeEventTypes(eventTypes: readonly string[] | undefined): Set<string> {
  return new Set(
    (eventTypes ?? [])
      .map((eventType) => eventType.trim())
      .filter((eventType) => eventType.length > 0),
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
