import {
  type ContextToolResult,
  MultiStepTurnContext,
  type PromptSection,
  type ToolRuntimeGuidanceSummary,
  type ToolRuntimePromptObservation,
  type TurnResumePromptState,
  createRuntimePromptSections,
  renderTaskStatePrompt,
  resolveWorkingMemoryPromptState,
  summarizeRuntimeDegradationSurfaces,
  summarizeToolRuntimeGuidanceObservations,
} from "@hotflow/context";
import {
  type TaskItem,
  type TaskItemStatus,
  type TaskPriority,
  type TaskState,
  createContractError,
  createRuntimeDegradeSurface,
  createRuntimeErrorSurface,
  createTaskEvent,
  decodeTaskEvent,
} from "@hotflow/contracts";
import {
  type MemoryUpsertInput,
  classifyUserMemoryInput,
  toMemoryUpsertInput,
} from "@hotflow/memory-core";
import {
  type ModelGenerateResult,
  type ModelToolDefinition,
  toModelProviderRuntimeFailureSurface,
} from "@hotflow/models";
import { createLogger } from "@hotflow/observability";
import type { JsonObject, JsonValue } from "@hotflow/sessions";
import { TaskBoard } from "@hotflow/tasks-core";
import {
  type ToolExecutionResult,
  createToolCallPlannedJournalEvent,
  createToolResultJournalEvent,
} from "@hotflow/tools";

import {
  EngineModelRuntimeFailure,
  type EngineStepJournalEvent,
  type EngineStepLoopState,
  EngineStepStrategy,
  type EngineTurnBranch,
} from "./engine-step-strategy.js";
import { EngineRunFailure } from "./run-failure.js";
import { StepLoop, type StepLoopRunResult } from "./step-loop.js";
import { resolveTurnReasoningSelection } from "./turn-reasoning.js";
import { asStreamSessionStore, createTurnStreamRecorder } from "./turn-stream-recorder.js";

import type {
  EngineDependencies,
  ModelLoopContext,
  PersistedTaskItem,
  PersistedTaskState,
  PersistedTurnState,
  PromptArtifacts,
  TurnInput,
  TurnResult,
} from "./types.js";

const DEFAULT_TOKEN_BUDGET = 8_000;
const DEFAULT_MAX_STEPS = 4;
const WORKING_MEMORY_PROMPT_CACHE_KEY = "working-memory-prompt-state";

function createAssistantOutputMemoryInput(
  sessionId: string,
  output: string,
): MemoryUpsertInput | undefined {
  const decision = classifyUserMemoryInput(output);
  if (decision.retention === "none") {
    return undefined;
  }

  const quarantined = decision.retention === "quarantine";
  return {
    content: quarantined ? decision.redactedContent : output,
    scope: {
      sessionId,
      namespace: quarantined ? "memory:quarantine" : "assistant-output",
    },
    tags: quarantined
      ? ["memory:assistant-output", "memory:quarantine", "memory:safety"]
      : ["memory:working", "memory:assistant-output", "memory:system-output"],
    metadata: {
      memoryAdmission: {
        category: quarantined ? decision.category : "conversation",
        retention: quarantined ? "quarantine" : "working",
        confidence: quarantined ? decision.confidence : 1,
        score: quarantined ? decision.score : 1,
        reason: quarantined ? "system:assistant-output-quarantine" : "system:assistant-output",
        safety: decision.safety,
      },
    },
  };
}

export class PhaseOneEngine {
  private readonly logger;
  private readonly contextAssembler: EngineDependencies["contextAssembler"];
  private readonly modelRuntime;
  private readonly sessionStore: EngineDependencies["sessionStore"];
  private readonly memory;
  private readonly createDispatcher;
  private readonly promptSectionContributors;
  private readonly workspaceRoot: string;

  public constructor(deps: EngineDependencies) {
    this.contextAssembler = deps.contextAssembler;
    this.createDispatcher = deps.createDispatcher;
    this.memory = deps.memory;
    this.modelRuntime = deps.modelRuntime;
    this.promptSectionContributors = deps.promptSectionContributors;
    this.sessionStore = deps.sessionStore;
    this.workspaceRoot = deps.workspaceRoot;
    this.logger = deps.logger ?? createLogger({ fields: { module: "engine" } });
  }

