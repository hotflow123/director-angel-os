import type { MemoryScope } from "./types.js";

export function matchesScope(candidate: MemoryScope, required: MemoryScope): boolean {
  if (required.agentId !== undefined && candidate.agentId !== required.agentId) {
    return false;
  }
  if (required.sessionId !== undefined && candidate.sessionId !== required.sessionId) {
    return false;
  }
  if (required.threadId !== undefined && candidate.threadId !== required.threadId) {
    return false;
  }
  if (required.namespace !== undefined && candidate.namespace !== required.namespace) {
    return false;
  }
  return true;
}

export function scopeKey(scope: MemoryScope): string {
  return [
    `agent:${scope.agentId ?? "*"}`,
    `session:${scope.sessionId ?? "*"}`,
    `thread:${scope.threadId ?? "*"}`,
    `ns:${scope.namespace ?? "*"}`,
  ].join("|");
}
