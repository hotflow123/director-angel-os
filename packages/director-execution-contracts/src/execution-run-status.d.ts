export declare const EXECUTION_RUN_STATUSES: readonly [
  "created",
  "running",
  "paused",
  "completed",
  "failed",
  "aborted",
];
export type ExecutionRunStatus = (typeof EXECUTION_RUN_STATUSES)[number];
export declare function isExecutionRunStatus(value: unknown): value is ExecutionRunStatus;
//# sourceMappingURL=execution-run-status.d.ts.map
