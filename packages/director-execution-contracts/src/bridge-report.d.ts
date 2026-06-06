import type { ExecutionBridgeFailure } from "./bridge-execution.js";
export interface ExecutionBridgeFailureSummary {
  readonly assignmentId: string;
  readonly reason: ExecutionBridgeFailure["reason"];
  readonly retryable: boolean;
  readonly statusCode?: number;
}
export interface ExecutionBridgeReport {
  readonly attempts: number;
  readonly successes: number;
  readonly failures: number;
  readonly failedAssignments: readonly ExecutionBridgeFailureSummary[];
}
export declare function isExecutionBridgeFailureSummary(
  value: unknown,
): value is ExecutionBridgeFailureSummary;
export declare function isExecutionBridgeReport(value: unknown): value is ExecutionBridgeReport;
