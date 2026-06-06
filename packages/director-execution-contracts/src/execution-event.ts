import { isObject, isOptional, isString, isStringRecord } from "./guards.js";
import type { UnknownRecord } from "./guards.js";

export const EXECUTION_EVENT_TYPES = [
  "run-created",
  "run-status-changed",
  "assignment-materialized",
  "assignment-status-changed",
  "system",
  "log",
] as const;

export type ExecutionEventType = (typeof EXECUTION_EVENT_TYPES)[number];

export interface ExecutionEvent {
  readonly eventId: string;
  readonly runId: string;
  readonly type: ExecutionEventType;
  readonly occurredAt: string;
  readonly message: string;
  readonly metadata?: Record<string, string>;
  readonly payload?: UnknownRecord;
}

export function isExecutionEvent(value: unknown): value is ExecutionEvent {
  return (
    isObject(value) &&
    isString(value.eventId) &&
    isString(value.runId) &&
    isString(value.type) &&
    EXECUTION_EVENT_TYPES.includes(value.type as ExecutionEventType) &&
    isString(value.occurredAt) &&
    isString(value.message) &&
    isOptional(value.metadata, isStringRecord) &&
    isOptional(value.payload, isObject)
  );
}
