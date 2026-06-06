import type { RuntimeDegradeSurface } from "@hotflow/contracts";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ToolRiskLevel = "low" | "medium" | "high" | "critical";

export interface MemoryEntry {
  readonly role: ChatRole;
  readonly content: string;
  readonly name?: string;
  readonly timestamp: number;
  readonly metadata?: Record<string, unknown>;
}

export interface SessionSnapshot {
  readonly id: string;
  readonly turn: number;
  readonly state: Record<string, unknown>;
}

export interface ModelRequest {
  readonly input: string;
  readonly memory: readonly MemoryEntry[];
  readonly session: SessionSnapshot;
}

export interface ToolCall {
  readonly name: string;
  readonly args: unknown;
  readonly callId?: string;
  readonly timeoutMs?: number;
  readonly risk?: ToolRiskLevel;
}

export interface ModelResponse {
  readonly output: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly metadata?: Record<string, unknown>;
}

export interface ToolResult {
  readonly name: string;
  readonly callId?: string;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: string;
}

export interface ModelLike {
  complete(request: ModelRequest): Promise<ModelResponse> | ModelResponse;
}

export interface ToolLike {
  readonly name: string;
  invoke(args: unknown): Promise<unknown> | unknown;
}

export interface MemoryLike {
  append(entry: Omit<MemoryEntry, "timestamp"> & { timestamp?: number }): MemoryEntry;
  list(): readonly MemoryEntry[];
  reset(): void;
}

export interface SessionLike {
  snapshot(): SessionSnapshot;
  advanceTurn(): SessionSnapshot;
  setState(key: string, value: unknown): void;
  getState<T>(key: string): T | undefined;
}

export type PolicyVerdict = "allow" | "deny" | "ask" | "degrade";

export interface PolicyDecision {
  readonly verdict: PolicyVerdict;
  readonly reason?: string;
  readonly degradation?: RuntimeDegradeSurface;
  readonly metadata?: Record<string, unknown>;
}

export interface ExecutionPolicyInput {
  readonly call: ToolCall;
  readonly session: SessionSnapshot;
  readonly memory: readonly MemoryEntry[];
}

export interface ExecutionPolicy {
  evaluateToolCall(input: ExecutionPolicyInput): Promise<PolicyDecision> | PolicyDecision;
}

export interface ContextSection {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly priority?: number;
  readonly tags?: readonly string[];
}

export interface RecallBlock {
  readonly id: string;
  readonly summary: string;
  readonly confidence: number;
  readonly source?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface RecallInput {
  readonly query: string;
  readonly session: SessionSnapshot;
  readonly memory: readonly MemoryEntry[];
}

export interface MemoryRecallLike {
  recall(input: RecallInput): Promise<readonly RecallBlock[]> | readonly RecallBlock[];
}

export type AuditEventKind =
  | "policy.allow"
  | "policy.deny"
  | "policy.ask"
  | "policy.degrade"
  | "tool.started"
  | "tool.finished"
  | "tool.timeout"
  | "memory.degraded"
  | "runtime.model_failed"
  | "runtime.interrupted"
  | "runtime.resumed";

export interface AuditEvent {
  readonly kind: AuditEventKind;
  readonly timestamp: number;
  readonly turn: number;
  readonly detail: Record<string, unknown>;
}

export type StreamEventKind =
  | "stream.started"
  | "stream.chunk"
  | "stream.tool-call"
  | "stream.degraded"
  | "stream.aborted"
  | "stream.completed"
  | "stream.interrupted"
  | "stream.resumed";

export interface StreamEventRecord {
  readonly kind: StreamEventKind;
  readonly timestamp: number;
  readonly turn: number;
  readonly detail: Record<string, unknown>;
}
