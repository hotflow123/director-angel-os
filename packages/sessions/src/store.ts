import { SessionArchive } from "./archive.js";
import { SessionCheckpoints } from "./checkpoints.js";
import { buildDurableTranscript } from "./durable-transcript.js";
import {
  HANDOFF_SUMMARY_EVENT_TYPE,
  buildHandoffSummaryPayload,
  toHandoffSummaryRecord,
} from "./handoff-summary.js";
import { SessionJournal } from "./journal.js";
import { SessionLifecycle } from "./lifecycle.js";
import { recoverSessionState, recoverStepState } from "./recovery.js";
import {
  SQLiteSessionStorage,
  type SQLiteSessionStorageOptions,
  type SessionStorage,
} from "./storage.js";
import { ToolResultArtifactStore } from "./tool-result-artifacts.js";
import type {
  AppendAuditJournalEventInput,
  AppendJournalInput,
  AppendStepJournalInput,
  AppendStreamJournalEventInput,
  AppendToolResultArtifactInput,
  AppendToolResultArtifactResult,
  ArchiveSessionInput,
  AuditJournalEventEntry,
  CreateCheckpointInput,
  CreateHandoffSummaryInput,
  CreateSessionInput,
  CreateStepCheckpointInput,
  DeleteSessionInput,
  DeleteSessionResult,
  DurableTranscript,
  DurableTranscriptOptions,
  HandoffSummaryPayload,
  HandoffSummaryRecord,
  JournalEntry,
  JsonObject,
  JsonValue,
  LatestStepRecoveryResult,
  ListCheckpointsOptions,
  ListRuntimeEvidenceOptions,
  ListScopedJournalEventOptions,
  ReadToolResultArtifactResult,
  RecordRuntimeEvidenceInput,
  RecoverLatestStepOptions,
  RecoverSessionOptions,
  RecoverStepOptions,
  RecoveryResult,
  RewindCheckpointMetadata,
  RewindSessionInput,
  RewindSessionResult,
  RuntimeEvidenceEntry,
  RuntimeEvidenceKind,
  SessionRecord,
  SessionSearchQuery,
  SessionSearchResult,
  SessionStoreOptions,
  StepCheckpointMetadata,
  StepJournalEntry,
  StepRecoveryResult,
  StepReplayData,
  StreamJournalEventEntry,
} from "./types.js";
import { resolveSchemaVersion } from "./version.js";

export class SessionStore {
  public readonly storage: SessionStorage;
  public readonly lifecycle: SessionLifecycle;
  public readonly journal: SessionJournal;
  public readonly checkpoints: SessionCheckpoints;
  public readonly archive: SessionArchive;
  public readonly toolResultArtifacts: ToolResultArtifactStore;

  private readonly schemaVersion: string;

  public constructor(options: SessionStoreOptions) {
    this.schemaVersion = resolveSchemaVersion(options.schemaVersion);
    this.storage = new SQLiteSessionStorage(options as SQLiteSessionStorageOptions);
    this.lifecycle = new SessionLifecycle(this.storage, this.schemaVersion);
    this.journal = new SessionJournal(this.storage);
    this.checkpoints = new SessionCheckpoints(this.storage);
    this.archive = new SessionArchive(this.storage);
    this.toolResultArtifacts = new ToolResultArtifactStore(
      options.artifactRootDir ?? `${options.dbPath}.artifacts`,
    );
  }

  public close(): void {
    this.storage.close();
  }

  public createSession(input: CreateSessionInput = {}): SessionRecord {
    return this.lifecycle.create({
      ...input,
      schemaVersion: input.schemaVersion ?? this.schemaVersion,
    });
  }

  public getSession(sessionId: string): SessionRecord | null {
    return this.lifecycle.get(sessionId);
  }

  public updateMetadata(sessionId: string, metadata: JsonObject): SessionRecord {
    return this.lifecycle.updateMetadata(sessionId, metadata);
  }

  public appendJournal(sessionId: string, input: AppendJournalInput) {
    const session = this.lifecycle.requireActive(sessionId);
    return this.storage.transaction(() => this.journal.append(session, input));
  }

