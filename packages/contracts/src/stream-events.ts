import type { ContractError, RuntimeDegradeSurface, RuntimeErrorSurface } from "./errors.js";
import type { ReasoningAction, ReasoningStrategyDecision } from "./reasoning.js";
import { CONTRACTS_SCHEMA_VERSION } from "./schema-version.js";
import type { ToolCallContract } from "./tool.js";

export interface StreamEventPayloadMap {
  readonly "stream.started": { readonly turnId: string };
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
  readonly "stream.reasoning": {
    readonly turnId: string;
    readonly decision: ReasoningStrategyDecision;
    readonly summary: string;
  };
  readonly "stream.step": {
    readonly turnId: string;
    readonly stepId: string;
    readonly index: number;
    readonly action?: ReasoningAction;
    readonly summary?: string;
  };
  readonly "stream.tool-call": {
    readonly turnId: string;
    readonly call: ToolCallContract;
  };
  readonly "stream.degraded": {
    readonly turnId: string;
    readonly degradation: RuntimeDegradeSurface;
  };
  readonly "stream.aborted": {
    readonly turnId: string;
    readonly failure: RuntimeErrorSurface;
  };
  readonly "stream.completed": {
    readonly turnId: string;
    readonly finishReason: "stop" | "length" | "error";
  };
  readonly "stream.error": {
    readonly turnId: string;
    readonly error: ContractError;
  };
}

export type StreamEventKind = keyof StreamEventPayloadMap;

export interface StreamEvent<K extends StreamEventKind = StreamEventKind> {
  readonly id: string;
  readonly schemaVersion: typeof CONTRACTS_SCHEMA_VERSION;
  readonly kind: K;
  readonly occurredAtMs: number;
  readonly payload: StreamEventPayloadMap[K];
}

export function createStreamEvent<K extends StreamEventKind>(input: {
  readonly id: string;
  readonly kind: K;
  readonly occurredAtMs: number;
  readonly payload: StreamEventPayloadMap[K];
}): StreamEvent<K> {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    ...input,
  };
}
