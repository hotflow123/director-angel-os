import type { AssignmentRun, ExecutionRunStatus } from "@hotflow/director-execution-contracts";

import type { MockAssignmentExecutor } from "./mock-executor.js";
import type { ExecutionRunService } from "./service.js";

export type ExecutionWorkerLoopStatus = "completed" | "stopped" | "failed";

export type ExecutionWorkerLoopStoppedReason =
  | "run-terminal"
  | "run-paused"
  | "no-ready-assignment"
  | "max-claims"
  | "executor-error";

export interface RunExecutionWorkerLoopInput {
  readonly service: ExecutionRunService;
  readonly runId: string;
  readonly workerId?: string;
  readonly executor: MockAssignmentExecutor;
  readonly maxClaims?: number;
}

export interface ExecutionWorkerLoopReport {
  readonly schemaVersion: "director-execution.worker-loop.v1";
  readonly runId: string;
  readonly workerId: string;
  readonly status: ExecutionWorkerLoopStatus;
  readonly claimedCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly stoppedReason: ExecutionWorkerLoopStoppedReason;
  readonly assignmentIds: readonly string[];
  readonly errors: readonly string[];
}

export async function runExecutionWorkerLoop(
  input: RunExecutionWorkerLoopInput,
): Promise<ExecutionWorkerLoopReport> {
  const workerId = input.workerId ?? "director-worker";
  const maxClaims = normalizeMaxClaims(input.maxClaims);
  const assignmentIds: string[] = [];
  const errors: string[] = [];
  let completedCount = 0;
  let failedCount = 0;

  for (let claimIndex = 0; claimIndex < maxClaims; claimIndex += 1) {
    const currentRun = await input.service.getRun(input.runId);
    if (currentRun === null) {
      return createWorkerLoopReport({
        runId: input.runId,
        workerId,
        status: "failed",
        stoppedReason: "executor-error",
        assignmentIds,
        completedCount,
        failedCount,
        errors: [`Execution run not found: ${input.runId}`],
      });
    }
    if (currentRun.status === "paused") {
      return createWorkerLoopReport({
        runId: input.runId,
        workerId,
        status: "stopped",
        stoppedReason: "run-paused",
        assignmentIds,
        completedCount,
        failedCount,
        errors,
      });
    }
    if (isTerminalRunStatus(currentRun.status)) {
      return createWorkerLoopReport({
        runId: input.runId,
        workerId,
        status: "completed",
        stoppedReason: "run-terminal",
        assignmentIds,
        completedCount,
        failedCount,
        errors,
      });
    }

    const claimed = await input.service.claimNextReadyAssignment(input.runId, workerId);
    if (claimed === null) {
      return createWorkerLoopReport({
        runId: input.runId,
        workerId,
        status: "stopped",
        stoppedReason: "no-ready-assignment",
        assignmentIds,
        completedCount,
        failedCount,
        errors,
      });
    }

    assignmentIds.push(claimed.assignment.assignmentId);
    try {
      const result = await input.executor.execute(claimed.assignment, { workerId });
      const updatedRun = await input.service.completeAssignment(
        input.runId,
        claimed.assignment.assignmentId,
        result,
      );
      if (result.status === "completed") {
        completedCount += 1;
      } else {
        failedCount += 1;
      }
      if (isTerminalRunStatus(updatedRun.status)) {
        return createWorkerLoopReport({
          runId: input.runId,
          workerId,
          status: updatedRun.status === "completed" ? "completed" : "stopped",
          stoppedReason: "run-terminal",
          assignmentIds,
          completedCount,
          failedCount,
          errors,
        });
      }
    } catch (error) {
      failedCount += 1;
      errors.push(error instanceof Error ? error.message : String(error));
      await failClaimedAssignment(input.service, input.runId, claimed.assignment, workerId, error);
      return createWorkerLoopReport({
        runId: input.runId,
        workerId,
        status: "failed",
        stoppedReason: "executor-error",
        assignmentIds,
        completedCount,
        failedCount,
        errors,
      });
    }
  }

  return createWorkerLoopReport({
    runId: input.runId,
    workerId,
    status: "stopped",
    stoppedReason: "max-claims",
    assignmentIds,
    completedCount,
    failedCount,
    errors,
  });
}

async function failClaimedAssignment(
  service: ExecutionRunService,
  runId: string,
  assignment: AssignmentRun,
  workerId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await service.completeAssignment(runId, assignment.assignmentId, {
    runId,
    assignmentId: assignment.assignmentId,
    status: "failed",
    recordedAt: new Date().toISOString(),
    workerId,
    summary: `Worker loop executor failed: ${message}`,
    notes: ["worker-loop-executor-error"],
  });
}

function createWorkerLoopReport(input: {
  readonly runId: string;
  readonly workerId: string;
  readonly status: ExecutionWorkerLoopStatus;
  readonly stoppedReason: ExecutionWorkerLoopStoppedReason;
  readonly assignmentIds: readonly string[];
  readonly completedCount: number;
  readonly failedCount: number;
  readonly errors: readonly string[];
}): ExecutionWorkerLoopReport {
  return {
    schemaVersion: "director-execution.worker-loop.v1",
    runId: input.runId,
    workerId: input.workerId,
    status: input.status,
    claimedCount: input.assignmentIds.length,
    completedCount: input.completedCount,
    failedCount: input.failedCount,
    stoppedReason: input.stoppedReason,
    assignmentIds: [...input.assignmentIds],
    errors: [...input.errors],
  };
}

function normalizeMaxClaims(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.trunc(value));
}

function isTerminalRunStatus(status: ExecutionRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "aborted";
}
