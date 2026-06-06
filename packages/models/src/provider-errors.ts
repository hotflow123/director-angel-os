import {
  type RuntimeErrorSurface,
  createContractError,
  createRuntimeErrorSurface,
} from "@hotflow/contracts";

export type ModelProviderFailureCode =
  | "HTTP_401"
  | "HTTP_402"
  | "HTTP_429"
  | "HTTP_5XX"
  | "HTTP_4XX"
  | "NETWORK_ERROR"
  | "UNKNOWN_ERROR";

export type ModelProviderFailureClass = "transient" | "fatal";

export interface ModelProviderFailureSurface {
  readonly providerId: string;
  readonly stage: "generate" | "stream";
  readonly code: ModelProviderFailureCode;
  readonly message: string;
  readonly statusCode?: number;
  readonly retryable: boolean;
}

export interface ModelProviderRuntimeFailureSurface extends RuntimeErrorSurface {
  readonly providerId: string;
  readonly providerStage: "generate" | "stream";
  readonly providerCode: ModelProviderFailureCode;
  readonly failureClass: ModelProviderFailureClass;
  readonly retryable: boolean;
  readonly statusCode?: number;
}

export interface ModelProviderUnhealthyState {
  readonly providerId: string;
  readonly unhealthyUntilMs: number;
  readonly reason?: string;
}

export interface ModelProviderFallbackPlanInput {
  readonly requestedProviderId: string;
  readonly fallbackProviderIds?: readonly string[];
  readonly nowMs?: number;
  readonly unhealthyProviders?: Readonly<Record<string, ModelProviderUnhealthyState>>;
  readonly lastFailure?: unknown;
  readonly unhealthyTtlMs?: number;
}

export interface ModelProviderFallbackAttempt {
  readonly index: number;
  readonly providerId: string;
  readonly role: "requested" | "fallback";
  readonly status: "ready" | "blocked" | "skipped";
  readonly reasonCodes: readonly string[];
  readonly unhealthyUntilMs?: number;
}

export interface ModelProviderFallbackFailurePlan {
  readonly providerId: string;
  readonly stage: "generate" | "stream";
  readonly code: ModelProviderFailureCode;
  readonly message: string;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly failureClass: ModelProviderFailureClass;
  readonly unhealthyUntilMs?: number;
}

export interface ModelProviderFallbackPlan {
  readonly schemaVersion: "models.provider-fallback-plan.v1";
  readonly status: "ready" | "blocked";
  readonly requestedProviderId: string;
  readonly attempts: readonly ModelProviderFallbackAttempt[];
  readonly selectedProviderId: string | undefined;
  readonly selectedAttemptIndex: number | undefined;
  readonly usedFallback: boolean;
  readonly unhealthyTtlMs: number;
  readonly failure?: ModelProviderFallbackFailurePlan;
  readonly reasonCodes: readonly string[];
  readonly nextActions: readonly string[];
}

export class ModelProviderError extends Error {
  public readonly providerId: string;
  public readonly stage: "generate" | "stream";
  public readonly code: ModelProviderFailureCode;
  public readonly statusCode?: number;
  public readonly retryable: boolean;

  public constructor(input: ModelProviderFailureSurface) {
    super(input.message);
    this.name = "ModelProviderError";
    this.providerId = input.providerId;
    this.stage = input.stage;
    this.code = input.code;
    if (input.statusCode !== undefined) {
      this.statusCode = input.statusCode;
    }
    this.retryable = input.retryable;
  }
}

function classifyHttpStatus(statusCode: number): {
  readonly code: ModelProviderFailureCode;
  readonly retryable: boolean;
} {
  if (statusCode === 401 || statusCode === 403) {
    return { code: "HTTP_401", retryable: false };
  }
  if (statusCode === 402) {
    return { code: "HTTP_402", retryable: false };
  }
  if (statusCode === 429) {
    return { code: "HTTP_429", retryable: true };
  }
  if (statusCode >= 500) {
    return { code: "HTTP_5XX", retryable: true };
  }
  if (statusCode >= 400) {
    return { code: "HTTP_4XX", retryable: false };
  }
  return { code: "UNKNOWN_ERROR", retryable: false };
}

export function createHttpModelProviderError(input: {
  readonly providerId: string;
  readonly stage: "generate" | "stream";
  readonly statusCode: number;
  readonly message?: string;
}): ModelProviderError {
  const classification = classifyHttpStatus(input.statusCode);
  return new ModelProviderError({
    providerId: input.providerId,
    stage: input.stage,
    code: classification.code,
    statusCode: input.statusCode,
    retryable: classification.retryable,
    message: input.message ?? `provider request failed with status ${input.statusCode}`,
  });
}

export function createNetworkModelProviderError(input: {
  readonly providerId: string;
  readonly stage: "generate" | "stream";
  readonly message: string;
}): ModelProviderError {
  return new ModelProviderError({
    providerId: input.providerId,
    stage: input.stage,
    code: "NETWORK_ERROR",
    retryable: true,
    message: input.message,
  });
}

