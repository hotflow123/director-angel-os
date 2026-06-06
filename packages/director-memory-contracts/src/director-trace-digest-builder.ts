import type { ExecutionRunReport } from "@hotflow/director-execution-contracts";

import type { DirectorTraceDigest, DirectorTraceObservationRef } from "./director-trace-digest.js";
import { DIRECTOR_TRACE_DIGEST_SCHEMA_VERSION } from "./director-trace-digest.js";
import { assertDirectorTerminalRunStatus } from "./terminal-run-status.js";

export interface BuildDirectorTraceDigestInput {
  readonly digestId: string;
  readonly recordedAt: string;
  readonly report: ExecutionRunReport;
  readonly projectId: string;
  readonly groupId: string;
  readonly anchorIds?: readonly string[];
  readonly selectedAdapters?: readonly string[];
  readonly observationRefs?: readonly DirectorTraceObservationRef[];
  readonly generationType?: string;
  readonly generationStyle?: string;
  readonly knowledgeSignalTags?: readonly string[];
}

export function buildDirectorTraceDigest(
  input: BuildDirectorTraceDigestInput,
): DirectorTraceDigest {
  const { report } = input;
  const { run } = report;
  assertDirectorTerminalRunStatus(run.status);

  const selectedAdapters = sortUniqueStrings([
    ...(input.selectedAdapters ?? []),
    ...run.assignments
      .map((assignment) => assignment.selectedAdapter)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
    ...run.assignments
      .map((assignment) => assignment.result?.adapterId)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  ]);

  const roles = sortUniqueStrings(run.assignments.map((assignment) => assignment.role));
  const observationRefs = sortObservationRefs(input.observationRefs ?? []);

  return {
    schemaVersion: DIRECTOR_TRACE_DIGEST_SCHEMA_VERSION,
    digestId: input.digestId,
    runId: run.runId,
    reportId: report.reportId,
    snapshotId: run.snapshotId,
    runtimeId: run.runtimeId,
    blueprintId: run.blueprintId,
    handoffId: run.handoffId,
    actionGraphId: run.actionGraphId,
    projectId: input.projectId,
    groupId: input.groupId,
    goal: run.goal,
    previewSummary: run.previewSummary,
    status: run.status,
    roles,
    anchorIds: sortUniqueStrings(input.anchorIds ?? []),
    selectedAdapters,
    observationRefs,
    assignmentStats: {
      total: run.assignments.length,
      completed: countAssignments(run, "completed"),
      failed: countAssignments(run, "failed"),
      aborted: countAssignments(run, "aborted"),
      skipped: countAssignments(run, "skipped"),
      blocked: countAssignments(run, "blocked"),
    },
    flags: sortUniqueStrings(report.flags),
    eventTypes: sortUniqueStrings(run.events.map((event) => event.type)),
    createdAt: run.createdAt,
    ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
    ...(run.completedAt === undefined ? {} : { completedAt: run.completedAt }),
    recordedAt: input.recordedAt,
    ...(input.generationType === undefined ? {} : { generationType: input.generationType }),
    ...(input.generationStyle === undefined ? {} : { generationStyle: input.generationStyle }),
    ...(input.knowledgeSignalTags === undefined
      ? {}
      : { knowledgeSignalTags: sortUniqueStrings(input.knowledgeSignalTags) }),
  };
}

function countAssignments(
  report: ExecutionRunReport["run"],
  status: "completed" | "failed" | "aborted" | "skipped" | "blocked",
): number {
  return report.assignments.filter((assignment) => assignment.status === status).length;
}

function sortUniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function sortObservationRefs(
  values: readonly DirectorTraceObservationRef[],
): DirectorTraceObservationRef[] {
  const unique = new Map<string, DirectorTraceObservationRef>();
  for (const value of values) {
    unique.set(`${value.recordedAt}:${value.observationId}:${value.source}`, value);
  }
  return [...unique.values()].sort((left, right) => {
    if (left.recordedAt === right.recordedAt) {
      if (left.observationId === right.observationId) {
        return left.source.localeCompare(right.source);
      }
      return left.observationId.localeCompare(right.observationId);
    }
    return left.recordedAt.localeCompare(right.recordedAt);
  });
}
