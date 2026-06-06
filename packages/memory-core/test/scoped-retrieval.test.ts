import { describe, expect, it } from "vitest";

import { MemoryCoreManager } from "../src/manager.js";

describe("retrieveScopedMemory", () => {
  it("merges layer0/layer1 results and applies limit", () => {
    const manager = new MemoryCoreManager();

    manager.writeLayer0({
      id: "l0-hit",
      content: "quick tactical task list",
      scope: { agentId: "agent-1", sessionId: "session-1" },
      timestamp: Date.now(),
    });
    manager.writeLayer1({
      id: "l1-hit",
      content: "long term strategy and goals",
      scope: { agentId: "agent-1", sessionId: "session-1" },
      timestamp: Date.now() - 2_000,
    });

    const hits = manager.retrieve({
      scope: { agentId: "agent-1", sessionId: "session-1" },
      query: "task strategy",
      limit: 1,
    });

    expect(hits).toHaveLength(1);
  });

  it("supports layer-scoped retrieval", () => {
    const manager = new MemoryCoreManager();

    manager.writeLayer0({
      id: "only-layer0",
      content: "session cache value",
      scope: { sessionId: "s-only" },
    });
    manager.writeLayer1({
      id: "only-layer1",
      content: "persisted summary value",
      scope: { sessionId: "s-only" },
    });

    const layer0Hits = manager.retrieve({
      scope: { sessionId: "s-only" },
      layers: ["layer0"],
      limit: 5,
    });

    expect(layer0Hits).toHaveLength(1);
    expect(layer0Hits[0]?.entry.layer).toBe("layer0");
  });
});
