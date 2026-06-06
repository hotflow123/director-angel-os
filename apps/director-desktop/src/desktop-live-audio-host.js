import { createAgentOsLiveRunnerAdmissionPacket } from "@hotflow/agent-os-sandbox";
import {
  cancelLiveRunSession,
  completeLiveRunSession,
  createLiveRunAdmissionFromAgentOs,
  createQueuedLiveRunSession,
  failLiveRunSession,
  startLiveRunSession,
} from "@hotflow/live-runner-core";

const DEFAULT_BLOCK_REASON =
  "真实麦克风默认关闭：需要用户点击开始、桌面麦克风 host adapter 和 operator evidence 后才能启用。";

export function createFailClosedDesktopLiveAudioCaptureAdapter(reason = DEFAULT_BLOCK_REASON) {
  return {
    async start() {
      throw new DesktopLiveAudioBlockedError(reason);
    },
  };
}

export class DesktopLiveAudioBlockedError extends Error {
  constructor(message = DEFAULT_BLOCK_REASON) {
    super(message);
    this.name = "DesktopLiveAudioBlockedError";
    this.code = "desktop-live-audio-blocked";
  }
}

export function createDesktopLiveAudioHost(options = {}) {
  const captureAdapter =
    options.captureAdapter ?? createFailClosedDesktopLiveAudioCaptureAdapter();
  const hasExplicitCaptureAdapter = options.captureAdapter !== undefined;
  const store = options.store ?? createInMemoryLiveRunStore();
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  let active = null;

  const append = async (transition) => {
    await store.appendTransition(transition);
    return transition.session;
  };

  const status = async () => {
    const sessions = await store.listSessions({ activeOnly: false });
    const sorted = [...sessions].sort(compareLiveAudioSessions);
    const latestSession = sorted[0] ?? null;
    return {
      schemaVersion: "director.desktop.live-audio.status.v1",
      active: active !== null,
      status: active === null ? (latestSession?.status === "failed" ? "blocked" : "idle") : "recording",
      activeSessionId: active?.session.sessionId ?? null,
      latestSession,
      sessionCount: sorted.length,
    };
  };

  const start = async (input = {}) => {
    if (active !== null) {
      return {
        ok: true,
        status: "recording",
        reused: true,
        session: active.session,
      };
    }

    const request = createDesktopLiveAudioRequest(input, now());
    const queued = createQueuedLiveRunSession(request, {
      sessionId: request.runId + "-session",
      now: request.createdAt,
    });
    let session = await append(queued);
    const admissionPacket = createDesktopLiveAudioAdmissionPacket(request, input, {
      hasExplicitCaptureAdapter,
    });
    const admission = createLiveRunAdmissionFromAgentOs(admissionPacket, {
      sessionId: session.sessionId + "-admission",
      startedAt: now(),
    });
    const admitted = admission.ok
      ? await append(
          normalizeDesktopLiveAudioTransition(
            startLiveRunSession(session, {
              now: now(),
              liveRunnerStarted: false,
              metadata: createDesktopLiveAudioFailClosedMetadata({
                phase: "admitted",
                mode: input.mode,
                turnId: input.turnId,
              }),
            }),
          ),
        )
      : await append(
          failLiveRunSession(
            session,
            {
              code: "desktop-live-audio-admission-blocked",
              message: "桌面语音权限证据不足，不能启动麦克风。",
              retryable: false,
              metadata: { issues: admission.issues },
            },
            {
              now: now(),
              metadata: createDesktopLiveAudioFailClosedMetadata({
                phase: "admission-blocked",
                mode: input.mode,
                turnId: input.turnId,
              }),
            },
          ),
        );
    session = admitted;

    if (!admission.ok) {
      return {
        ok: false,
        status: "blocked",
        reason: DEFAULT_BLOCK_REASON,
        session,
      };
    }

    try {
      const capture = await captureAdapter.start({
        request,
        session,
        mode: input.mode ?? "push-to-talk",
      });
      active = { request, session, capture };
      return {
        ok: true,
        status: "recording",
        reused: false,
        session,
      };
    } catch (error) {
      const reason = normalizeLiveAudioErrorMessage(error);
      session = await append(
        failLiveRunSession(
          session,
          {
            code: error?.code === "desktop-live-audio-blocked"
              ? "desktop-live-audio-blocked"
              : "desktop-live-audio-start-failed",
            message: reason,
            retryable: false,
          },
          {
            now: now(),
            metadata: createDesktopLiveAudioFailClosedMetadata({
              phase: "capture-blocked",
              mode: input.mode,
              turnId: input.turnId,
            }),
          },
        ),
      );
      return {
        ok: false,
        status: "blocked",
        reason,
        session,
      };
    }
  };

  const stop = async (input = {}) => {
    if (active === null) {
      return {
        ok: true,
        status: "idle",
        released: false,
        session: (await status()).latestSession,
      };
    }
    const current = active;
    active = null;
    await current.capture?.stop?.(input.reason ?? "operator stopped live audio");
    const session = await append(
      completeLiveRunSession(current.session, {
        now: now(),
        message: "Desktop live audio capture stopped.",
        metadata: createDesktopLiveAudioFailClosedMetadata({
          phase: "stopped",
          turnId: current.request.metadata?.turnId,
        }),
      }),
    );
    return {
      ok: true,
      status: "stopped",
      released: true,
      session,
    };
  };

  const cancel = async (input = {}) => {
    if (active === null) {
      return {
        ok: true,
        status: "idle",
        released: false,
        session: (await status()).latestSession,
      };
    }
    const current = active;
    active = null;
    const reason = input.reason ?? "operator cancelled live audio";
    await current.capture?.cancel?.(reason);
    const session = await append(
      cancelLiveRunSession(current.session, {
        now: now(),
        reason,
        metadata: createDesktopLiveAudioFailClosedMetadata({
          phase: "cancelled",
          turnId: current.request.metadata?.turnId,
        }),
      }),
    );
    return {
      ok: true,
      status: "cancelled",
      released: true,
      session,
    };
  };

  return {
    store,
    start,
    stop,
    cancel,
    status,
    close: async () => {
      await cancel({ reason: "desktop live audio host closing" });
    },
  };
}

