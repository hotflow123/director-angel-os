import type { ToolExecutionResult, ToolMergeStrategy } from "./contracts.js";

export function mergeToolResults(
  strategy: ToolMergeStrategy,
  results: readonly ToolExecutionResult[],
): ToolExecutionResult[] {
  switch (strategy) {
    case "ordered":
      return [...results];
    case "first-wins": {
      const firstSuccess = results.find((result) => result.ok);
      return firstSuccess ? [firstSuccess] : [...results];
    }
    case "all-or-nothing":
      return results.every((result) => result.ok) ? [...results] : [];
    default:
      strategy satisfies never;
      return [...results];
  }
}
