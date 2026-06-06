import type { UnknownRecord } from "./guards.js";
export declare const EXECUTION_EVENT_TYPES: readonly [
  "run-created",
  "run-status-changed",
  "assignment-materialized",
  "assignment-status-changed",
  "system",
  "log",
];
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
export declare function isExecutionEvent(value: unknown): value is ExecutionEvent;
//# sourceMappingURL=execution-event.d.ts.map
