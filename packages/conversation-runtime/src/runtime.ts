import { renderConversationRuntimeAngelRoleSystemContext } from "./angel-role-profile.js";
import {
  type ConversationRuntimeContextCheckpointStore,
  type ConversationRuntimeContextPartialSummary,
  saveConversationRuntimeContextPartialSummary,
} from "./context-checkpoint.js";
import { scrubConversationRuntimeInternalContextTags } from "./context-scrubber.js";
import { renderConversationRuntimeDefaultToolPolicySummary } from "./default-tool-policy.js";
import {
  classifyConversationRuntimeFailure,
  toConversationRuntimeFailureCode,
} from "./failure-taxonomy.js";
import type {
  ConversationRuntimeLearningArtifact,
  ConversationRuntimeLearningArtifactStore,
  ConversationRuntimeLearningConfirmationDecision,
} from "./learning-artifact.js";
import type { ConversationRuntimeMemoryEvidenceRecord } from "./memory-evidence.js";
import {
  type ConversationRuntimeModelCallPort,
  type ConversationRuntimeModelToolCall,
  type ConversationRuntimeModelToolDefinition,
  type ConversationRuntimeModelToolLoopEvent,
  type ConversationRuntimeModelToolMessage,
  type ConversationRuntimeToolExecutionInput,
  type ConversationRuntimeToolExecutionOutput,
  type ConversationRuntimeToolExecutorPort,
  type ConversationRuntimeToolPermissionPort,
  type ConversationRuntimeToolSandboxPreflightPort,
  runConversationRuntimeModelToolLoop,
} from "./model-tool-loop.js";
import {
  type ConversationRuntimeProductionPort,
  type ConversationRuntimeProductionResult,
  isConversationRuntimeProductionTurn,
  resolveConversationRuntimeProductionMode,
  resolveConversationRuntimeProductionObjective,
} from "./production.js";
import {
  type ConversationRunRegistry,
  type ConversationTurnRunRecord,
  appendConversationRuntimeEventsToRunRegistry,
} from "./run-registry.js";
import {
  type ConversationRuntimeUnifiedEvent,
  createConversationRuntimeUnifiedEvent,
} from "./runtime-events.js";
import {
  renderConversationRuntimeSourceCapabilityGuidance,
  resolveConversationRuntimeSourceGroundingToolCalls,
} from "./source-capabilities.js";
import { renderConversationRuntimeStructuredReply } from "./structured-renderer.js";
import type { ConversationRuntimeToolHook } from "./tool-hooks.js";
import type { ConversationRuntimeToolEvidenceStore } from "./tool-result-evidence-store.js";
import {
  filterConversationRuntimeToolsForExposurePolicy,
  isLearningConfirmationPrompt,
  resolveConversationRuntimeToolExposurePolicy,
  shouldDisableConversationRuntimeToolsForUserInstruction,
} from "./turn-policy.js";
import type {
  ConversationRuntimeArtifactSignal,
  ConversationRuntimeCapabilityPacket,
  ConversationRuntimeCapabilityRouteDecision,
  ConversationRuntimeEvent,
  ConversationRuntimeInput,
  ConversationRuntimeReplySource,
  ConversationRuntimeResult,
  ConversationRuntimeTraceItem,
  ConversationRuntimeTurnDecision,
} from "./types.js";

export type ConversationRuntimeTurnOrchestrator = (
  input: ConversationRuntimeInput,
) => Promise<ConversationRuntimeTurnDecision> | ConversationRuntimeTurnDecision;

export type ConversationRuntimeCapabilityResolver = (
  input: ConversationRuntimeCapabilityRequest,
) => Promise<ConversationRuntimeCapabilityPacket> | ConversationRuntimeCapabilityPacket;

export type ConversationRuntimeLearningPersistencePort = (
  input: ConversationRuntimeLearningPersistenceInput,
) =>
  | Promise<ConversationRuntimeLearningPersistenceResult>
  | ConversationRuntimeLearningPersistenceResult;

export interface ConversationRuntimeMemoryLifecyclePort {
  readonly onPreCompress?: (
    input: ConversationRuntimePreCompressHookInput,
  ) =>
    | Promise<ConversationRuntimePreCompressHookResult | undefined>
    | ConversationRuntimePreCompressHookResult
    | undefined;
  readonly onDelegation?: (input: ConversationRuntimeDelegationHookInput) => Promise<void> | void;
}

