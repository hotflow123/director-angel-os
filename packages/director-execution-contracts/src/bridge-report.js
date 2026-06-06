import { isExecutionBridgeFailure } from "./bridge-execution.js";
import { isArrayOf, isObject, isString } from "./guards.js";
function isNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
export function isExecutionBridgeFailureSummary(value) {
  return (
    isObject(value) &&
    isString(value.assignmentId) &&
    isExecutionBridgeFailure({
      reason: value.reason,
      message: "summary",
      retryable: value.retryable,
      ...(value.statusCode === undefined ? {} : { statusCode: value.statusCode }),
    })
  );
}
export function isExecutionBridgeReport(value) {
  return (
    isObject(value) &&
    isNonNegativeInteger(value.attempts) &&
    isNonNegativeInteger(value.successes) &&
    isNonNegativeInteger(value.failures) &&
    isArrayOf(value.failedAssignments, isExecutionBridgeFailureSummary) &&
    value.successes + value.failures <= value.attempts
  );
}
