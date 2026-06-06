import { SchemaVersionMismatchError } from "./errors.js";

export const SESSIONS_SCHEMA_VERSION = "sessions/v1";

const VERSION_PATTERN = /^(?<namespace>.+?)\/v(?<major>\d+)(?:\.(?<minor>\d+))?$/u;

interface ParsedVersion {
  namespace: string;
  major: number;
}

function parseVersion(version: string): ParsedVersion | null {
  const normalized = version.trim();
  const match = VERSION_PATTERN.exec(normalized);
  if (!match?.groups) {
    return null;
  }
  const namespace = match.groups.namespace;
  if (!namespace) {
    return null;
  }
  return {
    namespace,
    major: Number(match.groups.major),
  };
}

export function resolveSchemaVersion(version?: string): string {
  if (!version) {
    return SESSIONS_SCHEMA_VERSION;
  }
  const normalized = version.trim();
  if (normalized.length === 0) {
    return SESSIONS_SCHEMA_VERSION;
  }
  return normalized;
}

export function isSchemaVersionCompatible(actual: string, expected: string): boolean {
  if (actual === expected) {
    return true;
  }
  const parsedActual = parseVersion(actual);
  const parsedExpected = parseVersion(expected);
  if (!parsedActual || !parsedExpected) {
    return false;
  }
  return (
    parsedActual.namespace === parsedExpected.namespace &&
    parsedActual.major === parsedExpected.major
  );
}

export function assertSchemaVersionCompatible(
  actual: string,
  expected: string,
  context: string,
): void {
  if (!isSchemaVersionCompatible(actual, expected)) {
    throw new SchemaVersionMismatchError(expected, actual, context);
  }
}
