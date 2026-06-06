import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";
import {
  createConversationRuntimeBackgroundJobTask,
  createFileLearningArtifactStore,
  createLearningArtifact,
  createSQLiteConversationRuntimeBackgroundJobScheduleStore,
  createSQLiteConversationRuntimeBackgroundJobStore,
} from "@hotflow/conversation-runtime";
import { FileKnowledgeStore } from "@hotflow/director-knowledge";
import { SkillSnapshotFileStore, resolveApprovedSkillSnapshotPath } from "@hotflow/skills";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WeixinGateway, handleWeixinMessage } from "../src/adapter.js";
import {
  appendPeerConversationTurn,
  findPendingWeixinRuntimeToolApproval,
  loadPeerSession,
  loadWeixinRuntimeToolApprovals,
  savePeerSession,
  saveWeixinAccount,
  saveWeixinRuntimeToolApproval,
} from "../src/store.js";
import type { FetchLike } from "../src/types.js";

const roots: string[] = [];

function writeLegacyPeerLearningArtifact(
  home: string,
  normalizedAccountId: string,
  peerId: string,
  state: Record<string, unknown>,
): void {
  const dir = join(home, "learning-artifacts", normalizedAccountId);
  mkdirSync(dir, { recursive: true });
  const file = join(
    dir,
    `${
      peerId
        .trim()
        .replace(/@/gu, "-")
        .replace(/[^a-zA-Z0-9._-]/gu, "-")
        .replace(/-+/gu, "-")
        .replace(/^-|-$/gu, "") || "unknown-peer"
    }.json`,
  );
  writeFileSync(file, JSON.stringify(state, null, 2));
}

