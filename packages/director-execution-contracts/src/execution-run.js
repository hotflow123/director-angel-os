import { isAssignmentRun } from "./assignment-run.js";
import { isExecutionEvent } from "./execution-event.js";
import { isExecutionRunStatus } from "./execution-run-status.js";
import { isArrayOfStrings, isBoolean, isObject, isOptional, isString } from "./guards.js";
export const DIRECTOR_EXECUTION_RUN_SCHEMA_VERSION = "director.execution.run.v1";
export function isExecutionRun(value) {
  return (
    isObject(value) &&
    value.schemaVersion === DIRECTOR_EXECUTION_RUN_SCHEMA_VERSION &&
    isString(value.runId) &&
    isString(value.snapshotId) &&
    isString(value.runtimeId) &&
    isString(value.blueprintId) &&
    isString(value.handoffId) &&
    isString(value.actionGraphId) &&
    isString(value.goal) &&
    isString(value.previewSummary) &&
    isBoolean(value.sideEffectsAllowed) &&
    isString(value.createdAt) &&
    isOptional(value.startedAt, isString) &&
    isString(value.updatedAt) &&
    isOptional(value.completedAt, isString) &&
    isExecutionRunStatus(value.status) &&
    Array.isArray(value.assignments) &&
    value.assignments.every(isAssignmentRun) &&
    Array.isArray(value.events) &&
    value.events.every(isExecutionEvent) &&
    isOptional(value.notes, isArrayOfStrings)
  );
}
//# sourceMappingURL=execution-run.js.map
