import {
  CONTRACTS_SCHEMA_VERSION,
  type ReasoningStrategyDecision,
  type RuntimeFailureKind,
  type RuntimeRecoveryAction,
  type RuntimeStage,
  type StreamEventKind,
} from "@hotflow/contracts";
import type { JsonObject, JsonValue } from "@hotflow/sessions";

import type { EngineStepJournalEvent, EngineTurnBranch } from "./engine-step-strategy.js";
import type { EngineDependencies } from "./types.js";

type StreamRuntimeSessionStore = {
  appendStreamEvent: NonNullable<EngineDependencies["sessionStore"]["appendStreamEvent"]>;
  listStreamEvents: NonNullable<EngineDependencies["sessionStore"]["listStreamEvents"]>;
};

type TurnFinishReason = "stop" | "length" | "error";

interface RecorderFailureError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly kind?: string | undefined;
  readonly defaultAction?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface RecorderFailureSurface {
  readonly stage: RuntimeStage;
  readonly kind: RuntimeFailureKind;
  readonly action: RuntimeRecoveryAction;
  readonly recoverable: boolean;
  readonly operatorVisible?: boolean;
  readonly error: RecorderFailureError;
}

export interface TurnStreamRecorder {
  recordReasoning(input: {
    readonly decision: ReasoningStrategyDecision;
    readonly summary: string;
  }): Promise<void>;
  beforeModelCall(input?: { readonly reason?: string }): Promise<void>;
  recordStep(input: {
    readonly continueLoop: boolean;
    readonly events: readonly EngineStepJournalEvent[];
    readonly turnBranch: EngineTurnBranch;
  }): Promise<void>;
  recordFailure(failure: RecorderFailureSurface): Promise<void>;
  completeTurn(input: { readonly finishReason: TurnFinishReason }): Promise<void>;
}

interface RecorderState {
  sequence: number;
  chunkIndex: number;
  started: boolean;
  interrupted: boolean;
  reasoningRecorded: boolean;
  terminal: boolean;
}

const TERMINAL_STREAM_KINDS = new Set<StreamEventKind>(["stream.completed", "stream.aborted"]);

export function asStreamSessionStore(
  sessionStore: EngineDependencies["sessionStore"],
): StreamRuntimeSessionStore | undefined {
  if (
    typeof sessionStore.appendStreamEvent === "function" &&
    typeof sessionStore.listStreamEvents === "function"
  ) {
    return {
      appendStreamEvent: sessionStore.appendStreamEvent.bind(sessionStore),
      listStreamEvents: sessionStore.listStreamEvents.bind(sessionStore),
    };
  }

  return undefined;
}