  public appendStepJournal<Payload extends JsonValue = JsonValue>(
    sessionId: string,
    input: AppendStepJournalInput<Payload>,
  ) {
    const session = this.lifecycle.requireActive(sessionId);
    return this.storage.transaction(() => this.journal.appendStep(session, input));
  }

  public appendStreamEvent<Payload extends JsonValue = JsonValue>(
    sessionId: string,
    input: AppendStreamJournalEventInput<Payload>,
  ) {
    const session = this.lifecycle.requireActive(sessionId);
    return this.storage.transaction(() => this.journal.appendStreamEvent(session, input));
  }

  public appendAuditEvent<Payload extends JsonValue = JsonValue>(
    sessionId: string,
    input: AppendAuditJournalEventInput<Payload>,
  ) {
    const session = this.lifecycle.requireActive(sessionId);
    return this.storage.transaction(() => this.journal.appendAuditEvent(session, input));
  }

  public appendToolResultArtifact(
    sessionId: string,
    input: AppendToolResultArtifactInput,
  ): AppendToolResultArtifactResult {
    const session = this.lifecycle.requireActive(sessionId);
    return this.storage.transaction(() => {
      const created = this.toolResultArtifacts.create(session, input);
      const entry = this.journal.appendStep(session, {
        turnId: input.turnId,
        stepIndex: input.stepIndex,
        eventType: "step.tool_result",
        payload: created.payload,
        ...(input.schemaVersion === undefined ? {} : { schemaVersion: input.schemaVersion }),
        ...(input.createdAtMs === undefined ? {} : { createdAtMs: input.createdAtMs }),
      });
      return {
        artifact: created.artifact,
        entry,
      };
    });
  }

  public readToolResultArtifact(
    sessionId: string,
    artifactId: string,
  ): ReadToolResultArtifactResult {
    this.lifecycle.require(sessionId);
    return this.toolResultArtifacts.read(sessionId, artifactId);
  }

  public createHandoffSummary(
    sessionId: string,
    input: CreateHandoffSummaryInput,
  ): HandoffSummaryRecord {
    const session = this.lifecycle.requireActive(sessionId);
    return this.storage.transaction(() => {
      const createdAtMs = input.createdAtMs ?? this.storage.now();
      const summary = buildHandoffSummaryPayload({
        sessionId,
        nowMs: createdAtMs,
        latestTurnId: this.getLatestTurnId(sessionId),
        summary: input,
      });
      const entry = this.journal.append(session, {
        eventType: HANDOFF_SUMMARY_EVENT_TYPE,
        payload: summary,
        ...(summary.latestTurnId === null ? {} : { turnId: summary.latestTurnId }),
        ...(input.schemaVersion === undefined ? {} : { schemaVersion: input.schemaVersion }),
        createdAtMs,
      }) as JournalEntry<HandoffSummaryPayload>;
      return {
        summary,
        entry,
      };
    });
  }

