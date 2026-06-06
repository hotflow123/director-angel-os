import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionStore } from "@hotflow/sessions";
import { afterEach, describe, expect, it } from "vitest";

import { createAgentOsLiveRunnerAdmissionPacket } from "@hotflow/agent-os-sandbox";

import {
  AUDIO_LIVE_RUN_CAPABILITY_IDS,
  type LiveRunRequest,
  admitLiveRunSession,
  cancelLiveRunSession,
  completeLiveRunSession,
  createGatewayRelayRealtimeTalkSessionPlan,
  createInMemoryLiveRunStore,
  createLiveRunAdmissionFromAgentOs,
  createLiveRunCancelToken,
  createLiveRunDriverRegistry,
  createQueuedLiveRunSession,
  createRealtimeTalkStatusEvent,
  createRealtimeTranscriptEvent,
  createSessionStoreLiveRunStore,
  failLiveRunSession,
  orphanLiveRunSession,
  requestLiveRunCancel,
  startLiveRunSession,
  stopRealtimeTalkSession,
  timeoutLiveRunSession,
  updateLiveRunProgress,
} from "../src/index.js";

const scratchDirs: string[] = [];

const request: LiveRunRequest = {
  runId: "run-1",
  runnerId: "live-runner.memefast",
  providerId: "memefast-api",
  capabilityId: "video_generation",
  operationId: "video.create",
  input: {
    prompt: "一只发光的机械鲸穿过城市上空",
    model: "doubao-seedance-2-0-260128",
  },
  createdAt: "2026-05-10T10:00:00.000Z",
};

function createSessionStore() {
  const dir = mkdtempSync(join(tmpdir(), "hotflow-live-runner-core-"));
  scratchDirs.push(dir);
  return new SessionStore({
    dbPath: join(dir, "sessions.sqlite"),
  });
}

function admittedPacket() {
  return createAgentOsLiveRunnerAdmissionPacket({
    runnerId: request.runnerId,
    providerId: request.providerId,
    capabilityId: request.capabilityId,
    requestedAt: "2026-05-10T10:00:01.000Z",
    mode: "dry-run",
    runnerIntent: {
      tokenIssued: true,
      signed: true,
      unlocked: true,
      revocationStatus: "active",
      tokenHash: "runner-intent-token-hash",
    },
    evidence: {
      operatorScopeGranted: true,
      sandboxAdmitted: true,
      providerConfigured: true,
      credentialsConfigured: true,
      networkPolicyGranted: true,
      dataPolicyAccepted: true,
      auditArtifactReady: true,
      cancellationSupported: true,
    },
  });
}

afterEachScratch();