export function createTurnStreamRecorder(input: {
  readonly sessionId: string;
  readonly turnId: string;
  readonly sessionStore: StreamRuntimeSessionStore | undefined;
  readonly now?: () => number;
}): TurnStreamRecorder {
  if (!input.sessionStore) {
    return createNoopTurnStreamRecorder();
  }
  const sessionStore = input.sessionStore;

  const state = restoreRecorderState(
    sessionStore.listStreamEvents(input.sessionId, {
      turnId: input.turnId,
    }),
  );
  const now = input.now ?? Date.now;

  const append = async (kind: StreamEventKind, payload: JsonValue): Promise<void> => {
    if (state.terminal) {
      return;
    }

    const occurredAtMs = now();
    sessionStore.appendStreamEvent(input.sessionId, {
      turnId: input.turnId,
      createdAtMs: occurredAtMs,
      event: {
        id: `stream_${input.turnId}_${kind}_${state.sequence}`,
        kind,
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        occurredAtMs,
        payload,
      },
    });

    state.sequence += 1;
    if (kind === "stream.started") {
      state.started = true;
      return;
    }
    if (kind === "stream.chunk") {
      state.chunkIndex += 1;
      return;
    }
    if (kind === "stream.interrupted") {
      state.interrupted = true;
      return;
    }
    if (kind === "stream.resumed") {
      state.interrupted = false;
      return;
    }
    if (TERMINAL_STREAM_KINDS.has(kind)) {
      state.interrupted = false;
      state.terminal = true;
    }
  };

  const appendChunk = async (delta: string): Promise<void> => {
    if (delta.length === 0) {
      return;
    }
    await append("stream.chunk", {
      turnId: input.turnId,
      index: state.chunkIndex,
      delta,
    } satisfies JsonObject);
  };

  const appendInterrupted = async (reason: string, resumable: boolean): Promise<void> => {
    await append("stream.interrupted", {
      turnId: input.turnId,
      reason,
      resumable,
    } satisfies JsonObject);
  };

  const appendResumed = async (reason: string): Promise<void> => {
    await append("stream.resumed", {
      turnId: input.turnId,
      reason,
    } satisfies JsonObject);
  };

  const appendCompleted = async (finishReason: TurnFinishReason): Promise<void> => {
    await append("stream.completed", {
      turnId: input.turnId,
      finishReason,
    } satisfies JsonObject);
  };

  return {
    async recordReasoning(reasoning) {
      if (state.terminal || state.reasoningRecorded) {
        return;
      }
      if (!state.started) {
        await append("stream.started", { turnId: input.turnId } satisfies JsonObject);
      }
      await append("stream.reasoning", {
        turnId: input.turnId,
        decision: serializeReasoningDecision(reasoning.decision),
        summary: reasoning.summary,
      } satisfies JsonObject);
      state.reasoningRecorded = true;
    },
    async beforeModelCall(inputValue = {}) {
      if (state.terminal) {
        return;
      }
      if (!state.started) {
        await append("stream.started", { turnId: input.turnId } satisfies JsonObject);
        return;
      }
      if (state.interrupted) {
        await appendResumed(inputValue.reason ?? "tool boundary cleared");
      }
    },
    async recordStep(step) {
      if (state.terminal) {
        return;
      }

      const modelOutputText = readStepModelOutputText(step.events);
      const plannedTools = readStepPlannedTools(step.events);
      const finalOutputText = readStepFinalOutputText(step.events);

      if (plannedTools.length === 0) {
        const terminalText = finalOutputText ?? modelOutputText;
        if (terminalText !== undefined) {
          await appendChunk(terminalText);
        }
        await appendCompleted("stop");
        return;
      }

      if (modelOutputText !== undefined) {
        await appendChunk(modelOutputText);
      }
      for (const toolCall of plannedTools) {
        await append("stream.tool-call", {
          turnId: input.turnId,
          call: {
            callId: toolCall.id,
            tool: {
              name: toolCall.name,
              version: "unspecified",
              kind: "function",
              timeoutMs: 0,
              parameters: [],
            },
            args: toolCall.args,
            startedAtMs: now(),
          },
        } satisfies JsonObject);
      }

      const hasTerminalClosure = Boolean(finalOutputText && finalOutputText.length > 0);
      await appendInterrupted("tool_boundary", step.continueLoop || hasTerminalClosure);

      if (step.continueLoop) {
        return;
      }

      if (hasTerminalClosure) {
        await appendResumed(resolveTerminalResumeReason(step.turnBranch));
        if (finalOutputText !== undefined && finalOutputText !== modelOutputText) {
          await appendChunk(finalOutputText);
        }
      }

      await appendCompleted("stop");
    },
    async recordFailure(failure) {
      if (state.terminal) {
        return;
      }
      if (!state.started) {
        await append("stream.started", { turnId: input.turnId } satisfies JsonObject);
      }

      const serializedError = serializeFailureError(failure.error);
      await append("stream.error", {
        turnId: input.turnId,
        error: serializedError,
      } satisfies JsonObject);
      await append("stream.aborted", {
        turnId: input.turnId,
        failure: {
          stage: failure.stage,
          kind: failure.kind,
          action: failure.action,
          recoverable: failure.recoverable,
          ...(failure.operatorVisible === undefined
            ? {}
            : { operatorVisible: failure.operatorVisible }),
          error: serializedError,
        },
      } satisfies JsonObject);
    },
    async completeTurn(result) {
      if (state.terminal) {
        return;
      }
      await appendCompleted(result.finishReason);
    },
  };
}

function createNoopTurnStreamRecorder(): TurnStreamRecorder {
  return {
    async recordReasoning() {},
    async beforeModelCall() {},
    async recordStep() {},
    async recordFailure() {},
    async completeTurn() {},
  };
}

