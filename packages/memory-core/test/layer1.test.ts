import { describe, expect, it } from "vitest";

import { Layer1MemoryStore } from "../src/layer1.js";
import { MemoryCoreManager } from "../src/manager.js";

describe("Layer1MemoryStore", () => {
  it("prefers lexical matches within a scope", () => {
    const store = new Layer1MemoryStore();

    store.upsert({
      id: "match",
      content: "project roadmap and launch checklist",
      scope: { agentId: "agent-1", namespace: "product" },
      timestamp: 1_000,
    });

    store.upsert({
      id: "other",
      content: "database migration notes",
      scope: { agentId: "agent-1", namespace: "product" },
      timestamp: 2_000,
    });

    const hits = store.retrieve({
      scope: { agentId: "agent-1", namespace: "product" },
      query: "roadmap launch",
      limit: 2,
    });

    expect(hits[0]?.entry.id).toBe("match");
    expect(hits[0]?.score ?? 0).toBeGreaterThan(hits[1]?.score ?? 0);
  });

  it("routes direct unsafe writes to layer0 quarantine without storing the raw API key", () => {
    const manager = new MemoryCoreManager();
    const secret = "sk-test-1234567890abcdef1234567890abcdef";

    const entry = manager.writeLayer1({
      id: "unsafe-direct",
      content: `记住我的 API key 是 ${secret}`,
      scope: { agentId: "agent-1", namespace: "user-memory" },
    });

    expect(entry.layer).toBe("layer0");
    expect(entry.content).not.toContain(secret);
    expect(entry.content).toContain("[redacted:api-key]");
    expect(entry.scope.namespace).toBe("memory:quarantine");
    expect(entry.tags).toEqual(
      expect.arrayContaining(["memory:direct-layer1", "memory:quarantine", "memory:safety"]),
    );
    expect(entry.metadata.memoryAdmission).toMatchObject({
      retention: "quarantine",
      reason: "direct-layer1:safety:quarantine",
      safety: {
        safe: false,
        findings: expect.arrayContaining([expect.objectContaining({ type: "api-key" })]),
      },
    });
    expect(manager.layer1.get("unsafe-direct")).toBeUndefined();
  });

  it("routes direct casual writes to layer0 discarded audit instead of user memory", () => {
    const manager = new MemoryCoreManager();

    const entry = manager.writeLayer1({
      id: "casual-direct",
      content: "谢谢",
      scope: { agentId: "agent-1", namespace: "user-memory" },
    });

    expect(entry.layer).toBe("layer0");
    expect(entry.scope.namespace).toBe("memory:discarded");
    expect(entry.tags).toEqual(
      expect.arrayContaining(["memory:direct-layer1", "memory:noise", "memory:chitchat"]),
    );
    expect(entry.metadata.memoryAdmission).toMatchObject({
      category: "chitchat",
      retention: "none",
      reason: "direct-layer1:low-value-chatter",
    });
    expect(manager.layer1.get("casual-direct")).toBeUndefined();
  });

  it("keeps direct internal layer1 writes even when they are not user-memory shaped", () => {
    const manager = new MemoryCoreManager();

    const entry = manager.writeLayer1({
      id: "system-episodic-direct",
      content: "episodic-note",
      scope: { sessionId: "session-1" },
    });

    expect(entry.layer).toBe("layer1");
    expect(entry.scope.namespace).toBeUndefined();
    expect(entry.tags).toEqual(expect.arrayContaining(["memory:direct-layer1", "memory:system"]));
    expect(entry.metadata.memoryAdmission).toMatchObject({
      category: "system",
      retention: "user",
      reason: "direct-layer1:system",
    });
    expect(manager.layer0.get("system-episodic-direct")).toBeUndefined();
  });
});
