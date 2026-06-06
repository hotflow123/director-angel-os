import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type ConversationRuntimeInput,
  type ConversationRuntimeTurnDecision,
  createConversationRuntimeUnifiedEvent,
  createFileConversationRuntimeContextCheckpointStore,
  runConversationRuntimeTurn,
  saveConversationRuntimeContextPartialSummary,
} from "../src/index.js";

const roots: string[] = [];

function input(overrides: Partial<ConversationRuntimeInput> = {}): ConversationRuntimeInput {
  return {
    surface: "desktop",
    channel: "desktop",
    messageId: "message-1",
    sessionKey: "desktop:workbench",
    text: "继续处理当前任务",
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
    userText: "继续当前任务。",
    memoryDecision: { action: "transient", reason: "普通对话默认只留在会话上下文。" },
    shouldInvokeRecall: false,
    shouldCreateRun: false,
    shouldAttachToActiveSession: false,
    ...overrides,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("conversation runtime context checkpoints", () => {
  it("persists a partial compaction summary so the next turn can read it", () => {
    const root = mkdtempSync(join(tmpdir(), "conversation-context-checkpoint-"));
    roots.push(root);
    const path = join(root, "context-checkpoints.json");
    const store = createFileConversationRuntimeContextCheckpointStore({ path });

    const saved = saveConversationRuntimeContextPartialSummary({
      store,
      sessionKey: "desktop:workbench",
      turnId: "turn-long-1",
      summary: "用户正在比较 Hermes/OpenClaw，并要求桌面、微信、未来客户端统一工具调度。",
      reason: "compaction-provider-timeout",
      sourceEventIds: ["turn-long-1:000004:tool.completed"],
      observedAtMs: 1_000,
    });
    const reloaded = createFileConversationRuntimeContextCheckpointStore({ path });

    expect(saved).toMatchObject({
      status: "partial_saved",
      sessionKey: "desktop:workbench",
      turnId: "turn-long-1",
      reason: "compaction-provider-timeout",
      sourceEventIds: ["turn-long-1:000004:tool.completed"],
    });
    expect(reloaded.readLatestPartialSummary("desktop:workbench")).toMatchObject({
      checkpointId: saved.checkpointId,
      summary: "用户正在比较 Hermes/OpenClaw，并要求桌面、微信、未来客户端统一工具调度。",
    });
  });

  it("emits explicit context compaction events instead of hiding degraded memory", () => {
    const partial = createConversationRuntimeUnifiedEvent({
      kind: "context.compaction.partial_saved",
      turnId: "turn-long-2",
      conversationId: "desktop:workbench",
      sequence: 8,
      startedAtMs: 1_000,
      occurredAtMs: 1_500,
      payload: {
        checkpointId: "context-checkpoint-1",
        summaryPreview: "保留了部分上下文摘要。",
      },
    });
    const failed = createConversationRuntimeUnifiedEvent({
      kind: "context.compaction.failed",
      turnId: "turn-long-2",
      conversationId: "desktop:workbench",
      sequence: 9,
      startedAtMs: 1_000,
      occurredAtMs: 1_700,
      payload: {
        checkpointId: "context-checkpoint-1",
        reason: "provider-timeout",
        partialSummaryAvailable: true,
      },
    });

    expect(partial).toMatchObject({
      kind: "context.compaction.partial_saved",
      eventId: "turn-long-2:000008:context.compaction.partial_saved",
      elapsedMs: 500,
    });
    expect(failed).toMatchObject({
      kind: "context.compaction.failed",
      eventId: "turn-long-2:000009:context.compaction.failed",
      payload: {
        partialSummaryAvailable: true,
      },
    });
  });

  it("saves partial summary and emits lifecycle events when compaction fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "conversation-context-checkpoint-runtime-"));
    roots.push(root);
    const store = createFileConversationRuntimeContextCheckpointStore({
      path: join(root, "context-checkpoints.json"),
    });

    const result = await runConversationRuntimeTurn(input(), {
      nowMs: () => 2_000,
      turnIdFactory: () => "turn-context-compaction-failed",
      contextCheckpointStore: store,
      memoryLifecycle: {
        onPreCompress: () => ({
          status: "failed",
          partialSummary: "用户要求桌面、微信和未来客户端共享同一套运行核心。",
          reason: "compaction-provider-timeout",
          sourceEventIds: ["turn-context-compaction-failed:000003:model.final"],
        }),
      },
      orchestrate: () => turn(),
      callModel: () => ({ finalText: "已继续。" }),
      executeTool: () => {
        throw new Error("tool should not run");
      },
    });

    expect(store.readLatestPartialSummary("desktop:workbench")).toMatchObject({
      summary: "用户要求桌面、微信和未来客户端共享同一套运行核心。",
      reason: "compaction-provider-timeout",
    });
    expect(result.runtimeEventsV1?.map((event) => event.kind)).toContain(
      "context.compaction.partial_saved",
    );
    expect(result.runtimeEventsV1).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "context.compaction.started" }),
        expect.objectContaining({
          kind: "context.compaction.failed",
          payload: expect.objectContaining({ partialSummaryAvailable: true }),
        }),
      ]),
    );
  });

  it("injects latest partial summary into the next model turn as incomplete context", async () => {
    const root = mkdtempSync(join(tmpdir(), "conversation-context-checkpoint-inject-"));
    roots.push(root);
    const store = createFileConversationRuntimeContextCheckpointStore({
      path: join(root, "context-checkpoints.json"),
    });
    saveConversationRuntimeContextPartialSummary({
      store,
      sessionKey: "desktop:workbench",
      turnId: "turn-before-compaction",
      summary: "用户已经确认：统一调度、统一审批、统一工具账本，不要只修桌面 UI。",
      reason: "previous-compaction-failed",
      observedAtMs: 1_000,
    });
    let systemPrompt = "";

    await runConversationRuntimeTurn(input({ text: "继续" }), {
      nowMs: () => 2_000,
      turnIdFactory: () => "turn-context-compaction-resume",
      contextCheckpointStore: store,
      orchestrate: () => turn(),
      callModel: ({ messages }) => {
        systemPrompt = messages.find((message) => message.role === "system")?.content ?? "";
        return { finalText: "继续。" };
      },
      executeTool: () => {
        throw new Error("tool should not run");
      },
    });

    expect(systemPrompt).toContain("上下文压缩恢复摘要（不完整）");
    expect(systemPrompt).toContain("统一调度、统一审批、统一工具账本");
    expect(systemPrompt).toContain("不能把它当作完整长期记忆");
  });
});
