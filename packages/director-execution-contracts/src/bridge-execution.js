import { isArrayOfStrings, isBoolean, isObject, isOneOf, isOptional, isString } from "./guards.js";
export const EXECUTION_BRIDGE_KINDS = ["http-json"];
export const EXECUTION_BRIDGE_REQUEST_METHODS = ["POST"];
export const EXECUTION_BRIDGE_AUTH_MODES = ["none", "env", "static"];
export const EXECUTION_BRIDGE_FAILURE_REASONS = [
  "configuration_error",
  "network_error",
  "network_timeout",
  "http_error",
  "invalid_response",
  "policy_blocked",
];
function isPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
export function isExecutionBridgeRequestSnapshot(value) {
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
export function isExecutionBridgeResponseSnapshot(value) {
  return (
    isObject(value) &&
    isPositiveNumber(value.statusCode) &&
    isOptional(value.accepted, isBoolean) &&
    isOptional(value.requestId, isString) &&
    isOptional(value.bodyBytes, isPositiveNumber)
  );
}
export function isExecutionBridgeFailure(value) {
  return (
    isObject(value) &&
    isOneOf(value.reason, EXECUTION_BRIDGE_FAILURE_REASONS) &&
    isString(value.message) &&
    isBoolean(value.retryable) &&
    isOptional(value.statusCode, isPositiveNumber)
  );
}
export function isExecutionBridgeExecution(value) {
  return (
    isObject(value) &&
    isOneOf(value.kind, EXECUTION_BRIDGE_KINDS) &&
    isExecutionBridgeRequestSnapshot(value.request) &&
    isOptional(value.response, isExecutionBridgeResponseSnapshot) &&
    isOptional(value.failure, isExecutionBridgeFailure) &&
    (value.response !== undefined || value.failure !== undefined)
  );
}
