import type { AssignmentRun, ExecutionBridgeReport } from "@hotflow/director-execution-contracts";

export function deriveExecutionBridgeReport(
  assignments: readonly AssignmentRun[],
): ExecutionBridgeReport | undefined {
  const bridgeAssignments = assignments.flatMap((assignment) =>
    assignment.result?.bridgeExecution
      ? [{ assignmentId: assignment.assignmentId, execution: assignment.result.bridgeExecution }]
      : [],
  );

  if (bridgeAssignments.length === 0) {
    return undefined;
  }

  const successes = bridgeAssignments.filter(
    ({ execution }) => execution.failure === undefined,
  ).length;
  const failedAssignments = bridgeAssignments.flatMap(({ assignmentId, execution }) =>
    execution.failure === undefined
      ? []
      : [
          {
            assignmentId,
            reason: execution.failure.reason,
            retryable: execution.failure.retryable,
            ...(execution.failure.statusCode === undefined
              ? {}
              : { statusCode: execution.failure.statusCode }),
          },
        ],
  );

  return {
    attempts: bridgeAssignments.length,
    successes,
    failures: failedAssignments.length,
    failedAssignments,
  };
}
