import type { AssignmentRun } from "@hotflow/director-execution-contracts";

import { describeDirectorBridgeFailureNextAction } from "./director-bridge-failure-guidance.js";

const RETRY_REQUEST_NOTE_PREFIX = "Retry requested at ";
const REROUTE_REQUEST_NOTE_PREFIX = "Adapter rerouted from ";
const RETRYABLE_BRIDGE_FAILURE_RETRY_LIMIT = 1;

export interface DirectorRouteHealthEntry {
  readonly assignmentId: string;
  readonly role: string;
  readonly status: AssignmentRun["status"];
  readonly currentRoute?: string;
  readonly lastBridgeRoute?: string;
  readonly bridgeVerdict?: "accepted" | "responded" | "failed";
  readonly bridgeFailureReason?: string;
  readonly bridgeFailureMessage?: string;
  readonly bridgeStatus?: number;
  readonly bridgeRetryable?: boolean;
  readonly retryAllowed?: boolean;
  readonly rerouteCandidates: readonly string[];
  readonly blockingReason?: string;
}

export type DirectorRouteDoctorVerdict =
  | "healthy"
  | "degraded"
  | "reroutable"
  | "exhausted"
  | "blocked";

export interface DirectorRouteDoctorEntry extends DirectorRouteHealthEntry {
  readonly verdict: DirectorRouteDoctorVerdict;
  readonly summary: string;
  readonly nextAction?: string;
}

export interface DirectorRouteDoctorSummary {
  readonly status: "pass" | "warn" | "fail";
  readonly counts: {
    readonly healthy: number;
    readonly degraded: number;
    readonly reroutable: number;
    readonly exhausted: number;
    readonly blocked: number;
    readonly total: number;
  };
  readonly summary: string;
  readonly entries: readonly DirectorRouteDoctorEntry[];
}

export function deriveDirectorRouteHealthEntries(
  assignments: readonly AssignmentRun[],
): DirectorRouteHealthEntry[] {
  return assignments.filter(isRouteRelevantAssignment).map((assignment) => {
    const currentRoute = resolveConfiguredAdapterRoute(assignment);
    const lastBridgeRoute = resolveLastBridgeRoute(assignment);
    const bridgeExecution = assignment.result?.bridgeExecution;
    const retryState = deriveBridgeRetryState(assignment);

    return {
      assignmentId: assignment.assignmentId,
      role: assignment.role,
      status: assignment.status,
      ...(currentRoute === null ? {} : { currentRoute }),
      ...(lastBridgeRoute === null || lastBridgeRoute === currentRoute ? {} : { lastBridgeRoute }),
      ...(bridgeExecution === undefined
        ? {}
        : bridgeExecution.failure !== undefined
          ? {
              bridgeVerdict: "failed" as const,
              bridgeFailureReason: bridgeExecution.failure.reason,
              ...(bridgeExecution.failure.message === undefined
                ? {}
                : { bridgeFailureMessage: bridgeExecution.failure.message }),
              ...(bridgeExecution.failure.statusCode === undefined
                ? {}
                : { bridgeStatus: bridgeExecution.failure.statusCode }),
              bridgeRetryable: bridgeExecution.failure.retryable,
              ...(retryState === undefined ? {} : { retryAllowed: retryState.retryAllowed }),
            }
          : {
              bridgeVerdict:
                bridgeExecution.response?.accepted === true
                  ? ("accepted" as const)
                  : ("responded" as const),
              ...(bridgeExecution.response?.statusCode === undefined
                ? {}
                : { bridgeStatus: bridgeExecution.response.statusCode }),
            }),
      rerouteCandidates: collectRerouteCandidates(assignment),
      ...(assignment.blockingReason === undefined
        ? {}
        : { blockingReason: assignment.blockingReason }),
    };
  });
}

export function resolveConfiguredAdapterRoute(assignment: AssignmentRun): string | null {
  const selectedAdapter = assignment.selectedAdapter ?? null;
  const resultAdapter = assignment.result?.adapterId ?? null;
  if (
    selectedAdapter !== null &&
    resultAdapter !== null &&
    selectedAdapter !== resultAdapter &&
    hasPendingReroute(assignment.notes)
  ) {
    return selectedAdapter;
  }
  return selectedAdapter ?? resultAdapter;
}

