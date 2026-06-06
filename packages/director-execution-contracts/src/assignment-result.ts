import { ASSIGNMENT_RUN_STATUSES } from "./assignment-run-status.js";
import { isExecutionBridgeExecution } from "./bridge-execution.js";
import type { ExecutionBridgeExecution } from "./bridge-execution.js";
import { isArrayOfStrings, isObject, isOneOf, isOptional, isString } from "./guards.js";

export const ASSIGNMENT_RESULT_STATUSES = ["completed", "failed", "aborted", "skipped"] as const;

export type AssignmentResultStatus = (typeof ASSIGNMENT_RESULT_STATUSES)[number];

export interface AssignmentResult {
  readonly runId: string;
  readonly assignmentId: string;
  readonly status: AssignmentResultStatus;
  readonly recordedAt: string;
  readonly workerId: string;
  readonly summary: string;
  readonly adapterId?: string | null;
  readonly bridgeExecution?: ExecutionBridgeExecution;
  readonly notes?: readonly string[];
}

export function isAssignmentResult(value: unknown): value is AssignmentResult {
  return (
    isObject(value) &&
    isString(value.runId) &&
    isString(value.assignmentId) &&
    isOneOf(value.status, ASSIGNMENT_RESULT_STATUSES) &&
    ASSIGNMENT_RUN_STATUSES.includes(value.status) &&
    isString(value.recordedAt) &&
    isString(value.workerId) &&
    isString(value.summary) &&
    isOptional(
      value.adapterId,
      (candidate): candidate is string | null => candidate === null || isString(candidate),
    ) &&
    isOptional(value.bridgeExecution, isExecutionBridgeExecution) &&
    isOptional(value.notes, isArrayOfStrings)
  );
}
