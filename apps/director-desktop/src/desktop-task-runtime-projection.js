import { DESKTOP_ACTIONS } from "./desktop-contract.js";
import {
  compareDesktopLiveRunnerSessionsByUpdatedAt,
  formatDesktopLiveRunnerSession,
  isActiveLiveRunSessionStatus,
  isLiveRunSessionForDesktopTurn,
  mapLiveRunStatusToDesktopTaskStatus,
  readLiveRunnerTimestampMs,
} from "./desktop-live-runner-projection.js";

const DESKTOP_CONVERSATION_STUCK_WARNING_MS = 120_000;

export async function inspectDesktopLiveRunnerBus(liveRunner, options = {}) {
  const store = liveRunner?.store;
  if (!store || typeof store.listSessions !== "function") {
    return {
      schemaVersion: "director.desktop.live-runner-bus.v1",
      status: "unavailable",
      sessionCount: 0,
      activeCount: 0,
      completedCount: 0,
      cancelledCount: 0,
      failedCount: 0,
      latestSession: null,
      sessions: [],
      history: [],
    };
  }

  const activeOnly = options.activeOnly === false ? false : true;
  const sessions = (await store.listSessions({
    activeOnly,
    ...(typeof options.providerId === "string" ? { providerId: options.providerId } : {}),
    ...(typeof options.runId === "string" ? { runId: options.runId } : {}),
  }))
    .filter((session) =>
      typeof options.turnId === "string"
        ? isLiveRunSessionForDesktopTurn(session, options.turnId, { includeTerminal: true })
        : true,
    )
    .map((session) => formatDesktopLiveRunnerSession(session))
    .sort(compareDesktopLiveRunnerSessionsByUpdatedAt)
    .slice(0, 20);
  const activeCount = sessions.filter((session) => isActiveLiveRunSessionStatus(session.status)).length;
  const completedCount = sessions.filter((session) => session.status === "completed").length;
  const cancelledCount = sessions.filter((session) => session.status === "cancelled").length;
  const failedCount = sessions.filter((session) => session.status === "failed").length;
  return {
    schemaVersion: "director.desktop.live-runner-bus.v1",
    status: "ready",
    sessionCount: sessions.length,
    activeCount,
    completedCount,
    cancelledCount,
    failedCount,
    latestSession: sessions[0] ?? null,
    sessions,
    history: sessions,
  };
}

export async function inspectDesktopTaskRuntime(liveRunner, options = {}) {
  const liveRunnerSnapshot = await inspectDesktopLiveRunnerBus(liveRunner, options);
  const liveRunnerTasks = (liveRunnerSnapshot.sessions ?? []).map(formatDesktopTaskRecordFromLiveRunnerSession);
  markDesktopConversationRuntimeStuckWarnings(options.conversationRunRegistry);
  const conversationTasks = listDesktopConversationTaskRecords(options.conversationTaskStore, {
    ...options,
    runRegistry: options.conversationRunRegistry,
  });
  const tasks = [...liveRunnerTasks, ...conversationTasks]
    .sort(compareDesktopTaskRecordsByUpdatedAt)
    .slice(0, 80);
  const activeCount = tasks.filter((task) => isActiveDesktopTaskStatus(task.status)).length;
  const completedCount = tasks.filter((task) => task.status === "completed").length;
  const cancelledCount = tasks.filter((task) => task.status === "cancelled").length;
  const failedCount = tasks.filter((task) => isProblemDesktopTaskStatus(task.status)).length;
  return {
    schemaVersion: "director.desktop.task-runtime.v1",
    status: liveRunnerSnapshot.status,
    taskCount: tasks.length,
    activeCount,
    completedCount,
    cancelledCount,
    failedCount,
    latestTask: tasks[0] ?? null,
    tasks,
    history: tasks,
  };
}

