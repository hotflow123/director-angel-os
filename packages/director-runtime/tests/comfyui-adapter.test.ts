import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ExternalToolRegistry,
  createExternalToolControlPlane,
  createExternalToolsEffectiveRpcResult,
  invokeExternalTool,
} from "@hotflow/conversation-runtime";

import {
  inspectDirectorComfyUiHealth,
  inspectDirectorComfyUiWorkflow,
  loadDirectorComfyUiConfig,
  planDirectorComfyUiDependencyFix,
  planDirectorComfyUiInstall,
  runDirectorComfyUiDependencyFix,
  runDirectorComfyUiInstall,
  runDirectorComfyUiLifecycleAction,
  runDirectorComfyUiWorkflow,
  testDirectorComfyUiConnection,
  updateDirectorComfyUiSetting,
} from "../src/comfyui-adapter.ts";
import { createDirectorRuntimeComfyUiProviderRegistration } from "../src/comfyui-provider-bridge.ts";
import {
  createDirectorComfyUiVisibleWorkflowDraft,
  parseDirectorComfyUiWorkflowDraftIntent,
  publishDirectorComfyUiTemplateBridge,
} from "../src/comfyui-visible-workflow.ts";

describe("director-runtime ComfyUI external adapter", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads a disabled local ComfyUI adapter by default without exposing secrets", () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-default-"));
    tempRoots.push(root);

    const loaded = loadDirectorComfyUiConfig(root);

    expect(loaded.document.adapter).toMatchObject({
      id: "comfyui-media",
      platform: "comfyui",
      name: "ComfyUI",
      mode: "local",
      baseUrl: "http://127.0.0.1:8188",
      enabled: false,
      apiKeyConfigured: false,
      apiKeyMasked: "未设置",
      supportedModes: ["text_to_image", "text_to_video", "image_to_video"],
    });
    expect(JSON.stringify(loaded.document)).not.toContain("secret");
  });

  it("updates ComfyUI settings and masks the stored api key in snapshots", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-update-"));
    tempRoots.push(root);

    await updateDirectorComfyUiSetting(root, {
      key: "enabled",
      value: true,
      now: "2026-05-01T10:00:00.000Z",
    });
    await updateDirectorComfyUiSetting(root, {
      key: "baseUrl",
      value: "http://localhost:8188/",
      now: "2026-05-01T10:01:00.000Z",
    });
    await updateDirectorComfyUiSetting(root, {
      key: "apiKey",
      value: "comfy-secret-key",
      now: "2026-05-01T10:02:00.000Z",
    });
    const loaded = await updateDirectorComfyUiSetting(root, {
      key: "positivePromptNodeId",
      value: "6",
      now: "2026-05-01T10:03:00.000Z",
    });
    const stored = readFileSync(join(root, "comfyui.json"), "utf8");

    expect(stored).toContain("comfy-secret-key");
    expect(loaded.document.adapter).toMatchObject({
      enabled: true,
      baseUrl: "http://localhost:8188",
      apiKeyConfigured: true,
      apiKeyMasked: "com...key",
      positivePromptNodeId: "6",
    });
    expect(JSON.stringify(loaded.document)).not.toContain("comfy-secret-key");
  });

  it("publishes visible workflow templates through the ComfyUI custom-node bridge", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-template-"));
    tempRoots.push(root);
    const localInstallPath = join(root, "ComfyUI");
    mkdirSync(join(localInstallPath, "custom_nodes"), { recursive: true });

    const workflow = createDirectorComfyUiVisibleWorkflowDraft({
      id: "draft-1",
      kind: "script",
      objective: "一个小猪学习游泳的30秒故事",
      status: "draft",
      executable: false,
      createdAt: "2026-05-01T10:02:00.000Z",
    });

    const result = await publishDirectorComfyUiTemplateBridge({
      baseUrl: "http://127.0.0.1:8188/",
      mode: "local",
      templateName: "director draft 1",
      workflow,
      localInstallPath,
      fetchImpl: async (url) => {
        expect(url).toBe(
          "http://127.0.0.1:8188/api/workflow_templates/director_angel_bridge/director-draft-1.json",
        );
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify(workflow),
        };
      },
    });

    expect(result).toMatchObject({
      ok: true,
      directOpenReady: true,
      sourceModule: "director_angel_bridge",
      templateName: "director-draft-1",
      openUrl: "http://127.0.0.1:8188/?template=director-draft-1&source=director_angel_bridge",
    });
    const bridgeModule = readFileSync(
      join(localInstallPath, "custom_nodes", "director_angel_bridge", "__init__.py"),
      "utf8",
    );
    expect(bridgeModule).toContain("/workflow_templates/director_angel_bridge/{name}.json");
    expect(
      existsSync(
        join(
          localInstallPath,
          "custom_nodes",
          "director_angel_bridge",
          "workflows",
          "director-draft-1.json",
        ),
      ),
    ).toBe(true);
  });

  it("creates a script-only ComfyUI workflow as a connected text preview chain", () => {
    const workflow = createDirectorComfyUiVisibleWorkflowDraft({
      id: "draft-script",
      kind: "script",
      workflowModes: ["script"],
      objective: "一个小猪学习游泳的30秒故事",
      status: "draft",
      executable: false,
      createdAt: "2026-05-01T10:02:00.000Z",
      angelOutput: "脚本草案\n小猪第一次下水，朋友鼓励，最后学会漂浮。",
    });

    expect(workflow.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "PrimitiveStringMultiline",
          title: "Angel 脚本文本",
          outputs: [expect.objectContaining({ type: "STRING", links: [1] })],
        }),
        expect.objectContaining({
          type: "PreviewAny",
          title: "预览脚本文本",
          inputs: [expect.objectContaining({ type: "STRING", link: 1 })],
        }),
      ]),
    );
    expect(workflow.nodes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "WanTextToImageApi" }),
        expect.objectContaining({ type: "WanTextToVideoApi" }),
      ]),
    );
    expect(workflow.links).toContainEqual([1, 2, 0, 3, 0, "STRING"]);
    expect(workflow.extra.directorAngel.workflowModes).toEqual(["script"]);
  });

  it("parses ComfyUI workflow draft intent once for all channel adapters", () => {
    expect(parseDirectorComfyUiWorkflowDraftIntent("脚本 一个小猪学习游泳的30秒故事")).toEqual({
      workflowKind: "script",
      workflowModes: ["script"],
      objective: "一个小猪学习游泳的30秒故事",
    });
    expect(
      parseDirectorComfyUiWorkflowDraftIntent("脚本+图片+视频 一个小猪学习游泳的30秒故事"),
    ).toEqual({
      workflowKind: "script",
      workflowModes: ["script", "image", "video"],
      objective: "一个小猪学习游泳的30秒故事",
    });
    expect(
      parseDirectorComfyUiWorkflowDraftIntent(
        "创建脚本+图片+视频工作流：一个小猪学习游泳的30秒故事",
      ),
    ).toEqual({
      workflowKind: "script",
      workflowModes: ["script", "image", "video"],
      objective: "一个小猪学习游泳的30秒故事",
    });
    expect(
      parseDirectorComfyUiWorkflowDraftIntent(
        "create script+image+video workflow: a piglet learns swimming",
      ),
    ).toEqual({
      workflowKind: "script",
      workflowModes: ["script", "image", "video"],
      objective: "a piglet learns swimming",
    });
    expect(parseDirectorComfyUiWorkflowDraftIntent("打开界面")).toBeNull();
  });

  it("creates a scene-linked script plus image plus video workflow where each scene image feeds image-to-video", () => {
    const workflow = createDirectorComfyUiVisibleWorkflowDraft({
      id: "draft-full",
      kind: "script",
      workflowModes: ["script", "image", "video"],
      objective: "一个小猪学习游泳的30秒故事，3个场景",
      status: "draft",
      executable: false,
      createdAt: "2026-05-01T10:02:00.000Z",
      angelOutput: [
        "完整脚本：小猪第一次学习游泳。",
        "场景1：小猪站在池塘边发抖。",
        "图片提示词：小猪站在阳光池塘边，紧张但可爱，电影感",
        "视频提示词：小猪试探性把脚伸进水里，水面轻轻波动",
        "场景2：朋友鼓励小猪下水。",
        "图片提示词：小鸭和小兔在池塘边鼓励小猪，温暖治愈",
        "视频提示词：朋友们挥手鼓励，小猪慢慢进入浅水区",
        "场景3：小猪学会漂浮。",
        "图片提示词：小猪在池塘中开心漂浮，夕阳金色光线",
        "视频提示词：小猪开心漂浮转圈，朋友们在岸边欢呼",
        "负向提示词：low quality, text, watermark",
      ].join("\n"),
      toolParameters: [
        { name: "duration_seconds", label: "时长", value: 30 },
        { name: "scene_count", label: "场景数", value: 3 },
        { name: "aspect_ratio", label: "比例", value: "9:16" },
      ],
    });

    const nodeTypes = workflow.nodes.map((node) =>
      typeof node === "object" && node !== null && "type" in node ? node.type : null,
    );

    expect(nodeTypes).toContain("PrimitiveStringMultiline");
    expect(nodeTypes).toContain("PreviewAny");
    expect(nodeTypes.filter((type) => type === "WanTextToImageApi")).toHaveLength(3);
    expect(nodeTypes.filter((type) => type === "Wan2ImageToVideoApi")).toHaveLength(3);
    expect(nodeTypes.filter((type) => type === "WanTextToVideoApi")).toHaveLength(0);
    expect(nodeTypes.filter((type) => type === "SaveImage")).toHaveLength(3);
    expect(nodeTypes.filter((type) => type === "SaveVideo")).toHaveLength(3);
    expect(workflow.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "场景 1 图片提示词" }),
        expect.objectContaining({ title: "场景 1 图生视频" }),
        expect.objectContaining({ title: "场景 2 图片提示词" }),
        expect.objectContaining({ title: "场景 2 图生视频" }),
        expect.objectContaining({ title: "场景 3 图片提示词" }),
        expect.objectContaining({ title: "场景 3 图生视频" }),
      ]),
    );
    expect(workflow.links).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.any(Number),
          expect.any(Number),
          0,
          expect.any(Number),
          0,
          "IMAGE",
        ]),
        expect.arrayContaining([
          expect.any(Number),
          expect.any(Number),
          0,
          expect.any(Number),
          2,
          "STRING",
        ]),
        expect.arrayContaining([
          expect.any(Number),
          expect.any(Number),
          0,
          expect.any(Number),
          0,
          "VIDEO",
        ]),
      ]),
    );
    const scene1ImagePrompt = workflow.nodes.find(
      (node) =>
        typeof node === "object" &&
        node !== null &&
        "title" in node &&
        node.title === "场景 1 图片提示词",
    ) as { widgets_values?: string[] } | undefined;
    const scene1VideoPrompt = workflow.nodes.find(
      (node) =>
        typeof node === "object" &&
        node !== null &&
        "title" in node &&
        node.title === "场景 1 视频提示词",
    ) as { widgets_values?: string[] } | undefined;
    const scene2ImagePrompt = workflow.nodes.find(
      (node) =>
        typeof node === "object" &&
        node !== null &&
        "title" in node &&
        node.title === "场景 2 图片提示词",
    ) as { widgets_values?: string[] } | undefined;

    expect(scene1ImagePrompt?.widgets_values?.[0]).toContain("池塘边");
    expect(scene1ImagePrompt?.widgets_values?.[0]).not.toContain("小鸭和小兔");
    expect(scene1ImagePrompt?.widgets_values?.[0]).not.toContain("夕阳");
    expect(scene1VideoPrompt?.widgets_values?.[0]).toContain("脚伸进水里");
    expect(scene1VideoPrompt?.widgets_values?.[0]).not.toContain("挥手鼓励");
    expect(scene1VideoPrompt?.widgets_values?.[0]).not.toContain("漂浮转圈");
    expect(scene2ImagePrompt?.widgets_values?.[0]).toContain("小鸭和小兔");
    expect(scene2ImagePrompt?.widgets_values?.[0]).not.toContain("夕阳");
    expect(workflow.extra.directorAngel.workflowModes).toEqual(["script", "image", "video"]);
  });

  it("creates scene-linked script plus video workflow as text-to-video when no scene images are requested", () => {
    const workflow = createDirectorComfyUiVisibleWorkflowDraft({
      id: "draft-script-video",
      kind: "script",
      workflowModes: ["script", "video"],
      objective: "一个小猪学习游泳的30秒故事，3个场景",
      status: "draft",
      executable: false,
      createdAt: "2026-05-01T10:02:00.000Z",
      angelOutput: [
        "场景1：小猪站在池塘边发抖。视频提示词：小猪试探性把脚伸进水里。",
        "场景2：朋友鼓励小猪下水。视频提示词：朋友们挥手鼓励。",
        "场景3：小猪学会漂浮。视频提示词：小猪开心漂浮转圈。",
      ].join("\n"),
      toolParameters: [{ name: "scene_count", label: "场景数", value: 3 }],
    });

    const nodeTypes = workflow.nodes.map((node) =>
      typeof node === "object" && node !== null && "type" in node ? node.type : null,
    );

    expect(nodeTypes.filter((type) => type === "WanTextToVideoApi")).toHaveLength(3);
    expect(nodeTypes.filter((type) => type === "WanTextToImageApi")).toHaveLength(0);
    expect(nodeTypes.filter((type) => type === "Wan2ImageToVideoApi")).toHaveLength(0);
    expect(nodeTypes.filter((type) => type === "SaveVideo")).toHaveLength(3);
  });

  it("defaults script media workflows to three isolated scene chains when no scene count is supplied", () => {
    const workflow = createDirectorComfyUiVisibleWorkflowDraft({
      id: "draft-default-scenes",
      kind: "script",
      workflowModes: ["script", "image", "video"],
      objective: "一个小猪学习游泳的30秒故事",
      status: "draft",
      executable: false,
      createdAt: "2026-05-01T10:02:00.000Z",
      angelOutput: "脚本草案\n小猪从怕水到学会漂浮。",
    });
    const nodeTypes = workflow.nodes.map((node) =>
      typeof node === "object" && node !== null && "type" in node ? node.type : null,
    );

    expect(nodeTypes.filter((type) => type === "WanTextToImageApi")).toHaveLength(3);
    expect(nodeTypes.filter((type) => type === "Wan2ImageToVideoApi")).toHaveLength(3);
    expect(nodeTypes.filter((type) => type === "WanTextToVideoApi")).toHaveLength(0);
    expect(workflow.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "场景 1 脚本" }),
        expect.objectContaining({ title: "场景 2 脚本" }),
        expect.objectContaining({ title: "场景 3 脚本" }),
      ]),
    );
  });

  it("removes AppleDouble metadata files from the ComfyUI template bridge", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-appledouble-"));
    tempRoots.push(root);
    const localInstallPath = join(root, "ComfyUI");
    const bridgeRoot = join(localInstallPath, "custom_nodes", "director_angel_bridge");
    mkdirSync(join(bridgeRoot, "workflows"), { recursive: true });
    writeFileSync(join(bridgeRoot, "._workflows"), "metadata", "utf8");
    writeFileSync(join(bridgeRoot, "workflows", "._old.json"), "metadata", "utf8");

    await publishDirectorComfyUiTemplateBridge({
      baseUrl: "http://127.0.0.1:8188",
      mode: "local",
      templateName: "clean-test",
      workflow: { nodes: [] },
      localInstallPath,
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "",
      }),
    });

    expect(existsSync(join(bridgeRoot, "._workflows"))).toBe(false);
    expect(existsSync(join(bridgeRoot, "workflows", "._old.json"))).toBe(false);
  });

  it("tests local ComfyUI connection through /system_stats", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-test-"));
    tempRoots.push(root);
    const calls: Array<{ url: string; apiKey: string | undefined }> = [];

    await updateDirectorComfyUiSetting(root, { key: "enabled", value: true });
    const result = await testDirectorComfyUiConnection(root, {
      now: "2026-05-01T10:04:00.000Z",
      fetchImpl: async (url, init) => {
        calls.push({ url, apiKey: init.headers["X-API-Key"] });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ system: { os: "macOS" }, devices: [] }),
        };
      },
    });

    expect(calls).toEqual([{ url: "http://127.0.0.1:8188/system_stats", apiKey: undefined }]);
    expect(result).toMatchObject({
      ok: true,
      endpoint: "http://127.0.0.1:8188/system_stats",
      message: "ComfyUI 连接成功。",
    });
  });

  it("does not probe ComfyUI HTTP endpoints while the external tool is disabled", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-health-disabled-"));
    tempRoots.push(root);

    const result = await inspectDirectorComfyUiHealth(root, {
      commandExists: () => false,
      fetchImpl: async () => {
        throw new Error("disabled ComfyUI health must not call HTTP endpoints");
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "disabled",
      queue: {
        ok: false,
        runningCount: 0,
        pendingCount: 0,
      },
      workflow: null,
      nextActions: ["在设置里启用 ComfyUI 外部工具"],
    });
  });

  it("extracts workflow schema and dependency diagnostics like the Hermes ComfyUI runner", () => {
    const workflow = {
      "4": {
        class_type: "CheckpointLoaderSimple",
        inputs: { ckpt_name: "dreamshaper.safetensors" },
      },
      "5": {
        class_type: "EmptyLatentImage",
        inputs: { width: 768, height: 432, batch_size: 1 },
      },
      "6": {
        class_type: "CLIPTextEncode",
        inputs: {
          text: "cinematic piglet learning to swim embedding:goodvibes",
          clip: ["4", 1],
        },
      },
      "7": {
        class_type: "CLIPTextEncode",
        inputs: { text: "low quality", clip: ["4", 1] },
      },
      "8": {
        class_type: "KSampler",
        inputs: {
          seed: 42,
          steps: 20,
          cfg: 7,
          sampler_name: "euler",
          scheduler: "normal",
          denoise: 1,
          model: ["4", 0],
          positive: ["6", 0],
          negative: ["7", 0],
          latent_image: ["5", 0],
        },
      },
      "9": {
        class_type: "SaveImage",
        inputs: { images: ["8", 0], filename_prefix: "Angel" },
      },
      "11": {
        class_type: "MissingVideoNode",
        inputs: { prompt: "video prompt" },
      },
    };

    const report = inspectDirectorComfyUiWorkflow(workflow, {
      objectInfo: {
        CheckpointLoaderSimple: {},
        EmptyLatentImage: {},
        CLIPTextEncode: {},
        KSampler: {},
        SaveImage: {},
      },
      installedModels: {
        checkpoints: ["dreamshaper.safetensors"],
        embeddings: [],
      },
    });

    expect(report).toMatchObject({
      ok: false,
      summary: expect.objectContaining({
        parameterCount: expect.any(Number),
        promptNodeCount: 2,
        modelDependencyCount: 2,
        missingNodeCount: 1,
        missingModelCount: 1,
      }),
    });
    expect(report.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "prompt",
          nodeId: "6",
          field: "text",
          type: "string",
          classType: "CLIPTextEncode",
        }),
        expect.objectContaining({
          name: "negative_prompt",
          nodeId: "7",
          field: "text",
          type: "string",
          classType: "CLIPTextEncode",
        }),
        expect.objectContaining({ name: "seed", nodeId: "8", field: "seed", type: "int" }),
        expect.objectContaining({ name: "width", nodeId: "5", field: "width", type: "int" }),
      ]),
    );
    expect(report.modelDependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "4",
          classType: "CheckpointLoaderSimple",
          field: "ckpt_name",
          folder: "checkpoints",
          value: "dreamshaper.safetensors",
          installed: true,
        }),
        expect.objectContaining({
          nodeId: "6",
          classType: "CLIPTextEncode",
          field: "text",
          folder: "embeddings",
          value: "goodvibes",
          installed: false,
        }),
      ]),
    );
    expect(report.missingNodes).toEqual([
      expect.objectContaining({
        classType: "MissingVideoNode",
        suggestedAction: "安装包含 MissingVideoNode 的 ComfyUI custom node。",
      }),
    ]);
    expect(report.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("缺少自定义节点"),
        expect.stringContaining("缺少模型或 embedding"),
      ]),
    );
  });

  it("reports Hermes-style health, queue, history, and lifecycle diagnostics", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-health-"));
    tempRoots.push(root);
    const workflowPath = join(root, "workflow.json");

    writeFileSync(
      workflowPath,
      JSON.stringify({
        "4": {
          class_type: "CheckpointLoaderSimple",
          inputs: { ckpt_name: "dreamshaper.safetensors" },
        },
        "6": {
          class_type: "CLIPTextEncode",
          inputs: { text: "a small cat", clip: ["4", 1] },
        },
        "9": {
          class_type: "SaveImage",
          inputs: { images: ["6", 0], filename_prefix: "Angel" },
        },
      }),
      "utf8",
    );

    await updateDirectorComfyUiSetting(root, { key: "enabled", value: true });
    await updateDirectorComfyUiSetting(root, { key: "defaultWorkflowPath", value: workflowPath });
    await updateDirectorComfyUiSetting(root, {
      key: "localInstallPath",
      value: join(root, "ComfyUI"),
    });

    const result = await inspectDirectorComfyUiHealth(root, {
      promptId: "prompt-1",
      now: "2026-05-01T10:04:00.000Z",
      commandExists: (command) => command === "uvx",
      fetchImpl: async (url) => {
        if (url.endsWith("/system_stats")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({ system: { os: "macOS" }, devices: [{ name: "MPS" }] }),
          };
        }
        if (url.endsWith("/object_info")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({
                CheckpointLoaderSimple: {},
                CLIPTextEncode: {},
                SaveImage: {},
              }),
          };
        }
        if (url.endsWith("/models/checkpoints")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () => JSON.stringify(["dreamshaper.safetensors"]),
          };
        }
        if (url.endsWith("/queue")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({
                queue_running: [["prompt-1", 1]],
                queue_pending: [["prompt-2", 2]],
              }),
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
                  status: {
                    status_str: "success",
                    completed: true,
                    messages: [["execution_success", { prompt_id: "prompt-1" }]],
                  },
                  outputs: {
                    "9": {
                      images: [{ filename: "angel.png", subfolder: "", type: "output" }],
                    },
                  },
                },
              }),
          };
        }
        throw new Error(`Unexpected health URL ${url}`);
      },
    });

    expect(result).toMatchObject({
      ok: true,
      status: "ready",
      checkedAt: "2026-05-01T10:04:00.000Z",
      lifecycle: {
        comfyCli: { available: true, method: "uvx" },
        server: { reachable: true, endpoint: "http://127.0.0.1:8188/system_stats" },
        checkpoints: { queryable: true, count: 1 },
      },
      queue: {
        ok: true,
        runningCount: 1,
        pendingCount: 1,
      },
      history: {
        ok: true,
        promptId: "prompt-1",
        statusStr: "success",
        completed: true,
        outputCount: 1,
      },
      workflow: {
        ok: true,
        summary: expect.objectContaining({
          promptNodeCount: 1,
          missingModelCount: 0,
          outputNodeCount: 1,
        }),
      },
    });
    expect(result.nextActions).toContain("可以提交已配置的 ComfyUI workflow");
  });

  it("blocks raw ComfyUI lifecycle command runners unless explicitly marked unsafe legacy", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-lifecycle-raw-blocked-"));
    tempRoots.push(root);
    const rawCalls: unknown[] = [];

    await updateDirectorComfyUiSetting(root, { key: "enabled", value: true });

    const result = await runDirectorComfyUiLifecycleAction(root, {
      action: "status",
      commandExists: (command) => command === "comfy",
      commandRunner: async (command, args) => {
        rawCalls.push({ command, args });
        return { exitCode: 0, stdout: "raw", stderr: "" };
      },
    });

    expect(result).toMatchObject({
      ok: false,
      executed: false,
      error: "sandbox-command-runner-required",
      message: "ComfyUI 本地命令需要 Agent OS 沙箱执行器；未执行裸 commandRunner。",
    });
    expect(rawCalls).toEqual([]);
  });

  it("runs legacy local ComfyUI lifecycle commands only with explicit unsafe test opt-in", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-lifecycle-"));
    tempRoots.push(root);
    const localInstallPath = join(root, "ComfyUI");
    const calls: Array<{ command: string; args: readonly string[] }> = [];

    await updateDirectorComfyUiSetting(root, { key: "enabled", value: true });
    await updateDirectorComfyUiSetting(root, { key: "baseUrl", value: "http://127.0.0.1:8190" });
    await updateDirectorComfyUiSetting(root, { key: "localInstallPath", value: localInstallPath });

    const result = await runDirectorComfyUiLifecycleAction(root, {
      action: "restart",
      commandExists: (command) => command === "uvx",
      commandRunner: async (command, args) => {
        calls.push({ command, args });
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
      unsafeAllowRawCommandRunner: true,
      now: "2026-05-01T10:07:00.000Z",
    });

    expect(result).toMatchObject({
      ok: true,
      action: "restart",
      checkedAt: "2026-05-01T10:07:00.000Z",
      executed: true,
      message: "ComfyUI restart 已执行。",
    });
    expect(calls).toEqual([
      {
        command: "uvx",
        args: ["--from", "comfy-cli", "comfy", "--workspace", localInstallPath, "stop"],
      },
      {
        command: "uvx",
        args: [
          "--from",
          "comfy-cli",
          "comfy",
          "--workspace",
          localInstallPath,
          "launch",
          "--background",
          "--",
          "--port",
          "8190",
        ],
      },
    ]);
  });

  it("routes executable ComfyUI lifecycle commands through the sandbox runner when provided", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-lifecycle-sandbox-"));
    tempRoots.push(root);
    const localInstallPath = join(root, "ComfyUI");
    const rawCalls: unknown[] = [];
    const sandboxCalls: Array<{ command: string; args: readonly string[]; cwd?: string }> = [];

    await updateDirectorComfyUiSetting(root, { key: "enabled", value: true });
    await updateDirectorComfyUiSetting(root, { key: "baseUrl", value: "http://127.0.0.1:8190" });
    await updateDirectorComfyUiSetting(root, { key: "localInstallPath", value: localInstallPath });

    const result = await runDirectorComfyUiLifecycleAction(root, {
      action: "stop",
      commandExists: (command) => command === "uvx",
      commandRunner: async (command, args) => {
        rawCalls.push({ command, args });
        return { exitCode: 0, stdout: "raw", stderr: "" };
      },
      sandboxCommandRunner: async ({ plan }) => {
        sandboxCalls.push({
          command: plan.command,
          args: plan.args,
          ...(plan.cwd === undefined ? {} : { cwd: plan.cwd }),
        });
        return {
          exitCode: 0,
          stdout: "sandbox",
          stderr: "",
          sandbox: {
            ok: true,
            status: "completed",
            backend: "host",
            providerId: "agent-os-sandbox.host",
            exitCode: 0,
            evidence: {
              backend: "host",
              providerId: "agent-os-sandbox.host",
              planHash: "plan-hash",
              commandHash: "command-hash",
            },
          },
        };
      },
    });

    expect(result).toMatchObject({
      ok: true,
      action: "stop",
      executed: true,
      results: [
        expect.objectContaining({
          command: "uvx",
          args: ["--from", "comfy-cli", "comfy", "--workspace", localInstallPath, "stop"],
          stdout: "sandbox",
          sandbox: expect.objectContaining({
            ok: true,
            status: "completed",
            evidence: expect.objectContaining({
              planHash: "plan-hash",
              commandHash: "command-hash",
            }),
          }),
        }),
      ],
    });
    expect(rawCalls).toEqual([]);
    expect(sandboxCalls).toEqual([
      {
        command: "uvx",
        args: ["--from", "comfy-cli", "comfy", "--workspace", localInstallPath, "stop"],
      },
    ]);
  });

  it("does not fall back to the raw ComfyUI runner when sandbox execution fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-lifecycle-sandbox-fail-"));
    tempRoots.push(root);
    const rawCalls: unknown[] = [];

    await updateDirectorComfyUiSetting(root, { key: "enabled", value: true });

    const result = await runDirectorComfyUiLifecycleAction(root, {
      action: "status",
      commandExists: (command) => command === "comfy",
      commandRunner: async (command, args) => {
        rawCalls.push({ command, args });
        return { exitCode: 0, stdout: "raw fallback", stderr: "" };
      },
      sandboxCommandRunner: async ({ plan }) => ({
        exitCode: 1,
        stdout: "",
        stderr: "sandbox denied",
        sandbox: {
          ok: false,
          status: "blocked",
          backend: "host",
          providerId: "agent-os-sandbox.host",
          error: "sandbox-backend-executor-unavailable",
          reason: "sandbox denied",
          evidence: {
            backend: "host",
            providerId: "agent-os-sandbox.host",
            planHash: "plan-hash",
            commandHash: "command-hash",
          },
        },
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      executed: true,
      error: "sandbox-command-failed",
      results: [
        expect.objectContaining({
          command: "comfy",
          args: ["which"],
          exitCode: 1,
          stderr: "sandbox denied",
          sandbox: expect.objectContaining({
            ok: false,
            status: "blocked",
            error: "sandbox-backend-executor-unavailable",
          }),
        }),
      ],
    });
    expect(rawCalls).toEqual([]);
  });

  it("blocks ComfyUI lifecycle execution for cloud mode and missing comfy-cli", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-lifecycle-cloud-"));
    tempRoots.push(root);

    await updateDirectorComfyUiSetting(root, { key: "enabled", value: true });
    await updateDirectorComfyUiSetting(root, { key: "mode", value: "cloud" });

    const result = await runDirectorComfyUiLifecycleAction(root, {
      action: "start",
      commandExists: () => false,
      commandRunner: async () => {
        throw new Error("cloud lifecycle must not run local commands");
      },
    });

    expect(result).toMatchObject({
      ok: false,
      executed: false,
      message: "Cloud ComfyUI 由外部服务管理，Angel 不执行本地生命周期命令。",
    });
  });

  it("plans and executes legacy local ComfyUI installation with explicit unsafe test opt-in", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-install-"));
    tempRoots.push(root);
    const localInstallPath = join(root, "ComfyUI");
    const calls: Array<{ command: string; args: readonly string[] }> = [];

    await updateDirectorComfyUiSetting(root, { key: "localInstallPath", value: localInstallPath });

    const planned = await planDirectorComfyUiInstall(root, {
      commandExists: (command) => command === "uvx",
      gpuFlag: "--m-series",
      skipLaunch: true,
      now: "2026-05-01T10:07:30.000Z",
    });
    const executed = await runDirectorComfyUiInstall(root, {
      commandExists: (command) => command === "uvx",
      commandRunner: async (command, args) => {
        calls.push({ command, args });
        return { exitCode: 0, stdout: "installed", stderr: "" };
      },
      unsafeAllowRawCommandRunner: true,
      gpuFlag: "--m-series",
      skipLaunch: true,
    });

    expect(planned).toMatchObject({
      ok: true,
      status: "planned",
      checkedAt: "2026-05-01T10:07:30.000Z",
      dryRun: true,
      executed: false,
      results: [],
      message: "ComfyUI 安装计划已生成，等待人工确认执行。",
    });
    expect(planned.plan).toEqual([
      expect.objectContaining({
        command: "uvx",
        args: [
          "--from",
          "comfy-cli",
          "comfy",
          "--workspace",
          localInstallPath,
          "--skip-prompt",
          "install",
          "--m-series",
        ],
      }),
    ]);
    expect(calls).toEqual([
      {
        command: "uvx",
        args: [
          "--from",
          "comfy-cli",
          "comfy",
          "--workspace",
          localInstallPath,
          "--skip-prompt",
          "install",
          "--m-series",
        ],
      },
    ]);
    expect(executed).toMatchObject({
      ok: true,
      status: "installed",
      dryRun: false,
      executed: true,
      results: [expect.objectContaining({ exitCode: 0 })],
    });
  });

  it("blocks local ComfyUI installation for cloud mode and missing installers", async () => {
    const cloudRoot = mkdtempSync(join(tmpdir(), "director-comfyui-install-cloud-"));
    const missingRoot = mkdtempSync(join(tmpdir(), "director-comfyui-install-missing-"));
    tempRoots.push(cloudRoot, missingRoot);

    await updateDirectorComfyUiSetting(cloudRoot, { key: "mode", value: "cloud" });
    const cloud = await runDirectorComfyUiInstall(cloudRoot, {
      commandExists: () => true,
      commandRunner: async () => {
        throw new Error("cloud install must not run local commands");
      },
    });
    const missing = await planDirectorComfyUiInstall(missingRoot, {
      commandExists: () => false,
      skipLaunch: true,
    });

    expect(cloud).toMatchObject({
      ok: false,
      status: "cannot-install-cloud",
      executed: false,
      plan: [],
      message:
        "ComfyUI 当前是 Cloud 模式；Angel 不执行本地安装。请配置 Cloud API Key 或切回 local 后再安装。",
    });
    expect(missing).toMatchObject({
      ok: false,
      status: "missing-installer",
      executed: false,
      plan: [],
    });
  });

  it("plans dependency fixes conservatively and refuses to guess model URLs", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-deps-plan-"));
    tempRoots.push(root);
    const workflowPath = join(root, "workflow.json");

    writeFileSync(
      workflowPath,
      JSON.stringify({
        "4": {
          class_type: "CheckpointLoaderSimple",
          inputs: { ckpt_name: "missing-model.safetensors" },
        },
        "5": {
          class_type: "VAELoader",
          inputs: { vae_name: "missing-vae.safetensors" },
        },
        "6": {
          class_type: "CLIPTextEncode",
          inputs: { text: "embedding:goodvibes", clip: ["4", 1] },
        },
        "8": {
          class_type: "FaceDetailer",
          inputs: {},
        },
      }),
      "utf8",
    );

    await updateDirectorComfyUiSetting(root, { key: "enabled", value: true });
    await updateDirectorComfyUiSetting(root, { key: "defaultWorkflowPath", value: workflowPath });

    const result = await planDirectorComfyUiDependencyFix(root, {
      objectInfo: {
        CheckpointLoaderSimple: {},
        VAELoader: {},
        CLIPTextEncode: {},
      },
      installedModels: {
        checkpoints: [],
        vae: [],
        embeddings: [],
      },
      modelSources: {
        "missing-model.safetensors": "https://example.test/missing-model.safetensors",
        goodvibes: "https://example.test/goodvibes.pt",
      },
      commandExists: (command) => command === "comfy",
      now: "2026-05-01T10:08:00.000Z",
    });

    expect(result).toMatchObject({
      ok: false,
      status: "planned",
      checkedAt: "2026-05-01T10:08:00.000Z",
      dryRun: true,
      needsServerRestart: true,
    });
    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "node",
          packageName: "comfyui-impact-pack",
          command: expect.objectContaining({
            command: "comfy",
            args: ["--skip-prompt", "node", "install", "comfyui-impact-pack"],
          }),
        }),
        expect.objectContaining({
          kind: "model",
          filename: "missing-model.safetensors",
          command: expect.objectContaining({
            command: "comfy",
            args: [
              "--skip-prompt",
              "model",
              "download",
              "--url",
              "https://example.test/missing-model.safetensors",
              "--relative-path",
              "models/checkpoints",
              "--filename",
              "missing-model.safetensors",
            ],
          }),
        }),
        expect.objectContaining({
          kind: "embedding",
          filename: "goodvibes.pt",
        }),
      ]),
    );
    expect(result.failures).toEqual([
      expect.objectContaining({
        kind: "model",
        filename: "missing-vae.safetensors",
        reason: expect.stringContaining("Refusing to guess"),
      }),
    ]);
  });

  it("executes legacy dependency fixes only with explicit unsafe test opt-in", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-deps-run-"));
    tempRoots.push(root);
    const workflowPath = join(root, "workflow.json");
    const calls: Array<{ command: string; args: readonly string[] }> = [];

    writeFileSync(
      workflowPath,
      JSON.stringify({
        "8": {
          class_type: "FaceDetailer",
          inputs: {},
        },
      }),
      "utf8",
    );

    await updateDirectorComfyUiSetting(root, { key: "enabled", value: true });
    await updateDirectorComfyUiSetting(root, { key: "defaultWorkflowPath", value: workflowPath });

    const result = await runDirectorComfyUiDependencyFix(root, {
      objectInfo: {},
      installedModels: {},
      commandExists: (command) => command === "comfy",
      commandRunner: async (command, args) => {
        calls.push({ command, args });
        return { exitCode: 0, stdout: "installed", stderr: "" };
      },
      unsafeAllowRawCommandRunner: true,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "fixed",
      dryRun: false,
      needsServerRestart: true,
      message: "ComfyUI dependency fix 已执行 1 项。",
    });
    expect(calls).toEqual([
      {
        command: "comfy",
        args: ["--skip-prompt", "node", "install", "comfyui-impact-pack"],
      },
    ]);
  });

  it("runs a configured workflow, injects the prompt, and downloads image artifacts", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-run-"));
    tempRoots.push(root);
    const workflowPath = join(root, "workflow.json");
    const outputDir = join(root, "outputs");
    const postedBodies: unknown[] = [];

    writeFileSync(
      workflowPath,
      JSON.stringify({
        "6": {
          class_type: "CLIPTextEncode",
          inputs: {
            text: "old prompt",
          },
        },
        "9": {
          class_type: "SaveImage",
          inputs: {
            filename_prefix: "Angel",
          },
        },
      }),
      "utf8",
    );

    await updateDirectorComfyUiSetting(root, { key: "enabled", value: true });
    await updateDirectorComfyUiSetting(root, { key: "defaultWorkflowPath", value: workflowPath });
    await updateDirectorComfyUiSetting(root, { key: "outputDir", value: outputDir });

    const result = await runDirectorComfyUiWorkflow(root, {
      prompt: "一只小猫在公园旅行，电影感",
      now: "2026-05-01T10:05:00.000Z",
      pollIntervalMs: 1,
      fetchImpl: async (url, init) => {
        if (url.endsWith("/prompt")) {
          postedBodies.push(JSON.parse(String(init.body)));
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
                    "9": {
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
        throw new Error(`Unexpected URL ${url}`);
      },
    });

    expect(postedBodies).toEqual([
      expect.objectContaining({
        prompt: expect.objectContaining({
          "6": expect.objectContaining({
            inputs: expect.objectContaining({ text: "一只小猫在公园旅行，电影感" }),
          }),
        }),
      }),
    ]);
    expect(result).toMatchObject({
      ok: true,
      readiness: "generation",
      promptApplied: true,
      workflowDiagnostics: expect.objectContaining({
        promptNodeCount: 1,
        modelDependencyCount: 0,
      }),
      promptId: "prompt-1",
      artifactCount: 1,
      artifacts: [expect.objectContaining({ kind: "image", filename: "angel.png" })],
    });
    expect(result.artifacts[0]?.localPath).toBe(join(outputDir, "prompt-1-angel.png"));
    expect(existsSync(join(outputDir, "prompt-1-angel.png"))).toBe(true);
    expect(readFileSync(join(outputDir, "prompt-1-angel.png"), "utf8")).toBe("image-bytes");
  });

  it("bridges the real ComfyUI workflow runner into the shared external provider contract", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-provider-run-"));
    tempRoots.push(root);
    const workflowPath = join(root, "workflow.json");
    const outputDir = join(root, "outputs");
    const postedBodies: unknown[] = [];

    writeFileSync(
      workflowPath,
      JSON.stringify({
        "6": {
          class_type: "CLIPTextEncode",
          inputs: {
            text: "old prompt",
          },
        },
        "9": {
          class_type: "SaveImage",
          inputs: {
            filename_prefix: "Angel",
          },
        },
      }),
      "utf8",
    );

    await updateDirectorComfyUiSetting(root, { key: "enabled", value: true });
    await updateDirectorComfyUiSetting(root, { key: "defaultWorkflowPath", value: workflowPath });
    await updateDirectorComfyUiSetting(root, { key: "outputDir", value: outputDir });

    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createDirectorRuntimeComfyUiProviderRegistration(root, {
        now: () => "2026-05-01T10:05:00.000Z",
        commandExists: (command) => command === "uvx",
        fetchImpl: async (url, init) => {
          if (url.endsWith("/system_stats")) {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () => JSON.stringify({ system: { os: "macOS" }, devices: [] }),
            };
          }
          if (url.endsWith("/object_info")) {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () => JSON.stringify({ CLIPTextEncode: {}, SaveImage: {} }),
            };
          }
          if (url.endsWith("/models/checkpoints")) {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () => JSON.stringify([]),
            };
          }
          if (url.endsWith("/queue")) {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () => JSON.stringify({ queue_running: [], queue_pending: [] }),
            };
          }
          if (url.endsWith("/prompt")) {
            postedBodies.push(JSON.parse(String(init.body)));
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () => JSON.stringify({ prompt_id: "prompt-provider" }),
            };
          }
          if (url.endsWith("/history/prompt-provider")) {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () =>
                JSON.stringify({
                  "prompt-provider": {
                    outputs: {
                      "9": {
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
          throw new Error(`Unexpected provider URL ${url}`);
        },
      }),
    );

    await expect(
      createExternalToolsEffectiveRpcResult(createExternalToolControlPlane(registry), {
        includeUnavailable: true,
      }),
    ).resolves.toMatchObject({
      effectiveCount: 1,
      tools: [
        expect.objectContaining({
          id: "comfyui.provider",
          providerId: "comfyui",
          status: "ready",
          canInvoke: true,
        }),
      ],
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "comfyui.provider",
        operationId: "workflow.run",
        args: { prompt: "一只小猫在公园旅行，电影感" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "approval-required",
      error: "external-tool-approval-required",
    });

    const executed = await invokeExternalTool(registry, {
      toolId: "comfyui.provider",
      operationId: "workflow.run",
      args: { prompt: "一只小猫在公园旅行，电影感" },
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-27T00:00:00.000Z",
        providerId: "comfyui",
        reason: "trusted desktop sandbox granted ComfyUI workflow run",
      },
      sandboxRuntimePolicy: {
        enabledBackends: ["workspace-write"],
      },
    });

    expect(postedBodies).toEqual([
      expect.objectContaining({
        prompt: expect.objectContaining({
          "6": expect.objectContaining({
            inputs: expect.objectContaining({ text: "一只小猫在公园旅行，电影感" }),
          }),
        }),
      }),
    ]);
    expect(executed).toMatchObject({
      ok: true,
      status: "success",
      content: expect.stringContaining("已保存 1 个产物"),
      output: {
        schemaVersion: "director.external-tool.v1",
        provider: "comfyui",
        operation: "workflow.run",
        output: expect.objectContaining({
          promptId: "prompt-provider",
          artifactCount: 1,
          readiness: "generation",
        }),
      },
      artifacts: [
        expect.objectContaining({
          id: expect.stringContaining("angel.png"),
          kind: "image",
          path: join(outputDir, "prompt-provider-angel.png"),
          metadata: expect.objectContaining({
            provider: "comfyui",
            promptId: "prompt-provider",
            filename: "angel.png",
          }),
        }),
      ],
    });
    expect(readFileSync(join(outputDir, "prompt-provider-angel.png"), "utf8")).toBe("image-bytes");
  });

  it("fetches a ComfyUI artifact through the shared provider bridge host handler", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-provider-fetch-"));
    tempRoots.push(root);
    const outputDir = join(root, "outputs");
    const viewUrls: string[] = [];

    await updateDirectorComfyUiSetting(root, { key: "enabled", value: true });
    await updateDirectorComfyUiSetting(root, { key: "outputDir", value: outputDir });

    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createDirectorRuntimeComfyUiProviderRegistration(root, {
        now: () => "2026-05-01T10:05:00.000Z",
        commandExists: (command) => command === "uvx",
        fetchImpl: async (url) => {
          if (url.endsWith("/system_stats")) {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () => JSON.stringify({ system: { os: "macOS" }, devices: [] }),
            };
          }
          if (url.endsWith("/object_info")) {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () => JSON.stringify({ SaveImage: {} }),
            };
          }
          if (url.endsWith("/models/checkpoints")) {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () => JSON.stringify([]),
            };
          }
          if (url.endsWith("/queue")) {
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () => JSON.stringify({ queue_running: [], queue_pending: [] }),
            };
          }
          if (url.includes("/view?")) {
            viewUrls.push(url);
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () => "fetched-image-bytes",
              arrayBuffer: async () => new TextEncoder().encode("fetched-image-bytes").buffer,
            };
          }
          throw new Error(`Unexpected provider URL ${url}`);
        },
      }),
    );

    const fetched = await invokeExternalTool(registry, {
      toolId: "comfyui.provider",
      operationId: "artifact.fetch",
      args: {
        promptId: "prompt-provider",
        filename: "angel.png",
        subfolder: "",
        type: "output",
      },
    });

    expect(viewUrls).toEqual([
      "http://127.0.0.1:8188/view?filename=angel.png&subfolder=&type=output",
    ]);
    expect(fetched).toMatchObject({
      ok: true,
      status: "success",
      content: "ComfyUI artifact.fetch 已下载 1 个产物。",
      output: {
        schemaVersion: "director.external-tool.v1",
        provider: "comfyui",
        operation: "artifact.fetch",
        output: expect.objectContaining({
          artifactCount: 1,
          endpoint: "http://127.0.0.1:8188/view?filename=angel.png&subfolder=&type=output",
        }),
      },
      artifacts: [
        expect.objectContaining({
          id: "comfyui-prompt-provider-angel.png",
          kind: "image",
          path: join(outputDir, "prompt-provider-angel.png"),
          metadata: expect.objectContaining({
            provider: "comfyui",
            promptId: "prompt-provider",
            filename: "angel.png",
          }),
        }),
      ],
    });
    expect(readFileSync(join(outputDir, "prompt-provider-angel.png"), "utf8")).toBe(
      "fetched-image-bytes",
    );
  });

  it("monitors ComfyUI WebSocket progress before downloading artifacts", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-ws-"));
    tempRoots.push(root);
    const workflowPath = join(root, "workflow.json");
    const outputDir = join(root, "outputs");
    const progressEvents: unknown[] = [];
    const connectedUrls: string[] = [];

    writeFileSync(
      workflowPath,
      JSON.stringify({
        "6": {
          class_type: "CLIPTextEncode",
          inputs: { text: "old prompt" },
        },
        "9": {
          class_type: "SaveImage",
          inputs: { filename_prefix: "Angel" },
        },
      }),
      "utf8",
    );

    await updateDirectorComfyUiSetting(root, { key: "enabled", value: true });
    await updateDirectorComfyUiSetting(root, { key: "defaultWorkflowPath", value: workflowPath });
    await updateDirectorComfyUiSetting(root, { key: "outputDir", value: outputDir });

    const result = await runDirectorComfyUiWorkflow(root, {
      prompt: "一只小猫在公园旅行，电影感",
      clientId: "client-1",
      now: "2026-05-01T10:05:00.000Z",
      pollIntervalMs: 1,
      webSocketFactory: (url, handlers) => {
        connectedUrls.push(url);
        queueMicrotask(() => {
          handlers.onMessage({
            type: "progress",
            data: { prompt_id: "prompt-ws", value: 2, max: 4, node: "8" },
          });
          handlers.onMessage({
            type: "executing",
            data: { prompt_id: "prompt-ws", node: "9" },
          });
          handlers.onMessage({
            type: "executed",
            data: {
              prompt_id: "prompt-ws",
              node: "9",
              output: { images: [{ filename: "angel.png", subfolder: "", type: "output" }] },
            },
          });
          handlers.onMessage({
            type: "execution_success",
            data: { prompt_id: "prompt-ws" },
          });
        });
        return {
          close: () => undefined,
        };
      },
      onProgress: (event) => {
        progressEvents.push(event);
      },
      fetchImpl: async (url, init) => {
        if (url.endsWith("/prompt")) {
          expect(JSON.parse(String(init.body))).toMatchObject({
            client_id: "client-1",
          });
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () => JSON.stringify({ prompt_id: "prompt-ws" }),
          };
        }
        if (url.endsWith("/history/prompt-ws")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({
                "prompt-ws": {
                  outputs: {
                    "9": {
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
        throw new Error(`Unexpected URL ${url}`);
      },
    });

    expect(connectedUrls).toEqual(["ws://127.0.0.1:8188/ws?clientId=client-1"]);
    expect(progressEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "progress", promptId: "prompt-ws", value: 2, max: 4 }),
        expect.objectContaining({ type: "executing", promptId: "prompt-ws", node: "9" }),
        expect.objectContaining({ type: "executed", promptId: "prompt-ws", node: "9" }),
        expect.objectContaining({ type: "execution_success", promptId: "prompt-ws" }),
      ]),
    );
    expect(result).toMatchObject({
      ok: true,
      promptId: "prompt-ws",
      progressMode: "websocket",
      progressEvents: expect.arrayContaining([
        expect.objectContaining({ type: "progress", promptId: "prompt-ws" }),
        expect.objectContaining({ type: "execution_success", promptId: "prompt-ws" }),
      ]),
      artifactCount: 1,
    });
  });

  it("marks workflows without prompt nodes as connectivity checks instead of generated prompt output", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-smoke-"));
    tempRoots.push(root);
    const workflowPath = join(root, "workflow.json");
    const outputDir = join(root, "outputs");

    writeFileSync(
      workflowPath,
      JSON.stringify({
        "1": {
          class_type: "EmptyImage",
          inputs: { width: 768, height: 432, batch_size: 1, color: 3447003 },
        },
        "2": {
          class_type: "SaveImage",
          inputs: { images: ["1", 0], filename_prefix: "DirectorAngel_ComfyUI_Smoke" },
        },
      }),
      "utf8",
    );

    await updateDirectorComfyUiSetting(root, { key: "enabled", value: true });
    await updateDirectorComfyUiSetting(root, { key: "defaultWorkflowPath", value: workflowPath });
    await updateDirectorComfyUiSetting(root, { key: "outputDir", value: outputDir });

    const result = await runDirectorComfyUiWorkflow(root, {
      prompt: "一只小猫在公园旅行，电影感",
      now: "2026-05-01T10:06:00.000Z",
      pollIntervalMs: 1,
      fetchImpl: async (url, init) => {
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
                    "2": {
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
        throw new Error(`Unexpected URL ${url}`);
      },
    });

    expect(result).toMatchObject({
      ok: true,
      readiness: "connectivity_check",
      promptApplied: false,
      diagnostics: expect.arrayContaining([
        "提示词没有写入 workflow；这次不能算文生图。",
        "未发现可注入提示词的文本节点。",
        "未发现模型加载节点；这类 workflow 通常只能做连通性或非 AI 处理。",
      ]),
      workflowDiagnostics: expect.objectContaining({
        promptNodeCount: 0,
        modelDependencyCount: 0,
        outputNodeCount: 1,
      }),
      artifactCount: 1,
      message: expect.stringContaining("不代表 AI 文生图"),
    });
    expect(result.artifacts[0]?.localPath).toBe(
      join(outputDir, "prompt-smoke-DirectorAngel_ComfyUI_Smoke_00001_.png"),
    );
  });

  it("does not fake generation when no workflow is configured", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-no-workflow-"));
    tempRoots.push(root);

    await updateDirectorComfyUiSetting(root, { key: "enabled", value: true });
    const result = await runDirectorComfyUiWorkflow(root, {
      prompt: "生成图片",
      fetchImpl: async () => {
        throw new Error("fetch should not be called without a workflow");
      },
    });

    expect(result).toMatchObject({
      ok: false,
      readiness: "blocked",
      artifactCount: 0,
      diagnostics: ["ComfyUI 已启用，但还没有配置 workflow 文件，未发起生成。"],
      message: "ComfyUI 已启用，但还没有配置 workflow 文件，未发起生成。",
    });
  });

  it("reports ComfyUI node_errors as missing dependency diagnostics instead of fake generation", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-comfyui-node-errors-"));
    tempRoots.push(root);
    const workflowPath = join(root, "workflow.json");

    writeFileSync(
      workflowPath,
      JSON.stringify({
        "4": {
          class_type: "CheckpointLoaderSimple",
          inputs: { ckpt_name: "missing-model.safetensors" },
        },
        "6": {
          class_type: "CLIPTextEncode",
          inputs: { text: "old prompt", clip: ["4", 1] },
        },
        "9": {
          class_type: "SaveImage",
          inputs: { filename_prefix: "Angel" },
        },
      }),
      "utf8",
    );

    await updateDirectorComfyUiSetting(root, { key: "enabled", value: true });
    await updateDirectorComfyUiSetting(root, { key: "defaultWorkflowPath", value: workflowPath });

    const result = await runDirectorComfyUiWorkflow(root, {
      prompt: "一只小猫在公园旅行，电影感",
      fetchImpl: async (url) => {
        if (url.endsWith("/prompt")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({
                prompt_id: "prompt-blocked",
                node_errors: {
                  "4": {
                    errors: [
                      { message: "Value not in list: ckpt_name: 'missing-model.safetensors'" },
                    ],
                  },
                },
              }),
          };
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    });

    expect(result).toMatchObject({
      ok: false,
      readiness: "blocked",
      promptApplied: true,
      artifactCount: 0,
      workflowDiagnostics: expect.objectContaining({
        promptNodeCount: 1,
        modelDependencyCount: 1,
        modelDependencies: ["checkpoints:missing-model.safetensors"],
      }),
      diagnostics: expect.arrayContaining([
        "模型依赖：checkpoints:missing-model.safetensors",
        "ComfyUI 返回 node_errors，通常是缺模型、缺自定义节点或 workflow 参数无效。",
        expect.stringContaining("missing-model.safetensors"),
      ]),
      message: expect.stringContaining("ComfyUI 拒绝执行 workflow"),
    });
  });
});
