import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExternalToolRegistry,
  createBuiltInMediaUnderstandingExternalToolRegistration,
  createExternalToolControlPlane,
  createOpenCliExternalToolRegistration,
} from "@hotflow/conversation-runtime";
import { FileKnowledgeStore } from "@hotflow/director-knowledge";
import { FileSystemDirectorMemoryStore } from "@hotflow/director-memory";
import type { DirectorMemoryRecord } from "@hotflow/director-memory-contracts";
import { SkillSnapshotFileStore, resolveApprovedSkillSnapshotPath } from "@hotflow/skills";
import { afterEach, describe, expect, it } from "vitest";

import { createDirectorHostApiApp } from "../../director-host-api/src/server.ts";
import { handleWeixinMessage } from "../src/adapter.js";
import { loadPeerSession, saveWeixinAccount } from "../src/store.js";
import type { FetchLike } from "../src/types.js";

const roots: string[] = [];
const WEIXIN_ACTIVE_RECALL_SCOPE =
  "personal-weixin-personal-weixin-agent:director:direct:friend-im.wechat";
const WEIXIN_ACTIVE_RECALL_PROJECT_ID = `project-${WEIXIN_ACTIVE_RECALL_SCOPE}`;
const WEIXIN_ACTIVE_RECALL_GROUP_ID = `group-${WEIXIN_ACTIVE_RECALL_SCOPE}`;

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function readSentText(body: string | undefined): string {
  if (body === undefined) {
    return "";
  }
  const payload = JSON.parse(body) as {
    msg?: { item_list?: Array<{ text_item?: { text?: string } }> };
  };
  return payload.msg?.item_list?.[0]?.text_item?.text ?? "";
}

function toolNamesFromRequestBody(body: unknown): string[] {
  const parsed = typeof body === "string" ? JSON.parse(body) : body;
  if (!isRecord(parsed) || !Array.isArray(parsed.tools)) {
    return [];
  }
  return parsed.tools
    .map((tool) => (isRecord(tool.function) ? tool.function.name : undefined))
    .filter((name): name is string => typeof name === "string");
}

