import { describe, expect, it } from "vitest";

import { normalizeProviderStreamEvent } from "../src/stream-normalization.js";

describe("normalizeProviderStreamEvent", () => {
  it("maps provider events to unified stream events", () => {
    const started = normalizeProviderStreamEvent("fake", {
      type: "response.started",
      responseId: "r1",
    });
    const delta = normalizeProviderStreamEvent("fake", {
      type: "text.delta",
      responseId: "r1",
      text: "abc",
    });
    const completed = normalizeProviderStreamEvent("fake", {
      type: "response.completed",
      responseId: "r1",
      finishReason: "stop",
    });

    expect(started.type).toBe("response_started");
    expect(delta).toMatchObject({ type: "text_delta", text: "abc", providerId: "fake" });
    expect(completed).toMatchObject({ type: "response_completed", finishReason: "stop" });
  });
});