export function formatDesktopClientRuntime(taskRuntime, action = {}) {
  const tasks = (Array.isArray(taskRuntime?.tasks) ? taskRuntime.tasks : []).map(formatDesktopClientRuntimeTaskRecord);
  const history = (Array.isArray(taskRuntime?.history) ? taskRuntime.history : []).map(formatDesktopClientRuntimeTaskRecord);
  return {
    schemaVersion: "director.client-runtime.v1",
    clientSurface: readNonEmptyString(action.clientSurface) ?? "desktop",
    originRuntime: "desktop.taskRuntime",
    status: taskRuntime?.status ?? "unavailable",
    taskCount: taskRuntime?.taskCount ?? tasks.length,
    activeCount: taskRuntime?.activeCount ?? 0,
    completedCount: taskRuntime?.completedCount ?? 0,
    cancelledCount: taskRuntime?.cancelledCount ?? 0,
    failedCount: taskRuntime?.failedCount ?? 0,
    latestTask:
      taskRuntime?.latestTask === null || taskRuntime?.latestTask === undefined
        ? null
        : formatDesktopClientRuntimeTaskRecord(taskRuntime.latestTask),
    tasks,
    history,
  };
}

export function formatDesktopClientRuntimeTask(taskRuntimeTask, action = {}) {
  if (taskRuntimeTask === null || taskRuntimeTask === undefined) {
    return null;
  }
  return {
    schemaVersion: "director.client-runtime.task.v1",
    clientSurface: readNonEmptyString(action.clientSurface) ?? "desktop",
    ...formatDesktopClientRuntimeTaskRecord(taskRuntimeTask),
  };
}

export function formatDesktopClientRuntimeStop(taskRuntimeCancel, action = {}) {
  const explicitTaskId = readNonEmptyString(action.taskId);
  const explicitSessionId = readNonEmptyString(action.sessionId);
  const taskIds = Array.isArray(taskRuntimeCancel?.taskIds) ? taskRuntimeCancel.taskIds : [];
  return {
    schemaVersion: "director.client-runtime.stop.v1",
    clientSurface: readNonEmptyString(action.clientSurface) ?? "desktop",
    originRuntime: "desktop.taskRuntime",
    stopped: taskRuntimeCancel?.cancelled ?? 0,
    taskIds: taskIds.length > 0 ? taskIds : [explicitTaskId ?? explicitSessionId].filter(Boolean),
    sessionIds: Array.isArray(taskRuntimeCancel?.sessionIds) ? taskRuntimeCancel.sessionIds : [],
    conversationTaskIds: Array.isArray(taskRuntimeCancel?.conversationTaskIds)
      ? taskRuntimeCancel.conversationTaskIds
      : [],
    conversationTurnRunIds: Array.isArray(taskRuntimeCancel?.conversationTurnRunIds)
      ? taskRuntimeCancel.conversationTurnRunIds
      : [],
    conversationSubagentRunIds: Array.isArray(taskRuntimeCancel?.conversationSubagentRunIds)
      ? taskRuntimeCancel.conversationSubagentRunIds
      : [],
    errors: Array.isArray(taskRuntimeCancel?.errors) ? taskRuntimeCancel.errors : [],
  };
}

export function formatDesktopClientRuntimeFollowup(result, action = {}) {
  return {
    schemaVersion: "director.client-runtime.followup.v1",
    clientSurface: readNonEmptyString(action.clientSurface) ?? "desktop",
    originRuntime: "desktop.taskRuntime",
    accepted: result.accepted === true,
    status: result.status ?? (result.accepted === true ? "accepted" : "unsupported"),
    continued: result.continued ?? 0,
    taskIds: Array.isArray(result.taskIds) ? result.taskIds : [],
    approvedAssignmentIds: Array.isArray(result.approvedAssignmentIds)
      ? result.approvedAssignmentIds
      : [],
    ...(readNonEmptyString(result.reason) === undefined
      ? {}
      : { reason: readNonEmptyString(result.reason) }),
    ...(readNonEmptyString(action.reason) === undefined
      ? {}
      : { operatorReason: readNonEmptyString(action.reason) }),
  };
}

