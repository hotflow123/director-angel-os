import { describe, expect, it } from "vitest";

import { MemoryCoreManager } from "../src/manager.js";
import {
  WORKING_MEMORY_RECALL_BLOCK_ID,
  WORKING_MEMORY_RECALL_FAILURE_REASON,
  recallWorkingMemory,
} from "../src/working-memory.js";

describe("working memory recall block", () => {
  it("returns a structured recall block from manager recall", () => {
    const manager = new MemoryCoreManager();
    manager.writeLayer0({
      id: "l0-note",
      content: "roadmap launch checklist",
      scope: { sessionId: "wm-session" },
      timestamp: 1_000,
    });
    manager.writeLayer1({
      id: "l1-note",
      content: "retrospective notes",
      scope: { sessionId: "wm-session" },
      timestamp: 2_000,
    });

    const block = manager.recallWorkingMemory({
      blockId: "working-memory",
      scope: { sessionId: "wm-session" },
      query: "roadmap launch",
      minScore: 0.4,
      limit: 5,
    });

    expect(block.blockId).toBe("working-memory");
    expect(block.source).toBe("working-memory");
    expect(block.scope).toEqual({ sessionId: "wm-session" });
    expect(block.items).toHaveLength(1);
    expect(block.items[0]?.id).toBe("l0-note");
    expect(block.items[0]?.layer).toBe("layer0");
    expect(block.items[0]?.metadata).toMatchObject({
      matchMode: "lexical",
      source: "working-memory",
      query: "roadmap launch",
    });
    expect(block.degraded).toBeUndefined();
  });

  it("degrades to an empty recall block when retrieval throws", () => {
    const block = recallWorkingMemory(
      {
        layer0: {
          retrieve() {
            throw new Error("memory backend offline");
          },
        },
        layer1: {
          retrieve() {
            return [];
          },
        },
      },
      {
        scope: { sessionId: "degrade-session" },
        query: "  latest status  ",
      },
    );

    expect(block.items).toHaveLength(0);
    expect(block.query).toBe("latest status");
    expect(block.degraded?.reason).toBe("working-memory-recall-failed");
    expect(block.degraded?.message).toBe("memory backend offline");
  });

  it("trims query input and exposes trimmed query on success", () => {
    const manager = new MemoryCoreManager();
    manager.writeLayer0({
      id: "trim-note",
      content: "trim test",
      scope: { sessionId: "trim-session" },
      timestamp: 1_000,
    });

    const block = manager.recallWorkingMemory({
      scope: { sessionId: "trim-session" },
      query: "  trim test  ",
      limit: 1,
      minScore: 0,
    });

    expect(block.query).toBe("trim test");
    expect(block.blockId).toBe(WORKING_MEMORY_RECALL_BLOCK_ID);
    expect(block.items).toHaveLength(1);
    expect(block.degraded).toBeUndefined();
  });

  it("exposes shared degrade reason constant when recall fails", () => {
    const block = recallWorkingMemory(
      {
        layer0: {
          retrieve() {
            throw new Error("timeout");
          },
        },
        layer1: {
          retrieve() {
            return [];
          },
        },
      },
      {
        scope: { sessionId: "degrade-session" },
        query: "legacy query",
      },
    );

    expect(block.degraded?.reason).toBe(WORKING_MEMORY_RECALL_FAILURE_REASON);
    expect(block.degraded?.message).toBe("timeout");
    expect(block.query).toBe("legacy query");
  });
});
