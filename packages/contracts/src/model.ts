export type ModelProvider = "openai" | "anthropic" | "google" | "meta" | "xai" | "custom";

export type ReasoningEffort = "low" | "medium" | "high";

export interface ModelContract {
  readonly id: string;
  readonly provider: ModelProvider;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly supportsTools: boolean;
  readonly supportsStreaming: boolean;
  readonly inputCostPer1kUsd?: number;
  readonly outputCostPer1kUsd?: number;
}

export interface ModelInvocationContract {
  readonly invocationId: string;
  readonly taskId?: string;
  readonly model: ModelContract;
  readonly reasoningEffort?: ReasoningEffort;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly latencyMs?: number;
}
