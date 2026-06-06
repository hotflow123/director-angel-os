import type { HotflowConfig } from "@hotflow/config";
import type { SessionStore } from "@hotflow/sessions";

import {
  defaultBootstrapDoctorControlPlane,
  defaultLoadDoctorConfig,
  defaultOpenDoctorSessionStore,
  defaultRegisterDoctorProviders,
  defaultResolveDoctorSessionDbPath,
} from "./defaults.js";
import type {
  DoctorCheckError,
  DoctorCheckId,
  DoctorCheckResult,
  DoctorDirectorKnowledgeLaneProbeResult,
  DoctorDirectorMemoryLaneProbeResult,
  DoctorLearningLaneProbeResult,
  DoctorProviderDescriptor,
  DoctorProviderRegistryResult,
  DoctorReport,
  DoctorResolveSessionDbPathInput,
  DoctorStatus,
  RunDoctorOptions,
} from "./types.js";

interface SuccessfulCheckResult {
  readonly status?: DoctorStatus;
  readonly summary: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

function normalizeError(code: string, error: unknown): DoctorCheckError {
  if (error instanceof Error) {
    return {
      code,
      message: error.message,
    };
  }
  return {
    code,
    message: String(error),
  };
}

function aggregateStatus(checks: readonly DoctorCheckResult[]): DoctorStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "warn";
  }
  return "pass";
}

async function executeCheck(
  id: DoctorCheckId,
  now: () => number,
  run: () => Promise<SuccessfulCheckResult> | SuccessfulCheckResult,
  errorCode: string,
): Promise<DoctorCheckResult> {
  const startedAtMs = now();
  try {
    const result = await run();
    const completedAtMs = now();
    return {
      id,
      status: result.status ?? "pass",
      summary: result.summary,
      startedAtMs,
      completedAtMs,
      durationMs: completedAtMs - startedAtMs,
      ...(result.details ? { details: result.details } : {}),
    };
  } catch (error) {
    const normalized = normalizeError(errorCode, error);
    const completedAtMs = now();
    return {
      id,
      status: "fail",
      summary: normalized.message,
      startedAtMs,
      completedAtMs,
      durationMs: completedAtMs - startedAtMs,
      error: normalized,
    };
  }
}

function dependencyFailure(
  id: DoctorCheckId,
  now: () => number,
  dependencyId: DoctorCheckId,
  summary: string,
): DoctorCheckResult {
  const startedAtMs = now();
  const completedAtMs = now();
  return {
    id,
    status: "fail",
    summary,
    startedAtMs,
    completedAtMs,
    durationMs: completedAtMs - startedAtMs,
    error: {
      code: "DEPENDENCY_UNAVAILABLE",
      message: `Dependency check failed: ${dependencyId}`,
    },
    details: {
      dependencyId,
    },
  };
}

function findProviderDescriptor(
  providers: readonly DoctorProviderDescriptor[] | undefined,
  providerId: string,
): DoctorProviderDescriptor | undefined {
  return providers?.find((provider) => provider.id === providerId);
}

function buildDefaultProviderFailureSummary(
  defaultProvider: string,
  providers: DoctorProviderRegistryResult,
): string {
  const descriptor = findProviderDescriptor(providers.providers, defaultProvider);
  if (descriptor?.reason) {
    return `Default provider "${defaultProvider}" is unavailable: ${descriptor.reason}`;
  }
  return `Default provider "${defaultProvider}" is not registered.`;
}

function toConfigDetails(config: HotflowConfig): Readonly<Record<string, unknown>> {
  return {
    profile: config.profile,
    workspaceRoot: config.workspaceRoot,
    dataDir: config.dataDir,
    sessionDbPath: config.sessionDbPath,
    defaultProvider: config.defaultProvider,
    defaultModel: config.defaultModel,
    permissionMode: config.permissionMode,
    outputStyle: config.outputStyle,
  };
}

function toSessionDbPathInput(
  config: HotflowConfig,
  options: RunDoctorOptions,
): DoctorResolveSessionDbPathInput {
  return {
    config,
    ...(options.sessionDbPathOverride
      ? { sessionDbPathOverride: options.sessionDbPathOverride }
      : {}),
  };
}