describe("live runner core", () => {
  it("creates an auditable queued session", () => {
    const result = createQueuedLiveRunSession(request, {
      sessionId: "session-1",
      now: "2026-05-10T10:00:00.000Z",
    });

    expect(result.session).toMatchObject({
      runId: "run-1",
      sessionId: "session-1",
      providerId: "memefast-api",
      capabilityId: "video_generation",
      status: "queued",
      cancelable: true,
      liveRunnerStarted: false,
      providerCredentialsUsed: false,
      networkUsed: false,
    });
    expect(result.events).toEqual([
      expect.objectContaining({
        type: "runner.queued",
        runId: "run-1",
        sessionId: "session-1",
      }),
    ]);
  });

  it("declares unified audio live runner capability ids for multi-client voice", () => {
    expect(AUDIO_LIVE_RUN_CAPABILITY_IDS).toEqual([
      "audio.capture",
      "audio.transcribe",
      "audio.synthesize",
      "audio.realtime.transcribe",
      "audio.realtime.talk",
    ]);
    expect(
      createLiveRunDriverRegistry([
        {
          id: "voice-gateway-relay",
          providerId: "voice.gateway-relay",
          capabilities: AUDIO_LIVE_RUN_CAPABILITY_IDS,
          cancellationSupported: true,
          start: async () => ({ completed: false }),
        },
      ]).resolve({
        providerId: "voice.gateway-relay",
        capabilityId: "audio.realtime.talk",
      }),
    ).toMatchObject({
      id: "voice-gateway-relay",
      providerId: "voice.gateway-relay",
    });
  });

  it("keeps queued audio live runs fail-closed before any device or provider side effect", () => {
    const audioRequest: LiveRunRequest = {
      runId: "audio-run-1",
      runnerId: "live-runner.voice.gateway-relay",
      providerId: "voice.gateway-relay",
      capabilityId: "audio.realtime.talk",
      operationId: "audio.realtime.talk",
      input: {
        channel: "desktop",
        mode: "gateway-relay",
      },
      metadata: {
        voice: {
          rawAudioStorage: "forbidden",
        },
      },
      createdAt: "2026-05-12T10:00:00.000Z",
    };
    const queued = createQueuedLiveRunSession(audioRequest, {
      sessionId: "audio-session-1",
      now: "2026-05-12T10:00:00.000Z",
    });

    expect(queued.session).toMatchObject({
      capabilityId: "audio.realtime.talk",
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
    });
    expect(queued.events[0]?.metadata).toMatchObject({
      liveAudio: {
        failClosed: true,
        microphoneAccessed: false,
        speakerAccessed: false,
        rawAudioPersisted: false,
      },
    });
  });

  it("plans gateway-relay realtime Talk sessions fail-closed until operator evidence exists", () => {
    const audioRequest: LiveRunRequest = {
      runId: "talk-run-1",
      runnerId: "live-runner.voice.gateway-relay",
      providerId: "voice.gateway-relay",
      capabilityId: "audio.realtime.talk",
      operationId: "audio.realtime.talk",
      input: {
        channel: "desktop",
        transport: "gateway-relay",
        model: "gpt-realtime-placeholder",
        voice: "alloy",
      },
      createdAt: "2026-05-12T10:00:00.000Z",
    };
    const queued = createQueuedLiveRunSession(audioRequest, {
      sessionId: "talk-session-1",
      now: "2026-05-12T10:00:00.000Z",
    }).session;

    const plan = createGatewayRelayRealtimeTalkSessionPlan(queued, {
      relaySessionId: "relay-1",
      channel: "desktop",
      model: "gpt-realtime-placeholder",
      voice: "alloy",
      operatorEvidenceGranted: false,
    });

    expect(plan).toMatchObject({
      ok: false,
      status: "blocked",
      providerId: "voice.gateway-relay",
      reason: expect.stringContaining("缺少操作授权"),
      sideEffects: {
        microphoneAccessed: false,
        speakerAccessed: false,
        providerCredentialsUsed: false,
        networkUsed: false,
        audioBytesRead: false,
      },
    });
  });

  it("creates durable realtime transcript and Talk status events without side effects", () => {
    const queued = createQueuedLiveRunSession(
      {
        runId: "talk-run-2",
        runnerId: "live-runner.voice.gateway-relay",
        providerId: "voice.gateway-relay",
        capabilityId: "audio.realtime.talk",
        operationId: "audio.realtime.talk",
        input: { channel: "desktop", transport: "gateway-relay" },
        createdAt: "2026-05-12T10:00:00.000Z",
      },
      {
        sessionId: "talk-session-2",
        now: "2026-05-12T10:00:00.000Z",
      },
    ).session;

    const partial = createRealtimeTranscriptEvent(queued, {
      role: "user",
      text: "我要做一个",
      final: false,
      occurredAt: "2026-05-12T10:00:01.000Z",
    });
    const final = createRealtimeTranscriptEvent(queued, {
      role: "user",
      text: "我要做一个短视频分镜",
      final: true,
      occurredAt: "2026-05-12T10:00:02.000Z",
    });
    const status = createRealtimeTalkStatusEvent(queued, {
      status: "thinking",
      detail: "正在整理你的语音意图",
      occurredAt: "2026-05-12T10:00:03.000Z",
    });

    expect(partial).toMatchObject({
      type: "realtime.transcript.partial",
      metadata: {
        realtimeTranscript: {
          role: "user",
          text: "我要做一个",
          final: false,
        },
      },
    });
    expect(final).toMatchObject({
      type: "realtime.transcript.final",
      metadata: {
        realtimeTranscript: {
          role: "user",
          text: "我要做一个短视频分镜",
          final: true,
        },
      },
    });
    expect(status).toMatchObject({
      type: "talk.status",
      metadata: {
        talk: {
          status: "thinking",
          detail: "正在整理你的语音意图",
          microphoneAccessed: false,
          speakerAccessed: false,
        },
      },
    });
  });

  it("stops realtime Talk sessions without leaking provider secrets or audio side effects", () => {
    const queued = createQueuedLiveRunSession(
      {
        runId: "talk-run-3",
        runnerId: "live-runner.voice.gateway-relay",
        providerId: "voice.gateway-relay",
        capabilityId: "audio.realtime.talk",
        operationId: "audio.realtime.talk",
        input: { channel: "desktop", transport: "gateway-relay" },
        createdAt: "2026-05-12T10:00:00.000Z",
      },
      {
        sessionId: "talk-session-3",
        now: "2026-05-12T10:00:00.000Z",
      },
    ).session;

    const stopped = stopRealtimeTalkSession(queued, {
      reason: "user-stop",
      relaySessionId: "relay-3",
      now: "2026-05-12T10:00:04.000Z",
    });

    expect(stopped.session).toMatchObject({
      status: "cancelled",
      cancelReason: "user-stop",
      liveRunnerStarted: false,
      providerCredentialsUsed: false,
      networkUsed: false,
      audioBytesRead: false,
      microphoneAccessed: false,
      speakerAccessed: false,
      rawAudioPersisted: false,
    });
    expect(stopped.events.map((event) => event.type)).toEqual(["talk.status", "runner.cancelled"]);
    expect(JSON.stringify(stopped)).not.toContain("sk-");
  });

  it("adapts Agent OS admission and keeps dry-run sessions side-effect-free", () => {
    const queued = createQueuedLiveRunSession(request, { sessionId: "session-1" }).session;
    const admission = createLiveRunAdmissionFromAgentOs(admittedPacket(), {
      sessionId: "agent-os-session-1",
      startedAt: "2026-05-10T10:00:02.000Z",
    });
    const admitted = admitLiveRunSession(queued, admission, {
      now: "2026-05-10T10:00:02.000Z",
    });

    expect(admission).toMatchObject({
      ok: true,
      status: "admitted",
      canStartLiveRunner: true,
      controlPlaneSessionStarted: true,
      agentOsSession: {
        status: "running",
        liveRunnerStarted: false,
        providerCredentialsUsed: false,
        networkUsed: false,
      },
    });
    expect(admitted.session).toMatchObject({
      status: "admitted",
      admission: {
        ok: true,
      },
    });
    expect(admitted.events.map((event) => event.type)).toEqual(["runner.admitted"]);
  });

  it("fails closed when admission is blocked", () => {
    const queued = createQueuedLiveRunSession(request, { sessionId: "session-1" }).session;
    const blockedPacket = createAgentOsLiveRunnerAdmissionPacket({
      runnerId: request.runnerId,
      providerId: request.providerId,
      capabilityId: request.capabilityId,
      mode: "dry-run",
      runnerIntent: {
        tokenIssued: false,
        signed: false,
        unlocked: false,
        revocationStatus: "missing",
      },
      evidence: {
        operatorScopeGranted: false,
        sandboxAdmitted: false,
        providerConfigured: true,
        credentialsConfigured: false,
        networkPolicyGranted: false,
        dataPolicyAccepted: false,
        auditArtifactReady: false,
        cancellationSupported: true,
      },
    });
    const admission = createLiveRunAdmissionFromAgentOs(blockedPacket);
    const result = admitLiveRunSession(queued, admission, {
      now: "2026-05-10T10:00:03.000Z",
    });

    expect(result.session.status).toBe("failed");
    expect(result.session.error).toMatchObject({
      code: "live-runner-admission-blocked",
      retryable: false,
    });
    expect(result.events[0]).toMatchObject({
      type: "runner.failed",
      error: {
        metadata: {
          issues: expect.arrayContaining([
            "operator-scope-missing",
            "credentials-config-missing",
            "runner-intent-token-missing",
          ]),
        },
      },
    });
  });

  it("runs through start, poll, artifact, and completion transitions", () => {
    const queued = createQueuedLiveRunSession(request, { sessionId: "session-1" }).session;
    const admission = createLiveRunAdmissionFromAgentOs(admittedPacket());
    const admitted = admitLiveRunSession(queued, admission).session;
    const started = startLiveRunSession(admitted, {
      now: "2026-05-10T10:00:04.000Z",
      providerTask: {
        taskId: "provider-task-1",
        status: "queued",
        pollAfterMs: 2000,
      },
      progress: 5,
    });
    const progress = updateLiveRunProgress(started.session, {
      now: "2026-05-10T10:00:06.000Z",
      progress: 47.8,
      providerTask: {
        taskId: "provider-task-1",
        status: "processing",
      },
    });
    const completed = completeLiveRunSession(progress.session, {
      now: "2026-05-10T10:00:10.000Z",
      artifacts: [
        {
          id: "artifact-video-1",
          kind: "video",
          url: "https://example.test/video.mp4",
          mimeType: "video/mp4",
        },
      ],
    });

    expect(started.session).toMatchObject({
      status: "polling",
      liveRunnerStarted: true,
      providerSdkLoaded: true,
      providerCredentialsUsed: true,
      networkUsed: true,
      progress: 5,
    });
    expect(started.events.map((event) => event.type)).toEqual([
      "runner.started",
      "provider.task.accepted",
    ]);
    expect(progress.session).toMatchObject({
      status: "polling",
      progress: 48,
    });
    expect(completed.session).toMatchObject({
      status: "completed",
      progress: 100,
      cancelable: false,
      artifacts: [
        expect.objectContaining({
          id: "artifact-video-1",
          kind: "video",
        }),
      ],
    });
    expect(completed.events.map((event) => event.type)).toEqual([
      "artifact.created",
      "runner.completed",
    ]);
  });

  it("uses one cancel token and revokes the control-plane session", () => {
    const queued = createQueuedLiveRunSession(request, { sessionId: "session-1" }).session;
    const admission = createLiveRunAdmissionFromAgentOs(admittedPacket(), {
      sessionId: "agent-os-session-1",
    });
    const admitted = admitLiveRunSession(queued, admission).session;
    const started = startLiveRunSession(admitted, {
      providerTask: { taskId: "provider-task-1", status: "processing" },
    }).session;
    const requested = requestLiveRunCancel(started, {
      now: "2026-05-10T10:00:07.000Z",
      reason: "operator-stop",
    });
    const token = createLiveRunCancelToken(requested.session, {
      now: "2026-05-10T10:00:07.000Z",
    });
    const cancelled = cancelLiveRunSession(requested.session, {
      now: "2026-05-10T10:00:08.000Z",
      reason: token.reason,
    });

    expect(requested.session).toMatchObject({
      status: "cancelling",
      cancelRequestedAt: "2026-05-10T10:00:07.000Z",
      cancelReason: "operator-stop",
    });
    expect(token).toMatchObject({
      runId: "run-1",
      sessionId: "session-1",
      reason: "operator-stop",
      revoked: true,
    });
    expect(cancelled.session).toMatchObject({
      status: "cancelled",
      cancelable: false,
      cancelReason: "operator-stop",
      admission: {
        ok: false,
        canStartLiveRunner: false,
        controlPlaneSessionStarted: false,
        agentOsSession: {
          status: "cancelled",
        },
      },
    });
    expect(cancelled.events.map((event) => event.type)).toEqual(["runner.cancelled"]);
  });

  it("keeps timeout, failure, orphan recovery, and driver registry separate from UI", () => {
    const queued = createQueuedLiveRunSession(request, { sessionId: "session-1" }).session;
    const failed = failLiveRunSession(queued, {
      code: "provider-500",
      message: "Provider failed.",
      providerStatus: 500,
      retryable: true,
    });
    const timedOut = timeoutLiveRunSession(queued, {
      message: "Provider poll timed out.",
    });
    const orphaned = orphanLiveRunSession(queued, {
      message: "Process restarted while provider task was still active.",
    });
    const registry = createLiveRunDriverRegistry([
      {
        id: "memefast-video",
        providerId: "memefast-api",
        capabilities: ["video_generation"],
        cancellationSupported: true,
        async start() {
          return {
            providerTask: {
              taskId: "task-1",
            },
          };
        },
      },
    ]);

    expect(failed.session).toMatchObject({
      status: "failed",
      error: {
        code: "provider-500",
        retryable: true,
      },
    });
    expect(timedOut.session).toMatchObject({
      status: "timed_out",
      error: {
        code: "live-runner-timeout",
        retryable: true,
      },
    });
    expect(orphaned.session).toMatchObject({
      status: "orphaned",
      cancelable: true,
    });
    expect(registry.resolve(request)).toMatchObject({
      id: "memefast-video",
      providerId: "memefast-api",
    });
    expect(
      registry.resolve({
        providerId: "memefast-api",
        capabilityId: "text",
      }),
    ).toBeNull();
  });

  it("persists transitions to an append-only memory store", async () => {
    const store = createInMemoryLiveRunStore();
    const queued = createQueuedLiveRunSession(request, {
      sessionId: "session-1",
      now: "2026-05-10T10:00:00.000Z",
    });
    const admission = createLiveRunAdmissionFromAgentOs(admittedPacket(), {
      sessionId: "agent-os-session-1",
    });
    const admitted = admitLiveRunSession(queued.session, admission, {
      now: "2026-05-10T10:00:02.000Z",
    });

    await store.appendTransition(queued);
    await store.appendTransition(admitted);

    await expect(store.getSession("session-1")).resolves.toMatchObject({
      sessionId: "session-1",
      status: "admitted",
      admission: {
        ok: true,
      },
    });
    await expect(store.listEvents("session-1")).resolves.toEqual([
      expect.objectContaining({ type: "runner.queued" }),
      expect.objectContaining({ type: "runner.admitted" }),
    ]);
    await expect(store.listSessions({ activeOnly: true, runId: "run-1" })).resolves.toEqual([
      expect.objectContaining({ sessionId: "session-1" }),
    ]);
  });

  it("persists live runner events through SessionStore journal for restart recovery", async () => {
    const sessionStore = createSessionStore();
    try {
      const store = createSessionStoreLiveRunStore({
        sessionStore,
        journalSessionId: "studio-run-1",
        turnId: "turn-live-1",
        now: () => "2026-05-10T10:00:20.000Z",
      });
      const queued = createQueuedLiveRunSession(request, {
        sessionId: "session-1",
        now: "2026-05-10T10:00:00.000Z",
      });
      const started = startLiveRunSession(queued.session, {
        now: "2026-05-10T10:00:04.000Z",
        providerTask: {
          taskId: "provider-task-1",
          status: "queued",
        },
        progress: 5,
      });

      await store.appendTransition(queued);
      await store.appendTransition(started);

      expect(sessionStore.getSession("studio-run-1")?.metadata).toMatchObject({
        owner: "director-angel",
        purpose: "live-runner session journal",
        liveRunner: {
          durableStore: true,
        },
      });
      const journal = sessionStore.journal.list("studio-run-1");
      expect(journal).toHaveLength(3);
      expect(journal.map((entry) => entry.eventType)).toEqual([
        "live_runner.event",
        "live_runner.event",
        "live_runner.event",
      ]);
      expect(journal.map((entry) => entry.turnId)).toEqual([
        "turn-live-1",
        "turn-live-1",
        "turn-live-1",
      ]);

      const recovered = createSessionStoreLiveRunStore({
        sessionStore,
        journalSessionId: "studio-run-1",
      });

      await expect(recovered.getSession("session-1")).resolves.toMatchObject({
        sessionId: "session-1",
        status: "polling",
        providerTask: {
          taskId: "provider-task-1",
        },
      });
      await expect(recovered.listEvents("session-1")).resolves.toEqual([
        expect.objectContaining({ type: "runner.queued" }),
        expect.objectContaining({ type: "runner.started" }),
        expect.objectContaining({ type: "provider.task.accepted" }),
      ]);
    } finally {
      sessionStore.close();
    }
  });
});

function afterEachScratch() {
  afterEach(() => {
    while (scratchDirs.length > 0) {
      const dir = scratchDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
}
