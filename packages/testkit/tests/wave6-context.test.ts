import { describe, expect, test } from "vitest";

import { MultiStepTurnContext } from "@hotflow/context";

describe("MultiStepTurnContext Wave 6 scenarios", () => {
  test("rebuilds dynamic sections after tool result and recall degrade", () => {
    const context = new MultiStepTurnContext();
    context.setUserInput("Plan the rollout");

    const first = context.rebuild({ tokenBudget: 128 });
    expect(first.cacheBoundary.dynamicSections.map((section) => section.id)).toEqual([
      "user-input",
    ]);

    context.appendToolResult({
      toolName: "tasks.todo_write",
      ok: true,
      output: { items: [{ id: "wave6-1", content: "Ship beta" }] },
    });
    context.setTaskState("Current todo: Ship beta");
    context.replaceRecallBlock({
      blockId: "working-memory",
      items: [
        {
          id: "recall-1",
          layer: "working-memory",
          content: "Milestone planning is stored",
        },
      ],
      summary: "Working memory snapshot",
      degraded: {
        reason: "memory-timeout",
        message: "Recall backend timed out",
      },
    });

    const second = context.rebuild({ tokenBudget: 256 });
    const secondSectionIds = second.cacheBoundary.dynamicSections.map((section) => section.id);
    expect(secondSectionIds).toEqual(
      expect.arrayContaining([
        "user-input",
        "tool-result-1",
        "task-state",
        "working-memory.degraded",
        "working-memory.recall-1",
      ]),
    );

    const custom = {
      id: "huge",
      cacheBucket: "dynamic",
      priority: 10,
      content: "x".repeat(4_000),
      tokenCost: 4_000,
    };
    context.setCustomDynamicSections([custom]);
    const third = context.rebuild({ tokenBudget: 5 });
    const thirdSectionIds = third.cacheBoundary.dynamicSections.map((section) => section.id);
    expect(thirdSectionIds).toContain("user-input");
    expect(thirdSectionIds).not.toContain("huge");
    expect(third.budget.omitted.map((section) => section.id)).toContain("huge");
    expect(context.getLastBudget()).toEqual(third.budget);
  });
});
