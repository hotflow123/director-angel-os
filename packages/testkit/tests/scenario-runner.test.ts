import { describe, expect, test } from "vitest";

import {
  FakeExecutionPolicy,
  FakeMemory,
  FakeModel,
  FakeSession,
  ScenarioRunner,
  createFakeTool,
} from "../src/index.js";

describe("ScenarioRunner", () => {
  test("executes tool calls and appends memory entries", async () => {
    const model = new FakeModel({
      responders: [
        {
          output: "calling tool",
          toolCalls: [{ name: "sum", args: { a: 1, b: 2 }, callId: "c1" }],
        },
      ],
    });

    const tool = createFakeTool({
      name: "sum",
      handler(args) {
        const input = args as { a: number; b: number };
        return input.a + input.b;
      },
    });

    const runner = new ScenarioRunner({
      model,
      memory: new FakeMemory(),
      session: new FakeSession({ id: "s1" }),
      tools: [tool],
    });

    const result = await runner.runTurn("please add");
    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0]).toMatchObject({
      name: "sum",
      ok: true,
      value: 3,
    });
    expect(result.memory.map((entry) => entry.role)).toEqual(["user", "assistant", "tool"]);
    expect(result.session.turn).toBe(1);
  });

  test("simulates interrupted turn recovery with run options", async () => {
    const model = new FakeModel({
      responders: [
        {
          output: "run two tools",
          toolCalls: [
            { name: "tool.one", args: { value: 1 }, callId: "r1" },
            { name: "tool.two", args: { value: 2 }, callId: "r2" },
          ],
        },
      ],
    });

    const toolOne = createFakeTool({
      name: "tool.one",
      handler(args) {
        return `one:${(args as { value: number }).value}`;
      },
    });
    const toolTwo = createFakeTool({
      name: "tool.two",
      handler(args) {
        return `two:${(args as { value: number }).value}`;
      },
    });

    const runner = new ScenarioRunner({
      model,
      memory: new FakeMemory(),
      session: new FakeSession({ id: "recover-test" }),
      tools: [toolOne, toolTwo],
    });

    const result = await runner.runTurn("resume this turn", {
      recoveryPlan: {
        interruptAfterToolCalls: 1,
      },
    });

    expect(result.toolResults).toHaveLength(2);
    expect(result.recovery).toMatchObject({
      interrupted: true,
      resumed: true,
      checkpointToolIndex: 1,
      totalToolCalls: 2,
    });
    expect(result.status).toMatchObject({
      latestTurnId: "recover-test:turn-1",
      phase: "completed",
    });
    expect(result.status.recoveryHint).toMatchObject({
      checkpointToolIndex: 1,
      totalToolCalls: 2,
      nextToolIndex: 2,
    });
    expect(result.auditEvents.some((event) => event.kind === "runtime.interrupted")).toBe(true);
    expect(result.auditEvents.some((event) => event.kind === "runtime.resumed")).toBe(true);
    expect(result.streamEvents.some((event) => event.kind === "stream.interrupted")).toBe(true);
    expect(result.streamEvents.some((event) => event.kind === "stream.resumed")).toBe(true);
  });

  test("handles approval-required policy verdict without invoking tool", async () => {
    const model = new FakeModel({
      responders: [
        {
          output: "request deploy",
          toolCalls: [{ name: "deploy", args: { env: "prod" }, callId: "a1" }],
        },
      ],
    });
    const policy = new FakeExecutionPolicy({
      fallback: {
        verdict: "ask",
        reason: "Approval required for production",
      },
    });
    const tool = createFakeTool({
      name: "deploy",
      handler() {
        throw new Error("must not run");
      },
    });
    const runner = new ScenarioRunner({
      model,
      memory: new FakeMemory(),
      session: new FakeSession({ id: "approval-test" }),
      tools: [tool],
      policy,
    });

    const result = await runner.runTurn("deploy");
    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0]).toMatchObject({
      name: "deploy",
      callId: "a1",
      ok: false,
    });
    expect(result.toolResults[0]?.error).toContain("Approval required");
    expect(result.auditEvents.some((event) => event.kind === "policy.ask")).toBe(true);
    expect(result.auditEvents.some((event) => event.kind === "tool.started")).toBe(false);
    expect(result.status.phase).toBe("completed");
  });

  test("marks turn failed and emits stream.aborted on model runtime failure", async () => {
    const model = new FakeModel({
      responders: [
        () => {
          throw new Error("provider transient failure: 429");
        },
      ],
    });
    const runner = new ScenarioRunner({
      model,
      memory: new FakeMemory(),
      session: new FakeSession({ id: "model-failure-test" }),
    });

    const result = await runner.runTurn("trigger model failure");
    expect(result.status.phase).toBe("failed");
    expect(result.degradations.some((degradation) => degradation.stage === "model")).toBe(true);
    expect(result.auditEvents.some((event) => event.kind === "runtime.model_failed")).toBe(true);
    expect(result.streamEvents.some((event) => event.kind === "stream.aborted")).toBe(true);
    expect(result.streamEvents.some((event) => event.kind === "stream.completed")).toBe(false);
    expect(result.toolResults).toHaveLength(0);
  });
});
