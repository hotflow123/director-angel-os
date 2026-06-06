import type { TurnInput } from "@hotflow/engine";

export type SurfaceTurnReasoningInput = Pick<
  TurnInput,
  "reasoningStrategy" | "estimatedComplexity" | "requiresTools" | "latencyBudgetMs"
>;

export type RuntimeTurnReasoningSurface = "cli-workbench" | "gateway-message";
export const SURFACE_TURN_REASONING_FIELD_KEYS = [
  "reasoningStrategy",
  "estimatedComplexity",
  "requiresTools",
  "latencyBudgetMs",
] as const;

export type SurfaceTurnReasoningFieldKey = (typeof SURFACE_TURN_REASONING_FIELD_KEYS)[number];

export interface SurfaceTurnReasoningResolution {
  readonly surface: RuntimeTurnReasoningSurface;
  readonly defaults: SurfaceTurnReasoningInput;
  readonly overrides: SurfaceTurnReasoningInput;
  readonly input: SurfaceTurnReasoningInput;
  readonly overrideFields: readonly SurfaceTurnReasoningFieldKey[];
  readonly overrideMode: "surface-defaults" | "surface-overrides";
}

const CLI_WORKBENCH_REASONING_INPUT: SurfaceTurnReasoningInput = {
  estimatedComplexity: "medium",
  requiresTools: true,
};

const GATEWAY_MESSAGE_REASONING_INPUT: SurfaceTurnReasoningInput = {
  latencyBudgetMs: 1500,
};

function selectDefinedTurnReasoningFields(
  input: SurfaceTurnReasoningInput = {},
): SurfaceTurnReasoningInput {
  return {
    ...(input.reasoningStrategy === undefined
      ? {}
      : { reasoningStrategy: input.reasoningStrategy }),
    ...(input.estimatedComplexity === undefined
      ? {}
      : { estimatedComplexity: input.estimatedComplexity }),
    ...(input.requiresTools === undefined ? {} : { requiresTools: input.requiresTools }),
    ...(input.latencyBudgetMs === undefined ? {} : { latencyBudgetMs: input.latencyBudgetMs }),
  };
}

export function resolveSurfaceTurnReasoningInput(
  surface: RuntimeTurnReasoningSurface,
  overrides: SurfaceTurnReasoningInput = {},
): SurfaceTurnReasoningResolution {
  const defaults =
    surface === "cli-workbench" ? CLI_WORKBENCH_REASONING_INPUT : GATEWAY_MESSAGE_REASONING_INPUT;
  const normalizedDefaults = selectDefinedTurnReasoningFields(defaults);
  const normalizedOverrides = selectDefinedTurnReasoningFields(overrides);
  const overrideFields = SURFACE_TURN_REASONING_FIELD_KEYS.filter(
    (field) => field in normalizedOverrides,
  );

  return {
    surface,
    defaults: normalizedDefaults,
    overrides: normalizedOverrides,
    input: {
      ...normalizedDefaults,
      ...normalizedOverrides,
    },
    overrideFields,
    overrideMode: overrideFields.length === 0 ? "surface-defaults" : "surface-overrides",
  };
}

export function createSurfaceTurnReasoningInput(
  surface: RuntimeTurnReasoningSurface,
  overrides: SurfaceTurnReasoningInput = {},
): SurfaceTurnReasoningInput {
  return resolveSurfaceTurnReasoningInput(surface, overrides).input;
}
