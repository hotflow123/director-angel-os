import { type DirectorTraceDigest, isDirectorTraceDigest } from "./director-trace-digest.js";
import { isArrayOfStrings, isObject, isOptional, isString } from "./guards.js";
import type { DirectorTerminalRunStatus } from "./terminal-run-status.js";
import { isDirectorTerminalRunStatus } from "./terminal-run-status.js";

export const DIRECTOR_MEMORY_RECORD_SCHEMA_VERSION = "director.memory.record.v1" as const;

export interface DirectorMemoryRecord {
  readonly schemaVersion: typeof DIRECTOR_MEMORY_RECORD_SCHEMA_VERSION;
  readonly recordId: string;
  readonly digestId: string;
  readonly projectId: string;
  readonly groupId: string;
  readonly anchorIds: readonly string[];
  readonly selectedAdapters: readonly string[];
  readonly tags?: readonly string[];
  readonly status: DirectorTerminalRunStatus;
  readonly recordedAt: string;
  readonly digest: DirectorTraceDigest;
}

export function isDirectorMemoryRecord(value: unknown): value is DirectorMemoryRecord {
  return (
    isObject(value) &&
    value.schemaVersion === DIRECTOR_MEMORY_RECORD_SCHEMA_VERSION &&
    isString(value.recordId) &&
    isString(value.digestId) &&
    isString(value.projectId) &&
    isString(value.groupId) &&
    isArrayOfStrings(value.anchorIds) &&
    isArrayOfStrings(value.selectedAdapters) &&
    isOptional(value.tags, isArrayOfStrings) &&
    isDirectorTerminalRunStatus(value.status) &&
    isString(value.recordedAt) &&
    isDirectorTraceDigest(value.digest)
  );
}
