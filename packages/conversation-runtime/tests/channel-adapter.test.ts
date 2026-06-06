import { describe, expect, it } from "vitest";

import {
  type ConversationRuntimeChannelAdapter,
  type ConversationRuntimeNormalizedTurnInput,
  type ConversationRuntimeTurnDecision,
  assertConversationRuntimeContract,
  buildChannelTurnInputFromRuntimeInput,
  buildRuntimeInputFromNormalizedTurnInput,
  runConversationRuntimeChannelTurn,
} from "../src/index.js";

function normalizedTurn(
  overrides: Partial<ConversationRuntimeNormalizedTurnInput> = {},
): ConversationRuntimeNormalizedTurnInput {
  return {
    surface: "weixin",
    channel: "weixin",
    accountId: "account-1",
    message: {
      id: "message-1",
      rawBody: "/制作 生成15秒短剧",
      bodyForAgent: "生成15秒短剧",
      timestampMs: 100,
    },
    sender: {
      id: "user-1",
      displayLabel: "用户",
      roles: ["operator"],
    },
    conversation: {
      kind: "direct",
      nativeChannelId: "peer-1",
    },
    route: {
      sessionKey: "weixin:account-1:peer-1",
      accountId: "account-1",
      routeKind: "direct",
    },
    reply: {
      to: "peer-1",
      replyToId: "message-1",
    },
    access: {
      commandAuthorized: true,
    },
    ...overrides,
  };
}

function productionTurn(): ConversationRuntimeTurnDecision {
  return {
    intent: {
      kind: "production-start",
      objective: "生成15秒短剧",
      command: {
        name: "production.start",
        raw: "/制作",
        args: "生成15秒短剧",
      },
    },
    responsePolicy: "result-first",
    audience: "user",
    userText: "",
    memoryDecision: {
      action: "store-result-only",
      reason: "制作结果才可进入候选。",
    },
    shouldInvokeRecall: true,
    shouldCreateRun: true,
    shouldAttachToActiveSession: false,
  };
}

function chatTurn(
  overrides: Partial<ConversationRuntimeTurnDecision> = {},
): ConversationRuntimeTurnDecision {
  return {
    intent: { kind: "chat" },
    responsePolicy: "result-first",
    audience: "user",
    userText: "用户要求先用指定来源查证再回答。",
    memoryDecision: {
      action: "transient",
      reason: "来源检索对话只保留在当前会话上下文。",
    },
    shouldInvokeRecall: true,
    shouldCreateRun: false,
    shouldAttachToActiveSession: false,
    ...overrides,
  };
}