  public getLatestHandoffSummary(sessionId: string): HandoffSummaryRecord | null {
    this.lifecycle.require(sessionId);
    const entries = this.journal.list(sessionId);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (!entry) {
        continue;
      }
      const record = toHandoffSummaryRecord(entry);
      if (record) {
        return record;
      }
    }
    return null;
  }

  public listStreamEvents<Payload extends JsonValue = JsonValue>(
    sessionId: string,
    options: ListScopedJournalEventOptions = {},
  ): StreamJournalEventEntry<Payload>[] {
    return this.journal.listStreamEvents(sessionId, options);
  }

  public listAuditEvents<Payload extends JsonValue = JsonValue>(
    sessionId: string,
    options: ListScopedJournalEventOptions = {},
  ): AuditJournalEventEntry<Payload>[] {
    return this.journal.listAuditEvents(sessionId, options);
  }

  public recordRuntimeEvidence<Payload extends JsonValue = JsonValue>(
    sessionId: string,
    input: RecordRuntimeEvidenceInput<Payload>,
  ): void {
    const occurredAtMs = input.occurredAtMs ?? this.storage.now();
    const event = {
      id: input.eventId ?? `runtime_evidence_${occurredAtMs}_${input.kind}`,
      kind: input.kind,
      schemaVersion: input.schemaVersion ?? this.schemaVersion,
      occurredAtMs,
      payload: input.payload,
    };
    const channel = input.channel ?? "audit";

    if (channel === "audit" || channel === "both") {
      this.appendAuditEvent(sessionId, {
        ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
        event,
        createdAtMs: occurredAtMs,
      });
    }
    if (channel === "stream" || channel === "both") {
      this.appendStreamEvent(sessionId, {
        ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
        event,
        createdAtMs: occurredAtMs,
      });
    }
  }

  public listRuntimeEvidence<Payload extends JsonValue = JsonValue>(
    sessionId: string,
    options: ListRuntimeEvidenceOptions = {},
  ): RuntimeEvidenceEntry<Payload>[] {
    this.lifecycle.require(sessionId);
    const kinds = new Set<RuntimeEvidenceKind>(options.kinds ?? DEFAULT_RUNTIME_EVIDENCE_KINDS);
    const includeAudit = options.includeAudit ?? true;
    const includeStream = options.includeStream ?? true;

    const evidence: RuntimeEvidenceEntry<Payload>[] = [];
    if (includeAudit) {
      const auditEvents = this.listAuditEvents<Payload>(sessionId, options);
      for (const auditEvent of auditEvents) {
        if (!isRuntimeEvidenceKind(auditEvent.event.kind)) {
          continue;
        }
        if (!kinds.has(auditEvent.event.kind)) {
          continue;
        }
        evidence.push({
          channel: "audit",
          kind: auditEvent.event.kind,
          turnId: auditEvent.entry.turnId,
          occurredAtMs: auditEvent.event.occurredAtMs,
          eventId: auditEvent.event.id,
          payload: auditEvent.event.payload,
          entry: auditEvent.entry,
        });
      }
    }

    if (includeStream) {
      const streamEvents = this.listStreamEvents<Payload>(sessionId, options);
      for (const streamEvent of streamEvents) {
        if (!isRuntimeEvidenceKind(streamEvent.event.kind)) {
          continue;
        }
        if (!kinds.has(streamEvent.event.kind)) {
          continue;
        }
        evidence.push({
          channel: "stream",
          kind: streamEvent.event.kind,
          turnId: streamEvent.entry.turnId,
          occurredAtMs: streamEvent.event.occurredAtMs,
          eventId: streamEvent.event.id,
          payload: streamEvent.event.payload,
          entry: streamEvent.entry,
        });
      }
    }

    evidence.sort((left, right) => {
      if (left.occurredAtMs !== right.occurredAtMs) {
        return left.occurredAtMs - right.occurredAtMs;
      }
      return left.entry.rowId - right.entry.rowId;
    });
    return evidence;
  }

  public search<Payload extends JsonValue = JsonValue>(
    query: SessionSearchQuery,
  ): SessionSearchResult<Payload> {
    const hits = this.storage.searchSessions(query) as SessionSearchResult<Payload>["hits"];
    return {
      query,
      hits,
      totalHits: hits.length,
    };
  }

  public createCheckpoint(sessionId: string, input: CreateCheckpointInput) {
    const session = this.lifecycle.requireActive(sessionId);
    return this.storage.transaction(() => this.checkpoints.create(session, input));
  }

  public getCheckpoint(sessionId: string, checkpointId: number) {
    this.lifecycle.require(sessionId);
    return this.checkpoints.get(sessionId, checkpointId);
  }

  public listCheckpoints(sessionId: string, options: ListCheckpointsOptions = {}) {
    this.lifecycle.require(sessionId);
    return this.checkpoints.list(sessionId, options);
  }

  public createStepCheckpoint<State extends JsonValue = JsonValue>(
    sessionId: string,
    input: CreateStepCheckpointInput<State>,
  ) {
    const session = this.lifecycle.requireActive(sessionId);
    return this.storage.transaction(() => this.checkpoints.createStep(session, input));
  }

  public rewind(sessionId: string, input: RewindSessionInput = {}): RewindSessionResult {
    const session = this.lifecycle.requireActive(sessionId);
    return this.storage.transaction(() => {
      const occurredAtMs = input.createdAtMs ?? this.storage.now();
      const latestCheckpoint = this.checkpoints.latest(sessionId);
      if (!latestCheckpoint) {
        throw new Error(`Cannot rewind session "${sessionId}" without checkpoints.`);
      }

      const selection = input.checkpointId === undefined ? "previous" : "explicit";
      const targetCheckpoint =
        input.checkpointId === undefined
          ? (this.checkpoints.list(sessionId, { limit: 2 })[1] ?? null)
          : this.checkpoints.get(sessionId, input.checkpointId);
      if (!targetCheckpoint) {
        throw new Error(
          input.checkpointId === undefined
            ? `Cannot rewind session "${sessionId}" because no earlier checkpoint exists.`
            : `Cannot rewind session "${sessionId}" to missing checkpoint "${input.checkpointId}".`,
        );
      }
      if (targetCheckpoint.checkpointId === latestCheckpoint.checkpointId) {
        throw new Error(
          `Checkpoint "${targetCheckpoint.checkpointId}" is already current for session "${sessionId}".`,
        );
      }

      this.journal.append(session, {
        eventType: "control.rewind",
        payload: {
          selection,
          requestedCheckpointId: input.checkpointId ?? null,
          targetCheckpointId: targetCheckpoint.checkpointId,
          targetUptoSeq: targetCheckpoint.uptoSeq,
        },
        createdAtMs: occurredAtMs,
      });

      const currentCheckpoint = this.checkpoints.create(session, {
        state: targetCheckpoint.state,
        metadata: buildRewindCheckpointMetadata(targetCheckpoint, occurredAtMs),
        createdAtMs: occurredAtMs,
      });
      const clearedMetadata = clearLatestTurnObservationMetadata(session.metadata);
      if (clearedMetadata.cleared) {
        this.storage.updateSessionMetadata(sessionId, clearedMetadata.metadata, occurredAtMs);
      }
      const latestTurnHint = readCheckpointLatestTurnHint(currentCheckpoint.metadata);

      return {
        sessionId,
        requestedCheckpointId: input.checkpointId ?? null,
        selection,
        targetCheckpointId: targetCheckpoint.checkpointId,
        targetUptoSeq: targetCheckpoint.uptoSeq,
        currentCheckpointId: currentCheckpoint.checkpointId,
        currentUptoSeq: currentCheckpoint.uptoSeq,
        latestTurnId: latestTurnHint.defined ? latestTurnHint.value : null,
        clearedLatestTurn: clearedMetadata.cleared,
      };
    });
  }

  public archiveSession(sessionId: string, input: ArchiveSessionInput = {}): SessionRecord {
    const session = this.lifecycle.require(sessionId);
    return this.storage.transaction(() => this.archive.archive(session, input));
  }

  public deleteSession(sessionId: string, input: DeleteSessionInput = {}): DeleteSessionResult {
    const session = this.lifecycle.require(sessionId);
    return this.storage.transaction(() => {
      const transcript = this.buildDurableTranscript(sessionId);
      const archivedSession = this.archive.archive(session, input);
      this.toolResultArtifacts.deleteSessionArtifacts(sessionId);
      const deleted = this.storage.deleteSession(sessionId);
      if (!deleted) {
        throw new Error(`Session "${sessionId}" was not deleted.`);
      }
      return {
        sessionId,
        deleted: true,
        archivedSession,
        transcript,
      };
    });
  }

  public recover<State extends JsonValue | null = JsonValue | null>(
    sessionId: string,
    options: RecoverSessionOptions<State> = {},
  ): RecoveryResult<State> {
    return recoverSessionState(this.storage, sessionId, options);
  }

  public recoverStep<State extends JsonValue | null = JsonValue | null>(
    sessionId: string,
    options: RecoverStepOptions<State>,
  ): StepRecoveryResult<State> {
    return recoverStepState(this.storage, sessionId, options);
  }

  public getLatestTurnId(sessionId: string): string | null {
    this.lifecycle.require(sessionId);
    const latestTurnHint = readCheckpointLatestTurnHint(
      this.checkpoints.latest(sessionId)?.metadata,
    );
    if (latestTurnHint.defined) {
      return latestTurnHint.value;
    }
    return this.journal.latestTurnId(sessionId);
  }

  public buildDurableTranscript(
    sessionId: string,
    options: DurableTranscriptOptions = {},
  ): DurableTranscript {
    const session = this.lifecycle.require(sessionId);
    const listOptions =
      options.afterSeq === undefined
        ? {}
        : {
            afterSeq: options.afterSeq,
          };
    return buildDurableTranscript({
      session,
      journal: this.journal.list(sessionId, listOptions),
      latestTurnId: this.getLatestTurnId(sessionId),
      options,
    });
  }

  public recoverLatestStep<State extends JsonValue | null = JsonValue | null>(
    sessionId: string,
    options: RecoverLatestStepOptions<State> = {},
  ): LatestStepRecoveryResult<State> {
    this.lifecycle.require(sessionId);

    const latestTurnHint = readCheckpointLatestTurnHint(
      this.checkpoints.latest(sessionId)?.metadata,
    );
    const latestTurnId =
      options.turnId ??
      (latestTurnHint.defined ? latestTurnHint.value : this.journal.latestTurnId(sessionId));
    if (!latestTurnId) {
      return {
        latestTurnId: null,
        stepRecovery: null,
      };
    }

    const { turnId: _turnId, ...recoverOptions } = options;
    const stepRecovery = recoverStepState(this.storage, sessionId, {
      ...recoverOptions,
      turnId: latestTurnId,
    });

    if (
      options.turnId === undefined &&
      !latestTurnHint.defined &&
      stepRecovery.resumeAction === "no-progress" &&
      stepRecovery.stepCheckpoint === null &&
      stepRecovery.stepJournal.length === 0
    ) {
      const fullStepJournal = this.journal.listStep(sessionId, { turnId: latestTurnId });
      if (fullStepJournal.length > 0) {
        const replay = buildStepReplay(fullStepJournal);
        const lastStepEvent = fullStepJournal.at(-1) ?? null;
        const firstStepEvent = fullStepJournal[0];
        if (!firstStepEvent) {
          return {
            latestTurnId,
            stepRecovery,
          };
        }

        return {
          latestTurnId,
          stepRecovery: {
            ...stepRecovery,
            stepJournal: fullStepJournal,
            replay,
            replayWindow: {
              fromSeqExclusive: Math.max(0, firstStepEvent.entry.seq - 1),
              toSeqInclusive: lastStepEvent?.entry.seq ?? firstStepEvent.entry.seq,
            },
            lastStepEvent,
            resumeAction: lastStepEvent
              ? resumeActionFromStepEvent(lastStepEvent)
              : stepRecovery.resumeAction,
            nextStepIndex: lastStepEvent
              ? nextStepIndexFromStepEvent(lastStepEvent)
              : stepRecovery.nextStepIndex,
          },
        };
      }
    }

    return {
      latestTurnId,
      stepRecovery,
    };
  }
}

