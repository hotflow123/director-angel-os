import type { ModelProviderRuntimeFailureSurface } from "@hotflow/models";

export interface EngineRunFailureInput {
  readonly sessionId: string;
  readonly turnId: string;
  readonly model: string;
  readonly selectedProviderId: string;
  readonly failure: ModelProviderRuntimeFailureSurface;
}

export class EngineRunFailure extends Error {
  public readonly sessionId: string;
  public readonly turnId: string;
  public readonly model: string;
  public readonly selectedProviderId: string;
  public readonly failure: ModelProviderRuntimeFailureSurface;

  public constructor(input: EngineRunFailureInput, cause?: unknown) {
    super(input.failure.error.message, { cause });
    this.name = "EngineRunFailure";
    this.sessionId = input.sessionId;
    this.turnId = input.turnId;
    this.model = input.model;
    this.selectedProviderId = input.selectedProviderId;
    this.failure = input.failure;
  }
}

export function isEngineRunFailure(error: unknown): error is EngineRunFailure {
  return error instanceof EngineRunFailure;
}
