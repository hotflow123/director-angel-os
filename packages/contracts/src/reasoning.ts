import type { ContractErrorCode } from "./errors.js";
import type { ModelContract } from "./model.js";
import { CONTRACTS_SCHEMA_VERSION } from "./schema-version.js";
import type { TaskContract } from "./task.js";

export type ReasoningStrategy = "react" | "plan-execute";

export type EstimatedComplexity = "low" | "medium" | "high";

export type ReasoningActionType = "model" | "tool" | "final" | "abort" | "pause" | "delegate";

export interface ReasoningModelAction {
  readonly type: "model";
  readonly summary?: string;
  readonly preferredModelId?: string;
  readonly stream?: boolean;
}

export interface ReasoningToolAction {
  readonly type: "tool";
  readonly summary?: string;
  readonly toolName?: string;
}

export interface ReasoningFinalAction {
  readonly type: "final";
  readonly summary?: string;
  readonly finishReason?: "completed" | "handoff";
}

export interface ReasoningAbortAction {
  readonly type: "abort";
  readonly summary?: string;
  readonly errorCode?: ContractErrorCode;
  readonly retryable?: boolean;
}

export interface ReasoningPauseAction {
  readonly type: "pause";
  readonly summary?: string;
  readonly resumeAtMs?: number;
}

export interface ReasoningDelegateAction {
  readonly type: "delegate";
  readonly summary?: string;
  readonly assignee?: string;
  readonly delegatedTaskKind?: string;
}

export type ReasoningAction =
  | ReasoningModelAction
  | ReasoningToolAction
  | ReasoningFinalAction
  | ReasoningAbortAction
  | ReasoningPauseAction
  | ReasoningDelegateAction;

export type LegacyReasoningNextAction = "respond" | "call-tool" | "defer" | "abort";

export interface ReasoningDecisionInput {
  readonly task?: TaskContract;
  readonly model?: ModelContract;
  readonly requiresTools?: boolean;
  readonly estimatedComplexity?: EstimatedComplexity;
  readonly latencyBudgetMs?: number;
  readonly forceStrategy?: ReasoningStrategy;
}

export interface ReasoningStrategyDecision {
  readonly schemaVersion: typeof CONTRACTS_SCHEMA_VERSION;
  readonly strategy: ReasoningStrategy;
  readonly confidence: number;
  readonly rationale: string;
  readonly suggestedAction?: ReasoningAction;
}

export function toLegacyReasoningNextAction(action: ReasoningAction): LegacyReasoningNextAction {
  switch (action.type) {
    case "tool":
      return "call-tool";
    case "abort":
      return "abort";
    case "pause":
    case "delegate":
      return "defer";
    case "model":
    case "final":
      return "respond";
  }
}

function inferSuggestedAction(strategy: ReasoningStrategy): ReasoningAction {
  switch (strategy) {
    case "react":
      return {
        type: "model",
        summary: "react strategy selected",
      };
    case "plan-execute":
      return {
        type: "model",
        summary: "plan-execute strategy selected",
      };
  }
}

function clampConfidence(value: number): number {
  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

function inferComplexity(input: ReasoningDecisionInput): EstimatedComplexity {
  if (input.estimatedComplexity) {
    return input.estimatedComplexity;
  }

  if (!input.task) {
    return "medium";
  }

  if (input.task.priority === "urgent" || input.task.retries >= 2) {
    return "high";
  }

  if (input.task.priority === "low") {
    return "low";
  }

  return "medium";
}

export function decideReasoningStrategy(input: ReasoningDecisionInput): ReasoningStrategyDecision {
  if (input.forceStrategy) {
    const suggestedAction = inferSuggestedAction(input.forceStrategy);
    return {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      strategy: input.forceStrategy,
      confidence: 1,
      rationale: "forceStrategy was provided by caller",
      suggestedAction,
    };
  }

  if (input.task?.status === "blocked") {
    const strategy: ReasoningStrategy = "plan-execute";
    return {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      strategy,
      confidence: 0.82,
      rationale: "blocked work should pause cleanly inside an explicit plan/execute boundary",
      suggestedAction: {
        type: "pause",
        summary: "blocked task should pause for follow-up instead of forcing execution",
      },
    };
  }

  if (input.requiresTools) {
    const strategy: ReasoningStrategy = "plan-execute";
    return {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      strategy,
      confidence: 0.9,
      rationale: "tool-heavy work benefits from an explicit plan/execute turn strategy",
      suggestedAction: {
        type: "tool",
        summary: "plan-execute strategy selected for tool-heavy work",
      },
    };
  }

  const complexity = inferComplexity(input);
  const modelWindow = input.model?.contextWindow ?? 0;
  const latencyBudgetMs = input.latencyBudgetMs ?? Number.POSITIVE_INFINITY;

  if (complexity === "high") {
    const strategy: ReasoningStrategy = "plan-execute";
    return {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      strategy,
      confidence: clampConfidence(modelWindow >= 8000 ? 0.9 : 0.72),
      rationale:
        modelWindow >= 8000
          ? "high complexity with enough context window for plan-execute reasoning"
          : "high complexity but constrained context window still needs explicit plan/execute structure",
      suggestedAction: inferSuggestedAction(strategy),
    };
  }

  if (latencyBudgetMs <= 1500) {
    const strategy: ReasoningStrategy = "react";
    return {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      strategy,
      confidence: 0.84,
      rationale: "tight latency budget favors the lighter react turn strategy",
      suggestedAction: inferSuggestedAction(strategy),
    };
  }

  const strategy: ReasoningStrategy = "react";
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    strategy,
    confidence: 0.7,
    rationale: "default strategy for medium/low complexity paths",
    suggestedAction: inferSuggestedAction(strategy),
  };
}