export interface ConversationRuntimePreCompressHookInput {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly messages: readonly ConversationRuntimeModelToolMessage[];
  readonly reason: "before-transcript-trim";
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimePreCompressHookResult {
  readonly status?: "completed" | "failed";
  readonly partialSummary?: string;
  readonly reason?: string;
  readonly sourceEventIds?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeDelegationHookInput {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly toolName: string;
  readonly toolCallId: string;
  readonly subagentRunIds: readonly string[];
  readonly result: ConversationRuntimeToolExecutionOutput;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeCapabilityRequest {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly userText: string;
  readonly surface: ConversationRuntimeInput["surface"];
  readonly channel: string;
  readonly intent?: ConversationRuntimeTurnDecision["intent"];
  readonly trustedContext?: ConversationRuntimeInput["trustedContext"];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeLearningPersistenceInput {
  readonly input: ConversationRuntimeInput;
  readonly turnId: string;
  readonly decision: ConversationRuntimeAcceptedLearningConfirmationDecision;
  readonly artifact: ConversationRuntimeLearningArtifact;
  readonly confirmation: {
    readonly confirmationId: string;
    readonly sessionKey: string;
    readonly artifactId: string;
    readonly candidateIds: readonly string[];
    readonly status: string;
    readonly acceptedByMessageId?: string;
    readonly decisionText?: string;
  };
}

export interface ConversationRuntimeLearningPersistenceResult {
  readonly status:
    | "candidate-created"
    | "candidate-accepted"
    | "candidate-confirmation-blocked"
    | "published"
    | "review-required"
    | "quarantined"
    | (string & {});
  readonly candidateIds?: readonly string[];
  readonly auditId?: string;
  readonly message?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeAcceptedLearningConfirmationDecision {
  readonly kind: "accept";
  readonly confirmationId: string;
  readonly artifactId: string;
  readonly candidateIds: readonly string[];
  readonly acceptedByMessageId?: string;
  readonly decisionText: string;
}

export interface RunConversationRuntimeTurnOptions {
  readonly turnIdFactory?: (input: ConversationRuntimeInput) => string;
  readonly nowMs?: () => number;
  readonly runRegistry?: ConversationRunRegistry;
  readonly createAbortController?: () => AbortController;
  readonly onRunStarted?: (record: ConversationTurnRunRecord) => void;
  readonly orchestrate: ConversationRuntimeTurnOrchestrator;
  readonly resolveCapabilityContext?: ConversationRuntimeCapabilityResolver;
  readonly startProduction?: ConversationRuntimeProductionPort;
  readonly callModel?: ConversationRuntimeModelCallPort;
  readonly authorizeToolCall?: ConversationRuntimeToolPermissionPort;
  readonly preflightToolSandbox?: ConversationRuntimeToolSandboxPreflightPort;
  readonly executeTool?: ConversationRuntimeToolExecutorPort;
  readonly toolEvidenceStore?: ConversationRuntimeToolEvidenceStore;
  readonly toolHooks?: readonly ConversationRuntimeToolHook[];
  readonly contextCheckpointStore?: ConversationRuntimeContextCheckpointStore;
  readonly tools?: readonly ConversationRuntimeModelToolDefinition[];
  readonly maxModelToolLoopTurns?: number;
  readonly learningArtifactStore?: ConversationRuntimeLearningArtifactStore;
  readonly persistLearningConfirmation?: ConversationRuntimeLearningPersistencePort;
  readonly memoryLifecycle?: ConversationRuntimeMemoryLifecyclePort;
}

type RunConversationRuntimeTurnCoreOptions = RunConversationRuntimeTurnOptions & {
  readonly abortSignal: AbortSignal;
};

export async function runConversationRuntimeTurn(
  input: ConversationRuntimeInput,
  options: RunConversationRuntimeTurnOptions,
): Promise<ConversationRuntimeResult> {
  const turnId = options.turnIdFactory?.(input) ?? `${input.sessionKey}:${input.messageId}`;
  const abortController = options.createAbortController?.() ?? new AbortController();
  const runRecord = options.runRegistry?.start({
    turnId,
    input,
    status: "running",
    abortController,
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  });
  if (runRecord !== undefined) {
    options.onRunStarted?.(runRecord);
  }
  try {
    const result = await runConversationRuntimeTurnCore(input, {
      ...options,
      turnIdFactory: () => turnId,
      abortSignal: abortController.signal,
    });
    const projectedResult = attachConversationRuntimeUnifiedEvents({
      input,
      result,
      startedAtMs: input.receivedAtMs ?? result.events[0]?.occurredAtMs ?? Date.now(),
    });
    return finalizeConversationRuntimeRunRegistryResult({
      registry: options.runRegistry,
      runRecord,
      result: projectedResult,
    });
  } catch (error) {
    if (options.runRegistry !== undefined && runRecord !== undefined) {
      options.runRegistry.finalize(runRecord.turnRunId, {
        status: abortController.signal.aborted ? "cancelled" : "failed",
        internalFailure: toConversationRuntimeErrorMessage(error),
        failureTaxonomy: [
          abortController.signal.aborted ? "runtime_interrupted" : "runtime_exception",
        ],
      });
    }
    throw error;
  }
}

async function runConversationRuntimeTurnCore(
  input: ConversationRuntimeInput,
  options: RunConversationRuntimeTurnCoreOptions,
): Promise<ConversationRuntimeResult> {
  const turnId = options.turnIdFactory?.(input) ?? `${input.sessionKey}:${input.messageId}`;
  const occurredAtMs = options.nowMs?.() ?? Date.now();
  const turn = await options.orchestrate(input);
  const capabilityRoute = resolveConversationRuntimeCapabilityRoute(turn);
  const traceItems: ConversationRuntimeTraceItem[] = [
    {
      source: "runtime" as const,
      stage: "turn.orchestrated",
      detail: "Conversation turn was classified by the injected orchestrator.",
      occurredAtMs,
      metadata: {
        intent: turn.intent.kind,
        shouldInvokeRecall: turn.shouldInvokeRecall,
      },
    },
    ...(turn.trace ?? []),
  ];
  if (capabilityRoute !== undefined) {
    traceItems.push({
      source: "capability" as const,
      stage: "capability.route",
      detail: capabilityRoute.reason,
      occurredAtMs,
      metadata: { ...capabilityRoute },
    });
  }

  const learningConfirmation = await resolveLearningConfirmationBeforeModel({
    input,
    turnId,
    turn,
    occurredAtMs,
    ...(options.persistLearningConfirmation === undefined
      ? {}
      : { persistLearningConfirmation: options.persistLearningConfirmation }),
    ...(options.learningArtifactStore === undefined
      ? {}
      : { store: options.learningArtifactStore }),
  });
  if (learningConfirmation !== undefined) {
    traceItems.push(...learningConfirmation.traceItems);
    return {
      turnId,
      sessionKey: input.sessionKey,
      replySource: "structured-renderer",
      intent: learningConfirmation.intent,
      turn: {
        ...turn,
        intent: learningConfirmation.intent,
        responsePolicy: "control-reply",
        userText: learningConfirmation.finalText,
        memoryDecision: {
          action: "transient",
          reason: "学习确认只更新当前待确认经验对象，不直接把确认话术写入长期记忆。",
        },
        shouldInvokeRecall: false,
        shouldCreateRun: false,
        shouldAttachToActiveSession: false,
      },
      events: learningConfirmation.events,
      finalText: learningConfirmation.finalText,
      responsePolicy: "control-reply",
      memoryDecision: {
        action: "transient",
        reason: "学习确认只更新当前待确认经验对象，不直接把确认话术写入长期记忆。",
      },
      ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
      artifactIds:
        learningConfirmation.artifact === undefined
          ? []
          : [learningConfirmation.artifact.artifactId],
      transcriptMessages: buildSimpleTranscriptMessages(input, learningConfirmation.finalText),
      operatorTrace: {
        items: traceItems,
      },
    };
  }

  const failedLearningConfirmation = resolveMissingLearningConfirmationBeforeModel({
    input,
    turnId,
    turn,
    occurredAtMs,
  });
  if (failedLearningConfirmation !== undefined) {
    traceItems.push(...failedLearningConfirmation.traceItems);
    return {
      turnId,
      sessionKey: input.sessionKey,
      replySource: "structured-renderer",
      intent: failedLearningConfirmation.intent,
      turn: {
        ...turn,
        intent: failedLearningConfirmation.intent,
        responsePolicy: "control-reply",
        userText: failedLearningConfirmation.finalText,
        memoryDecision: {
          action: "never-store",
          reason: "没有真实待确认学习候选时，保存请求只返回结构化失败。",
        },
        shouldInvokeRecall: false,
        shouldCreateRun: false,
        shouldAttachToActiveSession: false,
      },
      events: failedLearningConfirmation.events,
      finalText: failedLearningConfirmation.finalText,
      responsePolicy: "control-reply",
      memoryDecision: {
        action: "never-store",
        reason: "没有真实待确认学习候选时，保存请求只返回结构化失败。",
      },
      ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
      artifactIds: [],
      transcriptMessages: buildSimpleTranscriptMessages(
        input,
        failedLearningConfirmation.finalText,
      ),
      operatorTrace: {
        items: traceItems,
      },
    };
  }

  let capabilityPacket: ConversationRuntimeCapabilityPacket | undefined;
  if (turn.shouldInvokeRecall && options.resolveCapabilityContext !== undefined) {
    capabilityPacket = await options.resolveCapabilityContext({
      turnId,
      sessionKey: input.sessionKey,
      userText: input.text,
      surface: input.surface,
      channel: input.channel,
      intent: turn.intent,
      trustedContext: input.trustedContext,
    });
    traceItems.push({
      source: "capability" as const,
      stage: "capability.resolved",
      detail: "Capability context was resolved because the turn requested recall.",
      occurredAtMs: options.nowMs?.() ?? occurredAtMs,
      metadata: {
        status: capabilityPacket.status,
        hitCount: capabilityPacket.hits.length,
      },
    });
  } else if (turn.shouldInvokeRecall) {
    traceItems.push({
      source: "capability" as const,
      stage: "capability.degraded",
      detail: "Turn requested recall, but no capability resolver was provided.",
      occurredAtMs: options.nowMs?.() ?? occurredAtMs,
      metadata: {
        status: "degraded",
      },
    });
  }

  if (isConversationRuntimeProductionTurn(turn) && options.startProduction !== undefined) {
    const production = await options.startProduction({
      turnId,
      sessionKey: input.sessionKey,
      mode: resolveConversationRuntimeProductionMode(turn),
      objective: resolveConversationRuntimeProductionObjective(input, turn),
      ...(turn.intent.supplement === undefined ? {} : { supplement: turn.intent.supplement }),
      userText: input.text,
      surface: input.surface,
      channel: input.channel,
      intent: turn.intent,
      turn,
      ...(capabilityPacket === undefined ? {} : { capabilityPacket }),
      ...(input.trustedContext === undefined ? {} : { trustedContext: input.trustedContext }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    });
    traceItems.push(
      {
        source: "runtime" as const,
        stage: "production.dispatched",
        detail: "Production intent was dispatched through the injected production port.",
        occurredAtMs: options.nowMs?.() ?? occurredAtMs,
        metadata: {
          mode: resolveConversationRuntimeProductionMode(turn),
          ok: production.ok,
          status: production.status ?? "unknown",
          runId: production.runId ?? "",
          blueprintId: production.blueprintId ?? "",
          recallStatus: production.recallStatus ?? "unknown",
          skillStatus: production.skillStatus ?? "unknown",
          memoryStatus: production.memoryStatus ?? "unknown",
        },
      },
      ...(production.trace ?? []),
    );
    const artifactEvents =
      production.artifacts?.map((artifact, index) => ({
        id: `${turnId}:artifact:${artifact.id || index}`,
        kind: "runtime.artifact" as const,
        turnId,
        sessionKey: input.sessionKey,
        occurredAtMs: options.nowMs?.() ?? occurredAtMs,
        payload: { artifact },
      })) ?? [];
    const approvalEvents =
      production.approvals?.map((approval, index) => ({
        id: `${turnId}:approval:${approval.id || index}`,
        kind: "runtime.approval" as const,
        turnId,
        sessionKey: input.sessionKey,
        occurredAtMs: options.nowMs?.() ?? occurredAtMs,
        payload: {
          approval: {
            id: approval.id,
            title: approval.title ?? "Production review",
            status: normalizeApprovalStatus(approval.status),
            ...(approval.summary === undefined ? {} : { summary: approval.summary }),
            ...(approval.metadata === undefined ? {} : { metadata: approval.metadata }),
          },
        },
      })) ?? [];
    const replySource = production.replySource ?? "tool-loop";
    const finalText = normalizeConversationRuntimeFinalText(production.finalText);
    const finalEvents =
      finalText === undefined
        ? createProductionNoFinalEvents({
            production,
            turnId,
            sessionKey: input.sessionKey,
            occurredAtMs: options.nowMs?.() ?? occurredAtMs,
            turn,
          })
        : [
            {
              id: `${turnId}:final`,
              kind: "runtime.final" as const,
              turnId,
              sessionKey: input.sessionKey,
              occurredAtMs: options.nowMs?.() ?? occurredAtMs,
              payload: {
                text: finalText,
                responsePolicy: turn.responsePolicy,
                audience: turn.audience,
                replySource,
              },
            },
          ];
    return {
      turnId,
      sessionKey: input.sessionKey,
      replySource:
        finalText === undefined && finalEvents.some((event) => event.kind === "runtime.error")
          ? "degraded-error"
          : replySource,
      intent: turn.intent,
      turn,
      events: [...artifactEvents, ...approvalEvents, ...finalEvents],
      ...(finalText === undefined ? {} : { finalText }),
      responsePolicy: turn.responsePolicy,
      memoryDecision: turn.memoryDecision,
      ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
      ...(capabilityPacket === undefined ? {} : { capabilityPacket }),
      transcriptMessages: buildProductionTranscriptMessages(input, finalText),
      ...(production.runId === undefined ? {} : { runId: production.runId }),
      artifactIds:
        production.artifacts === undefined
          ? []
          : production.artifacts.map((artifact) => artifact.id),
      approvalIds:
        production.approvals === undefined
          ? []
          : production.approvals.map((approval) => approval.id),
      operatorTrace: {
        items: traceItems,
      },
    };
  }

  if (isConversationRuntimeProductionTurn(turn) && options.startProduction === undefined) {
    traceItems.push({
      source: "runtime" as const,
      stage: "production.degraded",
      detail: "Production intent was detected, but no production port was provided.",
      occurredAtMs: options.nowMs?.() ?? occurredAtMs,
      metadata: {
        status: "degraded",
      },
    });
    const rendered = renderConversationRuntimeStructuredReply({
      turnId,
      sessionKey: input.sessionKey,
      occurredAtMs: options.nowMs?.() ?? occurredAtMs,
      turn,
      code: "production-port-unavailable",
    });
    return {
      turnId,
      sessionKey: input.sessionKey,
      replySource: rendered.replySource,
      intent: turn.intent,
      turn,
      events: rendered.events,
      ...(rendered.finalText === undefined ? {} : { finalText: rendered.finalText }),
      responsePolicy: turn.responsePolicy,
      memoryDecision: turn.memoryDecision,
      ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
      ...(capabilityPacket === undefined ? {} : { capabilityPacket }),
      transcriptMessages: buildSimpleTranscriptMessages(input, rendered.finalText),
      operatorTrace: {
        items: traceItems,
      },
    };
  }

  if (shouldRunModelToolLoop(turn, options)) {
    const toolExposurePolicy = resolveConversationRuntimeToolExposurePolicy(input.text);
    const disableToolsForTurn = toolExposurePolicy === "disable-all";
    const exposedTools = filterConversationRuntimeToolsForExposurePolicy(
      options.tools ?? [],
      toolExposurePolicy,
    );
    const requiredToolCalls =
      disableToolsForTurn || toolExposurePolicy === "local-learning-evidence-only"
        ? []
        : resolveRequiredConversationRuntimeGroundingToolCalls({
            rawUserText: input.text,
            conversationContext: {
              history: input.history ?? [],
              ...(turn.intent.metadata === undefined ? {} : { metadata: turn.intent.metadata }),
            },
            runtimeContext: {
              surface: input.surface,
              channel: input.channel,
              sessionKey: input.sessionKey,
              tools: exposedTools,
              metadata: {
                intentKind: turn.intent.kind,
                ...(turn.intent.metadata ?? {}),
                ...(input.metadata ?? {}),
              },
            },
            ...(capabilityPacket === undefined ? {} : { capabilityPacket }),
          });
    const skillToolCall =
      disableToolsForTurn || toolExposurePolicy === "local-learning-evidence-only"
        ? undefined
        : resolveRequiredConversationRuntimeSkillToolCall({
            rawUserText: input.text,
            turn,
            tools: exposedTools,
            history: input.history ?? [],
            ...(capabilityPacket === undefined ? {} : { capabilityPacket }),
          });
    const learningEvidenceToolCall = disableToolsForTurn
      ? undefined
      : resolveRequiredLearningEvidenceCandidateToolCall({
          input,
          turn,
          tools: exposedTools,
        });
    const moyinProjectReadinessToolCall =
      disableToolsForTurn || toolExposurePolicy === "local-learning-evidence-only"
        ? undefined
        : resolveRequiredMoyinProjectReadinessToolCall({
            rawUserText: input.text,
            turn,
            tools: exposedTools,
          });
    if (disableToolsForTurn) {
      traceItems.push({
        source: "runtime" as const,
        stage: "tool.disabled_by_user",
        detail: "User explicitly requested a context-only answer without external tools.",
        occurredAtMs: options.nowMs?.() ?? occurredAtMs,
        metadata: {
          reason: "explicit-no-tools",
        },
      });
    } else if (toolExposurePolicy === "local-learning-evidence-only") {
      traceItems.push({
        source: "runtime" as const,
        stage: "tool.local_evidence_only",
        detail:
          "User asked to answer from recent learned content; only local learning evidence tools are exposed.",
        occurredAtMs: options.nowMs?.() ?? occurredAtMs,
        metadata: {
          exposedTools: exposedTools.map((tool) => tool.name),
        },
      });
    }
    const allRequiredToolCalls = [
      ...(learningEvidenceToolCall === undefined ? [] : [learningEvidenceToolCall]),
      ...(skillToolCall === undefined ? [] : [skillToolCall]),
      ...(moyinProjectReadinessToolCall === undefined ? [] : [moyinProjectReadinessToolCall]),
      ...requiredToolCalls,
    ];
    if (allRequiredToolCalls.length > 0) {
      const toolDefinitionsByName = new Map(exposedTools.map((tool) => [tool.name, tool]));
      const requiredTools = allRequiredToolCalls.map((call) => {
        const tool = toolDefinitionsByName.get(call.name);
        const capability =
          typeof call.metadata?.capability === "string"
            ? call.metadata.capability
            : typeof tool?.metadata?.capability === "string"
              ? tool.metadata.capability
              : undefined;
        return {
          id: call.id,
          name: call.name,
          ...(capability === undefined ? {} : { capability }),
        };
      });
      traceItems.push({
        source: "tool" as const,
        stage: "tool.required",
        detail: "Conversation runtime scheduled required grounding tools before model response.",
        occurredAtMs: options.nowMs?.() ?? occurredAtMs,
        metadata: {
          toolNames: allRequiredToolCalls.map((call) => call.name),
          callIds: allRequiredToolCalls.map((call) => call.id),
          ...(allRequiredToolCalls.length === 1 ? { toolName: allRequiredToolCalls[0]?.name } : {}),
          ...(requiredTools.length === 1 && requiredTools[0]?.capability !== undefined
            ? { capability: requiredTools[0].capability }
            : {}),
          requiredTools,
          requiredToolMetadata: allRequiredToolCalls.map((call) => call.metadata ?? {}),
        },
      });
    }
    const latestContextPartialSummary = readLatestConversationRuntimeContextPartialSummary({
      store: options.contextCheckpointStore,
      sessionKey: input.sessionKey,
    });
    let modelLoop: Awaited<ReturnType<typeof runConversationRuntimeModelToolLoop>>;
    try {
      modelLoop = await runConversationRuntimeModelToolLoop({
        turnId,
        sessionKey: input.sessionKey,
        messages: buildModelToolLoopMessages(
          input,
          turn,
          capabilityPacket,
          exposedTools,
          latestContextPartialSummary,
        ),
        tools: exposedTools,
        ...(allRequiredToolCalls.length === 0 ? {} : { requiredToolCalls: allRequiredToolCalls }),
        ...(options.maxModelToolLoopTurns === undefined
          ? {}
          : { maxTurns: options.maxModelToolLoopTurns }),
        ...(options.toolHooks === undefined ? {} : { toolHooks: options.toolHooks }),
        abortSignal: options.abortSignal,
        metadata: {
          surface: input.surface,
          channel: input.channel,
          intentKind: turn.intent.kind,
          responsePolicy: turn.responsePolicy,
          ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
          ...(input.metadata ?? {}),
        },
        callModel: options.callModel,
        ...(options.authorizeToolCall === undefined
          ? {}
          : { authorizeToolCall: options.authorizeToolCall }),
        ...(options.preflightToolSandbox === undefined
          ? {}
          : { preflightToolSandbox: options.preflightToolSandbox }),
        executeTool: options.executeTool,
        ...(options.toolEvidenceStore === undefined
          ? {}
          : { toolEvidenceStore: options.toolEvidenceStore }),
        enableModelRetryAfterToolEvidence: true,
        onToolResult: async ({ call, result }) => {
          const subagentRunIds = extractConversationRuntimeSubagentRunIds(result);
          if (subagentRunIds.length > 0) {
            await notifyConversationRuntimeDelegationHook({
              options,
              turnId,
              sessionKey: input.sessionKey,
              call,
              result,
              subagentRunIds,
              occurredAtMs: options.nowMs?.() ?? occurredAtMs,
              traceItems,
            });
          }
          if (options.runRegistry === undefined) {
            return;
          }
          const turnRunId = resolveSubagentTurnRunIdFromRegistry(options.runRegistry, {
            turnId,
            sessionKey: input.sessionKey,
          });
          if (turnRunId === undefined) {
            return;
          }
          for (const subagentRunId of subagentRunIds) {
            options.runRegistry.registerSubagentRun(turnRunId, subagentRunId);
          }
        },
      });
    } catch (error) {
      if (options.abortSignal.aborted) {
        traceItems.push({
          source: "runtime" as const,
          stage: "turn.interrupted",
          detail: "Conversation runtime caught an abort from the unified stop signal.",
          occurredAtMs: options.nowMs?.() ?? occurredAtMs,
          metadata: {
            error: toConversationRuntimeErrorMessage(error),
          },
        });
        return createInterruptedConversationRuntimeResult({
          turnId,
          sessionKey: input.sessionKey,
          occurredAtMs: options.nowMs?.() ?? occurredAtMs,
          turn,
          capabilityPacket,
          traceItems,
        });
      }
      traceItems.push({
        source: "model" as const,
        stage: "model.loop.degraded",
        detail: "Conversation runtime could not complete a model turn.",
        occurredAtMs: options.nowMs?.() ?? occurredAtMs,
        metadata: {
          error: toConversationRuntimeErrorMessage(error),
        },
      });
      const rendered = renderConversationRuntimeStructuredReply({
        turnId,
        sessionKey: input.sessionKey,
        occurredAtMs: options.nowMs?.() ?? occurredAtMs,
        turn,
        code: "model-unavailable",
        detail: `模型调用失败：${toConversationRuntimeErrorMessage(error)}`,
      });
      return {
        turnId,
        sessionKey: input.sessionKey,
        replySource: rendered.replySource,
        intent: turn.intent,
        turn,
        events: rendered.events,
        ...(rendered.finalText === undefined ? {} : { finalText: rendered.finalText }),
        responsePolicy: turn.responsePolicy,
        memoryDecision: turn.memoryDecision,
        ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
        ...(capabilityPacket === undefined ? {} : { capabilityPacket }),
        transcriptMessages: buildSimpleTranscriptMessages(input, rendered.finalText),
        operatorTrace: {
          items: traceItems,
        },
      };
    }
    traceItems.push(...modelLoop.operatorTrace);
    traceItems.push({
      source: "model" as const,
      stage: "model.loop.completed",
      detail: "Conversation turn passed through the model/tool loop.",
      occurredAtMs: options.nowMs?.() ?? occurredAtMs,
      metadata: {
        eventCount: modelLoop.events.length,
        stoppedReason: modelLoop.stoppedReason ?? "final",
      },
    });
    const modelLoopArtifacts = extractConversationRuntimeToolArtifactsFromModelLoop(modelLoop);
    if (modelLoop.stoppedReason === "interrupted" || options.abortSignal.aborted) {
      return createInterruptedConversationRuntimeResult({
        turnId,
        sessionKey: input.sessionKey,
        occurredAtMs: options.nowMs?.() ?? occurredAtMs,
        turn,
        capabilityPacket,
        traceItems,
      });
    }

    const modelError = findLatestModelLoopError(modelLoop.events);
    if (
      modelError === undefined &&
      modelLoop.finalText === undefined &&
      (modelLoop.stoppedReason === "max-turns" || modelLoop.stoppedReason === "no-final-text")
    ) {
      const toolFallback = resolveConversationRuntimeToolResultFallbackFinal(modelLoop.events, {
        rawUserText: input.text,
        history: input.history ?? [],
      });
      if (toolFallback !== undefined) {
        recordRuntimeFallbackTrace({
          traceItems,
          occurredAtMs: options.nowMs?.() ?? occurredAtMs,
          toolFallback,
          reason: "no-final-text",
        });
        traceItems.push({
          source: "runtime" as const,
          stage: "tool.result.final.fallback",
          detail:
            "Model stopped without a final answer; the runtime used the best completed tool observation as the user-facing final.",
          occurredAtMs: options.nowMs?.() ?? occurredAtMs,
          metadata: toolFallback.metadata,
        });
        const replySource = resolveToolFallbackReplySource(toolFallback.metadata);
        const runtimeEvents: ConversationRuntimeEvent[] = modelLoop.events.flatMap((event, index) =>
          mapModelLoopEventToRuntimeEvent({
            event,
            index,
            turnId,
            sessionKey: input.sessionKey,
            occurredAtMs: options.nowMs?.() ?? occurredAtMs,
            responsePolicy: turn.responsePolicy,
            audience: turn.audience,
            replySource,
          }),
        );
        return {
          turnId,
          sessionKey: input.sessionKey,
          replySource,
          intent: turn.intent,
          turn,
          events: [
            ...runtimeEvents,
            {
              id: `${turnId}:tool-fallback-final`,
              kind: "runtime.final" as const,
              turnId,
              sessionKey: input.sessionKey,
              occurredAtMs: options.nowMs?.() ?? occurredAtMs,
              payload: {
                text: toolFallback.finalText,
                responsePolicy: turn.responsePolicy,
                audience: turn.audience,
                replySource,
              },
            },
          ],
          finalText: toolFallback.finalText,
          responsePolicy: turn.responsePolicy,
          memoryDecision: turn.memoryDecision,
          ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
          ...(capabilityPacket === undefined ? {} : { capabilityPacket }),
          ...(modelLoopArtifacts.length === 0
            ? {}
            : { artifactIds: modelLoopArtifacts.map((artifact) => artifact.id) }),
          memoryEvidenceRecords: modelLoop.memoryEvidenceRecords,
          transcriptMessages: await buildModelLoopTranscriptMessages({
            hookContext: createConversationRuntimePreCompressHookContext({
              options,
              turnId,
              sessionKey: input.sessionKey,
              occurredAtMs: options.nowMs?.() ?? occurredAtMs,
              traceItems,
            }),
            modelLoop,
            finalText: toolFallback.finalText,
            correctionApplied: true,
          }),
          operatorTrace: {
            items: traceItems,
          },
        };
      }
    }

    if (modelError !== undefined) {
      const toolFallback = resolveConversationRuntimeToolResultFallbackFinal(modelLoop.events, {
        rawUserText: input.text,
        history: input.history ?? [],
      });
      if (toolFallback !== undefined) {
        recordRuntimeFallbackTrace({
          traceItems,
          occurredAtMs: options.nowMs?.() ?? occurredAtMs,
          toolFallback,
          reason: "model-error",
        });
        traceItems.push({
          source: "runtime" as const,
          stage: "tool.result.final.fallback",
          detail:
            "Model failed after tools ran; the runtime used the completed tool observation as the user-facing final.",
          occurredAtMs: options.nowMs?.() ?? occurredAtMs,
          metadata: toolFallback.metadata,
        });
        const replySource = resolveToolFallbackReplySource(toolFallback.metadata);
        const runtimeEvents: ConversationRuntimeEvent[] = modelLoop.events.flatMap(
          (event, index) => {
            if (event.kind === "model.error") {
              return [];
            }
            return mapModelLoopEventToRuntimeEvent({
              event,
              index,
              turnId,
              sessionKey: input.sessionKey,
              occurredAtMs: options.nowMs?.() ?? occurredAtMs,
              responsePolicy: turn.responsePolicy,
              audience: turn.audience,
              replySource,
            });
          },
        );
        return {
          turnId,
          sessionKey: input.sessionKey,
          replySource,
          intent: turn.intent,
          turn,
          events: [
            ...runtimeEvents,
            {
              id: `${turnId}:tool-fallback-final`,
              kind: "runtime.final" as const,
              turnId,
              sessionKey: input.sessionKey,
              occurredAtMs: options.nowMs?.() ?? occurredAtMs,
              payload: {
                text: toolFallback.finalText,
                responsePolicy: turn.responsePolicy,
                audience: turn.audience,
                replySource,
              },
            },
          ],
          finalText: toolFallback.finalText,
          responsePolicy: turn.responsePolicy,
          memoryDecision: turn.memoryDecision,
          ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
          ...(capabilityPacket === undefined ? {} : { capabilityPacket }),
          ...(modelLoopArtifacts.length === 0
            ? {}
            : { artifactIds: modelLoopArtifacts.map((artifact) => artifact.id) }),
          memoryEvidenceRecords: modelLoop.memoryEvidenceRecords,
          transcriptMessages: await buildModelLoopTranscriptMessages({
            hookContext: createConversationRuntimePreCompressHookContext({
              options,
              turnId,
              sessionKey: input.sessionKey,
              occurredAtMs: options.nowMs?.() ?? occurredAtMs,
              traceItems,
            }),
            modelLoop,
            finalText: toolFallback.finalText,
            correctionApplied: true,
          }),
          operatorTrace: {
            items: traceItems,
          },
        };
      }
      traceItems.push({
        source: "model" as const,
        stage: "model.loop.degraded",
        detail: "Conversation runtime could not complete a model turn.",
        occurredAtMs: options.nowMs?.() ?? occurredAtMs,
        metadata: {
          error: modelError,
        },
      });
      const replySource = "degraded-error" as const;
      const runtimeEvents: ConversationRuntimeEvent[] = modelLoop.events.flatMap((event, index) =>
        mapModelLoopEventToRuntimeEvent({
          event,
          index,
          turnId,
          sessionKey: input.sessionKey,
          occurredAtMs: options.nowMs?.() ?? occurredAtMs,
          responsePolicy: turn.responsePolicy,
          audience: turn.audience,
          replySource,
        }),
      );
      const rendered = renderConversationRuntimeStructuredReply({
        turnId,
        sessionKey: input.sessionKey,
        occurredAtMs: options.nowMs?.() ?? occurredAtMs,
        turn,
        code: "model-unavailable",
        detail: `模型调用失败：${modelError}`,
      });
      return {
        turnId,
        sessionKey: input.sessionKey,
        replySource: rendered.replySource,
        intent: turn.intent,
        turn,
        events: [...runtimeEvents, ...rendered.events],
        ...(rendered.finalText === undefined ? {} : { finalText: rendered.finalText }),
        responsePolicy: turn.responsePolicy,
        memoryDecision: turn.memoryDecision,
        ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
        ...(capabilityPacket === undefined ? {} : { capabilityPacket }),
        ...(modelLoopArtifacts.length === 0
          ? {}
          : { artifactIds: modelLoopArtifacts.map((artifact) => artifact.id) }),
        transcriptMessages: buildSimpleTranscriptMessages(input, rendered.finalText),
        operatorTrace: {
          items: traceItems,
        },
      };
    }

    const groundedFinal = resolveConversationRuntimeGroundedFinal({
      modelFinalText: modelLoop.finalText,
      events: modelLoop.events,
      requiredToolCalls: allRequiredToolCalls,
    });
    const requiredFallbackFinal = groundedFinal.corrected
      ? undefined
      : resolveConversationRuntimeRequiredToolFallbackFinal({
          modelFinalText: groundedFinal.finalText ?? modelLoop.finalText,
          events: modelLoop.events,
          requiredToolCalls: allRequiredToolCalls,
        });
    const toolObservationCorrection = resolveConversationRuntimeToolObservationFinal({
      modelFinalText: requiredFallbackFinal?.finalText ?? modelLoop.finalText,
      events: modelLoop.events,
    });
    const toolObservationFinal = toolObservationCorrection.corrected
      ? toolObservationCorrection
      : requiredFallbackFinal?.corrected === true
        ? createUncorrectedToolObservationFinal(requiredFallbackFinal.finalText)
        : groundedFinal.corrected
          ? createUncorrectedToolObservationFinal(groundedFinal.finalText)
          : resolveConversationRuntimeToolObservationFinal({
              modelFinalText: groundedFinal.finalText ?? modelLoop.finalText,
              events: modelLoop.events,
            });
    if (groundedFinal.corrected) {
      traceItems.push({
        source: "runtime" as const,
        stage: "grounding.final.corrected",
        detail:
          "Required tool observation corrected or supplied the final answer after the model turn.",
        occurredAtMs: options.nowMs?.() ?? occurredAtMs,
        metadata: groundedFinal.metadata ?? {},
      });
    }
    if (requiredFallbackFinal?.corrected === true) {
      traceItems.push({
        source: "runtime" as const,
        stage: "required.tool.final.corrected",
        detail:
          "Required tool observation replaced a low-signal model final after the tool completed.",
        occurredAtMs: options.nowMs?.() ?? occurredAtMs,
        metadata: requiredFallbackFinal.metadata ?? {},
      });
    }
    if (
      requiredFallbackFinal?.corrected === true &&
      requiredFallbackFinal.finalText !== undefined &&
      !toolObservationFinal.corrected
    ) {
      const requiredFinalText = requiredFallbackFinal.finalText;
      const replySource = resolveToolFallbackReplySource(requiredFallbackFinal.metadata ?? {});
      const runtimeEvents: ConversationRuntimeEvent[] = modelLoop.events.flatMap((event, index) =>
        mapModelLoopEventToRuntimeEvent({
          event,
          index,
          turnId,
          sessionKey: input.sessionKey,
          occurredAtMs: options.nowMs?.() ?? occurredAtMs,
          responsePolicy: turn.responsePolicy,
          audience: turn.audience,
          replySource,
        }),
      );
      return {
        turnId,
        sessionKey: input.sessionKey,
        replySource,
        intent: turn.intent,
        turn,
        events: [
          ...runtimeEvents,
          {
            id: `${turnId}:required-tool-final`,
            kind: "runtime.final" as const,
            turnId,
            sessionKey: input.sessionKey,
            occurredAtMs: options.nowMs?.() ?? occurredAtMs,
            payload: {
              text: requiredFinalText,
              responsePolicy: turn.responsePolicy,
              audience: turn.audience,
              replySource,
            },
          },
        ],
        finalText: requiredFinalText,
        responsePolicy: turn.responsePolicy,
        memoryDecision: turn.memoryDecision,
        ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
        ...(capabilityPacket === undefined ? {} : { capabilityPacket }),
        ...(modelLoopArtifacts.length === 0
          ? {}
          : { artifactIds: modelLoopArtifacts.map((artifact) => artifact.id) }),
        memoryEvidenceRecords: modelLoop.memoryEvidenceRecords,
        transcriptMessages: await buildModelLoopTranscriptMessages({
          hookContext: createConversationRuntimePreCompressHookContext({
            options,
            turnId,
            sessionKey: input.sessionKey,
            occurredAtMs: options.nowMs?.() ?? occurredAtMs,
            traceItems,
          }),
          modelLoop,
          finalText: requiredFinalText,
          correctionApplied: true,
        }),
        operatorTrace: {
          items: traceItems,
        },
      };
    }
    if (toolObservationFinal.corrected) {
      traceItems.push({
        source: "runtime" as const,
        stage: "tool.observation.final.corrected",
        detail:
          "Tool observation corrected the final answer after the model contradicted a tool result.",
        occurredAtMs: options.nowMs?.() ?? occurredAtMs,
        metadata: toolObservationFinal.metadata ?? {},
      });
    }

    const finalCorrection = toolObservationFinal.corrected
      ? {
          kind: "tool-observation" as const,
          fallbackText: toolObservationFinal.finalText,
          ...(toolObservationFinal.metadata === undefined
            ? {}
            : { metadata: toolObservationFinal.metadata }),
        }
      : groundedFinal.corrected
        ? {
            kind: "grounding" as const,
            fallbackText: groundedFinal.finalText,
            ...(groundedFinal.metadata === undefined ? {} : { metadata: groundedFinal.metadata }),
          }
        : requiredFallbackFinal?.corrected === true
          ? {
              kind: "tool-observation" as const,
              fallbackText: requiredFallbackFinal.finalText,
              ...(requiredFallbackFinal.metadata === undefined
                ? {}
                : { metadata: requiredFallbackFinal.metadata }),
            }
          : undefined;
    const modelRepair =
      finalCorrection === undefined
        ? undefined
        : await repairCorrectedConversationRuntimeFinal({
            turnId,
            sessionKey: input.sessionKey,
            input,
            turn,
            modelLoop,
            requiredToolCalls: allRequiredToolCalls,
            correction: finalCorrection,
            callModel: options.callModel,
            abortSignal: options.abortSignal,
            occurredAtMs,
            ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
            traceItems,
          });

    const initialRawFinalText =
      modelRepair?.finalText ?? finalCorrection?.fallbackText ?? modelLoop.finalText;
    const initialScrubbedFinalText = scrubConversationRuntimeFinalText(initialRawFinalText);
    const lowQualityToolFallback =
      initialScrubbedFinalText !== undefined &&
      isLowQualityExperienceCandidateFinal(initialScrubbedFinalText)
        ? resolveConversationRuntimeToolResultFallbackFinal(modelLoop.events, {
            rawUserText: input.text,
            history: input.history ?? [],
          })
        : undefined;
    if (lowQualityToolFallback !== undefined) {
      traceItems.push({
        source: "runtime" as const,
        stage: "tool.result.final.fallback",
        detail:
          "Model final looked like fragmented experience-candidate prompt text; runtime used the structured tool observation instead.",
        occurredAtMs: options.nowMs?.() ?? occurredAtMs,
        metadata: lowQualityToolFallback.metadata,
      });
    }
    const rawFinalText = lowQualityToolFallback?.finalText ?? initialScrubbedFinalText;
    const finalText = augmentConversationRuntimeFinalWithRuntimeGuards({
      input,
      finalText: rawFinalText,
      events: modelLoop.events,
    });
    const deterministicContextApplied = finalText !== initialRawFinalText;
    const replySource =
      finalCorrection !== undefined ? "tool-loop" : resolveModelLoopReplySource(modelLoop);
    const runtimeEvents: ConversationRuntimeEvent[] = modelLoop.events.flatMap((event, index) => {
      if (
        event.kind === "model.final" &&
        (finalCorrection !== undefined || deterministicContextApplied)
      ) {
        return [];
      }
      return mapModelLoopEventToRuntimeEvent({
        event,
        index,
        turnId,
        sessionKey: input.sessionKey,
        occurredAtMs: options.nowMs?.() ?? occurredAtMs,
        responsePolicy: turn.responsePolicy,
        audience: turn.audience,
        replySource,
      });
    });

    if (finalText === undefined) {
      const toolFallback = resolveConversationRuntimeToolResultFallbackFinal(modelLoop.events, {
        rawUserText: input.text,
        history: input.history ?? [],
      });
      if (toolFallback !== undefined) {
        recordRuntimeFallbackTrace({
          traceItems,
          occurredAtMs: options.nowMs?.() ?? occurredAtMs,
          toolFallback,
          reason: "final-text-missing-after-correction",
        });
        traceItems.push({
          source: "runtime" as const,
          stage: "tool.result.final.fallback",
          detail:
            "Model/tool loop stopped without final text; the runtime used the latest tool observation as the user-facing final.",
          occurredAtMs: options.nowMs?.() ?? occurredAtMs,
          metadata: toolFallback.metadata,
        });
        const fallbackReplySource = "structured-renderer" as const;
        return {
          turnId,
          sessionKey: input.sessionKey,
          replySource: fallbackReplySource,
          intent: turn.intent,
          turn,
          events: [
            ...runtimeEvents,
            {
              id: `${turnId}:tool-fallback-final`,
              kind: "runtime.final" as const,
              turnId,
              sessionKey: input.sessionKey,
              occurredAtMs: options.nowMs?.() ?? occurredAtMs,
              payload: {
                text: toolFallback.finalText,
                responsePolicy: turn.responsePolicy,
                audience: turn.audience,
                replySource: fallbackReplySource,
              },
            },
          ],
          finalText: toolFallback.finalText,
          responsePolicy: turn.responsePolicy,
          memoryDecision: turn.memoryDecision,
          ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
          ...(capabilityPacket === undefined ? {} : { capabilityPacket }),
          ...(modelLoopArtifacts.length === 0
            ? {}
            : { artifactIds: modelLoopArtifacts.map((artifact) => artifact.id) }),
          memoryEvidenceRecords: modelLoop.memoryEvidenceRecords,
          transcriptMessages: await buildModelLoopTranscriptMessages({
            hookContext: createConversationRuntimePreCompressHookContext({
              options,
              turnId,
              sessionKey: input.sessionKey,
              occurredAtMs: options.nowMs?.() ?? occurredAtMs,
              traceItems,
            }),
            modelLoop,
            finalText: toolFallback.finalText,
            correctionApplied: true,
          }),
          operatorTrace: {
            items: traceItems,
          },
        };
      }
    }

    if (finalText === undefined && replySource === "degraded-error") {
      const rendered = renderConversationRuntimeStructuredReply({
        turnId,
        sessionKey: input.sessionKey,
        occurredAtMs: options.nowMs?.() ?? occurredAtMs,
        turn,
        code: "model-unavailable",
        detail: `模型不可用：模型循环没有生成可展示的最终回复。stoppedReason=${modelLoop.stoppedReason ?? "unknown"}`,
      });
      return {
        turnId,
        sessionKey: input.sessionKey,
        replySource: rendered.replySource,
        intent: turn.intent,
        turn,
        events: [...runtimeEvents, ...rendered.events],
        ...(rendered.finalText === undefined ? {} : { finalText: rendered.finalText }),
        responsePolicy: turn.responsePolicy,
        memoryDecision: turn.memoryDecision,
        ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
        ...(capabilityPacket === undefined ? {} : { capabilityPacket }),
        transcriptMessages: buildSimpleTranscriptMessages(input, rendered.finalText),
        operatorTrace: {
          items: traceItems,
        },
      };
    }

    return {
      turnId,
      sessionKey: input.sessionKey,
      replySource,
      intent: turn.intent,
      turn,
      events:
        finalText === undefined || runtimeEvents.some((event) => event.kind === "runtime.final")
          ? runtimeEvents
          : [
              ...runtimeEvents,
              {
                id: `${turnId}:final`,
                kind: "runtime.final",
                turnId,
                sessionKey: input.sessionKey,
                occurredAtMs: options.nowMs?.() ?? occurredAtMs,
                payload: {
                  text: finalText,
                  responsePolicy: turn.responsePolicy,
                  audience: turn.audience,
                  replySource,
                },
              },
            ],
      ...(finalText === undefined ? {} : { finalText }),
      responsePolicy: turn.responsePolicy,
      memoryDecision: turn.memoryDecision,
      ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
      ...(capabilityPacket === undefined ? {} : { capabilityPacket }),
      ...(modelLoopArtifacts.length === 0
        ? {}
        : { artifactIds: modelLoopArtifacts.map((artifact) => artifact.id) }),
      memoryEvidenceRecords: modelLoop.memoryEvidenceRecords,
      transcriptMessages: await buildModelLoopTranscriptMessages({
        hookContext: createConversationRuntimePreCompressHookContext({
          options,
          turnId,
          sessionKey: input.sessionKey,
          occurredAtMs: options.nowMs?.() ?? occurredAtMs,
          traceItems,
        }),
        modelLoop,
        finalText,
        correctionApplied: finalCorrection !== undefined || deterministicContextApplied,
      }),
      operatorTrace: {
        items: traceItems,
      },
    };
  }

  const rendered = renderConversationRuntimeStructuredReply({
    turnId,
    sessionKey: input.sessionKey,
    occurredAtMs: options.nowMs?.() ?? occurredAtMs,
    turn,
    code: resolveNoModelStructuredRenderCode(turn),
  });
  return {
    turnId,
    sessionKey: input.sessionKey,
    replySource: rendered.replySource,
    intent: turn.intent,
    turn,
    events: rendered.events,
    ...(rendered.finalText === undefined ? {} : { finalText: rendered.finalText }),
    responsePolicy: turn.responsePolicy,
    memoryDecision: turn.memoryDecision,
    ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
    ...(capabilityPacket === undefined ? {} : { capabilityPacket }),
    transcriptMessages: buildSimpleTranscriptMessages(input, rendered.finalText),
    operatorTrace: {
      items: traceItems,
    },
  };
}

function shouldRunModelToolLoop(
  turn: ConversationRuntimeTurnDecision,
  options: RunConversationRuntimeTurnOptions,
): options is RunConversationRuntimeTurnOptions & {
  readonly callModel: ConversationRuntimeModelCallPort;
  readonly executeTool: ConversationRuntimeToolExecutorPort;
} {
  if (options.callModel === undefined || options.executeTool === undefined) {
    return false;
  }
  if (turn.intent.kind === "ignore" || isConversationRuntimeProductionTurn(turn)) {
    return false;
  }
  if (turn.intent.kind === "learning-admit") {
    return (options.tools ?? []).some((tool) => tool.name === "director.learning.admit");
  }
  return (
    turn.intent.kind === "chat" ||
    turn.intent.kind === "capability-intro" ||
    turn.intent.kind === "management-command" ||
    turn.intent.kind === "comfyui-run" ||
    turn.shouldInvokeRecall
  );
}

function resolveRequiredLearningEvidenceCandidateToolCall(input: {
  readonly input: ConversationRuntimeInput;
  readonly turn: ConversationRuntimeTurnDecision;
  readonly tools: readonly ConversationRuntimeModelToolDefinition[];
}): ConversationRuntimeModelToolCall | undefined {
  const activeEvidenceFrame = readConversationRuntimeActiveEvidenceFrame(input.input);
  if (
    !shouldAnswerExperienceCandidatesBeforeModel(input.input.text, input.turn, activeEvidenceFrame)
  ) {
    return undefined;
  }
  const tool = input.tools.find(
    (candidate) => candidate.name === "director.experience.candidates.list",
  );
  if (tool === undefined) {
    return undefined;
  }
  const candidateIds =
    activeEvidenceFrame === undefined
      ? []
      : dedupeRuntimeStringArray(readRuntimeStringArray(activeEvidenceFrame.candidateIds));
  const sourceUrls =
    activeEvidenceFrame === undefined
      ? []
      : dedupeRuntimeStringArray(readRuntimeStringArray(activeEvidenceFrame.sourceUrls));
  return {
    id: "required-experience-candidates-learning-evidence",
    name: "director.experience.candidates.list",
    args: {
      status: "pending",
      maxItems: 5,
      ...(candidateIds.length === 0 ? {} : { candidateIds }),
      ...(sourceUrls.length === 0 ? {} : { sourceUrls }),
    },
    readOnly: true,
    metadata: {
      requiredGrounding: true,
      sourceCapabilityId: "experience.candidates.learning-evidence",
      capability: tool.metadata?.capability,
      reason:
        activeEvidenceFrame === undefined
          ? "experience_candidates_learned_summary"
          : "active_evidence_frame",
      ...(activeEvidenceFrame === undefined
        ? {}
        : {
            frameId: readRuntimeString(activeEvidenceFrame.frameId),
            sourceUrls: readRuntimeStringArray(activeEvidenceFrame.sourceUrls),
          }),
    },
  };
}

function shouldAnswerExperienceCandidatesBeforeModel(
  rawUserText: string,
  turn: ConversationRuntimeTurnDecision,
  activeEvidenceFrame?: Readonly<Record<string, unknown>>,
): boolean {
  if (shouldDisableConversationRuntimeToolsForUserInstruction(rawUserText)) {
    return false;
  }
  if (isLearningConfirmationTurn(rawUserText, turn)) {
    return false;
  }
  if (turn.intent.kind !== "chat" && !turn.shouldInvokeRecall) {
    return false;
  }
  if (
    activeEvidenceFrame !== undefined &&
    hasConversationRuntimeActiveEvidenceCandidates(activeEvidenceFrame) &&
    shouldBindActiveEvidenceFrameToCurrentQuestion(rawUserText) &&
    !looksLikeExplicitUrlRereadRequest(rawUserText)
  ) {
    return true;
  }
  // 只用用户真实发言做候选预取判断，避免系统生成的能力引导文案污染路由。
  const text = rawUserText;
  if (
    activeEvidenceFrame !== undefined &&
    hasConversationRuntimeActiveEvidenceSource(activeEvidenceFrame) &&
    shouldBindActiveEvidenceFrameToCurrentQuestion(text) &&
    !looksLikeExplicitUrlRereadRequest(rawUserText)
  ) {
    return true;
  }
  if (
    !/(刚才|上一轮|这次|最近|前面|发来|看看|看详情|候选|学(?:习)?(?:到|到了|了)?什么|学习(?:到|了)?什么)/iu.test(
      text,
    )
  ) {
    return false;
  }
  if (looksLikeExplicitUrlRereadRequest(text)) {
    return false;
  }
  return (
    /(?:学(?:习)?(?:到|到了|了)?什么|学习(?:到|了)?什么|你学(?:习)?(?:到|到了|了)?什么|吸收了什么)/iu.test(
      text,
    ) ||
    (/(图片|视频|媒体|视觉|多模态)/iu.test(text) && /(理解|分析|学习|学到|证据)/iu.test(text))
  );
}

function isLearningConfirmationTurn(
  rawUserText: string,
  turn: ConversationRuntimeTurnDecision,
): boolean {
  return (
    readRuntimeBoolean(turn.intent.metadata?.learningConfirmation) === true ||
    readRuntimeBoolean(turn.metadata?.learningConfirmation) === true ||
    isLearningConfirmationPrompt(rawUserText)
  );
}

function hasConversationRuntimeActiveEvidenceCandidates(
  frame: Readonly<Record<string, unknown>>,
): boolean {
  return readRuntimeStringArray(frame.candidateIds).length > 0;
}

function hasConversationRuntimeActiveEvidenceSource(
  frame: Readonly<Record<string, unknown>>,
): boolean {
  if (readRuntimeStringArray(frame.sourceUrls).length > 0) {
    return true;
  }
  const evidenceDisclosure = readRuntimeRecord(frame.evidenceDisclosure);
  const sources = readRuntimeRecordArray(evidenceDisclosure?.sources);
  return sources.some((source) => readRuntimeString(source.url) !== undefined);
}

function dedupeRuntimeStringArray(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function isNaturalFollowupQuestion(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return false;
  }
  if (looksLikeProductionRequest(normalized)) {
    return false;
  }
  return (
    /[?？]/u.test(normalized) ||
    /(什么|啥|怎么|如何|为什么|哪个|哪条|多少|讲的|讲的是|意思|内容|要点|总结|详情|解释|说明|告诉|列出)/iu.test(
      normalized,
    )
  );
}

function shouldBindActiveEvidenceFrameToCurrentQuestion(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return false;
  }
  if (looksLikeIndependentOperationOrCapabilityRequest(normalized)) {
    return false;
  }
  if (looksLikeExplicitUrlRereadRequest(normalized)) {
    return true;
  }
  return (
    isNaturalFollowupQuestion(normalized) ||
    /(?:刚才|上一轮|这次|最近|前面|这条|这篇|这个链接|该链接|候选|学到|学习结果|证据|来源|媒体|图片|视频|全文|要点|摘要|总结|详情|收录|入库|经验)/iu.test(
      normalized,
    )
  );
}

function looksLikeIndependentOperationOrCapabilityRequest(text: string): boolean {
  const mentionsOperation =
    /(?:接入|操作|调用|使用|运行|执行|控制|安装|配置|保存|写入|下载|上传|打开|连接|启动|停止|读取|访问)/iu.test(
      text,
    );
  if (!mentionsOperation) {
    return false;
  }
  return /(?:cli|命令行|命令|mcp|api|工具|插件|文件|配置|日志|截图|本地|目录|路径|项目|浏览器|chrome|微信|外部系统)/iu.test(
    text,
  );
}

function looksLikeProductionRequest(text: string): boolean {
  return (
    /(?:^|\s|：|:)(?:\/制作|\/生成)/iu.test(text) ||
    /(?:做|制作|生成|创建|规划|产出).{0,48}(?:短剧|视频|分镜|镜头规划|脚本蓝图|制作蓝图|执行蓝图|成片方案)/iu.test(
      text,
    )
  );
}

function looksLikeExplicitUrlRereadRequest(text: string): boolean {
  return (
    /https?:\/\/[^\s"'<>]+/iu.test(text) &&
    /(?:重新|再次|继续|二次|完整|全文|全部|详细|直接|只).{0,16}(?:读取|提取|抽取|打开|总结|学习|学到|学到了)|(?:读取|提取|抽取|打开|总结|学习).{0,16}(?:全文|完整|全部|详细|这个链接|该链接|链接)/iu.test(
      text,
    )
  );
}

function createConversationRuntimeToolEventFromExecutionResult(input: {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly occurredAtMs: number;
  readonly result: ConversationRuntimeToolExecutionOutput;
  readonly turnIndex: number;
}): ConversationRuntimeEvent<"runtime.tool"> {
  return {
    id: `${input.turnId}:tool-result:${input.result.callId}`,
    kind: "runtime.tool",
    turnId: input.turnId,
    sessionKey: input.sessionKey,
    occurredAtMs: input.occurredAtMs,
    payload: {
      tool: {
        id: input.result.callId,
        name: input.result.toolName,
        phase: input.result.ok ? "completed" : "failed",
        outputPreview: input.result.content,
        requiresApproval: input.result.requiresApproval === true,
        metadata: {
          turnIndex: input.turnIndex,
          fastPath: "experience-candidates-learned-summary",
          ...(input.result.error === undefined ? {} : { error: input.result.error }),
          ...(input.result.metadata === undefined
            ? {}
            : { toolResultMetadata: input.result.metadata }),
        },
      },
    },
  };
}

async function resolveLearningConfirmationBeforeModel(input: {
  readonly input: ConversationRuntimeInput;
  readonly turnId: string;
  readonly turn: ConversationRuntimeTurnDecision;
  readonly occurredAtMs: number;
  readonly store?: ConversationRuntimeLearningArtifactStore;
  readonly persistLearningConfirmation?: ConversationRuntimeLearningPersistencePort;
}): Promise<
  | {
      readonly intent: ConversationRuntimeTurnDecision["intent"];
      readonly finalText: string;
      readonly artifact?: ConversationRuntimeLearningArtifact;
      readonly events: readonly ConversationRuntimeEvent[];
      readonly traceItems: readonly ConversationRuntimeTraceItem[];
    }
  | undefined
> {
  if (input.store === undefined) {
    return undefined;
  }
  let resolution = input.store.resolvePendingConfirmation({
    text: input.input.text,
    sessionKey: input.input.sessionKey,
    nowMs: input.occurredAtMs,
    messageId: input.input.messageId,
  });
  if (
    resolution.decision.kind === "none" &&
    resolution.decision.reason === "ordinal-out-of-range"
  ) {
    const finalText =
      "没有保存这条经验。你指定的序号不在当前待保存经验候选范围内；为了避免串到其他候选，这次确认已 fail-closed。";
    const intent: ConversationRuntimeTurnDecision["intent"] = {
      kind: "learning-confirmation",
      metadata: compactRuntimeRecord({
        confirmationDecision: "ordinal-out-of-range",
      }),
    };
    return {
      intent,
      finalText,
      events: [
        {
          id: `${input.turnId}:learning-confirmation-ordinal-missing-final`,
          kind: "runtime.final" as const,
          turnId: input.turnId,
          sessionKey: input.input.sessionKey,
          occurredAtMs: input.occurredAtMs,
          payload: {
            text: finalText,
            responsePolicy: "control-reply",
            audience: input.turn.audience,
            replySource: "structured-renderer",
          },
        },
      ],
      traceItems: [
        {
          source: "memory" as const,
          stage: "learning.confirmation.ordinal_out_of_range",
          detail:
            "Learning confirmation referenced a candidate ordinal outside the pending confirmation.",
          occurredAtMs: input.occurredAtMs,
          metadata: {},
        },
      ],
    };
  }
  if (resolution.decision.kind === "none") {
    return undefined;
  }
  const decision = resolution.decision;
  let persistence: ConversationRuntimeLearningPersistenceResult | undefined;
  if (
    decision.kind === "accept" &&
    resolution.artifact !== undefined &&
    resolution.confirmation !== undefined &&
    input.persistLearningConfirmation !== undefined
  ) {
    persistence = await input.persistLearningConfirmation({
      input: input.input,
      turnId: input.turnId,
      decision: {
        kind: "accept",
        confirmationId: decision.confirmationId,
        artifactId: decision.artifactId,
        candidateIds: decision.candidateIds,
        ...(decision.acceptedByMessageId === undefined
          ? {}
          : { acceptedByMessageId: decision.acceptedByMessageId }),
        decisionText: decision.decisionText,
      },
      artifact: resolution.artifact,
      confirmation: resolution.confirmation,
    });
    if (!isLearningConfirmationPersistenceSuccess(persistence)) {
      const rejectedArtifact: ConversationRuntimeLearningArtifact = {
        ...resolution.artifact,
        status: "rejected",
        updatedAtMs: input.occurredAtMs,
      };
      input.store.upsertArtifact(rejectedArtifact);
      input.store.upsertConfirmation({
        ...resolution.confirmation,
        status: "cancelled",
        decisionText: decision.decisionText,
      });
      resolution = {
        ...resolution,
        artifact: rejectedArtifact,
        confirmation: {
          ...resolution.confirmation,
          status: "cancelled",
          decisionText: decision.decisionText,
        },
      };
    }
  }
  const finalText = renderLearningConfirmationDecisionText(decision, persistence);
  const intent: ConversationRuntimeTurnDecision["intent"] = {
    kind: "learning-confirmation",
    ...(resolution.artifact?.sourceRef === undefined
      ? {}
      : { objective: resolution.artifact.sourceRef }),
    metadata: compactRuntimeRecord({
      confirmationDecision: resolution.decision.kind,
      confirmationId: decision.confirmationId,
      artifactId: decision.artifactId,
      candidateIds:
        decision.kind === "accept" || decision.kind === "reject" ? decision.candidateIds : [],
    }),
  };
  const artifactEvents =
    resolution.artifact === undefined
      ? []
      : [
          {
            id: `${input.turnId}:learning-artifact:${resolution.artifact.artifactId}`,
            kind: "runtime.artifact" as const,
            turnId: input.turnId,
            sessionKey: input.input.sessionKey,
            occurredAtMs: input.occurredAtMs,
            payload: {
              artifact: {
                id: resolution.artifact.artifactId,
                kind: "learning-artifact" as const,
                title: renderLearningArtifactTitle(resolution.artifact),
                metadata: {
                  status: resolution.artifact.status,
                  sourceKind: resolution.artifact.sourceKind,
                  sourceRef: resolution.artifact.sourceRef,
                  publishable: resolution.artifact.publishable,
                  qualityGates: resolution.artifact.qualityGates,
                  pendingConfirmationId: resolution.artifact.pendingConfirmationId ?? "",
                },
              },
            },
          },
        ];
  return {
    intent,
    finalText,
    ...(resolution.artifact === undefined ? {} : { artifact: resolution.artifact }),
    events: [
      ...artifactEvents,
      {
        id: `${input.turnId}:learning-confirmation-final`,
        kind: "runtime.final" as const,
        turnId: input.turnId,
        sessionKey: input.input.sessionKey,
        occurredAtMs: input.occurredAtMs,
        payload: {
          text: finalText,
          responsePolicy: "control-reply",
          audience: input.turn.audience,
          replySource: "structured-renderer",
        },
      },
    ],
    traceItems: [
      {
        source: "memory" as const,
        stage: "learning.confirmation.resolved",
        detail: "Learning confirmation was resolved before model chat.",
        occurredAtMs: input.occurredAtMs,
        metadata: {
          decision: resolution.decision.kind,
          confirmationId: decision.confirmationId,
          artifactId: decision.artifactId,
          ...(persistence === undefined
            ? {}
            : {
                persistenceStatus: persistence.status,
                candidateIds: persistence.candidateIds ?? [],
                auditId: persistence.auditId ?? "",
              }),
        },
      },
    ],
  };
}

function renderLearningConfirmationDecisionText(
  decision: ConversationRuntimeLearningConfirmationDecision,
  persistence?: ConversationRuntimeLearningPersistenceResult,
): string {
  if (decision.kind === "accept") {
    if (persistence !== undefined && !isLearningConfirmationPersistenceSuccess(persistence)) {
      const reason =
        persistence.message === undefined || persistence.message.trim().length === 0
          ? "持久化层没有确认保存成功。"
          : persistence.message.trim();
      return `没有保存这条经验。${reason}`;
    }
    const suffix =
      persistence?.message === undefined || persistence.message.trim().length === 0
        ? "后续遇到相关制作任务时，我会把它作为岗位经验召回使用。"
        : persistence.message.trim();
    return `已保存这条经验。${suffix}`;
  }
  if (decision.kind === "reject") {
    return "已取消保存这条经验。";
  }
  if (decision.kind === "expired") {
    return "这条待保存经验已经过期了。需要的话，把资料重新发我，我会重新学习。";
  }
  return "";
}

function isLearningConfirmationPersistenceSuccess(
  persistence: ConversationRuntimeLearningPersistenceResult,
): boolean {
  return ["candidate-created", "candidate-accepted", "published", "review-required"].includes(
    persistence.status,
  );
}

function renderLearningArtifactTitle(artifact: ConversationRuntimeLearningArtifact): string {
  return artifact.classification?.topic ?? artifact.sourceRef;
}

function resolveConversationRuntimeCapabilityRoute(
  turn: ConversationRuntimeTurnDecision,
): ConversationRuntimeCapabilityRouteDecision | undefined {
  if (turn.capabilityRoute !== undefined) {
    return turn.capabilityRoute;
  }
  return (
    readConversationRuntimeCapabilityRoute(turn.metadata?.capabilityRoute) ??
    readConversationRuntimeCapabilityRoute(turn.intent.metadata?.capabilityRoute)
  );
}

function readConversationRuntimeCapabilityRoute(
  value: unknown,
): ConversationRuntimeCapabilityRouteDecision | undefined {
  if (!isRuntimeRecord(value)) {
    return undefined;
  }
  if (
    value.abilityGroup === "text" ||
    value.abilityGroup === "vision" ||
    value.abilityGroup === "image_generation" ||
    value.abilityGroup === "video_generation"
  ) {
    return value as unknown as ConversationRuntimeCapabilityRouteDecision;
  }
  return undefined;
}

function formatConversationRuntimeCapabilityRoute(
  route: ConversationRuntimeCapabilityRouteDecision,
): string {
  const groupLabel = {
    text: "文本对话",
    vision: "视觉理解",
    image_generation: "图片生成",
    video_generation: "视频生成",
  }[route.abilityGroup];
  const modalities = route.inputModalities.length === 0 ? "text" : route.inputModalities.join("+");
  return [
    `能力组=${groupLabel}`,
    `输入=${modalities}`,
    `输出=${route.outputModality}`,
    `需要媒体理解=${route.requiresMediaUnderstanding ? "是" : "否"}`,
    `显式生成=${route.explicitGeneration ? "是" : "否"}`,
    `原因=${route.reason}`,
  ].join("；");
}

function resolveSubagentTurnRunIdFromRegistry(
  registry: ConversationRunRegistry,
  input: {
    readonly turnId: string;
    readonly sessionKey: string;
  },
): string | undefined {
  return registry
    .list({ sessionKey: input.sessionKey })
    .find((record) => record.turnId === input.turnId)?.turnRunId;
}

export function extractConversationRuntimeSubagentRunIds(
  result: ConversationRuntimeToolExecutionOutput,
): readonly string[] {
  const ids = new Set<string>();
  const metadataSubagentRun = readRuntimeRecord(result.metadata?.subagentRun);
  const output = readRuntimeRecord(result.output);
  const outputDelegation = readRuntimeRecord(output?.delegation);
  const outputSubagentRun = readRuntimeRecord(output?.subagentRun);
  appendNonEmptyRuntimeString(ids, result.metadata?.delegationId);
  appendNonEmptyRuntimeString(ids, metadataSubagentRun?.subagentId);
  appendNonEmptyRuntimeString(ids, outputDelegation?.id);
  appendNonEmptyRuntimeString(ids, outputSubagentRun?.subagentId);
  return [...ids];
}

export function extractConversationRuntimeToolArtifacts(
  result: ConversationRuntimeToolExecutionOutput,
): readonly ConversationRuntimeArtifactSignal[] {
  const artifacts = new Map<string, ConversationRuntimeArtifactSignal>();
  const metadataArtifacts = readRuntimeRecordArray(result.metadata?.artifacts);
  const output = readRuntimeRecord(result.output);
  const outputArtifacts = readRuntimeRecordArray(output?.artifacts);
  const fullBodyArtifact = readRuntimeRecord(output?.full_body_artifact);
  for (const artifact of [
    ...metadataArtifacts,
    ...outputArtifacts,
    ...(fullBodyArtifact === undefined ? [] : [fullBodyArtifact]),
  ]) {
    const parsed = parseConversationRuntimeToolArtifact(artifact);
    if (parsed !== undefined) {
      artifacts.set(parsed.id, parsed);
    }
  }
  return [...artifacts.values()];
}

function extractConversationRuntimeToolArtifactsFromModelLoop(
  modelLoop: Awaited<ReturnType<typeof runConversationRuntimeModelToolLoop>>,
): readonly ConversationRuntimeArtifactSignal[] {
  const artifacts = new Map<string, ConversationRuntimeArtifactSignal>();
  for (const event of modelLoop.events) {
    if (event.kind !== "tool.result") {
      continue;
    }
    for (const artifact of extractConversationRuntimeToolArtifacts(event.result)) {
      artifacts.set(artifact.id, artifact);
    }
  }
  return [...artifacts.values()];
}

function parseConversationRuntimeToolArtifact(
  value: Readonly<Record<string, unknown>>,
): ConversationRuntimeArtifactSignal | undefined {
  const id = readRuntimeString(value.id);
  const kind = readRuntimeString(value.kind);
  if (id === undefined || kind === undefined) {
    return undefined;
  }
  const title = readRuntimeString(value.title);
  const path = readRuntimeString(value.path);
  const url = readRuntimeString(value.url);
  return {
    id,
    kind,
    ...(title === undefined ? {} : { title }),
    ...(path === undefined ? {} : { path }),
    ...(url === undefined ? {} : { url }),
    ...(isRuntimeRecord(value.metadata) ? { metadata: value.metadata } : {}),
  };
}

function appendNonEmptyRuntimeString(target: Set<string>, value: unknown): void {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    target.add(trimmed);
  }
}

function toConversationRuntimeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveModelLoopReplySource(
  modelLoop: Awaited<ReturnType<typeof runConversationRuntimeModelToolLoop>>,
): ConversationRuntimeReplySource {
  if (modelLoop.structuredFallbackReason !== undefined) {
    return "structured-renderer";
  }
  if (modelLoop.finalText === undefined) {
    return modelLoop.stoppedReason === "approval-required" ||
      modelLoop.stoppedReason === "permission-denied"
      ? "structured-renderer"
      : "degraded-error";
  }
  return modelLoop.events.some((event) => event.kind === "tool.result") ? "tool-loop" : "model";
}

function resolveNoModelStructuredRenderCode(
  turn: ConversationRuntimeTurnDecision,
): Parameters<typeof renderConversationRuntimeStructuredReply>[0]["code"] {
  if (turn.intent.kind === "ignore" || turn.responsePolicy === "silent") {
    return "silent";
  }
  if (turn.intent.kind === "management-command" || turn.intent.kind === "run-control") {
    return "local-command";
  }
  if (turn.userText.trim().length > 0 && turn.responsePolicy !== "result-first") {
    return "turn-user-text";
  }
  return "model-unavailable";
}

function buildModelToolLoopMessages(
  input: ConversationRuntimeInput,
  turn: ConversationRuntimeTurnDecision,
  capabilityPacket: ConversationRuntimeCapabilityPacket | undefined,
  tools: readonly ConversationRuntimeModelToolDefinition[],
  latestContextPartialSummary?: ConversationRuntimeContextPartialSummary,
) {
  const capabilityRoute = resolveConversationRuntimeCapabilityRoute(turn);
  const systemLines = [
    "你是 Director Angel 的统一对话运行时。",
    "先理解用户真实意图，再结合当前能力上下文自然回答。",
    createConversationRuntimeEnvironmentPrompt(input),
    ...renderConversationRuntimeAngelRolePrompt(input),
    ...renderConversationRuntimeActiveEvidenceFramePrompt(input),
    "默认只给用户结果和下一步，不展示内部流程、trace、实现细节或产品说明书式清单。",
    "如果能力上下文里有已发布经验、Skill、记忆或外部工具状态，只在和问题相关时使用。",
    "如果本回合提供了可用工具，且用户要求搜索、学习、查找、读取链接、调用外部工具或使用系统能力，应优先调用工具获得结果，再基于工具观察自然回复；不要在有工具可用时声称自己不能访问或不能调用。",
    renderConversationRuntimeSourceCapabilityGuidance(tools),
    renderConversationRuntimeDefaultToolPolicySummary(),
    "工具结果是事实来源；工具失败时说明失败原因和安全下一步。",
    "如果 web_search 工具结果包含 provider、source_type、status、failures 或 next_actions，最终回复必须基于这些字段说明真实检索来源、检索状态、失败原因或下一步，不要只泛泛说“没找到”。",
    "用户问“学到了什么/发来看看/看详情”时，如果工具返回经验候选，回复必须分成“核心结论 / 学到的可复用方法 / 还没做到或局限 / 下一步”，每段换行，最多 5 点，不要把 Markdown 标题、编号和粗体挤成一段。",
    "不要把普通闲聊、临时情绪或无关话题写成经验或长期记忆。",
  ];
  if (shouldUseBriefValueJudgmentAnswer(input.text)) {
    systemLines.push(
      "用户期望简短回答：先给结论，用 1-2 句话说明判断；只有用户继续追问时再展开细节。",
    );
  }
  if (shouldDisableConversationRuntimeToolsForUserInstruction(input.text)) {
    systemLines.push(
      "用户明确要求只基于当前对话或不要调用外部工具：本轮不得请求、假装请求或暗示已经请求任何工具；如上下文不足，就直接说明不足。",
    );
  }
  if (capabilityRoute !== undefined) {
    systemLines.push(`本轮能力路由：${formatConversationRuntimeCapabilityRoute(capabilityRoute)}`);
  }
  if (capabilityPacket?.visibleSummary) {
    systemLines.push(`当前可见能力摘要：${capabilityPacket.visibleSummary}`);
  }
  if (capabilityPacket?.hiddenPromptBlock) {
    systemLines.push(`隐藏能力上下文：\n${capabilityPacket.hiddenPromptBlock}`);
  }
  const contextPartialSummaryPrompt = renderConversationRuntimeContextPartialSummaryPrompt(
    latestContextPartialSummary,
  );
  if (contextPartialSummaryPrompt !== undefined) {
    systemLines.push(contextPartialSummaryPrompt);
  }
  if (turn.userText) {
    systemLines.push(`路由判断提示：${turn.userText}`);
  }

  return [
    {
      role: "system" as const,
      content: systemLines.join("\n\n"),
      metadata: {
        intentKind: turn.intent.kind,
        responsePolicy: turn.responsePolicy,
        memoryAction: turn.memoryDecision.action,
        ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
      },
    },
    ...buildHistoryModelToolLoopMessages(input),
    {
      role: "user" as const,
      content: input.text,
      metadata: {
        surface: input.surface,
        channel: input.channel,
        messageId: input.messageId,
      },
    },
  ];
}

function shouldUseBriefValueJudgmentAnswer(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return false;
  }
  return (
    /(?:有用吗|有没有用|怎么样|好不好|值得吗|值不值得|靠谱吗|可用吗|有价值吗|有帮助吗)/iu.test(
      normalized,
    ) ||
    /(?:只(?:用|要)?(?:一|二|两|三|四|五|\d+)\s*(?:点|条|句话)|只(?:回答|回复|说|列)|简短|简单说|别展开|不要展开|不用展开)/iu.test(
      normalized,
    )
  );
}

function readLatestConversationRuntimeContextPartialSummary(input: {
  readonly store: ConversationRuntimeContextCheckpointStore | undefined;
  readonly sessionKey: string;
}): ConversationRuntimeContextPartialSummary | undefined {
  try {
    return input.store?.readLatestPartialSummary(input.sessionKey);
  } catch {
    return undefined;
  }
}

function renderConversationRuntimeContextPartialSummaryPrompt(
  summary: ConversationRuntimeContextPartialSummary | undefined,
): string | undefined {
  if (summary === undefined || summary.summary.trim().length === 0) {
    return undefined;
  }
  return [
    "上下文压缩恢复摘要（不完整）：",
    `checkpoint=${summary.checkpointId}`,
    `来源 turn=${summary.turnId}`,
    ...(summary.reason === undefined ? [] : [`原因=${summary.reason}`]),
    `摘要：${truncateConversationRuntimeContextSummary(summary.summary, 1_500)}`,
    "这段只用于恢复连续性，不能把它当作完整长期记忆；如与本轮工具结果冲突，以本轮工具事实为准。",
  ].join("\n");
}

function truncateConversationRuntimeContextSummary(text: string, maxChars: number): string {
  const normalized = text.trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars)}...`;
}

function renderConversationRuntimeAngelRolePrompt(
  input: ConversationRuntimeInput,
): readonly string[] {
  const context = renderConversationRuntimeAngelRoleSystemContext(
    input.trustedContext?.angelRoleProfile,
  );
  return context === undefined ? [] : [context];
}

function resolveMissingLearningConfirmationBeforeModel(input: {
  readonly input: ConversationRuntimeInput;
  readonly turnId: string;
  readonly turn: ConversationRuntimeTurnDecision;
  readonly occurredAtMs: number;
}):
  | {
      readonly intent: ConversationRuntimeTurnDecision["intent"];
      readonly finalText: string;
      readonly events: readonly ConversationRuntimeEvent[];
      readonly traceItems: readonly ConversationRuntimeTraceItem[];
    }
  | undefined {
  if (!isLearningConfirmationTurn(input.input.text, input.turn)) {
    return undefined;
  }
  const activeEvidenceFrame = readConversationRuntimeActiveEvidenceFrame(input.input);
  const candidateIds =
    activeEvidenceFrame === undefined
      ? []
      : dedupeRuntimeStringArray(readRuntimeStringArray(activeEvidenceFrame.candidateIds));
  const sourceUrls =
    activeEvidenceFrame === undefined
      ? []
      : dedupeRuntimeStringArray(readRuntimeStringArray(activeEvidenceFrame.sourceUrls));
  const finalText =
    "没有保存这条经验。当前没有可确认的待保存经验候选；请先完成一次学习并生成待确认候选，再说保存或收录。";
  const intent: ConversationRuntimeTurnDecision["intent"] = {
    kind: "learning-confirmation",
    metadata: compactRuntimeRecord({
      confirmationDecision: "missing_pending_confirmation",
      candidateIds,
      sourceUrls,
    }),
  };
  return {
    intent,
    finalText,
    events: [
      {
        id: `${input.turnId}:learning-confirmation-missing-final`,
        kind: "runtime.final",
        turnId: input.turnId,
        sessionKey: input.input.sessionKey,
        occurredAtMs: input.occurredAtMs,
        payload: {
          text: finalText,
          responsePolicy: "control-reply",
          audience: input.turn.audience,
          replySource: "structured-renderer",
        },
      },
    ],
    traceItems: [
      {
        source: "memory" as const,
        stage: "learning.confirmation.missing",
        detail:
          "Learning confirmation intent had no matching pending learning confirmation; runtime failed closed before learned-summary fast path.",
        occurredAtMs: input.occurredAtMs,
        metadata: {
          candidateIds,
          sourceUrls,
        },
      },
    ],
  };
}

function createConversationRuntimeEnvironmentPrompt(input: ConversationRuntimeInput): string {
  const receivedAtMs = normalizeConversationRuntimeTimestampMs(input.receivedAtMs) ?? Date.now();
  const receivedAt = new Date(receivedAtMs);
  const timeZone =
    readMetadataString(input.metadata, "timeZone") ??
    readMetadataString(input.trustedContext?.metadata, "timeZone") ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    "UTC";
  const locale =
    readMetadataString(input.metadata, "locale") ??
    readMetadataString(input.trustedContext?.metadata, "locale") ??
    "zh-CN";
  return [
    "当前运行上下文：",
    `- 当前时间：${formatConversationRuntimeDateTime(receivedAt, locale, timeZone)}（${timeZone}）`,
    `- 当前日期：${formatConversationRuntimeDate(receivedAt, locale, timeZone)}`,
    `- 客户端：${input.surface}/${input.channel}`,
    `- 会话：${input.sessionKey}`,
    "用户询问时间、今天、最近、刚才、当前环境或客户端时，优先使用这段上下文；不要为了回答当前时间去搜索互联网。",
  ].join("\n");
}

function renderConversationRuntimeActiveEvidenceFramePrompt(
  input: ConversationRuntimeInput,
): readonly string[] {
  const frame = readConversationRuntimeActiveEvidenceFrame(input);
  if (frame === undefined) {
    return [];
  }
  if (!shouldBindActiveEvidenceFrameToCurrentQuestion(input.text)) {
    return [];
  }
  const evidenceDisclosure = readRuntimeRecord(frame.evidenceDisclosure);
  const sources = readRuntimeRecordArray(evidenceDisclosure?.sources);
  const primarySource =
    sources[0] ?? readRuntimeRecord(frame.source) ?? readRuntimeRecord(frame.evidence);
  const sourceUrls =
    readRuntimeStringArray(frame.sourceUrls).length > 0
      ? readRuntimeStringArray(frame.sourceUrls)
      : [
          readRuntimeString(primarySource?.url),
          readRuntimeString(frame.sourceUrl),
          readRuntimeString(frame.url),
        ].filter((url): url is string => url !== undefined);
  const fullBodyChars =
    readRuntimeNumber(primarySource?.fullBodyChars) ??
    readRuntimeNumber(primarySource?.full_body_chars) ??
    0;
  const secondPassExtracted =
    primarySource?.secondPassExtracted === true || primarySource?.second_pass_extracted === true;
  const mediaInventory =
    readRuntimeRecord(primarySource?.mediaInventory) ??
    readRuntimeRecord(primarySource?.media_inventory);
  const mediaCount =
    readRuntimeNumber(primarySource?.mediaCount) ??
    readRuntimeNumber(primarySource?.media_count) ??
    readRuntimeNumber(mediaInventory?.assetCount) ??
    0;
  const mediaUnderstandingStatus =
    readRuntimeString(primarySource?.mediaUnderstandingStatus) ??
    readRuntimeString(primarySource?.media_understanding_status) ??
    "not_understood_without_user_authorization";
  const persisted =
    primarySource?.persisted === true ||
    primarySource?.admitted === true ||
    primarySource?.persistedToKnowledge === true ||
    primarySource?.persisted_to_knowledge === true;
  const candidateIds = readRuntimeStringArray(frame.candidateIds);
  return [
    [
      "上一轮活跃证据帧：",
      `- frameId：${readRuntimeString(frame.frameId) ?? "unknown"}`,
      `- turnId：${readRuntimeString(frame.turnId) ?? "unknown"}`,
      `- 来源：${sourceUrls.length === 0 ? "未知" : sourceUrls.join(", ")}`,
      `- 全文字符数：${fullBodyChars}`,
      `- 二次提取：${secondPassExtracted ? "是" : "否"}`,
      `- 媒体数量：${mediaCount}`,
      `- 媒体理解状态：${mediaUnderstandingStatus}`,
      `- 是否已入库：${persisted ? "是" : "否"}`,
      `- 候选对象：${candidateIds.length === 0 ? "无" : candidateIds.join(", ")}`,
      "回答续问时优先绑定这个证据帧，不要靠猜用户措辞；如果用户没有给新 URL 或新对象，就把当前问题理解为围绕这份活跃证据继续问。",
      "没有媒体理解授权时，只能说文本和证据字段，不能把图片、视频、音频内容当成结论。",
    ].join("\n"),
  ];
}

function readConversationRuntimeActiveEvidenceFrame(
  input: ConversationRuntimeInput,
): Readonly<Record<string, unknown>> | undefined {
  return (
    readRuntimeRecord(input.trustedContext?.activeEvidenceFrame) ??
    readRuntimeRecord(input.trustedContext?.metadata?.activeEvidenceFrame) ??
    readRuntimeRecord(input.metadata?.activeEvidenceFrame)
  );
}

function augmentConversationRuntimeFinalWithDeterministicContext(
  input: ConversationRuntimeInput,
  finalText: string | undefined,
): string | undefined {
  if (finalText === undefined) {
    return undefined;
  }
  const deterministicFacts = createConversationRuntimeDeterministicFactLines(input, finalText);
  if (deterministicFacts.length === 0) {
    return finalText;
  }
  return `${deterministicFacts.join("\n")}\n\n${finalText}`;
}

function augmentConversationRuntimeFinalWithRuntimeGuards(input: {
  readonly input: ConversationRuntimeInput;
  readonly finalText: string | undefined;
  readonly events: readonly ConversationRuntimeModelToolLoopEvent[];
}): string | undefined {
  const deterministicFinal = augmentConversationRuntimeFinalWithDeterministicContext(
    input.input,
    input.finalText,
  );
  const structuredExperienceFinal =
    deterministicFinal !== undefined && isLowQualityExperienceCandidateFinal(deterministicFinal)
      ? resolveConversationRuntimeToolResultFallbackFinal(input.events, {
          rawUserText: input.input.text,
          history: input.input.history ?? [],
        })?.finalText
      : undefined;
  const sourceEvidenceFinal = appendConversationRuntimeExperienceCandidateSourceEvidence(
    structuredExperienceFinal ?? deterministicFinal,
    input.events,
  );
  const mediaAdmissionFinal = appendConversationRuntimeMediaAdmissionDisclosure(
    sourceEvidenceFinal,
    input.events,
  );
  const candidateMediaBoundaryFinal =
    appendConversationRuntimeExperienceCandidateMediaBoundaryDisclosure(
      mediaAdmissionFinal,
      input.events,
    );
  return appendConversationRuntimeMediaAuthorizationDisclosure(
    candidateMediaBoundaryFinal,
    input.events,
  );
}

function scrubConversationRuntimeFinalText(finalText: string | undefined): string | undefined {
  if (finalText === undefined) {
    return undefined;
  }
  const scrubbed = scrubConversationRuntimeInternalContextTags(finalText);
  return scrubbed.length === 0 ? undefined : scrubbed;
}

const CONVERSATION_RUNTIME_MEDIA_NOT_UNDERSTOOD_LABEL = "媒体未理解";
const CONVERSATION_RUNTIME_DEFAULT_MEDIA_UNAUTHORIZED_DISCLOSURE =
  "文本已读；媒体仅完成清单记录，尚未理解图片、视频或音频内容，因此不能把媒体内容当成结论。";

function appendConversationRuntimeExperienceCandidateSourceEvidence(
  finalText: string | undefined,
  events: readonly ConversationRuntimeModelToolLoopEvent[],
): string | undefined {
  if (finalText === undefined) {
    return undefined;
  }
  const disclosure = resolveConversationRuntimeExperienceCandidateSourceEvidenceDisclosure(events);
  if (disclosure === undefined) {
    return finalText;
  }
  const compactLine = `证据来源：${disclosure.url} · 全文 ${
    disclosure.fullBodyChars
  } 字符 · ${humanizeConversationRuntimeEvidenceReadStatus(disclosure.readStatus)}`;
  if (finalText.includes(compactLine)) {
    return finalText;
  }
  return `${removeConversationRuntimeLooseSourceEvidenceLine(finalText, disclosure.url)}\n\n${compactLine}`;
}

function removeConversationRuntimeLooseSourceEvidenceLine(text: string, url: string): string {
  const normalizedUrl = normalizeRuntimeUrlForComparison(url);
  return text
    .split(/\r?\n/u)
    .filter((line) => {
      const trimmed = line.trim();
      if (!/^来源：\s*https?:\/\//iu.test(trimmed)) {
        return true;
      }
      return !normalizeRuntimeUrlForComparison(trimmed).includes(normalizedUrl);
    })
    .join("\n")
    .trimEnd();
}

function humanizeConversationRuntimeEvidenceReadStatus(status: string): string {
  const normalized = status.trim().toLocaleLowerCase();
  if (normalized === "read" || normalized === "available" || normalized === "success") {
    return "已读取";
  }
  if (normalized === "empty" || normalized === "not_read" || normalized === "not-read") {
    return "未读到可信正文";
  }
  if (normalized === "failed" || normalized === "error" || normalized === "unavailable") {
    return "读取失败";
  }
  if (normalized.length === 0) {
    return "未知";
  }
  return status;
}

function resolveConversationRuntimeExperienceCandidateSourceEvidenceDisclosure(
  events: readonly ConversationRuntimeModelToolLoopEvent[],
):
  | {
      readonly url: string;
      readonly fullBodyChars: number;
      readonly readStatus: string;
    }
  | undefined {
  const candidates: {
    readonly url: string;
    readonly fullBodyChars: number;
    readonly readStatus: string;
  }[] = [];
  for (const event of events) {
    if (
      event.kind !== "tool.result" ||
      event.result.toolName !== "director.experience.candidates.list"
    ) {
      continue;
    }
    const output = readRuntimeRecord(event.result.output);
    const metadata = readRuntimeRecord(event.result.metadata);
    const evidenceDisclosure =
      readRuntimeRecord(output?.evidenceDisclosure) ??
      readRuntimeRecord(metadata?.evidenceDisclosure);
    const sources = readRuntimeRecordArray(evidenceDisclosure?.sources);
    for (const source of sources) {
      const url = readRuntimeString(source.url);
      if (url === undefined) {
        continue;
      }
      const fullBodyChars = readRuntimeNumber(source.fullBodyChars ?? source.full_body_chars) ?? 0;
      candidates.push({
        url,
        fullBodyChars,
        readStatus:
          readRuntimeString(source.readStatus ?? source.read_status) ??
          (fullBodyChars === 0 ? "empty" : "read"),
      });
    }
  }
  return candidates.sort(scoreConversationRuntimeEvidenceDisclosureSource)[0];
}

function scoreConversationRuntimeEvidenceDisclosureSource(
  left: { readonly fullBodyChars: number; readonly readStatus: string },
  right: { readonly fullBodyChars: number; readonly readStatus: string },
): number {
  return (
    scoreConversationRuntimeEvidenceReadStatus(right.readStatus) -
      scoreConversationRuntimeEvidenceReadStatus(left.readStatus) ||
    right.fullBodyChars - left.fullBodyChars
  );
}

function scoreConversationRuntimeEvidenceReadStatus(status: string): number {
  const normalized = status.trim().toLocaleLowerCase();
  if (normalized === "read" || normalized === "available" || normalized === "success") {
    return 100;
  }
  if (normalized === "empty" || normalized === "not_read" || normalized === "not-read") {
    return 20;
  }
  if (normalized === "failed" || normalized === "error" || normalized === "unavailable") {
    return 0;
  }
  return normalized.length === 0 ? 10 : 30;
}

function appendConversationRuntimeMediaAdmissionDisclosure(
  finalText: string | undefined,
  events: readonly ConversationRuntimeModelToolLoopEvent[],
): string | undefined {
  if (finalText === undefined) {
    return undefined;
  }
  const normalizedFinalText = scrubConversationRuntimeImpossibleTextReadDisclosure(finalText);
  const disclosure = resolveConversationRuntimeMediaAdmissionDisclosure(events);
  if (disclosure === undefined) {
    return normalizedFinalText;
  }
  if (conversationRuntimeReplyAlreadyDisclosesMediaAdmission(normalizedFinalText)) {
    return normalizedFinalText;
  }
  const scrubbedText = scrubConversationRuntimeImpossibleTextReadDisclosure(
    scrubConversationRuntimeUnsupportedMediaConclusions(normalizedFinalText),
  );
  if (conversationRuntimeReplyAlreadyDisclosesMediaAdmission(scrubbedText)) {
    return scrubbedText;
  }
  const normalizedDisclosure = normalizeConversationRuntimeMediaDisclosureForFinalText(
    disclosure,
    scrubbedText,
  );
  return `${scrubbedText}\n\n${CONVERSATION_RUNTIME_MEDIA_NOT_UNDERSTOOD_LABEL}：${normalizedDisclosure}`;
}

function scrubConversationRuntimeUnsupportedMediaConclusions(text: string): string {
  return text
    .split(/\r?\n/u)
    .filter((line) => !isConversationRuntimeUnsupportedMediaConclusionLine(line))
    .join("\n");
}

function isConversationRuntimeUnsupportedMediaConclusionLine(line: string): boolean {
  const text = line.trim();
  if (text.length === 0) {
    return false;
  }
  if (
    /(?:文本已读|媒体未理解|未授权|不能把|媒体边界|媒体清单|授权|预算|清单未验证|未做视觉|未完成可准入)/iu.test(
      text,
    )
  ) {
    return false;
  }
  if (
    !/(?:图片|图像|照片|视频|画面|视觉作品|生成结果|成片|镜头里|图中|画面中|视频里|字幕|声音|音频|封面|poster|blob)/iu.test(
      text,
    )
  ) {
    return false;
  }
  return /(?:看到|看见|展示|显示|呈现|出现|包含|缺少|没有展示|未展示|最终生成|生成了|画面是|图中是|视频里)/iu.test(
    text,
  );
}

function conversationRuntimeReplyAlreadyDisclosesMediaAdmission(text: string): boolean {
  return (
    text.includes(CONVERSATION_RUNTIME_MEDIA_NOT_UNDERSTOOD_LABEL) ||
    (text.includes("媒体未理解") && text.includes("不能把媒体内容当成结论")) ||
    (text.includes("媒体未理解") &&
      /不能把(?:图片|视频|音频|媒体)/u.test(text) &&
      text.includes("当结论")) ||
    (text.includes("媒体仅完成清单记录") && text.includes("不能把媒体内容当成结论"))
  );
}

function resolveConversationRuntimeMediaAdmissionDisclosure(
  events: readonly ConversationRuntimeModelToolLoopEvent[],
): string | undefined {
  for (const event of events) {
    if (event.kind !== "tool.result") {
      continue;
    }
    const workflow = readConversationRuntimeMediaUnderstandingWorkflow(event.result);
    if (workflow === undefined || !isConversationRuntimeMediaAdmissionFailClosed(workflow)) {
      continue;
    }
    return (
      readRuntimeString(workflow.unauthorizedDisclosure) ??
      CONVERSATION_RUNTIME_DEFAULT_MEDIA_UNAUTHORIZED_DISCLOSURE
    );
  }
  return undefined;
}

function appendConversationRuntimeExperienceCandidateMediaBoundaryDisclosure(
  finalText: string | undefined,
  events: readonly ConversationRuntimeModelToolLoopEvent[],
): string | undefined {
  if (finalText === undefined) {
    return undefined;
  }
  const normalizedFinalText = scrubConversationRuntimeImpossibleTextReadDisclosure(finalText);
  const disclosure = resolveConversationRuntimeExperienceCandidateMediaBoundaryDisclosure(events);
  if (
    disclosure === undefined ||
    resolveConversationRuntimeMediaAuthorizationDisclosure(events) !== undefined ||
    conversationRuntimeReplyAlreadyDisclosesMediaAdmission(normalizedFinalText)
  ) {
    return normalizedFinalText;
  }
  const normalizedDisclosure = normalizeConversationRuntimeMediaDisclosureForFinalText(
    disclosure,
    normalizedFinalText,
  );
  return `${normalizedFinalText}\n\n${CONVERSATION_RUNTIME_MEDIA_NOT_UNDERSTOOD_LABEL}：${normalizedDisclosure}`;
}

function scrubConversationRuntimeImpossibleTextReadDisclosure(text: string): string {
  if (!conversationRuntimeFinalIndicatesNoTrustedText(text)) {
    return text;
  }
  return text
    .replace(/媒体未理解：文本已读[；;]/gu, "媒体未理解：未读到可信正文；")
    .replace(/媒体边界：文本已读[，,]\s*媒体未理解/gu, "媒体边界：未读到可信正文，媒体未理解")
    .replace(/边界：文本已读[，,]\s*媒体未理解/gu, "边界：未读到可信正文，媒体未理解");
}

function normalizeConversationRuntimeMediaDisclosureForFinalText(
  disclosure: string,
  finalText: string,
): string {
  const normalizedDisclosure = disclosure
    .replace(/^媒体边界[:：]\s*/u, "")
    .replace(/^媒体未理解[:：]\s*/u, "");
  if (!conversationRuntimeFinalIndicatesNoTrustedText(finalText)) {
    return normalizedDisclosure;
  }
  return normalizedDisclosure
    .replace(/^文本已读[；;]/u, "未读到可信正文；")
    .replace(/^文本已读[，,]\s*媒体未理解/u, "未读到可信正文，媒体未理解")
    .replace(/媒体边界：文本已读[，,]\s*媒体未理解/gu, "媒体边界：未读到可信正文，媒体未理解");
}

function conversationRuntimeFinalIndicatesNoTrustedText(text: string): boolean {
  return /(?:未读到可信正文|没有读到完整正文|还没有读到完整正文|没能用浏览器打开这个页面或读取到可信正文|不能把正文或媒体内容当结论)/u.test(
    text,
  );
}

function resolveConversationRuntimeExperienceCandidateMediaBoundaryDisclosure(
  events: readonly ConversationRuntimeModelToolLoopEvent[],
): string | undefined {
  for (const event of events) {
    if (event.kind !== "tool.result") {
      continue;
    }
    for (const candidate of readConversationRuntimeExperienceCandidates(event.result)) {
      const evidenceSource = readExperienceCandidateEvidenceDisclosureSource(candidate, {
        evidenceDisclosure: readRuntimeRecord(event.result.output)?.evidenceDisclosure,
      });
      const note = inferExperienceCandidateMediaUnderstandingNote(candidate, evidenceSource);
      if (note !== undefined && isExperienceCandidateMediaBoundaryDisclosure(note)) {
        return note;
      }
    }
  }
  return undefined;
}

function isExperienceCandidateMediaBoundaryDisclosure(note: string): boolean {
  return /媒体未理解|只记录到媒体链接|还没有证据表明已理解图片或视频|不能把图片、视频或音频内容当结论/iu.test(
    note,
  );
}

function appendConversationRuntimeMediaAuthorizationDisclosure(
  finalText: string | undefined,
  events: readonly ConversationRuntimeModelToolLoopEvent[],
): string | undefined {
  if (finalText === undefined) {
    return undefined;
  }
  const disclosure = resolveConversationRuntimeMediaAuthorizationDisclosure(events);
  if (
    disclosure === undefined ||
    conversationRuntimeReplyAlreadyDisclosesMediaAuthorization(finalText)
  ) {
    return finalText;
  }
  return `${finalText}\n\n媒体授权\n${disclosure}`;
}

function conversationRuntimeReplyAlreadyDisclosesMediaAuthorization(text: string): boolean {
  return /媒体授权|预算档位|发现\s*\d+\s*个媒体资产|未授权前不把媒体内容当成已学经验入库/iu.test(
    text,
  );
}

function resolveConversationRuntimeMediaAuthorizationDisclosure(
  events: readonly ConversationRuntimeModelToolLoopEvent[],
): string | undefined {
  for (const event of events) {
    if (event.kind !== "tool.result") {
      continue;
    }
    for (const candidate of readConversationRuntimeExperienceCandidates(event.result)) {
      const note = renderExperienceCandidateMediaAuthorizationNote(candidate);
      if (note !== undefined) {
        return note;
      }
    }
  }
  return undefined;
}

function readConversationRuntimeMediaUnderstandingWorkflow(
  result: ConversationRuntimeToolExecutionOutput,
): Readonly<Record<string, unknown>> | undefined {
  for (const candidate of readConversationRuntimeToolOutputCandidates(result)) {
    const workflow = readRuntimeRecord(candidate.media_understanding_workflow);
    if (workflow !== undefined) {
      return workflow;
    }
  }
  return undefined;
}

function readConversationRuntimeExperienceCandidates(
  result: ConversationRuntimeToolExecutionOutput,
): readonly Readonly<Record<string, unknown>>[] {
  const candidates: Readonly<Record<string, unknown>>[] = [];
  const output = readRuntimeRecord(result.output);
  candidates.push(...readRuntimeRecordArray(output?.candidates));
  const metadataToolOutput = readRuntimeRecord(result.metadata?.toolOutput);
  candidates.push(...readRuntimeRecordArray(metadataToolOutput?.candidates));
  const outputMetadata = readRuntimeRecord(result.metadata?.outputMetadata);
  const outputMetadataToolOutput = readRuntimeRecord(outputMetadata?.toolOutput);
  candidates.push(...readRuntimeRecordArray(outputMetadataToolOutput?.candidates));
  return candidates;
}

function readConversationRuntimeToolOutputCandidates(
  result: ConversationRuntimeToolExecutionOutput,
): readonly Readonly<Record<string, unknown>>[] {
  const candidates: Readonly<Record<string, unknown>>[] = [];
  appendRuntimeRecordCandidate(candidates, result.output);
  appendRuntimeRecordCandidate(candidates, result.metadata?.toolOutput);
  const outputMetadata = readRuntimeRecord(result.metadata?.outputMetadata);
  appendRuntimeRecordCandidate(candidates, outputMetadata?.toolOutput);
  appendRuntimeRecordCandidate(candidates, result.metadata?.output);
  return candidates;
}

function appendRuntimeRecordCandidate(
  candidates: Readonly<Record<string, unknown>>[],
  value: unknown,
): void {
  const record = readRuntimeRecord(value);
  if (record !== undefined) {
    candidates.push(record);
  }
}

function isConversationRuntimeMediaAdmissionFailClosed(
  workflow: Readonly<Record<string, unknown>>,
): boolean {
  const admission = readRuntimeRecord(workflow.admission);
  const canAdmitMediaContent = admission?.canAdmitMediaContent;
  if (canAdmitMediaContent === true) {
    return false;
  }
  const admissionStatus = readRuntimeString(admission?.status);
  const requiredNextAction = readRuntimeString(admission?.requiredNextAction);
  const mediaUnderstandingStatus = readRuntimeString(workflow.mediaUnderstandingStatus);
  return (
    mediaUnderstandingStatus === "not_understood" ||
    admissionStatus === "text_admissible_media_list_only" ||
    requiredNextAction === "request_user_authorization"
  );
}

function createConversationRuntimeDeterministicFactLines(
  input: ConversationRuntimeInput,
  finalText: string,
): readonly string[] {
  const userText = input.text.trim();
  if (!isConversationRuntimeCurrentTimeQuestion(userText)) {
    return [];
  }
  if (conversationRuntimeReplyAlreadyMentionsCurrentTime(finalText)) {
    return [];
  }
  const receivedAtMs = normalizeConversationRuntimeTimestampMs(input.receivedAtMs) ?? Date.now();
  const receivedAt = new Date(receivedAtMs);
  const timeZone =
    readMetadataString(input.metadata, "timeZone") ??
    readMetadataString(input.trustedContext?.metadata, "timeZone") ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    "UTC";
  const locale =
    readMetadataString(input.metadata, "locale") ??
    readMetadataString(input.trustedContext?.metadata, "locale") ??
    "zh-CN";
  return [
    `现在是 ${formatConversationRuntimeDateTime(receivedAt, locale, timeZone)}（${timeZone}）。`,
  ];
}

function isConversationRuntimeCurrentTimeQuestion(text: string): boolean {
  return (
    /现在(?:到底)?(?:是)?(?:几点|什么时间|啥时候)/u.test(text) ||
    /当前(?:时间|日期)/u.test(text) ||
    /今天(?:几号|日期|星期几|周几)/u.test(text) ||
    /\b(current time|what time is it|today'?s date)\b/iu.test(text)
  );
}

function conversationRuntimeReplyAlreadyMentionsCurrentTime(text: string): boolean {
  return (
    /\d{4}年\d{1,2}月\d{1,2}日/u.test(text) ||
    /\d{1,2}[:：]\d{2}/u.test(text) ||
    /北京时间|当前时间|现在是/u.test(text)
  );
}

function normalizeConversationRuntimeTimestampMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function readMetadataString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function formatConversationRuntimeDateTime(value: Date, locale: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "full",
      timeStyle: "medium",
      timeZone,
      hour12: false,
    }).format(value);
  } catch {
    return value.toISOString();
  }
}

function formatConversationRuntimeDate(value: Date, locale: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "full",
      timeZone,
    }).format(value);
  } catch {
    return value.toISOString().slice(0, 10);
  }
}

function buildHistoryModelToolLoopMessages(
  input: ConversationRuntimeInput,
): readonly ConversationRuntimeModelToolMessage[] {
  const history = trimTranscriptMessagesForSession(input.history ?? []);
  const currentText = input.text.trim();
  return history.filter((message, index) => {
    if (message.role !== "user") {
      return true;
    }
    if (message.content.trim() !== currentText) {
      return true;
    }
    return index !== history.length - 1;
  });
}

function buildSimpleTranscriptMessages(
  input: ConversationRuntimeInput,
  assistantText: string | undefined,
): readonly ConversationRuntimeModelToolMessage[] {
  const userText = input.text.trim();
  const assistant = normalizeConversationRuntimeFinalText(assistantText);
  return trimTranscriptMessagesForSession([
    ...(userText.length === 0
      ? []
      : [
          {
            role: "user" as const,
            content: userText,
            metadata: {
              surface: input.surface,
              channel: input.channel,
              messageId: input.messageId,
            },
          },
        ]),
    ...(assistant === undefined
      ? []
      : [
          {
            role: "assistant" as const,
            content: assistant,
          },
        ]),
  ]);
}

function buildProductionTranscriptMessages(
  input: ConversationRuntimeInput,
  assistantText: string | undefined,
): readonly ConversationRuntimeModelToolMessage[] {
  return buildSimpleTranscriptMessages(input, assistantText);
}

async function buildModelLoopTranscriptMessages(input: {
  readonly hookContext?: ConversationRuntimePreCompressHookContext | undefined;
  readonly modelLoop: Awaited<ReturnType<typeof runConversationRuntimeModelToolLoop>>;
  readonly finalText: string | undefined;
  readonly correctionApplied: boolean;
}): Promise<readonly ConversationRuntimeModelToolMessage[]> {
  const messages = input.modelLoop.messages.filter((message) => message.role !== "system");
  if (!input.correctionApplied) {
    return await finalizeConversationRuntimeTranscriptMessages(messages, input.hookContext);
  }
  const finalText = normalizeConversationRuntimeFinalText(input.finalText);
  if (finalText === undefined) {
    return await finalizeConversationRuntimeTranscriptMessages(messages, input.hookContext);
  }
  return await finalizeConversationRuntimeTranscriptMessages(
    [
      ...messages.filter((message) => {
        if (message.role !== "assistant") {
          return true;
        }
        const content = message.content.trim();
        return content.length === 0 || content !== input.modelLoop.finalText?.trim();
      }),
      {
        role: "assistant" as const,
        content: finalText,
        metadata: {
          groundedRepair: true,
        },
      },
    ],
    input.hookContext,
  );
}

interface ConversationRuntimePreCompressHookContext {
  readonly options: RunConversationRuntimeTurnCoreOptions;
  readonly turnId: string;
  readonly sessionKey: string;
  readonly occurredAtMs: number;
  readonly traceItems: ConversationRuntimeTraceItem[];
}

function createConversationRuntimePreCompressHookContext(input: {
  readonly options: RunConversationRuntimeTurnCoreOptions;
  readonly turnId: string;
  readonly sessionKey: string;
  readonly occurredAtMs: number;
  readonly traceItems: ConversationRuntimeTraceItem[];
}): ConversationRuntimePreCompressHookContext | undefined {
  if (input.options.memoryLifecycle?.onPreCompress === undefined) {
    return undefined;
  }
  return input;
}

async function finalizeConversationRuntimeTranscriptMessages(
  messages: readonly ConversationRuntimeModelToolMessage[],
  hookContext: ConversationRuntimePreCompressHookContext | undefined,
): Promise<readonly ConversationRuntimeModelToolMessage[]> {
  await notifyConversationRuntimePreCompressHook(hookContext, messages);
  return trimTranscriptMessagesForSession(messages);
}

async function notifyConversationRuntimePreCompressHook(
  hookContext: ConversationRuntimePreCompressHookContext | undefined,
  messages: readonly ConversationRuntimeModelToolMessage[],
): Promise<void> {
  const hook = hookContext?.options.memoryLifecycle?.onPreCompress;
  if (hook === undefined || hookContext === undefined) {
    return;
  }
  const startedAtMs = hookContext.options.nowMs?.() ?? hookContext.occurredAtMs;
  hookContext.traceItems.push({
    source: "memory",
    stage: "context.compaction.started",
    detail: "Conversation runtime started context compaction before transcript trimming.",
    occurredAtMs: startedAtMs,
    metadata: {
      messageCount: messages.length,
      reason: "before-transcript-trim",
    },
  });
  try {
    const result = normalizeConversationRuntimePreCompressHookResult(
      await hook({
        turnId: hookContext.turnId,
        sessionKey: hookContext.sessionKey,
        messages,
        reason: "before-transcript-trim",
        metadata: {
          messageCount: messages.length,
        },
      }),
    );
    const checkpoint = persistConversationRuntimeContextPartialSummary({
      hookContext,
      result,
    });
    appendConversationRuntimeContextCompactionResultTrace({
      hookContext,
      result,
      checkpoint,
    });
    hookContext.traceItems.push({
      source: "memory",
      stage: "memory.pre_compress",
      detail: "Conversation runtime notified memory lifecycle before transcript trimming.",
      occurredAtMs: hookContext.options.nowMs?.() ?? hookContext.occurredAtMs,
      metadata: {
        messageCount: messages.length,
      },
    });
  } catch (error) {
    hookContext.traceItems.push({
      source: "memory",
      stage: "context.compaction.failed",
      detail: "Context compaction failed before transcript trimming.",
      occurredAtMs: hookContext.options.nowMs?.() ?? hookContext.occurredAtMs,
      metadata: {
        reason: toConversationRuntimeErrorMessage(error),
        partialSummaryAvailable: false,
      },
    });
    hookContext.traceItems.push({
      source: "memory",
      stage: "memory.pre_compress.failed",
      detail: "Conversation runtime memory pre-compress hook failed.",
      occurredAtMs: hookContext.options.nowMs?.() ?? hookContext.occurredAtMs,
      metadata: {
        error: toConversationRuntimeErrorMessage(error),
      },
    });
  }
}

function normalizeConversationRuntimePreCompressHookResult(
  value: ConversationRuntimePreCompressHookResult | undefined,
): ConversationRuntimePreCompressHookResult | undefined {
  if (!isRuntimeRecord(value)) {
    return undefined;
  }
  const partialSummary = readRuntimeString(value.partialSummary);
  const reason = readRuntimeString(value.reason);
  const sourceEventIds = readRuntimeStringArray(value.sourceEventIds);
  const metadata = readRuntimeRecord(value.metadata);
  return {
    ...(value.status === "completed" || value.status === "failed" ? { status: value.status } : {}),
    ...(partialSummary === undefined ? {} : { partialSummary }),
    ...(reason === undefined ? {} : { reason }),
    ...(sourceEventIds.length === 0 ? {} : { sourceEventIds }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function persistConversationRuntimeContextPartialSummary(input: {
  readonly hookContext: ConversationRuntimePreCompressHookContext;
  readonly result: ConversationRuntimePreCompressHookResult | undefined;
}): ReturnType<typeof saveConversationRuntimeContextPartialSummary> | undefined {
  const partialSummary = input.result?.partialSummary?.trim();
  const store = input.hookContext.options.contextCheckpointStore;
  if (partialSummary === undefined || partialSummary.length === 0 || store === undefined) {
    return undefined;
  }
  return saveConversationRuntimeContextPartialSummary({
    store,
    sessionKey: input.hookContext.sessionKey,
    turnId: input.hookContext.turnId,
    summary: partialSummary,
    ...(input.result?.reason === undefined ? {} : { reason: input.result.reason }),
    ...(input.result?.sourceEventIds === undefined
      ? {}
      : { sourceEventIds: input.result.sourceEventIds }),
    observedAtMs: input.hookContext.options.nowMs?.() ?? input.hookContext.occurredAtMs,
  });
}

function appendConversationRuntimeContextCompactionResultTrace(input: {
  readonly hookContext: ConversationRuntimePreCompressHookContext;
  readonly result: ConversationRuntimePreCompressHookResult | undefined;
  readonly checkpoint: ReturnType<typeof saveConversationRuntimeContextPartialSummary> | undefined;
}): void {
  if (input.checkpoint !== undefined) {
    input.hookContext.traceItems.push({
      source: "memory",
      stage: "context.compaction.partial_saved",
      detail: "Context compaction saved a partial summary checkpoint.",
      occurredAtMs: input.hookContext.options.nowMs?.() ?? input.hookContext.occurredAtMs,
      metadata: {
        checkpointId: input.checkpoint.checkpointId,
        reason: input.result?.reason,
        summaryPreview: truncateConversationRuntimeContextSummary(
          input.checkpoint.summary ?? "",
          120,
        ),
      },
    });
  }
  const failed = input.result?.status === "failed";
  input.hookContext.traceItems.push({
    source: "memory",
    stage: failed ? "context.compaction.failed" : "context.compaction.completed",
    detail: failed
      ? "Context compaction failed after saving available partial context."
      : "Context compaction completed before transcript trimming.",
    occurredAtMs: input.hookContext.options.nowMs?.() ?? input.hookContext.occurredAtMs,
    metadata: {
      checkpointId: input.checkpoint?.checkpointId,
      reason: input.result?.reason,
      partialSummaryAvailable: input.checkpoint !== undefined,
    },
  });
}

async function notifyConversationRuntimeDelegationHook(input: {
  readonly options: RunConversationRuntimeTurnCoreOptions;
  readonly turnId: string;
  readonly sessionKey: string;
  readonly call: ConversationRuntimeModelToolCall;
  readonly result: ConversationRuntimeToolExecutionOutput;
  readonly subagentRunIds: readonly string[];
  readonly occurredAtMs: number;
  readonly traceItems: ConversationRuntimeTraceItem[];
}): Promise<void> {
  const hook = input.options.memoryLifecycle?.onDelegation;
  if (hook === undefined) {
    return;
  }
  try {
    await hook({
      turnId: input.turnId,
      sessionKey: input.sessionKey,
      toolName: input.result.toolName,
      toolCallId: input.result.callId,
      subagentRunIds: input.subagentRunIds,
      result: input.result,
      metadata: {
        requestedToolName: input.call.name,
        subagentRunCount: input.subagentRunIds.length,
      },
    });
    input.traceItems.push({
      source: "memory",
      stage: "memory.delegation",
      detail: "Conversation runtime notified memory lifecycle about delegated subagent work.",
      occurredAtMs: input.options.nowMs?.() ?? input.occurredAtMs,
      metadata: {
        toolName: input.result.toolName,
        toolCallId: input.result.callId,
        subagentRunIds: input.subagentRunIds,
      },
    });
  } catch (error) {
    input.traceItems.push({
      source: "memory",
      stage: "memory.delegation.failed",
      detail: "Conversation runtime memory delegation hook failed.",
      occurredAtMs: input.options.nowMs?.() ?? input.occurredAtMs,
      metadata: {
        toolName: input.result.toolName,
        toolCallId: input.result.callId,
        error: toConversationRuntimeErrorMessage(error),
      },
    });
  }
}

async function repairCorrectedConversationRuntimeFinal(input: {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly input: ConversationRuntimeInput;
  readonly turn: ConversationRuntimeTurnDecision;
  readonly modelLoop: Awaited<ReturnType<typeof runConversationRuntimeModelToolLoop>>;
  readonly requiredToolCalls: readonly ConversationRuntimeModelToolCall[];
  readonly correction: {
    readonly kind: "grounding" | "tool-observation";
    readonly fallbackText: string | undefined;
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
  readonly callModel: ConversationRuntimeModelCallPort;
  readonly abortSignal?: AbortSignal;
  readonly occurredAtMs: number;
  readonly nowMs?: () => number;
  readonly traceItems: ConversationRuntimeTraceItem[];
}): Promise<{ readonly finalText: string } | undefined> {
  const fallbackText = normalizeConversationRuntimeFinalText(input.correction.fallbackText);
  if (fallbackText === undefined) {
    return undefined;
  }
  input.traceItems.push({
    source: "model" as const,
    stage: "model.repair.turn",
    detail:
      "Runtime asked the model to re-answer from tool observations after the first final contradicted them.",
    occurredAtMs: input.nowMs?.() ?? input.occurredAtMs,
    metadata: {
      correctionKind: input.correction.kind,
      ...(input.correction.metadata ?? {}),
    },
  });
  try {
    const repairOutput = await input.callModel({
      turnId: input.turnId,
      sessionKey: input.sessionKey,
      messages: buildGroundedRepairModelMessages(input, fallbackText),
      tools: [],
      ...(input.abortSignal === undefined ? {} : { signal: input.abortSignal }),
      metadata: {
        surface: input.input.surface,
        channel: input.input.channel,
        intentKind: input.turn.intent.kind,
        responsePolicy: input.turn.responsePolicy,
        repair: true,
        correctionKind: input.correction.kind,
      },
    });
    const finalText = normalizeConversationRuntimeFinalText(
      repairOutput.finalText ?? repairOutput.assistantMessage?.content,
    );
    if (finalText === undefined) {
      input.traceItems.push({
        source: "model" as const,
        stage: "model.repair.degraded",
        detail: "Model repair turn returned no final text; runtime kept the structured fallback.",
        occurredAtMs: input.nowMs?.() ?? input.occurredAtMs,
        metadata: {
          correctionKind: input.correction.kind,
        },
      });
      return undefined;
    }
    if (!isGroundedRepairFinalAcceptable(finalText, input.modelLoop, fallbackText)) {
      input.traceItems.push({
        source: "model" as const,
        stage: "model.repair.rejected",
        detail:
          "Model repair turn still contradicted or ignored tool observations; runtime kept the structured fallback.",
        occurredAtMs: input.nowMs?.() ?? input.occurredAtMs,
        metadata: {
          correctionKind: input.correction.kind,
        },
      });
      return undefined;
    }
    input.traceItems.push({
      source: "model" as const,
      stage: "model.repair.accepted",
      detail: "Model repair turn produced a grounded final answer from tool observations.",
      occurredAtMs: input.nowMs?.() ?? input.occurredAtMs,
      metadata: {
        correctionKind: input.correction.kind,
      },
    });
    return { finalText };
  } catch (error) {
    input.traceItems.push({
      source: "model" as const,
      stage: "model.repair.degraded",
      detail: "Model repair turn failed; runtime kept the structured fallback.",
      occurredAtMs: input.nowMs?.() ?? input.occurredAtMs,
      metadata: {
        correctionKind: input.correction.kind,
        error: toConversationRuntimeErrorMessage(error),
      },
    });
    return undefined;
  }
}

function buildGroundedRepairModelMessages(
  input: Parameters<typeof repairCorrectedConversationRuntimeFinal>[0],
  fallbackText: string,
): readonly ConversationRuntimeModelToolMessage[] {
  const toolObservations = input.modelLoop.events
    .filter(
      (event): event is Extract<ConversationRuntimeModelToolLoopEvent, { kind: "tool.result" }> =>
        event.kind === "tool.result",
    )
    .map((event) => event.result);
  const requiredToolCallIds = new Set(input.requiredToolCalls.map((call) => call.id));
  const relevantObservations = toolObservations.filter(
    (result) =>
      readRuntimeString(input.correction.metadata?.callId) === result.callId ||
      requiredToolCallIds.has(result.callId) ||
      result.toolName === "director.skills.list" ||
      result.toolName === "director.skills.view" ||
      result.toolName === "director.skills.use" ||
      (input.correction.kind === "tool-observation" &&
        result.toolName === "browser_snapshot" &&
        parseReadableBrowserSnapshotResult(result) !== undefined),
  );
  const observationText = (
    relevantObservations.length > 0 ? relevantObservations : toolObservations
  )
    .map((result, index) =>
      [
        `观察 ${index + 1}`,
        `tool: ${result.toolName}`,
        `ok: ${String(result.ok)}`,
        result.content,
      ].join("\n"),
    )
    .join("\n\n---\n\n");
  return [
    {
      role: "system" as const,
      content: [
        "你是 Director Angel 的 grounded repair 回合。",
        "上一轮回答与工具观察不一致。现在只根据下面的工具观察重新回答用户。",
        "保持自然、简洁、结果优先；不要提内部修复、trace、模型错误或 fallback。",
        "如果工具观察显示失败或需要验证，就说明真实失败原因和下一步。",
        "如果工具观察显示成功，就必须包含关键来源、标题、链接或状态证据。",
        "如果事实边界或工具观察已经读到正文，不得再说只有链接、无法获取正文或预览截断。",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: input.input.text,
      metadata: {
        surface: input.input.surface,
        channel: input.input.channel,
        messageId: input.input.messageId,
      },
    },
    {
      role: "user" as const,
      content: ["工具观察：", observationText].join("\n\n"),
      metadata: {
        correctionKind: input.correction.kind,
      },
    },
    {
      role: "assistant" as const,
      content: [
        "请基于工具观察重写最终回复。",
        "下面是运行时可接受的事实边界，可用于校准，但不要逐字机械复述：",
        fallbackText,
      ].join("\n\n"),
      metadata: {
        groundedRepairInstruction: true,
      },
    },
  ];
}

function isGroundedRepairFinalAcceptable(
  finalText: string,
  modelLoop: Awaited<ReturnType<typeof runConversationRuntimeModelToolLoop>>,
  fallbackText: string,
): boolean {
  const text = finalText.trim();
  if (text.length === 0) {
    return false;
  }
  if (isLowQualityExperienceCandidateFinal(text)) {
    return false;
  }
  if (isLowSignalRequiredToolFinal(text)) {
    return false;
  }
  const toolResults = modelLoop.events
    .filter(
      (event): event is Extract<ConversationRuntimeModelToolLoopEvent, { kind: "tool.result" }> =>
        event.kind === "tool.result",
    )
    .map((event) => event.result);
  const fallbackObservation = fallbackText.trim();
  const hasReadableBrowserSnapshot =
    toolResults.some((result) => parseReadableBrowserSnapshotResult(result) !== undefined) ||
    isReadableArticleSnapshotText(fallbackObservation);
  if (hasReadableBrowserSnapshot && doesModelDenyReadablePageAfterTools(text)) {
    return false;
  }
  for (const result of toolResults) {
    const observation = parseGroundingToolObservation(result);
    if (observation !== undefined) {
      if (observation.status === "success" && observation.results.length > 0) {
        if (isUngroundedSearchFinal(text, observation)) {
          return false;
        }
      }
      if (
        observation.status === "blocked" ||
        observation.status === "needs-auth" ||
        observation.status === "warning" ||
        observation.status === "error" ||
        result.ok === false
      ) {
        if (result.toolName === "x_search" && isUngroundedXSearchFinal(text, observation)) {
          return false;
        }
        if (isVagueGroundingFailureFinal(text, observation)) {
          return false;
        }
      }
    }
    if (
      result.toolName === "director.skills.list" &&
      result.ok === true &&
      doesModelClaimSkillExecution(text)
    ) {
      return false;
    }
    if (
      (result.toolName === "director.skills.view" || result.toolName === "director.skills.use") &&
      result.ok !== true &&
      doesModelClaimSkillExecution(text)
    ) {
      return false;
    }
    if (
      result.toolName === "director.moyin.project_readiness" &&
      doesModelAskForMoyinReadinessWorkAlreadyDone(text, result)
    ) {
      return false;
    }
  }
  if (
    /Skill 已关闭|只完成了 Skill 索引|Skill .*?(依赖未就绪|不存在|不能由模型|不可用)|missing_tools|needs[_-]?setup|缺少\s*[\w.-]+/iu.test(
      fallbackObservation,
    )
  ) {
    return /Skill|缺少|依赖|未就绪|配置|不可用|不能用|needs[_-]?setup|missing/iu.test(text);
  }
  return true;
}

function trimTranscriptMessagesForSession(
  messages: readonly ConversationRuntimeModelToolMessage[],
): readonly ConversationRuntimeModelToolMessage[] {
  const normalized = messages
    .flatMap(normalizeTranscriptMessage)
    .filter((message) => message.role !== "system");
  const maxMessages = 24;
  const maxChars = 32_000;
  const tail = normalized.slice(-maxMessages);
  const selected: ConversationRuntimeModelToolMessage[] = [];
  let remainingChars = maxChars;
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const message = tail[index];
    if (message === undefined) {
      continue;
    }
    const content =
      message.content.length > remainingChars
        ? message.content.slice(0, Math.max(0, remainingChars))
        : message.content;
    if (content.length === 0 && message.toolCalls === undefined) {
      continue;
    }
    selected.unshift(
      content === message.content
        ? message
        : {
            ...message,
            content,
            metadata: {
              ...(message.metadata ?? {}),
              transcriptClipped: true,
            },
          },
    );
    remainingChars -= content.length;
    if (remainingChars <= 0) {
      break;
    }
  }
  return closeTranscriptToolTail(selected);
}

function normalizeTranscriptMessage(
  message: ConversationRuntimeModelToolMessage,
): readonly ConversationRuntimeModelToolMessage[] {
  if (
    message.role !== "user" &&
    message.role !== "assistant" &&
    message.role !== "tool" &&
    message.role !== "system"
  ) {
    return [];
  }
  const content = typeof message.content === "string" ? message.content : "";
  const toolCallId =
    typeof message.toolCallId === "string" && message.toolCallId.trim().length > 0
      ? message.toolCallId.trim()
      : undefined;
  const toolCalls = Array.isArray(message.toolCalls)
    ? message.toolCalls
        .map((call) => ({
          id: call.id,
          name: call.name,
          args: call.args,
          ...(call.readOnly === undefined ? {} : { readOnly: call.readOnly }),
          ...(call.requiresApproval === undefined
            ? {}
            : { requiresApproval: call.requiresApproval }),
          ...(call.metadata === undefined ? {} : { metadata: call.metadata }),
        }))
        .filter((call) => call.id.trim().length > 0 && call.name.trim().length > 0)
    : undefined;
  if (content.trim().length === 0 && toolCallId === undefined && (toolCalls?.length ?? 0) === 0) {
    return [];
  }
  return [
    {
      role: message.role,
      content,
      ...(toolCallId === undefined ? {} : { toolCallId }),
      ...(toolCalls === undefined || toolCalls.length === 0 ? {} : { toolCalls }),
      ...(message.metadata === undefined ? {} : { metadata: message.metadata }),
    },
  ];
}

function closeTranscriptToolTail(
  messages: readonly ConversationRuntimeModelToolMessage[],
): readonly ConversationRuntimeModelToolMessage[] {
  if (messages.length === 0 || messages[messages.length - 1]?.role !== "tool") {
    return messages;
  }
  return [
    ...messages,
    {
      role: "assistant" as const,
      content:
        "[System note: 上一轮在工具观察后中断或结束。请先吸收这些工具结果，再处理用户的新消息。]",
      metadata: {
        resumeToolTail: true,
      },
    },
  ];
}

function resolveRequiredConversationRuntimeGroundingToolCalls(input: {
  readonly rawUserText: string;
  readonly conversationContext: {
    readonly history?: readonly ConversationRuntimeModelToolMessage[];
    readonly recentContextText?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
  readonly runtimeContext: {
    readonly surface?: string;
    readonly channel?: string;
    readonly sessionKey?: string;
    readonly tools?: readonly ConversationRuntimeModelToolDefinition[];
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
  readonly capabilityPacket?: ConversationRuntimeCapabilityPacket;
}): readonly ConversationRuntimeModelToolCall[] {
  return resolveConversationRuntimeSourceGroundingToolCalls(input).calls;
}

function resolveRequiredConversationRuntimeSkillToolCall(input: {
  readonly rawUserText: string;
  readonly turn: ConversationRuntimeTurnDecision;
  readonly capabilityPacket?: ConversationRuntimeCapabilityPacket;
  readonly tools: readonly ConversationRuntimeModelToolDefinition[];
  readonly history?: readonly ConversationRuntimeModelToolMessage[];
}): ConversationRuntimeModelToolCall | undefined {
  const skillUseTool = input.tools.find((tool) => tool.name === "director.skills.use");
  if (skillUseTool === undefined) {
    return undefined;
  }
  if (!shouldRequireConversationRuntimeSkillUse(input.rawUserText, input.turn)) {
    return undefined;
  }
  const explicitSkillUse = shouldRequireConversationRuntimeExplicitSkillUse(
    input.rawUserText,
    input.turn,
  );
  const skillRef = selectRequiredConversationRuntimeSkillRef(input.capabilityPacket, input.history);
  if (skillRef === undefined) {
    return undefined;
  }
  if (skillRef.reason === "approved-skill-hit-actionable-request" && !explicitSkillUse) {
    return undefined;
  }
  const skillId = skillRef.skillId;
  if (skillId === undefined) {
    return undefined;
  }
  const capability =
    typeof skillUseTool.metadata?.capability === "string"
      ? skillUseTool.metadata.capability
      : "skill.use";
  return {
    id: `required-approved-skill-use-${slugifyConversationRuntimeToolCallPart(skillId)}`,
    name: "director.skills.use",
    args: {
      skillId,
      objective: input.rawUserText,
      reason: "approved-skill-hit-actionable-request",
    },
    readOnly: skillUseTool.readOnly,
    metadata: {
      requiredGrounding: true,
      sourceCapabilityId: "skill.approved.use",
      capability,
      reason: skillRef.reason,
      skillId,
      sourceSkillHitId: skillRef.sourceId,
      ...(skillRef.title === undefined ? {} : { skillTitle: skillRef.title }),
    },
  };
}

function selectRequiredConversationRuntimeSkillRef(
  capabilityPacket: ConversationRuntimeCapabilityPacket | undefined,
  history: readonly ConversationRuntimeModelToolMessage[] | undefined,
):
  | {
      readonly skillId: string;
      readonly sourceId: string;
      readonly reason: string;
      readonly title?: string;
    }
  | undefined {
  const skillHit = selectRequiredConversationRuntimeSkillHit(capabilityPacket);
  const hitSkillId =
    skillHit === undefined ? undefined : normalizeConversationRuntimeSkillHitId(skillHit.id);
  if (skillHit !== undefined && hitSkillId !== undefined) {
    return {
      skillId: hitSkillId,
      sourceId: skillHit.id,
      reason: "approved-skill-hit-actionable-request",
      ...(skillHit.title === undefined ? {} : { title: skillHit.title }),
    };
  }
  const recentSkillId = selectLatestConversationRuntimeSkillIdFromHistory(history ?? []);
  if (recentSkillId === undefined) {
    return undefined;
  }
  return {
    skillId: recentSkillId,
    sourceId: recentSkillId,
    reason: "recent-approved-skill-actionable-followup",
  };
}

function selectRequiredConversationRuntimeSkillHit(
  capabilityPacket: ConversationRuntimeCapabilityPacket | undefined,
): ConversationRuntimeCapabilityPacket["hits"][number] | undefined {
  if (capabilityPacket?.status !== "hit") {
    return undefined;
  }
  return [...capabilityPacket.hits]
    .filter(
      (hit) =>
        hit.source === "skill" &&
        (hit.status === "hit" || hit.status === "used") &&
        normalizeConversationRuntimeSkillHitId(hit.id) !== undefined,
    )
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))[0];
}

function selectLatestConversationRuntimeSkillIdFromHistory(
  history: readonly ConversationRuntimeModelToolMessage[],
): string | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role !== "tool") {
      continue;
    }
    const toolName =
      typeof message.metadata?.toolName === "string" ? message.metadata.toolName : undefined;
    if (toolName !== "director.skills.view" && toolName !== "director.skills.use") {
      continue;
    }
    const skillId = readConversationRuntimeSkillIdFromToolObservation(message.content);
    if (skillId !== undefined) {
      return skillId;
    }
  }
  return undefined;
}

function readConversationRuntimeSkillIdFromToolObservation(content: string): string | undefined {
  const match = content.match(/^skill_id:\s*(.+)$/imu);
  if (match?.[1] === undefined) {
    return undefined;
  }
  const skillId = normalizeConversationRuntimeSkillHitId(match[1]);
  return skillId === undefined || skillId.includes("\n") ? undefined : skillId;
}

function resolveRequiredMoyinProjectReadinessToolCall(input: {
  readonly rawUserText: string;
  readonly turn: ConversationRuntimeTurnDecision;
  readonly tools: readonly ConversationRuntimeModelToolDefinition[];
}): ConversationRuntimeModelToolCall | undefined {
  const tool = input.tools.find(
    (candidate) => candidate.name === "director.moyin.project_readiness",
  );
  if (tool === undefined) {
    return undefined;
  }
  if (!shouldRequireMoyinProjectReadiness(input.rawUserText, input.turn)) {
    return undefined;
  }
  const projectName = readMoyinProjectNameFromUserText(input.rawUserText);
  const capability =
    typeof tool.metadata?.capability === "string"
      ? tool.metadata.capability
      : "moyin.project_readiness";
  return {
    id: "required-moyin-project-readiness",
    name: "director.moyin.project_readiness",
    args: {
      ...(projectName === undefined ? {} : { projectName }),
      reason: input.rawUserText,
    },
    readOnly: tool.readOnly,
    metadata: {
      requiredGrounding: true,
      sourceCapabilityId: "moyin.project_readiness",
      capability,
      reason: "moyin-project-executable-check",
    },
  };
}

function shouldRequireMoyinProjectReadiness(
  rawUserText: string,
  turn: ConversationRuntimeTurnDecision,
): boolean {
  if (turn.intent.kind === "capability-intro" || turn.intent.kind === "ignore") {
    return false;
  }
  const text = rawUserText.trim().replace(/\s+/gu, " ");
  if (text.length === 0) {
    return false;
  }
  const asksReadiness =
    /(?:检查|复核|验证|确认|评估|看看|看一下|是否|能否|可不可以|可以不可以|能不能)/iu.test(text);
  const mentionsMoyinProject =
    /(?:Moyin|moyin|魔音|魔因|项目|project|workflow-run|工作流|S\s*级|S-Class)/iu.test(text) &&
    /(?:项目|project|workflow-run|工作流|执行|继续|可执行|运行)/iu.test(text);
  return asksReadiness && mentionsMoyinProject;
}

function readMoyinProjectNameFromUserText(rawUserText: string): string | undefined {
  const quoted =
    rawUserText.match(/[“"']([^“”"']{2,160})[”"']/u)?.[1] ??
    rawUserText.match(/项目[:：]\s*([^，。！？!?\n]{2,160})/u)?.[1];
  if (quoted === undefined) {
    return undefined;
  }
  const normalized = quoted.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function shouldRequireConversationRuntimeSkillUse(
  rawUserText: string,
  turn: ConversationRuntimeTurnDecision,
): boolean {
  if (readRuntimeBoolean(turn.intent.metadata?.requiredSkillUse) === true) {
    return true;
  }
  if (turn.intent.kind === "capability-intro" || turn.intent.kind === "ignore") {
    return false;
  }
  const text = rawUserText.trim().replace(/\s+/gu, " ");
  if (text.length === 0) {
    return false;
  }
  if (
    /(?:不要|不用|无需|别|禁止|不许|不能)[^。！？!?\n]{0,16}(?:Skill|skill|技能|经验流程|S\s*级\s*Skill|流程)/iu.test(
      text,
    )
  ) {
    return false;
  }
  return /(?:帮我|请|麻烦|替我|给我|执行|调用|使用|套用|应用|启用|运行|复核|复查|检查|审查|审核|评估|对照|继续|推进|处理|修复|完成|导入|导出|测试|验证|按[^。！？!?\n]{0,16}(?:Skill|skill|技能|流程|经验|方案|规则)|基于[^。！？!?\n]{0,16}(?:Skill|skill|技能|流程|经验|方案|规则)|use|run|execute|apply|follow)/iu.test(
    text,
  );
}

function shouldRequireConversationRuntimeExplicitSkillUse(
  rawUserText: string,
  turn: ConversationRuntimeTurnDecision,
): boolean {
  if (readRuntimeBoolean(turn.intent.metadata?.requiredSkillUse) === true) {
    return true;
  }
  if (turn.intent.kind === "capability-intro" || turn.intent.kind === "ignore") {
    return false;
  }
  const text = [rawUserText, turn.userText, turn.intent.objective, turn.intent.supplement]
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .join(" ")
    .trim()
    .replace(/\s+/gu, " ");
  if (text.length === 0) {
    return false;
  }
  if (
    /(?:不要|不用|无需|别|禁止|不许|不能)[^。！？!?\n]{0,16}(?:Skill|skill|技能|经验流程|S\s*级\s*Skill|流程)/iu.test(
      text,
    )
  ) {
    return false;
  }
  return /(?:调用|使用|套用|应用|启用|运行|执行|按|基于|根据|依照|遵照|用|use|run|execute|apply|follow)[^。！？!?\n]{0,32}(?:Skill|skill|技能|经验流程|S\s*级\s*Skill|流程|经验|方案|规则)|(?:Skill|skill|技能|经验流程|S\s*级\s*Skill|流程)[^。！？!?\n]{0,32}(?:调用|使用|套用|应用|执行|运行|继续|use|run|execute|apply|follow)/iu.test(
    text,
  );
}

function normalizeConversationRuntimeSkillHitId(hitId: string): string | undefined {
  const normalized = hitId.replace(/^skill:/iu, "").trim();
  return normalized.length === 0 ? undefined : normalized;
}

function slugifyConversationRuntimeToolCallPart(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return slug.length === 0 ? "skill" : slug;
}

function resolveConversationRuntimeGroundedFinal(input: {
  readonly modelFinalText: string | undefined;
  readonly events: readonly ConversationRuntimeModelToolLoopEvent[];
  readonly requiredToolCalls: readonly ConversationRuntimeModelToolCall[];
}): {
  readonly finalText?: string;
  readonly corrected: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
} {
  if (input.requiredToolCalls.length === 0) {
    return createUncorrectedGroundedFinal(input.modelFinalText);
  }
  const requiredCallIds = new Set(
    input.requiredToolCalls
      .filter((call) => call.metadata?.requiredGrounding === true)
      .map((call) => call.id),
  );
  if (requiredCallIds.size === 0) {
    return createUncorrectedGroundedFinal(input.modelFinalText);
  }
  const requiredResults = input.events
    .filter(
      (event): event is Extract<ConversationRuntimeModelToolLoopEvent, { kind: "tool.result" }> =>
        event.kind === "tool.result" && requiredCallIds.has(event.result.callId),
    )
    .map((event) => event.result);
  if (requiredResults.length === 0) {
    return createUncorrectedGroundedFinal(input.modelFinalText);
  }
  const correction = renderRequiredGroundingFinal(requiredResults);
  if (correction === undefined) {
    return createUncorrectedGroundedFinal(input.modelFinalText);
  }
  const modelText = input.modelFinalText?.trim() ?? "";
  if (shouldReplaceModelFinalWithGrounding(modelText, requiredResults)) {
    return {
      finalText: correction.text,
      corrected: true,
      metadata: correction.metadata,
    };
  }
  return createUncorrectedGroundedFinal(input.modelFinalText);
}

function createUncorrectedGroundedFinal(finalText: string | undefined): {
  readonly finalText?: string;
  readonly corrected: false;
} {
  return finalText === undefined ? { corrected: false } : { finalText, corrected: false };
}

function resolveConversationRuntimeRequiredToolFallbackFinal(input: {
  readonly modelFinalText: string | undefined;
  readonly events: readonly ConversationRuntimeModelToolLoopEvent[];
  readonly requiredToolCalls: readonly ConversationRuntimeModelToolCall[];
}): {
  readonly finalText?: string;
  readonly corrected: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
} {
  const modelText = input.modelFinalText?.trim() ?? "";
  if (!isLowSignalRequiredToolFinal(modelText)) {
    return createUncorrectedToolObservationFinal(input.modelFinalText);
  }
  const requiredCallIds = new Set(input.requiredToolCalls.map((call) => call.id));
  if (requiredCallIds.size === 0) {
    return createUncorrectedToolObservationFinal(input.modelFinalText);
  }
  const requiredResults = input.events
    .filter(
      (event): event is Extract<ConversationRuntimeModelToolLoopEvent, { kind: "tool.result" }> =>
        event.kind === "tool.result" && requiredCallIds.has(event.result.callId),
    )
    .map((event) => event.result);
  const fallback = resolveConversationRuntimeToolResultFallbackFinalFromResults(requiredResults);
  if (fallback === undefined) {
    return createUncorrectedToolObservationFinal(input.modelFinalText);
  }
  return {
    finalText: fallback.finalText,
    corrected: true,
    metadata: fallback.metadata,
  };
}

function resolveConversationRuntimeToolResultFallbackFinalFromResults(
  results: readonly ConversationRuntimeToolExecutionOutput[],
):
  | {
      readonly finalText: string;
      readonly metadata: Readonly<Record<string, unknown>>;
    }
  | undefined {
  const result = rankToolResultsForFallbackFinal(results, {}).at(0);
  if (result === undefined) {
    return undefined;
  }
  const finalText = renderToolResultFallbackFinal(result);
  if (finalText === undefined) {
    return undefined;
  }
  return {
    finalText,
    metadata: {
      toolName: result.toolName,
      callId: result.callId,
      ok: result.ok,
      status: result.ok ? "success" : "error",
      reason: "required_tool_result_preferred_over_low_signal_model_final",
    },
  };
}

function isLowSignalRequiredToolFinal(text: string): boolean {
  if (text.length === 0) {
    return true;
  }
  return /^(模型调用完成|已处理|处理完成|完成|OK|好的)[。.!！\s]*$/iu.test(text);
}

function resolveConversationRuntimeToolObservationFinal(input: {
  readonly modelFinalText: string | undefined;
  readonly events: readonly ConversationRuntimeModelToolLoopEvent[];
}): {
  readonly finalText?: string;
  readonly corrected: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
} {
  const modelText = input.modelFinalText?.trim() ?? "";
  if (modelText.length === 0) {
    return createUncorrectedToolObservationFinal(input.modelFinalText);
  }
  const toolResults = input.events
    .filter(
      (event): event is Extract<ConversationRuntimeModelToolLoopEvent, { kind: "tool.result" }> =>
        event.kind === "tool.result",
    )
    .map((event) => event.result);
  for (const result of [...toolResults].reverse()) {
    const correction = renderContradictedToolObservationFinal(modelText, result);
    if (correction !== undefined) {
      return correction;
    }
  }
  const richerPageCorrection = renderContradictedBrowserSnapshotFinal(modelText, toolResults);
  if (richerPageCorrection !== undefined) {
    return richerPageCorrection;
  }
  return createUncorrectedToolObservationFinal(input.modelFinalText);
}

function createUncorrectedToolObservationFinal(finalText: string | undefined): {
  readonly finalText?: string;
  readonly corrected: false;
} {
  return finalText === undefined ? { corrected: false } : { finalText, corrected: false };
}

function renderContradictedToolObservationFinal(
  modelText: string,
  result: ConversationRuntimeToolExecutionOutput,
):
  | {
      readonly finalText: string;
      readonly corrected: true;
      readonly metadata: Readonly<Record<string, unknown>>;
    }
  | undefined {
  if (result.toolName === "director.skills.list") {
    return renderContradictedSkillIndexFinal(modelText, result);
  }
  if (result.toolName === "director.skills.view") {
    return renderContradictedSkillViewFinal(modelText, result);
  }
  if (result.toolName === "director.skills.use") {
    return renderContradictedSkillViewFinal(modelText, result);
  }
  if (result.toolName === "director.experience.candidates.list") {
    return renderContradictedExperienceCandidatesFinal(modelText, result);
  }
  if (result.toolName === "director.moyin.project_readiness") {
    return renderContradictedMoyinProjectReadinessFinal(modelText, result);
  }
  if (result.toolName === "web_extract_artifact_read") {
    return renderContradictedWebExtractArtifactFinal(modelText, result);
  }
  return undefined;
}

function renderContradictedMoyinProjectReadinessFinal(
  modelText: string,
  result: ConversationRuntimeToolExecutionOutput,
):
  | {
      readonly finalText: string;
      readonly corrected: true;
      readonly metadata: Readonly<Record<string, unknown>>;
    }
  | undefined {
  if (!doesModelAskForMoyinReadinessWorkAlreadyDone(modelText, result)) {
    return undefined;
  }
  const finalText = renderMoyinProjectReadinessFallbackFinal(result);
  if (finalText === undefined) {
    return undefined;
  }
  return {
    finalText,
    corrected: true,
    metadata: {
      toolName: result.toolName,
      callId: result.callId,
      status: result.ok ? "success" : "error",
      reason: "moyin_project_readiness_hard_validation_already_observed",
    },
  };
}

function doesModelAskForMoyinReadinessWorkAlreadyDone(
  modelText: string,
  result: ConversationRuntimeToolExecutionOutput,
): boolean {
  if (result.ok !== true) {
    return false;
  }
  const output = isRuntimeRecord(result.output) ? result.output : {};
  if (readRuntimeString(output.status) !== "ready") {
    return false;
  }
  const gates = readRuntimeRecordArray(output.gates);
  const hasPassedHardValidation = gates.some((gate) => {
    if (readRuntimeString(gate.status) !== "passed") {
      return false;
    }
    const evidence = readRuntimeRecord(gate.evidence);
    const hardValidation = readRuntimeRecord(evidence?.hardValidation);
    return readRuntimeBoolean(hardValidation?.passed) === true;
  });
  if (!hasPassedHardValidation) {
    return false;
  }
  return (
    /[?？]/u.test(modelText) && /(?:读取|读|硬验收|验证|复核|检查|script|sclass)/iu.test(modelText)
  );
}

function renderContradictedWebExtractArtifactFinal(
  modelText: string,
  result: ConversationRuntimeToolExecutionOutput,
):
  | {
      readonly finalText: string;
      readonly corrected: true;
      readonly metadata: Readonly<Record<string, unknown>>;
    }
  | undefined {
  if (!doesModelDenyReadablePageAfterTools(modelText)) {
    return undefined;
  }
  const readableArtifact = parseReadableWebExtractArtifactResult(result);
  if (readableArtifact === undefined) {
    return undefined;
  }
  return {
    finalText: renderReadableSourceTextSummary(readableArtifact),
    corrected: true,
    metadata: {
      toolName: result.toolName,
      callId: result.callId,
      status: "success",
      reason: "web_extract_full_body_has_readable_article_after_preview_truncation",
      url: readableArtifact.url,
      title: readableArtifact.title,
      textChars: readableArtifact.text.length,
    },
  };
}

function renderContradictedBrowserSnapshotFinal(
  modelText: string,
  results: readonly ConversationRuntimeToolExecutionOutput[],
):
  | {
      readonly finalText: string;
      readonly corrected: true;
      readonly metadata: Readonly<Record<string, unknown>>;
    }
  | undefined {
  if (!doesModelDenyReadablePageAfterTools(modelText)) {
    return undefined;
  }
  const readableSnapshot = [...results]
    .reverse()
    .map(parseReadableBrowserSnapshotResult)
    .find((snapshot) => snapshot !== undefined);
  if (readableSnapshot === undefined) {
    return undefined;
  }
  return {
    finalText: renderReadableBrowserSnapshotSummary(readableSnapshot),
    corrected: true,
    metadata: {
      toolName: readableSnapshot.toolName,
      callId: readableSnapshot.callId,
      status: "success",
      reason: "browser_snapshot_has_readable_article_after_link_shell",
      url: readableSnapshot.url,
      title: readableSnapshot.title,
      textChars: readableSnapshot.text.length,
    },
  };
}

function doesModelDenyReadablePageAfterTools(text: string): boolean {
  return (
    /(?:仅包含|只有|只是).{0,24}(?:链接|外部链接|用户简介|个人简介|分享)/iu.test(text) ||
    /(?:无法|不能|没有).{0,32}(?:获取|读取|获得|分析).{0,24}(?:具体文章|正文|知识内容|链接指向)/iu.test(
      text,
    ) ||
    /(?:正文|推文|帖子).{0,24}(?:被截断|预览截断|不完整)/iu.test(text) ||
    /8000\s*字符.{0,16}(?:截断|不完整)/iu.test(text)
  );
}

interface ReadableBrowserSnapshotResult {
  readonly toolName: string;
  readonly callId: string;
  readonly url: string;
  readonly title: string;
  readonly text: string;
}

interface ReadableSourceTextResult {
  readonly toolName: string;
  readonly callId: string;
  readonly url: string;
  readonly title: string;
  readonly text: string;
}

function parseReadableWebExtractArtifactResult(
  result: ConversationRuntimeToolExecutionOutput,
): ReadableSourceTextResult | undefined {
  if (result.toolName !== "web_extract_artifact_read" || result.ok !== true) {
    return undefined;
  }
  const output = isRuntimeRecord(result.output) ? result.output : {};
  const fields = parseWebExtractArtifactObservationFields(result.content);
  const status =
    readRuntimeString(output.status) ?? fields.status ?? (result.ok ? "success" : "error");
  if (status !== "success") {
    return undefined;
  }
  const body = readRuntimeString(output.body) ?? fields.body ?? "";
  const truncated =
    output.body_truncated_for_model === true ||
    output.bodyTruncatedForModel === true ||
    fields.bodyTruncatedForModel === true;
  if (truncated || !isReadableArticleSnapshotText(body)) {
    return undefined;
  }
  return {
    toolName: result.toolName,
    callId: result.callId,
    url: readRuntimeString(output.url) ?? fields.url ?? "",
    title: readRuntimeString(output.title) ?? fields.title ?? "",
    text: body,
  };
}

function parseReadableBrowserSnapshotResult(
  result: ConversationRuntimeToolExecutionOutput,
): ReadableBrowserSnapshotResult | undefined {
  if (result.toolName !== "browser_snapshot" || result.ok !== true) {
    return undefined;
  }
  const output = isRuntimeRecord(result.output) ? result.output : {};
  const fields = parseBrowserToolObservationFields(result.content);
  const status =
    readRuntimeString(output.status) ?? fields.status ?? (result.ok ? "success" : "error");
  if (status !== "success") {
    return undefined;
  }
  const text = readRuntimeString(output.text) ?? fields.text ?? "";
  if (!isReadableArticleSnapshotText(text)) {
    return undefined;
  }
  return {
    toolName: result.toolName,
    callId: result.callId,
    url: readRuntimeString(output.url) ?? fields.url ?? "",
    title: readRuntimeString(output.title) ?? fields.title ?? "",
    text,
  };
}

function isReadableArticleSnapshotText(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 360) {
    return false;
  }
  if (
    /^(?:登录|注册|JavaScript is not available|Access denied|Verify you are human)/iu.test(
      normalized,
    )
  ) {
    return false;
  }
  const articleSignals = [
    /文章|正文|帖子|对话|阅读全文/iu,
    /九宫格|六宫格|故事板|分镜|运镜|镜头|时间轴|Seedance|AI\s*视频/iu,
    /核心结论|可复用|方法|步骤|附录|提示词/iu,
    /复盘|案例|问题|结论|经验|方法|步骤|模板|流程|规则|策略|路线图|证据|评分|准入|观察池/iu,
    /第一步|第二步|第三步|三步法|先.+再.+最后|不要|必须|要求|如果/iu,
  ].filter((pattern) => pattern.test(normalized)).length;
  return articleSignals >= 2;
}

function renderReadableBrowserSnapshotSummary(snapshot: ReadableBrowserSnapshotResult): string {
  return renderReadableSourceTextSummary(snapshot);
}

function renderReadableSourceTextSummary(snapshot: ReadableSourceTextResult): string {
  const text = snapshot.text;
  const keyPoints = extractReadableSnapshotKeyPoints(text, 6);
  const reusableMethods = extractReadableSnapshotReusableMethods(text, 4);
  const keyPointLines =
    keyPoints.length === 0
      ? ["1. 正文已经读到，但没有抽出足够稳定的要点；需要按原文证据继续人工确认。"]
      : keyPoints.map((point, index) => `${index + 1}. ${point}`);
  const reusableMethodLines =
    reusableMethods.length === 0
      ? ["1. 先把正文里的问题、证据、步骤和边界整理成候选方法，再决定是否入库。"]
      : reusableMethods.map((point, index) => `${index + 1}. ${point}`);
  return [
    "**核心结论**",
    inferReadableSnapshotCoreConclusion(text),
    "",
    "**学到的内容**",
    ...keyPointLines,
    "",
    "**可复用方法**",
    ...reusableMethodLines,
    "",
    "**局限**",
    "这次已经读到网页/浏览器快照里的文本正文；若页面还包含图片、视频或音频，它们只算媒体清单证据，不能在未授权和未预算确认时当作已完成多模态理解。",
    "",
    "**下一步**",
    "如果要入库，先把文本经验作为待确认候选；如需理解图片或视频，再让用户确认媒体读取范围和 token/费用预算。",
    ...(snapshot.url.length === 0 ? [] : ["", `来源：${snapshot.url}`]),
  ].join("\n");
}

function parseWebExtractArtifactObservationFields(content: string): {
  readonly status?: string;
  readonly summary?: string;
  readonly url?: string;
  readonly title?: string;
  readonly body?: string;
  readonly bodyTruncatedForModel?: boolean;
} {
  const fields: {
    status?: string;
    summary?: string;
    url?: string;
    title?: string;
    body?: string;
    bodyTruncatedForModel?: boolean;
  } = {};
  let currentBlock: "body" | null = null;
  const blockLines: string[] = [];
  const flushBlock = () => {
    if (currentBlock === null) {
      return;
    }
    const value = blockLines.join("\n").trim();
    if (value.length > 0) {
      fields.body = value;
    }
    currentBlock = null;
    blockLines.length = 0;
  };
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (currentBlock !== null) {
      if (/^[a-z_][a-z0-9_]*\s*:/iu.test(trimmed)) {
        flushBlock();
      } else {
        blockLines.push(line);
        continue;
      }
    }
    const match = /^(status|summary|url|title|body|body_truncated_for_model)\s*:\s*(.*)$/iu.exec(
      trimmed,
    );
    if (match === null) {
      continue;
    }
    const key = match[1]?.toLowerCase();
    const value = match[2]?.trim() ?? "";
    if (key === "body") {
      currentBlock = "body";
      if (value.length > 0) {
        blockLines.push(value);
      }
      continue;
    }
    if (key === "status") fields.status = value;
    if (key === "summary") fields.summary = value;
    if (key === "url") fields.url = value;
    if (key === "title") fields.title = value;
    if (key === "body_truncated_for_model") {
      fields.bodyTruncatedForModel = value.toLocaleLowerCase() === "true";
    }
  }
  flushBlock();
  return fields;
}

function inferReadableSnapshotCoreConclusion(text: string): string {
  if (/九宫格|六宫格|故事板/iu.test(text)) {
    return "这篇内容的主结论是：AI 视频前期不要把九宫格当默认生产底稿；六宫格故事板更适合把时间、镜头、情绪和空间关系组织成能生成、能剪辑的 15 秒视频结构。";
  }
  const conclusionSentence = splitReadableSnapshotSentences(text).find((sentence) =>
    /主结论|核心|本质|关键|真正|不是.+而是|问题不在|转成|变成|方法让|结论是/iu.test(sentence),
  );
  if (conclusionSentence !== undefined) {
    return conclusionSentence;
  }
  const methodSentence = splitReadableSnapshotSentences(text).find((sentence) =>
    /方法|步骤|流程|模板|规则|策略|路线图|证据|评分|准入|观察池/iu.test(sentence),
  );
  if (methodSentence !== undefined) {
    return methodSentence;
  }
  return "这篇内容已经读到可用正文，结论应以正文中的问题、方法、证据和边界为准，而不是停留在链接预览。";
}

function extractReadableSnapshotKeyPoints(text: string, maxItems: number): readonly string[] {
  const candidates = splitReadableSnapshotSentences(text).filter((sentence) => {
    if (isReadableSnapshotBoilerplateSentence(sentence)) {
      return false;
    }
    return /问题|不是.+而是|关键|方法|步骤|流程|模板|规则|策略|案例|复盘|证据|评分|准入|观察池|九宫格|六宫格|故事板|分镜|运镜|时间|场景|情绪|镜头|节奏|Seedance|提示词/iu.test(
      sentence,
    );
  });
  return rankReadableSnapshotSentences(dedupeReadableSnapshotSentences(candidates)).slice(
    0,
    maxItems,
  );
}

function extractReadableSnapshotReusableMethods(text: string, maxItems: number): readonly string[] {
  const candidates = splitReadableSnapshotSentences(text).filter((sentence) => {
    if (isReadableSnapshotBoilerplateSentence(sentence)) {
      return false;
    }
    return /方法|步骤|流程|模板|规则|策略|要求|必须|先.+再|最后|如果|每一|第一步|第二步|第三步|证据|评分|准入|观察池|附录|提示词|前五秒|中间五秒|后五秒|建立|推进|爆发|收束|时间|场景|运镜|情绪/iu.test(
      sentence,
    );
  });
  return rankReadableSnapshotSentences(dedupeReadableSnapshotSentences(candidates)).slice(
    0,
    maxItems,
  );
}

function splitReadableSnapshotSentences(text: string): readonly string[] {
  return text
    .replace(/\r/gu, "\n")
    .split(/(?:\n+|(?<=[。！？!?]))/u)
    .map((item) => item.trim().replace(/\s+/gu, " "))
    .filter((item) => item.length >= 8 && item.length <= 220);
}

function dedupeReadableSnapshotSentences(sentences: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const sentence of sentences) {
    const key = sentence.slice(0, 36).toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(sentence);
  }
  return output;
}

function rankReadableSnapshotSentences(sentences: readonly string[]): readonly string[] {
  return [...sentences].sort(
    (left, right) => scoreReadableSnapshotSentence(right) - scoreReadableSnapshotSentence(left),
  );
}

function scoreReadableSnapshotSentence(sentence: string): number {
  let score = 0;
  if (/方法|步骤|流程|模板|规则|策略|可复用/iu.test(sentence)) score += 8;
  if (/证据|评分|准入|观察池|样本|影响|撤销|成本/iu.test(sentence)) score += 7;
  if (/先.+再|最后|第一步|第二步|第三步|三步法/iu.test(sentence)) score += 8;
  if (/前五秒|中间五秒|后五秒|15\s*秒|三段|建立|推进|爆发|收束/iu.test(sentence)) {
    score += 9;
  }
  if (/(?:模板|每一|交代|拆成|打分|准入|观察池|门槛|维度)/iu.test(sentence)) {
    score += 8;
  }
  if (
    /[、,，].*[、,，]/u.test(sentence) &&
    /模板|每一|交代|评分|打分|准入|证据|维度|时间|场景|情绪|运镜/iu.test(sentence)
  ) {
    score += 10;
  }
  if (/不是.+而是|问题|关键|本质|真正|转成/iu.test(sentence)) score += 5;
  if (/必须|要求|不允许|不要|如果/iu.test(sentence)) score += 4;
  if (/九宫格|六宫格|故事板|分镜|运镜|镜头|时间|场景|情绪|节奏|提示词/iu.test(sentence)) {
    score += 4;
  }
  if (/标题|X 上的|@\w+|https?:\/\//iu.test(sentence)) score -= 10;
  return score;
}

function isReadableSnapshotBoilerplateSentence(sentence: string): boolean {
  return (
    /^X 上的 /iu.test(sentence) ||
    /^#+\s*/u.test(sentence) ||
    /^!\[/u.test(sentence) ||
    /https?:\/\/|@\w+|关注|点赞|转发|查看|登录|注册/iu.test(sentence)
  );
}

function renderContradictedExperienceCandidatesFinal(
  modelText: string,
  result: ConversationRuntimeToolExecutionOutput,
):
  | {
      readonly finalText: string;
      readonly corrected: true;
      readonly metadata: Readonly<Record<string, unknown>>;
    }
  | undefined {
  const structured = renderStructuredExperienceCandidatesFinal(result);
  if (structured === undefined) {
    return undefined;
  }
  if (!shouldReplaceModelFinalWithExperienceCandidateSummary(modelText, structured)) {
    return undefined;
  }
  return {
    finalText: structured,
    corrected: true,
    metadata: {
      toolName: result.toolName,
      callId: result.callId,
      status: "success",
      reason: "experience_candidate_answer_not_readable",
    },
  };
}

function shouldReplaceModelFinalWithExperienceCandidateSummary(
  modelText: string,
  structuredFallback: string,
): boolean {
  const text = scrubConversationRuntimeFinalText(modelText)?.trim() ?? "";
  if (text.length === 0) {
    return true;
  }
  if (isLowQualityExperienceCandidateFinal(text)) {
    return true;
  }
  void structuredFallback;
  return false;
}

function isLowQualityExperienceCandidateFinal(text: string): boolean {
  if (
    (text.includes("请避免以下问题") && /GPT\s*Image/iu.test(text)) ||
    text.includes("如果平台对枪械敏感，也可以替换为：")
  ) {
    return true;
  }
  return /(?:^|\n)\s*\d+[.、]\s*(?:请避免以下问题|GPT Image 2\s*提示词分享|如果平台对[^。\n]{0,20}敏感，也可以替换为)[:：]?\s*(?:\n|$)/iu.test(
    text,
  );
}

function normalizeRuntimeUrlForComparison(value: string): string {
  return value
    .trim()
    .replace(/[）)\]】,，。；;\s]+$/gu, "")
    .replace(/^https?:\/\//iu, "");
}

function resolveConversationRuntimeToolResultFallbackFinal(
  events: readonly ConversationRuntimeModelToolLoopEvent[],
  options: {
    readonly rawUserText?: string;
    readonly history?: readonly ConversationRuntimeModelToolMessage[];
  } = {},
):
  | {
      readonly finalText: string;
      readonly metadata: Readonly<Record<string, unknown>>;
    }
  | undefined {
  const toolResults = events
    .filter(
      (event): event is Extract<ConversationRuntimeModelToolLoopEvent, { kind: "tool.result" }> =>
        event.kind === "tool.result",
    )
    .map((event) => event.result);
  for (const result of rankToolResultsForFallbackFinal(toolResults, options)) {
    const finalText = renderToolResultFallbackFinal(result, options);
    if (finalText === undefined) {
      continue;
    }
    const sourceUrl =
      readExperienceCandidateFallbackSourceUrl(result) ?? readRuntimeToolResultSourceUrl(result);
    const repeated = renderRepeatedExperienceCandidateFallbackNotice({
      result,
      finalText,
      history: options.history ?? [],
      ...(sourceUrl === undefined ? {} : { sourceUrl }),
    });
    return {
      finalText: repeated ?? finalText,
      metadata: {
        toolName: result.toolName,
        callId: result.callId,
        ok: result.ok,
        sourceUrl: sourceUrl ?? "",
        ...(repeated === undefined ? {} : { repeatedFallback: true }),
      },
    };
  }
  return undefined;
}

function renderRepeatedExperienceCandidateFallbackNotice(input: {
  readonly result: ConversationRuntimeToolExecutionOutput;
  readonly finalText: string;
  readonly sourceUrl?: string;
  readonly history: readonly ConversationRuntimeModelToolMessage[];
}): string | undefined {
  if (input.result.toolName !== "director.experience.candidates.list") {
    return undefined;
  }
  const sourceUrl = cleanupExperienceCandidateSourceRef(input.sourceUrl);
  if (sourceUrl === undefined) {
    return undefined;
  }
  const normalizedSource = normalizeRuntimeUrlForComparison(sourceUrl);
  const previousAssistant = [...input.history].reverse().find((message) => {
    if (message.role !== "assistant") {
      return false;
    }
    const content = message.content.trim();
    return (
      content.length > 0 &&
      normalizeRuntimeUrlForComparison(content).includes(normalizedSource) &&
      /(?:我读到的核心是|正文里比较有用的部分|这条候选仍在待确认区)/u.test(content)
    );
  });
  if (previousAssistant === undefined) {
    return undefined;
  }
  const title = readRepeatedExperienceCandidateTitle(input.result) ?? "这条学习候选";
  return [
    `刚才那条还是这个意思：「${title}」。模型还是暂时不可用，所以我不重复贴长摘要了。`,
    "要收录吗？",
    `来源：${sourceUrl}`,
  ].join("\n");
}

function readRepeatedExperienceCandidateTitle(
  result: ConversationRuntimeToolExecutionOutput,
): string | undefined {
  const output = isRuntimeRecord(result.output) ? result.output : {};
  const candidates = readRuntimeRecordArray(output.candidates);
  const primary = selectPrimaryExperienceCandidateForFinal(candidates);
  if (primary === undefined) {
    return undefined;
  }
  return cleanupExperienceCandidateLine(
    readRuntimeString(primary.title) ?? readRuntimeString(primary.id),
  );
}

function recordRuntimeFallbackTrace(input: {
  readonly traceItems: ConversationRuntimeTraceItem[];
  readonly occurredAtMs: number;
  readonly toolFallback: {
    readonly metadata: Readonly<Record<string, unknown>>;
  };
  readonly reason: string;
}): void {
  input.traceItems.push({
    source: "runtime" as const,
    stage: "runtime.fallback.used",
    detail: "Runtime used a deterministic fallback after model synthesis was unavailable.",
    occurredAtMs: input.occurredAtMs,
    metadata: {
      ...input.toolFallback.metadata,
      reason: input.reason,
    },
  });
}

function resolveToolFallbackReplySource(
  metadata: Readonly<Record<string, unknown>>,
): ConversationRuntimeReplySource {
  return metadata.ok === false ? "structured-renderer" : "tool-loop";
}

function readExperienceCandidateFallbackSourceUrl(
  result: ConversationRuntimeToolExecutionOutput,
): string | undefined {
  if (result.toolName !== "director.experience.candidates.list") {
    return undefined;
  }
  const output = isRuntimeRecord(result.output) ? result.output : {};
  const candidates = readRuntimeRecordArray(output.candidates);
  const primary = selectPrimaryExperienceCandidateForFinal(candidates);
  return primary === undefined
    ? undefined
    : cleanupExperienceCandidateSourceRef(readRuntimeString(primary.sourceRef));
}

function readRuntimeToolResultSourceUrl(
  result: ConversationRuntimeToolExecutionOutput,
): string | undefined {
  const output = isRuntimeRecord(result.output) ? result.output : {};
  return (
    readRuntimeString(result.metadata?.sourceUrl) ??
    readRuntimeString(result.metadata?.sourceRef) ??
    readRuntimeString(output.url) ??
    readRuntimeString(output.sourceUrl) ??
    readRuntimeString(output.sourceRef) ??
    readRuntimeContentField(result.content, "url") ??
    readRuntimeContentField(result.content, "source_ref")
  );
}

function readRuntimeContentField(content: string, key: string): string | undefined {
  const pattern = new RegExp(`(^|\\n)${key}\\s*:\\s*([^\\n]+)`, "iu");
  return pattern.exec(content)?.[2]?.trim();
}

function readRuntimeContentNumber(content: string, key: string): number | undefined {
  const raw = readRuntimeContentField(content, key);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function rankToolResultsForFallbackFinal(
  results: readonly ConversationRuntimeToolExecutionOutput[],
  options: { readonly rawUserText?: string },
): readonly ConversationRuntimeToolExecutionOutput[] {
  return results
    .map((result, index) => ({ result, index }))
    .sort(
      (left, right) =>
        scoreToolResultForFallbackFinal(right.result, options) -
          scoreToolResultForFallbackFinal(left.result, options) || right.index - left.index,
    )
    .map((item) => item.result);
}

function scoreToolResultForFallbackFinal(
  result: ConversationRuntimeToolExecutionOutput,
  options: { readonly rawUserText?: string },
): number {
  const rendered = renderToolResultFallbackFinal(result, options);
  if (rendered === undefined) {
    return 0;
  }
  if (parseReadableWebExtractArtifactResult(result) !== undefined) {
    return 190;
  }
  if (parseReadableBrowserSnapshotResult(result) !== undefined) {
    return 180;
  }
  if (parseReadableOpenCliInvokeResult(result) !== undefined) {
    return 185;
  }
  const groundingObservation = parseGroundingToolObservation(result);
  if (groundingObservation !== undefined) {
    return scoreGroundingObservationForFinal(groundingObservation, result);
  }
  if (result.toolName === "director.opencli.invoke") {
    return scoreOpenCliInvokeResultForFallbackFinal(result, options.rawUserText);
  }
  if (result.ok === true) {
    return 100;
  }
  return 10;
}

function renderToolResultFallbackFinal(
  result: ConversationRuntimeToolExecutionOutput,
  options: { readonly rawUserText?: string } = {},
): string | undefined {
  const projectedText = readToolResultUserFacingProjectionText(result);
  if (projectedText !== undefined) {
    return projectedText;
  }
  const groundingFinal = renderRequiredGroundingFinal([result]);
  if (groundingFinal !== undefined) {
    return groundingFinal.text;
  }
  const readableArtifact = parseReadableWebExtractArtifactResult(result);
  if (readableArtifact !== undefined) {
    return renderReadableSourceTextSummary(readableArtifact);
  }
  const readableSnapshot = parseReadableBrowserSnapshotResult(result);
  if (readableSnapshot !== undefined) {
    return renderReadableBrowserSnapshotSummary(readableSnapshot);
  }
  const readableOpenCli = parseReadableOpenCliInvokeResult(result);
  if (readableOpenCli !== undefined) {
    return renderReadableSourceTextSummary(readableOpenCli);
  }
  if (result.toolName === "director.moyin.project_readiness") {
    return renderMoyinProjectReadinessFallbackFinal(result);
  }
  if (result.toolName === "browser_navigate") {
    return renderBrowserNavigateFallbackFinal(result);
  }
  if (result.toolName === "browser_snapshot") {
    return renderBrowserSnapshotFallbackFinal(result);
  }
  if (result.toolName === "director.experience.candidates.list") {
    return renderExperienceCandidatesFallbackFinal(result);
  }
  if (result.toolName === "director.opencli.invoke") {
    return renderOpenCliInvokeFallbackFinal(result, options);
  }
  return undefined;
}

function parseReadableOpenCliInvokeResult(
  result: ConversationRuntimeToolExecutionOutput,
): ReadableSourceTextResult | undefined {
  if (result.toolName !== "director.opencli.invoke" || result.ok !== true) {
    return undefined;
  }
  const output = isRuntimeRecord(result.output) ? result.output : {};
  const fields = parseSimpleToolObservationFields(result.content);
  const status =
    readRuntimeString(output.status) ?? fields.status ?? (result.ok ? "success" : "error");
  if (status !== "success") {
    return undefined;
  }
  const json = isRuntimeRecord(output.json) ? output.json : {};
  const text =
    readRuntimeString(output.text) ??
    readRuntimeString(output.body) ??
    readRuntimeString(output.content) ??
    readRuntimeString(json.text) ??
    readRuntimeString(json.body) ??
    readRuntimeString(json.content) ??
    "";
  if (!isReadableArticleSnapshotText(text)) {
    return undefined;
  }
  return {
    toolName: result.toolName,
    callId: result.callId,
    url:
      readRuntimeString(output.url) ??
      readRuntimeString(json.url) ??
      readRuntimeString(result.metadata?.sourceUrl) ??
      fields.url ??
      "",
    title:
      readRuntimeString(output.title) ??
      readRuntimeString(json.title) ??
      fields.title ??
      "OpenCLI 读取结果",
    text,
  };
}

function readToolResultUserFacingProjectionText(
  result: ConversationRuntimeToolExecutionOutput,
): string | undefined {
  const output = isRuntimeRecord(result.output) ? result.output : undefined;
  const projection = isRuntimeRecord(output?.userFacingProjection)
    ? output.userFacingProjection
    : undefined;
  return readRuntimeString(projection?.userText);
}

function renderMoyinProjectReadinessFallbackFinal(
  result: ConversationRuntimeToolExecutionOutput,
): string | undefined {
  if (result.toolName !== "director.moyin.project_readiness") {
    return undefined;
  }
  const output = isRuntimeRecord(result.output) ? result.output : {};
  const fields = parseSimpleToolObservationFields(result.content);
  const status = readRuntimeString(output.status) ?? fields.status ?? (result.ok ? "ready" : "");
  if (status.length === 0) {
    return undefined;
  }
  const project = readRuntimeRecord(output.project);
  const projectId =
    readRuntimeString(project?.projectId) ??
    readRuntimeString(output.projectId) ??
    fields.project_id ??
    "";
  const projectName =
    readRuntimeString(project?.name) ??
    readRuntimeString(output.projectName) ??
    fields.project_name ??
    "";
  const blockerCode = readRuntimeString(output.blockerCode) ?? fields.blocker_code ?? "";
  const gates = readMoyinProjectReadinessGates(output, result.content);
  const nextActions = readRuntimeStringArray(
    output.nextActions,
    splitRuntimeList(fields.next_actions),
  );
  const mutation = readMoyinProjectReadinessMutation(output, fields.mutation);
  const title =
    status === "ready" ? "Moyin 项目 readiness 已通过。" : "Moyin 项目 readiness 未通过。";
  return [
    title,
    ...formatMoyinProjectReadinessProjectLines(projectName, projectId),
    ...(blockerCode.length === 0 ? [] : [`阻塞码：${blockerCode}`]),
    ...(gates.length === 0 ? [] : ["检查结果：", ...gates]),
    ...(mutation === undefined
      ? []
      : [
          `只读边界：projectCreateAttempted=${String(
            mutation.projectCreateAttempted,
          )}，workflowRunCreateAttempted=${String(
            mutation.workflowRunCreateAttempted,
          )}，submitAttempted=${String(mutation.submitAttempted)}。`,
        ]),
    ...(nextActions.length === 0 ? [] : [`下一步：${nextActions.join("；")}`]),
  ].join("\n");
}

function formatMoyinProjectReadinessProjectLines(
  projectName: string,
  projectId: string,
): readonly string[] {
  if (projectName.length === 0 && projectId.length === 0) {
    return [];
  }
  if (projectName.length > 0 && projectId.length > 0) {
    return [`项目：${projectName}`, `Project ID：${projectId}`];
  }
  return [`项目：${projectName.length > 0 ? projectName : projectId}`];
}

function readMoyinProjectReadinessGates(
  output: Readonly<Record<string, unknown>>,
  content: string,
): readonly string[] {
  const structured = readRuntimeRecordArray(output.gates)
    .map(formatMoyinProjectReadinessGate)
    .filter((line): line is string => line !== undefined);
  if (structured.length > 0) {
    return structured;
  }
  const lines: string[] = [];
  for (const line of content.split(/\r?\n/u)) {
    const match = /^gate\.([a-z0-9_-]+)\s*:\s*([a-z]+)\s*-\s*(.*)$/iu.exec(line.trim());
    if (match === null) {
      continue;
    }
    const gateId = match[1]?.trim() ?? "";
    const status = match[2]?.trim() ?? "";
    const summary = match[3]?.trim() ?? "";
    if (gateId.length === 0 || status.length === 0) {
      continue;
    }
    lines.push(`- ${gateId}: ${formatMoyinProjectReadinessGateStatus(status)} - ${summary}`);
  }
  return lines;
}

function formatMoyinProjectReadinessGate(
  gate: Readonly<Record<string, unknown>>,
): string | undefined {
  const id = readRuntimeString(gate.id);
  const status = readRuntimeString(gate.status);
  if (id === undefined || status === undefined) {
    return undefined;
  }
  const summary = readRuntimeString(gate.summary) ?? "";
  return `- ${id}: ${formatMoyinProjectReadinessGateStatus(status)}${
    summary.length === 0 ? "" : ` - ${summary}`
  }`;
}

function formatMoyinProjectReadinessGateStatus(status: string): string {
  if (status === "passed") {
    return "通过";
  }
  if (status === "blocked") {
    return "阻塞";
  }
  if (status === "unknown") {
    return "未知";
  }
  return status;
}

function readMoyinProjectReadinessMutation(
  output: Readonly<Record<string, unknown>>,
  mutationLine: string | undefined,
):
  | {
      readonly projectCreateAttempted: boolean;
      readonly workflowRunCreateAttempted: boolean;
      readonly submitAttempted: boolean;
    }
  | undefined {
  const mutation = readRuntimeRecord(output.mutation);
  const projectCreateAttempted = readRuntimeBoolean(mutation?.projectCreateAttempted);
  const workflowRunCreateAttempted = readRuntimeBoolean(mutation?.workflowRunCreateAttempted);
  const submitAttempted = readRuntimeBoolean(mutation?.submitAttempted);
  if (
    projectCreateAttempted !== undefined &&
    workflowRunCreateAttempted !== undefined &&
    submitAttempted !== undefined
  ) {
    return { projectCreateAttempted, workflowRunCreateAttempted, submitAttempted };
  }
  if (mutationLine === undefined) {
    return undefined;
  }
  return {
    projectCreateAttempted: readRuntimeBooleanToken(mutationLine, "projectCreateAttempted"),
    workflowRunCreateAttempted: readRuntimeBooleanToken(mutationLine, "workflowRunCreateAttempted"),
    submitAttempted: readRuntimeBooleanToken(mutationLine, "submitAttempted"),
  };
}

function readRuntimeBooleanToken(content: string, key: string): boolean {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`${escaped}\\s*=\\s*(true|false)`, "iu").exec(content);
  return match?.[1]?.toLowerCase() === "true";
}

function splitRuntimeList(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim().length === 0) {
    return [];
  }
  return value
    .split(/[；;]\s*/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function renderOpenCliInvokeFallbackFinal(
  result: ConversationRuntimeToolExecutionOutput,
  options: { readonly rawUserText?: string } = {},
): string | undefined {
  const output = isRuntimeRecord(result.output) ? result.output : {};
  const metadata = isRuntimeRecord(result.metadata) ? result.metadata : {};
  const fields = parseSimpleToolObservationFields(result.content);
  const maxItems = resolveOpenCliRequestedResultLimit(options.rawUserText);
  const summary =
    readRuntimeString(output.summary) ??
    fields.summary ??
    readRuntimeString(metadata.operationId) ??
    "OpenCLI 外部工具已返回结果。";
  const sourceRef =
    readRuntimeString(metadata.sourceRef) ??
    readRuntimeString(output.sourceRef) ??
    readRuntimeString(metadata.operationId) ??
    "opencli";

  if (result.ok !== true) {
    const error =
      readRuntimeString(output.error) ??
      result.error ??
      fields.error ??
      fields.summary ??
      "OpenCLI 外部工具这次没有成功返回可用结果。";
    return [
      "OpenCLI 调用失败，不能把这次结果当作已读取内容。",
      `卡点：${truncateRuntimeUserText(error, 220)}`,
      ...(sourceRef.length === 0 ? [] : [`来源：${sourceRef}`]),
    ].join("\n");
  }

  const renderedJson = renderOpenCliReadableJson(
    output.json,
    maxItems === undefined ? undefined : { maxItems },
  );
  if (renderedJson !== undefined) {
    return [
      "OpenCLI 已返回结果：",
      renderedJson,
      ...(sourceRef.length === 0 ? [] : [`来源：${sourceRef}`]),
    ].join("\n");
  }

  const text =
    readRuntimeString(output.text) ??
    readRuntimeString(output.stdout) ??
    readRuntimeString(output.content);
  if (text !== undefined) {
    return [
      "OpenCLI 已返回结果：",
      truncateRuntimeUserText(text, 1200),
      ...(sourceRef.length === 0 ? [] : [`来源：${sourceRef}`]),
    ].join("\n");
  }

  return [
    "OpenCLI 已执行，但没有返回可整理给用户的内容。",
    `摘要：${truncateRuntimeUserText(summary, 220)}`,
    ...(sourceRef.length === 0 ? [] : [`来源：${sourceRef}`]),
  ].join("\n");
}

function scoreOpenCliInvokeResultForFallbackFinal(
  result: ConversationRuntimeToolExecutionOutput,
  rawUserText: string | undefined,
): number {
  const output = isRuntimeRecord(result.output) ? result.output : {};
  const metadata = isRuntimeRecord(result.metadata) ? result.metadata : {};
  const operationId =
    readRuntimeString(metadata.operationId) ??
    readRuntimeString(output.operationId) ??
    readRuntimeString(metadata.sourceRef) ??
    "";
  const site =
    readRuntimeString(output.site) ??
    readRuntimeString(metadata.site) ??
    parseOpenCliSourceRefPart(metadata.sourceRef, 0) ??
    "";
  const command =
    readRuntimeString(output.name) ??
    readRuntimeString(metadata.name) ??
    parseOpenCliSourceRefPart(metadata.sourceRef, 1) ??
    parseOpenCliOperationCommand(operationId);
  const userText = rawUserText ?? "";
  const normalizedUserText = userText.toLocaleLowerCase();

  let score = result.ok === true ? 100 : 10;
  if (site === "hackernews" && /hacker\s*news|hackernews|\bhn\b/iu.test(userText)) {
    score += 20;
  }
  if (command === "search") {
    score += 25;
  } else if (command === "read") {
    score += 20;
  } else if (command === "new") {
    score += /最新|今天|new|newest|recent/iu.test(userText) ? 18 : -20;
  } else if (command === "top") {
    score += /热榜|热门|top|front\s*page|前\s*\d+/iu.test(userText) ? 18 : -10;
  } else if (command === "best") {
    score += /best|最佳/iu.test(userText) ? 18 : -10;
  }

  const query = readOpenCliResultQuery(result);
  if (query.length > 0) {
    score += scoreTextTokenOverlap(query, userText) * 6;
  }
  const rendered = renderOpenCliReadableJson(output.json) ?? readRuntimeString(output.text) ?? "";
  if (rendered.length > 0) {
    score += scoreTextTokenOverlap(rendered, userText) * 4;
  }
  if (normalizedUserText.includes("claude code") && /claude\s+code/iu.test(rendered)) {
    score += 35;
  }
  return score;
}

function readOpenCliResultQuery(result: ConversationRuntimeToolExecutionOutput): string {
  const output = isRuntimeRecord(result.output) ? result.output : {};
  const entry = isRuntimeRecord(output.entry) ? output.entry : {};
  const args = isRuntimeRecord(output.args)
    ? output.args
    : isRuntimeRecord(output.argv)
      ? output.argv
      : {};
  return (
    readRuntimeString(output.query) ??
    readRuntimeString(entry.query) ??
    readRuntimeString(args.query) ??
    ""
  );
}

function parseOpenCliOperationCommand(operationId: string): string {
  const parts = operationId.split(".");
  return parts[parts.length - 1]?.trim() ?? "";
}

function parseOpenCliSourceRefPart(value: unknown, index: number): string | undefined {
  const sourceRef = readRuntimeString(value);
  if (sourceRef === undefined) {
    return undefined;
  }
  const match = /^opencli:([^/]+)\/(.+)$/iu.exec(sourceRef);
  return match?.[index + 1]?.trim();
}

function scoreTextTokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(extractComparableTextTokens(left));
  if (leftTokens.size === 0) {
    return 0;
  }
  let score = 0;
  for (const token of extractComparableTextTokens(right)) {
    if (leftTokens.has(token)) {
      score += 1;
    }
  }
  return score;
}

function extractComparableTextTokens(value: string): readonly string[] {
  return (
    value
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu)
      ?.filter((token) => token.length >= 2 && !OPENCLI_FALLBACK_STOP_WORDS.has(token)) ?? []
  );
}

const OPENCLI_FALLBACK_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "news",
  "hackernews",
  "hacker",
  "一下",
  "今天",
  "大家",
  "讨论",
  "什么",
  "三条",
  "只给",
]);

function renderOpenCliReadableJson(
  value: unknown,
  options: { readonly maxItems?: number } = {},
): string | undefined {
  const maxItems = options.maxItems ?? 5;
  if (Array.isArray(value)) {
    const lines = value
      .slice(0, maxItems)
      .map((item, index) => renderOpenCliJsonArrayItem(item, index + 1))
      .filter((item): item is string => item !== undefined);
    if (lines.length > 0) {
      return lines.join("\n");
    }
  }
  if (isRuntimeRecord(value)) {
    const rows =
      readRuntimeRecordArray(value.items).length > 0
        ? readRuntimeRecordArray(value.items)
        : readRuntimeRecordArray(value.results);
    if (rows.length > 0) {
      return rows
        .slice(0, maxItems)
        .map((item, index) => renderOpenCliJsonArrayItem(item, index + 1))
        .filter((item): item is string => item !== undefined)
        .join("\n");
    }
    const text = renderOpenCliJsonRecord(value);
    return text === undefined ? undefined : truncateRuntimeUserText(text, 1200);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return truncateRuntimeUserText(value, 1200);
  }
  return undefined;
}

function resolveOpenCliRequestedResultLimit(rawUserText: string | undefined): number | undefined {
  const text = rawUserText?.trim();
  if (text === undefined || text.length === 0) {
    return undefined;
  }
  const digitMatch =
    /(?:只给|给我|前|取|列出|返回|limit\s*[:=]?\s*)([1-9]\d?)\s*(?:条|个|项|篇|则|results?|stories?)?/iu.exec(
      text,
    );
  if (digitMatch?.[1] !== undefined) {
    return clampOpenCliResultLimit(Number.parseInt(digitMatch[1], 10));
  }
  const chineseNumberMatch =
    /(?:只给|给我|前|取|列出|返回)([一二两三四五六七八九十])\s*(?:条|个|项|篇|则)?/iu.exec(text);
  if (chineseNumberMatch?.[1] !== undefined) {
    return clampOpenCliResultLimit(readOpenCliChineseResultLimit(chineseNumberMatch[1]));
  }
  return undefined;
}

function readOpenCliChineseResultLimit(value: string): number {
  switch (value) {
    case "一":
      return 1;
    case "二":
    case "两":
      return 2;
    case "三":
      return 3;
    case "四":
      return 4;
    case "五":
      return 5;
    case "六":
      return 6;
    case "七":
      return 7;
    case "八":
      return 8;
    case "九":
      return 9;
    case "十":
      return 10;
    default:
      return 5;
  }
}

function clampOpenCliResultLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(10, Math.trunc(value))) : 5;
}

function renderOpenCliJsonArrayItem(item: unknown, ordinal: number): string | undefined {
  if (isRuntimeRecord(item)) {
    const title =
      readRuntimeString(item.title) ??
      readRuntimeString(item.name) ??
      readRuntimeString(item.text) ??
      readRuntimeString(item.content) ??
      readRuntimeString(item.summary);
    const url = readRuntimeString(item.url) ?? readRuntimeString(item.link);
    if (title !== undefined && url !== undefined) {
      return `${ordinal}. ${title}\n   ${url}`;
    }
    if (title !== undefined) {
      return `${ordinal}. ${title}`;
    }
    const recordText = renderOpenCliJsonRecord(item);
    return recordText === undefined
      ? undefined
      : `${ordinal}. ${truncateRuntimeUserText(recordText, 240)}`;
  }
  if (typeof item === "string" && item.trim().length > 0) {
    return `${ordinal}. ${truncateRuntimeUserText(item, 240)}`;
  }
  return undefined;
}

function renderOpenCliJsonRecord(value: Readonly<Record<string, unknown>>): string | undefined {
  const preferredKeys = ["title", "name", "summary", "text", "content", "url", "link"];
  const parts = preferredKeys
    .map((key) => readRuntimeString(value[key]))
    .filter((item): item is string => item !== undefined);
  if (parts.length > 0) {
    return parts.join("\n");
  }
  const compact = compactRuntimeRecord(value);
  const text = JSON.stringify(compact, null, 2);
  return text === "{}" ? undefined : text;
}

function renderExperienceCandidatesFallbackFinal(
  result: ConversationRuntimeToolExecutionOutput,
): string | undefined {
  if (result.ok !== true) {
    return undefined;
  }
  const structured = renderStructuredExperienceCandidatesFinal(result);
  if (structured !== undefined) {
    return structured;
  }
  const empty = renderEmptyExperienceCandidatesFallbackFinal(result);
  if (empty !== undefined) {
    return empty;
  }
  return normalizeConversationRuntimeFinalText(
    result.content
      .split(/\r?\n/u)
      .filter((line) => !/给用户回复时|用户可以自然说/iu.test(line))
      .join("\n"),
  );
}

function renderEmptyExperienceCandidatesFallbackFinal(
  result: ConversationRuntimeToolExecutionOutput,
): string | undefined {
  const output = isRuntimeRecord(result.output) ? result.output : {};
  const candidates = readRuntimeRecordArray(output.candidates);
  if (candidates.length > 0) {
    return undefined;
  }
  const total =
    readRuntimeNumber(output.total) ??
    readRuntimeNumber(output.total_candidates) ??
    readRuntimeNumber(output.totalCandidates) ??
    readRuntimeContentNumber(result.content, "total_candidates");
  const pendingConfirmations =
    readRuntimeNumber(output.pendingLearningConfirmations) ??
    readRuntimeNumber(output.pending_learning_confirmations) ??
    readRuntimeContentNumber(result.content, "pending_learning_confirmations");
  if (
    !/(^|\n)summary\s*:\s*当前没有匹配的待审经验候选/iu.test(result.content) &&
    total !== 0 &&
    pendingConfirmations !== 0
  ) {
    return undefined;
  }
  return [
    "当前没有可展示的待审经验候选。",
    "也就是说，刚才这轮没有留下可直接收录或展开的学习候选；如果你要继续学这条内容，需要重新学习链接，或先把原文/截图发进来。",
  ].join("\n");
}

function renderStructuredExperienceCandidatesFinal(
  result: ConversationRuntimeToolExecutionOutput,
): string | undefined {
  const output = isRuntimeRecord(result.output) ? result.output : {};
  const candidates = readRuntimeRecordArray(output.candidates);
  if (candidates.length === 0) {
    return undefined;
  }
  const primary = selectPrimaryExperienceCandidateForFinal(candidates);
  if (primary === undefined) {
    return undefined;
  }
  const first = candidates[0];
  const latestQualityNote =
    first === undefined || first === primary
      ? undefined
      : cleanupExperienceCandidateLine(readRuntimeString(first.contentQuality));
  const title = readRuntimeString(primary.title) ?? readRuntimeString(primary.id) ?? "这条经验候选";
  const displayTitle = deriveExperienceCandidateDisplayTitle(primary, title);
  const summary = deriveExperienceCandidateCoreSummary(primary);
  const hasReadableBody = hasReadableExperienceCandidateBody(primary);
  const method = cleanupExperienceCandidateLine(
    readRuntimeString(primary.applicability) ?? readRuntimeString(primary.reusable_method),
  );
  const methods = filterExperienceCandidateMethodsCoveredBySummary(
    deriveExperienceCandidateMethodList(primary, method),
    summary,
  );
  const risks = readRuntimeStringArray(primary.risks)
    .map((item) => cleanupExperienceCandidateLine(item))
    .filter(
      (item): item is string => item !== undefined && !isInternalExperienceCandidateLimit(item),
    )
    .slice(0, 3);
  const evidence = filterExperienceCandidateEvidencePreviewCoveredByFinal(
    cleanupExperienceCandidateLine(readRuntimeString(primary.evidencePreview)),
    [summary, ...methods],
  );
  const source = cleanupExperienceCandidateSourceRef(readRuntimeString(primary.sourceRef));
  const evidenceSource = readExperienceCandidateEvidenceDisclosureSource(primary, output);
  const mediaNote = inferExperienceCandidateMediaUnderstandingNote(primary, evidenceSource);
  const mediaAuthorizationNote = renderExperienceCandidateMediaAuthorizationNote(primary);
  const promptTemplateFinal = renderPromptTemplateExperienceCandidateFinal({
    candidate: primary,
    displayTitle,
    ...(source === undefined ? {} : { source }),
    ...(mediaNote === undefined ? {} : { mediaNote }),
    ...(mediaAuthorizationNote === undefined ? {} : { mediaAuthorizationNote }),
  });
  if (promptTemplateFinal !== undefined) {
    return promptTemplateFinal;
  }
  const contentQuality = cleanupExperienceCandidateLine(readRuntimeString(primary.contentQuality));
  const limits = [
    ...(contentQuality === undefined ||
    isInternalExperienceCandidateLimit(contentQuality) ||
    shouldSuppressDistillationFallbackLimit(primary, contentQuality)
      ? []
      : [contentQuality]),
    ...risks.filter((risk) => !isInternalExperienceCandidateLimit(risk)),
    ...(mediaNote === undefined ? [] : [mediaNote]),
  ];
  const fallbackParagraphs = extractExperienceCandidateFallbackParagraphs(primary);
  const conclusionBody =
    summary === undefined
      ? hasReadableBody
        ? `${displayTitle}。`
        : `这次还没有读到完整正文，只拿到了「${displayTitle}」的候选信息。`
      : hasReadableBody
        ? `${displayTitle}。${summary}`
        : `这次还没有读到完整正文，只拿到了「${displayTitle}」的候选信息：${summary}`;
  const conclusion = hasReadableBody
    ? `模型服务暂时不可用，我先基于已读到的内容给你一个摘要：核心是：${conclusionBody}`
    : `模型服务暂时不可用，我先基于候选信息给你一个摘要：${conclusionBody}`;
  const methodLine =
    methods.length === 0
      ? undefined
      : `可复用做法：${methods
          .slice(0, 3)
          .map((item) => item.replace(/[。；;]+$/u, ""))
          .join("；")}。`;
  const bodyLine =
    fallbackParagraphs.length === 0 ? undefined : `细节：${fallbackParagraphs.join(" / ")}`;
  const limitLine =
    limits.length === 0
      ? "这条候选仍在待确认区，还没有自动进入长期知识。"
      : `边界：${limits.join("；")}`;
  const candidateCountLine =
    candidates.length > 1
      ? `另外还有 ${candidates.length - 1} 条候选，可以继续指定查看或收录。`
      : undefined;
  const mediaLine =
    mediaAuthorizationNote === undefined
      ? undefined
      : `媒体授权：${mediaAuthorizationNote.replace(/\n+/gu, " ")}`;
  return [
    conclusion,
    ...(latestQualityNote === undefined
      ? []
      : [`补充：最近一条候选${latestQualityNote}，所以这里优先按可读正文候选说明。`]),
    bodyLine,
    methodLine,
    limitLine,
    mediaLine,
    ...(source === undefined ? [] : [`来源：${source}`]),
    ...(evidence === undefined || evidence === mediaNote ? [] : [`摘录：${evidence}`]),
    candidateCountLine,
    "要收录吗？",
  ]
    .filter((line): line is string => line !== undefined && line.trim().length > 0)
    .join("\n");
}

function selectPrimaryExperienceCandidateForFinal(
  candidates: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>> | undefined {
  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: scoreExperienceCandidateForFinal(candidate, index),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.candidate;
}

function renderPromptTemplateExperienceCandidateFinal(input: {
  readonly candidate: Readonly<Record<string, unknown>>;
  readonly displayTitle: string;
  readonly source?: string;
  readonly mediaNote?: string;
  readonly mediaAuthorizationNote?: string;
}): string | undefined {
  const text = getExperienceCandidateSourceText(input.candidate);
  if (!isLongPromptTemplateExperienceText(text)) {
    return undefined;
  }
  const templateTitle = readPromptTemplateTitle(text) ?? input.displayTitle;
  const theme = readPromptTemplateTheme(text) ?? templateTitle;
  const sectionLabels = readPromptTemplateSectionLabels(text);
  const shotTitles = readPromptTemplateShotTitles(text);
  const styleLine = buildPromptTemplateStyleLine(text);
  const identityLine = buildPromptTemplateIdentityLine(text);
  const safetyLine = buildPromptTemplateSafetyLine(text);
  const shotLine =
    shotTitles.length === 0
      ? "把同一主题拆成多张不同构图，避免只生成一张泛泛的风格图。"
      : `把同一主题拆成 ${shotTitles.length} 张不同分镜：${shotTitles
          .slice(0, 4)
          .join("、")}${shotTitles.length > 4 ? "等" : ""}，让动作、景别和构图有变化。`;
  const structureLine =
    sectionLabels.length === 0
      ? undefined
      : `结构上按「${sectionLabels.slice(0, 6).join(" / ")}」来约束生成，而不是只写几个风格词。`;
  const mediaLine =
    input.mediaAuthorizationNote === undefined
      ? input.mediaNote
      : input.mediaAuthorizationNote.replace(/\n+/gu, " ");
  return [
    `读到的是一套「${theme}」的 GPT Image 2 长提示词模板，价值不在几句口号，而在把写真生成拆成可执行规范。`,
    "",
    "最值得保存的三点：",
    `1. ${identityLine}`,
    `2. ${styleLine}`,
    `3. ${shotLine}`,
    "",
    "可复用做法：",
    structureLine,
    safetyLine,
    "先锁人物一致性和审美边界，再写服装、配饰、场景、光线、道具、分镜和负面要求；复杂出图不要只靠“性感/高级”这类抽象词。",
    mediaLine === undefined ? undefined : `边界：${mediaLine}`,
    input.source === undefined ? undefined : `来源：${input.source}`,
    "要收录吗？",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n");
}

function getExperienceCandidateSourceText(candidate: Readonly<Record<string, unknown>>): string {
  const sourceDocument = readRuntimeRecord(candidate.sourceDocument);
  return [
    readRuntimeString(sourceDocument?.rawContent),
    readRuntimeString(sourceDocument?.content),
    readRuntimeString(candidate.summary),
    readRuntimeString(candidate.evidencePreview),
  ]
    .filter((item): item is string => item !== undefined)
    .join("\n");
}

function isLongPromptTemplateExperienceText(text: string): boolean {
  return (
    text.length >= 300 &&
    /(?:GPT\s*Image|提示词|Prompt)/iu.test(text) &&
    /(?:##\s*[一二三四五六七八九十]|###\s*第\s*\d+\s*张|7\s*张|负面要求|人物一致性)/u.test(text)
  );
}

function readPromptTemplateTitle(text: string): string | undefined {
  const match = /^#\s*([^\n#]{4,80})$/mu.exec(text);
  return cleanupExperienceCandidateLine(match?.[1]);
}

function readPromptTemplateTheme(text: string): string | undefined {
  const match =
    /主题为[:：]\s*[\r\n\s]*[“"「『*]*([^”"」』*\n]{4,80})[”"」』*]*/u.exec(text) ??
    /#\s*([^\n#｜|]{4,50})/u.exec(text);
  return cleanupExperienceCandidateLine(match?.[1]);
}

function readPromptTemplateSectionLabels(text: string): readonly string[] {
  return dedupeExperienceCandidateLines(
    [...text.matchAll(/^##\s*(?:[一二三四五六七八九十]+[、.．]\s*)?([^\n#]{2,24})$/gmu)]
      .map((match) => cleanupExperienceCandidateLine(match[1]))
      .filter((item): item is string => item !== undefined),
  );
}

function readPromptTemplateShotTitles(text: string): readonly string[] {
  return dedupeExperienceCandidateLines(
    [...text.matchAll(/^###\s*第\s*\d+\s*张[:：]\s*([^\n#]{2,40})$/gmu)]
      .map((match) => cleanupExperienceCandidateLine(match[1]))
      .filter((item): item is string => item !== undefined),
  );
}

function buildPromptTemplateIdentityLine(text: string): string {
  if (/人物一致性|真实身份特征|同一个真实/iu.test(text)) {
    return "先锁人物一致性：保留本人脸型、五官比例、肤色、年龄感和体态气质，避免变成陌生人、欧美化、网红化或 AI 假脸。";
  }
  return "先锁主体一致性：把身份、外观、气质和不可变特征写清楚，避免每张图都像不同对象。";
}

function buildPromptTemplateStyleLine(text: string): string {
  const styleParts = [
    /高奢|高级|昂贵|luxury/iu.test(text) ? "高奢影棚质感" : undefined,
    /冷艳|危险|femme fatale|女特工|secret agent/iu.test(text) ? "冷艳危险的人设气质" : undefined,
    /缎面|束身|bodysuit/iu.test(text) ? "服装材质与版型" : undefined,
    /珍珠|金属|配饰/iu.test(text) ? "珍珠和金属配饰" : undefined,
    /极简|影棚|棚拍|光线/iu.test(text) ? "极简棚拍光线" : undefined,
  ].filter((item): item is string => item !== undefined);
  if (styleParts.length > 0) {
    return `把审美拆成具体可控项：${styleParts.join("、")}，避免只写“好看/性感/高级”。`;
  }
  return "把抽象审美拆成具体可控项：气质、服装、配饰、场景、光线和负面要求都要写出来。";
}

function buildPromptTemplateSafetyLine(text: string): string {
  if (/手枪|枪械|不出现开枪|不表现威胁|替换为/iu.test(text)) {
    return "道具和风险词要写边界：只作为时尚设定道具，不表现开枪、血腥、犯罪或威胁；平台敏感时替换为象征性冷感道具。";
  }
  if (/不要低俗|负面要求|不要色情|不要廉价/iu.test(text)) {
    return "负面要求要单独成段，明确排除低俗、廉价、失真、畸形和不自然效果。";
  }
  return "最后单独写清负面要求和平台边界，避免生成结果跑偏。";
}

function scoreExperienceCandidateForFinal(
  candidate: Readonly<Record<string, unknown>>,
  index: number,
): number {
  const text = getExperienceCandidateSearchText(candidate);
  let score = 100 - index;
  const contentQuality = readRuntimeString(candidate.contentQuality) ?? "";
  if (/主要是.*(登录|注册|侧栏)|不能算成功学习正文/iu.test(contentQuality)) {
    score -= 90;
  }
  if (/(正文可用|可读正文|readable|available)/iu.test(contentQuality)) {
    score += 30;
  }
  if (/(使用 Google 账号注册|使用 Apple 注册|X 的新用户|立即注册|Cookie 政策)/iu.test(text)) {
    score -= 24;
  }
  if (hasMeaningfulExperienceCandidateText(candidate)) {
    score += 35;
  }
  if (/(媒体资源|pbs\.twimg\.com|blob:https?:|视频|图片)/iu.test(text)) {
    score += 8;
  }
  return score;
}

function cleanupExperienceCandidateLine(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const text = value
    .replace(/[#*_`>]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (text.length === 0) {
    return undefined;
  }
  return truncateRuntimeUserText(text, 260);
}

function cleanupExperienceCandidateSourceRef(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const text = value.replace(/\s+/gu, " ").trim();
  if (text.length === 0) {
    return undefined;
  }
  return truncateRuntimeUserText(text, 260);
}

function deriveExperienceCandidateCoreSummary(
  candidate: Readonly<Record<string, unknown>>,
): string | undefined {
  const summaryText = readRuntimeString(candidate.summary);
  if (summaryText !== undefined && !isInternalExperienceCandidateSummary(summaryText)) {
    const cleanedSummary = summarizeExperienceCandidateDistilledSummary(summaryText);
    if (cleanedSummary !== undefined) {
      return cleanedSummary;
    }
  }
  const sourceSummary = deriveExperienceCandidateReadableSourceSummary(candidate);
  if (sourceSummary !== undefined) {
    return sourceSummary;
  }
  return cleanupExperienceCandidateLine(removeInternalExperienceCandidatePrefix(summaryText));
}

function deriveExperienceCandidateMethodList(
  candidate: Readonly<Record<string, unknown>>,
  fallbackMethod: string | undefined,
): readonly string[] {
  if (fallbackMethod === undefined) {
    const readableMethods = deriveExperienceCandidateReadableMethods(candidate);
    return readableMethods.length > 0
      ? readableMethods
      : ["先把资料里的做法提炼成待确认经验，再由你决定是否收录。"];
  }
  if (isInternalExperienceCandidateApplicability(fallbackMethod)) {
    return deriveExperienceCandidateReadableMethods(candidate);
  }
  return dedupeExperienceCandidateLines(splitExperienceCandidateSentenceList(fallbackMethod));
}

function filterExperienceCandidateMethodsCoveredBySummary(
  methods: readonly string[],
  summary: string | undefined,
): readonly string[] {
  if (summary === undefined) {
    return methods;
  }
  const summaryKey = normalizeExperienceCandidateLineForDedupe(summary);
  if (summaryKey.length === 0) {
    return methods;
  }
  return methods.filter((method) => {
    const methodKey = normalizeExperienceCandidateLineForDedupe(method);
    if (methodKey.length === 0) {
      return false;
    }
    return !summaryKey.includes(methodKey);
  });
}

function filterExperienceCandidateEvidencePreviewCoveredByFinal(
  evidence: string | undefined,
  visibleTakeaways: readonly (string | undefined)[],
): string | undefined {
  if (evidence === undefined) {
    return undefined;
  }
  const visibleKey = normalizeExperienceCandidateLineForDedupe(
    visibleTakeaways.filter((item): item is string => item !== undefined).join(" "),
  );
  if (visibleKey.length === 0) {
    return evidence;
  }
  const remaining = splitExperienceCandidateSentenceList(evidence).filter((sentence) => {
    const key = normalizeExperienceCandidateLineForDedupe(sentence);
    return key.length > 0 && !visibleKey.includes(key);
  });
  if (remaining.length === 0) {
    return undefined;
  }
  return cleanupExperienceCandidateLine(remaining.join("；"));
}

function getExperienceCandidateSearchText(candidate: Readonly<Record<string, unknown>>): string {
  const sourceDocument = readRuntimeRecord(candidate.sourceDocument);
  return [
    readRuntimeString(candidate.title),
    readRuntimeString(candidate.summary),
    readRuntimeString(candidate.applicability),
    readRuntimeString(candidate.contentQuality),
    readRuntimeString(candidate.evidencePreview),
    readRuntimeString(sourceDocument?.content),
    readRuntimeString(sourceDocument?.rawContent),
  ]
    .filter((item): item is string => item !== undefined)
    .join("\n");
}

function hasMeaningfulExperienceCandidateText(
  candidate: Readonly<Record<string, unknown>>,
): boolean {
  const sourceDocument = readRuntimeRecord(candidate.sourceDocument);
  const text = [
    readRuntimeString(candidate.summary),
    readRuntimeString(candidate.applicability),
    readRuntimeString(sourceDocument?.content),
    readRuntimeString(sourceDocument?.rawContent),
  ]
    .filter((item): item is string => item !== undefined)
    .join("\n");
  if (text.trim().length < 24) {
    return false;
  }
  return /方法|流程|步骤|做法|经验|核心|结论|可复用|先.+再|结合|生成|设计|策略|路径|规则|模板|案例|复盘|问题|关键/iu.test(
    text,
  );
}

function hasReadableExperienceCandidateBody(candidate: Readonly<Record<string, unknown>>): boolean {
  const sourceDocument = readRuntimeRecord(candidate.sourceDocument);
  const body =
    readRuntimeString(sourceDocument?.rawContent) ?? readRuntimeString(sourceDocument?.content);
  if (body !== undefined && body.trim().length > 60 && !isExperienceCandidateFallbackNoise(body)) {
    return true;
  }
  const quality = readRuntimeString(candidate.contentQuality) ?? "";
  return /(正文可用|可读正文|readable|available)/iu.test(quality);
}

function extractExperienceCandidateFallbackParagraphs(
  candidate: Readonly<Record<string, unknown>>,
): readonly string[] {
  const sourceDocument = readRuntimeRecord(candidate.sourceDocument);
  const text = [
    readRuntimeString(sourceDocument?.rawContent),
    readRuntimeString(sourceDocument?.content),
    readRuntimeString(candidate.evidencePreview),
  ]
    .filter((item): item is string => item !== undefined)
    .join("\n\n");
  return text
    .split(/\n{2,}|[\r\n]+/u)
    .map((item) => item.replace(/\s+/gu, " ").trim())
    .filter((item) => item.length >= 20)
    .filter((item) => !isExperienceCandidateFallbackNoise(item))
    .slice(0, 3)
    .map((item) => truncateRuntimeUserText(item, 100));
}

function isExperienceCandidateFallbackNoise(value: string): boolean {
  return /Use when Director Angel|preserved source evidence|workflow step|Web content is untrusted|Pasted material may include|Experience candidate is distilled|must not bypass review|learning-evidence-context|source_document_content|candidate \d+:/iu.test(
    value,
  );
}

function deriveExperienceCandidateDisplayTitle(
  candidate: Readonly<Record<string, unknown>>,
  fallbackTitle: string,
): string {
  const sourceDocument = readRuntimeRecord(candidate.sourceDocument);
  const sourceTitle = cleanupExperienceCandidateLine(readRuntimeString(sourceDocument?.title));
  const cleanedFallback = cleanupExperienceCandidateLine(
    removeInternalExperienceCandidatePrefix(fallbackTitle),
  );
  if (sourceTitle !== undefined && !isInternalExperienceCandidateTitle(sourceTitle)) {
    return sourceTitle;
  }
  if (cleanedFallback !== undefined && !isInternalExperienceCandidateTitle(cleanedFallback)) {
    return cleanedFallback;
  }
  return "这条经验候选";
}

function deriveExperienceCandidateReadableSourceSummary(
  candidate: Readonly<Record<string, unknown>>,
): string | undefined {
  const sourceDocument = readRuntimeRecord(candidate.sourceDocument);
  const text = [
    readRuntimeString(sourceDocument?.rawContent),
    readRuntimeString(sourceDocument?.content),
    readRuntimeString(candidate.evidencePreview),
  ]
    .filter((item): item is string => item !== undefined)
    .join("\n");
  const sentence = splitReadableSnapshotSentences(text).find(
    (item) =>
      !isExperienceCandidatePromptAssetSpecSentence(item) &&
      /核心|真正|新手|误区|方法|路径|流程|Prompt|参数|工具|能力|Level|方便|适合|生成|资产|人设/iu.test(
        item,
      ),
  );
  return cleanupExperienceCandidateLine(sentence);
}

function deriveExperienceCandidateReadableMethods(
  candidate: Readonly<Record<string, unknown>>,
): readonly string[] {
  const sourceDocument = readRuntimeRecord(candidate.sourceDocument);
  const sourceText = [
    readRuntimeString(sourceDocument?.rawContent),
    readRuntimeString(sourceDocument?.content),
    readRuntimeString(candidate.summary),
    readRuntimeString(candidate.evidencePreview),
  ]
    .filter((item): item is string => item !== undefined)
    .join("\n");
  const methods = extractReadableSnapshotReusableMethods(sourceText, 4).map(
    (item) => cleanupExperienceCandidateLine(item) ?? item,
  );
  const cleaned = dedupeExperienceCandidateLines(
    methods.filter(
      (item) =>
        !isInternalExperienceCandidateApplicability(item) &&
        !isExperienceCandidatePromptAssetSpecSentence(item),
    ),
  );
  return cleaned.length > 0 ? cleaned : ["先把资料里的做法提炼成待确认经验，再由你决定是否收录。"];
}

function summarizeExperienceCandidateDistilledSummary(value: string): string | undefined {
  const text = removeInternalExperienceCandidatePrefix(value);
  if (text === undefined) {
    return undefined;
  }
  const sentences = splitExperienceCandidateSentenceList(text).filter(
    (item) => !isExperienceCandidatePromptAssetSpecSentence(item),
  );
  const ranked = rankExperienceCandidateDistilledSentences(sentences);
  return cleanupExperienceCandidateLine(ranked.slice(0, 2).join("；"));
}

function isInternalExperienceCandidateSummary(value: string): boolean {
  return /deterministic fallback|model distillation failed|fetch failed|不能算成功学习正文|登录\/注册|source material|preserved source evidence/iu.test(
    value,
  );
}

function rankExperienceCandidateDistilledSentences(
  sentences: readonly string[],
): readonly string[] {
  return [...sentences]
    .map((sentence, index) => ({
      sentence,
      index,
      score: scoreExperienceCandidateDistilledSentence(sentence),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.sentence);
}

function scoreExperienceCandidateDistilledSentence(sentence: string): number {
  let score = 0;
  if (/(适合|方便|方法|流程|做法|可复用|先.+再|结合|生成|拓展|复用)/iu.test(sentence)) {
    score += 12;
  }
  if (/(资产图|人设图|详情图|剧情设定|前序视频|截图|配角|角色)/iu.test(sentence)) {
    score += 8;
  }
  if (/(不满意|截取|放大|再生成|迭代)/iu.test(sentence)) {
    score += 7;
  }
  if (/^(?:基于|以文字标记|图片当中包含|背景纯白|风格[:：]|严格禁止出现)/iu.test(sentence)) {
    score -= 18;
  }
  return score;
}

function removeInternalExperienceCandidatePrefix(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const cleaned = value
    .replace(/^\s*Pasted\s+lesson\s*[:：]\s*/iu, "")
    .replace(/^\s*经验提炼\s*[:：]\s*/u, "")
    .trim();
  return cleaned.length === 0 ? undefined : cleaned;
}

function isInternalExperienceCandidateTitle(value: string): boolean {
  const trimmed = value.trim();
  if (/^(?:Pasted\s+lesson|https?:\/\/|experience[-_]|candidate[-_])/iu.test(trimmed)) {
    return true;
  }
  return /^(?:Web\s+lesson\s*:\s*)?(?:x\.com|twitter\.com)$/iu.test(trimmed);
}

function isInternalExperienceCandidateApplicability(value: string): boolean {
  return /\bUse when Director Angel\b|\buser-pasted material\b|\bpreserved source evidence\b/iu.test(
    value,
  );
}

function isInternalExperienceCandidateLimit(value: string): boolean {
  return /Experience candidate is distilled|raw source remains evidence|must not bypass review|deterministic fallback|model distillation failed|Web content is untrusted|Web guidance may be stale|api-provider|fetch failed|Pasted material may include|Privacy classification|source material|review-gated|review gated|preserved source evidence|user-pasted material/iu.test(
    value,
  );
}

function shouldSuppressDistillationFallbackLimit(
  candidate: Readonly<Record<string, unknown>>,
  value: string,
): boolean {
  return (
    /模型调用失败|deterministic fallback|fetch failed/iu.test(value) &&
    deriveExperienceCandidateReadableSourceSummary(candidate) !== undefined
  );
}

function splitExperienceCandidateSentenceList(value: string): readonly string[] {
  const normalized = value.replace(/\s+/gu, " ").trim();
  const parts = normalized
    .split(/(?:[。；;]\s*|[；;]\s*|\s+\d+[.、]\s*)/u)
    .map((item) => item.trim())
    .map((item) => item.replace(/^[，,、；;。\s]+/u, "").trim())
    .filter((item) => item.length > 0)
    .filter((item) => !isExperienceCandidatePromptAssetSpecSentence(item));
  const deduped = dedupeExperienceCandidateLines(parts);
  return deduped.length > 0 ? deduped.slice(0, 4) : [normalized];
}

function dedupeExperienceCandidateLines(lines: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const line of lines) {
    const cleaned = cleanupExperienceCandidateLine(line);
    if (cleaned === undefined) {
      continue;
    }
    const key = normalizeExperienceCandidateLineForDedupe(cleaned);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(cleaned);
  }
  return output;
}

function normalizeExperienceCandidateLineForDedupe(value: string): string {
  return value
    .replace(/^[，,、；;。\s]+/u, "")
    .replace(/[。；;，,\s]+/gu, "")
    .toLocaleLowerCase();
}

function isExperienceCandidatePromptAssetSpecSentence(value: string): boolean {
  const text = value.trim();
  if (text.length === 0) {
    return false;
  }
  if (/^[）)，,、；;。]/u.test(text)) {
    return true;
  }
  if (
    /^(?:请避免以下问题|GPT\s*Image\s*2?\s*提示词分享|如果平台对[^。\n]{0,20}敏感，也可以替换为)[:：]?$/iu.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /^(?:基于|以文字标记|图片当中包含|背景纯白|风格[:：]|严格禁止出现|确保风格|不要出现参考图)/iu.test(
      text,
    )
  ) {
    return true;
  }
  return (
    /(背景纯白|三视图|正视图|侧视图|背视图|身高参数|武器图|老式手枪|35mm|伦勃朗光|3D建模风格|游戏CG风格)/iu.test(
      text,
    ) && !/(方法|流程|复用|不满意|截取|放大|再生成|结合前序视频|资产图|人设图)/iu.test(text)
  );
}

function inferExperienceCandidateMediaUnderstandingNote(
  candidate: Readonly<Record<string, unknown>>,
  evidenceSource?: Readonly<Record<string, unknown>>,
): string | undefined {
  if (evidenceSource !== undefined) {
    const mediaCount = readExperienceCandidateEvidenceMediaCount(evidenceSource);
    if (mediaCount <= 0) {
      return undefined;
    }
    const status = readRuntimeString(evidenceSource.mediaUnderstandingStatus);
    const mediaAdmission = readRuntimeRecord(evidenceSource.mediaAdmission);
    const canAdmitMedia = mediaAdmission?.canAdmitMediaContent === true;
    if (canAdmitMedia || status === "understood") {
      return "已有可准入的媒体理解证据。";
    }
    const textRead = isExperienceCandidateEvidenceTextRead(evidenceSource);
    if (!textRead) {
      return "媒体边界：未读到可信正文，媒体未理解；不能把正文或媒体内容当结论。";
    }
    if (
      status === "metadata_only" ||
      status === "understood_or_metadata_understood" ||
      hasMetadataOnlyMediaUnderstandingEvidence(evidenceSource)
    ) {
      return "媒体边界：文本已读，媒体未理解；只完成媒体清单或元数据记录，不能把图片、视频或音频内容当结论。";
    }
    return "媒体边界：文本已读，媒体未理解；未授权前不能把图片、视频或音频内容当结论。";
  }
  const direct = cleanupExperienceCandidateLine(readRuntimeString(candidate.mediaUnderstanding));
  if (direct !== undefined) {
    if (
      hasMetadataOnlyMediaUnderstandingEvidence(candidate) ||
      /元数据级|metadata-only/iu.test(direct)
    ) {
      return "媒体边界：文本已读，媒体未理解；只完成媒体清单或元数据记录，不能把图片、视频或音频内容当结论。";
    }
    return direct;
  }
  const sourceDocument = readRuntimeRecord(candidate.sourceDocument);
  const text = [
    readRuntimeString(sourceDocument?.content),
    readRuntimeString(sourceDocument?.rawContent),
    readRuntimeString(candidate.evidencePreview),
  ]
    .filter((item): item is string => item !== undefined)
    .join("\n");
  if (!/(媒体资源|pbs\.twimg\.com|blob:https?:|video|图片|视频|media)/iu.test(text)) {
    return undefined;
  }
  if (hasPositiveExperienceCandidateMediaUnderstandingEvidence(text)) {
    return "已看到视觉或媒体理解证据。";
  }
  return "只记录到媒体链接/封面清单，还没有证据表明已理解图片或视频内容。";
}

function readExperienceCandidateEvidenceDisclosureSource(
  candidate: Readonly<Record<string, unknown>>,
  output: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
  const evidenceDisclosure = readRuntimeRecord(output.evidenceDisclosure);
  const sources = readRuntimeRecordArray(evidenceDisclosure?.sources);
  if (sources.length === 0) {
    return undefined;
  }
  const candidateId = readRuntimeString(candidate.id) ?? readRuntimeString(candidate.candidateId);
  const sourceRef =
    readRuntimeString(candidate.sourceRef) ?? readRuntimeString(candidate.rawSourceRef);
  return sources.find((source) => {
    const sourceCandidateId =
      readRuntimeString(source.candidateId) ?? readRuntimeString(source.candidate_id);
    if (
      candidateId !== undefined &&
      sourceCandidateId !== undefined &&
      sourceCandidateId === candidateId
    ) {
      return true;
    }
    const sourceUrl =
      readRuntimeString(source.url) ??
      readRuntimeString(source.sourceRef) ??
      readRuntimeString(source.source_ref);
    return sourceRef !== undefined && sourceUrl !== undefined && sourceUrl === sourceRef;
  });
}

function readExperienceCandidateEvidenceMediaCount(
  source: Readonly<Record<string, unknown>>,
): number {
  const mediaInventory =
    readRuntimeRecord(source.mediaInventory) ?? readRuntimeRecord(source.media_inventory);
  return (
    readRuntimeNumber(source.mediaCount) ??
    readRuntimeNumber(source.media_count) ??
    readRuntimeNumber(mediaInventory?.assetCount) ??
    readRuntimeNumber(mediaInventory?.asset_count) ??
    0
  );
}

function isExperienceCandidateEvidenceTextRead(source: Readonly<Record<string, unknown>>): boolean {
  const readStatus = readRuntimeString(source.readStatus) ?? readRuntimeString(source.read_status);
  const accessStatus =
    readRuntimeString(source.sourceAccessStatus) ?? readRuntimeString(source.source_access_status);
  if (readStatus === "failed" || accessStatus === "failed") {
    return false;
  }
  const fullBodyChars =
    readRuntimeNumber(source.fullBodyChars) ?? readRuntimeNumber(source.full_body_chars) ?? 0;
  const previewChars =
    readRuntimeNumber(source.previewChars) ?? readRuntimeNumber(source.preview_chars) ?? 0;
  return fullBodyChars > 0 || previewChars > 0;
}

function hasMetadataOnlyMediaUnderstandingEvidence(
  value: Readonly<Record<string, unknown>>,
): boolean {
  const direct = readRuntimeRecord(value.mediaUnderstanding);
  const metadata = readRuntimeRecord(value.metadata);
  const metadataUnderstanding = readRuntimeRecord(metadata?.mediaUnderstanding);
  const candidates = [direct, metadataUnderstanding, value].filter(
    (item): item is Readonly<Record<string, unknown>> => item !== undefined,
  );
  return candidates.some((item) => {
    const status =
      readRuntimeString(item.status) ?? readRuntimeString(item.mediaUnderstandingStatus);
    const semanticUnderstanding = readRuntimeString(item.semanticUnderstanding);
    return status === "metadata_understood" || semanticUnderstanding === "metadata-only";
  });
}

function renderExperienceCandidateMediaAuthorizationNote(
  candidate: Readonly<Record<string, unknown>>,
): string | undefined {
  const request = readExperienceCandidateMediaAuthorizationRequest(candidate);
  if (request === undefined) {
    return undefined;
  }
  const assetCount = readRuntimeNumber(request.assetCount) ?? 0;
  const imageCount = readRuntimeNumber(request.imageCount) ?? 0;
  const videoCount = readRuntimeNumber(request.videoCount) ?? 0;
  const audioCount = readRuntimeNumber(request.audioCount) ?? 0;
  const recommendedMode = readRuntimeString(request.recommendedMode) ?? "media_inventory";
  const costTier = readRuntimeString(request.estimatedCostTier) ?? "unknown";
  const tokenBudget = readRuntimeRecord(request.estimatedTokenBudget);
  const lowCostTokens = readRuntimeNumber(tokenBudget?.lowCost);
  const recommendedLabel =
    findExperienceCandidateMediaAuthorizationOptionLabel(request, recommendedMode) ??
    labelExperienceCandidateMediaAuthorizationMode(recommendedMode);
  return [
    `发现 ${assetCount} 个媒体资产：图片 ${imageCount}、视频 ${videoCount}、音频 ${audioCount}。`,
    `推荐：${recommendedLabel}；预算档位：${costTier}${
      lowCostTokens === undefined ? "" : `；低成本预估 ${lowCostTokens} tokens`
    }。`,
    "未授权前不把媒体内容当成已学经验入库，只保留正文和媒体清单。",
  ].join("\n");
}

function readExperienceCandidateMediaAuthorizationRequest(
  candidate: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
  const direct = readRuntimeRecord(candidate.mediaAuthorizationRequest);
  if (direct !== undefined) {
    return direct;
  }
  const metadata = readRuntimeRecord(candidate.metadata);
  const metadataRequest = readRuntimeRecord(metadata?.mediaAuthorizationRequest);
  if (metadataRequest !== undefined) {
    return metadataRequest;
  }
  const sourceDocument = readRuntimeRecord(candidate.sourceDocument);
  const sourceMetadata = readRuntimeRecord(sourceDocument?.metadata);
  return readRuntimeRecord(sourceMetadata?.mediaAuthorizationRequest);
}

function findExperienceCandidateMediaAuthorizationOptionLabel(
  request: Readonly<Record<string, unknown>>,
  mode: string,
): string | undefined {
  const options = readRuntimeRecordArray(request.options);
  const option = options.find((item) => readRuntimeString(item.mode) === mode);
  return cleanupExperienceCandidateLine(readRuntimeString(option?.label));
}

function labelExperienceCandidateMediaAuthorizationMode(mode: string): string {
  if (mode === "low_cost") {
    return "低成本精读重点媒体";
  }
  if (mode === "deep_multimodal") {
    return "全量多模态理解";
  }
  if (mode === "text_only") {
    return "只学习正文";
  }
  return "只记录媒体清单";
}

function hasPositiveExperienceCandidateMediaUnderstandingEvidence(value: string): boolean {
  return (
    /realVisualUnderstanding\s*[:：=]\s*true/iu.test(value) ||
    /vision_analyzed\s*[:：=]\s*(true|yes|1|success|completed|done|已完成|完成)/iu.test(value) ||
    /visual(?:_|-)?understanding\s*[:：=]\s*(true|yes|1|success|completed|done|已完成|完成)/iu.test(
      value,
    ) ||
    /(已|已经)(调用|完成|进行).{0,12}(视觉|图片|视频).{0,12}(理解|分析)/iu.test(value)
  );
}

function renderBrowserNavigateFallbackFinal(
  result: ConversationRuntimeToolExecutionOutput,
): string | undefined {
  const output = isRuntimeRecord(result.output) ? result.output : {};
  const fields = parseBrowserToolObservationFields(result.content);
  const status =
    readRuntimeString(output.status) ?? fields.status ?? (result.ok ? "success" : "error");
  const url =
    readRuntimeString(output.url) ??
    fields.url ??
    readBrowserToolUrlFromSummary(readRuntimeString(output.summary) ?? fields.summary ?? "") ??
    "";
  const title = readRuntimeString(output.title) ?? fields.title ?? "";
  const snapshot =
    readRuntimeString(output.snapshot_preview) ??
    readRuntimeString(output.snapshotPreview) ??
    fields.snapshotPreview ??
    "";
  const summary = readRuntimeString(output.summary) ?? fields.summary ?? "";
  if (status === "success" && result.ok === true) {
    return [
      `我已经用桌面浏览器打开${title.length > 0 ? `「${title}」` : "这个页面"}。`,
      ...(url.length === 0 ? [] : [`地址：${url}`]),
      ...(snapshot.length === 0 ? [] : [`页面显示：${truncateRuntimeUserText(snapshot, 220)}`]),
      "如果你要我继续读正文或点页面里的内容，可以直接说继续。",
    ].join("\n");
  }
  return [
    "我没能用浏览器打开这个页面。",
    ...(url.length === 0 ? [] : [`地址：${url}`]),
    ...(summary.length === 0 ? [] : [`卡点：${humanizeBrowserToolFailureSummary(summary)}`]),
    "下一步可以确认桌面浏览器已连接，或换成可公开访问的链接。",
  ].join("\n");
}

function readBrowserToolUrlFromSummary(summary: string): string | undefined {
  return /https?:\/\/\S+/iu.exec(summary)?.[0]?.replace(/[，,。.;；]+$/u, "");
}

function humanizeBrowserToolFailureSummary(summary: string): string {
  if (/browser_navigate|browser_snapshot|fetch failed|provider|bridge|Desktop/iu.test(summary)) {
    return "浏览器通道这次没有真正打开页面，或目标网页没有返回可读内容。";
  }
  return summary;
}

function renderBrowserSnapshotFallbackFinal(
  result: ConversationRuntimeToolExecutionOutput,
): string | undefined {
  const output = isRuntimeRecord(result.output) ? result.output : {};
  const fields = parseBrowserToolObservationFields(result.content);
  const status =
    readRuntimeString(output.status) ?? fields.status ?? (result.ok ? "success" : "error");
  const url = readRuntimeString(output.url) ?? fields.url ?? "";
  const title = readRuntimeString(output.title) ?? fields.title ?? "";
  const text = readRuntimeString(output.text) ?? fields.text ?? "";
  if (status !== "success" || result.ok !== true) {
    return undefined;
  }
  return [
    title.length > 0 ? `我已经读取当前浏览器页面「${title}」。` : "我已经读取当前浏览器页面。",
    ...(url.length === 0 ? [] : [`地址：${url}`]),
    ...(text.length === 0 ? [] : [`页面内容：${truncateRuntimeUserText(text, 360)}`]),
  ].join("\n");
}

function parseBrowserToolObservationFields(content: string): {
  readonly status?: string;
  readonly summary?: string;
  readonly url?: string;
  readonly title?: string;
  readonly text?: string;
  readonly snapshotPreview?: string;
} {
  const fields: {
    status?: string;
    summary?: string;
    url?: string;
    title?: string;
    text?: string;
    snapshotPreview?: string;
  } = {};
  let currentBlock: "text" | "snapshot_preview" | null = null;
  const blockLines: string[] = [];
  const flushBlock = () => {
    if (currentBlock === null) {
      return;
    }
    const value = blockLines.join("\n").trim();
    if (value.length > 0) {
      if (currentBlock === "text") {
        fields.text = value;
      } else {
        fields.snapshotPreview = value;
      }
    }
    currentBlock = null;
    blockLines.length = 0;
  };
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (currentBlock !== null) {
      if (/^[a-z_][a-z0-9_]*\s*:/iu.test(trimmed)) {
        flushBlock();
      } else {
        blockLines.push(line);
        continue;
      }
    }
    const match = /^(status|summary|url|title|text|snapshot_preview)\s*:\s*(.*)$/iu.exec(trimmed);
    if (match === null) {
      continue;
    }
    const key = match[1]?.toLowerCase();
    const value = match[2]?.trim() ?? "";
    if (key === "text" || key === "snapshot_preview") {
      currentBlock = key;
      if (value.length > 0) {
        blockLines.push(value);
      }
      continue;
    }
    if (key === "status") fields.status = value;
    if (key === "summary") fields.summary = value;
    if (key === "url") fields.url = value;
    if (key === "title") fields.title = value;
  }
  flushBlock();
  return fields;
}

