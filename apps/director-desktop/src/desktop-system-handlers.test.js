import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { FileSystemRunStore } from "@hotflow/director-execution";
import { FileExperienceStore, FileKnowledgeStore } from "@hotflow/director-knowledge";
import { FileSystemDirectorMemoryStore } from "@hotflow/director-memory";
import { FileSystemDirectorProposalStore } from "@hotflow/director-proposals";
import {
  createLearningArtifact,
  createMediaEvidenceRef,
  readLearningCandidates,
} from "@hotflow/conversation-runtime";
import {
  SkillManagementStore,
  resolveSkillManagementPath,
  resolveSkillUsagePath,
} from "@hotflow/skills";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as directorKnowledge from "../../cli/src/director-knowledge.ts";
import { createDirectorDesktopBridgeFacade } from "./desktop-bridge-facade.js";
import { DESKTOP_ACTIONS } from "./desktop-contract.js";
import {
  commandExistsOnPath,
  createDesktopOpenExternalUrlSandboxRunner,
  createDirectorDesktopSystemHandlers,
} from "./desktop-system-handlers.js";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("director desktop system handlers", () => {
  const tempRoots = [];

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(process.env, "DIRECTOR_MCP_OAUTH_STORAGE");
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("archives a desktop session transcript to disk before deletion", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-session-archive-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow-test");
    const handlers = createDirectorDesktopSystemHandlers({
      workspaceRoot,
      dataDir,
      knowledge: directorKnowledge,
    });
    const transcriptArchive = {
      schemaVersion: "director.desktop.session-transcript-archive.v1",
      sessionKey: "desktop:workbench:a",
      archivedAt: "2026-05-24T00:00:00.000Z",
      runtimeHistory: [
        { role: "user", content: "哪些地方最有用？" },
        { role: "assistant", content: "最有用的是提示词结构拆解。" },
      ],
      turns: [{ role: "user", text: "哪些地方最有用？" }],
      evidenceDisclosures: [
        { sourceUrl: "https://example.com/source", readStatus: "read" },
      ],
      activeEvidenceFrame: { frameId: "frame-a", sourceUrl: "https://example.com/source" },
    };

    const result = await handlers.composer.archiveSession({
      type: DESKTOP_ACTIONS.COMPOSER_SESSION_DELETE,
      sessionKey: "desktop:workbench:a",
      transcriptArchive,
    });

    expect(result.sessionArchive).toMatchObject({
      ok: true,
      sessionKey: "desktop:workbench:a",
    });
    expect(result.sessionArchive.archiveId).toContain("desktop-workbench-a");
    expect(result.sessionArchive.path).toContain(join(dataDir, "desktop-session-archives"));
    expect(existsSync(result.sessionArchive.path)).toBe(true);
    const archived = JSON.parse(readFileSync(result.sessionArchive.path, "utf8"));
    expect(archived).toMatchObject({
      schemaVersion: "director.desktop.session-transcript-archive.v1",
      sessionKey: "desktop:workbench:a",
      runtimeHistory: transcriptArchive.runtimeHistory,
      turns: transcriptArchive.turns,
      evidenceDisclosures: transcriptArchive.evidenceDisclosures,
      activeEvidenceFrame: transcriptArchive.activeEvidenceFrame,
    });
  });

  it("keeps desktop live audio fail-closed through bridge actions until a capture host is injected", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-live-audio-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "knowledgeRecall.enabled": true,
      "memory.enabled": true,
    });
    await writePublishedProductionKnowledgeFixture(workspaceRoot);
    writeLongTermMemoryFixture(workspaceRoot);
    writeRichSkillSnapshotFixture(workspaceRoot);
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const started = await bridge.invoke({
      type: DESKTOP_ACTIONS.LIVE_AUDIO_START,
      turnId: "desktop-audio-turn",
    });
    const status = await bridge.invoke({ type: DESKTOP_ACTIONS.LIVE_AUDIO_STATUS });
    const stopped = await bridge.invoke({
      type: DESKTOP_ACTIONS.LIVE_AUDIO_STOP,
      reason: "operator stop",
    });

    expect(started.liveAudio).toMatchObject({
      ok: false,
      status: "blocked",
      session: {
        capabilityId: "audio.capture",
        liveRunnerStarted: false,
        providerCredentialsUsed: false,
        networkUsed: false,
        microphoneAccessed: false,
        audioBytesRead: false,
        rawAudioPersisted: false,
        whisperStarted: false,
      },
    });
    expect(started.events.at(-1)?.body).toContain("真实麦克风");
    expect(status.liveAudio).toMatchObject({
      active: false,
      status: "blocked",
    });
    expect(stopped.liveAudio).toMatchObject({
      ok: true,
      status: "idle",
      released: false,
    });
  });

  it("routes desktop live audio through an injected capture host with stoppable lifecycle", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-live-audio-mock-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    const calls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        liveAudioCaptureAdapter: {
          async start(input) {
            calls.push(["start", input.session.sessionId]);
            return {
              stop: async () => calls.push(["stop", input.session.sessionId]),
              cancel: async (reason) => calls.push(["cancel", input.session.sessionId, reason]),
            };
          },
        },
      }),
    });

    const started = await bridge.invoke({
      type: DESKTOP_ACTIONS.LIVE_AUDIO_START,
      turnId: "desktop-audio-turn",
    });
    const status = await bridge.invoke({ type: DESKTOP_ACTIONS.LIVE_AUDIO_STATUS });
    const stopped = await bridge.invoke({
      type: DESKTOP_ACTIONS.LIVE_AUDIO_STOP,
      reason: "operator stop",
    });
    const cancelledAfterStop = await bridge.invoke({
      type: DESKTOP_ACTIONS.LIVE_AUDIO_CANCEL,
      reason: "second cancel",
    });

    expect(started.liveAudio).toMatchObject({
      ok: true,
      status: "recording",
      session: {
        capabilityId: "audio.capture",
        providerSdkLoaded: false,
        providerCredentialsUsed: false,
        networkUsed: false,
        rawAudioPersisted: false,
        whisperStarted: false,
      },
    });
    expect(status.liveAudio).toMatchObject({
      active: true,
      status: "recording",
    });
    expect(stopped.liveAudio).toMatchObject({
      ok: true,
      status: "stopped",
      released: true,
      session: { status: "completed" },
    });
    expect(cancelledAfterStop.liveAudio).toMatchObject({
      ok: true,
      status: "idle",
      released: false,
    });
    expect(calls).toEqual([
      ["start", started.liveAudio.session.sessionId],
      ["stop", started.liveAudio.session.sessionId],
    ]);
  });

  it("runs Director Core sidecar from the desktop command catalog and returns a console projection", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-director-plan-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    const runCliCommand = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        runCliCommand,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMMAND_RUN,
      commandId: "director.plan",
      args: {
        prompt: "生成前先走总导演：旧工厂三镜头悬疑短剧，保持同一场景连续性。",
        preferredVideoBinding: "seedance-pro",
        preferredImageBinding: "image-pro",
      },
    });

    expect(runCliCommand).not.toHaveBeenCalled();
    expect(result.directorConsole.projection).toMatchObject({
      title: "总导演计划",
      recommendation: {
        mode: { id: expect.any(String) },
        model: {
          videoBindingId: "seedance-pro",
          imageBindingId: "image-pro",
        },
      },
    });
    expect(result.directorConsole.projection.reviewGates.map((gate) => gate.id)).toEqual([
      "runtime",
      "alignment",
      "continuity",
      "binding",
      "locks",
    ]);
    expect(result.snapshot.directorConsole.projection).toEqual(result.directorConsole.projection);
    expect(result.events.at(-1)).toMatchObject({
      title: "总导演计划已生成",
      actionType: DESKTOP_ACTIONS.DIRECTOR_PLAN,
    });
  });

  it("accepts, ignores, and reruns the current Director Console plan through real desktop actions", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-director-decision-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const planned = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMMAND_RUN,
      commandId: "director.plan",
      args: {
        prompt: "生成前先走总导演：15秒旧工厂悬疑短剧，三镜头，保持人物和场景连续。",
        preferredVideoBinding: "seedance-pro",
        preferredImageBinding: "image-pro",
      },
    });
    const accepted = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMMAND_RUN,
      commandId: "director.planAccept",
      args: {
        decisionActionId: "accept_and_generate",
        note: "operator approved director plan",
      },
    });
    const ignored = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMMAND_RUN,
      commandId: "director.planIgnore",
      args: {
        note: "continue without director recommendation",
      },
    });
    const rerun = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMMAND_RUN,
      commandId: "director.planRerun",
      args: {
        prompt: "重新总导演：旧工厂悬疑短剧，强调安全模型路由。",
        preferredVideoBinding: "seedance-pro",
      },
    });

    expect(planned.directorConsole.projection.decisionActions.map((action) => action.id)).toEqual([
      "accept_and_generate",
      "accept_mode_model",
      "ignore_and_continue",
      "rerun_director",
    ]);
    expect(accepted.directorConsoleDecision).toMatchObject({
      decision: "accepted",
      decisionActionId: "accept_and_generate",
      generated: true,
      note: "operator approved director plan",
    });
    expect(accepted.productionRun).toMatchObject({
      ok: true,
      workflowType: "storyboard",
      prompt: expect.stringContaining("旧工厂悬疑短剧"),
      runId: expect.any(String),
    });
    expect(accepted.snapshot.directorConsole.projection.status).toBe("ready_for_handoff");
    expect(accepted.events.map((event) => event.title)).toContain("总导演计划已接受");
    expect(ignored.directorConsoleDecision).toMatchObject({
      decision: "ignored",
      generated: false,
    });
    expect(ignored.snapshot.directorConsole.projection).toBe(null);
    expect(rerun.directorConsoleDecision).toMatchObject({
      decision: "rerun",
      generated: false,
    });
    expect(rerun.directorConsole.projection.summary).toContain("旧工厂悬疑短剧");
    expect(rerun.snapshot.directorConsole.projection).toEqual(rerun.directorConsole.projection);
  });

  it("runs the real directory learning review and promotion path through bridge actions", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-system-"));
    tempRoots.push(workspaceRoot);
    const lessonDir = join(workspaceRoot, "fixtures", "learning-source");
    mkdirSync(lessonDir, { recursive: true });
    writeFileSync(
      join(lessonDir, "lesson.md"),
      "Compare outside examples, preserve evidence, and keep learned guidance review-gated.",
    );
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "learning.enabled": true,
      "knowledgeRecall.enabled": true,
      "memory.enabled": true,
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const learned = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_DIRECTORY,
      directory: lessonDir,
      privacy: "confidential",
    });
    const candidateId = learned.snapshot.candidate.id;
    await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_CATEGORY_CREATE,
      name: "导演镜头",
      description: "镜头语言经验。",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_TAG_CREATE,
      name: "景别",
    });
    const classified = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_CLASSIFICATION_SAVE,
      candidateId,
      categoryId: "director-shot",
      tagIds: ["shot-size"],
    });
    const recallTags = ["category:director-shot", "user-tag:shot-size"];
    const accepted = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_ACCEPT,
      candidateId,
      note: "desktop accepted",
      now: "2026-04-25T10:00:00.000Z",
    });
    const promoted = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_PROMOTE,
      candidateId,
      note: "desktop promoted",
      now: "2026-04-25T10:01:00.000Z",
    });
    const packId = promoted.snapshot.knowledge.candidateId;
    const knowledgeAccepted = await bridge.invoke({
      type: DESKTOP_ACTIONS.KNOWLEDGE_ACCEPT,
      packId,
      note: "desktop knowledge accepted",
      now: "2026-04-25T10:02:00.000Z",
    });
    const knowledgePublished = await bridge.invoke({
      type: DESKTOP_ACTIONS.KNOWLEDGE_PUBLISH,
      packId,
      note: "desktop knowledge published",
      now: "2026-04-25T10:03:00.000Z",
    });
    const recall = await bridge.invoke({
      type: DESKTOP_ACTIONS.KNOWLEDGE_RECALL_PREVIEW,
      tags: recallTags,
    });
    const inspection = await directorKnowledge.inspectDirectorExperienceCandidate(
      workspaceRoot,
      candidateId,
    );

    expect(learned.snapshot.candidate.count).toBe(1);
    expect(learned.snapshot.workspaceRoot).toBe(workspaceRoot);
    expect(learned.snapshot.candidate.status).toBe("pending");
    expect(learned.snapshot.candidate.items[0]).toMatchObject({
      id: candidateId,
      sourceKind: "local-directory",
    });
    expect(classified.snapshot.candidate.items[0]).toMatchObject({
      category: expect.objectContaining({ categoryId: "director-shot", name: "导演镜头" }),
      taxonomyTags: [expect.objectContaining({ tagId: "shot-size", name: "景别" })],
    });
    expect(accepted.snapshot.candidate.status).toBe("accepted");
    expect(promoted.snapshot.candidate.status).toBe("promoted");
    expect(promoted.snapshot.knowledge.count).toBe(1);
    expect(promoted.snapshot.candidate.items[0]).toMatchObject({
      knowledgeCandidateId: packId,
      promotion: expect.objectContaining({
        promotedTo: "director-knowledge-candidate",
        promotedRef: `knowledge://candidate/${packId}`,
      }),
    });
    expect(promoted.snapshot.knowledge.candidates[0]).toMatchObject({
      id: packId,
      status: "pending",
      groupId: "director-shot",
      tags: expect.arrayContaining(recallTags),
    });
    expect(packId).toMatch(/^director-experience-/u);
    expect(knowledgeAccepted.snapshot.knowledge.candidateId).toBe(packId);
    expect(knowledgePublished.snapshot.knowledge.publishedId).toBe(packId);
    expect(knowledgePublished.snapshot.knowledge.latestPublished).toMatchObject({
      id: packId,
      projectId: "experience-learning",
      groupId: "director-shot",
      anchorIds: expect.arrayContaining([expect.any(String)]),
      generationType: "self-learning",
      generationStyle: "local-directory",
    });
    expect(knowledgePublished.snapshot.recall.state).toBe("ready");
    expect(recall.snapshot.recall.state).toBe("hit");
    expect(recall.snapshot.recall.hits[0]).toMatchObject({
      id: packId,
    });
    expect(recall.events.at(-1)?.body).toContain(packId);
    expect(inspection.promoted).toBe(true);
    expect(inspection.latestPromotion?.promotedTo).toBe("director-knowledge-candidate");
  });

  it("routes composer cancel through live runner session cancellation when a turn-bound session exists", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-live-runner-cancel-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    const transitions = [];
    const driverCancels = [];
    const liveRunSession = {
      runId: "run-live-1",
      sessionId: "session-live-1",
      runnerId: "live-runner.memefast",
      providerId: "memefast-api",
      capabilityId: "video_generation",
      operationId: "video.create",
      status: "polling",
      createdAt: "2026-05-10T10:00:00.000Z",
      updatedAt: "2026-05-10T10:00:01.000Z",
      startedAt: "2026-05-10T10:00:01.000Z",
      cancelable: true,
      liveRunnerStarted: true,
      providerSdkLoaded: true,
      providerCredentialsUsed: true,
      networkUsed: true,
      localProcessStarted: false,
      progress: 12,
      providerTask: {
        taskId: "provider-task-1",
        status: "processing",
        metadata: { cancelUrl: "https://proxy.example.test/v1/tasks/provider-task-1/cancel" },
      },
      artifacts: [],
      metadata: { turnId: "desktop-composer-turn-live-1" },
    };
    const liveRunStore = {
      appendTransition: async (transition) => {
        transitions.push(transition);
      },
      getSession: async () => liveRunSession,
      listSessions: async (query) => {
        expect(query).toEqual({ activeOnly: true });
        return [liveRunSession];
      },
      listEvents: async () => [],
    };
    const liveRunDriverRegistry = {
      resolve: () => ({
        id: "memefast-api-live-runner",
        providerId: "memefast-api",
        capabilities: ["video_generation"],
        cancellationSupported: true,
        cancel: async (input) => {
          driverCancels.push(input);
          return {
            cancelled: true,
            providerTask: { taskId: "provider-task-1", status: "cancelled" },
            metadata: { endpoint: "https://proxy.example.test/v1/tasks/provider-task-1/cancel" },
          };
        },
      }),
    };

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        liveRunner: {
          store: liveRunStore,
          driverRegistry: liveRunDriverRegistry,
        },
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_CANCEL,
      turnId: "desktop-composer-turn-live-1",
      reason: "operator stop from button",
    });

    expect(driverCancels).toHaveLength(1);
    expect(driverCancels[0]).toMatchObject({
      cancelToken: {
        runId: "run-live-1",
        sessionId: "session-live-1",
        reason: "operator stop from button",
        revoked: true,
      },
      session: {
        sessionId: "session-live-1",
        status: "cancelling",
      },
    });
    expect(transitions.map((transition) => transition.session.status)).toEqual([
      "cancelling",
      "cancelled",
    ]);
    expect(transitions.flatMap((transition) => transition.events.map((event) => event.type))).toEqual([
      "runner.cancel.requested",
      "runner.cancelled",
    ]);
    expect(result).toMatchObject({
      cancelled: 0,
      liveRunnerCancelled: 1,
      liveRunnerDriverCancelled: 1,
      events: [
        expect.objectContaining({
          title: "已停止",
          body: expect.stringContaining("已取消 1 个 live runner session"),
        }),
      ],
    });
  });

  it("runs direct MemeFast text calls through a turn-bound live runner session", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-live-runner-text-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    const calls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          calls.push({
            url,
            method: init.method,
            signalPresent: init.signal instanceof AbortSignal,
            body: JSON.parse(String(init.body)),
          });
          return jsonResponse({
            choices: [
              {
                message: {
                  content: "MemeFast live runner 已接管普通文本发送。",
                },
              },
            ],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-live-text-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
      prompt: "普通发送走 live runner",
      providerId: "memefast-api",
      model: "gemini-2.5-flash",
      turnId: "desktop-composer-turn-lrc28-text",
    });

    expect(calls).toEqual([
      expect.objectContaining({
        url: "https://proxy.example.test/v1/chat/completions",
        method: "POST",
        signalPresent: true,
        body: expect.objectContaining({
          model: "gemini-2.5-flash",
        }),
      }),
    ]);
    expect(result.apiProviderRun).toMatchObject({
      ok: true,
      providerId: "memefast-api",
      model: "gemini-2.5-flash",
      output: "MemeFast live runner 已接管普通文本发送。",
      liveRunnerStarted: true,
      liveRunnerStatus: "completed",
      liveRunnerSessionId: expect.any(String),
    });
    expect(result.apiProviderRun.liveRunnerRunId).toContain("desktop-composer-turn-lrc28-text");
    expect(result.apiProviderRun.liveRunnerEvents.map((event) => event.type)).toEqual([
      "runner.queued",
      "runner.started",
      "artifact.created",
      "runner.completed",
    ]);
    expect(result.apiProviderRun.liveRunnerSession).toMatchObject({
      providerId: "memefast-api",
      capabilityId: "text",
      status: "completed",
      metadata: expect.objectContaining({
        turnId: "desktop-composer-turn-lrc28-text",
        source: "desktop.apiProvider.text",
      }),
    });
    expect(JSON.stringify(result)).not.toContain("sk-live-text-secret");
  });

  it("runs direct MemeFast image calls through a turn-bound live runner session", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-live-runner-image-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    const calls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          calls.push({
            url,
            method: init.method,
            signalPresent: init.signal instanceof AbortSignal,
            body: JSON.parse(String(init.body)),
          });
          return jsonResponse({
            data: [{ url: "https://cdn.example.test/director-live-runner.png" }],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-live-image-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_IMAGE,
      prompt: "生成 live runner 分镜图",
      providerId: "memefast-api",
      model: "gpt-image-2",
      size: "1536x1024",
      turnId: "desktop-composer-turn-lrc28-image",
    });

    expect(calls).toEqual([
      expect.objectContaining({
        url: "https://proxy.example.test/v1/images/generations",
        method: "POST",
        signalPresent: true,
        body: expect.objectContaining({
          model: "gpt-image-2",
          prompt: "生成 live runner 分镜图",
          n: 1,
          size: "2048x2048",
        }),
      }),
    ]);
    expect(result.apiProviderImage).toMatchObject({
      ok: true,
      providerId: "memefast-api",
      model: "gpt-image-2",
      images: [{ url: "https://cdn.example.test/director-live-runner.png" }],
      output: "https://cdn.example.test/director-live-runner.png",
      liveRunnerStarted: true,
      liveRunnerStatus: "completed",
      liveRunnerSessionId: expect.any(String),
    });
    expect(result.apiProviderImage.liveRunnerEvents.map((event) => event.type)).toEqual([
      "runner.queued",
      "runner.started",
      "artifact.created",
      "runner.completed",
    ]);
    expect(result.apiProviderImage.liveRunnerSession).toMatchObject({
      providerId: "memefast-api",
      capabilityId: "image_generation",
      status: "completed",
      metadata: expect.objectContaining({
        turnId: "desktop-composer-turn-lrc28-image",
        source: "desktop.apiProvider.image",
      }),
    });
    expect(JSON.stringify(result)).not.toContain("sk-live-image-secret");
  });

  it("runs direct MemeFast video calls through a turn-bound live runner task surface", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-live-runner-video-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    const calls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          const body =
            init.body instanceof FormData
              ? { formEntries: Array.from(init.body.entries()) }
              : init.body
                ? JSON.parse(String(init.body))
                : null;
          calls.push({
            url,
            method: init.method,
            signalPresent: init.signal instanceof AbortSignal,
            body,
          });
          if (String(url).includes("/v1/videos/video-task-1")) {
            return jsonResponse({
              status: "succeeded",
              progress: 100,
              data: { video_url: "https://cdn.example.test/director-live-runner.mp4" },
            });
          }
          return jsonResponse({
            id: "video-task-1",
            status: "queued",
            cancel_url: "/v1/tasks/video-task-1/cancel",
            progress: 12,
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-live-video-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_VIDEO,
      prompt: "生成 live runner 分镜视频",
      providerId: "memefast-api",
      model: "sora-2",
      duration: 8,
      aspectRatio: "9:16",
      turnId: "desktop-composer-turn-lrc30-video",
    });

    expect(calls).toEqual([
      expect.objectContaining({
        url: "https://proxy.example.test/v1/videos",
        method: "POST",
        signalPresent: true,
        body: {
          formEntries: expect.arrayContaining([
            ["model", "sora-2"],
            ["prompt", "生成 live runner 分镜视频"],
            ["seconds", "8"],
            ["size", "720x1280"],
          ]),
        },
      }),
      expect.objectContaining({
        url: "https://proxy.example.test/v1/videos/video-task-1",
        method: "GET",
        signalPresent: true,
        body: null,
      }),
    ]);
    expect(result.apiProviderVideo).toMatchObject({
      ok: true,
      providerId: "memefast-api",
      model: "sora-2",
      videos: [{ url: "https://cdn.example.test/director-live-runner.mp4" }],
      output: "https://cdn.example.test/director-live-runner.mp4",
      liveRunnerStarted: true,
      liveRunnerStatus: "completed",
      liveRunnerSessionId: expect.any(String),
    });
    expect(result.apiProviderVideo.liveRunnerEvents.map((event) => event.type)).toEqual([
      "runner.queued",
      "runner.started",
      "provider.task.accepted",
      "artifact.created",
      "runner.completed",
    ]);
    expect(result.apiProviderVideo.liveRunnerSession).toMatchObject({
      providerId: "memefast-api",
      capabilityId: "video_generation",
      status: "completed",
      metadata: expect.objectContaining({
        turnId: "desktop-composer-turn-lrc30-video",
        source: "desktop.apiProvider.video",
      }),
    });
    const listed = await bridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_LIST,
      activeOnly: false,
    });
    expect(listed.taskRuntime.tasks[0]).toMatchObject({
      lane: "video",
      artifactType: "video",
      provider: "memefast-api",
      model: "sora-2",
      status: "completed",
      payload: expect.objectContaining({
        turnId: "desktop-composer-turn-lrc30-video",
        providerTaskId: "video-task-1",
      }),
    });
    expect(JSON.stringify({ result, listed })).not.toContain("sk-live-video-secret");
  });

  it("aborts a running direct MemeFast text live runner session from composer cancel", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-live-runner-abort-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    const observedSignals = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (_url, init) => {
          observedSignals.push(init.signal);
          await new Promise((resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new Error("provider request aborted by live runner")),
              { once: true },
            );
          });
          throw new Error("unreachable");
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-live-abort-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const running = bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
      prompt: "这次运行需要被停止",
      providerId: "memefast-api",
      model: "gemini-2.5-flash",
      turnId: "desktop-composer-turn-lrc28-abort",
    });
    await vi.waitFor(() => {
      expect(observedSignals).toHaveLength(1);
    });

    const cancelled = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_CANCEL,
      turnId: "desktop-composer-turn-lrc28-abort",
      reason: "operator stop direct memefast live runner",
    });
    const result = await running;

    expect(observedSignals[0].aborted).toBe(true);
    expect(cancelled).toMatchObject({
      liveRunnerCancelled: 1,
      events: [
        expect.objectContaining({
          body: expect.stringContaining("已取消 1 个 live runner session"),
        }),
      ],
    });
    expect(result.apiProviderRun).toMatchObject({
      ok: false,
      providerId: "memefast-api",
      liveRunnerStarted: false,
      liveRunnerStatus: "cancelled",
    });
    expect(result.apiProviderRun.message).toContain("operator stop direct memefast live runner");
    expect(JSON.stringify(result)).not.toContain("sk-live-abort-secret");
  });

  it("exposes running MemeFast live runner sessions through a task-like desktop runtime surface", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-live-runner-task-surface-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    const observedSignals = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (_url, init) => {
          observedSignals.push(init.signal);
          await new Promise((resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new Error("provider request aborted from live runner task surface")),
              { once: true },
            );
          });
          throw new Error("unreachable");
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-live-task-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const running = bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
      prompt: "这次运行要出现在任务运行时 surface",
      providerId: "memefast-api",
      model: "gemini-2.5-flash",
      turnId: "desktop-composer-turn-lrc29-task",
    });
    await vi.waitFor(() => {
      expect(observedSignals).toHaveLength(1);
    });

    const listed = await bridge.invoke({
      type: DESKTOP_ACTIONS.LIVE_RUNNER_LIST,
      activeOnly: true,
    });
    expect(listed.liveRunner).toMatchObject({
      activeCount: 1,
      sessionCount: 1,
      latestSession: expect.objectContaining({
        status: "queued",
        turnId: "desktop-composer-turn-lrc29-task",
        cancellable: true,
      }),
    });
    expect(listed.snapshot.assets.tools.liveRunnerBus).toMatchObject({
      activeCount: 1,
      latestSession: expect.objectContaining({
        turnId: "desktop-composer-turn-lrc29-task",
      }),
    });
    const sessionId = listed.liveRunner.latestSession.sessionId;

    const read = await bridge.invoke({
      type: DESKTOP_ACTIONS.LIVE_RUNNER_READ,
      sessionId,
    });
    expect(read.liveRunnerSession).toMatchObject({
      sessionId,
      status: "queued",
      eventCount: 1,
      events: [expect.objectContaining({ type: "runner.queued" })],
    });

    const cancelled = await bridge.invoke({
      type: DESKTOP_ACTIONS.LIVE_RUNNER_CANCEL,
      sessionId,
      reason: "operator cancelled via live runner task surface",
    });
    const result = await running;

    expect(observedSignals[0].aborted).toBe(true);
    expect(cancelled.liveRunnerCancel).toMatchObject({
      cancelled: 1,
      driverCancelled: 0,
      sessionIds: [sessionId],
    });
    expect(cancelled.snapshot.assets.tools.liveRunnerBus).toMatchObject({
      activeCount: 0,
      sessionCount: 0,
      latestSession: null,
    });
    const afterCancel = await bridge.invoke({
      type: DESKTOP_ACTIONS.LIVE_RUNNER_LIST,
      activeOnly: false,
    });
    expect(afterCancel.liveRunner).toMatchObject({
      activeCount: 0,
      cancelledCount: 1,
      latestSession: expect.objectContaining({
        sessionId,
        status: "cancelled",
      }),
    });
    expect(result.apiProviderRun).toMatchObject({
      ok: false,
      providerId: "memefast-api",
      liveRunnerStatus: "cancelled",
    });
    expect(result.apiProviderRun.message).toContain(
      "operator cancelled via live runner task surface",
    );
    expect(JSON.stringify({ listed, read, cancelled, result })).not.toContain("sk-live-task-secret");
  });

  it("projects live runner sessions into a desktop task runtime surface", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-task-runtime-projection-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    const observedSignals = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (_url, init) => {
          observedSignals.push(init.signal);
          await new Promise((resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new Error("provider request aborted from task runtime")),
              { once: true },
            );
          });
          throw new Error("unreachable");
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-task-runtime-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const running = bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
      prompt: "这次运行要进入 task runtime",
      providerId: "memefast-api",
      model: "gemini-2.5-flash",
      turnId: "desktop-composer-turn-lrc30-task-runtime",
    });
    await vi.waitFor(() => {
      expect(observedSignals).toHaveLength(1);
    });

    const listed = await bridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_LIST,
      activeOnly: true,
    });
    expect(listed.taskRuntime).toMatchObject({
      schemaVersion: "director.desktop.task-runtime.v1",
      activeCount: 1,
      taskCount: 1,
      tasks: [
        expect.objectContaining({
          category: "live-runner",
          label: expect.stringContaining("MemeFast"),
          status: "running",
          lane: "text",
          provider: "memefast-api",
          model: "gemini-2.5-flash",
          cancellable: true,
          progressMode: "indeterminate",
          payload: expect.objectContaining({
            liveRunnerSessionId: expect.any(String),
            turnId: "desktop-composer-turn-lrc30-task-runtime",
          }),
        }),
      ],
    });
    expect(listed.snapshot.assets.tools.taskRuntime).toMatchObject({
      activeCount: 1,
      tasks: [expect.objectContaining({ status: "running" })],
    });
    const taskId = listed.taskRuntime.tasks[0].id;

    const read = await bridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_READ,
      taskId,
    });
    expect(read.taskRuntimeTask).toMatchObject({
      id: taskId,
      status: "running",
      payload: expect.objectContaining({
        liveRunnerSessionId: taskId,
      }),
      events: [expect.objectContaining({ type: "runner.queued" })],
    });

    const cancelled = await bridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_CANCEL,
      taskId,
      reason: "operator cancelled via task runtime",
    });
    const result = await running;

    expect(observedSignals[0].aborted).toBe(true);
    expect(cancelled.taskRuntimeCancel).toMatchObject({
      cancelled: 1,
      taskIds: [taskId],
      sessionIds: [taskId],
    });
    const afterCancel = await bridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_LIST,
      activeOnly: false,
    });
    expect(afterCancel.taskRuntime).toMatchObject({
      activeCount: 0,
      cancelledCount: 1,
      tasks: [expect.objectContaining({ id: taskId, status: "cancelled" })],
    });
    expect(result.apiProviderRun).toMatchObject({
      ok: false,
      liveRunnerStatus: "cancelled",
    });
    expect(JSON.stringify({ listed, read, cancelled, afterCancel, result })).not.toContain(
      "sk-task-runtime-secret",
    );
  });

  it("exposes task runtime through the unified client runtime protocol", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-client-runtime-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    const observedSignals = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (_url, init) => {
          observedSignals.push(init.signal);
          await new Promise((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new Error("provider request aborted from client runtime")),
              { once: true },
            );
          });
          throw new Error("unreachable");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const running = bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
      prompt: "统一 client runtime 要能控制这个任务",
      providerId: "memefast-api",
      model: "gemini-2.5-flash",
      turnId: "desktop-client-runtime-turn",
    });
    await vi.waitFor(() => {
      expect(observedSignals).toHaveLength(1);
    });

    const listed = await bridge.invoke({
      type: DESKTOP_ACTIONS.CLIENT_RUNTIME_LIST,
      activeOnly: true,
      clientSurface: "desktop",
    });
    const taskId = listed.clientRuntime.tasks[0].id;
    const read = await bridge.invoke({
      type: DESKTOP_ACTIONS.CLIENT_RUNTIME_READ,
      taskId,
      clientSurface: "desktop",
    });
    const stopped = await bridge.invoke({
      type: DESKTOP_ACTIONS.CLIENT_RUNTIME_STOP,
      taskId,
      reason: "operator stopped through unified client runtime",
      clientSurface: "desktop",
    });
    const result = await running;

    expect(listed.clientRuntime).toMatchObject({
      schemaVersion: "director.client-runtime.v1",
      clientSurface: "desktop",
      activeCount: 1,
      tasks: [
        expect.objectContaining({
          id: taskId,
          originRuntime: "desktop.taskRuntime",
          status: "running",
          cancellable: true,
          controls: expect.objectContaining({
            read: true,
            stop: true,
          }),
        }),
      ],
    });
    expect(read.clientRuntimeTask).toMatchObject({
      schemaVersion: "director.client-runtime.task.v1",
      id: taskId,
      status: "running",
      originRuntime: "desktop.taskRuntime",
      controls: expect.objectContaining({
        read: true,
        stop: true,
      }),
    });
    expect(stopped.clientRuntimeStop).toMatchObject({
      schemaVersion: "director.client-runtime.stop.v1",
      stopped: 1,
      taskIds: [taskId],
      originRuntime: "desktop.taskRuntime",
    });
    expect(stopped.taskRuntimeCancel).toMatchObject({
      cancelled: 1,
      taskIds: [taskId],
    });
    expect(observedSignals[0].aborted).toBe(true);
    expect(result.apiProviderRun).toMatchObject({
      ok: false,
      liveRunnerStatus: "cancelled",
    });
    expect(JSON.stringify({ listed, read, stopped, result })).not.toContain("sk-comfyui-secret");
  });

  it("routes desktop client runtime followup to the existing run continue handler", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-client-runtime-followup-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    const hostCalls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        hostApiUrl: "http://127.0.0.1:3201",
        hostApiFetch: async (url, init) => {
          hostCalls.push({ url, method: init?.method, body: init?.body });
          if (url.endsWith("/v1/runs/run-desktop-followup")) {
            return jsonResponse({
              runId: "run-desktop-followup",
              status: "running",
              assignments: [
                {
                  assignmentId: "assignment-script",
                  status: "pending",
                  approvalMode: "operator_approve",
                },
              ],
            });
          }
          if (url.endsWith("/v1/runs/run-desktop-followup/approve")) {
            return jsonResponse({
              runId: "run-desktop-followup",
              status: "running",
              assignments: [],
            });
          }
          if (url.endsWith("/v1/runs/run-desktop-followup/report")) {
            return jsonResponse({
              reportId: "report-desktop-followup",
              run: { runId: "run-desktop-followup", status: "running", assignments: [] },
              summary: ["run status=running"],
              flags: [],
              operatorSurface: { nextAction: "继续推进 run" },
            });
          }
          return jsonResponse({}, 404);
        },
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.CLIENT_RUNTIME_FOLLOWUP,
      taskId: "run-desktop-followup",
      reason: "desktop operator continued through unified client runtime",
      clientSurface: "desktop",
    });

    expect(result.clientRuntimeFollowup).toMatchObject({
      schemaVersion: "director.client-runtime.followup.v1",
      clientSurface: "desktop",
      originRuntime: "desktop.taskRuntime",
      accepted: true,
      continued: 1,
      taskIds: ["run-desktop-followup"],
    });
    expect(result.runControlResult).toMatchObject({
      source: "host-api",
      ok: true,
      runId: "run-desktop-followup",
      approvedAssignments: ["assignment-script"],
    });
    const runControlPaths = hostCalls
      .map((call) => new URL(call.url).pathname)
      .filter((path) => path !== "/v1/catalog");
    expect(runControlPaths).toEqual([
      "/v1/runs/run-desktop-followup",
      "/v1/runs/run-desktop-followup/approve",
      "/v1/runs/run-desktop-followup/report",
    ]);
  });

  it("projects ordinary conversation runtime turns into the desktop task runtime surface", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-conversation-task-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    const calls = [];
    const desktopEvents = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        emitDesktopEvent: (event) => {
          desktopEvents.push(event);
        },
        apiProviderFetch: async (url, init) => {
          calls.push({ url, body: JSON.parse(String(init.body)) });
          return fakeApiProviderTextResponse("普通对话任务面已接入运行中心。");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "普通对话也要进入任务运行中心",
      surface: "workbench",
    });
    const turnId = result.conversationRuntime.turnId;

    expect(calls).toHaveLength(1);
    expect(desktopEvents.filter((event) => event.type === "conversation.model.delta")).toEqual([]);
    expect(result.apiProviderRun.output).toBe("普通对话任务面已接入运行中心。");
    expect(result.snapshot.assets.tools.taskRuntime).toMatchObject({
      completedCount: 1,
      tasks: [
        expect.objectContaining({
          category: "conversation-runtime",
          status: "completed",
        }),
      ],
    });
    expect(result.taskRuntime).toMatchObject({
      completedCount: 1,
      tasks: [
        expect.objectContaining({
          category: "conversation-runtime",
          label: "普通对话 turn",
          status: "completed",
          lane: "text",
          provider: "conversation-runtime",
          model: "gemini-2.5-flash",
          routeTab: "workbench",
          cancellable: false,
          payload: expect.objectContaining({
            turnId,
            replySource: "model",
            runtimeEventCount: expect.any(Number),
          }),
        }),
      ],
    });

    const listed = await bridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_LIST,
      activeOnly: false,
      turnId,
    });
    expect(listed.taskRuntime).toMatchObject({
      taskCount: 1,
      completedCount: 1,
      tasks: [
        expect.objectContaining({
          id: `conversation:${turnId}`,
          category: "conversation-runtime",
          status: "completed",
          progress: 100,
        }),
      ],
    });

    const read = await bridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_READ,
      taskId: `conversation:${turnId}`,
    });
    expect(read.taskRuntimeTask).toMatchObject({
      id: `conversation:${turnId}`,
      category: "conversation-runtime",
      status: "completed",
      payload: expect.objectContaining({
        turnId,
        finalText: "普通对话任务面已接入运行中心。",
        finalTextPreview: "普通对话任务面已接入运行中心。",
      }),
      events: expect.arrayContaining([
        expect.objectContaining({ type: "conversation.queued" }),
        expect.objectContaining({ type: "conversation.completed" }),
      ]),
    });
    expect(JSON.stringify({ result, listed, read })).not.toContain("sk-comfyui-secret");
  });

  it("emits desktop model deltas only for real SSE text streams", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-sse-delta-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    const encoder = new TextEncoder();
    const desktopEvents = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        emitDesktopEvent: (event) => {
          desktopEvents.push(event);
        },
        apiProviderFetch: async () => ({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => "text/event-stream" },
          text: async () => "",
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'data: {"choices":[{"delta":{"content":"第一段"},"finish_reason":null}]}\n\n',
                ),
              );
              controller.enqueue(
                encoder.encode(
                  'data: {"choices":[{"delta":{"content":"第二段"},"finish_reason":"stop"}]}\n\n',
                ),
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
        }),
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "测试真实 SSE 分段",
      surface: "workbench",
    });

    expect(result.apiProviderRun.output).toBe("第一段第二段");
    expect(
      desktopEvents
        .filter((event) => event.type === "conversation.model.delta")
        .map((event) => event.body),
    ).toEqual(["第一段", "第二段"]);
  });

  it("does not emit desktop model deltas for non-SSE JSON text fallback", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-json-no-delta-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    const desktopEvents = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        emitDesktopEvent: (event) => {
          desktopEvents.push(event);
        },
        apiProviderFetch: async () => fakeApiProviderTextResponse("一次性 JSON 回包。"),
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "测试非 SSE JSON",
      surface: "workbench",
    });

    expect(result.apiProviderRun.output).toBe("一次性 JSON 回包。");
    expect(desktopEvents.filter((event) => event.type === "conversation.model.delta")).toEqual([]);
  });

  it("lets completed run registry records clear stale running conversation task rows", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-conversation-stale-store-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    let resolveProvider;

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async () => {
          await new Promise((resolve) => {
            resolveProvider = resolve;
          });
          return fakeApiProviderTextResponse("迟到的运行中心快照必须归零。");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const running = bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "模拟客户端轮询先拿到 running，随后模型完成",
      surface: "workbench",
      turnId: "desktop-stale-store-turn",
    });
    await vi.waitFor(() => {
      expect(resolveProvider).toBeTypeOf("function");
    });

    const during = await bridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_LIST,
      activeOnly: false,
      turnId: "desktop-stale-store-turn",
    });
    expect(during.taskRuntime).toMatchObject({
      activeCount: 1,
      tasks: [
        expect.objectContaining({
          id: "conversation:desktop-stale-store-turn",
          status: "running",
        }),
      ],
    });

    resolveProvider();
    await running;

    const after = await bridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_LIST,
      activeOnly: false,
      turnId: "desktop-stale-store-turn",
    });
    expect(after.taskRuntime).toMatchObject({
      activeCount: 0,
      completedCount: 1,
      tasks: [
        expect.objectContaining({
          id: "conversation:desktop-stale-store-turn",
          status: "completed",
          progress: 100,
          cancellable: false,
        }),
      ],
    });
  });

  it("marks active conversation runtime tasks as stuck when the client runtime is polled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-conversation-stuck-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    let nowMs = 0;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    let resolveProvider;

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async () => {
          await new Promise((resolve) => {
            resolveProvider = resolve;
          });
          return fakeApiProviderTextResponse("卡住检测完成后继续收口。");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const running = bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "模拟模型一直没有回包",
      surface: "workbench",
      turnId: "desktop-stuck-turn",
    });
    await vi.waitFor(() => {
      expect(resolveProvider).toBeTypeOf("function");
    });

    nowMs = 130_000;
    const read = await bridge.invoke({
      type: DESKTOP_ACTIONS.CLIENT_RUNTIME_READ,
      taskId: "conversation:desktop-stuck-turn",
    });

    expect(read.clientRuntimeTask.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "conversation.registry.runtime.stuck_warning",
          kind: "runtime.stuck_warning",
          metadata: expect.objectContaining({
            idleForMs: 130_000,
            thresholdMs: 120_000,
            status: "running",
          }),
        }),
      ]),
    );

    nowMs = 140_000;
    resolveProvider();
    await running;
  });

  it("persists desktop conversation run records across handler recreation", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-conversation-run-persist-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});

    const firstBridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async () => fakeApiProviderTextResponse("统一运行记录已持久化。"),
      }),
    });
    await configureFakeApiProvider(firstBridge);

    const result = await firstBridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "普通对话运行记录需要重启后还在",
      surface: "workbench",
      turnId: "desktop-persisted-turn",
    });

    const secondBridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async () => fakeApiProviderTextResponse("不会被调用"),
      }),
    });

    const cancelled = await secondBridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_CANCEL,
      taskId: "conversation:desktop-persisted-turn",
      reason: "operator checked persisted run registry",
    });

    expect(result.conversationRuntime.turnRunId).toBe("desktop:workbench:desktop-persisted-turn:run");
    expect(cancelled.taskRuntimeCancel).toMatchObject({
      cancelled: 1,
      conversationTurnRunIds: ["desktop:workbench:desktop-persisted-turn:run"],
    });
  });

  it("keeps desktop conversation task records isolated when sessions reuse turn ordinals", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-conversation-session-task-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async () => fakeApiProviderTextResponse("session scoped reply"),
      }),
    });
    await configureFakeApiProvider(bridge);

    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "session a first turn",
      surface: "workbench",
      sessionKey: "desktop:workbench:a",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "session b first turn",
      surface: "workbench",
      sessionKey: "desktop:workbench:b",
    });

    const listed = await bridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_LIST,
      activeOnly: false,
      turnId: "desktop-workbench-turn-1",
    });
    const conversationTasks = listed.taskRuntime.tasks.filter(
      (task) => task.category === "conversation-runtime",
    );

    expect(conversationTasks).toHaveLength(2);
    expect(new Set(conversationTasks.map((task) => task.id)).size).toBe(2);
    expect(conversationTasks.map((task) => task.payload.sessionKey).sort()).toEqual([
      "desktop:workbench:a",
      "desktop:workbench:b",
    ]);
  });

  it("does not treat persisted active conversation runs as live after handler recreation", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-conversation-stale-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    let resolveProvider;

    const firstBridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async () => {
          await new Promise((resolve) => {
            resolveProvider = resolve;
          });
          return fakeApiProviderTextResponse("不应由重启后的旧任务继续完成。");
        },
      }),
    });
    await configureFakeApiProvider(firstBridge);

    const running = firstBridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "模拟一个重启前还在运行的普通对话",
      surface: "workbench",
      turnId: "desktop-stale-turn",
    });
    await vi.waitFor(() => {
      expect(resolveProvider).toBeTypeOf("function");
    });

    const secondBridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async () => fakeApiProviderTextResponse("不会被调用"),
      }),
    });

    const activeOnly = await secondBridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_LIST,
      activeOnly: true,
    });
    const allTasks = await secondBridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_LIST,
      activeOnly: false,
      turnId: "desktop-stale-turn",
    });
    const cancelled = await secondBridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_CANCEL,
      taskId: "conversation:desktop-stale-turn",
      reason: "operator tried to stop stale restored task",
    });

    resolveProvider();
    await running;

    expect(activeOnly.taskRuntime).toMatchObject({
      activeCount: 0,
      tasks: [],
    });
    expect(allTasks.taskRuntime).toMatchObject({
      cancelledCount: 1,
      tasks: [
        expect.objectContaining({
          id: "conversation:desktop-stale-turn",
          status: "cancelled",
          cancellable: false,
          error: "stale conversation run recovered after runtime restart",
        }),
      ],
    });
    expect(cancelled.taskRuntimeCancel).toMatchObject({
      cancelled: 0,
      conversationTurnRunIds: [],
    });
  });

  it("surfaces pending runtime approvals as conversation task attention records", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-conversation-approval-task-"));
    tempRoots.push(workspaceRoot);
    writeRichSkillSnapshotFixture(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "toolApproval.autoAllowTrustedDesktop.enabled": false,
    });
    new SkillManagementStore(
      resolveSkillManagementPath({ dataDir: join(workspaceRoot, ".hotflow") }),
    ).setSkillEnabled("skill.backend-snapshot", false, {
      actor: "test",
      note: "start disabled so approval task can surface",
      nowMs: 1,
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async () =>
          jsonResponse({
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    {
                      id: "call-conversation-task-approval-1",
                      type: "function",
                      function: {
                        name: "director.skills.set_enabled",
                        arguments: JSON.stringify({
                          skillId: "skill.backend-snapshot",
                          enabled: true,
                          reason: "用户要求启用 backend snapshot Skill。",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "把 backend snapshot 这个 Skill 启用起来",
      surface: "workbench",
    });
    const turnId = result.conversationRuntime.turnId;

    expect(result.runtimeToolApproval.pendingCount).toBe(1);
    expect(result.snapshot.assets.tools.taskRuntime).toMatchObject({
      failedCount: 1,
      tasks: [
        expect.objectContaining({
          id: `conversation:${turnId}`,
          category: "conversation-runtime",
          status: "needs_attention",
          error: expect.stringContaining("等待人工批准"),
          payload: expect.objectContaining({
            approvalIds: ["tool:call-conversation-task-approval-1"],
            pendingApprovalCount: 1,
            toolCount: 1,
          }),
        }),
      ],
    });

    const read = await bridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_READ,
      taskId: `conversation:${turnId}`,
    });
    expect(read.taskRuntimeTask).toMatchObject({
      status: "needs_attention",
      events: expect.arrayContaining([
        expect.objectContaining({
          type: "conversation.approval.pending",
          message: expect.stringContaining("director.skills.set_enabled"),
        }),
      ]),
    });
  });

  it("marks conversation runtime tasks cancelled without pretending a live runner driver stopped", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-conversation-cancel-task-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async () => fakeApiProviderTextResponse("可取消任务已完成。"),
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "创建一个可被任务中心标记取消的普通对话",
      surface: "workbench",
    });
    const turnId = result.conversationRuntime.turnId;

    const cancelled = await bridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_CANCEL,
      taskId: `conversation:${turnId}`,
      reason: "operator cancelled conversation task from run center",
    });
    expect(cancelled.taskRuntimeCancel).toMatchObject({
      cancelled: 1,
      driverCancelled: 0,
      taskIds: [`conversation:${turnId}`],
      sessionIds: [],
      conversationTaskIds: [`conversation:${turnId}`],
    });

    const read = await bridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_READ,
      taskId: `conversation:${turnId}`,
    });
    expect(read.taskRuntimeTask).toMatchObject({
      status: "cancelled",
      cancellable: false,
      payload: expect.objectContaining({
        cancelReason: "operator cancelled conversation task from run center",
      }),
      events: expect.arrayContaining([
        expect.objectContaining({
          type: "conversation.cancelled",
          message: "operator cancelled conversation task from run center",
        }),
      ]),
    });
  });

  it("aborts a running conversation runtime model request from composer cancel", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-conversation-runtime-abort-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    const observedSignals = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (_url, init) => {
          observedSignals.push(init.signal);
          await new Promise((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new Error("provider request aborted by conversation runtime")),
              { once: true },
            );
          });
          throw new Error("unreachable");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const running = bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "这次普通对话需要被停止",
      surface: "workbench",
      turnId: "desktop-composer-turn-conversation-abort",
    });
    await vi.waitFor(() => {
      expect(observedSignals).toHaveLength(1);
    });

    const cancelled = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_CANCEL,
      turnId: "desktop-composer-turn-conversation-abort",
      reason: "operator stopped conversation runtime turn",
    });
    const result = await running;

    expect(observedSignals[0].aborted).toBe(true);
    expect(cancelled).toMatchObject({
      conversationTaskCancelled: 1,
      conversationTurnRunIds: ["desktop:workbench:desktop-composer-turn-conversation-abort:run"],
    });
    expect(result.conversationRuntime).toMatchObject({
      replySource: "local-command",
      turnRunId: "desktop:workbench:desktop-composer-turn-conversation-abort:run",
    });
    const read = await bridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_READ,
      taskId: "conversation:desktop-composer-turn-conversation-abort",
    });
    expect(read.taskRuntimeTask).toMatchObject({
      status: "cancelled",
      payload: expect.objectContaining({
        turnRunId: "desktop:workbench:desktop-composer-turn-conversation-abort:run",
      }),
    });
    expect(JSON.stringify({ cancelled, result, read })).not.toContain("sk-comfyui-secret");
  });

  it("cascades composer cancel to active agent.delegate subagent runs", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-subagent-cascade-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    await writeExecutionRunFixture(workspaceRoot);
    const observedSignals = [];
    const browserToolService = {
      cleanup: vi.fn(() => ({
        success: true,
        closed_session_count: 1,
        session_count: 0,
      })),
      status: vi.fn(() => ({
        success: true,
        connected: true,
        status: "connected",
        session_count: 1,
        sessions: [{ sessionKey: "desktop:workbench" }],
      })),
    };
    let providerCalls = 0;

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        browserToolService,
        apiProviderFetch: async (_url, init) => {
          observedSignals.push(init.signal);
          providerCalls += 1;
          if (providerCalls === 1) {
            return fakeApiProviderToolCallsResponse([
              {
                id: "call-agent-delegate-cascade-1",
                name: "agent.delegate",
                args: {
                  task: "核对停止级联",
                  expectedOutput: "取消状态",
                  profileId: "researcher",
                },
              },
            ]);
          }
          await new Promise((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new Error("provider request aborted by conversation runtime")),
              { once: true },
            );
          });
          throw new Error("unreachable");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const running = bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "核对父回合停止级联，然后等待停止",
      surface: "workbench",
      turnId: "desktop-composer-turn-subagent-cascade",
      runId: "run-review-1",
    });
    await vi.waitFor(async () => {
      const beforeCancel = await bridge.invoke({
        type: DESKTOP_ACTIONS.RUN_DELEGATIONS,
        runId: "run-review-1",
      });
      expect(beforeCancel.runDelegations.delegations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.stringContaining("subagent_"),
            status: "queued",
          }),
        ]),
      );
      expect(observedSignals.length).toBeGreaterThanOrEqual(2);
    });

    const cancelled = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_CANCEL,
      turnId: "desktop-composer-turn-subagent-cascade",
      reason: "operator stopped parent turn and child delegation",
    });
    await running;
    const afterCancel = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUN_DELEGATIONS,
      runId: "run-review-1",
    });

    expect(cancelled).toMatchObject({
      conversationTaskCancelled: 1,
      conversationSubagentRunIds: expect.arrayContaining([expect.stringContaining("subagent_")]),
    });
    expect(afterCancel.runDelegations.delegations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringContaining("subagent_"),
          status: "cancelled",
          error: "operator stopped parent turn and child delegation",
        }),
      ]),
    );
    expect(browserToolService.cleanup).toHaveBeenCalledWith({
      sessionKey: "desktop:workbench",
    });
  });

  it("turns accepted experience into a review-gated Skill proposal and safely applies it", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-skill-lifecycle-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "learning.enabled": true,
    });
    const lessonDir = join(workspaceRoot, "fixtures", "skill-source");
    mkdirSync(lessonDir, { recursive: true });
    writeFileSync(
      join(lessonDir, "storyboard.md"),
      "15秒短剧分镜经验：先确认剧情节拍，再按建立、推进、揭示设计镜头；输出必须能进入人工审查。",
    );

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const learned = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_DIRECTORY,
      directory: lessonDir,
      privacy: "internal",
    });
    const candidateId = learned.snapshot.candidate.id;
    await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_ACCEPT,
      candidateId,
      note: "usable director workflow",
      now: "2026-04-25T10:00:00.000Z",
    });

    const proposed = await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_PROPOSE_FROM_EXPERIENCE,
      candidateId,
      now: 1_777_300_000_000,
    });
    const proposal = proposed.snapshot.assets.skills.proposals[0];
    const experienceTitle = learned.snapshot.candidate.items[0].title;

    expect(proposal).toMatchObject({
      status: "pending",
      source: "self",
      sessionId: "director-angel-desktop",
      evidenceRef: `experience://${candidateId}`,
      title: `Skill：${experienceTitle}`,
      reviewVerdict: expect.any(String),
    });
    expect(proposed.snapshot.assets.skills.proposalCount).toBe(1);
    expect(proposed.events.at(-1)).toMatchObject({
      title: "Skill 候选已生成",
      actionType: DESKTOP_ACTIONS.SKILL_PROPOSE_FROM_EXPERIENCE,
    });

    const accepted = await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_PROPOSAL_ACCEPT,
      proposalId: proposal.id,
      note: "approved by operator",
    });
    expect(accepted.snapshot.assets.skills.proposals[0]).toMatchObject({
      id: proposal.id,
      status: "accepted",
    });

    const applied = await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_PROPOSAL_APPLY,
      proposalId: proposal.id,
    });

    expect(applied.snapshot.assets.skills.proposals[0]).toMatchObject({
      id: proposal.id,
      status: "applied",
    });
    expect(applied.snapshot.assets.skills.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: proposal.skillId,
          source: "self",
          title: proposal.title,
        }),
      ]),
    );
    expect(
      readFileSync(join(workspaceRoot, ".hotflow", "skills", "approved-skills.json"), "utf8"),
    ).toContain(proposal.skillId);

    const production = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/制作 生成一个15秒短剧分镜蓝图，要求包含景别、机位、运镜和剧情点",
      surface: "workbench",
    });

    expect(production.productionRun).toMatchObject({
      ok: true,
      skillStatus: "hit",
      skillIds: expect.arrayContaining([proposal.skillId]),
    });
    expect(production.productionRun.stageTimeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stageId: "skill-match",
          status: "hit",
          refIds: expect.arrayContaining([proposal.skillId]),
        }),
      ]),
    );
  });

  it("surfaces Skill curator actions and applies operator-gated patch, archive, and merge", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-skill-curator-"));
    tempRoots.push(workspaceRoot);
    writeSkillCuratorFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const initial = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    expect(initial.snapshot.assets.skills.curator).toMatchObject({
      actionCount: 3,
      summary: {
        patchCount: 1,
        archiveCount: 1,
        mergeCount: 1,
      },
    });
    expect(
      initial.snapshot.assets.skills.curator.actions.find(
        (action) => action.skillId === "skill.failed-curator",
      ),
    ).toMatchObject({
      explanationSurface: expect.objectContaining({
        schemaId: "skills.explanation-surface.v1",
        kind: "skill-curator",
        status: "curator-patch",
        operatorReviewRequired: true,
        curatorExplanation: expect.stringContaining("不会让模型自动改写"),
        evidenceRefs: expect.arrayContaining([
          "skill-curator://patch/skill.failed-curator",
        ]),
      }),
      nextActions: expect.arrayContaining([expect.stringContaining("人工确认")]),
    });
    expect(initial.snapshot.assets.review.pendingCount).toBeGreaterThanOrEqual(3);

    const patched = await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_CURATOR_MARK_PATCHED,
      skillId: "skill.failed-curator",
      note: "operator patched the stale downstream instruction",
      now: 1_777_301_000_000,
    });
    expect(patched.events.at(-1)).toMatchObject({
      title: "Skill 修补已确认",
      actionType: DESKTOP_ACTIONS.SKILL_CURATOR_MARK_PATCHED,
    });
    expect(
      patched.snapshot.assets.skills.curator.actions.find(
        (action) => action.skillId === "skill.failed-curator",
      ),
    ).toBeUndefined();
    expect(
      JSON.parse(
        readFileSync(resolveSkillUsagePath({ dataDir: join(workspaceRoot, ".hotflow") }), "utf8"),
      ).records["skill.failed-curator"],
    ).toMatchObject({
      failureCount: 0,
      patchCount: 1,
      lastFailedAtMs: null,
    });

    const archived = await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_CURATOR_ARCHIVE,
      skillId: "skill.stale-curator",
      note: "operator accepted curator stale archive",
      now: 1_777_301_001_000,
    });
    expect(archived.snapshot.assets.skills.items.map((item) => item.id)).not.toContain(
      "skill.stale-curator",
    );
    expect(archived.skillCuratorAction.usage).toMatchObject({
      state: "archived",
      archivedAtMs: 1_777_301_001_000,
    });

    const merged = await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_CURATOR_MERGE,
      canonicalSkillId: "skill.dup-curator-a",
      duplicateSkillIds: ["skill.dup-curator-b"],
      note: "operator merged duplicate curator skills",
      now: 1_777_301_002_000,
    });
    const skillIds = merged.snapshot.assets.skills.items.map((item) => item.id);
    expect(skillIds).toContain("skill.dup-curator-a");
    expect(skillIds).not.toContain("skill.dup-curator-b");
    expect(
      merged.snapshot.assets.skills.items.find((item) => item.id === "skill.dup-curator-a")
        ?.content,
    ).toContain("Merged duplicate skill.dup-curator-b");
    expect(merged.snapshot.assets.skills.curator).toMatchObject({
      actionCount: 0,
      summary: {
        patchCount: 0,
        archiveCount: 0,
        mergeCount: 0,
      },
    });
  });

  it("refreshes Skill curator state without throwing from the desktop action", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-skill-curator-refresh-"));
    tempRoots.push(workspaceRoot);
    writeSkillCuratorFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const refreshed = await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_CURATOR_REFRESH,
    });

    expect(refreshed.skillCurator).toMatchObject({
      actionCount: 3,
      summary: {
        patchCount: 1,
        archiveCount: 1,
        mergeCount: 1,
      },
    });
    expect(refreshed.events.at(-1)).toMatchObject({
      title: "Skill Curator 已刷新",
      actionType: DESKTOP_ACTIONS.SKILL_CURATOR_REFRESH,
      body: expect.stringContaining("3 个待处理"),
    });
  });

  it("applies a Skill curator patch through the desktop diff confirmation flow", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-skill-curator-patch-"));
    tempRoots.push(workspaceRoot);
    writeSkillCuratorFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    await expect(
      bridge.invoke({
        type: DESKTOP_ACTIONS.SKILL_CURATOR_APPLY_PATCH,
        skillId: "skill.failed-curator",
        patchEditorPayload: {
          version: "1.0.1",
          content: "Updated bounded Skill patch with explicit fallback and verification.",
          tags: ["curator", "patched"],
        },
        diffConfirmationAccepted: false,
        note: "operator reviewed diff but did not confirm",
        now: 1_777_301_003_000,
      }),
    ).rejects.toThrow("diffConfirmationAccepted=true");

    const patched = await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_CURATOR_APPLY_PATCH,
      skillId: "skill.failed-curator",
      patchEditorPayload: {
        version: "1.0.1",
        content: "Updated bounded Skill patch with explicit fallback and verification.",
        tags: ["curator", "patched"],
      },
      diffConfirmationAccepted: true,
      note: "operator accepted patch editor diff",
      now: 1_777_301_004_000,
    });

    expect(patched.events.at(-1)).toMatchObject({
      title: "Skill patch 已应用",
      actionType: DESKTOP_ACTIONS.SKILL_CURATOR_APPLY_PATCH,
    });
    expect(patched.curatorAutoApplyResult).toMatchObject({
      schemaId: "skills.curator-auto-apply.v1",
      applied: true,
      status: "applied",
      operatorScope: "skills.curator.write",
      diffConfirmationAccepted: true,
      patchEditorPayload: expect.objectContaining({
        content: "Updated bounded Skill patch with explicit fallback and verification.",
      }),
      evidenceRefs: expect.arrayContaining([
        "skill-curator://patch/skill.failed-curator",
        "skills.curator-auto-apply://patch/skill.failed-curator",
      ]),
    });
    expect(
      patched.snapshot.assets.skills.items.find((item) => item.id === "skill.failed-curator"),
    ).toMatchObject({
      version: "1.0.1",
      content: "Updated bounded Skill patch with explicit fallback and verification.",
      metadata: expect.objectContaining({
        curatorAutoAppliedAtMs: 1_777_301_004_000,
        curatorAutoAppliedBy: "director-desktop",
        curatorPatchNote: "operator accepted patch editor diff",
      }),
    });
    expect(
      JSON.parse(
        readFileSync(resolveSkillUsagePath({ dataDir: join(workspaceRoot, ".hotflow") }), "utf8"),
      ).records["skill.failed-curator"],
    ).toMatchObject({
      failureCount: 0,
      patchCount: 1,
      lastPatchedAtMs: 1_777_301_004_000,
    });
  });

  it("forwards every desktop knowledge recall filter to the backend recall query", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-recall-filters-"));
    tempRoots.push(workspaceRoot);
    let receivedRecallInput = null;
    const knowledge = {
      inspectDirectorExperienceCandidates: async () => ({
        total: 0,
        candidates: [],
        artifacts: [],
        artifactTotal: 0,
        quarantineTotal: 0,
        quarantineItems: [],
        taxonomy: {
          schemaVersion: "director.experience.taxonomy.v1",
          categories: [],
          tags: [],
          candidates: [],
        },
      }),
      inspectDirectorKnowledgeLane: async () => ({
        enabled: true,
        publishedCount: 0,
        candidateCount: 0,
        reviewQueueCount: 0,
        rollbackCount: 0,
        latestPublishedDocument: null,
      }),
      inspectDirectorKnowledgeCandidates: async () => ({
        total: 0,
        candidates: [],
      }),
      inspectDirectorKnowledgeRecall: async (_workspaceRoot, input) => {
        receivedRecallInput = input;
        return {
          enabled: true,
          packet: {
            status: "miss",
            hits: [],
          },
        };
      },
    };
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge,
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.KNOWLEDGE_RECALL_PREVIEW,
      projectId: "project-a",
      groupId: "director-shot",
      anchorId: "anchor-a",
      adapterId: "seedance-preview",
      generationType: "image",
      generationStyle: "cinematic",
      tags: ["category:director-shot", "user-tag:shot-size"],
      maxHits: 5,
      maxChars: 1200,
    });

    expect(receivedRecallInput).toEqual({
      projectId: "project-a",
      groupId: "director-shot",
      anchorIds: ["anchor-a"],
      preferredAdapters: ["seedance-preview"],
      generationType: "image",
      generationStyle: "cinematic",
      tags: ["category:director-shot", "user-tag:shot-size"],
      maxHits: 5,
      maxChars: 1200,
    });
  });

  it("routes desktop knowledge recall preview through Host API when configured", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-host-api-recall-"));
    tempRoots.push(workspaceRoot);
    const calls = [];
    const hostApiFetch = vi.fn(async (url, init = {}) => {
      const path = new URL(url).pathname;
      calls.push({
        path,
        method: init.method,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (path === "/v1/knowledge/recall-preview") {
        return jsonResponse({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.knowledge-recall-preview.v1",
          recall: {
            schemaVersion: "director.knowledge.recall.packet.v1",
            queryId: "knowledge-recall-host-api",
            status: "hit",
            recordedAt: "2026-04-30T02:00:00.000Z",
            truncated: false,
            notes: ["Matched 1 published Director knowledge pack(s)."],
            query: {
              tags: ["category:director-shot"],
              maxHits: 3,
              maxChars: 900,
            },
            hits: [
              {
                knowledgePackId: "pack-host-api-recall-1",
                title: "镜头语言知识",
                version: 1,
                score: 10,
                reasons: ["tag match: category:director-shot"],
                tags: ["category:director-shot"],
                summary: "镜头语言知识",
                method: {
                  trigger: "When planning shots.",
                  explanation: "Use clear shot sizes.",
                  roles: ["shot-planner"],
                  preferredAdapters: [],
                  anchorIds: [],
                },
                provenance: {
                  knowledgePackId: "pack-host-api-recall-1",
                  sourceProposalId: "proposal-1",
                  sourceRecordId: "record-1",
                  sourceDigestId: "digest-1",
                  publishedAt: "2026-04-30T02:00:00.000Z",
                },
              },
            ],
          },
        });
      }
      if (path === "/v1/catalog") {
        return jsonResponse(createEmptyHostApiCatalogFixture());
      }
      throw new Error(`unexpected Host API path ${path}`);
    });
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: {
          ...directorKnowledge,
          inspectDirectorKnowledgeRecall: vi.fn(async () => {
            throw new Error("local recall should not be used when Host API is configured");
          }),
        },
        hostApiUrl: "http://127.0.0.1:3201",
        hostApiFetch,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.KNOWLEDGE_RECALL_PREVIEW,
      tags: ["category:director-shot"],
    });

    expect(calls.find((call) => call.path === "/v1/knowledge/recall-preview")).toMatchObject({
      method: "POST",
      body: {
        tags: ["category:director-shot"],
      },
    });
    expect(result.snapshot.recall).toMatchObject({
      enabled: true,
      state: "hit",
      hits: [expect.objectContaining({ id: "pack-host-api-recall-1" })],
    });
    expect(result.events[0].body).toContain("pack-host-api-recall-1");
  });

  it("does not show published knowledge as recall-ready when knowledge recall is disabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-recall-disabled-"));
    tempRoots.push(workspaceRoot);
    writeKnowledgeRecallSwitchFixture(workspaceRoot, false);
    await writePublishedProductionKnowledgeFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });

    expect(result.snapshot.knowledge.publishedCount).toBe(1);
    expect(result.snapshot.recall).toMatchObject({
      enabled: false,
      state: "disabled",
      hits: [],
    });
    expect(result.snapshot.recall.copy).toContain("召回已关闭");
  });

  it("accepts a single local file as a desktop learning source", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-file-learning-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const lessonFile = join(workspaceRoot, "lesson.md");
    writeFileSync(lessonFile, "Turn user-provided local files into reviewed Angel experience.");

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const learned = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_DIRECTORY,
      directory: lessonFile,
      privacy: "confidential",
    });

    expect(learned.snapshot.candidate.count).toBe(1);
    expect(learned.snapshot.candidate.items[0]).toMatchObject({
      sourceKind: "local-directory",
      sourceRef: expect.stringContaining("lesson.md"),
    });
  });

  it("learns a URL through the injected desktop browser fetcher into stored experience", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-url-learning-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const fetchText = async (url) => ({
      url,
      contentType: "text/plain; charset=utf-8",
      structuredContent: {
        schemaVersion: "director.source.snapshot.v1",
        kind: "browser-capture",
        blocks: [
          {
            kind: "text",
            text: "Authenticated Feishu wiki lesson: preserve browser login state while learning external references.",
          },
        ],
        tables: [],
        media: [
          {
            kind: "image",
            src: "https://example.test/feishu.png",
            alt: "Feishu source image",
          },
        ],
      },
      body: "Authenticated Feishu wiki lesson: preserve browser login state while learning external references.",
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        experienceFetchText: fetchText,
      }),
    });

    const learned = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
      url: "https://bcn5ot9wwnew.feishu.cn/wiki/KttewP2WqiWF0Bk8P68cAjTUnFh?from=from_copylink",
      privacy: "public",
    });
    const inspection = await directorKnowledge.inspectDirectorExperienceCandidates(workspaceRoot);
    const candidate = inspection.candidates[0]?.candidate;

    expect(learned.snapshot.candidate.count).toBe(1);
    expect(learned.events.at(-1)?.body).toContain("看完了。核心是：");
    expect(learned.events.at(-1)?.body).toContain("整理出 1 条待确认经验候选");
    expect(learned.events.at(-1)?.body).toContain("要收录吗？");
    expect(learned.events.at(-1)?.body).not.toContain("Desktop learning result:");
    expect(learned.events.at(-1)?.body).not.toContain("已生成 1 条经验候选");
    expect(candidate).toMatchObject({
      sourceAdapter: expect.objectContaining({
        sourceKind: "web-page",
      }),
      privacy: "public",
      runtimeInjection: "disabled",
    });
    expect(candidate?.summary).toContain("Authenticated Feishu wiki lesson");
    expect(candidate?.evidence[0]?.sourceRef).toContain("bcn5ot9wwnew.feishu.cn/wiki");
    expect(learned.snapshot.candidate.items[0]?.sourceDocument.structuredContent).toMatchObject({
      schemaVersion: "director.source.snapshot.v1",
      kind: "url-learning-read",
    });
  });

  it("learns an X URL through OpenCLI before any Electron/browser-window fallback", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-url-opencli-x-learning-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const xUrl = "https://x.com/Adam38363368936/status/2056318384317620663";
    writeOpenCliManifestFixture(workspaceRoot, [
      {
        site: "twitter",
        name: "thread",
        description: "Get a tweet thread.",
        access: "read",
        browser: true,
        domain: "x.com",
        args: [{ name: "tweet-id", type: "string", required: true, positional: true }],
      },
    ]);
    const runnerCalls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openCliRunner: async (input) => {
          runnerCalls.push(input.args);
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify([
              {
                id: "2056318384317620663",
                author: "Adam",
                text: "Direct OpenCLI X thread learning should create a real pending experience candidate.",
                url: xUrl,
                media_urls: [],
              },
            ]),
            stderr: "",
          };
        },
      }),
    });

    const learned = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
      url: xUrl,
      privacy: "public",
    });
    const inspection = await directorKnowledge.inspectDirectorExperienceCandidates(workspaceRoot);
    const candidate = inspection.candidates[0]?.candidate;

    expect(runnerCalls).toEqual(
      expect.arrayContaining([["twitter", "thread", xUrl, "--format", "json"]]),
    );
    expect(learned.urlRead.source.via).toBe("opencli");
    expect(learned.snapshot.candidate.count).toBe(1);
    expect(learned.events.at(-1)?.body).toContain("看完了。核心是：");
    expect(learned.events.at(-1)?.body).toContain("学到的要点：");
    expect(learned.events.at(-1)?.body).toContain("Direct OpenCLI X thread learning");
    expect(learned.events.at(-1)?.body).toContain("要收录吗？");
    expect(candidate?.summary).toContain("Direct OpenCLI X thread learning");
    expect(candidate?.evidence[0]?.sourceRef).toBe(xUrl);
  });

  it("renders full first-pass URL learning takeaways before asking to save", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-url-full-learning-view-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const xUrl = "https://x.com/liyue_ai/status/2056947629548843481";
    writeOpenCliManifestFixture(workspaceRoot, [
      {
        site: "twitter",
        name: "thread",
        description: "Get a tweet thread.",
        access: "read",
        browser: true,
        domain: "x.com",
        args: [{ name: "tweet-id", type: "string", required: true, positional: true }],
      },
    ]);
    const sourceText = [
      "99%的人都写错了，GPT Image 2 生成美女，千万别直接写“性感”。",
      "场景过于私密 高风险写法：直接写性感、床上、挑逗姿势、暧昧互动、过度暴露和私密暗示。安全稳定写法：可以有卧室，但不要让卧室变成暧昧场景，要写成居家写真、柔和晨光、自然姿态、精致服装、克制镜头和明确审美语境；GPT Image 2 不是不能生成性感好看的图片，而是不适合用低俗直白的词去生成，提示词整体要求提倡信雅达；红黄绿提示词：红色禁用低俗词，黄色谨慎处理私密场景，绿色改成高级、优雅、电影感、服装、光线和构图。",
    ].join("\n");

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openCliRunner: async (input) => {
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify([
              {
                id: "2056947629548843481",
                author: "liyue_ai",
                text: sourceText,
                url: xUrl,
                media_urls: [],
              },
            ]),
            stderr: "",
          };
        },
      }),
    });

    const learned = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
      url: xUrl,
      privacy: "public",
    });
    const body = learned.events.at(-1)?.body ?? "";

    expect(body).toContain("学到的要点：");
    expect(body).toContain("红黄绿提示词：红色禁用低俗词");
    expect(body).toContain("要收录吗？");
    expect(body).not.toContain("红黄绿提...");
    expect(body).not.toContain("\n2. ；");
    expect(body).not.toContain("\n3. ；");
  });

  it("stores count-only OpenCLI X media as authorization-ready learning evidence", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-url-opencli-x-count-media-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const xUrl = "https://x.com/TanLuAI/status/2056949172629381407";
    writeOpenCliManifestFixture(workspaceRoot, [
      {
        site: "twitter",
        name: "thread",
        description: "Get a tweet thread.",
        access: "read",
        browser: true,
        domain: "x.com",
        args: [{ name: "tweet-id", type: "string", required: true, positional: true }],
      },
    ]);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openCliRunner: async (input) => {
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify([
              {
                id: "2056949172629381407",
                author: "TanLuAI",
                text: "GPT 做资产图和人设图很方便；这条正文提到结合前序视频截图和剧情设定生成一张资产详情图片。",
                url: xUrl,
                media_urls: [],
                media: [{ kind: "image" }, { kind: "video" }],
              },
            ]),
            stderr: "",
          };
        },
      }),
    });

    const learned = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
      url: xUrl,
      privacy: "public",
    });

    expect(learned.events.at(-1)?.body).toContain("媒体授权");
    expect(learned.evidenceDisclosure.sources[0]).toMatchObject({
      mediaCount: 2,
      mediaInventory: expect.objectContaining({
        assetCount: 2,
        imageCount: 1,
        videoCount: 1,
      }),
      mediaUnderstandingStatus: "not_understood_without_user_authorization",
    });

    const learningArtifacts = JSON.parse(
      readFileSync(
        join(workspaceRoot, ".hotflow", "conversation-runtime", "learning-artifacts.json"),
        "utf8",
      ),
    );
    expect(learningArtifacts.artifacts[0].mediaEvidenceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceRef: `${xUrl}#media-image-1`,
          status: "listed_only",
          realVisualUnderstanding: false,
          metadata: expect.objectContaining({
            origin: "desktop.media_inventory.count_only",
            locatorUnavailable: true,
          }),
        }),
        expect.objectContaining({
          sourceRef: `${xUrl}#media-video-1`,
          status: "listed_only",
          realVisualUnderstanding: false,
          metadata: expect.objectContaining({
            origin: "desktop.media_inventory.count_only",
            locatorUnavailable: true,
          }),
        }),
      ]),
    );

    const inventoryOnly = await bridge.invoke({
      type: DESKTOP_ACTIONS.LEARNING_MEDIA_UNDERSTAND,
      sourceRef: xUrl,
      mode: "media_inventory",
      tokenBudget: 0,
      maxAssets: 2,
    });

    expect(inventoryOnly.mediaUnderstanding).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        status: "media_inventory_recorded",
        remainingUnunderstoodMediaCount: 2,
      }),
    });
    expect(inventoryOnly.commandResult.stdout).not.toContain("not_found");
    expect(inventoryOnly.commandResult.stdout).toContain("文本已读；媒体未理解");
  });

  it("prefers OpenCLI X article content over reply-thread chatter for article-backed posts", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-url-opencli-x-article-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const xUrl = "https://x.com/Adam38363368936/status/2056318384317620663";
    const articleText =
      "这半年我密集做了几百上千个 AI 图像和视频作品。新手学 AIGC 不要只看教程不动手。" +
      "真正有效的路径是先跑通全流程，再学习 Prompt 工程，再理解参数和进阶工作流。";
    writeOpenCliManifestFixture(workspaceRoot, [
      {
        site: "twitter",
        name: "article",
        description: "Fetch a Twitter Article (long-form content) and export as Markdown.",
        access: "read",
        browser: true,
        domain: "x.com",
        args: [{ name: "tweet-id", type: "string", required: true, positional: true }],
      },
      {
        site: "twitter",
        name: "thread",
        description: "Get a tweet thread.",
        access: "read",
        browser: true,
        domain: "x.com",
        args: [{ name: "tweet-id", type: "string", required: true, positional: true }],
      },
    ]);
    const runnerCalls = [];
    const learnDirectorExperience = vi.fn(async () => ({
      result: { candidateCount: 1, quarantineCount: 0 },
      candidates: [{ candidateId: "exp-x-article", title: "X Article AIGC 学习路径" }],
    }));

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({ learnDirectorExperience }),
        openCliRunner: async (input) => {
          runnerCalls.push(input.args);
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          if (input.args[0] === "twitter" && input.args[1] === "article") {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                {
                  author: "Adam38363368936",
                  title: "做了上千个 AI 图像视频之后，我发现 90% 的新手都在犯同一个错误",
                  content: articleText,
                  url: xUrl,
                },
              ]),
              stderr: "",
            };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify([
              {
                id: "2056318384317620663",
                author: "Adam38363368936",
                text: "https://t.co/nPLM4Ri9DQ",
                url: xUrl,
              },
              {
                id: "2056548405745492073",
                author: "ddny09",
                text: "说句扎心的：大部分人的问题根本不是不知道怎么学。",
                in_reply_to: "2056318384317620663",
                url: "https://x.com/ddny09/status/2056548405745492073",
              },
            ]),
            stderr: "",
          };
        },
      }),
    });

    const learned = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
      url: xUrl,
      privacy: "public",
    });

    expect(runnerCalls).toEqual(
      expect.arrayContaining([["twitter", "article", xUrl, "--format", "json"]]),
    );
    expect(runnerCalls).not.toEqual(
      expect.arrayContaining([["twitter", "thread", xUrl, "--format", "json"]]),
    );
    expect(learnDirectorExperience).toHaveBeenCalledWith(
      workspaceRoot,
      expect.objectContaining({
        urls: [xUrl],
        fetchText: expect.any(Function),
      }),
    );
    const fetchText = learnDirectorExperience.mock.calls[0]?.[1]?.fetchText;
    const fetched = await fetchText();
    expect(fetched.body).toContain("这半年我密集做了几百上千个 AI 图像和视频作品");
    expect(fetched.body).not.toContain("说句扎心的");
    expect(learned.urlRead.source.title).toContain("做了上千个 AI 图像视频");
    expect(learned.urlRead.source.structuredContent.kind).toBe("opencli-twitter-article");
  });

  it("blocks X URL learning instead of admitting reply-thread chatter when article text is unavailable", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-url-opencli-x-link-only-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const xUrl = "https://x.com/Adam38363368936/status/2056318384317620663";
    writeOpenCliManifestFixture(workspaceRoot, [
      {
        site: "twitter",
        name: "thread",
        description: "Get a tweet thread.",
        access: "read",
        browser: true,
        domain: "x.com",
        args: [{ name: "tweet-id", type: "string", required: true, positional: true }],
      },
    ]);
    const learnDirectorExperience = vi.fn(async () => {
      throw new Error("reply-thread chatter must not be admitted as article source");
    });
    const browserCalls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({ learnDirectorExperience }),
        experienceFetchText: async (url) => ({
          ok: false,
          status: 403,
          statusText: "Forbidden",
          url,
          headers: { get: () => "text/html; charset=utf-8" },
          body: "Forbidden",
        }),
        browserToolService: {
          navigate: async (input) => {
            browserCalls.push({ name: "browser_navigate", input });
            return {
              success: false,
              url: input.url,
              title: "Browser fallback must not run for OpenCLI link-only X learning",
              error: "browser fallback should be disabled after OpenCLI link-only X read",
            };
          },
          snapshot: async (input) => {
            browserCalls.push({ name: "browser_snapshot", input });
            return {
              success: false,
              url: xUrl,
              title: "Browser fallback must not run for OpenCLI link-only X learning",
              error: "browser fallback should be disabled after OpenCLI link-only X read",
            };
          },
        },
        openCliRunner: async (input) => {
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify([
              {
                id: "2056318384317620663",
                author: "Adam38363368936",
                text: "https://t.co/nPLM4Ri9DQ",
                url: xUrl,
              },
              {
                id: "2056548405745492073",
                author: "ddny09",
                text: "说句扎心的：大部分人的问题根本不是不知道怎么学。",
                in_reply_to: "2056318384317620663",
                url: "https://x.com/ddny09/status/2056548405745492073",
              },
            ]),
            stderr: "",
          };
        },
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
      url: xUrl,
      privacy: "public",
    });

    expect(learnDirectorExperience).not.toHaveBeenCalled();
    expect(browserCalls).toEqual([]);
    expect(result.result.status).toBe("degraded");
    expect(result.result.candidateCount).toBe(0);
    expect(result.evidenceDisclosure.sources[0]).toMatchObject({
      url: xUrl,
      persisted: false,
      admitted: false,
      readStatus: "failed",
    });
    expect(result.evidenceDisclosure.sources[0].failedReason).toContain("主帖只有外链");
  });

  it("blocks X URL learning instead of falling back to browser windows when OpenCLI X commands are unavailable", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-url-opencli-x-missing-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const xUrl = "https://x.com/Adam38363368936/status/2056318384317620663";
    writeOpenCliManifestFixture(workspaceRoot, [
      {
        site: "hackernews",
        name: "top",
        description: "Read Hacker News top stories.",
        access: "read",
        args: [{ name: "limit", type: "int", required: false }],
      },
    ]);
    const learnDirectorExperience = vi.fn(async () => {
      throw new Error("X reads without OpenCLI X commands must not be admitted");
    });
    const browserCalls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({ learnDirectorExperience }),
        browserToolService: {
          navigate: async (input) => {
            browserCalls.push({ name: "browser_navigate", input });
            return {
              success: false,
              url: input.url,
              title: "Browser fallback must not run for missing OpenCLI X commands",
              error: "browser fallback should be disabled for X learning",
            };
          },
          snapshot: async (input) => {
            browserCalls.push({ name: "browser_snapshot", input });
            return {
              success: false,
              url: xUrl,
              title: "Browser fallback must not run for missing OpenCLI X commands",
              error: "browser fallback should be disabled for X learning",
            };
          },
        },
        openCliRunner: async (input) => {
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          throw new Error("OpenCLI non-X command should not be invoked for X learning");
        },
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
      url: xUrl,
      privacy: "public",
    });

    expect(learnDirectorExperience).not.toHaveBeenCalled();
    expect(browserCalls).toEqual([]);
    expect(result.result).toMatchObject({
      status: "degraded",
      candidateCount: 0,
    });
    expect(result.evidenceDisclosure.sources[0]).toMatchObject({
      url: xUrl,
      persisted: false,
      admitted: false,
      readStatus: "failed",
    });
    expect(result.evidenceDisclosure.sources[0].failedReason).toContain(
      "当前 OpenCLI 没有这个命令",
    );
  });

  it("surfaces media authorization clearly after desktop URL learning discovers media assets", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-url-media-auth-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const fetchText = async (url) => ({
      url,
      contentType: "text/plain; charset=utf-8",
      structuredContent: {
        schemaVersion: "director.source.snapshot.v1",
        kind: "browser-capture",
        blocks: [
          {
            kind: "text",
            text: "六宫格故事板比九宫格更适合把短视频流程跑通。",
          },
          {
            kind: "media",
            media: {
              kind: "image",
              src: "https://pbs.twimg.com/media/storyboard.jpg",
              alt: "storyboard image",
            },
          },
          {
            kind: "media",
            media: {
              kind: "video",
              src: "blob:https://x.com/video-1",
              poster: "https://pbs.twimg.com/amplify_video_thumb/poster.jpg",
              width: 1080,
              height: 1440,
            },
          },
        ],
        tables: [],
        media: [
          {
            kind: "image",
            src: "https://pbs.twimg.com/profile_images/avatar.jpg",
            alt: "avatar",
          },
          {
            kind: "image",
            src: "https://pbs.twimg.com/media/storyboard.jpg",
            alt: "storyboard image",
          },
          {
            kind: "video",
            src: "blob:https://x.com/video-1",
            poster: "https://pbs.twimg.com/amplify_video_thumb/poster.jpg",
            width: 1080,
            height: 1440,
          },
        ],
      },
      body: [
        "六宫格故事板比九宫格更适合把短视频流程跑通。",
        "[Video: 嵌入式视频](blob:https://x.com/video-1) 1080x1440 poster=https://pbs.twimg.com/amplify_video_thumb/poster.jpg",
      ].join("\n"),
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        experienceFetchText: fetchText,
      }),
    });

    const learned = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
      url: "https://example.test/ponyodong/storyboard",
      privacy: "public",
    });
    const body = learned.events.at(-1)?.body ?? "";

    expect(body).toContain("媒体授权");
    expect(body).toContain("发现 2 个正文相关媒体资源");
    expect(body).toContain("图片 1");
    expect(body).toContain("视频 1");
    expect(body).toContain("另有 1 个页面附属媒体未计入正文媒体");
    expect(body).toContain("当前只学习了正文文字和可审计摘要");
    expect(body).toContain("未授权前不把媒体内容当成已学经验入库");
    expect(body).toContain("可用要点：");
    expect(body).not.toContain("blob:https://x.com/video-1");
    expect(body).not.toContain("poster=https://pbs.twimg.com");
    expect(learned.evidenceDisclosure.sources[0]).toMatchObject({
      mediaCount: 2,
      mediaInventory: expect.objectContaining({
        assetCount: 2,
        imageCount: 1,
        videoCount: 1,
        audioCount: 0,
      }),
      mediaAdmission: expect.objectContaining({
        canAdmitTextEvidence: true,
        canAdmitMediaContent: false,
        requiredNextAction: "request_user_authorization",
        budget: expect.objectContaining({
          fileCountLimit: 2,
          estimatedCostTier: "medium",
        }),
      }),
      mediaUnderstandingStatus: "not_understood_without_user_authorization",
    });

    const learningArtifacts = JSON.parse(
      readFileSync(
        join(workspaceRoot, ".hotflow", "conversation-runtime", "learning-artifacts.json"),
        "utf8",
      ),
    );
    expect(learningArtifacts.artifacts[0].mediaEvidenceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceRef: "https://pbs.twimg.com/media/storyboard.jpg",
          status: "listed_only",
          realVisualUnderstanding: false,
        }),
        expect.objectContaining({
          sourceRef: "blob:https://x.com/video-1",
          status: "listed_only",
          realVisualUnderstanding: false,
        }),
      ]),
    );

    const inventoryOnly = await bridge.invoke({
      type: DESKTOP_ACTIONS.LEARNING_MEDIA_UNDERSTAND,
      sourceRef: "https://example.test/ponyodong/storyboard",
      mode: "media_inventory",
      tokenBudget: 0,
      maxAssets: 2,
    });
    expect(inventoryOnly.mediaUnderstanding).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        status: "media_inventory_recorded",
        remainingUnunderstoodMediaCount: expect.any(Number),
      }),
    });
    expect(inventoryOnly.mediaUnderstanding.output.remainingUnunderstoodMediaCount).toBeGreaterThanOrEqual(2);
  });

  it("blocks desktop URL learning when the captured page is mostly an access shell", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-url-login-shell-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const fetchText = async (url) => ({
      url,
      contentType: "text/plain; charset=utf-8",
      structuredContent: {
        schemaVersion: "director.source.snapshot.v1",
        kind: "browser-capture",
        blocks: [
          { kind: "text", text: "X 的新用户？立即注册。使用 Google 账号注册。使用 Apple 注册。" },
          {
            kind: "media",
            media: {
              kind: "image",
              src: "https://pbs.twimg.com/profile_images/avatar.jpg",
              alt: "avatar",
            },
          },
        ],
        media: [
          {
            kind: "image",
            src: "https://pbs.twimg.com/profile_images/avatar.jpg",
            alt: "avatar",
          },
        ],
      },
      body: [
        "X 的新用户？立即注册，获取你自己的个性化时间线！",
        "使用 Google 账号注册",
        "使用 Apple 注册",
        "创建账号",
        "服务条款 Cookie 政策 相关用户",
      ].join("\n"),
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        experienceFetchText: fetchText,
      }),
    });

    const learned = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
      url: "https://example.test/access-shell",
      privacy: "public",
    });
    const body = learned.events.at(-1)?.body ?? "";
    const inspection = await directorKnowledge.inspectDirectorExperienceCandidates(workspaceRoot);

    expect(body).toContain("这次还没有学到可信正文");
    expect(body).toContain("抓取内容主要是 X 登录/注册或侧栏信息");
    expect(body).toContain("媒体授权");
    expect(body).toContain("未授权前不把媒体内容当成已学经验入库");
    expect(inspection.candidates).toHaveLength(0);
    expect(learned.snapshot.candidate.count).toBe(0);
    expect(body).not.toContain("已整理出 1 条待确认经验候选");
  });

  it("blocks desktop URL learning when a captured page mixes article hints with access-shell noise", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-url-mixed-x-shell-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const fetchText = async (url) => ({
      url,
      contentType: "text/plain; charset=utf-8",
      structuredContent: {
        schemaVersion: "director.source.snapshot.v1",
        kind: "browser-capture",
        blocks: [
          {
            kind: "text",
            text: "使用 Google 账号注册。X 上的 波妞PONYO。六宫格故事板。Seedance。",
          },
          {
            kind: "media",
            media: {
              kind: "image",
              src: "https://pbs.twimg.com/media/storyboard.jpg",
              alt: "storyboard",
            },
          },
        ],
        media: [
          {
            kind: "image",
            src: "https://pbs.twimg.com/media/storyboard.jpg",
            alt: "storyboard",
          },
        ],
      },
      body: [
        "使用 Google 账号注册",
        "X 上的 波妞PONYO：“https://t.co/6RGDAs0ueU”",
        "六宫格故事板 Seedance 镜头 运镜",
        "X 的新用户？立即注册。相关用户。服务条款 Cookie 政策。",
      ].join("\n"),
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        experienceFetchText: fetchText,
      }),
    });

    const learned = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
      url: "https://example.test/mixed-access-shell",
      privacy: "public",
    });
    const body = learned.events.at(-1)?.body ?? "";
    const inspection = await directorKnowledge.inspectDirectorExperienceCandidates(workspaceRoot);

    expect(body).toContain("这次还没有学到可信正文");
    expect(body).toContain("正文可用，但夹杂 X 登录/注册、侧栏或回复区噪声");
    expect(body).toContain("媒体授权");
    expect(inspection.candidates).toHaveLength(0);
    expect(learned.snapshot.candidate.count).toBe(0);
  });

  it("quarantines low-quality desktop URL learning instead of claiming a learned candidate", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-url-quality-gate-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const fetchText = async (url) => ({
      url,
      contentType: "text/html",
      body: [
        "<html><head><title>微信公众平台</title></head><body>",
        "环境异常 当前环境异常，完成验证后即可继续访问。",
        "视频 小程序 赞 ，轻点两下取消赞 在看 ，轻点两下取消在看",
        "</body></html>",
      ].join(""),
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        experienceFetchText: fetchText,
      }),
    });

    const learned = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
      url: "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
      privacy: "public",
    });
    const inspection = await directorKnowledge.inspectDirectorExperienceCandidates(workspaceRoot);

    expect(inspection.candidates).toHaveLength(0);
    expect(learned.snapshot.candidate.count).toBe(0);
    expect(learned.events.at(-1)?.body).toContain("这次还没有学到可信正文");
    expect(learned.events.at(-1)?.body).toContain("访问受限");
    expect(learned.events.at(-1)?.body).not.toContain("已整理出 1 条待确认经验候选");
    expect(learned.events.at(-1)?.body).not.toContain("已生成 1 条经验候选");
  });

  it("uses the configured API model when desktop URL learning creates experience", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-model-learning-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const calls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        experienceFetchText: async (url) => ({
          url,
          contentType: "text/html; charset=utf-8",
          body: [
            "<html><title>导演镜头资料</title><body>",
            "<p>Raw opener should stay only as source evidence.</p>",
            "<p>推荐流程：先确认短剧画面目标，再选择景别、角度、构图和光影，并保留审核证据。</p>",
            "</body></html>",
          ].join(""),
        }),
        apiProviderFetch: async (url, init) => {
          calls.push({
            url,
            method: init.method,
            authorization: init.headers.Authorization,
            body: JSON.parse(String(init.body)),
          });
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        summary:
                          "模型提炼：学习短剧资料时先确认画面目标，再选择镜头语言并保留证据。",
                        applicability: "用于从网页资料沉淀可审核的导演经验候选。",
                        risks: ["模型提炼仍需人工审核后才能晋升知识。"],
                        tags: ["model-distilled", "shot-language"],
                        evidenceSummary: "来源要求先确认画面目标，再选择景别、角度、构图和光影。",
                        confidence: "high",
                        selectedClaims: ["先确认短剧画面目标，再选择景别、角度、构图和光影。"],
                      }),
                    },
                  },
                ],
              }),
          };
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-first-secret\nsk-second-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const learned = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "把这个链接沉淀成经验 https://example.test/director-shot-language",
      surface: "workbench",
    });
    const candidate = learned.snapshot.candidate.items[0];

    expect(calls).toEqual([
      {
        url: "https://proxy.example.test/v1/chat/completions",
        method: "POST",
        authorization: "Bearer sk-first-secret",
        body: expect.objectContaining({
          model: "gemini-2.5-flash",
        }),
      },
    ]);
    expect(candidate).toMatchObject({
      summary: expect.stringContaining("模型提炼"),
      distillation: expect.objectContaining({
        mode: "model",
        label: expect.stringContaining("API 模型提炼"),
      }),
      tags: expect.arrayContaining(["distillation:model", "distiller:api_provider_memefast_api"]),
    });
    expect(candidate.summary).not.toContain("Raw opener");
    expect(candidate.evidencePreview).toContain("Raw opener");
    expect(learned.events.at(-1)?.body).toContain("模型提炼：已启用");
    expect(JSON.stringify(learned)).not.toContain("sk-first-secret");
    expect(JSON.stringify(learned)).not.toContain("sk-second-secret");
  });

  it("skips model distillation during learning when the cost budget is exhausted", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-learning-budget-blocked-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const calls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        experienceFetchText: async (url) => ({
          url,
          contentType: "text/plain; charset=utf-8",
          body: [
            "预算阻断时仍应学习网页内容，但只能走规则提炼，不能调用模型。",
            "推荐流程：先确认短剧画面目标，再选择景别、角度、构图和光影，并保留审核证据。",
            "适用场景：从网页资料沉淀导演经验候选时，先保留来源证据，再进入人工审核。",
          ].join("\n"),
        }),
        apiProviderFetch: async () => {
          calls.push("model-call");
          throw new Error("budget guard should skip learning model distillation");
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-learning-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.COST_BUDGET_SET,
      limitUsd: 1,
      spentUsd: 1,
      blocked: true,
      now: "2026-04-28T08:12:00.000Z",
    });

    const learned = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
      url: "https://example.test/budget-learning",
      privacy: "public",
    });

    expect(calls).toHaveLength(0);
    expect(learned.snapshot.candidate.count).toBe(1);
    expect(learned.events.map((event) => event.title)).toContain("模型提炼已被成本预算跳过");
    expect(learned.events.at(-1)?.body).toContain("模型提炼：未启用");
    expect(learned.snapshot.candidate.items[0]?.tags).not.toContain("distillation:model");
  });

  it("routes URL-like learning queries through URL learning at the system boundary", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-query-url-learning-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const search = async () => {
      throw new Error("search should not be called for URL-like learning text");
    };

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: {
          ...directorKnowledge,
          learnDirectorExperience: (root, input) =>
            directorKnowledge.learnDirectorExperience(root, {
              ...input,
              search,
              fetchText: async (url) => ({
                url,
                contentType: "text/plain; charset=utf-8",
                body: "URL-like desktop query learned from the real page, not search results.",
              }),
            }),
        },
      }),
    });

    const learned = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_QUERY,
      query: "去学习这个https://bcn5ot9wwnew.feishu.cn/wiki/doc",
      privacy: "public",
    });
    const inspection = await directorKnowledge.inspectDirectorExperienceCandidates(workspaceRoot);

    expect(learned.snapshot.candidate.count).toBe(1);
    expect(inspection.candidates[0]?.candidate.sourceAdapter.sourceKind).toBe("web-page");
    expect(inspection.candidates[0]?.candidate.summary).toContain("URL-like desktop query");
  });

  it("routes pasted text learning through the desktop system boundary", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-pasted-learning-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const learnDirectorExperience = vi.fn(async () =>
      [
        "Director experience learn:",
        "  status: ok",
        "  new candidates: 1",
        "  stored candidates: 1",
        "  model distillation: disabled",
        "  - pasted_text_ai_short_drama kind=pasted-text candidates=1 stored=1",
      ].join("\n"),
    );

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({ learnDirectorExperience }),
      }),
    });

    const learned = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_TEXT,
      text: "AI短剧基础知识\n推荐流程：先确认画面目的，再选择景别。",
      title: "AI短剧基础知识",
      privacy: "internal",
    });

    expect(learnDirectorExperience).toHaveBeenCalledWith(
      workspaceRoot,
      expect.objectContaining({
        texts: [
          expect.objectContaining({
            title: "AI短剧基础知识",
            content: expect.stringContaining("先确认画面目的"),
          }),
        ],
        privacy: "internal",
      }),
    );
    expect(learned.events.at(-1)).toMatchObject({
      title: "文本学习",
      actionType: DESKTOP_ACTIONS.EXPERIENCE_LEARN_TEXT,
    });
    expect(learned.events.at(-1)?.body).toContain("这次学习我整理好了");
    expect(learned.events.at(-1)?.body).toContain("已整理出 1 条待确认经验候选");
    expect(learned.events.at(-1)?.body).not.toContain("Desktop learning result:");
    expect(learned.events.at(-1)?.body).not.toContain("已生成 1 条经验候选");
  });

  it("keeps casual pasted text out of the desktop learning boundary", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-pasted-learning-noise-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const learnDirectorExperience = vi.fn();

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({ learnDirectorExperience }),
      }),
    });

    const ignored = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_TEXT,
      text: "我今天学习制作咖啡，挺开心",
      title: "随口记录",
      privacy: "internal",
    });

    expect(learnDirectorExperience).not.toHaveBeenCalled();
    expect(ignored.events.at(-1)).toMatchObject({
      title: "学习入口已忽略",
      actionType: DESKTOP_ACTIONS.EXPERIENCE_LEARN_TEXT,
    });
    expect(ignored.events.at(-1)?.body).toContain("没有进入经验候选");
  });

  it("saves edited extracted experience through the desktop system boundary", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-edit-experience-"));
    tempRoots.push(workspaceRoot);
    const updateDirectorExperienceCandidateStructured = vi.fn(async () => ({
      updated: {
        candidateId: "experience-1",
        title: "镜头经验",
        summary: "经验提炼：先按剧情节拍选择景别。",
      },
      write: {
        status: "ok",
        notes: ["Stored experience candidate experience-1."],
      },
    }));

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          updateDirectorExperienceCandidateStructured,
        }),
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_UPDATE,
      candidateId: "experience-1",
      summary: "经验提炼：先按剧情节拍选择景别。",
      applicability: "短剧分镜前使用。",
      risks: "不要机械套用\n保留剧情目的",
      tags: ["manual-edit", "director-shot"],
    });

    expect(updateDirectorExperienceCandidateStructured).toHaveBeenCalledWith(
      workspaceRoot,
      expect.objectContaining({
        candidateId: "experience-1",
        summary: "经验提炼：先按剧情节拍选择景别。",
        applicability: "短剧分镜前使用。",
        risks: ["不要机械套用", "保留剧情目的"],
        tags: ["manual-edit", "director-shot"],
      }),
    );
    expect(result.events.at(-1)).toMatchObject({
      title: "经验提炼已更新",
      actionType: DESKTOP_ACTIONS.EXPERIENCE_UPDATE,
    });
  });

  it("routes desktop experience edits through Host API when configured", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-host-api-edit-experience-"));
    tempRoots.push(workspaceRoot);
    const calls = [];
    const updateDirectorExperienceCandidateStructured = vi.fn();
    const hostApiFetch = vi.fn(async (url, init = {}) => {
      const path = new URL(url).pathname;
      calls.push({
        path,
        method: init.method,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (path === "/v1/experience/candidates/experience-1") {
        return jsonResponse({
          schemaId: "director.host.experience-candidate-update.v1",
          updated: {
            candidateId: "experience-1",
            title: "镜头经验",
            summary: "经验提炼：先按剧情节拍选择景别。",
          },
          write: { status: "ok" },
        });
      }
      if (path === "/v1/catalog") {
        return jsonResponse(createEmptyHostApiCatalogFixture());
      }
      throw new Error(`unexpected Host API path ${path}`);
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          updateDirectorExperienceCandidateStructured,
        }),
        hostApiUrl: "http://127.0.0.1:3201",
        hostApiFetch,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_UPDATE,
      candidateId: "experience-1",
      summary: "经验提炼：先按剧情节拍选择景别。",
      applicability: "短剧分镜前使用。",
      risks: "不要机械套用\n保留剧情目的",
      tags: ["manual-edit", "director-shot"],
    });

    expect(updateDirectorExperienceCandidateStructured).not.toHaveBeenCalled();
    const writeCalls = withoutCatalogCalls(calls);
    expect(writeCalls.map((call) => `${call.method}:${call.path}`)).toEqual([
      "PATCH:/v1/experience/candidates/experience-1",
    ]);
    expect(writeCalls[0].body).toMatchObject({
      summary: "经验提炼：先按剧情节拍选择景别。",
      applicability: "短剧分镜前使用。",
      risks: ["不要机械套用", "保留剧情目的"],
      tags: ["manual-edit", "director-shot"],
      author: "director-desktop",
    });
    expect(result.events.at(-1)).toMatchObject({
      title: "经验提炼已更新",
      actionType: DESKTOP_ACTIONS.EXPERIENCE_UPDATE,
    });
  });

  it("includes sidebar asset summaries in the desktop snapshot", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-assets-"));
    tempRoots.push(workspaceRoot);
    writeSkillSnapshotFixture(workspaceRoot);
    writeAdapterRegistryFixture(workspaceRoot);
    writeRuntimeSwitchFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });

    expect(result.snapshot.assets.skills).toMatchObject({
      total: 2,
      selfCount: 1,
      externalCount: 1,
    });
    expect(result.snapshot.assets.tools).toMatchObject({
      registeredCount: 1,
      enabledCount: 0,
      externalCliCount: 1,
      runtimeStatus: "degraded",
    });
    expect(result.snapshot.assets.tools.items[0]).toMatchObject({
      id: "external-cli",
      enabled: false,
      dryRunSupported: true,
      mockOnly: false,
      bridgeCapable: true,
      realExecutionEligible: false,
      supportedActionClasses: ["write"],
      riskLevel: "high",
      approvalMode: "operator_approve",
      auditSummary: expect.stringContaining("bridge=http-json"),
      actionCount: 1,
      highRiskActionCount: 1,
      operatorApprovalActionCount: 1,
    });
    expect(result.snapshot.assets.tools.items[0]?.actions).toEqual([
      expect.objectContaining({
        actionClass: "write",
        label: "写入",
        sideEffect: true,
        riskLevel: "high",
        approvalMode: "operator_approve",
        executionMode: "dry-run-required",
        inputs: ["执行目标", "待写入或修改的资产", "人工审批记录"],
        outputs: ["变更摘要", "产物或文件引用", "审计事件"],
        costClass: "external-unknown",
        retryPolicy: "manual-review-required",
        timeoutMs: 5000,
        auditTrailRequired: true,
        summary: expect.stringContaining("写入"),
        reason: expect.stringContaining("外部桥接"),
      }),
    ]);
    const externalToolBus = result.snapshot.assets.tools.externalToolBus;
    const externalToolItem = (id) => externalToolBus.items.find((item) => item.id === id);
    expect(externalToolBus.catalogCount).toEqual(expect.any(Number));
    expect(externalToolBus.agentOsExtensionMatrix).toMatchObject({
      summary: {
        total: 8,
        ready: expect.any(Number),
        needsAuth: expect.any(Number),
        needsSetup: expect.any(Number),
        disabled: expect.any(Number),
        problem: expect.any(Number),
      },
      entries: expect.arrayContaining([
        expect.objectContaining({
          id: "browser.desktop",
          toolId: "browser.desktop",
          providerId: "browser",
          health: expect.objectContaining({ status: "disabled" }),
          sandbox: expect.objectContaining({
            defaultMode: "network-limited",
            networkPolicy: "limited",
          }),
        }),
        expect.objectContaining({
          id: "media-understanding.local",
          toolId: "media-understanding.local",
          providerId: "media-understanding",
          health: expect.objectContaining({ status: "ready" }),
          sandbox: expect.objectContaining({
            defaultMode: "readonly",
            networkPolicy: "none",
          }),
        }),
        expect.objectContaining({
          id: "memefast.api",
          toolId: "memefast.api",
          providerId: "memefast-api",
          health: expect.objectContaining({ status: "needs-auth" }),
          sandbox: expect.objectContaining({
            defaultMode: "network-limited",
            networkPolicy: "limited",
          }),
        }),
      ]),
      byCapability: expect.objectContaining({
        "model.chat": expect.arrayContaining([
          expect.objectContaining({ id: "memefast.api" }),
        ]),
        "media.understand_image": expect.arrayContaining([
          expect.objectContaining({ id: "media-understanding.local" }),
        ]),
        "browser.navigate": expect.arrayContaining([
          expect.objectContaining({ id: "browser.desktop" }),
        ]),
        "browser.scroll": expect.arrayContaining([
          expect.objectContaining({ id: "browser.desktop" }),
        ]),
        "browser.back": expect.arrayContaining([
          expect.objectContaining({ id: "browser.desktop" }),
        ]),
        "browser.press": expect.arrayContaining([
          expect.objectContaining({ id: "browser.desktop" }),
        ]),
        "browser.images": expect.arrayContaining([
          expect.objectContaining({ id: "browser.desktop" }),
        ]),
        "browser.console": expect.arrayContaining([
          expect.objectContaining({ id: "browser.desktop" }),
        ]),
      }),
    });
    expect(externalToolBus.providerMatrix).toMatchObject({
      schemaVersion: "director.desktop.external-tool-provider-matrix.v1",
      providers: expect.arrayContaining([
        expect.objectContaining({
          providerId: "web",
          status: "ready",
          capabilities: expect.arrayContaining([expect.objectContaining({ id: "web.search" })]),
        }),
        expect.objectContaining({
          providerId: "browser",
          status: expect.stringMatching(/disabled|unreachable/u),
          approvalBoundary: expect.objectContaining({ mode: expect.any(String) }),
        }),
      ]),
    });
    expect(externalToolItem("media-understanding.local")).toMatchObject({
      id: "media-understanding.local",
      source: "built-in",
      kind: "provider",
      providerId: "media-understanding",
      status: "ready",
      canInvoke: true,
      metadata: expect.objectContaining({
        agentOsExtensionId: "media-understanding.local",
        agentOsExtensionMatrixEntry: expect.objectContaining({
          id: "media-understanding.local",
        }),
      }),
    });
    expect(externalToolItem("web")).toMatchObject({
      id: "web",
      source: "built-in",
      kind: "provider",
      providerId: "web",
      status: "ready",
      canInvoke: true,
      capabilities: expect.arrayContaining([
        expect.objectContaining({ id: "web.search", readOnly: true }),
        expect.objectContaining({ id: "web.extract", readOnly: true }),
      ]),
      installPolicy: expect.objectContaining({
        supported: false,
        defaultMode: "none",
      }),
      doctor: expect.objectContaining({
        summary: expect.stringContaining("web_search"),
      }),
      lastKnownGood: expect.objectContaining({
        status: "ready",
        summary: expect.stringContaining("web_search"),
        checkedAtMs: expect.any(Number),
        generation: expect.any(Number),
      }),
    });
    expect(externalToolItem("browser")).toMatchObject({
      id: "browser",
      source: "built-in",
      kind: "provider",
      providerId: "browser",
      status: "disabled",
      canInvoke: false,
      capabilities: expect.arrayContaining([
        expect.objectContaining({ id: "navigate", readOnly: false }),
        expect.objectContaining({ id: "snapshot", readOnly: true }),
      ]),
      metadata: expect.objectContaining({
        boundary: "shared-browser-provider",
        connected: false,
      }),
      doctor: expect.objectContaining({
        summary: expect.stringContaining("disabled"),
      }),
    });
    const openCliLocal = externalToolItem("opencli.local");
    expect(openCliLocal).toMatchObject({
      id: "opencli.local",
      source: "external",
      kind: "provider",
      providerId: "opencli",
      canInvoke: false,
      installPolicy: expect.objectContaining({
        supported: true,
        defaultMode: "manual",
        refuses: expect.arrayContaining(["shell-passthrough", "silent-install"]),
      }),
      capabilities: expect.arrayContaining([
        expect.objectContaining({ id: "opencli.doctor", readOnly: true }),
        expect.objectContaining({ id: "opencli.list", readOnly: true }),
      ]),
      metadata: expect.objectContaining({
        desktopExternalTool: true,
        hostApiSurface: "/v1/tools/*",
      }),
    });
    expect(["missing", "misconfigured"]).toContain(openCliLocal.status);
    expect(openCliLocal.doctor).toEqual(
      expect.objectContaining({
        nextActions: expect.arrayContaining([
          expect.stringMatching(/npm install -g @jackwener\/opencli|OPENCLI_MANIFEST_PATH|cli-manifest\.json/u),
        ]),
      }),
    );
    expect(externalToolItem("web_search")).toMatchObject({
      id: "web_search",
      source: "built-in",
      kind: "model-tool",
      providerId: "web",
      status: "ready",
      canInvoke: true,
    });
    expect(externalToolItem("browser_navigate")).toMatchObject({
      id: "browser_navigate",
      source: "built-in",
      kind: "model-tool",
      providerId: "browser",
      status: "unreachable",
      canInvoke: false,
    });
    expect(externalToolItem("browser_console")).toMatchObject({
      id: "browser_console",
      source: "built-in",
      kind: "model-tool",
      providerId: "browser",
      capabilities: expect.arrayContaining([
        expect.objectContaining({ id: "browser.console", readOnly: true }),
      ]),
    });
    expect(externalToolItem("comfyui")).toMatchObject({
      id: "comfyui",
      source: "external",
      kind: "provider",
      status: "disabled",
      canInvoke: false,
      sourceTrust: expect.objectContaining({
        status: "trusted-local-config",
      }),
      installPolicy: expect.objectContaining({
        supported: true,
        defaultMode: "plan",
        requiresExplicitExecute: true,
        allowedMethods: expect.arrayContaining(["comfy-cli", "uvx"]),
      }),
      approvalBoundary: expect.objectContaining({
        mode: "operator-confirm",
        actionLabels: ["确认", "拒绝"],
      }),
    });
    expect(result.snapshot.assets.review.agentOsReleaseGate).toMatchObject({
      schemaVersion: "director.desktop.agent-os-release-gate.v1",
      suiteId: "director-agent-os-all-gate",
      reportPath: expect.stringContaining("director-agent-os-all-gate-latest.json"),
      skippedChecks: expect.arrayContaining([
        expect.objectContaining({
          id: "real-desktop-device-release-smoke",
          skipReason: "missing-local-service",
        }),
        expect.objectContaining({
          id: "live-user-memory-dataset-sweep",
          skipReason: "unsafe-environment",
        }),
      ]),
    });
    expect(result.snapshot.assets.review.agentOsReleaseSmokeReadiness).toMatchObject({
      schemaVersion: "director.desktop.agent-os-release-smoke-readiness.v1",
      status: "blocked",
      summary: {
        planCount: 5,
        blockedCount: 5,
        readyCount: 0,
        requiresOperatorActionCount: 5,
        canExecuteLiveCheckCount: 0,
        liveRunnerEnabledCount: 0,
      },
      plans: expect.arrayContaining([
        expect.objectContaining({
          id: "real-desktop-device-release-smoke",
          status: "blocked",
          requirements: expect.arrayContaining(["operator-started-desktop"]),
          canExecuteLiveCheck: false,
          liveRunnerEnabled: false,
        }),
        expect.objectContaining({
          id: "live-browser-authenticated-smoke",
          status: "blocked",
          requirements: expect.arrayContaining(["browser-auth-profile"]),
          canExecuteLiveCheck: false,
          liveRunnerEnabled: false,
        }),
        expect.objectContaining({
          id: "live-user-memory-dataset-sweep",
          status: "blocked",
          requirements: expect.arrayContaining(["operator-approval"]),
          inheritedBlockedReasons: expect.arrayContaining(["operator-approval-required"]),
          canExecuteLiveCheck: false,
          liveRunnerEnabled: false,
        }),
      ]),
    });
    expect(result.snapshot.assets.review.agentOsReleaseSmokeAdmission).toMatchObject({
      schemaVersion: "director.desktop.agent-os-release-smoke-admission.v1",
      status: "blocked",
      summary: {
        verdictCount: 5,
        blockedCount: 5,
        admittedCount: 0,
        runnerIntentCreatedCount: 0,
        executionTokenIssuedCount: 0,
      },
      verdicts: expect.arrayContaining([
        expect.objectContaining({
          id: "real-desktop-device-release-smoke",
          admitted: false,
          missingSignals: expect.arrayContaining(["operator-scope", "environment-isolation"]),
          runnerIntentCreated: false,
          executionTokenIssued: false,
        }),
        expect.objectContaining({
          id: "live-browser-authenticated-smoke",
          admitted: false,
          missingSignals: expect.arrayContaining(["auth-context"]),
          runnerIntentCreated: false,
          executionTokenIssued: false,
        }),
        expect.objectContaining({
          id: "live-user-memory-dataset-sweep",
          admitted: false,
          missingSignals: expect.arrayContaining(["operator-scope", "data-policy"]),
          runnerIntentCreated: false,
          executionTokenIssued: false,
        }),
      ]),
    });
    expect(result.snapshot.assets.review.agentOsReleaseSmokeExecutionPreflight).toMatchObject({
      schemaVersion: "director.desktop.agent-os-release-smoke-execution-preflight.v1",
      status: "blocked",
      summary: {
        packetCount: 5,
        blockedCount: 5,
        readyToExecuteCount: 0,
        executionIntentCreatedCount: 0,
        liveRunnerStartedCount: 0,
      },
      packets: expect.arrayContaining([
        expect.objectContaining({
          id: "real-desktop-device-release-smoke",
          executionBlockedReason: "admission-blocked",
          requiredEvidence: expect.arrayContaining([
            "operator-scope-evidence",
            "environment-isolation-evidence",
            "audit-artifact",
          ]),
          executionIntentCreated: false,
          liveRunnerStarted: false,
          canStartLiveRunner: false,
        }),
        expect.objectContaining({
          id: "live-external-provider-account-smoke",
          executionBlockedReason: "admission-blocked",
          requiredEvidence: expect.arrayContaining([
            "provider-credential-evidence",
            "network-policy-evidence",
          ]),
          executionIntentCreated: false,
          liveRunnerStarted: false,
          canStartLiveRunner: false,
        }),
        expect.objectContaining({
          id: "live-user-memory-dataset-sweep",
          executionBlockedReason: "admission-blocked",
          requiredEvidence: expect.arrayContaining([
            "data-policy-evidence",
            "retention-policy-evidence",
          ]),
          executionIntentCreated: false,
          liveRunnerStarted: false,
          canStartLiveRunner: false,
        }),
      ]),
    });
    expect(result.snapshot.assets.review.agentOsReleaseSmokeEvidenceIntake).toMatchObject({
      schemaVersion: "director.desktop.agent-os-release-smoke-evidence-intake.v1",
      status: "blocked",
      summary: {
        packetCount: 5,
        blockedCount: 5,
        acceptedEvidenceCount: 0,
        runnerIntentUnlockedCount: 0,
        remoteIntakeAllowedCount: 0,
      },
      packets: expect.arrayContaining([
        expect.objectContaining({
          id: "real-desktop-device-release-smoke",
          evidenceIntakeMode: "local-operator-file",
          evidenceManifestPath: null,
          acceptedEvidenceCount: 0,
          remoteIntakeAllowed: false,
          canReadUserData: false,
          runnerIntentUnlocked: false,
          missingEvidence: expect.arrayContaining([
            "operator-scope-evidence",
            "environment-isolation-evidence",
            "audit-artifact",
          ]),
        }),
        expect.objectContaining({
          id: "live-user-memory-dataset-sweep",
          evidenceIntakeMode: "local-operator-file",
          acceptedEvidenceCount: 0,
          remoteIntakeAllowed: false,
          runnerIntentUnlocked: false,
          missingEvidence: expect.arrayContaining([
            "data-policy-evidence",
            "retention-policy-evidence",
          ]),
        }),
      ]),
    });
    expect(result.snapshot.assets.review.agentOsReleaseSmokeEvidenceManifestPreflight).toMatchObject({
      schemaVersion: "director.desktop.agent-os-release-smoke-evidence-manifest-preflight.v1",
      status: "blocked",
      summary: {
        packetCount: 5,
        blockedCount: 5,
        manifestSchemaValidCount: 0,
        manifestContentReadCount: 0,
        runnerIntentUnlockedCount: 0,
      },
      packets: expect.arrayContaining([
        expect.objectContaining({
          id: "real-desktop-device-release-smoke",
          manifestSchemaVersion: "director.agent-os.release-smoke-evidence-manifest.v1",
          evidenceManifestPath: null,
          manifestPathStatus: "missing",
          manifestSchemaValid: false,
          manifestContentRead: false,
          remoteManifestAllowed: false,
          runnerIntentUnlocked: false,
          requiredManifestFields: expect.arrayContaining([
            "schemaVersion",
            "checkId",
            "operator",
            "createdAt",
            "evidence",
            "operatorScope",
            "environmentIsolation",
            "auditArtifact",
          ]),
        }),
        expect.objectContaining({
          id: "live-user-memory-dataset-sweep",
          manifestSchemaValid: false,
          manifestContentRead: false,
          requiredManifestFields: expect.arrayContaining([
            "dataPolicy",
            "anonymization",
            "retentionPolicy",
          ]),
          missingManifestFields: expect.arrayContaining([
            "dataPolicy",
            "retentionPolicy",
          ]),
        }),
      ]),
    });
    expect(result.snapshot.assets.review.agentOsReleaseSmokeEvidenceManifestValidation).toMatchObject({
      schemaVersion: "director.desktop.agent-os-release-smoke-evidence-manifest-validation.v1",
      status: "blocked",
      summary: {
        packetCount: 5,
        blockedCount: 5,
        manifestValidatedCount: 0,
        manifestReadAllowedCount: 0,
        manifestContentReadCount: 0,
        auditArtifactReadyCount: 0,
        runnerIntentUnlockedCount: 0,
      },
      packets: expect.arrayContaining([
        expect.objectContaining({
          schemaVersion: "director.agent-os.release-smoke-evidence-manifest-validation-packet.v1",
          id: "real-desktop-device-release-smoke",
          manifestValidationMode: "schema-only-local-file",
          manifestValidationStatus: "blocked",
          manifestSchemaValid: false,
          manifestValidated: false,
          manifestReadAllowed: false,
          manifestContentRead: false,
          remoteManifestAllowed: false,
          auditArtifactReady: false,
          runnerIntentUnlocked: false,
          validationIssues: expect.arrayContaining([
            "manifest-path-missing",
            "manifest-read-not-allowed",
            "manifest-schema-not-validated",
            "audit-artifact-not-ready",
          ]),
        }),
        expect.objectContaining({
          id: "live-user-memory-dataset-sweep",
          manifestValidated: false,
          manifestReadAllowed: false,
          auditArtifactReady: false,
          requiredManifestFields: expect.arrayContaining([
            "dataPolicy",
            "anonymization",
            "retentionPolicy",
          ]),
        }),
      ]),
    });
    expect(result.snapshot.assets.review.agentOsReleaseSmokeEvidenceManifestPathAuthorization).toMatchObject({
      schemaVersion:
        "director.desktop.agent-os-release-smoke-evidence-manifest-path-authorization.v1",
      status: "blocked",
      summary: {
        packetCount: 5,
        blockedCount: 5,
        manifestPathAuthorizedCount: 0,
        manifestPathReadAllowedCount: 0,
        manifestDirectoryAllowedCount: 0,
        remotePathRejectedCount: 5,
        runnerIntentUnlockedCount: 0,
      },
      packets: expect.arrayContaining([
        expect.objectContaining({
          schemaVersion:
            "director.agent-os.release-smoke-evidence-manifest-path-authorization-packet.v1",
          id: "real-desktop-device-release-smoke",
          manifestPathAuthorizationMode: "operator-owned-local-path",
          manifestPathAuthorizationStatus: "blocked",
          manifestPathAuthorized: false,
          manifestPathReadAllowed: false,
          manifestDirectoryAllowed: false,
          pathTraversalBlocked: true,
          remotePathRejected: true,
          manifestContentRead: false,
          auditArtifactReady: false,
          runnerIntentUnlocked: false,
          pathAuthorizationIssues: expect.arrayContaining([
            "operator-owned-path-missing",
            "manifest-directory-not-allowlisted",
            "manifest-read-not-authorized",
            "remote-path-rejected",
          ]),
        }),
        expect.objectContaining({
          id: "live-user-memory-dataset-sweep",
          tierId: "real-data",
          manifestPathAuthorized: false,
          manifestPathReadAllowed: false,
          remotePathRejected: true,
          runnerIntentUnlocked: false,
        }),
      ]),
    });
    expect(
      result.snapshot.assets.review.agentOsReleaseSmokeEvidenceManifestSchemaValidatorReadiness,
    ).toMatchObject({
      schemaVersion:
        "director.desktop.agent-os-release-smoke-evidence-manifest-schema-validator-readiness.v1",
      status: "blocked",
      summary: {
        packetCount: 5,
        blockedCount: 5,
        schemaValidatorReadyCount: 0,
        schemaDefinitionLoadedCount: 0,
        manifestReadAllowedCount: 0,
        manifestContentReadCount: 0,
        auditArtifactReadyCount: 0,
        runnerIntentUnlockedCount: 0,
      },
      packets: expect.arrayContaining([
        expect.objectContaining({
          schemaVersion:
            "director.agent-os.release-smoke-evidence-manifest-schema-validator-readiness-packet.v1",
          id: "real-desktop-device-release-smoke",
          schemaValidatorMode: "local-schema-contract",
          schemaValidatorStatus: "blocked",
          schemaValidatorReady: false,
          schemaDefinitionVersion: "director.agent-os.release-smoke-evidence-manifest.v1",
          schemaDefinitionLoaded: false,
          manifestReadAllowed: false,
          manifestContentRead: false,
          auditArtifactReady: false,
          runnerIntentUnlocked: false,
          schemaValidatorIssues: expect.arrayContaining([
            "manifest-path-not-authorized",
            "schema-definition-not-bound",
            "manifest-read-not-authorized",
            "audit-artifact-not-ready",
          ]),
        }),
        expect.objectContaining({
          id: "live-user-memory-dataset-sweep",
          tierId: "real-data",
          pathAuthorizationStatus: "blocked",
          schemaValidatorReady: false,
          schemaDefinitionLoaded: false,
          manifestReadAllowed: false,
          runnerIntentUnlocked: false,
        }),
      ]),
    });
    expect(
      result.snapshot.assets.review
        .agentOsReleaseSmokeEvidenceManifestSchemaDefinitionBinding,
    ).toMatchObject({
      schemaVersion:
        "director.desktop.agent-os-release-smoke-evidence-manifest-schema-definition-binding.v1",
      status: "blocked",
      summary: {
        packetCount: 5,
        blockedCount: 5,
        schemaDefinitionBoundCount: 0,
        schemaDefinitionBindingReadyCount: 0,
        manifestReadAllowedCount: 0,
        manifestContentReadCount: 0,
        auditArtifactReadyCount: 0,
        runnerIntentUnlockedCount: 0,
      },
      packets: expect.arrayContaining([
        expect.objectContaining({
          schemaVersion:
            "director.agent-os.release-smoke-evidence-manifest-schema-definition-binding-packet.v1",
          id: "real-desktop-device-release-smoke",
          schemaDefinitionBindingMode: "embedded-schema-definition-ref",
          schemaDefinitionBindingStatus: "blocked",
          schemaDefinitionBound: false,
          schemaDefinitionBindingReady: false,
          schemaDefinitionReference: "director.agent-os.release-smoke-evidence-manifest.v1",
          schemaDefinitionLoaded: false,
          schemaLoaderReady: false,
          schemaValidatorReady: false,
          manifestReadAllowed: false,
          manifestContentRead: false,
          auditArtifactReady: false,
          runnerIntentUnlocked: false,
          schemaDefinitionBindingIssues: expect.arrayContaining([
            "schema-definition-not-bound",
            "schema-loader-not-ready",
            "validator-not-ready",
            "manifest-read-not-authorized",
            "audit-artifact-not-ready",
          ]),
        }),
        expect.objectContaining({
          id: "live-user-memory-dataset-sweep",
          tierId: "real-data",
          schemaDefinitionBound: false,
          schemaDefinitionBindingReady: false,
          schemaLoaderReady: false,
          manifestReadAllowed: false,
          runnerIntentUnlocked: false,
          schemaValidatorStatus: "blocked",
        }),
      ]),
    });
    expect(
      result.snapshot.assets.review.agentOsReleaseSmokeEvidenceManifestReadAuthorization,
    ).toMatchObject({
      schemaVersion:
        "director.desktop.agent-os-release-smoke-evidence-manifest-read-authorization.v1",
      status: "blocked",
      summary: {
        packetCount: 5,
        blockedCount: 5,
        manifestReadAuthorizedCount: 0,
        manifestReadAuthorizationReadyCount: 0,
        manifestReadAllowedCount: 0,
        manifestContentReadCount: 0,
        auditArtifactReadyCount: 0,
        runnerIntentUnlockedCount: 0,
      },
      packets: expect.arrayContaining([
        expect.objectContaining({
          schemaVersion:
            "director.agent-os.release-smoke-evidence-manifest-read-authorization-packet.v1",
          id: "real-desktop-device-release-smoke",
          manifestReadAuthorizationMode: "local-manifest-read-authorization",
          manifestReadAuthorizationStatus: "blocked",
          manifestReadAuthorized: false,
          manifestReadAuthorizationReady: false,
          operatorReadScopeGranted: false,
          schemaDefinitionBindingReady: false,
          manifestPathAuthorized: false,
          manifestReadAllowed: false,
          manifestContentRead: false,
          auditArtifactReady: false,
          runnerIntentUnlocked: false,
          manifestReadAuthorizationIssues: expect.arrayContaining([
            "operator-read-scope-missing",
            "manifest-path-not-authorized",
            "schema-definition-binding-not-ready",
            "audit-artifact-not-ready",
          ]),
        }),
        expect.objectContaining({
          id: "live-user-memory-dataset-sweep",
          tierId: "real-data",
          schemaDefinitionBindingStatus: "blocked",
          manifestReadAuthorized: false,
          manifestReadAuthorizationReady: false,
          operatorReadScopeGranted: false,
          manifestContentRead: false,
          runnerIntentUnlocked: false,
        }),
      ]),
    });
    expect(
      result.snapshot.assets.review.agentOsReleaseSmokeEvidenceManifestAuditArtifactReadiness,
    ).toMatchObject({
      schemaVersion:
        "director.desktop.agent-os-release-smoke-evidence-manifest-audit-artifact-readiness.v1",
      status: "blocked",
      summary: {
        packetCount: 5,
        blockedCount: 5,
        auditArtifactReadyCount: 0,
        auditArtifactReadinessReadyCount: 0,
        auditArtifactWriteAuthorizedCount: 0,
        manifestReadAuthorizationReadyCount: 0,
        manifestReadAllowedCount: 0,
        manifestContentReadCount: 0,
        runnerIntentUnlockedCount: 0,
      },
      packets: expect.arrayContaining([
        expect.objectContaining({
          schemaVersion:
            "director.agent-os.release-smoke-evidence-manifest-audit-artifact-readiness-packet.v1",
          id: "real-desktop-device-release-smoke",
          auditArtifactReadinessMode: "local-audit-artifact-contract",
          auditArtifactReadinessStatus: "blocked",
          auditArtifactReady: false,
          auditArtifactReadinessReady: false,
          auditArtifactPath: null,
          auditArtifactWriteAuthorized: false,
          manifestReadAuthorizationReady: false,
          manifestReadAllowed: false,
          manifestContentRead: false,
          runnerIntentUnlocked: false,
          auditArtifactReadinessIssues: expect.arrayContaining([
            "audit-artifact-path-missing",
            "audit-artifact-write-not-authorized",
            "manifest-read-authorization-not-ready",
            "manifest-content-not-read",
            "runner-intent-locked",
          ]),
        }),
        expect.objectContaining({
          id: "live-user-memory-dataset-sweep",
          tierId: "real-data",
          manifestReadAuthorizationStatus: "blocked",
          auditArtifactReady: false,
          auditArtifactReadinessReady: false,
          auditArtifactWriteAuthorized: false,
          manifestContentRead: false,
          runnerIntentUnlocked: false,
        }),
      ]),
    });
    expect(result.snapshot.assets.review.agentOsReleaseSmokeRunnerIntentSigningRevocation).toMatchObject({
      schemaVersion: "director.desktop.agent-os-release-smoke-runner-intent-signing-revocation.v1",
      status: "blocked",
      summary: {
        packetCount: 5,
        blockedCount: 5,
        runnerIntentSignedCount: 0,
        runnerIntentSignatureReadyCount: 0,
        runnerIntentTokenIssuedCount: 0,
        runnerIntentUnlockedCount: 0,
        runnerIntentRevokedCount: 5,
        auditArtifactReadinessReadyCount: 0,
        manifestContentReadCount: 0,
      },
      packets: expect.arrayContaining([
        expect.objectContaining({
          schemaVersion:
            "director.agent-os.release-smoke-runner-intent-signing-revocation-packet.v1",
          id: "real-desktop-device-release-smoke",
          runnerIntentContractMode: "fail-closed-runner-intent-signing-revocation",
          runnerIntentSigningStatus: "blocked",
          runnerIntentRevocationStatus: "revoked",
          runnerIntentSigned: false,
          runnerIntentSignatureReady: false,
          runnerIntentTokenIssued: false,
          runnerIntentSignature: null,
          runnerIntentSigningKeyRef: null,
          runnerIntentRevocationRecordPath: null,
          runnerIntentUnlocked: false,
          auditArtifactReadinessReady: false,
          auditArtifactReady: false,
          manifestContentRead: false,
          runnerIntentSigningRevocationIssues: expect.arrayContaining([
            "runner-intent-signing-key-missing",
            "runner-intent-signature-not-issued",
            "runner-intent-revocation-record-missing",
            "audit-artifact-readiness-not-ready",
            "manifest-content-not-read",
            "runner-intent-locked",
          ]),
        }),
        expect.objectContaining({
          id: "live-user-memory-dataset-sweep",
          tierId: "real-data",
          auditArtifactReadinessStatus: "blocked",
          runnerIntentSigned: false,
          runnerIntentSignatureReady: false,
          runnerIntentTokenIssued: false,
          runnerIntentUnlocked: false,
        }),
      ]),
    });
    expect(result.snapshot.assets.review.agentOsMemoryEval).toMatchObject({
      schemaVersion: "director.desktop.agent-os-memory-eval.v1",
      suiteId: "director-agent-os-mempalace-real-eval-fixture-gate",
      status: "missing",
      reportPath: expect.stringContaining(
        "director-agent-os-mempalace-real-eval-fixture-gate-latest.json",
      ),
      source: expect.objectContaining({
        name: "local-mini-locomem-style-fixture",
        localOnly: true,
      }),
    });
    expect(result.snapshot.assets.review.agentOsMemorySweepSafety).toMatchObject({
      schemaVersion: "director.desktop.agent-os-memory-sweep-safety.v1",
      status: "blocked",
      summary: {
        planCount: 2,
        blockedCount: 1,
        readyCount: 1,
        canReadUserDataCount: 0,
      },
      plans: expect.arrayContaining([
        expect.objectContaining({
          sweepId: "live-user-memory-sweep",
          status: "blocked",
          canReadUserData: false,
          reasonCodes: expect.arrayContaining([
            "operator-approval-required",
            "anonymization-required",
            "raw-content-storage-forbidden",
            "network-disabled-required",
          ]),
          safetyEnvelope: expect.objectContaining({
            sourceKind: "live-user-memory",
            approvalScope: "live-user-memory-eval",
          }),
        }),
        expect.objectContaining({
          sweepId: "local-fixture-sweep",
          status: "ready",
          canReadUserData: false,
          reasonCodes: [],
          safetyEnvelope: expect.objectContaining({
            sourceKind: "local-fixture",
            dryRunOnly: true,
            allowNetwork: false,
            readOnly: true,
          }),
        }),
      ]),
    });
    expect(result.snapshot.assets.review.agentOsMemoryEvalDashboard).toMatchObject({
      schemaVersion: "director.desktop.agent-os-memory-eval-dashboard.v1",
      status: "missing",
      localOnly: true,
      canReadUserData: false,
      source: expect.objectContaining({
        memoryEvalStatus: "missing",
        datasetLoaderGate: "bench:director-agent-os-memory-dataset-loader-anonymization",
      }),
      memoryEvalTrend: expect.arrayContaining([
        expect.objectContaining({
          id: "local-fixture-recall",
          metric: "recall@k",
          current: 0,
          threshold: 0.8,
          localOnly: true,
          canReadUserData: false,
        }),
        expect.objectContaining({
          id: "local-fixture-ndcg",
          metric: "ndcg@k",
          current: 0,
          threshold: 0.75,
        }),
      ]),
      maintenanceDueActions: expect.arrayContaining([
        expect.objectContaining({
          id: "recall-degradation-watch",
          kind: "maintenance-due",
          status: "due",
          canReadUserData: false,
          nextRecommendedCommand: "pnpm --dir benchmarks bench:director-agent-os-mempalace-real-eval",
        }),
        expect.objectContaining({
          id: "dataset-loader-gate",
          kind: "maintenance-due",
          localOnly: true,
          nextRecommendedCommand:
            "pnpm --dir benchmarks bench:director-agent-os-memory-dataset-loader-anonymization",
        }),
      ]),
    });
    expect(result.snapshot.assets.settings).toMatchObject({
      featureCount: 21,
      enabledCount: 12,
      disabledCount: 9,
      adapterOverrideCount: 1,
      apiProviderCount: 1,
    });
    const settingsById = new Map(
      result.snapshot.assets.settings.parameters.map((parameter) => [parameter.id, parameter]),
    );
    expect(settingsById.get("path:dataDir")).toEqual(
      expect.objectContaining({
        category: "paths",
        description: expect.stringContaining("Skill"),
        value: join(workspaceRoot, ".hotflow"),
        writable: false,
      }),
    );
    expect(settingsById.get("feature:learning.enabled")).toEqual(
      expect.objectContaining({
        category: "features",
        label: "自我学习入口",
        risk: "需要审查",
        type: "boolean",
        value: true,
        defaultValue: false,
        writable: true,
      }),
    );
    expect(settingsById.get("feature:heartbeat.enabled")).toEqual(
      expect.objectContaining({
        category: "features",
        label: "安全心跳模式",
        risk: "低风险监控",
        writable: true,
      }),
    );
    expect(settingsById.get("feature:contentSafety.developerDebug.enabled")).toEqual(
      expect.objectContaining({
        category: "features",
        label: "内容策略诊断",
        risk: "调试可见性",
        writable: true,
      }),
    );
    expect(settingsById.get("runtime:heartbeat.intervalMs")).toEqual(
      expect.objectContaining({
        category: "runtime",
        label: "心跳扫描间隔",
        type: "number",
        value: 60000,
        defaultValue: 60000,
        min: 15000,
        max: 300000,
        writable: true,
      }),
    );
    expect(settingsById.get("gateway:weixin.alwaysOn")).toEqual(
      expect.objectContaining({
        category: "communications",
        label: "微信网关常驻运行",
        risk: "会代表个人微信收发消息",
        type: "boolean",
        writable: true,
      }),
    );
    expect(settingsById.get("feature:toolApproval.autoAllowTrustedDesktop.enabled")).toEqual(
      expect.objectContaining({
        category: "features",
        label: "桌面端工具自动确认",
        risk: "工具权限",
        writable: true,
      }),
    );
    expect(settingsById.get("feature:reflection.autoSuggest.enabled")).toEqual(
      expect.objectContaining({
        category: "features",
        label: "自动复盘建议",
        risk: "审查链路",
        writable: true,
      }),
    );
    expect(settingsById.get("feature:soul.enabled")).toEqual(
      expect.objectContaining({
        category: "features",
        label: "Director Soul",
        risk: "长期记忆",
        writable: true,
      }),
    );
    expect(settingsById.get("feature:soul.autoCandidate.enabled")).toEqual(
      expect.objectContaining({
        category: "features",
        label: "Soul 候选生成",
        risk: "需人工审核",
        writable: true,
      }),
    );
    expect(settingsById.get("feature:care.enabled")).toEqual(
      expect.objectContaining({
        category: "features",
        label: "导演牵挂提醒",
        risk: "低风险提醒",
        writable: true,
      }),
    );
    expect(settingsById.get("role:researcher")).toEqual(
      expect.objectContaining({
        category: "roles",
        label: "研究员角色",
        value: true,
        writable: true,
      }),
    );
    expect(settingsById.get("adapter:external-cli")).toEqual(
      expect.objectContaining({
        category: "adapterOverrides",
        label: "工具开关：external-cli",
        value: false,
        writable: true,
      }),
    );
    expect(settingsById.get("apiProvider:memefast-api:apiKey")).toEqual(
      expect.objectContaining({
        category: "apiProviders",
        label: "魔因API 密钥",
        valueLabel: "未设置",
        writable: true,
        commandId: "apiProvider.set",
      }),
    );
    expect(settingsById.get("apiProvider:memefast-api:baseUrl")).toEqual(
      expect.objectContaining({
        category: "apiProviders",
        label: "魔因API Base URL",
        value: "https://memefast.top",
        valueLabel: "https://memefast.top",
        writable: true,
      }),
    );
    expect(settingsById.get("apiProvider:memefast-api:models")).toEqual(
      expect.objectContaining({
        category: "apiProviders",
        label: "魔因API 模型清单",
        valueLabel: expect.stringContaining("个模型"),
        writable: true,
      }),
    );
    expect(settingsById.get("apiProvider:memefast-api:defaultVisionModel")).toEqual(
      expect.objectContaining({
        category: "apiProviders",
        label: "魔因API 默认视觉模型",
        value: "gemini-3.1-pro-preview",
        writable: true,
      }),
    );
    expect(settingsById.get("apiProvider:memefast-api:endpoints")).toEqual(
      expect.objectContaining({
        category: "apiProviders",
        label: "魔因API POST 路径",
        valueLabel: expect.stringContaining("/v1/images/generations"),
        writable: false,
      }),
    );
    expect(settingsById.get("apiProvider:memefast-api:featureBindings")).toEqual(
      expect.objectContaining({
        category: "apiProviders",
        label: "魔因API 默认服务映射",
        valueLabel: expect.stringContaining("script_analysis"),
        writable: false,
      }),
    );
    expect(settingsById.get("apiProvider:memefast-api:modelMetadata")).toEqual(
      expect.objectContaining({
        category: "apiProviders",
        label: "魔因API 模型适配层",
        valueLabel: expect.stringContaining("doubao-seedance-2-0-260128"),
        writable: false,
      }),
    );
    expect(settingsById.get("apiProvider:memefast-api:routeFamilies")).toEqual(
      expect.objectContaining({
        category: "apiProviders",
        label: "魔因API 路由族",
        valueLabel: expect.stringContaining("volc"),
        writable: false,
      }),
    );
    expect(JSON.stringify(result.snapshot.assets.settings)).not.toContain("sk-real-secret");
    expect(settingsById.get("path:dataDir")?.description).toContain("Skill");
    expect(settingsById.get("feature:learning.enabled")).toMatchObject({
      label: "自我学习入口",
      type: "boolean",
      value: true,
      writable: true,
    });
    expect(settingsById.get("apiProvider:memefast-api:endpoints")?.writable).toBe(false);
    expect(settingsById.get("apiProvider:memefast-api:featureBindings")?.writable).toBe(false);
    expect(settingsById.get("apiProvider:memefast-api:modelMetadata")?.writable).toBe(false);
    expect(settingsById.get("apiProvider:memefast-api:routeFamilies")?.writable).toBe(false);
    expect(result.snapshot.assets.settings.features).toEqual(
      expect.arrayContaining([
        { key: "director.enabled", enabled: true },
        { key: "learning.enabled", enabled: true },
        { key: "publish.enabled", enabled: false },
      ]),
    );
    expect(
      result.snapshot.assets.settings.parameters.every(
        (parameter) =>
          typeof parameter.description === "string" &&
          parameter.description.length > 0 &&
          typeof parameter.risk === "string" &&
          parameter.risk.length > 0,
      ),
    ).toBe(true);
  });

  it("derives agent guardrails from real settings, skills, adapters, and review state", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-guardrails-"));
    tempRoots.push(workspaceRoot);
    writeSkillSnapshotFixture(workspaceRoot);
    writeAdapterRegistryFixture(workspaceRoot);
    writeRuntimeSwitchFixture(workspaceRoot);
    await writePendingApprovalRunFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });

    expect(result.snapshot.assets.settings.guardrails).toMatchObject({
      costBudgetStatus: "blocked",
      skillTrustStatus: "mixed",
      sandboxStatus: "partial",
      toolApprovalMode: "auto-allow-trusted-desktop",
      pendingApprovals: 1,
      highRiskAdapterActionCount: 1,
      operatorApprovalAdapterActionCount: 1,
      realExecutionAdapterCount: 0,
      lastAuditEventId: "event-pending-1",
    });
    expect(result.snapshot.assets.settings.guardrails.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("API"),
        expect.stringContaining("外部 Skill"),
        expect.stringContaining("adapter"),
        expect.stringContaining("桌面端受控工具"),
        expect.stringContaining("高风险 adapter action"),
        expect.stringContaining("人工批准"),
      ]),
    );
  });

  it("manages MCP servers through settings actions and exposes status in snapshots", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-mcp-manage-"));
    tempRoots.push(workspaceRoot);
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const added = await bridge.invoke({
      type: DESKTOP_ACTIONS.MCP_SERVER_UPSERT,
      serverName: "local_search",
      transport: "stdio",
      command: "node",
      args: ["fake-mcp.js"],
      enabled: false,
      include: ["search"],
      env: { EXA_API_KEY: "sk-secret" },
    });
    const configPath = join(workspaceRoot, ".mcp.json");
    const document = JSON.parse(readFileSync(configPath, "utf8"));

    expect(document).toMatchObject({
      mcpServers: {
        local_search: {
          type: "stdio",
          command: "node",
          args: ["fake-mcp.js"],
          enabled: false,
          tools: { include: ["search"] },
          env: { EXA_API_KEY: "sk-secret" },
        },
      },
    });
    expect(JSON.stringify(added.snapshot.assets.settings.mcp)).not.toContain("sk-secret");
    expect(added.snapshot.assets.settings.mcp).toMatchObject({
      configPath,
      inspection: expect.objectContaining({
        serverCount: 1,
        disabledCount: 1,
      }),
      servers: [
        expect.objectContaining({
          name: "local_search",
          status: "disabled",
          config: expect.objectContaining({
            env: { EXA_API_KEY: "[REDACTED]" },
          }),
        }),
      ],
    });

    const selected = await bridge.invoke({
      type: DESKTOP_ACTIONS.MCP_SERVER_TOOL_SELECTION_SET,
      serverName: "local_search",
      include: ["search", "extract"],
    });
    expect(selected.events.at(-1)).toMatchObject({
      title: "MCP 工具选择已保存",
      actionType: DESKTOP_ACTIONS.MCP_SERVER_TOOL_SELECTION_SET,
    });
    expect(JSON.parse(readFileSync(configPath, "utf8")).mcpServers.local_search.tools).toEqual({
      include: ["search", "extract"],
    });

    const removed = await bridge.invoke({
      type: DESKTOP_ACTIONS.MCP_SERVER_DELETE,
      serverName: "local_search",
    });
    expect(removed.events.at(-1)).toMatchObject({
      title: "MCP 服务已删除",
      actionType: DESKTOP_ACTIONS.MCP_SERVER_DELETE,
    });
    expect(JSON.parse(readFileSync(configPath, "utf8")).mcpServers.local_search).toBeUndefined();
  });

  it("loads MCP servers from parent project configs and legacy Director configs with workspace overrides", async () => {
    const parentRoot = mkdtempSync(join(tmpdir(), "director-desktop-mcp-scope-parent-"));
    tempRoots.push(parentRoot);
    const workspaceRoot = join(parentRoot, "nested", "project");
    mkdirSync(workspaceRoot, { recursive: true });
    mkdirSync(join(workspaceRoot, ".director-angel", "mcp"), { recursive: true });
    writeFileSync(
      join(parentRoot, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            inherited: {
              type: "stdio",
              command: "node",
              args: ["parent.js"],
              enabled: false,
            },
            shared: {
              type: "stdio",
              command: "node",
              args: ["parent-shared.js"],
              enabled: false,
            },
          },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(workspaceRoot, ".director-angel", "mcp", "servers.json"),
      JSON.stringify(
        {
          mcpServers: {
            legacy: {
              type: "stdio",
              command: "node",
              args: ["legacy.js"],
              enabled: false,
            },
            shared: {
              type: "stdio",
              command: "node",
              args: ["legacy-shared.js"],
              enabled: false,
            },
          },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(workspaceRoot, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            shared: {
              type: "stdio",
              command: "node",
              args: ["workspace-shared.js"],
              enabled: false,
            },
          },
        },
        null,
        2,
      ),
    );

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    const mcp = result.snapshot.assets.settings.mcp;

    expect(mcp).toMatchObject({
      configPath: join(workspaceRoot, ".mcp.json"),
      source: "merged",
      sourceCount: 3,
      servers: expect.arrayContaining([
        expect.objectContaining({
          name: "legacy",
          scope: "director-project",
          sourcePath: join(workspaceRoot, ".director-angel", "mcp", "servers.json"),
        }),
        expect.objectContaining({
          name: "inherited",
          scope: "project-parent",
          sourcePath: join(parentRoot, ".mcp.json"),
        }),
        expect.objectContaining({
          name: "shared",
          scope: "project",
          sourcePath: join(workspaceRoot, ".mcp.json"),
          config: expect.objectContaining({
            args: ["workspace-shared.js"],
          }),
        }),
      ]),
    });
    expect(mcp.sources.map((source) => source.scope)).toEqual([
      "director-project",
      "project-parent",
      "project",
    ]);
    expect(result.snapshot.assets.tools.externalToolBus.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mcp:shared",
          metadata: expect.objectContaining({
            scope: "project",
            sourcePath: join(workspaceRoot, ".mcp.json"),
          }),
          sourceTrust: expect.objectContaining({
            sourceRef: join(workspaceRoot, ".mcp.json"),
          }),
        }),
      ]),
    );

    await bridge.invoke({
      type: DESKTOP_ACTIONS.MCP_SERVER_UPSERT,
      serverName: "inherited",
      transport: "stdio",
      command: "node",
      args: ["workspace-inherited.js"],
      enabled: false,
    });
    expect(JSON.parse(readFileSync(join(workspaceRoot, ".mcp.json"), "utf8"))).toMatchObject({
      mcpServers: {
        inherited: {
          args: ["workspace-inherited.js"],
        },
        shared: {
          args: ["workspace-shared.js"],
        },
      },
    });
    expect(JSON.parse(readFileSync(join(parentRoot, ".mcp.json"), "utf8"))).toMatchObject({
      mcpServers: {
        inherited: {
          args: ["parent.js"],
        },
      },
    });
  });

  it("disables inherited MCP servers with a local override instead of pretending parent config was deleted", async () => {
    const parentRoot = mkdtempSync(join(tmpdir(), "director-desktop-mcp-parent-delete-"));
    tempRoots.push(parentRoot);
    const workspaceRoot = join(parentRoot, "nested", "project");
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(
      join(parentRoot, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            inherited: {
              type: "stdio",
              command: "node",
              args: ["parent.js"],
              enabled: true,
            },
          },
        },
        null,
        2,
      ),
    );
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const removed = await bridge.invoke({
      type: DESKTOP_ACTIONS.MCP_SERVER_DELETE,
      serverName: "inherited",
    });

    expect(removed.events.at(-1)).toMatchObject({
      title: "MCP 服务已在本项目停用",
      body: expect.stringContaining("父级"),
    });
    expect(JSON.parse(readFileSync(join(parentRoot, ".mcp.json"), "utf8"))).toMatchObject({
      mcpServers: {
        inherited: {
          enabled: true,
        },
      },
    });
    expect(JSON.parse(readFileSync(join(workspaceRoot, ".mcp.json"), "utf8"))).toMatchObject({
      mcpServers: {
        inherited: {
          enabled: false,
          args: ["parent.js"],
        },
      },
    });
    expect(removed.snapshot.assets.settings.mcp.servers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "inherited",
          status: "disabled",
          scope: "project",
          sourcePath: join(workspaceRoot, ".mcp.json"),
        }),
      ]),
    );
  });

  it("keeps an inherited MCP server locally disabled when delete is clicked more than once", async () => {
    const parentRoot = mkdtempSync(join(tmpdir(), "director-desktop-mcp-repeat-delete-"));
    tempRoots.push(parentRoot);
    const workspaceRoot = join(parentRoot, "nested", "project");
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(
      join(parentRoot, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            inherited: {
              type: "stdio",
              command: "node",
              args: ["parent.js"],
              enabled: true,
            },
          },
        },
        null,
        2,
      ),
    );
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.MCP_SERVER_DELETE,
      serverName: "inherited",
    });
    const removedAgain = await bridge.invoke({
      type: DESKTOP_ACTIONS.MCP_SERVER_DELETE,
      serverName: "inherited",
    });

    expect(removedAgain.events.at(-1)).toMatchObject({
      title: "MCP 服务已在本项目停用",
      body: expect.stringContaining("不会修改上游配置"),
    });
    expect(JSON.parse(readFileSync(join(parentRoot, ".mcp.json"), "utf8"))).toMatchObject({
      mcpServers: {
        inherited: {
          enabled: true,
        },
      },
    });
    expect(JSON.parse(readFileSync(join(workspaceRoot, ".mcp.json"), "utf8"))).toMatchObject({
      mcpServers: {
        inherited: {
          enabled: false,
          args: ["parent.js"],
        },
      },
    });
    expect(removedAgain.snapshot.assets.settings.mcp.servers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "inherited",
          status: "disabled",
          scope: "project",
          sourcePath: join(workspaceRoot, ".mcp.json"),
        }),
      ]),
    );
  });

  it("enables an inherited MCP server by removing the local disabled override", async () => {
    const parentRoot = mkdtempSync(join(tmpdir(), "director-desktop-mcp-enable-inherited-"));
    tempRoots.push(parentRoot);
    const workspaceRoot = join(parentRoot, "nested", "project");
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(
      join(parentRoot, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            inherited: {
              type: "stdio",
              command: "node",
              args: ["parent.js"],
              enabled: true,
            },
          },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(workspaceRoot, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            inherited: {
              type: "stdio",
              command: "node",
              args: ["parent.js"],
              enabled: false,
            },
          },
        },
        null,
        2,
      ),
    );
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const enabled = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "mcp:inherited",
      operation: "enable",
    });

    expect(enabled.events.at(-1)).toMatchObject({
      title: "外部工具已启用",
      body: expect.stringContaining("恢复继承配置"),
    });
    expect(JSON.parse(readFileSync(join(parentRoot, ".mcp.json"), "utf8"))).toMatchObject({
      mcpServers: {
        inherited: {
          enabled: true,
        },
      },
    });
    expect(
      JSON.parse(readFileSync(join(workspaceRoot, ".mcp.json"), "utf8")).mcpServers.inherited,
    ).toBeUndefined();
    expect(enabled.snapshot.assets.settings.mcp.servers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "inherited",
          scope: "project-parent",
          sourcePath: join(parentRoot, ".mcp.json"),
        }),
      ]),
    );
  });

  it("runs MCP OAuth login from desktop settings and separates auth status from connection status", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-mcp-oauth-"));
    tempRoots.push(workspaceRoot);
    process.env.DIRECTOR_MCP_OAUTH_STORAGE = "file";
    const authServer = await startFakeDesktopMcpOAuthServer();
    const openedUrls = [];
    try {
      const bridge = createDirectorDesktopBridgeFacade({
        handlers: createDirectorDesktopSystemHandlers({
          workspaceRoot,
          knowledge: directorKnowledge,
          openExternalUrl: async (url) => {
            openedUrls.push(url);
            const parsed = new URL(url);
            const redirectUri = parsed.searchParams.get("redirect_uri");
            const state = parsed.searchParams.get("state");
            if (!redirectUri) {
              throw new Error("missing redirect_uri");
            }
            await fetch(`${redirectUri}?code=desktop-code&state=${state ?? ""}`);
          },
        }),
      });

      await bridge.invoke({
        type: DESKTOP_ACTIONS.MCP_SERVER_UPSERT,
        serverName: "remote",
        transport: "http",
        url: "https://mcp.example.test/mcp",
        auth: "oauth",
        timeoutMs: 1000,
      });
      const documentPath = join(workspaceRoot, ".mcp.json");
      const document = JSON.parse(readFileSync(documentPath, "utf8"));
      document.mcpServers.remote.oauth = {
        authServerMetadataUrl: `${authServer.url}/.well-known/oauth-authorization-server`,
      };
      writeFileSync(documentPath, JSON.stringify(document, null, 2), "utf8");

      const result = await bridge.invoke({
        type: DESKTOP_ACTIONS.MCP_LOGIN,
        serverName: "remote",
        timeoutMs: 15000,
      });

      expect(openedUrls).toHaveLength(1);
      expect(openedUrls[0]).toContain(`${authServer.url}/authorize`);
      expect(result.mcpLogin).toMatchObject({
        serverName: "remote",
        authMode: "oauth",
        authStatus: "authorized",
        status: "authorized",
        connectionStatus: "failed",
        storage: expect.objectContaining({ kind: "file" }),
      });
      expect(result.events.at(-1)).toMatchObject({
        title: "MCP 登录已完成",
        actionType: DESKTOP_ACTIONS.MCP_LOGIN,
      });
      const tokenStore = JSON.parse(
        readFileSync(join(workspaceRoot, ".director-angel", "mcp", "oauth-tokens.json"), "utf8"),
      );
      expect(JSON.stringify(tokenStore)).toContain("access-token-desktop-code");

      const revoked = await bridge.invoke({
        type: DESKTOP_ACTIONS.MCP_REVOKE,
        serverName: "remote",
      });
      expect(revoked.mcpRevoke).toMatchObject({
        serverName: "remote",
        authMode: "oauth",
        localCredentialsCleared: true,
        storage: expect.objectContaining({ kind: "file" }),
      });
      expect(revoked.events.at(-1)).toMatchObject({
        title: expect.stringMatching(/MCP .*授权/u),
        actionType: DESKTOP_ACTIONS.MCP_REVOKE,
      });
      const clearedStore = JSON.parse(
        readFileSync(join(workspaceRoot, ".director-angel", "mcp", "oauth-tokens.json"), "utf8"),
      );
      expect(clearedStore.servers).toEqual({});
    } finally {
      await authServer.close();
    }
  }, 20_000);

  it("stops desktop approval-gated tool calls when trusted auto-allow is disabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-tool-permission-mode-"));
    tempRoots.push(workspaceRoot);
    writeRichSkillSnapshotFixture(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "toolApproval.autoAllowTrustedDesktop.enabled": false,
    });
    new SkillManagementStore(
      resolveSkillManagementPath({ dataDir: join(workspaceRoot, ".hotflow") }),
    ).setSkillEnabled("skill.backend-snapshot", false, {
      actor: "test",
      note: "start disabled so approval gate can protect enablement",
      nowMs: 1,
    });
    const calls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          calls.push({ url, method: init.method, body });
          return jsonResponse({
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    {
                      id: "call-skill-enable-approval-1",
                      type: "function",
                      function: {
                        name: "director.skills.set_enabled",
                        arguments: JSON.stringify({
                          skillId: "skill.backend-snapshot",
                          enabled: true,
                          reason: "用户要求启用 backend snapshot Skill。",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-tool-approval-mode",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "defaultTextModel",
      value: "gemini-2.5-flash",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "把 backend snapshot 这个 Skill 启用起来",
      surface: "workbench",
    });

    const providerCalls = calls.filter((call) => call.url.includes("/chat/completions"));
    expect(providerCalls).toHaveLength(1);
    expect(result.conversationRuntime.finalText).toBeUndefined();
    expect(result.runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.approval",
          payload: expect.objectContaining({
            approval: expect.objectContaining({
              status: "pending",
              metadata: expect.objectContaining({
                toolName: "director.skills.set_enabled",
                permissionStatus: "ask",
                decisionMetadata: expect.objectContaining({
                  toolApprovalMode: "ask",
                }),
              }),
            }),
          }),
        }),
      ]),
    );
    expect(result.apiProviderRun.runtimeEvents).toEqual(result.runtimeEvents);
    expect(result.runtimeToolApproval).toMatchObject({
      pendingCount: 1,
      latest: expect.objectContaining({
        approvalId: "tool:call-skill-enable-approval-1",
        status: "pending",
        toolName: "director.skills.set_enabled",
      }),
    });
    const management = JSON.parse(
      readFileSync(
        resolveSkillManagementPath({ dataDir: join(workspaceRoot, ".hotflow") }),
        "utf8",
      ),
    );
    expect(management.disabledSkillIds).toContain("skill.backend-snapshot");
  });

  it("shows Agent OS process ledger evidence on desktop runtime approval cards", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-tool-approval-ledger-"));
    tempRoots.push(workspaceRoot);
    writeRichSkillSnapshotFixture(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "toolApproval.autoAllowTrustedDesktop.enabled": false,
    });
    new SkillManagementStore(
      resolveSkillManagementPath({ dataDir: join(workspaceRoot, ".hotflow") }),
    ).setSkillEnabled("skill.backend-snapshot", false, {
      actor: "test",
      note: "start disabled so approval card can surface ledger evidence",
      nowMs: 1,
    });
    const handlers = createDirectorDesktopSystemHandlers({
      workspaceRoot,
      knowledge: directorKnowledge,
      comfyUiCommandExists: (command) => command === "comfy",
      agentOsSandboxCommandRunner: async () => ({
        exitCode: 0,
        stdout: "sandbox lifecycle ok",
        stderr: "",
      }),
      apiProviderFetch: async () =>
        jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-skill-enable-ledger-1",
                    type: "function",
                    function: {
                      name: "director.skills.set_enabled",
                      arguments: JSON.stringify({
                        skillId: "skill.backend-snapshot",
                        enabled: true,
                        reason: "用户要求启用 backend snapshot Skill。",
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
    });
    const bridge = createDirectorDesktopBridgeFacade({
      handlers,
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMFYUI_SET,
      key: "enabled",
      value: true,
    });
    const lifecycle = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/comfyui 停止",
      surface: "workbench",
    });
    expect(lifecycle.snapshot.assets.tools.externalToolBus.processCapabilityLedger).toMatchObject({
      totalEntries: 1,
      riskyHostEntries: 1,
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-tool-approval-ledger",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const pending = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "把 backend snapshot 这个 Skill 启用起来",
      surface: "workbench",
    });

    expect(pending.runtimeToolApproval.latest).toMatchObject({
      approvalId: "tool:call-skill-enable-ledger-1",
      processCapabilityLedger: expect.objectContaining({
        totalEntries: 1,
        riskyHostEntries: 1,
        entries: [
          expect.objectContaining({
            runnerKind: "comfyui-cli",
            backend: "host",
            status: "completed",
            commandPattern: {
              executable: "comfy",
              argv: ["stop"],
              operationId: "lifecycle",
            },
          }),
        ],
      }),
      processCapabilityLedgerLines: expect.arrayContaining([
        "Agent OS 进程账本：total=1 host=1",
        expect.stringContaining("comfyui-cli backend=host status=completed command=comfy stop"),
      ]),
    });
    expect(pending.runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.approval",
          payload: expect.objectContaining({
            approval: expect.objectContaining({
              metadata: expect.objectContaining({
                decisionMetadata: expect.objectContaining({
                  agentOsProcessCapabilityLedger: expect.objectContaining({
                    totalEntries: 1,
                    riskyHostEntries: 1,
                  }),
                }),
              }),
            }),
          }),
        }),
      ]),
    );
  });

  it("executes a pending runtime tool approval through a real desktop decision action", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-tool-approval-approve-"));
    tempRoots.push(workspaceRoot);
    writeRichSkillSnapshotFixture(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "toolApproval.autoAllowTrustedDesktop.enabled": false,
    });
    new SkillManagementStore(
      resolveSkillManagementPath({ dataDir: join(workspaceRoot, ".hotflow") }),
    ).setSkillEnabled("skill.backend-snapshot", false, {
      actor: "test",
      note: "start disabled so approval can execute enablement",
      nowMs: 1,
    });
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async () =>
          jsonResponse({
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    {
                      id: "call-skill-enable-decision-1",
                      type: "function",
                      function: {
                        name: "director.skills.set_enabled",
                        arguments: JSON.stringify({
                          skillId: "skill.backend-snapshot",
                          enabled: true,
                          reason: "用户要求启用 backend snapshot Skill。",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-tool-approval-decision",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });
    const pending = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "把 backend snapshot 这个 Skill 启用起来",
      surface: "workbench",
    });
    const approvalId = pending.runtimeToolApproval.latest.approvalId;

    const approved = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUNTIME_TOOL_APPROVAL_DECIDE,
      approvalId,
      decision: "approve",
    });

    expect(approved.runtimeToolApproval.latest).toMatchObject({
      approvalId,
      status: "approved",
      result: expect.objectContaining({
        ok: true,
        toolName: "director.skills.set_enabled",
      }),
    });
    expect(approved.events.at(-1)?.body).toContain("桌面工具确认");
    expect(approved.events.at(-1)?.body).toContain("status: approved");
    expect(approved.events.at(-1)?.body).toContain("已确认，工具已执行。");
    expect(approved.events.at(-1)?.body).toContain("Skill 已开启");
    expect(approved.events.at(-1)?.body).not.toContain("trusted desktop operator approved");
    expect(approved.snapshot.assets.review.runtimeToolApprovalPendingCount).toBe(0);
    const management = JSON.parse(
      readFileSync(
        resolveSkillManagementPath({ dataDir: join(workspaceRoot, ".hotflow") }),
        "utf8",
      ),
    );
    expect(management.disabledSkillIds).not.toContain("skill.backend-snapshot");
  });

  it("executes approved spawn_subagent requests against the active Run task-plane", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-spawn-approval-"));
    tempRoots.push(workspaceRoot);
    await writeExecutionRunFixture(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "toolApproval.autoAllowTrustedDesktop.enabled": false,
    });
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async () =>
          fakeApiProviderToolCallsResponse([
            {
              id: "call-spawn-background-research",
              name: "spawn_subagent",
              args: {
                task: "后台核对 Run task-plane",
                expectedOutput: "返回核对摘要",
                profileId: "researcher",
                parallelGroup: "approval-spawn",
                writeSet: ["docs/spawn.md"],
              },
            },
          ]),
      }),
    });
    await configureFakeApiProvider(bridge);

    const pending = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "后台启动一个研究子代理核对 Run",
      surface: "workbench",
      turnId: "desktop-spawn-approval-turn",
      runId: "run-review-1",
    });
    expect(pending.runtimeToolApproval).toMatchObject({
      pendingCount: 1,
      latest: expect.objectContaining({
        approvalId: "tool:call-spawn-background-research",
        status: "pending",
        toolName: "spawn_subagent",
        activeRunId: "run-review-1",
      }),
    });

    const approved = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUNTIME_TOOL_APPROVAL_DECIDE,
      approvalId: pending.runtimeToolApproval.latest.approvalId,
      decision: "approve",
    });
    const delegations = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUN_DELEGATIONS,
      runId: "run-review-1",
    });
    const task = await bridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_READ,
      taskId: "conversation:desktop-spawn-approval-turn",
    });

    expect(approved.runtimeToolApproval.latest).toMatchObject({
      status: "approved",
      result: expect.objectContaining({
        ok: true,
        toolName: "spawn_subagent",
        content: expect.stringContaining("status: accepted"),
        metadata: expect.objectContaining({
          asyncSubagent: true,
          requesterSessionKey: "desktop:run:run-review-1",
          deliveryTarget: "desktop:workbench",
        }),
      }),
    });
    expect(delegations.runDelegations.delegations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringContaining("subagent_"),
          workerId: "researcher",
          instruction: "后台核对 Run task-plane",
          status: "queued",
          contextSnapshot: expect.stringContaining("requesterSessionKey=desktop:run:run-review-1"),
        }),
      ]),
    );
    const spawnedSubagentId = delegations.runDelegations.delegations.find(
      (delegation) => delegation.instruction === "后台核对 Run task-plane",
    )?.id;
    expect(spawnedSubagentId).toEqual(expect.stringContaining("subagent_"));
    expect(task.taskRuntimeTask.payload.turnRunId).toBe(
      "desktop:workbench:desktop-spawn-approval-turn:run",
    );
    const cancelled = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_CANCEL,
      turnId: "desktop-spawn-approval-turn",
      reason: "operator stopped approved background subagent",
    });
    const afterCancel = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUN_DELEGATIONS,
      runId: "run-review-1",
    });
    expect(cancelled.conversationSubagentRunIds).toEqual(
      expect.arrayContaining([spawnedSubagentId]),
    );
    expect(afterCancel.runDelegations.delegations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: spawnedSubagentId,
          status: "cancelled",
          error: "operator stopped approved background subagent",
        }),
      ]),
    );
  });

  it("executes ready spawn_subagent delegations through the local scheduler executor", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-spawn-runner-"));
    tempRoots.push(workspaceRoot);
    await writeExecutionRunFixture(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "toolApproval.autoAllowTrustedDesktop.enabled": false,
    });
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async () =>
          fakeApiProviderToolCallsResponse([
            {
              id: "call-spawn-local-runner",
              name: "spawn_subagent",
              args: {
                task: "后台整理本轮 U3 runner 证据",
                expectedOutput: "返回 runner 收口摘要",
                profileId: "researcher",
                parallelGroup: "runner",
                writeSet: ["docs/u3-runner.md"],
              },
            },
          ]),
      }),
    });
    await configureFakeApiProvider(bridge);

    const pending = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "后台启动 runner 证据整理",
      surface: "workbench",
      turnId: "desktop-spawn-runner-turn",
      runId: "run-review-1",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.RUNTIME_TOOL_APPROVAL_DECIDE,
      approvalId: pending.runtimeToolApproval.latest.approvalId,
      decision: "approve",
    });

    const runner = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUN_SCHEDULER_EXECUTOR,
      runId: "run-review-1",
      maxDispatches: 1,
    });
    const afterRun = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUN_DELEGATIONS,
      runId: "run-review-1",
    });

    expect(runner.runSchedulerExecutor).toMatchObject({
      status: "ok",
      sessionId: "run-review-1",
      executorMode: "bounded-local",
      executedCount: 1,
      dispatchReports: [
        expect.objectContaining({
          finalDelegationStatus: "completed",
          subagentRun: expect.objectContaining({
            status: "completed",
            instruction: "后台整理本轮 U3 runner 证据",
            parentVisibleResult: expect.objectContaining({
              status: "completed",
              summary: expect.stringContaining("completed by worker researcher"),
            }),
          }),
        }),
      ],
    });
    expect(runner.runDelegations).toMatchObject({
      completedDelegationCount: 1,
      pendingDelegationCount: 0,
      completedSubagentRunCount: 1,
      subagentAnnounceCount: 1,
      subagentAnnounces: [
        expect.objectContaining({
          requesterSessionKey: "desktop:run:run-review-1",
          requesterOrigin: "desktop",
          deliveryTarget: "desktop:workbench",
          status: "completed",
          userFacingText: expect.stringContaining("后台子代理已完成"),
        }),
      ],
    });
    expect(runner.events.at(-1)?.title).toBe("后台子代理已执行");
    expect(runner.events.at(-1)?.body).toContain("本次执行 1 个");
    expect(runner.events.at(-1)?.body).toContain("完成 1 个");
    expect(runner.events.at(-1)?.body).toContain("后台整理本轮 U3 runner 证据");
    expect(afterRun.runDelegations.delegations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instruction: "后台整理本轮 U3 runner 证据",
          status: "completed",
          resultSummary: expect.stringContaining("completed by worker researcher"),
        }),
      ]),
    );
    expect(afterRun.events[0].body).toContain("完成 1");
  });

  it("runs synchronous run_subagent through the configured API provider without leaking child tool logs", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-run-subagent-sync-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    const calls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          calls.push({ url, body });
          const hasRunSubagentResult = body.messages?.some(
            (message) =>
              message.role === "tool" &&
              message.tool_call_id === "call-run-subagent-sync" &&
              String(message.content).includes("子代理只返回最终摘要"),
          );
          const hasRecallToolResult = body.messages?.some(
            (message) =>
              message.role === "tool" &&
              message.tool_call_id === "call-child-recall",
          );
          if (hasRunSubagentResult) {
            expect(JSON.stringify(body.messages)).not.toContain("call-child-recall");
            expect(JSON.stringify(body.messages)).not.toContain("未召回额外上下文");
            return fakeApiProviderTextResponse("父回合已拿到子代理结论：子代理只返回最终摘要。");
          }
          if (hasRecallToolResult) {
            return fakeApiProviderTextResponse("子代理只返回最终摘要。");
          }
          if (body.messages?.some((message) => String(message.content).includes("Task: 核对记忆素材"))) {
            return fakeApiProviderToolCallsResponse([
              {
                id: "call-child-recall",
                name: "director.memory.recall",
                args: {
                  query: "记忆素材",
                  maxHits: 1,
                },
              },
            ]);
          }
          return fakeApiProviderToolCallsResponse([
            {
              id: "call-run-subagent-sync",
              name: "run_subagent",
              args: {
                task: "核对记忆素材",
                expectedOutput: "只返回给父回合的一句话摘要",
                profileId: "researcher",
                allowedTools: ["director.memory.recall"],
                maxTurns: 2,
              },
            },
          ]);
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "用一个短子代理核对记忆素材，再给我结论",
      surface: "workbench",
      turnId: "desktop-run-subagent-sync-turn",
    });

    const providerCalls = calls.filter((call) => call.url.includes("/chat/completions"));
    expect(providerCalls.length).toBeGreaterThanOrEqual(4);
    expect(providerCalls[0]?.body?.tools?.map((tool) => tool.function?.name)).toEqual(
      expect.arrayContaining(["run_subagent"]),
    );
    const childCall = providerCalls.find((call) =>
      call.body.messages?.some((message) => String(message.content).includes("Task: 核对记忆素材")),
    );
    expect(childCall?.body.tools.map((tool) => tool.function.name)).toEqual([
      "director.memory.recall",
    ]);
    expect(result.apiProviderRun.output).toContain("父回合已拿到子代理结论");
    expect(result.runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.tool",
          payload: expect.objectContaining({
            tool: expect.objectContaining({
              name: "run_subagent",
              phase: "completed",
              outputPreview: "子代理只返回最终摘要。",
              metadata: expect.objectContaining({
                toolResultMetadata: expect.objectContaining({
                  syncSubagent: true,
                  childToolCount: 1,
                }),
              }),
            }),
          }),
        }),
      ]),
    );
    expect(JSON.stringify(result.conversationRuntime.transcriptMessages)).not.toContain(
      "call-child-recall",
    );
    expect(JSON.stringify(result.conversationRuntime.transcriptMessages)).not.toContain(
      "未召回额外上下文",
    );
    expect(JSON.stringify(result)).not.toContain("sk-comfyui-secret");
  });

  it("fails run_subagent closed in Chinese when no API provider is configured", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-run-subagent-no-provider-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    const calls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          calls.push({ url, body: JSON.parse(String(init.body)) });
          return fakeApiProviderToolCallsResponse([
            {
              id: "call-run-subagent-no-provider",
              name: "run_subagent",
              args: {
                task: "核对当前能力",
                expectedOutput: "返回一句摘要",
                profileId: "researcher",
              },
            },
          ]);
        },
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "用短子代理核对当前能力",
      surface: "workbench",
      turnId: "desktop-run-subagent-no-provider-turn",
      sourceAction: {
        type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
        prompt: "用短子代理核对当前能力",
        surface: "workbench",
        turnIntent: {
          kind: "chat",
          text: "用短子代理核对当前能力",
        },
        responsePolicy: "result-first",
      },
    });

    expect(calls).toHaveLength(0);
    expect(result.apiProviderRun).toMatchObject({
      ok: false,
      providerId: "conversation-runtime",
      replySource: "degraded-error",
    });
    expect(result.apiProviderRun.message).toContain("模型 Key 未配置");
    expect(result.apiProviderRun.message).toContain("先在设置里添加并启用对应供应方的 Key");
    expect(result.apiProviderRun.message).not.toContain("Unknown API provider");
    expect(result.apiProviderRun.message).not.toContain("Error:");
  });

  it("rejects a pending runtime tool approval without executing the tool", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-tool-approval-reject-"));
    tempRoots.push(workspaceRoot);
    writeRichSkillSnapshotFixture(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "toolApproval.autoAllowTrustedDesktop.enabled": false,
    });
    new SkillManagementStore(
      resolveSkillManagementPath({ dataDir: join(workspaceRoot, ".hotflow") }),
    ).setSkillEnabled("skill.backend-snapshot", false, {
      actor: "test",
      note: "start disabled so rejection can protect enablement",
      nowMs: 1,
    });
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async () =>
          jsonResponse({
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    {
                      id: "call-skill-enable-reject-1",
                      type: "function",
                      function: {
                        name: "director.skills.set_enabled",
                        arguments: JSON.stringify({
                          skillId: "skill.backend-snapshot",
                          enabled: true,
                          reason: "用户要求启用 backend snapshot Skill。",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-tool-approval-reject",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });
    const pending = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "把 backend snapshot 这个 Skill 启用起来",
      surface: "workbench",
    });

    const rejected = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUNTIME_TOOL_APPROVAL_DECIDE,
      approvalId: pending.runtimeToolApproval.latest.approvalId,
      decision: "reject",
    });

    expect(rejected.runtimeToolApproval.latest).toMatchObject({
      status: "rejected",
      result: null,
    });
    expect(rejected.events.at(-1)?.body).toContain("桌面工具确认");
    expect(rejected.events.at(-1)?.body).toContain("status: rejected");
    expect(rejected.events.at(-1)?.body).toContain("已拒绝，本次工具不会执行。");
    expect(rejected.events.at(-1)?.body).not.toContain("trusted desktop operator rejected");
    const management = JSON.parse(
      readFileSync(
        resolveSkillManagementPath({ dataDir: join(workspaceRoot, ".hotflow") }),
        "utf8",
      ),
    );
    expect(management.disabledSkillIds).toContain("skill.backend-snapshot");
  });

  it("applies desktop tool approval setting changes to the next runtime turn without restart", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-tool-permission-hot-"));
    tempRoots.push(workspaceRoot);
    writeRichSkillSnapshotFixture(workspaceRoot);
    writeRuntimeSwitchFixture(workspaceRoot);
    new SkillManagementStore(
      resolveSkillManagementPath({ dataDir: join(workspaceRoot, ".hotflow") }),
    ).setSkillEnabled("skill.backend-snapshot", false, {
      actor: "test",
      note: "start disabled so hot setting can protect enablement",
      nowMs: 1,
    });
    const calls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          calls.push({ url, method: init.method, body });
          return jsonResponse({
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    {
                      id: "call-skill-enable-hot-approval-1",
                      type: "function",
                      function: {
                        name: "director.skills.set_enabled",
                        arguments: JSON.stringify({
                          skillId: "skill.backend-snapshot",
                          enabled: true,
                          reason: "用户要求启用 backend snapshot Skill。",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-tool-approval-hot",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });
    const settingsResult = await bridge.invoke({
      type: DESKTOP_ACTIONS.SETTINGS_SET,
      parameterId: "feature:toolApproval.autoAllowTrustedDesktop.enabled",
      value: false,
    });
    expect(settingsResult.snapshot.assets.settings.guardrails.toolApprovalMode).toBe("ask");

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "把 backend snapshot 这个 Skill 启用起来",
      surface: "workbench",
    });

    expect(calls.filter((call) => call.url.includes("/chat/completions"))).toHaveLength(1);
    expect(result.runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.approval",
          payload: expect.objectContaining({
            approval: expect.objectContaining({
              status: "pending",
              metadata: expect.objectContaining({
                toolName: "director.skills.set_enabled",
                decisionMetadata: expect.objectContaining({
                  toolApprovalMode: "ask",
                }),
              }),
            }),
          }),
        }),
      ]),
    );
    const management = JSON.parse(
      readFileSync(
        resolveSkillManagementPath({ dataDir: join(workspaceRoot, ".hotflow") }),
        "utf8",
      ),
    );
    expect(management.disabledSkillIds).toContain("skill.backend-snapshot");
  });

  it("approves a pending execution assignment through a real desktop action", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-run-approve-"));
    tempRoots.push(workspaceRoot);
    await writePendingApprovalRunFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUN_APPROVE_ASSIGNMENT,
      runId: "run-pending-approval-1",
      assignmentId: "assignment-pending-1",
    });
    const store = new FileSystemRunStore({
      rootPath: join(workspaceRoot, ".director-angel", "runtime", "execution"),
    });
    const run = await store.loadRun("run-pending-approval-1");
    const assignment = run?.assignments.find(
      (item) => item.assignmentId === "assignment-pending-1",
    );

    expect(result.events[0]).toMatchObject({
      title: "Assignment 已批准",
      actionType: DESKTOP_ACTIONS.RUN_APPROVE_ASSIGNMENT,
    });
    expect(assignment).toMatchObject({
      status: "ready",
      approvalMode: "auto_allow",
    });
    expect(assignment?.blockingReason).toBeUndefined();
  });

  it("approves all pending execution assignments through one desktop action", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-run-approve-all-"));
    tempRoots.push(workspaceRoot);
    await writePendingApprovalRunFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUN_APPROVE_PENDING_ASSIGNMENTS,
      runId: "run-pending-approval-1",
    });
    const store = new FileSystemRunStore({
      rootPath: join(workspaceRoot, ".director-angel", "runtime", "execution"),
    });
    const run = await store.loadRun("run-pending-approval-1");

    expect(result.events[0]).toMatchObject({
      title: "待审任务已批准",
      actionType: DESKTOP_ACTIONS.RUN_APPROVE_PENDING_ASSIGNMENTS,
    });
    expect(
      run?.assignments.every(
        (assignment) =>
          assignment.approvalMode !== "operator_approve" || assignment.status !== "pending",
      ),
    ).toBe(true);
  });

  it("persists cost budget settings and refreshes guardrail status", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-cost-budget-"));
    tempRoots.push(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "test-budget-key",
    });
    const ok = await bridge.invoke({
      type: DESKTOP_ACTIONS.COST_BUDGET_SET,
      limitUsd: 20,
      spentUsd: 4,
      blocked: false,
      now: "2026-04-28T08:00:00.000Z",
    });
    const budget = JSON.parse(
      readFileSync(join(workspaceRoot, ".director-angel", "runtime", "cost-budget.json"), "utf8"),
    );

    expect(ok.events[0]).toMatchObject({
      title: "成本预算已更新",
    });
    expect(budget).toMatchObject({
      schemaVersion: "director.cost-budget.v1",
      limitUsd: 20,
      spentUsd: 4,
      remainingUsd: 16,
      blocked: false,
      updatedAt: "2026-04-28T08:00:00.000Z",
    });
    expect(ok.snapshot.assets.settings.costBudget).toMatchObject({
      status: "ok",
      limitUsd: 20,
      spentUsd: 4,
      remainingUsd: 16,
      blocked: false,
    });
    expect(ok.snapshot.assets.settings.guardrails.costBudgetStatus).toBe("ok");

    const blocked = await bridge.invoke({
      type: DESKTOP_ACTIONS.COST_BUDGET_SET,
      limitUsd: 20,
      spentUsd: 20,
      blocked: true,
      now: "2026-04-28T08:01:00.000Z",
    });

    expect(blocked.snapshot.assets.settings.costBudget).toMatchObject({
      status: "blocked",
      limitUsd: 20,
      spentUsd: 20,
      remainingUsd: 0,
      blocked: true,
    });
    expect(blocked.snapshot.assets.settings.guardrails.costBudgetStatus).toBe("blocked");
  });

  it("creates a production run from the workbench with published knowledge and approved Skill context", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-production-"));
    tempRoots.push(workspaceRoot);
    const lessonDir = join(workspaceRoot, "fixtures", "production-lessons");
    mkdirSync(lessonDir, { recursive: true });
    writeFileSync(
      join(lessonDir, "shot-language.md"),
      "Use learned experience before production: confirm shot size, camera angle, composition, and lighting before making a short drama storyboard.",
    );
    writeSkillSnapshotFixture(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "learning.enabled": true,
      "knowledgeRecall.enabled": true,
      "memory.enabled": true,
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const learned = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_DIRECTORY,
      directory: lessonDir,
      privacy: "confidential",
    });
    const candidateId = learned.snapshot.candidate.id;
    const accepted = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_ACCEPT,
      candidateId,
      note: "production context accepted",
      now: "2026-04-25T10:00:00.000Z",
    });
    const promoted = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_PROMOTE,
      candidateId,
      note: "production context promoted",
      now: "2026-04-25T10:01:00.000Z",
    });
    const packId = promoted.snapshot.knowledge.candidateId;
    await bridge.invoke({
      type: DESKTOP_ACTIONS.KNOWLEDGE_ACCEPT,
      packId,
      note: "production context knowledge accepted",
      now: "2026-04-25T10:02:00.000Z",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.KNOWLEDGE_PUBLISH,
      packId,
      note: "production context knowledge published",
      now: "2026-04-25T10:03:00.000Z",
    });

    const production = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/制作 Use learned experience to create a short drama shot planning blueprint.",
      surface: "workbench",
    });

    expect(accepted.snapshot.candidate.status).toBe("accepted");
    expect(production.productionRun).toMatchObject({
      ok: true,
      skillStatus: "hit",
      recallStatus: "hit",
      chosenAdapters: expect.arrayContaining(["director-core.internal"]),
      adapterMatches: expect.arrayContaining([
        expect.objectContaining({
          role: "asset-router",
          chosenAdapterId: expect.any(String),
          status: "matched",
          reasons: expect.arrayContaining([expect.stringContaining("Selected adapter")]),
        }),
      ]),
    });
    expect(production.productionRun.skillIds).toContain("skill.self");
    expect(production.productionRun.knowledgePackIds).toContain(packId);
    expect(typeof production.productionRun.runId).toBe("string");
    expect(production.productionRun.runId.length).toBeGreaterThan(0);
    expect(production.productionRun).toMatchObject({
      runStatus: "running",
      reportId: `report-${production.productionRun.runId}`,
      executedAssignments: expect.arrayContaining([expect.stringContaining("researcher")]),
      assignmentCounts: expect.objectContaining({
        completed: 1,
        pending: 4,
      }),
    });
    expect(production.productionRun).toMatchObject({
      draftSource: "api-provider-unavailable",
      replySource: "degraded-error",
      draftArtifact: null,
      workbenchOutput: "",
    });
    expect(production.productionRun.stageTimeline.map((stage) => stage.stageId)).toEqual([
      "intake",
      "settings",
      "memory-recall",
      "long-term-memory",
      "knowledge-recall",
      "skill-match",
      "adapter-match",
      "blueprint",
      "run-created",
      "local-preview",
      "review-gate",
    ]);
    expect(production.productionRun.stageTimeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stageId: "knowledge-recall",
          status: "hit",
          refIds: expect.arrayContaining([packId]),
        }),
        expect.objectContaining({
          stageId: "skill-match",
          status: "hit",
          refIds: expect.arrayContaining(["skill.self"]),
        }),
        expect.objectContaining({
          stageId: "adapter-match",
          status: "completed",
          refIds: expect.arrayContaining(["director-core.internal"]),
        }),
        expect.objectContaining({
          stageId: "run-created",
          status: "running",
          refIds: expect.arrayContaining([production.productionRun.runId]),
        }),
        expect.objectContaining({
          stageId: "review-gate",
          status: "pending",
          fields: expect.arrayContaining([expect.objectContaining({ label: "需人工批准" })]),
        }),
      ]),
    );
    expect(production.snapshot.activePanel).toBe("result");
    expect(production.snapshot.assets.review).toMatchObject({
      executionRunCount: 1,
      executionReportCount: 1,
    });
    expect(production.snapshot.assets.review.latestRun).toMatchObject({
      runId: production.productionRun.runId,
      blueprintId: production.productionRun.blueprintId,
      status: "running",
    });
    expect(production.snapshot.assets.review.latestRun.notes).toEqual(
      expect.arrayContaining([
        "skills=hit",
        "skill-hit=skill.self",
        expect.stringContaining(`published-pack=${packId}`),
      ]),
    );
    expect(production.events.map((event) => event.title)).toEqual(["制作任务已创建"]);

    const continued = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "继续",
      surface: "workbench",
    });

    expect(continued.runControlResult).toMatchObject({
      ok: true,
      runId: production.productionRun.runId,
      initialStatus: "running",
      runStatus: "completed",
      reportId: `report-${production.productionRun.runId}`,
      approvedAssignments: expect.arrayContaining([
        expect.stringContaining("script-planner"),
        expect.stringContaining("shot-planner"),
        expect.stringContaining("asset-router"),
      ]),
      executedAssignments: expect.arrayContaining([
        expect.stringContaining("script-planner"),
        expect.stringContaining("shot-planner"),
        expect.stringContaining("asset-router"),
        expect.stringContaining("qc-reviewer"),
      ]),
      assignmentCounts: expect.objectContaining({
        completed: 5,
        pending: 0,
      }),
      memoryIngest: expect.objectContaining({
        status: "ok",
        runId: production.productionRun.runId,
        recordId: `record-${production.productionRun.runId}`,
      }),
    });
    expect(continued.events.map((event) => event.title)).toEqual(["制作运行已推进"]);
    expect(continued.snapshot.assets.review.latestRun).toMatchObject({
      runId: production.productionRun.runId,
      status: "completed",
    });

    const heartbeat = await bridge.invoke({
      type: DESKTOP_ACTIONS.HEARTBEAT_STATUS,
      now: "2026-04-25T10:03:30.000Z",
    });

    expect(heartbeat.snapshot.assets.review.heartbeatItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "reflection-due",
          severity: "info",
          target: expect.objectContaining({
            kind: "run-report",
            runId: production.productionRun.runId,
          }),
        }),
      ]),
    );
    expect(heartbeat.snapshot.assets.review.heartbeatItems).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "care",
          summary: expect.stringContaining("no memory ingest audit"),
        }),
      ]),
    );

    const reflected = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUN_REFLECT,
      runId: production.productionRun.runId,
      now: "2026-04-25T10:04:00.000Z",
    });

    expect(reflected.reflectionResult).toMatchObject({
      runId: production.productionRun.runId,
      outcome: "success",
      suggestedExperienceIntent: "positive-experience",
      recommendedCandidateStatus: "candidate",
      learningEnabled: true,
    });
    expect(reflected.snapshot.candidate.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: reflected.reflectionResult.recommendedCandidateId,
          sourceKind: "session-trajectory",
          status: "pending",
        }),
      ]),
    );
  });

  it("executes desktop production assignments through a real http-json bridge when side effects are enabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-real-bridge-"));
    tempRoots.push(workspaceRoot);
    const requests = [];
    const bridgeServer = await startHttpJsonBridgeServer(async (request, response) => {
      const bodyText = await readRequestBody(request);
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: JSON.parse(bodyText),
      });
      response.writeHead(200, {
        "content-type": "application/json",
        "x-request-id": `bridge-${requests.length}`,
      });
      response.end(JSON.stringify({ accepted: true, requestId: `bridge-${requests.length}` }));
    });
    const previousToken = process.env.EXTERNAL_CLI_TOKEN;
    process.env.EXTERNAL_CLI_TOKEN = "bridge-secret";
    try {
      writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
        "knowledgeRecall.enabled": true,
        "execution.enabled": true,
        "execution.sideEffects.enabled": true,
      });
      writeAdapterRegistryFixture(workspaceRoot, {
        baseUrl: bridgeServer.url,
        supportedActionClasses: ["generate"],
      });

      const bridge = createDirectorDesktopBridgeFacade({
        handlers: createDirectorDesktopSystemHandlers({
          workspaceRoot,
          knowledge: directorKnowledge,
        }),
      });

      const production = await bridge.invoke({
        type: DESKTOP_ACTIONS.PRODUCTION_START,
        prompt: "生成一个15秒短剧分镜蓝图，交给真实执行适配器生成脚本和分镜",
        previewRun: false,
      });

      const continued = await bridge.invoke({
        type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
        prompt: "继续",
        surface: "workbench",
      });
      const runStore = new FileSystemRunStore({
        rootPath: join(workspaceRoot, ".director-angel", "runtime", "execution"),
      });
      const run = await runStore.loadRun(production.productionRun.runId);
      const bridgedAssignments =
        run?.assignments.filter((assignment) => assignment.result?.bridgeExecution !== undefined) ??
        [];

      expect(production.productionRun).toMatchObject({
        ok: true,
        chosenAdapters: expect.arrayContaining(["external-cli"]),
      });
      expect(run?.sideEffectsAllowed).toBe(true);
      expect(requests.length).toBeGreaterThanOrEqual(2);
      expect(requests.map((entry) => entry.url)).toEqual(expect.arrayContaining(["/v1/jobs"]));
      expect(requests.map((entry) => entry.authorization)).toEqual(
        expect.arrayContaining(["Bearer bridge-secret"]),
      );
      expect(requests.map((entry) => entry.body.schemaId)).toEqual(
        expect.arrayContaining(["director.execution.http-json-request.v1"]),
      );
      expect(requests.map((entry) => entry.body.adapterId)).toEqual(
        expect.arrayContaining(["external-cli"]),
      );
      expect(requests.map((entry) => entry.body.role)).toEqual(
        expect.arrayContaining(["script-planner", "shot-planner"]),
      );
      expect(continued.runControlResult).toMatchObject({
        ok: true,
        runId: production.productionRun.runId,
        runStatus: "completed",
        executedAssignments: expect.arrayContaining([
          expect.stringContaining("script-planner"),
          expect.stringContaining("shot-planner"),
        ]),
        reportFlags: expect.arrayContaining([
          "external-bridge-attempted",
          "external-bridge-succeeded",
        ]),
      });
      expect(bridgedAssignments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            selectedAdapter: "external-cli",
            result: expect.objectContaining({
              adapterId: "external-cli",
              notes: expect.arrayContaining(["external-bridge", "bridge:http-json"]),
            }),
          }),
        ]),
      );
    } finally {
      if (previousToken === undefined) {
        Reflect.deleteProperty(process.env, "EXTERNAL_CLI_TOKEN");
      } else {
        process.env.EXTERNAL_CLI_TOKEN = previousToken;
      }
      await bridgeServer.close();
    }
  });

  it("routes desktop production through Host API when configured", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-host-api-production-"));
    tempRoots.push(workspaceRoot);
    const calls = [];
    const hostApiFetch = vi.fn(async (url, init = {}) => {
      const path = new URL(url).pathname;
      calls.push({
        path,
        method: init.method,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (path === "/v1/client-bindings") {
        return jsonResponse({
          binding: {
            bindingId: "desktop-main",
            clientId: "desktop-main",
            channel: "desktop",
            hostId: "director-desktop",
          },
        });
      }
      if (path === "/v1/sessions") {
        return jsonResponse(
          {
            session: {
              sessionId: "session-desktop-1",
              bindingId: "desktop-main",
              peerId: "desktop-local",
            },
          },
          201,
        );
      }
      if (path === "/v1/tasks") {
        return jsonResponse(
          {
            task: {
              taskId: "run-desktop-host-api-1",
              runId: "run-desktop-host-api-1",
              sessionId: "session-desktop-1",
              status: "running",
              blueprintId: "blueprint-desktop-host-api-1",
            },
            run: createHostApiRunFixture("running"),
          },
          201,
        );
      }
      if (path === "/v1/tasks/run-desktop-host-api-1/events") {
        return textResponse(
          'event: task.status\ndata: {"taskId":"run-desktop-host-api-1","status":"running"}\n\n',
        );
      }
      if (path === "/v1/tasks/run-desktop-host-api-1") {
        return jsonResponse({
          task: {
            taskId: "run-desktop-host-api-1",
            runId: "run-desktop-host-api-1",
            sessionId: "session-desktop-1",
            status: "running",
            blueprintId: "blueprint-desktop-host-api-1",
          },
          run: createHostApiRunFixture("running"),
        });
      }
      if (path === "/v1/catalog") {
        return jsonResponse(createEmptyHostApiCatalogFixture());
      }
      throw new Error(`unexpected Host API path ${path}`);
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        hostApiUrl: "http://127.0.0.1:3201",
        hostApiFetch,
      }),
    });

    const production = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/制作 生成一个15秒短剧分镜蓝图",
      surface: "workbench",
    });

    expect(withoutCatalogCalls(calls).map((call) => `${call.method}:${call.path}`)).toEqual([
      "POST:/v1/client-bindings",
      "POST:/v1/sessions",
      "POST:/v1/tasks",
      "GET:/v1/tasks/run-desktop-host-api-1/events",
      "GET:/v1/tasks/run-desktop-host-api-1",
    ]);
    expect(withoutCatalogCalls(calls)[0].body).toMatchObject({
      bindingId: "desktop-main",
      channel: "desktop",
      agentId: "director",
      hostId: "director-desktop",
    });
    expect(withoutCatalogCalls(calls)[1].body).toMatchObject({
      bindingId: "desktop-main",
      peerId: "desktop-local",
    });
    expect(withoutCatalogCalls(calls)[2].body).toMatchObject({
      sessionId: "session-desktop-1",
      text: "生成一个15秒短剧分镜蓝图",
      start: true,
    });
    expect(production.productionRun).toMatchObject({
      ok: true,
      draftSource: "host-api",
      blueprintId: "blueprint-desktop-host-api-1",
      runId: "run-desktop-host-api-1",
      runStatus: "running",
      reportId: null,
      recallStatus: "hit",
      memoryStatus: "hit",
      longTermMemoryStatus: "hit",
      skillStatus: "hit",
      skillIds: ["skill.host-api"],
      knowledgePackIds: ["pack-host-api-1"],
    });
    expect(production.productionRun).toMatchObject({
      workbenchOutput: "",
      replySource: "structured-renderer",
    });
    expect(production.productionRun.stageTimeline.map((stage) => stage.stageId)).toEqual([
      "intake",
      "memory-recall",
      "long-term-memory",
      "knowledge-recall",
      "skill-match",
      "blueprint",
      "run-created",
      "review-gate",
    ]);
    expect(production.events[0]).toMatchObject({
      title: "制作任务已创建",
      body: expect.stringContaining("Host API http://127.0.0.1:3201"),
    });
  });

  it("routes no-start desktop production through Host API V1 tasks", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "director-desktop-host-api-production-no-start-"),
    );
    tempRoots.push(workspaceRoot);
    const calls = [];
    const hostApiFetch = vi.fn(async (url, init = {}) => {
      const path = new URL(url).pathname;
      calls.push({
        path,
        method: init.method,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (path === "/v1/client-bindings") {
        return jsonResponse({ binding: { bindingId: "desktop-main" } });
      }
      if (path === "/v1/sessions") {
        return jsonResponse(
          {
            session: {
              sessionId: "session-desktop-no-start",
              bindingId: "desktop-main",
              peerId: "desktop-local",
            },
          },
          201,
        );
      }
      if (path === "/v1/tasks") {
        return jsonResponse(
          {
            task: {
              taskId: "run-desktop-host-api-1",
              runId: "run-desktop-host-api-1",
              sessionId: "session-desktop-no-start",
              status: "created",
              blueprintId: "blueprint-desktop-host-api-1",
            },
            run: createHostApiRunFixture("created"),
          },
          201,
        );
      }
      if (path === "/v1/tasks/run-desktop-host-api-1/events") {
        return textResponse(
          'event: task.status\ndata: {"taskId":"run-desktop-host-api-1","status":"created"}\n\n',
        );
      }
      if (path === "/v1/tasks/run-desktop-host-api-1") {
        return jsonResponse({
          task: {
            taskId: "run-desktop-host-api-1",
            runId: "run-desktop-host-api-1",
            sessionId: "session-desktop-no-start",
            status: "created",
            blueprintId: "blueprint-desktop-host-api-1",
          },
          run: createHostApiRunFixture("created"),
        });
      }
      if (path === "/v1/catalog") {
        return jsonResponse(createEmptyHostApiCatalogFixture());
      }
      throw new Error(`unexpected Host API path ${path}`);
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        hostApiUrl: "http://127.0.0.1:3201",
        hostApiFetch,
      }),
    });

    const production = await bridge.invoke({
      type: DESKTOP_ACTIONS.PRODUCTION_START,
      prompt: "生成一个15秒短剧分镜蓝图",
      createRun: false,
    });

    const writeCalls = withoutCatalogCalls(calls);
    expect(writeCalls.map((call) => `${call.method}:${call.path}`)).toEqual([
      "POST:/v1/client-bindings",
      "POST:/v1/sessions",
      "POST:/v1/tasks",
      "GET:/v1/tasks/run-desktop-host-api-1/events",
      "GET:/v1/tasks/run-desktop-host-api-1",
    ]);
    expect(writeCalls.map((call) => call.path)).not.toContain(
      "/v1/sessions/session-desktop-no-start/messages",
    );
    expect(writeCalls[2].body).toMatchObject({
      sessionId: "session-desktop-no-start",
      text: "生成一个15秒短剧分镜蓝图",
      start: false,
    });
    expect(production.productionRun).toMatchObject({
      ok: true,
      draftSource: "host-api",
      taskId: "run-desktop-host-api-1",
      runId: "run-desktop-host-api-1",
      runStatus: "created",
    });
  });

  it("routes desktop run review controls through Host API when configured", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-host-api-run-controls-"));
    tempRoots.push(workspaceRoot);
    const calls = [];
    const hostApiFetch = vi.fn(async (url, init = {}) => {
      const path = new URL(url).pathname;
      calls.push({
        path,
        method: init.method,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (path === "/v1/runs/run-desktop-host-api-1") {
        return jsonResponse(createHostApiRunFixture("running"));
      }
      if (path === "/v1/runs/run-desktop-host-api-1/approve") {
        return jsonResponse(createHostApiRunFixture("running"));
      }
      if (path === "/v1/runs/run-desktop-host-api-1/start") {
        return jsonResponse(createHostApiRunFixture("running"));
      }
      if (path === "/v1/runs/run-desktop-host-api-1/report") {
        return jsonResponse(createHostApiReportFixture("running"));
      }
      if (path === "/v1/catalog") {
        return jsonResponse({
          ...createEmptyHostApiCatalogFixture(),
          executionItems: [createHostApiRunFixture("running")],
          executionReportItems: [createHostApiReportFixture("running")],
          latestRun: createHostApiRunFixture("running"),
          latestReport: createHostApiReportFixture("running"),
        });
      }
      throw new Error(`unexpected Host API path ${path}`);
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        hostApiUrl: "http://127.0.0.1:3201",
        hostApiFetch,
      }),
    });

    const approvedOne = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUN_APPROVE_ASSIGNMENT,
      runId: "run-desktop-host-api-1",
      assignmentId: "assignment-script",
    });
    const approvedAll = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUN_APPROVE_PENDING_ASSIGNMENTS,
      runId: "run-desktop-host-api-1",
    });
    const continued = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUN_CONTINUE,
      runId: "run-desktop-host-api-1",
    });

    const writeCalls = withoutCatalogCalls(calls);
    expect(writeCalls.map((call) => `${call.method}:${call.path}`)).toEqual([
      "POST:/v1/runs/run-desktop-host-api-1/approve",
      "GET:/v1/runs/run-desktop-host-api-1/report",
      "GET:/v1/runs/run-desktop-host-api-1",
      "POST:/v1/runs/run-desktop-host-api-1/approve",
      "GET:/v1/runs/run-desktop-host-api-1/report",
      "GET:/v1/runs/run-desktop-host-api-1",
      "POST:/v1/runs/run-desktop-host-api-1/approve",
      "GET:/v1/runs/run-desktop-host-api-1/report",
    ]);
    expect(writeCalls[0].body).toEqual({ assignmentId: "assignment-script" });
    expect(writeCalls[3].body).toEqual({ assignmentId: "assignment-script" });
    expect(approvedOne.events[0]).toMatchObject({
      title: "Assignment 已批准",
      body: expect.stringContaining("assignment assignment-script"),
    });
    expect(approvedAll.events[0]).toMatchObject({
      title: "待审任务已批准",
      body: expect.stringContaining("已批准 1 个"),
    });
    expect(continued.runControlResult).toMatchObject({
      source: "host-api",
      runId: "run-desktop-host-api-1",
      initialStatus: "running",
      runStatus: "running",
      reportId: "report-run-desktop-host-api-1",
      approvedAssignments: ["assignment-script"],
    });
    expect(continued.snapshot.assets.review.latestRun).toMatchObject({
      runId: "run-desktop-host-api-1",
      status: "running",
    });
    expect(continued.snapshot.assets.review.latestReport).toMatchObject({
      runId: "run-desktop-host-api-1",
      reportId: "report-run-desktop-host-api-1",
    });
  });

  it("routes desktop run slash and detail commands through Host API when configured", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-host-api-run-command-"));
    tempRoots.push(workspaceRoot);
    const calls = [];
    const hostApiFetch = vi.fn(async (url, init = {}) => {
      const path = new URL(url).pathname;
      calls.push({
        path,
        method: init.method,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (path === "/v1/runs/run-desktop-host-api-1/report") {
        return jsonResponse(createHostApiReportFixture("running"));
      }
      if (path === "/v1/runs/run-desktop-host-api-1/delegations") {
        return jsonResponse(createHostApiDelegationsFixture("running"));
      }
      if (path === "/v1/runs/run-desktop-host-api-1/scheduler-executor") {
        return jsonResponse({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.run-scheduler-executor.v1",
          runId: "run-desktop-host-api-1",
          schedulerExecutor: {
            status: "ok",
            sessionId: "run-desktop-host-api-1",
            executorMode: "bounded-local",
            startupReconciliation: {
              reconciledDelegationIds: [
                "delegation_run_desktop_host_api_1_stale_running",
              ],
              runningDelegationTargetStatus: "failed",
            },
            maxDispatches: 1,
            executedCount: 1,
            stoppedReason: "max-dispatches",
            dispatchReports: [
              {
                status: "ok",
                workerId: "director-script-planner",
                delegationId: "delegation_run_desktop_host_api_1_assignment_script",
                finalDelegationStatus: "completed",
                subagentRun: {
                  subagentId: "delegation_run_desktop_host_api_1_assignment_script",
                  instruction: "Role: script-planner\nObjective: Plan the script.",
                  parentVisibleResult: {
                    status: "completed",
                    summary: "Host API worker completed the script plan.",
                  },
                },
              },
            ],
          },
          runDelegations: {
            ...createHostApiDelegationsFixture("running"),
            pendingDelegationCount: 0,
            completedDelegationCount: 1,
            completedSubagentRunCount: 1,
            subagentRunCount: 1,
            delegations: createHostApiDelegationsFixture("running").delegations.map((record) => ({
              ...record,
              status: "completed",
              resultSummary: "Host API worker completed the script plan.",
            })),
          },
        });
      }
      if (path === "/v1/runs/run-desktop-host-api-1/scheduler-recovery") {
        return jsonResponse({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.run-scheduler-recovery.v1",
          runId: "run-desktop-host-api-1",
          schedulerRecovery: {
            status: "ok",
            sessionId: "run-desktop-host-api-1",
            workflowMode: "bounded-local-recovery",
            startupReconciliation: {
              reconciledDelegationIds: [
                "delegation_run_desktop_host_api_1_stale_recovery",
              ],
              runningDelegationTargetStatus: "failed",
            },
            dryRun: true,
            selectedActionIds: ["recover_delegation_observed_drift"],
            cancelledDelegationIds: [],
            actionResults: [
              {
                actionId: "recover_delegation_observed_drift",
                subagentId: "delegation_observed_drift",
                actionType: "review-observed-write-set",
                result: "requires-confirmation",
                mutation: "none",
                confirmationRequired: true,
                queuedDelegationIds: ["delegation_observed_drift"],
                cancelledDelegationIds: [],
                operatorSummary: "Review observed write-set drift before dispatching.",
              },
            ],
            safety: {
              remoteWriteExecutionAllowed: false,
              destructiveActionsRequireConfirmation: true,
              processRunnerAllowed: false,
            },
          },
          runDelegations: createHostApiDelegationsFixture("running"),
        });
      }
      if (path === "/v1/runs/run-desktop-host-api-1/retry") {
        return jsonResponse(createHostApiRunFixture("running"));
      }
      if (path === "/v1/runs/run-desktop-host-api-1/reroute") {
        return jsonResponse(createHostApiRunFixture("running"));
      }
      if (path === "/v1/runs/run-desktop-host-api-1/pause") {
        return jsonResponse(createHostApiRunFixture("paused"));
      }
      if (path === "/v1/memory/status") {
        return jsonResponse({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.memory-status.v1",
          enabled: true,
          status: "ok",
          runtimeMemory: {
            enabled: true,
            memoryRoot: "/tmp/workspace/.director-angel/runtime/memory",
            storeStatus: "ok",
            recordCount: 2,
            latestRecord: {
              recordId: "memory-1",
              projectId: "project-1",
              groupId: "group-1",
            },
          },
          longTerm: {
            enabled: true,
            status: "hit",
            files: [
              {
                file: "MEMORY.md",
                exists: true,
                entryCount: 1,
                budget: { maxChars: 2200, usedChars: 64, remainingChars: 2136 },
                preview: ["项目记忆：开场保留连续性锚点。"],
              },
            ],
            signals: [{ id: "long-term-memory:memory" }],
            notes: ["Loaded 1 compact long-term memory signal(s)."],
          },
        });
      }
      if (path === "/v1/memory/publications") {
        return jsonResponse({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.memory-publications.v1",
          count: 1,
          totalMatching: 1,
          items: [
            {
              recordId: "memory-1",
              candidateId: "candidate-memory-1",
              publishedAt: "2026-04-12T12:01:00.000Z",
              governanceStatus: "demoted",
              evidenceRefs: [
                {
                  evidenceId: "tool-evidence-run-memory-1-browser-read",
                  sourceRef: "tool://browser_read/browser-read",
                },
              ],
              text: "已降权：memory-1",
            },
          ],
        });
      }
      if (path === "/v1/memory/publications/memory-1/demote") {
        return jsonResponse({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.memory-publication-governance.v1",
          action: "demote",
          recordId: "memory-1",
          result: { status: "ok", recordId: "memory-1", governanceStatus: "demoted" },
          text: "已降权记忆：memory-1，当前状态：demoted",
        });
      }
      if (path === "/v1/evidence") {
        const params = new URL(url).searchParams;
        expect(params.get("runId")).toBe("run-memory-1");
        expect(params.get("limit")).toBe("5");
        return jsonResponse({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.evidence-list.v1",
          count: 1,
          totalMatching: 1,
          items: [
            {
              evidenceId: "tool-evidence-run-memory-1-browser-read",
              kind: "tool-result",
              sourceKind: "tool-result",
              sourceRef: "tool://browser_read/browser-read",
              sourceAccessStatus: "available",
              publishable: false,
              privacy: "private",
              observedAtMs: 1_776_000_075_000,
              preview: "浏览器读取结果保留为 evidence。",
              contentLength: 16,
              evidenceRefs: ["run-memory-1"],
              metadata: { runId: "run-memory-1" },
            },
          ],
        });
      }
      if (path === "/v1/evidence/tool-evidence-run-memory-1-browser-read") {
        return jsonResponse({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.evidence-detail.v1",
          evidence: {
            evidenceId: "tool-evidence-run-memory-1-browser-read",
            sourceRef: "tool://browser_read/browser-read",
            sourceAccessStatus: "available",
            preview: "浏览器读取结果保留为 evidence。",
            contentLength: 16,
            metadata: { runId: "run-memory-1" },
          },
        });
      }
      if (path === "/v1/evidence/tool-evidence-run-memory-1-browser-read/content") {
        return jsonResponse({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.evidence-content.v1",
          evidenceId: "tool-evidence-run-memory-1-browser-read",
          sourceRef: "tool://browser_read/browser-read",
          content: "浏览器读取结果全文。",
          truncated: false,
          contentLength: 10,
          privacy: "private",
        });
      }
      if (path === "/v1/memory/recall-preview") {
        return jsonResponse({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.memory-recall-preview.v1",
          enabled: true,
          runtimeMemory: {
            storeStatus: "ok",
            recordCount: 2,
          },
          packet: {
            schemaVersion: "director.memory.recall-packet.v1",
            queryId: "recall-test",
            status: "ok",
            recordedAt: "2026-04-12T12:00:00.000Z",
            notes: ["1 hit(s) returned."],
            hits: [
              {
                recordId: "memory-1",
                digestId: "digest-memory-1",
                projectId: "project-1",
                groupId: "group-1",
                anchorIds: ["anchor-a"],
                selectedAdapters: ["director-core.internal"],
                status: "completed",
                recordedAt: "2026-04-12T12:00:00.000Z",
                score: 12,
                reasons: ["same project"],
                summary: "复用连续性锚点。",
                provenance: {
                  runId: "run-memory-1",
                  reportId: "report-memory-1",
                  observationIds: [],
                },
              },
            ],
            query: {
              projectId: "project-1",
              groupId: "group-1",
              maxHits: 2,
            },
            truncated: false,
          },
        });
      }
      if (path === "/v1/catalog") {
        return jsonResponse({
          ...createEmptyHostApiCatalogFixture(),
          executionItems: [createHostApiRunFixture("running")],
          executionReportItems: [createHostApiReportFixture("running")],
        });
      }
      throw new Error(`unexpected Host API path ${path}`);
    });
    const runCliCommand = vi.fn(async (argv) => ({ argv, exitCode: 0, stdout: "", stderr: "" }));

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        runCliCommand,
        hostApiUrl: "http://127.0.0.1:3201",
        hostApiFetch,
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMMAND_RUN,
      commandId: "run.report",
      args: { runId: "run-desktop-host-api-1" },
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMMAND_RUN,
      commandId: "run.delegations",
      args: { runId: "run-desktop-host-api-1" },
    });
    const schedulerExecuted = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUN_SCHEDULER_EXECUTOR,
      runId: "run-desktop-host-api-1",
      maxDispatches: 1,
    });
    const schedulerRecovery = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMMAND_RUN,
      commandId: "run.schedulerRecovery",
      args: { runId: "run-desktop-host-api-1" },
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMMAND_RUN,
      commandId: "run.retry",
      args: { runId: "run-desktop-host-api-1", assignmentId: "assignment-script" },
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMMAND_RUN,
      commandId: "run.reroute",
      args: {
        runId: "run-desktop-host-api-1",
        assignmentId: "assignment-script",
        adapterId: "director-core.internal",
      },
    });
    const paused = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMMAND_RUN,
      commandId: "run.pause",
      args: { runId: "run-desktop-host-api-1" },
    });
    const memoryStatus = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMMAND_RUN,
      commandId: "memory.status",
      args: {},
    });
    const memoryRecall = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMMAND_RUN,
      commandId: "memory.recallPreview",
      args: { projectId: "project-1", groupId: "group-1", maxHits: "2" },
    });
    const memoryPublications = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMMAND_RUN,
      commandId: "memory.publications",
      args: {},
    });
    const memoryDemote = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMMAND_RUN,
      commandId: "memory.publicationDemote",
      args: {
        recordId: "memory-1",
        note: "来源有用但置信度偏低",
        now: "2026-04-12T12:02:00.000Z",
      },
    });
    const evidenceList = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMMAND_RUN,
      commandId: "evidence.list",
      args: { runId: "run-memory-1", limit: "5" },
    });
    const evidenceDetail = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMMAND_RUN,
      commandId: "evidence.view",
      args: { evidenceId: "tool-evidence-run-memory-1-browser-read" },
    });
    const evidenceContent = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMMAND_RUN,
      commandId: "evidence.content",
      args: { evidenceId: "tool-evidence-run-memory-1-browser-read", maxChars: "20" },
    });

    expect(runCliCommand).not.toHaveBeenCalled();
    const writeCalls = withoutCatalogCalls(calls);
    expect(writeCalls.map((call) => `${call.method}:${call.path}`)).toEqual([
      "GET:/v1/runs/run-desktop-host-api-1/report",
      "GET:/v1/runs/run-desktop-host-api-1/delegations",
      "POST:/v1/runs/run-desktop-host-api-1/scheduler-executor",
      "POST:/v1/runs/run-desktop-host-api-1/scheduler-recovery",
      "POST:/v1/runs/run-desktop-host-api-1/retry",
      "POST:/v1/runs/run-desktop-host-api-1/reroute",
      "POST:/v1/runs/run-desktop-host-api-1/pause",
      "GET:/v1/memory/status",
      "POST:/v1/memory/recall-preview",
      "GET:/v1/memory/publications",
      "POST:/v1/memory/publications/memory-1/demote",
      "GET:/v1/evidence",
      "GET:/v1/evidence/tool-evidence-run-memory-1-browser-read",
      "GET:/v1/evidence/tool-evidence-run-memory-1-browser-read/content",
    ]);
    expect(writeCalls[2].body).toEqual({ maxDispatches: 1 });
    expect(writeCalls[3].body).toEqual({});
    expect(writeCalls[4].body).toEqual({ assignmentId: "assignment-script" });
    expect(writeCalls[5].body).toEqual({
      assignmentId: "assignment-script",
      adapterId: "director-core.internal",
    });
    expect(schedulerExecuted.runSchedulerExecutor).toMatchObject({
      status: "ok",
      sessionId: "run-desktop-host-api-1",
      executedCount: 1,
    });
    expect(schedulerExecuted.runDelegations).toMatchObject({
      completedDelegationCount: 1,
      pendingDelegationCount: 0,
    });
    expect(schedulerExecuted.events.at(-1)).toMatchObject({
      title: "后台子代理已执行",
      body: expect.stringContaining("本次执行 1 个"),
    });
    expect(schedulerExecuted.events.at(-1).body).toContain("已清理假运行 1 个");
    expect(schedulerRecovery.commandResult).toMatchObject({
      status: "completed",
      handlerType: "hostApiRunCommand",
      command: { id: "run.schedulerRecovery" },
    });
    expect(schedulerRecovery.events.at(-1)).toMatchObject({
      title: "后台恢复检查",
      body: expect.stringContaining("恢复 dry-run"),
    });
    expect(schedulerRecovery.events.at(-1).body).toContain("已清理假运行 1 个");
    expect(paused.commandResult).toMatchObject({
      status: "completed",
      handlerType: "hostApiRunCommand",
      command: { id: "run.pause" },
    });
    expect(paused.events.at(-1)).toMatchObject({
      title: "暂停 run",
      body: expect.stringContaining("run-desktop-host-api-1"),
    });
    expect(memoryStatus.commandResult).toMatchObject({
      status: "completed",
      handlerType: "hostApiRunCommand",
      command: { id: "memory.status" },
    });
    expect(memoryStatus.events.at(-1)).toMatchObject({
      title: "记忆状态",
      body: expect.stringContaining("运行记忆 ok"),
    });
    expect(memoryStatus.events.at(-1).body).toContain("记录 2 条");
    expect(memoryStatus.events.at(-1).body).toContain("长期记忆 hit");
    expect(memoryStatus.events.at(-1).body).toContain("MEMORY.md 1 条");
    expect(memoryRecall.commandResult).toMatchObject({
      status: "completed",
      handlerType: "hostApiRunCommand",
      command: { id: "memory.recallPreview" },
    });
    expect(memoryRecall.events.at(-1)).toMatchObject({
      title: "记忆召回预览",
      body: expect.stringContaining("命中 1 条"),
    });
    expect(memoryRecall.events.at(-1).body).toContain("memory-1");
    expect(memoryPublications.events.at(-1)).toMatchObject({
      title: "记忆发布列表",
      body: expect.stringContaining("记忆发布 1 条"),
    });
    expect(memoryPublications.events.at(-1).body).toContain("已降权 1 条");
    expect(memoryDemote.events.at(-1)).toMatchObject({
      title: "记忆降权",
      body: expect.stringContaining("已降权记忆：memory-1"),
    });
    expect(evidenceList.events.at(-1)).toMatchObject({
      title: "Evidence 列表",
      body: expect.stringContaining("evidence 1 条"),
    });
    expect(evidenceDetail.events.at(-1)).toMatchObject({
      title: "查看 Evidence",
      body: expect.stringContaining("tool-evidence-run-memory-1-browser-read"),
    });
    expect(evidenceContent.events.at(-1)).toMatchObject({
      title: "Evidence 原文",
      body: expect.stringContaining("浏览器读取结果全文"),
    });
  });

  it("routes desktop directory, query, URL, and text learning through Host API when configured", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-host-api-learning-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "learning.enabled": true,
    });
    const calls = [];
    const hostApiFetch = vi.fn(async (url, init = {}) => {
      const path = new URL(url).pathname;
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({
        path,
        method: init.method,
        body,
      });
      if (path === "/v1/learning/jobs") {
        return jsonResponse(
          {
            job: {
              jobId: `job-${body.kind}`,
              kind: body.kind,
              status: "created",
            },
          },
          201,
        );
      }
      if (path === "/v1/learning/jobs/job-directory/run") {
        return jsonResponse({
          job: { jobId: "job-directory", kind: "directory", status: "succeeded" },
          result: {
            candidates: [{ candidateId: "candidate-directory-1" }],
            quarantineCount: 0,
          },
        });
      }
      if (path === "/v1/learning/jobs/job-query/run") {
        return jsonResponse({
          job: { jobId: "job-query", kind: "query", status: "succeeded" },
          result: {
            candidates: [{ candidateId: "candidate-query-1" }],
            quarantineCount: 0,
          },
        });
      }
      if (path === "/v1/learning/jobs/job-text/run") {
        return jsonResponse({
          job: { jobId: "job-text", kind: "text", status: "succeeded" },
          result: {
            candidates: [{ candidateId: "candidate-text-1" }],
            quarantineCount: 0,
          },
        });
      }
      if (path === "/v1/catalog") {
        return jsonResponse(createEmptyHostApiCatalogFixture());
      }
      throw new Error(`unexpected Host API path ${path}`);
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        hostApiUrl: "http://127.0.0.1:3201",
        hostApiFetch,
        experienceFetchText: async (url) => ({
          url,
          contentType: "text/plain; charset=utf-8",
          body: [
            "导演经验网页正文：先确认镜头目的，再安排景别、角度、构图和运镜。",
            "这段正文来自用户给出的具体 URL，系统必须先读取原链接，再把可信正文交给文本学习入口。",
            "学习链路要保留来源、标题、正文和证据编号，后续审核通过后才能进入长期经验。",
          ].join("\n"),
        }),
      }),
    });

    const directory = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_DIRECTORY,
      directory: "/tmp/reference-lessons",
      privacy: "confidential",
      maxDepth: 2,
    });
    const query = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_QUERY,
      query: "短剧 镜头语言",
      privacy: "public",
      maxResultsPerQuery: 2,
    });
    const url = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
      url: "https://example.com/director-lesson",
      privacy: "public",
    });
    const text = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_TEXT,
      text: "镜头语言经验：先定义景别、角度和运镜。",
      title: "镜头语言经验",
      privacy: "internal",
    });

    const writeCalls = withoutCatalogCalls(calls);
    expect(writeCalls.map((call) => `${call.method}:${call.path}`)).toEqual([
      "POST:/v1/learning/jobs",
      "POST:/v1/learning/jobs/job-directory/run",
      "POST:/v1/learning/jobs",
      "POST:/v1/learning/jobs/job-query/run",
      "POST:/v1/learning/jobs",
      "POST:/v1/learning/jobs/job-text/run",
      "POST:/v1/learning/jobs",
      "POST:/v1/learning/jobs/job-text/run",
    ]);
    expect(writeCalls[0].body).toMatchObject({
      kind: "directory",
      directory: "/tmp/reference-lessons",
      privacy: "confidential",
      maxDepth: 2,
    });
    expect(writeCalls[2].body).toMatchObject({
      kind: "query",
      queries: ["短剧 镜头语言"],
      privacy: "public",
      maxResultsPerQuery: 2,
    });
    expect(writeCalls[4].body).toMatchObject({
      kind: "text",
      texts: [
        expect.objectContaining({
          sourceRef: "https://example.com/director-lesson",
        }),
      ],
      privacy: "public",
    });
    expect(writeCalls[6].body).toMatchObject({
      kind: "text",
      texts: [
        {
          title: "镜头语言经验",
          content: "镜头语言经验：先定义景别、角度和运镜。",
        },
      ],
      privacy: "internal",
    });
    expect(directory.events[0].body).toContain("这个目录我整理过了");
    expect(directory.events[0].body).toContain("candidate-directory-1");
    expect(directory.events[0].body).not.toContain("Desktop learning result:");
    expect(directory.events[0].body).not.toContain("已生成 1 条经验候选");
    expect(query.events[0].body).toContain("这轮学习我整理好了");
    expect(query.events[0].body).toContain("candidate-query-1");
    expect(url.events[0].body).toContain("candidate-text-1");
    expect(text.events[0].body).toContain("candidate-text-1");
  });

  it("routes desktop review, publish, and Skill proposal writes through Host API when configured", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-host-api-review-"));
    tempRoots.push(workspaceRoot);
    const calls = [];
    const hostApiFetch = vi.fn(async (url, init = {}) => {
      const path = new URL(url).pathname;
      calls.push({
        path,
        method: init.method,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (path === "/v1/experience/candidates/candidate-1/accept") {
        return jsonResponse({ candidate: { candidateId: "candidate-1" } });
      }
      if (path === "/v1/experience/candidates/candidate-1/promote") {
        return jsonResponse({ knowledgeCandidate: { metadata: { id: "pack-1" } } });
      }
      if (path === "/v1/knowledge/candidates/pack-1/accept") {
        return jsonResponse({ candidate: { metadata: { id: "pack-1" } } });
      }
      if (path === "/v1/knowledge/candidates/pack-1/publish") {
        return jsonResponse({ published: { metadata: { id: "pack-1" } } });
      }
      if (path === "/v1/skills/proposals/from-experience") {
        return jsonResponse({ proposalId: "proposal-1" }, 201);
      }
      if (path === "/v1/skills/proposals/proposal-1/accept") {
        return jsonResponse({ proposal: { id: "proposal-1", status: "accepted" } });
      }
      if (path === "/v1/skills/proposals/proposal-2/reject") {
        return jsonResponse({ proposal: { id: "proposal-2", status: "rejected" } });
      }
      if (path === "/v1/skills/proposals/proposal-1/apply") {
        return jsonResponse({ skillId: "skill-1", snapshotVersion: 3 });
      }
      if (path === "/v1/catalog") {
        return jsonResponse(createEmptyHostApiCatalogFixture());
      }
      throw new Error(`unexpected Host API path ${path}`);
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        hostApiUrl: "http://127.0.0.1:3201",
        hostApiFetch,
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_ACCEPT,
      candidateId: "candidate-1",
      note: "accept it",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_PROMOTE,
      candidateId: "candidate-1",
      note: "promote it",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.KNOWLEDGE_ACCEPT,
      packId: "pack-1",
      note: "accept pack",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.KNOWLEDGE_PUBLISH,
      packId: "pack-1",
      note: "publish pack",
    });
    const proposed = await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_PROPOSE_FROM_EXPERIENCE,
      candidateId: "candidate-1",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_PROPOSAL_ACCEPT,
      proposalId: "proposal-1",
      note: "accept skill",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_PROPOSAL_REJECT,
      proposalId: "proposal-2",
      note: "reject skill",
    });
    const applied = await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_PROPOSAL_APPLY,
      proposalId: "proposal-1",
      note: "apply skill",
    });

    const writeCalls = withoutCatalogCalls(calls);
    expect(writeCalls.map((call) => `${call.method}:${call.path}`)).toEqual([
      "POST:/v1/experience/candidates/candidate-1/accept",
      "POST:/v1/experience/candidates/candidate-1/promote",
      "POST:/v1/knowledge/candidates/pack-1/accept",
      "POST:/v1/knowledge/candidates/pack-1/publish",
      "POST:/v1/skills/proposals/from-experience",
      "POST:/v1/skills/proposals/proposal-1/accept",
      "POST:/v1/skills/proposals/proposal-2/reject",
      "POST:/v1/skills/proposals/proposal-1/apply",
    ]);
    expect(writeCalls[0].body).toMatchObject({ actor: "director-desktop", note: "accept it" });
    expect(writeCalls[4].body).toMatchObject({
      candidateId: "candidate-1",
      author: "director-desktop",
    });
    expect(writeCalls[7].body).toMatchObject({ actor: "director-desktop", note: "apply skill" });
    expect(proposed.events[0].body).toContain("proposal-1");
    expect(applied.events[0].body).toContain("skill-1");
    expect(applied.events[0].body).toContain("v3");
  });

  it("routes desktop experience and Skill taxonomy writes through Host API when configured", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-host-api-taxonomy-"));
    tempRoots.push(workspaceRoot);
    const calls = [];
    const hostApiFetch = vi.fn(async (url, init = {}) => {
      const path = new URL(url).pathname;
      calls.push({
        path,
        method: init.method,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (path === "/v1/experience/categories") {
        return jsonResponse(
          {
            category: { categoryId: "director-shot", name: "导演镜头" },
          },
          201,
        );
      }
      if (path === "/v1/experience/tags") {
        return jsonResponse({ tag: { tagId: "shot-size", name: "景别" } }, 201);
      }
      if (path === "/v1/experience/candidates/candidate-1/taxonomy") {
        return jsonResponse({
          binding: {
            candidateId: "candidate-1",
            categoryId: "director-shot",
            tagIds: ["shot-size"],
          },
        });
      }
      if (path === "/v1/skills/taxonomy/categories") {
        return jsonResponse(
          {
            category: { categoryId: "director-production", name: "导演制作" },
          },
          201,
        );
      }
      if (path === "/v1/skills/taxonomy/tags") {
        return jsonResponse({ tag: { tagId: "shot-language", name: "镜头语言" } }, 201);
      }
      if (path === "/v1/skills/skill.backend-snapshot/taxonomy") {
        return jsonResponse({
          binding: {
            skillId: "skill.backend-snapshot",
            categoryId: "director-production",
            tagIds: ["shot-language"],
          },
        });
      }
      if (path === "/v1/catalog") {
        return jsonResponse(createEmptyHostApiCatalogFixture());
      }
      throw new Error(`unexpected Host API path ${path}`);
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        hostApiUrl: "http://127.0.0.1:3201",
        hostApiFetch,
      }),
    });

    const experienceCategory = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_CATEGORY_CREATE,
      categoryId: "director-shot",
      name: "导演镜头",
    });
    const experienceTag = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_TAG_CREATE,
      tagId: "shot-size",
      name: "景别",
    });
    const experienceClassified = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_CLASSIFICATION_SAVE,
      candidateId: "candidate-1",
      categoryId: "director-shot",
      tagIds: ["shot-size"],
    });
    const skillCategory = await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_CATEGORY_CREATE,
      categoryId: "director-production",
      name: "导演制作",
    });
    const skillTag = await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_TAG_CREATE,
      tagId: "shot-language",
      name: "镜头语言",
    });
    const skillClassified = await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_CLASSIFICATION_SAVE,
      skillId: "skill.backend-snapshot",
      categoryId: "director-production",
      tagIds: ["shot-language"],
    });

    const writeCalls = withoutCatalogCalls(calls);
    expect(writeCalls.map((call) => `${call.method}:${call.path}`)).toEqual([
      "POST:/v1/experience/categories",
      "POST:/v1/experience/tags",
      "POST:/v1/experience/candidates/candidate-1/taxonomy",
      "POST:/v1/skills/taxonomy/categories",
      "POST:/v1/skills/taxonomy/tags",
      "POST:/v1/skills/skill.backend-snapshot/taxonomy",
    ]);
    expect(writeCalls[2].body).toMatchObject({
      categoryId: "director-shot",
      tagIds: ["shot-size"],
      updatedBy: "director-desktop",
    });
    expect(writeCalls[5].body).toMatchObject({
      categoryId: "director-production",
      tagIds: ["shot-language"],
      updatedBy: "director-desktop",
    });
    expect(experienceCategory.events[0].body).toContain("director-shot");
    expect(experienceTag.events[0].body).toContain("shot-size");
    expect(experienceClassified.events[0].body).toContain("candidate-1");
    expect(skillCategory.events[0].body).toContain("director-production");
    expect(skillTag.events[0].body).toContain("shot-language");
    expect(skillClassified.events[0].body).toContain("skill.backend-snapshot");
  });

  it("routes Skill management actions through the Host API when configured", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "director-desktop-host-api-skill-management-"),
    );
    tempRoots.push(workspaceRoot);
    const calls = [];
    const hostApiFetch = vi.fn(async (url, init = {}) => {
      const path = new URL(url).pathname;
      calls.push({
        path,
        method: init.method,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (path === "/v1/skills/skill.external/enabled") {
        return jsonResponse({
          skill: { id: "skill.external", enabled: false },
        });
      }
      if (path === "/v1/skills/skill.external" && init.method === "PATCH") {
        return jsonResponse({
          skill: { id: "skill.external", title: "外部制作 Skill", enabled: false },
          snapshot: { version: 2 },
        });
      }
      if (path === "/v1/skills/skill.external" && init.method === "DELETE") {
        return jsonResponse({
          deletedSkillId: "skill.external",
          snapshot: { version: 3 },
        });
      }
      if (path === "/v1/catalog") {
        return jsonResponse(createEmptyHostApiCatalogFixture());
      }
      throw new Error(`unexpected Host API path ${path}`);
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        hostApiUrl: "http://127.0.0.1:3201",
        hostApiFetch,
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_ENABLEMENT_SET,
      skillId: "skill.external",
      enabled: false,
      note: "pause external import",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_UPDATE,
      skillId: "skill.external",
      title: "外部制作 Skill",
      description: "中文简介",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_DELETE,
      skillId: "skill.external",
      note: "remove obsolete external skill",
    });

    const writeCalls = withoutCatalogCalls(calls);
    expect(writeCalls.map((call) => `${call.method}:${call.path}`)).toEqual([
      "PUT:/v1/skills/skill.external/enabled",
      "PATCH:/v1/skills/skill.external",
      "DELETE:/v1/skills/skill.external",
    ]);
    expect(writeCalls[0].body).toMatchObject({
      enabled: false,
      actor: "director-desktop",
      note: "pause external import",
    });
    expect(writeCalls[1].body).toMatchObject({
      title: "外部制作 Skill",
      description: "中文简介",
      actor: "director-desktop",
    });
    expect(writeCalls[2].body).toMatchObject({
      actor: "director-desktop",
      note: "remove obsolete external skill",
    });
  });

  it("hydrates desktop experience, knowledge, and Skill assets from Host API catalog when configured", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-host-api-catalog-"));
    tempRoots.push(workspaceRoot);
    const candidate = createExperienceCandidateFixture({
      candidateId: "candidate-host-catalog-1",
      title: "Host API 经验",
      evidencePreview: "Host API catalog should drive the visible experience list.",
      quality: {
        score: 91,
        verdict: "usable",
        reasons: ["readable source content captured"],
        metrics: {},
      },
    });
    const skill = {
      id: "skill.host-catalog",
      version: "1.0.0",
      title: "Host Catalog Skill",
      content: "Use Host API catalog as the source of truth for desktop assets.",
      updatedAtMs: 1_776_000_090_000,
      tags: ["host-catalog"],
    };
    const catalog = {
      apiVersion: "director-host-api.v1",
      schemaId: "director.host.catalog.v1",
      experienceCandidateInspections: [
        {
          candidate,
          status: "accepted",
          latestReview: null,
          promotions: [],
          latestPromotion: null,
          promoted: false,
          taxonomy: {
            candidateId: candidate.candidateId,
            categoryId: "director-shot",
            tagIds: ["shot-size"],
            updatedAtMs: 1_776_000_090_000,
          },
        },
      ],
      experienceArtifacts: [],
      experienceQuarantines: [],
      experienceTaxonomy: {
        schemaVersion: "director.experience.taxonomy.v1",
        categories: [
          {
            categoryId: "director-shot",
            name: "导演镜头",
            createdAtMs: 0,
            updatedAtMs: 0,
          },
        ],
        tags: [{ tagId: "shot-size", name: "景别", createdAtMs: 0, updatedAtMs: 0 }],
        candidates: [],
      },
      knowledgePacks: [createKnowledgePackDocumentFixture("pack-host-catalog")],
      knowledgeCandidateInspections: [
        {
          candidate: createKnowledgeCandidateDocumentFixture("pack-host-candidate"),
          status: "pending",
          latestReview: null,
        },
      ],
      skills: [skill],
      skillTaxonomy: {
        schemaVersion: "skills.taxonomy.v1",
        categories: [
          {
            categoryId: "workflow",
            name: "Workflow",
            createdAtMs: 0,
            updatedAtMs: 0,
          },
        ],
        tags: [
          {
            tagId: "host-catalog",
            name: "Host Catalog",
            createdAtMs: 0,
            updatedAtMs: 0,
          },
        ],
        skills: [
          {
            skillId: "skill.host-catalog",
            categoryId: "workflow",
            tagIds: ["host-catalog"],
            updatedAtMs: 1_776_000_090_000,
          },
        ],
      },
      skillProposals: [
        {
          id: "proposal-host-catalog",
          status: "pending",
          skillId: "skill.host-catalog-next",
          title: "Host Catalog Proposal",
        },
      ],
    };
    const hostApiFetch = vi.fn(async (url) => {
      const path = new URL(url).pathname;
      if (path === "/v1/catalog") {
        return jsonResponse(catalog);
      }
      throw new Error(`unexpected Host API path ${path}`);
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          experience: {
            total: 0,
            candidates: [],
            artifactTotal: 0,
            quarantineTotal: 0,
            quarantined: [],
            taxonomy: {
              schemaVersion: "director.experience.taxonomy.v1",
              categories: [],
              tags: [],
              candidates: [],
            },
          },
        }),
        hostApiUrl: "http://127.0.0.1:3201",
        hostApiFetch,
      }),
    });

    const result = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });

    expect(hostApiFetch).toHaveBeenCalledTimes(1);
    expect(result.snapshot.candidate).toMatchObject({
      count: 1,
      id: "candidate-host-catalog-1",
      status: "accepted",
    });
    expect(result.snapshot.candidate.items[0]).toMatchObject({
      id: "candidate-host-catalog-1",
      category: expect.objectContaining({ categoryId: "director-shot", name: "导演镜头" }),
      taxonomyTags: [expect.objectContaining({ tagId: "shot-size", name: "景别" })],
    });
    expect(result.snapshot.knowledge).toMatchObject({
      publishedCount: 1,
      candidateCount: 1,
      publishedId: "pack-host-catalog",
      candidateId: "pack-host-candidate",
    });
    expect(result.snapshot.assets.skills).toMatchObject({
      total: 1,
      proposalCount: 1,
      pendingProposalCount: 1,
      items: [
        expect.objectContaining({
          id: "skill.host-catalog",
          category: expect.objectContaining({ categoryId: "workflow" }),
          taxonomyTags: [expect.objectContaining({ tagId: "host-catalog" })],
        }),
      ],
    });
  });

  it("surfaces the full approved skill library with detail metadata and taxonomy fields", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-skills-library-"));
    tempRoots.push(workspaceRoot);
    writeRichSkillSnapshotFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture(),
      }),
    });

    const result = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    const skills = result.snapshot.assets.skills;
    const primarySkill = skills.items.find((item) => item.id === "skill.backend-snapshot");

    expect(skills).toMatchObject({
      total: 13,
      selfCount: 1,
      externalCount: 12,
      sourceCounts: {
        self: 1,
        external: 12,
      },
      categories: expect.arrayContaining([
        expect.objectContaining({ id: "backend", count: 1 }),
        expect.objectContaining({ id: "documentation", count: 12 }),
      ]),
      sourceCategories: expect.arrayContaining([
        expect.objectContaining({ id: "self", count: 1 }),
        expect.objectContaining({ id: "external", count: 12 }),
      ]),
      toolNames: expect.arrayContaining(["rg", "node"]),
      taxonomy: expect.objectContaining({
        schemaVersion: "director.skills.taxonomy.v1",
        tags: expect.arrayContaining([
          expect.objectContaining({ tagId: "backend", name: "backend", count: 1 }),
        ]),
      }),
    });
    expect(skills.items).toHaveLength(13);
    expect(primarySkill).toMatchObject({
      id: "skill.backend-snapshot",
      content:
        "Read approved skills as a complete library. Preserve content, metadata, tags, tools, and source counts for detail panes.",
      metadata: {
        sourceTurnId: "turn-rich-skill",
        category: "backend",
        sourceCount: 3,
      },
      priority: 72,
      source: "self",
      category: expect.objectContaining({
        categoryId: "backend",
        name: "backend",
      }),
      tags: ["backend", "snapshot", "worker-generated"],
      taxonomyTags: [
        expect.objectContaining({ tagId: "backend", name: "backend" }),
        expect.objectContaining({ tagId: "snapshot", name: "snapshot" }),
        expect.objectContaining({ tagId: "worker-generated", name: "worker-generated" }),
      ],
      toolNames: ["rg", "node"],
      trustStatus: "trusted",
      auditStatus: "self-evolved",
      riskLevel: "medium",
      permissionSummary: "读取文件, 执行命令",
      permissions: expect.arrayContaining([
        expect.objectContaining({ kind: "filesystem.read", toolName: "rg", riskLevel: "low" }),
        expect.objectContaining({ kind: "command.execute", toolName: "node", riskLevel: "medium" }),
      ]),
      auditSummary: expect.stringContaining("自进化"),
      sourceDocument: expect.objectContaining({
        content:
          "Read approved skills as a complete library. Preserve content, metadata, tags, tools, and source counts for detail panes.",
        isFullContent: true,
        originalChars: 120,
      }),
    });
    expect(skills.items.find((item) => item.id === "skill.documentation-1")).toMatchObject({
      source: "external",
      enabled: true,
      chineseIntro: expect.stringContaining("外部 Skill"),
      trustStatus: "untrusted",
      auditStatus: "untrusted",
      riskLevel: "medium",
      permissionSummary: "未声明工具权限",
      auditSummary: expect.stringContaining("外部 Skill"),
    });
  });

  it("surfaces model invocation disabled Skills as managed but not model-visible", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-skills-model-invocation-"));
    tempRoots.push(workspaceRoot);
    const skillsDir = join(workspaceRoot, ".hotflow", "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(
      join(skillsDir, "approved-skills.json"),
      JSON.stringify(
        {
          schemaVersion: "skills.approved.v2",
          version: 1,
          updatedAtMs: 1,
          appliedAtMs: 1,
          appliedFromProposalId: null,
          changeKind: "manual",
          previousVersion: null,
          restoredFromVersion: null,
          skills: [
            {
              id: "skill.operator-only-browser",
              version: "1.0.0",
              title: "Operator Only Browser Skill",
              content: "Privileged browser workflow. Only an operator may run this directly.",
              description: "Operator-only browser workflow.",
              tags: ["browser", "operator"],
              metadata: {
                disableModelInvocation: true,
              },
              updatedAtMs: 1,
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture(),
      }),
    });

    const result = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    const skill = result.snapshot.assets.skills.items.find(
      (item) => item.id === "skill.operator-only-browser",
    );

    expect(skill).toMatchObject({
      enabled: true,
      configuredEnabled: true,
      modelInvocable: false,
      modelVisible: false,
      eligible: false,
      permissionStatus: "model-invocation-disabled",
      runtimeStatus: "model-invocation-disabled",
      disabledReason: expect.stringContaining("disableModelInvocation"),
      statusReason: expect.stringContaining("普通对话不会自动加载或执行"),
      explanationSurface: expect.objectContaining({
        schemaId: "skills.explanation-surface.v1",
        status: "model-invocation-disabled",
        operatorReviewRequired: true,
        operatorReviewGate: "operator-review-required",
        operatorReviewExplanation: expect.stringContaining("人工审核"),
      }),
    });
  });

  it("marks enabled Skills as needs-setup when declared model tools are unavailable", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-skills-needs-setup-"));
    tempRoots.push(workspaceRoot);
    const skillsDir = join(workspaceRoot, ".hotflow", "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(
      join(skillsDir, "approved-skills.json"),
      JSON.stringify(
        {
          schemaVersion: "skills.approved.v2",
          version: 1,
          updatedAtMs: 1,
          appliedAtMs: 1,
          appliedFromProposalId: null,
          changeKind: "manual",
          previousVersion: null,
          restoredFromVersion: null,
          skills: [
            {
              id: "skill.x-research",
              version: "1.0.0",
              title: "X Research Skill",
              content: "Search X/Twitter for current production references before summarizing.",
              description: "Needs live X/Twitter search.",
              tags: ["research", "x"],
              toolNames: ["x_search"],
              updatedAtMs: 1,
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture(),
      }),
    });

    const result = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    const skills = result.snapshot.assets.skills;
    const skill = skills.items.find((item) => item.id === "skill.x-research");

    expect(skills).toMatchObject({
      readyCount: 0,
      needsSetupCount: 1,
      disabledRuntimeCount: 0,
      blockedCount: 1,
      modelVisibleCount: 0,
      eligibleCount: 0,
      uncheckedToolCount: 0,
      runtimeSummary: expect.objectContaining({
        total: 1,
        readyCount: 0,
        needsSetupCount: 1,
        blockedCount: 1,
        modelVisibleCount: 0,
        eligibleCount: 0,
        status: "needs-attention",
        missingToolNames: ["x_search"],
        nextActions: expect.arrayContaining([expect.stringContaining("外部工具 provider")]),
      }),
    });
    expect(skill).toMatchObject({
      enabled: true,
      modelInvocable: true,
      runtimeStatus: "needs-setup",
      eligible: false,
      modelVisible: false,
      permissionStatus: "needs-setup",
      doctorStatus: "needs-setup",
      missingToolNames: ["x_search"],
      availableToolNames: [],
      uncheckedToolNames: [],
      doctorSummary: expect.stringContaining("x_search"),
      nextActions: expect.arrayContaining([expect.stringContaining("x_search")]),
      statusReason: expect.stringContaining("先完成工具配置"),
      explanationSurface: expect.objectContaining({
        schemaId: "skills.explanation-surface.v1",
        status: "needs-setup",
        statusExplanation: expect.stringContaining("x_search"),
        nextActions: expect.arrayContaining([expect.stringContaining("x_search")]),
      }),
    });
  });

  it("manages external Skills locally and keeps runtime recall synced", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-skill-management-"));
    tempRoots.push(workspaceRoot);
    writeSkillSnapshotFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture(),
      }),
    });

    const disabled = await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_ENABLEMENT_SET,
      skillId: "skill.external",
      enabled: false,
      note: "pause external import",
      now: "2026-04-30T08:00:00.000Z",
    });
    const disabledSkill = disabled.snapshot.assets.skills.items.find(
      (item) => item.id === "skill.external",
    );
    expect(disabledSkill).toMatchObject({
      enabled: false,
      enablementStatus: "disabled",
      disabledReason: "pause external import",
    });
    const approvedSkillsPath = join(workspaceRoot, ".hotflow", "skills", "approved-skills.json");
    const approvedSkills = JSON.parse(readFileSync(approvedSkillsPath, "utf8"));
    approvedSkills.skills = approvedSkills.skills.map((skill) =>
      skill.id === "skill.external" ? { ...skill, enabled: true } : skill,
    );
    writeFileSync(approvedSkillsPath, JSON.stringify(approvedSkills, null, 2), "utf8");

    const managementOverride = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    expect(
      managementOverride.snapshot.assets.skills.items.find((item) => item.id === "skill.external"),
    ).toMatchObject({
      enabled: false,
      enablementStatus: "disabled",
      disabledReason: "pause external import",
    });

    const production = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/制作 Imported workflow storyboard",
      surface: "workbench",
    });
    expect(production.productionRun).toMatchObject({
      skillStatus: "miss",
      skillIds: [],
    });

    const updated = await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_UPDATE,
      skillId: "skill.external",
      title: "外部制作 Skill",
      description: "中文简介：外部导入的制作流程，用于分镜和执行前检查。",
      tags: ["external", "director"],
      content: "Imported workflow updated for production planning.",
      now: "2026-04-30T08:01:00.000Z",
    });
    const updatedSkill = updated.snapshot.assets.skills.items.find(
      (item) => item.id === "skill.external",
    );
    expect(updatedSkill).toMatchObject({
      title: "外部制作 Skill",
      description: "中文简介：外部导入的制作流程，用于分镜和执行前检查。",
      enabled: false,
      tags: ["external", "director"],
      usage: expect.objectContaining({
        patchCount: 1,
      }),
    });
    expect(
      JSON.parse(
        readFileSync(resolveSkillUsagePath({ dataDir: join(workspaceRoot, ".hotflow") }), "utf8"),
      ).records["skill.external"].patchCount,
    ).toBe(1);

    const enabled = await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_ENABLEMENT_SET,
      skillId: "skill.external",
      enabled: true,
      now: "2026-04-30T08:02:00.000Z",
    });
    expect(
      enabled.snapshot.assets.skills.items.find((item) => item.id === "skill.external"),
    ).toMatchObject({
      enabled: true,
      enablementStatus: "enabled",
    });

    const deleted = await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_DELETE,
      skillId: "skill.external",
      note: "remove obsolete external skill",
      now: "2026-04-30T08:03:00.000Z",
    });
    expect(deleted.snapshot.assets.skills.items.map((item) => item.id)).not.toContain(
      "skill.external",
    );
    expect(
      JSON.parse(readFileSync(join(workspaceRoot, ".hotflow", "skills", "management.json"), "utf8"))
        .disabledSkillIds,
    ).toEqual([]);
    const usageAfterDelete = JSON.parse(
      readFileSync(resolveSkillUsagePath({ dataDir: join(workspaceRoot, ".hotflow") }), "utf8"),
    );
    expect(usageAfterDelete.records["skill.external"]).toBeUndefined();
  });

  it("persists approved Skill classification and returns taxonomy-bound snapshot fields", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-skill-taxonomy-"));
    tempRoots.push(workspaceRoot);
    writeRichSkillSnapshotFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture(),
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_CATEGORY_CREATE,
      categoryId: "director-production",
      name: "导演制作",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_TAG_CREATE,
      tagId: "shot-language",
      name: "镜头语言",
    });
    const saved = await bridge.invoke({
      type: DESKTOP_ACTIONS.SKILL_CLASSIFICATION_SAVE,
      skillId: "skill.backend-snapshot",
      categoryId: "director-production",
      tagIds: ["shot-language"],
    });
    const skill = saved.snapshot.assets.skills.items.find(
      (item) => item.id === "skill.backend-snapshot",
    );
    const taxonomyFile = JSON.parse(
      readFileSync(join(workspaceRoot, ".hotflow", "skills", "taxonomy.json"), "utf8"),
    );

    expect(skill).toMatchObject({
      category: expect.objectContaining({
        categoryId: "director-production",
        name: "导演制作",
      }),
      taxonomyTags: [expect.objectContaining({ tagId: "shot-language", name: "镜头语言" })],
      taxonomyBinding: expect.objectContaining({
        skillId: "skill.backend-snapshot",
        categoryId: "director-production",
        tagIds: ["shot-language"],
      }),
    });
    expect(saved.snapshot.assets.skills.taxonomy).toMatchObject({
      sourceSchemaVersion: "skills.taxonomy.v1",
      categories: expect.arrayContaining([
        expect.objectContaining({
          categoryId: "director-production",
          name: "导演制作",
          count: 1,
        }),
      ]),
      tags: expect.arrayContaining([
        expect.objectContaining({ tagId: "shot-language", name: "镜头语言", count: 1 }),
      ]),
    });
    expect(taxonomyFile.skills).toEqual([
      expect.objectContaining({
        skillId: "skill.backend-snapshot",
        categoryId: "director-production",
        tagIds: ["shot-language"],
      }),
    ]);
  });

  it("surfaces experience quality, evidence preview, and quarantine records in the snapshot", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-experience-snapshot-"));
    tempRoots.push(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          experience: {
            total: 1,
            artifactTotal: 1,
            artifacts: [
              {
                artifactId: "artifact-quality-1",
                sourceKind: "web-page",
                sourceRef: "https://example.test/lesson",
                title: "Full source lesson",
                contentType: "text/plain; charset=utf-8",
                digest: "digest-quality-1",
                bytes: 96,
                textPreview: "Preview only.",
                rawContent:
                  "Full captured source body. Compare source examples, preserve evidence, and keep review gates visible.",
                readableContent:
                  "Readable captured source body. Compare source examples, preserve evidence, and keep review gates visible.",
                structuredContent: {
                  schemaVersion: "director.source.snapshot.v1",
                  kind: "browser-capture",
                  blocks: [
                    {
                      kind: "text",
                      text: "Readable captured source body.",
                    },
                  ],
                  tables: [],
                  media: [
                    {
                      kind: "image",
                      src: "https://example.test/source.png",
                      alt: "source image",
                    },
                  ],
                },
                extractionReport: {
                  status: "ok",
                  readableChars: 99,
                  transformations: ["html_readability_extract"],
                  notes: ["Readable content extracted for desktop review."],
                },
                quality: {
                  score: 0.92,
                  verdict: "usable",
                  reasons: ["contains reusable operating guidance"],
                },
                privacy: "public",
                provenance: "desktop-test",
                capturedAtMs: 9_000,
              },
            ],
            quarantineCount: 1,
            quarantineItems: [
              {
                id: "quarantine-login",
                title: "Login wall",
                sourceKind: "web-page",
                sourceRef: "https://example.test/login",
                reason: "authentication page rather than source content",
                notes: ["Quarantined before candidate creation."],
                quality: {
                  score: 0.12,
                  verdict: "quarantine",
                  reasons: ["authentication page rather than source content"],
                },
                createdAtMs: 12_000,
              },
            ],
            candidates: [
              {
                candidate: createExperienceCandidateFixture({
                  candidateId: "experience-quality-1",
                  title: "Evidence-backed lesson",
                  quality: {
                    score: 0.92,
                    verdict: "usable",
                    reasons: ["contains reusable operating guidance", "has anchored evidence"],
                  },
                  evidencePreview:
                    "Compare source examples, preserve the evidence trail, and keep learned guidance review-gated.",
                }),
                status: "pending",
                latestReview: null,
                promotions: [],
                latestPromotion: null,
                promoted: false,
              },
            ],
          },
        }),
      }),
    });

    const result = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });

    expect(result.snapshot.candidate.items[0]).toMatchObject({
      id: "experience-quality-1",
      quality: {
        score: 0.92,
        verdict: "usable",
        label: "usable 92%",
        reasons: ["contains reusable operating guidance", "has anchored evidence"],
      },
      evidencePreview:
        "Compare source examples, preserve the evidence trail, and keep learned guidance review-gated.",
      sourceDocument: expect.objectContaining({
        title: "Full source lesson",
        contentType: "text/plain; charset=utf-8",
        bytes: 96,
        isFullContent: true,
        truncated: false,
        content:
          "Readable captured source body. Compare source examples, preserve evidence, and keep review gates visible.",
        rawContent:
          "Full captured source body. Compare source examples, preserve evidence, and keep review gates visible.",
        structuredContent: expect.objectContaining({
          schemaVersion: "director.source.snapshot.v1",
          kind: "browser-capture",
        }),
        extractionReport: expect.objectContaining({
          status: "ok",
          readableChars: 99,
          transformations: ["html_readability_extract"],
        }),
      }),
      applicability: "Use when reviewing learned Director Angel operating guidance.",
      risks: [],
      evidence: [
        expect.objectContaining({
          id: "evidence-quality-1",
          summary: "Source paragraph with reusable direction.",
          preview: "Compare source examples, preserve evidence, and keep review gates.",
        }),
      ],
    });
    expect(result.snapshot.assets.experience).toMatchObject({
      quarantineCount: 1,
      quarantineItems: [
        expect.objectContaining({
          id: "quarantine-login",
          reason: "authentication page rather than source content",
          quality: expect.objectContaining({
            label: "quarantine 12%",
          }),
        }),
      ],
    });
  });

  it("reports the real learning skip reason from adapter notes", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-learning-skip-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        experienceFetchText: async (url) => ({
          url,
          contentType: "text/html; charset=utf-8",
          body: "<html><title>登录后继续访问</title><body>登录 注册 请输入验证码 当前环境异常，完成验证后即可继续访问。首页 导航 推荐 分享 下载 App</body></html>",
        }),
        knowledge: createSnapshotKnowledgeFixture(),
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
      url: "https://example.test/login",
      privacy: "public",
    });

    expect(result.events.at(-1)?.body).toContain("访问受限");
    expect(result.events.at(-1)?.body).toContain("这次还没有学到可信正文");
    expect(result.events.at(-1)?.body).not.toContain("Desktop learning result:");
    expect(result.events.at(-1)?.body).not.toContain("没有生成可入库经验候选");
    expect(result.events.at(-1)?.body).not.toContain("脚本/CSS 噪声");
  });

  it("keeps failed learning in the workbench result with the real error reason", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-learning-failure-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          learnDirectorExperience: async () => {
            throw new Error("Web source fetch failed for https://example.test/private: HTTP 403.");
          },
        }),
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
      url: "https://example.test/private",
      privacy: "public",
    });

    expect(result.snapshot.workspaceRoot).toBe(workspaceRoot);
    expect(result.events.at(-1)).toMatchObject({
      title: "URL 学习",
      body: expect.stringContaining("这次还没有学到可信正文"),
      actionType: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
    });
  });

  it("returns evidence disclosure for blocked desktop URL learning attempts", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-url-blocked-evidence-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const blockedUrl = "https://example.test/private";

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          learnDirectorExperience: async () => {
            throw new Error("learning should not ingest a blocked URL read");
          },
        }),
        experienceFetchText: async (url) => ({
          ok: false,
          status: 403,
          statusText: "Forbidden",
          url,
          headers: { get: () => "text/html; charset=utf-8" },
          body: "Forbidden",
        }),
        browserToolService: {
          navigate: async ({ url }) => ({
            success: false,
            url,
            title: "Angel Chrome unavailable",
            error: "Angel Chrome launch did not expose CDP in time.",
          }),
        },
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
      url: blockedUrl,
      privacy: "public",
    });

    expect(result.evidenceDisclosure).toMatchObject({
      schemaVersion: "director.desktop.evidence-disclosure.v1",
      sourceCount: 1,
      sources: [
        expect.objectContaining({
          url: blockedUrl,
          sourceAccessStatus: "failed",
          readStatus: "failed",
          persisted: false,
          admitted: false,
        }),
      ],
    });
    expect(result.evidenceDisclosure.sources[0].failedReason).toMatch(
      /HTTP 403|Forbidden|Angel Chrome launch did not expose CDP/u,
    );
  });

  it("reroutes desktop URL learning through browser snapshot when direct extraction is blocked", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-url-browser-reroute-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const browserCalls = [];
    const learnDirectorExperience = vi.fn(async () => ({
      result: { candidateCount: 1, quarantineCount: 0 },
      candidates: [{ candidateId: "exp-browser-url", title: "浏览器正文经验" }],
    }));
    const browserToolService = {
      navigate: async (input) => {
        browserCalls.push({ name: "browser_navigate", input });
        return {
          success: true,
          url: input.url,
          title: "浏览器文章",
          snapshot: "页面已打开",
          element_count: 0,
        };
      },
      snapshot: async (input) => {
        browserCalls.push({ name: "browser_snapshot", input });
        return {
          success: true,
          url: "https://mp.weixin.qq.com/s/browser-reroute",
          title: "浏览器文章",
          text:
            "这是一篇导演制作经验文章。".repeat(30) +
            "内容包含镜头调度、分镜节奏、演员走位和制作复盘。",
          element_count: 0,
        };
      },
    };

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        browserToolService,
        experienceFetchText: async (url) => ({
          ok: true,
          status: 200,
          url,
          headers: { get: () => "text/plain; charset=utf-8" },
          body: "当前环境异常，完成验证后即可继续访问。视频 小程序 赞 在看",
        }),
        knowledge: createSnapshotKnowledgeFixture({ learnDirectorExperience }),
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
      url: "https://mp.weixin.qq.com/s/browser-reroute",
      privacy: "public",
    });

    expect(browserCalls.map((call) => call.name)).toEqual(["browser_navigate", "browser_snapshot"]);
    expect(browserCalls[0]?.input.profile).toBe("angel");
    expect(learnDirectorExperience).toHaveBeenCalledWith(
      workspaceRoot,
      expect.objectContaining({
        urls: ["https://mp.weixin.qq.com/s/browser-reroute"],
        fetchText: expect.any(Function),
      }),
    );
    expect(result.events.at(-1)?.body).toContain("浏览器正文经验");
  });

  it("executes role-scoped scheduled learning in the desktop background runner as pending candidates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-background-role-learning-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const learnedUrls = [];
    const learnDirectorExperience = vi.fn(async (_root, input) => {
      learnedUrls.push(...(input.urls ?? []));
      return {
        result: {
          candidateCount: 1,
          quarantineCount: 0,
          candidateIds: ["exp-role-learning"],
        },
        candidates: [
          {
            candidateId: "exp-role-learning",
            title: "导演 Angel 定时学习经验",
            summary: "定时学习只生成待审候选，不自动发布。",
          },
        ],
      };
    });
    const handlers = createDirectorDesktopSystemHandlers({
      workspaceRoot,
      knowledge: createSnapshotKnowledgeFixture({ learnDirectorExperience }),
      experienceFetchText: async (url) => ({
        ok: true,
        status: 200,
        url,
        headers: { get: () => "text/plain; charset=utf-8" },
        body: "导演 Angel 定时学习资料：先筛选高质量来源，再提炼可复用制作方法，最后只生成待审候选。".repeat(4),
      }),
    });

    const result = await handlers.backgroundRuntime.runTurn(
      {
        surface: "desktop",
        channel: "desktop-background",
        messageId: "background-job:job-role-learning",
        sessionKey: "role:director:learning",
        text: "围绕导演岗位学习高质量 AI 制作资料，只生成待审经验候选。",
        sender: { id: "desktop-background-worker", role: "system" },
        trustedContext: {
          angelRoleProfile: {
            roleId: "director",
            title: "导演 Angel",
            domain: "影视制作与 AI 工作流",
            learningScope: ["短剧制作", "AI 分镜"],
          },
          metadata: {
            scheduledLearning: true,
            candidateOnly: true,
            autoPublish: false,
            memorySync: "skip-auto-write",
          },
        },
        metadata: {
          scheduledLearning: true,
          candidateOnly: true,
          autoPublish: false,
          memorySync: "skip-auto-write",
        },
      },
      {
        workerId: "desktop-background-worker",
        nowMs: 500,
        job: {
          jobId: "job-role-learning",
          sessionKey: "role:director:learning",
          title: "导演每日学习",
          objective: "围绕导演岗位学习高质量 AI 制作资料，只生成待审经验候选。",
          trigger: { kind: "schedule", scheduleRef: "role-learning:director:daily" },
          budget: { tokenLimit: 12_000, fileCountLimit: 1, videoMinuteLimit: 0 },
          permissions: {
            allowedTools: ["web_extract", "director.learning.url", "director.learning.admit"],
            allowedCapabilities: ["learning"],
            riskLevel: "medium",
            requiresApproval: true,
          },
          policyEnvelopeRefs: ["policy:role-learning"],
          evidenceRefIds: [],
          sourceRefs: ["https://example.test/director-role-learning"],
          metadata: {
            scheduledLearning: true,
            roleId: "director",
            roleTitle: "导演 Angel",
            learningScope: ["短剧制作", "AI 分镜"],
            sourcePolicy: {
              qualityGate: "high_signal_only",
              candidateOnly: true,
            },
            candidateOnly: true,
            autoPublish: false,
            memorySync: "skip-auto-write",
          },
        },
      },
    );

    expect(learnedUrls).toEqual(["https://example.test/director-role-learning"]);
    expect(result).toMatchObject({
      replySource: "structured-renderer",
      responsePolicy: "review-gated",
      finalText: expect.stringContaining("生成 1 条待审候选"),
      memoryDecision: {
        action: "candidate-review",
      },
      userFacingProjection: {
        briefStatus: "learning-candidate",
      },
    });
    expect(result.finalText).toContain("等待人工确认");
    expect(result.finalText).not.toContain("已保存");
    expect(result.operatorTrace.items[0]).toMatchObject({
      stage: "background.role-learning",
      metadata: {
        roleId: "director",
        candidateOnly: true,
        autoPublish: false,
        memorySync: "skip-auto-write",
        sourcePolicy: {
          qualityGate: "high_signal_only",
          candidateOnly: true,
        },
        triggerReason: "schedule:role-learning:director:daily",
        candidateCount: 1,
      },
    });
    const learning = handlers.snapshot
      ? (await handlers.snapshot()).snapshot.assets.learning
      : null;
    expect(learning).toMatchObject({
      pendingConfirmationCount: 1,
      pendingConfirmations: [
        expect.objectContaining({
          sessionKey: "role:director:learning",
          candidateIds: ["exp-role-learning"],
          sourceKind: "url",
          sourceRef: "https://example.test/director-role-learning",
          roleName: "导演 Angel",
          roleDomain: "影视制作与 AI 工作流",
          learningScope: ["短剧制作", "AI 分镜"],
          sourcePolicy: {
            qualityGate: "high_signal_only",
            candidateOnly: true,
          },
          triggerReason: "schedule:role-learning:director:daily",
          candidateOnly: true,
          autoPublish: false,
          memorySync: "skip-auto-write",
        }),
      ],
    });
    expect(learning.pendingArtifacts[0]).toMatchObject({
      roleName: "导演 Angel",
      learningScope: ["短剧制作", "AI 分镜"],
      candidateOnly: true,
    });
  });

  it("blocks desktop learning actions when the self-learning switch is disabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-learning-disabled-"));
    tempRoots.push(workspaceRoot);
    let learnCalls = 0;

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          learnDirectorExperience: async () => {
            learnCalls += 1;
            throw new Error("learning should be blocked before backend ingest");
          },
        }),
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
      url: "https://example.test/lesson",
    });

    expect(learnCalls).toBe(0);
    expect(result.events.at(-1)).toMatchObject({
      title: "自我学习入口已关闭",
      actionType: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
    });
  });

  it("writes API provider settings through the workbench composer without leaking the key", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-api-provider-"));
    tempRoots.push(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const baseUrlResult = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/供应方 设置 memefast-api baseUrl https://proxy.example.test",
      surface: "workbench",
    });
    const keyResult = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/供应方 密钥 memefast-api sk-real-secret",
      surface: "workbench",
    });
    const modelsResult = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/供应方 设置 memefast-api models gemini-2.5-flash,sora-2-pro",
      surface: "workbench",
    });
    const disabled = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/供应方 禁用 memefast-api",
      surface: "workbench",
    });
    const configFile = readFileSync(
      join(workspaceRoot, ".director-angel", "providers", "providers.json"),
      "utf8",
    );
    const apiKeyParameter = keyResult.snapshot.assets.settings.parameters.find(
      (parameter) => parameter.id === "apiProvider:memefast-api:apiKey",
    );

    expect(baseUrlResult.snapshot.assets.settings.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "apiProvider:memefast-api:baseUrl",
          value: "https://proxy.example.test",
        }),
      ]),
    );
    expect(apiKeyParameter).toMatchObject({
      value: true,
      valueLabel: "sk-...cret",
    });
    expect(modelsResult.snapshot.assets.settings.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "apiProvider:memefast-api:models",
          valueLabel: expect.stringMatching(/^\d+ 个模型$/u),
        }),
      ]),
    );
    expect(disabled.snapshot.assets.settings.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "apiProvider:memefast-api:enabled",
          value: false,
          valueLabel: "关闭",
        }),
      ]),
    );
    expect(configFile).toContain("sk-real-secret");
    expect(configFile).toContain("sora-2-pro");
    expect(configFile).toContain("gemini-3-pro-preview-thinking");
    expect(configFile).toContain("doubao-seedance-2-0-260128");
    expect(configFile).toContain("happyhorse-1.0-video-edit");
    expect(JSON.stringify(keyResult.snapshot)).not.toContain("sk-real-secret");
    expect(keyResult.events.map((event) => event.title)).toEqual(["API 供应方已更新"]);
  });

  it("tests an API provider key through a desktop action without saving or leaking the key", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-api-provider-test-"));
    tempRoots.push(workspaceRoot);
    const calls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          calls.push({ url, authorization: init.headers.Authorization });
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({ data: [{ id: "gemini-2.5-flash" }, { id: "sora-2" }] }),
          };
        },
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_TEST,
      providerId: "memefast-api",
      baseUrl: "https://proxy.example.test",
      apiKey: "sk-first-secret\nsk-second-secret",
    });
    const apiKeyParameter = result.snapshot.assets.settings.parameters.find(
      (parameter) => parameter.id === "apiProvider:memefast-api:apiKey",
    );

    expect(calls).toEqual([
      {
        url: "https://proxy.example.test/v1/models",
        authorization: "Bearer sk-first-secret",
      },
    ]);
    expect(result.apiProviderTest).toMatchObject({
      providerId: "memefast-api",
      ok: true,
      endpoint: "https://proxy.example.test/v1/models",
      status: 200,
      modelCount: 2,
    });
    expect(apiKeyParameter).toMatchObject({
      value: false,
      valueLabel: "未设置",
    });
    expect(result.events.at(-1)).toMatchObject({
      title: "API Key 测试通过",
      actionType: DESKTOP_ACTIONS.API_PROVIDER_TEST,
    });
    expect(JSON.stringify(result)).not.toContain("sk-first-secret");
    expect(JSON.stringify(result)).not.toContain("sk-second-secret");
  });

  it("syncs a memefast model pool through a desktop action without leaking the key", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-api-provider-sync-"));
    tempRoots.push(workspaceRoot);
    const calls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          calls.push({ url, authorization: init.headers.Authorization });
          if (url === "https://proxy.example.test/api/pricing_new") {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () =>
                JSON.stringify({
                  data: [
                    {
                      model_name: "qwen-image-max",
                      model_type: "图像",
                      tags: "生图,编辑",
                      supported_endpoint_types: ["dall-e-3"],
                      enable_groups: ["default", "官转"],
                    },
                  ],
                }),
            };
          }
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({
                data: [{ id: "operator-only-model", supported_endpoint_types: ["aigc-video"] }],
              }),
          };
        },
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SYNC_MODELS,
      providerId: "memefast-api",
      baseUrl: "https://proxy.example.test/v1",
      apiKey: "sk-sync-secret",
    });
    const modelsParameter = result.snapshot.assets.settings.parameters.find(
      (parameter) => parameter.id === "apiProvider:memefast-api:models",
    );
    const metadataParameter = result.snapshot.assets.settings.parameters.find(
      (parameter) => parameter.id === "apiProvider:memefast-api:modelMetadata",
    );

    expect(calls).toEqual([
      { url: "https://proxy.example.test/api/pricing_new", authorization: undefined },
      { url: "https://proxy.example.test/v1/models", authorization: "Bearer sk-sync-secret" },
    ]);
    expect(result.apiProviderModelSync).toMatchObject({
      providerId: "memefast-api",
      ok: true,
      pricingEndpoint: "https://proxy.example.test/api/pricing_new",
      modelsEndpoint: "https://proxy.example.test/v1/models",
      metadataCount: 2,
      endpointTypeCount: 2,
    });
    expect(modelsParameter).toMatchObject({
      valueLabel: expect.stringContaining("个模型"),
    });
    expect(metadataParameter).toMatchObject({
      valueLabel: expect.stringContaining("qwen-image-max"),
      writable: false,
    });
    expect(result.events.at(-1)).toMatchObject({
      title: "API 模型池同步完成",
      actionType: DESKTOP_ACTIONS.API_PROVIDER_SYNC_MODELS,
    });
    expect(JSON.stringify(result)).not.toContain("sk-sync-secret");
  });

  it("syncs a memefast model pool with the saved key when no temporary key is provided", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-api-provider-sync-saved-"));
    tempRoots.push(workspaceRoot);
    const calls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          calls.push({ url, authorization: init.headers.Authorization });
          if (url === "https://proxy.example.test/api/pricing_new") {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () =>
                JSON.stringify({
                  data: [
                    {
                      model_name: "doubao-seedance-3-0-260528",
                      model_type: "音视频",
                      tags: "视频",
                      supported_endpoint_types: ["豆包视频异步"],
                    },
                  ],
                }),
            };
          }
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () => JSON.stringify({ data: [] }),
          };
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test/v1",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-stored-secret",
    });
    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SYNC_MODELS,
      providerId: "memefast-api",
    });
    const metadataParameter = result.snapshot.assets.settings.parameters.find(
      (parameter) => parameter.id === "apiProvider:memefast-api:modelMetadata",
    );

    expect(calls).toEqual([
      { url: "https://proxy.example.test/api/pricing_new", authorization: undefined },
      { url: "https://proxy.example.test/v1/models", authorization: "Bearer sk-stored-secret" },
    ]);
    expect(result.apiProviderModelSync).toMatchObject({
      providerId: "memefast-api",
      ok: true,
      metadataCount: 1,
      endpointTypeCount: 1,
      accountModelStatusCount: 1,
    });
    expect(metadataParameter).toMatchObject({
      valueLabel: expect.stringContaining("doubao-seedance-3-0-260528"),
      writable: false,
    });
    expect(JSON.stringify(result)).not.toContain("sk-stored-secret");
  });

  it("runs ordinary workbench input through the configured API provider with visible trace", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-api-provider-text-"));
    tempRoots.push(workspaceRoot);
    const calls = [];
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "knowledgeRecall.enabled": true,
      "memory.enabled": true,
    });
    await writePublishedProductionKnowledgeFixture(workspaceRoot);
    writeLongTermMemoryFixture(workspaceRoot);
    writeRichSkillSnapshotFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          calls.push({
            url,
            method: init.method,
            authorization: init.headers.Authorization,
            body: JSON.parse(String(init.body)),
          });
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({
                choices: [{ message: { content: "这是来自真实供应方适配层的输出。" } }],
                usage: { prompt_tokens: 10, completion_tokens: 12 },
              }),
          };
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-first-secret\nsk-second-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "defaultTextModel",
      value: "gemini-2.5-flash",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "帮我写一句 backend snapshot continuity teaser 的开场白",
      surface: "workbench",
    });

    const systemContent = calls[0]?.body?.messages?.find(
      (message) => message.role === "system",
    )?.content;
    const userContent = calls[0]?.body?.messages?.find(
      (message) => message.role === "user",
    )?.content;

    expect(calls).toEqual([
      {
        url: "https://proxy.example.test/v1/chat/completions",
        method: "POST",
        authorization: "Bearer sk-first-secret",
        body: expect.objectContaining({
          model: "gemini-2.5-flash",
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "user",
              content: "帮我写一句 backend snapshot continuity teaser 的开场白",
            }),
          ]),
          tools: expect.arrayContaining([
            expect.objectContaining({
              function: expect.objectContaining({ name: "web_search" }),
            }),
            expect.objectContaining({
              function: expect.objectContaining({ name: "web_extract" }),
            }),
            expect.objectContaining({
              function: expect.objectContaining({ name: "director.learning.query" }),
            }),
          ]),
        }),
      },
    ]);
    expect(userContent).toBe("帮我写一句 backend snapshot continuity teaser 的开场白");
    expect(systemContent).toContain("统一对话运行时");
    expect(systemContent).toContain("先理解用户真实意图");
    expect(systemContent).toContain("Director Angel contextual recall");
    expect(systemContent).toContain("director-experience-local-constraints");
    expect(systemContent).toContain("Use continuity-safe teaser planning");
    expect(systemContent).toContain("skill.backend-snapshot");
    expect(systemContent).toContain("Backend Skills Snapshot");
    expect(systemContent).toContain("Keep the protagonist anchor visible");
    expect(result.apiProviderRun).toMatchObject({
      providerId: "memefast-api",
      model: "gemini-2.5-flash",
      ok: true,
      output: "这是来自真实供应方适配层的输出。",
      contextualRecall: {
        visibleSummary: "已参考：经验 1 条、Skill 1 个、记忆 2 条。",
        recallStatus: "hit",
        skillStatus: "hit",
        policy: expect.objectContaining({
          surface: "desktop-chat",
          userVisible: "summary-only",
          hiddenContext: true,
          traceEnabled: true,
        }),
        knowledgeHits: [expect.objectContaining({ id: "director-experience-local-constraints" })],
        skillHits: [expect.objectContaining({ id: "skill.backend-snapshot" })],
        recallTrace: expect.arrayContaining([
          expect.objectContaining({ source: "knowledge", status: "hit" }),
          expect.objectContaining({ source: "skill", status: "hit" }),
          expect.objectContaining({ source: "memory", status: "hit" }),
        ]),
        capabilityPlan: expect.arrayContaining([
          expect.objectContaining({
            capability: "knowledge.recall",
            userVisible: "summary-only",
          }),
          expect.objectContaining({
            capability: "skill.recall",
            userVisible: "summary-only",
          }),
          expect.objectContaining({
            capability: "memory.recall",
            userVisible: "summary-only",
          }),
        ]),
      },
    });
    expect(result.events.map((event) => event.title)).toEqual(["对话运行完成"]);
    expect(result.conversationRuntime).toMatchObject({
      intent: { kind: "chat" },
      finalText: "这是来自真实供应方适配层的输出。",
    });
    expect(result.runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.final",
          payload: expect.objectContaining({
            text: "这是来自真实供应方适配层的输出。",
          }),
        }),
      ]),
    );
    expect(result.runtimeOperatorTrace.items.map((item) => item.stage)).toContain(
      "model.loop.completed",
    );
    expect(JSON.stringify(result)).not.toContain("sk-first-secret");
    expect(JSON.stringify(result)).not.toContain("sk-second-secret");
  });

  it("injects workspace Angel role config into ordinary runtime turns", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-angel-role-config-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    writeFileSync(
      join(workspaceRoot, ".angel-role.json"),
      JSON.stringify({
        roleId: "producer",
        roleName: "制片 Angel",
        domain: "AI 短剧制片",
        responsibilities: ["排期", "成本控制"],
        learningFocus: ["短剧投放", "AI 视频"],
        toolAccess: ["learning", "comfyui"],
      }),
    );
    const calls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          calls.push({
            url,
            body: JSON.parse(String(init.body)),
          });
          return fakeApiProviderTextResponse("岗位配置已进入运行时。");
        },
      }),
    });
    await configureFakeApiProvider(bridge);
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "defaultTextModel",
      value: "gemini-2.5-flash",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "帮我写一句 backend snapshot continuity teaser 的开场白",
      surface: "workbench",
    });
    const systemContent = calls
      .flatMap((call) => call.body?.messages ?? [])
      .find(
        (message) => message.role === "system" && message.content.includes("统一对话运行时"),
      )?.content;

    expect(systemContent).toContain("当前岗位：制片 Angel");
    expect(systemContent).toContain("领域：AI 短剧制片");
    expect(systemContent).toContain("职责：排期；成本控制");
    expect(systemContent).toContain("学习范围：短剧投放；AI 视频");
    expect(systemContent).toContain("用户确认前不得自动发布到长期经验库");
    expect(result.conversationRuntime.finalText).toBe("岗位配置已进入运行时。");
    expect(JSON.stringify(calls)).not.toContain("sk-comfyui-secret");
  });

  it("exposes the active Angel role config source in the desktop settings snapshot", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-angel-role-source-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    const roleConfigPath = join(workspaceRoot, ".angel-role.json");
    writeFileSync(
      roleConfigPath,
      JSON.stringify({
        roleId: "producer",
        roleName: "制片 Angel",
        domain: "AI 短剧制片",
        responsibilities: ["排期", "成本控制"],
        learningFocus: ["短剧投放", "AI 视频"],
        toolAccess: ["learning", "comfyui"],
      }),
    );

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    expect(result.snapshot.assets.settings.angelRoleProfile).toMatchObject({
      roleId: "producer",
      title: "制片 Angel",
      domain: "AI 短剧制片",
      source: "file",
      sourcePath: roleConfigPath,
      sourceLabel: ".angel-role.json",
      learningScope: ["短剧投放", "AI 视频"],
      controllableSystems: ["learning", "comfyui"],
    });
    expect(result.snapshot.assets.settings.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "role:angel.profile",
          label: "当前岗位",
          valueLabel: "制片 Angel",
          source: ".angel-role.json",
          writable: false,
        }),
      ]),
    );
  });

  it("injects optional MemPalace working memory into ordinary desktop runtime recall", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-mempalace-runtime-"));
    tempRoots.push(workspaceRoot);
    const mempalaceCommand = join(workspaceRoot, "mempalace-command.mjs");
    writeFileSync(
      mempalaceCommand,
      [
        "let body = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => { body += chunk; });",
        "process.stdin.on('end', () => {",
        "  const request = JSON.parse(body);",
        "  process.stdout.write(JSON.stringify({ results: [{ id: 'desktop-scene-style', content: 'summary only: warm cat travel continuity.', text: `MemPalace remembers ${request.query}: use warm cat travel continuity.`, verbatim: `MemPalace original excerpt for ${request.query}: keep the cat travel shot continuity warm and concrete.`, similarity: 0.93, timestamp: 1777000, source_file: 'cat-travel.md', wing: 'story', room: 'cat-travel', drawer_index: 1, total_drawers: 3 }] }));",
        "});",
      ].join("\n"),
      "utf8",
    );
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "knowledgeRecall.enabled": true,
      "memory.enabled": true,
    });
    writeLongTermMemoryFixture(workspaceRoot);
    const previousEnv = {
      mode: process.env.HOTFLOW_MEMPALACE_MODE,
      command: process.env.HOTFLOW_MEMPALACE_COMMAND,
      palacePath: process.env.HOTFLOW_MEMPALACE_PALACE_PATH,
      commandArgs: process.env.HOTFLOW_MEMPALACE_COMMAND_ARGS,
      nResults: process.env.HOTFLOW_MEMPALACE_N_RESULTS,
    };
    process.env.HOTFLOW_MEMPALACE_MODE = "optional";
    process.env.HOTFLOW_MEMPALACE_COMMAND = process.execPath;
    process.env.HOTFLOW_MEMPALACE_PALACE_PATH = workspaceRoot;
    process.env.HOTFLOW_MEMPALACE_COMMAND_ARGS = JSON.stringify([mempalaceCommand]);
    process.env.HOTFLOW_MEMPALACE_N_RESULTS = "2";
    const calls = [];

    try {
      const bridge = createDirectorDesktopBridgeFacade({
        handlers: createDirectorDesktopSystemHandlers({
          workspaceRoot,
          knowledge: directorKnowledge,
          apiProviderFetch: async (url, init) => {
            calls.push({
              url,
              body: JSON.parse(String(init.body)),
            });
            return fakeApiProviderTextResponse("已按工作记忆继续。");
          },
        }),
      });

      await configureFakeApiProvider(bridge);
      const prompt = "帮我写一句 backend snapshot continuity teaser 的开场白";
      const result = await bridge.invoke({
        type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
        prompt,
        surface: "workbench",
      });

      const systemContent = calls
        .flatMap((call) => call.body?.messages ?? [])
        .find(
          (message) => message.role === "system" && message.content.includes("统一对话运行时"),
        )?.content;
      expect(systemContent).toContain("working-memory:mempalace:desktop-scene-style");
      expect(systemContent).toContain("原文片段");
      expect(systemContent).toContain(`MemPalace original excerpt for ${prompt}`);
      expect(systemContent).toContain("来源指针：sourceFile=cat-travel.md");
      expect(systemContent).not.toContain("summary only: warm cat travel continuity.");
      expect(result.apiProviderRun.contextualRecall).toMatchObject({
        visibleSummary: "已参考：记忆 3 条。",
        recallTrace: expect.arrayContaining([
          expect.objectContaining({
            source: "memory",
            status: "hit",
            id: "working-memory:mempalace:desktop-scene-style",
            reason: "working memory matched current turn",
            retrieval: expect.objectContaining({
              providerId: "desktop-working-memory",
              providerKind: "mempalace",
              directStoreAccessAllowed: false,
            }),
          }),
        ]),
      });
    } finally {
      restoreOptionalEnv("HOTFLOW_MEMPALACE_MODE", previousEnv.mode);
      restoreOptionalEnv("HOTFLOW_MEMPALACE_COMMAND", previousEnv.command);
      restoreOptionalEnv("HOTFLOW_MEMPALACE_PALACE_PATH", previousEnv.palacePath);
      restoreOptionalEnv("HOTFLOW_MEMPALACE_COMMAND_ARGS", previousEnv.commandArgs);
      restoreOptionalEnv("HOTFLOW_MEMPALACE_N_RESULTS", previousEnv.nResults);
    }
  });

  it("reads MemPalace drawer source by source pointer through a desktop bridge action", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-mempalace-source-read-"));
    tempRoots.push(workspaceRoot);
    const mempalaceCommand = join(workspaceRoot, "mempalace-command.mjs");
    writeFileSync(
      mempalaceCommand,
      [
        "let body = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => { body += chunk; });",
        "process.stdin.on('end', () => {",
        "  const request = JSON.parse(body);",
        "  if (request.action !== 'readDrawer') {",
        "    process.stdout.write(JSON.stringify({ ok: false, error: 'unexpected action' }));",
        "    return;",
        "  }",
        "  process.stdout.write(JSON.stringify({ ok: true, drawer: { content: `Full drawer for ${request.sourceFile}#${request.drawerIndex}`, source_file: request.sourceFile, drawer_index: request.drawerIndex, total_drawers: 7, memory_layer: 'L2' } }));",
        "});",
      ].join("\n"),
      "utf8",
    );
    const previousEnv = {
      mode: process.env.HOTFLOW_MEMPALACE_MODE,
      command: process.env.HOTFLOW_MEMPALACE_COMMAND,
      palacePath: process.env.HOTFLOW_MEMPALACE_PALACE_PATH,
      commandArgs: process.env.HOTFLOW_MEMPALACE_COMMAND_ARGS,
    };
    process.env.HOTFLOW_MEMPALACE_MODE = "optional";
    process.env.HOTFLOW_MEMPALACE_COMMAND = process.execPath;
    process.env.HOTFLOW_MEMPALACE_PALACE_PATH = workspaceRoot;
    process.env.HOTFLOW_MEMPALACE_COMMAND_ARGS = JSON.stringify([mempalaceCommand]);

    try {
      const bridge = createDirectorDesktopBridgeFacade({
        handlers: createDirectorDesktopSystemHandlers({
          workspaceRoot,
          knowledge: directorKnowledge,
        }),
      });

      const result = await bridge.invoke({
        type: DESKTOP_ACTIONS.MEMPALACE_SOURCE_READ,
        sourceFile: "seedance.md",
        drawerIndex: 2,
        wing: "story",
        room: "visual",
      });

      expect(result.mempalaceSource).toMatchObject({
        ok: true,
        content: "Full drawer for seedance.md#2",
        source: {
          sourceFile: "seedance.md",
          drawerIndex: 2,
          totalDrawers: 7,
          memoryLayer: "L2",
          layerLabel: "L2 On-Demand",
        },
      });
      expect(result.events.at(-1)).toMatchObject({
        title: "MemPalace 原文已读取",
        actionType: DESKTOP_ACTIONS.MEMPALACE_SOURCE_READ,
      });
    } finally {
      restoreOptionalEnv("HOTFLOW_MEMPALACE_MODE", previousEnv.mode);
      restoreOptionalEnv("HOTFLOW_MEMPALACE_COMMAND", previousEnv.command);
      restoreOptionalEnv("HOTFLOW_MEMPALACE_PALACE_PATH", previousEnv.palacePath);
      restoreOptionalEnv("HOTFLOW_MEMPALACE_COMMAND_ARGS", previousEnv.commandArgs);
    }
  });

  it("reads MemPalace drawer source by native drawerId through a desktop bridge action", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-mempalace-drawer-id-"));
    tempRoots.push(workspaceRoot);
    const mempalaceCommand = join(workspaceRoot, "mempalace-command.mjs");
    writeFileSync(
      mempalaceCommand,
      [
        "let body = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => { body += chunk; });",
        "process.stdin.on('end', () => {",
        "  const request = JSON.parse(body);",
        "  if (request.action !== 'getDrawer') {",
        "    process.stdout.write(JSON.stringify({ ok: false, error: 'unexpected action' }));",
        "    return;",
        "  }",
        "  process.stdout.write(JSON.stringify({ ok: true, drawer: { drawer_id: request.drawerId, content: `Full drawer for ${request.drawerId}`, wing: 'story', room: 'visual', metadata: { source_file: 'seedance.md', chunk_index: 2, total_drawers: 7, memory_layer: 'L2' } } }));",
        "});",
      ].join("\n"),
      "utf8",
    );
    const previousEnv = {
      mode: process.env.HOTFLOW_MEMPALACE_MODE,
      command: process.env.HOTFLOW_MEMPALACE_COMMAND,
      palacePath: process.env.HOTFLOW_MEMPALACE_PALACE_PATH,
      commandArgs: process.env.HOTFLOW_MEMPALACE_COMMAND_ARGS,
    };
    process.env.HOTFLOW_MEMPALACE_MODE = "optional";
    process.env.HOTFLOW_MEMPALACE_COMMAND = process.execPath;
    process.env.HOTFLOW_MEMPALACE_PALACE_PATH = workspaceRoot;
    process.env.HOTFLOW_MEMPALACE_COMMAND_ARGS = JSON.stringify([mempalaceCommand]);

    try {
      const bridge = createDirectorDesktopBridgeFacade({
        handlers: createDirectorDesktopSystemHandlers({
          workspaceRoot,
          knowledge: directorKnowledge,
        }),
      });

      const result = await bridge.invoke({
        type: DESKTOP_ACTIONS.MEMPALACE_SOURCE_READ,
        drawerId: "drawer_seedance_01",
      });

      expect(result.mempalaceSource).toMatchObject({
        ok: true,
        content: "Full drawer for drawer_seedance_01",
        source: {
          drawerId: "drawer_seedance_01",
          sourceFile: "seedance.md",
          drawerIndex: 2,
          totalDrawers: 7,
          memoryLayer: "L2",
          layerLabel: "L2 On-Demand",
          wing: "story",
          room: "visual",
        },
      });
    } finally {
      restoreOptionalEnv("HOTFLOW_MEMPALACE_MODE", previousEnv.mode);
      restoreOptionalEnv("HOTFLOW_MEMPALACE_COMMAND", previousEnv.command);
      restoreOptionalEnv("HOTFLOW_MEMPALACE_PALACE_PATH", previousEnv.palacePath);
      restoreOptionalEnv("HOTFLOW_MEMPALACE_COMMAND_ARGS", previousEnv.commandArgs);
    }
  });

  it("marks ordinary desktop chat as degraded when no model provider can answer", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-runtime-no-model-"));
    tempRoots.push(workspaceRoot);
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "你好，随便聊聊",
      surface: "workbench",
    });

    expect(result.apiProviderRun).toMatchObject({
      ok: false,
      providerId: "conversation-runtime",
      model: "runtime",
      output: "",
      message: expect.stringContaining("模型 Key 未配置"),
      replySource: "degraded-error",
    });
    expect(result.events.map((event) => event.title)).toEqual(["对话运行失败"]);
    expect(result.conversationRuntime).toMatchObject({
      intent: { kind: "chat" },
      finalText: expect.stringContaining("模型 Key 未配置"),
      replySource: "degraded-error",
    });
    expect(JSON.stringify(result)).not.toContain("统一对话运行时未返回文本");
    expect(JSON.stringify(result)).not.toContain("工具已执行完成");
    expect(JSON.stringify(result)).not.toContain("工具已返回结果");
  });

  it("exposes Claude Code style MCP tools to desktop model calls", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-mcp-tools-"));
    tempRoots.push(workspaceRoot);
    writeFileSync(
      join(workspaceRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          disabled: {
            command: "node",
            enabled: false,
          },
        },
      }),
    );
    const calls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          calls.push({
            url,
            method: init.method,
            body: JSON.parse(String(init.body)),
          });
          return jsonResponse({
            choices: [{ message: { content: "MCP 工具列表已加载。" } }],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-mcp-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "你现在有哪些 MCP 工具？",
      surface: "workbench",
    });

    const toolNames = calls[0]?.body?.tools?.map((tool) => tool.function?.name);
    expect(toolNames).toEqual(
      expect.arrayContaining(["web_search", "director.capabilities.inspect"]),
    );
    expect(toolNames).not.toContain("mcp__disabled__mcp_status");
    expect(result.conversationRuntime.finalText).toContain("MCP 工具列表已加载");
  });

  it("records model-requested MCP tool calls in the shared external tool queue history", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-mcp-tool-exec-"));
    tempRoots.push(workspaceRoot);
    const mcpSdkRoot = join(
      currentDir,
      "../../../packages/conversation-runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/server",
    );
    const serverScript = join(workspaceRoot, "mcp-ping-server.mjs");
    writeFileSync(
      serverScript,
      `
import { McpServer } from ${JSON.stringify(pathToFileURL(join(mcpSdkRoot, "mcp.js")).href)};
import { StdioServerTransport } from ${JSON.stringify(pathToFileURL(join(mcpSdkRoot, "stdio.js")).href)};

const server = new McpServer({ name: "director-desktop-test", version: "1.0.0" });
server.registerTool("ping", { description: "Ping tool" }, async () => ({ content: [{ type: "text", text: "pong from MCP" }] }));
await server.connect(new StdioServerTransport());
`,
      "utf8",
    );
    writeFileSync(
      join(workspaceRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          local: {
            type: "stdio",
            command: process.execPath,
            args: [serverScript],
            timeoutMs: 5_000,
          },
        },
      }),
    );
    const calls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          calls.push({
            url,
            method: init.method,
            body,
          });
          const hasMcpResult = body.messages?.some(
            (message) =>
              message.role === "tool" &&
              message.tool_call_id === "call-mcp-ping" &&
              String(message.content).includes("pong from MCP"),
          );
          if (!hasMcpResult) {
            return jsonResponse({
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      {
                        id: "call-mcp-ping",
                        type: "function",
                        function: {
                          name: "mcp__local__ping",
                          arguments: JSON.stringify({}),
                        },
                      },
                    ],
                  },
                },
              ],
            });
          }
          return jsonResponse({
            choices: [
              {
                message: {
                  content: "MCP ping 已完成。",
                },
              },
            ],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-mcp-exec-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "调用 local MCP ping 工具",
      surface: "workbench",
    });

    expect(calls[0]?.body?.tools?.map((tool) => tool.function?.name)).toContain("mcp__local__ping");
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(
      calls.some((call) =>
        call.body?.messages?.some(
          (message) =>
            message.role === "tool" &&
            message.tool_call_id === "call-mcp-ping" &&
            String(message.content).includes("pong from MCP"),
        ),
      ),
    ).toBe(true);
    expect(result.externalToolBus.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: "mcp__local__ping",
          operationId: "mcp.tool",
          status: "completed",
          ok: true,
        }),
      ]),
    );
    expect(result.apiProviderRun.output).toContain("MCP ping 已完成");
    expect(JSON.stringify(result)).not.toContain("sk-mcp-exec-secret");
  }, 15_000);

  it("asks before installing an MCP server from ordinary desktop chat and writes config only after approval", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-mcp-install-approval-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "toolApproval.autoAllowTrustedDesktop.enabled": false,
    });
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async () =>
          jsonResponse({
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    {
                      id: "call-mcp-upsert-context7",
                      type: "function",
                      function: {
                        name: "director.mcp.server.upsert",
                        arguments: JSON.stringify({
                          serverName: "context7",
                          transport: "stdio",
                          command: "node",
                          args: ["missing-context7-mcp.js"],
                          reason: "用户要求安装 Context7 MCP。",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-mcp-install",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const pending = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "安装 Context7 MCP",
      surface: "workbench",
    });

    expect(pending.runtimeToolApproval).toMatchObject({
      pendingCount: 1,
      latest: expect.objectContaining({
        approvalId: "tool:call-mcp-upsert-context7",
        status: "pending",
        toolName: "director.mcp.server.upsert",
        title: "确认 MCP：context7",
        summary: expect.stringContaining("安装/更新 MCP：context7"),
      }),
    });
    expect(existsSync(join(workspaceRoot, ".mcp.json"))).toBe(false);

    const approved = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUNTIME_TOOL_APPROVAL_DECIDE,
      approvalId: pending.runtimeToolApproval.latest.approvalId,
      decision: "approve",
    });

    const config = JSON.parse(readFileSync(join(workspaceRoot, ".mcp.json"), "utf8"));
    expect(config.mcpServers.context7).toMatchObject({
      type: "stdio",
      command: "node",
      args: ["missing-context7-mcp.js"],
      enabled: true,
    });
    expect(approved.runtimeToolApproval.latest).toMatchObject({
      status: "approved",
      result: expect.objectContaining({
        ok: true,
        toolName: "director.mcp.server.upsert",
        content: expect.stringContaining("MCP 已安装：context7"),
      }),
    });
  });

  it("executes model-requested learning tools in ordinary desktop chat", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-tool-chat-"));
    tempRoots.push(workspaceRoot);
    const calls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        hostApiUrl: "http://127.0.0.1:3201",
        hostApiFetch: async (url, init) => {
          calls.push({
            kind: "host",
            url,
            method: init?.method,
            body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
          });
          const path = new URL(url).pathname;
          if (path === "/v1/learning/jobs") {
            return jsonResponse({ job: { jobId: "job-learning-1", state: "created" } }, 201);
          }
          if (path === "/v1/learning/jobs/job-learning-1/run") {
            return jsonResponse({
              result: {
                candidateCount: 1,
                candidates: [{ candidateId: "exp-tool-1", title: "Seedance 2.0 最新玩法" }],
              },
            });
          }
          if (path === "/v1/catalog") {
            return jsonResponse(createEmptyHostApiCatalogFixture());
          }
          throw new Error(`unexpected Host API path ${path}`);
        },
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          calls.push({
            kind: "provider",
            url,
            method: init.method,
            body,
          });
          const hasToolResult = body.messages?.some(
            (message) =>
              message.role === "tool" &&
              String(message.content).includes("Seedance 2.0 最新玩法"),
          );
          if (!hasToolResult) {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () =>
                JSON.stringify({
                  choices: [
                    {
                      message: {
                        content: "",
                        tool_calls: [
                          {
                            id: "call-learning-1",
                            type: "function",
                            function: {
                              name: "director.learning.query",
                              arguments: JSON.stringify({ query: "seedance2.0 最新玩法" }),
                            },
                          },
                        ],
                      },
                    },
                  ],
                }),
            };
          }
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: "已完成搜索学习，生成 1 条待审经验候选。去经验库审核后即可沉淀。",
                    },
                  },
                ],
              }),
          };
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-tool-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "去公众号找一下有没有 seedance2.0 最新玩法，学习下来",
      surface: "workbench",
    });

    const providerCalls = calls.filter((call) => call.kind === "provider");
    expect(providerCalls).toHaveLength(2);
    expect(providerCalls[0]?.body?.tools?.map((tool) => tool.function?.name)).toEqual(
      expect.arrayContaining([
        "web_search",
        "web_extract",
        "director.learning.query",
        "director.comfyui.create_workflow",
      ]),
    );
    expect(providerCalls[1]?.body?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          tool_calls: [
            expect.objectContaining({
              id: "call-learning-1",
              function: expect.objectContaining({ name: "director.learning.query" }),
            }),
          ],
        }),
        expect.objectContaining({
          role: "tool",
          content: expect.stringContaining("Seedance 2.0 最新玩法"),
        }),
      ]),
    );
    const learningJob = calls.find(
      (call) => call.kind === "host" && new URL(call.url).pathname === "/v1/learning/jobs",
    );
    expect(learningJob?.body).toMatchObject({
      kind: "query",
      queries: ["seedance2.0 最新玩法"],
      privacy: "public",
    });
    expect(result.apiProviderRun.output).toContain("生成 1 条待审经验候选");
    expect(result.runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.tool",
          payload: expect.objectContaining({
            tool: expect.objectContaining({
              name: "director.learning.query",
              phase: "requested",
            }),
          }),
        }),
        expect.objectContaining({
          kind: "runtime.tool",
          payload: expect.objectContaining({
            tool: expect.objectContaining({
              name: "director.learning.query",
              phase: "completed",
            }),
          }),
        }),
      ]),
    );
    expect(result.apiProviderRun.runtimeEvents).toEqual(result.runtimeEvents);
  });

  it("lets ordinary desktop chat read experience candidates for learned-summary followups", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-candidate-followup-"));
    tempRoots.push(workspaceRoot);
    const candidate = createExperienceCandidateFixture({
      candidateId: "experience-ponyo-storyboard",
      title: "波妞PONYO：从九宫格分镜改用六宫格故事板",
      quality: { score: 90, verdict: "usable", reasons: [] },
      evidencePreview:
        "媒体资源：pbs.twimg.com 图片、视频封面、blob:https://x.com/video；没有 vision_analyzed 记录。",
    });
    let providerTurn = 0;
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          experience: {
            total: 1,
            candidates: [
              {
                candidate,
                status: "pending",
                latestReview: null,
                promotions: [],
                latestPromotion: null,
                promoted: false,
                taxonomy: null,
              },
            ],
            artifacts: [],
            artifactTotal: 0,
            quarantineTotal: 0,
            quarantined: [],
            taxonomy: {
              schemaVersion: "director.experience.taxonomy.v1",
              categories: [],
              tags: [],
              candidates: [],
            },
          },
        }),
        apiProviderFetch: async (_url, init) => {
          providerTurn += 1;
          return fakeLearningEvidenceAwareProviderResponse(
            init,
            "我学到的是：这条经验建议把 AI 视频前期的九宫格分镜改成六宫格故事板，用更少的格子锁定时间、场景、运镜和情绪，降低前期拆镜成本。",
          );
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "回答我刚才学到了什么",
      surface: "workbench",
    });
    const completedToolEvent = result.runtimeEvents.find(
      (event) =>
        event.kind === "runtime.tool" &&
        event.payload?.tool?.name === "director.experience.candidates.list" &&
        event.payload?.tool?.phase === "completed",
    );

    const content = completedToolEvent?.payload?.tool?.outputPreview;
    expect(content).toContain("answer_guidance");
    expect(content).toContain("六宫格故事板");
    expect(content).toContain("没有证据表明已调用视觉/视频理解模型");
    expect(providerTurn).toBeGreaterThan(0);
    expect(result.conversationRuntime.replySource).toBe("tool-loop");
    expect(result.conversationRuntime.finalText).toContain("六宫格故事板");
    expect(result.conversationRuntime.finalText).toContain("https://example.test/lesson");
    expect(result.conversationRuntime.finalText).toContain("媒体未理解");
    expect(result.conversationRuntime.finalText).not.toContain("<learning-evidence-context>");
    expect(result.conversationRuntime.evidenceDisclosure).toMatchObject({
      schemaVersion: "director.desktop.evidence-disclosure.v1",
      sourceCount: 1,
      sources: [
        expect.objectContaining({
          url: "https://example.test/lesson",
          fullBodyChars: expect.any(Number),
          sourceAccessStatus: "available",
          readStatus: "read",
          mediaUnderstandingStatus: "not_understood_without_user_authorization",
        }),
      ],
    });
    expect(result.apiProviderRun.evidenceDisclosure).toEqual(
      result.conversationRuntime.evidenceDisclosure,
    );
  });

  it("orders learned-summary candidate reads by latest candidate and exposes login-shell quality notes", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-candidate-latest-"));
    tempRoots.push(workspaceRoot);
    const olderStoryCandidate = createExperienceCandidateFixture({
      candidateId: "experience-ponyo-storyboard",
      title: "波妞PONYO：从九宫格分镜改用六宫格故事板",
      quality: { score: 90, verdict: "usable", reasons: [] },
      evidencePreview:
        "视频制作干货分享｜为什么我放弃了九宫格分镜，改用六宫格故事板。媒体资源：pbs.twimg.com 图片、视频封面、blob:https://x.com/video；没有 vision_analyzed 记录。",
      createdAtMs: 100,
      sourceRef: "https://x.com/ponyodong/status/2055150198989746559",
    });
    const latestLoginCandidate = createExperienceCandidateFixture({
      candidateId: "experience-ponyo-login-shell",
      title: "Pasted lesson: https://x.com/ponyodong/status/2055150198989746559",
      quality: { score: 90, verdict: "usable", reasons: [] },
      evidencePreview:
        "X 的新用户？立即注册。使用 Google 账号注册。使用 Apple 注册。服务条款。相关用户。",
      createdAtMs: 200,
      sourceRef: "https://x.com/ponyodong/status/2055150198989746559",
    });
    let providerTurn = 0;
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          experience: {
            total: 2,
            candidates: [
              {
                candidate: olderStoryCandidate,
                status: "pending",
                latestReview: null,
                promotions: [],
                latestPromotion: null,
                promoted: false,
                taxonomy: null,
              },
              {
                candidate: latestLoginCandidate,
                status: "pending",
                latestReview: null,
                promotions: [],
                latestPromotion: null,
                promoted: false,
                taxonomy: null,
              },
            ],
            artifacts: [],
            artifactTotal: 0,
            quarantineTotal: 0,
            quarantined: [],
            taxonomy: {
              schemaVersion: "director.experience.taxonomy.v1",
              categories: [],
              tags: [],
              candidates: [],
            },
          },
        }),
        apiProviderFetch: async (_url, init) => {
          providerTurn += 1;
          return fakeLearningEvidenceAwareProviderResponse(
            init,
            "最近这条候选更像 X 登录/注册壳，不是可用正文；真正的六宫格故事板候选排在后面，可以作为对照但不能被登录壳覆盖。",
          );
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "回答我刚才学到了什么",
      surface: "workbench",
    });
    const completedToolEvent = result.runtimeEvents.find(
      (event) =>
        event.kind === "runtime.tool" &&
        event.payload?.tool?.name === "director.experience.candidates.list" &&
        event.payload?.tool?.phase === "completed",
    );

    const content = completedToolEvent?.payload?.tool?.outputPreview;
    expect(content).toContain("1. Pasted lesson: https://x.com/ponyodong/status/2055150198989746559");
    expect(content).toContain("content_quality: 抓取内容主要是 X 登录/注册或侧栏信息");
    expect(content).toContain("2. 波妞PONYO：从九宫格分镜改用六宫格故事板");
    expect(content).toContain("source: https://x.com/ponyodong/status/2055150198989746559");
    expect(content).toContain("没有证据表明已调用视觉/视频理解模型");
  });

  it("exposes media authorization and budget request in learned-summary candidate reads", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-candidate-media-auth-"));
    tempRoots.push(workspaceRoot);
    const candidate = createExperienceCandidateFixture({
      candidateId: "experience-ponyo-media-auth",
      title: "波妞PONYO：从九宫格分镜改用六宫格故事板",
      quality: { score: 90, verdict: "usable", reasons: [] },
      evidencePreview:
        "视频制作干货分享｜六宫格故事板。媒体资源：pbs.twimg.com 图片、blob:https://x.com/video；没有 vision_analyzed 记录。",
      createdAtMs: 200,
      sourceRef: "https://x.com/ponyodong/status/2055150198989746559",
    });
    const artifact = {
      artifactId: "artifact-quality-1",
      sourceRef: "https://x.com/ponyodong/status/2055150198989746559",
      sourceKind: "browser-page",
      readableContent: candidate.evidencePreview,
      metadata: {
        mediaAuthorizationRequest: {
          required: true,
          assetCount: 2,
          imageCount: 1,
          videoCount: 1,
          audioCount: 0,
          unknownCount: 0,
          defaultMode: "media_inventory",
          recommendedMode: "low_cost",
          estimatedCostTier: "medium",
          estimatedTokenBudget: {
            mediaInventory: 0,
            lowCost: 7200,
            deepMultimodal: 28000,
          },
          privacy: "pii_potential",
          options: [
            {
              mode: "low_cost",
              label: "低成本精读重点媒体",
              requiresUserAuthorization: true,
              estimatedTokenBudget: 7200,
              estimatedCostTier: "medium",
            },
          ],
        },
      },
    };
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          experience: {
            total: 1,
            candidates: [
              {
                candidate,
                status: "pending",
                latestReview: null,
                promotions: [],
                latestPromotion: null,
                promoted: false,
                taxonomy: null,
              },
            ],
            artifacts: [artifact],
            artifactTotal: 1,
            quarantineTotal: 0,
            quarantined: [],
            taxonomy: {
              schemaVersion: "director.experience.taxonomy.v1",
              categories: [],
              tags: [],
              candidates: [],
            },
          },
        }),
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "回答我刚才学到了什么，媒体图片视频要怎么处理",
      surface: "workbench",
    });
    const completedToolEvent = result.runtimeEvents.find(
      (event) =>
        event.kind === "runtime.tool" &&
        event.payload?.tool?.name === "director.experience.candidates.list" &&
        event.payload?.tool?.phase === "completed",
    );

    const content = completedToolEvent?.payload?.tool?.outputPreview;
    expect(content).toContain("media_authorization");
    expect(content).toContain("assets=2");
    expect(content).toContain("images=1");
    expect(content).toContain("videos=1");
    expect(content).toContain("recommended=low_cost");
    expect(content).toContain("budget=medium");
    expect(content).toContain("未授权前不要把媒体内容当成已学经验入库");
    expect(result.conversationRuntime.finalText).toContain("媒体授权");
    expect(result.conversationRuntime.finalText).toContain("推荐：低成本精读重点媒体");
  }, 15_000);

  it("keeps learned-summary media metadata aligned with evidence disclosure without admitting media conclusions", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-candidate-media-boundary-"));
    tempRoots.push(workspaceRoot);
    const sourceRef = "https://x.com/TanLuAI/status/2056949172629381407";
    const candidateId = "experience-tanluai-asset-sheet";
    const candidate = createExperienceCandidateFixture({
      candidateId,
      title: "Pasted lesson: OpenCLI Twitter/X thread",
      quality: { score: 90, verdict: "usable", reasons: [] },
      evidencePreview:
        "GPT做资产图，人设图真的太方便了。哪个部分不满意就再生成一张。以文字标记每一个区域的名称。",
      createdAtMs: 200,
      sourceRef,
    });
    candidate.summary =
      "经验提炼：GPT做资产图，人设图真的太方便了；哪个部分不满意就再生成一张。";
    candidate.applicability =
      "Use when Director Angel needs reusable operating experience from user-pasted material.";
    candidate.risks = [
      "Experience candidate is distilled from source material; raw source remains evidence and must not bypass review.",
      "Pasted material may include private, stale, or unattributed guidance until reviewed.",
      "Privacy classification: public.",
    ];
    const artifact = {
      artifactId: "artifact-tanluai-asset-sheet",
      sourceRef,
      sourceKind: "browser-page",
      readableContent:
        "GPT做资产图，人设图真的太方便了。哪个部分不满意就再生成一张。以文字标记每一个区域的名称。",
      metadata: {
        candidateIds: [candidateId],
        mediaAuthorizationRequest: {
          required: true,
          assetCount: 3,
          imageCount: 3,
          videoCount: 0,
          audioCount: 0,
          unknownCount: 0,
          recommendedMode: "low_cost",
          estimatedCostTier: "low",
          estimatedTokenBudget: {
            mediaInventory: 0,
            lowCost: 3600,
            deepMultimodal: 12000,
          },
        },
        mediaUnderstanding: {
          status: "metadata_understood",
          runner: "media-understanding.local",
          processedCount: 3,
          semanticUnderstanding: "metadata-only",
        },
      },
      mediaEvidenceRefs: [
        {
          id: "media-image-1",
          kind: "image",
          sourceRef: `${sourceRef}#media-image-1`,
          realVisualUnderstanding: false,
          metadata: { semanticUnderstanding: "metadata-only" },
        },
        {
          id: "media-image-2",
          kind: "image",
          sourceRef: `${sourceRef}#media-image-2`,
          realVisualUnderstanding: false,
          metadata: { semanticUnderstanding: "metadata-only" },
        },
        {
          id: "media-image-3",
          kind: "image",
          sourceRef: `${sourceRef}#media-image-3`,
          realVisualUnderstanding: false,
          metadata: { semanticUnderstanding: "metadata-only" },
        },
      ],
    };
    let providerTurn = 0;
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          experience: {
            total: 1,
            candidates: [
              {
                candidate,
                status: "pending",
                latestReview: null,
                promotions: [],
                latestPromotion: null,
                promoted: false,
                taxonomy: null,
              },
            ],
            artifacts: [artifact],
            artifactTotal: 1,
            quarantineTotal: 0,
            quarantined: [],
            taxonomy: {
              schemaVersion: "director.experience.taxonomy.v1",
              categories: [],
              tags: [],
              candidates: [],
            },
          },
        }),
        apiProviderFetch: async (_url, init) => {
          providerTurn += 1;
          return fakeLearningEvidenceAwareProviderResponse(
            init,
            "这次学到的是：GPT 做资产图和人设图时，可以结合前序视频截图和剧情设定生成多角色资产详情图；不满意的局部再单独重生成，适合边生成边扩展剧情和人物。",
          );
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "然后学习了什么？",
      surface: "workbench",
    });

    expect(providerTurn).toBeGreaterThan(0);
    expect(result.conversationRuntime.replySource).toBe("tool-loop");
    expect(result.conversationRuntime.finalText.replace(/\s+/gu, "")).toContain("GPT做资产图");
    expect(result.conversationRuntime.finalText).toContain("媒体未理解");
    expect(result.conversationRuntime.finalText).toContain(sourceRef);
    expect(result.conversationRuntime.finalText).not.toContain("Use when Director Angel");
    expect(result.conversationRuntime.finalText).not.toContain("Pasted material may include");
    expect(result.conversationRuntime.finalText).not.toContain("Privacy classification");
    expect(result.conversationRuntime.finalText).not.toContain("media-understanding.local 已处理 3 个媒体");
    expect(result.conversationRuntime.evidenceDisclosure.sources[0]).toMatchObject({
      url: sourceRef,
      mediaCount: 3,
      mediaInventory: expect.objectContaining({
        assetCount: 3,
        imageCount: 3,
      }),
      mediaUnderstandingStatus: "metadata_only",
      mediaAdmission: expect.objectContaining({
        canAdmitMediaContent: false,
        requiredNextAction: "request_user_authorization",
      }),
    });
    expect(result.apiProviderRun.evidenceDisclosure).toEqual(
      result.conversationRuntime.evidenceDisclosure,
    );
  });

  it("answers learning evidence followups from prior artifacts without re-reading the external URL", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-evidence-followup-"));
    tempRoots.push(workspaceRoot);
    const sourceRef = "https://x.com/example_author/status/2055849751317524982";
    const candidate = createExperienceCandidateFixture({
      candidateId: "experience-x-sushi-storyboard",
      title: "X：寿司故事板提示词案例",
      quality: { score: 90, verdict: "usable", reasons: [] },
      evidencePreview:
        "Created this cinematic sushi storyboard with GPT Image 2 + Seedance 2.0. 媒体资源：pbs.twimg.com 图片、blob:https://x.com/video；没有 vision_analyzed 记录。",
      createdAtMs: 200,
      sourceRef,
    });
    const artifact = {
      artifactId: "artifact-x-sushi-storyboard",
      sourceRef,
      sourceKind: "browser-page",
      readableContent: candidate.evidencePreview,
      createdAtMs: 200,
      metadata: {
        url: sourceRef,
        fullBodyChars: 1680,
        full_body_chars: 1680,
        secondPassExtracted: true,
        persisted: true,
        admitted: false,
        mediaAuthorizationRequest: {
          required: true,
          assetCount: 3,
          imageCount: 1,
          videoCount: 1,
          audioCount: 0,
          unknownCount: 0,
          posterCount: 1,
          blobCount: 1,
          recommendedMode: "low_cost",
          estimatedCostTier: "medium",
          estimatedTokenBudget: {
            mediaInventory: 0,
            lowCost: 7200,
            deepMultimodal: 28000,
          },
        },
      },
      mediaEvidenceRefs: [
        {
          id: "media-image-1",
          kind: "image",
          sourceRef: "https://pbs.twimg.com/media/storyboard.jpg",
          realVisualUnderstanding: false,
        },
        {
          id: "media-video-1",
          kind: "video",
          sourceRef: "blob:https://x.com/video-1",
          poster: "https://pbs.twimg.com/ext_tw_video_thumb/storyboard.jpg",
          realVisualUnderstanding: false,
        },
      ],
    };
    let providerTurn = 0;
    let browserReads = 0;
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          experience: {
            total: 1,
            candidates: [
              {
                candidate,
                status: "pending",
                latestReview: null,
                promotions: [],
                latestPromotion: null,
                promoted: false,
                taxonomy: null,
              },
            ],
            artifacts: [artifact],
            artifactTotal: 1,
            quarantineTotal: 0,
            quarantined: [],
            taxonomy: {
              schemaVersion: "director.experience.taxonomy.v1",
              categories: [],
              tags: [],
              candidates: [],
            },
          },
        }),
        browserToolService: {
          navigate: async () => {
            browserReads += 1;
            return {
              success: true,
              url: sourceRef,
              title: "Should not be fetched",
              snapshot: "",
              element_count: 0,
            };
          },
        },
        apiProviderFetch: async () => {
          providerTurn += 1;
          return fakeApiProviderTextResponse("不应调用模型重新解释证据。");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt:
        `看详情。请只基于刚才 ${sourceRef} 的学习结果，列出证据字段：URL、全文字符数、是否二次提取、图片/视频/音频/poster/blob 数量、是否已入库、媒体是否已理解；并明确说明未授权时哪些内容不能当结论。`,
      surface: "workbench",
    });

    expect(providerTurn).toBe(0);
    expect(browserReads).toBe(0);
    expect(result.conversationRuntime.replySource).toBe("structured-renderer");
    expect(result.conversationRuntime.finalText).toContain(sourceRef);
    expect(result.conversationRuntime.finalText).toContain("全文字符数：1680");
    expect(result.conversationRuntime.finalText).toContain("二次提取：是");
    expect(result.conversationRuntime.finalText).toContain("图片 1、视频 1、音频 0、poster 1、blob 1");
    expect(result.conversationRuntime.finalText).toContain("是否已入库：否");
    expect(result.conversationRuntime.finalText).toContain("媒体是否已理解：否");
    expect(result.conversationRuntime.finalText).toContain("文本已读，媒体未理解");
    expect(result.conversationRuntime.finalText).toContain("不能把图片、视频、音频里的画面、动作、字幕或声音当结论");
  });

  it("routes collection-value questions to the model instead of evidence fields", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-learning-value-"));
    tempRoots.push(workspaceRoot);
    const sourceRef = "https://x.com/example/status/2058393033880609001";
    let providerTurn = 0;
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          experience: {
            candidates: [
              {
                candidate: createExperienceCandidateFixture({
                  candidateId: "experience-learning-value",
                  sourceRef,
                  evidencePreview: "这是一条关于 AI 视频提示词结构和复用方法的学习资料。",
                }),
                status: "pending",
              },
            ],
          },
        }),
        apiProviderFetch: async (_url, init) => {
          providerTurn += 1;
          return fakeLearningEvidenceAwareProviderResponse(
            init,
            "最值得保存的三点是：结构化提示词、可复用变量、以及媒体边界。",
          );
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "这条内容最值得保存的三点是什么？只基于刚才的学习内容回答。",
      surface: "workbench",
    });

    expect(providerTurn).toBeGreaterThan(0);
    expect(result.conversationRuntime.finalText).toContain("最值得保存");
    expect(result.conversationRuntime.finalText).not.toContain("证据字段");
  });

  it("answers learning evidence followups from runtime tool evidence without re-reading the external URL", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-evidence-tool-store-"));
    tempRoots.push(workspaceRoot);
    const sourceRef = "https://x.com/example_author/status/2055849751317524982";
    const recordsDir = join(
      workspaceRoot,
      ".hotflow",
      "conversation-runtime",
      "tool-evidence",
      "records",
    );
    mkdirSync(recordsDir, { recursive: true });
    const baseRecord = {
      id: "tool-evidence-desktop-required-web-extract",
      sourceKind: "url",
      sourceRef,
      observedAtMs: 1_779_000_000_000,
      metadata: {
        capability: "web.extract",
        sourceUrl: sourceRef,
        preview:
          "status: success\nurl: https://x.com/example_author/status/2055849751317524982\nmedia_inventory: assets=7 images=4 videos=1 audios=0 posters=1 blobs=1\nfull_body_chars: 3386",
        externalToolMetadata: {
          toolOutput: {
            url: sourceRef,
            title: "X sushi storyboard",
            body: "Created this cinematic sushi storyboard with GPT Image 2 + Seedance 2.0.",
            full_body_chars: 3386,
            preview_chars: 1200,
            body_truncated_for_model: true,
            media_inventory: {
              assetCount: 7,
              imageCount: 4,
              videoCount: 1,
              audioCount: 0,
              posterCount: 1,
              blobCount: 1,
            },
            evidence_disclosure: {
              url: sourceRef,
              full_body_chars: 3386,
              preview_chars: 1200,
              persisted: true,
              media_understood: false,
              media_understanding_status: "not_understood_without_user_authorization",
            },
            evidenceProvenance: {
              media: {
                assetCount: 7,
                canUseMediaAsConclusion: false,
              },
              knowledge: {
                admittedTargetCount: 0,
                mediaContentAdmitted: false,
              },
            },
            full_body_artifact: {
              id: "web-extract-full-body-x-sushi",
            },
          },
        },
      },
    };
    writeFileSync(
      join(recordsDir, "tool-evidence-desktop-required-web-extract.json"),
      `${JSON.stringify(baseRecord, null, 2)}\n`,
    );
    writeFileSync(
      join(recordsDir, "tool-evidence-desktop-required-web-extract-full-body-read.json"),
      `${JSON.stringify(
        {
          ...baseRecord,
          id: "tool-evidence-desktop-required-web-extract-full-body-read",
          observedAtMs: 1_779_000_000_100,
          metadata: {
            ...baseRecord.metadata,
            capability: "web.extract.artifact.read",
            preview:
              "status: success\nurl: https://x.com/example_author/status/2055849751317524982\nmedia_inventory: assets=7 images=4 videos=1 audios=0 posters=1 blobs=1\nfull_body_chars: 3386\nbody_truncated_for_model: false",
          },
        },
        null,
        2,
      )}\n`,
    );
    let providerTurn = 0;
    let browserReads = 0;
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture(),
        browserToolService: {
          navigate: async () => {
            browserReads += 1;
            return {
              success: true,
              url: sourceRef,
              title: "Should not be fetched",
              snapshot: "",
              element_count: 0,
            };
          },
        },
        apiProviderFetch: async () => {
          providerTurn += 1;
          return fakeApiProviderTextResponse("不应调用模型重新解释证据。");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt:
        `看详情。请只基于刚才 ${sourceRef} 的学习结果，列出证据字段：URL、全文字符数、是否二次提取、图片/视频/音频/poster/blob 数量、是否已入库、媒体是否已理解；并明确说明未授权时哪些内容不能当结论。`,
      surface: "workbench",
    });

    expect(providerTurn).toBe(0);
    expect(browserReads).toBe(0);
    expect(result.conversationRuntime.replySource).toBe("structured-renderer");
    expect(result.conversationRuntime.finalText).toContain(sourceRef);
    expect(result.conversationRuntime.finalText).toContain("全文字符数：3386");
    expect(result.conversationRuntime.finalText).toContain("二次提取：是");
    expect(result.conversationRuntime.finalText).toContain("图片 4、视频 1、音频 0、poster 1、blob 1");
    expect(result.conversationRuntime.finalText).toContain("是否已入库：否");
    expect(result.conversationRuntime.finalText).toContain("媒体是否已理解：否");
    expect(result.conversationRuntime.finalText).toContain("文本已读，媒体未理解");
    expect(result.conversationRuntime.evidenceDisclosure.sources[0]).toMatchObject({
      fullBodyChars: 3386,
      secondPassExtracted: true,
      mediaInventory: expect.objectContaining({
        imageCount: 4,
        videoCount: 1,
        posterCount: 1,
        blobCount: 1,
      }),
      mediaAdmission: expect.objectContaining({
        canAdmitMediaContent: false,
        requiredNextAction: "request_user_authorization",
      }),
    });
    const listed = await bridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_LIST,
      activeOnly: false,
      turnId: result.conversationRuntime.turnId,
    });
    const task = listed.taskRuntime.tasks.find(
      (item) => item.payload?.turnId === result.conversationRuntime.turnId,
    );
    expect(task).toMatchObject({
      evidenceDisclosure: expect.objectContaining({
        sourceCount: 1,
      }),
      payload: expect.objectContaining({
        evidenceDisclosure: expect.objectContaining({
          sourceCount: 1,
        }),
      }),
    });
    expect(task.payload.evidenceDisclosure.sources[0]).toMatchObject({
      fullBodyChars: 3386,
      secondPassExtracted: true,
      mediaAdmission: expect.objectContaining({
        canAdmitMediaContent: false,
        requiredNextAction: "request_user_authorization",
      }),
    });

    const read = await bridge.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_READ,
      taskId: task.id,
    });
    expect(read.taskRuntimeTask.payload.evidenceDisclosure.sources[0]).toMatchObject({
      fullBodyChars: 3386,
      mediaInventory: expect.objectContaining({
        imageCount: 4,
        videoCount: 1,
      }),
    });
  });

  it("does not claim text was read when prior runtime evidence has zero body characters", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-zero-body-evidence-"));
    tempRoots.push(workspaceRoot);
    const sourceRef = "https://x.com/Adam38363368936/status/2056318384317620663";
    const recordsDir = join(
      workspaceRoot,
      ".hotflow",
      "conversation-runtime",
      "tool-evidence",
      "records",
    );
    mkdirSync(recordsDir, { recursive: true });
    writeFileSync(
      join(recordsDir, "tool-evidence-zero-body-x.json"),
      `${JSON.stringify(
        {
          id: "tool-evidence-zero-body-x",
          sourceKind: "url",
          sourceRef,
          observedAtMs: 1_779_100_000_000,
          metadata: {
            capability: "browser_navigate",
            sourceUrl: sourceRef,
            sourceAccessStatus: "failed",
            readStatus: "failed",
            failedReason: "Chrome CDP was not ready before timeout.",
            preview:
              "status: failed\nurl: https://x.com/Adam38363368936/status/2056318384317620663\nfull_body_chars: 0\nerror: Chrome CDP was not ready before timeout.",
            externalToolMetadata: {
              toolOutput: {
                url: sourceRef,
                title: "Chrome CDP not ready",
                body: "",
                full_body_chars: 0,
                sourceAccessStatus: "failed",
                readStatus: "failed",
                failedReason: "Chrome CDP was not ready before timeout.",
                evidence_disclosure: {
                  url: sourceRef,
                  full_body_chars: 0,
                  source_access_status: "failed",
                  read_status: "failed",
                  failed_reason: "Chrome CDP was not ready before timeout.",
                  media_understood: false,
                },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    let providerTurn = 0;
    let browserReads = 0;
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture(),
        browserToolService: {
          navigate: async () => {
            browserReads += 1;
            return {
              success: true,
              url: sourceRef,
              title: "Should not be fetched",
              snapshot: "",
              element_count: 0,
            };
          },
        },
        apiProviderFetch: async () => {
          providerTurn += 1;
          return fakeApiProviderTextResponse("不应调用模型重新解释证据。");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt:
        `看详情。请只基于刚才 ${sourceRef} 的学习结果，列出证据字段：URL、全文字符数、是否二次提取、图片/视频/音频/poster/blob 数量、是否已入库、媒体是否已理解；并明确说明没读到正文时不能猜。`,
      surface: "workbench",
    });

    expect(providerTurn).toBe(0);
    expect(browserReads).toBe(0);
    expect(result.conversationRuntime.replySource).toBe("structured-renderer");
    expect(result.conversationRuntime.finalText).toContain(sourceRef);
    expect(result.conversationRuntime.finalText).toContain("全文字符数：0");
    expect(result.conversationRuntime.finalText).toContain("正文读取状态：未读到可信正文");
    expect(result.conversationRuntime.finalText).toContain("失败原因：Chrome CDP was not ready before timeout.");
    expect(result.conversationRuntime.finalText).toContain("不能把正文或媒体内容当结论");
    expect(result.conversationRuntime.finalText).not.toContain("文本已读，媒体未理解");
    expect(result.conversationRuntime.evidenceDisclosure.sources[0]).toMatchObject({
      url: sourceRef,
      fullBodyChars: 0,
      sourceAccessStatus: "failed",
      readStatus: "failed",
      failedReason: "Chrome CDP was not ready before timeout.",
      persisted: false,
      admitted: false,
    });
  });

  it("treats reviewed or promoted local learning evidence as admitted even when artifact metadata omits admitted", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-evidence-promoted-admitted-"));
    tempRoots.push(workspaceRoot);
    const sourceRef = "https://x.com/example_author/status/2055969783951093986";
    const localLessonSourceRef =
      "file:///tmp/director-angel/learning-sources/x-example-2055969783951093986";
    const artifact = {
      artifactId: "artifact_x_example_2055969783951093986",
      sourceRef: `${localLessonSourceRef}#lesson.md`,
      sourceKind: "local-directory",
      title: "lesson.md",
      readableContent: [
        "# X/Twitter Lesson: GPT Image 2 Original Character Generator",
        `Source URL: ${sourceRef}`,
        "Total extracted text characters: 5275",
        "Second extraction: yes",
        "Media inventory: 5 images, 0 videos, 0 audio, 0 poster, 0 blob",
        "Media understood: no",
        "Use variables [CHARACTER SEED], [AGE / BODY TYPE], [STYLE], [VISUAL MEDIUM].",
      ].join("\n"),
      metadata: {
        persisted: true,
      },
    };
    const candidate = {
      schemaVersion: "contracts.v1",
      candidateId: "experience_x_example_2055969783951093986",
      sourceAdapter: {
        schemaVersion: "contracts.v1",
        adapterId: "local_directory_x_example_2055969783951093986",
        sourceKind: "local-directory",
        sourceRef: localLessonSourceRef,
        privacy: "public",
        transformations: [],
      },
      title: "Local lesson: lesson.md",
      summary: "GPT Image 2 原创角色身份板提示结构。",
      applicability: "用于生成原创角色身份板。",
      risks: ["媒体只登记清单，未做视觉理解。"],
      tags: ["ai-prompting", "character-generation", "external-reference"],
      evidence: [
        {
          evidenceId: "evidence_x_example_2055969783951093986",
          sourceRef: `${localLessonSourceRef}#lesson.md`,
          path: "lesson.md",
          summary: "二次提取正文并记录媒体清单。",
        },
      ],
      sourceArtifactId: artifact.artifactId,
      sourceDigest: "sha256:example",
      evidencePreview: "GPT Image 2 Original Character Generator Prompt.",
      quality: {
        schemaVersion: "contracts.v1",
        verdict: "usable",
        score: 90,
        reasons: [],
      },
      status: "pending",
      privacy: "public",
      runtimeInjection: "disabled",
      provenance: "desktop-test",
      createdAtMs: 1_779_034_146_000,
    };
    let browserReads = 0;
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          experience: {
            total: 1,
            candidates: [
              {
                candidate,
                status: "accepted",
                latestReview: {
                  decision: "accepted",
                  decidedAtMs: 1_779_034_146_100,
                },
                promotions: [
                  {
                    promotionId: "promotion_x_example",
                    promotedTo: "director-knowledge-candidate",
                    promotedRef:
                      "knowledge://candidate/director-experience-experience-x-example-2055969783951093986",
                    promotedAtMs: 1_779_034_146_200,
                  },
                ],
                latestPromotion: {
                  promotionId: "promotion_x_example",
                  promotedTo: "director-knowledge-candidate",
                  promotedRef:
                    "knowledge://candidate/director-experience-experience-x-example-2055969783951093986",
                  promotedAtMs: 1_779_034_146_200,
                },
                promoted: true,
                taxonomy: null,
              },
            ],
            artifacts: [artifact],
            artifactTotal: 1,
            quarantineTotal: 0,
            quarantined: [],
            taxonomy: {
              schemaVersion: "director.experience.taxonomy.v1",
              categories: [],
              tags: [],
              candidates: [],
            },
          },
        }),
        browserToolService: {
          navigate: async () => {
            browserReads += 1;
            return {
              success: true,
              url: sourceRef,
              title: "Should not be fetched",
              snapshot: "",
              element_count: 0,
            };
          },
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt:
        "刚才学习的 GPT Image 2 原创角色身份板方法怎么用？请按宪法说明证据来源、全文字符数、是否二次提取、媒体数量、媒体是否理解、是否入库，并给我一个可执行模板。",
      surface: "workbench",
    });

    expect(browserReads).toBe(0);
    expect(result.conversationRuntime.replySource).toBe("structured-renderer");
    expect(result.conversationRuntime.finalText).toContain(sourceRef);
    expect(result.conversationRuntime.finalText).not.toContain(localLessonSourceRef);
    expect(result.conversationRuntime.finalText).toContain("是否已入库：是");
    expect(result.conversationRuntime.evidenceDisclosure.sources[0]).toMatchObject({
      url: sourceRef,
      admitted: true,
    });
  });

  it("answers keyword-only learning evidence followups from published learning evidence instead of stale empty tool shells", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-evidence-keyword-published-"));
    tempRoots.push(workspaceRoot);
    const sourceRef = "https://x.com/aimikoda/status/2055969783951093986";
    const localLessonSourceRef =
      "file:///Volumes/%E9%87%91%E9%87%91/code/hotflow/director-angel/.director-angel/workspace/learning-sources/x-aimikoda-2055969783951093986";
    const emptyRecordsDir = join(
      workspaceRoot,
      ".hotflow",
      "conversation-runtime",
      "tool-evidence",
      "records",
    );
    mkdirSync(emptyRecordsDir, { recursive: true });
    writeFileSync(
      join(emptyRecordsDir, "tool-evidence-empty-twitter-article.json"),
      `${JSON.stringify(
        {
          id: "tool-evidence-empty-twitter-article",
          sourceKind: "url",
          sourceRef: "opencli:twitter/article",
          observedAtMs: 1_779_000_200_000,
          metadata: {
            capability: "opencli.twitter.article",
            sourceUrl: "opencli:twitter/article",
            preview: "status: success\nurl: opencli:twitter/article\nfull_body_chars: 0",
            externalToolMetadata: {
              toolOutput: {
                url: "opencli:twitter/article",
                title: "empty twitter shell",
                body: "",
                full_body_chars: 0,
                evidence_disclosure: {
                  url: "opencli:twitter/article",
                  full_body_chars: 0,
                  media_understood: false,
                },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    const artifact = {
      artifactId: "artifact_x_aimikoda_2055969783951093986_10c015ddf4aa",
      sourceRef: `${localLessonSourceRef}#lesson.md`,
      sourceKind: "local-directory",
      title: "X/Twitter Lesson: GPT Image 2 Original Character Generator",
      readableContent: [
        "# X/Twitter Lesson: GPT Image 2 Original Character Generator",
        "Source URL: https://x.com/aimikoda/status/2055969783951093986",
        "Author: Koda / @aimikoda",
        "Total extracted text characters: 5275",
        "Second extraction: yes, via FxTwitter thread endpoint after OpenCLI auth failure",
        "Media inventory: 5 images, 0 videos, 0 audio, 0 poster, 0 blob",
        "Media understood: no",
        "Use four variables: [CHARACTER SEED], [AGE / BODY TYPE], [STYLE], [VISUAL MEDIUM].",
        "Create an artistic 16:9 CHARACTER IDENTITY BOARD with originality and authenticity rules.",
      ].join("\n"),
      metadata: {
        fullBodyChars: 5275,
        secondPassExtracted: true,
        admitted: true,
        persisted: true,
        mediaUnderstanding: {
          status: "not_understood_without_user_authorization",
          semanticUnderstanding: "none",
        },
      },
    };
    const candidate = {
      schemaVersion: "contracts.v1",
      candidateId: "experience_x_aimikoda_2055969783951093986_c634f2c13d64",
      sourceAdapter: {
        schemaVersion: "contracts.v1",
        adapterId: "local_directory_x_aimikoda_2055969783951093986",
        sourceKind: "local-directory",
        sourceRef: localLessonSourceRef,
        privacy: "public",
        transformations: [],
      },
      title: "Local lesson: lesson.md",
      summary:
        "使用变量驱动的提示结构生成原创角色身份板，通过原创性和真实性规则避免AI生成角色的重复面孔、通用设计和IP相似性。",
      applicability:
        "当Director Angel需要为GPT Image 2或类似图像模型生成原创角色身份板时使用。",
      risks: ["媒体只登记清单，未做视觉理解。"],
      tags: [
        "ai-prompting",
        "character-generation",
        "originality-rules",
        "external-reference",
      ],
      evidence: [
        {
          evidenceId: "evidence_x_aimikoda_2055969783951093986_d66cd679eaa9",
          sourceRef: `${localLessonSourceRef}#lesson.md`,
          path: "lesson.md",
          summary:
            "FxTwitter 二次提取了主帖和回复 Prompt；媒体只记录清单。",
        },
      ],
      sourceArtifactId: artifact.artifactId,
      sourceDigest: "sha256:b60654b306f847d7b706d3c28f3753d1f7b583a7a86c4e0895a5cca7ae62d97a",
      evidencePreview:
        "aimikoda GPT Image 2 Original Character Generator Prompt. Total extracted text characters: 5275. Media inventory: 5 images, 0 videos, 0 audio, 0 poster, 0 blob. Media understood: no.",
      quality: {
        schemaVersion: "contracts.v1",
        verdict: "usable",
        score: 90,
        reasons: ["local text artifact captured for review-gated learning"],
      },
      status: "accepted",
      privacy: "public",
      runtimeInjection: "disabled",
      provenance: "desktop-test",
      createdAtMs: 1_779_034_146_000,
    };
    const distractorArtifact = {
      artifactId: "artifact_other_image_text_without_inventory",
      sourceRef: "https://x.com/other/status/1",
      sourceKind: "local-directory",
      title: "Other image prompt note",
      readableContent:
        "This unrelated note mentions an image prompt but has no structured media inventory.",
      metadata: {
        url: "https://x.com/other/status/1",
        fullBodyChars: 82,
        persisted: true,
        admitted: true,
      },
    };
    const distractorCandidate = {
      schemaVersion: "contracts.v1",
      candidateId: "experience_other_image_text_without_inventory",
      sourceAdapter: {
        schemaVersion: "contracts.v1",
        adapterId: "local_directory_other_image_text_without_inventory",
        sourceKind: "local-directory",
        sourceRef: "file:///tmp/learning-sources/other-image-text",
        privacy: "public",
        transformations: [],
      },
      title: "Other image prompt note",
      summary: "无关图片提示词笔记。",
      applicability: "用于回归测试：没有 media inventory 的 image 文本不能打崩证据选择。",
      risks: [],
      tags: ["external-reference"],
      evidence: [
        {
          evidenceId: "evidence_other_image_text_without_inventory",
          sourceRef: "https://x.com/other/status/1",
          path: "lesson.md",
          summary: "无关来源。",
        },
      ],
      sourceArtifactId: distractorArtifact.artifactId,
      evidencePreview:
        "This unrelated note mentions an image prompt but has no structured media inventory.",
      quality: {
        schemaVersion: "contracts.v1",
        verdict: "usable",
        score: 90,
        reasons: [],
      },
      status: "accepted",
      privacy: "public",
      runtimeInjection: "disabled",
      provenance: "desktop-test",
      createdAtMs: 1_779_034_147_000,
    };
    let providerTurn = 0;
    let browserReads = 0;
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          experience: {
            total: 1,
            candidates: [
              {
                candidate,
                status: "accepted",
                latestReview: null,
                promotions: [
                  {
                    promotionId: "promotion_x_aimikoda",
                    promotedTo: "director-knowledge-candidate",
                    promotedRef:
                      "knowledge://candidate/director-experience-experience-x-aimikoda-2055969783951093986-c634f2c13d64",
                    promotedAtMs: 1_779_034_146_578,
                  },
                ],
                latestPromotion: {
                  promotionId: "promotion_x_aimikoda",
                  promotedTo: "director-knowledge-candidate",
                  promotedRef:
                    "knowledge://candidate/director-experience-experience-x-aimikoda-2055969783951093986-c634f2c13d64",
                  promotedAtMs: 1_779_034_146_578,
                },
                promoted: true,
                taxonomy: null,
              },
              {
                candidate: distractorCandidate,
                status: "accepted",
                latestReview: null,
                promotions: [],
                latestPromotion: null,
                promoted: true,
                taxonomy: null,
              },
            ],
            artifacts: [artifact, distractorArtifact],
            artifactTotal: 2,
            quarantineTotal: 0,
            quarantined: [],
            taxonomy: {
              schemaVersion: "director.experience.taxonomy.v1",
              categories: [],
              tags: [],
              candidates: [],
            },
          },
        }),
        browserToolService: {
          navigate: async () => {
            browserReads += 1;
            return {
              success: true,
              url: sourceRef,
              title: "Should not be fetched",
              snapshot: "",
              element_count: 0,
            };
          },
        },
        apiProviderFetch: async () => {
          providerTurn += 1;
          return fakeApiProviderTextResponse("不应调用模型重新解释证据。");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt:
        "刚才学习的 aimikoda GPT Image 2 原创角色身份板方法怎么用？请按宪法说明证据来源、全文字符数、是否二次提取、媒体数量、媒体是否理解、是否入库，并给我一个可执行模板。",
      surface: "workbench",
    });

    expect(providerTurn).toBe(0);
    expect(browserReads).toBe(0);
    expect(result.conversationRuntime.replySource).toBe("structured-renderer");
    expect(result.conversationRuntime.finalText).toContain(sourceRef);
    expect(result.conversationRuntime.finalText).not.toContain(localLessonSourceRef);
    expect(result.conversationRuntime.finalText).not.toContain("opencli:twitter/article");
    expect(result.conversationRuntime.finalText).toContain("全文字符数：5275");
    expect(result.conversationRuntime.finalText).toContain("二次提取：是");
    expect(result.conversationRuntime.finalText).toContain("图片 5、视频 0、音频 0、poster 0、blob 0");
    expect(result.conversationRuntime.finalText).toContain("是否已入库：是");
    expect(result.conversationRuntime.finalText).toContain("媒体是否已理解：否");
    expect(result.conversationRuntime.finalText).toContain("[CHARACTER SEED]");
    expect(result.conversationRuntime.finalText).toContain("[VISUAL MEDIUM]");
    expect(result.conversationRuntime.finalText).toContain("16:9 CHARACTER IDENTITY BOARD");
    expect(result.conversationRuntime.evidenceDisclosure.sources[0]).toMatchObject({
      url: sourceRef,
      fullBodyChars: 5275,
      secondPassExtracted: true,
      mediaInventory: expect.objectContaining({
        imageCount: 5,
        videoCount: 0,
      }),
      admitted: true,
      mediaAdmission: expect.objectContaining({
        canAdmitMediaContent: false,
        requiredNextAction: "request_user_authorization",
      }),
    });

    const identifyResult = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt:
        "这是哪个链接的内容：GPT Image 2 - Original Character Generator Prompt。只看到四个变量 [CHARACTER SEED]、[AGE / BODY TYPE]、[STYLE]、[VISUAL MEDIUM]。",
      surface: "workbench",
    });

    expect(providerTurn).toBe(0);
    expect(browserReads).toBe(0);
    expect(identifyResult.conversationRuntime.replySource).toBe("structured-renderer");
    expect(identifyResult.conversationRuntime.finalText).toContain(sourceRef);
    expect(identifyResult.conversationRuntime.finalText).not.toContain(localLessonSourceRef);
    expect(identifyResult.conversationRuntime.finalText).not.toContain("opencli:twitter/article");
    expect(identifyResult.conversationRuntime.finalText).toContain("全文字符数：5275");
    expect(identifyResult.conversationRuntime.evidenceDisclosure.sources[0]).toMatchObject({
      url: sourceRef,
      fullBodyChars: 5275,
      secondPassExtracted: true,
    });
  });

  it("keeps candidate evidence disclosure pinned to the learning artifact read snapshot", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-candidate-evidence-snapshot-"));
    tempRoots.push(workspaceRoot);
    const sourceRef = "https://x.com/qc777qc/status/2057327056774648108";
    const artifact = {
      artifactId: "artifact_qc777qc_2057327056774648108",
      sourceRef,
      sourceKind: "web-page",
      title: "X/Twitter Lesson: Reverse image prompts",
      readableContent:
        "X 的新用户可以在这里注册。Cookie 政策。完美逆向文生图提示词的方法：拆角色、构图、质感和光线。",
      metadata: {
        fullBodyChars: 6076,
        readStatus: "read",
        sourceAccessStatus: "available",
        secondPassExtracted: true,
        mediaCount: 0,
        mediaUnderstandingStatus: "not_understood_without_user_authorization",
        evidenceDisclosureSnapshot: {
          url: sourceRef,
          fullBodyChars: 6076,
          previewChars: 6076,
          sourceAccessStatus: "available",
          readStatus: "read",
          secondPassExtracted: true,
          mediaCount: 0,
          mediaInventory: {
            assetCount: 0,
            imageCount: 0,
            videoCount: 0,
            audioCount: 0,
            posterCount: 0,
            blobCount: 0,
          },
          mediaUnderstandingStatus: "not_understood_without_user_authorization",
        },
      },
    };
    const candidate = {
      schemaVersion: "contracts.v1",
      candidateId: "experience_qc777qc_2057327056774648108",
      sourceAdapter: {
        schemaVersion: "contracts.v1",
        adapterId: "web_page_qc777qc",
        sourceKind: "web-page",
        sourceRef,
        privacy: "public",
        transformations: [],
      },
      title: "完美逆向文生图提示词",
      summary: "把参考图拆成角色、构图、质感和光线，再转成可复用提示词。",
      applicability: "用于把视觉参考快速复刻成可执行的图片生成提示词。",
      risks: [],
      tags: ["ai-prompting", "reverse-prompt"],
      evidence: [
        {
          evidenceId: "evidence_qc777qc_2057327056774648108",
          sourceRef,
          path: "lesson.md",
          summary: "学习时已读到正文并生成待审候选。",
        },
      ],
      sourceArtifactId: artifact.artifactId,
      evidencePreview: "完美逆向文生图提示词的方法：拆角色、构图、质感和光线。",
      quality: {
        schemaVersion: "contracts.v1",
        verdict: "usable",
        score: 90,
        reasons: ["learning artifact captured readable text"],
      },
      status: "candidate",
      privacy: "public",
      runtimeInjection: "disabled",
      provenance: "desktop-test",
      createdAtMs: 1_779_034_146_000,
    };
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          experience: {
            total: 1,
            candidates: [
              {
                candidate,
                status: "pending",
                latestReview: null,
                promotions: [],
                latestPromotion: null,
                promoted: false,
                taxonomy: null,
              },
            ],
            artifacts: [artifact],
            artifactTotal: 1,
            quarantineTotal: 0,
            quarantined: [],
            taxonomy: {
              schemaVersion: "director.experience.taxonomy.v1",
              categories: [],
              tags: [],
              candidates: [],
            },
          },
        }),
        apiProviderFetch: async (_url, init) =>
          fakeLearningEvidenceAwareProviderResponse(
            init,
            "核心是：完美逆向文生图提示词的方法找到了。",
          ),
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "详细说说刚才学到的内容",
      surface: "workbench",
    });

    expect(result.conversationRuntime.finalText).toContain(
      `证据来源：${sourceRef} · 全文 6076 字符 · 已读取`,
    );
    expect(result.conversationRuntime.finalText).not.toContain("失败原因：Web extraction failed");
    expect(result.conversationRuntime.evidenceDisclosure.sources[0]).toMatchObject({
      url: sourceRef,
      fullBodyChars: 6076,
      sourceAccessStatus: "available",
      readStatus: "read",
      failedReason: null,
      secondPassExtracted: true,
    });
  });

  it("identifies learned source from a local screenshot text signal without browser or model calls", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-evidence-screenshot-"));
    tempRoots.push(workspaceRoot);
    const screenshotPath = join(workspaceRoot, "gpt-image-character-generator.png");
    writeFileSync(screenshotPath, Buffer.from("not-a-real-image-but-test-extractor-is-injected"));
    const sourceRef = "https://x.com/aimikoda/status/2055969783951093986";
    const localLessonSourceRef =
      "file:///Volumes/%E9%87%91%E9%87%91/code/hotflow/director-angel/.director-angel/workspace/learning-sources/x-aimikoda-2055969783951093986";
    const artifact = {
      artifactId: "artifact_x_aimikoda_2055969783951093986_10c015ddf4aa",
      sourceRef: `${localLessonSourceRef}#lesson.md`,
      sourceKind: "local-directory",
      title: "X/Twitter Lesson: GPT Image 2 Original Character Generator",
      readableContent: [
        "# X/Twitter Lesson: GPT Image 2 Original Character Generator",
        "Source URL: https://x.com/aimikoda/status/2055969783951093986",
        "Total extracted text characters: 5275",
        "Second extraction: yes",
        "Media inventory: 5 images, 0 videos, 0 audio, 0 poster, 0 blob",
        "Media understood: no",
        "Use four variables: [CHARACTER SEED], [AGE / BODY TYPE], [STYLE], [VISUAL MEDIUM].",
        "Create an artistic 16:9 CHARACTER IDENTITY BOARD.",
      ].join("\n"),
      metadata: {
        fullBodyChars: 5275,
        secondPassExtracted: true,
        persisted: true,
      },
    };
    const candidate = {
      schemaVersion: "contracts.v1",
      candidateId: "experience_x_aimikoda_2055969783951093986_c634f2c13d64",
      sourceAdapter: {
        schemaVersion: "contracts.v1",
        adapterId: "local_directory_x_aimikoda_2055969783951093986",
        sourceKind: "local-directory",
        sourceRef: localLessonSourceRef,
        privacy: "public",
        transformations: [],
      },
      title: "Local lesson: GPT Image 2 Original Character Generator",
      summary:
        "变量驱动的原创角色身份板方法，用于减少重复 AI 脸、通用设计和 IP 相似性。",
      applicability: "用于识别和复用 GPT Image 2 原创角色身份板提示结构。",
      risks: ["媒体只登记清单，未做视觉理解。"],
      tags: ["ai-prompting", "character-generation", "originality-rules"],
      evidence: [
        {
          evidenceId: "evidence_x_aimikoda_2055969783951093986_d66cd679eaa9",
          sourceRef: `${localLessonSourceRef}#lesson.md`,
          path: "lesson.md",
          summary: "文本已读，媒体未理解。",
        },
      ],
      sourceArtifactId: artifact.artifactId,
      evidencePreview:
        "GPT Image 2 Original Character Generator Prompt. Variables: [CHARACTER SEED], [AGE / BODY TYPE], [STYLE], [VISUAL MEDIUM].",
      quality: {
        schemaVersion: "contracts.v1",
        verdict: "usable",
        score: 90,
        reasons: [],
      },
      status: "accepted",
      privacy: "public",
      runtimeInjection: "disabled",
      createdAtMs: 1_779_034_146_000,
    };
    let providerTurn = 0;
    let browserReads = 0;
    let ocrReads = 0;
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          experience: {
            total: 1,
            candidates: [
              {
                candidate,
                status: "accepted",
                latestReview: {
                  decision: "accepted",
                },
                promotions: [],
                latestPromotion: null,
                promoted: false,
                taxonomy: null,
              },
            ],
            artifacts: [artifact],
            artifactTotal: 1,
            quarantineTotal: 0,
            quarantined: [],
            taxonomy: {
              schemaVersion: "director.experience.taxonomy.v1",
              categories: [],
              tags: [],
              candidates: [],
            },
          },
        }),
        localImageTextExtractor: async (path) => {
          ocrReads += 1;
          expect(path).toBe(screenshotPath);
          return [
            "GPT Image 2 - Original Character Generator Prompt",
            "You only need to fill 4 variables:",
            "[CHARACTER SEED]",
            "[AGE / BODY TYPE]",
            "[STYLE]",
            "[VISUAL MEDIUM]",
          ].join("\n");
        },
        browserToolService: {
          navigate: async () => {
            browserReads += 1;
            return {
              success: true,
              url: sourceRef,
              title: "Should not be fetched",
              snapshot: "",
              element_count: 0,
            };
          },
        },
        apiProviderFetch: async () => {
          providerTurn += 1;
          return fakeApiProviderTextResponse("不应调用模型猜截图来源。");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: `这是哪个链接的内容：${screenshotPath}。请按宪法只基于已学习/已入库证据回答，不要打开外部页面。`,
      surface: "workbench",
    });

    expect(ocrReads).toBe(1);
    expect(providerTurn).toBe(0);
    expect(browserReads).toBe(0);
    expect(result.conversationRuntime.replySource).toBe("structured-renderer");
    expect(result.conversationRuntime.finalText).toContain(sourceRef);
    expect(result.conversationRuntime.finalText).not.toContain(localLessonSourceRef);
    expect(result.conversationRuntime.finalText).toContain("全文字符数：5275");
    expect(result.conversationRuntime.finalText).toContain("二次提取：是");
    expect(result.conversationRuntime.finalText).toContain("是否已入库：是");
    expect(result.conversationRuntime.finalText).toContain("媒体是否已理解：否");
    expect(result.conversationRuntime.finalText).toContain("文本已读，媒体未理解");
  });

  it("does not guess a learning source when local screenshot OCR yields no text", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-evidence-screenshot-empty-"));
    tempRoots.push(workspaceRoot);
    const screenshotPath = join(workspaceRoot, "empty-screenshot.png");
    writeFileSync(screenshotPath, Buffer.from("not-a-real-image-but-test-extractor-is-injected"));
    let providerTurn = 0;
    let browserReads = 0;
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          experience: {
            total: 1,
            candidates: [
              {
                candidate: {
                  schemaVersion: "contracts.v1",
                  candidateId: "experience_unrelated_latest",
                  sourceAdapter: {
                    schemaVersion: "contracts.v1",
                    adapterId: "web_page_lumeflow",
                    sourceKind: "web-page",
                    sourceRef: "https://www.lumeflow.ai/app/home/",
                    privacy: "public",
                    transformations: [],
                  },
                  title: "LumeFlow unrelated latest lesson",
                  summary: "无关最新知识，不能被截图空 OCR 随机选中。",
                  applicability: "回归测试用。",
                  risks: [],
                  tags: ["unrelated"],
                  evidence: [],
                  sourceArtifactId: "artifact_unrelated_latest",
                  quality: {
                    schemaVersion: "contracts.v1",
                    verdict: "usable",
                    score: 90,
                    reasons: [],
                  },
                  status: "accepted",
                  privacy: "public",
                  runtimeInjection: "disabled",
                  createdAtMs: 1_779_034_999_000,
                },
                status: "accepted",
                latestReview: { decision: "accepted" },
                promotions: [],
                latestPromotion: null,
                promoted: true,
                taxonomy: null,
              },
            ],
            artifacts: [
              {
                artifactId: "artifact_unrelated_latest",
                sourceRef: "https://www.lumeflow.ai/app/home/",
                sourceKind: "web-page",
                title: "LumeFlow unrelated latest lesson",
                readableContent: "Unrelated latest web lesson with many characters.",
                metadata: {
                  fullBodyChars: 72336,
                  persisted: true,
                  admitted: true,
                },
              },
            ],
            artifactTotal: 1,
            quarantineTotal: 0,
            quarantined: [],
            taxonomy: {
              schemaVersion: "director.experience.taxonomy.v1",
              categories: [],
              tags: [],
              candidates: [],
            },
          },
        }),
        localImageTextExtractor: async () => "",
        browserToolService: {
          navigate: async () => {
            browserReads += 1;
            return {
              success: true,
              url: "https://www.lumeflow.ai/app/home/",
              title: "Should not be fetched",
              snapshot: "",
              element_count: 0,
            };
          },
        },
        apiProviderFetch: async () => {
          providerTurn += 1;
          return fakeApiProviderTextResponse("不应调用模型猜截图来源。");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: `这是哪个链接的内容：${screenshotPath}。请按宪法只基于已学习/已入库证据回答，不要打开外部页面。`,
      surface: "workbench",
    });

    expect(providerTurn).toBe(0);
    expect(browserReads).toBe(0);
    expect(result.conversationRuntime.replySource).toBe("structured-renderer");
    expect(result.conversationRuntime.finalText).toContain("URL：未识别");
    expect(result.conversationRuntime.finalText).toContain("不能随机把最近知识库内容当成答案");
    expect(result.conversationRuntime.finalText).not.toContain("lumeflow");
    expect(result.conversationRuntime.evidenceDisclosure.sources).toEqual([]);
  });

  it("adds media boundary for X learning answered from browser snapshot evidence", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-x-browser-media-boundary-"));
    tempRoots.push(workspaceRoot);
    const sourceRef = "https://x.com/Strength04_X/status/2055849751317524982";
    const calls = [];
    const browserCalls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          learnDirectorExperience: async () => ({
            result: { candidateCount: 1, quarantineCount: 0 },
            candidates: [{ candidateId: "exp-x-browser", title: "X browser lesson" }],
          }),
        }),
        browserToolService: {
          navigate: async ({ url, sessionKey }) => {
            browserCalls.push({ name: "browser_navigate", url, sessionKey });
            return {
              success: true,
              url,
              title: "Strength04_X on X",
              snapshot: "X post page opened",
              element_count: 2,
            };
          },
          snapshot: async ({ sessionKey }) => {
            browserCalls.push({ name: "browser_snapshot", sessionKey });
            return {
              success: true,
              url: sourceRef,
              title: "Strength04_X on X",
              text:
                "帖子正文：这里是一段关于短视频分镜、提示词和执行流程的 X 学习材料。".repeat(20),
              element_count: 3,
            };
          },
        },
        apiProviderFetch: async (_url, init) => {
          const body = JSON.parse(String(init.body));
          calls.push(body);
          const toolMessages = body.messages?.filter((message) => message.role === "tool") ?? [];
          const hasSnapshot = toolMessages.some(
            (message) =>
              message.tool_call_id === "call-x-browser-snapshot" &&
              String(message.content).includes("帖子正文"),
          );
          const hasAdmit = toolMessages.some(
            (message) =>
              message.tool_call_id === "call-x-learning-admit" &&
              String(message.content).includes("已整理"),
          );
          if (!hasSnapshot) {
            return fakeApiProviderToolCallsResponse([
              {
                id: "call-x-browser-navigate",
                name: "browser_navigate",
                args: {
                  url: sourceRef,
                  profile: "angel",
                },
              },
              {
                id: "call-x-browser-snapshot",
                name: "browser_snapshot",
                args: {
                  full: true,
                },
              },
            ]);
          }
          if (!hasAdmit) {
            return fakeApiProviderToolCallsResponse([
              {
                id: "call-x-learning-admit",
                name: "director.learning.admit",
                args: {
                  sources: [
                    {
                      url: sourceRef,
                      title: "Strength04_X on X",
                      body: "帖子正文：这里是一段关于短视频分镜、提示词和执行流程的 X 学习材料。".repeat(20),
                    },
                  ],
                },
              },
            ]);
          }
          return fakeApiProviderTextResponse(
            "我已经学习了这个推文的内容，也看到了最终生成的视觉作品。",
          );
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: `只读取这个链接并回答，不要入库，不要创建候选：${sourceRef}`,
      surface: "workbench",
    });

    expect(browserCalls.map((call) => call.name)).toEqual(
      expect.arrayContaining(["browser_navigate", "browser_snapshot"]),
    );
    expect(browserCalls.filter((call) => call.name === "browser_navigate")).toHaveLength(1);
    expect(browserCalls.filter((call) => call.name === "browser_snapshot").length).toBeGreaterThanOrEqual(1);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(result.apiProviderRun.output).toContain("媒体边界：文本已读，媒体未理解。");
    expect(result.apiProviderRun.output).toContain("媒体清单：当前只完成文本快照");
    expect(result.apiProviderRun.output).toContain(
      "未获授权前，我不会把图片、视频或音频里的画面、动作、字幕、声音当结论。",
    );
    expect(result.apiProviderRun.output).not.toContain("看到了最终生成的视觉作品");
    expect(result.apiProviderRun.output).not.toContain("媒体内容：文本已读");
    expect(result.apiProviderRun.output).not.toContain("没有展示具体的生成结果图片");
    expect(result.conversationRuntime.finalText).toContain("文本已读，媒体未理解");
    expect(result.conversationRuntime.evidenceDisclosure.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: sourceRef,
          mediaBoundaryRequired: true,
          mediaInventory: expect.objectContaining({
            verified: false,
            verificationStatus: "not_verified",
          }),
          mediaAdmission: expect.objectContaining({
            canAdmitMediaContent: false,
            requiredNextAction: "request_user_authorization",
          }),
        }),
      ]),
    );
  });

  it("keeps failed browser tool attempts in desktop evidence disclosure", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-failed-browser-evidence-"));
    tempRoots.push(workspaceRoot);
    const sourceRef = "https://x.com/Strength04_X/status/2055849751317524982";
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        browserToolService: {
          navigate: async ({ url }) => ({
            success: false,
            url,
            title: "Chrome CDP not ready",
            error: "Chrome CDP was not ready before timeout.",
            metadata: {
              provider_id: "angel-managed-chrome",
              provider_status: "launch-timeout",
            },
          }),
        },
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          const hasBrowserFailure = body.messages?.some(
            (message) =>
              message.role === "tool" &&
              message.tool_call_id === "call-x-browser-failed" &&
              String(message.content).includes("Chrome CDP was not ready"),
          );
          if (!hasBrowserFailure) {
            return fakeApiProviderToolCallsResponse([
              {
                id: "call-x-browser-failed",
                name: "browser_navigate",
                args: {
                  url: sourceRef,
                  profile: "angel",
                },
              },
            ]);
          }
          return fakeApiProviderTextResponse("浏览器读取失败，不能声称已经学习该链接。");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: `只读取这个链接并回答，不要入库，不要创建候选：${sourceRef}`,
      surface: "workbench",
    });

    expect(result.conversationRuntime.evidenceDisclosure.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: sourceRef,
          sourceAccessStatus: "failed",
          readStatus: "failed",
          failedReason: expect.stringContaining("Chrome CDP was not ready"),
          persisted: false,
          admitted: false,
        }),
      ]),
    );
    expect(result.apiProviderRun.evidenceDisclosure.sources[0]).toMatchObject({
      url: sourceRef,
      sourceAccessStatus: "failed",
    });
  });

  it("executes model-requested browser tools through the desktop browser provider", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-browser-tool-chat-"));
    tempRoots.push(workspaceRoot);
    const calls = [];
    const browserCalls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        browserToolService: {
          navigate: async ({ url, sessionKey }) => {
            browserCalls.push({ name: "browser_navigate", url, sessionKey });
            return {
              success: true,
              url,
              title: "Example Browser Page",
              snapshot: "[@e1] link Read more",
              element_count: 1,
            };
          },
        },
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          calls.push({
            url,
            method: init.method,
            body,
          });
          const hasBrowserResult = body.messages?.some(
            (message) =>
              message.role === "tool" &&
              message.tool_call_id === "call-browser-nav" &&
              String(message.content).includes("Navigated to https://example.test/browser"),
          );
          if (!hasBrowserResult) {
            return jsonResponse({
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      {
                        id: "call-browser-nav",
                        type: "function",
                        function: {
                          name: "browser_navigate",
                          arguments: JSON.stringify({ url: "https://example.test/browser" }),
                        },
                      },
                    ],
                  },
                },
              ],
            });
          }
          return jsonResponse({
            choices: [
              {
                message: {
                  content: "我已经打开页面，看到 Example Browser Page 和一个 Read more 链接。",
                },
              },
            ],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-browser-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
      prompt: "打开 https://example.test/browser 看看",
      sourceAction: {
        type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
        prompt: "打开 https://example.test/browser 看看",
        surface: "workbench",
        turnIntent: {
          kind: "chat",
          text: "打开 https://example.test/browser 看看",
        },
        responsePolicy: "result-first",
      },
    });

    expect(browserCalls).toEqual([
      {
        name: "browser_navigate",
        url: "https://example.test/browser",
        sessionKey: "desktop:workbench",
      },
    ]);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0]?.body?.tools?.map((tool) => tool.function?.name)).toEqual(
      expect.arrayContaining([
        "web_search",
        "web_extract",
        "browser_navigate",
        "browser_snapshot",
        "browser_click",
        "browser_type",
      ]),
    );
    expect(calls[1]?.body?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          tool_call_id: "call-browser-nav",
          content: expect.stringContaining("snapshot_preview:"),
        }),
      ]),
    );
    expect(result.apiProviderRun.output).toContain("Example Browser Page");
    expect(result.externalToolBus.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: "browser_navigate",
          operationId: "browser.navigate",
          status: "completed",
          ok: true,
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("sk-browser-secret");
  });

  it("manages Browser as a shared external provider instead of a workbench window patch", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-browser-provider-"));
    tempRoots.push(workspaceRoot);
    const browserStatus = {
      success: true,
      connected: true,
      status: "connected",
      implementation: "desktop-browser-router",
      session_count: 1,
      sessions: [
        {
          id: "desktop-workbench",
          sessionKey: "desktop:workbench",
          turnId: "turn-1",
          url: "https://example.test/page",
          title: "Example Page",
        },
      ],
      supported_profiles: ["angel", "user"],
      providers: {
        angel: {
          provider_id: "angel-managed-chrome",
          profile: "angel",
          connected: true,
          status: "connected",
          session_count: 1,
          cdp_control: {
            cdp_http: true,
            cdp_ready: true,
            cdp_url: "http://127.0.0.1:9223/",
            target_count: 1,
          },
          capabilities: {
            supports_managed_launch: true,
          },
          security: {
            cdp_url_policy: "loopback-control-plane",
            warnings: [],
          },
        },
        user: {
          provider_id: "chrome-existing-session",
          profile: "user",
          connected: true,
          status: "configured",
          session_count: 0,
          cdp_control: {
            cdp_http: false,
            cdp_ready: false,
            cdp_url: "http://127.0.0.1:9222/",
            target_count: 0,
          },
          security: {
            cdp_url_policy: "loopback-control-plane",
            warnings: [],
          },
        },
      },
      allow_private_urls: false,
      visible: false,
    };
    const browserToolService = {
      status: vi.fn(() => browserStatus),
      connect: vi.fn(() => ({ ...browserStatus, connected: true, status: "connected" })),
      disconnect: vi.fn(() => ({
        ...browserStatus,
        connected: false,
        status: "disconnected",
        session_count: 0,
        sessions: [],
      })),
      cleanup: vi.fn(() => ({
        ...browserStatus,
        closed_session_count: 1,
        session_count: 0,
        sessions: [],
      })),
    };
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        browserToolService,
      }),
    });

    const initial = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    const browser = initial.snapshot.assets.tools.externalToolBus.items.find(
      (item) => item.id === "browser",
    );
    expect(browser).toMatchObject({
      id: "browser",
      kind: "provider",
      providerId: "browser",
      canInvoke: true,
      metadata: expect.objectContaining({
        boundary: "shared-browser-provider",
        connected: true,
        sessionCount: 1,
        supported_profiles: ["angel", "user"],
        providers: expect.objectContaining({
          angel: expect.objectContaining({
            provider_id: "angel-managed-chrome",
            profile: "angel",
          }),
          user: expect.objectContaining({
            provider_id: "chrome-existing-session",
            profile: "user",
          }),
        }),
      }),
    });
    expect(browser.doctor.summary).toContain("Browser provider connected");
    expect(browser.doctor.summary).toContain("Angel Chrome 已连接");
    expect(browser.doctor.summary).toContain("Chrome 登录态 未验证");
    expect(browser.doctor.summary).toContain("CDP 未就绪");
    expect(browser.doctor.nextActions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("profile=angel"),
        expect.stringContaining("Chrome CDP"),
        expect.stringContaining("不要用内置浏览器冒充"),
      ]),
    );

    const connectedAngel = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "browser",
      operation: "enable",
      settings: { profile: "angel" },
    });
    expect(browserToolService.connect).toHaveBeenCalledWith({ profile: "angel" });
    expect(connectedAngel.externalToolManage).toMatchObject({
      ok: true,
      toolId: "browser",
      operation: "enable",
      providerKind: "browser",
      profile: "angel",
    });
    expect(connectedAngel.externalToolManage.applied).toEqual(
      expect.arrayContaining(["profile=angel"]),
    );

    const connectedChrome = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "browser",
      operation: "enable",
      settings: { profile: "user" },
    });
    expect(browserToolService.connect).toHaveBeenCalledWith({ profile: "user" });
    expect(connectedChrome.externalToolManage).toMatchObject({
      ok: true,
      toolId: "browser",
      operation: "enable",
      providerKind: "browser",
      profile: "user",
    });
    expect(connectedChrome.externalToolManage.applied).toEqual(
      expect.arrayContaining(["profile=user"]),
    );

    const disconnected = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "browser",
      operation: "disable",
    });
    expect(browserToolService.disconnect).toHaveBeenCalledTimes(1);
    expect(disconnected.externalToolManage).toMatchObject({
      ok: true,
      toolId: "browser",
      operation: "disable",
      providerKind: "browser",
      status: "disconnected",
    });

    const cleaned = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "browser",
      operation: "delete",
    });
    expect(browserToolService.cleanup).toHaveBeenCalledTimes(1);
    expect(cleaned.externalToolManage.applied).toEqual(["closed=1"]);
  });

  it("invokes browser model tools through the external tool bus for shared channel callers", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-browser-bus-invoke-"));
    tempRoots.push(workspaceRoot);
    const handlers = createDirectorDesktopSystemHandlers({
      workspaceRoot,
      knowledge: directorKnowledge,
      browserToolService: {
        status: () => ({
          success: true,
          connected: true,
          status: "connected",
          session_count: 0,
          sessions: [],
        }),
        navigate: async ({ url, sessionKey }) => ({
          success: true,
          url,
          title: `Shared ${sessionKey}`,
          snapshot: "[@e1] heading Shared Browser",
          element_count: 1,
        }),
      },
    });
    const bridge = createDirectorDesktopBridgeFacade({
      handlers,
      externalToolControlPlane: handlers.externalToolControlPlane,
    });

    const approvalPreview = await bridge.externalToolControlPlane.invoke({
      toolId: "browser_navigate",
      args: { url: "https://example.test/shared" },
      turnId: "turn-shared-browser",
      sessionKey: "weixin:bot:friend",
      idempotencyKey: "call-shared-browser-preview",
    });

    expect(approvalPreview).toMatchObject({
      ok: false,
      status: "approval-required",
      approval: expect.objectContaining({
        metadata: expect.objectContaining({
          agentOsSandboxExecutionPlan: expect.objectContaining({
            ok: true,
            status: "ready",
            backend: "network-limited",
            cwd: workspaceRoot,
            riskSummary: expect.objectContaining({
              toolName: "browser_navigate",
              operationId: "browser.navigate",
              sandboxMode: "network-limited",
              filesystem: expect.objectContaining({
                cwd: workspaceRoot,
                readableRoots: [workspaceRoot],
                writableRoots: [workspaceRoot],
              }),
              networkPolicy: "limited",
            }),
          }),
        }),
        summary: expect.stringContaining("沙箱风险摘要"),
      }),
    });

    const result = await bridge.externalToolControlPlane.invoke({
      toolId: "browser_navigate",
      args: { url: "https://example.test/shared" },
      turnId: "turn-shared-browser",
      sessionKey: "weixin:bot:friend",
      approval: {
        status: "approved",
        operatorId: "test",
      },
      idempotencyKey: "call-shared-browser",
    });

    expect(result).toMatchObject({
      ok: true,
      status: "success",
      toolId: "browser_navigate",
      operationId: "browser.navigate",
      output: expect.objectContaining({
        title: "Shared weixin:bot:friend",
        url: "https://example.test/shared",
      }),
    });
    expect(result.content).toContain("snapshot_preview");
  });

  it("invokes browser.desktop Agent OS extension operations through the shared browser runner", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-browser-agent-os-"));
    tempRoots.push(workspaceRoot);
    const browserCalls = [];
    const handlers = createDirectorDesktopSystemHandlers({
      workspaceRoot,
      knowledge: directorKnowledge,
      browserToolService: {
        status: () => ({
          success: true,
          connected: true,
          status: "connected",
          session_count: 0,
          sessions: [],
        }),
        navigate: async ({ url, sessionKey }) => {
          browserCalls.push({ name: "browser_navigate", url, sessionKey });
          return {
            success: true,
            url,
            title: `Agent OS ${sessionKey}`,
            snapshot: "[@e1] heading Agent OS Browser",
            element_count: 1,
          };
        },
      },
    });
    const bridge = createDirectorDesktopBridgeFacade({
      handlers,
      externalToolControlPlane: handlers.externalToolControlPlane,
    });

    const preview = await bridge.externalToolControlPlane.invoke({
      toolId: "browser.desktop",
      operationId: "browser.navigate",
      args: { url: "https://example.test/agent-os-browser" },
      turnId: "turn-agent-os-browser",
      sessionKey: "desktop:agent-os-browser",
      idempotencyKey: "call-agent-os-browser-preview",
    });

    expect(preview).toMatchObject({
      ok: false,
      status: "approval-required",
      approval: expect.objectContaining({
        metadata: expect.objectContaining({
          agentOsSandboxExecutionPlan: expect.objectContaining({
            ok: true,
            status: "ready",
            backend: "network-limited",
            cwd: workspaceRoot,
            riskSummary: expect.objectContaining({
              toolName: "browser.desktop",
              operationId: "browser.navigate",
              sandboxMode: "network-limited",
              networkPolicy: "limited",
            }),
          }),
        }),
      }),
    });

    const result = await bridge.externalToolControlPlane.invoke({
      toolId: "browser.desktop",
      operationId: "browser.navigate",
      args: { url: "https://example.test/agent-os-browser" },
      turnId: "turn-agent-os-browser",
      sessionKey: "desktop:agent-os-browser",
      approval: {
        status: "approved",
        operatorId: "test",
      },
      idempotencyKey: "call-agent-os-browser",
    });

    expect(browserCalls).toEqual([
      {
        name: "browser_navigate",
        url: "https://example.test/agent-os-browser",
        sessionKey: "desktop:agent-os-browser",
      },
    ]);
    expect(result).toMatchObject({
      ok: true,
      status: "success",
      toolId: "browser.desktop",
      operationId: "browser.navigate",
      output: expect.objectContaining({
        title: "Agent OS desktop:agent-os-browser",
        url: "https://example.test/agent-os-browser",
      }),
      metadata: expect.objectContaining({
        providerId: "browser",
        modelToolName: "browser_navigate",
        agentOsExtensionId: "browser.desktop",
      }),
      trace: expect.arrayContaining([
        expect.objectContaining({ stage: "sandbox.backend_admission" }),
        expect.objectContaining({ stage: "tool.completed" }),
      ]),
    });
  });

  it("invokes web_search through the external tool bus for shared channel callers", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-web-bus-invoke-"));
    tempRoots.push(workspaceRoot);
    const fetchCalls = [];
    const handlers = createDirectorDesktopSystemHandlers({
      workspaceRoot,
      knowledge: directorKnowledge,
      experienceFetchText: async (url, init) => {
        fetchCalls.push({ url, init });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => "text/html; charset=utf-8" },
          body: `
            <html><body>
              <a class="result__a" href="https://example.test/director-web-tool">
                Director Angel Web Tool Bus
              </a>
            </body></html>
          `,
        };
      },
    });
    const bridge = createDirectorDesktopBridgeFacade({
      handlers,
      externalToolControlPlane: handlers.externalToolControlPlane,
    });

    const result = await bridge.externalToolControlPlane.invoke({
      toolId: "web_search",
      args: { query: "Director Angel Web Tool Bus", max_results: 1 },
      turnId: "turn-shared-web",
      sessionKey: "weixin:bot:friend",
      idempotencyKey: "call-shared-web",
    });

    expect(fetchCalls).toHaveLength(1);
    expect(String(fetchCalls[0]?.url)).toContain("duckduckgo.com");
    expect(result).toMatchObject({
      ok: true,
      status: "success",
      toolId: "web_search",
      operationId: "web.search",
      output: expect.objectContaining({
        provider: "duckduckgo",
        results: expect.arrayContaining([
          expect.objectContaining({
            url: "https://example.test/director-web-tool",
          }),
        ]),
      }),
    });
    expect(result.content).toContain("Director Angel Web Tool Bus");
  });

  it("invokes web_extract through the external tool bus with the desktop fetch provider", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-web-extract-bus-invoke-"));
    tempRoots.push(workspaceRoot);
    const fetchCalls = [];
    const handlers = createDirectorDesktopSystemHandlers({
      workspaceRoot,
      knowledge: directorKnowledge,
      experienceFetchText: async (url, init) => {
        fetchCalls.push({ url, init });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => "text/html; charset=utf-8" },
          body: `
            <html>
              <head><title>Director Angel Extract</title></head>
              <body><article>Shared extraction content from the desktop provider.</article></body>
            </html>
          `,
        };
      },
    });
    const bridge = createDirectorDesktopBridgeFacade({
      handlers,
      externalToolControlPlane: handlers.externalToolControlPlane,
    });

    const result = await bridge.externalToolControlPlane.invoke({
      toolId: "web_extract",
      args: { url: "https://example.test/extract", max_bytes: 4096 },
      turnId: "turn-shared-web-extract",
      sessionKey: "weixin:bot:friend",
      idempotencyKey: "call-shared-web-extract",
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe("https://example.test/extract");
    expect(result).toMatchObject({
      ok: true,
      status: "success",
      toolId: "web_extract",
      operationId: "web.extract",
      output: expect.objectContaining({
        title: "Director Angel Extract",
        text_preview: expect.stringContaining("Shared extraction content"),
      }),
    });
    expect(result.content).toContain("Director Angel Extract");
  });

  it("persists long web_extract bodies from the desktop external tool bus for ref-backed reads", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-web-extract-artifact-"));
    tempRoots.push(workspaceRoot);
    const bodyTail = "桌面完整正文尾部：这句只能出现在落盘 artifact 或回读结果里。";
    const longBody = `桌面长正文开头。${"网页读取、证据留存、模型只看预览。".repeat(180)}${bodyTail}`;
    const handlers = createDirectorDesktopSystemHandlers({
      workspaceRoot,
      knowledge: directorKnowledge,
      experienceFetchText: async (url) => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "text/html; charset=utf-8" },
        body: `
          <html>
            <head><title>Desktop Artifact Extract</title></head>
            <body><article>${longBody}</article></body>
          </html>
        `,
        url,
      }),
    });
    const bridge = createDirectorDesktopBridgeFacade({
      handlers,
      externalToolControlPlane: handlers.externalToolControlPlane,
    });

    const extractResult = await bridge.externalToolControlPlane.invoke({
      toolId: "web_extract",
      args: { url: "https://example.test/desktop-long", max_bytes: 100000 },
      turnId: "turn-desktop-web-extract-artifact",
      sessionKey: "desktop:artifact",
      idempotencyKey: "call-desktop-web-extract-artifact",
    });

    expect(extractResult).toMatchObject({
      ok: true,
      status: "success",
      toolId: "web_extract",
      output: expect.objectContaining({
        full_body_ref: "web-extract-full-body-https-example-test-desktop-long",
        full_body_artifact: expect.objectContaining({
          id: "web-extract-full-body-https-example-test-desktop-long",
          path: expect.stringContaining(
            "web-extract-full-body-https-example-test-desktop-long.json",
          ),
        }),
      }),
    });
    const artifactPath = extractResult.output.full_body_artifact.path;
    expect(existsSync(artifactPath)).toBe(true);
    expect(JSON.parse(readFileSync(artifactPath, "utf8")).body).toContain(bodyTail);
    expect(extractResult.content).not.toContain(bodyTail);

    const readResult = await bridge.externalToolControlPlane.invoke({
      toolId: "web_extract_artifact_read",
      args: {
        full_body_ref: "web-extract-full-body-https-example-test-desktop-long",
        max_chars: 120,
      },
      turnId: "turn-desktop-web-extract-artifact-read",
      sessionKey: "desktop:artifact",
      idempotencyKey: "call-desktop-web-extract-artifact-read",
    });

    expect(readResult).toMatchObject({
      ok: true,
      status: "success",
      toolId: "web_extract_artifact_read",
      output: expect.objectContaining({
        full_body_ref: "web-extract-full-body-https-example-test-desktop-long",
        body: expect.stringContaining("桌面长正文开头"),
        body_truncated_for_model: true,
      }),
    });
    expect(readResult.content).not.toContain(bodyTail);
  });

  it("invokes x_search through the external tool bus without leaking provider secrets", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-x-bus-invoke-"));
    tempRoots.push(workspaceRoot);
    const fetchCalls = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      fetchCalls.push({ url, init });
      expect(String(url)).toContain("https://api.x.com/2/tweets/search/recent");
      expect(init.headers.Authorization).toBe("Bearer x-runtime-secret-token");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        async text() {
          return JSON.stringify({
            data: [
              {
                id: "123",
                text: "Seedance 2.0 最新经验 thread",
                author_id: "u1",
                created_at: "2026-05-07T08:00:00.000Z",
              },
            ],
            includes: {
              users: [{ id: "u1", username: "creator", name: "Creator" }],
            },
          });
        },
      };
    });
    const handlers = createDirectorDesktopSystemHandlers({
      workspaceRoot,
      knowledge: directorKnowledge,
    });
    const bridge = createDirectorDesktopBridgeFacade({
      handlers,
      externalToolControlPlane: handlers.externalToolControlPlane,
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "provider:x-twitter",
      operation: "update",
      settings: {
        bearerToken: "x-runtime-secret-token",
      },
    });

    const result = await bridge.externalToolControlPlane.invoke({
      toolId: "x_search",
      args: { query: "seedance 2.0 最新经验", max_results: 5 },
      turnId: "turn-shared-x",
      sessionKey: "weixin:bot:friend",
      idempotencyKey: "call-shared-x",
    });

    expect(fetchCalls).toHaveLength(1);
    expect(result).toMatchObject({
      ok: true,
      status: "success",
      toolId: "x_search",
      operationId: "x.search",
      output: expect.objectContaining({
        provider: "x-twitter",
        results: expect.arrayContaining([
          expect.objectContaining({
            url: "https://x.com/creator/status/123",
          }),
        ]),
      }),
    });
    expect(result.content).toContain("Seedance 2.0 最新经验");
    expect(JSON.stringify(result)).not.toContain("x-runtime-secret-token");
    fetchSpy.mockRestore();
  });

  it("resolves external tool bus X/Twitter exec SecretRefs through the injected Agent OS sandbox runner", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-x-bus-exec-"));
    tempRoots.push(workspaceRoot);
    const runnerCalls = [];
    const fetchCalls = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      fetchCalls.push({ url, init });
      expect(String(url)).toContain("https://api.x.com/2/tweets/search/recent");
      expect(init.headers.Authorization).toBe("Bearer x-bus-sandbox-token");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        async text() {
          return JSON.stringify({
            data: [
              {
                id: "789",
                text: "Shared external tool bus SecretRef continuity",
                author_id: "u3",
                created_at: "2026-05-08T10:00:00.000Z",
              },
            ],
            includes: {
              users: [{ id: "u3", username: "busrunner", name: "Bus Runner" }],
            },
          });
        },
      };
    });
    const handlers = createDirectorDesktopSystemHandlers({
      workspaceRoot,
      knowledge: directorKnowledge,
      agentOsSandboxCommandRunner: (request) => {
        runnerCalls.push(request);
        return {
          exitCode: 0,
          stdout: "x-bus-sandbox-token\n",
          stderr: "",
        };
      },
    });
    const bridge = createDirectorDesktopBridgeFacade({
      handlers,
      externalToolControlPlane: handlers.externalToolControlPlane,
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "provider:x-twitter",
      operation: "update",
      settings: {
        bearerToken: "exec:/usr/bin/vault read x/twitter",
      },
    });

    const result = await bridge.externalToolControlPlane.invoke({
      toolId: "x_search",
      args: { query: "agent os bus secretref", max_results: 5 },
      turnId: "turn-shared-x-exec",
      sessionKey: "weixin:bot:friend",
      idempotencyKey: "call-shared-x-exec",
    });

    expect(runnerCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          backend: "host",
          executable: "/usr/bin/vault",
          argv: ["read", "x/twitter"],
          cwd: workspaceRoot,
        }),
      ]),
    );
    expect(fetchCalls).toHaveLength(1);
    expect(result).toMatchObject({
      ok: true,
      status: "success",
      toolId: "x_search",
      output: expect.objectContaining({
        provider: "x-twitter",
        results: expect.arrayContaining([
          expect.objectContaining({
            url: "https://x.com/busrunner/status/789",
          }),
        ]),
      }),
    });
    expect(JSON.stringify(result)).not.toContain("x-bus-sandbox-token");
    fetchSpy.mockRestore();
  });

  it("records model-requested web tools in the shared external tool queue history", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-web-tool-chat-"));
    tempRoots.push(workspaceRoot);
    const calls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        experienceFetchText: async (url) => ({
          ok: true,
          status: 200,
          statusText: "OK",
          url,
          headers: { get: () => "text/html" },
          content:
            '<html><body><a class="result__a" href="https://example.test/director-tool-bus">Director Angel external tool bus</a><a class="result__snippet">External tool bus notes.</a></body></html>',
        }),
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          calls.push({
            url,
            method: init.method,
            body,
          });
          const hasWebResult = body.messages?.some(
            (message) =>
              message.role === "tool" &&
              message.tool_call_id === "call-web-search" &&
              /^(status|summary):/imu.test(String(message.content)),
          );
          if (!hasWebResult) {
            return jsonResponse({
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      {
                        id: "call-web-search",
                        type: "function",
                        function: {
                          name: "web_search",
                          arguments: JSON.stringify({
                            query: "Director Angel external tool bus",
                            max_results: 1,
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            });
          }
          return jsonResponse({
            choices: [
              {
                message: {
                  content: "我已经搜索过了。",
                },
              },
            ],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-web-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "搜一下 Director Angel external tool bus",
      surface: "workbench",
    });

    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0]?.body?.tools?.map((tool) => tool.function?.name)).toEqual(
      expect.arrayContaining(["web_search"]),
    );
    expect(
      calls.some((call) =>
        call.body?.messages?.some(
          (message) =>
            message.role === "tool" &&
            message.tool_call_id === "call-web-search" &&
            /^(status|summary):/imu.test(String(message.content)),
        ),
      ),
    ).toBe(true);
    expect(result.externalToolBus.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: "web_search",
          operationId: "web.search",
          status: "completed",
          ok: true,
        }),
      ]),
    );
    expect(result.apiProviderRun.output).toContain("我已经搜索过了");
    expect(JSON.stringify(result)).not.toContain("sk-web-secret");
  });

  it("exposes media admission status in desktop evidence disclosure after web extraction", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-evidence-media-admission-"));
    tempRoots.push(workspaceRoot);
    const calls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        experienceFetchText: async (url) => ({
          ok: true,
          status: 200,
          statusText: "OK",
          url: String(url),
          headers: { get: () => "text/html; charset=utf-8" },
          body: `
            <html>
              <head><title>媒体证据页面</title></head>
              <body>
                <article>
                  <p>文本正文已经读取，用于测试证据折叠区。</p>
                  <img src="https://cdn.example.test/storyboard.jpg" />
                  <video src="https://cdn.example.test/demo.mp4" poster="https://cdn.example.test/poster.jpg"></video>
                </article>
              </body>
            </html>
          `,
        }),
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          calls.push({ url, body });
          const hasExtractResult = body.messages?.some(
            (message) =>
              message.role === "tool" &&
              message.tool_call_id === "call-web-extract-media-admission",
          );
          if (!hasExtractResult) {
            return fakeApiProviderToolCallsResponse([
              {
                id: "call-web-extract-media-admission",
                name: "web_extract",
                args: {
                  url: "https://example.test/media-admission",
                  max_bytes: 4096,
                },
              },
            ]);
          }
          return fakeApiProviderTextResponse("已读取网页，媒体仍需授权后才能理解。");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "读取媒体证据页面并告诉我证据状态",
      surface: "workbench",
    });

    expect(calls.length).toBeGreaterThanOrEqual(2);
    const source = result.conversationRuntime.evidenceDisclosure.sources[0];
    expect(source).toMatchObject({
      url: "https://example.test/media-admission",
      mediaCount: 3,
      mediaUnderstandingStatus: "not_understood",
      mediaAdmission: expect.objectContaining({
        status: "text_admissible_media_list_only",
        reason: "media_not_understood_without_user_authorization",
        canAdmitTextEvidence: true,
        canAdmitMediaContent: false,
        requiredNextAction: "request_user_authorization",
        budget: expect.objectContaining({
          fileCountLimit: 3,
          videoMinuteLimit: 1,
        }),
      }),
    });
  });

  it("routes model-requested WeChat article searches through Sogou Weixin web tools", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-sogou-weixin-tool-chat-"));
    tempRoots.push(workspaceRoot);
    const calls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          calls.push({
            url,
            method: init.method,
            body,
          });
          const hasSogouWebResult = body.messages?.some(
            (message) =>
              message.role === "tool" &&
              message.tool_call_id === "call-sogou-weixin-search" &&
              String(message.content).includes("provider: sogou-weixin"),
          );
          if (body.tools?.length === 0 || JSON.stringify(body.messages).includes("工具观察")) {
            expect(JSON.stringify(body.messages)).toContain("工具观察");
            expect(JSON.stringify(body.messages)).toContain("provider: sogou-weixin");
            return jsonResponse({
              choices: [
                {
                  message: {
                    content:
                      "我已经用搜狗微信公众号搜索过 seedance2.0 教程，并会基于该工具结果继续回答。",
                  },
                },
              ],
            });
          }
          if (!hasSogouWebResult) {
            return jsonResponse({
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      {
                        id: "call-sogou-weixin-search",
                        type: "function",
                        function: {
                          name: "web_search",
                          arguments: JSON.stringify({
                            query: "seedance2.0 教程",
                            provider: "sogou-weixin",
                            source_type: "weixin_article",
                            reason: "用户明确要求用搜狗查微信公众号文章",
                            max_results: 2,
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            });
          }
          return jsonResponse({
            choices: [
              {
                message: {
                  content: "我已经用搜狗微信公众号搜索过 seedance2.0 教程。",
                },
              },
            ],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-sogou-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "用搜索引擎搜狗去微信公众号搜索相关seedance2.0的教程",
      surface: "workbench",
    });

    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0]?.body?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({
            name: "web_search",
            parameters: expect.objectContaining({
              properties: expect.objectContaining({
                provider: expect.objectContaining({
                  enum: expect.arrayContaining(["sogou-weixin"]),
                }),
                source_type: expect.objectContaining({
                  enum: expect.arrayContaining(["weixin_article"]),
                }),
              }),
            }),
          }),
        }),
      ]),
    );
    expect(
      calls.some((call) => JSON.stringify(call.body?.messages).includes("provider: sogou-weixin")),
    ).toBe(true);
    const repairCall = calls.find((call) =>
      JSON.stringify(call.body?.messages).includes("工具观察"),
    );
    if (repairCall !== undefined) {
      expect(JSON.stringify(repairCall.body?.messages)).toContain("provider: sogou-weixin");
    }
    expect(result.externalToolBus.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: "web_search",
          operationId: "web.search",
          status: "completed",
          ok: true,
          summary: expect.stringContaining("provider: sogou-weixin"),
        }),
      ]),
    );
    expect(result.apiProviderRun.output).toContain("搜狗微信公众号");
    expect(JSON.stringify(result)).not.toContain("sk-sogou-secret");
  });

  it("preflights explicit Sogou Weixin searches even when the model would answer directly", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "director-desktop-required-sogou-weixin-tool-chat-"),
    );
    tempRoots.push(workspaceRoot);
    const calls = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => ({
      ok: true,
      status: 200,
      url: String(url),
      async text() {
        return `
          <html><body>
            <ul class="news-list">
              <li>
                <a href="https://mp.weixin.qq.com/s/seedance-tutorial">Seedance 2.0 公众号实操教程</a>
                <p class="txt-info">来自微信公众号的 Seedance 2.0 教程。</p>
              </li>
            </ul>
          </body></html>
        `;
      },
    }));
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          calls.push({
            url,
            method: init.method,
            body,
          });
          expect(body.messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                role: "tool",
                tool_call_id: "required-web-search-sogou-weixin",
                content: expect.stringContaining("provider: sogou-weixin"),
              }),
            ]),
          );
          return jsonResponse({
            choices: [
              {
                message: {
                  content: "我已经用搜狗微信搜过，找到 Seedance 2.0 公众号实操教程。",
                },
              },
            ],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-required-sogou-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "用搜索引擎搜狗去微信公众号搜索相关seedance2.0的教程",
      surface: "workbench",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        href: expect.stringContaining("https://weixin.sogou.com/weixin"),
      }),
      expect.any(Object),
    );
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("query=seedance2.0");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          tool_call_id: "required-web-search-sogou-weixin",
          content: expect.stringContaining("Seedance 2.0 公众号实操教程"),
        }),
      ]),
    );
    expect(result.externalToolBus.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: "web_search",
          operationId: "web.search",
          status: "completed",
          ok: true,
          summary: expect.stringContaining("provider: sogou-weixin"),
        }),
      ]),
    );
    expect(result.apiProviderRun.output).toContain("搜狗微信");
    expect(JSON.stringify(result)).not.toContain("sk-required-sogou-secret");
  });

  it("uses required Sogou Weixin tool observations over ungrounded desktop model answers", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "director-desktop-grounded-sogou-weixin-tool-chat-"),
    );
    tempRoots.push(workspaceRoot);
    const calls = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => ({
      ok: true,
      status: 200,
      url: String(url),
      headers: { get: () => "text/html; charset=utf-8" },
      async text() {
        return `
          <html><body>
            <ul class="news-list">
              <li>
                <a href="https://mp.weixin.qq.com/s/seedance-grounded">Seedance 2.0 公众号实操教程</a>
                <p class="txt-info">来自微信公众号的 Seedance 2.0 教程。</p>
              </li>
            </ul>
          </body></html>
        `;
      },
    }));
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          calls.push({ url, body });
          const messagesText = JSON.stringify(body.messages);
          if (
            (Array.isArray(body.tools) && body.tools.length === 0) ||
            messagesText.includes("工具观察")
          ) {
            expect(messagesText).toContain("工具观察");
            expect(messagesText).toContain("Seedance 2.0 公众号实操教程");
            return jsonResponse({
              choices: [
                {
                  message: {
                    content:
                      "我已通过搜狗微信公众号文章搜索查到 Seedance 2.0 公众号实操教程：https://mp.weixin.qq.com/s/seedance-grounded。摘要显示它来自微信公众号的 Seedance 2.0 教程。",
                  },
                },
              ],
            });
          }
          return jsonResponse({
            choices: [
              {
                message: {
                  content: "很抱歉，我没有在搜狗微信公众号中找到关于 seedance2.0 教程的相关内容。",
                },
              },
            ],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-grounded-sogou-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "用搜索引擎搜狗去微信公众号搜索相关seedance2.0的教程",
      surface: "workbench",
    });

    expect(fetchSpy).toHaveBeenCalledWith(expect.any(URL), expect.any(Object));
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(
      calls.some((call) =>
        JSON.stringify(call.body?.messages).includes("required-web-search-sogou-weixin"),
      ),
    ).toBe(true);
    expect(result.events.map((event) => event.title)).toEqual(["工具调用完成"]);
    expect(result.apiProviderRun.output).toContain("我已通过搜狗微信公众号文章搜索查到");
    expect(result.apiProviderRun.output).toContain("Seedance 2.0 公众号实操教程");
    expect(result.apiProviderRun.output).toContain("https://mp.weixin.qq.com/s/seedance-grounded");
    expect(result.apiProviderRun.output).not.toContain("没有在搜狗微信公众号中找到");
    expect(result.conversationRuntime.replySource).toBe("tool-loop");
    expect(result.runtimeOperatorTrace.items.map((item) => item.stage)).toContain("tool.required");
    expect(JSON.stringify(result)).not.toContain("sk-grounded-sogou-secret");
  });

  it("preflights natural WeChat public-account article searches through Sogou Weixin", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "director-desktop-natural-weixin-source-tool-chat-"),
    );
    tempRoots.push(workspaceRoot);
    const calls = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => ({
      ok: true,
      status: 200,
      url: String(url),
      async text() {
        return `
          <html><body>
            <ul class="news-list">
              <li>
                <a href="https://mp.weixin.qq.com/s/seedance-public-account">Seedance 2.0 公众号教程</a>
                <p class="txt-info">来自微信公众号的 Seedance 2.0 教程。</p>
              </li>
            </ul>
          </body></html>
        `;
      },
    }));
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          calls.push({
            url,
            method: init.method,
            body,
          });
          expect(body.messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                role: "system",
                content: expect.stringContaining("微信公众号文章"),
              }),
              expect.objectContaining({
                role: "tool",
                tool_call_id: "required-web-search-sogou-weixin",
                content: expect.stringContaining("provider: sogou-weixin"),
              }),
            ]),
          );
          return jsonResponse({
            choices: [
              {
                message: {
                  content: "我已按微信公众号文章来源搜索，找到 Seedance 2.0 公众号教程。",
                },
              },
            ],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-natural-weixin-source-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "去微信公众号搜索相关seedance2.0的教程",
      surface: "workbench",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        href: expect.stringContaining("https://weixin.sogou.com/weixin"),
      }),
      expect.any(Object),
    );
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("query=seedance2.0");
    expect(calls).toHaveLength(1);
    expect(result.externalToolBus.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: "web_search",
          operationId: "web.search",
          status: "completed",
          ok: true,
          summary: expect.stringContaining("provider: sogou-weixin"),
        }),
      ]),
    );
    expect(result.apiProviderRun.output).toContain("微信公众号文章");
    expect(JSON.stringify(result)).not.toContain("sk-natural-weixin-source-secret");
  });

  it("exposes OpenCLI commands to ordinary desktop conversation through the external tool bus", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-opencli-list-chat-"));
    tempRoots.push(workspaceRoot);
    writeOpenCliManifestFixture(workspaceRoot, [
      {
        site: "hackernews",
        name: "top",
        description: "Read Hacker News top stories.",
        access: "read",
        args: [{ name: "limit", type: "int", required: false }],
      },
    ]);
    const runnerCalls = [];
    const providerCalls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openCliRunner: async (input) => {
          runnerCalls.push(input.args);
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return { exitCode: 1, stdout: "", stderr: "unexpected command" };
        },
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          providerCalls.push({ url, body });
          expect(body.tools.map((tool) => tool.function?.name)).toEqual(
            expect.arrayContaining(["director.opencli.list", "director.opencli.invoke"]),
          );
          const hasOpenCliListResult = body.messages?.some(
            (message) =>
              message.role === "tool" &&
              message.tool_call_id === "call-opencli-list" &&
              String(message.content).includes("opencli.hackernews.top"),
          );
          if (!hasOpenCliListResult) {
            return fakeApiProviderToolCallsResponse([
              {
                id: "call-opencli-list",
                name: "director.opencli.list",
                args: { query: "hackernews", limit: 5 },
              },
            ]);
          }
          return fakeApiProviderTextResponse("我看到 OpenCLI 里有 hackernews/top 这个只读命令。");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "看看 OpenCLI 里有没有能读 HackerNews 热榜的命令",
      surface: "workbench",
    });

    expect(providerCalls.length).toBeGreaterThanOrEqual(2);
    expect(runnerCalls).toEqual(
      expect.arrayContaining([["--version"], ["doctor", "--format", "json"]]),
    );
    expect(runnerCalls).not.toEqual(
      expect.arrayContaining([["hackernews", "top", "--format", "json"]]),
    );
    expect(result.externalToolBus.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: "opencli.local",
          operationId: "opencli.list",
          status: "completed",
          ok: true,
        }),
      ]),
    );
    expect(result.apiProviderRun.output).toContain("hackernews/top");
    expect(JSON.stringify(result)).not.toContain("sk-comfyui-secret");
  });

  it("invokes OpenCLI read-only commands from ordinary desktop conversation with evidence metadata", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-opencli-invoke-chat-"));
    tempRoots.push(workspaceRoot);
    writeOpenCliManifestFixture(workspaceRoot, [
      {
        site: "hackernews",
        name: "top",
        description: "Read Hacker News top stories.",
        access: "read",
        args: [{ name: "limit", type: "int", required: false }],
      },
    ]);
    const runnerCalls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openCliRunner: async (input) => {
          runnerCalls.push(input.args);
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify([{ title: "OpenCLI launch notes", url: "https://news.ycombinator.com/" }]),
            stderr: "",
          };
        },
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          const hasOpenCliResult = body.messages?.some(
            (message) =>
              message.role === "tool" &&
              message.tool_call_id === "call-opencli-hn-top" &&
              String(message.content).includes("OpenCLI 执行完成"),
          );
          if (!hasOpenCliResult) {
            return fakeApiProviderToolCallsResponse([
              {
                id: "call-opencli-hn-top",
                name: "director.opencli.invoke",
                args: {
                  operationId: "opencli.hackernews.top",
                  args: { limit: 2 },
                  reason: "用户要读取 HackerNews 热榜。",
                },
              },
            ]);
          }
          return fakeApiProviderTextResponse("我已经通过 OpenCLI 读取到 HN 热榜结果。");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "用 OpenCLI 读一下 HackerNews 热榜前两条",
      surface: "workbench",
    });

    expect(runnerCalls).toEqual(
      expect.arrayContaining([
        ["--version"],
        ["doctor", "--format", "json"],
        ["hackernews", "top", "--limit", "2", "--format", "json"],
      ]),
    );
    expect(result.externalToolBus.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: "opencli.local",
          operationId: "opencli.hackernews.top",
          status: "completed",
          ok: true,
          summary: expect.stringContaining("OpenCLI 执行完成"),
        }),
      ]),
    );
    expect(result.runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.tool",
          payload: expect.objectContaining({
            tool: expect.objectContaining({
              name: "director.opencli.invoke",
              phase: "completed",
              metadata: expect.objectContaining({
                toolResultMetadata: expect.objectContaining({
                  sourceKind: "opencli",
                  sourceRef: "opencli:hackernews/top",
                  sourceAccessStatus: "available",
                }),
              }),
            }),
          }),
        }),
      ]),
    );
    expect(result.apiProviderRun.output).toContain("OpenCLI");
    expect(JSON.stringify(result)).not.toContain("sk-comfyui-secret");
  });

  it("routes explicit X URL reads through OpenCLI and exposes evidence disclosure", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-opencli-x-url-evidence-"));
    tempRoots.push(workspaceRoot);
    const xUrl = "https://x.com/Adam38363368936/status/2056318384317620663";
    writeOpenCliManifestFixture(workspaceRoot, [
      {
        site: "twitter",
        name: "thread",
        description: "Get a tweet thread.",
        access: "read",
        browser: true,
        domain: "x.com",
        args: [
          { name: "tweet-id", type: "string", required: true, positional: true },
          { name: "limit", type: "int", required: false },
        ],
      },
    ]);
    const runnerCalls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openCliRunner: async (input) => {
          runnerCalls.push(input.args);
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify([
              {
                id: "2056318384317620663",
                author: "Adam",
                text: "这里是 OpenCLI 读取到的 X 帖正文，用于验证桌面端证据链。",
                likes: 12,
                retweets: 3,
                url: xUrl,
                has_media: true,
                media_urls: ["https://pbs.twimg.com/media/example.jpg"],
              },
            ]),
            stderr: "",
          };
        },
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          const hasOpenCliResult = body.messages?.some(
            (message) =>
              message.role === "tool" &&
              message.tool_call_id === "required-opencli-twitter-thread-explicit-url" &&
              String(message.content).includes("OpenCLI 执行完成"),
          );
          if (!hasOpenCliResult) {
            return fakeApiProviderTextResponse("不应在 OpenCLI grounding 前直接回答。");
          }
          return fakeApiProviderTextResponse("已基于 OpenCLI 读取结果回答。");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: `根据宪法，不要入库，只回答。请读取这个 X 链接：${xUrl}，使用 OpenCLI 当前 simon 登录态深读，并输出证据区。`,
      surface: "workbench",
    });

    expect(runnerCalls).toEqual(
      expect.arrayContaining([
        ["--version"],
        ["doctor", "--format", "json"],
        ["twitter", "thread", xUrl, "--format", "json"],
      ]),
    );
    expect(result.runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.tool",
          payload: expect.objectContaining({
            tool: expect.objectContaining({
              name: "director.opencli.invoke",
              phase: "completed",
            }),
          }),
        }),
      ]),
    );
    expect(result.conversationRuntime.evidenceDisclosure.sources[0]).toMatchObject({
      url: xUrl,
      fullBodyChars: expect.any(Number),
      secondPassExtracted: true,
      mediaInventory: expect.objectContaining({
        imageCount: 1,
        videoCount: 0,
      }),
      persisted: false,
      admitted: false,
      mediaAdmission: expect.objectContaining({
        canAdmitMediaContent: false,
        requiredNextAction: "request_user_authorization",
      }),
      mediaUnderstandingStatus: "not_understood_without_user_authorization",
    });
    expect(result.conversationRuntime.evidenceDisclosure.sources[0].fullBodyChars).toBeGreaterThan(0);
    expect(result.apiProviderRun.output).toContain("已基于 OpenCLI");
  });

  it("does not answer fresh OpenCLI X URL reads from stale zero-char local evidence", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-opencli-x-fresh-not-stale-"));
    tempRoots.push(workspaceRoot);
    const xUrl = "https://x.com/Adam38363368936/status/2056318384317620663";
    const recordsDir = join(
      workspaceRoot,
      ".hotflow",
      "conversation-runtime",
      "tool-evidence",
      "records",
    );
    mkdirSync(recordsDir, { recursive: true });
    writeFileSync(
      join(recordsDir, "tool-evidence-stale-zero-body-x.json"),
      `${JSON.stringify(
        {
          id: "tool-evidence-stale-zero-body-x",
          sourceKind: "url",
          sourceRef: xUrl,
          observedAtMs: 1_779_100_000_000,
          metadata: {
            capability: "browser_navigate",
            sourceUrl: xUrl,
            sourceAccessStatus: "failed",
            readStatus: "failed",
            preview: `status: failed\nurl: ${xUrl}\nfull_body_chars: 0`,
            externalToolMetadata: {
              toolOutput: {
                url: xUrl,
                body: "",
                full_body_chars: 0,
                sourceAccessStatus: "failed",
                readStatus: "failed",
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    writeOpenCliManifestFixture(workspaceRoot, [
      {
        site: "twitter",
        name: "thread",
        description: "Get a tweet thread.",
        access: "read",
        browser: true,
        domain: "x.com",
        args: [{ name: "tweet-id", type: "string", required: true, positional: true }],
      },
    ]);
    const runnerCalls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openCliRunner: async (input) => {
          runnerCalls.push(input.args);
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify([
              {
                id: "2056318384317620663",
                author: "Adam",
                text: "Fresh OpenCLI body from the authenticated X thread.",
                url: xUrl,
                media_urls: [],
              },
            ]),
            stderr: "",
          };
        },
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          const hasOpenCliResult = body.messages?.some(
            (message) =>
              message.role === "tool" &&
              message.tool_call_id === "required-opencli-twitter-thread-explicit-url" &&
              String(message.content).includes("OpenCLI 执行完成"),
          );
          if (!hasOpenCliResult) {
            return fakeApiProviderTextResponse("不应跳过 OpenCLI grounding。");
          }
          return fakeApiProviderTextResponse("已基于 fresh OpenCLI 证据回答。");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: `根据宪法，不要入库，只回答。请读取这个 X 链接：${xUrl}，使用 OpenCLI 当前 simon 登录态深读，输出结构化学习结论，并在证据区写清楚 URL、全文字符数、是否二次提取、媒体数量、是否已入库、媒体是否已理解。`,
      surface: "workbench",
    });

    expect(runnerCalls).toEqual(
      expect.arrayContaining([
        ["twitter", "thread", xUrl, "--format", "json"],
      ]),
    );
    expect(result.conversationRuntime.replySource).not.toBe("structured-renderer");
    expect(result.conversationRuntime.intent.kind).not.toBe("learning-evidence-followup");
    expect(result.conversationRuntime.evidenceDisclosure.sources[0].fullBodyChars).toBeGreaterThan(0);
    expect(result.apiProviderRun.output).toContain("fresh OpenCLI");
  });

  it("labels model-provider failures separately when tool evidence fallback answers a fresh X read", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-opencli-model-fallback-"));
    tempRoots.push(workspaceRoot);
    const xUrl = "https://x.com/Adam38363368936/status/2056318384317620663";
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "desktop.externalToolBus.enabled": true,
    });
    writeOpenCliManifestFixture(workspaceRoot, [
      {
        site: "twitter",
        name: "thread",
        description: "Get a tweet thread.",
        access: "read",
        browser: true,
        domain: "x.com",
        args: [{ name: "tweet-id", type: "string", required: true, positional: true }],
      },
    ]);
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openCliRunner: async (input) => {
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify([
              {
                id: "2056318384317620663",
                author: "Adam",
                text: "Fresh OpenCLI tool evidence survived the model provider failure.",
                url: xUrl,
                media_urls: [],
              },
            ]),
            stderr: "",
          };
        },
        apiProviderFetch: async () => {
          throw new Error("fetch failed");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: `根据宪法，不要入库，只回答。请读取这个 X 链接：${xUrl}，使用 OpenCLI 当前 simon 登录态深读。`,
      surface: "workbench",
    });

    expect(result.apiProviderRun.ok).toBe(true);
    expect(result.apiProviderRun.replySource).toBe("tool-loop");
    expect(result.apiProviderRun.output).toContain("模型服务暂时不可用");
    expect(result.apiProviderRun.output).toContain("我先基于已读到的内容给你一个摘要");
    expect(result.apiProviderRun.output).toContain("供应方 memefast-api");
    expect(result.apiProviderRun.output).toContain("错误类别 network");
    expect(result.apiProviderRun.output).not.toContain("模型通道异常");
    expect(result.apiProviderRun.output).not.toContain("provider 在工具返回后失败");
    expect(result.apiProviderRun.output).toContain("Fresh OpenCLI tool evidence");
    expect(result.apiProviderRun.output).not.toContain("资料读取失败");
    expect(result.conversationRuntime.finalText).toContain("模型服务暂时不可用");
    expect(result.events.at(-1)?.body).toContain("模型服务暂时不可用");
    expect(result.events.at(-1)?.body).toContain("我先基于已读到的内容给你一个摘要");
    expect(result.events.at(-1)?.body.match(/模型服务暂时不可用/gu)).toHaveLength(1);
    expect(result.events.at(-1)?.body).toContain("（供应方 memefast-api · 模型");
    expect(result.conversationRuntime.runtimeEventsV1).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "model.fallback",
          payload: expect.objectContaining({
            providerId: "memefast-api",
            errorClass: "network",
            fallbackMode: "tool-evidence",
          }),
        }),
      ]),
    );
  });

  it("does not claim source reading succeeded when model fallback only has an empty X tool shell", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-opencli-empty-model-fallback-"));
    tempRoots.push(workspaceRoot);
    const xUrl = "https://x.com/TanLuAI/status/2056723763975094769";
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "desktop.externalToolBus.enabled": true,
    });
    writeOpenCliManifestFixture(workspaceRoot, [
      {
        site: "twitter",
        name: "thread",
        description: "Get a tweet thread.",
        access: "read",
        browser: true,
        domain: "x.com",
        args: [{ name: "tweet-id", type: "string", required: true, positional: true }],
      },
    ]);
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openCliRunner: async (input) => {
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify([
              {
                id: "2056723763975094769",
                author: "TanLuAI",
                text: "",
                url: xUrl,
                media_urls: [],
              },
            ]),
            stderr: "",
          };
        },
        apiProviderFetch: async () => {
          throw new Error("fetch failed");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: `根据宪法，不要入库，只回答。请读取这个 X 链接：${xUrl}，使用 OpenCLI 当前登录态深读。`,
      surface: "workbench",
    });

    expect(result.apiProviderRun.ok).toBe(true);
    expect(result.apiProviderRun.output).toContain("模型服务暂时不可用");
    expect(result.apiProviderRun.output).toContain("未读到可信正文");
    expect(result.apiProviderRun.output).not.toContain("文本已读");
    expect(result.apiProviderRun.output).not.toContain("资料读取成功");
    expect(result.conversationRuntime.evidenceDisclosure.sources[0]).toMatchObject({
      url: xUrl,
      fullBodyChars: 0,
      sourceAccessStatus: "failed",
      readStatus: "failed",
    });
    expect(result.events.at(-1)?.body).toContain("未读到可信正文");
    expect(result.events.at(-1)?.body).not.toContain("文本已读");
    expect(result.events.at(-1)?.body).not.toContain("资料读取成功");
  });

  it("answers model status questions without mixing source-reading or X-session state", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-model-status-question-"));
    tempRoots.push(workspaceRoot);
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async () => ({
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ data: [{ id: "gemini-3-pro-preview" }] }),
        }),
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "模型还是不能用吗",
      surface: "workbench",
    });

    expect(result.conversationRuntime.intent.kind).toBe("desktop-model-status");
    expect(result.events.at(-1)?.title).toBe("模型状态");
    expect(result.events.at(-1)?.body).toContain("模型通道现在能用");
    expect(result.events.at(-1)?.body).toContain("这只说明模型服务可用");
    expect(result.events.at(-1)?.body).not.toContain("未读到可信正文");
    expect(result.events.at(-1)?.body).not.toContain("CDP");
    expect(result.events.at(-1)?.body).not.toContain("profile");
    expect(result.events.at(-1)?.body).not.toContain("桥接");
  });

  it("explains logged-in X browser state without CDP/profile jargon", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-x-browser-status-question-"));
    tempRoots.push(workspaceRoot);
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "我已经登录x了呀",
      surface: "workbench",
    });

    expect(result.conversationRuntime.intent.kind).toBe("desktop-browser-connection-status");
    expect(result.events.at(-1)?.title).toBe("浏览器连接状态");
    expect(result.events.at(-1)?.body).toContain("你在自己的 Chrome 里登录了 X");
    expect(result.events.at(-1)?.body).toContain("Angel 还没有连到那个 Chrome 窗口");
    expect(result.events.at(-1)?.body).not.toContain("CDP");
    expect(result.events.at(-1)?.body).not.toContain("profile");
    expect(result.events.at(-1)?.body).not.toContain("桥接");
  });

  it("answers learning source status questions without mixing model or X-session state", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-source-status-question-"));
    tempRoots.push(workspaceRoot);
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "刚才那个链接读到了吗？来源读取状态怎么样",
      surface: "workbench",
    });

    expect(result.conversationRuntime.intent.kind).toBe("desktop-learning-source-status");
    expect(result.events.at(-1)?.title).toBe("来源读取状态");
    expect(result.events.at(-1)?.body).toContain("没有可核对的最近学习来源记录");
    expect(result.events.at(-1)?.body).not.toContain("模型通道");
    expect(result.events.at(-1)?.body).not.toContain("Chrome");
    expect(result.events.at(-1)?.body).not.toContain("X");
    expect(result.events.at(-1)?.body).not.toContain("CDP");
    expect(result.events.at(-1)?.body).not.toContain("profile");
  });

  it("invokes OpenCLI commands discovered beyond the static capability preview window", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-opencli-dynamic-chat-"));
    tempRoots.push(workspaceRoot);
    writeOpenCliManifestFixture(workspaceRoot, [
      ...Array.from({ length: 90 }, (_, index) => ({
        site: "docs",
        name: `read-${index}`,
        description: `Read docs page ${index}.`,
        access: "read",
      })),
      {
        site: "hackernews",
        name: "top",
        description: "Read Hacker News top stories.",
        access: "read",
        args: [{ name: "limit", type: "int", required: false }],
      },
    ]);
    const runnerCalls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openCliRunner: async (input) => {
          runnerCalls.push(input.args);
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify([{ title: "HN dynamic command works", url: "https://news.ycombinator.com/" }]),
            stderr: "",
          };
        },
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          const hasOpenCliResult = body.messages?.some(
            (message) =>
              message.role === "tool" &&
              message.tool_call_id === "call-opencli-dynamic-hn-top" &&
              String(message.content).includes("OpenCLI 执行完成"),
          );
          if (!hasOpenCliResult) {
            return fakeApiProviderToolCallsResponse([
              {
                id: "call-opencli-dynamic-hn-top",
                name: "director.opencli.invoke",
                args: {
                  operationId: "opencli.hackernews.top",
                  args: { limit: 2 },
                  reason: "用户要读取 HackerNews 热榜。",
                },
              },
            ]);
          }
          return fakeApiProviderTextResponse("HN dynamic command works");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "用 OpenCLI 读一下 HackerNews 热榜前两条",
      surface: "workbench",
    });

    expect(runnerCalls).toEqual(
      expect.arrayContaining([
        ["--version"],
        ["doctor", "--format", "json"],
        ["hackernews", "top", "--limit", "2", "--format", "json"],
      ]),
    );
    expect(result.apiProviderRun.output).toContain("HN dynamic command works");
  });

  it("keeps OpenCLI snapshot capabilities as a small preview while invoking the full registry", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-opencli-snapshot-preview-"));
    tempRoots.push(workspaceRoot);
    writeOpenCliManifestFixture(workspaceRoot, [
      ...Array.from({ length: 120 }, (_, index) => ({
        site: "docs",
        name: `read-${index}`,
        description: `Read docs page ${index}.`,
        access: "read",
      })),
      {
        site: "hackernews",
        name: "top",
        description: "Read Hacker News top stories.",
        access: "read",
        args: [{ name: "limit", type: "int", required: false }],
      },
    ]);
    const runnerCalls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openCliRunner: async (input) => {
          runnerCalls.push(input.args);
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify([{ title: "HN full registry still works", url: "https://news.ycombinator.com/" }]),
            stderr: "",
          };
        },
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          const hasOpenCliResult = body.messages?.some(
            (message) =>
              message.role === "tool" &&
              message.tool_call_id === "call-opencli-preview-hn-top" &&
              String(message.content).includes("OpenCLI 执行完成"),
          );
          if (!hasOpenCliResult) {
            return fakeApiProviderToolCallsResponse([
              {
                id: "call-opencli-preview-hn-top",
                name: "director.opencli.invoke",
                args: {
                  operationId: "opencli.hackernews.top",
                  args: { limit: 2 },
                  reason: "用户要读取 HackerNews 热榜。",
                },
              },
            ]);
          }
          return fakeApiProviderTextResponse("HN full registry still works");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const snapshot = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    const openCli = snapshot.snapshot.assets.tools.externalToolBus.items.find(
      (item) => item.id === "opencli.local",
    );

    expect(openCli.capabilityCount).toBeGreaterThan(120);
    expect(openCli.capabilities.length).toBeLessThan(openCli.capabilityCount);
    expect(openCli.capabilities.length).toBeLessThanOrEqual(40);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "用 OpenCLI 读一下 HackerNews 热榜前两条",
      surface: "workbench",
    });

    expect(runnerCalls).toEqual(
      expect.arrayContaining([
        ["hackernews", "top", "--limit", "2", "--format", "json"],
      ]),
    );
    expect(result.apiProviderRun.output).toContain("HN full registry still works");
  });

  it("reuses OpenCLI doctor results across repeated desktop registry syncs", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-opencli-doctor-cache-"));
    tempRoots.push(workspaceRoot);
    writeOpenCliManifestFixture(workspaceRoot, [
      {
        site: "hackernews",
        name: "top",
        description: "Read Hacker News top stories.",
        access: "read",
        args: [{ name: "limit", type: "int", required: false }],
      },
    ]);
    const runnerCalls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openCliRunner: async (input) => {
          runnerCalls.push(input.args);
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return { exitCode: 1, stdout: "", stderr: "unexpected command" };
        },
      }),
    });

    const first = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    const second = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });

    const firstOpenCli = first.snapshot.assets.tools.externalToolBus.items.find(
      (item) => item.id === "opencli.local",
    );
    const secondOpenCli = second.snapshot.assets.tools.externalToolBus.items.find(
      (item) => item.id === "opencli.local",
    );
    expect(firstOpenCli?.doctor.status).toBe("ready");
    expect(secondOpenCli?.doctor.status).toBe("ready");
    expect(runnerCalls.filter((args) => args[0] === "--version")).toHaveLength(1);
    expect(runnerCalls.filter((args) => args[0] === "doctor")).toHaveLength(1);
  });

  it("keeps desktop snapshots lightweight by returning previews for long Skill and experience content", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-snapshot-lightweight-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {});
    const skillsDir = join(workspaceRoot, ".hotflow", "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(
      join(skillsDir, "approved-skills.json"),
      JSON.stringify({
        schemaVersion: "skills.approved.v2",
        version: 1,
        updatedAtMs: 1,
        appliedAtMs: 1,
        skills: [
          {
            id: "skill.long",
            version: "1.0.0",
            title: "Long Skill",
            content: "S".repeat(20_000),
            updatedAtMs: 1,
          },
        ],
      }),
      "utf8",
    );

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: {
          ...directorKnowledge,
          inspectDirectorExperienceCandidates: async () => ({
            total: 1,
            candidates: [
              {
                candidate: {
                  candidateId: "candidate-long",
                  title: "Long Candidate",
                  summary: "Long source candidate.",
                  applicability: "Use as evidence.",
                  risks: [],
                  status: "pending",
                  sourceAdapter: {
                    sourceKind: "web",
                    sourceRef: "https://example.test/long",
                    adapterId: "web",
                  },
                  privacy: "internal",
                  tags: [],
                  evidence: [],
                  evidencePreview: "E".repeat(20_000),
                  createdAtMs: 1,
                },
                promoted: false,
              },
            ],
            artifacts: [],
            taxonomy: { schemaVersion: "director.experience.taxonomy.v1", categories: [], tags: [], candidates: [] },
          }),
          inspectDirectorKnowledgeLane: async () => ({
            enabled: true,
            publishedCount: 0,
            candidateCount: 0,
            latestPublishedDocument: null,
          }),
          inspectDirectorKnowledgeCandidates: async () => ({
            candidates: [],
          }),
        },
      }),
    });

    const result = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    const skill = result.snapshot.assets.skills.items.find((item) => item.id === "skill.long");
    const candidate = result.snapshot.candidate.items.find((item) => item.id === "candidate-long");

    expect(skill.contentChars).toBe(20_000);
    expect(skill.content.length).toBeLessThan(4_500);
    expect(skill.contentTruncated).toBe(true);
    expect(skill.sourceDocument.content.length).toBeLessThan(4_500);
    expect(candidate.sourceDocument.originalChars).toBe(20_000);
    expect(candidate.sourceDocument.content.length).toBeLessThan(4_500);
    expect(candidate.sourceDocument.truncated).toBe(true);
  });

  it("blocks OpenCLI write commands inside ordinary desktop conversation before spawning a process", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-opencli-write-blocked-"));
    tempRoots.push(workspaceRoot);
    writeOpenCliManifestFixture(workspaceRoot, [
      {
        site: "github",
        name: "issue-create",
        description: "Create a GitHub issue.",
        access: "write",
        args: [{ name: "title", type: "str", required: true }],
      },
    ]);
    const runnerCalls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openCliRunner: async (input) => {
          runnerCalls.push(input.args);
          return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
        },
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          const blocked = body.messages?.some(
            (message) =>
              message.role === "tool" &&
              message.tool_call_id === "call-opencli-write" &&
              String(message.content).includes("status: blocked"),
          );
          if (!blocked) {
            return fakeApiProviderToolCallsResponse([
              {
                id: "call-opencli-write",
                name: "director.opencli.invoke",
                args: {
                  operationId: "opencli.github.issue-create",
                  args: { title: "Ship it" },
                },
              },
            ]);
          }
          return fakeApiProviderTextResponse("这个 GitHub 写入命令不能由普通对话直接执行，需要走审批。");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "用 OpenCLI 帮我直接创建一个 GitHub issue",
      surface: "workbench",
    });

    expect(runnerCalls).toEqual(
      expect.arrayContaining([["--version"], ["doctor", "--format", "json"]]),
    );
    expect(runnerCalls).not.toEqual(
      expect.arrayContaining([["github", "issue-create", "--title", "Ship it", "--format", "json"]]),
    );
    expect(result.externalToolBus.history).toEqual([]);
    expect(result.runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.tool",
          payload: expect.objectContaining({
            tool: expect.objectContaining({
              name: "director.opencli.invoke",
              phase: "failed",
              outputPreview: expect.stringContaining("status: blocked"),
            }),
          }),
        }),
      ]),
    );
    expect(result.apiProviderRun.output).toContain("审批");
    expect(JSON.stringify(result)).not.toContain("sk-comfyui-secret");
  });

  it("manages external providers through one generic desktop action without deleting tool runtimes", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-external-tool-manage-"));
    tempRoots.push(workspaceRoot);
    const workflowPath = join(workspaceRoot, "workflow.json");
    writeFileSync(workflowPath, JSON.stringify({ 1: { class_type: "SaveImage", inputs: {} } }));
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const enabled = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "comfyui",
      operation: "enable",
    });
    const updated = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "comfyui",
      operation: "update",
      settings: {
        defaultWorkflowPath: workflowPath,
        outputDir: join(workspaceRoot, "outputs"),
      },
    });
    const deleted = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "comfyui",
      operation: "delete",
    });

    expect(enabled.events.at(-1)).toMatchObject({
      title: "外部工具已启用",
      actionType: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
    });
    expect(updated.snapshot.assets.settings.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "comfyui:defaultWorkflowPath",
          value: workflowPath,
        }),
      ]),
    );
    expect(deleted.events.at(-1)).toMatchObject({
      title: "外部工具配置已移除",
      body: expect.stringContaining("只重置 Angel 侧配置"),
    });
    expect(deleted.snapshot.assets.tools.externalToolBus.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "comfyui",
          status: "disabled",
          canInvoke: false,
        }),
      ]),
    );
    expect(existsSync(workflowPath)).toBe(true);
  });

  it("exposes X/Twitter provider auth status without leaking configured tokens", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-x-provider-auth-"));
    tempRoots.push(workspaceRoot);
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const initial = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    expect(initial.snapshot.assets.tools.externalToolBus.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "provider:x-twitter",
          status: "needs-auth",
          providerStatus: expect.objectContaining({
            status: "needs-auth",
            configuredSecret: false,
          }),
        }),
      ]),
    );

    const updated = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "provider:x-twitter",
      operation: "update",
      settings: {
        bearerToken: "x-test-secret-token",
      },
    });

    expect(updated.externalToolManage.providerStatus).toMatchObject({
      status: "ready",
      configuredSecret: true,
      configuredSecretSource: "config",
    });
    expect(updated.snapshot.assets.settings.externalTools.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "x-twitter",
          status: "ready",
          configuredSecret: true,
        }),
      ]),
    );
    expect(JSON.stringify(updated)).not.toContain("x-test-secret-token");
  });

  it("loads OpenClaw-style external provider manifests without shadowing built-ins", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-provider-manifest-"));
    tempRoots.push(workspaceRoot);
    const manifestDir = join(
      workspaceRoot,
      ".director-angel",
      "external-tools",
      "provider-manifests",
    );
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, "brave.json"),
      JSON.stringify(
        {
          id: "brave",
          providerAuthEnvVars: {
            brave: ["BRAVE_API_KEY"],
          },
          setup: {
            providers: [{ id: "brave", authMethods: ["api-key"], envVars: ["BRAVE_API_KEY"] }],
          },
          uiHints: {
            "webSearch.apiKey": {
              label: "Brave Search API Key",
              help: "Brave Search API key.",
              sensitive: true,
              placeholder: "BSA...",
            },
          },
          contracts: {
            webSearchProviders: ["brave"],
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      join(manifestDir, "shadow.json"),
      JSON.stringify({
        id: "x-twitter",
        contracts: { socialSearchProviders: ["x-twitter"] },
      }),
      "utf8",
    );
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const snapshot = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    const providers = snapshot.snapshot.assets.settings.externalTools.providers;

    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "brave",
          enabled: false,
          status: "disabled",
          capabilities: expect.arrayContaining(["web.search", "provider.brave"]),
          configFields: expect.arrayContaining([
            expect.objectContaining({
              key: "apiKey",
              placeholder: "BSA...",
            }),
          ]),
        }),
      ]),
    );
    expect(snapshot.snapshot.assets.settings.externalTools.providerManifestSourceCount).toBe(2);
    expect(snapshot.snapshot.assets.settings.externalTools.providerManifestIssues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('would shadow existing provider "x-twitter"'),
      ]),
    );
  });

  it("reports broken external provider config and keeps the runtime on safe defaults", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-provider-bad-config-"));
    tempRoots.push(workspaceRoot);
    const configDir = join(workspaceRoot, ".director-angel", "external-tools");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "providers.json"), "{ not json", "utf8");
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const snapshot = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });

    expect(snapshot.snapshot.assets.settings.status).toBe("degraded");
    expect(snapshot.snapshot.assets.settings.issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("External provider config could not be read"),
      ]),
    );
    expect(snapshot.snapshot.assets.settings.externalTools.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "duckduckgo",
          status: "ready",
        }),
      ]),
    );
  });

  it("accepts env/file/exec SecretRefs for external API providers without leaking secrets", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-x-provider-secretref-"));
    tempRoots.push(workspaceRoot);
    const secretFile = join(workspaceRoot, "x-secrets.json");
    writeFileSync(
      secretFile,
      JSON.stringify({ providers: { x: { bearerToken: "x-file-secret-token" } } }),
    );
    process.env.X_TEST_BEARER_TOKEN = "x-env-secret-token";
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const envRef = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "provider:x-twitter",
      operation: "update",
      settings: {
        bearerToken: "env:X_TEST_BEARER_TOKEN",
      },
    });
    const fileRef = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "provider:x-twitter",
      operation: "update",
      settings: {
        bearerToken: `file:${secretFile}#/providers/x/bearerToken`,
      },
    });
    const configFile = readFileSync(
      join(workspaceRoot, ".director-angel", "external-tools", "providers.json"),
      "utf8",
    );

    expect(envRef.externalToolManage.providerStatus).toMatchObject({
      status: "ready",
      configuredSecret: true,
      configuredSecretRefSource: "env",
      configuredSecretEnvVar: "X_TEST_BEARER_TOKEN",
    });
    expect(fileRef.externalToolManage.providerStatus).toMatchObject({
      status: "ready",
      configuredSecret: true,
      configuredSecretRefSource: "file",
      configuredSecretRefProvider: "filemain",
    });
    expect(configFile).toContain('"source": "file"');
    expect(configFile).toContain(secretFile);
    expect(JSON.stringify(envRef)).not.toContain("x-env-secret-token");
    expect(JSON.stringify(fileRef)).not.toContain("x-file-secret-token");
    expect(JSON.stringify(fileRef)).not.toContain("x-env-secret-token");
    Reflect.deleteProperty(process.env, "X_TEST_BEARER_TOKEN");
  });

  it("keeps disabled external providers inactive without resolving broken exec SecretRefs", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-x-provider-inactive-"));
    tempRoots.push(workspaceRoot);
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "provider:x-twitter",
      operation: "update",
      settings: {
        bearerToken: "exec:/not/real/vault read x/twitter",
      },
    });
    const disabled = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "provider:x-twitter",
      operation: "disable",
    });

    expect(disabled.externalToolManage.providerStatus).toMatchObject({
      status: "disabled",
      enabled: false,
      activeSurface: false,
      configuredSecret: true,
      configuredSecretRefSource: "exec",
    });
    expect(disabled.externalToolManage.providerStatus.diagnostics).toEqual(
      expect.arrayContaining([
        "active-surface: false",
        "inactive provider surfaces do not block runtime startup",
      ]),
    );
    expect(JSON.stringify(disabled)).not.toContain("vault");
  });

  it("fails closed for active exec SecretRefs when only an async desktop sandbox runner is injected", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-x-provider-async-exec-"));
    tempRoots.push(workspaceRoot);
    const runnerCalls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        agentOsSandboxCommandRunner: async (request) => {
          runnerCalls.push(request);
          return { exitCode: 0, stdout: "must-not-be-used\n", stderr: "" };
        },
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "provider:x-twitter",
      operation: "update",
      settings: {
        bearerToken: "exec:/usr/bin/vault read x/twitter",
      },
    });

    expect(result.externalToolManage.providerStatus).toMatchObject({
      status: "misconfigured",
      configuredSecret: false,
      configuredSecretRefSource: "exec",
      configuredSecretRefProvider: "localexec",
    });
    expect(result.externalToolManage.providerStatus.diagnostics.join(" ")).toContain(
      "synchronous sandbox runner",
    );
    expect(runnerCalls).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("must-not-be-used");
  });

  it("does not wire desktop exec SecretRefs through legacy command-prefix fallback", () => {
    const source = readFileSync(join(currentDir, "desktop-system-handlers.js"), "utf8");
    const registryStart = source.indexOf("function createDesktopExternalProviderAuthRegistry");
    const registryEnd = source.indexOf(
      "function resolveDesktopExternalProviderAuthRegistry",
      registryStart,
    );
    const registrySource = source.slice(registryStart, registryEnd);

    expect(registryStart).toBeGreaterThanOrEqual(0);
    expect(registryEnd).toBeGreaterThan(registryStart);
    expect(registrySource).toContain("execSecretSandbox");
    expect(registrySource).not.toContain("allowedCommandPrefixes");
    expect(source).not.toContain("readDesktopExternalProviderExecCommandPrefixes");
  });

  it("does not expose default host command-prefix fallback for desktop external tools", () => {
    const source = readFileSync(join(currentDir, "desktop-system-handlers.js"), "utf8");
    const factoryStart = source.indexOf("function createDesktopExternalToolSandboxBackends");
    const factoryEnd = source.indexOf("function createDesktopComfyUiSandboxCommandRunner", factoryStart);
    const factorySource = source.slice(factoryStart, factoryEnd);

    expect(factoryStart).toBeGreaterThanOrEqual(0);
    expect(factoryEnd).toBeGreaterThan(factoryStart);
    expect(factorySource).toContain("allowedCommandPatterns");
    expect(factorySource).not.toContain("allowedCommandPrefixes");
    expect(factorySource).not.toContain('"pip"');
    expect(factorySource).not.toContain('"pipx"');
    expect(factorySource).not.toContain('"comfy"');
    expect(factorySource).not.toContain("uvx --from comfy-cli comfy");
  });

  it("marks active providers with invalid file SecretRefs as misconfigured", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-x-provider-bad-file-"));
    tempRoots.push(workspaceRoot);
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "provider:x-twitter",
      operation: "update",
      settings: {
        bearerToken: "file:relative/secrets.json#/providers/x/bearerToken",
      },
    });

    expect(result.externalToolManage.providerStatus).toMatchObject({
      status: "misconfigured",
      configuredSecret: false,
      configuredSecretRefSource: "file",
    });
    expect(result.externalToolManage.providerStatus.diagnostics.join(" ")).toContain(
      "path must be absolute",
    );
  });

  it("runs model-requested X/Twitter search through the configured external provider", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-x-provider-search-"));
    tempRoots.push(workspaceRoot);
    const calls = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      calls.push({ url, init });
      expect(String(url)).toContain("https://api.x.com/2/tweets/search/recent");
      expect(init.headers.Authorization).toBe("Bearer x-runtime-secret-token");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        async text() {
          return JSON.stringify({
            data: [
              {
                id: "123",
                text: "Seedance 2.0 最新经验 thread",
                author_id: "u1",
                created_at: "2026-05-07T08:00:00.000Z",
              },
            ],
            includes: {
              users: [{ id: "u1", username: "creator", name: "Creator" }],
            },
          });
        },
      };
    });
    const modelCalls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          modelCalls.push({ url, body });
          const hasXResult = body.messages?.some(
            (message) =>
              message.role === "tool" && String(message.content).includes("provider: x-twitter"),
          );
          if (Array.isArray(body.tools) && body.tools.length === 0) {
            expect(JSON.stringify(body.messages)).toContain("provider: x-twitter");
            return jsonResponse({
              choices: [
                {
                  message: {
                    content:
                      "我已通过 X/Twitter 检索到 Seedance 2.0 latest workflow：https://x.com/example/status/1，摘要提到最新玩法线程。",
                  },
                },
              ],
            });
          }
          return jsonResponse({
            choices: [
              {
                message: hasXResult
                  ? { content: "我已经通过 X/Twitter 搜索到 Seedance 2.0 最新经验。" }
                  : {
                      content: "",
                      tool_calls: [
                        {
                          id: "call-x-search",
                          type: "function",
                          function: {
                            name: "x_search",
                            arguments: JSON.stringify({
                              query: "seedance 2.0 最新经验",
                              max_results: 5,
                            }),
                          },
                        },
                      ],
                    },
              },
            ],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-x-provider-model-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "provider:x-twitter",
      operation: "update",
      settings: {
        bearerToken: "x-runtime-secret-token",
      },
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "去推特找找 seedance 2.0 最新经验",
      surface: "workbench",
    });

    expect(calls).toHaveLength(1);
    expect(modelCalls).toHaveLength(2);
    expect(modelCalls[0]?.body?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          content: expect.stringContaining("provider: x-twitter"),
        }),
      ]),
    );
    expect(result.externalToolBus.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: "x_search",
          operationId: "x.search",
          status: "completed",
          ok: true,
          summary: expect.stringContaining("provider: x-twitter"),
        }),
      ]),
    );
    expect(result.apiProviderRun.output).toContain("X/Twitter");
    expect(JSON.stringify(result)).not.toContain("x-runtime-secret-token");
    expect(JSON.stringify(result)).not.toContain("sk-x-provider-model-secret");
    fetchSpy.mockRestore();
  });

  it("resolves model-requested X/Twitter exec SecretRefs through the injected Agent OS sandbox runner", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-x-provider-exec-"));
    tempRoots.push(workspaceRoot);
    const runnerCalls = [];
    const xFetchCalls = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      xFetchCalls.push({ url, init });
      expect(String(url)).toContain("https://api.x.com/2/tweets/search/recent");
      expect(init.headers.Authorization).toBe("Bearer x-sandbox-token");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        async text() {
          return JSON.stringify({
            data: [
              {
                id: "456",
                text: "Agent OS sandbox SecretRef continuity thread",
                author_id: "u2",
                created_at: "2026-05-08T09:00:00.000Z",
              },
            ],
            includes: {
              users: [{ id: "u2", username: "sandboxer", name: "Sandboxer" }],
            },
          });
        },
      };
    });
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        agentOsSandboxCommandRunner: (request) => {
          runnerCalls.push(request);
          return {
            exitCode: 0,
            stdout: "x-sandbox-token\n",
            stderr: "",
          };
        },
        apiProviderFetch: async (_url, init) => {
          const body = JSON.parse(String(init.body));
          const hasXResult = body.messages?.some(
            (message) =>
              message.role === "tool" && String(message.content).includes("provider: x-twitter"),
          );
          return jsonResponse({
            choices: [
              {
                message: hasXResult
                  ? { content: "X/Twitter exec SecretRef 搜索已完成。" }
                  : {
                      content: "",
                      tool_calls: [
                        {
                          id: "call-x-search-exec-secret",
                          type: "function",
                          function: {
                            name: "x_search",
                            arguments: JSON.stringify({
                              query: "agent os sandbox secretref",
                              max_results: 5,
                            }),
                          },
                        },
                      ],
                    },
              },
            ],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-x-provider-model-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });
    const providerUpdate = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "provider:x-twitter",
      operation: "update",
      settings: {
        bearerToken: "exec:/usr/bin/vault read x/twitter",
      },
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "去 X/Twitter 搜索 agent os sandbox secretref",
      surface: "workbench",
    });

    expect(providerUpdate.externalToolManage.providerStatus).toMatchObject({
      status: "ready",
      configuredSecret: true,
      configuredSecretRefSource: "exec",
      configuredSecretRefProvider: "localexec",
    });
    expect(runnerCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          backend: "host",
          executable: "/usr/bin/vault",
          argv: ["read", "x/twitter"],
          cwd: workspaceRoot,
        }),
      ]),
    );
    expect(xFetchCalls).toHaveLength(1);
    expect(result.apiProviderRun.output).toContain("SecretRef");
    expect(JSON.stringify(result)).not.toContain("x-sandbox-token");
    expect(JSON.stringify(result)).not.toContain("sk-x-provider-model-secret");
    fetchSpy.mockRestore();
  });

  it("plans and executes ComfyUI installation through the generic external provider manager", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-external-tool-install-"));
    tempRoots.push(workspaceRoot);
    const installPath = join(workspaceRoot, "Software", "ComfyUI");
    const commandCalls = [];
    const sandboxCalls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        comfyUiCommandExists: (command) => command === "uvx",
        comfyUiCommandRunner: async (command, args) => {
          commandCalls.push({ command, args });
          return { exitCode: 0, stdout: "installed", stderr: "" };
        },
        agentOsSandboxCommandRunner: async (request) => {
          sandboxCalls.push(request);
          return { exitCode: 0, stdout: "sandbox installed", stderr: "" };
        },
      }),
    });

    const planned = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "comfyui",
      operation: "install",
      settings: {
        localInstallPath: installPath,
      },
      dryRun: true,
      gpuFlag: "--m-series",
      skipLaunch: true,
    });
    const executed = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "comfyui",
      operation: "install",
      dryRun: false,
      gpuFlag: "--m-series",
      skipLaunch: true,
    });

    expect(planned.externalToolInstall).toMatchObject({
      ok: true,
      status: "planned",
      dryRun: true,
      executed: false,
      plan: [
        expect.objectContaining({
          command: "uvx",
          args: expect.arrayContaining([
            "--from",
            "comfy-cli",
            "comfy",
            "--workspace",
            installPath,
            "--skip-prompt",
            "install",
            "--m-series",
          ]),
        }),
      ],
    });
    expect(planned.events.at(-1)).toMatchObject({
      title: "外部工具安装计划已生成",
      actionType: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
    });
    expect(commandCalls).toEqual([]);
    expect(sandboxCalls).toEqual([
      expect.objectContaining({
        backend: "host",
        executable: "uvx",
        argv: expect.arrayContaining([
          "--from",
          "comfy-cli",
          "comfy",
          "--workspace",
          installPath,
          "--skip-prompt",
          "install",
          "--m-series",
        ]),
        cwd: join(workspaceRoot, ".director-angel"),
      }),
    ]);
    expect(executed.externalToolInstall).toMatchObject({
      ok: true,
      status: "installed",
      dryRun: false,
      executed: true,
      results: [
        expect.objectContaining({
          exitCode: 0,
          stdout: "sandbox installed",
          sandbox: expect.objectContaining({
            ok: true,
            status: "completed",
            backend: "host",
            evidence: expect.objectContaining({
              planHash: expect.any(String),
              commandHash: expect.any(String),
              backendConfig: expect.objectContaining({
                commandPattern: expect.objectContaining({
                  executable: "uvx",
                  argv: expect.arrayContaining([
                    "--from",
                    "comfy-cli",
                    "comfy",
                    "--workspace",
                    installPath,
                    "--skip-prompt",
                    "install",
                    "--m-series",
                  ]),
                  operationId: "install",
                }),
              }),
            }),
          }),
        }),
      ],
    });
  });

  it("returns a structured manage result for non-ComfyUI external providers instead of throwing", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "director-desktop-external-tool-generic-manage-"),
    );
    tempRoots.push(workspaceRoot);
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.MCP_SERVER_UPSERT,
      serverName: "local_search",
      transport: "stdio",
      command: "node",
      args: ["fake-mcp.js"],
      enabled: false,
    });
    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "mcp:local_search",
      operation: "install",
      dryRun: true,
    });

    expect(result.externalToolManage).toMatchObject({
      ok: false,
      toolId: "mcp:local_search",
      operation: "install",
      status: "unsupported-provider-operation",
      supported: false,
      policy: expect.objectContaining({
        defaultMode: "manual",
        requiresExplicitExecute: true,
        refuses: expect.arrayContaining(["silent-install"]),
      }),
    });
    expect(result.events.at(-1)).toMatchObject({
      title: "外部工具需要手动管理",
      actionType: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      body: expect.stringContaining("MCP: local_search"),
    });
    expect(result.snapshot.assets.tools.externalToolBus.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mcp:local_search",
          installPolicy: expect.objectContaining({
            supported: false,
            defaultMode: "manual",
          }),
        }),
      ]),
    );
  });

  it("returns a generic install boundary for registered tools without an installer", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "director-desktop-external-tool-generic-install-plan-"),
    );
    tempRoots.push(workspaceRoot);
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "web_search",
      operation: "install",
      dryRun: true,
    });

    expect(result.externalToolManage).toMatchObject({
      ok: false,
      toolId: "web_search",
      operation: "install",
      status: "install-plan-only",
      supported: false,
    });
    expect(result.externalToolInstall).toMatchObject({
      ok: false,
      status: "unsupported",
      dryRun: true,
      executed: false,
      toolId: "web_search",
      plan: [],
      installPolicy: expect.objectContaining({
        supported: false,
        defaultMode: "none",
      }),
      nextActions: expect.arrayContaining(["内置工具由运行时提供，不需要安装。"]),
    });
    expect(result.events.at(-1)).toMatchObject({
      title: "外部工具不能自动安装",
      body: expect.stringContaining("不能静默安装"),
    });
  });

  it("manages MCP tool-sources through the generic external provider manager without a second config path", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-external-tool-mcp-manage-"));
    tempRoots.push(workspaceRoot);
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.MCP_SERVER_UPSERT,
      serverName: "local_search",
      transport: "stdio",
      command: "node",
      args: ["fake-mcp.js"],
      enabled: false,
    });
    const configPath = join(workspaceRoot, ".mcp.json");
    const enabled = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "mcp:local_search",
      operation: "enable",
    });
    const disabled = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "mcp:local_search",
      operation: "disable",
    });

    expect(enabled.externalToolManage).toMatchObject({
      ok: true,
      toolId: "mcp:local_search",
      operation: "enable",
      providerKind: "mcp",
      configPath,
    });
    expect(enabled.snapshot.assets.tools.externalToolBus.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mcp:local_search",
          status: "pending",
        }),
      ]),
    );
    expect(JSON.parse(readFileSync(configPath, "utf8")).mcpServers.local_search.enabled).toBe(
      false,
    );
    expect(disabled.events.at(-1)).toMatchObject({
      title: "外部工具已停用",
      body: expect.stringContaining("MCP local_search"),
    });
    const deleted = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "mcp:local_search",
      operation: "delete",
    });
    expect(deleted.events.at(-1)).toMatchObject({
      title: "外部工具配置已移除",
      body: expect.stringContaining(".mcp.json"),
    });
    expect(JSON.parse(readFileSync(configPath, "utf8")).mcpServers.local_search).toBeUndefined();
  });

  it("persists plugin install update remove lifecycle through the generic external tool manager", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-plugin-lifecycle-"));
    tempRoots.push(workspaceRoot);
    const pluginRoot = join(workspaceRoot, "plugins", "filesystem-read");
    mkdirSync(pluginRoot, { recursive: true });
    const manifestPath = join(pluginRoot, "plugin.json");
    writeFileSync(
      manifestPath,
      `${JSON.stringify(
        {
          schemaVersion: "conversation-runtime.plugin-manifest.v1",
          id: "tool-filesystem-read",
          version: "0.1.0",
          displayName: "Filesystem Read",
          sourceTrust: { status: "trusted-plugin", label: "Reviewed local plugin" },
          capabilities: [{ id: "filesystem.read", label: "Filesystem read", readOnly: true }],
          tools: [
            {
              name: "filesystem.read_text",
              capabilityId: "filesystem.read",
              readOnly: true,
            },
          ],
          metadata: {
            entrypoint: join(pluginRoot, "index.js"),
          },
        },
        null,
        2,
      )}\n`,
    );
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const installed = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "plugin:tool-filesystem-read",
      operation: "install",
      settings: {
        manifestPath,
      },
    });
    const updated = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "plugin:tool-filesystem-read",
      operation: "update",
      settings: {
        version: "0.2.0",
      },
    });
    const disabled = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "plugin:tool-filesystem-read",
      operation: "disable",
    });
    const removed = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "plugin:tool-filesystem-read",
      operation: "delete",
    });

    const pluginConfigPath = join(workspaceRoot, ".director-angel", "external-tools", "plugins.json");
    expect(installed.externalToolManage).toMatchObject({
      ok: true,
      toolId: "plugin:tool-filesystem-read",
      operation: "install",
      providerKind: "plugin",
      pluginId: "tool-filesystem-read",
      status: "installed",
      configPath: pluginConfigPath,
      applied: expect.arrayContaining(["manifestPath=updated", "enabled=true"]),
    });
    expect(installed.snapshot.assets.tools.externalToolBus.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "tool-filesystem-read",
          source: "plugin",
          kind: "tool-source",
          metadata: expect.objectContaining({
            pluginId: "tool-filesystem-read",
            directStoreAccessAllowed: false,
          }),
        }),
      ]),
    );
    expect(updated.externalToolManage).toMatchObject({
      ok: true,
      status: "updated",
      applied: expect.arrayContaining(["version=updated"]),
    });
    expect(disabled.externalToolManage).toMatchObject({
      ok: true,
      status: "disabled",
      applied: ["enabled=false"],
    });
    expect(removed.externalToolManage).toMatchObject({
      ok: true,
      status: "removed",
      configPath: pluginConfigPath,
    });
    const document = JSON.parse(readFileSync(pluginConfigPath, "utf8"));
    expect(document.plugins["tool-filesystem-read"]).toMatchObject({
      enabled: false,
      removed: true,
      manifestPath,
      version: "0.2.0",
      lifecycle: expect.arrayContaining([
        expect.objectContaining({ operation: "install" }),
        expect.objectContaining({ operation: "update" }),
        expect.objectContaining({ operation: "disable" }),
        expect.objectContaining({ operation: "delete" }),
      ]),
    });
  });

  it("refuses local ComfyUI installation when the provider is configured for cloud mode", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "director-desktop-external-tool-cloud-install-"),
    );
    tempRoots.push(workspaceRoot);
    const commandCalls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        comfyUiCommandExists: () => true,
        comfyUiCommandRunner: async (command, args) => {
          commandCalls.push({ command, args });
          return { exitCode: 0, stdout: "should-not-run", stderr: "" };
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "comfyui",
      operation: "update",
      settings: {
        mode: "cloud",
        baseUrl: "https://cloud.comfy.org",
      },
    });
    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "comfyui",
      operation: "install",
      dryRun: false,
    });

    expect(commandCalls).toEqual([]);
    expect(result.externalToolInstall).toMatchObject({
      ok: false,
      status: "cannot-install-cloud",
      executed: false,
      plan: [],
    });
    expect(result.events.at(-1)).toMatchObject({
      title: "外部工具安装被阻止",
      body: expect.stringContaining("Cloud"),
    });
  });

  it("lets the model request ComfyUI installation as an approval-gated dry-run tool", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-comfyui-install-tool-"));
    tempRoots.push(workspaceRoot);
    const installPath = join(workspaceRoot, "Software", "ComfyUI");
    const commandCalls = [];
    const providerCalls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        comfyUiCommandExists: (command) => command === "uvx",
        comfyUiCommandRunner: async (command, args) => {
          commandCalls.push({ command, args });
          return { exitCode: 0, stdout: "should-not-run-for-dry-run", stderr: "" };
        },
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          providerCalls.push({ url, method: init.method, body });
          const hasInstallResult = body.messages?.some(
            (message) =>
              message.role === "tool" && String(message.content).includes("ComfyUI 安装计划已生成"),
          );
          if (!hasInstallResult) {
            return jsonResponse({
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      {
                        id: "call-comfyui-install-1",
                        type: "function",
                        function: {
                          name: "director.comfyui.install",
                          arguments: JSON.stringify({
                            gpuFlag: "--m-series",
                            skipLaunch: true,
                            dryRun: true,
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            });
          }
          return jsonResponse({
            choices: [
              {
                message: {
                  content: "我已生成 ComfyUI 安装计划，未执行命令，确认后再继续。",
                },
              },
            ],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-comfyui-install-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "comfyui",
      operation: "update",
      settings: {
        localInstallPath: installPath,
      },
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "帮我安装 ComfyUI，先给安装计划",
      surface: "workbench",
    });

    expect(commandCalls).toEqual([]);
    expect(providerCalls[0]?.body?.tools?.map((tool) => tool.function?.name)).toEqual(
      expect.arrayContaining(["director.comfyui.install"]),
    );
    expect(result.conversationRuntime.finalText).toContain("未执行命令");
    expect(result.externalToolBus.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: "comfyui",
          operationId: "install",
          status: "completed",
          ok: true,
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("sk-comfyui-install-secret");
  });

  it("executes model-requested learning admit through the shared Host API endpoint", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-admit-tool-chat-"));
    tempRoots.push(workspaceRoot);
    const calls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        hostApiUrl: "http://127.0.0.1:3201",
        hostApiFetch: async (url, init = {}) => {
          const path = new URL(url).pathname;
          calls.push({
            kind: "host",
            url,
            method: init.method,
            body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
          });
          if (path === "/v1/learning/admit") {
            return jsonResponse(
              {
                schemaId: "director.host.learning-admit.v1",
                result: {
                  status: "ok",
                  candidateCount: 1,
                  artifactCount: 1,
                  quarantineCount: 0,
                },
                candidates: [
                  {
                    candidateId: "exp-admit-1",
                    title: "Pasted lesson: AI短剧镜头语言",
                    runtimeInjection: "disabled",
                  },
                ],
                artifacts: [{ artifactId: "artifact-admit-1" }],
                quarantines: [],
              },
              201,
            );
          }
          if (path === "/v1/catalog") {
            return jsonResponse(createEmptyHostApiCatalogFixture());
          }
          throw new Error(`unexpected Host API path ${path}`);
        },
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          calls.push({
            kind: "provider",
            url,
            method: init.method,
            body,
          });
          const hasAdmitResult = body.messages?.some(
            (message) =>
              message.role === "tool" &&
              String(message.content).includes("Pasted lesson: AI短剧镜头语言"),
          );
          if (!hasAdmitResult) {
            return jsonResponse({
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      {
                        id: "call-admit-1",
                        type: "function",
                        function: {
                          name: "director.learning.admit",
                          arguments: JSON.stringify({
                            source_id: "desktop-web-extract-admit",
                            privacy: "public",
                            sources: [
                              {
                                url: "https://example.test/shot-language",
                                title: "AI短剧镜头语言",
                                body: "短剧镜头经验：15秒短剧分镜先用中景建立人物和环境，再用近景推进情绪，最后用特写放大关键线索。这个规则适合 Director Angel 在制作短剧分镜时复用。",
                                content_type: "text/html",
                              },
                            ],
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            });
          }
          return jsonResponse({
            choices: [
              {
                message: {
                  content: "已准入并生成 1 条待审经验候选，仍需到经验库审核后才能收录。",
                },
              },
            ],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-admit-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
      prompt: "把刚才 web_extract 抓到的短剧镜头语言准入经验候选",
      sourceAction: {
        type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
        prompt: "把刚才 web_extract 抓到的短剧镜头语言准入经验候选",
        surface: "workbench",
        turnIntent: {
          kind: "chat",
          text: "把刚才 web_extract 抓到的短剧镜头语言准入经验候选",
        },
        responsePolicy: "result-first",
      },
    });

    const admitCall = calls.find(
      (call) => call.kind === "host" && new URL(call.url).pathname === "/v1/learning/admit",
    );
    const firstProviderCall = calls.find((call) => call.kind === "provider");
    expect(firstProviderCall?.body?.tools?.map((tool) => tool.function?.name)).toEqual(
      expect.arrayContaining(["web_extract", "director.learning.admit"]),
    );
    expect(admitCall?.body).toMatchObject({
      source_id: "desktop-web-extract-admit",
      privacy: "public",
      sources: [
        expect.objectContaining({
          title: "AI短剧镜头语言",
          url: "https://example.test/shot-language",
          content_type: "text/html",
          body: expect.stringContaining("短剧镜头经验"),
        }),
      ],
    });
    expect(
      calls.some((call) => call.kind === "host" && String(call.url).includes("/v1/learning/jobs")),
    ).toBe(false);
    expect(result.apiProviderRun.output).toContain("生成 1 条待审经验候选");
    expect(JSON.stringify(result)).not.toContain("sk-admit-secret");
  });

  it("accepts the pending learning candidate on natural confirmation without admitting duplicate text", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-learning-confirm-"));
    tempRoots.push(workspaceRoot);
    const calls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        hostApiUrl: "http://127.0.0.1:3201",
        hostApiFetch: async (url, init = {}) => {
          const path = new URL(url).pathname;
          calls.push({
            kind: "host",
            path,
            method: init.method,
            body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
          });
          if (path === "/v1/learning/admit") {
            return jsonResponse(
              {
                schemaId: "director.host.learning-admit.v1",
                result: { status: "ok", candidateCount: 1, artifactCount: 1, quarantineCount: 0 },
                candidates: [
                  {
                    candidateId: "exp-confirm-1",
                    title: "短剧镜头语言",
                    summary: "15 秒短剧先建立关系，再推进情绪，最后放大关键线索。",
                  },
                ],
                sourceEvidenceRefs: [
                  {
                    id: "source-confirm-1",
                    sourceAccessStatus: "available",
                    publishable: true,
                  },
                ],
                memoryEvidenceRecords: [
                  {
                    id: "memory-confirm-1",
                    sourceAccessStatus: "available",
                    publishable: true,
                  },
                ],
                quarantines: [],
              },
              201,
            );
          }
          if (path === "/v1/experience/candidates/exp-confirm-1/accept") {
            return jsonResponse({
              candidate: { candidateId: "exp-confirm-1" },
              review: { decision: "accepted" },
            });
          }
          if (path === "/v1/catalog") {
            return jsonResponse(createEmptyHostApiCatalogFixture());
          }
          throw new Error(`unexpected Host API path ${path}`);
        },
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          calls.push({ kind: "provider", url, method: init.method, body });
          const hasAdmitResult = body.messages?.some(
            (message) =>
              message.role === "tool" &&
              String(message.content).includes("短剧镜头语言"),
          );
          if (!hasAdmitResult) {
            return jsonResponse({
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      {
                        id: "call-admit-confirm-1",
                        type: "function",
                        function: {
                          name: "director.learning.admit",
                          arguments: JSON.stringify({
                            source_id: "desktop-learning-confirm",
                            sources: [
                              {
                                title: "短剧镜头语言",
                                url: "https://example.test/confirm",
                                body: "短剧镜头经验：15秒短剧先用中景建立人物和环境，再用近景推进情绪，最后用特写放大关键线索。",
                                content_type: "text/plain",
                              },
                            ],
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            });
          }
          return jsonResponse({
            choices: [{ message: { content: "我已经整理好了这条经验。" } }],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-confirm-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "学习这段短剧镜头语言",
      surface: "workbench",
    });
    const artifactDocument = JSON.parse(
      readFileSync(join(workspaceRoot, ".hotflow", "conversation-runtime", "learning-artifacts.json"), "utf8"),
    );
    expect(artifactDocument.confirmations).toEqual([
      expect.objectContaining({
        status: "pending",
        candidateIds: ["exp-confirm-1"],
      }),
    ]);
    const pendingSnapshot = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    expect(pendingSnapshot.snapshot.assets.learning).toMatchObject({
      pendingConfirmationCount: 1,
      pendingConfirmations: [
        expect.objectContaining({
          candidateIds: ["exp-confirm-1"],
          sourceSurface: "desktop",
          sourceKind: "tool-result",
        }),
      ],
    });
    expect(pendingSnapshot.snapshot.assets.review).toMatchObject({
      pendingLearningConfirmationCount: 1,
    });
    const confirmed = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "嗯，就这个，保存成经验",
      surface: "workbench",
    });

    expect(calls.filter((call) => call.path === "/v1/learning/admit")).toHaveLength(1);
    expect(calls.map((call) => call.path).filter(Boolean)).toEqual(
      expect.arrayContaining(["/v1/experience/candidates/exp-confirm-1/accept"]),
    );
    expect(confirmed.conversationRuntime.finalText).toContain("已确认 1 条经验候选");
    expect(JSON.stringify(confirmed)).not.toContain("sk-confirm-secret");
  });

	  it("keeps plain URL learning followup and save confirmation bound to the latest learned link", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-url-loop-latest-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    await directorKnowledge.learnDirectorExperience(workspaceRoot, {
      texts: [
        {
          title: "旧的六宫格故事板经验",
          content:
            "六宫格故事板经验：AI 视频前期用六宫格替代九宫格，先锁定时间、场景、运镜和情绪，再拆关键帧逐镜头生成。",
          sourceRef: "https://x.com/old/status/100",
        },
      ],
      privacy: "public",
    });
    const xUrl = "https://x.com/Adam38363368936/status/2056318384317620663";
    writeOpenCliManifestFixture(workspaceRoot, [
      {
        site: "twitter",
        name: "thread",
        description: "Get a tweet thread.",
        access: "read",
        browser: true,
        domain: "x.com",
        args: [{ name: "tweet-id", type: "string", required: true, positional: true }],
      },
    ]);
    const providerCalls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openCliRunner: async (input) => {
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify([
              {
                id: "2056318384317620663",
                author: "Adam",
                text: "Latest URL loop lesson: keep the just-learned link as the active experience candidate, then allow natural confirmation to save it.",
                url: xUrl,
                media_urls: [],
              },
            ]),
            stderr: "",
          };
        },
        apiProviderFetch: async (url, init) => {
          providerCalls.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
          return fakeLearningEvidenceAwareProviderResponse(
            init,
            "刚才学到的是 Latest URL loop lesson：要把刚学习的链接保留为当前活跃经验候选，然后允许用户用自然确认把它保存成经验。",
          );
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const learned = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: `学习这个链接：${xUrl}`,
      surface: "workbench",
    });
    expect(learned.events.at(-1)?.body).toContain("看完了。核心是：");
    expect(learned.events.at(-1)?.body).toContain("学到的要点：");
    expect(learned.events.at(-1)?.body).toContain("Latest URL loop lesson");
    expect(learned.events.at(-1)?.body).toContain("要收录吗？");

    const followup = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "刚才学到了什么？",
      surface: "workbench",
    });
    expect(followup.conversationRuntime.finalText).toContain(xUrl);
    expect(followup.conversationRuntime.finalText).toContain("Latest URL loop lesson");
    expect(followup.conversationRuntime.finalText).not.toContain("六宫格故事板");

    const providerCallsBeforeConfirmation = providerCalls.length;
    const confirmed = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "嗯，就这个，保存成经验",
      surface: "workbench",
    });
    expect(confirmed.conversationRuntime.finalText).toContain("已保存这条经验");
    expect(confirmed.conversationRuntime.finalText).toContain("已确认 1 条经验候选");
	    expect(providerCalls).toHaveLength(providerCallsBeforeConfirmation);
	  });

		  it("carries the latest URL evidence frame into arbitrary follow-up turns without keyword guessing", async () => {
	    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-url-active-frame-"));
	    tempRoots.push(workspaceRoot);
	    writeLearningSwitchFixture(workspaceRoot, true);
	    const xUrl = "https://x.com/Adam38363368936/status/2056318384317620663";
	    writeOpenCliManifestFixture(workspaceRoot, [
	      {
	        site: "twitter",
	        name: "article",
	        description: "Fetch a Twitter Article.",
	        access: "read",
	        browser: true,
	        domain: "x.com",
	        args: [{ name: "tweet-id", type: "string", required: true, positional: true }],
	      },
	    ]);
	    const providerRequests = [];
	    const bridge = createDirectorDesktopBridgeFacade({
	      handlers: createDirectorDesktopSystemHandlers({
	        workspaceRoot,
	        knowledge: directorKnowledge,
	        openCliRunner: async (input) => {
	          if (input.args[0] === "--version") {
	            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
	          }
	          if (input.args[0] === "doctor") {
	            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
	          }
	          return {
	            exitCode: 0,
	            stdout: JSON.stringify([
	              {
	                title: "做了上千个 AI 图像视频之后，我发现 90% 的新手都在犯同一个错误",
	                content:
	                  "AIGC 新手最大的误区不是参数不会调，而是没有先跑通完整流程。正确学习路径是先完成一个可交付项目，再补 Prompt 工程、参数理解和商业应用能力。",
	                url: xUrl,
	              },
	            ]),
	            stderr: "",
	          };
	        },
	        apiProviderFetch: async (_url, init) => {
	          const body = JSON.parse(String(init.body));
	          providerRequests.push(body);
	          const lastMessage = body.messages.at(-1);
	          if (
	            lastMessage?.role === "tool" &&
	            typeof lastMessage.content === "string" &&
	            lastMessage.content.includes("<learning-evidence-context>")
	          ) {
	            return fakeApiProviderTextResponse(
	              `上一轮证据已绑定：AIGC 新手最大的误区不是参数不会调，而是没有先跑通完整流程。来源：${xUrl}`,
	            );
	          }
	          return fakeApiProviderToolCallsResponse([
	            {
	              id: "call-list-active-frame-candidates",
	              name: "director.experience.candidates.list",
	              args: { status: "pending", maxItems: 5 },
	            },
	          ]);
	        },
	      }),
	    });
	    await configureFakeApiProvider(bridge);

	    await bridge.invoke({
	      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
	      prompt: `学习这个链接：${xUrl}`,
	      surface: "workbench",
	    });
	    const pendingSnapshot = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
	    const activeCandidateIds =
	      pendingSnapshot.snapshot.assets.learning.pendingConfirmations[0]?.candidateIds ?? [];
	    expect(activeCandidateIds).toHaveLength(1);
	    const providerCallsAfterLearning = providerRequests.length;
	    const followup = await bridge.invoke({
	      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
	      prompt: "这到底讲的是啥",
	      surface: "workbench",
	    });

	    expect(followup.conversationRuntime.finalText).toContain(xUrl);
	    expect(followup.conversationRuntime.finalText).toContain("AIGC 新手最大的误区");
	    expect(followup.conversationRuntime.evidenceDisclosure).toMatchObject({
	      schemaVersion: "director.desktop.evidence-disclosure.v1",
	      sourceCount: 1,
	      sources: [
	        expect.objectContaining({
	          url: xUrl,
	          fullBodyChars: expect.any(Number),
	          sourceAccessStatus: "available",
	          readStatus: "read",
	        }),
	      ],
	    });
	    expect(followup.apiProviderRun.evidenceDisclosure).toEqual(
	      followup.conversationRuntime.evidenceDisclosure,
	    );
	    expect(providerRequests.length).toBeGreaterThan(providerCallsAfterLearning);
	    expect(followup.conversationRuntime.replySource).toBe("tool-loop");
	    expect(followup.operatorTrace).toEqual(
	      expect.arrayContaining([
	        expect.objectContaining({
	          stage: "tool.required",
	          metadata: expect.objectContaining({
	            requiredToolMetadata: expect.arrayContaining([
	              expect.objectContaining({
	                reason: "active_evidence_frame",
	                sourceUrls: [xUrl],
	              }),
	            ]),
	          }),
	        }),
	      ]),
	    );
	    const toolEvent = followup.runtimeEvents.find(
	      (event) =>
	        event.kind === "runtime.tool" &&
	        event.payload?.tool?.name === "director.experience.candidates.list" &&
	        event.payload?.tool?.phase === "completed",
	    );
		    expect(toolEvent?.payload?.tool?.metadata?.toolResultMetadata).toMatchObject({
		      candidateIds: activeCandidateIds,
		      sourceUrls: [xUrl],
		    });
		  });

  it("answers arbitrary learned-link follow-up with clean evidence takeaways instead of fragmented prompt text", async () => {
		    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-url-clean-followup-"));
		    tempRoots.push(workspaceRoot);
		    writeLearningSwitchFixture(workspaceRoot, true);
		    const xUrl = "https://x.com/TanLuAI/status/2056949172629381407";
		    writeOpenCliManifestFixture(workspaceRoot, [
		      {
		        site: "twitter",
		        name: "thread",
		        description: "Get a tweet thread.",
		        access: "read",
		        browser: true,
		        domain: "x.com",
		        args: [{ name: "tweet-id", type: "string", required: true, positional: true }],
		      },
		    ]);
		    const sourceText = [
		      "GPT做资产图，人设图真的太方便了，以前需要一个配角一个配角的生成，现在只要结合前序视频的截图和剧情设定，就可以生成一张带有很多配角的资产详情图。",
		      "哪个部分不满意就再生成一张，截取或者放大生成每一张想要的部分。",
		      "很适合我这种一边生成，一边往后拓展剧情和人物的做法。",
		      "",
		      "基于参考图的风格和猫，设计个新角色-西部牛仔猫的人物图，西部牛仔的打扮，但是还原猫的大小等特征。剧情设定在一个荒土覆盖的赛博世界星球，不需要出现图片中的人物，但是确保风格，色调保持一致。以文字标记每一个区域的名称，图片当中包含了该角色的人设图（背景纯白，左侧近景胸像，右侧全身三视图：正视图、侧视图、背视图。完全真人写实风格，严格保持与参考图的人物一致性和风格。），身高参数等，武器图（一把老式手枪等，背景纯白，外观图和细节图。完全真人写实风格）。",
		    ].join("\n");
		    const bridge = createDirectorDesktopBridgeFacade({
		      handlers: createDirectorDesktopSystemHandlers({
		        workspaceRoot,
		        knowledge: directorKnowledge,
		        openCliRunner: async (input) => {
		          if (input.args[0] === "--version") {
		            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
		          }
		          if (input.args[0] === "doctor") {
		            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
		          }
		          return {
		            exitCode: 0,
		            stdout: JSON.stringify([
		              {
		                id: "2056949172629381407",
		                author: "TanLuAI",
		                text: sourceText,
		                url: xUrl,
		                media: [{ kind: "image" }, { kind: "image" }, { kind: "image" }],
		              },
		            ]),
		            stderr: "",
		          };
		        },
		        apiProviderFetch: async () =>
		          fakeApiProviderTextResponse(
		            "经验提炼：很适合一边生成，一边往后拓展剧情和人物；GPT做资产图、人设图时，可以结合前序视频截图和剧情设定生成多配角资产详情图；哪个部分不满意就再生成一张，截取或者放大生成想要的部分。",
		          ),
		      }),
		    });
		    await configureFakeApiProvider(bridge);

		    await bridge.invoke({
		      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
		      prompt: `学习这个链接：${xUrl}`,
		      surface: "workbench",
		    });
		    const followup = await bridge.invoke({
		      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
		      prompt: "然后学习了什么？",
		      surface: "workbench",
		    });
		    const finalText = followup.conversationRuntime.finalText;

		    expect(finalText).toContain(xUrl);
		    expect(finalText).toContain("GPT做资产图");
		    expect(finalText).toContain("截取或者放大");
		    expect(finalText).toContain("文本已读，媒体未理解");
		    expect(finalText).not.toContain("），身高参数");
		    expect(finalText).not.toContain("媒体内容：文本已读");
    expect((finalText.match(/哪个部分不满意/gu) ?? [])).toHaveLength(1);
    expect(followup.conversationRuntime.finalText).not.toContain("制作运行已推进");
  });

  it("fails closed when OpenCLI X URL learning times out instead of hanging the desktop bridge", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-opencli-learning-timeout-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const previousTimeout = process.env.OPENCLI_URL_LEARNING_TIMEOUT_MS;
    process.env.OPENCLI_URL_LEARNING_TIMEOUT_MS = "20";
    const xUrl = "https://x.com/TanLuAI/status/2056949172629381407";
    writeOpenCliManifestFixture(workspaceRoot, [
      {
        site: "twitter",
        name: "article",
        description: "Fetch a Twitter Article.",
        access: "read",
        browser: true,
        domain: "x.com",
        args: [{ name: "tweet-id", type: "string", required: true, positional: true }],
      },
    ]);
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openCliRunner: async (input) => {
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return await new Promise(() => {});
        },
      }),
    });

    try {
      const learned = await bridge.invoke({
        type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
        prompt: `学习这个链接：${xUrl}`,
        surface: "workbench",
      });
      const body = learned.events.at(-1)?.body ?? "";
      const inspection = await directorKnowledge.inspectDirectorExperienceCandidates(workspaceRoot);

      expect(body).toContain("这次还没有学到可信正文");
      expect(body).toContain("external-tool-execution-timeout");
      expect(body).not.toContain("已整理出 1 条待确认经验候选");
      expect(inspection.candidates).toHaveLength(0);
      expect(learned.snapshot.candidate.count).toBe(0);
    } finally {
      restoreOptionalEnv("OPENCLI_URL_LEARNING_TIMEOUT_MS", previousTimeout);
    }
  });

  it("keeps natural save confirmation bound to the latest candidate when the same URL has older candidates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-url-loop-same-url-latest-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const xUrl = "https://x.com/Adam38363368936/status/2056318384317620663";
    await directorKnowledge.learnDirectorExperience(workspaceRoot, {
      texts: [
        {
          title: "旧的污染候选",
          content:
            "旧候选内容：这条旧经验来自之前错误抓到的回复区，不能在新一轮学习确认时一起保存。",
          sourceRef: xUrl,
        },
      ],
      privacy: "public",
    });
    const beforeLearning = await directorKnowledge.inspectDirectorExperienceCandidates(workspaceRoot);
    const olderCandidateId = beforeLearning.candidates[0]?.candidate?.candidateId;
    expect(olderCandidateId).toEqual(expect.any(String));
    writeOpenCliManifestFixture(workspaceRoot, [
      {
        site: "twitter",
        name: "article",
        description: "Fetch a Twitter Article.",
        access: "read",
        browser: true,
        domain: "x.com",
        args: [{ name: "tweet-id", type: "string", required: true, positional: true }],
      },
    ]);
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openCliRunner: async (input) => {
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify([
              {
                title: "做了上千个 AI 图像视频之后，我发现 90% 的新手都在犯同一个错误",
                content:
                  "这半年我密集做了几百上千个 AI 图像和视频作品。新手学 AIGC 的误区包括死磕参数、只看教程不动手、追工具不追能力。真正有效的路径是先跑通全流程，再学习 Prompt 工程，再理解参数和进阶工作流。Level 0 到 Level 5 应该从认知启蒙、工具上手、Prompt 工程、原理参数、进阶技巧一路走到商业应用。",
                url: xUrl,
              },
            ]),
            stderr: "",
          };
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: `学习这个链接：${xUrl}`,
      surface: "workbench",
    });
    const pending = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    const candidateIds = pending.snapshot.assets.learning.pendingConfirmations[0]?.candidateIds ?? [];
    expect(candidateIds).toHaveLength(1);
    expect(candidateIds).not.toContain(olderCandidateId);

    const confirmed = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "嗯，就这个，保存成经验",
      surface: "workbench",
    });
    expect(confirmed.conversationRuntime.finalText).toContain("已确认 1 条经验候选");
    const repositoryLearning = readLearningCandidates({
      dataDir: join(workspaceRoot, ".hotflow"),
    });
    expect(repositoryLearning.candidates).toHaveLength(1);
    expect(repositoryLearning.candidates[0]).toMatchObject({
      itemId: candidateIds[0],
      stage: "reviewed",
      metadata: expect.objectContaining({
        sourceRef: xUrl,
        confirmationId: expect.any(String),
      }),
    });
  });

  it("does not revive a rejected pending learning candidate through natural save confirmation", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-url-loop-rejected-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const xUrl = "https://x.com/Adam38363368936/status/2056318384317620663";
    writeOpenCliManifestFixture(workspaceRoot, [
      {
        site: "twitter",
        name: "article",
        description: "Fetch a Twitter Article.",
        access: "read",
        browser: true,
        domain: "x.com",
        args: [{ name: "tweet-id", type: "string", required: true, positional: true }],
      },
    ]);
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openCliRunner: async (input) => {
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify([
              {
                title: "做了上千个 AI 图像视频之后，我发现 90% 的新手都在犯同一个错误",
                content:
                  "这半年我密集做了几百上千个 AI 图像和视频作品。新手学 AIGC 的误区包括死磕参数、只看教程不动手、追工具不追能力。真正有效的路径是先跑通全流程，再学习 Prompt 工程，再理解参数和进阶工作流。Level 0 到 Level 5 应该从认知启蒙、工具上手、Prompt 工程、原理参数、进阶技巧一路走到商业应用。",
                url: xUrl,
              },
            ]),
            stderr: "",
          };
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
      url: xUrl,
      privacy: "public",
    });
    const pending = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    const candidateId = pending.snapshot.assets.learning.pendingConfirmations[0]?.candidateIds[0];
    expect(candidateId).toEqual(expect.any(String));

    await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_REJECT,
      candidateId,
      note: "polluted source audit",
      now: "2026-05-19T12:00:00.000Z",
    });
    const confirmed = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "嗯，就这个，保存成经验",
      surface: "workbench",
    });

    expect(confirmed.conversationRuntime.finalText).toContain("没有保存这条经验");
    expect(confirmed.conversationRuntime.finalText).toContain("最新审核已拒绝");
    expect(confirmed.conversationRuntime.finalText).not.toContain("已保存这条经验");
    const after = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    expect(after.snapshot.candidate.items.find((item) => item.id === candidateId)?.status).toBe(
      "rejected",
    );
    expect(after.snapshot.assets.learning.pendingConfirmationCount).toBe(0);
  });

  it("blocks low-quality model-requested learning admit sources before they reach Host API", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-admit-quality-gate-"));
    tempRoots.push(workspaceRoot);
    const hostCalls = [];
    const handlers = createDirectorDesktopSystemHandlers({
      workspaceRoot,
      knowledge: directorKnowledge,
      hostApiUrl: "http://127.0.0.1:3201",
      hostApiFetch: async (url, init = {}) => {
        hostCalls.push({ url, method: init.method, body: init.body });
        if (new URL(url).pathname === "/v1/catalog") {
          return jsonResponse(createEmptyHostApiCatalogFixture());
        }
        throw new Error(`low-quality source must not call ${url}`);
      },
    });
    const bridge = createDirectorDesktopBridgeFacade({
      handlers,
      externalToolControlPlane: handlers.externalToolControlPlane,
    });

    const result = await bridge.externalToolControlPlane.invoke({
      toolId: "director.learning.admit",
      args: {
        source_id: "desktop-low-quality-admit",
        sources: [
          {
            url: "https://mp.weixin.qq.com/s/bad",
            title: "微信公众平台",
            body: "环境异常 当前环境异常，完成验证后即可继续访问。视频 小程序 赞 在看",
            quality: {
              status: "blocked",
              publishable: false,
              reason: "low-quality extracted content",
            },
            source_snapshot: {
              access_status: "source_access_limited",
            },
          },
        ],
      },
      turnId: "turn-desktop-admit-quality-gate",
      sessionKey: "desktop:quality-gate",
      idempotencyKey: "call-desktop-admit-quality-gate",
    });

    expect(result).toMatchObject({
      ok: false,
      status: "error",
      toolId: "director.learning.admit",
      output: expect.objectContaining({
        status: "blocked",
        reason: "low-quality-source",
        candidateCount: 0,
      }),
    });
    expect(result.content).toContain("没有准入学习");
    expect(result.content).toContain("可信正文");
    expect(hostCalls.map((call) => new URL(call.url).pathname)).not.toContain(
      "/v1/learning/admit",
    );
  });

  it("requires explicit user authorization before running media understanding for learned media", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-media-auth-required-"));
    tempRoots.push(workspaceRoot);
    const handlers = createDirectorDesktopSystemHandlers({
      workspaceRoot,
      knowledge: directorKnowledge,
    });
    const bridge = createDirectorDesktopBridgeFacade({
      handlers,
      externalToolControlPlane: handlers.externalToolControlPlane,
    });

    const result = await bridge.externalToolControlPlane.invoke({
      toolId: "director.learning.media_understand",
      args: {
        source_ref: "https://x.com/ponyodong/status/2055150198989746559",
        mode: "low_cost",
        token_budget: 7200,
      },
      turnId: "turn-media-auth-required",
      sessionKey: "desktop:workbench",
      idempotencyKey: "call-media-auth-required",
    });

    expect(result).toMatchObject({
      ok: false,
      status: "error",
      toolId: "director.learning.media_understand",
      output: expect.objectContaining({
        status: "authorization_required",
        reason: "user-authorization-required",
      }),
    });
    expect(result.content).toContain("需要用户明确授权");
  });

  it("runs authorized media understanding and exposes metadata-level evidence in candidate reads", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-media-understand-"));
    tempRoots.push(workspaceRoot);
    const sourceRef = "https://x.com/ponyodong/status/2055150198989746559";
    const candidate = createExperienceCandidateFixture({
      candidateId: "experience-ponyo-media-understand",
      title: "波妞PONYO：六宫格故事板媒体案例",
      quality: { score: 90, verdict: "usable", reasons: [] },
      evidencePreview:
        "视频制作干货分享｜六宫格故事板。媒体资源：pbs.twimg.com 图片、blob:https://x.com/video；没有 vision_analyzed 记录。",
      createdAtMs: 200,
      sourceRef,
    });
    const knowledge = createSnapshotKnowledgeFixture({
      experience: {
        total: 1,
        candidates: [
          {
            candidate,
            status: "pending",
            latestReview: null,
            promotions: [],
            latestPromotion: null,
            promoted: false,
            taxonomy: null,
          },
        ],
        artifacts: [
          {
            artifactId: "artifact-quality-1",
            sourceRef,
            sourceKind: "browser-page",
            readableContent: candidate.evidencePreview,
          },
        ],
        artifactTotal: 1,
        quarantineTotal: 0,
        quarantined: [],
        taxonomy: {
          schemaVersion: "director.experience.taxonomy.v1",
          categories: [],
          tags: [],
          candidates: [],
        },
      },
    });
    const learningArtifact = createLearningArtifact({
      artifactId: "learning-artifact-ponyo-media",
      sessionKey: "desktop:workbench",
      turnRunId: "turn-ponyo-learning",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef,
      roleScope: {
        roleName: "Director Angel",
        domain: "影视制作",
        responsibilityTags: ["导演", "短剧", "AI 制作"],
      },
      mediaEvidenceRefs: [
        createMediaEvidenceRef({
          id: "media-evidence-image-1",
          sourceRef: "https://pbs.twimg.com/media/example.jpg",
          status: "listed_only",
          publishable: false,
          metadata: { kind: "image", width: 1280, height: 720 },
        }),
        createMediaEvidenceRef({
          id: "media-evidence-video-1",
          sourceRef: "blob:https://x.com/video-1",
          status: "listed_only",
          publishable: false,
          metadata: { kind: "video", poster: "https://pbs.twimg.com/media/poster.jpg" },
        }),
      ],
      confidence: "low",
      publishable: false,
      privacy: "public",
      observedAtMs: 1_777_300_000_000,
      metadata: {
        candidateIds: ["experience-ponyo-media-understand"],
      },
    });
    mkdirSync(join(workspaceRoot, ".hotflow", "conversation-runtime"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, ".hotflow", "conversation-runtime", "learning-artifacts.json"),
      `${JSON.stringify(
        {
          schemaVersion: "conversation-runtime.learning-artifacts.v1",
          artifacts: [learningArtifact],
          confirmations: [],
        },
        null,
        2,
      )}\n`,
    );
    const handlers = createDirectorDesktopSystemHandlers({
      workspaceRoot,
      knowledge,
    });
    const bridge = createDirectorDesktopBridgeFacade({
      handlers,
      externalToolControlPlane: handlers.externalToolControlPlane,
    });

    const result = await bridge.externalToolControlPlane.invoke({
      toolId: "director.learning.media_understand",
      args: {
        artifact_id: "learning-artifact-ponyo-media",
        mode: "low_cost",
        user_authorized: true,
        token_budget: 7200,
        max_assets: 2,
      },
      turnId: "turn-media-understand",
      sessionKey: "desktop:workbench",
      idempotencyKey: "call-media-understand",
    });

    expect(result).toMatchObject({
      ok: true,
      status: "success",
      toolId: "director.learning.media_understand",
      output: expect.objectContaining({
        status: "success",
        artifactId: "learning-artifact-ponyo-media",
        processedCount: 2,
        remainingUnunderstoodMediaCount: 0,
      }),
    });
    expect(result.content).toContain("元数据级理解");
    expect(result.content).toContain("不代表完整视觉/视频/音频语义分析");

    const artifactDocument = JSON.parse(
      readFileSync(
        join(workspaceRoot, ".hotflow", "conversation-runtime", "learning-artifacts.json"),
        "utf8",
      ),
    );
    expect(artifactDocument.artifacts[0]).toMatchObject({
      status: "pending_confirmation",
      publishable: true,
      metadata: expect.objectContaining({
        mediaUnderstanding: expect.objectContaining({
          status: "metadata_understood",
          runner: "media-understanding.local",
          processedCount: 2,
          semanticUnderstanding: "metadata-only",
        }),
      }),
    });
    expect(artifactDocument.artifacts[0].mediaEvidenceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "vision_analyzed",
          realVisualUnderstanding: true,
          metadata: expect.objectContaining({
            semanticUnderstanding: "metadata-only",
            realVisualUnderstanding: false,
          }),
        }),
      ]),
    );

    const listResult = await bridge.externalToolControlPlane.invoke({
      toolId: "director.experience.candidates.list",
      args: { status: "pending", maxItems: 1 },
      turnId: "turn-candidate-list-after-media",
      sessionKey: "desktop:workbench",
      idempotencyKey: "call-candidate-list-after-media",
    });
    expect(listResult.content).toContain("media_understanding");
    expect(listResult.content).toContain("已有元数据级媒体理解证据");
    expect(listResult.content).toContain("还没有完成完整视觉/视频/音频语义精读");
    expect(JSON.stringify(listResult)).not.toContain("poster=https://");
  });

  it("runs learning media understanding through the desktop bridge action", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-media-action-"));
    tempRoots.push(workspaceRoot);
    const sourceRef = "https://x.com/ponyodong/status/2055150198989746559";
    const learningArtifact = createLearningArtifact({
      artifactId: "learning-artifact-action-media",
      sessionKey: "desktop:workbench",
      turnRunId: "turn-ponyo-learning-action",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef,
      roleScope: {
        roleName: "Director Angel",
        domain: "影视制作",
        responsibilityTags: ["导演", "短剧", "AI 制作"],
      },
      mediaEvidenceRefs: [
        createMediaEvidenceRef({
          id: "media-evidence-action-image-1",
          sourceRef: "https://pbs.twimg.com/media/action-example.jpg",
          status: "listed_only",
          publishable: false,
          metadata: { kind: "image", width: 1280, height: 720 },
        }),
      ],
      confidence: "low",
      publishable: false,
      privacy: "public",
      observedAtMs: 1_777_300_000_000,
      metadata: {
        candidateIds: ["experience-ponyo-media-action"],
      },
    });
    mkdirSync(join(workspaceRoot, ".hotflow", "conversation-runtime"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, ".hotflow", "conversation-runtime", "learning-artifacts.json"),
      `${JSON.stringify(
        {
          schemaVersion: "conversation-runtime.learning-artifacts.v1",
          artifacts: [learningArtifact],
          confirmations: [],
        },
        null,
        2,
      )}\n`,
    );
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const blocked = await bridge.invoke({
      type: DESKTOP_ACTIONS.LEARNING_MEDIA_UNDERSTAND,
      artifactId: "learning-artifact-action-media",
      mode: "low_cost",
      tokenBudget: 7200,
      maxAssets: 1,
    });

    expect(blocked.mediaUnderstanding).toMatchObject({
      ok: false,
      output: expect.objectContaining({
        status: "authorization_required",
      }),
    });
    expect(blocked.commandResult.stdout).toContain("需要用户明确授权");

    const inventoryOnly = await bridge.invoke({
      type: DESKTOP_ACTIONS.LEARNING_MEDIA_UNDERSTAND,
      artifactId: "learning-artifact-action-media",
      mode: "media_inventory",
      tokenBudget: 0,
      maxAssets: 1,
    });

    expect(inventoryOnly.mediaUnderstanding).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        status: "media_inventory_recorded",
        artifactId: "learning-artifact-action-media",
        processedCount: 0,
      }),
    });
    expect(inventoryOnly.commandResult.stdout).toContain("只记录媒体清单");
    expect(inventoryOnly.commandResult.stdout).toContain("不会调用视觉/视频/音频理解工具");

    const allowed = await bridge.invoke({
      type: DESKTOP_ACTIONS.LEARNING_MEDIA_UNDERSTAND,
      artifactId: "learning-artifact-action-media",
      mode: "low_cost",
      userAuthorized: true,
      tokenBudget: 7200,
      maxAssets: 1,
    });

    expect(allowed.mediaUnderstanding).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        status: "success",
        artifactId: "learning-artifact-action-media",
        processedCount: 1,
      }),
    });
    expect(allowed.commandResult).toMatchObject({
      command: expect.objectContaining({
        id: "learning.mediaUnderstand",
        domain: "learning",
      }),
    });
    expect(allowed.commandResult.stdout).toContain("元数据级理解");
    const artifactDocument = JSON.parse(
      readFileSync(
        join(workspaceRoot, ".hotflow", "conversation-runtime", "learning-artifacts.json"),
        "utf8",
      ),
    );
    expect(artifactDocument.artifacts[0].metadata.mediaUnderstanding).toMatchObject({
      status: "metadata_understood",
      processedCount: 1,
      tokenBudget: 7200,
    });
  });

  it("finds learning media artifacts from evidence source refs when ids are missing", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-media-source-ref-"));
    tempRoots.push(workspaceRoot);
    const requestedSourceRef = "https://x.com/TanLuAI/status/2056949172629381407";
    const storedSourceRef = "https://twitter.com/TanLuAI/status/2056949172629381407?lang=zh";
    const learningArtifact = createLearningArtifact({
      artifactId: "learning-artifact-source-ref-media",
      sessionKey: "desktop:workbench",
      turnRunId: "turn-source-ref-learning-action",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef: storedSourceRef,
      roleScope: {
        roleName: "Director Angel",
        domain: "影视制作",
        responsibilityTags: ["导演", "短剧", "AI 制作"],
      },
      mediaEvidenceRefs: [
        createMediaEvidenceRef({
          id: "media-evidence-source-ref-image-1",
          sourceRef: "https://pbs.twimg.com/media/source-ref-example.jpg",
          status: "listed_only",
          publishable: false,
          metadata: { kind: "image", width: 1280, height: 720 },
        }),
        createMediaEvidenceRef({
          id: "media-evidence-source-ref-video-1",
          sourceRef: "blob:https://x.com/source-ref-video",
          status: "listed_only",
          publishable: false,
          metadata: { kind: "video" },
        }),
      ],
      confidence: "low",
      publishable: false,
      privacy: "public",
      observedAtMs: 1_777_300_000_000,
      metadata: {
        candidateIds: ["experience-source-ref-media-action"],
        sourceUrl: requestedSourceRef,
      },
    });
    mkdirSync(join(workspaceRoot, ".hotflow", "conversation-runtime"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, ".hotflow", "conversation-runtime", "learning-artifacts.json"),
      `${JSON.stringify(
        {
          schemaVersion: "conversation-runtime.learning-artifacts.v1",
          artifacts: [learningArtifact],
          confirmations: [],
        },
        null,
        2,
      )}\n`,
    );
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const inventoryOnly = await bridge.invoke({
      type: DESKTOP_ACTIONS.LEARNING_MEDIA_UNDERSTAND,
      sourceRef: requestedSourceRef,
      mode: "media_inventory",
      tokenBudget: 0,
      maxAssets: 2,
    });

    expect(inventoryOnly.mediaUnderstanding).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        status: "media_inventory_recorded",
        artifactId: "learning-artifact-source-ref-media",
        remainingUnunderstoodMediaCount: 2,
      }),
    });
    expect(inventoryOnly.commandResult.stdout).not.toContain("not_found");
    expect(inventoryOnly.commandResult.stdout).toContain("文本已读；媒体未理解");
  });

  it("falls back from stale artifact ids to source refs for learning media authorization", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-media-stale-id-"));
    tempRoots.push(workspaceRoot);
    const requestedSourceRef = "https://x.com/TanLuAI/status/2056949172629381407";
    const staleArtifact = createLearningArtifact({
      artifactId: "learning-artifact-stale-no-media",
      sessionKey: "desktop:workbench",
      turnRunId: "turn-stale-no-media",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef: requestedSourceRef,
      roleScope: {
        roleName: "Director Angel",
        domain: "影视制作",
        responsibilityTags: ["导演", "短剧", "AI 制作"],
      },
      mediaEvidenceRefs: [],
      confidence: "high",
      publishable: true,
      privacy: "public",
      observedAtMs: 1_777_300_000_000,
      metadata: {
        candidateIds: ["experience-tanluai-stale"],
      },
    });
    const freshArtifact = createLearningArtifact({
      artifactId: "learning-artifact-fresh-with-media",
      sessionKey: "desktop:workbench",
      turnRunId: "turn-fresh-with-media",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef: "https://twitter.com/TanLuAI/status/2056949172629381407?lang=zh",
      roleScope: {
        roleName: "Director Angel",
        domain: "影视制作",
        responsibilityTags: ["导演", "短剧", "AI 制作"],
      },
      mediaEvidenceRefs: [
        createMediaEvidenceRef({
          id: "media-evidence-stale-fallback-image-1",
          sourceRef: "https://pbs.twimg.com/media/stale-fallback.jpg",
          status: "listed_only",
          publishable: false,
          metadata: { kind: "image" },
        }),
      ],
      confidence: "low",
      publishable: false,
      privacy: "public",
      observedAtMs: 1_777_300_001_000,
      metadata: {
        candidateIds: ["experience-tanluai-stale"],
        sourceUrl: requestedSourceRef,
      },
    });
    mkdirSync(join(workspaceRoot, ".hotflow", "conversation-runtime"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, ".hotflow", "conversation-runtime", "learning-artifacts.json"),
      `${JSON.stringify(
        {
          schemaVersion: "conversation-runtime.learning-artifacts.v1",
          artifacts: [staleArtifact, freshArtifact],
          confirmations: [],
        },
        null,
        2,
      )}\n`,
    );
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const inventoryOnly = await bridge.invoke({
      type: DESKTOP_ACTIONS.LEARNING_MEDIA_UNDERSTAND,
      artifactId: "learning-artifact-stale-no-media",
      sourceRef: requestedSourceRef,
      mode: "media_inventory",
      tokenBudget: 0,
      maxAssets: 1,
    });

    expect(inventoryOnly.mediaUnderstanding).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        status: "media_inventory_recorded",
        artifactId: "learning-artifact-fresh-with-media",
        remainingUnunderstoodMediaCount: 1,
      }),
    });
    expect(inventoryOnly.commandResult.stdout).not.toContain("not_found");
  });

  it("hydrates legacy media-only learning artifacts from stored media inventory", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-media-legacy-inventory-"));
    tempRoots.push(workspaceRoot);
    const requestedSourceRef = "https://x.com/TanLuAI/status/2056949172629381407";
    const legacyArtifact = createLearningArtifact({
      artifactId: "learning-artifact-legacy-inventory-only",
      sessionKey: "desktop:workbench",
      turnRunId: "turn-legacy-inventory-only",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef: requestedSourceRef,
      roleScope: {
        roleName: "Director Angel",
        domain: "影视制作",
        responsibilityTags: ["导演", "短剧", "AI 制作"],
      },
      mediaEvidenceRefs: [],
      confidence: "low",
      publishable: false,
      privacy: "public",
      observedAtMs: 1_777_300_000_000,
      metadata: {
        candidateIds: ["experience-tanluai-legacy-inventory"],
        mediaInventory: {
          schemaVersion: "director.desktop.media-inventory.v1",
          assetCount: 2,
          imageCount: 1,
          videoCount: 1,
          audioCount: 0,
          posterCount: 0,
          blobCount: 0,
          unknownCount: 0,
          assets: [],
        },
      },
    });
    mkdirSync(join(workspaceRoot, ".hotflow", "conversation-runtime"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, ".hotflow", "conversation-runtime", "learning-artifacts.json"),
      `${JSON.stringify(
        {
          schemaVersion: "conversation-runtime.learning-artifacts.v1",
          artifacts: [legacyArtifact],
          confirmations: [],
        },
        null,
        2,
      )}\n`,
    );
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const inventoryOnly = await bridge.invoke({
      type: DESKTOP_ACTIONS.LEARNING_MEDIA_UNDERSTAND,
      sourceRef: requestedSourceRef,
      mode: "media_inventory",
      tokenBudget: 0,
      maxAssets: 2,
    });

    expect(inventoryOnly.mediaUnderstanding).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        status: "media_inventory_recorded",
        artifactId: "learning-artifact-legacy-inventory-only",
        remainingUnunderstoodMediaCount: 2,
      }),
    });
    expect(inventoryOnly.commandResult.stdout).not.toContain("not_found");
    const artifactDocument = JSON.parse(
      readFileSync(
        join(workspaceRoot, ".hotflow", "conversation-runtime", "learning-artifacts.json"),
        "utf8",
      ),
    );
    expect(artifactDocument.artifacts[0].mediaEvidenceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceRef: `${requestedSourceRef}#media-image-1`,
          metadata: expect.objectContaining({
            origin: "desktop.media_inventory.count_only",
          }),
        }),
        expect.objectContaining({
          sourceRef: `${requestedSourceRef}#media-video-1`,
          metadata: expect.objectContaining({
            origin: "desktop.media_inventory.count_only",
          }),
        }),
      ]),
    );
  });

  it("lets the model inspect a specific approved Skill before answering desktop chat", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-skill-view-tool-"));
    tempRoots.push(workspaceRoot);
    writeRichSkillSnapshotFixture(workspaceRoot);
    const calls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          calls.push({ url, method: init.method, body });
          const hasSkillView = body.messages?.some(
            (message) =>
              message.role === "tool" &&
              String(message.content).includes("Read approved skills as a complete library"),
          );
          if (!hasSkillView) {
            return jsonResponse({
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      {
                        id: "call-skill-view-1",
                        type: "function",
                        function: {
                          name: "director.skills.view",
                          arguments: JSON.stringify({
                            skillId: "skill.backend-snapshot",
                            reason: "需要读取 Skill 全文再回答。",
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            });
          }
          expect(body.messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                role: "assistant",
                tool_calls: [
                  expect.objectContaining({
                    id: "call-skill-view-1",
                    function: expect.objectContaining({ name: "director.skills.view" }),
                  }),
                ],
              }),
              expect.objectContaining({
                role: "tool",
                tool_call_id: "call-skill-view-1",
                content: expect.stringContaining("skill.backend-snapshot"),
              }),
            ]),
          );
          return jsonResponse({
            choices: [
              {
                message: {
                  content:
                    "我看过这个 Skill 了：它要求读取已批准 Skill 的完整库，并保留内容、标签、工具和来源统计。",
                },
              },
            ],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-skill-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "你有没有 backend snapshot 相关 Skill？先看一下再回答",
      surface: "workbench",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.body?.tools?.map((tool) => tool.function?.name)).toEqual(
      expect.arrayContaining(["director.skills.list", "director.skills.view"]),
    );
    expect(result.conversationRuntime.finalText).toContain("我看过这个 Skill");
    expect(
      JSON.parse(
        readFileSync(resolveSkillUsagePath({ dataDir: join(workspaceRoot, ".hotflow") }), "utf8"),
      ).records["skill.backend-snapshot"],
    ).toMatchObject({
      viewCount: 1,
    });
    expect(result.runtimeOperatorTrace.items.map((item) => item.stage)).toContain("tool.requested");
    expect(JSON.stringify(result)).not.toContain("sk-skill-secret");
  });

  it("refuses model-only execution for skills that disable model invocation", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-skill-disable-model-"));
    tempRoots.push(workspaceRoot);
    const skillsDir = join(workspaceRoot, ".hotflow", "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(
      join(skillsDir, "approved-skills.json"),
      JSON.stringify(
        {
          schemaVersion: "skills.approved.v2",
          version: 1,
          updatedAtMs: 1,
          appliedAtMs: 1,
          appliedFromProposalId: null,
          changeKind: "manual",
          previousVersion: null,
          restoredFromVersion: null,
          skills: [
            {
              id: "skill.operator-only-browser",
              version: "1.0.0",
              title: "Operator Only Browser Skill",
              content: "Privileged browser workflow. Only an operator may run this directly.",
              description: "Operator-only browser workflow.",
              tags: ["browser", "operator"],
              metadata: {
                disableModelInvocation: true,
              },
              updatedAtMs: 1,
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    let providerTurn = 0;
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (_url, init) => {
          providerTurn += 1;
          const body = JSON.parse(String(init.body));
          if (providerTurn === 1) {
            return jsonResponse({
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      {
                        id: "call-skill-view-operator-only",
                        type: "function",
                        function: {
                          name: "director.skills.view",
                          arguments: JSON.stringify({
                            skillId: "skill.operator-only-browser",
                            reason: "用户要求使用浏览器 Skill。",
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            });
          }
          expect(body.messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                role: "tool",
                tool_call_id: "call-skill-view-operator-only",
                content: expect.stringContaining("status: model_invocation_disabled"),
              }),
            ]),
          );
          return jsonResponse({
            choices: [
              {
                message: {
                  content:
                    "这个 Skill 当前不能由模型直接调用，需要在 Skills 管理里启用模型调用后再用。",
                },
              },
            ],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-skill-disable-model",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "defaultTextModel",
      value: "gemini-2.5-flash",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
      prompt: "调用 operator only browser skill",
      providerId: "memefast-api",
      model: "gemini-2.5-flash",
      sourceAction: {
        type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
        prompt: "调用 operator only browser skill",
        surface: "workbench",
        turnIntent: {
          kind: "chat",
          text: "调用 operator only browser skill",
        },
        responsePolicy: "result-first",
      },
    });

    expect(result.conversationRuntime.finalText).toContain("不能由模型直接调用");
    const usagePath = resolveSkillUsagePath({ dataDir: join(workspaceRoot, ".hotflow") });
    expect(existsSync(usagePath) ? readFileSync(usagePath, "utf8") : "").not.toContain(
      "skill.operator-only-browser",
    );
  });

  it("records desktop Host API Skill view calls through the shared view endpoint", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-host-skill-view-tool-"));
    tempRoots.push(workspaceRoot);
    const hostCalls = [];
    const hostApiFetch = vi.fn(async (url, init = {}) => {
      const path = new URL(url).pathname;
      hostCalls.push({
        path,
        method: init.method,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (path === "/v1/skills/skill.backend-snapshot/view") {
        return jsonResponse({
          schemaId: "director.host.skill-view.v1",
          status: "viewed",
          skill: {
            id: "skill.backend-snapshot",
            title: "Backend Skills Snapshot",
            content:
              "Read approved skills as a complete library. Preserve content, metadata, tags, tools, and source counts for detail panes.",
            tags: ["backend", "snapshot"],
            toolNames: ["rg"],
            enabled: true,
            enablementStatus: "enabled",
            usage: {
              skillId: "skill.backend-snapshot",
              viewCount: 1,
              useCount: 0,
            },
          },
          usage: {
            skillId: "skill.backend-snapshot",
            viewCount: 1,
            useCount: 0,
          },
        });
      }
      throw new Error(`unexpected Host API path ${path}`);
    });
    let providerTurn = 0;
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        hostApiUrl: "http://127.0.0.1:3201",
        hostApiFetch,
        apiProviderFetch: async (_url, init) => {
          const body = JSON.parse(String(init.body));
          providerTurn += 1;
          if (providerTurn === 1) {
            return jsonResponse({
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      {
                        id: "call-host-skill-view-1",
                        type: "function",
                        function: {
                          name: "director.skills.view",
                          arguments: JSON.stringify({
                            skillId: "skill.backend-snapshot",
                            reason: "需要通过 Host API 读取 Skill 全文。",
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            });
          }
          expect(body.messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                role: "tool",
                tool_call_id: "call-host-skill-view-1",
                content: expect.stringContaining("usage: view=1"),
              }),
            ]),
          );
          return jsonResponse({
            choices: [
              {
                message: {
                  content: "Host API Skill view 已记录，我已读取完整 Skill。",
                },
              },
            ],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-host-skill-view-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "通过 Host API 看一下 backend snapshot Skill",
      surface: "workbench",
    });

    expect(result.conversationRuntime.finalText).toContain("Host API Skill view 已记录");
    expect(hostCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/v1/skills/skill.backend-snapshot/view",
          method: "POST",
          body: expect.objectContaining({
            actor: "desktop-conversation-runtime",
            reason: "需要通过 Host API 读取 Skill 全文。",
          }),
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("sk-host-skill-view-secret");
  });

  it("lets the model apply an approved Skill as a separate use step", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-skill-use-tool-"));
    tempRoots.push(workspaceRoot);
    writeRichSkillSnapshotFixture(workspaceRoot);
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (_url, init) => {
          const body = JSON.parse(String(init.body));
          const hasSkillUse = body.messages?.some(
            (message) =>
              message.role === "tool" &&
              String(message.content).includes("skill_instructions") &&
              String(message.content).includes("Read approved skills as a complete library"),
          );
          if (!hasSkillUse) {
            return jsonResponse({
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      {
                        id: "call-skill-use-1",
                        type: "function",
                        function: {
                          name: "director.skills.use",
                          arguments: JSON.stringify({
                            skillId: "skill.backend-snapshot",
                            objective: "解释 Skill 库如何被后续任务使用",
                            reason: "用户要求按这个 Skill 回答。",
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            });
          }
          return jsonResponse({
            choices: [
              {
                message: {
                  content:
                    "已按 Backend Skills Snapshot 的规则回答：后续任务会读取完整 Skill 库并保留元数据。",
                },
              },
            ],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-skill-use-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "用 backend snapshot 这个 Skill 回答一下",
      surface: "workbench",
    });

    expect(result.conversationRuntime.finalText).toContain("已按 Backend Skills Snapshot");
    expect(
      JSON.parse(
        readFileSync(resolveSkillUsagePath({ dataDir: join(workspaceRoot, ".hotflow") }), "utf8"),
      ).records["skill.backend-snapshot"],
    ).toMatchObject({
      useCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain("sk-skill-use-secret");
  });

  it("does not let stale desktop Skill calls use a removed approved Skill", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-skill-missing-tool-"));
    tempRoots.push(workspaceRoot);
    const skillsDir = join(workspaceRoot, ".hotflow", "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(
      join(skillsDir, "approved-skills.json"),
      JSON.stringify({
        schemaVersion: "skills.approved.v2",
        version: 1,
        updatedAtMs: 1,
        appliedAtMs: 1,
        appliedFromProposalId: null,
        changeKind: "manual",
        previousVersion: null,
        restoredFromVersion: null,
        skills: [],
      }),
      "utf8",
    );
    let providerTurn = 0;
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (_url, init) => {
          providerTurn += 1;
          const body = JSON.parse(String(init.body));
          if (providerTurn === 1) {
            return jsonResponse({
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      {
                        id: "call-skill-missing-1",
                        type: "function",
                        function: {
                          name: "director.skills.use",
                          arguments: JSON.stringify({
                            skillId: "skill.removed-twitter",
                            objective: "学习最新 X/Twitter Seedance 经验",
                            reason: "旧上下文误以为这个 Skill 还存在。",
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            });
          }
          expect(body.messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                role: "tool",
                tool_call_id: "call-skill-missing-1",
                content: expect.stringContaining("explanation_status: missing-skill"),
              }),
            ]),
          );
          return jsonResponse({
            choices: [
              {
                message: {
                  content:
                    "这个 Skill 已不在当前批准库里，我会先刷新 Skill 索引，不会假装已经应用。",
                },
              },
            ],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-skill-missing-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "defaultTextModel",
      value: "gemini-2.5-flash",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
      prompt: "用已经删掉的 twitter skill 回答一下",
      providerId: "memefast-api",
      model: "gemini-2.5-flash",
      sourceAction: {
        type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
        prompt: "用已经删掉的 twitter skill 回答一下",
        surface: "workbench",
        turnIntent: {
          kind: "chat",
          text: "用已经删掉的 twitter skill 回答一下",
        },
        responsePolicy: "result-first",
      },
    });

    expect(result.conversationRuntime.finalText).toContain("已不在当前批准库");
    const usagePath = resolveSkillUsagePath({ dataDir: join(workspaceRoot, ".hotflow") });
    expect(existsSync(usagePath) ? readFileSync(usagePath, "utf8") : "").not.toContain(
      "skill.removed-twitter",
    );
    expect(JSON.stringify(result)).not.toContain("sk-skill-missing-secret");
  });

  it("lets the model request approved Skill enablement during desktop chat", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-skill-enable-tool-"));
    tempRoots.push(workspaceRoot);
    writeRichSkillSnapshotFixture(workspaceRoot);
    new SkillManagementStore(
      resolveSkillManagementPath({ dataDir: join(workspaceRoot, ".hotflow") }),
    ).setSkillEnabled("skill.backend-snapshot", false, {
      actor: "test",
      note: "start disabled so the conversation can enable it",
      nowMs: 1,
    });
    const calls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          calls.push({ url, method: init.method, body });
          const hasEnablementResult = body.messages?.some(
            (message) =>
              message.role === "tool" && String(message.content).includes("Skill 已开启"),
          );
          if (!hasEnablementResult) {
            return jsonResponse({
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      {
                        id: "call-skill-enable-1",
                        type: "function",
                        function: {
                          name: "director.skills.set_enabled",
                          arguments: JSON.stringify({
                            skillId: "skill.backend-snapshot",
                            enabled: true,
                            reason: "用户要求启用 backend snapshot Skill。",
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            });
          }
          return jsonResponse({
            choices: [
              {
                message: {
                  content: "已开启 Backend Skills Snapshot，下一轮任务会把它纳入可召回 Skill。",
                },
              },
            ],
          });
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-skill-enable",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "把 backend snapshot 这个 Skill 启用起来",
      surface: "workbench",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.body?.tools?.map((tool) => tool.function?.name)).toEqual(
      expect.arrayContaining(["director.skills.list", "director.skills.set_enabled"]),
    );
    expect(result.conversationRuntime.finalText).toContain("已开启 Backend Skills Snapshot");
    const management = JSON.parse(
      readFileSync(
        resolveSkillManagementPath({ dataDir: join(workspaceRoot, ".hotflow") }),
        "utf8",
      ),
    );
    expect(management.disabledSkillIds).not.toContain("skill.backend-snapshot");
    expect(result.runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.tool",
          payload: expect.objectContaining({
            tool: expect.objectContaining({
              name: "director.skills.set_enabled",
              phase: "completed",
            }),
          }),
        }),
      ]),
    );
  });

  it("runs image requests through the configured API provider image endpoint", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-api-provider-image-"));
    tempRoots.push(workspaceRoot);
    const calls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          calls.push({
            url,
            method: init.method,
            authorization: init.headers.Authorization,
            body: JSON.parse(String(init.body)),
          });
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({
                data: [{ url: "https://cdn.example.test/director-angel.png" }],
              }),
          };
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-first-secret\nsk-second-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "生成图片：Director Angel 桌面工作台",
      surface: "workbench",
    });

    expect(calls).toEqual([
      {
        url: "https://proxy.example.test/v1/images/generations",
        method: "POST",
        authorization: "Bearer sk-first-secret",
        body: expect.objectContaining({
          model: "gpt-image-2",
          prompt: "Director Angel 桌面工作台",
          n: 1,
          size: "2048x2048",
        }),
      },
    ]);
    expect(result.apiProviderImage).toMatchObject({
      providerId: "memefast-api",
      model: "gpt-image-2",
      ok: true,
      output: "https://cdn.example.test/director-angel.png",
      images: [{ url: "https://cdn.example.test/director-angel.png" }],
    });
    expect(result.events.map((event) => event.title)).toEqual(["图片生成完成"]);
    expect(JSON.stringify(result)).not.toContain("sk-first-secret");
    expect(JSON.stringify(result)).not.toContain("sk-second-secret");
  });

  it("configures, tests, and runs ComfyUI as a real external media tool", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-comfyui-"));
    tempRoots.push(workspaceRoot);
    const workflowPath = join(workspaceRoot, "workflow.json");
    const outputDir = join(workspaceRoot, "comfyui-output");
    const calls = [];
    const desktopEvents = [];

    writeFileSync(
      workflowPath,
      JSON.stringify({
        6: {
          class_type: "CLIPTextEncode",
          inputs: { text: "old" },
        },
        9: {
          class_type: "SaveImage",
          inputs: { filename_prefix: "Angel" },
        },
      }),
      "utf8",
    );

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        emitDesktopEvent: (event) => {
          desktopEvents.push(event);
        },
        apiProviderFetch: async (url, init) => {
          calls.push({
            url,
            method: init.method,
            apiKey: init.headers["X-API-Key"],
            body: init.body ? JSON.parse(String(init.body)) : null,
          });
          if (url.endsWith("/system_stats")) {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () => JSON.stringify({ system: { os: "macOS" } }),
            };
          }
          if (url.endsWith("/prompt")) {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () => JSON.stringify({ prompt_id: "prompt-1" }),
            };
          }
          if (url.endsWith("/history/prompt-1")) {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () =>
                JSON.stringify({
                  "prompt-1": {
                    outputs: {
                      9: {
                        images: [{ filename: "angel.png", subfolder: "", type: "output" }],
                      },
                    },
                  },
                }),
            };
          }
          if (url.includes("/view?")) {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () => "image-bytes",
              arrayBuffer: async () => new TextEncoder().encode("image-bytes").buffer,
            };
          }
          throw new Error(`unexpected ComfyUI URL ${url}`);
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMFYUI_SET,
      key: "enabled",
      value: true,
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMFYUI_SET,
      key: "defaultWorkflowPath",
      value: workflowPath,
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMFYUI_SET,
      key: "outputDir",
      value: outputDir,
    });
    const tested = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMFYUI_TEST,
    });
    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/comfyui 一只小猫在公园旅行，电影感",
      surface: "workbench",
    });

    expect(tested.comfyUiTest).toMatchObject({
      ok: true,
      endpoint: "http://127.0.0.1:8188/system_stats",
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "http://127.0.0.1:8188/prompt",
          method: "POST",
          body: expect.objectContaining({
            prompt: expect.objectContaining({
              6: expect.objectContaining({
                inputs: expect.objectContaining({ text: "一只小猫在公园旅行，电影感" }),
              }),
            }),
          }),
        }),
      ]),
    );
    expect(result.comfyUiRun).toMatchObject({
      ok: true,
      promptId: "prompt-1",
      artifactCount: 1,
      artifacts: [expect.objectContaining({ filename: "angel.png" })],
    });
    expect(result.externalToolInvocation).toMatchObject({
      toolId: "comfyui",
      operationId: "run_workflow",
      status: "success",
      ok: true,
      trace: expect.arrayContaining([
        expect.objectContaining({ stage: "tool.resolved" }),
        expect.objectContaining({ stage: "tool.completed" }),
      ]),
    });
    expect(result.externalToolExecution).toMatchObject({
      toolId: "comfyui",
      operationId: "run_workflow",
      status: "completed",
      result: expect.objectContaining({
        status: "success",
        ok: true,
      }),
      timeline: [
        expect.objectContaining({ status: "queued" }),
        expect.objectContaining({ status: "executing" }),
        expect.objectContaining({ status: "completed" }),
      ],
    });
    expect(desktopEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "external-tool.timeline",
          stream: true,
          externalToolExecution: expect.objectContaining({
            toolId: "comfyui",
            operationId: "run_workflow",
          }),
          externalToolTimelineEntry: expect.objectContaining({ status: "queued" }),
        }),
        expect.objectContaining({
          type: "external-tool.timeline",
          externalToolTimelineEntry: expect.objectContaining({ status: "executing" }),
        }),
        expect.objectContaining({
          type: "external-tool.timeline",
          externalToolTimelineEntry: expect.objectContaining({ status: "completed" }),
        }),
      ]),
    );
    expect(result.snapshot.assets.tools.externalToolBus).toMatchObject({
      executionCount: 1,
      activeExecutionCount: 0,
      completedExecutionCount: 1,
      latestExecution: expect.objectContaining({
        toolId: "comfyui",
        operationId: "run_workflow",
        status: "completed",
        artifactCount: 1,
        timeline: [
          expect.objectContaining({ status: "queued" }),
          expect.objectContaining({ status: "executing" }),
          expect.objectContaining({ status: "completed" }),
        ],
      }),
      history: [
        expect.objectContaining({
          toolId: "comfyui",
          operationId: "run_workflow",
          status: "completed",
        }),
      ],
    });
    expect(result.snapshot.assets.settings.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "comfyui:defaultWorkflowPath",
          value: workflowPath,
        }),
      ]),
    );
    expect(result.snapshot.assets.tools.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "comfyui-media",
          provider: "comfyui",
          realExecutionEligible: true,
        }),
      ]),
    );
    expect(result.snapshot.assets.tools.externalToolBus).toMatchObject({
      catalogCount: expect.any(Number),
      effectiveCount: expect.any(Number),
      items: expect.arrayContaining([
        expect.objectContaining({
          id: "comfyui",
          kind: "provider",
          source: "external",
          status: "ready",
          canInvoke: true,
          doctor: expect.objectContaining({
            summary: expect.stringContaining("workflow schema"),
          }),
        }),
      ]),
    });
    const comfyUiBusItem = result.snapshot.assets.tools.externalToolBus.items.find(
      (item) => item.id === "comfyui",
    );
    expect(comfyUiBusItem?.doctor).toMatchObject({
      details: expect.objectContaining({
        workflow: expect.objectContaining({
          summary: expect.objectContaining({
            parameterCount: expect.any(Number),
            promptNodeCount: 1,
            missingNodeCount: 0,
            missingModelCount: 0,
          }),
        }),
      }),
    });
    expect(readFileSync(join(outputDir, "prompt-1-angel.png"), "utf8")).toBe("image-bytes");
  });

  it("exposes ComfyUI lifecycle and dependency fix through the external tool bus", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-comfyui-lifecycle-"));
    tempRoots.push(workspaceRoot);
    const workflowPath = join(workspaceRoot, "workflow.json");

    writeFileSync(
      workflowPath,
      JSON.stringify({
        8: {
          class_type: "FaceDetailer",
          inputs: {},
        },
      }),
      "utf8",
    );

    const commandCalls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        comfyUiCommandExists: (command) => command === "comfy",
        comfyUiCommandRunner: async (command, args) => {
          commandCalls.push({ command, args });
          return { exitCode: 0, stdout: "ok", stderr: "" };
        },
        apiProviderFetch: async (url) => {
          if (url.endsWith("/system_stats")) {
            return jsonResponse({ system: { os: "macOS" } });
          }
          if (url.endsWith("/object_info")) {
            return jsonResponse({});
          }
          if (url.endsWith("/models/checkpoints")) {
            return jsonResponse([]);
          }
          if (url.endsWith("/queue")) {
            return jsonResponse({ queue_running: [], queue_pending: [] });
          }
          throw new Error(`unexpected ComfyUI URL ${url}`);
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMFYUI_SET,
      key: "enabled",
      value: true,
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMFYUI_SET,
      key: "defaultWorkflowPath",
      value: workflowPath,
    });
    const lifecycle = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/comfyui 重启",
      surface: "workbench",
    });
    const deps = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/comfyui 修复依赖",
      surface: "workbench",
    });

    expect(lifecycle.comfyUiLifecycle).toMatchObject({
      ok: true,
      action: "restart",
      executed: true,
      plan: expect.arrayContaining([
        expect.objectContaining({ command: "comfy", args: ["stop"] }),
        expect.objectContaining({
          command: "comfy",
          args: ["launch", "--background", "--", "--port", "8188"],
        }),
      ]),
    });
    expect(deps.comfyUiDependencyFix).toMatchObject({
      status: "planned",
      dryRun: true,
      needsServerRestart: true,
      actions: [
        expect.objectContaining({
          kind: "node",
          packageName: "comfyui-impact-pack",
        }),
      ],
    });
    const comfyItem = deps.snapshot.assets.tools.externalToolBus.items.find(
      (item) => item.id === "comfyui",
    );
    expect(comfyItem.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "lifecycle", requiresApproval: true }),
        expect.objectContaining({ id: "fix_dependencies", requiresApproval: true }),
      ]),
    );
    expect(commandCalls).toEqual([
      { command: "comfy", args: ["stop"] },
      { command: "comfy", args: ["launch", "--background", "--", "--port", "8188"] },
    ]);
  });

  it("executes real ComfyUI lifecycle commands through the Agent OS sandbox-owned runner", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-comfyui-sandbox-runner-"));
    tempRoots.push(workspaceRoot);
    const runnerCalls = [];
    const rawCalls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        comfyUiCommandExists: (command) => command === "comfy",
        comfyUiCommandRunner: async (command, args) => {
          rawCalls.push({ command, args });
          return { exitCode: 0, stdout: "raw fallback", stderr: "" };
        },
        agentOsSandboxCommandRunner: async (request) => {
          runnerCalls.push(request);
          return { exitCode: 0, stdout: "sandbox ok", stderr: "" };
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMFYUI_SET,
      key: "enabled",
      value: true,
    });
    const lifecycle = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/comfyui 停止",
      surface: "workbench",
    });

    expect(lifecycle.comfyUiLifecycle).toMatchObject({
      ok: true,
      action: "stop",
      executed: true,
      results: [
        expect.objectContaining({
          command: "comfy",
          args: ["stop"],
          stdout: "sandbox ok",
          sandbox: expect.objectContaining({
            ok: true,
            status: "completed",
            backend: "host",
            evidence: expect.objectContaining({
              planHash: expect.any(String),
              commandHash: expect.any(String),
              backendConfig: expect.objectContaining({
                commandPattern: {
                  executable: "comfy",
                  argv: ["stop"],
                  operationId: "lifecycle",
                },
              }),
            }),
          }),
        }),
      ],
    });
    expect(lifecycle.snapshot.assets.tools.externalToolBus.processCapabilityLedger).toMatchObject({
      totalEntries: 1,
      riskyHostEntries: 1,
      entries: [
        expect.objectContaining({
          owner: "director-desktop",
          runnerKind: "comfyui-cli",
          backend: "host",
          status: "completed",
          commandPattern: {
            executable: "comfy",
            argv: ["stop"],
            operationId: "lifecycle",
          },
        }),
      ],
    });
    expect(rawCalls).toEqual([]);
    expect(runnerCalls).toEqual([
      expect.objectContaining({
        backend: "host",
        executable: "comfy",
        argv: ["stop"],
        cwd: join(workspaceRoot, ".director-angel"),
      }),
    ]);
    expect(lifecycle.externalToolInvocation.metadata).toMatchObject({
      agentOsSandboxBackendAdmission: expect.objectContaining({
        backend: "workspace-write",
      }),
    });
  });

  it("keeps external tool last-known-good state across desktop snapshots", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-external-tool-lkg-"));
    tempRoots.push(workspaceRoot);
    const fetchCalls = [];
    let reachable = true;

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url) => {
          fetchCalls.push(url);
          if (!reachable) {
            throw new Error("ComfyUI offline");
          }
          if (url.endsWith("/system_stats")) {
            return jsonResponse({ system: { os: "macOS" } });
          }
          if (url.endsWith("/object_info")) {
            return jsonResponse({});
          }
          if (url.endsWith("/models/checkpoints")) {
            return jsonResponse([]);
          }
          if (url.endsWith("/queue")) {
            return jsonResponse({ queue_running: [], queue_pending: [] });
          }
          throw new Error(`unexpected ComfyUI URL ${url}`);
        },
      }),
    });

    await bridge.invoke({ type: DESKTOP_ACTIONS.COMFYUI_SET, key: "enabled", value: true });
    const ready = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    const readyComfy = ready.snapshot.assets.tools.externalToolBus.items.find(
      (item) => item.id === "comfyui",
    );
    expect(readyComfy).toMatchObject({
      status: "ready",
      canInvoke: true,
      lastKnownGood: expect.objectContaining({
        status: "ready",
        summary: expect.stringContaining("ComfyUI"),
      }),
    });

    reachable = false;
    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMFYUI_SET,
      key: "baseUrl",
      value: "http://127.0.0.1:8199",
    });
    const degraded = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    const degradedComfy = degraded.snapshot.assets.tools.externalToolBus.items.find(
      (item) => item.id === "comfyui",
    );

    expect(degradedComfy).toMatchObject({
      status: expect.not.stringMatching(/^ready$/u),
      canInvoke: false,
      lastKnownGood: expect.objectContaining({
        status: "ready",
        summary: expect.stringContaining("ComfyUI"),
      }),
      doctor: expect.objectContaining({
        details: expect.any(Object),
      }),
    });
    expect(fetchCalls.length).toBeGreaterThan(0);
  });

  it("labels ComfyUI workflows without prompt nodes as connectivity checks", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-comfyui-smoke-"));
    tempRoots.push(workspaceRoot);
    const workflowPath = join(workspaceRoot, "workflow.json");
    const outputDir = join(workspaceRoot, "comfyui-output");

    writeFileSync(
      workflowPath,
      JSON.stringify({
        1: {
          class_type: "EmptyImage",
          inputs: { width: 512, height: 512, batch_size: 1, color: 3447003 },
        },
        2: {
          class_type: "SaveImage",
          inputs: { images: ["1", 0], filename_prefix: "DirectorAngel_ComfyUI_Smoke" },
        },
      }),
      "utf8",
    );

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url) => {
          if (url.endsWith("/prompt")) {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () => JSON.stringify({ prompt_id: "prompt-smoke" }),
            };
          }
          if (url.endsWith("/history/prompt-smoke")) {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () =>
                JSON.stringify({
                  "prompt-smoke": {
                    outputs: {
                      2: {
                        images: [
                          {
                            filename: "DirectorAngel_ComfyUI_Smoke_00001_.png",
                            subfolder: "",
                            type: "output",
                          },
                        ],
                      },
                    },
                  },
                }),
            };
          }
          if (url.includes("/view?")) {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () => "smoke-image-bytes",
              arrayBuffer: async () => new TextEncoder().encode("smoke-image-bytes").buffer,
            };
          }
          throw new Error(`unexpected ComfyUI URL ${url}`);
        },
      }),
    });

    await bridge.invoke({ type: DESKTOP_ACTIONS.COMFYUI_SET, key: "enabled", value: true });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMFYUI_SET,
      key: "defaultWorkflowPath",
      value: workflowPath,
    });
    await bridge.invoke({ type: DESKTOP_ACTIONS.COMFYUI_SET, key: "outputDir", value: outputDir });
    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/comfyui 一只小猫在公园旅行，电影感",
      surface: "workbench",
    });

    expect(result.comfyUiRun).toMatchObject({
      ok: true,
      promptApplied: false,
      artifactCount: 1,
      message: expect.stringContaining("连通性验证"),
    });
    expect(result.events).toEqual([
      expect.objectContaining({
        title: "ComfyUI 连通性验证完成",
        body: expect.stringContaining("不代表 AI 文生图"),
      }),
    ]);
  });

  it("resolves default ComfyUI command availability by scanning PATH without shell command syntax", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-command-exists-path-"));
    tempRoots.push(workspaceRoot);
    const binDir = join(workspaceRoot, "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, "uvx"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const previousPath = process.env.PATH;

    try {
      process.env.PATH = binDir;

      expect(commandExistsOnPath("uvx")).toBe(true);
      expect(commandExistsOnPath("uvx; echo shell-bypass")).toBe(false);
      expect(commandExistsOnPath("../uvx")).toBe(false);
    } finally {
      if (previousPath === undefined) {
        Reflect.deleteProperty(process.env, "PATH");
      } else {
        process.env.PATH = previousPath;
      }
    }
  });

  it("opens external URLs through the Agent OS sandbox-owned desktop opener", async () => {
    const runnerCalls = [];
    const openExternalUrl = createDesktopOpenExternalUrlSandboxRunner({
      executable: "electron-shell",
      createArgv: (url) => ["openExternal", url],
      commandRunner: async (request) => {
        runnerCalls.push(request);
        return { exitCode: 0, stdout: "opened", stderr: "" };
      },
      now: () => "2026-05-08T08:00:00.000Z",
    });

    const execution = await openExternalUrl("https://example.test/docs?from=desktop");

    expect(execution).toMatchObject({
      ok: true,
      status: "completed",
      backend: "host",
      evidence: expect.objectContaining({
        planHash: expect.any(String),
        commandHash: expect.any(String),
        backendConfig: expect.objectContaining({
          commandPattern: {
            executable: "electron-shell",
            argv: ["openExternal", "https://example.test/docs?from=desktop"],
            operationId: "open:https://example.test/docs",
          },
        }),
      }),
    });
    expect(execution.evidence.backendConfig.commandPrefix).toBeUndefined();
    expect(runnerCalls).toEqual([
      expect.objectContaining({
        backend: "host",
        executable: "electron-shell",
        argv: ["openExternal", "https://example.test/docs?from=desktop"],
      }),
    ]);
  });

  it("blocks non-http external URL schemes before reaching the desktop opener backend", async () => {
    const runnerCalls = [];
    const openExternalUrl = createDesktopOpenExternalUrlSandboxRunner({
      executable: "electron-shell",
      createArgv: (url) => ["openExternal", url],
      commandRunner: async (request) => {
        runnerCalls.push(request);
        return { exitCode: 0, stdout: "opened", stderr: "" };
      },
    });

    await expect(openExternalUrl("file:///etc/passwd")).rejects.toThrow(/http\(s\) URLs/u);
    expect(runnerCalls).toEqual([]);
  });

  it("blocks Moyin and bare Electron launches in desktop host runners", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-process-guard-"));
    tempRoots.push(workspaceRoot);
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMFYUI_SET,
      key: "enabled",
      value: true,
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMFYUI_SET,
      key: "localInstallPath",
      value: "/Users/example/Apps/moyin-creator/node_modules/electron/dist/Electron.app/Contents/MacOS",
    });
    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMFYUI_SET,
      key: "baseUrl",
      value: "http://127.0.0.1:8188",
    });
    const run = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMFYUI_LIFECYCLE,
      action: "start",
    });

    expect(run.comfyUiLifecycle).toMatchObject({
      executed: true,
      results: [
        expect.objectContaining({
          exitCode: 126,
          stderr: expect.stringContaining("blocked"),
        }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain("default_app.asar");
  });

  it("uses the Agent OS sandbox-owned opener when desktop handlers do not inject one", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-default-open-sandbox-"));
    tempRoots.push(workspaceRoot);
    const runnerCalls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        agentOsSandboxCommandRunner: async (request) => {
          runnerCalls.push(request);
          return { exitCode: 0, stdout: "opened", stderr: "" };
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMFYUI_SET,
      key: "baseUrl",
      value: "http://127.0.0.1:8188/",
    });
    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/comfyui 打开界面",
      surface: "workbench",
    });

    expect(result.comfyUiOpen).toMatchObject({
      ok: true,
      url: "http://127.0.0.1:8188",
    });
    expect(runnerCalls).toEqual([
      expect.objectContaining({
        backend: "host",
        argv: expect.arrayContaining(["http://127.0.0.1:8188/"]),
      }),
    ]);
  });

  it("opens the configured ComfyUI interface without submitting a workflow", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-comfyui-open-"));
    tempRoots.push(workspaceRoot);
    const openedUrls = [];
    const fetchCalls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openExternalUrl: async (url) => {
          openedUrls.push(url);
        },
        apiProviderFetch: async (url) => {
          fetchCalls.push(url);
          throw new Error("opening the ComfyUI UI must not call the ComfyUI API");
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.COMFYUI_SET,
      key: "baseUrl",
      value: "http://127.0.0.1:8188/",
    });
    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/comfyui 打开界面",
      surface: "workbench",
    });

    expect(fetchCalls).toEqual([]);
    expect(openedUrls).toEqual(["http://127.0.0.1:8188"]);
    expect(result.comfyUiOpen).toMatchObject({
      ok: true,
      url: "http://127.0.0.1:8188",
    });
    expect(result.events).toEqual([
      expect.objectContaining({
        title: "ComfyUI 界面已打开",
        actionType: DESKTOP_ACTIONS.COMFYUI_OPEN,
      }),
    ]);
  });

  it("creates a visible ComfyUI script workflow without submitting the workflow", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-comfyui-workflow-"));
    tempRoots.push(workspaceRoot);
    const fetchCalls = [];
    const openedUrls = [];
    const modelOutput = [
      "脚本草案（30秒）",
      "场景数：3",
      "场景 1：小猪第一次来到泳池边，先观察朋友示范。",
      "场景 2：小猪扶着浮板下水，学会用短句给自己打气。",
      "场景 3：小猪完成一次短距离漂浮，和朋友击掌。",
      "ComfyUI 参数：review_required=true",
    ].join("\n");

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openExternalUrl: async (url) => {
          openedUrls.push(url);
        },
        apiProviderFetch: async (url, init) => {
          const body = init.body ? JSON.parse(String(init.body)) : null;
          fetchCalls.push({
            url,
            method: init.method,
            body,
          });
          if (url === "https://proxy.example.test/v1/chat/completions") {
            return fakeApiProviderTextResponse(modelOutput);
          }
          if (url.endsWith("/prompt")) {
            throw new Error("creating a workflow draft must not submit ComfyUI /prompt");
          }
          if (url.includes("/userdata/")) {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () =>
                JSON.stringify({
                  path: "workflows/DirectorAngel/comfyui-script-1777300000000-draft.json",
                  size: 4096,
                  modified: 1_777_300_000_000,
                }),
            };
          }
          throw new Error(`unexpected ComfyUI URL ${url}`);
        },
      }),
    });

    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/ComfyUI 脚本 一个小猪学习游泳的30秒故事",
      surface: "workbench",
      now: 1_777_300_000_000,
    });

    expect(openedUrls).toEqual(["http://127.0.0.1:8188"]);
    expect(result.comfyUiWorkflow).toMatchObject({
      ok: true,
      workflowKind: "script",
      objective: "一个小猪学习游泳的30秒故事",
      executable: false,
      opened: true,
      url: "http://127.0.0.1:8188",
      uploadedToComfyUi: true,
      comfyUiPath: expect.stringMatching(
        /^workflows\/DirectorAngel\/comfyui-script-\d+-[a-z0-9-]+\.json$/u,
      ),
      angelSource: "api-provider",
      status: "draft",
    });
    const providerCalls = fetchCalls.filter((call) =>
      call.url.startsWith("https://proxy.example.test"),
    );
    const comfyUiCalls = fetchCalls.filter((call) => call.url.includes("/userdata/"));
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0].body.messages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("一个小猪学习游泳的30秒故事"),
    });
    expect(comfyUiCalls).toHaveLength(1);
    expect(comfyUiCalls[0]).toMatchObject({
      url: expect.stringMatching(
        /^http:\/\/127\.0\.0\.1:8188\/userdata\/workflows%2FDirectorAngel%2Fcomfyui-script-\d+-[a-z0-9-]+\.json\?overwrite=true&full_info=true$/u,
      ),
      method: "POST",
      body: expect.objectContaining({
        version: 0.4,
        nodes: expect.arrayContaining([
          expect.objectContaining({
            type: "PrimitiveStringMultiline",
            widgets_values: [expect.stringContaining("脚本草案（30秒）")],
          }),
        ]),
        extra: expect.objectContaining({
          directorAngel: expect.objectContaining({
            kind: "script",
            objective: "一个小猪学习游泳的30秒故事",
            executable: false,
            angelSource: "api-provider",
          }),
        }),
      }),
    });
    expect(fetchCalls.map((call) => call.url).join("\n")).not.toContain("/prompt");
    expect(existsSync(result.comfyUiWorkflow.path)).toBe(true);
    const draft = JSON.parse(readFileSync(result.comfyUiWorkflow.path, "utf8"));
    expect(draft).toMatchObject({
      schemaVersion: 1,
      kind: "script",
      objective: "一个小猪学习游泳的30秒故事",
      status: "draft",
      executable: false,
      angelOutput: expect.stringContaining("脚本草案（30秒）"),
      angelSource: "api-provider",
    });
    expect(JSON.stringify(draft)).toContain("Angel output review");
    expect(JSON.stringify(draft)).toContain("Angel 生成内容");
    expect(JSON.stringify(draft)).not.toContain("director-angel-local");
    expect(result.events).toEqual([
      expect.objectContaining({
        title: "ComfyUI 工作流已创建",
        actionType: "comfyui.createWorkflow",
        body: expect.stringContaining("下一步：检查节点、模型和输出目录"),
      }),
    ]);
    expect(result.events[0].body).not.toContain("文件：");
  });

  it("creates a visible ComfyUI script image video workflow with real media node branches", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-comfyui-combo-"));
    tempRoots.push(workspaceRoot);
    const fetchCalls = [];
    const modelOutput = [
      "脚本草案（30秒）",
      "场景数：3",
      "场景 1：小猪站在浅水区，朋友递来泳圈。",
      "图片提示词：小猪在浅水区握着泳圈，温暖阳光，儿童绘本质感。",
      "视频提示词：小猪试探迈入水中，镜头轻轻前推，无字幕。",
      "场景 2：小猪扶着浮板练习踢腿。",
      "图片提示词：小猪扶着蓝色浮板踢腿，水花轻盈，电影感。",
      "视频提示词：小猪跟着朋友节奏踢腿，侧向跟拍，无字幕。",
      "场景 3：小猪完成漂浮后露出笑容。",
      "图片提示词：小猪漂浮在水面微笑，朋友在旁鼓掌，柔和光线。",
      "视频提示词：小猪慢慢漂浮向镜头，朋友击掌庆祝，无字幕。",
      "图片负向提示词：低清晰度、畸形、文字错误。",
    ].join("\n");

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openExternalUrl: async () => {},
        apiProviderFetch: async (url, init) => {
          const body = init.body ? JSON.parse(String(init.body)) : null;
          fetchCalls.push({ url, method: init.method, body });
          if (url === "https://proxy.example.test/v1/chat/completions") {
            return fakeApiProviderTextResponse(modelOutput);
          }
          if (url.endsWith("/prompt")) {
            throw new Error("creating a visible workflow must not submit ComfyUI /prompt");
          }
          if (url.includes("/userdata/")) {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () =>
                JSON.stringify({
                  path: "workflows/DirectorAngel/comfyui-script-1777300000000-draft.json",
                  size: 4096,
                  modified: 1_777_300_000_000,
                }),
            };
          }
          throw new Error(`unexpected ComfyUI URL ${url}`);
        },
      }),
    });

    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/ComfyUI 脚本+图片+视频 一个小猪学习游泳的30秒故事",
      surface: "workbench",
      now: 1_777_300_000_000,
    });

    expect(result.comfyUiWorkflow).toMatchObject({
      ok: true,
      workflowKind: "script",
      workflowModes: ["script", "image", "video"],
      objective: "一个小猪学习游泳的30秒故事",
      uploadedToComfyUi: true,
      angelSource: "api-provider",
    });
    const providerCalls = fetchCalls.filter((call) =>
      call.url.startsWith("https://proxy.example.test"),
    );
    const comfyUiCalls = fetchCalls.filter((call) => call.url.includes("/userdata/"));
    expect(providerCalls).toHaveLength(1);
    expect(comfyUiCalls).toHaveLength(1);
    expect(comfyUiCalls[0]).toMatchObject({
      method: "POST",
      body: expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ type: "PreviewAny" }),
          expect.objectContaining({ type: "WanTextToImageApi" }),
          expect.objectContaining({ type: "SaveImage" }),
          expect.objectContaining({ type: "Wan2ImageToVideoApi" }),
          expect.objectContaining({ type: "SaveVideo" }),
          expect.objectContaining({ title: "场景 1 图片提示词" }),
          expect.objectContaining({ title: "场景 2 图片提示词" }),
          expect.objectContaining({ title: "场景 3 图片提示词" }),
        ]),
        extra: expect.objectContaining({
          directorAngel: expect.objectContaining({
            workflowModes: ["script", "image", "video"],
          }),
        }),
      }),
    });
    const visibleNodeTypes = comfyUiCalls[0].body.nodes.map((node) => node.type);
    expect(visibleNodeTypes.filter((type) => type === "WanTextToImageApi")).toHaveLength(3);
    expect(visibleNodeTypes.filter((type) => type === "Wan2ImageToVideoApi")).toHaveLength(3);
    expect(visibleNodeTypes.filter((type) => type === "WanTextToVideoApi")).toHaveLength(0);
    const sceneCountParameter = comfyUiCalls[0].body.extra.directorAngel.toolParameters.find(
      (item) => item.name === "scene_count",
    );
    expect(sceneCountParameter).toMatchObject({ value: 3 });
    const draft = JSON.parse(readFileSync(result.comfyUiWorkflow.path, "utf8"));
    expect(draft).toMatchObject({
      kind: "script",
      workflowModes: ["script", "image", "video"],
      objective: "一个小猪学习游泳的30秒故事",
      angelOutput: expect.stringContaining("场景 1：小猪站在浅水区"),
      angelSource: "api-provider",
    });
    expect(JSON.stringify(draft)).not.toContain("director-angel-local");
  });

  it("returns a degraded ComfyUI workflow result without local script or parameter drafts when no API provider is configured", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-comfyui-no-provider-"));
    tempRoots.push(workspaceRoot);
    const fetchCalls = [];
    const openedUrls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openExternalUrl: async (url) => {
          openedUrls.push(url);
        },
        apiProviderFetch: async (url, init) => {
          fetchCalls.push({ url, method: init?.method });
          throw new Error(`degraded workflow must not call external fetch ${url}`);
        },
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/ComfyUI 脚本 一个没有模型时不应伪造的短剧",
      surface: "workbench",
      now: 1_777_300_000_000,
    });

    expect(openedUrls).toEqual([]);
    expect(fetchCalls).toEqual([]);
    expect(result.comfyUiWorkflow).toMatchObject({
      ok: false,
      workflowKind: "script",
      objective: "一个没有模型时不应伪造的短剧",
      status: "degraded",
      uploadedToComfyUi: false,
      uploadStatus: null,
      path: null,
      comfyUiPath: null,
      angelOutput: "",
      angelSource: "api-provider-unavailable",
      toolParameterCount: 0,
    });
    assertNoComfyUiLocalBusinessDraft(result);
    expect(result.events).toEqual([
      expect.objectContaining({
        title: "ComfyUI 工作流创建失败",
        actionType: "comfyui.createWorkflow",
        body: expect.stringContaining("没有可用的 API Key"),
      }),
    ]);
    expect(result.events[0].body).toContain("未创建业务内容、参数或 ComfyUI workflow");
    expect(result.events[0].body).not.toContain("Angel来源：");
    expect(result.events[0].body).not.toContain("文件：");
  });

  it("returns a degraded ComfyUI workflow result without local script or copywriting drafts when the model call fails", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-comfyui-model-fail-"));
    tempRoots.push(workspaceRoot);
    const fetchCalls = [];
    const openedUrls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openExternalUrl: async (url) => {
          openedUrls.push(url);
        },
        apiProviderFetch: async (url, init) => {
          fetchCalls.push({
            url,
            method: init.method,
            body: init.body ? JSON.parse(String(init.body)) : null,
          });
          if (url === "https://proxy.example.test/v1/chat/completions") {
            return fakeApiProviderTextResponse("", 500);
          }
          throw new Error(`degraded workflow must not upload to ComfyUI ${url}`);
        },
      }),
    });

    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/ComfyUI 文案 给公园咖啡车写一条 30 秒短视频口播",
      surface: "workbench",
      now: 1_777_300_000_000,
    });

    expect(openedUrls).toEqual([]);
    expect(fetchCalls.map((call) => call.url)).toEqual([
      "https://proxy.example.test/v1/chat/completions",
    ]);
    expect(result.comfyUiWorkflow).toMatchObject({
      ok: false,
      workflowKind: "copywriting",
      status: "degraded",
      uploadedToComfyUi: false,
      path: null,
      comfyUiPath: null,
      angelOutput: "",
      angelSource: "api-provider-unavailable",
      toolParameterCount: 0,
    });
    assertNoComfyUiLocalBusinessDraft(result);
  });

  it("reports ComfyUI workflow upload failure as local-only instead of full sync success", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-comfyui-upload-failure-"));
    tempRoots.push(workspaceRoot);
    const openedUrls = [];
    const modelOutput = [
      "脚本草案（30秒）",
      "场景数：3",
      "场景 1：小猪看见泳池。",
      "场景 2：小猪开始练习。",
      "场景 3：小猪学会漂浮。",
    ].join("\n");

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        openExternalUrl: async (url) => {
          openedUrls.push(url);
        },
        apiProviderFetch: async (url, init) => {
          const body = init.body ? JSON.parse(String(init.body)) : null;
          if (url === "https://proxy.example.test/v1/chat/completions") {
            return fakeApiProviderTextResponse(modelOutput);
          }
          if (url.includes("/userdata/")) {
            return {
              ok: false,
              status: 503,
              statusText: "Service Unavailable",
              text: async () => JSON.stringify({ error: "ComfyUI offline" }),
            };
          }
          throw new Error(`unexpected ComfyUI URL ${url} ${JSON.stringify(body)}`);
        },
      }),
    });

    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/ComfyUI 脚本 一个小猪学习游泳的30秒故事",
      surface: "workbench",
      now: 1_777_300_000_000,
    });

    expect(openedUrls).toEqual(["http://127.0.0.1:8188"]);
    expect(result.comfyUiWorkflow).toMatchObject({
      ok: true,
      uploadedToComfyUi: false,
      uploadStatus: 503,
      angelSource: "api-provider",
    });
    expect(result.comfyUiWorkflow.message).toContain("已保存本地工作流");
    expect(result.comfyUiWorkflow.message).toContain("同步到 ComfyUI 失败");
    expect(result.comfyUiWorkflow.message).not.toContain(
      "已创建完整 ComfyUI workflow，并写入工作流列表",
    );
  });

  it("creates script and copywriting production drafts without falling back to storyboard cards", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-production-typed-"));
    tempRoots.push(workspaceRoot);
    const providerOutputs = [
      "脚本草案：写一个小猫从家走到公园，遇见朋友后一起回家。",
      "文案草案：公园咖啡车 30 秒口播，突出晨间香气和随手即买。",
    ];
    const calls = [];
    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          calls.push({ url, body: JSON.parse(String(init.body)) });
          return fakeApiProviderTextResponse(providerOutputs.shift() ?? "");
        },
      }),
    });
    await configureFakeApiProvider(bridge);

    const script = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/脚本 写一个小猫从家走到公园，遇见朋友再回家的短剧",
      surface: "workbench",
    });
    const copywriting = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/文案 给公园咖啡车写一条 30 秒短视频口播",
      surface: "workbench",
    });

    expect(script.productionRun).toMatchObject({
      ok: true,
      workflowType: "script",
      runStatus: "running",
      draftSource: "api-provider",
      replySource: "model",
    });
    expect(script.productionRun.workbenchOutput).toContain("脚本草案");
    expect(script.productionRun.workbenchOutput).toContain("写一个小猫从家走到公园");
    expect(script.productionRun.workbenchOutput).not.toContain("分镜蓝图预览");
    expect(copywriting.productionRun).toMatchObject({
      ok: true,
      workflowType: "copywriting",
      runStatus: "running",
      draftSource: "api-provider",
      replySource: "model",
    });
    expect(copywriting.productionRun.workbenchOutput).toContain("文案草案");
    expect(copywriting.productionRun.workbenchOutput).toContain("公园咖啡车");
    expect(copywriting.productionRun.workbenchOutput).not.toContain("分镜蓝图预览");
    expect(calls).toHaveLength(2);
  });

  it("creates a production run with skill and knowledge recall audit traces from workbench production prompts", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-production-run-"));
    tempRoots.push(workspaceRoot);
    writeKnowledgeRecallSwitchFixture(workspaceRoot, true);
    writeRichSkillSnapshotFixture(workspaceRoot);
    await writePublishedProductionKnowledgeFixture(workspaceRoot);
    let apiProviderTextCalls = 0;

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async () => {
          apiProviderTextCalls += 1;
          throw new Error("production prompts must not call apiProvider.text");
        },
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "导演制作：backend snapshot continuity teaser 短剧",
      surface: "workbench",
    });
    const runStore = new FileSystemRunStore({
      rootPath: join(workspaceRoot, ".director-angel", "runtime", "execution"),
    });
    const run = await runStore.loadRun(result.productionRun.runId);
    const runNotes = run?.notes?.join("\n") ?? "";

    expect(apiProviderTextCalls).toBe(0);
    expect(result).not.toHaveProperty("apiProviderRun");
    expect(result.productionRun).toMatchObject({
      ok: true,
      prompt: "导演制作：backend snapshot continuity teaser 短剧",
      recallStatus: "hit",
      skillStatus: "hit",
      skillIds: expect.arrayContaining(["skill.backend-snapshot"]),
      knowledgePackIds: expect.arrayContaining(["director-experience-local-constraints"]),
      runStatus: "running",
      reportId: expect.stringContaining("report-"),
      executedAssignments: expect.arrayContaining([expect.stringContaining("researcher")]),
      assignmentCounts: expect.objectContaining({
        completed: 1,
        pending: 4,
      }),
    });
    expect(result.productionRun).toMatchObject({
      draftSource: "api-provider-unavailable",
      replySource: "degraded-error",
      draftArtifact: null,
      workbenchOutput: "",
    });
    expect(result.snapshot.activePanel).toBe("result");
    expect(result.productionRun.runId).toEqual(expect.any(String));
    expect(run).toMatchObject({
      status: "running",
      blueprintId: result.productionRun.blueprintId,
      notes: expect.arrayContaining([
        expect.stringContaining("Desktop-created production run"),
        "published-knowledge=hit",
        "skills=hit",
        "skill-hit=skill.backend-snapshot",
      ]),
    });
    expect(runNotes).toContain("published-pack=director-experience-local-constraints");
    expect(run?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "run-created",
        }),
      ]),
    );
    expect(result.events.map((event) => event.title)).toEqual(["制作任务已创建"]);
  });

  it("persists the visible production draft as a reviewable run artifact", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-production-artifact-"));
    tempRoots.push(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async () =>
          fakeApiProviderTextResponse("制作判断：生成一个15秒短剧分镜蓝图，包含三镜头起承转合。"),
      }),
    });
    await configureFakeApiProvider(bridge);

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.PRODUCTION_START,
      prompt: "生成一个15秒短剧分镜蓝图",
    });
    const runStore = new FileSystemRunStore({
      rootPath: join(workspaceRoot, ".director-angel", "runtime", "execution"),
    });
    const run = await runStore.loadRun(result.productionRun.runId);
    const artifactPath = result.productionRun.draftArtifact?.path ?? "";
    const artifactContent = readFileSync(artifactPath, "utf8");

    expect(result.productionRun.draftArtifact).toMatchObject({
      artifactId: "desktop-production-draft",
      contentType: "text/markdown",
      source: "api-provider",
    });
    expect(artifactContent).toContain("生成一个15秒短剧分镜蓝图");
    expect(artifactContent).not.toContain("系统审查状态（以后端为准）");
    expect(run?.notes).toEqual(
      expect.arrayContaining([`draft-artifact=${artifactPath}`, "draft-source=api-provider"]),
    );
  });

  it("does not create a desktop production run from casual chatter", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-production-noise-"));
    tempRoots.push(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.PRODUCTION_START,
      prompt: "今天天气不错，随便聊聊",
    });

    expect(result.productionRun).toBeUndefined();
    expect(result.events.at(-1)).toMatchObject({
      title: "没有创建制作任务",
      actionType: DESKTOP_ACTIONS.PRODUCTION_START,
    });
    expect(existsSync(join(workspaceRoot, ".director-angel", "runtime", "execution", "runs"))).toBe(
      false,
    );
  });

  it("uses runtime memory recall in desktop production only when the memory switch is enabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-production-memory-"));
    tempRoots.push(workspaceRoot);
    const fixedNow = 1_777_299_900_000;
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);
    const taskId = `desktop-${fixedNow}`;
    const projectId = "director-angel-desktop";
    const groupId = `group-${taskId}`;
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "memory.enabled": true,
    });
    await writeDirectorMemoryRecordFixture(workspaceRoot, {
      projectId,
      groupId,
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.PRODUCTION_START,
      prompt: "沿用之前成功的分镜经验做15秒短剧",
    });
    const runStore = new FileSystemRunStore({
      rootPath: join(workspaceRoot, ".director-angel", "runtime", "execution"),
    });
    const run = await runStore.loadRun(result.productionRun.runId);

    expect(result.productionRun).toMatchObject({
      ok: true,
      memoryStatus: "hit",
    });
    expect(result.productionRun.workbenchOutput).not.toContain("调用运行记忆：命中 1 条运行记忆");
    expect(result.productionRun.stageTimeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stageId: "memory-recall",
          refIds: expect.arrayContaining(["record-memory-1"]),
        }),
      ]),
    );
    expect(run?.notes).toEqual(
      expect.arrayContaining(["recall=hit", expect.stringContaining("recall-run=run-memory-1")]),
    );
  });

  it("uses compact long-term memory in desktop production when memory is enabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-production-long-memory-"));
    tempRoots.push(workspaceRoot);
    vi.spyOn(Date, "now").mockReturnValue(1_777_299_950_000);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "memory.enabled": true,
    });
    writeLongTermMemoryFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.PRODUCTION_START,
      prompt: "生成一个15秒短剧分镜蓝图",
    });
    const runStore = new FileSystemRunStore({
      rootPath: join(workspaceRoot, ".director-angel", "runtime", "execution"),
    });
    const run = await runStore.loadRun(result.productionRun.runId);
    const longMemoryStage = result.productionRun.stageTimeline.find(
      (stage) => stage.stageId === "long-term-memory",
    );

    expect(result.productionRun).toMatchObject({
      ok: true,
      longTermMemoryStatus: "hit",
    });
    expect(longMemoryStage).toMatchObject({
      stageId: "long-term-memory",
      status: "hit",
      refIds: expect.arrayContaining(["long-term-memory:memory", "long-term-memory:user"]),
    });
    expect(longMemoryStage.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "命中",
          value: "long-term-memory:memory；long-term-memory:user",
        }),
      ]),
    );
    expect(run?.notes).toEqual(
      expect.arrayContaining([
        "long-term-memory=hit",
        "long-term-signal=long-term-memory:memory",
        "long-term-signal=long-term-memory:user",
      ]),
    );
  });

  it("recalls prior desktop production memory across different runs with a stable project lane", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-production-memory-stable-"));
    tempRoots.push(workspaceRoot);
    vi.spyOn(Date, "now").mockReturnValue(1_777_300_200_000);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "memory.enabled": true,
    });
    await writeDirectorMemoryRecordFixture(workspaceRoot, {
      projectId: "director-angel-desktop",
      groupId: "group-previous-run",
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.PRODUCTION_START,
      prompt: "按上次那个风格继续生成15秒短剧分镜",
    });

    expect(result.productionRun).toMatchObject({
      ok: true,
      memoryStatus: "hit",
    });
    expect(result.productionRun.workbenchOutput).not.toContain("调用运行记忆：命中 1 条运行记忆");
    expect(result.productionRun.stageTimeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stageId: "memory-recall",
          refIds: expect.arrayContaining(["record-memory-1"]),
        }),
      ]),
    );
  });

  it("writes completed desktop production runs into the memory lane when memory is enabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-production-memory-ingest-"));
    tempRoots.push(workspaceRoot);
    vi.spyOn(Date, "now").mockReturnValue(1_777_300_500_000);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "memory.enabled": true,
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const started = await bridge.invoke({
      type: DESKTOP_ACTIONS.PRODUCTION_START,
      prompt: "生成一个15秒短剧分镜蓝图",
    });
    const continued = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUN_CONTINUE,
      runId: started.productionRun.runId,
    });
    const memoryStore = new FileSystemDirectorMemoryStore({
      rootPath: join(workspaceRoot, ".director-angel", "runtime", "memory"),
    });
    const memoryStatus = await memoryStore.getStatus();
    const ingestAudit = JSON.parse(
      readFileSync(
        join(
          workspaceRoot,
          ".director-angel",
          "runtime",
          "memory",
          "ingest",
          `${started.productionRun.runId}.json`,
        ),
        "utf8",
      ),
    );
    const observationLog = readFileSync(
      join(workspaceRoot, ".director-angel", "runtime", "observations.ndjson"),
      "utf8",
    );

    expect(continued.runControlResult).toMatchObject({
      runStatus: "completed",
      memoryIngest: expect.objectContaining({
        status: "ok",
        runId: started.productionRun.runId,
        recordId: `record-${started.productionRun.runId}`,
      }),
    });
    expect(memoryStatus).toMatchObject({
      status: "ok",
      recordCount: 1,
    });
    expect(ingestAudit).toMatchObject({
      schemaVersion: "director.memory.ingest.audit.v1",
      status: "ok",
      runId: started.productionRun.runId,
      observationIds: expect.arrayContaining([expect.stringContaining("observation-evaluation")]),
    });
    expect(observationLog).toContain('"source":"evaluation"');
  });

  it("uses a configured API provider to generate the visible production draft without bypassing the run", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-production-model-draft-"));
    tempRoots.push(workspaceRoot);
    const calls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async (url, init) => {
          calls.push({
            url,
            method: init.method,
            authorization: init.headers.Authorization,
            body: JSON.parse(String(init.body)),
          });
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content:
                        "制作判断：可以先做15秒三镜头短剧初稿。\n分镜蓝图：1 建立人物；2 推进冲突；3 留下钩子。\n**系统审查状态**\nqc-reviewer: 错误的模型系统状态。\n**待审查项**\n* 错误的模型审查项\n**下一步**\n错误的模型下一步。",
                    },
                  },
                ],
              }),
          };
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-production-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/制作 生成一个15秒短剧分镜蓝图",
      surface: "workbench",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://proxy.example.test/v1/chat/completions",
      method: "POST",
      authorization: "Bearer sk-production-secret",
    });
    expect(calls[0].body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining(
            "不要输出“待审查项”“系统审查状态”“下一步”“经验/Skill调用”等过程章节。",
          ),
        }),
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("制作目标：生成一个15秒短剧分镜蓝图"),
        }),
      ]),
    );
    expect(result).not.toHaveProperty("apiProviderRun");
    expect(result.productionRun).toMatchObject({
      ok: true,
      draftSource: "api-provider",
      modelDraft: expect.objectContaining({
        ok: true,
        providerId: "memefast-api",
        model: "gemini-2.5-flash",
      }),
      runStatus: "running",
      reportId: expect.stringContaining("report-"),
    });
    expect(result.productionRun.workbenchOutput).toContain("制作判断：可以先做15秒三镜头短剧初稿");
    expect(result.productionRun.workbenchOutput).not.toContain("调用已配置的模型供应方");
    expect(result.productionRun.workbenchOutput).not.toContain("系统审查状态（以后端为准）");
    expect(result.productionRun.workbenchOutput).not.toContain("qc-reviewer:");
    expect(result.productionRun.workbenchOutput).not.toContain("错误的模型系统状态");
    expect(result.productionRun.workbenchOutput).not.toContain("错误的模型审查项");
    expect(result.productionRun.workbenchOutput).not.toContain("错误的模型下一步");
    expect(result.productionRun.workbenchOutput).not.toContain("需人工批准");
    expect(result.productionRun.workbenchOutput).not.toContain("等待依赖完成后自动允许");
    expect(JSON.stringify(result)).not.toContain("sk-production-secret");
  });

  it("blocks production model calls before creating a run when the cost budget is exhausted", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "director-desktop-production-budget-blocked-"),
    );
    tempRoots.push(workspaceRoot);
    const calls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        apiProviderFetch: async () => {
          calls.push("model-call");
          throw new Error("budget guard should block before model fetch");
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-production-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.COST_BUDGET_SET,
      limitUsd: 2,
      spentUsd: 2,
      blocked: true,
      now: "2026-04-28T08:10:00.000Z",
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/制作 生成一个15秒短剧分镜蓝图",
      surface: "workbench",
    });

    expect(calls).toHaveLength(0);
    expect(result.productionRun).toMatchObject({
      ok: false,
      draftSource: "cost-budget-blocked",
      runId: null,
      runStatus: "blocked",
      recallStatus: "skipped",
      skillStatus: "skipped",
      modelDraft: expect.objectContaining({
        ok: false,
        providerId: "cost-budget",
        message: expect.stringContaining("成本预算"),
      }),
    });
    expect(result.productionRun.workbenchOutput).toContain("成本预算护栏已阻断");
    expect(result.productionRun.stageTimeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stageId: "settings",
          status: "blocked",
          summary: expect.stringContaining("成本预算"),
        }),
        expect.objectContaining({
          stageId: "run-created",
          status: "skipped",
        }),
      ]),
    );
    expect(result.snapshot.assets.review.executionRunCount).toBe(0);
    expect(result.events.map((event) => event.title)).toContain("成本预算已阻断制作");
  });

  it("blocks direct API provider text and image calls when the cost budget is exhausted", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-api-budget-blocked-"));
    tempRoots.push(workspaceRoot);
    const calls = [];

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture(),
        apiProviderFetch: async () => {
          calls.push("model-call");
          throw new Error("budget guard should block before provider fetch");
        },
      }),
    });

    await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-direct-secret",
    });
    await bridge.invoke({
      type: DESKTOP_ACTIONS.COST_BUDGET_SET,
      limitUsd: 3,
      spentUsd: 3,
      blocked: true,
      now: "2026-04-28T08:11:00.000Z",
    });

    const text = await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
      prompt: "写一个导演提示词",
    });
    const image = await bridge.invoke({
      type: DESKTOP_ACTIONS.API_PROVIDER_IMAGE,
      prompt: "生成一张分镜图",
    });

    expect(calls).toHaveLength(0);
    expect(text.apiProviderRun).toMatchObject({
      ok: false,
      providerId: "cost-budget",
      message: expect.stringContaining("成本预算"),
    });
    expect(image.apiProviderImage).toMatchObject({
      ok: false,
      providerId: "cost-budget",
      message: expect.stringContaining("成本预算"),
    });
    expect(text.events[0]).toMatchObject({ title: "模型调用已被成本预算阻断" });
    expect(image.events[0]).toMatchObject({ title: "图片生成已被成本预算阻断" });
  });

  it("falls back to full runtime defaults when the switch file is corrupted", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-corrupt-switches-"));
    tempRoots.push(workspaceRoot);
    const runtimeRoot = join(workspaceRoot, ".director-angel", "runtime");
    mkdirSync(runtimeRoot, { recursive: true });
    writeFileSync(join(runtimeRoot, "switches.json"), "{ broken json", "utf8");

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });

    expect(result.snapshot.assets.settings).toMatchObject({
      source: "defaults",
      featureCount: 21,
      enabledCount: 11,
      disabledCount: 10,
    });
    expect(result.snapshot.assets.settings.issues.length).toBeGreaterThan(0);
  });

  it("writes runtime settings through a desktop action and refreshes the snapshot", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-settings-set-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeSwitchFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const featureResult = await bridge.invoke({
      type: DESKTOP_ACTIONS.SETTINGS_SET,
      parameterId: "feature:learning.enabled",
      value: false,
    });
    const roleResult = await bridge.invoke({
      type: DESKTOP_ACTIONS.SETTINGS_SET,
      parameterId: "role:researcher",
      value: false,
    });
    const adapterResult = await bridge.invoke({
      type: DESKTOP_ACTIONS.SETTINGS_SET,
      parameterId: "adapter:external-cli",
      value: true,
    });
    const heartbeatIntervalResult = await bridge.invoke({
      type: DESKTOP_ACTIONS.SETTINGS_SET,
      parameterId: "runtime:heartbeat.intervalMs",
      value: 45000,
    });
    const document = JSON.parse(
      readFileSync(join(workspaceRoot, ".director-angel", "runtime", "switches.json"), "utf8"),
    );
    const heartbeatSettings = JSON.parse(
      readFileSync(
        join(workspaceRoot, ".director-angel", "runtime", "heartbeat-settings.json"),
        "utf8",
      ),
    );

    expect(featureResult.snapshot.assets.settings.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "feature:learning.enabled",
          value: false,
          valueLabel: "关闭",
        }),
      ]),
    );
    expect(roleResult.snapshot.assets.settings.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "role:researcher",
          value: false,
          valueLabel: "关闭",
        }),
      ]),
    );
    expect(adapterResult.snapshot.assets.settings.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "adapter:external-cli",
          value: true,
          valueLabel: "开启",
        }),
      ]),
    );
    expect(adapterResult.events.at(-1)).toMatchObject({
      title: "设置已更新",
      actionType: DESKTOP_ACTIONS.SETTINGS_SET,
    });
    expect(heartbeatIntervalResult.snapshot.assets.settings.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "runtime:heartbeat.intervalMs",
          value: 45000,
          valueLabel: "45000",
        }),
      ]),
    );
    expect(document.features["learning.enabled"]).toBe(false);
    expect(document.features["publish.enabled"]).toBe(false);
    expect(document.roleOverrides.researcher).toBe(false);
    expect(document.adapterOverrides["external-cli"]).toBe(true);
    expect(heartbeatSettings).toMatchObject({
      schemaVersion: "director.heartbeat.settings.v1",
      heartbeat: {
        intervalMs: 45000,
      },
      updatedBy: "director-desktop",
    });
  });

  it("surfaces expired Weixin gateway startup failures to the desktop UI payload", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-weixin-expired-"));
    tempRoots.push(workspaceRoot);
    writeWeixinAccountFixture(workspaceRoot);
    const weixinGatewayOptions = {
      platform: "darwin",
      fetch: async (url) => {
        if (String(url).includes("getupdates")) {
          return jsonResponse({ ret: -14, errcode: -14, errmsg: "expired" });
        }
        return jsonResponse({ ret: 0 });
      },
      runCommand: async (file, args) => {
        if (file === "launchctl" && args[0] === "print") {
          return { code: 1, stdout: "", stderr: "not loaded" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    };

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        weixinGatewayOptions,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.WEIXIN_GATEWAY_CONTROL,
      operation: "start",
    });

    expect(result.weixinGatewayControl).toMatchObject({
      operation: "start",
      method: "blocked",
      ok: false,
      issue: "expired-session",
      message: expect.stringContaining("重新连接微信"),
    });
    expect(result.events.at(-1)).toMatchObject({
      title: "微信网关启动失败",
      body: expect.stringContaining("重新连接微信"),
      actionType: DESKTOP_ACTIONS.WEIXIN_GATEWAY_CONTROL,
    });
  });

  it("switches the selected Weixin account through the desktop bridge", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-weixin-select-"));
    tempRoots.push(workspaceRoot);
    writeWeixinAccountFixture(workspaceRoot);
    writeWeixinAccountFixture(workspaceRoot, {
      id: "fresh-account",
      token: "fresh-token",
      userId: "fresh-user",
      savedAt: "2026-05-01T00:00:00.000Z",
      append: true,
    });
    const weixinGatewayOptions = {
      platform: "darwin",
      fetch: async () => jsonResponse({ ret: 0, msgs: [], get_updates_buf: "" }),
      runCommand: async (file, args) => {
        if (file === "launchctl" && args[0] === "print") {
          return { code: 1, stdout: "", stderr: "not loaded" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    };

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        weixinGatewayOptions,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.WEIXIN_GATEWAY_ACCOUNT_SELECT,
      accountId: "expired-account",
    });

    expect(result.weixinGatewayAccount).toMatchObject({
      normalizedAccountId: "expired-account",
      userId: "expired-user",
    });
    expect(result.snapshot.assets.settings.weixinGateway.account).toMatchObject({
      selectedAccountId: "expired-account",
      primaryId: "expired-account",
    });
    expect(result.events.at(-1)).toMatchObject({
      title: "微信账号已切换",
      body: expect.stringContaining("expired-account"),
      actionType: DESKTOP_ACTIONS.WEIXIN_GATEWAY_ACCOUNT_SELECT,
    });
  });

  it("can update every writable settings parameter through the workbench composer slash path", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-settings-all-"));
    tempRoots.push(workspaceRoot);
    writeAdapterRegistryFixture(workspaceRoot);
    writeRuntimeSwitchFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        runCliCommand: async (argv) => ({ argv, exitCode: 0, stdout: "", stderr: "" }),
      }),
    });
    const initial = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    const writableParameters = initial.snapshot.assets.settings.parameters.filter(
      (parameter) => parameter.writable && parameter.type === "boolean",
    );

    expect(writableParameters.map((parameter) => parameter.category)).toEqual(
      expect.arrayContaining(["features", "roles", "adapterOverrides", "apiProviders"]),
    );

    for (const parameter of writableParameters) {
      const nextValue = parameter.value !== true;
      const prompt =
        parameter.category === "apiProviders"
          ? `/供应方 ${nextValue ? "启用" : "禁用"} ${parameter.id.split(":")[1]}`
          : `/设置 ${parameter.id} ${nextValue ? "开启" : "关闭"}`;
      const result = await bridge.invoke({
        type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
        prompt,
        surface: "workbench",
      });
      const updated = result.snapshot.assets.settings.parameters.find(
        (entry) => entry.id === parameter.id,
      );

      expect(updated).toMatchObject({
        id: parameter.id,
        value: nextValue,
        valueLabel: nextValue ? "开启" : "关闭",
      });
      const expectedEventTitles =
        parameter.category === "apiProviders"
          ? ["API 供应方已更新"]
          : parameter.category === "externalTools"
            ? ["外部工具已更新", "外部工具已启用", "外部工具已停用"]
            : ["设置已更新"];
      expect(result.events.map((event) => event.title)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(new RegExp(expectedEventTitles.join("|"), "u")),
        ]),
      );
    }

    const document = JSON.parse(
      readFileSync(join(workspaceRoot, ".director-angel", "runtime", "switches.json"), "utf8"),
    );
    const providerDocument = JSON.parse(
      readFileSync(join(workspaceRoot, ".director-angel", "providers", "providers.json"), "utf8"),
    );
    for (const parameter of writableParameters) {
      const [, key] = parameter.id.split(/:(.*)/u);
      const expected = parameter.value !== true;
      if (parameter.category === "features") {
        expect(document.features[key]).toBe(expected);
      } else if (parameter.category === "roles") {
        expect(document.roleOverrides[key]).toBe(expected);
      } else if (parameter.category === "adapterOverrides") {
        expect(document.adapterOverrides[key]).toBe(expected);
      } else if (parameter.category === "apiProviders") {
        const [providerId, settingKey] = key.split(":");
        const provider = providerDocument.providers.find((entry) => entry.id === providerId);
        expect(settingKey).toBe("enabled");
        expect(provider.enabled).toBe(expected);
      }
    }
  });

  it("keeps read-only settings parameters non-writable through the composer", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-settings-readonly-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeSwitchFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
        runCliCommand: async (argv) => ({ argv, exitCode: 0, stdout: "", stderr: "" }),
      }),
    });
    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/设置 path:dataDir 关闭",
      surface: "workbench",
    });
    const dataDir = result.snapshot.assets.settings.parameters.find(
      (parameter) => parameter.id === "path:dataDir",
    );
    const document = JSON.parse(
      readFileSync(join(workspaceRoot, ".director-angel", "runtime", "switches.json"), "utf8"),
    );

    expect(result.events[0]).toMatchObject({
      title: "需要补充 /能力 参数",
    });
    expect(dataDir).toMatchObject({
      id: "path:dataDir",
      writable: false,
    });
    expect(document.features["learning.enabled"]).toBe(true);
  });

  it("includes trace proposal and execution run review depth in the desktop snapshot", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-review-depth-"));
    tempRoots.push(workspaceRoot);
    await writeTraceProposalFixture(workspaceRoot);
    await writeExecutionRunFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });

    expect(result.snapshot.assets.review).toMatchObject({
      pendingExperienceCount: 0,
      pendingKnowledgeCount: 0,
      traceProposalCount: 1,
      pendingTraceProposalCount: 1,
      executionRunCount: 1,
      executionReportCount: 1,
      failedRunCount: 1,
      runAttentionCount: 1,
      pendingCount: 2,
      taskProposalStatus: "requires-session",
    });
    expect(result.snapshot.assets.review.latestRun).toMatchObject({
      runId: "run-review-1",
      status: "failed",
      snapshotId: "snapshot-1",
      runtimeId: "runtime-1",
      assignmentCounts: {
        failed: 1,
      },
      eventCount: 1,
      assignments: [
        expect.objectContaining({
          assignmentId: "assignment-review-1",
          role: "asset-router",
          actionClass: "generate",
          status: "failed",
          adapterId: "external-cli",
          rerouteCandidates: ["fallback-cli"],
          bridgeVerdict: "failed",
          bridgeFailureReason: "network_timeout",
          bridgeStatus: 504,
          retryAllowed: true,
        }),
      ],
      delegationSnapshot: expect.objectContaining({
        delegationCount: 1,
        verificationCount: 1,
        subagentRunCount: 1,
        workerIds: ["director-asset-router"],
        verifierIds: ["director-qc-reviewer"],
        subagentRuns: [
          expect.objectContaining({
            subagentId: "delegation_run_review_1_assignment_review_1",
            parentTurnId: "run-review-1",
            profileId: "asset-router-agent",
            taskId: "assignment-review-1",
            status: "failed",
            role: "general",
            parentVisibleResult: expect.objectContaining({
              status: "failed",
              summary: expect.stringContaining("External CLI bridge timed out"),
              verificationVerdict: "fail",
            }),
            verification: expect.objectContaining({
              verifierId: "director-qc-reviewer",
              status: "failed",
              verdict: "fail",
              verdictSummary: expect.stringContaining("operator review"),
            }),
          }),
        ],
        delegations: [
          expect.objectContaining({
            taskId: "assignment-review-1",
            workerId: "director-asset-router",
            status: "failed",
          }),
        ],
      }),
      events: [
        expect.objectContaining({
          type: "assignment-status-changed",
          at: "2026-04-25T10:02:00.000Z",
          assignmentId: "assignment-review-1",
          summary: "Assignment failed after bridge timeout.",
        }),
      ],
    });
    expect(result.snapshot.assets.review.latestReport).toMatchObject({
      runId: "run-review-1",
      reportId: "report-review-1",
      runStatus: "failed",
      bridgeVerdict: "failed",
      bridgeFailureReason: "network_timeout",
      retryAllowed: true,
      bridgeFailureMessage: "Timed out while calling external CLI.",
      bridgeStatus: 504,
      requestId: null,
      rerouteCandidates: ["fallback-cli"],
      assignments: [
        expect.objectContaining({
          assignmentId: "assignment-review-1",
          rerouteCandidates: ["fallback-cli"],
        }),
      ],
    });
    expect(result.snapshot.assets.review.traceProposalItems[0]).toMatchObject({
      id: "proposal-review-1",
      kind: "director.trace_capture",
      summary: "Capture reusable failure handling experience.",
      evidenceSummary: "Run failed after bridge timeout.",
      explanation: "Human review should decide whether to retain this lesson.",
      roles: ["qc-reviewer"],
      selectedAdapters: ["external-cli"],
      recordId: "record-1",
      digestId: "digest-1",
    });
    expect(result.snapshot.assets.review.executionItems[0]).toMatchObject({
      runId: "run-review-1",
      previewSummary: "Bridge failed and needs review.",
      assignmentCounts: {
        failed: 1,
      },
      assignments: [
        expect.objectContaining({
          assignmentId: "assignment-review-1",
          bridgeFailureReason: "network_timeout",
          bridgeRetryable: true,
        }),
      ],
      events: [
        expect.objectContaining({
          at: "2026-04-25T10:02:00.000Z",
        }),
      ],
    });
    expect(result.snapshot.assets.review.executionReportItems).toHaveLength(1);
    expect(result.snapshot.assets.review.executionReportItems[0]).toMatchObject({
      runId: "run-review-1",
      reportId: "report-review-1",
      runStatus: "failed",
      bridgeVerdict: "failed",
      assignments: [
        expect.objectContaining({
          assignmentId: "assignment-review-1",
          bridgeFailureMessage: "Timed out while calling external CLI.",
        }),
      ],
    });
  });

  it("normalizes the local MemPalace fixture eval report into review ops assets", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-memory-eval-"));
    tempRoots.push(workspaceRoot);
    const reportPath = join(
      workspaceRoot,
      "benchmarks",
      "results",
      "director-agent-os-mempalace-real-eval-fixture-gate-latest.json",
    );
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          suiteId: "director-agent-os-mempalace-real-eval-fixture-gate",
          generatedAt: "2026-05-09T04:41:02.121Z",
          fixturePath: join(
            workspaceRoot,
            "benchmarks",
            "fixtures",
            "director-agent-os-mempalace-real-eval-mini.json",
          ),
          source: {
            name: "local-mini-locomem-style-fixture",
            dataset: "local-fixture",
            version: "2026-05-08",
            localOnly: true,
          },
          summary: {
            status: "passed",
            qualityCaseCount: 3,
            diagnosticCaseCount: 1,
            thresholds: {
              recallAtK: 0.8,
              recallAnyAtK: 1,
              ndcgAtK: 0.75,
              requireVerbatimEvidence: true,
              requireProvenanceEvidence: true,
            },
            qualityAverages: {
              recallAtK: 1,
              recallAnyAtK: 1,
              recallAllAtK: 1,
              ndcgAtK: 1,
            },
            failed: 0,
          },
          diagnosticReport: {
            results: [
              {
                queryId: "diagnostic-missing-verbatim-provenance",
                recallAtK: 0,
                recallAnyAtK: 0,
                ndcgAtK: 0,
                missingExpectedIds: ["mempalace:drawer_required_missing"],
                retrievedIdsAtK: ["mempalace:drawer_wrong_no_evidence"],
              },
            ],
            failures: [
              {
                queryId: "diagnostic-missing-verbatim-provenance",
                missingExpectedIds: ["mempalace:drawer_required_missing"],
              },
            ],
          },
          diagnosticThresholds: {
            status: "failed",
            failures: [
              "case diagnostic-missing-verbatim-provenance evidence mempalace:drawer_wrong_no_evidence is missing provenance.",
            ],
          },
          failures: [],
        },
        null,
        2,
      ),
    );

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });

    expect(result.snapshot.assets.review.agentOsMemoryEval).toMatchObject({
      schemaVersion: "director.desktop.agent-os-memory-eval.v1",
      suiteId: "director-agent-os-mempalace-real-eval-fixture-gate",
      status: "passed",
      reportPath: expect.stringContaining(
        "director-agent-os-mempalace-real-eval-fixture-gate-latest.json",
      ),
      source: {
        name: "local-mini-locomem-style-fixture",
        dataset: "local-fixture",
        version: "2026-05-08",
        localOnly: true,
      },
      summary: {
        qualityCaseCount: 3,
        diagnosticCaseCount: 1,
        failed: 0,
      },
      thresholds: {
        recallAtK: 0.8,
        recallAnyAtK: 1,
        ndcgAtK: 0.75,
        requireVerbatimEvidence: true,
        requireProvenanceEvidence: true,
      },
      qualityAverages: {
        recallAtK: 1,
        recallAnyAtK: 1,
        recallAllAtK: 1,
        ndcgAtK: 1,
      },
      diagnosticStatus: "failed",
      diagnosticCases: [
        expect.objectContaining({
          queryId: "diagnostic-missing-verbatim-provenance",
          missingExpectedIds: ["mempalace:drawer_required_missing"],
        }),
      ],
      diagnosticFailures: expect.arrayContaining([
        expect.objectContaining({
          detail: expect.stringContaining("missing provenance"),
        }),
        expect.objectContaining({
          queryId: "diagnostic-missing-verbatim-provenance",
          missingExpectedIds: ["mempalace:drawer_required_missing"],
        }),
      ]),
    });
    expect(result.snapshot.assets.review.agentOsMemoryEvalDashboard).toMatchObject({
      schemaVersion: "director.desktop.agent-os-memory-eval-dashboard.v1",
      status: "ready",
      localOnly: true,
      canReadUserData: false,
      memoryEvalTrend: expect.arrayContaining([
        expect.objectContaining({
          id: "local-fixture-recall",
          metric: "recall@k",
          current: 1,
          threshold: 0.8,
          status: "passed",
          canReadUserData: false,
        }),
        expect.objectContaining({
          id: "local-fixture-ndcg",
          metric: "ndcg@k",
          current: 1,
          threshold: 0.75,
          status: "passed",
        }),
      ]),
      maintenanceDueActions: expect.arrayContaining([
        expect.objectContaining({
          id: "recall-degradation-watch",
          kind: "maintenance-due",
          status: "watch",
          nextRecommendedCommand: "pnpm --dir benchmarks bench:director-agent-os-mempalace-real-eval",
        }),
        expect.objectContaining({
          id: "dataset-loader-gate",
          kind: "maintenance-due",
          status: "ready",
          canReadUserData: false,
          nextRecommendedCommand:
            "pnpm --dir benchmarks bench:director-agent-os-memory-dataset-loader-anonymization",
        }),
      ]),
    });
  });

  it("reads local run delegation mailboxes through a desktop action", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-run-delegations-"));
    tempRoots.push(workspaceRoot);
    await writeExecutionRunFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUN_DELEGATIONS,
      runId: "run-review-1",
    });

    expect(result.runDelegations).toMatchObject({
      runId: "run-review-1",
      delegationCount: 1,
      subagentRunCount: 1,
      failedDelegationCount: 1,
      verificationCount: 1,
      workerIds: ["director-asset-router"],
    });
    expect(result.runDelegations.subagentRuns[0]).toMatchObject({
      subagentId: "delegation_run_review_1_assignment_review_1",
      parentTurnId: "run-review-1",
      profileId: "asset-router-agent",
      taskId: "assignment-review-1",
      status: "failed",
      parentVisibleResult: expect.objectContaining({
        status: "failed",
        summary: expect.stringContaining("External CLI bridge timed out"),
        verificationVerdict: "fail",
      }),
    });
    expect(result.runDelegations.delegations[0]).toMatchObject({
      taskId: "assignment-review-1",
      workerId: "director-asset-router",
      targetAgent: "asset-router-agent",
      status: "failed",
    });
    expect(result.events[0]).toMatchObject({
      title: "运行协作状态",
      body: expect.stringContaining("Agent OS 子代理 1 个"),
    });
  });

  it("does not project nested subagent completion as a user-facing desktop announce", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-nested-subagent-"));
    tempRoots.push(workspaceRoot);
    await writeNestedSubagentExecutionRunFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUN_DELEGATIONS,
      runId: "run-nested-subagent-1",
    });

    expect(result.runDelegations).toMatchObject({
      runId: "run-nested-subagent-1",
      delegationCount: 2,
      completedSubagentRunCount: 2,
      subagentAnnounceCount: 1,
      subagentAnnounces: [
        expect.objectContaining({
          subagentId: "delegate_top_level_background",
          requesterSessionKey: "desktop:run:run-nested-subagent-1",
          userFacingText: expect.stringContaining("顶层后台任务"),
        }),
      ],
    });
    expect(result.runDelegations.subagentAnnounces).toHaveLength(1);
    expect(result.runDelegations.subagentAnnounces[0]?.subagentId).not.toBe(
      "delegate_nested_background",
    );
    expect(result.runDelegations.subagentRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subagentId: "delegate_nested_background",
          contextSnapshot: expect.stringContaining("topLevelRequester=false"),
          parentVisibleResult: expect.objectContaining({
            status: "completed",
            summary: "嵌套后台任务完成，应该回给直接父 agent。",
          }),
        }),
      ]),
    );
  });

  it("projects desktop Run/Review subagent scheduler tick intents", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-run-scheduler-"));
    tempRoots.push(workspaceRoot);
    await writeSubagentSchedulerExecutionRunFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUN_DELEGATIONS,
      runId: "run-scheduler-1",
    });

    expect(result.runDelegations).toMatchObject({
      runId: "run-scheduler-1",
      subagentRunCount: 4,
      queuedSubagentRunCount: 2,
      runningSubagentRunCount: 1,
      completedSubagentRunCount: 1,
      subagentSchedulerHeartbeat: {
        schemaId: "hotflow.agent-os.subagent-scheduler-heartbeat.v1",
        parentTurnId: "run-scheduler-1",
        totalSubagentRuns: 4,
        queuedCount: 2,
        runningCount: 1,
        completedCount: 1,
        failedCount: 0,
        cancelledCount: 0,
        schedulerTrackedCount: 4,
        readyCount: 1,
        blockedCount: 1,
        unscheduledQueuedCount: 0,
        nextReadySubagentIds: ["delegate_scheduler_gamma_ready"],
        blockedSubagentIds: ["delegate_scheduler_alpha_followup"],
        runningSubagentIds: ["delegate_scheduler_alpha_running"],
        canContinue: true,
        stoppedReason: "ready",
        heartbeatOrdinal: expect.any(Number),
        latestUpdatedAtMs: expect.any(Number),
      },
      subagentSchedulerDispatchPlan: {
        schemaId: "hotflow.agent-os.subagent-scheduler-dispatch-plan.v1",
        parentTurnId: "run-scheduler-1",
        planOrdinal: expect.any(Number),
        heartbeatOrdinal: expect.any(Number),
        canDispatch: true,
        dispatchReason: "ready",
        maxDispatchableCount: 1,
        dispatchableSubagentIds: ["delegate_scheduler_gamma_ready"],
        dispatchBatches: [
          expect.objectContaining({
            parallelBatch: 0,
            subagentIds: ["delegate_scheduler_gamma_ready"],
            workerIds: ["worker-gamma-ready"],
            writeSets: [
              {
                subagentId: "delegate_scheduler_gamma_ready",
                writeSet: ["src/gamma.ts"],
                writeSetSource: "explicit",
              },
            ],
          }),
        ],
        blockedSubagentIds: ["delegate_scheduler_alpha_followup"],
        runningSubagentIds: ["delegate_scheduler_alpha_running"],
      },
      subagentSchedulerTick: {
        schemaId: "hotflow.agent-os.subagent-scheduler-tick.v1",
        sessionId: "run-scheduler-1",
        latestTurnId: null,
        claimDryRun: true,
        dispatchIntents: [
          {
            intentId: "dispatch_delegate_scheduler_gamma_ready",
            delegationId: "delegate_scheduler_gamma_ready",
            workerId: "worker-gamma-ready",
            command: "run-delegation",
            argv: [
              "run-delegation",
              "--session-id",
              "run-scheduler-1",
              "--worker-id",
              "worker-gamma-ready",
              "--delegation-id",
              "delegate_scheduler_gamma_ready",
            ],
            parallelBatch: 0,
            writeSet: ["src/gamma.ts"],
            writeSetSource: "explicit",
          },
        ],
        dispatchPlan: expect.objectContaining({
          schemaId: "hotflow.agent-os.subagent-scheduler-dispatch-plan.v1",
          parentTurnId: "run-scheduler-1",
          canDispatch: true,
          maxDispatchableCount: 1,
          dispatchableSubagentIds: ["delegate_scheduler_gamma_ready"],
        }),
      },
      subagentSchedulerRecoveryPlan: {
        schemaId: "hotflow.agent-os.subagent-scheduler-recovery-plan.v1",
        parentTurnId: "run-scheduler-1",
        canRecover: true,
        blockedSubagentIds: ["delegate_scheduler_alpha_followup"],
        conflictedSubagentIds: [
          "delegate_scheduler_alpha_running",
          "delegate_scheduler_alpha_followup",
        ],
        recoveryActions: [
          expect.objectContaining({
            actionId: "recover_delegate_scheduler_alpha_running_write_set_overlap",
            subagentId: "delegate_scheduler_alpha_running",
            actionType: "wait-for-running-subagent",
            severity: "info",
            reason: "write-set-overlap: src/alpha.ts",
            relatedSubagentIds: ["delegate_scheduler_alpha_followup"],
            writeSet: ["src/alpha.ts"],
          }),
          expect.objectContaining({
            actionId: "recover_delegate_scheduler_alpha_followup_write_set_overlap",
            subagentId: "delegate_scheduler_alpha_followup",
            actionType: "wait-for-running-subagent",
            severity: "info",
            reason: "write-set-overlap: src/alpha.ts",
            relatedSubagentIds: ["delegate_scheduler_alpha_running"],
            writeSet: ["src/alpha.ts"],
          }),
        ],
        recoveryGroups: [
          expect.objectContaining({
            groupId: "recovery_group_write_set_overlap_src_alpha_ts",
            groupType: "write-set-overlap",
            severity: "info",
            reason: "write-set-overlap: src/alpha.ts",
            actionIds: [
              "recover_delegate_scheduler_alpha_running_write_set_overlap",
              "recover_delegate_scheduler_alpha_followup_write_set_overlap",
            ],
            subagentIds: [
              "delegate_scheduler_alpha_running",
              "delegate_scheduler_alpha_followup",
            ],
            runningSubagentIds: ["delegate_scheduler_alpha_running"],
            blockedSubagentIds: ["delegate_scheduler_alpha_followup"],
            completedSubagentIds: [],
            writeSet: ["src/alpha.ts"],
          }),
        ],
        recoveryOrdinal: expect.any(Number),
      },
      subagentRuns: [
        expect.objectContaining({
          subagentId: "delegate_scheduler_alpha_running",
          scheduling: expect.objectContaining({
            parallelGroup: "implementation",
            writeSet: ["src/alpha.ts"],
            writeSetSource: "explicit",
            parallelBatch: 0,
            scheduleOrder: 0,
            readyToStart: true,
            blockedBy: [],
          }),
        }),
        expect.objectContaining({
          subagentId: "delegate_scheduler_beta",
          observedWriteSet: ["src/beta.ts", "src/beta.test.ts"],
          observedWriteSetSource: "patch",
          parentVisibleResult: expect.objectContaining({
            observedWriteSet: ["src/beta.ts", "src/beta.test.ts"],
            observedWriteSetSource: "patch",
          }),
        }),
        expect.objectContaining({
          subagentId: "delegate_scheduler_gamma_ready",
          scheduling: expect.objectContaining({
            parallelGroup: "implementation",
            writeSet: ["src/gamma.ts"],
            writeSetSource: "explicit",
            parallelBatch: 0,
            scheduleOrder: expect.any(Number),
            readyToStart: true,
            blockedBy: [],
          }),
        }),
        expect.objectContaining({
          subagentId: "delegate_scheduler_alpha_followup",
          scheduling: expect.objectContaining({
            parallelGroup: "implementation",
            writeSet: ["src/alpha.ts"],
            writeSetSource: "explicit",
            parallelBatch: 1,
            scheduleOrder: expect.any(Number),
            readyToStart: false,
            blockedBy: ["delegate_scheduler_alpha_running"],
          }),
        }),
      ],
    });
    expect(result.events[0]).toMatchObject({
      title: "运行协作状态",
      body: expect.stringContaining("可并发 1 个"),
    });
    expect(result.events[0].body).toContain("排队等待 1 个");
    expect(result.events[0].body).toContain("计划可派发 1 个");
    expect(result.events[0].body).toContain("调度意图 1 个");
    expect(result.events[0].body).toContain("恢复建议 2 个");
  });

  it("turns a reviewed failed run report into a failure lesson experience candidate", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-run-lesson-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    await writeExecutionRunFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_CREATE_FROM_RUN_REPORT,
      runId: "run-review-1",
      intent: "failure-lesson",
      now: "2026-04-25T10:04:00.000Z",
    });
    const inspection = await directorKnowledge.inspectDirectorExperienceCandidates(workspaceRoot);

    expect(result.events[0]).toMatchObject({
      title: "失败教训已生成",
    });
    expect(result.snapshot.candidate.count).toBe(1);
    expect(inspection.candidates[0]?.candidate).toMatchObject({
      title: "Failure lesson: Make a production clip",
      tags: expect.arrayContaining([
        "source:director-run",
        "run-output",
        "failure-lesson",
        "negative-experience",
        "status:failed",
      ]),
    });
    expect(inspection.candidates[0]?.status).toBe("pending");
  });

  it("reflects a reviewed failed run and writes a failure lesson candidate", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-run-reflection-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    await writeExecutionRunFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUN_REFLECT,
      runId: "run-review-1",
      now: "2026-04-25T10:05:00.000Z",
    });
    const inspection = await directorKnowledge.inspectDirectorExperienceCandidates(workspaceRoot);

    expect(result.events[0]).toMatchObject({
      title: "运行复盘已生成",
    });
    expect(result.reflectionResult).toMatchObject({
      outcome: "failure",
      suggestedExperienceIntent: "failure-lesson",
      recommendedCandidateStatus: "candidate",
      positiveBlocked: true,
      soulCandidateStatus: "pending",
      soulWriteStatus: "ok",
    });
    expect(result.reflectionResult.soulCandidateId).toMatch(/^soul_reflection_run-review-1_/u);
    expect(inspection.candidates[0]?.candidate.tags).toEqual(
      expect.arrayContaining(["failure-lesson", "negative-experience"]),
    );
  });

  it("routes run output experience and reflection through Host API when configured", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-host-api-run-learning-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    const calls = [];
    const createDirectorExperienceFromRunReportStructured = vi.fn();
    const createDirectorExperienceFromTraceProposalStructured = vi.fn();
    const createDirectorReflectionFromRunReportStructured = vi.fn();
    const hostApiFetch = vi.fn(async (url, init = {}) => {
      const path = new URL(url).pathname;
      calls.push({
        path,
        method: init.method,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (path === "/v1/runs/run-review-1/experience") {
        return jsonResponse(createHostApiRunExperienceFixture());
      }
      if (path === "/v1/runs/run-review-1/reflection") {
        return jsonResponse(createHostApiRunReflectionFixture());
      }
      if (path === "/v1/trace-proposals/proposal-review-1/experience") {
        return jsonResponse(createHostApiRunExperienceFixture());
      }
      if (path === "/v1/catalog") {
        return jsonResponse(createEmptyHostApiCatalogFixture());
      }
      throw new Error(`unexpected Host API path ${path}`);
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          createDirectorExperienceFromRunReportStructured,
          createDirectorExperienceFromTraceProposalStructured,
          createDirectorReflectionFromRunReportStructured,
        }),
        hostApiUrl: "http://127.0.0.1:3201",
        hostApiFetch,
      }),
    });

    const lesson = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_CREATE_FROM_RUN_REPORT,
      runId: "run-review-1",
      intent: "failure-lesson",
      now: "2026-04-25T10:04:00.000Z",
    });
    const reflection = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUN_REFLECT,
      runId: "run-review-1",
      now: "2026-04-25T10:05:00.000Z",
    });
    const trace = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_CREATE_FROM_TRACE_PROPOSAL,
      proposalId: "proposal-review-1",
      intent: "failure-lesson",
      now: "2026-04-25T10:06:00.000Z",
    });

    expect(createDirectorExperienceFromRunReportStructured).not.toHaveBeenCalled();
    expect(createDirectorExperienceFromTraceProposalStructured).not.toHaveBeenCalled();
    expect(createDirectorReflectionFromRunReportStructured).not.toHaveBeenCalled();
    const writeCalls = withoutCatalogCalls(calls);
    expect(writeCalls.map((call) => `${call.method}:${call.path}`)).toEqual([
      "POST:/v1/runs/run-review-1/experience",
      "POST:/v1/runs/run-review-1/reflection",
      "POST:/v1/trace-proposals/proposal-review-1/experience",
    ]);
    expect(writeCalls[0].body).toMatchObject({
      intent: "failure-lesson",
      privacy: "confidential",
      now: "2026-04-25T10:04:00.000Z",
    });
    expect(writeCalls[1].body).toMatchObject({
      privacy: "confidential",
      writeExperienceCandidate: true,
      writeSoulCandidate: true,
      now: "2026-04-25T10:05:00.000Z",
    });
    expect(writeCalls[2].body).toMatchObject({
      intent: "failure-lesson",
      privacy: "confidential",
      now: "2026-04-25T10:06:00.000Z",
    });
    expect(lesson.events[0]).toMatchObject({
      title: "失败教训已生成",
    });
    expect(trace.events[0]).toMatchObject({
      title: "失败教训已生成",
    });
    expect(reflection.events[0]).toMatchObject({
      title: "运行复盘已生成",
    });
    expect(reflection.reflectionResult).toMatchObject({
      outcome: "failure",
      recommendedCandidateStatus: "candidate",
      soulCandidateStatus: "pending",
    });
  });

  it("reviews Soul candidates from the desktop bridge without bypassing the Soul gate", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-soul-review-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    await writeExecutionRunFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const reflection = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUN_REFLECT,
      runId: "run-review-1",
      now: "2026-04-25T10:05:00.000Z",
    });
    const candidateId = reflection.reflectionResult.soulCandidateId;
    const listed = await bridge.invoke({ type: DESKTOP_ACTIONS.SOUL_LIST });
    const explained = await bridge.invoke({
      type: DESKTOP_ACTIONS.SOUL_EXPLAIN,
      candidateId,
    });
    const beforeAccept = await bridge.invoke({ type: DESKTOP_ACTIONS.SOUL_VIEW });
    const accepted = await bridge.invoke({
      type: DESKTOP_ACTIONS.SOUL_ACCEPT,
      candidateId,
      note: "operator reviewed",
      now: "2026-04-25T10:06:00.000Z",
    });
    const soulMarkdown = readFileSync(
      join(workspaceRoot, ".director-angel", "soul", "SOUL.md"),
      "utf8",
    );

    expect(listed.commandResult.stdout).toContain(candidateId);
    expect(explained.commandResult.stdout).toContain("Director Soul candidate:");
    expect(beforeAccept.commandResult.stdout).toContain("status: empty");
    expect(accepted.events[0]).toMatchObject({
      title: "Soul 审查已通过",
    });
    expect(accepted.commandResult.stdout).toContain("decision: accepted");
    expect(soulMarkdown).toContain("# Director Angel Soul");
    expect(soulMarkdown).toContain(candidateId);
  });

  it("rejects Soul candidates from the desktop bridge without publishing Soul", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-soul-reject-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    await writeExecutionRunFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const reflection = await bridge.invoke({
      type: DESKTOP_ACTIONS.RUN_REFLECT,
      runId: "run-review-1",
      now: "2026-04-25T10:05:00.000Z",
    });
    const candidateId = reflection.reflectionResult.soulCandidateId;
    const rejected = await bridge.invoke({
      type: DESKTOP_ACTIONS.SOUL_REJECT,
      candidateId,
      note: "too broad",
      now: "2026-04-25T10:06:00.000Z",
    });
    const viewed = await bridge.invoke({ type: DESKTOP_ACTIONS.SOUL_VIEW });
    const candidate = JSON.parse(
      readFileSync(
        join(workspaceRoot, ".director-angel", "soul", "candidates", `${candidateId}.json`),
        "utf8",
      ),
    );

    expect(rejected.events[0]).toMatchObject({
      title: "Soul 审查已拒绝",
    });
    expect(rejected.commandResult.stdout).toContain("decision: rejected");
    expect(candidate.status).toBe("rejected");
    expect(viewed.commandResult.stdout).toContain("status: empty");
    expect(() =>
      readFileSync(join(workspaceRoot, ".director-angel", "soul", "SOUL.md"), "utf8"),
    ).toThrow(/ENOENT/u);
  });

  it("routes Soul review controls through Host API when configured", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-host-api-soul-"));
    tempRoots.push(workspaceRoot);
    const calls = [];
    const listDirectorSoulCandidates = vi.fn();
    const explainDirectorSoulCandidate = vi.fn();
    const acceptDirectorSoulCandidate = vi.fn();
    const rejectDirectorSoulCandidate = vi.fn();
    const viewDirectorSoul = vi.fn();
    const hostApiFetch = vi.fn(async (url, init = {}) => {
      const path = new URL(url).pathname;
      calls.push({
        path,
        method: init.method,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (path === "/v1/soul/candidates") {
        return jsonResponse({
          text: "Director Soul candidates:\n  total: 1\n  - soul-1 status=pending risk=medium source=run-1",
          candidates: [{ candidateId: "soul-1", status: "pending", riskLevel: "medium" }],
        });
      }
      if (path === "/v1/soul/candidates/soul-1") {
        return jsonResponse({
          text: "Director Soul candidate:\n  candidate id: soul-1\n  status: pending",
          candidate: { candidateId: "soul-1", status: "pending" },
        });
      }
      if (path === "/v1/soul") {
        return jsonResponse({
          text: "Director Soul:\n  status: empty\n  SOUL.md: (not created)",
          soul: null,
          markdown: null,
        });
      }
      if (path === "/v1/soul/candidates/soul-1/accept") {
        return jsonResponse({
          text: "Director Soul decision:\n  candidate id: soul-1\n  decision: accepted",
          candidate: { candidateId: "soul-1", status: "accepted" },
          decision: { decision: "accepted" },
        });
      }
      if (path === "/v1/soul/candidates/soul-2/reject") {
        return jsonResponse({
          text: "Director Soul decision:\n  candidate id: soul-2\n  decision: rejected",
          candidate: { candidateId: "soul-2", status: "rejected" },
          decision: { decision: "rejected" },
        });
      }
      if (path === "/v1/catalog") {
        return jsonResponse(createEmptyHostApiCatalogFixture());
      }
      throw new Error(`unexpected Host API path ${path}`);
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({
          listDirectorSoulCandidates,
          explainDirectorSoulCandidate,
          acceptDirectorSoulCandidate,
          rejectDirectorSoulCandidate,
          viewDirectorSoul,
        }),
        hostApiUrl: "http://127.0.0.1:3201",
        hostApiFetch,
      }),
    });

    const listed = await bridge.invoke({ type: DESKTOP_ACTIONS.SOUL_LIST });
    const explained = await bridge.invoke({
      type: DESKTOP_ACTIONS.SOUL_EXPLAIN,
      candidateId: "soul-1",
    });
    const viewed = await bridge.invoke({ type: DESKTOP_ACTIONS.SOUL_VIEW });
    const accepted = await bridge.invoke({
      type: DESKTOP_ACTIONS.SOUL_ACCEPT,
      candidateId: "soul-1",
      note: "operator reviewed",
      now: "2026-04-25T10:06:00.000Z",
    });
    const rejected = await bridge.invoke({
      type: DESKTOP_ACTIONS.SOUL_REJECT,
      candidateId: "soul-2",
      note: "too broad",
      now: "2026-04-25T10:07:00.000Z",
    });

    expect(listDirectorSoulCandidates).not.toHaveBeenCalled();
    expect(explainDirectorSoulCandidate).not.toHaveBeenCalled();
    expect(acceptDirectorSoulCandidate).not.toHaveBeenCalled();
    expect(rejectDirectorSoulCandidate).not.toHaveBeenCalled();
    expect(viewDirectorSoul).not.toHaveBeenCalled();
    const writeCalls = withoutCatalogCalls(calls);
    expect(writeCalls.map((call) => `${call.method}:${call.path}`)).toEqual([
      "GET:/v1/soul/candidates",
      "GET:/v1/soul/candidates/soul-1",
      "GET:/v1/soul",
      "POST:/v1/soul/candidates/soul-1/accept",
      "POST:/v1/soul/candidates/soul-2/reject",
    ]);
    expect(writeCalls[3].body).toMatchObject({
      actor: "director-desktop",
      note: "operator reviewed",
      now: "2026-04-25T10:06:00.000Z",
    });
    expect(listed.commandResult.stdout).toContain("soul-1");
    expect(explained.commandResult.stdout).toContain("candidate id: soul-1");
    expect(viewed.commandResult.stdout).toContain("status: empty");
    expect(accepted.commandResult.stdout).toContain("decision: accepted");
    expect(rejected.commandResult.stdout).toContain("decision: rejected");
  });

  it("routes heartbeat status through Host API when configured", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-host-api-heartbeat-"));
    tempRoots.push(workspaceRoot);
    const calls = [];
    const runDirectorHeartbeat = vi.fn();
    const hostApiFetch = vi.fn(async (url, init = {}) => {
      const path = new URL(url).pathname;
      calls.push({
        path,
        method: init.method,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (path === "/v1/heartbeat/status") {
        return jsonResponse({
          text: [
            "Director heartbeat:",
            "  heartbeat enabled: no",
            "  event count: 1",
            "  - heartbeat_failed-run_hostapi kind=failed-run severity=warn",
          ].join("\n"),
          snapshot: {
            schemaVersion: "director.heartbeat.snapshot.v1",
            eventCount: 1,
            highestSeverity: "warn",
          },
        });
      }
      if (path === "/v1/catalog") {
        return jsonResponse(createEmptyHostApiCatalogFixture());
      }
      throw new Error(`unexpected Host API path ${path}`);
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture({ runDirectorHeartbeat }),
        hostApiUrl: "http://127.0.0.1:3201",
        hostApiFetch,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.HEARTBEAT_STATUS,
      now: "2026-04-28T06:00:00.000Z",
    });

    expect(runDirectorHeartbeat).not.toHaveBeenCalled();
    const writeCalls = withoutCatalogCalls(calls);
    expect(writeCalls).toEqual([
      {
        path: "/v1/heartbeat/status",
        method: "POST",
        body: { now: "2026-04-28T06:00:00.000Z" },
      },
    ]);
    expect(result.commandResult.stdout).toContain("kind=failed-run");
    expect(result.events[0]).toMatchObject({
      title: "心跳扫描完成",
    });
  });

  it("previews and applies maintenance through Host API when configured", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-host-api-maintenance-"));
    tempRoots.push(workspaceRoot);
    const calls = [];
    const hostApiFetch = vi.fn(async (url, init = {}) => {
      const parsed = new URL(url);
      calls.push({
        path: parsed.pathname,
        search: parsed.search,
        method: init.method,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (parsed.pathname === "/v1/maintenance") {
        return jsonResponse(
          createHostApiMaintenanceFixture(init.method === "POST" ? "apply" : "preview"),
        );
      }
      if (parsed.pathname === "/v1/catalog") {
        return jsonResponse(createEmptyHostApiCatalogFixture());
      }
      throw new Error(`unexpected Host API path ${parsed.pathname}`);
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: createSnapshotKnowledgeFixture(),
        hostApiUrl: "http://127.0.0.1:3201",
        hostApiFetch,
      }),
    });

    const preview = await bridge.invoke({
      type: DESKTOP_ACTIONS.MAINTENANCE_PREVIEW,
      logRetentionDays: 7,
    });
    const apply = await bridge.invoke({
      type: DESKTOP_ACTIONS.MAINTENANCE_APPLY,
      logRetentionDays: 7,
    });

    expect(withoutCatalogCalls(calls)).toEqual([
      {
        path: "/v1/maintenance",
        search: "?logRetentionDays=7",
        method: "GET",
        body: undefined,
      },
      {
        path: "/v1/maintenance",
        search: "",
        method: "POST",
        body: { policy: { logRetentionDays: 7 } },
      },
    ]);
    expect(preview.events[0]).toMatchObject({
      title: "维护预览",
      body: expect.stringContaining("日志：扫描 2 个，归档 1 个"),
    });
    expect(apply.events[0]).toMatchObject({
      title: "维护已执行",
      body: expect.stringContaining("审计：/tmp/maintenance.json"),
    });
  });

  it("archives old logs and rejected experience from local desktop maintenance only after apply", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-maintenance-"));
    tempRoots.push(workspaceRoot);
    const runtimeRoot = join(workspaceRoot, ".director-angel", "runtime");
    const logsDir = join(runtimeRoot, "logs");
    mkdirSync(logsDir, { recursive: true });
    const oldLog = join(logsDir, "weixin-gateway.out.log");
    writeFileSync(oldLog, "old gateway log\n", "utf8");
    const oldLogDate = new Date("2026-04-01T00:00:00.000Z");
    utimesSync(oldLog, oldLogDate, oldLogDate);

    const experienceDir = join(workspaceRoot, ".director-angel", "knowledge", "experience");
    const store = new FileExperienceStore({ experienceDir });
    const rejected = createMaintenanceExperienceCandidate("archive_rejected", {
      createdAtMs: Date.parse("2026-04-01T00:00:00.000Z"),
      sourceDigest: "digest:rejected",
      score: 72,
    });
    await store.writeCandidate(rejected);
    await store.writeReviewDecision({
      schemaVersion: "contracts.v1",
      decisionId: "review_rejected",
      candidateId: rejected.candidateId,
      gate: "human",
      decision: "rejected",
      decidedAtMs: Date.parse("2026-04-02T00:00:00.000Z"),
    });

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const preview = await bridge.invoke({
      type: DESKTOP_ACTIONS.MAINTENANCE_PREVIEW,
      nowMs: Date.parse("2026-05-03T00:00:00.000Z"),
      logRetentionDays: 7,
      archiveRejectedExperienceAfterDays: 7,
    });

    expect(preview.maintenanceReport.mode).toBe("preview");
    expect(preview.maintenanceReport.logMaintenance.actions[0]).toMatchObject({
      sourcePath: oldLog,
      status: "preview",
    });
    expect(preview.maintenanceReport.experienceMaintenance.actions[0]).toMatchObject({
      candidateId: rejected.candidateId,
      reason: "latest-review-rejected",
      status: "preview",
    });
    expect(existsSync(oldLog)).toBe(true);
    expect((await store.listCandidates()).map((candidate) => candidate.candidateId)).toEqual([
      rejected.candidateId,
    ]);

    const applied = await bridge.invoke({
      type: DESKTOP_ACTIONS.MAINTENANCE_APPLY,
      nowMs: Date.parse("2026-05-03T00:00:00.000Z"),
      logRetentionDays: 7,
      archiveRejectedExperienceAfterDays: 7,
    });

    expect(applied.maintenanceReport.mode).toBe("apply");
    expect(applied.events[0]).toMatchObject({
      title: "维护已执行",
      body: expect.stringContaining("候选归档 1 条"),
    });
    expect(existsSync(oldLog)).toBe(false);
    expect((await store.listCandidates()).map((candidate) => candidate.candidateId)).toEqual([]);
    expect(existsSync(applied.maintenanceReport.auditPath)).toBe(true);
  });

  it("runs heartbeat status from the desktop bridge and writes review-gated heartbeat artifacts", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-heartbeat-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    writeAdapterRegistryFixture(workspaceRoot);
    await writeExecutionRunFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.HEARTBEAT_STATUS,
      now: "2026-04-28T06:00:00.000Z",
    });
    const latest = JSON.parse(
      readFileSync(join(workspaceRoot, ".director-angel", "heartbeat", "latest.json"), "utf8"),
    );

    expect(result.events[0]).toMatchObject({
      title: "心跳扫描完成",
    });
    expect(result.commandResult.stdout).toContain("Director heartbeat:");
    expect(result.commandResult.stdout).toContain("kind=failed-run");
    expect(result.commandResult.stdout).toContain("kind=reflection-due");
    expect(result.commandResult.stdout).toContain("kind=adapter-risk");
    expect(latest).toMatchObject({
      schemaVersion: "director.heartbeat.snapshot.v1",
      eventCount: expect.any(Number),
    });
    expect(result.snapshot.assets.review).toMatchObject({
      heartbeatStatus: "ok",
      heartbeatEventCount: latest.eventCount,
      heartbeatHighestSeverity: latest.highestSeverity,
    });
    expect(result.snapshot.assets.review.heartbeatItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "failed-run",
          severity: "warn",
          actionRefs: expect.arrayContaining([expect.stringContaining("run-")]),
          target: expect.objectContaining({
            kind: "run-report",
            runId: "run-review-1",
            reportId: "report-review-1",
          }),
        }),
        expect.objectContaining({
          kind: "reflection-due",
          severity: "warn",
          target: expect.objectContaining({
            kind: "run-report",
            runId: "run-review-1",
          }),
        }),
        expect.objectContaining({
          kind: "adapter-risk",
          severity: "warn",
          actionRefs: expect.arrayContaining([
            "hotflow director adapters explain --adapter-id external-cli",
            "hotflow director switches show",
          ]),
          target: expect.objectContaining({
            kind: "adapter",
            adapterId: "external-cli",
          }),
        }),
      ]),
    );
    const adapterRisk = result.snapshot.assets.review.heartbeatItems.find(
      (item) => item.kind === "adapter-risk",
    );
    expect(adapterRisk.actionRefs.join("\n")).not.toMatch(/\b(run|once|start|resume|retry)\b/u);
  });

  it("runs background heartbeat without hijacking the visible result panel", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-heartbeat-background-"));
    tempRoots.push(workspaceRoot);
    writeLearningSwitchFixture(workspaceRoot, true);
    await writeExecutionRunFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.HEARTBEAT_STATUS,
      background: true,
      now: "2026-04-28T06:05:00.000Z",
    });

    expect(result.commandResult).toBeUndefined();
    expect(result.events).toBeUndefined();
    expect(result.snapshot.activePanel).toBeNull();
    expect(result.snapshot.assets.review).toMatchObject({
      heartbeatStatus: "ok",
      heartbeatEventCount: expect.any(Number),
    });
  });

  it("runs background daily self-reflection without hijacking the visible result panel", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "director-desktop-daily-reflection-background-"),
    );
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "heartbeat.enabled": true,
      "selfReflection.enabled": true,
    });
    await writeExecutionRunFixture(workspaceRoot);

    const bridge = createDirectorDesktopBridgeFacade({
      handlers: createDirectorDesktopSystemHandlers({
        workspaceRoot,
        knowledge: directorKnowledge,
      }),
    });

    const result = await bridge.invoke({
      type: DESKTOP_ACTIONS.SELF_REFLECTION_DAILY,
      background: true,
      date: "2026-04-28",
      now: "2026-04-28T06:05:00.000Z",
    });
    const reportPath = join(
      workspaceRoot,
      ".director-angel",
      "knowledge",
      "reflection",
      "daily",
      "2026-04-28.json",
    );

    expect(result.commandResult).toBeUndefined();
    expect(result.events).toBeUndefined();
    expect(result.snapshot.activePanel).toBeNull();
    expect(result.selfReflectionReport).toMatchObject({
      schemaVersion: "director.self-reflection.daily-report.v1",
      window: {
        date: "2026-04-28",
      },
      reviewRequired: true,
      proposals: expect.arrayContaining([
        expect.objectContaining({
          reviewRequired: true,
          evidenceRefs: expect.any(Array),
        }),
      ]),
    });
    expect(existsSync(reportPath)).toBe(true);
  });
});

function writeKnowledgeRecallSwitchFixture(workspaceRoot, enabled) {
  writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
    "knowledgeRecall.enabled": enabled,
  });
}

function writeLearningSwitchFixture(workspaceRoot, enabled) {
  writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
    "learning.enabled": enabled,
  });
}

function writeRuntimeFeatureSwitchesFixture(workspaceRoot, features) {
  const runtimeRoot = join(workspaceRoot, ".director-angel", "runtime");
  mkdirSync(runtimeRoot, { recursive: true });
  writeFileSync(
    join(runtimeRoot, "switches.json"),
    JSON.stringify({
      schemaId: "director.switches.v1",
      features,
    }),
    "utf8",
  );
}

function writeOpenCliManifestFixture(workspaceRoot, entries) {
  const openCliDir = join(workspaceRoot, "参考仓库", "OpenCLI");
  mkdirSync(openCliDir, { recursive: true });
  writeFileSync(join(openCliDir, "cli-manifest.json"), JSON.stringify(entries), "utf8");
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function textResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return body;
    },
  };
}

function restoreOptionalEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

async function startFakeDesktopMcpOAuthServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      const origin = `http://${request.headers.host}`;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        }),
      );
      return;
    }
    if (url.pathname === "/register") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          client_id: "director-desktop-test-client",
          redirect_uris: [],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      );
      return;
    }
    if (url.pathname === "/token" && request.method === "POST") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const form = new URLSearchParams(body);
        const code = form.get("code") ?? "missing";
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            access_token: `access-token-${code}`,
            refresh_token: `refresh-token-${code}`,
            token_type: "Bearer",
            expires_in: 3600,
          }),
        );
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("fake OAuth server did not bind a TCP port");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function configureFakeApiProvider(bridge) {
  await bridge.invoke({
    type: DESKTOP_ACTIONS.API_PROVIDER_SET,
    providerId: "memefast-api",
    key: "apiKey",
    value: "sk-comfyui-secret",
  });
  await bridge.invoke({
    type: DESKTOP_ACTIONS.API_PROVIDER_SET,
    providerId: "memefast-api",
    key: "baseUrl",
    value: "https://proxy.example.test",
  });
}

function fakeApiProviderTextResponse(content, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Internal Server Error",
    async text() {
      return JSON.stringify({
        choices: [
          {
            message: {
              content,
            },
          },
        ],
      });
    },
  };
}

function fakeApiProviderToolCallsResponse(toolCalls, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Internal Server Error",
    async text() {
      return JSON.stringify({
        choices: [
          {
            message: {
              content: "",
              tool_calls: toolCalls.map((call, index) => ({
                id: call.id ?? `tool-call-${index}`,
                type: "function",
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.args ?? {}),
                },
              })),
            },
          },
        ],
      });
    },
  };
}

function fakeLearningEvidenceAwareProviderResponse(init, answer) {
  const body = JSON.parse(String(init.body));
  const toolMessage = Array.isArray(body.messages)
    ? body.messages.findLast((message) => message?.role === "tool")
    : undefined;
  if (
    typeof toolMessage?.content === "string" &&
    toolMessage.content.includes("<learning-evidence-context>")
  ) {
    return fakeApiProviderTextResponse(answer);
  }
  return fakeApiProviderToolCallsResponse([
    {
      id: "call-list-candidates",
      name: "director.experience.candidates.list",
      args: { status: "pending", maxItems: 3 },
    },
  ]);
}

function assertNoComfyUiLocalBusinessDraft(value) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain("脚本草案");
  expect(serialized).not.toContain("文案草案");
  expect(serialized).not.toContain("图片生成参数草案");
  expect(serialized).not.toContain("视频生成参数草案");
  expect(serialized).not.toContain("director-angel-local");
}

async function startHttpJsonBridgeServer(handler) {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch((error) => {
      response.writeHead(500, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function createHostApiMaintenanceFixture(mode) {
  return {
    apiVersion: "director-host-api.v1",
    schemaId: "director.host.maintenance.v1",
    reportSchemaId: "director.maintenance.report.v1",
    generatedAt: "2026-05-03T00:00:00.000Z",
    mode,
    auditPath: "/tmp/maintenance.json",
    logMaintenance: {
      logsDir: "/tmp/runtime/logs",
      summary: {
        scannedFiles: 2,
        archiveFiles: 1,
        archiveBytes: 12,
      },
      actions: [],
    },
    experienceMaintenance: {
      experienceDir: "/tmp/knowledge/experience",
      summary: {
        activeCandidates: 3,
        archiveCandidates: 1,
        archiveQuarantines: 1,
        archiveArtifacts: 1,
        duplicateGroups: 1,
      },
      actions: [],
    },
  };
}

function withoutCatalogCalls(calls) {
  return calls.filter((call) => call.path !== "/v1/catalog");
}

function createEmptyHostApiCatalogFixture() {
  return {
    apiVersion: "director-host-api.v1",
    schemaId: "director.host.catalog.v1",
    knowledgePacks: [],
    knowledgeCandidates: [],
    knowledgeCandidateInspections: [],
    experienceCandidates: [],
    experienceCandidateInspections: [],
    experienceArtifacts: [],
    experienceQuarantines: [],
    experienceTaxonomy: {
      schemaVersion: "director.experience.taxonomy.v1",
      categories: [],
      tags: [],
      candidates: [],
    },
    skills: [],
    skillTaxonomy: {
      schemaVersion: "skills.taxonomy.v1",
      categories: [],
      tags: [],
      skills: [],
    },
    skillProposals: [],
  };
}

function createHostApiBlueprintFixture() {
  return {
    blueprintId: "blueprint-desktop-host-api-1",
    snapshotId: "snapshot-desktop-host-api-1",
    runtimeId: "director-host-api",
    review: {
      overallDecision: "warn",
      blockingReasons: [],
      requiredFixes: [],
    },
    preview: {
      summary: "Host API 生成了可审查的三镜头蓝图。",
      warnings: [],
      blockedReasons: [],
      requiredApprovals: ["script-planner:assignment-script"],
    },
    actionGraph: {
      graphId: "graph-desktop-host-api-1",
      blueprintId: "blueprint-desktop-host-api-1",
      goal: "生成一个15秒短剧分镜蓝图",
      stopConditions: [
        "recall=hit",
        "published-knowledge=hit",
        "long-term-memory=hit",
        "skills=hit",
        "recall-hit=memory-host-api-1:completed:18.00",
        "published-pack=pack-host-api-1:16.00",
        "long-term-signal=long-term-memory:memory",
        "skill-hit=skill.host-api",
      ],
      nodes: [
        {
          assignmentId: "assignment-script",
          role: "script-planner",
          objective: "Plan the script.",
          deliverable: "Story outline",
          actionClass: "generate",
          approvalMode: "operator_approve",
          inputs: ["Recall continuity brief"],
          outputs: ["outline"],
          acceptanceCriteria: ["Uses recalled knowledge"],
          constraints: [
            {
              field: "knowledge",
              requirement: "Use pack-host-api-1",
              priority: "preferred",
            },
          ],
          dependsOn: [],
          allowedAdapters: ["director-core.internal"],
          selectedAdapter: "director-core.internal",
        },
      ],
      edges: [],
    },
    handoff: {
      handoffId: "handoff-desktop-host-api-1",
      blueprintId: "blueprint-desktop-host-api-1",
      createdAt: "2026-04-25T10:00:00.000Z",
      alignmentLockId: "alignment-lock-desktop-host-api-1",
      actionGraphId: "graph-desktop-host-api-1",
      previewSummary: "Host API 生成了可审查的三镜头蓝图。",
      capabilityMatches: [
        {
          matchId: "match-script",
          assignmentId: "assignment-script",
          status: "matched",
          chosenAdapterId: "director-core.internal",
          reasons: ["Selected adapter director-core.internal."],
        },
      ],
      mediaRequests: [],
      expectedArtifacts: [],
      chosenAdapters: ["director-core.internal"],
      sideEffectsAllowed: false,
      notes: ["published-pack=pack-host-api-1:16.00", "skill-hit=skill.host-api"],
    },
  };
}

function createHostApiRunFixture(status) {
  return {
    schemaVersion: "director.execution.run.v1",
    runId: "run-desktop-host-api-1",
    snapshotId: "snapshot-desktop-host-api-1",
    runtimeId: "director-host-api",
    blueprintId: "blueprint-desktop-host-api-1",
    handoffId: "handoff-desktop-host-api-1",
    actionGraphId: "graph-desktop-host-api-1",
    goal: "生成一个15秒短剧分镜蓝图",
    previewSummary: "Host API 生成了可审查的三镜头蓝图。",
    sideEffectsAllowed: false,
    createdAt: "2026-04-25T10:00:00.000Z",
    updatedAt: "2026-04-25T10:01:00.000Z",
    status,
    assignments: [
      {
        runId: "run-desktop-host-api-1",
        assignmentId: "assignment-script",
        role: "script-planner",
        objective: "Plan the script.",
        deliverable: "Story outline",
        inputs: ["Recall continuity brief"],
        outputs: ["outline"],
        acceptanceCriteria: ["Uses recalled knowledge"],
        constraints: [
          {
            field: "knowledge",
            requirement: "Use pack-host-api-1",
            priority: "preferred",
          },
        ],
        actionClass: "generate",
        approvalMode: "operator_approve",
        dependsOn: [],
        status: "pending",
        selectedAdapter: "director-core.internal",
        allowedAdapters: ["director-core.internal"],
        createdAt: "2026-04-25T10:00:30.000Z",
      },
    ],
    events: [],
    notes: [
      "recall=hit",
      "published-knowledge=hit",
      "long-term-memory=hit",
      "skills=hit",
      "recall-hit=memory-host-api-1:completed:18.00",
      "published-pack=pack-host-api-1:16.00",
      "long-term-signal=long-term-memory:memory",
      "skill-hit=skill.host-api",
    ],
  };
}

function createHostApiReportFixture(status) {
  const run = createHostApiRunFixture(status);
  return {
    reportId: "report-run-desktop-host-api-1",
    runId: run.runId,
    recordedAt: "2026-04-25T10:02:00.000Z",
    run,
    summary: ["Host API run status=running"],
    flags: ["awaiting-approval-or-dependencies"],
    events: [],
    operatorSurface: {
      directorGoal: run.goal,
      operatorSummary: "Host API run is waiting for operator review.",
      objective: "Plan the script.",
      deliverable: "Story outline",
      nextAction: "继续审查或推进。",
    },
  };
}

function createHostApiDelegationsFixture(status = "running") {
  return {
    apiVersion: "director-host-api.v1",
    schemaId: "director.host.run-delegations.v1",
    runId: "run-desktop-host-api-1",
    sessionId: "run-desktop-host-api-1",
    status,
    delegationCount: 1,
    verificationCount: 1,
    notificationCount: 0,
    pendingDelegationCount: 1,
    runningDelegationCount: 0,
    completedDelegationCount: 0,
    failedDelegationCount: 0,
    workerIds: ["director-script-planner"],
    verifierIds: ["director-qc-reviewer"],
    delegations: [
      {
        id: "delegation_run_desktop_host_api_1_assignment_script",
        taskId: "assignment-script",
        workerId: "director-script-planner",
        targetAgent: "script-planner-agent",
        specialization: "plan",
        status: "queued",
        instruction: "Role: script-planner\nObjective: Plan the script.",
        verificationRequest: {
          verifierId: "director-qc-reviewer",
          verificationId: "verification_run_desktop_host_api_1_assignment_script",
          requirement: "Verify script outline.",
        },
      },
    ],
    verification: [
      {
        id: "verification_run_desktop_host_api_1_assignment_script",
        taskId: "assignment-script",
        verifierId: "director-qc-reviewer",
        requirement: "Verify script outline.",
        status: "pending",
      },
    ],
    notifications: [],
    lifecycle: [],
  };
}

function createHostApiRunExperienceFixture() {
  return {
    schemaId: "director.host.run-experience.v1",
    materialized: {
      status: "candidate",
      candidate: {
        candidateId: "experience-run-host-api-1",
        title: "Failure lesson: Make a production clip",
        tags: ["failure-lesson", "negative-experience"],
      },
      admission: {
        sourceQuality: { score: 88 },
        claimQuality: { score: 82 },
      },
    },
    write: {
      status: "ok",
      notes: ["Stored experience candidate experience-run-host-api-1."],
    },
  };
}

function createHostApiRunReflectionFixture() {
  return {
    schemaId: "director.host.run-reflection.v1",
    reflection: {
      reflectionId: "reflection-run-host-api-1",
      sourceId: "run-review-1",
      reportId: "report-review-1",
      outcome: "failure",
      status: "candidate_generated",
      suggestedExperienceIntent: "failure-lesson",
      whatWorked: [],
      whatFailed: ["External CLI bridge timed out."],
      reusableLessons: [],
      failureLessons: ["Retry bridge work only after operator review."],
      nextActions: ["Review failed bridge request."],
    },
    reflectionWrite: {
      status: "ok",
      path: "/tmp/reflection-run-host-api-1.json",
      notes: ["wrote reflection"],
    },
    experience: {
      recommended: {
        intent: "failure-lesson",
        materialized: createHostApiRunExperienceFixture().materialized,
      },
      blockedPositive: {
        status: "quarantined",
      },
    },
    experienceWrite: {
      status: "ok",
      notes: ["Stored experience candidate experience-run-host-api-1."],
    },
    soulCandidate: {
      candidateId: "soul_reflection_run-review-1_hostapi",
      status: "pending",
    },
    soulWrite: {
      status: "ok",
      path: "/tmp/soul_reflection_run-review-1_hostapi.json",
      notes: ["wrote soul candidate"],
    },
  };
}

function writeLongTermMemoryFixture(workspaceRoot) {
  const memoryDir = join(workspaceRoot, ".director-angel", "memory");
  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(
    join(memoryDir, "MEMORY.md"),
    [
      "# MEMORY",
      "",
      "- Keep the protagonist anchor visible in the opening shot.",
      "- Avoid drifting away from the approved 15-second storyboard tone.",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(memoryDir, "USER.md"),
    ["# USER", "", "- Prefers concise Chinese production plans."].join("\n"),
    "utf8",
  );
}

async function writeDirectorMemoryRecordFixture(workspaceRoot, { projectId, groupId }) {
  const recordedAt = "2026-04-25T09:00:00.000Z";
  const store = new FileSystemDirectorMemoryStore({
    rootPath: join(workspaceRoot, ".director-angel", "runtime", "memory"),
    clock: () => "2026-04-25T09:01:00.000Z",
  });
  await store.writeRecord({
    schemaVersion: "director.memory.record.v1",
    recordId: "record-memory-1",
    digestId: "digest-memory-1",
    projectId,
    groupId,
    anchorIds: [],
    selectedAdapters: ["director-desktop-preview-execution"],
    tags: ["short-drama", "storyboard"],
    status: "completed",
    recordedAt,
    digest: {
      schemaVersion: "director.memory.trace-digest.v1",
      digestId: "digest-memory-1",
      runId: "run-memory-1",
      reportId: "report-memory-1",
      snapshotId: "snapshot-memory-1",
      runtimeId: "director-desktop",
      blueprintId: "blueprint-memory-1",
      handoffId: "handoff-memory-1",
      actionGraphId: "graph-memory-1",
      projectId,
      groupId,
      goal: "Previous successful 15s short drama storyboard.",
      previewSummary: "Previous run completed with a compact 3-shot structure.",
      status: "completed",
      roles: ["script-planner", "shot-planner"],
      anchorIds: [],
      selectedAdapters: ["director-desktop-preview-execution"],
      observationRefs: [
        {
          observationId: "observation-memory-1",
          source: "evaluation",
          recordedAt,
        },
      ],
      assignmentStats: {
        total: 2,
        completed: 2,
        failed: 0,
        aborted: 0,
        skipped: 0,
        blocked: 0,
      },
      flags: [],
      eventTypes: ["run-completed"],
      createdAt: "2026-04-25T08:55:00.000Z",
      startedAt: "2026-04-25T08:56:00.000Z",
      completedAt: recordedAt,
      recordedAt,
      generationType: "new",
      generationStyle: "immersive",
      knowledgeSignalTags: ["short-drama", "storyboard"],
    },
  });
}

async function writePublishedProductionKnowledgeFixture(workspaceRoot) {
  await new FileKnowledgeStore({
    knowledgeDir: join(workspaceRoot, ".director-angel", "knowledge"),
  }).publish({
    schemaVersion: "director.knowledge.pack.v1",
    metadata: {
      id: "director-experience-local-constraints",
      title: "Use continuity-safe teaser planning",
      description: "Published desktop lesson for production planning.",
      tags: ["experience", "self-learning", "continuity", "teaser"],
      createdAt: "2026-04-25T09:00:00.000Z",
      version: 1,
    },
    stage: "published",
    method: {
      sourceProposalId: "experience:production-continuity",
      sourceRecordId: "adapter_desktop_lessons",
      sourceDigestId: "sha256:production-continuity",
      projectId: "experience-learning",
      groupId: "local-directory",
      goal: "Use learned production lessons from local files.",
      trigger: "When planning a continuity-safe teaser or short drama.",
      summary: "Keep teaser continuity stable before creating production assets.",
      explanation:
        "Preserve anchor continuity, state missing constraints, and keep production changes reviewable.",
      evidenceSummary: "evidence_1: published desktop production lesson",
      roles: ["researcher", "script-planner"],
      preferredAdapters: [],
      anchorIds: ["evidence_1"],
      generationType: "self-learning",
      generationStyle: "local-directory",
    },
    audit: {
      publishedAt: "2026-04-25T09:01:00.000Z",
      author: "director-desktop-test",
      note: "published for production run recall test",
    },
  });
}

function createSnapshotKnowledgeFixture(overrides = {}) {
  return {
    learnDirectorExperience: async () =>
      [
        "Director experience learn:",
        "  status: ok",
        "  new candidates: 0",
        "  stored candidates: 0",
      ].join("\n"),
    inspectDirectorExperienceCandidates: async () =>
      overrides.experience ?? {
        total: 0,
        candidates: [],
        quarantineCount: 0,
        quarantineItems: [],
      },
    inspectDirectorKnowledgeLane: async () => ({
      enabled: false,
      switchSource: "defaults",
      publishedCount: 0,
      candidateCount: 0,
      reviewQueueCount: 0,
      rollbackCount: 0,
      hasCandidate: false,
      latestPublishedDocument: null,
      latestRollbackRecord: null,
      knowledgeEvolution: {
        enabled: false,
        autoCandidate: false,
        publish: false,
      },
    }),
    inspectDirectorKnowledgeCandidates: async () => ({
      total: 0,
      candidates: [],
    }),
    ...(overrides.learnDirectorExperience === undefined
      ? {}
      : { learnDirectorExperience: overrides.learnDirectorExperience }),
    ...(overrides.updateDirectorExperienceCandidateStructured === undefined
      ? {}
      : {
          updateDirectorExperienceCandidateStructured:
            overrides.updateDirectorExperienceCandidateStructured,
        }),
  };
}

function createExperienceCandidateFixture({
  candidateId,
  title,
  quality,
  evidencePreview,
  createdAtMs = 10_000,
  sourceRef = "https://example.test/lesson",
}) {
  return {
    schemaVersion: "contracts.v1",
    candidateId,
    sourceAdapter: {
      schemaVersion: "contracts.v1",
      adapterId: "web_page_example",
      sourceKind: "web-page",
      sourceRef,
      privacy: "public",
      transformations: [],
    },
    title,
    summary: "Compare source examples and keep learned guidance review-gated.",
    applicability: "Use when reviewing learned Director Angel operating guidance.",
    risks: [],
    tags: ["source:web-page", "evidence"],
    evidence: [
      {
        evidenceId: "evidence-quality-1",
        sourceRef,
        path: "lesson.md",
        span: "L1-L3",
        summary: "Source paragraph with reusable direction.",
        attributes: {
          preview: "Compare source examples, preserve evidence, and keep review gates.",
        },
      },
    ],
    sourceArtifactId: "artifact-quality-1",
    sourceDigest: "digest-quality-1",
    evidencePreview,
    quality,
    status: "candidate",
    privacy: "public",
    runtimeInjection: "disabled",
    provenance: "desktop-test",
    createdAtMs,
  };
}

function createMaintenanceExperienceCandidate(candidateId, input) {
  return {
    schemaVersion: "contracts.v1",
    candidateId,
    sourceAdapter: {
      schemaVersion: "contracts.v1",
      adapterId: "adapter_desktop_maintenance",
      sourceKind: "local-repository",
      sourceRef: "repo://desktop-maintenance",
      privacy: "internal",
      transformations: [
        {
          transformId: "extract-pattern",
          kind: "extract-pattern",
          summary: "Extract reusable maintenance patterns.",
        },
      ],
    },
    title: `Maintenance ${candidateId}`,
    summary: `Reusable maintenance summary for ${candidateId}.`,
    applicability: "Use when keeping the desktop experience queue small.",
    risks: ["Fixture evidence is review-gated."],
    tags: ["maintenance", "desktop"],
    evidence: [
      {
        evidenceId: `evidence_${candidateId}`,
        sourceRef: "repo://desktop-maintenance#docs.md",
        summary: `Evidence for ${candidateId}.`,
      },
    ],
    sourceDigest: input.sourceDigest,
    quality: {
      schemaVersion: "contracts.v1",
      verdict: input.score >= 55 ? "usable" : "quarantine",
      score: input.score,
      reasons: [`quality score ${input.score}`],
    },
    privacy: "internal",
    status: "candidate",
    runtimeInjection: "disabled",
    provenance: "director-desktop/maintenance-test",
    createdAtMs: input.createdAtMs,
  };
}

function createKnowledgePackDocumentFixture(id) {
  return {
    schemaVersion: "director.knowledge.pack.v1",
    stage: "published",
    metadata: {
      id,
      version: 1,
      title: "Host API Published Knowledge",
      summary: "Host API catalog published knowledge.",
      tags: ["host-catalog"],
    },
    method: {
      projectId: "project-host",
      groupId: "group-host",
      trigger: "Use for Host API catalog hydration.",
      summary: "Published method summary.",
      explanation: "Published method explanation.",
      anchorIds: ["anchor-host"],
      preferredAdapters: ["scripted"],
      generationType: "new",
      generationStyle: "immersive",
      selectedAdapters: ["scripted"],
      roles: ["researcher"],
    },
    audit: {
      publishedAt: "2026-04-30T00:00:00.000Z",
    },
  };
}

function createKnowledgeCandidateDocumentFixture(id) {
  return {
    schemaVersion: "director.knowledge.candidate.v1",
    stage: "candidate",
    metadata: {
      id,
      version: 1,
      title: "Host API Candidate Knowledge",
      summary: "Host API catalog candidate knowledge.",
      tags: ["host-catalog"],
    },
    method: {
      projectId: "project-host",
      groupId: "group-host",
      trigger: "Use for Host API catalog hydration.",
      summary: "Candidate method summary.",
      explanation: "Candidate method explanation.",
      anchorIds: ["anchor-host"],
      preferredAdapters: ["scripted"],
      generationType: "new",
      generationStyle: "immersive",
      selectedAdapters: ["scripted"],
      roles: ["researcher"],
    },
    diff: {
      summary: "Initial Host API catalog candidate.",
    },
    evolution: {
      operation: "create",
    },
    audit: {
      candidateAt: "2026-04-30T00:01:00.000Z",
    },
  };
}

function writeSkillSnapshotFixture(workspaceRoot) {
  const skillsDir = join(workspaceRoot, ".hotflow", "skills");
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(
    join(skillsDir, "approved-skills.json"),
    JSON.stringify({
      schemaVersion: "skills.approved.v2",
      version: 1,
      updatedAtMs: 1,
      appliedAtMs: 1,
      appliedFromProposalId: null,
      changeKind: "manual",
      previousVersion: null,
      restoredFromVersion: null,
      skills: [
        {
          id: "skill.self",
          version: "0.1.0",
          title: "Self Skill",
          content: "Use learned experience.",
          updatedAtMs: 1,
          tags: ["worker-generated"],
          metadata: { sourceTurnId: "turn-1" },
        },
        {
          id: "skill.external",
          version: "1.0.0",
          title: "External Skill",
          content: "Imported workflow.",
          updatedAtMs: 1,
        },
      ],
    }),
    "utf8",
  );
}

function writeRichSkillSnapshotFixture(workspaceRoot) {
  const skillsDir = join(workspaceRoot, ".hotflow", "skills");
  mkdirSync(skillsDir, { recursive: true });
  const documentationSkills = Array.from({ length: 12 }, (_, index) => ({
    id: `skill.documentation-${index + 1}`,
    version: "1.0.0",
    title: `Documentation Skill ${index + 1}`,
    content: `Document workflow ${index + 1}.`,
    description: "Keep documentation current.",
    updatedAtMs: index + 1,
    tags: ["documentation"],
  }));
  writeFileSync(
    join(skillsDir, "approved-skills.json"),
    JSON.stringify({
      schemaVersion: "skills.approved.v2",
      version: 3,
      updatedAtMs: 10,
      appliedAtMs: 11,
      appliedFromProposalId: "proposal-rich-skill",
      changeKind: "apply",
      previousVersion: 2,
      restoredFromVersion: null,
      skills: [
        {
          id: "skill.backend-snapshot",
          version: "2.0.0",
          title: "Backend Skills Snapshot",
          content:
            "Read approved skills as a complete library. Preserve content, metadata, tags, tools, and source counts for detail panes.",
          description: "Expose approved skills with enough detail for the desktop library.",
          updatedAtMs: 100,
          tags: ["backend", "snapshot", "worker-generated"],
          toolNames: ["rg", "node"],
          priority: 72,
          metadata: {
            sourceTurnId: "turn-rich-skill",
            category: "backend",
            sourceCount: 3,
          },
        },
        ...documentationSkills,
      ],
    }),
    "utf8",
  );
}

function writeSkillCuratorFixture(workspaceRoot) {
  const dataDir = join(workspaceRoot, ".hotflow");
  const skillsDir = join(dataDir, "skills");
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(
    join(skillsDir, "approved-skills.json"),
    JSON.stringify({
      schemaVersion: "skills.approved.v2",
      version: 1,
      updatedAtMs: 1,
      appliedAtMs: 1,
      appliedFromProposalId: null,
      changeKind: "manual",
      previousVersion: null,
      restoredFromVersion: null,
      skills: [
        {
          id: "skill.failed-curator",
          version: "1.0.0",
          title: "Failed Curator Skill",
          content: "Use a downstream tool that failed.",
          updatedAtMs: 100,
        },
        {
          id: "skill.stale-curator",
          version: "1.0.0",
          title: "Stale Curator Skill",
          content: "Old guidance that has not been used recently.",
          updatedAtMs: 100,
        },
        {
          id: "skill.dup-curator-a",
          version: "1.0.0",
          title: "Duplicate Curator A",
          content: "Canonical duplicate guidance.",
          updatedAtMs: 100,
          metadata: {
            dedupeKey: "curator-duplicate",
          },
        },
        {
          id: "skill.dup-curator-b",
          version: "1.0.0",
          title: "Duplicate Curator B",
          content: "Merged duplicate guidance.",
          updatedAtMs: 110,
          tags: ["duplicate"],
          metadata: {
            dedupeKey: "curator-duplicate",
          },
        },
      ],
    }),
    "utf8",
  );
  writeFileSync(
    resolveSkillUsagePath({ dataDir }),
    JSON.stringify({
      schemaVersion: "skills.usage.v1",
      updatedAtMs: 1_777_300_000_000,
      updatedBy: "fixture",
      records: {
        "skill.failed-curator": {
          skillId: "skill.failed-curator",
          viewCount: 0,
          useCount: 3,
          failureCount: 2,
          patchCount: 0,
          createdAtMs: 1_000,
          lastViewedAtMs: null,
          lastUsedAtMs: 1_777_299_900_000,
          lastFailedAtMs: 1_777_299_950_000,
          lastPatchedAtMs: null,
          lastActivityAtMs: 1_777_299_950_000,
          state: "active",
          pinned: false,
          archivedAtMs: null,
          events: [],
        },
        "skill.stale-curator": {
          skillId: "skill.stale-curator",
          viewCount: 0,
          useCount: 1,
          failureCount: 0,
          patchCount: 0,
          createdAtMs: 1_000,
          lastViewedAtMs: null,
          lastUsedAtMs: 1_000,
          lastFailedAtMs: null,
          lastPatchedAtMs: null,
          lastActivityAtMs: 1_000,
          state: "active",
          pinned: false,
          archivedAtMs: null,
          events: [],
        },
      },
    }),
    "utf8",
  );
}

function writeAdapterRegistryFixture(workspaceRoot, options = {}) {
  const registryDir = join(workspaceRoot, ".director-angel", "adapters", "registry");
  const manifestDir = join(registryDir, "manifests");
  mkdirSync(registryDir, { recursive: true });
  mkdirSync(manifestDir, { recursive: true });
  const manifestPath = join(manifestDir, "external-cli.json");
  writeFileSync(
    join(registryDir, "index.json"),
    JSON.stringify({
      schemaVersion: "director.adapter.registry.index.v1",
      updatedAt: "2026-04-25T10:00:00.000Z",
      entries: [
        {
          adapterId: "external-cli",
          adapterKind: "execution",
          provider: "local-cli",
          enabled: true,
          healthStatus: "ready",
          capturedAt: "2026-04-25T10:00:00.000Z",
          version: 1,
          manifestPath,
        },
      ],
    }),
    "utf8",
  );
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: "director.adapter.manifest.v1",
      version: 1,
      capturedAt: "2026-04-25T10:00:00.000Z",
      source: "test",
      adapterId: "external-cli",
      adapterKind: "execution",
      provider: "local-cli",
      displayName: "External CLI",
      enabled: true,
      healthStatus: "ready",
      dryRunSupported: true,
      mockOnly: false,
      riskLevel: "high",
      approvalMode: "operator_approve",
      permissionScopes: ["external-cli.write"],
      dataRetentionPolicy: "local-operator-managed",
      rateLimitPolicy: "manual-rate-limit",
      budgetPolicy: "operator-budget-required",
      supportedActionClasses: options.supportedActionClasses ?? ["write"],
      bridge: {
        kind: "http-json",
        baseUrl: options.baseUrl ?? "https://bridge.example.test",
        submitPath: "/v1/jobs",
        timeoutMs: 5000,
        authEnvVar: "EXTERNAL_CLI_TOKEN",
      },
    }),
    "utf8",
  );
}

function writeRuntimeSwitchFixture(workspaceRoot) {
  const runtimeDir = join(workspaceRoot, ".director-angel", "runtime");
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, "switches.json"),
    JSON.stringify({
      schemaId: "director.switches.v1",
      features: {
        "learning.enabled": true,
        "publish.enabled": false,
      },
      adapterOverrides: {
        "external-cli": false,
      },
    }),
    "utf8",
  );
}

function writeWeixinAccountFixture(workspaceRoot, options = {}) {
  const id = options.id ?? "expired-account";
  const accountDir = join(workspaceRoot, ".director-angel", "weixin", "accounts");
  mkdirSync(accountDir, { recursive: true });
  const indexPath = join(accountDir, "accounts.json");
  let ids = [];
  if (options.append) {
    try {
      const existing = JSON.parse(readFileSync(indexPath, "utf8"));
      ids = Array.isArray(existing)
        ? existing.filter((item) => typeof item === "string" && item.trim().length > 0)
        : [];
    } catch {
      ids = [];
    }
  }
  ids = [id, ...ids.filter((item) => item !== id)];
  writeFileSync(indexPath, `${JSON.stringify(ids)}\n`);
  writeFileSync(
    join(accountDir, `${id}.json`),
    `${JSON.stringify(
      {
        normalizedAccountId: id,
        accountId: id,
        token: options.token ?? "expired-token",
        baseUrl: "https://ilink.example.test/",
        userId: options.userId ?? "expired-user",
        savedAt: options.savedAt ?? "2026-04-30T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function writeTraceProposalFixture(workspaceRoot) {
  const store = new FileSystemDirectorProposalStore({
    rootPath: join(workspaceRoot, ".director-angel", "runtime", "proposals"),
    clock: () => "2026-04-25T10:00:00.000Z",
  });
  await store.writeProposal({
    schemaVersion: "director.proposal.v1",
    proposalId: "proposal-review-1",
    kind: "director.trace_capture",
    status: "pending",
    provenance: "desktop-test",
    recordId: "record-1",
    digestId: "digest-1",
    runId: "run-review-1",
    reportId: "report-review-1",
    projectId: "project-1",
    groupId: "group-1",
    title: "Review failed run",
    summary: "Capture reusable failure handling experience.",
    trigger: "failed-run",
    evidenceSummary: "Run failed after bridge timeout.",
    explanation: "Human review should decide whether to retain this lesson.",
    confidence: 0.82,
    riskLevel: "medium",
    dedupeKey: "review-failed-run",
    tags: ["review", "execution"],
    roles: ["qc-reviewer"],
    selectedAdapters: ["external-cli"],
    createdAt: "2026-04-25T10:00:00.000Z",
    updatedAt: "2026-04-25T10:00:00.000Z",
    sourceRecord: {
      recordId: "record-1",
    },
  });
}

async function writeExecutionRunFixture(workspaceRoot) {
  const store = new FileSystemRunStore({
    rootPath: join(workspaceRoot, ".director-angel", "runtime", "execution"),
  });
  const run = {
    schemaVersion: "director.execution.run.v1",
    runId: "run-review-1",
    snapshotId: "snapshot-1",
    runtimeId: "runtime-1",
    blueprintId: "blueprint-1",
    handoffId: "handoff-1",
    actionGraphId: "graph-1",
    goal: "Make a production clip",
    previewSummary: "Bridge failed and needs review.",
    sideEffectsAllowed: false,
    createdAt: "2026-04-25T10:00:00.000Z",
    startedAt: "2026-04-25T10:01:00.000Z",
    updatedAt: "2026-04-25T10:02:00.000Z",
    completedAt: "2026-04-25T10:02:00.000Z",
    status: "failed",
    assignments: [
      {
        runId: "run-review-1",
        assignmentId: "assignment-review-1",
        role: "asset-router",
        objective: "Generate a production clip through an external CLI bridge.",
        deliverable: "A production clip request",
        actionClass: "generate",
        approvalMode: "operator_approve",
        dependsOn: [],
        status: "failed",
        selectedAdapter: "external-cli",
        allowedAdapters: ["external-cli", "fallback-cli"],
        blockingReason: "Bridge timeout",
        timeoutMs: 30000,
        createdAt: "2026-04-25T10:00:30.000Z",
        startedAt: "2026-04-25T10:01:00.000Z",
        completedAt: "2026-04-25T10:02:00.000Z",
        result: {
          runId: "run-review-1",
          assignmentId: "assignment-review-1",
          status: "failed",
          recordedAt: "2026-04-25T10:02:00.000Z",
          workerId: "worker-review-1",
          summary: "External CLI bridge timed out.",
          adapterId: "external-cli",
          bridgeExecution: {
            kind: "http-json",
            request: {
              endpointOrigin: "https://api.example.test",
              endpointPath: "/v1/render",
              method: "POST",
              timeoutMs: 30000,
              authMode: "env",
              headerKeys: ["authorization"],
              payloadBytes: 256,
            },
            failure: {
              reason: "network_timeout",
              message: "Timed out while calling external CLI.",
              retryable: true,
              statusCode: 504,
            },
          },
          notes: ["retry after operator review"],
        },
        notes: ["source trace captured"],
      },
    ],
    events: [
      {
        eventId: "event-review-1",
        runId: "run-review-1",
        type: "assignment-status-changed",
        occurredAt: "2026-04-25T10:02:00.000Z",
        message: "Assignment failed after bridge timeout.",
        metadata: {
          assignmentId: "assignment-review-1",
        },
      },
    ],
  };
  await store.saveRun(run);
  await store.saveReport({
    schemaVersion: "director.execution.run.v1",
    reportId: "report-review-1",
    runId: "run-review-1",
    run,
    recordedAt: "2026-04-25T10:03:00.000Z",
    summary: ["Bridge failed and needs review."],
    flags: ["failed"],
    operatorSurface: {
      directorGoal: "Make a production clip",
      operatorSummary: "Bridge failed and needs review.",
      bridgeVerdict: "failed",
      bridgeFailureReason: "network_timeout",
      retryable: true,
      retryAllowed: true,
      nextAction: "review the failed bridge request before retrying.",
    },
    events: [],
  });
  await syncExecutionRunDelegationFixture(workspaceRoot, run);
}

async function syncExecutionRunDelegationFixture(workspaceRoot, run) {
  const dataDir = join(workspaceRoot, ".hotflow");
  const { SessionStore } = await import("@hotflow/sessions");
  const { SessionStoreTaskPlanePort } = await import("@hotflow/tasks-core");
  const { buildExecutionRunDelegations } = await import("@hotflow/director-execution");
  const store = new SessionStore({ dbPath: join(dataDir, "sessions", "worker-jobs.sqlite") });
  try {
    store.createSession({
      sessionId: run.runId,
      metadata: {
        owner: "test",
        purpose: "execution run delegation mailbox",
        runId: run.runId,
      },
    });
    const taskPlane = new SessionStoreTaskPlanePort(store, run.runId, { createIfMissing: true });
    for (const delegation of buildExecutionRunDelegations(run, {
      sourceAgent: "test",
      includePending: true,
    })) {
      await taskPlane.enqueueDelegation(delegation);
      if (delegation.verificationRequest) {
        await taskPlane.upsertVerification({
          id: delegation.verificationRequest.verificationId ?? `${delegation.id}-verification`,
          taskId: delegation.taskId,
          verifierId: delegation.verificationRequest.verifierId,
          requirement: delegation.verificationRequest.requirement,
          status: "failed",
          verdict: "fail",
          verdictSummary: "External CLI bridge timed out and needs operator review.",
          checks: [
            {
              id: "bridge-timeout",
              status: "fail",
              summary: "Bridge request returned network_timeout.",
            },
          ],
        });
      }
    }
  } finally {
    store.close();
  }
}

async function writeNestedSubagentExecutionRunFixture(workspaceRoot) {
  const store = new FileSystemRunStore({
    rootPath: join(workspaceRoot, ".director-angel", "runtime", "execution"),
  });
  const run = {
    schemaVersion: "director.execution.run.v1",
    runId: "run-nested-subagent-1",
    snapshotId: "snapshot-nested-subagent-1",
    runtimeId: "runtime-nested-subagent-1",
    blueprintId: "blueprint-nested-subagent-1",
    handoffId: "handoff-nested-subagent-1",
    actionGraphId: "graph-nested-subagent-1",
    goal: "Check nested subagent announcements",
    previewSummary: "Nested subagent fixture.",
    sideEffectsAllowed: false,
    createdAt: "2026-05-11T10:00:00.000Z",
    startedAt: "2026-05-11T10:00:01.000Z",
    updatedAt: "2026-05-11T10:00:02.000Z",
    status: "running",
    assignments: [],
    events: [],
  };
  await store.saveRun(run);
  const dataDir = join(workspaceRoot, ".hotflow");
  const { SessionStore } = await import("@hotflow/sessions");
  const { SessionStoreTaskPlanePort } = await import("@hotflow/tasks-core");
  const sessionStore = new SessionStore({ dbPath: join(dataDir, "sessions", "worker-jobs.sqlite") });
  try {
    sessionStore.createSession({
      sessionId: run.runId,
      metadata: {
        owner: "test",
        purpose: "nested subagent announce fixture",
        runId: run.runId,
      },
    });
    const taskPlane = new SessionStoreTaskPlanePort(sessionStore, run.runId, {
      createIfMissing: true,
    });
    await taskPlane.enqueueDelegation({
      id: "delegate_top_level_background",
      taskId: "task-top-level-background",
      workerId: "worker-top-level",
      instruction: "顶层后台任务",
      contextSnapshot:
        "parentTurnId=run-nested-subagent-1;sessionKey=desktop:run:run-nested-subagent-1;isolatedContext=true;requesterSessionKey=desktop:run:run-nested-subagent-1;requesterOrigin=desktop;deliveryTarget=desktop:workbench;childSessionKey=subagent:delegate_top_level_background;announceMode=task-notification;topLevelRequester=true",
      specialization: "general",
      targetAgent: "researcher",
    });
    await taskPlane.setDelegationStatus({
      id: "delegate_top_level_background",
      status: "completed",
      resultSummary: "顶层后台任务完成，应该通知用户。",
    });
    await taskPlane.enqueueDelegation({
      id: "delegate_nested_background",
      taskId: "task-nested-background",
      workerId: "worker-nested",
      instruction: "嵌套后台任务",
      contextSnapshot:
        "parentTurnId=turn-parent-subagent;sessionKey=subagent:delegate_top_level_background;isolatedContext=true;requesterSessionKey=subagent:delegate_top_level_background;requesterOrigin=subagent;parentSubagentId=delegate_top_level_background;childSessionKey=subagent:delegate_nested_background;announceMode=task-notification;topLevelRequester=false",
      specialization: "verify",
      targetAgent: "verifier",
    });
    await taskPlane.setDelegationStatus({
      id: "delegate_nested_background",
      status: "completed",
      resultSummary: "嵌套后台任务完成，应该回给直接父 agent。",
    });
  } finally {
    sessionStore.close();
  }
}

async function writeSubagentSchedulerExecutionRunFixture(workspaceRoot) {
  const store = new FileSystemRunStore({
    rootPath: join(workspaceRoot, ".director-angel", "runtime", "execution"),
  });
  const run = {
    schemaVersion: "director.execution.run.v1",
    runId: "run-scheduler-1",
    snapshotId: "snapshot-scheduler-1",
    runtimeId: "runtime-scheduler-1",
    blueprintId: "blueprint-scheduler-1",
    handoffId: "handoff-scheduler-1",
    actionGraphId: "graph-scheduler-1",
    goal: "Schedule subagent write-set batches",
    previewSummary: "Subagent scheduler fixture.",
    sideEffectsAllowed: false,
    createdAt: "2026-05-09T00:00:00.000Z",
    startedAt: "2026-05-09T00:00:01.000Z",
    updatedAt: "2026-05-09T00:00:02.000Z",
    status: "running",
    assignments: [],
    events: [],
  };
  await store.saveRun(run);
  const dataDir = join(workspaceRoot, ".hotflow");
  const { SessionStore } = await import("@hotflow/sessions");
  const { SessionStoreTaskPlanePort } = await import("@hotflow/tasks-core");
  const sessionStore = new SessionStore({ dbPath: join(dataDir, "sessions", "worker-jobs.sqlite") });
  try {
    sessionStore.createSession({
      sessionId: run.runId,
      metadata: {
        owner: "test",
        purpose: "execution run delegation scheduler mailbox",
        runId: run.runId,
      },
    });
    const taskPlane = new SessionStoreTaskPlanePort(sessionStore, run.runId, {
      createIfMissing: true,
    });
    await taskPlane.enqueueDelegation({
      id: "delegate_scheduler_alpha_running",
      taskId: "task-alpha-running",
      workerId: "worker-alpha-running",
      instruction: "Patch alpha first.",
      contextSnapshot:
        "parentTurnId=run-scheduler-1;isolatedContext=true;parallelGroup=implementation;writeSet=src/alpha.ts",
      specialization: "general",
      targetAgent: "implementer-alpha-running",
    });
    await taskPlane.setDelegationStatus({
      id: "delegate_scheduler_alpha_running",
      status: "running",
    });
    await taskPlane.enqueueDelegation({
      id: "delegate_scheduler_beta",
      taskId: "task-beta",
      workerId: "worker-beta",
      instruction: "Patch beta independently.",
      contextSnapshot:
        "parentTurnId=run-scheduler-1;isolatedContext=true;parallelGroup=implementation;writeSet=src/beta.ts",
      specialization: "general",
      targetAgent: "implementer-beta",
    });
    await taskPlane.setDelegationStatus({
      id: "delegate_scheduler_beta",
      status: "completed",
      resultSummary: "Patched beta.",
      observedWriteSet: ["src/beta.ts", "src/beta.test.ts"],
      observedWriteSetSource: "patch",
    });
    await taskPlane.enqueueDelegation({
      id: "delegate_scheduler_gamma_ready",
      taskId: "task-gamma-ready",
      workerId: "worker-gamma-ready",
      instruction: "Patch gamma while alpha is running.",
      contextSnapshot:
        "parentTurnId=run-scheduler-1;isolatedContext=true;parallelGroup=implementation;writeSet=src/gamma.ts",
      specialization: "general",
      targetAgent: "implementer-gamma-ready",
    });
    await taskPlane.enqueueDelegation({
      id: "delegate_scheduler_alpha_followup",
      taskId: "task-alpha-followup",
      workerId: "worker-alpha-followup",
      instruction: "Patch alpha after the running child.",
      contextSnapshot:
        "parentTurnId=run-scheduler-1;isolatedContext=true;parallelGroup=implementation;writeSet=src/alpha.ts",
      specialization: "general",
      targetAgent: "implementer-alpha-followup",
    });
  } finally {
    sessionStore.close();
  }
}

async function writePendingApprovalRunFixture(workspaceRoot) {
  const store = new FileSystemRunStore({
    rootPath: join(workspaceRoot, ".director-angel", "runtime", "execution"),
  });
  const run = {
    schemaVersion: "director.execution.run.v1",
    runId: "run-pending-approval-1",
    snapshotId: "snapshot-pending-1",
    runtimeId: "runtime-1",
    blueprintId: "blueprint-pending-1",
    handoffId: "handoff-pending-1",
    actionGraphId: "graph-pending-1",
    goal: "Make a review gated clip",
    previewSummary: "One assignment is waiting for operator approval.",
    sideEffectsAllowed: false,
    createdAt: "2026-04-25T11:00:00.000Z",
    updatedAt: "2026-04-25T11:01:00.000Z",
    status: "created",
    assignments: [
      {
        runId: "run-pending-approval-1",
        assignmentId: "assignment-pending-1",
        role: "asset-router",
        objective: "Submit a production request after approval.",
        deliverable: "A gated production request",
        actionClass: "generate",
        approvalMode: "operator_approve",
        dependsOn: [],
        status: "pending",
        selectedAdapter: "external-cli",
        allowedAdapters: ["external-cli"],
        blockingReason: "Waiting for operator approval",
        timeoutMs: 30000,
        createdAt: "2026-04-25T11:00:30.000Z",
        notes: ["approval gate is intentional"],
      },
    ],
    events: [
      {
        eventId: "event-pending-1",
        runId: "run-pending-approval-1",
        type: "assignment-status-changed",
        occurredAt: "2026-04-25T11:01:00.000Z",
        message: "Assignment is waiting for operator approval.",
        metadata: {
          assignmentId: "assignment-pending-1",
        },
      },
    ],
  };
  await store.saveRun(run);
  await store.saveReport({
    schemaVersion: "director.execution.run.v1",
    reportId: "report-pending-approval-1",
    runId: "run-pending-approval-1",
    run,
    recordedAt: "2026-04-25T11:01:30.000Z",
    summary: ["One assignment is waiting for operator approval."],
    flags: ["awaiting-approval-or-dependencies"],
    operatorSurface: {
      directorGoal: "Make a review gated clip",
      operatorSummary: "One assignment is waiting for operator approval.",
      retryable: false,
      retryAllowed: false,
      nextAction: "approve or adjust the gated assignment before continuing.",
    },
    events: run.events,
  });
}
