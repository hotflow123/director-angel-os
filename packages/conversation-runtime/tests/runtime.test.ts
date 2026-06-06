import { describe, expect, it } from "vitest";

import {
  type ConversationRuntimeDelegationHookInput,
  type ConversationRuntimeInput,
  type ConversationRuntimeLearningArtifactStore,
  type ConversationRuntimeModelToolMessage,
  type ConversationRuntimePreCompressHookInput,
  ConversationRuntimeStreamingContextScrubber,
  type ConversationRuntimeTurnDecision,
  buildChannelTurnInputFromRuntimeInput,
  buildLearningEvidenceContext,
  createConversationRunRegistry,
  createConversationRuntimeToolRedactionHook,
  createConversationRuntimeToolRegistry,
  createDirectorConversationRuntimeTools,
  createLearningArtifact,
  createLearningArtifactStore,
  createLearningConfirmation,
  mapChannelTurnResultToRuntimeTurnDecision,
  mapDirectorCapabilityPacketToRuntimeCapabilityPacket,
  resolveConversationRuntimeSourceGroundingToolCalls,
  runConversationRuntimeModelToolLoop,
  runConversationRuntimeTurn,
} from "../src/index.js";

function input(overrides: Partial<ConversationRuntimeInput> = {}): ConversationRuntimeInput {
  return {
    surface: "desktop",
    channel: "desktop",
    messageId: "message-1",
    sessionKey: "session-1",
    text: "你现在能做什么？",
    sender: { id: "user-1" },
    ...overrides,
  };
}

function turn(
  overrides: Partial<ConversationRuntimeTurnDecision> = {},
): ConversationRuntimeTurnDecision {
  return {
    intent: { kind: "chat" },
    responsePolicy: "result-first",
    audience: "user",
    userText: "可以帮你制作、学习和审查。",
    memoryDecision: { action: "transient", reason: "普通对话默认只保留在会话上下文。" },
    shouldInvokeRecall: true,
    shouldCreateRun: false,
    shouldAttachToActiveSession: false,
    ...overrides,
  };
}

function createPendingLearningArtifactStore(
  sessionKey: string,
): ConversationRuntimeLearningArtifactStore {
  const store = createLearningArtifactStore({ nowMs: () => 200 });
  store.upsertArtifact(
    createLearningArtifact({
      artifactId: "artifact-pending",
      sessionKey,
      turnRunId: "turn-run-learning",
      sourceSurface: sessionKey.startsWith("weixin") ? "weixin" : "desktop",
      sourceKind: "url",
      sourceRef: "https://example.test/seedance",
      roleScope: {
        roleName: "导演 Angel",
        domain: "影视制作",
        responsibilityTags: ["短剧", "分镜", "AI 制作"],
      },
      pendingConfirmationId: "confirm-pending",
      confidence: "high",
      observedAtMs: 100,
    }),
  );
  store.upsertConfirmation(
    createLearningConfirmation({
      confirmationId: "confirm-pending",
      sessionKey,
      artifactId: "artifact-pending",
      candidateIds: ["candidate-pending"],
      createdAtMs: 100,
      expiresAtMs: 1_000,
    }),
  );
  return store;
}

