import type {
  AssignmentRun,
  ExecutionEvent,
  ExecutionRunReport,
} from "@hotflow/director-execution-contracts";

import {
  describeDirectorBridgeFailureNextAction,
  isDirectorBridgeFailureReason,
} from "./director-bridge-failure-guidance.js";
import {
  collectRerouteCandidates,
  deriveDirectorRouteHealthEntries,
} from "./director-route-health.js";
import { deriveDirectorRunHoldingStateSurface } from "./director-run-holding-state.js";

interface RetryCandidate {
  readonly assignmentId: string;
  readonly role: string;
  readonly reason: string;
  readonly retryable: boolean;
  readonly retryAllowed: boolean;
  readonly retriesUsed: number;
  readonly retryLimit?: number;
  readonly rerouteCandidates: readonly string[];
  readonly statusCode?: number;
}

const RETRY_REQUEST_NOTE_PREFIX = "Retry requested at ";
const REROUTE_REQUEST_NOTE_PREFIX = "Adapter rerouted from ";
const RETRYABLE_BRIDGE_FAILURE_RETRY_LIMIT = 1;

export function renderDirectorRunExplanation(report: ExecutionRunReport): string {
  const operatorSurface = report.operatorSurface;
  const holdingStateSurface = deriveDirectorRunHoldingStateSurface(report);
  const retryCandidates = collectRetryCandidates(report.run.assignments);
  const blockedAssignments = report.run.assignments.filter(
    (assignment) => assignment.status === "blocked",
  );
  const pendingApprovals = report.run.assignments.filter(
    (assignment) =>
      assignment.status === "pending" && assignment.approvalMode === "operator_approve",
  );
  const recentEvents = report.events.slice(-3);
  const routeHealth = deriveDirectorRouteHealthEntries(report.run.assignments);
  const nextAction =
    operatorSurface?.nextAction ??
    holdingStateSurface?.nextAction ??
    deriveNextAction(report, retryCandidates, blockedAssignments, pendingApprovals);

  const lines = [
    "Director run explain:",
    `  report id: ${report.reportId}`,
    `  run id: ${report.runId}`,
    `  run status: ${report.run.status}`,
    `  operator verdict: ${deriveOperatorVerdict(report, retryCandidates, blockedAssignments, pendingApprovals, holdingStateSurface?.verdictText)}`,
    `  director goal: ${operatorSurface?.directorGoal ?? report.run.goal}`,
  ];

  const operatorSummary =
    operatorSurface?.operatorSummary ??
    (report.run.previewSummary.trim().length > 0 && report.run.previewSummary !== report.run.goal
      ? report.run.previewSummary
      : undefined);
  if (operatorSummary !== undefined) {
    lines.push(`  operator summary: ${operatorSummary}`);
  }
  if (holdingStateSurface !== undefined) {
    lines.push(`  holding summary: ${holdingStateSurface.summaryText}`);
  }
  if (operatorSurface?.adapterRoute !== undefined) {
    lines.push(`  adapter route: ${operatorSurface.adapterRoute}`);
  }
  if (operatorSurface?.lastBridgeRoute !== undefined) {
    lines.push(`  last bridge route: ${operatorSurface.lastBridgeRoute}`);
  }
  if (operatorSurface?.bridgeVerdict !== undefined) {
    lines.push(
      operatorSurface.bridgeVerdict === "failed" &&
        operatorSurface.bridgeFailureReason !== undefined
        ? `  bridge verdict: failed (${operatorSurface.bridgeFailureReason})`
        : `  bridge verdict: ${operatorSurface.bridgeVerdict}`,
    );
  }
  if (operatorSurface?.requestAccepted !== undefined) {
    lines.push(`  request accepted: ${operatorSurface.requestAccepted ? "yes" : "no"}`);
  }
  if (operatorSurface?.bridgeStatus !== undefined) {
    lines.push(`  bridge status: ${operatorSurface.bridgeStatus}`);
  }
  if (operatorSurface?.requestId !== undefined) {
    lines.push(`  request id: ${operatorSurface.requestId}`);
  }
  if (operatorSurface?.rerouteCandidates !== undefined) {
    lines.push(`  reroute candidates: ${operatorSurface.rerouteCandidates.join(", ") || "(none)"}`);
  }
  lines.push(`  next action: ${nextAction}`);
  if (holdingStateSurface !== undefined) {
    lines.push(`  suggested commands: ${holdingStateSurface.suggestedCommands.join(" | ")}`);
  }

  lines.push(`  route health snapshot: ${routeHealth.length}`);
  if (routeHealth.length === 0) {
    lines.push("    (none)");
  } else {
    for (const entry of routeHealth) {
      const fragments = [
        `${entry.assignmentId}`,
        `role=${entry.role}`,
        `status=${entry.status}`,
        ...(entry.currentRoute === undefined ? [] : [`route=${entry.currentRoute}`]),
        ...(entry.lastBridgeRoute === undefined ? [] : [`last-bridge=${entry.lastBridgeRoute}`]),
        ...(entry.bridgeVerdict === undefined
          ? []
          : entry.bridgeVerdict === "failed"
            ? [
                `bridge=failed${entry.bridgeFailureReason === undefined ? "" : `(${entry.bridgeFailureReason})`}`,
              ]
            : [`bridge=${entry.bridgeVerdict}`]),
        ...(entry.bridgeStatus === undefined ? [] : [`status=${entry.bridgeStatus}`]),
        ...(entry.retryAllowed === undefined
          ? []
          : [`retry-allowed=${entry.retryAllowed ? "yes" : "no"}`]),
      ];
      lines.push(`    - ${fragments.join(" ")}`);
      if (entry.rerouteCandidates.length > 0) {
        lines.push(`      reroute candidates: ${entry.rerouteCandidates.join(", ")}`);
      }
      if (entry.blockingReason !== undefined) {
        lines.push(`      blocking reason: ${entry.blockingReason}`);
      }
    }
  }

  lines.push(`  retry candidates: ${retryCandidates.length}`);
  if (retryCandidates.length === 0) {
    lines.push("    (none)");
  } else {
    for (const candidate of retryCandidates) {
      lines.push(
        `    - ${candidate.assignmentId} role=${candidate.role} reason=${candidate.reason} retryable=${candidate.retryable ? "yes" : "no"} retry-allowed=${candidate.retryAllowed ? "yes" : "no"}${candidate.retryLimit === undefined ? "" : ` retry-budget=${candidate.retriesUsed}/${candidate.retryLimit}`}${candidate.statusCode === undefined ? "" : ` status=${candidate.statusCode}`}`,
      );
      if (candidate.rerouteCandidates.length > 0) {
        lines.push(`      reroute candidates: ${candidate.rerouteCandidates.join(", ")}`);
      }
      if (candidate.retryAllowed) {
        lines.push(
          `      suggested command: hotflow director run retry --run-id ${report.runId} --assignment-id ${candidate.assignmentId}`,
        );
      } else if (candidate.rerouteCandidates.length > 0) {
        for (const adapterId of candidate.rerouteCandidates) {
          lines.push(
            `      suggested command: hotflow director run reroute --run-id ${report.runId} --assignment-id ${candidate.assignmentId} --adapter-id ${adapterId}`,
          );
        }
      }
    }
  }

  lines.push(`  blocked assignments: ${blockedAssignments.length}`);
  if (blockedAssignments.length === 0) {
    lines.push("    (none)");
  } else {
    for (const assignment of blockedAssignments) {
      lines.push(
        `    - ${assignment.assignmentId} role=${assignment.role} reason=${resolveBlockedReason(assignment)}`,
      );
    }
  }

  lines.push(`  approval holds: ${pendingApprovals.length}`);
  if (pendingApprovals.length === 0) {
    lines.push("    (none)");
  } else {
    for (const assignment of pendingApprovals) {
      lines.push(
        `    - ${assignment.assignmentId} role=${assignment.role} deliverable=${assignment.deliverable}`,
      );
    }
  }

  lines.push("  recent events:");
  if (recentEvents.length === 0) {
    lines.push("    (none)");
  } else {
    for (const event of recentEvents) {
      lines.push(`    - ${formatEventLine(event)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function deriveOperatorVerdict(
  report: ExecutionRunReport,
  retryCandidates: readonly RetryCandidate[],
  blockedAssignments: readonly AssignmentRun[],
  pendingApprovals: readonly AssignmentRun[],
  holdingStateVerdict?: string,
): string {
  const operatorSurface = report.operatorSurface;
  const nonRetryableBridgeFailure = findNonRetryableBridgeFailure(retryCandidates);
  const reroutableExhaustedBridgeFailure =
    findReroutableExhaustedRetryableBridgeFailure(retryCandidates);
  const exhaustedRetryableBridgeFailure = findExhaustedRetryableBridgeFailure(retryCandidates);
  if (report.run.status === "failed") {
    if (retryCandidates.some((candidate) => candidate.retryAllowed)) {
      return "Run failed, but at least one assignment has a safe retry path.";
    }
    if (reroutableExhaustedBridgeFailure !== undefined) {
      return "Run failed and the retry budget is exhausted on the current route; reroute to another approved adapter before retrying again.";
    }
    if (exhaustedRetryableBridgeFailure !== undefined) {
      return "Run failed and the retry budget is exhausted; repair the route or choose a failover path before retrying again.";
    }
    if (nonRetryableBridgeFailure !== undefined) {
      return "Run failed and the current bridge failure must be fixed before it can be retried.";
    }
    return "Run failed and needs operator intervention before execution can continue.";
  }
  if (report.run.status === "paused") {
    return holdingStateVerdict ?? "Run is paused and waiting for operator control.";
  }
  if (report.run.status === "created") {
    return holdingStateVerdict ?? "Run is materialized but has not started yet.";
  }
  if (report.run.status === "aborted") {
    return "Run was aborted by operator control.";
  }
  if (pendingApprovals.length > 0) {
    return "Run is waiting on operator approval before more assignments can proceed.";
  }
  if (blockedAssignments.length > 0) {
    return "Run has blocked assignments that must be resolved before progress can continue.";
  }
  if (operatorSurface?.bridgeVerdict === "accepted") {
    return "Remote request was accepted; local execution is complete and downstream follow-up remains.";
  }
  if (operatorSurface?.bridgeVerdict === "responded") {
    return "Bridge responded successfully; operator should follow the downstream system next.";
  }
  if (report.run.status === "completed") {
    return "Run completed without outstanding local blockers.";
  }
  return "Run is still in progress.";
}

function deriveNextAction(
  report: ExecutionRunReport,
  retryCandidates: readonly RetryCandidate[],
  blockedAssignments: readonly AssignmentRun[],
  pendingApprovals: readonly AssignmentRun[],
): string {
  if (retryCandidates.some((candidate) => candidate.retryAllowed)) {
    const candidate = retryCandidates.find((entry) => entry.retryAllowed) ?? retryCandidates[0];
    return `retry ${candidate?.assignmentId ?? "the failed assignment"} after reviewing the failure boundary.`;
  }
  const reroutableExhaustedBridgeFailure =
    findReroutableExhaustedRetryableBridgeFailure(retryCandidates);
  if (reroutableExhaustedBridgeFailure !== undefined) {
    if (reroutableExhaustedBridgeFailure.rerouteCandidates.length === 1) {
      return `reroute ${reroutableExhaustedBridgeFailure.assignmentId} to ${reroutableExhaustedBridgeFailure.rerouteCandidates[0]} and then retry.`;
    }
    return `reroute ${reroutableExhaustedBridgeFailure.assignmentId} to one of the approved adapters (${reroutableExhaustedBridgeFailure.rerouteCandidates.join(", ")}) and then retry.`;
  }
  const exhaustedRetryableBridgeFailure = findExhaustedRetryableBridgeFailure(retryCandidates);
  if (exhaustedRetryableBridgeFailure !== undefined) {
    return describeDirectorBridgeFailureNextAction(exhaustedRetryableBridgeFailure, {
      retryAllowed: false,
    });
  }
  const nonRetryableBridgeFailure = findNonRetryableBridgeFailure(retryCandidates);
  if (nonRetryableBridgeFailure !== undefined) {
    return describeDirectorBridgeFailureNextAction(nonRetryableBridgeFailure);
  }
  if (pendingApprovals.length > 0) {
    return "review the approval-gated assignments before continuing the run.";
  }
  if (blockedAssignments.length > 0) {
    return "inspect the blocked assignments and resolve their route or policy reasons.";
  }
  if (report.run.status === "created") {
    return "start the run when the operator is ready.";
  }
  if (report.run.status === "paused") {
    return "resume the run or abort it if the current plan is no longer safe.";
  }
  if (report.run.status === "aborted") {
    return "recreate the run only after the operator confirms work should continue.";
  }
  if (report.run.status === "completed") {
    return "record the operator outcome or continue tracking the downstream system.";
  }
  return "wait for the execution lane to finish the current assignments.";
}

function collectRetryCandidates(assignments: readonly AssignmentRun[]): RetryCandidate[] {
  return assignments.flatMap<RetryCandidate>((assignment) => {
    if (assignment.status !== "failed" && assignment.status !== "blocked") {
      return [];
    }

    const bridgeFailure = assignment.result?.bridgeExecution?.failure;
    if (bridgeFailure !== undefined) {
      const retriesUsed = countRetryRequests(assignment.notes);
      const retryLimit = bridgeFailure.retryable ? RETRYABLE_BRIDGE_FAILURE_RETRY_LIMIT : undefined;
      const rerouteCandidates = collectRerouteCandidates(assignment);
      return [
        {
          assignmentId: assignment.assignmentId,
          role: assignment.role,
          reason: bridgeFailure.reason,
          retryable: bridgeFailure.retryable,
          retryAllowed:
            bridgeFailure.retryable &&
            retriesUsed < (retryLimit ?? RETRYABLE_BRIDGE_FAILURE_RETRY_LIMIT),
          retriesUsed,
          ...(retryLimit === undefined ? {} : { retryLimit }),
          rerouteCandidates,
          ...(bridgeFailure.statusCode === undefined
            ? {}
            : { statusCode: bridgeFailure.statusCode }),
        },
      ];
    }

    return [
      {
        assignmentId: assignment.assignmentId,
        role: assignment.role,
        reason: resolveBlockedReason(assignment),
        retryable: false,
        retryAllowed: false,
        retriesUsed: 0,
        rerouteCandidates: collectRerouteCandidates(assignment),
      },
    ];
  });
}

function resolveBlockedReason(assignment: AssignmentRun): string {
  if (assignment.blockingReason !== undefined) {
    return assignment.blockingReason;
  }
  const latestNote = assignment.notes?.at(-1);
  if (latestNote !== undefined) {
    return latestNote;
  }
  return assignment.result?.summary ?? "no structured reason recorded";
}

function findNonRetryableBridgeFailure(
  retryCandidates: readonly RetryCandidate[],
):
  | { readonly reason: string; readonly retryable: false; readonly statusCode?: number }
  | undefined {
  const candidate = retryCandidates.find(
    (entry) => !entry.retryable && isDirectorBridgeFailureReason(entry.reason),
  );
  if (candidate === undefined) {
    return undefined;
  }
  return {
    reason: candidate.reason,
    retryable: false,
    ...(candidate.statusCode === undefined ? {} : { statusCode: candidate.statusCode }),
  };
}

function findExhaustedRetryableBridgeFailure(
  retryCandidates: readonly RetryCandidate[],
): { readonly reason: string; readonly retryable: true; readonly statusCode?: number } | undefined {
  const candidate = retryCandidates.find(
    (entry) =>
      entry.retryable && !entry.retryAllowed && isDirectorBridgeFailureReason(entry.reason),
  );
  if (candidate === undefined) {
    return undefined;
  }
  return {
    reason: candidate.reason,
    retryable: true,
    ...(candidate.statusCode === undefined ? {} : { statusCode: candidate.statusCode }),
  };
}

function countRetryRequests(notes: readonly string[] | undefined): number {
  if (!notes || notes.length === 0) {
    return 0;
  }
  const lastRerouteIndex = findLastRerouteRequestIndex(notes);
  return notes
    .slice(lastRerouteIndex + 1)
    .filter((note) => note.startsWith(RETRY_REQUEST_NOTE_PREFIX)).length;
}

function findReroutableExhaustedRetryableBridgeFailure(
  retryCandidates: readonly RetryCandidate[],
): RetryCandidate | undefined {
  return retryCandidates.find(
    (entry) =>
      entry.retryable &&
      !entry.retryAllowed &&
      entry.rerouteCandidates.length > 0 &&
      isDirectorBridgeFailureReason(entry.reason),
  );
}

function findLastRerouteRequestIndex(notes: readonly string[]): number {
  for (let index = notes.length - 1; index >= 0; index -= 1) {
    if (notes[index]?.startsWith(REROUTE_REQUEST_NOTE_PREFIX)) {
      return index;
    }
  }
  return -1;
}

function formatEventLine(event: ExecutionEvent): string {
  return `${event.occurredAt} ${event.type} ${event.message}`;
}
