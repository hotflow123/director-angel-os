import type { ContextSection, RecallBlock } from "./context.js";
import type { ContractError, RuntimeDegradeSurface, RuntimeErrorSurface } from "./errors.js";
import type { AnyRuntimeEvent } from "./events.js";
import type { ExecutionPolicy } from "./execution-policy.js";
import type { ModelContract, ModelInvocationContract } from "./model.js";
import type {
  LegacyReasoningNextAction,
  ReasoningAction,
  ReasoningDecisionInput,
  ReasoningStrategy,
  ReasoningStrategyDecision,
} from "./reasoning.js";
import type { RuntimeContext, RuntimeMetadata } from "./runtime-context.js";
import type { SessionContract } from "./session.js";
import type { StreamEvent } from "./stream-events.js";
import type { TaskContract } from "./task.js";
import type { ToolCallContract, ToolContract } from "./tool.js";
import type { TurnMessage } from "./turn.js";

export interface RunContext extends RuntimeContext {
  readonly runId: string;
  readonly attempt: number;
  readonly correlationId?: string;
  readonly profile?: string;
}

export interface TurnStepRuntimeMetadata {
  readonly id: string;
  readonly index: number;
  readonly startedAtMs: number;
  readonly endedAtMs?: number;
  readonly notes?: string;
}

export interface PromptMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
}

export type PromptVariableValue = string | number | boolean | null;

export interface PromptEnvelope {
  readonly templateId: string;
  readonly messages: readonly PromptMessage[];
  readonly sections?: readonly ContextSection[];
  readonly recallBlocks?: readonly RecallBlock[];
  readonly variables?: Readonly<Record<string, PromptVariableValue>>;
  readonly systemHints?: readonly string[];
}

export interface ToolCall {
  readonly callId: string;
  readonly taskId?: string;
  readonly toolName: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly timeoutMs: number;
  readonly context: RunContext;
}

export interface ToolResultEnvelope {
  readonly call: ToolCall;
  readonly success: boolean;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly output?: unknown;
  readonly error?: ContractError;
  readonly degradation?: RuntimeDegradeSurface;
  readonly failure?: RuntimeErrorSurface;
}

export interface ReasoningNextInput extends ReasoningDecisionInput {
  readonly context: RunContext;
  readonly prompt: PromptEnvelope;
  readonly toolHistory: readonly ToolResultEnvelope[];
  readonly step?: TurnStepRuntimeMetadata;
  readonly previousDecision?: ReasoningNextOutput;
}

export interface ReasoningNextOutput {
  readonly decision: ReasoningStrategyDecision;
  readonly action?: ReasoningAction;
  readonly nextAction: LegacyReasoningNextAction;
  readonly shouldStream: boolean;
  readonly shouldCallTool: boolean;
  readonly step?: TurnStepRuntimeMetadata;
  readonly degradation?: RuntimeDegradeSurface;
  readonly failure?: RuntimeErrorSurface;
}

export interface ReasoningStrategyRuntime {
  readonly name: ReasoningStrategy;
  next(input: ReasoningNextInput): Promise<ReasoningNextOutput> | ReasoningNextOutput;
}

export interface EngineInput {
  readonly context: RunContext;
  readonly session: SessionContract;
  readonly task: TaskContract;
  readonly prompt: PromptEnvelope;
  readonly model: ModelContract;
  readonly availableTools?: readonly ToolContract[];
  readonly stream: boolean;
  readonly metadata?: RuntimeMetadata;
}

export interface EngineResult {
  readonly status: "completed" | "failed" | "deferred" | "cancelled";
  readonly context: RunContext;
  readonly output?: TurnMessage;
  readonly reasoning: ReasoningNextOutput;
  readonly toolResults: readonly ToolResultEnvelope[];
  readonly degradation?: RuntimeDegradeSurface;
  readonly failure?: RuntimeErrorSurface;
  readonly runtimeEvents: readonly AnyRuntimeEvent[];
  readonly streamEvents: readonly StreamEvent[];
  readonly error?: ContractError;
}

export interface JournalEntry {
  readonly id: string;
  readonly runId: string;
  readonly occurredAtMs: number;
  readonly event: AnyRuntimeEvent | StreamEvent;
}

export interface SessionManager {
  get(sessionId: string): Promise<SessionContract | null>;
  save(session: SessionContract): Promise<void>;
  appendToolCall(sessionId: string, call: ToolCallContract): Promise<void>;
  touch(sessionId: string, updatedAtMs: number): Promise<void>;
}

export interface Journal {
  append(entry: JournalEntry): Promise<void>;
  appendMany(entries: readonly JournalEntry[]): Promise<void>;
  listByRun(runId: string): Promise<readonly JournalEntry[]>;
}

export interface ResponseEmitter {
  emit(event: StreamEvent): Promise<void> | void;
  complete(result: EngineResult): Promise<void> | void;
}

export interface MemoryRecord {
  readonly key: string;
  readonly scope: "session" | "task" | "run";
  readonly value: unknown;
  readonly updatedAtMs: number;
}

export interface MemoryService {
  read(key: string, context: RunContext): Promise<MemoryRecord | null>;
  write(record: MemoryRecord, context: RunContext): Promise<void>;
  search(query: string, context: RunContext, limit?: number): Promise<readonly MemoryRecord[]>;
}

export interface ModelRuntimeRequest {
  readonly context: RunContext;
  readonly model: ModelContract;
  readonly prompt: PromptEnvelope;
  readonly reasoning: ReasoningNextOutput;
  readonly stream: boolean;
}

export interface ModelRuntimeResult {
  readonly invocation: ModelInvocationContract;
  readonly output?: TurnMessage;
  readonly stream?: AsyncIterable<StreamEvent<"stream.chunk">>;
  readonly finishReason?: "stop" | "length" | "error";
  readonly degradation?: RuntimeDegradeSurface;
  readonly failure?: RuntimeErrorSurface;
}

export interface ModelRuntime {
  generate(request: ModelRuntimeRequest): Promise<ModelRuntimeResult>;
}

export interface ToolRuntime {
  execute(call: ToolCall): Promise<ToolResultEnvelope>;
}

export type PolicyDecision = ExecutionPolicy;

export interface PolicyRuntime {
  evaluatePrompt(prompt: PromptEnvelope, context: RunContext): Promise<PolicyDecision>;
  evaluateToolCall(call: ToolCall, context: RunContext): Promise<PolicyDecision>;
  evaluateOutput(output: TurnMessage, context: RunContext): Promise<PolicyDecision>;
}

export interface AssembledContext {
  readonly prompt: PromptEnvelope;
  readonly sections?: readonly ContextSection[];
  readonly recallBlocks?: readonly RecallBlock[];
  readonly memory: readonly MemoryRecord[];
  readonly metadata?: RuntimeMetadata;
}

export interface ContextAssemblerInput {
  readonly context: RunContext;
  readonly session: SessionContract;
  readonly task: TaskContract;
  readonly input: TurnMessage;
}

export interface ContextAssembler {
  assemble(input: ContextAssemblerInput): Promise<AssembledContext>;
}

export interface EngineRuntimePorts {
  readonly sessionManager: SessionManager;
  readonly journal: Journal;
  readonly emitter: ResponseEmitter;
  readonly memory: MemoryService;
  readonly model: ModelRuntime;
  readonly tool: ToolRuntime;
  readonly policy: PolicyRuntime;
  readonly contextAssembler: ContextAssembler;
}
