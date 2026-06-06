import { isOneOf } from "./guards.js";
export const EXECUTION_RUN_STATUSES = [
  "created",
  "running",
  "paused",
  "completed",
  "failed",
  "aborted",
];
export function isExecutionRunStatus(value) {
  return isOneOf(value, EXECUTION_RUN_STATUSES);
}
//# sourceMappingURL=execution-run-status.js.map
