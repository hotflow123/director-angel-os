const TASK_RUNTIME_ACTIVE_STATUSES = new Set(["pending", "queued", "running", "retry_wait"]);
const RUN_CENTER_TOOL_PREVIEW_CHAR_LIMIT = 120;
export const RUN_CENTER_RENDER_THROTTLE_MS = 80;
const RUN_CENTER_FALLBACK_TOAST_DURATION_MS = 8000;

export function createRunCenterTaskRow(task) {
  const row = document.createElement("article");
  row.className = `run-task-row ${task.status}`;
  row.dataset.taskId = task.id;

  const main = document.createElement("div");
  main.className = "run-task-main";
  const title = document.createElement("div");
  title.className = "run-task-title";
  const status = document.createElement("span");
  status.className = `run-task-status ${task.status}`;
  status.textContent = formatTaskRuntimeStatus(task.status);
  const label = document.createElement("strong");
  label.textContent = formatTaskRuntimeUserFacingLabel(task);
  title.append(status, label);

  const meta = document.createElement("div");
  meta.className = "run-task-meta";
  meta.textContent = formatTaskRuntimeUserFacingMetaParts(task).filter(Boolean).join(" · ");

  const previewText = formatTaskRuntimeEventPreview(task);
  const preview = document.createElement("div");
  preview.className = "run-task-preview";
  preview.textContent = previewText ?? "";
  preview.title = previewText ?? "";
  preview.hidden = previewText === null;

  const transcript = createRunCenterTaskTranscript(task);
  const progress = document.createElement("div");
  progress.className = "run-task-progress";
  const bar = document.createElement("span");
  bar.style.width = `${task.progressMode === "determinate" ? task.progress : isTaskRuntimeActive(task) ? 35 : task.progress}%`;
  progress.append(bar);
  main.append(title, meta, preview, ...(transcript === null ? [] : [transcript]), progress);

  const actions = document.createElement("div");
  actions.className = "run-task-actions";
  actions.append(createRunCenterActionButton("详情", "查看任务事件", "taskRead", task.id));
  if (task.cancellable && isTaskRuntimeActive(task)) {
    actions.append(createRunCenterActionButton("停止", "停止任务", "taskCancel", task.id, "danger"));
  }
  if (canRetryRunCenterTask(task)) {
    actions.append(createRunCenterActionButton("重试", "重新发送这次输入", "taskRetry", task.id));
  }
  row.append(main, actions);
  return row;
}

function createRunCenterActionButton(text, title, datasetKey, taskId, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.title = title;
  button.textContent = text;
  if (className) {
    button.className = className;
  }
  button.dataset[datasetKey] = taskId;
  return button;
}

function canRetryRunCenterTask(task) {
  if (!["failed", "interrupted", "cancelled"].includes(String(task?.status ?? ""))) {
    return false;
  }
  if (task?.category !== "conversation-runtime" && task?.payload?.source !== "desktop.conversation-runtime") {
    return false;
  }
  const prompt = typeof task?.payload?.promptPreview === "string" ? task.payload.promptPreview.trim() : "";
  return prompt.length > 0;
}

export function createRunCenterTaskTranscript(task) {
  const steps = resolveRunCenterTaskTranscriptSteps(task);
  if (steps.length === 0) {
    return null;
  }
  const list = document.createElement("div");
  list.className = "run-task-transcript";
  for (const step of steps.slice(0, 5)) {
    const row = document.createElement("div");
    row.className = "run-task-transcript-step";
    row.dataset.kind = step.kind;
    const time = document.createElement("span");
    time.className = "run-task-transcript-time";
    time.textContent = step.time;
    const label = document.createElement("span");
    label.className = "run-task-transcript-label";
    label.textContent = step.label;
    row.append(time, label);
    if (step.pointer) {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "run-task-transcript-copy";
      copy.textContent = "复制来源";
      copy.title = "复制记忆来源指针";
      copy.dataset.runCenterPointerCopy = step.pointer;
      row.append(copy);
    }
    if (step.source) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "run-task-transcript-copy";
      open.textContent = "打开来源";
      open.title = "打开记忆来源定位";
      open.dataset.runCenterPointerOpen = JSON.stringify(step.source);
      row.append(open);
    }
    list.append(row);
  }
  return list;
}

export function createRunCenterRenderScheduler(render, options = {}) {
  const delayMs = readFiniteRunCenterNumber(options.delayMs) ?? RUN_CENTER_RENDER_THROTTLE_MS;
  const setTimer = options.setTimeout ?? globalThis.setTimeout;
  const clearTimer = options.clearTimeout ?? globalThis.clearTimeout;
  let timerId = null;
  const flush = () => {
    if (timerId !== null) {
      clearTimer(timerId);
      timerId = null;
    }
    render();
  };
  return {
    schedule(force = false) {
      if (force) {
        flush();
        return;
      }
      if (timerId !== null) {
        return;
      }
      timerId = setTimer(flush, delayMs);
    },
    flush,
    cancel() {
      if (timerId === null) {
        return;
      }
      clearTimer(timerId);
      timerId = null;
    },
  };
}

export function createRunCenterToastState() {
  return {
    fallbackStatus: null,
    fallbackClearTimerId: null,
    seenFallbackEventIds: new Set(),
  };
}

export function updateRunCenterToastStateFromTasks(toastState, tasks, options = {}) {
  if (!toastState || !Array.isArray(tasks)) {
    return null;
  }
  const fallback = findLatestRunCenterModelFallbackEvent(tasks);
  if (fallback === null || toastState.seenFallbackEventIds.has(fallback.eventId)) {
    return toastState.fallbackStatus;
  }
  toastState.seenFallbackEventIds.add(fallback.eventId);
  if (toastState.fallbackClearTimerId !== null) {
    (options.clearTimeout ?? globalThis.clearTimeout)(toastState.fallbackClearTimerId);
    toastState.fallbackClearTimerId = null;
  }
  toastState.fallbackStatus = formatRunCenterFallbackToastStatus(fallback);
  const setTimer = options.setTimeout ?? globalThis.setTimeout;
  toastState.fallbackClearTimerId = setTimer(() => {
    toastState.fallbackStatus = null;
    toastState.fallbackClearTimerId = null;
    options.onChange?.();
  }, options.durationMs ?? RUN_CENTER_FALLBACK_TOAST_DURATION_MS);
  return toastState.fallbackStatus;
}

