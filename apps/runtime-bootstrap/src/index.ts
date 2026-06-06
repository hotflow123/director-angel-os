import { type HotflowConfig, loadConfig } from "@hotflow/config";
import { resolveDirectorWorkspaceCapabilityContextSync } from "@hotflow/director-knowledge";
import { PhaseOneEngine } from "@hotflow/engine";
import type { MemoryCoreManager } from "@hotflow/memory-core";
import {
  type CreateOpenAICompatibleProviderFromEnvOptions,
  InMemoryModelProviderRegistry,
  ModelRuntime,
} from "@hotflow/models";
import type { LogFields, LogLevel, Logger } from "@hotflow/observability";
import type { PluginRegistrar } from "@hotflow/plugin-runtime";
import { SessionStore } from "@hotflow/sessions";
import {
  FileBackedSkillRepository,
  SkillManagementStore,
  SkillPromptIndex,
  type SkillRepositoryPort,
  type SkillSnapshot,
  SkillSnapshotFileStore,
  loadSkillRepository,
  resolveApprovedSkillSnapshotPath,
  resolveSkillManagementPath,
} from "@hotflow/skills";
import { type TaskBoard, TaskBoardTodoWritePort } from "@hotflow/tasks-core";
import { ToolDispatcher, ToolRegistry, createTasksTodoWriteTool } from "@hotflow/tools";

import { createDefaultRuntimeMemory, createRuntimeDoctorMempalaceProbe } from "./memory.js";
import {
  createDefaultRuntimeContextAssembler,
  createDefaultRuntimePromptSectionContributors,
} from "./prompt-sections.js";
import { createDefaultRuntimePluginRegistrar } from "./providers.js";

export * from "./providers.js";
export { createDefaultRuntimeMemory, createRuntimeDoctorMempalaceProbe } from "./memory.js";
export {
  DEFAULT_RUNTIME_PROMPT_SECTION_IDS,
  createDefaultRuntimeContextAssembler,
  createDefaultRuntimePromptSectionContributors,
  createDefaultRuntimePromptRegistry,
  createDefaultRuntimePromptSections,
} from "./prompt-sections.js";
export {
  createSurfaceTurnReasoningInput,
  type RuntimeTurnReasoningSurface,
  resolveSurfaceTurnReasoningInput,
  SURFACE_TURN_REASONING_FIELD_KEYS,
  type SurfaceTurnReasoningFieldKey,
  type SurfaceTurnReasoningInput,
  type SurfaceTurnReasoningResolution,
} from "./turn-reasoning-surface.js";

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
  readonly loadRuntimeConfig?: (options: { readonly env?: NodeJS.ProcessEnv }) => HotflowConfig;
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
  readonly contextAssembler: ReturnType<typeof createDefaultRuntimeContextAssembler>;
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

export interface RuntimeToolRegistryFactoryInput {
  readonly board: TaskBoard;
  readonly config: HotflowConfig;
  readonly pluginRegistrar: RuntimePluginRegistrar;
}

export function createNoopLogger(): Logger {
  const noop = (
    _levelOrMessage: LogLevel | string,
    _message?: string,
    _fields?: LogFields,
  ): void => {};

  const logger: Logger = {
    log(level: LogLevel, message: string, fields?: LogFields): void {
      noop(level, message, fields);
    },
    debug(message: string, fields?: LogFields): void {
      noop(message, undefined, fields);
    },
    info(message: string, fields?: LogFields): void {
      noop(message, undefined, fields);
    },
    warn(message: string, fields?: LogFields): void {
      noop(message, undefined, fields);
    },
    error(message: string, fields?: LogFields): void {
      noop(message, undefined, fields);
    },
    child(_fields: LogFields): Logger {
      return logger;
    },
  };

  return logger;
}

