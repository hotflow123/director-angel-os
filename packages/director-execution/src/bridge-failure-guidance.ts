export interface ExecutionBridgeFailureGuidanceInput {
  readonly reason: string;
  readonly retryable: boolean;
  readonly statusCode?: number | undefined;
}

export interface ExecutionBridgeFailureGuidanceOptions {
  readonly retryAllowed?: boolean;
  readonly retriesUsed?: number;
  readonly retryLimit?: number;
}

export function describeExecutionBridgeFailureNextAction(
  failure: ExecutionBridgeFailureGuidanceInput,
  options: ExecutionBridgeFailureGuidanceOptions = {},
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

export function describeExecutionBridgeRetryConflict(
  assignmentId: string,
  failure: ExecutionBridgeFailureGuidanceInput,
  options: ExecutionBridgeFailureGuidanceOptions = {},
): string {
  if (failure.retryable && options.retryAllowed === false) {
    const retryLimit = options.retryLimit ?? 1;
    const retriesUsed = options.retriesUsed ?? retryLimit;
    return `Assignment ${assignmentId} exhausted the retry budget (${retriesUsed}/${retryLimit}) for ${describeRetryableBridgeFailure(failure)} and cannot be retried again until the route is repaired, rerouted, or a failover path is chosen.`;
  }
  if (failure.retryable) {
    return `Assignment ${assignmentId} can be retried through the normal retry path.`;
  }
  if (failure.reason === "configuration_error") {
    return `Assignment ${assignmentId} failed with configuration_error and cannot be retried until the adapter bridge configuration is fixed.`;
  }
  if (failure.reason === "policy_blocked") {
    return `Assignment ${assignmentId} is blocked by bridge policy and cannot be retried until approval or policy settings change.`;
  }
  if (failure.reason === "invalid_response") {
    return `Assignment ${assignmentId} failed with invalid_response and cannot be retried until the bridge response contract is fixed.`;
  }
  if (
    failure.reason === "http_error" &&
    failure.statusCode !== undefined &&
    failure.statusCode < 500 &&
    failure.statusCode !== 429
  ) {
    return `Assignment ${assignmentId} failed with non-retryable http_error status ${failure.statusCode} and cannot be retried until the remote request or payload is fixed.`;
  }
  return `Assignment ${assignmentId} failed with non-retryable bridge error ${failure.reason} and cannot be retried automatically.`;
}

function describeRetryableBridgeFailure(failure: ExecutionBridgeFailureGuidanceInput): string {
  if (failure.reason === "http_error" && failure.statusCode !== undefined) {
    return `retryable http_error status ${failure.statusCode}`;
  }
  return `retryable bridge error ${failure.reason}`;
}
