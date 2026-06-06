import { Buffer } from "node:buffer";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMemefastApiProviderAdapter,
  createMemefastDefaultFeatureBindings,
  createSpeechProviderRegistry,
  createSpeechSynthesisArtifact,
  createSpeechToTextProviderRegistry,
  createSpeechToTextTranscriptArtifact,
  createStaticSpeechProviderPlugin,
  createStaticSpeechToTextProviderPlugin,
  createVoiceBatchSpeechToTextProviderPlugins,
  createVoiceSpeechProviderPlugins,
  diagnoseSpeechProviderPlugin,
  diagnoseSpeechToTextProviderPlugin,
  filterLikelyWhisperHallucinationTranscript,
  loadDirectorApiProviderConfig,
  planLocalWhisperTranscription,
  resolveDirectorApiProviderImageRouteFamily,
  resolveDirectorApiProviderVideoRouteFamily,
  runDirectorApiProviderImageGeneration,
  runDirectorApiProviderTextCompletion,
  runLocalWhisperTranscription,
  runSpeechSynthesis,
  runSpeechToTextTranscription,
  syncDirectorApiProviderModels,
  testDirectorApiProviderConnection,
  updateDirectorApiProviderSetting,
} from "../src/api-provider-adapters.ts";

describe("director-runtime api provider adapters", () => {
  const tempRoots: string[] = [];
  const previousMemefastApiKey = process.env.MEMEFAST_API_KEY;

  beforeEach(() => {
    Reflect.deleteProperty(process.env, "MEMEFAST_API_KEY");
  });

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

  it("exposes memefast as a first-class API provider adapter with copied POST paths", () => {
    const provider = createMemefastApiProviderAdapter();

    expect(provider).toMatchObject({
      id: "memefast-api",
      platform: "memefast",
      name: "魔因API",
      baseUrl: "https://memefast.top",
      capabilities: ["text", "vision", "image_generation", "video_generation", "audio_generation"],
      apiKeyEnvVar: "MEMEFAST_API_KEY",
    });
    expect(provider.models).toEqual(
      expect.arrayContaining([
        "gemini-2.5-flash",
        "gemini-3-pro-preview-thinking",
        "deepseek-v3.2",
        "doubao-seedream-5-0-260128",
        "gpt-image-2",
        "sora-2",
        "doubao-seedance-2-0-260128",
        "grok-video-3",
        "omni-flash",
        "omni-flash-components",
        "happyhorse-1.0-i2v",
        "veo3.1",
        "suno_music",
        "suno_uploads",
      ]),
    );
    expect(provider.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "chat.completions",
          method: "POST",
          path: "/v1/chat/completions",
        }),
        expect.objectContaining({
          id: "image.generations",
          method: "POST",
          path: "/v1/images/generations",
          bodyFields: expect.arrayContaining(["model", "prompt", "size"]),
        }),
        expect.objectContaining({
          id: "image.edits",
          method: "POST",
          path: "/v1/images/edits",
          bodyFields: expect.arrayContaining(["model", "prompt", "image|image[]"]),
        }),
        expect.objectContaining({
          id: "video.create",
          method: "POST",
          path: "/v1/video/create",
        }),
        expect.objectContaining({
          id: "videos.official",
          method: "POST",
          path: "/v1/videos",
          routeFamily: "openai_official_video",
        }),
        expect.objectContaining({
          id: "audio.music",
          method: "POST",
          path: "/suno/submit/music",
          routeFamily: "suno",
        }),
      ]),
    );
    expect(provider.modelMetadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: "doubao-seedance-2-0-260128",
          endpointTypes: expect.arrayContaining(["豆包视频异步"]),
          brandId: "doubao",
          modelFamily: "Seedance",
          videoRouteFamily: "volc",
        }),
        expect.objectContaining({
          model: "wan2.6-i2v",
          endpointTypes: expect.arrayContaining(["异步"]),
          brandId: "alibaba",
          modelFamily: "Wan",
          videoRouteFamily: "wan",
        }),
        expect.objectContaining({
          model: "gpt-image-2",
          endpointTypes: expect.arrayContaining(["image-generation"]),
          brandId: "openai",
          modelFamily: "GPT Image",
          imageRouteFamily: "openai_images",
        }),
        expect.objectContaining({
          model: "suno_music",
          endpointTypes: expect.arrayContaining(["suno音乐"]),
          brandId: "suno",
          modelFamily: "Suno",
          capabilities: ["audio_generation"],
        }),
        expect.objectContaining({
          model: "suno_uploads",
          endpointTypes: expect.arrayContaining(["suno上传"]),
          brandId: "suno",
          modelFamily: "Suno",
          capabilities: ["audio_generation"],
        }),
      ]),
    );
    expect(provider.featureBindings).toMatchObject({
      script_analysis: expect.arrayContaining(["memefast-api:gemini-2.5-flash"]),
      character_generation: expect.arrayContaining(["memefast-api:doubao-seedream-5-0-260128"]),
      video_generation: expect.arrayContaining([
        "memefast-api:sora-2",
        "memefast-api:doubao-seedance-1-5-pro-251215",
      ]),
      freedom_video: expect.arrayContaining([
        "memefast-api:doubao-seedance-2-0-260128",
        "memefast-api:happyhorse-1.0-i2v",
      ]),
      freedom_music: expect.arrayContaining(["memefast-api:suno_music"]),
    });
  });

  it("copies memefast endpoint metadata into deterministic image/video route families", () => {
    expect(resolveDirectorApiProviderImageRouteFamily(["image-generation"], "gpt-image-2")).toBe(
      "openai_images",
    );
    expect(
      resolveDirectorApiProviderImageRouteFamily(["gemini"], "gemini-3-pro-image-preview"),
    ).toBe("openai_chat");
    expect(resolveDirectorApiProviderImageRouteFamily(["omni-image"], "kling-omni-image")).toBe(
      "kling_image",
    );
    expect(
      resolveDirectorApiProviderVideoRouteFamily(["豆包视频异步"], "doubao-seedance-2-0-260128"),
    ).toBe("volc");
    expect(resolveDirectorApiProviderVideoRouteFamily(["异步"], "wan2.6-i2v")).toBe("wan");
    expect(resolveDirectorApiProviderVideoRouteFamily(["openAI官方视频格式"], "sora-2")).toBe(
      "openai_official",
    );
    expect(
      resolveDirectorApiProviderVideoRouteFamily(["happyhorse视频"], "happyhorse-1.0-i2v"),
    ).toBe("happyhorse");
    expect(resolveDirectorApiProviderVideoRouteFamily([], "kling-video")).toBe("kling");
  });

  it("builds memefast feature bindings from the copied provider model inventory", () => {
    const bindings = createMemefastDefaultFeatureBindings(createMemefastApiProviderAdapter());

    expect(bindings).toMatchObject({
      script_analysis: expect.arrayContaining(["memefast-api:gemini-2.5-flash"]),
      image_understanding: expect.arrayContaining(["memefast-api:gemini-3.1-pro-preview"]),
      character_generation: expect.arrayContaining([
        "memefast-api:doubao-seedream-5-0-260128",
        "memefast-api:gemini-3-pro-image-preview",
      ]),
      freedom_image: expect.arrayContaining([
        "memefast-api:gpt-image-2",
        "memefast-api:gpt-image-2-all",
      ]),
      freedom_video: expect.arrayContaining([
        "memefast-api:sora-2",
        "memefast-api:wan2.6-i2v",
        "memefast-api:grok-video-3",
        "memefast-api:omni-flash",
        "memefast-api:omni-flash-components",
        "memefast-api:happyhorse-1.0-i2v",
      ]),
      freedom_music: expect.arrayContaining([
        "memefast-api:suno_music",
        "memefast-api:suno_lyrics",
      ]),
    });
  });

  it("syncs the full memefast model pool from pricing_new and keyed /v1/models metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-model-pool-"));
    tempRoots.push(root);
    const calls: Array<{ url: string; authorization: string | undefined }> = [];

    const result = await syncDirectorApiProviderModels(root, {
      providerId: "memefast-api",
      baseUrl: "https://proxy.example.test/v1",
      apiKey: "sk-sync-secret\nsk-second-secret",
      now: "2026-04-26T10:00:00.000Z",
      fetchImpl: async (url, init) => {
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
                  {
                    model_name: "runway-gen4-turbo",
                    model_type: "音视频",
                    tags: ["视频"],
                    supported_endpoint_types: ["runway图生视频"],
                    enable_groups: ["default"],
                  },
                  {
                    model_name: "suno_music",
                    model_type: "音视频",
                    tags: "音频,音乐",
                    supported_endpoint_types: ["suno音乐"],
                    enable_groups: ["default"],
                  },
                  {
                    model_name: "deepseek-v4-pro",
                    model_type: "文本",
                    tags: "对话,推理",
                    supported_endpoint_types: ["openai"],
                    enable_groups: ["纯AZ"],
                  },
                ],
              }),
          };
        }
        if (url === "https://proxy.example.test/v1/models") {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({
                data: [
                  { id: "operator-only-model", supported_endpoint_types: ["aigc-video"] },
                  { id: "qwen-image-max", supported_endpoint_types: ["dall-e-3"] },
                ],
              }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    expect(calls).toEqual([
      { url: "https://proxy.example.test/api/pricing_new", authorization: undefined },
      { url: "https://proxy.example.test/v1/models", authorization: "Bearer sk-sync-secret" },
      { url: "https://proxy.example.test/v1/models", authorization: "Bearer sk-second-secret" },
    ]);
    expect(result).toMatchObject({
      providerId: "memefast-api",
      ok: true,
      pricingEndpoint: "https://proxy.example.test/api/pricing_new",
      modelsEndpoint: "https://proxy.example.test/v1/models",
      syncedAt: "2026-04-26T10:00:00.000Z",
      count: expect.any(Number),
      metadataCount: 5,
      endpointTypeCount: 5,
    });
    expect(result.count).toBeGreaterThan(40);

    const loaded = loadDirectorApiProviderConfig(root);
    const provider = loaded.document.providers[0];
    expect(provider?.models).toEqual(
      expect.arrayContaining([
        "gemini-2.5-flash",
        "qwen-image-max",
        "runway-gen4-turbo",
        "suno_music",
        "operator-only-model",
        "deepseek-v4-pro",
      ]),
    );
    expect(provider?.modelMetadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: "qwen-image-max",
          modelType: "图像",
          tags: expect.arrayContaining(["生图", "编辑"]),
          enableGroups: expect.arrayContaining(["default", "官转"]),
          endpointTypes: ["dall-e-3"],
          capabilities: ["image_generation"],
          imageRouteFamily: "openai_images",
        }),
        expect.objectContaining({
          model: "runway-gen4-turbo",
          modelType: "音视频",
          tags: ["视频"],
          endpointTypes: ["runway图生视频"],
          capabilities: ["video_generation"],
          videoRouteFamily: "unified",
        }),
        expect.objectContaining({
          model: "suno_music",
          modelType: "音视频",
          tags: expect.arrayContaining(["音频", "音乐"]),
          endpointTypes: ["suno音乐"],
          capabilities: ["audio_generation"],
        }),
        expect.objectContaining({
          model: "operator-only-model",
          endpointTypes: ["aigc-video"],
          capabilities: ["video_generation"],
          videoRouteFamily: "unified",
        }),
        expect.objectContaining({
          model: "deepseek-v4-pro",
          modelType: "文本",
          tags: expect.arrayContaining(["对话", "推理"]),
          endpointTypes: ["openai"],
          capabilities: expect.arrayContaining(["text", "reasoning"]),
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("sk-sync-secret");
    expect(JSON.stringify(result.config.document)).not.toContain("sk-sync-secret");
    expect(provider?.featureBindings.freedom_music).toEqual(
      expect.arrayContaining(["memefast-api:suno_music"]),
    );
  });

  it("syncs with a saved api key and lets new family models inherit route metadata safely", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-model-pool-saved-key-"));
    tempRoots.push(root);
    const calls: Array<{ url: string; authorization: string | undefined }> = [];

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test/v1",
      now: "2026-04-26T09:58:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-stored-secret",
      now: "2026-04-26T09:59:00.000Z",
    });

    const result = await syncDirectorApiProviderModels(root, {
      providerId: "memefast-api",
      now: "2026-04-26T10:00:00.000Z",
      fetchImpl: async (url, init) => {
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
                    tags: "视频,豆包",
                    supported_endpoint_types: ["豆包视频异步"],
                    enable_groups: ["default"],
                  },
                  {
                    model_name: "neutral-volc-route-model",
                    model_type: "音视频",
                    tags: "视频,端点继承",
                    supported_endpoint_types: ["豆包视频异步"],
                    enable_groups: ["default"],
                  },
                  {
                    model_name: "gpt-image-3",
                    model_type: "图像",
                    tags: "生图",
                    supported_endpoint_types: ["image-generation"],
                    enable_groups: ["default"],
                  },
                  {
                    model_name: "neutral-image-route-model",
                    model_type: "图像",
                    tags: "生图,端点继承",
                    supported_endpoint_types: ["image-generation"],
                    enable_groups: ["default"],
                  },
                  {
                    model_name: "neutral-kling-image-route-model",
                    model_type: "图像",
                    tags: "生图,可灵端点继承",
                    supported_endpoint_types: ["文生图"],
                    enable_groups: ["default"],
                  },
                  {
                    model_name: "neutral-openai-video-route-model",
                    model_type: "音视频",
                    tags: "视频,openai端点继承",
                    supported_endpoint_types: ["openai"],
                    enable_groups: ["default"],
                  },
                  {
                    model_name: "deepseek-v5-pro",
                    model_type: "文本",
                    tags: "对话,推理",
                    supported_endpoint_types: ["openai"],
                    enable_groups: ["纯AZ"],
                  },
                ],
              }),
          };
        }
        if (url === "https://proxy.example.test/v1/models") {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({
                data: [
                  {
                    id: "happyhorse-2.0-i2v",
                    supported_endpoint_types: ["happyhorse视频"],
                  },
                  {
                    id: "neutral-horse-route-model",
                    supported_endpoint_types: ["happyhorse视频"],
                  },
                  {
                    id: "account-only-openai-chat-model",
                    supported_endpoint_types: ["openai"],
                  },
                ],
              }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    const loaded = loadDirectorApiProviderConfig(root);
    const provider = loaded.document.providers[0];
    const metadataByModel = new Map(provider?.modelMetadata.map((item) => [item.model, item]));

    expect(calls).toEqual([
      { url: "https://proxy.example.test/api/pricing_new", authorization: undefined },
      { url: "https://proxy.example.test/v1/models", authorization: "Bearer sk-stored-secret" },
    ]);
    expect(result).toMatchObject({
      ok: true,
      metadataCount: 10,
      endpointTypeCount: 10,
      accountModelStatusCount: 1,
    });
    expect(metadataByModel.get("doubao-seedance-3-0-260528")).toMatchObject({
      modelType: "音视频",
      capabilities: ["video_generation"],
      videoRouteFamily: "volc",
    });
    expect(metadataByModel.get("neutral-volc-route-model")).toMatchObject({
      modelType: "音视频",
      capabilities: ["video_generation"],
      videoRouteFamily: "volc",
    });
    expect(metadataByModel.get("happyhorse-2.0-i2v")).toMatchObject({
      capabilities: ["video_generation"],
      videoRouteFamily: "happyhorse",
    });
    expect(metadataByModel.get("neutral-horse-route-model")).toMatchObject({
      capabilities: ["video_generation"],
      videoRouteFamily: "happyhorse",
    });
    expect(metadataByModel.get("gpt-image-3")).toMatchObject({
      modelType: "图像",
      brandId: "openai",
      modelFamily: "GPT Image",
      capabilities: ["image_generation"],
      imageRouteFamily: "openai_images",
    });
    expect(metadataByModel.get("neutral-image-route-model")).toMatchObject({
      modelType: "图像",
      capabilities: ["image_generation"],
      imageRouteFamily: "openai_images",
    });
    expect(metadataByModel.get("neutral-kling-image-route-model")).toMatchObject({
      modelType: "图像",
      capabilities: ["image_generation"],
      imageRouteFamily: "kling_image",
    });
    expect(metadataByModel.get("neutral-openai-video-route-model")).toMatchObject({
      modelType: "音视频",
      brandId: "other",
      capabilities: ["video_generation"],
      videoRouteFamily: "unified",
    });
    expect(metadataByModel.get("deepseek-v5-pro")).toMatchObject({
      modelType: "文本",
      endpointTypes: ["openai"],
      capabilities: expect.arrayContaining(["text"]),
      imageRouteFamily: "openai_chat",
    });
    expect(metadataByModel.get("account-only-openai-chat-model")).toMatchObject({
      endpointTypes: ["openai"],
      capabilities: ["text"],
      imageRouteFamily: "openai_chat",
      videoRouteFamily: "unified",
    });
    expect(provider?.featureBindings.freedom_video).toEqual(
      expect.arrayContaining([
        "memefast-api:doubao-seedance-3-0-260528",
        "memefast-api:happyhorse-2.0-i2v",
        "memefast-api:neutral-volc-route-model",
        "memefast-api:neutral-horse-route-model",
        "memefast-api:neutral-openai-video-route-model",
      ]),
    );
    expect(provider?.featureBindings.freedom_image).toEqual(
      expect.arrayContaining([
        "memefast-api:gpt-image-3",
        "memefast-api:neutral-image-route-model",
        "memefast-api:neutral-kling-image-route-model",
      ]),
    );
    expect(provider?.featureBindings.freedom_image).not.toContain("memefast-api:deepseek-v5-pro");
    expect(provider?.featureBindings.freedom_image).not.toContain(
      "memefast-api:account-only-openai-chat-model",
    );
    expect(provider?.featureBindings.freedom_video).not.toContain(
      "memefast-api:account-only-openai-chat-model",
    );
    expect(JSON.stringify(result.config.document)).not.toContain("sk-stored-secret");
  });

  it("loads default providers and masks stored api keys in snapshots", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-"));
    tempRoots.push(root);
    const configPath = join(root, "providers.json");

    const initial = loadDirectorApiProviderConfig(root);
    expect(initial.document.providers[0]).toMatchObject({
      id: "memefast-api",
      apiKeyConfigured: false,
      apiKeyMasked: "未设置",
    });

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-real-secret",
      now: "2026-04-26T10:00:00.000Z",
    });
    const loaded = loadDirectorApiProviderConfig(root);
    const stored = readFileSync(configPath, "utf8");

    expect(stored).toContain("sk-real-secret");
    expect(loaded.document.providers[0]).toMatchObject({
      apiKeyConfigured: true,
      apiKeyMasked: "sk-...cret",
    });
    expect(JSON.stringify(loaded.document)).not.toContain("sk-real-secret");
  });

  it("tests provider connection with the first supplied api key without leaking secrets", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-test-"));
    tempRoots.push(root);
    const calls: Array<{ url: string; authorization: string | undefined }> = [];

    const result = await testDirectorApiProviderConnection(root, {
      providerId: "memefast-api",
      baseUrl: "https://proxy.example.test",
      apiKey: "sk-first-secret\nsk-second-secret",
      now: "2026-04-26T10:00:00.000Z",
      fetchImpl: async (url, init) => {
        calls.push({ url, authorization: init.headers.Authorization });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ data: [{ id: "gemini-2.5-flash" }] }),
        };
      },
    });

    expect(calls).toEqual([
      {
        url: "https://proxy.example.test/v1/models",
        authorization: "Bearer sk-first-secret",
      },
    ]);
    expect(result).toMatchObject({
      providerId: "memefast-api",
      ok: true,
      endpoint: "https://proxy.example.test/v1/models",
      status: 200,
      modelCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain("sk-first-secret");
    expect(JSON.stringify(result)).not.toContain("sk-second-secret");
  });

  it("runs text completion through the configured provider without leaking secrets", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-run-"));
    tempRoots.push(root);
    const calls: Array<{
      url: string;
      authorization: string | undefined;
      body: unknown;
    }> = [];

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-first-secret\nsk-second-secret",
      now: "2026-04-26T10:00:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
      now: "2026-04-26T10:01:00.000Z",
    });

    const result = await runDirectorApiProviderTextCompletion(root, {
      prompt: "写一句导演工作台问候",
      now: "2026-04-26T10:02:00.000Z",
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          authorization: init.headers.Authorization,
          body: JSON.parse(String(init.body)),
        });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              choices: [{ message: { content: "Angel 已经开始真实运行。" } }],
              usage: { prompt_tokens: 12, completion_tokens: 8 },
            }),
        };
      },
    });

    expect(calls).toEqual([
      {
        url: "https://proxy.example.test/v1/chat/completions",
        authorization: "Bearer sk-first-secret",
        body: expect.objectContaining({
          model: "gemini-2.5-flash",
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "user", content: "写一句导演工作台问候" }),
          ]),
        }),
      },
    ]);
    expect(result).toMatchObject({
      providerId: "memefast-api",
      model: "gemini-2.5-flash",
      ok: true,
      endpoint: "https://proxy.example.test/v1/chat/completions",
      output: "Angel 已经开始真实运行。",
      promptTokens: 12,
      completionTokens: 8,
    });
    expect(JSON.stringify(result)).not.toContain("sk-first-secret");
    expect(JSON.stringify(result)).not.toContain("sk-second-secret");
  });

  it("can route direct text completion through the OpenAI responses adapter", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-run-responses-"));
    tempRoots.push(root);
    const calls: Array<{
      url: string;
      authorization: string | undefined;
      body: unknown;
    }> = [];

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-responses-secret",
      now: "2026-04-26T10:00:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
      now: "2026-04-26T10:01:00.000Z",
    });

    const result = await runDirectorApiProviderTextCompletion(root, {
      prompt: "用 responses 生成一句导演提示",
      model: "gpt-5.4",
      llmAdapter: "openai_responses",
      now: "2026-04-26T10:02:00.000Z",
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          authorization: init.headers.Authorization,
          body: JSON.parse(String(init.body)),
        });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              output_text: "Responses adapter 已接入。",
              usage: { input_tokens: 10, output_tokens: 6 },
            }),
        };
      },
    });

    expect(calls).toEqual([
      {
        url: "https://proxy.example.test/v1/responses",
        authorization: "Bearer sk-responses-secret",
        body: expect.objectContaining({
          model: "gpt-5.4",
          input: expect.stringContaining("用 responses 生成一句导演提示"),
        }),
      },
    ]);
    expect(calls[0]?.body).not.toHaveProperty("messages");
    expect(result).toMatchObject({
      providerId: "memefast-api",
      model: "gpt-5.4",
      ok: true,
      endpoint: "https://proxy.example.test/v1/responses",
      output: "Responses adapter 已接入。",
      promptTokens: 10,
      completionTokens: 6,
    });
    expect(JSON.stringify(result)).not.toContain("sk-responses-secret");
  });

  it("preserves reference images when direct text completion uses the Gemini generateContent adapter", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-run-gemini-vision-"));
    tempRoots.push(root);
    const calls: Array<{
      url: string;
      authorization: string | undefined;
      body: unknown;
    }> = [];

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-gemini-vision-secret",
      now: "2026-04-26T10:00:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
      now: "2026-04-26T10:01:00.000Z",
    });

    const result = await runDirectorApiProviderTextCompletion(root, {
      prompt: "描述这张导演参考图",
      model: "gemini-3-pro-preview",
      llmAdapter: "gemini_generate_content",
      referenceImages: ["https://cdn.example.test/frame.jpg"],
      capabilityRoute: { abilityGroup: "vision", reason: "image understanding" },
      now: "2026-04-26T10:02:00.000Z",
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          authorization: init.headers.Authorization,
          body: JSON.parse(String(init.body)),
        });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: "画面是一个雨夜街头参考帧。" }],
                  },
                },
              ],
              usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 9 },
            }),
        };
      },
    });

    expect(calls).toEqual([
      {
        url: "https://proxy.example.test/v1beta/models/gemini-3-pro-preview:generateContent",
        authorization: "Bearer sk-gemini-vision-secret",
        body: expect.objectContaining({
          contents: [
            {
              role: "user",
              parts: [
                { text: "描述这张导演参考图" },
                {
                  file_data: {
                    mime_type: "image/jpeg",
                    file_uri: "https://cdn.example.test/frame.jpg",
                  },
                },
              ],
            },
          ],
        }),
      },
    ]);
    expect(result).toMatchObject({
      providerId: "memefast-api",
      model: "gemini-3-pro-preview",
      ok: true,
      endpoint: "https://proxy.example.test/v1beta/models/gemini-3-pro-preview:generateContent",
      output: "画面是一个雨夜街头参考帧。",
      promptTokens: 15,
      completionTokens: 9,
    });
    expect(JSON.stringify(result)).not.toContain("sk-gemini-vision-secret");
  });

  it("streams text completion deltas when the caller opts into streaming", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-run-stream-"));
    tempRoots.push(root);
    const calls: Array<{
      url: string;
      authorization: string | undefined;
      body: unknown;
    }> = [];
    const deltas: string[] = [];
    const encoder = new TextEncoder();

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-stream-secret",
      now: "2026-04-26T10:00:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
      now: "2026-04-26T10:01:00.000Z",
    });

    const result = await runDirectorApiProviderTextCompletion(root, {
      prompt: "写一句导演工作台问候",
      now: "2026-04-26T10:02:00.000Z",
      onStreamDelta: (delta) => {
        deltas.push(delta);
      },
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          authorization: init.headers.Authorization,
          body: JSON.parse(String(init.body)),
        });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => "",
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'data: {"id":"resp-1","choices":[{"delta":{"content":"你"},"finish_reason":null}]}\n\n',
                ),
              );
              controller.enqueue(
                encoder.encode(
                  'data: {"id":"resp-1","choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\n',
                ),
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
        };
      },
    });

    expect(calls).toEqual([
      {
        url: "https://proxy.example.test/v1/chat/completions",
        authorization: "Bearer sk-stream-secret",
        body: expect.objectContaining({
          stream: true,
        }),
      },
    ]);
    expect(deltas).toEqual(["你", "好"]);
    expect(result).toMatchObject({
      providerId: "memefast-api",
      ok: true,
      output: "你好",
    });
  });

  it("parses non-SSE JSON tool calls when streaming is requested", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-run-stream-json-tools-"));
    tempRoots.push(root);
    const deltas: string[] = [];

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-stream-tool-secret",
      now: "2026-04-26T10:00:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
      now: "2026-04-26T10:01:00.000Z",
    });

    const result = await runDirectorApiProviderTextCompletion(root, {
      prompt: "查一下当前能力",
      now: "2026-04-26T10:02:00.000Z",
      onStreamDelta: (delta) => {
        deltas.push(delta);
      },
      fetchImpl: async () => ({
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
                      id: "call-capabilities",
                      type: "function",
                      function: {
                        name: "director.capabilities.inspect",
                        arguments: JSON.stringify({ verbose: true }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
      }),
    });

    expect(deltas).toEqual([]);
    expect(result).toMatchObject({
      providerId: "memefast-api",
      ok: true,
      toolCalls: [
        {
          id: "call-capabilities",
          name: "director.capabilities.inspect",
          args: { verbose: true },
        },
      ],
    });
  });

  it("does not emit stream deltas for non-SSE JSON text fallback", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-run-stream-json-text-"));
    tempRoots.push(root);
    const deltas: string[] = [];

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-stream-json-secret",
      now: "2026-04-26T10:00:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
      now: "2026-04-26T10:01:00.000Z",
    });

    const result = await runDirectorApiProviderTextCompletion(root, {
      prompt: "写一句导演工作台问候",
      now: "2026-04-26T10:02:00.000Z",
      onStreamDelta: (delta) => {
        deltas.push(delta);
      },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "一次性 JSON 回包。",
                },
              },
            ],
          }),
      }),
    });

    expect(deltas).toEqual([]);
    expect(result).toMatchObject({
      providerId: "memefast-api",
      ok: true,
      output: "一次性 JSON 回包。",
    });
  });

  it("routes media understanding text completion to the provider vision default model", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-run-vision-route-"));
    tempRoots.push(root);
    const calls: Array<{
      url: string;
      authorization: string | undefined;
      body: unknown;
    }> = [];

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-vision-secret",
      now: "2026-05-13T04:00:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
      now: "2026-05-13T04:01:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "defaultTextModel",
      value: "deepseek-v3.2",
      now: "2026-05-13T04:02:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "defaultVisionModel",
      value: "gemini-3.1-pro-preview",
      now: "2026-05-13T04:03:00.000Z",
    });

    const result = await runDirectorApiProviderTextCompletion(root, {
      prompt: "看这张图里有什么",
      capabilityRoute: {
        abilityGroup: "vision",
        intentKind: "media_understanding",
        inputModalities: ["text", "image"],
        outputModality: "text",
        requiresMediaUnderstanding: true,
        explicitGeneration: false,
        textModelCanHandleVision: false,
        reason: "输入包含图片，当前文本模型不具备理解能力，切到视觉组。",
      },
      now: "2026-05-13T04:04:00.000Z",
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          authorization: init.headers.Authorization,
          body: JSON.parse(String(init.body)),
        });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              choices: [{ message: { content: "这张图里有一块导演工作台。" } }],
            }),
        };
      },
    });

    expect(calls[0]).toMatchObject({
      url: "https://proxy.example.test/v1/chat/completions",
      authorization: "Bearer sk-vision-secret",
      body: expect.objectContaining({
        model: "gemini-3.1-pro-preview",
      }),
    });
    expect(result).toMatchObject({
      ok: true,
      model: "gemini-3.1-pro-preview",
      output: "这张图里有一块导演工作台。",
    });
  });

  it("keeps text route away from pure image and video generation defaults", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-run-text-filter-"));
    tempRoots.push(root);
    const calls: Array<{
      url: string;
      authorization: string | undefined;
      body: unknown;
    }> = [];

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-text-secret",
      now: "2026-05-13T04:10:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
      now: "2026-05-13T04:11:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "defaultTextModel",
      value: "gpt-image-2",
      now: "2026-05-13T04:12:00.000Z",
    });

    const result = await runDirectorApiProviderTextCompletion(root, {
      prompt: "最近生成图片分镜图哪个模型厉害？",
      capabilityRoute: {
        abilityGroup: "text",
        intentKind: "text_chat",
        inputModalities: ["text"],
        outputModality: "text",
        requiresMediaUnderstanding: false,
        explicitGeneration: false,
        reason: "默认日常对话走文本组。",
      },
      now: "2026-05-13T04:13:00.000Z",
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          authorization: init.headers.Authorization,
          body: JSON.parse(String(init.body)),
        });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              choices: [{ message: { content: "这是一个文本问答，不会走生图模型。" } }],
            }),
        };
      },
    });

    expect(calls[0]).toMatchObject({
      body: expect.objectContaining({
        model: "gemini-2.5-flash",
      }),
    });
    expect(JSON.stringify(calls[0]?.body)).not.toContain("gpt-image-2");
    expect(JSON.stringify(calls[0]?.body)).not.toContain("sora-2");
    expect(result).toMatchObject({
      ok: true,
      model: "gemini-2.5-flash",
      output: "这是一个文本问答，不会走生图模型。",
    });
  });

  it("retries text completion with the next api key on provider rate limits", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-run-retry-key-"));
    tempRoots.push(root);
    const calls: Array<{
      url: string;
      authorization: string | undefined;
      body: unknown;
    }> = [];

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-rate-limited\nsk-backup-secret",
      now: "2026-04-26T10:00:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
      now: "2026-04-26T10:01:00.000Z",
    });

    const result = await runDirectorApiProviderTextCompletion(root, {
      prompt: "生成一版制作草案",
      now: "2026-04-26T10:02:00.000Z",
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          authorization: init.headers.Authorization,
          body: JSON.parse(String(init.body)),
        });
        if (calls.length === 1) {
          return {
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
            text: async () => JSON.stringify({ error: { message: "rate limited" } }),
          };
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              choices: [{ message: { content: "已切换备用 Key 并生成制作草案。" } }],
            }),
        };
      },
    });

    expect(calls.map((call) => call.authorization)).toEqual([
      "Bearer sk-rate-limited",
      "Bearer sk-backup-secret",
    ]);
    expect(
      calls.every((call) => call.url === "https://proxy.example.test/v1/chat/completions"),
    ).toBe(true);
    expect(result).toMatchObject({
      providerId: "memefast-api",
      model: "gemini-2.5-flash",
      ok: true,
      output: "已切换备用 Key 并生成制作草案。",
      retryCount: 1,
      fallbackKeysTried: 2,
    });
    expect(result.message).toContain("已自动切换 1 次");
    expect(JSON.stringify(result)).not.toContain("sk-rate-limited");
    expect(JSON.stringify(result)).not.toContain("sk-backup-secret");
  });

  it("prioritizes memefast keys where the requested text model is visible before running chat", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-run-visible-key-"));
    tempRoots.push(root);
    const calls: Array<{
      url: string;
      authorization: string | undefined;
      body?: unknown;
    }> = [];

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-gemini-only\nsk-deepseek-a\nsk-deepseek-b",
      now: "2026-04-26T10:00:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy-visible.example.test",
      now: "2026-04-26T10:01:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "defaultTextModel",
      value: "deepseek-v3.2",
      now: "2026-04-26T10:01:30.000Z",
    });

    const result = await runDirectorApiProviderTextCompletion(root, {
      prompt: "用 deepseek 回一句中文",
      now: "2026-04-26T10:02:00.000Z",
      maxAttempts: 2,
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          authorization: init.headers.Authorization,
          ...(init.body === undefined ? {} : { body: JSON.parse(String(init.body)) }),
        });
        if (url === "https://proxy-visible.example.test/v1/models") {
          const authorization = init.headers.Authorization;
          const data =
            authorization === "Bearer sk-gemini-only"
              ? [{ id: "gemini-2.5-flash" }]
              : [{ id: "deepseek-v3.2" }];
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () => JSON.stringify({ data }),
          };
        }
        if (init.headers.Authorization !== "Bearer sk-deepseek-a") {
          return {
            ok: false,
            status: 404,
            statusText: "Not Found",
            text: async () => JSON.stringify({ error: { message: "model not visible for key" } }),
          };
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              choices: [{ message: { content: "deepseek 可见 Key 已优先命中。" } }],
            }),
        };
      },
    });

    const chatCalls = calls.filter((call) => call.url.endsWith("/v1/chat/completions"));
    expect(
      calls.filter((call) => call.url.endsWith("/v1/models")).map((call) => call.authorization),
    ).toEqual(["Bearer sk-gemini-only", "Bearer sk-deepseek-a", "Bearer sk-deepseek-b"]);
    expect(chatCalls.map((call) => call.authorization)).toEqual(["Bearer sk-deepseek-a"]);
    expect(result).toMatchObject({
      ok: true,
      model: "deepseek-v3.2",
      output: "deepseek 可见 Key 已优先命中。",
    });
    expect(JSON.stringify(result)).not.toContain("sk-deepseek-a");
  });

  it("rotates memefast text retries by inferred routing group before reusing a failed group", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-run-routing-group-"));
    tempRoots.push(root);
    const calls: Array<{
      url: string;
      authorization: string | undefined;
      body?: unknown;
    }> = [];

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-group-a1\nsk-group-a2\nsk-group-b1",
      now: "2026-04-26T10:00:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy-groups.example.test",
      now: "2026-04-26T10:01:00.000Z",
    });
    await syncDirectorApiProviderModels(root, {
      providerId: "memefast-api",
      now: "2026-04-26T10:01:30.000Z",
      fetchImpl: async (url, init) => {
        if (url === "https://proxy-groups.example.test/api/pricing_new") {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({
                data: [
                  {
                    model_name: "deepseek-v3.2",
                    model_type: "文本",
                    tags: "对话",
                    supported_endpoint_types: ["openai"],
                    enable_groups: ["A", "B"],
                  },
                  {
                    model_name: "a-only-visible-model",
                    model_type: "文本",
                    tags: "对话",
                    supported_endpoint_types: ["openai"],
                    enable_groups: ["A"],
                  },
                  {
                    model_name: "b-only-visible-model",
                    model_type: "文本",
                    tags: "对话",
                    supported_endpoint_types: ["openai"],
                    enable_groups: ["B"],
                  },
                ],
              }),
          };
        }
        const authorization = init.headers.Authorization;
        const data =
          authorization === "Bearer sk-group-b1"
            ? [{ id: "deepseek-v3.2" }, { id: "b-only-visible-model" }]
            : [{ id: "deepseek-v3.2" }, { id: "a-only-visible-model" }];
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ data }),
        };
      },
    });

    const result = await runDirectorApiProviderTextCompletion(root, {
      prompt: "生成一条稳定回复",
      model: "deepseek-v3.2",
      now: "2026-04-26T10:02:00.000Z",
      maxAttempts: 3,
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          authorization: init.headers.Authorization,
          ...(init.body === undefined ? {} : { body: JSON.parse(String(init.body)) }),
        });
        if (url === "https://proxy-groups.example.test/v1/models") {
          const authorization = init.headers.Authorization;
          const data =
            authorization === "Bearer sk-group-b1"
              ? [{ id: "deepseek-v3.2" }, { id: "b-only-visible-model" }]
              : [{ id: "deepseek-v3.2" }, { id: "a-only-visible-model" }];
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () => JSON.stringify({ data }),
          };
        }
        if (init.headers.Authorization === "Bearer sk-group-a1") {
          return {
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
            text: async () => JSON.stringify({ error: { message: "A 分组限流" } }),
          };
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              choices: [{ message: { content: "已跨分组切换后成功。" } }],
            }),
        };
      },
    });

    const chatCalls = calls.filter((call) => call.url.endsWith("/v1/chat/completions"));
    expect(chatCalls.map((call) => call.authorization)).toEqual([
      "Bearer sk-group-a1",
      "Bearer sk-group-b1",
    ]);
    expect(result).toMatchObject({
      ok: true,
      model: "deepseek-v3.2",
      output: "已跨分组切换后成功。",
      retryCount: 1,
      fallbackKeysTried: 2,
    });
    expect(JSON.stringify(result)).not.toContain("sk-group-b1");
  });

  it("passes chat tools through text completion and parses returned tool calls", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-tools-"));
    tempRoots.push(root);
    const calls: Array<{
      url: string;
      authorization: string | undefined;
      body: unknown;
    }> = [];

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-tool-secret",
      now: "2026-04-26T10:00:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
      now: "2026-04-26T10:01:00.000Z",
    });

    const result = await runDirectorApiProviderTextCompletion(root, {
      prompt: "去搜索 seedance2.0 最新玩法并学习下来",
      messages: [
        { role: "system", content: "有工具就调用工具。" },
        { role: "user", content: "去搜索 seedance2.0 最新玩法并学习下来" },
      ],
      tools: [
        {
          name: "director.learning.query",
          description: "Search and learn public materials.",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      ],
      now: "2026-04-26T10:02:00.000Z",
      fetchImpl: async (url, init) => {
        calls.push({
          url,
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
              usage: { prompt_tokens: 18, completion_tokens: 5 },
            }),
        };
      },
    });

    expect(calls[0]).toMatchObject({
      url: "https://proxy.example.test/v1/chat/completions",
      authorization: "Bearer sk-tool-secret",
      body: expect.objectContaining({
        model: "gemini-2.5-flash",
        tool_choice: "auto",
        tools: [
          expect.objectContaining({
            type: "function",
            function: expect.objectContaining({
              name: "director.learning.query",
            }),
          }),
        ],
      }),
    });
    expect(result).toMatchObject({
      ok: true,
      toolCalls: [
        {
          id: "call-learning-1",
          name: "director.learning.query",
          args: { query: "seedance2.0 最新玩法" },
        },
      ],
      promptTokens: 18,
      completionTokens: 5,
    });
    expect(JSON.stringify(result)).not.toContain("sk-tool-secret");
  });

  it("adds Gemini 3 thought signatures when replaying tool calls through Memefast chat completions", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-gemini-tool-replay-"));
    tempRoots.push(root);
    const calls: Array<{
      url: string;
      authorization: string | undefined;
      body: Record<string, unknown>;
    }> = [];

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-gemini-tool-secret",
      now: "2026-04-26T10:00:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
      now: "2026-04-26T10:01:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "defaultTextModel",
      value: "gemini-3-flash-preview",
      now: "2026-04-26T10:01:30.000Z",
    });

    const result = await runDirectorApiProviderTextCompletion(root, {
      prompt: "发来看看",
      messages: [
        { role: "system", content: "直接中文回复。" },
        { role: "user", content: "发来看看" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call-list-candidates",
              name: "director.experience.candidates.list",
              args: { maxItems: 5 },
            },
          ],
        },
        {
          role: "tool",
          toolCallId: "call-list-candidates",
          content: "1. Web lesson\n摘要：低置信经验提炼。",
        },
      ],
      now: "2026-04-26T10:02:00.000Z",
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          authorization: init.headers.Authorization,
          body: JSON.parse(String(init.body)),
        });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              choices: [{ message: { content: "这条候选我发你看：Web lesson。" } }],
            }),
        };
      },
    });

    const messages = calls[0]?.body.messages as Array<Record<string, unknown>>;
    const assistant = messages.find((message) => message.role === "assistant");
    const toolCalls = assistant?.tool_calls as Array<Record<string, unknown>>;
    expect(toolCalls[0]).toMatchObject({
      id: "call-list-candidates",
      type: "function",
      function: expect.objectContaining({
        name: "director.experience.candidates.list",
      }),
      extra_content: {
        google: {
          thought_signature: "skip_thought_signature_validator",
        },
      },
    });
    expect(result).toMatchObject({
      ok: true,
      model: "gemini-3-flash-preview",
      output: "这条候选我发你看：Web lesson。",
    });
    expect(JSON.stringify(result)).not.toContain("sk-gemini-tool-secret");
  });

  it("runs image generation through the configured provider without leaking secrets", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-image-"));
    tempRoots.push(root);
    const calls: Array<{
      url: string;
      authorization: string | undefined;
      body: unknown;
    }> = [];

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-first-secret\nsk-second-secret",
      now: "2026-04-26T10:00:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
      now: "2026-04-26T10:01:00.000Z",
    });

    const result = await runDirectorApiProviderImageGeneration(root, {
      prompt: "电影感导演工作台",
      now: "2026-04-26T10:02:00.000Z",
      fetchImpl: async (url, init) => {
        calls.push({
          url,
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
    });

    expect(calls).toEqual([
      {
        url: "https://proxy.example.test/v1/images/generations",
        authorization: "Bearer sk-first-secret",
        body: expect.objectContaining({
          model: "gpt-image-2",
          prompt: "电影感导演工作台",
          n: 1,
          size: "2048x2048",
        }),
      },
    ]);
    expect(result).toMatchObject({
      providerId: "memefast-api",
      model: "gpt-image-2",
      ok: true,
      endpoint: "https://proxy.example.test/v1/images/generations",
      output: "https://cdn.example.test/director-angel.png",
      images: [{ url: "https://cdn.example.test/director-angel.png" }],
    });
    expect(JSON.stringify(result)).not.toContain("sk-first-secret");
    expect(JSON.stringify(result)).not.toContain("sk-second-secret");
  });

  it("routes direct GPT Image reference edits through the dedicated edits endpoint", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-gpt-image-edit-"));
    tempRoots.push(root);
    const calls: Array<{
      url: string;
      authorization: string | undefined;
      contentType: string | undefined;
      body: unknown;
    }> = [];

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-gpt-image-edit-secret",
      now: "2026-04-26T10:00:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
      now: "2026-04-26T10:01:00.000Z",
    });
    const localReferencePath = join(root, "local-reference.png");
    writeFileSync(localReferencePath, Buffer.from("local-reference"));

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    let result: Awaited<ReturnType<typeof runDirectorApiProviderImageGeneration>> | undefined;
    let usedMoyinMediaTimeout = false;
    try {
      result = await runDirectorApiProviderImageGeneration(root, {
        prompt: "保留人物姿态，改成雨夜霓虹",
        model: "gpt-image-2",
        aspectRatio: "16:9",
        referenceImages: [
          "data:image/png;base64,iVBORw0KGgo=",
          Buffer.from("raw-reference".repeat(12)).toString("base64"),
          `local-image://${encodeURIComponent(localReferencePath)}`,
        ],
        now: "2026-04-26T10:02:00.000Z",
        fetchImpl: async (url, init) => {
          calls.push({
            url,
            authorization: init.headers.Authorization,
            contentType: init.headers["Content-Type"],
            body: init.body,
          });
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({
                data: [{ url: "https://cdn.example.test/gpt-image-edit.png" }],
              }),
          };
        },
      });
      usedMoyinMediaTimeout = setTimeoutSpy.mock.calls.some(
        ([, timeoutMs]) => timeoutMs === 500_000,
      );
    } finally {
      setTimeoutSpy.mockRestore();
    }
    expect(usedMoyinMediaTimeout).toBe(true);
    if (result === undefined) {
      throw new Error("Expected image generation result.");
    }

    expect(calls).toEqual([
      {
        url: "https://proxy.example.test/v1/images/edits",
        authorization: "Bearer sk-gpt-image-edit-secret",
        contentType: undefined,
        body: expect.any(FormData),
      },
    ]);
    const formEntries = Array.from((calls[0]?.body as FormData).entries());
    expect(formEntries).toEqual(
      expect.arrayContaining([
        ["model", "gpt-image-2"],
        ["prompt", "保留人物姿态，改成雨夜霓虹"],
        ["n", "1"],
        ["size", "1536x1024"],
      ]),
    );
    expect(formEntries.some(([name]) => name === "images" || name === "image_urls")).toBe(false);
    const uploads = formEntries.filter(([name]) => name === "image").map(([, value]) => value);
    expect(uploads).toHaveLength(3);
    expect(uploads[0]).toBeInstanceOf(Blob);
    expect(uploads[1]).toBeInstanceOf(Blob);
    expect(uploads[2]).toBeInstanceOf(Blob);
    expect(result).toMatchObject({
      providerId: "memefast-api",
      model: "gpt-image-2",
      ok: true,
      endpoint: "https://proxy.example.test/v1/images/edits",
      images: [{ url: "https://cdn.example.test/gpt-image-edit.png" }],
    });
    expect(JSON.stringify(result)).not.toContain("sk-gpt-image-edit-secret");
  });

  it("rehosts local image references through zhongzhuan ImageProxy for JSON image_url routes", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-zhongzhuan-image-host-"));
    tempRoots.push(root);
    const imageProxyCalls: Array<{ url: string; method: string; body: unknown }> = [];
    const providerCalls: Array<{
      url: string;
      authorization: string | undefined;
      body: Record<string, unknown>;
    }> = [];

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-seedream-secret",
      now: "2026-04-26T10:03:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
      now: "2026-04-26T10:04:00.000Z",
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      imageProxyCalls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body,
      });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => JSON.stringify({ url: "https://imageproxy.zhongzhuan.chat/u/ref.png" }),
      } as Response;
    });
    let result: Awaited<ReturnType<typeof runDirectorApiProviderImageGeneration>> | undefined;
    try {
      result = await runDirectorApiProviderImageGeneration(root, {
        prompt: "保持角色动作，改成雪夜",
        model: "doubao-seedream-5-0-260128",
        referenceImages: ["data:image/png;base64,iVBORw0KGgo="],
        now: "2026-04-26T10:05:00.000Z",
        fetchImpl: async (url, init) => {
          providerCalls.push({
            url,
            authorization: init.headers.Authorization,
            body: JSON.parse(String(init.body)),
          });
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({
                data: [{ url: "https://cdn.example.test/seedream.png" }],
              }),
          };
        },
      });
    } finally {
      fetchSpy.mockRestore();
    }
    if (result === undefined) {
      throw new Error("Expected image generation result.");
    }

    expect(imageProxyCalls).toEqual([
      {
        url: "https://imageproxy.zhongzhuan.chat/api/upload",
        method: "POST",
        body: expect.any(FormData),
      },
    ]);
    expect((imageProxyCalls[0]?.body as FormData).get("file")).toBeInstanceOf(Blob);
    expect(providerCalls).toEqual([
      {
        url: "https://proxy.example.test/v1/images/generations",
        authorization: "Bearer sk-seedream-secret",
        body: expect.objectContaining({
          model: "doubao-seedream-5-0-260128",
          prompt: "保持角色动作，改成雪夜",
          image_urls: ["https://imageproxy.zhongzhuan.chat/u/ref.png"],
        }),
      },
    ]);
    expect(result).toMatchObject({
      ok: true,
      images: [{ url: "https://cdn.example.test/seedream.png" }],
    });
  });

  it("routes direct Gemini image generation through the chat image adapter", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-gemini-image-"));
    tempRoots.push(root);
    const calls: Array<{
      url: string;
      authorization: string | undefined;
      body: unknown;
    }> = [];

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-gemini-image-secret",
      now: "2026-04-26T10:00:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test",
      now: "2026-04-26T10:01:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "defaultImageModel",
      value: "gemini-3-pro-image-preview",
      now: "2026-04-26T10:01:30.000Z",
    });

    const result = await runDirectorApiProviderImageGeneration(root, {
      prompt: "电影感导演工作台",
      size: "16:9",
      now: "2026-04-26T10:02:00.000Z",
      fetchImpl: async (url, init) => {
        calls.push({
          url,
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
                    content: "![generated](https://cdn.example.test/gemini-direct.png)",
                  },
                },
              ],
            }),
        };
      },
    });

    expect(calls).toEqual([
      {
        url: "https://proxy.example.test/v1/chat/completions",
        authorization: "Bearer sk-gemini-image-secret",
        body: expect.objectContaining({
          model: "gemini-3-pro-image-preview",
          messages: [
            expect.objectContaining({
              role: "user",
              content: expect.arrayContaining([
                expect.objectContaining({ type: "text", text: expect.stringContaining("16:9") }),
              ]),
            }),
          ],
        }),
      },
    ]);
    expect(calls[0]?.body).not.toHaveProperty("n");
    expect(result).toMatchObject({
      providerId: "memefast-api",
      model: "gemini-3-pro-image-preview",
      ok: true,
      endpoint: "https://proxy.example.test/v1/chat/completions",
      images: [{ url: "https://cdn.example.test/gemini-direct.png" }],
    });
    expect(JSON.stringify(result)).not.toContain("sk-gemini-image-secret");
  });

  it("prioritizes memefast keys where the requested image model is visible before generating", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-image-visible-key-"));
    tempRoots.push(root);
    const calls: Array<{
      url: string;
      authorization: string | undefined;
      body?: unknown;
    }> = [];

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "sk-text-only\nsk-image-visible",
      now: "2026-04-26T10:00:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy-image-visible.example.test",
      now: "2026-04-26T10:01:00.000Z",
    });

    const result = await runDirectorApiProviderImageGeneration(root, {
      prompt: "电影感导演工作台",
      model: "gpt-image-2",
      now: "2026-04-26T10:02:00.000Z",
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          authorization: init.headers.Authorization,
          ...(init.body === undefined ? {} : { body: JSON.parse(String(init.body)) }),
        });
        if (url === "https://proxy-image-visible.example.test/v1/models") {
          const data =
            init.headers.Authorization === "Bearer sk-image-visible"
              ? [{ id: "gpt-image-2" }]
              : [{ id: "deepseek-v3.2" }];
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () => JSON.stringify({ data }),
          };
        }
        if (init.headers.Authorization !== "Bearer sk-image-visible") {
          return {
            ok: false,
            status: 404,
            statusText: "Not Found",
            text: async () => JSON.stringify({ error: { message: "model not visible for key" } }),
          };
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              data: [{ url: "https://cdn.example.test/director-angel-visible.png" }],
            }),
        };
      },
    });

    expect(
      calls.filter((call) => call.url.endsWith("/v1/models")).map((call) => call.authorization),
    ).toEqual(["Bearer sk-text-only", "Bearer sk-image-visible"]);
    expect(
      calls
        .filter((call) => call.url.endsWith("/v1/images/generations"))
        .map((call) => call.authorization),
    ).toEqual(["Bearer sk-image-visible"]);
    expect(result).toMatchObject({
      providerId: "memefast-api",
      model: "gpt-image-2",
      ok: true,
      images: [{ url: "https://cdn.example.test/director-angel-visible.png" }],
    });
    expect(JSON.stringify(result)).not.toContain("sk-image-visible");
  });

  it("updates memefast base url, enabled state, model list, and default models without changing endpoint templates", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-api-provider-update-"));
    tempRoots.push(root);

    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "baseUrl",
      value: "https://proxy.example.test/v1",
      now: "2026-04-26T10:00:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "enabled",
      value: false,
      now: "2026-04-26T10:01:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "defaultVideoModel",
      value: "sora-2-pro",
      now: "2026-04-26T10:02:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "defaultVisionModel",
      value: "gemini-3.1-pro-preview",
      now: "2026-04-26T10:03:00.000Z",
    });
    await updateDirectorApiProviderSetting(root, {
      providerId: "memefast-api",
      key: "models",
      value: "gemini-2.5-flash\ngpt-image-2, sora-2-pro",
      now: "2026-04-26T10:04:00.000Z",
    });

    const loaded = loadDirectorApiProviderConfig(root);
    const provider = loaded.document.providers[0];

    expect(provider).toMatchObject({
      baseUrl: "https://proxy.example.test/v1",
      enabled: false,
      defaultModels: expect.objectContaining({
        vision: "gemini-3.1-pro-preview",
        video_generation: "sora-2-pro",
      }),
    });
    expect(provider?.models).toEqual(
      expect.arrayContaining(["gemini-2.5-flash", "gpt-image-2", "sora-2-pro"]),
    );
    expect(provider?.models.length).toBeGreaterThan(3);
    expect(provider?.endpoints.map((endpoint) => endpoint.path)).toEqual(
      expect.arrayContaining(["/v1/images/generations", "/v1/video/create"]),
    );
  });

  it("declares batch STT providers as fail-closed plugins with Chinese diagnostics", async () => {
    const plugins = createVoiceBatchSpeechToTextProviderPlugins();
    const ids = plugins.map((plugin) => plugin.id);

    expect(ids).toEqual([
      "local-whisper-cli",
      "local-faster-whisper",
      "openai-compatible-stt",
      "groq-stt",
      "mistral-stt",
      "xai-stt",
      "memefast-compatible-stt",
    ]);
    for (const plugin of plugins) {
      expect(plugin.capabilityId).toBe("audio.transcribe");
      expect(plugin.sideEffects).toMatchObject({
        microphoneAccessed: false,
        rawAudioPersisted: false,
        providerCredentialsUsed: false,
        whisperStarted: false,
      });
      await expect(diagnoseSpeechToTextProviderPlugin(plugin)).resolves.toMatchObject({
        ok: false,
        status: "blocked",
        reason: expect.stringMatching(/未配置|未安装|默认关闭/u),
      });
    }
  });

  it("routes batch STT through a provider registry without writing memory or reading raw audio by default", async () => {
    const registry = createSpeechToTextProviderRegistry([
      createStaticSpeechToTextProviderPlugin({
        id: "mock-stt",
        displayName: "Mock STT",
        configured: true,
        models: ["mock-whisper-large"],
        transcribe: async (input) => ({
          ok: true,
          providerId: "mock-stt",
          model: input.model ?? "mock-whisper-large",
          transcript: "这是转写出来的文字",
          language: "zh",
          durationMs: 1200,
          segments: [
            {
              startMs: 0,
              endMs: 1200,
              text: "这是转写出来的文字",
              final: true,
            },
          ],
        }),
      }),
    ]);

    const result = await runSpeechToTextTranscription(registry, {
      providerId: "mock-stt",
      model: "mock-whisper-large",
      source: {
        kind: "file-ref",
        path: "/tmp/director-audio.wav",
        mimeType: "audio/wav",
        sizeBytes: 4096,
        durationMs: 1200,
      },
      language: "zh",
    });

    expect(result).toMatchObject({
      ok: true,
      providerId: "mock-stt",
      model: "mock-whisper-large",
      transcript: "这是转写出来的文字",
      language: "zh",
      memoryWrite: false,
      sideEffects: {
        microphoneAccessed: false,
        rawAudioPersisted: false,
        providerCredentialsUsed: false,
      },
      artifact: {
        kind: "text",
        capabilityId: "audio.transcribe",
        metadata: {
          sourceKind: "file-ref",
          mimeType: "audio/wav",
          language: "zh",
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("sk-");
  });

  it("blocks empty or unavailable batch STT inputs instead of spinning", async () => {
    const registry = createSpeechToTextProviderRegistry([
      createStaticSpeechToTextProviderPlugin({
        id: "not-configured-stt",
        displayName: "Not Configured STT",
        configured: false,
        reason: "STT 供应商还没有配置 API Key。",
      }),
    ]);

    await expect(
      runSpeechToTextTranscription(registry, {
        providerId: "not-configured-stt",
        source: {
          kind: "inline-bytes",
          mimeType: "audio/wav",
          sizeBytes: 0,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      reason: expect.stringContaining("音频为空"),
    });

    await expect(
      runSpeechToTextTranscription(registry, {
        providerId: "missing-stt",
        source: {
          kind: "file-ref",
          path: "/tmp/director-audio.wav",
          mimeType: "audio/wav",
          sizeBytes: 1000,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      reason: expect.stringContaining("没有找到语音转文字供应商"),
    });
  });

  it("creates transcript artifacts without storing raw audio or long-term memory", () => {
    const artifact = createSpeechToTextTranscriptArtifact({
      providerId: "mock-stt",
      model: "mock-whisper-large",
      transcript: "一句可审核的转写文本",
      language: "zh",
      source: {
        kind: "weixin-voice",
        messageId: "wx-msg-1",
        mimeType: "audio/silk",
        durationMs: 900,
        sizeBytes: 2048,
      },
    });

    expect(artifact).toMatchObject({
      id: expect.stringContaining("audio-transcript-"),
      kind: "text",
      text: "一句可审核的转写文本",
      capabilityId: "audio.transcribe",
      memoryWrite: false,
      metadata: {
        sourceKind: "weixin-voice",
        providerId: "mock-stt",
        rawAudioPersisted: false,
      },
    });
  });

  it("plans local Whisper with exact argv, model allowlist, authorized paths, timeout, and no shell string", () => {
    const result = planLocalWhisperTranscription({
      providerId: "local-whisper-cli",
      executable: "whisper",
      inputPath: "/tmp/voice-in.wav",
      outputDir: "/tmp/director-stt",
      allowedInputRoots: ["/tmp"],
      allowedOutputRoots: ["/tmp/director-stt"],
      model: "whisper-large-v3",
      language: "zh",
      timeoutMs: 45_000,
    });

    expect(result).toMatchObject({
      ok: true,
      providerId: "local-whisper-cli",
      plan: {
        command: "whisper",
        args: [
          "/tmp/voice-in.wav",
          "--model",
          "whisper-large-v3",
          "--language",
          "zh",
          "--output_dir",
          "/tmp/director-stt",
          "--output_format",
          "json",
        ],
        timeoutMs: 45_000,
        networkPolicy: "none",
        stdin: false,
        shell: false,
      },
      sideEffects: {
        localProcessStarted: false,
        whisperStarted: false,
        rawAudioPersisted: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain(";");
  });

  it("blocks local Whisper plans when model or paths are not explicitly allowed", () => {
    expect(
      planLocalWhisperTranscription({
        providerId: "local-whisper-cli",
        executable: "whisper",
        inputPath: "/private/voice.wav",
        outputDir: "/tmp/director-stt",
        allowedInputRoots: ["/tmp"],
        allowedOutputRoots: ["/tmp/director-stt"],
        model: "whisper-large-v3",
      }),
    ).toMatchObject({
      ok: false,
      status: "blocked",
      reason: expect.stringContaining("输入音频路径不在授权目录内"),
    });

    expect(
      planLocalWhisperTranscription({
        providerId: "local-whisper-cli",
        executable: "whisper",
        inputPath: "/tmp/voice.wav",
        outputDir: "/tmp/director-stt",
        allowedInputRoots: ["/tmp"],
        allowedOutputRoots: ["/tmp/director-stt"],
        model: "unapproved-model",
      }),
    ).toMatchObject({
      ok: false,
      status: "blocked",
      reason: expect.stringContaining("不在允许列表"),
    });
  });

  it("runs local Whisper only through a sandbox runner and caps command output", async () => {
    const rawCalls: unknown[] = [];
    const sandboxCalls: Array<{ command: string; args: readonly string[]; timeoutMs: number }> = [];

    const result = await runLocalWhisperTranscription({
      providerId: "local-whisper-cli",
      executable: "whisper",
      inputPath: "/tmp/voice-in.wav",
      outputDir: "/tmp/director-stt",
      allowedInputRoots: ["/tmp"],
      allowedOutputRoots: ["/tmp/director-stt"],
      model: "whisper-large-v3",
      timeoutMs: 45_000,
      commandRunner: async () => {
        rawCalls.push("raw");
        return { exitCode: 0, stdout: "raw", stderr: "" };
      },
      sandboxCommandRunner: async ({ plan }) => {
        sandboxCalls.push({
          command: plan.command,
          args: plan.args,
          timeoutMs: plan.timeoutMs,
        });
        return {
          exitCode: 0,
          stdout: `${"x".repeat(2000)}\n{"text":"这是沙箱转写结果"}`,
          stderr: "ok",
          sandbox: {
            ok: true,
            status: "completed",
            providerId: "agent-os-sandbox.host",
            evidence: {
              planHash: "plan-hash",
              commandHash: "command-hash",
            },
          },
        };
      },
    });

    expect(result).toMatchObject({
      ok: true,
      providerId: "local-whisper-cli",
      transcript: "这是沙箱转写结果",
      sideEffects: {
        localProcessStarted: true,
        whisperStarted: true,
        rawAudioPersisted: false,
      },
      sandbox: {
        ok: true,
        status: "completed",
        evidence: {
          planHash: "plan-hash",
          commandHash: "command-hash",
        },
      },
    });
    expect(result.stdoutSummary.length).toBeLessThanOrEqual(512);
    expect(rawCalls).toEqual([]);
    expect(sandboxCalls).toEqual([
      {
        command: "whisper",
        args: [
          "/tmp/voice-in.wav",
          "--model",
          "whisper-large-v3",
          "--output_dir",
          "/tmp/director-stt",
          "--output_format",
          "json",
        ],
        timeoutMs: 45_000,
      },
    ]);
  });

  it("keeps local Whisper fail-closed without sandbox runner and filters silence hallucinations", async () => {
    const result = await runLocalWhisperTranscription({
      providerId: "local-whisper-cli",
      executable: "whisper",
      inputPath: "/tmp/voice-in.wav",
      outputDir: "/tmp/director-stt",
      allowedInputRoots: ["/tmp"],
      allowedOutputRoots: ["/tmp/director-stt"],
      model: "whisper-large-v3",
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      reason: expect.stringContaining("需要 Agent OS 沙箱执行器"),
      sideEffects: {
        localProcessStarted: false,
        whisperStarted: false,
      },
    });
    expect(filterLikelyWhisperHallucinationTranscript("Thank you.")).toBe("");
    expect(filterLikelyWhisperHallucinationTranscript("请把这段语音整理成任务")).toBe(
      "请把这段语音整理成任务",
    );
  });

  it("declares TTS providers as fail-closed plugins with Chinese diagnostics", async () => {
    const plugins = createVoiceSpeechProviderPlugins();
    const ids = plugins.map((plugin) => plugin.id);

    expect(ids).toEqual([
      "openai-compatible-tts",
      "memefast-compatible-tts",
      "local-cli-tts",
      "piper-tts",
      "edge-compatible-tts",
    ]);
    for (const plugin of plugins) {
      expect(plugin.capabilityId).toBe("audio.synthesize");
      expect(plugin.sideEffects).toMatchObject({
        speakerAccessed: false,
        providerCredentialsUsed: false,
        networkUsed: false,
        localProcessStarted: false,
        autoplayed: false,
      });
      await expect(diagnoseSpeechProviderPlugin(plugin)).resolves.toMatchObject({
        ok: false,
        status: "blocked",
        reason: expect.stringMatching(/未配置|默认关闭|未安装/u),
      });
    }
  });

  it("synthesizes speech into an audio artifact without autoplay or memory writes", async () => {
    const registry = createSpeechProviderRegistry([
      createStaticSpeechProviderPlugin({
        id: "mock-tts",
        displayName: "Mock TTS",
        configured: true,
        voices: ["zh-CN-Xiaoxiao"],
        models: ["mock-tts-model"],
        synthesize: async (input) => ({
          ok: true,
          providerId: "mock-tts",
          model: input.model ?? "mock-tts-model",
          voice: input.voice ?? "zh-CN-Xiaoxiao",
          audio: {
            uri: "artifact://speech/mock-1.wav",
            mimeType: "audio/wav",
            sizeBytes: 2048,
            durationMs: 1600,
          },
        }),
      }),
    ]);

    const result = await runSpeechSynthesis(registry, {
      providerId: "mock-tts",
      text: "**你好**，请朗读这句话。",
      voice: "zh-CN-Xiaoxiao",
      model: "mock-tts-model",
      format: "wav",
    });

    expect(result).toMatchObject({
      ok: true,
      providerId: "mock-tts",
      model: "mock-tts-model",
      voice: "zh-CN-Xiaoxiao",
      autoplay: false,
      memoryWrite: false,
      artifact: {
        kind: "audio",
        capabilityId: "audio.synthesize",
        uri: "artifact://speech/mock-1.wav",
        mimeType: "audio/wav",
        metadata: {
          providerId: "mock-tts",
          voice: "zh-CN-Xiaoxiao",
          autoplay: false,
          rawTextPersisted: false,
        },
      },
      sideEffects: {
        speakerAccessed: false,
        providerCredentialsUsed: false,
        autoplayed: false,
      },
    });
    expect(result.normalizedText).toBe("你好，请朗读这句话。");
    expect(JSON.stringify(result)).not.toContain("sk-");
  });

  it("blocks TTS when provider is missing, text is empty, or text is too long", async () => {
    const registry = createSpeechProviderRegistry([
      createStaticSpeechProviderPlugin({
        id: "not-configured-tts",
        displayName: "Not Configured TTS",
        configured: false,
        reason: "TTS 供应商还没有配置 API Key。",
      }),
    ]);

    await expect(
      runSpeechSynthesis(registry, {
        providerId: "missing-tts",
        text: "你好",
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      reason: expect.stringContaining("没有找到语音合成供应商"),
    });

    await expect(
      runSpeechSynthesis(registry, {
        providerId: "not-configured-tts",
        text: "   ",
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      reason: expect.stringContaining("朗读文本为空"),
    });

    await expect(
      runSpeechSynthesis(registry, {
        providerId: "not-configured-tts",
        text: "字".repeat(5001),
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      reason: expect.stringContaining("朗读文本太长"),
    });
  });

  it("creates TTS audio artifacts without raw text persistence or autoplay", () => {
    const artifact = createSpeechSynthesisArtifact({
      providerId: "mock-tts",
      model: "mock-tts-model",
      voice: "zh-CN-Xiaoxiao",
      uri: "artifact://speech/mock-2.mp3",
      mimeType: "audio/mpeg",
      durationMs: 900,
      sizeBytes: 1024,
    });

    expect(artifact).toMatchObject({
      id: expect.stringContaining("speech-audio-"),
      kind: "audio",
      capabilityId: "audio.synthesize",
      uri: "artifact://speech/mock-2.mp3",
      memoryWrite: false,
      metadata: {
        providerId: "mock-tts",
        rawTextPersisted: false,
        autoplay: false,
      },
    });
  });
});
