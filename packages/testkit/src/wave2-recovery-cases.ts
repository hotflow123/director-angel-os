import { assert } from "./assertions.js";
import type { BenchmarkCase } from "./benchmark-runner.js";
import { FakeMemory } from "./fake-memory.js";
import { FakeModel } from "./fake-model.js";
import { FakeSession } from "./fake-session.js";
import { createFakeTool } from "./fake-tool.js";
import { ScenarioRunner } from "./scenario-runner.js";

export function createWave2RecoveryBenchmarkCases(): readonly BenchmarkCase[] {
  const interruptedTurnRecoveryCase: BenchmarkCase = {
    id: "interrupted_turn_recovery",
    description: "Turn should resume from a synthetic interruption checkpoint",
    createRunner() {
      const model = new FakeModel({
        responders: [
          {
            output: "plan two tools then finish",
            toolCalls: [
              {
                name: "compute.alpha",
                callId: "recovery-1",
                args: { value: "alpha" },
                risk: "low",
              },
              {
                name: "compute.beta",
                callId: "recovery-2",
                args: { value: "beta" },
                risk: "medium",
              },
            ],
          },
        ],
      });
      const alphaTool = createFakeTool({
        name: "compute.alpha",
        handler(args) {
          const input = args as { value: string };
          return `ok:${input.value}`;
        },
      });
      const betaTool = createFakeTool({
        name: "compute.beta",
        handler(args) {
          const input = args as { value: string };
          return `ok:${input.value}`;
        },
      });

      return new ScenarioRunner({
        model,
        memory: new FakeMemory(),
        session: new FakeSession({ id: "wave2_recovery_case" }),
        tools: [alphaTool, betaTool],
      });
    },
    steps: [
      {
        input: "simulate interrupted tool execution and resume",
        runOptions: {
          recoveryPlan: {
            interruptAfterToolCalls: 1,
          },
        },
      },
    ],
    gate(results) {
      const firstTurn = results[0];
      assert(firstTurn !== undefined, "Expected one turn result");
      assert(firstTurn.toolResults.length === 2, "Expected two tool results after recovery");
      assert(
        firstTurn.toolResults.every((result) => result.ok),
        "Expected successful recovered tools",
      );
      assert(firstTurn.recovery !== undefined, "Expected recovery trace metadata");
      assert(firstTurn.recovery?.interrupted === true, "Expected interrupted=true");
      assert(firstTurn.recovery?.resumed === true, "Expected resumed=true");
      assert(firstTurn.recovery?.checkpointToolIndex === 1, "Expected checkpoint at tool index 1");
      assert(firstTurn.recovery?.totalToolCalls === 2, "Expected totalToolCalls=2");
      assert(firstTurn.status.latestTurnId.length > 0, "Expected status latestTurnId");
      assert(firstTurn.status.phase === "completed", "Expected completed status phase");
      assert(
        (firstTurn.status.recoveryHint?.checkpointToolIndex ?? -1) === 1,
        "Expected recovery hint checkpoint index in status",
      );
      assert(
        firstTurn.auditEvents.some((event) => event.kind === "runtime.interrupted"),
        "Expected runtime.interrupted audit event",
      );
      assert(
        firstTurn.auditEvents.some((event) => event.kind === "runtime.resumed"),
        "Expected runtime.resumed audit event",
      );
      assert(
        firstTurn.streamEvents.some((event) => event.kind === "stream.interrupted"),
        "Expected stream.interrupted event",
      );
      assert(
        firstTurn.streamEvents.some((event) => event.kind === "stream.resumed"),
        "Expected stream.resumed event",
      );
    },
  };

  return [interruptedTurnRecoveryCase];
}
