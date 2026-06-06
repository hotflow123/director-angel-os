import type { ModelResponse, ToolLike } from "./contracts.js";
import { FakeMemory } from "./fake-memory.js";
import { FakeModel, type ModelResponder } from "./fake-model.js";
import { FakeSession } from "./fake-session.js";
import { ScenarioRunner, type TurnResult } from "./scenario-runner.js";

export interface TurnHarnessOptions {
  readonly responders?: readonly ModelResponder[];
  readonly fallback?: ModelResponse;
  readonly tools?: readonly ToolLike[];
  readonly sessionId?: string;
}

export interface TurnHarness {
  readonly model: FakeModel;
  readonly memory: FakeMemory;
  readonly session: FakeSession;
  readonly runner: ScenarioRunner;
  runUserTurn(input: string): Promise<TurnResult>;
}

export function createTurnHarness(options: TurnHarnessOptions = {}): TurnHarness {
  const model = new FakeModel({
    ...(options.responders !== undefined ? { responders: options.responders } : {}),
    ...(options.fallback !== undefined ? { fallback: options.fallback } : {}),
  });
  const memory = new FakeMemory();
  const session = new FakeSession(options.sessionId !== undefined ? { id: options.sessionId } : {});
  const runner = new ScenarioRunner({
    model,
    memory,
    session,
    ...(options.tools !== undefined ? { tools: options.tools } : {}),
  });

  return {
    model,
    memory,
    session,
    runner,
    runUserTurn(input: string): Promise<TurnResult> {
      return runner.runTurn(input);
    },
  };
}
