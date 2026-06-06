import {
  completeLiveRunSession,
  createQueuedLiveRunSession,
  failLiveRunSession,
  normalizeLiveRunError,
  startLiveRunSession,
  updateLiveRunProgress,
} from "@hotflow/live-runner-core";

import {
  computeLiveRunnerLatencyMs,
  createDesktopLiveRunRunId,
  createDesktopLiveRunSessionId,
  readLiveRunnerMetadataString,
  resolveDesktopLiveRunTurnId,
} from "./desktop-live-runner-projection.js";

const DESKTOP_REAL_TEXT_TIMEOUT_MS = 20_000;
const DESKTOP_REAL_TEXT_MAX_ATTEMPTS = 4;

export async function runDesktopApiProviderTextViaLiveRunner({
  action,
  prompt,
  contextSystemPrompt,
  liveRunner,
}) {
  const request = createDesktopApiProviderLiveRunRequest(action, {
    capabilityId: "text",
    operationId: "chat.completions",
    input: {
      prompt,
      timeoutMs: readDesktopTextTimeoutMs(action),
      maxAttempts: readDesktopTextMaxAttempts(action),
      ...(contextSystemPrompt === undefined ? {} : { systemPrompt: contextSystemPrompt }),
      ...(typeof action.model === "string" && action.model.trim().length > 0
        ? { model: action.model.trim() }
        : {}),
    },
    source: "desktop.apiProvider.text",
  });
  const result = await executeDesktopApiProviderLiveRun({
    liveRunner,
    request,
  });
  return {
    ...createTextRunResultFromLiveRunner(result),
    ...createDesktopApiProviderLiveRunMetadata(result),
  };
}

export async function runDesktopApiProviderImageViaLiveRunner({ action, prompt, liveRunner }) {
  const request = createDesktopApiProviderLiveRunRequest(action, {
    capabilityId: "image_generation",
    operationId: "image.generations",
    input: {
      prompt,
      ...(typeof action.model === "string" && action.model.trim().length > 0
        ? { model: action.model.trim() }
        : {}),
      ...(typeof action.size === "string" && action.size.trim().length > 0
        ? { size: action.size.trim() }
        : {}),
    },
    source: "desktop.apiProvider.image",
  });
  const result = await executeDesktopApiProviderLiveRun({
    liveRunner,
    request,
  });
  return {
    ...createImageRunResultFromLiveRunner(result),
    ...createDesktopApiProviderLiveRunMetadata(result),
  };
}

export async function runDesktopApiProviderVideoViaLiveRunner({ action, prompt, liveRunner }) {
  const request = createDesktopApiProviderLiveRunRequest(action, {
    capabilityId: "video_generation",
    operationId: "video.generations",
    input: {
      prompt,
      ...(typeof action.model === "string" && action.model.trim().length > 0
        ? { model: action.model.trim() }
        : {}),
      ...(typeof action.duration === "number" && Number.isFinite(action.duration)
        ? { duration: action.duration }
        : {}),
      ...(typeof action.seconds === "number" && Number.isFinite(action.seconds)
        ? { seconds: action.seconds }
        : {}),
      ...(typeof action.aspectRatio === "string" && action.aspectRatio.trim().length > 0
        ? { aspectRatio: action.aspectRatio.trim() }
        : {}),
      ...(typeof action.size === "string" && action.size.trim().length > 0
        ? { size: action.size.trim() }
        : {}),
      ...(typeof action.resolution === "string" && action.resolution.trim().length > 0
        ? { resolution: action.resolution.trim() }
        : {}),
      ...(typeof action.imageUrl === "string" && action.imageUrl.trim().length > 0
        ? { imageUrl: action.imageUrl.trim() }
        : {}),
    },
    source: "desktop.apiProvider.video",
  });
  const result = await executeDesktopApiProviderLiveRun({
    liveRunner,
    request,
  });
  return {
    ...createVideoRunResultFromLiveRunner(result),
    ...createDesktopApiProviderLiveRunMetadata(result),
  };
}

