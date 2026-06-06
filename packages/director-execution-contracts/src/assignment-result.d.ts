import type { ExecutionBridgeExecution } from "./bridge-execution.js";
export declare const ASSIGNMENT_RESULT_STATUSES: readonly [
  "completed",
  "failed",
  "aborted",
  "skipped",
];
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
export declare function isAssignmentResult(value: unknown): value is AssignmentResult;
//# sourceMappingURL=assignment-result.d.ts.map
