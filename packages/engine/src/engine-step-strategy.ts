import {
  type RuntimeDegradeSurface,
  type TaskState,
  createRuntimeDegradeSurface,
} from "@hotflow/contracts";
import type {
  ModelGenerateResult,
  ModelMessage,
  ModelRunRequest,
  ModelToolDefinition,
} from "@hotflow/models";
import type { ToolExecutionResult } from "@hotflow/tools";

import type { StepLoopIteration, StepLoopIterationResult, StepLoopStrategy } from "./step-loop.js";
import type { EngineToolDispatcher, ModelLoopContext, PromptArtifacts } from "./types.js";

export type EngineStepJournalEventType =
  | "step.context_built"
  | "step.model_output"
  | "step.tools_planned"
  | "step.tool_result"
  | "step.final_output";

export type EngineReasoningAction = "call-tools" | "finalize";
export type EngineTurnBranch =
  | "normal"
  | "policy-denied"
  | "approval-required"
  | "tool-degraded"
  | "tool-failed";

const ESTIMATED_CHARS_PER_TOKEN = 4;
const TOOL_RESULT_REPLAY_BUDGET_RATIO = 0.8;
const MIN_TOOL_RESULT_REPLAY_MESSAGE_CHARS = 128;
const MAX_TOOL_RESULT_REPLAY_TOTAL_CHARS = 8_192;

export interface EngineReasoningDecision {
  readonly action: EngineReasoningAction;
  readonly rationale: string;
  readonly plannedToolCount: number;
}

export interface EngineStepJournalEvent {
  readonly eventType: EngineStepJournalEventType;
  readonly payload: unknown;
}

export interface EngineStepLoopState {
  readonly output: string;
  readonly toolResults: readonly ToolExecutionResult[];
  readonly runtimeDegradations: readonly RuntimeDegradeSurface[];
  readonly lastReasoningDecision?: EngineReasoningDecision;
  readonly lastStepEvents: readonly EngineStepJournalEvent[];
  readonly lastTurnBranch: EngineTurnBranch;
}

export interface EngineStepStrategyDeps {
  readonly context: ModelLoopContext;
  readonly dispatcher: EngineToolDispatcher;
  readonly taskState: () => TaskState;
  readonly userText: string;
  readonly onContextBuilt?: (input: {
    stepIndex: number;
    event: EngineStepJournalEvent;
    output: string;
    taskState: TaskState;
  }) => Promise<void> | void;
  readonly modelRuntimeGenerate: (input: {
    providerId: ModelRunRequest["providerId"];
    request: ModelRunRequest["request"];
  }) => Promise<ModelGenerateResult>;
  readonly buildPrompt: (
    context: ModelLoopContext,
    userText: string,
    taskState: TaskState,
    toolResults: readonly ToolExecutionResult[],
    runtimeDegradations: readonly RuntimeDegradeSurface[],
    availableTools: readonly ModelToolDefinition[],
  ) => PromptArtifacts;
  readonly executeToolCalls: (
    context: ModelLoopContext,
    modelOutput: ModelGenerateResult,
    dispatcher: EngineToolDispatcher,
  ) => Promise<ToolExecutionResult[]>;
  readonly decideReasoning?: (modelOutput: ModelGenerateResult) => EngineReasoningDecision;
}

export class EngineModelRuntimeFailure extends Error {
  public readonly originalError: unknown;
  public readonly runtimeDegradations: readonly RuntimeDegradeSurface[];

  public constructor(error: unknown, runtimeDegradations: readonly RuntimeDegradeSurface[] = []) {
    super("Engine model runtime failed.");
    this.name = "EngineModelRuntimeFailure";
    this.originalError = error;
    this.runtimeDegradations = runtimeDegradations;
  }
}

export class EngineStepStrategy implements StepLoopStrategy<EngineStepLoopState> {
  public constructor(private readonly deps: EngineStepStrategyDeps) {}

