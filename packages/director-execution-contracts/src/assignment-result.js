import { ASSIGNMENT_RUN_STATUSES } from "./assignment-run-status.js";
import { isExecutionBridgeExecution } from "./bridge-execution.js";
import { isArrayOfStrings, isObject, isOneOf, isOptional, isString } from "./guards.js";
export const ASSIGNMENT_RESULT_STATUSES = ["completed", "failed", "aborted", "skipped"];
export function isAssignmentResult(value) {
  return (
    isObject(value) &&
    isString(value.runId) &&
    isString(value.assignmentId) &&
    isOneOf(value.status, ASSIGNMENT_RESULT_STATUSES) &&
    ASSIGNMENT_RUN_STATUSES.includes(value.status) &&
    isString(value.recordedAt) &&
    isString(value.workerId) &&
    isString(value.summary) &&
    isOptional(value.adapterId, (candidate) => candidate === null || isString(candidate)) &&
    isOptional(value.bridgeExecution, isExecutionBridgeExecution) &&
    isOptional(value.notes, isArrayOfStrings)
  );
}