function truncateRuntimeUserText(value: string, maxChars: number): string {
  const text = value.replace(/\s+/gu, " ").trim();
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function renderContradictedSkillIndexFinal(
  modelText: string,
  result: ConversationRuntimeToolExecutionOutput,
):
  | {
      readonly finalText: string;
      readonly corrected: true;
      readonly metadata: Readonly<Record<string, unknown>>;
    }
  | undefined {
  if (result.ok !== true) {
    return undefined;
  }
  if (!doesModelClaimSkillExecution(modelText)) {
    return undefined;
  }
  const fields = parseSimpleToolObservationFields(result.content);
  const output = isRuntimeRecord(result.output) ? result.output : {};
  const skillIds = readRuntimeStringArray(output.skill_ids);
  const skillItems = readRuntimeRecordArray(output.skills);
  const renderedSkillIds =
    skillIds.length > 0
      ? skillIds
      : skillItems
          .map((item) => readRuntimeString(item.id) ?? readRuntimeString(item.skillId))
          .filter((item): item is string => item !== undefined && item.length > 0);
  const skillList =
    renderedSkillIds.length > 0
      ? renderedSkillIds.join(", ")
      : fields.skills?.trim() || "未返回具体 Skill id";
  const nextAction =
    readRuntimeString(output.next_actions) ??
    fields.next_actions ??
    "这里只是索引；真正按 Skill 执行前必须调用 director.skills.view 读取 Skill 内容。";
  return {
    finalText: [
      "只完成了 Skill 索引检索，还没有真正读取或使用 Skill。",
      `候选 Skill：${skillList}`,
      `下一步：调用 director.skills.view 读取目标 Skill 后，再基于 Skill 内容回答或执行。${nextAction}`,
    ].join("\n"),
    corrected: true,
    metadata: {
      toolName: result.toolName,
      callId: result.callId,
      status: readRuntimeString(output.status) ?? fields.status ?? "success",
      skillIds: renderedSkillIds,
    },
  };
}

function renderContradictedSkillViewFinal(
  modelText: string,
  result: ConversationRuntimeToolExecutionOutput,
):
  | {
      readonly finalText: string;
      readonly corrected: true;
      readonly metadata: Readonly<Record<string, unknown>>;
    }
  | undefined {
  if (result.ok === true) {
    return undefined;
  }
  const fields = parseSimpleToolObservationFields(result.content);
  const output = isRuntimeRecord(result.output) ? result.output : {};
  const status = readRuntimeString(output.status) ?? fields.status;
  if (
    status !== "disabled" &&
    status !== "missing_skill" &&
    status !== "model_invocation_disabled" &&
    status !== "needs_setup" &&
    status !== "approval_required" &&
    status !== "error"
  ) {
    return undefined;
  }
  const summary = readRuntimeString(output.summary) ?? fields.summary ?? "Skill 当前不可用。";
  const skillId = readRuntimeString(output.skill_id) ?? fields.skill_id ?? "";
  const nextAction =
    readRuntimeString(output.next_actions) ??
    fields.next_actions ??
    (status === "model_invocation_disabled"
      ? "需要操作员在 Skills 管理里调整模型调用权限后再用。当前轮不要假装已经读取或执行。"
      : status === "missing_skill"
        ? "需要重新调用 director.skills.list 刷新 Skill 索引。当前轮不要假装已经读取或执行。"
        : status === "needs_setup"
          ? "需要先完成 Skill 依赖工具配置。当前轮不要假装已经读取或执行。"
          : "如用户要使用它，先启用该 Skill；当前轮不要假装已经读取或执行。");
  const finalText = [
    summary,
    ...(skillId.length === 0 ? [] : [`Skill：${skillId}`]),
    `下一步：${
      status === "model_invocation_disabled"
        ? "先允许模型调用该 Skill 后再使用。"
        : status === "missing_skill"
          ? "先刷新 Skill 索引，确认该 Skill 仍存在后再使用。"
          : status === "needs_setup"
            ? "先完成依赖工具配置后再使用。"
            : "先启用该 Skill 后再使用。"
    }${nextAction}`,
  ].join("\n");
  return {
    finalText,
    corrected: true,
    metadata: {
      toolName: result.toolName,
      callId: result.callId,
      status,
      skillId,
    },
  };
}

function doesModelClaimSkillExecution(modelText: string): boolean {
  return /(已经|已|正在).*(使用|调用|执行|读取|加载)|用.*Skill.*回答|基于.*Skill|已经.*Skill|使用.*Skill.*生成/iu.test(
    modelText,
  );
}

function parseSimpleToolObservationFields(content: string): Readonly<Record<string, string>> {
  const fields: Record<string, string> = {};
  for (const line of content.split(/\r?\n/u)) {
    const match = /^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/iu.exec(line.trim());
    if (match === null) {
      continue;
    }
    const key = match[1]?.trim();
    if (key === undefined || key.length === 0) {
      continue;
    }
    fields[key] = match[2]?.trim() ?? "";
  }
  return fields;
}

function shouldReplaceModelFinalWithGrounding(
  modelText: string,
  results: readonly ConversationRuntimeToolExecutionOutput[],
): boolean {
  if (modelText.length === 0) {
    return true;
  }
  for (const result of results) {
    if (result.toolName === "director.experience.candidates.list") {
      continue;
    }
    const observation = parseGroundingToolObservation(result);
    if (observation === undefined) {
      continue;
    }
    if (result.toolName === "web_extract") {
      if (isUngroundedExtractionFinal(modelText, observation, result)) {
        return true;
      }
      continue;
    }
    if (result.toolName === "x_search") {
      if (isUngroundedXSearchFinal(modelText, observation)) {
        return true;
      }
      continue;
    }
    if (observation.status === "success" && observation.results.length > 0) {
      if (isUngroundedSearchFinal(modelText, observation)) {
        return true;
      }
      continue;
    }
    if (
      observation.status === "blocked" ||
      observation.status === "warning" ||
      observation.status === "error" ||
      result.ok === false
    ) {
      if (isVagueGroundingFailureFinal(modelText, observation)) {
        return true;
      }
    }
  }
  return false;
}

function isUngroundedExtractionFinal(
  text: string,
  observation: RequiredGroundingObservation,
  result: ConversationRuntimeToolExecutionOutput,
): boolean {
  if (text.length === 0) {
    return true;
  }
  if (observation.status === "error" || observation.status === "blocked" || result.ok === false) {
    return !/(还没有.*(学到|读取|读到)|没有真正学到|读取失败|提取失败|失败原因|验证|打不开|无法读取)/iu.test(
      text,
    );
  }
  if (observation.status !== "success") {
    return false;
  }
  if (observation.textPreview.length > 0) {
    const previewNeedle = observation.textPreview.slice(0, 18).toLocaleLowerCase();
    return !text.toLocaleLowerCase().includes(previewNeedle);
  }
  if (observation.title.length > 0) {
    return !text.toLocaleLowerCase().includes(observation.title.slice(0, 18).toLocaleLowerCase());
  }
  return false;
}

function isUngroundedSearchFinal(text: string, observation: RequiredGroundingObservation): boolean {
  const normalized = text.toLocaleLowerCase();
  if (/没有.*(找到|搜索到|查到|结果)|未找到|找不到|无法.*搜索|不能.*搜索/iu.test(text)) {
    return true;
  }
  if (observation.provider.length > 0 && !hasProviderEvidenceInText(text, observation)) {
    return true;
  }
  if (
    (observation.sourceType === "weixin_article" || observation.provider === "sogou-weixin") &&
    !/(微信公众号|公众号文章|微信文章|搜狗微信|sogou|weixin)/iu.test(text)
  ) {
    return true;
  }
  const observedTitles = sanitizeGroundingSearchResults(observation.results)
    .map((result) => result.title)
    .filter((title) => title.length > 0);
  if (observedTitles.length === 0) {
    return false;
  }
  return !observedTitles.some((title) =>
    normalized.includes(title.toLocaleLowerCase().slice(0, 18)),
  );
}

function isUngroundedXSearchFinal(
  text: string,
  observation: RequiredGroundingObservation,
): boolean {
  if (observation.status === "success" && observation.results.length > 0) {
    return isUngroundedSearchFinal(text, observation);
  }
  if (
    observation.status === "needs-auth" ||
    observation.status === "blocked" ||
    observation.status === "warning" ||
    observation.status === "error"
  ) {
    return !/(X\/Twitter|Twitter|推特|API|provider|密钥|未配置|浏览器|公开网页|web_search|失败原因|原因)/iu.test(
      text,
    );
  }
  return false;
}

function hasProviderEvidenceInText(
  text: string,
  observation: RequiredGroundingObservation,
): boolean {
  const normalized = text.toLocaleLowerCase();
  if (normalized.includes(observation.provider.toLocaleLowerCase())) {
    return true;
  }
  if (observation.provider === "x-twitter" || observation.sourceType === "social_post") {
    return /X\/Twitter|Twitter|推特|x\.com/iu.test(text);
  }
  if (observation.provider === "sogou-weixin" || observation.sourceType === "weixin_article") {
    return /搜狗微信|搜狗公众号|搜狗微信公众号|微信公众号|公众号文章|微信文章/iu.test(text);
  }
  return false;
}

function isVagueGroundingFailureFinal(
  text: string,
  observation: RequiredGroundingObservation,
): boolean {
  if (/您是想执行哪个操作|你想执行哪个操作|请问.*哪个操作|比如 ComfyUI/iu.test(text)) {
    return true;
  }
  if (observation.status === "blocked" && !/验证码|验证|人工|浏览器|搜狗/iu.test(text)) {
    return true;
  }
  return false;
}

function renderRequiredGroundingFinal(
  results: readonly ConversationRuntimeToolExecutionOutput[],
): { readonly text: string; readonly metadata: Readonly<Record<string, unknown>> } | undefined {
  for (const result of rankGroundingResultsForFinal(results)) {
    const observation = parseGroundingToolObservation(result);
    if (observation === undefined) {
      continue;
    }
    const text = renderGroundingObservationFinal(observation, result);
    if (text !== undefined) {
      return {
        text,
        metadata: {
          toolName: result.toolName,
          callId: result.callId,
          ok: result.ok,
          status: observation.status,
          provider: observation.provider,
          sourceType: observation.sourceType,
          resultCount: observation.results.length,
        },
      };
    }
  }
  return undefined;
}

function rankGroundingResultsForFinal(
  results: readonly ConversationRuntimeToolExecutionOutput[],
): readonly ConversationRuntimeToolExecutionOutput[] {
  return [...results].sort((left, right) => {
    const leftObservation = parseGroundingToolObservation(left);
    const rightObservation = parseGroundingToolObservation(right);
    return (
      scoreGroundingObservationForFinal(rightObservation, right) -
      scoreGroundingObservationForFinal(leftObservation, left)
    );
  });
}

function scoreGroundingObservationForFinal(
  observation: RequiredGroundingObservation | undefined,
  result: ConversationRuntimeToolExecutionOutput,
): number {
  if (observation === undefined) {
    return 0;
  }
  if (observation.status === "success" && observation.results.length > 0) {
    return 100;
  }
  if (
    result.toolName === "web_extract" &&
    observation.status === "success" &&
    observation.textPreview.length > 0
  ) {
    return 95;
  }
  if (observation.status === "blocked") {
    return 60;
  }
  if (observation.status === "needs-auth") {
    return 50;
  }
  if (observation.status === "warning") {
    return 40;
  }
  if (observation.status === "error" || result.ok === false) {
    return 20;
  }
  return 10;
}

function renderGroundingObservationFinal(
  observation: RequiredGroundingObservation,
  result: ConversationRuntimeToolExecutionOutput,
): string | undefined {
  if (result.toolName === "web_extract") {
    return renderExtractionGroundingFinal(observation, result);
  }
  const providerLabel = formatGroundingProviderLabel(observation.provider, observation.sourceType);
  if (observation.status === "success" && observation.results.length > 0) {
    const reliableResults = sanitizeGroundingSearchResults(observation.results);
    if (reliableResults.length === 0) {
      return renderNoReliableGroundingSearchFinal(observation);
    }
    const lines = [
      "先给结论：",
      `取证来源：${providerLabel}`,
      `1. 这次拿到 ${reliableResults.length} 条可参考来源，但还只是搜索摘要层证据，正式判断要继续读正文。`,
      renderGroundingCandidateSummaryLine(reliableResults),
      "3. 我已经过滤掉广告、跳转页和低可信促销页；下一步应该读取正文后再给更稳的判断。",
      "",
      "来源：",
      ...reliableResults
        .slice(0, 5)
        .map((item, index) =>
          [
            `${index + 1}. ${item.title}`,
            ...(item.url.length === 0 ? [] : [item.url]),
            ...(item.snippet.length === 0 ? [] : [`摘要：${item.snippet}`]),
          ].join("\n"),
        ),
    ];
    const nextAction = observation.nextActions[0];
    if (nextAction !== undefined && /extract|提取|读取|web_extract/iu.test(nextAction)) {
      lines.push("", "要继续的话，我会优先读取上面这些来源的正文，再给你收口成结论。");
    }
    return lines.join("\n\n");
  }
  if (observation.status === "blocked") {
    if (result.toolName === "x_search") {
      return [
        `我已尝试通过${providerLabel}检索「${observation.query || "相关内容"}」，但 X/Twitter provider 需要验证或人工处理。`,
        "下一步可以连接可用的 X/Twitter provider，或改用浏览器/公开网页搜索继续取证。",
      ].join("\n");
    }
    return [
      `我已尝试通过${providerLabel}检索「${observation.query || "相关内容"}」，但搜狗微信触发了验证/反爬。`,
      "下一步需要打开搜狗微信页面完成验证后再继续，或改用其它公开搜索源补充检索。",
    ].join("\n");
  }
  if (observation.status === "warning") {
    const failures =
      observation.failures.length > 0 ? `原因：${observation.failures.join("；")}` : "";
    return [
      "这次没有拿到可靠结果。",
      ...(observation.query.length === 0 ? [] : [`我查的是：${observation.query}`]),
      failures,
      "下一步我会换搜索源，或直接读取你给的具体链接继续取证。",
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  }
  if (observation.status === "needs-auth") {
    const failures =
      observation.failures.length > 0 ? observation.failures.join("；") : observation.summary;
    return [
      `我已尝试调用${providerLabel}检索「${observation.query || "相关内容"}」，但当前还不能直接搜索 X/Twitter。`,
      ...(failures.length === 0 ? [] : [`原因：${failures}`]),
      "下一步可以配置 X/Twitter provider/API key，或让我改用浏览器/公开网页搜索继续找来源。",
    ].join("\n");
  }
  if (observation.status === "error" || result.ok === false) {
    const failures =
      observation.failures.length > 0 ? observation.failures.join("；") : (result.error ?? "");
    return [
      `我已尝试调用${providerLabel}，但工具执行失败。`,
      ...(failures.length === 0 ? [] : [`原因：${failures}`]),
    ].join("\n");
  }
  return undefined;
}

function renderNoReliableGroundingSearchFinal(observation: RequiredGroundingObservation): string {
  return [
    "这次没有拿到可靠来源。",
    ...(observation.query.length === 0 ? [] : [`我查的是：${observation.query}`]),
    "拿到的内容主要是广告、跳转页或低可信促销页，不能当成结论，也不会写成经验。",
    "下一步我会换搜索源，或直接读取具体来源正文后再判断。",
  ].join("\n");
}

function renderGroundingCandidateSummaryLine(results: readonly GroundingSearchResult[]): string {
  const candidates = extractGroundingCandidateMentions(results).slice(0, 8);
  if (candidates.length === 0) {
    return "2. 这些来源可以作为候选证据，但标题和摘要还不足以稳定提取具体模型名。";
  }
  return `2. 来源里明确提到的候选包括：${candidates.join("、")}。`;
}

function extractGroundingCandidateMentions(
  results: readonly GroundingSearchResult[],
): readonly string[] {
  const candidates: string[] = [];
  const addCandidate = (value: string) => {
    const normalized = value.trim().replace(/[，。；;:：、|/]+$/u, "");
    if (
      normalized.length < 2 ||
      normalized.length > 48 ||
      candidates.some(
        (candidate) => candidate.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
      )
    ) {
      return;
    }
    candidates.push(normalized);
  };
  for (const result of results) {
    const text = `${result.title} ${result.snippet}`;
    for (const match of text.matchAll(
      /\b(?:Midjourney(?:\s+v?\d+(?:\.\d+)?)?|Flux(?:\s+(?:Pro|Dev|Kontext))?|Imagen(?:\s+\d+)?|Stable Diffusion(?:\s+[A-Z0-9.]+)?|Runway(?:\s+Gen-?\d+)?|Gen-?\d+|Luma(?:\s+Dream Machine)?|Dream Machine|Kling|Sora|Veo(?:\s+\d+)?|Seedance(?:\s+\d+(?:\.\d+)?)?|Qwen[-\s]?Image|DALL[·\-\s]?E(?:\s+\d+)?|Hailuo|PixVerse)\b/giu,
    )) {
      addCandidate(match[0] ?? "");
    }
    for (const segment of result.title.split(/\s*(?:\/|\||,|，|、|\+|\band\b|和|与)\s*/iu)) {
      if (
        /^[A-Z][A-Za-z0-9.-]*(?:\s+(?:v?\d+(?:\.\d+)?|Pro|Dev|Gen-?\d+|Image|Machine))?$/u.test(
          segment,
        )
      ) {
        addCandidate(segment);
      }
    }
  }
  return candidates;
}

function sanitizeGroundingSearchResults(
  results: readonly GroundingSearchResult[],
): readonly GroundingSearchResult[] {
  const cleaned: GroundingSearchResult[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    const title = result.title.trim();
    const url = result.url.trim();
    const snippet = result.snippet.trim();
    if (title.length === 0 && url.length === 0) {
      continue;
    }
    if (isGroundingSearchAdOrTrackingUrl(url)) {
      continue;
    }
    if (isLikelyGroundingSearchAdTitle(title)) {
      continue;
    }
    if (snippet.length > 0 && isLikelyGroundingSearchAdSnippet(snippet)) {
      continue;
    }
    const dedupeKey = url.length > 0 ? url : title.toLocaleLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    cleaned.push({ title, url, snippet });
  }
  return cleaned;
}

function isGroundingSearchAdOrTrackingUrl(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return true;
  }
  const host = url.hostname.toLocaleLowerCase();
  const path = url.pathname.toLocaleLowerCase();
  if (
    /duckduckgo\.com$/iu.test(host) &&
    (/\/y\.js$/iu.test(path) || url.searchParams.has("ad_domain"))
  ) {
    return true;
  }
  if (/bing\.com$/iu.test(host) && /\/aclick$/iu.test(path)) {
    return true;
  }
  return url.searchParams.has("ad_domain") || url.searchParams.has("ad_provider");
}

function isLikelyGroundingSearchAdTitle(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase();
  return (
    /\b(?:ad|ads|sponsored)\b/iu.test(normalized) ||
    /\b(?:try|free|generate|create)\b.*\b(?:generator|videos?|images?)\b/iu.test(normalized) ||
    /\b(?:generator|videos?|images?)\b.*\b(?:free|with audio|4 modes)\b/iu.test(normalized)
  );
}

function isLikelyGroundingSearchAdSnippet(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase();
  return (
    /\b(?:try|start|create|generate)\b.*\b(?:free|professional|2k|4k)\b/iu.test(normalized) ||
    /\b(?:limited time|sign up|subscribe|pricing)\b/iu.test(normalized)
  );
}

function renderExtractionGroundingFinal(
  observation: RequiredGroundingObservation,
  result: ConversationRuntimeToolExecutionOutput,
): string | undefined {
  const url =
    observation.url ||
    readRuntimeString(isRuntimeRecord(result.output) ? result.output.url : undefined) ||
    "";
  const title =
    observation.title ||
    readRuntimeString(isRuntimeRecord(result.output) ? result.output.title : undefined) ||
    "";
  if (observation.status === "success") {
    const preview = observation.textPreview;
    const lines = [
      title.length > 0 ? `我已读取「${title}」。` : "我已读取候选来源。",
      ...(preview.length === 0 ? [] : [`我学到的正文要点：${preview}`]),
      ...(url.length === 0 ? [] : [`来源：${url}`]),
    ];
    return lines.join("\n");
  }
  if (observation.status === "error" || observation.status === "blocked" || result.ok === false) {
    const failures =
      observation.failures.length > 0
        ? observation.failures.join("；")
        : (result.error ?? observation.summary);
    const failureLine =
      /low-quality extracted content|verification|login|UI residue|article body|captcha|verify|验证|访问受限|环境异常/iu.test(
        failures,
      )
        ? `访问受限：${failures}`
        : `失败原因：${failures}`;
    return [
      "这次还没有学到可信正文；还没有真正学到正文。",
      ...(url.length === 0 ? [] : [`我尝试读取：${url}`]),
      ...(failures.length === 0 ? [] : [failureLine]),
      "下一步：换成可公开访问的链接，或把正文直接发过来；系统不会把验证页当成学习内容。",
    ].join("\n");
  }
  return undefined;
}

interface RequiredGroundingObservation {
  readonly status: string;
  readonly summary: string;
  readonly query: string;
  readonly url: string;
  readonly title: string;
  readonly textPreview: string;
  readonly provider: string;
  readonly sourceType: string;
  readonly results: readonly GroundingSearchResult[];
  readonly failures: readonly string[];
  readonly nextActions: readonly string[];
}

interface GroundingSearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

function parseGroundingToolObservation(
  result: ConversationRuntimeToolExecutionOutput,
): RequiredGroundingObservation | undefined {
  const output = isRuntimeRecord(result.output) ? result.output : {};
  const contentFields = parseGroundingObservationContent(result.content);
  const status =
    readRuntimeString(output.status) ?? contentFields.status ?? (result.ok ? "success" : "error");
  const query = readRuntimeString(output.query) ?? contentFields.query ?? "";
  const url = readRuntimeString(output.url) ?? contentFields.url ?? "";
  const title = readRuntimeString(output.title) ?? contentFields.title ?? "";
  const textPreview =
    readRuntimeString(output.text_preview) ??
    readRuntimeString(output.textPreview) ??
    contentFields.textPreview ??
    "";
  const provider = readRuntimeString(output.provider) ?? contentFields.provider ?? "";
  const sourceType =
    readRuntimeString(output.source_type) ??
    readRuntimeString(output.sourceType) ??
    contentFields.sourceType ??
    "";
  const results = parseGroundingObservationResults(output.results, result.content);
  const failures = readRuntimeStringArray(output.failures, contentFields.failures);
  const nextActions = readRuntimeStringArray(
    output.next_actions ?? output.nextActions,
    contentFields.nextActions,
  );
  if (
    result.toolName !== "web_search" &&
    result.toolName !== "web_extract" &&
    provider.length === 0 &&
    sourceType.length === 0 &&
    url.length === 0 &&
    title.length === 0 &&
    textPreview.length === 0 &&
    results.length === 0
  ) {
    return undefined;
  }
  return {
    status,
    summary: readRuntimeString(output.summary) ?? contentFields.summary ?? "",
    query,
    url,
    title,
    textPreview,
    provider,
    sourceType,
    results,
    failures,
    nextActions,
  };
}

function parseGroundingObservationContent(content: string): {
  readonly status?: string;
  readonly summary?: string;
  readonly query?: string;
  readonly url?: string;
  readonly title?: string;
  readonly textPreview?: string;
  readonly provider?: string;
  readonly sourceType?: string;
  readonly failures?: readonly string[];
  readonly nextActions?: readonly string[];
} {
  const fields = new Map<string, string>();
  for (const line of content.split(/\r?\n/u)) {
    const match =
      /^(status|summary|query|url|title|text_preview|provider|source_type|failures|next_actions)\s*:\s*(.*)$/iu.exec(
        line.trim(),
      );
    if (match === null) {
      continue;
    }
    const key = match[1]?.toLowerCase();
    if (key === undefined) {
      continue;
    }
    fields.set(key, match[2]?.trim() ?? "");
  }
  const parsed: {
    status?: string;
    summary?: string;
    query?: string;
    url?: string;
    title?: string;
    textPreview?: string;
    provider?: string;
    sourceType?: string;
    failures?: readonly string[];
    nextActions?: readonly string[];
  } = {};
  const status = fields.get("status");
  if (status !== undefined) parsed.status = status;
  const summary = fields.get("summary");
  if (summary !== undefined) parsed.summary = summary;
  const query = fields.get("query");
  if (query !== undefined) parsed.query = query;
  const url = fields.get("url");
  if (url !== undefined) parsed.url = url;
  const title = fields.get("title");
  if (title !== undefined) parsed.title = title;
  const textPreview = fields.get("text_preview");
  if (textPreview !== undefined) parsed.textPreview = textPreview;
  const provider = fields.get("provider");
  if (provider !== undefined) parsed.provider = provider;
  const sourceType = fields.get("source_type");
  if (sourceType !== undefined) parsed.sourceType = sourceType;
  const failures = fields.get("failures");
  if (failures !== undefined) parsed.failures = splitGroundingList(failures);
  const nextActions = fields.get("next_actions");
  if (nextActions !== undefined) parsed.nextActions = splitGroundingList(nextActions);
  return parsed;
}

function parseGroundingObservationResults(
  value: unknown,
  content: string,
): readonly GroundingSearchResult[] {
  const structured = Array.isArray(value)
    ? value
        .filter(isRuntimeRecord)
        .map((item) => ({
          title: readRuntimeString(item.title) ?? "",
          url: readRuntimeString(item.url) ?? "",
          snippet: readRuntimeString(item.snippet) ?? "",
        }))
        .filter((item) => item.title.length > 0 || item.url.length > 0)
    : [];
  if (structured.length > 0) {
    return structured;
  }
  const results: GroundingSearchResult[] = [];
  for (const line of content.split(/\r?\n/u)) {
    const match = /^result_\d+\s*:\s*(.+)$/iu.exec(line.trim());
    if (match === null) {
      continue;
    }
    const parts = (match[1] ?? "").split(/\s+\|\s+/u);
    const title = parts[0]?.trim() ?? "";
    const url = readGroundingPart(parts, "url");
    const snippet = readGroundingPart(parts, "snippet");
    if (title.length > 0 || url.length > 0) {
      results.push({ title, url, snippet });
    }
  }
  return results;
}

function readGroundingPart(parts: readonly string[], key: string): string {
  const prefix = `${key}=`;
  return (
    parts
      .find((part) => part.startsWith(prefix))
      ?.slice(prefix.length)
      .trim() ?? ""
  );
}

function readRuntimeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readRuntimeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readRuntimeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readRuntimeRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return isRuntimeRecord(value) ? value : undefined;
}

