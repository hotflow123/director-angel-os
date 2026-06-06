import { describe, expect, test } from "vitest";

import {
  assertMemoryRoleCount,
  assertToolCalled,
  assertTurnOutput,
  createFakeTool,
  createTurnHarness,
} from "../src/index.js";

describe("createTurnHarness", () => {
  test("wires model, tools, session and assertions helpers", async () => {
    const tool = createFakeTool({
      name: "echo",
      handler(args) {
        return args;
      },
    });

    const harness = createTurnHarness({
      responders: [
        {
          output: "using tool",
          toolCalls: [{ name: "echo", args: { value: "ok" }, callId: "c1" }],
        },
      ],
      tools: [tool],
      sessionId: "session_test",
    });

    const result = await harness.runUserTurn("run");
    assertTurnOutput(result, "using tool");
    assertToolCalled(tool, 1);
    assertMemoryRoleCount(result.memory, "tool", 1);

    expect(result.session.id).toBe("session_test");
    expect(result.session.turn).toBe(1);
  });
});
