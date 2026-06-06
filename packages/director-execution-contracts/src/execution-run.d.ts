import type { AssignmentRun } from "./assignment-run.js";
import type { ExecutionEvent } from "./execution-event.js";
import type { ExecutionRunStatus } from "./execution-run-status.js";
export declare const DIRECTOR_EXECUTION_RUN_SCHEMA_VERSION: "director.execution.run.v1";
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
export declare function isExecutionRun(value: unknown): value is ExecutionRun;
//# sourceMappingURL=execution-run.d.ts.map
