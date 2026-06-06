import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DirectorAdapterRegistry,
  createMockExecutionAdapter,
  createMockHostAdapter,
  createMockMediaAdapter,
  resolveDirectorSwitchState,
} from "@hotflow/director-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockBootstrapDirectorHostApi } = vi.hoisted(() => ({
  mockBootstrapDirectorHostApi: vi.fn(),
}));

vi.mock("../src/bootstrap.js", async () => {
  const actual = await vi.importActual<typeof import("../src/bootstrap.js")>("../src/bootstrap.js");
  return {
    ...actual,
    bootstrapDirectorHostApi: mockBootstrapDirectorHostApi,
  };
});

import { createDirectorHostApiApp } from "../src/server.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  mockBootstrapDirectorHostApi.mockReset();
});

describe("Director Host API V1 product surface", () => {
  it("exposes bindings, sessions, tasks, SSE events, capabilities, and model adapters", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-v1-surface-"));
    tempRoots.push(workspaceRoot);
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot));
    const app = createDirectorHostApiApp({ env: {} });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });
    const baseUrl = `http://${host}:${port}`;

    try {
      const capabilities = await getJson(`${baseUrl}/v1/capabilities`);
      expect(capabilities.resources).toEqual(
        expect.arrayContaining([
          "/v1/client-bindings",
          "/v1/sessions",
          "/v1/tasks",
          "/v1/tasks/{id}/events",
          "/v1/catalog/model-adapters",
          "/v1/learning/jobs",
          "/v1/learning/artifacts",
          "/v1/learning/confirmations",
        ]),
      );
      expect(capabilities.streaming).toMatchObject({ sse: true });

      const binding = await postJson(`${baseUrl}/v1/client-bindings`, {
        bindingId: "desktop-main",
        clientId: "desktop-main",
        displayName: "Desktop Main",
        channel: "desktop",
        hostId: "director-desktop",
      });
      expect(binding.binding).toMatchObject({
        bindingId: "desktop-main",
        clientId: "desktop-main",
        channel: "desktop",
        hostId: "director-desktop",
      });

      const bindings = await getJson(`${baseUrl}/v1/client-bindings`);
      expect(bindings.bindings).toEqual(
        expect.arrayContaining([expect.objectContaining({ bindingId: "desktop-main" })]),
      );

      const createdSession = await postJson(`${baseUrl}/v1/sessions`, {
        bindingId: "desktop-main",
        peerId: "local-operator",
        title: "V1 acceptance session",
      });
      expect(createdSession.session).toMatchObject({
        bindingId: "desktop-main",
        channel: "desktop",
        peerId: "local-operator",
        messageCount: 0,
      });
      const sessionId = String(createdSession.session.sessionId);

      const message = await postJson(
        `${baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
        {
          messageId: "message-v1-1",
          receivedAtMs: Date.parse("2026-05-02T00:00:00.000Z"),
          text: "生成一个 15 秒短剧分镜蓝图",
        },
      );
      expect(message.message).toMatchObject({
        messageId: "message-v1-1",
        text: "生成一个 15 秒短剧分镜蓝图",
      });
      expect(message.entry.session.nextAction).toBe("blueprint");

      const task = await postJson(`${baseUrl}/v1/tasks`, {
        sessionId,
        messageId: "task-v1-1",
        receivedAtMs: Date.parse("2026-05-02T00:01:00.000Z"),
        text: "生成一个 15 秒短剧分镜蓝图，并创建可审查任务",
        start: true,
      });
      expect(task.task).toMatchObject({
        sessionId,
        status: "running",
      });
      const taskId = String(task.task.taskId);

      const taskStatus = await getJson(`${baseUrl}/v1/tasks/${encodeURIComponent(taskId)}`);
      expect(taskStatus.task).toMatchObject({ taskId, status: "running" });

      const eventResponse = await fetch(`${baseUrl}/v1/tasks/${encodeURIComponent(taskId)}/events`);
      expect(eventResponse.status).toBe(200);
      expect(eventResponse.headers.get("content-type")).toContain("text/event-stream");
      const eventText = await eventResponse.text();
      expect(eventText).toContain("event: task.status");
      expect(eventText).toContain(`"taskId":"${taskId}"`);

      const cancelled = await postJson(`${baseUrl}/v1/tasks/${encodeURIComponent(taskId)}/cancel`);
      expect(cancelled.task).toMatchObject({ taskId, status: "aborted" });

      const adapters = await getJson(`${baseUrl}/v1/catalog/model-adapters`);
      expect(adapters.adapters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            adapterId: "scripted",
            adapterKind: "media",
            provider: "scripted",
          }),
        ]),
      );

      const deleteResponse = await fetch(
        `${baseUrl}/v1/client-bindings/${encodeURIComponent("desktop-main")}`,
        { method: "DELETE" },
      );
      expect(deleteResponse.status).toBe(204);
    } finally {
      await app.close();
    }
  });

  it("wraps synchronous learning sources in manageable V1 learning jobs", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-v1-learning-"));
    tempRoots.push(workspaceRoot);
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot));
    const app = createDirectorHostApiApp({ env: {} });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });
    const baseUrl = `http://${host}:${port}`;

    try {
      const created = await postJson(`${baseUrl}/v1/learning/jobs`, {
        jobId: "learn-job-1",
        kind: "text",
        sourceId: "v1-learning-text",
        texts: [
          {
            title: "Reusable Director Lesson",
            content:
              "When a production bridge times out, keep the operator-facing report short, preserve the retry evidence, and offer one safe reroute path.",
          },
        ],
        privacy: "internal",
        nowMs: 1_777_654_400_000,
      });
      expect(created.job).toMatchObject({
        jobId: "learn-job-1",
        kind: "text",
        status: "created",
      });

      const listed = await getJson(`${baseUrl}/v1/learning/jobs`);
      expect(listed.jobs).toEqual(
        expect.arrayContaining([expect.objectContaining({ jobId: "learn-job-1" })]),
      );

      const run = await postJson(`${baseUrl}/v1/learning/jobs/learn-job-1/run`);
      expect(run.job).toMatchObject({
        jobId: "learn-job-1",
        status: "succeeded",
      });
      expect(run.result.schemaId).toBe("director.host.learning-text.v1");

      const loaded = await getJson(`${baseUrl}/v1/learning/jobs/learn-job-1`);
      expect(loaded.job).toMatchObject({
        jobId: "learn-job-1",
        status: "succeeded",
      });
    } finally {
      await app.close();
    }
  });

  it("exposes learning artifacts and pending confirmations as read-only V1 resources", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-v1-learning-artifacts-"));
    tempRoots.push(workspaceRoot);
    const runtime = createMockRuntime(workspaceRoot);
    const storeDir = join(runtime.config.dataDir, "conversation-runtime");
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(
      join(storeDir, "learning-artifacts.json"),
      JSON.stringify({
        schemaVersion: "conversation-runtime.learning-artifacts.v1",
        artifacts: [
          {
            artifactId: "learning-artifact-v1",
            sessionKey: "desktop:workbench",
            turnRunId: "turn-v1",
            sourceSurface: "desktop",
            roleScope: {
              roleName: "Director Angel",
              domain: "影视制作",
              responsibilityTags: ["导演"],
            },
            sourceKind: "tool-result",
            sourceRef: "desktop-learning-confirm",
            status: "pending_confirmation",
            evidenceRefs: ["source-confirm-1"],
            mediaEvidenceRefs: [],
            confidence: "high",
            publishable: true,
            privacy: "public",
            qualityGates: [],
            pendingConfirmationId: "learning-confirmation-v1",
            createdAtMs: 1_777_654_400_000,
            updatedAtMs: 1_777_654_400_000,
          },
        ],
        confirmations: [
          {
            confirmationId: "learning-confirmation-v1",
            sessionKey: "desktop:workbench",
            artifactId: "learning-artifact-v1",
            candidateIds: ["exp-confirm-1"],
            status: "pending",
            createdAtMs: 1_777_654_400_000,
            expiresAtMs: 1_777_656_200_000,
          },
        ],
      }),
      "utf8",
    );
    mockBootstrapDirectorHostApi.mockReturnValue(runtime);
    const app = createDirectorHostApiApp({ env: {} });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });
    const baseUrl = `http://${host}:${port}`;

    try {
      const artifacts = await getJson(
        `${baseUrl}/v1/learning/artifacts?sessionKey=desktop%3Aworkbench`,
      );
      expect(artifacts).toMatchObject({
        schemaId: "director.host.learning-artifacts.v1",
        count: 1,
        totalMatching: 1,
      });
      expect(artifacts.items).toEqual([
        expect.objectContaining({
          artifactId: "learning-artifact-v1",
          status: "pending_confirmation",
          pendingConfirmationId: "learning-confirmation-v1",
        }),
      ]);

      const confirmations = await getJson(
        `${baseUrl}/v1/learning/confirmations?sessionKey=desktop%3Aworkbench`,
      );
      expect(confirmations).toMatchObject({
        schemaId: "director.host.learning-confirmations.v1",
        count: 1,
        totalMatching: 1,
      });
      expect(confirmations.items).toEqual([
        expect.objectContaining({
          confirmationId: "learning-confirmation-v1",
          artifactId: "learning-artifact-v1",
          candidateIds: ["exp-confirm-1"],
          status: "pending",
        }),
      ]);
    } finally {
      await app.close();
    }
  });
});

