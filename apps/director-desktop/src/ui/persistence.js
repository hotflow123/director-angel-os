const UI_STATE_SCHEMA_VERSION = "director.desktop.ui-state.v1";
const COMPOSER_HISTORY_LIMIT = 80;
const COMPOSER_ATTACHMENT_LIMIT = 8;
const SESSION_TRANSCRIPT_LIMIT = 80;
const SESSION_TRANSCRIPT_BODY_LIMIT = 12000;
const RECENT_RUN_CENTER_TASK_LIMIT = 12;
const SAFE_RUN_CENTER_PANELS = new Set(["active", "problem", "history"]);
const ACTIVE_TASK_RUNTIME_STATUSES = new Set(["pending", "queued", "running", "retry_wait"]);
const SAFE_TASK_RUNTIME_STATUSES = new Set([
  "completed",
  "failed",
  "interrupted",
  "cancelled",
  "needs_attention",
]);
const SAFE_SETTINGS_TABS = new Set([
  "api",
  "models",
  "externalTools",
  "guardrails",
  "communications",
  "switches",
  "paths",
  "diagnostics",
]);

export function createDesktopUiPersistenceSnapshot(state) {
  return {
    schemaVersion: UI_STATE_SCHEMA_VERSION,
    chat: {
      composerDraft: readString(state?.chat?.composer?.input),
      composerHistory: readStringArray(state?.chat?.composer?.history).slice(-COMPOSER_HISTORY_LIMIT),
      composerAttachments: readComposerAttachmentMetadataList(state?.chat?.composer?.attachments),
      lastSubmittedMessage: readNullableString(state?.chat?.lastSubmittedMessage),
      sessionKey: readDesktopSessionKey(state?.chat?.sessionKey),
      sessions: readDesktopSessionList(state?.chat?.sessions),
      sessionTranscripts: readDesktopSessionTranscripts(state?.chat?.sessionTranscripts),
    },
    taskRuntime: {
      activePanel: readEnum(state?.taskRuntime?.activePanel, SAFE_RUN_CENTER_PANELS, "active"),
      recentTasks: readRestartSafeRecentTasks(state?.taskRuntime?.tasks),
    },
    selectedSettingsTab: readEnum(state?.selectedSettingsTab, SAFE_SETTINGS_TABS, "api"),
  };
}

export function applyDesktopUiPersistenceSnapshot(state, snapshot) {
  if (!state || snapshot?.schemaVersion !== UI_STATE_SCHEMA_VERSION) {
    return false;
  }
  const chat = snapshot.chat ?? {};
  const composer = state.chat?.composer;
  if (composer) {
    composer.history = readStringArray(chat.composerHistory).slice(-COMPOSER_HISTORY_LIMIT);
    if (typeof composer.setInput === "function") {
      composer.setInput(readString(chat.composerDraft));
    } else {
      composer.input = readString(chat.composerDraft);
    }
    composer.attachments = readComposerAttachmentMetadataList(chat.composerAttachments);
  }
  if (state.chat) {
    state.chat.lastSubmittedMessage = readNullableString(chat.lastSubmittedMessage);
    state.chat.sessionKey = readDesktopSessionKey(chat.sessionKey, state.chat.sessionKey);
    state.chat.sessions = readDesktopSessionList(chat.sessions);
    state.chat.sessionTranscripts = readDesktopSessionTranscripts(chat.sessionTranscripts);
  }
  if (state.taskRuntime) {
    state.taskRuntime.activePanel = readEnum(
      snapshot.taskRuntime?.activePanel,
      SAFE_RUN_CENTER_PANELS,
      state.taskRuntime.activePanel ?? "active",
    );
    state.taskRuntime.tasks = readRestartSafeRecentTasks(snapshot.taskRuntime?.recentTasks);
  }
  state.selectedSettingsTab = readEnum(
    snapshot.selectedSettingsTab,
    SAFE_SETTINGS_TABS,
    state.selectedSettingsTab ?? "api",
  );
  return true;
}

function readString(value) {
  return typeof value === "string" ? value : "";
}

function readNullableString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function readComposerAttachmentMetadataList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const attachments = [];
  const seen = new Set();
  for (const item of value) {
    const attachment = readComposerAttachmentMetadata(item);
    if (attachment === null || seen.has(attachment.id)) {
      continue;
    }
    seen.add(attachment.id);
    attachments.push(attachment);
  }
  return attachments.slice(-COMPOSER_ATTACHMENT_LIMIT);
}

function readComposerAttachmentMetadata(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const id = readString(value.id).trim();
  if (!id) {
    return null;
  }
  const path = readString(value.path).trim();
  const fileName = readString(value.fileName).trim();
  const previewUrl = readString(value.previewUrl).trim();
  if (!path && !fileName && !previewUrl) {
    return null;
  }
  return {
    id: id.slice(0, 120),
    type: (readString(value.type).trim() || "file").slice(0, 40),
    ...(path ? { path: path.slice(0, 1024) } : {}),
    ...(fileName ? { fileName: fileName.slice(0, 240) } : {}),
    ...(readString(value.mimeType).trim() ? { mimeType: readString(value.mimeType).trim().slice(0, 120) } : {}),
    ...(readFiniteNumber(value.sizeBytes, null) === null
      ? {}
      : { sizeBytes: readFiniteNumber(value.sizeBytes, null) }),
    ...(previewUrl ? { previewUrl: previewUrl.slice(0, 1024) } : {}),
  };
}

