import type { ExecutionRun, ExecutionRunReport } from "@hotflow/director-execution-contracts";

export interface DirectorRunHoldingStateSurface {
  readonly kind:
    | "created-ready-boundary"
    | "created-pending-waiting"
    | "created-idle"
    | "paused-ready-waiting"
    | "paused-pending-waiting"
    | "paused-idle";
  readonly verdictText: string;
  readonly summaryText: string;
  readonly nextAction: string;
  readonly suggestedCommands: readonly string[];
}

export function countDirectorRunAssignments(
  run: Pick<ExecutionRun, "assignments">,
): Record<
  "ready" | "pending" | "running" | "completed" | "failed" | "blocked" | "skipped" | "aborted",
  number
> {
  return {
    ready: run.assignments.filter((assignment) => assignment.status === "ready").length,
    pending: run.assignments.filter((assignment) => assignment.status === "pending").length,
    running: run.assignments.filter((assignment) => assignment.status === "running").length,
    completed: run.assignments.filter((assignment) => assignment.status === "completed").length,
    failed: run.assignments.filter((assignment) => assignment.status === "failed").length,
    blocked: run.assignments.filter((assignment) => assignment.status === "blocked").length,
    skipped: run.assignments.filter((assignment) => assignment.status === "skipped").length,
    aborted: run.assignments.filter((assignment) => assignment.status === "aborted").length,
  };
}

export function deriveDirectorRunHoldingStateSurface(
  report: ExecutionRunReport,
  options: {
    readonly fromLocalWorkerPass?: boolean;
    readonly localWorkerAdvanceCount?: number;
  } = {},
): DirectorRunHoldingStateSurface | undefined {
  if (report.run.status !== "created" && report.run.status !== "paused") {
    return undefined;
  }

  const assignmentCounts = countDirectorRunAssignments(report.run);
  const approvalHoldCount = report.run.assignments.filter(
    (assignment) =>
      assignment.status === "pending" && assignment.approvalMode === "operator_approve",
  ).length;
  const explainCommand = `hotflow director run explain --run-id ${report.runId}`;
  const reportCommand = `hotflow director run report --run-id ${report.runId}`;
  const resumeCommand = `hotflow director run resume --run-id ${report.runId}`;
  const runOnceCommand = `hotflow director run once --run-id ${report.runId}`;
  const fromLocalWorkerPass = options.fromLocalWorkerPass ?? false;
  const localWorkerAdvanceCount = options.localWorkerAdvanceCount ?? 0;

  if (report.run.status === "created") {
    if (assignmentCounts.ready > 0) {
      return {
        kind: "created-ready-boundary",
        verdictText:
          "Run is created and ready work is being held behind an execution control boundary.",
        summaryText: fromLocalWorkerPass
          ? `Local worker lane did not dispatch ${assignmentCounts.ready} ready assignment(s) because an execution control boundary kept the run in created.`
          : `Run is still created with ${assignmentCounts.ready} ready assignment(s), which usually means an execution switch or pause boundary is still preventing dispatch.`,
        nextAction:
          "inspect the execution switch or pause policy, then ask the local worker lane to try again after the boundary is lifted.",
        suggestedCommands: [explainCommand, reportCommand],
      };
    }

    if (assignmentCounts.pending > 0) {
      return {
        kind: "created-pending-waiting",
        verdictText:
          approvalHoldCount > 0
            ? "Run is created and still waiting on approval before any assignment becomes ready."
            : "Run is created and still waiting on dependencies before any assignment becomes ready.",
        summaryText: fromLocalWorkerPass
          ? "Local worker lane did not dispatch work because the run is still waiting on dependencies or approval before any assignment becomes ready."
          : approvalHoldCount > 0
            ? `Run is still created because ${approvalHoldCount} assignment(s) are waiting on operator approval before the next dispatch can begin.`
            : "Run is still created because downstream work is waiting on dependencies before the next dispatch can begin.",
        nextAction:
          approvalHoldCount > 0
            ? "review the approval-gated assignments before asking the local worker lane to try again."
            : "inspect the dependency boundary before asking the local worker lane to try again.",
        suggestedCommands: [explainCommand, reportCommand],
      };
    }

    return {
      kind: "created-idle",
      verdictText: "Run is created but there is no dispatchable work in the current bounded pass.",
      summaryText: fromLocalWorkerPass
        ? "Local worker lane did not dispatch work because no ready assignment was available in this bounded pass."
        : "Run is still created, but no ready assignment is currently available for dispatch.",
      nextAction:
        "inspect the persisted run report before deciding whether to wait, repair, or retry later.",
      suggestedCommands: [reportCommand, explainCommand],
    };
  }

  if (assignmentCounts.ready > 0) {
    return {
      kind: "paused-ready-waiting",
      verdictText: "Run is paused with ready work still waiting for operator control.",
      summaryText: fromLocalWorkerPass
        ? localWorkerAdvanceCount > 0
          ? `Local worker lane advanced ${localWorkerAdvanceCount} assignment(s), but the run paused with ${assignmentCounts.ready} ready assignment(s) still waiting to be claimed.`
          : `Local worker lane did not dispatch ready work because the run was already paused with ${assignmentCounts.ready} ready assignment(s) waiting.`
        : `Run is paused with ${assignmentCounts.ready} ready assignment(s) still waiting to be claimed.`,
      nextAction:
        "resume the paused run when safe, then ask the local worker lane for another bounded pass.",
      suggestedCommands: [resumeCommand, runOnceCommand],
    };
  }

  if (assignmentCounts.pending > 0) {
    return {
      kind: "paused-pending-waiting",
      verdictText:
        approvalHoldCount > 0
          ? "Run is paused and the remaining work is waiting on approval."
          : "Run is paused and the remaining work is waiting on dependencies.",
      summaryText: fromLocalWorkerPass
        ? localWorkerAdvanceCount > 0
          ? `Local worker lane advanced ${localWorkerAdvanceCount} assignment(s), and the remaining work is now waiting on dependencies or approval before another dispatch.`
          : "Local worker lane ended on a paused run with no dispatchable work; remaining work is waiting on dependencies or approval."
        : approvalHoldCount > 0
          ? `Run is paused, and ${approvalHoldCount} assignment(s) still need operator approval before another dispatch can begin.`
          : "Run is paused, and the remaining work is waiting on dependencies before another dispatch can begin.",
      nextAction:
        approvalHoldCount > 0
          ? "review the approval-gated assignments, then resume only when the next bounded pass is safe."
          : "inspect the updated run report and wait for the dependency boundary to clear before another worker pass.",
      suggestedCommands: [reportCommand, explainCommand],
    };
  }

  return {
    kind: "paused-idle",
    verdictText: "Run is paused without dispatchable work in the current bounded pass.",
    summaryText: fromLocalWorkerPass
      ? localWorkerAdvanceCount > 0
        ? `Local worker lane advanced ${localWorkerAdvanceCount} assignment(s), then the run paused without more dispatchable work in this bounded pass.`
        : "Local worker lane finished this bounded pass without finding dispatchable work on the paused run."
      : "Run is paused, but no assignment is currently dispatchable.",
    nextAction:
      "inspect the persisted run report before deciding whether to resume, wait, or repair the run.",
    suggestedCommands: [reportCommand, explainCommand],
  };
}