describe("conversation runtime channel adapter boundary", () => {
  it("maps normalized channel facts into a runtime input without channel-specific code", () => {
    const input = buildRuntimeInputFromNormalizedTurnInput(
      normalizedTurn({
        supplemental: {
          quote: {
            id: "quote-1",
            body: "上一条内容",
            sender: "user-0",
          },
        },
      }),
    );

    expect(input).toMatchObject({
      surface: "weixin",
      channel: "weixin",
      messageId: "message-1",
      sessionKey: "weixin:account-1:peer-1",
      text: "生成15秒短剧",
      accountId: "account-1",
      sender: {
        id: "user-1",
        displayName: "用户",
      },
      quotedContext: {
        messageId: "quote-1",
        senderId: "user-0",
        text: "上一条内容",
      },
    });
    expect(input.trustedContext?.metadata?.route).toMatchObject({
      sessionKey: "weixin:account-1:peer-1",
    });
    expect(input.untrustedChannelContext?.payload).toBeDefined();
  });

  it("runs ingest, classify, runtime dispatch, delivery, and finalize through one channel-neutral contract", async () => {
    const delivered: string[] = [];
    const adapter: ConversationRuntimeChannelAdapter<{ id: string }> = {
      id: "test-weixin",
      channel: "weixin",
      ingest: () => normalizedTurn(),
      classifyTransportEvent: () => ({
        kind: "command",
        canStartAgentTurn: true,
        reason: "authorized command",
      }),
      deliverEvent: (event) => {
        delivered.push(event.kind);
        return {
          eventId: event.id,
          delivered: true,
          channelMessageId: `wx-${event.id}`,
        };
      },
      finalize: (_input, result) => ({
        ok: result.runtimeResult?.finalText === "结果优先回复",
      }),
    };

    const result = await runConversationRuntimeChannelTurn(
      { id: "raw-message-1" },
      {
        adapter,
        nowMs: () => 1,
        runtime: {
          nowMs: () => 1,
          turnIdFactory: () => "turn-1",
          orchestrate: () => productionTurn(),
          resolveCapabilityContext: () => ({
            status: "hit",
            hiddenPromptBlock: "knowledge context",
            hits: [{ id: "knowledge:shot", source: "knowledge", status: "hit" }],
          }),
          startProduction: () => ({
            ok: true,
            status: "running",
            runId: "run-1",
            finalText: "结果优先回复",
          }),
        },
      },
    );

    expect(result.admission.kind).toBe("dispatch");
    expect(result.runtimeInput?.text).toBe("生成15秒短剧");
    expect(result.runtimeResult?.runId).toBe("run-1");
    expect(result.runtimeResult?.capabilityPacket?.status).toBe("hit");
    expect(delivered).toEqual(["runtime.final"]);
    expect(result.deliveries[0]).toMatchObject({
      delivered: true,
      channelMessageId: "wx-turn-1:final",
    });
    expect(result.finalizeResult?.ok).toBe(true);
    expect(result.log.map((event) => event.stage)).toEqual([
      "ingest",
      "classify",
      "preflight",
      "assemble",
      "dispatch",
      "finalize",
    ]);
    expect(result.operatorTrace.map((item) => item.stage)).toContain("production.dispatched");
  });

  it("keeps WeChat source-search chat on the unified recall and model/tool loop", async () => {
    const deliveredTexts: string[] = [];
    const resolvedRecallRequests: unknown[] = [];
    const modelRequests: unknown[] = [];
    const executedTools: unknown[] = [];
    const adapter: ConversationRuntimeChannelAdapter<{ id: string }> = {
      id: "test-weixin",
      channel: "weixin",
      ingest: () =>
        normalizedTurn({
          message: {
            id: "message-source-1",
            rawBody: "去微信公众号搜索相关seedance2.0的教程",
            bodyForAgent: "去微信公众号搜索相关seedance2.0的教程",
            timestampMs: 100,
          },
        }),
      classifyTransportEvent: () => ({
        kind: "message",
        canStartAgentTurn: true,
        reason: "operator message",
      }),
      deliverEvent: (event) => {
        if (event.kind === "runtime.final" && typeof event.payload.text === "string") {
          deliveredTexts.push(event.payload.text);
        }
        return {
          eventId: event.id,
          delivered: true,
          channelMessageId: `wx-${event.id}`,
        };
      },
    };

    const result = await runConversationRuntimeChannelTurn(
      { id: "raw-source-1" },
      {
        adapter,
        nowMs: () => 1,
        runtime: {
          nowMs: () => 1,
          turnIdFactory: () => "turn-weixin-source-search",
          orchestrate: () => chatTurn(),
          resolveCapabilityContext: (request) => {
            resolvedRecallRequests.push(request);
            return {
              status: "hit",
              visibleSummary: "命中微信公众号搜索来源经验。",
              hiddenPromptBlock:
                "经验：用户说微信公众号文章时，优先通过 sogou-weixin 搜索并读取结果。",
              hits: [
                {
                  id: "knowledge:wechat-sogou-source-route",
                  source: "knowledge",
                  status: "hit",
                },
              ],
            };
          },
          tools: [
            {
              name: "web_search",
              description: "Search the public web.",
              readOnly: true,
              metadata: { capability: "web.search", source: "built-in" },
            },
          ],
          callModel: (request) => {
            modelRequests.push(request);
            expect(JSON.stringify(request)).toContain("命中微信公众号搜索来源经验");
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
              finalText: "我已通过搜狗微信公众号文章搜索查到 Seedance 2.0 教程候选。",
            };
          },
          executeTool: ({ call }) => {
            executedTools.push(call);
            return {
              callId: call.id,
              toolName: call.name,
              ok: true,
              content:
                'status: success\nsummary: Found 1 source candidate(s) for "seedance2.0 教程" via sogou-weixin.\nquery: seedance2.0 教程\nprovider: sogou-weixin\nsource_type: weixin_article\nresult_count: 1\nresult_1: Seedance 2.0 公众号实操教程 | url=https://mp.weixin.qq.com/s/seedance-tutorial | source=sogou-weixin | snippet=来自微信公众号的 Seedance 2.0 教程。',
            };
          },
        },
      },
    );

    expect(result.admission.kind).toBe("dispatch");
    expect(result.runtimeResult?.replySource).toBe("tool-loop");
    expect(result.runtimeResult?.capabilityPacket?.status).toBe("hit");
    expect(resolvedRecallRequests).toHaveLength(1);
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
    expect(modelRequests.length).toBeGreaterThanOrEqual(1);
    expect(deliveredTexts).toHaveLength(1);
    expect(deliveredTexts[0]).toContain("搜狗微信公众号文章搜索");
    expect(deliveredTexts[0]).toContain("Seedance 2.0 公众号实操教程");
    expect(deliveredTexts[0]).toContain("https://mp.weixin.qq.com/s/seedance-tutorial");
    expect(deliveredTexts[0]).not.toBe(
      "我已通过搜狗微信公众号文章搜索查到 Seedance 2.0 教程候选。",
    );
    expect(result.operatorTrace.map((item) => item.stage)).toEqual(
      expect.arrayContaining(["capability.resolved", "tool.required", "model.loop.completed"]),
    );
    assertConversationRuntimeContract(result.runtimeResult, {
      id: "weixin-source-search-runtime-contract",
      requirements: [
        { signal: "capability-resolved" },
        { signal: "knowledge-hit" },
        { signal: "tool-required", toolName: "web_search", capability: "web.search" },
        { signal: "model-loop" },
        { signal: "grounded-repair" },
      ],
    });
  });

  it("keeps intent, Angel role context, and user projection consistent across clients", async () => {
    const angelRoleProfile = {
      roleId: "director-angel",
      title: "导演 Angel",
      domain: "影视制作",
      responsibilities: ["持续学习影视制作经验", "输出分镜和制作方案"],
      learningScope: ["短剧制作", "AI 影像生成"],
      controllableSystems: ["moyin"],
    };
    const surfaces = [
      { surface: "weixin", channel: "weixin", sessionKey: "weixin:account-1:peer-1" },
      { surface: "desktop", channel: "desktop", sessionKey: "desktop:account-1:main" },
      { surface: "host-api", channel: "api", sessionKey: "api:account-1:client-1" },
    ] as const;

    const results = await Promise.all(
      surfaces.map((client) => {
        const deliveredTexts: string[] = [];
        const adapter: ConversationRuntimeChannelAdapter<{ id: string }> = {
          id: `test-${client.channel}`,
          channel: client.channel,
          ingest: () =>
            normalizedTurn({
              surface: client.surface,
              channel: client.channel,
              message: {
                id: `${client.channel}-message-1`,
                rawBody: "学习这个 https://example.com/director-guide",
                bodyForAgent: "学习这个 https://example.com/director-guide",
                timestampMs: 100,
              },
              route: {
                sessionKey: client.sessionKey,
                accountId: "account-1",
                routeKind: "direct",
              },
              metadata: {
                angelRoleProfile,
              },
            }),
          classifyTransportEvent: () => ({
            kind: "message",
            canStartAgentTurn: true,
            reason: "operator message",
          }),
          deliverEvent: (event) => {
            if (event.kind === "runtime.final") {
              deliveredTexts.push(event.payload.text);
            }
            return {
              eventId: event.id,
              delivered: true,
              channelMessageId: `${client.channel}-${event.id}`,
            };
          },
        };

        return runConversationRuntimeChannelTurn(
          { id: `${client.channel}-raw` },
          {
            adapter,
            nowMs: () => 1,
            runtime: {
              nowMs: () => 1,
              turnIdFactory: () => `${client.channel}-turn-1`,
              orchestrate: (runtimeInput) => {
                const channelTurn = buildChannelTurnInputFromRuntimeInput(runtimeInput);
                expect(channelTurn.angelRoleProfile).toEqual(angelRoleProfile);
                return {
                  intent: {
                    kind: "learning-admit",
                    objective: runtimeInput.text,
                    metadata: {
                      sourceKind: "url",
                      url: "https://example.com/director-guide",
                      angelRoleProfile,
                    },
                  },
                  responsePolicy: "review-gated",
                  audience: "user",
                  userText: "我会把这份资料整理成待审经验候选，先审后收录。",
                  memoryDecision: {
                    action: "candidate-review",
                    reason: "明确学习请求只能进入待审候选。",
                  },
                  shouldInvokeRecall: false,
                  shouldCreateRun: false,
                  shouldAttachToActiveSession: false,
                  metadata: { angelRoleProfile },
                };
              },
              callModel: () => ({ finalText: "模型原文不应该越过用户投影" }),
              executeTool: () => ({
                callId: "unused",
                toolName: "unused",
                ok: true,
                content: "",
              }),
            },
          },
        ).then((result) => ({ client, deliveredTexts, result }));
      }),
    );

    expect(results.map((entry) => entry.result.runtimeResult?.intent?.kind)).toEqual([
      "learning-admit",
      "learning-admit",
      "learning-admit",
    ]);
    expect(
      results.map((entry) => entry.result.runtimeInput?.trustedContext?.angelRoleProfile),
    ).toEqual([angelRoleProfile, angelRoleProfile, angelRoleProfile]);
    expect(results.map((entry) => entry.result.runtimeResult?.turn?.metadata)).toEqual([
      { angelRoleProfile },
      { angelRoleProfile },
      { angelRoleProfile },
    ]);
    for (const { deliveredTexts, result } of results) {
      expect(result.runtimeResult?.events.at(-1)?.kind).toBe("runtime.final");
      expect(deliveredTexts).toEqual(["我会把这份资料整理成待审经验候选，先审后收录。"]);
      expect(deliveredTexts[0]).not.toContain("模型原文");
    }
  });

  it("supports observe-only and handled turns without invoking the runtime", async () => {
    const adapter: ConversationRuntimeChannelAdapter<{ id: string }> = {
      id: "test-delivery",
      channel: "desktop",
      ingest: () => normalizedTurn({ surface: "desktop", channel: "desktop" }),
      classifyTransportEvent: () => ({
        kind: "delivery",
        canStartAgentTurn: false,
        reason: "read receipt",
      }),
    };

    const result = await runConversationRuntimeChannelTurn(
      { id: "receipt-1" },
      {
        adapter,
        nowMs: () => 1,
        runtime: {
          orchestrate: () => {
            throw new Error("runtime should not run");
          },
        },
      },
    );

    expect(result.admission).toEqual({
      kind: "observe-only",
      reason: "read receipt",
    });
    expect(result.runtimeResult).toBeUndefined();
    expect(result.log.map((event) => event.stage)).toEqual([
      "ingest",
      "classify",
      "preflight",
      "finalize",
    ]);
  });
});
