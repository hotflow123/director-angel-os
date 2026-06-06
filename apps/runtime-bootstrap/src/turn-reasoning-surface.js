export const SURFACE_TURN_REASONING_FIELD_KEYS = [
  "reasoningStrategy",
  "estimatedComplexity",
  "requiresTools",
  "latencyBudgetMs",
];
const CLI_WORKBENCH_REASONING_INPUT = {
  estimatedComplexity: "medium",
  requiresTools: true,
};
const GATEWAY_MESSAGE_REASONING_INPUT = {
  latencyBudgetMs: 1500,
};
function selectDefinedTurnReasoningFields(input = {}) {
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
export function resolveSurfaceTurnReasoningInput(surface, overrides = {}) {
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
export function createSurfaceTurnReasoningInput(surface, overrides = {}) {
  return resolveSurfaceTurnReasoningInput(surface, overrides).input;
}
