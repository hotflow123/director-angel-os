import type {
  ExternalToolArtifact,
  ExternalToolDoctorResult,
  ExternalToolHandlerInvokeOutput,
  ExternalToolHandlerInvokeRequest,
  ExternalToolRegistration,
} from "./external-tools.js";
import { createExternalToolProviderManifest } from "./external-tools.js";

const FUTURE_CLI_SCHEMA_VERSION = "director.external-cli-provider.v1" as const;
const EXTERNAL_TOOL_SCHEMA_VERSION = "director.external-tool.v1" as const;

export interface FutureCliProviderManifest {
  readonly schemaVersion: typeof FUTURE_CLI_SCHEMA_VERSION;
  readonly providerId: string;
  readonly toolId: string;
  readonly label: string;
  readonly description?: string;
  readonly command: string;
  readonly sourceTrust?: {
    readonly status:
      | "built-in"
      | "trusted-local-config"
      | "trusted-plugin"
      | "user-configured"
      | "unverified"
      | "unknown";
    readonly reason?: string;
  };
  readonly operations: readonly FutureCliProviderOperationManifest[];
}

export interface FutureCliProviderOperationManifest {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly readOnly: boolean;
  readonly requiresApproval?: boolean;
  readonly args: readonly string[];
  readonly timeoutMs?: number;
  readonly artifactParsers?: readonly FutureCliArtifactParserManifest[];
  readonly eventParsers?: readonly FutureCliEventParserManifest[];
  readonly argAdmission?: {
    readonly blockedStringPatterns?: readonly string[];
  };
}

export interface FutureCliArtifactParserManifest {
  readonly path: string;
}

export interface FutureCliEventParserManifest {
  readonly path: string;
  readonly source?: "json" | "stdout";
  readonly format?: "json-array" | "ndjson";
}

export type FutureCliRuntimeEvent = Readonly<Record<string, unknown>>;

export interface FutureCliRunnerInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly timeoutMs?: number;
  readonly emitEvent: (event: FutureCliRuntimeEvent) => void;
}

export interface FutureCliRunnerOutput {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly errorCode?: string;
  readonly signal?: NodeJS.Signals | null;
}

export type FutureCliRunner = (
  input: FutureCliRunnerInput,
) => FutureCliRunnerOutput | Promise<FutureCliRunnerOutput>;

