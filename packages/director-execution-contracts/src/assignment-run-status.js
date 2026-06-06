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
];
export function isAssignmentRunStatus(value) {
  return isOneOf(value, ASSIGNMENT_RUN_STATUSES);
}
//# sourceMappingURL=assignment-run-status.js.map