function restoreRecorderState(
  entries: readonly {
    readonly event: {
      readonly kind: string;
      readonly payload: JsonValue;
    };
  }[],
): RecorderState {
  let chunkIndex = 0;
  for (const entry of entries) {
    if (entry.event.kind !== "stream.chunk") {
      continue;
    }
    const payload = asRecord(entry.event.payload);
    if (typeof payload?.index === "number" && Number.isFinite(payload.index)) {
      chunkIndex = Math.max(chunkIndex, payload.index + 1);
    }
  }

  const lastEventKind = entries.at(-1)?.event.kind;
  return {
    sequence: entries.length,
    chunkIndex,
    started: entries.some((entry) => entry.event.kind === "stream.started"),
    interrupted: lastEventKind === "stream.interrupted",
    reasoningRecorded: entries.some((entry) => entry.event.kind === "stream.reasoning"),
    terminal:
      lastEventKind !== undefined && TERMINAL_STREAM_KINDS.has(lastEventKind as StreamEventKind),
  };
}

function readStepModelOutputText(events: readonly EngineStepJournalEvent[]): string | undefined {
  const payload = events.find((event) => event.eventType === "step.model_output")?.payload;
  const record = asRecord(payload);
  return typeof record?.text === "string" ? record.text : undefined;
}

function readStepFinalOutputText(events: readonly EngineStepJournalEvent[]): string | undefined {
  const payload = events.find((event) => event.eventType === "step.final_output")?.payload;
  const record = asRecord(payload);
  return typeof record?.text === "string" ? record.text : undefined;
}

function readStepPlannedTools(
  events: readonly EngineStepJournalEvent[],
): ReadonlyArray<{ readonly id: string; readonly name: string; readonly args: JsonObject }> {
  const payload = events.find((event) => event.eventType === "step.tools_planned")?.payload;
  const record = asRecord(payload);
  const toolCalls = Array.isArray(record?.toolCalls) ? record.toolCalls : [];

  return toolCalls
    .map((toolCall) => {
      const value = asRecord(toolCall);
      if (!value || typeof value.id !== "string" || typeof value.name !== "string") {
        return null;
      }
      return {
        id: value.id,
        name: value.name,
        args: toJsonObject(value.args),
      };
    })
    .filter(
      (
        toolCall,
      ): toolCall is { readonly id: string; readonly name: string; readonly args: JsonObject } =>
        toolCall !== null,
    );
}

function resolveTerminalResumeReason(turnBranch: EngineTurnBranch): string {
  switch (turnBranch) {
    case "policy-denied":
      return "policy denied tool execution";
    case "approval-required":
      return "approval required before tool execution";
    case "tool-failed":
      return "tool execution failed";
    case "tool-degraded":
      return "tool execution degraded";
    default:
      return "tool boundary cleared";
  }
}

function serializeFailureError(error: RecorderFailureError): JsonObject {
  return {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    ...(error.kind === undefined ? {} : { kind: error.kind }),
    ...(error.defaultAction === undefined ? {} : { defaultAction: error.defaultAction }),
    ...(error.metadata === undefined ? {} : { metadata: toJsonValue(error.metadata) }),
  };
}

function serializeReasoningDecision(decision: ReasoningStrategyDecision): JsonObject {
  return {
    schemaVersion: decision.schemaVersion,
    strategy: decision.strategy,
    confidence: decision.confidence,
    rationale: decision.rationale,
    ...(decision.suggestedAction === undefined
      ? {}
      : {
          suggestedAction: {
            type: decision.suggestedAction.type,
            ...(decision.suggestedAction.summary === undefined
              ? {}
              : { summary: decision.suggestedAction.summary }),
          } satisfies JsonObject,
        }),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toJsonObject(value: unknown): JsonObject {
  const jsonValue = toJsonValue(value);
  if (jsonValue && typeof jsonValue === "object" && !Array.isArray(jsonValue)) {
    return jsonValue as JsonObject;
  }
  return {};
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.cause === undefined ? {} : { cause: toJsonValue(value.cause) }),
    } satisfies JsonObject;
  }

  if (value && typeof value === "object") {
    const jsonObject: JsonObject = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      jsonObject[key] = toJsonValue(nestedValue);
    }
    return jsonObject;
  }

  return String(value);
}