export interface FutureCliProviderRegistrationOptions {
  readonly runner: FutureCliRunner;
  readonly onEvent?: (event: FutureCliRuntimeEvent) => void;
  readonly enabled?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function validateFutureCliProviderManifest(input: unknown): FutureCliProviderManifest {
  if (!isRecord(input)) {
    throw new Error("Future CLI provider manifest must be an object.");
  }
  if (input.schemaVersion !== FUTURE_CLI_SCHEMA_VERSION) {
    throw new Error(`Future CLI provider manifest must use ${FUTURE_CLI_SCHEMA_VERSION}.`);
  }
  const providerId = requireToken(input.providerId, "providerId");
  const toolId = requireToolId(input.toolId, "toolId");
  const label = requireString(input.label, "label");
  const command = requireAbsoluteCommand(input.command);
  const operations = readArray(input.operations, "operations").map((operation) =>
    validateFutureCliProviderOperation(operation),
  );
  if (operations.length === 0) {
    throw new Error("Future CLI provider manifest must declare at least one operation.");
  }
  const sourceTrust = isRecord(input.sourceTrust)
    ? {
        status: readSourceTrustStatus(input.sourceTrust.status),
        ...optionalStringField("reason", input.sourceTrust.reason),
      }
    : undefined;
  return {
    schemaVersion: FUTURE_CLI_SCHEMA_VERSION,
    providerId,
    toolId,
    label,
    ...optionalStringField("description", input.description),
    command,
    ...(sourceTrust === undefined ? {} : { sourceTrust }),
    operations,
  };
}

export function createFutureCliProviderRegistrationFromManifest(
  manifest: FutureCliProviderManifest,
  options: FutureCliProviderRegistrationOptions,
): ExternalToolRegistration {
  const normalized = validateFutureCliProviderManifest(manifest);
  return {
    manifest: createExternalToolProviderManifest({
      id: normalized.toolId,
      label: normalized.label,
      description:
        normalized.description ??
        `External CLI provider ${normalized.providerId} registered through a schema-first manifest.`,
      source: "external",
      providerId: normalized.providerId,
      enabled: options.enabled ?? true,
      capabilities: normalized.operations.map((operation) => ({
        id: operation.id,
        label: operation.label,
        ...(operation.description === undefined ? {} : { description: operation.description }),
        readOnly: operation.readOnly,
        ...(operation.requiresApproval === undefined
          ? {}
          : { requiresApproval: operation.requiresApproval }),
        metadata: {
          capability: `${normalized.providerId}.${operation.id}`,
          ...(operation.argAdmission === undefined ? {} : { argAdmission: operation.argAdmission }),
        },
      })),
      sourceTrust: {
        status: normalized.sourceTrust?.status ?? "user-configured",
        label: normalized.label,
        reason:
          normalized.sourceTrust?.reason ??
          "Future CLI provider was registered from a local schema manifest.",
      },
      approvalBoundary: {
        mode: "runtime-policy",
        actionLabels: ["确认", "拒绝"],
        requiresOperator: true,
        riskLevel: "medium",
      },
      metadata: {
        ...(options.metadata ?? {}),
        schemaVersion: FUTURE_CLI_SCHEMA_VERSION,
        command: normalized.command,
        providerFamily: "future-cli",
      },
    }),
    check: async () => checkFutureCliProvider(normalized),
    invoke: async (request) => invokeFutureCliProvider(normalized, options, request),
    allowInvokeWhenUnavailable: true,
  };
}

async function checkFutureCliProvider(
  manifest: FutureCliProviderManifest,
): Promise<ExternalToolDoctorResult> {
  const healthOperation = manifest.operations.find((operation) => operation.id === "health");
  return {
    status: "ready",
    summary:
      healthOperation === undefined
        ? `${manifest.label} manifest is registered; no health operation declared.`
        : `${manifest.label} manifest is registered with a health operation.`,
    nextActions: [],
    details: {
      schemaVersion: FUTURE_CLI_SCHEMA_VERSION,
      providerId: manifest.providerId,
      operationCount: manifest.operations.length,
      healthOperationDeclared: healthOperation !== undefined,
    },
  };
}

async function invokeFutureCliProvider(
  manifest: FutureCliProviderManifest,
  options: FutureCliProviderRegistrationOptions,
  request: ExternalToolHandlerInvokeRequest,
): Promise<ExternalToolHandlerInvokeOutput> {
  const operation = manifest.operations.find((candidate) => candidate.id === request.operationId);
  if (operation === undefined) {
    return {
      ok: false,
      status: "error",
      content: `Future CLI operation ${String(request.operationId ?? "")} is not declared.`,
      error: "FUTURE_CLI_OPERATION_UNSUPPORTED",
    };
  }
  const args = renderFutureCliArgs(operation.args, request.args ?? {});
  const streamedEvents: FutureCliRuntimeEvent[] = [];
  const emitEvent = (event: FutureCliRuntimeEvent) => {
    const normalized = normalizeFutureCliRuntimeEvent(event);
    if (normalized === undefined) {
      return;
    }
    streamedEvents.push(normalized);
    options.onEvent?.(normalized);
  };
  const result = await options.runner({
    command: manifest.command,
    args,
    ...(operation.timeoutMs === undefined ? {} : { timeoutMs: operation.timeoutMs }),
    emitEvent,
  });
  const parsed = parseJsonObject(result.stdout);
  const ok = result.exitCode === 0;
  const summary =
    readString(parsed?.summary) ?? (ok ? `${operation.label} completed.` : result.stderr);
  const artifacts = extractFutureCliArtifacts(parsed, operation.artifactParsers ?? []);
  const events = [
    ...streamedEvents,
    ...extractFutureCliEvents(parsed, result.stdout, operation.eventParsers ?? []),
  ];
  return {
    ok,
    status: ok ? "success" : "error",
    content: summary,
    output: {
      schemaVersion: EXTERNAL_TOOL_SCHEMA_VERSION,
      status: ok ? "success" : "error",
      provider: manifest.providerId,
      operation: operation.id,
      summary,
      events,
      output: parsed ?? result.stdout,
      error: ok
        ? null
        : {
            code: result.errorCode ?? "FUTURE_CLI_FAILED",
            message: result.stderr || summary,
            rootCauseHint: "The external CLI returned a non-zero exit code.",
            safeRetry: {
              strategy: "manual",
              executor: "operator",
              instruction: "Inspect the CLI stderr/stdout and retry only after fixing inputs.",
            },
            stopCondition: {
              type: "operator_action_required",
              action: "wait_for_operator",
            },
            retryHistory: [],
          },
      nextActions: [],
    },
    ...(ok ? {} : { error: result.errorCode ?? "FUTURE_CLI_FAILED" }),
    ...(artifacts.length === 0 ? {} : { artifacts }),
    metadata: {
      schemaVersion: FUTURE_CLI_SCHEMA_VERSION,
      providerId: manifest.providerId,
      operationId: operation.id,
      exitCode: result.exitCode,
      streamedEventCount: streamedEvents.length,
    },
  };
}

function validateFutureCliProviderOperation(input: unknown): FutureCliProviderOperationManifest {
  if (!isRecord(input)) {
    throw new Error("Future CLI provider operation must be an object.");
  }
  const operation: FutureCliProviderOperationManifest = {
    id: requireToken(input.id, "operation.id"),
    label: requireString(input.label, "operation.label"),
    ...optionalStringField("description", input.description),
    readOnly: requireBoolean(input.readOnly, "operation.readOnly"),
    ...(typeof input.requiresApproval === "boolean"
      ? { requiresApproval: input.requiresApproval }
      : {}),
    args: readStringArray(input.args, "operation.args"),
    ...(typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs)
      ? { timeoutMs: Math.max(1, Math.trunc(input.timeoutMs)) }
      : {}),
    ...(Array.isArray(input.artifactParsers)
      ? {
          artifactParsers: input.artifactParsers.map((parser) => ({
            path: requireString(isRecord(parser) ? parser.path : undefined, "artifactParser.path"),
          })),
        }
      : {}),
    ...(Array.isArray(input.eventParsers)
      ? {
          eventParsers: input.eventParsers.map((parser) => ({
            path: requireString(isRecord(parser) ? parser.path : undefined, "eventParser.path"),
            ...(isRecord(parser) && parser.source === "stdout" ? { source: "stdout" } : {}),
            ...(isRecord(parser) && parser.format === "ndjson" ? { format: "ndjson" } : {}),
          })),
        }
      : {}),
    ...(isRecord(input.argAdmission)
      ? {
          argAdmission: {
            ...(Array.isArray(input.argAdmission.blockedStringPatterns)
              ? {
                  blockedStringPatterns: readStringArray(
                    input.argAdmission.blockedStringPatterns,
                    "argAdmission.blockedStringPatterns",
                  ),
                }
              : {}),
          },
        }
      : {}),
  };
  if (!operation.readOnly && operation.requiresApproval !== true) {
    throw new Error(`Future CLI write operation ${operation.id} must require approval.`);
  }
  return operation;
}

