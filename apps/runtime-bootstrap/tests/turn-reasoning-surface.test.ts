import { describe, expect, test } from "vitest";

import { createSurfaceTurnReasoningInput, resolveSurfaceTurnReasoningInput } from "../src/index.js";

describe("createSurfaceTurnReasoningInput", () => {
  test("defaults CLI workbench turns to tool-heavy plan-execute hints", () => {
    expect(createSurfaceTurnReasoningInput("cli-workbench")).toEqual({
      estimatedComplexity: "medium",
      requiresTools: true,
    });
  });

  test("defaults gateway messages to latency-biased react hints", () => {
    expect(createSurfaceTurnReasoningInput("gateway-message")).toEqual({
      latencyBudgetMs: 1500,
    });
  });

  test("merges explicit overrides on top of surface defaults", () => {
    expect(
      createSurfaceTurnReasoningInput("gateway-message", {
        reasoningStrategy: "plan-execute",
        requiresTools: true,
      }),
    ).toEqual({
      latencyBudgetMs: 1500,
      reasoningStrategy: "plan-execute",
      requiresTools: true,
    });
  });

  test("returns a default-only resolution when a surface has no explicit overrides", () => {
    expect(resolveSurfaceTurnReasoningInput("gateway-message")).toEqual({
      surface: "gateway-message",
      defaults: {
        latencyBudgetMs: 1500,
      },
      overrides: {},
      input: {
        latencyBudgetMs: 1500,
      },
      overrideFields: [],
      overrideMode: "surface-defaults",
    });
  });

  test("tracks explicit override fields and preserves falsey override values", () => {
    expect(
      resolveSurfaceTurnReasoningInput("cli-workbench", {
        requiresTools: false,
        latencyBudgetMs: 0,
      }),
    ).toEqual({
      surface: "cli-workbench",
      defaults: {
        estimatedComplexity: "medium",
        requiresTools: true,
      },
      overrides: {
        requiresTools: false,
        latencyBudgetMs: 0,
      },
      input: {
        estimatedComplexity: "medium",
        requiresTools: false,
        latencyBudgetMs: 0,
      },
      overrideFields: ["requiresTools", "latencyBudgetMs"],
      overrideMode: "surface-overrides",
    });
  });
});
