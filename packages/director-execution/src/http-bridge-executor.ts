import type {
  AssignmentResult,
  AssignmentRun,
  ExecutionBridgeFailure,
} from "@hotflow/director-execution-contracts";

import { materializeHttpJsonBridgeFailure, materializeHttpJsonBridgeSuccess } from "./bridge.js";
import type { HttpJsonExecutionBridgeTarget } from "./types.js";

export const DIRECTOR_HTTP_JSON_BRIDGE_REQUEST_SCHEMA_ID =
  "director.execution.http-json-request.v1" as const;

export interface ExecuteHttpJsonBridgeAssignmentOptions {
  readonly workerId: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
}

interface HttpJsonBridgeRequestEnvelope {
  readonly schemaId: typeof DIRECTOR_HTTP_JSON_BRIDGE_REQUEST_SCHEMA_ID;
  readonly runId: string;
  readonly assignmentId: string;
  readonly workerId: string;
  readonly adapterId: string;
  readonly provider: string;
  readonly role: AssignmentRun["role"];
  readonly actionClass: AssignmentRun["actionClass"];
  readonly approvalMode: AssignmentRun["approvalMode"];
  readonly objective: string;
  readonly deliverable: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly constraints: AssignmentRun["constraints"];
  readonly dependsOn: readonly string[];
}

interface ParsedBridgeResponseEnvelope {
  readonly accepted?: boolean;
  readonly requestId?: string;
}