async function executeDesktopApiProviderLiveRun({ liveRunner, request }) {
  const store = liveRunner?.store;
  const driver = liveRunner?.driverRegistry?.resolve?.({
    providerId: request.providerId,
    capabilityId: request.capabilityId,
  });
  if (!store || typeof store.appendTransition !== "function" || !driver) {
    throw new Error(
      `No live runner driver is available for ${request.providerId}/${request.capabilityId}.`,
    );
  }

  const queued = createQueuedLiveRunSession(request, {
    sessionId: createDesktopLiveRunSessionId(request),
    now: request.createdAt,
  });
  await store.appendTransition(queued);
  let session = queued.session;
  const signal = liveRunner?.createAbortSignal?.(session.sessionId, request);

  try {
    const startResult = await driver.start({
      request,
      session,
      ...(signal === undefined ? {} : { signal }),
    });
    const started = startLiveRunSession(session, {
      now: new Date().toISOString(),
      providerTask: startResult.providerTask,
      progress: startResult.progress,
      metadata: startResult.metadata,
    });
    await store.appendTransition(started);
    session = started.session;

    if (startResult.completed === true || startResult.providerTask === undefined) {
      const completed = completeLiveRunSession(session, {
        now: new Date().toISOString(),
        artifacts: startResult.artifacts ?? [],
        metadata: startResult.metadata,
      });
      await store.appendTransition(completed);
      session = completed.session;
      return {
        request,
        session,
        events: await store.listEvents(session.sessionId),
      };
    }

    if (typeof driver.poll !== "function") {
      const progress = updateLiveRunProgress(session, {
        now: new Date().toISOString(),
        progress: startResult.progress ?? session.progress ?? 1,
        providerTask: startResult.providerTask,
        message: "Provider task is waiting for external polling.",
        metadata: startResult.metadata,
      });
      await store.appendTransition(progress);
      session = progress.session;
      return {
        request,
        session,
        events: await store.listEvents(session.sessionId),
      };
    }

    const pollResult = await driver.poll({
      request,
      session,
      providerTask: startResult.providerTask,
      ...(signal === undefined ? {} : { signal }),
    });
    if (pollResult.failed === true || pollResult.error !== undefined) {
      const failed = failLiveRunSession(
        session,
        pollResult.error ?? {
          code: "live-runner-provider-poll-failed",
          message: "Provider polling failed.",
          retryable: true,
        },
        {
          now: new Date().toISOString(),
          metadata: pollResult.metadata,
        },
      );
      await store.appendTransition(failed);
      session = failed.session;
      return {
        request,
        session,
        events: await store.listEvents(session.sessionId),
      };
    }
    if (pollResult.completed === true) {
      const completed = completeLiveRunSession(session, {
        now: new Date().toISOString(),
        artifacts: pollResult.artifacts ?? [],
        metadata: pollResult.metadata,
      });
      await store.appendTransition(completed);
      session = completed.session;
      return {
        request,
        session,
        events: await store.listEvents(session.sessionId),
      };
    }

    const progress = updateLiveRunProgress(session, {
      now: new Date().toISOString(),
      progress: pollResult.progress ?? session.progress ?? 1,
      providerTask: pollResult.providerTask,
      metadata: pollResult.metadata,
    });
    await store.appendTransition(progress);
    session = progress.session;
    return {
      request,
      session,
      events: await store.listEvents(session.sessionId),
    };
  } catch (error) {
    const cancelledSession = await readCancelledDesktopLiveRunnerSession(store, session.sessionId);
    if (cancelledSession !== null) {
      session = cancelledSession;
      return {
        request,
        session,
        events: await store.listEvents(session.sessionId),
      };
    }
    const normalizedError = driver.normalizeError?.(error) ?? normalizeLiveRunError(error);
    const failed = failLiveRunSession(session, normalizedError, {
      now: new Date().toISOString(),
      metadata: {
        source: "desktop.apiProvider.liveRunner",
      },
    });
    await store.appendTransition(failed);
    session = failed.session;
    return {
      request,
      session,
      events: await store.listEvents(session.sessionId),
    };
  } finally {
    liveRunner?.clearAbortSignal?.(session.sessionId);
  }
}

async function readCancelledDesktopLiveRunnerSession(store, sessionId) {
  if (typeof store.getSession !== "function") {
    return null;
  }
  const latest = await store.getSession(sessionId);
  return latest?.status === "cancelled" ? latest : null;
}

function createDesktopApiProviderLiveRunRequest(action, options) {
  const turnId = resolveDesktopLiveRunTurnId(action);
  const runId = createDesktopLiveRunRunId({
    turnId,
    capabilityId: options.capabilityId,
    prompt: options.input.prompt,
  });
  return {
    runId,
    runnerId: "live-runner.memefast",
    providerId:
      typeof action.providerId === "string" && action.providerId.trim().length > 0
        ? action.providerId.trim()
        : "memefast-api",
    capabilityId: options.capabilityId,
    operationId: options.operationId,
    input: options.input,
    createdAt: new Date().toISOString(),
    correlationId: turnId,
    metadata: {
      source: options.source,
      turnId,
      sourceTurnId: turnId,
      composerTurnId: turnId,
      actionType: action.type,
      ...(typeof options.input.model === "string" && options.input.model.trim().length > 0
        ? { model: options.input.model.trim() }
        : {}),
      ...(typeof action.sourceAction?.turnIntent?.kind === "string"
        ? { turnIntentKind: action.sourceAction.turnIntent.kind }
        : {}),
    },
  };
}

