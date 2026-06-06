import type {
  AgentOsLiveRunnerAdmissionPacket,
  AgentOsLiveRunnerSession,
} from "@hotflow/agent-os-sandbox";
import {
  cancelAgentOsLiveRunnerSession,
  startAgentOsLiveRunnerSession,
} from "@hotflow/agent-os-sandbox";
import type { JsonObject, JsonValue, SessionRecord } from "@hotflow/sessions";

export type LiveRunCapabilityId =
  | "audio.capture"
  | "audio.realtime.talk"
  | "audio.realtime.transcribe"
  | "audio.synthesize"
  | "audio.transcribe"
  | "image_generation"
  | "text"
  | "video_generation"
  | "vision"
  | (string & {});

export const AUDIO_LIVE_RUN_CAPABILITY_IDS = [
  "audio.capture",
  "audio.transcribe",
  "audio.synthesize",
  "audio.realtime.transcribe",
  "audio.realtime.talk",
] as const satisfies readonly LiveRunCapabilityId[];

export type LiveRunStatus =
  | "admitted"
  | "cancelled"
  | "cancelling"
  | "completed"
  | "failed"
  | "orphaned"
  | "polling"
  | "queued"
  | "running"
  | "starting"
  | "timed_out";

export type LiveRunEventType =
  | "artifact.created"
  | "provider.poll.progress"
  | "provider.request.sent"
  | "provider.task.accepted"
  | "realtime.transcript.final"
  | "realtime.transcript.partial"
  | "runner.admitted"
  | "runner.cancel.requested"
  | "runner.cancelled"
  | "runner.completed"
  | "runner.failed"
  | "runner.orphaned"
  | "runner.queued"
  | "runner.started"
  | "runner.timed_out"
  | "talk.status";

export type LiveRunArtifactKind = "audio" | "image" | "json" | "text" | "video" | (string & {});