  public async runStep(
    iteration: StepLoopIteration<EngineStepLoopState>,
  ): Promise<StepLoopIterationResult<EngineStepLoopState>> {
    const taskState = this.deps.taskState();
    const toolSchemas = this.deps.dispatcher.getSchemas?.() ?? [];
    const prompt = this.deps.buildPrompt(
      this.deps.context,
      this.deps.userText,
      taskState,
      iteration.state.toolResults,
      iteration.state.runtimeDegradations,
      toolSchemas,
    );
    const promptRuntimeDegradations =
      prompt.runtimeDegradations ?? iteration.state.runtimeDegradations;
    const contextBuiltEvent: EngineStepJournalEvent = {
      eventType: "step.context_built",
      payload: {
        staticSections: prompt.staticSections,
        staticSectionIds: prompt.staticSectionIds,
        dynamicSections: prompt.dynamicSections,
        dynamicSectionIds: prompt.dynamicSectionIds,
        omittedSections: prompt.omittedSections,
        omittedSectionIds: prompt.omittedSectionIds,
        usedTokens: prompt.usedTokens,
        remainingTokens: prompt.remainingTokens,
        runtimeDegradations: prompt.runtimeDegradations ?? [],
      },
    };
    await this.deps.onContextBuilt?.({
      stepIndex: iteration.stepIndex,
      event: contextBuiltEvent,
      output: iteration.state.output,
      taskState,
    });
    let modelOutput: ModelGenerateResult;
    let runtimeDegradations = promptRuntimeDegradations;
    try {
      const continuation = buildToolContinuationMessages(iteration.state, {
        remainingTokens: prompt.remainingTokens,
      });
      runtimeDegradations = mergeRuntimeDegradations(
        promptRuntimeDegradations,
        continuation.runtimeDegradations,
      );
      modelOutput = await this.deps.modelRuntimeGenerate({
        providerId: this.deps.context.providerId,
        request: {
          model: this.deps.context.model,
          messages: [
            { role: "system", content: prompt.staticPrompt || "You are Hotflow." },
            { role: "user", content: prompt.dynamicPrompt || this.deps.userText },
            ...continuation.messages,
          ],
          ...(toolSchemas.length > 0 ? { tools: [...toolSchemas] } : {}),
        },
      });
    } catch (error) {
      throw new EngineModelRuntimeFailure(error, runtimeDegradations);
    }
    const reasoningDecision =
      this.deps.decideReasoning?.(modelOutput) ?? decideReasoningFromModelOutput(modelOutput);
    const modelOutputEvent: EngineStepJournalEvent = {
      eventType: "step.model_output",
      payload: {
        text: modelOutput.text,
        toolCallCount: modelOutput.toolCalls?.length ?? 0,
        reasoning: reasoningDecision,
      },
    };

    const output = modelOutput.text;
    if (reasoningDecision.action !== "call-tools") {
      return {
        state: {
          output,
          toolResults: iteration.state.toolResults,
          runtimeDegradations,
          lastReasoningDecision: reasoningDecision,
          lastTurnBranch: iteration.state.lastTurnBranch,
          lastStepEvents: [
            contextBuiltEvent,
            modelOutputEvent,
            {
              eventType: "step.final_output",
              payload: {
                text: output,
              },
            },
          ],
        },
        continueLoop: false,
      };
    }

    const stepResults = await this.deps.executeToolCalls(
      this.deps.context,
      modelOutput,
      this.deps.dispatcher,
    );
    const turnBranch = classifyTurnBranch(stepResults);
    const toolResultEvent: EngineStepJournalEvent = {
      eventType: "step.tool_result",
      payload: {
        turnBranch,
        results: stepResults.map((result) => ({
          toolCallId: result.toolCallId,
          toolName: result.toolName,
          ok: result.ok,
          resolution: result.resolution ?? "executed",
        })),
      },
    };

    if (
      turnBranch === "policy-denied" ||
      turnBranch === "approval-required" ||
      turnBranch === "tool-failed"
    ) {
      const terminalOutput = renderTerminalBranchOutput(turnBranch, stepResults);
      return {
        state: {
          output: terminalOutput,
          toolResults: [...iteration.state.toolResults, ...stepResults],
          runtimeDegradations,
          lastReasoningDecision: reasoningDecision,
          lastTurnBranch: turnBranch,
          lastStepEvents: [
            contextBuiltEvent,
            modelOutputEvent,
            {
              eventType: "step.tools_planned",
              payload: {
                toolCalls:
                  modelOutput.toolCalls?.map((toolCall) => ({
                    id: toolCall.id,
                    name: toolCall.name,
                    args: safeParseToolArgs(toolCall.argumentsJson),
                  })) ?? [],
              },
            },
            toolResultEvent,
            {
              eventType: "step.final_output",
              payload: {
                text: terminalOutput,
                turnBranch,
              },
            },
          ],
        },
        continueLoop: false,
      };
    }

    return {
      state: {
        output,
        toolResults: [...iteration.state.toolResults, ...stepResults],
        runtimeDegradations,
        lastReasoningDecision: reasoningDecision,
        lastTurnBranch: turnBranch,
        lastStepEvents: [
          contextBuiltEvent,
          modelOutputEvent,
          {
            eventType: "step.tools_planned",
            payload: {
              toolCalls:
                modelOutput.toolCalls?.map((toolCall) => ({
                  id: toolCall.id,
                  name: toolCall.name,
                  args: safeParseToolArgs(toolCall.argumentsJson),
                })) ?? [],
            },
          },
          toolResultEvent,
        ],
      },
      continueLoop: true,
    };
  }
}

