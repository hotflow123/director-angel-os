export function createDesktopLiveRunnerAbortAliases(sessionId, request) {
  const aliases = [sessionId, `session:${sessionId}`];
  if (typeof request?.runId === "string" && request.runId.length > 0) {
    aliases.push(`run:${request.runId}`);
  }
  if (typeof request?.correlationId === "string" && request.correlationId.length > 0) {
    aliases.push(`turn:${request.correlationId}`);
  }
  const metadata = isPlainObject(request?.metadata) ? request.metadata : {};
  for (const key of ["turnId", "sourceTurnId", "composerTurnId", "runtimeTurnId"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim().length > 0) {
      aliases.push(`turn:${value.trim()}`);
    }
  }
  return aliases;
}

export function formatDesktopLiveRunnerSession(session, events = []) {
  const metadata = isPlainObject(session.metadata) ? session.metadata : {};
  const eventList = Array.isArray(events) ? events : [];
  const turnId = readFirstString([
    metadata.turnId,
    metadata.sourceTurnId,
    metadata.composerTurnId,
    metadata.runtimeTurnId,
  ]);
  return {
    taskId: session.sessionId,
    id: session.sessionId,
    sessionId: session.sessionId,
    runId: session.runId,
    runnerId: session.runnerId,
    providerId: session.providerId,
    capabilityId: session.capabilityId,
    operationId: session.operationId,
    status: session.status,
    taskStatus: mapLiveRunStatusToDesktopTaskStatus(session.status),
    cancellable: session.cancelable !== false && !isTerminalLiveRunSessionStatus(session.status),
    progress: readFiniteLiveRunnerProgress(session.progress),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    startedAt: session.startedAt ?? null,
    endedAt: session.endedAt ?? null,
    turnId: turnId ?? null,
    source: typeof metadata.source === "string" ? metadata.source : null,
    model: readLiveRunnerMetadataString(session, "model") ?? null,
    endpoint: readLiveRunnerMetadataString(session, "endpoint") ?? null,
    providerTaskId:
      typeof session.providerTask?.taskId === "string" ? session.providerTask.taskId : null,
    error: session.error?.message ?? null,
    eventCount: eventList.length,
    events: eventList.map(formatDesktopLiveRunnerEvent),
  };
}

export function compareDesktopLiveRunnerSessionsByUpdatedAt(left, right) {
  return (
    readLiveRunnerTimestampMs(right.updatedAt) - readLiveRunnerTimestampMs(left.updatedAt) ||
    String(right.sessionId).localeCompare(String(left.sessionId))
  );
}

export function readLiveRunnerTimestampMs(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mapLiveRunStatusToDesktopTaskStatus(status) {
  if (status === "completed") {
    return "completed";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  if (status === "failed" || status === "timed_out" || status === "orphaned") {
    return "failed";
  }
  return "running";
}

export function readLiveRunnerMetadataString(session, key) {
  const value = session.metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function computeLiveRunnerLatencyMs(session) {
  const startedAt = Date.parse(session.createdAt);
  const endedAt = Date.parse(session.endedAt ?? session.updatedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
    return 0;
  }
  return Math.max(0, endedAt - startedAt);
}

export function resolveDesktopLiveRunTurnId(action) {
  const candidates = [
    action.turnId,
    action.sourceAction?.turnId,
    action.sourceAction?.runtimeTurnId,
    action.sourceAction?.conversationRuntime?.turnId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return `desktop-turn-${hashDesktopLiveRunText(action.prompt ?? "")}`;
}

export function createDesktopLiveRunRunId({ turnId, capabilityId, prompt }) {
  return `desktop-live-${sanitizeDesktopLiveRunId(turnId)}-${sanitizeDesktopLiveRunId(capabilityId)}-${hashDesktopLiveRunText(prompt)}`;
}

export function createDesktopLiveRunSessionId(request) {
  return `${sanitizeDesktopLiveRunId(request.runId)}-session`;
}

export function isLiveRunSessionForDesktopTurn(session, turnId, options = {}) {
  if (!session || typeof session !== "object") {
    return false;
  }
  if (
    options.includeTerminal !== true &&
    (session.cancelable === false || isTerminalLiveRunSessionStatus(session.status))
  ) {
    return false;
  }
  const metadata = isPlainObject(session.metadata) ? session.metadata : {};
  return [
    metadata.turnId,
    metadata.sourceTurnId,
    metadata.composerTurnId,
    metadata.runtimeTurnId,
    session.turnId,
  ].some((value) => typeof value === "string" && value.trim() === turnId);
}

export function createDesktopLiveRunCancelRequest(session, turnId) {
  return {
    runId: session.runId,
    runnerId: session.runnerId,
    providerId: session.providerId,
    capabilityId: session.capabilityId,
    operationId: session.operationId,
    input: {},
    metadata: {
      turnId,
      source: "desktop.composer.cancel",
    },
  };
}

export function isTerminalLiveRunSessionStatus(status) {
  return (
    status === "cancelled" ||
    status === "completed" ||
    status === "failed" ||
    status === "timed_out"
  );
}

export function isActiveLiveRunSessionStatus(status) {
  return !isTerminalLiveRunSessionStatus(status);
}

function formatDesktopLiveRunnerEvent(event) {
  return {
    type: event.type,
    title: event.title,
    message: event.message,
    occurredAt: event.occurredAt,
    progress: typeof event.progress === "number" ? event.progress : null,
    error: event.error?.message ?? null,
  };
}

function readFiniteLiveRunnerProgress(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readFirstString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function sanitizeDesktopLiveRunId(value) {
  return (
    String(value ?? "")
      .replace(/[^A-Za-z0-9_-]+/gu, "_")
      .replace(/^_+|_+$/gu, "")
      .slice(0, 120) || "run"
  );
}

function hashDesktopLiveRunText(value) {
  let hash = 0;
  for (const char of String(value ?? "")) {
    hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  }
  return `${String(value ?? "").length}-${hash.toString(16)}`;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
