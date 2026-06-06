import type { ChatRole, MemoryEntry } from "./contracts.js";
import type { FakeTool } from "./fake-tool.js";
import type { TurnResult } from "./scenario-runner.js";

function fail(message: string): never {
  throw new Error(message);
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    fail(message);
  }
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    fail(message ?? `Expected ${String(expected)}, received ${String(actual)}`);
  }
}

export function assertTurnOutput(result: TurnResult, expected: string): void {
  assertEqual(result.response.output, expected, "Unexpected model output");
}

export function assertToolCalled(tool: FakeTool, expectedCalls = 1, message?: string): void {
  assertEqual(
    tool.calls.length,
    expectedCalls,
    message ?? `Tool "${tool.name}" expected ${expectedCalls} calls`,
  );
}

export function assertMemoryRoleCount(
  memory: readonly MemoryEntry[],
  role: ChatRole,
  expectedCount: number,
): void {
  const actual = memory.filter((entry) => entry.role === role).length;
  assertEqual(actual, expectedCount, `Expected ${expectedCount} ${role} entries`);
}