function renderFutureCliArgs(
  templateArgs: readonly string[],
  args: Readonly<Record<string, unknown>>,
): readonly string[] {
  return templateArgs.map((value) =>
    value.replaceAll(/\{\{([A-Za-z_][A-Za-z0-9_.-]*)\}\}/gu, (_match, key: string) => {
      const replacement = readPath(args, key);
      if (replacement === undefined) {
        throw new Error(`Missing Future CLI arg: ${key}`);
      }
      return String(replacement);
    }),
  );
}

function extractFutureCliArtifacts(
  parsed: Readonly<Record<string, unknown>> | undefined,
  parsers: readonly FutureCliArtifactParserManifest[],
): readonly ExternalToolArtifact[] {
  if (parsed === undefined) {
    return [];
  }
  const values =
    parsers.length === 0
      ? [parsed.artifacts]
      : parsers.map((parser) => readPath(parsed, parser.path));
  return values.flatMap((value) => readArtifactArray(value));
}

function extractFutureCliEvents(
  parsed: Readonly<Record<string, unknown>> | undefined,
  stdout: string,
  parsers: readonly FutureCliEventParserManifest[],
): readonly Readonly<Record<string, unknown>>[] {
  if (parsed === undefined) {
    return parsers.flatMap((parser) =>
      parser.source === "stdout" && parser.format === "ndjson" ? readNdjsonEventArray(stdout) : [],
    );
  }
  if (parsers.length === 0) {
    return readEventArray(parsed.events);
  }
  return parsers.flatMap((parser) => {
    if (parser.format === "ndjson") {
      const value = parser.source === "stdout" ? stdout : readPath(parsed, parser.path);
      return readNdjsonEventArray(value);
    }
    return readEventArray(readPath(parsed, parser.path));
  });
}