const DEFAULT_RUNTIME_EVIDENCE_KINDS: readonly RuntimeEvidenceKind[] = [
  "runtime.degraded",
  "runtime.failed",
  "provider.transient_failure",
  "stream.degraded",
  "stream.error",
  "stream.aborted",
];

const RUNTIME_EVIDENCE_KIND_SET = new Set<RuntimeEvidenceKind>(DEFAULT_RUNTIME_EVIDENCE_KINDS);

function isRuntimeEvidenceKind(value: string): value is RuntimeEvidenceKind {
  return RUNTIME_EVIDENCE_KIND_SET.has(value as RuntimeEvidenceKind);
}

function buildStepReplay<Payload extends JsonValue = JsonValue>(
  stepJournal: readonly StepJournalEntry<Payload>[],
): StepReplayData<Payload> {
  const replay: StepReplayData<Payload> = {
    contextBuilt: [],
    modelOutput: [],
    plannedTools: [],
    toolResults: [],
    finalOutput: [],
  };

  for (const entry of stepJournal) {
    switch (entry.eventType) {
      case "step.context_built":
        replay.contextBuilt.push(entry);
        break;
      case "step.model_output":
        replay.modelOutput.push(entry);
        break;
      case "step.tools_planned":
        replay.plannedTools.push(entry);
        break;
      case "step.tool_result":
        replay.toolResults.push(entry);
        break;
      case "step.final_output":
        replay.finalOutput.push(entry);
        break;
      default:
        break;
    }
  }

  return replay;
}

