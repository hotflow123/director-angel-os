import { describe, expect, it } from "vitest";

import {
  type ConversationRuntimeInput,
  type ConversationRuntimeResult,
  createConversationRuntimeEvent,
  mapRuntimeSurfaceToTurnSurface,
} from "../src/index.js";

describe("conversation runtime contracts", () => {
  it("maps host-api to the existing channels-core api surface", () => {
    expect(mapRuntimeSurfaceToTurnSurface("host-api")).toBe("api");
    expect(mapRuntimeSurfaceToTurnSurface("weixin")).toBe("weixin");
  });

  it("creates typed runtime events", () => {
    const event = createConversationRuntimeEvent({
      id: "event-1",
      kind: "runtime.final",
      turnId: "turn-1",
      sessionKey: "session-1",
      occurredAtMs: 1,
      payload: {
        text: "完成",
        responsePolicy: "result-first",
        audience: "user",
        replySource: "model",
      },
    });

    expect(event.kind).toBe("runtime.final");
    expect(event.payload.text).toBe("完成");
    expect(event.payload.replySource).toBe("model");
  });

  it("keeps input and result contracts channel neutral", () => {
    const input: ConversationRuntimeInput = {
      surface: "desktop",
      channel: "director-desktop",
      messageId: "message-1",
      sessionKey: "session-1",
      text: "你现在能做什么？",
      sender: { id: "user-1", displayName: "Operator" },
      deliveryCapabilities: {
        modes: ["markdown", "stream"],
        supportsStreaming: true,
        supportsMarkdown: true,
      },
    };

    const result: ConversationRuntimeResult = {
      turnId: "turn-1",
      sessionKey: input.sessionKey,
      replySource: "model",
      events: [],
      operatorTrace: { items: [] },
    };

    expect(input.deliveryCapabilities?.supportsStreaming).toBe(true);
    expect(result.sessionKey).toBe("session-1");
  });
});