export async function runDoctor(options: RunDoctorOptions = {}): Promise<DoctorReport> {
  const now = options.now ?? Date.now;
  const startedAtMs = now();
  const checks: DoctorCheckResult[] = [];
  const env = options.env ?? process.env;

  const loadConfig = options.loadConfig ?? defaultLoadDoctorConfig;
  const resolveSessionDbPath = options.resolveSessionDbPath ?? defaultResolveDoctorSessionDbPath;
  const registerProviders = options.registerProviders ?? defaultRegisterDoctorProviders;
  const openSessionStore = options.openSessionStore ?? defaultOpenDoctorSessionStore;
  const bootstrapControlPlane = options.bootstrapControlPlane ?? defaultBootstrapDoctorControlPlane;

  let config: HotflowConfig | undefined;
  let sessionDbPath: string | undefined;
  let providers: DoctorProviderRegistryResult | undefined;
  let sessionStore: SessionStore | undefined;
  const probeMempalace = options.probeMempalace;
  const probeDirectorMemoryLane = options.probeDirectorMemoryLane;
  const probeDirectorKnowledgeLane = options.probeDirectorKnowledgeLane;
  const probeLearningLane = options.probeLearningLane;

  checks.push(
    await executeCheck(
      "config.load",
      now,
      async () => {
        config = await loadConfig({
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(options.env ? { env: options.env } : {}),
        });
        return {
          summary: "Configuration loaded successfully.",
          details: toConfigDetails(config),
        };
      },
      "CONFIG_LOAD_FAILED",
    ),
  );

  if (config) {
    const resolvedConfig = config;
    checks.push(
      await executeCheck(
        "session.db_path",
        now,
        async () => {
          const effectiveSessionDbPath = await resolveSessionDbPath(
            toSessionDbPathInput(resolvedConfig, options),
          );
          sessionDbPath = effectiveSessionDbPath;
          return {
            summary: "Resolved effective session db path.",
            details: {
              sessionDbPath: effectiveSessionDbPath,
            },
          };
        },
        "SESSION_DB_PATH_RESOLUTION_FAILED",
      ),
    );

    checks.push(
      await executeCheck(
        "provider.registry",
        now,
        async () => {
          const resolvedProviderRegistry = await registerProviders({
            config: resolvedConfig,
            ...(options.env ? { env: options.env } : {}),
            ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          });
          providers = resolvedProviderRegistry;
          return {
            summary: "Resolved provider registry candidates.",
            details: {
              providerIds: resolvedProviderRegistry.providerIds,
              ...(resolvedProviderRegistry.providers
                ? { providers: resolvedProviderRegistry.providers }
                : {}),
              ...(resolvedProviderRegistry.details
                ? { registry: resolvedProviderRegistry.details }
                : {}),
            },
          };
        },
        "PROVIDER_REGISTRY_FAILED",
      ),
    );

    const resolvedProviders = providers;
    if (resolvedProviders) {
      checks.push(
        await executeCheck(
          "provider.default",
          now,
          () => {
            if (!resolvedProviders.providerIds.includes(resolvedConfig.defaultProvider)) {
              throw new Error(
                buildDefaultProviderFailureSummary(
                  resolvedConfig.defaultProvider,
                  resolvedProviders,
                ),
              );
            }
            return {
              summary: `Default provider "${resolvedConfig.defaultProvider}" is available.`,
              details: {
                defaultProvider: resolvedConfig.defaultProvider,
                providerIds: resolvedProviders.providerIds,
              },
            };
          },
          "DEFAULT_PROVIDER_UNAVAILABLE",
        ),
      );
    } else {
      checks.push(
        dependencyFailure(
          "provider.default",
          now,
          "provider.registry",
          "Could not validate the default provider because provider registry resolution failed.",
        ),
      );
    }

    const resolvedSessionDbPath = sessionDbPath;
    if (resolvedSessionDbPath) {
      checks.push(
        await executeCheck(
          "session.store",
          now,
          async () => {
            sessionStore = await openSessionStore({
              config: resolvedConfig,
              sessionDbPath: resolvedSessionDbPath,
            });
            return {
              summary: "Opened session store successfully.",
              details: {
                sessionDbPath: resolvedSessionDbPath,
              },
            };
          },
          "SESSION_STORE_OPEN_FAILED",
        ),
      );
    } else {
      checks.push(
        dependencyFailure(
          "session.store",
          now,
          "session.db_path",
          "Could not open the session store because the effective session db path is unavailable.",
        ),
      );
    }

    if (probeMempalace) {
      checks.push(
        await executeCheck(
          "memory.mempalace",
          now,
          async () => {
            const result = await probeMempalace();
            return {
              status: result.status,
              summary: result.summary,
              details: {
                mode: result.mode,
                configured: result.configured,
                reachable: result.reachable,
                ...(result.details ?? {}),
              },
            };
          },
          "MEMPALACE_PROBE_FAILED",
        ),
      );
    }

    if (probeLearningLane) {
      let learningLaneProbeResult: DoctorLearningLaneProbeResult | undefined;
      let learningLaneProbeError: unknown;
      try {
        learningLaneProbeResult = await probeLearningLane();
      } catch (error) {
        learningLaneProbeError = error;
      }

      const learningLaneChecks: Array<[DoctorCheckId, keyof DoctorLearningLaneProbeResult]> = [
        ["learning.proposal_store", "proposalStore"],
        ["learning.approved_snapshot", "approvedSnapshot"],
        ["learning.reload_visibility", "reloadVisibility"],
      ];

      for (const [id, key] of learningLaneChecks) {
        checks.push(
          await executeCheck(
            id,
            now,
            () => {
              if (learningLaneProbeError) {
                throw learningLaneProbeError;
              }
              if (!learningLaneProbeResult) {
                throw new Error("Learning lane probe did not return data.");
              }
              const detail = learningLaneProbeResult[key];
              if (!detail) {
                throw new Error(`Learning lane probe result missing ${key}.`);
              }
              return detail;
            },
            "LEARNING_LANE_PROBE_FAILED",
          ),
        );
      }
    }

    if (probeDirectorMemoryLane) {
      let directorMemoryLaneProbeResult: DoctorDirectorMemoryLaneProbeResult | undefined;
      let directorMemoryLaneProbeError: unknown;
      try {
        directorMemoryLaneProbeResult = await probeDirectorMemoryLane();
      } catch (error) {
        directorMemoryLaneProbeError = error;
      }

      const directorMemoryLaneChecks: Array<
        [DoctorCheckId, keyof DoctorDirectorMemoryLaneProbeResult]
      > = [
        ["director.memory.switch", "switchState"],
        ["director.memory.store", "storeReadable"],
        ["director.memory.recall", "recallPreview"],
        ["director.memory.ingest", "ingestClosure"],
      ];

      for (const [id, key] of directorMemoryLaneChecks) {
        checks.push(
          await executeCheck(
            id,
            now,
            () => {
              if (directorMemoryLaneProbeError) {
                throw directorMemoryLaneProbeError;
              }
              if (!directorMemoryLaneProbeResult) {
                throw new Error("Director memory lane probe did not return data.");
              }
              const detail = directorMemoryLaneProbeResult[key];
              if (!detail) {
                throw new Error(`Director memory lane probe result missing ${key}.`);
              }
              return detail;
            },
            "DIRECTOR_MEMORY_LANE_PROBE_FAILED",
          ),
        );
      }
    }

    if (probeDirectorKnowledgeLane) {
      let directorKnowledgeLaneProbeResult: DoctorDirectorKnowledgeLaneProbeResult | undefined;
      let directorKnowledgeLaneProbeError: unknown;
      try {
        directorKnowledgeLaneProbeResult = await probeDirectorKnowledgeLane();
      } catch (error) {
        directorKnowledgeLaneProbeError = error;
      }

      const directorKnowledgeLaneChecks: Array<
        [DoctorCheckId, keyof DoctorDirectorKnowledgeLaneProbeResult]
      > = [
        ["director.knowledge.switch", "switchState"],
        ["director.knowledge.store", "storeReadable"],
        ["director.knowledge.recall", "recallPreview"],
      ];

      for (const [id, key] of directorKnowledgeLaneChecks) {
        checks.push(
          await executeCheck(
            id,
            now,
            () => {
              if (directorKnowledgeLaneProbeError) {
                throw directorKnowledgeLaneProbeError;
              }
              if (!directorKnowledgeLaneProbeResult) {
                throw new Error("Director knowledge lane probe did not return data.");
              }
              const detail = directorKnowledgeLaneProbeResult[key];
              if (!detail) {
                throw new Error(`Director knowledge lane probe result missing ${key}.`);
              }
              return detail;
            },
            "DIRECTOR_KNOWLEDGE_LANE_PROBE_FAILED",
          ),
        );
      }
    }

    const openedSessionStore = sessionStore;
    const resolvedProvidersForBootstrap = providers;
    if (openedSessionStore && resolvedProvidersForBootstrap) {
      checks.push(
        await executeCheck(
          "control_plane.bootstrap",
          now,
          async () => {
            const controlPlane = await bootstrapControlPlane({
              config: resolvedConfig,
              ...(options.env ? { env: options.env } : {}),
              sessionStore: openedSessionStore,
              providers: resolvedProvidersForBootstrap,
            });
            if (isClosable(controlPlane)) {
              controlPlane.close();
            }
            return {
              summary: "Constructed control-plane bootstrap successfully.",
              details: {
                implementation: options.bootstrapControlPlane ? "custom" : "default-core",
              },
            };
          },
          "CONTROL_PLANE_BOOTSTRAP_FAILED",
        ),
      );
    } else if (!sessionStore) {
      checks.push(
        dependencyFailure(
          "control_plane.bootstrap",
          now,
          "session.store",
          "Could not bootstrap the control-plane because the session store is unavailable.",
        ),
      );
    } else {
      checks.push(
        dependencyFailure(
          "control_plane.bootstrap",
          now,
          "provider.registry",
          "Could not bootstrap the control-plane because provider registry resolution failed.",
        ),
      );
    }
  } else {
    checks.push(
      dependencyFailure(
        "session.db_path",
        now,
        "config.load",
        "Could not resolve the effective session db path because configuration did not load.",
      ),
    );
    checks.push(
      dependencyFailure(
        "provider.registry",
        now,
        "config.load",
        "Could not resolve provider registry candidates because configuration did not load.",
      ),
    );
    checks.push(
      dependencyFailure(
        "provider.default",
        now,
        "config.load",
        "Could not validate the default provider because configuration did not load.",
      ),
    );
    checks.push(
      dependencyFailure(
        "session.store",
        now,
        "config.load",
        "Could not open the session store because configuration did not load.",
      ),
    );
    if (probeMempalace) {
      checks.push(
        dependencyFailure(
          "memory.mempalace",
          now,
          "config.load",
          "Could not evaluate mempalace health because configuration did not load.",
        ),
      );
    }
    if (probeDirectorMemoryLane) {
      for (const id of [
        "director.memory.switch",
        "director.memory.store",
        "director.memory.recall",
        "director.memory.ingest",
      ] as const) {
        checks.push(
          dependencyFailure(
            id,
            now,
            "config.load",
            "Could not evaluate Director memory lane health because configuration did not load.",
          ),
        );
      }
    }
    if (probeDirectorKnowledgeLane) {
      for (const id of [
        "director.knowledge.switch",
        "director.knowledge.store",
        "director.knowledge.recall",
      ] as const) {
        checks.push(
          dependencyFailure(
            id,
            now,
            "config.load",
            "Could not evaluate Director knowledge lane health because configuration did not load.",
          ),
        );
      }
    }
    checks.push(
      dependencyFailure(
        "control_plane.bootstrap",
        now,
        "config.load",
        "Could not bootstrap the control-plane because configuration did not load.",
      ),
    );
  }

  try {
    const completedAtMs = now();
    const status = aggregateStatus(checks);
    return {
      ok: status !== "fail",
      status,
      startedAtMs,
      completedAtMs,
      durationMs: completedAtMs - startedAtMs,
      ...(config
        ? {
            effective: {
              profile: config.profile,
              workspaceRoot: config.workspaceRoot,
              dataDir: config.dataDir,
              defaultProvider: config.defaultProvider,
              defaultModel: config.defaultModel,
              ...(sessionDbPath ? { sessionDbPath } : {}),
              ...(providers ? { providerIds: providers.providerIds } : {}),
            },
          }
        : {}),
      checks,
    };
  } finally {
    sessionStore?.close();
  }
}

function isClosable(value: unknown): value is { close(): void } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return "close" in value && typeof value.close === "function";
}
