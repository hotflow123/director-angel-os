import { isOneOf } from "./guards.js";

export const ASSIGNMENT_RUN_STATUSES = [
  "pending",
  "ready",
  "blocked",
  "running",
  "completed",
  "failed",
  "aborted",
  "skipped",
] as const;

export type AssignmentRunStatus = (typeof ASSIGNMENT_RUN_STATUSES)[number];

export function isAssignmentRunStatus(value: unknown): value is AssignmentRunStatus {
  return isOneOf(value, ASSIGNMENT_RUN_STATUSES);
}