function readNdjsonEventArray(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line): Readonly<Record<string, unknown>>[] => {
      try {
        return [...readEventArray([JSON.parse(line) as unknown])];
      } catch {
        return [];
      }
    });
}

function readEventArray(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): Readonly<Record<string, unknown>>[] => {
    if (!isRecord(item)) {
      return [];
    }
    const type = readString(item.type);
    if (type === undefined) {
      return [];
    }
    return [
      {
        type,
        ...optionalStringField("timestamp", item.timestamp),
        ...optionalStringField("message", item.message),
        ...(isRecord(item.payload) ? { payload: item.payload } : {}),
      },
    ];
  });
}

function normalizeFutureCliRuntimeEvent(event: unknown): FutureCliRuntimeEvent | undefined {
  if (!isRecord(event)) {
    return undefined;
  }
  const type = readString(event.type);
  if (type === undefined) {
    return undefined;
  }
  return {
    type,
    ...optionalStringField("timestamp", event.timestamp),
    ...optionalStringField("message", event.message),
    ...(isRecord(event.payload) ? { payload: event.payload } : {}),
  };
}

function readArtifactArray(value: unknown): readonly ExternalToolArtifact[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): ExternalToolArtifact[] => {
    if (!isRecord(item)) {
      return [];
    }
    const id = readString(item.id);
    const kind = readString(item.kind);
    if (id === undefined || kind === undefined) {
      return [];
    }
    return [
      {
        id,
        kind,
        ...optionalStringField("path", item.path ?? item.localPath),
        ...optionalStringField("url", item.url ?? item.uri),
        ...(isRecord(item.metadata) ? { metadata: item.metadata } : {}),
      },
    ];
  });
}

function readPath(root: Readonly<Record<string, unknown>>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, part) => {
    if (!isRecord(value)) {
      return undefined;
    }
    return value[part];
  }, root);
}

function parseJsonObject(value: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readSourceTrustStatus(
  value: unknown,
): NonNullable<FutureCliProviderManifest["sourceTrust"]>["status"] {
  switch (value) {
    case "built-in":
    case "trusted-local-config":
    case "trusted-plugin":
    case "user-configured":
    case "unverified":
    case "unknown":
      return value;
    default:
      return "unknown";
  }
}

function requireAbsoluteCommand(value: unknown): string {
  const command = requireString(value, "command");
  if (!command.startsWith("/")) {
    throw new Error("Future CLI command must be an absolute executable path.");
  }
  if (/[;&|`$]/u.test(command) || command.includes("..")) {
    throw new Error("Future CLI command contains unsafe shell or path tokens.");
  }
  return command;
}

function requireToolId(value: unknown, key: string): string {
  const text = requireString(value, key);
  if (!/^[a-z][a-z0-9_.-]*$/u.test(text)) {
    throw new Error(`${key} must be a stable lower-case tool id.`);
  }
  return text;
}

function requireToken(value: unknown, key: string): string {
  const text = requireString(value, key);
  if (!/^[A-Za-z0-9_.-]+$/u.test(text)) {
    throw new Error(`${key} must be a stable token.`);
  }
  return text;
}

function requireString(value: unknown, key: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value.trim();
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function requireBoolean(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean.`);
  }
  return value;
}

function readArray(value: unknown, key: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array.`);
  }
  return value;
}

function readStringArray(value: unknown, key: string): readonly string[] {
  return readArray(value, key).map((item) => requireString(item, key));
}

function optionalStringField<K extends string>(
  key: K,
  value: unknown,
): { readonly [P in K]?: string } {
  const text = readString(value);
  return text === undefined ? {} : ({ [key]: text } as { readonly [P in K]?: string });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
