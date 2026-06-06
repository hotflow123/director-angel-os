import type {
  AgentOsPolicyVerdict,
  AgentOsSandboxPreflight,
} from "@hotflow/agent-os-kernel-contracts";
import { isAgentOsSandboxPreflight } from "@hotflow/agent-os-kernel-contracts";
import { resolveConversationRuntimeDefaultToolPolicy } from "./default-tool-policy.js";
import { buildLearningEvidenceContext } from "./learning-evidence-context.js";
import type { LearningEvidenceContextBuildResult } from "./learning-evidence-context.js";
import type { ConversationRuntimeMemoryEvidenceRecord } from "./memory-evidence.js";
import { createToolResultEvidenceRecord } from "./memory-evidence.js";
import type {
  ConversationRuntimeToolHook,
  ConversationRuntimeToolHookPhase,
  ConversationRuntimeToolHookTraceEntry,
} from "./tool-hooks.js";
import {
  runConversationRuntimeToolHookPipelineAfterCall,
  runConversationRuntimeToolHookPipelineBeforeCall,
  runConversationRuntimeToolHookPipelinePersistResult,
} from "./tool-hooks.js";
import type { ConversationRuntimeToolEvidenceStore } from "./tool-result-evidence-store.js";
import type { ConversationRuntimeTraceItem } from "./types.js";

export type ConversationRuntimeModelToolMessageRole = "system" | "user" | "assistant" | "tool";

