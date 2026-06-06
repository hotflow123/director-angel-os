import {
  appendRecentChannelContext,
  extractLearningAdmissionText,
  hasLearningAdmissionSource as hasChannelLearningAdmissionSource,
  isChannelNextStepQuestion,
  isChannelRejectIntent,
  isChannelReviewActionIntent,
  isChannelRunApprovalIntent,
  looksLikeChannelContextOnlyMessage,
  looksLikeProductionSupplement,
  orchestrateConversationTurn,
  parseChannelConfirmation,
  parseChannelExperienceManagementIntent,
  parseChannelKnowledgeManagementIntent,
  parseChannelNaturalHeartbeatManagementIntent,
  parseChannelNaturalImageGenerationIntent,
  parseChannelNaturalMemoryManagementIntent,
  parseChannelNaturalRunManagementIntent,
  parseChannelNaturalWorkspaceManagementIntent,
  parseChannelSlashCommand,
  parseNaturalDirectorProductionObjective,
  resolveChannelRunCommandIdFromVerb,
  selectRecentChannelContextLines,
  shouldAdmitNaturalLearningPrompt as shouldAdmitChannelNaturalLearningPrompt,
} from "@hotflow/channels-core";
import {
  createConversationRunRegistry,
  isLearningCollectionAdviceQuestion,
  isReadOnlyLearningEvidenceFollowup,
  renderConversationRuntimeStructuredStatusText,
  runConversationRuntimeChannelTurn,
} from "@hotflow/conversation-runtime";
import { parseDirectorComfyUiWorkflowDraftIntent } from "@hotflow/director-runtime";

import {
  DESKTOP_ACTIONS,
  DESKTOP_EVENT_ROLES,
  assertDesktopAction,
  resolveComposerToolAction,
} from "./desktop-contract.js";

const DESKTOP_LEARNING_CONFIRMATION_TTL_MS = 30 * 60 * 1000;
const DESKTOP_STATUS_INTENTS = Object.freeze({
  MODEL: "model_status_inquiry",
  X_SESSION: "x_session_status_inquiry",
  LEARNING_SOURCE: "learning_source_inquiry",
});

export function createDirectorDesktopBridgeFacade({
  handlers,
  externalToolControlPlane,
  externalToolExecutionQueue,
  backgroundRuntime,
}) {
  const workbenchConversations = new Map();
  const conversationRunRegistry = createConversationRunRegistry();
  return {
    ...(externalToolControlPlane === undefined ? {} : { externalToolControlPlane }),
    ...(externalToolExecutionQueue === undefined ? {} : { externalToolExecutionQueue }),
    ...(backgroundRuntime === undefined ? {} : { backgroundRuntime }),
    async invoke(action) {
      assertDesktopAction(action);

      if (action.type === DESKTOP_ACTIONS.COMPOSER_SUBMIT) {
        return dispatchComposerSubmit(handlers, action, {
          workbenchConversations,
          conversationRunRegistry,
        });
      }

      if (action.type === DESKTOP_ACTIONS.COMPOSER_CANCEL) {
        return resolveActionHandler(handlers, DESKTOP_ACTIONS.COMPOSER_CANCEL)(action);
      }

      if (action.type === DESKTOP_ACTIONS.COMPOSER_RESET) {
        resetDesktopWorkbenchConversationContext(
          getDesktopWorkbenchConversationContext(
            workbenchConversations,
            readDesktopWorkbenchSessionKey(action),
          ),
        );
        return createDesktopWorkbenchResetResult(action);
      }

      if (action.type === DESKTOP_ACTIONS.COMPOSER_SESSION_DELETE) {
        const sessionKey = readDesktopWorkbenchSessionKey(action);
        const context = getDesktopWorkbenchConversationContext(workbenchConversations, sessionKey);
        const archiveResult = await archiveDesktopWorkbenchConversationContext(
          handlers,
          action,
          context,
        );
        deleteDesktopWorkbenchConversationContext(workbenchConversations, sessionKey);
        return createDesktopWorkbenchSessionDeleteResult(sessionKey, archiveResult);
      }

      if (action.type === DESKTOP_ACTIONS.COMMAND_RUN) {
        return dispatchCommandRun(handlers, action);
      }

      return resolveActionHandler(handlers, action.type)(action);
    },
  };
}

function dispatchCommandRun(handlers, action) {
  const runner = handlers.command?.run;
  if (!runner) {
    throw new Error("No desktop bridge handler wired for action: command.run");
  }
  return runner(action, (desktopAction) =>
    resolveActionHandler(handlers, desktopAction.type)(desktopAction),
  );
}

async function dispatchComposerSubmit(handlers, action, bridgeRuntime) {
  const { workbenchConversations, conversationRunRegistry } = bridgeRuntime;
  const workbenchConversation = getDesktopWorkbenchConversationContext(
    workbenchConversations,
    readDesktopWorkbenchSessionKey(action),
  );
  const sourceActionWithIdentity = attachDesktopWorkbenchTurnIdentity(
    action,
    workbenchConversation,
  );
  if (isNonWorkbenchComposerSubmit(sourceActionWithIdentity)) {
    return appendComposerEvent(await readSnapshot(handlers), {
      title: "Desktop surface state",
      body: renderConversationRuntimeStructuredStatusText({
        title: "Desktop surface state:",
        status: "blocked",
        reason: "composer execution is only available on the workbench surface",
        detail: `surface: ${sourceActionWithIdentity.surface}`,
        nextAction: "open the workbench surface before running composer actions",
      }),
    });
  }

  if (sourceActionWithIdentity.tool) {
    return dispatchLegacyComposerTool(handlers, sourceActionWithIdentity);
  }

  const sourceAction = sourceActionWithIdentity.pickSource
    ? await readPickedSource(handlers, sourceActionWithIdentity)
    : sourceActionWithIdentity;
  const prompt = normalizePrompt(sourceAction.prompt);
  const snapshotResult = await readSnapshot(handlers);
  if (action.pickSource && prompt.length === 0) {
    return appendComposerEvent(
      {
        ...snapshotResult,
        events: [...(sourceAction.pickerResult?.events ?? []), ...(snapshotResult.events ?? [])],
      },
      {
        title: "已取消选择",
        body: "没有选择文件或目录，Angel 没有执行学习动作。",
      },
    );
  }
  const history = loadDesktopWorkbenchRuntimeHistory(workbenchConversation);
  const intent = resolveComposerIntent({
    prompt,
    snapshot: snapshotResult.snapshot,
    workbenchConversation,
  });
  const sourceActionWithTurn = attachConversationTurnToSourceAction(sourceAction, intent, history);
  const result = await executeComposerIntent(
    handlers,
    intent,
    sourceActionWithTurn,
    snapshotResult,
    {
      prompt,
      workbenchConversation,
      conversationRunRegistry,
    },
  );
  const latestSnapshotResult = result?.snapshot ? undefined : await readSnapshot(handlers);
  const resultWithSnapshot = {
    ...result,
    snapshot: mergeComposerExecutionSnapshot({
      initialSnapshot: snapshotResult.snapshot,
      resultSnapshot: result?.snapshot,
      latestSnapshot: latestSnapshotResult?.snapshot,
    }),
  };
  const resultWithEvents = appendComposerEvent(resultWithSnapshot, intent);
  rememberDesktopWorkbenchRuntimeResult(workbenchConversation, prompt, resultWithEvents);

  return resultWithEvents;

  function attachDesktopWorkbenchTurnIdentity(action, context) {
    const existingTurnId =
      typeof action.turnId === "string" && action.turnId.trim().length > 0
        ? action.turnId.trim()
        : undefined;
    const turnOrdinal =
      typeof action.turnOrdinal === "number" && Number.isFinite(action.turnOrdinal)
        ? action.turnOrdinal
        : takeNextDesktopWorkbenchTurnOrdinal(context);
    const turnId = existingTurnId ?? `desktop-workbench-turn-${turnOrdinal}`;
    return {
      ...action,
      turnId,
      turnOrdinal,
      sessionKey: readDesktopWorkbenchSessionKey(action),
      activeEvidenceFrame: context.activeEvidenceFrame ?? null,
    };
  }
}

function getDesktopWorkbenchConversationContext(contexts, sessionKey) {
  if (!contexts.has(sessionKey)) {
    contexts.set(sessionKey, createDesktopWorkbenchConversationContext(sessionKey));
  }
  return contexts.get(sessionKey);
}

function deleteDesktopWorkbenchConversationContext(contexts, sessionKey) {
  contexts.delete(sessionKey);
}

async function archiveDesktopWorkbenchConversationContext(handlers, action, context) {
  const archiveSession = handlers.composer?.archiveSession;
  if (typeof archiveSession !== "function") {
    return undefined;
  }
  return archiveSession({
    type: DESKTOP_ACTIONS.COMPOSER_SESSION_DELETE,
    sessionKey: context.sessionKey,
    archiveReason: "desktop-session-delete",
    transcriptArchive: createDesktopWorkbenchTranscriptArchive(context),
    sourceAction: action,
  });
}

function createDesktopWorkbenchTranscriptArchive(context) {
  return {
    schemaVersion: "director.desktop.session-transcript-archive.v1",
    sessionKey: context.sessionKey,
    archivedAt: new Date().toISOString(),
    runtimeHistory: Array.isArray(context.runtimeHistory) ? [...context.runtimeHistory] : [],
    turns: Array.isArray(context.turns) ? [...context.turns] : [],
    evidenceDisclosures: Array.isArray(context.evidenceDisclosures)
      ? [...context.evidenceDisclosures]
      : [],
    activeEvidenceFrame: context.activeEvidenceFrame ?? null,
  };
}

function readDesktopWorkbenchSessionKey(action) {
  const text = typeof action?.sessionKey === "string" ? action.sessionKey.trim() : "";
  return /^desktop:workbench(?::[A-Za-z0-9_-]+)?$/u.test(text) ? text : "desktop:workbench";
}

function takeNextDesktopWorkbenchTurnOrdinal(context) {
  const current =
    typeof context?.nextTurnOrdinal === "number" && Number.isFinite(context.nextTurnOrdinal)
      ? context.nextTurnOrdinal
      : 1;
  context.nextTurnOrdinal = current + 1;
  return current;
}

function mergeComposerExecutionSnapshot({ initialSnapshot, resultSnapshot, latestSnapshot }) {
  const snapshot = latestSnapshot ?? resultSnapshot ?? initialSnapshot;
  if (!snapshot || !resultSnapshot || !Object.hasOwn(resultSnapshot, "activePanel")) {
    return snapshot;
  }
  return {
    ...snapshot,
    activePanel: resultSnapshot.activePanel,
  };
}

function dispatchLegacyComposerTool(handlers, action) {
  const actionType = resolveComposerToolAction(action.tool);
  const normalizedAction = createActionFromComposer(actionType, action);
  return resolveActionHandler(handlers, actionType)(normalizedAction);
}

function isNonWorkbenchComposerSubmit(action) {
  return (
    typeof action.surface === "string" &&
    action.surface.length > 0 &&
    action.surface !== "workbench"
  );
}

async function readPickedSource(handlers, action) {
  const picker = resolveActionHandler(handlers, DESKTOP_ACTIONS.DESKTOP_PICK_DIRECTORY);
  const picked = await picker({
    type: DESKTOP_ACTIONS.DESKTOP_PICK_DIRECTORY,
    sourceAction: action,
  });
  return {
    ...action,
    prompt: picked.selectedDirectory ?? "",
    pickerResult: picked,
  };
}

async function readSnapshot(handlers) {
  const snapshotHandler = resolveActionHandler(handlers, DESKTOP_ACTIONS.SNAPSHOT);
  return snapshotHandler({ type: DESKTOP_ACTIONS.SNAPSHOT });
}

async function executeComposerIntent(
  handlers,
  intent,
  sourceAction,
  snapshotResult,
  runtimeContext = {},
) {
  if (intent.kind === "snapshot") {
    return attachSnapshotIntentConversationRuntime(snapshotResult, intent, sourceAction);
  }

  if (intent.kind === "desktopAction" && intent.action.type === DESKTOP_ACTIONS.PRODUCTION_START) {
    return executeDesktopProductionRuntimeIntent(handlers, intent, sourceAction, runtimeContext);
  }

  if (intent.kind === "desktopAction") {
    return resolveActionHandler(
      handlers,
      intent.action.type,
    )(prepareDesktopActionForExecution(intent.action, runtimeContext, sourceAction));
  }

  return dispatchCommandRun(handlers, {
    type: DESKTOP_ACTIONS.COMMAND_RUN,
    commandId: intent.commandId,
    args: intent.args ?? {},
    sourceAction,
  });
}

function prepareDesktopActionForExecution(action, runtimeContext = {}, sourceAction) {
  const desktopStatusIntent =
    action.desktopStatusIntent ?? sourceAction?.desktopStatusIntent;
  if (action.type !== DESKTOP_ACTIONS.API_PROVIDER_TEXT) {
    const activeEvidenceFrame =
      action.activeEvidenceFrame === undefined
        ? sourceAction?.activeEvidenceFrame
        : action.activeEvidenceFrame;
    return {
      ...action,
      ...(typeof sourceAction?.turnId === "string" && sourceAction.turnId.trim().length > 0
        ? { turnId: sourceAction.turnId.trim() }
        : {}),
      ...(activeEvidenceFrame === undefined ? {} : { activeEvidenceFrame }),
      ...(desktopStatusIntent === undefined ? {} : { desktopStatusIntent }),
      sourceAction,
    };
  }
  const shouldPreservePrompt =
    sourceAction?.turnIntent?.metadata?.directReadPreferred === true &&
    sourceAction.turnIntent?.metadata?.sourceKind === "url";
  const prompt = shouldPreservePrompt
    ? action.prompt
    : withRecentDesktopContext({
        context: runtimeContext.workbenchConversation,
        text: action.prompt,
      });
  return {
    ...action,
    prompt,
    ...(typeof sourceAction?.turnId === "string" && sourceAction.turnId.trim().length > 0
      ? { turnId: sourceAction.turnId.trim() }
      : {}),
    ...(typeof sourceAction?.sessionKey === "string" && sourceAction.sessionKey.trim().length > 0
      ? { sessionKey: sourceAction.sessionKey.trim() }
      : {}),
    ...(typeof sourceAction?.runId === "string" && sourceAction.runId.trim().length > 0
      ? { runId: sourceAction.runId.trim() }
      : {}),
    ...(Array.isArray(sourceAction?.attachments) && sourceAction.attachments.length > 0
      ? { attachments: sourceAction.attachments }
      : {}),
    ...(desktopStatusIntent === undefined ? {} : { desktopStatusIntent }),
    ...(action.activeEvidenceFrame === undefined && sourceAction?.activeEvidenceFrame === undefined
      ? {}
      : {
          activeEvidenceFrame:
            action.activeEvidenceFrame === undefined
              ? sourceAction.activeEvidenceFrame
              : action.activeEvidenceFrame,
        }),
    sourceAction,
  };
}

async function executeDesktopProductionRuntimeIntent(
  handlers,
  intent,
  sourceAction,
  runtimeContext = {},
) {
  const actionHandler = resolveActionHandler(handlers, DESKTOP_ACTIONS.PRODUCTION_START);
  let desktopProductionResult;
  const channelResult = await runConversationRuntimeChannelTurn(
    createDesktopRuntimeTransportEvent(intent, sourceAction),
    {
      adapter: createDesktopProductionChannelAdapter(intent, sourceAction),
      runtime: {
        turnIdFactory: () =>
          resolveDesktopSourceActionTurnId(sourceAction, createDesktopRuntimeTurnId(sourceAction)),
        runRegistry: runtimeContext.conversationRunRegistry,
        orchestrate: () => createRuntimeTurnDecisionFromDesktopIntent(intent),
        resolveCapabilityContext: () => createDesktopIntentCapabilityPacket(intent),
        startProduction: async (request) => {
          const sessionKey = readDesktopWorkbenchSessionKey(sourceAction);
          desktopProductionResult = await actionHandler({
            ...intent.action,
            sessionKey,
            sourceAction: {
              ...sourceAction,
              sessionKey,
              runtimeTurnId: request.turnId,
              runtimeCapabilityPacket: request.capabilityPacket,
            },
          });
          return mapDesktopProductionResultToRuntimeProductionResult(desktopProductionResult);
        },
      },
    },
  );
  const runtimeResult = attachChannelAdapterTraceToRuntimeResult(
    channelResult.runtimeResult,
    channelResult,
  );
  if (runtimeResult === undefined) {
    throw new Error("Desktop production channel adapter did not dispatch a runtime turn.");
  }
  return attachConversationRuntimeToResult(
    desktopProductionResult ?? runtimeResultToDesktopProductionResult(runtimeResult),
    runtimeResult,
  );
}

function attachChannelAdapterTraceToRuntimeResult(runtimeResult, channelResult) {
  if (runtimeResult === undefined) {
    return undefined;
  }
  const adapterTrace = channelResult.log.map((event) => ({
    source: "channel",
    stage: `channel.${event.stage}`,
    detail: `${channelResult.adapterId}:${event.event}`,
    ...(event.occurredAtMs === undefined ? {} : { occurredAtMs: event.occurredAtMs }),
    metadata: {
      admission: event.admission,
      reason: event.reason,
      channel: event.channel,
      messageId: event.messageId,
      sessionKey: event.sessionKey,
    },
  }));
  return {
    ...runtimeResult,
    operatorTrace: {
      ...runtimeResult.operatorTrace,
      items: [...adapterTrace, ...runtimeResult.operatorTrace.items],
    },
  };
}

function createDesktopRuntimeTransportEvent(intent, sourceAction) {
  return {
    intent,
    sourceAction,
    prompt: sourceAction.prompt ?? intent.action.prompt,
  };
}

function createDesktopProductionChannelAdapter(intent, sourceAction) {
  const sessionKey = readDesktopWorkbenchSessionKey(sourceAction);
  return {
    id: "director-desktop-workbench",
    channel: "desktop",
    ingest: (event) => ({
      surface: "desktop",
      channel: "desktop",
      message: {
        id: createDesktopRuntimeMessageId(event.sourceAction),
        rawBody: event.prompt,
        bodyForAgent: event.prompt,
      },
      sender: {
        id: "desktop-operator",
        roles: ["operator"],
      },
      conversation: {
        kind: "direct",
        label: "Director Angel Workbench",
      },
      route: {
        sessionKey,
        routeKind: "direct",
      },
      reply: {
        to: sessionKey,
      },
      access: {
        commandAuthorized: true,
      },
      metadata: {
        source: "director-desktop",
        actionType: DESKTOP_ACTIONS.PRODUCTION_START,
      },
    }),
    classifyTransportEvent: () => ({
      kind: "command",
      canStartAgentTurn: true,
      reason: "desktop production intent",
    }),
    buildRuntimeInput: () => ({
      surface: "desktop",
      channel: "desktop",
      messageId: createDesktopRuntimeMessageId(sourceAction),
      sessionKey,
      text: sourceAction.prompt ?? intent.action.prompt,
      sender: {
        id: "desktop-operator",
        role: "operator",
      },
      trustedContext: {
        ...(intent.action.activeRunId === undefined
          ? {}
          : { activeRunId: intent.action.activeRunId }),
        metadata: {
          productionObjective: intent.action.prompt,
          workflowType: intent.action.workflowType,
        },
      },
      metadata: {
        source: "director-desktop",
        actionType: DESKTOP_ACTIONS.PRODUCTION_START,
      },
    }),
  };
}

function createRuntimeTurnDecisionFromDesktopIntent(intent) {
  const turnIntent =
    intent.action?.type === DESKTOP_ACTIONS.PRODUCTION_START
      ? createDesktopRuntimeProductionIntent(intent)
      : intent.turnIntent;
  return {
    intent: turnIntent,
    responsePolicy: intent.responsePolicy ?? "result-first",
    audience: "user",
    userText: intent.body ?? "",
    trace: (intent.operatorTrace ?? []).map((trace) => ({
      source: "orchestrator",
      stage: trace.stage,
      detail: trace.detail,
      ...(trace.metadata === undefined ? {} : { metadata: trace.metadata }),
    })),
    memoryDecision: intent.memoryDecision ?? {
      action: "store-result-only",
      reason: "制作输入只保留会话上下文，最终结果可进入经验候选。",
    },
    shouldInvokeRecall: intent.shouldInvokeRecall !== false,
    shouldCreateRun: intent.shouldCreateRun !== false,
    shouldAttachToActiveSession: intent.shouldAttachToActiveSession === true,
  };
}

function createDesktopRuntimeProductionIntent(intent) {
  if (
    intent.turnIntent?.kind === "production-start" ||
    intent.turnIntent?.kind === "production-confirm" ||
    intent.turnIntent?.kind === "production-supplement"
  ) {
    return intent.turnIntent;
  }
  return {
    kind: "production-start",
    objective: intent.action.prompt,
    command: {
      name: "production.start",
      raw: "/制作",
      args: intent.action.prompt,
    },
  };
}

function createDesktopIntentCapabilityPacket(intent) {
  return {
    status: intent.shouldInvokeRecall === false ? "skipped" : "miss",
    visibleSummary: "桌面制作入口将由 DirectorService 读取已发布经验、Skill 和运行记忆。",
    hiddenPromptBlock: "",
    hits: [],
  };
}

function mapDesktopProductionResultToRuntimeProductionResult(result) {
  const productionRun = result.productionRun ?? {};
  const finalText =
    typeof productionRun.workbenchOutput === "string" &&
    productionRun.workbenchOutput.trim().length > 0
      ? productionRun.workbenchOutput
      : undefined;
  return {
    ok: productionRun.ok !== false,
    ...(finalText === undefined ? {} : { finalText }),
    replySource: resolveDesktopRuntimeProductionReplySource(productionRun, finalText),
    status: productionRun.runStatus ?? "created",
    ...(productionRun.runId === undefined || productionRun.runId === null
      ? {}
      : { runId: productionRun.runId }),
    ...(productionRun.blueprintId === undefined || productionRun.blueprintId === null
      ? {}
      : { blueprintId: productionRun.blueprintId }),
    ...(productionRun.reportId === undefined || productionRun.reportId === null
      ? {}
      : { reportId: productionRun.reportId }),
    recallStatus: productionRun.recallStatus ?? "miss",
    skillStatus: productionRun.skillStatus ?? "miss",
    memoryStatus: productionRun.memoryStatus ?? "miss",
    artifacts: [
      ...(productionRun.runId === undefined || productionRun.runId === null
        ? []
        : [
            {
              id: productionRun.runId,
              kind: "run",
              title: "Director Run",
              metadata: {
                status: productionRun.runStatus ?? "unknown",
              },
            },
          ]),
      ...(productionRun.blueprintId === undefined || productionRun.blueprintId === null
        ? []
        : [
            {
              id: productionRun.blueprintId,
              kind: "blueprint",
              title: "制作蓝图",
            },
          ]),
      ...(productionRun.draftArtifact === undefined || productionRun.draftArtifact === null
        ? []
        : [
            {
              id: productionRun.draftArtifact,
              kind: "script",
              title: "制作草案",
              path: productionRun.draftArtifact,
            },
          ]),
    ],
    approvals: createRuntimeApprovalsFromDesktopProductionRun(productionRun),
    metadata: {
      workflowType: productionRun.workflowType,
      skillIds: productionRun.skillIds ?? [],
      knowledgePackIds: productionRun.knowledgePackIds ?? [],
      ...(typeof productionRun.modelDraft?.message === "string"
        ? { message: productionRun.modelDraft.message }
        : {}),
      ...(productionRun.draftSource === undefined
        ? {}
        : { draftSource: productionRun.draftSource }),
    },
  };
}

function resolveDesktopRuntimeProductionReplySource(productionRun, finalText) {
  if (typeof productionRun.replySource === "string") {
    return finalText === undefined && productionRun.replySource === "tool-loop"
      ? "degraded-error"
      : productionRun.replySource;
  }
  if (finalText !== undefined) {
    return "tool-loop";
  }
  if (productionRun.modelDraft?.ok === false) {
    return "degraded-error";
  }
  return "structured-renderer";
}

function createRuntimeApprovalsFromDesktopProductionRun(productionRun) {
  const stageTimeline = Array.isArray(productionRun.stageTimeline)
    ? productionRun.stageTimeline
    : [];
  const approvalStage = stageTimeline.find((stage) => stage.stageId === "local-preview");
  const pendingCount = Number(productionRun.assignmentCounts?.pending ?? 0);
  if (pendingCount <= 0 && approvalStage === undefined) {
    return [];
  }
  return [
    {
      id: productionRun.runId
        ? `${productionRun.runId}:pending-review`
        : "production:pending-review",
      title: "制作审查",
      status: pendingCount > 0 ? "pending" : "auto",
      summary: approvalStage?.summary ?? `待审查环节 ${pendingCount} 个。`,
    },
  ];
}

function runtimeResultToDesktopProductionResult(runtimeResult) {
  const production = runtimeResult.events.find((event) => event.kind === "runtime.final");
  return {
    productionRun: {
      ok: true,
      runId: runtimeResult.runId ?? null,
      workbenchOutput: production?.payload.text ?? runtimeResult.finalText ?? "",
      runtimeEvents: runtimeResult.events,
      ...(Array.isArray(runtimeResult.runtimeEventsV1)
        ? { runtimeEventsV1: runtimeResult.runtimeEventsV1 }
        : {}),
    },
    events: [],
  };
}

function attachConversationRuntimeToResult(result, runtimeResult) {
  const runtimeEventsV1 = Array.isArray(runtimeResult.runtimeEventsV1)
    ? runtimeResult.runtimeEventsV1
    : undefined;
  const productionRun =
    result.productionRun === undefined
      ? undefined
      : {
          ...result.productionRun,
          runtimeEvents: runtimeResult.events,
          ...(runtimeEventsV1 === undefined ? {} : { runtimeEventsV1 }),
        };
  return {
    ...result,
    ...(productionRun === undefined ? {} : { productionRun }),
    conversationRuntime: {
      turnId: runtimeResult.turnId,
      turnRunId: runtimeResult.turnRunId,
      intent: runtimeResult.intent,
      finalText: runtimeResult.finalText,
      replySource: runtimeResult.replySource,
      transcriptMessages: runtimeResult.transcriptMessages ?? [],
      runId: runtimeResult.runId,
      artifactIds: runtimeResult.artifactIds ?? [],
      approvalIds: runtimeResult.approvalIds ?? [],
      ...(runtimeEventsV1 === undefined ? {} : { runtimeEventsV1 }),
    },
    runtimeEvents: runtimeResult.events,
    ...(runtimeEventsV1 === undefined ? {} : { runtimeEventsV1 }),
    operatorTrace: runtimeResult.operatorTrace.items,
    runtimeOperatorTrace: runtimeResult.operatorTrace,
    turnIntent: runtimeResult.intent,
    memoryDecision: runtimeResult.memoryDecision,
    responsePolicy: runtimeResult.responsePolicy,
  };
}

