import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { resolveChannelSessionTarget, validateChannelRoutingHint } from "@hotflow/channels-core";
import {
  CONTRACTS_SCHEMA_VERSION,
  type ChannelDeliveryResult,
  type ChannelRouteKind,
  type ChannelTransportEnvelope,
  createChannelDeliveryResult,
  createChannelTransportEnvelope,
  isContractError,
} from "@hotflow/contracts";
import { isEngineRunFailure } from "@hotflow/engine";
import { ModelProviderError, toModelProviderRuntimeFailureSurface } from "@hotflow/models";
import {
  type SurfaceTurnReasoningInput,
  resolveSurfaceTurnReasoningInput,
} from "@hotflow/runtime-bootstrap";

import { type BootstrapGatewayOptions, bootstrapGateway } from "./bootstrap.js";
import { createGatewayPreflightResponse } from "./preflight.js";

const MAX_REQUEST_BODY_BYTES = 256 * 1024;

type GatewayRuntime = ReturnType<typeof bootstrapGateway>;
type ValidatedChannelTransportEnvelope = ChannelTransportEnvelope & {
  readonly text: string;
};

interface GatewayListenOptions {
  readonly host?: string;
  readonly port?: number;
}

interface GatewayStartedServer {
  readonly host: string;
  readonly port: number;
}

interface GatewayErrorResponse {
  readonly code: string;
  readonly message: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface GatewayHealthResponse {
  readonly status: "ok";
  readonly app: "@hotflow/gateway";
  readonly schemaVersion: typeof CONTRACTS_SCHEMA_VERSION;
  readonly defaultProvider: string;
  readonly defaultModel: string;
  readonly defaultProviderAvailable: boolean;
  readonly providerIds: readonly string[];
}

type GatewayMessageResponse = ChannelDeliveryResult & {
  readonly output: string;
  readonly taskCount: number;
  readonly toolCallCount: number;
};

type JsonRecord = Record<string, unknown>;
type GatewayTurnReasoningOverrideSource = "none" | "metadata" | "metadata.reasoning";

interface GatewayTurnReasoningOverrideResolution {
  readonly source: GatewayTurnReasoningOverrideSource;
  readonly input: SurfaceTurnReasoningInput;
}

export interface GatewayApp {
  readonly runtime: GatewayRuntime;
  start(options?: GatewayListenOptions): Promise<GatewayStartedServer>;
  close(): Promise<void>;
}

class GatewayHttpError extends Error {
  public readonly code: string;
  public readonly metadata: Readonly<Record<string, unknown>> | undefined;
  public readonly statusCode: number;

  public constructor(
    statusCode: number,
    code: string,
    message: string,
    metadata?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "GatewayHttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.metadata = metadata;
  }
}

export function createGatewayApp(options: BootstrapGatewayOptions = {}): GatewayApp {
  const runtime = bootstrapGateway(options);
  const server = createServer(async (request, response) => {
    try {
      await handleRequest(request, response, runtime);
    } catch (error) {
      const gatewayError = toGatewayHttpError(error);
      writeJson(response, gatewayError.statusCode, toErrorBody(gatewayError));
    }
  });

  return {
    runtime,
    async start(listenOptions: GatewayListenOptions = {}): Promise<GatewayStartedServer> {
      const host = listenOptions.host ?? "127.0.0.1";
      const port = listenOptions.port ?? 3100;
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Gateway server did not expose a TCP address.");
      }
      return {
        host: address.address,
        port: address.port,
      };
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }).catch((error: unknown) => {
        if (!isServerNotRunningError(error)) {
          throw error;
        }
      });
      runtime.sessionStore.close();
    },
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: GatewayRuntime,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://hotflow.local");

  if (url.pathname === "/health") {
    if (method !== "GET") {
      throw new GatewayHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        `Method ${method} is not allowed for /health.`,
      );
    }
    writeJson(response, 200, createHealthResponse(runtime));
    return;
  }

  if (url.pathname === "/v1/runtime/preflight") {
    if (method !== "GET") {
      throw new GatewayHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        `Method ${method} is not allowed for /v1/runtime/preflight.`,
      );
    }
    writeJson(response, 200, createGatewayPreflightResponse(runtime));
    return;
  }

  if (url.pathname === "/v1/channel/message") {
    if (method !== "POST") {
      throw new GatewayHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        `Method ${method} is not allowed for /v1/channel/message.`,
      );
    }

    ensureDefaultProviderAvailable(runtime);
    const body = await readJsonBody(request);
    const envelope = parseChannelTransportEnvelope(body);
    const target = resolveChannelSessionTarget(envelope.routingHint);
    const turnReasoningOverride = readGatewayTurnReasoningMetadata(envelope.metadata);
    const turnReasoningInput = resolveSurfaceTurnReasoningInput(
      "gateway-message",
      turnReasoningOverride.input,
    ).input;
    const turnResult = await runtime.engine.runTurn({
      sessionId: target.sessionKey,
      userText: envelope.text,
      providerId: runtime.config.defaultProvider,
      model: runtime.config.defaultModel,
      ...turnReasoningInput,
    });
    const delivery = createChannelDeliveryResult({
      channel: envelope.channel,
      status: "accepted",
      processedAtMs: Date.now(),
      routeKind: target.ownership.routeKind,
      sessionKey: target.sessionKey,
      metadata: {
        messageId: envelope.messageId,
      },
    });
    const payload: GatewayMessageResponse = {
      ...delivery,
      output: turnResult.output,
      taskCount: turnResult.taskState.items.length,
      toolCallCount: turnResult.toolResults.length,
    };
    writeJson(response, 200, payload);
    return;
  }

  throw new GatewayHttpError(404, "NOT_FOUND", `Route ${method} ${url.pathname} was not found.`);
}

