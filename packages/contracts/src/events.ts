import type { ContractError, RuntimeDegradeSurface, RuntimeErrorSurface } from "./errors.js";
import type { ModelInvocationContract } from "./model.js";
import type { RuntimeContext } from "./runtime-context.js";
import { CONTRACTS_SCHEMA_VERSION } from "./schema-version.js";
import type { SessionContract } from "./session.js";
import type { TaskContract, TaskStatus } from "./task.js";
import type { ToolCallContract } from "./tool.js";
import type { TurnContract, TurnStepContract } from "./turn.js";

export interface RuntimeEventPayloadMap {
  readonly "session.started": { readonly session: SessionContract };
  readonly "session.ended": { readonly session: SessionContract };
  readonly "turn.started": { readonly turn: TurnContract };
  readonly "turn.step.started": {
    readonly turn: TurnContract;
    readonly step: TurnStepContract;
  };
  readonly "turn.step.completed": {
    readonly turn: TurnContract;
    readonly step: TurnStepContract;
  };
  readonly "turn.completed": { readonly turn: TurnContract };
  readonly "task.created": { readonly task: TaskContract };
  readonly "task.updated": {
    readonly task: TaskContract;
    readonly previousStatus?: TaskStatus;
  };
  readonly "tool.called": { readonly call: ToolCallContract };
  readonly "tool.finished": { readonly call: ToolCallContract };
  readonly "model.invoked": { readonly invocation: ModelInvocationContract };
  readonly "runtime.degraded": {
    readonly degradation: RuntimeDegradeSurface;
  };
  readonly "runtime.failed": {
    readonly failure: RuntimeErrorSurface;
  };
  readonly "error.raised": { readonly error: ContractError };
}

export type RuntimeEventKind = keyof RuntimeEventPayloadMap;

export interface RuntimeEvent<K extends RuntimeEventKind = RuntimeEventKind> {
  readonly id: string;
  readonly schemaVersion: typeof CONTRACTS_SCHEMA_VERSION;
  readonly kind: K;
  readonly occurredAtMs: number;
  readonly context: RuntimeContext;
  readonly payload: RuntimeEventPayloadMap[K];
}

export type AnyRuntimeEvent = RuntimeEvent<RuntimeEventKind>;

export function createRuntimeEvent<K extends RuntimeEventKind>(input: {
  readonly id: string;
  readonly kind: K;
  readonly occurredAtMs: number;
  readonly context: RuntimeContext;
  readonly payload: RuntimeEventPayloadMap[K];
}): RuntimeEvent<K> {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    ...input,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isRuntimeEvent(value: unknown): value is AnyRuntimeEvent {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    typeof value.occurredAtMs === "number" &&
    value.schemaVersion === CONTRACTS_SCHEMA_VERSION &&
    isObject(value.context) &&
    isObject(value.payload)
  );
}
