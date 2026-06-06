import { assert } from "./assertions.js";
import type { BenchmarkCase } from "./benchmark-runner.js";
import { FakeMemory } from "./fake-memory.js";
import { FakeModel } from "./fake-model.js";
import { FakeExecutionPolicy } from "./fake-policy.js";
import { FakeRecall } from "./fake-recall.js";
import { FakeSession } from "./fake-session.js";
import { createFakeTool } from "./fake-tool.js";
import { ScenarioRunner } from "./scenario-runner.js";

export function createWave3GovernanceBenchmarkCases(): readonly BenchmarkCase[] {
  const policyDenyCase: BenchmarkCase = {
    id: "wave3_policy_deny",
    description: "Policy deny should block execution and leave auditable evidence",
    createRunner() {
      const model = new FakeModel({
        responders: [
          {
            output: "request dangerous action",
            toolCalls: [
              {
                name: "dangerous_delete",
                callId: "wave3-deny-1",
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
          reason: "Denied by policy: critical capability blocked",
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
        session: new FakeSession({ id: "wave3_policy_deny" }),
        tools: [dangerousTool],
        policy,
      });
    },
    steps: [{ input: "delete everything now" }],
    gate(results) {
      const turn = results[0];
      assert(turn !== undefined, "Expected one turn result");
      assert(turn.toolResults.length === 1, "Expected denied tool result");
      assert(turn.toolResults[0]?.ok === false, "Expected denied tool to fail");
      assert(
        turn.toolResults[0]?.error?.includes("Denied by policy") ?? false,
        "Expected policy denial message",
      );
      assert(turn.status.phase === "completed", "Denied tool should not crash the turn");
      assert(
        turn.auditEvents.some((event) => event.kind === "policy.deny"),
        "Expected policy.deny audit event",
      );
      assert(
        !turn.auditEvents.some((event) => event.kind === "tool.started"),
        "Denied tool should not emit tool.started",
      );
    },
  };

  const approvalRequiredCase: BenchmarkCase = {
    id: "wave3_approval_required",
    description: "Policy ask should produce approval-required failure without execution",
    createRunner() {
      const model = new FakeModel({
        responders: [
          {
            output: "request protected tool",
            toolCalls: [
              {
                name: "deploy.production",
                callId: "wave3-ask-1",
                args: { service: "api" },
                risk: "high",
              },
            ],
          },
        ],
      });
      const policy = new FakeExecutionPolicy({
        fallback: {
          verdict: "ask",
          reason: "Approval required: production deployment requires human gate",
        },
      });
      const deployTool = createFakeTool({
        name: "deploy.production",
        handler() {
          throw new Error("tool should not run before approval");
        },
      });
      return new ScenarioRunner({
        model,
        memory: new FakeMemory(),
        session: new FakeSession({ id: "wave3_approval_required" }),
        tools: [deployTool],
        policy,
      });
    },
    steps: [{ input: "deploy to production" }],
    gate(results) {
      const turn = results[0];
      assert(turn !== undefined, "Expected one turn result");
      assert(turn.toolResults.length === 1, "Expected one policy-blocked result");
      assert(turn.toolResults[0]?.ok === false, "Expected approval-required tool to fail");
      assert(
        turn.toolResults[0]?.error?.includes("Approval required") ?? false,
        "Expected approval-required message",
      );
      assert(
        turn.auditEvents.some((event) => event.kind === "policy.ask"),
        "Expected policy.ask audit event",
      );
      assert(
        !turn.auditEvents.some((event) => event.kind === "tool.started"),
        "Approval-required tool should not start",
      );
    },
  };

  const toolFailureCase: BenchmarkCase = {
    id: "wave3_tool_failure",
    description: "Tool execution failure should be recorded and turn should still complete",
    createRunner() {
      const model = new FakeModel({
        responders: [
          {
            output: "invoke flaky tool",
            toolCalls: [
              {
                name: "flaky.fetch",
                callId: "wave3-tool-fail-1",
                args: { id: "x" },
                risk: "medium",
              },
            ],
          },
        ],
      });
      const tool = createFakeTool({
        name: "flaky.fetch",
        handler() {
          throw new Error("upstream 503");
        },
      });
      return new ScenarioRunner({
        model,
        memory: new FakeMemory(),
        session: new FakeSession({ id: "wave3_tool_failure" }),
        tools: [tool],
      });
    },
    steps: [{ input: "run flaky tool" }],
    gate(results) {
      const turn = results[0];
      assert(turn !== undefined, "Expected one turn result");
      assert(turn.toolResults.length === 1, "Expected one failed tool result");
      assert(turn.toolResults[0]?.ok === false, "Expected failed tool result");
      assert(
        turn.toolResults[0]?.error?.includes("upstream 503") ?? false,
        "Expected tool failure message",
      );
      assert(turn.status.phase === "completed", "Tool failure should not abort turn by default");
      assert(
        turn.auditEvents.some((event) => event.kind === "tool.finished"),
        "Expected tool.finished audit event",
      );
      assert(
        turn.streamEvents.some((event) => event.kind === "stream.tool-call"),
        "Expected stream.tool-call event",
      );
    },
  };

  const memoryDegradeCase: BenchmarkCase = {
    id: "wave3_memory_degrade",
    description: "Recall backend failure should degrade but keep turn running",
    createRunner() {
      const model = new FakeModel({
        responders: [{ output: "continue despite recall failure" }],
      });
      const recall = new FakeRecall({
        responder() {
          throw new Error("recall backend timeout");
        },
      });
      return new ScenarioRunner({
        model,
        memory: new FakeMemory(),
        session: new FakeSession({ id: "wave3_memory_degrade" }),
        recall,
      });
    },
    steps: [{ input: "query memory context" }],
    gate(results) {
      const turn = results[0];
      assert(turn !== undefined, "Expected one turn result");
      assert(turn.status.phase === "completed", "Turn should complete after memory degrade");
      assert(
        turn.degradations.some(
          (degradation) =>
            degradation.stage === "runtime" && degradation.reason === "context-pressure",
        ),
        "Expected memory-related degradation",
      );
      assert(
        turn.auditEvents.some((event) => event.kind === "memory.degraded"),
        "Expected memory.degraded audit event",
      );
      assert(
        turn.streamEvents.some((event) => event.kind === "stream.degraded"),
        "Expected stream.degraded event",
      );
    },
  };

  const providerTransientFailureCase: BenchmarkCase = {
    id: "wave3_provider_transient_failure",
    description: "Model/provider transient failure should emit failed status and stream.aborted",
    createRunner() {
      const model = new FakeModel({
        responders: [
          () => {
            throw new Error("provider transient failure: 429 rate limited");
          },
        ],
      });
      return new ScenarioRunner({
        model,
        memory: new FakeMemory(),
        session: new FakeSession({ id: "wave3_provider_failure" }),
      });
    },
    steps: [{ input: "trigger provider failure" }],
    gate(results) {
      const turn = results[0];
      assert(turn !== undefined, "Expected one turn result");
      assert(turn.status.phase === "failed", "Expected failed turn status");
      assert(turn.toolResults.length === 0, "Model failure should happen before tool execution");
      assert(
        turn.degradations.some(
          (degradation) => degradation.stage === "model" && degradation.reason === "model-limited",
        ),
        "Expected model/provider degradation",
      );
      assert(
        turn.auditEvents.some((event) => event.kind === "runtime.model_failed"),
        "Expected runtime.model_failed audit event",
      );
      assert(
        turn.streamEvents.some((event) => event.kind === "stream.aborted"),
        "Expected stream.aborted event",
      );
      assert(
        !turn.streamEvents.some((event) => event.kind === "stream.completed"),
        "Failed turn should not emit stream.completed",
      );
    },
  };

  return [
    policyDenyCase,
    approvalRequiredCase,
    toolFailureCase,
    memoryDegradeCase,
    providerTransientFailureCase,
  ];
}