function attachSnapshotIntentConversationRuntime(snapshotResult, intent, sourceAction) {
  const finalText = String(intent.body ?? "").trim();
  if (finalText.length === 0) {
    return snapshotResult;
  }
  const turnId = resolveDesktopSourceActionTurnId(
    sourceAction,
    createDesktopRuntimeTurnId(sourceAction),
  );
  const userText = normalizePrompt(sourceAction?.prompt ?? "");
  return {
    ...snapshotResult,
    conversationRuntime: {
      turnId,
      turnRunId: `${turnId}:snapshot`,
      intent: intent.turnIntent ?? {
        kind: "local-snapshot",
        metadata: { title: intent.title ?? "snapshot" },
      },
      finalText,
      replySource: "structured-renderer",
      transcriptMessages: [
        ...(userText.length === 0 ? [] : [{ role: "user", content: userText }]),
        { role: "assistant", content: finalText },
      ],
      artifactIds: [],
      approvalIds: [],
      ...(intent.evidenceDisclosure === undefined
        ? {}
        : { evidenceDisclosure: intent.evidenceDisclosure }),
    },
    runtimeEvents: [],
    operatorTrace: intent.operatorTrace ?? [],
    turnIntent: intent.turnIntent,
    memoryDecision: intent.memoryDecision,
    responsePolicy: intent.responsePolicy,
  };
}

function createDesktopRuntimeMessageId(sourceAction) {
  return `desktop-${hashDesktopRuntimeText(sourceAction.prompt ?? "")}`;
}

function createDesktopRuntimeTurnId(sourceAction) {
  return `desktop-turn-${hashDesktopRuntimeText(sourceAction.prompt ?? "")}`;
}

function resolveDesktopSourceActionTurnId(sourceAction, fallback) {
  return typeof sourceAction?.turnId === "string" && sourceAction.turnId.trim().length > 0
    ? sourceAction.turnId.trim()
    : fallback;
}

function hashDesktopRuntimeText(value) {
  let hash = 0;
  for (const char of String(value)) {
    hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  }
  return `${String(value).length}-${hash.toString(16)}`;
}

function appendComposerEvent(result, intent) {
  const resultWithTurn = attachConversationTurnToResult(result, intent);
  const existingEvents = resultWithTurn.events ?? [];
  if (
    resultWithTurn.productionRun ||
    resultWithTurn.apiProviderRun ||
    resultWithTurn.apiProviderImage ||
    resultWithTurn.apiProviderVideo ||
    resultWithTurn.apiProviderModelSync ||
    resultWithTurn.comfyUiWorkflow ||
    resultWithTurn.comfyUiRun ||
    existingEvents.length > 0
  ) {
    return {
      ...resultWithTurn,
      events: existingEvents,
    };
  }
  return {
    ...resultWithTurn,
    events: [
      {
        role: DESKTOP_EVENT_ROLES.ANGEL,
        title: formatResultFirstIntentTitle(intent.title),
        body: formatResultFirstIntentBody(intent.body),
        actionType: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
        ...(intent.evidenceDisclosure === undefined
          ? {}
          : { evidenceDisclosure: intent.evidenceDisclosure }),
      },
    ],
  };
}

function attachConversationTurnToSourceAction(sourceAction, intent, runtimeHistory = []) {
  return {
    ...sourceAction,
    ...(intent.operatorTrace === undefined ? {} : { operatorTrace: intent.operatorTrace }),
    ...(intent.turnIntent === undefined ? {} : { turnIntent: intent.turnIntent }),
    ...(typeof intent.userText === "string" && intent.userText.trim().length > 0
      ? { userText: intent.userText.trim() }
      : {}),
    ...(intent.memoryDecision === undefined ? {} : { memoryDecision: intent.memoryDecision }),
    ...(intent.responsePolicy === undefined ? {} : { responsePolicy: intent.responsePolicy }),
    ...(intent.shouldInvokeRecall === undefined
      ? {}
      : { shouldInvokeRecall: intent.shouldInvokeRecall }),
    ...(intent.shouldCreateRun === undefined ? {} : { shouldCreateRun: intent.shouldCreateRun }),
    ...(intent.shouldAttachToActiveSession === undefined
      ? {}
      : { shouldAttachToActiveSession: intent.shouldAttachToActiveSession }),
    ...(intent.desktopStatusIntent === undefined
      ? {}
      : { desktopStatusIntent: intent.desktopStatusIntent }),
    ...(runtimeHistory.length === 0 ? {} : { runtimeHistory }),
  };
}

function attachConversationTurnToResult(result, intent) {
  const runtimeEventsV1 = resolveDesktopUnifiedRuntimeEvents(result);
  return {
    ...result,
    ...(runtimeEventsV1 === undefined ? {} : { runtimeEventsV1 }),
    ...(result.conversationRuntime === undefined
      ? {}
      : {
          conversationRuntime: {
            ...result.conversationRuntime,
            ...(runtimeEventsV1 === undefined ? {} : { runtimeEventsV1 }),
          },
        }),
    operatorTrace: result.operatorTrace ?? intent.operatorTrace,
    turnIntent: result.turnIntent ?? intent.turnIntent,
    memoryDecision: result.memoryDecision ?? intent.memoryDecision,
    responsePolicy: result.responsePolicy ?? intent.responsePolicy,
  };
}

function resolveDesktopUnifiedRuntimeEvents(result) {
  if (Array.isArray(result?.runtimeEventsV1)) {
    return result.runtimeEventsV1;
  }
  if (Array.isArray(result?.conversationRuntime?.runtimeEventsV1)) {
    return result.conversationRuntime.runtimeEventsV1;
  }
  return undefined;
}

function formatResultFirstIntentTitle(title) {
  return String(title ?? "结果")
    .replace(/^理解为[:：]\s*/u, "")
    .replace(/^运行/u, "已运行")
    .trim();
}

function formatResultFirstIntentBody(body) {
  const text = String(body ?? "").trim();
  if (text.length === 0) {
    return "";
  }
  return text
    .replace(/^Angel\s*会/u, "")
    .replace(/进入审查后才能沉淀。/u, "已进入候选区，审核后可沉淀。")
    .replace(/等待人工审查后再应用。/u, "等待审核后可应用。")
    .trim();
}

function resolveComposerIntent({ prompt, snapshot, workbenchConversation }) {
  if (prompt.length === 0) {
    return (
      resolveNextReviewIntent(snapshot) ?? {
        kind: "snapshot",
        title: "刷新工作台",
        body: "没有新的输入，已刷新本地状态。",
      }
    );
  }

  const conversationTurn = createDesktopConversationTurn(prompt, snapshot);
  const effectiveConversationTurn = isFreshReadOnlyUrlLearningRequest(prompt)
    ? coerceExplicitReadOnlyUrlConversationTurn(conversationTurn, prompt)
    : conversationTurn;
  const withConversationTurn = (intent) =>
    attachConversationTurnToIntent(intent, effectiveConversationTurn);
  const slashIntent = resolveSlashComposerIntent(prompt, snapshot, workbenchConversation);
  if (slashIntent) {
    return withConversationTurn(slashIntent);
  }

  if (prompt.startsWith("/")) {
    return withConversationTurn(unknownSlashIntent(prompt));
  }

  const embeddedHttpUrl = extractFirstHttpUrl(prompt);
  const freshReadOnlyUrlLearningRequest = isFreshReadOnlyUrlLearningRequest(prompt);
  if (freshReadOnlyUrlLearningRequest) {
    return withConversationTurn(modelProviderTextIntent(prompt));
  }

  if (embeddedHttpUrl !== null && shouldCreateLearningCandidateFromNaturalSource(prompt)) {
    return withConversationTurn(learningSourceIntent(prompt));
  }

  const localEvidenceFollowupIntent = resolveReadOnlyLearningEvidenceFollowupIntent(
    prompt,
    workbenchConversation,
    snapshot,
  );
  if (localEvidenceFollowupIntent) {
    return withConversationTurn(localEvidenceFollowupIntent);
  }

  const statusIntent = classifyDesktopStatusInquiry(prompt);
  if (statusIntent !== null) {
    return withConversationTurn(desktopStatusInquiryIntent(prompt, statusIntent));
  }

  if (shouldForceConfiguredProviderModelTurn(prompt)) {
    return withConversationTurn(modelProviderTextIntent(prompt));
  }

  if (conversationTurn.intent.kind === "learning-confirmation") {
    return attachConversationTurnToIntent(
      modelProviderTextIntent(prompt, {
        activeEvidenceFrame:
          normalizeDesktopActiveEvidenceFrameForBridge(workbenchConversation?.activeEvidenceFrame) ??
          createDesktopActiveEvidenceFrameFromSnapshot(snapshot, workbenchConversation?.sessionKey),
      }),
      coerceLearningConfirmationRuntimeRouteTurn(effectiveConversationTurn),
    );
  }

  if (conversationTurn.intent.kind === "production-confirm") {
    const currentRunIntent = resolveCurrentRunActionIntent(snapshot);
    if (currentRunIntent && !shouldLearningEvidenceIntentPreemptRun(prompt, conversationTurn)) {
      return withConversationTurn(currentRunIntent);
    }
  }
  if (conversationTurn.intent.kind === "production-supplement") {
    const currentRunIntent = resolveCurrentRunActionIntent(snapshot, {
      requireApproval: isRunApprovalIntent(prompt),
    });
    if (currentRunIntent && !shouldLearningEvidenceIntentPreemptRun(prompt, conversationTurn)) {
      return withConversationTurn(currentRunIntent);
    }
  }

  const currentRunConfirmationPrompt =
    (parseChannelConfirmation(prompt) !== null || prompt.trim() === "继续") &&
    conversationTurn.intent.kind !== "production-confirm";
  if (currentRunConfirmationPrompt) {
    const learningResultFollowupIntent = resolveLearningResultFollowupIntent(
      prompt,
      workbenchConversation,
      snapshot,
    );
    if (
      learningResultFollowupIntent &&
      shouldLearningFollowupPreemptCurrentRun(prompt, {
        snapshot,
        workbenchConversation,
      })
    ) {
      return attachConversationTurnToIntent(
        learningResultFollowupIntent,
        coerceLearningResultFollowupConversationTurn(effectiveConversationTurn, prompt),
      );
    }
    const currentRunIntent = resolveCurrentRunActionIntent(snapshot);
    if (
      currentRunIntent &&
      !shouldLearningEvidenceIntentPreemptRun(prompt, conversationTurn, {
        allowBareContinue: false,
      })
    ) {
      return withConversationTurn(currentRunIntent);
    }
    return withConversationTurn(modelProviderTextIntent(prompt));
  }

  const learningResultFollowupIntent = resolveLearningResultFollowupIntent(
    prompt,
    workbenchConversation,
    snapshot,
  );
  if (learningResultFollowupIntent) {
    return attachConversationTurnToIntent(
      learningResultFollowupIntent,
      coerceLearningResultFollowupConversationTurn(effectiveConversationTurn, prompt),
    );
  }

  if (isReadOnlyLearningEvidenceFollowup(prompt)) {
    return withConversationTurn(
      modelProviderTextIntent(
        withRecentDesktopContext({
          context: workbenchConversation,
          text: prompt,
        }),
      ),
    );
  }

  if (isFileUrl(prompt) || looksLikeLocalPath(prompt)) {
    return withConversationTurn(learningSourceIntent(prompt));
  }

  if (isNextStepQuestion(prompt)) {
    return withConversationTurn(nextStepGuidanceIntent(snapshot));
  }

  if (conversationTurn.intent.kind === "capability-intro") {
    return withConversationTurn({
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt,
      },
      title: "查询真实能力",
      body: renderConversationRuntimeStructuredStatusText({
        title: "Desktop model turn:",
        status: "routed",
        reason: "capability answer must come from the configured model provider",
        nextAction: "wait for model output or a degraded provider error",
      }),
    });
  }

  if (conversationTurn.intent.kind === "production-confirm") {
    const currentRunIntent = resolveCurrentRunActionIntent(snapshot);
    if (currentRunIntent) {
      return withConversationTurn(currentRunIntent);
    }
    const nextReviewIntent = resolveNextReviewIntent(snapshot);
    if (nextReviewIntent) {
      return withConversationTurn(nextReviewIntent);
    }
    return withConversationTurn(
      modelProviderTextIntent(
        withRecentDesktopContext({
          context: workbenchConversation,
          text: prompt,
        }),
      ),
    );
  }
  if (conversationTurn.intent.kind === "production-supplement") {
    const currentRunIntent = resolveCurrentRunActionIntent(snapshot);
    if (currentRunIntent) {
      return withConversationTurn(currentRunIntent);
    }
  }

  if (isRunApprovalIntent(prompt)) {
    return withConversationTurn(
      resolveCurrentRunActionIntent(snapshot, { requireApproval: true }) ??
        missingReviewTargetIntent("当前没有待人工批准的制作任务。"),
    );
  }

  if (isRejectIntent(prompt)) {
    return withConversationTurn(
      resolveRejectIntent(snapshot) ?? missingReviewTargetIntent("当前没有可拒绝的候选。"),
    );
  }

  if (isReviewIntent(prompt)) {
    const nextReviewIntent = resolveNextReviewIntent(snapshot);
    if (nextReviewIntent) {
      return withConversationTurn(nextReviewIntent);
    }
    if (parseChannelConfirmation(prompt) !== null || prompt.trim() === "继续") {
      return withConversationTurn(
        modelProviderTextIntent(
          withRecentDesktopContext({
            context: workbenchConversation,
            text: prompt,
          }),
        ),
      );
    }
    return withConversationTurn(missingReviewTargetIntent("当前没有可继续的审查动作。"));
  }

  const granularIntent = resolveGranularComposerIntent(prompt, snapshot);
  if (granularIntent) {
    return withConversationTurn(granularIntent);
  }

  const weixinIntent = resolveNaturalWeixinGatewayIntent(prompt);
  if (weixinIntent) {
    return withConversationTurn(weixinIntent);
  }

  const workspaceManagementIntent = resolveNaturalWorkspaceManagementIntent(prompt);
  if (workspaceManagementIntent) {
    return withConversationTurn(workspaceManagementIntent);
  }

  if (
    hasLearningAdmissionSource(prompt) &&
    shouldCreateLearningCandidateFromNaturalSource(prompt)
  ) {
    return withConversationTurn(learningSourceIntent(prompt));
  }

  if (
    conversationTurn.intent.kind === "learning-admit" &&
    shouldAdmitNaturalLearningPrompt(prompt) &&
    shouldCreateLearningCandidateFromNaturalSource(prompt)
  ) {
    return withConversationTurn(learningSourceIntent(prompt));
  }

  const imageGeneration = parseChannelNaturalImageGenerationIntent(prompt);
  if (imageGeneration) {
    return withConversationTurn(imageGenerationIntent(imageGeneration.prompt));
  }

  const naturalProductionObjective =
    conversationTurn.intent.kind === "production-start"
      ? conversationTurn.intent.objective
      : parseNaturalDirectorProductionObjective(prompt);
  if (
    (conversationTurn.intent.kind === "production-start" || isProductionTaskPrompt(prompt)) &&
    !isInformationSeekingProductionQuestion(prompt) &&
    !isExplicitReadOnlyUrlQuestion(prompt)
  ) {
    return withConversationTurn(
      productionTaskIntent(
        withRecentDesktopContext({
          context: workbenchConversation,
          text: naturalProductionObjective ?? prompt,
        }),
      ),
    );
  }

  if (looksLikeChannelContextOnlyMessage(prompt)) {
    return withConversationTurn({
      kind: "snapshot",
      title: "Desktop context state",
      body: renderConversationRuntimeStructuredStatusText({
        title: "Desktop context state:",
        status: "recorded",
        reason: "context-only message stored for future model/tool turns",
        nextAction: "send a production, learning, recall, Skill, or ComfyUI request",
      }),
    });
  }

  return withConversationTurn({
    ...modelProviderTextIntent(prompt),
  });
}

function modelProviderTextIntent(prompt, options = {}) {
  const activeEvidenceFrame = normalizeDesktopActiveEvidenceFrameForBridge(
    options.activeEvidenceFrame,
  );
  return {
    kind: "desktopAction",
    action: {
      type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
      prompt,
      ...(activeEvidenceFrame === null ? {} : { activeEvidenceFrame }),
    },
    title: "调用模型供应方",
    body: renderConversationRuntimeStructuredStatusText({
      title: "Desktop model turn:",
      status: "routed",
      reason: "ordinary desktop text must be answered by the configured model provider",
      nextAction: "wait for model output or a degraded provider error",
    }),
  };
}

function desktopStatusInquiryIntent(prompt, statusIntent) {
  const intent = modelProviderTextIntent(prompt);
  return {
    ...intent,
    desktopStatusIntent: statusIntent,
    action: {
      ...intent.action,
      desktopStatusIntent: statusIntent,
    },
    title: "本地状态问答",
    body: renderConversationRuntimeStructuredStatusText({
      title: "Desktop local status:",
      status: "routed",
      reason: statusIntent,
      nextAction: "answer from local status without mixing unrelated state",
    }),
  };
}

function classifyDesktopStatusInquiry(prompt) {
  const text = normalizePrompt(prompt);
  if (text.length === 0 || extractFirstHttpUrl(text) !== null) {
    return null;
  }
  if (isDesktopModelStatusInquiry(text)) {
    return DESKTOP_STATUS_INTENTS.MODEL;
  }
  if (isDesktopXSessionStatusInquiry(text)) {
    return DESKTOP_STATUS_INTENTS.X_SESSION;
  }
  if (isDesktopLearningSourceStatusInquiry(text)) {
    return DESKTOP_STATUS_INTENTS.LEARNING_SOURCE;
  }
  return null;
}

function isDesktopModelStatusInquiry(text) {
  return /(?:模型|model|provider|供应方|api).{0,24}(?:还能?不能用|能用吗|可用吗|恢复了吗|好了没|是不是挂了|还不稳定|通道|服务)|(?:还能?不能用|能用吗|可用吗|恢复了吗|好了没).{0,12}(?:模型|model|provider|供应方|api)/iu.test(
    text,
  );
}

function isDesktopXSessionStatusInquiry(text) {
  return (
    /(?:我|用户).{0,8}(?:已经)?(?:登录|打开).{0,16}(?:x|twitter|推特)/iu.test(text) ||
    /(?:x|twitter|推特).{0,16}(?:已经)?(?:登录|打开)/iu.test(text) ||
    /^我打开了[。！!？?\s]*$/u.test(text)
  );
}

function isDesktopLearningSourceStatusInquiry(text) {
  if (/(?:准入|保存|收录|入库|沉淀|生成|创建).{0,18}(?:经验|候选|学习|知识)|(?:经验|候选|学习|知识).{0,18}(?:准入|保存|收录|入库|沉淀|生成|创建)/iu.test(text)) {
    return false;
  }
  if (/(?:读取|读一下|打开|看看|看一下).{0,16}(?:页面|网页|网站|文章|链接|URL|url|资料|帖子|推文)/iu.test(text)) {
    return false;
  }
  return (
    /(?:刚才|上次|这个|那个|链接|来源|资料|正文|页面).{0,24}(?:读到|读完|读取|抓到|抓取|打开|成功|失败|状态|能读|没读|有没有读|是否读)/iu.test(
      text,
    ) ||
    /(?:读到|读完|读取|抓到|抓取|打开|成功|失败|状态|能读|没读|有没有读|是否读).{0,24}(?:刚才|上次|这个|那个|链接|来源|资料|正文|页面)/iu.test(
      text,
    )
  );
}

function isExplicitReadOnlyUrlQuestion(prompt) {
  return (
    extractFirstHttpUrl(prompt) !== null &&
    /(?:不要|不必|无需|禁止|别).{0,12}(?:入库|保存|收录|沉淀|写入|创建候选|生成候选)|(?:只|仅|直接).{0,12}(?:回答|回复|总结|告诉|读取|提取|看看)|(?:重新|再次|二次|完整|全文|全部).{0,12}(?:读取|提取|抽取|打开|总结|回答)|(?:学到了什么|学到什么|完整学到了什么)/iu.test(
      prompt,
    )
  );
}

function isFreshReadOnlyUrlLearningRequest(prompt) {
  return (
    extractFirstHttpUrl(prompt) !== null &&
    isExplicitFreshUrlReadIntent(prompt) &&
    !shouldCreateLearningCandidateFromNaturalSource(prompt)
  );
}

function isExplicitFreshUrlReadIntent(prompt) {
  const text = normalizePrompt(prompt);
  if (text.length === 0) {
    return false;
  }
  const hasFreshReadVerb =
    /(?:学习|读取|读一下|读这个|深读|完整读|重新读|重读|二次提取|提取|抽取|打开|看看|看一下|总结|整理|分析|了解).{0,32}(?:链接|URL|url|帖子|推文|文章|正文|内容|这个|该|全文)?/iu.test(
      text,
    ) ||
    /(?:链接|URL|url|帖子|推文|文章|正文|内容|这个|该).{0,32}(?:学习|读取|读一下|读这个|深读|重新读|重读|二次提取|提取|抽取|打开|看看|看一下|总结|整理|分析|了解)/iu.test(
      text,
    );
  const asksToolBackedRead =
    /(?:OpenCLI|opencli|登录态|simon|深读|全文|完整|二次提取|证据区|全文字符数|媒体数量)/iu.test(
      text,
    );
  const blocksPersistence =
    /(?:不要|别|不必|不用|无需|禁止|不能).{0,32}(?:入库|保存|收录|沉淀|写入|创建候选|生成候选|候选|经验|知识)/iu.test(
      text,
    ) || /(?:只|仅|直接).{0,16}(?:回答|回复|总结|告诉|读取|提取|看看|看详情)/iu.test(text);
  return (
    (hasFreshReadVerb && (asksToolBackedRead || blocksPersistence)) ||
    isExplicitReadOnlyUrlQuestion(text)
  );
}

function resolveReadOnlyLearningEvidenceFollowupIntent(
  prompt,
  workbenchConversation,
  snapshot = null,
) {
  if (isLearningCollectionAdviceQuestion(prompt)) {
    return null;
  }
  if (!isReadOnlyLearningEvidenceFollowup(prompt)) {
    return null;
  }
  const evidenceDisclosure = selectRecentDesktopEvidenceDisclosure(prompt, {
    workbenchConversation,
    snapshot,
  });
  if (evidenceDisclosure === null) {
    return null;
  }
  return {
    kind: "snapshot",
    title: "证据字段",
    body: renderDesktopEvidenceDisclosureAnswer(evidenceDisclosure),
    evidenceDisclosure,
  };
}

function resolveLearningResultFollowupIntent(prompt, workbenchConversation, snapshot = null) {
  const isFollowup = isLearningResultFollowupPrompt(prompt);
  const promptText = normalizePrompt(prompt);
  const isBareContinue = /^(?:继续|接着说|继续说|展开|说下去|go on|continue)$/iu.test(promptText);
  if (isLearningFollowupBlockedByExplicitNoEvidenceConstraint(prompt, workbenchConversation, snapshot)) {
    return null;
  }
  if (
    !isFollowup &&
    !isBareContinue &&
    !hasRecoverableDesktopLearningEvidenceFrame(snapshot, workbenchConversation?.sessionKey)
  ) {
    return null;
  }
  const evidenceFrame =
    normalizeDesktopActiveEvidenceFrameForBridge(workbenchConversation?.activeEvidenceFrame) ??
    createDesktopActiveEvidenceFrameFromSnapshot(snapshot, workbenchConversation?.sessionKey);
  if (evidenceFrame === null && !hasRecentDesktopLearningEvidence(prompt, workbenchConversation, snapshot)) {
    return isFollowup ? missingLearningEvidenceFollowupIntent(prompt) : null;
  }
  if (!isFollowup && !isBareContinue && evidenceFrame === null) {
    return null;
  }
  return modelProviderTextIntent(prompt, {
    activeEvidenceFrame: evidenceFrame,
  });
}

function shouldLearningEvidenceIntentPreemptRun(prompt, conversationTurn, options = {}) {
  const allowBareContinue = options.allowBareContinue !== false;
  if (
    !allowBareContinue &&
    /^(?:继续|接着说|继续说|展开|说下去|go on|continue)$/iu.test(normalizePrompt(prompt))
  ) {
    return false;
  }
  return (
    isReadOnlyLearningEvidenceFollowup(prompt) ||
    isLearningResultFollowupPrompt(prompt) ||
    conversationTurn.intent.kind === "learning-confirmation"
  );
}

function shouldLearningFollowupPreemptCurrentRun(prompt, source = {}) {
  if (!/^(?:继续|接着说|继续说|展开|说下去|go on|continue)$/iu.test(normalizePrompt(prompt))) {
    return true;
  }
  if (
    readLatestDesktopLearningPendingConfirmation(
      source?.snapshot,
      source?.workbenchConversation?.sessionKey,
    ) !== null
  ) {
    return true;
  }
  const activeFrame = normalizeDesktopActiveEvidenceFrameForBridge(
    source?.workbenchConversation?.activeEvidenceFrame,
  );
  if (!validateDesktopLearningFollowupEvidenceFrame(activeFrame).valid) {
    return false;
  }
  return wasLatestWorkbenchTurnLearningEvidence(source?.workbenchConversation);
}

function wasLatestWorkbenchTurnLearningEvidence(workbenchConversation) {
  const latestTurn = Array.isArray(workbenchConversation?.turns)
    ? [...workbenchConversation.turns].reverse().find((turn) => turn?.role === "user")
    : null;
  const latestEvidence = Array.isArray(workbenchConversation?.evidenceDisclosures)
    ? workbenchConversation.evidenceDisclosures.at(-1)
    : null;
  if (!latestTurn || !latestEvidence) {
    return false;
  }
  return normalizePrompt(latestTurn.text) === normalizePrompt(latestEvidence.prompt);
}

