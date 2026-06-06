import type {
  ConversationRuntimeEvent,
  ConversationRuntimeEventKind,
  ConversationRuntimeInput,
  ConversationRuntimeSurface,
} from "./types.js";

export type ConversationTurnRunStatus =
  | "received"
  | "queued"
  | "preflight"
  | "running"
  | "awaiting_approval"
  | "delegating"
  | "tool_calling"
  | "finalizing"
  | "completed"
  | "stopping"
  | "cancelled"
  | "failed";

export type ConversationRunStopRequestedBy =
  | "user"
  | "operator"
  | "system"
  | "parent-run"
  | (string & {});

export interface ConversationRunTimelineEvent {
  readonly id: string;
  readonly kind: ConversationRuntimeEventKind | (string & {});
  readonly occurredAtMs: number;
  readonly summary?: string;
  readonly policyEnvelopeRefs?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationTurnRunRecord {
  readonly turnRunId: string;
  readonly turnId: string;
  readonly sessionKey: string;
  readonly sourceSurface: ConversationRuntimeSurface;
  readonly channel: string;
  readonly messageId: string;
  readonly deliveryTarget: string;
  readonly status: ConversationTurnRunStatus;
  readonly startedAtMs: number;
  readonly updatedAtMs: number;
  readonly endedAtMs?: number;
  readonly activeModelCall?: string;
  readonly activeToolCalls: readonly string[];
  readonly activeSubagentRunIds: readonly string[];
  readonly memoryEvidenceRefs: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly policyEnvelopeRefs: readonly string[];
  readonly failureTaxonomy: readonly string[];
  readonly userVisibleSummary?: string;
  readonly internalFailure?: string;
  readonly stopRequestedBy?: ConversationRunStopRequestedBy;
  readonly stopReason?: string;
  readonly stopRequestedAtMs?: number;
  readonly runId?: string;
  readonly events: readonly ConversationRunTimelineEvent[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRunRegistryStartInput {
  readonly turnId: string;
  readonly input: ConversationRuntimeInput;
  readonly status?: ConversationTurnRunStatus;
  readonly abortController?: AbortController;
  readonly activeModelCall?: string;
  readonly activeToolCalls?: readonly string[];
  readonly activeSubagentRunIds?: readonly string[];
  readonly memoryEvidenceRefs?: readonly string[];
  readonly sourceRefs?: readonly string[];
  readonly policyEnvelopeRefs?: readonly string[];
  readonly failureTaxonomy?: readonly string[];
  readonly userVisibleSummary?: string;
  readonly internalFailure?: string;
  readonly runId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRunRegistryAppendEventInput {
  readonly id?: string;
  readonly kind: ConversationRuntimeEventKind | (string & {});
  readonly occurredAtMs?: number;
  readonly summary?: string;
  readonly policyEnvelopeRefs?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRunRegistryFinalizeInput {
  readonly status: Extract<ConversationTurnRunStatus, "completed" | "cancelled" | "failed">;
  readonly userVisibleSummary?: string;
  readonly internalFailure?: string;
  readonly runId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly memoryEvidenceRefs?: readonly string[];
  readonly sourceRefs?: readonly string[];
  readonly policyEnvelopeRefs?: readonly string[];
  readonly failureTaxonomy?: readonly string[];
}

export interface ConversationRunRegistryStopInput {
  readonly requestedBy: ConversationRunStopRequestedBy;
  readonly reason?: string;
}

export interface ConversationRunRegistryMarkStuckInput {
  readonly staleAfterMs: number;
  readonly statuses?: readonly ConversationTurnRunStatus[];
}

export interface ConversationRunRegistryListOptions {
  readonly sessionKey?: string;
  readonly status?: ConversationTurnRunStatus;
}

export interface ConversationRunRegistry {
  readonly start: (input: ConversationRunRegistryStartInput) => ConversationTurnRunRecord;
  readonly read: (turnRunId: string) => ConversationTurnRunRecord | undefined;
  readonly list: (
    options?: ConversationRunRegistryListOptions,
  ) => readonly ConversationTurnRunRecord[];
  readonly stop: (
    turnRunId: string,
    input: ConversationRunRegistryStopInput,
  ) => ConversationTurnRunRecord;
  readonly signal: (turnRunId: string) => AbortSignal | undefined;
  readonly registerSubagentRun: (
    turnRunId: string,
    subagentRunId: string,
  ) => ConversationTurnRunRecord;
  readonly appendEvent: (
    turnRunId: string,
    event: ConversationRunRegistryAppendEventInput,
  ) => ConversationTurnRunRecord;
  readonly markStuckRuns: (
    input: ConversationRunRegistryMarkStuckInput,
  ) => readonly ConversationTurnRunRecord[];
  readonly finalize: (
    turnRunId: string,
    input: ConversationRunRegistryFinalizeInput,
  ) => ConversationTurnRunRecord;
}

export interface CreateConversationRunRegistryOptions {
  readonly nowMs?: () => number;
  readonly turnRunIdFactory?: (input: ConversationRunRegistryStartInput) => string;
  readonly store?: ConversationRunRegistryStore;
}

export interface ConversationRunRegistryStore {
  readonly load?: () => readonly ConversationTurnRunRecord[];
  readonly upsert: (record: ConversationTurnRunRecord) => void;
}

interface MutableConversationTurnRunRecord {
  turnRunId: string;
  turnId: string;
  sessionKey: string;
  sourceSurface: ConversationRuntimeSurface;
  channel: string;
  messageId: string;
  deliveryTarget: string;
  status: ConversationTurnRunStatus;
  startedAtMs: number;
  updatedAtMs: number;
  endedAtMs?: number;
  activeModelCall?: string;
  activeToolCalls: string[];
  activeSubagentRunIds: string[];
  memoryEvidenceRefs: string[];
  sourceRefs: string[];
  policyEnvelopeRefs: string[];
  failureTaxonomy: string[];
  userVisibleSummary?: string;
  internalFailure?: string;
  stopRequestedBy?: ConversationRunStopRequestedBy;
  stopReason?: string;
  stopRequestedAtMs?: number;
  runId?: string;
  events: ConversationRunTimelineEvent[];
  metadata?: Readonly<Record<string, unknown>>;
}

export function createConversationRunRegistry(
  options: CreateConversationRunRegistryOptions = {},
): ConversationRunRegistry {
  const runs = new Map<string, MutableConversationTurnRunRecord>();
  const abortControllers = new Map<string, AbortController>();
  const nowMs = options.nowMs ?? (() => Date.now());
  let eventSequence = 0;

  for (const record of options.store?.load?.() ?? []) {
    const mutable = mutableConversationTurnRunRecordFromSnapshot(record);
    reconcilePersistedConversationTurnRunRecord(mutable, nowMs, options.store);
    runs.set(record.turnRunId, mutable);
    eventSequence = Math.max(eventSequence, extractEventSequence(record.events));
  }

  function readMutable(turnRunId: string): MutableConversationTurnRunRecord {
    const record = runs.get(turnRunId);
    if (record === undefined) {
      throw new Error(`Conversation run not found: ${turnRunId}`);
    }
    return record;
  }

  return {
    start(input) {
      const timestamp = nowMs();
      const turnRunId = options.turnRunIdFactory?.(input) ?? createDefaultTurnRunId(input);
      const record: MutableConversationTurnRunRecord = {
        turnRunId,
        turnId: input.turnId,
        sessionKey: input.input.sessionKey,
        sourceSurface: input.input.surface,
        channel: input.input.channel,
        messageId: input.input.messageId,
        deliveryTarget: resolveDeliveryTarget(input.input),
        status: input.status ?? "running",
        startedAtMs: timestamp,
        updatedAtMs: timestamp,
        activeToolCalls: [...(input.activeToolCalls ?? [])],
        activeSubagentRunIds: [...(input.activeSubagentRunIds ?? [])],
        memoryEvidenceRefs: [...(input.memoryEvidenceRefs ?? [])],
        sourceRefs: [...(input.sourceRefs ?? [])],
        policyEnvelopeRefs: [...(input.policyEnvelopeRefs ?? [])],
        failureTaxonomy: [...(input.failureTaxonomy ?? [])],
        events: [],
      };
      if (input.activeModelCall !== undefined) {
        record.activeModelCall = input.activeModelCall;
      }
      if (input.userVisibleSummary !== undefined) {
        record.userVisibleSummary = input.userVisibleSummary;
      }
      if (input.internalFailure !== undefined) {
        record.internalFailure = input.internalFailure;
      }
      if (input.runId !== undefined) {
        record.runId = input.runId;
      }
      if (input.metadata !== undefined) {
        record.metadata = input.metadata;
      }
      runs.set(turnRunId, record);
      if (input.abortController !== undefined) {
        abortControllers.set(turnRunId, input.abortController);
      }
      return persistAndSnapshot(record, options.store);
    },
    read(turnRunId) {
      const record = runs.get(turnRunId);
      return record === undefined ? undefined : snapshotConversationTurnRunRecord(record);
    },
    list(options = {}) {
      return [...runs.values()]
        .filter(
          (record) => options.sessionKey === undefined || record.sessionKey === options.sessionKey,
        )
        .filter((record) => options.status === undefined || record.status === options.status)
        .map(snapshotConversationTurnRunRecord);
    },
    stop(turnRunId, input) {
      const record = readMutable(turnRunId);
      const timestamp = nowMs();
      record.status = "stopping";
      record.updatedAtMs = timestamp;
      record.stopRequestedAtMs = timestamp;
      record.stopRequestedBy = input.requestedBy;
      if (input.reason !== undefined) {
        record.stopReason = input.reason;
      }
      const controller = abortControllers.get(turnRunId);
      if (controller !== undefined && !controller.signal.aborted) {
        controller.abort(createConversationRunStopAbortReason(input));
      }
      return persistAndSnapshot(record, options.store);
    },
    signal(turnRunId) {
      return abortControllers.get(turnRunId)?.signal;
    },
    registerSubagentRun(turnRunId, subagentRunId) {
      const record = readMutable(turnRunId);
      appendUnique(record.activeSubagentRunIds, [subagentRunId]);
      record.updatedAtMs = nowMs();
      return persistAndSnapshot(record, options.store);
    },
    appendEvent(turnRunId, event) {
      const record = readMutable(turnRunId);
      const timestamp = event.occurredAtMs ?? nowMs();
      const timelineEvent: ConversationRunTimelineEvent = {
        id: event.id ?? `${turnRunId}:event:${++eventSequence}`,
        kind: event.kind,
        occurredAtMs: timestamp,
        ...(event.summary === undefined ? {} : { summary: event.summary }),
        ...(event.policyEnvelopeRefs === undefined
          ? {}
          : { policyEnvelopeRefs: [...event.policyEnvelopeRefs] }),
        ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
      };
      record.events.push(timelineEvent);
      appendUnique(record.policyEnvelopeRefs, event.policyEnvelopeRefs ?? []);
      record.updatedAtMs = timestamp;
      return persistAndSnapshot(record, options.store);
    },
    markStuckRuns(input) {
      const timestamp = nowMs();
      const thresholdMs = Math.max(0, input.staleAfterMs);
      const snapshots: ConversationTurnRunRecord[] = [];
      for (const record of runs.values()) {
        if (!shouldMarkConversationRunStuck(record, input.statuses)) {
          continue;
        }
        const lastActivityAtMs = getLastNonDiagnosticActivityAtMs(record);
        const idleForMs = timestamp - lastActivityAtMs;
        if (idleForMs <= thresholdMs || hasStuckWarningForActivity(record, lastActivityAtMs)) {
          continue;
        }
        record.events.push({
          id: `${record.turnRunId}:stuck-warning:${timestamp}`,
          kind: "runtime.stuck_warning",
          occurredAtMs: timestamp,
          summary: "Conversation run has had no activity past the stuck threshold.",
          metadata: {
            status: record.status,
            lastActivityAtMs,
            idleForMs,
            thresholdMs,
            activeToolCalls: [...record.activeToolCalls],
            activeSubagentRunIds: [...record.activeSubagentRunIds],
            ...(record.activeModelCall === undefined
              ? {}
              : { activeModelCall: record.activeModelCall }),
          },
        });
        record.updatedAtMs = timestamp;
        record.metadata = {
          ...(record.metadata ?? {}),
          stuckWarningActive: true,
          stuckWarningAtMs: timestamp,
          stuckWarningLastActivityAtMs: lastActivityAtMs,
          stuckWarningIdleForMs: idleForMs,
          stuckWarningThresholdMs: thresholdMs,
        };
        snapshots.push(persistAndSnapshot(record, options.store));
      }
      return snapshots;
    },
    finalize(turnRunId, input) {
      const record = readMutable(turnRunId);
      const timestamp = nowMs();
      record.status = input.status;
      record.updatedAtMs = timestamp;
      record.endedAtMs = timestamp;
      if (input.userVisibleSummary !== undefined) {
        record.userVisibleSummary = input.userVisibleSummary;
      }
      if (input.internalFailure !== undefined) {
        record.internalFailure = input.internalFailure;
      }
      if (input.runId !== undefined) {
        record.runId = input.runId;
      }
      if (input.metadata !== undefined) {
        record.metadata = {
          ...(record.metadata ?? {}),
          ...input.metadata,
        };
      }
      appendUnique(record.memoryEvidenceRefs, input.memoryEvidenceRefs ?? []);
      appendUnique(record.sourceRefs, input.sourceRefs ?? []);
      appendUnique(record.policyEnvelopeRefs, input.policyEnvelopeRefs ?? []);
      appendUnique(record.failureTaxonomy, input.failureTaxonomy ?? []);
      abortControllers.delete(turnRunId);
      return persistAndSnapshot(record, options.store);
    },
  };
}

export function isActiveConversationTurnRunStatus(status: string): boolean {
  return (
    status === "received" ||
    status === "queued" ||
    status === "preflight" ||
    status === "running" ||
    status === "awaiting_approval" ||
    status === "delegating" ||
    status === "tool_calling" ||
    status === "finalizing" ||
    status === "stopping"
  );
}

function shouldMarkConversationRunStuck(
  record: MutableConversationTurnRunRecord,
  statuses: readonly ConversationTurnRunStatus[] | undefined,
): boolean {
  return (
    isActiveConversationTurnRunStatus(record.status) &&
    (statuses === undefined || statuses.includes(record.status))
  );
}

function getLastNonDiagnosticActivityAtMs(record: MutableConversationTurnRunRecord): number {
  let lastActivityAtMs = record.startedAtMs;
  for (const event of record.events) {
    if (isDiagnosticConversationRunEvent(event.kind)) {
      continue;
    }
    lastActivityAtMs = Math.max(lastActivityAtMs, event.occurredAtMs);
  }
  return lastActivityAtMs;
}

function isDiagnosticConversationRunEvent(kind: string): boolean {
  return kind === "runtime.stuck_warning" || kind === "runtime.stale_recovered";
}

function hasStuckWarningForActivity(
  record: MutableConversationTurnRunRecord,
  lastActivityAtMs: number,
): boolean {
  return record.events.some(
    (event) =>
      event.kind === "runtime.stuck_warning" &&
      readNumberMetadata(event.metadata, "lastActivityAtMs") === lastActivityAtMs,
  );
}

function readNumberMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | undefined {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function createConversationRunStopAbortReason(input: ConversationRunRegistryStopInput): Error {
  const suffix = input.reason === undefined ? "" : `: ${input.reason}`;
  const error = new Error(`Conversation run stop requested by ${input.requestedBy}${suffix}`);
  error.name = "ConversationRunStopped";
  return error;
}

export function appendConversationRuntimeEventsToRunRegistry(input: {
  readonly registry: ConversationRunRegistry;
  readonly turnRunId: string;
  readonly events: readonly ConversationRuntimeEvent[];
}): void {
  for (const event of input.events) {
    input.registry.appendEvent(input.turnRunId, {
      id: event.id,
      kind: event.kind,
      occurredAtMs: event.occurredAtMs,
      summary: summarizeConversationRuntimeEvent(event),
      metadata: {
        payload: event.payload,
      },
    });
  }
}

function createDefaultTurnRunId(input: ConversationRunRegistryStartInput): string {
  return `${input.input.sessionKey}:${input.turnId}:run`;
}

function resolveDeliveryTarget(input: ConversationRuntimeInput): string {
  return (
    input.untrustedChannelContext?.rawThreadId ??
    input.untrustedChannelContext?.rawSenderId ??
    input.channel
  );
}

function appendUnique(target: string[], values: readonly string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function reconcilePersistedConversationTurnRunRecord(
  record: MutableConversationTurnRunRecord,
  nowMs: () => number,
  store: ConversationRunRegistryStore | undefined,
): void {
  if (!isActiveConversationTurnRunStatus(record.status)) {
    return;
  }
  const timestamp = nowMs();
  const previousStatus = record.status;
  record.status = "cancelled";
  record.updatedAtMs = timestamp;
  record.endedAtMs = timestamp;
  record.stopRequestedAtMs = timestamp;
  record.stopRequestedBy = "system";
  record.stopReason = "stale conversation run recovered after runtime restart";
  record.metadata = {
    ...(record.metadata ?? {}),
    staleRecovered: true,
    staleRecoveredAtMs: timestamp,
    staleRecoveredFromStatus: previousStatus,
  };
  record.events.push({
    id: `${record.turnRunId}:stale-recovered:${timestamp}`,
    kind: "runtime.stale_recovered",
    occurredAtMs: timestamp,
    summary: "Stale active conversation run was marked cancelled after runtime restart.",
    metadata: {
      fromStatus: previousStatus,
      reason: record.stopReason,
    },
  });
  persistAndSnapshot(record, store);
}

function snapshotConversationTurnRunRecord(
  record: MutableConversationTurnRunRecord,
): ConversationTurnRunRecord {
  return {
    turnRunId: record.turnRunId,
    turnId: record.turnId,
    sessionKey: record.sessionKey,
    sourceSurface: record.sourceSurface,
    channel: record.channel,
    messageId: record.messageId,
    deliveryTarget: record.deliveryTarget,
    status: record.status,
    startedAtMs: record.startedAtMs,
    updatedAtMs: record.updatedAtMs,
    ...(record.endedAtMs === undefined ? {} : { endedAtMs: record.endedAtMs }),
    ...(record.activeModelCall === undefined ? {} : { activeModelCall: record.activeModelCall }),
    activeToolCalls: [...record.activeToolCalls],
    activeSubagentRunIds: [...record.activeSubagentRunIds],
    memoryEvidenceRefs: [...record.memoryEvidenceRefs],
    sourceRefs: [...record.sourceRefs],
    policyEnvelopeRefs: [...record.policyEnvelopeRefs],
    failureTaxonomy: [...record.failureTaxonomy],
    ...(record.userVisibleSummary === undefined
      ? {}
      : { userVisibleSummary: record.userVisibleSummary }),
    ...(record.internalFailure === undefined ? {} : { internalFailure: record.internalFailure }),
    ...(record.stopRequestedBy === undefined ? {} : { stopRequestedBy: record.stopRequestedBy }),
    ...(record.stopReason === undefined ? {} : { stopReason: record.stopReason }),
    ...(record.stopRequestedAtMs === undefined
      ? {}
      : { stopRequestedAtMs: record.stopRequestedAtMs }),
    ...(record.runId === undefined ? {} : { runId: record.runId }),
    events: record.events.map((event) => ({ ...event })),
    ...(record.metadata === undefined ? {} : { metadata: record.metadata }),
  };
}

function persistAndSnapshot(
  record: MutableConversationTurnRunRecord,
  store: ConversationRunRegistryStore | undefined,
): ConversationTurnRunRecord {
  const snapshot = snapshotConversationTurnRunRecord(record);
  store?.upsert(snapshot);
  return snapshot;
}

function mutableConversationTurnRunRecordFromSnapshot(
  record: ConversationTurnRunRecord,
): MutableConversationTurnRunRecord {
  const mutable: MutableConversationTurnRunRecord = {
    turnRunId: record.turnRunId,
    turnId: record.turnId,
    sessionKey: record.sessionKey,
    sourceSurface: record.sourceSurface,
    channel: record.channel,
    messageId: record.messageId,
    deliveryTarget: record.deliveryTarget,
    status: record.status,
    startedAtMs: record.startedAtMs,
    updatedAtMs: record.updatedAtMs,
    activeToolCalls: [...record.activeToolCalls],
    activeSubagentRunIds: [...record.activeSubagentRunIds],
    memoryEvidenceRefs: [...record.memoryEvidenceRefs],
    sourceRefs: [...record.sourceRefs],
    policyEnvelopeRefs: [...record.policyEnvelopeRefs],
    failureTaxonomy: [...record.failureTaxonomy],
    events: record.events.map((event) => ({ ...event })),
  };
  if (record.endedAtMs !== undefined) {
    mutable.endedAtMs = record.endedAtMs;
  }
  if (record.activeModelCall !== undefined) {
    mutable.activeModelCall = record.activeModelCall;
  }
  if (record.userVisibleSummary !== undefined) {
    mutable.userVisibleSummary = record.userVisibleSummary;
  }
  if (record.internalFailure !== undefined) {
    mutable.internalFailure = record.internalFailure;
  }
  if (record.stopRequestedBy !== undefined) {
    mutable.stopRequestedBy = record.stopRequestedBy;
  }
  if (record.stopReason !== undefined) {
    mutable.stopReason = record.stopReason;
  }
  if (record.stopRequestedAtMs !== undefined) {
    mutable.stopRequestedAtMs = record.stopRequestedAtMs;
  }
  if (record.runId !== undefined) {
    mutable.runId = record.runId;
  }
  if (record.metadata !== undefined) {
    mutable.metadata = record.metadata;
  }
  return mutable;
}

function extractEventSequence(events: readonly ConversationRunTimelineEvent[]): number {
  let maxSequence = 0;
  for (const event of events) {
    const match = /:event:(\d+)$/u.exec(event.id);
    if (match?.[1] === undefined) {
      continue;
    }
    const sequence = Number.parseInt(match[1], 10);
    if (Number.isSafeInteger(sequence) && sequence > maxSequence) {
      maxSequence = sequence;
    }
  }
  return maxSequence;
}

function summarizeConversationRuntimeEvent(event: ConversationRuntimeEvent): string {
  switch (event.kind) {
    case "runtime.final":
      return (event as ConversationRuntimeEvent<"runtime.final">).payload.text;
    case "runtime.error":
      return (event as ConversationRuntimeEvent<"runtime.error">).payload.message;
    case "runtime.ack":
      return (event as ConversationRuntimeEvent<"runtime.ack">).payload.message;
    case "runtime.trace":
      return (event as ConversationRuntimeEvent<"runtime.trace">).payload.trace.detail;
    case "runtime.tool": {
      const tool = (event as ConversationRuntimeEvent<"runtime.tool">).payload.tool;
      return tool.summary ?? tool.name;
    }
    case "runtime.approval": {
      const approval = (event as ConversationRuntimeEvent<"runtime.approval">).payload.approval;
      return approval.summary ?? approval.title;
    }
    case "runtime.artifact": {
      const artifact = (event as ConversationRuntimeEvent<"runtime.artifact">).payload.artifact;
      return artifact.title ?? artifact.kind;
    }
    default:
      return event.kind;
  }
}
