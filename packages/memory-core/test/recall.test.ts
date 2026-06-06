import { describe, expect, it } from "vitest";

import { MemoryCoreManager } from "../src/manager.js";

describe("memory recall helpers", () => {
  it("applies score filtering for recall-focused retrieval", () => {
    const manager = new MemoryCoreManager();

    manager.writeLayer0({
      id: "high-match",
      content: "roadmap launch milestones",
      scope: { sessionId: "recall-session" },
      timestamp: 1_000,
    });
    manager.writeLayer1({
      id: "low-match",
      content: "unrelated infrastructure note",
      scope: { sessionId: "recall-session" },
      timestamp: 2_000,
    });

    const recalls = manager.recall({
      scope: { sessionId: "recall-session" },
      query: "roadmap launch",
      limit: 5,
      minScore: 0.5,
    });

    expect(recalls).toHaveLength(1);
    expect(recalls[0]?.entry.id).toBe("high-match");
  });

  it("supports layer-limited recall calls", () => {
    const manager = new MemoryCoreManager();

    manager.writeLayer0({
      id: "l0",
      content: "session scratchpad",
      scope: { threadId: "thread-7" },
      timestamp: Date.now(),
    });
    manager.writeLayer1({
      id: "l1",
      content: "记住：persistent summary",
      scope: { threadId: "thread-7" },
      timestamp: Date.now(),
    });

    const recalls = manager.recall({
      scope: { threadId: "thread-7" },
      layers: ["layer1"],
      limit: 5,
    });

    expect(recalls).toHaveLength(1);
    expect(recalls[0]?.entry.layer).toBe("layer1");
  });

  it("does not recall discarded or quarantined memory unless that namespace is explicitly requested", () => {
    const manager = new MemoryCoreManager();
    const secret = "sk-test-1234567890abcdef1234567890abcdef";

    manager.writeLayer1({
      id: "discarded",
      content: "谢谢",
      scope: { agentId: "angel", namespace: "user-memory" },
      timestamp: 1_000,
    });
    manager.writeLayer1({
      id: "quarantined",
      content: `记住我的 API key 是 ${secret}`,
      scope: { agentId: "angel", namespace: "user-memory" },
      timestamp: 2_000,
    });

    expect(
      manager.recall({
        scope: { agentId: "angel" },
        query: "谢谢 api key",
        limit: 5,
      }),
    ).toEqual([]);

    const quarantine = manager.recall({
      scope: { agentId: "angel", namespace: "memory:quarantine" },
      query: "api key",
      limit: 5,
    });

    expect(quarantine).toHaveLength(1);
    expect(quarantine[0]?.entry.id).toBe("quarantined");
  });
});