function isLearningFollowupBlockedByExplicitNoEvidenceConstraint(
  prompt,
  workbenchConversation,
  snapshot,
) {
  const text = normalizePrompt(prompt);
  if (!/(?:不要|别|先别|暂时别|不必|不用|无需|禁止|不许).{0,16}(?:入库|保存|收录|沉淀|写入|创建候选|生成候选|候选|经验|知识)/iu.test(text)) {
    return false;
  }
  const frame =
    normalizeDesktopActiveEvidenceFrameForBridge(workbenchConversation?.activeEvidenceFrame) ??
    createDesktopActiveEvidenceFrameFromSnapshot(snapshot, workbenchConversation?.sessionKey);
  return !validateDesktopLearningFollowupEvidenceFrame(frame).valid;
}

function missingLearningEvidenceFollowupIntent(prompt) {
  const requestedUrl = extractFirstHttpUrl(prompt);
  return {
    kind: "snapshot",
    title: "没有上一轮学习证据",
    body: [
      "没有找到上一轮学习证据。",
      requestedUrl === null ? null : `URL：${requestedUrl}`,
      "这次没有继续制作运行，也没有调用模型补猜。",
      "请先完成一次链接学习，拿到可信正文和证据字段后再追问。",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function validateDesktopLearningFollowupEvidenceFrame(frame) {
  if (frame === null) {
    return { valid: false, reason: "missing" };
  }
  if (!isValidDesktopLearningEvidenceFrameId(frame.frameId)) {
    return { valid: false, reason: "invalid-frame-id" };
  }
  const hasCandidates = Array.isArray(frame.candidateIds) && frame.candidateIds.length > 0;
  const hasSources = Array.isArray(frame.sourceUrls) && frame.sourceUrls.length > 0;
  const hasEvidence = isPlainDesktopBridgeObject(frame.evidenceDisclosure);
  if (!hasCandidates && !hasSources && !hasEvidence) {
    return { valid: false, reason: "missing-evidence" };
  }
  if (hasEvidence && !hasSources) {
    return { valid: false, reason: "missing-source" };
  }
  return { valid: true, reason: "active" };
}

function isValidDesktopLearningEvidenceFrameId(frameId) {
  return /^learn-\d+-[A-Za-z0-9_.-]+$/u.test(String(frameId ?? ""));
}

function isLearningResultFollowupPrompt(prompt) {
  const text = normalizePrompt(prompt);
  if (text.length === 0) {
    return false;
  }
  if (isLearningCollectionAdviceQuestion(text)) {
    return true;
  }
  const asksLearningOutcome =
    /(?:学(?:习)?(?:到|到了|了)?|吸收|沉淀|读(?:到|了)?|看(?:到|了)?|理解).{0,18}(?:什么|哪些|内容|要点|结果|结论|总结|详情)|(?:学习|读取|已读|看过).{0,14}(?:结果|结论|要点|摘要|总结|详情)|(?:讲(?:了)?什么|内容是什么|要点是什么|总结一下|看详情)/iu.test(
      text,
    );
  if (asksLearningOutcome) {
    return true;
  }
  const hasRecentPointer =
    /(?:刚才|上一轮|上次|前面|上面|然后|这次|最近|这个|该|那条|那篇|链接|帖子|推文|文章|内容|来源)/iu.test(
      text,
    );
  const hasLearningReference =
    /(?:学习|学到|学了|已读|读取|看过|内容|要点|总结|详情|候选|经验|链接|帖子|推文|文章|来源|吸收|沉淀)/iu.test(
      text,
    );
  const asksQuestion =
    /(?:什么|哪些|哪条|哪个|如何|怎样|吗|[?？]|详情|总结|要点|列出|说明|告诉)/iu.test(text);
  return hasRecentPointer && hasLearningReference && asksQuestion;
}

function hasRecentDesktopLearningEvidence(prompt, workbenchConversation, snapshot = null) {
  if (isPlainDesktopBridgeObject(workbenchConversation?.activeEvidenceFrame?.evidenceDisclosure)) {
    return true;
  }
  return (
    selectRecentDesktopEvidenceDisclosure(prompt, {
      workbenchConversation,
      snapshot,
    }) !== null
  );
}

function selectRecentDesktopEvidenceDisclosure(prompt, source) {
  const workbenchConversation = isPlainDesktopBridgeObject(source)
    ? source.workbenchConversation
    : source;
  const snapshot = isPlainDesktopBridgeObject(source) ? source.snapshot : null;
  const sessionKey =
    readDesktopEvidenceString(source?.sessionKey) ??
    readDesktopEvidenceString(workbenchConversation?.sessionKey);
  const records = Array.isArray(workbenchConversation?.evidenceDisclosures)
    ? workbenchConversation.evidenceDisclosures
    : [];
  const allRecords = [
    ...records,
    ...collectSnapshotDesktopEvidenceDisclosureRecords(snapshot, sessionKey),
  ];
  if (allRecords.length === 0) {
    return null;
  }
  const requestedUrl = extractFirstHttpUrl(prompt);
  if (requestedUrl !== null) {
    const matched = [...allRecords]
      .reverse()
      .find((record) =>
        getDesktopEvidenceDisclosureSources(record.evidenceDisclosure).some(
          (source) => readDesktopEvidenceString(source.url) === requestedUrl,
        ),
      );
    return matched?.evidenceDisclosure ?? null;
  }
  return allRecords.at(-1)?.evidenceDisclosure ?? null;
}

function collectSnapshotDesktopEvidenceDisclosureRecords(snapshot, sessionKey) {
  const taskRuntime = snapshot?.assets?.tools?.taskRuntime;
  const tasks = [
    ...(Array.isArray(taskRuntime?.history) ? taskRuntime.history : []),
    ...(Array.isArray(taskRuntime?.tasks) ? taskRuntime.tasks : []),
    taskRuntime?.latestTask,
  ];
  return tasks
    .filter(isPlainDesktopBridgeObject)
    .filter((task) => desktopBridgeRecordMatchesSession(task, sessionKey))
    .map((task) => ({
      prompt: readDesktopEvidenceString(task.payload?.promptPreview ?? task.promptPreview) ?? "",
      evidenceDisclosure:
        task.evidenceDisclosure ??
        task.payload?.evidenceDisclosure ??
        task.summary?.evidenceDisclosure ??
        null,
      createdAt:
        readDesktopEvidenceString(task.completedAt ?? task.updatedAt ?? task.createdAt) ??
        new Date(0).toISOString(),
    }))
    .filter((record) => isPlainDesktopBridgeObject(record.evidenceDisclosure));
}

function renderDesktopEvidenceDisclosureAnswer(evidenceDisclosure) {
  const sources = getDesktopEvidenceDisclosureSources(evidenceDisclosure);
  const source = sources[0] ?? {};
  const url = readDesktopEvidenceString(source.url) ?? "未知";
  const fullBodyChars =
    readDesktopEvidenceNumber(source.fullBodyChars ?? source.full_body_chars) ?? 0;
  const readStatus =
    readDesktopEvidenceString(source.readStatus ?? source.read_status) ??
    (fullBodyChars > 0 ? "已读到可信正文" : "未读到可信正文");
  const secondPassExtracted =
    source.secondPassExtracted === true || source.second_pass_extracted === true;
  const mediaCounts = readDesktopEvidenceMediaCounts(source);
  const persisted =
    source.persisted === true ||
    source.admitted === true ||
    source.persistedToKnowledge === true ||
    source.persisted_to_knowledge === true;
  const mediaUnderstood =
    source.mediaUnderstood === true ||
    source.media_understood === true ||
    source.mediaUnderstandingStatus === "understood" ||
    source.media_understanding_status === "understood";
  return [
    "证据字段",
    `URL：${url}`,
    `全文字符数：${fullBodyChars}`,
    `正文读取状态：${readStatus}`,
    `二次提取：${secondPassExtracted ? "是" : "否"}`,
    `媒体数量：图片 ${mediaCounts.image}、视频 ${mediaCounts.video}、音频 ${mediaCounts.audio}、poster ${mediaCounts.poster}、blob ${mediaCounts.blob}`,
    `是否已入库：${persisted ? "是" : "否"}`,
    `媒体是否已理解：${mediaUnderstood ? "是" : "否"}`,
    "",
    `边界说明：${renderDesktopEvidenceBoundary({ fullBodyChars, mediaUnderstood })}`,
  ].join("\n");
}

function getDesktopEvidenceDisclosureSources(evidenceDisclosure) {
  if (Array.isArray(evidenceDisclosure?.sources)) {
    return evidenceDisclosure.sources.filter((source) => source && typeof source === "object");
  }
  return evidenceDisclosure && typeof evidenceDisclosure === "object" ? [evidenceDisclosure] : [];
}

function readDesktopEvidenceMediaCounts(source) {
  const inventory =
    source.mediaInventory && typeof source.mediaInventory === "object"
      ? source.mediaInventory
      : source.media_inventory && typeof source.media_inventory === "object"
        ? source.media_inventory
        : {};
  const totalMediaCount = readDesktopEvidenceNumber(source.mediaCount ?? source.media_count) ?? 0;
  const image =
    readDesktopEvidenceNumber(
      inventory.imageCount ?? inventory.image_count ?? source.imageCount ?? source.image_count,
    ) ?? 0;
  const video =
    readDesktopEvidenceNumber(
      inventory.videoCount ?? inventory.video_count ?? source.videoCount ?? source.video_count,
    ) ?? 0;
  const audio =
    readDesktopEvidenceNumber(
      inventory.audioCount ?? inventory.audio_count ?? source.audioCount ?? source.audio_count,
    ) ?? 0;
  const poster =
    readDesktopEvidenceNumber(
      inventory.posterCount ?? inventory.poster_count ?? source.posterCount ?? source.poster_count,
    ) ?? 0;
  const blob =
    readDesktopEvidenceNumber(
      inventory.blobCount ?? inventory.blob_count ?? source.blobCount ?? source.blob_count,
    ) ?? 0;
  if (image + video + audio + poster + blob > 0 || totalMediaCount === 0) {
    return { image, video, audio, poster, blob };
  }
  return { image: totalMediaCount, video: 0, audio: 0, poster: 0, blob: 0 };
}

function renderDesktopEvidenceBoundary({ fullBodyChars, mediaUnderstood }) {
  if (fullBodyChars <= 0) {
    return "未读到可信正文，媒体未理解；不能把正文或媒体内容当结论。";
  }
  if (mediaUnderstood) {
    return "文本已读，媒体已理解；结论仍必须以已披露证据为准。";
  }
  return "文本已读，媒体未理解；未授权时不能把图片、视频、音频里的画面、动作、字幕或声音当结论。";
}

function readDesktopEvidenceString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readDesktopEvidenceNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isPlainDesktopBridgeObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function coerceExplicitReadOnlyUrlConversationTurn(conversationTurn, prompt) {
  const url = extractFirstHttpUrl(prompt);
  const metadata = createExplicitReadOnlyUrlMetadata(
    prompt,
    url,
    conversationTurn.intent?.metadata,
  );
  return {
    ...conversationTurn,
    intent: {
      kind: "chat",
      metadata,
    },
    responsePolicy: "result-first",
    userText: "用户明确要求只读链接并直接回答，不启动制作任务，也不生成经验候选。",
    memoryDecision: {
      action: "candidate-review",
      reason: "只读链接问答不直接入库；如后续要沉淀，再进入待审候选。",
    },
    shouldInvokeRecall: true,
    shouldCreateRun: false,
    shouldAttachToActiveSession: false,
  };
}

function coerceLearningResultFollowupConversationTurn(conversationTurn, prompt) {
  const previousKind =
    typeof conversationTurn.intent?.kind === "string" ? conversationTurn.intent.kind : null;
  return {
    ...conversationTurn,
    intent: {
      kind: "chat",
      metadata: {
        ...(conversationTurn.intent?.metadata ?? {}),
        activeEvidenceFollowup: true,
        followupKind: "learning-result",
        coercedFromIntentKind: previousKind,
      },
    },
    responsePolicy: "result-first",
    userText: "用户正在追问最近一次学习或读取结果；基于已披露证据回答，不推进制作运行。",
    memoryDecision: {
      action: "never-store",
      reason: "学习结果追问只读取当前证据上下文，不直接写入长期记忆。",
    },
    shouldInvokeRecall: true,
    shouldCreateRun: false,
    shouldAttachToActiveSession: false,
  };
}

function coerceLearningConfirmationRuntimeRouteTurn(conversationTurn) {
  const previousKind =
    typeof conversationTurn.intent?.kind === "string" ? conversationTurn.intent.kind : null;
  return {
    ...conversationTurn,
    intent: {
      kind: "chat",
      metadata: {
        ...(conversationTurn.intent?.metadata ?? {}),
        learningConfirmation: true,
        coercedFromIntentKind: previousKind,
      },
    },
    responsePolicy: "result-first",
    userText: "用户可能在确认当前待保存学习候选；实际确认、过期和候选选择必须由共享 runtime store 裁决。",
    memoryDecision: {
      action: "transient",
      reason: "学习确认路由只进入共享 runtime，不在桌面端保存或改写长期记忆。",
    },
    shouldInvokeRecall: false,
    shouldCreateRun: false,
    shouldAttachToActiveSession: false,
  };
}

function createExplicitReadOnlyUrlMetadata(prompt, url, baseMetadata = {}) {
  return {
    ...baseMetadata,
    directReadPreferred: true,
    sourceKind: "url",
    url,
    ...(shouldPreferOpenCliForUrl(prompt, url) ? { preferredToolProvider: "opencli" } : {}),
    coercedFromIntentKind: baseMetadata?.coercedFromIntentKind ?? null,
  };
}

function shouldPreferOpenCliForUrl(prompt, url) {
  if (/opencli|登录态|simon/iu.test(prompt)) {
    return true;
  }
  if (url === null) {
    return false;
  }
  return isXOrTwitterUrl(url);
}

function isXOrTwitterUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./u, "");
    return (
      host === "x.com" ||
      host === "twitter.com" ||
      host === "mobile.twitter.com" ||
      host.endsWith(".x.com") ||
      host.endsWith(".twitter.com")
    );
  } catch {
    return false;
  }
}

function shouldForceConfiguredProviderModelTurn(prompt) {
  return (
    /(?:当前已配置|配置的|已配置)\s*(?:模型供应方|模型供应商|供应方|供应商|provider|api)/iu.test(
      prompt,
    ) ||
    /(?:真实模型回执|真实模型|真实回答|直接对话模型|调用\s*API|调用\s*api)/iu.test(prompt) ||
    /(?:只回复|仅回复|用一行|一行中文|不要解释|无需解释|不解释)/iu.test(prompt) ||
    /(?:不要|不许|无需|禁止)\s*(?:调用|使用|走)?\s*(?:任何)?\s*(?:工具|tool|mcp)/iu.test(prompt)
  );
}

function createDesktopConversationTurn(prompt, snapshot) {
  const actionableRun = selectActionableRun(snapshot);
  return orchestrateConversationTurn({
    text: prompt,
    surface: "desktop",
    channel: "desktop",
    agentId: "director-angel",
    peerId: "desktop-operator",
    activeSession: {
      hasActiveSession: actionableRun?.runId !== undefined,
      ...(actionableRun?.runId === undefined ? {} : { runId: actionableRun.runId }),
      ...(actionableRun?.goal === undefined ? {} : { objective: actionableRun.goal }),
    },
  });
}

function attachConversationTurnToIntent(intent, conversationTurn) {
  return {
    ...intent,
    operatorTrace: conversationTurn.operatorTrace,
    turnIntent: conversationTurn.intent,
    memoryDecision: conversationTurn.memoryDecision,
    responsePolicy: conversationTurn.responsePolicy,
    shouldInvokeRecall: conversationTurn.shouldInvokeRecall,
    shouldCreateRun: conversationTurn.shouldCreateRun,
    shouldAttachToActiveSession: conversationTurn.shouldAttachToActiveSession,
  };
}

function resolveSlashComposerIntent(prompt, snapshot, workbenchConversation) {
  const slash = parseSlashPrompt(prompt);
  if (!slash) {
    return null;
  }
  if (slash.name.length === 0 || isSlashName(slash.name, ["帮助", "help", "?"])) {
    return slashUsageIntent();
  }

  const sharedSlash = parseChannelSlashCommand(prompt);
  if (sharedSlash?.commandId === "learning.admit") {
    return sharedSlash.args.length > 0
      ? learningSourceIntent(sharedSlash.args)
      : missingSlashArgumentIntent("/学习 后面需要放链接、本地文件/目录路径或学习主题。");
  }
  if (sharedSlash?.commandId === "production.start") {
    return sharedSlash.args.length > 0
      ? productionTaskIntent(
          withRecentDesktopContext({
            context: workbenchConversation,
            text: sharedSlash.args,
          }),
          {
            workflowType: inferProductionWorkflowType(sharedSlash.matchedName, sharedSlash.args),
          },
        )
      : missingSlashArgumentIntent(
          "/制作 后面需要放制作目标，例如：/制作 生成一条 15 秒短剧分镜。",
        );
  }
  if (sharedSlash?.commandId === "run.confirm") {
    return (
      resolveCurrentRunActionIntent(snapshot) ??
      resolveNextReviewIntent(snapshot) ??
      missingReviewTargetIntent("当前没有可确认继续的制作任务。")
    );
  }
  const sharedPriorityIntent = resolveSharedChannelSlashIntent(sharedSlash, snapshot);
  if (sharedPriorityIntent && shouldPreferSharedChannelSlashIntent(sharedSlash, slash.name)) {
    return sharedPriorityIntent;
  }

  if (isSlashName(slash.name, ["经验", "experience"])) {
    return resolveExperienceSlashIntent(slash.args, snapshot);
  }

  if (isSlashName(slash.name, ["知识", "knowledge"])) {
    return resolveKnowledgeSlashIntent(slash.args, snapshot);
  }

  if (isSlashName(slash.name, ["技能", "skill", "skills"])) {
    return resolveSkillSlashIntent(slash.args);
  }

  if (isSlashName(slash.name, ["工具", "tool", "tools", "adapter", "cli"])) {
    return resolveToolSlashIntent(slash.args);
  }

  if (isSlashName(slash.name, ["comfyui", "comfy", "comfy-ui"])) {
    return resolveComfyUiSlashIntent(slash.args, workbenchConversation);
  }

  if (isSlashName(slash.name, ["审查", "review"])) {
    return resolveReviewSlashIntent(slash.args);
  }

  if (isSlashName(slash.name, ["每日反省", "每日自省", "自省", "daily-reflection"])) {
    return dailySelfReflectionIntent(slash.args);
  }

  if (isSlashName(slash.name, ["复盘", "反思", "reflect", "reflection"])) {
    return runReflectionIntent(
      slash.args,
      "复盘运行",
      "/复盘 或 /反思 后面需要放 runId，例如：/反思 run_123。",
    );
  }

  if (isSlashName(slash.name, ["灵魂", "soul"])) {
    return resolveSoulSlashIntent(slash.args);
  }

  if (isSlashName(slash.name, ["心跳", "heartbeat"])) {
    return resolveHeartbeatSlashIntent(slash.args);
  }

  if (isSlashName(slash.name, ["维护", "清理", "垃圾处理", "maintenance", "cleanup", "clean"])) {
    return resolveMaintenanceSlashIntent(slash.args);
  }

  if (isSlashName(slash.name, ["微信", "微信网关", "weixin", "wechat"])) {
    return resolveWeixinGatewaySlashIntent(slash.args);
  }

  if (isSlashName(slash.name, ["设置", "setting", "settings", "switch"])) {
    return resolveSettingsSlashIntent(slash.args, snapshot);
  }

  if (isSlashName(slash.name, ["供应方", "供应商", "provider", "providers", "api"])) {
    return resolveApiProviderSlashIntent(slash.args);
  }

  if (isSlashName(slash.name, ["图片", "图像", "出图", "image", "draw"])) {
    return imageGenerationIntent(slash.args);
  }

  if (isSlashName(slash.name, ["视频", "生成视频", "video"])) {
    return videoGenerationIntent(slash.args);
  }

  if (isSlashName(slash.name, ["诊断", "doctor", "health"])) {
    return commandIntent(
      "workspace.doctor",
      {},
      "运行诊断",
      "Angel 会检查工作区、runtime、memory 和工具连接状态。",
    );
  }

  if (isSlashName(slash.name, ["状态", "status"])) {
    return commandIntent(
      "workspace.status",
      {},
      "查看状态",
      "Angel 会读取当前工作区和本地运行状态。",
    );
  }

  if (isSlashName(slash.name, ["记忆", "memory"])) {
    return resolveMemorySlashIntent(slash.args);
  }

  if (isSlashName(slash.name, ["运行", "run"])) {
    return resolveRunSlashIntent(slash.args);
  }

  if (sharedPriorityIntent) {
    return sharedPriorityIntent;
  }

  return unknownSlashIntent(prompt);
}

function shouldPreferSharedChannelSlashIntent(sharedSlash, slashName) {
  if (!sharedSlash) {
    return false;
  }
  if (sharedSlash.matchedName.trim() === slashName.trim()) {
    return false;
  }
  return true;
}

function resolveSharedChannelSlashIntent(sharedSlash, snapshot) {
  if (!sharedSlash) {
    return null;
  }
  switch (sharedSlash.commandId) {
    case "experience.list":
      return resolveExperienceSlashIntent("", snapshot);
    case "experience.accept":
      return resolveExperienceAcceptIntent(snapshot, sharedSlash.args);
    case "experience.reject":
      return resolveRejectIntent(snapshot, sharedSlash.args);
    case "experience.promote":
      return resolveExperiencePromoteIntent(snapshot, sharedSlash.args);
    case "knowledge.candidates":
      return resolveKnowledgeSlashIntent("", snapshot);
    case "knowledge.accept":
      return resolveKnowledgeAcceptIntent(snapshot, sharedSlash.args);
    case "knowledge.publish":
      return resolveKnowledgePublishIntent(snapshot, sharedSlash.args);
    case "knowledge.recallPreview":
      return knowledgeRecallIntent();
    case "knowledge.explain":
      return knowledgeExplainIntent(sharedSlash.args);
    case "knowledge.diff":
      return knowledgeDiffIntent(sharedSlash.args);
    case "knowledge.rollback":
      return knowledgeRollbackIntent(sharedSlash.args);
    case "skills.list":
      return resolveSkillSlashIntent("");
    case "skills.proposeFromExperience":
      return skillProposeFromExperienceIntent(sharedSlash.args);
    case "skills.accept":
      return skillProposalDecisionIntent(
        sharedSlash.args,
        "task.proposal-accept",
        DESKTOP_ACTIONS.SKILL_PROPOSAL_ACCEPT,
        "接受 Skill 候选",
        "/接受Skill 后面需要放 proposalId。",
      );
    case "skills.reject":
      return skillProposalDecisionIntent(
        sharedSlash.args,
        "task.proposal-reject",
        DESKTOP_ACTIONS.SKILL_PROPOSAL_REJECT,
        "拒绝 Skill 候选",
        "/拒绝Skill 后面需要放 proposalId。",
      );
    case "skills.apply":
      return skillProposalDecisionIntent(
        sharedSlash.args,
        "task.proposal-apply",
        DESKTOP_ACTIONS.SKILL_PROPOSAL_APPLY,
        "调用 Skill",
        "/调用Skill 后面需要放 proposalId。",
      );
    case "skills.classify":
      return skillClassificationIntent(sharedSlash.args);
    case "skills.tag":
      return skillTagIntent(sharedSlash.args);
    case "tools.list":
      return resolveToolSlashIntent("");
    case "tools.register":
      return resolveToolSlashIntent(`注册 ${sharedSlash.args}`.trim());
    case "tools.enable":
      return resolveToolSlashIntent(`启用 ${sharedSlash.args}`.trim());
    case "tools.disable":
      return resolveToolSlashIntent(`禁用 ${sharedSlash.args}`.trim());
    case "tools.capabilities":
      return resolveToolSlashIntent("平台");
    case "run.status":
    case "run.start":
    case "run.pause":
    case "run.resume":
    case "run.abort":
    case "run.report":
    case "run.explain":
    case "run.audit":
    case "run.retry":
    case "run.approve":
    case "run.approvePending":
    case "run.reroute":
      return sharedRunCommandIntent(sharedSlash.commandId, sharedSlash.args);
    case "run.reflect":
      return runReflectionIntent(sharedSlash.args, "运行反思", "/运行反思 后面需要放 runId。");
    case "settings.providers":
      return resolveApiProviderSlashIntent("");
    case "settings.provider.test":
      return apiProviderTestIntent(sharedSlash.args);
    case "settings.provider.set":
      return resolveApiProviderSlashIntent(`设置 ${sharedSlash.args}`.trim());
    case "settings.textModel":
      return providerModelSettingIntent("text", sharedSlash.args);
    case "settings.imageModel":
      return providerModelSettingIntent("image", sharedSlash.args);
    case "settings.switches":
      return resolveSettingsSlashIntent("", snapshot);
    case "settings.doctor":
      return commandIntent(
        "workspace.doctor",
        {},
        "运行设置诊断",
        "Angel 会检查供应方、存储、桥接、命令和权限设置是否完整。",
      );
    case "media.comfyui.run":
      return resolveComfyUiSlashIntent(sharedSlash.args);
    case "memory.status":
      return resolveMemorySlashIntent("状态");
    case "memory.recallPreview":
      return memoryRecallPreviewIntent(sharedSlash.args);
    case "maintenance.preview":
      return resolveMaintenanceSlashIntent(`预览 ${sharedSlash.args}`.trim());
    case "maintenance.apply":
      return resolveMaintenanceSlashIntent(`执行 ${sharedSlash.args}`.trim());
    case "heartbeat.status":
      return resolveHeartbeatSlashIntent("状态");
    case "selfReflection.daily":
      return dailySelfReflectionIntent(sharedSlash.args);
    case "heartbeat.start":
      return resolveHeartbeatSlashIntent("开启");
    case "heartbeat.stop":
      return resolveHeartbeatSlashIntent("关闭");
    case "soul.status":
    case "soul.view":
      return resolveSoulSlashIntent("");
    default:
      return null;
  }
}

function resolveGranularComposerIntent(prompt, snapshot) {
  return (
    resolveNaturalExperienceIntent(prompt, snapshot) ??
    resolveNaturalKnowledgeIntent(prompt, snapshot) ??
    resolveNaturalRunIntent(prompt) ??
    resolveNaturalHeartbeatIntent(prompt) ??
    resolveNaturalApiProviderIntent(prompt) ??
    resolveNaturalMemoryIntent(prompt)
  );
}