function nextStepIndexFromStepEvent(entry: StepJournalEntry): number {
  if (
    entry.eventType === "step.context_built" ||
    entry.eventType === "step.model_output" ||
    entry.eventType === "step.tools_planned"
  ) {
    return entry.stepIndex;
  }
  return entry.stepIndex + 1;
}

function resumeActionFromStepEvent(entry: StepJournalEntry): StepRecoveryResult["resumeAction"] {
  switch (entry.eventType) {
    case "step.context_built":
    case "step.model_output":
    case "step.tools_planned":
      return "continue-current-step";
    case "step.tool_result":
      return "start-next-step";
    case "step.final_output":
      return "turn-complete";
    default:
      return "no-progress";
  }
}

function buildRewindCheckpointMetadata(
  checkpoint: {
    readonly checkpointId: number;
    readonly uptoSeq: number;
    readonly metadata: JsonObject;
  },
  rewoundAtMs: number,
): JsonObject {
  if (isStepCheckpointMetadata(checkpoint.metadata)) {
    return {
      ...checkpoint.metadata,
      sourceCheckpointId: checkpoint.checkpointId,
      sourceUptoSeq: checkpoint.uptoSeq,
      rewoundAtMs,
    };
  }

  const latestTurnHint = readCheckpointLatestTurnHint(checkpoint.metadata);
  return {
    scope: "rewind",
    latestTurnId: latestTurnHint.defined ? latestTurnHint.value : null,
    sourceCheckpointId: checkpoint.checkpointId,
    sourceUptoSeq: checkpoint.uptoSeq,
    rewoundAtMs,
  } satisfies RewindCheckpointMetadata;
}

