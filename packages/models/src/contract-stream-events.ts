import { ModelProviderError } from "./provider-errors.js";
import type { StreamEvent } from "./stream-events.js";
import type { ToolCall } from "./types.js";

export const CONTRACT_STREAM_SCHEMA_VERSION = "0.1.0" as const;

export type ContractStreamErrorCode =
  | "INVALID_STREAM_EVENT"
  | "ABORTED"
  | "PROVIDER_TRANSIENT_FAILURE"
  | "PROVIDER_FAILURE";

export interface ContractStreamError {
  readonly code: ContractStreamErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ContractToolCall {
  readonly callId: string;
  readonly toolName: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly startedAtMs: number;
}

export interface ContractRuntimeDegradeSurface {
  readonly stage: "stream";
  readonly severity: "minor" | "major";
  readonly reason:
    | "tool-unavailable"
    | "model-limited"
    | "policy-restricted"
    | "latency-budget"
    | "context-pressure"
    | "fallback";
  readonly message: string;
  readonly recoverable: boolean;
}

export interface ContractRuntimeFailureSurface {
  readonly stage: "stream";
  readonly recoverable: boolean;
  readonly error: ContractStreamError;
}

export interface ContractStreamEventPayloadMap {
  readonly "stream.started": {
    readonly turnId: string;
  };
  readonly "stream.chunk": {
    readonly turnId: string;
    readonly index: number;
    readonly delta: string;
  };
  readonly "stream.interrupted": {
    readonly turnId: string;
    readonly reason?: string;
    readonly resumable: boolean;
  };
  readonly "stream.resumed": {
    readonly turnId: string;
    readonly reason?: string;
  };
  readonly "stream.step": {
    readonly turnId: string;
    readonly stepId: string;
    readonly index: number;
    readonly summary?: string;
  };
  readonly "stream.tool-call": {
    readonly turnId: string;
    readonly call: ContractToolCall;
  };
  readonly "stream.degraded": {
    readonly turnId: string;
    readonly degradation: ContractRuntimeDegradeSurface;
  };
  readonly "stream.aborted": {
    readonly turnId: string;
    readonly failure: ContractRuntimeFailureSurface;
  };
  readonly "stream.completed": {
    readonly turnId: string;
    readonly finishReason: "stop" | "length" | "error";
  };
  readonly "stream.error": {
    readonly turnId: string;
    readonly error: ContractStreamError;
  };
}

export type ContractStreamEventKind = keyof ContractStreamEventPayloadMap;

export interface ContractStreamEvent<K extends ContractStreamEventKind = ContractStreamEventKind> {
  readonly id: string;
  readonly schemaVersion: typeof CONTRACT_STREAM_SCHEMA_VERSION;
  readonly kind: K;
  readonly occurredAtMs: number;
  readonly payload: ContractStreamEventPayloadMap[K];
}

function createContractStreamEvent<K extends ContractStreamEventKind>(input: {
  readonly id: string;
  readonly kind: K;
  readonly occurredAtMs: number;
  readonly payload: ContractStreamEventPayloadMap[K];
}): ContractStreamEvent<K> {
  return {
    schemaVersion: CONTRACT_STREAM_SCHEMA_VERSION,
    ...input,
  };
}

function toEventId(kind: ContractStreamEventKind, turnId: string, sequence: number): string {
  return `stream_${turnId}_${kind}_${sequence}`;
}

function toChunkFinishReason(finishReason: string | undefined): "stop" | "length" | "error" {
  if (finishReason === "length") {
    return "length";
  }
  if (finishReason === "error") {
    return "error";
  }
  return "stop";
}

function parseToolArgs(argumentsJson: string): Readonly<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function toToolCallContract(toolCall: ToolCall, occurredAtMs: number): ContractToolCall {
  return {
    callId: toolCall.id,
    toolName: toolCall.name,
    args: parseToolArgs(toolCall.argumentsJson),
    startedAtMs: occurredAtMs,
  };
}

function createContractStreamError(
  code: ContractStreamErrorCode,
  message: string,
): ContractStreamError {
  return {
    code,
    message,
    retryable: false,
  };
}

export interface AdaptStreamEventToContractEventInput {
  readonly turnId: string;
  readonly source: StreamEvent;
  readonly sequence: number;
  readonly chunkIndex: number;
  readonly occurredAtMs?: number;
  readonly eventId?: string;
}

export interface AdaptStreamEventToContractEventResult {
  readonly event: ContractStreamEvent;
  readonly nextChunkIndex: number;
}

export function adaptStreamEventToContractEvent(
  input: AdaptStreamEventToContractEventInput,
): AdaptStreamEventToContractEventResult {
  const occurredAtMs = input.occurredAtMs ?? Date.now();
  switch (input.source.type) {
    case "response_started":
      return {
        event: createContractStreamEvent({
          id: input.eventId ?? toEventId("stream.started", input.turnId, input.sequence),
          kind: "stream.started",
          occurredAtMs,
          payload: {
            turnId: input.turnId,
          },
        }),
        nextChunkIndex: input.chunkIndex,
      };
    case "text_delta":
      return {
        event: createContractStreamEvent({
          id: input.eventId ?? toEventId("stream.chunk", input.turnId, input.sequence),
          kind: "stream.chunk",
          occurredAtMs,
          payload: {
            turnId: input.turnId,
            index: input.chunkIndex,
            delta: input.source.text,
          },
        }),
        nextChunkIndex: input.chunkIndex + 1,
      };
    case "status_delta":
      return {
        event: createContractStreamEvent({
          id: input.eventId ?? toEventId("stream.step", input.turnId, input.sequence),
          kind: "stream.step",
          occurredAtMs,
          payload: {
            turnId: input.turnId,
            stepId: `status_${input.sequence}`,
            index: input.sequence,
            summary: input.source.status,
          },
        }),
        nextChunkIndex: input.chunkIndex,
      };
    case "tool_boundary":
      return {
        event: createContractStreamEvent({
          id: input.eventId ?? toEventId("stream.tool-call", input.turnId, input.sequence),
          kind: "stream.tool-call",
          occurredAtMs,
          payload: {
            turnId: input.turnId,
            call: toToolCallContract(input.source.toolCall, occurredAtMs),
          },
        }),
        nextChunkIndex: input.chunkIndex,
      };
    case "response_paused":
      return {
        event: createContractStreamEvent({
          id: input.eventId ?? toEventId("stream.interrupted", input.turnId, input.sequence),
          kind: "stream.interrupted",
          occurredAtMs,
          payload: {
            turnId: input.turnId,
            ...(input.source.reason !== undefined ? { reason: input.source.reason } : {}),
            resumable: true,
          },
        }),
        nextChunkIndex: input.chunkIndex,
      };
    case "response_resumed":
      return {
        event: createContractStreamEvent({
          id: input.eventId ?? toEventId("stream.resumed", input.turnId, input.sequence),
          kind: "stream.resumed",
          occurredAtMs,
          payload: {
            turnId: input.turnId,
            reason: "response resumed",
          },
        }),
        nextChunkIndex: input.chunkIndex,
      };
    case "response_completed":
      return {
        event: createContractStreamEvent({
          id: input.eventId ?? toEventId("stream.completed", input.turnId, input.sequence),
          kind: "stream.completed",
          occurredAtMs,
          payload: {
            turnId: input.turnId,
            finishReason: toChunkFinishReason(input.source.finishReason),
          },
        }),
        nextChunkIndex: input.chunkIndex,
      };
    case "response_aborted":
      return {
        event: createContractStreamEvent({
          id: input.eventId ?? toEventId("stream.aborted", input.turnId, input.sequence),
          kind: "stream.aborted",
          occurredAtMs,
          payload: {
            turnId: input.turnId,
            failure: {
              stage: "stream",
              recoverable: false,
              error: createContractStreamError("ABORTED", input.source.error ?? "stream aborted"),
            },
          },
        }),
        nextChunkIndex: input.chunkIndex,
      };
  }
}

export interface AdaptStreamToContractEventsOptions {
  readonly now?: () => number;
  readonly eventIdFactory?: (input: {
    readonly turnId: string;
    readonly source?: StreamEvent;
    readonly sourceType:
      | StreamEvent["type"]
      | "synthetic.started"
      | "synthetic.completed"
      | "synthetic.error"
      | "synthetic.aborted";
    readonly sequence: number;
    readonly kind: ContractStreamEventKind;
  }) => string;
}

export type ContractStreamSourceType =
  | StreamEvent["type"]
  | "synthetic.started"
  | "synthetic.completed"
  | "synthetic.error"
  | "synthetic.aborted";

export interface ContractStreamEventEnvelope {
  readonly sequence: number;
  readonly sourceType: ContractStreamSourceType;
  readonly chunkIndex: number;
  readonly terminal: boolean;
  readonly event: ContractStreamEvent;
}

export interface ContractFailureEnvelopeInput {
  readonly turnId: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly sequenceStart?: number;
  readonly occurredAtMs?: number;
  readonly eventIdFactory?: AdaptStreamToContractEventsOptions["eventIdFactory"];
}

export interface ContractStreamObservation {
  readonly latestTurnId?: string;
  readonly latestStepId?: string;
  readonly latestStepIndex?: number;
  readonly lastEventId?: string;
  readonly lastEventKind?: ContractStreamEventKind;
  readonly terminal: boolean;
}

export function observeContractStreamEvent(
  previous: ContractStreamObservation | undefined,
  event: ContractStreamEvent,
): ContractStreamObservation {
  const base: ContractStreamObservation = previous ?? { terminal: false };
  const turnId = event.payload.turnId;
  switch (event.kind) {
    case "stream.step": {
      const stepEvent = event as ContractStreamEvent<"stream.step">;
      return {
        latestTurnId: turnId,
        latestStepId: stepEvent.payload.stepId,
        latestStepIndex: stepEvent.payload.index,
        lastEventId: stepEvent.id,
        lastEventKind: stepEvent.kind,
        terminal: false,
      };
    }
    default:
      return {
        ...base,
        latestTurnId: turnId,
        lastEventId: event.id,
        lastEventKind: event.kind,
        terminal: isTerminalKind(event.kind),
      };
  }
}

export function summarizeContractStreamEvents(
  events: readonly ContractStreamEvent[],
): ContractStreamObservation {
  let observation: ContractStreamObservation | undefined;
  for (const event of events) {
    observation = observeContractStreamEvent(observation, event);
  }
  return observation ?? { terminal: false };
}

function isTerminalKind(kind: ContractStreamEventKind): boolean {
  return kind === "stream.completed" || kind === "stream.aborted";
}

function normalizeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function resolveErrorRetryable(error: unknown): boolean {
  if (error && typeof error === "object" && "retryable" in error) {
    return (error as { retryable?: unknown }).retryable === true;
  }
  return false;
}

function resolveSyntheticErrorCode(
  error: unknown,
  retryable: boolean,
  assumeProviderFailure = false,
): ContractStreamErrorCode {
  if (error instanceof ModelProviderError) {
    return retryable ? "PROVIDER_TRANSIENT_FAILURE" : "PROVIDER_FAILURE";
  }
  if (retryable) {
    return "PROVIDER_TRANSIENT_FAILURE";
  }
  if (assumeProviderFailure) {
    return "PROVIDER_FAILURE";
  }
  return "INVALID_STREAM_EVENT";
}

function createSyntheticStartedEvent(
  turnId: string,
  sequence: number,
  occurredAtMs: number,
  eventIdFactory: AdaptStreamToContractEventsOptions["eventIdFactory"],
): ContractStreamEvent<"stream.started"> {
  const id = eventIdFactory?.({
    turnId,
    sourceType: "synthetic.started",
    sequence,
    kind: "stream.started",
  });

  return createContractStreamEvent({
    id: id ?? toEventId("stream.started", turnId, sequence),
    kind: "stream.started",
    occurredAtMs,
    payload: {
      turnId,
    },
  });
}

function createSyntheticCompletedEvent(
  turnId: string,
  sequence: number,
  occurredAtMs: number,
  eventIdFactory: AdaptStreamToContractEventsOptions["eventIdFactory"],
): ContractStreamEvent<"stream.completed"> {
  const id = eventIdFactory?.({
    turnId,
    sourceType: "synthetic.completed",
    sequence,
    kind: "stream.completed",
  });

  return createContractStreamEvent({
    id: id ?? toEventId("stream.completed", turnId, sequence),
    kind: "stream.completed",
    occurredAtMs,
    payload: {
      turnId,
      finishReason: "stop",
    },
  });
}

function createSyntheticErrorEvent(
  turnId: string,
  sequence: number,
  occurredAtMs: number,
  message: string,
  retryable: boolean,
  code: ContractStreamErrorCode,
  eventIdFactory: AdaptStreamToContractEventsOptions["eventIdFactory"],
): ContractStreamEvent<"stream.error"> {
  const id = eventIdFactory?.({
    turnId,
    sourceType: "synthetic.error",
    sequence,
    kind: "stream.error",
  });

  return createContractStreamEvent({
    id: id ?? toEventId("stream.error", turnId, sequence),
    kind: "stream.error",
    occurredAtMs,
    payload: {
      turnId,
      error: {
        code,
        message,
        retryable,
      },
    },
  });
}

function createSyntheticAbortedEvent(
  turnId: string,
  sequence: number,
  occurredAtMs: number,
  message: string,
  retryable: boolean,
  eventIdFactory: AdaptStreamToContractEventsOptions["eventIdFactory"],
): ContractStreamEvent<"stream.aborted"> {
  const id = eventIdFactory?.({
    turnId,
    sourceType: "synthetic.aborted",
    sequence,
    kind: "stream.aborted",
  });

  return createContractStreamEvent({
    id: id ?? toEventId("stream.aborted", turnId, sequence),
    kind: "stream.aborted",
    occurredAtMs,
    payload: {
      turnId,
      failure: {
        stage: "stream",
        recoverable: false,
        error: {
          code: "ABORTED",
          message,
          retryable,
        },
      },
    },
  });
}

export function createContractFailureEventEnvelopes(
  input: ContractFailureEnvelopeInput,
): readonly ContractStreamEventEnvelope[] {
  const sequenceStart = input.sequenceStart ?? 0;
  const now = input.occurredAtMs ?? Date.now();
  const errorEvent = createSyntheticErrorEvent(
    input.turnId,
    sequenceStart,
    now,
    input.message,
    input.retryable,
    resolveSyntheticErrorCode(undefined, input.retryable, true),
    input.eventIdFactory,
  );
  const abortedEvent = createSyntheticAbortedEvent(
    input.turnId,
    sequenceStart + 1,
    now,
    `stream aborted after upstream failure: ${input.message}`,
    input.retryable,
    input.eventIdFactory,
  );
  return [
    {
      sequence: sequenceStart,
      sourceType: "synthetic.error",
      chunkIndex: 0,
      terminal: false,
      event: errorEvent,
    },
    {
      sequence: sequenceStart + 1,
      sourceType: "synthetic.aborted",
      chunkIndex: 0,
      terminal: true,
      event: abortedEvent,
    },
  ];
}

export async function* adaptStreamToContractEventEnvelopes(
  turnId: string,
  stream: AsyncIterable<StreamEvent>,
  options: AdaptStreamToContractEventsOptions = {},
): AsyncGenerator<ContractStreamEventEnvelope> {
  const now = options.now ?? Date.now;
  let sequence = 0;
  let chunkIndex = 0;
  let started = false;
  let terminal = false;

  const emit = (
    sourceType: ContractStreamSourceType,
    event: ContractStreamEvent,
    currentChunkIndex: number,
  ): ContractStreamEventEnvelope => ({
    sequence,
    sourceType,
    chunkIndex: currentChunkIndex,
    terminal: isTerminalKind(event.kind),
    event,
  });

  const emitSyntheticStarted = (): ContractStreamEventEnvelope => {
    const currentChunkIndex = chunkIndex;
    const event = createSyntheticStartedEvent(turnId, sequence, now(), options.eventIdFactory);
    const envelope = emit("synthetic.started", event, currentChunkIndex);
    started = true;
    sequence += 1;
    return envelope;
  };

  try {
    for await (const source of stream) {
      if (!started && source.type !== "response_started") {
        yield emitSyntheticStarted();
      }

      const kind = inferContractStreamKind(source);
      const generatedEventId = options.eventIdFactory?.({
        turnId,
        source,
        sourceType: source.type,
        sequence,
        kind,
      });
      const currentChunkIndex = chunkIndex;
      const result = adaptStreamEventToContractEvent({
        turnId,
        source,
        sequence,
        chunkIndex: currentChunkIndex,
        occurredAtMs: now(),
        ...(generatedEventId !== undefined ? { eventId: generatedEventId } : {}),
      });

      const envelope = emit(source.type, result.event, currentChunkIndex);
      chunkIndex = result.nextChunkIndex;
      started = started || result.event.kind === "stream.started";
      terminal = terminal || envelope.terminal;
      sequence += 1;
      yield envelope;
    }
  } catch (error) {
    if (!started) {
      yield emitSyntheticStarted();
    }

    const message = normalizeUnknownError(error);
    const retryable = resolveErrorRetryable(error);
    const code = resolveSyntheticErrorCode(error, retryable);
    {
      const event = createSyntheticErrorEvent(
        turnId,
        sequence,
        now(),
        message,
        retryable,
        code,
        options.eventIdFactory,
      );
      const envelope = emit("synthetic.error", event, chunkIndex);
      sequence += 1;
      yield envelope;
    }
    {
      const event = createSyntheticAbortedEvent(
        turnId,
        sequence,
        now(),
        `stream aborted after upstream failure: ${message}`,
        retryable,
        options.eventIdFactory,
      );
      const envelope = emit("synthetic.aborted", event, chunkIndex);
      sequence += 1;
      terminal = true;
      yield envelope;
    }
    return;
  }

  if (!started) {
    yield emitSyntheticStarted();
  }

  if (!terminal) {
    const currentChunkIndex = chunkIndex;
    const event = createSyntheticCompletedEvent(turnId, sequence, now(), options.eventIdFactory);
    const envelope = emit("synthetic.completed", event, currentChunkIndex);
    sequence += 1;
    yield envelope;
  }
}

export async function* adaptStreamToContractEvents(
  turnId: string,
  stream: AsyncIterable<StreamEvent>,
  options: AdaptStreamToContractEventsOptions = {},
): AsyncGenerator<ContractStreamEvent> {
  for await (const envelope of adaptStreamToContractEventEnvelopes(turnId, stream, options)) {
    yield envelope.event;
  }
}

function inferContractStreamKind(source: StreamEvent): ContractStreamEventKind {
  switch (source.type) {
    case "response_started":
      return "stream.started";
    case "text_delta":
      return "stream.chunk";
    case "status_delta":
      return "stream.step";
    case "response_resumed":
      return "stream.resumed";
    case "tool_boundary":
      return "stream.tool-call";
    case "response_paused":
      return "stream.interrupted";
    case "response_completed":
      return "stream.completed";
    case "response_aborted":
      return "stream.aborted";
  }
}
