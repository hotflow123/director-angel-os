export const CONVERSATION_RUNTIME_EVENT_SCHEMA_VERSION = "conversation-runtime.event.v1" as const;

export type ConversationRuntimeUnifiedEventKind =
  | "turn.started"
  | "intent.classified"
  | "automation.policy.enabled"
  | "automation.policy.matched"
  | "automation.policy.rejected"
  | "approval.requested"
  | "approval.resolved"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "tool.loop_detected"
  | "tool.before_call"
  | "tool.after_call"
  | "tool.persisted"
  | "external.provider.watch"
  | "external.provider.cancelled"
  | "external.provider.artifacts"
  | "evidence.read"
  | "memory.recall"
  | "candidate.created"
  | "candidate.promoted"
  | "model.fallback"
  | "model.final"
  | "turn.failed"
  | "context.compaction.started"
  | "context.compaction.partial_saved"
  | "context.compaction.completed"
  | "context.compaction.failed"
  | "client.ack"
  | "runtime.backpressure";

export interface ConversationRuntimeUnifiedEvent<
  TKind extends ConversationRuntimeUnifiedEventKind = ConversationRuntimeUnifiedEventKind,
  TPayload extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
> {
  readonly schemaVersion: typeof CONVERSATION_RUNTIME_EVENT_SCHEMA_VERSION;
  readonly kind: TKind;
  readonly turnId: string;
  readonly conversationId: string;
  readonly eventId: string;
  readonly sequence: number;
  readonly startedAtMs: number;
  readonly occurredAtMs: number;
  readonly elapsedMs: number;
  readonly payload: TPayload;
}

export interface CreateConversationRuntimeEventInput<
  TKind extends ConversationRuntimeUnifiedEventKind = ConversationRuntimeUnifiedEventKind,
  TPayload extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
> {
  readonly kind: TKind;
  readonly turnId: string;
  readonly conversationId: string;
  readonly sequence: number;
  readonly startedAtMs: number;
  readonly occurredAtMs: number;
  readonly payload?: TPayload;
}

export interface ConversationRuntimeEventBuilder {
  event<
    TKind extends ConversationRuntimeUnifiedEventKind,
    TPayload extends Readonly<Record<string, unknown>>,
  >(kind: TKind, payload?: TPayload): ConversationRuntimeUnifiedEvent<TKind, TPayload>;
}

export function createConversationRuntimeUnifiedEvent<
  TKind extends ConversationRuntimeUnifiedEventKind,
  TPayload extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
>(
  input: CreateConversationRuntimeEventInput<TKind, TPayload>,
): ConversationRuntimeUnifiedEvent<TKind, TPayload> {
  const elapsedMs = Math.max(0, input.occurredAtMs - input.startedAtMs);
  return {
    schemaVersion: CONVERSATION_RUNTIME_EVENT_SCHEMA_VERSION,
    kind: input.kind,
    turnId: input.turnId,
    conversationId: input.conversationId,
    eventId: createConversationRuntimeUnifiedEventId(input.turnId, input.sequence, input.kind),
    sequence: input.sequence,
    startedAtMs: input.startedAtMs,
    occurredAtMs: input.occurredAtMs,
    elapsedMs,
    payload: (input.payload ?? {}) as TPayload,
  };
}

export function createConversationRuntimeUnifiedEventBuilder(input: {
  readonly turnId: string;
  readonly conversationId: string;
  readonly startedAtMs: number;
  readonly nowMs?: () => number;
}): ConversationRuntimeEventBuilder {
  let sequence = 0;
  const nowMs = input.nowMs ?? (() => Date.now());
  return {
    event(kind, payload) {
      sequence += 1;
      return createConversationRuntimeUnifiedEvent({
        kind,
        turnId: input.turnId,
        conversationId: input.conversationId,
        sequence,
        startedAtMs: input.startedAtMs,
        occurredAtMs: nowMs(),
        ...(payload === undefined ? {} : { payload }),
      });
    },
  };
}

export function appendConversationRuntimeEvent<
  TKind extends ConversationRuntimeUnifiedEventKind,
  TPayload extends Readonly<Record<string, unknown>>,