  public async runTurn(input: TurnInput): Promise<TurnResult> {
    const session = input.sessionId
      ? (this.sessionStore.getSession(input.sessionId) ??
        this.sessionStore.createSession({ sessionId: input.sessionId }))
      : this.sessionStore.createSession();
    const turnId = input.turnId ?? `turn_${Date.now()}`;
    const recovered = this.sessionStore.recover<PersistedTurnState>(session.sessionId, {
      initialState: { tasks: { items: [] } },
      reducer: persistTurnStateReducer,
    });
    let initialStepIndex = 0;
    let recoveredState = recovered.state;
    let resumedFromRecovery = false;
    let recoveredToolResults: ToolExecutionResult[] = [];
    let turnResumeState: TurnResumePromptState | undefined;
    const stepRuntimeStore = asStepRuntimeStore(this.sessionStore);
    const streamRuntimeStore = asStreamSessionStore(this.sessionStore);
    if (stepRuntimeStore) {
      const recoveredStep = stepRuntimeStore.recoverStep<PersistedTurnState>(session.sessionId, {
        turnId,
        initialState: recovered.state,
        reducer: persistTurnStateReducer,
      });
      recoveredState = recoveredStep.state;
      const resumeAction = readResumeAction(recoveredStep);
      const replayWindow = readReplayWindow(recoveredStep);
      resumedFromRecovery =
        resumeAction === "continue-current-step" || resumeAction === "start-next-step";
      initialStepIndex = resumedFromRecovery ? recoveredStep.nextStepIndex : 0;
      recoveredToolResults = readRecoveredToolResults(recoveredStep.journal, turnId);
      turnResumeState = resumedFromRecovery
        ? {
            resumed: true,
            resumeAction,
            nextStepIndex: recoveredStep.nextStepIndex,
            ...(replayWindow === undefined ? {} : { replayWindow }),
            recoveredToolResults: recoveredToolResults.length,
            ...(recoveredStep.lastStepEvent?.eventType === undefined
              ? {}
              : { lastStepEventType: recoveredStep.lastStepEvent.eventType }),
          }
        : undefined;

      this.logger.info("evaluated step recovery state", {
        sessionId: session.sessionId,
        turnId,
        resumeAction,
        nextStepIndex: recoveredStep.nextStepIndex,
        replayWindow,
        lastStepEventType: recoveredStep.lastStepEvent?.eventType,
      });

      if (resumeAction === "turn-complete") {
        const output = recoveredState.lastAssistantOutput ?? "";
        const recoveredReasoning = resolveTurnReasoningSelection(
          createTurnReasoningSelectionInput(input),
        );
        return {
          sessionId: session.sessionId,
          output,
          taskState: taskBoardFromState(recoveredState).snapshot(),
          toolResults: recoveredToolResults,
          ...(recoveredReasoning === undefined
            ? {}
            : { reasoningDecision: recoveredReasoning.decision }),
        };
      }
    }

    const taskBoard = taskBoardFromState(recoveredState);
    const dispatcher = this.createDispatcher(taskBoard);
    const turnContext = new MultiStepTurnContext(this.contextAssembler);
    turnContext.setUserInput(input.userText);
    const loopContext: ModelLoopContext = {
      turnId,
      providerId: input.providerId,
      model: input.model,
      sessionId: session.sessionId,
      tokenBudget: input.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
      maxSteps: input.maxSteps ?? DEFAULT_MAX_STEPS,
    };
    const streamRecorder = createTurnStreamRecorder({
      sessionId: loopContext.sessionId,
      turnId: loopContext.turnId,
      sessionStore: streamRuntimeStore,
    });
    const turnReasoning = resolveTurnReasoningSelection(createTurnReasoningSelectionInput(input));
    let recoveryResumePending = resumedFromRecovery;

    if (!resumedFromRecovery) {
      await this.appendJournal(
        loopContext.sessionId,
        "user.input",
        { text: input.userText },
        loopContext.turnId,
      );
      this.writeUserMemory(loopContext.sessionId, input.userText);
      if (turnReasoning) {
        await this.appendJournal(
          loopContext.sessionId,
          "turn.reasoning_strategy_selected",
          {
            strategy: turnReasoning.decision.strategy,
            confidence: turnReasoning.decision.confidence,
            rationale: turnReasoning.decision.rationale,
            ...(turnReasoning.decision.suggestedAction === undefined
              ? {}
              : {
                  suggestedAction: serializeReasoningAction(turnReasoning.decision.suggestedAction),
                }),
          },
          loopContext.turnId,
        );
      }
    } else {
      this.logger.info("resuming interrupted turn from step checkpoint", {
        sessionId: loopContext.sessionId,
        turnId: loopContext.turnId,
        nextStepIndex: initialStepIndex,
      });
    }

    if (turnReasoning) {
      await streamRecorder.recordReasoning({
        decision: turnReasoning.decision,
        summary: turnReasoning.summary,
      });
    }

    const loop = new StepLoop<EngineStepLoopState>(
      new EngineStepStrategy({
        context: loopContext,
        dispatcher,
        taskState: () => taskBoard.snapshot(),
        userText: input.userText,
        onContextBuilt: async ({ stepIndex, event, output, taskState }) => {
          await this.recordStepRuntime(
            loopContext.sessionId,
            loopContext.turnId,
            stepIndex,
            [event],
            toPersistedTurnState(taskState, output),
            stepRuntimeStore,
          );
          await streamRecorder.beforeModelCall(
            recoveryResumePending ? { reason: "resuming interrupted turn" } : undefined,
          );
          recoveryResumePending = false;
        },
        modelRuntimeGenerate: (request) => this.modelRuntime.generate(request),
        buildPrompt: (
          context,
          userText,
          taskState,
          toolResults,
          runtimeDegradations,
          availableTools,
        ) =>
          this.buildPrompt(
            context,
            userText,
            taskState,
            toolResults,
            runtimeDegradations,
            availableTools,
            turnContext,
            session.metadata,
            turnResumeState,
            turnReasoning?.promptSection,
          ),
        executeToolCalls: (context, modelOutput, stepDispatcher) =>
          this.executeToolCalls(context, modelOutput, stepDispatcher),
      }),
      {
        onStepCompleted: async ({ stepIndex, result }) => {
          await this.recordStepRuntime(
            loopContext.sessionId,
            loopContext.turnId,
            stepIndex,
            omitPrePersistedContextBuilt(
              result.state.lastStepEvents,
              stepRuntimeStore !== undefined,
            ),
            toPersistedTurnState(taskBoard.snapshot(), result.state.output),
            stepRuntimeStore,
          );
          await streamRecorder.recordStep({
            continueLoop: result.continueLoop,
            events: result.state.lastStepEvents,
            turnBranch: result.state.lastTurnBranch,
          });
        },
      },
    );
    const loopResult = await (async (): Promise<StepLoopRunResult<EngineStepLoopState>> => {
      try {
        return await loop.run({
          initialState: {
            output: recoveredState.lastAssistantOutput ?? "",
            toolResults: resumedFromRecovery ? recoveredToolResults : [],
            runtimeDegradations: [],
            lastStepEvents: [],
            lastTurnBranch: "normal",
          },
          maxSteps: loopContext.maxSteps,
          startStepIndex: initialStepIndex,
        });
      } catch (error) {
        if (error instanceof EngineModelRuntimeFailure) {
          const streamFailure = toEngineModelRuntimeFailure(
            error.originalError,
            loopContext.providerId,
          );
          await streamRecorder.recordFailure(streamFailure);
          if (error.runtimeDegradations.length > 0) {
            await this.recordRuntimeDegradations(
              loopContext.sessionId,
              loopContext.turnId,
              error.runtimeDegradations,
            );
          }
          const failure = await this.recordModelRuntimeFailure(
            loopContext.sessionId,
            loopContext.turnId,
            loopContext.providerId,
            error.originalError,
          );
          await this.persistLatestTurnObservation(
            loopContext.sessionId,
            session.metadata,
            createLatestTurnObservation({
              turnId: loopContext.turnId,
              providerId: loopContext.providerId,
              model: loopContext.model,
              runtimeStatus: "failed",
              turnBranch: "model-runtime-failed",
              finishReason: "failed",
              lastStepEventType: "step.context_built",
              resumeAction: "continue-current-step",
              nextStepIndex: initialStepIndex,
              ...(turnReasoning === undefined
                ? {}
                : { reasoning: summarizeLatestTurnReasoning(turnReasoning.decision) }),
              ...(error.runtimeDegradations.length === 0
                ? {}
                : {
                    runtimeDegradationSummaries: summarizeRuntimeDegradationSurfaces(
                      error.runtimeDegradations,
                    ),
                  }),
            }),
          );
          throw new EngineRunFailure(
            {
              sessionId: loopContext.sessionId,
              turnId: loopContext.turnId,
              model: loopContext.model,
              selectedProviderId: loopContext.providerId,
              failure,
            },
            error.originalError,
          );
        }
        throw error;
      }
    })();
    const output = loopResult.state.output;
    const toolResults = [...loopResult.state.toolResults];
    const toolRuntimeObservations = createToolRuntimePromptObservations(toolResults);
    const toolRuntimeGuidance = summarizeToolRuntimeGuidanceObservations(toolRuntimeObservations);
    const runtimeDegradations = [...loopResult.state.runtimeDegradations];
    const runtimeDegradationSummaries = summarizeRuntimeDegradationSurfaces(runtimeDegradations);
    const turnBranch = loopResult.state.lastTurnBranch;
    await streamRecorder.completeTurn({
      finishReason: loopResult.stopReason === "max-steps" ? "length" : "stop",
    });

    await this.recordRuntimeDegradations(
      loopContext.sessionId,
      loopContext.turnId,
      runtimeDegradations,
    );
    await this.recordTurnBranch(loopContext.sessionId, loopContext.turnId, turnBranch, toolResults);
    await this.appendJournal(
      loopContext.sessionId,
      "assistant.output",
      { text: output },
      loopContext.turnId,
    );
    const handoffSourceToSeq = recovered.lastAppliedSeq + 1 + loopResult.completedSteps;
    this.createTurnHandoffSummary({
      sessionId: loopContext.sessionId,
      turnId: loopContext.turnId,
      userText: input.userText,
      output,
      toolResults,
      completedSteps: loopResult.completedSteps,
      sourceFromSeq: recovered.lastAppliedSeq + 1,
      sourceToSeq: handoffSourceToSeq,
      lastSummarizedSeq: handoffSourceToSeq,
      stopReason: loopResult.stopReason,
      turnBranch,
    });
    this.sessionStore.createCheckpoint(loopContext.sessionId, {
      state: toPersistedTurnState(taskBoard.snapshot(), output),
    });
    const assistantOutputMemory = createAssistantOutputMemoryInput(loopContext.sessionId, output);
    if (assistantOutputMemory !== undefined) {
      this.memory.writeLayer0(assistantOutputMemory);
    }
    const lastStepEventType = loopResult.state.lastStepEvents.at(-1)?.eventType;
    const latestTurnResumeHint =
      loopResult.stopReason !== "max-steps"
        ? undefined
        : inferLatestTurnResumeHint({
            startStepIndex: initialStepIndex,
            completedSteps: loopResult.completedSteps,
            ...(lastStepEventType === undefined ? {} : { lastStepEventType }),
          });
    await this.persistLatestTurnObservation(
      loopContext.sessionId,
      session.metadata,
      createLatestTurnObservation({
        turnId: loopContext.turnId,
        providerId: loopContext.providerId,
        model: loopContext.model,
        runtimeStatus: deriveLatestTurnRuntimeStatus(toolResults, runtimeDegradations),
        turnBranch,
        finishReason: loopResult.stopReason === "max-steps" ? "length" : "stop",
        completedSteps: loopResult.completedSteps,
        ...(lastStepEventType === undefined ? {} : { lastStepEventType }),
        ...(latestTurnResumeHint === undefined ? {} : latestTurnResumeHint),
        toolCount: toolResults.length,
        ...(toolResults.length === 0
          ? {}
          : { toolOutcomes: summarizeLatestTurnToolOutcomes(toolResults) }),
        ...(turnReasoning === undefined
          ? {}
          : { reasoning: summarizeLatestTurnReasoning(turnReasoning.decision) }),
        ...(toolRuntimeGuidance === undefined ? {} : { toolRuntimeGuidance }),
        ...(runtimeDegradationSummaries.length === 0 ? {} : { runtimeDegradationSummaries }),
      }),
    );

    this.logger.info("turn completed", {
      sessionId: loopContext.sessionId,
      turnId: loopContext.turnId,
      toolCalls: toolResults.length,
      stepStopReason: loopResult.stopReason,
      stepsCompleted: loopResult.completedSteps,
      turnBranch,
      lastStepEventType,
    });

    return {
      sessionId: loopContext.sessionId,
      output,
      taskState: taskBoard.snapshot(),
      toolResults,
      ...(turnReasoning === undefined ? {} : { reasoningDecision: turnReasoning.decision }),
    };
  }