function createHealthResponse(runtime: GatewayRuntime): GatewayHealthResponse {
  return {
    status: "ok",
    app: "@hotflow/gateway",
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    defaultProvider: runtime.config.defaultProvider,
    defaultModel: runtime.config.defaultModel,
    defaultProviderAvailable: runtime.providerIds.includes(runtime.config.defaultProvider),
    providerIds: runtime.providerIds,
  };
}

function ensureDefaultProviderAvailable(runtime: GatewayRuntime): void {
  if (runtime.providerIds.includes(runtime.config.defaultProvider)) {
    return;
  }

  const preflight = createGatewayPreflightResponse(runtime);
  throw new GatewayHttpError(
    503,
    "DEFAULT_PROVIDER_UNAVAILABLE",
    `Configured default provider "${runtime.config.defaultProvider}" is not registered.`,
    {
      defaultProvider: runtime.config.defaultProvider,
      providerIds: runtime.providerIds,
      preflightRoute: {
        method: "GET",
        path: "/v1/runtime/preflight",
      },
      preflight: {
        status: preflight.status,
        readiness: preflight.readiness,
        summaryText: preflight.summaryText,
        recommendedAction: preflight.recommendedAction,
        recommendedCommand: preflight.recommendedCommand,
      },
    },
  );
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"];
  if (typeof contentType === "string" && !contentType.toLowerCase().includes("application/json")) {
    throw new GatewayHttpError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Request body must be application/json.",
    );
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      throw new GatewayHttpError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds 256KB.");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    throw new GatewayHttpError(400, "VALIDATION_FAILURE", "Request body is required.");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    throw new GatewayHttpError(
      400,
      "INVALID_JSON",
      `Request body is not valid JSON: ${String(error)}`,
    );
  }
}

function parseChannelTransportEnvelope(body: unknown): ValidatedChannelTransportEnvelope {
  const record = asRecord(body, "Request body must be a JSON object.");
  const schemaVersion = record.schemaVersion;
  if (schemaVersion !== undefined && schemaVersion !== CONTRACTS_SCHEMA_VERSION) {
    throw new GatewayHttpError(
      400,
      "VALIDATION_FAILURE",
      `Unsupported schemaVersion "${String(schemaVersion)}".`,
      { expected: CONTRACTS_SCHEMA_VERSION },
    );
  }

  const agentId = readString(record, "agentId");
  const channel = readString(record, "channel");
  const messageId = readString(record, "messageId");
  const peerId = readString(record, "peerId");
  const receivedAtMs = readNumber(record, "receivedAtMs");
  const text = readString(record, "text");
  const metadata = readOptionalRecord(record, "metadata");

  const routingHintRecord = asRecord(
    record.routingHint,
    'Request body must include "routingHint" as an object.',
  );
  const routingHint = {
    agentId: readString(routingHintRecord, "agentId", "routingHint.agentId"),
    channel: readString(routingHintRecord, "channel", "routingHint.channel"),
    routeKind: readRouteKind(routingHintRecord, "routeKind", "routingHint.routeKind"),
    peerId: readString(routingHintRecord, "peerId", "routingHint.peerId"),
    ...(routingHintRecord.threadId !== undefined
      ? { threadId: readString(routingHintRecord, "threadId", "routingHint.threadId") }
      : {}),
    ...(routingHintRecord.baseSessionId !== undefined
      ? {
          baseSessionId: readString(
            routingHintRecord,
            "baseSessionId",
            "routingHint.baseSessionId",
          ),
        }
      : {}),
  };

  if (routingHint.agentId !== agentId) {
    throw new GatewayHttpError(
      400,
      "VALIDATION_FAILURE",
      '"routingHint.agentId" must match "agentId".',
    );
  }
  if (routingHint.channel !== channel) {
    throw new GatewayHttpError(
      400,
      "VALIDATION_FAILURE",
      '"routingHint.channel" must match "channel".',
    );
  }
  if (routingHint.peerId !== peerId) {
    throw new GatewayHttpError(
      400,
      "VALIDATION_FAILURE",
      '"routingHint.peerId" must match "peerId".',
    );
  }

  const envelope = createChannelTransportEnvelope({
    agentId,
    channel,
    messageId,
    peerId,
    receivedAtMs,
    routingHint,
    text,
    ...(metadata ? { metadata } : {}),
  });
  try {
    validateChannelRoutingHint(envelope.routingHint);
  } catch (error) {
    throw new GatewayHttpError(400, "VALIDATION_FAILURE", String((error as Error).message));
  }
  return envelope as ValidatedChannelTransportEnvelope;
}

function readGatewayTurnReasoningMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): GatewayTurnReasoningOverrideResolution {
  if (metadata === undefined) {
    return {
      source: "none",
      input: {},
    };
  }

  const metadataRecord = metadata as JsonRecord;
  const nestedReasoning = readOptionalRecord(metadataRecord, "reasoning", "metadata.reasoning");
  const rootOverrides = readSurfaceTurnReasoningInput(metadataRecord, "metadata");

  if (nestedReasoning) {
    if (hasSurfaceTurnReasoningOverrides(rootOverrides)) {
      throw new GatewayHttpError(
        400,
        "VALIDATION_FAILURE",
        'Reasoning override fields must be provided either at "metadata.*" or under "metadata.reasoning.*", not both.',
      );
    }

    return {
      source: "metadata.reasoning",
      input: readSurfaceTurnReasoningInput(nestedReasoning as JsonRecord, "metadata.reasoning"),
    };
  }

  if (hasSurfaceTurnReasoningOverrides(rootOverrides)) {
    return {
      source: "metadata",
      input: rootOverrides,
    };
  }

  return {
    source: "none",
    input: {},
  };
}

function readSurfaceTurnReasoningInput(
  record: JsonRecord,
  fieldPrefix: string,
): SurfaceTurnReasoningInput {
  const reasoningStrategy = readOptionalReasoningStrategy(
    record,
    "reasoningStrategy",
    `${fieldPrefix}.reasoningStrategy`,
  );
  const estimatedComplexity = readOptionalEstimatedComplexity(
    record,
    "estimatedComplexity",
    `${fieldPrefix}.estimatedComplexity`,
  );
  const requiresTools = readOptionalBoolean(
    record,
    "requiresTools",
    `${fieldPrefix}.requiresTools`,
  );
  const latencyBudgetMs = readOptionalNonNegativeNumber(
    record,
    "latencyBudgetMs",
    `${fieldPrefix}.latencyBudgetMs`,
  );

  return {
    ...(reasoningStrategy === undefined ? {} : { reasoningStrategy }),
    ...(estimatedComplexity === undefined ? {} : { estimatedComplexity }),
    ...(requiresTools === undefined ? {} : { requiresTools }),
    ...(latencyBudgetMs === undefined ? {} : { latencyBudgetMs }),
  };
}

function hasSurfaceTurnReasoningOverrides(input: SurfaceTurnReasoningInput): boolean {
  return (
    input.reasoningStrategy !== undefined ||
    input.estimatedComplexity !== undefined ||
    input.requiresTools !== undefined ||
    input.latencyBudgetMs !== undefined
  );
}

function readOptionalRecord(
  record: JsonRecord,
  key: string,
  label = key,
): Readonly<Record<string, unknown>> | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  return asRecord(value, `Field "${label}" must be an object.`);
}

function readOptionalBoolean(record: JsonRecord, key: string, label = key): boolean | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new GatewayHttpError(400, "VALIDATION_FAILURE", `Field "${label}" must be a boolean.`);
  }
  return value;
}