export function resolveRunCenterTaskTranscriptSteps(task) {
  const steps = [];
  const runtimeEvents = selectConversationRuntimeTaskEventsForDisplay(task);
  for (const step of createRunCenterToolStreamSteps(runtimeEvents)) {
    appendUniqueRunCenterStep(steps, step);
  }
  for (const event of runtimeEvents) {
    if (isRunCenterToolStreamEvent(event)) {
      continue;
    }
    appendUniqueRunCenterStep(steps, formatRunCenterTaskEventStep(event));
  }
  for (const event of Array.isArray(task?.events) ? task.events : []) {
    appendUniqueRunCenterStep(steps, formatRunCenterTaskEventStep(event));
  }
  for (const step of createRunCenterTaskFallbackSteps(task)) {
    appendUniqueRunCenterStep(steps, step);
  }
  return steps;
}

function findLatestRunCenterModelFallbackEvent(tasks) {
  let latest = null;
  for (const task of tasks) {
    const events = selectConversationRuntimeTaskEventsForDisplay(task);
    for (const event of events) {
      if (event?.schemaVersion !== "conversation-runtime.event.v1" || event.kind !== "model.fallback") {
        continue;
      }
      const eventId =
        readNonEmptyRunCenterText(event.eventId) ??
        `${task?.id ?? "task"}:${event.occurredAtMs ?? event.occurredAt ?? "unknown"}:model.fallback`;
      const occurredAtMs = readRunCenterTimestampMs(event.occurredAtMs ?? event.occurredAt);
      const candidate = {
        taskId: task?.id ?? null,
        eventId,
        occurredAtMs,
        payload: event.payload ?? {},
      };
      if (latest === null || candidate.occurredAtMs >= latest.occurredAtMs) {
        latest = candidate;
      }
    }
  }
  return latest;
}

function readRunCenterTimestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatRunCenterFallbackToastStatus(fallback) {
  const payload = fallback.payload ?? {};
  const provider = readNonEmptyRunCenterText(payload.providerId ?? payload.provider);
  const model = readNonEmptyRunCenterText(payload.modelId ?? payload.model);
  const selected = [provider, model].filter(Boolean).join("/") || "模型服务";
  const active = payload.fallbackMode === "tool-evidence" ? "工具证据降级回答" : "降级处理";
  const reasonParts = [
    readNonEmptyRunCenterText(payload.errorClass),
    readNonEmptyRunCenterText(payload.message ?? payload.reason),
  ].filter(Boolean);
  return {
    phase: "active",
    selected,
    active,
    reason: reasonParts.join(" · ") || undefined,
    taskId: fallback.taskId,
    eventId: fallback.eventId,
    occurredAtMs: fallback.occurredAtMs,
  };
}

function appendUniqueRunCenterStep(steps, step) {
  if (step === null || steps.some((item) => item.key === step.key)) {
    return;
  }
  steps.push(step);
}

function createRunCenterToolStreamSteps(events) {
  const entries = new Map();
  const order = [];
  for (const event of events) {
    if (!isRunCenterToolStreamEvent(event)) {
      continue;
    }
    const payload = event.payload ?? {};
    const toolCallId = readNonEmptyRunCenterText(payload.toolCallId);
    if (toolCallId === null) {
      continue;
    }
    let entry = entries.get(toolCallId);
    if (entry === undefined) {
      entry = {
        toolCallId,
        toolName: readNonEmptyRunCenterText(payload.toolName) ?? "受控工具",
        startedAtMs: event.occurredAtMs,
        updatedAtMs: event.occurredAtMs,
        state: "active",
        inputPreview: null,
        outputPreview: null,
        error: null,
      };
      entries.set(toolCallId, entry);
      order.push(toolCallId);
    }
    applyRunCenterToolStreamEvent(entry, event);
  }
  return order.map((toolCallId) => formatRunCenterToolStreamStep(entries.get(toolCallId))).filter(Boolean);
}

function isRunCenterToolStreamEvent(event) {
  return (
    event?.schemaVersion === "conversation-runtime.event.v1" &&
    (event.kind === "tool.started" || event.kind === "tool.completed" || event.kind === "tool.failed") &&
    readNonEmptyRunCenterText(event.payload?.toolCallId) !== null
  );
}

function applyRunCenterToolStreamEvent(entry, event) {
  const payload = event.payload ?? {};
  entry.toolName = readNonEmptyRunCenterText(payload.toolName) ?? entry.toolName;
  entry.updatedAtMs = event.occurredAtMs ?? entry.updatedAtMs;
  entry.startedAtMs = Math.min(entry.startedAtMs ?? entry.updatedAtMs, event.occurredAtMs ?? entry.updatedAtMs);
  entry.inputPreview = readNonEmptyRunCenterText(payload.inputPreview) ?? entry.inputPreview;
  entry.outputPreview =
    readNonEmptyRunCenterText(payload.outputPreview) ??
    readNonEmptyRunCenterText(payload.summary) ??
    entry.outputPreview;
  entry.error =
    readNonEmptyRunCenterText(payload.error) ??
    readNonEmptyRunCenterText(payload.message) ??
    entry.error;
  if (event.kind === "tool.failed") {
    entry.state = "failed";
  } else if (event.kind === "tool.completed" && entry.state !== "failed") {
    entry.state = "done";
  }
}

function formatRunCenterToolStreamStep(entry) {
  if (entry === undefined) {
    return null;
  }
  const readable = formatRuntimeToolName(entry.toolName);
  const parts = [entry.state === "active" ? `正在执行 ${readable}` : `已执行 ${readable}`];
  if (entry.inputPreview) {
    parts.push(`输入 ${formatRunCenterToolPreviewText(entry.inputPreview)}`);
  }
  if (entry.outputPreview) {
    parts.push(`输出 ${formatRunCenterToolPreviewText(entry.outputPreview)}`);
  }
  if (entry.error) {
    parts.push(`失败原因 ${formatRunCenterToolPreviewText(entry.error)}`);
  }
  const elapsed = formatRunCenterToolStreamElapsed(entry.startedAtMs, entry.updatedAtMs);
  if (elapsed !== null) {
    parts.push(elapsed);
  }
  return {
    key: `tool-stream:${entry.toolCallId}`,
    kind: classifyRunCenterTaskStepKind(entry.toolName, parts.join(" ")),
    state: entry.state,
    time: formatRunCenterTaskStepTime(entry.startedAtMs),
    label: parts.join(" · "),
  };
}