export interface ConversationRuntimeModelToolMessage {
  readonly role: ConversationRuntimeModelToolMessageRole;
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly ConversationRuntimeModelToolCall[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeModelToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly readOnly?: boolean;
  readonly requiresApproval?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeModelTurnInput {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly messages: readonly ConversationRuntimeModelToolMessage[];
  readonly tools: readonly ConversationRuntimeModelToolDefinition[];
  readonly signal?: AbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeModelToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly readOnly: boolean;
  readonly aliases?: readonly string[];
  readonly searchHint?: string;
  readonly isConcurrencySafe?: boolean;
  readonly isDestructive?: boolean;
  readonly interruptBehavior?: "continue" | "abort" | "cancel-siblings";
  readonly inputSchema?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ConversationRuntimeToolPermissionStatus = "allow" | "ask" | "deny";

export interface ConversationRuntimeToolPermissionDecision {
  readonly status: ConversationRuntimeToolPermissionStatus;
  readonly reason?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly actionLabels?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeToolPermissionInput {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly call: ConversationRuntimeModelToolCall;
  readonly tool?: ConversationRuntimeModelToolDefinition;
  readonly defaultDecision: ConversationRuntimeToolPermissionDecision;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ConversationRuntimeToolPermissionPort = (
  input: ConversationRuntimeToolPermissionInput,
) => Promise<ConversationRuntimeToolPermissionDecision> | ConversationRuntimeToolPermissionDecision;

export interface ConversationRuntimeToolSandboxPreflightInput {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly call: ConversationRuntimeModelToolCall;
  readonly tool?: ConversationRuntimeModelToolDefinition;
  readonly policyVerdict: AgentOsPolicyVerdict;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ConversationRuntimeToolSandboxPreflightPort = (
  input: ConversationRuntimeToolSandboxPreflightInput,
) => Promise<AgentOsSandboxPreflight> | AgentOsSandboxPreflight;

export interface ConversationRuntimeModelTurnOutput {
  readonly assistantMessage?: ConversationRuntimeModelToolMessage;
  readonly toolCalls?: readonly ConversationRuntimeModelToolCall[];
  readonly finalText?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ConversationRuntimeModelCallPort = (
  input: ConversationRuntimeModelTurnInput,
) => Promise<ConversationRuntimeModelTurnOutput> | ConversationRuntimeModelTurnOutput;

export interface ConversationRuntimeToolExecutionInput {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly call: ConversationRuntimeModelToolCall;
  readonly signal?: AbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeToolExecutionOutput {
  readonly callId: string;
  readonly toolName: string;
  readonly ok: boolean;
  readonly content: string;
  readonly output?: unknown;
  readonly error?: string;
  readonly requiresApproval?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ConversationRuntimeToolExecutorPort = (
  input: ConversationRuntimeToolExecutionInput,
) => Promise<ConversationRuntimeToolExecutionOutput> | ConversationRuntimeToolExecutionOutput;

export type ConversationRuntimeModelToolLoopEvent =
  | {
      readonly kind: "model.turn";
      readonly turnIndex: number;
      readonly messageCount: number;
    }
  | {
      readonly kind: "tool.requested";
      readonly turnIndex: number;
      readonly call: ConversationRuntimeModelToolCall;
    }
  | {
      readonly kind: "tool.permission";
      readonly turnIndex: number;
      readonly call: ConversationRuntimeModelToolCall;
      readonly tool?: ConversationRuntimeModelToolDefinition;
      readonly decision: ConversationRuntimeToolPermissionDecision;
      readonly policyVerdict?: AgentOsPolicyVerdict;
      readonly sandboxPreflight?: AgentOsSandboxPreflight;
    }
  | {
      readonly kind: "tool.sandbox_preflight";
      readonly turnIndex: number;
      readonly call: ConversationRuntimeModelToolCall;
      readonly tool?: ConversationRuntimeModelToolDefinition;
      readonly policyVerdict: AgentOsPolicyVerdict;
      readonly preflight: AgentOsSandboxPreflight;
    }
  | {
      readonly kind: "tool.result";
      readonly turnIndex: number;
      readonly result: ConversationRuntimeToolExecutionOutput;
    }
  | {
      readonly kind: "tool.loop_detected";
      readonly turnIndex: number;
      readonly call: ConversationRuntimeModelToolCall;
      readonly hookName: string;
      readonly reason: string;
      readonly metadata?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "model.final";
      readonly turnIndex: number;
      readonly text: string;
    }
  | {
      readonly kind: "model.error";
      readonly turnIndex: number;
      readonly message: string;
    }
  | {
      readonly kind: "loop.stopped";
      readonly reason:
        | "max-turns"
        | "approval-required"
        | "permission-denied"
        | "no-final-text"
        | "interrupted";
    };

export interface RunConversationRuntimeModelToolLoopInput {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly messages: readonly ConversationRuntimeModelToolMessage[];
  readonly tools?: readonly ConversationRuntimeModelToolDefinition[];
  readonly requiredToolCalls?: readonly ConversationRuntimeModelToolCall[];
  readonly maxTurns?: number;
  readonly abortSignal?: AbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly callModel: ConversationRuntimeModelCallPort;
  readonly authorizeToolCall?: ConversationRuntimeToolPermissionPort;
  readonly preflightToolSandbox?: ConversationRuntimeToolSandboxPreflightPort;
  readonly executeTool: ConversationRuntimeToolExecutorPort;
  readonly toolEvidenceStore?: ConversationRuntimeToolEvidenceStore;
  readonly toolResultBudget?: ConversationRuntimeToolResultBudget;
  readonly enableModelRetryAfterToolEvidence?: boolean;
  readonly modelRetryDelayMs?: number;
  readonly onToolResult?: (input: {
    readonly turnId: string;
    readonly sessionKey: string;
    readonly call: ConversationRuntimeModelToolCall;
    readonly result: ConversationRuntimeToolExecutionOutput;
  }) => Promise<void> | void;
  readonly toolHooks?: readonly ConversationRuntimeToolHook[];
}

export interface ConversationRuntimeToolResultBudget {
  readonly maxTurnModelVisibleChars?: number;
  readonly previewChars?: number;
}

export interface ConversationRuntimeModelToolLoopResult {
  readonly finalText?: string;
  readonly messages: readonly ConversationRuntimeModelToolMessage[];
  readonly events: readonly ConversationRuntimeModelToolLoopEvent[];
  readonly memoryEvidenceRecords: readonly ConversationRuntimeMemoryEvidenceRecord[];
  readonly operatorTrace: readonly ConversationRuntimeTraceItem[];
  readonly stoppedReason?:
    | "max-turns"
    | "approval-required"
    | "permission-denied"
    | "no-final-text"
    | "interrupted";
  readonly structuredFallbackReason?: "empty-tool-results";
}

const DEFAULT_MAX_MODEL_TOOL_LOOP_TURNS = 4;
const DEFAULT_WEB_EXTRACT_ARTIFACT_READ_MAX_CHARS = 64_000;
const DEFAULT_MODEL_RETRY_AFTER_TOOL_DELAY_MS = 500;

export async function runConversationRuntimeModelToolLoop(
  input: RunConversationRuntimeModelToolLoopInput,
): Promise<ConversationRuntimeModelToolLoopResult> {
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_MODEL_TOOL_LOOP_TURNS;
  const tools = input.tools ?? [];
  const enforceToolAvailability = input.tools !== undefined;
  const toolDefinitionsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const messages: ConversationRuntimeModelToolMessage[] = [...input.messages];
  const events: ConversationRuntimeModelToolLoopEvent[] = [];
  const memoryEvidenceRecordsById = new Map<string, ConversationRuntimeMemoryEvidenceRecord>();
  const operatorTrace: ConversationRuntimeTraceItem[] = [];
  const executedToolResultsByKey = new Map<string, ConversationRuntimeToolExecutionOutput>();

  if (isConversationRuntimeAbortRequested(input.abortSignal)) {
    events.push({ kind: "loop.stopped", reason: "interrupted" });
    return {
      messages,
      events,
      memoryEvidenceRecords: [...memoryEvidenceRecordsById.values()],
      operatorTrace,
      stoppedReason: "interrupted",
    };
  }

  if (input.requiredToolCalls !== undefined && input.requiredToolCalls.length > 0) {
    const requiredToolCalls = input.requiredToolCalls.map((call) =>
      enrichToolCallFromDefinition(call, toolDefinitionsByName.get(call.name)),
    );
    messages.push({
      role: "assistant",
      content: "",
      toolCalls: requiredToolCalls,
      metadata: {
        requiredGrounding: true,
      },
    });
    const stoppedReason = await executeToolCallsForTurn({
      turnIndex: -1,
      requestedBy: "runtime",
      calls: requiredToolCalls,
      input,
      tools,
      enforceToolAvailability,
      toolDefinitionsByName,
      messages,
      events,
      operatorTrace,
      executedToolResultsByKey,
      memoryEvidenceRecordsById,
    });
    if (stoppedReason !== undefined) {
      return {
        messages,
        events,
        memoryEvidenceRecords: [...memoryEvidenceRecordsById.values()],
        operatorTrace,
        stoppedReason,
      };
    }
  }

  for (let turnIndex = 0; turnIndex < maxTurns; turnIndex += 1) {
    if (isConversationRuntimeAbortRequested(input.abortSignal)) {
      events.push({ kind: "loop.stopped", reason: "interrupted" });
      return {
        messages,
        events,
        memoryEvidenceRecords: [...memoryEvidenceRecordsById.values()],
        operatorTrace,
        stoppedReason: "interrupted",
      };
    }
    events.push({
      kind: "model.turn",
      turnIndex,
      messageCount: messages.length,
    });
    operatorTrace.push({
      source: "model",
      stage: "model.turn",
      detail: "Model turn started in the conversation runtime tool loop.",
      metadata: {
        turnIndex,
        messageCount: messages.length,
        toolCount: tools.length,
      },
    });

    const modelCallInput = {
      turnId: input.turnId,
      sessionKey: input.sessionKey,
      messages,
      tools,
      ...(input.abortSignal === undefined ? {} : { signal: input.abortSignal }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    };
    const modelCall = await callModelWithConservativeRetry({
      input,
      modelCallInput,
      turnIndex,
      messages,
      operatorTrace,
      memoryEvidenceRecordsById,
    });
    if (!modelCall.ok) {
      const message = toModelLoopErrorMessage(modelCall.error);
      const errorDetail = extractModelErrorDetail(modelCall.error);
      const metadataProvider =
        readMetadataNonEmptyString(input.metadata, "provider") ??
        readMetadataNonEmptyString(input.metadata, "providerId");
      const metadataModel =
        readMetadataNonEmptyString(input.metadata, "model") ??
        readMetadataNonEmptyString(input.metadata, "modelId");
      events.push({ kind: "model.error", turnIndex, message });
      const evidenceToolSucceeded = hasSuccessfulToolEvidence(memoryEvidenceRecordsById);
      operatorTrace.push({
        source: "model",
        stage: evidenceToolSucceeded
          ? "model.error.after_required_tool"
          : "model.error.before_tool",
        detail: evidenceToolSucceeded
          ? "Model call failed after required tool evidence was read."
          : "Model call failed before any successful tool evidence was available.",
        metadata: {
          turnIndex,
          error: message,
          evidenceToolSucceeded,
          retry_count: modelCall.retryCount,
          retry_reason: modelCall.retryReason ?? "",
          final_error: message,
          provider: errorDetail.provider ?? metadataProvider ?? "",
          providerId: errorDetail.provider ?? metadataProvider ?? "",
          model: errorDetail.model ?? metadataModel ?? "",
          modelId: errorDetail.model ?? metadataModel ?? "",
          ...(errorDetail.statusCode === undefined ? {} : { statusCode: errorDetail.statusCode }),
          ...(errorDetail.code === undefined ? {} : { errorCode: errorDetail.code }),
          ...(errorDetail.errorClass === undefined ? {} : { errorClass: errorDetail.errorClass }),
        },
      });
      return {
        messages,
        events,
        memoryEvidenceRecords: [...memoryEvidenceRecordsById.values()],
        operatorTrace,
        stoppedReason: "no-final-text",
      };
    }
    const modelOutput = modelCall.output;
    if (isConversationRuntimeAbortRequested(input.abortSignal)) {
      events.push({ kind: "loop.stopped", reason: "interrupted" });
      return {
        messages,
        events,
        memoryEvidenceRecords: [...memoryEvidenceRecordsById.values()],
        operatorTrace,
        stoppedReason: "interrupted",
      };
    }
    const toolCalls = (modelOutput.toolCalls ?? []).map((call) =>
      enrichToolCallFromDefinition(call, toolDefinitionsByName.get(call.name)),
    );
    if (modelOutput.assistantMessage !== undefined) {
      messages.push(
        toolCalls.length === 0
          ? modelOutput.assistantMessage
          : { ...modelOutput.assistantMessage, toolCalls },
      );
    } else if (toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: "",
        toolCalls,
      });
    } else if (modelOutput.finalText !== undefined) {
      messages.push({
        role: "assistant",
        content: modelOutput.finalText,
      });
    }
    if (modelOutput.finalText !== undefined && toolCalls.length === 0) {
      events.push({ kind: "model.final", turnIndex, text: modelOutput.finalText });
      return {
        finalText: modelOutput.finalText,
        messages,
        events,
        memoryEvidenceRecords: [...memoryEvidenceRecordsById.values()],
        operatorTrace,
      };
    }

    if (toolCalls.length === 0) {
      events.push({ kind: "loop.stopped", reason: "no-final-text" });
      return {
        messages,
        events,
        memoryEvidenceRecords: [...memoryEvidenceRecordsById.values()],
        operatorTrace,
        stoppedReason: "no-final-text",
      };
    }

    const stoppedReason = await executeToolCallsForTurn({
      turnIndex,
      requestedBy: "model",
      calls: toolCalls,
      input,
      tools,
      enforceToolAvailability,
      toolDefinitionsByName,
      messages,
      events,
      operatorTrace,
      executedToolResultsByKey,
      memoryEvidenceRecordsById,
    });
    if (stoppedReason !== undefined) {
      return {
        messages,
        events,
        memoryEvidenceRecords: [...memoryEvidenceRecordsById.values()],
        operatorTrace,
        stoppedReason,
      };
    }
  }

  events.push({ kind: "loop.stopped", reason: "max-turns" });
  const emptyToolResultFallback = createEmptyToolResultFallback(events);
  return {
    ...(emptyToolResultFallback === undefined
      ? {}
      : {
          finalText: emptyToolResultFallback,
          structuredFallbackReason: "empty-tool-results" as const,
        }),
    messages,
    events,
    memoryEvidenceRecords: [...memoryEvidenceRecordsById.values()],
    operatorTrace,
    stoppedReason: "max-turns",
  };
}

function toModelLoopErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function callModelWithConservativeRetry(input: {
  readonly input: RunConversationRuntimeModelToolLoopInput;
  readonly modelCallInput: ConversationRuntimeModelTurnInput;
  readonly turnIndex: number;
  readonly messages: readonly ConversationRuntimeModelToolMessage[];
  readonly operatorTrace: ConversationRuntimeTraceItem[];
  readonly memoryEvidenceRecordsById: ReadonlyMap<string, ConversationRuntimeMemoryEvidenceRecord>;
}): Promise<
  | {
      readonly ok: true;
      readonly output: Awaited<ReturnType<ConversationRuntimeModelCallPort>>;
      readonly retryCount: number;
      readonly retryReason?: string;
    }
  | {
      readonly ok: false;
      readonly error: unknown;
      readonly retryCount: number;
      readonly retryReason?: string;
    }
> {
  let lastError: unknown;
  let retryReason: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const output = await input.input.callModel(input.modelCallInput);
      if (attempt > 0) {
        input.operatorTrace.push({
          source: "model",
          stage: "model.retry.succeeded",
          detail: "Model call succeeded after one conservative same-provider retry.",
          metadata: {
            turnIndex: input.turnIndex,
            retry_count: attempt,
            retry_reason: retryReason ?? "",
            final_success: true,
          },
        });
      }
      return {
        ok: true,
        output,
        retryCount: attempt,
        ...(retryReason === undefined ? {} : { retryReason }),
      };
    } catch (error) {
      lastError = error;
      const message = toModelLoopErrorMessage(error);
      if (
        attempt === 0 &&
        shouldRetryModelCallAfterToolEvidence({
          input: input.input,
          error,
          messages: input.messages,
          memoryEvidenceRecordsById: input.memoryEvidenceRecordsById,
        })
      ) {
        retryReason = message;
        input.operatorTrace.push({
          source: "model",
          stage: "model.retry.scheduled",
          detail: "Model call failed after tool evidence; scheduling one same-provider retry.",
          metadata: {
            turnIndex: input.turnIndex,
            retry_count: 1,
            retry_reason: message,
            evidenceToolSucceeded: hasSuccessfulToolEvidence(input.memoryEvidenceRecordsById),
          },
        });
        await delayModelRetry(getModelRetryDelayMs(error, input.input.modelRetryDelayMs));
        continue;
      }
      return {
        ok: false,
        error,
        retryCount: attempt,
        ...(retryReason === undefined ? {} : { retryReason }),
      };
    }
  }
  return {
    ok: false,
    error: lastError ?? new Error("model call failed"),
    retryCount: 1,
    ...(retryReason === undefined ? {} : { retryReason }),
  };
}

function shouldRetryModelCallAfterToolEvidence(input: {
  readonly input: RunConversationRuntimeModelToolLoopInput;
  readonly error: unknown;
  readonly messages: readonly ConversationRuntimeModelToolMessage[];
  readonly memoryEvidenceRecordsById: ReadonlyMap<string, ConversationRuntimeMemoryEvidenceRecord>;
}): boolean {
  if (input.input.enableModelRetryAfterToolEvidence !== true) {
    return false;
  }
  if (!hasSuccessfulToolEvidence(input.memoryEvidenceRecordsById)) {
    return false;
  }
  if (!input.messages.some((message) => message.role === "tool")) {
    return false;
  }
  return isRetriableModelError(input.error);
}

function isRetriableModelError(error: unknown): boolean {
  const detail = extractModelErrorDetail(error);
  const message = detail.message;
  if (
    /rate[_ -]?limit|invalid[_ -]?request|context[_ -]?length|authentication|unauthorized|forbidden|policy|safety/iu.test(
      message,
    )
  ) {
    if (detail.statusCode !== 429 && !/overloaded_error/iu.test(detail.code ?? "")) {
      return false;
    }
  }
  if (
    /invalid[_ -]?request|context[_ -]?length|authentication|unauthorized|forbidden|policy|safety/iu.test(
      detail.code ?? "",
    )
  ) {
    return false;
  }
  if (detail.statusCode === 429) {
    return true;
  }
  if (detail.statusCode !== undefined && detail.statusCode >= 500 && detail.statusCode < 600) {
    return true;
  }
  if (/rate[_ -]?limit|overloaded_error/iu.test(detail.code ?? "")) {
    return true;
  }
  if (detail.provider === "anthropic" && detail.code === "overloaded_error") {
    return true;
  }
  return /fetch failed|timeout|network error|ECONNRESET|ETIMEDOUT|overloaded_error/iu.test(message);
}

function getModelRetryDelayMs(error: unknown, overrideDelayMs: number | undefined): number {
  if (overrideDelayMs !== undefined) {
    return overrideDelayMs;
  }
  return extractModelErrorDetail(error).statusCode === 429
    ? 2_000
    : DEFAULT_MODEL_RETRY_AFTER_TOOL_DELAY_MS;
}

function extractModelErrorDetail(error: unknown): {
  readonly message: string;
  readonly code?: string;
  readonly statusCode?: number;
  readonly provider?: string;
  readonly model?: string;
  readonly errorClass?: string;
} {
  const record = isRecord(error) ? error : undefined;
  const rawStatusCode =
    readRecordNumber(record, "statusCode") ??
    readRecordNumber(record, "status") ??
    readNestedRecordNumber(record, "response", "status");
  const code =
    readRecordString(record, "code") ??
    readRecordString(record, "type") ??
    readNestedRecordString(record, "error", "code") ??
    readNestedRecordString(record, "error", "type");
  const provider = readRecordString(record, "provider");
  const model = readRecordString(record, "model") ?? readRecordString(record, "modelId");
  const errorClass = readRecordString(record, "errorClass");
  return {
    message: toModelLoopErrorMessage(error),
    ...(code === undefined ? {} : { code }),
    ...(rawStatusCode === undefined ? {} : { statusCode: rawStatusCode }),
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(errorClass === undefined ? {} : { errorClass }),
  };
}

function hasSuccessfulToolEvidence(
  records: ReadonlyMap<string, ConversationRuntimeMemoryEvidenceRecord>,
): boolean {
  for (const record of records.values()) {
    if (readMetadataBoolean(record.metadata, "ok") === true) {
      return true;
    }
    if (record.sourceAccessStatus === "available" && record.failureTaxonomy.length === 0) {
      return true;
    }
  }
  return false;
}

function delayModelRetry(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeToolCallsForTurn(input: {
  readonly turnIndex: number;
  readonly requestedBy: "model" | "runtime";
  readonly calls: readonly ConversationRuntimeModelToolCall[];
  readonly input: RunConversationRuntimeModelToolLoopInput;
  readonly tools: readonly ConversationRuntimeModelToolDefinition[];
  readonly enforceToolAvailability: boolean;
  readonly toolDefinitionsByName: ReadonlyMap<string, ConversationRuntimeModelToolDefinition>;
  readonly messages: ConversationRuntimeModelToolMessage[];
  readonly events: ConversationRuntimeModelToolLoopEvent[];
  readonly operatorTrace: ConversationRuntimeTraceItem[];
  readonly executedToolResultsByKey: Map<string, ConversationRuntimeToolExecutionOutput>;
  readonly memoryEvidenceRecordsById: Map<string, ConversationRuntimeMemoryEvidenceRecord>;
}): Promise<"approval-required" | "permission-denied" | "interrupted" | undefined> {
  const pendingCalls = [...input.calls];
  const autoReadFullBodyRefs = new Set<string>();
  const autoFollowedXArticleUrls = new Set<string>();
  const turnToolMessageStartIndex = input.messages.length;
  for (let callIndex = 0; callIndex < pendingCalls.length; callIndex += 1) {
    const call = pendingCalls[callIndex];
    if (call === undefined) {
      continue;
    }
    const prepared = await prepareToolCallForExecution({ state: input, call });
    if (prepared.kind === "handled") {
      continue;
    }
    if (prepared.kind === "stop") {
      return prepared.reason;
    }

    const preparedBatch = [prepared.execution];
    if (isConcurrencySafePreparedToolCall(prepared.execution)) {
      while (callIndex + 1 < pendingCalls.length) {
        const nextCall = pendingCalls[callIndex + 1];
        if (nextCall === undefined) {
          break;
        }
        const nextTool = input.toolDefinitionsByName.get(nextCall.name);
        const enrichedNextCall = enrichToolCallFromDefinition(nextCall, nextTool);
        if (
          !isConcurrencySafeToolCall(enrichedNextCall, nextTool) ||
          input.executedToolResultsByKey.has(createToolCallReuseKey(enrichedNextCall))
        ) {
          break;
        }
        const nextPrepared = await prepareToolCallForExecution({
          state: input,
          call: enrichedNextCall,
        });
        if (nextPrepared.kind === "handled") {
          callIndex += 1;
          continue;
        }
        if (nextPrepared.kind === "stop") {
          return nextPrepared.reason;
        }
        if (!isConcurrencySafePreparedToolCall(nextPrepared.execution)) {
          break;
        }
        preparedBatch.push(nextPrepared.execution);
        callIndex += 1;
      }
    }

    const results =
      preparedBatch.length === 1
        ? preparedBatch[0] === undefined
          ? []
          : [await executePreparedToolCall(input, preparedBatch[0])]
        : await Promise.all(
            preparedBatch.map((execution) => executePreparedToolCall(input, execution)),
          );
    for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
      const execution = preparedBatch[resultIndex];
      const result = results[resultIndex];
      if (execution === undefined || result === undefined) {
        continue;
      }
      const stoppedReason = await recordExecutedToolResult({
        state: input,
        execution,
        result,
        pendingCalls,
        autoReadFullBodyRefs,
        autoFollowedXArticleUrls,
      });
      if (stoppedReason !== undefined) {
        return stoppedReason;
      }
    }
  }
  enforceAggregateToolResultBudgetForTurn({
    messages: input.messages,
    startIndex: turnToolMessageStartIndex,
    ...(input.input.toolResultBudget === undefined ? {} : { budget: input.input.toolResultBudget }),
  });
  return undefined;
}

type ExecuteToolCallsForTurnState = Parameters<typeof executeToolCallsForTurn>[0];

interface PreparedToolCallExecution {
  readonly call: ConversationRuntimeModelToolCall;
  readonly tool?: ConversationRuntimeModelToolDefinition;
  readonly toolCallKey: string;
}

type PrepareToolCallForExecutionResult =
  | { readonly kind: "prepared"; readonly execution: PreparedToolCallExecution }
  | { readonly kind: "handled" }
  | {
      readonly kind: "stop";
      readonly reason: "approval-required" | "permission-denied" | "interrupted";
    };

async function prepareToolCallForExecution(input: {
  readonly state: ExecuteToolCallsForTurnState;
  readonly call: ConversationRuntimeModelToolCall;
}): Promise<PrepareToolCallForExecutionResult> {
  const state = input.state;
  let tool = state.toolDefinitionsByName.get(input.call.name);
  let call = enrichToolCallFromDefinition(input.call, tool);
  if (isConversationRuntimeAbortRequested(state.input.abortSignal)) {
    state.events.push({ kind: "loop.stopped", reason: "interrupted" });
    return { kind: "stop", reason: "interrupted" };
  }
  const hookDecision = await runBeforeCallToolHooks({
    state,
    call,
    ...(tool === undefined ? {} : { tool }),
  });
  if (hookDecision.status === "denied") {
    state.events.push({ kind: "loop.stopped", reason: "permission-denied" });
    return { kind: "stop", reason: "permission-denied" };
  }
  call = hookDecision.call;
  tool = state.toolDefinitionsByName.get(call.name);
  call = enrichToolCallFromDefinition(call, tool);
  recordRequestedToolCall(state, call);
  if (tool === undefined && state.enforceToolAvailability) {
    return handleUnavailableToolCall({ state, call });
  }
  const toolCallKey = createToolCallReuseKey(call);
  const reused = handleReusableToolCallResult({ state, call, toolCallKey });
  if (reused !== undefined) {
    return reused;
  }
  const permission = await resolveToolPermissionForCall({ state, call, tool });
  if (permission.status !== "allow") {
    state.events.push({
      kind: "tool.permission",
      turnIndex: state.turnIndex,
      call,
      ...(tool === undefined ? {} : { tool }),
      decision: permission,
      policyVerdict: createAgentOsPolicyVerdictFromPermission(permission),
    });
    state.operatorTrace.push({
      source: "approval",
      stage: "tool.permission",
      detail:
        permission.status === "ask"
          ? `Tool ${call.name} requires operator approval before execution.`
          : `Tool ${call.name} was denied before execution.`,
      metadata: {
        turnIndex: state.turnIndex,
        requestedBy: state.requestedBy,
        callId: call.id,
        toolName: call.name,
        status: permission.status,
        reason: permission.reason ?? "",
        capability: readMetadataString(call.metadata, "capability"),
        risk: readMetadataString(call.metadata, "risk"),
      },
    });
    state.events.push({
      kind: "loop.stopped",
      reason: permission.status === "ask" ? "approval-required" : "permission-denied",
    });
    return {
      kind: "stop",
      reason: permission.status === "ask" ? "approval-required" : "permission-denied",
    };
  }
  const policyVerdict = createAgentOsPolicyVerdictFromPermission(permission);
  const sandboxPreflight = await runToolSandboxPreflight({
    state,
    call,
    tool,
    policyVerdict,
  });
  state.events.push({
    kind: "tool.sandbox_preflight",
    turnIndex: state.turnIndex,
    call,
    ...(tool === undefined ? {} : { tool }),
    policyVerdict,
    preflight: sandboxPreflight,
  });
  state.operatorTrace.push({
    source: "tool",
    stage: "tool.sandbox_preflight",
    detail:
      sandboxPreflight.verdict === "allow"
        ? `Agent OS sandbox preflight allowed tool ${call.name}.`
        : `Agent OS sandbox preflight blocked tool ${call.name}.`,
    metadata: {
      turnIndex: state.turnIndex,
      requestedBy: state.requestedBy,
      callId: call.id,
      toolName: call.name,
      status: sandboxPreflight.verdict,
      sandboxMode: sandboxPreflight.sandboxMode,
      reason: sandboxPreflight.reason ?? "",
      providerId: sandboxPreflight.providerId ?? "",
      capability: readMetadataString(call.metadata, "capability"),
      risk: readMetadataString(call.metadata, "risk"),
    },
  });
  if (sandboxPreflight.verdict !== "allow") {
    const decision = createSandboxBlockedPermissionDecision(call, sandboxPreflight);
    state.events.push({
      kind: "tool.permission",
      turnIndex: state.turnIndex,
      call,
      ...(tool === undefined ? {} : { tool }),
      decision,
      policyVerdict: {
        verdict: "deny",
        reason: decision.reason ?? "Agent OS sandbox preflight blocked this tool call",
        decidedAt: sandboxPreflight.checkedAt,
        policyId: "agent-os.tool-sandbox-preflight",
      },
      sandboxPreflight,
    });
    state.operatorTrace.push({
      source: "approval",
      stage: "tool.permission",
      detail: `Tool ${call.name} was denied by Agent OS sandbox preflight before execution.`,
      metadata: {
        turnIndex: state.turnIndex,
        requestedBy: state.requestedBy,
        callId: call.id,
        toolName: call.name,
        status: decision.status,
        reason: decision.reason ?? "",
        sandboxStatus: sandboxPreflight.verdict,
        sandboxMode: sandboxPreflight.sandboxMode,
        capability: readMetadataString(call.metadata, "capability"),
        risk: readMetadataString(call.metadata, "risk"),
      },
    });
    state.events.push({ kind: "loop.stopped", reason: "permission-denied" });
    return { kind: "stop", reason: "permission-denied" };
  }
  return {
    kind: "prepared",
    execution: { call, ...(tool === undefined ? {} : { tool }), toolCallKey },
  };
}

async function runBeforeCallToolHooks(input: {
  readonly state: ExecuteToolCallsForTurnState;
  readonly call: ConversationRuntimeModelToolCall;
  readonly tool?: ConversationRuntimeModelToolDefinition;
}): Promise<
  | {
      readonly status: "allowed";
      readonly call: ConversationRuntimeModelToolCall;
    }
  | {
      readonly status: "denied";
      readonly call: ConversationRuntimeModelToolCall;
    }
> {
  const hooks = input.state.input.toolHooks ?? [];
  if (hooks.length === 0) {
    return { status: "allowed", call: input.call };
  }
  const result = await runConversationRuntimeToolHookPipelineBeforeCall({
    turnId: input.state.input.turnId,
    sessionKey: input.state.input.sessionKey,
    call: input.call,
    ...(input.tool === undefined ? {} : { tool: input.tool }),
    hooks,
    ...(input.state.input.metadata === undefined ? {} : { metadata: input.state.input.metadata }),
  });
  recordToolHookTraceEntries({
    state: input.state,
    phase: "beforeCall",
    call: result.call,
    trace: result.trace,
  });
  if (result.status === "denied") {
    recordToolLoopDetectedEventIfNeeded({
      state: input.state,
      call: result.call,
      trace: result.trace,
    });
    return { status: "denied", call: result.call };
  }
  return { status: "allowed", call: result.call };
}

async function runAfterCallToolHooks(input: {
  readonly state: ExecuteToolCallsForTurnState;
  readonly execution: PreparedToolCallExecution;
  readonly result: ConversationRuntimeToolExecutionOutput;
}): Promise<ConversationRuntimeToolExecutionOutput> {
  const hooks = input.state.input.toolHooks ?? [];
  if (hooks.length === 0) {
    return input.result;
  }
  const result = await runConversationRuntimeToolHookPipelineAfterCall({
    turnId: input.state.input.turnId,
    sessionKey: input.state.input.sessionKey,
    call: input.execution.call,
    ...(input.execution.tool === undefined ? {} : { tool: input.execution.tool }),
    result: input.result,
    hooks,
    ...(input.state.input.metadata === undefined ? {} : { metadata: input.state.input.metadata }),
  });
  recordToolHookTraceEntries({
    state: input.state,
    phase: "afterCall",
    call: input.execution.call,
    trace: result.trace,
    requiresAudit: result.requiresAudit,
  });
  if (result.status === "denied") {
    return createToolHookDeniedResult({
      call: input.execution.call,
      phase: "afterCall",
      deniedBy: result.deniedBy,
      reason: result.reason,
    });
  }
  return result.result;
}

async function runPersistResultToolHooks(input: {
  readonly state: ExecuteToolCallsForTurnState;
  readonly execution: PreparedToolCallExecution;
  readonly result: ConversationRuntimeToolExecutionOutput;
}): Promise<ConversationRuntimeToolExecutionOutput> {
  const hooks = input.state.input.toolHooks ?? [];
  if (hooks.length === 0) {
    return input.result;
  }
  const result = await runConversationRuntimeToolHookPipelinePersistResult({
    turnId: input.state.input.turnId,
    sessionKey: input.state.input.sessionKey,
    call: input.execution.call,
    ...(input.execution.tool === undefined ? {} : { tool: input.execution.tool }),
    result: input.result,
    hooks,
    ...(input.state.input.metadata === undefined ? {} : { metadata: input.state.input.metadata }),
  });
  recordToolHookTraceEntries({
    state: input.state,
    phase: "persistResult",
    call: input.execution.call,
    trace: result.trace,
    requiresAudit: result.requiresAudit,
  });
  if (result.status === "denied") {
    return createToolHookDeniedResult({
      call: input.execution.call,
      phase: "persistResult",
      deniedBy: result.deniedBy,
      reason: result.reason,
    });
  }
  return result.result;
}

function recordRequestedToolCall(
  state: ExecuteToolCallsForTurnState,
  call: ConversationRuntimeModelToolCall,
): void {
  state.events.push({ kind: "tool.requested", turnIndex: state.turnIndex, call });
  state.operatorTrace.push({
    source: "tool",
    stage: "tool.requested",
    detail:
      state.requestedBy === "runtime"
        ? `Runtime required tool ${call.name} before model response.`
        : `Model requested tool ${call.name}.`,
    metadata: {
      turnIndex: state.turnIndex,
      requestedBy: state.requestedBy,
      callId: call.id,
      toolName: call.name,
      readOnly: call.readOnly === true,
      requiresApproval: call.requiresApproval === true,
      capability: readMetadataString(call.metadata, "capability"),
      risk: readMetadataString(call.metadata, "risk"),
    },
  });
}

function recordToolHookTraceEntries(input: {
  readonly state: ExecuteToolCallsForTurnState;
  readonly phase: ConversationRuntimeToolHookPhase;
  readonly call: ConversationRuntimeModelToolCall;
  readonly trace: readonly ConversationRuntimeToolHookTraceEntry[];
  readonly requiresAudit?: boolean;
}): void {
  for (const entry of input.trace) {
    input.state.operatorTrace.push({
      source: "tool",
      stage: toolHookTraceStage(input.phase),
      detail: `Tool hook ${entry.hookName} returned ${entry.status}.`,
      metadata: {
        ...(entry.metadata ?? {}),
        turnIndex: input.state.turnIndex,
        requestedBy: input.state.requestedBy,
        callId: input.call.id,
        toolName: input.call.name,
        hookName: entry.hookName,
        phase: input.phase,
        status: entry.status,
        reason: entry.reason ?? "",
        ...(input.requiresAudit === undefined ? {} : { requiresAudit: input.requiresAudit }),
      },
    });
  }
}

function recordToolLoopDetectedEventIfNeeded(input: {
  readonly state: ExecuteToolCallsForTurnState;
  readonly call: ConversationRuntimeModelToolCall;
  readonly trace: readonly ConversationRuntimeToolHookTraceEntry[];
}): void {
  const loopTrace = input.trace.find(
    (entry) => entry.status === "deny" && entry.reason === "tool-loop-threshold-exceeded",
  );
  if (loopTrace === undefined) {
    return;
  }
  input.state.events.push({
    kind: "tool.loop_detected",
    turnIndex: input.state.turnIndex,
    call: input.call,
    hookName: loopTrace.hookName,
    reason: loopTrace.reason ?? "tool-loop-threshold-exceeded",
    ...(loopTrace.metadata === undefined ? {} : { metadata: loopTrace.metadata }),
  });
}

function toolHookTraceStage(phase: ConversationRuntimeToolHookPhase): string {
  if (phase === "beforeCall") {
    return "tool.before_call";
  }
  if (phase === "afterCall") {
    return "tool.after_call";
  }
  return "tool.persist_result";
}

function createToolHookDeniedResult(input: {
  readonly call: ConversationRuntimeModelToolCall;
  readonly phase: ConversationRuntimeToolHookPhase;
  readonly deniedBy: string;
  readonly reason: string;
}): ConversationRuntimeToolExecutionOutput {
  return {
    callId: input.call.id,
    toolName: input.call.name,
    ok: false,
    content: `Tool ${input.call.name} was blocked by ${input.phase} hook ${input.deniedBy}: ${input.reason}`,
    error: input.reason,
    metadata: {
      toolHookDeniedPhase: input.phase,
      toolHookDeniedBy: input.deniedBy,
      toolHookDeniedReason: input.reason,
    },
  };
}

function handleUnavailableToolCall(input: {
  readonly state: ExecuteToolCallsForTurnState;
  readonly call: ConversationRuntimeModelToolCall;
}): PrepareToolCallForExecutionResult {
  const { state, call } = input;
  const result: ConversationRuntimeToolExecutionOutput = {
    callId: call.id,
    toolName: call.name,
    ok: false,
    content: createUnavailableToolResultContent(call.name, state.tools),
    error: "tool-not-available",
    metadata: {
      availableTools: state.tools.map((availableTool) => availableTool.name),
    },
  };
  const evidence = recordToolResultEvidence({
    turnId: state.input.turnId,
    sessionKey: state.input.sessionKey,
    call,
    result,
    target: state.memoryEvidenceRecordsById,
    store: state.input.toolEvidenceStore,
  });
  state.events.push({ kind: "tool.result", turnIndex: state.turnIndex, result });
  state.operatorTrace.push({
    source: "tool",
    stage: "tool.unavailable",
    detail: `Requested unavailable tool ${call.name}; it was not executed.`,
    metadata: {
      turnIndex: state.turnIndex,
      requestedBy: state.requestedBy,
      callId: call.id,
      toolName: call.name,
      availableTools: state.tools.map((availableTool) => availableTool.name),
    },
  });
  state.messages.push({
    role: "tool",
    toolCallId: result.callId,
    content: createModelVisibleToolResultContent(result),
    metadata: {
      ok: result.ok,
      toolName: result.toolName,
      error: result.error,
      toolEvidenceId: evidence.id,
    },
  });
  return { kind: "handled" };
}

function handleReusableToolCallResult(input: {
  readonly state: ExecuteToolCallsForTurnState;
  readonly call: ConversationRuntimeModelToolCall;
  readonly toolCallKey: string;
}): PrepareToolCallForExecutionResult | undefined {
  const { state, call } = input;
  const reusableResult = state.executedToolResultsByKey.get(input.toolCallKey);
  if (reusableResult === undefined) {
    return undefined;
  }
  const result = reuseToolExecutionOutput(reusableResult, call);
  const evidence = recordToolResultEvidence({
    turnId: state.input.turnId,
    sessionKey: state.input.sessionKey,
    call,
    result,
    target: state.memoryEvidenceRecordsById,
    store: state.input.toolEvidenceStore,
  });
  state.events.push({ kind: "tool.result", turnIndex: state.turnIndex, result });
  state.operatorTrace.push({
    source: "tool",
    stage: "tool.result.reused",
    detail: `Reused prior observation for duplicate tool call ${call.name}.`,
    metadata: {
      turnIndex: state.turnIndex,
      requestedBy: state.requestedBy,
      callId: call.id,
      reusedFromToolCallId: reusableResult.callId,
      toolName: call.name,
    },
  });
  state.messages.push({
    role: "tool",
    toolCallId: result.callId,
    content: createModelVisibleToolResultContent(result),
    metadata: {
      ok: result.ok,
      toolName: result.toolName,
      reusedFromToolCallId: reusableResult.callId,
      toolEvidenceId: evidence.id,
      ...(result.error === undefined ? {} : { error: result.error }),
    },
  });
  return { kind: "handled" };
}

async function resolveToolPermissionForCall(input: {
  readonly state: ExecuteToolCallsForTurnState;
  readonly call: ConversationRuntimeModelToolCall;
  readonly tool: ConversationRuntimeModelToolDefinition | undefined;
}): Promise<ConversationRuntimeToolPermissionDecision> {
  const { state, call, tool } = input;
  const defaultPermission = createDefaultToolPermissionDecision(call, tool);
  return state.input.authorizeToolCall === undefined
    ? defaultPermission
    : await state.input.authorizeToolCall({
        turnId: state.input.turnId,
        sessionKey: state.input.sessionKey,
        call,
        ...(tool === undefined ? {} : { tool }),
        defaultDecision: defaultPermission,
        ...(state.input.metadata === undefined ? {} : { metadata: state.input.metadata }),
      });
}

async function runToolSandboxPreflight(input: {
  readonly state: ExecuteToolCallsForTurnState;
  readonly call: ConversationRuntimeModelToolCall;
  readonly tool: ConversationRuntimeModelToolDefinition | undefined;
  readonly policyVerdict: AgentOsPolicyVerdict;
}): Promise<AgentOsSandboxPreflight> {
  const { state, call, tool, policyVerdict } = input;
  const rawSandboxPreflight =
    state.input.preflightToolSandbox === undefined
      ? createDefaultAgentOsSandboxPreflight(call, tool)
      : await state.input.preflightToolSandbox({
          turnId: state.input.turnId,
          sessionKey: state.input.sessionKey,
          call,
          ...(tool === undefined ? {} : { tool }),
          policyVerdict,
          ...(state.input.metadata === undefined ? {} : { metadata: state.input.metadata }),
        });
  return normalizeAgentOsSandboxPreflight(rawSandboxPreflight);
}

async function executePreparedToolCall(
  state: ExecuteToolCallsForTurnState,
  execution: PreparedToolCallExecution,
): Promise<ConversationRuntimeToolExecutionOutput> {
  const rawResult = await state.input.executeTool({
    turnId: state.input.turnId,
    sessionKey: state.input.sessionKey,
    call: execution.call,
    ...(state.input.abortSignal === undefined ? {} : { signal: state.input.abortSignal }),
    ...(state.input.metadata === undefined ? {} : { metadata: state.input.metadata }),
  });
  const result = await runAfterCallToolHooks({
    state,
    execution,
    result: rawResult,
  });
  await state.input.onToolResult?.({
    turnId: state.input.turnId,
    sessionKey: state.input.sessionKey,
    call: execution.call,
    result,
  });
  return result;
}

async function recordExecutedToolResult(input: {
  readonly state: ExecuteToolCallsForTurnState;
  readonly execution: PreparedToolCallExecution;
  readonly result: ConversationRuntimeToolExecutionOutput;
  readonly pendingCalls: ConversationRuntimeModelToolCall[];
  readonly autoReadFullBodyRefs: Set<string>;
  readonly autoFollowedXArticleUrls: Set<string>;
}): Promise<"approval-required" | "permission-denied" | "interrupted" | undefined> {
  const { state, execution } = input;
  const result = await runPersistResultToolHooks({
    state,
    execution,
    result: input.result,
  });
  const evidence = recordToolResultEvidence({
    turnId: state.input.turnId,
    sessionKey: state.input.sessionKey,
    call: execution.call,
    result,
    target: state.memoryEvidenceRecordsById,
    store: state.input.toolEvidenceStore,
  });
  state.executedToolResultsByKey.set(execution.toolCallKey, result);
  state.events.push({ kind: "tool.result", turnIndex: state.turnIndex, result });
  const modelVisibleToolResult = createModelVisibleToolResult(result, execution.call);
  state.operatorTrace.push({
    source: "tool",
    stage: "tool.completed",
    detail: `Tool ${execution.call.name} returned an observation to the model loop.`,
    metadata: {
      turnIndex: state.turnIndex,
      requestedBy: state.requestedBy,
      callId: result.callId,
      toolName: result.toolName,
      ok: result.ok,
      ...(result.error === undefined ? {} : { error: result.error }),
      ...(result.metadata === undefined ? {} : { toolResultMetadata: result.metadata }),
      capability:
        readMetadataString(result.metadata, "capability") ??
        readMetadataString(execution.call.metadata, "capability"),
      risk:
        readMetadataString(result.metadata, "risk") ??
        readMetadataString(execution.call.metadata, "risk"),
      ...(modelVisibleToolResult.learningEvidenceContext === undefined
        ? {}
        : { learningEvidenceContext: modelVisibleToolResult.learningEvidenceContext.metadata }),
    },
  });
  state.messages.push({
    role: "tool",
    toolCallId: result.callId,
    content: modelVisibleToolResult.content,
    metadata: {
      ok: result.ok,
      toolName: result.toolName,
      toolEvidenceId: evidence.id,
      ...(result.error === undefined ? {} : { error: result.error }),
      ...(result.metadata === undefined ? {} : { toolResultMetadata: result.metadata }),
      ...(modelVisibleToolResult.learningEvidenceContext === undefined
        ? {}
        : { learningEvidenceContext: modelVisibleToolResult.learningEvidenceContext.metadata }),
    },
  });
  if (isConversationRuntimeAbortRequested(state.input.abortSignal)) {
    state.events.push({ kind: "loop.stopped", reason: "interrupted" });
    return "interrupted";
  }
  if (result.requiresApproval === true) {
    state.events.push({ kind: "loop.stopped", reason: "approval-required" });
    return "approval-required";
  }
  if (readMetadataString(result.metadata, "toolHookDeniedPhase") !== undefined) {
    state.events.push({ kind: "loop.stopped", reason: "permission-denied" });
    return "permission-denied";
  }
  const autoReadCall = createWebExtractArtifactAutoReadCall({
    sourceCall: execution.call,
    result,
    messages: state.input.messages,
    pendingCalls: input.pendingCalls,
    autoReadFullBodyRefs: input.autoReadFullBodyRefs,
    enforceToolAvailability: state.enforceToolAvailability,
    toolDefinitionsByName: state.toolDefinitionsByName,
  });
  if (autoReadCall !== undefined) {
    input.pendingCalls.push(
      enrichToolCallFromDefinition(
        autoReadCall,
        state.toolDefinitionsByName.get(autoReadCall.name),
      ),
    );
  }
  const xArticleFollowupCalls = createXArticleFollowupCalls({
    sourceCall: execution.call,
    result,
    messages: state.input.messages,
    pendingCalls: input.pendingCalls,
    autoFollowedXArticleUrls: input.autoFollowedXArticleUrls,
    enforceToolAvailability: state.enforceToolAvailability,
    toolDefinitionsByName: state.toolDefinitionsByName,
  });
  if (xArticleFollowupCalls.length > 0) {
    input.pendingCalls.push(
      ...xArticleFollowupCalls.map((followupCall) =>
        enrichToolCallFromDefinition(
          followupCall,
          state.toolDefinitionsByName.get(followupCall.name),
        ),
      ),
    );
  }
  return undefined;
}

function isConcurrencySafePreparedToolCall(execution: PreparedToolCallExecution): boolean {
  return isConcurrencySafeToolCall(execution.call, execution.tool);
}

function isConcurrencySafeToolCall(
  call: ConversationRuntimeModelToolCall,
  tool: ConversationRuntimeModelToolDefinition | undefined,
): boolean {
  return (
    tool?.isConcurrencySafe === true &&
    isReadOnlyToolCall(call, tool) &&
    call.requiresApproval !== true &&
    tool.isDestructive !== true &&
    readMetadataBoolean(call.metadata, "destructive") !== true &&
    readMetadataBoolean(tool.metadata, "destructive") !== true &&
    readMetadataBoolean(call.metadata, "requiresApproval") !== true &&
    readMetadataBoolean(tool.metadata, "requiresApproval") !== true &&
    readMetadataBoolean(call.metadata, "reviewGated") !== true &&
    readMetadataBoolean(tool.metadata, "reviewGated") !== true
  );
}

function isConversationRuntimeAbortRequested(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function recordToolResultEvidence(input: {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly call: ConversationRuntimeModelToolCall;
  readonly result: ConversationRuntimeToolExecutionOutput;
  readonly target: Map<string, ConversationRuntimeMemoryEvidenceRecord>;
  readonly store?: ConversationRuntimeToolEvidenceStore | undefined;
}): ConversationRuntimeMemoryEvidenceRecord {
  const evidence = createToolResultEvidenceRecord({
    turnId: input.turnId,
    ...(readMetadataString(input.result.metadata, "turnRunId") === undefined
      ? {}
      : { turnRunId: readMetadataString(input.result.metadata, "turnRunId") }),
    sessionKey: input.sessionKey,
    toolCallId: input.result.callId,
    toolName: input.result.toolName,
    ok: input.result.ok,
    content: input.result.content,
    ...(input.result.output === undefined ? {} : { output: input.result.output }),
    ...(input.result.error === undefined ? {} : { error: input.result.error }),
    metadata: {
      ...(input.call.metadata ?? {}),
      ...(input.result.metadata ?? {}),
      toolCallArgs: input.call.args,
      readOnly: input.call.readOnly === true,
      requiresApproval: input.call.requiresApproval === true,
    },
  });
  if (!input.target.has(evidence.id)) {
    input.target.set(evidence.id, evidence);
    input.store?.upsertToolResultEvidence({
      evidence,
      content: input.result.content,
    });
  }
  return evidence;
}

function enforceAggregateToolResultBudgetForTurn(input: {
  readonly messages: ConversationRuntimeModelToolMessage[];
  readonly startIndex: number;
  readonly budget?: ConversationRuntimeToolResultBudget;
}): void {
  const maxChars = input.budget?.maxTurnModelVisibleChars;
  if (maxChars === undefined || maxChars <= 0) {
    return;
  }
  const toolMessages = input.messages
    .map((message, index) => ({ message, index }))
    .filter((entry) => entry.index >= input.startIndex && entry.message.role === "tool");
  const totalChars = toolMessages.reduce((sum, entry) => sum + entry.message.content.length, 0);
  if (totalChars <= maxChars) {
    return;
  }
  const previewChars = Math.max(0, input.budget?.previewChars ?? 400);
  for (const entry of toolMessages) {
    const originalContent = entry.message.content;
    const evidenceId = readMetadataString(entry.message.metadata, "toolEvidenceId");
    const preview = truncateModelVisibleToolResultPreview(originalContent, previewChars);
    input.messages[entry.index] = {
      ...entry.message,
      content: [
        "<persisted-output>",
        "aggregate-turn-budget-exceeded",
        `Full tool result preserved as evidence: ${evidenceId ?? "unavailable"}`,
        `Original model-visible chars: ${originalContent.length}`,
        "Preview:",
        preview,
        "</persisted-output>",
      ].join("\n"),
      metadata: {
        ...(entry.message.metadata ?? {}),
        toolResultBudgetReplacement: {
          reason: "aggregate-turn-budget-exceeded",
          evidenceId,
          originalChars: originalContent.length,
          previewChars,
        },
      },
    };
  }
}

function truncateModelVisibleToolResultPreview(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  if (maxChars <= 3) {
    return content.slice(0, maxChars);
  }
  return `${content.slice(0, maxChars - 3)}...`;
}

function createUnavailableToolResultContent(
  toolName: string,
  tools: readonly ConversationRuntimeModelToolDefinition[],
): string {
  const availableTools =
    tools.length === 0 ? "no tools are available" : tools.map((tool) => tool.name).join(", ");
  return `Tool ${toolName} is not available in this turn. Use one of: ${availableTools}.`;
}

function createToolCallReuseKey(call: ConversationRuntimeModelToolCall): string {
  const metadataDiscriminator =
    call.name === "browser_snapshot"
      ? (readMetadataString(call.metadata, "url") ?? readMetadataString(call.metadata, "sourceUrl"))
      : undefined;
  return [
    call.name,
    stableStringifyRuntimeValue(normalizeToolCallArgsForReuse(call.args)),
    metadataDiscriminator ?? "",
  ].join(":");
}

function reuseToolExecutionOutput(
  result: ConversationRuntimeToolExecutionOutput,
  call: ConversationRuntimeModelToolCall,
): ConversationRuntimeToolExecutionOutput {
  return {
    ...result,
    callId: call.id,
    metadata: {
      ...(result.metadata ?? {}),
      reusedFromToolCallId: result.callId,
    },
  };
}

function createModelVisibleToolResult(
  result: ConversationRuntimeToolExecutionOutput,
  call?: ConversationRuntimeModelToolCall,
): {
  readonly content: string;
  readonly learningEvidenceContext?: {
    readonly metadata: ReturnType<typeof createLearningEvidenceContextMetadata>;
  };
} {
  const metadataContent = readMetadataString(result.metadata, "modelVisibleContent");
  if (metadataContent !== undefined) {
    return { content: metadataContent };
  }
  if (isRecord(result.output)) {
    const output = result.output;
    const outputContent =
      readRecordString(output, "model_visible_content") ??
      readRecordString(output, "modelVisibleContent");
    if (outputContent !== undefined) {
      return { content: outputContent };
    }
    const learningEvidence = renderExperienceCandidateModelVisibleContent(result, output, call);
    if (learningEvidence !== undefined) {
      return {
        content: learningEvidence.content,
        learningEvidenceContext: {
          metadata: createLearningEvidenceContextMetadata(learningEvidence),
        },
      };
    }
    const projectedText = readToolResultUserFacingProjectionText(output);
    if (projectedText !== undefined && !result.content.includes(projectedText)) {
      return { content: [result.content, "user_facing_projection:", projectedText].join("\n") };
    }
  }
  return { content: result.content };
}

function createModelVisibleToolResultContent(
  result: ConversationRuntimeToolExecutionOutput,
): string {
  return createModelVisibleToolResult(result).content;
}

function renderExperienceCandidateModelVisibleContent(
  result: ConversationRuntimeToolExecutionOutput,
  output: Readonly<Record<string, unknown>>,
  call?: ConversationRuntimeModelToolCall,
): LearningEvidenceContextBuildResult | undefined {
  if (result.toolName !== "director.experience.candidates.list") {
    return undefined;
  }
  const candidates = readRecordArray(output, "candidates");
  if (candidates.length === 0) {
    return undefined;
  }
  return buildLearningEvidenceContext({
    toolContent: result.content,
    candidates,
    ...(isRecord(output.evidenceDisclosure)
      ? { evidenceDisclosure: output.evidenceDisclosure }
      : {}),
    activeCandidateIds: [
      ...readMetadataStringArray(result.metadata, "candidateIds"),
      ...readRecordStringArray(output, "candidateIds"),
      ...readToolCallArgStringArray(call?.args, "candidateIds"),
    ],
    activeSourceUrls: [
      ...readMetadataStringArray(result.metadata, "sourceUrls"),
      ...readRecordStringArray(output, "sourceUrls"),
      ...readToolCallArgStringArray(call?.args, "sourceUrls"),
    ],
  });
}

function createLearningEvidenceContextMetadata(context: LearningEvidenceContextBuildResult): {
  readonly candidateCount: number;
  readonly selectedCandidateIds: readonly string[];
  readonly omittedCandidateCount: number;
  readonly estimatedTokens: number;
  readonly maxEstimatedTokens: number;
  readonly effectiveTokenBudget: number;
  readonly originalChars: number;
  readonly modelVisibleChars: number;
  readonly wasTruncated: boolean;
} {
  return {
    candidateCount: context.candidateCount,
    selectedCandidateIds: context.selectedCandidateIds,
    omittedCandidateCount: context.omittedCandidateCount,
    estimatedTokens: context.estimatedTokens,
    maxEstimatedTokens: context.maxEstimatedTokens,
    effectiveTokenBudget: context.effectiveTokenBudget,
    originalChars: context.originalChars,
    modelVisibleChars: context.content.length,
    wasTruncated: context.wasTruncated,
  };
}

function readToolResultUserFacingProjectionText(output: unknown): string | undefined {
  if (!isRecord(output) || !isRecord(output.userFacingProjection)) {
    return undefined;
  }
  return readRecordString(output.userFacingProjection, "userText");
}

function createWebExtractArtifactAutoReadCall(input: {
  readonly sourceCall: ConversationRuntimeModelToolCall;
  readonly result: ConversationRuntimeToolExecutionOutput;
  readonly messages: readonly ConversationRuntimeModelToolMessage[];
  readonly pendingCalls: readonly ConversationRuntimeModelToolCall[];
  readonly autoReadFullBodyRefs: Set<string>;
  readonly enforceToolAvailability: boolean;
  readonly toolDefinitionsByName: ReadonlyMap<string, ConversationRuntimeModelToolDefinition>;
}): ConversationRuntimeModelToolCall | undefined {
  if (
    input.sourceCall.name !== "web_extract" ||
    !input.result.ok ||
    !isRecord(input.result.output)
  ) {
    return undefined;
  }
  if (!shouldAutoReadWebExtractArtifact(input.messages)) {
    return undefined;
  }
  if (
    input.enforceToolAvailability &&
    !input.toolDefinitionsByName.has("web_extract_artifact_read")
  ) {
    return undefined;
  }
  const fullBodyRef = readRecordString(input.result.output, "full_body_ref");
  if (
    fullBodyRef === undefined ||
    readRecordBoolean(input.result.output, "body_truncated_for_model") !== true
  ) {
    return undefined;
  }
  if (
    input.autoReadFullBodyRefs.has(fullBodyRef) ||
    input.pendingCalls.some((call) => isWebExtractArtifactReadCallForRef(call, fullBodyRef))
  ) {
    return undefined;
  }
  input.autoReadFullBodyRefs.add(fullBodyRef);
  const fullBodyChars = readMetadataNumber(input.result.output, "full_body_chars");
  return {
    id: `${input.sourceCall.id}-full-body-read`,
    name: "web_extract_artifact_read",
    args: {
      full_body_ref: fullBodyRef,
      max_chars:
        fullBodyChars === undefined
          ? DEFAULT_WEB_EXTRACT_ARTIFACT_READ_MAX_CHARS
          : Math.min(fullBodyChars, DEFAULT_WEB_EXTRACT_ARTIFACT_READ_MAX_CHARS),
      reason:
        "web_extract returned only a model-visible preview; read the saved full body before producing a complete learning or summary answer.",
    },
    readOnly: true,
    metadata: {
      runtimeRequiredFollowup: true,
      sourceToolCallId: input.sourceCall.id,
      capability: "web.extract.artifact.read",
    },
  };
}

function shouldAutoReadWebExtractArtifact(
  messages: readonly ConversationRuntimeModelToolMessage[],
): boolean {
  const latestUserText = [...messages]
    .reverse()
    .find((message) => message.role === "user")
    ?.content.trim();
  if (latestUserText === undefined || latestUserText.length === 0) {
    return false;
  }
  return /完整|全部|全文|详细|细节|学到|学习|学了|总结|方法|步骤|实操|案例|what\s+did|learn(?:ed|ing)?|summari[sz]e|full|complete|detail/iu.test(
    latestUserText,
  );
}

function isWebExtractArtifactReadCallForRef(
  call: ConversationRuntimeModelToolCall,
  fullBodyRef: string,
): boolean {
  return (
    call.name === "web_extract_artifact_read" &&
    readToolCallArgString(call.args, "full_body_ref") === fullBodyRef
  );
}

function createXArticleFollowupCalls(input: {
  readonly sourceCall: ConversationRuntimeModelToolCall;
  readonly result: ConversationRuntimeToolExecutionOutput;
  readonly messages: readonly ConversationRuntimeModelToolMessage[];
  readonly pendingCalls: readonly ConversationRuntimeModelToolCall[];
  readonly autoFollowedXArticleUrls: Set<string>;
  readonly enforceToolAvailability: boolean;
  readonly toolDefinitionsByName: ReadonlyMap<string, ConversationRuntimeModelToolDefinition>;
}): readonly ConversationRuntimeModelToolCall[] {
  if (!input.result.ok || !isXArticleShellCandidateTool(input.result.toolName)) {
    return [];
  }
  const articleUrl = extractXArticleUrlFromToolResult(input.result);
  if (articleUrl === undefined) {
    return [];
  }
  const sourceUrl = readToolResultUrl(input.result);
  if (sourceUrl === articleUrl) {
    return [];
  }
  if (
    input.autoFollowedXArticleUrls.has(articleUrl) ||
    input.pendingCalls.some((call) => isBrowserNavigateCallForUrl(call, articleUrl))
  ) {
    return [];
  }
  if (!shouldUseBrowserForXArticleFollowup(input.messages)) {
    if (
      input.enforceToolAvailability &&
      !input.toolDefinitionsByName.has("director.opencli.invoke")
    ) {
      return [];
    }
    if (input.pendingCalls.some((call) => isOpenCliTwitterArticleCallForUrl(call, articleUrl))) {
      return [];
    }
    input.autoFollowedXArticleUrls.add(articleUrl);
    const slug = articleUrl.replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, "");
    return [
      {
        id: `${input.sourceCall.id}-x-article-opencli-${slug}`,
        name: "director.opencli.invoke",
        args: {
          operationId: "opencli.twitter.article",
          args: {
            "tweet-id": articleUrl,
          },
          reason:
            "X status/page shell exposed a direct X article URL; use OpenCLI read-only article extraction instead of opening a browser window.",
        },
        readOnly: true,
        metadata: {
          runtimeRequiredFollowup: true,
          sourceToolCallId: input.sourceCall.id,
          reason: "x_article_link_shell_opencli_followup",
          sourceUrl: sourceUrl ?? "",
          url: articleUrl,
          operationId: "opencli.twitter.article",
          capability: "external-tools.opencli.invoke-read",
        },
      },
    ];
  }
  if (
    input.enforceToolAvailability &&
    (!input.toolDefinitionsByName.has("browser_navigate") ||
      !input.toolDefinitionsByName.has("browser_snapshot"))
  ) {
    return [];
  }
  if (
    input.result.toolName === "web_extract" &&
    input.pendingCalls.some(
      (call) =>
        call.id !== input.sourceCall.id &&
        call.name === "browser_snapshot" &&
        call.metadata?.runtimeRequiredFollowup !== true,
    )
  ) {
    return [];
  }
  input.autoFollowedXArticleUrls.add(articleUrl);
  const slug = articleUrl.replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, "");
  return [
    {
      id: `${input.sourceCall.id}-x-article-navigate-${slug}`,
      name: "browser_navigate",
      args: {
        url: articleUrl,
        profile: "angel",
        reason:
          "X status/page shell exposed a direct X article URL; open the article before answering the full reread request.",
      },
      readOnly: true,
      metadata: {
        runtimeRequiredFollowup: true,
        sourceToolCallId: input.sourceCall.id,
        reason: "x_article_link_shell_followup",
        sourceUrl: sourceUrl ?? "",
        url: articleUrl,
        capability: "browser.navigate",
      },
    },
    {
      id: `${input.sourceCall.id}-x-article-snapshot-${slug}`,
      name: "browser_snapshot",
      args: {
        full: true,
        mode: "readable",
        max_chars: 16_000,
        urls: true,
        compact: true,
        refs: true,
        reason:
          "Read the X article text after following the article URL exposed by the status/page shell.",
      },
      readOnly: true,
      metadata: {
        runtimeRequiredFollowup: true,
        sourceToolCallId: input.sourceCall.id,
        reason: "x_article_link_shell_followup",
        sourceUrl: sourceUrl ?? "",
        url: articleUrl,
        capability: "browser.snapshot",
      },
    },
  ];
}

function shouldUseBrowserForXArticleFollowup(
  messages: readonly ConversationRuntimeModelToolMessage[],
): boolean {
  const latestUserText = [...messages]
    .reverse()
    .find((message) => message.role === "user")
    ?.content.trim();
  if (latestUserText === undefined || latestUserText.length === 0) {
    return false;
  }
  return (
    /(浏览器|谷歌浏览器|chrome|browser|打开网页|打开页面)/iu.test(latestUserText) &&
    /(打开|访问|进入|看一下|看看|浏览|读取|去看|看呀)/iu.test(latestUserText)
  );
}

function isXArticleShellCandidateTool(toolName: string): boolean {
  return (
    toolName === "web_extract" ||
    toolName === "browser_navigate" ||
    toolName === "browser_snapshot" ||
    toolName === "web_extract_artifact_read"
  );
}

function isBrowserNavigateCallForUrl(call: ConversationRuntimeModelToolCall, url: string): boolean {
  return call.name === "browser_navigate" && readToolCallArgString(call.args, "url") === url;
}

function isOpenCliTwitterArticleCallForUrl(
  call: ConversationRuntimeModelToolCall,
  url: string,
): boolean {
  if (call.name !== "director.opencli.invoke") {
    return false;
  }
  if (readToolCallArgString(call.args, "operationId") !== "opencli.twitter.article") {
    return false;
  }
  const args = isRecord(call.args.args) ? call.args.args : {};
  return (
    readRecordString(args, "tweet-id") === url ||
    readRecordString(args, "tweetUrl") === url ||
    readRecordString(args, "url") === url
  );
}

function extractXArticleUrlFromToolResult(
  result: ConversationRuntimeToolExecutionOutput,
): string | undefined {
  return extractXArticleUrlFromText(collectXArticleToolResultText(result).join("\n"));
}

function collectXArticleToolResultText(
  result: ConversationRuntimeToolExecutionOutput,
): readonly string[] {
  const values = [result.content];
  const modelVisibleContent = readMetadataString(result.metadata, "modelVisibleContent");
  if (modelVisibleContent !== undefined) {
    values.push(modelVisibleContent);
  }
  collectXArticleRecordStrings(result.output, values, 0);
  collectXArticleRecordStrings(result.metadata, values, 0);
  return values;
}

function collectXArticleRecordStrings(value: unknown, target: string[], depth: number): void {
  if (depth > 3) {
    return;
  }
  if (typeof value === "string") {
    target.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectXArticleRecordStrings(item, target, depth + 1);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const item of Object.values(value)) {
    collectXArticleRecordStrings(item, target, depth + 1);
  }
}

function extractXArticleUrlFromText(text: string): string | undefined {
  const compacted = text.replace(/https?:\/\/\s+/giu, "https://");
  const match = /(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/i\/article\/((?:\s*\d){12,})/iu.exec(
    compacted,
  );
  const articleId = match?.[1]?.replace(/\D/gu, "");
  if (articleId === undefined || articleId.length < 12) {
    return undefined;
  }
  return `https://x.com/i/article/${articleId}`;
}

function stableStringifyRuntimeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringifyRuntimeValue).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringifyRuntimeValue(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeToolCallArgsForReuse(
  args: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (isNonExecutionToolCallArg(key)) {
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

function isNonExecutionToolCallArg(key: string): boolean {
  return key === "reason" || key === "rationale" || key === "intent" || key === "comment";
}

function enrichToolCallFromDefinition(
  call: ConversationRuntimeModelToolCall,
  tool: ConversationRuntimeModelToolDefinition | undefined,
): ConversationRuntimeModelToolCall {
  const metadata = mergeMetadata(tool?.metadata, call.metadata);
  const requiresApproval =
    call.requiresApproval === true ||
    metadata.reviewGated === true ||
    metadata.requiresApproval === true ||
    metadata.approvalMode === "operator_approve";
  return {
    ...call,
    ...(tool === undefined && call.readOnly === undefined
      ? {}
      : { readOnly: call.readOnly ?? tool?.readOnly ?? false }),
    ...(requiresApproval ? { requiresApproval: true } : {}),
    ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
  };
}

function createDefaultToolPermissionDecision(
  call: ConversationRuntimeModelToolCall,
  tool: ConversationRuntimeModelToolDefinition | undefined,
): ConversationRuntimeToolPermissionDecision {
  const policy = resolveConversationRuntimeDefaultToolPolicy({
    call,
    ...(tool === undefined ? {} : { tool }),
  });
  if (policy === "allow-readonly-research") {
    return {
      status: "allow",
      reason: "default policy allows read-only research tools",
      metadata: {
        toolName: call.name,
        capability: readMetadataString(call.metadata, "capability"),
        risk: readMetadataString(call.metadata, "risk"),
        defaultToolPolicy: policy,
      },
    };
  }
  if (policy === "deny") {
    return {
      status: "deny",
      reason: "default tool policy denied this call",
      metadata: {
        toolName: call.name,
        capability: readMetadataString(call.metadata, "capability"),
        risk: readMetadataString(call.metadata, "risk"),
        defaultToolPolicy: policy,
      },
    };
  }
  if (call.name === "director.mcp.server.upsert") {
    const serverName = readToolCallArgString(call.args, "serverName") ?? "这个 MCP";
    const transport =
      readToolCallArgString(call.args, "transport") ??
      readToolCallArgString(call.args, "type") ??
      (readToolCallArgString(call.args, "url") === undefined ? "stdio" : "http");
    return {
      status: "ask",
      title: `确认 MCP：${serverName}`,
      summary: `安装/更新 MCP：${serverName}（${transport}）。会写入 .mcp.json，并在确认后测试连接。`,
      reason: "MCP configuration changes require operator approval",
      actionLabels: ["确认", "拒绝"],
      metadata: {
        toolName: call.name,
        capability: readMetadataString(call.metadata, "capability"),
        risk: readMetadataString(call.metadata, "risk"),
        defaultToolPolicy: policy,
        serverName,
        transport,
      },
    };
  }
  return {
    status: "ask",
    title: `确认使用 ${tool?.description ? call.name : call.name}`,
    summary: `${call.name} 会修改系统状态或调用受控能力，需要确认后再执行。`,
    reason: "tool definition requires approval",
    actionLabels: ["确认", "拒绝"],
    metadata: {
      toolName: call.name,
      capability: readMetadataString(call.metadata, "capability"),
      risk: readMetadataString(call.metadata, "risk"),
      defaultToolPolicy: policy,
    },
  };
}

function readToolCallArgString(
  args: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function createAgentOsPolicyVerdictFromPermission(
  permission: ConversationRuntimeToolPermissionDecision,
): AgentOsPolicyVerdict {
  return {
    verdict:
      permission.status === "allow"
        ? "allow"
        : permission.status === "ask"
          ? "needs_approval"
          : "deny",
    reason: permission.reason ?? `conversation-runtime permission ${permission.status}`,
    decidedAt: new Date().toISOString(),
    policyId: "conversation-runtime.tool-permission",
  };
}

function createDefaultAgentOsSandboxPreflight(
  call: ConversationRuntimeModelToolCall,
  tool: ConversationRuntimeModelToolDefinition | undefined,
): AgentOsSandboxPreflight {
  if (isReadOnlyToolCall(call, tool)) {
    return {
      verdict: "allow",
      sandboxMode: "readonly",
      checkedAt: new Date().toISOString(),
      providerId: "conversation-runtime",
      reason: "Read-only tools may execute with the default readonly Agent OS sandbox preflight.",
    };
  }
  return {
    verdict: "deny",
    sandboxMode: "disabled",
    checkedAt: new Date().toISOString(),
    providerId: "conversation-runtime",
    reason: "Agent OS sandbox preflight is required before executing mutating tools",
  };
}

function normalizeAgentOsSandboxPreflight(
  preflight: AgentOsSandboxPreflight,
): AgentOsSandboxPreflight {
  if (isAgentOsSandboxPreflight(preflight)) {
    return preflight;
  }
  return {
    verdict: "deny",
    sandboxMode: "disabled",
    checkedAt: new Date().toISOString(),
    providerId: "conversation-runtime",
    reason: "Agent OS sandbox preflight returned an invalid result",
  };
}

function createSandboxBlockedPermissionDecision(
  call: ConversationRuntimeModelToolCall,
  preflight: AgentOsSandboxPreflight,
): ConversationRuntimeToolPermissionDecision {
  return {
    status: "deny",
    reason: preflight.reason ?? "Agent OS sandbox preflight blocked this tool call",
    metadata: {
      toolName: call.name,
      capability: readMetadataString(call.metadata, "capability"),
      risk: readMetadataString(call.metadata, "risk"),
      agentOsSandboxPreflight: preflight,
    },
  };
}

function isReadOnlyToolCall(
  call: ConversationRuntimeModelToolCall,
  tool: ConversationRuntimeModelToolDefinition | undefined,
): boolean {
  return call.readOnly ?? tool?.readOnly ?? false;
}

function mergeMetadata(
  first: Readonly<Record<string, unknown>> | undefined,
  second: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
  return {
    ...(first ?? {}),
    ...(second ?? {}),
  };
}

function readMetadataString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function readMetadataNonEmptyString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = readMetadataString(metadata, key)?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function readMetadataStringArray(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): readonly string[] {
  const value = metadata?.[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function readRecordStringArray(
  record: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function readToolCallArgStringArray(
  args: Readonly<Record<string, unknown>> | undefined,
  key: string,
): readonly string[] {
  const value = args?.[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function createEmptyToolResultFallback(
  events: readonly ConversationRuntimeModelToolLoopEvent[],
): string | undefined {
  const toolResults = events
    .filter(
      (event): event is Extract<ConversationRuntimeModelToolLoopEvent, { kind: "tool.result" }> =>
        event.kind === "tool.result",
    )
    .map((event) => event.result);
  if (toolResults.length === 0 || !toolResults.every(isEmptySearchLikeToolResult)) {
    return createBrowserFailureToolResultFallback(toolResults);
  }
  return [
    "我刚才没有拿到可靠结果。",
    "这不是你的问题，是搜索源这次返回为空或信息不稳定。",
    "下一步我会换搜索源、换关键词，或用浏览器打开可靠来源继续查。",
  ].join("\n");
}

function createBrowserFailureToolResultFallback(
  toolResults: readonly ConversationRuntimeToolExecutionOutput[],
): string | undefined {
  const browserResults = toolResults.filter((result) => result.toolName.startsWith("browser_"));
  const successfulNonBrowserResults = toolResults.filter(
    (result) => !result.toolName.startsWith("browser_") && result.ok === true,
  );
  if (successfulNonBrowserResults.length > 0) {
    return undefined;
  }
  if (browserResults.length === 0 || !browserResults.every((result) => result.ok === false)) {
    return undefined;
  }
  const latest = browserResults.at(-1);
  const url = latest === undefined ? undefined : readToolResultUrl(latest);
  const nextActions = latest === undefined ? [] : readToolResultNextActions(latest);
  return [
    "我没能用浏览器打开这个页面或读取到可信正文。",
    ...(url === undefined ? [] : [`链接：${url}`]),
    "这不是模型没配置，而是浏览器通道或目标网页这次没有返回可用内容。",
    nextActions.length > 0
      ? `下一步：${nextActions.join("；")}。`
      : "下一步可以确认桌面浏览器已连接，或换成可公开访问的链接。",
  ].join("\n");
}

function isEmptySearchLikeToolResult(result: ConversationRuntimeToolExecutionOutput): boolean {
  if (result.toolName !== "web_search" && result.toolName !== "x_search") {
    return false;
  }
  const count = readToolResultCount(result);
  if (count !== undefined) {
    return count === 0;
  }
  return /(^|\n)(result_count|candidate_count)\s*:\s*0(\n|$)/iu.test(result.content);
}

function readToolResultCount(result: ConversationRuntimeToolExecutionOutput): number | undefined {
  const metadataCount = readMetadataNumber(result.metadata, "result_count");
  if (metadataCount !== undefined) {
    return metadataCount;
  }
  const output = isRecord(result.output) ? result.output : undefined;
  const outputCount =
    readMetadataNumber(output, "result_count") ?? readMetadataNumber(output, "resultCount");
  if (outputCount !== undefined) {
    return outputCount;
  }
  const match = /(^|\n)result_count\s*:\s*(\d+)/iu.exec(result.content);
  return match?.[2] === undefined ? undefined : Number(match[2]);
}

function readToolResultUrl(result: ConversationRuntimeToolExecutionOutput): string | undefined {
  const output = isRecord(result.output) ? result.output : undefined;
  const outputUrl = readMetadataString(output, "url");
  if (outputUrl !== undefined) {
    return outputUrl;
  }
  const match = /(^|\n)url\s*:\s*(https?:\/\/\S+)/iu.exec(result.content);
  return match?.[2];
}

function readToolResultProvider(
  result: ConversationRuntimeToolExecutionOutput | undefined,
): string | undefined {
  if (result === undefined) {
    return undefined;
  }
  return (
    readMetadataString(result.metadata, "provider") ??
    (isRecord(result.output) ? readRecordString(result.output, "provider") : undefined) ??
    readContentField(result.content, "provider")
  );
}

function readToolResultNextActions(
  result: ConversationRuntimeToolExecutionOutput | undefined,
): string[] {
  if (result === undefined) {
    return [];
  }
  const metadataActions = readStringList(result.metadata?.next_actions);
  if (metadataActions.length > 0) {
    return metadataActions;
  }
  if (isRecord(result.output)) {
    const outputActions = readStringList(result.output.next_actions);
    if (outputActions.length > 0) {
      return outputActions;
    }
  }
  const line = readContentField(result.content, "next_actions");
  return line === undefined
    ? []
    : line
        .split(/[;；]/u)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function readContentField(content: string, key: string): string | undefined {
  const pattern = new RegExp(`(^|\\n)${key}\\s*:\\s*([^\\n]+)`, "iu");
  return pattern.exec(content)?.[2]?.trim();
}

function readMetadataNumber(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | undefined {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readRecordNumber(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNestedRecordNumber(
  record: Readonly<Record<string, unknown>> | undefined,
  parentKey: string,
  childKey: string,
): number | undefined {
  const parent = record?.[parentKey];
  return isRecord(parent) ? readRecordNumber(parent, childKey) : undefined;
}

function readNestedRecordString(
  record: Readonly<Record<string, unknown>> | undefined,
  parentKey: string,
  childKey: string,
): string | undefined {
  const parent = record?.[parentKey];
  return isRecord(parent) ? readRecordString(parent, childKey) : undefined;
}

function readRecordString(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readRecordBoolean(
  record: Readonly<Record<string, unknown>>,
  key: string,
): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function readRecordArray(
  record: Readonly<Record<string, unknown>>,
  key: string,
): readonly Readonly<Record<string, unknown>>[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Readonly<Record<string, unknown>> => isRecord(item));
}

function readMetadataBoolean(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): boolean | undefined {
  const value = metadata?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