function createDesktopLiveAudioAdmissionPacket(request, input, options = {}) {
  const explicitAdapter =
    input.operatorEvidence?.captureAdapterReady === true || options.hasExplicitCaptureAdapter === true;
  return createAgentOsLiveRunnerAdmissionPacket({
    runnerId: request.runnerId,
    providerId: request.providerId,
    capabilityId: request.capabilityId,
    requestedAt: request.createdAt,
    mode: "dry-run",
    runnerIntent: {
      tokenIssued: explicitAdapter,
      signed: explicitAdapter,
      unlocked: explicitAdapter,
      revocationStatus: explicitAdapter ? "active" : "revoked",
    },
    evidence: {
      operatorScopeGranted: true,
      sandboxAdmitted: true,
      providerConfigured: explicitAdapter,
      credentialsConfigured: true,
      networkPolicyGranted: true,
      dataPolicyAccepted: true,
      auditArtifactReady: true,
      cancellationSupported: true,
      microphonePermissionGranted: explicitAdapter,
      speakerPermissionGranted: true,
      rawAudioStoragePolicyAccepted: true,
      providerRuntimeConfigured: explicitAdapter,
      localAudioProcessAllowed: true,
    },
  });
}

function normalizeDesktopLiveAudioTransition(transition) {
  return {
    ...transition,
    session: {
      ...transition.session,
      liveRunnerStarted: false,
      providerSdkLoaded: false,
      providerCredentialsUsed: false,
      networkUsed: false,
      localProcessStarted: false,
      audioBytesRead: false,
      microphoneAccessed: false,
      speakerAccessed: false,
      rawAudioPersisted: false,
      speechTranscribed: false,
      speechSynthesized: false,
      whisperStarted: false,
    },
  };
}

function createDesktopLiveAudioRequest(input, createdAt) {
  const turnId = readNonEmptyString(input.turnId) ?? "desktop-live-audio";
  const runId = `desktop-live-audio-${sanitizeLiveAudioId(turnId)}-${Date.parse(createdAt) || 0}`;
  return {
    runId,
    runnerId: "desktop.live-audio-host",
    providerId: "desktop-microphone",
    capabilityId: "audio.capture",
    operationId: "audio.capture.desktop",
    input: {
      channel: "desktop",
      mode: input.mode ?? "push-to-talk",
    },
    createdAt,
    metadata: createDesktopLiveAudioFailClosedMetadata({
      phase: "queued",
      mode: input.mode,
      turnId,
    }),
  };
}

function createDesktopLiveAudioFailClosedMetadata(input = {}) {
  return {
    source: "desktop.liveAudio",
    turnId: readNonEmptyString(input.turnId) ?? undefined,
    liveAudio: {
      failClosed: true,
      phase: input.phase ?? "unknown",
      mode: input.mode ?? "push-to-talk",
      microphoneAccessed: false,
      speakerAccessed: false,
      audioBytesRead: false,
      rawAudioPersisted: false,
      providerCredentialsUsed: false,
      networkUsed: false,
      localProcessStarted: false,
      whisperStarted: false,
      ttsProviderStarted: false,
      sttProviderStarted: false,
      liveAudioRunnerStarted: false,
    },
  };
}

function createInMemoryLiveRunStore() {
  const sessions = new Map();
  const events = new Map();
  return {
    async appendTransition(input) {
      sessions.set(input.session.sessionId, input.session);
      events.set(input.session.sessionId, [
        ...(events.get(input.session.sessionId) ?? []),
        ...input.events,
      ]);
    },
    async getSession(sessionId) {
      return sessions.get(sessionId) ?? null;
    },
    async listSessions(query = {}) {
      return [...sessions.values()].filter((session) => {
        if (query.providerId !== undefined && session.providerId !== query.providerId) {
          return false;
        }
        if (query.runId !== undefined && session.runId !== query.runId) {
          return false;
        }
        if (query.activeOnly === true && isTerminalSessionStatus(session.status)) {
          return false;
        }
        return true;
      });
    },
    async listEvents(sessionId) {
      return events.get(sessionId) ?? [];
    },
  };
}

function isTerminalSessionStatus(status) {
  return status === "cancelled" || status === "completed" || status === "failed" || status === "timed_out";
}

function compareLiveAudioSessions(left, right) {
  return (
    Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? "") ||
    String(right.sessionId).localeCompare(String(left.sessionId))
  );
}

function normalizeLiveAudioErrorMessage(error) {
  if (typeof error?.message === "string" && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return DEFAULT_BLOCK_REASON;
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function sanitizeLiveAudioId(value) {
  return String(value ?? "")
    .replace(/[^A-Za-z0-9_-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 80) || "turn";
}
