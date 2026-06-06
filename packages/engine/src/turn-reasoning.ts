import type { PromptSection } from "@hotflow/context";
import { type ReasoningStrategyDecision, decideReasoningStrategy } from "@hotflow/contracts";

import type { TurnInput } from "./types.js";

export interface TurnReasoningSelectionInput {
  readonly reasoningStrategy?: TurnInput["reasoningStrategy"];
  readonly estimatedComplexity?: TurnInput["estimatedComplexity"];
  readonly requiresTools?: TurnInput["requiresTools"];
  readonly latencyBudgetMs?: TurnInput["latencyBudgetMs"];
}

export interface TurnReasoningSelection {
  readonly decision: ReasoningStrategyDecision;
  readonly promptSection: PromptSection;
  readonly summary: string;
}

export function resolveTurnReasoningSelection(
  input: TurnReasoningSelectionInput,
): TurnReasoningSelection | undefined {
  const strategySurfaceRequested =
    input.reasoningStrategy !== undefined ||
    input.requiresTools !== undefined ||
    input.estimatedComplexity !== undefined ||
    input.latencyBudgetMs !== undefined;

  if (!strategySurfaceRequested) {
    return undefined;
  }

  const decision = decideReasoningStrategy({
    ...(input.reasoningStrategy === undefined ? {} : { forceStrategy: input.reasoningStrategy }),
    ...(input.requiresTools === undefined ? {} : { requiresTools: input.requiresTools }),
    ...(input.estimatedComplexity === undefined
      ? {}
      : { estimatedComplexity: input.estimatedComplexity }),
    ...(input.latencyBudgetMs === undefined ? {} : { latencyBudgetMs: input.latencyBudgetMs }),
  });

  return {
    decision,
    promptSection: createTurnReasoningPromptSection(decision),
    summary: `Selected ${decision.strategy} reasoning strategy (${decision.rationale}).`,
  };
}

function createTurnReasoningPromptSection(decision: ReasoningStrategyDecision): PromptSection {
  const operatingModeLines =
    decision.strategy === "plan-execute"
      ? [
          "- Start with a short explicit plan before execution.",
          "- Keep planning, tool use, and synthesis visibly separated.",
          "- Prefer bounded execution steps and then summarize from evidence.",
        ]
      : [
          "- Keep reasoning lightweight and inline with the turn.",
          "- Use tools only when they materially advance the current step.",
          "- Once enough evidence exists, answer directly without adding ceremony.",
        ];

  return {
    id: "runtime.reasoning-strategy",
    owner: "runtime",
    cacheBucket: "dynamic",
    priority: 72,
    metadata: {
      strategy: decision.strategy,
      confidence: decision.confidence,
      ...(decision.suggestedAction === undefined
        ? {}
        : { suggestedAction: decision.suggestedAction.type }),
    },
    content: [
      "## runtime.reasoning-strategy",
      `Reasoning strategy: ${decision.strategy}`,
      `Rationale: ${decision.rationale}`,
      "Operating mode:",
      ...operatingModeLines,
    ].join("\n"),
  };
}