function clearLatestTurnObservationMetadata(metadata: JsonObject): {
  readonly metadata: JsonObject;
  readonly cleared: boolean;
} {
  if (!isJsonObject(metadata)) {
    return { metadata, cleared: false };
  }

  const runtime = metadata.runtime;
  if (!isJsonObject(runtime) || !Object.hasOwn(runtime, "latestTurn")) {
    return { metadata, cleared: false };
  }

  const { latestTurn: _latestTurn, ...nextRuntime } = runtime;
  const { runtime: _runtime, ...nextMetadata } = metadata;
  if (Object.keys(nextRuntime).length === 0) {
    return {
      metadata: nextMetadata,
      cleared: true,
    };
  }

  return {
    metadata: {
      ...nextMetadata,
      runtime: nextRuntime,
    },
    cleared: true,
  };
}

function readCheckpointLatestTurnHint(metadata: unknown): {
  readonly defined: boolean;
  readonly value: string | null;
} {
  if (isStepCheckpointMetadata(metadata)) {
    return {
      defined: true,
      value: metadata.turnId,
    };
  }
  if (!isRewindCheckpointMetadata(metadata)) {
    return {
      defined: false,
      value: null,
    };
  }
  return {
    defined: true,
    value: metadata.latestTurnId,
  };
}

function isStepCheckpointMetadata(value: unknown): value is StepCheckpointMetadata {
  if (!isJsonObject(value)) {
    return false;
  }

  const stepIndex = value.stepIndex;
  const turnId = value.turnId;
  const eventType = value.eventType;
  return (
    value.scope === "step" &&
    typeof turnId === "string" &&
    turnId.trim().length > 0 &&
    Number.isInteger(stepIndex) &&
    typeof stepIndex === "number" &&
    stepIndex >= 0 &&
    typeof eventType === "string"
  );
}

function isRewindCheckpointMetadata(value: unknown): value is RewindCheckpointMetadata {
  if (!isJsonObject(value)) {
    return false;
  }

  return (
    value.scope === "rewind" &&
    (value.latestTurnId === null || typeof value.latestTurnId === "string") &&
    Number.isInteger(value.sourceCheckpointId) &&
    Number.isInteger(value.sourceUptoSeq) &&
    Number.isInteger(value.rewoundAtMs)
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