function resolveNaturalWorkspaceManagementIntent(prompt) {
  const intent = parseChannelNaturalWorkspaceManagementIntent(prompt);
  if (!intent) {
    return null;
  }
  switch (intent.kind) {
    case "skills.list":
      return {
        kind: "command",
        commandId: "task.proposalList",
        args: { limit: 20 },
        title: "查看 Skill 候选",
        body: "Angel 会查看待审查的 Skill 提案；已批准 Skill 会显示在 Skills 板块。",
      };
    case "tools.list":
      return {
        kind: "command",
        commandId: "adapter.list",
        args: {},
        title: "查看外部工具连接",
        body: "Angel 会读取已注册的外部工具和平台适配器。",
      };
    case "providers.list":
      return {
        kind: "snapshot",
        title: "查看 API 供应方",
        body: "Angel 会读取设置页里的 API 供应方配置；修改请用 /供应方 设置、/供应方 密钥 或 /供应方 启用/禁用。",
      };
    case "settings.list":
      return {
        kind: "command",
        commandId: "workspace.switches",
        args: {},
        title: "查看设置",
        body: "Angel 会读取运行时功能开关和本地配置状态。",
      };
    case "workspace.status":
      return {
        kind: "command",
        commandId: "workspace.status",
        args: {},
        title: "查看状态",
        body: "Angel 会读取当前工作区和本地运行状态。",
      };
    case "workspace.doctor":
      return {
        kind: "command",
        commandId: "workspace.doctor",
        args: {},
        title: "运行诊断",
        body: "Angel 会检查工作区、runtime、memory 和工具连接状态。",
      };
    case "review.list":
      return {
        kind: "command",
        commandId: "traceProposal.list",
        args: { limit: 20 },
        title: "查看审查队列",
        body: "Angel 会读取运行提案和人工审查队列。",
      };
    default:
      return null;
  }
}

function parseSlashPrompt(prompt) {
  if (!prompt.startsWith("/")) {
    return null;
  }
  const body = prompt.slice(1).trim();
  const name = body.split(/\s+/u)[0] ?? "";
  return {
    name,
    args: body.slice(name.length).trim(),
  };
}

function resolveExperienceSlashIntent(args, snapshot) {
  const { verb, rest } = splitSlashArgs(args);
  if (verb.length === 0 || matchesVerb(verb, ["列表", "候选", "list", "ls"])) {
    return {
      kind: "desktopAction",
      action: { type: DESKTOP_ACTIONS.EXPERIENCE_LIST },
      title: "查看经验候选",
      body: "Angel 会列出经验候选和审查状态。",
    };
  }
  if (matchesVerb(verb, ["接受", "通过", "accept", "approve"])) {
    return resolveExperienceAcceptIntent(snapshot, rest);
  }
  if (matchesVerb(verb, ["拒绝", "reject", "drop"])) {
    return (
      resolveRejectIntent(snapshot, rest) ?? missingReviewTargetIntent("当前没有可拒绝的经验候选。")
    );
  }
  if (matchesVerb(verb, ["晋升", "沉淀", "promote"])) {
    return resolveExperiencePromoteIntent(snapshot, rest);
  }
  if (matchesVerb(verb, ["发布", "publish"])) {
    return resolveKnowledgePublishIntent(snapshot);
  }
  if (matchesVerb(verb, ["召回", "recall"])) {
    return knowledgeRecallIntent();
  }
  if (matchesVerb(verb, ["编辑", "修改", "edit", "update"])) {
    return experienceEditIntent(rest);
  }
  if (matchesVerb(verb, ["分类", "归档", "标签", "classify", "tag"])) {
    return experienceClassificationIntent(rest);
  }
  if (matchesVerb(verb, ["新建分类", "分类创建", "category-create"])) {
    return experienceCategoryCreateIntent(rest);
  }
  if (matchesVerb(verb, ["新建标签", "标签创建", "tag-create"])) {
    return experienceTagCreateIntent(rest);
  }
  return missingSlashArgumentIntent(
    "可用经验命令：/经验 列表、/经验 编辑、/经验 接受、/经验 拒绝、/经验 晋升、/经验 发布、/经验 召回、/经验 分类、/经验 新建分类、/经验 新建标签。",
  );
}

function resolveKnowledgeSlashIntent(args, snapshot) {
  const { verb, rest } = splitSlashArgs(args);
  if (verb.length === 0 || matchesVerb(verb, ["列表", "候选", "list", "ls"])) {
    return {
      kind: "desktopAction",
      action: { type: DESKTOP_ACTIONS.KNOWLEDGE_CANDIDATE_LIST },
      title: "查看知识候选",
      body: "Angel 会列出待审查知识候选。",
    };
  }
  if (matchesVerb(verb, ["接受", "通过", "accept", "approve"])) {
    return resolveKnowledgeAcceptIntent(snapshot, rest);
  }
  if (matchesVerb(verb, ["发布", "publish"])) {
    return resolveKnowledgePublishIntent(snapshot, rest);
  }
  if (matchesVerb(verb, ["说明", "解释", "查看", "explain", "show"])) {
    return knowledgeExplainIntent(rest);
  }
  if (matchesVerb(verb, ["对比", "差异", "diff"])) {
    return knowledgeDiffIntent(rest);
  }
  if (matchesVerb(verb, ["回滚", "rollback"])) {
    return knowledgeRollbackIntent(rest);
  }
  if (matchesVerb(verb, ["召回", "recall"])) {
    return knowledgeRecallIntent();
  }
  return missingSlashArgumentIntent(
    "可用知识命令：/知识 列表、/知识 接受、/知识 发布、/知识 说明、/知识 对比、/知识 回滚、/知识 召回。",
  );
}

function resolveToolSlashIntent(args) {
  const { verb, rest } = splitSlashArgs(args);
  if (verb.length === 0 || matchesVerb(verb, ["列表", "查看", "list", "ls", "show"])) {
    return commandIntent(
      "adapter.list",
      {},
      "查看外部工具",
      "Angel 会读取已注册的外部工具和平台适配器。",
    );
  }
  if (matchesVerb(verb, ["注册", "register", "add"])) {
    if (rest.length === 0) {
      return missingSlashArgumentIntent("/工具 注册 后面需要放 adapter manifest 路径。");
    }
    return commandIntent(
      "adapter.register",
      { manifest: isFileUrl(rest) ? decodeFileUrl(rest) : rest },
      "注册外部工具",
      "Angel 会把这个 manifest 交给 adapter registry 审查和注册。",
    );
  }
  if (matchesVerb(verb, ["平台", "能力", "capabilities", "capability"])) {
    return commandIntent(
      "platform.capabilities",
      {},
      "查看平台能力",
      "Angel 会读取 runtime capability snapshot。",
    );
  }
  if (matchesVerb(verb, ["启用", "开启", "enable", "on"])) {
    return adapterIdIntent(
      rest,
      "adapter.enable",
      "启用外部工具",
      "/工具 启用 后面需要放 adapterId。",
    );
  }
  if (matchesVerb(verb, ["禁用", "关闭", "disable", "off"])) {
    return adapterIdIntent(
      rest,
      "adapter.disable",
      "禁用外部工具",
      "/工具 禁用 后面需要放 adapterId。",
    );
  }
  if (matchesVerb(verb, ["说明", "解释", "explain", "inspect"])) {
    return adapterIdIntent(
      rest,
      "adapter.explain",
      "查看外部工具详情",
      "/工具 说明 后面需要放 adapterId。",
    );
  }
  return commandIntent(
    "adapter.list",
    {},
    "查看外部工具",
    "Angel 会读取已注册的外部工具和平台适配器。",
  );
}

function resolveSkillSlashIntent(args) {
  const { verb, rest } = splitSlashArgs(args);
  if (verb.length === 0 || matchesVerb(verb, ["列表", "候选", "list", "ls"])) {
    return commandIntent(
      "task.proposalList",
      { limit: 20 },
      "查看 Skills",
      "Angel 会读取 Skill 提案队列；已批准 Skill 会在 Skills 板块展示。",
    );
  }
  if (matchesVerb(verb, ["从经验", "经验生成", "生成候选", "propose-from-experience"])) {
    return skillProposeFromExperienceIntent(rest);
  }
  if (matchesVerb(verb, ["查看", "get", "show"])) {
    return taskProposalIntent(
      rest,
      "task.proposal-get",
      "查看 Skill 提案",
      "/技能 查看 后面需要放 sessionId 和 proposalId。",
    );
  }
  if (matchesVerb(verb, ["审查", "review"])) {
    return taskProposalIntent(
      rest,
      "task.proposal-review",
      "审查 Skill 提案",
      "/技能 审查 后面需要放 sessionId 和 proposalId。",
    );
  }
  if (matchesVerb(verb, ["解释", "说明", "explain", "inspect"])) {
    return taskProposalIntent(
      rest,
      "task.proposal-explain",
      "解释 Skill 提案",
      "/技能 解释 后面需要放 sessionId 和 proposalId。",
    );
  }
  if (matchesVerb(verb, ["预览", "preview"])) {
    return taskProposalIntent(
      rest,
      "task.proposal-preview",
      "预览 Skill 提案",
      "/技能 预览 后面需要放 sessionId 和 proposalId。",
    );
  }
  if (matchesVerb(verb, ["接受", "通过", "accept", "approve"])) {
    return skillProposalDecisionIntent(
      rest,
      "task.proposal-accept",
      DESKTOP_ACTIONS.SKILL_PROPOSAL_ACCEPT,
      "接受 Skill 提案",
      "/技能 接受 后面需要放 sessionId 和 proposalId。",
    );
  }
  if (matchesVerb(verb, ["拒绝", "reject", "drop"])) {
    return skillProposalDecisionIntent(
      rest,
      "task.proposal-reject",
      DESKTOP_ACTIONS.SKILL_PROPOSAL_REJECT,
      "拒绝 Skill 提案",
      "/技能 拒绝 后面需要放 sessionId 和 proposalId。",
    );
  }
  if (matchesVerb(verb, ["分类", "归档", "标签", "classify", "tag"])) {
    return matchesVerb(verb, ["标签", "tag"])
      ? skillTagIntent(rest)
      : skillClassificationIntent(rest);
  }
  if (matchesVerb(verb, ["开启", "启用", "enable"])) {
    return skillEnablementIntent(rest, true);
  }
  if (matchesVerb(verb, ["关闭", "禁用", "disable"])) {
    return skillEnablementIntent(rest, false);
  }
  if (matchesVerb(verb, ["删除", "移除", "delete", "remove"])) {
    return skillDeleteIntent(rest);
  }
  if (matchesVerb(verb, ["新建分类", "分类创建", "category-create"])) {
    return skillCategoryCreateIntent(rest);
  }
  if (matchesVerb(verb, ["新建标签", "标签创建", "tag-create"])) {
    return skillTagCreateIntent(rest);
  }
  if (matchesVerb(verb, ["应用", "apply"])) {
    return skillProposalDecisionIntent(
      rest,
      "task.proposal-apply",
      DESKTOP_ACTIONS.SKILL_PROPOSAL_APPLY,
      "应用 Skill 提案",
      "/技能 应用 后面需要放 sessionId 和 proposalId。",
    );
  }
  if (matchesVerb(verb, ["回滚", "rollback"])) {
    const [sessionId, version] = parseTokens(rest);
    if (!sessionId || !version) {
      return missingSlashArgumentIntent("/技能 回滚 后面需要放 sessionId 和 version。");
    }
    return commandIntent(
      "task.proposalRollback",
      { sessionId, version },
      "回滚 Skill 提案",
      "Angel 会通过 task proposal rollback 回滚已应用版本。",
    );
  }
  return missingSlashArgumentIntent(
    "可用 Skill 命令：/技能、/技能 开启、/技能 关闭、/技能 删除、/技能 分类、/技能 新建分类、/技能 新建标签、/技能 查看、/技能 审查、/技能 解释、/技能 预览、/技能 接受、/技能 拒绝、/技能 应用、/技能 回滚。",
  );
}

function resolveNaturalExperienceIntent(prompt, snapshot) {
  const intent = parseChannelExperienceManagementIntent(prompt);
  if (!intent) {
    return null;
  }

  switch (intent.kind) {
    case "category.create":
      return experienceCategoryCreateIntent(intent.name);
    case "tag.create":
      return experienceTagCreateIntent(intent.name);
    case "candidate.classify":
      return {
        kind: "desktopAction",
        action: {
          type: DESKTOP_ACTIONS.EXPERIENCE_CLASSIFICATION_SAVE,
          candidateId: intent.candidateId,
          categoryId: intent.categoryId,
          tagIds: intent.tagIds,
        },
        title: "保存经验分类标签",
        body: "Angel 会把这个经验候选绑定到自定义分类和标签，晋升知识时带入召回索引。",
      };
    case "candidate.explain":
      return commandIntent(
        "experience.explain",
        { candidateId: intent.candidateId },
        "解释经验候选",
        "Angel 会查看这个经验候选的来源、风险和证据。",
      );
    case "candidate.accept":
      return resolveExperienceAcceptIntent(snapshot, intent.candidateId);
    case "candidate.reject":
      return resolveRejectIntent(snapshot, intent.candidateId);
    case "candidate.promote":
      return resolveExperiencePromoteIntent(snapshot, intent.candidateId);
    case "candidate.list":
      return {
        kind: "desktopAction",
        action: { type: DESKTOP_ACTIONS.EXPERIENCE_LIST },
        title: "查看经验候选",
        body: "Angel 会列出经验候选和审查状态。",
      };
    default:
      return null;
  }
}

function resolveNaturalKnowledgeIntent(prompt, snapshot) {
  const intent = parseChannelKnowledgeManagementIntent(prompt);
  if (!intent) {
    return null;
  }

  switch (intent.kind) {
    case "candidate.explain":
      return commandIntent(
        "knowledge.candidateExplain",
        { packId: intent.packId },
        "解释知识候选",
        "Angel 会查看这个知识候选的 method、diff 和证据。",
      );
    case "candidate.diff":
      return commandIntent(
        "knowledge.diff",
        { packId: intent.packId },
        "查看知识 diff",
        "Angel 会查看候选相对当前发布版本的变更。",
      );
    case "candidate.review":
      return commandIntent(
        "knowledge.review",
        { packId: intent.packId },
        "审查知识候选",
        "Angel 会输出知识候选审查摘要。",
      );
    case "pack.explain":
      return commandIntent(
        "knowledge.explain",
        { packId: intent.packId },
        "解释知识包",
        "Angel 会通过本地 CLI 查看这个已发布知识包。",
      );
    case "candidate.accept":
      return resolveKnowledgeAcceptIntent(snapshot, intent.packId);
    case "candidate.publish":
      return resolveKnowledgePublishIntent(snapshot, intent.packId);
    case "candidate.reject":
      return commandIntent(
        "knowledge.reject",
        { packId: intent.packId },
        "拒绝知识候选",
        "Angel 会拒绝这个知识候选，不会发布到运行时召回。",
      );
    case "status":
      return commandIntent("knowledge.status", {}, "查看知识状态", "Angel 会读取知识 lane 状态。");
    case "published.list":
      return commandIntent("knowledge.list", {}, "查看已发布知识", "Angel 会列出已发布知识包。");
    case "candidate.list":
      return {
        kind: "desktopAction",
        action: { type: DESKTOP_ACTIONS.KNOWLEDGE_CANDIDATE_LIST },
        title: "查看知识候选",
        body: "Angel 会列出待审查知识候选。",
      };
    case "recall.preview":
      return knowledgeRecallIntent();
    default:
      return null;
  }
}

function resolveNaturalRunIntent(prompt) {
  const intent = parseChannelNaturalRunManagementIntent(prompt);
  if (!intent) {
    return null;
  }
  switch (intent.kind) {
    case "assignment.retry":
      return commandIntent(
        "run.retry",
        { runId: intent.runId, assignmentId: intent.assignmentId },
        "重试运行 assignment",
        "Angel 会把失败或阻塞的 assignment 交给 run retry。",
      );
    case "assignment.approve":
      return commandIntent(
        "run.approve",
        { runId: intent.runId, assignmentId: intent.assignmentId },
        "批准运行 assignment",
        "Angel 会批准 pending operator_approve assignment，让它进入可执行队列或等待依赖。",
      );
    case "run.approvePending":
      return commandIntent(
        "run.approvePending",
        { runId: intent.runId },
        "批准全部待审 assignment",
        "Angel 会一次批准这个 run 里所有 pending operator_approve assignment。",
      );
    case "run.reflect":
      return runReflectionIntent(intent.runId, "复盘运行", "/复盘 后面需要放 runId。");
    case "run.command":
      return commandIntent(
        intent.commandId,
        { runId: intent.runId },
        "执行运行命令",
        `Angel 会调用 ${intent.commandId}。`,
      );
    default:
      return null;
  }
}

function resolveNaturalHeartbeatIntent(prompt) {
  const intent = parseChannelNaturalHeartbeatManagementIntent(prompt);
  if (!intent) {
    return null;
  }
  if (intent.kind === "heartbeat.enable") {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.SETTINGS_SET,
        parameterId: "feature:heartbeat.enabled",
        value: true,
      },
      title: "开启心跳模式",
      body: "Angel 会把 heartbeat.enabled 写入 runtime switches。当前版本仍以安全扫描为主。",
    };
  }
  if (intent.kind === "heartbeat.disable") {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.SETTINGS_SET,
        parameterId: "feature:heartbeat.enabled",
        value: false,
      },
      title: "关闭心跳模式",
      body: "Angel 会关闭 heartbeat.enabled；手动检查仍可进行只读扫描。",
    };
  }
  return {
    kind: "desktopAction",
    action: { type: DESKTOP_ACTIONS.HEARTBEAT_STATUS },
    title: "查看心跳状态",
    body: "Angel 会执行一次本地安全心跳扫描，只写入 heartbeat 事件和 latest。",
  };
}

function resolveNaturalWeixinGatewayIntent(prompt) {
  if (!isExplicitWeixinGatewayManagementPrompt(prompt)) {
    return null;
  }
  if (matchesAny(prompt, ["开启", "启用", "启动", "打开", "常驻"])) {
    return weixinGatewayIntent(
      "start",
      "启动微信网关",
      "Angel 会安装或刷新本机 LaunchAgent，并启动个人微信消息网关。",
    );
  }
  if (matchesAny(prompt, ["关闭", "禁用", "停止", "关掉"])) {
    return weixinGatewayIntent(
      "stop",
      "停止微信网关",
      "Angel 会停止本机微信消息网关，并关闭常驻运行。",
    );
  }
  if (matchesAny(prompt, ["重启", "restart", "reload"])) {
    return weixinGatewayIntent(
      "restart",
      "重启微信网关",
      "Angel 会刷新 LaunchAgent 配置并重启个人微信消息网关。",
    );
  }
  return weixinGatewayIntent(
    "status",
    "查看微信网关",
    "Angel 会读取个人微信登录、常驻服务、运行状态和最近日志。",
  );
}

function isExplicitWeixinGatewayManagementPrompt(prompt) {
  if (matchesAny(prompt, ["微信网关", "个人微信网关", "weixin gateway", "wechat gateway"])) {
    return true;
  }
  if (/\/\s*(?:微信|weixin|wechat)(?:\s|$)/iu.test(prompt)) {
    return true;
  }
  if (
    extractFirstHttpUrl(prompt) !== null ||
    /公众号|微信文章|mp\.weixin\.qq\.com/iu.test(prompt)
  ) {
    return false;
  }
  return (
    matchesAny(prompt, ["个人微信", "weixin", "wechat"]) &&
    matchesAny(prompt, [
      "网关",
      "gateway",
      "登录",
      "登入",
      "常驻",
      "运行",
      "状态",
      "启动",
      "开启",
      "打开",
      "停止",
      "关闭",
      "重启",
      "reload",
      "restart",
    ])
  );
}

function resolveNaturalApiProviderIntent(prompt) {
  if (!matchesAny(prompt, ["供应方", "供应商", "模型供应", "provider"])) {
    return null;
  }
  const isExplicitProviderTest =
    /(?:测试|检查|验证)\s*(?:api\s*)?(?:供应方|供应商|模型供应方|模型供应商|provider\b)/iu.test(
      prompt,
    ) || /(?:供应方|供应商|模型供应方|模型供应商|provider\b)\s*(?:测试|检查|验证)/iu.test(prompt);
  if (isExplicitProviderTest) {
    const providerId = extractProviderId(prompt);
    if (!providerId) {
      return missingSlashArgumentIntent(
        "测试 API 供应方需要 providerId，例如：测试供应方 memefast-api。",
      );
    }
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.API_PROVIDER_TEST,
        providerId,
      },
      title: "测试 API 供应方",
      body: "Angel 会调用已保存的供应方配置测试连接和模型可用性。",
    };
  }
  return null;
}

function resolveNaturalMemoryIntent(prompt) {
  const intent = parseChannelNaturalMemoryManagementIntent(prompt);
  if (!intent) {
    return null;
  }
  switch (intent.kind) {
    case "session.inspect":
      return commandIntent(
        "control.memoryInspect",
        { sessionId: intent.sessionId },
        "查看会话记忆",
        "Angel 会通过 control-plane 检查这个 session 的工作记忆。",
      );
    case "session.clearWorking":
      return commandIntent(
        "control.memoryClear",
        { sessionId: intent.sessionId, scope: "working" },
        "清理会话记忆",
        "Angel 会通过 control-plane 清理这个 session 的工作记忆。",
      );
    case "memory.status":
      return commandIntent(
        "memory.status",
        {},
        "查看记忆状态",
        "Angel 会读取 Director memory lane 状态。",
      );
    default:
      return null;
  }
}

function parseMaintenanceSlashOptions(value) {
  const options = {};
  const normalized = String(value ?? "");
  const mappings = [
    ["nowMs", /(?:nowMs|时间戳)[:= ]+(\d+)/iu],
    ["logRetentionDays", /(?:logRetentionDays|日志保留|日志保留天数)[:= ]+(\d+)/iu],
    ["logMaxBytes", /(?:logMaxBytes|日志大小|日志最大字节)[:= ]+(\d+)/iu],
    [
      "archivePromotedExperienceAfterDays",
      /(?:archivePromotedExperienceAfterDays|已晋升保留)[:= ]+(\d+)/iu,
    ],
    [
      "archiveRejectedExperienceAfterDays",
      /(?:archiveRejectedExperienceAfterDays|已拒绝保留)[:= ]+(\d+)/iu,
    ],
    ["archiveQuarantineAfterDays", /(?:archiveQuarantineAfterDays|隔离保留)[:= ]+(\d+)/iu],
    [
      "archiveUnreferencedArtifactsAfterDays",
      /(?:archiveUnreferencedArtifactsAfterDays|源材料保留)[:= ]+(\d+)/iu,
    ],
    ["staleUnreviewedExperienceDays", /(?:staleUnreviewedExperienceDays|未审保留)[:= ]+(\d+)/iu],
    ["staleUnreviewedMinimumScore", /(?:staleUnreviewedMinimumScore|最低分)[:= ]+(\d+)/iu],
  ];
  for (const [key, pattern] of mappings) {
    const match = pattern.exec(normalized);
    if (match?.[1]) {
      const parsed = Number.parseInt(match[1], 10);
      if (!Number.isNaN(parsed)) {
        options[key] = parsed;
      }
    }
  }
  return options;
}

function skillClassificationIntent(value) {
  const [skillId, categoryId, ...tagParts] = parseTokens(value);
  if (!skillId || !categoryId) {
    return missingSlashArgumentIntent(
      "/技能 分类 后面需要放 skillId、categoryId，可选 tagId 列表。",
    );
  }
  return {
    kind: "desktopAction",
    action: {
      type: DESKTOP_ACTIONS.SKILL_CLASSIFICATION_SAVE,
      skillId,
      categoryId,
      tagIds: normalizeTokenList(tagParts),
    },
    title: "保存 Skill 分类标签",
    body: "Angel 会把 approved Skill 的分类和标签写入本地 Skill taxonomy。",
  };
}

function skillTagIntent(value) {
  const [skillId, ...tagParts] = parseTokens(value);
  const tagIds = normalizeTokenList(tagParts);
  if (!skillId || tagIds.length === 0) {
    return missingSlashArgumentIntent("/技能 标签 后面需要放 skillId 和 tagId 列表。");
  }
  return {
    kind: "desktopAction",
    action: {
      type: DESKTOP_ACTIONS.SKILL_CLASSIFICATION_SAVE,
      skillId,
      tagIds,
    },
    title: "保存 Skill 标签",
    body: "Angel 会把这些标签写入本地 Skill taxonomy；不会改变现有分类。",
  };
}

function skillEnablementIntent(value, enabled) {
  const [skillId, ...noteParts] = parseTokens(value);
  if (!skillId) {
    return missingSlashArgumentIntent(
      enabled ? "/技能 开启 后面需要放 skillId。" : "/技能 关闭 后面需要放 skillId。",
    );
  }
  return {
    kind: "desktopAction",
    action: {
      type: DESKTOP_ACTIONS.SKILL_ENABLEMENT_SET,
      skillId,
      enabled,
      ...(noteParts.length > 0 ? { note: noteParts.join(" ") } : {}),
    },
    title: enabled ? "开启 Skill" : "关闭 Skill",
    body: enabled
      ? "Angel 会允许这个 approved Skill 被后续制作召回。"
      : "Angel 会保留 approved Skill，但后续制作不会召回它。",
  };
}

function skillDeleteIntent(value) {
  const [skillId, ...noteParts] = parseTokens(value);
  if (!skillId) {
    return missingSlashArgumentIntent("/技能 删除 后面需要放 skillId。");
  }
  return {
    kind: "desktopAction",
    action: {
      type: DESKTOP_ACTIONS.SKILL_DELETE,
      skillId,
      ...(noteParts.length > 0 ? { note: noteParts.join(" ") } : {}),
    },
    title: "删除 Skill",
    body: "Angel 会把这个 Skill 从 approved snapshot 移除，并清理它的启停状态。",
  };
}

function skillProposeFromExperienceIntent(value) {
  const [candidateId] = parseTokens(value);
  if (!candidateId) {
    return missingSlashArgumentIntent("/技能 从经验 后面需要放经验 candidateId。");
  }
  return {
    kind: "desktopAction",
    action: { type: DESKTOP_ACTIONS.SKILL_PROPOSE_FROM_EXPERIENCE, candidateId },
    title: "从经验生成 Skill 候选",
    body: "Angel 会把已审核经验转成 review-gated Skill proposal，等待你审核后再应用。",
  };
}