function readOptionalNonNegativeNumber(
  record: JsonRecord,
  key: string,
  label = key,
): number | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new GatewayHttpError(
      400,
      "VALIDATION_FAILURE",
      `Field "${label}" must be a non-negative finite number.`,
    );
  }
  return value;
}

function readOptionalReasoningStrategy(
  record: JsonRecord,
  key: string,
  label = key,
): SurfaceTurnReasoningInput["reasoningStrategy"] | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (value !== "react" && value !== "plan-execute") {
    throw new GatewayHttpError(
      400,
      "VALIDATION_FAILURE",
      `Field "${label}" must be "react" or "plan-execute".`,
    );
  }
  return value;
}

function readOptionalEstimatedComplexity(
  record: JsonRecord,
  key: string,
  label = key,
): SurfaceTurnReasoningInput["estimatedComplexity"] | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (value !== "low" && value !== "medium" && value !== "high") {
    throw new GatewayHttpError(
      400,
      "VALIDATION_FAILURE",
      `Field "${label}" must be "low", "medium", or "high".`,
    );
  }
  return value;
}

function readString(record: JsonRecord, key: string, label = key): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GatewayHttpError(
      400,
      "VALIDATION_FAILURE",
      `Field "${label}" must be a non-empty string.`,
    );
  }
  return value.trim();
}

function readNumber(record: JsonRecord, key: string, label = key): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new GatewayHttpError(
      400,
      "VALIDATION_FAILURE",
      `Field "${label}" must be a finite number.`,
    );
  }
  return value;
}

function readRouteKind(record: JsonRecord, key: string, label = key): ChannelRouteKind {
  const value = readString(record, key, label);
  if (value !== "direct" && value !== "thread") {
    throw new GatewayHttpError(
      400,
      "VALIDATION_FAILURE",
      `Field "${label}" must be "direct" or "thread".`,
    );
  }
  return value;
}

function asRecord(value: unknown, message: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GatewayHttpError(400, "VALIDATION_FAILURE", message);
  }
  return value as JsonRecord;
}

function toGatewayHttpError(error: unknown): GatewayHttpError {
  if (error instanceof GatewayHttpError) {
    return error;
  }

  if (isContractError(error)) {
    return new GatewayHttpError(
      resolveGatewayStatusCodeForContractError(error.code),
      error.code,
      error.message,
      error.metadata,
    );
  }

  if (isEngineRunFailure(error)) {
    return new GatewayHttpError(
      resolveGatewayStatusCodeForContractError(error.failure.error.code),
      error.failure.error.code,
      error.failure.error.message,
      {
        kind: error.failure.kind,
        action: error.failure.action,
        providerId: error.failure.providerId,
        providerStage: error.failure.providerStage,
        providerCode: error.failure.providerCode,
        retryable: error.failure.retryable,
        ...(error.failure.statusCode !== undefined ? { statusCode: error.failure.statusCode } : {}),
        ...(error.failure.operatorVisible === undefined
          ? {}
          : { operatorVisible: error.failure.operatorVisible }),
      },
    );
  }

  if (error instanceof ModelProviderError) {
    const failure = toModelProviderRuntimeFailureSurface(error);
    return new GatewayHttpError(
      failure.failureClass === "transient" ? 503 : 502,
      failure.error.code,
      failure.error.message,
      {
        kind: failure.kind,
        action: failure.action,
        providerId: failure.providerId,
        providerStage: failure.providerStage,
        providerCode: failure.providerCode,
        retryable: failure.retryable,
        ...(failure.statusCode !== undefined ? { statusCode: failure.statusCode } : {}),
        ...(failure.operatorVisible === undefined
          ? {}
          : { operatorVisible: failure.operatorVisible }),
      },
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  return new GatewayHttpError(500, "ENGINE_RUN_FAILED", message);
}

function resolveGatewayStatusCodeForContractError(code: string): number {
  switch (code) {
    case "PROVIDER_TRANSIENT_ERROR":
      return 503;
    case "PROVIDER_FATAL_ERROR":
    case "MODEL_FAILURE":
      return 502;
    case "USER_ERROR":
    case "VALIDATION_FAILURE":
      return 400;
    case "POLICY_ERROR":
      return 403;
    default:
      return 500;
  }
}

function toErrorBody(error: GatewayHttpError): GatewayErrorResponse {
  return {
    code: error.code,
    message: error.message,
    ...(error.metadata ? { metadata: error.metadata } : {}),
  };
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function isServerNotRunningError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ERR_SERVER_NOT_RUNNING";
}