function toolMessageFromRequestBody(
  body: unknown,
  toolCallId: string,
): { readonly content?: string } | undefined {
  const parsed = typeof body === "string" ? JSON.parse(body) : body;
  if (!isRecord(parsed) || !Array.isArray(parsed.messages)) {
    return undefined;
  }
  for (const message of parsed.messages) {
    if (isRecord(message) && message.role === "tool" && message.tool_call_id === toolCallId) {
      return {
        content: typeof message.content === "string" ? message.content : undefined,
      };
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRuntimeLearningArtifacts(workspaceRoot: string): readonly Record<string, unknown>[] {
  const raw = readFileSync(
    join(workspaceRoot, ".hotflow", "conversation-runtime", "learning-artifacts.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as { readonly artifacts?: readonly Record<string, unknown>[] };
  return parsed.artifacts ?? [];
}

function writeWeixinApiProviderFixture(workspaceRoot: string) {
  const providersDir = join(workspaceRoot, ".director-angel", "providers");
  mkdirSync(providersDir, { recursive: true });
  writeFileSync(
    join(providersDir, "providers.json"),
    `${JSON.stringify(
      {
        schemaVersion: "director.api-providers.v1",
        updatedAt: new Date(0).toISOString(),
        providers: [
          {
            id: "memefast-api",
            baseUrl: "https://api.example.test",
            enabled: true,
            apiKey: "sk-test",
            models: ["director-text"],
            defaultModels: { text: "director-text" },
            capabilities: ["text"],
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

describe("weixin adapter with a real Director Host API", () => {
  it("routes ordinary URL reading through real Host API tools instead of URL learning", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-host-api-url-tool-home-"));
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "director-weixin-host-api-url-tool-workspace-"),
    );
    roots.push(home, workspaceRoot);
    writeWeixinApiProviderFixture(workspaceRoot);

    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register({
      manifest: {
        id: "web_extract",
        label: "web_extract",
        description: "Extract public web source text.",
        source: "built-in",
        kind: "model-tool",
        providerId: "web",
        capabilities: [{ id: "web.extract", label: "Extract", readOnly: true }],
        metadata: { modelToolName: "web_extract" },
      },
      check: () => ({ status: "ready", summary: "Web extract ready." }),
      invoke: (request) => ({
        ok: true,
        toolName: "web_extract",
        toolId: "web_extract",
        operationId: "web.extract",
        status: "success",
        content:
          "status: success\nsummary: Extracted 42 preview character(s) from https://example.test/extract.\nurl: https://example.test/extract\ntitle: Director Angel Extract\ntext_preview: Shared extraction content from real Host API",
        output: {
          status: "success",
          title: "Director Angel Extract",
          url: String(request.args?.url ?? ""),
          text_preview: "Shared extraction content from real Host API",
        },
        trace: [],
      }),
    });

    const app = createDirectorHostApiApp({
      env: {
        ...process.env,
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
      },
      externalToolControlPlane: createExternalToolControlPlane(registry),
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ body?: unknown }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({
        url,
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (url.startsWith("https://ilink.example.com/")) {
        return jsonResponse({ ret: 0 });
      }
      return fetch(url, init);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ body });
      providerTurn += 1;
      if (providerTurn === 1) {
        expect(toolNamesFromRequestBody(body)).toContain("web_extract");
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-real-host-web-extract",
                    type: "function",
                    function: {
                      name: "web_extract",
                      arguments: JSON.stringify({
                        url: "https://example.test/extract",
                        max_bytes: 4096,
                      }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      const toolMessage = toolMessageFromRequestBody(body, "call-real-host-web-extract");
      expect(toolMessage?.content).toContain("Shared extraction content from real Host API");
      return jsonResponse({
        choices: [{ message: { content: "已读取：Shared extraction content from real Host API" } }],
      });
    };

    try {
      const result = await handleWeixinMessage(
        {
          home,
          workspaceRoot,
          account,
          dmPolicy: "allowlist",
          allowedUsers: ["friend@im.wechat"],
          useHostToolControlPlane: true,
          fetchFn,
          apiProviderFetch,
          director: {
            hostApiUrl: `http://${host}:${port}`,
            hostId: "personal-weixin",
            agentId: "director",
            channel: "personal-weixin",
            autoAdvance: true,
            autoStartRun: true,
            fetchFn,
          },
        },
        {
          message_id: "wx-real-host-url-tool-e2e",
          from_user_id: "friend@im.wechat",
          create_time_ms: 1_777_400_000_000,
          item_list: [{ type: 1, text_item: { text: "读取 https://example.test/extract 的内容" } }],
        },
      );

      expect(result).toBe("sent");
      expect(providerCalls).toHaveLength(2);
      const hostPaths = calls
        .filter((call) => call.url.startsWith(`http://${host}:${port}/`))
        .map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`);
      expect(hostPaths[0]).toBe("GET:/v1/tools/effective");
      expect(hostPaths).toContain("POST:/v1/tools/invoke");
      expect(calls.some((call) => new URL(call.url).pathname.startsWith("/v1/learning"))).toBe(
        false,
      );
      expect(calls.find((call) => call.url.includes("/v1/tools/invoke"))?.body).toContain(
        '"toolId":"web_extract"',
      );
      const reply = readSentText(calls.at(-1)?.body);
      expect(reply).toContain("Shared extraction content from real Host API");
      expect(reply).not.toContain("要收录吗");
      expect(reply).not.toContain("待审");
    } finally {
      await app.close();
    }
  });

  it("keeps explicit URL learning on the real Host API learning lane", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-host-api-explicit-learning-home-"));
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "director-weixin-host-api-explicit-learning-workspace-"),
    );
    roots.push(home, workspaceRoot);

    const app = createDirectorHostApiApp({
      env: {
        ...process.env,
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({
        url,
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (url === "https://example.test/learnable") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async text() {
            return [
              "<html><head><title>AI 分镜工作流</title></head><body>",
              "<article>",
              "这是一份可公开读取的导演 AI 分镜资料。",
              "核心方法是先把剧情目标拆成镜头目标，再为每个镜头建立角色、场景、动作、情绪和交付格式。",
              "执行时先生成三段式镜头清单，再把每段镜头交给图像或视频模型，最后用一致性检查回收角色和场景漂移。",
              "适用场景包括短剧预演、广告分镜、角色设定图和镜头语言训练。",
              "风险是不要把未经授权的图片或视频内容当成已经理解的事实，只能先保存文本经验候选。",
              "</article></body></html>",
            ].join("");
          },
        };
      }
      if (url.startsWith("https://ilink.example.com/")) {
        return jsonResponse({ ret: 0 });
      }
      return fetch(url, init);
    };
    const apiProviderFetch: FetchLike = async () => {
      throw new Error("model should not be called for explicit direct URL learning");
    };

    try {
      const result = await handleWeixinMessage(
        {
          home,
          workspaceRoot,
          account,
          dmPolicy: "allowlist",
          allowedUsers: ["friend@im.wechat"],
          fetchFn,
          apiProviderFetch,
          director: {
            hostApiUrl: `http://${host}:${port}`,
            hostId: "personal-weixin",
            agentId: "director",
            channel: "personal-weixin",
            autoAdvance: true,
            autoStartRun: true,
            fetchFn,
          },
        },
        {
          message_id: "wx-real-host-explicit-learning-e2e",
          from_user_id: "friend@im.wechat",
          create_time_ms: 1_777_400_000_000,
          item_list: [{ type: 1, text_item: { text: "学习这个 https://example.test/learnable" } }],
        },
      );

      expect(result).toBe("sent");
      const hostPaths = calls
        .filter((call) => call.url.startsWith(`http://${host}:${port}/`))
        .map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`);
      expect(hostPaths).toContain("POST:/v1/learning/text");
      expect(hostPaths).not.toContain("GET:/v1/tools/effective");
      expect(hostPaths).not.toContain("POST:/v1/tools/invoke");
      const artifacts = readRuntimeLearningArtifacts(workspaceRoot);
      const artifact = artifacts.find(
        (item) => item.sourceRef === "https://example.test/learnable",
      );
      expect(artifact?.sourceSurface).toBe("weixin");
      expect(artifact?.sourceKind).toBe("url");
      expect(artifact?.sourceRef).toBe("https://example.test/learnable");
      expect(artifact?.pendingConfirmationId).toBeTruthy();
      expect(
        (artifact?.metadata as { readonly candidateCount?: number })?.candidateCount,
      ).toBeGreaterThan(0);
      const reply = readSentText(calls.at(-1)?.body);
      expect(reply).toContain("要收录吗");
      expect(reply).toContain("来源：https://example.test/learnable");
      expect(reply).not.toContain("这次还没有学到可信正文");
    } finally {
      await app.close();
    }
  });

  it("uses the shared Host API OpenCLI plane for explicit X URL learning", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-x-opencli-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-x-opencli-home-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "personal-weixin",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const registry = new ExternalToolRegistry({ nowMs: () => 1_777_400_000_000 });
    registry.register(
      createOpenCliExternalToolRegistration({
        manifestEntries: [
          {
            site: "twitter",
            name: "thread",
            description: "Get a tweet thread.",
            access: "read",
            browser: true,
            domain: "x.com",
            args: [{ name: "tweet-id", type: "string", required: true, positional: true }],
          },
        ],
        runner: async (input) => {
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
                id: "2058431541655572649",
                author: "MrLarus",
                text: "用 ChatGPT-Image2 生成餐饮异形展架/立牌，不同风格大标题、主推菜、卖点标签可以一次性直出，适合餐饮新品上市、套餐促销、门店引流。",
                url: "https://x.com/MrLarus/status/2058431541655572649",
                media_urls: [],
              },
            ]),
            stderr: "",
          };
        },
      }),
    );

    const app = createDirectorHostApiApp({
      env: {
        ...process.env,
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
      },
      externalToolControlPlane: createExternalToolControlPlane(registry),
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({
        url,
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (url.startsWith(`http://${host}:${port}/`)) {
        return fetch(url, init);
      }
      if (url.startsWith("https://ilink.example.com/")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({ ret: 0 });
    };

    try {
      const result = await handleWeixinMessage(
        {
          home,
          workspaceRoot,
          account,
          fetchFn,
          dmPolicy: "allowlist",
          allowedUsers: ["friend@im.wechat"],
          useHostToolControlPlane: true,
          director: {
            hostApiUrl: `http://${host}:${port}`,
            hostId: "personal-weixin",
            agentId: "director",
            channel: "personal-weixin",
            autoAdvance: true,
            autoStartRun: true,
            fetchFn,
          },
        },
        {
          message_id: "wx-real-host-x-opencli-learning-e2e",
          from_user_id: "friend@im.wechat",
          create_time_ms: 1_777_400_000_000,
          item_list: [
            {
              type: 1,
              text_item: {
                text: "学习这个 https://x.com/mrlarus/status/2058431541655572649?s=46",
              },
            },
          ],
        },
      );

      expect(result).toBe("sent");
      const hostPaths = calls
        .filter((call) => call.url.startsWith(`http://${host}:${port}/`))
        .map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`);
      expect(hostPaths).toContain("POST:/v1/tools/invoke");
      expect(hostPaths).toContain("POST:/v1/learning/text");
      expect(hostPaths).not.toContain("GET:/v1/tools/effective");
      const artifacts = readRuntimeLearningArtifacts(workspaceRoot);
      const artifact = artifacts.find(
        (item) => item.sourceRef === "https://x.com/mrlarus/status/2058431541655572649?s=46",
      );
      expect(artifact?.sourceSurface).toBe("weixin");
      expect(artifact?.sourceKind).toBe("url");
      expect(
        (artifact?.metadata as { readonly candidateCount?: number })?.candidateCount,
      ).toBeGreaterThan(0);
      expect(JSON.stringify(artifact?.metadata ?? {})).toContain("餐饮异形展架");
      const reply = readSentText(calls.at(-1)?.body);
      expect(reply).toContain("要收录吗");
      expect(reply).toContain("餐饮异形展架");
      expect(reply).not.toContain("这次还没有学到可信正文");
    } finally {
      await app.close();
    }
  });

  it("invokes authorized media-understanding sample through the real Host API tool plane", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-media-e2e-workspace-"));
    roots.push(workspaceRoot);
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register(createBuiltInMediaUnderstandingExternalToolRegistration());

    const app = createDirectorHostApiApp({
      env: {
        ...process.env,
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
      },
      externalToolControlPlane: createExternalToolControlPlane(registry),
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const effectiveResponse = await fetch(
        `http://${host}:${port}/v1/tools/effective?sessionKey=media-e2e&includeUnavailable=true`,
      );
      expect(effectiveResponse.ok).toBe(true);
      await expect(effectiveResponse.json()).resolves.toMatchObject({
        schemaVersion: "director.external-tools.effective.v1",
        tools: expect.arrayContaining([
          expect.objectContaining({
            id: "media-understanding.local",
            canInvoke: true,
          }),
        ]),
        providerMatrix: expect.objectContaining({
          providers: expect.arrayContaining([
            expect.objectContaining({
              providerId: "media-understanding",
              capabilities: expect.arrayContaining([
                expect.objectContaining({ id: "media.understand_image" }),
              ]),
            }),
          ]),
        }),
      });

      const invokeResponse = await fetch(`http://${host}:${port}/v1/tools/invoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolId: "media-understanding.local",
          operationId: "media.understand_image",
          turnId: "turn-media-e2e",
          sessionKey: "media-e2e",
          args: {
            artifact: {
              id: "sample-png",
              kind: "image",
              mimeType: "image/png",
              dataUrl:
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
              path: "/workspace/assets/sample.png",
            },
          },
          cwd: "/workspace/assets",
          sandboxRuntimePolicy: {
            enabledBackends: ["readonly"],
            readableRoots: ["/workspace/assets"],
            networkPolicy: "none",
          },
          requestedNetworkPolicy: "none",
          approval: {
            status: "approved",
            reason: "test operator approved metadata-level media understanding",
          },
        }),
      });
      expect(invokeResponse.ok).toBe(true);
      await expect(invokeResponse.json()).resolves.toMatchObject({
        schemaVersion: "director.external-tools.invoke.v1",
        ok: true,
        status: "success",
        toolId: "media-understanding.local",
        operationId: "media.understand_image",
        output: {
          status: "success",
          media: expect.objectContaining({
            id: "sample-png",
            kind: "image",
            mimeType: "image/png",
            dimensions: { width: 1, height: 1 },
          }),
          observations: expect.arrayContaining([
            expect.objectContaining({ id: "media.format" }),
            expect.objectContaining({ id: "media.dimensions" }),
          ]),
          sandbox: expect.objectContaining({
            backend: "readonly",
            networkPolicy: "none",
          }),
        },
        metadata: expect.objectContaining({
          mediaUnderstandingRunner: expect.objectContaining({
            providerId: "media-understanding",
            mode: "local-metadata",
          }),
        }),
      });
    } finally {
      await app.close();
    }
  });

  it("creates, starts, approves, and summarizes a production run through the shared host API", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-host-api-e2e-home-"));
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-host-api-e2e-workspace-"));
    roots.push(home, workspaceRoot);

    const app = createDirectorHostApiApp({
      env: {
        ...process.env,
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({
        url,
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (url.startsWith("https://ilink.example.com/")) {
        return jsonResponse({ ret: 0 });
      }
      return fetch(url, init);
    };

    try {
      const result = await handleWeixinMessage(
        {
          home,
          workspaceRoot,
          account,
          dmPolicy: "allowlist",
          allowedUsers: ["friend@im.wechat"],
          fetchFn,
          runWorkerOnce: async (input) => ({
            run: {
              runId: input.runId,
              status: "completed",
              previewSummary: "片名：《15秒转折》。三镜头：建立目标、冲突推进、结果反转。",
            },
            executedAssignments: ["script-planner", "shot-planner", "asset-router"],
            report: {
              reportId: `report-${input.runId}`,
              flags: [],
              summary: [
                "run status=completed",
                "assignments total=4 ready=0 pending=0 running=0 completed=4 failed=0 blocked=0",
              ],
              operatorSurface: {
                operatorSummary:
                  "片名：《15秒转折》\n1. 0-5s：中景建立主角目标。\n2. 5-10s：近景推进冲突。\n3. 10-15s：特写揭示反转结果。",
              },
            },
          }),
          director: {
            hostApiUrl: `http://${host}:${port}`,
            hostId: "personal-weixin",
            agentId: "director",
            channel: "personal-weixin",
            autoAdvance: true,
            autoStartRun: true,
            fetchFn,
          },
        },
        {
          message_id: "wx-host-api-e2e-1",
          from_user_id: "friend@im.wechat",
          create_time_ms: 1_777_400_000_000,
          item_list: [{ type: 1, text_item: { text: "/制作 生成一个15秒短剧分镜蓝图" } }],
        },
      );

      expect(result).toBe("sent");
      const paths = calls
        .filter((call) => call.url.startsWith(`http://${host}:${port}/`))
        .map((call) => new URL(call.url).pathname);
      expect(paths[0]).toBe("/v1/entry/message");
      expect(paths.some((path) => path.endsWith("/blueprint"))).toBe(true);
      expect(paths.some((path) => path.endsWith("/runs"))).toBe(true);
      expect(paths.some((path) => path.endsWith("/start"))).toBe(true);
      expect(paths.some((path) => path.endsWith("/approve"))).toBe(true);
      expect(paths.some((path) => path.endsWith("/status"))).toBe(true);
      expect(paths.some((path) => /^\/v1\/runs\/[^/]+$/u.test(path))).toBe(true);

      const session = loadPeerSession(home, account.normalizedAccountId, "friend@im.wechat");
      expect(session?.entrySessionId).toMatch(/^entry-/u);
      expect(session?.blueprintId).toBeTruthy();
      expect(session?.runId).toBeTruthy();
      expect(session?.pendingApprovalAssignmentIds).toEqual([]);

      const reply = readSentText(calls.at(-1)?.body);
      expect(reply).toContain("模型不可用");
      expect(reply).toContain("不能用本地模板冒充制作结果");
      expect(reply).not.toContain("片名：《15秒转折》");
      expect(reply).not.toContain("0-5s");
      expect(reply).not.toContain("蓝图：");
      expect(reply).not.toContain("Run：");
      expect(reply).not.toContain("assignment");
      expect(reply).not.toContain("下一步");
    } finally {
      await app.close();
    }
  });

  it("keeps active recall hits when a Weixin production task enters through the shared host API", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-active-recall-home-"));
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-active-recall-workspace-"));
    roots.push(home, workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    writeRuntimeSwitchesFixture(workspaceRoot, {
      "memory.enabled": true,
      "knowledgeRecall.enabled": true,
    });
    writeLongTermMemoryFixture(workspaceRoot);
    writeApprovedSkillFixture(dataDir);
    await writePublishedKnowledgeFixture(workspaceRoot);
    await writeMemoryRecordFixture(workspaceRoot);

    const app = createDirectorHostApiApp({
      env: {
        ...process.env,
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DATA_DIR: dataDir,
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({
        url,
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (url.startsWith("https://ilink.example.com/")) {
        return jsonResponse({ ret: 0 });
      }
      return fetch(url, init);
    };

    try {
      const result = await handleWeixinMessage(
        {
          home,
          workspaceRoot,
          account,
          dmPolicy: "allowlist",
          allowedUsers: ["friend@im.wechat"],
          fetchFn,
          runWorkerOnce: async (input) => {
            const run = JSON.parse(
              readFileSync(
                join(
                  workspaceRoot,
                  ".director-angel",
                  "runtime",
                  "execution",
                  "runs",
                  input.runId,
                  "run.json",
                ),
                "utf8",
              ),
            ) as { notes?: string[] };
            return {
              run: {
                runId: input.runId,
                status: "completed",
                previewSummary:
                  "片名：《记忆命中的15秒转折》。已结合已发布经验、长期记忆和 Skill。",
              },
              executedAssignments: ["script-planner", "shot-planner", "asset-router"],
              report: {
                reportId: `report-${input.runId}`,
                flags: [...(run.notes ?? [])],
                summary: [
                  "run status=completed",
                  "assignments total=4 ready=0 pending=0 running=0 completed=4 failed=0 blocked=0",
                ],
                operatorSurface: {
                  operatorSummary:
                    "片名：《记忆命中的15秒转折》\n1. 0-5s：按已发布经验建立主角目标。\n2. 5-10s：按长期记忆保持连续性。\n3. 10-15s：按 Skill 收束反转。",
                },
              },
            };
          },
          director: {
            hostApiUrl: `http://${host}:${port}`,
            hostId: "personal-weixin",
            agentId: "director",
            channel: "personal-weixin",
            autoAdvance: true,
            autoStartRun: true,
            fetchFn,
          },
        },
        {
          message_id: "wx-active-recall-1",
          from_user_id: "friend@im.wechat",
          create_time_ms: 1_777_400_000_000,
          item_list: [
            {
              type: 1,
              text_item: {
                text: "/制作 Create a continuity-safe teaser with an immersive three-shot storyboard.",
              },
            },
          ],
        },
      );

      expect(result).toBe("sent");
      const session = loadPeerSession(home, account.normalizedAccountId, "friend@im.wechat");
      expect(session?.runId).toBeTruthy();
      const run = JSON.parse(
        readFileSync(
          join(
            workspaceRoot,
            ".director-angel",
            "runtime",
            "execution",
            "runs",
            session?.runId ?? "",
            "run.json",
          ),
          "utf8",
        ),
      ) as {
        notes?: string[];
        assignments?: Array<{ constraints?: Array<{ requirement: string }> }>;
      };
      expect(run.notes).toEqual(
        expect.arrayContaining([
          "recall=hit",
          "published-knowledge=hit",
          "long-term-memory=hit",
          "skills=hit",
          expect.stringContaining("recall-hit=memory-1"),
          expect.stringContaining("published-pack=director-method-continuity-teaser"),
          "long-term-signal=long-term-memory:memory",
          "skill-hit=continuity-teaser-skill",
        ]),
      );
      const constraintText = (run.assignments ?? [])
        .flatMap((assignment) => assignment.constraints ?? [])
        .map((constraint) => constraint.requirement)
        .join("\n");
      expect(constraintText).toContain("Recall continuity brief");
      expect(constraintText).toContain("Published method brief");
      expect(constraintText).toContain("Long-term memory long-term-memory:memory");
      expect(constraintText).toContain("Skill continuity-teaser-skill");

      const reply = readSentText(calls.at(-1)?.body);
      expect(reply).toContain("模型不可用");
      expect(reply).toContain("不能用本地模板冒充制作结果");
      expect(reply).not.toContain("记忆命中的15秒转折");
      expect(reply).not.toContain("long-term-memory");
      expect(reply).not.toContain("published-pack=");
      expect(reply).not.toContain("skill-hit=");
    } finally {
      await app.close();
    }
  });
});

function writeRuntimeSwitchesFixture(workspaceRoot: string, features: Record<string, boolean>) {
  const runtimeDir = join(workspaceRoot, ".director-angel", "runtime");
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, "switches.json"),
    `${JSON.stringify(
      {
        schemaId: "director.switches.v1",
        features,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function writeLongTermMemoryFixture(workspaceRoot: string) {
  const memoryDir = join(workspaceRoot, ".director-angel", "memory");
  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(
    join(memoryDir, "MEMORY.md"),
    [
      "# MEMORY",
      "",
      "- Keep anchor-a visible in the opening shot.",
      "- Preserve the approved immersive teaser tone.",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(memoryDir, "USER.md"),
    ["# USER", "", "- Prefers concise Chinese production results."].join("\n"),
    "utf8",
  );
}

function writeApprovedSkillFixture(dataDir: string) {
  new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir }), {
    now: () => 1_776_000_001_000,
  }).writeApproved([
    {
      id: "continuity-teaser-skill",
      version: "1.0.0",
      title: "Continuity teaser Skill",
      description: "Use for continuity-safe teaser storyboards.",
      content:
        "Build a three-shot continuity teaser: keep anchor-a visible in the first shot, preserve the immersive tone, and verify continuity before handoff.",
      tags: ["continuity", "teaser", "immersive"],
      toolNames: ["director.blueprint"],
      updatedAtMs: 1_776_000_000_000,
    },
  ]);
}

async function writePublishedKnowledgeFixture(workspaceRoot: string) {
  await new FileKnowledgeStore({
    knowledgeDir: join(workspaceRoot, ".director-angel", "knowledge"),
  }).publish({
    schemaVersion: "director.knowledge.pack.v1",
    metadata: {
      id: "director-method-continuity-teaser",
      title: "Director method: continuity-safe teaser",
      description: "Use the previously approved continuity-safe route.",
      tags: ["continuity", "teaser", "immersive"],
      createdAt: "2026-04-13T03:00:00.000Z",
      version: 1,
    },
    stage: "published",
    method: {
      sourceProposalId: "proposal-published-1",
      sourceRecordId: "record-published-1",
      sourceDigestId: "digest-published-1",
      projectId: WEIXIN_ACTIVE_RECALL_PROJECT_ID,
      groupId: WEIXIN_ACTIVE_RECALL_GROUP_ID,
      goal: "Create a continuity-safe teaser.",
      trigger: "When planning a continuity-safe teaser for the same project group.",
      summary: "Use the previously approved continuity-safe route.",
      explanation: "Preserve anchor continuity and keep the immersive teaser tone.",
      evidenceSummary: "completed run with stable teaser continuity",
      roles: ["researcher", "script-planner"],
      preferredAdapters: ["scripted"],
      anchorIds: ["anchor-a"],
      generationType: "new",
      generationStyle: "immersive",
    },
    audit: {
      publishedAt: "2026-04-13T03:01:00.000Z",
      author: "director-weixin-test",
    },
  });
}

async function writeMemoryRecordFixture(workspaceRoot: string) {
  const store = new FileSystemDirectorMemoryStore({
    rootPath: join(workspaceRoot, ".director-angel", "runtime", "memory"),
    clock: () => "2026-04-12T12:00:00.000Z",
  });
  await store.writeRecord(createMemoryRecord());
}

function createMemoryRecord(): DirectorMemoryRecord {
  const recordedAt = "2026-04-12T10:00:00.000Z";
  return {
    schemaVersion: "director.memory.record.v1",
    recordId: "memory-1",
    digestId: "digest-memory-1",
    projectId: WEIXIN_ACTIVE_RECALL_PROJECT_ID,
    groupId: WEIXIN_ACTIVE_RECALL_GROUP_ID,
    anchorIds: ["anchor-a"],
    selectedAdapters: ["scripted"],
    tags: ["continuity", "teaser", "immersive"],
    status: "completed",
    recordedAt,
    digest: {
      schemaVersion: "director.memory.trace-digest.v1",
      digestId: "digest-memory-1",
      runId: "run-memory-1",
      reportId: "report-memory-1",
      snapshotId: "snapshot-memory-1",
      runtimeId: "runtime-1",
      blueprintId: "blueprint-memory-1",
      handoffId: "handoff-memory-1",
      actionGraphId: "graph-memory-1",
      projectId: WEIXIN_ACTIVE_RECALL_PROJECT_ID,
      groupId: WEIXIN_ACTIVE_RECALL_GROUP_ID,
      goal: "Create a continuity-safe teaser.",
      previewSummary: "Previous completed run preserved continuity with scripted adapter.",
      status: "completed",
      roles: ["researcher", "script-planner"],
      anchorIds: ["anchor-a"],
      selectedAdapters: ["scripted"],
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
      eventTypes: ["run-created"],
      createdAt: "2026-04-12T09:50:00.000Z",
      startedAt: "2026-04-12T09:51:00.000Z",
      completedAt: "2026-04-12T09:59:00.000Z",
      recordedAt,
      generationType: "new",
      generationStyle: "immersive",
      knowledgeSignalTags: ["continuity", "teaser"],
    },
  };
}
