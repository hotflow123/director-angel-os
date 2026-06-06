import { MemoryCoreManager } from "@hotflow/memory-core";
import {
  loadMempalaceAdapterConfig,
  probeMempalaceHealthSync,
  searchMempalaceRecallSync,
} from "@hotflow/mempalace-adapter";
class MempalaceRuntimeMemory extends MemoryCoreManager {
  mempalaceConfig;
  now;
  runCommand;
  constructor(options) {
    super();
    this.mempalaceConfig = options.config;
    this.now = options.now ?? Date.now;
    this.runCommand = options.runCommand;
  }
  probeMempalaceHealth() {
    return probeMempalaceHealthSync({
      config: this.mempalaceConfig,
      ...(this.runCommand ? { runCommand: this.runCommand } : {}),
    });
  }
  recallWorkingMemory(options) {
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
function mergeRuntimeDegrade(localBlock, externalRecall) {
  if (!externalRecall.degraded) {
    return localBlock;
  }
  return {
    ...localBlock,
    degraded: combineDegrade(localBlock.degraded, externalRecall.degraded),
  };
}
function mergeRuntimeRecall(localBlock, externalRecall, limit, mode) {
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
function toRuntimeRecallItem(item, query, mode) {
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
function withLocalBackendMetadata(localBlock, mode) {
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
function combineDegrade(local, remote) {
  if (!local) {
    return remote;
  }
  const message = [local.message, remote.message].filter(Boolean).join(" | ");
  return {
    reason: `${local.reason}+${remote.reason}`,
    ...(message ? { message } : {}),
  };
}
export function createDefaultRuntimeMemory(options = {}) {
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
export function createRuntimeDoctorMempalaceProbe(options = {}) {
  const config = loadMempalaceAdapterConfig({
    ...(options.env ? { env: options.env } : {}),
  });
  return () =>
    probeMempalaceHealthSync({
      config,
      ...(options.runCommand ? { runCommand: options.runCommand } : {}),
    });
}
//# sourceMappingURL=memory.js.map