export function toModelProviderFailureSurface(error: unknown): ModelProviderFailureSurface {
  if (error instanceof ModelProviderError) {
    return {
      providerId: error.providerId,
      stage: error.stage,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.statusCode !== undefined ? { statusCode: error.statusCode } : {}),
    };
  }
  if (error instanceof Error) {
    return {
      providerId: "unknown",
      stage: "generate",
      code: "UNKNOWN_ERROR",
      message: error.message,
      retryable: false,
    };
  }
  return {
    providerId: "unknown",
    stage: "generate",
    code: "UNKNOWN_ERROR",
    message: String(error),
    retryable: false,
  };
}

export function classifyModelProviderFailure(
  surface: Pick<ModelProviderFailureSurface, "retryable">,
): ModelProviderFailureClass {
  return surface.retryable ? "transient" : "fatal";
}

export function toModelProviderRuntimeFailureSurface(
  error: unknown,
): ModelProviderRuntimeFailureSurface {
  const failure = toModelProviderFailureSurface(error);
  const failureClass = classifyModelProviderFailure(failure);
  const kind = failureClass === "transient" ? "provider-transient" : "provider-fatal";
  const action = failureClass === "transient" ? "failover" : "abort";
  const stage = failure.stage === "stream" ? "stream" : "model";
  const operatorVisible = failureClass === "fatal";
  const contractError = createContractError({
    code: failureClass === "transient" ? "PROVIDER_TRANSIENT_ERROR" : "PROVIDER_FATAL_ERROR",
    message: failure.message,
    retryable: failure.retryable,
    kind,
    defaultAction: action,
    metadata: {
      stage,
      kind,
      action,
      recoverable: failure.retryable,
      operatorVisible,
      providerId: failure.providerId,
      providerStage: failure.stage,
      providerCode: failure.code,
      ...(failure.statusCode !== undefined ? { statusCode: failure.statusCode } : {}),
    },
  });
  const runtimeFailure = createRuntimeErrorSurface({
    stage,
    kind,
    action,
    error: contractError,
    recoverable: failure.retryable,
    operatorVisible,
  });

  return {
    ...runtimeFailure,
    providerId: failure.providerId,
    providerStage: failure.stage,
    providerCode: failure.code,
    failureClass,
    retryable: failure.retryable,
    ...(failure.statusCode !== undefined ? { statusCode: failure.statusCode } : {}),
  };
}

export function planModelProviderFallback(
  input: ModelProviderFallbackPlanInput,
): ModelProviderFallbackPlan {
  const nowMs = input.nowMs ?? Date.now();
  const unhealthyTtlMs = normalizeUnhealthyTtlMs(input.unhealthyTtlMs);
  const providerIds = createOrderedProviderFallbackIds(input);
  const failureSurface =
    input.lastFailure === undefined ? undefined : toModelProviderFailureSurface(input.lastFailure);
  const failureClass =
    failureSurface === undefined ? undefined : classifyModelProviderFailure(failureSurface);
  const failurePlan =
    failureSurface === undefined
      ? undefined
      : createModelProviderFallbackFailurePlan({
          failure: failureSurface,
          failureClass: failureClass ?? "fatal",
          nowMs,
          unhealthyTtlMs,
        });
  const attempts = providerIds.map((providerId, index) =>
    createModelProviderFallbackAttempt({
      providerId,
      index,
      requestedProviderId: input.requestedProviderId,
      unhealthyState: input.unhealthyProviders?.[providerId],
      nowMs,
      failurePlan,
      failureClass,
    }),
  );
  const fatalFailure = failureClass === "fatal";
  const selectedAttempt = fatalFailure
    ? undefined
    : attempts.find((attempt) => attempt.status === "ready");
  const reasonCodes = createModelProviderFallbackReasonCodes({
    attempts,
    selectedAttempt,
    failurePlan,
    failureClass,
  });
  const status = selectedAttempt === undefined ? "blocked" : "ready";
  return {
    schemaVersion: "models.provider-fallback-plan.v1",
    status,
    requestedProviderId: input.requestedProviderId,
    attempts,
    selectedProviderId: selectedAttempt?.providerId,
    selectedAttemptIndex: selectedAttempt?.index,
    usedFallback: selectedAttempt !== undefined && selectedAttempt.index > 0,
    unhealthyTtlMs,
    ...(failurePlan === undefined ? {} : { failure: failurePlan }),
    reasonCodes,
    nextActions: createModelProviderFallbackNextActions({ status, failurePlan, attempts }),
  };
}

function createOrderedProviderFallbackIds(
  input: ModelProviderFallbackPlanInput,
): readonly string[] {
  const ids: string[] = [];
  for (const id of [input.requestedProviderId, ...(input.fallbackProviderIds ?? [])]) {
    const normalized = id.trim();
    if (normalized.length === 0 || ids.includes(normalized)) {
      continue;
    }
    ids.push(normalized);
  }
  return ids;
}