function readEnum(value, allowed, fallback) {
  return typeof value === "string" && allowed.has(value) ? value : fallback;
}

function readDesktopSessionKey(value, fallback = "desktop:workbench") {
  const text = typeof value === "string" ? value.trim() : "";
  if (/^desktop:workbench(?::[A-Za-z0-9_-]+)?$/u.test(text)) {
    return text;
  }
  return fallback;
}

function readDesktopSessionList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const sessions = [];
  const seen = new Set();
  for (const item of value) {
    const key = readDesktopSessionKey(item?.key, null);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    sessions.push({
      key,
      title: readString(item?.title).slice(0, 80),
      updatedAt: readFiniteNumber(item?.updatedAt),
    });
  }
  return sessions.slice(0, 20);
}

function readDesktopSessionTranscripts(value) {
  if (!value || typeof value !== "object") {
    return {};
  }
  const transcripts = {};
  for (const [rawKey, rawMessages] of Object.entries(value)) {
    const key = readDesktopSessionKey(rawKey, null);
    if (!key || !Array.isArray(rawMessages)) {
      continue;
    }
    const messages = rawMessages.map(readDesktopSessionTranscriptMessage).filter(Boolean);
    if (messages.length > 0) {
      transcripts[key] = messages.slice(-SESSION_TRANSCRIPT_LIMIT);
    }
  }
  return transcripts;
}

function readDesktopSessionTranscriptMessage(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const role = readString(value.role).slice(0, 40);
  const title = readString(value.title).trim().slice(0, 160);
  const body = readString(value.body).slice(0, SESSION_TRANSCRIPT_BODY_LIMIT);
  if (!role || (!title && !body)) {
    return null;
  }
  return { role, title, body };
}

function readRestartSafeRecentTasks(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const tasks = [];
  const seen = new Set();
  for (const item of value) {
    const task = readRestartSafeRecentTask(item);
    if (task === null || seen.has(task.id)) {
      continue;
    }
    seen.add(task.id);
    tasks.push(task);
  }
  return tasks
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, RECENT_RUN_CENTER_TASK_LIMIT);
}

function readRestartSafeRecentTask(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const id = readString(value.id || value.taskId).trim();
  if (!id) {
    return null;
  }
  const updatedAt = readFiniteNumber(value.updatedAt);
  const originalStatus = readString(value.status);
  const restoredInterrupted = ACTIVE_TASK_RUNTIME_STATUSES.has(originalStatus);
  const status = restoredInterrupted
    ? "interrupted"
    : readEnum(originalStatus, SAFE_TASK_RUNTIME_STATUSES, "failed");
  const payload = readRestartSafeTaskPayload(value.payload);
  if (restoredInterrupted) {
    payload.restoredFromUiState = true;
  }
  return {
    id,
    status,
    label: readString(value.label || value.title || "运行任务").slice(0, 80) || "运行任务",
    lane: readString(value.lane).slice(0, 24),
    payload,
    events: readRestartSafeTaskEvents(value.events, {
      restoredInterrupted,
      updatedAt,
    }),
    createdAt: readFiniteNumber(value.createdAt),
    startedAt: readFiniteNumber(value.startedAt),
    updatedAt,
    completedAt: readFiniteNumber(value.completedAt, restoredInterrupted ? updatedAt : undefined),
    progress: restoredInterrupted ? 100 : readTaskProgress(value.progress, status),
    progressMode: "determinate",
    cancellable: false,
    ...(readString(value.category) ? { category: readString(value.category).slice(0, 80) } : {}),
  };
}

function readRestartSafeTaskPayload(value) {
  if (!value || typeof value !== "object") {
    return {};
  }
  const payload = {};
  for (const key of ["source", "turnId", "promptPreview", "finalTextPreview", "cancelReason"]) {
    const text = readString(value[key]);
    if (text) {
      payload[key] = text.slice(0, key === "promptPreview" || key === "finalTextPreview" ? 280 : 120);
    }
  }
  if (value.restoredFromUiState === true) {
    payload.restoredFromUiState = true;
  }
  return payload;
}

function readRestartSafeTaskEvents(value, options = {}) {
  const events = Array.isArray(value)
    ? value.map(readRestartSafeTaskEvent).filter(Boolean).slice(-8)
    : [];
  if (options.restoredInterrupted) {
    events.push({
      type: "desktop.restart",
      title: "桌面端重启后恢复诊断",
      message: "上次运行在桌面端重启前未完成，已作为中断历史保留。",
      occurredAt: readFiniteNumber(options.updatedAt),
    });
  }
  return events;
}

function readRestartSafeTaskEvent(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const event = {};
  for (const key of ["type", "kind", "title", "message", "summary", "detail", "body", "occurredAt"]) {
    const item = value[key];
    if (typeof item === "string" && item.trim()) {
      event[key] = item.trim().slice(0, key === "message" || key === "body" ? 320 : 160);
    } else if (key === "occurredAt" && typeof item === "number" && Number.isFinite(item)) {
      event[key] = item;
    }
  }
  return Object.keys(event).length > 0 ? event : null;
}

function readTaskProgress(value, status) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }
  return status === "completed" ? 100 : 0;
}

function readFiniteNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
