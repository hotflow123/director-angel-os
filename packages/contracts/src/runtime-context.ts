import type { ContractsSchemaVersion } from "./schema-version.js";

export type RuntimeSurface =
  | "runtime"
  | "reasoning"
  | "session"
  | "turn"
  | "task"
  | "tool"
  | "model"
  | "stream";

export interface RuntimeIdentifiers {
  readonly sessionId: string;
  readonly turnId?: string;
  readonly stepId?: string;
  readonly taskId?: string;
  readonly toolCallId?: string;
  readonly modelInvocationId?: string;
}

export type RuntimeMetadataValue = string | number | boolean | null;

export type RuntimeMetadata = Readonly<Record<string, RuntimeMetadataValue>>;

export interface RuntimeContext {
  readonly schemaVersion: ContractsSchemaVersion;
  readonly requestId: string;
  readonly surface: RuntimeSurface;
  readonly identifiers: RuntimeIdentifiers;
  readonly startedAtMs: number;
  readonly deadlineAtMs?: number;
  readonly metadata?: RuntimeMetadata;
}