>(
  events: readonly ConversationRuntimeUnifiedEvent[],
  input: CreateConversationRuntimeEventInput<TKind, TPayload>,
): readonly ConversationRuntimeUnifiedEvent[] {
  return [...events, createConversationRuntimeUnifiedEvent(input)];
}

export function mapLegacyConversationRuntimeEvent(
  event: unknown,
  input: {
    readonly turnId: string;
    readonly conversationId: string;
    readonly sequence: number;
    readonly startedAtMs: number;
    readonly occurredAtMs: number;
  },
): ConversationRuntimeUnifiedEvent | null {
  if (!isRecord(event)) {
    return null;
  }
  if (event.kind === "runtime.tool") {
    return mapLegacyRuntimeToolEvent(event, input);
  }
  if (event.kind === "runtime.approval") {
    return mapLegacyRuntimeApprovalEvent(event, input);
  }
  if (event.kind === "runtime.final") {
    return createConversationRuntimeUnifiedEvent({
      ...input,
      kind: "model.final",
      payload: {
        text: readRecordString(event.payload, "text") ?? "",
      },
    });
  }
  if (event.kind === "runtime.error") {
    return createConversationRuntimeUnifiedEvent({
      ...input,
      kind: "turn.failed",
      payload: {
        message: readRecordString(event.payload, "message") ?? "runtime error",
      },
    });
  }
  return null;
}

function mapLegacyRuntimeToolEvent(
  event: Readonly<Record<string, unknown>>,
  input: {
    readonly turnId: string;
    readonly conversationId: string;
    readonly sequence: number;
    readonly startedAtMs: number;
    readonly occurredAtMs: number;
  },
): ConversationRuntimeUnifiedEvent {
  const payload = isRecord(event.payload) ? event.payload : {};
  const tool = isRecord(payload.tool) ? payload.tool : {};
  const metadata = isRecord(tool.metadata) ? tool.metadata : {};
  if (metadata.diagnosticKind === "tool.loop_detected") {
    return createConversationRuntimeUnifiedEvent({
      ...input,
      kind: "tool.loop_detected",
      payload: {
        toolName: readRecordString(tool, "name") ?? "unknown_tool",
        toolCallId: readRecordString(tool, "id") ?? "",
        reason: readRecordString(metadata, "reason") ?? "tool-loop-threshold-exceeded",
      },
    });
  }
  const phase = readRecordString(tool, "phase") ?? "completed";
  const kind =
    phase === "requested" || phase === "started"
      ? "tool.started"
      : phase === "failed"
        ? "tool.failed"
        : "tool.completed";
  return createConversationRuntimeUnifiedEvent({
    ...input,
    kind,
    payload: {
      toolName: readRecordString(tool, "name") ?? "unknown_tool",
      toolCallId: readRecordString(tool, "id") ?? "",
      phase,
    },
  });
}

function mapLegacyRuntimeApprovalEvent(
  event: Readonly<Record<string, unknown>>,
  input: {
    readonly turnId: string;
    readonly conversationId: string;
    readonly sequence: number;
    readonly startedAtMs: number;
    readonly occurredAtMs: number;
  },
): ConversationRuntimeUnifiedEvent {
  const payload = isRecord(event.payload) ? event.payload : {};
  const approval = isRecord(payload.approval) ? payload.approval : {};
  const metadata = isRecord(approval.metadata) ? approval.metadata : {};
  const status = readRecordString(approval, "status") ?? "pending";
  const kind =
    status === "pending" || status === "ask" ? "approval.requested" : "approval.resolved";
  return createConversationRuntimeUnifiedEvent({
    ...input,
    kind,
    payload: {
      approvalId: readRecordString(approval, "id") ?? "",
      status,
      toolName: readRecordString(metadata, "toolName") ?? "",
      permissionStatus: readRecordString(metadata, "permissionStatus") ?? "",
    },
  });
}

function createConversationRuntimeUnifiedEventId(
  turnId: string,
  sequence: number,
  kind: ConversationRuntimeUnifiedEventKind,
): string {
  return `${turnId}:${String(sequence).padStart(6, "0")}:${kind}`;
}

function readRecordString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const item = value[key];
  return typeof item === "string" && item.trim().length > 0 ? item : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