function skillProposalDecisionIntent(value, commandId, desktopActionType, title, missingMessage) {
  const [first, second, ...noteParts] = parseTokens(value);
  if (!first) {
    return missingSlashArgumentIntent(
      missingMessage.replace("sessionId 和 proposalId", "proposalId，或 sessionId 和 proposalId"),
    );
  }
  if (second && looksLikeProposalId(second)) {
    return taskProposalIntent(value, commandId, title, missingMessage);
  }
  return {
    kind: "desktopAction",
    action: {
      type: desktopActionType,
      proposalId: first,
      ...(second || noteParts.length > 0
        ? { note: [second, ...noteParts].filter(Boolean).join(" ") }
        : {}),
    },
    title,
    body: "Angel 会操作桌面端默认 Skill proposal 队列；跨 session proposal 仍可用 sessionId proposalId 形式。",
  };
}

function looksLikeProposalId(value) {
  return /(?:^|[-_:])proposal(?:[-_:]|$)|^p[-_]/iu.test(String(value ?? ""));
}

function skillCategoryCreateIntent(value) {
  const name = value.trim();
  if (name.length === 0) {
    return missingSlashArgumentIntent("/技能 新建分类 后面需要放分类名称。");
  }
  return {
    kind: "desktopAction",
    action: { type: DESKTOP_ACTIONS.SKILL_CATEGORY_CREATE, name },
    title: "新建 Skill 分类",
    body: "Angel 会把这个分类写入本地 Skill taxonomy。",
  };
}

function skillTagCreateIntent(value) {
  const name = value.trim();
  if (name.length === 0) {
    return missingSlashArgumentIntent("/技能 新建标签 后面需要放标签名称。");
  }
  return {
    kind: "desktopAction",
    action: { type: DESKTOP_ACTIONS.SKILL_TAG_CREATE, name },
    title: "新建 Skill 标签",
    body: "Angel 会把这个标签写入本地 Skill taxonomy。",
  };
}

function experienceClassificationIntent(value) {
  const [candidateId, categoryId, ...tagParts] = parseTokens(value);
  if (!candidateId || !categoryId) {
    return missingSlashArgumentIntent(
      "/经验 分类 后面需要放 candidateId、categoryId，可选 tagId 列表。",
    );
  }
  return {
    kind: "desktopAction",
    action: {
      type: DESKTOP_ACTIONS.EXPERIENCE_CLASSIFICATION_SAVE,
      candidateId,
      categoryId,
      tagIds: normalizeTokenList(tagParts),
    },
    title: "保存经验分类标签",
    body: "Angel 会把经验候选的分类和标签写入本地 experience taxonomy。",
  };
}

function experienceEditIntent(value) {
  const [candidateId, ...summaryParts] = parseTokens(value);
  const summary = summaryParts.join(" ").trim();
  if (!candidateId || summary.length === 0) {
    return missingSlashArgumentIntent("/经验 编辑 后面需要放 candidateId 和更新后的提炼摘要。");
  }
  return {
    kind: "desktopAction",
    action: {
      type: DESKTOP_ACTIONS.EXPERIENCE_UPDATE,
      candidateId,
      summary,
    },
    title: "编辑提炼经验",
    body: "Angel 会在经验通过审核前更新提炼内容；通过审核后的经验不能直接改写。",
  };
}

function experienceCategoryCreateIntent(value) {
  const name = value.trim();
  if (name.length === 0) {
    return missingSlashArgumentIntent("/经验 新建分类 后面需要放分类名称。");
  }
  return {
    kind: "desktopAction",
    action: { type: DESKTOP_ACTIONS.EXPERIENCE_CATEGORY_CREATE, name },
    title: "新建经验分类",
    body: "Angel 会把这个分类写入本地 experience taxonomy。",
  };
}

function experienceTagCreateIntent(value) {
  const name = value.trim();
  if (name.length === 0) {
    return missingSlashArgumentIntent("/经验 新建标签 后面需要放标签名称。");
  }
  return {
    kind: "desktopAction",
    action: { type: DESKTOP_ACTIONS.EXPERIENCE_TAG_CREATE, name },
    title: "新建经验标签",
    body: "Angel 会把这个标签写入本地 experience taxonomy。",
  };
}

function resolveReviewSlashIntent(args) {
  const { verb, rest } = splitSlashArgs(args);
  if (verb.length === 0 || matchesVerb(verb, ["列表", "队列", "list", "ls"])) {
    return commandIntent(
      "traceProposal.list",
      { limit: 20 },
      "查看审查队列",
      "Angel 会读取运行提案和人工审查队列。",
    );
  }
  if (matchesVerb(verb, ["状态", "status"])) {
    return commandIntent(
      "traceProposal.status",
      {},
      "查看提案状态",
      "Angel 会读取 trace proposal lane 状态。",
    );
  }
  if (matchesVerb(verb, ["提案", "proposal"])) {
    return resolveReviewSlashIntent(rest);
  }
  if (matchesVerb(verb, ["运行", "run"])) {
    return resolveRunSlashIntent(rest);
  }
  if (matchesVerb(verb, ["沉淀", "收录", "经验", "learn"])) {
    return runOutputExperienceIntent(
      rest,
      "positive-experience",
      "沉淀运行经验",
      "/审查 沉淀 后面需要放 runId。",
    );
  }
  if (matchesVerb(verb, ["记录教训", "教训", "失败教训", "lesson", "failure"])) {
    return runOutputExperienceIntent(
      rest,
      "failure-lesson",
      "记录失败教训",
      "/审查 记录教训 后面需要放 runId。",
    );
  }
  if (matchesVerb(verb, ["沉淀提案", "提案沉淀", "proposal-learn"])) {
    return traceProposalExperienceIntent(
      rest,
      "positive-experience",
      "沉淀 trace proposal",
      "/审查 沉淀提案 后面需要放 proposalId。",
    );
  }
  if (matchesVerb(verb, ["提案教训", "proposal-lesson"])) {
    return traceProposalExperienceIntent(
      rest,
      "failure-lesson",
      "记录 trace proposal 教训",
      "/审查 提案教训 后面需要放 proposalId。",
    );
  }
  if (matchesVerb(verb, ["解释", "说明", "explain", "show"])) {
    return traceProposalIntent(
      rest,
      "traceProposal.explain",
      "解释 trace proposal",
      "/审查 解释 后面需要放 proposalId。",
    );
  }
  if (matchesVerb(verb, ["审查", "review"])) {
    return traceProposalIntent(
      rest,
      "traceProposal.review",
      "审查 trace proposal",
      "/审查 审查 后面需要放 proposalId。",
    );
  }
  if (matchesVerb(verb, ["预览", "preview"])) {
    return traceProposalIntent(
      rest,
      "traceProposal.preview",
      "预览 trace proposal",
      "/审查 预览 后面需要放 proposalId。",
    );
  }
  if (matchesVerb(verb, ["接受", "通过", "accept", "approve"])) {
    return traceProposalIntent(
      rest,
      "traceProposal.accept",
      "接受 trace proposal",
      "/审查 接受 后面需要放 proposalId。",
    );
  }
  if (matchesVerb(verb, ["拒绝", "reject", "drop"])) {
    return traceProposalIntent(
      rest,
      "traceProposal.reject",
      "拒绝 trace proposal",
      "/审查 拒绝 后面需要放 proposalId。",
    );
  }
  if (matchesVerb(verb, ["重放", "replay"])) {
    const [proposalId, workerId] = parseTokens(rest);
    if (!proposalId) {
      return missingSlashArgumentIntent("/审查 重放 后面需要放 proposalId。");
    }
    return commandIntent(
      "traceProposal.replay",
      withoutUndefined({ proposalId, workerId }),
      "重放 trace proposal",
      "Angel 会通过 trace-proposal replay 重新处理这条提案。",
    );
  }
  return missingSlashArgumentIntent(
    "可用审查命令：/审查、/审查 状态、/审查 解释、/审查 审查、/审查 接受、/审查 拒绝、/审查 沉淀 <runId>、/审查 记录教训 <runId>、/审查 运行。",
  );
}

function runOutputExperienceIntent(value, intent, title, missingCopy) {
  const [runId] = parseTokens(value);
  if (!runId) {
    return missingSlashArgumentIntent(missingCopy);
  }
  return {
    kind: "desktopAction",
    action: {
      type: DESKTOP_ACTIONS.EXPERIENCE_CREATE_FROM_RUN_REPORT,
      runId,
      intent,
    },
    title,
    body:
      intent === "failure-lesson"
        ? "Angel 会把这个运行报告提炼为待审失败教训，不会直接发布。"
        : "Angel 会把这个运行报告提炼为待审经验候选，不会直接发布。",
  };
}

function traceProposalExperienceIntent(value, intent, title, missingCopy) {
  const [proposalId] = parseTokens(value);
  if (!proposalId) {
    return missingSlashArgumentIntent(missingCopy);
  }
  return {
    kind: "desktopAction",
    action: {
      type: DESKTOP_ACTIONS.EXPERIENCE_CREATE_FROM_TRACE_PROPOSAL,
      proposalId,
      intent,
    },
    title,
    body:
      intent === "failure-lesson"
        ? "Angel 会把这个 trace proposal 提炼为待审失败教训。"
        : "Angel 会把这个 trace proposal 提炼为待审经验候选。",
  };
}

function resolveRunSlashIntent(args) {
  const { verb, rest } = splitSlashArgs(args);
  if (matchesVerb(verb, ["复盘", "reflect", "reflection"])) {
    return runReflectionIntent(rest, "复盘运行", "/运行 复盘 后面需要放 runId。");
  }
  const runCommandId = resolveRunCommandId(verb);
  if (!runCommandId) {
    return missingSlashArgumentIntent(
      "运行命令需要动作和 runId，例如 /运行 状态 <runId>、/运行 审计 <runId>、/运行 重试 <runId> <assignmentId>。",
    );
  }
  if (runCommandId === "run.retry") {
    const [runId, assignmentId] = parseTokens(rest);
    if (!runId || !assignmentId) {
      return missingSlashArgumentIntent("/运行 重试 后面需要放 runId 和 assignmentId。");
    }
    return commandIntent(
      runCommandId,
      { runId, assignmentId },
      "重试运行 assignment",
      "Angel 会把失败或阻塞的 assignment 交给 run retry。",
    );
  }
  if (runCommandId === "run.approve") {
    const [runId, assignmentId] = parseTokens(rest);
    if (!runId || !assignmentId) {
      return missingSlashArgumentIntent("/运行 批准 后面需要放 runId 和 assignmentId。");
    }
    return commandIntent(
      runCommandId,
      { runId, assignmentId },
      "批准运行 assignment",
      "Angel 会批准 pending operator_approve assignment，让它进入可执行队列或等待依赖。",
    );
  }
  if (runCommandId === "run.approvePending") {
    const [runId] = parseTokens(rest);
    if (!runId) {
      return missingSlashArgumentIntent("/运行 批准全部 后面需要放 runId。");
    }
    return commandIntent(
      runCommandId,
      { runId },
      "批准全部待审 assignment",
      "Angel 会一次批准这个 run 里所有 pending operator_approve assignment。",
    );
  }
  if (runCommandId === "run.reroute") {
    const [runId, assignmentId, adapterId] = parseTokens(rest);
    if (!runId || !assignmentId || !adapterId) {
      return missingSlashArgumentIntent("/运行 切换 后面需要放 runId、assignmentId 和 adapterId。");
    }
    return commandIntent(
      runCommandId,
      { runId, assignmentId, adapterId },
      "切换运行 adapter",
      "Angel 会把指定 assignment 切换到另一个 approved adapter。",
    );
  }
  const [runId] = parseTokens(rest);
  if (!runId) {
    return missingSlashArgumentIntent(`/运行 ${verb} 后面需要放 runId。`);
  }
  return commandIntent(runCommandId, { runId }, "执行运行命令", `Angel 会调用 ${runCommandId}。`);
}

function sharedRunCommandIntent(commandId, args) {
  if (commandId === "run.reflect") {
    return runReflectionIntent(args, "运行反思", "/运行反思 后面需要放 runId。");
  }
  if (commandId === "run.retry") {
    const [runId, assignmentId] = parseTokens(args);
    if (!runId || !assignmentId) {
      return missingSlashArgumentIntent("/运行 重试 后面需要放 runId 和 assignmentId。");
    }
    return commandIntent(
      commandId,
      { runId, assignmentId },
      "重试运行 assignment",
      "Angel 会把失败或阻塞的 assignment 交给 run retry。",
    );
  }
  if (commandId === "run.approve") {
    const [runId, assignmentId] = parseTokens(args);
    if (!runId || !assignmentId) {
      return missingSlashArgumentIntent("/运行 批准 后面需要放 runId 和 assignmentId。");
    }
    return commandIntent(
      commandId,
      { runId, assignmentId },
      "批准运行 assignment",
      "Angel 会批准 pending operator_approve assignment，让它进入可执行队列或等待依赖。",
    );
  }
  if (commandId === "run.approvePending") {
    const [runId] = parseTokens(args);
    if (!runId) {
      return missingSlashArgumentIntent("/运行 批准全部 后面需要放 runId。");
    }
    return commandIntent(
      commandId,
      { runId },
      "批准全部待审 assignment",
      "Angel 会一次批准这个 run 里所有 pending operator_approve assignment。",
    );
  }
  if (commandId === "run.reroute") {
    const [runId, assignmentId, adapterId] = parseTokens(args);
    if (!runId || !assignmentId || !adapterId) {
      return missingSlashArgumentIntent("/运行 切换 后面需要放 runId、assignmentId 和 adapterId。");
    }
    return commandIntent(
      commandId,
      { runId, assignmentId, adapterId },
      "切换运行 adapter",
      "Angel 会把指定 assignment 切换到另一个 approved adapter。",
    );
  }
  const [runId] = parseTokens(args);
  if (!runId) {
    return missingSlashArgumentIntent(`/${commandId} 后面需要放 runId。`);
  }
  return commandIntent(commandId, { runId }, "执行运行命令", `Angel 会调用 ${commandId}。`);
}

function runReflectionIntent(value, title, missingCopy) {
  const [runId] = parseTokens(value);
  if (!runId) {
    return missingSlashArgumentIntent(missingCopy);
  }
  return {
    kind: "desktopAction",
    action: {
      type: DESKTOP_ACTIONS.RUN_REFLECT,
      runId,
    },
    title,
    body: "Angel 会读取真实 run report，生成复盘报告，并把经验或失败教训作为候选等待审查。",
  };
}

function resolveSoulSlashIntent(args) {
  const { verb, rest } = splitSlashArgs(args);
  if (verb.length === 0 || matchesVerb(verb, ["当前", "已发布", "current", "view"])) {
    return {
      kind: "desktopAction",
      action: { type: DESKTOP_ACTIONS.SOUL_VIEW },
      title: "查看 Director Soul",
      body: "Angel 会读取已通过人工审查并发布的 Soul 文档。",
    };
  }
  if (matchesVerb(verb, ["候选", "列表", "list", "ls"])) {
    return {
      kind: "desktopAction",
      action: { type: DESKTOP_ACTIONS.SOUL_LIST },
      title: "查看 Soul 候选",
      body: "Angel 会列出复盘后生成、等待人工审查的 Soul 候选。",
    };
  }
  if (matchesVerb(verb, ["查看", "说明", "解释", "show", "explain", "inspect"])) {
    const candidateId = rest.trim();
    if (candidateId.length === 0) {
      return {
        kind: "desktopAction",
        action: { type: DESKTOP_ACTIONS.SOUL_VIEW },
        title: "查看 Director Soul",
        body: "Angel 会读取已发布的 Soul 文档。",
      };
    }
    return {
      kind: "desktopAction",
      action: { type: DESKTOP_ACTIONS.SOUL_EXPLAIN, candidateId },
      title: "说明 Soul 候选",
      body: "Angel 会读取这个 Soul 候选的改动摘要、证据和风险等级。",
    };
  }
  if (matchesVerb(verb, ["接受", "通过", "accept", "approve"])) {
    return soulDecisionIntent(
      rest,
      DESKTOP_ACTIONS.SOUL_ACCEPT,
      "接受 Soul 候选",
      "/灵魂 接受 后面需要放 candidateId。",
    );
  }
  if (matchesVerb(verb, ["拒绝", "reject", "drop"])) {
    return soulDecisionIntent(
      rest,
      DESKTOP_ACTIONS.SOUL_REJECT,
      "拒绝 Soul 候选",
      "/灵魂 拒绝 后面需要放 candidateId。",
    );
  }
  return missingSlashArgumentIntent(
    "可用灵魂命令：/灵魂、/灵魂 候选、/灵魂 说明 <candidateId>、/灵魂 接受 <candidateId>、/灵魂 拒绝 <candidateId>。",
  );
}

function soulDecisionIntent(value, actionType, title, missingCopy) {
  const [candidateId, ...noteParts] = parseTokens(value);
  if (!candidateId) {
    return missingSlashArgumentIntent(missingCopy);
  }
  return {
    kind: "desktopAction",
    action: {
      type: actionType,
      candidateId,
      ...(noteParts.length === 0 ? {} : { note: noteParts.join(" ") }),
    },
    title,
    body:
      actionType === DESKTOP_ACTIONS.SOUL_ACCEPT
        ? "Angel 会把这个 Soul 候选通过审查，并写入 soul.json 与 SOUL.md。"
        : "Angel 会拒绝这个 Soul 候选，不会污染已发布 Soul。",
  };
}

function resolveHeartbeatSlashIntent(args) {
  const { verb } = splitSlashArgs(args);
  if (matchesVerb(verb, ["反省", "自省", "每日反省", "每日自省", "daily"])) {
    return dailySelfReflectionIntent(args.replace(verb, "").trim());
  }
  if (verb.length === 0 || matchesVerb(verb, ["状态", "查看", "status", "show"])) {
    return {
      kind: "desktopAction",
      action: { type: DESKTOP_ACTIONS.HEARTBEAT_STATUS },
      title: "查看心跳状态",
      body: "Angel 会执行一次本地安全心跳扫描，只写入 heartbeat 事件和 latest，不会自动发布、接受或调用外部制作工具。",
    };
  }
  if (matchesVerb(verb, ["开启", "启用", "enable", "on"])) {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.SETTINGS_SET,
        parameterId: "feature:heartbeat.enabled",
        value: true,
      },
      title: "开启心跳模式",
      body: "Angel 会把 heartbeat.enabled 写入 runtime switches。当前版本仍以安全扫描为主。",
    };
  }
  if (matchesVerb(verb, ["关闭", "禁用", "disable", "off"])) {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.SETTINGS_SET,
        parameterId: "feature:heartbeat.enabled",
        value: false,
      },
      title: "关闭心跳模式",
      body: "Angel 会关闭 heartbeat.enabled；手动 /心跳 状态 仍可进行只读扫描。",
    };
  }
  return missingSlashArgumentIntent("可用心跳命令：/心跳 状态、/心跳 开启、/心跳 关闭。");
}

function dailySelfReflectionIntent(args) {
  const text = typeof args === "string" ? args.trim() : "";
  const date = /^\d{4}-\d{2}-\d{2}$/u.test(text) ? text : undefined;
  return {
    kind: "desktopAction",
    action: {
      type: DESKTOP_ACTIONS.SELF_REFLECTION_DAILY,
      ...(date === undefined ? {} : { date }),
    },
    title: "每日反省",
    body: "Angel 会聚合现有心跳、运行、经验、知识、记忆和维护状态，生成只读自省报告；不会自动发布知识、写入 Soul 或安装 Skill。",
  };
}

function resolveWeixinGatewaySlashIntent(args) {
  const { verb } = splitSlashArgs(args);
  if (verb.length === 0 || matchesVerb(verb, ["状态", "查看", "status", "show"])) {
    return weixinGatewayIntent(
      "status",
      "查看微信网关",
      "Angel 会读取个人微信登录、常驻服务、运行状态和最近日志。",
    );
  }
  if (matchesVerb(verb, ["开启", "启用", "启动", "打开", "start", "enable", "on"])) {
    return weixinGatewayIntent(
      "start",
      "启动微信网关",
      "Angel 会安装或刷新本机 LaunchAgent，并启动个人微信消息网关。",
    );
  }
  if (matchesVerb(verb, ["关闭", "禁用", "停止", "stop", "disable", "off"])) {
    return weixinGatewayIntent(
      "stop",
      "停止微信网关",
      "Angel 会停止本机微信消息网关，并关闭常驻运行。",
    );
  }
  if (matchesVerb(verb, ["重启", "restart", "reload"])) {
    return weixinGatewayIntent(
      "restart",
      "重启微信网关",
      "Angel 会刷新 LaunchAgent 配置并重启个人微信消息网关。",
    );
  }
  return missingSlashArgumentIntent(
    "可用微信网关命令：/微信 状态、/微信 启动、/微信 停止、/微信 重启。",
  );
}

function weixinGatewayIntent(operation, title, body) {
  return {
    kind: "desktopAction",
    action: {
      type: DESKTOP_ACTIONS.WEIXIN_GATEWAY_CONTROL,
      operation,
    },
    title,
    body,
  };
}

function resolveSettingsSlashIntent(args, snapshot) {
  const normalized = args.trim();
  if (normalized.length === 0 || matchesVerb(normalized, ["查看", "列表", "show", "list", "ls"])) {
    return commandIntent(
      "workspace.switches",
      {},
      "查看设置",
      "Angel 会读取运行时功能开关和本地配置状态。",
    );
  }

  const parsed = parseSettingsSetArgs(normalized, snapshot);
  if (!parsed) {
    return missingSlashArgumentIntent(
      "设置命令格式：/设置 learning.enabled 开启，或 /设置 feature:learning.enabled 关闭。",
    );
  }

  return {
    kind: "desktopAction",
    action: {
      type: parsed.parameterId.startsWith("comfyui:")
        ? DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE
        : DESKTOP_ACTIONS.SETTINGS_SET,
      ...(parsed.parameterId.startsWith("comfyui:")
        ? {
            toolId: "comfyui",
            operation: "update",
            settings: {
              [parsed.parameterId.split(":").slice(1).join(":")]: parsed.value,
            },
          }
        : { parameterId: parsed.parameterId }),
      ...(parsed.parameterId.startsWith("comfyui:") ? {} : { value: parsed.value }),
    },
    title: "更新设置",
    body: `${parsed.parameterId} 将被${parsed.value ? "开启" : "关闭"}；Angel 会写入 runtime switches.json。`,
  };
}

function resolveApiProviderSlashIntent(args) {
  const { verb, rest } = splitSlashArgs(args);
  if (verb.length === 0 || matchesVerb(verb, ["查看", "列表", "show", "list", "ls"])) {
    return {
      kind: "snapshot",
      title: "查看 API 供应方",
      body: "Angel 会刷新本地 snapshot，设置页会显示供应方、密钥状态、默认模型和 POST 路径。",
    };
  }

  if (matchesVerb(verb, ["启用", "开启", "enable", "on"])) {
    const [providerId] = parseTokens(rest);
    return providerBooleanIntent(providerId, true, "/供应方 启用 后面需要放 providerId。");
  }

  if (matchesVerb(verb, ["禁用", "关闭", "disable", "off"])) {
    const [providerId] = parseTokens(rest);
    return providerBooleanIntent(providerId, false, "/供应方 禁用 后面需要放 providerId。");
  }

  if (matchesVerb(verb, ["密钥", "key", "apikey", "apiKey"])) {
    const [providerId, ...valueParts] = parseTokens(rest);
    return providerSetIntent(
      providerId,
      "apiKey",
      valueParts.join(" "),
      "/供应方 密钥 后面需要放 providerId 和 API key。",
    );
  }

  if (matchesVerb(verb, ["模型", "model"])) {
    const [providerId, modelKind, ...valueParts] = parseTokens(rest);
    const key = resolveProviderModelSettingKey(modelKind);
    if (!key) {
      return missingSlashArgumentIntent(
        "/供应方 模型 格式：/供应方 模型 memefast-api text|vision|image|video 模型名。",
      );
    }
    return providerSetIntent(
      providerId,
      key,
      valueParts.join(" "),
      "/供应方 模型 后面需要放 providerId、模型类型和模型名。",
    );
  }

  if (matchesVerb(verb, ["同步", "sync", "刷新", "refresh"])) {
    const [providerId] = parseTokens(rest);
    if (!providerId) {
      return missingSlashArgumentIntent("/供应方 同步 后面需要放 providerId。");
    }
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.API_PROVIDER_SYNC_MODELS,
        providerId,
      },
      title: "同步 API 供应方模型池",
      body: `${providerId} 会同步公开模型元数据和账号可见模型；密钥只在本地 provider 配置中使用，结果不会明文显示。`,
    };
  }

  if (matchesVerb(verb, ["设置", "set", "配置", "config"])) {
    const [providerId, keyAlias, ...valueParts] = parseTokens(rest);
    const key = resolveProviderSettingKey(keyAlias);
    if (!key) {
      return missingSlashArgumentIntent(
        "/供应方 设置 格式：/供应方 设置 memefast-api baseUrl|apiKey|models|defaultTextModel|defaultImageModel|defaultVideoModel 值。",
      );
    }
    return providerSetIntent(
      providerId,
      key,
      valueParts.join(" "),
      "/供应方 设置 后面需要放 providerId、参数名和值。",
    );
  }

  return missingSlashArgumentIntent(
    "可用供应方命令：/供应方、/供应方 密钥 memefast-api <key>、/供应方 同步 memefast-api、/供应方 设置 memefast-api baseUrl <url>、/供应方 设置 memefast-api models <模型清单>、/供应方 启用 memefast-api、/供应方 禁用 memefast-api。",
  );
}

function apiProviderTestIntent(value) {
  const [providerId] = parseTokens(value);
  if (!providerId) {
    return missingSlashArgumentIntent("/测试供应方 后面需要放 providerId。");
  }
  return {
    kind: "desktopAction",
    action: {
      type: DESKTOP_ACTIONS.API_PROVIDER_TEST,
      providerId,
    },
    title: "测试 API 供应方",
    body: "Angel 会调用已保存的供应方配置测试连接和模型可用性。",
  };
}

function providerModelSettingIntent(modelKind, value) {
  const [providerId, ...modelParts] = parseTokens(value);
  const key = resolveProviderModelSettingKey(modelKind);
  if (!key || !providerId || modelParts.length === 0) {
    return missingSlashArgumentIntent(
      modelKind === "image"
        ? "/设置 图片模型 后面需要放 providerId 和模型名。"
        : "/设置 文本模型 后面需要放 providerId 和模型名。",
    );
  }
  return providerSetIntent(
    providerId,
    key,
    modelParts.join(" "),
    modelKind === "image"
      ? "/设置 图片模型 后面需要放 providerId 和模型名。"
      : "/设置 文本模型 后面需要放 providerId 和模型名。",
  );
}

