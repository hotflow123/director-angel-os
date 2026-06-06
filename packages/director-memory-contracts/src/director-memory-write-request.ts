import { isDirectorMemoryRecord } from "./director-memory-record.js";
import { isObject, isString } from "./guards.js";

export const DIRECTOR_MEMORY_WRITE_REQUEST_SCHEMA_VERSION =
  "director.memory.write-request.v1" as const;

export interface DirectorMemoryWriteRequest {
  readonly schemaVersion: typeof DIRECTOR_MEMORY_WRITE_REQUEST_SCHEMA_VERSION;
  readonly requestId: string;
  readonly recordedAt: string;
  readonly record: import("./director-memory-record.js").DirectorMemoryRecord;
}

export function isDirectorMemoryWriteRequest(value: unknown): value is DirectorMemoryWriteRequest {
  return (
    isObject(value) &&
    value.schemaVersion === DIRECTOR_MEMORY_WRITE_REQUEST_SCHEMA_VERSION &&
    isString(value.requestId) &&
    isString(value.recordedAt) &&
    isDirectorMemoryRecord(value.record)
  );
}
