import { describe, expect, it } from "vitest";

import { FakeModelProvider } from "../src/adapters/fake-provider.js";

describe("FakeModelProvider", () => {
  it("returns deterministic generate result", async () => {
    const provider = new FakeModelProvider({ cannedText: "hello-world" });
    const result = await provider.generate({
      model: "fake-model",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(result.text).toBe("hello-world");
    expect(result.finishReason).toBe("stop");
  });

  it("emits a minimal stream lifecycle", async () => {
    const provider = new FakeModelProvider({ cannedText: "stream-text" });
    const events = [];
    for await (const event of provider.stream({
      model: "fake-model",
      messages: [{ role: "user", content: "ping" }],
    })) {
      events.push(event.type);
    }

    expect(events).toEqual(["response.started", "text.delta", "response.completed"]);
  });
});
