import { describe, expect, it } from "vitest";

import { projectConversationRuntimeClientReply } from "../src/client-projection.js";

describe("Conversation runtime client projection", () => {
  it("projects the same runtime result to desktop and wechat without status stealing the main reply", () => {
    const result = {
      turnId: "turn-client-projection-1",
      sessionKey: "desktop:workbench",
      replySource: "model",
      finalText: [
        "这些内容有用，最值得收录的是双智能体迭代提示词方法。",
        "Native Bridge 暂无回包，继续等待工具或模型结果",
        "runId: run-hidden",
      ].join("\n"),
      events: [],
      runtimeEventsV1: [
        {
          schemaVersion: "conversation-runtime.event.v1",
          eventId: "evt-tool-started",
          kind: "tool.started",
          turnId: "turn-client-projection-1",
          sessionKey: "desktop:workbench",
          occurredAtMs: 1,
          payload: { toolName: "web_extract", toolCallId: "call-1" },
        },
        {
          schemaVersion: "conversation-runtime.event.v1",
          eventId: "evt-tool-completed",
          kind: "tool.completed",
          turnId: "turn-client-projection-1",
          sessionKey: "desktop:workbench",
          occurredAtMs: 2,
          payload: { toolName: "web_extract", toolCallId: "call-1" },
        },
      ],
      operatorTrace: { items: [] },
    } as const;
    const evidenceDisclosure = {
      sources: [
        {
          url: "https://x.com/qc777qc/status/2057327056774648108",
          fullBodyChars: 6076,
          mediaCount: 3,
          readStatus: "read",
          mediaUnderstandingAuthorized: false,
        },
      ],
    };

    const desktop = projectConversationRuntimeClientReply({
      surface: "desktop.rich",
      result,
      evidenceDisclosure,
    });
    const wechat = projectConversationRuntimeClientReply({
      surface: "wechat.text",
      result,
      evidenceDisclosure,
    });

    expect(desktop.mainText).toBe(wechat.mainText);
    expect(desktop.mainText).toContain("双智能体迭代提示词方法");
    expect(desktop.mainText).not.toContain("Native Bridge");
    expect(desktop.mainText).not.toContain("runId");
    expect(desktop.evidenceLines).toEqual([
      "证据来源：https://x.com/qc777qc/status/2057327056774648108 · 全文 6076 字符 · 已读取",
      "媒体未理解：文本已读，媒体 3 个尚未授权理解；未授权前不能把图片、视频或音频内容当结论。",
    ]);
    expect(wechat.text).toContain(desktop.mainText);
    expect(wechat.text).toContain(desktop.evidenceLines[0]);
    expect(wechat.text).toContain(desktop.evidenceLines[1]);
    expect(wechat.text).not.toContain("正在执行");
    expect(desktop.runSteps.map((step) => step.label)).toEqual([
      "正在执行 Web Extract",
      "已执行 Web Extract",
    ]);
  });
});