export function resolveLastBridgeRoute(assignment: AssignmentRun): string | null {
  if (assignment.result?.adapterId !== undefined && assignment.result.adapterId !== null) {
    return assignment.result.adapterId;
  }

  for (let index = (assignment.notes?.length ?? 0) - 1; index >= 0; index -= 1) {
    const note = assignment.notes?.[index];
    if (note === undefined || !note.startsWith(REROUTE_REQUEST_NOTE_PREFIX)) {
      continue;
    }
    const match = /^Adapter rerouted from (.+) to (.+) at /u.exec(note);
    if (match?.[1] !== undefined) {
      return match[1];
    }
  }

  return null;
}

export function collectRerouteCandidates(assignment: AssignmentRun): string[] {
  const configuredRoute = resolveConfiguredAdapterRoute(assignment);
  const lastBridgeRoute = resolveLastBridgeRoute(assignment);

  return dedupeStrings(
    (assignment.allowedAdapters ?? []).filter(
      (adapterId) => adapterId !== configuredRoute && adapterId !== lastBridgeRoute,
    ),
  );
}

export function summarizeDirectorRouteHealthForDoctor(
  entries: readonly DirectorRouteHealthEntry[],
): DirectorRouteDoctorSummary {
  const diagnosedEntries = entries.map(diagnoseDirectorRouteHealthEntry);
  const counts = {
    healthy: diagnosedEntries.filter((entry) => entry.verdict === "healthy").length,
    degraded: diagnosedEntries.filter((entry) => entry.verdict === "degraded").length,
    reroutable: diagnosedEntries.filter((entry) => entry.verdict === "reroutable").length,
    exhausted: diagnosedEntries.filter((entry) => entry.verdict === "exhausted").length,
    blocked: diagnosedEntries.filter((entry) => entry.verdict === "blocked").length,
    total: diagnosedEntries.length,
  };

  if (counts.blocked > 0) {
    return {
      status: "fail",
      counts,
      summary: `Execution chain has ${counts.blocked} blocked route assignment(s) that stop safe progress.`,
      entries: diagnosedEntries,
    };
  }

  if (counts.exhausted > 0) {
    return {
      status: "fail",
      counts,
      summary: `Execution chain has ${counts.exhausted} exhausted route assignment(s) with no safe retry or reroute path.`,
      entries: diagnosedEntries,
    };
  }

  if (counts.reroutable > 0) {
    return {
      status: "warn",
      counts,
      summary: `Execution chain is degraded, but ${counts.reroutable} assignment(s) can still recover by reroute.`,
      entries: diagnosedEntries,
    };
  }

  if (counts.degraded > 0) {
    return {
      status: "warn",
      counts,
      summary: `Execution chain is degraded, but ${counts.degraded} assignment(s) still have a bounded recovery path.`,
      entries: diagnosedEntries,
    };
  }

  return {
    status: "pass",
    counts,
    summary: `Execution chain route health is healthy across ${counts.total} assignment(s).`,
    entries: diagnosedEntries,
  };
}

function isRouteRelevantAssignment(assignment: AssignmentRun): boolean {
  return (
    assignment.selectedAdapter !== null ||
    (assignment.allowedAdapters?.length ?? 0) > 0 ||
    assignment.result?.adapterId !== undefined ||
    assignment.result?.bridgeExecution !== undefined
  );
}

