import type {
  AssignmentRun,
  ExecutionEvent,
  ExecutionRunReport,
} from "@hotflow/director-execution-contracts";

import { deriveDirectorRunHoldingStateSurface } from "./director-run-holding-state.js";

const ASSIGNMENT_STATUS_ORDER = [
  "ready",
  "pending",
  "running",
  "completed",
  "failed",
  "blocked",
  "aborted",
  "skipped",
] as const;
const REROUTE_REQUEST_NOTE_PREFIX = "Adapter rerouted from ";

export function renderDirectorRunAudit(report: ExecutionRunReport): string {
  const holdingStateSurface = deriveDirectorRunHoldingStateSurface(report);
  const lines = [
    "Director run audit:",
    `  report id: ${report.reportId}`,
    `  run id: ${report.runId}`,
    `  run status: ${report.run.status}`,
    `  recorded at: ${report.recordedAt}`,
    `  flags: ${report.flags.join(" | ") || "(none)"}`,
    `  summary: ${report.summary.join(" | ") || "(none)"}`,
    `  assignment counts: ${formatAssignmentCounts(report.run.assignments)}`,
  ];

  if (holdingStateSurface !== undefined) {
    lines.push(`  holding state: ${holdingStateSurface.verdictText}`);
  }

  if (report.operatorSurface?.nextAction !== undefined) {
    lines.push(`  next action: ${report.operatorSurface.nextAction}`);
  } else if (holdingStateSurface !== undefined) {
    lines.push(`  next action: ${holdingStateSurface.nextAction}`);
    lines.push(`  suggested commands: ${holdingStateSurface.suggestedCommands.join(" | ")}`);
  }

  lines.push("  assignments:");
  if (report.run.assignments.length === 0) {
    lines.push("    (none)");
  } else {
    for (const assignment of report.run.assignments) {
      lines.push(`    - ${formatAssignmentSummaryLine(assignment)}`);
      for (const routeContextLine of formatAssignmentRouteContext(assignment)) {
        lines.push(`      ${routeContextLine}`);
      }
      if (assignment.blockingReason !== undefined) {
        lines.push(`      blocking reason: ${assignment.blockingReason}`);
      }
      if (assignment.result?.summary !== undefined) {
        lines.push(`      result: ${assignment.result.summary}`);
      }
      const bridgeOutcome = formatBridgeOutcome(assignment);
      if (bridgeOutcome !== undefined) {
        lines.push(`      ${bridgeOutcome}`);
      }
      if (assignment.notes && assignment.notes.length > 0) {
        lines.push(`      notes: ${assignment.notes.join(" | ")}`);
      }
    }
  }

  lines.push("  event timeline:");
  if (report.events.length === 0) {
    lines.push("    (none)");
  } else {
    for (const event of report.events) {
      lines.push(`    - ${formatAuditEvent(event)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatAssignmentCounts(assignments: readonly AssignmentRun[]): string {
  const counts = ASSIGNMENT_STATUS_ORDER.map((status) => {
    const count = assignments.filter((assignment) => assignment.status === status).length;
    return `${status}=${count}`;
  });

  return `total=${assignments.length} ${counts.join(" ")}`;
}

function formatAssignmentSummaryLine(assignment: AssignmentRun): string {
  const adapterId =
    assignment.selectedAdapter ??
    assignment.result?.adapterId ??
    assignment.allowedAdapters?.[0] ??
    "(none)";

  return `${assignment.assignmentId} role=${assignment.role} status=${assignment.status} adapter=${adapterId}`;
}

function formatAssignmentRouteContext(assignment: AssignmentRun): string[] {
  const currentRoute = assignment.selectedAdapter ?? assignment.allowedAdapters?.[0] ?? null;
  const lastBridgeRoute = resolveLastBridgeRoute(assignment);
  const approvedAlternates = dedupeStrings(
    (assignment.allowedAdapters ?? []).filter(
      (adapterId) => adapterId !== currentRoute && adapterId !== lastBridgeRoute,
    ),
  );
  const lines: string[] = [];

  if (currentRoute !== null) {
    lines.push(`current route: ${currentRoute}`);
  }
  if (lastBridgeRoute !== null && lastBridgeRoute !== currentRoute) {
    lines.push(`last bridge route: ${lastBridgeRoute}`);
  }
  if (approvedAlternates.length > 0) {
    lines.push(`approved alternates: ${approvedAlternates.join(", ")}`);
  }

  return lines;
}

function resolveLastBridgeRoute(assignment: AssignmentRun): string | null {
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

function formatBridgeOutcome(assignment: AssignmentRun): string | undefined {
  const bridgeExecution = assignment.result?.bridgeExecution;
  if (bridgeExecution === undefined) {
    return undefined;
  }

  if (bridgeExecution.failure !== undefined) {
    return `bridge failure: ${bridgeExecution.failure.reason} retryable=${bridgeExecution.failure.retryable ? "yes" : "no"}${bridgeExecution.failure.statusCode === undefined ? "" : ` status=${bridgeExecution.failure.statusCode}`}`;
  }

  const response = bridgeExecution.response;
  if (response === undefined) {
    return "bridge result: recorded without response snapshot";
  }

  return `bridge response: accepted=${response.accepted ? "yes" : "no"}${response.statusCode === undefined ? "" : ` status=${response.statusCode}`}${response.requestId === undefined ? "" : ` requestId=${response.requestId}`}`;
}

function formatAuditEvent(event: ExecutionEvent): string {
  const payloadSummary = summarizePayload(event.payload);
  return payloadSummary === undefined
    ? `${event.occurredAt} ${event.type} ${event.message}`
    : `${event.occurredAt} ${event.type} ${event.message} [${payloadSummary}]`;
}

function summarizePayload(
  payload: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  if (payload === undefined) {
    return undefined;
  }

  const fragments: string[] = [];
  const preferredKeys = [
    "assignmentId",
    "previousStatus",
    "nextStatus",
    "previousAdapterId",
    "nextAdapterId",
    "status",
    "adapterId",
    "retryCount",
    "retryLimit",
    "bridgeKind",
    "bridgeVerdict",
    "bridgeFailureReason",
    "bridgeRetryable",
    "bridgeStatus",
    "requestAccepted",
    "requestId",
    "runStatus",
    "summary",
    "reason",
    "blockingReason",
  ];

  for (const key of preferredKeys) {
    const fragment = formatPayloadFragment(key, payload[key]);
    if (fragment !== undefined) {
      fragments.push(fragment);
    }
  }

  if (fragments.length === 0) {
    for (const [key, value] of Object.entries(payload)) {
      const fragment = formatPayloadFragment(key, value);
      if (fragment !== undefined) {
        fragments.push(fragment);
      }
      if (fragments.length >= 4) {
        break;
      }
    }
  }

  return fragments.length === 0 ? undefined : fragments.join(" ");
}

function formatPayloadFragment(key: string, value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return `${key}=${String(value)}`;
  }
  return undefined;
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
