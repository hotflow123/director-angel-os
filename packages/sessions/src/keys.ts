import { randomUUID } from "node:crypto";
import { InvalidSessionIdError } from "./errors.js";

const SESSION_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,127}$/u;
const PREFIX_SANITIZER = /[^a-z0-9-]/gu;

function normalizePrefix(prefix: string): string {
  const normalized = prefix.trim().toLowerCase().replace(PREFIX_SANITIZER, "-");
  const collapsed = normalized.replace(/-+/gu, "-").replace(/^-|-$/gu, "");
  return collapsed.length > 0 ? collapsed : "sess";
}

export function createSessionId(prefix = "sess"): string {
  const safePrefix = normalizePrefix(prefix);
  const id = `${safePrefix}_${randomUUID().replace(/-/gu, "")}`;
  assertSessionId(id);
  return id;
}

export function isSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId);
}

export function assertSessionId(sessionId: string): asserts sessionId is string {
  if (!isSessionId(sessionId)) {
    throw new InvalidSessionIdError(sessionId);
  }
}