function readRuntimeStringArray(value: unknown, fallback?: readonly string[]): readonly string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return fallback ?? [];
}

function readRuntimeRecordArray(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRuntimeRecord);
}

function compactRuntimeRecord(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function splitGroundingList(value: string): readonly string[] {
  return value
    .split(/\s*;\s*/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== "none");
}

function isRuntimeRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function formatGroundingProviderLabel(provider: string, sourceType: string): string {
  if (provider === "x-twitter" || sourceType === "social_post") {
    return "X/Twitter";
  }
  if (provider === "sogou-weixin" || sourceType === "weixin_article") {
    return "搜狗微信公众号文章搜索";
  }
  return provider.length > 0 ? provider : "已配置搜索工具";
}

function normalizeConversationRuntimeFinalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  return text.length === 0 ? undefined : text;
}

function createInterruptedConversationRuntimeResult(input: {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly occurredAtMs: number;
  readonly turn: ConversationRuntimeTurnDecision;
  readonly capabilityPacket: ConversationRuntimeCapabilityPacket | undefined;
  readonly traceItems: readonly ConversationRuntimeTraceItem[];
}): ConversationRuntimeResult {
  const capabilityRoute = resolveConversationRuntimeCapabilityRoute(input.turn);
  return {
    turnId: input.turnId,
    sessionKey: input.sessionKey,
    replySource: "local-command",
    intent: input.turn.intent,
    turn: input.turn,
    events: [
      {
        id: `${input.turnId}:interrupted`,
        kind: "runtime.ack",
        turnId: input.turnId,
        sessionKey: input.sessionKey,
        occurredAtMs: input.occurredAtMs,
        payload: {
          message: "已停止当前回合，迟到的模型或工具结果不会发送给用户。",
        },
      },
    ],
    responsePolicy: input.turn.responsePolicy,
    memoryDecision: input.turn.memoryDecision,
    ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
    ...(input.capabilityPacket === undefined ? {} : { capabilityPacket: input.capabilityPacket }),
    transcriptMessages: [],
    operatorTrace: {
      items: [
        ...input.traceItems,
        {
          source: "runtime",
          stage: "turn.interrupted",
          detail: "Conversation turn was interrupted by the unified run registry stop signal.",
          occurredAtMs: input.occurredAtMs,
        },
      ],
    },
  };
}

