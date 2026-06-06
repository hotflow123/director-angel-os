import { describe, expect, it, vi } from "vitest";

import { StepLoop } from "./step-loop.js";

describe("StepLoop", () => {
  it("stops when strategy requests stop before max steps", async () => {
    const runStep = vi.fn(async ({ state, stepIndex }: { state: number; stepIndex: number }) => ({
      state: state + 1,
      continueLoop: stepIndex < 1,
    }));
    const onStepCompleted = vi.fn();
    const loop = new StepLoop({ runStep }, { onStepCompleted });

    const result = await loop.run({
      initialState: 0,
      maxSteps: 5,
    });

    expect(result).toEqual({
      state: 2,
      completedSteps: 2,
      stopReason: "strategy-stop",
    });
    expect(runStep).toHaveBeenCalledTimes(2);
    expect(onStepCompleted).toHaveBeenCalledTimes(2);
  });

  it("stops at max steps when strategy always continues", async () => {
    const loop = new StepLoop({
      runStep: async ({ state }: { state: number }) => ({
        state: state + 1,
        continueLoop: true,
      }),
    });

    const result = await loop.run({
      initialState: 1,
      maxSteps: 3,
    });

    expect(result).toEqual({
      state: 4,
      completedSteps: 3,
      stopReason: "max-steps",
    });
  });

  it("continues from a recovered step index", async () => {
    const seenStepIndexes: number[] = [];
    const loop = new StepLoop({
      runStep: async ({
        state,
        stepIndex,
      }: {
        state: number;
        stepIndex: number;
      }) => {
        seenStepIndexes.push(stepIndex);
        return {
          state: state + 1,
          continueLoop: stepIndex < 2,
        };
      },
    });

    const result = await loop.run({
      initialState: 0,
      maxSteps: 4,
      startStepIndex: 1,
    });

    expect(seenStepIndexes).toEqual([1, 2]);
    expect(result).toEqual({
      state: 2,
      completedSteps: 2,
      stopReason: "strategy-stop",
    });
  });
});
