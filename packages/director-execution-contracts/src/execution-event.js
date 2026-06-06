import { isObject, isOptional, isString, isStringRecord } from "./guards.js";
export const EXECUTION_EVENT_TYPES = [
  "run-created",
  "run-status-changed",
  "assignment-materialized",
  "assignment-status-changed",
  "system",
  "log",
];
export function isExecutionEvent(value) {
  return (
    isObject(value) &&
    isString(value.eventId) &&
    isString(value.runId) &&
    isString(value.type) &&
    EXECUTION_EVENT_TYPES.includes(value.type) &&
    isString(value.occurredAt) &&
    isString(value.message) &&
    isOptional(value.metadata, isStringRecord) &&
    isOptional(value.payload, isObject)
  );
}
//# sourceMappingURL=execution-event.js.map