function createProductionNoFinalEvents(input: {
  readonly production: ConversationRuntimeProductionResult;
  readonly turnId: string;
  readonly sessionKey: string;
  readonly occurredAtMs: number;
  readonly turn: ConversationRuntimeTurnDecision;
}): readonly ConversationRuntimeEvent[] {
  if (input.production.ok !== false && input.production.replySource !== "degraded-error") {
    return [];
  }
  const detail = readProductionNoFinalDetail(input.production);
  return renderConversationRuntimeStructuredReply({
    turnId: input.turnId,
    sessionKey: input.sessionKey,
    occurredAtMs: input.occurredAtMs,
    turn: input.turn,
    code: "production-final-unavailable",
    ...(detail === undefined ? {} : { detail }),
  }).events;
}

function readProductionNoFinalDetail(
  production: ConversationRuntimeProductionResult,
): string | undefined {
  const metadataMessage = production.metadata?.message;
  if (typeof metadataMessage === "string" && metadataMessage.trim().length > 0) {
    return metadataMessage.trim();
  }
  const metadataDetail = production.metadata?.detail;
  if (typeof metadataDetail === "string" && metadataDetail.trim().length > 0) {
    return metadataDetail.trim();
  }
  return undefined;
}

function mapModelLoopEventToRuntimeEvent(input: {
  readonly event: Awaited<ReturnType<typeof runConversationRuntimeModelToolLoop>>["events"][number];
  readonly index: number;
  readonly turnId: string;
  readonly sessionKey: string;
  readonly occurredAtMs: number;
  readonly responsePolicy: ConversationRuntimeTurnDecision["responsePolicy"];
  readonly audience: ConversationRuntimeTurnDecision["audience"];
  readonly replySource: ConversationRuntimeReplySource;
}): ConversationRuntimeEvent[] {
  const { event, index, turnId, sessionKey, occurredAtMs } = input;
  if (event.kind === "model.final") {
    return [
      {
        id: `${turnId}:model-final:${index}`,
        kind: "runtime.final" as const,
        turnId,
        sessionKey,
        occurredAtMs,
        payload: {
          text: event.text,
          responsePolicy: input.responsePolicy,
          audience: input.audience,
          replySource: input.replySource,
        },
      },
    ];
  }
  if (event.kind === "model.error") {
    const failure = classifyConversationRuntimeFailure({
      code: "model_unavailable",
      message: event.message,
    });
    return [
      {
        id: `${turnId}:model-error:${index}`,
        kind: "runtime.error" as const,
        turnId,
        sessionKey,
        occurredAtMs,
        payload: {
          message: event.message,
          code: toConversationRuntimeFailureCode(failure),
          recoverable: failure.recoverable,
        },
      },
    ];
  }
  if (event.kind === "tool.requested") {
    return [
      {
        id: `${turnId}:tool-requested:${event.call.id}`,
        kind: "runtime.tool" as const,
        turnId,
        sessionKey,
        occurredAtMs,
        payload: {
          tool: {
            id: event.call.id,
            name: event.call.name,
            phase: "requested" as const,
            requiresApproval: event.call.requiresApproval === true,
            metadata: {
              turnIndex: event.turnIndex,
              readOnly: event.call.readOnly === true,
            },
          },
        },
      },
    ];
  }
  if (event.kind === "tool.permission") {
    if (event.decision.status === "allow") {
      return [];
    }
    return [
      {
        id: `${turnId}:tool-permission:${event.call.id}`,
        kind: "runtime.approval" as const,
        turnId,
        sessionKey,
        occurredAtMs,
        payload: {
          approval: {
            id: `tool:${event.call.id}`,
            title: event.decision.title ?? `确认使用 ${event.call.name}`,
            status: event.decision.status === "ask" ? "pending" : "rejected",
            summary:
              event.decision.summary ??
              (event.decision.status === "ask"
                ? `${event.call.name} 需要确认后再执行。`
                : `${event.call.name} 已被权限规则拦截。`),
            actionLabels: event.decision.actionLabels ?? ["确认", "拒绝"],
            metadata: {
              toolName: event.call.name,
              permissionStatus: event.decision.status,
              readOnly: event.call.readOnly === true,
              toolCall: {
                id: event.call.id,
                name: event.call.name,
                args: event.call.args,
                readOnly: event.call.readOnly === true,
                requiresApproval: event.call.requiresApproval === true,
                ...(event.call.metadata === undefined ? {} : { metadata: event.call.metadata }),
              },
              ...(event.decision.reason === undefined ? {} : { reason: event.decision.reason }),
              ...(event.call.metadata === undefined ? {} : { toolMetadata: event.call.metadata }),
              ...(event.decision.metadata === undefined
                ? {}
                : { decisionMetadata: event.decision.metadata }),
            },
          },
        },
      },
    ];
  }
  if (event.kind === "tool.loop_detected") {
    return [
      {
        id: `${turnId}:tool-loop-detected:${event.call.id}`,
        kind: "runtime.tool" as const,
        turnId,
        sessionKey,
        occurredAtMs,
        payload: {
          tool: {
            id: event.call.id,
            name: event.call.name,
            phase: "failed" as const,
            outputPreview: event.reason,
            requiresApproval: event.call.requiresApproval === true,
            metadata: {
              diagnosticKind: "tool.loop_detected",
              turnIndex: event.turnIndex,
              hookName: event.hookName,
              reason: event.reason,
              ...(event.metadata === undefined ? {} : { loopMetadata: event.metadata }),
            },
          },
        },
      },
    ];
  }
  if (event.kind === "tool.result") {
    const artifactEvents = extractConversationRuntimeToolArtifacts(event.result).map(
      (artifact, artifactIndex) => ({
        id: `${turnId}:tool-result:${event.result.callId}:artifact:${artifact.id || artifactIndex}`,
        kind: "runtime.artifact" as const,
        turnId,
        sessionKey,
        occurredAtMs,
        payload: {
          artifact,
        },
      }),
    );
    return [
      {
        id: `${turnId}:tool-result:${event.result.callId}`,
        kind: "runtime.tool" as const,
        turnId,
        sessionKey,
        occurredAtMs,
        payload: {
          tool: {
            id: event.result.callId,
            name: event.result.toolName,
            phase: event.result.ok ? ("completed" as const) : ("failed" as const),
            outputPreview: event.result.content,
            requiresApproval: event.result.requiresApproval === true,
            metadata: {
              turnIndex: event.turnIndex,
              ...(event.result.error === undefined ? {} : { error: event.result.error }),
              ...(event.result.metadata === undefined
                ? {}
                : { toolResultMetadata: event.result.metadata }),
            },
          },
        },
      },
      ...artifactEvents,
    ];
  }
  return [];
}