function selectConversationRuntimeTaskEventsForDisplay(task) {
  const runtimeEventsV1 =
    Array.isArray(task?.runtimeEventsV1) && task.runtimeEventsV1.length > 0
      ? task.runtimeEventsV1
      : Array.isArray(task?.payload?.runtimeEventsV1) && task.payload.runtimeEventsV1.length > 0
        ? task.payload.runtimeEventsV1
        : Array.isArray(task?.summary?.runtimeEventsV1) && task.summary.runtimeEventsV1.length > 0
          ? task.summary.runtimeEventsV1
          : null;
  if (runtimeEventsV1 !== null) {
    return filterRunCenterRuntimeEventsForTask(runtimeEventsV1, task);
  }
  return filterRunCenterRuntimeEventsForTask(Array.isArray(task?.runtimeEvents) ? task.runtimeEvents : [], task);
}

function filterRunCenterRuntimeEventsForTask(events, task) {
  const expected = readRunCenterTaskEventScope(task);
  if (expected.turnId === null && expected.sessionKey === null && expected.runId === null) {
    return events;
  }
  return events.filter((event) => doesRunCenterRuntimeEventBelongToTask(event, expected));
}

function readRunCenterTaskEventScope(task) {
  return {
    turnId:
      readNonEmptyRunCenterText(task?.turnId) ??
      readNonEmptyRunCenterText(task?.payload?.turnId) ??
      readNonEmptyRunCenterText(task?.summary?.turnId),
    sessionKey:
      readNonEmptyRunCenterText(task?.sessionKey) ??
      readNonEmptyRunCenterText(task?.payload?.sessionKey) ??
      readNonEmptyRunCenterText(task?.summary?.sessionKey) ??
      readNonEmptyRunCenterText(task?.conversationId) ??
      readNonEmptyRunCenterText(task?.payload?.conversationId) ??
      readNonEmptyRunCenterText(task?.summary?.conversationId),
    runId:
      readNonEmptyRunCenterText(task?.activeRunId) ??
      readNonEmptyRunCenterText(task?.runId) ??
      readNonEmptyRunCenterText(task?.turnRunId) ??
      readNonEmptyRunCenterText(task?.payload?.activeRunId) ??
      readNonEmptyRunCenterText(task?.payload?.runId) ??
      readNonEmptyRunCenterText(task?.payload?.turnRunId) ??
      readNonEmptyRunCenterText(task?.summary?.activeRunId) ??
      readNonEmptyRunCenterText(task?.summary?.runId) ??
      readNonEmptyRunCenterText(task?.summary?.turnRunId),
  };
}

function doesRunCenterRuntimeEventBelongToTask(event, expected) {
  if (expected.turnId !== null && hasConflictingRunCenterEventValue(readRunCenterEventTurnId(event), expected.turnId)) {
    return false;
  }
  if (
    expected.sessionKey !== null &&
    hasConflictingRunCenterEventValue(readRunCenterEventSessionKey(event), expected.sessionKey)
  ) {
    return false;
  }
  if (expected.runId !== null && hasConflictingRunCenterEventValue(readRunCenterEventRunId(event), expected.runId)) {
    return false;
  }
  return true;
}

function hasConflictingRunCenterEventValue(actual, expected) {
  return actual !== null && normalizeRunCenterScopeValue(actual) !== normalizeRunCenterScopeValue(expected);
}

function normalizeRunCenterScopeValue(value) {
  return String(value ?? "").trim();
}

function readRunCenterEventTurnId(event) {
  const explicit =
    readNonEmptyRunCenterText(event?.turnId) ??
    readNonEmptyRunCenterText(event?.payload?.turnId) ??
    readNonEmptyRunCenterText(event?.metadata?.turnId);
  if (explicit !== null) {
    return explicit;
  }
  const eventId = readNonEmptyRunCenterText(event?.eventId);
  const separatorIndex = eventId === null ? -1 : eventId.indexOf(":");
  return separatorIndex > 0 ? eventId.slice(0, separatorIndex) : null;
}

function readRunCenterEventSessionKey(event) {
  return (
    readNonEmptyRunCenterText(event?.sessionKey) ??
    readNonEmptyRunCenterText(event?.conversationId) ??
    readNonEmptyRunCenterText(event?.payload?.sessionKey) ??
    readNonEmptyRunCenterText(event?.payload?.conversationId) ??
    readNonEmptyRunCenterText(event?.metadata?.sessionKey) ??
    readNonEmptyRunCenterText(event?.metadata?.conversationId)
  );
}

function readRunCenterEventRunId(event) {
  return (
    readNonEmptyRunCenterText(event?.runId) ??
    readNonEmptyRunCenterText(event?.turnRunId) ??
    readNonEmptyRunCenterText(event?.payload?.runId) ??
    readNonEmptyRunCenterText(event?.payload?.turnRunId) ??
    readNonEmptyRunCenterText(event?.metadata?.runId) ??
    readNonEmptyRunCenterText(event?.metadata?.turnRunId)
  );
}

export function formatRunCenterTaskEventStep(event) {
  if (!event || typeof event !== "object") {
    return null;
  }
  const formatted = formatRunCenterTaskEventLabel(event);
  if (formatted === null) {
    return null;
  }
  const label = typeof formatted === "string" ? formatted : formatted.label;
  const time = formatRunCenterTaskStepTime(event.occurredAt ?? event.occurredAtMs);
  const type = String(event.type ?? event.kind ?? "event");
  return {
    key: `${type}:${time}:${label}`,
    kind: classifyRunCenterTaskStepKind(type, label),
    time,
    label,
    ...(typeof formatted === "object" && formatted.state ? { state: formatted.state } : {}),
    ...(typeof formatted === "object" && formatted.pointer ? { pointer: formatted.pointer } : {}),
    ...(typeof formatted === "object" && formatted.source ? { source: formatted.source } : {}),
  };
}

function formatRunCenterTaskEventLabel(event) {
  const type = String(event.type ?? event.kind ?? "");
  if (isRunCenterRuntimeStuckWarning(event)) {
    return formatRunCenterRuntimeStuckWarningLabel(event);
  }
  if (isRunCenterRuntimeStaleRecovered(event)) {
    return formatRunCenterRuntimeStaleRecoveredLabel(event);
  }
  if (event?.schemaVersion === "conversation-runtime.event.v1") {
    return formatRunCenterUnifiedRuntimeEventLabel(event);
  }
  const text =
    readNonEmptyRunCenterText(event.message) ??
    readNonEmptyRunCenterText(event.title) ??
    readNonEmptyRunCenterText(event.summary) ??
    readNonEmptyRunCenterText(event.detail) ??
    readNonEmptyRunCenterText(event.body);
  if (text !== null) {
    return formatRunCenterTaskTranscriptText(text);
  }
  if (type.includes("tool")) {
    return "正在执行工具";
  }
  if (type.includes("final")) {
    return "已整理最终回复";
  }
  return type ? formatRunCenterTaskTranscriptText(type) : null;
}