function resolveMemorySlashIntent(args) {
  const { verb, rest } = splitSlashArgs(args);
  if (verb.length === 0 || matchesVerb(verb, ["状态", "status"])) {
    return commandIntent(
      "memory.status",
      {},
      "查看记忆状态",
      "Angel 会读取 Director memory lane 状态。",
    );
  }
  if (matchesVerb(verb, ["召回", "recall"])) {
    return memoryRecallPreviewIntent(rest);
  }
  if (matchesVerb(verb, ["查看", "inspect", "show"])) {
    if (rest.length === 0) {
      return missingSlashArgumentIntent("/记忆 查看 后面需要放 sessionId。");
    }
    return commandIntent(
      "control.memoryInspect",
      { sessionId: rest },
      "查看会话记忆",
      "Angel 会通过 control-plane 检查这个 session 的工作记忆。",
    );
  }
  if (matchesVerb(verb, ["清理", "清空", "clear"])) {
    if (rest.length === 0) {
      return missingSlashArgumentIntent("/记忆 清理 后面需要放 sessionId。");
    }
    return commandIntent(
      "control.memoryClear",
      { sessionId: rest, scope: "working" },
      "清理会话记忆",
      "Angel 会通过 control-plane 清理这个 session 的工作记忆。",
    );
  }
  return missingSlashArgumentIntent(
    "可用记忆命令：/记忆 状态、/记忆 召回 <项目|标签>、/记忆 查看 <sessionId>、/记忆 清理 <sessionId>。",
  );
}

function resolveMaintenanceSlashIntent(args) {
  const { verb, rest } = splitSlashArgs(args);
  if (verb.length === 0 || matchesVerb(verb, ["预览", "查看", "状态", "preview", "status"])) {
    return {
      kind: "desktopAction",
      action: { type: DESKTOP_ACTIONS.MAINTENANCE_PREVIEW, ...parseMaintenanceSlashOptions(rest) },
      title: "维护预览",
      body: "Angel 会预览旧日志和低价值经验资料的归档清单，不会移动文件。",
    };
  }
  if (matchesVerb(verb, ["执行", "应用", "确认", "清理", "apply", "run", "clean"])) {
    return {
      kind: "desktopAction",
      action: { type: DESKTOP_ACTIONS.MAINTENANCE_APPLY, ...parseMaintenanceSlashOptions(rest) },
      title: "执行维护",
      body: "Angel 会按维护策略归档旧日志和低价值经验资料，并写入审计报告。",
    };
  }
  return {
    kind: "desktopAction",
    action: { type: DESKTOP_ACTIONS.MAINTENANCE_PREVIEW, ...parseMaintenanceSlashOptions(args) },
    title: "维护预览",
    body: "Angel 会预览旧日志和低价值经验资料的归档清单，不会移动文件。",
  };
}

function resolveExperienceAcceptIntent(snapshot, explicitCandidateId = "") {
  const candidateId = explicitCandidateId.trim() || snapshot?.candidate?.id;
  if (candidateId && (explicitCandidateId.trim() || snapshot?.candidate?.status === "pending")) {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.EXPERIENCE_ACCEPT,
        candidateId,
      },
      title: "接受经验候选",
      body: "Angel 会接受当前候选经验，但仍不会直接发布。",
    };
  }
  return missingReviewTargetIntent("当前没有可接受的经验候选。");
}

function resolveExperiencePromoteIntent(snapshot, explicitCandidateId = "") {
  const candidateId = explicitCandidateId.trim() || snapshot?.candidate?.id;
  if (candidateId && (explicitCandidateId.trim() || snapshot?.candidate?.status === "accepted")) {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.EXPERIENCE_PROMOTE,
        candidateId,
      },
      title: "晋升知识候选",
      body: "Angel 会把已接受经验晋升为知识候选。",
    };
  }
  return missingReviewTargetIntent("当前没有可晋升的已接受经验。");
}

function resolveKnowledgeAcceptIntent(snapshot, explicitPackId = "") {
  const packId = explicitPackId.trim() || snapshot?.knowledge?.candidateId;
  if (packId && (explicitPackId.trim() || snapshot?.knowledge?.candidateStatus === "pending")) {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.KNOWLEDGE_ACCEPT,
        packId,
      },
      title: "接受知识候选",
      body: "Angel 会把当前知识候选标记为已接受，发布前仍保留审查门禁。",
    };
  }
  return missingReviewTargetIntent("当前没有可接受的知识候选。");
}

function resolveKnowledgePublishIntent(snapshot, explicitPackId = "") {
  const packId = explicitPackId.trim() || snapshot?.knowledge?.candidateId;
  if (packId && (explicitPackId.trim() || snapshot?.knowledge?.candidateStatus === "accepted")) {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.KNOWLEDGE_PUBLISH,
        packId,
      },
      title: "发布知识",
      body: "Angel 会发布已接受知识包，允许运行时召回。",
    };
  }
  return missingReviewTargetIntent("当前没有可发布的已接受知识候选。");
}

function learningSourceIntent(value) {
  const embeddedHttpUrl = extractFirstHttpUrl(value);
  const mixedWithProduction = hasMixedLearningProductionIntent(value);
  if (embeddedHttpUrl !== null) {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
        url: embeddedHttpUrl,
        privacy: "public",
      },
      title: "理解为：从 URL 学习",
      body: mixedWithProduction
        ? "Angel 会先抓取这个链接生成待审经验候选；学习完成后再用 /制作 或直接描述制作目标继续。"
        : "Angel 会抓取这个链接的正文，并生成需要审查的经验候选。",
    };
  }
  const localSource = extractFirstLocalSource(value);
  if (localSource !== null) {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_DIRECTORY,
        directory: localSource,
        privacy: "confidential",
      },
      title: "理解为：学习本地资料",
      body: mixedWithProduction
        ? "Angel 会先读取这个文件或目录生成待审经验候选；学习完成后再用 /制作 或直接描述制作目标继续。"
        : "Angel 会读取这个文件或目录，并先生成候选经验等待审查。",
    };
  }
  if (looksLikePastedLearningText(value)) {
    const text = extractPastedLearningText(value);
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_TEXT,
        text,
        title: extractPastedLearningTitle(text),
        privacy: "internal",
      },
      title: "理解为：从粘贴文本学习",
      body: "Angel 会把这段原文保存为来源快照，再提炼成需要审查的经验候选。",
    };
  }
  return learningTopicIntent(value);
}

function shouldAdmitNaturalLearningPrompt(prompt) {
  return shouldAdmitChannelNaturalLearningPrompt(prompt, {
    hasAdditionalLearningSource: looksLikePastedLearningText(prompt),
  });
}

function hasLearningAdmissionSource(value) {
  return hasChannelLearningAdmissionSource(value) || looksLikePastedLearningText(value);
}

function shouldCreateLearningCandidateFromNaturalSource(value) {
  const text = normalizePrompt(value);
  if (hasExplicitReadOnlyLearningConstraint(text)) {
    return false;
  }
  if (/^\/\s*(?:学习|learn|吸收|研究|资料)(?:\s|$)/iu.test(text)) {
    return true;
  }
  if (extractFirstHttpUrl(text) !== null && isPlainNaturalUrlLearningPersistencePrompt(text)) {
    return true;
  }
  if (hasMixedLearningProductionIntent(text)) {
    return true;
  }
  return /(?:保存|收录|记录|沉淀|写入|加入|放进|存到|存入).{0,12}(?:经验|知识|资料|记忆|候选|经验库|知识库)|(?:生成|创建|建立|新建).{0,8}(?:经验|知识|候选)|(?:变成|做成|转成|整理成|提炼成).{0,8}(?:经验|知识|候选)|(?:经验|知识).{0,8}(?:沉淀|收录|入库|候选|保存|记录)/u.test(
    text,
  );
}

function hasExplicitReadOnlyLearningConstraint(text) {
  return (
    /不要(?:创建|生成|保存|收录|沉淀|写入).{0,8}(?:候选|经验|知识|记忆)|(?:不要|别|先别).{0,8}(?:说|当成).{0,8}(?:学到|学到了)|(?:不要|别|不必|不用|无需|禁止|不能).{0,32}(?:入库|保存|收录|沉淀|写入|创建候选|生成候选|候选|经验|知识)|只(?:告诉|给).{0,8}(?:我)?(?:结果|结论|正文|摘要)|(?:直接|只|仅).{0,8}(?:读取|打开|看看|总结|告诉|回答|回复|提取)/u.test(
      text,
    ) || isEvidenceOnlyLearningFollowupConstraint(text)
  );
}

function isEvidenceOnlyLearningFollowupConstraint(text) {
  return (
    /(?:看详情|只基于|仅基于|基于刚才|基于上一轮|基于上次|刚才|上一轮|上次|学习结果).{0,80}(?:证据字段|全文字符数|正文字符数|是否二次提取|二次提取|是否已入库|媒体是否(?:已)?理解|图片\/视频\/音频|poster|blob|full_body|fullBody)/iu.test(
      text,
    ) ||
    /(?:证据字段|全文字符数|正文字符数|是否二次提取|二次提取|是否已入库|媒体是否(?:已)?理解|图片\/视频\/音频|poster|blob|full_body|fullBody).{0,80}(?:看详情|只基于|仅基于|基于刚才|基于上一轮|基于上次|刚才|上一轮|上次|学习结果)/iu.test(
      text,
    )
  );
}

function isPlainNaturalUrlLearningPersistencePrompt(text) {
  const asksToLearn =
    /(?:学习|吸收|研究|收录|保存|记录|沉淀|整理|提炼|入库|归档|收入|写入).{0,24}(?:链接|URL|url|帖子|推文|文章|资料|内容|网页|经验|知识|候选|库|X|Twitter|twitter|微信|公众号|小红书|B站)/iu.test(
      text,
    ) ||
    /(?:链接|URL|url|帖子|推文|文章|资料|内容|网页|X|Twitter|twitter|微信|公众号|小红书|B站).{0,24}(?:学习|吸收|研究|收录|保存|记录|沉淀|整理|提炼|入库|归档|收入|写入)/iu.test(
      text,
    );
  const asksToPersist =
    /(?:保存|收录|记录|沉淀|写入|加入|放进|存到|存入|入库|归档|收入).{0,16}(?:经验|知识|资料|记忆|候选|经验库|知识库)|(?:生成|创建|建立|新建).{0,12}(?:经验|知识|候选)|(?:变成|做成|转成|整理成|提炼成).{0,12}(?:经验|知识|候选)/iu.test(
      text,
    );
  return asksToLearn || asksToPersist;
}

function learningTopicIntent(query) {
  return {
    kind: "desktopAction",
    action: {
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_QUERY,
      query,
      privacy: "public",
      maxResultsPerQuery: 5,
    },
    title: "理解为：从网页主题学习",
    body: "Angel 会把这个主题变成候选经验，进入审查后才能沉淀。",
  };
}

function looksLikePastedLearningText(value) {
  const text = extractPastedLearningText(value);
  if (text.length >= 600) {
    return true;
  }
  const lines = text.split(/\n/u).filter((line) => line.trim().length > 0);
  return lines.length >= 2 && text.length >= 40;
}

function extractPastedLearningText(value) {
  return extractLearningAdmissionText(normalizePrompt(value));
}

function extractPastedLearningTitle(text) {
  const firstLine = text
    .split(/\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return "粘贴文本";
  }
  return firstLine.length <= 80 ? firstLine : firstLine.slice(0, 80);
}

function knowledgeRecallIntent() {
  return {
    kind: "desktopAction",
    action: { type: DESKTOP_ACTIONS.KNOWLEDGE_RECALL_PREVIEW },
    title: "预览知识召回",
    body: "Angel 会检查已发布经验能否被运行时召回。",
  };
}

function knowledgeExplainIntent(value) {
  const packId = value.trim();
  if (packId.length === 0) {
    return missingSlashArgumentIntent("/知识 说明 后面需要放 packId。");
  }
  return commandIntent(
    "knowledge.explain",
    { packId },
    "解释知识包",
    "Angel 会通过本地 CLI 查看这个已发布知识包。",
  );
}

function knowledgeDiffIntent(value) {
  const [leftId, rightId] = parseTokens(value);
  if (!leftId || !rightId) {
    return missingSlashArgumentIntent("/知识 对比 后面需要放 leftId 和 rightId。");
  }
  return commandIntent(
    "knowledge.diff",
    { leftId, rightId },
    "查看知识差异",
    "Angel 会比较两个知识候选或版本的差异。",
  );
}

function knowledgeRollbackIntent(value) {
  const [packId, version] = parseTokens(value);
  if (!packId) {
    return missingSlashArgumentIntent("/知识 回滚 后面需要放 knowledgeId 或 packageId。");
  }
  return commandIntent(
    "knowledge.rollback",
    withoutUndefined({ packId, version }),
    "回滚知识",
    "Angel 会把知识回滚请求交给本地 CLI，并保留审计记录。",
  );
}

function memoryRecallPreviewIntent(value) {
  const query = value.trim();
  if (query.length === 0) {
    return missingSlashArgumentIntent("/记忆 召回 后面需要放项目、标签或查询条件。");
  }
  return commandIntent(
    "memory.recallPreview",
    { query },
    "预览记忆召回",
    "Angel 会预览当前查询会命中的运行记忆，不写入长期记忆。",
  );
}

function imageGenerationIntent(prompt) {
  const normalized = prompt.trim();
  if (normalized.length === 0) {
    return missingSlashArgumentIntent(
      "/图片 后面需要放生成提示词，例如：/图片 赛博朋克风格的导演工作台。",
    );
  }
  return {
    kind: "desktopAction",
    action: {
      type: DESKTOP_ACTIONS.API_PROVIDER_IMAGE,
      prompt: normalized,
    },
    title: "调用图片生成供应方",
    body: "Angel 会通过已配置 API 供应方的图片生成 POST 路径真实生成图片。",
  };
}

function videoGenerationIntent(prompt) {
  const normalized = prompt.trim();
  if (normalized.length === 0) {
    return missingSlashArgumentIntent(
      "/视频 后面需要放生成提示词，例如：/视频 电影感导演工作台 5 秒。",
    );
  }
  return {
    kind: "desktopAction",
    action: {
      type: DESKTOP_ACTIONS.API_PROVIDER_VIDEO,
      prompt: normalized,
    },
    title: "调用视频生成供应方",
    body: "Angel 会通过已配置 API 供应方的视频生成任务路径真实生成视频，并进入任务运行中心。",
  };
}

function resolveComfyUiSlashIntent(args, workbenchConversation) {
  const normalized = args.trim();
  const { verb } = splitSlashArgs(normalized);
  if (
    matchesVerb(verb, [
      "打开",
      "打开界面",
      "界面",
      "前端",
      "控制台",
      "open",
      "ui",
      "web",
      "browser",
    ])
  ) {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.COMFYUI_OPEN,
      },
      title: "打开 ComfyUI 界面",
      body: "Angel 会打开已配置的 ComfyUI Web 界面，不会提交 workflow。",
    };
  }
  if (matchesVerb(verb, ["测试", "连通", "连接", "状态", "test", "status", "ping"])) {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.COMFYUI_TEST,
      },
      title: "测试 ComfyUI 连接",
      body: "Angel 会检查已配置 ComfyUI 服务是否可访问，不会提交 workflow。",
    };
  }
  const lifecycleAction = parseComfyUiLifecycleVerb(verb);
  if (lifecycleAction !== null) {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.COMFYUI_LIFECYCLE,
        action: lifecycleAction,
      },
      title: "控制 ComfyUI 生命周期",
      body: "Angel 会通过外部工具总线和 comfy-cli 控制本机 ComfyUI，需要受控执行记录。",
    };
  }
  if (matchesVerb(verb, ["修复依赖", "依赖修复", "修复", "fix-deps", "fix_dependencies"])) {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.COMFYUI_FIX_DEPENDENCIES,
        dryRun: true,
      },
      title: "检查 ComfyUI 依赖修复",
      body: "Angel 会生成缺节点/缺模型修复计划；缺模型不会猜 URL，执行前需要确认。",
    };
  }
  const createWorkflow = parseComfyUiCreateWorkflowArgs(normalized);
  if (createWorkflow) {
    if (createWorkflow.objective.length === 0) {
      return missingSlashArgumentIntent(
        "/ComfyUI 脚本 后面需要写目标，例如：/ComfyUI 脚本+图片+视频 一个小猪学习游泳的30秒故事。",
      );
    }
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.COMFYUI_CREATE_WORKFLOW,
        workflowKind: createWorkflow.workflowKind,
        workflowModes: createWorkflow.workflowModes,
        objective: withRecentDesktopContext({
          context: workbenchConversation,
          text: createWorkflow.objective,
        }),
      },
      title: "创建 ComfyUI 完整工作流",
      body: "Angel 会先生成内容和参数，再同步为 ComfyUI 节点画布；不会把连通性验证当成生成结果。",
    };
  }
  return comfyUiRunIntent(
    withRecentDesktopContext({
      context: workbenchConversation,
      text: normalized,
    }),
  );
}

function parseComfyUiCreateWorkflowArgs(value) {
  return parseDirectorComfyUiWorkflowDraftIntent(value);
}

function parseComfyUiLifecycleVerb(verb) {
  if (matchesVerb(verb, ["启动", "开启", "launch", "start"])) {
    return "start";
  }
  if (matchesVerb(verb, ["停止", "关闭", "stop"])) {
    return "stop";
  }
  if (matchesVerb(verb, ["重启", "重新启动", "restart", "relaunch"])) {
    return "restart";
  }
  return null;
}

function comfyUiRunIntent(prompt) {
  const normalized = prompt.trim();
  if (normalized.length === 0) {
    return missingSlashArgumentIntent(
      "/comfyui 后面需要放提示词，或使用 /comfyui 打开界面、/comfyui 测试。",
    );
  }
  return {
    kind: "desktopAction",
    action: {
      type: DESKTOP_ACTIONS.COMFYUI_RUN,
      prompt: normalized,
    },
    title: "调用 ComfyUI",
    body: "Angel 会通过已配置的 ComfyUI 外部工具提交 workflow，不配置 workflow 时不会伪造生成结果。",
  };
}

function providerBooleanIntent(providerId, value, missingCopy) {
  if (!providerId) {
    return missingSlashArgumentIntent(missingCopy);
  }
  return {
    kind: "desktopAction",
    action: {
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId,
      key: "enabled",
      value,
    },
    title: "更新 API 供应方",
    body: `${providerId} 将被${value ? "启用" : "禁用"}；Angel 会写入本地 provider 配置。`,
  };
}

function providerSetIntent(providerId, key, value, missingCopy) {
  if (!providerId || value.trim().length === 0) {
    return missingSlashArgumentIntent(missingCopy);
  }
  return {
    kind: "desktopAction",
    action: {
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId,
      key,
      value: value.trim(),
    },
    title: "更新 API 供应方",
    body: `${providerId} 的 ${key} 将写入本地 provider 配置；密钥只会在 snapshot 中脱敏显示。`,
  };
}

function resolveProviderSettingKey(value) {
  const normalized = value?.toLowerCase();
  const aliases = {
    enabled: "enabled",
    on: "enabled",
    apikey: "apiKey",
    key: "apiKey",
    secret: "apiKey",
    baseurl: "baseUrl",
    url: "baseUrl",
    models: "models",
    modellist: "models",
    模型清单: "models",
    模型列表: "models",
    defaulttextmodel: "defaultTextModel",
    text: "defaultTextModel",
    defaultvisionmodel: "defaultVisionModel",
    vision: "defaultVisionModel",
    defaultimagemodel: "defaultImageModel",
    image: "defaultImageModel",
    defaultvideomodel: "defaultVideoModel",
    video: "defaultVideoModel",
  };
  return aliases[normalized] ?? null;
}

function resolveProviderModelSettingKey(value) {
  const normalized = value?.toLowerCase();
  const aliases = {
    text: "defaultTextModel",
    文本: "defaultTextModel",
    vision: "defaultVisionModel",
    视觉: "defaultVisionModel",
    image: "defaultImageModel",
    图片: "defaultImageModel",
    video: "defaultVideoModel",
    视频: "defaultVideoModel",
  };
  return aliases[normalized] ?? null;
}

function parseSettingsSetArgs(args, snapshot) {
  const assignment = args.match(/^([^=\s]+)\s*=\s*(\S+)$/u);
  if (assignment) {
    const value = parseSettingsBooleanValue(assignment[2]);
    const parameterId = normalizeSettingsParameterId(assignment[1], snapshot);
    return value === null || parameterId === null ? null : { parameterId, value };
  }

  const tokens = args.split(/\s+/u).filter(Boolean);
  const valueIndex = tokens.findIndex((token) => parseSettingsBooleanValue(token) !== null);
  if (valueIndex < 0) {
    return null;
  }
  const value = parseSettingsBooleanValue(tokens[valueIndex]);
  const parameter = [...tokens.slice(0, valueIndex), ...tokens.slice(valueIndex + 1)].join(" ");
  const parameterId = normalizeSettingsParameterId(parameter, snapshot);

  return value === null || parameterId === null ? null : { parameterId, value };
}

function parseSettingsBooleanValue(value) {
  if (matchesVerb(value, ["开启", "打开", "启用", "开", "on", "enable", "enabled", "true", "1"])) {
    return true;
  }
  if (
    matchesVerb(value, ["关闭", "关", "停用", "禁用", "off", "disable", "disabled", "false", "0"])
  ) {
    return false;
  }
  return null;
}

function normalizeSettingsParameterId(value, snapshot) {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }

  const parameters = snapshot?.assets?.settings?.parameters ?? [];
  const exact = parameters.find((parameter) => parameter.id === normalized);
  if (exact) {
    return exact.writable && /^(feature|role|adapter|gateway|comfyui):\S+$/u.test(exact.id)
      ? exact.id
      : null;
  }
  if (/^(feature|role|adapter|gateway|comfyui):\S+$/u.test(normalized)) {
    return normalized;
  }

  const lower = normalized.toLowerCase();
  const byLabelOrKey = parameters.find((parameter) => {
    const idSuffix = parameter.id.includes(":") ? parameter.id.split(":").slice(1).join(":") : "";
    return (
      parameter.writable &&
      /^(feature|role|adapter|gateway|comfyui):\S+$/u.test(parameter.id) &&
      (parameter.label?.toLowerCase() === lower || idSuffix.toLowerCase() === lower)
    );
  });

  return byLabelOrKey?.id ?? null;
}

function adapterIdIntent(value, commandId, title, missingCopy) {
  const adapterId = value.trim();
  if (adapterId.length === 0) {
    return missingSlashArgumentIntent(missingCopy);
  }
  return commandIntent(commandId, { adapterId }, title, "Angel 会把 adapterId 交给本地 CLI 执行。");
}

function taskProposalIntent(value, commandId, title, missingCopy) {
  const [sessionId, proposalId, ...noteParts] = parseTokens(value);
  if (!sessionId || !proposalId) {
    return missingSlashArgumentIntent(missingCopy);
  }
  return commandIntent(
    commandId,
    withoutUndefined({
      sessionId,
      proposalId,
      note: noteParts.length > 0 ? noteParts.join(" ") : undefined,
    }),
    title,
    "Angel 会把这条 Skill proposal 命令交给本地 task CLI。",
  );
}

function traceProposalIntent(value, commandId, title, missingCopy) {
  const [proposalId, ...noteParts] = parseTokens(value);
  if (!proposalId) {
    return missingSlashArgumentIntent(missingCopy);
  }
  return commandIntent(
    commandId,
    withoutUndefined({
      proposalId,
      note: noteParts.length > 0 ? noteParts.join(" ") : undefined,
    }),
    title,
    "Angel 会把这条 trace proposal 命令交给本地 CLI。",
  );
}

function resolveRunCommandId(verb) {
  return resolveChannelRunCommandIdFromVerb(verb);
}

function parseTokens(value) {
  return value.split(/\s+/u).filter(Boolean);
}

function extractFirstIdentifier(value, pattern) {
  const match = pattern.exec(value);
  return match ? stripTrailingIdentifierPunctuation(match[0]) : "";
}

function stripTrailingIdentifierPunctuation(value) {
  return value.replace(/[)\]}>,.;:!?，。；：！？、]+$/u, "");
}

function extractProviderId(value) {
  const ignored = new Set([
    "api",
    "provider",
    "test",
    "check",
    "verify",
    "测试",
    "检查",
    "验证",
    "供应方",
    "供应商",
    "模型供应",
  ]);
  return (
    parseTokens(value)
      .map((token) => stripTrailingIdentifierPunctuation(token))
      .find(
        (token) => /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(token) && !ignored.has(token.toLowerCase()),
      ) ?? ""
  );
}

