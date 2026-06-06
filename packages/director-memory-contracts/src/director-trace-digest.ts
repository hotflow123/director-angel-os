import { isArrayOf, isArrayOfStrings, isObject, isOptional, isString } from "./guards.js";
import {
  type DirectorTerminalRunStatus,
  isDirectorTerminalRunStatus,
} from "./terminal-run-status.js";

export const DIRECTOR_TRACE_DIGEST_SCHEMA_VERSION = "director.memory.trace-digest.v1" as const;

export interface DirectorTraceObservationRef {
  readonly observationId: string;
  readonly source: "evaluation" | "outcome";
  readonly recordedAt: string;
}

export interface DirectorAssignmentStats {
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly aborted: number;
  readonly skipped: number;
  readonly blocked: number;
}

export interface DirectorTraceDigest {
  readonly schemaVersion: typeof DIRECTOR_TRACE_DIGEST_SCHEMA_VERSION;
  readonly digestId: string;
  readonly runId: string;
  readonly reportId: string;
  readonly snapshotId: string;
  readonly runtimeId: string;
  readonly blueprintId: string;
  readonly handoffId: string;
  readonly actionGraphId: string;
  readonly projectId: string;
  readonly groupId: string;
  readonly goal: string;
  readonly previewSummary: string;
  readonly status: DirectorTerminalRunStatus;
  readonly roles: readonly string[];
  readonly anchorIds: readonly string[];
  readonly selectedAdapters: readonly string[];
  readonly observationRefs: readonly DirectorTraceObservationRef[];
  readonly assignmentStats: DirectorAssignmentStats;
  readonly flags: readonly string[];
  readonly eventTypes: readonly string[];
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly recordedAt: string;
  readonly generationType?: string;
  readonly generationStyle?: string;
  readonly knowledgeSignalTags?: readonly string[];
}

export function isDirectorTraceObservationRef(
  value: unknown,
): value is DirectorTraceObservationRef {
  return (
    isObject(value) &&
    isString(value.observationId) &&
    (value.source === "evaluation" || value.source === "outcome") &&
    isString(value.recordedAt)
  );
}

export function isDirectorAssignmentStats(value: unknown): value is DirectorAssignmentStats {
  return (
    isObject(value) &&
    typeof value.total === "number" &&
    typeof value.completed === "number" &&
    typeof value.failed === "number" &&
    typeof value.aborted === "number" &&
    typeof value.skipped === "number" &&
    typeof value.blocked === "number"
  );
}

export function isDirectorTraceDigest(value: unknown): value is DirectorTraceDigest {
  return (
    isObject(value) &&
    value.schemaVersion === DIRECTOR_TRACE_DIGEST_SCHEMA_VERSION &&
    isString(value.digestId) &&
    isString(value.runId) &&
    isString(value.reportId) &&
    isString(value.snapshotId) &&
    isString(value.runtimeId) &&
    isString(value.blueprintId) &&
    isString(value.handoffId) &&
    isString(value.actionGraphId) &&
    isString(value.projectId) &&
    isString(value.groupId) &&
    isString(value.goal) &&
    isString(value.previewSummary) &&
    isDirectorTerminalRunStatus(value.status) &&
    isArrayOfStrings(value.roles) &&
    isArrayOfStrings(value.anchorIds) &&
    isArrayOfStrings(value.selectedAdapters) &&
    isArrayOf(value.observationRefs, isDirectorTraceObservationRef) &&
    isDirectorAssignmentStats(value.assignmentStats) &&
    isArrayOfStrings(value.flags) &&
    isArrayOfStrings(value.eventTypes) &&
    isString(value.createdAt) &&
    isOptional(value.startedAt, isString) &&
    isOptional(value.completedAt, isString) &&
    isString(value.recordedAt) &&
    isOptional(value.generationType, isString) &&
    isOptional(value.generationStyle, isString) &&
    isOptional(value.knowledgeSignalTags, isArrayOfStrings)
  );
}
