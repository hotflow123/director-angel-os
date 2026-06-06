import {
  MemoryCoreManager,
  type RecallBlockDegrade,
  type WorkingMemoryRecallBlock,
  type WorkingMemoryRecallBlockItem,
  type WorkingMemoryRecallOptions,
} from "@hotflow/memory-core";
import {
  type MempalaceAdapterConfig,
  type MempalaceAdapterMode,
  type MempalaceCommandExecutor,
  type MempalaceHealthProbeResult,
  type MempalaceRecallResult,
  loadMempalaceAdapterConfig,
  probeMempalaceHealthSync,
  searchMempalaceRecallSync,
} from "@hotflow/mempalace-adapter";

export interface CreateRuntimeMemoryOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly runCommand?: MempalaceCommandExecutor;
  readonly now?: () => number;
}

export interface CreateRuntimeDoctorMempalaceProbeOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly runCommand?: MempalaceCommandExecutor;
}

class MempalaceRuntimeMemory extends MemoryCoreManager {
  public readonly mempalaceConfig: MempalaceAdapterConfig;
  private readonly now: () => number;
  private readonly runCommand: MempalaceCommandExecutor | undefined;

  public constructor(options: {
    readonly config: MempalaceAdapterConfig;
    readonly now?: () => number;
    readonly runCommand?: MempalaceCommandExecutor;
  }) {
    super();
    this.mempalaceConfig = options.config;
    this.now = options.now ?? Date.now;
    this.runCommand = options.runCommand;
  }

  public probeMempalaceHealth(): MempalaceHealthProbeResult {
    return probeMempalaceHealthSync({
      config: this.mempalaceConfig,
      ...(this.runCommand ? { runCommand: this.runCommand } : {}),
    });
  }

  public override recallWorkingMemory(
    options: WorkingMemoryRecallOptions,
  ): WorkingMemoryRecallBlock {
    const localBlock = super.recallWorkingMemory(options);
    const query = options.query?.trim();

    if (!query || this.mempalaceConfig.mode === "disabled") {
      return localBlock;
    }

    const externalRecall = searchMempalaceRecallSync({
      config: this.mempalaceConfig,
      query,
      ...(options.limit ? { nResults: options.limit } : {}),
      ...(this.runCommand ? { runCommand: this.runCommand } : {}),
      now: this.now,
    });

    const mode = this.mempalaceConfig.mode;
    const localFallbackBlock = withLocalBackendMetadata(localBlock, mode);

    if (externalRecall.outcome !== "ok" || externalRecall.items.length === 0) {
      return mergeRuntimeDegrade(localFallbackBlock, externalRecall);
    }

    return mergeRuntimeRecall(localFallbackBlock, externalRecall, options.limit, mode);
  }
}

function mergeRuntimeDegrade(
  localBlock: WorkingMemoryRecallBlock,
  externalRecall: MempalaceRecallResult,
): WorkingMemoryRecallBlock {
  if (!externalRecall.degraded) {
    return localBlock;
  }

  return {
    ...localBlock,
    degraded: combineDegrade(localBlock.degraded, externalRecall.degraded),
  };
}

function mergeRuntimeRecall(
  localBlock: WorkingMemoryRecallBlock,
  externalRecall: MempalaceRecallResult,
  limit: number | undefined,
  mode: MempalaceAdapterMode,
): WorkingMemoryRecallBlock {
  const externalItems = externalRecall.items.map((item) =>
    toRuntimeRecallItem(item, localBlock.query, mode),
  );
  const mergedItems =
    mode === "primary"
      ? [...externalItems, ...localBlock.items]
      : [...localBlock.items, ...externalItems].sort((left, right) => {
          const scoreDiff = right.score - left.score;
          if (scoreDiff !== 0) {
            return scoreDiff;
          }
          return right.updatedAt - left.updatedAt;
        });

  return {
    ...localBlock,
    items: limit ? mergedItems.slice(0, limit) : mergedItems,
  };
}

function toRuntimeRecallItem(
  item: MempalaceRecallResult["items"][number],
  query: string | undefined,
  mode: MempalaceAdapterMode,
): WorkingMemoryRecallBlockItem {
  return {
    id: `mempalace:${item.id}`,
    layer: "layer1",
    content: item.content,
    score: item.score,
    updatedAt: item.updatedAt,
    metadata: {
      ...(item.metadata ?? {}),
      source: "mempalace",
      memoryBackend: "mempalace",
      memoryBackendMode: mode,
      matchMode: typeof item.metadata?.matchMode === "string" ? item.metadata.matchMode : "vector",
      ...(typeof item.metadata?.verbatim === "string" && item.metadata.verbatim.trim().length > 0
        ? { drawerContent: item.metadata.verbatim }
        : {}),
      vectorSimilarity:
        typeof item.metadata?.vectorSimilarity === "number"
          ? item.metadata.vectorSimilarity
          : item.score,
      ...(query ? { query } : {}),
      ...(item.wing ? { wing: item.wing } : {}),
      ...(item.room ? { room: item.room } : {}),
    },
  };
}

function withLocalBackendMetadata(
  localBlock: WorkingMemoryRecallBlock,
  mode: MempalaceAdapterMode,
): WorkingMemoryRecallBlock {
  return {
    ...localBlock,
    items: localBlock.items.map((item) => ({
      ...item,
      metadata: {
        ...(item.metadata ?? {}),
        memoryBackend: "local",
        memoryBackendMode: mode === "primary" ? "primary-fallback" : "local",
      },
    })),
  };
}

function combineDegrade(
  local: RecallBlockDegrade | undefined,
  remote: RecallBlockDegrade,
): RecallBlockDegrade {
  if (!local) {
    return remote;
  }

  const message = [local.message, remote.message].filter(Boolean).join(" | ");

  return {
    reason: `${local.reason}+${remote.reason}`,
    ...(message ? { message } : {}),
  };
}

export function createDefaultRuntimeMemory(
  options: CreateRuntimeMemoryOptions = {},
): MemoryCoreManager {
  const config = loadMempalaceAdapterConfig({
    ...(options.env ? { env: options.env } : {}),
  });

  if (config.mode === "disabled") {
    return new MemoryCoreManager();
  }

  return new MempalaceRuntimeMemory({
    config,
    ...(options.now ? { now: options.now } : {}),
    ...(options.runCommand ? { runCommand: options.runCommand } : {}),
  });
}

export function createRuntimeDoctorMempalaceProbe(
  options: CreateRuntimeDoctorMempalaceProbeOptions = {},
): () => MempalaceHealthProbeResult {
  const config = loadMempalaceAdapterConfig({
    ...(options.env ? { env: options.env } : {}),
  });

  return () =>
    probeMempalaceHealthSync({
      config,
      ...(options.runCommand ? { runCommand: options.runCommand } : {}),
    });
}
