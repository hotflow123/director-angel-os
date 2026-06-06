import type { HotflowConfig } from "@hotflow/config";
import type { DynamicContextAssembler } from "@hotflow/context";
import type { PhaseOneEngine } from "@hotflow/engine";
import type { MemoryCoreManager } from "@hotflow/memory-core";
import type {
  CreateOpenAICompatibleProviderFromEnvOptions,
  InMemoryModelProviderRegistry,
} from "@hotflow/models";
import type { Logger } from "@hotflow/observability";
import type { PluginRegistrar } from "@hotflow/plugin-runtime";
import type { SessionStore } from "@hotflow/sessions";
import type { SkillRepositoryPort, SkillSnapshot, loadSkillRepository } from "@hotflow/skills";
export * from "./providers.js";
export { createDefaultRuntimeMemory, createRuntimeDoctorMempalaceProbe } from "./memory.js";
export interface RuntimeProviderRegistrationOptions
  extends Pick<CreateOpenAICompatibleProviderFromEnvOptions, "env" | "fetchImpl"> {
  readonly config: HotflowConfig;
}
export interface RuntimeTelemetryFactoryInput {
  readonly config: HotflowConfig;
  readonly logger: Logger;
  readonly sessionStore: SessionStore;
}
export interface RuntimeControlPlaneFactoryInput<TTelemetry> {
  readonly approvedSkillRepository: RuntimeApprovedSkillRepository;
  readonly config: HotflowConfig;
  readonly logger: Logger;
  readonly memory: MemoryCoreManager;
  readonly sessionStore: SessionStore;
  readonly telemetry: TTelemetry;
}
export interface RuntimeSkillRepositoryFactoryInput {
  readonly approvedSkillRepository: RuntimeApprovedSkillRepository;
  readonly config: HotflowConfig;
}
export type RuntimePluginRegistrar = PluginRegistrar;
export type RuntimeSkillRepository = ReturnType<typeof loadSkillRepository>;
export type RuntimeApprovedSkillRepository = SkillRepositoryPort;
export interface RuntimeApprovedSkillRepositoryFactoryInput {
  readonly config: HotflowConfig;
}
export interface RuntimeBootstrapOptions<TControlPlane, TTelemetry>
  extends Pick<CreateOpenAICompatibleProviderFromEnvOptions, "env" | "fetchImpl"> {
  readonly approvedSkills?: readonly SkillSnapshot[];
  readonly createApprovedSkillRepository?: (
    input: RuntimeApprovedSkillRepositoryFactoryInput,
  ) => RuntimeApprovedSkillRepository;
  readonly createControlPlane: (
    input: RuntimeControlPlaneFactoryInput<TTelemetry>,
  ) => TControlPlane;
  readonly createLogger?: () => Logger;
  readonly createMemory?: () => MemoryCoreManager;
  readonly createSkillRepository?: (
    input: RuntimeSkillRepositoryFactoryInput,
  ) => RuntimeSkillRepository;
  readonly createTelemetry: (input: RuntimeTelemetryFactoryInput) => TTelemetry;
  readonly loadRuntimeConfig?: (options: {
    readonly env?: NodeJS.ProcessEnv;
  }) => HotflowConfig;
  readonly pluginRegistrar?: RuntimePluginRegistrar;
  readonly registerProviders: (
    providerRegistry: InMemoryModelProviderRegistry,
    options: RuntimeProviderRegistrationOptions,
  ) => readonly string[];
  readonly resolveSessionDbPath?: (config: HotflowConfig) => string;
}
export interface RuntimeBootstrapResult<TControlPlane, TTelemetry> {
  readonly approvedSkillRepository: RuntimeApprovedSkillRepository;
  readonly config: HotflowConfig;
  readonly contextAssembler: DynamicContextAssembler;
  readonly controlPlane: TControlPlane;
  readonly engine: PhaseOneEngine;
  readonly internalPluginIds: readonly string[];
  readonly logger: Logger;
  readonly memory: MemoryCoreManager;
  readonly pluginRegistrar: RuntimePluginRegistrar;
  readonly providerIds: readonly string[];
  readonly sessionStore: SessionStore;
  readonly skillRepository: RuntimeSkillRepository;
  readonly telemetry: TTelemetry;
}
export declare function createNoopLogger(): Logger;
export declare function bootstrapRuntime<TControlPlane, TTelemetry>(
  options: RuntimeBootstrapOptions<TControlPlane, TTelemetry>,
): RuntimeBootstrapResult<TControlPlane, TTelemetry>;
//# sourceMappingURL=index.d.ts.map
