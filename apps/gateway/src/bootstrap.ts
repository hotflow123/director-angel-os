import {
  type RuntimeApprovedSkillRepository,
  type RuntimeApprovedSkillRepositoryFactoryInput,
  type RuntimeBootstrapOptions,
  type RuntimeBootstrapResult,
  type RuntimePluginRegistrar,
  type RuntimeSkillRepository,
  type RuntimeSkillRepositoryFactoryInput,
  bootstrapRuntime,
  registerDefaultRuntimeProviders,
} from "@hotflow/runtime-bootstrap";

export interface GatewayTelemetry {
  readonly surface: "gateway";
}

export interface GatewayControlPlane {
  readonly surface: "gateway";
}

export interface BootstrapGatewayOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  readonly createMemory?: RuntimeBootstrapOptions<
    GatewayControlPlane,
    GatewayTelemetry
  >["createMemory"];
  readonly createApprovedSkillRepository?: (
    input: RuntimeApprovedSkillRepositoryFactoryInput,
  ) => RuntimeApprovedSkillRepository;
  readonly createSkillRepository?: (
    input: RuntimeSkillRepositoryFactoryInput,
  ) => RuntimeSkillRepository;
  readonly pluginRegistrar?: RuntimePluginRegistrar;
}

export function resolveGatewaySessionDbPath(
  config: { dataDir: string; sessionDbPath: string },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.HOTFLOW_GATEWAY_SESSION_DB_PATH?.trim();
  if (override) {
    return override;
  }
  return `${config.dataDir}/sessions/gateway.sqlite`;
}

export function bootstrapGateway(
  options: BootstrapGatewayOptions = {},
): RuntimeBootstrapResult<GatewayControlPlane, GatewayTelemetry> {
  const { createMemory, ...rest } = options;
  return bootstrapRuntime<GatewayControlPlane, GatewayTelemetry>({
    ...rest,
    ...(createMemory === undefined ? {} : { createMemory }),
    ...(options.createSkillRepository === undefined
      ? {}
      : { createSkillRepository: options.createSkillRepository }),
    ...(options.createApprovedSkillRepository === undefined
      ? {}
      : { createApprovedSkillRepository: options.createApprovedSkillRepository }),
    createTelemetry() {
      return { surface: "gateway" };
    },
    createControlPlane() {
      return { surface: "gateway" };
    },
    registerProviders(providerRegistry, registrationOptions) {
      return registerDefaultRuntimeProviders(providerRegistry, {
        ...(registrationOptions.env ? { env: registrationOptions.env } : {}),
        ...(registrationOptions.fetchImpl ? { fetchImpl: registrationOptions.fetchImpl } : {}),
        includeScripted: false,
      });
    },
    ...(options.pluginRegistrar === undefined ? {} : { pluginRegistrar: options.pluginRegistrar }),
    resolveSessionDbPath(config) {
      return resolveGatewaySessionDbPath(config, options.env);
    },
  });
}