export function formatDesktopClientRuntimeSteer(result, action = {}) {
  return {
    schemaVersion: "director.client-runtime.steer.v1",
    clientSurface: readNonEmptyString(action.clientSurface) ?? "desktop",
    originRuntime: "desktop.taskRuntime",
    accepted: result.accepted === true,
    status: result.status ?? "unsupported",
    taskIds: Array.isArray(result.taskIds) ? result.taskIds : [],
    reason:
      readNonEmptyString(result.reason) ??
      "当前运行体不支持中途改指令；请用补充要求或重新创建运行。",
    ...(readNonEmptyString(action.instruction) === undefined
      ? {}
      : { instruction: readNonEmptyString(action.instruction) }),
  };
}

export function isDesktopProductionRunClientRuntimeTaskId(taskId) {
  const value = readNonEmptyString(taskId);
  if (value === undefined) {
    return false;
  }
  return !value.startsWith("conversation:") && !value.startsWith("live-runner:");
}

export async function readDesktopTaskRuntimeTask(
  liveRunner,
  taskId,
  conversationTaskStore = undefined,
  conversationRunRegistry = undefined,
) {
  markDesktopConversationRuntimeStuckWarnings(conversationRunRegistry);
  const conversationTask = readDesktopConversationTaskRecord(
    conversationTaskStore,
    taskId,
    conversationRunRegistry,
  );
  if (conversationTask !== null) {
    return conversationTask;
  }
  const liveRunnerSession = await readDesktopLiveRunnerSession(liveRunner, taskId);
  if (liveRunnerSession === null) {
    return null;
  }
  return {
    ...formatDesktopTaskRecordFromLiveRunnerSession(liveRunnerSession),
    events: liveRunnerSession.events ?? [],
    liveRunnerSession,
  };
}

export function createDesktopConversationTaskStore() {
  const tasks = new Map();
  return {
    upsert(task) {
      tasks.set(task.id, task);
      return task;
    },
    get(taskId) {
      return tasks.get(taskId) ?? null;
    },
    list() {
      return [...tasks.values()];
    },
  };
}

export function countUniqueConversationRuntimeToolCalls(events) {
  const ids = new Set();
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.kind !== "runtime.tool") {
      continue;
    }
    const turnIndex = readFiniteNumber(event.payload?.tool?.metadata?.turnIndex);
    if (turnIndex !== undefined && turnIndex < 0) {
      continue;
    }
    const toolId =
      readNonEmptyString(event.payload?.tool?.id) ??
      readNonEmptyString(event.payload?.tool?.callId) ??
      readNonEmptyString(event.id);
    if (toolId !== undefined) {
      ids.add(toolId);
    }
  }
  return ids.size;
}

export function createDesktopConversationTaskId(turnId, sessionKey) {
  const normalizedSessionKey = readNonEmptyString(sessionKey);
  if (normalizedSessionKey === undefined || normalizedSessionKey === "desktop:workbench") {
    return `conversation:${turnId}`;
  }
  return `conversation:${encodeURIComponent(normalizedSessionKey)}:${turnId}`;
}

export function createDesktopConversationTaskEvent(
  type,
  title,
  message,
  occurredAtMs,
  progress = null,
  details = {},
) {
  const metadata = isPlainObject(details.metadata) ? details.metadata : undefined;
  const policyEnvelopeRefs = Array.isArray(details.policyEnvelopeRefs)
    ? details.policyEnvelopeRefs.filter((item) => typeof item === "string")
    : undefined;
  return {
    type,
    ...(typeof details.kind === "string" ? { kind: details.kind } : {}),
    title,
    message: summarizeDesktopTaskText(message, 500),
    occurredAt: new Date(occurredAtMs).toISOString(),
    progress,
    error: type.includes("failed") || type.includes("cancelled") ? summarizeDesktopTaskText(message, 500) : null,
    ...(metadata === undefined ? {} : { metadata }),
    ...(policyEnvelopeRefs === undefined ? {} : { policyEnvelopeRefs }),
  };
}