function decideReasoningFromModelOutput(modelOutput: ModelGenerateResult): EngineReasoningDecision {
  const plannedToolCount = modelOutput.toolCalls?.length ?? 0;
  if (plannedToolCount > 0) {
    return {
      action: "call-tools",
      rationale: "model requested tool calls",
      plannedToolCount,
    };
  }

  return {
    action: "finalize",
    rationale: "model returned final output without tool calls",
    plannedToolCount: 0,
  };
}

function classifyTurnBranch(results: readonly ToolExecutionResult[]): EngineTurnBranch {
  if (
    results.some(
      (result) => result.resolution === "denied" || result.policyDecision?.verdict === "deny",
    )
  ) {
    return "policy-denied";
  }
  if (
    results.some(
      (result) =>
        result.resolution === "approval_required" || result.policyDecision?.verdict === "ask",
    )
  ) {
    return "approval-required";
  }
  if (
    results.some(
      (result) => result.resolution === "failed" || (!result.ok && result.resolution === undefined),
    )
  ) {
    return "tool-failed";
  }
  if (
    results.some(
      (result) =>
        result.resolution === "degraded" ||
        result.degradation !== undefined ||
        result.policyDecision?.verdict === "degrade",
    )
  ) {
    return "tool-degraded";
  }
  return "normal";
}

function renderTerminalBranchOutput(
  turnBranch: EngineTurnBranch,
  results: readonly ToolExecutionResult[],
): string {
  const primary = results.find((result) => !result.ok) ?? results[0];
  const toolName = primary?.toolName ?? "unknown-tool";
  const reason = primary?.error ?? primary?.policyDecision?.reason;
  if (turnBranch === "policy-denied") {
    return `Stopped: tool "${toolName}" was denied by policy.${reason ? ` ${reason}` : ""}`.trim();
  }
  if (turnBranch === "approval-required") {
    return `Stopped: tool "${toolName}" requires approval before execution.${reason ? ` ${reason}` : ""}`.trim();
  }
  return `Stopped: tool "${toolName}" failed.${reason ? ` ${reason}` : ""}`.trim();
}

type PlannedToolCallRecord = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

type StepToolResultRecord = {
  toolCallId: string;
  toolName: string;
  ok: boolean;
  resolution?: string;
};

type ToolContinuationMessagesBuildResult = {
  messages: readonly ModelMessage[];
  runtimeDegradations: readonly RuntimeDegradeSurface[];
};

type SerializedToolResultMessage = {
  content: string;
  truncated: boolean;
  originalChars?: number;
};