function createModelProviderFallbackFailurePlan(input: {
  readonly failure: ModelProviderFailureSurface;
  readonly failureClass: ModelProviderFailureClass;
  readonly nowMs: number;
  readonly unhealthyTtlMs: number;
}): ModelProviderFallbackFailurePlan {
  return {
    providerId: input.failure.providerId,
    stage: input.failure.stage,
    code: input.failure.code,
    message: redactProviderFailureMessage(input.failure.message),
    ...(input.failure.statusCode === undefined ? {} : { statusCode: input.failure.statusCode }),
    retryable: input.failure.retryable,
    failureClass: input.failureClass,
    ...(input.failureClass === "transient"
      ? { unhealthyUntilMs: input.nowMs + input.unhealthyTtlMs }
      : {}),
  };
}

function createModelProviderFallbackAttempt(input: {
  readonly providerId: string;
  readonly index: number;
  readonly requestedProviderId: string;
  readonly unhealthyState: ModelProviderUnhealthyState | undefined;
  readonly nowMs: number;
  readonly failurePlan: ModelProviderFallbackFailurePlan | undefined;
  readonly failureClass: ModelProviderFailureClass | undefined;
}): ModelProviderFallbackAttempt {
  const role = input.index === 0 ? "requested" : "fallback";
  const reasonCodes: string[] = [];
  const unhealthyUntilMs =
    input.unhealthyState !== undefined && input.unhealthyState.unhealthyUntilMs > input.nowMs
      ? input.unhealthyState.unhealthyUntilMs
      : undefined;
  if (input.failurePlan?.providerId === input.providerId && input.failureClass === "transient") {
    reasonCodes.push("current_failure_provider_unhealthy");
    return {
      index: input.index,
      providerId: input.providerId,
      role,
      status: "blocked",
      reasonCodes,
      ...(input.failurePlan.unhealthyUntilMs === undefined
        ? {}
        : { unhealthyUntilMs: input.failurePlan.unhealthyUntilMs }),
    };
  }
  if (input.failurePlan?.providerId === input.providerId && input.failureClass === "fatal") {
    reasonCodes.push("current_failure_provider_fatal");
    return {
      index: input.index,
      providerId: input.providerId,
      role,
      status: "blocked",
      reasonCodes,
    };
  }
  if (unhealthyUntilMs !== undefined) {
    reasonCodes.push("provider_unhealthy_ttl_active");
    return {
      index: input.index,
      providerId: input.providerId,
      role,
      status: "skipped",
      reasonCodes,
      unhealthyUntilMs,
    };
  }
  reasonCodes.push("provider_candidate_ready");
  return {
    index: input.index,
    providerId: input.providerId,
    role,
    status: "ready",
    reasonCodes,
  };
}

function createModelProviderFallbackReasonCodes(input: {
  readonly attempts: readonly ModelProviderFallbackAttempt[];
  readonly selectedAttempt: ModelProviderFallbackAttempt | undefined;
  readonly failurePlan: ModelProviderFallbackFailurePlan | undefined;
  readonly failureClass: ModelProviderFailureClass | undefined;
}): readonly string[] {
  const codes = new Set<string>();
  if (input.failureClass === "transient") {
    codes.add("provider_failure_transient");
    codes.add("requested_provider_marked_unhealthy");
  }
  if (input.failureClass === "fatal") {
    codes.add("provider_failure_fatal");
  }
  if (input.failurePlan?.code === "HTTP_402") {
    codes.add("payment_required");
  }
  if (input.failurePlan?.code === "HTTP_401") {
    codes.add("auth_failed");
  }
  if (input.attempts.some((attempt) => attempt.status === "skipped")) {
    codes.add("skipped_unhealthy_provider");
  }
  if (input.selectedAttempt === undefined) {
    codes.add("no_provider_selected");
  } else if (input.selectedAttempt.index > 0) {
    codes.add("selected_fallback_provider");
  } else {
    codes.add("selected_requested_provider");
  }
  return [...codes];
}

function createModelProviderFallbackNextActions(input: {
  readonly status: "ready" | "blocked";
  readonly failurePlan: ModelProviderFallbackFailurePlan | undefined;
  readonly attempts: readonly ModelProviderFallbackAttempt[];
}): readonly string[] {
  if (input.status === "ready") {
    return ["invoke the selected provider and keep the fallback attempt trace"];
  }
  const actions = new Set<string>();
  if (input.failurePlan?.code === "HTTP_402") {
    actions.add("resolve provider billing or choose a different requested provider explicitly");
  }
  if (input.failurePlan?.code === "HTTP_401") {
    actions.add("fix provider credentials before retrying this provider chain");
  }
  if (input.attempts.some((attempt) => attempt.status === "skipped")) {
    actions.add("wait for unhealthy provider TTL to expire or choose a different provider chain");
  }
  if (actions.size === 0) {
    actions.add("configure at least one healthy fallback provider before retrying");
  }
  return [...actions];
}

function normalizeUnhealthyTtlMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 60_000;
  }
  return Math.max(1_000, Math.trunc(value));
}

function redactProviderFailureMessage(message: string): string {
  return message.replace(/\bsk-[A-Za-z0-9_-]{4,}\b/gu, "[redacted-secret]");
}
