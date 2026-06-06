import { describe, expect, it } from "vitest";

import { resolveTurnReasoningSelection } from "./turn-reasoning.js";

describe("resolveTurnReasoningSelection", () => {
  it("returns undefined when no explicit reasoning surface is requested", () => {
    expect(resolveTurnReasoningSelection({})).toBeUndefined();
  });

  it("maps tool-heavy turns to a plan-execute reasoning surface", () => {
    const selection = resolveTurnReasoningSelection({
      requiresTools: true,
    });

    expect(selection).toMatchObject({
      decision: {
        strategy: "plan-execute",
      },
      promptSection: {
        id: "runtime.reasoning-strategy",
      },
    });
    expect(selection?.promptSection.content).toContain("Reasoning strategy: plan-execute");
    expect(selection?.summary).toContain("Selected plan-execute reasoning strategy");
  });

  it("honors a forced react reasoning strategy", () => {
    const selection = resolveTurnReasoningSelection({
      reasoningStrategy: "react",
      requiresTools: true,
      estimatedComplexity: "high",
    });

    expect(selection).toMatchObject({
      decision: {
        strategy: "react",
      },
    });
    expect(selection?.promptSection.content).toContain("Reasoning strategy: react");
  });
});
