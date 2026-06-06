import { describe, expect, test } from "vitest";

import {
  decodeTaskTodoWriteState,
  normalizeTaskEventPayloadForSessionWrite,
  normalizeTaskEventPayloadForTasksCoreRead,
} from "./task-event-contract-compat.js";

describe("task-event-contract compatibility", () => {
  test("decodes flat todo_write payload", () => {
    const state = decodeTaskTodoWriteState({
      items: [{ id: "t1", content: "flat payload", status: "todo" }],
      updatedAtMs: 101,
    });

    expect(state).toBeDefined();
    expect(state?.items[0]?.content).toBe("flat payload");
    expect(state?.updatedAtMs).toBe(101);
  });

  test("decodes wrapped todo_write payload", () => {
    const state = decodeTaskTodoWriteState({
      todos: {
        items: [{ id: "t1", content: "wrapped payload", status: "doing" }],
        updatedAtMs: 202,
      },
      updatedAtMs: 999,
    });

    expect(state).toBeDefined();
    expect(state?.items[0]?.content).toBe("wrapped payload");
    expect(state?.updatedAtMs).toBe(202);
  });

  test("normalizes wrapped payload to flat for session writes", () => {
    const payload = normalizeTaskEventPayloadForSessionWrite("tasks.todo_write", {
      todos: {
        items: [{ id: "t1", content: "wrapped payload", status: "todo" }],
        updatedAtMs: 303,
      },
      updatedAtMs: 303,
    }) as { items: Array<{ content: string }>; updatedAtMs: number };

    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload.items[0]?.content).toBe("wrapped payload");
    expect(payload.updatedAtMs).toBe(303);
  });

  test("normalizes flat payload to canonical task contract for tasks-core reader", () => {
    const payload = normalizeTaskEventPayloadForTasksCoreRead(
      "tasks.todo_write",
      {
        items: [{ id: "t1", content: "flat payload", status: "todo" }],
      },
      404,
    ) as { items: Array<{ content: string }>; updatedAtMs?: number };

    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload.items[0]?.content).toBe("flat payload");
    expect(payload.updatedAtMs).toBeUndefined();
  });
});
