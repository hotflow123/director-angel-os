import { SessionArchivedError } from "./errors.js";
import type { SessionStorage } from "./storage.js";
import type {
  AppendAuditJournalEventInput,
  AppendJournalInput,
  AppendStepJournalInput,
  AppendStreamJournalEventInput,
  AuditJournalEventEntry,
  JournalEntry,
  JournalEventEnvelope,
  JsonObject,
  JsonValue,
  ListJournalOptions,
  ListScopedJournalEventOptions,
  ListStepJournalOptions,
  SessionRecord,
  StepJournalEntry,
  StepJournalEventType,
  StepJournalPayload,
  StreamJournalEventEntry,
} from "./types.js";
import { assertSchemaVersionCompatible, resolveSchemaVersion } from "./version.js";

export const STEP_JOURNAL_EVENT_TYPES: readonly StepJournalEventType[] = [
  "step.context_built",
  "step.model_output",
  "step.tools_planned",
  "step.tool_result",
  "step.final_output",
];
export const STREAM_JOURNAL_EVENT_TYPE = "stream.event";
export const AUDIT_JOURNAL_EVENT_TYPE = "audit.event";

const STEP_JOURNAL_EVENT_TYPE_SET = new Set<string>(STEP_JOURNAL_EVENT_TYPES);

export function isStepJournalEventType(eventType: string): eventType is StepJournalEventType {
  return STEP_JOURNAL_EVENT_TYPE_SET.has(eventType);
}

function asStepJournalPayload(payload: JsonValue): StepJournalPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const candidate = payload as JsonObject;
  if (!Number.isInteger(candidate.stepIndex) || (candidate.stepIndex as number) < 0) {
    return null;
  }
  if (!Object.hasOwn(candidate, "data")) {
    return null;
  }
  return {
    stepIndex: candidate.stepIndex as number,
    data: candidate.data as JsonValue,
  };
}

function asJournalEventEnvelope(payload: JsonValue): JournalEventEnvelope | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const candidate = payload as JsonObject;
  if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
    return null;
  }
  if (typeof candidate.kind !== "string" || candidate.kind.trim().length === 0) {
    return null;
  }
  if (typeof candidate.schemaVersion !== "string" || candidate.schemaVersion.trim().length === 0) {
    return null;
  }
  if (!Number.isFinite(candidate.occurredAtMs)) {
    return null;
  }
  if (!Object.hasOwn(candidate, "payload")) {
    return null;
  }
  return {
    id: candidate.id,
    kind: candidate.kind,
    schemaVersion: candidate.schemaVersion,
    occurredAtMs: candidate.occurredAtMs as number,
    payload: candidate.payload as JsonValue,
  };
}

function validateJournalEventEnvelope<Payload extends JsonValue = JsonValue>(
  event: JournalEventEnvelope<Payload>,
): JournalEventEnvelope<Payload> {
  const normalized = asJournalEventEnvelope(event as unknown as JsonValue);
  if (!normalized) {
    throw new TypeError("event must be a valid journal event envelope");
  }
  return normalized as JournalEventEnvelope<Payload>;
}

export function toStepJournalEntry(entry: JournalEntry): StepJournalEntry | null {
  if (!isStepJournalEventType(entry.eventType)) {
    return null;
  }
  const payload = asStepJournalPayload(entry.payload);
  if (!payload) {
    return null;
  }
  return {
    eventType: entry.eventType,
    entry: entry as JournalEntry<StepJournalPayload>,
    stepIndex: payload.stepIndex,
    payload: payload.data,
  };
}

export class SessionJournal {
  constructor(private readonly storage: SessionStorage) {}

  append(session: SessionRecord, input: AppendJournalInput): JournalEntry {
    if (session.status === "archived") {
      throw new SessionArchivedError(session.sessionId);
    }
    const eventType = input.eventType.trim();
    if (eventType.length === 0) {
      throw new TypeError("eventType must be a non-empty string");
    }
    const schemaVersion = resolveSchemaVersion(input.schemaVersion ?? session.schemaVersion);
    assertSchemaVersionCompatible(
      schemaVersion,
      session.schemaVersion,
      `journal entry for session ${session.sessionId}`,
    );
    const seq = this.storage.getNextJournalSeq(session.sessionId);
    return this.storage.insertJournalEntry({
      sessionId: session.sessionId,
      seq,
      eventType,
      turnId: input.turnId ?? null,
      payload: input.payload,
      schemaVersion,
      createdAtMs: input.createdAtMs ?? this.storage.now(),
    });
  }

  list(sessionId: string, options: ListJournalOptions = {}): JournalEntry[] {
    return this.storage.listJournalEntries(sessionId, options);
  }

  latestTurnId(sessionId: string): string | null {
    return this.storage.getLatestTurnId(sessionId);
  }