export function formatRuntimeEventsAsConversationTaskEvents(runtimeEvents) {
  return runtimeEvents
    .map((event) => {
      if (event.kind === "runtime.tool") {
        const tool = event.payload?.tool;
        return createDesktopConversationTaskEvent(
          `conversation.tool.${tool?.phase ?? "event"}`,
          `工具 ${tool?.phase ?? "event"}`,
          tool?.name ?? "runtime.tool",
          event.occurredAtMs ?? Date.now(),
          null,
        );
      }
      if (event.kind === "runtime.approval") {
        const approval = event.payload?.approval;
        return createDesktopConversationTaskEvent(
          approval?.status === "pending"
            ? "conversation.approval.pending"
            : "conversation.approval.resolved",
          approval?.status === "pending" ? "普通对话等待人工批准" : "普通对话审批已处理",
          approval?.metadata?.toolName ?? approval?.title ?? "runtime.approval",
          event.occurredAtMs ?? Date.now(),
          null,
        );
      }
      if (event.kind === "runtime.final") {
        return createDesktopConversationTaskEvent(
          "conversation.final",
          "普通对话生成最终回复",
          event.payload?.text ?? "runtime.final",
          event.occurredAtMs ?? Date.now(),
          100,
        );
      }
      if (event.kind === "runtime.error") {
        return createDesktopConversationTaskEvent(
          "conversation.error",
          "普通对话运行错误",
          event.payload?.message ?? "runtime.error",
          event.occurredAtMs ?? Date.now(),
          100,
        );
      }
      return null;
    })
    .filter(Boolean);
}

export function collectDesktopConversationApprovalIds(runtimeResult, runtimeToolApproval) {
  const ids = new Set();
  if (Array.isArray(runtimeResult?.approvalIds)) {
    for (const id of runtimeResult.approvalIds) {
      if (typeof id === "string" && id.length > 0) {
        ids.add(id);
      }
    }
  }
  for (const event of runtimeResult?.events ?? []) {
    const approvalId = event?.payload?.approval?.id;
    if (typeof approvalId === "string" && approvalId.length > 0) {
      ids.add(approvalId);
    }
  }
  for (const item of runtimeToolApproval?.items ?? []) {
    if (typeof item?.approvalId === "string" && item.approvalId.length > 0) {
      ids.add(item.approvalId);
    }
  }
  return [...ids];
}

export function createConversationApprovalTaskMessage(runtimeEvents) {
  const approvalTools = runtimeEvents
    .filter((event) => event.kind === "runtime.approval")
    .map((event) => event.payload?.approval?.metadata?.toolName ?? event.payload?.approval?.title)
    .filter(Boolean);
  return approvalTools.length > 0
    ? `等待人工批准：${approvalTools.join("，")}`
    : "等待人工批准。";
}