function formatRunCenterUnifiedRuntimeEventLabel(event) {
  if (event.kind === "turn.started") return "正在发送请求";
  if (String(event.kind ?? "").startsWith("moyin.")) return formatUnifiedRuntimeMoyinEventLabel(event);
  if (event.kind === "intent.classified") return formatUnifiedRuntimeIntentLabel(event.payload ?? {});
  if (event.kind === "tool.started" || event.kind === "tool.completed" || event.kind === "tool.failed") {
    return formatUnifiedRuntimeToolLabel(event);
  }
  if (event.kind === "evidence.read") return formatUnifiedRuntimeEvidenceLabel(event.payload ?? {});
  if (event.kind === "memory.recall") return formatUnifiedRuntimeMemoryRecallLabel(event.payload ?? {});
  if (event.kind === "approval.requested") return formatUnifiedRuntimeApprovalRequestedLabel(event.payload ?? {});
  if (event.kind === "approval.resolved") return formatUnifiedRuntimeApprovalResolvedLabel(event.payload ?? {});
  if (event.kind === "tool.loop_detected") return formatUnifiedRuntimeToolLoopDetectedLabel(event.payload ?? {});
  if (event.kind === "candidate.created") return "生成学习候选";
  if (event.kind === "candidate.promoted") return "晋升知识";
  if (event.kind === "model.fallback") return formatUnifiedRuntimeModelFallbackLabel(event.payload ?? {});
  if (event.kind === "subagent.failed") return formatUnifiedRuntimeSubagentFailedLabel(event.payload ?? {});
  if (event.kind === "context.compaction.started") return "开始整理上下文";
  if (event.kind === "context.compaction.partial_saved") {
    return formatUnifiedRuntimeContextCompactionPartialSavedLabel(event.payload ?? {});
  }
  if (event.kind === "context.compaction.completed") return "上下文整理完成";
  if (event.kind === "context.compaction.failed") {
    return formatUnifiedRuntimeContextCompactionFailedLabel(event.payload ?? {});
  }
  if (event.kind === "runtime.stuck_warning") return formatRunCenterRuntimeStuckWarningLabel(event);
  if (event.kind === "runtime.stale_recovered") return formatRunCenterRuntimeStaleRecoveredLabel(event);
  if (event.kind === "model.final") return "整理最终回复";
  if (event.kind === "turn.failed") {
    return formatRunCenterTaskTranscriptText(event.payload?.message ?? "执行失败");
  }
  return formatRunCenterTaskTranscriptText(event.kind);
}

function createRunCenterTaskFallbackSteps(task) {
  const time = formatRunCenterTaskStepTime(task?.updatedAt);
  return [
    task?.payload?.promptPreview
      ? {
          key: `prompt:${task.id}`,
          kind: "prompt",
          time: formatRunCenterTaskStepTime(task?.startedAt ?? task?.createdAt),
          label: `输入：${formatRunCenterTaskTranscriptText(task.payload.promptPreview)}`,
        }
      : null,
    task?.payload?.runtimeEventCount > 0 || task?.summary?.runtimeEventCount > 0
      ? {
          key: `runtime-events:${task.id}`,
          kind: "event",
          time,
          label: `模型/工具事件 ${task.payload?.runtimeEventCount ?? task.summary?.runtimeEventCount} 个`,
        }
      : null,
    task?.payload?.toolCount > 0 || task?.summary?.toolCount > 0
      ? {
          key: `tools:${task.id}`,
          kind: "tool",
          time,
          label: `工具调用 ${task.payload?.toolCount ?? task.summary?.toolCount} 个`,
        }
      : null,
  ];
}

function classifyRunCenterTaskStepKind(type, label) {
  const text = `${type} ${label}`;
  if (/fail|error|cancel|失败|取消|中断|卡住|中止/iu.test(text)) return "error";
  if (/memory|recall|context|记忆|召回|上下文|L[0-3]/iu.test(text)) return "memory";
  if (/read|extract|browser|search|读取|打开|搜索|来源|网页|https?:/iu.test(text)) return "read";
  if (/tool|command|invoke|执行|命令|工具/iu.test(text)) return "tool";
  if (/final|completed|完成|回复/iu.test(text)) return "done";
  return "event";
}

