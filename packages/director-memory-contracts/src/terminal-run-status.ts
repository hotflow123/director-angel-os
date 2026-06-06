import { isOneOf } from "./guards.js";

export const DIRECTOR_TERMINAL_RUN_STATUSES = ["completed", "failed", "aborted"] as const;

export type DirectorTerminalRunStatus = (typeof DIRECTOR_TERMINAL_RUN_STATUSES)[number];

export function isDirectorTerminalRunStatus(value: unknown): value is DirectorTerminalRunStatus {
  return isOneOf(value, DIRECTOR_TERMINAL_RUN_STATUSES);
}

export function assertDirectorTerminalRunStatus(
  value: unknown,
): asserts value is DirectorTerminalRunStatus {
  if (!isDirectorTerminalRunStatus(value)) {
    throw new Error(
      `DirectorTraceDigest only accepts terminal execution runs; received "${String(value)}".`,
    );
  }
}
