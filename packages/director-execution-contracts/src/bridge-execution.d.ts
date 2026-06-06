export declare const EXECUTION_BRIDGE_KINDS: readonly ["http-json"];
export declare const EXECUTION_BRIDGE_REQUEST_METHODS: readonly ["POST"];
export declare const EXECUTION_BRIDGE_AUTH_MODES: readonly ["none", "env", "static"];
export declare const EXECUTION_BRIDGE_FAILURE_REASONS: readonly [
  "configuration_error",
  "network_error",
  "network_timeout",
  "http_error",
  "invalid_response",
  "policy_blocked",
];
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
export declare function isExecutionBridgeRequestSnapshot(
  value: unknown,
): value is ExecutionBridgeRequestSnapshot;
export declare function isExecutionBridgeResponseSnapshot(
  value: unknown,
): value is ExecutionBridgeResponseSnapshot;
export declare function isExecutionBridgeFailure(value: unknown): value is ExecutionBridgeFailure;
export declare function isExecutionBridgeExecution(
  value: unknown,
): value is ExecutionBridgeExecution;
