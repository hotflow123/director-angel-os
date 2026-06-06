import { isAssignmentRun } from "./assignment-run.js";
import type { AssignmentRun } from "./assignment-run.js";
import { isExecutionEvent } from "./execution-event.js";
import type { ExecutionEvent } from "./execution-event.js";
import { isExecutionRunStatus } from "./execution-run-status.js";
import type { ExecutionRunStatus } from "./execution-run-status.js";
import { isArrayOfStrings, isBoolean, isObject, isOptional, isString } from "./guards.js";

export const DIRECTOR_EXECUTION_RUN_SCHEMA_VERSION = "director.execution.run.v1" as const;

export interface ExecutionRun {
  readonly schemaVersion: typeof DIRECTOR_EXECUTION_RUN_SCHEMA_VERSION;
  readonly runId: string;
  readonly snapshotId: string;
  readonly runtimeId: string;
  readonly blueprintId: string;
  readonly handoffId: string;
  readonly actionGraphId: string;
  readonly goal: string;
  readonly previewSummary: string;
  readonly sideEffectsAllowed: boolean;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly status: ExecutionRunStatus;
  readonly assignments: readonly AssignmentRun[];
  readonly events: readonly ExecutionEvent[];
  readonly notes?: readonly string[];
}

export function isExecutionRun(value: unknown): value is ExecutionRun {
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
