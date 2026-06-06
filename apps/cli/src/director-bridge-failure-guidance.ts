const DIRECTOR_BRIDGE_FAILURE_REASONS = new Set([
  "configuration_error",
  "network_error",
  "network_timeout",
  "http_error",
  "invalid_response",
  "policy_blocked",
]);

export interface DirectorBridgeFailureSurface {
  readonly reason: string;
  readonly retryable: boolean;
  readonly statusCode?: number;
}

export interface DirectorBridgeFailureGuidanceOptions {
  readonly retryAllowed?: boolean;
}

export function isDirectorBridgeFailureReason(reason: string): boolean {
  return DIRECTOR_BRIDGE_FAILURE_REASONS.has(reason);
}

export function describeDirectorBridgeFailureNextAction(
  failure: DirectorBridgeFailureSurface,
  options: DirectorBridgeFailureGuidanceOptions = {},
): string {
  if (failure.reason === "configuration_error") {
    return "fix the adapter bridge configuration before retrying.";
  }
  if (failure.reason === "policy_blocked") {
    return "inspect approval or policy settings before retrying.";
  }
  if (failure.reason === "invalid_response") {
    return "inspect the bridge response contract before re-running the assignment.";
  }
  if (
    failure.reason === "http_error" &&
    failure.statusCode !== undefined &&
    failure.statusCode < 500 &&
    failure.statusCode !== 429
  ) {
    return "inspect the remote bridge request and payload before re-running the assignment.";
  }
  if (failure.retryable && options.retryAllowed === false) {
    return "retry budget is exhausted; repair the route, reroute the adapter, or choose a failover path before re-running the assignment.";
  }
  if (failure.retryable) {
    return "review the failure and retry when the side-effect boundary is safe.";
  }
  return "inspect the remote bridge failure before re-running the assignment.";
}