  appendStep<Payload extends JsonValue = JsonValue>(
    session: SessionRecord,
    input: AppendStepJournalInput<Payload>,
  ): JournalEntry<StepJournalPayload<Payload>> {
    const turnId = input.turnId.trim();
    if (turnId.length === 0) {
      throw new TypeError("turnId must be a non-empty string");
    }
    if (!Number.isInteger(input.stepIndex) || input.stepIndex < 0) {
      throw new RangeError(`stepIndex must be a non-negative integer; received ${input.stepIndex}`);
    }

    const appendInput: AppendJournalInput<StepJournalPayload<Payload>> = {
      eventType: input.eventType,
      turnId,
      payload: {
        stepIndex: input.stepIndex,
        data: input.payload,
      } satisfies StepJournalPayload<Payload>,
    };
    if (input.schemaVersion !== undefined) {
      appendInput.schemaVersion = input.schemaVersion;
    }
    if (input.createdAtMs !== undefined) {
      appendInput.createdAtMs = input.createdAtMs;
    }

    const created = this.append(session, appendInput);

    return created as JournalEntry<StepJournalPayload<Payload>>;
  }

  appendStreamEvent<Payload extends JsonValue = JsonValue>(
    session: SessionRecord,
    input: AppendStreamJournalEventInput<Payload>,
  ): JournalEntry<JournalEventEnvelope<Payload>> {
    return this.appendScopedEvent<Payload>(session, STREAM_JOURNAL_EVENT_TYPE, input);
  }

  appendAuditEvent<Payload extends JsonValue = JsonValue>(
    session: SessionRecord,
    input: AppendAuditJournalEventInput<Payload>,
  ): JournalEntry<JournalEventEnvelope<Payload>> {
    return this.appendScopedEvent<Payload>(session, AUDIT_JOURNAL_EVENT_TYPE, input);
  }

  listStep(sessionId: string, options: ListStepJournalOptions = {}): StepJournalEntry[] {
    const entries = this.list(sessionId, options);
    const turnId = options.turnId?.trim();
    if (turnId !== undefined && turnId.length === 0) {
      throw new TypeError("turnId must be a non-empty string when provided");
    }

    const parsed: StepJournalEntry[] = [];
    for (const entry of entries) {
      if (turnId && entry.turnId !== turnId) {
        continue;
      }
      const stepEntry = toStepJournalEntry(entry);
      if (stepEntry) {
        parsed.push(stepEntry);
      }
    }
    return parsed;
  }

  listStreamEvents<Payload extends JsonValue = JsonValue>(
    sessionId: string,
    options: ListScopedJournalEventOptions = {},
  ): StreamJournalEventEntry<Payload>[] {
    return this.listScopedEvents<Payload>(
      sessionId,
      STREAM_JOURNAL_EVENT_TYPE,
      options,
    ) as StreamJournalEventEntry<Payload>[];
  }

  listAuditEvents<Payload extends JsonValue = JsonValue>(
    sessionId: string,
    options: ListScopedJournalEventOptions = {},
  ): AuditJournalEventEntry<Payload>[] {
    return this.listScopedEvents<Payload>(
      sessionId,
      AUDIT_JOURNAL_EVENT_TYPE,
      options,
    ) as AuditJournalEventEntry<Payload>[];
  }

  private appendScopedEvent<Payload extends JsonValue = JsonValue>(
    session: SessionRecord,
    eventType: typeof STREAM_JOURNAL_EVENT_TYPE | typeof AUDIT_JOURNAL_EVENT_TYPE,
    input: AppendStreamJournalEventInput<Payload> | AppendAuditJournalEventInput<Payload>,
  ): JournalEntry<JournalEventEnvelope<Payload>> {
    const event = validateJournalEventEnvelope(input.event);
    const appendInput: AppendJournalInput<JournalEventEnvelope<Payload>> = {
      eventType,
      payload: event,
    };
    if (input.turnId !== undefined) {
      appendInput.turnId = input.turnId;
    }
    if (input.schemaVersion !== undefined) {
      appendInput.schemaVersion = input.schemaVersion;
    }
    if (input.createdAtMs !== undefined) {
      appendInput.createdAtMs = input.createdAtMs;
    }
    return this.append(session, appendInput) as JournalEntry<JournalEventEnvelope<Payload>>;
  }

  private listScopedEvents<Payload extends JsonValue = JsonValue>(
    sessionId: string,
    eventType: typeof STREAM_JOURNAL_EVENT_TYPE | typeof AUDIT_JOURNAL_EVENT_TYPE,
    options: ListScopedJournalEventOptions,
  ): Array<StreamJournalEventEntry<Payload> | AuditJournalEventEntry<Payload>> {
    const entries = this.list(sessionId, options);
    const turnId = options.turnId?.trim();
    if (turnId !== undefined && turnId.length === 0) {
      throw new TypeError("turnId must be a non-empty string when provided");
    }

    const parsed: Array<StreamJournalEventEntry<Payload> | AuditJournalEventEntry<Payload>> = [];
    for (const entry of entries) {
      if (entry.eventType !== eventType) {
        continue;
      }
      if (turnId && entry.turnId !== turnId) {
        continue;
      }
      const event = asJournalEventEnvelope(entry.payload);
      if (!event) {
        continue;
      }
      parsed.push({
        entry: entry as JournalEntry<JournalEventEnvelope<Payload>>,
        event: event as JournalEventEnvelope<Payload>,
      });
    }

    return parsed;
  }
}