  private writeUserMemory(sessionId: string, userText: string): void {
    const decision = classifyUserMemoryInput(userText);
    const entry = toMemoryUpsertInput(decision, userText, { sessionId });
    if (entry === undefined) {
      return;
    }

    if (decision.retention === "user" && this.memory.writeLayer1 !== undefined) {
      this.memory.writeLayer1(entry);
      return;
    }

    this.memory.writeLayer0(entry);
  }

  private buildPrompt(
    context: ModelLoopContext,
    userText: string,
    taskState: TaskState,
    toolResults: readonly ToolExecutionResult[],
    inheritedRuntimeDegradations: readonly PersistedRuntimeDegradation[],
    availableTools: readonly ModelToolDefinition[],
    turnContext: MultiStepTurnContext,
    sessionMetadata: JsonObject,
    turnResumeState: TurnResumePromptState | undefined,
    turnReasoningSection: PromptSection | undefined,
  ): PromptArtifacts {
    const contextToolResults = toolResults.map((result) => toContextToolResult(result));
    const taskStatePrompt = renderTaskStatePrompt(taskState);
    const workingMemoryPromptState = turnContext.resolveCachedTurnValue(
      WORKING_MEMORY_PROMPT_CACHE_KEY,
      createWorkingMemoryPromptFingerprint(context.sessionId, userText),
      () =>
        resolveWorkingMemoryPromptState({
          recallWorkingMemory: this.memory.recallWorkingMemory.bind(this.memory),
          options: {
            blockId: "working-memory",
            scope: { sessionId: context.sessionId },
            query: userText,
            limit: 3,
            minScore: 0.1,
          },
        }),
    );
    const runtimeDegradations = dedupeRuntimeDegradations([
      ...inheritedRuntimeDegradations,
      ...workingMemoryPromptState.runtimeDegradations,
    ]);
    turnContext.replaceState({
      userInput: userText,
      ...(taskStatePrompt === undefined ? {} : { taskState: taskStatePrompt }),
      toolResults: contextToolResults,
      ...(workingMemoryPromptState.recallBlock === undefined
        ? {}
        : { recallBlock: workingMemoryPromptState.recallBlock }),
      customDynamicSections: createRuntimePromptSections({
        sessionMetadata,
        currentTurnId: context.turnId,
        ...(turnResumeState === undefined ? {} : { turnResumeState }),
        runtimeDegradations,
        turnContext,
        toolObservations: createToolRuntimePromptObservations(toolResults),
        ...(turnReasoningSection === undefined ? {} : { extraSections: [turnReasoningSection] }),
        ...(this.promptSectionContributors === undefined
          ? {}
          : { contributors: this.promptSectionContributors }),
        contributorInput: {
          userInput: userText,
          taskState,
          availableTools: availableTools.map((tool) => tool.name),
          availableToolsets: [
            ...new Set(availableTools.map((tool) => tool.toolset).filter(isString)),
          ],
          toolResults: contextToolResults,
        },
      }),
    });

    const assembled = turnContext.rebuild({
      tokenBudget: context.tokenBudget,
    });
    const budget = assembled.budget;

    return {
      prompt: assembled.prompt,
      staticPrompt: assembled.cacheBoundary.staticPrompt,
      dynamicPrompt: assembled.cacheBoundary.dynamicPrompt,
      staticSections: assembled.cacheBoundary.staticSections.map((section) =>
        summarizePromptSection(section),
      ),
      staticSectionIds: assembled.cacheBoundary.staticSections.map((section) => section.id),
      dynamicSections: assembled.cacheBoundary.dynamicSections.map((section) =>
        summarizePromptSection(section),
      ),
      dynamicSectionIds: assembled.cacheBoundary.dynamicSections.map((section) => section.id),
      omittedSections: budget.omitted.map((section) => summarizePromptSection(section)),
      omittedSectionIds: budget.omitted.map((section) => section.id),
      usedTokens: budget.usedTokens,
      remainingTokens: budget.remainingTokens,
      ...(runtimeDegradations.length > 0 ? { runtimeDegradations } : {}),
    };
  }