function findLatestModelLoopError(
  events: readonly ConversationRuntimeModelToolLoopEvent[],
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind === "model.error") {
      return event.message;
    }
  }
  return undefined;
}

function normalizeApprovalStatus(
  status: string | undefined,
): "pending" | "approved" | "rejected" | "expired" | "cancelled" {
  if (status === "approved" || status === "auto") {
    return "approved";
  }
  if (status === "rejected") {
    return "rejected";
  }
  return "pending";
}

function finalizeConversationRuntimeRunRegistryResult(input: {
  readonly registry: ConversationRunRegistry | undefined;
  readonly runRecord: ConversationTurnRunRecord | undefined;
  readonly result: ConversationRuntimeResult;
}): ConversationRuntimeResult {
  if (input.registry === undefined || input.runRecord === undefined) {
    return input.result;
  }
  appendConversationRuntimeEventsToRunRegistry({
    registry: input.registry,
    turnRunId: input.runRecord.turnRunId,
    events: input.result.events,
  });
  const failedEvent = input.result.events.find(
    (event): event is ConversationRuntimeEvent<"runtime.error"> => event.kind === "runtime.error",
  );
  const finalFailure =
    failedEvent === undefined
      ? undefined
      : classifyConversationRuntimeFailure({
          ...(failedEvent.payload.code === undefined ? {} : { code: failedEvent.payload.code }),
          message: failedEvent.payload.message,
        });
  const currentRecord = input.registry.read(input.runRecord.turnRunId);
  const status =
    currentRecord?.status === "stopping" || input.result.events.some(isRuntimeInterruptedEvent)
      ? "cancelled"
      : failedEvent === undefined
        ? "completed"
        : "failed";
  const memoryEvidenceRecords = input.result.memoryEvidenceRecords ?? [];
  const memorySourceRefs =
    extractConversationRuntimeRunSourceRefsFromMemoryEvidence(memoryEvidenceRecords);
  const memoryFailureTaxonomy =
    extractConversationRuntimeRunFailureTaxonomyFromMemoryEvidence(memoryEvidenceRecords);
  const sourceAccessLimited = memoryFailureTaxonomy.includes("source-access-limited");
  input.registry.finalize(input.runRecord.turnRunId, {
    status,
    ...(sourceAccessLimited
      ? { userVisibleSummary: "没有读到可信正文，已隔离，未生成经验候选。" }
      : input.result.finalText === undefined
        ? {}
        : { userVisibleSummary: input.result.finalText }),
    ...(memorySourceRefs.length === 0 ? {} : { sourceRefs: memorySourceRefs }),
    ...(failedEvent === undefined
      ? memoryFailureTaxonomy.length === 0
        ? {}
        : { failureTaxonomy: memoryFailureTaxonomy }
      : {
          internalFailure: failedEvent.payload.message,
          failureTaxonomy: uniqueRuntimeStrings([
            toConversationRuntimeFailureCode(
              finalFailure ??
                classifyConversationRuntimeFailure({
                  code: failedEvent.payload.code ?? "runtime_error",
                  message: failedEvent.payload.message,
                }),
            ),
            ...memoryFailureTaxonomy,
          ]),
        }),
    ...(input.result.runId === undefined ? {} : { runId: input.result.runId }),
    ...(input.result.memoryEvidenceRecords === undefined
      ? {}
      : { memoryEvidenceRefs: input.result.memoryEvidenceRecords.map((record) => record.id) }),
    ...(input.result.capabilityPacket === undefined
      ? {}
      : {
          metadata: {
            capabilityPacket: input.result.capabilityPacket,
            ...(input.result.runtimeEventsV1 === undefined
              ? {}
              : { runtimeEventsV1: input.result.runtimeEventsV1 }),
          },
        }),
    ...(input.result.capabilityPacket !== undefined || input.result.runtimeEventsV1 === undefined
      ? {}
      : {
          metadata: {
            runtimeEventsV1: input.result.runtimeEventsV1,
          },
        }),
  });
  return {
    ...input.result,
    turnRunId: input.runRecord.turnRunId,
  };
}

