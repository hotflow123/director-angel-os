import { describe, expect, it } from "vitest";

import {
  type ConversationRuntimeQueuedInput,
  ConversationRuntimeSessionQueue,
  isConversationRuntimeSlashQueuedInput,
} from "../src/index.js";

function queued(
  id: string,
  overrides: Partial<ConversationRuntimeQueuedInput> = {},
): ConversationRuntimeQueuedInput {
  return {
    id,
    sessionKey: "session-1",
    value: id,
    mode: "prompt",
    priority: "next",
    origin: "user",
    createdAtMs: 1,
    ...overrides,
  };
}

describe("ConversationRuntimeSessionQueue", () => {
  it("dequeues by priority and FIFO order within the same priority", () => {
    const queue = new ConversationRuntimeSessionQueue();
    queue.enqueue(queued("later", { priority: "later", createdAtMs: 1 }));
    queue.enqueue(queued("next-2", { priority: "next", createdAtMs: 3 }));
    queue.enqueue(queued("now", { priority: "now", createdAtMs: 4 }));
    queue.enqueue(queued("next-1", { priority: "next", createdAtMs: 2 }));

    expect(queue.dequeue()?.id).toBe("now");
    expect(queue.dequeue()?.id).toBe("next-1");
    expect(queue.dequeue()?.id).toBe("next-2");
    expect(queue.dequeue()?.id).toBe("later");
  });

  it("keeps sessions isolated", () => {
    const queue = new ConversationRuntimeSessionQueue();
    queue.enqueue(queued("session-1-now", { priority: "now", sessionKey: "session-1" }));
    queue.enqueue(queued("session-2-now", { priority: "now", sessionKey: "session-2" }));

    expect(queue.dequeue({ sessionKey: "session-2" })?.id).toBe("session-2-now");
    expect(queue.dequeue({ sessionKey: "session-1" })?.id).toBe("session-1-now");
  });

  it("can exclude slash commands when draining ordinary prompt attachments", () => {
    const queue = new ConversationRuntimeSessionQueue();
    queue.enqueue(queued("slash", { value: "/制作 生成短剧", priority: "now" }));
    queue.enqueue(queued("prompt", { value: "补充一句", priority: "next" }));

    expect(isConversationRuntimeSlashQueuedInput(queued("slash", { value: " /help" }))).toBe(true);
    expect(queue.dequeue({ excludeSlashCommands: true })?.id).toBe("prompt");
    expect(queue.dequeue()?.id).toBe("slash");
  });

  it("filters meta items unless explicitly included", () => {
    const queue = new ConversationRuntimeSessionQueue();
    queue.enqueue(queued("meta", { isMeta: true, priority: "now" }));
    queue.enqueue(queued("user", { priority: "next" }));

    expect(queue.dequeue()?.id).toBe("user");
    expect(queue.dequeue({ includeMeta: true })?.id).toBe("meta");
  });

  it("shows queue snapshots chronologically even though execution uses priority", () => {
    const queue = new ConversationRuntimeSessionQueue();
    queue.enqueue(queued("first-later", { priority: "later", createdAtMs: 1 }));
    queue.enqueue(queued("second-now", { priority: "now", createdAtMs: 2 }));
    queue.enqueue(queued("third-next", { priority: "next", createdAtMs: 3 }));

    expect(queue.snapshot("session-1").items.map((item) => item.id)).toEqual([
      "first-later",
      "second-now",
      "third-next",
    ]);
    expect(queue.dequeue()?.id).toBe("second-now");
  });
});