export function formatRunCenterTaskStepTime(value) {
  const timestamp = typeof value === "number" ? value : Date.parse(String(value ?? ""));
  if (!Number.isFinite(timestamp)) {
    return "--:--";
  }
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatRunCenterTaskTranscriptText(value) {
  const text = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  if (text.length === 0) {
    return "";
  }
  return text.length > 96 ? `${text.slice(0, 96)}...` : text;
}

function formatRunCenterToolPreviewText(value) {
  const text = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  if (text.length === 0) {
    return "";
  }
  if (text.length <= RUN_CENTER_TOOL_PREVIEW_CHAR_LIMIT) {
    return text;
  }
  return `${text.slice(0, RUN_CENTER_TOOL_PREVIEW_CHAR_LIMIT)}...（已截断，原始 ${text.length} 字符）`;
}

function formatRunCenterToolStreamElapsed(startedAtMs, updatedAtMs) {
  const start = Number(startedAtMs);
  const end = Number(updatedAtMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  const elapsedMs = end - start;
  if (elapsedMs < 1000) {
    return `${elapsedMs}ms`;
  }
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}

export function formatTaskRuntimeStatus(status) {
  const labels = {
    pending: "等待",
    queued: "排队",
    running: "运行",
    retry_wait: "重试",
    completed: "完成",
    failed: "失败",
    interrupted: "中断",
    cancelled: "取消",
  };
  return labels[status] ?? "未知";
}

function formatTaskRuntimeLane(lane) {
  const labels = {
    text: "文本",
    image: "图片",
    video: "视频",
    compose: "合成",
    workflow: "流程",
  };
  return labels[lane] ?? null;
}

function formatTaskRuntimeUserFacingLabel(task) {
  if (task?.category === "conversation-runtime" || task?.payload?.source === "desktop.conversation-runtime") {
    return "Angel 回复";
  }
  return task?.label ?? "任务";
}

function formatTaskRuntimeUserFacingMetaParts(task) {
  const parts = [formatTaskRuntimeLane(task?.lane)];
  if (task?.category !== "conversation-runtime" && task?.payload?.source !== "desktop.conversation-runtime") {
    parts.push(scrubTaskRuntimeMetaText(task?.provider), scrubTaskRuntimeMetaText(task?.model));
  }
  parts.push(formatTaskRuntimeTimeLabel(task?.updatedAt));
  return parts;
}

function scrubTaskRuntimeMetaText(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || /conversation-runtime|runtime|provider|bridge|undefined/iu.test(text)) {
    return null;
  }
  return text;
}

function formatTaskRuntimeRelativeTime(timestamp) {
  const diff = Date.now() - Number(timestamp ?? 0);
  if (!Number.isFinite(diff) || diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  return `${Math.max(1, Math.floor(diff / 3_600_000))} 小时前`;
}

export function formatTaskRuntimeTimeLabel(timestamp) {
  const relative = formatTaskRuntimeRelativeTime(timestamp);
  const exact = formatEpochDate(Number(timestamp ?? 0));
  return exact === "未知" ? relative : `${relative} · ${exact}`;
}

export function formatTaskRuntimeEventPreview(task) {
  const parts = [];
  collectTaskRuntimeEventPreviewParts(parts, Array.isArray(task?.events) ? task.events : []);
  if (parts.length === 0) {
    collectTaskRuntimeEventPreviewParts(parts, selectConversationRuntimeTaskEventsForDisplay(task));
  }
  if (parts.length > 0) {
    return parts.join(" · ");
  }
  const fallback =
    readNonEmptyRunCenterText(task?.summary?.previewSummary) ??
    readNonEmptyRunCenterText(task?.summary?.finalTextPreview) ??
    readNonEmptyRunCenterText(task?.payload?.finalTextPreview) ??
    readNonEmptyRunCenterText(task?.payload?.promptPreview) ??
    readNonEmptyRunCenterText(task?.payload?.prompt) ??
    readNonEmptyRunCenterText(task?.description) ??
    readNonEmptyRunCenterText(task?.error);
  return fallback ? formatTaskRuntimeCompactText(fallback) : null;
}

function collectTaskRuntimeEventPreviewParts(parts, events) {
  for (const event of Array.isArray(events) ? events : []) {
    const text = formatTaskRuntimeEventPreviewText(event);
    if (!text || parts.includes(text)) {
      continue;
    }
    parts.push(text);
    if (parts.length >= 2) {
      break;
    }
  }
}

function formatTaskRuntimeEventPreviewText(event) {
  if (!event || typeof event !== "object") {
    return null;
  }
  if (isRunCenterRuntimeStuckWarning(event)) {
    return formatTaskRuntimeCompactText(readRunCenterFormattedLabelText(formatRunCenterRuntimeStuckWarningLabel(event)));
  }
  if (isRunCenterRuntimeStaleRecovered(event)) {
    return formatTaskRuntimeCompactText(readRunCenterFormattedLabelText(formatRunCenterRuntimeStaleRecoveredLabel(event)));
  }
  if (event.schemaVersion === "conversation-runtime.event.v1") {
    return formatTaskRuntimeCompactText(readRunCenterFormattedLabelText(formatRunCenterUnifiedRuntimeEventLabel(event)));
  }
  const explicit =
    readNonEmptyRunCenterText(event.message) ??
    readNonEmptyRunCenterText(event.title) ??
    readNonEmptyRunCenterText(event.summary) ??
    readNonEmptyRunCenterText(event.detail) ??
    readNonEmptyRunCenterText(event.body);
  if (explicit) {
    return formatTaskRuntimeCompactText(explicit);
  }
  if (event.kind === "runtime.tool") {
    return formatRuntimeToolTranscriptLabel(event.payload?.tool ?? {});
  }
  if (event.kind === "runtime.artifact") {
    const artifact = event.payload?.artifact ?? {};
    return `已生成 ${artifact.title ?? artifact.kind ?? "结果产物"}`;
  }
  if (event.kind === "runtime.approval") {
    const approval = event.payload?.approval ?? {};
    return approval.summary ?? approval.title ?? "等待人工确认";
  }
  if (event.kind === "runtime.error") {
    return event.payload?.message ?? "执行失败";
  }
  const type = readNonEmptyRunCenterText(event.type ?? event.kind);
  return type ? formatTaskRuntimeCompactText(type) : null;
}

function formatTaskRuntimeCompactText(value) {
  const text = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  if (text.length === 0) {
    return null;
  }
  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

function readNonEmptyRunCenterText(value) {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function readFiniteRunCenterNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readFirstRunCenterString(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const found = value.find((item) => typeof item === "string" && item.trim().length > 0);
  return typeof found === "string" ? found.trim() : null;
}

function isRunCenterRuntimeStuckWarning(event) {
  return String(event?.kind ?? event?.type ?? "").includes("runtime.stuck_warning");
}

function isRunCenterRuntimeStaleRecovered(event) {
  return String(event?.kind ?? event?.type ?? "").includes("runtime.stale_recovered");
}

function formatRunCenterRuntimeStuckWarningLabel(event) {
  const payload = readRunCenterRuntimeDiagnosticPayload(event);
  const idleForMs = readFiniteRunCenterNumber(payload.idleForMs);
  const thresholdMs = readFiniteRunCenterNumber(payload.thresholdMs);
  const lastActivityAtMs = readFiniteRunCenterNumber(payload.lastActivityAtMs);
  const activeModelCall = readNonEmptyRunCenterText(payload.activeModelCall);
  const activeToolCalls = readRunCenterStringList(payload.activeToolCalls);
  const activeSubagentRunIds = readRunCenterStringList(payload.activeSubagentRunIds);
  const parts = [
    "运行可能卡住",
    idleForMs === null ? null : `已 ${formatRunCenterDuration(idleForMs)} 无新事件`,
    thresholdMs === null ? null : `阈值 ${formatRunCenterDuration(thresholdMs)}`,
    lastActivityAtMs === null ? null : `最后活动 ${formatRunCenterTaskStepTime(lastActivityAtMs)}`,
    activeModelCall === null ? null : `模型 ${activeModelCall}`,
    activeToolCalls.length === 0 ? null : `工具 ${activeToolCalls.join("、")}`,
    activeSubagentRunIds.length === 0 ? null : `子任务 ${activeSubagentRunIds.join("、")}`,
  ].filter(Boolean);
  return {
    label: parts.join(" · "),
    state: "warning",
  };
}

function formatRunCenterRuntimeStaleRecoveredLabel(event) {
  const payload = readRunCenterRuntimeDiagnosticPayload(event);
  const fromStatus = readNonEmptyRunCenterText(payload.fromStatus);
  const reason = readNonEmptyRunCenterText(payload.reason);
  const parts = [
    "重启后发现旧运行已中止",
    fromStatus === null ? null : `原状态 ${fromStatus}`,
    reason === null ? null : `原因 ${reason}`,
  ].filter(Boolean);
  return {
    label: parts.join(" · "),
    state: "cancelled",
  };
}

function readRunCenterRuntimeDiagnosticPayload(event) {
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  const metadata = event?.metadata && typeof event.metadata === "object" ? event.metadata : {};
  return { ...metadata, ...payload };
}

function readRunCenterStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => readNonEmptyRunCenterText(item)).filter(Boolean);
}

function readRunCenterFormattedLabelText(formatted) {
  return typeof formatted === "string" ? formatted : formatted?.label ?? null;
}

function formatRunCenterDuration(valueMs) {
  const totalSeconds = Math.max(0, Math.round(Number(valueMs) / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}秒`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds === 0 ? `${minutes}分钟` : `${minutes}分${seconds}秒`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}小时` : `${hours}小时${remainingMinutes}分钟`;
}

function formatEpochDate(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "未知";
  }
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isTaskRuntimeActive(task) {
  return TASK_RUNTIME_ACTIVE_STATUSES.has(task?.status);
}

function formatUnifiedRuntimeIntentLabel(payload) {
  const intentKind = payload.intentKind ?? "unknown";
  if (intentKind === "learning-admit") return "运行时意图：学习资料";
  if (intentKind === "learning-confirmation") return "运行时意图：学习确认";
  if (intentKind === "chat") return "运行时意图：普通对话";
  return `运行时意图：${intentKind}`;
}

function formatUnifiedRuntimeMoyinEventLabel(event) {
  const kind = String(event.kind ?? "");
  const payload = readRunCenterRuntimeDiagnosticPayload(event);
  const parts = [
    formatMoyinRuntimeEventAction(kind),
    formatMoyinRuntimeEventRefs(event, payload),
    formatMoyinRuntimeEventCommand(payload),
    formatMoyinRuntimeEventApproval(kind, payload),
    formatMoyinRuntimeEventWatch(kind, payload),
    formatMoyinRuntimeEventPackage(kind, payload),
    formatMoyinRuntimeEventError(kind, payload),
  ].filter(Boolean);
  return {
    label: formatMoyinRuntimeEventTranscriptText(parts.join(" · ")),
    ...formatMoyinRuntimeEventState(kind),
    source: createMoyinRuntimeEventSource(event, payload),
  };
}

function formatMoyinRuntimeEventTranscriptText(value) {
  const text = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  if (text.length === 0) {
    return "";
  }
  return text.length > 320 ? `${text.slice(0, 320)}...` : text;
}

function formatMoyinRuntimeEventAction(kind) {
  if (kind === "moyin.video_production.plan.started") return "Moyin 制作计划开始";
  if (kind === "moyin.video_production.plan.completed") return "Moyin 制作计划完成";
  if (kind === "moyin.workflow_run.create.started") return "Moyin 创建工作流";
  if (kind === "moyin.workflow_run.create.completed") return "Moyin 工作流已创建";
  if (kind === "moyin.workflow_run.create.failed") return "Moyin 工作流创建失败";
  if (kind === "moyin.workflow_run.next_gate.started") return "Moyin 检查下一步";
  if (kind === "moyin.workflow_run.next_gate.completed") return "Moyin 下一步已确认";
  if (kind === "moyin.workflow_run.next_gate.failed") return "Moyin 下一步检查失败";
  if (kind === "moyin.workflow_run.approval_packet.created") return "Moyin 等待审批";
  if (kind === "moyin.workflow_run.execute.started") return "Moyin 执行步骤";
  if (kind === "moyin.workflow_run.execute.failed") return "Moyin 执行失败";
  if (kind === "moyin.workflow_run.task_watch.started") return "Moyin 开始 watch";
  if (kind === "moyin.workflow_run.task_watch.heartbeat") return "Moyin watch 心跳";
  if (kind === "moyin.workflow_run.task_watch.completed") return "Moyin watch 完成";
  if (kind === "moyin.workflow_run.task_watch.timeout") return "Moyin watch 超时";
  if (kind === "moyin.workflow_run.task_watch.failed") return "Moyin watch 失败";
  if (kind === "moyin.workflow_run.resume.started") return "Moyin 恢复 watch";
  if (kind === "moyin.workflow_run.package.started") return "Moyin 收集产物";
  if (kind === "moyin.workflow_run.package.completed") return "Moyin 产物收集完成";
  if (kind === "moyin.workflow_run.package.failed") return "Moyin 产物收集失败";
  if (kind === "moyin.workflow_run.cancel.started") return "Moyin 取消开始";
  if (kind === "moyin.workflow_run.cancel.completed") return "Moyin 已取消";
  if (kind === "moyin.workflow_run.cancel.failed") return "Moyin 取消失败";
  if (kind === "moyin.workflow_run.task_cancel.completed") return "Moyin 任务已取消";
  if (kind === "moyin.workflow_run.task_cancel.failed") return "Moyin 任务取消失败";
  return "Moyin 运行事件";
}

function formatMoyinRuntimeEventRefs(event, payload) {
  const refs = [
    ["项目", event.projectId ?? payload.projectId],
    ["run", event.runId ?? payload.runId],
    ["步骤", event.stepId ?? payload.stepId],
    ["任务", event.taskId ?? payload.taskId],
    ["sealed", event.sealedRequestId ?? payload.sealedRequestId],
    ["恢复", event.resumeToken ?? payload.resumeToken],
  ]
    .map(([label, value]) => {
      const text = readNonEmptyRunCenterText(value);
      return text === null ? null : `${label} ${text}`;
    })
    .filter(Boolean);
  return refs.length === 0 ? null : refs.join(" · ");
}

function createMoyinRuntimeEventSource(event, payload) {
  const projectId = readNonEmptyRunCenterText(event.projectId ?? payload.projectId);
  const runId = readNonEmptyRunCenterText(event.runId ?? payload.runId);
  const stepId = readNonEmptyRunCenterText(event.stepId ?? payload.stepId);
  const taskId = readNonEmptyRunCenterText(event.taskId ?? payload.taskId);
  const sealedRequestId = readNonEmptyRunCenterText(event.sealedRequestId ?? payload.sealedRequestId);
  const resumeToken = readNonEmptyRunCenterText(event.resumeToken ?? payload.resumeToken);
  const command = readNonEmptyRunCenterText(payload.command ?? payload.shellCommand);
  const approvalId = readNonEmptyRunCenterText(payload.approvalId);
  const artifactCount = readFiniteRunCenterNumber(payload.artifactCount);
  const backfillAttemptedCount = readFiniteRunCenterNumber(payload.backfillAttemptedCount);
  const exports = [
    payload.jsonExportRequested === true ? "json" : null,
    payload.comfyuiDraftRequested === true ? "comfyui-draft" : null,
  ].filter(Boolean);
  return {
    type: "moyin",
    ...(projectId === null ? {} : { projectId }),
    ...(runId === null ? {} : { runId }),
    ...(stepId === null ? {} : { stepId }),
    ...(taskId === null ? {} : { taskId }),
    ...(sealedRequestId === null ? {} : { sealedRequestId }),
    ...(resumeToken === null ? {} : { resumeToken }),
    ...(command === null ? {} : { command }),
    ...(approvalId === null ? {} : { approvalId }),
    ...(artifactCount === null ? {} : { artifactCount }),
    ...(backfillAttemptedCount === null ? {} : { backfillAttemptedCount }),
    ...(exports.length === 0 ? {} : { exports }),
    ...(typeof payload.readyForComfyUi === "boolean" ? { readyForComfyUi: payload.readyForComfyUi } : {}),
  };
}

function formatMoyinRuntimeEventCommand(payload) {
  const command = readNonEmptyRunCenterText(payload.command ?? payload.shellCommand);
  return command === null ? null : `命令 ${command}`;
}

function formatMoyinRuntimeEventApproval(kind, payload) {
  if (!kind.includes("approval")) {
    return null;
  }
  const approvalId = readNonEmptyRunCenterText(payload.approvalId);
  const action = readNonEmptyRunCenterText(payload.advanceAction ?? payload.action);
  return ["审批包", approvalId === null ? null : `审批 ${approvalId}`, action === null ? null : `动作 ${action}`]
    .filter(Boolean)
    .join(" · ");
}

function formatMoyinRuntimeEventWatch(kind, payload) {
  if (!kind.includes("task_watch") && !kind.includes("resume")) {
    return null;
  }
  const heartbeatIntervalMs = readFiniteRunCenterNumber(payload.heartbeatIntervalMs);
  const watchTimeoutMs = readFiniteRunCenterNumber(payload.watchTimeoutMs);
  return [
    heartbeatIntervalMs === null ? null : `心跳 ${formatRunCenterDuration(heartbeatIntervalMs)}`,
    watchTimeoutMs === null ? null : `超时 ${formatRunCenterDuration(watchTimeoutMs)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatMoyinRuntimeEventPackage(kind, payload) {
  if (!kind.includes("package")) {
    return null;
  }
  const artifactCount = readFiniteRunCenterNumber(payload.artifactCount);
  const backfillAttemptedCount = readFiniteRunCenterNumber(payload.backfillAttemptedCount);
  const exports = [
    payload.jsonExportRequested === true ? "json" : null,
    payload.comfyuiDraftRequested === true ? "comfyui-draft" : null,
  ].filter(Boolean);
  const readyForComfyUi =
    payload.readyForComfyUi === true
      ? "ComfyUI 就绪"
      : payload.readyForComfyUi === false
        ? "ComfyUI 未就绪"
        : null;
  return [
    artifactCount === null ? null : `产物 ${artifactCount} 个`,
    backfillAttemptedCount === null ? null : `回填 ${backfillAttemptedCount} 次`,
    exports.length === 0 ? null : `导出 ${exports.join("、")}`,
    readyForComfyUi,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatMoyinRuntimeEventError(kind, payload) {
  if (!/failed|timeout|cancel/iu.test(kind)) {
    return null;
  }
  const error = readNonEmptyRunCenterText(payload.error ?? payload.errorCode ?? payload.message);
  return error === null ? null : `原因 ${error}`;
}

function formatMoyinRuntimeEventState(kind) {
  if (/failed|timeout/iu.test(kind)) return { state: "failed" };
  if (/approval|waiting/iu.test(kind)) return { state: "waiting" };
  if (/completed|created|package\.completed/iu.test(kind)) return { state: "done" };
  if (/started|heartbeat|resume|execute/iu.test(kind)) return { state: "active" };
  return {};
}

function formatUnifiedRuntimeToolLabel(event) {
  const payload = event.payload ?? {};
  const name = payload.toolName ?? "受控工具";
  const readable = formatRuntimeToolName(name);
  if (event.kind === "tool.started") return `正在执行 ${readable}`;
  if (event.kind === "tool.failed") return `${readable} 执行失败`;
  if (String(name).includes("web_extract") || String(name).includes("browser") || String(name).includes("x_")) {
    return `已读取 ${readable}`;
  }
  return `已执行 ${readable}`;
}

function formatUnifiedRuntimeEvidenceLabel(payload) {
  const sourceUrl = readNonEmptyRunCenterText(payload.sourceUrl);
  if (sourceUrl) {
    return `已读取 ${sourceUrl}`;
  }
  return "已读取证据来源";
}

function formatUnifiedRuntimeMemoryRecallLabel(payload) {
  const hitCount = readFiniteRunCenterNumber(payload.hitCount) ?? 0;
  const status = readNonEmptyRunCenterText(payload.status);
  const hits = Array.isArray(payload.hits) ? payload.hits : [];
  const firstHit = hits.find((hit) => hit && typeof hit === "object") ?? {};
  const layerLabel =
    readNonEmptyRunCenterText(firstHit.layerLabel) ??
    readNonEmptyRunCenterText(firstHit.memoryLayer) ??
    readFirstRunCenterString(payload.layers);
  const sourceFile = readNonEmptyRunCenterText(firstHit.sourceFile);
  const drawerId = readNonEmptyRunCenterText(firstHit.drawerId ?? firstHit.drawer_id);
  const verbatimExcerpt = readNonEmptyRunCenterText(firstHit.verbatimExcerpt);
  const drawerContent = readNonEmptyRunCenterText(firstHit.drawerContent);
  const drawerIndex = readFiniteRunCenterNumber(firstHit.drawerIndex);
  const totalDrawers = readFiniteRunCenterNumber(firstHit.totalDrawers);
  const pointerParts = [
    sourceFile,
    drawerIndex === null ? null : `drawer ${drawerIndex}${totalDrawers === null ? "" : `/${totalDrawers}`}`,
  ].filter(Boolean);
  const degradedReasons = Array.isArray(payload.degradedReasons)
    ? payload.degradedReasons
        .map((reason) => readNonEmptyRunCenterText(reason))
        .filter(Boolean)
    : [];
  const copyPointer = [
    sourceFile,
    layerLabel,
    drawerIndex === null ? null : `drawer ${drawerIndex}${totalDrawers === null ? "" : `/${totalDrawers}`}`,
  ].filter(Boolean);
  const parts = [
    status === "degraded" ? "记忆召回降级" : `召回记忆 ${hitCount} 条`,
    layerLabel,
    pointerParts.length === 0 ? null : pointerParts.join(" · "),
    degradedReasons.length === 0 ? null : `原因 ${degradedReasons.join("；")}`,
  ].filter(Boolean);
  return {
    label: formatRunCenterTaskTranscriptText(parts.join(" · ")),
    ...(status === "degraded" ? { state: "failed" } : {}),
    ...(copyPointer.length === 0 ? {} : { pointer: copyPointer.join(" · ") }),
    ...(sourceFile === null
      ? {}
      : {
          source: {
            sourceFile,
            ...(drawerId === null ? {} : { drawerId }),
            ...(layerLabel === null ? {} : { layerLabel }),
            ...(verbatimExcerpt === null ? {} : { verbatimExcerpt }),
            ...(drawerContent === null ? {} : { drawerContent }),
            ...(drawerIndex === null ? {} : { drawerIndex }),
            ...(totalDrawers === null ? {} : { totalDrawers }),
          },
        }),
  };
}

function formatUnifiedRuntimeModelFallbackLabel(payload) {
  const mode = readNonEmptyRunCenterText(payload.fallbackMode);
  const providerId = readNonEmptyRunCenterText(payload.providerId ?? payload.provider);
  const modelId = readNonEmptyRunCenterText(payload.modelId ?? payload.model);
  const errorClass = readNonEmptyRunCenterText(payload.errorClass);
  const message = readNonEmptyRunCenterText(payload.message ?? payload.reason);
  const parts = [
    mode === "tool-evidence" ? "模型服务暂时不可用，已用工具证据降级回答" : "模型服务暂时不可用，已降级处理",
    providerId === null ? null : `供应方 ${providerId}`,
    modelId === null ? null : `模型 ${modelId}`,
    errorClass === null ? null : `错误类别 ${errorClass}`,
    message === null ? null : `原因 ${message}`,
  ].filter(Boolean);
  return formatRunCenterTaskTranscriptText(parts.join(" · "));
}

function formatUnifiedRuntimeApprovalRequestedLabel(payload) {
  const toolName = readNonEmptyRunCenterText(payload.toolName);
  const summary = readNonEmptyRunCenterText(payload.summary);
  const approvalId = readNonEmptyRunCenterText(payload.approvalId);
  const parts = [
    "等待确认",
    toolName === null ? null : formatRuntimeToolName(toolName),
    summary,
    approvalId === null ? null : `审批 ${approvalId}`,
  ].filter(Boolean);
  return parts.join(" · ");
}

function formatUnifiedRuntimeApprovalResolvedLabel(payload) {
  const status = readNonEmptyRunCenterText(payload.status);
  const toolName = readNonEmptyRunCenterText(payload.toolName);
  const parts = [
    status === "approved" ? "确认已通过" : "确认已处理",
    toolName === null ? null : formatRuntimeToolName(toolName),
    status === null ? null : `状态 ${status}`,
  ].filter(Boolean);
  return parts.join(" · ");
}

function formatUnifiedRuntimeToolLoopDetectedLabel(payload) {
  const toolName = readNonEmptyRunCenterText(payload.toolName);
  const reason = readNonEmptyRunCenterText(payload.reason);
  const parts = [
    "工具重复调用已拦截",
    toolName === null ? null : formatRuntimeToolName(toolName),
    reason === null ? null : `原因 ${reason}`,
  ].filter(Boolean);
  return parts.join(" · ");
}

function formatUnifiedRuntimeSubagentFailedLabel(payload) {
  const subagentId = readNonEmptyRunCenterText(payload.subagentId);
  const role = readNonEmptyRunCenterText(payload.role);
  const workerId = readNonEmptyRunCenterText(payload.workerId);
  const error = readNonEmptyRunCenterText(payload.error ?? payload.message ?? payload.reason);
  const parts = [
    "子任务失败",
    subagentId === null ? null : `子任务 ${subagentId}`,
    role === null ? null : `角色 ${role}`,
    workerId === null ? null : `执行器 ${workerId}`,
    error === null ? null : `原因 ${error}`,
  ].filter(Boolean);
  return {
    label: formatRunCenterTaskTranscriptText(parts.join(" · ")),
    state: "failed",
  };
}

function formatUnifiedRuntimeContextCompactionPartialSavedLabel(payload) {
  const checkpointId = readNonEmptyRunCenterText(payload.checkpointId);
  const reason = readNonEmptyRunCenterText(payload.reason);
  const summaryPreview = readNonEmptyRunCenterText(payload.summaryPreview);
  const parts = [
    "上下文已保留部分摘要",
    checkpointId === null ? null : `检查点 ${checkpointId}`,
    reason === null ? null : `原因 ${reason}`,
    summaryPreview,
  ].filter(Boolean);
  return {
    label: formatRunCenterTaskTranscriptText(parts.join(" · ")),
    state: "warning",
  };
}

function formatUnifiedRuntimeContextCompactionFailedLabel(payload) {
  const checkpointId = readNonEmptyRunCenterText(payload.checkpointId);
  const reason = readNonEmptyRunCenterText(payload.reason ?? payload.message);
  const partialAvailable = payload.partialSummaryAvailable === true;
  const parts = [
    partialAvailable ? "上下文压缩失败，但已保留部分摘要" : "上下文压缩失败",
    checkpointId === null ? null : `检查点 ${checkpointId}`,
    reason === null ? null : `原因 ${reason}`,
  ].filter(Boolean);
  return {
    label: formatRunCenterTaskTranscriptText(parts.join(" · ")),
    state: "failed",
  };
}

function formatRuntimeToolTranscriptLabel(tool) {
  const name = tool.name ?? "受控工具";
  const readable = formatRuntimeToolName(name);
  if (tool.phase === "requested") return `正在执行 ${readable}`;
  if (tool.phase === "failed") return `${readable} 执行失败`;
  if (name.includes("web_extract") || name.includes("browser") || name.includes("x_")) {
    return `已读取 ${readable}`;
  }
  return `已执行 ${readable}`;
}

function formatRuntimeToolName(name) {
  const labels = {
    browser_navigate: "打开网页",
    browser_snapshot: "读取页面",
    "director.opencli.invoke": "OpenCLI",
    "director.experience.candidates.list": "经验候选列表",
    web_extract: "网页正文提取",
    web_extract_artifact_read: "读取网页正文",
    web_search: "网页搜索",
    x_search: "X 搜索",
  };
  return labels[name] ?? name ?? "受控工具";
}