export function dedupeConversationTaskEvents(events) {
  const seen = new Set();
  const deduped = [];
  for (const event of events) {
    const key = `${event.type}:${event.occurredAt}:${event.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(event);
  }
  return deduped.slice(-80);
}

export function isActiveDesktopTaskStatus(status) {
  return status === "pending" || status === "queued" || status === "running" || status === "retry_wait";
}

export async function readDesktopLiveRunnerSession(liveRunner, sessionId) {
  const store = liveRunner?.store;
  if (!store || typeof store.getSession !== "function") {
    return null;
  }
  const session = await store.getSession(sessionId);
  if (session === null) {
    return null;
  }
  const events =
    typeof store.listEvents === "function" ? await store.listEvents(session.sessionId) : [];
  return {
    ...formatDesktopLiveRunnerSession(session, events),
    session,
  };
}

function formatDesktopClientRuntimeTaskRecord(task) {
  return {
    ...task,
    originRuntime: "desktop.taskRuntime",
    controls: {
      read: true,
      stop: task?.cancellable === true,
      steer: false,
      followup: isDesktopProductionRunClientRuntimeTaskId(task?.id),
    },
  };
}

function markDesktopConversationRuntimeStuckWarnings(runRegistry) {
  if (!runRegistry || typeof runRegistry.markStuckRuns !== "function") {
    return [];
  }
  return runRegistry.markStuckRuns({
    staleAfterMs: DESKTOP_CONVERSATION_STUCK_WARNING_MS,
  });
}

function listDesktopConversationTaskRecords(store, options = {}) {
  const turnId = readNonEmptyString(options.turnId);
  const tasks = new Map();
  if (store && typeof store.list === "function") {
    for (const task of store.list()) {
      tasks.set(task.id, task);
    }
  }
  for (const task of listDesktopConversationTasksFromRunRegistry(options.runRegistry, options)) {
    const existing = tasks.get(task.id);
    if (
      existing === undefined ||
      shouldPreferDesktopConversationRegistryTask(existing, task)
    ) {
      tasks.set(task.id, task);
    }
  }
  return [...tasks.values()]
    .filter((task) => (turnId === undefined ? true : task.turnId === turnId))
    .filter((task) => (options.activeOnly === true ? isActiveDesktopTaskStatus(task.status) : true))
    .map(formatDesktopTaskRecordFromConversationTask);
}

function shouldPreferDesktopConversationRegistryTask(existing, candidate) {
  if (!existing) {
    return true;
  }
  if (!candidate) {
    return false;
  }
  if (!isActiveDesktopTaskStatus(existing.status) && isActiveDesktopTaskStatus(candidate.status)) {
    return false;
  }
  if (isActiveDesktopTaskStatus(existing.status) && !isActiveDesktopTaskStatus(candidate.status)) {
    return true;
  }
  return Number(candidate.updatedAt ?? 0) >= Number(existing.updatedAt ?? 0);
}

function readDesktopConversationTaskRecord(store, taskId, runRegistry = undefined) {
  const storedTask = store && typeof store.get === "function" ? store.get(taskId) : null;
  const registryTask =
    runRegistry && typeof runRegistry.read === "function"
      ? readDesktopConversationTaskFromRunRegistry(runRegistry, taskId)
      : null;
  const task =
    storedTask !== null && registryTask !== null
      ? shouldPreferDesktopConversationRegistryTask(storedTask, registryTask)
        ? registryTask
        : storedTask
      : registryTask ?? storedTask;
  if (task !== null) {
    return formatDesktopTaskRecordFromConversationTask(task, { includeEvents: true });
  }
  return null;
}

export function listDesktopConversationTasksFromRunRegistry(runRegistry, options = {}) {
  if (!runRegistry || typeof runRegistry.list !== "function") {
    return [];
  }
  const sessionKey = readNonEmptyString(options.sessionKey);
  const runs = runRegistry.list(sessionKey === undefined ? {} : { sessionKey });
  const turnId = readNonEmptyString(options.turnId);
  return runs
    .filter((run) => (turnId === undefined ? true : run.turnId === turnId))
    .map(createDesktopConversationTaskFromRunRecord);
}

export function readDesktopConversationTaskFromRunRegistry(runRegistry, taskId) {
  const identity = readDesktopConversationIdentityFromTaskId(taskId);
  const turnId = identity?.turnId;
  if (turnId === undefined || typeof runRegistry.list !== "function") {
    return null;
  }
  const run = runRegistry
    .list(identity.sessionKey === undefined ? {} : { sessionKey: identity.sessionKey })
    .filter((record) => record.turnId === turnId)
    .sort(compareConversationRunRecordsByUpdatedAt)[0];
  return run === undefined ? null : createDesktopConversationTaskFromRunRecord(run);
}

function createDesktopConversationTaskFromRunRecord(run) {
  const status = mapConversationRunStatusToDesktopTaskStatus(run.status);
  const progress = mapConversationRunStatusToDesktopTaskProgress(run.status);
  const summary = run.userVisibleSummary ?? summarizeConversationRunLatestEvent(run);
  const error = run.stopReason ?? run.userVisibleSummary ?? run.internalFailure;
  const events = Array.isArray(run.events) ? run.events : [];
  return {
    id: createDesktopConversationTaskId(run.turnId, run.sessionKey),
    turnId: run.turnId,
    turnRunId: run.turnRunId,
    sessionKey: run.sessionKey,
    promptPreview: summarizeDesktopTaskText(summary ?? run.messageId ?? run.turnId, 180),
    actionType: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
    status,
    progress,
    model: run.activeModelCall ?? "runtime",
    provider: "conversation-runtime",
    activeRunId: readNonEmptyString(run.metadata?.activeRunId) ?? null,
    replySource: null,
    runtimeEvents: [],
    runtimeEventsV1: Array.isArray(run.metadata?.runtimeEventsV1)
      ? run.metadata.runtimeEventsV1
      : [],
    runtimeEventCount: events.length,
    toolCount: countUniqueConversationRuntimeToolCalls(events),
    pendingApprovalCount: run.status === "awaiting_approval" ? 1 : 0,
    approvalIds: [],
    artifactIds: [],
    finalTextPreview:
      typeof run.userVisibleSummary === "string"
        ? summarizeDesktopTaskText(run.userVisibleSummary, 240)
        : null,
    cancelReason: run.stopReason ?? null,
    ...(status === "failed" || status === "cancelled" || status === "needs_attention"
      ? { error }
      : {}),
    createdAt: run.startedAtMs,
    startedAt: run.startedAtMs,
    updatedAt: run.updatedAtMs,
    ...(isActiveDesktopTaskStatus(status) ? {} : { completedAt: run.endedAtMs ?? run.updatedAtMs }),
    events: dedupeConversationTaskEvents([
      createDesktopConversationTaskEvent(
        "conversation.registry.loaded",
        "普通对话运行记录",
        summary ?? run.status,
        run.updatedAtMs,
        progress,
      ),
      ...events.map(formatConversationRunTimelineEventAsDesktopTaskEvent),
    ]),
  };
}

function readDesktopConversationIdentityFromTaskId(taskId) {
  const value = readNonEmptyString(taskId);
  if (value === undefined || !value.startsWith("conversation:")) {
    return undefined;
  }
  const body = value.slice("conversation:".length);
  const separator = body.indexOf(":");
  if (separator > 0) {
    const maybeSessionKey = readDesktopConversationTaskSessionKeyFromIdPart(
      body.slice(0, separator),
    );
    if (maybeSessionKey !== undefined) {
      return {
        sessionKey: maybeSessionKey,
        turnId: body.slice(separator + 1),
      };
    }
  }
  return { turnId: body };
}

function readDesktopConversationTaskSessionKeyFromIdPart(value) {
  if (!/%[0-9a-f]{2}/iu.test(value)) {
    return undefined;
  }
  try {
    const decoded = decodeURIComponent(value);
    return /^desktop:workbench(?::[A-Za-z0-9_-]+)?$/u.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function mapConversationRunStatusToDesktopTaskStatus(status) {
  if (status === "completed") {
    return "completed";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "awaiting_approval") {
    return "needs_attention";
  }
  return "running";
}

function mapConversationRunStatusToDesktopTaskProgress(status) {
  if (status === "completed" || status === "cancelled" || status === "failed") {
    return 100;
  }
  if (status === "awaiting_approval") {
    return 65;
  }
  if (status === "queued" || status === "received") {
    return 15;
  }
  if (status === "preflight") {
    return 30;
  }
  if (status === "finalizing") {
    return 90;
  }
  return 45;
}

function summarizeConversationRunLatestEvent(run) {
  return [...(run.events ?? [])].reverse().find((event) => readNonEmptyString(event.summary))
    ?.summary;
}

function formatConversationRunTimelineEventAsDesktopTaskEvent(event) {
  return createDesktopConversationTaskEvent(
    `conversation.registry.${String(event.kind).replaceAll(/[^a-zA-Z0-9._-]/gu, ".")}`,
    "普通对话运行事件",
    event.summary ?? event.kind,
    event.occurredAtMs,
    null,
    {
      kind: event.kind,
      metadata: event.metadata,
      policyEnvelopeRefs: event.policyEnvelopeRefs,
    },
  );
}

function compareConversationRunRecordsByUpdatedAt(left, right) {
  return (
    (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0) ||
    String(right.turnRunId ?? "").localeCompare(String(left.turnRunId ?? ""))
  );
}

function formatDesktopTaskRecordFromConversationTask(task, options = {}) {
  const createdAt = task.createdAt ?? Date.now();
  const updatedAt = task.updatedAt ?? createdAt;
  const completedAt = task.completedAt;
  return {
    id: task.id,
    taskId: task.id,
    category: "conversation-runtime",
    label: "普通对话 turn",
    moduleSource: "workbench",
    lane: "text",
    provider: "conversation-runtime",
    model: task.model ?? "runtime",
    artifactType: "text",
    artifactId: task.turnId,
    artifactLabel: task.replySource ?? null,
    routeTab: "workbench",
    routeLabel: "工作台",
    externalTaskId: task.turnId,
    progress: normalizeDesktopTaskProgress(task.progress, task.status),
    progressMode: task.status === "running" ? "indeterminate" : "determinate",
    cancellable: isActiveDesktopTaskStatus(task.status),
    status: task.status,
    evidenceDisclosure: task.evidenceDisclosure ?? undefined,
    ...(task.error === undefined ? {} : { error: task.error }),
    summary: {
      turnId: task.turnId,
      turnRunId: task.turnRunId ?? null,
      sessionKey: task.sessionKey ?? null,
      replySource: task.replySource,
      runtimeEventCount: task.runtimeEventCount ?? 0,
      toolCount: task.toolCount ?? 0,
      pendingApprovalCount: task.pendingApprovalCount ?? 0,
      runtimeEventsV1: task.runtimeEventsV1 ?? undefined,
    },
    payload: {
      turnId: task.turnId,
      turnRunId: task.turnRunId ?? undefined,
      sessionKey: task.sessionKey ?? undefined,
      source: "desktop.conversation-runtime",
      replySource: task.replySource ?? undefined,
      runtimeEventCount: task.runtimeEventCount ?? 0,
      toolCount: task.toolCount ?? 0,
      pendingApprovalCount: task.pendingApprovalCount ?? 0,
      approvalIds: task.approvalIds ?? [],
      artifactIds: task.artifactIds ?? [],
      finalText: task.finalText ?? undefined,
      finalTextPreview: task.finalTextPreview ?? undefined,
      evidenceDisclosure: task.evidenceDisclosure ?? undefined,
      runtimeEventsV1: task.runtimeEventsV1 ?? undefined,
      cancelReason: task.cancelReason ?? undefined,
      promptPreview: task.promptPreview ?? undefined,
    },
    attemptCount: 0,
    createdAt,
    startedAt: task.startedAt ?? createdAt,
    updatedAt,
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(options.includeEvents === true ? { events: task.events ?? [], conversationTask: task } : {}),
  };
}

function formatDesktopTaskRecordFromLiveRunnerSession(session) {
  const status = mapLiveRunStatusToDesktopTaskStatus(session.status);
  const now = Date.now();
  const createdAt = readLiveRunnerTimestampMs(session.createdAt) || now;
  const startedAt =
    readLiveRunnerTimestampMs(session.startedAt) ||
    createdAt;
  const updatedAt =
    readLiveRunnerTimestampMs(session.updatedAt) ||
    readLiveRunnerTimestampMs(session.endedAt) ||
    startedAt;
  const completedAt = isActiveDesktopTaskStatus(status)
    ? undefined
    : readLiveRunnerTimestampMs(session.endedAt) || updatedAt;
  return {
    id: session.sessionId,
    taskId: session.sessionId,
    category: "live-runner",
    label: createDesktopTaskLabelFromLiveRunnerSession(session),
    moduleSource: "workbench",
    lane: mapLiveRunnerCapabilityToTaskLane(session.capabilityId),
    provider: session.providerId,
    model: session.model ?? null,
    artifactType: mapLiveRunnerCapabilityToArtifactType(session.capabilityId),
    artifactId: session.providerTaskId ?? session.runId,
    artifactLabel: session.providerTaskId ?? null,
    routeTab: "workbench",
    routeLabel: "工作台",
    externalTaskId: session.providerTaskId ?? session.runId,
    progress: normalizeDesktopTaskProgress(session.progress, status),
    progressMode: session.progress > 0 || status === "completed" ? "determinate" : "indeterminate",
    cancellable: session.cancellable === true && isActiveDesktopTaskStatus(status),
    status,
    error: session.error ?? undefined,
    summary: {
      runnerId: session.runnerId,
      runId: session.runId,
      operationId: session.operationId,
      eventCount: session.eventCount,
    },
    payload: {
      liveRunnerSessionId: session.sessionId,
      liveRunnerRunId: session.runId,
      liveRunnerStatus: session.status,
      turnId: session.turnId ?? undefined,
      source: session.source ?? undefined,
      endpoint: session.endpoint ?? undefined,
      providerTaskId: session.providerTaskId ?? undefined,
    },
    attemptCount: 0,
    createdAt,
    startedAt,
    updatedAt,
    ...(completedAt === undefined ? {} : { completedAt }),
  };
}

function createDesktopTaskLabelFromLiveRunnerSession(session) {
  const provider = formatTaskProviderLabel(session.providerId);
  const capability = formatTaskCapabilityLabel(session.capabilityId);
  return `${provider} ${capability}`;
}

function formatTaskProviderLabel(providerId) {
  if (providerId === "memefast-api") {
    return "MemeFast";
  }
  return typeof providerId === "string" && providerId.length > 0 ? providerId : "Provider";
}

function formatTaskCapabilityLabel(capabilityId) {
  switch (capabilityId) {
    case "text":
      return "文本任务";
    case "image_generation":
      return "图片任务";
    case "video_generation":
      return "视频任务";
    default:
      return "运行任务";
  }
}

function mapLiveRunnerCapabilityToTaskLane(capabilityId) {
  if (capabilityId === "image_generation") {
    return "image";
  }
  if (capabilityId === "video_generation") {
    return "video";
  }
  return "text";
}

function mapLiveRunnerCapabilityToArtifactType(capabilityId) {
  if (capabilityId === "image_generation") {
    return "image";
  }
  if (capabilityId === "video_generation") {
    return "video";
  }
  return "text";
}

function normalizeDesktopTaskProgress(progress, status) {
  if (status === "completed") {
    return 100;
  }
  if (typeof progress !== "number" || !Number.isFinite(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function isProblemDesktopTaskStatus(status) {
  return status === "failed" || status === "interrupted" || status === "cancelled" || status === "needs_attention";
}

function compareDesktopTaskRecordsByUpdatedAt(left, right) {
  return (
    (right.updatedAt ?? 0) - (left.updatedAt ?? 0) ||
    String(right.id ?? "").localeCompare(String(left.id ?? ""))
  );
}

function summarizeDesktopTaskText(value, maxLength = 260) {
  const text = String(value ?? "")
    .trim()
    .replaceAll(/\s+/gu, " ");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
