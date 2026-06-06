import { isExecutionBridgeFailure } from "./bridge-execution.js";
import type { ExecutionBridgeFailure } from "./bridge-execution.js";
import { isArrayOf, isObject, isString } from "./guards.js";

export interface ExecutionBridgeFailureSummary {
  readonly assignmentId: string;
  readonly reason: ExecutionBridgeFailure["reason"];
  readonly retryable: boolean;
  readonly statusCode?: number;
}

export interface ExecutionBridgeReport {
  readonly attempts: number;
  readonly successes: number;
  readonly failures: number;
  readonly failedAssignments: readonly ExecutionBridgeFailureSummary[];
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isExecutionBridgeFailureSummary(
  value: unknown,
): value is ExecutionBridgeFailureSummary {
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

export function isExecutionBridgeReport(value: unknown): value is ExecutionBridgeReport {
  return (
    isObject(value) &&
    isNonNegativeInteger(value.attempts) &&
    isNonNegativeInteger(value.successes) &&
    isNonNegativeInteger(value.failures) &&
    isArrayOf(value.failedAssignments, isExecutionBridgeFailureSummary) &&
    value.successes + value.failures <= value.attempts
  );
}