describe("runConversationRuntimeTurn", () => {
  it("projects a simple model reply into unified runtime events", async () => {
    const result = await runConversationRuntimeTurn(
      input({
        sessionKey: "desktop:workbench",
        messageId: "message-unified-events-chat",
        text: "哪些地方最有用？",
      }),
      {
        nowMs: (() => {
          let now = 1_000;
          return () => {
            now += 10;
            return now;
          };
        })(),
        turnIdFactory: () => "turn-unified-events-chat",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            shouldInvokeRecall: false,
          }),
        callModel: () => ({ finalText: "最有用的是把提示词迭代拆成可验证步骤。" }),
        executeTool: () => {
          throw new Error("tool should not run");
        },
      },
    );

    expect(result.runtimeEventsV1.map((event) => event.kind)).toEqual([
      "turn.started",
      "intent.classified",
      "model.final",
    ]);
    expect(result.runtimeEventsV1[0]).toMatchObject({
      schemaVersion: "conversation-runtime.event.v1",
      turnId: "turn-unified-events-chat",
      conversationId: "desktop:workbench",
      payload: {
        surface: "desktop",
        channel: "desktop",
        messageId: "message-unified-events-chat",
      },
    });
    expect(result.runtimeEventsV1.at(-1)).toMatchObject({
      kind: "model.final",
      payload: {
        chars: "最有用的是把提示词迭代拆成可验证步骤。".length,
        replySource: "model",
      },
    });
  });

  it("passes runtime tool hooks into model tool turns before transcript persistence", async () => {
    const result = await runConversationRuntimeTurn(
      input({
        sessionKey: "desktop:workbench:hook-redaction",
        messageId: "message-runtime-hook-redaction",
        text: "读取工具结果并回答",
      }),
      {
        nowMs: () => 1_000,
        turnIdFactory: () => "turn-runtime-hook-redaction",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            shouldInvokeRecall: false,
          }),
        tools: [{ name: "secret.echo", description: "Echo a secret", readOnly: true }],
        toolHooks: [createConversationRuntimeToolRedactionHook()],
        callModel: ({ messages }) => {
          if (messages.some((message) => message.role === "tool")) {
            return { finalText: "已读取工具结果。" };
          }
          return {
            toolCalls: [
              {
                id: "call-secret-echo",
                name: "secret.echo",
                args: { value: "check" },
                readOnly: true,
              },
            ],
          };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: "Authorization: Bearer sk-live-secret-value",
        }),
      },
    );

    expect(JSON.stringify(result.transcriptMessages)).toContain("[REDACTED:");
    expect(JSON.stringify(result.transcriptMessages)).not.toContain("sk-live-secret-value");
  });

  it("projects tool execution into unified runtime events", async () => {
    const result = await runConversationRuntimeTurn(
      input({
        sessionKey: "desktop:workbench",
        messageId: "message-unified-events-tool",
        text: "请读取资料并回答。",
      }),
      {
        nowMs: (() => {
          let now = 2_000;
          return () => {
            now += 10;
            return now;
          };
        })(),
        turnIdFactory: () => "turn-unified-events-tool",
        orchestrate: () =>
          turn({
            intent: { kind: "chat", objective: "https://example.test/article" },
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "web_extract",
            description: "Read a URL.",
            readOnly: true,
          },
        ],
        callModel: async ({ messages }) => {
          if (messages.some((message) => message.role === "tool")) {
            return { finalText: "已读取文章，建议沉淀为待审经验。" };
          }
          return {
            toolCalls: [
              {
                id: "call-learn-url",
                name: "web_extract",
                args: { url: "https://example.test/article" },
                readOnly: true,
              },
            ],
          };
        },
        executeTool: async ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: "候选已生成：candidate-1",
          output: {
            candidateIds: ["candidate-1"],
            sourceUrl: "https://example.test/article",
          },
        }),
      },
    );

    expect(result.runtimeEventsV1.map((event) => event.kind)).toEqual([
      "turn.started",
      "intent.classified",
      "tool.started",
      "tool.completed",
      "model.final",
    ]);
    expect(result.runtimeEventsV1).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool.started",
          payload: expect.objectContaining({
            toolName: "web_extract",
            toolCallId: "call-learn-url",
          }),
        }),
        expect.objectContaining({
          kind: "tool.completed",
          payload: expect.objectContaining({
            toolName: "web_extract",
            toolCallId: "call-learn-url",
            ok: true,
          }),
        }),
      ]),
    );
  });

  it("projects MemPalace memory layer hits into unified runtime events", async () => {
    const result = await runConversationRuntimeTurn(
      input({
        sessionKey: "desktop:workbench",
        messageId: "message-unified-events-memory",
        text: "哪些地方最有用？",
      }),
      {
        nowMs: (() => {
          let now = 3_000;
          return () => {
            now += 10;
            return now;
          };
        })(),
        turnIdFactory: () => "turn-unified-events-memory",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            shouldInvokeRecall: true,
          }),
        resolveCapabilityContext: () => ({
          status: "hit",
          visibleSummary: "命中记忆 1 条。",
          hiddenPromptBlock: "Long-term memory: L2 On-Demand",
          hits: [
            {
              id: "memory:working-memory:mempalace:drawer_seedance_01",
              source: "memory",
              status: "hit",
              score: 0.93,
              summary: "working memory matched current turn",
              metadata: {
                memoryLayer: "L2",
                layerLabel: "L2 On-Demand",
                sourceFile: "seedance.md",
                wing: "hotflow",
                room: "architecture",
                drawerIndex: 2,
                totalDrawers: 7,
                retrievalMode: "verbatim-first",
                verbatimExcerpt: "Scene prompts stay per shot.",
                drawerContent:
                  "Scene prompts stay per shot.\nDo not merge every scene into one abstract summary.",
              },
            },
          ],
        }),
        callModel: () => ({ finalText: "最有用的是把场景提示词保持在单镜头粒度。" }),
        executeTool: () => {
          throw new Error("tool should not run");
        },
      },
    );

    expect(result.runtimeEventsV1.map((event) => event.kind)).toEqual([
      "turn.started",
      "intent.classified",
      "memory.recall",
      "model.final",
    ]);
    expect(result.runtimeEventsV1).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "memory.recall",
          payload: expect.objectContaining({
            status: "hit",
            hitCount: 1,
            layers: ["L2"],
            hits: [
              expect.objectContaining({
                id: "memory:working-memory:mempalace:drawer_seedance_01",
                memoryLayer: "L2",
                layerLabel: "L2 On-Demand",
                drawerId: "drawer_seedance_01",
                sourceFile: "seedance.md",
                drawerIndex: 2,
                totalDrawers: 7,
                verbatimExcerpt: "Scene prompts stay per shot.",
                drawerContent:
                  "Scene prompts stay per shot.\nDo not merge every scene into one abstract summary.",
              }),
            ],
          }),
        }),
      ]),
    );
  });

  it("projects MemPalace degraded layer reasons into unified runtime events", async () => {
    const result = await runConversationRuntimeTurn(
      input({
        sessionKey: "desktop:workbench",
        messageId: "message-unified-events-memory-degraded",
        text: "查一下更深层记忆",
      }),
      {
        nowMs: (() => {
          let now = 3_100;
          return () => {
            now += 10;
            return now;
          };
        })(),
        turnIdFactory: () => "turn-unified-events-memory-degraded",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            shouldInvokeRecall: true,
          }),
        resolveCapabilityContext: () => ({
          status: "degraded",
          visibleSummary: "L3 记忆未完成深搜。",
          hiddenPromptBlock: "",
          hits: [
            {
              id: "memory:mempalace:l3-unavailable",
              source: "memory",
              status: "degraded",
              summary: "L3 Deep Search index is not ready",
              metadata: {
                memoryLayer: "L3",
                layerLabel: "L3 Deep Search",
              },
            },
          ],
        }),
        callModel: () => ({ finalText: "深层记忆现在不可用。" }),
        executeTool: () => {
          throw new Error("tool should not run");
        },
      },
    );

    expect(result.runtimeEventsV1).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "memory.recall",
          payload: expect.objectContaining({
            status: "degraded",
            hitCount: 0,
            layers: ["L3"],
            degradedReasons: ["L3 Deep Search index is not ready"],
          }),
        }),
      ]),
    );
  });

  it("handles learning confirmation before model chat in the shared runtime", async () => {
    const learningArtifactStore = createPendingLearningArtifactStore("desktop:workbench");
    const persistenceCalls: unknown[] = [];
    let modelCalled = false;

    const result = await runConversationRuntimeTurn(
      input({
        sessionKey: "desktop:workbench",
        messageId: "message-confirm-learning",
        text: "嗯，就这个，保存成经验",
      }),
      {
        nowMs: () => 200,
        turnIdFactory: () => "turn-confirm-learning",
        learningArtifactStore,
        persistLearningConfirmation: async (payload) => {
          persistenceCalls.push(payload);
          return {
            status: "candidate-created",
            candidateIds: ["candidate-pending"],
            auditId: "audit-confirm-learning",
            message: "已进入经验候选。",
          };
        },
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "这句话本来可能被模型当普通聊天。",
            shouldInvokeRecall: true,
          }),
        callModel: () => {
          modelCalled = true;
          return { finalText: "模型不应该处理确认。" };
        },
        executeTool: () => {
          throw new Error("tool loop should not run");
        },
      },
    );

    expect(modelCalled).toBe(false);
    expect(persistenceCalls).toEqual([
      expect.objectContaining({
        decision: expect.objectContaining({ kind: "accept" }),
        artifact: expect.objectContaining({
          artifactId: "artifact-pending",
          sourceRef: "https://example.test/seedance",
        }),
        confirmation: expect.objectContaining({ confirmationId: "confirm-pending" }),
        input: expect.objectContaining({ sessionKey: "desktop:workbench" }),
      }),
    ]);
    expect(result.replySource).toBe("structured-renderer");
    expect(result.finalText).toContain("已保存");
    expect(result.finalText).toContain("已进入经验候选");
    expect(result.intent?.kind).toBe("learning-confirmation");
    expect(result.events.map((event) => event.kind)).toEqual(["runtime.artifact", "runtime.final"]);
    expect(learningArtifactStore.readArtifact("artifact-pending")).toMatchObject({
      status: "accepted",
    });
    expect(learningArtifactStore.readConfirmation("confirm-pending")).toMatchObject({
      status: "accepted",
      acceptedByMessageId: "message-confirm-learning",
    });
  });

  it("keeps capability questions from consuming pending learning confirmations", async () => {
    const learningArtifactStore = createPendingLearningArtifactStore("desktop:workbench");
    const persistenceCalls: unknown[] = [];
    let modelCalled = false;

    const result = await runConversationRuntimeTurn(
      input({
        sessionKey: "desktop:workbench",
        messageId: "message-hyperframes-capability",
        text: "如果我给你你接入HyperFrames的cli，你可以操作吗",
      }),
      {
        nowMs: () => 200,
        turnIdFactory: () => "turn-hyperframes-capability",
        learningArtifactStore,
        persistLearningConfirmation: async (payload) => {
          persistenceCalls.push(payload);
          return { status: "candidate-created", candidateIds: ["candidate-pending"] };
        },
        orchestrate: () => turn({ intent: { kind: "chat" }, shouldInvokeRecall: false }),
        callModel: () => {
          modelCalled = true;
          return { finalText: "可以，在接入 CLI 后我可以按授权边界调用。" };
        },
        executeTool: () => {
          throw new Error("tool loop should not run");
        },
      },
    );

    expect(modelCalled).toBe(true);
    expect(persistenceCalls).toEqual([]);
    expect(result.intent?.kind).toBe("chat");
    expect(result.finalText).toContain("接入 CLI");
    expect(learningArtifactStore.readConfirmation("confirm-pending")).toMatchObject({
      status: "pending",
    });
  });

  it("keeps unrelated file save requests from consuming pending learning confirmations", async () => {
    const learningArtifactStore = createPendingLearningArtifactStore("desktop:workbench");
    const persistenceCalls: unknown[] = [];
    let modelCalled = false;

    const result = await runConversationRuntimeTurn(
      input({
        sessionKey: "desktop:workbench",
        messageId: "message-save-cli-config",
        text: "先保存 HyperFrames CLI 的配置文件",
      }),
      {
        nowMs: () => 200,
        turnIdFactory: () => "turn-save-cli-config",
        learningArtifactStore,
        persistLearningConfirmation: async (payload) => {
          persistenceCalls.push(payload);
          return { status: "candidate-created", candidateIds: ["candidate-pending"] };
        },
        orchestrate: () => turn({ intent: { kind: "chat" }, shouldInvokeRecall: false }),
        callModel: () => {
          modelCalled = true;
          return { finalText: "可以，我会按你提供的路径和内容保存配置文件。" };
        },
        executeTool: () => {
          throw new Error("tool loop should not run");
        },
      },
    );

    expect(modelCalled).toBe(true);
    expect(persistenceCalls).toEqual([]);
    expect(result.intent?.kind).toBe("chat");
    expect(result.finalText).toContain("配置文件");
    expect(result.finalText).not.toContain("已保存这条经验");
    expect(learningArtifactStore.readConfirmation("confirm-pending")).toMatchObject({
      status: "pending",
    });
  });

  it("does not bind active evidence frames into unrelated capability questions", async () => {
    const learningArtifactStore = createPendingLearningArtifactStore("desktop:workbench");
    let systemPrompt = "";

    const result = await runConversationRuntimeTurn(
      input({
        sessionKey: "desktop:workbench",
        messageId: "message-capability-active-evidence",
        text: "如果我给你接入 HyperFrames 的 CLI，你可以操作吗？",
        metadata: {
          activeEvidenceFrame: {
            frameId: "frame-hyperframes-post",
            turnId: "turn-learning-hyperframes-post",
            sourceUrls: ["https://x.com/Xuhuicai888/status/2058393033880609001"],
            candidateIds: ["candidate-pending"],
            evidenceDisclosure: {
              sources: [
                {
                  url: "https://x.com/Xuhuicai888/status/2058393033880609001",
                  fullBodyChars: 1200,
                },
              ],
            },
          },
        },
      }),
      {
        nowMs: () => 200,
        turnIdFactory: () => "turn-capability-active-evidence",
        learningArtifactStore,
        persistLearningConfirmation: async () => ({
          status: "candidate-created",
          candidateIds: ["candidate-pending"],
        }),
        orchestrate: () => turn({ intent: { kind: "chat" }, shouldInvokeRecall: false }),
        tools: createDirectorConversationRuntimeTools(),
        callModel: (request) => {
          systemPrompt = request.messages[0]?.content ?? "";
          expect(request.messages.some((message) => message.role === "tool")).toBe(false);
          return { finalText: "可以，接入 CLI 后我会按你的授权边界操作。" };
        },
        executeTool: () => {
          throw new Error("evidence tool should not run for unrelated capability questions");
        },
      },
    );

    expect(result.intent?.kind).toBe("chat");
    expect(result.finalText).toContain("接入 CLI");
    expect(systemPrompt).not.toContain("上一轮活跃证据帧");
    expect(systemPrompt).not.toContain("围绕这份活跃证据继续问");
    expect(learningArtifactStore.readConfirmation("confirm-pending")).toMatchObject({
      status: "pending",
    });
  });

  it("does not call learning persistence when a pending artifact is rejected", async () => {
    const learningArtifactStore = createPendingLearningArtifactStore("desktop:workbench");
    let persistenceCalls = 0;

    const result = await runConversationRuntimeTurn(
      input({
        sessionKey: "desktop:workbench",
        messageId: "message-reject-learning",
        text: "别存，这个图片没真正看懂",
      }),
      {
        nowMs: () => 200,
        turnIdFactory: () => "turn-reject-learning",
        learningArtifactStore,
        persistLearningConfirmation: () => {
          persistenceCalls += 1;
          return { status: "candidate-created", candidateIds: [] };
        },
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "普通聊天。",
            shouldInvokeRecall: true,
          }),
        callModel: () => ({ finalText: "模型不应该处理拒绝。" }),
        executeTool: () => {
          throw new Error("tool loop should not run");
        },
      },
    );

    expect(persistenceCalls).toBe(0);
    expect(result.finalText).toContain("已取消保存");
    expect(learningArtifactStore.readArtifact("artifact-pending")).toMatchObject({
      status: "rejected",
    });
  });

  it("does not claim a learning confirmation was saved when persistence blocks it", async () => {
    const learningArtifactStore = createPendingLearningArtifactStore("desktop:workbench");

    const result = await runConversationRuntimeTurn(
      input({
        sessionKey: "desktop:workbench",
        messageId: "message-confirm-blocked-learning",
        text: "嗯，就这个，保存成经验",
      }),
      {
        nowMs: () => 200,
        turnIdFactory: () => "turn-confirm-blocked-learning",
        learningArtifactStore,
        persistLearningConfirmation: () => ({
          status: "candidate-confirmation-blocked",
          candidateIds: ["candidate-pending"],
          message: "候选 candidate-pending 最新审核已拒绝，不能用自然语言确认复活。",
        }),
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "这句话本来可能被模型当普通聊天。",
            shouldInvokeRecall: true,
          }),
        callModel: () => ({ finalText: "模型不应该处理被阻断的确认。" }),
        executeTool: () => {
          throw new Error("tool loop should not run");
        },
      },
    );

    expect(result.finalText).toContain("没有保存这条经验");
    expect(result.finalText).toContain("最新审核已拒绝");
    expect(result.finalText).not.toContain("已保存这条经验");
    expect(learningArtifactStore.readArtifact("artifact-pending")).toMatchObject({
      status: "rejected",
    });
    expect(learningArtifactStore.readConfirmation("confirm-pending")).toMatchObject({
      status: "cancelled",
    });
  });

  it("fails closed instead of returning a learned summary when confirmation has active evidence but no pending artifact", async () => {
    let modelCalled = false;
    let toolCalled = false;

    const result = await runConversationRuntimeTurn(
      input({
        sessionKey: "desktop:workbench",
        messageId: "message-confirm-without-pending",
        text: "把刚才学到的经验收录",
        metadata: {
          learningConfirmation: true,
          activeEvidenceFrame: {
            schemaVersion: "director.desktop.active-evidence-frame.v1",
            frameId: "frame-with-candidate-no-pending",
            sessionKey: "desktop:workbench",
            sourceUrls: ["https://x.com/TanLuAI/status/2056949172629381407"],
            candidateIds: ["experience-tanluai"],
          },
        },
      }),
      {
        nowMs: () => 200,
        turnIdFactory: () => "turn-confirm-without-pending",
        learningArtifactStore: createLearningArtifactStore({ nowMs: () => 200 }),
        orchestrate: () =>
          turn({
            intent: {
              kind: "chat",
              metadata: { learningConfirmation: true },
            },
            userText: "用户要求保存刚才学到的经验。",
            shouldInvokeRecall: true,
          }),
        tools: createDirectorConversationRuntimeTools(),
        callModel: () => {
          modelCalled = true;
          return { finalText: "模型不应该伪装保存。" };
        },
        executeTool: () => {
          toolCalled = true;
          return {
            callId: "unused-learning-confirmation-candidate-read",
            toolName: "director.experience.candidates.list",
            ok: true,
            content: "status: success\nsummary: learned summary",
            output: {
              candidates: [{ id: "experience-tanluai", summary: "GPT 资产图经验。" }],
            },
          };
        },
      },
    );

    expect(modelCalled).toBe(false);
    expect(toolCalled).toBe(false);
    expect(result.replySource).toBe("structured-renderer");
    expect(result.intent?.kind).toBe("learning-confirmation");
    expect(result.finalText).toContain("没有保存这条经验");
    expect(result.finalText).toContain("当前没有可确认的待保存经验候选");
    expect(result.finalText).not.toContain("GPT 资产图经验");
  });

  it("limits OpenCLI fallback results to the count requested by the user", async () => {
    const result = await runConversationRuntimeTurn(
      input({
        messageId: "message-opencli-two",
        text: "用 OpenCLI 去 HackerNews 搜一下 OpenAI Codex 相关讨论，只给我两条，并在最后写来源。",
      }),
      {
        nowMs: () => 200,
        turnIdFactory: () => "turn-opencli-two",
        orchestrate: () =>
          turn({
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "director.opencli.invoke",
            description: "调用 OpenCLI 只读命令。",
            readOnly: true,
          },
        ],
        maxModelToolLoopTurns: 1,
        callModel: () => ({
          toolCalls: [
            {
              id: "call-opencli-search",
              name: "director.opencli.invoke",
              args: {
                operationId: "opencli.hackernews.search",
                args: { query: "OpenAI Codex" },
              },
            },
          ],
        }),
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: "status: success\nsummary: OpenCLI 执行完成：hackernews/search",
          output: {
            json: [
              { title: "OpenAI Codex CLI", url: "https://github.com/openai/codex" },
              {
                title: "OpenAI's Codex sure knows a lot about HN",
                url: "https://example.test/hn-video",
              },
              { title: "OpenAI Codex", url: "https://openai.com/blog/openai-codex/" },
            ],
          },
          metadata: {
            operationId: "opencli.hackernews.search",
            sourceRef: "opencli:hackernews/search",
            sourceAccessStatus: "available",
          },
        }),
      },
    );

    expect(result.finalText).toContain("1. OpenAI Codex CLI");
    expect(result.finalText).toContain("2. OpenAI's Codex sure knows a lot about HN");
    expect(result.finalText).not.toContain("3. OpenAI Codex");
    expect(result.finalText).toContain("来源：opencli:hackernews/search");
  });

  it("adds fail-closed media disclosure when web extraction finds media without understanding", async () => {
    const result = await runConversationRuntimeTurn(
      input({
        messageId: "message-media-disclosure",
        text: "读取这个媒体页面并总结",
      }),
      {
        nowMs: () => 200,
        turnIdFactory: () => "turn-media-disclosure",
        orchestrate: () =>
          turn({
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "web_extract",
            description: "Extract a web page.",
            readOnly: true,
          },
        ],
        maxModelToolLoopTurns: 2,
        callModel: (request) => {
          const hasToolResult = request.messages.some(
            (message): message is ConversationRuntimeModelToolMessage =>
              message.role === "tool" && message.toolCallId === "call-web-media",
          );
          if (!hasToolResult) {
            return {
              toolCalls: [
                {
                  id: "call-web-media",
                  name: "web_extract",
                  args: { url: "https://example.test/media" },
                },
              ],
            };
          }
          return { finalText: "文本结论：这篇文章讲了分镜复盘。" };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content:
            "status: success\nsummary: Extracted media page\nurl: https://example.test/media",
          output: {
            status: "success",
            url: "https://example.test/media",
            media_understanding_workflow: {
              mediaUnderstandingStatus: "not_understood",
              unauthorizedDisclosure:
                "文本已读；媒体仅完成清单记录，尚未理解图片、视频或音频内容，因此不能把媒体内容当成结论。",
              admission: {
                status: "text_admissible_media_list_only",
                reason: "media_not_understood_without_user_authorization",
                canAdmitTextEvidence: true,
                canAdmitMediaContent: false,
                requiredNextAction: "request_user_authorization",
              },
            },
          },
          metadata: {
            toolOutput: {
              status: "success",
              url: "https://example.test/media",
              media_understanding_workflow: {
                mediaUnderstandingStatus: "not_understood",
                unauthorizedDisclosure:
                  "文本已读；媒体仅完成清单记录，尚未理解图片、视频或音频内容，因此不能把媒体内容当成结论。",
                admission: {
                  status: "text_admissible_media_list_only",
                  reason: "media_not_understood_without_user_authorization",
                  canAdmitTextEvidence: true,
                  canAdmitMediaContent: false,
                  requiredNextAction: "request_user_authorization",
                },
              },
            },
          },
        }),
      },
    );

    expect(result.finalText).toContain("文本结论：这篇文章讲了分镜复盘。");
    expect(result.finalText).toContain("媒体未理解");
    expect(result.finalText).toContain(
      "文本已读；媒体仅完成清单记录，尚未理解图片、视频或音频内容，因此不能把媒体内容当成结论。",
    );
    expect(result.events.find((event) => event.kind === "runtime.final")).toMatchObject({
      payload: expect.objectContaining({
        text: expect.stringContaining("媒体未理解"),
      }),
    });
  });

  it("moves unsupported media claims to one end boundary instead of replacing list items inline", async () => {
    const result = await runConversationRuntimeTurn(
      input({
        messageId: "message-media-claim-scrub",
        text: "读取这个媒体页面并总结",
      }),
      {
        nowMs: () => 200,
        turnIdFactory: () => "turn-media-claim-scrub",
        orchestrate: () =>
          turn({
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "web_extract",
            description: "Extract a web page.",
            readOnly: true,
          },
        ],
        maxModelToolLoopTurns: 2,
        callModel: (request) => {
          const hasToolResult = request.messages.some(
            (message): message is ConversationRuntimeModelToolMessage =>
              message.role === "tool" && message.toolCallId === "call-web-media-claim",
          );
          if (!hasToolResult) {
            return {
              toolCalls: [
                {
                  id: "call-web-media-claim",
                  name: "web_extract",
                  args: { url: "https://example.test/media" },
                },
              ],
            };
          }
          return {
            finalText: [
              "学到的要点：",
              "1. 文本部分讲了提示词工作流。",
              "2. 图中展示了最终生成的视觉作品。",
            ].join("\n"),
          };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content:
            "status: success\nsummary: Extracted media page\nurl: https://example.test/media",
          output: {
            status: "success",
            url: "https://example.test/media",
            media_understanding_workflow: {
              mediaUnderstandingStatus: "not_understood",
              unauthorizedDisclosure:
                "文本已读；媒体仅完成清单记录，尚未理解图片、视频或音频内容，因此不能把媒体内容当成结论。",
              admission: {
                canAdmitTextEvidence: true,
                canAdmitMediaContent: false,
                requiredNextAction: "request_user_authorization",
              },
            },
          },
        }),
      },
    );

    expect(result.finalText).toContain("1. 文本部分讲了提示词工作流。");
    expect(result.finalText).not.toContain("图中展示了最终生成的视觉作品");
    expect(result.finalText).not.toContain("媒体内容：文本已读");
    expect(result.finalText?.match(/媒体未理解/gu)).toHaveLength(1);
    expect(result.finalText).toMatch(/媒体未理解：/u);
  });

  it("keeps learning confirmation scoped to the active session", async () => {
    const learningArtifactStore = createPendingLearningArtifactStore("weixin:user-1");
    let modelCalled = false;

    const result = await runConversationRuntimeTurn(
      input({
        sessionKey: "desktop:workbench",
        messageId: "message-cross-session",
        text: "可以，保存",
      }),
      {
        nowMs: () => 200,
        turnIdFactory: () => "turn-cross-session",
        learningArtifactStore,
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "普通聊天。",
            shouldInvokeRecall: false,
          }),
        callModel: () => {
          modelCalled = true;
          return { finalText: "没有命中当前会话的待保存经验。" };
        },
        executeTool: () => {
          throw new Error("tool loop should not run");
        },
      },
    );

    expect(modelCalled).toBe(true);
    expect(result.intent?.kind).toBe("chat");
    expect(result.finalText).toBe("没有命中当前会话的待保存经验。");
    expect(learningArtifactStore.readArtifact("artifact-pending")).toMatchObject({
      status: "pending_confirmation",
    });
  });

  it("resolves source grounding through the shared capability table", () => {
    const resolution = resolveConversationRuntimeSourceGroundingToolCalls({
      userText: "用搜索引擎搜狗去微信公众号搜索相关seedance2.0的教程",
      history: [],
      tools: [
        {
          name: "web_search",
          description: "Search the public web.",
          readOnly: true,
          metadata: { capability: "web.search" },
        },
      ],
    });

    expect(resolution.matchedCapabilities.map((capability) => capability.id)).toEqual([
      "weixin.article.search",
    ]);
    expect(resolution.calls).toEqual([
      expect.objectContaining({
        id: "required-web-search-sogou-weixin",
        name: "web_search",
        args: expect.objectContaining({
          query: "seedance2.0 教程",
          provider: "sogou-weixin",
          source_type: "weixin_article",
        }),
      }),
    ]);
  });

  it("routes tools through a three-part envelope without letting conversation history hijack the current turn", () => {
    const history: readonly ConversationRuntimeModelToolMessage[] = [
      {
        role: "tool",
        toolCallId: "required-web-search-sogou-weixin",
        content:
          'status: success\nsummary: Found 1 source candidate(s) for "seedance2.0 教程" via sogou-weixin.\nquery: seedance2.0 教程\nprovider: sogou-weixin\nsource_type: weixin_article\nresult_count: 1\nresult_1: Seedance 2.0 保姆级教程 | url=https://mp.weixin.qq.com/s/old | source=sogou-weixin | snippet=玩法分享',
        metadata: {
          ok: true,
          toolName: "web_search",
        },
      },
    ];

    const normalQuestion = resolveConversationRuntimeSourceGroundingToolCalls({
      rawUserText: "现在几点？你去互联网看看最近生成图片分镜图哪个模型最厉害",
      conversationContext: {
        history,
      },
      runtimeContext: {
        surface: "desktop",
        channel: "desktop",
        sessionKey: "session-1",
        tools: [
          {
            name: "web_search",
            description: "Search the public web.",
            readOnly: true,
            metadata: { capability: "web.search" },
          },
        ],
      },
    });

    expect(normalQuestion.matchedCapabilities).toEqual([]);
    expect(normalQuestion.calls).toEqual([]);

    const sourceFollowUp = resolveConversationRuntimeSourceGroundingToolCalls({
      rawUserText: "这不是最新的，去推特找找看",
      conversationContext: {
        history,
      },
      runtimeContext: {
        surface: "desktop",
        channel: "desktop",
        sessionKey: "session-1",
        tools: [
          {
            name: "x_search",
            description: "Search X/Twitter.",
            readOnly: true,
            metadata: { capability: "x.search" },
          },
        ],
      },
    });

    expect(sourceFollowUp.matchedCapabilities.map((capability) => capability.id)).toEqual([
      "social.x-twitter.search",
    ]);
    expect(sourceFollowUp.calls).toEqual([
      expect.objectContaining({
        id: "required-x-search",
        name: "x_search",
        args: expect.objectContaining({
          query: "seedance2.0 教程",
        }),
      }),
    ]);
  });

  it("does not schedule source grounding when neither the primary nor fallback tool is mounted", () => {
    const resolution = resolveConversationRuntimeSourceGroundingToolCalls({
      userText: "去推特找找最新的Seedance 2.0教程",
      history: [],
      tools: [
        {
          name: "web_extract",
          description: "Extract a public web page.",
          readOnly: true,
          metadata: { capability: "web.extract" },
        },
      ],
    });

    expect(resolution.matchedCapabilities).toEqual([]);
    expect(resolution.calls).toEqual([]);
  });

  it("adds public web fallback grounding for X/Twitter source requests", () => {
    const resolution = resolveConversationRuntimeSourceGroundingToolCalls({
      userText: "去推特找找最新的Seedance 2.0教程",
      history: [],
      tools: [
        {
          name: "x_search",
          description: "Search X/Twitter.",
          readOnly: true,
          metadata: { capability: "x.search" },
        },
        {
          name: "web_search",
          description: "Search the public web.",
          readOnly: true,
          metadata: { capability: "web.search" },
        },
      ],
    });

    expect(resolution.matchedCapabilities.map((capability) => capability.id)).toEqual([
      "social.x-twitter.search",
    ]);
    expect(resolution.calls).toEqual([
      expect.objectContaining({
        id: "required-x-search",
        name: "x_search",
        args: expect.objectContaining({ query: "最新的Seedance 2.0教程" }),
      }),
      expect.objectContaining({
        id: "required-web-search-x-twitter-fallback",
        name: "web_search",
        args: expect.objectContaining({
          query: "site:x.com OR site:twitter.com 最新的Seedance 2.0教程",
          provider: "auto",
          source_type: "web",
        }),
      }),
    ]);
  });

  it("adds an Angel Chrome browser fallback when X/Twitter is explicitly requested through a browser", () => {
    const resolution = resolveConversationRuntimeSourceGroundingToolCalls({
      userText: "用浏览器去 x.com 搜索 seedance 最新玩法",
      history: [],
      tools: [
        {
          name: "x_search",
          description: "Search X/Twitter.",
          readOnly: true,
          metadata: { capability: "x.search" },
        },
        {
          name: "browser_navigate",
          description: "Navigate a shared desktop browser.",
          readOnly: false,
          metadata: { capability: "browser.navigate" },
        },
        {
          name: "browser_snapshot",
          description: "Read the current browser page.",
          readOnly: true,
          metadata: { capability: "browser.snapshot" },
        },
        {
          name: "web_search",
          description: "Search the public web.",
          readOnly: true,
          metadata: { capability: "web.search" },
        },
      ],
    });

    expect(resolution.matchedCapabilities.map((capability) => capability.id)).toEqual([
      "social.x-twitter.search",
    ]);
    expect(resolution.calls).toEqual([
      expect.objectContaining({ id: "required-x-search", name: "x_search" }),
      expect.objectContaining({
        id: "required-browser-navigate-x-twitter",
        name: "browser_navigate",
        args: expect.objectContaining({
          url: "https://x.com/search?q=seedance%20%E6%9C%80%E6%96%B0%E7%8E%A9%E6%B3%95&src=typed_query&f=live",
          profile: "angel",
        }),
        metadata: expect.objectContaining({
          sourceCapabilityId: "social.x-twitter.browser-search",
          requestedBrowserProfile: "angel",
        }),
      }),
      expect.objectContaining({
        id: "required-browser-snapshot-x-twitter",
        name: "browser_snapshot",
        args: expect.objectContaining({ full: true }),
      }),
      expect.objectContaining({
        id: "required-web-search-x-twitter-fallback",
        name: "web_search",
      }),
    ]);
  });

  it("does not add a browser fallback for direct X URL learning when OpenCLI is unavailable", () => {
    const url = "https://x.com/Adam38363368936/status/2056318384317620663";
    const resolution = resolveConversationRuntimeSourceGroundingToolCalls({
      userText: `根据宪法，学习这个 ${url}`,
      history: [],
      tools: [
        {
          name: "web_extract",
          description: "Extract a public web page.",
          readOnly: true,
          metadata: { capability: "web.extract" },
        },
        {
          name: "browser_navigate",
          description: "Navigate a shared desktop browser.",
          readOnly: false,
          metadata: { capability: "browser.navigate" },
        },
        {
          name: "browser_snapshot",
          description: "Read the current browser page.",
          readOnly: true,
          metadata: { capability: "browser.snapshot" },
        },
      ],
    });

    expect(resolution.calls.map((call) => call.name)).toEqual(["web_extract"]);
    expect(resolution.calls).toEqual([
      expect.objectContaining({
        id: "required-web-extract-explicit-url",
        name: "web_extract",
        args: expect.objectContaining({
          url,
        }),
        metadata: expect.objectContaining({
          siteStrategyId: "dynamic-social",
          sourceUrl: url,
        }),
      }),
    ]);
    expect(resolution.calls.map((call) => call.name)).not.toContain("browser_navigate");
    expect(resolution.calls.map((call) => call.name)).not.toContain("browser_snapshot");
  });

  it("uses the user Chrome profile when the user explicitly asks for Google Chrome X/Twitter search", () => {
    const resolution = resolveConversationRuntimeSourceGroundingToolCalls({
      userText: "用谷歌浏览器去推特搜索 seedance 最新玩法",
      history: [],
      tools: [
        {
          name: "x_search",
          description: "Search X/Twitter.",
          readOnly: true,
          metadata: { capability: "x.search" },
        },
        {
          name: "browser_navigate",
          description: "Navigate a shared desktop browser.",
          readOnly: false,
          metadata: { capability: "browser.navigate" },
        },
        {
          name: "browser_snapshot",
          description: "Read the current browser page.",
          readOnly: true,
          metadata: { capability: "browser.snapshot" },
        },
      ],
    });

    expect(resolution.calls).toEqual([
      expect.objectContaining({ id: "required-x-search", name: "x_search" }),
      expect.objectContaining({
        id: "required-browser-navigate-x-twitter",
        name: "browser_navigate",
        args: expect.objectContaining({
          profile: "user",
        }),
        metadata: expect.objectContaining({
          requestedBrowserProfile: "user",
          requiresExistingBrowserSession: true,
        }),
      }),
      expect.objectContaining({ id: "required-browser-snapshot-x-twitter" }),
    ]);
  });

  it("does not add public web fallback grounding when the X/Twitter provider is ready", () => {
    const resolution = resolveConversationRuntimeSourceGroundingToolCalls({
      userText: "去推特找找最新的Seedance 2.0教程",
      history: [],
      tools: [
        {
          name: "x_search",
          description: "Search X/Twitter.",
          readOnly: true,
          metadata: {
            capability: "x.search",
            externalProviderStatus: "ready",
          },
        },
        {
          name: "web_search",
          description: "Search the public web.",
          readOnly: true,
          metadata: { capability: "web.search" },
        },
      ],
    });

    expect(resolution.matchedCapabilities.map((capability) => capability.id)).toEqual([
      "social.x-twitter.search",
    ]);
    expect(resolution.calls).toEqual([
      expect.objectContaining({
        id: "required-x-search",
        name: "x_search",
        args: expect.objectContaining({ query: "最新的Seedance 2.0教程" }),
      }),
    ]);
  });

  it("inherits the latest source topic for thin X/Twitter follow-up requests", () => {
    const resolution = resolveConversationRuntimeSourceGroundingToolCalls({
      userText: "这不是最新的，去推特找找看",
      history: [
        {
          role: "tool",
          toolCallId: "required-web-search-sogou-weixin",
          content:
            'status: success\nsummary: Found 2 source candidate(s) for "seedance2.0 教程" via sogou-weixin.\nquery: seedance2.0 教程\nprovider: sogou-weixin\nsource_type: weixin_article\nresult_count: 2\nresult_1: 即梦 Seedance 2.0保姆级教程 | url=https://mp.weixin.qq.com/s/old | source=sogou-weixin | snippet=2026年02月更新\nresult_2: Seedance 2.0杀疯了 | url=https://mp.weixin.qq.com/s/newer | source=sogou-weixin | snippet=玩法分享',
          metadata: {
            ok: true,
            toolName: "web_search",
          },
        },
        {
          role: "assistant",
          content: "我在搜狗微信公众号找到了几篇，但不确定哪篇最新。",
        },
      ],
      tools: [
        {
          name: "x_search",
          description: "Search X/Twitter.",
          readOnly: true,
          metadata: { capability: "x.search" },
        },
      ],
    });

    expect(resolution.matchedCapabilities.map((capability) => capability.id)).toEqual([
      "social.x-twitter.search",
    ]);
    expect(resolution.calls).toEqual([
      expect.objectContaining({
        id: "required-x-search",
        name: "x_search",
        args: expect.objectContaining({
          query: "seedance2.0 教程",
        }),
      }),
    ]);
  });

  it("routes explicit browser source requests through browser_navigate grounding", () => {
    const resolution = resolveConversationRuntimeSourceGroundingToolCalls({
      userText: "用谷歌浏览器打开 https://example.com/search?q=seedance 看一下最新教程",
      history: [],
      tools: [
        {
          name: "browser_navigate",
          description: "Navigate a shared desktop browser.",
          readOnly: false,
          metadata: { capability: "browser.navigate" },
        },
        {
          name: "browser_snapshot",
          description: "Read the current browser page.",
          readOnly: true,
          metadata: { capability: "browser.snapshot" },
        },
      ],
    });

    expect(resolution.matchedCapabilities.map((capability) => capability.id)).toEqual([
      "browser.page.navigate",
    ]);
    expect(resolution.calls).toEqual([
      expect.objectContaining({
        id: "required-browser-navigate",
        name: "browser_navigate",
        args: expect.objectContaining({
          url: "https://example.com/search?q=seedance",
        }),
      }),
      expect.objectContaining({
        id: "required-browser-snapshot-after-navigate",
        name: "browser_snapshot",
        args: expect.objectContaining({
          full: true,
        }),
      }),
    ]);
  });

  it("routes explicit URL learning to web_extract instead of searching WeChat", () => {
    const resolution = resolveConversationRuntimeSourceGroundingToolCalls({
      userText: "你去学习这个公众号链接 https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
      history: [],
      tools: [
        {
          name: "web_extract",
          description: "Extract a public web page.",
          readOnly: true,
          metadata: { capability: "web.extract" },
        },
        {
          name: "web_search",
          description: "Search the public web.",
          readOnly: true,
          metadata: { capability: "web.search" },
        },
      ],
    });

    expect(resolution.matchedCapabilities).toEqual([]);
    expect(resolution.calls).toEqual([
      expect.objectContaining({
        id: "required-web-extract-explicit-url",
        name: "web_extract",
        args: expect.objectContaining({
          url: "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
        }),
      }),
    ]);
    expect(resolution.calls.map((call) => call.name)).not.toContain("web_search");
  });

  it("adds an Angel Chrome fallback for WeChat article URL learning after direct extraction", () => {
    const resolution = resolveConversationRuntimeSourceGroundingToolCalls({
      userText: "学习这个微信公众号文章 https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
      history: [],
      tools: [
        {
          name: "web_extract",
          description: "Extract a public web page.",
          readOnly: true,
          metadata: { capability: "web.extract" },
        },
        {
          name: "browser_navigate",
          description: "Navigate a shared desktop browser.",
          readOnly: false,
          metadata: { capability: "browser.navigate" },
        },
        {
          name: "browser_snapshot",
          description: "Read the current browser page.",
          readOnly: true,
          metadata: { capability: "browser.snapshot" },
        },
      ],
    });

    expect(resolution.calls).toEqual([
      expect.objectContaining({
        id: "required-web-extract-explicit-url",
        name: "web_extract",
        args: expect.objectContaining({
          url: "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
          mode: "auto",
        }),
        metadata: expect.objectContaining({
          siteStrategyId: "weixin-article",
          siteStrategyAction: "primary-extract",
        }),
      }),
      expect.objectContaining({
        id: "required-browser-navigate-explicit-url-fallback",
        name: "browser_navigate",
        args: expect.objectContaining({
          url: "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
          profile: "angel",
        }),
        metadata: expect.objectContaining({
          siteStrategyId: "weixin-article",
          siteStrategyAction: "browser-fallback",
        }),
      }),
      expect.objectContaining({
        id: "required-browser-snapshot-explicit-url-fallback",
        name: "browser_snapshot",
        args: expect.objectContaining({
          full: true,
          mode: "readable",
          max_chars: 16_000,
          urls: true,
          compact: true,
          refs: true,
        }),
      }),
    ]);
  });

  it("routes dynamic social URLs through OpenCLI when the read-only command is available", () => {
    const resolution = resolveConversationRuntimeSourceGroundingToolCalls({
      userText: "读取这个帖子 https://x.com/openai/status/1234567890",
      history: [],
      tools: [
        {
          name: "web_extract",
          description: "Extract a public web page.",
          readOnly: true,
          metadata: { capability: "web.extract" },
        },
        {
          name: "browser_navigate",
          description: "Navigate a shared desktop browser.",
          readOnly: false,
          metadata: { capability: "browser.navigate" },
        },
        {
          name: "browser_snapshot",
          description: "Read the current browser page.",
          readOnly: true,
          metadata: { capability: "browser.snapshot" },
        },
        {
          name: "director.opencli.invoke",
          description: "Invoke a read-only OpenCLI command.",
          readOnly: true,
          metadata: { capability: "external-tools.opencli.invoke-read" },
        },
      ],
    });

    expect(resolution.calls).toEqual([
      expect.objectContaining({
        id: "required-opencli-twitter-thread-explicit-url",
        name: "director.opencli.invoke",
        args: expect.objectContaining({
          operationId: "opencli.twitter.thread",
          args: expect.objectContaining({
            "tweet-id": "https://x.com/openai/status/1234567890",
          }),
        }),
        metadata: expect.objectContaining({
          provider: "opencli",
          sourceCapabilityId: "source.explicit-url.opencli-twitter-thread",
        }),
      }),
    ]);
    expect(resolution.calls.map((call) => call.name)).not.toContain("web_extract");
    expect(resolution.calls.map((call) => call.name)).not.toContain("browser_navigate");
  });

  it("does not fall back to Angel Chrome for dynamic social URL learning when OpenCLI is unavailable", () => {
    const resolution = resolveConversationRuntimeSourceGroundingToolCalls({
      userText: "读取这个帖子 https://x.com/openai/status/1234567890",
      history: [],
      tools: [
        {
          name: "web_extract",
          description: "Extract a public web page.",
          readOnly: true,
          metadata: { capability: "web.extract" },
        },
        {
          name: "browser_navigate",
          description: "Navigate a shared desktop browser.",
          readOnly: false,
          metadata: { capability: "browser.navigate" },
        },
        {
          name: "browser_snapshot",
          description: "Read the current browser page.",
          readOnly: true,
          metadata: { capability: "browser.snapshot" },
        },
      ],
    });

    expect(resolution.calls).toEqual([
      expect.objectContaining({
        id: "required-web-extract-explicit-url",
        name: "web_extract",
        args: expect.objectContaining({
          url: "https://x.com/openai/status/1234567890",
        }),
        metadata: expect.objectContaining({
          siteStrategyId: "dynamic-social",
          siteStrategyAction: "primary-extract",
        }),
      }),
    ]);
    expect(resolution.calls.map((call) => call.name)).not.toContain("browser_navigate");
    expect(resolution.calls.map((call) => call.name)).not.toContain("browser_snapshot");
  });

  it("allows explicit Chrome/browser requests to use browser grounding for dynamic social URLs", () => {
    const resolution = resolveConversationRuntimeSourceGroundingToolCalls({
      userText: "用浏览器打开读取这个帖子 https://x.com/openai/status/1234567890",
      history: [],
      tools: [
        {
          name: "web_extract",
          description: "Extract a public web page.",
          readOnly: true,
          metadata: { capability: "web.extract" },
        },
        {
          name: "browser_navigate",
          description: "Navigate a shared desktop browser.",
          readOnly: false,
          metadata: { capability: "browser.navigate" },
        },
        {
          name: "browser_snapshot",
          description: "Read the current browser page.",
          readOnly: true,
          metadata: { capability: "browser.snapshot" },
        },
      ],
    });

    expect(resolution.calls).toEqual([
      expect.objectContaining({
        id: "required-browser-navigate",
        name: "browser_navigate",
        args: expect.objectContaining({
          url: "https://x.com/openai/status/1234567890",
        }),
      }),
      expect.objectContaining({
        id: "required-browser-snapshot-after-navigate",
        name: "browser_snapshot",
      }),
    ]);
  });

  it("prioritizes direct extraction for explicit full rereads of dynamic social URLs", () => {
    const resolution = resolveConversationRuntimeSourceGroundingToolCalls({
      userText:
        "不要入库，只回答。请重新读取 https://x.com/ponyodong/status/2055150198989746559 并回答完整学到了什么。如果正文预览截断，请先二次提取全文。",
      history: [],
      tools: [
        {
          name: "web_extract",
          description: "Extract a public web page.",
          readOnly: true,
          metadata: { capability: "web.extract" },
        },
        {
          name: "browser_navigate",
          description: "Navigate a shared desktop browser.",
          readOnly: false,
          metadata: { capability: "browser.navigate" },
        },
        {
          name: "browser_snapshot",
          description: "Read the current browser page.",
          readOnly: true,
          metadata: { capability: "browser.snapshot" },
        },
      ],
    });

    expect(resolution.calls[0]).toMatchObject({
      id: "required-web-extract-explicit-url",
      name: "web_extract",
      args: expect.objectContaining({
        url: "https://x.com/ponyodong/status/2055150198989746559",
      }),
      metadata: expect.objectContaining({
        siteStrategyId: "dynamic-social",
        siteStrategyAction: "primary-extract",
        explicitFullReread: true,
      }),
    });
    expect(resolution.calls.map((call) => call.name)).toEqual(["web_extract"]);
  });

  it("uses the user Chrome profile for dynamic URLs only when the user asks for their browser", () => {
    const resolution = resolveConversationRuntimeSourceGroundingToolCalls({
      userText: "用我的谷歌浏览器读取这个帖子 https://x.com/openai/status/1234567890",
      history: [],
      tools: [
        {
          name: "browser_navigate",
          description: "Navigate a shared desktop browser.",
          readOnly: false,
          metadata: { capability: "browser.navigate" },
        },
        {
          name: "browser_snapshot",
          description: "Read the current browser page.",
          readOnly: true,
          metadata: { capability: "browser.snapshot" },
        },
      ],
    });

    expect(resolution.calls[0]).toMatchObject({
      name: "browser_navigate",
      args: expect.objectContaining({
        profile: "user",
      }),
      metadata: expect.objectContaining({
        requestedBrowserProfile: "user",
        requiresExistingBrowserSession: true,
      }),
    });
  });

  it("does not send private or localhost URLs to web_extract", () => {
    const resolution = resolveConversationRuntimeSourceGroundingToolCalls({
      userText: "读取这个本地页面 http://127.0.0.1:3000/report",
      history: [],
      tools: [
        {
          name: "web_extract",
          description: "Extract a public web page.",
          readOnly: true,
          metadata: { capability: "web.extract" },
        },
        {
          name: "browser_navigate",
          description: "Navigate a shared desktop browser.",
          readOnly: false,
          metadata: { capability: "browser.navigate" },
        },
        {
          name: "browser_snapshot",
          description: "Read the current browser page.",
          readOnly: true,
          metadata: { capability: "browser.snapshot" },
        },
      ],
    });

    expect(resolution.calls).toEqual([
      expect.objectContaining({
        id: "required-browser-navigate-explicit-url",
        name: "browser_navigate",
        args: expect.objectContaining({
          url: "http://127.0.0.1:3000/report",
          profile: "angel",
        }),
        metadata: expect.objectContaining({
          siteStrategyId: "private-local",
        }),
      }),
      expect.objectContaining({
        id: "required-browser-snapshot-explicit-url",
        name: "browser_snapshot",
        args: expect.objectContaining({
          full: false,
          mode: "efficient",
          max_chars: 12_000,
          urls: true,
          interactive: true,
          compact: true,
          refs: true,
        }),
      }),
    ]);
    expect(resolution.calls.map((call) => call.name)).not.toContain("web_extract");
  });

  it("prioritizes explicit Chrome reading over direct extract and search", () => {
    const resolution = resolveConversationRuntimeSourceGroundingToolCalls({
      userText: "打开谷歌浏览器去读取这个链接 https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
      history: [],
      tools: [
        {
          name: "web_extract",
          description: "Extract a public web page.",
          readOnly: true,
          metadata: { capability: "web.extract" },
        },
        {
          name: "web_search",
          description: "Search the public web.",
          readOnly: true,
          metadata: { capability: "web.search" },
        },
        {
          name: "browser_navigate",
          description: "Navigate a shared desktop browser.",
          readOnly: false,
          metadata: { capability: "browser.navigate" },
        },
        {
          name: "browser_snapshot",
          description: "Read the current browser page.",
          readOnly: true,
          metadata: { capability: "browser.snapshot" },
        },
      ],
    });

    expect(resolution.matchedCapabilities.map((capability) => capability.id)).toEqual([
      "browser.page.navigate",
    ]);
    expect(resolution.calls).toEqual([
      expect.objectContaining({
        id: "required-browser-navigate",
        name: "browser_navigate",
        args: expect.objectContaining({
          url: "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
          profile: "user",
        }),
        metadata: expect.objectContaining({
          requestedBrowserProfile: "user",
          requiresExistingBrowserSession: true,
        }),
      }),
      expect.objectContaining({
        id: "required-browser-snapshot-after-navigate",
        name: "browser_snapshot",
        args: expect.objectContaining({
          full: true,
        }),
      }),
    ]);
    expect(resolution.calls.map((call) => call.name)).not.toContain("web_extract");
    expect(resolution.calls.map((call) => call.name)).not.toContain("web_search");
  });

  it("routes explicit OpenCLI X URL reads to the twitter thread command", () => {
    const url = "https://x.com/Adam38363368936/status/2056318384317620663";
    const resolution = resolveConversationRuntimeSourceGroundingToolCalls({
      rawUserText: `根据宪法，学习这个 X 链接：${url}，使用 OpenCLI 当前 simon 登录态深读，并输出证据区。`,
      conversationContext: {
        history: [],
        metadata: {
          directReadPreferred: true,
          sourceKind: "url",
          url,
          preferredToolProvider: "opencli",
        },
      },
      runtimeContext: {
        surface: "desktop",
        channel: "desktop",
        sessionKey: "desktop:workbench",
        tools: [
          {
            name: "web_extract",
            description: "Extract a public web page.",
            readOnly: true,
            metadata: { capability: "web.extract" },
          },
          {
            name: "browser_navigate",
            description: "Navigate a shared desktop browser.",
            readOnly: false,
            metadata: { capability: "browser.navigate" },
          },
          {
            name: "browser_snapshot",
            description: "Read the current browser page.",
            readOnly: true,
            metadata: { capability: "browser.snapshot" },
          },
          {
            name: "director.opencli.invoke",
            description: "Invoke a read-only OpenCLI command.",
            readOnly: true,
            metadata: { capability: "external-tools.opencli.invoke-read" },
          },
        ],
      },
    });

    expect(resolution.calls).toEqual([
      expect.objectContaining({
        id: "required-opencli-twitter-thread-explicit-url",
        name: "director.opencli.invoke",
        args: expect.objectContaining({
          operationId: "opencli.twitter.thread",
          args: expect.objectContaining({
            "tweet-id": url,
          }),
        }),
        metadata: expect.objectContaining({
          provider: "opencli",
          sourceUrl: url,
          sourceCapabilityId: "source.explicit-url.opencli-twitter-thread",
        }),
      }),
    ]);
    expect(resolution.calls.map((call) => call.name)).not.toContain("web_extract");
    expect(resolution.calls.map((call) => call.name)).not.toContain("browser_navigate");
  });

  it("inherits a recent URL when the user asks the desktop browser to continue", () => {
    const resolution = resolveConversationRuntimeSourceGroundingToolCalls({
      userText: "那你可以在桌面上打开谷歌浏览器去看呀",
      history: [
        {
          role: "user",
          content: "学习这个 https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
        },
        {
          role: "assistant",
          content:
            "链接学习结果\n来源：https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA\n状态：被反爬虫验证挡住",
        },
      ],
      tools: [
        {
          name: "browser_navigate",
          description: "Navigate a shared desktop browser.",
          readOnly: false,
          metadata: { capability: "browser.navigate" },
        },
      ],
    });

    expect(resolution.matchedCapabilities.map((capability) => capability.id)).toEqual([
      "browser.page.navigate",
    ]);
    expect(resolution.calls).toEqual([
      expect.objectContaining({
        id: "required-browser-navigate",
        name: "browser_navigate",
        args: expect.objectContaining({
          url: "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
          profile: "user",
        }),
      }),
    ]);
  });

  it("summarizes a completed required browser tool when the model follow-up fails", async () => {
    const result = await runConversationRuntimeTurn(
      input({
        surface: "weixin",
        channel: "weixin",
        text: "那你可以在桌面上打开谷歌浏览器去看呀",
        history: [
          {
            role: "user",
            content: "学习这个 https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
          },
          {
            role: "assistant",
            content:
              "链接学习结果\n来源：https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA\n状态：被反爬虫验证挡住",
          },
        ],
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-browser-model-fails-after-tool",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求用桌面浏览器继续查看上一条链接。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "browser_navigate",
            description: "Navigate a shared desktop browser.",
            readOnly: false,
            metadata: { capability: "browser.navigate", externalProviderStatus: "ready" },
          },
        ],
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content:
            "status: success\nsummary: Navigated to https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA.\nurl: https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA\ntitle: 微信公众平台\nsnapshot: 环境异常 当前环境异常，完成验证后即可继续访问。",
          output: {
            status: "success",
            url: "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
            title: "微信公众平台",
            snapshot: "环境异常 当前环境异常，完成验证后即可继续访问。",
          },
        }),
        callModel: () => {
          throw new Error("provider not configured");
        },
      },
    );

    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("我已经用桌面浏览器打开");
    expect(result.finalText).toContain("微信公众平台");
    expect(result.finalText).toContain("https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA");
    expect(result.finalText).not.toContain("模型不可用");
    expect(result.events.some((event) => event.kind === "runtime.error")).toBe(false);
  });

  it("projects web_extract full-body artifacts from tool results into runtime artifact events", async () => {
    const artifact = {
      id: "web-extract-full-body-https-example-test-long",
      kind: "web-extract-body",
      title: "长网页正文",
      path: "/tmp/web-extract-full-body-https-example-test-long.json",
      metadata: {
        bodyRef: "web-extract-body-https-example-test-long",
        fullBodyChars: 8800,
        previewChars: 1200,
      },
    };

    const result = await runConversationRuntimeTurn(
      input({ text: "读取 https://example.test/long" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-web-extract-artifact-runtime",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求读取具体 URL。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "web_extract",
            description: "Extract readable URL text.",
            readOnly: true,
            metadata: { capability: "web.extract" },
          },
        ],
        callModel: ({ messages }) => {
          const toolResult = messages.find((message) => message.toolCallId === "call-web-extract");
          if (toolResult !== undefined) {
            expect(toolResult.content).toContain(
              "body_ref: web-extract-body-https-example-test-long",
            );
            expect(toolResult.content).not.toContain("完整正文尾部");
            return { finalText: "我已读取长网页正文，并保留了完整正文引用。" };
          }
          return {
            toolCalls: [
              {
                id: "call-web-extract",
                name: "web_extract",
                args: { url: "https://example.test/long" },
                readOnly: true,
              },
            ],
          };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content:
            "status: success\nsummary: Extracted preview.\nurl: https://example.test/long\ntext_preview: 长网页正文开头\nbody_ref: web-extract-body-https-example-test-long\nfull_body_ref: web-extract-full-body-https-example-test-long\nfull_body_chars: 8800\npreview_chars: 1200\nbody_truncated_for_model: true",
          output: {
            status: "success",
            url: "https://example.test/long",
            title: "长网页正文",
            text_preview: "长网页正文开头",
            body: `长网页正文开头${"正文内容。".repeat(400)}完整正文尾部`,
            body_ref: "web-extract-body-https-example-test-long",
            full_body_ref: "web-extract-full-body-https-example-test-long",
            body_truncated_for_model: true,
            artifacts: [artifact],
            full_body_artifact: artifact,
          },
          metadata: {
            modelVisibleContent:
              "status: success\ntext_preview: 长网页正文开头\nbody_ref: web-extract-body-https-example-test-long\nfull_body_ref: web-extract-full-body-https-example-test-long",
            artifactIds: [artifact.id],
          },
        }),
      },
    );

    expect(result.artifactIds).toEqual([artifact.id]);
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.artifact",
          payload: {
            artifact,
          },
        }),
      ]),
    );
    const completedToolEvent = result.events.find(
      (event) =>
        event.kind === "runtime.tool" &&
        "tool" in event.payload &&
        event.payload.tool.phase === "completed",
    );
    expect(completedToolEvent?.payload).toMatchObject({
      tool: expect.objectContaining({
        outputPreview: expect.not.stringContaining("完整正文尾部"),
      }),
    });
  });

  it("resolves capability context when the turn asks for recall", async () => {
    const requests: unknown[] = [];
    const result = await runConversationRuntimeTurn(input(), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-1",
      orchestrate: () => turn(),
      resolveCapabilityContext: (request) => {
        requests.push(request);
        return {
          status: "hit",
          visibleSummary: `召回：${request.userText}`,
          hiddenPromptBlock: "hidden skill context",
          hits: [
            {
              id: "skill:storyboard",
              source: "skill",
              status: "hit",
              title: "Storyboard",
            },
          ],
        };
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      turnId: "turn-1",
      sessionKey: "session-1",
      userText: "你现在能做什么？",
      surface: "desktop",
      channel: "desktop",
      intent: { kind: "chat" },
    });
    expect(result.capabilityPacket?.status).toBe("hit");
    expect(result.capabilityPacket?.hiddenPromptBlock).toBe("hidden skill context");
    expect(result.capabilityPacket?.hits[0]?.id).toBe("skill:storyboard");
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain("capability.resolved");
    expect(result.replySource).toBe("degraded-error");
    expect(result.finalText).toContain("模型不可用");
    expect(result.events[0]?.kind).toBe("runtime.error");
  });

  it("keeps recall degraded in trace when no resolver is installed", async () => {
    const result = await runConversationRuntimeTurn(input(), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-1",
      orchestrate: () => turn(),
    });

    expect(result.capabilityPacket).toBeUndefined();
    expect(result.operatorTrace.items.at(-1)?.stage).toBe("capability.degraded");
  });

  it("runs ordinary recalled chat through the model/tool loop when a model port is installed", async () => {
    const modelInputs: unknown[] = [];
    const result = await runConversationRuntimeTurn(input({ text: "你会什么？" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-chat-model",
      orchestrate: () =>
        turn({
          intent: { kind: "capability-intro" },
          userText: "结合当前能力自然回答。",
          memoryDecision: { action: "never-store", reason: "能力问答不写入记忆。" },
          shouldInvokeRecall: true,
        }),
      resolveCapabilityContext: () => ({
        status: "hit",
        visibleSummary: "已启用 Skill 2 个，已发布经验 3 条。",
        hiddenPromptBlock: "Skill: storyboard; Knowledge: 镜头语言",
        hits: [{ id: "skill:storyboard", source: "skill", status: "hit" }],
      }),
      callModel: (request) => {
        modelInputs.push(request);
        return {
          finalText: "我可以帮你把想法做成脚本、分镜和可审查的制作结果。",
        };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "ok",
      }),
    });

    expect(modelInputs.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(modelInputs[0])).toContain("已启用 Skill 2 个");
    expect(result.replySource).toBe("model");
    expect(result.finalText).toBe("我可以帮你把想法做成脚本、分镜和可审查的制作结果。");
    expect(result.events.map((event) => event.kind)).toEqual(["runtime.final"]);
    expect(result.events[0]?.payload).toMatchObject({ replySource: "model" });
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain("model.loop.completed");
  });

  it("requires approved Skill use when a recalled skill hit matches an actionable request", async () => {
    const executedToolCalls: unknown[] = [];
    const modelInputs: unknown[] = [];
    const result = await runConversationRuntimeTurn(
      input({
        text: "Moyin 九宫格参考图已经有了，帮我复核九宫格图，不要重新生成图片，也不要视频。",
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-moyin-nine-grid-skill-use",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求按已批准 Moyin S 级 Skill 复核九宫格参考图。",
            shouldInvokeRecall: true,
          }),
        resolveCapabilityContext: () => ({
          status: "hit",
          visibleSummary: "命中 Moyin S-Class 九宫格参考图复核 Skill。",
          hiddenPromptBlock:
            "Skill: skill.moyin-script-import-sclass-first-gate; 第三关：S-Class 九宫格参考图复核 Gate。",
          hits: [
            {
              id: "skill:skill.moyin-script-import-sclass-first-gate",
              source: "skill",
              status: "hit",
              title: "Moyin Script Import S-Class First Gate",
            },
          ],
        }),
        tools: [
          {
            name: "director.skills.use",
            description: "Use an approved Skill.",
            readOnly: true,
            metadata: { capability: "skill.use" },
          },
        ],
        callModel: (request) => {
          modelInputs.push(request);
          if (
            request.messages.some(
              (message) =>
                message.role === "tool" &&
                message.content.includes("skill.moyin-script-import-sclass-first-gate"),
            )
          ) {
            return {
              finalText:
                "已按 Moyin S 级 Skill 进入九宫格参考图复核：只复核现有图，不重新生成图片，也不生成视频。",
            };
          }
          return { finalText: "没有找到 Moyin 九宫格相关条目。" };
        },
        executeTool: ({ call }) => {
          executedToolCalls.push(call);
          expect(call.name).toBe("director.skills.use");
          expect(call.args).toMatchObject({
            skillId: "skill.moyin-script-import-sclass-first-gate",
            objective:
              "Moyin 九宫格参考图已经有了，帮我复核九宫格图，不要重新生成图片，也不要视频。",
          });
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content: [
              "status: success",
              "summary: 已应用 Skill：Moyin S-Class 九宫格参考图复核 Gate。",
              "skill_id: skill.moyin-script-import-sclass-first-gate",
              "next_actions: 只复核现有九宫格参考图；不要重新生成图片；不要生成视频。",
            ].join("\n"),
            output: {
              status: "success",
              summary: "已应用 Skill：Moyin S-Class 九宫格参考图复核 Gate。",
              skill_id: "skill.moyin-script-import-sclass-first-gate",
              next_actions: ["只复核现有九宫格参考图", "不要重新生成图片", "不要生成视频"],
            },
          };
        },
      },
    );

    expect(executedToolCalls).toHaveLength(1);
    expect(result.finalText).toContain("已按 Moyin S 级 Skill");
    expect(result.finalText).not.toContain("没有找到 Moyin 九宫格相关条目");
    expect(modelInputs).toHaveLength(1);
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain("tool.required");
    expect(
      result.events
        .filter((event) => event.kind === "runtime.tool")
        .map((event) => ("tool" in event.payload ? event.payload.tool.name : "")),
    ).toContain("director.skills.use");
  });

  it("does not execute a recalled Skill for capability-intro questions", async () => {
    const executedToolCalls: unknown[] = [];
    const result = await runConversationRuntimeTurn(input({ text: "你会什么？" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-capability-intro-no-skill-use",
      orchestrate: () =>
        turn({
          intent: { kind: "capability-intro" },
          userText: "结合当前能力自然回答。",
          memoryDecision: { action: "never-store", reason: "能力问答不写入记忆。" },
          shouldInvokeRecall: true,
        }),
      resolveCapabilityContext: () => ({
        status: "hit",
        visibleSummary: "已启用 Skill 1 个。",
        hiddenPromptBlock: "Skill: storyboard",
        hits: [{ id: "skill:storyboard", source: "skill", status: "hit" }],
      }),
      tools: [
        {
          name: "director.skills.use",
          description: "Use an approved Skill.",
          readOnly: true,
          metadata: { capability: "skill.use" },
        },
      ],
      callModel: () => ({ finalText: "我可以帮你制作、学习和审查。" }),
      executeTool: ({ call }) => {
        executedToolCalls.push(call);
        return {
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: "status: success",
        };
      },
    });

    expect(executedToolCalls).toHaveLength(0);
    expect(result.finalText).toBe("我可以帮你制作、学习和审查。");
    expect(
      result.events
        .filter((event) => event.kind === "runtime.tool")
        .map((event) => ("tool" in event.payload ? event.payload.tool.name : "")),
    ).not.toContain("director.skills.use");
  });

  it("uses the single S-level Skill directly when the user asks to execute it", async () => {
    const executedToolCalls: unknown[] = [];
    const result = await runConversationRuntimeTurn(input({ text: "执行S级Skill" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-execute-single-s-level-skill",
      orchestrate: () =>
        turn({
          intent: { kind: "chat" },
          userText: "用户要求执行已命中的 S 级 Skill。",
          shouldInvokeRecall: true,
        }),
      resolveCapabilityContext: () => ({
        status: "hit",
        visibleSummary: "命中 1 个 S 级 Skill。",
        hiddenPromptBlock: "Skill: skill.moyin-script-import-sclass-first-gate",
        hits: [
          {
            id: "skill:skill.moyin-script-import-sclass-first-gate",
            source: "skill",
            status: "hit",
            title: "Moyin 剧本导入 S-Class 第一关",
            score: 0.9,
            metadata: { level: "S" },
          },
        ],
      }),
      tools: [
        {
          name: "director.skills.use",
          description: "Use an approved Skill.",
          readOnly: true,
          metadata: { capability: "skill.use" },
        },
      ],
      callModel: ({ messages }) =>
        messages.some(
          (message) =>
            message.role === "tool" &&
            message.toolCallId ===
              "required-approved-skill-use-skill.moyin-script-import-sclass-first-gate",
        )
          ? { finalText: "已进入 Moyin S 级 Skill 执行准备，等待项目或剧本输入。" }
          : { finalText: "只查看了 S 级 Skill，还没有执行。" },
      executeTool: ({ call }) => {
        executedToolCalls.push(call);
        return {
          callId: call.id,
          toolName: call.name,
          ok: true,
          content:
            "status: success\nsummary: 已应用 Skill：Moyin 剧本导入 S-Class 第一关。\nskill_id: skill.moyin-script-import-sclass-first-gate\nnext_actions: 检查 Moyin 项目、剧本导入、S-Class 第一关验收。",
          output: {
            status: "success",
            summary: "已应用 Skill：Moyin 剧本导入 S-Class 第一关。",
            skill_id: "skill.moyin-script-import-sclass-first-gate",
          },
        };
      },
    });

    expect(executedToolCalls).toEqual([
      expect.objectContaining({
        name: "director.skills.use",
        args: expect.objectContaining({
          skillId: "skill.moyin-script-import-sclass-first-gate",
          objective: "执行S级Skill",
        }),
      }),
    ]);
    expect(result.finalText).toContain("已进入 Moyin S 级 Skill");
    expect(result.finalText).not.toContain("只查看");
  });

  it("continues the latest viewed Skill for actionable follow-up requests", async () => {
    const executedToolCalls: unknown[] = [];
    const history: readonly ConversationRuntimeModelToolMessage[] = [
      {
        role: "tool",
        toolCallId: "call-view-skill",
        content: [
          "status: success",
          "summary: 已读取 Skill：Moyin 剧本导入 S-Class 第一关。",
          "skill_id: skill.moyin-script-import-sclass-first-gate",
          "enabled: true",
          "next_actions: 基于 Skill 内容自然回答；如需执行外部工具，继续调用对应工具并遵守审批/安全边界。",
        ].join("\n"),
        metadata: { ok: true, toolName: "director.skills.view" },
      },
      {
        role: "assistant",
        content: "已查看 Moyin 剧本导入 S-Class 第一关。",
      },
    ];

    const result = await runConversationRuntimeTurn(
      input({
        text: '检查这个项目："Director Angel - 疯狂的石头 S级导入 2026-05-30-08-41-29"是否可以执行',
        history,
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-continue-viewed-skill-project-check",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户继续上一轮已读取的 Moyin S 级 Skill，要求检查项目是否可执行。",
            shouldInvokeRecall: true,
          }),
        resolveCapabilityContext: () => ({
          status: "miss",
          visibleSummary: "本轮没有新的能力命中。",
          hiddenPromptBlock: "",
          hits: [],
        }),
        tools: [
          {
            name: "director.skills.use",
            description: "Use an approved Skill.",
            readOnly: true,
            metadata: { capability: "skill.use" },
          },
        ],
        callModel: ({ messages }) =>
          messages.some(
            (message) =>
              message.role === "tool" &&
              message.content.includes("skill.moyin-script-import-sclass-first-gate"),
          )
            ? { finalText: "已沿用上一轮 S 级 Skill，开始检查该 Moyin 项目是否可执行。" }
            : { finalText: "模型调用完成。" },
        executeTool: ({ call }) => {
          executedToolCalls.push(call);
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content: [
              "status: success",
              "summary: 已应用 Skill：Moyin 剧本导入 S-Class 第一关。",
              "skill_id: skill.moyin-script-import-sclass-first-gate",
              "next_actions: 检查 Moyin 项目、剧本导入、S-Class 第一关验收。",
            ].join("\n"),
            output: {
              status: "success",
              skill_id: "skill.moyin-script-import-sclass-first-gate",
            },
          };
        },
      },
    );

    expect(executedToolCalls).toEqual([
      expect.objectContaining({
        name: "director.skills.use",
        args: expect.objectContaining({
          skillId: "skill.moyin-script-import-sclass-first-gate",
        }),
      }),
    ]);
    expect(result.finalText).toContain("已沿用上一轮 S 级 Skill");
    expect(result.finalText).not.toBe("模型调用完成。");
  });

  it("requires Moyin project readiness for project executable checks", async () => {
    const executedToolCalls: unknown[] = [];
    const result = await runConversationRuntimeTurn(
      input({
        text: '检查这个项目："Director Angel - 疯狂的石头 S级导入 2026-05-30-08-41-29"是否可以执行',
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-moyin-project-readiness-required",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求检查 Moyin 项目是否可以执行。",
            shouldInvokeRecall: true,
          }),
        tools: [
          {
            name: "director.moyin.project_readiness",
            description: "Read-only Moyin project readiness gate.",
            readOnly: true,
            metadata: { capability: "moyin.project_readiness" },
          },
        ],
        callModel: ({ messages }) =>
          messages.some(
            (message) =>
              message.role === "tool" && message.toolCallId === "required-moyin-project-readiness",
          )
            ? { finalText: "已检查 Moyin 项目 readiness：当前可以继续 S-Class 第一关。" }
            : { finalText: "模型调用完成。" },
        executeTool: ({ call }) => {
          executedToolCalls.push(call);
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content: [
              "status: ready",
              "summary: Moyin 项目 readiness 已通过。",
              "project_name: Director Angel - 疯狂的石头 S级导入 2026-05-30-08-41-29",
              "mutation: projectCreateAttempted=false, workflowRunCreateAttempted=false, submitAttempted=false",
            ].join("\n"),
            output: {
              status: "ready",
              mutation: {
                projectCreateAttempted: false,
                workflowRunCreateAttempted: false,
                submitAttempted: false,
              },
            },
          };
        },
      },
    );

    expect(executedToolCalls).toEqual([
      expect.objectContaining({
        id: "required-moyin-project-readiness",
        name: "director.moyin.project_readiness",
        args: expect.objectContaining({
          projectName: "Director Angel - 疯狂的石头 S级导入 2026-05-30-08-41-29",
        }),
      }),
    ]);
    expect(result.finalText).toContain("已检查 Moyin 项目 readiness");
    expect(result.finalText).not.toBe("模型调用完成。");
  });

  it("uses Moyin readiness as the final fallback when later browser probing fails", async () => {
    const executedToolCalls: unknown[] = [];
    const result = await runConversationRuntimeTurn(
      input({
        text: '检查这个项目："Director Angel - 疯狂的石头 S级导入 2026-05-30-08-41-29"是否可以执行',
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-moyin-readiness-browser-fallback",
        maxModelToolLoopTurns: 1,
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求检查 Moyin 项目是否可以执行。",
            shouldInvokeRecall: true,
          }),
        tools: [
          {
            name: "director.moyin.project_readiness",
            description: "Read-only Moyin project readiness gate.",
            readOnly: true,
            metadata: { capability: "moyin.project_readiness" },
          },
          {
            name: "browser_navigate",
            description: "Navigate browser.",
            readOnly: true,
            metadata: { capability: "browser.navigate" },
          },
        ],
        callModel: () => ({
          toolCalls: [
            {
              id: "bad-browser-navigation",
              name: "browser_navigate",
              args: { url: "http://localhost:5173" },
              readOnly: true,
            },
          ],
        }),
        executeTool: ({ call }) => {
          executedToolCalls.push(call);
          if (call.name === "director.moyin.project_readiness") {
            return {
              callId: call.id,
              toolName: call.name,
              ok: true,
              content: [
                "status: ready",
                "summary: Moyin 项目 readiness 已通过。",
                "schema: director.moyin.project-readiness.v1",
                "project_id: fdffda28-4a62-497b-abb2-d345ff381eb4",
                "project_name: Director Angel - 疯狂的石头 S级导入 2026-05-30-08-41-29",
                "gate.project-script: passed - Moyin project script scoped store is present.",
                "gate.project-sclass: passed - Moyin project S-Class scoped store is present.",
                "gate.workflow-run: passed - Moyin workflow-run ledger is readable (25 items).",
                "gate.task-ledger: passed - Moyin task ledger is readable (22 items).",
                "gate.artifact-registry: passed - Moyin artifact registry is readable (5 items).",
                "mutation: projectCreateAttempted=false, workflowRunCreateAttempted=false, submitAttempted=false",
                "next_actions: Use this Moyin projectId for the next S-Class workflow-run draft.",
              ].join("\n"),
              output: {
                schemaVersion: "director.moyin.project-readiness.v1",
                status: "ready",
                project: {
                  projectId: "fdffda28-4a62-497b-abb2-d345ff381eb4",
                  name: "Director Angel - 疯狂的石头 S级导入 2026-05-30-08-41-29",
                },
                gates: [
                  {
                    id: "project-script",
                    status: "passed",
                    summary: "Moyin project script scoped store is present.",
                  },
                  {
                    id: "project-sclass",
                    status: "passed",
                    summary: "Moyin project S-Class scoped store is present.",
                  },
                  {
                    id: "workflow-run",
                    status: "passed",
                    summary: "Moyin workflow-run ledger is readable (25 items).",
                  },
                  {
                    id: "task-ledger",
                    status: "passed",
                    summary: "Moyin task ledger is readable (22 items).",
                  },
                  {
                    id: "artifact-registry",
                    status: "passed",
                    summary: "Moyin artifact registry is readable (5 items).",
                  },
                ],
                mutation: {
                  projectCreateAttempted: false,
                  workflowRunCreateAttempted: false,
                  submitAttempted: false,
                },
                nextActions: ["Use this Moyin projectId for the next S-Class workflow-run draft."],
              },
            };
          }
          return {
            callId: call.id,
            toolName: call.name,
            ok: false,
            content:
              "status: error\nsummary: browser_navigate failed for http://localhost:5173.\nnext_actions: use web_extract for readable public pages",
          };
        },
      },
    );

    expect(executedToolCalls.map((call) => (call as { name: string }).name)).toEqual([
      "director.moyin.project_readiness",
      "browser_navigate",
    ]);
    expect(result.finalText).toContain("Moyin 项目 readiness 已通过");
    expect(result.finalText).toContain("project-script: 通过");
    expect(result.finalText).toContain("project-sclass: 通过");
    expect(result.finalText).toContain("workflow-run: 通过");
    expect(result.finalText).not.toContain("use web_extract");
    expect(result.finalText).not.toContain("浏览器通道");
  });

  it("does not ask the user to approve read-only Moyin hard validation after readiness already read the stores", async () => {
    const result = await runConversationRuntimeTurn(
      input({
        text: '检查这个项目："Director Angel - 疯狂的石头 S级导入 2026-05-30-08-41-29"是否可以执行',
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-moyin-readiness-no-hard-validation-question",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求检查 Moyin 项目是否可以执行。",
            shouldInvokeRecall: true,
          }),
        tools: [
          {
            name: "director.moyin.project_readiness",
            description: "Read-only Moyin project readiness gate.",
            readOnly: true,
            metadata: { capability: "moyin.project_readiness" },
          },
        ],
        callModel: ({ messages }) =>
          messages.some(
            (message) =>
              message.role === "tool" && message.toolCallId === "required-moyin-project-readiness",
          )
            ? { finalText: "项目存在。要我读取 script.json / sclass.json 做硬验收吗？" }
            : { finalText: "模型调用完成。" },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: [
            "status: ready",
            "summary: Moyin 项目 readiness 已通过。",
            "schema: director.moyin.project-readiness.v1",
            "project_id: fdffda28-4a62-497b-abb2-d345ff381eb4",
            "project_name: Director Angel - 疯狂的石头 S级导入 2026-05-30-08-41-29",
            "gate.project-script: passed - Moyin project script scoped store passed hard validation.",
            "gate.project-sclass: passed - Moyin project S-Class scoped store passed hard validation.",
            "mutation: projectCreateAttempted=false, workflowRunCreateAttempted=false, submitAttempted=false",
            "next_actions: Continue with the next read-only S-Class workflow-run gate.",
          ].join("\n"),
          output: {
            schemaVersion: "director.moyin.project-readiness.v1",
            status: "ready",
            project: {
              projectId: "fdffda28-4a62-497b-abb2-d345ff381eb4",
              name: "Director Angel - 疯狂的石头 S级导入 2026-05-30-08-41-29",
            },
            gates: [
              {
                id: "project-script",
                status: "passed",
                summary: "Moyin project script scoped store passed hard validation.",
                evidence: {
                  hardValidation: {
                    passed: true,
                    episodeRawScriptCount: 1,
                    sceneCount: 1,
                    shotCount: 6,
                  },
                },
              },
              {
                id: "project-sclass",
                status: "passed",
                summary: "Moyin project S-Class scoped store passed hard validation.",
                evidence: {
                  hardValidation: {
                    passed: true,
                    splitSceneCount: 11,
                    shotGroupCount: 4,
                    sceneAnchorCount: 1,
                    hasRhythmEngineProfile: true,
                  },
                },
              },
            ],
            mutation: {
              projectCreateAttempted: false,
              workflowRunCreateAttempted: false,
              submitAttempted: false,
            },
            nextActions: ["Continue with the next read-only S-Class workflow-run gate."],
          },
        }),
      },
    );

    expect(result.finalText).toContain("Moyin 项目 readiness 已通过");
    expect(result.finalText).toContain("project-script: 通过");
    expect(result.finalText).toContain("hard validation");
    expect(result.finalText).not.toContain("要我");
    expect(result.finalText).not.toContain("是否");
  });

  it("passes shared capability route metadata into the model/tool loop", async () => {
    const modelInputs: unknown[] = [];
    const result = await runConversationRuntimeTurn(
      input({
        text: "看一下这张图适合做什么分镜",
        attachments: [{ id: "image-1", kind: "image", mimeType: "image/png" }],
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-capability-route",
        orchestrate: () =>
          turn({
            intent: {
              kind: "chat",
              metadata: {
                capabilityRoute: {
                  abilityGroup: "vision",
                  intentKind: "media_understanding",
                  inputModalities: ["text", "image"],
                  outputModality: "text",
                  requiresMediaUnderstanding: true,
                  textModelCanHandleVision: false,
                  explicitGeneration: false,
                  reason: "带图片附件，但当前文本模型不具备视觉理解能力。",
                },
              },
            },
            metadata: {
              capabilityRoute: {
                abilityGroup: "vision",
                intentKind: "media_understanding",
                inputModalities: ["text", "image"],
                outputModality: "text",
                requiresMediaUnderstanding: true,
                textModelCanHandleVision: false,
                explicitGeneration: false,
                reason: "带图片附件，但当前文本模型不具备视觉理解能力。",
              },
            },
            shouldInvokeRecall: false,
          }),
        callModel: (request) => {
          modelInputs.push(request);
          return { finalText: "这张图可以先拆成主体、环境和镜头情绪。" };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: "ok",
        }),
      },
    );

    expect(result.finalText).toBe("这张图可以先拆成主体、环境和镜头情绪。");
    expect(result.capabilityRoute).toMatchObject({
      abilityGroup: "vision",
      intentKind: "media_understanding",
    });
    expect(result.operatorTrace.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "capability",
          stage: "capability.route",
          metadata: expect.objectContaining({
            abilityGroup: "vision",
          }),
        }),
      ]),
    );
    expect(modelInputs[0]).toMatchObject({
      metadata: {
        capabilityRoute: expect.objectContaining({
          abilityGroup: "vision",
        }),
      },
    });
    expect(JSON.stringify(modelInputs[0])).toContain("本轮能力路由");
  });

  it("preflights explicit Sogou Weixin article searches before model summarization", async () => {
    const modelInputs: unknown[] = [];
    const executedTools: unknown[] = [];
    const result = await runConversationRuntimeTurn(
      input({ text: "用搜索引擎搜狗去微信公众号搜索相关seedance2.0的教程" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-required-sogou-weixin",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求使用指定来源搜索后再回答。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "web_search",
            description: "Search the public web.",
            readOnly: true,
            metadata: { capability: "web.search", source: "built-in" },
          },
        ],
        callModel: (request) => {
          modelInputs.push(request);
          expect(request.messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                role: "tool",
                toolCallId: "required-web-search-sogou-weixin",
                content: expect.stringContaining("provider: sogou-weixin"),
              }),
            ]),
          );
          return {
            finalText: "我已经用搜狗微信搜过了，下面是命中的公众号教程。",
          };
        },
        executeTool: ({ call }) => {
          executedTools.push(call);
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content:
              "provider: sogou-weixin\nsource_type: weixin_article\n1. Seedance 2.0 教程 - https://mp.weixin.qq.com/s/example",
          };
        },
      },
    );

    expect(executedTools).toEqual([
      expect.objectContaining({
        id: "required-web-search-sogou-weixin",
        name: "web_search",
        args: expect.objectContaining({
          query: "seedance2.0 教程",
          provider: "sogou-weixin",
          source_type: "weixin_article",
        }),
      }),
    ]);
    expect(modelInputs.length).toBeGreaterThanOrEqual(1);
    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toBe("我已经用搜狗微信搜过了，下面是命中的公众号教程。");
    expect(result.events.map((event) => event.kind)).toEqual([
      "runtime.tool",
      "runtime.tool",
      "runtime.final",
    ]);
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain("tool.required");
  });

  it("preflights explicit X/Twitter learning research before model summarization", async () => {
    const modelInputs: unknown[] = [];
    const executedTools: unknown[] = [];
    const result = await runConversationRuntimeTurn(
      input({ text: "去学习推特学习最新的seedance 2.0经验" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-required-x-twitter",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求从 X/Twitter 来源学习最新经验。",
            shouldInvokeRecall: false,
            memoryDecision: {
              action: "candidate-review",
              reason: "先做来源取证，沉淀经验需要后续准入。",
            },
          }),
        tools: [
          {
            name: "x_search",
            description: "Search X/Twitter.",
            readOnly: true,
            metadata: { capability: "x.search", source: "built-in" },
          },
        ],
        callModel: (request) => {
          modelInputs.push(request);
          expect(request.messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                role: "tool",
                toolCallId: "required-x-search",
                content: expect.stringContaining("provider: x-twitter"),
              }),
            ]),
          );
          return {
            finalText: "我已经去 X/Twitter 查过了，下面是我实际看到的来源。",
          };
        },
        executeTool: ({ call }) => {
          executedTools.push(call);
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content:
              "status: success\nsummary: Found 1 X/Twitter candidate.\nquery: seedance 2.0\nprovider: x-twitter\nresult_count: 1\nresult_1: Seedance 2.0 latest workflow | url=https://x.com/example/status/1 | source=x-twitter | snippet=最新玩法线程",
          };
        },
      },
    );

    expect(executedTools).toEqual([
      expect.objectContaining({
        id: "required-x-search",
        name: "x_search",
        args: expect.objectContaining({
          query: "最新的seedance 2.0经验",
        }),
      }),
    ]);
    expect(modelInputs.length).toBeGreaterThanOrEqual(1);
    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("X/Twitter");
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain("tool.required");
  });

  it("corrects vague X/Twitter success replies so the user sees the actual observed source", async () => {
    const repairRequests: unknown[] = [];
    const result = await runConversationRuntimeTurn(
      input({ text: "去推特找找最新的Seedance 2.0经验" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-required-x-twitter-observed-source",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求从 X/Twitter 来源继续检索。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "x_search",
            description: "Search X/Twitter.",
            readOnly: true,
            metadata: { capability: "x.search", source: "built-in" },
          },
        ],
        callModel: (request) => {
          if (request.metadata?.repair === true) {
            repairRequests.push(request);
            expect(request.tools).toEqual([]);
            expect(JSON.stringify(request.messages)).toContain("Seedance 2.0 latest workflow");
            return {
              finalText:
                "我在 X/Twitter 结果里看到一条相关来源：Seedance 2.0 latest workflow，链接是 https://x.com/example/status/1，摘要提到最新玩法线程。",
            };
          }
          return {
            finalText: "我已经通过 X/Twitter 搜索到 Seedance 2.0 最新经验。",
          };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content:
            "status: success\nsummary: Found 1 X/Twitter candidate.\nquery: Seedance 2.0经验\nprovider: x-twitter\nresult_count: 1\nresult_1: Seedance 2.0 latest workflow | url=https://x.com/example/status/1 | source=x-twitter | snippet=最新玩法线程",
          output: {
            status: "success",
            summary: "Found 1 X/Twitter candidate.",
            query: "Seedance 2.0经验",
            provider: "x-twitter",
            results: [
              {
                title: "Seedance 2.0 latest workflow",
                url: "https://x.com/example/status/1",
                snippet: "最新玩法线程",
              },
            ],
            failures: [],
            next_actions: ["extract promising URLs with web_extract"],
          },
        }),
      },
    );

    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("Seedance 2.0 latest workflow");
    expect(result.finalText).toContain("https://x.com/example/status/1");
    expect(result.finalText).toContain("最新玩法线程");
    expect(repairRequests).toHaveLength(1);
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain("model.repair.accepted");
  });

  it("reports X/Twitter provider setup gaps instead of promising future browsing", async () => {
    const result = await runConversationRuntimeTurn(
      input({ text: "去推特找找最新的Seedance 2.0教程" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-required-x-twitter-needs-auth",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求从 X/Twitter 来源继续检索。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "x_search",
            description: "Search X/Twitter.",
            readOnly: true,
            metadata: { capability: "x.search", source: "built-in" },
          },
        ],
        callModel: () => ({
          finalText: "好的，我现在就去搜索。",
        }),
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: false,
          content:
            "status: needs-auth\nsummary: x_search needs a configured X/Twitter search provider before it can search live posts.\nquery: Seedance 2.0教程\nprovider: x-twitter\nresult_count: 0\nfailures: missing X search provider or API key\nnext_actions: configure XAI_API_KEY or an MCP/provider that exposes x_search; use web_search as a fallback for public web results",
          output: {
            status: "needs-auth",
            summary:
              "x_search needs a configured X/Twitter search provider before it can search live posts.",
            query: "Seedance 2.0教程",
            provider: "x-twitter",
            results: [],
            failures: ["missing X search provider or API key"],
            next_actions: [
              "configure XAI_API_KEY or an MCP/provider that exposes x_search",
              "use web_search as a fallback for public web results",
            ],
          },
          error: "x search provider unavailable",
        }),
      },
    );

    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("还不能直接搜索 X/Twitter");
    expect(result.finalText).toContain("missing X search provider or API key");
    expect(result.finalText).not.toContain("我现在就去搜索");
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain(
      "grounding.final.corrected",
    );
  });

  it("uses public web fallback results when X/Twitter provider needs auth", async () => {
    const executedTools: string[] = [];
    const result = await runConversationRuntimeTurn(
      input({ text: "去推特找找最新的Seedance 2.0教程" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-required-x-twitter-web-fallback",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求从 X/Twitter 来源继续检索。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "x_search",
            description: "Search X/Twitter.",
            readOnly: true,
            metadata: { capability: "x.search", source: "built-in" },
          },
          {
            name: "web_search",
            description: "Search the public web.",
            readOnly: true,
            metadata: { capability: "web.search", source: "built-in" },
          },
        ],
        callModel: () => ({
          finalText: "X/Twitter 没配 API key，所以不能搜。",
        }),
        executeTool: ({ call }) => {
          executedTools.push(call.name);
          if (call.name === "x_search") {
            return {
              callId: call.id,
              toolName: call.name,
              ok: false,
              content:
                "status: needs-auth\nsummary: x_search needs a configured X/Twitter search provider before it can search live posts.\nquery: Seedance 2.0教程\nprovider: x-twitter\nresult_count: 0\nfailures: missing X search provider or API key\nnext_actions: use web_search as a fallback for public web results",
              error: "x search provider unavailable",
              output: {
                status: "needs-auth",
                summary:
                  "x_search needs a configured X/Twitter search provider before it can search live posts.",
                query: "Seedance 2.0教程",
                provider: "x-twitter",
                results: [],
                failures: ["missing X search provider or API key"],
                next_actions: ["use web_search as a fallback for public web results"],
              },
            };
          }
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content:
              'status: success\nsummary: Found 1 source candidate(s) for "site:x.com OR site:twitter.com Seedance 2.0教程" via duckduckgo.\nquery: site:x.com OR site:twitter.com Seedance 2.0教程\nprovider: duckduckgo\nsource_type: web\nresult_count: 1\nresult_1: Seedance 2.0 latest X thread | url=https://x.com/example/status/1 | source=duckduckgo | snippet=公开网页索引到的 X/Twitter 教程讨论',
            output: {
              status: "success",
              summary:
                'Found 1 source candidate(s) for "site:x.com OR site:twitter.com Seedance 2.0教程" via duckduckgo.',
              query: "site:x.com OR site:twitter.com Seedance 2.0教程",
              provider: "duckduckgo",
              source_type: "web",
              results: [
                {
                  title: "Seedance 2.0 latest X thread",
                  url: "https://x.com/example/status/1",
                  snippet: "公开网页索引到的 X/Twitter 教程讨论",
                  source: "duckduckgo",
                },
              ],
              failures: [],
              next_actions: ["extract promising URLs with web_extract"],
            },
          };
        },
      },
    );

    expect(executedTools).toEqual(["x_search", "web_search"]);
    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("duckduckgo");
    expect(result.finalText).toContain("Seedance 2.0 latest X thread");
    expect(result.finalText).not.toContain("不能搜");
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain(
      "grounding.final.corrected",
    );
  });

  it("routes natural WeChat public-account article searches to Sogou Weixin grounding", async () => {
    const modelInputs: unknown[] = [];
    const executedTools: unknown[] = [];
    const result = await runConversationRuntimeTurn(
      input({ text: "去微信公众号搜索相关seedance2.0的教程" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-natural-weixin-source",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求搜索微信公众号文章来源。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "web_search",
            description: "Search the public web.",
            readOnly: true,
            metadata: { capability: "web.search", source: "built-in" },
          },
        ],
        callModel: (request) => {
          modelInputs.push(request);
          expect(request.messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                role: "system",
                content: expect.stringContaining("微信公众号文章、公众号文章或微信文章"),
              }),
              expect.objectContaining({
                role: "tool",
                toolCallId: "required-web-search-sogou-weixin",
                content: expect.stringContaining("provider: sogou-weixin"),
              }),
            ]),
          );
          return {
            finalText: "我按微信公众号文章来源搜过了：命中了 Seedance 2.0 教程。",
          };
        },
        executeTool: ({ call }) => {
          executedTools.push(call);
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content:
              'status: success\nsummary: Found 1 source candidate(s) for "seedance2.0 教程" via sogou-weixin.\nquery: seedance2.0 教程\nprovider: sogou-weixin\nsource_type: weixin_article\n1. Seedance 2.0 教程 - https://mp.weixin.qq.com/s/example',
          };
        },
      },
    );

    expect(executedTools).toEqual([
      expect.objectContaining({
        id: "required-web-search-sogou-weixin",
        name: "web_search",
        args: expect.objectContaining({
          query: "seedance2.0 教程",
          provider: "sogou-weixin",
          source_type: "weixin_article",
        }),
      }),
    ]);
    expect(modelInputs).toHaveLength(1);
    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toBe("我按微信公众号文章来源搜过了：命中了 Seedance 2.0 教程。");
  });

  it("passes current clock and client context to the shared model loop", async () => {
    const modelInputs: unknown[] = [];
    const result = await runConversationRuntimeTurn(
      input({
        surface: "weixin",
        channel: "weixin",
        text: "现在是什么时间？",
        receivedAtMs: Date.UTC(2026, 4, 14, 3, 4, 5),
        metadata: {
          timeZone: "Asia/Shanghai",
          locale: "zh-CN",
        },
      }),
      {
        nowMs: () => Date.UTC(2026, 4, 14, 3, 4, 5),
        turnIdFactory: () => "turn-clock-context",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户询问当前时间。",
            shouldInvokeRecall: false,
          }),
        callModel: (request) => {
          modelInputs.push(request);
          expect(request.messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                role: "system",
                content: expect.stringContaining("当前运行上下文"),
              }),
              expect.objectContaining({
                role: "system",
                content: expect.stringContaining("2026年5月14日星期四 11:04:05"),
              }),
              expect.objectContaining({
                role: "system",
                content: expect.stringContaining("客户端：weixin/weixin"),
              }),
            ]),
          );
          return {
            finalText: "现在是 2026年5月14日星期四 11:04:05（北京时间）。",
          };
        },
        executeTool: () => {
          throw new Error("time questions should not need a tool");
        },
      },
    );

    expect(modelInputs).toHaveLength(1);
    expect(result.finalText).toContain("2026年5月14日");
  });

  it("keeps required Sogou Weixin observations grounded when the model gives an ungrounded final", async () => {
    const repairRequests: unknown[] = [];
    const result = await runConversationRuntimeTurn(
      input({ text: "用搜索引擎搜狗去微信公众号搜索相关seedance2.0的教程" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-required-sogou-weixin-corrected",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求使用指定来源搜索后再回答。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "web_search",
            description: "Search the public web.",
            readOnly: true,
            metadata: { capability: "web.search", source: "built-in" },
          },
        ],
        callModel: (request) => {
          const { messages } = request;
          if (request.metadata?.repair === true) {
            repairRequests.push(request);
            expect(JSON.stringify(messages)).toContain("Seedance 2.0 公众号实操教程");
            return {
              finalText:
                "我已通过搜狗微信公众号文章搜索查到 2 个候选，其中包括 Seedance 2.0 公众号实操教程：https://mp.weixin.qq.com/s/seedance-tutorial，以及即梦 Seedance 2.0保姆级教程：https://mp.weixin.qq.com/s/jimeng-seedance。下一步可以读取其中一篇整理要点。",
            };
          }
          expect(messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                role: "tool",
                toolCallId: "required-web-search-sogou-weixin",
                content: expect.stringContaining("Seedance 2.0 公众号实操教程"),
              }),
            ]),
          );
          return {
            finalText: "很抱歉，我没有在搜狗微信公众号中找到相关内容。",
          };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content:
            'status: success\nsummary: Found 2 source candidate(s) for "seedance2.0 教程" via sogou-weixin.\nquery: seedance2.0 教程\nprovider: sogou-weixin\nsource_type: weixin_article\nresult_count: 2\nresult_1: Seedance 2.0 公众号实操教程 | url=https://mp.weixin.qq.com/s/seedance-tutorial | source=sogou-weixin | snippet=来自微信公众号的 Seedance 2.0 教程。\nresult_2: 即梦 Seedance 2.0保姆级教程 | url=https://mp.weixin.qq.com/s/jimeng-seedance | source=sogou-weixin | snippet=提示词和工作流玩法。\nnext_actions: extract promising URLs with web_extract',
          output: {
            status: "success",
            summary: 'Found 2 source candidate(s) for "seedance2.0 教程" via sogou-weixin.',
            query: "seedance2.0 教程",
            provider: "sogou-weixin",
            source_type: "weixin_article",
            results: [
              {
                title: "Seedance 2.0 公众号实操教程",
                url: "https://mp.weixin.qq.com/s/seedance-tutorial",
                snippet: "来自微信公众号的 Seedance 2.0 教程。",
                source: "sogou-weixin",
              },
              {
                title: "即梦 Seedance 2.0保姆级教程",
                url: "https://mp.weixin.qq.com/s/jimeng-seedance",
                snippet: "提示词和工作流玩法。",
                source: "sogou-weixin",
              },
            ],
            failures: [],
            next_actions: ["extract promising URLs with web_extract"],
          },
        }),
      },
    );

    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("我已通过搜狗微信公众号文章搜索");
    expect(result.finalText).toContain("Seedance 2.0 公众号实操教程");
    expect(result.finalText).toContain("https://mp.weixin.qq.com/s/seedance-tutorial");
    expect(result.finalText).not.toContain("没有在搜狗微信公众号中找到");
    expect(repairRequests).toHaveLength(1);
    expect(result.events.filter((event) => event.kind === "runtime.final")).toHaveLength(1);
    expect(result.events.at(-1)?.payload).toMatchObject({ replySource: "tool-loop" });
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain("model.repair.accepted");
  });

  it("reports required Sogou Weixin verification blocks instead of vague model fallback", async () => {
    const result = await runConversationRuntimeTurn(
      input({ text: "去微信公众号搜索相关seedance2.0的教程" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-required-sogou-weixin-blocked",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求搜索微信公众号文章来源。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "web_search",
            description: "Search the public web.",
            readOnly: true,
            metadata: { capability: "web.search", source: "built-in" },
          },
        ],
        callModel: () => ({
          finalText: "您是想执行哪个操作呢？比如 ComfyUI 的依赖修复或安装？",
        }),
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content:
            'status: blocked\nsummary: Search provider "sogou-weixin" needs verification or manual browser assistance for "seedance2.0 教程".\nquery: seedance2.0 教程\nprovider: sogou-weixin\nsource_type: weixin_article\nresult_count: 0\nfailures: sogou-weixin verification required\nnext_actions: open Sogou Weixin search in browser for operator verification',
          output: {
            status: "blocked",
            summary:
              'Search provider "sogou-weixin" needs verification or manual browser assistance for "seedance2.0 教程".',
            query: "seedance2.0 教程",
            provider: "sogou-weixin",
            source_type: "weixin_article",
            results: [],
            failures: ["sogou-weixin verification required"],
            next_actions: ["open Sogou Weixin search in browser for operator verification"],
          },
        }),
      },
    );

    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("触发了验证/反爬");
    expect(result.finalText).toContain("搜狗微信");
    expect(result.finalText).not.toContain("ComfyUI");
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain(
      "grounding.final.corrected",
    );
  });

  it("preflights Sogou Weixin searches inferred from recent channel context", async () => {
    const executedTools: unknown[] = [];
    const result = await runConversationRuntimeTurn(
      input({
        text: [
          "再去搜索看",
          "近期对话上下文：去微信公众号搜索相关seedance2.0的教程；微信公众号搜索文章需要去搜狗里找的",
        ].join("。"),
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-required-sogou-weixin-context",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求继续上一轮指定来源搜索。",
            shouldInvokeRecall: true,
          }),
        tools: [
          {
            name: "web_search",
            description: "Search the public web.",
            readOnly: true,
            metadata: { capability: "web.search", source: "built-in" },
          },
        ],
        callModel: ({ messages }) => {
          expect(messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                role: "tool",
                toolCallId: "required-web-search-sogou-weixin",
                content: expect.stringContaining("provider: sogou-weixin"),
              }),
            ]),
          );
          return {
            finalText: "我按上一轮要求用搜狗微信又搜了一次。",
          };
        },
        executeTool: ({ call }) => {
          executedTools.push(call);
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content:
              "provider: sogou-weixin\nsource_type: weixin_article\nquery: seedance2.0 教程\nfailures: none",
          };
        },
      },
    );

    expect(executedTools).toEqual([
      expect.objectContaining({
        name: "web_search",
        args: expect.objectContaining({
          query: "seedance2.0 教程",
          provider: "sogou-weixin",
          source_type: "weixin_article",
        }),
      }),
    ]);
    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toBe("我按上一轮要求用搜狗微信又搜了一次。");
  });

  it("does not treat labelled recent dialogue context as the current routing text", async () => {
    const executedTools: unknown[] = [];
    const result = await runConversationRuntimeTurn(
      input({
        text: [
          "现在时间是什么",
          "近期对话（只用于理解当前聊天，不要写入长期记忆）：用户：去微信公众号搜索相关seedance2.0的教程",
        ].join("\n\n"),
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-recent-dialogue-not-routing-text",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户问当前时间。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "web_search",
            description: "Search the public web.",
            readOnly: true,
            metadata: { capability: "web.search", source: "built-in" },
          },
        ],
        callModel: () => ({ finalText: "现在是测试时间。" }),
        executeTool: ({ call }) => {
          executedTools.push(call);
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content: "should not run",
          };
        },
      },
    );

    expect(executedTools).toEqual([]);
    expect(result.finalText).toBe("现在是测试时间。");
  });

  it("preflights explicit browser navigation before model summarization", async () => {
    const executedTools: unknown[] = [];
    const result = await runConversationRuntimeTurn(
      input({ text: "用谷歌浏览器打开 https://example.com/seedance 看一下最新教程" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-required-browser-navigate",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户明确要求用浏览器打开页面查看。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "browser_navigate",
            description: "Navigate a shared desktop browser.",
            readOnly: false,
            metadata: { capability: "browser.navigate", source: "built-in" },
          },
        ],
        callModel: ({ messages }) => {
          expect(messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                role: "tool",
                toolCallId: "required-browser-navigate",
                content: expect.stringContaining("title: Seedance tutorial"),
              }),
            ]),
          );
          return {
            finalText: "我已用浏览器打开页面，看到 Seedance tutorial。",
          };
        },
        executeTool: ({ call }) => {
          executedTools.push(call);
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content:
              "status: success\nsummary: browser_navigate opened the requested page.\nurl: https://example.com/seedance\ntitle: Seedance tutorial\nsnapshot: Seedance tutorial page with latest examples.",
            output: {
              success: true,
              url: "https://example.com/seedance",
              title: "Seedance tutorial",
              snapshot: "Seedance tutorial page with latest examples.",
            },
          };
        },
      },
    );

    expect(executedTools).toEqual([
      expect.objectContaining({
        id: "required-browser-navigate",
        name: "browser_navigate",
        args: expect.objectContaining({
          url: "https://example.com/seedance",
        }),
      }),
    ]);
    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("浏览器打开");
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain("tool.required");
  });

  it("keeps sandbox backend admission evidence in runtime tool metadata", async () => {
    const result = await runConversationRuntimeTurn(
      input({ text: "用谷歌浏览器打开 https://example.com 看一下" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-tool-metadata",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求打开网页。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "browser_navigate",
            description: "Navigate a shared desktop browser.",
            readOnly: false,
            metadata: { capability: "browser.navigate", source: "built-in" },
          },
        ],
        callModel: () => ({ finalText: "浏览器已打开。" }),
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: "status: success\nsummary: opened https://example.com",
          metadata: {
            agentOsSandboxBackendAdmission: {
              ok: true,
              status: "admitted",
              backend: "network-limited",
            },
          },
        }),
      },
    );

    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.tool",
          payload: expect.objectContaining({
            tool: expect.objectContaining({
              metadata: expect.objectContaining({
                toolResultMetadata: expect.objectContaining({
                  agentOsSandboxBackendAdmission: expect.objectContaining({
                    ok: true,
                    status: "admitted",
                    backend: "network-limited",
                  }),
                }),
              }),
            }),
          }),
        }),
      ]),
    );
    expect(result.transcriptMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          metadata: expect.objectContaining({
            toolResultMetadata: expect.objectContaining({
              agentOsSandboxBackendAdmission: expect.objectContaining({
                ok: true,
                status: "admitted",
                backend: "network-limited",
              }),
            }),
          }),
        }),
      ]),
    );
  });

  it("replays rich assistant/tool transcript into the next model turn", async () => {
    const firstTurn = await runConversationRuntimeTurn(
      input({
        text: "去搜狗搜索公众号有没有最新的seedance2.0 教程",
        messageId: "message-rich-1",
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-rich-1",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求搜索微信公众号来源。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "web_search",
            description: "Search the public web.",
            readOnly: true,
            metadata: { capability: "web.search", source: "built-in" },
          },
        ],
        callModel: ({ messages }) => {
          const hasSogouObservation = messages.some(
            (message) =>
              message.role === "tool" &&
              message.toolCallId === "required-web-search-sogou-weixin" &&
              message.content.includes("provider: sogou-weixin"),
          );
          return hasSogouObservation
            ? { finalText: "我在搜狗微信找到了几篇，但不确定哪篇最新。" }
            : { finalText: "还没搜索。" };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content:
            'status: success\nsummary: Found 2 source candidate(s) for "seedance2.0 教程" via sogou-weixin.\nquery: seedance2.0 教程\nprovider: sogou-weixin\nsource_type: weixin_article\nresult_count: 2\nresult_1: 即梦 Seedance 2.0保姆级教程 | url=https://mp.weixin.qq.com/s/old | source=sogou-weixin | snippet=2026年02月更新\nresult_2: Seedance 2.0杀疯了 | url=https://mp.weixin.qq.com/s/newer | source=sogou-weixin | snippet=玩法分享',
          output: {
            status: "success",
            query: "seedance2.0 教程",
            provider: "sogou-weixin",
            source_type: "weixin_article",
            results: [
              {
                title: "即梦 Seedance 2.0保姆级教程",
                url: "https://mp.weixin.qq.com/s/old",
                snippet: "2026年02月更新",
              },
              {
                title: "Seedance 2.0杀疯了",
                url: "https://mp.weixin.qq.com/s/newer",
                snippet: "玩法分享",
              },
            ],
          },
        }),
      },
    );

    expect(firstTurn.transcriptMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          toolCalls: expect.arrayContaining([
            expect.objectContaining({
              id: "required-web-search-sogou-weixin",
              name: "web_search",
            }),
          ]),
        }),
        expect.objectContaining({
          role: "tool",
          toolCallId: "required-web-search-sogou-weixin",
          content: expect.stringContaining("provider: sogou-weixin"),
        }),
      ]),
    );

    const secondModelInputs: readonly ConversationRuntimeModelToolMessage[][] = [];
    const capturedInputs: ConversationRuntimeModelToolMessage[][] = [];
    const secondTurn = await runConversationRuntimeTurn(
      input({
        text: "这不是最新的，去推特找找看",
        messageId: "message-rich-2",
        history: firstTurn.transcriptMessages,
      }),
      {
        nowMs: () => 2,
        turnIdFactory: () => "turn-rich-2",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户纠正上一轮搜索结果并要求切换到 X/Twitter 继续找。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "x_search",
            description: "Search X/Twitter.",
            readOnly: true,
            metadata: { capability: "x.search", source: "built-in" },
          },
        ],
        callModel: ({ messages }) => {
          capturedInputs.push([...messages]);
          const toolResult = messages.find(
            (message) => message.role === "tool" && message.toolCallId === "call-x-search",
          );
          if (toolResult !== undefined) {
            return {
              finalText: `我已接着上一轮主题去 X/Twitter 找：${toolResult.content}`,
            };
          }
          expect(messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                role: "tool",
                toolCallId: "required-web-search-sogou-weixin",
                content: expect.stringContaining("Seedance 2.0"),
              }),
              expect.objectContaining({
                role: "assistant",
                content: expect.stringContaining("搜狗微信公众号文章搜索"),
              }),
            ]),
          );
          return {
            toolCalls: [
              {
                id: "call-x-search",
                name: "x_search",
                args: {
                  query: "Seedance 2.0 保姆级教程 latest",
                  reason: "用户要求在推特继续查找上一轮 Seedance 2.0 教程主题",
                  max_results: 5,
                },
              },
            ],
          };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content:
            'status: success\nsummary: Found 1 X/Twitter candidate for "Seedance 2.0 保姆级教程 latest".\nquery: Seedance 2.0 保姆级教程 latest\nprovider: x-twitter\nresult_count: 1\nresult_1: Seedance 2.0 latest thread | url=https://x.com/example/status/1 | source=x-twitter | snippet=latest tutorial thread',
        }),
      },
    );

    expect(secondModelInputs).toEqual([]);
    expect(capturedInputs[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          toolCallId: "required-web-search-sogou-weixin",
          content: expect.stringContaining("provider: sogou-weixin"),
        }),
      ]),
    );
    expect(secondTurn.replySource).toBe("tool-loop");
    expect(secondTurn.finalText).toContain("X/Twitter");
    expect(secondTurn.transcriptMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          toolCallId: "call-x-search",
          content: expect.stringContaining("provider: x-twitter"),
        }),
      ]),
    );
  });

  it("turns a follow-up learning question after search candidates into extraction before answering", async () => {
    const firstTurn = await runConversationRuntimeTurn(
      input({
        text: "去搜狗搜搜公众号有没有最新的seedance3.0的教程",
        messageId: "message-learn-loop-1",
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-learn-loop-1",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求搜索微信公众号文章来源。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "web_search",
            description: "Search the public web.",
            readOnly: true,
            metadata: { capability: "web.search", source: "built-in" },
          },
          {
            name: "web_extract",
            description: "Extract a public web page.",
            readOnly: true,
            metadata: { capability: "web.extract", source: "built-in" },
          },
        ],
        callModel: ({ messages }) => {
          const hasSearch = messages.some(
            (message) =>
              message.role === "tool" && message.toolCallId === "required-web-search-sogou-weixin",
          );
          return {
            finalText: hasSearch ? "我在搜狗微信公众号找到了 2 篇候选文章。" : "还没搜索。",
          };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content:
            'status: success\nsummary: Found 2 source candidate(s) for "seedance3.0 教程" via sogou-weixin.\nquery: seedance3.0 教程\nprovider: sogou-weixin\nsource_type: weixin_article\nresult_count: 2\nresult_1: Seedance 3.0 + 市面AI工具全攻略 | url=https://mp.weixin.qq.com/s/seedance3-guide | source=sogou-weixin | snippet=工作流组合和提示词\nresult_2: Seedance 2.0和可灵3.0——工具更新 | url=https://mp.weixin.qq.com/s/noise | source=sogou-weixin | snippet=混合工具更新\nnext_actions: extract promising URLs with web_extract',
          output: {
            status: "success",
            summary: 'Found 2 source candidate(s) for "seedance3.0 教程" via sogou-weixin.',
            query: "seedance3.0 教程",
            provider: "sogou-weixin",
            source_type: "weixin_article",
            results: [
              {
                title: "Seedance 3.0 + 市面AI工具全攻略",
                url: "https://mp.weixin.qq.com/s/seedance3-guide",
                snippet: "工作流组合和提示词",
              },
              {
                title: "Seedance 2.0和可灵3.0——工具更新",
                url: "https://mp.weixin.qq.com/s/noise",
                snippet: "混合工具更新",
              },
            ],
            failures: [],
            next_actions: ["extract promising URLs with web_extract"],
          },
        }),
      },
    );

    const executedTools: unknown[] = [];
    const secondTurn = await runConversationRuntimeTurn(
      input({
        text: "你学了什么？？",
        messageId: "message-learn-loop-2",
        history: firstTurn.transcriptMessages,
      }),
      {
        nowMs: () => 2,
        turnIdFactory: () => "turn-learn-loop-2",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户追问上一轮搜索结果到底学到了什么。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "web_search",
            description: "Search the public web.",
            readOnly: true,
            metadata: { capability: "web.search", source: "built-in" },
          },
          {
            name: "web_extract",
            description: "Extract a public web page.",
            readOnly: true,
            metadata: { capability: "web.extract", source: "built-in" },
          },
        ],
        callModel: ({ messages }) => {
          const extractResult = messages.find(
            (message) =>
              message.role === "tool" && message.toolCallId === "required-web-extract-learning-1",
          );
          expect(messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                role: "tool",
                toolCallId: "required-web-search-sogou-weixin",
                content: expect.stringContaining("source candidate"),
              }),
            ]),
          );
          return extractResult === undefined
            ? { finalText: "我刚刚找到了候选链接，所以已经学了这些标题。" }
            : {
                finalText:
                  "我读取了第一篇公众号文章。学到的是：Seedance 3.0 教程重点在多工具组合、提示词拆解和场景化工作流，而不是只看标题列表。",
              };
        },
        executeTool: ({ call }) => {
          executedTools.push(call);
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content:
              "status: success\nsummary: Extracted 88 preview character(s) from https://mp.weixin.qq.com/s/seedance3-guide.\nurl: https://mp.weixin.qq.com/s/seedance3-guide\ntitle: Seedance 3.0 + 市面AI工具全攻略\ntext_preview: 这篇文章讲 Seedance 3.0 的教程重点：先拆脚本，再做场景提示词，然后和剪辑、图像、视频工具组成工作流。\nresult_count: 0\nnext_actions: admit with director.learning.admit or inspect with browser_snapshot",
            output: {
              status: "success",
              summary:
                "Extracted 88 preview character(s) from https://mp.weixin.qq.com/s/seedance3-guide.",
              url: "https://mp.weixin.qq.com/s/seedance3-guide",
              title: "Seedance 3.0 + 市面AI工具全攻略",
              text_preview:
                "这篇文章讲 Seedance 3.0 的教程重点：先拆脚本，再做场景提示词，然后和剪辑、图像、视频工具组成工作流。",
              body: "这篇文章讲 Seedance 3.0 的教程重点：先拆脚本，再做场景提示词，然后和剪辑、图像、视频工具组成工作流。",
              next_actions: ["admit with director.learning.admit"],
            },
          };
        },
      },
    );

    expect(executedTools).toEqual([
      expect.objectContaining({
        id: "required-web-extract-learning-1",
        name: "web_extract",
        args: expect.objectContaining({
          url: "https://mp.weixin.qq.com/s/seedance3-guide",
          mode: "auto",
        }),
      }),
    ]);
    expect(secondTurn.replySource).toBe("tool-loop");
    expect(secondTurn.finalText).toContain("我已读取");
    expect(secondTurn.finalText).toContain("正文要点");
    expect(secondTurn.finalText).toContain("先拆脚本");
    expect(secondTurn.finalText).toContain("场景提示词");
    expect(secondTurn.finalText).not.toContain("已经学了这些标题");
    expect(secondTurn.operatorTrace.items.map((item) => item.stage)).toContain("tool.required");
  });

  it("does not claim learning when follow-up extraction from search candidates fails", async () => {
    const history: readonly ConversationRuntimeModelToolMessage[] = [
      {
        role: "user",
        content: "去搜狗搜索公众号有没有最新的seedance3.0教程",
      },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "required-web-search-sogou-weixin",
            name: "web_search",
            args: {
              query: "seedance3.0 教程",
              provider: "sogou-weixin",
              source_type: "weixin_article",
            },
            readOnly: true,
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "required-web-search-sogou-weixin",
        content:
          'status: success\nsummary: Found 1 source candidate(s) for "seedance3.0 教程" via sogou-weixin.\nquery: seedance3.0 教程\nprovider: sogou-weixin\nsource_type: weixin_article\nresult_count: 1\nresult_1: Seedance 3.0 保姆级教程 | url=https://mp.weixin.qq.com/s/blocked | source=sogou-weixin | snippet=标题摘要\nnext_actions: extract promising URLs with web_extract',
        metadata: {
          ok: true,
          toolName: "web_search",
        },
      },
      {
        role: "assistant",
        content: "我找到了一篇候选文章。",
      },
    ];
    const executedTools: unknown[] = [];
    const result = await runConversationRuntimeTurn(
      input({
        text: "你学了什么？？",
        messageId: "message-learn-loop-failed",
        history,
      }),
      {
        nowMs: () => 3,
        turnIdFactory: () => "turn-learn-loop-failed",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户追问上一轮搜索结果到底学到了什么。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "web_extract",
            description: "Extract a public web page.",
            readOnly: true,
            metadata: { capability: "web.extract", source: "built-in" },
          },
        ],
        callModel: ({ messages }) => {
          expect(messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                role: "tool",
                toolCallId: "required-web-extract-learning-1",
                content: expect.stringContaining("status: error"),
              }),
            ]),
          );
          return {
            finalText: "我学到了这篇文章是 Seedance 3.0 保姆级教程。",
          };
        },
        executeTool: ({ call }) => {
          executedTools.push(call);
          return {
            callId: call.id,
            toolName: call.name,
            ok: false,
            content:
              "status: error\nsummary: Web extraction failed for https://mp.weixin.qq.com/s/blocked.\nurl: https://mp.weixin.qq.com/s/blocked\nfailures: page requires verification\nnext_actions: try browser_navigate/browser_snapshot when available",
            error: "page requires verification",
            output: {
              status: "error",
              summary: "Web extraction failed for https://mp.weixin.qq.com/s/blocked.",
              url: "https://mp.weixin.qq.com/s/blocked",
              failures: ["page requires verification"],
              next_actions: ["try browser_navigate/browser_snapshot when available"],
            },
          };
        },
      },
    );

    expect(executedTools).toHaveLength(1);
    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("还没有真正学到正文");
    expect(result.finalText).toContain("page requires verification");
    expect(result.finalText).not.toContain("我学到了这篇文章是");
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain(
      "grounding.final.corrected",
    );
  });

  it("registers X/Twitter search as a default built-in model tool", () => {
    const tools = createConversationRuntimeToolRegistry().listModelTools();
    expect(tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "x_search",
          readOnly: true,
          metadata: expect.objectContaining({ capability: "x.search" }),
        }),
      ]),
    );
  });

  it("returns a degraded error when the model port cannot answer", async () => {
    const result = await runConversationRuntimeTurn(input({ text: "你会什么？" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-chat-model-unavailable",
      orchestrate: () =>
        turn({
          intent: { kind: "capability-intro" },
          userText: "结合当前能力自然回答。",
          memoryDecision: { action: "never-store", reason: "能力问答不写入记忆。" },
          shouldInvokeRecall: true,
        }),
      resolveCapabilityContext: () => ({
        status: "hit",
        visibleSummary: "已启用 Skill 2 个。",
        hits: [{ id: "skill:storyboard", source: "skill", status: "hit" }],
      }),
      callModel: () => {
        throw new Error("provider not configured");
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "ok",
      }),
    });

    expect(result.replySource).toBe("degraded-error");
    expect(result.finalText).toContain("模型不可用");
    expect(result.events[0]?.kind).toBe("runtime.error");
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain("model.loop.degraded");
  });

  it("returns a degraded error when the model loop stops without final text", async () => {
    const result = await runConversationRuntimeTurn(input({ text: "你会什么？" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-chat-no-final",
      orchestrate: () =>
        turn({
          intent: { kind: "capability-intro" },
          userText: "结合当前能力自然回答，不要使用用户文本兜底。",
          memoryDecision: { action: "never-store", reason: "能力问答不写入记忆。" },
          shouldInvokeRecall: false,
        }),
      callModel: () => ({}),
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "ok",
      }),
    });

    expect(result.replySource).toBe("degraded-error");
    expect(result.finalText).toContain("模型不可用");
    expect(result.finalText).not.toContain("结合当前能力自然回答");
    expect(result.events).toEqual([
      expect.objectContaining({
        kind: "runtime.error",
        payload: expect.objectContaining({
          code: "model_unavailable",
          message: expect.stringContaining("no-final-text"),
        }),
      }),
    ]);
  });

  it("does not prefetch experience candidates for capability intro turns", async () => {
    const executedTools: string[] = [];
    const result = await runConversationRuntimeTurn(input({ text: "你现在能做什么？" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-capability-intro-no-candidate-prefetch",
      orchestrate: () =>
        turn({
          intent: { kind: "capability-intro" },
          userText: "结合当前能力自然回答。",
          memoryDecision: { action: "never-store", reason: "能力问答不写入记忆。" },
          shouldInvokeRecall: true,
        }),
      resolveCapabilityContext: () => ({
        status: "hit",
        visibleSummary: "已启用 Skill 2 个，已发布经验 3 条。",
        hiddenPromptBlock: "Skill: storyboard; Knowledge: 镜头语言",
        hits: [{ id: "skill:storyboard", source: "skill", status: "hit" }],
      }),
      tools: createDirectorConversationRuntimeTools(),
      callModel: ({ messages }) => {
        expect(messages.some((message) => message.role === "tool")).toBe(false);
        return {
          finalText: "我可以帮你把想法做成脚本、分镜和可审查的制作结果。",
        };
      },
      executeTool: ({ call }) => {
        executedTools.push(call.name);
        return {
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: "ok",
        };
      },
    });

    expect(executedTools).not.toContain("director.experience.candidates.list");
    expect(result.replySource).toBe("model");
    expect(result.finalText).toContain("我可以帮你把想法做成脚本");
  });

  it("returns a Chinese fallback summary when search tools complete with no results until max turns", async () => {
    let searchIndex = 0;
    const result = await runConversationRuntimeTurn(
      input({
        text: "去互联网看看最近生成图片分镜图哪个模型最厉害",
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-chat-empty-search-max-turns",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "去互联网看看最近生成图片分镜图哪个模型最厉害",
            shouldInvokeRecall: false,
          }),
        tools: [{ name: "web_search", description: "Search the public web.", readOnly: true }],
        callModel: () => {
          searchIndex += 1;
          return {
            toolCalls: [
              {
                id: `empty-search-${searchIndex}`,
                name: "web_search",
                args: { query: "image generation storyboard model" },
              },
            ],
          };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content:
            'status: warning\nsummary: No web search results found for "image generation storyboard model".\nquery: image generation storyboard model\nprovider: duckduckgo\nresult_count: 0\nnext_actions: try another search source',
          metadata: {
            result_count: 0,
            provider: "duckduckgo",
          },
        }),
      },
    );

    expect(result.replySource).toBe("structured-renderer");
    expect(result.finalText).toContain("没有拿到可靠结果");
    expect(result.finalText).toContain("换搜索源");
    expect(result.finalText).not.toMatch(/duckduckgo|next_actions|web_extract|provider/iu);
    expect(result.finalText).not.toContain("模型不可用");
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.final",
          payload: expect.objectContaining({
            text: expect.stringContaining("没有拿到可靠结果"),
          }),
        }),
      ]),
    );
  });

  it("surfaces successful tool user-facing projections when the model stops without final text", async () => {
    const result = await runConversationRuntimeTurn(
      input({ text: "把刚才抓到的正文准入经验候选" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-learning-admit-projection-fallback",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求把已读取正文准入为经验候选。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "learning_projection_probe",
            description: "Return a completed learning projection.",
            readOnly: true,
          },
        ],
        callModel: ({ messages }) => {
          const hasToolProjection = messages.some(
            (message) =>
              message.role === "tool" &&
              message.toolCallId === "call-admit-learning" &&
              message.content.includes("生成 1 条待审经验候选"),
          );
          return hasToolProjection
            ? {}
            : {
                toolCalls: [
                  {
                    id: "call-admit-learning",
                    name: "learning_projection_probe",
                    args: {
                      sources: [
                        {
                          title: "AI短剧镜头语言",
                          body: "短剧镜头经验：15秒短剧分镜先用中景建立人物和环境。",
                        },
                      ],
                    },
                  },
                ],
              };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: "status: success\nsummary: 生成 1 条待审经验候选。",
          output: {
            userFacingProjection: {
              userText:
                "这次学习我整理好了\n可用要点：\n1. Pasted lesson: AI短剧镜头语言\n我会先把这些内容放进待确认区，避免低质量内容污染长期经验。",
              briefStatus: "learning-candidate",
            },
          },
        }),
      },
    );

    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("Pasted lesson: AI短剧镜头语言");
    expect(result.finalText).not.toContain("模型不可用");
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain(
      "tool.result.final.fallback",
    );
  });

  it("keeps local current time in the final reply even when live search has no results", async () => {
    let searchIndex = 0;
    const result = await runConversationRuntimeTurn(
      input({
        text: "先别创建任务，也别学习存库。我就问一句：现在到底几点？顺便去互联网上看看最近生成图片、分镜图这块哪个模型更厉害；如果搜索源没给到可靠结果，也别卡死。",
        receivedAtMs: Date.UTC(2026, 4, 14, 12, 46, 30),
        metadata: {
          timeZone: "Asia/Shanghai",
          locale: "zh-CN",
        },
      }),
      {
        nowMs: () => Date.UTC(2026, 4, 14, 12, 46, 30),
        turnIdFactory: () => "turn-chat-time-plus-empty-search-max-turns",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户同时询问当前时间和实时检索结果。",
            shouldInvokeRecall: false,
          }),
        tools: [{ name: "web_search", description: "Search the public web.", readOnly: true }],
        callModel: () => {
          searchIndex += 1;
          return {
            toolCalls: [
              {
                id: `time-plus-empty-search-${searchIndex}`,
                name: "web_search",
                args: { query: "生成图片 分镜图 模型 最新 2026" },
              },
            ],
          };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content:
            'status: warning\nsummary: No web search results found for "生成图片 分镜图 模型 最新 2026".\nquery: 生成图片 分镜图 模型 最新 2026\nprovider: duckduckgo\nresult_count: 0\nnext_actions: try another search source',
          metadata: {
            result_count: 0,
            provider: "duckduckgo",
          },
        }),
      },
    );

    expect(result.replySource).toBe("structured-renderer");
    expect(result.finalText).toContain("2026年5月14日星期四 20:46:30");
    expect(result.finalText).toContain("没有拿到可靠结果");
    expect(result.finalText).not.toMatch(/duckduckgo|next_actions|web_extract|provider/iu);
  });

  it("returns an OpenCLI result fallback when the model keeps calling tools until max turns", async () => {
    let modelTurn = 0;
    const result = await runConversationRuntimeTurn(
      input({ text: "用 OpenCLI 查一下 HackerNews 热榜前两条，只回答标题。" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-chat-opencli-result-max-turns",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求调用 OpenCLI 获取 HackerNews 热榜。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "director.opencli.invoke",
            description: "Invoke a read-only OpenCLI command.",
            readOnly: true,
          },
        ],
        callModel: () => {
          modelTurn += 1;
          return {
            toolCalls: [
              {
                id: `opencli-hn-top-${modelTurn}`,
                name: "director.opencli.invoke",
                args: { operationId: "opencli.hackernews.top", args: { limit: 2 } },
              },
            ],
          };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content:
            "status: success\nsummary: OpenCLI 执行完成：hackernews/top\nnext_actions: 基于 output.json/text 回答用户；如果为空，不要说学到了。",
          output: {
            json: [
              { title: "First HN story", url: "https://news.ycombinator.com/item?id=1" },
              { title: "Second HN story", url: "https://news.ycombinator.com/item?id=2" },
            ],
            site: "hackernews",
            name: "top",
          },
          metadata: {
            sourceKind: "opencli",
            sourceRef: "opencli:hackernews/top",
            sourceAccessStatus: "available",
          },
        }),
      },
    );

    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("First HN story");
    expect(result.finalText).toContain("Second HN story");
    expect(result.finalText).not.toContain("模型不可用");
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.final",
          payload: expect.objectContaining({
            text: expect.stringContaining("First HN story"),
          }),
        }),
      ]),
    );
  });

  it("prefers a topic-matching OpenCLI search result over a later generic Hacker News list fallback", async () => {
    const result = await runConversationRuntimeTurn(
      input({ text: "去 HackerNews 查一下今天大家在讨论 Claude Code 什么，只给我三条。" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-chat-opencli-search-not-overwritten",
        maxModelToolLoopTurns: 1,
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要从 HackerNews 查询 Claude Code 相关讨论。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "director.opencli.invoke",
            description: "Invoke a read-only OpenCLI command.",
            readOnly: true,
          },
          {
            name: "web_search",
            description: "Search the public web.",
            readOnly: true,
            metadata: { capability: "web.search" },
          },
        ],
        callModel: () => ({
          toolCalls: [
            {
              id: "opencli-hn-search-claude-code",
              name: "director.opencli.invoke",
              args: {
                operationId: "opencli.hackernews.search",
                args: { query: "Claude Code" },
              },
            },
            {
              id: "opencli-hn-new-generic",
              name: "director.opencli.invoke",
              args: { operationId: "opencli.hackernews.new", args: { limit: 5 } },
            },
            {
              id: "web-search-claude-code-generic",
              name: "web_search",
              args: { query: "Claude Code HackerNews today" },
            },
          ],
        }),
        executeTool: ({ call }) => {
          if (call.name === "web_search") {
            return {
              callId: call.id,
              toolName: call.name,
              ok: true,
              content:
                'status: success\nsummary: Found 1 source candidate(s) for "Claude Code HackerNews today" via duckduckgo.\nquery: Claude Code HackerNews today\nprovider: duckduckgo\nsource_type: web\nresult_count: 1\nresult_1: Claude Code - AI Chat | url=https://chatwithai.app/ | source=duckduckgo | snippet=Access Claude by Anthropic plus top AI models.',
              output: {
                status: "success",
                query: "Claude Code HackerNews today",
                provider: "duckduckgo",
                source_type: "web",
                results: [
                  {
                    title: "Claude Code - AI Chat",
                    url: "https://chatwithai.app/",
                    snippet: "Access Claude by Anthropic plus top AI models.",
                  },
                ],
              },
            };
          }
          const operationId = String(call.args.operationId ?? "");
          if (operationId === "opencli.hackernews.search") {
            return {
              callId: call.id,
              toolName: call.name,
              ok: true,
              content:
                "status: success\nsummary: OpenCLI 执行完成：hackernews/search\nnext_actions: 基于 output.json/text 回答用户；如果为空，不要说学到了。",
              output: {
                site: "hackernews",
                name: "search",
                query: "Claude Code",
                json: [
                  {
                    title: "Claude 3.7 Sonnet and Claude Code",
                    url: "https://www.anthropic.com/news/claude-3-7-sonnet",
                  },
                  {
                    title: "How Claude Code works in large codebases",
                    url: "https://example.test/claude-code-large-codebases",
                  },
                ],
              },
              metadata: {
                operationId,
                sourceKind: "opencli",
                sourceRef: "opencli:hackernews/search",
                sourceAccessStatus: "available",
              },
            };
          }
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content:
              "status: success\nsummary: OpenCLI 执行完成：hackernews/new\nnext_actions: 基于 output.json/text 回答用户；如果为空，不要说学到了。",
            output: {
              site: "hackernews",
              name: "new",
              json: [
                {
                  title: "Jelly Tide: My Honest 30-Day Results",
                  url: "https://finance.example.test/jelly-tide",
                },
                {
                  title: "Establishing AI and data sovereignty",
                  url: "https://technologyreview.example.test/sovereignty",
                },
              ],
            },
            metadata: {
              operationId,
              sourceKind: "opencli",
              sourceRef: "opencli:hackernews/new",
              sourceAccessStatus: "available",
            },
          };
        },
      },
    );

    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("Claude 3.7 Sonnet and Claude Code");
    expect(result.finalText).toContain("How Claude Code works in large codebases");
    expect(result.finalText).toContain("来源：opencli:hackernews/search");
    expect(result.finalText).not.toContain("Jelly Tide");
    expect(result.finalText).not.toContain("Claude Code - AI Chat");
    expect(result.finalText).not.toContain("duckduckgo");
    expect(result.finalText).not.toContain("opencli:hackernews/new");
  });

  it("does not report missing models when max turns stops after browser tool failures", async () => {
    let modelTurn = 0;
    const result = await runConversationRuntimeTurn(
      input({
        text: "用谷歌浏览器打开这个链接 https://x.com/cellinlab/status/2054424434736349433",
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-chat-browser-failure-max-turns",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用谷歌浏览器打开这个链接 https://x.com/cellinlab/status/2054424434736349433",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "browser_navigate",
            description: "Navigate a shared desktop browser.",
            readOnly: false,
          },
        ],
        callModel: () => {
          modelTurn += 1;
          return {
            toolCalls: [
              {
                id: `browser-fail-${modelTurn}`,
                name: "browser_navigate",
                args: { url: "https://x.com/cellinlab/status/2054424434736349433" },
              },
            ],
          };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: false,
          content:
            "status: error\nsummary: browser_navigate failed for https://x.com/cellinlab/status/2054424434736349433.\nfailures: fetch failed\nnext_actions: retry after browser setup",
          output: {
            status: "error",
            summary:
              "browser_navigate failed for https://x.com/cellinlab/status/2054424434736349433.",
            failures: ["fetch failed"],
            next_actions: ["retry after browser setup"],
          },
          error: "fetch failed",
        }),
        maxModelToolLoopTurns: 2,
      },
    );

    expect(result.replySource).toBe("structured-renderer");
    expect(result.finalText).toContain("没能用浏览器打开");
    expect(result.finalText).toContain("https://x.com/cellinlab/status/2054424434736349433");
    expect(result.finalText).not.toContain("模型不可用");
    expect(result.finalText).not.toContain("fetch failed");
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.final",
          payload: expect.objectContaining({
            text: expect.stringContaining("没能用浏览器打开"),
          }),
        }),
      ]),
    );
  });

  it("finalizes an aborted model loop as cancelled instead of completed", async () => {
    const controller = new AbortController();
    let runId = "";
    const registry = createConversationRunRegistry({
      nowMs: () => 1,
      turnRunIdFactory: () => "turn-run-interrupted",
    });
    const result = await runConversationRuntimeTurn(input({ text: "请慢慢读取链接" }), {
      runRegistry: registry,
      nowMs: () => 1,
      turnIdFactory: () => "turn-interrupted",
      orchestrate: () =>
        turn({
          intent: { kind: "capability-intro" },
          userText: "结合工具读取结果自然回答。",
          shouldInvokeRecall: false,
        }),
      callModel: ({ signal }) => {
        expect(signal).toBe(controller.signal);
        registry.stop(runId, { requestedBy: "user", reason: "unit-test-stop" });
        return { finalText: "这条回复已经被停止，不能发出。" };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "ok",
      }),
      createAbortController: () => {
        return controller;
      },
      onRunStarted: (record) => {
        runId = record.turnRunId;
      },
    });

    expect(result.turnRunId).toBe("turn-run-interrupted");
    expect(result.finalText).toBeUndefined();
    expect(result.replySource).toBe("local-command");
    expect(result.events).toEqual([
      expect.objectContaining({
        kind: "runtime.ack",
        payload: expect.objectContaining({
          message: expect.stringContaining("已停止"),
        }),
      }),
    ]);
    expect(registry.read("turn-run-interrupted")?.status).toBe("cancelled");
  });

  it("maps approval-gated model tool requests to runtime approval events before execution", async () => {
    let executed = false;
    const result = await runConversationRuntimeTurn(input({ text: "启用浏览 Skill" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-tool-approval",
      orchestrate: () =>
        turn({
          intent: { kind: "management-command" },
          userText: "按用户要求修改 Skill 启用状态。",
          shouldInvokeRecall: false,
        }),
      tools: [
        {
          name: "director.skills.set_enabled",
          description: "启用或停用 Skill。",
          readOnly: false,
          metadata: {
            capability: "skill.management",
            reviewGated: true,
            risk: "capability-configuration",
          },
        },
      ],
      callModel: () => ({
        toolCalls: [
          {
            id: "call-enable-skill",
            name: "director.skills.set_enabled",
            args: { skillId: "skill.browser", enabled: true },
          },
        ],
      }),
      executeTool: () => {
        executed = true;
        return {
          callId: "call-enable-skill",
          toolName: "director.skills.set_enabled",
          ok: true,
          content: "should not execute",
        };
      },
    });

    expect(executed).toBe(false);
    expect(result.replySource).toBe("structured-renderer");
    expect(result.finalText).toBeUndefined();
    expect(result.events).toEqual([
      expect.objectContaining({
        kind: "runtime.tool",
        payload: expect.objectContaining({
          tool: expect.objectContaining({
            id: "call-enable-skill",
            name: "director.skills.set_enabled",
            phase: "requested",
            requiresApproval: true,
          }),
        }),
      }),
      expect.objectContaining({
        kind: "runtime.approval",
        payload: expect.objectContaining({
          approval: expect.objectContaining({
            id: "tool:call-enable-skill",
            status: "pending",
            metadata: expect.objectContaining({
              toolName: "director.skills.set_enabled",
              permissionStatus: "ask",
              toolCall: expect.objectContaining({
                id: "call-enable-skill",
                name: "director.skills.set_enabled",
                args: { skillId: "skill.browser", enabled: true },
              }),
            }),
          }),
        }),
      }),
    ]);
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain("tool.permission");
    expect(result.runtimeEventsV1).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "approval.requested",
          payload: expect.objectContaining({
            approvalId: "tool:call-enable-skill",
            toolName: "director.skills.set_enabled",
            status: "pending",
          }),
        }),
      ]),
    );
  });

  it("does not let the model claim a disabled Skill was used after a failed Skill view", async () => {
    const result = await runConversationRuntimeTurn(
      input({ text: "用 backend snapshot 这个 Skill 回答" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-disabled-skill-observation",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求使用一个 Skill 回答。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "director.skills.view",
            description: "View an approved Skill.",
            readOnly: true,
            metadata: { capability: "skill.view" },
          },
        ],
        callModel: ({ messages }) => {
          if (!messages.some((message) => message.role === "tool")) {
            return {
              toolCalls: [
                {
                  id: "call-disabled-skill-view",
                  name: "director.skills.view",
                  args: { skillId: "skill.backend-snapshot" },
                },
              ],
            };
          }
          return {
            finalText: "我已经使用 Backend Skills Snapshot 这个 Skill 回答了。",
          };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: false,
          content:
            "status: disabled\nsummary: Skill 已关闭：Backend Skills Snapshot。这次不会加载全文，也不会自动执行。\nskill_id: skill.backend-snapshot\nenabled: false\nmodel_visible: false\nnext_actions: 如用户要使用它，先请求启用该 Skill；当前轮不要假装已经读取或执行。",
          output: {
            status: "disabled",
            summary: "Skill 已关闭：Backend Skills Snapshot。这次不会加载全文，也不会自动执行。",
            skill_id: "skill.backend-snapshot",
            enabled: false,
            model_visible: false,
            next_actions: ["如用户要使用它，先请求启用该 Skill；当前轮不要假装已经读取或执行。"],
          },
        }),
      },
    );

    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("Skill 已关闭");
    expect(result.finalText).toContain("Backend Skills Snapshot");
    expect(result.finalText).toContain("先启用");
    expect(result.finalText).not.toContain("我已经使用 Backend Skills Snapshot");
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain(
      "tool.observation.final.corrected",
    );
  });

  it("does not let the model claim a model-disabled Skill was loaded after a failed Skill view", async () => {
    const result = await runConversationRuntimeTurn(
      input({ text: "调用 operator only browser Skill" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-model-disabled-skill-observation",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求使用一个模型不可调用的 Skill。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "director.skills.view",
            description: "View an approved Skill.",
            readOnly: true,
            metadata: { capability: "skill.view" },
          },
        ],
        callModel: ({ messages }) => {
          if (!messages.some((message) => message.role === "tool")) {
            return {
              toolCalls: [
                {
                  id: "call-model-disabled-skill-view",
                  name: "director.skills.view",
                  args: { skillId: "skill.operator-only-browser" },
                },
              ],
            };
          }
          return {
            finalText: "我已经读取并使用 Operator Only Browser Skill 了。",
          };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: false,
          content:
            "status: model_invocation_disabled\nsummary: Skill 不能由模型直接调用：Operator Only Browser Skill。这次不会读取全文，也不会自动执行。\nskill_id: skill.operator-only-browser\nenabled: false\nconfigured_enabled: true\nmodel_visible: false\nnext_actions: 需要操作员在 Skills 管理里调整模型调用权限后再用。",
          output: {
            status: "model_invocation_disabled",
            summary:
              "Skill 不能由模型直接调用：Operator Only Browser Skill。这次不会读取全文，也不会自动执行。",
            skill_id: "skill.operator-only-browser",
            enabled: false,
            configured_enabled: true,
            model_visible: false,
            next_actions: ["需要操作员在 Skills 管理里调整模型调用权限后再用。"],
          },
        }),
      },
    );

    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("不能由模型直接调用");
    expect(result.finalText).toContain("skill.operator-only-browser");
    expect(result.finalText).not.toContain("已经读取并使用");
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain(
      "tool.observation.final.corrected",
    );
  });

  it("does not let the model claim a needs-setup Skill was used after a failed Skill use", async () => {
    const result = await runConversationRuntimeTurn(
      input({ text: "调用 Twitter Research Skill 学习最新 Seedance" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-needs-setup-skill-observation",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求使用一个依赖外部工具的 Skill。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "director.skills.use",
            description: "Use an approved Skill.",
            readOnly: true,
            metadata: { capability: "skill.use" },
          },
        ],
        callModel: ({ messages }) => {
          if (!messages.some((message) => message.role === "tool")) {
            return {
              toolCalls: [
                {
                  id: "call-needs-setup-skill-use",
                  name: "director.skills.use",
                  args: { skillId: "skill.twitter-research" },
                },
              ],
            };
          }
          return {
            finalText: "我已经使用 Twitter Research Skill 学习了最新 Seedance。",
          };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: false,
          content:
            "status: needs_setup\nsummary: Skill 依赖未就绪：Twitter Research Skill。Skill 声明的工具尚不可用：x_search。x_search: needs-auth；X provider needs an API key.\nskill_id: skill.twitter-research\nenabled: false\nconfigured_enabled: true\nmodel_visible: false\nmissing_tools: x_search\nnext_actions: x_search: 配置 X/Twitter API provider。",
          output: {
            status: "needs_setup",
            summary:
              "Skill 依赖未就绪：Twitter Research Skill。Skill 声明的工具尚不可用：x_search。x_search: needs-auth；X provider needs an API key.",
            skill_id: "skill.twitter-research",
            enabled: false,
            configured_enabled: true,
            model_visible: false,
            missing_tools: ["x_search"],
            next_actions: ["x_search: 配置 X/Twitter API provider。"],
          },
        }),
      },
    );

    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("Skill 依赖未就绪");
    expect(result.finalText).toContain("x_search");
    expect(result.finalText).toContain("先完成依赖工具配置");
    expect(result.finalText).not.toContain("已经使用 Twitter Research Skill");
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain(
      "tool.observation.final.corrected",
    );
  });

  it("does not let the model claim a removed Skill was used after a missing Skill observation", async () => {
    const result = await runConversationRuntimeTurn(input({ text: "调用旧的 Twitter Skill" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-missing-skill-observation",
      orchestrate: () =>
        turn({
          intent: { kind: "chat" },
          userText: "用户要求使用一个可能已被删除的 Skill。",
          shouldInvokeRecall: false,
        }),
      tools: [
        {
          name: "director.skills.use",
          description: "Use an approved Skill.",
          readOnly: true,
          metadata: { capability: "skill.use" },
        },
      ],
      callModel: ({ messages }) => {
        if (!messages.some((message) => message.role === "tool")) {
          return {
            toolCalls: [
              {
                id: "call-missing-skill-use",
                name: "director.skills.use",
                args: { skillId: "skill.old-twitter-research" },
              },
            ],
          };
        }
        return {
          finalText: "我已经使用旧的 Twitter Research Skill 学习了。",
        };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: false,
        content:
          "status: missing_skill\nsummary: Skill 不存在或已从当前已批准快照移除：skill.old-twitter-research。\nskill_id: skill.old-twitter-research\nenabled: false\nmodel_visible: false\nnext_actions: 重新调用 director.skills.list 刷新 Skill 索引；当前轮不要假装已经读取、应用或执行。",
        output: {
          status: "missing_skill",
          summary: "Skill 不存在或已从当前已批准快照移除：skill.old-twitter-research。",
          skill_id: "skill.old-twitter-research",
          enabled: false,
          model_visible: false,
          next_actions: [
            "重新调用 director.skills.list 刷新 Skill 索引；当前轮不要假装已经读取、应用或执行。",
          ],
        },
      }),
    });

    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("Skill 不存在");
    expect(result.finalText).toContain("skill.old-twitter-research");
    expect(result.finalText).toContain("刷新 Skill 索引");
    expect(result.finalText).not.toContain("已经使用旧的 Twitter Research Skill");
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain(
      "tool.observation.final.corrected",
    );
  });

  it("does not let the model claim a Skill was used after only listing the Skill index", async () => {
    const result = await runConversationRuntimeTurn(
      input({ text: "用 ComfyUI Skill 做一个图片流程" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-skill-index-not-use",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户要求使用 Skill，需要先发现再按需查看。",
            shouldInvokeRecall: false,
          }),
        tools: [
          {
            name: "director.skills.list",
            description: "List available Skills.",
            readOnly: true,
            inputSchema: {},
            metadata: { capability: "skill.index" },
          },
        ],
        callModel: ({ messages }) => {
          if (!messages.some((message) => message.role === "tool")) {
            return {
              toolCalls: [
                {
                  id: "call-skill-list",
                  name: "director.skills.list",
                  args: { query: "ComfyUI 图片流程", limit: 3 },
                },
              ],
            };
          }
          return {
            finalText: "我已经使用 ComfyUI Skill 生成了图片流程。",
          };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content:
            "status: success\nsummary: 当前匹配 Skill 1 个。\nskills: comfyui\nskill_ids: comfyui\nnext_actions: 这里只是索引；真正按 Skill 执行前必须调用 director.skills.view 读取 Skill 内容。",
          output: {
            status: "success",
            summary: "当前匹配 Skill 1 个。",
            skills: [{ id: "comfyui", title: "ComfyUI", enabled: true }],
            skill_ids: ["comfyui"],
            next_actions: [
              "这里只是索引；真正按 Skill 执行前必须调用 director.skills.view 读取 Skill 内容。",
            ],
          },
        }),
      },
    );

    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("只完成了 Skill 索引检索");
    expect(result.finalText).toContain("comfyui");
    expect(result.finalText).toContain("director.skills.view");
    expect(result.finalText).not.toContain("已经使用 ComfyUI Skill 生成");
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain(
      "tool.observation.final.corrected",
    );
  });

  it("resolves capability context before dispatching production starts", async () => {
    const sequence: string[] = [];
    const result = await runConversationRuntimeTurn(input({ text: "/制作 生成15秒短剧" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-production",
      orchestrate: () =>
        turn({
          intent: {
            kind: "production-start",
            objective: "生成15秒短剧",
            command: { name: "production.start", raw: "/制作", args: "生成15秒短剧" },
          },
          userText: "准备启动制作。",
          memoryDecision: { action: "store-result-only", reason: "制作结果才进入候选。" },
          shouldInvokeRecall: true,
          shouldCreateRun: true,
        }),
      resolveCapabilityContext: () => {
        sequence.push("capability");
        return {
          status: "hit",
          hiddenPromptBlock: "published knowledge and skills",
          hits: [{ id: "knowledge:shot-language", source: "knowledge", status: "hit" }],
        };
      },
      startProduction: (request) => {
        sequence.push("production");
        expect(request.capabilityPacket?.hiddenPromptBlock).toBe("published knowledge and skills");
        expect(request.mode).toBe("start");
        expect(request.objective).toBe("生成15秒短剧");
        return {
          ok: true,
          status: "running",
          runId: "run-1",
          blueprintId: "blueprint-1",
          finalText: "这是最终草案，不展示内部流程。",
          recallStatus: "hit",
          skillStatus: "hit",
          memoryStatus: "miss",
          artifacts: [
            {
              id: "artifact-1",
              kind: "run",
              title: "制作运行",
            },
          ],
          approvals: [
            {
              id: "approval-1",
              title: "分镜规划",
              status: "pending",
              summary: "需要人工批准。",
            },
          ],
        };
      },
    });

    expect(sequence).toEqual(["capability", "production"]);
    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toBe("这是最终草案，不展示内部流程。");
    expect(result.runId).toBe("run-1");
    expect(result.artifactIds).toEqual(["artifact-1"]);
    expect(result.approvalIds).toEqual(["approval-1"]);
    expect(result.events.map((event) => event.kind)).toEqual([
      "runtime.artifact",
      "runtime.approval",
      "runtime.final",
    ]);
    expect(result.events.at(-1)?.payload).toMatchObject({ replySource: "tool-loop" });
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain("production.dispatched");
  });

  it("does not promote production degraded status text into a final reply", async () => {
    const result = await runConversationRuntimeTurn(input({ text: "/制作 生成15秒短剧" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-production-no-final",
      orchestrate: () =>
        turn({
          intent: { kind: "production-start", objective: "生成15秒短剧" },
          userText: "启动制作。",
          shouldInvokeRecall: false,
          shouldCreateRun: true,
        }),
      startProduction: () => ({
        ok: false,
        status: "failed",
        replySource: "degraded-error",
        runId: "run-no-final",
        metadata: {
          message: "模型草案不可用，不能当成最终成品。",
        },
      }),
    });

    expect(result.replySource).toBe("degraded-error");
    expect(result.finalText).toBeUndefined();
    expect(result.events).toEqual([
      expect.objectContaining({
        kind: "runtime.error",
        payload: expect.objectContaining({
          code: "production_final_unavailable",
          message: expect.stringContaining("模型草案不可用"),
        }),
      }),
    ]);
    expect(result.events.some((event) => event.kind === "runtime.final")).toBe(false);
  });

  it("routes production supplements to the production port without forcing a new run", async () => {
    const result = await runConversationRuntimeTurn(
      input({
        text: "加一个反转结尾",
        trustedContext: { activeRunId: "run-existing" },
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-supplement",
        orchestrate: () =>
          turn({
            intent: {
              kind: "production-supplement",
              objective: "生成15秒短剧",
              supplement: "加一个反转结尾",
            },
            userText: "继续修改上一版。",
            shouldInvokeRecall: true,
            shouldCreateRun: false,
            shouldAttachToActiveSession: true,
          }),
        resolveCapabilityContext: () => ({ status: "miss", hiddenPromptBlock: "", hits: [] }),
        startProduction: (request) => {
          expect(request.mode).toBe("supplement");
          expect(request.trustedContext?.activeRunId).toBe("run-existing");
          expect(request.supplement).toBe("加一个反转结尾");
          return {
            ok: true,
            status: "running",
            runId: "run-existing",
            finalText: "已按反转结尾更新上一版。",
          };
        },
      },
    );

    expect(result.runId).toBe("run-existing");
    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toBe("已按反转结尾更新上一版。");
    expect(result.turn?.shouldCreateRun).toBe(false);
    expect(result.turn?.shouldAttachToActiveSession).toBe(true);
  });

  it("does not call capability resolver for low-signal turns", async () => {
    let calls = 0;
    const result = await runConversationRuntimeTurn(input({ text: "你好" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-1",
      orchestrate: () =>
        turn({
          userText: "我在。",
          memoryDecision: { action: "never-store", reason: "低信号闲聊。" },
          shouldInvokeRecall: false,
        }),
      resolveCapabilityContext: () => {
        calls += 1;
        return { status: "hit", hits: [] };
      },
    });

    expect(calls).toBe(0);
    expect(result.capabilityPacket).toBeUndefined();
    expect(result.operatorTrace.items.map((item) => item.stage)).not.toContain(
      "capability.resolved",
    );
    expect(result.memoryDecision?.action).toBe("never-store");
    expect(result.replySource).toBe("degraded-error");
    expect(result.finalText).toContain("模型不可用");
  });

  it("exposes experience candidate list as a runtime tool for natural follow-up turns", async () => {
    const tools = createDirectorConversationRuntimeTools();
    expect(tools.map((tool) => tool.name)).toContain("director.experience.candidates.list");

    const result = await runConversationRuntimeTurn(input({ text: "你发来我看看" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-experience-candidates-follow-up",
      orchestrate: () =>
        turn({
          intent: { kind: "chat" },
          userText:
            "如果近期学习工具生成过待审经验候选，先读取候选列表，再把候选内容直接发给用户看。",
          shouldInvokeRecall: true,
          memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
        }),
      resolveCapabilityContext: () => ({
        status: "hit",
        visibleSummary: "上一轮学习生成了待审经验候选，可读取候选列表。",
        hits: [{ id: "experience-candidates:latest", source: "session", status: "hit" }],
      }),
      tools,
      callModel: ({ messages }) => {
        const toolResult = messages.find((message) => message.role === "tool");
        if (toolResult !== undefined) {
          return {
            finalText: `这几条我发你看：\n${toolResult.content}`,
          };
        }
        return {
          toolCalls: [
            {
              id: "call-list-candidates",
              name: "director.experience.candidates.list",
              args: { status: "pending", maxItems: 4 },
            },
          ],
        };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content:
          "1. Seedance 2.0 最新玩法\n摘要：包含运镜、首帧和视频参数。\n2. Seedance 2.0 镜头经验\n摘要：按场景拆分提示词。",
      }),
    });

    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("这几条我发你看");
    expect(result.finalText).toContain("Seedance 2.0 最新玩法");
    expect(result.events.map((event) => event.kind)).toEqual([
      "runtime.tool",
      "runtime.tool",
      "runtime.final",
    ]);
    expect(result.events.at(-1)?.payload).toMatchObject({ replySource: "tool-loop" });
  });

  it("uses a completed experience candidate tool result when the follow-up model turn fails", async () => {
    const registry = createConversationRunRegistry({
      nowMs: () => 1,
      turnRunIdFactory: () => "turn-run-experience-candidates-fallback",
    });
    let modelTurns = 0;

    const result = await runConversationRuntimeTurn(input({ text: "发来看看" }), {
      runRegistry: registry,
      nowMs: () => 1,
      turnIdFactory: () => "turn-experience-candidates-fallback",
      orchestrate: () =>
        turn({
          intent: { kind: "chat" },
          userText: "读取候选列表并直接给用户看。",
          shouldInvokeRecall: true,
          memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
        }),
      resolveCapabilityContext: () => ({
        status: "hit",
        visibleSummary: "上一轮学习生成了待审经验候选，可读取候选列表。",
        hits: [{ id: "experience-candidates:latest", source: "session", status: "hit" }],
      }),
      tools: createDirectorConversationRuntimeTools(),
      callModel: ({ messages }) => {
        modelTurns += 1;
        if (!messages.some((message) => message.role === "tool")) {
          return {
            toolCalls: [
              {
                id: "call-list-candidates",
                name: "director.experience.candidates.list",
                args: { status: "pending", maxItems: 4 },
              },
            ],
          };
        }
        throw new Error("模型调用失败：HTTP 503 Service Unavailable");
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content:
          "1. Seedance 2.0 最新玩法\n摘要：包含运镜、首帧和视频参数。\n2. Seedance 2.0 镜头经验\n摘要：按场景拆分提示词。\n给用户回复时直接展示候选内容；用户可以自然说“收录第1条”“拒绝第2条”“继续找”。",
      }),
    });

    expect(modelTurns).toBe(2);
    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("Seedance 2.0 最新玩法");
    expect(result.finalText).not.toContain("模型不可用");
    expect(result.events.some((event) => event.kind === "runtime.error")).toBe(false);
    expect(registry.read("turn-run-experience-candidates-fallback")).toMatchObject({
      status: "completed",
      failureTaxonomy: [],
      userVisibleSummary: expect.stringContaining("Seedance 2.0 最新玩法"),
    });
  });

  it("renders experience candidate fallback without the old mechanical learned-summary opener", async () => {
    const result = await runConversationRuntimeTurn(input({ text: "刚才学到了什么？" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-experience-candidates-empty-model-fallback",
      orchestrate: () =>
        turn({
          intent: { kind: "chat" },
          userText: "读取候选列表并直接讲清楚学到了什么。",
          shouldInvokeRecall: true,
          memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
        }),
      resolveCapabilityContext: () => ({
        status: "hit",
        visibleSummary: "最近学习生成了待审经验候选，可读取候选列表。",
        hits: [{ id: "experience-candidates:latest", source: "session", status: "hit" }],
      }),
      tools: createDirectorConversationRuntimeTools(),
      maxModelToolLoopTurns: 1,
      callModel: () => ({ finalText: undefined }),
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "status: success\nsummary: 已读取 1 条经验候选。",
        output: {
          candidates: [
            {
              id: "experience-comfyui-codex",
              title: "ComfyUI 节点图劝退？让 Codex 替你学就行",
              summary: "让 Codex 帮你安装 ComfyUI，并直接参考 67 个 workflow JSON 学习节点图。",
              applicability:
                "先用 comfy-cli 安装 ComfyUI，再把已有 workflow 当成可复制样例去拆解。",
              sourceRef: "https://x.com/wei_wang/status/2057083939781517422",
              evidencePreview: "github.com/Lesilva/comfyui-workflows — 67 个 workflow JSON。",
            },
          ],
        },
      }),
    });

    expect(result.finalText).toContain("还没有读到完整正文");
    expect(result.finalText).toContain("ComfyUI");
    expect(result.finalText).toContain("https://x.com/wei_wang/status/2057083939781517422");
    expect(result.finalText).not.toContain("我这次学到的不是一堆原文");
    expect(result.finalText).not.toContain("核心结论");
    expect(result.finalText).not.toContain("下一步");
    expect(result.finalText).not.toContain("<learning-evidence-context>");
  });

  it("does not expose raw empty experience candidate tool output as the final reply", async () => {
    const result = await runConversationRuntimeTurn(input({ text: "刚才学到了什么？" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-empty-experience-candidates-natural-fallback",
      orchestrate: () =>
        turn({
          intent: { kind: "chat" },
          userText: "读取候选列表并自然回答。",
          shouldInvokeRecall: true,
          memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
        }),
      tools: createDirectorConversationRuntimeTools(),
      maxModelToolLoopTurns: 1,
      callModel: () => ({ finalText: undefined }),
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: [
          "status: success",
          "summary: 当前没有匹配的待审经验候选。",
          "filter: pending",
          "total_candidates: 102",
          "pending_learning_confirmations: 0",
          "next_actions: 如果用户问刚才学到了什么，但这里为空，要明确说还没有可展示候选；可以让用户重新 /学习 链接或打开经验库查看隔离记录。",
        ].join("\n"),
        output: {
          candidates: [],
          totalCandidates: 102,
          pendingLearningConfirmations: 0,
        },
      }),
    });

    expect(result.finalText).toContain("当前没有可展示的待审经验候选");
    expect(result.finalText).not.toContain("status: success");
    expect(result.finalText).not.toContain("total_candidates");
    expect(result.finalText).not.toContain("next_actions");
  });

  it("renders readable experience candidate fallback as a natural source summary", async () => {
    const result = await runConversationRuntimeTurn(input({ text: "刚才学到了什么？" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-experience-readable-source-fallback",
      orchestrate: () =>
        turn({
          intent: { kind: "chat" },
          userText: "读取候选列表并直接讲清楚学到了什么。",
          shouldInvokeRecall: true,
          memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
        }),
      tools: createDirectorConversationRuntimeTools(),
      maxModelToolLoopTurns: 1,
      callModel: () => ({ finalText: undefined }),
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "status: success\nsummary: 已读取 1 条经验候选。",
        output: {
          candidates: [
            {
              id: "experience-readable-source",
              title: "ComfyUI 工作流学习",
              summary: "正文可用：先让 Codex 安装 ComfyUI，再把工作流整理成可复用模板。",
              applicability:
                "先拿现成 workflow JSON，再配中文 README，写清楚输入参数、输出效果和显存要求。",
              contentQuality: "正文可用，但需要入库前复核。",
              sourceRef: "https://x.com/wei_wang/status/2057083939781517422",
              sourceDocument: {
                content: [
                  "第一次打开 ComfyUI 时，作者被节点图劝退；这次改成让 Codex 帮忙安装、调用和跑工作流。",
                  "核心方法是先拿现成 workflow JSON，再配中文 README，写清楚输入参数、输出效果和显存要求。",
                  "Use when Director Angel preserved source evidence workflow step internal prompt",
                ].join("\n\n"),
              },
            },
          ],
        },
      }),
    });

    expect(result.finalText).toContain("模型服务暂时不可用");
    expect(result.finalText).toContain("我先基于已读到的内容给你一个摘要");
    expect(result.finalText).toContain("核心是：");
    expect(result.finalText).toContain("workflow JSON");
    expect(result.finalText).toContain("来源：https://x.com/wei_wang/status/2057083939781517422");
    expect(result.finalText).toContain("要收录吗？");
    expect(result.finalText).not.toContain("核心结论");
    expect(result.finalText).not.toContain("下一步");
    expect(result.finalText).not.toContain("正文里比较有用的部分");
    expect(result.finalText).not.toContain("Use when Director Angel");
    expect(result.finalText).not.toContain("preserved source evidence");
  });

  it("replaces low-quality prompt-template candidate summaries with a usable structured answer", async () => {
    const promptTemplate = [
      "老师我学会了",
      "GPT Image 2提示词分享👇",
      "# 酷辣女特工写真｜7张单独精修照｜开源稳定提示词",
      "主题为：",
      "「酷辣女特工高级影棚写真」",
      "整体风格参考：高奢影棚写真 + 冷艳女特工气质 + 极简时尚大片 + 白色缎面束身造型 + 危险又优雅的 femme fatale 审美。",
      "## 一、人物一致性",
      "7 张照片里都必须清楚看起来是同一个真实女性。不要变成陌生人，不要欧美化，不要网红化，不要过度磨皮，不要 AI 假脸。",
      "## 二、整体气质",
      "冷艳、酷辣、危险、优雅、昂贵、强势、神秘。",
      "## 三、服装造型",
      "白色 / 香槟白 / 珍珠白缎面束身连体衣或短款束腰 bodysuit。",
      "## 四、配饰要求",
      "建议配饰包括多层珍珠项链、银色金属项链、耳饰、珍珠手链。",
      "## 六、场景与光线",
      "极简纯色影棚背景，高级柔和棚拍光。",
      "## 七、道具要求",
      "黑色消音手枪造型道具只作为姿势配件出现，不出现开枪、血腥、攻击场面。如果平台对枪械敏感，也可以替换为黑色未来感金属道具。",
      "## 九、7张分镜要求",
      "### 第 1 张：半跪前倾造型",
      "### 第 2 张：坐姿持道具特工照",
      "### 第 3 张：站姿时尚大片",
      "### 第 4 张：地面侧坐舒展照",
      "### 第 5 张：全身正立肖像",
      "### 第 6 张：侧躺持道具造型",
      "### 第 7 张：平躺仰拍电影感",
      "## 十一、负面要求",
      "请避免以下问题：不要低俗色情感、不要廉价情趣内衣感、不要错误手指、不要奇怪肢体。",
    ].join("\n\n");
    const result = await runConversationRuntimeTurn(input({ text: "刚才学到了什么？" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-prompt-template-low-quality-replacement",
      orchestrate: () =>
        turn({
          intent: { kind: "chat" },
          userText: "读取候选列表并直接讲清楚学到了什么。",
          shouldInvokeRecall: true,
          memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
        }),
      tools: createDirectorConversationRuntimeTools(),
      callModel: ({ messages }) => {
        if (!messages.some((message) => message.role === "tool")) {
          return {
            toolCalls: [
              {
                id: "call-list-candidates",
                name: "director.experience.candidates.list",
                args: { status: "pending", maxItems: 1 },
              },
            ],
          };
        }
        return {
          finalText: [
            "**核心结论**",
            "不要变成陌生人，不要欧美化，不要网红化，不要过度磨皮，不要 AI 假脸。",
            "",
            "**学到的内容**",
            "1. 不是战斗状态，而是时尚大片式危险感。",
            "2. 请避免以下问题：",
            "3. GPT Image 2提示词分享👇",
            "4. 如果平台对枪械敏感，也可以替换为：",
          ].join("\n"),
        };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "status: success\nsummary: 已读取 1 条经验候选。",
        output: {
          candidates: [
            {
              id: "experience-prompt-template",
              title: "Pasted lesson: (Note Tweet)",
              summary: "经验提炼：人物一致性 7 张照片里都必须清楚看起来是同一个真实女性。",
              sourceRef: "https://x.com/zhongying14/status/2057776452615974924",
              sourceDocument: { content: promptTemplate },
            },
          ],
        },
      }),
    });

    expect(result.finalText).toContain("酷辣女特工高级影棚写真");
    expect(result.finalText).toContain("最值得保存的三点");
    expect(result.finalText).toContain("人物一致性");
    expect(result.finalText).toContain("半跪前倾造型");
    expect(result.finalText).toContain("平台敏感时替换");
    expect(result.finalText).toContain("https://x.com/zhongying14/status/2057776452615974924");
    expect(result.finalText).not.toContain("2. 请避免以下问题：");
    expect(result.finalText).not.toContain("3. GPT Image 2提示词分享");
    expect(result.finalText).not.toContain("如果平台对枪械敏感，也可以替换为：\n");
  });

  it("does not repeat the full deterministic learning fallback for the same candidate", async () => {
    const result = await runConversationRuntimeTurn(
      input({
        text: "你学习到什么了？",
        history: [
          {
            role: "user",
            content: "你学到了什么？",
          },
          {
            role: "assistant",
            content: [
              "我读到的核心是：ComfyUI 节点图劝退后的学习方法。正文可用：先让 Codex 安装 ComfyUI，再把工作流整理成可复用模板。",
              "正文里比较有用的部分：第一次打开 ComfyUI 时，作者被节点图劝退。",
              "来源：https://x.com/wei_wang/status/2057083939781517422",
            ].join("\n"),
          },
        ],
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-repeated-learning-fallback",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户再次追问同一学习结果。",
            shouldInvokeRecall: true,
            memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
          }),
        tools: createDirectorConversationRuntimeTools(),
        callModel: () => {
          throw new Error("fetch failed");
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: "status: success\nsummary: 已读取 1 条经验候选，用于回答学习结果。",
          output: {
            candidates: [
              {
                id: "experience-repeat-fallback",
                status: "pending",
                title: "ComfyUI 节点图劝退后的学习方法",
                summary: "正文可用：先让 Codex 安装 ComfyUI，再把工作流整理成可复用模板。",
                applicability:
                  "先拿现成 workflow JSON，再配中文 README，写清楚输入参数、输出效果和显存要求。",
                sourceRef: "https://x.com/wei_wang/status/2057083939781517422",
                sourceDocument: {
                  content:
                    "第一次打开 ComfyUI 时，作者被节点图劝退；这次改成让 Codex 帮忙安装、调用和跑工作流。核心方法是先拿现成 workflow JSON，再配中文 README，写清楚输入参数、输出效果和显存要求。",
                },
              },
            ],
          },
        }),
      },
    );

    expect(result.finalText).toContain("刚才那条还是这个意思");
    expect(result.finalText).toContain("模型还是暂时不可用");
    expect(result.finalText).toContain("要收录吗？");
    expect(result.finalText).toContain("https://x.com/wei_wang/status/2057083939781517422");
    expect(result.finalText).not.toContain("正文里比较有用的部分");
    expect(result.finalText).not.toContain("第一次打开 ComfyUI");
  });

  it("renders metadata-only experience candidate fallback without pretending body was read", async () => {
    const result = await runConversationRuntimeTurn(input({ text: "刚才学到了什么？" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-experience-metadata-only-fallback",
      orchestrate: () =>
        turn({
          intent: { kind: "chat" },
          userText: "读取候选列表并直接讲清楚学到了什么。",
          shouldInvokeRecall: true,
          memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
        }),
      tools: createDirectorConversationRuntimeTools(),
      maxModelToolLoopTurns: 1,
      callModel: () => ({ finalText: undefined }),
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "status: success\nsummary: 已读取 1 条经验候选。",
        output: {
          candidates: [
            {
              id: "experience-metadata-only",
              title: "X 登录页",
              summary: "抓取内容主要是 X 登录/注册或侧栏信息，不能算成功学习正文。",
              contentQuality: "抓取内容主要是 X 登录/注册或侧栏信息，不能算成功学习正文。",
              sourceRef: "https://x.com/login",
            },
          ],
        },
      }),
    });

    expect(result.finalText).toContain("还没有读到完整正文");
    expect(result.finalText).toContain("X 登录页");
    expect(result.finalText).toContain("来源：https://x.com/login");
    expect(result.finalText).not.toContain("核心结论");
    expect(result.finalText).not.toContain("下一步");
  });

  it("lets the model synthesize readable experience candidate answers from tool evidence", async () => {
    const result = await runConversationRuntimeTurn(input({ text: "回答我总听学习到了什么" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-experience-candidates-readable-fallback",
      orchestrate: () =>
        turn({
          intent: { kind: "chat" },
          userText: "读取候选列表并直接讲清楚学到了什么。",
          shouldInvokeRecall: true,
          memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
        }),
      resolveCapabilityContext: () => ({
        status: "hit",
        visibleSummary: "上一轮学习生成了待审经验候选，可读取候选列表。",
        hits: [{ id: "experience-candidates:latest", source: "session", status: "hit" }],
      }),
      tools: createDirectorConversationRuntimeTools(),
      callModel: ({ messages }) => {
        if (!messages.some((message) => message.role === "tool")) {
          return {
            toolCalls: [
              {
                id: "call-list-candidates",
                name: "director.experience.candidates.list",
                args: { status: "pending", maxItems: 4 },
              },
            ],
          };
        }
        expect(
          messages.some(
            (message) =>
              message.role === "tool" &&
              String(message.content).includes("六宫格故事板更适合叙事推进和稳定出片"),
          ),
        ).toBe(true);
        return {
          finalText:
            "这条经验讲的是波妞 PONYO 的视频制作方法：不要只靠九宫格分镜堆概念，六宫格故事板更适合把 15 秒视频的叙事推进、角色、场景和光线先锁住，再进入关键帧和视频生成。来源：https://x.com/ponyodong/status/2055150198989746559",
        };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "status: success\nsummary: 已读取 1 条经验候选，用于直接回答用户“学到了什么”。",
        output: {
          candidates: [
            {
              id: "experience-ponyo",
              title: "波妞PONYO：从九宫格分镜改用六宫格故事板",
              summary:
                "核心经验是 AI 视频制作不要只追求概念展示，六宫格故事板更适合叙事推进和稳定出片。",
              applicability:
                "先确定故事推进，再拆镜头、角色、场景和光线；用较少但更明确的格子控制画面一致性。",
              risks: ["候选仍需人工确认后才能进入长期知识。"],
              evidencePreview: "媒体资源里只记录到 X 图片、视频封面和 blob 视频引用。",
              sourceRef: "https://x.com/ponyodong/status/2055150198989746559",
            },
          ],
        },
      }),
    });

    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("六宫格故事板");
    expect(result.finalText).toContain("叙事推进");
    expect(result.finalText).toContain("https://x.com/ponyodong/status/2055150198989746559");
    expect(result.events.map((event) => event.kind)).toEqual([
      "runtime.tool",
      "runtime.tool",
      "runtime.final",
    ]);
    expect(result.finalText).not.toContain("我这次学到的不是一堆原文");
  });

  it("grounds 学习到什么 followups with local candidates and lets the model synthesize the answer", async () => {
    let modelCalled = 0;

    const result = await runConversationRuntimeTurn(input({ text: "学习到什么？" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-learning-result-local-candidates",
      orchestrate: () =>
        turn({
          intent: { kind: "chat" },
          userText: "用户追问最近一次学习结果。",
          shouldInvokeRecall: true,
          memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
        }),
      resolveCapabilityContext: () => ({
        status: "hit",
        visibleSummary: "最近学习生成了待审经验候选，可读取候选列表。",
        hits: [{ id: "experience-candidates:latest", source: "session", status: "hit" }],
      }),
      tools: createDirectorConversationRuntimeTools(),
      callModel: ({ messages }) => {
        modelCalled += 1;
        expect(messages.some((message) => message.role === "tool")).toBe(true);
        expect(
          messages.some(
            (message) =>
              message.role === "tool" &&
              String(message.content).includes(
                "GPT 资产图可以把角色、人设和配角细节一次性组织成可复用素材",
              ),
          ),
        ).toBe(true);
        return {
          finalText:
            "我读到的是 OpenCLI Twitter/X thread 里的 GPT 资产图经验：它可以把角色、人设和配角细节先组织成一张可复用素材图，再针对不满意的区域局部重生成。来源是 https://x.com/TanLuAI/status/2056949172629381407；媒体还没有授权精读，所以不能把图片内容当结论。",
        };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "status: success\nsummary: 已读取 1 条经验候选，用于直接回答用户学习结果。",
        output: {
          candidates: [
            {
              id: "experience-asset-sheet",
              title: "OpenCLI Twitter/X thread",
              summary: "GPT 资产图可以把角色、人设和配角细节一次性组织成可复用素材。",
              applicability: "先用剧情截图和设定生成资产详情图，再对不满意的区域局部重生成。",
              risks: ["候选仍需人工确认后才能进入长期知识。"],
              evidencePreview: "GPT做资产图，人设图真的太方便了。",
              sourceRef: "https://x.com/TanLuAI/status/2056949172629381407",
            },
          ],
        },
      }),
    });

    expect(modelCalled).toBe(1);
    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("OpenCLI Twitter/X thread");
    expect(result.finalText).toContain("GPT 资产图");
    expect(result.finalText).not.toContain("我这次学到的不是一堆原文");
  });

  it("scrubs leaked internal learning evidence context from model final answers", async () => {
    const result = await runConversationRuntimeTurn(input({ text: "学习到什么？" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-learning-context-scrub",
      orchestrate: () =>
        turn({
          intent: { kind: "chat" },
          userText: "用户追问最近一次学习结果。",
          shouldInvokeRecall: true,
          memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
        }),
      tools: createDirectorConversationRuntimeTools(),
      callModel: ({ messages }) => {
        expect(messages.some((message) => message.role === "tool")).toBe(true);
        return {
          finalText:
            "可以讲。\n<learning-evidence-context>\ninternal secret candidate payload\n</learning-evidence-context>\n最终可见结论：学到的是先跑通完整流程。",
        };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "status: success\nsummary: 已读取 1 条经验候选。",
        output: {
          candidates: [
            {
              id: "candidate-flow",
              title: "AI 视频学习路径",
              summary: "先跑通完整流程，再优化参数。",
              sourceRef: "https://example.test/flow",
            },
          ],
        },
      }),
    });

    expect(result.finalText).toContain("最终可见结论");
    expect(result.finalText).not.toContain("<learning-evidence-context>");
    expect(result.finalText).not.toContain("</learning-evidence-context>");
    expect(result.finalText).not.toContain("internal secret candidate payload");
    expect(result.events.find((event) => event.kind === "runtime.final")).toMatchObject({
      payload: expect.objectContaining({
        text: expect.not.stringContaining("internal secret candidate payload"),
      }),
    });
  });

  it("builds learning evidence context with budgeted source document truncation", () => {
    const longBody = `${"六宫格故事板可以先锁定叙事推进。\n".repeat(600)}正文尾部不应进入模型上下文`;

    const context = buildLearningEvidenceContext({
      toolContent: "status: success\nsummary: 已读取候选。",
      maxChars: 1_200,
      documentMaxChars: 480,
      candidates: [
        {
          id: "candidate-long",
          title: "长正文经验",
          summary: "先保留核心方法，再按预算截断正文。",
          sourceRef: "https://example.test/long",
          sourceDocument: {
            title: "长正文原文",
            sourceRef: "https://example.test/long",
            content: longBody,
          },
        },
      ],
    });

    expect(context).toBeDefined();
    expect(context?.wasTruncated).toBe(true);
    expect(context?.content.length).toBeLessThanOrEqual(1_200);
    expect(context?.content).toContain("<learning-evidence-context>");
    expect(context?.content).toContain("source_document_content");
    expect(context?.content).toContain("truncated");
    expect(context?.content).not.toContain("正文尾部不应进入模型上下文");
  });

  it("omits internal learning applicability boilerplate from model evidence context", () => {
    const context = buildLearningEvidenceContext({
      toolContent: "status: success\nsummary: 已读取候选。",
      candidates: [
        {
          id: "candidate-internal-applicability",
          title: "角色设计板生成短片经验",
          summary: "使用精确角色设计板作为参考，保持角色身份和美学一致。",
          applicability:
            "Use when Director Angel needs reusable operating experience from user-pasted material. Apply only to situations matching the distilled claims and preserved source evidence.",
          sourceRef: "https://x.com/sha_zdiii/status/2057320295179141542",
          sourceDocument: {
            content: "Use the exact character design board image as the reference.",
          },
        },
      ],
    });

    expect(context?.content).toContain("summary: 使用精确角色设计板");
    expect(context?.content).not.toContain("Use when Director Angel");
    expect(context?.content).not.toContain("user-pasted material");
    expect(context?.content).not.toContain("distilled claims");
    expect(context?.content).not.toContain("preserved source evidence");
  });

  it("prioritizes active readable learning evidence candidates within the token budget", () => {
    const context = buildLearningEvidenceContext({
      toolContent: "status: success\nsummary: 已读取候选。",
      maxChars: 3_000,
      maxEstimatedTokens: 700,
      documentMaxChars: 1_400,
      activeCandidateIds: ["candidate-readable"],
      activeSourceUrls: ["https://x.com/wei_wang/status/2057083939781517422"],
      candidates: [
        {
          id: "candidate-login-shell",
          title: "X 登录页",
          summary: "抓取内容主要是 X 登录/注册或侧栏信息，不能算成功学习正文。",
          contentQuality: "抓取内容主要是 X 登录/注册或侧栏信息，不能算成功学习正文。",
          sourceRef: "https://x.com/login",
          sourceDocument: {
            content: "立即注册 使用 Google 账号登录 Cookie 政策".repeat(80),
          },
        },
        {
          id: "candidate-readable",
          status: "pending",
          title: "ComfyUI 节点图劝退？让 Codex 替你学就行",
          summary: "正文可用：先让 Codex 安装 ComfyUI，再把工作流整理成可复用模板。",
          contentQuality: "正文可用，但需要入库前复核。",
          sourceRef: "https://x.com/wei_wang/status/2057083939781517422",
          sourceDocument: {
            sourceRef: "https://x.com/wei_wang/status/2057083939781517422",
            content:
              "第一次打开 ComfyUI 时，作者被节点图劝退；这次改成让 Codex 帮忙安装、调用和跑工作流。核心方法是先拿现成 workflow JSON，再配中文 README，写清楚输入参数、输出效果和显存要求。".repeat(
                10,
              ),
          },
        },
      ],
    });

    expect(context).toBeDefined();
    expect(context?.selectedCandidateIds).toEqual(["candidate-readable"]);
    expect(context?.omittedCandidateCount).toBeGreaterThanOrEqual(1);
    expect(context?.estimatedTokens).toBeLessThanOrEqual(context?.effectiveTokenBudget ?? 0);
    expect(context?.content).toContain("https://x.com/wei_wang/status/2057083939781517422");
    expect(context?.content).not.toContain("https://x.com/weiwang/status/2057083939781517422");
    expect(context?.content).toContain("lower-priority candidate");
  });

  it("compresses an over-budget high-quality learning evidence candidate without dropping its identity fields", () => {
    const context = buildLearningEvidenceContext({
      toolContent: "status: success\nsummary: 已读取 2 条候选。",
      maxChars: 2_400,
      maxEstimatedTokens: 360,
      documentMaxChars: 16_000,
      activeCandidateIds: ["candidate-high-long"],
      activeSourceUrls: ["https://example.test/high"],
      candidates: [
        {
          id: "candidate-high-long",
          status: "pending",
          title: "高质量长正文经验",
          summary: "正文可用：保留身份字段，正文按预算优雅压缩。",
          contentQuality: "正文可用，适合入库前复核。",
          sourceRef: "https://example.test/high",
          sourceDocument: {
            title: "长正文原文",
            sourceRef: "https://example.test/high",
            content: `${"关键方法：先保留标题、来源和摘要，再压缩正文。\n\n".repeat(120)}正文尾部不应靠整体硬切进入上下文。`,
          },
        },
        {
          id: "candidate-medium",
          status: "pending",
          title: "中等候选",
          summary: "正文可用：这条候选短小，可与高质量长候选一起进入预算。",
          sourceRef: "https://example.test/medium",
          sourceDocument: {
            content: "中等候选提供补充方法：预算内应尽量保留多个候选。",
          },
        },
      ],
    });

    expect(context).toBeDefined();
    expect(context?.selectedCandidateIds).toEqual(
      expect.arrayContaining(["candidate-high-long", "candidate-medium"]),
    );
    expect(context?.wasTruncated).toBe(true);
    expect(context?.estimatedTokens).toBeLessThanOrEqual(context?.effectiveTokenBudget ?? 0);
    expect(context?.content).toContain("id: candidate-high-long");
    expect(context?.content).toContain("title: 高质量长正文经验");
    expect(context?.content).toContain("source_ref: https://example.test/high");
    expect(context?.content).toContain("id: candidate-medium");
    expect(context?.content).toContain("source document truncated");
    expect(context?.content).not.toContain("正文尾部不应靠整体硬切进入上下文");
  });

  it("filters internal context tags across streaming chunks", () => {
    const scrubber = new ConversationRuntimeStreamingContextScrubber();
    const chunks = [
      "开头 ",
      "<learning-e",
      "vidence-context>hidden",
      " payload</learning-evidence-context>",
      " 结尾",
    ];

    const visible = chunks.map((chunk) => scrubber.filterDelta(chunk)).join("") + scrubber.flush();

    expect(visible).toContain("开头");
    expect(visible).toContain("结尾");
    expect(visible).not.toContain("learning-evidence-context");
    expect(visible).not.toContain("hidden payload");
  });

  it("keeps model-synthesized learned-summary answers aligned with evidence media boundaries", async () => {
    let modelCalled = 0;
    const result = await runConversationRuntimeTurn(input({ text: "学习到什么？" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-learning-summary-user-facing-media-boundary",
      orchestrate: () =>
        turn({
          intent: { kind: "chat" },
          userText: "用户追问最近一次学习结果。",
          shouldInvokeRecall: true,
          memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
        }),
      tools: createDirectorConversationRuntimeTools(),
      callModel: ({ messages }) => {
        modelCalled += 1;
        expect(messages.some((message) => message.role === "tool")).toBe(true);
        return {
          finalText:
            "这条经验讲的是用 GPT 做资产图和人设图：先把多个角色、配角和细节组织到资产详情图里，后续不满意的部分再局部重生成。边界也很明确：文本已读，媒体未理解；没有授权前不能把图片、视频或音频内容当结论。来源：https://x.com/TanLuAI/status/2056949172629381407",
        };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "status: success\nsummary: 已读取 1 条经验候选，用于直接回答用户学习结果。",
        output: {
          evidenceDisclosure: {
            sources: [
              {
                url: "https://x.com/TanLuAI/status/2056949172629381407",
                candidateId: "experience-asset-sheet",
                fullBodyChars: 754,
                mediaCount: 3,
                mediaInventory: { assetCount: 3, imageCount: 3, videoCount: 0, audioCount: 0 },
                mediaAdmission: {
                  canAdmitMediaContent: false,
                  reason: "只完成媒体清单或元数据记录，未完成完整视觉理解。",
                },
                mediaUnderstandingStatus: "metadata_only",
              },
            ],
          },
          candidates: [
            {
              id: "experience-asset-sheet",
              title: "Pasted lesson: OpenCLI Twitter/X thread",
              summary: "经验提炼：GPT做资产图，人设图真的太方便了；哪个部分不满意就再生成一张。",
              applicability:
                "Use when Director Angel needs reusable operating experience from user-pasted material.",
              risks: [
                "Experience candidate is distilled from source material; raw source remains evidence and must not bypass review.",
                "Pasted material may include private, stale, or unattributed guidance until reviewed.",
                "Privacy classification: public.",
              ],
              mediaUnderstanding:
                "已有元数据级媒体理解证据：media-understanding.local 已处理 3 个媒体；还没有完成完整视觉/视频/音频语义精读。",
              evidencePreview:
                "GPT做资产图，人设图真的太方便了。以文字标记每一个区域的名称，哪个部分不满意就再生成一张。",
              sourceRef: "https://x.com/TanLuAI/status/2056949172629381407",
            },
          ],
        },
      }),
    });

    expect(modelCalled).toBe(1);
    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("GPT 做资产图");
    expect(result.finalText).toContain("文本已读，媒体未理解");
    expect(result.finalText).toContain("不能把图片、视频或音频内容当结论");
    expect(result.finalText).not.toContain("Use when Director Angel");
    expect(result.finalText).not.toContain("Pasted material may include");
    expect(result.finalText).not.toContain("Privacy classification");
    expect(result.finalText).not.toContain("media-understanding.local 已处理 3 个媒体");
  });

  it("notifies memory lifecycle before transcript trimming", async () => {
    const preCompressCalls: ConversationRuntimePreCompressHookInput[] = [];

    const result = await runConversationRuntimeTurn(
      input({
        text: "回答我刚才学到了什么",
        history: Array.from({ length: 30 }, (_, index) => ({
          role: "user" as const,
          content: `历史消息 ${index}`,
        })),
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-learning-pre-compress-hook",
        memoryLifecycle: {
          onPreCompress: async (payload) => {
            preCompressCalls.push(payload);
          },
        },
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户追问最近一次学习结果。",
            shouldInvokeRecall: true,
            memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
          }),
        tools: createDirectorConversationRuntimeTools(),
        callModel: ({ messages }) => {
          if (!messages.some((message) => message.role === "tool")) {
            return {
              toolCalls: [
                {
                  id: "call-list-candidates",
                  name: "director.experience.candidates.list",
                  args: { status: "pending", maxItems: 5 },
                },
              ],
            };
          }
          return { finalText: "我学到的是先跑通完整流程，再补参数。" };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: "status: success\nsummary: 已读取 1 条经验候选。",
          output: {
            candidates: [
              {
                id: "candidate-pre-compress",
                title: "学习路径",
                summary: "先跑通完整流程，再补参数。",
                sourceRef: "https://example.test/pre-compress",
              },
            ],
          },
        }),
      },
    );

    expect(preCompressCalls).toHaveLength(1);
    expect(preCompressCalls[0]).toMatchObject({
      turnId: "turn-learning-pre-compress-hook",
      sessionKey: "session-1",
      reason: "before-transcript-trim",
    });
    expect(preCompressCalls[0]?.messages.length).toBeGreaterThan(result.transcriptMessages.length);
    expect(preCompressCalls[0]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          toolCallId: "required-experience-candidates-learning-evidence",
          content: expect.stringContaining("<learning-evidence-context>"),
        }),
      ]),
    );
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain("memory.pre_compress");
  });

  it("notifies memory lifecycle when a tool result projects delegated subagent work", async () => {
    const delegationCalls: ConversationRuntimeDelegationHookInput[] = [];

    const result = await runConversationRuntimeTurn(input({ text: "派一个子代理查资料" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-delegation-memory-hook",
      memoryLifecycle: {
        onDelegation: async (payload) => {
          delegationCalls.push(payload);
        },
      },
      orchestrate: () =>
        turn({
          intent: { kind: "chat" },
          userText: "用户要求子代理协作。",
          shouldInvokeRecall: false,
        }),
      tools: [
        {
          name: "agent.delegate",
          description: "Delegate work to a subagent.",
          readOnly: false,
          metadata: { capability: "agent.subagent.delegate" },
        },
      ],
      authorizeToolCall: () => ({ status: "allow" }),
      preflightToolSandbox: () => ({
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-21T00:00:00.000Z",
        providerId: "test",
        reason: "test allows delegation",
      }),
      callModel: ({ messages }) => {
        if (!messages.some((message) => message.role === "tool")) {
          return {
            toolCalls: [
              {
                id: "call-delegate",
                name: "agent.delegate",
                args: { task: "查资料" },
              },
            ],
          };
        }
        return { finalText: "子代理已排队，等它完成后回流结果。" };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "status: queued\nsubagent_id: subagent-run-1",
        output: {
          delegation: { id: "subagent-run-1" },
          subagentRun: { subagentId: "subagent-run-2" },
        },
        metadata: {
          delegationId: "subagent-run-3",
          subagentRun: { subagentId: "subagent-run-4" },
        },
      }),
    });

    expect(delegationCalls).toHaveLength(1);
    expect(delegationCalls[0]).toMatchObject({
      turnId: "turn-delegation-memory-hook",
      sessionKey: "session-1",
      toolName: "agent.delegate",
      toolCallId: "call-delegate",
      subagentRunIds: ["subagent-run-3", "subagent-run-4", "subagent-run-1", "subagent-run-2"],
    });
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain("memory.delegation");
  });

  it("answers arbitrary active evidence frame follow-ups from candidate state instead of keyword guessing", async () => {
    const executedTools: string[] = [];
    let modelCalled = 0;

    const result = await runConversationRuntimeTurn(
      input({
        sessionKey: "desktop:workbench",
        text: "这到底讲的是啥",
        trustedContext: {
          activeEvidenceFrame: {
            schemaVersion: "director.desktop.active-evidence-frame.v1",
            frameId: "frame-x-aigc-learning",
            turnId: "turn-learn-x-aigc",
            sourceUrls: ["https://x.com/Adam38363368936/status/2056318384317620663"],
            candidateIds: ["candidate-aigc-learning-path"],
            evidenceDisclosure: {
              sources: [
                {
                  url: "https://x.com/Adam38363368936/status/2056318384317620663",
                  fullBodyChars: 86,
                  secondPassExtracted: false,
                  mediaCount: 0,
                  sourceAccessStatus: "available",
                },
              ],
            },
          },
        },
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-active-evidence-arbitrary-followup",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "普通自然追问，不包含学习候选关键词。",
            shouldInvokeRecall: false,
            memoryDecision: { action: "never-store", reason: "证据帧追问不写长期记忆。" },
          }),
        tools: createDirectorConversationRuntimeTools(),
        callModel: ({ messages }) => {
          modelCalled += 1;
          expect(messages.some((message) => message.role === "tool")).toBe(true);
          return {
            finalText:
              "这条内容讲的是 AI 图像视频新手学习路径：AIGC 新手最大的误区不是参数不会调，而是没有先跑通完整流程；更务实的做法是先完成一个可交付项目，再补 Prompt 工程、参数理解和商业应用能力。来源：https://x.com/Adam38363368936/status/2056318384317620663",
          };
        },
        executeTool: ({ call }) => {
          executedTools.push(call.name);
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content: "status: success\nsummary: 已读取 1 条活跃证据帧候选。",
            output: {
              candidates: [
                {
                  id: "candidate-aigc-learning-path",
                  title: "AI 图像视频新手学习路径",
                  summary: "AIGC 新手最大的误区不是参数不会调，而是没有先跑通完整流程。",
                  applicability: "先完成一个可交付项目，再补 Prompt 工程、参数理解和商业应用能力。",
                  sourceRef: "https://x.com/Adam38363368936/status/2056318384317620663",
                },
              ],
            },
          };
        },
      },
    );

    expect(modelCalled).toBe(1);
    expect(executedTools).toEqual(["director.experience.candidates.list"]);
    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("AI 图像视频新手学习路径");
    expect(result.finalText).toContain("先跑通完整流程");
    expect(result.finalText).toContain("https://x.com/Adam38363368936/status/2056318384317620663");
    expect(result.operatorTrace.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "tool.required",
          metadata: expect.objectContaining({
            toolName: "director.experience.candidates.list",
          }),
        }),
      ]),
    );
  });

  it("does not prefetch active evidence candidates when the user explicitly asks for no tools", async () => {
    const executedTools: string[] = [];

    const result = await runConversationRuntimeTurn(
      input({
        sessionKey: "desktop:workbench",
        text: "刚才为什么学习不到？只基于上面这段对话，用一句自然中文回答，不要调用外部工具。",
        trustedContext: {
          activeEvidenceFrame: {
            schemaVersion: "director.desktop.active-evidence-frame.v1",
            frameId: "frame-no-tools",
            turnId: "turn-learn-x",
            sourceUrls: ["https://x.com/example/status/1"],
            candidateIds: ["candidate-x"],
          },
        },
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-no-tools-active-evidence",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            shouldInvokeRecall: false,
            memoryDecision: { action: "never-store", reason: "用户要求只基于对话回答。" },
          }),
        tools: createDirectorConversationRuntimeTools(),
        callModel: ({ tools, messages }) => {
          expect(tools).toEqual([]);
          expect(messages.some((message) => message.role === "tool")).toBe(false);
          return {
            finalText:
              "因为上一次只拿到了正文摘要，没有拿到评论区或完整素材，所以学习结果看起来很薄。",
          };
        },
        executeTool: ({ call }) => {
          executedTools.push(call.name);
          throw new Error("tool should not run when user forbids tools");
        },
      },
    );

    expect(executedTools).toEqual([]);
    expect(result.replySource).toBe("model");
    expect(result.finalText).toContain("正文摘要");
    expect(result.operatorTrace.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "tool.disabled_by_user",
        }),
      ]),
    );
    expect(result.operatorTrace.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "tool.required",
          metadata: expect.objectContaining({
            toolName: "director.experience.candidates.list",
          }),
        }),
      ]),
    );
  });

  it("allows local learning evidence when the user asks to answer only from recent learned content", async () => {
    const executedTools: string[] = [];
    let modelCalled = 0;

    const result = await runConversationRuntimeTurn(
      input({
        sessionKey: "desktop:workbench",
        text: "这条内容最值得保存的三点是什么？只基于刚才的学习内容回答。",
        trustedContext: {
          activeEvidenceFrame: {
            schemaVersion: "director.desktop.active-evidence-frame.v1",
            frameId: "frame-local-learning-evidence",
            turnId: "turn-learn-x",
            sourceUrls: ["https://x.com/example/status/2"],
            candidateIds: ["candidate-y"],
          },
        },
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-local-learning-evidence-only",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            shouldInvokeRecall: false,
            memoryDecision: { action: "never-store", reason: "候选价值判断不写长期记忆。" },
          }),
        tools: createDirectorConversationRuntimeTools(),
        callModel: ({ tools, messages }) => {
          modelCalled += 1;
          expect(tools.map((tool) => tool.name)).toEqual(["director.experience.candidates.list"]);
          expect(messages.some((message) => message.role === "tool")).toBe(true);
          return {
            finalText: "最值得保存的三点是结构化提示词、可复用变量和媒体边界。",
          };
        },
        executeTool: ({ call }) => {
          executedTools.push(call.name);
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content: "status: success\nsummary: 已读取 1 条本地待审经验候选。",
          };
        },
      },
    );

    expect(modelCalled).toBe(1);
    expect(executedTools).toEqual(["director.experience.candidates.list"]);
    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("最值得保存");
    expect(result.operatorTrace.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "tool.local_evidence_only",
        }),
      ]),
    );
  });

  it("answers learned-summary followups from the readable X candidate instead of the latest login shell", async () => {
    const result = await runConversationRuntimeTurn(
      input({ text: "回答我刚才学到了什么，尤其说明有没有真的理解图片或视频" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-experience-x-readable-over-login-shell",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "读取候选列表并直接讲清楚学到了什么。",
            shouldInvokeRecall: true,
            memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
          }),
        tools: createDirectorConversationRuntimeTools(),
        callModel: ({ messages }) => {
          if (!messages.some((message) => message.role === "tool")) {
            return {
              toolCalls: [
                {
                  id: "call-list-candidates",
                  name: "director.experience.candidates.list",
                  args: { status: "pending", maxItems: 4 },
                },
              ],
            };
          }
          return {
            finalText:
              "核心结论\n我学到了一个视频制作经验。\n\n学到的可复用方法\n用六宫格故事板。\n\n还没做到或局限\n候选需要确认。\n\n下一步\n可以收录。",
          };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: "status: success\nsummary: 已读取 2 条经验候选，用于直接回答用户“学到了什么”。",
          output: {
            candidates: [
              {
                id: "experience-x-login-shell",
                title: "Pasted lesson: https://x.com/ponyodong/status/2055150198989746559",
                summary: "使用 Google 账号注册；X 的新用户？立即注册。",
                contentQuality: "抓取内容主要是 X 登录/注册或侧栏信息，不能算成功学习正文。",
                evidencePreview: "X 的新用户？立即注册，使用 Google 账号注册，使用 Apple 注册。",
                sourceRef: "https://x.com/ponyodong/status/2055150198989746559",
              },
              {
                id: "experience-x-storyboard",
                title: "波妞PONYO：从九宫格分镜改用六宫格故事板",
                summary: "视频制作干货分享：为什么放弃九宫格分镜，改用六宫格故事板。",
                contentQuality: "正文可用，但夹杂 X 登录/注册、侧栏或回复区噪声，入库前需要清理。",
                evidencePreview:
                  "视频制作干货分享｜为什么我放弃了九宫格分镜，改用六宫格故事板。[Video: 嵌入式视频](blob:https://x.com/video)；媒体资源 pbs.twimg.com。",
                sourceRef: "https://x.com/ponyodong/status/2055150198989746559",
              },
            ],
          },
        }),
      },
    );

    expect(result.finalText).toContain("六宫格故事板");
    expect(result.finalText).toContain("还没有证据表明已理解图片或视频内容");
    expect(result.finalText).not.toContain("<learning-evidence-context>");
    expect(result.finalText).not.toContain("</learning-evidence-context>");
  });

  it("renders learned X article followups without leaking internal candidate labels", async () => {
    const xArticleBody = [
      "这半年我密集做了几百上千个 AI 图像和视频作品。",
      "新手最常犯的三个错误：一上来就死磕参数、只看教程不动手、追工具不追能力。",
      "真正有效的三个学习思路：先跑通全流程，再追求质量；从 Prompt 工程开始建立核心能力；带着项目学，不要漫无目的地练习。",
      "具体学习路径分成 Level 0 到 Level 5：认知启蒙、工具上手、Prompt 工程、原理与参数、进阶技巧、商业应用。",
    ].join("\n");

    const result = await runConversationRuntimeTurn(input({ text: "刚才学到了什么？" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-x-article-readable-no-internal-labels",
      orchestrate: () =>
        turn({
          intent: { kind: "chat" },
          userText: "读取候选列表并直接讲清楚学到了什么。",
          shouldInvokeRecall: true,
          memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
        }),
      tools: createDirectorConversationRuntimeTools(),
      callModel: ({ messages }) => {
        expect(messages.some((message) => message.role === "tool")).toBe(true);
        expect(
          messages.some(
            (message) =>
              message.role === "tool" &&
              String(message.content).includes("做了上千个 AI 图像视频之后"),
          ),
        ).toBe(true);
        return {
          finalText:
            "这条内容讲的是 AIGC 新手学习路径：先跑通完整流程，再学 Prompt 工程，最后再补参数、工作流和商业应用。它提醒新手不要一上来死磕参数，也不要只看教程不动手；Level 0 到 Level 5 是一条从认知启蒙到商业应用的递进路线。来源：https://x.com/Adam38363368936/status/2056318384317620663",
        };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "status: success\nsummary: 已读取 1 条经验候选，用于直接回答用户“学到了什么”。",
        output: {
          candidates: [
            {
              id: "experience-x-aigc-learning-path",
              title:
                "Pasted lesson: 做了上千个 AI 图像视频之后，我发现 90% 的新手都在犯同一个错误（附完整学习路径总结）",
              summary:
                "经验提炼：AIGC 新手要先跑通全流程，再学 Prompt 工程，最后再深入参数、工作流和商业应用。",
              applicability:
                "Use when Director Angel needs reusable operating experience from user-pasted material. Apply only to situations matching the distilled claims and preserved source evidence.",
              risks: ["候选仍需确认后才能进入长期经验。"],
              sourceRef: "https://x.com/Adam38363368936/status/2056318384317620663",
              evidencePreview: "正文已读；媒体清单只记录到图片和视频，未做视觉/视频理解。",
              sourceDocument: {
                title:
                  "做了上千个 AI 图像视频之后，我发现 90% 的新手都在犯同一个错误（附完整学习路径总结）",
                sourceRef: "https://x.com/Adam38363368936/status/2056318384317620663",
                content: xArticleBody,
                rawContent: xArticleBody,
              },
            },
          ],
        },
      }),
    });

    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("死磕参数");
    expect(result.finalText).toContain("Prompt 工程");
    expect(result.finalText).toContain("Level 0 到 Level 5");
    expect(result.finalText).toContain("https://x.com/Adam38363368936/status/2056318384317620663");
    expect(result.finalText).toContain("媒体未理解");
    expect(result.finalText).not.toContain("Pasted lesson");
    expect(result.finalText).not.toContain("Use when Director Angel");
    expect(result.finalText).not.toContain("user-pasted material");
  });

  it("humanizes source evidence read status in learned-summary followups", async () => {
    const result = await runConversationRuntimeTurn(input({ text: "刚才学到了什么？" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-learned-summary-humanized-read-status",
      orchestrate: () =>
        turn({
          intent: { kind: "chat" },
          userText: "读取候选列表并直接讲清楚学到了什么。",
          shouldInvokeRecall: true,
          memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
        }),
      tools: createDirectorConversationRuntimeTools(),
      callModel: ({ messages }) => {
        if (!messages.some((message) => message.role === "tool")) {
          return {
            toolCalls: [
              {
                id: "call-list-candidates",
                name: "director.experience.candidates.list",
                args: { status: "pending", maxItems: 4 },
              },
            ],
          };
        }
        return {
          finalText: "核心结论：这条经验讲的是用角色设计板作为参考生成电影级动态序列。",
        };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "status: success\nsummary: 已读取 1 条经验候选。",
        output: {
          candidates: [
            {
              id: "experience-x-design-board",
              title: "角色设计板生成短片经验",
              summary: "用 exact character design board 作为参考，保持角色身份和美学一致。",
              sourceRef: "https://x.com/sha_zdiii/status/2057320295179141542",
            },
          ],
          evidenceDisclosure: {
            sources: [
              {
                url: "https://x.com/sha_zdiii/status/2057320295179141542",
                fullBodyChars: 1996,
                readStatus: "read",
              },
            ],
          },
        },
      }),
    });

    expect(result.finalText).toContain(
      "证据来源：https://x.com/sha_zdiii/status/2057320295179141542 · 全文 1996 字符 · 已读取",
    );
    expect(result.finalText).not.toContain("全文字符数：1996");
    expect(result.finalText).not.toContain("读取状态：已读取");
    expect(result.finalText).not.toContain("读取状态：read");
  });

  it("keeps source evidence when candidate list disclosure is returned as tool metadata", async () => {
    const result = await runConversationRuntimeTurn(input({ text: "刚才学到了什么？" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-learned-summary-metadata-source-evidence",
      orchestrate: () =>
        turn({
          intent: { kind: "chat" },
          userText: "读取候选列表并直接讲清楚学到了什么。",
          shouldInvokeRecall: true,
          memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
        }),
      tools: createDirectorConversationRuntimeTools(),
      callModel: ({ messages }) => {
        if (!messages.some((message) => message.role === "tool")) {
          return {
            toolCalls: [
              {
                id: "call-list-candidates",
                name: "director.experience.candidates.list",
                args: { status: "pending", maxItems: 4 },
              },
            ],
          };
        }
        return {
          finalText: "核心结论：这条经验讲的是用角色设计板作为参考生成电影级动态序列。",
        };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "status: success\nsummary: 已读取 1 条经验候选。",
        output: {
          candidates: [
            {
              id: "experience-x-design-board",
              title: "角色设计板生成短片经验",
              summary: "用 exact character design board 作为参考，保持角色身份和美学一致。",
              sourceRef: "https://x.com/sha_zdiii/status/2057320295179141542",
            },
          ],
        },
        metadata: {
          evidenceDisclosure: {
            sources: [
              {
                url: "https://x.com/sha_zdiii/status/2057320295179141542",
                fullBodyChars: 1996,
                readStatus: "read",
              },
            ],
          },
        },
      }),
    });

    expect(result.finalText).toContain("证据来源");
    expect(result.finalText).toContain(
      "证据来源：https://x.com/sha_zdiii/status/2057320295179141542 · 全文 1996 字符 · 已读取",
    );
    expect(result.finalText).not.toContain(
      "来源：https://x.com/sha_zdiii/status/2057320295179141542\n",
    );
    expect(result.finalText).not.toContain("读取状态：已读取");
    expect(result.finalText).not.toContain("读取状态：read");
  });

  it("prefers read candidate source evidence over stale failed disclosure for the same URL", async () => {
    const sourceUrl = "https://x.com/qc777qc/status/2057327056774648108";
    const result = await runConversationRuntimeTurn(input({ text: "详细说说刚才学到的内容" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-learned-summary-prefers-read-source-evidence",
      orchestrate: () =>
        turn({
          intent: { kind: "chat" },
          userText: "读取候选列表并详细回答刚才学到的内容。",
          shouldInvokeRecall: true,
          memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
        }),
      tools: createDirectorConversationRuntimeTools(),
      callModel: ({ messages }) => {
        if (!messages.some((message) => message.role === "tool")) {
          return {
            toolCalls: [
              {
                id: "call-list-candidates",
                name: "director.experience.candidates.list",
                args: { status: "pending", maxItems: 4 },
              },
            ],
          };
        }
        return {
          finalText: "核心结论：完美逆向文生图提示词的方法找到了。",
        };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "status: success\nsummary: 已读取 1 条经验候选。",
        output: {
          candidates: [
            {
              id: "experience-qc-reverse-prompt",
              title: "逆向文生图提示词",
              summary: "把参考图拆成角色、构图、质感和光线，再转成可复用提示词。",
              sourceRef: sourceUrl,
            },
          ],
          evidenceDisclosure: {
            sources: [
              {
                url: sourceUrl,
                fullBodyChars: 0,
                readStatus: "failed",
                failedReason: "Web extraction failed",
              },
              {
                url: sourceUrl,
                fullBodyChars: 6076,
                readStatus: "read",
              },
            ],
          },
        },
      }),
    });

    expect(result.finalText).toContain(`${sourceUrl} · 全文 6076 字符 · 已读取`);
    expect(result.finalText).not.toContain("读取失败");
    expect(result.finalText).not.toContain("Web extraction failed");
    expect(result.finalText).not.toContain("全文字符数：6076");
  });

  it("does not answer explicit URL reread requests from cached experience candidates", async () => {
    const executedTools: string[] = [];
    let modelCalled = false;

    const result = await runConversationRuntimeTurn(
      input({
        text: "不要入库，只回答。请用浏览器重新读取 https://x.com/ponyodong/status/2055150198989746559 并回答完整学到了什么。如果网页正文预览截断，请先二次提取全文。",
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-url-reread-bypasses-candidate-fastpath",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "重新读取 https://x.com/ponyodong/status/2055150198989746559 并完整总结。",
            shouldInvokeRecall: true,
            memoryDecision: { action: "never-store", reason: "用户明确要求只回答不入库。" },
          }),
        tools: createDirectorConversationRuntimeTools(),
        callModel: () => {
          modelCalled = true;
          return { finalText: "我会重新读取这个 URL 后再回答。" };
        },
        executeTool: ({ call }) => {
          executedTools.push(call.name);
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content:
              "status: success\nsummary: 已读取 5 条经验候选，用于直接回答用户“学到了什么”。",
          };
        },
      },
    );

    expect(modelCalled).toBe(true);
    expect(executedTools).not.toContain("director.experience.candidates.list");
    expect(result.replySource).not.toBe("structured-renderer");
    expect(result.finalText).toBe("我会重新读取这个 URL 后再回答。");
  });

  it("auto-reads full web_extract artifacts for explicit URL reread answers", async () => {
    const bodyTail = "完整正文尾部：附录B最短版提示词要求先生成16:9六宫格故事板。";
    const fullBody = `正文开头：为什么改用六宫格故事板。${"分镜方法。".repeat(900)}${bodyTail}`;
    const executedTools: string[] = [];

    const result = await runConversationRuntimeTurn(
      input({
        text: "不要入库，只回答。请重新读取 https://x.com/ponyodong/status/2055150198989746559 并回答完整学到了什么。如果网页正文预览截断，请先二次提取全文。",
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-url-reread-auto-full-body",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "重新读取 https://x.com/ponyodong/status/2055150198989746559 并完整总结。",
            shouldInvokeRecall: true,
            memoryDecision: { action: "never-store", reason: "用户明确要求只回答不入库。" },
          }),
        tools: [
          {
            name: "web_extract",
            description: "Extract readable URL text.",
            readOnly: true,
            metadata: { capability: "web.extract" },
          },
          {
            name: "web_extract_artifact_read",
            description: "Read saved web_extract full body artifacts.",
            readOnly: true,
            metadata: { capability: "web.extract.artifact.read" },
          },
          {
            name: "director.experience.candidates.list",
            description: "List experience candidates.",
            readOnly: true,
          },
        ],
        callModel: ({ messages }) => {
          const fullBodyMessage = messages.find(
            (message) =>
              message.role === "tool" &&
              message.toolCallId === "required-web-extract-explicit-url-full-body-read",
          );
          if (fullBodyMessage !== undefined) {
            return {
              finalText: `核心结论：这次读到的是完整正文。\n学到的内容：${fullBodyMessage.content}`,
            };
          }
          const previewMessage = messages.find(
            (message) =>
              message.role === "tool" && message.toolCallId === "required-web-extract-explicit-url",
          );
          if (previewMessage !== undefined) {
            return {
              finalText: "局限：内容不完整——帖子正文在8000字符处截断，后续可能包含具体方法。",
            };
          }
          throw new Error("required web_extract should run before the first model call");
        },
        executeTool: ({ call }) => {
          executedTools.push(call.name);
          if (call.name === "web_extract_artifact_read") {
            return {
              callId: call.id,
              toolName: call.name,
              ok: true,
              content: [
                "status: success",
                "summary: Read saved full body.",
                `body: ${fullBody}`,
                `full_body_chars: ${fullBody.length}`,
                "body_truncated_for_model: false",
              ].join("\n"),
              output: {
                status: "success",
                body: fullBody,
                full_body_ref: "web-extract-full-body-x-ponyodong",
                full_body_chars: fullBody.length,
                body_truncated_for_model: false,
              },
            };
          }
          if (call.name === "director.experience.candidates.list") {
            throw new Error("candidate fast path must not answer explicit URL rereads");
          }
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content: [
              "status: success",
              "summary: Extracted preview from X post.",
              "url: https://x.com/ponyodong/status/2055150198989746559",
              "title: 波妞PONYO：六宫格故事板",
              "text_preview: 正文开头：为什么改用六宫格故事板。",
              "body_ref: web-extract-body-x-ponyodong",
              "full_body_ref: web-extract-full-body-x-ponyodong",
              `full_body_chars: ${fullBody.length}`,
              "preview_chars: 8000",
              "body_truncated_for_model: true",
            ].join("\n"),
            output: {
              status: "success",
              url: "https://x.com/ponyodong/status/2055150198989746559",
              title: "波妞PONYO：六宫格故事板",
              text_preview: "正文开头：为什么改用六宫格故事板。",
              body: fullBody,
              body_ref: "web-extract-body-x-ponyodong",
              full_body_ref: "web-extract-full-body-x-ponyodong",
              full_body_chars: fullBody.length,
              preview_chars: 8000,
              body_truncated_for_model: true,
            },
            metadata: {
              modelVisibleContent: [
                "status: success",
                "summary: Extracted preview from X post.",
                "url: https://x.com/ponyodong/status/2055150198989746559",
                "title: 波妞PONYO：六宫格故事板",
                "text_preview: 正文开头：为什么改用六宫格故事板。",
                "body_ref: web-extract-body-x-ponyodong",
                "full_body_ref: web-extract-full-body-x-ponyodong",
                `full_body_chars: ${fullBody.length}`,
                "preview_chars: 8000",
                "body_truncated_for_model: true",
              ].join("\n"),
            },
          };
        },
      },
    );

    expect(executedTools).toEqual(["web_extract", "web_extract_artifact_read"]);
    expect(result.finalText).toContain(bodyTail);
    expect(result.finalText).not.toContain("8000字符处截断");
  });

  it("prefers structured full-body artifact summaries over truncated web_extract previews", async () => {
    const fullBody = [
      "X 上的 波妞PONYO：“视频制作干货分享｜为什么我放弃了九宫格分镜，改用六宫格故事板” / X",
      "我是波妞，过去半年，我在 X 上发了几百条 AI 视频和壁纸，也帮朋友做过七个短视频账号的测试和迭代。",
      "去年 11 月到现在，我前前后后试了 200 多次，生成了 300 多条视频，真正让我吃够苦头的不是模型参数，而是九宫格分镜。",
      "九宫格不是错的，但直接当成 AI 视频生产底稿时，很容易变成九张精美壁纸的陈列，而不是一段真正成立的视频。",
      "AI 视频的问题往往不出在生成那一下，而出在生成之前有没有把时间、镜头、情绪和空间关系想清楚。",
      "于是我把原来的九宫格彻底改成了六宫格，并且把它当成真正服务于视频的故事板来用。",
      "六宫格会逼你回到导演思维，每一格都要交代时间、场景、运镜、情绪。",
      "六格可以拆成三段：前五秒建立，中间五秒推进或爆发，后五秒收束、余韵或者反转。",
      "实操时先做 16:9 的六宫格故事板，再把每格扩写成镜头提示词。",
      "六宫格不是少三个框，而是把每一格变成一个导演决策点。".repeat(18),
    ].join("\n");

    const result = await runConversationRuntimeTurn(
      input({
        text: "不要入库，只回答。请重新读取 https://x.com/ponyodong/status/2055150198989746559 并回答完整学到了什么。如果正文预览截断，请先二次提取全文。",
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-url-reread-prefers-artifact-summary",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "重新读取 https://x.com/ponyodong/status/2055150198989746559 并完整总结。",
            shouldInvokeRecall: true,
            memoryDecision: { action: "never-store", reason: "用户明确要求只回答不入库。" },
          }),
        tools: [
          {
            name: "web_extract",
            description: "Extract readable URL text.",
            readOnly: true,
            metadata: { capability: "web.extract" },
          },
          {
            name: "web_extract_artifact_read",
            description: "Read saved web_extract full body artifacts.",
            readOnly: true,
            metadata: { capability: "web.extract.artifact.read" },
          },
        ],
        callModel: () => ({
          finalText: "局限：内容不完整——帖子正文在8000字符处截断，后续可能包含具体方法。",
        }),
        executeTool: ({ call }) => {
          if (call.name === "web_extract_artifact_read") {
            return {
              callId: call.id,
              toolName: call.name,
              ok: true,
              content: [
                "status: success",
                "summary: Read saved full body.",
                "url: https://x.com/ponyodong/status/2055150198989746559",
                `body: ${fullBody}`,
                `full_body_chars: ${fullBody.length}`,
                "body_truncated_for_model: false",
              ].join("\n"),
              output: {
                status: "success",
                url: "https://x.com/ponyodong/status/2055150198989746559",
                body: fullBody,
                full_body_ref: "web-extract-full-body-x-ponyodong",
                full_body_chars: fullBody.length,
                body_truncated_for_model: false,
              },
            };
          }
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content: [
              "status: success",
              "summary: Extracted preview from X post.",
              "url: https://x.com/ponyodong/status/2055150198989746559",
              "title: 波妞PONYO：六宫格故事板",
              "text_preview: X 上的 波妞PONYO：“视频制作干货分享｜为什么我放弃了九宫格分镜，改用六宫格故事板” / X 预览到这里就不够了。",
              "body_ref: web-extract-body-x-ponyodong",
              "full_body_ref: web-extract-full-body-x-ponyodong",
              `full_body_chars: ${fullBody.length}`,
              "preview_chars: 1200",
              "body_truncated_for_model: true",
            ].join("\n"),
            output: {
              status: "success",
              url: "https://x.com/ponyodong/status/2055150198989746559",
              title: "波妞PONYO：六宫格故事板",
              text_preview:
                "X 上的 波妞PONYO：“视频制作干货分享｜为什么我放弃了九宫格分镜，改用六宫格故事板” / X 预览到这里就不够了。",
              full_body_ref: "web-extract-full-body-x-ponyodong",
              full_body_chars: fullBody.length,
              preview_chars: 1200,
              body_truncated_for_model: true,
            },
          };
        },
      },
    );

    expect(result.finalText).toContain("**核心结论**");
    expect(result.finalText).toContain("**学到的内容**");
    expect(result.finalText).toContain("**可复用方法**");
    expect(result.finalText).toContain("**局限**");
    expect(result.finalText).toContain("**下一步**");
    expect(result.finalText).toContain("六宫格故事板");
    expect(result.finalText).toContain("时间、场景、运镜、情绪");
    expect(result.finalText).toContain("前五秒");
    expect(result.finalText).not.toContain("8000字符");
    expect(result.finalText).not.toContain("内容不完整");
  });

  it("summarizes generic full-body articles without falling back to X/video hardcoded language", async () => {
    const fullBody = [
      "正文",
      "复盘标题：如何把客户访谈变成稳定的产品路线图",
      "团队一开始的问题不是没有想法，而是把每一次客户反馈都当成同等重要的需求。",
      "后来我们改成三步法：先记录原话和场景，再按频率、付费意愿、阻塞程度打分，最后只把高分问题放进路线图。",
      "第一步要求访谈记录必须保留用户原话、使用场景、当前替代方案和失败成本。",
      "第二步要求每周把反馈集中清洗，合并重复表达，避免把同一个问题拆成十个看似不同的需求。",
      "第三步要求评审时先问证据强度，再讨论解决方案，不允许直接跳到功能设计。",
      "这个方法让团队从追逐零散需求，转成围绕高证据问题做决策。",
      "可复用模板是：事实记录、证据评分、路线图准入、复盘校准。",
      "如果证据不足，就进入观察池，而不是立即立项。",
      "案例里三个月后，低证据需求减少，交付返工也明显下降。",
      "最后的提醒是，路线图不是愿望清单，而是一组经过证据门槛筛选的承诺。",
      "附录：每条候选需求都要写清楚来源、样本数、影响范围、预期收益和撤销条件。",
    ].join("\n");

    const result = await runConversationRuntimeTurn(
      input({
        text: "不要入库，只回答。请重新读取 https://example.com/product-roadmap-retro 并回答完整学到了什么。如果正文预览截断，请先二次提取全文。",
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-generic-reread-structured-summary",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "重新读取 https://example.com/product-roadmap-retro 并完整总结。",
            shouldInvokeRecall: true,
            memoryDecision: { action: "never-store", reason: "用户明确要求只回答不入库。" },
          }),
        tools: [
          {
            name: "web_extract",
            description: "Extract readable URL text.",
            readOnly: true,
            metadata: { capability: "web.extract" },
          },
          {
            name: "web_extract_artifact_read",
            description: "Read saved web_extract full body artifacts.",
            readOnly: true,
            metadata: { capability: "web.extract.artifact.read" },
          },
        ],
        callModel: () => ({
          finalText: "局限：内容不完整——正文预览截断，后续可能包含具体方法。",
        }),
        executeTool: ({ call }) => {
          if (call.name === "web_extract_artifact_read") {
            return {
              callId: call.id,
              toolName: call.name,
              ok: true,
              content: [
                "status: success",
                "summary: Read saved full body.",
                "url: https://example.com/product-roadmap-retro",
                "title: 如何把客户访谈变成稳定的产品路线图",
                `body: ${fullBody}`,
                `full_body_chars: ${fullBody.length}`,
                "body_truncated_for_model: false",
              ].join("\n"),
              output: {
                status: "success",
                url: "https://example.com/product-roadmap-retro",
                title: "如何把客户访谈变成稳定的产品路线图",
                body: fullBody,
                full_body_chars: fullBody.length,
                body_truncated_for_model: false,
              },
            };
          }
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content: [
              "status: success",
              "summary: Extracted preview.",
              "url: https://example.com/product-roadmap-retro",
              "title: 如何把客户访谈变成稳定的产品路线图",
              "text_preview: 团队一开始的问题不是没有想法，而是把每一次客户反馈都当成同等重要的需求。",
              "full_body_ref: web-extract-full-body-product-roadmap",
              `full_body_chars: ${fullBody.length}`,
              "preview_chars: 160",
              "body_truncated_for_model: true",
            ].join("\n"),
            output: {
              status: "success",
              url: "https://example.com/product-roadmap-retro",
              title: "如何把客户访谈变成稳定的产品路线图",
              text_preview:
                "团队一开始的问题不是没有想法，而是把每一次客户反馈都当成同等重要的需求。",
              full_body_ref: "web-extract-full-body-product-roadmap",
              full_body_chars: fullBody.length,
              preview_chars: 160,
              body_truncated_for_model: true,
            },
          };
        },
      },
    );

    expect(result.finalText).toContain("**核心结论**");
    expect(result.finalText).toContain("**学到的内容**");
    expect(result.finalText).toContain("**可复用方法**");
    expect(result.finalText).toContain("证据评分");
    expect(result.finalText).toContain("路线图准入");
    expect(result.finalText).toContain("观察池");
    expect(result.finalText).not.toContain("六宫格");
    expect(result.finalText).not.toContain("九宫格");
    expect(result.finalText).not.toContain("AI 视频");
    expect(result.finalText).not.toContain("时间、场景、运镜、情绪");
    expect(result.finalText).not.toContain("内容不完整");
  });

  it("corrects explicit X reread answers when browser snapshot contains the real article after a link shell", async () => {
    const browserArticle = [
      "文章",
      "波妞PONYO",
      "@ponyodong",
      "视频制作干货分享｜为什么我放弃了九宫格分镜，改用六宫格故事板",
      "九宫格更像九张精美壁纸的陈列，而不是一段真正成立的视频。",
      "六宫格会逼你回到导演思维，每一格都要交代时间、场景、运镜、情绪。",
      "六格可以拆成三段：前五秒建立，中间五秒推进或爆发，后五秒收束、余韵或者反转。",
      "六宫格不是少三个框，而是把每一格变成一个导演决策点。".repeat(18),
      "正文尾部：附录B最短版提示词要求先生成16:9六宫格故事板。",
    ].join("\n");
    const executedTools: string[] = [];
    let repairCalled = false;

    const result = await runConversationRuntimeTurn(
      input({
        text: "不要入库，只回答。请用浏览器重新读取 https://x.com/ponyodong/status/2055150198989746559 并回答完整学到了什么。如果网页正文预览截断，请先二次提取全文。",
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-x-reread-browser-snapshot-correction",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText:
              "用浏览器重新读取 https://x.com/ponyodong/status/2055150198989746559 并完整总结。",
            shouldInvokeRecall: true,
            memoryDecision: { action: "never-store", reason: "用户明确要求只回答不入库。" },
          }),
        tools: [
          {
            name: "web_extract",
            description: "Extract readable URL text.",
            readOnly: true,
            metadata: { capability: "web.extract" },
          },
          {
            name: "browser_navigate",
            description: "Navigate browser.",
            readOnly: true,
            metadata: { capability: "browser.navigate" },
          },
          {
            name: "browser_snapshot",
            description: "Read browser snapshot.",
            readOnly: true,
            metadata: { capability: "browser.snapshot" },
          },
        ],
        callModel: ({ metadata }) => {
          if (metadata?.repair === true) {
            repairCalled = true;
            return {
              finalText:
                "根据工具观察，页面内容已被完整提取，但正文仅包含一个链接（https://t.co/6RGDAs0ueU）和用户简介，没有提供具体的文章或知识内容。\n\n**局限**\n推文正文被截断或仅为链接，无法获取链接指向的具体文章内容。",
            };
          }
          return {
            finalText:
              "根据工具观察，页面内容已被完整提取，但正文仅包含一个链接（https://t.co/6RGDAs0ueU）和用户简介，没有提供具体的文章或知识内容。\n\n**局限**\n推文正文被截断或仅为链接，无法获取链接指向的具体文章内容。",
          };
        },
        executeTool: ({ call }) => {
          executedTools.push(call.name);
          if (call.name === "web_extract") {
            return {
              callId: call.id,
              toolName: call.name,
              ok: true,
              content: [
                "status: success",
                "summary: Extracted 912 preview character(s) from X post.",
                "url: https://x.com/ponyodong/status/2055150198989746559",
                "text_preview: X 上的 波妞PONYO：“https://t.co/6RGDAs0ueU” / X http:// x.com/i/article/2055 108247363956736 … 公众号：AI PONYO",
                "candidate_count: 0",
                "result_count: 0",
              ].join("\n"),
              output: {
                status: "success",
                url: "https://x.com/ponyodong/status/2055150198989746559",
                text_preview:
                  "X 上的 波妞PONYO：“https://t.co/6RGDAs0ueU” / X http:// x.com/i/article/2055 108247363956736 … 公众号：AI PONYO",
              },
            };
          }
          if (call.name === "browser_navigate") {
            return {
              callId: call.id,
              toolName: call.name,
              ok: true,
              content:
                "status: success\nsummary: Navigated to https://x.com/ponyodong/status/2055150198989746559.\nurl: https://x.com/ponyodong/status/2055150198989746559\ntitle: X",
              output: {
                status: "success",
                url: "https://x.com/ponyodong/status/2055150198989746559",
                title: "X",
              },
            };
          }
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content: [
              "status: success",
              "summary: Captured browser snapshot with 73 interactive element(s).",
              "url: https://x.com/ponyodong/status/2055150198989746559",
              "title: X 上的 波妞PONYO：“视频制作干货分享｜为什么我放弃了九宫格分镜，改用六宫格故事板” / X",
              "element_count: 73",
              `text:\n${browserArticle}`,
            ].join("\n"),
            output: {
              status: "success",
              url: "https://x.com/ponyodong/status/2055150198989746559",
              title:
                "X 上的 波妞PONYO：“视频制作干货分享｜为什么我放弃了九宫格分镜，改用六宫格故事板” / X",
              text: browserArticle,
              element_count: 73,
            },
          };
        },
      },
    );

    expect(executedTools).toEqual(["browser_navigate", "browser_snapshot"]);
    expect(repairCalled).toBe(true);
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain(
      "tool.observation.final.corrected",
    );
    expect(result.operatorTrace.items.map((item) => item.stage)).toContain("model.repair.rejected");
    expect(result.finalText).toContain("六宫格故事板");
    expect(result.finalText).toContain("时间、场景、运镜、情绪");
    expect(result.finalText).not.toContain("仅包含一个链接");
    expect(result.finalText).not.toContain("无法获取链接指向的具体文章内容");
  });

  it("uses OpenCLI for X article links exposed by a status shell before answering explicit full rereads", async () => {
    const openCliArticle = [
      "文章",
      "波妞PONYO",
      "@ponyodong",
      "视频制作干货分享｜为什么我放弃了九宫格分镜，改用六宫格故事板",
      "九宫格更像九张精美壁纸的陈列，而不是一段真正成立的视频。",
      "六宫格会逼你回到导演思维，每一格都要交代时间、场景、运镜、情绪。",
      "六格可以拆成三段：前五秒建立，中间五秒推进或爆发，后五秒收束、余韵或者反转。",
      "实操时先做 16:9 的六宫格故事板，再把每格扩写成镜头提示词。",
      "六宫格不是少三个框，而是把每一格变成一个导演决策点。".repeat(18),
      "正文尾部：附录B最短版提示词要求先生成16:9六宫格故事板。",
    ].join("\n");
    const executedTools: string[] = [];
    const openCliUrls: string[] = [];

    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-x-reread-follow-article-link",
      sessionKey: "session-1",
      messages: [
        {
          role: "user",
          content:
            "不要入库，只回答。请重新读取 https://x.com/ponyodong/status/2055150198989746559 并回答完整学到了什么。如果正文预览截断，请先二次提取全文。",
        },
      ],
      requiredToolCalls: [
        {
          id: "required-web-extract-explicit-url",
          name: "web_extract",
          args: {
            url: "https://x.com/ponyodong/status/2055150198989746559",
          },
          readOnly: true,
          metadata: {
            requiredGrounding: true,
            sourceCapabilityId: "source.explicit-url.extract",
          },
        },
      ],
      tools: [
        {
          name: "web_extract",
          description: "Extract readable URL text.",
          readOnly: true,
          metadata: { capability: "web.extract" },
        },
        {
          name: "browser_navigate",
          description: "Navigate browser.",
          readOnly: true,
          metadata: { capability: "browser.navigate" },
        },
        {
          name: "browser_snapshot",
          description: "Read browser snapshot.",
          readOnly: true,
          metadata: { capability: "browser.snapshot" },
        },
        {
          name: "director.opencli.invoke",
          description: "Invoke a read-only OpenCLI command.",
          readOnly: true,
          metadata: { capability: "external-tools.opencli.invoke-read" },
        },
      ],
      maxTurns: 1,
      callModel: () => ({
        finalText:
          "根据工具观察，页面内容已被完整提取，但正文仅包含一个链接（https://t.co/6RGDAs0ueU）和用户简介，没有提供具体的文章或知识内容。",
      }),
      executeTool: ({ call }) => {
        executedTools.push(call.name);
        if (call.name === "web_extract") {
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content: [
              "status: success",
              "summary: Extracted preview from X post.",
              "url: https://x.com/ponyodong/status/2055150198989746559",
              "title: 波妞PONYO / X",
              "text_preview: X 上的 波妞PONYO：“https://t.co/6RGDAs0ueU” / X http:// x.com/i/article/2055 108247363956736 … 公众号：AI PONYO",
            ].join("\n"),
            output: {
              status: "success",
              url: "https://x.com/ponyodong/status/2055150198989746559",
              title: "波妞PONYO / X",
              text_preview:
                "X 上的 波妞PONYO：“https://t.co/6RGDAs0ueU” / X http:// x.com/i/article/2055 108247363956736 … 公众号：AI PONYO",
            },
          };
        }
        if (call.name === "director.opencli.invoke") {
          const args = call.args.args as Record<string, unknown>;
          const url = typeof args?.["tweet-id"] === "string" ? args["tweet-id"] : "";
          openCliUrls.push(url);
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content: [
              "status: success",
              "summary: OpenCLI 执行完成：twitter/article",
              "url: https://x.com/i/article/2055108247363956736",
              "title: 视频制作干货分享｜为什么我放弃了九宫格分镜，改用六宫格故事板 / X",
              `text:\n${openCliArticle}`,
              "next_actions: 基于 output.json/text 回答用户；如果为空，不要说学到了。",
            ].join("\n"),
            output: {
              status: "success",
              url: "https://x.com/i/article/2055108247363956736",
              title: "视频制作干货分享｜为什么我放弃了九宫格分镜，改用六宫格故事板 / X",
              text: openCliArticle,
              json: {
                url: "https://x.com/i/article/2055108247363956736",
                title: "视频制作干货分享｜为什么我放弃了九宫格分镜，改用六宫格故事板 / X",
                text: openCliArticle,
              },
              operationId: "opencli.twitter.article",
              sourceRef: "opencli:twitter/article",
            },
            metadata: {
              sourceRef: "opencli:twitter/article",
              operationId: "opencli.twitter.article",
            },
          };
        }
        return {
          callId: call.id,
          toolName: call.name,
          ok: false,
          content: "status: error\nsummary: unexpected tool",
          output: { status: "error" },
        };
      },
    });

    expect(openCliUrls).toContain("https://x.com/i/article/2055108247363956736");
    expect(executedTools).toEqual(["web_extract", "director.opencli.invoke"]);
    expect(
      result.events
        .filter((event) => event.kind === "tool.result")
        .map((event) => event.result.toolName),
    ).toEqual(["web_extract", "director.opencli.invoke"]);
    const openCliResult = result.events
      .filter((event) => event.kind === "tool.result")
      .map((event) => event.result)
      .find((item) => item.toolName === "director.opencli.invoke");
    expect(openCliResult?.content).toContain("六宫格故事板");
    expect(openCliResult?.content).toContain("时间、场景、运镜、情绪");
  });

  it("retries one retriable model failure after required tool evidence and uses the model answer", async () => {
    let modelAttempts = 0;
    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-model-retry-after-learning-evidence",
      sessionKey: "session-1",
      messages: [{ role: "user", content: "刚才学到了什么？" }],
      requiredToolCalls: [
        {
          id: "required-experience-candidates-learning-evidence",
          name: "director.experience.candidates.list",
          args: {},
          readOnly: true,
          metadata: { requiredGrounding: true },
        },
      ],
      tools: [
        {
          name: "director.experience.candidates.list",
          description: "List pending experience candidates.",
          readOnly: true,
          metadata: { capability: "learning.experience.candidates.list" },
        },
      ],
      enableModelRetryAfterToolEvidence: true,
      modelRetryDelayMs: 0,
      metadata: { providerId: "test-provider", modelId: "test-model" },
      callModel: () => {
        modelAttempts += 1;
        if (modelAttempts === 1) {
          throw new Error("fetch failed");
        }
        return {
          finalText:
            "模型重试后基于证据回答：这条经验讲的是先保存可审查候选，再由用户确认是否入库。",
        };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "status: success\nsummary: 已读取 1 条经验候选。",
        output: {
          candidates: [
            {
              id: "experience-retry",
              title: "学习候选重试",
              summary: "先保存可审查候选，再由用户确认是否入库。",
              sourceRef: "https://example.test/retry",
            },
          ],
        },
      }),
    });

    expect(modelAttempts).toBe(2);
    expect(result.finalText).toContain("模型重试后基于证据回答");
    expect(result.events.some((event) => event.kind === "model.error")).toBe(false);
    expect(result.operatorTrace.map((item) => item.stage)).toEqual(
      expect.arrayContaining(["model.retry.scheduled", "model.retry.succeeded"]),
    );
    expect(
      result.operatorTrace.find((item) => item.stage === "model.retry.scheduled")?.metadata,
    ).toMatchObject({
      retry_count: 1,
      retry_reason: "fetch failed",
      evidenceToolSucceeded: true,
    });
  });

  it("retries one transient structured model failure after required tool evidence", async () => {
    let modelAttempts = 0;
    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-model-retry-after-structured-transient-error",
      sessionKey: "session-1",
      messages: [{ role: "user", content: "刚才学到了什么？" }],
      requiredToolCalls: [
        {
          id: "required-experience-candidates-learning-evidence",
          name: "director.experience.candidates.list",
          args: {},
          readOnly: true,
          metadata: { requiredGrounding: true },
        },
      ],
      tools: [
        {
          name: "director.experience.candidates.list",
          description: "List pending experience candidates.",
          readOnly: true,
          metadata: { capability: "learning.experience.candidates.list" },
        },
      ],
      enableModelRetryAfterToolEvidence: true,
      modelRetryDelayMs: 0,
      callModel: () => {
        modelAttempts += 1;
        if (modelAttempts === 1) {
          throw Object.assign(new Error("provider overloaded"), {
            code: "overloaded_error",
            statusCode: 503,
            provider: "anthropic",
          });
        }
        return { finalText: "模型在临时错误后重试成功，并基于证据回答。" };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "status: success\nsummary: 已读取 1 条经验候选。",
        output: {
          candidates: [
            {
              id: "experience-structured-retry",
              title: "临时错误重试",
              summary: "模型临时错误后应该做一次同 provider 重试。",
            },
          ],
        },
      }),
    });

    expect(modelAttempts).toBe(2);
    expect(result.finalText).toContain("重试成功");
    expect(result.operatorTrace.map((item) => item.stage)).toEqual(
      expect.arrayContaining(["model.retry.scheduled", "model.retry.succeeded"]),
    );
    expect(
      result.operatorTrace.find((item) => item.stage === "model.retry.scheduled")?.metadata,
    ).toMatchObject({
      retry_count: 1,
      evidenceToolSucceeded: true,
    });
  });

  it("does not retry non-transient structured model failures after required tool evidence", async () => {
    let modelAttempts = 0;
    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-model-no-retry-auth-error",
      sessionKey: "session-1",
      messages: [{ role: "user", content: "刚才学到了什么？" }],
      requiredToolCalls: [
        {
          id: "required-experience-candidates-learning-evidence",
          name: "director.experience.candidates.list",
          args: {},
          readOnly: true,
          metadata: { requiredGrounding: true },
        },
      ],
      tools: [
        {
          name: "director.experience.candidates.list",
          description: "List pending experience candidates.",
          readOnly: true,
          metadata: { capability: "learning.experience.candidates.list" },
        },
      ],
      enableModelRetryAfterToolEvidence: true,
      modelRetryDelayMs: 0,
      callModel: () => {
        modelAttempts += 1;
        throw Object.assign(new Error("authentication_error"), {
          code: "authentication_error",
          statusCode: 401,
        });
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "status: success\nsummary: 已读取 1 条经验候选。",
        output: {
          candidates: [{ id: "experience-auth-no-retry", title: "认证错误不重试" }],
        },
      }),
    });

    expect(modelAttempts).toBe(1);
    expect(result.finalText).toBeUndefined();
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "model.error", message: "authentication_error" }),
      ]),
    );
    expect(result.operatorTrace.map((item) => item.stage)).not.toContain("model.retry.scheduled");
  });

  it("falls back with trace context when retriable model failures continue after evidence", async () => {
    let modelAttempts = 0;
    const result = await runConversationRuntimeTurn(input({ text: "刚才学到了什么？" }), {
      nowMs: () => 1,
      turnIdFactory: () => "turn-model-retry-after-evidence-fallback",
      orchestrate: () =>
        turn({
          intent: { kind: "chat" },
          userText: "用户追问最近一次学习结果。",
          shouldInvokeRecall: true,
          memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
        }),
      tools: createDirectorConversationRuntimeTools(),
      callModel: () => {
        modelAttempts += 1;
        throw new Error("fetch failed");
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "status: success\nsummary: 已读取 1 条经验候选，用于回答学习结果。",
        output: {
          candidates: [
            {
              id: "experience-fallback-after-retry",
              status: "pending",
              title: "ComfyUI 节点图劝退后的学习方法",
              summary: "正文可用：先让 Codex 安装 ComfyUI，再把工作流整理成可复用模板。",
              contentQuality: "正文可用，但需要入库前复核。",
              sourceRef: "https://x.com/wei_wang/status/2057083939781517422",
              sourceDocument: {
                content:
                  "第一次打开 ComfyUI 时，作者被节点图劝退；这次改成让 Codex 帮忙安装、调用和跑工作流。核心方法是先拿现成 workflow JSON，再配中文 README，写清楚输入参数、输出效果和显存要求。",
              },
            },
          ],
        },
      }),
    });

    expect(modelAttempts).toBe(2);
    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("ComfyUI");
    expect(result.finalText).toContain("https://x.com/wei_wang/status/2057083939781517422");
    expect(result.finalText).not.toContain("<learning-evidence-context>");
    expect(result.operatorTrace.items.map((item) => item.stage)).toEqual(
      expect.arrayContaining(["model.retry.scheduled", "model.error.after_required_tool"]),
    );
    expect(
      result.operatorTrace.items.find((item) => item.stage === "model.error.after_required_tool")
        ?.metadata,
    ).toMatchObject({
      error: "fetch failed",
      evidenceToolSucceeded: true,
      retry_count: 1,
      final_error: "fetch failed",
    });
  });

  it("surfaces media authorization and budget choices in learned-summary followups", async () => {
    const result = await runConversationRuntimeTurn(
      input({ text: "回答我刚才学到了什么，媒体图片视频要怎么处理" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-experience-media-authorization-followup",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "读取候选列表并直接讲清楚媒体授权预算。",
            shouldInvokeRecall: true,
            memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
          }),
        tools: createDirectorConversationRuntimeTools(),
        callModel: () => ({
          finalText: "我学到了视频制作经验。",
        }),
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: "status: success\nsummary: 已读取 1 条经验候选，用于直接回答用户“学到了什么”。",
          output: {
            evidenceDisclosure: {
              sources: [
                {
                  url: "https://x.com/ponyodong/status/2055150198989746559",
                  candidateId: "experience-media-auth",
                  fullBodyChars: 2048,
                  mediaCount: 2,
                  mediaInventory: {
                    assetCount: 2,
                    imageCount: 1,
                    videoCount: 1,
                    audioCount: 0,
                  },
                  mediaAdmission: {
                    canAdmitMediaContent: false,
                    reason: "media_not_understood_without_user_authorization",
                  },
                  mediaUnderstandingStatus: "metadata_only",
                },
              ],
            },
            candidates: [
              {
                id: "experience-media-auth",
                title: "波妞PONYO：从九宫格分镜改用六宫格故事板",
                summary: "六宫格故事板更适合 15 秒 AI 视频的叙事推进。",
                applicability: "先锁定六格故事板，再生成关键帧和视频。",
                risks: ["媒体内容必须授权解析后才能入库。"],
                evidencePreview:
                  "正文可读；媒体资源包含 1 张 pbs.twimg.com 图片和 1 个 blob:https://x.com/video 视频引用。",
                sourceRef: "https://x.com/ponyodong/status/2055150198989746559",
                mediaAuthorizationRequest: {
                  required: true,
                  reason: "media_requires_user_authorization_and_budget_before_understanding",
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
                      mode: "media_inventory",
                      label: "只记录媒体清单",
                      description: "保留媒体链接。",
                      requiresUserAuthorization: false,
                      estimatedTokenBudget: 0,
                      estimatedCostTier: "none",
                    },
                    {
                      mode: "low_cost",
                      label: "低成本精读重点媒体",
                      description: "抽关键帧/OCR/转录。",
                      requiresUserAuthorization: true,
                      estimatedTokenBudget: 7200,
                      estimatedCostTier: "medium",
                    },
                  ],
                },
              },
            ],
          },
        }),
      },
    );

    expect(result.finalText).toContain("媒体授权");
    expect(result.finalText).toContain("发现 2 个媒体资产");
    expect(result.finalText).toContain("图片 1");
    expect(result.finalText).toContain("视频 1");
    expect(result.finalText).toContain("推荐：低成本精读重点媒体");
    expect(result.finalText).toContain("预算档位：medium");
    expect(result.finalText).toContain("未授权前不把媒体内容当成已学经验入库");
    expect(result.finalText).not.toContain("媒体未理解");
  });

  it("adds brief-answer guidance for value-judgment learning followups", async () => {
    let systemPrompt = "";
    const result = await runConversationRuntimeTurn(
      input({ text: "根据你的经验，这个内容有用吗" }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-learning-value-judgment-brief",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户围绕上一轮学习结果询问价值判断。",
            shouldInvokeRecall: true,
            memoryDecision: { action: "never-store", reason: "候选查看不写入长期记忆。" },
          }),
        tools: createDirectorConversationRuntimeTools(),
        callModel: ({ messages }) => {
          systemPrompt = messages.find((message) => message.role === "system")?.content ?? "";
          return { finalText: "有用，建议沉淀为待审经验。" };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: "status: success\nsummary: 已读取 1 条经验候选。",
          output: { candidates: [] },
        }),
      },
    );

    expect(result.finalText).toContain("有用");
    expect(systemPrompt).toContain("用户期望简短回答");
    expect(systemPrompt).toContain("先给结论");
    expect(systemPrompt).toContain("1-2 句话");
  });

  it("adds brief-answer guidance for explicit concise business questions", async () => {
    let systemPrompt = "";
    const result = await runConversationRuntimeTurn(
      input({
        text: "2026年做AI短剧时，先生成分镜图再生视频，应该优先比较哪些能力维度？只用三点回答。",
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-ai-short-drama-brief-consultation",
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "用户正在咨询 AI 短剧制作判断，不创建制作任务。",
            shouldInvokeRecall: true,
            memoryDecision: { action: "never-store", reason: "咨询问答不写入长期记忆。" },
          }),
        tools: createDirectorConversationRuntimeTools(),
        callModel: ({ messages }) => {
          systemPrompt = messages.find((message) => message.role === "system")?.content ?? "";
          return { finalText: "优先比较：角色一致性、镜头可控性、图生视频稳定性。" };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: "status: success",
          output: {},
        }),
      },
    );

    expect(result.finalText).toContain("角色一致性");
    expect(systemPrompt).toContain("用户期望简短回答");
    expect(systemPrompt).toContain("先给结论");
  });

  it("closes out with the best completed web search evidence when the model keeps searching until max turns", async () => {
    const registry = createConversationRunRegistry({
      nowMs: () => 1,
      turnRunIdFactory: () => "turn-run-web-search-evidence-fallback",
    });
    let modelTurns = 0;

    const result = await runConversationRuntimeTurn(
      input({
        text: "我不是让你生成图，也不是让你做分镜任务。你去网上看看 2026 年图片生成模型最近大家在讨论谁更强，给我结论和来源。",
      }),
      {
        runRegistry: registry,
        nowMs: () => 1,
        turnIdFactory: () => "turn-web-search-evidence-fallback",
        maxModelToolLoopTurns: 4,
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "先联网查证，再用中文给用户结论和来源。",
            shouldInvokeRecall: false,
            memoryDecision: { action: "never-store", reason: "普通联网问答不写入长期记忆。" },
          }),
        tools: [
          {
            name: "web_search",
            description: "Search the public web.",
            readOnly: true,
            metadata: { capability: "web.search" },
          },
        ],
        callModel: () => {
          modelTurns += 1;
          return {
            toolCalls: [
              {
                id: `call-web-search-${modelTurns}`,
                name: "web_search",
                args: { query: `2026 AI image generation model comparison ${modelTurns}` },
                readOnly: true,
              },
            ],
          };
        },
        executeTool: ({ call }) => {
          if (call.id === "call-web-search-4") {
            return {
              callId: call.id,
              toolName: call.name,
              ok: true,
              content:
                'status: warning\nsummary: No web search results found for "2026 AI image generation models comparison review benchmark".\nquery: 2026 AI image generation models comparison review benchmark\nprovider: duckduckgo\nsource_type: web\nresult_count: 0',
              output: {
                status: "warning",
                query: "2026 AI image generation models comparison review benchmark",
                provider: "duckduckgo",
                source_type: "web",
                results: [],
              },
            };
          }
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content:
              'status: success\nsummary: Found 2 source candidate(s) for "2026年 AI图像生成模型 对比".\nquery: 2026年 AI图像生成模型 对比\nprovider: duckduckgo\nsource_type: web\nresult_count: 2\nresult_1: 2026 AI 图像生成工具完整比较：Midjourney v7 / Flux Pro / Imagen 4 | url=https://example.test/image-models-2026 | source=duckduckgo | snippet=对 Midjourney v7、Flux Pro、Imagen 4、Stable Diffusion XL 各有适用场景的比较。\nresult_2: 2026 顶级AI图像生成工具排行榜 | url=https://example.test/best-ai-image-2026 | source=duckduckgo | snippet=比较画质、风格多样性、商业授权和价格。',
            output: {
              status: "success",
              query: "2026年 AI图像生成模型 对比",
              provider: "duckduckgo",
              source_type: "web",
              results: [
                {
                  title: "2026 AI 图像生成工具完整比较：Midjourney v7 / Flux Pro / Imagen 4",
                  url: "https://example.test/image-models-2026",
                  snippet:
                    "对 Midjourney v7、Flux Pro、Imagen 4、Stable Diffusion XL 各有适用场景的比较。",
                },
                {
                  title: "2026 顶级AI图像生成工具排行榜",
                  url: "https://example.test/best-ai-image-2026",
                  snippet: "比较画质、风格多样性、商业授权和价格。",
                },
              ],
            },
          };
        },
      },
    );

    expect(modelTurns).toBe(4);
    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("先给结论");
    expect(result.finalText).toContain("Midjourney v7");
    expect(result.finalText).toContain("https://example.test/image-models-2026");
    expect(result.finalText).not.toContain("我已通过duckduckgo检索");
    expect(result.finalText).not.toContain("模型不可用");
    expect(result.events.some((event) => event.kind === "runtime.error")).toBe(false);
    expect(registry.read("turn-run-web-search-evidence-fallback")).toMatchObject({
      status: "completed",
      failureTaxonomy: [],
      userVisibleSummary: expect.stringContaining("Midjourney v7"),
    });
  });

  it("closes out desktop external-tool-bus web evidence when the model reaches max turns", async () => {
    const registry = createConversationRunRegistry({
      nowMs: () => 1,
      turnRunIdFactory: () => "turn-run-desktop-external-web-evidence-fallback",
    });
    let modelTurns = 0;

    const result = await runConversationRuntimeTurn(
      input({
        surface: "desktop",
        channel: "desktop",
        text: "别给我建任务，也别绕远。现在去网上查一下最近大家怎么评价视频生成模型，最后只给我三条结论和来源。",
      }),
      {
        runRegistry: registry,
        nowMs: () => 1,
        turnIdFactory: () => "turn-desktop-external-web-evidence-fallback",
        maxModelToolLoopTurns: 4,
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "先联网查证，再用中文给用户结论和来源。",
            shouldInvokeRecall: false,
            memoryDecision: { action: "never-store", reason: "普通联网问答不写入长期记忆。" },
          }),
        tools: [
          {
            name: "web_search",
            description: "Search the public web.",
            readOnly: true,
            metadata: { capability: "web.search" },
          },
        ],
        callModel: () => {
          modelTurns += 1;
          return {
            toolCalls: [
              {
                id: `desktop-web-search-${modelTurns}`,
                name: "web_search",
                args: { query: `2026年AI视频生成模型对比 ${modelTurns}` },
                readOnly: true,
              },
            ],
          };
        },
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content:
            call.id === "desktop-web-search-4"
              ? 'status: warning\nsummary: No web search results found for "2026年AI视频生成 哪个模型最好 知乎 Reddit 讨论".\nquery: 2026年AI视频生成 哪个模型最好 知乎 Reddit 讨论\nprovider: duckduckgo\nsource_type: web\ncandidate_count: 0\nresult_count: 0\nnext_actions: extract promising URLs with web_extract'
              : 'status: success\nsummary: Found 4 source candidate(s) for "2026年AI视频生成模型对比 哪个更好 用户评价" via duckduckgo.\nquery: 2026年AI视频生成模型对比 哪个更好 用户评价\nprovider: duckduckgo\nsource_type: web\ncandidate_count: 0\nresult_count: 4\nresult_1: Generate Videos with 4 Modes - Generate Videos With Audio | url=https://duckduckgo.com/y.js?ad_domain=byteplus.com&u3=https%3A%2F%2Fbyteplus.com%2F | source=duckduckgo | snippet=Generate professional 2K, 4K videos and take advantage of 15-second maximum runtime.\nresult_2: Try Artlist\'s Video Generator - Free AI Video Generator | url=https://www.bing.com/aclick?ld=ad-result | source=duckduckgo\nresult_3: Runway Gen-4 brings controllable video generation to production | url=https://runwayml.com/research/gen-4 | source=duckduckgo | snippet=Runway discusses Gen-4 consistency, control and production workflows.\nresult_4: Luma Dream Machine creator guide and model updates | url=https://lumalabs.ai/dream-machine | source=duckduckgo | snippet=Luma explains model updates for video generation and creative workflows.\nnext_actions: extract promising URLs with web_extract',
          metadata: {
            source: "external-tool-bus",
            externalToolExecutionId: `external-tool:${call.id}`,
            externalToolInvokeStatus: "success",
            externalToolTimelineStatus: "completed",
          },
        }),
      },
    );

    expect(modelTurns).toBe(4);
    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("先给结论");
    expect(result.finalText).toContain("Runway Gen-4");
    expect(result.finalText).toContain("https://runwayml.com/research/gen-4");
    expect(result.finalText).toContain("Luma Dream Machine");
    expect(result.finalText).not.toContain("我已通过duckduckgo检索");
    expect(result.finalText).not.toContain("Generate Videos with 4 Modes");
    expect(result.finalText).not.toContain("byteplus.com");
    expect(result.finalText).not.toContain("bing.com/aclick");
    expect(result.finalText).not.toContain("模型不可用");
    expect(result.events.some((event) => event.kind === "runtime.error")).toBe(false);
    expect(registry.read("turn-run-desktop-external-web-evidence-fallback")).toMatchObject({
      status: "completed",
      failureTaxonomy: [],
      userVisibleSummary: expect.stringContaining("Runway Gen-4"),
    });
  });

  it("does not pretend ad-only web search evidence is reliable when the model reaches max turns", async () => {
    const result = await runConversationRuntimeTurn(
      input({
        surface: "desktop",
        channel: "desktop",
        text: "查一下最近视频生成模型谁更强，只给可靠来源。广告别算。",
      }),
      {
        nowMs: () => 1,
        turnIdFactory: () => "turn-ad-only-web-evidence-fallback",
        maxModelToolLoopTurns: 2,
        orchestrate: () =>
          turn({
            intent: { kind: "chat" },
            userText: "先联网查证，再用中文给用户结论和来源。",
            shouldInvokeRecall: false,
            memoryDecision: { action: "never-store", reason: "普通联网问答不写入长期记忆。" },
          }),
        tools: [
          {
            name: "web_search",
            description: "Search the public web.",
            readOnly: true,
            metadata: { capability: "web.search" },
          },
        ],
        callModel: () => ({
          toolCalls: [
            {
              id: "ad-only-web-search",
              name: "web_search",
              args: { query: "AI video generation model ranking ads" },
              readOnly: true,
            },
          ],
        }),
        executeTool: ({ call }) => ({
          callId: call.id,
          toolName: call.name,
          ok: true,
          content:
            'status: success\nsummary: Found 2 source candidate(s) for "AI video generation model ranking ads" via duckduckgo.\nquery: AI video generation model ranking ads\nprovider: duckduckgo\nsource_type: web\nresult_count: 2\nresult_1: Generate Videos with 4 Modes - Generate Videos With Audio | url=https://duckduckgo.com/y.js?ad_domain=byteplus.com&u3=https%3A%2F%2Fbyteplus.com%2F | source=duckduckgo | snippet=Generate professional 2K, 4K videos.\nresult_2: Try Artlist\'s Video Generator - Free AI Video Generator | url=https://www.bing.com/aclick?ld=ad-result | source=duckduckgo',
        }),
      },
    );

    expect(result.replySource).toBe("tool-loop");
    expect(result.finalText).toContain("没有拿到可靠来源");
    expect(result.finalText).not.toContain("Generate Videos with 4 Modes");
    expect(result.finalText).not.toContain("byteplus.com");
    expect(result.finalText).not.toContain("bing.com/aclick");
    expect(result.finalText).not.toContain("模型不可用");
  });

  it("classifies provider 503 failures as upstream failures in the run registry", async () => {
    const registry = createConversationRunRegistry({
      nowMs: () => 1,
      turnRunIdFactory: () => "turn-run-provider-upstream-failed",
    });

    const result = await runConversationRuntimeTurn(input({ text: "你现在能做什么？" }), {
      runRegistry: registry,
      nowMs: () => 1,
      turnIdFactory: () => "turn-provider-upstream-failed",
      orchestrate: () =>
        turn({
          intent: { kind: "capability-intro" },
          userText: "结合当前能力自然回答。",
          memoryDecision: { action: "never-store", reason: "能力问答不写入记忆。" },
          shouldInvokeRecall: true,
        }),
      resolveCapabilityContext: () => ({
        status: "hit",
        visibleSummary: "已启用 Skill 2 个。",
        hits: [{ id: "skill:storyboard", source: "skill", status: "hit" }],
      }),
      callModel: () => {
        throw new Error("模型调用失败：HTTP 503 Service Unavailable");
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "ok",
      }),
    });

    expect(result.replySource).toBe("degraded-error");
    expect(result.finalText).toContain("模型供应方暂时不可用");
    expect(result.finalText).not.toContain("当前没有可用的模型供应方");
    expect(registry.read("turn-run-provider-upstream-failed")).toMatchObject({
      status: "failed",
      failureTaxonomy: ["provider_upstream_failed"],
      internalFailure: expect.stringContaining("HTTP 503"),
    });
  });

  it("maps channels-core shaped turn results into runtime decisions", () => {
    const angelRoleProfile = {
      roleId: "director-angel",
      title: "导演 Angel",
      domain: "影视制作",
      responsibilities: ["持续学习影视制作经验"],
      learningScope: ["短剧制作"],
      controllableSystems: ["moyin"],
    };
    const runtimeInput = input({
      surface: "host-api",
      accountId: "account-1",
      trustedContext: {
        activeRunId: "run-1",
        angelRoleProfile,
      },
    });
    expect(buildChannelTurnInputFromRuntimeInput(runtimeInput, { agentId: "angel" })).toMatchObject(
      {
        text: "你现在能做什么？",
        surface: "api",
        channel: "desktop",
        agentId: "angel",
        peerId: "user-1",
        sessionKey: "session-1",
        angelRoleProfile,
      },
    );

    const channelTurnInput = buildChannelTurnInputFromRuntimeInput(
      input({
        attachments: [{ id: "image-1", kind: "image", mimeType: "image/png" }],
        metadata: {
          textModelCapabilities: { text: true, vision: false },
        },
      }),
    );
    expect(channelTurnInput).toMatchObject({
      attachments: [{ id: "image-1", kind: "image", mimeType: "image/png" }],
      textModelCapabilities: { text: true, vision: false },
    });

    const mapped = mapChannelTurnResultToRuntimeTurnDecision({
      intent: {
        kind: "production-start",
        objective: "生成15秒短剧",
        command: {
          commandId: "production.start",
          matchedName: "/制作",
          args: "生成15秒短剧",
        },
        metadata: {
          angelRoleProfile,
          capabilityRoute: {
            abilityGroup: "text",
            intentKind: "text_chat",
            inputModalities: ["text"],
            outputModality: "text",
            requiresMediaUnderstanding: false,
            explicitGeneration: false,
            reason: "默认文本对话。",
          },
        },
      },
      capabilityRoute: {
        abilityGroup: "text",
        intentKind: "text_chat",
        inputModalities: ["text"],
        outputModality: "text",
        requiresMediaUnderstanding: false,
        explicitGeneration: false,
        reason: "默认文本对话。",
      },
      responsePolicy: "result-first",
      userText: "我会按这个目标制作：生成15秒短剧",
      operatorTrace: [{ stage: "intent-decided", detail: "进入制作链路。" }],
      memoryDecision: { action: "store-result-only", reason: "只保存结果。" },
      shouldInvokeRecall: true,
      shouldCreateRun: true,
      shouldAttachToActiveSession: false,
    });

    expect(mapped.intent.command).toMatchObject({
      name: "production.start",
      raw: "/制作",
      args: "生成15秒短剧",
    });
    expect(mapped.intent.metadata).toMatchObject({
      angelRoleProfile,
    });
    expect(mapped.metadata).toMatchObject({
      angelRoleProfile,
    });
    expect(mapped.capabilityRoute).toMatchObject({
      abilityGroup: "text",
    });
    expect(mapped.trace?.[0]?.source).toBe("orchestrator");
    expect(mapped.shouldInvokeRecall).toBe(true);
  });

  it("maps director capability packets into runtime capability packets", () => {
    const packet = mapDirectorCapabilityPacketToRuntimeCapabilityPacket({
      visibleSummary: "命中经验 1 个，Skill 1 个",
      hiddenPromptBlock: "hidden recall",
      recallStatus: "hit",
      skillStatus: "hit",
      knowledgeHits: [{ id: "knowledge-1", title: "镜头语言" }],
      skillHits: [{ id: "storyboard", title: "分镜技能" }],
      recallTrace: [
        {
          source: "memory",
          status: "hit",
          id: "user",
          reason: "stable preference matched",
          promptChars: 20,
        },
      ],
    });

    expect(packet.status).toBe("hit");
    expect(packet.hiddenPromptBlock).toBe("hidden recall");
    expect(packet.hits.map((hit) => hit.id)).toEqual([
      "knowledge:knowledge-1",
      "skill:storyboard",
      "memory:user",
    ]);
  });
});