export async function executeAssignmentViaHttpJsonBridge(
  assignment: AssignmentRun,
  target: HttpJsonExecutionBridgeTarget,
  options: ExecuteHttpJsonBridgeAssignmentOptions,
): Promise<AssignmentResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const recordedAt = now();
  const envelope = buildRequestEnvelope(assignment, target, options.workerId);
  const serializedEnvelope = JSON.stringify(envelope);
  const payloadBytes = Buffer.byteLength(serializedEnvelope, "utf8");

  const credential = resolveBridgeCredential(target, options.env ?? process.env);
  if (credential === null) {
    return buildBridgeFailureResult(
      assignment,
      target,
      recordedAt,
      payloadBytes,
      options.workerId,
      {
        reason: "configuration_error",
        message: "Bridge credential is not configured.",
        retryable: false,
      },
      `Bridge could not start ${assignment.role} assignment "${assignment.assignmentId}" via ${target.adapterId}.`,
    );
  }

  const headers = buildRequestHeaders(target, credential);
  const url = new URL(target.submitPath, target.baseUrl);
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), target.timeoutMs);

  try {
    const response = await fetchImplementation(url, {
      method: "POST",
      headers,
      body: serializedEnvelope,
      signal: timeoutController.signal,
    });
    const responseBodyText = await response.text();
    const bodyBytes = Buffer.byteLength(responseBodyText, "utf8");
    const parsedBody = parseResponseEnvelope(responseBodyText);
    const requestId = readRequestId(response, parsedBody.envelope);

    if (response.ok && parsedBody.status === "invalid") {
      return buildBridgeFailureResult(
        assignment,
        target,
        recordedAt,
        payloadBytes,
        options.workerId,
        {
          reason: "invalid_response",
          message: "Bridge response was not valid JSON.",
          retryable: false,
          statusCode: response.status,
        },
        `Bridge returned an invalid response for assignment "${assignment.assignmentId}" via ${target.adapterId}.`,
        {
          statusCode: response.status,
          bodyBytes,
        },
      );
    }

    const responseSnapshot = {
      statusCode: response.status,
      ...(parsedBody.envelope?.accepted === undefined
        ? { accepted: response.ok }
        : { accepted: parsedBody.envelope.accepted }),
      ...(requestId === undefined ? {} : { requestId }),
      ...(bodyBytes === 0 ? {} : { bodyBytes }),
    };

    if (!response.ok) {
      return buildBridgeFailureResult(
        assignment,
        target,
        recordedAt,
        payloadBytes,
        options.workerId,
        {
          reason: "http_error",
          message: `Bridge request returned HTTP ${response.status}.`,
          retryable: response.status >= 500 || response.status === 429,
          statusCode: response.status,
        },
        `Bridge request failed ${assignment.role} assignment "${assignment.assignmentId}" via ${target.adapterId}.`,
        responseSnapshot,
      );
    }

    return {
      runId: assignment.runId,
      assignmentId: assignment.assignmentId,
      status: "completed",
      recordedAt,
      workerId: options.workerId,
      summary: `Bridge executed ${assignment.role} assignment "${assignment.assignmentId}" via ${target.adapterId}.`,
      adapterId: target.adapterId,
      bridgeExecution: materializeHttpJsonBridgeSuccess({
        target,
        payloadBytes,
        response: responseSnapshot,
      }),
      notes: ["external-bridge", "bridge:http-json"],
    };
  } catch (error) {
    const failure = toExecutionBridgeFailure(error);
    return buildBridgeFailureResult(
      assignment,
      target,
      recordedAt,
      payloadBytes,
      options.workerId,
      failure,
      failure.reason === "network_timeout"
        ? `Bridge request timed out for assignment "${assignment.assignmentId}" via ${target.adapterId}.`
        : `Bridge request failed ${assignment.role} assignment "${assignment.assignmentId}" via ${target.adapterId}.`,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildRequestEnvelope(
  assignment: AssignmentRun,
  target: HttpJsonExecutionBridgeTarget,
  workerId: string,
): HttpJsonBridgeRequestEnvelope {
  return {
    schemaId: DIRECTOR_HTTP_JSON_BRIDGE_REQUEST_SCHEMA_ID,
    runId: assignment.runId,
    assignmentId: assignment.assignmentId,
    workerId,
    adapterId: target.adapterId,
    provider: target.provider,
    role: assignment.role,
    actionClass: assignment.actionClass,
    approvalMode: assignment.approvalMode,
    objective: assignment.objective,
    deliverable: assignment.deliverable,
    inputs: [...assignment.inputs],
    outputs: [...assignment.outputs],
    acceptanceCriteria: [...assignment.acceptanceCriteria],
    constraints: assignment.constraints.map((constraint) => ({ ...constraint })),
    dependsOn: [...assignment.dependsOn],
  };
}

function resolveBridgeCredential(
  target: HttpJsonExecutionBridgeTarget,
  env: NodeJS.ProcessEnv,
): string | null | undefined {
  if (target.authEnvVar === undefined) {
    return undefined;
  }

  const value = env[target.authEnvVar];
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return value;
}

function buildRequestHeaders(
  target: HttpJsonExecutionBridgeTarget,
  credential: string | undefined,
): Headers {
  const headers = new Headers(target.headers);
  headers.set("content-type", "application/json");

  if (credential !== undefined) {
    headers.set("authorization", `Bearer ${credential}`);
  }

  return headers;
}

function parseResponseEnvelope(body: string): {
  readonly status: "empty" | "parsed" | "invalid";
  readonly envelope?: ParsedBridgeResponseEnvelope;
} {
  if (body.trim().length === 0) {
    return {
      status: "empty",
    };
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    if (!isRecord(parsed)) {
      return {
        status: "parsed",
      };
    }

    return {
      status: "parsed",
      envelope: {
        ...(typeof parsed.accepted === "boolean" ? { accepted: parsed.accepted } : {}),
        ...readLegacyCompatibleRequestId(parsed),
      },
    };
  } catch {
    return {
      status: "invalid",
    };
  }
}

function readLegacyCompatibleRequestId(
  parsed: Record<string, unknown>,
): Pick<ParsedBridgeResponseEnvelope, "requestId"> {
  const requestId = firstNonEmptyString(parsed.requestId, parsed.request_id, parsed.jobId);
  return requestId === undefined ? {} : { requestId };
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

function readRequestId(
  response: Response,
  envelope: ParsedBridgeResponseEnvelope | undefined,
): string | undefined {
  const responseHeaderRequestId = response.headers.get("x-request-id");
  if (responseHeaderRequestId !== null && responseHeaderRequestId.trim().length > 0) {
    return responseHeaderRequestId;
  }

  if (envelope?.requestId !== undefined && envelope.requestId.trim().length > 0) {
    return envelope.requestId;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toExecutionBridgeFailure(error: unknown): ExecutionBridgeFailure {
  if (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return {
      reason: "network_timeout",
      message: "Bridge request timed out.",
      retryable: true,
      statusCode: 504,
    };
  }

  if (error instanceof Error && error.name === "AbortError") {
    return {
      reason: "network_timeout",
      message: "Bridge request timed out.",
      retryable: true,
      statusCode: 504,
    };
  }

  return {
    reason: "network_error",
    message: "Bridge request failed before a response was received.",
    retryable: true,
  };
}

function buildBridgeFailureResult(
  assignment: AssignmentRun,
  target: HttpJsonExecutionBridgeTarget,
  recordedAt: string,
  payloadBytes: number,
  workerId: string,
  failure: ExecutionBridgeFailure,
  summary: string,
  response:
    | {
        readonly statusCode: number;
        readonly accepted?: boolean;
        readonly requestId?: string;
        readonly bodyBytes?: number;
      }
    | undefined = undefined,
): AssignmentResult {
  const request = materializeHttpJsonBridgeFailure({
    target,
    payloadBytes,
    failure,
  }).request;

  return {
    runId: assignment.runId,
    assignmentId: assignment.assignmentId,
    status: "failed",
    recordedAt,
    workerId,
    summary,
    adapterId: target.adapterId,
    bridgeExecution: {
      kind: "http-json",
      request,
      ...(response === undefined ? {} : { response }),
      failure,
    },
    notes: ["external-bridge", "bridge:http-json", `bridge-failure:${failure.reason}`],
  };
}