export interface LiveRunRequest {
  readonly runId: string;
  readonly runnerId: string;
  readonly providerId: string;
  readonly capabilityId: LiveRunCapabilityId;
  readonly operationId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly createdAt?: string;
  readonly correlationId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface LiveRunArtifact {
  readonly id: string;
  readonly kind: LiveRunArtifactKind;
  readonly url?: string;
  readonly path?: string;
  readonly mimeType?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface LiveRunError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly providerStatus?: number;
  readonly providerStatusText?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface LiveRunProviderTask {
  readonly taskId: string;
  readonly status?: string;
  readonly pollAfterMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface LiveRunEvent {
  readonly id: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly type: LiveRunEventType;
  readonly occurredAt: string;
  readonly providerId: string;
  readonly capabilityId: LiveRunCapabilityId;
  readonly message: string;
  readonly progress?: number;
  readonly providerTask?: LiveRunProviderTask;
  readonly artifact?: LiveRunArtifact;
  readonly error?: LiveRunError;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface LiveRunSession {
  readonly runId: string;
  readonly sessionId: string;
  readonly runnerId: string;
  readonly providerId: string;
  readonly capabilityId: LiveRunCapabilityId;
  readonly operationId: string;
  readonly status: LiveRunStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly cancelRequestedAt?: string;
  readonly cancelReason?: string;
  readonly cancelable: boolean;
  readonly liveRunnerStarted: boolean;
  readonly providerSdkLoaded: boolean;
  readonly providerCredentialsUsed: boolean;
  readonly networkUsed: boolean;
  readonly localProcessStarted: boolean;
  readonly audioBytesRead: boolean;
  readonly microphoneAccessed: boolean;
  readonly speakerAccessed: boolean;
  readonly rawAudioPersisted: boolean;
  readonly speechTranscribed: boolean;
  readonly speechSynthesized: boolean;
  readonly whisperStarted: boolean;
  readonly progress?: number;
  readonly providerTask?: LiveRunProviderTask;
  readonly artifacts: readonly LiveRunArtifact[];
  readonly error?: LiveRunError;
  readonly admission?: LiveRunAdmission;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface LiveRunAdmission {
  readonly ok: boolean;
  readonly status: "admitted" | "blocked" | "revoked";
  readonly canStartLiveRunner: boolean;
  readonly controlPlaneSessionStarted: boolean;
  readonly agentOsAdmission?: AgentOsLiveRunnerAdmissionPacket;
  readonly agentOsSession?: AgentOsLiveRunnerSession;
  readonly issues: readonly string[];
}

export interface LiveRunTransitionResult {
  readonly session: LiveRunSession;
  readonly events: readonly LiveRunEvent[];
}

export interface LiveRunStore {
  appendTransition(input: LiveRunTransitionResult): Promise<void>;
  getSession(sessionId: string): Promise<LiveRunSession | null>;
  listSessions(query?: LiveRunStoreSessionQuery): Promise<readonly LiveRunSession[]>;
  listEvents(sessionId: string): Promise<readonly LiveRunEvent[]>;
}

export interface LiveRunStoreSessionQuery {
  readonly activeOnly?: boolean;
  readonly providerId?: string;
  readonly runId?: string;
}

export interface LiveRunSessionStoreAdapter {
  createSession(input?: {
    readonly sessionId?: string;
    readonly metadata?: JsonObject;
  }): SessionRecord;
  getSession(sessionId: string): SessionRecord | null;
  appendJournal(
    sessionId: string,
    input: {
      readonly eventType: string;
      readonly payload: JsonValue;
      readonly turnId?: string;
      readonly schemaVersion?: string;
      readonly createdAtMs?: number;
    },
  ): unknown;
  readonly journal: {
    list(
      sessionId: string,
      options?: {
        readonly afterSeq?: number;
        readonly limit?: number;
      },
    ): readonly {
      readonly eventType: string;
      readonly payload: JsonValue;
      readonly turnId: string | null;
      readonly createdAtMs: number;
    }[];
  };
}

export interface SessionStoreLiveRunStoreOptions {
  readonly sessionStore: LiveRunSessionStoreAdapter;
  readonly journalSessionId: string;
  readonly turnId?: string;
  readonly now?: () => string;
}

export const LIVE_RUNNER_JOURNAL_EVENT_TYPE = "live_runner.event";
export const LIVE_RUNNER_JOURNAL_SCHEMA_VERSION = "live-runner/v1";

export interface LiveRunCancelToken {
  readonly runId: string;
  readonly sessionId: string;
  readonly requestedAt: string;
  readonly reason: string;
  readonly revoked: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface LiveRunDriverPrepareInput {
  readonly request: LiveRunRequest;
  readonly session: LiveRunSession;
  readonly signal?: AbortSignal;
}

export interface LiveRunDriverStartInput {
  readonly request: LiveRunRequest;
  readonly session: LiveRunSession;
  readonly signal?: AbortSignal;
}

export interface LiveRunDriverPollInput {
  readonly request: LiveRunRequest;
  readonly session: LiveRunSession;
  readonly providerTask: LiveRunProviderTask;
  readonly signal?: AbortSignal;
}

export interface LiveRunDriverCancelInput {
  readonly request: LiveRunRequest;
  readonly session: LiveRunSession;
  readonly cancelToken: LiveRunCancelToken;
  readonly signal?: AbortSignal;
}

export interface LiveRunDriverStartResult {
  readonly providerTask?: LiveRunProviderTask;
  readonly artifacts?: readonly LiveRunArtifact[];
  readonly progress?: number;
  readonly completed?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface LiveRunDriverPollResult {
  readonly providerTask?: LiveRunProviderTask;
  readonly artifacts?: readonly LiveRunArtifact[];
  readonly progress?: number;
  readonly completed?: boolean;
  readonly failed?: boolean;
  readonly error?: LiveRunError;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface LiveRunDriverCancelResult {
  readonly cancelled: boolean;
  readonly providerTask?: LiveRunProviderTask;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface LiveRunProviderDriver {
  readonly id: string;
  readonly providerId: string;
  readonly capabilities: readonly LiveRunCapabilityId[];
  readonly cancellationSupported: boolean;
  prepare?(
    input: LiveRunDriverPrepareInput,
  ): Promise<Readonly<Record<string, unknown>> | undefined>;
  start(input: LiveRunDriverStartInput): Promise<LiveRunDriverStartResult>;
  poll?(input: LiveRunDriverPollInput): Promise<LiveRunDriverPollResult>;
  cancel?(input: LiveRunDriverCancelInput): Promise<LiveRunDriverCancelResult>;
  normalizeResult?(value: unknown): LiveRunDriverStartResult | LiveRunDriverPollResult;
  normalizeError?(error: unknown): LiveRunError;
}

export interface LiveRunDriverRegistry {
  readonly drivers: readonly LiveRunProviderDriver[];
  resolve(input: Pick<LiveRunRequest, "capabilityId" | "providerId">): LiveRunProviderDriver | null;
}

export type RealtimeTalkTransport = "gateway-relay";
export type RealtimeTalkStatus = "error" | "idle" | "listening" | "speaking" | "thinking";
export type RealtimeTranscriptRole = "assistant" | "user";

export interface RealtimeTalkSideEffects {
  readonly audioBytesRead: boolean;
  readonly microphoneAccessed: boolean;
  readonly speakerAccessed: boolean;
  readonly rawAudioPersisted: boolean;
  readonly providerCredentialsUsed: boolean;
  readonly networkUsed: boolean;
  readonly localProcessStarted: boolean;
  readonly whisperStarted: boolean;
}

export interface GatewayRelayRealtimeTalkSessionPlanReady {
  readonly ok: true;
  readonly status: "ready";
  readonly providerId: string;
  readonly relaySessionId: string;
  readonly transport: RealtimeTalkTransport;
  readonly channel: string;
  readonly model?: string;
  readonly voice?: string;
  readonly sideEffects: RealtimeTalkSideEffects;
}

export interface GatewayRelayRealtimeTalkSessionPlanBlocked {
  readonly ok: false;
  readonly status: "blocked";
  readonly providerId: string;
  readonly relaySessionId?: string;
  readonly transport: RealtimeTalkTransport;
  readonly channel: string;
  readonly reason: string;
  readonly sideEffects: RealtimeTalkSideEffects;
}

export type GatewayRelayRealtimeTalkSessionPlan =
  | GatewayRelayRealtimeTalkSessionPlanBlocked
  | GatewayRelayRealtimeTalkSessionPlanReady;

export function createLiveRunDriverRegistry(
  drivers: readonly LiveRunProviderDriver[],
): LiveRunDriverRegistry {
  const activeDrivers = [...drivers];
  return {
    drivers: activeDrivers,
    resolve(input) {
      return (
        activeDrivers.find(
          (driver) =>
            driver.providerId === input.providerId &&
            driver.capabilities.includes(input.capabilityId),
        ) ?? null
      );
    },
  };
}

export function createGatewayRelayRealtimeTalkSessionPlan(
  session: LiveRunSession,
  options: {
    readonly relaySessionId?: string;
    readonly channel: string;
    readonly model?: string;
    readonly voice?: string;
    readonly operatorEvidenceGranted: boolean;
  },
): GatewayRelayRealtimeTalkSessionPlan {
  const sideEffects = createFailClosedRealtimeTalkSideEffects();
  if (session.capabilityId !== "audio.realtime.talk") {
    return {
      ok: false,
      status: "blocked",
      providerId: session.providerId,
      transport: "gateway-relay",
      channel: options.channel,
      reason: "当前 live run 不是实时语音对话任务。",
      sideEffects,
    };
  }
  if (!options.operatorEvidenceGranted) {
    return {
      ok: false,
      status: "blocked",
      providerId: session.providerId,
      ...(options.relaySessionId === undefined ? {} : { relaySessionId: options.relaySessionId }),
      transport: "gateway-relay",
      channel: options.channel,
      reason: "缺少操作授权，未启动实时语音对话。",
      sideEffects,
    };
  }
  const relaySessionId = options.relaySessionId ?? `relay_${sanitizeId(session.sessionId)}`;
  return {
    ok: true,
    status: "ready",
    providerId: session.providerId,
    relaySessionId,
    transport: "gateway-relay",
    channel: options.channel,
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.voice === undefined ? {} : { voice: options.voice }),
    sideEffects,
  };
}

export function createRealtimeTranscriptEvent(
  session: LiveRunSession,
  options: {
    readonly role: RealtimeTranscriptRole;
    readonly text: string;
    readonly final: boolean;
    readonly occurredAt?: string;
    readonly segmentId?: string;
  },
): LiveRunEvent {
  const occurredAt = options.occurredAt ?? new Date().toISOString();
  const text = options.text.trim();
  return createLiveRunEvent(
    session,
    options.final ? "realtime.transcript.final" : "realtime.transcript.partial",
    options.final ? "Realtime transcript final." : "Realtime transcript partial.",
    {
      occurredAt,
      metadata: {
        realtimeTranscript: {
          role: options.role,
          text,
          final: options.final,
          ...(options.segmentId === undefined ? {} : { segmentId: options.segmentId }),
          ...createFailClosedRealtimeTalkSideEffects(),
        },
      },
    },
  );
}

export function createRealtimeTalkStatusEvent(
  session: LiveRunSession,
  options: {
    readonly status: RealtimeTalkStatus;
    readonly detail?: string;
    readonly occurredAt?: string;
  },
): LiveRunEvent {
  const occurredAt = options.occurredAt ?? new Date().toISOString();
  return createLiveRunEvent(session, "talk.status", `Talk status: ${options.status}.`, {
    occurredAt,
    metadata: {
      talk: {
        status: options.status,
        ...(options.detail === undefined ? {} : { detail: options.detail }),
        ...createFailClosedRealtimeTalkSideEffects(),
      },
    },
  });
}

export function stopRealtimeTalkSession(
  session: LiveRunSession,
  options: {
    readonly now?: string;
    readonly reason?: string;
    readonly relaySessionId?: string;
  } = {},
): LiveRunTransitionResult {
  const now = options.now ?? new Date().toISOString();
  const statusEvent = createRealtimeTalkStatusEvent(session, {
    status: "idle",
    detail: "实时语音对话已停止。",
    occurredAt: now,
  });
  const cancelled = cancelLiveRunSession(session, {
    now,
    reason: options.reason ?? "stopped",
    metadata: {
      realtimeTalk: {
        transport: "gateway-relay",
        stopped: true,
        ...(options.relaySessionId === undefined ? {} : { relaySessionId: options.relaySessionId }),
        ...createFailClosedRealtimeTalkSideEffects(),
      },
    },
  });
  return {
    session: cancelled.session,
    events: [statusEvent, ...cancelled.events],
  };
}

export function createInMemoryLiveRunStore(): LiveRunStore {
  const sessions = new Map<string, LiveRunSession>();
  const events = new Map<string, LiveRunEvent[]>();

  return {
    async appendTransition(input) {
      sessions.set(input.session.sessionId, cloneLiveRunSession(input.session));
      const existingEvents = events.get(input.session.sessionId) ?? [];
      events.set(input.session.sessionId, [
        ...existingEvents,
        ...input.events.map((event) => cloneLiveRunEvent(event)),
      ]);
    },
    async getSession(sessionId) {
      const session = sessions.get(sessionId);
      return session === undefined ? null : cloneLiveRunSession(session);
    },
    async listSessions(query = {}) {
      return filterLiveRunSessions([...sessions.values()], query).map((session) =>
        cloneLiveRunSession(session),
      );
    },
    async listEvents(sessionId) {
      return (events.get(sessionId) ?? []).map((event) => cloneLiveRunEvent(event));
    },
  };
}

export function createSessionStoreLiveRunStore(
  options: SessionStoreLiveRunStoreOptions,
): LiveRunStore {
  ensureLiveRunJournalSession(options);

  return {
    async appendTransition(input) {
      for (const event of input.events) {
        options.sessionStore.appendJournal(options.journalSessionId, {
          eventType: LIVE_RUNNER_JOURNAL_EVENT_TYPE,
          payload: toJsonObject({
            event,
            session: input.session,
            schemaVersion: LIVE_RUNNER_JOURNAL_SCHEMA_VERSION,
          }),
          createdAtMs: toEpochMs(event.occurredAt),
          ...(options.turnId === undefined ? {} : { turnId: options.turnId }),
        });
      }
    },
    async getSession(sessionId) {
      return projectLiveRunJournal(options).sessions.get(sessionId) ?? null;
    },
    async listSessions(query = {}) {
      return filterLiveRunSessions([...projectLiveRunJournal(options).sessions.values()], query);
    },
    async listEvents(sessionId) {
      return projectLiveRunJournal(options).events.get(sessionId) ?? [];
    },
  };
}

export function createQueuedLiveRunSession(
  request: LiveRunRequest,
  options: { readonly sessionId?: string; readonly now?: string } = {},
): LiveRunTransitionResult {
  const now = options.now ?? request.createdAt ?? new Date().toISOString();
  const session: LiveRunSession = {
    runId: request.runId,
    sessionId: options.sessionId ?? `live_${sanitizeId(request.runId)}_${Date.parse(now) || 0}`,
    runnerId: request.runnerId,
    providerId: request.providerId,
    capabilityId: request.capabilityId,
    operationId: request.operationId,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    cancelable: true,
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
    artifacts: [],
    ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
  };
  return {
    session,
    events: [
      createLiveRunEvent(session, "runner.queued", "Live run queued.", {
        occurredAt: now,
        ...(isAudioLiveRunCapability(request.capabilityId)
          ? { metadata: createFailClosedLiveAudioMetadata() }
          : {}),
      }),
    ],
  };
}

export function createLiveRunAdmissionFromAgentOs(
  packet: AgentOsLiveRunnerAdmissionPacket,
  options: { readonly sessionId?: string; readonly startedAt?: string } = {},
): LiveRunAdmission {
  const agentOsSession = startAgentOsLiveRunnerSession(packet, {
    ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    ...(options.startedAt === undefined ? {} : { startedAt: options.startedAt }),
  });
  return {
    ok: packet.ok && agentOsSession.ok,
    status: packet.status,
    canStartLiveRunner: packet.canStartLiveRunner && agentOsSession.ok,
    controlPlaneSessionStarted: agentOsSession.controlPlaneSessionStarted,
    agentOsAdmission: packet,
    agentOsSession,
    issues: packet.issues,
  };
}

export function admitLiveRunSession(
  session: LiveRunSession,
  admission: LiveRunAdmission,
  options: { readonly now?: string } = {},
): LiveRunTransitionResult {
  const now = options.now ?? new Date().toISOString();
  if (!admission.ok || !admission.canStartLiveRunner) {
    return failLiveRunSession(
      session,
      {
        code: "live-runner-admission-blocked",
        message: "Live runner admission is blocked.",
        retryable: false,
        metadata: { issues: admission.issues },
      },
      { now },
    );
  }
  const next: LiveRunSession = {
    ...session,
    status: "admitted",
    updatedAt: now,
    admission,
  };
  return {
    session: next,
    events: [
      createLiveRunEvent(next, "runner.admitted", "Live runner admission accepted.", {
        occurredAt: now,
        metadata: { issues: admission.issues },
      }),
    ],
  };
}

export function startLiveRunSession(
  session: LiveRunSession,
  options: {
    readonly now?: string;
    readonly providerTask?: LiveRunProviderTask;
    readonly progress?: number;
    readonly liveRunnerStarted?: boolean;
    readonly metadata?: Readonly<Record<string, unknown>>;
  } = {},
): LiveRunTransitionResult {
  const now = options.now ?? new Date().toISOString();
  const status: LiveRunStatus = options.providerTask === undefined ? "running" : "polling";
  const providerTask = options.providerTask ?? session.providerTask;
  const progress = clampProgress(options.progress ?? session.progress ?? 0);
  const metadata = mergeMetadata(session.metadata, options.metadata);
  const next: LiveRunSession = {
    ...session,
    status,
    startedAt: session.startedAt ?? now,
    updatedAt: now,
    cancelable: true,
    liveRunnerStarted: options.liveRunnerStarted ?? true,
    providerSdkLoaded: true,
    providerCredentialsUsed: true,
    networkUsed: true,
    audioBytesRead: session.audioBytesRead,
    microphoneAccessed: session.microphoneAccessed,
    speakerAccessed: session.speakerAccessed,
    rawAudioPersisted: session.rawAudioPersisted,
    speechTranscribed: session.speechTranscribed,
    speechSynthesized: session.speechSynthesized,
    whisperStarted: session.whisperStarted,
    progress,
    ...(providerTask === undefined ? {} : { providerTask }),
    ...(metadata === undefined ? {} : { metadata }),
  };
  return {
    session: next,
    events: [
      createLiveRunEvent(next, "runner.started", "Live runner started.", {
        occurredAt: now,
        progress,
        ...(next.providerTask === undefined ? {} : { providerTask: next.providerTask }),
        ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
      }),
      ...(next.providerTask === undefined
        ? []
        : [
            createLiveRunEvent(next, "provider.task.accepted", "Provider task accepted.", {
              occurredAt: now,
              providerTask: next.providerTask,
            }),
          ]),
    ],
  };
}

export function updateLiveRunProgress(
  session: LiveRunSession,
  options: {
    readonly now?: string;
    readonly progress: number;
    readonly providerTask?: LiveRunProviderTask;
    readonly message?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  },
): LiveRunTransitionResult {
  const now = options.now ?? new Date().toISOString();
  const providerTask = options.providerTask ?? session.providerTask;
  const progress = clampProgress(options.progress);
  const metadata = mergeMetadata(session.metadata, options.metadata);
  const next: LiveRunSession = {
    ...session,
    status: "polling",
    updatedAt: now,
    progress,
    ...(providerTask === undefined ? {} : { providerTask }),
    ...(metadata === undefined ? {} : { metadata }),
  };
  return {
    session: next,
    events: [
      createLiveRunEvent(next, "provider.poll.progress", options.message ?? "Provider progress.", {
        occurredAt: now,
        progress,
        ...(next.providerTask === undefined ? {} : { providerTask: next.providerTask }),
        ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
      }),
    ],
  };
}

export function completeLiveRunSession(
  session: LiveRunSession,
  options: {
    readonly now?: string;
    readonly artifacts?: readonly LiveRunArtifact[];
    readonly message?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  } = {},
): LiveRunTransitionResult {
  const now = options.now ?? new Date().toISOString();
  const artifacts = [...session.artifacts, ...(options.artifacts ?? [])];
  const metadata = mergeMetadata(session.metadata, options.metadata);
  const next: LiveRunSession = {
    ...session,
    status: "completed",
    updatedAt: now,
    endedAt: now,
    cancelable: false,
    progress: 100,
    artifacts,
    ...(metadata === undefined ? {} : { metadata }),
  };
  return {
    session: next,
    events: [
      ...(options.artifacts ?? []).map((artifact) =>
        createLiveRunEvent(next, "artifact.created", "Live runner artifact created.", {
          occurredAt: now,
          artifact,
        }),
      ),
      createLiveRunEvent(next, "runner.completed", options.message ?? "Live run completed.", {
        occurredAt: now,
        progress: 100,
        ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
      }),
    ],
  };
}

export function requestLiveRunCancel(
  session: LiveRunSession,
  options: {
    readonly now?: string;
    readonly reason?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  } = {},
): LiveRunTransitionResult {
  const now = options.now ?? new Date().toISOString();
  const reason = options.reason ?? "cancelled";
  const metadata = mergeMetadata(session.metadata, options.metadata);
  const next: LiveRunSession = {
    ...session,
    status: "cancelling",
    updatedAt: now,
    cancelRequestedAt: now,
    cancelReason: reason,
    cancelable: true,
    ...(metadata === undefined ? {} : { metadata }),
  };
  return {
    session: next,
    events: [
      createLiveRunEvent(next, "runner.cancel.requested", "Live run cancellation requested.", {
        occurredAt: now,
        metadata: { reason, ...(options.metadata ?? {}) },
      }),
    ],
  };
}

export function createLiveRunCancelToken(
  session: LiveRunSession,
  options: {
    readonly now?: string;
    readonly reason?: string;
    readonly revoked?: boolean;
    readonly metadata?: Readonly<Record<string, unknown>>;
  } = {},
): LiveRunCancelToken {
  return {
    runId: session.runId,
    sessionId: session.sessionId,
    requestedAt: options.now ?? new Date().toISOString(),
    reason: options.reason ?? session.cancelReason ?? "cancelled",
    revoked: options.revoked ?? true,
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  };
}

export function cancelLiveRunSession(
  session: LiveRunSession,
  options: {
    readonly now?: string;
    readonly reason?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  } = {},
): LiveRunTransitionResult {
  const now = options.now ?? new Date().toISOString();
  const reason = options.reason ?? session.cancelReason ?? "cancelled";
  const agentOsSession =
    session.admission?.agentOsSession === undefined
      ? undefined
      : cancelAgentOsLiveRunnerSession(session.admission.agentOsSession, {
          cancelledAt: now,
          reason,
        });
  const admission =
    session.admission === undefined
      ? undefined
      : {
          ...session.admission,
          ok: false,
          canStartLiveRunner: false,
          controlPlaneSessionStarted: false,
          ...(agentOsSession === undefined ? {} : { agentOsSession }),
        };
  const metadata = mergeMetadata(session.metadata, options.metadata);
  const next: LiveRunSession = {
    ...session,
    status: "cancelled",
    updatedAt: now,
    endedAt: now,
    cancelRequestedAt: session.cancelRequestedAt ?? now,
    cancelReason: reason,
    cancelable: false,
    ...(admission === undefined ? {} : { admission }),
    ...(metadata === undefined ? {} : { metadata }),
  };
  return {
    session: next,
    events: [
      createLiveRunEvent(next, "runner.cancelled", "Live run cancelled.", {
        occurredAt: now,
        metadata: { reason, ...(options.metadata ?? {}) },
      }),
    ],
  };
}

export function failLiveRunSession(
  session: LiveRunSession,
  error: LiveRunError,
  options: { readonly now?: string; readonly metadata?: Readonly<Record<string, unknown>> } = {},
): LiveRunTransitionResult {
  const now = options.now ?? new Date().toISOString();
  const metadata = mergeMetadata(session.metadata, options.metadata);
  const next: LiveRunSession = {
    ...session,
    status: "failed",
    updatedAt: now,
    endedAt: now,
    cancelable: false,
    error,
    ...(metadata === undefined ? {} : { metadata }),
  };
  return {
    session: next,
    events: [
      createLiveRunEvent(next, "runner.failed", error.message, {
        occurredAt: now,
        error,
        ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
      }),
    ],
  };
}

export function timeoutLiveRunSession(
  session: LiveRunSession,
  options: {
    readonly now?: string;
    readonly message?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  } = {},
): LiveRunTransitionResult {
  const now = options.now ?? new Date().toISOString();
  const error: LiveRunError = {
    code: "live-runner-timeout",
    message: options.message ?? "Live run timed out.",
    retryable: true,
  };
  const metadata = mergeMetadata(session.metadata, options.metadata);
  const next: LiveRunSession = {
    ...session,
    status: "timed_out",
    updatedAt: now,
    endedAt: now,
    cancelable: false,
    error,
    ...(metadata === undefined ? {} : { metadata }),
  };
  return {
    session: next,
    events: [
      createLiveRunEvent(next, "runner.timed_out", error.message, {
        occurredAt: now,
        error,
        ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
      }),
    ],
  };
}

export function orphanLiveRunSession(
  session: LiveRunSession,
  options: {
    readonly now?: string;
    readonly message?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  } = {},
): LiveRunTransitionResult {
  const now = options.now ?? new Date().toISOString();
  const metadata = mergeMetadata(session.metadata, options.metadata);
  const next: LiveRunSession = {
    ...session,
    status: "orphaned",
    updatedAt: now,
    cancelable: true,
    ...(metadata === undefined ? {} : { metadata }),
  };
  return {
    session: next,
    events: [
      createLiveRunEvent(next, "runner.orphaned", options.message ?? "Live run orphaned.", {
        occurredAt: now,
        ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
      }),
    ],
  };
}

export function normalizeLiveRunError(error: unknown): LiveRunError {
  if (isLiveRunError(error)) {
    return error;
  }
  return {
    code: "live-runner-error",
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}

function createLiveRunEvent(
  session: LiveRunSession,
  type: LiveRunEventType,
  message: string,
  options: {
    readonly occurredAt: string;
    readonly progress?: number;
    readonly providerTask?: LiveRunProviderTask;
    readonly artifact?: LiveRunArtifact;
    readonly error?: LiveRunError;
    readonly metadata?: Readonly<Record<string, unknown>>;
  },
): LiveRunEvent {
  return {
    id: `${session.runId}:${type}:${Date.parse(options.occurredAt) || 0}:${hashEventPayload({
      message,
      type,
      metadata: options.metadata,
    })}`,
    runId: session.runId,
    sessionId: session.sessionId,
    type,
    occurredAt: options.occurredAt,
    providerId: session.providerId,
    capabilityId: session.capabilityId,
    message,
    ...(options.progress === undefined ? {} : { progress: options.progress }),
    ...(options.providerTask === undefined ? {} : { providerTask: options.providerTask }),
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
    ...(options.error === undefined ? {} : { error: options.error }),
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  };
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

function isLiveRunError(value: unknown): value is LiveRunError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LiveRunError).code === "string" &&
    typeof (value as LiveRunError).message === "string" &&
    typeof (value as LiveRunError).retryable === "boolean"
  );
}

function mergeMetadata(
  left: Readonly<Record<string, unknown>> | undefined,
  right: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return {
    ...left,
    ...right,
  };
}

function sanitizeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/gu, "_").replace(/^_+|_+$/gu, "") || "run";
}

function hashEventPayload(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function ensureLiveRunJournalSession(options: SessionStoreLiveRunStoreOptions): void {
  if (options.sessionStore.getSession(options.journalSessionId) !== null) {
    return;
  }
  options.sessionStore.createSession({
    sessionId: options.journalSessionId,
    metadata: {
      owner: "director-angel",
      purpose: "live-runner session journal",
      liveRunner: {
        durableStore: true,
        schemaVersion: LIVE_RUNNER_JOURNAL_SCHEMA_VERSION,
        createdAt: options.now?.() ?? new Date().toISOString(),
      },
    },
  });
}

function projectLiveRunJournal(options: SessionStoreLiveRunStoreOptions): {
  readonly sessions: Map<string, LiveRunSession>;
  readonly events: Map<string, LiveRunEvent[]>;
} {
  const sessions = new Map<string, LiveRunSession>();
  const events = new Map<string, LiveRunEvent[]>();

  for (const entry of options.sessionStore.journal.list(options.journalSessionId)) {
    if (entry.eventType !== LIVE_RUNNER_JOURNAL_EVENT_TYPE) {
      continue;
    }
    const payload = decodeLiveRunJournalPayload(entry.payload);
    if (payload === null) {
      continue;
    }
    sessions.set(payload.session.sessionId, cloneLiveRunSession(payload.session));
    events.set(payload.event.sessionId, [
      ...(events.get(payload.event.sessionId) ?? []),
      cloneLiveRunEvent(payload.event),
    ]);
  }

  return {
    sessions,
    events,
  };
}

function decodeLiveRunJournalPayload(
  value: JsonValue,
): { readonly event: LiveRunEvent; readonly session: LiveRunSession } | null {
  if (!isRecord(value)) {
    return null;
  }
  const event = decodeLiveRunEvent(value.event);
  const session = decodeLiveRunSession(value.session);
  if (event === null || session === null) {
    return null;
  }
  return { event, session };
}

function decodeLiveRunEvent(value: unknown): LiveRunEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.runId !== "string" ||
    typeof value.sessionId !== "string" ||
    !isLiveRunEventType(value.type) ||
    typeof value.occurredAt !== "string" ||
    typeof value.providerId !== "string" ||
    typeof value.capabilityId !== "string" ||
    typeof value.message !== "string"
  ) {
    return null;
  }

  const progress = typeof value.progress === "number" ? value.progress : undefined;
  const providerTask = decodeLiveRunProviderTask(value.providerTask);
  const artifact = decodeLiveRunArtifact(value.artifact);
  const error = decodeLiveRunError(value.error);
  const metadata = decodeReadonlyRecord(value.metadata);

  return {
    id: value.id,
    runId: value.runId,
    sessionId: value.sessionId,
    type: value.type,
    occurredAt: value.occurredAt,
    providerId: value.providerId,
    capabilityId: value.capabilityId,
    message: value.message,
    ...(progress === undefined ? {} : { progress }),
    ...(providerTask === undefined ? {} : { providerTask }),
    ...(artifact === undefined ? {} : { artifact }),
    ...(error === undefined ? {} : { error }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function decodeLiveRunSession(value: unknown): LiveRunSession | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.runId !== "string" ||
    typeof value.sessionId !== "string" ||
    typeof value.runnerId !== "string" ||
    typeof value.providerId !== "string" ||
    typeof value.capabilityId !== "string" ||
    typeof value.operationId !== "string" ||
    !isLiveRunStatus(value.status) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.cancelable !== "boolean" ||
    typeof value.liveRunnerStarted !== "boolean" ||
    typeof value.providerSdkLoaded !== "boolean" ||
    typeof value.providerCredentialsUsed !== "boolean" ||
    typeof value.networkUsed !== "boolean" ||
    typeof value.localProcessStarted !== "boolean" ||
    !Array.isArray(value.artifacts)
  ) {
    return null;
  }

  const artifacts = value.artifacts
    .map((artifact) => decodeLiveRunArtifact(artifact))
    .filter((artifact): artifact is LiveRunArtifact => artifact !== undefined);
  const progress = typeof value.progress === "number" ? value.progress : undefined;
  const providerTask = decodeLiveRunProviderTask(value.providerTask);
  const error = decodeLiveRunError(value.error);
  const admission = decodeLiveRunAdmission(value.admission);
  const metadata = decodeReadonlyRecord(value.metadata);

  return {
    runId: value.runId,
    sessionId: value.sessionId,
    runnerId: value.runnerId,
    providerId: value.providerId,
    capabilityId: value.capabilityId,
    operationId: value.operationId,
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(typeof value.startedAt === "string" ? { startedAt: value.startedAt } : {}),
    ...(typeof value.endedAt === "string" ? { endedAt: value.endedAt } : {}),
    ...(typeof value.cancelRequestedAt === "string"
      ? { cancelRequestedAt: value.cancelRequestedAt }
      : {}),
    ...(typeof value.cancelReason === "string" ? { cancelReason: value.cancelReason } : {}),
    cancelable: value.cancelable,
    liveRunnerStarted: value.liveRunnerStarted,
    providerSdkLoaded: value.providerSdkLoaded,
    providerCredentialsUsed: value.providerCredentialsUsed,
    networkUsed: value.networkUsed,
    localProcessStarted: value.localProcessStarted,
    audioBytesRead: value.audioBytesRead === true,
    microphoneAccessed: value.microphoneAccessed === true,
    speakerAccessed: value.speakerAccessed === true,
    rawAudioPersisted: value.rawAudioPersisted === true,
    speechTranscribed: value.speechTranscribed === true,
    speechSynthesized: value.speechSynthesized === true,
    whisperStarted: value.whisperStarted === true,
    ...(progress === undefined ? {} : { progress }),
    ...(providerTask === undefined ? {} : { providerTask }),
    artifacts,
    ...(error === undefined ? {} : { error }),
    ...(admission === undefined ? {} : { admission }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function decodeLiveRunAdmission(value: unknown): LiveRunAdmission | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.ok !== "boolean" ||
    !isLiveRunAdmissionStatus(value.status) ||
    typeof value.canStartLiveRunner !== "boolean" ||
    typeof value.controlPlaneSessionStarted !== "boolean" ||
    !Array.isArray(value.issues)
  ) {
    return undefined;
  }
  return {
    ok: value.ok,
    status: value.status,
    canStartLiveRunner: value.canStartLiveRunner,
    controlPlaneSessionStarted: value.controlPlaneSessionStarted,
    ...(isRecord(value.agentOsAdmission)
      ? { agentOsAdmission: value.agentOsAdmission as unknown as AgentOsLiveRunnerAdmissionPacket }
      : {}),
    ...(isRecord(value.agentOsSession)
      ? { agentOsSession: value.agentOsSession as unknown as AgentOsLiveRunnerSession }
      : {}),
    issues: value.issues.filter((issue): issue is string => typeof issue === "string"),
  };
}

function decodeLiveRunProviderTask(value: unknown): LiveRunProviderTask | undefined {
  if (!isRecord(value) || typeof value.taskId !== "string") {
    return undefined;
  }
  const metadata = decodeReadonlyRecord(value.metadata);
  return {
    taskId: value.taskId,
    ...(typeof value.status === "string" ? { status: value.status } : {}),
    ...(typeof value.pollAfterMs === "number" ? { pollAfterMs: value.pollAfterMs } : {}),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function decodeLiveRunArtifact(value: unknown): LiveRunArtifact | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.kind !== "string") {
    return undefined;
  }
  const metadata = decodeReadonlyRecord(value.metadata);
  return {
    id: value.id,
    kind: value.kind,
    ...(typeof value.url === "string" ? { url: value.url } : {}),
    ...(typeof value.path === "string" ? { path: value.path } : {}),
    ...(typeof value.mimeType === "string" ? { mimeType: value.mimeType } : {}),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function decodeLiveRunError(value: unknown): LiveRunError | undefined {
  if (!isRecord(value) || !isLiveRunError(value)) {
    return undefined;
  }
  const metadata = decodeReadonlyRecord(value.metadata);
  return {
    code: value.code,
    message: value.message,
    retryable: value.retryable,
    ...(typeof value.providerStatus === "number" ? { providerStatus: value.providerStatus } : {}),
    ...(typeof value.providerStatusText === "string"
      ? { providerStatusText: value.providerStatusText }
      : {}),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function filterLiveRunSessions(
  sessions: readonly LiveRunSession[],
  query: LiveRunStoreSessionQuery,
): readonly LiveRunSession[] {
  return sessions.filter((session) => {
    if (query.runId !== undefined && session.runId !== query.runId) {
      return false;
    }
    if (query.providerId !== undefined && session.providerId !== query.providerId) {
      return false;
    }
    if (query.activeOnly === true && !session.cancelable) {
      return false;
    }
    return true;
  });
}

function cloneLiveRunSession(session: LiveRunSession): LiveRunSession {
  return structuredClone(session) as LiveRunSession;
}

function cloneLiveRunEvent(event: LiveRunEvent): LiveRunEvent {
  return structuredClone(event) as LiveRunEvent;
}

function isAudioLiveRunCapability(capabilityId: LiveRunCapabilityId): boolean {
  return (AUDIO_LIVE_RUN_CAPABILITY_IDS as readonly string[]).includes(capabilityId);
}

function createFailClosedLiveAudioMetadata(): Readonly<Record<string, unknown>> {
  return {
    liveAudio: {
      failClosed: true,
      audioBytesRead: false,
      microphoneAccessed: false,
      speakerAccessed: false,
      rawAudioPersisted: false,
      speechTranscribed: false,
      speechSynthesized: false,
      whisperStarted: false,
      liveRunnerStarted: false,
    },
  };
}

function createFailClosedRealtimeTalkSideEffects(): RealtimeTalkSideEffects {
  return {
    audioBytesRead: false,
    microphoneAccessed: false,
    speakerAccessed: false,
    rawAudioPersisted: false,
    providerCredentialsUsed: false,
    networkUsed: false,
    localProcessStarted: false,
    whisperStarted: false,
  };
}

function toEpochMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
}

function toJsonObject(value: unknown): JsonObject {
  const jsonValue = toJsonValue(value);
  if (isRecord(jsonValue) && !Array.isArray(jsonValue)) {
    return jsonValue as JsonObject;
  }
  return { value: jsonValue };
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry));
  }
  if (typeof value === "object") {
    const result: JsonObject = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested !== undefined) {
        result[key] = toJsonValue(nested);
      }
    }
    return result;
  }
  return String(value);
}

function decodeReadonlyRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return isRecord(value) && !Array.isArray(value) ? { ...value } : undefined;
}

function isLiveRunStatus(value: unknown): value is LiveRunStatus {
  return (
    value === "admitted" ||
    value === "cancelled" ||
    value === "cancelling" ||
    value === "completed" ||
    value === "failed" ||
    value === "orphaned" ||
    value === "polling" ||
    value === "queued" ||
    value === "running" ||
    value === "starting" ||
    value === "timed_out"
  );
}

function isLiveRunEventType(value: unknown): value is LiveRunEventType {
  return (
    value === "artifact.created" ||
    value === "provider.poll.progress" ||
    value === "provider.request.sent" ||
    value === "provider.task.accepted" ||
    value === "realtime.transcript.final" ||
    value === "realtime.transcript.partial" ||
    value === "runner.admitted" ||
    value === "runner.cancel.requested" ||
    value === "runner.cancelled" ||
    value === "runner.completed" ||
    value === "runner.failed" ||
    value === "runner.orphaned" ||
    value === "runner.queued" ||
    value === "runner.started" ||
    value === "runner.timed_out" ||
    value === "talk.status"
  );
}

function isLiveRunAdmissionStatus(value: unknown): value is LiveRunAdmission["status"] {
  return value === "admitted" || value === "blocked" || value === "revoked";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
