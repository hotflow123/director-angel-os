export type ContractErrorCode =
  | "USER_ERROR"
  | "POLICY_ERROR"
  | "PROVIDER_TRANSIENT_ERROR"
  | "PROVIDER_FATAL_ERROR"
  | "MEMORY_DEGRADED"
  | "INTERNAL_INVARIANT_ERROR"
  | "INVALID_CONTEXT"
  | "INVALID_EVENT"
  | "INVALID_STREAM_EVENT"
  | "ABORTED"
  | "DEGRADED_MODE"
  | "MODEL_FAILURE"
  | "TOOL_FAILURE"
  | "VALIDATION_FAILURE"
  | "UNKNOWN";

export type RuntimeStage = "reasoning" | "model" | "tool" | "policy" | "stream" | "runtime";

export type RuntimeFailureKind =
  | "user"
  | "policy"
  | "tool"
  | "provider-transient"
  | "provider-fatal"
  | "memory-degrade"
  | "internal-invariant";

export type RuntimeRecoveryAction = "retry" | "failover" | "degrade" | "abort";

export type RuntimeDegradeSeverity = "minor" | "major";

export type RuntimeDegradeCategory = "tool" | "policy" | "memory" | "provider" | "runtime";

export type RuntimeDegradeReason =
  | "tool-unavailable"
  | "model-limited"
  | "policy-restricted"
  | "latency-budget"
  | "context-pressure"
  | "fallback";

export interface ContractErrorOptions {
  readonly code: ContractErrorCode;
  readonly message: string;
  readonly retryable?: boolean;
  readonly kind?: RuntimeFailureKind;
  readonly defaultAction?: RuntimeRecoveryAction;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export interface RuntimeErrorSurface {
  readonly stage: RuntimeStage;
  readonly kind: RuntimeFailureKind;
  readonly action: RuntimeRecoveryAction;
  readonly error: ContractError;
  readonly recoverable: boolean;
  readonly operatorVisible?: boolean;
}

export interface RuntimeDegradeSurface {
  readonly stage: RuntimeStage;
  readonly category: RuntimeDegradeCategory;
  readonly action: "degrade";
  readonly severity: RuntimeDegradeSeverity;
  readonly reason: RuntimeDegradeReason;
  readonly message: string;
  readonly recoverable: boolean;
  readonly error?: ContractError;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export class ContractError extends Error {
  readonly code: ContractErrorCode;
  readonly retryable: boolean;
  readonly kind: RuntimeFailureKind;
  readonly defaultAction: RuntimeRecoveryAction;
  readonly metadata: Readonly<Record<string, unknown>> | undefined;

  constructor(options: ContractErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "ContractError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.kind = options.kind ?? resolveRuntimeFailureKindForCode(options.code);
    this.defaultAction = options.defaultAction ?? resolveRuntimeRecoveryActionForKind(this.kind);
    this.metadata = options.metadata;
  }
}

const ERROR_KIND_BY_CODE: Readonly<Record<ContractErrorCode, RuntimeFailureKind>> = {
  USER_ERROR: "user",
  POLICY_ERROR: "policy",
  PROVIDER_TRANSIENT_ERROR: "provider-transient",
  PROVIDER_FATAL_ERROR: "provider-fatal",
  MEMORY_DEGRADED: "memory-degrade",
  INTERNAL_INVARIANT_ERROR: "internal-invariant",
  INVALID_CONTEXT: "internal-invariant",
  INVALID_EVENT: "internal-invariant",
  INVALID_STREAM_EVENT: "internal-invariant",
  ABORTED: "internal-invariant",
  DEGRADED_MODE: "memory-degrade",
  MODEL_FAILURE: "provider-fatal",
  TOOL_FAILURE: "tool",
  VALIDATION_FAILURE: "user",
  UNKNOWN: "internal-invariant",
};

const ACTION_BY_KIND: Readonly<Record<RuntimeFailureKind, RuntimeRecoveryAction>> = {
  user: "abort",
  policy: "abort",
  tool: "abort",
  "provider-transient": "failover",
  "provider-fatal": "abort",
  "memory-degrade": "degrade",
  "internal-invariant": "abort",
};

export function isContractError(error: unknown): error is ContractError {
  return error instanceof ContractError;
}

export function resolveRuntimeFailureKindForCode(code: ContractErrorCode): RuntimeFailureKind {
  return ERROR_KIND_BY_CODE[code];
}

export function resolveRuntimeRecoveryActionForKind(
  kind: RuntimeFailureKind,
): RuntimeRecoveryAction {
  return ACTION_BY_KIND[kind];
}

export function createContractError(options: ContractErrorOptions): ContractError {
  return new ContractError(options);
}

export function createRuntimeErrorSurface(input: {
  readonly stage: RuntimeStage;
  readonly error: ContractError;
  readonly recoverable?: boolean;
  readonly kind?: RuntimeFailureKind;
  readonly action?: RuntimeRecoveryAction;
  readonly operatorVisible?: boolean;
}): RuntimeErrorSurface {
  const kind = input.kind ?? input.error.kind;
  const action = input.action ?? input.error.defaultAction;
  return {
    stage: input.stage,
    kind,
    action,
    error: input.error,
    recoverable: input.recoverable ?? input.error.retryable,
    ...(input.operatorVisible === undefined ? {} : { operatorVisible: input.operatorVisible }),
  };
}

export function createRuntimeDegradeSurface(input: {
  readonly stage: RuntimeStage;
  readonly category: RuntimeDegradeCategory;
  readonly severity: RuntimeDegradeSeverity;
  readonly reason: RuntimeDegradeReason;
  readonly message: string;
  readonly recoverable: boolean;
  readonly error?: ContractError;
  readonly metadata?: Readonly<Record<string, unknown>>;
}): RuntimeDegradeSurface {
  return {
    stage: input.stage,
    category: input.category,
    action: "degrade",
    severity: input.severity,
    reason: input.reason,
    message: input.message,
    recoverable: input.recoverable,
    ...(input.error === undefined ? {} : { error: input.error }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

export function toContractError(
  error: unknown,
  fallbackCode: ContractErrorCode = "UNKNOWN",
): ContractError {
  if (isContractError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return createContractError({
      code: fallbackCode,
      message: error.message,
      cause: error,
    });
  }

  return createContractError({
    code: fallbackCode,
    message: "Unknown contract error",
    metadata: { error },
  });
}
