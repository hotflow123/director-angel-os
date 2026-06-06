import type { RuntimeContext } from "./runtime-context.js";
import { CONTRACTS_SCHEMA_VERSION } from "./schema-version.js";

export type AuditActor =
  | "engine"
  | "policy-runtime"
  | "tool-runtime"
  | "model-runtime"
  | "context"
  | "control-plane"
  | "session-store"
  | "operator";

export type AuditSeverity = "info" | "warning" | "critical";

export type AuditEventKind =
  | "policy.decision"
  | "tool.execution"
  | "credential.access"
  | "control.action"
  | "stream.boundary";

export interface AuditEvent {
  readonly id: string;
  readonly schemaVersion: typeof CONTRACTS_SCHEMA_VERSION;
  readonly kind: AuditEventKind;
  readonly actor: AuditActor;
  readonly severity: AuditSeverity;
  readonly occurredAtMs: number;
  readonly context: RuntimeContext;
  readonly target?: string;
  readonly summary: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function createAuditEvent(input: Omit<AuditEvent, "schemaVersion">): AuditEvent {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    ...input,
  };
}