afterEach(() => {
  vi.restoreAllMocks();
  process.env.HOTFLOW_MEMPALACE_MODE = undefined;
  process.env.HOTFLOW_MEMPALACE_COMMAND = undefined;
  process.env.HOTFLOW_MEMPALACE_PALACE_PATH = undefined;
  process.env.HOTFLOW_MEMPALACE_COMMAND_ARGS = undefined;
  process.env.HOTFLOW_MEMPALACE_N_RESULTS = undefined;
  process.env.DIRECTOR_BROWSER_TOOL_URL = undefined;
  process.env.DIRECTOR_DESKTOP_BACKGROUND_RUNTIME_DB_PATH = undefined;
  process.env.HOTFLOW_DATA_DIR = undefined;
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

function jsonResponseWithStatusText(body: unknown, status = 200, statusText = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function sogouWeixinSearchHtmlFixture() {
  return `
    <html><body>
      <ul class="news-list">
        <li>
          <h3><a href="https://mp.weixin.qq.com/s/weixin-seedance-source">Seedance 2.0 公众号实操教程</a></h3>
          <p class="txt-info">来自微信公众号的 Seedance 2.0 教程。</p>
        </li>
      </ul>
    </body></html>
  `;
}

function createWeixinMaintenanceFixture(mode: "preview" | "apply") {
  return {
    apiVersion: "director-host-api.v1",
    schemaId: "director.host.maintenance.v1",
    reportSchemaId: "director.maintenance.report.v1",
    generatedAt: "2026-05-03T00:00:00.000Z",
    mode,
    auditPath: "/tmp/weixin-maintenance.json",
    logMaintenance: {
      summary: { scannedFiles: 2, archiveFiles: 1, archiveBytes: 12 },
      actions: [],
    },
    experienceMaintenance: {
      summary: {
        activeCandidates: 3,
        archiveCandidates: 1,
        archiveQuarantines: 1,
        archiveArtifacts: 1,
        duplicateGroups: 1,
      },
      actions: [],
    },
    knowledgeMaintenance: {
      summary: {
        activeCandidates: 2,
        archiveCandidates: 1,
        archiveReviews: 1,
        archiveHistory: 3,
        archiveRollback: 1,
      },
      actions: [],
    },
  };
}

function sentText(body: string | undefined): string {
  if (body === undefined) {
    return "";
  }
  const payload = JSON.parse(body) as {
    readonly msg?: {
      readonly item_list?: readonly { readonly text_item?: { readonly text?: string } }[];
    };
  };
  return payload.msg?.item_list?.[0]?.text_item?.text ?? "";
}

function readRuntimeLearningArtifacts(workspaceRoot: string): readonly Record<string, unknown>[] {
  const raw = readFileSync(
    join(workspaceRoot, ".hotflow", "conversation-runtime", "learning-artifacts.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as { readonly artifacts?: readonly Record<string, unknown>[] };
  return parsed.artifacts ?? [];
}

describe("weixin shared client projection wiring", () => {
  it("routes conversation runtime success replies through the shared text projection", () => {
    const source = readFileSync(new URL("../src/adapter.ts", import.meta.url), "utf8");

    expect(source).toContain("projectConversationRuntimeClientReply");
    expect(source).toContain('surface: "wechat.text"');
    expect(source).toContain("projectedRuntimeReply.text");
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toolNamesFromRequestBody(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.tools)) {
    return [];
  }
  return body.tools
    .map((tool) => {
      if (!isRecord(tool) || !isRecord(tool.function)) {
        return undefined;
      }
      return typeof tool.function.name === "string" ? tool.function.name : undefined;
    })
    .filter((name): name is string => name !== undefined);
}

function toolMessageFromRequestBody(
  body: unknown,
  toolCallId: string,
): { readonly content?: string } | undefined {
  if (!isRecord(body) || !Array.isArray(body.messages)) {
    return undefined;
  }
  for (const message of body.messages) {
    if (!isRecord(message)) {
      continue;
    }
    if (message.role === "tool" && message.tool_call_id === toolCallId) {
      return {
        content: typeof message.content === "string" ? message.content : undefined,
      };
    }
  }
  return undefined;
}

function writeWeixinRuntimeFeatureSwitchesFixture(
  workspaceRoot: string,
  features: Record<string, boolean>,
) {
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
            models: ["director-text", "director-text-backup"],
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

function writeWeixinVisionApiProviderFixture(workspaceRoot: string) {
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
            models: ["director-text", "director-vision"],
            defaultModels: {
              text: "director-text",
              vision: "director-vision",
            },
            capabilities: ["text", "vision"],
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function writeWeixinPublishedKnowledgeFixture(workspaceRoot: string) {
  await new FileKnowledgeStore({
    knowledgeDir: join(workspaceRoot, ".director-angel", "knowledge"),
  }).publish({
    schemaVersion: "director.knowledge.pack.v1",
    metadata: {
      id: "weixin-comfyui-knowledge",
      title: "小猪游泳镜头经验",
      description: "Weixin ComfyUI workflow lesson.",
      tags: ["experience", "self-learning", "comfyui", "script", "story"],
      createdAt: "2026-05-03T00:00:00.000Z",
      version: 1,
    },
    stage: "published",
    method: {
      sourceProposalId: "experience:weixin-comfyui",
      sourceRecordId: "record-weixin-comfyui",
      sourceDigestId: "sha256:weixin-comfyui",
      projectId: "experience-learning",
      groupId: "weixin-comfyui",
      goal: "Create scene-separated ComfyUI script workflows.",
      trigger: "When creating ComfyUI script, image, or video workflows from Weixin.",
      summary: "Keep every scene independent and pass only current-scene prompts to media nodes.",
      explanation: "Angel should generate script and parameters first, then map them into ComfyUI.",
      evidenceSummary: "scene separation and Angel-first parameter generation",
      roles: ["script-planner", "asset-router"],
      preferredAdapters: [],
      anchorIds: ["weixin-comfyui-scene"],
      generationType: "self-learning",
      generationStyle: "weixin-comfyui",
    },
    audit: {
      publishedAt: "2026-05-03T00:01:00.000Z",
      author: "weixin-test",
      note: "published for Weixin ComfyUI recall test",
    },
  });
}

function writeWeixinLongTermMemoryFixture(workspaceRoot: string) {
  const memoryDir = join(workspaceRoot, ".director-angel", "memory");
  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(
    join(memoryDir, "MEMORY.md"),
    "# MEMORY\n\n- Keep each scene separated before mapping ComfyUI image/video nodes.",
    "utf8",
  );
  writeFileSync(
    join(memoryDir, "USER.md"),
    "# USER\n\n- Prefers Angel to generate content before external tool handoff.",
    "utf8",
  );
}

function writeWeixinSkillSnapshotFixture(workspaceRoot: string) {
  const store = new SkillSnapshotFileStore(
    resolveApprovedSkillSnapshotPath({ dataDir: join(workspaceRoot, ".hotflow") }),
  );
  store.writeApproved(
    [
      {
        id: "skill.weixin-comfyui",
        version: "1.0.0",
        title: "微信 ComfyUI Skill",
        description: "Use Angel-authored scene plans before ComfyUI workflow handoff.",
        content:
          "For ComfyUI script workflows, generate the script inside Angel first, split by scene, and map each scene to its own image/video parameters.",
        tags: ["comfyui", "script", "story", "weixin"],
        updatedAtMs: 1,
        priority: 80,
      },
    ],
    { changeKind: "manual" },
  );
}

async function writeWeixinOrdinaryChatRecallFixture(workspaceRoot: string) {
  writeWeixinRuntimeFeatureSwitchesFixture(workspaceRoot, {
    "knowledgeRecall.enabled": true,
    "memory.enabled": true,
  });
  await new FileKnowledgeStore({
    knowledgeDir: join(workspaceRoot, ".director-angel", "knowledge"),
  }).publish({
    schemaVersion: "director.knowledge.pack.v1",
    metadata: {
      id: "weixin-chat-opening-knowledge",
      title: "微信普通对话开场经验",
      description: "Ordinary Weixin chat should reuse shared recall context.",
      tags: ["experience", "self-learning", "chat", "director", "opening"],
      createdAt: "2026-05-03T00:00:00.000Z",
      version: 1,
    },
    stage: "published",
    method: {
      sourceProposalId: "experience:weixin-chat",
      sourceRecordId: "record-weixin-chat",
      sourceDigestId: "sha256:weixin-chat",
      projectId: "experience-learning",
      groupId: "weixin-chat",
      goal: "Answer ordinary Weixin chat with relevant published context.",
      trigger: "When ordinary Weixin chat asks for Director Angel copywriting.",
      summary: "Keep Weixin ordinary chat on the shared hidden contextual recall path.",
      explanation: "Do not require the user to manually call Skills or knowledge from Weixin.",
      evidenceSummary: "ordinary chat recall test",
      roles: ["director-chat"],
      preferredAdapters: [],
      anchorIds: ["weixin-chat-opening"],
      generationType: "self-learning",
      generationStyle: "weixin-chat",
    },
    audit: {
      publishedAt: "2026-05-03T00:01:00.000Z",
      author: "weixin-test",
      note: "published for Weixin ordinary chat recall test",
    },
  });

  const memoryDir = join(workspaceRoot, ".director-angel", "memory");
  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(join(memoryDir, "MEMORY.md"), "# MEMORY\n\n- 微信对话要结果优先。", "utf8");
  writeFileSync(join(memoryDir, "USER.md"), "# USER\n\n- 用户喜欢中文短回复。", "utf8");

  new SkillSnapshotFileStore(
    resolveApprovedSkillSnapshotPath({ dataDir: join(workspaceRoot, ".hotflow") }),
  ).writeApproved(
    [
      {
        id: "skill.weixin-opening",
        version: "1.0.0",
        title: "Angel 微信开场白 Skill",
        description: "Write concise Director Angel opening copy in ordinary chat.",
        content: "For ordinary Weixin chat, answer directly and keep process details hidden.",
        tags: ["chat", "director", "opening", "angel"],
        updatedAtMs: 1,
        priority: 90,
      },
    ],
    { changeKind: "manual" },
  );
}

describe("weixin message adapter", () => {
  it("uses the shared conversation-runtime learning store instead of a Weixin-only copy", () => {
    const source = readFileSync(new URL("../src/adapter.ts", import.meta.url), "utf8");
    const resolverStart = source.indexOf("function resolveWeixinLearningArtifactStorePath");
    const resolverEnd = source.indexOf("function stopWeixinConversationRuntimeRuns", resolverStart);
    const resolverSource = source.slice(resolverStart, resolverEnd);

    expect(resolverSource).toContain('".hotflow"');
    expect(resolverSource).toContain('"conversation-runtime"');
    expect(resolverSource).toContain('"learning-artifacts.json"');
    expect(resolverSource).not.toContain("config.home");
    expect(resolverSource).not.toContain("normalizedAccountId");
  });

  it("logs update batches and ignored message reasons without writing message text", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const logs: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      if (url.endsWith("/ilink/bot/msg/notifystart")) {
        return jsonResponse({ ret: 0 });
      }
      if (url.endsWith("/ilink/bot/getupdates")) {
        return jsonResponse({
          ret: 0,
          get_updates_buf: "sync-next",
          msgs: [
            {
              message_id: "self-message-1",
              from_user_id: "bot@im.bot",
              item_list: [{ type: 1, text_item: { text: "secret self chatter" } }],
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    };

    const gateway = new WeixinGateway({
      home,
      account,
      dmPolicy: "open",
      allowedUsers: [],
      fetchFn,
      log: (message) => logs.push(message),
      director: {
        hostApiUrl: "http://127.0.0.1:3201",
        hostId: "personal-weixin",
        agentId: "director",
        channel: "personal-weixin",
        autoAdvance: false,
        autoStartRun: false,
        fetchFn,
      },
    });

    await gateway.start({ once: true });

    expect(logs.join("\n")).toContain("weixin received 1 update message");
    expect(logs.join("\n")).toContain("weixin ignored self message");
    expect(logs.join("\n")).not.toContain("secret self chatter");
  });

  it("dedupes repeated Weixin update messages with a persisted message ledger", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-dedupe-"));
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-dedupe-workspace-"));
    roots.push(home, workspaceRoot);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const sentReplies: string[] = [];
    const logs: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      if (url.endsWith("/ilink/bot/msg/notifystart")) {
        return jsonResponse({ ret: 0 });
      }
      if (url.endsWith("/ilink/bot/getupdates")) {
        return jsonResponse({
          ret: 0,
          get_updates_buf: "sync-next",
          msgs: [
            {
              message_id: "duplicate-message-1",
              from_user_id: "friend@im.wechat",
              item_list: [{ type: 1, text_item: { text: "你好，重复消息只回一次" } }],
            },
            {
              message_id: "duplicate-message-1",
              from_user_id: "friend@im.wechat",
              item_list: [{ type: 1, text_item: { text: "你好，重复消息只回一次" } }],
            },
          ],
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        sentReplies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async () =>
      jsonResponse({ choices: [{ message: { content: "只回复一次。" } }] });
    const createGateway = () =>
      new WeixinGateway({
        home,
        workspaceRoot,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        apiProviderFetch,
        log: (message) => logs.push(message),
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: false,
          autoStartRun: false,
          fetchFn,
        },
      });

    await createGateway().start({ once: true });
    await createGateway().start({ once: true });

    expect(sentReplies).toEqual(["只回复一次。"]);
    expect(logs.join("\n")).toContain("weixin skipped duplicate message id=duplicate-message-1");
    const ledgerPath = join(
      home,
      "processed-messages",
      account.normalizedAccountId,
      "messages.json",
    );
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as {
      readonly messages?: readonly { readonly messageId?: string; readonly status?: string }[];
    };
    expect(ledger.messages).toEqual([
      expect.objectContaining({ messageId: "duplicate-message-1", status: "sent" }),
    ]);
  });

  it("answers low-value casual chatter through dynamic chat without sending it to Director memory paths", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-chat-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const providerCalls: Array<{ readonly url: string; readonly body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async (url, init) => {
      providerCalls.push({ url, body: init?.body });
      return jsonResponse({
        choices: [
          {
            message: {
              content: "我在。天气这句我会当普通聊天处理，不会写进经验；你继续说就行。",
            },
          },
        ],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: false,
          autoStartRun: false,
          fetchFn,
        },
      },
      {
        message_id: "wx-msg-1",
        from_user_id: "friend@im.wechat",
        context_token: "ctx-1",
        create_time_ms: 1_713_000_000_000,
        item_list: [{ type: 1, text_item: { text: "今天天气不错，随便聊聊" } }],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/ilink/bot/sendmessage"]);
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]?.body).toContain("今天天气不错，随便聊聊");
    expect(providerCalls[0]?.body).toContain("统一对话运行时");
    expect(providerCalls[0]?.body).toContain("不要把普通闲聊");
    expect(sentText(calls[0]?.body)).toContain("普通聊天处理");
    expect(sentText(calls[0]?.body)).not.toContain("直接发制作目标、链接、文件目录或补充要求");
    expect(calls[0]?.body).not.toContain("蓝图：");
    expect(calls[0]?.body).not.toContain("Run：");
  });

  it("routes Weixin image understanding chat to the provider vision model when text default is text-only", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-vision-route-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinVisionApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async (url, init) => {
      providerCalls.push({ url, body: init?.body });
      return jsonResponse({
        choices: [{ message: { content: "这张图我会交给视觉模型看，再用中文说结果。" } }],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: false,
          autoStartRun: false,
          fetchFn,
        },
      },
      {
        message_id: "wx-image-understanding-route",
        from_user_id: "friend@im.wechat",
        item_list: [
          { type: 1, text_item: { text: "看看这张图里有什么" } },
          { type: 2, image_item: { id: "image-1", mime_type: "image/png" } },
        ],
      },
    );

    expect(result).toBe("sent");
    expect(providerCalls).toHaveLength(1);
    const body = JSON.parse(providerCalls[0]?.body ?? "{}") as { readonly model?: string };
    expect(body.model).toBe("director-vision");
    expect(providerCalls[0]?.body).toContain("输入包含图片或视频");
    expect(providerCalls[0]?.body).toContain("切到视觉组");
    expect(sentText(calls[0]?.body)).toContain("视觉模型");
  });

  it("routes loose confirmation words to ordinary chat when no runtime approval or active run is pending", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-confirm-chat-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async (url, init) => {
      providerCalls.push({ url, body: init?.body });
      return jsonResponse({
        choices: [
          {
            message: {
              content: "我会按上下文继续理解，不会把这句话当成不存在的审批。",
            },
          },
        ],
      });
    };
    const config = {
      home,
      workspaceRoot,
      account,
      dmPolicy: "allowlist" as const,
      allowedUsers: ["friend@im.wechat"],
      fetchFn,
      apiProviderFetch,
      director: {
        hostApiUrl: "http://127.0.0.1:3201",
        hostId: "personal-weixin",
        agentId: "director",
        channel: "personal-weixin",
        autoAdvance: false,
        autoStartRun: false,
        fetchFn,
      },
    };

    for (const prompt of ["确认", "继续", "执行", "确认执行，内容是：小猫从家里走到公园"]) {
      const result = await handleWeixinMessage(config, {
        message_id: `wx-confirm-chat-${providerCalls.length}`,
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: prompt } }],
      });

      expect(result).toBe("sent");
      expect(sentText(calls.at(-1)?.body)).toContain("我会按上下文继续理解");
      expect(sentText(calls.at(-1)?.body)).not.toContain("没有找到仍在等待确认的工具操作");
      expect(sentText(calls.at(-1)?.body)).not.toContain("没有可继续的上一版");
    }

    expect(providerCalls).toHaveLength(4);
  });

  it("does not treat peer learning shadow cache as a saveable confirmation source", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-shadow-cache-confirm-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    writeLegacyPeerLearningArtifact(home, account.normalizedAccountId, "friend@im.wechat", {
      peerId: "friend@im.wechat",
      source: "runtime-tool",
      query: "https://example.com/stale-learning",
      candidateCount: 1,
      candidates: [{ candidateId: "exp-shadow", title: "旧影子缓存候选" }],
      updatedAt: "2026-05-04T19:30:00.000Z",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/v1/experience/candidates/exp-shadow/accept")) {
        throw new Error("shadow cache must not be accepted as the current confirmation target");
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async (url, init) => {
      providerCalls.push({ url, body: init?.body });
      return jsonResponse({
        choices: [{ message: { content: "我没有把旧缓存当成当前可保存候选。" } }],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: false,
          autoStartRun: false,
          fetchFn,
        },
      },
      {
        message_id: "wx-shadow-cache-confirm",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "好的" } }],
      },
    );

    expect(result).toBe("sent");
    expect(providerCalls).toHaveLength(1);
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/ilink/bot/sendmessage"]);
  });

  it("returns degraded model-unavailable output instead of local chat fallback when the provider cannot answer", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-chat-provider-failure-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async (url, init) => {
      providerCalls.push({ url, body: init?.body });
      return jsonResponseWithStatusText({ error: "provider offline" }, 503, "Service Unavailable");
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: false,
          autoStartRun: false,
          fetchFn,
        },
      },
      {
        message_id: "wx-msg-provider-failure",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "你好，随便聊聊" } }],
      },
    );

    const reply = sentText(calls[0]?.body);
    expect(result).toBe("sent");
    expect(providerCalls).toHaveLength(2);
    expect(reply).toContain("模型供应方暂时不可用");
    expect(reply).toContain("不是没有配置模型");
    expect(reply).not.toContain("当前没有可用的模型供应方");
    expect(reply).not.toContain("收到。");
    expect(reply).not.toContain("我在。");
    expect(reply).not.toContain("我会");
  });

  it("reports provider network failures as upstream failures instead of missing models", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-chat-provider-network-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async (url, init) => {
      providerCalls.push({ url, body: init?.body });
      throw new TypeError("fetch failed");
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: false,
          autoStartRun: false,
          fetchFn,
        },
      },
      {
        message_id: "wx-msg-provider-network-failure",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "最近生成图片分镜图哪个模型厉害" } }],
      },
    );

    const reply = sentText(calls[0]?.body);
    expect(result).toBe("sent");
    expect(providerCalls.length).toBeGreaterThan(1);
    expect(reply).toContain("模型供应方暂时不可用");
    expect(reply).toContain("不是没有配置模型");
    expect(reply).not.toContain("当前没有可用的模型供应方");
  });

  it("retries a transient provider network failure before replying to Weixin", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-chat-provider-retry-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async (url, init) => {
      providerCalls.push({ url, body: init?.body });
      if (providerCalls.length === 1) {
        throw new TypeError("fetch failed");
      }
      return jsonResponse({
        choices: [
          {
            message: {
              content: "我查这个会先给你可靠结论，再说明依据。",
            },
          },
        ],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: false,
          autoStartRun: false,
          fetchFn,
        },
      },
      {
        message_id: "wx-msg-provider-network-retry",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "最近生成图片分镜图哪个模型厉害" } }],
      },
    );

    expect(result).toBe("sent");
    expect(providerCalls).toHaveLength(2);
    expect(sentText(calls[0]?.body)).toContain("可靠结论");
    expect(sentText(calls[0]?.body)).not.toContain("模型供应方暂时不可用");
  });

  it("answers untranslated voice messages with Chinese fail-closed guidance", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-voice-unreadable-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };

    const result = await handleWeixinMessage(
      {
        home,
        workspaceRoot,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        apiProviderFetch: async (url, init) => {
          providerCalls.push({ url, body: init?.body });
          return jsonResponse({ choices: [{ message: { content: "不应该调用模型" } }] });
        },
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: false,
          autoStartRun: false,
          fetchFn,
        },
      },
      {
        message_id: "wx-msg-untranslated-voice",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 3, voice_item: { media: { id: "voice-1" } } }],
      },
    );

    const reply = sentText(calls[0]?.body);
    expect(result).toBe("sent");
    expect(providerCalls).toHaveLength(0);
    expect(reply).toContain("我收到了语音");
    expect(reply).toContain("还没有接入语音转文字");
    expect(reply).toContain("请直接发文字");
    expect(reply).not.toContain("Weixin message intake");
    expect(reply).not.toContain("unreadable");
    expect(reply).not.toContain("模型不可用");
  });

  it("does not send raw iLink bridge errors back to the user when reply delivery fails", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-bridge-delivery-fail-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const errors: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: -2, errcode: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: "这是一条模型正常生成的回复，但微信投递会失败。",
            },
          },
        ],
      });

    const result = await handleWeixinMessage(
      {
        home,
        workspaceRoot,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        apiProviderFetch,
        error: (message) => errors.push(message),
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: false,
          autoStartRun: false,
          fetchFn,
        },
      },
      {
        message_id: "wx-msg-bridge-delivery-fail",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "你好，随便聊聊" } }],
      },
    );

    expect(result).toBe("sent");
    expect(calls.filter((call) => call.url.endsWith("/ilink/bot/sendmessage"))).toHaveLength(1);
    expect(calls.map((call) => sentText(call.body)).join("\n")).not.toContain(
      "iLink sendmessage failed",
    );
    expect(calls.map((call) => sentText(call.body)).join("\n")).not.toContain(
      "Weixin director runtime:",
    );
    expect(errors.join("\n")).toContain("iLink sendmessage failed");
  });

  it("aborts a running Weixin conversation runtime request from /停止", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-chat-stop-runtime-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const providerSignals: AbortSignal[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async (_url, init) => {
      if (init?.signal instanceof AbortSignal) {
        providerSignals.push(init.signal);
      }
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("provider request aborted by weixin stop")),
          { once: true },
        );
      });
      throw new Error("unreachable");
    };
    const config = {
      home,
      workspaceRoot,
      account,
      dmPolicy: "allowlist" as const,
      allowedUsers: ["friend@im.wechat"],
      fetchFn,
      apiProviderFetch,
      director: {
        hostApiUrl: "http://127.0.0.1:3201",
        hostId: "personal-weixin",
        agentId: "director",
        channel: "personal-weixin",
        autoAdvance: false,
        autoStartRun: false,
        fetchFn,
      },
    };

    const running = handleWeixinMessage(config, {
      message_id: "wx-msg-stop-runtime-running",
      from_user_id: "friend@im.wechat",
      item_list: [{ type: 1, text_item: { text: "你好，慢慢回答" } }],
    });
    await vi.waitFor(() => {
      expect(providerSignals).toHaveLength(1);
    });

    const stopResult = await handleWeixinMessage(config, {
      message_id: "wx-msg-stop-runtime-command",
      from_user_id: "friend@im.wechat",
      item_list: [{ type: 1, text_item: { text: "/停止" } }],
    });
    const runningResult = await running;

    expect(stopResult).toBe("sent");
    expect(runningResult).toBe("sent");
    expect(providerSignals[0]?.aborted).toBe(true);
    expect(sentText(calls.at(-2)?.body)).toContain("已请求停止当前微信会话");
    expect(sentText(calls.at(-1)?.body)).toContain("已停止当前回合");
    expect(JSON.stringify(calls)).not.toContain("sk-test");
  });

  it("persists Weixin conversation run records in the account runtime store", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-chat-run-persist-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };

    const config = {
      home,
      workspaceRoot,
      account,
      dmPolicy: "allowlist" as const,
      allowedUsers: ["friend@im.wechat"],
      fetchFn,
      apiProviderFetch: async () =>
        jsonResponse({ choices: [{ message: { content: "已记录。" } }] }),
      director: {
        hostApiUrl: "http://127.0.0.1:3201",
        hostId: "personal-weixin",
        agentId: "director",
        channel: "personal-weixin",
        autoAdvance: false,
        autoStartRun: false,
        fetchFn,
      },
    };

    await handleWeixinMessage(config, {
      message_id: "wx-msg-run-persist",
      from_user_id: "friend@im.wechat",
      item_list: [{ type: 1, text_item: { text: "你好，记录这个运行回合" } }],
    });

    const runStorePath = join(
      home,
      "runtime",
      "conversation-runs",
      `${account.normalizedAccountId}.json`,
    );
    const persisted = JSON.parse(readFileSync(runStorePath, "utf8")) as {
      readonly runs?: readonly { readonly sessionKey?: string; readonly turnRunId?: string }[];
    };

    expect(persisted.runs).toEqual([
      expect.objectContaining({
        sessionKey: `weixin:${account.normalizedAccountId}:friend@im.wechat`,
        turnRunId: "weixin:bot-im.bot:friend@im.wechat:weixin-chat-turn-wx-msg-run-persist:run",
      }),
    ]);
  });

  it("answers casual learning and making diary text dynamically instead of sending it to Director", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-chat-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async (url, init) => {
      providerCalls.push({ url, body: init?.body });
      return jsonResponse({
        choices: [
          {
            message: {
              content:
                "挺好，这句话我只当聊天，不会收进经验库。你要沉淀咖啡制作方法时再发明确学习资料。",
            },
          },
        ],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: false,
          autoStartRun: false,
          fetchFn,
        },
      },
      {
        message_id: "wx-msg-casual-learning",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "我今天学习制作咖啡，挺开心" } }],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/ilink/bot/sendmessage"]);
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]?.body).toContain("我今天学习制作咖啡");
    expect(sentText(calls[0]?.body)).toContain("只当聊天");
    expect(sentText(calls[0]?.body)).not.toContain("直接发制作目标、链接、文件目录或补充要求");
  });

  it("returns degraded output for identity and capability questions when no model is configured", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-no-provider-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };

    const result = await handleWeixinMessage(
      {
        home,
        workspaceRoot,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: false,
          autoStartRun: false,
          fetchFn,
        },
      },
      {
        message_id: "wx-msg-capability-intro",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "你是谁呀？你的功能是什么？" } }],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/ilink/bot/sendmessage"]);
    const reply = sentText(calls[0]?.body);
    expect(reply).toContain("模型 Key 未配置");
    expect(reply).toContain("不能假装调用成功");
    expect(reply).not.toContain("Director Angel");
    expect(reply).not.toContain("制作");
    expect(reply).not.toContain("学习");
    expect(reply).not.toContain("ComfyUI");
    expect(reply).not.toContain("我在。");
  });

  it("routes learning and review slash commands through the shared Host API", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url === "https://example.com/shot-guide") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async text() {
            return [
              "<html><head><title>镜头语言资料</title></head><body><article>",
              "<p>镜头语言资料正文：导演在做短片分镜时，先明确人物目标、冲突变化和每个镜头的信息功能。</p>",
              "<p>实操步骤包括建立场景节拍、选择景别、安排运动方向、标注情绪转折，并把镜头拆成可执行的拍摄单元。</p>",
              "<p>复盘时检查镜头是否服务叙事，是否能让剪辑顺畅衔接，是否给表演和声音留下足够空间。</p>",
              "</article></body></html>",
            ].join("");
          },
        };
      }
      if (url.endsWith("/v1/learning/text")) {
        return jsonResponse(
          {
            result: { candidateCount: 1 },
            candidates: [{ candidateId: "exp-1", title: "镜头语言资料" }],
          },
          201,
        );
      }
      if (url.endsWith("/v1/experience/candidates") && init?.method === "GET") {
        return jsonResponse({
          experienceCandidates: [{ candidateId: "exp-1", title: "镜头语言资料" }],
        });
      }
      if (url.endsWith("/v1/experience/candidates/exp-1/accept")) {
        return jsonResponse({
          review: { candidateId: "exp-1", decision: "accepted" },
        });
      }
      if (url.endsWith("/v1/experience/candidates/exp-1/promote")) {
        return jsonResponse({
          knowledgeCandidate: { metadata: { id: "pack-1", title: "镜头语言知识" } },
        });
      }
      if (url.endsWith("/v1/knowledge/candidates") && init?.method === "GET") {
        return jsonResponse({
          knowledgeCandidates: [{ metadata: { id: "pack-1", title: "镜头语言知识" } }],
        });
      }
      if (url.endsWith("/v1/knowledge/candidates/pack-1/accept")) {
        return jsonResponse({
          review: { packId: "pack-1", decision: "accepted" },
        });
      }
      if (url.endsWith("/v1/knowledge/candidates/pack-1/publish")) {
        return jsonResponse({
          published: { metadata: { id: "pack-1", title: "镜头语言知识" }, stage: "published" },
        });
      }
      if (url.endsWith("/v1/knowledge/recall-preview")) {
        return jsonResponse({
          recall: {
            status: "hit",
            hits: [
              {
                knowledgePackId: "pack-1",
                title: "镜头语言知识",
                reasons: ["tag match: 镜头"],
              },
            ],
          },
        });
      }
      if (url.endsWith("/v1/memory/status")) {
        return jsonResponse({
          schemaId: "director.host.memory-status.v1",
          enabled: true,
          status: "ok",
          runtimeMemory: {
            storeStatus: "ok",
            recordCount: 1,
          },
          longTerm: {
            status: "hit",
            signals: [{ id: "long-term-memory:memory" }],
          },
        });
      }
      if (url.endsWith("/v1/memory/recall-preview")) {
        return jsonResponse({
          schemaId: "director.host.memory-recall-preview.v1",
          enabled: true,
          packet: {
            status: "ok",
            hits: [
              {
                recordId: "memory-1",
                summary: "复用连续性锚点。",
              },
            ],
          },
        });
      }
      if (url.includes("/v1/maintenance") && init?.method === "GET") {
        return jsonResponse(createWeixinMaintenanceFixture("preview"));
      }
      if (url.endsWith("/v1/maintenance") && init?.method === "POST") {
        return jsonResponse(createWeixinMaintenanceFixture("apply"));
      }
      if (url.endsWith("/v1/skills/proposals/from-experience")) {
        return jsonResponse(
          {
            proposal: { id: "proposal-1", title: "Skill：镜头语言", status: "pending" },
          },
          201,
        );
      }
      if (url.endsWith("/v1/skills") && init?.method === "GET") {
        return jsonResponse({
          skills: [{ id: "skill-1", title: "三镜头 Skill" }],
        });
      }
      if (url.endsWith("/v1/skills/proposals") && init?.method === "GET") {
        return jsonResponse({
          proposals: [{ id: "proposal-1", title: "Skill：镜头语言", status: "pending" }],
        });
      }
      if (url.endsWith("/v1/skills/proposals/proposal-1/accept")) {
        return jsonResponse({
          proposal: { id: "proposal-1", title: "Skill：镜头语言", status: "accepted" },
        });
      }
      if (url.endsWith("/v1/skills/proposals/proposal-1/apply")) {
        return jsonResponse({
          proposal: { id: "proposal-1", title: "Skill：镜头语言", status: "applied" },
          skills: [{ id: "skill-1", title: "三镜头 Skill" }],
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const config = {
      home,
      account,
      dmPolicy: "allowlist" as const,
      allowedUsers: ["friend@im.wechat"],
      fetchFn,
      director: {
        hostApiUrl: "http://127.0.0.1:3201",
        hostId: "personal-weixin",
        agentId: "director",
        channel: "personal-weixin",
        autoAdvance: true,
        autoStartRun: true,
        fetchFn,
      },
    };

    for (const [index, text] of [
      "/学习链接 https://example.com/shot-guide",
      "/经验",
      "/经验 通过 exp-1",
      "/经验 提炼 exp-1",
      "/知识 候选",
      "/知识 通过 pack-1",
      "/知识 发布 pack-1",
      "/知识 召回 镜头",
      "/记忆",
      "/记忆 召回 project=project-personal-weixin:personal-weixin:friend@im.wechat tag=continuity max=2",
      "/维护 日志保留 7",
      "/维护 执行 日志保留 7",
      "/技能 从经验 exp-1",
      "/技能",
      "/技能 接受 proposal-1",
      "/技能 应用 proposal-1",
    ].entries()) {
      const result = await handleWeixinMessage(config, {
        message_id: `wx-capability-${index}`,
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text } }],
      });
      expect(result).toBe("sent");
    }

    expect(
      calls
        .filter((call) => !call.url.endsWith("/ilink/bot/sendmessage"))
        .filter((call) => call.url.startsWith("http://127.0.0.1:3201"))
        .map((call) => new URL(call.url).pathname),
    ).toEqual([
      "/v1/learning/text",
      "/v1/experience/candidates",
      "/v1/experience/candidates/exp-1/accept",
      "/v1/experience/candidates/exp-1/promote",
      "/v1/knowledge/candidates",
      "/v1/knowledge/candidates/pack-1/accept",
      "/v1/knowledge/candidates/pack-1/publish",
      "/v1/knowledge/recall-preview",
      "/v1/memory/status",
      "/v1/memory/recall-preview",
      "/v1/maintenance",
      "/v1/maintenance",
      "/v1/skills/proposals/from-experience",
      "/v1/skills",
      "/v1/skills/proposals",
      "/v1/skills/proposals/proposal-1/accept",
      "/v1/skills/proposals/proposal-1/apply",
    ]);
    const hostCalls = calls.filter((call) => call.url.startsWith("http://127.0.0.1:3201"));
    expect(hostCalls[0]?.body).toContain("https://example.com/shot-guide");
    expect(hostCalls[0]?.body).toContain("镜头语言资料正文");
    expect(calls.some((call) => call.url.endsWith("/v1/learning/url"))).toBe(false);
    expect(
      hostCalls.find((call) => new URL(call.url).pathname.endsWith("/exp-1/accept"))?.body,
    ).toContain("director-weixin-gateway");
    expect(
      hostCalls.find(
        (call) => new URL(call.url).pathname === "/v1/skills/proposals/from-experience",
      )?.body,
    ).toContain("exp-1");
    expect(replies.join("\n")).toContain("看完了。核心是：镜头语言资料");
    expect(replies.join("\n")).toContain("已整理出 1 条待确认经验候选");
    expect(replies.join("\n")).not.toContain("链接学习结果");
    expect(replies.join("\n")).not.toContain("候选：1 条");
    expect(replies.join("\n")).not.toContain("我找到 1 条可审的学习候选");
    expect(replies.join("\n")).not.toContain("下一步：/经验");
    expect(replies.join("\n")).toContain("经验候选 1 条");
    expect(replies.join("\n")).toContain("已通过经验：exp-1");
    expect(replies.join("\n")).toContain("已提炼为知识候选：pack-1");
    expect(replies.join("\n")).toContain("知识候选 1 条");
    expect(replies.join("\n")).toContain("已发布知识：pack-1");
    expect(replies.join("\n")).toContain("知识召回命中 1 条");
    expect(replies.join("\n")).toContain("镜头语言知识");
    expect(replies.join("\n")).toContain("运行记忆：ok，1 条");
    expect(replies.join("\n")).toContain("运行记忆召回命中 1 条");
    expect(replies.join("\n")).toContain("memory-1");
    expect(replies.join("\n")).toContain("维护预览完成");
    expect(replies.join("\n")).toContain("维护已执行完成");
    expect(replies.join("\n")).toContain("日志：扫描 2 个，归档 1 个");
    expect(replies.join("\n")).toContain("知识：候选归档 1 条，审查归档 1 条，历史归档 3 条");
    expect(replies.join("\n")).toContain("已生成 Skill 候选：proposal-1");
    expect(replies.join("\n")).toContain("Skill 1 个");
    expect(replies.join("\n")).toContain("已接受 Skill 候选：proposal-1");
    expect(replies.join("\n")).toContain("已安装 Skill：proposal-1");
  });

  it("does not run natural search-and-learn requests without a model", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (String(url).includes("https://weixin.sogou.com/weixin")) {
        return {
          ok: true,
          status: 200,
          url: String(url),
          async text() {
            return sogouWeixinSearchHtmlFixture();
          },
        };
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      throw new Error(`unexpected url ${url}`);
    };

    const result = await handleWeixinMessage(
      {
        home,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-natural-learning-query",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [
          {
            type: 1,
            text_item: {
              text: "现在去搜索微信公众号的文章，找一下有没有新seedance2.0最新的文章学习这方面的制作经验",
            },
          },
        ],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(
      expect.arrayContaining(["/weixin", "/ilink/bot/sendmessage"]),
    );
    expect(replies.at(-1)).toContain("取证来源：搜狗微信公众号文章搜索");
    expect(replies.at(-1)).toContain("要继续的话，我会优先读取上面这些来源的正文");
    expect(replies.at(-1)).not.toContain("Run：");
    expect(replies.at(-1)).not.toContain("蓝图：");
    expect(replies.at(-1)).not.toContain("Seedance 2.0 制作经验");
    expect(replies.at(-1)).not.toContain("我找到");
  });

  it("routes natural URL learning through direct extraction without model search or Host URL passthrough", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-natural-url-learning-"));
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "director-weixin-natural-url-learning-workspace-"),
    );
    roots.push(home, workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url === "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async text() {
            return "<html><head><title>微信公众平台</title></head><body>环境异常 当前环境异常，完成验证后即可继续访问。视频 小程序 赞 ，轻点两下取消赞 在看 ，轻点两下取消在看</body></html>";
          },
        };
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      throw new Error(`unexpected url ${url}`);
    };
    const apiProviderFetch: FetchLike = async () => {
      throw new Error("model should not be called for direct URL learning");
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-natural-url-learning",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [
          {
            type: 1,
            text_item: {
              text: "那你去学习这个呀，https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
            },
          },
        ],
      },
    );

    const nonDeliveryPaths = calls
      .filter((call) => !call.url.endsWith("/ilink/bot/sendmessage"))
      .filter((call) => call.url.startsWith("http://127.0.0.1:3201"))
      .map((call) => new URL(call.url).pathname);
    expect(result).toBe("sent");
    expect(nonDeliveryPaths).toEqual([]);
    expect(calls.some((call) => call.url.endsWith("/v1/learning/url"))).toBe(false);
    expect(calls.some((call) => call.url.includes("sogou"))).toBe(false);
    expect(replies.at(-1)).toContain("这次还没有学到可信正文");
    expect(replies.at(-1)).toContain("访问受限");
    expect(replies.at(-1)).toContain("换成可公开访问的链接");
    expect(replies.at(-1)).not.toContain("Weixin learning result");
    expect(replies.at(-1)).not.toContain("candidate-created");
    expect(replies.at(-1)).not.toContain("status:");
    expect(replies.at(-1)).not.toContain("next action");
    expect(replies.at(-1)).not.toContain("搜狗");
    expect(replies.at(-1)).not.toContain("我找到");
    const artifact = readRuntimeLearningArtifacts(workspaceRoot).find(
      (item) => item.sourceRef === "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
    );
    expect(artifact?.sourceSurface).toBe("weixin");
    expect(artifact?.sourceKind).toBe("url");
    expect(artifact?.publishable).toBe(false);
    const runStorePath = join(
      home,
      "runtime",
      "conversation-runs",
      `${account.normalizedAccountId}.json`,
    );
    const persisted = JSON.parse(readFileSync(runStorePath, "utf8")) as {
      readonly runs?: readonly {
        readonly messageId?: string;
        readonly status?: string;
        readonly userVisibleSummary?: string;
        readonly sourceRefs?: readonly string[];
        readonly failureTaxonomy?: readonly string[];
        readonly events?: readonly { readonly kind?: string; readonly metadata?: unknown }[];
      }[];
    };
    expect(persisted.runs).toEqual([
      expect.objectContaining({
        messageId: "wx-natural-url-learning",
        status: "completed",
        userVisibleSummary: "没有读到可信正文，已隔离，未生成经验候选。",
        sourceRefs: ["https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA"],
        failureTaxonomy: ["source-access-limited"],
      }),
    ]);
    expect(persisted.runs?.[0]?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.tool",
          metadata: expect.objectContaining({
            payload: expect.objectContaining({
              tool: expect.objectContaining({ phase: "requested" }),
            }),
          }),
        }),
        expect.objectContaining({
          kind: "runtime.tool",
          metadata: expect.objectContaining({
            payload: expect.objectContaining({
              tool: expect.objectContaining({ phase: "failed" }),
            }),
          }),
        }),
      ]),
    );
  });

  it("keeps slash URL learning fail-closed when direct extraction returns low-quality source residue", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-slash-url-quality-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url === "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async text() {
            return "<html><head><title>微信公众平台</title></head><body>环境异常 当前环境异常，完成验证后即可继续访问。视频 小程序 赞 在看</body></html>";
          },
        };
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      throw new Error(`unexpected url ${url}`);
    };

    const result = await handleWeixinMessage(
      {
        home,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-slash-url-quality",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [
          {
            type: 1,
            text_item: {
              text: "/学习 https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
            },
          },
        ],
      },
    );

    expect(result).toBe("sent");
    expect(calls.some((call) => call.url.endsWith("/v1/learning/url"))).toBe(false);
    expect(calls.some((call) => call.url.endsWith("/v1/learning/text"))).toBe(false);
    expect(replies.at(-1)).toContain("这次还没有学到可信正文");
    expect(replies.at(-1)).toContain("访问受限");
    expect(replies.at(-1)).not.toContain("已学会");
    expect(replies.at(-1)).not.toContain("已整理出 1 条");
  });

  it("does not let peer shadow-cache block an explicit URL learning turn", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-repeat-url-learning-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    writeLegacyPeerLearningArtifact(home, account.normalizedAccountId, "friend@im.wechat", {
      peerId: "friend@im.wechat",
      source: "url",
      query: "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
      candidateCount: 0,
      candidates: [],
      failureCount: 1,
      failures: [
        {
          sourceRef: "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
          title: "mp.weixin.qq.com",
          reason: "source_access_limited",
          detail: "环境异常 当前环境异常，完成验证后即可继续访问。",
        },
      ],
      sourceEvidenceRefs: [
        {
          id: "source-evidence-weixin-url",
          sourceKind: "url",
          sourceRef: "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
          sourceSnapshotId: "artifact-weixin-access-limited",
          sourceAccessStatus: "source_access_limited",
          publishable: false,
        },
      ],
      memoryEvidenceRecords: [],
      updatedAt: "2026-05-04T19:30:00.000Z",
    });
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url === "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async text() {
            return "<html><head><title>微信公众平台</title></head><body>环境异常 当前环境异常，完成验证后即可继续访问。</body></html>";
          },
        };
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      throw new Error(`unexpected url ${url}`);
    };
    const apiProviderFetch: FetchLike = async () => {
      throw new Error("model should not be called for repeated direct URL learning");
    };

    const result = await handleWeixinMessage(
      {
        home,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        apiProviderFetch,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-natural-url-learning-repeat",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_001_000,
        item_list: [
          {
            type: 1,
            text_item: {
              text: "你已经重复过一次了，学习这个 https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
            },
          },
        ],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/s/yvSFP83rP6O1NndGBb7UAA",
      "/ilink/bot/sendmessage",
    ]);
    expect(replies.at(-1)).toContain("这次还没有学到可信正文");
    expect(replies.at(-1)).toContain("访问受限");
    expect(replies.at(-1)).not.toContain("Weixin learning result");
    expect(replies.at(-1)).not.toContain("这个链接我看过了");
    expect(replies.at(-1)).not.toContain("repeated URL");
  });

  it("re-reads explicit X learning instead of trusting stale peer script-shell artifacts", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-repeat-x-shell-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    writeLegacyPeerLearningArtifact(home, account.normalizedAccountId, "friend@im.wechat", {
      peerId: "friend@im.wechat",
      source: "url",
      query: "https://x.com/cellinlab/status/2054424434736349433",
      candidateCount: 1,
      candidates: [
        {
          candidateId: "experience_weixin_url_stale_shell",
          title: "Web lesson: x.com",
          summary:
            '经验提炼：a&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[a]="0583100a-cd41-43dd-8d44-06ac3498f2e2")',
        },
      ],
      failureCount: 0,
      failures: [],
      sourceEvidenceRefs: [
        {
          id: "source-evidence-stale-shell",
          sourceKind: "url",
          sourceRef: "https://x.com/cellinlab/status/2054424434736349433",
          sourceSnapshotId: "artifact-stale-shell",
          sourceAccessStatus: "available",
          publishable: true,
        },
      ],
      memoryEvidenceRecords: [
        {
          id: "memory-evidence-stale-shell",
          sourceKind: "url",
          sourceRef: "https://x.com/cellinlab/status/2054424434736349433",
          sourceSnapshotId: "artifact-stale-shell",
          sourceAccessStatus: "available",
          confidence: "medium",
          publishable: false,
          evidenceRefs: ["source-evidence-stale-shell", "artifact-stale-shell"],
        },
      ],
      updatedAt: "2026-05-13T15:38:58.642Z",
    });
    const replies: string[] = [];
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url === "https://x.com/cellinlab/status/2054424434736349433") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async text() {
            return [
              "<html><head><title>x.com</title></head><body>",
              "Something went wrong, but don’t fret — let’s give it another shot.",
              "Some privacy related extensions may cause issues on x.com.",
              'a&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[a]="0583100a-cd41-43dd-8d44-06ac3498f2e2")',
              "</body></html>",
            ].join("");
          },
        };
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      throw new Error(`unexpected url ${url}`);
    };
    const apiProviderFetch: FetchLike = async () => {
      throw new Error("model should not be called for direct URL learning");
    };

    const result = await handleWeixinMessage(
      {
        home,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        apiProviderFetch,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-natural-url-learning-x-shell-repeat",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_002_000,
        item_list: [
          {
            type: 1,
            text_item: {
              text: "学习这个https://x.com/cellinlab/status/2054424434736349433",
            },
          },
        ],
      },
    );

    expect(result).toBe("sent");
    expect(calls.some((call) => call.url.endsWith("/v1/learning/url"))).toBe(false);
    expect(calls.some((call) => call.url.endsWith("/v1/learning/text"))).toBe(false);
    expect(replies.at(-1)).toContain("这次还没有学到可信正文");
    expect(replies.at(-1)).toContain("tool executor unavailable");
    expect(replies.at(-1)).not.toContain("这个链接我看过了");
    expect(replies.at(-1)).not.toContain("_sentryDebugIds");
  });

  it("inherits a naturally learned URL when Weixin asks the desktop browser to continue", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "director-weixin-browser-followup-workspace-"),
    );
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const browserRequests: unknown[] = [];
    const browserServer = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        browserRequests.push(JSON.parse(body));
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(
          `${JSON.stringify({
            success: true,
            url: "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
            title: "微信公众平台",
            snapshot: "环境异常 当前环境异常，完成验证后即可继续访问。",
          })}\n`,
        );
      });
    });
    browserServer.listen(0, "127.0.0.1");
    await once(browserServer, "listening");
    const address = browserServer.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("browser fixture did not start");
    }
    process.env.DIRECTOR_BROWSER_TOOL_URL = `http://127.0.0.1:${address.port}/tool`;
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      if (url.endsWith("/v1/learning/url")) {
        throw new Error("URL learning must not call the legacy Host URL endpoint");
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async () => {
      throw new Error("provider not configured");
    };

    try {
      const first = await handleWeixinMessage(
        {
          home,
          workspaceRoot,
          account,
          dmPolicy: "allowlist",
          allowedUsers: ["friend@im.wechat"],
          fetchFn,
          apiProviderFetch,
          director: {
            hostApiUrl: "http://127.0.0.1:3201",
            hostId: "personal-weixin",
            agentId: "director",
            channel: "personal-weixin",
            autoAdvance: true,
            autoStartRun: true,
            fetchFn,
          },
        },
        {
          message_id: "wx-natural-url-learning-before-browser-followup",
          from_user_id: "friend@im.wechat",
          create_time_ms: 1_713_000_000_000,
          item_list: [
            {
              type: 1,
              text_item: {
                text: "那你去学习这个呀，https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
              },
            },
          ],
        },
      );
      const second = await handleWeixinMessage(
        {
          home,
          workspaceRoot,
          account,
          dmPolicy: "allowlist",
          allowedUsers: ["friend@im.wechat"],
          fetchFn,
          apiProviderFetch,
          director: {
            hostApiUrl: "http://127.0.0.1:3201",
            hostId: "personal-weixin",
            agentId: "director",
            channel: "personal-weixin",
            autoAdvance: true,
            autoStartRun: true,
            fetchFn,
          },
        },
        {
          message_id: "wx-browser-followup-after-natural-url-learning",
          from_user_id: "friend@im.wechat",
          create_time_ms: 1_713_000_000_100,
          item_list: [
            {
              type: 1,
              text_item: {
                text: "那你可以在桌面上打开谷歌浏览器去看呀",
              },
            },
          ],
        },
      );

      expect(first).toBe("sent");
      expect(second).toBe("sent");
      expect(browserRequests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolName: "browser_navigate",
            args: {
              url: "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
              profile: "angel",
            },
          }),
          expect.objectContaining({
            toolName: "browser_snapshot",
            args: expect.objectContaining({ full: true }),
          }),
          expect.objectContaining({
            toolName: "browser_navigate",
            args: {
              url: "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
              profile: "user",
            },
          }),
          expect.objectContaining({
            toolName: "browser_snapshot",
            args: expect.objectContaining({ full: true }),
          }),
        ]),
      );
      expect(browserRequests).toHaveLength(4);
      expect(browserRequests.slice(2)).toEqual([
        expect.objectContaining({
          toolName: "browser_navigate",
          args: {
            url: "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
            profile: "user",
          },
        }),
        expect.objectContaining({
          toolName: "browser_snapshot",
          args: expect.objectContaining({ full: true }),
        }),
      ]);
      expect(replies.at(-1)).toContain("我已经读取当前浏览器页面");
      expect(replies.at(-1)).toContain("当前环境异常");
      expect(replies.at(-1)).not.toContain("模型不可用");
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        browserServer.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
    }
  });

  it("does not answer next-step followups from peer URL learning shadow cache", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-url-next-step-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    writeLegacyPeerLearningArtifact(home, account.normalizedAccountId, "friend@im.wechat", {
      peerId: "friend@im.wechat",
      source: "url",
      query: "https://x.com/cellinlab/status/2054424434736349433",
      candidateCount: 0,
      candidates: [],
      failureCount: 1,
      failures: [
        {
          sourceRef: "https://x.com/cellinlab/status/2054424434736349433",
          title: "https://x.com/cellinlab/status/2054424434736349433",
          reason: "login wall",
          detail: "只读到验证页或登录页。",
        },
      ],
      sourceEvidenceRefs: [
        {
          id: "source-evidence-x-blocked",
          sourceKind: "url",
          sourceRef: "https://x.com/cellinlab/status/2054424434736349433",
          sourceSnapshotId: "artifact-x-blocked",
          sourceAccessStatus: "source_access_limited",
          sourceAccessError: "访问受限，系统只读到验证页、登录页或网页按钮残渣。",
          publishable: false,
        },
      ],
      memoryEvidenceRecords: [
        {
          id: "memory-evidence-x-blocked",
          sourceKind: "url",
          sourceRef: "https://x.com/cellinlab/status/2054424434736349433",
          sourceSnapshotId: "artifact-x-blocked",
          sourceAccessStatus: "source_access_limited",
          sourceAccessError: "访问受限，系统只读到验证页、登录页或网页按钮残渣。",
          confidence: "low",
          publishable: false,
          evidenceRefs: ["source-evidence-x-blocked", "artifact-x-blocked"],
        },
      ],
      updatedAt: new Date().toISOString(),
    });
    appendPeerConversationTurn(home, account.normalizedAccountId, "friend@im.wechat", {
      role: "user",
      text: "学习这个https://x.com/cellinlab/status/2054424434736349433",
      createdAt: new Date().toISOString(),
    });
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      throw new Error(`unexpected url ${url}`);
    };
    const apiProviderFetch: FetchLike = async () =>
      jsonResponse({
        choices: [{ message: { content: "下一步要看你当前目标，不会直接沿用旧学习链接。" } }],
      });

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-url-learning-next-step-followup",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_200,
        item_list: [{ type: 1, text_item: { text: "下一步" } }],
      },
    );

    expect(result).toBe("sent");
    expect(replies.at(-1)).toContain("不会直接沿用旧学习链接");
    expect(replies.at(-1)).not.toContain("https://x.com/cellinlab/status/2054424434736349433");
    expect(replies.at(-1)).not.toContain("模型不可用");
  });

  it("opens a recently mentioned link through browser context without trusting peer shadow-cache content", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "director-weixin-browser-failed-followup-workspace-"),
    );
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    writeLegacyPeerLearningArtifact(home, account.normalizedAccountId, "friend@im.wechat", {
      peerId: "friend@im.wechat",
      source: "url",
      query: "https://x.com/cellinlab/status/2054424434736349433",
      candidateCount: 0,
      candidates: [],
      failureCount: 1,
      failures: [
        {
          sourceRef: "https://x.com/cellinlab/status/2054424434736349433",
          title: "https://x.com/cellinlab/status/2054424434736349433",
          reason: "login wall",
          detail: "只读到验证页或登录页。",
        },
      ],
      sourceEvidenceRefs: [
        {
          id: "source-evidence-x-blocked",
          sourceKind: "url",
          sourceRef: "https://x.com/cellinlab/status/2054424434736349433",
          sourceSnapshotId: "artifact-x-blocked",
          sourceAccessStatus: "source_access_limited",
          sourceAccessError: "访问受限，系统只读到验证页、登录页或网页按钮残渣。",
          publishable: false,
        },
      ],
      memoryEvidenceRecords: [],
      updatedAt: new Date().toISOString(),
    });
    appendPeerConversationTurn(home, account.normalizedAccountId, "friend@im.wechat", {
      role: "user",
      text: "学习这个https://x.com/cellinlab/status/2054424434736349433",
      createdAt: new Date().toISOString(),
    });
    const browserRequests: unknown[] = [];
    const browserServer = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        browserRequests.push(JSON.parse(body));
        response.writeHead(502, { "content-type": "application/json; charset=utf-8" });
        response.end(`${JSON.stringify({ success: false, error: "fetch failed" })}\n`);
      });
    });
    browserServer.listen(0, "127.0.0.1");
    await once(browserServer, "listening");
    const address = browserServer.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("browser fixture did not start");
    }
    process.env.DIRECTOR_BROWSER_TOOL_URL = `http://127.0.0.1:${address.port}/tool`;
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async () =>
      jsonResponse({
        choices: [{ message: { content: "请把要打开的链接重新发来，我不会从旧缓存接管。" } }],
      });

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
            hostApiUrl: "http://127.0.0.1:3201",
            hostId: "personal-weixin",
            agentId: "director",
            channel: "personal-weixin",
            autoAdvance: true,
            autoStartRun: true,
            fetchFn,
          },
        },
        {
          message_id: "wx-url-learning-browser-failed-followup",
          from_user_id: "friend@im.wechat",
          create_time_ms: 1_713_000_000_300,
          item_list: [
            {
              type: 1,
              text_item: {
                text: "你直接用谷歌浏览器打开这个链接不就可以了",
              },
            },
          ],
        },
      );

      expect(result).toBe("sent");
      expect(browserRequests).toEqual([
        expect.objectContaining({
          toolName: "browser_navigate",
          args: {
            url: "https://x.com/cellinlab/status/2054424434736349433",
            profile: "user",
          },
        }),
        expect.objectContaining({
          toolName: "browser_snapshot",
          args: expect.objectContaining({ full: true }),
        }),
      ]);
      expect(replies.at(-1)).not.toContain("https://x.com/cellinlab/status/2054424434736349433");
      expect(replies.at(-1)).not.toContain("browser");
      expect(replies.at(-1)).not.toContain("fetch failed");
      expect(replies.at(-1)).not.toContain("模型不可用");
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        browserServer.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
    }
  });

  it("does not open browser from peer URL learning shadow cache without recent URL context", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "director-weixin-browser-shadow-only-workspace-"),
    );
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    writeLegacyPeerLearningArtifact(home, account.normalizedAccountId, "friend@im.wechat", {
      peerId: "friend@im.wechat",
      source: "url",
      query: "https://x.com/cellinlab/status/2054424434736349433",
      candidateCount: 0,
      candidates: [],
      failureCount: 1,
      failures: [],
      sourceEvidenceRefs: [],
      memoryEvidenceRecords: [],
      updatedAt: new Date().toISOString(),
    });
    const browserRequests: unknown[] = [];
    const browserServer = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        browserRequests.push(JSON.parse(body));
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(`${JSON.stringify({ success: true })}\n`);
      });
    });
    browserServer.listen(0, "127.0.0.1");
    await once(browserServer, "listening");
    const address = browserServer.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("browser fixture did not start");
    }
    process.env.DIRECTOR_BROWSER_TOOL_URL = `http://127.0.0.1:${address.port}/tool`;
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async () =>
      jsonResponse({
        choices: [{ message: { content: "请把要打开的链接重新发来，我不会从旧缓存接管。" } }],
      });

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
            hostApiUrl: "http://127.0.0.1:3201",
            hostId: "personal-weixin",
            agentId: "director",
            channel: "personal-weixin",
            autoAdvance: true,
            autoStartRun: true,
            fetchFn,
          },
        },
        {
          message_id: "wx-url-learning-browser-shadow-only-followup",
          from_user_id: "friend@im.wechat",
          create_time_ms: 1_713_000_000_300,
          item_list: [
            {
              type: 1,
              text_item: {
                text: "你直接用谷歌浏览器打开这个链接不就可以了",
              },
            },
          ],
        },
      );

      expect(result).toBe("sent");
      expect(browserRequests).toEqual([]);
      expect(replies.at(-1)).toContain("不会从旧缓存接管");
      expect(replies.at(-1)).not.toContain("https://x.com/cellinlab/status/2054424434736349433");
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        browserServer.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
    }
  });

  it("does not let stale URL learning artifacts hijack generic next-step chat", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "director-weixin-url-next-step-stale-workspace-"),
    );
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    writeLegacyPeerLearningArtifact(home, account.normalizedAccountId, "friend@im.wechat", {
      peerId: "friend@im.wechat",
      source: "url",
      query: "https://x.com/cellinlab/status/2054424434736349433",
      candidateCount: 0,
      candidates: [],
      failureCount: 1,
      failures: [
        {
          sourceRef: "https://x.com/cellinlab/status/2054424434736349433",
          title: "https://x.com/cellinlab/status/2054424434736349433",
          reason: "login wall",
          detail: "只读到验证页或登录页。",
        },
      ],
      updatedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
    });
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async () =>
      jsonResponse({
        choices: [{ message: { content: "我会按当前上下文继续，不会拉回旧链接。" } }],
      });

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-url-learning-next-step-stale-artifact",
        from_user_id: "friend@im.wechat",
        create_time_ms: Date.now(),
        item_list: [{ type: 1, text_item: { text: "下一步" } }],
      },
    );

    expect(result).toBe("sent");
    expect(replies.at(-1)).toContain("不会拉回旧链接");
    expect(replies.at(-1)).not.toContain("这次还没有学到可信正文");
    expect(replies.at(-1)).not.toContain("https://x.com/cellinlab/status/2054424434736349433");
  });

  it("does not continue a URL artifact when recent chat is unrelated", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "director-weixin-url-next-step-unrelated-workspace-"),
    );
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    writeLegacyPeerLearningArtifact(home, account.normalizedAccountId, "friend@im.wechat", {
      peerId: "friend@im.wechat",
      source: "url",
      query: "https://x.com/cellinlab/status/2054424434736349433",
      candidateCount: 0,
      candidates: [],
      failureCount: 1,
      failures: [
        {
          sourceRef: "https://x.com/cellinlab/status/2054424434736349433",
          title: "https://x.com/cellinlab/status/2054424434736349433",
          reason: "login wall",
          detail: "只读到验证页或登录页。",
        },
      ],
      updatedAt: new Date().toISOString(),
    });
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async () =>
      jsonResponse({
        choices: [{ message: { content: "这次我按普通对话继续，不会回到旧链接。" } }],
      });

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-url-learning-next-step-unrelated-recent-chat",
        from_user_id: "friend@im.wechat",
        create_time_ms: Date.now(),
        item_list: [{ type: 1, text_item: { text: "下一步" } }],
      },
    );

    expect(result).toBe("sent");
    expect(replies.at(-1)).toContain("普通对话继续");
    expect(replies.at(-1)).not.toContain("这次还没有学到可信正文");
    expect(replies.at(-1)).not.toContain("https://x.com/cellinlab/status/2054424434736349433");
  });

  it("lets the model call the learning query tool during ordinary Weixin chat", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-tool-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/learning/query")) {
        return jsonResponse(
          {
            result: { candidateCount: 1 },
            candidates: [{ candidateId: "exp-tool-1", title: "Seedance 2.0 最新玩法" }],
          },
          201,
        );
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ url, body });
      providerTurn += 1;
      if (providerTurn === 1) {
        expect(toolNamesFromRequestBody(body)).toEqual(
          expect.arrayContaining([
            "director.capabilities.inspect",
            "web_search",
            "web_extract",
            "director.learning.query",
            "director.learning.admit",
            "director.comfyui.create_workflow",
            "director.skills.list",
            "director.skills.view",
          ]),
        );
        return jsonResponse({
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
        });
      }
      expect(body.messages).toEqual(
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
            tool_call_id: "call-learning-1",
            content: expect.stringContaining("Seedance 2.0 最新玩法"),
          }),
        ]),
      );
      expect(JSON.stringify(body.messages)).not.toContain("status:");
      expect(JSON.stringify(body.messages)).not.toContain("learning_result:");
      expect(JSON.stringify(body.messages)).not.toContain("next_actions:");
      return jsonResponse({
        choices: [
          {
            message: {
              content:
                "我已经搜了一轮，找到 1 条待审候选：Seedance 2.0 最新玩法。你可以直接说“收录”或“看详情”。",
            },
          },
        ],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-model-tool-learning-query",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [
          {
            type: 1,
            text_item: {
              text: "你现在去微信公众号看一下有没有 seedance2.0 最新的玩法，学习下来",
            },
          },
        ],
      },
    );

    expect(result).toBe("sent");
    expect(providerCalls).toHaveLength(2);
    expect(hostCalls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/learning/query",
      "/ilink/bot/sendmessage",
    ]);
    expect(hostCalls[0]?.body).toContain("seedance2.0 最新玩法");
    expect(replies.at(-1)).toContain("Seedance 2.0 最新玩法");
    expect(replies.at(-1)).not.toContain("/经验");
    expect(replies.at(-1)).not.toContain("无法直接访问");
    expect(replies.at(-1)).not.toContain("蓝图：");
  });

  it("blocks low-quality model-requested learning admit sources before they reach Host API", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-admit-quality-gate-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/learning/admit")) {
        throw new Error("low-quality source must not reach Host API learning admit");
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerTurn += 1;
      if (providerTurn === 1) {
        expect(toolNamesFromRequestBody(body)).toContain("director.learning.admit");
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-low-quality-admit",
                    type: "function",
                    function: {
                      name: "director.learning.admit",
                      arguments: JSON.stringify({
                        source_id: "weixin-low-quality-admit",
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
                      }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      const toolMessage = toolMessageFromRequestBody(body, "call-low-quality-admit");
      expect(toolMessage?.content).toContain("没有准入学习");
      expect(toolMessage?.content).toContain("可信正文");
      return jsonResponse({
        choices: [
          {
            message: {
              content:
                "这个链接没读到可信正文，不能当成学到了。我会换浏览器读取或让你发可公开访问的来源。",
            },
          },
        ],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-low-quality-admit",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [{ type: 1, text_item: { text: "把这个网页学成经验" } }],
      },
    );

    expect(result).toBe("sent");
    expect(hostCalls.map((call) => new URL(call.url).pathname)).not.toContain("/v1/learning/admit");
    expect(replies.at(-1)).toContain("没读到可信正文");
    expect(replies.at(-1)).not.toContain("已学会");
  });

  it("preflights Weixin public-account article searches through Sogou Weixin tools", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-sogou-source-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const searchFetchCalls: string[] = [];
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (String(url).includes("https://weixin.sogou.com/weixin")) {
        searchFetchCalls.push(String(url));
        return {
          ok: true,
          status: 200,
          url: String(url),
          async text() {
            return sogouWeixinSearchHtmlFixture();
          },
        };
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ url, body });
      if (Array.isArray(body.tools) && body.tools.length === 0) {
        expect(JSON.stringify(body.messages)).toContain("工具观察");
        expect(JSON.stringify(body.messages)).toContain("Seedance 2.0 公众号实操教程");
        return jsonResponse({
          choices: [
            {
              message: {
                content:
                  "我已通过搜狗微信公众号文章搜索查到 Seedance 2.0 公众号实操教程：https://mp.weixin.qq.com/s/weixin-seedance-source。摘要显示它来自微信公众号的 Seedance 2.0 教程。",
              },
            },
          ],
        });
      }
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
              content: "很抱歉，我没有在搜狗微信公众号中找到相关内容。",
            },
          },
        ],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-sogou-weixin-source-search",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [
          {
            type: 1,
            text_item: {
              text: "去微信公众号搜索相关seedance2.0的教程",
            },
          },
        ],
      },
    );

    expect(result).toBe("sent");
    expect(searchFetchCalls[0]).toContain("https://weixin.sogou.com/weixin");
    expect(searchFetchCalls[0]).toContain("query=seedance2.0");
    expect(providerCalls).toHaveLength(2);
    expect(hostCalls.map((call) => new URL(call.url).pathname)).toEqual(
      expect.arrayContaining(["/weixin", "/ilink/bot/sendmessage"]),
    );
    expect(replies.at(-1)).toContain("取证来源：搜狗微信公众号文章搜索");
    expect(replies.at(-1)).toContain("Seedance 2.0 公众号实操教程");
    expect(replies.at(-1)).toContain("https://mp.weixin.qq.com/s/weixin-seedance-source");
    expect(replies.at(-1)).not.toContain("没有在搜狗微信公众号中找到");
    expect(replies.at(-1)).not.toContain("蓝图：");
  });

  it("routes required Weixin public-account grounding through Host API tools/invoke when enabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-host-required-sogou-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.includes("/v1/tools/effective")) {
        return jsonResponse({
          schemaVersion: "director.external-tools.effective.v1",
          agentId: "director",
          profile: "weixin",
          effectiveCount: 2,
          unavailableCount: 0,
          groups: [],
          tools: [
            {
              id: "web",
              canInvoke: true,
              metadata: { modelToolNames: ["web_search", "web_extract"] },
              capabilities: [],
            },
          ],
        });
      }
      if (url.endsWith("/v1/tools/invoke")) {
        return jsonResponse({
          schemaVersion: "director.external-tools.invoke.v1",
          ok: true,
          toolName: "web_search",
          toolId: "web_search",
          operationId: "web.search",
          status: "success",
          content:
            'status: success\nsummary: Found 1 source candidate(s) for "seedance2.0 教程" via sogou-weixin.\nquery: seedance2.0 教程\nprovider: sogou-weixin\nsource_type: weixin_article\nresult_count: 1\nresult_1: Seedance 2.0 公众号实操教程 | url=https://mp.weixin.qq.com/s/host-required | source=sogou-weixin',
          output: {
            status: "success",
            provider: "sogou-weixin",
            source_type: "weixin_article",
            query: "seedance2.0 教程",
            results: [
              {
                title: "Seedance 2.0 公众号实操教程",
                url: "https://mp.weixin.qq.com/s/host-required",
                source: "sogou-weixin",
              },
            ],
          },
          trace: [],
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ url, body });
      expect(JSON.stringify(body.messages)).toContain("required-web-search-sogou-weixin");
      expect(JSON.stringify(body.messages)).toContain("provider: sogou-weixin");
      return jsonResponse({
        choices: [
          {
            message: {
              content:
                "我已通过搜狗微信公众号文章搜索查到 Seedance 2.0 公众号实操教程：https://mp.weixin.qq.com/s/host-required。",
            },
          },
        ],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-host-required-sogou-weixin-source-search",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [
          {
            type: 1,
            text_item: {
              text: "去微信公众号搜索相关seedance2.0的教程",
            },
          },
        ],
      },
    );

    expect(result).toBe("sent");
    expect(providerCalls).toHaveLength(1);
    expect(
      hostCalls
        .filter((call) => call.url.startsWith("http://127.0.0.1:3201/"))
        .map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`),
    ).toEqual(["GET:/v1/tools/effective", "POST:/v1/tools/invoke"]);
    expect(hostCalls[1]?.body).toContain('"toolId":"web_search"');
    expect(hostCalls[1]?.body).toContain('"provider":"sogou-weixin"');
    expect(replies.at(-1)).toContain("mp.weixin.qq.com/s/host-required");
  });

  it("forwards browser tool calls from Weixin to the shared desktop browser provider", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-browser-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const browserRequests: unknown[] = [];
    const browserServer = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        browserRequests.push(JSON.parse(body));
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(
          `${JSON.stringify({
            success: true,
            url: "https://example.test/browser",
            title: "Example Browser",
            snapshot: "[@e1] heading Example Browser",
            element_count: 1,
            metadata: { provider: "desktop-browser" },
          })}\n`,
        );
      });
    });
    browserServer.listen(0, "127.0.0.1");
    await once(browserServer, "listening");
    const address = browserServer.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("browser fixture did not start");
    }
    process.env.DIRECTOR_BROWSER_TOOL_URL = `http://127.0.0.1:${address.port}/tool`;

    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ url, body });
      providerTurn += 1;
      if (providerTurn === 1) {
        expect(toolNamesFromRequestBody(body)).toEqual(
          expect.arrayContaining(["browser_navigate", "browser_snapshot"]),
        );
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-browser-open",
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
      expect(body.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "tool",
            tool_call_id: "call-browser-open",
            content: expect.stringContaining("Navigated to https://example.test/browser"),
          }),
        ]),
      );
      return jsonResponse({
        choices: [
          {
            message: {
              content: "浏览器已打开：Example Browser。",
            },
          },
        ],
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
          fetchFn,
          apiProviderFetch,
          director: {
            hostApiUrl: "http://127.0.0.1:3201",
            hostId: "personal-weixin",
            agentId: "director",
            channel: "personal-weixin",
            autoAdvance: true,
            autoStartRun: true,
            fetchFn,
          },
        },
        {
          message_id: "wx-model-tool-browser-open",
          from_user_id: "friend@im.wechat",
          create_time_ms: 1_713_000_000_000,
          item_list: [{ type: 1, text_item: { text: "打开浏览器看看 example.test" } }],
        },
      );

      expect(result).toBe("sent");
      expect(providerCalls).toHaveLength(2);
      expect(browserRequests).toEqual([
        {
          toolName: "browser_navigate",
          turnId: "weixin-tool-wx-model-tool-browser-open-call-browser-open",
          sessionKey: "friend@im.wechat",
          args: { url: "https://example.test/browser" },
        },
      ]);
      expect(hostCalls.map((call) => new URL(call.url).pathname)).toEqual([
        "/ilink/bot/sendmessage",
      ]);
      expect(replies.at(-1)).toContain("浏览器已打开");
      expect(replies.at(-1)).not.toContain("provider unavailable");
      expect(replies.at(-1)).not.toContain("无法在当前运行环境中直接打开浏览器");
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        browserServer.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
    }
  });

  it("discovers the shared desktop browser provider from gateway service config", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-browser-config-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const browserRequests: unknown[] = [];
    const browserServer = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        browserRequests.push(JSON.parse(body));
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(
          `${JSON.stringify({
            success: true,
            url: "https://example.test/config-browser",
            title: "Config Browser",
            snapshot: "Config browser snapshot",
          })}\n`,
        );
      });
    });
    browserServer.listen(0, "127.0.0.1");
    await once(browserServer, "listening");
    const address = browserServer.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("browser fixture did not start");
    }
    const serviceDir = join(workspaceRoot, ".director-angel", "runtime", "gateway-service");
    mkdirSync(serviceDir, { recursive: true });
    writeFileSync(
      join(serviceDir, "weixin-gateway.json"),
      `${JSON.stringify({
        schemaVersion: "director.weixin-gateway.service.v1",
        enabled: true,
        workspaceRoot,
        browserToolUrl: `http://127.0.0.1:${address.port}/tool`,
      })}\n`,
      "utf8",
    );

    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const hasRequiredBrowserResult = body.messages?.some(
        (message: { role?: string; tool_call_id?: string }) =>
          message.role === "tool" &&
          String(message.tool_call_id ?? "").startsWith("required-browser-"),
      );
      if (hasRequiredBrowserResult) {
        return jsonResponse({
          choices: [{ message: { content: "浏览器已打开：Config Browser。" } }],
        });
      }
      providerTurn += 1;
      if (providerTurn === 1) {
        expect(toolNamesFromRequestBody(body)).toContain("browser_navigate");
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-browser-open",
                    type: "function",
                    function: {
                      name: "browser_navigate",
                      arguments: JSON.stringify({ url: "https://example.test/config-browser" }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      return jsonResponse({
        choices: [{ message: { content: "浏览器已打开：Config Browser。" } }],
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
          fetchFn,
          apiProviderFetch,
          director: {
            hostApiUrl: "http://127.0.0.1:3201",
            hostId: "personal-weixin",
            agentId: "director",
            channel: "personal-weixin",
            autoAdvance: true,
            autoStartRun: true,
            fetchFn,
          },
        },
        {
          message_id: "wx-model-tool-browser-config",
          from_user_id: "friend@im.wechat",
          create_time_ms: 1_713_000_000_000,
          item_list: [
            {
              type: 1,
              text_item: { text: "用浏览器打开 https://example.test/config-browser 看一下" },
            },
          ],
        },
      );

      expect(result).toBe("sent");
      expect(browserRequests).toEqual([
        expect.objectContaining({
          toolName: "browser_navigate",
          args: { url: "https://example.test/config-browser" },
        }),
        expect.objectContaining({
          toolName: "browser_snapshot",
          args: { full: true },
        }),
      ]);
      expect(replies.at(-1)).toContain("浏览器已打开");
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        browserServer.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
    }
  });

  it("routes Weixin browser tool calls through Host API tools/effective and tools/invoke when enabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-host-browser-tools-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.includes("/v1/tools/effective")) {
        return jsonResponse({
          schemaVersion: "director.external-tools.effective.v1",
          agentId: "director",
          profile: "weixin",
          effectiveCount: 3,
          unavailableCount: 0,
          groups: [],
          tools: [
            {
              id: "web",
              canInvoke: true,
              metadata: { modelToolNames: ["web_search", "web_extract"] },
              capabilities: [],
            },
            {
              id: "browser_navigate",
              canInvoke: true,
              metadata: { modelToolName: "browser_navigate" },
              capabilities: [],
            },
            {
              id: "browser_snapshot",
              canInvoke: true,
              metadata: { modelToolName: "browser_snapshot" },
              capabilities: [],
            },
          ],
        });
      }
      if (url.endsWith("/v1/tools/invoke")) {
        return jsonResponse({
          schemaVersion: "director.external-tools.invoke.v1",
          ok: true,
          toolName: "browser_navigate",
          toolId: "browser_navigate",
          operationId: "browser.navigate",
          status: "success",
          content:
            "status: success\nsummary: Navigated to https://example.test/browser.\nsnapshot_preview:\n[@e1] heading Host Browser",
          output: {
            status: "success",
            title: "Host Browser",
            url: "https://example.test/browser",
          },
          metadata: {
            agentOsSandboxBackendAdmission: {
              ok: true,
              status: "admitted",
              backend: "network-limited",
              providerId: "agent-os-sandbox.local.network-limited",
            },
          },
          trace: [],
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ body });
      const hasRequiredExtractResult = body.messages?.some(
        (message: { role?: string; tool_call_id?: string }) =>
          message.role === "tool" && message.tool_call_id === "required-web-extract-explicit-url",
      );
      if (hasRequiredExtractResult) {
        return jsonResponse({
          choices: [{ message: { content: "已通过桌面 Host API 抽取到网页内容。" } }],
        });
      }
      providerTurn += 1;
      if (providerTurn === 1) {
        expect(toolNamesFromRequestBody(body)).toEqual(
          expect.arrayContaining(["browser_navigate", "browser_snapshot"]),
        );
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-host-browser-open",
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
      const toolMessage = toolMessageFromRequestBody(body, "call-host-browser-open");
      expect(toolMessage?.content).toContain("Host Browser");
      return jsonResponse({
        choices: [{ message: { content: "浏览器已通过桌面共享工具打开：Host Browser。" } }],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-host-model-tool-browser-open",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [{ type: 1, text_item: { text: "打开浏览器看看 example.test" } }],
      },
    );

    expect(result).toBe("sent");
    expect(providerCalls.length).toBeGreaterThanOrEqual(1);
    expect(
      hostCalls
        .filter((call) => call.url.startsWith("http://127.0.0.1:3201/"))
        .map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`),
    ).toEqual(expect.arrayContaining(["GET:/v1/tools/effective", "POST:/v1/tools/invoke"]));
    const browserInvoke = hostCalls.find((call) =>
      call.body?.includes('"toolId":"browser_navigate"'),
    );
    expect(browserInvoke?.body).toContain(`"cwd":"${workspaceRoot}"`);
    expect(browserInvoke?.body).toContain('"defaultMutatingSandboxMode":"network-limited"');
    expect(browserInvoke?.body).toContain('"filesystemScope"');
    expect(browserInvoke?.body).toContain(`"${workspaceRoot}"`);
    expect(browserInvoke?.body).toContain('"requestedNetworkPolicy":"limited"');
    expect(browserInvoke?.body).toContain('"approval":{"status":"approved"');
    expect(replies.at(-1)).toContain("Host Browser");
  });

  it("routes Weixin web tool calls through Host API tools/effective and tools/invoke when enabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-host-web-tools-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.includes("/v1/tools/effective")) {
        return jsonResponse({
          schemaVersion: "director.external-tools.effective.v1",
          agentId: "director",
          profile: "weixin",
          effectiveCount: 2,
          unavailableCount: 0,
          groups: [],
          tools: [
            {
              id: "web",
              canInvoke: true,
              metadata: { modelToolNames: ["web_search", "web_extract"] },
              capabilities: [],
            },
          ],
        });
      }
      if (url.endsWith("/v1/tools/invoke")) {
        return jsonResponse({
          schemaVersion: "director.external-tools.invoke.v1",
          ok: true,
          toolName: "web_search",
          toolId: "web_search",
          operationId: "web.search",
          status: "success",
          content:
            'status: success\nsummary: Found 1 source candidate(s) for "Director Angel Web Tool Bus" via duckduckgo.\nprovider: duckduckgo\nsource_type: web\nresult_count: 1\nresult_1: Director Angel Web Tool Bus | url=https://example.test/web-tool | source=duckduckgo',
          output: {
            status: "success",
            provider: "duckduckgo",
            source_type: "web",
            results: [
              { title: "Director Angel Web Tool Bus", url: "https://example.test/web-tool" },
            ],
          },
          trace: [],
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ body });
      providerTurn += 1;
      if (providerTurn === 1) {
        expect(toolNamesFromRequestBody(body)).toEqual(
          expect.arrayContaining(["web_search", "web_extract"]),
        );
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-host-web-search",
                    type: "function",
                    function: {
                      name: "web_search",
                      arguments: JSON.stringify({
                        query: "Director Angel Web Tool Bus",
                        provider: "duckduckgo",
                        source_type: "web",
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
      const toolMessage = toolMessageFromRequestBody(body, "call-host-web-search");
      expect(toolMessage?.content).toContain("duckduckgo");
      return jsonResponse({
        choices: [{ message: { content: "已通过桌面 Host API 搜索到网页结果。" } }],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-host-model-tool-web-search",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [{ type: 1, text_item: { text: "搜索 Director Angel Web Tool Bus" } }],
      },
    );

    expect(result).toBe("sent");
    expect(providerCalls.length).toBeGreaterThanOrEqual(2);
    expect(
      hostCalls
        .filter((call) => call.url.startsWith("http://127.0.0.1:3201/"))
        .map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`),
    ).toEqual(["GET:/v1/tools/effective", "POST:/v1/tools/invoke"]);
    expect(hostCalls[1]?.body).toContain('"toolId":"web_search"');
    expect(hostCalls[1]?.body).toContain('"provider":"duckduckgo"');
    expect(replies.at(-1)).toContain("Host API");
  });

  it("routes Weixin web_extract tool calls through Host API tools/invoke when enabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-host-web-extract-tools-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.includes("/v1/tools/effective")) {
        return jsonResponse({
          schemaVersion: "director.external-tools.effective.v1",
          agentId: "director",
          profile: "weixin",
          effectiveCount: 2,
          unavailableCount: 0,
          groups: [],
          tools: [
            {
              id: "web",
              canInvoke: true,
              metadata: { modelToolNames: ["web_search", "web_extract"] },
              capabilities: [],
            },
          ],
        });
      }
      if (url.endsWith("/v1/tools/invoke")) {
        return jsonResponse({
          schemaVersion: "director.external-tools.invoke.v1",
          ok: true,
          toolName: "web_extract",
          toolId: "web_extract",
          operationId: "web.extract",
          status: "success",
          content:
            "status: success\nsummary: Extracted 42 preview character(s) from https://example.test/extract.\nurl: https://example.test/extract\ntitle: Director Angel Extract\ntext_preview: Shared extraction content",
          output: {
            status: "success",
            title: "Director Angel Extract",
            url: "https://example.test/extract",
            text_preview: "Shared extraction content",
          },
          trace: [],
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ body });
      providerTurn += 1;
      if (providerTurn === 1) {
        expect(toolNamesFromRequestBody(body)).toEqual(
          expect.arrayContaining(["web_search", "web_extract"]),
        );
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-host-web-extract",
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
      const toolMessage = toolMessageFromRequestBody(body, "call-host-web-extract");
      expect(toolMessage?.content).toContain("Shared extraction content");
      return jsonResponse({
        choices: [{ message: { content: "已通过桌面 Host API 抽取到网页内容。" } }],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-host-model-tool-web-extract",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [{ type: 1, text_item: { text: "读取 https://example.test/extract 的内容" } }],
      },
    );

    expect(result).toBe("sent");
    expect(providerCalls.length).toBeGreaterThanOrEqual(1);
    expect(
      hostCalls
        .filter((call) => call.url.startsWith("http://127.0.0.1:3201/"))
        .map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`),
    ).toEqual(expect.arrayContaining(["GET:/v1/tools/effective", "POST:/v1/tools/invoke"]));
    const extractInvoke = hostCalls.find((call) => call.body?.includes('"toolId":"web_extract"'));
    expect(extractInvoke?.body).toContain("https://example.test/extract");
    expect(replies.at(-1)).toContain("我已读取");
    expect(replies.at(-1)).toContain("Shared extraction content");
    expect(replies.at(-1)).toContain("https://example.test/extract");
  });

  it("routes Weixin OpenCLI model tools through Host API tools/effective and tools/invoke when enabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-host-opencli-tools-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.includes("/v1/tools/effective")) {
        return jsonResponse({
          schemaVersion: "director.external-tools.effective.v1",
          agentId: "director",
          profile: "weixin",
          effectiveCount: 1,
          unavailableCount: 0,
          groups: [],
          tools: [
            {
              id: "opencli.local",
              providerId: "opencli",
              canInvoke: true,
              metadata: {
                modelToolNames: ["director.opencli.list", "director.opencli.invoke"],
              },
              capabilities: [
                {
                  id: "opencli.list",
                  metadata: { modelToolName: "director.opencli.list" },
                },
                {
                  id: "opencli.hackernews.top",
                  metadata: {
                    modelToolName: "director.opencli.invoke",
                    access: "read",
                  },
                },
              ],
            },
          ],
        });
      }
      if (url.endsWith("/v1/tools/invoke")) {
        return jsonResponse({
          schemaVersion: "director.external-tools.invoke.v1",
          ok: true,
          toolName: "opencli.local",
          toolId: "opencli.local",
          operationId: "opencli.hackernews.top",
          status: "success",
          content: "OpenCLI 执行完成：hackernews/top\n结果预览：1. Host OpenCLI story",
          output: { json: [{ title: "Host OpenCLI story" }] },
          metadata: {
            sourceKind: "opencli",
            sourceRef: "opencli:hackernews/top",
            sourceAccessStatus: "available",
          },
          trace: [],
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ body });
      providerTurn += 1;
      if (providerTurn === 1) {
        expect(toolNamesFromRequestBody(body)).toEqual(
          expect.arrayContaining(["director.opencli.list", "director.opencli.invoke"]),
        );
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-host-opencli-hn-top",
                    type: "function",
                    function: {
                      name: "director.opencli.invoke",
                      arguments: JSON.stringify({
                        operationId: "opencli.hackernews.top",
                        args: { limit: 1 },
                        reason: "用户要求用 OpenCLI 读取热榜。",
                      }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      const toolMessage = toolMessageFromRequestBody(body, "call-host-opencli-hn-top");
      expect(toolMessage?.content).toContain("OpenCLI 执行完成");
      expect(toolMessage?.content).toContain("Host OpenCLI story");
      return jsonResponse({
        choices: [{ message: { content: "我用 OpenCLI 读到了：Host OpenCLI story。" } }],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-host-model-tool-opencli",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [{ type: 1, text_item: { text: "用 OpenCLI 查一下 HackerNews 热榜" } }],
      },
    );

    expect(result).toBe("sent");
    expect(providerCalls.length).toBeGreaterThanOrEqual(1);
    expect(
      hostCalls
        .filter((call) => call.url.startsWith("http://127.0.0.1:3201/"))
        .map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`),
    ).toEqual(["GET:/v1/tools/effective", "POST:/v1/tools/invoke"]);
    const openCliInvoke = hostCalls.find((call) => call.body?.includes('"toolId":"opencli.local"'));
    expect(openCliInvoke?.body).toContain('"operationId":"opencli.hackernews.top"');
    expect(openCliInvoke?.body).toContain('"sessionKey":"weixin:bot-im.bot:friend@im.wechat"');
    expect(openCliInvoke?.body).toContain('"source":"weixin-host-tool-control-plane"');
    expect(replies.at(-1)).toContain("Host OpenCLI story");
  });

  it("persists local Weixin web_extract long bodies and exposes a ref-backed read tool", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-local-web-artifact-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-local-web-home-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const bodyTail = "微信完整正文尾部：这句只能在 artifact 或回读结果里。";
    const longBody = `微信长正文开头。${"网页读取、证据留存、多端统一。".repeat(180)}${bodyTail}`;
    const replies: string[] = [];
    const webFetchCalls: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      if (String(url) === "https://example.com/weixin-long") {
        webFetchCalls.push(String(url));
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          url: String(url),
          headers: { get: () => "text/html; charset=utf-8" },
          async text() {
            return `
              <html>
                <head><title>Weixin Artifact Extract</title></head>
                <body><article>${longBody}</article></body>
              </html>
            `;
          },
        };
      }
      if (String(url).endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerTurn += 1;
      if (providerTurn === 1) {
        expect(toolNamesFromRequestBody(body)).toEqual(
          expect.arrayContaining(["web_extract", "web_extract_artifact_read"]),
        );
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-weixin-local-web-extract",
                    type: "function",
                    function: {
                      name: "web_extract",
                      arguments: JSON.stringify({
                        url: "https://example.com/weixin-long",
                        max_bytes: 100000,
                      }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      const toolMessage = toolMessageFromRequestBody(body, "call-weixin-local-web-extract");
      expect(toolMessage?.content).toContain(
        "full_body_ref: web-extract-full-body-https-example-com-weixin-long",
      );
      expect(toolMessage?.content).not.toContain(bodyTail);
      return jsonResponse({
        choices: [{ message: { content: "已读取，完整正文已经留好引用。" } }],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-local-web-extract-artifact",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [
          {
            type: 1,
            text_item: { text: "请读取 https://example.com/weixin-long 里的长文内容" },
          },
        ],
      },
    );

    expect(result).toBe("sent");
    expect(webFetchCalls).toContain("https://example.com/weixin-long");
    const artifactPath = join(
      workspaceRoot,
      ".hotflow",
      "conversation-runtime",
      "web-extract-artifacts",
      "web-extract-full-body-https-example-com-weixin-long.json",
    );
    expect(existsSync(artifactPath)).toBe(true);
    expect(JSON.parse(readFileSync(artifactPath, "utf8")).body).toContain(bodyTail);
    const toolEvidenceIndexPath = join(
      workspaceRoot,
      ".hotflow",
      "conversation-runtime",
      "tool-evidence",
      "index.json",
    );
    expect(existsSync(toolEvidenceIndexPath)).toBe(true);
    const toolEvidenceIndex = JSON.parse(readFileSync(toolEvidenceIndexPath, "utf8")) as {
      entries: Array<{ toolCallId?: string; toolName?: string; sessionKey?: string }>;
    };
    expect(toolEvidenceIndex.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: "call-weixin-local-web-extract",
          toolName: "web_extract",
          sessionKey: "weixin:bot-im.bot:friend@im.wechat",
        }),
      ]),
    );
    expect(replies.at(-1)).toContain("已读取");
  });

  it("routes Weixin X/Twitter tool calls through Host API tools/effective and tools/invoke when enabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-host-x-tools-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.includes("/v1/tools/effective")) {
        return jsonResponse({
          schemaVersion: "director.external-tools.effective.v1",
          agentId: "director",
          profile: "weixin",
          effectiveCount: 1,
          unavailableCount: 0,
          groups: [],
          tools: [
            {
              id: "x_search",
              canInvoke: true,
              metadata: { modelToolName: "x_search" },
              capabilities: [],
            },
          ],
        });
      }
      if (url.endsWith("/v1/tools/invoke")) {
        return jsonResponse({
          schemaVersion: "director.external-tools.invoke.v1",
          ok: true,
          toolName: "x_search",
          toolId: "x_search",
          operationId: "x.search",
          status: "success",
          content:
            'status: success\nsummary: Found 1 X/Twitter candidate(s) for "Director Angel social thread".\nprovider: x-twitter\nresult_count: 1\nresult_1: Creator · 2026-05-07 | url=https://x.com/creator/status/123 | source=x-twitter',
          output: {
            status: "success",
            provider: "x-twitter",
            results: [{ title: "Creator · 2026-05-07", url: "https://x.com/creator/status/123" }],
          },
          trace: [],
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ body });
      providerTurn += 1;
      if (providerTurn === 1) {
        expect(toolNamesFromRequestBody(body)).toEqual(expect.arrayContaining(["x_search"]));
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-host-x-search",
                    type: "function",
                    function: {
                      name: "x_search",
                      arguments: JSON.stringify({
                        query: "Director Angel social thread",
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
      const toolMessage = toolMessageFromRequestBody(body, "call-host-x-search");
      expect(toolMessage?.content).toContain("x-twitter");
      return jsonResponse({
        choices: [{ message: { content: "已通过桌面 Host API 搜索到 X/Twitter 结果。" } }],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-host-model-tool-x-search",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [{ type: 1, text_item: { text: "搜索 Director Angel social thread" } }],
      },
    );

    expect(result).toBe("sent");
    expect(providerCalls).toHaveLength(2);
    expect(
      hostCalls
        .filter((call) => call.url.startsWith("http://127.0.0.1:3201/"))
        .map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`),
    ).toEqual(["GET:/v1/tools/effective", "POST:/v1/tools/invoke"]);
    expect(hostCalls[1]?.body).toContain('"toolId":"x_search"');
    expect(replies.at(-1)).toContain("X/Twitter");
  });

  it("hides browser action tools from Weixin model turns until the shared desktop browser endpoint is configured", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-browser-hidden-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const providerCalls: Array<{ body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ body });
      return jsonResponse({
        choices: [{ message: { content: "浏览器共享端点还没有配置，需要先连接桌面端。" } }],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-model-tool-browser-hidden",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [{ type: 1, text_item: { text: "打开浏览器看看 example.test" } }],
      },
    );

    expect(result).toBe("sent");
    expect(providerCalls).toHaveLength(1);
    const toolNames = toolNamesFromRequestBody(providerCalls[0]?.body);
    expect(toolNames).toEqual(expect.arrayContaining(["web_search", "web_extract"]));
    expect(toolNames).not.toContain("browser_navigate");
    expect(toolNames).not.toContain("browser_snapshot");
    expect(toolNames).not.toContain("browser_click");
    expect(replies.at(-1)).toContain("浏览器共享端点还没有配置");
  });

  it("keeps stale Host API learning inventory out of the Weixin tool observation", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-tool-stale-learning-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/learning/query")) {
        return jsonResponse(
          {
            result: {
              candidateCount: 1,
              candidateIds: ["experience_current_learning"],
            },
            candidates: [
              {
                candidateId: "experience_old_inventory",
                title: "旧库存：不该出现在本轮",
                summary: "这是旧经验库里的候选，不是这次微信学习结果。",
              },
              {
                candidateId: "experience_current_learning",
                title: "本轮：Seedance 2.0 新玩法",
                summary: "这是本次搜索抓取后生成的待审候选。",
              },
            ],
          },
          201,
        );
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ url: _url, body });
      providerTurn += 1;
      if (providerTurn === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-learning-stale-filter",
                    type: "function",
                    function: {
                      name: "director.learning.query",
                      arguments: JSON.stringify({ query: "seedance2.0 新玩法" }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      const toolMessage = toolMessageFromRequestBody(body, "call-learning-stale-filter");
      expect(toolMessage?.content).toContain("本轮：Seedance 2.0 新玩法");
      expect(toolMessage?.content).not.toContain("旧库存");
      return jsonResponse({
        choices: [
          {
            message: {
              content: "本轮只生成 1 条待审候选：本轮：Seedance 2.0 新玩法。",
            },
          },
        ],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-model-tool-learning-stale-filter",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [
          {
            type: 1,
            text_item: {
              text: "去学一下 seedance2.0 新玩法，学完告诉我你学到了什么",
            },
          },
        ],
      },
    );

    expect(result).toBe("sent");
    expect(providerCalls).toHaveLength(2);
    expect(replies.at(-1)).toContain("本轮：Seedance 2.0 新玩法");
    expect(replies.at(-1)).not.toContain("旧库存");
  });

  it("reports quarantined learning failures instead of claiming the Weixin chat learned the page", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-tool-failure-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/learning/query")) {
        return jsonResponse(
          {
            result: {
              status: "ok",
              candidateCount: 0,
              artifactCount: 1,
              quarantineCount: 1,
              adapterReports: [
                {
                  sourceKind: "web-search",
                  candidateCount: 0,
                  quarantineCount: 1,
                  notes: ["Skipped https://www.zhihu.com/question/seedance: HTTP 403."],
                },
              ],
            },
            candidates: [],
            quarantines: [
              {
                quarantineId: "quarantine-zhihu-403",
                reason: "source fetch failed before readable source content",
                notes: ["Search query: seedance2.0 最新教程", "Search rank: 1"],
                artifact: {
                  sourceRef: "https://www.zhihu.com/question/seedance",
                  title: "知乎 Seedance 教程",
                  textPreview:
                    "Fetch failed for search result 1 (seedance2.0 最新教程) https://www.zhihu.com/question/seedance: HTTP 403",
                  quality: {
                    verdict: "quarantine",
                    reasons: ["source fetch failed before readable source content"],
                  },
                },
              },
            ],
          },
          201,
        );
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ url, body });
      providerTurn += 1;
      if (providerTurn === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-learning-failed",
                    type: "function",
                    function: {
                      name: "director.learning.query",
                      arguments: JSON.stringify({ query: "seedance2.0 最新教程" }),
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
                "这次没有真正学会：只搜到一个知乎来源，但抓取时 HTTP 403，被放进隔离区，没有生成待审候选。要继续的话需要浏览器登录态/网页提取工具，或者换可公开读取的来源。",
            },
          },
        ],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-model-tool-learning-query-failed",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [
          {
            type: 1,
            text_item: {
              text: "你去网上学 seedance2.0 最新教程",
            },
          },
        ],
      },
    );

    expect(result).toBe("sent");
    expect(providerCalls).toHaveLength(2);
    expect(providerCalls[1]?.body).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          tool_call_id: "call-learning-failed",
          content: expect.stringContaining("这次还没有学到可信正文"),
        }),
      ]),
    });
    expect(JSON.stringify(providerCalls[1]?.body)).toContain("HTTP 403");
    expect(JSON.stringify(providerCalls[1]?.body)).toContain("不要说已经学会");
    expect(JSON.stringify(providerCalls[1]?.body)).not.toContain("status: no-candidate");
    expect(hostCalls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/learning/query",
      "/ilink/bot/sendmessage",
    ]);
    expect(replies.at(-1)).toContain("没有真正学会");
    expect(replies.at(-1)).toContain("HTTP 403");
    expect(replies.at(-1)).toContain("浏览器登录态");
    expect(replies.at(-1)).not.toContain("已学会");
  });

  it("does not answer learning follow-up from peer shadow-cache candidates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-learning-followup-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    writeLegacyPeerLearningArtifact(home, account.normalizedAccountId, "friend@im.wechat", {
      peerId: "friend@im.wechat",
      source: "runtime-tool",
      query: "seedance2.0 最新教程",
      candidateCount: 2,
      candidates: [
        {
          candidateId: "exp-seedance-1",
          title: "Seedance 2.0 图生视频教程",
          summary: "讲了首帧设计、镜头运动、动作强度和 1080p 输出。",
        },
        {
          candidateId: "exp-seedance-2",
          title: "Seedance 2.0 运镜提示词经验",
          summary: "强调按场景拆分镜头，把提示词从画面描述改成时空描述。",
        },
      ],
      updatedAt: "2026-05-04T19:30:00.000Z",
    });

    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/learning/query")) {
        throw new Error("learning follow-up must not start a new write-gated learning query");
      }
      if (url.endsWith("/v1/experience/candidates") && init?.method === "GET") {
        return jsonResponse({ experienceCandidates: [] });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ url, body });
      providerTurn += 1;
      if (providerTurn === 1) {
        expect(toolNamesFromRequestBody(body)).toEqual(["director.experience.candidates.list"]);
        return jsonResponse({
          choices: [{ message: { content: "当前共享经验候选为空，不能拿旧微信缓存冒充。" } }],
        });
      }
      return jsonResponse({
        choices: [{ message: { content: "unexpected extra model turn" } }],
      });
    };

    const result = await handleWeixinMessage(
      {
        home,
        workspaceRoot,
        account,
        dmPolicy: "open",
        allowedUsers: [],
        fetchFn,
        apiProviderFetch,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-learning-followup-readonly",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [
          {
            type: 1,
            text_item: {
              text: "那你讲给我听，你学了什么，我都不知道你有没有真正找",
            },
          },
        ],
      },
    );

    expect(result).toBe("sent");
    expect(providerCalls).toHaveLength(1);
    expect(hostCalls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/experience/candidates",
      "/ilink/bot/sendmessage",
    ]);
    expect(replies.at(-1)).toContain("没有可展示的待审经验候选");
    expect(replies.at(-1)).not.toContain("首帧");
    expect(replies.at(-1)).not.toContain("时空描述");
    expect(replies.at(-1)).not.toContain("需要可信操作员确认");
    expect(replies.at(-1)).not.toContain("可信操作员");
    expect(replies.at(-1)).not.toContain("确认工具");
    expect(replies.at(-1)).not.toContain("待审状态");
  });

  it("lets the model inspect an approved Skill during ordinary Weixin chat", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-skill-view-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    new SkillSnapshotFileStore(
      resolveApprovedSkillSnapshotPath({ dataDir: join(workspaceRoot, ".hotflow") }),
    ).writeApproved([
      {
        id: "skill.comfyui-workflow",
        version: "1.0.0",
        title: "ComfyUI Workflow Skill",
        content:
          "Build scene-by-scene script, image prompt, and video prompt nodes before running ComfyUI.",
        description: "ComfyUI workflow planning.",
        updatedAtMs: 1,
        tags: ["comfyui", "workflow"],
        toolNames: ["director.comfyui.create_workflow"],
      },
    ]);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/skills/skill.comfyui-workflow/view")) {
        return jsonResponse({
          schemaId: "director.host.skill-view.v1",
          status: "viewed",
          skill: {
            id: "skill.comfyui-workflow",
            version: "1.0.0",
            title: "ComfyUI Workflow Skill",
            content:
              "Build scene-by-scene script, image prompt, and video prompt nodes before running ComfyUI.",
            description: "ComfyUI workflow planning.",
            updatedAtMs: 1,
            tags: ["comfyui", "workflow"],
            toolNames: ["director.comfyui.create_workflow"],
            enabled: true,
            enablementStatus: "enabled",
            usage: {
              skillId: "skill.comfyui-workflow",
              viewCount: 1,
              useCount: 0,
            },
          },
          usage: {
            skillId: "skill.comfyui-workflow",
            viewCount: 1,
            useCount: 0,
          },
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ url, body });
      providerTurn += 1;
      if (providerTurn === 1) {
        expect(toolNamesFromRequestBody(body)).toEqual(
          expect.arrayContaining(["director.skills.list", "director.skills.view"]),
        );
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
                      arguments: JSON.stringify({ skillId: "skill.comfyui-workflow" }),
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
            content: expect.stringContaining("scene-by-scene script"),
          }),
        ]),
      );
      return jsonResponse({
        choices: [
          {
            message: {
              content:
                "我看过 ComfyUI Workflow Skill 了：它要求按场景分别组织脚本、图片提示词和视频提示词。",
            },
          },
        ],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-model-tool-skill-view",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [
          {
            type: 1,
            text_item: { text: "你有没有 ComfyUI 工作流相关 Skill？先看一下再回答" },
          },
        ],
      },
    );

    expect(result).toBe("sent");
    expect(
      hostCalls.map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`),
    ).toContain("POST:/v1/skills/skill.comfyui-workflow/view");
    expect(providerCalls).toHaveLength(2);
    expect(replies.at(-1)).toContain("我看过 ComfyUI Workflow Skill");
  });

  it("uses the Host API shared Skill index instead of local Weixin ranking", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-skill-index-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.includes("/v1/skills?")) {
        const parsed = new URL(url);
        expect(parsed.searchParams.get("query")).toBe("ComfyUI 工作流");
        expect(parsed.searchParams.get("limit")).toBe("1");
        expect(parsed.searchParams.get("includeDisabled")).toBe("false");
        return jsonResponse({
          schemaId: "director.host.skills.v1",
          skillIndex: {
            query: "ComfyUI 工作流",
            limit: 1,
            includeDisabled: false,
            skillIds: ["skill.comfyui-workflow"],
          },
          skills: [
            { id: "skill.other-local-match", title: "本地会误命中的 Skill", enabled: true },
            { id: "skill.comfyui-workflow", title: "ComfyUI Workflow Skill", enabled: true },
          ],
        });
      }
      if (url.endsWith("/v1/skills/proposals")) {
        return jsonResponse({ proposals: [] });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ url: _url, body });
      providerTurn += 1;
      if (providerTurn === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-skill-list-1",
                    type: "function",
                    function: {
                      name: "director.skills.list",
                      arguments: JSON.stringify({
                        query: "ComfyUI 工作流",
                        limit: 1,
                        includeDisabled: false,
                      }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      const toolMessage = toolMessageFromRequestBody(body, "call-skill-list-1");
      expect(toolMessage?.content).toContain("skill_ids: skill.comfyui-workflow");
      expect(toolMessage?.content).not.toContain("skill.other-local-match");
      return jsonResponse({
        choices: [
          {
            message: {
              content: "我查到可用的 ComfyUI Workflow Skill，下一步可以读取全文再执行。",
            },
          },
        ],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-model-tool-skill-index",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [
          {
            type: 1,
            text_item: { text: "找一下 ComfyUI 工作流 Skill" },
          },
        ],
      },
    );

    expect(result).toBe("sent");
    expect(hostCalls.map((call) => new URL(call.url).pathname)).toContain("/v1/skills");
    expect(providerCalls).toHaveLength(2);
    expect(replies.at(-1)).toContain("ComfyUI Workflow Skill");
  });

  it("records approved Skill use through Host API during ordinary Weixin chat", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-skill-use-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/skills/skill.comfyui-workflow/use")) {
        return jsonResponse({
          schemaId: "director.host.skill-use.v1",
          status: "used",
          skill: {
            id: "skill.comfyui-workflow",
            version: "1.0.0",
            title: "ComfyUI Workflow Skill",
            content:
              "Build scene-by-scene script, image prompt, and video prompt nodes before running ComfyUI.",
            description: "ComfyUI workflow planning.",
            updatedAtMs: 1,
            tags: ["comfyui", "workflow"],
            toolNames: ["director.comfyui.create_workflow"],
            enabled: true,
            enablementStatus: "enabled",
          },
          usage: {
            skillId: "skill.comfyui-workflow",
            useCount: 1,
          },
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ url, body });
      providerTurn += 1;
      if (providerTurn === 1) {
        expect(toolNamesFromRequestBody(body)).toEqual(
          expect.arrayContaining(["director.skills.use"]),
        );
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
                        skillId: "skill.comfyui-workflow",
                        objective: "创建脚本+图片+视频工作流",
                        reason: "用户要求按 ComfyUI Skill 做。",
                      }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      const toolMessage = toolMessageFromRequestBody(body, "call-skill-use-1");
      expect(toolMessage?.content).toContain("status: success");
      expect(toolMessage?.content).toContain("scene-by-scene script");
      return jsonResponse({
        choices: [
          {
            message: {
              content: "已按 ComfyUI Workflow Skill 组织后续工作流。",
            },
          },
        ],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-model-tool-skill-use",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [
          {
            type: 1,
            text_item: { text: "用 ComfyUI Workflow Skill 继续" },
          },
        ],
      },
    );

    expect(result).toBe("sent");
    expect(
      hostCalls.map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`),
    ).toContain("POST:/v1/skills/skill.comfyui-workflow/use");
    expect(hostCalls.find((call) => call.url.endsWith("/use"))?.body).toContain(
      "用户要求按 ComfyUI Skill 做。",
    );
    expect(providerCalls).toHaveLength(2);
    expect(replies.at(-1)).toContain("已按 ComfyUI Workflow Skill");
  });

  it("surfaces Host API Skill needs-setup results during ordinary Weixin chat", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-skill-needs-setup-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/skills/skill.twitter-research/use")) {
        return jsonResponse({
          schemaId: "director.host.skill-use.v1",
          status: "needs_setup",
          skill: {
            id: "skill.twitter-research",
            version: "1.0.0",
            title: "Twitter Research Skill",
            content: "Use x_search before summarizing the latest social posts.",
            description: "Research fresh X/Twitter posts.",
            updatedAtMs: 1,
            tags: ["research", "twitter"],
            toolNames: ["x_search"],
            enabled: false,
            configuredEnabled: true,
            eligible: false,
            modelVisible: false,
            doctorStatus: "needs-setup",
            runtimeStatus: "needs-setup",
            doctorSummary:
              "Skill 声明的工具尚不可用：x_search。x_search: needs-auth；X provider needs an API key.",
            missingToolNames: ["x_search"],
            nextActions: ["x_search: 配置 X/Twitter API provider。"],
            explanationSurface: {
              schemaId: "skills.explanation-surface.v1",
              kind: "skill-runtime",
              status: "needs-setup",
              summary: "Twitter Research Skill 依赖未就绪，缺少 x_search。",
              statusExplanation: "x_search 需要配置 X/Twitter API provider。",
              operatorReviewRequired: false,
              nextActions: ["x_search: 配置 X/Twitter API provider。"],
            },
          },
          usage: null,
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ body });
      providerTurn += 1;
      if (providerTurn === 1) {
        expect(toolNamesFromRequestBody(body)).toEqual(
          expect.arrayContaining(["director.skills.use"]),
        );
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-skill-needs-setup-1",
                    type: "function",
                    function: {
                      name: "director.skills.use",
                      arguments: JSON.stringify({
                        skillId: "skill.twitter-research",
                        objective: "学习 X/Twitter 最新 Seedance 经验",
                        reason: "用户要求去推特学习。",
                      }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      const toolMessage = toolMessageFromRequestBody(body, "call-skill-needs-setup-1");
      expect(toolMessage?.content).toContain("status: needs_setup");
      expect(toolMessage?.content).toContain("explanation_status: needs-setup");
      expect(toolMessage?.content).toContain("status_explanation:");
      expect(toolMessage?.content).toContain("x_search");
      expect(toolMessage?.content).toContain("missing_tools: x_search");
      return jsonResponse({
        choices: [
          {
            message: {
              content:
                "Twitter Research Skill 还不能用：缺少 x_search 的 X/Twitter API 配置。请先配置 X/Twitter Provider。",
            },
          },
        ],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-model-tool-skill-needs-setup",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [
          {
            type: 1,
            text_item: { text: "用 Twitter Research Skill 学习最新 Seedance" },
          },
        ],
      },
    );

    expect(result).toBe("sent");
    expect(
      hostCalls.map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`),
    ).toContain("POST:/v1/skills/skill.twitter-research/use");
    expect(providerCalls.length).toBeGreaterThanOrEqual(2);
    expect(replies.at(-1)).toContain("x_search");
    expect(replies.at(-1)).toContain("依赖未就绪");
  });

  it("surfaces Host API missing Skill observations during ordinary Weixin chat", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-skill-missing-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/skills/skill.removed-twitter/use")) {
        return jsonResponse({
          schemaId: "director.host.skill-use.v1",
          status: "missing_skill",
          skill: {
            id: "skill.removed-twitter",
            title: "skill.removed-twitter",
            enabled: false,
            configuredEnabled: false,
            eligible: false,
            modelVisible: false,
            runtimeStatus: "missing-skill",
            doctorStatus: "missing-skill",
            disabledReason: "Skill 不存在或已从当前已批准快照移除。",
            nextActions: [
              "重新调用 director.skills.list 刷新 Skill 索引。",
              "当前轮不要假装已经读取、应用或执行这个 Skill。",
            ],
            explanationSurface: {
              schemaId: "skills.explanation-surface.v1",
              kind: "skill-runtime",
              status: "missing-skill",
              summary: "Skill 已从当前已批准快照移除。",
              statusExplanation: "旧上下文还在引用这个 Skill；当前轮不能读取、应用或执行。",
              operatorReviewRequired: false,
              nextActions: [
                "重新调用 director.skills.list 刷新 Skill 索引。",
                "当前轮不要假装已经读取、应用或执行这个 Skill。",
              ],
            },
          },
          usage: null,
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ body });
      providerTurn += 1;
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
                        objective: "按旧上下文应用 Twitter Skill",
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
      const toolMessage = toolMessageFromRequestBody(body, "call-skill-missing-1");
      expect(toolMessage?.content).toContain("status: missing_skill");
      expect(toolMessage?.content).toContain("explanation_status: missing-skill");
      expect(toolMessage?.content).toContain("status_explanation:");
      expect(toolMessage?.content).toContain("Skill 不存在或已从当前已批准快照移除");
      return jsonResponse({
        choices: [
          {
            message: {
              content: "这个 Skill 已从当前批准库移除，我不会假装已经应用，会先刷新 Skill 索引。",
            },
          },
        ],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-model-tool-skill-missing",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [
          {
            type: 1,
            text_item: { text: "用那个旧 Twitter Skill 回答一下" },
          },
        ],
      },
    );

    expect(result).toBe("sent");
    expect(
      hostCalls.map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`),
    ).toContain("POST:/v1/skills/skill.removed-twitter/use");
    expect(providerCalls.length).toBeGreaterThanOrEqual(2);
    expect(replies.at(-1)).toContain("已批准快照移除");
    expect(replies.at(-1)).toContain("刷新 Skill 索引");
  });

  it("surfaces Skill curator write guard observations without executing remote write actions", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-skill-curator-guard-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/skills/curator/actions/guard")) {
        return jsonResponse({
          schemaId: "director.host.skill-curator-write-guard.v1",
          status: "blocked",
          applied: false,
          guard: {
            schemaId: "skills.curator-write-guard.v1",
            allowed: false,
            status: "blocked",
            reasonCode: "remote_surface_blocked",
            summary:
              "Skill curator 写操作仅允许桌面本地 operator 入口；Host API、微信、自动化和未知远程入口保持 fail-closed。",
            operatorSurface: "host-api",
            operatorActor: "weixin-conversation-runtime",
            requiredScopes: ["skills.curator.write"],
            grantedScopes: ["skills.curator.write"],
            missingScopes: [],
            requestedAction: {
              kind: "patch",
              skillId: "skill.failed-curator",
            },
            nextActions: [
              "请回到桌面本地 operator 的 Skills/Review/Ops 面板确认 curator 动作。",
              "远程入口只能读取 guard 结果，不能 patch、archive 或 merge Skill。",
            ],
            evidenceRefs: [
              "skill-curator://patch/skill.failed-curator",
              "skills.curator-write-guard://remote-surface-blocked",
            ],
            generatedAtMs: 1_713_000_000_000,
          },
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ body });
      providerTurn += 1;
      if (providerTurn === 1) {
        expect(toolNamesFromRequestBody(body)).toEqual(
          expect.arrayContaining(["director.skills.curator.guard"]),
        );
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-skill-curator-guard-1",
                    type: "function",
                    function: {
                      name: "director.skills.curator.guard",
                      arguments: JSON.stringify({
                        action: "patch",
                        skillId: "skill.failed-curator",
                        reason: "用户要求微信直接修补失败 Skill。",
                      }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      const toolMessage = toolMessageFromRequestBody(body, "call-skill-curator-guard-1");
      expect(toolMessage?.content).toContain("status: blocked");
      expect(toolMessage?.content).toContain("curator_write_allowed: false");
      expect(toolMessage?.content).toContain("reason_code: remote_surface_blocked");
      expect(toolMessage?.content).toContain("applied: false");
      return jsonResponse({
        choices: [
          {
            message: {
              content: "这个 Skill curator 写操作不能在微信里执行，需要回到桌面 Review/Ops。",
            },
          },
        ],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-model-tool-skill-curator-guard",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [{ type: 1, text_item: { text: "直接帮我修补失败的 Skill" } }],
      },
    );

    expect(result).toBe("sent");
    expect(
      hostCalls.map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`),
    ).toContain("POST:/v1/skills/curator/actions/guard");
    expect(hostCalls.find((call) => call.url.endsWith("/guard"))?.body).toContain(
      '"action":"patch"',
    );
    expect(providerCalls).toHaveLength(2);
    expect(replies.at(-1)).toContain("桌面 Review/Ops");
  });

  it("lets the model request approved Skill enablement during ordinary Weixin chat", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-skill-enable-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    new SkillSnapshotFileStore(
      resolveApprovedSkillSnapshotPath({ dataDir: join(workspaceRoot, ".hotflow") }),
    ).writeApproved([
      {
        id: "skill.web-browser",
        version: "1.0.0",
        title: "Web Browser Skill",
        content: "Use browser/web tools only after the operator enables this skill.",
        description: "Browsing workflow.",
        updatedAtMs: 1,
        tags: ["browser", "web"],
        toolNames: ["director.learning.query"],
      },
    ]);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/skills/skill.web-browser/enabled")) {
        return jsonResponse({
          schemaId: "director.host.skill-management.v1",
          skill: {
            id: "skill.web-browser",
            title: "Web Browser Skill",
            enabled: true,
            enablementStatus: "enabled",
          },
          management: { disabledSkillIds: [] },
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ url, body });
      providerTurn += 1;
      if (providerTurn === 1) {
        expect(toolNamesFromRequestBody(body)).toEqual(
          expect.arrayContaining(["director.skills.list", "director.skills.set_enabled"]),
        );
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
                        skillId: "skill.web-browser",
                        enabled: true,
                        reason: "用户要求启用浏览互联网能力。",
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
            tool_call_id: "call-skill-enable-1",
            content: expect.stringContaining("Skill 已开启"),
          }),
        ]),
      );
      return jsonResponse({
        choices: [{ message: { content: "已开启 Web Browser Skill，下一轮可以按需使用。" } }],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-model-tool-skill-enable",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [{ type: 1, text_item: { text: "启用可以浏览互联网的 Skill" } }],
      },
    );

    expect(result).toBe("sent");
    expect(providerCalls).toHaveLength(2);
    expect(
      hostCalls.map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`),
    ).toEqual(["PUT:/v1/skills/skill.web-browser/enabled", "POST:/ilink/bot/sendmessage"]);
    expect(hostCalls[0]?.body).toContain('"enabled":true');
    expect(replies.at(-1)).toContain("已开启 Web Browser Skill");
  });

  it("lets a Weixin requester confirm their own pending runtime tool request", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-tool-requester-approval-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/skills/skill.web-browser/enabled")) {
        return jsonResponse({
          schemaId: "director.host.skill-management.v1",
          skill: {
            id: "skill.web-browser",
            title: "Web Browser Skill",
            enabled: true,
            enablementStatus: "enabled",
          },
          management: { disabledSkillIds: [] },
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async (url, init) => {
      providerCalls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      return jsonResponse({
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-skill-enable-requester",
                  type: "function",
                  function: {
                    name: "director.skills.set_enabled",
                    arguments: JSON.stringify({
                      skillId: "skill.web-browser",
                      enabled: true,
                      reason: "用户要求启用浏览互联网能力。",
                    }),
                  },
                },
              ],
            },
          },
        ],
      });
    };
    const config = {
      home,
      workspaceRoot,
      account,
      dmPolicy: "open" as const,
      allowedUsers: [],
      fetchFn,
      apiProviderFetch,
      director: {
        hostApiUrl: "http://127.0.0.1:3201",
        hostId: "personal-weixin",
        agentId: "director",
        channel: "personal-weixin",
        autoAdvance: true,
        autoStartRun: true,
        fetchFn,
      },
    };

    await handleWeixinMessage(config, {
      message_id: "wx-model-tool-requester-approval-request",
      from_user_id: "friend@im.wechat",
      create_time_ms: 1_713_000_000_000,
      item_list: [{ type: 1, text_item: { text: "启用可以浏览互联网的 Skill" } }],
    });
    await handleWeixinMessage(config, {
      message_id: "wx-model-tool-requester-approval-confirm",
      from_user_id: "friend@im.wechat",
      create_time_ms: 1_713_000_001_000,
      item_list: [{ type: 1, text_item: { text: "确认" } }],
    });

    expect(providerCalls).toHaveLength(1);
    expect(
      hostCalls.map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`),
    ).toEqual([
      "POST:/ilink/bot/sendmessage",
      "PUT:/v1/skills/skill.web-browser/enabled",
      "POST:/ilink/bot/sendmessage",
    ]);
    expect(hostCalls[1]?.body).toContain('"enabled":true');
    expect(replies[0]).toContain("回复「确认」继续执行");
    expect(replies[0]).not.toContain("桌面端确认");
    expect(replies.at(-1)).toContain("已确认，工具已执行。");
    expect(replies.at(-1)).toContain("Skill 已开启");
    expect(replies.at(-1)).not.toContain("status: approved");
    expect(replies.at(-1)).not.toContain("next_actions:");
    expect(replies.at(-1)).not.toContain("requester approved");
  });

  it("marks unsupported Weixin spawn_subagent approvals failed instead of leaving them pending", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-spawn-approval-fail-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    saveWeixinRuntimeToolApproval(home, account.normalizedAccountId, {
      schemaVersion: "director.weixin.runtime-tool-approval.v1",
      approvalId: "tool:spawn-subagent",
      status: "pending",
      peerId: "friend@im.wechat",
      requestedByPeerId: "friend@im.wechat",
      title: "确认使用 spawn_subagent",
      summary: "后台启动子代理。",
      toolName: "spawn_subagent",
      toolCall: {
        id: "spawn-subagent",
        name: "spawn_subagent",
        args: {
          task: "后台核对微信远程通道",
          expectedOutput: "中文说明",
          profileId: "researcher",
        },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };

    await handleWeixinMessage(
      {
        home,
        workspaceRoot,
        account,
        dmPolicy: "open",
        allowedUsers: [],
        fetchFn,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-spawn-subagent-confirm",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_001_000,
        item_list: [{ type: 1, text_item: { text: "确认" } }],
      },
    );

    const approvals = loadWeixinRuntimeToolApprovals(home, account.normalizedAccountId);
    expect(
      hostCalls.map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`),
    ).toEqual(["POST:/ilink/bot/sendmessage"]);
    expect(approvals[0]).toMatchObject({
      approvalId: "tool:spawn-subagent",
      status: "failed",
      result: expect.objectContaining({
        ok: false,
        toolName: "spawn_subagent",
        content: expect.stringContaining("微信远程通道不能直接创建后台子代理任务"),
      }),
    });
    expect(replies.at(-1)).toContain("微信远程通道不能直接创建后台子代理任务");
    expect(replies.at(-1)).not.toContain("status: failed");
    expect(replies.at(-1)).not.toContain("next_actions:");
    expect(findPendingWeixinRuntimeToolApproval(home, account.normalizedAccountId)).toBeNull();
  });

  it("does not let a different untrusted Weixin peer approve someone else's pending runtime tool request", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-tool-requester-block-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/skills/skill.web-browser/enabled")) {
        throw new Error("a different untrusted peer must not approve the tool call");
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async (url, init) => {
      providerCalls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      return jsonResponse({
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-skill-enable-requester-block",
                  type: "function",
                  function: {
                    name: "director.skills.set_enabled",
                    arguments: JSON.stringify({
                      skillId: "skill.web-browser",
                      enabled: true,
                      reason: "用户要求启用浏览互联网能力。",
                    }),
                  },
                },
              ],
            },
          },
        ],
      });
    };
    const config = {
      home,
      workspaceRoot,
      account,
      dmPolicy: "open" as const,
      allowedUsers: [],
      fetchFn,
      apiProviderFetch,
      director: {
        hostApiUrl: "http://127.0.0.1:3201",
        hostId: "personal-weixin",
        agentId: "director",
        channel: "personal-weixin",
        autoAdvance: true,
        autoStartRun: true,
        fetchFn,
      },
    };

    await handleWeixinMessage(config, {
      message_id: "wx-model-tool-requester-block-request",
      from_user_id: "friend@im.wechat",
      create_time_ms: 1_713_000_000_000,
      item_list: [{ type: 1, text_item: { text: "启用可以浏览互联网的 Skill" } }],
    });
    await handleWeixinMessage(config, {
      message_id: "wx-model-tool-requester-block-confirm",
      from_user_id: "other@im.wechat",
      create_time_ms: 1_713_000_001_000,
      item_list: [{ type: 1, text_item: { text: "确认" } }],
    });

    expect(providerCalls).toHaveLength(1);
    expect(
      hostCalls.map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`),
    ).toEqual(["POST:/ilink/bot/sendmessage", "POST:/ilink/bot/sendmessage"]);
    expect(replies.at(-1)).toContain("只有发起人或可信操作员可以处理");
    expect(replies.at(-1)).not.toContain("status: untrusted");
    expect(replies.at(-1)).not.toContain("not the requester");
  });

  it("does not let open-mode Weixin chats directly change Skill enablement without confirmation", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-skill-enable-untrusted-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/skills/skill.web-browser/enabled")) {
        throw new Error("untrusted Weixin chat must not call Skill enablement Host API");
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerTurn = 0;
    const apiProviderFetch: FetchLike = async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ url, body });
      providerTurn += 1;
      if (providerTurn === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-skill-enable-untrusted",
                    type: "function",
                    function: {
                      name: "director.skills.set_enabled",
                      arguments: JSON.stringify({
                        skillId: "skill.web-browser",
                        enabled: true,
                        reason: "用户要求启用浏览互联网能力。",
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
            tool_call_id: "call-skill-enable-untrusted",
            content: expect.stringContaining("approval_required"),
          }),
        ]),
      );
      return jsonResponse({
        choices: [
          {
            message: {
              content: "这个能力需要在桌面端，或由可信微信操作员确认开启。我没有直接改配置。",
            },
          },
        ],
      });
    };

    const result = await handleWeixinMessage(
      {
        home,
        workspaceRoot,
        account,
        dmPolicy: "open",
        allowedUsers: [],
        fetchFn,
        apiProviderFetch,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-model-tool-skill-enable-untrusted",
        from_user_id: "stranger@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [{ type: 1, text_item: { text: "启用可以浏览互联网的 Skill" } }],
      },
    );

    expect(result).toBe("sent");
    expect(providerCalls).toHaveLength(1);
    expect(
      hostCalls.map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`),
    ).toEqual(["POST:/ilink/bot/sendmessage"]);
    expect(replies.at(-1)).toContain("回复「确认」继续执行");
    expect(replies.at(-1)).not.toContain("桌面端确认");
  });

  it("lets a trusted Weixin operator approve a pending runtime tool request", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-tool-approval-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: unknown }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/skills/skill.web-browser/enabled")) {
        return jsonResponse({
          schemaId: "director.host.skill-management.v1",
          skill: {
            id: "skill.web-browser",
            title: "Web Browser Skill",
            enabled: true,
            enablementStatus: "enabled",
          },
          management: { disabledSkillIds: [] },
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ url, body });
      return jsonResponse({
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-skill-enable-approval",
                  type: "function",
                  function: {
                    name: "director.skills.set_enabled",
                    arguments: JSON.stringify({
                      skillId: "skill.web-browser",
                      enabled: true,
                      reason: "用户要求启用浏览互联网能力。",
                    }),
                  },
                },
              ],
            },
          },
        ],
      });
    };
    const config = {
      home,
      workspaceRoot,
      account,
      dmPolicy: "open" as const,
      allowedUsers: [],
      trustedOperatorUsers: ["owner@im.wechat"],
      fetchFn,
      apiProviderFetch,
      director: {
        hostApiUrl: "http://127.0.0.1:3201",
        hostId: "personal-weixin",
        agentId: "director",
        channel: "personal-weixin",
        autoAdvance: true,
        autoStartRun: true,
        fetchFn,
      },
    };

    await handleWeixinMessage(config, {
      message_id: "wx-model-tool-approval-request",
      from_user_id: "stranger@im.wechat",
      create_time_ms: 1_713_000_000_000,
      item_list: [{ type: 1, text_item: { text: "启用可以浏览互联网的 Skill" } }],
    });
    await handleWeixinMessage(config, {
      message_id: "wx-model-tool-approval-confirm",
      from_user_id: "owner@im.wechat",
      create_time_ms: 1_713_000_001_000,
      item_list: [{ type: 1, text_item: { text: "确认工具" } }],
    });

    expect(providerCalls).toHaveLength(1);
    expect(
      hostCalls.map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`),
    ).toEqual([
      "POST:/ilink/bot/sendmessage",
      "PUT:/v1/skills/skill.web-browser/enabled",
      "POST:/ilink/bot/sendmessage",
    ]);
    expect(hostCalls[1]?.body).toContain('"enabled":true');
    expect(replies.at(-1)).toContain("微信工具确认");
    expect(replies.at(-1)).toContain("可信操作员已确认，工具已执行。");
    expect(replies.at(-1)).toContain("Skill 已开启");
    expect(replies.at(-1)).not.toContain("status: approved");
    expect(replies.at(-1)).not.toContain("next_actions:");
    expect(replies.at(-1)).not.toContain("已确认并执行");
    expect(replies.at(-1)).not.toContain("trusted operator approved");
  });

  it("keeps MCP install requests short-confirmed on Weixin before writing .mcp.json", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-mcp-install-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async () =>
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
      });
    const config = {
      home,
      workspaceRoot,
      account,
      dmPolicy: "open" as const,
      allowedUsers: [],
      trustedOperatorUsers: ["owner@im.wechat"],
      fetchFn,
      apiProviderFetch,
      director: {
        hostApiUrl: "http://127.0.0.1:3201",
        hostId: "personal-weixin",
        agentId: "director",
        channel: "personal-weixin",
        autoAdvance: true,
        autoStartRun: true,
        fetchFn,
      },
    };

    await handleWeixinMessage(config, {
      message_id: "wx-mcp-install-request",
      from_user_id: "owner@im.wechat",
      create_time_ms: 1_713_000_000_000,
      item_list: [{ type: 1, text_item: { text: "安装 Context7 MCP" } }],
    });

    expect(replies.at(-1)).toContain("确认 MCP：context7");
    expect(replies.at(-1)).toContain("回复「确认」继续执行");
    expect(replies.at(-1)).toContain("回复「拒绝」取消");
    expect(replies.at(-1)).not.toContain("可信操作员");
    expect(replies.at(-1)).not.toContain("确认工具");
    expect(replies.at(-1)).not.toContain("拒绝工具");
    expect(existsSync(join(workspaceRoot, ".mcp.json"))).toBe(false);

    await handleWeixinMessage(config, {
      message_id: "wx-mcp-install-confirm",
      from_user_id: "owner@im.wechat",
      create_time_ms: 1_713_000_001_000,
      item_list: [{ type: 1, text_item: { text: "确认" } }],
    });

    const configFile = JSON.parse(readFileSync(join(workspaceRoot, ".mcp.json"), "utf8"));
    expect(configFile.mcpServers.context7).toMatchObject({
      type: "stdio",
      command: "node",
      args: ["missing-context7-mcp.js"],
      enabled: true,
    });
    expect(replies.at(-1)).toContain("MCP 已安装：context7");
    expect(replies.at(-1)).not.toContain("status: approved");
    expect(replies.at(-1)).not.toContain("config_path:");
  });

  it("loads MCP servers from parent project configs and legacy Director configs in Weixin turns", async () => {
    const parentRoot = mkdtempSync(join(tmpdir(), "director-weixin-mcp-scope-parent-"));
    const workspaceRoot = join(parentRoot, "nested", "project");
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(parentRoot, home);
    mkdirSync(workspaceRoot, { recursive: true });
    mkdirSync(join(workspaceRoot, ".director-angel", "mcp"), { recursive: true });
    writeWeixinApiProviderFixture(workspaceRoot);
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
            workspace: {
              type: "stdio",
              command: "node",
              args: ["workspace.js"],
              enabled: false,
            },
          },
        },
        null,
        2,
      ),
    );
    const replies: string[] = [];
    const providerBodies: unknown[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    let providerCallCount = 0;
    const apiProviderFetch: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      providerBodies.push(body);
      providerCallCount += 1;
      if (providerCallCount === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-mcp-list",
                    type: "function",
                    function: {
                      name: "director.mcp.servers.list",
                      arguments: "{}",
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
              content: JSON.stringify(body).includes("MCP 已配置 3 个")
                ? "MCP 已配置 3 个；inherited:disabled；legacy:disabled；workspace:disabled。"
                : "MCP 观察里没有加载到 3 个 server。",
            },
          },
        ],
      });
    };
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const config = {
      home,
      workspaceRoot,
      account,
      dmPolicy: "open" as const,
      allowedUsers: [],
      trustedOperatorUsers: ["owner@im.wechat"],
      fetchFn,
      apiProviderFetch,
      director: {
        hostApiUrl: "http://127.0.0.1:3201",
        hostId: "personal-weixin",
        agentId: "director",
        channel: "personal-weixin",
        autoAdvance: true,
        autoStartRun: true,
        fetchFn,
      },
    };

    await handleWeixinMessage(config, {
      message_id: "wx-mcp-status",
      from_user_id: "owner@im.wechat",
      create_time_ms: 1_713_000_002_000,
      item_list: [{ type: 1, text_item: { text: "帮我检查 MCP 状态" } }],
    });

    expect(providerCallCount).toBe(2);
    expect(JSON.stringify(providerBodies.at(-1))).toContain("MCP 已配置 3 个");
    expect(JSON.stringify(providerBodies.at(-1))).toContain("inherited:disabled");
    expect(JSON.stringify(providerBodies.at(-1))).toContain("legacy:disabled");
    expect(JSON.stringify(providerBodies.at(-1))).toContain("workspace:disabled");
    expect(replies.at(-1)).toContain("MCP 已配置 3 个");
    expect(replies.at(-1)).toContain("inherited:disabled");
    expect(replies.at(-1)).toContain("legacy:disabled");
    expect(replies.at(-1)).toContain("workspace:disabled");
  });

  it("enables inherited MCP on Weixin by removing the local disabled override", async () => {
    const parentRoot = mkdtempSync(join(tmpdir(), "director-weixin-mcp-enable-inherited-"));
    const workspaceRoot = join(parentRoot, "nested", "project");
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(parentRoot, home);
    mkdirSync(workspaceRoot, { recursive: true });
    writeWeixinApiProviderFixture(workspaceRoot);
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
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-mcp-enable-inherited",
                  type: "function",
                  function: {
                    name: "director.mcp.server.upsert",
                    arguments: JSON.stringify({
                      serverName: "inherited",
                      transport: "stdio",
                      command: "node",
                      args: ["parent.js"],
                      enabled: true,
                      reason: "用户要求重新启用 inherited MCP。",
                    }),
                  },
                },
              ],
            },
          },
        ],
      });
    const config = {
      home,
      workspaceRoot,
      account,
      dmPolicy: "open" as const,
      allowedUsers: [],
      trustedOperatorUsers: ["owner@im.wechat"],
      fetchFn,
      apiProviderFetch,
      director: {
        hostApiUrl: "http://127.0.0.1:3201",
        hostId: "personal-weixin",
        agentId: "director",
        channel: "personal-weixin",
        autoAdvance: true,
        autoStartRun: true,
        fetchFn,
      },
    };

    await handleWeixinMessage(config, {
      message_id: "wx-mcp-enable-inherited-request",
      from_user_id: "owner@im.wechat",
      create_time_ms: 1_713_000_003_000,
      item_list: [{ type: 1, text_item: { text: "启用 inherited MCP" } }],
    });
    await handleWeixinMessage(config, {
      message_id: "wx-mcp-enable-inherited-confirm",
      from_user_id: "owner@im.wechat",
      create_time_ms: 1_713_000_004_000,
      item_list: [{ type: 1, text_item: { text: "确认" } }],
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
    expect(replies.at(-1)).toContain("恢复继承配置");
    expect(replies.at(-1)).toContain("inherited");
    expect(replies.at(-1)).not.toContain("status: approved");
    expect(replies.at(-1)).not.toContain("config_path:");
  });

  it("shows Host API Agent OS process ledger evidence on Weixin runtime approval cards", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-tool-ledger-approval-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const replies: string[] = [];
    const hostCalls: Array<{ readonly method?: string; readonly path: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ method: init?.method, path: new URL(url).pathname });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      if (url.endsWith("/v1/runtime/snapshot")) {
        return jsonResponse({
          apiVersion: "director-host-api.v1",
          runtimeId: "director-host-api",
          capabilitySnapshot: {
            snapshotId: "snapshot-1",
            runtimeId: "director-host-api",
            capturedAt: "2026-05-08T00:00:00.000Z",
            status: "ready",
            adapters: [],
          },
          agentOsProcessCapabilityLedger: {
            generatedAt: "2026-05-08T00:00:00.000Z",
            totalEntries: 1,
            riskyHostEntries: 1,
            entries: [
              {
                owner: "director-host-api",
                runnerKind: "exec-file",
                backend: "host",
                status: "completed",
                command: "echo ok",
                operationId: "host-ledger-smoke",
                process: { pid: 4242, ownedProcess: true },
              },
            ],
          },
        });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-mcp-ledger-approval",
                  type: "function",
                  function: {
                    name: "director.mcp.server.upsert",
                    arguments: JSON.stringify({
                      serverName: "ledger",
                      transport: "stdio",
                      command: "node",
                      args: ["ledger.js"],
                      enabled: true,
                    }),
                  },
                },
              ],
            },
          },
        ],
      });

    await handleWeixinMessage(
      {
        home,
        workspaceRoot,
        account,
        dmPolicy: "open",
        allowedUsers: [],
        trustedOperatorUsers: ["owner@im.wechat"],
        useHostToolControlPlane: true,
        fetchFn,
        apiProviderFetch,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-model-tool-approval-ledger",
        from_user_id: "owner@im.wechat",
        create_time_ms: 1_713_000_003_000,
        item_list: [{ type: 1, text_item: { text: "启用 ledger MCP" } }],
      },
    );

    expect(hostCalls).toContainEqual({ method: "GET", path: "/v1/runtime/snapshot" });
    expect(replies.at(-1)).toContain("Agent OS 进程账本：total=1 host=1");
    expect(replies.at(-1)).toContain(
      "exec-file backend=host status=completed command=echo ok operation=host-ledger-smoke pid=4242",
    );
    const storedApprovals = loadWeixinRuntimeToolApprovals(home, account.normalizedAccountId);
    expect(JSON.stringify(storedApprovals[0]?.metadata)).toContain(
      "agentOsProcessCapabilityLedger",
    );
  });

  it("does not execute stale Weixin runtime tool approvals after they expire", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-tool-approval-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    saveWeixinRuntimeToolApproval(home, account.normalizedAccountId, {
      schemaVersion: "director.weixin.runtime-tool-approval.v1",
      approvalId: "tool:stale",
      status: "pending",
      peerId: "stranger@im.wechat",
      requestedByPeerId: "stranger@im.wechat",
      title: "确认使用 director.skills.set_enabled",
      summary: "启用浏览 Skill。",
      toolName: "director.skills.set_enabled",
      toolCall: {
        id: "stale",
        name: "director.skills.set_enabled",
        args: { skillId: "skill.web-browser", enabled: true },
      },
      createdAt: "2000-01-01T00:00:00.000Z",
      updatedAt: "2000-01-01T00:00:00.000Z",
    });
    const hostCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      hostCalls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };

    await handleWeixinMessage(
      {
        home,
        workspaceRoot,
        account,
        dmPolicy: "open",
        allowedUsers: [],
        trustedOperatorUsers: ["owner@im.wechat"],
        fetchFn,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-model-tool-approval-expired-confirm",
        from_user_id: "owner@im.wechat",
        create_time_ms: 1_713_000_001_000,
        item_list: [{ type: 1, text_item: { text: "确认工具" } }],
      },
    );

    expect(
      hostCalls.map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`),
    ).toEqual(["POST:/ilink/bot/sendmessage"]);
    expect(replies.at(-1)).toContain("微信工具确认");
    expect(replies.at(-1)).toContain("没有找到仍在等待确认的工具操作");
    expect(replies.at(-1)).not.toContain("status:");
    expect(replies.at(-1)).not.toContain("no pending runtime tool approval");
    expect(replies.at(-1)).not.toContain("我会");
  });

  it("does not run source-first public account searches without a model", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (String(url).includes("https://weixin.sogou.com/weixin")) {
        return {
          ok: true,
          status: 200,
          url: String(url),
          async text() {
            return sogouWeixinSearchHtmlFixture();
          },
        };
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      throw new Error(`unexpected url ${url}`);
    };

    const result = await handleWeixinMessage(
      {
        home,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-natural-public-account-source-first",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [
          {
            type: 1,
            text_item: {
              text: "去微信公众号找一下有没有seedance2.0的最新学习内容",
            },
          },
        ],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(
      expect.arrayContaining(["/weixin", "/ilink/bot/sendmessage"]),
    );
    expect(replies.at(-1)).toContain("取证来源：搜狗微信公众号文章搜索");
    expect(replies.at(-1)).toContain("要继续的话，我会优先读取上面这些来源的正文");
    expect(replies.at(-1)).not.toContain("我找到");
    expect(replies.at(-1)).not.toContain("主角");
    expect(replies.at(-1)).not.toContain("场景");
    expect(replies.at(-1)).not.toContain("Run：");
    expect(replies.at(-1)).not.toContain("蓝图：");
  });

  it("does not run conversational public-account lookups without a model", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (String(url).includes("https://weixin.sogou.com/weixin")) {
        return {
          ok: true,
          status: 200,
          url: String(url),
          async text() {
            return sogouWeixinSearchHtmlFixture();
          },
        };
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      throw new Error(`unexpected url ${url}`);
    };

    const result = await handleWeixinMessage(
      {
        home,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-natural-public-account-learn-back",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [
          {
            type: 1,
            text_item: {
              text: "你现在去微信公众号看一下有没有 seedance2.0 最新的玩法，学习下来",
            },
          },
        ],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/ilink/bot/sendmessage"]);
    expect(replies.at(-1)).toContain("模型 Key 未配置");
    expect(replies.at(-1)).toContain("不能假装调用成功");
    expect(replies.at(-1)).not.toContain("我找到");
    expect(replies.at(-1)).not.toContain("无法直接访问");
    expect(replies.at(-1)).not.toContain("没有浏览网页");
  });

  it("does not treat slash learning requests without a concrete source as learned results", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/learning/query")) {
        return jsonResponse({ result: { candidateCount: 1 }, candidates: [] }, 201);
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      throw new Error(`unexpected url ${url}`);
    };

    const result = await handleWeixinMessage(
      {
        home,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-slash-learning-public-account-query",
        from_user_id: "friend@im.wechat",
        create_time_ms: 1_713_000_000_000,
        item_list: [
          {
            type: 1,
            text_item: {
              text: "/学习 你现在去微信公众号看一下有没有seedance2.0最新的玩法，学习下来",
            },
          },
        ],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/ilink/bot/sendmessage"]);
    expect(replies.at(-1)).toContain("Weixin capability command:");
    expect(replies.at(-1)).toContain("status: missing-argument");
    expect(replies.at(-1)).toContain("reason: url source is required");
    expect(replies.at(-1)).not.toContain("我找到");
    expect(replies.at(-1)).not.toContain("下一步：/经验");
  });

  it("uses recent short-term chat context when a later message turns into a learning task", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-context-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (String(url).includes("https://weixin.sogou.com/weixin")) {
        return {
          ok: true,
          status: 200,
          url: String(url),
          async text() {
            return sogouWeixinSearchHtmlFixture();
          },
        };
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const config = {
      home,
      workspaceRoot,
      account,
      dmPolicy: "allowlist" as const,
      allowedUsers: ["friend@im.wechat"],
      fetchFn,
      director: {
        hostApiUrl: "http://127.0.0.1:3201",
        hostId: "personal-weixin",
        agentId: "director",
        channel: "personal-weixin",
        autoAdvance: true,
        autoStartRun: true,
        fetchFn,
      },
    };

    await handleWeixinMessage(config, {
      message_id: "wx-context-1",
      from_user_id: "friend@im.wechat",
      create_time_ms: 1_713_000_000_000,
      item_list: [{ type: 1, text_item: { text: "我最近想研究 seedance2.0 的短剧制作经验" } }],
    });
    const result = await handleWeixinMessage(config, {
      message_id: "wx-context-2",
      from_user_id: "friend@im.wechat",
      create_time_ms: 1_713_000_060_000,
      item_list: [
        { type: 1, text_item: { text: "现在去搜索微信公众号文章，学习这方面的制作经验" } },
      ],
    });

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(
      expect.arrayContaining(["/weixin", "/ilink/bot/sendmessage"]),
    );
    expect(replies[0]).toContain("Weixin context state:");
    expect(replies[0]).toContain("status: recorded");
    expect(replies[0]).not.toContain("本轮对话已记录");
    expect(replies.at(-1)).toContain("取证来源：搜狗微信公众号文章搜索");
    expect(replies.at(-1)).toContain("要继续的话，我会优先读取上面这些来源的正文");
    expect(replies.at(-1)).not.toContain("我找到");
    expect(replies.at(-1)).not.toContain("下一步：/经验");
  });

  it("runs ComfyUI slash commands through the real runtime and labels smoke workflows clearly", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    const externalToolsDir = join(workspaceRoot, ".director-angel", "external-tools");
    const workflowPath = join(workspaceRoot, "smoke-workflow.json");
    const outputDir = join(workspaceRoot, ".director-angel", "outputs", "comfyui");
    mkdirSync(externalToolsDir, { recursive: true });
    writeFileSync(
      workflowPath,
      JSON.stringify({
        "1": {
          class_type: "EmptyImage",
          inputs: { width: 512, height: 512, batch_size: 1, color: 3447003 },
        },
        "2": {
          class_type: "SaveImage",
          inputs: { images: ["1", 0], filename_prefix: "DirectorAngel_ComfyUI_Smoke" },
        },
      }),
      "utf8",
    );
    writeFileSync(
      join(externalToolsDir, "comfyui.json"),
      JSON.stringify({
        schemaVersion: "director.comfyui.v1",
        updatedAt: new Date(0).toISOString(),
        adapter: {
          enabled: true,
          mode: "local",
          baseUrl: "http://127.0.0.1:8188",
          defaultWorkflowPath: workflowPath,
          outputDir,
        },
      }),
      "utf8",
    );
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const comfyUiFetch: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/prompt")) {
        return jsonResponse({ prompt_id: "prompt-smoke" });
      }
      if (url.endsWith("/history/prompt-smoke")) {
        return jsonResponse({
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
        });
      }
      if (url.includes("/view?")) {
        return {
          ok: true,
          status: 200,
          text: async () => "smoke-image-bytes",
          arrayBuffer: async () => new TextEncoder().encode("smoke-image-bytes").buffer,
        };
      }
      return jsonResponse({}, 404);
    };

    const result = await handleWeixinMessage(
      {
        home,
        workspaceRoot,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        apiProviderFetch: comfyUiFetch,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: false,
          autoStartRun: false,
          fetchFn,
        },
      },
      {
        message_id: "wx-comfyui-smoke",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "/comfyui 一只小猫在公园旅行" } }],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/prompt",
      "/history/prompt-smoke",
      "/view",
      "/ilink/bot/sendmessage",
    ]);
    expect(replies.at(-1)).toContain("ComfyUI 已真实执行");
    expect(replies.at(-1)).toContain("连通性验证");
    expect(replies.at(-1)).not.toContain("已生成");
  });

  it("returns the ComfyUI interface URL from Weixin without submitting a workflow", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-comfyui-open-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-comfyui-open-"));
    roots.push(workspaceRoot, home);
    const externalToolsDir = join(workspaceRoot, ".director-angel", "external-tools");
    mkdirSync(externalToolsDir, { recursive: true });
    writeFileSync(
      join(externalToolsDir, "comfyui.json"),
      JSON.stringify({
        schemaVersion: "director.comfyui.v1",
        updatedAt: new Date(0).toISOString(),
        adapter: {
          enabled: true,
          mode: "local",
          baseUrl: "http://127.0.0.1:8188",
        },
      }),
      "utf8",
    );
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const comfyUiFetch: FetchLike = async (url) => {
      calls.push({ url });
      throw new Error("opening the ComfyUI UI from Weixin must not call the ComfyUI API");
    };

    const result = await handleWeixinMessage(
      {
        home,
        workspaceRoot,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        apiProviderFetch: comfyUiFetch,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: false,
          autoStartRun: false,
          fetchFn,
        },
      },
      {
        message_id: "wx-comfyui-open",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "/comfyui 打开界面" } }],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/ilink/bot/sendmessage"]);
    expect(replies.at(-1)).toContain("ComfyUI 界面地址：http://127.0.0.1:8188");
    expect(replies.at(-1)).toContain("不会提交 workflow");
  });

  it("creates a visible ComfyUI script workflow from Weixin without submitting a workflow", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-comfyui-draft-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-comfyui-draft-"));
    roots.push(workspaceRoot, home);
    writeWeixinRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "knowledgeRecall.enabled": true,
      "memory.enabled": true,
    });
    await writeWeixinPublishedKnowledgeFixture(workspaceRoot);
    writeWeixinLongTermMemoryFixture(workspaceRoot);
    writeWeixinSkillSnapshotFixture(workspaceRoot);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const comfyUiFetch: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/v1/chat/completions")) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "Angel 已根据经验生成小猪游泳脚本：一个小猪学习游泳的30秒故事。",
              },
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 12 },
        });
      }
      if (url.endsWith("/prompt")) {
        throw new Error("creating a ComfyUI workflow draft from Weixin must not submit /prompt");
      }
      if (url.includes("/userdata/")) {
        return jsonResponse({
          path: "workflows/DirectorAngel/comfyui-script-1777300000000-draft.json",
          size: 4096,
          modified: 1_777_300_000_000,
        });
      }
      throw new Error(`unexpected ComfyUI URL ${url}`);
    };

    const result = await handleWeixinMessage(
      {
        home,
        workspaceRoot,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        apiProviderFetch: comfyUiFetch,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: false,
          autoStartRun: false,
          fetchFn,
        },
      },
      {
        message_id: "wx-comfyui-draft",
        from_user_id: "friend@im.wechat",
        item_list: [
          {
            type: 1,
            text_item: {
              text: "/ComfyUI 脚本 一个小猪学习游泳的30秒故事",
            },
          },
        ],
      },
    );

    const workflowRoot = join(
      workspaceRoot,
      ".director-angel",
      "external-tools",
      "comfyui-workflows",
    );
    const draftFiles = readdirSync(workflowRoot);
    const draft = JSON.parse(readFileSync(join(workflowRoot, draftFiles[0] ?? ""), "utf8"));
    const providerBody = JSON.parse(
      calls.find((call) => call.url.endsWith("/v1/chat/completions"))?.body ?? "{}",
    );
    const providerSystem = providerBody.messages?.find(
      (message: { role?: string }) => message.role === "system",
    )?.content;
    const providerUser = providerBody.messages?.find(
      (message: { role?: string }) => message.role === "user",
    )?.content;

    expect(result).toBe("sent");
    expect(
      new URL(calls.find((call) => call.url.includes("/userdata/"))?.url ?? "").pathname,
    ).toContain("/userdata/");
    expect(calls.some((call) => new URL(call.url).pathname === "/ilink/bot/sendmessage")).toBe(
      true,
    );
    expect(calls.find((call) => call.url.includes("/userdata/"))?.url).toMatch(
      /^http:\/\/127\.0\.0\.1:8188\/userdata\/workflows%2FDirectorAngel%2Fcomfyui-script-\d+-[a-z0-9-]+\.json\?overwrite=true&full_info=true$/u,
    );
    expect(
      JSON.parse(calls.find((call) => call.url.includes("/userdata/"))?.body ?? "{}"),
    ).toMatchObject({
      version: 0.4,
      nodes: expect.arrayContaining([
        expect.objectContaining({
          type: "PrimitiveStringMultiline",
          widgets_values: [expect.stringContaining("一个小猪学习游泳的30秒故事")],
        }),
      ]),
    });
    expect(providerUser).toContain("Director Angel contextual recall");
    expect(providerUser).toContain("weixin-comfyui-knowledge");
    expect(providerUser).toContain("小猪游泳镜头经验");
    expect(providerUser).toContain("skill.weixin-comfyui");
    expect(providerUser).toContain("微信 ComfyUI Skill");
    expect(providerUser).toContain("Keep each scene separated");
    expect(providerSystem).toContain("Director Angel 的微信外部工具编排器");
    expect(replies.at(-1)).toContain("已创建 ComfyUI 脚本 工作流");
    expect(replies.at(-1)).toContain("目标：一个小猪学习游泳的30秒故事");
    expect(replies.at(-1)).toContain("下一步：检查节点、模型和输出目录");
    expect(replies.at(-1)).not.toContain("不会提交 /prompt");
    expect(replies.at(-1)).not.toContain("文件：");
    expect(draft).toMatchObject({
      kind: "script",
      objective: "一个小猪学习游泳的30秒故事",
      executable: false,
    });
    expect(draft.angel).toMatchObject({
      recallStatus: "hit",
      skillStatus: "hit",
      knowledgeHits: [expect.objectContaining({ id: "weixin-comfyui-knowledge" })],
      skillHits: [expect.objectContaining({ id: "skill.weixin-comfyui" })],
    });
    expect(JSON.stringify(draft)).toContain("Angel output review");
    expect(JSON.stringify(draft)).toContain("Angel 生成内容");
  });

  it("creates a visible combined ComfyUI workflow from Weixin with script image video modes", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-comfyui-combo-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-comfyui-combo-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const comfyUiFetch: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/v1/chat/completions")) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "Angel 已生成 3 个场景的小猪游泳脚本、图片提示词和视频提示词。",
              },
            },
          ],
          usage: { prompt_tokens: 22, completion_tokens: 14 },
        });
      }
      if (url.endsWith("/prompt")) {
        throw new Error("creating a ComfyUI workflow draft from Weixin must not submit /prompt");
      }
      if (url.includes("/userdata/")) {
        return jsonResponse({
          path: "workflows/DirectorAngel/comfyui-script-1777300000000-draft.json",
          size: 4096,
          modified: 1_777_300_000_000,
        });
      }
      throw new Error(`unexpected ComfyUI URL ${url}`);
    };

    const result = await handleWeixinMessage(
      {
        home,
        workspaceRoot,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        apiProviderFetch: comfyUiFetch,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: false,
          autoStartRun: false,
          fetchFn,
        },
      },
      {
        message_id: "wx-comfyui-combo",
        from_user_id: "friend@im.wechat",
        item_list: [
          {
            type: 1,
            text_item: {
              text: "/ComfyUI 脚本+图片+视频 一个小猪学习游泳的30秒故事",
            },
          },
        ],
      },
    );

    const workflowRoot = join(
      workspaceRoot,
      ".director-angel",
      "external-tools",
      "comfyui-workflows",
    );
    const draftFiles = readdirSync(workflowRoot);
    const draft = JSON.parse(readFileSync(join(workflowRoot, draftFiles[0] ?? ""), "utf8"));
    const visibleWorkflow = JSON.parse(
      calls.find((call) => call.url.includes("/userdata/"))?.body ?? "{}",
    );

    expect(result).toBe("sent");
    expect(draft).toMatchObject({
      kind: "script",
      workflowModes: ["script", "image", "video"],
      objective: "一个小猪学习游泳的30秒故事",
    });
    expect(visibleWorkflow.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "PreviewAny" }),
        expect.objectContaining({ type: "WanTextToImageApi" }),
        expect.objectContaining({ type: "SaveImage" }),
        expect.objectContaining({ type: "Wan2ImageToVideoApi" }),
        expect.objectContaining({ type: "SaveVideo" }),
        expect.objectContaining({ title: "场景 1 图片提示词" }),
        expect.objectContaining({ title: "场景 2 图片提示词" }),
        expect.objectContaining({ title: "场景 3 图片提示词" }),
      ]),
    );
    const visibleNodeTypes = visibleWorkflow.nodes.map((node: { type?: string }) => node.type);
    expect(
      visibleNodeTypes.filter((type: string | undefined) => type === "WanTextToImageApi"),
    ).toHaveLength(3);
    expect(
      visibleNodeTypes.filter((type: string | undefined) => type === "Wan2ImageToVideoApi"),
    ).toHaveLength(3);
    expect(
      visibleNodeTypes.filter((type: string | undefined) => type === "WanTextToVideoApi"),
    ).toHaveLength(0);
    const sceneCountParameter = visibleWorkflow.extra.directorAngel.toolParameters.find(
      (item: { name?: string }) => item.name === "scene_count",
    );
    expect(sceneCountParameter).toMatchObject({ value: 3 });
    expect(replies.at(-1)).toContain("脚本+图片+视频");
    expect(replies.at(-1)).toContain("目标：一个小猪学习游泳的30秒故事");
    expect(replies.at(-1)).not.toContain("/prompt");
    expect(replies.at(-1)).not.toContain("文件：");
  });

  it("does not treat non-run status commands as active run status", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    savePeerSession(home, account.normalizedAccountId, "friend@im.wechat", {
      peerId: "friend@im.wechat",
      entrySessionId: "entry-active",
      runId: "run-active",
      lastObjective: "制作一个小猫旅游记",
      pendingApprovalAssignmentIds: [],
      updatedAt: new Date().toISOString(),
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/v1/experience/candidates")) {
        return jsonResponse({
          experienceCandidates: [{ candidateId: "exp-active", title: "活跃任务外的经验" }],
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };

    const result = await handleWeixinMessage(
      {
        home,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-exp-list-active",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "/经验" } }],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/experience/candidates",
      "/ilink/bot/sendmessage",
    ]);
    expect(calls.at(-1)?.body).toContain("经验候选 1 条");
    expect(calls.some((call) => new URL(call.url).pathname.includes("/status"))).toBe(false);
  });

  it("answers Weixin capability help locally without calling model or Host API", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      throw new Error(`unexpected url ${url}`);
    };

    const result = await handleWeixinMessage(
      {
        home,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-capability-help",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "/能力" } }],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/ilink/bot/sendmessage"]);
    const reply = sentText(calls[0]?.body);
    expect(reply).toContain("微信端可用能力");
    expect(reply).toContain("/学习链接");
    expect(reply).toContain("/经验 列表");
    expect(reply).toContain("/知识 召回");
    expect(reply).toContain("/技能 列表");
    expect(reply).toContain("/制作");
    expect(reply).toContain("/运行 状态");
    expect(reply).toContain("需要桌面端在线");
    expect(reply).not.toContain("status:");
    expect(reply).not.toContain("<learning-evidence-context>");
  });

  it("answers general Weixin system status without hijacking active run status", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-workspace-"));
    roots.push(workspaceRoot);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    savePeerSession(home, account.normalizedAccountId, "friend@im.wechat", {
      peerId: "friend@im.wechat",
      entrySessionId: "entry-active",
      runId: "run-active",
      lastObjective: "制作一个小猫旅游记",
      pendingApprovalAssignmentIds: ["assignment-shot"],
      updatedAt: new Date().toISOString(),
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      throw new Error(`unexpected url ${url}`);
    };

    const result = await handleWeixinMessage(
      {
        home,
        workspaceRoot,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-system-status",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "/状态" } }],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/ilink/bot/sendmessage"]);
    const reply = sentText(calls[0]?.body);
    expect(reply).toContain("微信网关");
    expect(reply).toContain("Host API");
    expect(reply).toContain("桌面浏览器桥");
    expect(reply).toContain("模型通道");
    expect(reply).toContain("memefast-api");
    expect(reply).toContain("director-text");
    expect(reply).toContain("制作运行");
    expect(reply).not.toContain("status:");
    expect(reply).not.toContain("/v1/");
    expect(reply).not.toContain("run-active");
  });

  it("projects Host API providerMatrix in Weixin system status when enabled", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-workspace-"));
    roots.push(workspaceRoot);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.includes("/v1/tools/effective?")) {
        return jsonResponse({
          schemaVersion: "director.external-tools.effective.v1",
          providerMatrix: {
            providers: [
              {
                providerId: "x-twitter",
                status: "needs-auth",
                health: { status: "needs-auth", summary: "X provider needs credentials." },
                invokableToolCount: 0,
                toolCount: 1,
                capabilities: [{ id: "x.search" }],
                lastKnownGood: { status: "ready", summary: "X was ready.", checkedAtMs: 100 },
              },
            ],
          },
          tools: [],
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      throw new Error(`unexpected url ${url}`);
    };

    const result = await handleWeixinMessage(
      {
        home,
        workspaceRoot,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        useHostToolControlPlane: true,
        fetchFn,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-system-status-provider-matrix",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "/状态" } }],
      },
    );

    expect(result).toBe("sent");
    const reply = sentText(calls.at(-1)?.body);
    expect(reply).toContain("工具供应方");
    expect(reply).toContain("x-twitter");
    expect(reply).toContain("需授权");
    expect(reply).toContain("最近可用");
    expect(reply).not.toContain("/v1/tools/effective");
  });

  it("answers Weixin learning status with text evidence and background learning summary", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-workspace-"));
    roots.push(workspaceRoot);
    const dbPath = join(
      workspaceRoot,
      ".hotflow",
      "conversation-runtime",
      "background-runtime.sqlite",
    );
    process.env.DIRECTOR_DESKTOP_BACKGROUND_RUNTIME_DB_PATH = dbPath;
    const scheduleStore = createSQLiteConversationRuntimeBackgroundJobScheduleStore({ dbPath });
    const backgroundJobStore = createSQLiteConversationRuntimeBackgroundJobStore({ dbPath });
    scheduleStore.upsert({
      scheduleId: "role-learning:director:daily",
      sessionKey: "role:director:learning",
      title: "导演每日学习",
      objective: "围绕导演岗位学习高质量 AI 制作资料。",
      schedule: { kind: "every", everyMs: 86_400_000, anchorMs: 1_000 },
      state: { lastRunAtMs: 2_000, nextRunAtMs: 88_400_000, lastJobId: "job-role-learning" },
      sourceRefs: ["https://example.test/director-ai-workflow"],
      metadata: {
        scheduledLearning: true,
        roleId: "director",
        roleTitle: "导演 Angel",
        learningScope: ["短剧制作", "AI 分镜"],
        candidateOnly: true,
        autoPublish: false,
      },
    });
    backgroundJobStore.upsert(
      createConversationRuntimeBackgroundJobTask({
        jobId: "job-role-learning",
        sessionKey: "role:director:learning",
        title: "导演每日学习",
        objective: "围绕导演岗位学习高质量 AI 制作资料，只生成待审经验候选。",
        trigger: { kind: "schedule", scheduleRef: "role-learning:director:daily" },
        allowedTools: ["web_extract", "director.learning.url", "director.learning.admit"],
        allowedCapabilities: ["learning"],
        sourceRefs: ["https://example.test/director-ai-workflow"],
        evidenceRefIds: ["learning-artifact:director-daily"],
        metadata: {
          scheduledLearning: true,
          roleId: "director",
          roleTitle: "导演 Angel",
          learningScope: ["短剧制作", "AI 分镜"],
          candidateOnly: true,
          autoPublish: false,
        },
        createdAtMs: 1_000,
      }).record,
    );
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    createFileLearningArtifactStore({
      path: join(workspaceRoot, ".hotflow", "conversation-runtime", "learning-artifacts.json"),
    }).upsertArtifact(
      createLearningArtifact({
        artifactId: "learning-artifact-shot-guide",
        sessionKey: "weixin:bot-im.bot:friend@im.wechat",
        turnRunId: "turn-shot-guide",
        sourceSurface: "weixin",
        sourceKind: "url",
        sourceRef: "https://example.test/shot-guide",
        roleScope: {
          roleName: "导演 Angel",
          domain: "影视制作",
          responsibilityTags: ["短剧制作", "AI 分镜"],
        },
        evidenceRefs: ["tool-evidence-shot-guide", "source-1"],
        pendingConfirmationId: "learning-confirmation-shot-guide",
        observedAtMs: 3_000,
        metadata: {
          candidateCount: 1,
          candidates: [
            {
              candidateId: "exp-1",
              title: "镜头语言资料",
              summary: "先明确人物目标、冲突变化和每个镜头的信息功能。",
            },
          ],
          evidenceSnapshots: [{ id: "tool-evidence-shot-guide" }],
        },
      }),
    );
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      throw new Error(`unexpected url ${url}`);
    };

    const result = await handleWeixinMessage(
      {
        home,
        workspaceRoot,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-learning-status",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "/学习 状态" } }],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/ilink/bot/sendmessage"]);
    const reply = sentText(calls[0]?.body);
    expect(reply).toContain("学习状态");
    expect(reply).toContain("最近学习：url");
    expect(reply).toContain("https://example.test/shot-guide");
    expect(reply).toContain("候选：1 条");
    expect(reply).toContain("证据：2 条");
    expect(reply).toContain("证据编号：tool-evidence-shot-guide");
    expect(reply).toContain("读取状态：已读取");
    expect(reply).toContain("待审");
    expect(reply).toContain("后台学习：");
    expect(reply).toContain("只生成候选");
    expect(reply).not.toContain("status:");
    expect(reply).not.toContain("record_json");
    expect(reply).not.toContain("conversation_runtime_background_jobs");
  });

  it("turns romanticized trafficking production requests into a safe dialogue before creating a run", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/entry/message")) {
        return jsonResponse({
          session: {
            entrySessionId: "entry-safe-1",
            state: "ready_for_blueprint",
            nextAction: "blueprint",
          },
          turn: { summary: "安全改写后的15秒短剧分镜蓝图" },
          intake: {
            alignmentLock: {
              objective: "山村拐卖婚姻题材；立场：批判拐卖；结局：脱困与追责",
              notes: [],
            },
          },
        });
      }
      if (url.endsWith("/v1/entry/sessions/entry-safe-1/blueprint")) {
        return jsonResponse({
          session: {
            entrySessionId: "entry-safe-1",
            state: "ready_for_run",
            nextAction: "run",
          },
          blueprint: {
            blueprintId: "blueprint-safe-1",
            actionGraph: { nodes: [] },
          },
        });
      }
      if (url.endsWith("/v1/entry/sessions/entry-safe-1/runs")) {
        return jsonResponse(
          {
            session: {
              entrySessionId: "entry-safe-1",
              state: "ready_for_run",
              nextAction: "run",
            },
            run: { runId: "run-safe-1", status: "running", assignments: [] },
          },
          201,
        );
      }
      if (url.endsWith("/v1/runs/run-safe-1/start")) {
        return jsonResponse({ runId: "run-safe-1", status: "running" });
      }
      if (url.endsWith("/v1/entry/sessions/entry-safe-1/status")) {
        return jsonResponse({
          session: {
            entrySessionId: "entry-safe-1",
            state: "run_in_progress",
            nextAction: "wait",
          },
          run: { runId: "run-safe-1", status: "running" },
        });
      }
      if (url.endsWith("/v1/runs/run-safe-1")) {
        return jsonResponse({
          runId: "run-safe-1",
          status: "running",
          assignments: [],
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(String(init?.body ?? ""));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const config = {
      home,
      account,
      dmPolicy: "allowlist" as const,
      allowedUsers: ["friend@im.wechat"],
      fetchFn,
      director: {
        hostApiUrl: "http://127.0.0.1:3201",
        hostId: "personal-weixin",
        agentId: "director",
        channel: "personal-weixin",
        autoAdvance: true,
        autoStartRun: true,
        fetchFn,
      },
    };

    await handleWeixinMessage(config, {
      message_id: "wx-unsafe-1",
      from_user_id: "friend@im.wechat",
      item_list: [
        {
          type: 1,
          text_item: {
            text: "/制作 生成一个15秒短剧分镜蓝图，主题：山村拐卖婚姻，最终爱情美满",
          },
        },
      ],
    });

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/ilink/bot/sendmessage"]);
    expect(replies.at(-1)).toContain("不能写成");
    expect(replies.at(-1)).toContain("确认改写");
    expect(replies.at(-1)).toContain("批判拐卖");
    const pending = loadPeerSession(home, account.normalizedAccountId, "friend@im.wechat");
    expect(pending?.pendingSafeRewriteObjective).toContain("脱困与追责");

    calls.splice(0);
    replies.splice(0);
    await handleWeixinMessage(config, {
      message_id: "wx-unsafe-2",
      from_user_id: "friend@im.wechat",
      item_list: [{ type: 1, text_item: { text: "确认改写" } }],
    });

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/entry/message",
      "/v1/entry/sessions/entry-safe-1/blueprint",
      "/v1/entry/sessions/entry-safe-1/runs",
      "/v1/runs/run-safe-1/start",
      "/v1/entry/sessions/entry-safe-1/status",
      "/v1/runs/run-safe-1",
      "/v1/entry/sessions/entry-safe-1/status",
      "/ilink/bot/sendmessage",
    ]);
    const entryBody = calls[0]?.body ?? "";
    expect(entryBody).toContain("批判拐卖");
    expect(entryBody).toContain("安全边界");
    expect(entryBody).not.toContain("爱情美满");
    expect(replies.at(-1)).toContain("已按批判、脱困和追责方向改写");
    expect(replies.at(-1)).not.toContain("蓝图：");
    expect(replies.at(-1)).not.toContain("Run：");
    expect(replies.at(-1)).not.toContain("自动批准");
    const saved = loadPeerSession(home, account.normalizedAccountId, "friend@im.wechat");
    expect(saved?.pendingSafeRewriteObjective).toBeUndefined();
    expect(saved?.runId).toBe("run-safe-1");
  });

  it("shows content policy details in developer debug mode without creating a run", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const runtimeRoot = join(home, ".director-angel", "runtime");
    mkdirSync(runtimeRoot, { recursive: true });
    writeFileSync(
      join(runtimeRoot, "switches.json"),
      JSON.stringify({
        schemaId: "director.switches.v1",
        features: {
          "contentSafety.developerDebug.enabled": true,
        },
      }),
      "utf8",
    );
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(String(init?.body ?? ""));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };

    await handleWeixinMessage(
      {
        home,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-debug-unsafe-1",
        from_user_id: "friend@im.wechat",
        item_list: [
          {
            type: 1,
            text_item: {
              text: "/制作 生成一个15秒短剧分镜蓝图，主题：山村拐卖婚姻，最终爱情美满",
            },
          },
        ],
      },
    );

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/ilink/bot/sendmessage"]);
    expect(replies.at(-1)).toContain("开发者调试");
    expect(replies.at(-1)).toContain("content.humanTrafficking.romanticized");
    expect(replies.at(-1)).toContain("floor=hard");
    expect(replies.at(-1)).toContain("canOverride=false");
    expect(replies.at(-1)).toContain("批判拐卖");
  });

  it("uses the saved peer run when confirming execution instead of creating a new message task", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const workerCalls: Array<{ runId: string; workerId: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/entry/message")) {
        return jsonResponse({
          session: {
            entrySessionId: "entry-1",
            state: "ready_for_blueprint",
            nextAction: "blueprint",
          },
          turn: { summary: "生成一个15秒短剧分镜蓝图" },
          intake: {
            alignmentLock: { objective: "生成一个15秒短剧分镜蓝图", notes: [] },
          },
        });
      }
      if (url.endsWith("/v1/entry/sessions/entry-1/blueprint")) {
        return jsonResponse({
          session: {
            entrySessionId: "entry-1",
            state: "ready_for_run",
            nextAction: "run",
          },
          blueprint: {
            blueprintId: "blueprint-1",
            actionGraph: {
              nodes: [
                {
                  assignmentId: "assignment-researcher",
                  role: "researcher",
                  deliverable: "Research brief",
                  approvalMode: "auto_allow",
                },
                {
                  assignmentId: "assignment-script",
                  role: "script-planner",
                  deliverable: "Story outline",
                  approvalMode: "operator_approve",
                },
                {
                  assignmentId: "assignment-shot",
                  role: "shot-planner",
                  deliverable: "Shot plan",
                  approvalMode: "operator_approve",
                },
              ],
            },
          },
        });
      }
      if (url.endsWith("/v1/entry/sessions/entry-1/runs")) {
        return jsonResponse(
          {
            session: {
              entrySessionId: "entry-1",
              state: "ready_for_run",
              nextAction: "run",
            },
            run: {
              runId: "run-1",
              status: "running",
              assignments: [
                {
                  assignmentId: "assignment-script",
                  status: "pending",
                  approvalMode: "operator_approve",
                  role: "script-planner",
                },
                {
                  assignmentId: "assignment-shot",
                  status: "pending",
                  approvalMode: "operator_approve",
                  role: "shot-planner",
                },
              ],
            },
          },
          201,
        );
      }
      if (url.endsWith("/v1/runs/run-1/start")) {
        return jsonResponse({ runId: "run-1", status: "running" });
      }
      if (url.endsWith("/v1/runs/run-1")) {
        return jsonResponse({
          runId: "run-1",
          status: "running",
          assignments: [
            {
              assignmentId: "assignment-script",
              status: "pending",
              approvalMode: "operator_approve",
              role: "script-planner",
            },
            {
              assignmentId: "assignment-shot",
              status: "pending",
              approvalMode: "operator_approve",
              role: "shot-planner",
            },
          ],
        });
      }
      if (url.endsWith("/v1/runs/run-1/approve")) {
        return jsonResponse({
          runId: "run-1",
          status: "running",
          assignments: [],
        });
      }
      if (url.endsWith("/v1/client-runtime/tasks/run-1/followup")) {
        return jsonResponse({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.client-runtime-followup.v1",
          clientRuntimeFollowup: {
            schemaVersion: "director.client-runtime.followup.v1",
            clientSurface: "weixin",
            originRuntime: "host.executionRun",
            accepted: true,
            status: "running",
            continued: 1,
            taskIds: ["run-1"],
            approvedAssignmentIds: ["assignment-script", "assignment-shot"],
          },
          run: { runId: "run-1", status: "running", assignments: [] },
        });
      }
      if (url.endsWith("/v1/entry/sessions/entry-1/status")) {
        return jsonResponse({
          session: {
            entrySessionId: "entry-1",
            state: "run_in_progress",
            nextAction: "wait",
          },
          run: { runId: "run-1", status: "running" },
          report: {
            reportId: "report-run-1",
            operatorSurface: {
              operatorSummary: "已批准待审环节，等待 worker 推进。",
              nextAction: "继续推进 run",
            },
          },
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const config = {
      home,
      account,
      dmPolicy: "allowlist" as const,
      allowedUsers: ["friend@im.wechat"],
      fetchFn,
      runWorkerOnce: async (input) => {
        workerCalls.push(input);
        return {
          run: { runId: input.runId, status: "completed" },
          executedAssignments: ["assignment-researcher", "assignment-script", "assignment-shot"],
          report: {
            reportId: `report-${input.runId}`,
            flags: ["preview-only"],
            summary: [
              "run status=completed",
              "assignments total=3 ready=0 pending=0 running=0 completed=3 failed=0 blocked=0",
            ],
          },
        };
      },
      director: {
        hostApiUrl: "http://127.0.0.1:3201",
        hostId: "personal-weixin",
        agentId: "director",
        channel: "personal-weixin",
        autoAdvance: true,
        autoStartRun: true,
        fetchFn,
      },
    };

    await handleWeixinMessage(config, {
      message_id: "wx-msg-1",
      from_user_id: "friend@im.wechat",
      item_list: [{ type: 1, text_item: { text: "/production 生成一个15秒短剧分镜蓝图" } }],
    });
    calls.splice(0);
    workerCalls.splice(0);

    const result = await handleWeixinMessage(config, {
      message_id: "wx-msg-2",
      from_user_id: "friend@im.wechat",
      item_list: [{ type: 1, text_item: { text: "确认执行" } }],
    });

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/client-runtime/tasks/run-1/followup",
      "/ilink/bot/sendmessage",
    ]);
    expect(workerCalls).toEqual([]);
    expect(calls.some((call) => new URL(call.url).pathname === "/v1/entry/message")).toBe(false);
    expect(calls.at(-1)?.body).toContain("已继续");
    expect(calls.at(-1)?.body).toContain("已确认 2 个待审环节");
    expect(calls.at(-1)?.body).not.toContain("已完成 3/3");
    expect(calls.at(-1)?.body).not.toContain("Run：");
    expect(calls.at(-1)?.body).not.toContain("已推进执行环节");
  });

  it("answers active run status from the saved session without creating a new Director task", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    savePeerSession(home, account.normalizedAccountId, "friend@im.wechat", {
      peerId: "friend@im.wechat",
      entrySessionId: "entry-status-1",
      runId: "run-status-1",
      lastObjective: "制作一个小猫旅游记",
      pendingApprovalAssignmentIds: ["assignment-script", "assignment-shot"],
      updatedAt: new Date().toISOString(),
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/v1/entry/sessions/entry-status-1/status")) {
        return jsonResponse({
          session: {
            entrySessionId: "entry-status-1",
            state: "run_in_progress",
            nextAction: "wait",
          },
          run: { runId: "run-status-1", status: "running" },
          report: {
            reportId: "report-status-1",
            operatorSurface: {
              operatorSummary: "小猫旅行记正在等待你确认分镜。",
            },
          },
        });
      }
      if (url.endsWith("/v1/client-runtime/tasks/run-status-1?clientSurface=weixin")) {
        return jsonResponse({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.client-runtime-task.v1",
          clientRuntimeTask: {
            schemaVersion: "director.client-runtime.task.v1",
            clientSurface: "weixin",
            id: "run-status-1",
            label: "制作一个小猫旅游记",
            artifactLabel: "小猫旅行记正在等待你确认分镜。",
            status: "running",
            originRuntime: "host.executionRun",
            payload: {
              previewSummary: "小猫旅行记正在等待你确认分镜。",
              statusWarningSummary: "运行可能卡住：已 2分钟 无新事件；正在执行 分镜审核。",
            },
            controls: { read: true, stop: true, steer: false, followup: true },
          },
          run: { runId: "run-status-1", status: "running" },
        });
      }
      if (url.endsWith("/v1/runs/run-status-1/delegations")) {
        return jsonResponse({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.run-delegations.v1",
          runId: "run-status-1",
          subagentAnnounceCount: 0,
          subagentAnnounces: [],
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };

    const result = await handleWeixinMessage(
      {
        home,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-msg-status",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "/运行 状态" } }],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/client-runtime/tasks/run-status-1",
      "/ilink/bot/sendmessage",
      "/v1/runs/run-status-1/delegations",
    ]);
    const replyBody = calls.find((call) => call.url.endsWith("/ilink/bot/sendmessage"))?.body;
    expect(replyBody).toContain("制作一个小猫旅游记");
    expect(replyBody).toContain("运行中");
    expect(replyBody).toContain("待确认 2 个环节");
    expect(replyBody).toContain("正在等待你确认分镜");
    expect(replyBody).toContain("运行可能卡住");
    expect(replyBody).not.toContain("Conversation run has had no activity");
  });

  it("derives Weixin run status warnings from unified context compaction events", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-context-status-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    savePeerSession(home, account.normalizedAccountId, "friend@im.wechat", {
      peerId: "friend@im.wechat",
      runId: "run-context-1",
      lastObjective: "统一桌面和微信的运行状态",
      pendingApprovalAssignmentIds: [],
      updatedAt: new Date().toISOString(),
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/v1/client-runtime/tasks/run-context-1?clientSurface=weixin")) {
        return jsonResponse({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.client-runtime-task.v1",
          clientRuntimeTask: {
            schemaVersion: "director.client-runtime.task.v1",
            clientSurface: "weixin",
            id: "run-context-1",
            label: "统一桌面和微信的运行状态",
            status: "running",
            originRuntime: "desktop.taskRuntime",
            payload: {
              previewSummary: "正在整理统一运行状态。",
              runtimeEventsV1: [
                {
                  schemaVersion: "conversation-runtime.event.v1",
                  kind: "context.compaction.partial_saved",
                  eventId: "turn-context:000008:context.compaction.partial_saved",
                  occurredAtMs: 4200,
                  payload: {
                    checkpointId: "context-checkpoint-1",
                    summaryPreview: "已保留统一调度要求。",
                    reason: "provider-timeout",
                  },
                },
              ],
            },
            controls: { read: true, stop: true, steer: false, followup: true },
          },
          run: { runId: "run-context-1", status: "running" },
        });
      }
      if (url.endsWith("/v1/runs/run-context-1/delegations")) {
        return jsonResponse({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.run-delegations.v1",
          runId: "run-context-1",
          subagentAnnounceCount: 0,
          subagentAnnounces: [],
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };

    const result = await handleWeixinMessage(
      {
        home,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-msg-context-status",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "/运行 状态" } }],
      },
    );

    expect(result).toBe("sent");
    const replyBody = calls.find((call) => call.url.endsWith("/ilink/bot/sendmessage"))?.body;
    expect(replyBody).toContain("上下文已保留部分摘要");
    expect(replyBody).toContain("context-checkpoint-1");
    expect(replyBody).not.toContain("context.compaction.partial_saved");
  });

  it("delivers Host API subagent completion announces to the saved Weixin session once", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-subagent-announce-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    savePeerSession(home, account.normalizedAccountId, "friend@im.wechat", {
      peerId: "friend@im.wechat",
      entrySessionId: "entry-announce-1",
      runId: "run-announce-1",
      lastObjective: "后台整理本轮 U3 runner 证据",
      pendingApprovalAssignmentIds: [],
      updatedAt: new Date().toISOString(),
    });
    const replies: string[] = [];
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/v1/entry/sessions/entry-announce-1/status")) {
        return jsonResponse({
          session: {
            entrySessionId: "entry-announce-1",
            state: "run_in_progress",
            nextAction: "wait",
          },
          run: { runId: "run-announce-1", status: "running" },
        });
      }
      if (url.endsWith("/v1/runs/run-announce-1/delegations")) {
        return jsonResponse({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.run-delegations.v1",
          runId: "run-announce-1",
          subagentAnnounceCount: 2,
          subagentAnnounces: [
            {
              announceId: "announce_weixin_done",
              subagentId: "subagent_weixin_done",
              requesterSessionKey: `weixin:${account.normalizedAccountId}:friend@im.wechat`,
              requesterOrigin: "weixin",
              deliveryTarget: "friend@im.wechat",
              status: "completed",
              summary: "已经整理完证据。",
              userFacingText: "后台子代理已完成：后台整理证据\n结果：已经整理完证据。",
              updatedAtMs: 1_765_000_000_000,
            },
            {
              announceId: "announce_other_peer",
              subagentId: "subagent_other_peer",
              requesterSessionKey: "weixin:other-account:other-peer",
              requesterOrigin: "weixin",
              deliveryTarget: "other-peer",
              status: "completed",
              summary: "不属于当前会话。",
              userFacingText: "后台子代理已完成：别人的任务\n结果：不应该投递。",
              updatedAtMs: 1_765_000_000_001,
            },
          ],
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const config = {
      home,
      account,
      dmPolicy: "allowlist" as const,
      allowedUsers: ["friend@im.wechat"],
      fetchFn,
      director: {
        hostApiUrl: "http://127.0.0.1:3201",
        hostId: "personal-weixin",
        agentId: "director",
        channel: "personal-weixin",
        autoAdvance: true,
        autoStartRun: true,
        fetchFn,
      },
    };

    await handleWeixinMessage(config, {
      message_id: "wx-subagent-announce-status-1",
      from_user_id: "friend@im.wechat",
      item_list: [{ type: 1, text_item: { text: "/运行 状态" } }],
    });
    await handleWeixinMessage(config, {
      message_id: "wx-subagent-announce-status-2",
      from_user_id: "friend@im.wechat",
      item_list: [{ type: 1, text_item: { text: "/运行 状态" } }],
    });

    expect(replies).toEqual([
      expect.stringContaining("上一版：后台整理本轮 U3 runner 证据"),
      expect.stringContaining("后台子代理已完成：后台整理证据"),
      expect.stringContaining("上一版：后台整理本轮 U3 runner 证据"),
    ]);
    expect(replies.join("\n")).toContain("已经整理完证据");
    expect(replies.join("\n")).not.toContain("别人的任务");
    expect(
      calls.filter((call) => call.url.endsWith("/v1/runs/run-announce-1/delegations")),
    ).toHaveLength(2);
  });

  it("submits active run pause commands to the Director Host API", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    savePeerSession(home, account.normalizedAccountId, "friend@im.wechat", {
      peerId: "friend@im.wechat",
      entrySessionId: "entry-pause-1",
      runId: "run-pause-1",
      lastObjective: "制作一个小猫旅游记",
      pendingApprovalAssignmentIds: [],
      updatedAt: new Date().toISOString(),
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/v1/client-runtime/tasks/run-pause-1/stop")) {
        return jsonResponse({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.client-runtime-stop.v1",
          clientRuntimeStop: {
            schemaVersion: "director.client-runtime.stop.v1",
            clientSurface: "weixin",
            originRuntime: "host.executionRun",
            stopped: 1,
            taskIds: ["run-pause-1"],
          },
          run: { runId: "run-pause-1", status: "aborted", assignments: [] },
        });
      }
      if (url.endsWith("/v1/runs/run-pause-1/pause")) {
        return jsonResponse({ runId: "run-pause-1", status: "paused", assignments: [] });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };

    const result = await handleWeixinMessage(
      {
        home,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-msg-pause",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "/停止" } }],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/client-runtime/tasks/run-pause-1/stop",
      "/ilink/bot/sendmessage",
    ]);
    expect(calls.at(-1)?.body).toContain("已中止");
  });

  it("submits active run continue commands through the unified client runtime followup API", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-client-runtime-followup-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    savePeerSession(home, account.normalizedAccountId, "friend@im.wechat", {
      peerId: "friend@im.wechat",
      entrySessionId: "entry-followup-1",
      runId: "run-followup-1",
      lastObjective: "制作一个小猫旅游记",
      pendingApprovalAssignmentIds: ["assignment-script"],
      updatedAt: new Date().toISOString(),
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/v1/client-runtime/tasks/run-followup-1/followup")) {
        return jsonResponse({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.client-runtime-followup.v1",
          clientRuntimeFollowup: {
            schemaVersion: "director.client-runtime.followup.v1",
            clientSurface: "weixin",
            originRuntime: "host.executionRun",
            accepted: true,
            continued: 1,
            taskIds: ["run-followup-1"],
            approvedAssignmentIds: ["assignment-script"],
          },
          run: { runId: "run-followup-1", status: "running", assignments: [] },
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };

    const result = await handleWeixinMessage(
      {
        home,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-msg-client-runtime-followup",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "/运行 继续" } }],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/client-runtime/tasks/run-followup-1/followup",
      "/ilink/bot/sendmessage",
    ]);
    const followupBody = calls[0]?.body ?? "";
    expect(followupBody).toContain("weixin-run-followup");
    expect(followupBody).toContain("weixin");
    expect(sentText(calls.at(-1)?.body)).toContain("已继续");
    expect(sentText(calls.at(-1)?.body)).toContain("run-fol");
  });

  it("treats confirm-with-content as a refinement of the active run", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    savePeerSession(home, account.normalizedAccountId, "friend@im.wechat", {
      peerId: "friend@im.wechat",
      entrySessionId: "entry-old",
      runId: "run-old",
      lastObjective: "制作一个小猫旅游记",
      pendingApprovalAssignmentIds: ["assignment-old"],
      updatedAt: new Date().toISOString(),
    });
    const entryBodies: string[] = [];
    const replyBodies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      if (url.endsWith("/v1/entry/message")) {
        entryBodies.push(String(init?.body ?? ""));
        return jsonResponse({
          session: {
            entrySessionId: "entry-refined",
            state: "ready_for_blueprint",
            nextAction: "blueprint",
          },
          turn: { summary: "补充公园场景后的小猫旅游记" },
          intake: {
            alignmentLock: {
              objective: "制作一个小猫旅游记；补充内容：加上公园场景",
              notes: [],
            },
          },
        });
      }
      if (url.endsWith("/v1/entry/sessions/entry-refined/blueprint")) {
        return jsonResponse({
          session: {
            entrySessionId: "entry-refined",
            state: "ready_for_run",
            nextAction: "run",
          },
          blueprint: {
            blueprintId: "blueprint-refined",
            actionGraph: {
              nodes: [
                {
                  assignmentId: "assignment-script-refined",
                  role: "script-planner",
                  approvalMode: "operator_approve",
                },
              ],
            },
          },
        });
      }
      if (url.endsWith("/v1/entry/sessions/entry-refined/runs")) {
        return jsonResponse(
          {
            session: {
              entrySessionId: "entry-refined",
              state: "ready_for_run",
              nextAction: "run",
            },
            run: {
              runId: "run-refined",
              status: "running",
              assignments: [
                {
                  assignmentId: "assignment-script-refined",
                  status: "pending",
                  approvalMode: "operator_approve",
                  role: "script-planner",
                },
              ],
            },
          },
          201,
        );
      }
      if (url.endsWith("/v1/runs/run-refined/start")) {
        return jsonResponse({ runId: "run-refined", status: "running" });
      }
      if (url.endsWith("/v1/runs/run-refined")) {
        return jsonResponse({
          runId: "run-refined",
          status: "running",
          assignments: [
            {
              assignmentId: "assignment-script-refined",
              status: "pending",
              approvalMode: "operator_approve",
              role: "script-planner",
            },
          ],
        });
      }
      if (url.endsWith("/v1/runs/run-refined/approve")) {
        return jsonResponse({ runId: "run-refined", status: "running", assignments: [] });
      }
      if (url.endsWith("/v1/entry/sessions/entry-refined/status")) {
        return jsonResponse({
          session: {
            entrySessionId: "entry-refined",
            state: "run_in_progress",
            nextAction: "wait",
          },
          run: { runId: "run-refined", status: "running" },
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replyBodies.push(String(init?.body ?? ""));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };

    const result = await handleWeixinMessage(
      {
        home,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        runWorkerOnce: async (input) => ({
          run: { runId: input.runId, status: "completed" },
          executedAssignments: ["assignment-script-refined"],
          report: {
            reportId: `report-${input.runId}`,
            operatorSurface: {
              operatorSummary: "小猫先到公园，再和朋友玩耍，最后开心回家。",
            },
            summary: ["run status=completed"],
          },
        }),
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-msg-confirm-content",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "确认执行，内容是：加上公园场景" } }],
      },
    );

    expect(result).toBe("sent");
    expect(entryBodies).toHaveLength(1);
    expect(entryBodies[0]).toContain("制作一个小猫旅游记");
    expect(entryBodies[0]).toContain("补充内容");
    expect(entryBodies[0]).toContain("加上公园场景");
    expect(entryBodies[0]).not.toContain("目标：确认执行");
    expect(replyBodies.at(-1)).toContain("模型不可用");
    expect(replyBodies.at(-1)).toContain("不能用本地模板冒充制作结果");
    expect(replyBodies.at(-1)).not.toContain("小猫先到公园");
  });

  it("auto-executes natural production requests and includes configured provider draft output", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
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
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/v1/entry/message")) {
        return jsonResponse({
          session: {
            entrySessionId: "entry-provider-1",
            state: "ready_for_blueprint",
            nextAction: "blueprint",
          },
          turn: { summary: "生成一个15秒短剧分镜蓝图" },
          intake: {
            alignmentLock: { objective: "生成一个15秒短剧分镜蓝图", notes: [] },
          },
        });
      }
      if (url.endsWith("/v1/entry/sessions/entry-provider-1/blueprint")) {
        return jsonResponse({
          session: {
            entrySessionId: "entry-provider-1",
            state: "ready_for_run",
            nextAction: "run",
          },
          blueprint: {
            blueprintId: "blueprint-provider-1",
            actionGraph: {
              nodes: [
                {
                  assignmentId: "assignment-script",
                  role: "script-planner",
                  deliverable: "Story outline",
                  approvalMode: "operator_approve",
                },
              ],
            },
          },
        });
      }
      if (url.endsWith("/v1/entry/sessions/entry-provider-1/runs")) {
        return jsonResponse(
          {
            session: {
              entrySessionId: "entry-provider-1",
              state: "ready_for_run",
              nextAction: "run",
            },
            run: {
              runId: "run-provider-1",
              status: "running",
              assignments: [
                {
                  assignmentId: "assignment-script",
                  status: "pending",
                  approvalMode: "operator_approve",
                  role: "script-planner",
                },
              ],
            },
          },
          201,
        );
      }
      if (url.endsWith("/v1/runs/run-provider-1/start")) {
        return jsonResponse({ runId: "run-provider-1", status: "running" });
      }
      if (url.endsWith("/v1/runs/run-provider-1")) {
        return jsonResponse({
          runId: "run-provider-1",
          status: "running",
          assignments: [
            {
              assignmentId: "assignment-script",
              status: "pending",
              approvalMode: "operator_approve",
              role: "script-planner",
            },
          ],
        });
      }
      if (url.endsWith("/v1/runs/run-provider-1/approve")) {
        return jsonResponse({ runId: "run-provider-1", status: "running", assignments: [] });
      }
      if (url.endsWith("/v1/entry/sessions/entry-provider-1/status")) {
        return jsonResponse({
          session: {
            entrySessionId: "entry-provider-1",
            state: "run_in_progress",
            nextAction: "wait",
          },
          run: { runId: "run-provider-1", status: "running" },
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(String(init?.body ?? ""));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async (url, init) => {
      providerCalls.push({ url, body: init?.body });
      return jsonResponse({
        choices: [
          {
            message: {
              content: "制作判断：真实模型草案\n分镜蓝图：1 建立人物；2 推进冲突；3 形成钩子。",
            },
          },
        ],
      });
    };

    await handleWeixinMessage(
      {
        home,
        workspaceRoot,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        apiProviderFetch,
        runWorkerOnce: async (input) => ({
          run: { runId: input.runId, status: "completed" },
          executedAssignments: ["assignment-script"],
          report: {
            reportId: `report-${input.runId}`,
            flags: ["preview-only"],
            summary: [
              "run status=completed",
              "assignments total=1 ready=0 pending=0 running=0 completed=1 failed=0 blocked=0",
            ],
          },
        }),
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-provider-1",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "我制作一个15秒短剧分镜蓝图" } }],
      },
    );

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/entry/message",
      "/v1/entry/sessions/entry-provider-1/blueprint",
      "/v1/entry/sessions/entry-provider-1/runs",
      "/v1/runs/run-provider-1/start",
      "/v1/entry/sessions/entry-provider-1/status",
      "/v1/runs/run-provider-1",
      "/v1/runs/run-provider-1/approve",
      "/v1/entry/sessions/entry-provider-1/status",
      "/ilink/bot/sendmessage",
    ]);
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]?.body).toContain("director-text");
    expect(providerCalls[0]?.body).toContain("制作一个15秒短剧分镜蓝图");
    const reply = replies.at(-1) ?? "";
    expect(reply).toContain("真实模型草案");
    expect(reply).not.toContain("我先按你的目标做了一版");
    expect(reply).not.toContain("我理解的目标");
    expect(reply).not.toContain("初稿：");
    expect(reply).not.toContain("模型草案：memefast-api");
    expect(reply).not.toContain("Run：");
    expect(reply).not.toContain("蓝图：blueprint");
    expect(reply).not.toContain("本地预览");
    expect(reply).not.toContain("下一步：回复「确认执行」");
  });

  it("does not expose Host API intake templates when a natural production request has no run final", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-no-run-final-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/v1/entry/message")) {
        return jsonResponse({
          session: {
            entrySessionId: "entry-no-run-final",
            state: "ready_for_blueprint",
            nextAction: "blueprint",
          },
          turn: { summary: "制作一个15秒短剧分镜蓝图" },
          intake: {
            alignmentLock: {
              objective: "制作一个15秒短剧分镜蓝图",
              notes: [],
            },
          },
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };

    const result = await handleWeixinMessage(
      {
        home,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: false,
          autoStartRun: false,
          fetchFn,
        },
      },
      {
        message_id: "wx-no-run-final",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "/制作 制作一个15秒短剧分镜蓝图" } }],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/entry/message",
      "/ilink/bot/sendmessage",
    ]);
    expect(replies.at(-1)).toContain("Director production result:");
    expect(replies.at(-1)).toContain("status: degraded");
    expect(replies.at(-1)).toContain("production runtime returned no final text");
    expect(replies.at(-1)).not.toContain("制作入口已记录");
    expect(replies.at(-1)).not.toContain("等待模型或执行端生成结果");
    expect(replies.at(-1)).not.toContain("制作一个15秒短剧分镜蓝图");
  });

  it("keeps ordinary writing requests out of the production auto-execution lane", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-chat-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    await writeWeixinOrdinaryChatRecallFixture(workspaceRoot);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: string }> = [];
    const workerCalls: Array<{ runId: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async (url, init) => {
      providerCalls.push({ url, body: init?.body });
      return jsonResponse({
        choices: [
          {
            message: {
              content:
                "开场白：我是 Director Angel。你给我一个目标，我直接把它推进成脚本、分镜或工作流。",
            },
          },
        ],
      });
    };

    const result = await handleWeixinMessage(
      {
        home,
        workspaceRoot,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        apiProviderFetch,
        runWorkerOnce: async (input) => {
          workerCalls.push({ runId: input.runId });
          return {
            run: { runId: input.runId, status: "completed" },
            executedAssignments: [],
            report: { reportId: `report-${input.runId}`, flags: [], summary: [] },
          };
        },
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-chat-1",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "帮我写一句导演 Angel 的开场白" } }],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/ilink/bot/sendmessage"]);
    expect(workerCalls).toEqual([]);
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]?.body).toContain("统一对话运行时");
    expect(providerCalls[0]?.body).toContain("帮我写一句导演 Angel 的开场白");
    expect(providerCalls[0]?.body).toContain("weixin-chat-opening-knowledge");
    expect(providerCalls[0]?.body).toContain("Angel 微信开场白 Skill");
    expect(providerCalls[0]?.body).toContain("微信对话要结果优先");
    expect(calls.at(-1)?.body).toContain("开场白：我是 Director Angel");
  });

  it("injects optional MemPalace working memory into ordinary Weixin dynamic chat", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-mempalace-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-mempalace-home-"));
    roots.push(workspaceRoot, home);
    await writeWeixinOrdinaryChatRecallFixture(workspaceRoot);
    writeWeixinApiProviderFixture(workspaceRoot);
    const mempalaceCommand = join(workspaceRoot, "mempalace-command.mjs");
    writeFileSync(
      mempalaceCommand,
      [
        "let body = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => { body += chunk; });",
        "process.stdin.on('end', () => {",
        "  const request = JSON.parse(body);",
        "  process.stdout.write(JSON.stringify({ results: [{ id: 'weixin-opening-style', text: `MemPalace says ${request.query}: keep Weixin reply short and direct.`, similarity: 0.94, timestamp: 1777000 }] }));",
        "});",
      ].join("\n"),
      "utf8",
    );
    process.env.HOTFLOW_MEMPALACE_MODE = "optional";
    process.env.HOTFLOW_MEMPALACE_COMMAND = execPath;
    process.env.HOTFLOW_MEMPALACE_PALACE_PATH = workspaceRoot;
    process.env.HOTFLOW_MEMPALACE_COMMAND_ARGS = JSON.stringify([mempalaceCommand]);
    process.env.HOTFLOW_MEMPALACE_N_RESULTS = "2";
    process.env.HOTFLOW_MEMPALACE_TIMEOUT_MS = "5000";
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async (url, init) => {
      providerCalls.push({ url, body: init?.body });
      return jsonResponse({
        choices: [
          {
            message: {
              content: "短答：我会按你上次确认的风格继续。",
            },
          },
        ],
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
          fetchFn,
          apiProviderFetch,
          director: {
            hostApiUrl: "http://127.0.0.1:3201",
            hostId: "personal-weixin",
            agentId: "director",
            channel: "personal-weixin",
            autoAdvance: true,
            autoStartRun: true,
            fetchFn,
          },
        },
        {
          message_id: "wx-chat-mempalace",
          from_user_id: "friend@im.wechat",
          item_list: [{ type: 1, text_item: { text: "按上次那个微信开场风格继续" } }],
        },
      );

      expect(result).toBe("sent");
      expect(providerCalls).toHaveLength(1);
      expect(providerCalls[0]?.body).toContain("working-memory:mempalace:");
      expect(providerCalls[0]?.body).toContain("MemPalace says");
      expect(providerCalls[0]?.body).toContain("keep Weixin reply short and direct");
      const runStorePath = join(
        home,
        "runtime",
        "conversation-runs",
        `${account.normalizedAccountId}.json`,
      );
      const persisted = JSON.parse(readFileSync(runStorePath, "utf8")) as {
        readonly runs?: readonly { readonly metadata?: unknown }[];
      };
      expect(persisted.runs?.[0]?.metadata).toMatchObject({
        capabilityPacket: {
          hits: expect.arrayContaining([
            expect.objectContaining({
              id: "memory:working-memory:mempalace:weixin-opening-style",
              metadata: expect.objectContaining({
                providerId: "weixin-working-memory",
                providerKind: "mempalace",
                directStoreAccessAllowed: false,
              }),
            }),
          ]),
        },
      });
      expect(providerCalls[0]?.body).not.toContain("weixin-working-memory");
      expect(sentText(calls.at(-1)?.body)).toContain("短答：我会按你上次确认的风格继续。");
    } finally {
      process.env.HOTFLOW_MEMPALACE_TIMEOUT_MS = undefined;
    }
  });

  it("reports ComfyUI workflow upload failure without claiming remote sync success", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "director-weixin-comfyui-upload-failure-workspace-"),
    );
    const home = mkdtempSync(join(tmpdir(), "director-weixin-comfyui-upload-failure-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const replies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replies.push(sentText(init?.body));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const comfyUiFetch: FetchLike = async (url) => {
      if (url.endsWith("/v1/chat/completions")) {
        return jsonResponse({
          choices: [{ message: { content: "小猪游泳脚本。" } }],
        });
      }
      if (url.includes("/userdata/")) {
        return jsonResponse({ error: "ComfyUI offline" }, 503);
      }
      throw new Error(`unexpected ComfyUI URL ${url}`);
    };

    const result = await handleWeixinMessage(
      {
        home,
        workspaceRoot,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        apiProviderFetch: comfyUiFetch,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: false,
          autoStartRun: false,
          fetchFn,
        },
      },
      {
        message_id: "wx-comfyui-upload-failure",
        from_user_id: "friend@im.wechat",
        item_list: [
          {
            type: 1,
            text_item: { text: "/ComfyUI 脚本 一个小猪学习游泳的30秒故事" },
          },
        ],
      },
    );

    expect(result).toBe("sent");
    const reply = replies.at(-1) ?? "";
    expect(reply).toContain("已生成 ComfyUI 脚本 工作流，但还没同步进 ComfyUI");
    expect(reply).toContain("同步状态：ComfyUI 保存失败：HTTP 503");
    expect(reply).not.toContain("并已同步为完整 ComfyUI workflow");
  });

  it("routes low-value Weixin chatter through the unified runtime without admitting memory", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-low-chat-workspace-"));
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(workspaceRoot, home);
    writeWeixinApiProviderFixture(workspaceRoot);
    await writeWeixinOrdinaryChatRecallFixture(workspaceRoot);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const providerCalls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const apiProviderFetch: FetchLike = async (url, init) => {
      providerCalls.push({ url, body: init?.body });
      return jsonResponse({
        choices: [{ message: { content: "我在。你直接说就行。" } }],
      });
    };

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
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-low-chat-1",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "你好" } }],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/ilink/bot/sendmessage"]);
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]?.body).toContain("统一对话运行时");
    expect(providerCalls[0]?.body).toContain("不要把普通闲聊");
    expect(calls.at(-1)?.body).toContain("你直接说就行");
  });

  it("folds natural supplement details into the previous objective instead of treating them as a new target", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const entryBodies: string[] = [];
    const replyBodies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      if (url.endsWith("/v1/entry/message")) {
        entryBodies.push(String(init?.body ?? ""));
        const isRefined = entryBodies.length > 1;
        return jsonResponse({
          session: {
            entrySessionId: "entry-1",
            state: "ready_for_blueprint",
            nextAction: "blueprint",
          },
          turn: { summary: isRefined ? "生成一个15秒短剧分镜蓝图" : "初始制作目标" },
          intake: {
            alignmentLock: {
              objective: isRefined
                ? "生成一个15秒短剧分镜蓝图；补充内容：山村题材，批判强迫婚姻。"
                : "生成一个15秒短剧分镜蓝图",
              notes: [],
            },
          },
        });
      }
      if (url.endsWith("/v1/entry/sessions/entry-1/blueprint")) {
        return jsonResponse({
          session: {
            entrySessionId: "entry-1",
            state: "ready_for_run",
            nextAction: "run",
          },
          blueprint: {
            blueprintId: `blueprint-${entryBodies.length}`,
            actionGraph: {
              nodes: [
                {
                  assignmentId: `assignment-script-${entryBodies.length}`,
                  role: "script-planner",
                  deliverable: "Story outline",
                  approvalMode: "operator_approve",
                },
              ],
            },
          },
        });
      }
      if (url.endsWith("/v1/entry/sessions/entry-1/runs")) {
        return jsonResponse(
          {
            session: {
              entrySessionId: "entry-1",
              state: "ready_for_run",
              nextAction: "run",
            },
            run: {
              runId: `run-${entryBodies.length}`,
              status: "running",
              assignments: [
                {
                  assignmentId: `assignment-script-${entryBodies.length}`,
                  status: "pending",
                  approvalMode: "operator_approve",
                  role: "script-planner",
                },
              ],
            },
          },
          201,
        );
      }
      if (url.endsWith("/v1/runs/run-1/start") || url.endsWith("/v1/runs/run-2/start")) {
        return jsonResponse({ status: "running" });
      }
      if (url.endsWith("/v1/runs/run-1")) {
        return jsonResponse({
          runId: "run-1",
          status: "running",
          assignments: [
            {
              assignmentId: "assignment-script-1",
              status: "pending",
              approvalMode: "operator_approve",
              role: "script-planner",
            },
          ],
        });
      }
      if (url.endsWith("/v1/runs/run-1/approve")) {
        return jsonResponse({ runId: "run-1", status: "running", assignments: [] });
      }
      if (url.endsWith("/v1/runs/run-2")) {
        return jsonResponse({
          runId: "run-2",
          status: "running",
          assignments: [
            {
              assignmentId: "assignment-script-2",
              status: "pending",
              approvalMode: "operator_approve",
              role: "script-planner",
            },
          ],
        });
      }
      if (url.endsWith("/v1/runs/run-2/approve")) {
        return jsonResponse({ runId: "run-2", status: "running", assignments: [] });
      }
      if (url.endsWith("/v1/entry/sessions/entry-1/status")) {
        return jsonResponse({
          session: {
            entrySessionId: "entry-1",
            state: "run_in_progress",
            nextAction: "wait",
          },
          run: { runId: `run-${entryBodies.length}`, status: "running" },
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replyBodies.push(String(init?.body ?? ""));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };
    const config = {
      home,
      account,
      dmPolicy: "allowlist" as const,
      allowedUsers: ["friend@im.wechat"],
      fetchFn,
      runWorkerOnce: async (input) => ({
        run: { runId: input.runId, status: "completed" },
        executedAssignments: [
          "assignment-researcher-2",
          "assignment-script-2",
          "assignment-shot-2",
          "assignment-asset-2",
        ],
        report: {
          reportId: `report-${input.runId}`,
          flags: ["preview-only"],
          summary: [
            "run status=completed",
            "assignments total=4 ready=0 pending=0 running=0 completed=4 failed=0 blocked=0",
          ],
        },
      }),
      director: {
        hostApiUrl: "http://127.0.0.1:3201",
        hostId: "personal-weixin",
        agentId: "director",
        channel: "personal-weixin",
        autoAdvance: true,
        autoStartRun: true,
        fetchFn,
      },
    };

    await handleWeixinMessage(config, {
      message_id: "wx-msg-1",
      from_user_id: "friend@im.wechat",
      item_list: [{ type: 1, text_item: { text: "/制作 生成一个15秒短剧分镜蓝图" } }],
    });

    await handleWeixinMessage(config, {
      message_id: "wx-msg-2",
      from_user_id: "friend@im.wechat",
      item_list: [
        {
          type: 1,
          text_item: {
            text: "然后补充一下，一个山村野夫，在市井上买了一个女人回家做老婆的故事",
          },
        },
      ],
    });

    expect(entryBodies).toHaveLength(2);
    const refinedBody = entryBodies[1] ?? "";
    expect(refinedBody).toContain("生成一个15秒短剧分镜蓝图");
    expect(refinedBody).toContain("补充内容");
    expect(refinedBody).toContain("山村野夫");
    expect(refinedBody).toContain("安全边界");
    expect(refinedBody).not.toContain("目标：确认执行");
    const finalReply = replyBodies.at(-1) ?? "";
    expect(finalReply).not.toContain("我先按你的目标做了一版");
    expect(finalReply).not.toContain("我理解的目标：生成一个15秒短剧分镜蓝图");
    expect(finalReply).not.toContain("我补进的要求：一个山村野夫");
    expect(finalReply).not.toContain("Angel 已收到");
    expect(finalReply).not.toContain("下一步：回复");
    expect(finalReply).not.toContain("needs operator review");
    expect(finalReply).not.toContain("执行意图：");
    expect(finalReply).not.toContain("已推进：");
    expect(finalReply).not.toContain("Run：");
    const session = loadPeerSession(home, account.normalizedAccountId, "friend@im.wechat");
    expect(session?.lastObjective).toBe("生成一个15秒短剧分镜蓝图");
    expect(session?.lastObjective).not.toContain("执行意图");
    expect(session?.lastObjective).not.toContain("安全边界");
  });

  it("keeps stale internal refinement text out of confirmation replies", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    savePeerSession(home, account.normalizedAccountId, "friend@im.wechat", {
      peerId: "friend@im.wechat",
      entrySessionId: "entry-1",
      runId: "run-1",
      lastObjective:
        "生成一个15秒短剧分镜蓝图\n补充内容：旧补充\n执行意图：内部说明\n安全边界：内部安全规则",
      pendingApprovalAssignmentIds: ["assignment-script"],
      updatedAt: new Date().toISOString(),
    });
    const replyBodies: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      if (url.endsWith("/v1/runs/run-1")) {
        return jsonResponse({
          runId: "run-1",
          status: "running",
          assignments: [
            {
              assignmentId: "assignment-script",
              status: "pending",
              approvalMode: "operator_approve",
              role: "script-planner",
            },
          ],
        });
      }
      if (url.endsWith("/v1/runs/run-1/approve")) {
        return jsonResponse({ runId: "run-1", status: "running", assignments: [] });
      }
      if (url.endsWith("/v1/client-runtime/tasks/run-1/followup")) {
        return jsonResponse({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.client-runtime-followup.v1",
          clientRuntimeFollowup: {
            schemaVersion: "director.client-runtime.followup.v1",
            clientSurface: "weixin",
            originRuntime: "host.executionRun",
            accepted: true,
            status: "running",
            continued: 1,
            taskIds: ["run-1"],
            approvedAssignmentIds: ["assignment-script"],
          },
          run: { runId: "run-1", status: "running", assignments: [] },
        });
      }
      if (url.endsWith("/v1/entry/sessions/entry-1/status")) {
        return jsonResponse({
          session: {
            entrySessionId: "entry-1",
            state: "run_in_progress",
            nextAction: "wait",
          },
          run: { runId: "run-1", status: "running" },
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        replyBodies.push(String(init?.body ?? ""));
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };

    const result = await handleWeixinMessage(
      {
        home,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        runWorkerOnce: async (input) => ({
          run: { runId: input.runId, status: "completed" },
          executedAssignments: ["assignment-script"],
          report: {
            reportId: `report-${input.runId}`,
            flags: ["preview-only"],
            summary: [
              "run status=completed",
              "assignments total=1 ready=0 pending=0 running=0 completed=1 failed=0 blocked=0",
            ],
          },
        }),
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-msg-stale-confirm",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "确认执行" } }],
      },
    );

    expect(result).toBe("sent");
    const finalReply = replyBodies.at(-1) ?? "";
    expect(finalReply).toContain("已继续");
    expect(finalReply).toContain("已确认 1 个待审环节");
    expect(finalReply).not.toContain("补充内容");
    expect(finalReply).not.toContain("执行意图");
    expect(finalReply).not.toContain("安全边界");
  });

  it("does not approve an already-created unsafe romanticized run on confirmation", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    savePeerSession(home, account.normalizedAccountId, "friend@im.wechat", {
      peerId: "friend@im.wechat",
      entrySessionId: "entry-unsafe-1",
      runId: "run-unsafe-1",
      lastObjective: "生成一个15秒短剧分镜蓝图，主题：山村拐卖婚姻，最终爱情美满",
      pendingApprovalAssignmentIds: ["assignment-script"],
      updatedAt: new Date().toISOString(),
    });
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({}, 404);
    };

    const result = await handleWeixinMessage(
      {
        home,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn,
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: true,
          autoStartRun: true,
          fetchFn,
        },
      },
      {
        message_id: "wx-msg-unsafe-confirm",
        from_user_id: "friend@im.wechat",
        item_list: [{ type: 1, text_item: { text: "确认执行" } }],
      },
    );

    expect(result).toBe("sent");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/ilink/bot/sendmessage"]);
    expect(calls.at(-1)?.body).toContain("不能写成");
    const session = loadPeerSession(home, account.normalizedAccountId, "friend@im.wechat");
    expect(session?.runId).toBeUndefined();
    expect(session?.pendingSafeRewriteObjective).toContain("脱困与追责");
  });

  it("drops users outside the allowlist", async () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-adapter-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "bot@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });
    const calls: string[] = [];
    const result = await handleWeixinMessage(
      {
        home,
        account,
        dmPolicy: "allowlist",
        allowedUsers: ["friend@im.wechat"],
        fetchFn: async (url) => {
          calls.push(url);
          return jsonResponse({});
        },
        director: {
          hostApiUrl: "http://127.0.0.1:3201",
          hostId: "personal-weixin",
          agentId: "director",
          channel: "personal-weixin",
          autoAdvance: false,
          autoStartRun: false,
        },
      },
      {
        message_id: "wx-msg-2",
        from_user_id: "stranger@im.wechat",
        item_list: [{ type: 1, text_item: { text: "hi" } }],
      },
    );

    expect(result).toBe("ignored");
    expect(calls).toEqual([]);
  });
});
