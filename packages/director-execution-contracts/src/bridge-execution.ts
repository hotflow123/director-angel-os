import { isArrayOfStrings, isBoolean, isObject, isOneOf, isOptional, isString } from "./guards.js";

export const EXECUTION_BRIDGE_KINDS = ["http-json"] as const;
export const EXECUTION_BRIDGE_REQUEST_METHODS = ["POST"] as const;
export const EXECUTION_BRIDGE_AUTH_MODES = ["none", "env", "static"] as const;
export const EXECUTION_BRIDGE_FAILURE_REASONS = [
  "configuration_error",
  "network_error",
  "network_timeout",
  "http_error",
  "invalid_response",
  "policy_blocked",
] as const;

export type ExecutionBridgeKind = (typeof EXECUTION_BRIDGE_KINDS)[number];
export type ExecutionBridgeRequestMethod = (typeof EXECUTION_BRIDGE_REQUEST_METHODS)[number];
export type ExecutionBridgeAuthMode = (typeof EXECUTION_BRIDGE_AUTH_MODES)[number];
export type ExecutionBridgeFailureReason = (typeof EXECUTION_BRIDGE_FAILURE_REASONS)[number];

export interface ExecutionBridgeRequestSnapshot {
  readonly endpointOrigin: string;
  readonly endpointPath: string;
  readonly method: ExecutionBridgeRequestMethod;
  readonly timeoutMs: number;
  readonly authMode: ExecutionBridgeAuthMode;
  readonly headerKeys?: readonly string[];
  readonly payloadBytes?: number;
}

export interface ExecutionBridgeResponseSnapshot {
  readonly statusCode: number;
  readonly accepted?: boolean;
  readonly requestId?: string;
  readonly bodyBytes?: number;
}

export interface ExecutionBridgeFailure {
  readonly reason: ExecutionBridgeFailureReason;
  readonly message: string;
  readonly retryable: boolean;
  readonly statusCode?: number;
}

export interface ExecutionBridgeExecution {
  readonly kind: ExecutionBridgeKind;
  readonly request: ExecutionBridgeRequestSnapshot;
  readonly response?: ExecutionBridgeResponseSnapshot;
  readonly failure?: ExecutionBridgeFailure;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isExecutionBridgeRequestSnapshot(
  value: unknown,
): value is ExecutionBridgeRequestSnapshot {
  return (
    isObject(value) &&
    isString(value.endpointOrigin) &&
    isString(value.endpointPath) &&
    isOneOf(value.method, EXECUTION_BRIDGE_REQUEST_METHODS) &&
    isPositiveNumber(value.timeoutMs) &&
    isOneOf(value.authMode, EXECUTION_BRIDGE_AUTH_MODES) &&
    isOptional(value.headerKeys, isArrayOfStrings) &&
    isOptional(value.payloadBytes, isPositiveNumber)
  );
}

export function isExecutionBridgeResponseSnapshot(
  value: unknown,
): value is ExecutionBridgeResponseSnapshot {
  return (
    isObject(value) &&
    isPositiveNumber(value.statusCode) &&
    isOptional(value.accepted, isBoolean) &&
    isOptional(value.requestId, isString) &&
    isOptional(value.bodyBytes, isPositiveNumber)
  );
}

export function isExecutionBridgeFailure(value: unknown): value is ExecutionBridgeFailure {
  return (
    isObject(value) &&
    isOneOf(value.reason, EXECUTION_BRIDGE_FAILURE_REASONS) &&
    isString(value.message) &&
    isBoolean(value.retryable) &&
    isOptional(value.statusCode, isPositiveNumber)
  );
}

export function isExecutionBridgeExecution(value: unknown): value is ExecutionBridgeExecution {
  return (
    isObject(value) &&
    isOneOf(value.kind, EXECUTION_BRIDGE_KINDS) &&
    isExecutionBridgeRequestSnapshot(value.request) &&
    isOptional(value.response, isExecutionBridgeResponseSnapshot) &&
    isOptional(value.failure, isExecutionBridgeFailure) &&
    (value.response !== undefined || value.failure !== undefined)
  );
}