export function bootstrapRuntime<TControlPlane, TTelemetry>(
  options: RuntimeBootstrapOptions<TControlPlane, TTelemetry>,
): RuntimeBootstrapResult<TControlPlane, TTelemetry> {
  const config = (options.loadRuntimeConfig ?? loadConfig)({
    ...(options.env ? { env: options.env } : {}),
  });
  const logger = options.createLogger?.() ?? createNoopLogger();
  const sessionStore = new SessionStore({
    dbPath: options.resolveSessionDbPath?.(config) ?? config.sessionDbPath,
  });
  const pluginRegistrar = options.pluginRegistrar ?? createDefaultRuntimePluginRegistrar();
  const providerRegistry = new InMemoryModelProviderRegistry();
  const internalProviderReports = pluginRegistrar.registerProviders(providerRegistry, {
    config,
    ...(options.env ? { env: options.env } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  const externalProviderIds = options.registerProviders(providerRegistry, {
    config,
    ...(options.env ? { env: options.env } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  const telemetry = options.createTelemetry({
    config,
    logger,
    sessionStore,
  });
  const memory =
    options.createMemory?.() ??
    createDefaultRuntimeMemory({
      ...(options.env ? { env: options.env } : {}),
    });
  const approvedSkillRepository =
    options.createApprovedSkillRepository?.({ config }) ??
    new FileBackedSkillRepository(
      new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath(config, options.env)),
    );
  const skillRepository =
    options.createSkillRepository?.({ config, approvedSkillRepository }) ??
    loadSkillRepository({
      approvedSkills: options.approvedSkills ?? approvedSkillRepository.listApproved(),
    });
  const skillManagementStore = new SkillManagementStore(resolveSkillManagementPath(config));
  const controlPlane = options.createControlPlane({
    approvedSkillRepository,
    config,
    logger,
    memory,
    sessionStore,
    telemetry,
  });
  const contextAssembler = createDefaultRuntimeContextAssembler(config);
  const engine = new PhaseOneEngine({
    contextAssembler,
    createDispatcher(board: TaskBoard) {
      const registry = createDefaultRuntimeToolRegistry({
        board,
        config,
        pluginRegistrar,
      });
      return new ToolDispatcher(registry, {
        journalSink(event, context) {
          sessionStore.appendJournal(context.sessionId, {
            eventType: event.eventType,
            payload: event.payload as never,
            ...(context.turnId ? { turnId: context.turnId } : {}),
            createdAtMs: event.occurredAtMs,
          });
        },
      });
    },
    logger,
    memory,
    modelRuntime: new ModelRuntime(providerRegistry),
    promptSectionContributors: createDefaultRuntimePromptSectionContributors({
      contextualRecall: createRuntimeContextualRecallSource(config),
      skillPromptIndex: new SkillPromptIndex(skillRepository, {
        isSkillEnabled: (skill) => skillManagementStore.isSkillEnabled(skill.id),
      }),
    }),
    sessionStore,
    workspaceRoot: config.workspaceRoot,
  });

  return {
    approvedSkillRepository,
    config,
    contextAssembler,
    controlPlane,
    engine,
    internalPluginIds: pluginRegistrar.listManifests().map((plugin) => plugin.id),
    logger,
    memory,
    pluginRegistrar,
    providerIds: [
      ...internalProviderReports.flatMap((report) => report.registeredIds),
      ...externalProviderIds,
    ],
    sessionStore,
    skillRepository,
    telemetry,
  };
}

function createRuntimeContextualRecallSource(config: HotflowConfig) {
  return {
    build({
      userText,
      skillSections,
    }: {
      readonly userText: string;
      readonly skillSections?: readonly unknown[];
    }) {
      return resolveDirectorWorkspaceCapabilityContextSync({
        workspaceRoot: config.workspaceRoot,
        dataDir: config.dataDir,
        surface: "production",
        userText,
        knowledgeQuery: {
          tags: deriveRuntimeContextualRecallTags(userText),
          includeGlobalExperience: true,
        },
        skillSections: skillSections as Parameters<
          typeof resolveDirectorWorkspaceCapabilityContextSync
        >[0]["skillSections"],
      });
    },
  };
}

function deriveRuntimeContextualRecallTags(text: string): readonly string[] {
  const tags = ["self-learning", "experience"];
  const rules: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
    [/continuity|连续|连贯|锚点|anchor/iu, ["continuity"]],
    [/teaser|开场|钩子|预告/iu, ["teaser"]],
    [
      /短剧|分镜|镜头|脚本|剧本|故事|制作|导演|画面|运镜/iu,
      ["short-drama", "storyboard", "script"],
    ],
    [/comfyui|生图|文生图|图生图|视频生成|工作流/iu, ["comfyui", "media", "workflow"]],
    [/记忆|经验|知识|召回/iu, ["memory", "knowledge", "recall"]],
  ];
  for (const [pattern, nextTags] of rules) {
    if (pattern.test(text)) {
      tags.push(...nextTags);
    }
  }
  return [...new Set(tags)];
}

export function createDefaultRuntimeToolRegistry(
  input: RuntimeToolRegistryFactoryInput,
): ToolRegistry {
  const registry = new ToolRegistry();
  input.pluginRegistrar.registerTools(registry, { config: input.config });
  registry.register(createTasksTodoWriteTool(new TaskBoardTodoWritePort(input.board)));
  return registry;
}
