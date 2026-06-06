import { assert } from "./assertions.js";
import type { BenchmarkCase } from "./benchmark-runner.js";
import { FakeMemory } from "./fake-memory.js";
import { FakeModel } from "./fake-model.js";
import { FakeExecutionPolicy } from "./fake-policy.js";
import { FakeRecall } from "./fake-recall.js";
import { FakeSession } from "./fake-session.js";
import { createFakeTool } from "./fake-tool.js";
import { ScenarioRunner } from "./scenario-runner.js";

export function createWave1QualityBenchmarkCases(): readonly BenchmarkCase[] {
  const toolTimeoutCase: BenchmarkCase = {
    id: "tool_timeout",
    description: "Tool timeout should produce degradation + audit trail",
    createRunner() {
      const model = new FakeModel({
        responders: [
          {
            output: "calling slow tool",
            toolCalls: [
              {
                name: "slow_tool",
                callId: "timeout-1",
                args: { payload: "x" },
                timeoutMs: 5,
                risk: "medium",
              },
            ],
          },
        ],
      });
      const slowTool = createFakeTool({
        name: "slow_tool",
        handler() {
          return new Promise(() => {});
        },
      });
      return new ScenarioRunner({
        model,
        memory: new FakeMemory(),
        session: new FakeSession({ id: "wave1_timeout" }),
        tools: [slowTool],
      });
    },
    steps: [{ input: "trigger timeout" }],
    gate(results) {
      const firstTurn = results[0];
      assert(firstTurn !== undefined, "Expected one turn result");
      assert(firstTurn.toolResults.length === 1, "Expected one tool result");
      assert(firstTurn.toolResults[0]?.ok === false, "Expected timeout failure");
      assert(
        firstTurn.toolResults[0]?.error?.includes("timed out after") ?? false,
        "Expected timeout error message",
      );
      assert(
        firstTurn.degradations.some(
          (degradation) => degradation.stage === "tool" && degradation.reason === "latency-budget",
        ),
        "Expected latency-budget degradation",
      );
      assert(
        firstTurn.auditEvents.some((event) => event.kind === "tool.timeout"),
        "Expected tool.timeout audit event",
      );
    },
  };

  const memoryDegradeCase: BenchmarkCase = {
    id: "memory_degrade",
    description: "Recall failure should degrade without aborting turn",
    createRunner() {
      const model = new FakeModel({
        responders: [{ output: "continue without recall" }],
      });
      const recall = new FakeRecall({
        responder() {
          throw new Error("recall backend unavailable");
        },
      });
      return new ScenarioRunner({
        model,
        memory: new FakeMemory(),
        session: new FakeSession({ id: "wave1_memory" }),
        recall,
      });
    },
    steps: [{ input: "query memory" }],
    gate(results) {
      const firstTurn = results[0];
      assert(firstTurn !== undefined, "Expected one turn result");
      assert(firstTurn.response.output === "continue without recall", "Turn should continue");
      assert(
        firstTurn.degradations.some(
          (degradation) =>
            degradation.stage === "runtime" && degradation.reason === "context-pressure",
        ),
        "Expected context-pressure degradation",
      );
      assert(
        firstTurn.auditEvents.some((event) => event.kind === "memory.degraded"),
        "Expected memory.degraded audit event",
      );
      assert(
        firstTurn.streamEvents.some((event) => event.kind === "stream.degraded"),
        "Expected stream.degraded event",
      );
    },
  };

  const policyDenyCase: BenchmarkCase = {
    id: "policy_deny",
    description: "Denied tool call should not execute tool handler",
    createRunner() {
      const model = new FakeModel({
        responders: [
          {
            output: "requesting sensitive tool",
            toolCalls: [
              {
                name: "dangerous_delete",
                callId: "deny-1",
                args: { path: "/tmp/demo" },
                risk: "critical",
              },
            ],
          },
        ],
      });
      const policy = new FakeExecutionPolicy({
        fallback: {
          verdict: "deny",
          reason: "Denied by policy: critical tool not allowed in Wave 1",
        },
      });
      const dangerousTool = createFakeTool({
        name: "dangerous_delete",
        handler() {
          throw new Error("tool should not run when denied");
        },
      });
      return new ScenarioRunner({
        model,
        memory: new FakeMemory(),
        session: new FakeSession({ id: "wave1_policy" }),
        tools: [dangerousTool],
        policy,
      });
    },
    steps: [{ input: "delete file now" }],
    gate(results) {
      const firstTurn = results[0];
      assert(firstTurn !== undefined, "Expected one turn result");
      assert(firstTurn.toolResults.length === 1, "Expected one denied tool result");
      assert(firstTurn.toolResults[0]?.ok === false, "Expected denied tool to fail");
      assert(
        firstTurn.toolResults[0]?.error?.includes("Denied by policy") ?? false,
        "Expected policy denial message",
      );
      assert(
        firstTurn.auditEvents.some((event) => event.kind === "policy.deny"),
        "Expected policy.deny audit event",
      );
      assert(
        !firstTurn.auditEvents.some((event) => event.kind === "tool.started"),
        "Denied tool should never emit tool.started",
      );
    },
  };

  const streamAuditCase: BenchmarkCase = {
    id: "stream_audit",
    description: "Successful tool path should emit stream and audit boundaries",
    createRunner() {
      const model = new FakeModel({
        responders: [
          {
            output: "tool execution ok",
            toolCalls: [
              {
                name: "echo",
                callId: "stream-1",
                args: { value: "ok" },
                risk: "low",
              },
            ],
          },
        ],
      });
      const tool = createFakeTool({
        name: "echo",
        handler(args) {
          return args;
        },
      });
      const policy = new FakeExecutionPolicy();
      return new ScenarioRunner({
        model,
        memory: new FakeMemory(),
        session: new FakeSession({ id: "wave1_stream" }),
        tools: [tool],
        policy,
      });
    },
    steps: [{ input: "run tool with audit" }],
    gate(results) {
      const firstTurn = results[0];
      assert(firstTurn !== undefined, "Expected one turn result");
      assert(firstTurn.toolResults[0]?.ok === true, "Expected successful tool call");
      const streamKinds = firstTurn.streamEvents.map((event) => event.kind);
      assert(streamKinds.includes("stream.started"), "Missing stream.started");
      assert(streamKinds.includes("stream.chunk"), "Missing stream.chunk");
      assert(streamKinds.includes("stream.tool-call"), "Missing stream.tool-call");
      assert(streamKinds.includes("stream.completed"), "Missing stream.completed");

      const auditKinds = firstTurn.auditEvents.map((event) => event.kind);
      assert(auditKinds.includes("policy.allow"), "Missing policy.allow audit");
      assert(auditKinds.includes("tool.started"), "Missing tool.started audit");
      assert(auditKinds.includes("tool.finished"), "Missing tool.finished audit");
    },
  };

  return [toolTimeoutCase, memoryDegradeCase, policyDenyCase, streamAuditCase];
}