function deriveBridgeRetryState(assignment: AssignmentRun):
  | {
      readonly retryAllowed: boolean;
    }
  | undefined {
  const failure = assignment.result?.bridgeExecution?.failure;
  if (failure === undefined) {
    return undefined;
  }

  const retriesUsed = countRetryRequests(assignment.notes);
  const retryLimit = failure.retryable ? RETRYABLE_BRIDGE_FAILURE_RETRY_LIMIT : 0;
  return {
    retryAllowed: failure.retryable && retriesUsed < retryLimit,
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

function findLastRerouteRequestIndex(notes: readonly string[]): number {
  for (let index = notes.length - 1; index >= 0; index -= 1) {
    if (notes[index]?.startsWith(REROUTE_REQUEST_NOTE_PREFIX)) {
      return index;
    }
  }
  return -1;
}

function findLastRetryRequestIndex(notes: readonly string[]): number {
  for (let index = notes.length - 1; index >= 0; index -= 1) {
    if (notes[index]?.startsWith(RETRY_REQUEST_NOTE_PREFIX)) {
      return index;
    }
  }
  return -1;
}

function hasPendingReroute(notes: readonly string[] | undefined): boolean {
  if (!notes || notes.length === 0) {
    return false;
  }
  return findLastRerouteRequestIndex(notes) > findLastRetryRequestIndex(notes);
}

function dedupeStrings(values: ReadonlyArray<string | null | undefined>): string[] {
  return [
    ...new Set(
      values.filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  ];
}

function diagnoseDirectorRouteHealthEntry(
  entry: DirectorRouteHealthEntry,
): DirectorRouteDoctorEntry {
  if (entry.status === "blocked" || entry.blockingReason !== undefined) {
    return {
      ...entry,
      verdict: "blocked",
      summary:
        entry.blockingReason === undefined
          ? "Assignment is blocked and needs operator intervention before it can continue."
          : `Assignment is blocked: ${entry.blockingReason}.`,
      nextAction:
        "inspect the blocking reason and repair the route or policy boundary before retrying.",
    };
  }

  if (entry.bridgeVerdict === "failed") {
    const failure = {
      reason: entry.bridgeFailureReason ?? "unknown_failure",
      retryable: entry.bridgeRetryable ?? false,
      ...(entry.bridgeStatus === undefined ? {} : { statusCode: entry.bridgeStatus }),
    } as const;

    if (entry.retryAllowed) {
      return {
        ...entry,
        verdict: "degraded",
        summary: `Bridge failed on ${formatRouteLabel(entry.currentRoute, entry.lastBridgeRoute)}, but one bounded retry is still available.`,
        nextAction: describeDirectorBridgeFailureNextAction(failure, { retryAllowed: true }),
      };
    }

    if (entry.rerouteCandidates.length > 0) {
      return {
        ...entry,
        verdict: "reroutable",
        summary: `Bridge failed on ${formatRouteLabel(entry.currentRoute, entry.lastBridgeRoute)}, and the operator can reroute to another approved adapter.`,
        nextAction:
          entry.rerouteCandidates.length === 1
            ? `reroute ${entry.assignmentId} to ${entry.rerouteCandidates[0]} and retry on the new route.`
            : `reroute ${entry.assignmentId} to one of the approved adapters (${entry.rerouteCandidates.join(", ")}) and retry on the new route.`,
      };
    }

    return {
      ...entry,
      verdict: "exhausted",
      summary: `Bridge failed on ${formatRouteLabel(entry.currentRoute, entry.lastBridgeRoute)}, and no safe retry or reroute path remains.`,
      nextAction: describeDirectorBridgeFailureNextAction(failure, { retryAllowed: false }),
    };
  }

  if (isRouteRecoveryInFlight(entry)) {
    return {
      ...entry,
      verdict: "degraded",
      summary: `Assignment was rerouted from ${entry.lastBridgeRoute} to ${entry.currentRoute} and is waiting for the next attempt.`,
      nextAction:
        "wait for the rerouted assignment to be claimed, or retry on the new route if the lane is idle.",
    };
  }

  return {
    ...entry,
    verdict: "healthy",
    summary:
      entry.bridgeVerdict === "accepted"
        ? `Bridge request was accepted on ${formatRouteLabel(entry.currentRoute, entry.lastBridgeRoute)}.`
        : entry.bridgeVerdict === "responded"
          ? `Bridge responded successfully on ${formatRouteLabel(entry.currentRoute, entry.lastBridgeRoute)}.`
          : `Assignment route is healthy on ${formatRouteLabel(entry.currentRoute, entry.lastBridgeRoute)}.`,
  };
}

function isRouteRecoveryInFlight(entry: DirectorRouteHealthEntry): boolean {
  return (
    entry.currentRoute !== undefined &&
    entry.lastBridgeRoute !== undefined &&
    entry.currentRoute !== entry.lastBridgeRoute &&
    entry.bridgeVerdict === undefined &&
    entry.status !== "completed"
  );
}

function formatRouteLabel(
  currentRoute: string | undefined,
  lastBridgeRoute: string | undefined,
): string {
  return currentRoute ?? lastBridgeRoute ?? "the current route";
}
