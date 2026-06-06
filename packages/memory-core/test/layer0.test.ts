import { describe, expect, it } from "vitest";

import { Layer0MemoryStore } from "../src/layer0.js";
import { MemoryCoreManager } from "../src/manager.js";

describe("Layer0MemoryStore", () => {
  it("isolates entries by scope", () => {
    const store = new Layer0MemoryStore();

    store.upsert({
      id: "a",
      content: "alpha note",
      scope: { agentId: "agent-1", sessionId: "session-a" },
      timestamp: 100,
    });
    store.upsert({
      id: "b",
      content: "beta note",
      scope: { agentId: "agent-1", sessionId: "session-b" },
      timestamp: 200,
    });

    const hits = store.retrieve({
      scope: { agentId: "agent-1", sessionId: "session-a" },
      limit: 10,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]?.entry.id).toBe("a");
  });

  it("sorts by lexical+recency and favors recent entries when query is empty", () => {
    const store = new Layer0MemoryStore();

    store.upsert({
      id: "older",
      content: "remember this detail",
      scope: { sessionId: "s1" },
      timestamp: Date.now() - 120_000,
    });
    store.upsert({
      id: "newer",
      content: "recent state update",
      scope: { sessionId: "s1" },
      timestamp: Date.now(),
    });

    const hits = store.retrieve({
      scope: { sessionId: "s1" },
      limit: 2,
    });

    expect(hits.map((item) => item.entry.id)).toEqual(["newer", "older"]);
  });

  it("adds minimal admission metadata for direct working writes", () => {
    const manager = new MemoryCoreManager();

    const entry = manager.writeLayer0({
      id: "working",
      content: "需要继续生成短剧分镜",
      scope: { sessionId: "s1", namespace: "assistant-output" },
    });

    expect(entry.tags).toContain("memory:working");
    expect(entry.metadata.memoryAdmission).toMatchObject({
      category: "working",
      retention: "working",
      reason: "direct-layer0:working",
    });
  });

  it("marks direct system and casual layer0 writes distinctly", () => {
    const manager = new MemoryCoreManager();

    const system = manager.writeLayer0({
      id: "system",
      content: "system guardrail update",
      scope: { sessionId: "s1", namespace: "system" },
    });
    const casual = manager.writeLayer0({
      id: "casual",
      content: "哈哈",
      scope: { sessionId: "s1", namespace: "user-input" },
    });

    expect(system.tags).toContain("memory:system");
    expect(system.metadata.memoryAdmission).toMatchObject({
      category: "system",
      reason: "direct-layer0:system",
    });
    expect(casual.tags).toContain("memory:casual");
    expect(casual.metadata.memoryAdmission).toMatchObject({
      category: "casual",
      reason: "direct-layer0:casual",
    });
  });

  it("keeps internal working-memory writes distinct from user chatter", () => {
    const manager = new MemoryCoreManager();

    const entry = manager.writeLayer0({
      id: "internal-working",
      content: "Older planning note with repeated workspace details.",
      scope: { sessionId: "s1", namespace: "conversation" },
    });

    expect(entry.tags).toContain("memory:working");
    expect(entry.tags).not.toContain("memory:casual");
    expect(entry.metadata.memoryAdmission).toMatchObject({
      category: "working",
      reason: "direct-layer0:working",
    });
  });
});