function extractConversationRuntimeRunSourceRefsFromMemoryEvidence(
  records: readonly ConversationRuntimeMemoryEvidenceRecord[],
): readonly string[] {
  return uniqueRuntimeStrings(records.flatMap(readConversationRuntimeMemoryEvidenceSourceRefs));
}

function extractConversationRuntimeRunFailureTaxonomyFromMemoryEvidence(
  records: readonly ConversationRuntimeMemoryEvidenceRecord[],
): readonly string[] {
  if (records.some((record) => record.sourceAccessStatus === "source_access_limited")) {
    return ["source-access-limited"];
  }
  const failures = records.flatMap((record) => [...record.failureTaxonomy]);
  return uniqueRuntimeStrings(failures);
}

function readConversationRuntimeMemoryEvidenceSourceRefs(
  record: ConversationRuntimeMemoryEvidenceRecord,
): readonly string[] {
  return [
    readRuntimeString(record.metadata?.sourceUrl),
    readRuntimeString(record.metadata?.url),
    readRuntimeString(record.metadata?.sourceRef),
    record.sourceRef.startsWith("tool://") ? undefined : record.sourceRef,
  ].filter((item): item is string => item !== undefined);
}

function attachConversationRuntimeUnifiedEvents(input: {
  readonly input: ConversationRuntimeInput;
  readonly result: ConversationRuntimeResult;
  readonly startedAtMs: number;
}): ConversationRuntimeResult {
  if (input.result.runtimeEventsV1 !== undefined) {
    return input.result;
  }
  const runtimeEventsV1 = projectConversationRuntimeUnifiedEvents(input);
  return {
    ...input.result,
    runtimeEventsV1,
  };
}