function buildToolContinuationMessages(
  state: EngineStepLoopState,
  input: { remainingTokens?: number } = {},
): ToolContinuationMessagesBuildResult {
  const plannedToolCalls = readPlannedToolCalls(state.lastStepEvents);
  const stepToolResults = readStepToolResults(state.lastStepEvents);
  if (plannedToolCalls.length === 0 || stepToolResults.length === 0) {
    return {
      messages: [],
      runtimeDegradations: [],
    };
  }

  const resultById = new Map(state.toolResults.map((result) => [result.toolCallId, result]));
  const replayBudgetChars = resolveToolResultReplayBudgetChars(
    input.remainingTokens,
    stepToolResults.length,
  );
  let remainingReplayChars = replayBudgetChars;
  const runtimeDegradations: RuntimeDegradeSurface[] = [];

  const messages: ModelMessage[] = [
    {
      role: "assistant",
      content: state.output,
      toolCalls: plannedToolCalls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        argumentsJson: safeSerializeToolArgs(toolCall.args),
      })),
    },
  ];

  for (const [index, summary] of stepToolResults.entries()) {
    const result = resultById.get(summary.toolCallId);
    const resultsLeft = stepToolResults.length - index;
    const contentBudgetChars = resolveToolResultMessageBudgetChars(
      remainingReplayChars,
      resultsLeft,
    );
    const serialized = serializeToolResultForMessage(result, summary, contentBudgetChars);
    remainingReplayChars = Math.max(0, remainingReplayChars - serialized.content.length);
    messages.push({
      role: "tool",
      content: serialized.content,
      name: summary.toolName,
      toolCallId: summary.toolCallId,
    });
    if (serialized.truncated) {
      runtimeDegradations.push(createToolResultReplayBudgetDegradation(summary, serialized));
    }
  }

  return {
    messages,
    runtimeDegradations,
  };
}

function mergeRuntimeDegradations(
  left: readonly RuntimeDegradeSurface[],
  right: readonly RuntimeDegradeSurface[],
): readonly RuntimeDegradeSurface[] {
  const merged = new Map<string, RuntimeDegradeSurface>();

  for (const degradation of [...left, ...right]) {
    merged.set(createRuntimeDegradationKey(degradation), degradation);
  }

  return [...merged.values()];
}

function createRuntimeDegradationKey(degradation: RuntimeDegradeSurface): string {
  return JSON.stringify({
    stage: degradation.stage,
    category: degradation.category,
    severity: degradation.severity,
    reason: degradation.reason,
    message: degradation.message,
    recoverable: degradation.recoverable,
    metadata: degradation.metadata ?? null,
  });
}

function resolveToolResultReplayBudgetChars(
  remainingTokens: number | undefined,
  resultCount: number,
): number {
  if (resultCount <= 0) {
    return 0;
  }

  const derivedChars = Math.max(
    0,
    Math.floor(
      (remainingTokens ?? 0) * TOOL_RESULT_REPLAY_BUDGET_RATIO * ESTIMATED_CHARS_PER_TOKEN,
    ),
  );
  const minimumChars = resultCount * MIN_TOOL_RESULT_REPLAY_MESSAGE_CHARS;

  return Math.max(minimumChars, Math.min(MAX_TOOL_RESULT_REPLAY_TOTAL_CHARS, derivedChars));
}

function resolveToolResultMessageBudgetChars(
  remainingReplayChars: number,
  resultsLeft: number,
): number {
  if (resultsLeft <= 0) {
    return MIN_TOOL_RESULT_REPLAY_MESSAGE_CHARS;
  }

  return Math.max(
    MIN_TOOL_RESULT_REPLAY_MESSAGE_CHARS,
    Math.floor(Math.max(0, remainingReplayChars) / resultsLeft),
  );
}

function readPlannedToolCalls(
  events: readonly EngineStepJournalEvent[],
): readonly PlannedToolCallRecord[] {
  const payload = events.find((event) => event.eventType === "step.tools_planned")?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const toolCalls = (payload as { toolCalls?: unknown }).toolCalls;
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls.flatMap((toolCall) => {
    if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall)) {
      return [];
    }
    const candidate = toolCall as {
      id?: unknown;
      name?: unknown;
      args?: unknown;
    };
    if (typeof candidate.id !== "string" || typeof candidate.name !== "string") {
      return [];
    }
    return [
      {
        id: candidate.id,
        name: candidate.name,
        args:
          candidate.args && typeof candidate.args === "object" && !Array.isArray(candidate.args)
            ? (candidate.args as Record<string, unknown>)
            : {},
      },
    ];
  });
}

function readStepToolResults(
  events: readonly EngineStepJournalEvent[],
): readonly StepToolResultRecord[] {
  const payload = events.find((event) => event.eventType === "step.tool_result")?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) {
    return [];
  }

  return results.flatMap((result) => {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      return [];
    }
    const candidate = result as {
      toolCallId?: unknown;
      toolName?: unknown;
      ok?: unknown;
      resolution?: unknown;
    };
    if (
      typeof candidate.toolCallId !== "string" ||
      typeof candidate.toolName !== "string" ||
      typeof candidate.ok !== "boolean"
    ) {
      return [];
    }
    return [
      {
        toolCallId: candidate.toolCallId,
        toolName: candidate.toolName,
        ok: candidate.ok,
        ...(typeof candidate.resolution === "string" ? { resolution: candidate.resolution } : {}),
      },
    ];
  });
}

function safeSerializeToolArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args);
  } catch {
    return "{}";
  }
}

function serializeToolResultForMessage(
  result: ToolExecutionResult | undefined,
  summary: StepToolResultRecord,
  maxChars = Number.POSITIVE_INFINITY,
): SerializedToolResultMessage {
  const payload: Record<string, unknown> = {
    ok: result?.ok ?? summary.ok,
    ...(summary.resolution ? { resolution: summary.resolution } : {}),
    ...(result?.output !== undefined ? { output: result.output } : {}),
    ...(result?.error !== undefined ? { error: result.error } : {}),
  };

  const serialized = trySerializeJson(payload);
  if (serialized !== undefined && serialized.length <= maxChars) {
    return {
      content: serialized,
      truncated: false,
    };
  }

  return serializeTruncatedToolResultForMessage(result, summary, maxChars, serialized?.length);
}

function serializeTruncatedToolResultForMessage(
  result: ToolExecutionResult | undefined,
  summary: StepToolResultRecord,
  maxChars: number,
  originalChars?: number,
): SerializedToolResultMessage {
  const previewKey =
    result?.error !== undefined
      ? "errorPreview"
      : result?.output !== undefined
        ? "outputPreview"
        : undefined;
  const previewSource =
    previewKey === "errorPreview"
      ? serializeValueForPreview(result?.error)
      : previewKey === "outputPreview"
        ? serializeValueForPreview(result?.output)
        : "";

  let previewChars = Math.max(
    0,
    Math.min(
      previewSource.length,
      Math.max(0, maxChars - MIN_TOOL_RESULT_REPLAY_MESSAGE_CHARS / 2),
    ),
  );

  while (previewChars >= 0) {
    const compactPayload: Record<string, unknown> = {
      ok: result?.ok ?? summary.ok,
      ...(summary.resolution ? { resolution: summary.resolution } : {}),
      truncated: true,
      ...(originalChars === undefined ? {} : { originalChars }),
      ...(previewKey !== undefined && previewChars > 0
        ? { [previewKey]: truncateText(previewSource, previewChars) }
        : {}),
    };
    const serialized = trySerializeJson(compactPayload);
    if (serialized !== undefined && serialized.length <= maxChars) {
      return {
        content: serialized,
        truncated: true,
        ...(originalChars === undefined ? {} : { originalChars }),
      };
    }
    if (previewChars === 0) {
      break;
    }
    const overflow = serialized === undefined ? previewChars : serialized.length - maxChars;
    previewChars = Math.max(0, previewChars - Math.max(overflow, 16));
  }

  return {
    content: JSON.stringify({
      ok: result?.ok ?? summary.ok,
      ...(summary.resolution ? { resolution: summary.resolution } : {}),
      truncated: true,
    }),
    truncated: true,
    ...(originalChars === undefined ? {} : { originalChars }),
  };
}

function createToolResultReplayBudgetDegradation(
  summary: StepToolResultRecord,
  serialized: SerializedToolResultMessage,
): RuntimeDegradeSurface {
  return createRuntimeDegradeSurface({
    stage: "runtime",
    category: "runtime",
    severity: "minor",
    reason: "context-pressure",
    message: `Tool result replay for "${summary.toolName}" was truncated to fit the remaining context budget.`,
    recoverable: true,
    metadata: {
      toolCallId: summary.toolCallId,
      toolName: summary.toolName,
      replayChars: serialized.content.length,
      ...(serialized.originalChars === undefined
        ? {}
        : { originalChars: serialized.originalChars }),
    },
  });
}

function trySerializeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function serializeValueForPreview(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  const serialized = trySerializeJson(value);
  if (typeof serialized === "string") {
    return serialized;
  }

  try {
    return String(value);
  } catch {
    return "[unserializable-tool-result]";
  }
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 3) {
    return value.slice(0, maxChars);
  }
  return `${value.slice(0, maxChars - 3)}...`;
}

function safeParseToolArgs(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}