function normalizeTokenList(values) {
  return values
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function withoutUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function commandIntent(commandId, args, title, body) {
  void body;
  return {
    kind: "command",
    commandId,
    args,
    title,
    body: renderConversationRuntimeStructuredStatusText({
      title: "Desktop command state:",
      status: "parsed",
      reason: "local slash command was parsed and routed without model synthesis",
      detail: `command: ${commandId}\nargs: ${JSON.stringify(args ?? {})}`,
    }),
  };
}

function productionTaskIntent(prompt, options = {}) {
  const workflowType = normalizeProductionWorkflowType(
    options.workflowType ?? inferProductionWorkflowType("", prompt),
  );
  return {
    kind: "desktopAction",
    action: {
      type: DESKTOP_ACTIONS.PRODUCTION_START,
      prompt: prompt.trim(),
      createRun: true,
      workflowType,
    },
    title: "理解为：启动制作任务",
    body: renderConversationRuntimeStructuredStatusText({
      title: "Desktop production state:",
      status: "routed",
      reason: "production output must come from the shared production runtime",
      detail: `workflow: ${workflowType}`,
      nextAction: "wait for runtime final text or a degraded production status",
    }),
  };
}

function inferProductionWorkflowType(name, prompt = "") {
  const haystack = `${name} ${prompt}`.trim();
  if (/文案|口播|copywriting|copy\b/iu.test(haystack)) {
    return "copywriting";
  }
  if (/脚本|剧本|script|screenplay/iu.test(haystack)) {
    return "script";
  }
  return "storyboard";
}

function normalizeProductionWorkflowType(value) {
  return ["script", "copywriting", "storyboard"].includes(value) ? value : "storyboard";
}

function missingSlashArgumentIntent(body) {
  return {
    kind: "snapshot",
    title: "需要补充 /能力 参数",
    body,
  };
}

function slashUsageIntent() {
  return {
    kind: "snapshot",
    title: "可用 /能力",
    body: "/制作、/脚本、/文案、/学习、/经验、/知识、/技能、/工具、/供应方、/审查、/运行、/复盘、/灵魂、/心跳、/维护、/微信、/设置、/记忆、/诊断、/状态。",
  };
}

function unknownSlashIntent(prompt) {
  return {
    kind: "snapshot",
    title: "未识别的 /能力",
    body: `没有找到 ${prompt.split(/\s+/u)[0]}；可用：/制作、/学习、/经验、/知识、/技能、/工具、/供应方、/审查、/运行、/复盘、/灵魂、/心跳、/维护、/微信、/设置、/记忆、/诊断、/状态。`,
  };
}

function resolveNextReviewIntent(snapshot) {
  if (!snapshot) {
    return null;
  }
  if (snapshot.knowledge?.candidateStatus === "accepted" && snapshot.knowledge?.candidateId) {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.KNOWLEDGE_PUBLISH,
        packId: snapshot.knowledge.candidateId,
      },
      title: "理解为：发布知识",
      body: "当前知识候选已接受，下一步是发布到运行时召回。",
    };
  }
  if (snapshot.knowledge?.candidateStatus === "pending" && snapshot.knowledge?.candidateId) {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.KNOWLEDGE_ACCEPT,
        packId: snapshot.knowledge.candidateId,
      },
      title: "理解为：接受知识候选",
      body: "Angel 会把当前知识候选标记为已接受，发布前仍保留审查门禁。",
    };
  }
  if (snapshot.candidate?.status === "accepted" && snapshot.candidate?.id) {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.EXPERIENCE_PROMOTE,
        candidateId: snapshot.candidate.id,
      },
      title: "理解为：晋升知识",
      body: "当前经验已接受，Angel 会把它晋升为知识候选。",
    };
  }
  if (snapshot.candidate?.status === "pending" && snapshot.candidate?.id) {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.EXPERIENCE_ACCEPT,
        candidateId: snapshot.candidate.id,
      },
      title: "理解为：接受经验候选",
      body: "Angel 会接受当前候选经验，但仍不会直接发布。",
    };
  }
  const currentRunIntent = resolveCurrentRunActionIntent(snapshot);
  if (currentRunIntent) {
    return currentRunIntent;
  }
  if ((snapshot.knowledge?.publishedCount ?? 0) > 0) {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.KNOWLEDGE_RECALL_PREVIEW,
      },
      title: "理解为：预览知识召回",
      body: "Angel 会检查已发布经验能否被运行时召回。",
    };
  }
  return null;
}

function resolveCurrentRunActionIntent(snapshot, options = {}) {
  const run = selectActionableRun(snapshot, options);
  if (!run?.runId) {
    return null;
  }

  const approvableCount = countApprovableRunAssignments(run);
  if (approvableCount > 0) {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.RUN_CONTINUE,
        runId: run.runId,
      },
      title: "理解为：批准待审制作任务",
      body: `当前制作运行 ${run.runId} 有 ${approvableCount} 个待人工批准 assignment；Angel 会批准后继续推进到完成或下一个卡点。`,
    };
  }

  if (options.requireApproval) {
    return null;
  }

  if (run.status === "created") {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.RUN_CONTINUE,
        runId: run.runId,
      },
      title: "理解为：启动制作运行",
      body: `当前制作运行 ${run.runId} 已创建但未启动；Angel 会启动并推进到完成或下一个卡点。`,
    };
  }

  if (isActiveRunStatus(run.status)) {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.RUN_CONTINUE,
        runId: run.runId,
      },
      title: "理解为：推进制作运行",
      body: `当前制作运行 ${run.runId} 正在进行；Angel 会继续推进到完成或下一个卡点。`,
    };
  }

  if (["failed", "blocked", "completed", "aborted"].includes(run.status)) {
    return commandIntent(
      "run.report",
      { runId: run.runId },
      "理解为：查看运行报告",
      `当前制作运行 ${run.runId} 状态为 ${run.status}；Angel 会读取真实运行报告。`,
    );
  }

  return null;
}

function nextStepGuidanceIntent(snapshot) {
  const runIntent = resolveCurrentRunActionIntent(snapshot);
  if (runIntent) {
    return {
      kind: "snapshot",
      title: "下一步建议",
      body: formatNextStepCommandSuggestion(runIntent),
    };
  }

  const reviewIntent = resolveNextReviewIntent(snapshot);
  if (reviewIntent) {
    return {
      kind: "snapshot",
      title: "下一步建议",
      body: formatNextStepCommandSuggestion(reviewIntent),
    };
  }

  return {
    kind: "snapshot",
    title: "下一步建议",
    body: "现在可以直接输入：学习一个链接/本地目录，或 /制作 生成一个15秒短剧分镜蓝图。Angel 会自动调用对应能力，不需要去别的页面填表。",
  };
}

function formatNextStepCommandSuggestion(intent) {
  if (intent.kind === "command") {
    return `建议执行：${formatCommandSuggestion(intent.commandId, intent.args)}。${intent.body}`;
  }
  if (intent.kind === "desktopAction") {
    return `建议执行：${formatDesktopActionSuggestion(intent.action)}。${intent.body}`;
  }
  return intent.body;
}

function formatCommandSuggestion(commandId, args = {}) {
  if (commandId === "run.approvePending" && args.runId) {
    return `/运行 批准全部 ${args.runId}`;
  }
  if (commandId === "run.start" && args.runId) {
    return `/运行 启动 ${args.runId}`;
  }
  if (commandId === "run.once" && args.runId) {
    return `/运行 推进 ${args.runId}`;
  }
  if (commandId === "run.report" && args.runId) {
    return `/运行 报告 ${args.runId}`;
  }
  return commandId;
}

function formatDesktopActionSuggestion(action) {
  if (action.type === DESKTOP_ACTIONS.RUN_CONTINUE && action.runId) {
    return `/运行 继续 ${action.runId}`;
  }
  if (action.type === DESKTOP_ACTIONS.EXPERIENCE_ACCEPT && action.candidateId) {
    return `/经验 接受 ${action.candidateId}`;
  }
  if (action.type === DESKTOP_ACTIONS.EXPERIENCE_PROMOTE && action.candidateId) {
    return `/经验 晋升 ${action.candidateId}`;
  }
  if (action.type === DESKTOP_ACTIONS.KNOWLEDGE_ACCEPT && action.packId) {
    return `/知识 接受 ${action.packId}`;
  }
  if (action.type === DESKTOP_ACTIONS.KNOWLEDGE_PUBLISH && action.packId) {
    return `/知识 发布 ${action.packId}`;
  }
  if (action.type === DESKTOP_ACTIONS.KNOWLEDGE_RECALL_PREVIEW) {
    return "/知识 召回";
  }
  if (action.type === DESKTOP_ACTIONS.WEIXIN_GATEWAY_CONTROL) {
    return `/微信 ${action.operation ?? "状态"}`;
  }
  return action.type;
}

function selectActionableRun(snapshot, options = {}) {
  const runs = collectReviewRuns(snapshot);
  if (runs.length === 0) {
    return null;
  }

  const approvable = runs.find((run) => countApprovableRunAssignments(run) > 0);
  if (approvable) {
    return approvable;
  }
  if (options.requireApproval) {
    return null;
  }

  return (
    runs.find((run) => run.status === "created") ??
    runs.find((run) => isActiveRunStatus(run.status)) ??
    runs.find((run) => ["failed", "blocked"].includes(run.status)) ??
    runs.find((run) => run.status === "completed") ??
    null
  );
}

function collectReviewRuns(snapshot) {
  const review = snapshot?.assets?.review;
  if (!review) {
    return [];
  }
  const runs = [];
  const seen = new Set();
  const pushRun = (run) => {
    if (!run?.runId || seen.has(run.runId)) {
      return;
    }
    seen.add(run.runId);
    runs.push(run);
  };

  pushRun(review.latestRun);
  if (Array.isArray(review.executionItems)) {
    for (const run of review.executionItems) {
      pushRun(run);
    }
  }

  return runs;
}

function countApprovableRunAssignments(run) {
  return (Array.isArray(run.assignments) ? run.assignments : []).filter(
    (assignment) =>
      assignment?.status === "pending" &&
      assignment.approvalMode === "operator_approve" &&
      assignment.assignmentId,
  ).length;
}

function isActiveRunStatus(status) {
  return ["running", "ready", "paused"].includes(status);
}

function resolveRejectIntent(snapshot, explicitCandidateId = "") {
  const candidateId = explicitCandidateId.trim() || snapshot?.candidate?.id;
  if (candidateId && (explicitCandidateId.trim() || snapshot?.candidate?.status === "pending")) {
    return {
      kind: "desktopAction",
      action: {
        type: DESKTOP_ACTIONS.EXPERIENCE_REJECT,
        candidateId,
      },
      title: "理解为：拒绝经验候选",
      body: "Angel 会拒绝当前候选经验。",
    };
  }
  return null;
}

function missingReviewTargetIntent(body) {
  return {
    kind: "snapshot",
    title: "没有可执行的审查动作",
    body,
  };
}

function createActionFromComposer(actionType, sourceAction) {
  switch (actionType) {
    case DESKTOP_ACTIONS.EXPERIENCE_LEARN_DIRECTORY:
      return {
        type: actionType,
        directory: sourceAction.prompt.trim(),
        sourceAction,
      };
    case DESKTOP_ACTIONS.EXPERIENCE_LEARN_QUERY:
      return {
        type: actionType,
        query: sourceAction.prompt.trim(),
        sourceAction,
      };
    case DESKTOP_ACTIONS.EXPERIENCE_LEARN_TEXT:
      return {
        type: actionType,
        text: sourceAction.prompt.trim(),
        sourceAction,
      };
    case DESKTOP_ACTIONS.EXPERIENCE_LIST:
    case DESKTOP_ACTIONS.KNOWLEDGE_RECALL_PREVIEW:
      return {
        type: actionType,
        sourceAction,
      };
    default:
      throw new Error(`Unsupported composer action target: ${actionType}`);
  }
}

function normalizePrompt(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createDesktopWorkbenchConversationContext(sessionKey = "desktop:workbench") {
  return {
    sessionKey,
    nextTurnOrdinal: 1,
    turns: [],
    runtimeHistory: [],
    evidenceDisclosures: [],
    activeEvidenceFrame: null,
  };
}

function resetDesktopWorkbenchConversationContext(context) {
  context.nextTurnOrdinal = 1;
  context.turns = [];
  context.runtimeHistory = [];
  context.evidenceDisclosures = [];
  context.activeEvidenceFrame = null;
}

function createDesktopWorkbenchResetResult(action) {
  return {
    events: [
      {
        role: DESKTOP_EVENT_ROLES.SYSTEM,
        title: "新对话已开始",
        body: "已清空本次工作台对话上下文、运行历史和当前证据框。",
        actionType: action.type,
      },
    ],
    conversationRuntime: {
      turnId:
        typeof action.turnId === "string" && action.turnId.trim().length > 0
          ? action.turnId.trim()
          : "desktop-workbench-reset",
      turnRunId: "desktop-workbench-reset",
      intent: {
        kind: "desktop-conversation-reset",
        metadata: {
          source: "desktop-workbench",
        },
      },
      finalText: "已开始新对话。",
      replySource: "local-command",
      transcriptMessages: [],
      artifactIds: [],
      approvalIds: [],
    },
    runtimeEvents: [],
    operatorTrace: [],
    turnIntent: {
      kind: "desktop-conversation-reset",
      metadata: {
        source: "desktop-workbench",
      },
    },
    memoryDecision: {
      action: "never-store",
      reason: "新对话重置只清理短期上下文，不写入长期记忆。",
    },
    responsePolicy: "result-first",
  };
}

function createDesktopWorkbenchSessionDeleteResult(sessionKey, archiveResult) {
  return {
    sessionDeleted: true,
    sessionKey,
    ...(archiveResult?.sessionArchive === undefined
      ? {}
      : { sessionArchive: archiveResult.sessionArchive }),
    events: [
      {
        role: DESKTOP_EVENT_ROLES.SYSTEM,
        title: "会话上下文已清理",
        body:
          archiveResult?.sessionArchive?.ok === true
            ? "已归档并清理这个桌面会话的短期上下文、运行历史和当前证据框。"
            : "已清理这个桌面会话的短期上下文、运行历史和当前证据框。",
        actionType: DESKTOP_ACTIONS.COMPOSER_SESSION_DELETE,
      },
    ],
    runtimeEvents: [],
    operatorTrace: [],
    responsePolicy: "result-first",
  };
}

function rememberDesktopWorkbenchRuntimeResult(context, text, result) {
  const normalized = normalizePrompt(text);
  if (normalized.length === 0) {
    return;
  }
  const transcript = normalizeDesktopRuntimeTranscriptMessages(
    result?.conversationRuntime?.transcriptMessages,
  );
  if (transcript.length > 0) {
    context.runtimeHistory = trimDesktopRuntimeHistory([
      ...(Array.isArray(context.runtimeHistory) ? context.runtimeHistory : []),
      ...transcript,
    ]);
  } else {
    context.runtimeHistory = trimDesktopRuntimeHistory([
      ...(Array.isArray(context.runtimeHistory) ? context.runtimeHistory : []),
      {
        role: "user",
        content: normalized,
        metadata: {
          source: "desktop-workbench",
        },
      },
    ]);
  }
  context.turns = [
    ...context.turns,
    {
      role: "user",
      text: normalized,
      createdAt: new Date().toISOString(),
    },
  ].slice(-8);
  const evidenceDisclosure = extractDesktopEvidenceDisclosure(result);
  if (evidenceDisclosure !== null) {
    const evidenceRecord = {
      prompt: normalized,
      evidenceDisclosure,
      createdAt: new Date().toISOString(),
    };
    context.evidenceDisclosures = [
      ...(Array.isArray(context.evidenceDisclosures) ? context.evidenceDisclosures : []),
      evidenceRecord,
    ].slice(-8);
    context.activeEvidenceFrame = preserveDesktopActiveEvidenceFrameCandidateIdentity({
      previousFrame: context.activeEvidenceFrame,
      nextFrame: createDesktopActiveEvidenceFrame({
        prompt: normalized,
        evidenceDisclosure,
        result,
        createdAt: evidenceRecord.createdAt,
        sessionKey: context.sessionKey,
      }),
    });
  }
}

function createDesktopActiveEvidenceFrame({
  prompt,
  evidenceDisclosure,
  result,
  createdAt,
  sessionKey,
}) {
  const turnId =
    readDesktopEvidenceString(result?.conversationRuntime?.turnId) ??
    readDesktopEvidenceString(result?.turnId) ??
    `desktop-evidence-${hashDesktopRuntimeText(`${prompt}:${createdAt}`)}`;
  const frameSessionKey =
    readDesktopEvidenceString(sessionKey) ??
    readDesktopEvidenceString(result?.conversationRuntime?.sessionKey) ??
    readDesktopEvidenceString(result?.sessionKey) ??
    "desktop:workbench";
  const sources = getDesktopEvidenceDisclosureSources(evidenceDisclosure);
  const sourceUrls = sources
    .map((source) => readDesktopEvidenceString(source.url))
    .filter((url) => url !== undefined);
  const candidateIds = readDesktopActiveEvidenceCandidateIds(result);
  const createdAtMs = Date.parse(createdAt);
  return {
    schemaVersion: "director.desktop.active-evidence-frame.v1",
    frameId: createDesktopLearningEvidenceFrameId({
      createdAtMs,
      seed: `${turnId}:${sourceUrls.join(",")}:${candidateIds.join(",")}`,
    }),
    sessionKey: frameSessionKey,
    turnId,
    prompt,
    sourceUrls,
    evidenceDisclosure,
    candidateIds,
    createdAt,
    updatedAt: createdAt,
    status: "active",
  };
}

function preserveDesktopActiveEvidenceFrameCandidateIdentity({ previousFrame, nextFrame }) {
  const normalizedNext = normalizeDesktopActiveEvidenceFrameForBridge(nextFrame);
  if (normalizedNext === null || normalizedNext.candidateIds.length > 0) {
    return nextFrame;
  }
  const normalizedPrevious = normalizeDesktopActiveEvidenceFrameForBridge(previousFrame);
  if (normalizedPrevious === null || normalizedPrevious.candidateIds.length === 0) {
    return nextFrame;
  }
  if (!desktopActiveEvidenceFramesShareSource(normalizedPrevious, normalizedNext)) {
    return nextFrame;
  }
  return {
    ...nextFrame,
    candidateIds: normalizedPrevious.candidateIds,
  };
}

function desktopActiveEvidenceFramesShareSource(leftFrame, rightFrame) {
  const leftUrls = collectDesktopActiveEvidenceFrameSourceUrls(leftFrame);
  if (leftUrls.size === 0) {
    return false;
  }
  for (const url of collectDesktopActiveEvidenceFrameSourceUrls(rightFrame)) {
    if (leftUrls.has(url)) {
      return true;
    }
  }
  return false;
}

function collectDesktopActiveEvidenceFrameSourceUrls(frame) {
  const urls = new Set();
  for (const url of Array.isArray(frame?.sourceUrls) ? frame.sourceUrls : []) {
    const normalized = readDesktopEvidenceString(url);
    if (normalized !== undefined) {
      urls.add(normalized);
    }
  }
  for (const source of getDesktopEvidenceDisclosureSources(frame?.evidenceDisclosure)) {
    const normalized = readDesktopEvidenceString(source.url);
    if (normalized !== undefined) {
      urls.add(normalized);
    }
  }
  return urls;
}

function createDesktopLearningEvidenceFrameId({ createdAtMs, seed }) {
  const timestamp = Number.isFinite(createdAtMs) ? Math.trunc(createdAtMs) : Date.now();
  return `learn-${timestamp}-${hashDesktopRuntimeText(seed)}`;
}

function ensureDesktopLearningEvidenceFrameId(frameId, createdAt) {
  if (isValidDesktopLearningEvidenceFrameId(frameId)) {
    return frameId;
  }
  const createdAtMs = Date.parse(createdAt);
  return createDesktopLearningEvidenceFrameId({
    createdAtMs,
    seed: `${frameId}:${createdAt}`,
  });
}

function normalizeDesktopActiveEvidenceFrameForBridge(value) {
  if (!isPlainDesktopBridgeObject(value)) {
    return null;
  }
  const evidenceDisclosure = isPlainDesktopBridgeObject(value.evidenceDisclosure)
    ? value.evidenceDisclosure
    : null;
  const sourceUrls = Array.isArray(value.sourceUrls)
    ? value.sourceUrls.filter((url) => typeof url === "string" && url.trim().length > 0)
    : [];
  const candidateIds = Array.isArray(value.candidateIds)
    ? value.candidateIds.filter((id) => typeof id === "string" && id.trim().length > 0)
    : [];
  if (evidenceDisclosure === null && sourceUrls.length === 0 && candidateIds.length === 0) {
    return null;
  }
  const createdAt =
    readDesktopEvidenceString(value.createdAt) ??
    readDesktopEvidenceString(value.updatedAt) ??
    new Date().toISOString();
  const frameId =
    readDesktopEvidenceString(value.frameId) ??
    `evidence-frame-${hashDesktopRuntimeText(
      `${sourceUrls.join(",")}:${candidateIds.join(",")}:${createdAt}`,
    )}`;
  return {
    schemaVersion:
      readDesktopEvidenceString(value.schemaVersion) ?? "director.desktop.active-evidence-frame.v1",
    frameId: ensureDesktopLearningEvidenceFrameId(frameId, createdAt),
    sessionKey: readDesktopEvidenceString(value.sessionKey) ?? "desktop:workbench",
    turnId:
      readDesktopEvidenceString(value.turnId) ??
      `desktop-evidence-${hashDesktopRuntimeText(frameId)}`,
    prompt: readDesktopEvidenceString(value.prompt) ?? "",
    sourceUrls,
    ...(evidenceDisclosure === null ? {} : { evidenceDisclosure }),
    candidateIds,
    createdAt,
    updatedAt: readDesktopEvidenceString(value.updatedAt) ?? createdAt,
    status: readDesktopEvidenceString(value.status) ?? "active",
  };
}

function hasRecoverableDesktopLearningEvidenceFrame(snapshot, sessionKey) {
  return createDesktopActiveEvidenceFrameFromSnapshot(snapshot, sessionKey) !== null;
}

function createDesktopActiveEvidenceFrameFromSnapshot(snapshot, sessionKey) {
  const latestPending = readLatestDesktopLearningPendingConfirmation(snapshot, sessionKey);
  if (latestPending === null) {
    return createDesktopActiveEvidenceFrameFromExperienceCandidateSnapshot(snapshot, sessionKey);
  }
  const candidateIds = Array.isArray(latestPending.candidateIds)
    ? latestPending.candidateIds.filter((id) => typeof id === "string" && id.trim().length > 0)
    : [];
  const sourceRef = readDesktopEvidenceString(latestPending.sourceRef);
  const evidenceDisclosure = createDesktopEvidenceDisclosureFromPendingLearning(latestPending);
  if (candidateIds.length === 0 && sourceRef === undefined && evidenceDisclosure === null) {
    return null;
  }
  const createdAtMs =
    typeof latestPending.createdAtMs === "number" && Number.isFinite(latestPending.createdAtMs)
      ? latestPending.createdAtMs
      : Date.now();
  const createdAt = new Date(createdAtMs).toISOString();
  const sourceUrls = sourceRef === undefined ? [] : [sourceRef];
  const seed = [
    latestPending.confirmationId,
    latestPending.artifactId,
    sourceRef,
    candidateIds.join(","),
    createdAt,
  ]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join(":");
  return {
    schemaVersion: "director.desktop.active-evidence-frame.v1",
    frameId: createDesktopLearningEvidenceFrameId({ createdAtMs, seed }),
    sessionKey: readDesktopEvidenceString(latestPending.sessionKey) ?? "desktop:workbench",
    turnId: `desktop-learning-${hashDesktopRuntimeText(seed)}`,
    prompt: readDesktopEvidenceString(latestPending.title) ?? "",
    sourceUrls,
    ...(evidenceDisclosure === null ? {} : { evidenceDisclosure }),
    candidateIds,
    createdAt,
    updatedAt: createdAt,
    expiresAtMs:
      typeof latestPending.expiresAtMs === "number" && Number.isFinite(latestPending.expiresAtMs)
        ? latestPending.expiresAtMs
        : createdAtMs + DESKTOP_LEARNING_CONFIRMATION_TTL_MS,
    status: "active",
  };
}

function createDesktopActiveEvidenceFrameFromExperienceCandidateSnapshot(snapshot, sessionKey) {
  const candidate = readLatestDesktopExperienceCandidateSnapshotItem(snapshot, sessionKey);
  if (candidate === null) {
    return null;
  }
  const candidateId = readDesktopEvidenceString(candidate.id ?? candidate.candidateId);
  const sourceRef =
    readDesktopEvidenceString(candidate.sourceRef) ??
    readDesktopEvidenceString(candidate.rawSourceRef) ??
    readDesktopEvidenceString(candidate.sourceDocument?.sourceRef);
  const evidenceDisclosure =
    createDesktopEvidenceDisclosureFromExperienceCandidateSnapshotItem(candidate);
  if (candidateId === undefined && sourceRef === undefined && evidenceDisclosure === null) {
    return null;
  }
  const createdAtMs =
    typeof candidate.createdAtMs === "number" && Number.isFinite(candidate.createdAtMs)
      ? candidate.createdAtMs
      : Date.now();
  const createdAt = new Date(createdAtMs).toISOString();
  const sourceUrls = sourceRef === undefined ? [] : [sourceRef];
  const candidateIds = candidateId === undefined ? [] : [candidateId];
  const seed = [candidateId, sourceRef, createdAt]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join(":");
  return {
    schemaVersion: "director.desktop.active-evidence-frame.v1",
    frameId: createDesktopLearningEvidenceFrameId({ createdAtMs, seed }),
    sessionKey: readDesktopEvidenceString(candidate.sessionKey) ?? "desktop:workbench",
    turnId: `desktop-experience-${hashDesktopRuntimeText(seed)}`,
    prompt: readDesktopEvidenceString(candidate.title) ?? sourceRef ?? candidateId ?? "",
    sourceUrls,
    ...(evidenceDisclosure === null ? {} : { evidenceDisclosure }),
    candidateIds,
    createdAt,
    updatedAt: createdAt,
    status: "active",
  };
}

function readLatestDesktopExperienceCandidateSnapshotItem(snapshot, sessionKey) {
  const items = Array.isArray(snapshot?.candidate?.items)
    ? snapshot.candidate.items.filter(isPlainDesktopBridgeObject)
    : [];
  const sessionItems = items.filter((item) => desktopBridgeRecordMatchesSession(item, sessionKey));
  if (sessionItems.length === 0) {
    return null;
  }
  return [...sessionItems].sort((left, right) => {
    const leftTime =
      typeof left.createdAtMs === "number" && Number.isFinite(left.createdAtMs)
        ? left.createdAtMs
        : 0;
    const rightTime =
      typeof right.createdAtMs === "number" && Number.isFinite(right.createdAtMs)
        ? right.createdAtMs
        : 0;
    return (
      readDesktopExperienceSnapshotStatusPriority(right) -
        readDesktopExperienceSnapshotStatusPriority(left) ||
      rightTime - leftTime ||
      String(right.id ?? "").localeCompare(String(left.id ?? ""))
    );
  })[0];
}

function readDesktopExperienceSnapshotStatusPriority(candidate) {
  const status = readDesktopEvidenceString(candidate?.status);
  if (status === "pending") {
    return 3;
  }
  if (status === "accepted" || status === "promoted") {
    return 2;
  }
  if (status === "rejected") {
    return 0;
  }
  return 1;
}

function readLatestDesktopLearningPendingConfirmation(snapshot, sessionKey) {
  const pending = Array.isArray(snapshot?.assets?.learning?.pendingConfirmations)
    ? snapshot.assets.learning.pendingConfirmations.filter(isPlainDesktopBridgeObject)
    : [];
  const sessionPending = pending.filter((item) =>
    desktopBridgeRecordMatchesSession(item, sessionKey),
  );
  if (sessionPending.length === 0) {
    return null;
  }
  return [...sessionPending].sort((left, right) => {
    const leftTime =
      typeof left.createdAtMs === "number" && Number.isFinite(left.createdAtMs)
        ? left.createdAtMs
        : 0;
    const rightTime =
      typeof right.createdAtMs === "number" && Number.isFinite(right.createdAtMs)
        ? right.createdAtMs
        : 0;
    return rightTime - leftTime;
  })[0];
}

function desktopBridgeRecordMatchesSession(record, sessionKey) {
  const expectedSessionKey = readDesktopEvidenceString(sessionKey);
  if (expectedSessionKey === undefined) {
    return true;
  }
  const actualSessionKey =
    readDesktopEvidenceString(record?.sessionKey) ??
    readDesktopEvidenceString(record?.payload?.sessionKey) ??
    readDesktopEvidenceString(record?.summary?.sessionKey) ??
    "desktop:workbench";
  return actualSessionKey === expectedSessionKey;
}

function createDesktopEvidenceDisclosureFromPendingLearning(pending) {
  const sourceRef = readDesktopEvidenceString(pending.sourceRef);
  if (sourceRef === undefined) {
    return null;
  }
  return {
    schemaVersion: "director.desktop.evidence-disclosure.v1",
    sourceCount: 1,
    sources: [
      {
        url: sourceRef,
        title: readDesktopEvidenceString(pending.title) ?? sourceRef,
        fullBodyChars: readDesktopEvidenceNumber(pending.fullBodyChars) ?? 0,
        previewChars: readDesktopEvidenceNumber(pending.previewChars) ?? 0,
        secondPassExtracted: pending.secondPassExtracted === true,
        persisted: false,
        readStatus: "read",
        sourceAccessStatus: "available",
        mediaUnderstandingStatus: "not_understood_without_user_authorization",
      },
    ],
  };
}

function createDesktopEvidenceDisclosureFromExperienceCandidateSnapshotItem(candidate) {
  const sourceRef =
    readDesktopEvidenceString(candidate.sourceRef) ??
    readDesktopEvidenceString(candidate.rawSourceRef) ??
    readDesktopEvidenceString(candidate.sourceDocument?.sourceRef);
  if (sourceRef === undefined) {
    return null;
  }
  const sourceDocument = isPlainDesktopBridgeObject(candidate.sourceDocument)
    ? candidate.sourceDocument
    : {};
  const content =
    readDesktopEvidenceString(sourceDocument.rawContent) ??
    readDesktopEvidenceString(sourceDocument.content) ??
    readDesktopEvidenceString(candidate.evidencePreview) ??
    readDesktopEvidenceString(candidate.summary) ??
    "";
  const fullBodyChars =
    readDesktopEvidenceNumber(sourceDocument.originalChars) ??
    readDesktopEvidenceNumber(candidate.fullBodyChars) ??
    content.length;
  return {
    schemaVersion: "director.desktop.evidence-disclosure.v1",
    sourceCount: 1,
    sources: [
      {
        url: sourceRef,
        title: readDesktopEvidenceString(candidate.title) ?? sourceRef,
        fullBodyChars,
        previewChars: content.length,
        secondPassExtracted: false,
        persisted: candidate.status === "accepted" || candidate.status === "promoted",
        readStatus: fullBodyChars > 0 ? "read" : "empty",
        sourceAccessStatus: fullBodyChars > 0 ? "available" : "failed",
        mediaUnderstandingStatus: inferDesktopExperienceSnapshotMediaUnderstandingStatus(candidate),
      },
    ],
  };
}

function inferDesktopExperienceSnapshotMediaUnderstandingStatus(candidate) {
  const text = [
    candidate.mediaUnderstanding,
    candidate.evidencePreview,
    candidate.sourceDocument?.content,
    candidate.sourceDocument?.rawContent,
  ]
    .filter((value) => typeof value === "string")
    .join("\n");
  if (/已有视觉|媒体理解证据|understood/iu.test(text)) {
    return "understood";
  }
  if (/媒体|图片|视频|音频|poster|blob|pbs\.twimg\.com|video/iu.test(text)) {
    return "not_understood_without_user_authorization";
  }
  return "not_applicable";
}

function readDesktopActiveEvidenceCandidateIds(result) {
  return [
    ...(Array.isArray(result?.candidateIds) ? result.candidateIds : []),
    ...(Array.isArray(result?.candidate_ids) ? result.candidate_ids : []),
    ...(Array.isArray(result?.result?.candidateIds) ? result.result.candidateIds : []),
    ...(Array.isArray(result?.result?.candidate_ids) ? result.result.candidate_ids : []),
    ...(Array.isArray(result?.apiProviderRun?.candidateIds)
      ? result.apiProviderRun.candidateIds
      : []),
    ...(Array.isArray(result?.apiProviderRun?.output?.candidateIds)
      ? result.apiProviderRun.output.candidateIds
      : []),
    ...(Array.isArray(result?.apiProviderRun?.result?.candidateIds)
      ? result.apiProviderRun.result.candidateIds
      : []),
    ...(Array.isArray(result?.apiProviderRun?.output?.result?.candidateIds)
      ? result.apiProviderRun.output.result.candidateIds
      : []),
    ...(Array.isArray(result?.apiProviderRun?.output?.result?.result?.candidateIds)
      ? result.apiProviderRun.output.result.result.candidateIds
      : []),
    ...(Array.isArray(result?.conversationRuntime?.artifactIds)
      ? result.conversationRuntime.artifactIds
      : []),
  ]
    .filter((id) => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim());
}

function extractDesktopEvidenceDisclosure(result) {
  if (!result || typeof result !== "object") {
    return null;
  }
  const direct =
    result.evidenceDisclosure ??
    result.apiProviderRun?.evidenceDisclosure ??
    result.conversationRuntime?.evidenceDisclosure ??
    result.productionRun?.evidenceDisclosure;
  if (direct && typeof direct === "object") {
    return direct;
  }
  const eventEvidence = (Array.isArray(result.events) ? result.events : [])
    .map((event) => event?.evidenceDisclosure)
    .find((evidenceDisclosure) => evidenceDisclosure && typeof evidenceDisclosure === "object");
  return eventEvidence ?? null;
}

function loadDesktopWorkbenchRuntimeHistory(context) {
  return trimDesktopRuntimeHistory(context?.runtimeHistory ?? []);
}

function normalizeDesktopRuntimeTranscriptMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages.flatMap((message) => {
    if (!message || typeof message !== "object") {
      return [];
    }
    const role = message.role;
    if (role !== "user" && role !== "assistant" && role !== "tool") {
      return [];
    }
    const content = typeof message.content === "string" ? message.content : "";
    const toolCalls = Array.isArray(message.toolCalls)
      ? message.toolCalls
          .filter(
            (call) =>
              call &&
              typeof call.id === "string" &&
              typeof call.name === "string" &&
              call.id.trim().length > 0 &&
              call.name.trim().length > 0,
          )
          .map((call) => ({
            id: call.id,
            name: call.name,
            args: call.args && typeof call.args === "object" ? call.args : {},
            ...(call.readOnly === undefined ? {} : { readOnly: call.readOnly }),
            ...(call.requiresApproval === undefined
              ? {}
              : { requiresApproval: call.requiresApproval }),
            ...(call.metadata === undefined ? {} : { metadata: call.metadata }),
          }))
      : [];
    const toolCallId =
      typeof message.toolCallId === "string" && message.toolCallId.trim().length > 0
        ? message.toolCallId.trim()
        : undefined;
    if (content.trim().length === 0 && toolCallId === undefined && toolCalls.length === 0) {
      return [];
    }
    return [
      {
        role,
        content,
        ...(toolCallId === undefined ? {} : { toolCallId }),
        ...(toolCalls.length === 0 ? {} : { toolCalls }),
        ...(message.metadata === undefined ? {} : { metadata: message.metadata }),
      },
    ];
  });
}