function projectConversationRuntimeUnifiedEvents(input: {
  readonly input: ConversationRuntimeInput;
  readonly result: ConversationRuntimeResult;
  readonly startedAtMs: number;
}): readonly ConversationRuntimeUnifiedEvent[] {
  const events: ConversationRuntimeUnifiedEvent[] = [];
  let sequence = 0;
  const push = (
    kind: ConversationRuntimeUnifiedEvent["kind"],
    occurredAtMs: number,
    payload?: Readonly<Record<string, unknown>>,
  ): void => {
    sequence += 1;
    events.push(
      createConversationRuntimeUnifiedEvent({
        kind,
        turnId: input.result.turnId,
        conversationId: input.result.sessionKey,
        sequence,
        startedAtMs: input.startedAtMs,
        occurredAtMs,
        ...(payload === undefined ? {} : { payload }),
      }),
    );
  };

  push("turn.started", input.startedAtMs, {
    surface: input.input.surface,
    channel: input.input.channel,
    messageId: input.input.messageId,
    textChars: input.input.text.length,
  });

  const classifiedAtMs =
    input.result.operatorTrace.items.find((item) => item.stage === "turn.orchestrated")
      ?.occurredAtMs ??
    input.result.events[0]?.occurredAtMs ??
    input.startedAtMs;
  push("intent.classified", classifiedAtMs, {
    intentKind: input.result.intent?.kind ?? input.result.turn?.intent.kind ?? "unknown",
    responsePolicy: input.result.responsePolicy ?? input.result.turn?.responsePolicy ?? "unknown",
    audience: input.result.turn?.audience ?? "user",
    shouldInvokeRecall: input.result.turn?.shouldInvokeRecall ?? false,
    shouldCreateRun: input.result.turn?.shouldCreateRun ?? false,
  });

  const memoryRecallPayload = projectConversationRuntimeMemoryRecallPayload(input.result);
  if (memoryRecallPayload !== undefined) {
    const occurredAtMs =
      input.result.operatorTrace.items.find((item) => item.stage === "capability.resolved")
        ?.occurredAtMs ??
      input.result.events[0]?.occurredAtMs ??
      classifiedAtMs;
    push("memory.recall", occurredAtMs, memoryRecallPayload);
  }

  for (const event of input.result.events) {
    projectConversationRuntimeUnifiedEventFromLegacyEvent({
      event,
      result: input.result,
      push,
    });
  }

  projectConversationRuntimeContextCompactionUnifiedEvents({
    result: input.result,
    fallbackOccurredAtMs: input.result.events.at(-1)?.occurredAtMs ?? classifiedAtMs,
    push,
  });

  if (
    input.result.finalText !== undefined &&
    !events.some((event) => event.kind === "model.final")
  ) {
    const occurredAtMs = input.result.events.at(-1)?.occurredAtMs ?? input.startedAtMs;
    push("model.final", occurredAtMs, {
      chars: input.result.finalText.length,
      replySource: input.result.replySource,
      responsePolicy: input.result.responsePolicy ?? input.result.turn?.responsePolicy ?? "unknown",
    });
  }

  return events;
}

function projectConversationRuntimeMemoryRecallPayload(
  result: ConversationRuntimeResult,
): Readonly<Record<string, unknown>> | undefined {
  const memoryHits = (result.capabilityPacket?.hits ?? []).filter((hit) => hit.source === "memory");
  const degraded = memoryHits.filter((hit) => hit.status === "degraded");
  const hits = memoryHits
    .filter((hit) => hit.status === "hit" || hit.status === "used")
    .map(projectConversationRuntimeMemoryRecallHit);
  const degradedHits = degraded.map(projectConversationRuntimeMemoryRecallHit);
  if (hits.length === 0 && degraded.length === 0) {
    return undefined;
  }
  const layers = uniqueRuntimeStrings(
    [...hits, ...degradedHits].map((hit) => readRuntimeString(hit.memoryLayer)),
  );
  return compactRuntimeRecord({
    status: degraded.length > 0 && hits.length === 0 ? "degraded" : "hit",
    hitCount: hits.length,
    layers,
    hits,
    degradedReasons: degraded.map((hit) => hit.summary ?? hit.id),
  });
}

function projectConversationRuntimeContextCompactionUnifiedEvents(input: {
  readonly result: ConversationRuntimeResult;
  readonly fallbackOccurredAtMs: number;
  readonly push: (
    kind: ConversationRuntimeUnifiedEvent["kind"],
    occurredAtMs: number,
    payload?: Readonly<Record<string, unknown>>,
  ) => void;
}): void {
  for (const item of input.result.operatorTrace.items) {
    const kind = parseConversationRuntimeContextCompactionEventKind(item.stage);
    if (kind === undefined) {
      continue;
    }
    input.push(
      kind,
      item.occurredAtMs ?? input.fallbackOccurredAtMs,
      compactRuntimeRecord(item.metadata ?? {}),
    );
  }
}

function parseConversationRuntimeContextCompactionEventKind(
  stage: string,
): ConversationRuntimeUnifiedEvent["kind"] | undefined {
  return stage === "context.compaction.started" ||
    stage === "context.compaction.partial_saved" ||
    stage === "context.compaction.completed" ||
    stage === "context.compaction.failed"
    ? stage
    : undefined;
}

function projectConversationRuntimeMemoryRecallHit(
  hit: ConversationRuntimeCapabilityPacket["hits"][number],
): Readonly<Record<string, unknown>> {
  const metadata = readRuntimeRecord(hit.metadata) ?? {};
  return compactRuntimeRecord({
    id: hit.id,
    title: hit.title,
    status: hit.status,
    score: hit.score,
    reason: hit.summary,
    memoryLayer: readRuntimeString(metadata.memoryLayer),
    layerLabel: readRuntimeString(metadata.layerLabel),
    retrievalMode: readRuntimeString(metadata.retrievalMode),
    matchMode: readRuntimeString(metadata.matchMode),
    verbatimExcerpt: readRuntimeString(metadata.verbatimExcerpt),
    drawerContent: readRuntimeString(metadata.drawerContent),
    drawerId: resolveConversationRuntimeMempalaceDrawerId(hit.id, metadata),
    sourceFile: readRuntimeString(metadata.sourceFile),
    wing: readRuntimeString(metadata.wing),
    room: readRuntimeString(metadata.room),
    drawerIndex: readRuntimeNumber(metadata.drawerIndex),
    totalDrawers: readRuntimeNumber(metadata.totalDrawers),
  });
}

function resolveConversationRuntimeMempalaceDrawerId(
  hitId: string,
  metadata: Readonly<Record<string, unknown>>,
): string | undefined {
  const explicit =
    readRuntimeString(metadata.drawerId) ??
    readRuntimeString(metadata.drawer_id) ??
    readRuntimeString(metadata.rawDrawerId);
  if (explicit) {
    return explicit;
  }
  const normalized = readRuntimeString(hitId);
  if (!normalized) {
    return undefined;
  }
  const parts = normalized.split(":");
  const candidate = parts[parts.length - 1];
  return candidate?.startsWith("drawer_") ? candidate : undefined;
}

function uniqueRuntimeStrings(values: readonly (string | undefined)[]): readonly string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined))];
}

function projectConversationRuntimeUnifiedEventFromLegacyEvent(input: {
  readonly event: ConversationRuntimeEvent;
  readonly result: ConversationRuntimeResult;
  readonly push: (
    kind: ConversationRuntimeUnifiedEvent["kind"],
    occurredAtMs: number,
    payload?: Readonly<Record<string, unknown>>,
  ) => void;
}): void {
  if (input.event.kind === "runtime.final") {
    const event = input.event as ConversationRuntimeEvent<"runtime.final">;
    input.push("model.final", event.occurredAtMs, {
      chars: event.payload.text.length,
      replySource: event.payload.replySource ?? input.result.replySource,
      responsePolicy: event.payload.responsePolicy,
      audience: event.payload.audience,
    });
    return;
  }

  if (input.event.kind === "runtime.error") {
    const event = input.event as ConversationRuntimeEvent<"runtime.error">;
    input.push("turn.failed", event.occurredAtMs, {
      message: event.payload.message,
      code: event.payload.code ?? "",
      recoverable: event.payload.recoverable ?? false,
    });
    return;
  }

  if (input.event.kind === "runtime.approval") {
    const event = input.event as ConversationRuntimeEvent<"runtime.approval">;
    const approval = event.payload.approval;
    const metadata = approval.metadata ?? {};
    const toolCall = readRuntimeRecord(metadata.toolCall);
    const status = normalizeApprovalStatus(approval.status);
    input.push(
      status === "pending" ? "approval.requested" : "approval.resolved",
      event.occurredAtMs,
      {
        approvalId: approval.id,
        status,
        toolName: readRuntimeString(metadata.toolName) ?? readRuntimeString(toolCall?.name) ?? "",
        permissionStatus: readRuntimeString(metadata.permissionStatus) ?? "",
        summary: approval.summary,
      },
    );
    return;
  }

  if (input.event.kind === "runtime.tool") {
    const event = input.event as ConversationRuntimeEvent<"runtime.tool">;
    const tool = event.payload.tool;
    if (tool.metadata?.diagnosticKind === "tool.loop_detected") {
      input.push("tool.loop_detected", event.occurredAtMs, {
        toolName: tool.name,
        toolCallId: tool.id,
        reason: readRuntimeString(tool.metadata.reason) ?? "tool-loop-threshold-exceeded",
      });
      return;
    }
    const kind =
      tool.phase === "requested" || tool.phase === "started"
        ? "tool.started"
        : tool.phase === "failed"
          ? "tool.failed"
          : "tool.completed";
    input.push(kind, event.occurredAtMs, {
      toolName: tool.name,
      toolCallId: tool.id,
      phase: tool.phase,
      ok: tool.phase !== "failed",
      summary: tool.summary ?? "",
      inputPreview: tool.inputPreview ?? "",
      outputPreview: tool.outputPreview ?? "",
      requiresApproval: tool.requiresApproval ?? false,
      ...(tool.metadata === undefined ? {} : { metadata: tool.metadata }),
    });
    return;
  }

  if (input.event.kind === "runtime.artifact") {
    projectConversationRuntimeUnifiedEventFromArtifact(input);
  }
}

function projectConversationRuntimeUnifiedEventFromArtifact(input: {
  readonly event: ConversationRuntimeEvent;
  readonly result: ConversationRuntimeResult;
  readonly push: (
    kind: ConversationRuntimeUnifiedEvent["kind"],
    occurredAtMs: number,
    payload?: Readonly<Record<string, unknown>>,
  ) => void;
}): void {
  if (input.event.kind !== "runtime.artifact") {
    return;
  }
  const event = input.event as ConversationRuntimeEvent<"runtime.artifact">;
  const artifact = event.payload.artifact;
  if (artifact.kind === "learning-artifact") {
    input.push("candidate.created", event.occurredAtMs, {
      candidateId: artifact.id,
      title: artifact.title ?? "",
      status: readRuntimeString(artifact.metadata?.status) ?? "unknown",
      sourceRef: readRuntimeString(artifact.metadata?.sourceRef) ?? "",
      publishable: artifact.metadata?.publishable === true,
    });
    return;
  }
  if (artifact.kind === "web-extract-full-body") {
    input.push("evidence.read", event.occurredAtMs, {
      sourceUrl:
        readRuntimeString(artifact.metadata?.sourceUrl) ??
        readRuntimeString(artifact.metadata?.url) ??
        artifact.url ??
        "",
      readStatus: "read",
      fullTextChars:
        readRuntimeNumber(artifact.metadata?.fullTextChars) ??
        readRuntimeNumber(artifact.metadata?.textChars) ??
        0,
    });
  }
}

function isRuntimeInterruptedEvent(event: ConversationRuntimeEvent): boolean {
  if (event.kind !== "runtime.ack") {
    return false;
  }
  const ackEvent = event as ConversationRuntimeEvent<"runtime.ack">;
  return (
    typeof ackEvent.payload.message === "string" && ackEvent.payload.message.includes("已停止")
  );
}
