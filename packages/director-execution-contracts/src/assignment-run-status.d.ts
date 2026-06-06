export declare const ASSIGNMENT_RUN_STATUSES: readonly [
  "pending",
  "ready",
  "blocked",
  "running",
  "completed",
  "failed",
  "aborted",
  "skipped",
];
export type AssignmentRunStatus = (typeof ASSIGNMENT_RUN_STATUSES)[number];
export declare function isAssignmentRunStatus(value: unknown): value is AssignmentRunStatus;
//# sourceMappingURL=assignment-run-status.d.ts.map
