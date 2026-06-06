import type {
  ExecutionBridgeAuthMode,
  ExecutionBridgeExecution,
  ExecutionBridgeFailure,
  ExecutionBridgeResponseSnapshot,
} from "@hotflow/director-execution-contracts";

import type { HttpJsonExecutionBridgeTarget } from "./types.js";

export interface MaterializeHttpJsonBridgeSuccessInput {
  readonly target: HttpJsonExecutionBridgeTarget;
  readonly payloadBytes?: number;
  readonly response: ExecutionBridgeResponseSnapshot;
}

export interface MaterializeHttpJsonBridgeFailureInput {
  readonly target: HttpJsonExecutionBridgeTarget;
  readonly payloadBytes?: number;
  readonly failure: ExecutionBridgeFailure;
}

export function materializeHttpJsonBridgeSuccess(
  input: MaterializeHttpJsonBridgeSuccessInput,
): ExecutionBridgeExecution {
  return {
    kind: "http-json",
    request: buildHttpJsonBridgeRequestSnapshot(input.target, input.payloadBytes),
    response: input.response,
  };
}

export function materializeHttpJsonBridgeFailure(
  input: MaterializeHttpJsonBridgeFailureInput,
): ExecutionBridgeExecution {
  return {
    kind: "http-json",
    request: buildHttpJsonBridgeRequestSnapshot(input.target, input.payloadBytes),
    failure: input.failure,
  };
}

function buildHttpJsonBridgeRequestSnapshot(
  target: HttpJsonExecutionBridgeTarget,
  payloadBytes: number | undefined,
): ExecutionBridgeExecution["request"] {
  const url = new URL(target.submitPath, target.baseUrl);

  return {
    endpointOrigin: url.origin,
    endpointPath: url.pathname,
    method: "POST",
    timeoutMs: target.timeoutMs,
    authMode: resolveAuthMode(target),
    ...(buildHeaderKeys(target.headers).length === 0
      ? {}
      : { headerKeys: buildHeaderKeys(target.headers) }),
    ...(payloadBytes === undefined ? {} : { payloadBytes }),
  };
}

function resolveAuthMode(target: HttpJsonExecutionBridgeTarget): ExecutionBridgeAuthMode {
  if (target.authEnvVar !== undefined) {
    return "env";
  }
  if (target.headers && Object.keys(target.headers).length > 0) {
    return "static";
  }
  return "none";
}

function buildHeaderKeys(headers: Readonly<Record<string, string>> | undefined): string[] {
  if (headers === undefined) {
    return [];
  }
  return Object.keys(headers).sort((left, right) => left.localeCompare(right));
}