  private async executeToolCalls(
    context: ModelLoopContext,
    modelOutput: ModelGenerateResult,
    dispatcher: ReturnType<EngineDependencies["createDispatcher"]>,
  ): Promise<ToolExecutionResult[]> {
    const toolResults: ToolExecutionResult[] = [];
    const dispatcherOwnsJournalClosure = dispatcher.managesJournalClosure === true;

    for (const toolCall of modelOutput.toolCalls ?? []) {
      const args = safeParseArgs(toolCall.argumentsJson);
      if (!dispatcherOwnsJournalClosure) {
        const plannedEvent = createToolCallPlannedJournalEvent({
          id: toolCall.id,
          name: toolCall.name,
          args,
        });
        await this.appendJournal(
          context.sessionId,
          plannedEvent.eventType,
          plannedEvent.payload,
          context.turnId,
        );
      }
      const result = await dispatcher.dispatch(
        {
          id: toolCall.id,
          name: toolCall.name,
          args,
        },
        {
          sessionId: context.sessionId,
          turnId: context.turnId,
          workspaceRoot: this.workspaceRoot,
        },
      );

      toolResults.push(result);
      if (!dispatcherOwnsJournalClosure) {
        const resultEvent = createToolResultJournalEvent(result);
        await this.appendJournal(
          context.sessionId,
          resultEvent.eventType,
          resultEvent.payload,
          context.turnId,
        );
      }

      if (result.toolName === "tasks.todo_write" && result.output) {
        await this.appendJournal(
          context.sessionId,
          "tasks.todo_write",
          encodeTaskTodoWritePayload(result.output),
          context.turnId,
        );
      }
    }

    return toolResults;
  }

  private async appendJournal(
    sessionId: string,
    eventType: string,
    payload: JsonValue,
    turnId?: string,
  ): Promise<void> {
    this.sessionStore.appendJournal(sessionId, {
      eventType,
      payload: payload as never,
      ...(turnId ? { turnId } : {}),
    });
  }

  private createTurnHandoffSummary(input: {
    readonly sessionId: string;
    readonly turnId: string;
    readonly userText: string;
    readonly output: string;
    readonly toolResults: readonly ToolExecutionResult[];
    readonly completedSteps: number;
    readonly sourceFromSeq: number;
    readonly sourceToSeq: number;
    readonly lastSummarizedSeq: number;
    readonly stopReason: StepLoopRunResult<EngineStepLoopState>["stopReason"];
    readonly turnBranch: EngineTurnBranch;
  }): void {
    const createHandoffSummary = this.sessionStore.createHandoffSummary;
    if (createHandoffSummary === undefined) {
      return;
    }

    createHandoffSummary.call(this.sessionStore, input.sessionId, {
      lastSummarizedSeq: input.lastSummarizedSeq,
      sourceFromSeq: input.sourceFromSeq,
      sourceToSeq: input.sourceToSeq,
      latestTurnId: input.turnId,
      currentState: `Turn completed with ${input.toolResults.length} tool result(s).`,
      task: truncateHandoffText(input.userText, 240),
      filesAndFunctions: [],
      workflow: [
        `Model loop completed after ${input.completedSteps} step(s).`,
        `Stop reason: ${input.stopReason}.`,
        `Turn branch: ${input.turnBranch}.`,
      ],
      errorsAndCorrections: input.toolResults
        .filter((result) => !result.ok || result.error !== undefined)
        .map((result) =>
          truncateHandoffText(
            `${result.toolName}: ${result.error ?? result.resolution ?? "not ok"}`,
            240,
          ),
        ),
      keyResults: [truncateHandoffText(input.output, 240)],
      worklog: [
        `Recorded assistant output for turn ${input.turnId}.`,
        `Recorded ${input.toolResults.length} tool result(s).`,
      ],
      nextActions: ["Use durable transcript or journal for exact replay."],
    });
  }

  private recordRuntimeEvidence(
    sessionId: string,
    kind: "runtime.degraded" | "runtime.failed",
    payload: JsonValue,
    turnId?: string,
  ): void {
    this.sessionStore.recordRuntimeEvidence(sessionId, {
      kind,
      payload,
      channel: "audit",
      ...(turnId ? { turnId } : {}),
    });
  }

  private async recordStepRuntime(
    sessionId: string,
    turnId: string,
    stepIndex: number,
    events: readonly EngineStepJournalEvent[],
    checkpointState: PersistedTurnState,
    stepRuntimeStore: StepRuntimeSessionStore | undefined,
  ): Promise<void> {
    if (!stepRuntimeStore) {
      return;
    }

    for (const event of events) {
      stepRuntimeStore.appendStepJournal(sessionId, {
        turnId,
        stepIndex,
        eventType: event.eventType,
        payload: toJsonSafe(event.payload),
      });
      stepRuntimeStore.createStepCheckpoint(sessionId, {
        turnId,
        stepIndex,
        eventType: event.eventType,
        state: checkpointState,
      });
    }
  }

