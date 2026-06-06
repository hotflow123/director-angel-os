import type { ContractError } from "./errors.js";
import type { ReasoningActionType } from "./reasoning.js";
import type { RuntimeMetadata } from "./runtime-context.js";

export type TurnRole = "user" | "assistant" | "system" | "tool";

export interface TurnMessage {
  readonly role: TurnRole;
  readonly content: string;
  readonly timestampMs: number;
}

export type TurnStepKind = "reasoning" | "model" | "tool" | "finalization" | "control";

export type TurnStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface TurnStepContract {
  readonly id: string;
  readonly index: number;
  readonly kind: TurnStepKind;
  readonly status: TurnStepStatus;
  readonly action?: ReasoningActionType;
  readonly summary?: string;
  readonly startedAtMs: number;
  readonly endedAtMs?: number;
  readonly modelInvocationId?: string;
  readonly toolCallId?: string;
  readonly metadata?: RuntimeMetadata;
  readonly error?: ContractError;
}

export interface TurnContract {
  readonly id: string;
  readonly sessionId: string;
  readonly index: number;
  readonly startedAtMs: number;
  readonly endedAtMs?: number;
  readonly currentStepId?: string;
  readonly steps?: readonly TurnStepContract[];
  readonly input: TurnMessage;
  readonly output?: TurnMessage;
}
