import type { RuntimeDegradeSurface, TaskItem, TaskState } from "@hotflow/contracts";
import type {
  PolicyDecision,
  ToolApprovalContext,
  ToolCapability,
  ToolDispatchPolicyRuntime,
  ToolRiskLevel,
} from "@hotflow/policy-runtime";

export type ToolMergeStrategy = "ordered" | "all-or-nothing" | "first-wins";
export type ToolExecutionResolution =
  | "executed"
  | "missing"
  | "denied"
  | "approval_required"
  | "degraded"
  | "failed";

export type ToolAvailabilityReason = "missing_required_env" | "check_unavailable" | "check_error";

export type ToolSchemaScalar = string | number | boolean | null;

export interface ToolSchema {
  readonly type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  readonly description?: string;
  readonly properties?: Readonly<Record<string, ToolSchema>>;
  readonly items?: ToolSchema | readonly ToolSchema[];
  readonly required?: readonly string[];
  readonly enum?: readonly ToolSchemaScalar[];
  readonly additionalProperties?: boolean | ToolSchema;
}

export interface ToolSchemaDescriptor {
  readonly name: string;
  readonly description: string;
  readonly toolset: string;
  readonly readOnly: boolean;
  readonly inputSchema: ToolSchema;
}

export interface ToolsetDefinition {
  readonly name: string;
  readonly description: string;
  readonly tools: readonly string[];
  readonly enabledByDefault: boolean;
  readonly platform?: readonly string[];
}

export interface ToolInputSchema<TArgs = Record<string, unknown>> {
  parse(input: unknown): TArgs;
}

export type ToolJournalValue =
  | string
  | number
  | boolean
  | null
  | ToolJournalObject
  | ToolJournalValue[];

export interface ToolJournalObject {
  [key: string]: ToolJournalValue;
}

export type ToolJournalEventType = "tool.call_planned" | "tool.result";

export interface ToolJournalEvent {
  readonly eventType: ToolJournalEventType;
  readonly occurredAtMs: number;
  readonly payload: ToolJournalObject;
}

export interface ToolContext {
  readonly sessionId: string;
  readonly turnId?: string;
  readonly workspaceRoot?: string;
  readonly actor?: string;
  readonly approval?: ToolApprovalContext;
}

export interface ToolCall<TArgs = Record<string, unknown>> {
  readonly id: string;
  readonly name: string;
  readonly args: TArgs;
}

export interface ToolExecutionResult<TOutput = unknown> {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly ok: boolean;
  readonly output?: TOutput;
  readonly error?: string;
  readonly resolution?: ToolExecutionResolution;
  readonly degradation?: RuntimeDegradeSurface;
  readonly policyDecision?: PolicyDecision;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ToolAvailability {
  readonly available: boolean;
  readonly reason?: ToolAvailabilityReason;
  readonly message?: string;
  readonly missingEnvVars?: readonly string[];
  readonly error?: string;
}

export interface ToolDefinition<TArgs = Record<string, unknown>, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly timeoutMs: number;
  readonly readOnly: boolean;
  readonly inputSchema?: ToolInputSchema<TArgs>;
  readonly schema?: ToolSchema;
  readonly toolset?: string;
  readonly toolsetDescription?: string;
  readonly toolsetEnabledByDefault?: boolean;
  readonly toolsetPlatforms?: readonly string[];
  readonly capabilities?: readonly ToolCapability[];
  readonly riskLevel?: ToolRiskLevel;
  readonly requiresApproval?: boolean;
  readonly checkFn?: () => boolean;
  readonly requiresEnv?: readonly string[];
  execute(
    args: TArgs,
    context: ToolContext,
  ): Promise<ToolExecutionResult<TOutput>> | ToolExecutionResult<TOutput>;
}

export type ToolAuditEventKind =
  | "tool.dispatch.started"
  | "tool.dispatch.policy_decision"
  | "tool.dispatch.completed"
  | "tool.dispatch.failed";

export interface ToolAuditEvent {
  readonly kind: ToolAuditEventKind;
  readonly occurredAtMs: number;
  readonly call: ToolCall;
  readonly context: ToolContext;
  readonly toolName: string;
  readonly capabilities: readonly ToolCapability[];
  readonly riskLevel: ToolRiskLevel;
  readonly policyDecision?: PolicyDecision;
  readonly result?: ToolExecutionResult;
  readonly error?: string;
}

export type ToolAuditSink = (event: ToolAuditEvent) => void | Promise<void>;
export type ToolJournalSink = (
  event: ToolJournalEvent,
  context: ToolContext,
) => void | Promise<void>;

export interface ToolDispatcherHooks {
  beforeDispatch?: (call: ToolCall, context: ToolContext) => void | Promise<void>;
  afterDispatch?: (
    call: ToolCall,
    context: ToolContext,
    result: ToolExecutionResult,
  ) => void | Promise<void>;
  onError?: (
    stage:
      | "beforeDispatch"
      | "validation"
      | "availability"
      | "journal"
      | "policy"
      | "execute"
      | "afterDispatch"
      | "audit",
    call: ToolCall,
    context: ToolContext,
    error: unknown,
  ) => void | Promise<void>;
}

export interface ToolDispatcherOptions {
  readonly policy?: ToolDispatchPolicyRuntime;
  readonly auditSink?: ToolAuditSink;
  readonly journalSink?: ToolJournalSink;
  readonly hooks?: ToolDispatcherHooks;
}

export interface TodoWritePort {
  write(items: TaskItem[]): Promise<TaskState>;
}