  private async recordTurnBranch(
    sessionId: string,
    turnId: string,
    turnBranch: EngineTurnBranch,
    toolResults: readonly ToolExecutionResult[],
  ): Promise<void> {
    if (turnBranch === "normal") {
      return;
    }

    await this.appendJournal(
      sessionId,
      "turn.branch",
      {
        turnBranch,
        toolCount: toolResults.length,
        failingTools: toolResults
          .filter((result) => !result.ok || result.resolution === "degraded")
          .map((result) => ({
            toolName: result.toolName,
            resolution: result.resolution ?? "executed",
            error: result.error ?? null,
          })),
      },
      turnId,
    );

    if (turnBranch === "tool-degraded") {
      const degradation =
        toolResults.find((result) => result.degradation !== undefined)?.degradation ??
        createRuntimeDegradeSurface({
          stage: "tool",
          category: "tool",
          severity: "minor",
          reason: "fallback",
          message: "Tool execution degraded but the turn continued.",
          recoverable: true,
        });
      await this.appendJournal(sessionId, "runtime.degraded", toJsonSafe(degradation), turnId);
      this.recordRuntimeEvidence(sessionId, "runtime.degraded", toJsonSafe(degradation), turnId);
      return;
    }

    if (turnBranch === "tool-failed") {
      const failedTool = toolResults.find(
        (result) =>
          result.resolution === "failed" || (!result.ok && result.resolution === undefined),
      );
      const failure = createRuntimeErrorSurface({
        stage: "tool",
        error: createContractError({
          code: "TOOL_FAILURE",
          message: failedTool?.error ?? `Tool "${failedTool?.toolName ?? "unknown-tool"}" failed.`,
          retryable: false,
          metadata: {
            toolName: failedTool?.toolName ?? "unknown-tool",
            toolCallId: failedTool?.toolCallId ?? "unknown-tool-call",
          },
        }),
        kind: "tool",
        action: "abort",
        recoverable: false,
      });
      await this.appendJournal(sessionId, "runtime.failed", toJsonSafe(failure), turnId);
      this.recordRuntimeEvidence(sessionId, "runtime.failed", toJsonSafe(failure), turnId);
    }
  }

  private async recordRuntimeDegradations(
    sessionId: string,
    turnId: string,
    runtimeDegradations: readonly PersistedRuntimeDegradation[],
  ): Promise<void> {
    for (const degradation of runtimeDegradations) {
      const payload = toJsonSafe(degradation);
      await this.appendJournal(sessionId, "runtime.degraded", payload, turnId);
      this.recordRuntimeEvidence(sessionId, "runtime.degraded", payload, turnId);
    }
  }

  private async recordModelRuntimeFailure(
    sessionId: string,
    turnId: string,
    providerId: string,
    error: unknown,
  ): Promise<ReturnType<typeof toEngineModelRuntimeFailure>> {
    const failure = toEngineModelRuntimeFailure(error, providerId);
    const payload = toJsonSafe(failure);
    await this.appendJournal(sessionId, "runtime.failed", payload, turnId);
    this.recordRuntimeEvidence(sessionId, "runtime.failed", payload, turnId);

    const log = failure.failureClass === "transient" ? this.logger.warn : this.logger.error;
    log.call(this.logger, "model runtime failed", {
      sessionId,
      turnId,
      providerId: failure.providerId,
      providerStage: failure.providerStage,
      providerCode: failure.providerCode,
      action: failure.action,
      recoverable: failure.recoverable,
      retryable: failure.retryable,
      ...(failure.statusCode === undefined ? {} : { statusCode: failure.statusCode }),
    });

    return failure;
  }

  private async persistLatestTurnObservation(
    sessionId: string,
    sessionMetadata: JsonObject,
    observation: PersistedLatestTurnObservation,
  ): Promise<void> {
    try {
      this.sessionStore.updateMetadata(
        sessionId,
        withLatestTurnObservationMetadata(sessionMetadata, observation),
      );
    } catch (error) {
      this.logger.warn("failed to persist latest turn observation", {
        sessionId,
        turnId: observation.turnId,
        runtimeStatus: observation.runtimeStatus,
        turnBranch: observation.turnBranch,
        error: normalizeErrorMessage(error),
      });
    }
  }
}

function createTurnReasoningSelectionInput(input: TurnInput): {
  readonly reasoningStrategy?: TurnInput["reasoningStrategy"];
  readonly estimatedComplexity?: TurnInput["estimatedComplexity"];
  readonly requiresTools?: TurnInput["requiresTools"];
  readonly latencyBudgetMs?: TurnInput["latencyBudgetMs"];
} {
  return {
    ...(input.reasoningStrategy === undefined
      ? {}
      : { reasoningStrategy: input.reasoningStrategy }),
    ...(input.estimatedComplexity === undefined
      ? {}
      : { estimatedComplexity: input.estimatedComplexity }),
    ...(input.requiresTools === undefined ? {} : { requiresTools: input.requiresTools }),
    ...(input.latencyBudgetMs === undefined ? {} : { latencyBudgetMs: input.latencyBudgetMs }),
  };
}

function serializeReasoningAction(action: {
  readonly type: string;
  readonly summary?: string;
  readonly preferredModelId?: string;
  readonly stream?: boolean;
  readonly toolName?: string;
  readonly finishReason?: string;
  readonly errorCode?: string;
  readonly retryable?: boolean;
  readonly resumeAtMs?: number;
  readonly assignee?: string;
  readonly delegatedTaskKind?: string;
}): JsonObject {
  return {
    type: action.type,
    ...(action.summary === undefined ? {} : { summary: action.summary }),
    ...(action.preferredModelId === undefined ? {} : { preferredModelId: action.preferredModelId }),
    ...(action.stream === undefined ? {} : { stream: action.stream }),
    ...(action.toolName === undefined ? {} : { toolName: action.toolName }),
    ...(action.finishReason === undefined ? {} : { finishReason: action.finishReason }),
    ...(action.errorCode === undefined ? {} : { errorCode: action.errorCode }),
    ...(action.retryable === undefined ? {} : { retryable: action.retryable }),
    ...(action.resumeAtMs === undefined ? {} : { resumeAtMs: action.resumeAtMs }),
    ...(action.assignee === undefined ? {} : { assignee: action.assignee }),
    ...(action.delegatedTaskKind === undefined
      ? {}
      : { delegatedTaskKind: action.delegatedTaskKind }),
  };
}

function summarizeLatestTurnReasoning(decision: {
  readonly strategy: "react" | "plan-execute";
  readonly confidence: number;
  readonly rationale: string;
  readonly suggestedAction?: {
    readonly type: string;
  };
}): PersistedLatestTurnReasoning {
  return {
    strategy: decision.strategy,
    confidence: decision.confidence,
    rationale: decision.rationale,
    ...(decision.suggestedAction?.type === undefined
      ? {}
      : { suggestedAction: decision.suggestedAction.type }),
  };
}

function readRecoveredToolResults(
  journal: readonly {
    eventType: string;
    turnId: string | null;
    payload: JsonValue;
  }[],
  turnId: string,
): ToolExecutionResult[] {
  const toolResults: ToolExecutionResult[] = [];

  for (const [index, entry] of journal.entries()) {
    if (entry.turnId !== turnId || entry.eventType !== "tool.result") {
      continue;
    }

    const recovered = toRecoveredToolResult(entry.payload, index);
    if (recovered) {
      toolResults.push(recovered);
    }
  }

  return toolResults;
}

