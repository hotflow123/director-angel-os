import type { InMemoryModelProviderRegistry } from "@hotflow/models";
import type { Logger } from "@hotflow/observability";
import {
  type RuntimeApprovedSkillRepository,
  type RuntimeApprovedSkillRepositoryFactoryInput,
  type RuntimePluginRegistrar,
  type RuntimeSkillRepository,
  type RuntimeSkillRepositoryFactoryInput,
  bootstrapRuntime,
  createNoopLogger,
  registerDefaultRuntimeProviders,
} from "@hotflow/runtime-bootstrap";
import type { JsonValue } from "@hotflow/sessions";
import type { SessionStore } from "@hotflow/sessions";

import { createCliControlPlane } from "./control-plane-adapter.js";

export function resolveCliSessionDbPath(
  config: { dataDir: string; sessionDbPath: string },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.HOTFLOW_CLI_SESSION_DB_PATH?.trim();
  if (override) {
    return override;
  }
  return `${config.dataDir}/sessions/cli.sqlite`;
}

function createCliLogger(): Logger {
  return createNoopLogger();
}

export interface RegisterCliProvidersOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  includeScripted?: boolean;
}

export interface CliAuditRecordInput {
  sessionId: string;
  kind: string;
  payload?: JsonValue;
  turnId?: string;
  occurredAtMs?: number;
}

export interface RecordCliAuditEventOptions {
  now?: () => number;
  eventIdFactory?: (input: {
    occurredAtMs: number;
    kind: string;
  }) => string;
  logger?: Pick<Logger, "debug">;
}

export function recordCliAuditEvent(
  sessionStore: Pick<SessionStore, "appendAuditEvent">,
  input: CliAuditRecordInput,
  options: RecordCliAuditEventOptions = {},
): void {
  const now = options.now ?? Date.now;
  const occurredAtMs = input.occurredAtMs ?? now();
  const eventId =
    options.eventIdFactory?.({
      occurredAtMs,
      kind: input.kind,
    }) ?? `cli_audit_${occurredAtMs}_${input.kind.replace(/\s+/gu, "_")}`;
  try {
    sessionStore.appendAuditEvent(input.sessionId, {
      ...(input.turnId ? { turnId: input.turnId } : {}),
      event: {
        id: eventId,
        kind: input.kind,
        schemaVersion: "cli.audit.v1",
        occurredAtMs,
        payload: input.payload ?? {},
      },
      createdAtMs: occurredAtMs,
    });
  } catch (error) {
    options.logger?.debug("failed to persist cli audit event", {
      sessionId: input.sessionId,
      kind: input.kind,
      error: String(error),
    });
  }
}

export interface CliTelemetry {
  recordAuditEvent(input: CliAuditRecordInput): void;
}

function createCliTelemetry(sessionStore: SessionStore, logger: Logger): CliTelemetry {
  return {
    recordAuditEvent(input: CliAuditRecordInput): void {
      recordCliAuditEvent(sessionStore, input, { logger });
    },
  };
}

export function registerCliProviders(
  providerRegistry: InMemoryModelProviderRegistry,
  options: RegisterCliProvidersOptions = {},
): readonly string[] {
  return registerDefaultRuntimeProviders(providerRegistry, {
    ...(options.env ? { env: options.env } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.includeScripted === undefined ? {} : { includeScripted: options.includeScripted }),
  });
}

export interface BootstrapCliOptions extends RegisterCliProvidersOptions {
  readonly createApprovedSkillRepository?: (
    input: RuntimeApprovedSkillRepositoryFactoryInput,
  ) => RuntimeApprovedSkillRepository;
  readonly createSkillRepository?: (
    input: RuntimeSkillRepositoryFactoryInput,
  ) => RuntimeSkillRepository;
  readonly pluginRegistrar?: RuntimePluginRegistrar;
}

export function bootstrapCli(options: BootstrapCliOptions = {}) {
  return bootstrapRuntime<ReturnType<typeof createCliControlPlane>, CliTelemetry>({
    ...options,
    createLogger: createCliLogger,
    ...(options.createSkillRepository === undefined
      ? {}
      : { createSkillRepository: options.createSkillRepository }),
    ...(options.createApprovedSkillRepository === undefined
      ? {}
      : { createApprovedSkillRepository: options.createApprovedSkillRepository }),
    createTelemetry({ logger, sessionStore }) {
      return createCliTelemetry(sessionStore, logger);
    },
    createControlPlane({ approvedSkillRepository, memory, sessionStore, telemetry }) {
      return createCliControlPlane({
        approvedSkillRepository,
        sessionStore,
        memory,
        ...(options.env === undefined ? {} : { env: options.env }),
        recordAuditEvent: (input) => telemetry.recordAuditEvent(input),
      });
    },
    registerProviders(providerRegistry, registrationOptions) {
      return registerCliProviders(providerRegistry, {
        ...(registrationOptions.env ? { env: registrationOptions.env } : {}),
        ...(registrationOptions.fetchImpl ? { fetchImpl: registrationOptions.fetchImpl } : {}),
        includeScripted: false,
      });
    },
    ...(options.pluginRegistrar === undefined ? {} : { pluginRegistrar: options.pluginRegistrar }),
    resolveSessionDbPath(config) {
      return resolveCliSessionDbPath(config, options.env);
    },
  });
}