function trimDesktopRuntimeHistory(messages) {
  return normalizeDesktopRuntimeTranscriptMessages(messages).slice(-24);
}

function loadRecentDesktopUserContext(context) {
  if (!context || !Array.isArray(context.turns)) {
    return [];
  }
  return selectRecentChannelContextLines(
    context.turns
      .filter((turn) => turn?.role === "user")
      .map((turn) => normalizePrompt(turn.text))
      .filter((line) => line.length > 0),
    { maxLines: 3 },
  );
}

function withRecentDesktopContext(input) {
  return appendRecentChannelContext({
    text: input.text,
    contextLines: loadRecentDesktopUserContext(input.context),
  });
}

function isHttpUrl(value) {
  return /^https?:\/\/[^\s"'<>，。！？、；;]+$/iu.test(value);
}

function extractFirstHttpUrl(value) {
  const match = /https?:\/\/[^\s"'<>，。！？、；;]+/iu.exec(value);
  if (!match) {
    return null;
  }
  const url = stripTrailingUrlPunctuation(match[0] ?? "");
  return isHttpUrl(url) ? url : null;
}

function stripTrailingUrlPunctuation(value) {
  return value.replace(/[)\]}>,.;:!?，。；：！？、]+$/u, "");
}

function isFileUrl(value) {
  return /^file:\/\/\S+$/iu.test(value);
}

function extractFirstFileUrl(value) {
  const match = /file:\/\/\S+/iu.exec(value);
  if (!match) {
    return null;
  }
  const url = stripTrailingUrlPunctuation(match[0] ?? "");
  return isFileUrl(url) ? url : null;
}

function decodeFileUrl(value) {
  try {
    return decodeURIComponent(new URL(value).pathname);
  } catch {
    return value;
  }
}

function extractFirstLocalSource(value) {
  const normalized = value.trim();
  if (isFileUrl(normalized)) {
    return decodeFileUrl(normalized);
  }
  if (looksLikeLocalPath(normalized)) {
    return stripTrailingPathPunctuation(normalized);
  }

  const fileUrl = extractFirstFileUrl(value);
  if (fileUrl !== null) {
    return decodeFileUrl(fileUrl);
  }

  return (
    parseTokens(value)
      .map(stripTrailingPathPunctuation)
      .find((token) => looksLikeLocalPath(token)) ?? null
  );
}

function looksLikeLocalPath(value) {
  return (
    value.startsWith("/") ||
    value.startsWith("~/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    /^[A-Za-z]:[\\/]/u.test(value)
  );
}

function stripTrailingPathPunctuation(value) {
  return value.replace(/[)\]}>,.;:!?，。；：！？、]+$/u, "");
}

const isReviewIntent = isChannelReviewActionIntent;
const isNextStepQuestion = isChannelNextStepQuestion;
const isRunApprovalIntent = isChannelRunApprovalIntent;
const isRejectIntent = isChannelRejectIntent;

function isSlashName(value, aliases) {
  const normalized = value.toLowerCase();
  return aliases.some((alias) => normalized === alias.toLowerCase());
}

function splitSlashArgs(value) {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return { verb: "", rest: "" };
  }
  const verb = normalized.split(/\s+/u)[0] ?? "";
  return {
    verb,
    rest: normalized.slice(verb.length).trim(),
  };
}

function matchesVerb(value, aliases) {
  if (value.length === 0) {
    return false;
  }
  const normalized = value.toLowerCase();
  return aliases.some((alias) => normalized === alias.toLowerCase());
}

function matchesAny(value, needles) {
  const normalized = value.toLowerCase();
  return needles.some((needle) => normalized.includes(needle.toLowerCase()));
}

function isProductionTaskPrompt(prompt) {
  if (isExplicitConsultationOnlyPrompt(prompt)) {
    return false;
  }
  const naturalProductionObjective = parseNaturalDirectorProductionObjective(prompt);
  return (
    naturalProductionObjective !== null ||
    /(制作任务|导演制作|生产任务|创建\s*Director|创建\s*director)/iu.test(prompt) ||
    /(按|照|沿用|延续)?.{0,8}(上次|之前|前一次|刚才).{0,16}(风格|感觉|结构|分镜|脚本|方案).{0,16}(继续|再来|延续|生成|做)/u.test(
      prompt,
    ) ||
    /(做|制作|生成|创建|规划|产出).{0,48}(短剧|视频|分镜|镜头规划|脚本蓝图|制作蓝图|执行蓝图|成片方案)/u.test(
      prompt,
    ) ||
    /(short\s*drama|production\s+task|director\s+production|create\s+blueprint|production\s+blueprint)/iu.test(
      prompt,
    )
  );
}

function isInformationSeekingProductionQuestion(prompt) {
  return (
    isExplicitConsultationOnlyPrompt(prompt) ||
    /(什么时间|几点|现在时间|今天|最近|最新|互联网|联网|搜索|搜一下|查一下|看看|哪个|哪一个|哪款|哪种|厉害|最好|更好|排行榜|推荐|对比|资料|教程|新闻|趋势)/u.test(
      prompt,
    ) &&
    /(模型|工具|产品|能力|方案|资料|教程|新闻|趋势|生成图片|分镜图|视频模型|图片模型)/u.test(
      prompt,
    ) &&
    !/(^|\s|：|:)(\/制作|\/生成|导演制作|制作任务|生产任务)/iu.test(prompt)
  );
}

function isExplicitConsultationOnlyPrompt(prompt) {
  const text = normalizePrompt(prompt);
  if (text.length === 0) {
    return false;
  }
  const blocksTaskCreation =
    /(?:别|不要|不必|不用|无需|禁止|不能).{0,20}(?:创建|启动|生成|新建|进入|开).{0,12}(?:任务|制作任务|运行|run)|(?:别|不要|不必|不用|无需|禁止|不能).{0,20}(?:任务化|执行|制作|开跑)/iu.test(
      text,
    );
  const declaresConsultation =
    /(?:咨询问题|咨询一下|只是?问|只是?咨询|我问的是|不是让你|不用执行|只(?:用|要)?(?:三点|几点|回答|说|列)|只回答|只回复)/iu.test(
      text,
    );
  const asksForAdvice =
    /(?:应该|优先|怎么|如何|哪些|哪几个|比较|判断|建议|维度|策略|思路|方法|拆解|分析|回答)/iu.test(
      text,
    );
  return (blocksTaskCreation || declaresConsultation) && asksForAdvice;
}

function hasMixedLearningProductionIntent(value) {
  return matchesAny(value, ["学习", "资料", "经验", "知识"]) && isProductionTaskPrompt(value);
}

function resolveActionHandler(handlers, actionType) {
  const handler = actionHandlerTable(handlers)[actionType];
  if (!handler) {
    throw new Error(`No desktop bridge handler wired for action: ${actionType}`);
  }
  return handler;
}

function actionHandlerTable(handlers) {
  return {
    [DESKTOP_ACTIONS.DESKTOP_PICK_DIRECTORY]: handlers.desktop?.pickDirectory,
    [DESKTOP_ACTIONS.SNAPSHOT]: handlers.snapshot,
    [DESKTOP_ACTIONS.COMPOSER_CANCEL]: handlers.composer?.cancel,
    [DESKTOP_ACTIONS.SETTINGS_SET]: handlers.settings?.set,
    [DESKTOP_ACTIONS.SETTINGS_OPEN_RECOMMENDED_PURCHASE]:
      handlers.settings?.openRecommendedPurchase,
    [DESKTOP_ACTIONS.COST_BUDGET_SET]: handlers.settings?.costBudgetSet,
    [DESKTOP_ACTIONS.WEIXIN_GATEWAY_CONTROL]: handlers.settings?.weixinGatewayControl,
    [DESKTOP_ACTIONS.WEIXIN_GATEWAY_ACCOUNT_SELECT]: handlers.settings?.weixinGatewayAccountSelect,
    [DESKTOP_ACTIONS.WEIXIN_GATEWAY_LOGIN_START]: handlers.settings?.weixinGatewayLoginStart,
    [DESKTOP_ACTIONS.WEIXIN_GATEWAY_LOGIN_POLL]: handlers.settings?.weixinGatewayLoginPoll,
    [DESKTOP_ACTIONS.MCP_SERVER_UPSERT]: handlers.settings?.mcpServerUpsert,
    [DESKTOP_ACTIONS.MCP_SERVER_DELETE]: handlers.settings?.mcpServerDelete,
    [DESKTOP_ACTIONS.MCP_SERVER_TEST]: handlers.settings?.mcpServerTest,
    [DESKTOP_ACTIONS.MCP_SERVER_TOOL_SELECTION_SET]: handlers.settings?.mcpServerToolSelectionSet,
    [DESKTOP_ACTIONS.MCP_REFRESH]: handlers.settings?.mcpRefresh,
    [DESKTOP_ACTIONS.MCP_LOGIN]: handlers.settings?.mcpLogin,
    [DESKTOP_ACTIONS.MCP_REVOKE]: handlers.settings?.mcpRevoke,
    [DESKTOP_ACTIONS.API_PROVIDER_SET]: handlers.apiProviders?.set,
    [DESKTOP_ACTIONS.API_PROVIDER_SYNC_MODELS]: handlers.apiProviders?.syncModels,
    [DESKTOP_ACTIONS.API_PROVIDER_TEST]: handlers.apiProviders?.test,
    [DESKTOP_ACTIONS.API_PROVIDER_TEXT]: handlers.apiProviders?.text,
    [DESKTOP_ACTIONS.API_PROVIDER_IMAGE]: handlers.apiProviders?.image,
    [DESKTOP_ACTIONS.API_PROVIDER_VIDEO]: handlers.apiProviders?.video,
    [DESKTOP_ACTIONS.LIVE_RUNNER_LIST]: handlers.liveRunner?.list,
    [DESKTOP_ACTIONS.LIVE_RUNNER_READ]: handlers.liveRunner?.read,
    [DESKTOP_ACTIONS.LIVE_RUNNER_CANCEL]: handlers.liveRunner?.cancel,
    [DESKTOP_ACTIONS.LIVE_AUDIO_START]: handlers.liveAudio?.start,
    [DESKTOP_ACTIONS.LIVE_AUDIO_STOP]: handlers.liveAudio?.stop,
    [DESKTOP_ACTIONS.LIVE_AUDIO_CANCEL]: handlers.liveAudio?.cancel,
    [DESKTOP_ACTIONS.LIVE_AUDIO_STATUS]: handlers.liveAudio?.status,
    [DESKTOP_ACTIONS.TASK_RUNTIME_LIST]: handlers.taskRuntime?.list,
    [DESKTOP_ACTIONS.TASK_RUNTIME_READ]: handlers.taskRuntime?.read,
    [DESKTOP_ACTIONS.TASK_RUNTIME_CANCEL]: handlers.taskRuntime?.cancel,
    [DESKTOP_ACTIONS.CLIENT_RUNTIME_LIST]: handlers.clientRuntime?.list,
    [DESKTOP_ACTIONS.CLIENT_RUNTIME_READ]: handlers.clientRuntime?.read,
    [DESKTOP_ACTIONS.CLIENT_RUNTIME_STOP]: handlers.clientRuntime?.stop,
    [DESKTOP_ACTIONS.CLIENT_RUNTIME_FOLLOWUP]: handlers.clientRuntime?.followup,
    [DESKTOP_ACTIONS.CLIENT_RUNTIME_STEER]: handlers.clientRuntime?.steer,
    [DESKTOP_ACTIONS.RUNTIME_TOOL_APPROVAL_DECIDE]: handlers.runtimeToolApproval?.decide,
    [DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE]: handlers.externalTools?.manage,
    [DESKTOP_ACTIONS.COMFYUI_SET]: handlers.comfyui?.set,
    [DESKTOP_ACTIONS.COMFYUI_TEST]: handlers.comfyui?.test,
    [DESKTOP_ACTIONS.COMFYUI_OPEN]: handlers.comfyui?.open,
    [DESKTOP_ACTIONS.COMFYUI_CREATE_WORKFLOW]: handlers.comfyui?.createWorkflow,
    [DESKTOP_ACTIONS.COMFYUI_RUN]: handlers.comfyui?.run,
    [DESKTOP_ACTIONS.COMFYUI_LIFECYCLE]: handlers.comfyui?.lifecycle,
    [DESKTOP_ACTIONS.COMFYUI_FIX_DEPENDENCIES]: handlers.comfyui?.fixDependencies,
    [DESKTOP_ACTIONS.DIRECTOR_PLAN]: handlers.director?.plan,
    [DESKTOP_ACTIONS.DIRECTOR_PLAN_ACCEPT]: handlers.director?.planAccept,
    [DESKTOP_ACTIONS.DIRECTOR_PLAN_IGNORE]: handlers.director?.planIgnore,
    [DESKTOP_ACTIONS.DIRECTOR_PLAN_RERUN]: handlers.director?.planRerun,
    [DESKTOP_ACTIONS.PRODUCTION_START]: handlers.production?.start,
    [DESKTOP_ACTIONS.COMMAND_CATALOG]: handlers.command?.catalog,
    [DESKTOP_ACTIONS.EXPERIENCE_LEARN_DIRECTORY]: handlers.experience?.learnDirectory,
    [DESKTOP_ACTIONS.EXPERIENCE_LEARN_QUERY]: handlers.experience?.learnQuery,
    [DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL]: handlers.experience?.learnUrl,
    [DESKTOP_ACTIONS.EXPERIENCE_LEARN_TEXT]: handlers.experience?.learnText,
    [DESKTOP_ACTIONS.LEARNING_MEDIA_UNDERSTAND]: handlers.experience?.mediaUnderstand,
    [DESKTOP_ACTIONS.EXPERIENCE_LIST]: handlers.experience?.list,
    [DESKTOP_ACTIONS.EXPERIENCE_UPDATE]: handlers.experience?.update,
    [DESKTOP_ACTIONS.EXPERIENCE_ACCEPT]: handlers.experience?.accept,
    [DESKTOP_ACTIONS.EXPERIENCE_REJECT]: handlers.experience?.reject,
    [DESKTOP_ACTIONS.EXPERIENCE_PROMOTE]: handlers.experience?.promote,
    [DESKTOP_ACTIONS.EXPERIENCE_CREATE_FROM_RUN_REPORT]: handlers.experience?.createFromRunReport,
    [DESKTOP_ACTIONS.EXPERIENCE_CREATE_FROM_TRACE_PROPOSAL]:
      handlers.experience?.createFromTraceProposal,
    [DESKTOP_ACTIONS.EXPERIENCE_CLASSIFICATION_SAVE]: handlers.experience?.classificationSave,
    [DESKTOP_ACTIONS.EXPERIENCE_CATEGORY_CREATE]: handlers.experience?.categoryCreate,
    [DESKTOP_ACTIONS.EXPERIENCE_TAG_CREATE]: handlers.experience?.tagCreate,
    [DESKTOP_ACTIONS.SKILL_CLASSIFICATION_SAVE]: handlers.skills?.classificationSave,
    [DESKTOP_ACTIONS.SKILL_CATEGORY_CREATE]: handlers.skills?.categoryCreate,
    [DESKTOP_ACTIONS.SKILL_TAG_CREATE]: handlers.skills?.tagCreate,
    [DESKTOP_ACTIONS.SKILL_ENABLEMENT_SET]: handlers.skills?.enablementSet,
    [DESKTOP_ACTIONS.SKILL_UPDATE]: handlers.skills?.update,
    [DESKTOP_ACTIONS.SKILL_DELETE]: handlers.skills?.delete,
    [DESKTOP_ACTIONS.SKILL_CURATOR_REFRESH]: handlers.skills?.curatorRefresh,
    [DESKTOP_ACTIONS.SKILL_CURATOR_MARK_PATCHED]: handlers.skills?.curatorMarkPatched,
    [DESKTOP_ACTIONS.SKILL_CURATOR_APPLY_PATCH]: handlers.skills?.curatorApplyPatch,
    [DESKTOP_ACTIONS.SKILL_CURATOR_ARCHIVE]: handlers.skills?.curatorArchive,
    [DESKTOP_ACTIONS.SKILL_CURATOR_MERGE]: handlers.skills?.curatorMerge,
    [DESKTOP_ACTIONS.SKILL_PROPOSE_FROM_EXPERIENCE]: handlers.skills?.proposeFromExperience,
    [DESKTOP_ACTIONS.SKILL_PROPOSAL_ACCEPT]: handlers.skills?.proposalAccept,
    [DESKTOP_ACTIONS.SKILL_PROPOSAL_REJECT]: handlers.skills?.proposalReject,
    [DESKTOP_ACTIONS.SKILL_PROPOSAL_APPLY]: handlers.skills?.proposalApply,
    [DESKTOP_ACTIONS.KNOWLEDGE_CANDIDATE_LIST]: handlers.knowledge?.candidateList,
    [DESKTOP_ACTIONS.KNOWLEDGE_ACCEPT]: handlers.knowledge?.accept,
    [DESKTOP_ACTIONS.KNOWLEDGE_PUBLISH]: handlers.knowledge?.publish,
    [DESKTOP_ACTIONS.KNOWLEDGE_RECALL_PREVIEW]: handlers.knowledge?.recallPreview,
    [DESKTOP_ACTIONS.MEMPALACE_SOURCE_READ]: handlers.mempalace?.sourceRead,
    [DESKTOP_ACTIONS.RUN_CONTINUE]: handlers.run?.continue,
    [DESKTOP_ACTIONS.RUN_DELEGATIONS]: handlers.run?.delegations,
    [DESKTOP_ACTIONS.RUN_SCHEDULER_EXECUTOR]: handlers.run?.schedulerExecutor,
    [DESKTOP_ACTIONS.RUN_SCHEDULER_RECOVERY]: handlers.run?.schedulerRecovery,
    [DESKTOP_ACTIONS.RUN_APPROVE_PENDING_ASSIGNMENTS]: handlers.run?.approvePendingAssignments,
    [DESKTOP_ACTIONS.RUN_APPROVE_ASSIGNMENT]: handlers.run?.approveAssignment,
    [DESKTOP_ACTIONS.RUN_REFLECT]: handlers.run?.reflect,
    [DESKTOP_ACTIONS.MAINTENANCE_PREVIEW]: handlers.maintenance?.preview,
    [DESKTOP_ACTIONS.MAINTENANCE_APPLY]: handlers.maintenance?.apply,
    [DESKTOP_ACTIONS.SOUL_LIST]: handlers.soul?.list,
    [DESKTOP_ACTIONS.SOUL_EXPLAIN]: handlers.soul?.explain,
    [DESKTOP_ACTIONS.SOUL_ACCEPT]: handlers.soul?.accept,
    [DESKTOP_ACTIONS.SOUL_REJECT]: handlers.soul?.reject,
    [DESKTOP_ACTIONS.SOUL_VIEW]: handlers.soul?.view,
    [DESKTOP_ACTIONS.HEARTBEAT_STATUS]: handlers.heartbeat?.status,
    [DESKTOP_ACTIONS.SELF_REFLECTION_DAILY]: handlers.heartbeat?.dailyReflection,
  };
}