function safeParseArgs(argumentsJson: string): Record<string, unknown> {
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

function createToolObservationMetadataPreview(
  metadata: ToolExecutionResult["metadata"],
): Readonly<Record<string, string | number | boolean>> | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const previewEntries: Array<readonly [string, string | number | boolean]> = [];
  const availability = summarizeToolAvailabilityReason(metadata.availabilityReason);
  if (availability !== undefined) {
    previewEntries.push(["availability", availability]);
  }

  const missingEnvVars = summarizePreviewList(metadata.missingEnvVars);
  if (missingEnvVars !== undefined) {
    previewEntries.push(["env", missingEnvVars]);
  }

  const timeoutMs = readFiniteNumber(metadata.timeoutMs);
  if (timeoutMs !== undefined) {
    previewEntries.push(["timeout", `${timeoutMs}ms`]);
  }

  if (typeof metadata.validationError === "string" && metadata.validationError.trim().length > 0) {
    previewEntries.push(["validation", "invalid-input"]);
  }

  const blockedCapabilities = summarizePreviewList(metadata.blockedCapabilities);
  if (blockedCapabilities !== undefined) {
    previewEntries.push(["blocked", blockedCapabilities]);
  }

  const degradedCapabilities = summarizePreviewList(metadata.degradedCapabilities);
  if (degradedCapabilities !== undefined) {
    previewEntries.push(["degraded", degradedCapabilities]);
  }

  const approvalStatus = readStringValue(metadata.approvalStatus);
  if (approvalStatus !== undefined) {
    previewEntries.push(["approval", approvalStatus]);
  }

  const riskLevel = readStringValue(metadata.riskLevel);
  if (riskLevel !== undefined) {
    previewEntries.push(["risk", riskLevel]);
  }

  const requiredAtOrAbove = readStringValue(metadata.requiredAtOrAbove);
  if (requiredAtOrAbove !== undefined) {
    previewEntries.push(["threshold", requiredAtOrAbove]);
  }

  if (previewEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(previewEntries);
}

function createToolRuntimePromptObservations(
  toolResults: readonly ToolExecutionResult[],
): ToolRuntimePromptObservation[] {
  return toolResults.map((result) => {
    const metadataPreview = createToolObservationMetadataPreview(result.metadata);
    return {
      toolName: result.toolName,
      ok: result.ok,
      ...(result.resolution === undefined ? {} : { resolution: result.resolution }),
      ...(result.error === undefined ? {} : { error: result.error }),
      ...(metadataPreview === undefined ? {} : { metadataPreview }),
      ...(result.degradation === undefined ? {} : { degradation: result.degradation }),
      ...(result.policyDecision === undefined
        ? {}
        : {
            policyDecision: {
              verdict: result.policyDecision.verdict,
              reason: result.policyDecision.reason,
            },
          }),
    };
  });
}

function summarizeToolAvailabilityReason(value: unknown): string | undefined {
  switch (value) {
    case "missing_required_env":
      return "missing-env";
    case "check_unavailable":
      return "check-unavailable";
    case "check_error":
      return "check-error";
    default:
      return undefined;
  }
}

function summarizePreviewList(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
  if (items.length === 0) {
    return undefined;
  }

  const uniqueItems = [...new Set(items)];
  const previewedItems = uniqueItems.slice(0, 2);
  return uniqueItems.length > previewedItems.length
    ? `${previewedItems.join(",")}(+${uniqueItems.length - previewedItems.length})`
    : previewedItems.join(",");
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function createWorkingMemoryPromptFingerprint(sessionId: string, userText: string): string {
  return JSON.stringify({
    sessionId,
    query: userText,
    limit: 3,
    minScore: 0.1,
  });
}

function summarizePromptSection(section: PromptSection): {
  readonly id: string;
  readonly cacheBucket: PromptSection["cacheBucket"];
  readonly owner?: PromptSection["owner"];
  readonly priority?: number;
  readonly metadataKeys?: readonly string[];
  readonly metadataPreview?: Readonly<Record<string, string | number | boolean>>;
} {
  const metadataKeys = section.metadata === undefined ? undefined : Object.keys(section.metadata);
  const metadataPreview = createPromptSectionMetadataPreview(section.metadata);
  return {
    id: section.id,
    cacheBucket: section.cacheBucket,
    ...(section.owner === undefined ? {} : { owner: section.owner }),
    ...(section.priority === undefined ? {} : { priority: section.priority }),
    ...(metadataKeys === undefined || metadataKeys.length === 0 ? {} : { metadataKeys }),
    ...(metadataPreview === undefined ? {} : { metadataPreview }),
  };
}

function createPromptSectionMetadataPreview(
  metadata: PromptSection["metadata"],
): Readonly<Record<string, string | number | boolean>> | undefined {
  if (!metadata) {
    return undefined;
  }

  const previewEntries: Array<readonly [string, string | number | boolean]> = [];
  for (const [key, value] of Object.entries(metadata)) {
    const previewValue = coercePromptSectionMetadataPreviewValue(value);
    if (previewValue !== undefined) {
      previewEntries.push([key, previewValue]);
    }
  }

  if (previewEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(previewEntries);
}

function coercePromptSectionMetadataPreviewValue(
  value: unknown,
): string | number | boolean | undefined {
  if (typeof value === "string") {
    return value.length <= 80 ? value : `${value.slice(0, 77)}...`;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function toRecoveredToolResult(payload: JsonValue, index: number): ToolExecutionResult | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const source = payload as Record<string, JsonValue>;
  if (typeof source.toolName !== "string" || typeof source.ok !== "boolean") {
    return null;
  }

  const toolCallId =
    typeof source.toolCallId === "string" && source.toolCallId.length > 0
      ? source.toolCallId
      : `recovered-tool-result-${index + 1}`;
  const error = typeof source.error === "string" ? source.error : undefined;

  return {
    toolCallId,
    toolName: source.toolName,
    ok: source.ok,
    ...(Object.hasOwn(source, "output") ? { output: source.output } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

function toContextToolResult(result: ToolExecutionResult): ContextToolResult {
  return {
    id: result.toolCallId,
    toolName: result.toolName,
    ok: result.ok,
    ...(result.output === undefined ? {} : { output: result.output }),
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}

function truncateHandoffText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

type PersistedRuntimeDegradation = ReturnType<typeof createRuntimeDegradeSurface>;
type PersistedLatestTurnToolOutcomes = {
  total: number;
  executed: number;
  denied: number;
  approvalRequired: number;
  degraded: number;
  failed: number;
  missing: number;
  unknown: number;
};
type PersistedLatestTurnReasoning = {
  strategy: "react" | "plan-execute";
  confidence: number;
  rationale: string;
  suggestedAction?: string;
};
type PersistedLatestTurnResumeAction = "continue-current-step" | "start-next-step";
type PersistedLatestTurnResumeHint = {
  resumeAction: PersistedLatestTurnResumeAction;
  nextStepIndex: number;
};
type PersistedLatestTurnObservation = {
  turnId: string;
  providerId: string;
  model: string;
  runtimeStatus: "healthy" | "degraded" | "blocked" | "failed";
  turnBranch: string;
  finishReason: "stop" | "length" | "failed";
  completedSteps?: number;
  lastStepEventType?: string;
  resumeAction?: PersistedLatestTurnResumeAction;
  nextStepIndex?: number;
  toolCount?: number;
  toolOutcomes?: PersistedLatestTurnToolOutcomes;
  reasoning?: PersistedLatestTurnReasoning;
  toolRuntimeGuidance?: ToolRuntimeGuidanceSummary;
  runtimeDegradationSummaries?: readonly string[];
  updatedAtMs: number;
};

function createLatestTurnObservation(
  input: Omit<PersistedLatestTurnObservation, "updatedAtMs">,
): PersistedLatestTurnObservation {
  return {
    ...input,
    updatedAtMs: Date.now(),
  };
}

function toEngineModelRuntimeFailure(error: unknown, providerId: string) {
  const failure = toModelProviderRuntimeFailureSurface(error);
  const resolvedProviderId = failure.providerId === "unknown" ? providerId : failure.providerId;
  const stage = failure.providerStage === "stream" ? "stream" : "model";

  return {
    ...failure,
    providerId: resolvedProviderId,
    error: createContractError({
      code: failure.error.code,
      message: failure.error.message,
      retryable: failure.error.retryable,
      kind: failure.kind,
      defaultAction: failure.action,
      metadata: {
        ...(failure.error.metadata ?? {}),
        stage,
        kind: failure.kind,
        action: failure.action,
        recoverable: failure.recoverable,
        providerId: resolvedProviderId,
        providerStage: failure.providerStage,
        providerCode: failure.providerCode,
        retryable: failure.retryable,
        ...(failure.statusCode === undefined ? {} : { statusCode: failure.statusCode }),
        ...(failure.operatorVisible === undefined
          ? {}
          : { operatorVisible: failure.operatorVisible }),
      },
      cause: error,
    }),
  };
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function dedupeRuntimeDegradations(
  runtimeDegradations: readonly PersistedRuntimeDegradation[],
): PersistedRuntimeDegradation[] {
  const deduped = new Map<string, PersistedRuntimeDegradation>();

  for (const degradation of runtimeDegradations) {
    deduped.set(
      JSON.stringify({
        stage: degradation.stage,
        category: degradation.category,
        severity: degradation.severity,
        reason: degradation.reason,
        message: degradation.message,
        recoverable: degradation.recoverable,
        metadata: degradation.metadata ?? null,
      }),
      degradation,
    );
  }

  return [...deduped.values()];
}

function deriveLatestTurnRuntimeStatus(
  toolResults: readonly ToolExecutionResult[],
  runtimeDegradations: readonly PersistedRuntimeDegradation[],
): "healthy" | "degraded" | "blocked" | "failed" {
  if (
    toolResults.some(
      (result) => result.resolution === "failed" || (!result.ok && result.resolution === undefined),
    )
  ) {
    return "failed";
  }
  if (
    toolResults.some(
      (result) =>
        result.resolution === "denied" ||
        result.resolution === "approval_required" ||
        result.resolution === "missing" ||
        result.policyDecision?.verdict === "deny" ||
        result.policyDecision?.verdict === "ask",
    )
  ) {
    return "blocked";
  }
  if (
    runtimeDegradations.length > 0 ||
    toolResults.some(
      (result) =>
        result.resolution === "degraded" ||
        result.degradation !== undefined ||
        result.policyDecision?.verdict === "degrade",
    )
  ) {
    return "degraded";
  }
  return "healthy";
}

function summarizeLatestTurnToolOutcomes(
  toolResults: readonly ToolExecutionResult[],
): PersistedLatestTurnToolOutcomes {
  const summary: PersistedLatestTurnToolOutcomes = {
    total: 0,
    executed: 0,
    denied: 0,
    approvalRequired: 0,
    degraded: 0,
    failed: 0,
    missing: 0,
    unknown: 0,
  };

  for (const result of toolResults) {
    summary.total += 1;
    if (result.resolution === "executed") {
      summary.executed += 1;
      continue;
    }
    if (result.resolution === "denied" || result.policyDecision?.verdict === "deny") {
      summary.denied += 1;
      continue;
    }
    if (result.resolution === "approval_required" || result.policyDecision?.verdict === "ask") {
      summary.approvalRequired += 1;
      continue;
    }
    if (
      result.resolution === "degraded" ||
      result.degradation !== undefined ||
      result.policyDecision?.verdict === "degrade"
    ) {
      summary.degraded += 1;
      continue;
    }
    if (result.resolution === "failed" || (!result.ok && result.resolution === undefined)) {
      summary.failed += 1;
      continue;
    }
    if (result.resolution === "missing") {
      summary.missing += 1;
      continue;
    }
    if (result.ok) {
      summary.executed += 1;
      continue;
    }
    summary.unknown += 1;
  }

  return summary;
}

function inferLatestTurnResumeHint(input: {
  startStepIndex: number;
  completedSteps: number;
  lastStepEventType?: string;
}): PersistedLatestTurnResumeHint | undefined {
  if (input.completedSteps <= 0 || input.lastStepEventType === undefined) {
    return undefined;
  }

  const lastStepIndex = input.startStepIndex + input.completedSteps - 1;
  switch (input.lastStepEventType) {
    case "step.context_built":
    case "step.model_output":
    case "step.tools_planned":
      return {
        resumeAction: "continue-current-step",
        nextStepIndex: lastStepIndex,
      };
    case "step.tool_result":
      return {
        resumeAction: "start-next-step",
        nextStepIndex: lastStepIndex + 1,
      };
    default:
      return undefined;
  }
}

function withLatestTurnObservationMetadata(
  metadata: JsonObject,
  observation: PersistedLatestTurnObservation,
): JsonObject {
  const nextMetadata = isRecord(metadata) ? { ...metadata } : {};
  const runtime = isRecord(nextMetadata.runtime) ? { ...nextMetadata.runtime } : {};
  const latestTurn = toJsonSafe({
    turnId: observation.turnId,
    providerId: observation.providerId,
    model: observation.model,
    runtimeStatus: observation.runtimeStatus,
    turnBranch: observation.turnBranch,
    finishReason: observation.finishReason,
    updatedAtMs: observation.updatedAtMs,
    ...(observation.completedSteps === undefined
      ? {}
      : { completedSteps: observation.completedSteps }),
    ...(observation.lastStepEventType === undefined
      ? {}
      : { lastStepEventType: observation.lastStepEventType }),
    ...(observation.resumeAction === undefined ? {} : { resumeAction: observation.resumeAction }),
    ...(observation.nextStepIndex === undefined
      ? {}
      : { nextStepIndex: observation.nextStepIndex }),
    ...(observation.toolCount === undefined ? {} : { toolCount: observation.toolCount }),
    ...(observation.toolOutcomes === undefined ? {} : { toolOutcomes: observation.toolOutcomes }),
    ...(observation.reasoning === undefined ? {} : { reasoning: observation.reasoning }),
    ...(observation.toolRuntimeGuidance === undefined
      ? {}
      : { toolRuntimeGuidance: observation.toolRuntimeGuidance }),
    ...(observation.runtimeDegradationSummaries === undefined
      ? {}
      : { runtimeDegradationSummaries: observation.runtimeDegradationSummaries }),
  }) as JsonObject;

  return {
    ...nextMetadata,
    runtime: {
      ...runtime,
      latestTurn,
    },
  };
}

function toJsonSafe(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonSafe(item));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...Object.fromEntries(
        Object.entries(value).map(([key, nestedValue]) => [key, toJsonSafe(nestedValue)]),
      ),
      ...("cause" in value && value.cause !== undefined ? { cause: toJsonSafe(value.cause) } : {}),
    } satisfies JsonObject;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const jsonObject: JsonObject = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      jsonObject[key] = toJsonSafe(nestedValue);
    }
    return jsonObject;
  }

  return String(value);
}

const TASK_ITEM_STATUSES = new Set<TaskItemStatus>(["todo", "doing", "done"]);
const TASK_PRIORITIES = new Set<TaskPriority>(["low", "normal", "high", "urgent"]);

function coercePersistedTaskState(value: unknown): PersistedTaskState {
  const payload =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items: PersistedTaskItem[] = [];

  for (const [index, rawItem] of rawItems.entries()) {
    const item = coercePersistedTaskItem(rawItem, index);
    if (item) {
      items.push(item);
    }
  }

  const updatedAtMs = typeof payload.updatedAtMs === "number" ? payload.updatedAtMs : undefined;

  return {
    items,
    ...(updatedAtMs !== undefined ? { updatedAtMs } : {}),
  };
}

function coercePersistedTaskItem(value: unknown, fallbackIndex: number): PersistedTaskItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const source = value as Record<string, unknown>;
  const content = typeof source.content === "string" ? source.content.trim() : "";
  if (!content) {
    return null;
  }

  const status = TASK_ITEM_STATUSES.has(source.status as TaskItemStatus)
    ? (source.status as TaskItemStatus)
    : "todo";
  const priority = TASK_PRIORITIES.has(source.priority as TaskPriority)
    ? (source.priority as TaskPriority)
    : undefined;

  return {
    id:
      typeof source.id === "string" && source.id.length > 0
        ? source.id
        : `todo-${fallbackIndex + 1}`,
    content,
    status,
    ...(priority ? { priority } : {}),
  };
}

function toTaskState(state: PersistedTaskState): TaskState {
  const items: TaskItem[] = state.items.map((item) => ({
    id: item.id,
    content: item.content,
    status: item.status,
    ...(item.priority ? { priority: item.priority } : {}),
  }));

  return {
    items,
    ...(typeof state.updatedAtMs === "number" ? { updatedAtMs: state.updatedAtMs } : {}),
  };
}

function taskBoardFromState(state: PersistedTurnState): TaskBoard {
  return new TaskBoard(toTaskState(state.tasks));
}

function toPersistedTurnState(
  taskState: TaskState,
  lastAssistantOutput: string,
): PersistedTurnState {
  return {
    tasks: coercePersistedTaskState(taskState),
    lastAssistantOutput,
  };
}

function persistTurnStateReducer(
  state: PersistedTurnState,
  event: { eventType: string; payload: unknown },
): PersistedTurnState {
  if (event.eventType === "tasks.todo_write") {
    const decoded = decodeTaskTodoWritePayload(event.payload);
    if (!decoded) {
      return state;
    }
    return {
      ...state,
      tasks: decoded,
    };
  }

  if (event.eventType === "assistant.output") {
    return {
      ...state,
      lastAssistantOutput: String((event.payload as { text?: string }).text ?? ""),
    };
  }

  return state;
}

function encodeTaskTodoWritePayload(payload: unknown): JsonValue {
  const decoded = decodeTaskTodoWritePayload(payload) ?? coercePersistedTaskState(payload);
  const canonicalEvent = createTaskEvent({
    eventType: "tasks.todo_write",
    payload: toTaskState(decoded),
  });
  return toJsonSafe(canonicalEvent.payload);
}

function decodeTaskTodoWritePayload(payload: unknown): PersistedTaskState | null {
  const event = decodeTaskEvent({
    eventType: "tasks.todo_write",
    payload,
  });
  if (!event || event.eventType !== "tasks.todo_write") {
    return null;
  }
  return coercePersistedTaskState(event.payload);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

type StepRuntimeSessionStore = {
  appendStepJournal: NonNullable<EngineDependencies["sessionStore"]["appendStepJournal"]>;
  createStepCheckpoint: NonNullable<EngineDependencies["sessionStore"]["createStepCheckpoint"]>;
  recoverStep: NonNullable<EngineDependencies["sessionStore"]["recoverStep"]>;
};

function asStepRuntimeStore(
  sessionStore: EngineDependencies["sessionStore"],
): StepRuntimeSessionStore | undefined {
  if (
    typeof sessionStore.appendStepJournal === "function" &&
    typeof sessionStore.createStepCheckpoint === "function" &&
    typeof sessionStore.recoverStep === "function"
  ) {
    return {
      appendStepJournal: sessionStore.appendStepJournal.bind(sessionStore),
      createStepCheckpoint: sessionStore.createStepCheckpoint.bind(sessionStore),
      recoverStep: sessionStore.recoverStep.bind(sessionStore),
    };
  }

  return undefined;
}

function readResumeAction(
  recoveryResult: ReturnType<StepRuntimeSessionStore["recoverStep"]>,
): "no-progress" | "continue-current-step" | "start-next-step" | "turn-complete" {
  const candidate = recoveryResult as unknown as {
    resumeAction?: "no-progress" | "continue-current-step" | "start-next-step" | "turn-complete";
  };
  return candidate.resumeAction ?? "no-progress";
}

function readReplayWindow(
  recoveryResult: ReturnType<StepRuntimeSessionStore["recoverStep"]>,
): { fromSeqExclusive: number; toSeqInclusive: number } | undefined {
  const candidate = recoveryResult as unknown as {
    replayWindow?: {
      fromSeqExclusive: number;
      toSeqInclusive: number;
    };
  };
  return candidate.replayWindow;
}

function omitPrePersistedContextBuilt(
  events: readonly EngineStepJournalEvent[],
  enabled: boolean,
): readonly EngineStepJournalEvent[] {
  if (!enabled || events[0]?.eventType !== "step.context_built") {
    return events;
  }
  return events.slice(1);
}