function createMockRuntime(workspaceRoot: string) {
  const dataDir = join(workspaceRoot, ".hotflow");
  const switchState = resolveDirectorSwitchState();
  const adapterRegistry = new DirectorAdapterRegistry([
    createMockHostAdapter({
      adapterId: "director-host-api",
      provider: "director-host-api",
      notes: [`Workspace: ${workspaceRoot}`],
    }),
    createMockMediaAdapter({
      adapterId: "scripted",
      bindingId: "binding-a",
      provider: "scripted",
      notes: ["Mock media adapter for scripted."],
    }),
    createMockExecutionAdapter({
      adapterId: "beta1-handoff-preview",
      provider: "director-host-api",
      notes: ["Preview-only execution handoff adapter."],
    }),
  ]);

  return {
    config: {
      workspaceRoot,
      dataDir,
      defaultProvider: "scripted",
      defaultModel: "hotflow-phase1",
    },
    providerIds: ["scripted"],
    apiProviders: [],
    internalPluginIds: [],
    adapterRegistry,
    runtimeCapabilitySnapshot: adapterRegistry.buildRuntimeCapabilitySnapshot({
      runtimeId: "director-host-api",
      capturedAt: "2026-05-02T00:00:00.000Z",
      runtimeStatus: "ready",
      switchState,
      notes: ["Registered 1 mock media adapter(s)."],
    }),
    switchPath: join(workspaceRoot, ".director-angel", "runtime", "switches.json"),
    switchState,
    observationPath: join(workspaceRoot, ".director-angel", "runtime", "observations.ndjson"),
    sessionStore: {
      close: vi.fn(),
    },
  };
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}

async function postJson(url: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  expect(response.ok).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}
