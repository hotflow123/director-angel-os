import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createAgentDelegateTaskBackedToolExecutor,
  createConversationRuntimeToolLoopDetector,
  createFileConversationRuntimeToolEvidenceStore,
  createRunSubagentSynchronousToolExecutor,
  createSpawnSubagentTaskBackedToolExecutor,
  runConversationRuntimeModelToolLoop,
} from "../src/index.js";

describe("runConversationRuntimeModelToolLoop", () => {
  it("passes the abort signal into model turns and stops when it is aborted", async () => {
    const controller = new AbortController();
    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-stop-model",
      sessionKey: "session-1",
      messages: [{ role: "user", content: "慢一点回答" }],
      abortSignal: controller.signal,
      callModel: ({ signal }) => {
        expect(signal).toBe(controller.signal);
        controller.abort(new Error("operator stopped turn"));
        return { finalText: "这条迟到回复不能发给用户" };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "ok",
      }),
    });

    expect(result.finalText).toBeUndefined();
    expect(result.stoppedReason).toBe("interrupted");
    expect(result.events).toEqual([
      expect.objectContaining({ kind: "model.turn" }),
      expect.objectContaining({ kind: "loop.stopped", reason: "interrupted" }),
    ]);
  });

  it("passes the abort signal into tool executions and stops before the next model turn", async () => {
    const controller = new AbortController();
    const modelCalls: string[] = [];
    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-stop-tool",
      sessionKey: "session-1",
      messages: [{ role: "user", content: "读取链接" }],
      tools: [{ name: "web_extract", description: "Extract web page", readOnly: true }],
      abortSignal: controller.signal,
      callModel: ({ messages }) => {
        modelCalls.push(messages.map((message) => message.role).join(","));
        return {
          assistantMessage: { role: "assistant", content: "我去读取。" },
          toolCalls: [
            {
              id: "tool-stop-1",
              name: "web_extract",
              args: { url: "https://example.com" },
              readOnly: true,
            },
          ],
        };
      },
      executeTool: ({ call, signal }) => {
        expect(signal).toBe(controller.signal);
        controller.abort("operator stopped turn during tool");
        return {
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: "这条工具观察不能继续喂给模型",
        };
      },
    });

    expect(modelCalls).toHaveLength(1);
    expect(result.finalText).toBeUndefined();
    expect(result.stoppedReason).toBe("interrupted");
    expect(result.events.map((event) => event.kind)).toEqual([
      "model.turn",
      "tool.requested",
      "tool.sandbox_preflight",
      "tool.result",
      "loop.stopped",
    ]);
  });

  it("executes required grounding tools before letting the model answer", async () => {
    const modelInputs: unknown[] = [];
    const executedTools: unknown[] = [];
    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-required-sogou-weixin",
      sessionKey: "session-1",
      messages: [{ role: "user", content: "用搜索引擎搜狗去微信公众号搜索相关seedance2.0的教程" }],
      tools: [
        {
          name: "web_search",
          description: "Search the public web.",
          readOnly: true,
          metadata: { capability: "web.search", source: "built-in" },
        },
      ],
      requiredToolCalls: [
        {
          id: "required-web-search-sogou-weixin",
          name: "web_search",
          args: {
            query: "seedance2.0 教程",
            provider: "sogou-weixin",
            source_type: "weixin_article",
            reason: "用户明确要求使用搜狗检索微信公众号文章",
            max_results: 5,
          },
          readOnly: true,
          metadata: { requiredGrounding: true },
        },
      ],
      callModel: (request) => {
        modelInputs.push(request);
        expect(request.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: "assistant",
              toolCalls: [
                expect.objectContaining({
                  id: "required-web-search-sogou-weixin",
                  name: "web_search",
                }),
              ],
            }),
            expect.objectContaining({
              role: "tool",
              toolCallId: "required-web-search-sogou-weixin",
              content: expect.stringContaining("provider: sogou-weixin"),
            }),
          ]),
        );
        return {
          finalText: "我已经按你的要求用搜狗微信搜索了 seedance2.0 教程。",
        };
      },
      executeTool: ({ call }) => {
        executedTools.push(call);
        return {
          callId: call.id,
          toolName: call.name,
          ok: true,
          content:
            "provider: sogou-weixin\nsource_type: weixin_article\n1. Seedance2.0 实操教程 - https://mp.weixin.qq.com/s/example",
        };
      },
    });

    expect(executedTools).toEqual([
      expect.objectContaining({
        id: "required-web-search-sogou-weixin",
        name: "web_search",
        args: expect.objectContaining({
          provider: "sogou-weixin",
          source_type: "weixin_article",
        }),
      }),
    ]);
    expect(modelInputs).toHaveLength(1);
    expect(result.finalText).toBe("我已经按你的要求用搜狗微信搜索了 seedance2.0 教程。");
    expect(result.events.map((event) => event.kind)).toEqual([
      "tool.requested",
      "tool.sandbox_preflight",
      "tool.result",
      "model.turn",
      "model.final",
    ]);
  });

  it("feeds tool results back into the next model turn", async () => {
    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-1",
      sessionKey: "session-1",
      messages: [{ role: "user", content: "按上次风格继续" }],
      tools: [{ name: "session_search", description: "Search sessions", readOnly: true }],
      callModel: ({ messages }) => {
        const toolResult = messages.find((message) => message.role === "tool");
        if (toolResult !== undefined) {
          return { finalText: `找到参考：${toolResult.content}` };
        }
        return {
          assistantMessage: { role: "assistant", content: "我先查一下上次内容。" },
          toolCalls: [
            {
              id: "tool-1",
              name: "session_search",
              args: { query: "上次风格" },
              readOnly: true,
            },
          ],
        };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "上次是治愈童话风。",
      }),
    });

    expect(result.finalText).toBe("找到参考：上次是治愈童话风。");
    expect(result.events.map((event) => event.kind)).toEqual([
      "model.turn",
      "tool.requested",
      "tool.sandbox_preflight",
      "tool.result",
      "model.turn",
      "model.final",
    ]);
    expect(result.messages.at(-2)).toMatchObject({
      role: "tool",
      toolCallId: "tool-1",
      content: "上次是治愈童话风。",
    });
    expect(result.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "找到参考：上次是治愈童话风。",
    });
    expect(result.messages[1]).toMatchObject({
      role: "assistant",
      toolCalls: [
        {
          id: "tool-1",
          name: "session_search",
          args: { query: "上次风格" },
        },
      ],
    });
  });

  it("runs shared before-call hooks before executing model requested tools", async () => {
    let executedArgs: Readonly<Record<string, unknown>> | undefined;

    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-hook-before",
      sessionKey: "session-hook",
      messages: [{ role: "user", content: "读取这个链接" }],
      tools: [{ name: "web_extract", description: "Extract web page", readOnly: true }],
      toolHooks: [
        {
          name: "cap-web-extract",
          beforeCall: ({ call }) => ({
            status: "modify",
            reason: "cap extraction for model visibility",
            call: {
              ...call,
              args: { ...call.args, maxChars: 8_000 },
            },
          }),
        },
      ],
      callModel: ({ messages }) => {
        if (messages.some((message) => message.role === "tool")) {
          return { finalText: "读取完成。" };
        }
        return {
          toolCalls: [
            {
              id: "tool-hook-1",
              name: "web_extract",
              args: { url: "https://example.com/a" },
              readOnly: true,
            },
          ],
        };
      },
      executeTool: ({ call }) => {
        executedArgs = call.args;
        return {
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: "page body",
        };
      },
    });

    expect(result.finalText).toBe("读取完成。");
    expect(executedArgs).toMatchObject({ maxChars: 8_000 });
    expect(result.operatorTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "tool.before_call",
          metadata: expect.objectContaining({
            hookName: "cap-web-extract",
            status: "modify",
          }),
        }),
      ]),
    );
  });

  it("stops the model tool loop when a shared before-call hook denies execution", async () => {
    let executed = false;

    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-hook-deny",
      sessionKey: "session-hook",
      messages: [{ role: "user", content: "读取越界链接" }],
      tools: [{ name: "web_extract", description: "Extract web page", readOnly: true }],
      toolHooks: [
        {
          name: "authorized-domain-gate",
          beforeCall: () => ({ status: "deny", reason: "domain outside authorized scope" }),
        },
      ],
      callModel: () => ({
        toolCalls: [
          {
            id: "tool-hook-deny-1",
            name: "web_extract",
            args: { url: "https://blocked.example.com" },
            readOnly: true,
          },
        ],
      }),
      executeTool: ({ call }) => {
        executed = true;
        return {
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: "must not execute",
        };
      },
    });

    expect(executed).toBe(false);
    expect(result.stoppedReason).toBe("permission-denied");
    expect(result.operatorTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "tool.before_call",
          metadata: expect.objectContaining({
            hookName: "authorized-domain-gate",
            status: "deny",
            reason: "domain outside authorized scope",
          }),
        }),
      ]),
    );
  });

  it("emits a loop-detected event when repeated identical tool calls cross the threshold", async () => {
    let executedCount = 0;

    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-loop-detected",
      sessionKey: "session-loop-detected",
      messages: [{ role: "user", content: "不要重复卡住" }],
      tools: [{ name: "web_extract", description: "Extract web page", readOnly: true }],
      maxTurns: 5,
      toolHooks: [
        createConversationRuntimeToolLoopDetector({
          name: "repeat-web-extract",
          maxRepeats: 2,
        }),
      ],
      callModel: ({ messages }) => ({
        toolCalls: [
          {
            id: `tool-loop-${messages.length}`,
            name: "web_extract",
            args: { url: "https://example.com/repeat" },
            readOnly: true,
          },
        ],
      }),
      executeTool: ({ call }) => {
        executedCount += 1;
        return {
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: "same page body",
        };
      },
    });

    expect(executedCount).toBe(1);
    expect(result.stoppedReason).toBe("permission-denied");
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool.loop_detected",
          turnIndex: 2,
          call: expect.objectContaining({ name: "web_extract" }),
          hookName: "repeat-web-extract",
          reason: "tool-loop-threshold-exceeded",
        }),
      ]),
    );
  });

  it("runs persist-result hooks before tool evidence is stored", async () => {
    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-hook-persist",
      sessionKey: "session-hook",
      messages: [{ role: "user", content: "读取并审计" }],
      tools: [{ name: "web_extract", description: "Extract web page", readOnly: true }],
      toolHooks: [
        {
          name: "approval-ledger-audit",
          persistResult: ({ result }) => ({
            status: "modify",
            reason: "auto-approved result must be auditable",
            requiresAudit: true,
            result: {
              ...result,
              metadata: {
                ...result.metadata,
                auditRequiredBy: "approval-ledger-audit",
              },
            },
          }),
        },
      ],
      callModel: ({ messages }) => {
        if (messages.some((message) => message.role === "tool")) {
          return { finalText: "已记录。" };
        }
        return {
          toolCalls: [
            {
              id: "tool-hook-persist-1",
              name: "web_extract",
              args: { url: "https://example.com/audit" },
              readOnly: true,
            },
          ],
        };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "audited page body",
      }),
    });

    expect(result.finalText).toBe("已记录。");
    expect(result.memoryEvidenceRecords).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          auditRequiredBy: "approval-ledger-audit",
        }),
      }),
    ]);
    expect(result.operatorTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "tool.persist_result",
          metadata: expect.objectContaining({
            hookName: "approval-ledger-audit",
            requiresAudit: true,
            status: "modify",
          }),
        }),
      ]),
    );
  });

  it("persists full tool result evidence to the injected file-backed store", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "conversation-loop-evidence-"));
    const store = createFileConversationRuntimeToolEvidenceStore({
      rootPath,
      nowMs: () => 1_000,
    });
    const fullToolContent = [
      "status: success",
      "url: https://example.test/source",
      `body: ${"完整工具正文。".repeat(100)}`,
    ].join("\n");

    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-tool-evidence-file-store",
      sessionKey: "desktop:workbench",
      messages: [{ role: "user", content: "读取来源并总结" }],
      tools: [{ name: "web_extract", description: "Extract readable URL text", readOnly: true }],
      toolEvidenceStore: store,
      callModel: ({ messages }) => {
        const toolResult = messages.find((message) => message.toolCallId === "call-web-extract");
        if (toolResult !== undefined) {
          return { finalText: `已读取：${toolResult.content.slice(0, 24)}` };
        }
        return {
          toolCalls: [
            {
              id: "call-web-extract",
              name: "web_extract",
              args: { url: "https://example.test/source" },
              readOnly: true,
            },
          ],
        };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: fullToolContent,
        output: {
          status: "success",
          url: "https://example.test/source",
        },
        metadata: {
          turnRunId: "turn-run-tool-evidence-file-store",
          sourceUrl: "https://example.test/source",
        },
      }),
    });

    const listed = store.listToolResultEvidence({
      turnId: "turn-tool-evidence-file-store",
      sessionKey: "desktop:workbench",
      toolName: "web_extract",
    });
    const evidenceId = listed[0]?.evidenceId;

    expect(result.finalText).toContain("已读取");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      turnId: "turn-tool-evidence-file-store",
      turnRunId: "turn-run-tool-evidence-file-store",
      sessionKey: "desktop:workbench",
      toolCallId: "call-web-extract",
      toolName: "web_extract",
      contentSizeBytes: Buffer.byteLength(fullToolContent, "utf8"),
    });
    expect(evidenceId).toBeTypeOf("string");
    expect(store.readToolResultEvidence(evidenceId ?? "")?.evidence).toMatchObject({
      sourceKind: "tool-result",
      sourceRef: "tool://web_extract/call-web-extract",
      metadata: expect.objectContaining({
        toolName: "web_extract",
        sourceUrl: "https://example.test/source",
        toolCallArgs: { url: "https://example.test/source" },
      }),
    });
    expect(store.readToolResultEvidenceContent(evidenceId ?? "")?.content).toBe(fullToolContent);
  });

  it("enforces an aggregate model-visible tool result budget while preserving full evidence", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "conversation-loop-budget-evidence-"));
    const store = createFileConversationRuntimeToolEvidenceStore({ rootPath });
    const seenToolMessages: string[][] = [];
    const largeA = `alpha-${"A".repeat(240)}`;
    const largeB = `beta-${"B".repeat(240)}`;

    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-aggregate-budget",
      sessionKey: "desktop:workbench",
      messages: [{ role: "user", content: "同时读取两个大结果" }],
      tools: [
        {
          name: "web_extract",
          description: "Extract readable URL text",
          readOnly: true,
          isConcurrencySafe: true,
        },
      ],
      toolEvidenceStore: store,
      toolResultBudget: {
        maxTurnModelVisibleChars: 180,
        previewChars: 48,
      },
      callModel: ({ messages }) => {
        const toolMessages = messages.filter((message) => message.role === "tool");
        seenToolMessages.push(toolMessages.map((message) => message.content));
        if (toolMessages.length > 0) {
          return { finalText: toolMessages.map((message) => message.content).join("\n---\n") };
        }
        return {
          toolCalls: [
            {
              id: "call-budget-a",
              name: "web_extract",
              args: { url: "https://example.test/a" },
              readOnly: true,
            },
            {
              id: "call-budget-b",
              name: "web_extract",
              args: { url: "https://example.test/b" },
              readOnly: true,
            },
          ],
        };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: call.id.endsWith("a") ? largeA : largeB,
      }),
    });

    const finalToolMessages = seenToolMessages.at(-1) ?? [];

    expect(result.finalText).toContain("<persisted-output>");
    expect(finalToolMessages.join("\n")).toContain("aggregate-turn-budget-exceeded");
    expect(finalToolMessages.join("\n")).toContain("Full tool result preserved as evidence");
    expect(finalToolMessages.join("\n")).not.toContain("A".repeat(120));
    expect(finalToolMessages.join("\n")).not.toContain("B".repeat(120));
    expect(
      store.readToolResultEvidenceContent("tool-evidence-turn-aggregate-budget-call-budget-a")
        ?.content,
    ).toBe(largeA);
    expect(
      store.readToolResultEvidenceContent("tool-evidence-turn-aggregate-budget-call-budget-b")
        ?.content,
    ).toBe(largeB);
  });

  it("feeds only model-visible previews for large tool results while preserving full evidence", async () => {
    const fullBody = `完整网页正文开头。${"这是一段需要留在工具证据里的长正文，不能整段塞进模型上下文。".repeat(300)}完整网页正文尾部：这句话只能留在 evidence/output 里，不能出现在下一轮模型消息。`;
    const modelVisibleContent = [
      "status: success",
      "summary: Extracted preview from https://example.test/long",
      "url: https://example.test/long",
      "text_preview: 完整网页正文开头。",
      "body_ref: web-extract-body-https-example-test-long",
      "full_body_chars: 9000",
      "preview_chars: 1200",
      "body_truncated_for_model: true",
    ].join("\n");
    const modelToolMessages: string[] = [];

    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-large-tool-result-preview",
      sessionKey: "session-1",
      messages: [{ role: "user", content: "读取这个长网页并总结" }],
      tools: [{ name: "web_extract", description: "Extract readable URL text", readOnly: true }],
      callModel: ({ messages }) => {
        const toolResult = messages.find((message) => message.role === "tool");
        if (toolResult !== undefined) {
          modelToolMessages.push(toolResult.content);
          return { finalText: `可以总结：${toolResult.content}` };
        }
        return {
          toolCalls: [
            {
              id: "call-long-web-extract",
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
        content: `raw tool content leaked: ${fullBody}`,
        output: {
          status: "success",
          url: "https://example.test/long",
          text_preview: "完整网页正文开头。",
          body: fullBody,
          body_ref: "web-extract-body-https-example-test-long",
          full_body_ref: "web-extract-full-body-https-example-test-long",
          full_body_chars: fullBody.length,
          preview_chars: 1200,
          body_truncated_for_model: true,
        },
        metadata: {
          modelVisibleContent,
        },
      }),
    });

    expect(modelToolMessages).toEqual([modelVisibleContent]);
    expect(modelToolMessages[0]).toContain("body_ref: web-extract-body-https-example-test-long");
    expect(modelToolMessages[0]).not.toContain("完整网页正文尾部");
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          toolCallId: "call-long-web-extract",
          content: modelVisibleContent,
        }),
      ]),
    );
    expect(result.finalText).toContain("body_ref: web-extract-body-https-example-test-long");
    expect(result.finalText).not.toContain("完整网页正文尾部");
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool.result",
          result: expect.objectContaining({
            output: expect.objectContaining({
              body: expect.stringContaining("完整网页正文尾部"),
            }),
          }),
        }),
      ]),
    );
    expect(result.memoryEvidenceRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({
            toolCallId: "call-long-web-extract",
            preview: expect.stringContaining("raw tool content leaked"),
          }),
        }),
      ]),
    );
  });

  it("auto-reads saved web_extract full body refs before answering from a truncated preview", async () => {
    const bodyTail = "完整正文尾部：这里有六宫格设计方法的第六步。";
    const fullBody = `完整正文开头。${"六宫格方法正文。".repeat(700)}${bodyTail}`;
    const webExtractPreview = [
      "status: success",
      "summary: Extracted preview from https://example.test/long-method",
      "url: https://example.test/long-method",
      "text_preview: 完整正文开头。六宫格方法正文。",
      "body_ref: web-extract-body-https-example-test-long-method",
      "full_body_ref: web-extract-full-body-https-example-test-long-method",
      `full_body_chars: ${fullBody.length}`,
      "preview_chars: 8000",
      "body_truncated_for_model: true",
    ].join("\n");
    const executedTools: string[] = [];

    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-auto-read-truncated-web-extract",
      sessionKey: "session-1",
      messages: [{ role: "user", content: "这个帖子学到了什么？请给我完整方法。" }],
      tools: [
        { name: "web_extract", description: "Extract readable URL text", readOnly: true },
        {
          name: "web_extract_artifact_read",
          description: "Read saved full web body by full_body_ref",
          readOnly: true,
        },
      ],
      callModel: ({ messages }) => {
        const artifactRead = messages.find(
          (message) => message.toolCallId === "call-long-web-extract-full-body-read",
        );
        if (artifactRead !== undefined) {
          return { finalText: `学到了完整方法：${artifactRead.content}` };
        }
        const previewOnly = messages.find(
          (message) => message.toolCallId === "call-long-web-extract",
        );
        if (previewOnly !== undefined) {
          return {
            finalText:
              "局限：内容不完整——帖子正文在8000字符处截断，需要完整阅读才能获得全部可操作细节。",
          };
        }
        return {
          toolCalls: [
            {
              id: "call-long-web-extract",
              name: "web_extract",
              args: { url: "https://example.test/long-method" },
              readOnly: true,
            },
          ],
        };
      },
      executeTool: ({ call }) => {
        executedTools.push(call.name);
        if (call.name === "web_extract_artifact_read") {
          expect(call.args).toMatchObject({
            full_body_ref: "web-extract-full-body-https-example-test-long-method",
          });
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content: [
              "status: success",
              "summary: Read full body artifact.",
              `body: ${fullBody}`,
              `full_body_chars: ${fullBody.length}`,
              "body_truncated_for_model: false",
            ].join("\n"),
            output: {
              status: "success",
              body: fullBody,
              full_body_ref: "web-extract-full-body-https-example-test-long-method",
              full_body_chars: fullBody.length,
              body_truncated_for_model: false,
            },
          };
        }
        return {
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: `raw leaked body: ${fullBody}`,
          output: {
            status: "success",
            url: "https://example.test/long-method",
            text_preview: "完整正文开头。六宫格方法正文。",
            body: fullBody,
            body_ref: "web-extract-body-https-example-test-long-method",
            full_body_ref: "web-extract-full-body-https-example-test-long-method",
            full_body_chars: fullBody.length,
            preview_chars: 8000,
            body_truncated_for_model: true,
          },
          metadata: {
            modelVisibleContent: webExtractPreview,
          },
        };
      },
    });

    expect(executedTools).toEqual(["web_extract", "web_extract_artifact_read"]);
    expect(result.finalText).toContain(bodyTail);
    expect(result.finalText).not.toContain("8000字符处截断");
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          toolCallId: "call-long-web-extract-full-body-read",
          content: expect.stringContaining(bodyTail),
        }),
      ]),
    );
  });

  it("reuses an identical required grounding observation when the model requests the same tool again", async () => {
    const executedTools: unknown[] = [];
    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-dedupe-required-browser",
      sessionKey: "session-1",
      messages: [{ role: "user", content: "用浏览器打开 https://example.test/browser 看看" }],
      tools: [
        {
          name: "browser_navigate",
          description: "Navigate browser.",
          readOnly: false,
          metadata: { capability: "browser.navigate", source: "built-in" },
        },
      ],
      requiredToolCalls: [
        {
          id: "required-browser-navigate",
          name: "browser_navigate",
          args: {
            url: "https://example.test/browser",
            reason: "用户明确要求使用浏览器打开页面查看",
          },
          readOnly: true,
          metadata: { requiredGrounding: true },
        },
      ],
      callModel: ({ messages }) => {
        const repeatedResult = messages.find(
          (message) => message.role === "tool" && message.toolCallId === "call-browser-nav",
        );
        if (repeatedResult !== undefined) {
          return {
            finalText: `已基于浏览器观察回答：${repeatedResult.content}`,
          };
        }
        return {
          toolCalls: [
            {
              id: "call-browser-nav",
              name: "browser_navigate",
              args: { url: "https://example.test/browser" },
              readOnly: true,
            },
          ],
        };
      },
      executeTool: ({ call }) => {
        executedTools.push(call);
        return {
          callId: call.id,
          toolName: call.name,
          ok: true,
          content:
            "status: success\nsummary: Navigated to https://example.test/browser.\nurl: https://example.test/browser\ntitle: Example Browser Page",
        };
      },
    });

    expect(executedTools).toEqual([
      expect.objectContaining({
        id: "required-browser-navigate",
        name: "browser_navigate",
      }),
    ]);
    expect(result.finalText).toContain("Example Browser Page");
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          toolCallId: "call-browser-nav",
          content: expect.stringContaining("Example Browser Page"),
          metadata: expect.objectContaining({
            reusedFromToolCallId: "required-browser-navigate",
          }),
        }),
      ]),
    );
  });

  it("allows default read-only research tools without approval", async () => {
    const executedTools: string[] = [];
    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-default-research-tools",
      sessionKey: "session-1",
      messages: [{ role: "user", content: "去互联网查一下 Director Angel 默认工具策略" }],
      tools: [
        {
          name: "web_search",
          description: "Search the public web.",
          readOnly: true,
          metadata: { capability: "web.search", source: "built-in" },
        },
        {
          name: "mcp__exa_search__web_search",
          description: "Search through Exa MCP.",
          readOnly: true,
          metadata: {
            capability: "mcp.tool",
            source: "mcp",
            requiresApproval: false,
          },
        },
      ],
      callModel: ({ messages }) => {
        const firstToolResult = messages.find((message) => message.toolCallId === "call-web");
        const secondToolResult = messages.find((message) => message.toolCallId === "call-mcp");
        if (firstToolResult === undefined) {
          return {
            toolCalls: [
              {
                id: "call-web",
                name: "web_search",
                args: { query: "Director Angel 默认工具策略" },
              },
            ],
          };
        }
        if (secondToolResult === undefined) {
          return {
            toolCalls: [
              {
                id: "call-mcp",
                name: "mcp__exa_search__web_search",
                args: { query: "Director Angel default tools" },
              },
            ],
          };
        }
        return {
          finalText: `查到了：${firstToolResult.content}；${secondToolResult.content}`,
        };
      },
      executeTool: ({ call }) => {
        executedTools.push(call.name);
        return {
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: `${call.name} result`,
        };
      },
    });

    expect(executedTools).toEqual(["web_search", "mcp__exa_search__web_search"]);
    expect(result.stoppedReason).toBeUndefined();
    expect(result.finalText).toContain("web_search result");
    expect(result.finalText).toContain("mcp__exa_search__web_search result");
    expect(result.events.filter((event) => event.kind === "tool.permission")).toHaveLength(0);
  });

  it("does not execute tool calls that were not exposed for the current turn", async () => {
    const executedTools: string[] = [];
    let modelTurn = 0;
    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-tools-visible-boundary",
      sessionKey: "session-1",
      messages: [{ role: "user", content: "你学了什么，讲给我听" }],
      tools: [
        {
          name: "director.experience.candidates.list",
          description: "List pending experience candidates.",
          readOnly: true,
        },
      ],
      callModel: ({ messages }) => {
        modelTurn += 1;
        if (modelTurn === 1) {
          return {
            toolCalls: [
              {
                id: "call-hidden-learning",
                name: "director.learning.query",
                args: { query: "seedance2.0 最新教程" },
              },
            ],
          };
        }
        if (modelTurn === 2) {
          expect(messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                role: "tool",
                toolCallId: "call-hidden-learning",
                content: expect.stringContaining("not available"),
              }),
            ]),
          );
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
        const candidateResult = messages.find(
          (message) => message.toolCallId === "call-list-candidates",
        );
        return {
          finalText: `这次能讲的是这些候选：${candidateResult?.content ?? ""}`,
        };
      },
      executeTool: ({ call }) => {
        executedTools.push(call.name);
        return {
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: "1. Seedance 2.0 教程\n摘要：包含运镜和提示词参数。",
        };
      },
    });

    expect(executedTools).toEqual(["director.experience.candidates.list"]);
    expect(result.finalText).toContain("Seedance 2.0 教程");
    expect(result.events.map((event) => event.kind)).toEqual([
      "model.turn",
      "tool.requested",
      "tool.result",
      "model.turn",
      "tool.requested",
      "tool.sandbox_preflight",
      "tool.result",
      "model.turn",
      "model.final",
    ]);
    expect(result.events[2]).toMatchObject({
      kind: "tool.result",
      result: {
        callId: "call-hidden-learning",
        toolName: "director.learning.query",
        ok: false,
      },
    });
  });

  it("stops before executing approval-gated follow-up work", async () => {
    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-1",
      sessionKey: "session-1",
      messages: [{ role: "user", content: "发布这个 Skill" }],
      maxTurns: 2,
      callModel: () => ({
        toolCalls: [
          {
            id: "tool-approval",
            name: "skill_tool",
            args: { skill: "publish" },
            requiresApproval: true,
          },
        ],
      }),
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: false,
        content: "需要人工批准。",
        requiresApproval: true,
      }),
    });

    expect(result.stoppedReason).toBe("approval-required");
    expect(result.events.at(-1)).toEqual({
      kind: "loop.stopped",
      reason: "approval-required",
    });
  });

  it("summarizes empty search loops without exposing provider or tool internals", async () => {
    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-empty-search-human-fallback",
      sessionKey: "desktop:workbench",
      messages: [{ role: "user", content: "去互联网看看最近生成图片分镜图哪个模型最厉害" }],
      maxTurns: 1,
      tools: [{ name: "web_search", description: "Search the public web.", readOnly: true }],
      callModel: () => ({
        toolCalls: [
          {
            id: "empty-search",
            name: "web_search",
            args: { query: "生成图片 分镜图 模型 最新", provider: "duckduckgo" },
            readOnly: true,
          },
        ],
      }),
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content:
          "status: success\nprovider: duckduckgo\nresult_count: 0\nnext_actions: extract promising URLs with web_extract",
      }),
    });

    expect(result.stoppedReason).toBe("max-turns");
    expect(result.structuredFallbackReason).toBe("empty-tool-results");
    expect(result.finalText).toContain("没有拿到可靠结果");
    expect(result.finalText).not.toMatch(/duckduckgo|web_extract|next_actions|provider|tool/iu);
  });

  it("does not let a browser failure fallback override a successful non-browser tool result", async () => {
    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-moyin-readiness-browser-fallback",
      sessionKey: "desktop:workbench",
      messages: [{ role: "user", content: "检查 Moyin 项目是否可以执行" }],
      maxTurns: 1,
      tools: [
        {
          name: "director.moyin.project_readiness",
          description: "Read Moyin project readiness.",
          readOnly: true,
        },
        {
          name: "browser_navigate",
          description: "Navigate browser.",
          readOnly: true,
        },
      ],
      callModel: () => ({
        toolCalls: [
          {
            id: "read-moyin-readiness",
            name: "director.moyin.project_readiness",
            args: {},
            readOnly: true,
          },
          {
            id: "bad-browser-navigation",
            name: "browser_navigate",
            args: { url: "http://localhost:5173" },
            readOnly: true,
          },
        ],
      }),
      executeTool: ({ call }) => {
        if (call.name === "director.moyin.project_readiness") {
          return {
            callId: call.id,
            toolName: call.name,
            ok: true,
            content: "status: ready\nsummary: Moyin 项目 readiness 已通过。",
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
    });

    expect(result.stoppedReason).toBe("max-turns");
    expect(result.structuredFallbackReason).toBeUndefined();
    expect(result.finalText).toBeUndefined();
  });

  it("uses tool definition metadata to stop approval-gated tools before execution", async () => {
    let executed = false;
    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-permission",
      sessionKey: "session-1",
      messages: [{ role: "user", content: "启用浏览 Skill" }],
      tools: [
        {
          name: "director.skills.set_enabled",
          description: "Enable or disable an approved Skill.",
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
    expect(result.stoppedReason).toBe("approval-required");
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool.requested",
          call: expect.objectContaining({
            name: "director.skills.set_enabled",
            readOnly: false,
            requiresApproval: true,
            metadata: expect.objectContaining({
              capability: "skill.management",
              reviewGated: true,
            }),
          }),
        }),
        expect.objectContaining({
          kind: "tool.permission",
          decision: expect.objectContaining({
            status: "ask",
            reason: "tool definition requires approval",
          }),
        }),
      ]),
    );
    expect(result.events.some((event) => event.kind === "tool.result")).toBe(false);
  });

  it("keeps experience admission approval-gated even when the model omits requiresApproval", async () => {
    let executed = false;
    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-learning-policy",
      sessionKey: "session-1",
      messages: [{ role: "user", content: "把这些资料沉淀成经验" }],
      tools: [
        {
          name: "director.learning.query",
          description: "Create reviewable experience candidates.",
          readOnly: false,
          metadata: {
            capability: "learning",
            reviewGated: true,
          },
        },
      ],
      callModel: () => ({
        toolCalls: [
          {
            id: "call-learning-query",
            name: "director.learning.query",
            args: { query: "短剧镜头语言" },
          },
        ],
      }),
      executeTool: () => {
        executed = true;
        return {
          callId: "call-learning-query",
          toolName: "director.learning.query",
          ok: true,
          content: "should not execute",
        };
      },
    });

    expect(executed).toBe(false);
    expect(result.stoppedReason).toBe("approval-required");
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool.permission",
          decision: expect.objectContaining({
            status: "ask",
            metadata: expect.objectContaining({
              defaultToolPolicy: "approval-required",
            }),
          }),
        }),
      ]),
    );
  });

  it("lets an injected permission resolver allow trusted approval-gated tools", async () => {
    let executed = false;
    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-permission-allow",
      sessionKey: "session-1",
      messages: [{ role: "user", content: "启用浏览 Skill" }],
      tools: [
        {
          name: "director.skills.set_enabled",
          description: "Enable or disable an approved Skill.",
          readOnly: false,
          metadata: { reviewGated: true },
        },
      ],
      callModel: ({ messages }) => {
        if (messages.some((message) => message.role === "tool")) {
          return { finalText: "已开启。" };
        }
        return {
          toolCalls: [
            {
              id: "call-enable-skill",
              name: "director.skills.set_enabled",
              args: { skillId: "skill.browser", enabled: true },
            },
          ],
        };
      },
      authorizeToolCall: ({ defaultDecision }) => {
        expect(defaultDecision.status).toBe("ask");
        return { status: "allow", reason: "trusted desktop operator" };
      },
      preflightToolSandbox: () => ({
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-08T00:00:00.000Z",
        providerId: "conversation-runtime-test",
        reason: "trusted desktop sandbox granted workspace write",
      }),
      executeTool: ({ call }) => {
        executed = true;
        return {
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: "Skill 已开启。",
        };
      },
    });

    expect(executed).toBe(true);
    expect(result.finalText).toBe("已开启。");
    expect(result.events.map((event) => event.kind)).toEqual([
      "model.turn",
      "tool.requested",
      "tool.sandbox_preflight",
      "tool.result",
      "model.turn",
      "model.final",
    ]);
  });

  it("runs explicit concurrency-safe read-only tools in parallel while keeping mutating tools serial", async () => {
    const executionOrder: string[] = [];
    let activeExecutions = 0;
    let maxActiveExecutions = 0;

    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-tool-concurrency-boundary",
      sessionKey: "session-1",
      messages: [{ role: "user", content: "同时查两个来源，然后写入摘要" }],
      tools: [
        {
          name: "source_a.read",
          description: "Read source A.",
          readOnly: true,
          isConcurrencySafe: true,
        },
        {
          name: "source_b.read",
          description: "Read source B.",
          readOnly: true,
          isConcurrencySafe: true,
        },
        {
          name: "summary.write",
          description: "Write summary.",
          readOnly: false,
          isConcurrencySafe: true,
          metadata: { destructive: true },
        },
      ],
      callModel: ({ messages }) => {
        if (messages.filter((message) => message.role === "tool").length >= 3) {
          return { finalText: "完成。" };
        }
        return {
          toolCalls: [
            {
              id: "read-a",
              name: "source_a.read",
              args: { source: "a" },
            },
            {
              id: "read-b",
              name: "source_b.read",
              args: { source: "b" },
            },
            {
              id: "write-summary",
              name: "summary.write",
              args: { target: "summary.md" },
            },
          ],
        };
      },
      authorizeToolCall: ({ call, defaultDecision }) =>
        call.name === "summary.write"
          ? { status: "allow", reason: "trusted test writer" }
          : defaultDecision,
      preflightToolSandbox: ({ call }) => ({
        verdict: "allow",
        sandboxMode: call.name === "summary.write" ? "workspace-write" : "readonly",
        checkedAt: "2026-05-17T00:00:00.000Z",
        providerId: "conversation-runtime-test",
      }),
      executeTool: async ({ call }) => {
        executionOrder.push(`${call.id}:start`);
        activeExecutions += 1;
        maxActiveExecutions = Math.max(maxActiveExecutions, activeExecutions);
        await new Promise((resolve) => setTimeout(resolve, call.id === "read-a" ? 20 : 5));
        executionOrder.push(`${call.id}:end`);
        activeExecutions -= 1;
        return {
          callId: call.id,
          toolName: call.name,
          ok: true,
          content: `${call.name} ok`,
        };
      },
    });

    expect(result.finalText).toBe("完成。");
    expect(maxActiveExecutions).toBe(2);
    expect(executionOrder.indexOf("read-b:start")).toBeLessThan(
      executionOrder.indexOf("read-a:end"),
    );
    expect(executionOrder.indexOf("write-summary:start")).toBeGreaterThan(
      executionOrder.indexOf("read-a:end"),
    );
    expect(executionOrder.indexOf("write-summary:start")).toBeGreaterThan(
      executionOrder.indexOf("read-b:end"),
    );
    expect(
      result.messages
        .filter((message) => message.role === "tool")
        .map((message) => message.toolCallId),
    ).toEqual(["read-a", "read-b", "write-summary"]);
  });

  it("blocks approved mutating tools when Agent OS sandbox preflight is missing", async () => {
    let executed = false;
    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-agent-os-sandbox-preflight",
      sessionKey: "session-1",
      messages: [{ role: "user", content: "启用浏览 Skill" }],
      tools: [
        {
          name: "director.skills.set_enabled",
          description: "Enable or disable an approved Skill.",
          readOnly: false,
          metadata: { reviewGated: true, capability: "skill.management" },
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
      authorizeToolCall: () => ({ status: "allow", reason: "trusted desktop operator" }),
      executeTool: () => {
        executed = true;
        return {
          callId: "call-enable-skill",
          toolName: "director.skills.set_enabled",
          ok: true,
          content: "should not execute without sandbox preflight",
        };
      },
    });

    expect(executed).toBe(false);
    expect(result.stoppedReason).toBe("permission-denied");
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool.sandbox_preflight",
          preflight: expect.objectContaining({
            verdict: "deny",
            sandboxMode: "disabled",
            providerId: "conversation-runtime",
          }),
        }),
        expect.objectContaining({
          kind: "tool.permission",
          decision: expect.objectContaining({
            status: "deny",
            reason: "Agent OS sandbox preflight is required before executing mutating tools",
          }),
        }),
      ]),
    );
    expect(result.operatorTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "tool.sandbox_preflight",
          metadata: expect.objectContaining({
            status: "deny",
            sandboxMode: "disabled",
            toolName: "director.skills.set_enabled",
          }),
        }),
      ]),
    );
  });

  it("blocks approved mutating tools when injected sandbox preflight is malformed", async () => {
    let executed = false;
    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-agent-os-malformed-sandbox-preflight",
      sessionKey: "session-1",
      messages: [{ role: "user", content: "启用浏览 Skill" }],
      tools: [
        {
          name: "director.skills.set_enabled",
          description: "Enable or disable an approved Skill.",
          readOnly: false,
          metadata: { reviewGated: true, capability: "skill.management" },
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
      authorizeToolCall: () => ({ status: "allow", reason: "trusted desktop operator" }),
      preflightToolSandbox: () => ({ verdict: "allow" }) as never,
      executeTool: () => {
        executed = true;
        return {
          callId: "call-enable-skill",
          toolName: "director.skills.set_enabled",
          ok: true,
          content: "should not execute with malformed sandbox preflight",
        };
      },
    });

    expect(executed).toBe(false);
    expect(result.stoppedReason).toBe("permission-denied");
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool.sandbox_preflight",
          preflight: expect.objectContaining({
            verdict: "deny",
            sandboxMode: "disabled",
            reason: "Agent OS sandbox preflight returned an invalid result",
          }),
        }),
      ]),
    );
  });

  it("turns model-visible AgentTool delegation into a task-backed subagent run", async () => {
    const enqueuedDelegations: unknown[] = [];
    const executor = createAgentDelegateTaskBackedToolExecutor({
      parentEnvelope: {
        subagentId: "parent-agent",
        parentTurnId: "turn-agent-tool-delegate",
        profileId: "director",
        permissions: ["read", "verify"],
        tools: ["web_search", "director.knowledge.recall"],
        writableRoots: ["/workspace/project"],
        memoryLayers: ["L0", "L1"],
        maxTurns: 6,
      },
      profiles: [
        {
          profileId: "researcher",
          role: "research",
          instructions: "Investigate bounded source material.",
          permissions: ["read"],
          tools: ["web_search", "director.knowledge.recall"],
          writableRoots: [],
          memoryLayers: ["L0", "L1"],
          maxTurns: 4,
        },
      ],
      taskPlane: {
        enqueueDelegation: async (record) => {
          enqueuedDelegations.push(record);
          return {
            schemaVersion: "hotflow.contracts.v1",
            todos: { items: [] },
            delegation: [
              {
                id: record.id,
                workerId: record.workerId,
                instruction: record.instruction,
                status: record.status ?? "queued",
                createdAtMs: 1,
                updatedAtMs: 1,
                ...(record.contextSnapshot === undefined
                  ? {}
                  : { contextSnapshot: record.contextSnapshot }),
                ...(record.specialization === undefined
                  ? {}
                  : { specialization: record.specialization }),
                ...(record.targetAgent === undefined ? {} : { targetAgent: record.targetAgent }),
                ...(record.verificationRequest === undefined
                  ? {}
                  : { verificationRequest: record.verificationRequest }),
              },
            ],
            verification: [],
            proposalQueue: [],
            proposalOutbox: [],
            notifications: [],
            lifecycle: [],
          };
        },
      },
      nowMs: () => 1,
      nowIso: () => "2026-05-09T00:00:00.000Z",
    });

    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-agent-tool-delegate",
      sessionKey: "session-1",
      messages: [{ role: "user", content: "把资料检索并行委托给研究子代理" }],
      tools: [
        {
          name: "agent.delegate",
          description: "Delegate bounded work to a task-backed subagent.",
          readOnly: false,
          metadata: {
            agentTool: true,
            capability: "agent.subagent.delegate",
            reviewGated: true,
          },
        },
      ],
      callModel: ({ messages }) => {
        const toolResult = messages.find((message) => message.toolCallId === "delegate-1");
        if (toolResult !== undefined) {
          return {
            finalText: `已创建子代理任务：${toolResult.content}`,
          };
        }
        return {
          toolCalls: [
            {
              id: "delegate-1",
              name: "agent.delegate",
              args: {
                profileId: "researcher",
                task: "Search for source material on Seedance 2.0 workflows.",
                expectedOutput: "A concise source-backed research note.",
                allowedTools: ["web_search"],
                allowedPermissions: ["read"],
                memoryLayers: ["L0"],
                maxTurns: 2,
                verification: {
                  verifierId: "operator-review",
                  requirement: "Confirm that the research note cites observed sources.",
                },
              },
            },
          ],
        };
      },
      authorizeToolCall: ({ call, defaultDecision }) => {
        expect(call.name).toBe("agent.delegate");
        expect(defaultDecision.status).toBe("ask");
        return { status: "allow", reason: "trusted operator approved bounded delegation" };
      },
      preflightToolSandbox: ({ call }) => {
        expect(call.name).toBe("agent.delegate");
        return {
          verdict: "allow",
          sandboxMode: "readonly",
          checkedAt: "2026-05-09T00:00:00.000Z",
          providerId: "conversation-runtime.agent-tool",
          reason: "Delegation only enqueues task-plane state and starts no runner.",
        };
      },
      executeTool: executor,
    });

    expect(enqueuedDelegations).toEqual([
      expect.objectContaining({
        id: "subagent_delegate-1",
        workerId: "researcher",
        instruction: "Search for source material on Seedance 2.0 workflows.",
        fromAgent: "agent.delegate",
        specialization: "explore",
        targetAgent: "researcher",
        contextSnapshot: expect.stringContaining("parentTurnId=turn-agent-tool-delegate"),
        verificationRequest: expect.objectContaining({
          verifierId: "operator-review",
          requirement: "Confirm that the research note cites observed sources.",
        }),
      }),
    ]);
    expect(result.finalText).toContain("subagent_delegate-1");
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool.result",
          result: expect.objectContaining({
            ok: true,
            toolName: "agent.delegate",
            metadata: expect.objectContaining({
              agentTool: true,
              subagentRun: expect.objectContaining({
                subagentId: "subagent_delegate-1",
                parentTurnId: "turn-agent-tool-delegate",
                status: "queued",
                role: "explore",
              }),
            }),
          }),
        }),
      ]),
    );
  });

  it("accepts model-visible spawn_subagent as an async task-plane subagent run", async () => {
    const enqueuedDelegations: unknown[] = [];
    const executor = createSpawnSubagentTaskBackedToolExecutor({
      parentEnvelope: {
        subagentId: "parent-agent",
        parentTurnId: "turn-spawn-subagent",
        profileId: "director",
        permissions: ["read", "plan"],
        tools: ["web_search", "director.knowledge.recall"],
        writableRoots: ["/workspace/project"],
        memoryLayers: ["L0", "L1"],
        maxTurns: 8,
      },
      profiles: [
        {
          profileId: "researcher",
          role: "research",
          instructions: "Run background research.",
          permissions: ["read"],
          tools: ["web_search", "director.knowledge.recall"],
          writableRoots: [],
          memoryLayers: ["L0"],
          maxTurns: 4,
        },
      ],
      taskPlane: {
        enqueueDelegation: async (record) => {
          enqueuedDelegations.push(record);
          return {
            schemaVersion: "hotflow.contracts.v1",
            todos: { items: [] },
            delegation: [
              {
                id: record.id,
                workerId: record.workerId,
                instruction: record.instruction,
                status: record.status ?? "queued",
                createdAtMs: 10,
                updatedAtMs: 10,
                ...(record.contextSnapshot === undefined
                  ? {}
                  : { contextSnapshot: record.contextSnapshot }),
                ...(record.specialization === undefined
                  ? {}
                  : { specialization: record.specialization }),
                ...(record.targetAgent === undefined ? {} : { targetAgent: record.targetAgent }),
              },
            ],
            verification: [],
            proposalQueue: [],
            proposalOutbox: [],
            notifications: [],
            lifecycle: [],
          };
        },
      },
      requester: {
        requesterSessionKey: "desktop:workbench",
        requesterOrigin: "desktop",
        deliveryTarget: "desktop:workbench",
      },
      nowMs: () => 10,
      nowIso: () => "2026-05-11T10:00:00.000Z",
    });

    const result = await executor({
      turnId: "turn-spawn-subagent",
      sessionKey: "desktop:workbench",
      call: {
        id: "spawn-background-research",
        name: "spawn_subagent",
        args: {
          profileId: "researcher",
          task: "Research OpenClaw background task announcements.",
          expectedOutput: "A source-backed note.",
          allowedTools: ["web_search"],
          allowedPermissions: ["read"],
          memoryLayers: ["L0"],
          parallelGroup: "research",
        },
      },
    });

    expect(result).toMatchObject({
      callId: "spawn-background-research",
      toolName: "spawn_subagent",
      ok: true,
      metadata: expect.objectContaining({
        asyncSubagent: true,
        requesterSessionKey: "desktop:workbench",
        requesterOrigin: "desktop",
        childSessionKey: "subagent:subagent_spawn-background-research",
        subagentRun: expect.objectContaining({
          subagentId: "subagent_spawn-background-research",
          status: "queued",
        }),
      }),
    });
    expect(result.content).toContain("status: accepted");
    expect(result.content).toContain(
      "child_session_key: subagent:subagent_spawn-background-research",
    );
    expect(enqueuedDelegations).toEqual([
      expect.objectContaining({
        id: "subagent_spawn-background-research",
        workerId: "researcher",
        fromAgent: "spawn_subagent",
        contextSnapshot: expect.stringMatching(
          /requesterSessionKey=desktop:workbench.*topLevelRequester=true/u,
        ),
      }),
    ]);
  });

  it("keeps nested spawn_subagent completion routed to the direct parent agent instead of the user", async () => {
    const enqueuedDelegations: unknown[] = [];
    const executor = createSpawnSubagentTaskBackedToolExecutor({
      parentEnvelope: {
        subagentId: "parent-subagent-beta",
        parentTurnId: "turn-parent-subagent-beta",
        profileId: "researcher",
        permissions: ["read", "plan"],
        tools: ["web_search", "director.knowledge.recall"],
        writableRoots: [],
        memoryLayers: ["L0", "L1"],
        maxTurns: 4,
      },
      profiles: [
        {
          profileId: "verifier",
          role: "verify",
          instructions: "Verify nested background evidence.",
          permissions: ["read"],
          tools: ["web_search"],
          writableRoots: [],
          memoryLayers: ["L0"],
          maxTurns: 2,
        },
      ],
      taskPlane: {
        enqueueDelegation: async (record) => {
          enqueuedDelegations.push(record);
          return {
            schemaVersion: "hotflow.contracts.v1",
            todos: { items: [] },
            delegation: [
              {
                id: record.id,
                workerId: record.workerId,
                instruction: record.instruction,
                status: record.status ?? "queued",
                createdAtMs: 20,
                updatedAtMs: 20,
                ...(record.contextSnapshot === undefined
                  ? {}
                  : { contextSnapshot: record.contextSnapshot }),
                ...(record.specialization === undefined
                  ? {}
                  : { specialization: record.specialization }),
                ...(record.targetAgent === undefined ? {} : { targetAgent: record.targetAgent }),
              },
            ],
            verification: [],
            proposalQueue: [],
            proposalOutbox: [],
            notifications: [],
            lifecycle: [],
          };
        },
      },
      requester: {
        requesterSessionKey: "subagent:parent-subagent-beta",
        requesterOrigin: "subagent",
        topLevelRequester: false,
        parentSubagentId: "parent-subagent-beta",
      },
      nowMs: () => 20,
      nowIso: () => "2026-05-11T10:05:00.000Z",
    });

    const result = await executor({
      turnId: "turn-nested-spawn-subagent",
      sessionKey: "subagent:parent-subagent-beta",
      call: {
        id: "spawn-nested-verifier",
        name: "spawn_subagent",
        args: {
          profileId: "verifier",
          task: "Verify the parent subagent evidence.",
          expectedOutput: "A parent-visible verification note.",
          parallelGroup: "nested-verification",
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      metadata: expect.objectContaining({
        asyncSubagent: true,
        requesterSessionKey: "subagent:parent-subagent-beta",
        requesterOrigin: "subagent",
        topLevelRequester: false,
        parentSubagentId: "parent-subagent-beta",
      }),
    });
    expect(result.content).toContain("status: accepted");
    expect(result.content).toContain("next_actions: Continue the parent agent now");
    expect(result.content).not.toContain("task notification");
    expect(enqueuedDelegations).toEqual([
      expect.objectContaining({
        id: "subagent_spawn-nested-verifier",
        workerId: "verifier",
        contextSnapshot: expect.stringMatching(
          /requesterSessionKey=subagent:parent-subagent-beta.*requesterOrigin=subagent.*parentSubagentId=parent-subagent-beta.*topLevelRequester=false/u,
        ),
      }),
    ]);
  });

  it("runs run_subagent synchronously and returns only the child final summary to the parent", async () => {
    const childModelInputs: unknown[] = [];
    const childToolExecutions: unknown[] = [];
    const executor = createRunSubagentSynchronousToolExecutor({
      parentEnvelope: {
        subagentId: "parent-agent",
        parentTurnId: "turn-run-subagent",
        profileId: "director",
        permissions: ["read", "plan"],
        tools: ["web_search", "web_extract", "director.knowledge.recall"],
        writableRoots: [],
        memoryLayers: ["L0", "L1"],
        maxTurns: 6,
      },
      profiles: [
        {
          profileId: "researcher",
          role: "research",
          instructions: "Run short isolated research and return only the final answer.",
          permissions: ["read"],
          tools: ["web_search", "web_extract"],
          writableRoots: [],
          memoryLayers: ["L0"],
          maxTurns: 3,
        },
      ],
      callSubagentModel: (input) => {
        childModelInputs.push(input);
        const toolResult = input.messages.find((message) => message.toolCallId === "child-search");
        if (toolResult !== undefined) {
          return {
            finalText: "短研究结论：OpenClaw 用结构化 announce 回流后台子任务。",
          };
        }
        return {
          toolCalls: [
            {
              id: "child-search",
              name: "web_search",
              args: { query: "OpenClaw subagent announce" },
            },
          ],
        };
      },
      executeSubagentTool: (input) => {
        childToolExecutions.push(input);
        return {
          callId: input.call.id,
          toolName: input.call.name,
          ok: true,
          content: "source: OpenClaw announce registry",
        };
      },
      nowMs: () => 30,
      nowIso: () => "2026-05-12T00:00:00.000Z",
    });

    const result = await executor({
      turnId: "turn-run-subagent",
      sessionKey: "desktop:workbench",
      call: {
        id: "run-short-research",
        name: "run_subagent",
        args: {
          profileId: "researcher",
          task: "短查 OpenClaw 后台 announce 机制。",
          expectedOutput: "一句可给父 agent 使用的结论。",
          allowedTools: ["web_search"],
          allowedPermissions: ["read"],
          memoryLayers: ["L0"],
          maxTurns: 2,
        },
      },
    });

    expect(result).toMatchObject({
      callId: "run-short-research",
      toolName: "run_subagent",
      ok: true,
      content: "短研究结论：OpenClaw 用结构化 announce 回流后台子任务。",
      output: expect.objectContaining({
        subagentRun: expect.objectContaining({
          subagentId: "subagent_run-short-research",
          status: "completed",
          parentVisibleResult: expect.objectContaining({
            status: "completed",
            summary: "短研究结论：OpenClaw 用结构化 announce 回流后台子任务。",
          }),
        }),
      }),
      metadata: expect.objectContaining({
        agentTool: true,
        syncSubagent: true,
        subagentId: "subagent_run-short-research",
        profileId: "researcher",
      }),
    });
    expect(childModelInputs).toHaveLength(2);
    expect(childModelInputs[0]).toMatchObject({
      turnId: "turn-run-subagent:subagent:subagent_run-short-research",
      sessionKey: "subagent:subagent_run-short-research",
      tools: [expect.objectContaining({ name: "web_search" })],
    });
    expect(childModelInputs[0]).not.toMatchObject({
      tools: expect.arrayContaining([expect.objectContaining({ name: "web_extract" })]),
    });
    expect(childToolExecutions).toEqual([
      expect.objectContaining({
        call: expect.objectContaining({ name: "web_search" }),
        sessionKey: "subagent:subagent_run-short-research",
      }),
    ]);
    expect(result.output).not.toMatchObject({
      childMessages: expect.anything(),
    });
  });

  it("blocks run_subagent when the requested child tools exceed the parent tool set", async () => {
    const executor = createRunSubagentSynchronousToolExecutor({
      parentEnvelope: {
        subagentId: "parent-agent",
        parentTurnId: "turn-run-subagent-tool-block",
        profileId: "director",
        permissions: ["read"],
        tools: ["web_search"],
        writableRoots: [],
        memoryLayers: ["L0"],
        maxTurns: 3,
      },
      parentTools: [
        {
          name: "web_search",
          description: "Search.",
          readOnly: true,
        },
      ],
      profiles: [
        {
          profileId: "researcher",
          role: "research",
          instructions: "Short research.",
          permissions: ["read"],
          tools: ["web_search", "web_extract"],
          writableRoots: [],
          memoryLayers: ["L0"],
          maxTurns: 2,
        },
      ],
      callSubagentModel: () => {
        throw new Error("blocked run_subagent must not start child model");
      },
      executeSubagentTool: () => {
        throw new Error("blocked run_subagent must not execute child tools");
      },
    });

    const result = await executor({
      turnId: "turn-run-subagent-tool-block",
      sessionKey: "desktop:workbench",
      call: {
        id: "run-tool-block",
        name: "run_subagent",
        args: {
          profileId: "researcher",
          task: "Read a web page.",
          expectedOutput: "A summary.",
          allowedTools: ["web_extract"],
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      toolName: "run_subagent",
      error: "run-subagent-scope-escalation",
      metadata: expect.objectContaining({
        agentTool: true,
        blocked: true,
      }),
    });
    expect(result.content).toContain("Subagent scope escalation blocked");
  });

  it("fails run_subagent closed when the child ends without a final summary", async () => {
    const executor = createRunSubagentSynchronousToolExecutor({
      parentEnvelope: {
        subagentId: "parent-agent",
        parentTurnId: "turn-run-subagent-no-final",
        profileId: "director",
        permissions: ["read"],
        tools: ["web_search"],
        writableRoots: [],
        memoryLayers: ["L0"],
        maxTurns: 3,
      },
      profiles: [
        {
          profileId: "researcher",
          role: "research",
          instructions: "Short research.",
          permissions: ["read"],
          tools: ["web_search"],
          writableRoots: [],
          memoryLayers: ["L0"],
          maxTurns: 1,
        },
      ],
      callSubagentModel: () => ({ assistantMessage: { role: "assistant", content: "" } }),
      executeSubagentTool: () => {
        throw new Error("no-final run_subagent must not execute child tools");
      },
    });

    const result = await executor({
      turnId: "turn-run-subagent-no-final",
      sessionKey: "desktop:workbench",
      call: {
        id: "run-no-final",
        name: "run_subagent",
        args: {
          profileId: "researcher",
          task: "Return nothing.",
          expectedOutput: "A summary.",
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      toolName: "run_subagent",
      error: "run-subagent-no-final-text",
      metadata: expect.objectContaining({
        blocked: true,
      }),
    });
    expect(result.content).toContain("ended without a final summary");
  });

  it("blocks AgentTool delegation that tries to escalate beyond the selected profile", async () => {
    const executor = createAgentDelegateTaskBackedToolExecutor({
      parentEnvelope: {
        subagentId: "parent-agent",
        parentTurnId: "turn-agent-tool-escalation",
        profileId: "director",
        permissions: ["read"],
        tools: ["web_search"],
        writableRoots: [],
        memoryLayers: ["L0"],
        maxTurns: 3,
      },
      profiles: [
        {
          profileId: "researcher",
          role: "research",
          instructions: "Read-only research.",
          permissions: ["read"],
          tools: ["web_search"],
          writableRoots: [],
          memoryLayers: ["L0"],
          maxTurns: 2,
        },
      ],
      taskPlane: {
        enqueueDelegation: async () => {
          throw new Error("escalating delegation must not enqueue");
        },
      },
      nowMs: () => 1,
      nowIso: () => "2026-05-09T00:00:00.000Z",
    });

    const result = await executor({
      turnId: "turn-agent-tool-escalation",
      sessionKey: "session-1",
      call: {
        id: "delegate-escalate",
        name: "agent.delegate",
        args: {
          profileId: "researcher",
          task: "Rewrite project files.",
          expectedOutput: "A patch.",
          allowedTools: ["web_search", "shell.exec"],
          allowedPermissions: ["read", "write"],
          writableRoots: ["/workspace/project"],
          memoryLayers: ["L0", "L3"],
        },
      },
    });

    expect(result).toMatchObject({
      callId: "delegate-escalate",
      toolName: "agent.delegate",
      ok: false,
      error: "agent-delegate-scope-escalation",
      metadata: expect.objectContaining({
        agentTool: true,
        blocked: true,
      }),
    });
    expect(result.content).toContain("Subagent scope escalation blocked");
  });

  it("blocks AgentTool delegation that targets a worker outside the selected profile", async () => {
    const executor = createAgentDelegateTaskBackedToolExecutor({
      parentEnvelope: {
        subagentId: "parent-agent",
        parentTurnId: "turn-agent-tool-worker-route",
        profileId: "director",
        permissions: ["read"],
        tools: ["web_search"],
        writableRoots: [],
        memoryLayers: ["L0"],
        maxTurns: 3,
      },
      profiles: [
        {
          profileId: "researcher",
          role: "research",
          instructions: "Read-only research.",
          permissions: ["read"],
          tools: ["web_search"],
          writableRoots: [],
          memoryLayers: ["L0"],
          maxTurns: 2,
        },
      ],
      taskPlane: {
        enqueueDelegation: async () => {
          throw new Error("mismatched worker delegation must not enqueue");
        },
      },
      nowMs: () => 1,
      nowIso: () => "2026-05-09T00:00:00.000Z",
    });

    const result = await executor({
      turnId: "turn-agent-tool-worker-route",
      sessionKey: "session-1",
      call: {
        id: "delegate-worker-route",
        name: "agent.delegate",
        args: {
          profileId: "researcher",
          workerId: "desktop-operator",
          task: "Search for one source.",
          expectedOutput: "One cited note.",
        },
      },
    });

    expect(result).toMatchObject({
      callId: "delegate-worker-route",
      toolName: "agent.delegate",
      ok: false,
      error: "agent-delegate-worker-route-blocked",
      metadata: expect.objectContaining({
        agentTool: true,
        blocked: true,
      }),
    });
    expect(result.content).toContain("cannot target worker");
  });

  it("blocks AgentTool delegation when the requested write set overlaps an active child run", async () => {
    const enqueuedDelegations: unknown[] = [];
    const executor = createAgentDelegateTaskBackedToolExecutor({
      parentEnvelope: {
        subagentId: "parent-agent",
        parentTurnId: "turn-agent-tool-write-conflict",
        profileId: "director",
        permissions: ["read", "write"],
        tools: ["file.patch"],
        writableRoots: ["/workspace/project"],
        memoryLayers: ["L0"],
        maxTurns: 3,
      },
      profiles: [
        {
          profileId: "implementer",
          role: "implementer",
          instructions: "Implement a bounded patch.",
          permissions: ["read", "write"],
          tools: ["file.patch"],
          writableRoots: ["/workspace/project"],
          memoryLayers: ["L0"],
          maxTurns: 2,
        },
      ],
      taskPlane: {
        status: async () => ({
          schemaVersion: "hotflow.contracts.v1",
          todos: { items: [] },
          delegation: [
            {
              id: "subagent_existing",
              workerId: "implementer",
              instruction: "Existing patch.",
              status: "queued",
              createdAtMs: 1,
              updatedAtMs: 1,
              contextSnapshot:
                "parentTurnId=turn-agent-tool-write-conflict; isolatedContext=true; parallelGroup=implementation; writeSet=src/App.tsx",
              specialization: "general",
              targetAgent: "implementer",
            },
          ],
          verification: [],
          proposalQueue: [],
          proposalOutbox: [],
          notifications: [],
          lifecycle: [],
        }),
        enqueueDelegation: async (record) => {
          enqueuedDelegations.push(record);
          return {
            schemaVersion: "hotflow.contracts.v1",
            todos: { items: [] },
            delegation: [
              {
                id: "subagent_existing",
                workerId: "implementer",
                instruction: "Existing patch.",
                status: "queued",
                createdAtMs: 1,
                updatedAtMs: 1,
                contextSnapshot:
                  "parentTurnId=turn-agent-tool-write-conflict; isolatedContext=true; parallelGroup=implementation; writeSet=src/App.tsx",
                specialization: "general",
                targetAgent: "implementer",
              },
              {
                id: record.id,
                workerId: record.workerId,
                instruction: record.instruction,
                status: record.status ?? "queued",
                createdAtMs: 2,
                updatedAtMs: 2,
                ...(record.contextSnapshot === undefined
                  ? {}
                  : { contextSnapshot: record.contextSnapshot }),
                ...(record.specialization === undefined
                  ? {}
                  : { specialization: record.specialization }),
                ...(record.targetAgent === undefined ? {} : { targetAgent: record.targetAgent }),
              },
            ],
            verification: [],
            proposalQueue: [],
            proposalOutbox: [],
            notifications: [],
            lifecycle: [],
          };
        },
      },
      nowMs: () => 2,
      nowIso: () => "2026-05-09T00:00:00.000Z",
    });

    const result = await executor({
      turnId: "turn-agent-tool-write-conflict",
      sessionKey: "session-1",
      call: {
        id: "delegate-overlap",
        name: "agent.delegate",
        args: {
          profileId: "implementer",
          task: "Patch the same app file.",
          expectedOutput: "A focused patch.",
          allowedTools: ["file.patch"],
          allowedPermissions: ["read", "write"],
          writableRoots: ["/workspace/project"],
          writeSet: ["src/App.tsx"],
          parallelGroup: "implementation",
        },
      },
    });

    expect(enqueuedDelegations).toHaveLength(0);
    expect(result).toMatchObject({
      callId: "delegate-overlap",
      toolName: "agent.delegate",
      ok: false,
      error: "agent-delegate-write-set-conflict",
      metadata: expect.objectContaining({
        agentTool: true,
        blocked: true,
      }),
    });
    expect(result.content).toContain("write-set-overlap");
    expect(result.content).toContain("subagent_existing");
  });

  it("projects AgentTool scheduling batches for independent and ordered write sets", async () => {
    const executor = createAgentDelegateTaskBackedToolExecutor({
      parentEnvelope: {
        subagentId: "parent-agent",
        parentTurnId: "turn-agent-tool-scheduler",
        profileId: "director",
        permissions: ["read", "write"],
        tools: ["file.patch"],
        writableRoots: ["/workspace/project"],
        memoryLayers: ["L0"],
        maxTurns: 3,
      },
      profiles: [
        {
          profileId: "implementer",
          role: "implementer",
          instructions: "Implement a bounded patch.",
          permissions: ["read", "write"],
          tools: ["file.patch"],
          writableRoots: ["/workspace/project"],
          memoryLayers: ["L0"],
          maxTurns: 2,
        },
      ],
      taskPlane: {
        enqueueDelegation: async (record) => ({
          schemaVersion: "hotflow.contracts.v1",
          todos: { items: [] },
          delegation: [
            {
              id: "subagent_alpha_running",
              workerId: "implementer",
              instruction: "Patch alpha first.",
              status: "running",
              createdAtMs: 1,
              updatedAtMs: 1,
              contextSnapshot:
                "parentTurnId=turn-agent-tool-scheduler; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
              specialization: "general",
              targetAgent: "implementer",
            },
            {
              id: "subagent_beta",
              workerId: "implementer",
              instruction: "Patch beta independently.",
              status: "queued",
              createdAtMs: 2,
              updatedAtMs: 2,
              contextSnapshot:
                "parentTurnId=turn-agent-tool-scheduler; isolatedContext=true; parallelGroup=implementation; writeSet=src/beta.ts",
              specialization: "general",
              targetAgent: "implementer",
            },
            {
              id: record.id,
              workerId: record.workerId,
              instruction: record.instruction,
              status: record.status ?? "queued",
              createdAtMs: 3,
              updatedAtMs: 3,
              ...(record.contextSnapshot === undefined
                ? {}
                : { contextSnapshot: record.contextSnapshot }),
              ...(record.specialization === undefined
                ? {}
                : { specialization: record.specialization }),
              ...(record.targetAgent === undefined ? {} : { targetAgent: record.targetAgent }),
            },
          ],
          verification: [],
          proposalQueue: [],
          proposalOutbox: [],
          notifications: [],
          lifecycle: [],
        }),
      },
      nowMs: () => 3,
      nowIso: () => "2026-05-09T00:00:00.000Z",
    });

    const result = await executor({
      turnId: "turn-agent-tool-scheduler",
      sessionKey: "session-1",
      call: {
        id: "delegate-beta-followup",
        name: "agent.delegate",
        args: {
          profileId: "implementer",
          task: "Patch beta after the queued beta child.",
          expectedOutput: "A focused patch.",
          allowedTools: ["file.patch"],
          allowedPermissions: ["read", "write"],
          writableRoots: ["/workspace/project"],
          writeSet: ["src/beta.ts"],
          parallelGroup: "implementation",
        },
      },
    });

    expect(result).toMatchObject({
      callId: "delegate-beta-followup",
      toolName: "agent.delegate",
      ok: true,
      metadata: expect.objectContaining({
        subagentRun: expect.objectContaining({
          subagentId: "subagent_delegate-beta-followup",
          scheduling: {
            parallelGroup: "implementation",
            writeSet: ["src/beta.ts"],
            canRunInParallel: false,
            conflictsWith: ["subagent_beta"],
            conflictReason: "write-set-overlap: src/beta.ts",
            parallelBatch: 1,
            scheduleOrder: 2,
            readyToStart: false,
            blockedBy: ["subagent_beta"],
            writeSetSource: "explicit",
          },
        }),
      }),
    });
  });

  it("blocks AgentTool delegation when inferred writable roots overlap an active child run", async () => {
    const enqueuedDelegations: unknown[] = [];
    const executor = createAgentDelegateTaskBackedToolExecutor({
      parentEnvelope: {
        subagentId: "parent-agent",
        parentTurnId: "turn-agent-tool-inferred-write-conflict",
        profileId: "director",
        permissions: ["read", "write"],
        tools: ["file.patch"],
        writableRoots: ["/workspace/project/src/App.tsx"],
        memoryLayers: ["L0"],
        maxTurns: 3,
      },
      profiles: [
        {
          profileId: "implementer",
          role: "implementer",
          instructions: "Implement a bounded patch.",
          permissions: ["read", "write"],
          tools: ["file.patch"],
          writableRoots: ["/workspace/project/src/App.tsx"],
          memoryLayers: ["L0"],
          maxTurns: 2,
        },
      ],
      taskPlane: {
        status: async () => ({
          schemaVersion: "hotflow.contracts.v1",
          todos: { items: [] },
          delegation: [
            {
              id: "subagent_existing",
              workerId: "implementer",
              instruction: "Existing patch.",
              status: "running",
              createdAtMs: 1,
              updatedAtMs: 1,
              contextSnapshot:
                "parentTurnId=turn-agent-tool-inferred-write-conflict; isolatedContext=true; parallelGroup=implementation; writeSet=/workspace/project/src/App.tsx",
              specialization: "general",
              targetAgent: "implementer",
            },
          ],
          verification: [],
          proposalQueue: [],
          proposalOutbox: [],
          notifications: [],
          lifecycle: [],
        }),
        enqueueDelegation: async (record) => {
          enqueuedDelegations.push(record);
          throw new Error("inferred write-set conflict must not enqueue");
        },
      },
      nowMs: () => 2,
      nowIso: () => "2026-05-09T00:00:00.000Z",
    });

    const result = await executor({
      turnId: "turn-agent-tool-inferred-write-conflict",
      sessionKey: "session-1",
      call: {
        id: "delegate-inferred-overlap",
        name: "agent.delegate",
        args: {
          profileId: "implementer",
          task: "Patch the same app file without explicit writeSet.",
          expectedOutput: "A focused patch.",
          allowedTools: ["file.patch"],
          allowedPermissions: ["read", "write"],
          writableRoots: ["/workspace/project/src/App.tsx"],
          parallelGroup: "implementation",
        },
      },
    });

    expect(enqueuedDelegations).toHaveLength(0);
    expect(result).toMatchObject({
      callId: "delegate-inferred-overlap",
      toolName: "agent.delegate",
      ok: false,
      error: "agent-delegate-write-set-conflict",
      metadata: expect.objectContaining({
        agentTool: true,
        blocked: true,
      }),
    });
    expect(result.content).toContain("write-set-overlap");
    expect(result.content).toContain("/workspace/project/src/App.tsx");
    expect(result.content).toContain("subagent_existing");
  });
});