function createTextRunResultFromLiveRunner(result) {
  const session = result.session;
  const textArtifact = session.artifacts.find((artifact) => artifact.kind === "text");
  const output =
    typeof textArtifact?.metadata?.text === "string" ? textArtifact.metadata.text : undefined;
  return {
    providerId: session.providerId,
    ok: session.status === "completed" && typeof output === "string" && output.length > 0,
    endpoint: readLiveRunnerMetadataString(session, "endpoint") ?? "",
    checkedAt: session.endedAt ?? session.updatedAt,
    latencyMs: computeLiveRunnerLatencyMs(session),
    model: readLiveRunnerMetadataString(session, "model") ?? "unknown",
    ...(output === undefined ? {} : { output }),
    message: createLiveRunnerResultMessage(session, "模型调用完成。", "模型调用失败。"),
  };
}

function createImageRunResultFromLiveRunner(result) {
  const session = result.session;
  const images = session.artifacts
    .filter((artifact) => artifact.kind === "image")
    .map((artifact) => ({
      ...(typeof artifact.url === "string" ? { url: artifact.url } : {}),
      ...(typeof artifact.metadata?.b64Json === "string" ? { b64Json: artifact.metadata.b64Json } : {}),
    }))
    .filter((image) => image.url !== undefined || image.b64Json !== undefined);
  const first = images[0];
  return {
    providerId: session.providerId,
    ok: session.status === "completed" && images.length > 0,
    endpoint: readLiveRunnerMetadataString(session, "endpoint") ?? "",
    checkedAt: session.endedAt ?? session.updatedAt,
    latencyMs: computeLiveRunnerLatencyMs(session),
    model: readLiveRunnerMetadataString(session, "model") ?? "unknown",
    images,
    ...(first?.url === undefined
      ? first?.b64Json === undefined
        ? {}
        : { output: `base64 image (${first.b64Json.length} chars)` }
      : { output: first.url }),
    message: createLiveRunnerResultMessage(session, "图片生成完成。", "图片生成失败。"),
  };
}

function createVideoRunResultFromLiveRunner(result) {
  const session = result.session;
  const videos = session.artifacts
    .filter((artifact) => artifact.kind === "video")
    .map((artifact) => ({
      ...(typeof artifact.url === "string" ? { url: artifact.url } : {}),
      ...(typeof artifact.mimeType === "string" ? { mimeType: artifact.mimeType } : {}),
    }))
    .filter((video) => video.url !== undefined);
  const first = videos[0];
  return {
    providerId: session.providerId,
    ok: session.status === "completed" && videos.length > 0,
    endpoint: readLiveRunnerMetadataString(session, "endpoint") ?? "",
    checkedAt: session.endedAt ?? session.updatedAt,
    latencyMs: computeLiveRunnerLatencyMs(session),
    model: readLiveRunnerMetadataString(session, "model") ?? "unknown",
    videos,
    ...(first?.url === undefined ? {} : { output: first.url }),
    message: createLiveRunnerResultMessage(session, "视频生成完成。", "视频生成失败。"),
  };
}

function createLiveRunnerResultMessage(session, completedMessage, failedMessage) {
  if (session.status === "completed") {
    return completedMessage;
  }
  if (session.status === "cancelled") {
    const reason =
      typeof session.cancelReason === "string" && session.cancelReason.trim().length > 0
        ? `：${session.cancelReason.trim()}`
        : "";
    return `已取消${reason}。`;
  }
  return session.error?.message ?? failedMessage;
}

export function readDesktopTextTimeoutMs(action) {
  return (
    readFiniteNumber(action.timeoutMs) ??
    readFiniteNumber(action.sourceAction?.timeoutMs) ??
    DESKTOP_REAL_TEXT_TIMEOUT_MS
  );
}

export function readDesktopTextMaxAttempts(action) {
  return (
    readFiniteNumber(action.maxAttempts) ??
    readFiniteNumber(action.sourceAction?.maxAttempts) ??
    DESKTOP_REAL_TEXT_MAX_ATTEMPTS
  );
}

function createDesktopApiProviderLiveRunMetadata(result) {
  return {
    liveRunnerStarted: result.session.liveRunnerStarted,
    liveRunnerRunId: result.session.runId,
    liveRunnerSessionId: result.session.sessionId,
    liveRunnerStatus: result.session.status,
    liveRunnerSession: result.session,
    liveRunnerEvents: result.events,
  };
}

function readFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
