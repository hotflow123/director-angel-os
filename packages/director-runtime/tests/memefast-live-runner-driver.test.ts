import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LiveRunCancelToken, LiveRunRequest, LiveRunSession } from "@hotflow/live-runner-core";
import { createQueuedLiveRunSession } from "@hotflow/live-runner-core";
import { afterEach, describe, expect, it } from "vitest";

import {
  createMemefastLiveRunProviderDriver,
  updateDirectorApiProviderSetting,
} from "../src/api-provider-adapters.ts";

describe("memefast live runner provider driver", () => {
  const tempRoots: string[] = [];
  const previousMemefastApiKey = process.env.MEMEFAST_API_KEY;

  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
    if (previousMemefastApiKey === undefined) {
      Reflect.deleteProperty(process.env, "MEMEFAST_API_KEY");
    } else {
      process.env.MEMEFAST_API_KEY = previousMemefastApiKey;
    }
  });

  it("starts and polls async MemeFast video tasks through the live runner contract", async () => {
    const root = createTempRoot(tempRoots);
    const calls: Array<{ url: string; method: string; authorization?: string; body?: unknown }> =
      [];

    await configureMemefast(root, "sk-video-secret");

    const driver = createMemefastLiveRunProviderDriver(root, {
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          method: init.method,
          authorization: init.headers.Authorization,
          body: init.body === undefined ? undefined : JSON.parse(init.body),
        });
        if (url === "https://proxy.example.test/v1/video/create") {
          return jsonResponse({
            data: {
              task_id: "task-video-1",
              status: "queued",
              poll_url: "/v1/video/query?id=task-video-1",
            },
          });
        }
        if (url === "https://proxy.example.test/v1/video/query?id=task-video-1") {
          return jsonResponse({
            status: "succeeded",
            progress: 100,
            data: { video_url: "https://cdn.example.test/director-angel.mp4" },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    const request = createRequest({
      capabilityId: "video_generation",
      operationId: "video.create",
      input: {
        prompt: "电影感天台追逐",
        model: "grok-video-3",
        aspectRatio: "16:9",
        duration: 10,
      },
    });
    const session = createSession(request);

    const started = await driver.start({ request, session });
    expect(started.providerTask).toBeDefined();
    const providerTask = started.providerTask;
    if (providerTask === undefined) {
      throw new Error("Expected provider task from async video start.");
    }
    const polled = await driver.poll?.({
      request,
      session: { ...session, providerTask, status: "polling" },
      providerTask,
    });

    expect(started).toMatchObject({
      completed: false,
      progress: 1,
      providerTask: {
        taskId: "task-video-1",
        status: "queued",
        metadata: {
          pollUrl: "https://proxy.example.test/v1/video/query?id=task-video-1",
          routeFamily: "unified",
        },
      },
    });
    expect(polled).toMatchObject({
      completed: true,
      progress: 100,
      artifacts: [
        {
          kind: "video",
          url: "https://cdn.example.test/director-angel.mp4",
          mimeType: "video/mp4",
        },
      ],
    });
    expect(calls).toEqual([
      {
        url: "https://proxy.example.test/v1/video/create",
        method: "POST",
        authorization: "Bearer sk-video-secret",
        body: expect.objectContaining({
          model: "grok-video-3",
          prompt: "电影感天台追逐",
          aspect_ratio: "3:2",
          size: "720P",
          images: [],
        }),
      },
      {
        url: "https://proxy.example.test/v1/video/query?id=task-video-1",
        method: "GET",
        authorization: "Bearer sk-video-secret",
        body: undefined,
      },
    ]);
    expect(JSON.stringify(started)).not.toContain("sk-video-secret");
    expect(JSON.stringify(polled)).not.toContain("sk-video-secret");
  });

  it("uses a model-visible MemeFast key for media starts and keeps it for polling", async () => {
    const root = createTempRoot(tempRoots);
    const calls: Array<{ url: string; method: string; authorization?: string; body?: unknown }> =
      [];

    await configureMemefast(root, "sk-wrong-model\nsk-video-visible");

    const driver = createMemefastLiveRunProviderDriver(root, {
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          method: init.method,
          authorization: init.headers.Authorization,
          body: init.body === undefined ? undefined : JSON.parse(init.body),
        });
        if (url === "https://proxy.example.test/v1/models") {
          const data =
            init.headers.Authorization === "Bearer sk-video-visible"
              ? [{ id: "grok-video-3" }]
              : [{ id: "deepseek-v3.2" }];
          return jsonResponse({ data });
        }
        if (url === "https://proxy.example.test/v1/video/create") {
          if (init.headers.Authorization !== "Bearer sk-video-visible") {
            return {
              ok: false,
              status: 404,
              statusText: "Not Found",
              text: async () => JSON.stringify({ error: { message: "model not visible for key" } }),
            };
          }
          return jsonResponse({
            data: {
              task_id: "task-visible-key",
              status: "queued",
              poll_url: "/v1/video/query?id=task-visible-key",
            },
          });
        }
        if (url === "https://proxy.example.test/v1/video/query?id=task-visible-key") {
          if (init.headers.Authorization !== "Bearer sk-video-visible") {
            throw new Error(`Poll used wrong key: ${init.headers.Authorization}`);
          }
          return jsonResponse({
            status: "succeeded",
            data: { video_url: "https://cdn.example.test/director-visible-key.mp4" },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    const request = createRequest({
      capabilityId: "video_generation",
      operationId: "video.create",
      input: {
        prompt: "电影感天台追逐",
        model: "grok-video-3",
      },
    });
    const session = createSession(request);

    const started = await driver.start({ request, session });
    const providerTask = started.providerTask;
    if (providerTask === undefined) {
      throw new Error("Expected provider task from async video start.");
    }
    const polled = await driver.poll?.({
      request,
      session: { ...session, providerTask, status: "polling" },
      providerTask,
    });

    expect(
      calls.filter((call) => call.url.endsWith("/v1/models")).map((call) => call.authorization),
    ).toEqual(["Bearer sk-wrong-model", "Bearer sk-video-visible"]);
    expect(
      calls
        .filter((call) => call.url.endsWith("/v1/video/create"))
        .map((call) => call.authorization),
    ).toEqual(["Bearer sk-video-visible"]);
    expect(
      calls
        .filter((call) => call.url.includes("/v1/video/query"))
        .map((call) => call.authorization),
    ).toEqual(["Bearer sk-video-visible"]);
    expect(providerTask.metadata).toMatchObject({
      apiKeySlot: 1,
      apiKeyVisibility: "visible",
    });
    expect(polled).toMatchObject({
      completed: true,
      artifacts: [{ url: "https://cdn.example.test/director-visible-key.mp4" }],
    });
    expect(JSON.stringify(started)).not.toContain("sk-video-visible");
    expect(JSON.stringify(polled)).not.toContain("sk-video-visible");
  });

  it("maps direct image results into live runner artifacts without leaking secrets", async () => {
    const root = createTempRoot(tempRoots);
    const calls: Array<{ url: string; authorization?: string; body?: unknown }> = [];

    await configureMemefast(root, "sk-image-secret");

    const driver = createMemefastLiveRunProviderDriver(root, {
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          authorization: init.headers.Authorization,
          body: init.body === undefined ? undefined : JSON.parse(init.body),
        });
        return jsonResponse({
          data: [{ url: "https://cdn.example.test/director-angel.png" }],
        });
      },
    });
    const request = createRequest({
      capabilityId: "image_generation",
      operationId: "image.generations",
      input: {
        prompt: "导演工作台概念图",
        model: "gpt-image-2",
        size: "1536x1024",
      },
    });

    const result = await driver.start({ request, session: createSession(request) });

    expect(result).toMatchObject({
      completed: true,
      progress: 100,
      artifacts: [
        {
          kind: "image",
          url: "https://cdn.example.test/director-angel.png",
          mimeType: "image/png",
        },
      ],
      metadata: {
        endpoint: "https://proxy.example.test/v1/images/generations",
        routeFamily: "openai_images",
      },
    });
    expect(calls).toEqual([
      {
        url: "https://proxy.example.test/v1/images/generations",
        authorization: "Bearer sk-image-secret",
        body: expect.objectContaining({
          model: "gpt-image-2",
          prompt: "导演工作台概念图",
          n: 1,
          size: "2048x2048",
        }),
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("sk-image-secret");
  });

  it("submits Kling omni through the family request plan and polls the matching endpoint", async () => {
    const root = createTempRoot(tempRoots);
    const calls: Array<{ url: string; method: string; authorization?: string; body?: unknown }> =
      [];

    await configureMemefast(root, "sk-kling-secret");

    const driver = createMemefastLiveRunProviderDriver(root, {
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          method: init.method,
          authorization: init.headers.Authorization,
          body: init.body === undefined ? undefined : JSON.parse(init.body),
        });
        if (url === "https://proxy.example.test/kling/v1/videos/omni-video") {
          return jsonResponse({ data: { task_id: "task-kling-1", task_status: "submitted" } });
        }
        if (url === "https://proxy.example.test/kling/v1/videos/omni-video/task-kling-1") {
          return jsonResponse({
            data: {
              task_status: "succeeded",
              task_result: {
                videos: [{ url: "https://cdn.example.test/kling-omni.mp4" }],
              },
            },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    const request = createRequest({
      capabilityId: "video_generation",
      operationId: "video.create",
      input: {
        prompt: "首尾帧镜头调度",
        model: "kling-omni-video",
        imageWithRoles: [
          { role: "first_frame", url: "https://cdn.example.test/first.png" },
          { role: "last_frame", url: "https://cdn.example.test/last.png" },
        ],
      },
    });
    const session = createSession(request);

    const started = await driver.start({ request, session });
    const providerTask = started.providerTask;
    if (providerTask === undefined) {
      throw new Error("Expected provider task from async Kling start.");
    }
    const polled = await driver.poll?.({
      request,
      session: { ...session, providerTask, status: "polling" },
      providerTask,
    });

    expect(calls).toEqual([
      {
        url: "https://proxy.example.test/kling/v1/videos/omni-video",
        method: "POST",
        authorization: "Bearer sk-kling-secret",
        body: expect.objectContaining({
          model_name: "kling-v3-omni",
          prompt: "首尾帧镜头调度",
          image_list: [
            { image_url: "https://cdn.example.test/first.png", type: "first_frame" },
            { image_url: "https://cdn.example.test/last.png", type: "end_frame" },
          ],
          sound: "on",
        }),
      },
      {
        url: "https://proxy.example.test/kling/v1/videos/omni-video/task-kling-1",
        method: "GET",
        authorization: "Bearer sk-kling-secret",
        body: undefined,
      },
    ]);
    expect(started.providerTask?.metadata).toMatchObject({
      routeFamily: "kling",
      executionPolicy: {
        pollIntervalMs: 5000,
        pollMaxAttempts: 180,
        pollMaxDurationMs: 900000,
      },
      requestPlan: {
        family: "kling",
        adapter: "kling-video",
        endpointPath: "/kling/v1/videos/omni-video",
      },
    });
    expect(started.providerTask?.pollAfterMs).toBe(5000);
    expect(polled).toMatchObject({
      completed: true,
      artifacts: [{ kind: "video", url: "https://cdn.example.test/kling-omni.mp4" }],
    });
  });

  it("rejects Wan requests without a first frame before submitting generation", async () => {
    const root = createTempRoot(tempRoots);
    const calls: Array<{ url: string; method: string; authorization?: string; body?: unknown }> =
      [];

    await configureMemefast(root, "sk-wan-secret");

    const driver = createMemefastLiveRunProviderDriver(root, {
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          method: init.method,
          authorization: init.headers.Authorization,
          body: init.body === undefined ? undefined : JSON.parse(init.body),
        });
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    const request = createRequest({
      capabilityId: "video_generation",
      operationId: "video.create",
      input: { prompt: "缺首帧测试", model: "wan2.6-i2v" },
    });

    await expect(driver.start({ request, session: createSession(request) })).rejects.toThrow(
      /requires one first-frame image/u,
    );
    expect(calls).toEqual([]);
  });

  it("submits and polls Suno audio generation without video payload fields", async () => {
    const root = createTempRoot(tempRoots);
    const calls: Array<{ url: string; method: string; authorization?: string; body?: unknown }> =
      [];

    await configureMemefast(root, "sk-suno-secret");

    const driver = createMemefastLiveRunProviderDriver(root, {
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          method: init.method,
          authorization: init.headers.Authorization,
          body: init.body === undefined ? undefined : JSON.parse(init.body),
        });
        if (url === "https://proxy.example.test/suno/submit/music") {
          return jsonResponse({ data: { task_id: "task-suno-1", status: "queued" } });
        }
        if (url === "https://proxy.example.test/suno/fetch/task-suno-1") {
          return jsonResponse({
            status: "succeeded",
            data: {
              audio_url: "https://cdn.example.test/night-ride.mp3",
            },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    const request = createRequest({
      capabilityId: "audio_generation",
      operationId: "audio.music",
      input: {
        prompt: "A cinematic synthwave cue",
        model: "suno_music",
        title: "Night Ride",
        tags: "synthwave, cinematic",
      },
    });
    const session = createSession(request);

    const started = await driver.start({ request, session });
    const providerTask = started.providerTask;
    if (providerTask === undefined) {
      throw new Error("Expected provider task from async Suno start.");
    }
    const polled = await driver.poll?.({
      request,
      session: { ...session, providerTask, status: "polling" },
      providerTask,
    });

    expect(calls).toEqual([
      {
        url: "https://proxy.example.test/suno/submit/music",
        method: "POST",
        authorization: "Bearer sk-suno-secret",
        body: {
          gpt_description_prompt: "A cinematic synthwave cue",
          title: "Night Ride",
          tags: "synthwave, cinematic",
        },
      },
      {
        url: "https://proxy.example.test/suno/fetch/task-suno-1",
        method: "GET",
        authorization: "Bearer sk-suno-secret",
        body: undefined,
      },
    ]);
    expect(started.providerTask?.metadata).toMatchObject({
      routeFamily: "suno",
      mediaKind: "audio",
      executionPolicy: {
        pollIntervalMs: 3000,
        pollMaxAttempts: 120,
        pollMaxDurationMs: 360000,
      },
      requestPlan: {
        family: "suno",
        adapter: "suno-music",
        endpointPath: "/suno/submit/music",
      },
    });
    expect(started.providerTask?.pollAfterMs).toBe(3000);
    expect(calls[0]?.body).not.toHaveProperty("model");
    expect(calls[0]?.body).not.toHaveProperty("images");
    expect(polled).toMatchObject({
      completed: true,
      artifacts: [
        {
          kind: "audio",
          url: "https://cdn.example.test/night-ride.mp3",
          mimeType: "audio/mpeg",
        },
      ],
    });
    expect(JSON.stringify(started)).not.toContain("sk-suno-secret");
    expect(JSON.stringify(polled)).not.toContain("sk-suno-secret");
  });

  it("fails a pending task after its configured poll max attempts", async () => {
    const root = createTempRoot(tempRoots);
    const calls: Array<{ url: string; method: string; authorization?: string; body?: unknown }> =
      [];

    await configureMemefast(root, "sk-poll-secret");

    const driver = createMemefastLiveRunProviderDriver(root, {
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          method: init.method,
          authorization: init.headers.Authorization,
          body: init.body === undefined ? undefined : JSON.parse(init.body),
        });
        if (url === "https://proxy.example.test/v1/video/create") {
          return jsonResponse({
            data: {
              task_id: "task-still-running",
              status: "queued",
              poll_url: "/v1/video/query?id=task-still-running",
            },
          });
        }
        if (url === "https://proxy.example.test/v1/video/query?id=task-still-running") {
          return jsonResponse({ status: "running", progress: 10 });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    const request = createRequest({
      capabilityId: "video_generation",
      operationId: "video.create",
      input: {
        prompt: "长轮询镜头",
        model: "grok-video-3",
      },
    });
    const session = createSession(request);
    const started = await driver.start({ request, session });
    const providerTask = started.providerTask;
    if (providerTask === undefined) {
      throw new Error("Expected provider task from async start.");
    }
    const shortBudgetTask = {
      ...providerTask,
      metadata: {
        ...(providerTask.metadata ?? {}),
        executionPolicy: {
          ...(providerTask.metadata?.executionPolicy as Record<string, unknown>),
          pollMaxAttempts: 1,
          pollMaxDurationMs: 5000,
        },
      },
    };

    const firstPoll = await driver.poll?.({
      request,
      session: { ...session, providerTask: shortBudgetTask, status: "polling" },
      providerTask: shortBudgetTask,
    });
    const secondPoll = await driver.poll?.({
      request,
      session: { ...session, providerTask: firstPoll?.providerTask, status: "polling" },
      providerTask: firstPoll?.providerTask ?? shortBudgetTask,
    });

    expect(firstPoll).toMatchObject({
      completed: false,
      failed: false,
      providerTask: {
        metadata: {
          pollAttempt: 1,
        },
      },
    });
    expect(secondPoll).toMatchObject({
      completed: false,
      failed: true,
      error: {
        code: "memefast-task-poll-timeout",
        retryable: false,
      },
    });
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(1);
  });

  it("retrieves MiniMax video files when polling only returns file_id", async () => {
    const root = createTempRoot(tempRoots);
    const calls: Array<{ url: string; method: string; authorization?: string; body?: unknown }> =
      [];

    await configureMemefast(root, "sk-minimax-secret");

    const driver = createMemefastLiveRunProviderDriver(root, {
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          method: init.method,
          authorization: init.headers.Authorization,
          body: init.body === undefined ? undefined : JSON.parse(init.body),
        });
        if (url === "https://proxy.example.test/minimax/v1/video_generation") {
          return jsonResponse({
            data: { task_id: "task-minimax-1", status: "queued" },
          });
        }
        if (
          url ===
          "https://proxy.example.test/minimax/v1/query/video_generation?task_id=task-minimax-1"
        ) {
          return jsonResponse({
            status: "succeeded",
            data: { data: { file_id: "file-abc" } },
          });
        }
        if (url === "https://proxy.example.test/minimax/v1/files/retrieve?file_id=file-abc") {
          return jsonResponse({
            file: { download_url: "https://cdn.example.test/minimax-file.mp4" },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    const request = createRequest({
      capabilityId: "video_generation",
      operationId: "video.create",
      input: {
        prompt: "海螺镜头",
        model: "MiniMax-Hailuo-2.3",
      },
    });
    const session = createSession(request);

    const started = await driver.start({ request, session });
    const providerTask = started.providerTask;
    if (providerTask === undefined) {
      throw new Error("Expected provider task from async MiniMax start.");
    }
    const polled = await driver.poll?.({
      request,
      session: { ...session, providerTask, status: "polling" },
      providerTask,
    });

    expect(calls.map((call) => call.url)).toEqual([
      "https://proxy.example.test/minimax/v1/video_generation",
      "https://proxy.example.test/minimax/v1/query/video_generation?task_id=task-minimax-1",
      "https://proxy.example.test/minimax/v1/files/retrieve?file_id=file-abc",
    ]);
    expect(polled).toMatchObject({
      completed: true,
      artifacts: [
        {
          kind: "video",
          url: "https://cdn.example.test/minimax-file.mp4",
          mimeType: "video/mp4",
        },
      ],
    });
    expect(JSON.stringify(polled)).not.toContain("sk-minimax-secret");
  });

  it("submits and polls PixVerse text-to-video through the OpenAPI v2 family route", async () => {
    const root = createTempRoot(tempRoots);
    const calls: Array<{
      url: string;
      method: string;
      authorization?: string;
      apiKey?: string;
      body?: unknown;
    }> = [];

    await configureMemefast(root, "sk-pixverse-secret");

    const driver = createMemefastLiveRunProviderDriver(root, {
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          method: init.method,
          authorization: init.headers.Authorization,
          apiKey: init.headers["API-KEY"],
          body: init.body === undefined ? undefined : JSON.parse(init.body),
        });
        if (url === "https://proxy.example.test/openapi/v2/video/text/generate") {
          return jsonResponse({ Resp: { video_id: "pixverse-1", status: "running" } });
        }
        if (url === "https://proxy.example.test/openapi/v2/video/result/pixverse-1") {
          return jsonResponse({
            Resp: {
              status: "succeeded",
              url: "https://cdn.example.test/pixverse.mp4",
            },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    const request = createRequest({
      capabilityId: "video_generation",
      operationId: "video.create",
      input: {
        prompt: "霓虹雨夜的跟拍镜头",
        model: "pixverse-v5.5-t2v",
        aspectRatio: "16:9",
        duration: 8,
        resolution: "1080p",
        audio: true,
      },
    });
    const session = createSession(request);

    const started = await driver.start({ request, session });
    const providerTask = started.providerTask;
    if (providerTask === undefined) {
      throw new Error("Expected provider task from async PixVerse start.");
    }
    const polled = await driver.poll?.({
      request,
      session: { ...session, providerTask, status: "polling" },
      providerTask,
    });

    expect(calls).toEqual([
      {
        url: "https://proxy.example.test/openapi/v2/video/text/generate",
        method: "POST",
        authorization: "Bearer sk-pixverse-secret",
        apiKey: "sk-pixverse-secret",
        body: {
          prompt: "霓虹雨夜的跟拍镜头",
          model: "v5.5",
          duration: 8,
          quality: "1080p",
          generate_audio_switch: true,
          aspect_ratio: "16:9",
        },
      },
      {
        url: "https://proxy.example.test/openapi/v2/video/result/pixverse-1",
        method: "GET",
        authorization: "Bearer sk-pixverse-secret",
        apiKey: "sk-pixverse-secret",
        body: undefined,
      },
    ]);
    expect(started.providerTask?.metadata).toMatchObject({
      routeFamily: "pixverse",
      requestPlan: {
        family: "pixverse",
        adapter: "pixverse-video",
        endpointPath: "/openapi/v2/video/text/generate",
      },
    });
    expect(polled).toMatchObject({
      completed: true,
      artifacts: [{ kind: "video", url: "https://cdn.example.test/pixverse.mp4" }],
    });
    expect(JSON.stringify(polled)).not.toContain("sk-pixverse-secret");
  });

  it("uploads PixVerse image references before image-to-video submit", async () => {
    const root = createTempRoot(tempRoots);
    const calls: Array<{
      url: string;
      method: string;
      authorization?: string;
      apiKey?: string;
      body?: unknown;
    }> = [];

    await configureMemefast(root, "sk-pixverse-upload-secret");

    const driver = createMemefastLiveRunProviderDriver(root, {
      fetchImpl: async (url, init) => {
        let body: unknown;
        if (init.body instanceof FormData) {
          body = { image_url: init.body.get("image_url") };
        } else if (init.body !== undefined) {
          body = JSON.parse(init.body);
        }
        calls.push({
          url,
          method: init.method,
          authorization: init.headers.Authorization,
          apiKey: init.headers["API-KEY"],
          body,
        });
        if (url === "https://proxy.example.test/openapi/v2/image/upload") {
          expect(init.body).toBeInstanceOf(FormData);
          return jsonResponse({ Resp: { img_id: 345 } });
        }
        if (url === "https://proxy.example.test/openapi/v2/video/img/generate") {
          return jsonResponse({ Resp: { video_id: "pixverse-i2v-1", status: "running" } });
        }
        if (url === "https://proxy.example.test/openapi/v2/video/result/pixverse-i2v-1") {
          return jsonResponse({
            Resp: {
              status: "succeeded",
              url: "https://cdn.example.test/pixverse-i2v.mp4",
            },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    const request = createRequest({
      capabilityId: "video_generation",
      operationId: "video.create",
      input: {
        prompt: "让角色缓慢转身",
        model: "pixverse-v5.5-t2v",
        firstFrame: "https://cdn.example.test/first.png",
        duration: 9,
        resolution: "1080p",
      },
    });
    const session = createSession(request);

    const started = await driver.start({ request, session });
    const providerTask = started.providerTask;
    if (providerTask === undefined) {
      throw new Error("Expected provider task from async PixVerse i2v start.");
    }
    const polled = await driver.poll?.({
      request,
      session: { ...session, providerTask, status: "polling" },
      providerTask,
    });

    expect(calls).toEqual([
      {
        url: "https://proxy.example.test/openapi/v2/image/upload",
        method: "POST",
        authorization: "Bearer sk-pixverse-upload-secret",
        apiKey: "sk-pixverse-upload-secret",
        body: { image_url: "https://cdn.example.test/first.png" },
      },
      {
        url: "https://proxy.example.test/openapi/v2/video/img/generate",
        method: "POST",
        authorization: "Bearer sk-pixverse-upload-secret",
        apiKey: "sk-pixverse-upload-secret",
        body: expect.objectContaining({
          prompt: "让角色缓慢转身",
          model: "v5.5",
          duration: 8,
          quality: "1080p",
          img_id: 345,
          motion_mode: "normal",
        }),
      },
      {
        url: "https://proxy.example.test/openapi/v2/video/result/pixverse-i2v-1",
        method: "GET",
        authorization: "Bearer sk-pixverse-upload-secret",
        apiKey: "sk-pixverse-upload-secret",
        body: undefined,
      },
    ]);
    expect(polled).toMatchObject({
      completed: true,
      artifacts: [{ kind: "video", url: "https://cdn.example.test/pixverse-i2v.mp4" }],
    });
    expect(JSON.stringify(started)).not.toContain("sk-pixverse-upload-secret");
    expect(JSON.stringify(polled)).not.toContain("sk-pixverse-upload-secret");
  });

  it("submits OpenAI official Sora video routes as multipart FormData", async () => {
    const root = createTempRoot(tempRoots);
    const calls: Array<{
      url: string;
      method: string;
      authorization?: string;
      contentType?: string;
      body?: unknown;
    }> = [];

    await configureMemefast(root, "sk-sora-secret");

    const driver = createMemefastLiveRunProviderDriver(root, {
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          method: init.method,
          authorization: init.headers.Authorization,
          contentType: init.headers["Content-Type"],
          body: init.body,
        });
        if (url === "https://proxy.example.test/v1/videos") {
          return jsonResponse({
            id: "sora-task-1",
            status: "queued",
          });
        }
        if (url === "https://proxy.example.test/v1/videos/sora-task-1") {
          return jsonResponse({
            status: "succeeded",
            data: { video_url: "https://cdn.example.test/sora.mp4" },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    const request = createRequest({
      capabilityId: "video_generation",
      operationId: "video.create",
      input: {
        prompt: "城市航拍晨光",
        model: "sora-2",
        aspectRatio: "16:9",
        duration: 8,
        firstFrame: "data:image/png;base64,iVBORw0KGgo=",
      },
    });
    const session = createSession(request);

    const started = await driver.start({ request, session });
    const providerTask = started.providerTask;
    if (providerTask === undefined) {
      throw new Error("Expected provider task from Sora start.");
    }
    const polled = await driver.poll?.({
      request,
      session: { ...session, providerTask, status: "polling" },
      providerTask,
    });

    expect(calls[0]).toMatchObject({
      url: "https://proxy.example.test/v1/videos",
      method: "POST",
      authorization: "Bearer sk-sora-secret",
      contentType: undefined,
      body: expect.any(FormData),
    });
    const formEntries = Array.from((calls[0]?.body as FormData).entries());
    expect(formEntries).toEqual(
      expect.arrayContaining([
        ["model", "sora-2"],
        ["prompt", "城市航拍晨光"],
        ["size", "1280x720"],
        ["seconds", "8"],
      ]),
    );
    expect(formEntries.find(([name]) => name === "input_reference")?.[1]).toBeInstanceOf(Blob);
    expect(providerTask.metadata).toMatchObject({
      endpoint: "https://proxy.example.test/v1/videos",
      pollUrl: "https://proxy.example.test/v1/videos/sora-task-1",
      routeFamily: "openai_official",
      requestPlan: {
        family: "sora",
        endpointPath: "/v1/videos",
      },
    });
    expect(polled).toMatchObject({
      completed: true,
      artifacts: [{ kind: "video", url: "https://cdn.example.test/sora.mp4" }],
    });
    expect(JSON.stringify(started)).not.toContain("sk-sora-secret");
    expect(JSON.stringify(polled)).not.toContain("sk-sora-secret");
  });

  it("cancels provider tasks from the live runner driver cancel entrypoint", async () => {
    const root = createTempRoot(tempRoots);
    const calls: Array<{ url: string; method: string; authorization?: string; body?: unknown }> =
      [];

    await configureMemefast(root, "sk-cancel-secret");

    const driver = createMemefastLiveRunProviderDriver(root, {
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          method: init.method,
          authorization: init.headers.Authorization,
          body: init.body === undefined ? undefined : JSON.parse(init.body),
        });
        return jsonResponse({ status: "cancelled", id: "task-video-1" });
      },
    });
    const request = createRequest({
      capabilityId: "video_generation",
      operationId: "video.create",
      input: { prompt: "取消测试", model: "grok-video-3" },
    });
    const session: LiveRunSession = {
      ...createSession(request),
      providerTask: {
        taskId: "task-video-1",
        status: "processing",
        metadata: { cancelUrl: "https://proxy.example.test/v1/video/cancel/task-video-1" },
      },
    };
    const cancelToken: LiveRunCancelToken = {
      runId: request.runId,
      sessionId: session.sessionId,
      requestedAt: "2026-05-10T10:00:03.000Z",
      reason: "operator-stop",
      revoked: true,
    };

    const result = await driver.cancel?.({ request, session, cancelToken });

    expect(result).toMatchObject({
      cancelled: true,
      providerTask: { taskId: "task-video-1", status: "cancelled" },
      metadata: { endpoint: "https://proxy.example.test/v1/video/cancel/task-video-1" },
    });
    expect(calls).toEqual([
      {
        url: "https://proxy.example.test/v1/video/cancel/task-video-1",
        method: "POST",
        authorization: "Bearer sk-cancel-secret",
        body: { reason: "operator-stop", runId: "run-live-1", sessionId: "session-live-1" },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("sk-cancel-secret");
  });

  it("fails closed before fetch when no MemeFast API key is configured", async () => {
    const root = createTempRoot(tempRoots);
    let fetchCalled = false;

    const driver = createMemefastLiveRunProviderDriver(root, {
      fetchImpl: async () => {
        fetchCalled = true;
        return jsonResponse({});
      },
    });
    const request = createRequest({
      capabilityId: "video_generation",
      operationId: "video.create",
      input: { prompt: "缺 key 测试", model: "grok-video-3" },
    });

    await expect(driver.start({ request, session: createSession(request) })).rejects.toMatchObject({
      code: "memefast-api-key-missing",
      retryable: false,
    });
    expect(fetchCalled).toBe(false);
  });
});

async function configureMemefast(root: string, apiKey: string): Promise<void> {
  await updateDirectorApiProviderSetting(root, {
    providerId: "memefast-api",
    key: "apiKey",
    value: apiKey,
    now: "2026-05-10T10:00:00.000Z",
  });
  await updateDirectorApiProviderSetting(root, {
    providerId: "memefast-api",
    key: "baseUrl",
    value: "https://proxy.example.test",
    now: "2026-05-10T10:00:01.000Z",
  });
}

function createTempRoot(tempRoots: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "director-memefast-live-runner-"));
  tempRoots.push(root);
  return root;
}

function createRequest(
  overrides: Pick<LiveRunRequest, "capabilityId" | "operationId" | "input">,
): LiveRunRequest {
  return {
    runId: "run-live-1",
    runnerId: "live-runner.memefast",
    providerId: "memefast-api",
    createdAt: "2026-05-10T10:00:02.000Z",
    ...overrides,
  };
}

function createSession(request: LiveRunRequest): LiveRunSession {
  return createQueuedLiveRunSession(request, {
    sessionId: "session-live-1",
    now: "2026-05-10T10:00:02.000Z",
  }).session;
}

function jsonResponse(value: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify(value),
  };
}
