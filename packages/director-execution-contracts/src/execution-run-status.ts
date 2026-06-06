import { isOneOf } from "./guards.js";

export const EXECUTION_RUN_STATUSES = [
  "created",
  "running",
  "paused",
  "completed",
  "failed",
  "aborted",
] as const;

export type ExecutionRunStatus = (typeof EXECUTION_RUN_STATUSES)[number];

export function isExecutionRunStatus(value: unknown): value is ExecutionRunStatus {
  return isOneOf(value, EXECUTION_RUN_STATUSES);
}
