import { loadConfig } from "@hotflow/config";
import { resolveDirectorWorkspaceCapabilityContextSync } from "@hotflow/director-knowledge";
import { PhaseOneEngine } from "@hotflow/engine";
import { InMemoryModelProviderRegistry, ModelRuntime } from "@hotflow/models";
import { SessionStore } from "@hotflow/sessions";
import {
  FileBackedSkillRepository,
  SkillManagementStore,
  SkillPromptIndex,
  SkillSnapshotFileStore,
  loadSkillRepository,
  resolveApprovedSkillSnapshotPath,
  resolveSkillManagementPath,
} from "@hotflow/skills";
import { TaskBoardTodoWritePort } from "@hotflow/tasks-core";
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
  resolveSurfaceTurnReasoningInput,
  SURFACE_TURN_REASONING_FIELD_KEYS,
} from "./turn-reasoning-surface.js";
export function createNoopLogger() {
  const noop = (_levelOrMessage, _message, _fields) => {};
  const logger = {
    log(level, message, fields) {
      noop(level, message, fields);
    },
    debug(message, fields) {
      noop(message, undefined, fields);
    },
    info(message, fields) {
      noop(message, undefined, fields);
    },
    warn(message, fields) {
      noop(message, undefined, fields);
    },
    error(message, fields) {
      noop(message, undefined, fields);
    },
    child(_fields) {
      return logger;
    },
  };
  return logger;
}
export function bootstrapRuntime(options) {
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
    createDispatcher(board) {
      const registry = createDefaultRuntimeToolRegistry({
        board,
        config,
        pluginRegistrar,
      });
      return new ToolDispatcher(registry, {
        journalSink(event, context) {
          sessionStore.appendJournal(context.sessionId, {
            eventType: event.eventType,
            payload: event.payload,
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
function createRuntimeContextualRecallSource(config) {
  return {
    build({ userText, skillSections }) {
      return resolveDirectorWorkspaceCapabilityContextSync({
        workspaceRoot: config.workspaceRoot,
        dataDir: config.dataDir,
        surface: "production",
        userText,
        knowledgeQuery: {
          tags: deriveRuntimeContextualRecallTags(userText),
          includeGlobalExperience: true,
        },
        skillSections,
      });
    },
  };
}
function deriveRuntimeContextualRecallTags(text) {
  const tags = ["self-learning", "experience"];
  const rules = [
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
export function createDefaultRuntimeToolRegistry(input) {
  const registry = new ToolRegistry();
  input.pluginRegistrar.registerTools(registry, { config: input.config });
  registry.register(createTasksTodoWriteTool(new TaskBoardTodoWritePort(input.board)));
  return registry;
}
//# sourceMappingURL=index.js.map
