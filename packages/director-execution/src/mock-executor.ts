import type { AssignmentResult, AssignmentRun } from "@hotflow/director-execution-contracts";

export interface MockExecutorOptions {
  readonly now?: () => string;
  readonly defaultAdapterId?: string;
}

export interface MockExecutorRunOptions {
  readonly workerId: string;
}

export interface MockAssignmentExecutor {
  execute(assignment: AssignmentRun, options: MockExecutorRunOptions): Promise<AssignmentResult>;
}

export function createDeterministicMockExecutor(
  options: MockExecutorOptions = {},
): MockAssignmentExecutor {
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async execute(
      assignment: AssignmentRun,
      runOptions: MockExecutorRunOptions,
    ): Promise<AssignmentResult> {
      const adapterId =
        assignment.selectedAdapter ??
        assignment.allowedAdapters?.[0] ??
        options.defaultAdapterId ??
        "mock-execution";

      return {
        runId: assignment.runId,
        assignmentId: assignment.assignmentId,
        status: "completed",
        recordedAt: now(),
        workerId: runOptions.workerId,
        summary: `Mock executed ${assignment.role} assignment "${assignment.assignmentId}" via ${adapterId}.`,
        adapterId,
        notes: ["preview-safe", "no external side effects were triggered"],
      };
    },
  };
}
